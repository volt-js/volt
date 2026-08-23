/**
 * Slider and file upload — the two controls whose value is produced by a
 * gesture rather than typed.
 *
 * They share a file because they share a problem. Both are form controls that
 * the platform has no usable element for: `<input type="range">` cannot be
 * given two thumbs and cannot be styled, and `<input type="file">` is a picker
 * rather than an uploader — it has no queue, no progress, no cancel and no
 * retry. So both are assembled here, and both keep a real native input behind
 * them so that `FormData`, `form.reset()`, constraint validation and the
 * browser's own required-field handling still work. Both compose
 * `createFormField`, which is where the label, description, error message and
 * validation state already live.
 *
 * Everything here is headless: it owns state, keyboard and ARIA, and returns
 * prop objects to spread onto whatever markup the consumer writes. Nothing
 * renders, and nothing has an opinion about styling — a slider reports where
 * its thumb is as a percentage and the consumer decides what that means in
 * pixels.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createFormField, type FormField, type ValidationOutcome } from './form-field.js';
import { createProgress, type Progress } from './display.js';
import { createLiveRegionTiming, type LiveRegionTiming } from './feedback.js';
import { exponentialBackoff } from './async.js';
import { useLocale, resolveDirection, type Direction } from './i18n.js';
import { VISUALLY_HIDDEN_INPUT_STYLE } from './form-controls.js';
import { createId } from './id.js';

const { untrack } = Signal.subtle;

/**
 * A prop object to spread.
 *
 * Attributes and properties only, never handlers: a prop object is re-applied
 * whenever the state it reads changes, and a listener in one would be added
 * again on every re-application. Events are wired in the template, where the
 * consumer can see them.
 */
export interface SliderProps {
  readonly [key: string]: string | boolean | undefined;
}

/** The same contract, for the other half of this file. */
export interface FileUploadProps {
  readonly [key: string]: string | boolean | undefined;
}

