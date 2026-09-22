/**
 * Feedback — alerts, skeletons, spinners and empty states.
 *
 * Four small components with one rule between them: **a live region has to
 * exist before the words do**. A screen reader announces what *changes* inside
 * a region, not what a region arrives holding, so the markup everybody writes
 *
 *   <div :if="failed" role="alert">Could not save</div>
 *
 * announces nothing at all in most screen readers. The region and the sentence
 * land in the same DOM mutation, and there was no region there to change. The
 * fix is the same shape every time: put the region on the page first, empty,
 * and write into it a task later.
 *
 * Every component here does that for the consumer. Each owns a region timing
 * gate and exposes it as `isMessageVisible()`; the words go inside a `:if` on
 * that, and the props that carry them also set `hidden` for the same window,
 * so a consumer who ignores the flag still gets the timing right.
 *
 * Two consequences worth knowing before reading further:
 *
 *   - **Politeness is fixed when the region is created.** Changing `aria-live`
 *     or `role` on a region that already exists is not reliably picked up, so
 *     an alert that has to switch between polite and assertive needs two
 *     regions, not one option. The tradeoff is a component that cannot change
 *     its mind, in exchange for one that is actually heard.
 *   - **No region here is given a name.** `aria-label` and `aria-labelledby`
 *     on a live region are announced *instead of* its contents in some screen
 *     readers, which for a message region is the whole message lost.
 *
 * Nothing here renders or has an opinion about styling. Each component owns
 * its state and returns prop objects to spread onto the consumer's markup.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createPresence, type PresenceState } from './presence.js';
import { createCollection, ITEM_ATTRIBUTE } from './collection.js';
import { createDismiss } from './dismiss.js';
import { useProvidedLocale, type Locale, type MessageKey, type MessageValues } from './i18n.js';
import { createId } from './id.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

/** An event handler placed in a prop bag, e.g. `onclick`. */
export type FeedbackHandler = (event: Event) => void;

export interface FeedbackProps {
  readonly [key: string]: string | boolean | undefined | FeedbackHandler;
}

/**
 * How long a region must have been in the document before words written into
 * it are announced, in milliseconds.
 *
 * Long enough that the region's own insertion and the message are two separate
 * mutations rather than one, short enough that nobody sees the message arrive
 * late. There is no specified number — screen readers poll the accessibility
 * tree on their own schedules — so this is the smallest delay that reliably
 * separates the two, and every component takes an override.
 */
const ANNOUNCE_DELAY = 50;

/**
 * A default string: the provided locale's catalogue first, then English.
 *
 * `loading` is one of the library's own keys and always resolves under a
 * provider. The rest — `dismiss`, `loaded`, `emptyState`, `noResultsFor` — are
 * not, so a catalogue that declares them is heard and without one the English
 * stands. Only a provider is asked: without one, the locale `useLocale` would
 * build in its place has no catalogue but the defaults, which say what the
 * English here says, and building it would put the whole locale into a bundle
 * that never translates anything. Read on every call, so a catalogue swapped
 * later reaches words already on screen.
 */
function word(
  locale: Locale | null,
  key: MessageKey,
  fallback: string,
  values?: MessageValues,
): string {
  return locale?.has(key) ? locale.t(key, values) : fallback;
}

// ---------------------------------------------------------------------------
// Live region timing
// ---------------------------------------------------------------------------

export interface LiveRegionTiming {
  /** Whether words written into the region now would actually be announced. */
  isReady(): boolean;
}

/**
 * The rule at the top of this file, on its own, for a region of your making.
 *
 *   class Save {
 *     region = new Signal.State<Element | null>(null);
 *     timing = createLiveRegionTiming(() => this.region.get());
 *   }
 *
 *   <div :ref="region" role="status" aria-live="polite">
 *     <span :if="timing.isReady()">{ message() }</span>
 *   </div>
 *
 * A region that is mounted for the life of the page becomes ready once, early,
 * and never blocks anything again — which is why keeping the region mounted is
 * the shape to reach for first. A region rendered under `:if` is re-armed on
 * every appearance, and pays the delay each time.
 *
 * `delay` of zero turns the wait off entirely. That is only ever right for a
 * region that was already on the page, where the message is itself the first
 * mutation; used on a region under `:if` it reinstates the bug.
 */
