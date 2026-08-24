/**
 * Inputs — the text-shaped controls a person types into.
 *
 * Every one of these is a real native input wearing a component. That is the
 * whole design: a control assembled out of `<div>`s submits nothing, validates
 * nothing, and is invisible to `FormData`, to `form.reset()`, to `:invalid`,
 * and to the browser's own required-field handling. So the value always lives
 * on an `<input>` or a `<textarea>`, the accessibility and the keyboard live
 * here, and `createFormField` wires the two together with the label, the
 * description and the error message.
 *
 * This is headless: it owns state, keyboard and ARIA, and returns prop objects
 * to spread onto whatever markup the consumer writes. Nothing here renders.
 *
 *   class Signup {
 *     input = new Signal.State<Element | null>(null);
 *     label = new Signal.State<Element | null>(null);
 *     email = createInput({
 *       input: () => this.input.get(),
 *       label: () => this.label.get(),
 *       type: 'email',
 *       name: 'email',
 *       required: () => true,
 *     });
 *   }
 *
 *   <div :spread="email.fieldProps()">
 *     <label :ref="label" :spread="email.labelProps()">Email</label>
 *     <input :ref="input" :spread="email.inputProps()">
 *   </div>
 *
 * Two rules run through all of them.
 *
 * **The value is a signal and the element is its mirror.** Pass a
 * `Signal.State` to drive a control from outside; pass nothing and it owns one.
 * The element is written from the signal and read back on `input`, so the two
 * can never disagree — and a `value` in the consumer's own markup is adopted
 * rather than wiped, because an empty signal is not an instruction to erase.
 *
 * **Composites keep the native control.** A PIN, a tag list and a rating are
 * not native controls, so each is backed by a hidden real input that carries
 * the value into the form. The visible part takes the field's ARIA minus its
 * id, which stays with the element the label points at.
 */

import { Signal, effect, flushSync, measureEffect, onCleanup, renderEffect } from '@voltdev/core';
import {
  createFormField,
  type FormField,
  type FormFieldLabels,
  type FormFieldOptions,
  type ValidationOutcome,
  type ValidationTrigger,
} from './form-field.js';
import { createCollection, ITEM_ATTRIBUTE } from './collection.js';
import { createRovingFocus } from './roving-focus.js';
import { createRadioGroup, VISUALLY_HIDDEN_INPUT_STYLE } from './form-controls.js';
import {
  getNumberFormat,
  resolveDirection,
  useLocale,
  type MessageKey,
} from './i18n.js';
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
export interface InputProps {
  readonly [key: string]: string | boolean | undefined;
}

// ---------------------------------------------------------------------------
// Shared options
// ---------------------------------------------------------------------------

/** What every text-shaped control here takes. */
export interface TextFieldOptions {
  /** The native control, once rendered. Without it there is nothing to type into. */
  input: () => Element | null | undefined;
  /** The visible label, if there is one. */
  label?: () => Element | null | undefined;
  /** Help text, shown whether or not the field is valid. */
  description?: () => Element | null | undefined;
  /** Where validation messages are rendered. */
  errorMessage?: () => Element | null | undefined;

  /**
   * Supply a signal to control the value from outside. Without one the control
   * owns its own, which is what most callers want.
   */
  value?: Signal.State<string>;
  defaultValue?: string;

  /** Fixed id for the control, when something outside has to refer to it. */
  id?: string;
  /** Submitted as `name=value`. Without a name it submits nothing. */
  name?: string;
  placeholder?: string;
  autoComplete?: string;

  required?: () => boolean;
  disabled?: () => boolean;
  readOnly?: () => boolean;

  minLength?: number;
  maxLength?: number;
  pattern?: string;

  /** Validation the platform cannot express. Return nothing for a pass. */
  validate?: FormFieldOptions['validate'];
  /** When the field first validates. Default `submit`. */
  validateOn?: ValidationTrigger;
  /** When it validates again, once it has validated at all. Default `input`. */
  revalidateOn?: ValidationTrigger;

  labels?: FormFieldLabels;

  onValueChange?: (value: string) => void;
}

/**
 * Forward only what the caller actually said.
 *
 * `createFormField` writes `required`, `disabled` and `readOnly` through to the
 * control when it is told about them, and stays out of the way when it is not —
 * so passing `() => false` for an option nobody supplied would quietly wipe a
 * `required` attribute in the consumer's own markup.
 */
function fieldOptionsFor(
  options: TextFieldOptions,
  control: () => Element | null | undefined = options.input,
): FormFieldOptions {
  const config: FormFieldOptions = {
    control,
    label: options.label,
    description: options.description,
    errorMessage: options.errorMessage,
    labels: options.labels,
  };

  if (options.id !== undefined) config.id = options.id;
  if (options.validate) config.validate = options.validate;
  if (options.validateOn) config.validateOn = options.validateOn;
  if (options.revalidateOn) config.revalidateOn = options.revalidateOn;
  if (options.required) config.required = options.required;
  if (options.disabled) config.disabled = options.disabled;
  if (options.readOnly) config.readOnly = options.readOnly;

  return config;
}

// ---------------------------------------------------------------------------
// The base every text control shares
// ---------------------------------------------------------------------------

interface TextControl {
  readonly field: FormField;
  value(): string;
  setValue(value: string): void;
  clear(): void;
  isEmpty(): boolean;
  /** Characters left before `maxLength`, or null when there is no maximum. */
  remaining(): number | null;

  fieldProps(): InputProps;
  labelProps(): InputProps;
  descriptionProps(): InputProps;
  errorMessageProps(): InputProps;
  /** The field's control props plus everything common to a native text control. */
  controlProps(): InputProps;
}

function createTextControl(options: TextFieldOptions): TextControl {
  const state = options.value ?? new Signal.State(options.defaultValue ?? '');
  const field = createFormField(fieldOptionsFor(options));

  bindTextValue(options.input, state, field, options.onValueChange);

  const setValue = (next: string): void => {
    if (untrack(() => state.get()) === next) return;
    state.set(next);
    options.onValueChange?.(next);
  };

  return {
    field,
    value: () => state.get(),
    setValue,
    clear: () => setValue(''),
    isEmpty: () => state.get().length === 0,
    remaining: () =>
      options.maxLength === undefined ? null : options.maxLength - [...state.get()].length,

    fieldProps: () => field.fieldProps(),
    labelProps: () => field.labelProps(),
    descriptionProps: () => field.descriptionProps(),
    errorMessageProps: () => field.errorMessageProps(),

    controlProps: () =>
      defined({
        ...field.controlProps(),
        name: options.name,
        placeholder: options.placeholder,
        autocomplete: options.autoComplete,
        maxlength: options.maxLength === undefined ? undefined : String(options.maxLength),
        minlength: options.minLength === undefined ? undefined : String(options.minLength),
        pattern: options.pattern,
        'data-empty': state.get().length === 0 || undefined,
      }),
  };
}

/**
 * Keep a signal and a native control saying the same thing.
 *
 * The element is the mirror, not the source: it is written from the signal and
 * read back on `input`. Writing is guarded on inequality because assigning to
 * `value` moves the caret to the end, which is exactly the bug that makes a
 * naive controlled input unusable — every keystroke would jump the cursor.
 */
