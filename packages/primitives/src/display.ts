/**
 * Display — avatar, progress, separator, and the style that hides content from
 * eyes without hiding it from assistive technology.
 *
 * Four small things with one thing in common: nearly all of their behaviour is
 * accessibility, and the part that is easy to get wrong is what a screen reader
 * is told rather than what is drawn. None of them renders anything or has any
 * opinion about styling; each owns its state and returns prop objects to spread
 * onto whatever markup the consumer writes.
 *
 * Two of them keep quiet by default: a separator is decorative unless it is
 * told otherwise, and an avatar's image goes silent the moment its fallback is
 * on screen saying the same name. Announcing everything twice is its own kind
 * of inaccessible, and both of those repeat something already said.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { useLocale } from './i18n.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export type AvatarStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface AvatarOptions {
  /** The `<img>` element, once rendered. */
  image?: () => Element | null | undefined;
  /**
   * The fallback element, once rendered. Its presence is what makes the image
   * decorative — see `imageProps`.
   */
  fallback?: () => Element | null | undefined;

  /** What to load. Empty, null or undefined means there is no picture. */
  src?: () => string | null | undefined;
  /** Who or what is pictured: the accessible name, and the initials' source. */
  name?: () => string | null | undefined;

  /**
   * Supply a signal to control status from outside — a list that already knows
   * its images failed, say. Without one the avatar owns its own.
   */
  status?: Signal.State<AvatarStatus>;

  /**
   * Hold the fallback back for this many ms after a load starts. Default 0.
   *
   * The tradeoff is a straight swap: waiting stops initials flashing up in
   * front of an image that was already in cache, at the cost of a hole in the
   * layout for anyone whose connection is slower than the delay. 0 favours the
   * slow connection, which is why it is the default.
   */
  fallbackDelay?: number;

  /** Derive the initials yourself — see `defaultInitials` for what this replaces. */
  initials?: (name: string) => string;
  /** How many initials the default derivation returns. Default 2. */
  maxInitials?: number;

  onStatusChange?: (status: AvatarStatus) => void;
}

export interface AvatarProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface Avatar {
  status(): AvatarStatus;
  /** Whether the picture is the thing to show. The element stays mounted either way. */
  isImageVisible(): boolean;
  /** Whether the fallback is the thing to show. */
  isFallbackVisible(): boolean;
  /** Initials for the current name, or '' when there is no name. */
  initials(): string;

  rootProps(): AvatarProps;
  imageProps(): AvatarProps;
  fallbackProps(): AvatarProps;
}

/**
 * An image with a name behind it.
 *
 *   class Profile {
 *     user = new Signal.State({ name: 'Ada Lovelace', photo: '/ada.png' });
 *     img = new Signal.State<Element | null>(null);
 *     fallback = new Signal.State<Element | null>(null);
 *     avatar = createAvatar({
 *       image: () => this.img.get(),
 *       fallback: () => this.fallback.get(),
 *       src: () => this.user.get().photo,
 *       name: () => this.user.get().name,
 *     });
 *   }
 *
 *   <span :spread="avatar.rootProps()">
 *     <img :ref="img" :spread="avatar.imageProps()">
 *     <span :if="avatar.isFallbackVisible()" :ref="fallback"
 *           :spread="avatar.fallbackProps()">{ avatar.initials() }</span>
 *   </span>
 *
 * The `<img>` stays mounted throughout, because an element that is not in the
 * document never loads — that is the one thing a consumer has to know here.
 * The load is watched on the rendered element rather than through a detached
 * `new Image()`, which costs that constraint and buys three things back: no
 * second request, `srcset` and `sizes` and `crossorigin` all working because
 * the browser is doing the choosing, and no `document` global in a primitive
 * that may be run on a server. `isImageVisible()` and `isFallbackVisible()`
 * say which one the user should see, and every element carries `data-status`.
 */