export function createLiveRegionTiming(
  region: () => Element | null | undefined,
  delay: number = ANNOUNCE_DELAY,
): LiveRegionTiming {
  const ready = new Signal.State(false);

  effect(() => {
    const el = region();

    // Not in the document, so there is nothing to announce into. Volt runs
    // this again when the ref lands, by which point the node is inserted.
    if (!el?.isConnected) {
      ready.set(false);
      return;
    }

    if (delay <= 0) {
      ready.set(true);
      return;
    }

    const timer = setTimeout(() => ready.set(true), delay);
    onCleanup(() => clearTimeout(timer));
  });

  return { isReady: () => ready.get() };
}

/**
 * Timing for a region a component may not have been handed.
 *
 * Three of the four components take the region accessor as optional, because a
 * consumer who wants no announcement should not have to wire one up. Without
 * the element there is nothing to observe, so the gate opens rather than
 * closing: silently hiding a message the consumer did render would be a worse
 * failure than one announced a little early, and it would be invisible to
 * everyone who can see the screen.
 */
function regionTiming(
  region: (() => Element | null | undefined) | undefined,
  delay: number | undefined,
): LiveRegionTiming {
  return region ? createLiveRegionTiming(region, delay) : { isReady: () => true };
}

// ---------------------------------------------------------------------------
// Deferred visibility
// ---------------------------------------------------------------------------

/** Whether a loading indicator is off, waiting out its delay, or on screen. */
export type LoadingState = 'idle' | 'delayed' | 'visible';

export interface DeferredVisibilityOptions {
  /**
   * Wait this long before showing anything, in milliseconds. A response that
   * arrives first is never accompanied by a flash of loading state.
   */
  delay?: number;
  /**
   * Once shown, stay shown for at least this long, in milliseconds.
   *
   * The delay alone does not remove the flash, it moves it: a response landing
   * just after the delay still puts an indicator on screen for a few frames.
   * The pair is the whole rule. The cost is real content held back for up to
   * `minDuration`, which is why this is zero unless asked for.
   */
  minDuration?: number;
}

export interface DeferredVisibility {
  /** Whether the indicator should be on screen. */
  isVisible(): boolean;
  state(): LoadingState;
}

/**
 * Show something only if the wait is long enough to be worth showing.
 *
 * Used by the skeleton and the spinner, and useful on its own for any other
 * indicator with the same problem.
 */
export function createDeferredVisibility(
  active: () => boolean,
  options: DeferredVisibilityOptions = {},
): DeferredVisibility {
  const delay = options.delay ?? 0;
  const minDuration = options.minDuration ?? 0;

  const visible = new Signal.State(false);
  /** When the indicator went up, to measure `minDuration` from. */
  let shownAt = 0;

  const show = (): void => {
    shownAt = Date.now();
    visible.set(true);
  };

  effect(() => {
    const on = active();
    // Read without subscribing: this effect writes `visible`, and depending on
    // it as well would make each write schedule another run.
    const shown = untrack(() => visible.get());

    if (on) {
      // Already up — including still up on its minimum from a previous wait,
      // which is the case that must not restart the clock.
      if (shown) return;
      if (delay <= 0) {
        show();
        return;
      }
      const timer = setTimeout(show, delay);
      onCleanup(() => clearTimeout(timer));
      return;
    }

    if (!shown) return;

    const remaining = minDuration - (Date.now() - shownAt);
    if (remaining <= 0) {
      visible.set(false);
      return;
    }
    const timer = setTimeout(() => visible.set(false), remaining);
    onCleanup(() => clearTimeout(timer));
  });

  const state = (): LoadingState => {
    if (visible.get()) return 'visible';
    return active() ? 'delayed' : 'idle';
  };

  return { isVisible: () => visible.get(), state };
}

// ---------------------------------------------------------------------------
// Alert
// ---------------------------------------------------------------------------

/** Whether an alert interrupts what is being read, or waits for a gap. */
export type AlertPriority = 'assertive' | 'polite';

export interface AlertLabels {
  /** Accessible name for the dismiss control. Default the locale's `dismiss`, or `Dismiss`. */
  dismiss?: string;
}

export interface AlertOptions {
  /** The live region element, once rendered. */
  region: () => Element | null | undefined;

  /**
   * `assertive` interrupts whatever a screen reader is saying; `polite` waits
   * for a gap. Default `assertive`, which is what `role="alert"` means.
   *
   * Reserve it for something the user must act on now — a failure, a session
   * about to expire. Everything else is `polite`: an assertive region cuts off
   * a sentence mid-word, and a page that interrupts for confirmations trains
   * people to ignore it.
   *
   * Fixed for the life of the alert, deliberately: see the file header.
   */
  priority?: AlertPriority;

