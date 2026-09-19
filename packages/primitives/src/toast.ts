/**
 * Toast — a queue of transient notifications, announced without taking focus.
 *
 * Headless like the rest: it owns the queue, the timers, the announcement and
 * the keyboard route in, and returns prop objects to spread onto whatever
 * markup the consumer writes.
 *
 *   class Shell {
 *     region = new Signal.State<Element | null>(null);
 *     toaster = createToaster<{ title: string }>({
 *       region: () => this.region.get(),
 *     });
 *
 *     save() {
 *       this.toaster.add({ title: 'Saved' });
 *     }
 *   }
 *
 *   <div :portal :ref="region" :spread="toaster.regionProps()">
 *     <div :for="toast in toaster.visible()" :key="toast.id"
 *          :spread="toaster.toastProps(toast)">
 *       <p>{ toast.data().title }</p>
 *       <button :spread="toaster.closeProps()" :click="toast.dismiss()">×</button>
 *     </div>
 *   </div>
 *
 * Three decisions carry most of the accessibility, and are made once here:
 *
 *   - **A toast announces itself and never takes focus.** Each one is its own
 *     live region — `role="status"` for ordinary toasts, `role="alert"` for
 *     errors — so a screen reader reads it where the user already is. Moving
 *     focus to announce would interrupt whatever they were typing.
 *   - **Time only runs while the toast can be read.** The countdown stops
 *     while the pointer is over the region, while the region holds focus, and
 *     while the document is hidden. A toast that expires in a background tab
 *     was never seen.
 *   - **A hotkey is the way in.** Nothing links to a toast, so without one the
 *     actions inside it are unreachable from the keyboard: F6 moves focus to
 *     the region, Escape puts it back where it came from.
 *
 * Swipe-to-dismiss belongs with gesture support and is not here.
 */

import { Signal, createRoot, effect, onCleanup } from '@voltdev/core';
import { createPresence, type PresenceState } from './presence.js';
import { createId } from './id.js';
import { useProvidedLocale } from './i18n.js';

const { untrack } = Signal.subtle;

/** What kind of thing happened. Only `error` interrupts. */
export type ToastType = 'info' | 'success' | 'warning' | 'error';

/** Which live region a toast is announced through. */
export type ToastPriority = 'polite' | 'assertive';

/** Why a toast was dismissed — its own clock, or a call. */
export type ToastDismissReason = 'timeout' | 'api';

/**
 * Marks a toaster's region, so that a modal dialog knows to leave it live.
 *
 * A modal makes every other child of <body> inert, and an inert subtree is out
 * of the accessibility tree, so a toast raised inside one is never announced.
 * The dialog spares a live region, but the region is not one — each toast is
 * its own — and an empty region has nothing live in it to find. Only a child
 * of <body> is spared, which is why a region that has to speak over a modal
 * is portalled there, as the dialog is.
 */
export const TOASTER_ATTRIBUTE = 'data-volt-toaster';

/**
 * Every string this can put in front of a user.
 *
 * All of them are overridable because the library is localised later, and a
 * hard-coded English name is not something a consumer can work around.
 */
export interface ToastLabels {
  /** Accessible name for the region. Default the locale's `notifications`, or `Notifications`. */
  region?: string;
  /**
   * Accessible name for a close control. Default the locale's
   * `closeNotification`, or `Close notification`.
   */
  close?: string;
}

export interface ToastOptions {
  /**
   * Reuse an id and `add` updates that toast instead of raising a second one,
   * which is what a promise wants: one notification that becomes its result.
   */
  id?: string;
  type?: ToastType;
  /** Override the priority `type` implies. */
  priority?: ToastPriority;
  /**
   * Milliseconds on screen. Zero or `Infinity` keeps it up until something
   * dismisses it, which is what a toast carrying an action wants — the action
   * is unusable if it can time out mid-reach.
   */
  duration?: number;
}