/** Narrow a prop value that is known to be text, without asserting. */
function text(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

// ===========================================================================
// Slider
// ===========================================================================

/**
 * Marks a thumb, and says which one it is. Read from the DOM rather than held
 * in a signal, so thumbs rendered from a `:for` need no per-thumb wiring.
 */
export const SLIDER_THUMB_ATTRIBUTE = 'data-volt-slider-thumb';
/** Marks a thumb's hidden native input, and says which thumb it belongs to. */
export const SLIDER_INPUT_ATTRIBUTE = 'data-volt-slider-input';

export type SliderOrientation = 'horizontal' | 'vertical';

/** A tick on the track. Without a label it is decoration; with one it is a scale. */
export interface SliderMark {
  readonly value: number;
  readonly label?: string;
}

export interface SliderLabels {
  /** Names the only thumb of a single-value slider. Default "Value". */
  thumb?: string;
  /** Names the lowest thumb of a range. Default "Minimum". */
  minimum?: string;
  /** Names the highest thumb of a range. Default "Maximum". */
  maximum?: string;
  /**
   * Names the thumbs between the two ends, for a slider with three or more.
   * `position` is 1-based. Default "Value 2", "Value 3", …
   */
  nth?: (position: number) => string;
}

export interface SliderOptions {
  /**
   * The whole slider. Direction is resolved from here, the thumbs and their
   * hidden inputs are found under here, and the owning form is found from here.
   */
  root: () => Element | null | undefined;
  /**
   * The element whose box maps onto min–max. Defaults to the root.
   *
   * Worth separating whenever the root has padding: a press is otherwise
   * reported as a value the thumb can never reach, because the thumb travels
   * the track and the pointer was measured against the box around it.
   */
  track?: () => Element | null | undefined;
  /**
   * The first thumb's hidden input, which is the control the form field
   * validates. Defaults to finding it under the root.
   */
  input?: () => Element | null | undefined;

  /**
   * Supply a signal to control the slider from outside. Without one it owns
   * its own state, which is what most callers want.
   *
   * One thumb or many is decided by the length of this array, not by a flag:
   * a range slider is a slider with a second thumb, and a separate `range`
   * option would only let the two disagree.
   */
  value?: Signal.State<readonly number[]>;
  defaultValue?: readonly number[];

  /** Default 0. */
  min?: number;
  /** Default 100. */
  max?: number;
  /** The granularity of every value. Default 1. */
  step?: number;
  /** What PageUp and PageDown move by. Default ten steps. */
  largeStep?: number;
  /**
   * Steps that must remain between neighbouring thumbs. Default 0, so two
   * thumbs may sit on the same value but never pass each other.
   */
  minStepsBetweenThumbs?: number;

  /** Default horizontal. */
  orientation?: SliderOrientation;
  /**
   * Force a writing direction instead of resolving it from the DOM and then
   * from the locale.
   */
  dir?: Direction;
  /**
   * Put the minimum at the end the maximum would normally be — a volume
   * slider that fills downwards. Applied on top of direction and orientation,
   * so it inverts whatever those resolved to.
   */
  inverted?: boolean;

  /** Ticks. Bare numbers are ticks with no label. */
  marks?: readonly (number | SliderMark)[];
  /**
   * Only mark values are reachable, and the arrows move between marks rather
   * than by `step`. The tradeoff is that `step` then governs nothing but the
   * rounding of a value the caller supplies.
   */
  snapToMarks?: boolean;

  disabled?: () => boolean;
  required?: () => boolean;

  /** Submitted once per thumb. A range therefore submits repeated entries. */
  name?: string;

  /** Passed through to the form field, which owns the ARIA between them. */
  label?: () => Element | null | undefined;
  description?: () => Element | null | undefined;
  errorMessage?: () => Element | null | undefined;

  /**
   * What a screen reader hears in place of the number — "£25", "medium". The
   * default is the value formatted for the locale, which is already better
   * than the raw number for anything above a thousand.
   */
  valueText?: (value: number, index: number) => string;

  /** Validation the platform cannot express, run by the form field. */
  validate?: (values: readonly number[]) => ValidationOutcome | Promise<ValidationOutcome>;

  labels?: SliderLabels;

  /** Every change, including every frame of a drag. */
  onValueChange?: (values: readonly number[]) => void;
  /**
   * Once the value has settled: a drag released, a key pressed. This is the
   * one to send to a server — `onValueChange` fires per pointer move.
   */
  onValueCommit?: (values: readonly number[]) => void;
}

export interface Slider {
  /** Every thumb's value, in ascending order. */
  values(): readonly number[];
  /** The first thumb's value, for the single-thumb case. */
  value(): number;
  /** Where a value sits along the track, 0–100. */
  percentFor(value: number): number;
  /** Where thumb `index` sits, 0–100. */
  percentAt(index: number): number;
  /** The filled span, 0–100. From the minimum for one thumb, thumb to thumb otherwise. */
  fill(): { readonly start: number; readonly end: number };
  /** The marks, normalised to objects and sorted. */
  marks(): readonly SliderMark[];

  isDisabled(): boolean;
  isDragging(): boolean;
  /** The thumb being dragged, or the last one touched. */
  activeIndex(): number | null;
  orientation(): SliderOrientation;
  /** The resolved writing direction, which is what the arrows follow. */
  direction(): Direction;

  /** The bounds thumb `index` may move between, once its neighbours are counted. */
  boundsAt(index: number): readonly [number, number];

  setValue(index: number, value: number): void;
  setValues(values: readonly number[]): void;
  /** Move by whole steps, or by whole marks under `snapToMarks`. */
  stepBy(index: number, steps: number): void;

  /** The form field this composes, for validation and dirty state. */
  readonly field: FormField;

  /** Wire once, on the root or the track. */
  onPointerDown(event: PointerEvent): void;
  /** Wire alongside it. Returns true when the key was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;

  rootProps(): SliderProps;
  labelProps(): SliderProps;
  trackProps(): SliderProps;
  rangeProps(): SliderProps;
  thumbProps(index: number): SliderProps;
  inputProps(index: number): SliderProps;
  markProps(mark: number | SliderMark): SliderProps;
  descriptionProps(): SliderProps;
  errorMessageProps(): SliderProps;
}

/**
 * A slider, single or range.
 *
 *   class Price {
 *     root = new Signal.State<Element | null>(null);
 *     slider = createSlider({ root: () => this.root.get(), defaultValue: [20, 80], name: 'price' });
 *   }
 *
 *   <div :ref="root" :spread="slider.rootProps()"
 *        :pointerdown="slider.onPointerDown($event)"
 *        :keydown="slider.onKeyDown($event)">
 *     <span :spread="slider.trackProps()">
 *       <span :spread="slider.rangeProps()"></span>
 *     </span>
 *     <span :for="(v, i) of slider.values()" :key="i" :spread="slider.thumbProps(i)"></span>
 *     <input :for="(v, i) of slider.values()" :key="i" :spread="slider.inputProps(i)">
 *   </div>
 *
 * Both handlers resolve the thumb from the event, so wiring them once on the
 * root covers every thumb — which is what lets the thumbs come out of a loop.
 *
 * The keyboard map is the WAI-ARIA slider pattern, in full:
 *
 *   ArrowRight, ArrowUp      one step up
 *   ArrowLeft, ArrowDown     one step down
 *   PageUp                   one large step up
 *   PageDown                 one large step down
 *   Home                     the lowest value this thumb may take
 *   End                      the highest value this thumb may take
 *
 * Left and Right are resolved against writing direction and so swap under
 * `dir="rtl"`. Up and Down never swap, in either orientation: vertical order
 * is not mirrored by language, and a vertical slider whose Up key went down
 * would be unusable. That means a right-to-left horizontal slider has two keys
 * that increase and two that decrease, and they disagree about which way the
 * screen moves — which is correct, and is what every native RTL slider does.
 *
 * Three decisions carry the rest:
 *
 *   - **Thumbs cannot cross.** Each one is clamped between its neighbours, and
 *     `aria-valuemin` and `aria-valuemax` report those constrained bounds
 *     rather than the slider's. The cost is that a screen reader hears a range
 *     that shrinks as the other thumb approaches; the alternative is
 *     announcing values the thumb will refuse to take.
 *   - **The nearest thumb takes a press.** With two thumbs on the same value
 *     the distance is a tie, so the one that can move towards the press wins —
 *     otherwise a stack of thumbs at the maximum could never be pulled apart.
 *   - **Position is a percentage, not a pixel.** `percentAt` measures along the
 *     value axis, and the consumer places it with `inset-inline-start` or
 *     `bottom`, which mirror themselves. Only the pointer needs to know about
 *     direction, because a click has to be read backwards.
 */
export function createSlider(options: SliderOptions): Slider {
  const min = options.min ?? 0;
  const max = options.max ?? 100;
  // A step of zero would divide by zero in every quantisation below, and a
  // negative one has no meaning; both are caller bugs that would otherwise
  // surface as NaN in `aria-valuenow`.
  const step = options.step && options.step > 0 ? options.step : 1;
  const largeStep = options.largeStep && options.largeStep > 0 ? options.largeStep : step * 10;
  const pageSteps = Math.max(1, Math.round(largeStep / step));
  const orientation = options.orientation ?? 'horizontal';
  const gap = Math.max(0, options.minStepsBetweenThumbs ?? 0) * step;
  const inverted = options.inverted === true;
  const snapToMarks = options.snapToMarks === true;

  const locale = useLocale();
  const labels = options.labels ?? {};

  const sliderId = createId('slider');
  const thumbId = (index: number) => `${sliderId}-thumb-${index}`;

  const disabled = () => options.disabled?.() ?? false;

  const marks = normaliseMarks(options.marks, min, max);
  const markValues = marks.map((mark) => mark.value);

  // Decimals are counted from the inputs rather than assumed, because
  // `0.1 + 0.2` is the classic way a slider reports 0.30000000000000004 as its
  // value and then submits it.
  const precision = Math.max(decimalsOf(step), decimalsOf(min));

  const raw =
    options.value ?? new Signal.State<readonly number[]>(options.defaultValue ?? [min]);
  const dragging = new Signal.State(false);
  const active = new Signal.State<number | null>(null);

  /** What a `reset` on the owning form restores. */
  const initial = settle(untrack(() => raw.get()));

  function quantise(value: number): number {
    if (!Number.isFinite(value)) return min;
    if (snapToMarks && markValues.length > 0) return nearestValue(markValues, value);
    const steps = Math.round((value - min) / step);
    return roundTo(min + steps * step, precision);
  }

  /** The last value the grid offers at or below `value`, if it offers one. */
  function gridBelow(value: number): number | null {
    if (snapToMarks && markValues.length > 0) {
      let best: number | null = null;
      for (const mark of markValues) if (mark <= value) best = mark;
      return best;
    }
    const nearest = quantise(value);
    return nearest <= value ? nearest : roundTo(nearest - step, precision);
  }

  /** The first value the grid offers at or above `value`, if it offers one. */
  function gridAbove(value: number): number | null {
    if (snapToMarks && markValues.length > 0) {
      for (const mark of markValues) if (mark >= value) return mark;
      return null;
    }
    const nearest = quantise(value);
    return nearest >= value ? nearest : roundTo(nearest + step, precision);
  }

  /**
   * Where a thumb asked for `value` may actually land, or `null` for nowhere.
   *
   * Clamping to a neighbour's bound is not enough on its own. The gap puts that
   * bound wherever it likes — between two marks, as a rule — and a value parked
   * on it is off the grid, so the settle every read applies snaps it back past
   * the bound and shoves the neighbour along to make room. The signal then
   * holds one array while `values()` reports another, and `onValueChange` is
   * handed a value the slider will never report or submit. Refusing the move is
   * the honest answer for a thumb with no room left in front of it.
   */
  function landing(value: number, low: number, high: number): number | null {
    const wanted = quantise(clamp(value, low, high));
    if (wanted >= low && wanted <= high) return wanted;
    const nearest = wanted > high ? gridBelow(high) : gridAbove(low);
    return nearest !== null && nearest >= low && nearest <= high ? nearest : null;
  }

  /**
   * The array as it is allowed to exist: every value on the grid, in range,
   * and in ascending order.
   *
   * Applied on read as well as on write, so a controlled signal set to
   * something impossible cannot put a thumb off the end of its track. The
   * original array is returned untouched when it already passes, so a
   * consumer comparing references is not defeated by the check.
   */
  function settle(list: readonly number[]): readonly number[] {
    const out: number[] = [];
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      const low = i > 0 ? (out[i - 1] ?? min) + gap : min;
      const value = clamp(quantise(list[i] ?? min), Math.min(low, max), max);
      out.push(value);
      if (value !== list[i]) changed = true;
    }
    return changed ? out : list;
  }

  const current = (): readonly number[] => settle(raw.get());

  function boundsAt(index: number, list = current()): readonly [number, number] {
    const low = index > 0 ? (list[index - 1] ?? min) + gap : min;
    const high = index < list.length - 1 ? (list[index + 1] ?? max) - gap : max;
    // A gap wider than the space left over would otherwise invert the range.
    return [clamp(low, min, max), clamp(Math.max(low, high), min, max)];
  }

  const commit = () => options.onValueCommit?.(current());

  function write(next: readonly number[]): void {
    raw.set(next);
    options.onValueChange?.(next);
  }

  function setValue(index: number, value: number): void {
    if (disabled()) return;
    const list = current();
    if (index < 0 || index >= list.length) return;

    const [low, high] = boundsAt(index, list);
    const next = landing(value, low, high);
    if (next === null || next === list[index]) return;

    const out = [...list];
    out[index] = next;
    write(out);
  }

  function setValues(values: readonly number[]): void {
    if (disabled()) return;
    const next = settle(values);
    const list = current();
    if (next.length === list.length && next.every((value, i) => value === list[i])) return;
    write(next);
  }

  function stepBy(index: number, steps: number): void {
    const list = current();
    const from = list[index];
    if (from === undefined) return;

    if (snapToMarks && markValues.length > 0) {
      const at = markValues.indexOf(nearestValue(markValues, from));
      const target = markValues[clamp(at + steps, 0, markValues.length - 1)];
      if (target !== undefined) setValue(index, target);
      return;
    }

    setValue(index, from + steps * step);
  }

  // -------------------------------------------------------------------------
  // Direction
  // -------------------------------------------------------------------------

  /**
   * The DOM's answer, held in a signal because the DOM is not reactive: during
   * a template's own evaluation the root is still detached and has no ancestor
   * to inherit from.
   */
  const domDirection = new Signal.State<Direction | null>(null);

  effect(() => {
    const el = options.root();
    // Only when something actually declares one. `resolveDirection` answers
    // `ltr` for silence, which would override a locale that says otherwise —
    // and a locale set to Arabic should be enough on its own.
    domDirection.set(el?.closest('[dir]') ? resolveDirection(el) : null);
  });

  const direction = (): Direction =>
    options.dir ?? domDirection.get() ?? locale.direction();

  // -------------------------------------------------------------------------
  // Geometry
  // -------------------------------------------------------------------------

  const trackElement = (): Element | null => (options.track ?? options.root)() ?? null;

  const thumbAt = (index: number): HTMLElement | null =>
    options.root()?.querySelector<HTMLElement>(`[${SLIDER_THUMB_ATTRIBUTE}="${index}"]`) ?? null;

  function percentFor(value: number): number {
    const span = max - min;
    // A max at or below min is a caller bug; zero keeps the arithmetic finite
    // rather than putting NaN into a style.
    if (span <= 0) return 0;
    const percent = clamp(((value - min) / span) * 100, 0, 100);
    // Inversion is a fact about the track, so it belongs to every reading of
    // the track — not only to the pointer. Direction is left out on purpose:
    // the consumer positions with `inset-inline-start`, which mirrors itself
    // under `dir=rtl`, and there is no CSS property that mirrors `inverted`.
    // Leaving this to the consumer was the alternative; it puts the thumb at
    // the opposite end of the track from the finger until they find out.
    return inverted ? 100 - percent : percent;
  }

  /** Where a pointer is, as a value. */
  function valueAt(event: PointerEvent, track: Element): number {
    const rect = track.getBoundingClientRect();

    let fraction: number;
    if (orientation === 'vertical') {
      // Screen y grows downwards and value grows upwards, so vertical is
      // mirrored before anything else is considered.
      fraction = rect.height > 0 ? (rect.bottom - event.clientY) / rect.height : 0;
    } else {
      fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
      if (direction() === 'rtl') fraction = 1 - fraction;
    }
    if (inverted) fraction = 1 - fraction;

    return min + clamp(fraction, 0, 1) * (max - min);
  }

  /** Which thumb a press at `value` belongs to. */
  function nearestThumb(list: readonly number[], value: number): number {
    let best = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < list.length; i++) {
      const gapToThumb = Math.abs((list[i] ?? min) - value);
      if (gapToThumb < distance) {
        best = i;
        distance = gapToThumb;
      }
    }

    // Thumbs sitting on the same value are a tie distance cannot break. The
    // press is asking for the stack to come apart, so it goes to the one that
    // can travel towards it; without this, two thumbs at the maximum are stuck
    // together for ever.
    const at = list[best] ?? min;
    if (value > at) {
      while (best + 1 < list.length && list[best + 1] === at) best += 1;
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Dragging
  // -------------------------------------------------------------------------

  let stopDrag: (() => void) | null = null;
  // A live drag outlives the component only if nobody stops it, and the
  // listeners below are on the document rather than on anything that unmounts.
  onCleanup(() => stopDrag?.());

  function beginDrag(pointerId: number, index: number, track: Element): void {
    stopDrag?.();

    const thumb = thumbAt(index);
    // Capture keeps the events coming when the pointer leaves the window or
    // crosses an iframe; the listeners are on the document because a captured
    // event is retargeted at the thumb and still bubbles from there.
    thumb?.setPointerCapture?.(pointerId);

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      setValue(index, valueAt(event, track));
    };
    const onEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      stopDrag?.();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);

    dragging.set(true);

    stopDrag = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      if (thumb?.hasPointerCapture?.(pointerId)) thumb.releasePointerCapture(pointerId);
      stopDrag = null;
      dragging.set(false);
      field.markTouched();
      commit();
    };
  }

  // -------------------------------------------------------------------------
  // Form field
  // -------------------------------------------------------------------------

  const validateValues = options.validate;

  /**
   * The mirror standing for thumb `index`, if the consumer rendered one.
   *
   * Found by query rather than by ref because the mirrors come out of the same
   * loop the thumbs do, and a `:for` cannot hold a ref per iteration.
   */
  const mirrorAt = (index: number): HTMLInputElement | null =>
    options.root()?.querySelector<HTMLInputElement>(`[${SLIDER_INPUT_ATTRIBUTE}="${index}"]`) ??
    null;

  /**
   * The first thumb's mirror, which is the control the field validates. A
   * consumer with one thumb can pass `input` instead and skip the lookup.
   */
  const control = (): Element | null => options.input?.() ?? mirrorAt(0) ?? options.root() ?? null;

  const composed: FormField = createFormField({
    control,
    label: options.label,
    description: options.description,
    errorMessage: options.errorMessage,
    required: options.required,
    disabled: options.disabled,
    validate: validateValues ? () => validateValues(current()) : undefined,
  });

  /**
   * The value the mirrors were last filled from, thumb by thumb.
   *
   * Two places hold this slider's value — the signal it reads and the mirrors
   * the form is read from — and between a gesture and the render that follows
   * it they disagree. This is the state they last agreed on, which is what
   * says which of the two has moved since.
   */
  let rendered: readonly string[] = [];

  /**
   * What a submit would send right now, thumb by thumb.
   *
   * A mirror still holding what it was filled with is a render behind, so the
   * signal is the newer of the two; a mirror holding anything else has been
   * written by something outside this component — a session restore, a page
   * back from the bfcache, an autofill — and what it holds is what the form
   * will send.
   *
   * Read from the DOM on every call rather than sampled when an event says to:
   * assigning to `value` announces nothing, so the restores that fire no event
   * at all are exactly the ones a sampled answer never sees.
   */
  function submitted(): readonly number[] {
    return current().map((value, index) => {
      const mirror = mirrorAt(index);
      if (!mirror || mirror.value === rendered[index]) return value;
      // Whatever a range input holds is a number: the platform sanitises
      // anything else away before it can be read back out.
      return Number(mirror.value);
    });
  }

  /**
   * Bumped when something may have written a mirror without the slider.
   *
   * It decides nothing — the answer comes from the DOM either way — but a
   * rendered `data-dirty` has to depend on something, and a property
   * assignment invalidates nothing on its own. `change` as well as `input`
   * because a restored session fires only that one in some engines, and
   * `pageshow` because a page coming back from the bfcache fires neither.
   */
  const revision = new Signal.State(0);
  const invalidate = (): void => revision.set(revision.get() + 1);

  // Delegated from the root, because the mirrors are the consumer's `:for` to
  // render and unrender and there is no moment at which the whole set can be
  // subscribed to one by one.
  effect(() => {
    const root = options.root();
    if (!root) return;

    const onWrite = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.hasAttribute(SLIDER_INPUT_ATTRIBUTE)) invalidate();
    };

    root.addEventListener('input', onWrite);
    root.addEventListener('change', onWrite);
    window.addEventListener('pageshow', invalidate);
    onCleanup(() => {
      root.removeEventListener('input', onWrite);
      root.removeEventListener('change', onWrite);
      window.removeEventListener('pageshow', invalidate);
    });
  });

  /**
   * Dirtiness for the whole value, which is more than the field can see.
   *
   * A field measures it against the one control it validates, and that control
   * is the first thumb's mirror — so a range whose upper thumb moved reported
   * itself clean while it submitted something else, and only the first thumb
   * could ever make an unsaved-changes guard speak up. What a reset restores is
   * the array, so the array is what the comparison is over, and the field is
   * handed that answer in place of its own everywhere it publishes one.
   *
   * Two states, compared: what a submit would send, and what a reset would put
   * back. Nothing here asks which of them wrote it — a value the component
   * never wrote is still a value the form will submit, and inferring dirtiness
   * from authorship is what left a restored session reporting itself saved.
   */
  const pristine = initial.join(',');
  const isDirty = (): boolean => {
    // Read for the dependency alone: the comparison below is over the DOM,
    // which nothing else here is subscribed to.
    revision.get();
    return submitted().join(',') !== pristine;
  };

  const field: FormField = {
    ...composed,
    isDirty,
    // Clearing a record is not enough when the record is a value the form will
    // still send, and putting only the mirrors back leaves the thumb showing
    // one value under a form that submits another. Both halves go back, so a
    // field reporting itself clean is telling the truth about the submit and
    // about the thumb.
    reset: () => {
      setValues(initial);
      for (const [index, value] of initial.entries()) {
        const mirror = mirrorAt(index);
        const text = String(value);
        if (mirror && mirror.value !== text) mirror.value = text;
      }
      composed.reset();
    },
    fieldProps: () => ({ ...composed.fieldProps(), 'data-dirty': isDirty() || undefined }),
    controlProps: () => ({ ...composed.controlProps(), 'data-dirty': isDirty() || undefined }),
  };

  // The field clears its own record on reset; the value is ours to put back.
  // `reset` is dispatched partway through the platform's own algorithm, so the
  // restore is queued until after it has finished with the mirrors.
  effect(() => {
    const form = options.root()?.closest('form');
    if (!form) return;

    const onReset = () => {
      // Every mirror is about to be put back to the `value` attribute this
      // slider wrote, so whatever was written over them goes with it. The
      // value is the half the platform knows nothing about.
      queueMicrotask(() => setValues(initial));
    };
    form.addEventListener('reset', onReset);
    onCleanup(() => form.removeEventListener('reset', onReset));
  });

  /**
   * The settled value, watched, for the record the field keeps of its control.
   *
   * The field revalidates from the control's own value, and that control is a
   * mirror the consumer's `:spread` fills. Telling it from the write itself
   * therefore reported the value the gesture had just replaced — one edit
   * behind for ever. A user effect runs only after the render effects have
   * settled, which is exactly when the mirror is true again; and because this
   * watches the value rather than the calls that change it, a controlled signal
   * set from outside is an edit too.
   */
  let edited: string | null = null;
  effect(() => {
    const list = current();
    const values = list.join(',');
    untrack(() => {
      // The mirrors have just been filled from this value, so this is the
      // state the two of them agree on until one of them moves again.
      rendered = list.map((value) => String(value));
      // The first pass is the mount, which is not an edit: nothing has been
      // typed, and a validator that runs on input has nothing to run about.
      if (edited !== null && edited !== values) composed.markEdited();
    });
    edited = values;
  });

  const describedBy = (): string | undefined => text(field.controlProps()['aria-describedby']);
  const labelledBy = (): string | undefined => options.label?.()?.id || undefined;

  /** The name for one thumb of many. */
  function thumbLabel(index: number, count: number): string {
    if (count <= 1) return labels.thumb ?? 'Value';
    if (index === 0) return labels.minimum ?? 'Minimum';
    if (index === count - 1) return labels.maximum ?? 'Maximum';
    return labels.nth?.(index + 1) ?? `Value ${index + 1}`;
  }

  function thumbFrom(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null;
    const thumb = target.closest(`[${SLIDER_THUMB_ATTRIBUTE}]`);
    if (!thumb) return null;
    const index = Number(thumb.getAttribute(SLIDER_THUMB_ATTRIBUTE));
    return Number.isInteger(index) ? index : null;
  }

  return {
    values: current,
    value: () => current()[0] ?? min,
    percentFor,
    percentAt: (index) => percentFor(current()[index] ?? min),

    fill() {
      const list = current();
      // One thumb fills from the minimum, because that is what the value
      // means: everything below it is selected. Two or more fill between the
      // ends, because what is selected is the span. Both ends are read as
      // positions rather than assumed to be 0 and the thumb, so an inverted
      // track fills from the end the minimum is now at.
      const from = list.length > 1 ? percentFor(list[0] ?? min) : percentFor(min);
      const to = percentFor(list[list.length - 1] ?? min);
      return from <= to ? { start: from, end: to } : { start: to, end: from };
    },

    marks: () => marks,

    isDisabled: disabled,
    isDragging: () => dragging.get(),
    activeIndex: () => active.get(),
    orientation: () => orientation,
    direction,
    boundsAt: (index) => boundsAt(index),

    setValue,
    setValues,
    stepBy,

    field,

    onPointerDown(event) {
      // Secondary buttons open context menus, and a second finger during a
      // drag would fight the first for the same thumb.
      if (disabled() || event.button !== 0 || !event.isPrimary) return;

      const track = trackElement();
      if (!track) return;

      const list = current();
      if (list.length === 0) return;

      const onThumb = thumbFrom(event.target);
      const index = onThumb ?? nearestThumb(list, valueAt(event, track));
      // A press that landed on a thumb picks it up where it is; a press on the
      // track moves the nearest thumb to it first, so the value follows the
      // pointer from the very first frame rather than after the first move.
      if (onThumb === null) setValue(index, valueAt(event, track));

      active.set(index);
      // Focus follows the pointer, so the arrows carry on from the thumb the
      // user just dragged. Prevented first because a press would otherwise
      // start a text selection that fights the drag.
      event.preventDefault();
      thumbAt(index)?.focus();

      beginDrag(event.pointerId, index, track);
    },

    onKeyDown(event) {
      if (disabled()) return false;
      // A modified key is a shortcut, not a nudge.
      if (event.ctrlKey || event.metaKey || event.altKey) return false;

      const index = thumbFrom(event.target) ?? active.get();
      if (index === null) return false;

      const rtl = direction() === 'rtl';
      const upKey = rtl ? 'ArrowLeft' : 'ArrowRight';
      const downKey = rtl ? 'ArrowRight' : 'ArrowLeft';
      const [low, high] = boundsAt(index);

      switch (event.key) {
        case 'ArrowUp':
        case upKey:
          stepBy(index, 1);
          break;
        case 'ArrowDown':
        case downKey:
          stepBy(index, -1);
          break;
        case 'PageUp':
          stepBy(index, pageSteps);
          break;
        case 'PageDown':
          stepBy(index, -pageSteps);
          break;
        // Home and End take the thumb to the ends of *its* range, not the
        // slider's, so neither can push a thumb through its neighbour.
        case 'Home':
          setValue(index, low);
          break;
        case 'End':
          setValue(index, high);
          break;
        default:
          return false;
      }

      // The arrows and Page keys scroll the page, and Home and End jump it to
      // an end — all of which would happen behind a slider that had already
      // handled them.
      event.preventDefault();
      active.set(index);
      field.markTouched();
      // Committed per press: a key is a whole gesture, unlike a drag.
      commit();
      return true;
    },

    rootProps: () => ({
      ...field.fieldProps(),
      id: sliderId,
      // A group rather than a `slider`: the role belongs to each thumb, and a
      // group is what gives the set of them one name.
      role: 'group',
      'aria-labelledby': labelledBy(),
      'data-orientation': orientation,
      'data-direction': direction(),
      // Positions already account for inversion, so this is for decoration a
      // percentage cannot carry: the direction a gradient runs, which end a
      // scale is numbered from.
      'data-inverted': inverted || undefined,
      'data-dragging': dragging.get() || undefined,
    }),

    // No `for`: it would point at the mirror input, and a press on the words
    // would then focus a control that is one clipped pixel wide instead of the
    // thumb the user can see. The thumbs name themselves from this element
    // through `aria-labelledby` instead.
    labelProps: () => ({ id: field.ids().label }),

    trackProps: () => ({
      'data-orientation': orientation,
      'data-direction': direction(),
      'data-inverted': inverted || undefined,
      'data-disabled': disabled() || undefined,
    }),

    rangeProps: () => ({
      'data-orientation': orientation,
      'data-inverted': inverted || undefined,
      'data-disabled': disabled() || undefined,
    }),

    thumbProps(index) {
      const list = current();
      const value = list[index] ?? min;
      const [low, high] = boundsAt(index, list);
      const single = list.length <= 1;
      const named = labelledBy();

      return {
        [SLIDER_THUMB_ATTRIBUTE]: String(index),
        id: thumbId(index),
        role: 'slider',
        // The neighbour's position, not the slider's end: these are the values
        // this thumb can actually take.
        'aria-valuemin': String(low),
        'aria-valuemax': String(high),
        'aria-valuenow': String(value),
        'aria-valuetext': options.valueText?.(value, index) ?? locale.format.number(value),
        // Written even for the horizontal default, because the whole keyboard
        // map hangs off it and a user who cannot see the track has no other
        // way to know which arrows will do anything.
        'aria-orientation': orientation,
        // A single thumb borrows the slider's own label; the thumbs of a range
        // each need a name of their own, and "Minimum" beside a group called
        // "Price" is how a screen reader says which end this is.
        'aria-labelledby': single && named ? named : undefined,
        'aria-label': single && named ? undefined : thumbLabel(index, list.length),
        'aria-describedby': describedBy(),
        'aria-invalid': field.isInvalid() ? 'true' : undefined,
        // `aria-disabled`, never the `disabled` attribute: a disabled thumb
        // stays reachable, so a keyboard user can find out it is unavailable
        // rather than watch it vanish from the tab order.
        'aria-disabled': disabled() ? 'true' : undefined,
        'data-index': String(index),
        'data-orientation': orientation,
        'data-active': active.get() === index || undefined,
        'data-disabled': disabled() || undefined,
        tabindex: '0',
      };
    },

    inputProps(index) {
      const props: Record<string, string | number | boolean | undefined> = {
        [SLIDER_INPUT_ATTRIBUTE]: String(index),
        // A range rather than a hidden input: the platform then range-checks
        // the value, and `form.reset()` has a control to reset.
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(current()[index] ?? min),
        // The `value` content attribute, which is the only thing `form.reset()`
        // restores — the line above writes a property, and a property is not a
        // default. Without it the platform resets a range input with no
        // attribute to the midpoint of its bounds, so a reset that changed
        // nothing would leave the mirrors submitting 50 under a slider showing
        // 20. The reset listener below cannot cover that case on its own,
        // because putting back a value the slider already has is a no-op.
        defaultValue: String(initial[index] ?? min),
        disabled: disabled(),
        // Reachable to the platform, invisible to assistive technology and to
        // Tab: the thumb carries the role and the tab stop, and announcing
        // both would announce every thumb twice. The cost is that a constraint
        // failure here would have nowhere to show itself — which cannot
        // happen, because every value is clamped into range before it is
        // written.
        tabindex: '-1',
        'aria-hidden': 'true',
        style: VISUALLY_HIDDEN_INPUT_STYLE,
      };

      // The field's ids belong to the control it was given, which is this one.
      if (index === 0) props.id = field.ids().control;
      // Omitted rather than set to undefined: `name` is a property on an
      // input, and assigning undefined to it submits the string "undefined".
      if (options.name !== undefined) props.name = options.name;

      return props as SliderProps;
    },

    markProps(mark) {
      const value = typeof mark === 'number' ? mark : mark.value;
      const list = current();
      const first = list[0] ?? min;
      const last = list[list.length - 1] ?? min;
      const within = list.length > 1 ? value >= first && value <= last : value <= last;

      return {
        'data-value': String(value),
        'data-percent': String(percentFor(value)),
        'data-state': within ? 'active' : 'inactive',
        'data-orientation': orientation,
      };
    },

    descriptionProps: () => field.descriptionProps(),
    errorMessageProps: () => field.errorMessageProps(),
  };
}