  /**
   * Supply a signal to control the alert from outside — a form that already
   * holds its own error state, say. Without one it owns its own.
   */
  open?: Signal.State<boolean>;
  defaultOpen?: boolean;

  /**
   * Escape dismisses it. Default true.
   *
   * Only with focus inside the alert. An alert is not a layer, and one that
   * swallowed the page's Escape would take it from the dialog or the menu it
   * sits in — so it joins the dismiss stack while focus is in it and leaves it
   * as focus does. Inside an open dialog it is then the topmost layer, and one
   * press closes the alert and leaves the dialog open.
   */
  closeOnEscape?: boolean;

  /** Override the region timing described in the file header. */
  announceDelay?: number;

  labels?: AlertLabels;
  onOpenChange?: (open: boolean) => void;
}

export type AlertProps = FeedbackProps;

export interface Alert {
  /** Whether the alert is logically up. */
  isOpen(): boolean;
  /** Whether the region should be in the DOM — stays true during an exit animation. */
  isPresent(): boolean;
  /** Whether the message may be rendered yet. False until the region has settled. */
  isMessageVisible(): boolean;
  /** `open` or `closed`, for CSS to animate against. */
  state(): PresenceState;
  priority(): AlertPriority;

  open(): void;
  close(): void;
  toggle(): void;

  rootProps(): AlertProps;
  messageProps(): AlertProps;
  dismissProps(): AlertProps;
}

/**
 * A message announced where the user already is.
 *
 *   class Editor {
 *     region = new Signal.State<Element | null>(null);
 *     failed = createAlert({ region: () => this.region.get() });
 *   }
 *
 *   <div :ref="region" :spread="failed.rootProps()">
 *     <p :if="failed.isMessageVisible()" :spread="failed.messageProps()">
 *       Could not save. Check your connection.
 *       <button :spread="failed.dismissProps()">×</button>
 *     </p>
 *   </div>
 *
 * The region element stays mounted whether or not there is anything to say —
 * that is the recommended shape, and it makes the announcement immediate. A
 * consumer who wants the node gone can render it under `:if="isPresent()"`
 * instead and pay the announce delay on each appearance; both work.
 *
 * An alert never takes focus. Moving focus to announce would interrupt
 * whatever the user was typing, and the live region is what makes that
 * unnecessary. A message that *must* be dealt with before anything else is a
 * modal `alertdialog`, which is a dialog, not this.
 */