export interface Toast<T> {
  readonly id: string;
  /** Whatever the consumer passed to `add`. Reactive, so `update` re-renders. */
  data(): T;
  type(): ToastType;
  /** The resolved priority: errors are assertive unless told otherwise. */
  priority(): ToastPriority;
  /** Its lifetime in milliseconds. */
  duration(): number;
  /** Whether it is logically up — false from the moment it is dismissed. */
  isOpen(): boolean;
  /** Whether it should still be in the DOM — stays true during the exit. */
  isPresent(): boolean;
  /** `open` or `closed`, for CSS to animate against. */
  state(): PresenceState;
  dismiss(): void;
}

export interface ToasterOptions<T> {
  /** The element the toasts are rendered into, once it exists. */
  region: () => Element | null | undefined;

  /**
   * Supply a signal to own the queue from outside — two regions sharing one
   * store, or a panel that wants to watch it. Without one the toaster owns it.
   * Removing an entry by hand skips the exit animation, since nothing is left
   * to animate.
   */
  toasts?: Signal.State<Toast<T>[]>;

  /** How many are on screen at once. The rest wait their turn. Default 3. */
  max?: number;
  /** Default lifetime in milliseconds. Default 5000. */
  duration?: number;

  /**
   * The key that moves focus to the region. Default `F6`, matched against
   * `event.key` with no modifier held; pass a predicate for a combination.
   */
  hotkey?: string | ((event: KeyboardEvent) => boolean);

  labels?: ToastLabels;

  onDismiss?: (toast: Toast<T>, reason: ToastDismissReason) => void;
}

export interface ToastProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface Toaster<T> {
  /** Everything live, oldest first — on screen and waiting alike. */
  toasts(): Toast<T>[];
  /** The ones that should be rendered now. */
  visible(): Toast<T>[];
  /** The ones waiting for a slot. Render a count of them, or nothing. */
  queued(): Toast<T>[];
  /** Whether the countdowns are held right now. */
  isPaused(): boolean;

  /** Raise a toast, and return the id that addresses it. */
  add(data: T, options?: ToastOptions): string;
  /** Replace a toast's contents. False when it has already gone. */
  update(id: string, data: T, options?: ToastOptions): boolean;
  dismiss(id: string): void;
  dismissAll(): void;

  /** Move focus to the region, as the hotkey does. */
  focusRegion(): void;

  regionProps(): ToastProps;
  toastProps(toast: Toast<T>): ToastProps;
  closeProps(): ToastProps;
}

/**
 * A live toast, with the state the toaster writes to.
 *
 * The queue signal holds these same objects seen through `Toast<T>`, so a
 * consumer holding the signal sees the public surface and nothing else.
 */
interface Entry<T> extends Toast<T> {
  readonly open: Signal.State<boolean>;
  readonly payload: Signal.State<T>;
  readonly severity: Signal.State<ToastType>;
  readonly urgency: Signal.State<ToastPriority | undefined>;
  readonly lifetime: Signal.State<number>;
  readonly timer: Timer;
  dispose(): void;
}