function bindTextValue(
  control: () => Element | null | undefined,
  state: Signal.State<string>,
  field: FormField,
  onValueChange?: (value: string) => void,
): void {
  let known: Element | null = null;

  effect(() => {
    const el = control();
    const next = state.get();
    if (!isValueControl(el)) {
      known = null;
      return;
    }

    if (el !== known) {
      known = el;
      // Markup wins on first sight when the caller supplied no value: an
      // `<input value="…">` in the template is a default, and an empty signal
      // is not an instruction to erase it.
      if (next === '' && el.value !== '') {
        state.set(el.value);
        // Announced, not merely recorded. For a plain control this signal is
        // the value and the callback is a courtesy; for a composite it is only
        // the text, and whatever derives the real value from it — the number
        // behind a spinbutton — is subscribed here and nowhere else. Adopting
        // silently would leave the box showing a value the field would not
        // submit, which is the opposite of what adoption is for.
        onValueChange?.(el.value);
        return;
      }
    }

    if (el.value === next) return;
    el.value = next;
    // The field tracks the control through its own `input` listener, and a
    // programmatic write fires no event. Telling it directly keeps `isDirty`
    // and revalidation honest without dispatching a synthetic `input`, which
    // would also reach the consumer's listeners as though the user had typed.
    field.markEdited();
  });

  // Separate, so the listeners are attached once per control rather than
  // removed and re-added on every change of value.
  effect(() => {
    const el = control();
    if (!isValueControl(el)) return;

    const read = () => {
      const next = el.value;
      if (untrack(() => state.get()) === next) return;
      state.set(next);
      onValueChange?.(next);
    };

    // A reset restores the control's default value and fires no `input`, so
    // the signal has to be told or the box and the state disagree from then
    // on. It is read after a microtask because `reset` is dispatched partway
    // through resetting, before the value has settled.
    const onReset = () => queueMicrotask(read);
    const form = formOf(el);

    el.addEventListener('input', read);
    form?.addEventListener('reset', onReset);

    onCleanup(() => {
      el.removeEventListener('input', read);
      form?.removeEventListener('reset', onReset);
    });
  });
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * The types that are a single line of text.
 *
 * `number` is deliberately absent: `createNumberInput` is what that should be,
 * and a native number input cannot hold a locale-formatted value.
 */
export type TextInputType = 'text' | 'email' | 'password' | 'search' | 'tel' | 'url';

export interface InputOptions extends TextFieldOptions {
  /** Default `text`. */
  type?: TextInputType;
  /** The on-screen keyboard to ask for. */
  inputMode?: string;
}

export interface TextInput extends TextControl {
  inputProps(): InputProps;
}

/**
 * A single-line text input.
 *
 * There is not much to it, and that is the point: the label, the description,
 * the error message, the ids that tie them together, the dirty and touched
 * flags and the platform's own validation all come from `createFormField`, and
 * what is left is the value binding.
 */
export function createInput(options: InputOptions = { input: () => null }): TextInput {
  const base = createTextControl(options);

  return {
    ...base,
    inputProps: () =>
      defined({
        ...base.controlProps(),
        type: options.type ?? 'text',
        inputmode: options.inputMode,
      }),
  };
}

// ---------------------------------------------------------------------------
// Textarea
// ---------------------------------------------------------------------------

export interface TextareaOptions extends TextFieldOptions {
  /** Lines to show before there is anything to show. Default 2. */
  rows?: number;
  /** Stop growing at this many lines. Without one it grows for ever. */
  maxRows?: number;
  /** Grow with the content. Default true. */
  autoSize?: boolean;
}

export interface Textarea extends TextControl {
  textareaProps(): InputProps;
  /** Re-measure now, for a layout change this cannot see. */
  resize(): void;
}

/**
 * Whether the browser can size a field to its own content in CSS.
 *
 * Asked rather than assumed, so the measuring fallback is only ever reached
 * where it is actually needed. Not cached: the cost is one syntax check.
 */
export function supportsFieldSizing(): boolean {
  // `CSS` is a browser global with no equivalent on a server, where a
  // declaration is inert anyway — claim support and let the browser that
  // receives the markup decide.
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return true;
  return CSS.supports('field-sizing', 'content');
}

/**
 * A multi-line text input that grows with what is typed into it.
 *
 * Auto-sizing is one CSS declaration on a modern browser — `field-sizing:
 * content` — and the browser then does it on every edit, including the ones no
 * listener sees: autofill, undo, an IME commit, a drag-and-drop of text. Where
 * that is unavailable the real element is measured instead. What is *not* done
 * either way is the mirror-element trick: a hidden clone has to be kept in step
 * with every font, padding, border and width the original has, and it still
 * cannot copy the scrollbar the original grows.
 *
 * This is the one place the library writes a style, because "as tall as its
 * content" cannot be said in the consumer's stylesheet without the same
 * measurement. Set `autoSize: false` and nothing is written.
 */
export function createTextarea(options: TextareaOptions = { input: () => null }): Textarea {
  const base = createTextControl(options);
  const autoSize = options.autoSize !== false;
  const rows = options.rows ?? 2;

  /** Set by the measuring path, so `resize()` has something to call. */
  let remeasure: (() => void) | null = null;

  effect(() => {
    const el = options.input();
    if (!autoSize || !isTextarea(el)) return;

    if (supportsFieldSizing()) {
      el.style.setProperty('field-sizing', 'content');
      // `lh` is the element's own line height, so the cap is stated in the
      // unit the author thinks in rather than in pixels nobody can predict.
      if (options.maxRows !== undefined) {
        el.style.setProperty('max-height', `${options.maxRows}lh`);
      }
      onCleanup(() => {
        el.style.removeProperty('field-sizing');
        el.style.removeProperty('max-height');
      });
      return;
    }

    // Measuring here is write, then read, then write — the box has to go back
    // to its natural height before `scrollHeight` means anything. All three in
    // one effect is what makes every autosizing textarea on a page force a
    // layout of its own, so they are spread across the phases that exist for
    // them: render resets, measure reads, render applies. Nested, so the
    // strategy above is chosen once per element rather than once per keystroke.
    let ticket = 0;
    const request = new Signal.State(0);
    const askAgain = () => request.set(++ticket);

    // The last reading, and a revision to publish it under. A counter rather
    // than the reading itself, because an unchanged height must still re-run
    // the pass that applies it: until it does, the box is sitting at `auto`.
    let measured: { height: number; overflow: string } | null = null;
    const revision = new Signal.State(0);
    let published = 0;

    renderEffect(() => {
      base.value();
      request.get();
      // Without the reset the box can only ever grow: `scrollHeight` never
      // reports less than the height already set.
      el.style.height = 'auto';
    });

    measureEffect(() => {
      base.value();
      request.get();
      // A textarea that is not being rendered reports a `scrollHeight` of 0,
      // and writing that back collapses the box the moment it is shown again.
      // The last good reading is republished instead, which is what puts the
      // box back after the reset above.
      if (el.checkVisibility()) {
        const cap = capHeight(el, options.maxRows);
        const natural = el.scrollHeight;
        // One read where there were two. With the height clamped to `cap`,
        // asking the box again whether it overflows is asking whether
        // `natural` did — and the second read came after a write, so it cost
        // a layout of its own.
        measured = {
          height: Math.min(natural, cap),
          // Only once capped, so a growing box never shows a scrollbar it does
          // not need and a capped one always can.
          overflow: natural > cap ? 'auto' : 'hidden',
        };
      }
      revision.set(++published);
    });

    renderEffect(() => {
      revision.get();
      if (!measured) return;
      if (measured.height > 0) el.style.height = `${measured.height}px`;
      el.style.overflowY = measured.overflow;
    });

    remeasure = () => {
      askAgain();
      // `resize()` says "now", and a caller who has just changed a layout
      // nothing else can see is not inside a flush.
      flushSync();
    };
    onCleanup(() => {
      remeasure = null;
    });

    let width = -1;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? -1;
      // Width only. The height is what this writes, and reacting to it would
      // be a measuring loop that never settles.
      if (next === width) return;
      width = next;
      askAgain();
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  return {
    ...base,
    resize: () => remeasure?.(),
    textareaProps: () =>
      defined({
        ...base.controlProps(),
        rows: String(rows),
      }),
  };
}

/** The tallest the box may grow, in pixels, or Infinity when uncapped. */
function capHeight(el: HTMLTextAreaElement, maxRows: number | undefined): number {
  if (maxRows === undefined) return Infinity;

  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  // `line-height: normal` has no length to read, and guessing a ratio would
  // cap the box somewhere the author never asked for. Uncapped is the honest
  // answer; `field-sizing` and its `lh` unit is the path that gets this right.
  const line = Number.parseFloat(style?.lineHeight ?? '');
  if (!Number.isFinite(line) || line <= 0) return Infinity;

  const padding =
    Number.parseFloat(style?.paddingTop ?? '0') + Number.parseFloat(style?.paddingBottom ?? '0');
  const border =
    Number.parseFloat(style?.borderTopWidth ?? '0') +
    Number.parseFloat(style?.borderBottomWidth ?? '0');

  return maxRows * line + (Number.isFinite(padding) ? padding : 0) + (Number.isFinite(border) ? border : 0);
}

// ---------------------------------------------------------------------------
// Number input
// ---------------------------------------------------------------------------

export interface NumberInputLabels extends FormFieldLabels {
  /** Accessible name for the spin button that adds a step. Default `Increase`. */
  increase?: string;
  /** Accessible name for the spin button that takes one away. Default `Decrease`. */
  decrease?: string;
  /** Shown when what was typed is not a number at all. */
  notANumber?: string;
  /** Shown when the value is below the minimum, which arrives formatted. */
  tooSmall?: (min: string) => string;
  /** Shown when the value is above the maximum, which arrives formatted. */
  tooLarge?: (max: string) => string;
  /** Shown when `enforceStep` is on and the value is off the grid. */
  notAStep?: (step: string) => string;
}

export interface NumberInputOptions {
  /** The native input, once rendered. */
  input: () => Element | null | undefined;
  label?: () => Element | null | undefined;
  description?: () => Element | null | undefined;
  errorMessage?: () => Element | null | undefined;

  /** Supply a signal to control the value from outside. `null` is empty. */
  value?: Signal.State<number | null>;
  defaultValue?: number | null;

  id?: string;
  /** Carried by a hidden input, so what submits is the number and not its spelling. */
  name?: string;
  placeholder?: string;

  min?: number;
  max?: number;
  /** How far one arrow press moves. Default 1. */
  step?: number;
  /** How far PageUp and PageDown move. Default ten steps. */
  largeStep?: number;
  /**
   * Report a value that is not a multiple of the step as invalid. Default
   * false — a native number input rejects "1.5" against its default step of 1,
   * which is the single most complained-about thing it does. Here a step is
   * how far the arrows move unless you say it is a constraint.
   */
  enforceStep?: boolean;
  /** Pull an out-of-range value back into range when the field is left. Default true. */
  clampOnBlur?: boolean;

  /** Display formatting. Defaults to grouping, at the precision the step implies. */
  formatOptions?: Intl.NumberFormatOptions;
  /** Override the ambient locale, for a field that is deliberately not localised. */
  locale?: string;

  required?: () => boolean;
  disabled?: () => boolean;
  readOnly?: () => boolean;

  validate?: FormFieldOptions['validate'];
  validateOn?: ValidationTrigger;
  revalidateOn?: ValidationTrigger;

  labels?: NumberInputLabels;

  onValueChange?: (value: number | null) => void;
}

export interface NumberInput {
  readonly field: FormField;
  /** The value, or null when the box is empty. */
  value(): number | null;
  /** What is in the box, which is not the value while it is being typed. */
  text(): string;
  setValue(value: number | null): void;
  clear(): void;

  increment(): void;
  decrement(): void;
  /** Clamp, round and reformat. What leaving the field does. */
  commit(): void;

  canIncrement(): boolean;
  canDecrement(): boolean;

  /** Handle a keydown on the input. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;
  /** Call from the input's `blur`. */
  onBlur(): void;

  fieldProps(): InputProps;
  labelProps(): InputProps;
  inputProps(): InputProps;
  /** The hidden input that carries the canonical number into the form. */
  hiddenInputProps(): InputProps;
  incrementProps(): InputProps;
  decrementProps(): InputProps;
  descriptionProps(): InputProps;
  errorMessageProps(): InputProps;
}

/**
 * A number input that speaks the user's language.
 *
 * The visible control is `type="text"` with `role="spinbutton"`, not
 * `type="number"`, and the reason is locales: half the world writes 1234.56 as
 * "1.234,56", and a native number input treats that as bad input and hands back
 * an empty string. So this parses and formats through `Intl` — and pays for it,
 * because the platform's own range and step validation goes with the type. That
 * is done here instead, through the field's custom validity, so the form still
 * refuses to submit for exactly the reasons the message on screen gives.
 *
 * A hidden input carries the canonical value, so what reaches the server is
 * "1234.56" whatever the box says.
 *
 *   <div :spread="qty.fieldProps()">
 *     <label :ref="label" :spread="qty.labelProps()">Quantity</label>
 *     <input :ref="input" :spread="qty.inputProps()"
 *            :keydown="qty.onKeyDown($event)" :blur="qty.onBlur()">
 *     <input :spread="qty.hiddenInputProps()">
 *     <button :spread="qty.decrementProps()" :click="qty.decrement()">−</button>
 *     <button :spread="qty.incrementProps()" :click="qty.increment()">+</button>
 *   </div>
 */
export function createNumberInput(options: NumberInputOptions): NumberInput {
  const locale = useLocale();
  const code = (): string => options.locale ?? locale.code();

  const state = options.value ?? new Signal.State<number | null>(options.defaultValue ?? null);
  /** What is in the box. Not the value: "1.2" is a number halfway through being typed. */
  const text = new Signal.State('');

  const step = options.step ?? 1;
  const largeStep = options.largeStep ?? step * 10;
  const stepDigits = decimalsOf(step);

  const disabled = () => options.disabled?.() ?? false;
  const readOnly = () => options.readOnly?.() ?? false;

  const label = (override: string | undefined, key: MessageKey, fallback: string): string =>
    override ?? (locale.has(key) ? locale.t(key) : fallback);

  const format = (value: number): string =>
    getNumberFormat(
      code(),
      options.formatOptions ?? {
        minimumFractionDigits: stepDigits,
        maximumFractionDigits: Math.min(20, Math.max(stepDigits, decimalsOf(value))),
      },
    ).format(value);

  const clamp = (value: number): number => {
    if (options.min !== undefined && value < options.min) return options.min;
    if (options.max !== undefined && value > options.max) return options.max;
    return value;
  };

  const setValue = (next: number | null): void => {
    if (untrack(() => state.get()) === next) return;
    state.set(next);
    options.onValueChange?.(next);
  };

  /** Set the value and show it formatted, which is what everything but typing does. */
  const put = (next: number | null): void => {
    setValue(next);
    text.set(next === null ? '' : format(next));
  };

  const commit = (): void => {
    const parsed = parseLocaleNumber(untrack(() => text.get()), code());
    if (parsed === null) {
      // Not a number. The text is left exactly as typed rather than silently
      // erased, so the user can see what was rejected and fix it; validation
      // is what says it is wrong.
      setValue(null);
      return;
    }
    put(options.clampOnBlur === false ? parsed : clamp(parsed));
  };

  const nudge = (delta: number): void => {
    if (disabled() || readOnly()) return;
    const current = untrack(() => state.get());
    // From empty, the first press lands on the nearest end of the range rather
    // than on a step away from a value that was never there.
    const next = current === null ? (options.min ?? 0) : current + delta;
    put(clamp(roundTo(next, Math.max(stepDigits, decimalsOf(current ?? 0)) + 1)));
  };

  const canIncrement = (): boolean => {
    if (disabled() || readOnly()) return false;
    const current = state.get();
    return options.max === undefined || current === null || current < options.max;
  };

  const canDecrement = (): boolean => {
    if (disabled() || readOnly()) return false;
    const current = state.get();
    return options.min === undefined || current === null || current > options.min;
  };

  /**
   * What the platform would have said for `type="number"`, said here.
   *
   * It goes through the field's custom validity rather than being reported
   * separately, so the browser blocks the submit for the same reason the
   * message on screen gives — one verdict, not two.
   */
  const check = (): ValidationOutcome => {
    if (disabled() || readOnly()) return undefined;

    const raw = untrack(() => text.get()).trim();
    if (raw === '') return undefined; // Emptiness is `required`'s business.

    const parsed = parseLocaleNumber(raw, code());
    if (parsed === null) {
      return label(options.labels?.notANumber, 'notANumber', 'Enter a number.');
    }
    if (options.min !== undefined && parsed < options.min) {
      const min = format(options.min);
      return options.labels?.tooSmall?.(min) ?? `Enter a number no smaller than ${min}.`;
    }
    if (options.max !== undefined && parsed > options.max) {
      const max = format(options.max);
      return options.labels?.tooLarge?.(max) ?? `Enter a number no larger than ${max}.`;
    }
    if (options.enforceStep && !onStep(parsed, options.min ?? 0, step, stepDigits)) {
      const size = format(step);
      return options.labels?.notAStep?.(size) ?? `Enter a number in steps of ${size}.`;
    }
    return undefined;
  };

  const field = createFormField({
    ...fieldOptionsFor(
      {
        input: options.input,
        label: options.label,
        description: options.description,
        errorMessage: options.errorMessage,
        id: options.id,
        required: options.required,
        disabled: options.disabled,
        readOnly: options.readOnly,
        validateOn: options.validateOn,
        revalidateOn: options.revalidateOn,
        labels: options.labels,
      },
      options.input,
    ),
    validate: (value, control) => {
      const mine = check();
      if (mine) return mine;
      return options.validate?.(value, control);
    },
  });

  // The value the caller starts with, shown formatted before anyone types.
  const initial = untrack(() => state.get());
  if (initial !== null) text.set(format(initial));

  bindTextValue(options.input, text, field, () => {
    // While typing, the text is authoritative and the value follows it. It is
    // not reformatted here: rewriting the box under the caret on every
    // keystroke is the classic way a formatted number field becomes unusable.
    setValue(parseLocaleNumber(untrack(() => text.get()), code()));
  });

  // Re-format when the locale changes underneath a value nobody is editing, so
  // a language switch does not leave "1,234.56" on a German page.
  effect(() => {
    code();
    const current = untrack(() => state.get());
    const el = untrack(() => options.input());
    if (current === null) return;
    if (isValueControl(el) && el.ownerDocument.activeElement === el) return;
    text.set(format(current));
  });

  // A write to the caller's signal has to reach the box as well as the hidden
  // input and `aria-valuenow`: a spinbutton announcing 42 over a box still
  // reading 5 is worse than either alone.
  //
  // What the box says is parsed back rather than the last written value being
  // remembered, because the two disagree exactly where it matters: while
  // typing, the value is derived from the text, so the two already agree and
  // nothing is rewritten — "1.50" keeps its trailing zero and an "abc" the
  // field is refusing stays on screen to be corrected. Only a value the text
  // does not say is a write from outside, and that one is shown.
  //
  // No focus guard, unlike the locale effect above: a caller who writes to the
  // signal is stating the value, and `createInput` obeys the same write into a
  // focused box. Moving the caret is the smaller harm than lying about it.
  effect(() => {
    const current = state.get();
    untrack(() => {
      if (parseLocaleNumber(text.get(), code()) === current) return;
      text.set(current === null ? '' : format(current));
    });
  });

  return {
    field,
    value: () => state.get(),
    text: () => text.get(),
    setValue: (next) => put(next === null ? null : clamp(next)),
    clear: () => put(null),

    increment: () => nudge(step),
    decrement: () => nudge(-step),
    commit,

    canIncrement,
    canDecrement,

    onKeyDown(event: KeyboardEvent): boolean {
      // A modified key is a shortcut, not a nudge.
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if (disabled() || readOnly()) return false;

      switch (event.key) {
        case 'ArrowUp':
          nudge(step);
          break;
        case 'ArrowDown':
          nudge(-step);
          break;
        case 'PageUp':
          nudge(largeStep);
          break;
        case 'PageDown':
          nudge(-largeStep);
          break;
        case 'Home':
          if (options.min === undefined) return false;
          put(options.min);
          break;
        case 'End':
          if (options.max === undefined) return false;
          put(options.max);
          break;
        case 'Enter':
          // Enter belongs to the form, so it is not consumed — but the value
          // is settled first, or the form submits the half-typed text.
          commit();
          return false;
        default:
          return false;
      }

      // The arrows scroll the page and Home and End jump the document to its
      // ends, all of which would happen behind the value changing.
      event.preventDefault();
      return true;
    },

    onBlur: commit,

    fieldProps: () => field.fieldProps(),
    labelProps: () => field.labelProps(),
    descriptionProps: () => field.descriptionProps(),
    errorMessageProps: () => field.errorMessageProps(),

    inputProps: () => {
      const current = state.get();
      const shown = current === null ? '' : format(current);
      return defined({
        ...field.controlProps(),
        type: 'text',
        // A number keypad, and a hint that a decimal separator belongs on it.
        inputmode: stepDigits > 0 || options.step === undefined ? 'decimal' : 'numeric',
        // The browser has nothing useful to offer a spinbutton, and a dropdown
        // over one swallows the arrow keys.
        autocomplete: 'off',
        placeholder: options.placeholder,
        role: 'spinbutton',
        // Absent while empty, which is how ARIA says "no value yet". A zero
        // here would announce a number the user never entered.
        'aria-valuenow': current === null ? undefined : String(current),
        'aria-valuemin': options.min === undefined ? undefined : String(options.min),
        'aria-valuemax': options.max === undefined ? undefined : String(options.max),
        // Only when the formatted text says something the bare number does
        // not — otherwise a screen reader reads the value twice.
        'aria-valuetext': shown && shown !== String(current) ? shown : undefined,
      });
    },

    // `type="hidden"` rather than a visually hidden text input: this one is
    // never validated and never focused — the visible control does both — so
    // there is no reason for it to be reachable.
    hiddenInputProps: () => {
      const current = state.get();
      return defined({
        type: 'hidden',
        name: options.name,
        // The canonical spelling, so a server parses a number rather than a
        // locale's punctuation.
        value: current === null ? '' : String(current),
      });
    },

    incrementProps: () =>
      defined({
        // Inside a form, a button with no type submits it.
        type: 'button',
        'aria-label': label(options.labels?.increase, 'increase', 'Increase'),
        // Not a tab stop: the spinbutton itself is one, and its arrow keys do
        // the same job. A second and third stop per field is noise.
        tabindex: '-1',
        // Hidden from assistive technology, which reaches the same behaviour
        // through the spinbutton's own keyboard.
        'aria-hidden': 'true',
        disabled: !canIncrement(),
      }),

    decrementProps: () =>
      defined({
        type: 'button',
        'aria-label': label(options.labels?.decrease, 'decrease', 'Decrease'),
        tabindex: '-1',
        'aria-hidden': 'true',
        disabled: !canDecrement(),
      }),
  };
}

// ---------------------------------------------------------------------------
// Locale-aware numbers
// ---------------------------------------------------------------------------

interface NumberSymbols {
  group: string;
  decimal: string;
  minus: string;
  /** Code point of this numbering system's zero. */
  zero: number;
}

/**
 * Cached per locale. Bounded by the number of locales an application uses,
 * which is a handful — unlike a formatter cache, whose keys come from data.
 */
const symbolCache = new Map<string, NumberSymbols>();

function numberSymbols(locale: string): NumberSymbols {
  const hit = symbolCache.get(locale);
  if (hit) return hit;

  const parts = getNumberFormat(locale, { useGrouping: true }).formatToParts(-12345.6);
  const of = (type: Intl.NumberFormatPartTypes): string | undefined =>
    parts.find((part) => part.type === type)?.value;

  const made: NumberSymbols = {
    group: of('group') ?? ',',
    decimal: of('decimal') ?? '.',
    minus: of('minusSign') ?? '-',
    // Every decimal numbering system lays its digits out contiguously from
    // zero, so one subtraction covers Arabic-Indic, Devanagari and the rest.
    zero: getNumberFormat(locale, { useGrouping: false }).format(0).codePointAt(0) ?? 48,
  };

  symbolCache.set(locale, made);
  return made;
}

/** Characters that can separate digits in some locale, plus the ones people type anyway. */
const SEPARATORS = new Set([',', '.', ' ', ' ', ' ', ' ', "'", '’', '٫', '٬']);

/**
 * Read a number the way this locale writes one.
 *
 * Formatting is the easy half. Parsing is where a number field is usually
 * wrong: "1.234,56" is one thousand two hundred and thirty-four in most of
 * Europe and one point two three in a naive `parseFloat`. Decoration — a
 * currency symbol, a percent sign, the space inside a French thousands group —
 * is dropped rather than rejected, because someone who pastes "£1,234.56" means
 * 1234.56.
 *
 * The one genuinely ambiguous case is a lone separator: "1.234" is 1234 in
 * German and 1.234 in English. It is read as grouping only when what follows it
 * is a full group of three digits, so "1.5" is a decimal in every locale — that
 * is the rule, and it is a rule rather than a certainty.
 */
export function parseLocaleNumber(text: string, locale: string): number | null {
  const { group, decimal, minus, zero } = numberSymbols(locale);

  let mapped = '';
  for (const char of text.trim()) {
    const digit = (char.codePointAt(0) ?? 0) - zero;
    mapped += digit >= 0 && digit <= 9 ? String(digit) : char;
  }
  if (mapped === '') return null;

  const negative = mapped.includes(minus) || mapped.includes('-') || mapped.includes('−');

  let kept = '';
  for (const char of mapped) {
    if (char >= '0' && char <= '9') kept += char;
    else if (char === group || char === decimal || SEPARATORS.has(char)) kept += char;
  }

  let last = -1;
  for (let i = kept.length - 1; i >= 0; i--) {
    const char = kept[i];
    if (char !== undefined && (char < '0' || char > '9')) {
      last = i;
      break;
    }
  }

  const tail = last === -1 ? '' : kept.slice(last + 1);
  const isDecimalPoint = last !== -1 && (kept[last] === decimal || !/^\d{3}$/.test(tail));

  const whole = (isDecimalPoint ? kept.slice(0, last) : kept).replaceAll(/\D/g, '');
  const fraction = isDecimalPoint ? tail.replaceAll(/\D/g, '') : '';
  if (whole === '' && fraction === '') return null;

  const value = Number(`${whole === '' ? '0' : whole}.${fraction === '' ? '0' : fraction}`);
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

/** Digits after the point, for a number written the way JavaScript writes it. */
function decimalsOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const text = String(Math.abs(value));
  // Exponential notation for very small steps: 1e-7 has seven decimals.
  const exponent = text.includes('e-') ? Number(text.slice(text.indexOf('e-') + 2)) : 0;
  const fraction = text.includes('.') ? text.slice(text.indexOf('.') + 1).replace(/e.*$/, '') : '';
  return fraction.length + exponent;
}

/** Rounded, so 0.1 + 0.2 does not become 0.30000000000000004 in a quantity field. */
function roundTo(value: number, digits: number): number {
  return Number(value.toFixed(Math.min(Math.max(digits, 0), 15)));
}

function onStep(value: number, origin: number, step: number, digits: number): boolean {
  if (step <= 0) return true;
  const offset = roundTo((value - origin) / step, digits + 6);
  return Math.abs(offset - Math.round(offset)) < 1e-9;
}

// ---------------------------------------------------------------------------
// Password input
// ---------------------------------------------------------------------------

export interface PasswordInputLabels extends FormFieldLabels {
  /** Name for the toggle while the password is hidden. Default `Show password`. */
  show?: string;
  /** Name for the toggle while it is shown. Default `Hide password`. */
  hide?: string;
  /** Announced when it becomes visible. Default `Password shown`. */
  shown?: string;
  /** Announced when it is hidden again. Default `Password hidden`. */
  hidden?: string;
}

export interface PasswordInputOptions extends Omit<TextFieldOptions, 'labels'> {
  /** Supply a signal to control visibility from outside. */
  revealed?: Signal.State<boolean>;
  defaultRevealed?: boolean;
  labels?: PasswordInputLabels;
  onRevealedChange?: (revealed: boolean) => void;
}

export interface PasswordInput extends TextControl {
  isRevealed(): boolean;
  show(): void;
  hide(): void;
  toggle(): void;
  /** What the live region should say right now. */
  statusText(): string;

  inputProps(): InputProps;
  toggleProps(): InputProps;
  /** A live region, so the toggle's effect is announced rather than merely visible. */
  statusProps(): InputProps;
}

/**
 * A password field with a reveal toggle.
 *
 * The state is announced twice over, and both are needed. The toggle's own name
 * changes between "Show password" and "Hide password", which is what a screen
 * reader reads when the user next lands on it — but a name that changes as a
 * result of pressing the thing it names is not reliably announced at the moment
 * it changes. So a live region says "Password shown" as well. The cost is one
 * extra element the consumer has to render, and it is why `statusProps` exists
 * rather than this being folded into the button.
 *
 * `aria-pressed` is deliberately not used: a toggle whose name already changes
 * would then announce "Hide password, pressed", which reads as though hiding is
 * what is currently in force.
 */
export function createPasswordInput(
  options: PasswordInputOptions = { input: () => null },
): PasswordInput {
  const locale = useLocale();
  const base = createTextControl(options);
  const revealed = options.revealed ?? new Signal.State(options.defaultRevealed ?? false);

  const label = (override: string | undefined, key: MessageKey, fallback: string): string =>
    override ?? (locale.has(key) ? locale.t(key) : fallback);

  const setRevealed = (next: boolean): void => {
    if (untrack(() => revealed.get()) === next) return;

    // Changing `type` keeps the value but drops the selection in some engines,
    // so it is put back — a reveal in the middle of correcting a typo should
    // not send the caret to the end.
    const el = untrack(() => options.input());
    const focused = isValueControl(el) && el.ownerDocument.activeElement === el;
    const start = focused ? el.selectionStart : null;
    const end = focused ? el.selectionEnd : null;

    revealed.set(next);
    options.onRevealedChange?.(next);

    if (focused && start !== null && end !== null) {
      queueMicrotask(() => el.setSelectionRange(start, end));
    }
  };

  return {
    ...base,

    isRevealed: () => revealed.get(),
    show: () => setRevealed(true),
    hide: () => setRevealed(false),
    toggle: () => setRevealed(!untrack(() => revealed.get())),

    statusText: () =>
      revealed.get()
        ? label(options.labels?.shown, 'passwordShown', 'Password shown')
        : label(options.labels?.hidden, 'passwordHidden', 'Password hidden'),

    inputProps: () =>
      defined({
        ...base.controlProps(),
        type: revealed.get() ? 'text' : 'password',
        autocomplete: options.autoComplete ?? 'current-password',
        // A password is not a word, and a manager's suggestions over one are
        // noise at best and a leak into a spellchecker's dictionary at worst.
        spellcheck: 'false',
        autocapitalize: 'off',
        'data-revealed': revealed.get() || undefined,
      }),

    toggleProps: () =>
      defined({
        type: 'button',
        'aria-label': revealed.get()
          ? label(options.labels?.hide, 'hidePassword', 'Hide password')
          : label(options.labels?.show, 'show', 'Show password'),
        'aria-controls': base.field.ids().control,
        'data-state': revealed.get() ? 'revealed' : 'hidden',
      }),

    statusProps: () => ({
      role: 'status',
      'aria-live': 'polite',
    }),
  };
}

// ---------------------------------------------------------------------------
// PIN input
// ---------------------------------------------------------------------------

/** Marks a box, and records which one it is. */
export const PIN_BOX_ATTRIBUTE = 'data-volt-pin-box';

export interface PinInputLabels extends FormFieldLabels {
  /** Name for one box. Default `Digit 3 of 6`, or `Character 3 of 6`. */
  box?: (position: number, length: number) => string;
  /** Shown when some boxes are still empty. */
  incomplete?: string;
}

export interface PinInputOptions {
  /** The element holding the boxes, so they can be found in the order they appear. */
  container: () => Element | null | undefined;
  /** The hidden input carrying the whole value. */
  hiddenInput?: () => Element | null | undefined;
  label?: () => Element | null | undefined;
  description?: () => Element | null | undefined;
  errorMessage?: () => Element | null | undefined;

  /** Supply a signal to control the value from outside. */
  value?: Signal.State<string>;
  defaultValue?: string;

  /** How many boxes. Default 6. */
  length?: number;
  /** What may be typed. Default `numeric`. */
  type?: 'numeric' | 'alphanumeric' | 'any';
  /** A stricter rule than `type`, when there is one. */
  allow?: (char: string) => boolean;
  /** Render the characters as dots. Default false — a code being copied off a screen is not a secret. */
  mask?: boolean;

  id?: string;
  name?: string;
  /** Only the first box gets it, which is what the platform's autofill expects. */
  autoComplete?: string;

  required?: () => boolean;
  disabled?: () => boolean;
  readOnly?: () => boolean;

  validate?: FormFieldOptions['validate'];
  validateOn?: ValidationTrigger;
  revalidateOn?: ValidationTrigger;

  labels?: PinInputLabels;

  onValueChange?: (value: string) => void;
  /** Fired once the last box is filled. */
  onComplete?: (value: string) => void;
}

export interface PinInput {
  readonly field: FormField;
  value(): string;
  setValue(value: string): void;
  clear(): void;
  length(): number;
  isComplete(): boolean;
  /** The character in one box, or the empty string. */
  charAt(index: number): string;

  /** Move focus to a box. */
  focusBox(index: number): void;

  /** Handle a keydown on a box. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent, index: number): boolean;
  /** Call from each box's `input`. */
  onInput(event: Event, index: number): void;
  /** Call from each box's `paste`. Returns true when it was consumed. */
  onPaste(event: ClipboardEvent, index: number): boolean;
  /** Call from each box's `focus`. */
  onFocus(index: number): void;

  fieldProps(): InputProps;
  labelProps(): InputProps;
  groupProps(): InputProps;
  boxProps(index: number): InputProps;
  hiddenInputProps(): InputProps;
  descriptionProps(): InputProps;
  errorMessageProps(): InputProps;
}

/**
 * One box per character, behaving as though it were one field.
 *
 * The boxes are a presentation of a single value, so they act like one: pasting
 * a code into any of them fills them all, Backspace in an empty box goes back
 * and deletes, deleting a character shifts the rest along, and the group holds
 * one tab stop with the arrows moving inside it — Tab steps over the whole
 * field in one press rather than six.
 *
 * There are no holes. Focusing a box further along than the first empty one
 * bounces to the first empty one, because a code with a gap in the middle is
 * not a code, and allowing one would mean the value could no longer be a
 * string. The cost is that a user cannot go back and edit box two without
 * arrowing to it, which is what the arrow keys are for.
 *
 *   <div :ref="container" :spread="pin.groupProps()">
 *     <input :for="i in pin.length()" :spread="pin.boxProps(i - 1)"
 *            :keydown="pin.onKeyDown($event, i - 1)" :input="pin.onInput($event, i - 1)"
 *            :paste="pin.onPaste($event, i - 1)" :focus="pin.onFocus(i - 1)">
 *     <input :ref="hidden" :spread="pin.hiddenInputProps()">
 *   </div>
 */
export function createPinInput(options: PinInputOptions): PinInput {
  const locale = useLocale();
  const length = options.length ?? 6;
  const kind = options.type ?? 'numeric';
  const state = options.value ?? new Signal.State(sliceTo(options.defaultValue ?? '', length));

  const disabled = () => options.disabled?.() ?? false;
  const readOnly = () => options.readOnly?.() ?? false;

  const boxId = (index: number): string => `${groupId}-box-${index}`;
  const groupId = createId('pin');

  const allowed = (char: string): boolean => {
    if (options.allow) return options.allow(char);
    if (kind === 'numeric') return char >= '0' && char <= '9';
    if (kind === 'alphanumeric') return /^[a-z0-9]$/i.test(char);
    // Anything but the whitespace a paste drags in with it.
    return char.trim() !== '';
  };

  const chars = (): string[] => [...state.get()];

  const setValue = (next: string): void => {
    const trimmed = sliceTo(next, length);
    if (untrack(() => state.get()) === trimmed) return;
    state.set(trimmed);
    options.onValueChange?.(trimmed);
    if (trimmed.length === length) options.onComplete?.(trimmed);
  };

  const boxes = createCollection(options.container, {
    attribute: PIN_BOX_ATTRIBUTE,
    // A disabled field disables every box, and skipping them all would leave
    // the arrows with nowhere to go and no tab stop at all.
    skipDisabled: false,
  });

  /** Which box holds the group's single tab stop. */
  const active = new Signal.State(0);

  const roving = createRovingFocus(
    boxes,
    () => boxes.at(untrack(() => active.get())),
    (el) => {
      const index = boxes.all().indexOf(el as HTMLElement);
      if (index !== -1) active.set(index);
    },
    {
      orientation: 'horizontal',
      // A code has a beginning and an end; wrapping from the last box to the
      // first reads as a bug rather than as a convenience.
      loop: false,
      // The boxes hold characters, so every keystroke is a character.
      typeahead: false,
    },
  );

  const focusBox = (index: number): void => {
    const el = boxes.at(Math.min(Math.max(index, 0), length - 1));
    if (!el) return;
    roving.focus(el);
    if (isInputElement(el)) el.setSelectionRange(0, el.value.length);
  };

  /** Write the boxes from the value, since the value is the only source of truth. */
  effect(() => {
    const want = chars();
    boxes.all().forEach((box, index) => {
      const next = want[index] ?? '';
      if (isInputElement(box) && box.value !== next) box.value = next;
    });
  });

  const field = createFormField({
    ...fieldOptionsFor(
      {
        input: options.container,
        label: options.label,
        description: options.description,
        errorMessage: options.errorMessage,
        id: options.id,
        required: options.required,
        disabled: options.disabled,
        readOnly: options.readOnly,
        validateOn: options.validateOn,
        revalidateOn: options.revalidateOn,
        labels: options.labels,
      },
      // The hidden input is the control: it is what submits, what the platform
      // validates, and what a `reset` restores. The visible boxes borrow its
      // ARIA through `groupProps`.
      options.hiddenInput ?? options.container,
    ),
    validate: (value, control) => {
      const current = untrack(() => state.get());
      // An empty code is `required`'s business, and saying both would report
      // one mistake twice.
      if (current.length > 0 && current.length < length) {
        return (
          options.labels?.incomplete ??
          (locale.has('incomplete') ? locale.t('incomplete') : 'Enter all the characters.')
        );
      }
      return options.validate?.(value, control);
    },
  });

  // The hidden input is written from the value rather than typed into, so the
  // usual two-way binding would have nothing to read back.
  effect(() => {
    const el = options.hiddenInput?.();
    const next = state.get();
    if (!isValueControl(el) || el.value === next) return;
    el.value = next;
    field.markEdited();
  });

  // A reset is the other direction, and it fires no `input`. The browser
  // restores the hidden input and every box to their default of empty; without
  // this the value would not hear about it, so the boxes would read blank while
  // the field still held — and `isComplete()` still claimed — the old code, and
  // the next character typed would be distributed over it.
  //
  // Read back off the hidden input rather than assumed to be empty, because it
  // is the control the platform reset and a consumer may have written a
  // `value` attribute on it. Read after a microtask, since `reset` is
  // dispatched partway through resetting, before the values have settled.
  effect(() => {
    const hidden = options.hiddenInput?.();
    const anchor = isValueControl(hidden) ? hidden : options.container();
    const form = anchor ? formOf(anchor) : null;
    if (!form) return;

    const onReset = () =>
      queueMicrotask(() => {
        setValue(isValueControl(hidden) ? hidden.value : '');
        // The tab stop goes back to where the next character belongs, which is
        // the first box now that there is nothing in any of them.
        active.set(Math.min(untrack(() => state.get()).length, length - 1));
      });

    form.addEventListener('reset', onReset);
    onCleanup(() => form.removeEventListener('reset', onReset));
  });

  const distribute = (from: number, incoming: string): void => {
    const next = chars();
    let cursor = Math.min(from, next.length, length - 1);
    for (const char of incoming) {
      if (cursor >= length) break;
      if (!allowed(char)) continue;
      next[cursor] = char;
      cursor += 1;
    }
    setValue(next.join(''));
    focusBox(Math.min(cursor, length - 1));
  };

  return {
    field,
    value: () => state.get(),
    setValue,
    clear: () => {
      setValue('');
      focusBox(0);
    },
    length: () => length,
    isComplete: () => state.get().length === length,
    charAt: (index) => chars()[index] ?? '',
    focusBox,

    onFocus(index: number) {
      const filled = untrack(() => state.get()).length;
      // No holes: a box past the first empty one is not somewhere a character
      // can go, so focus lands where the next character actually belongs.
      const target = Math.min(index, filled, length - 1);
      if (target !== index) {
        focusBox(target);
        return;
      }
      active.set(index);
      const el = boxes.at(index);
      // Selected rather than merely focused, so typing over a filled box
      // replaces the character instead of being refused by its own length.
      if (isInputElement(el)) el.setSelectionRange(0, el.value.length);
    },

    onKeyDown(event: KeyboardEvent, index: number): boolean {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      // Enter belongs to the form. A field that swallowed it would take the
      // form's default action away from keyboard users.
      if (event.key === 'Enter') return false;
      if (disabled() || readOnly()) return false;

      const current = chars();

      if (event.key === 'Backspace') {
        event.preventDefault();
        // In a filled box it clears that character; in an empty one it goes
        // back and clears the one before, which is what a single field does.
        const target = current[index] ? index : index - 1;
        if (target < 0) return true;
        current.splice(target, 1);
        setValue(current.join(''));
        focusBox(target);
        return true;
      }

      if (event.key === 'Delete') {
        event.preventDefault();
        if (index < current.length) {
          current.splice(index, 1);
          setValue(current.join(''));
        }
        return true;
      }

      if (event.key === ' ') {
        // Not a character any code contains, and it would scroll the page.
        event.preventDefault();
        return true;
      }

      const consumed = roving.onKeyDown(event);
      if (consumed) {
        event.preventDefault();
        const el = boxes.at(untrack(() => active.get()));
        if (isInputElement(el)) el.setSelectionRange(0, el.value.length);
      }
      return consumed;
    },

    onInput(event: Event, index: number) {
      const el = event.target;
      if (!isInputElement(el)) return;
      if (disabled() || readOnly()) {
        el.value = chars()[index] ?? '';
        return;
      }

      const typed = [...el.value].filter(allowed).join('');
      if (typed === '') {
        const next = chars();
        if (index < next.length) {
          next.splice(index, 1);
          setValue(next.join(''));
        }
        el.value = '';
        return;
      }

      distribute(index, typed);
      // The box is corrected by hand as well as by the effect above, because
      // typing into a full box leaves two characters showing until the next
      // flush — and when the value happens not to change, nothing would flush.
      el.value = untrack(() => chars())[index] ?? '';
    },

    onPaste(event: ClipboardEvent, index: number): boolean {
      if (disabled() || readOnly()) return false;
      const text = event.clipboardData?.getData('text') ?? '';
      if (text === '') return false;

      // Cancelled: the browser would otherwise drop the whole code into one
      // box, and a code pasted from an email arrives with spaces in it.
      event.preventDefault();
      distribute(index, text);
      return true;
    },

    fieldProps: () => field.fieldProps(),
    descriptionProps: () => field.descriptionProps(),
    errorMessageProps: () => field.errorMessageProps(),

    // `for` points at the first box rather than at the hidden input the field
    // calls its control, so pressing the label puts the caret where the user
    // would start typing.
    labelProps: () => ({ id: field.ids().label, for: boxId(0) }),

    groupProps: () =>
      defined({
        ...borrowAria(field),
        role: 'group',
        'data-complete': state.get().length === length || undefined,
      }),

    boxProps: (index: number) =>
      defined({
        id: boxId(index),
        type: options.mask ? 'password' : 'text',
        inputmode: kind === 'numeric' ? 'numeric' : 'text',
        // Only the first box, and only for the first: `one-time-code` on every
        // box makes the platform offer the whole code six times over.
        autocomplete: index === 0 ? (options.autoComplete ?? 'one-time-code') : 'off',
        // No `maxlength`: it silently refuses the character typed into a full
        // box, and that character belongs in the next box rather than nowhere.
        // The length is enforced when the input is read instead.
        spellcheck: 'false',
        autocapitalize: 'off',
        'aria-label': options.labels?.box
          ? options.labels.box(index + 1, length)
          : `${kind === 'numeric' ? 'Digit' : 'Character'} ${index + 1} of ${length}`,
        // The group carries the error, not each box: six copies of one message
        // is six announcements of one mistake.
        'aria-invalid': field.isInvalid() ? 'true' : undefined,
        disabled: disabled() || undefined,
        readonly: readOnly() || undefined,
        // Exactly one box is in the tab order, so Tab steps over the field in
        // one press instead of once per character.
        tabindex: index === active.get() ? '0' : '-1',
        [PIN_BOX_ATTRIBUTE]: String(index),
        'data-filled': Boolean(chars()[index]) || undefined,
      }),

    hiddenInputProps: () =>
      defined({
        id: field.ids().control,
        type: 'text',
        name: options.name,
        required: options.required?.() || undefined,
        // Reachable to the platform, invisible to assistive technology and to
        // Tab: the boxes carry the semantics, and announcing both would
        // announce the field twice.
        tabindex: '-1',
        'aria-hidden': 'true',
        style: VISUALLY_HIDDEN_INPUT_STYLE,
      }),
  };
}

// ---------------------------------------------------------------------------
// Tags input
// ---------------------------------------------------------------------------

export interface TagsInputLabels extends FormFieldLabels {
  /** Name for the list of tags. Default `Tags`. */
  list?: string;
  /** Name for one tag's remove control. Default `Remove ada`. */
  remove?: (tag: string) => string;
  /** Announced when a tag is added. */
  added?: (tag: string) => string;
  /** Announced when one is removed. */
  removed?: (tag: string) => string;
  /** Announced when one is refused for already being there. */
  duplicate?: (tag: string) => string;
  /** Shown when `required` and there are no tags. */
  empty?: string;
}

export type TagRejection = 'duplicate' | 'invalid' | 'full';

export interface TagsInputOptions {
  /** The text input tags are typed into. */
  input: () => Element | null | undefined;
  /**
   * The element holding the tags.
   *
   * Not optional: focus after a removal is placed from the row — which tag
   * took the destroyed one's place, and whether one is left at all — and a
   * field that cannot see its row has nowhere to put it back.
   */
  list: () => Element | null | undefined;
  /**
   * The element the whole field is drawn on.
   *
   * Not optional for the same reason, and the end of the same chain: it is the
   * one part of the field that is still there when every other part has gone.
   * A row rendered only while there are tags leaves with the last one, and a
   * disabled field's text box refuses focus, so neither can be the last resort.
   */
  root: () => Element | null | undefined;
  label?: () => Element | null | undefined;
  description?: () => Element | null | undefined;
  errorMessage?: () => Element | null | undefined;

  /** Supply a signal to control the tags from outside. */
  value?: Signal.State<readonly string[]>;
  defaultValue?: readonly string[];

  id?: string;
  /** Each tag submits as `name=tag`, so the server reads a list. */
  name?: string;
  placeholder?: string;

  /** Most tags a field will hold. */
  max?: number;
  /** Keep tags that are already there. Default false. */
  allowDuplicates?: boolean;
  /** Tell `Ada` and `ada` apart. Default false, compared with the locale's collator. */
  caseSensitive?: boolean;
  /** Characters that end a tag when typed and split a paste. Default a comma. */
  delimiters?: readonly string[];
  /** Add whatever is half-typed when the field is left. Default true. */
  addOnBlur?: boolean;
  /** Clean a tag before it is added. Default: trim it. */
  transform?: (raw: string) => string;
  /** Refuse a tag outright. */
  validateTag?: (tag: string) => boolean;

  required?: () => boolean;
  disabled?: () => boolean;
  readOnly?: () => boolean;

  validate?: FormFieldOptions['validate'];
  validateOn?: ValidationTrigger;
  revalidateOn?: ValidationTrigger;

  labels?: TagsInputLabels;

  onValueChange?: (tags: readonly string[]) => void;
  onReject?: (tag: string, reason: TagRejection) => void;
}

export interface TagsInput {
  readonly field: FormField;
  tags(): readonly string[];
  /** What is half-typed in the text input. */
  draft(): string;
  setDraft(text: string): void;

  /** Add the draft, or a tag given outright. Returns whether it went in. */
  add(text?: string): boolean;
  removeAt(index: number): void;
  removeLast(): void;
  /** Empty the row. Not refused while disabled: it is the consumer's own call. */
  clear(): void;
  isFull(): boolean;
  /** The tag a rejected duplicate collided with, until the next edit. */
  duplicateIndex(): number | null;
  /** What the live region should say right now. */
  statusText(): string;

  /** Handle a keydown on the text input. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;
  /** Handle a keydown on a tag. Returns true when it was consumed. */
  onTagKeyDown(event: KeyboardEvent, index: number): boolean;
  /** Call from the text input's `paste`. Returns true when it was consumed. */
  onPaste(event: ClipboardEvent): boolean;
  /** Call from the text input's `blur`. */
  onBlur(): void;

  fieldProps(): InputProps;
  labelProps(): InputProps;
  rootProps(): InputProps;
  listProps(): InputProps;
  tagProps(index: number): InputProps;
  removeProps(index: number): InputProps;
  inputProps(): InputProps;
  /** One per tag, so `FormData.getAll(name)` returns the list. */
  hiddenInputProps(index: number): InputProps;
  statusProps(): InputProps;
  descriptionProps(): InputProps;
  errorMessageProps(): InputProps;
}

/**
 * A list of tags with a text input at the end of it.
 *
 * The tags are a roving-focus group — one tab stop for the whole list, arrows
 * to move inside it — and the text input is a tab stop of its own, so a field
 * holding twenty tags costs two Tab presses rather than twenty-one.
 *
 * Adding and removing a tag changes the page without moving focus, which is
 * silence to a screen reader, so `statusProps` is a live region that says what
 * happened. `createChip` is the primitive to reach for when each tag is its own
 * component with its own element; this deliberately keeps the list flat,
 * because the field owns focus — removing a tag puts focus on the next one, or
 * back in the text input, and that decision cannot be made a chip at a time.
 */
export function createTagsInput(options: TagsInputOptions): TagsInput {
  const locale = useLocale();
  const state = options.value ?? new Signal.State<readonly string[]>(options.defaultValue ?? []);
  const draft = new Signal.State('');
  const status = new Signal.State('');
  const duplicate = new Signal.State<number | null>(null);

  const delimiters = options.delimiters ?? [','];
  const transform = options.transform ?? ((raw: string) => raw.trim());
  const disabled = () => options.disabled?.() ?? false;
  const readOnly = () => options.readOnly?.() ?? false;
  const required = () => options.required?.() ?? false;

  const label = (override: string | undefined, key: MessageKey, fallback: string): string =>
    override ?? (locale.has(key) ? locale.t(key) : fallback);

  /**
   * Whether two tags are the same tag.
   *
   * Through the locale's collator rather than `toLowerCase`, which gets Turkish
   * dotless i wrong and has no opinion at all about which accents count. At
   * `accent` sensitivity "Ada" and "ada" are one tag and "resume" and "résumé"
   * are two, which is what a person sorting their own tags would say.
   */
  const same = (a: string, b: string): boolean =>
    options.caseSensitive ? a === b : locale.collator({ sensitivity: 'accent' }).compare(a, b) === 0;

  const indexOfTag = (tag: string): number =>
    untrack(() => state.get()).findIndex((existing) => same(existing, tag));

  const write = (next: readonly string[]): void => {
    state.set(next);
    options.onValueChange?.(next);
  };

  const isFull = (): boolean => options.max !== undefined && state.get().length >= options.max;

  const add = (text?: string): boolean => {
    if (disabled() || readOnly()) return false;

    const tag = transform(text ?? untrack(() => draft.get()));
    if (tag === '') return false;

    duplicate.set(null);

    if (untrack(isFull)) {
      options.onReject?.(tag, 'full');
      return false;
    }
    if (options.validateTag && !options.validateTag(tag)) {
      options.onReject?.(tag, 'invalid');
      return false;
    }

    const clash = options.allowDuplicates ? -1 : indexOfTag(tag);
    if (clash !== -1) {
      // Kept, rather than only reported: the consumer wants to flash the tag
      // that is already there, and it cannot find it without being told which.
      duplicate.set(clash);
      status.set(options.labels?.duplicate?.(tag) ?? `${tag} is already in the list`);
      options.onReject?.(tag, 'duplicate');
      return false;
    }

    write([...untrack(() => state.get()), tag]);
    draft.set('');
    status.set(options.labels?.added?.(tag) ?? `${tag} added`);
    return true;
  };

  const removeAt = (index: number): void => {
    if (disabled() || readOnly()) return;
    const current = untrack(() => state.get());
    const tag = current[index];
    if (tag === undefined) return;

    write(current.filter((_, i) => i !== index));
    duplicate.set(null);
    status.set(options.labels?.removed?.(tag) ?? `${tag} removed`);
  };

  const tagCollection = createCollection(options.list);

  /**
   * Bumped whenever the row's children change.
   *
   * The settle effect below clamps the single tab stop into the row, and it has
   * to know when the row moved. It cannot ask the value: a consumer renders the
   * row from the value but is not obliged to render all of it, so a search term
   * or a filter narrows the row while the value stands still, and a stop left
   * beyond the new end would take the whole row out of the tab order. Nor can
   * it ask the collection, which is a live DOM query with no reactive surface —
   * reading it from the props would not re-run them, because nothing they read
   * would have changed.
   *
   * So the row is observed. One observer per field, on the element the field
   * already has a reference to, watching children and the attribute that marks
   * a tag disabled.
   */
  const rowRevision = new Signal.State(0);
  effect(() => {
    const list = options.list();
    if (!list) return;
    const observer = new MutationObserver(() => {
      rowRevision.set(untrack(() => rowRevision.get()) + 1);
    });
    observer.observe(list, { childList: true, subtree: true, attributeFilter: ['data-disabled'] });
    onCleanup(() => observer.disconnect());
  });
  /**
   * Where focus is in the row, and so where the row's single stop belongs.
   *
   * One record answers both, because they are one question asked about two
   * moments: which tag Tab comes back to, and which tag takes over when the
   * one holding focus is destroyed. Kept apart they drift — a row that moves
   * under the tag holding focus moved one of them and not the other — and a
   * field whose stop is on one tag while the user is on another is the split
   * this whole model exists to close.
   *
   * It counts along the row and never along the value, for the same reason the
   * hand-off does: what it names is an element to focus. A row can show fewer
   * tags than the value holds, and an index counted against the value points
   * past the end of such a row, at no tag to leave the stop on — which leaves
   * every tag at `tabindex="-1"` and the whole row unreachable by Tab.
   *
   * Written where focus arrives rather than by each thing that moves it, so
   * that the stop cannot disagree with the tag the user is on: a click moves
   * focus too, and nothing that moves it by key ever hears about that one. The
   * row moving underneath is the one change no arrival announces, and the
   * effect below reads it back off the row for exactly that reason.
   */
  const activeTag = new Signal.State(0);

  const roving = createRovingFocus(
    tagCollection,
    () => tagCollection.at(untrack(() => activeTag.get())),
    // Where roving is about to put focus is not recorded here: the row hears it
    // arrive a moment later, along with every arrival roving knows nothing of.
    () => {},
    { orientation: 'horizontal', loop: false, typeahead: false },
  );

  /**
   * Put focus on an element, and say whether it went.
   *
   * Asking is not telling: a disabled control and an element with no tab index
   * both refuse, and the chain below has to know that it refused to go on to
   * the next place.
   */
  const takeFocus = (el: Element | null | undefined): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    el.focus();
    return el.ownerDocument.activeElement === el;
  };

  /** Returns whether the box took it, which a disabled field's will not. */
  const focusInput = (): boolean => {
    const el = options.input();
    return isValueControl(el) && takeFocus(el);
  };

  /**
   * Where focus goes when the tag holding it has been destroyed.
   *
   * The tag that took its place, the row having closed up leftwards, so it is
   * the one the eye is on already; the last tag when the row is now shorter
   * than that; the text box when no tag is left; the row itself when even the
   * box refuses it, as a disabled field's does; and the field's own root when
   * the row has gone too, which it does when a consumer renders it only while
   * there are tags. `<body>` is the one answer never given: it is the top of
   * the document, and the next Tab would start again from there.
   *
   * Measured against the row rather than against the value, because what is
   * being chosen is an element to focus: a row can show fewer tags than the
   * value holds, and an index clamped to the value would reach past the end of
   * it and abandon a row that still has tags in it.
   */
  const handOffFrom = (index: number): void => {
    const tags = tagCollection.all();
    const next = tags[Math.min(index, tags.length - 1)];
    if (next) {
      next.focus();
      return;
    }
    if (focusInput()) return;
    if (takeFocus(options.list())) return;
    takeFocus(options.root());
  };

  /**
   * The tag holding focus, and where in the row it sits.
   *
   * Remembered while the tag is still there, because the moment it matters it
   * is gone: destroying the focused element leaves the browser pointing at
   * `<body>`, which says neither which tag it was nor where. A removal is not
   * only `removeAt` and `clear` — the value is a signal a consumer can own, so
   * a `:for` over it takes the row apart for a write from anywhere — and a
   * guard at those two call sites answers for the two of them alone.
   *
   * Where it sits is not recorded beside it: that is `activeTag`, which the
   * tag holding focus is already the answer to.
   */
  let focusedTag: HTMLElement | null = null;

  effect(() => {
    const list = options.list();
    if (!list) return;

    const onFocusIn = (event: Event): void => {
      const tags = tagCollection.all();
      // The remove control lives inside the tag it removes, so focus on it is
      // focus in the tag as far as losing that tag goes.
      const target = event.target;
      const index =
        target instanceof Element ? tags.findIndex((tag) => tag.contains(target)) : -1;
      focusedTag = tags[index] ?? null;
      // The stop belongs where focus is, and this is the only place that hears
      // a click. Focus on the row itself is focus in the field but on no tag,
      // and leaves the stop where it was.
      if (index !== -1) activeTag.set(index);
    };

    // Released as soon as the user leaves the row, or a removal long afterwards
    // would pull focus back into a field nobody is in. An element already off
    // the page is not the user leaving, so its record stands: on the engines
    // that announce a removed element's focus loss, reading that as leaving
    // would cancel the very rescue it is reporting the need for.
    const onFocusOut = (event: Event): void => {
      const target = event.target;
      if (target instanceof Element && !target.isConnected) return;
      focusedTag = null;
    };

    list.addEventListener('focusin', onFocusIn);
    list.addEventListener('focusout', onFocusOut);
    onCleanup(() => {
      list.removeEventListener('focusin', onFocusIn);
      list.removeEventListener('focusout', onFocusOut);
      focusedTag = null;
    });
  });

  /**
   * Settle the record against the row every time the row is rebuilt.
   *
   * The row is rendered from the value, so `removeAt`, `clear` and a write to a
   * value signal the consumer owns all arrive here alike. An effect runs after
   * the render effects that rebuild the row and before anything paints, so the
   * tag that took the removed one's place is already on the page to receive
   * focus, and a tag that only moved along the row is still on it and keeps the
   * focus it had.
   *
   * This is where the record meets the only collection it counts along. Focus
   * arriving says where the record is; the row moving underneath is the one
   * thing that changes the answer without any focus arriving anywhere, and it
   * changes it whether a tag was destroyed or merely carried along.
   */
  effect(() => {
    const empty = state.get().length === 0;
    // Tracked, not read for its value: the row changing is the other half of
    // when this has to run, and the value's length does not report it.
    rowRevision.get();
    untrack(() => {
      // An emptied row spends what it remembered: the tags that come back are
      // new ones, and a stop left where the row was last entered would put Tab
      // into the middle of tags nobody has been in.
      if (empty) activeTag.set(0);

      const held = focusedTag;
      if (held?.isConnected) {
        // The row can close up around the tag holding focus, or open up before
        // it, without destroying it. The record has to follow, or a later
        // removal would rescue to the wrong end of the row and Tab would come
        // back to a tag nobody is on. One that has left the row altogether is
        // not the field's to rescue at all.
        const at = tagCollection.all().indexOf(held);
        if (at === -1) focusedTag = null;
        else activeTag.set(at);
      } else if (held) {
        // Let go of first, so that the focus the hand-off places is recorded as
        // the one the row now holds rather than overwritten by what it replaced.
        const at = activeTag.get();
        focusedTag = null;
        handOffFrom(at);
      }

      // With no tag holding focus nothing has spoken for the stop, and the row
      // can still have shrunk out from under it — the case no call site can be
      // guarded, since the consumer's own write is one of them. A hand-off that
      // reached a tag has already been heard as an arrival, so this passes over
      // it; one that fell through to the box or the row has not.
      if (!focusedTag) {
        const last = tagCollection.all().length - 1;
        if (last >= 0 && activeTag.get() > last) activeTag.set(last);
      }
    });
  });

  const field = createFormField({
    ...fieldOptionsFor(
      {
        input: options.input,
        label: options.label,
        description: options.description,
        errorMessage: options.errorMessage,
        id: options.id,
        disabled: options.disabled,
        readOnly: options.readOnly,
        validateOn: options.validateOn,
        revalidateOn: options.revalidateOn,
        labels: options.labels,
      },
      options.input,
    ),
    // `required` is deliberately not forwarded to the control: it would put
    // the constraint on the text input, and an empty text input next to five
    // tags is a filled-in field. The rule is about the tags, so it is checked
    // here and reported through the same custom validity.
    validate: (value, control) => {
      if (required() && untrack(() => state.get()).length === 0) {
        return label(options.labels?.empty, 'required', 'Add at least one tag.');
      }
      return options.validate?.(value, control);
    },
  });

  bindTextValue(options.input, draft, field, () => duplicate.set(null));

  const splitPasted = (text: string): string[] => {
    // A newline always splits, whatever the delimiters are: text pasted out of
    // a spreadsheet or an email arrives one item per line.
    const pattern = new RegExp(`[${escapeForClass([...delimiters, '\n', '\r'].join(''))}]`);
    return text.split(pattern);
  };

  return {
    field,
    tags: () => state.get(),
    draft: () => draft.get(),
    setDraft: (text: string) => draft.set(text),

    add,
    removeAt,
    removeLast: () => removeAt(untrack(() => state.get()).length - 1),
    clear: () => {
      write([]);
      duplicate.set(null);
    },
    isFull,
    duplicateIndex: () => duplicate.get(),
    statusText: () => status.get(),

    onKeyDown(event: KeyboardEvent): boolean {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if (disabled() || readOnly()) return false;

      const text = untrack(() => draft.get());

      if (event.key === 'Enter') {
        // With nothing half-typed, Enter is the form's. Taking it away would
        // mean a form that cannot be submitted from its last field.
        if (text === '') return false;
        event.preventDefault();
        add();
        return true;
      }

      if (delimiters.includes(event.key)) {
        event.preventDefault();
        add();
        return true;
      }

      if (event.key === 'Backspace' && text === '') {
        event.preventDefault();
        removeAt(untrack(() => state.get()).length - 1);
        return true;
      }

      // The tags sit before the box in the row, so the key that reaches them
      // is the one that moves backwards — Left where the writing runs left to
      // right, Right where it runs the other way.
      if (event.key === backKey(event) && text === '') {
        const last = tagCollection.last();
        if (!last) return false;
        event.preventDefault();
        last.focus();
        return true;
      }

      if (event.key === 'Escape' && text !== '') {
        event.preventDefault();
        draft.set('');
        return true;
      }

      return false;
    },

    onTagKeyDown(event: KeyboardEvent, index: number): boolean {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if (event.key === 'Enter') return false;
      if (disabled() || readOnly()) return false;

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        // `removeAt` moves focus off the tag before it goes: a keyboard user
        // whose focus lands on `<body>` has been thrown to the top of the
        // document.
        removeAt(index);
        return true;
      }

      // Forward off the last tag lands in the text input, which is where the
      // next thing typed belongs. Resolved against writing direction, or the
      // one key would mean both "leave the row" and "move along it" in the
      // same RTL field — roving focus below mirrors, so this has to as well.
      if (event.key === forwardKey(event) && index === tagCollection.all().length - 1) {
        event.preventDefault();
        focusInput();
        return true;
      }

      const consumed = roving.onKeyDown(event);
      if (consumed) event.preventDefault();
      return consumed;
    },

    onPaste(event: ClipboardEvent): boolean {
      if (disabled() || readOnly()) return false;
      const text = event.clipboardData?.getData('text') ?? '';
      if (text === '') return false;

      const parts = splitPasted(text);
      // A paste with nothing to split on is just typing: let the browser put
      // it in the box, where the user can still edit it before pressing Enter.
      if (parts.length < 2) return false;

      event.preventDefault();
      for (const part of parts) add(part);
      draft.set('');
      return true;
    },

    onBlur() {
      if (options.addOnBlur === false) return;
      // A half-typed tag left behind when the user tabs away is the commonest
      // way a tags field loses data.
      add();
    },

    fieldProps: () => field.fieldProps(),
    labelProps: () => field.labelProps(),
    descriptionProps: () => field.descriptionProps(),
    errorMessageProps: () => field.errorMessageProps(),

    rootProps: () =>
      defined({
        ...borrowAria(field),
        role: 'group',
        // Out of the tab order, and the end of the chain focus falls down when
        // a removal takes the tag holding it: the row can be rendered only
        // while there are tags, and a disabled field's box refuses focus, so
        // this is the last part of the field that is certain to be there.
        tabindex: '-1',
        'data-full': isFull() || undefined,
      }),

    listProps: () => ({
      role: 'list',
      'aria-label': label(options.labels?.list, 'tags', 'Tags'),
      // Focusable only to be handed focus: out of the tab order, and where the
      // rule puts it when the text box will not take it.
      tabindex: '-1',
    }),

    tagProps: (index: number) => {
      const tag = state.get()[index] ?? '';
      return defined({
        role: 'listitem',
        [ITEM_ATTRIBUTE]: true,
        'data-label': tag,
        'data-duplicate': duplicate.get() === index || undefined,
        tabindex: index === activeTag.get() ? '0' : '-1',
      });
    },

    removeProps: (index: number) => {
      const tag = state.get()[index] ?? '';
      return defined({
        type: 'button',
        'aria-label': options.labels?.remove?.(tag) ?? `${label(undefined, 'remove', 'Remove')} ${tag}`,
        // Not a tab stop of its own: the tag is one, and Backspace on it does
        // the same job. It stays reachable by pointer and by a screen reader.
        tabindex: '-1',
      });
    },

    inputProps: () =>
      defined({
        ...field.controlProps(),
        type: 'text',
        placeholder: options.placeholder,
        // The browser's own suggestions cover the box the tags are added from,
        // which is where the list itself usually is.
        autocomplete: 'off',
        autocapitalize: 'off',
        'aria-required': required() ? 'true' : undefined,
        'data-full': isFull() || undefined,
      }),

    hiddenInputProps: (index: number) =>
      defined({
        type: 'hidden',
        name: options.name,
        value: state.get()[index] ?? '',
      }),

    statusProps: () => ({
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    }),
  };
}

/** Escape a string for use inside a character class. */
function escapeForClass(chars: string): string {
  return chars.replaceAll(/[\\\]^-]/g, (char) => `\\${char}`);
}