export function createAlert(options: AlertOptions): Alert {
  const state = options.open ?? new Signal.State(options.defaultOpen ?? false);
  const priority: AlertPriority = options.priority ?? 'assertive';
  const labels = options.labels ?? {};
  const locale = useProvidedLocale();

  const timing = createLiveRegionTiming(() => options.region(), options.announceDelay);

  const isMessageVisible = (): boolean => state.get() && timing.isReady();

  /** Where focus was before it entered the alert, so a dismiss can put it back. */
  let focusOrigin: HTMLElement | null = null;
  /** Whether focus is inside the alert, which is the only time Escape is its. */
  const focusWithin = new Signal.State(false);

  // An alert does not take focus, so this is only ever spent when the user
  // walked into it themselves — to press dismiss.
  effect(() => {
    if (!state.get() || typeof document === 'undefined') return;

    focusOrigin = activeElement();
    focusWithin.set(isInRegion(focusOrigin));

    const onFocusIn = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const within = isInRegion(target);
      focusWithin.set(within);
      // Moving between the alert's own controls is not an entry into it.
      if (within) return;
      focusOrigin = target;
    };
    // Focus leaving for nothing at all — a click on the page's background —
    // raises no focusin to say where it went.
    const onFocusOut = (event: Event) => {
      if ((event as FocusEvent).relatedTarget === null) focusWithin.set(false);
    };
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);

    onCleanup(() => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      focusOrigin = null;
    });
  });

  function isInRegion(node: Node | null): boolean {
    return node !== null && (options.region()?.contains(node) ?? false);
  }

  /**
   * Take focus out of the alert before the alert goes.
   *
   * Without this the focused node is removed under the user and focus falls to
   * `<body>`, dropping a keyboard user at the top of the document with no way
   * back to what they were doing.
   */
  const returnFocus = (): void => {
    const region = options.region();
    const active = activeElement();
    if (!region || !active || !region.contains(active)) return;
    // Only somewhere that still exists; otherwise leaving focus where the
    // browser puts it beats sending it somewhere arbitrary.
    if (focusOrigin?.isConnected) focusOrigin.focus();
  };

  const setOpen = (next: boolean): void => {
    if (untrack(() => state.get()) === next) return;
    // Before the write rather than in an effect after it: the message is
    // removed by a render effect reading this same signal, and render effects
    // settle completely before any user effect runs, so by then the focused
    // node has already gone and focus is already on `<body>`. The cost is that
    // a consumer who writes their own `open` signal directly closes the alert
    // without passing through here, and owns where focus lands.
    if (!next) returnFocus();
    state.set(next);
    options.onOpenChange?.(next);
  };

  const presence = createPresence(
    () => state.get(),
    () => options.region(),
  );

  // Escape is the alert's only while focus is inside it, and then the alert is
  // a layer like any other: onto the dismiss stack as focus enters, so an
  // alert inside an open dialog is the topmost layer and one press closes the
  // alert alone, and off it as focus leaves, so the page's Escape — a
  // dialog's, a menu's — is never the alert's to take.
  effect(() => {
    if (!state.get() || options.closeOnEscape === false || !focusWithin.get()) return;
    createDismiss(
      () => options.region(),
      () => setOpen(false),
      { outsidePointer: false },
    );
  });

  // Built once and handed out unchanged. `:spread` reattaches everything it
  // holds on every update, and the DOM only ignores a repeated listener when it
  // is the very same function — a fresh arrow per update would leave an extra
  // listener behind each time.
  const onDismissClick: FeedbackHandler = () => setOpen(false);

  const onDismissKeyDown: FeedbackHandler = (event) => {
    if (!isKeyboardEvent(event)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // A modified key is a shortcut, not an activation.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isNativeButton(elementOf(event.currentTarget))) return;

    // Space scrolls the page otherwise.
    event.preventDefault();
    setOpen(false);
  };

  return {
    isOpen: () => state.get(),
    isPresent: () => presence.isPresent(),
    isMessageVisible,
    state: () => presence.state(),
    priority: () => priority,

    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!untrack(() => state.get())),

    rootProps: () => ({
      // The role and the `aria-live` say the same thing on purpose: the role's
      // implicit value satisfies the specification, and some assistive
      // technology still honours only the explicit attribute.
      role: priority === 'assertive' ? 'alert' : 'status',
      'aria-live': priority,
      // The message is read whole on every change rather than only the words
      // that differ; half a sentence is worse than a repeat.
      'aria-atomic': 'true',
      // No `aria-busy` here. On a live region it means "do not announce me
      // yet", which would silence the one thing this element is for.
      'data-state': presence.state(),
      'data-priority': priority,
    }),

    messageProps: () => ({
      // Belt and braces with `isMessageVisible()`: a consumer who renders the
      // message unconditionally still has it hidden — from the accessibility
      // tree as well as the screen — until the region has settled.
      hidden: isMessageVisible() ? undefined : true,
      'data-state': presence.state(),
    }),

    dismissProps: () => ({
      // Headless cannot see which element it was handed, so both cases are
      // covered at once: `role` is redundant on a `<button>` and the only thing
      // that makes a `<div>` announce as one, and `type` is inert on a `<div>`
      // and the only thing stopping a `<button>` submitting the form it sits in.
      role: 'button',
      type: 'button',
      tabindex: '0',
      // A dismiss control is usually a glyph, and "times" is not a label.
      'aria-label': labels.dismiss ?? word(locale, 'dismiss', 'Dismiss'),
      onclick: onDismissClick,
      onkeydown: onDismissKeyDown,
    }),
  };
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export interface SkeletonLabels {
  /** Announced while the placeholder is up. Default the locale's `loading` — `Loading…`. */
  loading?: string;
  /**
   * Announced once the content has arrived. Default the locale's `loaded`, or
   * `Loaded`. Set to '' to say nothing, which is right when the content
   * announces itself some other way.
   */
  loaded?: string;
}

export interface SkeletonOptions {
  /** The live region carrying the loading message, once rendered. */
  region?: () => Element | null | undefined;

  /**
   * Supply a signal to drive the placeholder from outside — a resource's own
   * status, most often. Without one the skeleton owns it.
   */
  loading?: Signal.State<boolean>;
  defaultLoading?: boolean;