export function createAvatar(options: AvatarOptions = {}): Avatar {
  const status = options.status ?? new Signal.State<AvatarStatus>('idle');
  const delay = options.fallbackDelay ?? 0;
  const maxInitials = options.maxInitials ?? 2;

  const readSrc = (): string => options.src?.() ?? '';
  const readName = (): string => options.name?.()?.trim() ?? '';

  // Whether the fallback has waited out `fallbackDelay`. Held apart from
  // status so the wait restarts with each new load rather than each change.
  const waited = new Signal.State(delay <= 0 || !untrack(readSrc));

  const setStatus = (next: AvatarStatus) => {
    // Untracked: this is called from inside an effect, which must not come to
    // depend on the value it writes — a load event would otherwise re-run the
    // effect that started the load.
    if (untrack(() => status.get()) === next) return;
    status.set(next);
    options.onStatusChange?.(next);
  };

  effect(() => {
    const src = readSrc();
    const el = options.image?.();

    if (!src) {
      setStatus('idle');
      return;
    }
    setStatus('loading');

    // The element may not exist yet — rendered under a `:if`, or simply not
    // wired up on the first run — so there is nothing to do but run again when
    // the accessor produces one.
    if (!el) return;

    // A cached image can already be complete before this first runs: its load
    // event fired while nothing was listening, and will not fire again.
    if (isComplete(el)) {
      setStatus('loaded');
      return;
    }

    const onLoad = () => setStatus('loaded');
    const onError = () => setStatus('error');
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    onCleanup(() => {
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
    });
  });

  // A load that has already finished or failed has nothing left to wait for:
  // the delay exists to cover a cache hit, not to postpone bad news.
  effect(() => {
    if (delay <= 0) return;

    if (status.get() !== 'loading') {
      waited.set(true);
      return;
    }

    waited.set(false);
    const timer = setTimeout(() => waited.set(true), delay);
    onCleanup(() => clearTimeout(timer));
  });

  /** Whether the fallback is on screen carrying the name for both of them. */
  const fallbackNames = (): boolean => Boolean(readName()) && Boolean(options.fallback?.());

  const initials = (): string => {
    const name = readName();
    if (!name) return '';
    return options.initials ? options.initials(name) : defaultInitials(name, maxInitials);
  };

  return {
    status: () => status.get(),
    isImageVisible: () => status.get() === 'loaded',
    isFallbackVisible: () => status.get() !== 'loaded' && waited.get(),
    initials,

    rootProps: () => ({ 'data-status': status.get() }),

    imageProps: () => {
      const props: Record<string, string> = {
        // Always an alt, even an empty one: an <img> with no alt attribute at
        // all is announced by reading its URL aloud.
        //
        // Empty is right whenever the fallback is on screen beside it, because
        // the fallback is already saying the name and one picture of one
        // person should not be announced twice.
        alt: fallbackNames() ? '' : readName(),
        'data-status': status.get(),
      };

      // Omitted rather than set to undefined, because `src` is a real property
      // on the element: undefined would be stringified and fetched as
      // "/undefined". Re-applying an unchanged URL is not a new load, which is
      // what lets these props be rewritten on every status change.
      const src = readSrc();
      if (src) props.src = src;

      return props;
    },

    fallbackProps: () => {
      const name = readName();
      if (!name) {
        // A blank placeholder conveys nothing; announcing it is noise, and the
        // image beside it is already carrying whatever name exists.
        return { 'aria-hidden': 'true', 'data-status': status.get() };
      }
      return {
        // Initials are an abbreviation, not a name: "AL" is either spelled out
        // or read as a word, and neither is who this is. role="img" makes the
        // label replace the text rather than be appended to it.
        role: 'img',
        'aria-label': name,
        'data-status': status.get(),
      };
    },
  };
}

/**
 * Whether an image has already finished loading successfully.
 *
 * The mirror-image inference — complete with no intrinsic width means the load
 * failed — is deliberately not made. An environment that never fetches images
 * (a server render, a test DOM) is indistinguishable from a broken one by
 * these two properties alone, and a false 'error' is worse than waiting for an
 * event that a real browser will send. Nothing visible turns on it either: the
 * fallback covers 'loading' and 'error' identically.
 */
function isComplete(el: Element): boolean {
  // `instanceof HTMLImageElement` would need the global, which does not exist
  // when rendering on a server; the element's own view has it whenever there
  // is one at all.
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;
  return el instanceof view.HTMLImageElement && el.complete && el.naturalWidth > 0;
}