/** Ticks as objects, in order, with anything outside the range dropped. */
function normaliseMarks(
  marks: readonly (number | SliderMark)[] | undefined,
  min: number,
  max: number,
): readonly SliderMark[] {
  if (!marks) return [];
  return marks
    .map((mark) => (typeof mark === 'number' ? { value: mark } : mark))
    .filter((mark) => Number.isFinite(mark.value) && mark.value >= min && mark.value <= max)
    .sort((a, b) => a.value - b.value);
}

/** The nearest of a sorted list. */
function nearestValue(values: readonly number[], value: number): number {
  let best = values[0] ?? value;
  let distance = Math.abs(best - value);
  for (const candidate of values) {
    const next = Math.abs(candidate - value);
    if (next < distance) {
      best = candidate;
      distance = next;
    }
  }
  return best;
}

/** How many decimals a number is written with, which is the precision to keep. */
function decimalsOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const parts = String(value).split('.');
  return parts[1]?.length ?? 0;
}

function roundTo(value: number, decimals: number): number {
  return decimals > 0 ? Number(value.toFixed(decimals)) : Math.round(value);
}

// ===========================================================================
// File upload
// ===========================================================================

/** Where one file is. */
export type UploadStatus =
  /** Accepted, waiting to be sent. */
  | 'pending'
  | 'uploading'
  | 'success'
  /** The transport gave up. Retryable. */
  | 'error'
  /** The user stopped it. Retryable. */
  | 'cancelled'
  /** Never accepted, so never sent. Not retryable. */
  | 'rejected';