  /**
   * Hold the placeholder back this long, in milliseconds. Default 0.
   *
   * Zero, unlike the spinner's, because a skeleton *is* the layout: delaying it
   * shows a blank hole first and then a jump, which is worse than the flash it
   * would have avoided. The words in the status region wait with it, so a load
   * that ends inside the delay is neither shown nor mentioned.
   */
  delay?: number;
  /** Once up, keep it up at least this long, in milliseconds. Default 0. */
  minDuration?: number;

  /** Override the region timing described in the file header. */
  announceDelay?: number;

  labels?: SkeletonLabels;
  onLoadingChange?: (loading: boolean) => void;
}

export type SkeletonProps = FeedbackProps;

export interface Skeleton {
  isLoading(): boolean;
  /** Whether the placeholder should be on screen. */
  isVisible(): boolean;
  state(): LoadingState;
  /** What the status region should say right now, or '' for nothing. */
  message(): string;
  /** Whether that message may be rendered yet. */
  isMessageVisible(): boolean;
  setLoading(loading: boolean): void;

  /** The placeholder itself — the boxes and lines. */
  placeholderProps(): SkeletonProps;
  /** The container the real content lands in. */
  contentProps(): SkeletonProps;
  /** The live region. Keep it mounted; see the file header. */
  statusProps(): SkeletonProps;
  /** The words inside that region. */
  messageProps(): SkeletonProps;
}

/**
 * A placeholder that stands in for content while it loads.
 *
 *   class Feed {
 *     region = new Signal.State<Element | null>(null);
 *     loading = new Signal.State(true);
 *     skeleton = createSkeleton({
 *       loading: this.loading,
 *       region: () => this.region.get(),
 *     });
 *   }
 *
 *   <div :spread="skeleton.contentProps()">
 *     <div :if="skeleton.isVisible()" :spread="skeleton.placeholderProps()">
 *       <div class="line"></div><div class="line"></div>
 *     </div>
 *     <article :if="!skeleton.isLoading()">…</article>
 *   </div>
 *   <div :ref="region" :spread="skeleton.statusProps()">
 *     <span :if="skeleton.isMessageVisible()"
 *           :spread="skeleton.messageProps()">{ skeleton.message() }</span>
 *   </div>
 *
 * The placeholder is hidden from assistive technology and inert. Left visible
 * to it, a dozen empty boxes are read out as a dozen empty boxes and tabbed
 * through one by one, which is why the sentence in the status region exists:
 * one "Loading…" instead of the wall.
 *
 * `aria-hidden` alone would be a lie on any placeholder holding something
 * focusable, since hiding a focusable element from the accessibility tree
 * leaves it reachable by Tab and nameless when it gets there. `inert` covers
 * the tab order and pointer events too, and the pair is exact.
 */