let segmenter: Intl.Segmenter | null = null;

/**
 * Initials for a name.
 *
 * The first letter of the first and last word is the European convention and
 * is wrong elsewhere — a Chinese name has no spaces to split on, and plenty of
 * people have one name or five. It is a default, not a rule: `initials`
 * replaces it wholesale, per locale if need be.
 *
 * The case is left exactly as written. Upper-casing initials is a visual
 * convention, so it belongs in `text-transform`, and doing it here would need
 * a locale to be correct anyway — a Turkish "i" upper-cases to "İ", not "I".
 */
function defaultInitials(name: string, max: number): string {
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words.at(-1);
  if (first === undefined || max < 1) return '';

  // First and last, so "Ada King Lovelace" gives AL rather than AK — a middle
  // name is the part people leave out.
  const chosen = max > 1 && words.length > 1 && last !== undefined ? [first, last] : [first];

  return chosen.map(firstCharacter).join('');
}

/**
 * The first character of a word as a reader counts them.
 *
 * `word[0]` is a UTF-16 code unit, which cuts an emoji or any astral character
 * in half; a grapheme segmenter is the only thing that also keeps "é" whole
 * when it is written as "e" plus a combining accent.
 */
function firstCharacter(word: string): string {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const [grapheme] = segmenter.segment(word);
    return grapheme?.segment ?? '';
  }
  // Code points still keep an emoji whole, which is most of what this is for.
  return [...word][0] ?? '';
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export type ProgressState = 'indeterminate' | 'loading' | 'complete';

export interface ProgressLabels {
  /**
   * Announced in place of a value while the total is unknown. Default the
   * locale's `loading` — `Loading…`. Set to '' to say nothing at all.
   */
  indeterminate?: string;
}

export interface ProgressOptions {
  /**
   * Supply a signal to control the value from outside; without one the
   * progress owns it. `null` means indeterminate.
   */
  value?: Signal.State<number | null>;
  defaultValue?: number | null;

  /** Default 0. */
  min?: number;
  /** Default 100. */
  max?: number;

  /** Accessible name. Ignored when `labelledBy` is given. */
  label?: string;
  /** Id of an element that already names it on screen. Preferred over `label`. */
  labelledBy?: string;

  /**
   * A spoken alternative to the number — "3 of 8 files", say.
   *
   * Worth setting whenever the range is not 0–100, because a screen reader
   * otherwise announces a percentage it works out itself, and "37 percent" is
   * not what "step 3 of 8" should sound like.
   */
  valueText?: (value: number, percent: number) => string;

  labels?: ProgressLabels;
  onValueChange?: (value: number | null) => void;
}

export interface ProgressProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface Progress {
  /** The value, clamped to the range, or null when indeterminate. */
  value(): number | null;
  /** 0–100 for the consumer to size the indicator with, or null when indeterminate. */
  percent(): number | null;
  isIndeterminate(): boolean;
  state(): ProgressState;
  setValue(value: number | null): void;

  rootProps(): ProgressProps;
  indicatorProps(): ProgressProps;
}

/**
 * A progress bar, determinate or not.
 *
 *   class Upload {
 *     sent = new Signal.State<number | null>(0);
 *     progress = createProgress({ value: this.sent, label: 'Uploading' });
 *   }
 *
 *   <div :spread="progress.rootProps()">
 *     <div :spread="progress.indicatorProps()"></div>
 *   </div>
 *
 * The indicator's width comes from `percent()`, because a width is styling and
 * this has no business writing one.
 *
 * A null value is indeterminate, and then `aria-valuenow` is not written at
 * all. That is the whole reason the value is nullable rather than a number
 * with a separate flag: the two states have to be impossible to confuse, since
 * the wrong one is a number a screen reader will read out as though it were
 * true.
 */