export function createToaster<T = unknown>(options: ToasterOptions<T>): Toaster<T> {
  const toasts = options.toasts ?? new Signal.State<Toast<T>[]>([]);
  const max = options.max ?? 3;
  const defaultDuration = options.duration ?? 5000;
  const labels = options.labels ?? {};
  const locale = useProvidedLocale();

  /**
   * A default name: the provider's word for it where its catalogue has one,
   * then English. Neither key is among the catalogue's defaults, and `t`
   * answers a key it cannot find with the key itself.
   */
  const word = (key: string, english: string): string =>
    locale?.has(key) ? locale.t(key) : english;

  /** Live entries by id — where the writable half of each toast lives. */
  const live = new Map<string, Entry<T>>();

  const pointerInside = new Signal.State(false);
  const focusInside = new Signal.State(false);
  const documentHidden = new Signal.State(typeof document !== 'undefined' && document.hidden);

  const isPaused = (): boolean =>
    pointerInside.get() || focusInside.get() || documentHidden.get();

  const visible = (): Toast<T>[] => toasts.get().slice(0, max);
  const queued = (): Toast<T>[] => toasts.get().slice(max);

  /**
   * A toast's element, if it is rendered.
   *
   * Found by id rather than a ref, because `:ref` binds a property on the
   * component and a `:for` row has no property of its own to bind. Searched
   * from the region rather than with `getElementById`, which answers with the
   * first element in the whole document to carry the id: a custom id the page
   * happens to use elsewhere would hand back that element instead, and this
   * toast would lose the exit animation it is in the middle of. Searching from
   * the region also keeps two toasters on a page from reading each other's
   * nodes.
   *
   * The ids are compared rather than written into a selector, because a
   * consumer-supplied id is arbitrary text: a line break in one makes the
   * selector invalid unless it is escaped as a code point, which is what
   * `CSS.escape` is for — and that is a browser global a server has not got.
   * The region holds a few toasts, so the walk is short.
   */
  const elementOf = (id: string): Element | null => {
    const region = options.region();
    if (!region) return null;
    for (const el of region.querySelectorAll('[id]')) if (el.id === id) return el;
    return null;
  };

  const containsFocus = (region: Element): boolean =>
    typeof document !== 'undefined' && region.contains(document.activeElement);

  // ---------------------------------------------------------------------
  // Focus
  // ---------------------------------------------------------------------

  /** Where focus was before the hotkey took it, so Escape can put it back. */
  let focusOrigin: HTMLElement | null = null;

  const focusRegion = (): void => {
    const region = options.region();
    if (!region || typeof document === 'undefined') return;

    const active = document.activeElement;
    if (active instanceof HTMLElement && !region.contains(active)) focusOrigin = active;

    // The region must be able to hold focus without joining the tab order:
    // toasts arrive unbidden, and a tab stop that comes and goes shifts every
    // later stop on the page. `regionProps` says the same thing; this covers a
    // consumer who spread them onto a different element than they ref'd.
    if (!region.hasAttribute('tabindex')) region.setAttribute('tabindex', '-1');
    if (region instanceof HTMLElement) region.focus();
  };

  const returnFocus = (): void => {
    const target = focusOrigin;
    focusOrigin = null;
    // Only when it is still in the document. Otherwise leaving focus where the
    // browser put it beats sending it somewhere arbitrary.
    if (target?.isConnected) target.focus();
  };

  /**
   * Move focus off a toast that is about to leave the DOM.
   *
   * A toast dismissed from its own close button takes focus with it. Without
   * this, focus lands on `<body>` and a keyboard user is dropped at the top of
   * the document with no way back to what they were doing.
   */
  const handOffFocus = (id: string, othersRemain: boolean): void => {
    if (typeof document === 'undefined') return;
    const el = elementOf(id);
    if (!el?.contains(document.activeElement)) return;

    if (othersRemain) focusRegion();
    else returnFocus();
  };

  // ---------------------------------------------------------------------
  // The queue
  // ---------------------------------------------------------------------

  const dismiss = (id: string, reason: ToastDismissReason): void => {
    const entry = live.get(id);
    if (!entry || !untrack(() => entry.open.get())) return;

    entry.timer.stop();
    entry.open.set(false);
    options.onDismiss?.(entry, reason);
  };

  const update = (id: string, data: T, opts: ToastOptions = {}): boolean => {
    const entry = live.get(id);
    // Not an error: the promise behind a toast can settle after the user has
    // dismissed it, and the caller should not have to guard every update.
    if (!entry) return false;

    entry.payload.set(data);
    if (opts.type !== undefined) entry.severity.set(opts.type);
    if (opts.priority !== undefined) entry.urgency.set(opts.priority);
    if (opts.duration !== undefined) entry.lifetime.set(opts.duration);

    // New words need their own reading time, so the countdown starts again.
    entry.timer.reset(untrack(() => entry.lifetime.get()));
    // Presence cancels a running exit when its content is re-opened, so an
    // update that lands during the exit animation brings the toast back rather
    // than rewriting something on its way out.
    entry.open.set(true);
    return true;
  };

  /**
   * Take a toast out of the queue once it has finished leaving.
   *
   * Written from the toast's own effect rather than from the one that owns the
   * timers, because an effect that writes a signal it also reads does not run
   * again for it — its own recompute marks it settled — and the timers have to
   * react to the queue changing.
   */
  const removeFromQueue = (id: string): void => {
    const list = untrack(() => toasts.get());
    const next = list.filter((toast) => toast.id !== id);
    if (next.length === list.length) return;

    handOffFocus(id, next.length > 0);
    toasts.set(next);
  };

  const createEntry = (id: string, data: T, opts: ToastOptions): Entry<T> =>
    // Detached from the surrounding scope deliberately. `add` is called from
    // event handlers, timers and promise callbacks, and a scope parented to
    // whichever one happened to be current would take the toast down with it —
    // an effect clears its scope on every run. These are disposed here instead,
    // when the toast leaves and when the toaster does.
    createRoot((dispose) => {
      const open = new Signal.State(true);
      const payload = new Signal.State(data);
      const severity = new Signal.State<ToastType>(opts.type ?? 'info');
      const urgency = new Signal.State<ToastPriority | undefined>(opts.priority);
      const lifetime = new Signal.State(opts.duration ?? defaultDuration);

      const presence = createPresence(
        () => open.get(),
        () => elementOf(id),
      );

      const timer = createTimer(() => dismiss(id, 'timeout'));
      timer.reset(untrack(() => lifetime.get()));
      onCleanup(() => timer.stop());

      // Dismissed and finished animating out: the toast has no reason to be in
      // the queue any more. The scope this runs in is disposed as a result of
      // the removal, from the effect that owns the timers — never from here,
      // where it would be tearing itself down mid-run.
      effect(() => {
        if (!open.get() && !presence.isPresent()) removeFromQueue(id);
      });

      return {
        id,
        open,
        payload,
        severity,
        urgency,
        lifetime,
        timer,
        dispose,

        data: () => payload.get(),
        type: () => severity.get(),
        // An error interrupts; anything else waits for a gap in the speech.
        priority: () => urgency.get() ?? (severity.get() === 'error' ? 'assertive' : 'polite'),
        duration: () => lifetime.get(),
        isOpen: () => open.get(),
        isPresent: () => presence.isPresent(),
        state: () => presence.state(),
        dismiss: () => dismiss(id, 'api'),
      };
    }, null);

  const add = (data: T, opts: ToastOptions = {}): string => {
    const id = opts.id ?? createId('toast');
    if (live.has(id)) {
      update(id, data, opts);
      return id;
    }

    const entry = createEntry(id, data, opts);
    live.set(id, entry);
    toasts.set([...untrack(() => toasts.get()), entry]);
    return id;
  };

  // ---------------------------------------------------------------------
  // Timers
  // ---------------------------------------------------------------------

  /**
   * Put the focus pause back in step with the DOM.
   *
   * A node removed while it holds focus does not reliably report `focusout`,
   * and a toast dismissed from its own close button is exactly that — so the
   * flag can be stranded, and a stranded pause holds every later toast open
   * for ever. Focus is a fact the document can be asked for, so it is asked
   * rather than trusted.
   *
   * The pointer gets no such repair, because there is no equivalent question
   * to ask, and the obvious guess — that an empty queue means the pointer has
   * gone — is wrong: the region stays mounted whether or not it holds any
   * toasts, so a pointer resting on it is still resting on it, and a toast
   * that arrives underneath must not start counting down unread.
   */
  const repairFocusPause = (): void => {
    const region = options.region();
    focusInside.set(region ? containsFocus(region) : false);
  };

  /**
   * Release entries that have left the queue — because they finished leaving,
   * or because a consumer holding the queue signal took them out by hand.
   * Their timers and presence effects are ours to dispose either way.
   */
  const releaseOrphans = (list: Toast<T>[]): void => {
    const kept = new Set(list.map((toast) => toast.id));
    for (const [id, entry] of live) {
      if (kept.has(id)) continue;
      live.delete(id);
      entry.dispose();
    }
  };

  /**
   * One effect owns every timer.
   *
   * Timers are imperative — they have to survive a re-run, or an unrelated
   * change would restart somebody's countdown — so this reconciles rather than
   * rebuilds: a pass only says whether each toast should be counting down now,
   * and resuming an already-running timer is nothing.
   */
  effect(() => {
    const list = toasts.get();

    // Repaired before the flags are read, not after: a signal written by the
    // effect that reads it does not run that effect again, so this pass has to
    // be the one that acts on the repair.
    repairFocusPause();
    releaseOrphans(list);

    const paused = isPaused();

    for (let i = 0; i < list.length; i++) {
      const entry = live.get(list[i]!.id);
      // Something the consumer put in the queue themselves. Rendering it is
      // their business; there is nothing here to drive.
      if (!entry) continue;

      // Only what is on screen counts down. A queued toast that expired while
      // waiting would appear and vanish, having never been read.
      if (entry.open.get() && !paused && i < max) entry.timer.resume();
      else entry.timer.pause();
    }
  });

  onCleanup(() => {
    for (const entry of live.values()) entry.dispose();
    live.clear();
  });

  // ---------------------------------------------------------------------
  // Pausing
  // ---------------------------------------------------------------------

  effect(() => {
    const region = options.region();
    if (!region) return;

    const onPointerEnter = () => pointerInside.set(true);
    const onPointerLeave = () => pointerInside.set(false);
    const onFocusIn = () => focusInside.set(true);
    const onFocusOut = (event: Event) => {
      // `focusout` carries where focus is going. Moving between two controls
      // inside the region must not look like leaving it and restart the clock
      // under a user who is still reading.
      const next = 'relatedTarget' in event ? event.relatedTarget : null;
      if (next instanceof Node && region.contains(next)) return;
      focusInside.set(false);
      // Focus left by some route of its own, so there is nothing left to give
      // back — a later Escape must not throw the user somewhere they have
      // since moved on from.
      focusOrigin = null;
    };

    region.addEventListener('pointerenter', onPointerEnter);
    region.addEventListener('pointerleave', onPointerLeave);
    region.addEventListener('focusin', onFocusIn);
    region.addEventListener('focusout', onFocusOut);

    onCleanup(() => {
      region.removeEventListener('pointerenter', onPointerEnter);
      region.removeEventListener('pointerleave', onPointerLeave);
      region.removeEventListener('focusin', onFocusIn);
      region.removeEventListener('focusout', onFocusOut);
      pointerInside.set(false);
      focusInside.set(false);
    });
  });

  // ---------------------------------------------------------------------
  // Document-level keyboard and visibility
  // ---------------------------------------------------------------------

  const matchesHotkey = (event: KeyboardEvent): boolean => {
    const hotkey = options.hotkey ?? 'F6';
    if (typeof hotkey === 'function') return hotkey(event);
    // A bare key only. Ctrl+F6 and friends belong to the browser, and taking
    // them would be worse than not offering the shortcut at all.
    return (
      event.key === hotkey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    );
  };

  effect(() => {
    if (typeof document === 'undefined') return;

    const onKeyDown = (event: KeyboardEvent) => {
      const region = options.region();
      if (!region) return;

      if (matchesHotkey(event)) {
        // Nothing to reach, so leave focus where the user put it.
        if (visible().length === 0) return;
        // F6 cycles browser panes otherwise, and the page never sees it again.
        event.preventDefault();
        focusRegion();
        return;
      }

      // Escape only means "give me back what I was doing", and only from
      // inside the region. Elsewhere it belongs to whatever layer is topmost.
      if (event.key === 'Escape' && containsFocus(region)) returnFocus();
    };

    const onVisibilityChange = () => documentHidden.set(document.hidden);

    // Capture, so an application handler that stops propagation cannot take
    // away the only keyboard route to the toasts.
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('visibilitychange', onVisibilityChange);

    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    });
  });

  // ---------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------

  return {
    toasts: () => toasts.get(),
    visible,
    queued,
    isPaused,

    add,
    update,
    dismiss: (id: string) => dismiss(id, 'api'),
    dismissAll: () => {
      // Over a copy: `onDismiss` is consumer code, and one that raises a toast
      // of its own would otherwise have it dismissed by this same loop.
      for (const id of [...live.keys()]) dismiss(id, 'api');
    },

    focusRegion,

    regionProps: () => ({
      role: 'region',
      'aria-label': labels.region ?? word('notifications', 'Notifications'),
      // Focusable by the hotkey, out of the tab order the rest of the time.
      tabindex: '-1',
      'data-paused': isPaused() ? '' : undefined,
      [TOASTER_ATTRIBUTE]: '',
    }),

    toastProps: (toast: Toast<T>) => {
      const assertive = toast.priority() === 'assertive';
      // No `aria-labelledby` or `aria-describedby` here, unlike a dialog: a
      // name on a live region is announced *instead of* its contents in some
      // screen readers, which for a toast is the whole message lost.
      return {
        id: toast.id,
        // The role and the `aria-live` say the same thing on purpose: the
        // role's implicit value satisfies the specification, and some
        // assistive technology still honours only the explicit attribute.
        role: assertive ? 'alert' : 'status',
        'aria-live': assertive ? 'assertive' : 'polite',
        // The whole toast is read on every change, not only the words that
        // changed — half a sentence is worse than a repeat.
        'aria-atomic': 'true',
        'data-state': toast.state(),
        'data-type': toast.type(),
      };
    },

    closeProps: () => ({
      'aria-label': labels.close ?? word('closeNotification', 'Close notification'),
    }),
  };
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