/** Why a file was refused or an upload failed. */
export type UploadErrorCode =
  /** Not one of the types `accept` allows. */
  | 'type'
  /** Bigger than `maxSize`. */
  | 'size'
  /** Over `maxFiles`. */
  | 'count'
  /** Refused by the consumer's own `validate`. */
  | 'custom'
  /** Accepted, but the request failed. */
  | 'transport';

export interface UploadError {
  readonly code: UploadErrorCode;
  readonly message: string;
  /** Whatever the transport threw, for a consumer that wants the status code. */
  readonly cause?: unknown;
}

/** One file's whole life, from picked to sent. */
export interface UploadItem {
  readonly id: string;
  readonly file: File;
  /** Its path inside a dropped directory, or just its name. */
  readonly path: string;
  readonly status: UploadStatus;
  /** Bytes the transport has confirmed sent. */
  readonly loaded: number;
  readonly total: number;
  /** 0–100, so it can go straight into a progress bar. */
  readonly progress: number;
  readonly error: UploadError | null;
  /** Whatever the transport returned, once it succeeded. */
  readonly response: unknown;
  /** How many times this file has been sent at, including the attempt running now. */
  readonly attempts: number;
  /** Chunks the server has taken, which is where a retry resumes from. */
  readonly chunk: number;
}

/** The slice of a chunked upload a request is carrying. */
export interface UploadChunk {
  readonly index: number;
  readonly count: number;
  readonly start: number;
  /** Exclusive, as `Blob.slice` takes it. */
  readonly end: number;
}

export interface UploadRequest {
  readonly file: File;
  readonly item: UploadItem;
  /** What to send: the whole file, or one chunk of it. */
  readonly body: Blob;
  /** Null when the file is going up in one piece. */
  readonly chunk: UploadChunk | null;
  readonly signal: AbortSignal;
  /** Bytes of `body` — not of the file — sent so far. */
  readonly progress: (loaded: number) => void;
}

/**
 * How bytes actually leave the page.
 *
 * A function rather than a URL, because the interesting half of uploading is
 * always the part a library cannot guess: a signed URL fetched per file, a
 * multipart upload to object storage, a mutation through a GraphQL client. The
 * two that ship — `xhrTransport` and `fetchTransport` — are the common cases,
 * not the only ones.
 */
export type UploadTransport = (request: UploadRequest) => Promise<unknown>;

/** What a consumer's `validate` may say. A bare string is a `custom` refusal. */
export type UploadRejection = string | { readonly code: UploadErrorCode; readonly message: string };

export interface FileUploadLabels {
  /** Names the drop zone, which has no text of its own until the consumer writes some. */
  dropZone?: string;
  /** Names the aggregate progress bar. */
  progress?: string;
  /** Names one file's progress bar. */
  itemProgress?: (item: UploadItem) => string;
  cancel?: (item: UploadItem) => string;
  retry?: (item: UploadItem) => string;
  remove?: (item: UploadItem) => string;
  /** Why a file was refused. */
  typeRejected?: (file: File, accept: string) => string;
  sizeRejected?: (file: File, maxSize: number) => string;
  countRejected?: (file: File, maxFiles: number) => string;
  /** Why an upload failed. */
  uploadFailed?: (file: File, error: unknown) => string;
  /** Refuses the submit while files are still going up. */
  busy?: string;
  /** What the live region says. */
  announceProgress?: (done: number, total: number) => string;
  announceComplete?: (total: number) => string;
  announceFailed?: (failed: number) => string;
}

export interface FileUploadOptions {
  /**
   * The `<input type="file">`. It is the control the form field validates, the
   * only keyboard route to the file picker, and what makes the files part of a
   * native submit — a drop zone alone can do none of those.
   */
  input: () => Element | null | undefined;
  /**
   * The drop zone, if there is one. Supplying it scopes `onKeyDown`, so a
   * handler wired further up than the zone does not swallow Enter from the
   * fields underneath it.
   */
  dropZone?: () => Element | null | undefined;
  /** A live region for progress announcements, so they are not announced too early. */
  liveRegion?: () => Element | null | undefined;

  /**
   * Supply a signal to own the queue from outside — a store that outlives this
   * component, most often. Without one the upload owns it.
   */
  queue?: Signal.State<readonly UploadItem[]>;

  /**
   * Without one nothing is ever sent and the queue is only a queue, which is
   * what a form that submits its files through the input itself wants.
   */
  transport?: UploadTransport;
  /** Start uploading as soon as files are added. Default true. */
  auto?: boolean;
  /** How many files go up at once. Default 3. */
  concurrency?: number;
  /**
   * Split each file into chunks of this many bytes.
   *
   * Chunking is what makes an upload resumable: a failure costs one chunk
   * rather than the whole file, and a retry carries on from the last chunk the
   * server took. It costs one request per chunk, so it is off by default.
   */
  chunkSize?: number;
  /**
   * Ask the server how many bytes it already has before starting, so an upload
   * interrupted in an earlier session resumes rather than restarts. Only
   * consulted for a chunked upload — there is nothing to resume onto without
   * chunks.
   */
  resumeFrom?: (item: UploadItem) => number | Promise<number>;
  /** Attempts after a failure. Default 0. */
  retries?: number;
  /** Milliseconds before retry `attempt` (1 for the first). Default `exponentialBackoff`. */
  retryDelay?: (attempt: number, error: unknown) => number;