export function createProgress(options: ProgressOptions = {}): Progress {
  const state = options.value ?? new Signal.State<number | null>(options.defaultValue ?? null);
  const min = options.min ?? 0;
  const max = options.max ?? 100;
  const locale = useLocale();
  // Read on every call rather than once, so a catalogue swapped later reaches
  // a bar already on screen.
  const indeterminateLabel = (): string => options.labels?.indeterminate ?? locale.t('loading');

  const value = (): number | null => {
    const raw = state.get();
    // A value that is not a real number is a caller bug. Reporting no value is
    // better than aria-valuenow="NaN", which is read out as written.
    if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
    return clamp(raw, min, max);
  };

  const percent = (): number | null => {
    const current = value();
    if (current === null) return null;
    const span = max - min;
    // A max at or below min is a caller bug too; 0 keeps the arithmetic finite
    // rather than putting NaN into the DOM.
    return span > 0 ? ((current - min) / span) * 100 : 0;
  };

  const progressState = (): ProgressState => {
    const current = value();
    if (current === null) return 'indeterminate';
    return current >= max ? 'complete' : 'loading';
  };

  const valueText = (): string | undefined => {
    const current = value();
    if (current === null) return indeterminateLabel() || undefined;
    const text = options.valueText?.(current, percent() ?? 0);
    return text || undefined;
  };

  return {
    value,
    percent,
    isIndeterminate: () => value() === null,
    state: progressState,

    setValue(next) {
      if (untrack(() => state.get()) === next) return;
      state.set(next);
      options.onValueChange?.(next);
    },

    rootProps: () => {
      const current = value();
      return {
        role: 'progressbar',
        'aria-valuemin': String(min),
        'aria-valuemax': String(max),
        // Omitted entirely while indeterminate. Sending 0 instead would be a
        // lie a screen reader repeats as fact — "0 percent" on a bar that may
        // be nearly done — and there is no ARIA value for "unknown".
        'aria-valuenow': current === null ? undefined : String(current),
        // While indeterminate this is all there is to announce, so it carries
        // the wait itself. It is a real string a user hears, so it is
        // overridable, and '' turns it off.
        'aria-valuetext': valueText(),
        'aria-labelledby': options.labelledBy,
        // One name only: an element with both is named by the reference, and
        // the ignored aria-label then drifts out of date unnoticed.
        'aria-label': options.labelledBy ? undefined : options.label,
        'data-state': progressState(),
        'data-value': current === null ? undefined : String(current),
        // No tabindex: a progressbar takes no input. Something the user can
        // change is a slider, which is a different role with a keyboard map.
      };
    },

    // The indicator needs no ARIA of its own — progressbar's children are
    // presentational, so nothing inside it reaches the accessibility tree.
    // Its width comes from `percent()`, because a width is styling.
    indicatorProps: () => {
      const current = value();
      return {
        'data-state': progressState(),
        'data-value': current === null ? undefined : String(current),
        'data-max': String(max),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Visually hidden
// ---------------------------------------------------------------------------

export type VisuallyHiddenStyle = Readonly<Record<string, string>>;

/**
 * The style that takes content off the screen but leaves it in the
 * accessibility tree — a form label with no room for one, the word "opens in a
 * new tab", the live region that announces a search's result count.
 *
 * `display: none` and `visibility: hidden` are the two things it must not do:
 * both remove the element from the accessibility tree as well as from the
 * page, which is the opposite of the point. `width: 0; height: 0` is out for
 * the same reason — a zero-sized box is dropped by some engines — so the box
 * stays 1px and is clipped away instead.
 *
 * `clip-path` has replaced `clip`, which is deprecated and kept here only for
 * engines that predate it. It costs one declaration, and the day those stop
 * mattering it can go. `white-space: nowrap` stops a long string being wrapped
 * into a 1px-wide column, which some screen readers read a line at a time.
 *
 *   class SortButton {
 *     hidden = visuallyHidden();
 *   }
 *
 *   <span :style="hidden">Sort ascending</span>
 *
 * A template resolves its names against the component, so the style is held
 * in a field rather than called from the markup, where `visuallyHidden` is not
 * a name the template can see.
 *
 * The object is frozen and shared: it is a constant, and nothing should be
 * mutating a style that other elements are using.
 */
const VISUALLY_HIDDEN: VisuallyHiddenStyle = Object.freeze({
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: '0',
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  'clip-path': 'inset(50%)',
  'white-space': 'nowrap',
  'border-width': '0',
});

export function visuallyHidden(): VisuallyHiddenStyle {
  return VISUALLY_HIDDEN;
}

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------

/**
 * Which way the separator itself runs — not which way it moves.
 *
 * `aria-orientation` on a separator describes the line, which is why `<hr>` is
 * horizontal by default. A splitter between two side-by-side panes is a
 * vertical line, and it is Left and Right that move it.
 */
export type SeparatorOrientation = 'horizontal' | 'vertical';

export interface SeparatorResizeOptions {
  /**
   * Supply a signal to control the size of the pane the splitter sizes;
   * without one the separator owns it. Units are the consumer's — a percentage
   * by default, given the 0–100 range.
   */
  value?: Signal.State<number>;
  /** Starting size when the separator owns it. Default 50. */
  defaultValue?: number;
  /** Default 0. */
  min?: number;
  /** Default 100. */
  max?: number;
  /** How far one arrow press moves it. Default 1. */
  step?: number;

  /** Id of the pane being sized, for `aria-controls`. */
  controls?: string;
  /** Enter collapses to `min` and restores. Default false. */
  collapsible?: boolean;
  /** A spoken alternative to the number — "30 percent" beats "30". */
  valueText?: (value: number) => string;

  onValueChange?: (value: number) => void;
}

export interface SeparatorOptions {
  /** Default horizontal. */
  orientation?: SeparatorOrientation;
  /**
   * A separator that only divides things visually. Default true, because most
   * of them are: a rule between two menu groups adds nothing to speech that
   * the grouping does not already say.
   */
  decorative?: boolean;

  /** Accessible name. Ignored when `labelledBy` is given. */
  label?: string;
  /** Id of an element that already names it on screen. Preferred over `label`. */
  labelledBy?: string;

  /**
   * Make it a window splitter: focusable, with a value the arrow keys move.
   * A splitter is a widget rather than a divider, so it is never decorative.
   */
  resize?: SeparatorResizeOptions;
}

export interface SeparatorProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface Separator {
  orientation(): SeparatorOrientation;
  /** The size of the pane it controls, or null when it does not resize. */
  value(): number | null;
  /** Set the size, clamped to the range. Ignored on a non-resizing separator. */
  setValue(value: number): void;
  /**
   * Handle a keydown. Returns true when it was consumed, and the caller then
   * has to prevent the default, or the browser scrolls the page for the same
   * arrow, Home or End as well.
   */
  onKeyDown(event: KeyboardEvent): boolean;

  separatorProps(): SeparatorProps;
}

/**
 * A divider, and — when it is given a size to move — a window splitter.
 *
 *   <hr :spread="separator.separatorProps()">
 *
 *   <div :spread="splitter.separatorProps()"
 *        :keydown="splitter.onKeyDown($event) && $event.preventDefault()"></div>
 *
 * `onKeyDown` says whether it consumed the key and leaves the default to the
 * caller, which has to prevent it: the arrows, Home and End it consumes would
 * otherwise scroll the page as well.
 *
 * Decorative is the default because that is what nearly every separator is: a
 * rule between two menu groups tells a screen reader nothing the grouping has
 * not already said, and role="separator" on each one turns a menu into a list
 * of announcements about lines.
 *
 * `resize` turns it into APG's window splitter: focusable, with a position the
 * arrow keys move, Home and End take to the ends, and Enter collapses when it
 * is allowed to. Moving it by pointer is not here, because a drag is layout —
 * the consumer knows where the panes are and what a pixel is worth, and this
 * does not.
 */
export function createSeparator(options: SeparatorOptions = {}): Separator {
  const orientation = options.orientation ?? 'horizontal';
  const resize = options.resize;
  // A focusable element with role="presentation" is a contradiction the
  // browser resolves by ignoring the role, so a splitter is never decorative
  // whatever was asked for.
  const decorative = resize ? false : options.decorative !== false;

  const min = resize?.min ?? 0;
  const max = resize?.max ?? 100;
  const step = resize?.step ?? 1;
  const state = resize
    ? (resize.value ?? new Signal.State(clamp(resize.defaultValue ?? 50, min, max)))
    : null;

  /** Where Enter should put it back to. Null until it has been collapsed once. */
  let restoreTo: number | null = null;

  const value = (): number | null => {
    if (!state) return null;
    const raw = state.get();
    // A value that is not a real number would reach the DOM as
    // aria-valuenow="NaN", which is announced exactly as written.
    return Number.isFinite(raw) ? clamp(raw, min, max) : min;
  };

  const setValue = (next: number): void => {
    if (!state || !Number.isFinite(next)) return;
    const clamped = clamp(next, min, max);
    if (untrack(() => state.get()) === clamped) return;
    state.set(clamped);
    resize?.onValueChange?.(clamped);
  };

  const toggleCollapse = (): boolean => {
    if (!state || !resize?.collapsible) return false;
    const current = untrack(value) ?? min;
    if (current > min) {
      restoreTo = current;
      setValue(min);
    } else {
      // Nothing remembered means it started collapsed, and the only sensible
      // reading of "restore" then is to open the pane fully.
      setValue(restoreTo ?? max);
    }
    return true;
  };

  return {
    orientation: () => orientation,
    value,
    setValue,

    onKeyDown(event: KeyboardEvent): boolean {
      // A static separator is not a widget and has no keys at all.
      if (!state) return false;
      // A modified key is a shortcut, not a resize.
      if (event.ctrlKey || event.metaKey || event.altKey) return false;

      // The keys are perpendicular to the line: a vertical splitter stands
      // between two side-by-side panes, so Left and Right move it.
      const sideways = orientation === 'vertical';
      // In RTL the primary pane is on the right, so the arrows swap with it.
      // Vertical order is never mirrored, so the other axis is left alone.
      const rtl = sideways && isRtl(event.currentTarget ?? event.target);
      const larger = rtl ? 'ArrowLeft' : 'ArrowRight';
      const smaller = rtl ? 'ArrowRight' : 'ArrowLeft';
      const increase = sideways ? larger : 'ArrowDown';
      const decrease = sideways ? smaller : 'ArrowUp';

      const current = untrack(value) ?? min;

      switch (event.key) {
        case increase:
          setValue(current + step);
          return true;
        case decrease:
          setValue(current - step);
          return true;
        // The ends are the primary pane's minimum and maximum size, not the
        // start and end of the document.
        case 'Home':
          setValue(min);
          return true;
        case 'End':
          setValue(max);
          return true;
        case 'Enter':
          return toggleCollapse();
        default:
          return false;
      }
    },

    separatorProps: () => {
      if (decorative) {
        // role="presentation" removes the element's own semantics and keeps
        // its children's, which is exactly right for a rule that is there to
        // be looked at. No aria-orientation: a presentational element takes no
        // ARIA properties, and there is nothing to orient anyway.
        return { role: 'presentation', 'data-orientation': orientation };
      }

      const props: Record<string, string | undefined> = {
        role: 'separator',
        'aria-orientation': orientation,
        'aria-labelledby': options.labelledBy,
        'aria-label': options.labelledBy ? undefined : options.label,
        'data-orientation': orientation,
      };

      const current = value();
      if (current === null) return props;

      // A splitter must be reachable by keyboard to be operable by one, and it
      // reports its position the way a slider does. It also needs a name:
      // "separator, 30" tells a user nothing about which pane moved. None is
      // invented here, because a wrong name is worse than a missing one.
      props.tabindex = '0';
      props['aria-valuenow'] = String(current);
      props['aria-valuemin'] = String(min);
      props['aria-valuemax'] = String(max);
      props['aria-valuetext'] = resize?.valueText?.(current) || undefined;
      props['aria-controls'] = resize?.controls;
      return props;
    },
  };
}

/**
 * Writing direction at `target`, by the same rule roving focus uses: the
 * nearest `dir` attribute wins over computed style, because an application
 * that writes `dir` is stating intent, and the attribute can be read before
 * styles resolve. Duplicated rather than shared only because roving focus
 * keeps its copy private; a third caller is the point at which to lift it out.
 */
function isRtl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const declared = target.closest('[dir]');
  if (declared) return declared.getAttribute('dir')?.toLowerCase() === 'rtl';

  const view = target.ownerDocument?.defaultView;
  return view?.getComputedStyle?.(target).direction === 'rtl';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