/** The arrow that moves along the row, where the press happened. */
function forwardKey(event: KeyboardEvent): 'ArrowLeft' | 'ArrowRight' {
  return isRtl(event) ? 'ArrowLeft' : 'ArrowRight';
}

/** The arrow that moves back along it. */
function backKey(event: KeyboardEvent): 'ArrowLeft' | 'ArrowRight' {
  return isRtl(event) ? 'ArrowRight' : 'ArrowLeft';
}

/**
 * Writing direction where the press happened.
 *
 * Asked of `resolveDirection`, the one rule in the library for this question, so
 * that a row which delegates the decision — `dir="auto"`, or a direction only a
 * stylesheet states — cannot be read one way here and another way wherever else
 * it is asked. A second copy of the rule agrees only until one of them is
 * edited.
 */
function isRtl(event: KeyboardEvent): boolean {
  const target = event.currentTarget ?? event.target;
  return resolveDirection(target instanceof Element ? target : null) === 'rtl';
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

export interface RatingLabels extends FormFieldLabels {
  /** Name for one option. Default `3 of 5`. */
  item?: (value: number, max: number) => string;
  /** The whole rating, read out when it is display-only. Default `Rated 3 of 5`. */
  value?: (value: number, max: number) => string;
  /** Name for the group, when no label element names it. */
  group?: string;
}

export interface RatingOptions {
  /** The group element, so the options can be found in the order they appear. */
  group: () => Element | null | undefined;
  label?: () => Element | null | undefined;
  description?: () => Element | null | undefined;
  errorMessage?: () => Element | null | undefined;

  /** Supply a signal to control the rating from outside. Zero is unrated. */
  value?: Signal.State<number>;
  defaultValue?: number;

  /** How many whole steps. Default 5. */
  max?: number;
  /** Offer halves as well as wholes. Default false. */
  allowHalf?: boolean;
  /** Delete and Backspace set it back to zero. Default true. */
  allowClear?: boolean;

  id?: string;
  /** The shared submission name. It is what makes the hidden radios one group. */
  name?: string;

  required?: () => boolean;
  disabled?: () => boolean;
  /** A rating that reports a score rather than collecting one. */
  readOnly?: () => boolean;

  validate?: FormFieldOptions['validate'];
  validateOn?: ValidationTrigger;
  revalidateOn?: ValidationTrigger;

  labels?: RatingLabels;

  onValueChange?: (value: number) => void;
}

export interface Rating {
  readonly field: FormField;
  value(): number;
  /** The value being previewed, or the real one. What to paint. */
  displayValue(): number;
  setValue(value: number): void;
  clear(): void;
  /** Every selectable value, in order. */
  values(): number[];
  isSelected(value: number): boolean;
  /** Whether this step is filled in at the value currently shown. */
  isFilled(value: number): boolean;
  isReadOnly(): boolean;
  /** Show a value without committing to it — a pointer hovering. Null to stop. */
  preview(value: number | null): void;
  /** The whole rating as a sentence. */
  valueText(): string;

  /** Handle a keydown on the group. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;

  fieldProps(): InputProps;
  labelProps(): InputProps;
  groupProps(): InputProps;
  itemProps(value: number): InputProps;
  /** The hidden native radio that submits, per value. */
  inputProps(value: number): InputProps;
  descriptionProps(): InputProps;
  errorMessageProps(): InputProps;
}

/**
 * A star rating, which is a radio group wearing stars.
 *
 * That is not a metaphor: it composes `createRadioGroup`, so the arrows move
 * and select in one press, Home and End jump to the ends, exactly one option is
 * in the tab order, and a hidden native radio per value carries the score into
 * the form. What is added is halves, a preview for a pointer hovering, and a
 * name per option — "3 of 5" rather than "3", because a screen reader reading a
 * bare number in a row of five bare numbers has told the user nothing.
 *
 * Read-only ratings stop being a radio group altogether and become one
 * `role="img"` with the whole score as its name. A list of five radios nobody
 * can change is five tab stops that do nothing; the score is one fact, and this
 * is how a screen reader is told one fact.
 */
export function createRating(options: RatingOptions): Rating {
  const locale = useLocale();
  const max = options.max ?? 5;
  const step = options.allowHalf ? 0.5 : 1;

  const state = options.value ?? new Signal.State(options.defaultValue ?? 0);
  const previewed = new Signal.State<number | null>(null);

  const disabled = () => options.disabled?.() ?? false;
  const readOnly = () => options.readOnly?.() ?? false;
  const required = () => options.required?.() ?? false;

  const values = (): number[] => {
    const out: number[] = [];
    for (let value = step; value <= max + 1e-9; value += step) out.push(roundTo(value, 1));
    return out;
  };

  const setValue = (next: number): void => {
    if (disabled() || readOnly()) return;
    const clamped = Math.min(Math.max(next, 0), max);
    if (untrack(() => state.get()) === clamped) return;
    state.set(clamped);
    options.onValueChange?.(clamped);
  };

  /**
   * The radio group's own selection, kept in step with the number.
   *
   * Two signals because the two have different shapes — a rating is a number
   * with zero meaning unrated, a radio group is a string or nothing — and
   * because the public contract is a `Signal.State<number>` the caller can own.
   * Both setters ignore a value they already hold, so the pair settles.
   */
  const selection = new Signal.State<string | null>(null);

  effect(() => {
    const value = state.get();
    const next = value > 0 ? String(value) : null;
    if (untrack(() => selection.get()) !== next) selection.set(next);
  });

  const radios = createRadioGroup({
    group: options.group,
    value: selection,
    name: options.name,
    // `required` stops here while read-only. The platform bars a disabled
    // control from constraint validation, and a read-only one is barred for
    // the same reason: a constraint on an answer the user cannot give is a
    // form that can never be submitted, and the browser's bubble would point
    // at a radio nobody can act on. The field's own `validate` below still
    // says so on screen where the rating is editable.
    required: () => required() && !readOnly(),
    // Read-only is deliberately not folded in here. It would reach the hidden
    // radios as `disabled`, and a disabled control is left out of the submission
    // altogether — which is the one thing that separates the two states. A
    // read-only score is still the field's answer and still has to be sent.
    // Nothing is editable without it: the read-only branches below hand out no
    // radio role and no tab stop, `setValue` refuses while read-only, and
    // `onKeyDown` never reaches the group.
    disabled,
    // A rating is a row, and it does not wrap: arrowing past five stars back
    // to one is a misclick waiting to happen.
    loop: false,
    orientation: 'horizontal',
    onValueChange: (value) => setValue(Number(value)),
  });

  const itemLabel = (value: number): string =>
    options.labels?.item?.(value, max) ?? `${locale.format.number(value)} of ${max}`;

  const valueText = (): string => {
    const value = state.get();
    return (
      options.labels?.value?.(value, max) ?? `Rated ${locale.format.number(value)} of ${max}`
    );
  };

  const field = createFormField({
    ...fieldOptionsFor(
      {
        input: options.group,
        label: options.label,
        description: options.description,
        errorMessage: options.errorMessage,
        id: options.id,
        disabled: options.disabled,
        readOnly: options.readOnly,
        validateOn: options.validateOn,
        revalidateOn: options.revalidateOn,
        labels: options.labels,
      },
      options.group,
    ),
    // The hidden radios carry `required`, so the platform refuses the submit;
    // this is what puts a message on screen for it. The cost of the pair is
    // that the browser's own bubble points at a radio nobody can see — the
    // same cost every visually hidden native control pays.
    validate: (value, control) => {
      if (required() && untrack(() => state.get()) === 0) {
        return options.labels?.valueMissing ?? locale.t('required');
      }
      return options.validate?.(value, control);
    },
  });

  /**
   * The score a reset goes back to.
   *
   * A reset restores every control in the form to its default, and the hidden
   * radios have none to restore to: their checkedness is a property rather
   * than a `checked` attribute, so the browser finds `defaultChecked` false on
   * all of them and unchecks the lot. What is left is a rating that still
   * answers 4 and a form that submits nothing, which is the disagreement a
   * hidden native control exists to prevent. So the default is remembered
   * here, where it was declared.
   */
  const initial = untrack(() => state.get());

  effect(() => {
    const group = options.group();
    const form = group ? formOf(group) : null;
    if (!group || !form) return;

    // Read after a microtask, since `reset` is dispatched partway through
    // resetting, before the controls have settled.
    const onReset = () =>
      queueMicrotask(() => {
        const restored = Math.min(Math.max(initial, 0), max);
        // Not through `setValue`, which refuses while read-only or disabled —
        // and a score nobody may change is exactly the one a reset has to put
        // back rather than drop.
        if (untrack(() => state.get()) !== restored) {
          state.set(restored);
          options.onValueChange?.(restored);
        }
        // The mirrors are written by hand as well, because a reset that lands
        // on the score already held changes no signal, and nothing would then
        // re-apply the props the browser has just cleared.
        for (const mirror of group.querySelectorAll('input[type="radio"]')) {
          if (isInputElement(mirror)) mirror.checked = mirror.value === String(restored);
        }
      });

    form.addEventListener('reset', onReset);
    onCleanup(() => form.removeEventListener('reset', onReset));
  });

  const displayValue = (): number => previewed.get() ?? state.get();

  return {
    field,
    value: () => state.get(),
    displayValue,
    setValue,
    clear: () => setValue(0),
    values,
    isSelected: (value) => state.get() === value,
    isFilled: (value) => displayValue() >= value,
    isReadOnly: readOnly,
    preview: (value) => previewed.set(readOnly() || disabled() ? null : value),
    valueText,

    onKeyDown(event: KeyboardEvent): boolean {
      if (readOnly() || disabled()) return false;

      if (
        options.allowClear !== false &&
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setValue(0);
        return true;
      }

      return radios.onKeyDown(event);
    },

    fieldProps: () => field.fieldProps(),
    labelProps: () => field.labelProps(),
    descriptionProps: () => field.descriptionProps(),
    errorMessageProps: () => field.errorMessageProps(),

    groupProps: () => {
      const shared = defined({
        ...borrowAria(field),
        id: field.ids().control,
        'data-value': String(state.get()),
      });

      if (readOnly()) {
        return defined({
          ...shared,
          // One fact, said once. See the note above the function.
          role: 'img',
          'aria-label': valueText(),
          // The borrowed reference has to go with it. `aria-labelledby` beats
          // `aria-label` when a name is computed, so leaving both on would
          // name this "Rating" and never speak the score — and the stars are
          // aria-hidden, so there is no second chance at it. The alternative
          // was to keep the reference and add this element's own id to the end
          // of it, naming it "Rating Rated 4 of 5"; it lost because a
          // self-reference inside `aria-labelledby` is a trick, and the label
          // is still on screen beside the stars either way.
          'aria-labelledby': undefined,
          'data-readonly': true,
        });
      }

      return defined({
        ...radios.groupProps(),
        ...shared,
        'aria-label': options.labels?.group,
      });
    },

    itemProps: (value: number) => {
      const filled = displayValue() >= value;
      if (readOnly()) {
        // The score is on the group; the stars themselves are decoration, and
        // announcing each one would read the rating out five times.
        return { 'aria-hidden': 'true', 'data-filled': filled || undefined, 'data-value': String(value) };
      }

      return defined({
        ...radios.itemProps(String(value), disabled()),
        'aria-label': itemLabel(value),
        'data-filled': filled || undefined,
      });
    },

    inputProps: (value: number) => radios.inputProps(String(value), disabled()),
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * The field's ARIA, without its id.
 *
 * A composite is labelled, described and marked invalid exactly as a single
 * control would be, but the id belongs to the element the label's `for` points
 * at — which is the hidden input that submits, or the first box a user types
 * into, and never the wrapper.
 */
function borrowAria(field: FormField): Record<string, string | boolean | undefined> {
  const props: Record<string, string | boolean | undefined> = { ...field.controlProps() };
  delete props.id;
  return props;
}

/**
 * Drop the keys with nothing in them.
 *
 * A spread writes a property where the element has one, and assigning
 * `undefined` to `name` submits the string "undefined". Removal still works:
 * a key that disappears from the object is removed from the element.
 */
function defined(props: Record<string, string | boolean | undefined>): InputProps {
  const out: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** First `length` characters, counted the way a person counts them. */
function sliceTo(value: string, length: number): string {
  return [...value].slice(0, length).join('');
}

/**
 * Narrow by tag name rather than by `instanceof`.
 *
 * An element adopted from another document is not an instance of *this*
 * window's `HTMLInputElement`, and the constructor is a browser global that
 * does not exist at all on a server, where the check would throw rather than
 * answer.
 */
function isInputElement(el: EventTarget | null | undefined): el is HTMLInputElement {
  // Takes an `EventTarget` because every caller but one is holding an
  // `event.target`. `tagName` rather than `instanceof HTMLInputElement`, so a
  // box inside another document — an iframe, a print view — is still
  // recognised as one.
  return el instanceof Element && el.tagName === 'INPUT';
}

function isTextarea(el: Element | null | undefined): el is HTMLTextAreaElement {
  return el?.tagName === 'TEXTAREA';
}

function isValueControl(
  el: Element | null | undefined,
): el is HTMLInputElement | HTMLTextAreaElement {
  return isInputElement(el) || isTextarea(el);
}

/**
 * The form a control belongs to.
 *
 * The `form` property is the authority, because a control can be associated
 * with a form it is not inside through the `form` attribute; `closest` covers
 * anything that has no such property.
 */
function formOf(el: Element): HTMLFormElement | null {
  const owner = (el as { form?: unknown }).form;
  if (owner && typeof owner === 'object' && 'addEventListener' in owner) {
    return owner as HTMLFormElement;
  }
  return el.closest<HTMLFormElement>('form');
}