  /** The `accept` syntax: ".png,image/*". Empty allows everything. */
  accept?: string;
  /** In bytes. */
  maxSize?: number;
  /** Across the whole queue, not per drop. */
  maxFiles?: number;
  /** Default true. */
  multiple?: boolean;
  /** Pick whole directories, and walk the ones that are dropped. */
  directory?: boolean;
  /** How deep a dropped directory is walked. Default 8. */
  maxDirectoryDepth?: number;
  /** Refuse a file for a reason of your own. Return nothing to accept it. */
  validate?: (file: File) => UploadRejection | null | undefined | void;

  /** Take files pasted anywhere on the page. */
  paste?: boolean;
  /** Take a drop anywhere on the page, not only on the drop zone. */
  fullPage?: boolean;

  disabled?: () => boolean;
  required?: () => boolean;
  /**
   * Refuse a submit while files are still going up. Default true: a form that
   * posts half an upload is worse than one that makes the user wait.
   */
  blockSubmitWhileBusy?: boolean;

  /** Passed through to the form field, which owns the ARIA between them. */
  label?: () => Element | null | undefined;
  description?: () => Element | null | undefined;
  errorMessage?: () => Element | null | undefined;

  labels?: FileUploadLabels;

  onFilesAdded?: (items: readonly UploadItem[]) => void;
  onReject?: (file: File, error: UploadError) => void;
  onItemProgress?: (item: UploadItem) => void;
  onItemComplete?: (item: UploadItem) => void;
  onItemError?: (item: UploadItem) => void;
  /** Every upload has finished, one way or another. */
  onComplete?: (items: readonly UploadItem[]) => void;
}

export interface FileUpload {
  items(): readonly UploadItem[];
  item(id: string): UploadItem | undefined;
  /** How many files are in each state. */
  counts(): Readonly<Record<UploadStatus, number>>;

  /** 0–100 across every file that is going up or has gone up. */
  progress(): number;
  loadedBytes(): number;
  totalBytes(): number;
  isUploading(): boolean;
  /** A file is being dragged over the drop zone. */
  isDragging(): boolean;
  /** A file is being dragged anywhere over the page. */
  isPageDragging(): boolean;
  /** What the live region should say, or '' while it is too early to say it. */
  announcement(): string;

  /** The form field this composes, for validation and submit blocking. */
  readonly field: FormField;

  /** Validate and enqueue. Returns the items added, rejections included. */
  add(files: Iterable<File>): readonly UploadItem[];
  /** Start everything pending. Only needed when `auto` is off. */
  upload(): void;
  uploadItem(id: string): void;
  cancel(id: string): void;
  cancelAll(): void;
  retry(id: string): void;
  retryFailed(): void;
  remove(id: string): void;
  clear(): void;
  /** Open the file picker. */
  open(): void;