export function createSkeleton(options: SkeletonOptions = {}): Skeleton {
  const state = options.loading ?? new Signal.State(options.defaultLoading ?? false);
  const labels = options.labels ?? {};
  const locale = useProvidedLocale();

  const visibility = createDeferredVisibility(() => state.get(), {
    delay: options.delay,
    minDuration: options.minDuration,
  });

  const timing = regionTiming(options.region, options.announceDelay);

  /**
   * Whether the placeholder has been on screen since the last load began.
   *
   * The words follow the placeholder, as the spinner's follow its graphic: a
   * wait too short to show is a wait too short to mention, so `delay` holds
   * back "Loading…" with the boxes. It is also what makes "Loaded" true.
   * Without it a page that was never loading announces "Loaded" the moment
   * its status region settles, and a wait nobody saw announces an end to it.
   */
  const shown = new Signal.State(false);
  effect(() => {
    if (visibility.isVisible()) shown.set(true);
    // A load that has begun and not yet shown has, so far, nothing to say.
    else if (state.get()) shown.set(false);
  });

  const message = (): string => {
    if (!shown.get()) return '';
    if (state.get()) return labels.loading ?? word(locale, 'loading', 'Loading…');
    return labels.loaded ?? word(locale, 'loaded', 'Loaded');
  };

  const isMessageVisible = (): boolean => timing.isReady() && message() !== '';

  return {
    isLoading: () => state.get(),
    isVisible: () => visibility.isVisible(),
    state: () => visibility.state(),
    message,
    isMessageVisible,

    setLoading(next) {
      if (untrack(() => state.get()) === next) return;
      state.set(next);
      options.onLoadingChange?.(next);
    },

    placeholderProps: () => ({
      // Nothing in here is content: it is the shape content will take.
      'aria-hidden': 'true',
      inert: true,
      'data-state': visibility.state(),
    }),

    contentProps: () => ({
      // "Being rebuilt — wait before reading me". On the content, never on the
      // live region, where it would mean "do not announce" and silence the
      // message this component exists to deliver.
      'aria-busy': state.get() ? 'true' : undefined,
      'data-state': visibility.state(),
    }),

    statusProps: () => ({
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-state': visibility.state(),
    }),

    messageProps: () => ({
      // The same rule as the flag above, for a consumer who renders the words
      // unconditionally: see the note on the alert's `messageProps`.
      hidden: isMessageVisible() ? undefined : true,
    }),
  };
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

export interface SpinnerLabels {
  /** What the wait is called. Default the locale's `loading` — `Loading…`. */
  loading?: string;
}

export interface SpinnerOptions {
  /** The live region carrying the label, once rendered. */
  region?: () => Element | null | undefined;

  /** Supply a signal to drive it from outside. Without one the spinner owns it. */
  loading?: Signal.State<boolean>;
  defaultLoading?: boolean;

  /**
   * Wait this long before showing anything, in milliseconds. Default 500.
   *
   * Under about a second, feedback costs more than it buys: the spinner is on
   * and off again before it can be read, and the flicker reads as a fault. 500
   * is the usual compromise — long enough to skip most responses, short enough
   * that a real wait is acknowledged before anyone reaches to click again.
   */
  delay?: number;
  /** Once up, keep it up at least this long, in milliseconds. Default 0. */
  minDuration?: number;

  /** Override the region timing described in the file header. */
  announceDelay?: number;

  labels?: SpinnerLabels;
  onLoadingChange?: (loading: boolean) => void;
}

export type SpinnerProps = FeedbackProps;

export interface Spinner {
  isLoading(): boolean;
  /** Whether the spinner should be on screen — false during the delay. */
  isVisible(): boolean;
  state(): LoadingState;
  /** The localised name of the wait. */
  label(): string;
  /** Whether that label may be rendered into the region yet. */
  isMessageVisible(): boolean;
  setLoading(loading: boolean): void;

  /** The live region. Keep it mounted; see the file header. */
  rootProps(): SpinnerProps;
  /** The graphic — the ring, the dots, whatever spins. */
  indicatorProps(): SpinnerProps;
  /** The words. Usually the visually-hidden twin of the graphic. */
  labelProps(): SpinnerProps;
  /** Whatever the user is waiting for. */
  contentProps(): SpinnerProps;
}

/**
 * A busy indicator that does not flash, and says what it is.
 *
 *   class Save {
 *     region = new Signal.State<Element | null>(null);
 *     spinner = createSpinner({ region: () => this.region.get() });
 *     hidden = visuallyHidden();
 *   }
 *
 *   <div :ref="region" :spread="spinner.rootProps()">
 *     <svg :if="spinner.isVisible()" :spread="spinner.indicatorProps()">…</svg>
 *     <span :if="spinner.isMessageVisible()" :spread="spinner.labelProps()"
 *           :style="hidden">{ spinner.label() }</span>
 *   </div>
 *
 * The graphic is hidden from assistive technology and the label carries the
 * meaning, because a spinning ring has no accessible name and an SVG announced
 * by its markup is noise. `visuallyHidden()` from `./display.js` is the usual
 * way to keep the label off the screen without keeping it out of the
 * accessibility tree — a label styled `display: none` is a label nobody hears.
 *
 * The label is not put on the root as `aria-label`: a name on a live region is
 * announced instead of its contents in some screen readers.
 */
export function createSpinner(options: SpinnerOptions = {}): Spinner {
  const state = options.loading ?? new Signal.State(options.defaultLoading ?? false);
  const labels = options.labels ?? {};
  const locale = useProvidedLocale();

  const visibility = createDeferredVisibility(() => state.get(), {
    delay: options.delay ?? 500,
    minDuration: options.minDuration,
  });

  const timing = regionTiming(options.region, options.announceDelay);

  // Nothing is announced during the delay, on purpose: a wait too short to show
  // is a wait too short to mention.
  const isMessageVisible = (): boolean => visibility.isVisible() && timing.isReady();

  return {
    isLoading: () => state.get(),
    isVisible: () => visibility.isVisible(),
    state: () => visibility.state(),
    label: () => labels.loading ?? word(locale, 'loading', 'Loading…'),
    isMessageVisible,

    setLoading(next) {
      if (untrack(() => state.get()) === next) return;
      state.set(next);
      options.onLoadingChange?.(next);
    },

    rootProps: () => ({
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-state': visibility.state(),
    }),

    indicatorProps: () => ({
      'aria-hidden': 'true',
      'data-state': visibility.state(),
    }),

    labelProps: () => ({
      hidden: isMessageVisible() ? undefined : true,
    }),

    contentProps: () => ({
      'aria-busy': state.get() ? 'true' : undefined,
      'data-state': visibility.state(),
    }),
  };
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

/** Whether a collection is still filling, has nothing in it, or has content. */
export type EmptyStateStatus = 'loading' | 'empty' | 'filled';

export interface EmptyStateLabels {
  /**
   * Nothing here, and nothing was filtered out. Default the locale's
   * `emptyState`, or `Nothing here yet.`.
   */
  empty?: string;
  /**
   * Nothing matched the current search. Given the query. Default the locale's
   * `noResultsFor`, with the query as `{query}`, or `No results for “query”.`.
   */
  noResults?: (query: string) => string;
}

export interface EmptyStateOptions {
  /**
   * The collection this describes — the list, grid or table the items are in.
   * Keep it mounted when it is empty: an empty list is still a list, and
   * "list, 0 items" is information a screen reader user should get.
   */
  collection: () => Element | null | undefined;
  /** The empty state's own element, which is the live region, once rendered. */
  region?: () => Element | null | undefined;

  /**
   * How many items the collection holds.
   *
   * Left out, the items are counted from the DOM and watched for changes. That
   * costs a `MutationObserver` and only sees items marked with
   * `data-volt-item`, the attribute the rest of the library's collections use;
   * passing the count is cheaper and exact. Until the DOM has been counted —
   * on a server, and until the page attaches — the collection is not taken to
   * be empty.
   */
  count?: () => number;
  /** The attribute marking an item, when counting from the DOM. */
  itemAttribute?: string;

  /** The search or filter that produced the emptiness, if there is one. */
  query?: () => string | null | undefined;
  /**
   * Whether the collection is still loading. An empty collection mid-load is
   * not empty, and saying "no results" before the results arrive is the bug
   * this option exists to prevent.
   */
  loading?: () => boolean;

  /** Override the region timing described in the file header. */
  announceDelay?: number;

  labels?: EmptyStateLabels;
}

export type EmptyStateProps = FeedbackProps;

export interface EmptyState {
  /** Whether the collection is empty and has finished loading. */
  isEmpty(): boolean;
  /**
   * How many items the collection holds. Counted from the DOM, it is 0 until
   * the DOM has been counted — on a server, and until the page attaches — so
   * a count shown to the reader wants the `count` option. `status()` and
   * `isEmpty()` do not take an uncounted collection to be empty.
   */
  count(): number;
  status(): EmptyStateStatus;
  /** What to show and announce, or '' when there is nothing to say. */
  message(): string;
  /** Whether that message may be rendered yet. */
  isMessageVisible(): boolean;

  /** The collection element, which the message is attached to. */
  collectionProps(): EmptyStateProps;
  /** The empty state's own element, which is the live region. */
  rootProps(): EmptyStateProps;
  /** The words inside it. */
  messageProps(): EmptyStateProps;
}

/**
 * What a collection says when it holds nothing.
 *
 *   class Results {
 *     list = new Signal.State<Element | null>(null);
 *     region = new Signal.State<Element | null>(null);
 *     query = new Signal.State('');
 *     empty = createEmptyState({
 *       collection: () => this.list.get(),
 *       region: () => this.region.get(),
 *       count: () => this.matches().length,
 *       query: () => this.query.get(),
 *     });
 *   }
 *
 *   <ul :ref="list" :spread="empty.collectionProps()">
 *     <li :for="row in matches()" :key="row.id" data-volt-item>{ row.name }</li>
 *   </ul>
 *   <div :ref="region" :spread="empty.rootProps()">
 *     <div :if="empty.isMessageVisible()" :spread="empty.messageProps()">
 *       <h3>{ empty.message() }</h3>
 *       <button :click="clear()">Clear the search</button>
 *     </div>
 *   </div>
 *
 * The message is tied to the collection with `aria-describedby`, and only while
 * there is a message: a reference to an element holding nothing describes
 * nothing, and one to an id that is not on the page is worse still, because it
 * hides the fact that the description is missing.
 *
 * The reason it is also a live region: filtering a list to nothing is a change
 * a sighted user sees and a screen reader user is told about only if something
 * announces it. Without this the list silently empties.
 */
export function createEmptyState(options: EmptyStateOptions): EmptyState {
  const labels = options.labels ?? {};
  const locale = useProvidedLocale();
  const messageId = createId('empty-state');

  const timing = regionTiming(options.region, options.announceDelay);

  // A disabled item is still an item, so nothing is skipped: emptiness is
  // about what is there, not about what can be reached.
  const items = createCollection(() => options.collection(), {
    attribute: options.itemAttribute ?? ITEM_ATTRIBUTE,
    skipDisabled: false,
  });

  /** What the DOM held when it was last counted, or null before it has been. */
  const observed = new Signal.State<number | null>(null);

  // Only when the consumer has not said. `all()` reads the DOM, which is not
  // reactive by itself, so the count is mirrored into a signal and the DOM is
  // watched for the changes that move it.
  if (!options.count) {
    effect(() => {
      const root = options.collection();
      if (!root) {
        observed.set(0);
        return;
      }

      const recount = () => observed.set(items.all().length);
      recount();

      // No observer to watch with — a DOM that is not a browser's — and the
      // count taken above is the only one there will be. A server never gets
      // this far: it does not run this effect at all, which is why `status`
      // has to tell a count not yet taken from a count of zero.
      if (typeof MutationObserver === 'undefined') return;

      // `subtree`, because rows are commonly nested in a `<tbody>` or a group
      // rather than being direct children.
      const observer = new MutationObserver(recount);
      observer.observe(root, { childList: true, subtree: true });
      onCleanup(() => observer.disconnect());
    });
  }

  const count = (): number => options.count?.() ?? observed.get() ?? 0;

  const status = (): EmptyStateStatus => {
    if (options.loading?.()) return 'loading';
    // Not yet counted — on a server, which never runs the effect above, and
    // until the page attaches — is not the same as counted and found to be
    // zero. Calling a list with rows in it empty is the worse of the two
    // mistakes, and the count arrives with the page either way.
    const known = options.count ? options.count() : observed.get();
    return known === 0 ? 'empty' : 'filled';
  };

  const isEmpty = (): boolean => status() === 'empty';

  const message = (): string => {
    if (!isEmpty()) return '';
    const query = options.query?.()?.trim() ?? '';
    if (!query) return labels.empty ?? word(locale, 'emptyState', 'Nothing here yet.');
    // Two different messages because they call for two different actions:
    // nothing yet means create something, no matches means search for
    // something else, and one sentence cannot mean both.
    if (labels.noResults) return labels.noResults(query);
    return word(locale, 'noResultsFor', `No results for “${query}”.`, { query });
  };

  const isMessageVisible = (): boolean => isEmpty() && timing.isReady();

  return {
    isEmpty,
    count,
    status,
    message,
    isMessageVisible,

    collectionProps: () => ({
      'aria-describedby': isEmpty() ? messageId : undefined,
      // Announce the list once it has settled rather than partway through
      // being filled, which is what a screen reader would otherwise read.
      'aria-busy': status() === 'loading' ? 'true' : undefined,
      'data-status': status(),
      'data-empty': isEmpty() ? '' : undefined,
    }),

    rootProps: () => ({
      id: messageId,
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-status': status(),
    }),

    messageProps: () => ({
      // The same rule as the flag above, for a consumer who renders the words
      // unconditionally: see the note on the alert's `messageProps`.
      hidden: isMessageVisible() ? undefined : true,
    }),
  };
}

// ---------------------------------------------------------------------------
// Shared odds and ends
// ---------------------------------------------------------------------------

function activeElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.activeElement;
  return el instanceof HTMLElement ? el : null;
}

function elementOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

/**
 * A keyboard event, recognised by shape rather than by `instanceof`.
 *
 * An event raised in another window — an iframe, or a test environment with
 * its own realm — is a different class object with the same properties, and
 * `instanceof` would quietly say no.
 */
function isKeyboardEvent(event: Event): event is KeyboardEvent {
  return 'key' in event;
}

/**
 * Whether the browser turns Enter and Space on this element into a click of
 * its own, so that acting on the key as well would dismiss twice for one press.
 *
 * These few lines are local rather than shared with `toggle.ts`, which has the
 * same pair: the alternative is a utility module whose only members are two
 * six-line functions, and an import between two component families for the
 * privilege. That is the worse trade of the two.
 */
function isNativeButton(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === 'BUTTON') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = el.getAttribute('type')?.toLowerCase() ?? 'text';
  return type === 'button' || type === 'submit' || type === 'reset';
}