interface Timer {
  /** Start, or carry on, counting the remaining time. */
  resume(): void;
  /** Hold the countdown, keeping what is left of it. */
  pause(): void;
  /**
   * Give it a new duration. A timer that has been resumed restarts on the new
   * one, including one a zero or infinite duration was holding still.
   */
  reset(duration: number): void;
  stop(): void;
}

/**
 * A countdown that can be held and let go without losing its place.
 *
 * `setTimeout` has no pause, and re-arming it with the full duration on every
 * hover would make a toast under a moving pointer immortal — so what is left
 * is tracked by hand.
 */
function createTimer(onExpire: () => void): Timer {
  let remaining = 0;
  /** A zero or infinite duration: this toast waits to be dismissed. */
  let sticky = true;
  /**
   * Whether the toaster wants this counting down, which a sticky duration
   * gives no handle to show. Held apart from the handle so that a new duration
   * can start a clock the old one never let run: nothing else wakes the
   * effect that resumes timers when only a duration changes.
   */
  let resumed = false;
  let startedAt = 0;
  let handle: ReturnType<typeof setTimeout> | null = null;

  const clear = (): boolean => {
    if (handle === null) return false;
    clearTimeout(handle);
    handle = null;
    return true;
  };

  const start = (): void => {
    if (sticky) return;
    startedAt = Date.now();
    // A pause that lands after the toast was already due leaves nothing on the
    // clock. It fires as soon as it is let go rather than staying up for ever,
    // which is what a throttled background tab would otherwise arrange.
    handle = setTimeout(onExpire, Math.max(0, remaining));
  };

  return {
    resume() {
      resumed = true;
      if (handle === null) start();
    },

    pause() {
      resumed = false;
      if (!clear()) return;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    },

    reset(duration: number) {
      clear();
      remaining = duration;
      sticky = !Number.isFinite(duration) || duration <= 0;
      if (resumed) start();
    },

    stop() {
      clear();
      remaining = 0;
      sticky = true;
      resumed = false;
    },
  };
}