  onInputChange(event: Event): void;
  onDragEnter(event: DragEvent): void;
  onDragOver(event: DragEvent): void;
  onDragLeave(event: DragEvent): void;
  onDrop(event: DragEvent): void;
  onPaste(event: ClipboardEvent): void;
  /** Enter or Space on the drop zone. Returns true when the key was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;

  rootProps(): FileUploadProps;
  dropZoneProps(): FileUploadProps;
  inputProps(): FileUploadProps;
  triggerProps(): FileUploadProps;
  labelProps(): FileUploadProps;
  descriptionProps(): FileUploadProps;
  errorMessageProps(): FileUploadProps;
  itemProps(item: UploadItem): FileUploadProps;
  itemProgressProps(item: UploadItem): FileUploadProps;
  progressProps(): FileUploadProps;
  liveRegionProps(): FileUploadProps;
  cancelProps(item: UploadItem): FileUploadProps;
  retryProps(item: UploadItem): FileUploadProps;
  removeProps(item: UploadItem): FileUploadProps;
}

const EMPTY_COUNTS: Readonly<Record<UploadStatus, number>> = {
  pending: 0,
  uploading: 0,
  success: 0,
  error: 0,
  cancelled: 0,
  rejected: 0,
};

/**
 * A file upload: the whole lifecycle, not a picker.
 *
 *   class Attachments {
 *     input = new Signal.State<Element | null>(null);
 *     zone = new Signal.State<Element | null>(null);
 *     upload = createFileUpload({
 *       input: () => this.input.get(),
 *       dropZone: () => this.zone.get(),
 *       transport: xhrTransport({ url: '/api/files' }),
 *       accept: 'image/*',
 *       maxSize: 5_000_000,
 *     });
 *   }
 *
 *   <div :spread="upload.rootProps()">
 *     <label :ref="label" :spread="upload.labelProps()">Attachments</label>
 *     <div :ref="zone" :spread="upload.dropZoneProps()"
 *          :dragenter="upload.onDragEnter($event)" :dragover="upload.onDragOver($event)"
 *          :dragleave="upload.onDragLeave($event)" :drop="upload.onDrop($event)"
 *          :keydown="upload.onKeyDown($event)" :click="upload.open()">Drop files here</div>
 *     <input :ref="input" :spread="upload.inputProps()" :change="upload.onInputChange($event)">
 *     <ul>
 *       <li :for="item of upload.items()" :key="item.id" :spread="upload.itemProps(item)">
 *         { item.file.name }
 *         <div :spread="upload.itemProgressProps(item)"></div>
 *         <button :spread="upload.cancelProps(item)" :click="upload.cancel(item.id)">×</button>
 *       </li>
 *     </ul>
 *     <div class="sr-only" :ref="live" :spread="upload.liveRegionProps()">
 *       { upload.announcement() }
 *     </div>
 *   </div>
 *
 * Four decisions are worth stating outright.
 *
 * **The input is not optional.** A drop zone cannot be reached from a keyboard
 * and cannot be reached by a screen reader at all; the only accessible way to
 * choose a file is the platform's own picker, and the only thing that opens it
 * is a real `<input type="file">`. Dragging is the shortcut, not the mechanism.
 *
 * **Rejected files stay in the queue.** A file that silently fails to appear
 * is the worst possible answer to "why isn't my photo uploading" — so a
 * refusal is an item with a status and a reason code, and it is listed beside
 * the files that were taken.
 *
 * **Progress is announced by events, not by bytes.** The live region says
 * something when a file finishes or fails, never on the way — a percentage
 * read aloud four times a second is not information.
 *
 * **The transport is asked for one body at a time.** Chunking, concurrency,
 * retries and resumption are all decided here, and the transport only ever
 * sees "send these bytes, report progress, honour this signal". That is what
 * lets a twenty-line `fetch` transport get resumable uploads for free.
 */
export function createFileUpload(options: FileUploadOptions): FileUpload {
  const locale = useLocale();
  const labels = options.labels ?? {};
  const auto = options.auto !== false;
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const chunkSize = options.chunkSize && options.chunkSize > 0 ? options.chunkSize : 0;
  const retries = Math.max(0, options.retries ?? 0);
  const retryDelay: (attempt: number, error: unknown) => number =
    options.retryDelay ?? ((attempt) => exponentialBackoff(attempt));
  const maxDepth = Math.max(0, options.maxDirectoryDepth ?? 8);
  const multiple = options.multiple !== false;

  const uploadId = createId('upload');
  const disabled = () => options.disabled?.() ?? false;

  const queue = options.queue ?? new Signal.State<readonly UploadItem[]>([]);
  const dragging = new Signal.State(false);
  const pageDragging = new Signal.State(false);
  const finished = new Signal.State('');

  /**
   * The gate the announcement waits behind.
   *
   * Only armed when a region was actually named. Wrapping the optional
   * accessor in an always-defined one instead leaves the timing waiting for an
   * element that never arrives, and the announcement is then '' for the life
   * of the page — including for a consumer who spread `liveRegionProps` onto a
   * region of their own and never passed the accessor. Silence for a message
   * that is on the screen is a worse failure than one announced a little
   * early, which is the rule the rest of the library follows.
   */
  const timing: LiveRegionTiming = options.liveRegion
    ? createLiveRegionTiming(options.liveRegion)
    : { isReady: () => true };

  /** In-flight requests, by item id. */
  const controllers = new Map<string, AbortController>();
  /** Items the user has asked to send, which is not the same as items in the queue. */
  const wanted = new Set<string>();
  /** Pending retry waits, so unmounting does not leave one running. */
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /**
   * In-flight requests.
   *
   * A signal rather than a plain counter because `data-uploading` is rendered
   * from it: a number read once is never read again, so removing the last file
   * mid-flight left the attribute standing over an empty queue for the life of
   * the page. The queue's own arithmetic reads it through `inFlight`, which
   * subscribes nothing — `pump` runs inside whatever effect a consumer called
   * `upload()` from, and has no business waking it.
   */
  const active = new Signal.State(0);
  const inFlight = (): number => untrack(() => active.get());
  /**
   * Latched on teardown.
   *
   * Aborting the controllers is not enough on its own: every abort rejects a
   * transport, and every rejection runs `run`'s own `finally`, which pumps the
   * queue again. Emptying `wanted` there would stop the files queued at that
   * moment; this also stops a `retry` or an `upload` called by a handler that
   * outlived the component.
   */
  let stopped = false;

  // -------------------------------------------------------------------------
  // Queue
  // -------------------------------------------------------------------------

  const items = () => queue.get();
  const find = (id: string) => untrack(items).find((item) => item.id === id);

  function replace(next: readonly UploadItem[]): void {
    queue.set(next);
  }

  /** Update one item, if it is still in the queue at all. */
  function patch(id: string, changes: Partial<UploadItem>): UploadItem | undefined {
    const list = untrack(items);
    const index = list.findIndex((item) => item.id === id);
    const previous = list[index];
    if (!previous) return undefined;

    const merged: UploadItem = { ...previous, ...changes };
    const next: UploadItem = { ...merged, progress: percentOf(merged) };
    const out = [...list];
    out[index] = next;
    replace(out);
    return next;
  }

  function percentOf(item: UploadItem): number {
    if (item.status === 'success') return 100;
    // A zero-byte file has no ratio to report; anything but 100 on success
    // would leave its bar stuck short of the end for ever.
    if (item.total <= 0) return 0;
    return clamp((item.loaded / item.total) * 100, 0, 100);
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  function rejectionFor(file: File, accepted: number): UploadError | null {
    const maxFiles = options.maxFiles;
    if (maxFiles !== undefined && accepted >= maxFiles) {
      return {
        code: 'count',
        message:
          labels.countRejected?.(file, maxFiles) ??
          `No more than ${locale.format.number(maxFiles)} files can be uploaded.`,
      };
    }

    const accept = options.accept;
    if (accept && !matchesAccept(file, accept)) {
      return {
        code: 'type',
        message: labels.typeRejected?.(file, accept) ?? `${file.name} is not an accepted file type.`,
      };
    }

    const maxSize = options.maxSize;
    if (maxSize !== undefined && file.size > maxSize) {
      return {
        code: 'size',
        message:
          labels.sizeRejected?.(file, maxSize) ??
          `${file.name} is larger than ${locale.format.bytes(maxSize)}.`,
      };
    }

    const custom = options.validate?.(file);
    if (custom) {
      return typeof custom === 'string' ? { code: 'custom', message: custom } : custom;
    }

    return null;
  }

  /** Files already occupying one of the `maxFiles` places. */
  const occupied = (list: readonly UploadItem[]): number =>
    list.filter((item) => item.status !== 'rejected').length;

  /**
   * Put the queue back into the input's own list of selected files.
   *
   * That list is what makes a file part of a native submit and the only thing
   * `required` counts — and a drop or a paste never goes near it, while the
   * picker's list holds only the last pick rather than the queue. Emptying the
   * input was what stood here, to make picking the same file twice raise
   * `change` again; per the HTML spec that empties the platform's selected
   * files, which un-submits every file already chosen and leaves a required
   * upload impossible to satisfy. Rewriting the list from the queue buys the
   * same thing honestly: a file that has left the queue leaves the input with
   * it, so picking it again is a change again.
   */
  function syncInput(): void {
    const input = options.input();
    if (input instanceof HTMLInputElement && input.type === 'file') {
      const data = new DataTransfer();
      // Refused files are listed so the user can read why; they are never sent
      // and must never be submitted.
      for (const item of untrack(items)) {
        if (item.status !== 'rejected') data.items.add(item.file);
      }
      input.files = data.files;
    }
    // Assigning the list raises no event, and neither does a drop, so the
    // field is told by hand: it measures dirtiness and revalidates from the
    // control's own events.
    field.markEdited();
  }

  function add(files: Iterable<File>): readonly UploadItem[] {
    if (disabled()) return [];

    const list = [...untrack(items)];
    // A single-file upload is about to drop everything it holds, so what it
    // holds does not occupy a place: counting it refuses the replacement and
    // leaves the queue with a rejected item and nothing to submit.
    let accepted = multiple ? occupied(list) : 0;
    const added: UploadItem[] = [];

    for (const file of files) {
      // A single-file upload replaces rather than appends: the input it stands
      // for holds one file, and a queue of five under a control that submits
      // one of them is a lie about what will be sent.
      if (!multiple && added.length > 0) break;

      const error = rejectionFor(file, accepted);
      const item: UploadItem = {
        id: createId('upload-item'),
        file,
        path: relativePathOf(file),
        status: error ? 'rejected' : 'pending',
        loaded: 0,
        total: file.size,
        progress: 0,
        error,
        response: undefined,
        attempts: 0,
        chunk: 0,
      };

      if (error) options.onReject?.(file, error);
      else accepted += 1;

      added.push(item);
    }

    if (added.length === 0) return [];

    // Replacing is a removal, and has to do everything `remove` does. A file
    // dropped from the queue without being cancelled goes on holding its
    // concurrency slot and sending bytes for a file the user has changed their
    // mind about — and once it is out of `items()` nothing can reach it, not
    // even `cancelAll`, which iterates the queue.
    if (!multiple) {
      for (const item of list) {
        cancel(item.id);
        bars.delete(item.id);
      }
    }

    const kept = multiple ? [...list, ...added] : added;
    replace(kept);

    if (auto) for (const item of added) if (item.status === 'pending') wanted.add(item.id);

    options.onFilesAdded?.(added);
    syncInput();
    pump();

    return added;
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  function pump(): void {
    if (stopped) return;
    const transport = options.transport;
    if (!transport) return;

    while (inFlight() < concurrency) {
      const next = untrack(items).find((item) => item.status === 'pending' && wanted.has(item.id));
      if (!next) return;
      void run(next.id, transport);
    }
  }

  function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        resolve();
      }, ms);
      timers.add(timer);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          timers.delete(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  /** Send one file, retries and all. */
  async function run(id: string, transport: UploadTransport): Promise<void> {
    const controller = new AbortController();
    controllers.set(id, controller);
    active.set(inFlight() + 1);
    // Claimed before the first await, so a second pass of `pump` in the same
    // tick cannot pick the same item up again.
    patch(id, { status: 'uploading', error: null });

    try {
      for (let attempt = 1; ; attempt++) {
        patch(id, { attempts: attempt });
        try {
          const response = await send(id, transport, controller.signal);
          const done = patch(id, {
            status: 'success',
            loaded: find(id)?.total ?? 0,
            response,
            error: null,
          });
          if (done) options.onItemComplete?.(done);
          return;
        } catch (error) {
          if (controller.signal.aborted) {
            // Cancelling is not failing, and the bytes already sent are worth
            // keeping: a chunked upload resumes from them.
            patch(id, { status: 'cancelled', error: null });
            return;
          }
          if (attempt > retries) {
            const failed = patch(id, {
              status: 'error',
              error: {
                code: 'transport',
                message:
                  labels.uploadFailed?.(find(id)?.file ?? new File([], ''), error) ??
                  messageOf(error),
                cause: error,
              },
            });
            if (failed) options.onItemError?.(failed);
            return;
          }
          await wait(retryDelay(attempt, error), controller.signal);
          if (controller.signal.aborted) {
            patch(id, { status: 'cancelled', error: null });
            return;
          }
        }
      }
    } finally {
      active.set(inFlight() - 1);
      controllers.delete(id);
      wanted.delete(id);
      announce();
      pump();
    }
  }

  /** One attempt: the whole file, or every chunk of it that is still missing. */
  async function send(id: string, transport: UploadTransport, signal: AbortSignal): Promise<unknown> {
    const item = find(id);
    if (!item) return undefined;
    const { file } = item;

    const report = (loaded: number) => {
      const updated = patch(id, { loaded });
      if (updated) options.onItemProgress?.(updated);
    };

    if (chunkSize <= 0) {
      report(0);
      return transport({
        file,
        item,
        body: file,
        chunk: null,
        signal,
        progress: (loaded) => report(clamp(loaded, 0, file.size)),
      });
    }

    const count = Math.max(1, Math.ceil(file.size / chunkSize));
    const resumeBytes = options.resumeFrom ? await options.resumeFrom(item) : item.chunk * chunkSize;
    // `resumeFrom` is handed no signal and so cannot be cancelled; a cancel
    // that lands while the server is being asked has to be caught on the way
    // out instead.
    signal.throwIfAborted();
    let index = clamp(Math.floor((Number.isFinite(resumeBytes) ? resumeBytes : 0) / chunkSize), 0, count);

    patch(id, { chunk: index, loaded: Math.min(index * chunkSize, file.size) });

    let response: unknown;
    for (; index < count; index++) {
      // Thrown rather than broken out of. Leaving the loop returns the last
      // chunk's response as though the file were finished, and `run` then
      // records a success: the bar reads 100%, `onItemComplete` fires for a
      // file that is half on the server, and the submit-blocking effect clears
      // its custom validity so the form goes.
      signal.throwIfAborted();

      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      response = await transport({
        file,
        item: find(id) ?? item,
        body: file.slice(start, end),
        chunk: { index, count, start, end },
        signal,
        // Progress within a chunk is progress within the file, so the bar does
        // not sit still for a whole chunk and then jump.
        progress: (loaded) => report(start + clamp(loaded, 0, end - start)),
      });
      // Committed only once the server has taken it, which is what makes the
      // resume point trustworthy.
      patch(id, { chunk: index + 1, loaded: end });
    }
    return response;
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  function cancel(id: string): void {
    wanted.delete(id);
    const controller = controllers.get(id);
    if (controller) {
      controller.abort();
      return;
    }
    // Never started, so there is no request to abort — only a place in the
    // queue to give up.
    const item = find(id);
    if (item?.status === 'pending') patch(id, { status: 'cancelled' });
  }

  function cancelAll(): void {
    for (const item of untrack(items)) cancel(item.id);
  }

  function uploadItem(id: string): void {
    const item = find(id);
    if (!item || item.status === 'rejected' || item.status === 'uploading') return;
    if (item.status !== 'pending') patch(id, { status: 'pending', error: null });
    wanted.add(id);
    pump();
  }

  function retry(id: string): void {
    const item = find(id);
    // A rejection is a fact about the file, not about the request: sending it
    // again would fail in exactly the same way.
    if (!item || item.status === 'rejected') return;
    // A request that is still running has nothing to retry, and `retryProps`
    // already says so with `aria-disabled` — but an aria-disabled button still
    // fires its click, so this is one press away in every consumer. Without
    // the guard the press starts a second request for the same file and
    // overwrites the controller the first one is cancelled through, leaving a
    // live upload nothing can stop. Cancelling and restarting was the
    // alternative; it throws away the bytes already sent to honour a press the
    // interface had marked unavailable.
    if (item.status === 'uploading') return;
    patch(id, { status: 'pending', error: null, attempts: 0 });
    wanted.add(id);
    pump();
  }

  function remove(id: string): void {
    cancel(id);
    bars.delete(id);
    replace(untrack(items).filter((item) => item.id !== id));
    syncInput();
  }

  function clearAll(): void {
    cancelAll();
    bars.clear();
    replace([]);
    finished.set('');
    syncInput();
  }

  // Requests outlive nothing: the controllers live here, so a component that
  // goes away takes its uploads with it. An upload that must survive the UI
  // belongs to something above it, which is what the `queue` option is for —
  // and it would still need its own transport.
  onCleanup(() => {
    stopped = true;
    // Before the aborts, or the first rejection restarts the queue from under
    // the loop below.
    wanted.clear();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
  });

  // -------------------------------------------------------------------------
  // Aggregates
  // -------------------------------------------------------------------------

  /** Files that count towards the total: not the ones that were never taken. */
  const counted = (): readonly UploadItem[] =>
    items().filter((item) => item.status !== 'rejected' && item.status !== 'cancelled');

  const loadedBytes = () => counted().reduce((sum, item) => sum + item.loaded, 0);
  const totalBytes = () => counted().reduce((sum, item) => sum + item.total, 0);

  function aggregate(): number {
    const total = totalBytes();
    if (total <= 0) {
      const list = counted();
      // Nothing but zero-byte files, which are either all done or all waiting.
      return list.length > 0 && list.every((item) => item.status === 'success') ? 100 : 0;
    }
    return clamp((loadedBytes() / total) * 100, 0, 100);
  }

  function counts(): Readonly<Record<UploadStatus, number>> {
    const out = { ...EMPTY_COUNTS };
    for (const item of items()) out[item.status] += 1;
    return out;
  }

  const isUploading = () =>
    items().some((item) => item.status === 'uploading') || active.get() > 0;

  /**
   * The aggregate bar, and one per file.
   *
   * `createProgress` owns the progressbar role and its arithmetic, so the
   * numbers are pushed into it rather than re-derived here. Each bar is given
   * its own state signal because a progress takes a signal, not a getter.
   */
  const total = new Signal.State<number | null>(0);
  const overall = createProgress({
    value: total,
    label: labels.progress ?? 'Upload progress',
    valueText: (value) => locale.format.percent(value / 100),
  });

  const bars = new Map<string, { value: Signal.State<number | null>; progress: Progress }>();

  function barFor(item: UploadItem): Progress {
    const existing = bars.get(item.id);
    if (existing) return existing.progress;

    const value = new Signal.State<number | null>(item.progress);
    const progress = createProgress({
      value,
      label: labels.itemProgress?.(item) ?? `Uploading ${item.file.name}`,
      valueText: (percent) =>
        `${locale.format.percent(percent / 100)} of ${locale.format.bytes(item.total)}`,
    });
    bars.set(item.id, { value, progress });
    return progress;
  }

  // One effect keeps every bar in step, rather than each prop object writing a
  // signal while it is being read — which is how a render loop starts.
  effect(() => {
    const list = items();
    total.set(aggregate());
    for (const item of list) {
      const bar = bars.get(item.id);
      if (bar) bar.value.set(item.progress);
    }
  });

  // -------------------------------------------------------------------------
  // Announcements
  // -------------------------------------------------------------------------

  function announce(): void {
    const list = untrack(items);
    const done = list.filter((item) => item.status === 'success').length;
    const failed = list.filter((item) => item.status === 'error').length;
    const expected = list.filter((item) => item.status !== 'rejected' && item.status !== 'cancelled')
      .length;

    if (expected === 0) {
      finished.set('');
      return;
    }

    if (done + failed < expected) {
      finished.set(
        labels.announceProgress?.(done, expected) ?? `${done} of ${expected} files uploaded`,
      );
      return;
    }

    finished.set(
      failed > 0
        ? (labels.announceFailed?.(failed) ?? `${failed} of ${expected} files failed to upload`)
        : (labels.announceComplete?.(expected) ?? `${expected} files uploaded`),
    );
    options.onComplete?.(list);
  }

  // -------------------------------------------------------------------------
  // Form field
  // -------------------------------------------------------------------------

  const field: FormField = createFormField({
    control: options.input,
    label: options.label,
    description: options.description,
    errorMessage: options.errorMessage,
    required: options.required,
    disabled: options.disabled,
  });

  /**
   * Push the queue's verdict into the platform.
   *
   * A form whose upload has failed, or has not finished, must not submit —
   * and the only way to stop it that also covers a submit the consumer never
   * wrote a handler for is the control's own validity.
   */
  effect(() => {
    const list = items();
    const busy = list.some((item) => item.status === 'uploading' || item.status === 'pending');
    const rejected = list.find((item) => item.status === 'rejected' || item.status === 'error');

    if (rejected?.error) field.setCustomValidity(rejected.error.message);
    else if (busy && options.blockSubmitWhileBusy !== false) {
      field.setCustomValidity(labels.busy ?? 'Wait for the upload to finish.');
    } else field.setCustomValidity('');
  });

  // -------------------------------------------------------------------------
  // Files arriving
  // -------------------------------------------------------------------------

  /** Everything a `DataTransfer` holds, directories walked if we were asked to. */
  async function collect(data: DataTransfer | null): Promise<File[]> {
    if (!data) return [];

    if (options.directory) {
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < data.items.length; i++) {
        const entry = data.items[i]?.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.length > 0) return walkEntries(entries, maxDepth);
    }

    // `FileList` is array-like and not iterable, so it is walked by index.
    const files: File[] = [];
    for (let i = 0; i < data.files.length; i++) {
      const file = data.files[i];
      if (file) files.push(file);
    }
    return files;
  }

  /**
   * Drops this upload has already taken.
   *
   * `stopPropagation` cannot do this job: Volt delegates `drop`, so the zone's
   * handler and the page-wide listener are two listeners on the same node, and
   * stopping propagation never reaches a sibling. The event object is the only
   * thing that identifies one drop to both of them.
   */
  const taken = new WeakSet<Event>();

  function acceptDrop(event: DragEvent): void {
    // Without this the browser navigates to the file, replacing the page.
    event.preventDefault();
    // Cancelled first, and only then refused: the second listener still has to
    // stop the navigation, it just must not queue the files twice.
    if (taken.has(event)) return;
    taken.add(event);

    dragging.set(false);
    pageDragging.set(false);
    pageDepth = 0;
    if (disabled()) return;
    void collect(event.dataTransfer).then((files) => {
      if (files.length > 0) add(files);
    });
  }

  /**
   * `dragleave` fires every time the pointer crosses into a child, so a zone
   * made of more than one element flickers unless the crossings are counted.
   */
  let zoneDepth = 0;
  let pageDepth = 0;

  // A full-page drop zone has to cancel `dragover` on the document, or the
  // browser opens the file over the application. Since the cancelling is
  // unavoidable, the highlight comes with it.
  effect(() => {
    if (!options.fullPage || disabled()) return;

    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      pageDepth += 1;
      pageDragging.set(true);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = () => {
      pageDepth = Math.max(0, pageDepth - 1);
      if (pageDepth === 0) pageDragging.set(false);
    };

    // Every drop on the page arrives here, including a text selection dragged
    // between two fields that have nothing to do with this upload. Cancelling
    // that one is how a full-page zone silently breaks editing across the whole
    // page, so the drops that are not ours are left alone entirely. The zone's
    // own `onDrop` cancels unconditionally still: a drop that landed on the
    // zone is ours whatever it was carrying.
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      acceptDrop(event);
    };

    document.addEventListener('dragenter', onEnter);
    document.addEventListener('dragover', onOver);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('drop', onDrop);

    onCleanup(() => {
      pageDepth = 0;
      pageDragging.set(false);
      document.removeEventListener('dragenter', onEnter);
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('dragleave', onLeave);
      document.removeEventListener('drop', onDrop);
    });
  });

  function onPaste(event: ClipboardEvent): void {
    if (disabled()) return;
    const data = event.clipboardData;
    if (!data) return;

    const files: File[] = [];
    for (let i = 0; i < data.files.length; i++) {
      const file = data.files[i];
      if (file) files.push(file);
    }
    // A screenshot pasted from the clipboard arrives as an item rather than in
    // `files` in some engines, which is the case this whole feature is for.
    if (files.length === 0) {
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        if (item?.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length === 0) return;
    // Only once there is something to take: cancelling a paste that held text
    // would swallow it from whatever field the user was actually in.
    event.preventDefault();
    add(files);
  }

  effect(() => {
    if (!options.paste || disabled()) return;
    document.addEventListener('paste', onPaste);
    onCleanup(() => document.removeEventListener('paste', onPaste));
  });

  function open(): void {
    if (disabled()) return;
    const input = options.input();
    if (input instanceof HTMLElement) input.click();
  }

  /**
   * Whether a key belongs to the drop zone.
   *
   * The zone carries `role="button"`, and APG's button pattern says a button
   * answers Enter and Space — so the handler must act whether or not the
   * component was handed a `dropZone` accessor, which is a ref for finding an
   * element and never a statement about the keyboard. What the accessor can
   * honestly gate is *reach*: a consumer who wired this handler on the root
   * would otherwise have Enter swallowed inside every field under it, so when
   * a zone was named the key has to have come from it. With no zone named
   * there is nothing to check against, and wiring the handler at all is the
   * consumer saying which element it is for.
   */
  function fromZone(target: EventTarget | null): boolean {
    const zone = options.dropZone?.();
    if (!zone) return true;
    return target instanceof Node && zone.contains(target);
  }

  return {
    items,
    item: (id) => items().find((entry) => entry.id === id),
    counts,

    progress: () => overall.percent() ?? 0,
    loadedBytes,
    totalBytes,
    isUploading,
    isDragging: () => dragging.get(),
    isPageDragging: () => pageDragging.get(),
    announcement: () => (timing.isReady() ? finished.get() : ''),

    field,

    add,
    upload() {
      for (const item of untrack(items)) {
        if (item.status === 'pending') wanted.add(item.id);
      }
      pump();
    },
    uploadItem,
    cancel,
    cancelAll,
    retry,
    retryFailed() {
      for (const item of untrack(items)) {
        if (item.status === 'error' || item.status === 'cancelled') retry(item.id);
      }
    },
    remove,
    clear: clearAll,
    open,

    onInputChange(event) {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.files) return;

      const files: File[] = [];
      for (let i = 0; i < input.files.length; i++) {
        const file = input.files[i];
        if (file) files.push(file);
      }
      // `add` writes the whole queue back into the input, so the list the
      // picker just handed over — which holds this pick alone — is replaced by
      // every file the user has chosen, dropped or pasted.
      if (files.length > 0) add(files);
    },

    onDragEnter(event) {
      if (!hasFiles(event) || disabled()) return;
      event.preventDefault();
      zoneDepth += 1;
      dragging.set(true);
    },

    onDragOver(event) {
      if (!hasFiles(event) || disabled()) return;
      // Cancelling `dragover` is what makes an element a drop target at all.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    },

    onDragLeave() {
      zoneDepth = Math.max(0, zoneDepth - 1);
      if (zoneDepth === 0) dragging.set(false);
    },

    onDrop(event) {
      zoneDepth = 0;
      // Stopped as well as cancelled, so a page-wide zone underneath does not
      // take the same files a second time.
      event.stopPropagation();
      acceptDrop(event);
    },

    onPaste,

    onKeyDown(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return false;
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if (disabled() || !fromZone(event.target)) return false;
      // Space would scroll the page, and Enter inside a form would submit it —
      // both behind a zone that has already opened the picker.
      event.preventDefault();
      open();
      return true;
    },

    rootProps: () => ({
      ...field.fieldProps(),
      id: uploadId,
      'data-dragging': dragging.get() || undefined,
      'data-page-dragging': pageDragging.get() || undefined,
      'data-uploading': isUploading() || undefined,
    }),

    dropZoneProps: () => ({
      // A button, because that is what it does: it opens the picker. The cost
      // is a second tab stop beside any separate browse button the consumer
      // renders, which is the right way round — a zone nobody can reach from a
      // keyboard is worse than one reached twice.
      role: 'button',
      // Always in the tab order, exactly as the slider's thumbs are: a control
      // that says `aria-disabled` and then removes itself from the tab order
      // contradicts itself, because nothing can reach the state to hear it. A
      // disabled zone stays findable and answers "unavailable"; the `disabled`
      // attribute, which would take it away, is what the whole library avoids.
      tabindex: '0',
      'aria-label': labels.dropZone ?? 'Drop files here, or press to choose files',
      'aria-describedby': text(field.controlProps()['aria-describedby']),
      'aria-disabled': disabled() ? 'true' : undefined,
      'data-dragging': dragging.get() || undefined,
      'data-disabled': disabled() || undefined,
    }),

    inputProps() {
      const props: Record<string, string | boolean | undefined> = {
        ...field.controlProps(),
        type: 'file',
        multiple,
        accept: options.accept,
        // The picker's own filter is a hint, never a guarantee: every one of
        // these is checked again on the files that come back.
        webkitdirectory: options.directory === true,
      };
      // Hiding this is the consumer's business — but hide it with
      // `VISUALLY_HIDDEN_INPUT_STYLE`, not `display: none`, or a required file
      // input that blocks a submit has nowhere to show the reason.
      return props;
    },

    triggerProps: () => ({
      type: 'button',
      'aria-controls': field.ids().control,
      'aria-disabled': disabled() ? 'true' : undefined,
      'data-disabled': disabled() || undefined,
    }),

    labelProps: () => field.labelProps(),
    descriptionProps: () => field.descriptionProps(),
    errorMessageProps: () => field.errorMessageProps(),

    itemProps: (item) => ({
      'data-id': item.id,
      'data-status': item.status,
      'data-error': item.error?.code,
      'data-progress': String(Math.round(item.progress)),
    }),

    itemProgressProps: (item) => barFor(item).rootProps(),
    progressProps: () => overall.rootProps(),

    liveRegionProps: () => ({
      // `status` rather than `alert`: an upload finishing is news, not an
      // emergency, and polite announcements wait for a gap in whatever the
      // user is already being told.
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    }),

    cancelProps: (item) => ({
      type: 'button',
      'aria-label': labels.cancel?.(item) ?? `Cancel upload of ${item.file.name}`,
      // Present but unavailable, rather than gone: a button that disappears
      // the moment an upload finishes moves everything next to it.
      'aria-disabled': item.status === 'uploading' || item.status === 'pending' ? undefined : 'true',
      'data-status': item.status,
    }),

    retryProps: (item) => ({
      type: 'button',
      'aria-label': labels.retry?.(item) ?? `Retry upload of ${item.file.name}`,
      'aria-disabled': item.status === 'error' || item.status === 'cancelled' ? undefined : 'true',
      'data-status': item.status,
    }),

    removeProps: (item) => ({
      type: 'button',
      'aria-label': labels.remove?.(item) ?? `Remove ${item.file.name}`,
      'data-status': item.status,
    }),
  };
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

export interface HttpTransportOptions {
  /** Where to send it. A function, for a URL signed per file or per chunk. */
  url: string | ((request: UploadRequest) => string);
  /** Default POST. */
  method?: string;
  headers?: Record<string, string> | ((request: UploadRequest) => Record<string, string>);
  /**
   * Send the bytes as the whole request body rather than as multipart form
   * data. The chunk's range then travels in `Content-Range`, because there is
   * nowhere else to put it.
   */
  raw?: boolean;
  /** The form field the file goes in. Default `file`. */
  fieldName?: string;
  /** Extra form fields — a CSRF token, an album id. */
  fields?: (request: UploadRequest) => Record<string, string>;
  /** Send cookies to another origin. */
  withCredentials?: boolean;
  /** Default: JSON when the response says so, plain text otherwise. */
  parse?: (body: string, contentType: string) => unknown;
}

/** The body, and the headers that describe it. */
function buildBody(
  request: UploadRequest,
  options: HttpTransportOptions,
): { body: XMLHttpRequestBodyInit; headers: Record<string, string> } {
  const headers =
    typeof options.headers === 'function' ? options.headers(request) : { ...options.headers };

  if (options.raw) {
    if (request.chunk) {
      const { start, end } = request.chunk;
      // The only place a range can go when the body is the bytes themselves.
      headers['Content-Range'] = `bytes ${start}-${end - 1}/${request.file.size}`;
    }
    return { body: request.body, headers };
  }

  const form = new FormData();
  form.append(options.fieldName ?? 'file', request.body, request.file.name);
  form.append('name', request.file.name);
  // The path a directory upload came in with, so the server can rebuild the
  // tree rather than receive a flat pile of names.
  if (request.item.path !== request.file.name) form.append('path', request.item.path);
  if (request.chunk) {
    form.append('chunkIndex', String(request.chunk.index));
    form.append('chunkCount', String(request.chunk.count));
    form.append('chunkOffset', String(request.chunk.start));
    form.append('fileSize', String(request.file.size));
    // Stable across every chunk and every retry of one file, which is what
    // lets the server put the pieces back together.
    form.append('uploadId', request.item.id);
  }
  for (const [key, value] of Object.entries(options.fields?.(request) ?? {})) {
    form.append(key, value);
  }
  // Deliberately no `Content-Type`: the boundary is generated with the body,
  // and a header set by hand loses it and makes the request unparseable.
  return { body: form, headers };
}

function parseBody(
  options: HttpTransportOptions,
  body: string,
  contentType: string,
): unknown {
  if (options.parse) return options.parse(body, contentType);
  if (!contentType.includes('json')) return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    // A malformed body from a server that promised JSON is still a fact worth
    // handing back, and throwing here would look like a failed upload.
    return body;
  }
}

/**
 * Upload over `XMLHttpRequest`.
 *
 * The only reason to reach for XHR in 2026 is the one that matters here: it is
 * still the only way to observe an upload's progress. `fetch` can stream a
 * request body, but only over HTTP/2 and only in some engines, and it reports
 * nothing about how much of it has left the machine.
 */
export function xhrTransport(options: HttpTransportOptions): UploadTransport {
  return (request) =>
    new Promise<unknown>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = typeof options.url === 'function' ? options.url(request) : options.url;
      const { body, headers } = buildBody(request, options);

      xhr.open(options.method ?? 'POST', url, true);
      if (options.withCredentials) xhr.withCredentials = true;
      // After `open`, which is the only point at which they may be set.
      for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);

      xhr.upload.addEventListener('progress', (event: ProgressEvent) => {
        if (event.lengthComputable) request.progress(event.loaded);
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // The last progress event can arrive before the last byte is
          // acknowledged, so the bar is finished by hand.
          request.progress(request.body.size);
          resolve(parseBody(options, xhr.responseText, xhr.getResponseHeader('content-type') ?? ''));
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });
      xhr.addEventListener('error', () => reject(new Error('Upload failed')));
      xhr.addEventListener('timeout', () => reject(new Error('Upload timed out')));
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

      request.signal.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(body);
    });
}

/**
 * Upload over `fetch`.
 *
 * Smaller, and works anywhere `fetch` does — but it cannot report progress, so
 * every file jumps from nothing to done. Pair it with `chunkSize` and the bar
 * moves once per chunk, which is the honest way to get a moving bar out of an
 * API that cannot measure one.
 */
export function fetchTransport(options: HttpTransportOptions): UploadTransport {
  return async (request) => {
    const url = typeof options.url === 'function' ? options.url(request) : options.url;
    const { body, headers } = buildBody(request, options);

    const response = await fetch(url, {
      method: options.method ?? 'POST',
      headers,
      body,
      signal: request.signal,
      credentials: options.withCredentials ? 'include' : 'same-origin',
    });

    if (!response.ok) throw new Error(`Upload failed with status ${response.status}`);

    request.progress(request.body.size);
    const contentType = response.headers.get('content-type') ?? '';
    return parseBody(options, await response.text(), contentType);
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Whether a drag is carrying files rather than text dragged out of a paragraph. */
function hasFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
  return false;
}

/**
 * Whether a file matches an `accept` list.
 *
 * The same three forms the attribute takes: an extension, a type with a
 * wildcard subtype, or an exact type. Extensions are matched case-insensitively
 * because a camera writes `.JPG` and nobody means to exclude it.
 */
export function matchesAccept(file: File, accept: string): boolean {
  const tokens = accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  return tokens.some((token) => {
    if (token.startsWith('.')) return name.endsWith(token);
    if (token.endsWith('/*')) return type.startsWith(`${token.slice(0, -1)}`);
    return type === token;
  });
}

/**
 * The path a file came in with.
 *
 * A directory upload sets `webkitRelativePath`; anything else leaves it empty,
 * and then the name is the whole path.
 */
function relativePathOf(file: File): string {
  const path = (file as { webkitRelativePath?: string }).webkitRelativePath;
  return path && path.length > 0 ? path : file.name;
}

/**
 * Every file under a set of dropped entries.
 *
 * The `FileSystemEntry` API is callback-based and reads a directory a page at
 * a time — an empty result is the only end-of-list there is, which is why the
 * reader is called in a loop rather than once.
 */
async function walkEntries(entries: readonly FileSystemEntry[], depth: number): Promise<File[]> {
  const files: File[] = [];

  for (const entry of entries) {
    if (entry.isFile) {
      const file = await entryFile(entry as FileSystemFileEntry);
      if (file) files.push(file);
      continue;
    }
    // A depth limit, because a directory tree is user input and a symlinked
    // loop would otherwise never end.
    if (entry.isDirectory && depth > 0) {
      const children = await readDirectory(entry as FileSystemDirectoryEntry);
      files.push(...(await walkEntries(children, depth - 1)));
    }
  }

  return files;
}

function entryFile(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (file) => resolve(file),
      // One unreadable file must not lose the other two hundred.
      () => resolve(null),
    );
  });
}

function readDirectory(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = entry.createReader();
  const all: FileSystemEntry[] = [];

  return new Promise((resolve) => {
    const readMore = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        readMore();
      }, () => resolve(all));
    };
    readMore();
  });
}

/** Whatever a transport threw, as something a person can read. */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error ? error : 'Upload failed';
}
