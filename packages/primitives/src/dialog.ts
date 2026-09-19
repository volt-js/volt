/**
 * Dialog — a modal or non-modal layer, with the accessibility wired in.
 *
 * This is headless: it owns state, keyboard and ARIA, and returns prop objects
 * to spread onto whatever markup the consumer writes. Nothing here renders,
 * and nothing here has an opinion about styling.
 *
 *   class Confirm {
 *     trigger = new Signal.State<Element | null>(null);
 *     content = new Signal.State<Element | null>(null);
 *     dialog = createDialog({
 *       trigger: () => this.trigger.get(),
 *       content: () => this.content.get(),
 *     });
 *   }
 *
 *   <button :ref="trigger" :spread="dialog.triggerProps()"
 *           :click="dialog.open()">Delete</button>
 *   <div :if="dialog.isPresent()" :portal
 *        :ref="content" :spread="dialog.contentProps()">
 *     <h2 :spread="dialog.titleProps()">Are you sure?</h2>
 *     <p  :spread="dialog.descriptionProps()">This cannot be undone.</p>
 *     <button :click="dialog.close()">Cancel</button>
 *   </div>
 *
 * The props carry no event handlers, so the trigger's `:click` and the close
 * button's are the consumer's to bind.
 *
 * `aria-labelledby` and `aria-describedby` are only emitted when a title and
 * description actually exist, because pointing at a missing id is worse than
 * pointing at nothing: a screen reader announces an unlabelled dialog either
 * way, but a dangling reference hides the fact that the label is missing.
 */

import { Signal, effect, measureEffect, onCleanup } from '@voltdev/core';
import { createPresence, type PresenceState } from './presence.js';
import { createDismiss, type DismissReason } from './dismiss.js';
import { createFocusScope } from './focus-scope.js';
import { createId } from './id.js';
import { TOASTER_ATTRIBUTE } from './toast.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

export interface DialogOptions {
  /** The dialog's content element, once rendered. */
  content: () => Element | null | undefined;
  /** The element that opens it, so a press on it is not treated as outside. */
  trigger?: () => Element | null | undefined;

  /**
   * Supply a signal to control the dialog from outside. Without one it owns
   * its own state, which is what most callers want.
   */
  open?: Signal.State<boolean>;
  defaultOpen?: boolean;

  /**
   * Modal dialogs trap focus, mark the rest of the page inert to assistive
   * technology, and lock scrolling. Default true.
   */
  modal?: boolean;

  /** Escape closes it. Default true. */
  closeOnEscape?: boolean;
  /** A press outside closes it. Default true. */
  closeOnOutsidePointer?: boolean;

  onOpenChange?: (open: boolean) => void;
}

export interface DialogProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface Dialog {
  /** Whether the dialog is logically open. */
  isOpen(): boolean;
  /** Whether its content should be in the DOM — stays true during exit. */
  isPresent(): boolean;
  /** `open` or `closed`, for CSS to animate against. */
  state(): PresenceState;

  open(): void;
  close(): void;
  toggle(): void;

  triggerProps(): DialogProps;
  contentProps(): DialogProps;
  titleProps(): DialogProps;
  descriptionProps(): DialogProps;
}

export function createDialog(options: DialogOptions): Dialog {
  const state = options.open ?? new Signal.State(options.defaultOpen ?? false);
  const modal = options.modal !== false;

  const contentId = createId('dialog-content');
  const titleId = createId('dialog-title');
  const descriptionId = createId('dialog-description');

  // Whether a title or description was actually rendered. Read from the DOM
  // rather than declared, so the consumer cannot forget to say so and get a
  // dangling `aria-labelledby` for their trouble.
  const hasTitle = new Signal.State(false);
  const hasDescription = new Signal.State(false);

  const presence = createPresence(
    () => state.get(),
    () => options.content(),
  );

  // The width of the scrollbar the lock is about to hide. Read in the measure
  // lane, so it shares the flush's one layout with everything else that
  // measures instead of forcing one of its own from the effect below — and
  // that lane drains before user effects, so the width is there by the time
  // the lock is taken in the same flush. A plain variable, because nothing
  // renders from it: a later measurement is no reason to run anything again.
  let scrollbarWidth = 0;
  if (modal) {
    measureEffect(() => {
      if (!state.get() || !options.content()) return;
      scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    });
  }

  const setOpen = (next: boolean) => {
    // Untracked because `open()` may well be called from inside an effect, and
    // subscribing that effect to the state it just wrote would run it again
    // when the dialog closes — and open it straight back up.
    if (untrack(() => state.get()) === next) return;
    state.set(next);
    options.onOpenChange?.(next);
  };

  // Everything that only applies while open lives in one effect, so it is set
  // up and torn down as a unit — and, because these register cleanups, in
  // exactly the reverse order on the way out.
  effect(() => {
    if (!state.get()) return;
    const content = options.content();
    if (!content) return;

    // These ids are generated here, in a known-safe form, so they need no
    // escaping — and escaping them would pull in `CSS`, a browser global that
    // does not exist when rendering on a server.
    hasTitle.set(Boolean(content.querySelector(`#${titleId}`)));
    hasDescription.set(Boolean(content.querySelector(`#${descriptionId}`)));

    createDismiss(
      () => options.content(),
      (reason: DismissReason) => {
        if (reason === 'escape' && options.closeOnEscape === false) return;
        if (reason === 'outside-pointer' && options.closeOnOutsidePointer === false) return;
        setOpen(false);
      },
      {
        // Escape and the press are always taken here, and declined above when
        // the dialog is told not to close on them: a layer that holds focus and
        // stays open still keeps them from the layer beneath it.
        // The trigger is not "outside": dismissing on it would close the
        // dialog and then the trigger's own handler would reopen it.
        exclude: () => (options.trigger ? [options.trigger()] : []),
      },
    );

    if (modal) {
      createFocusScope(() => options.content(), { restoreFocus: true });
      lockScroll(scrollbarWidth);
      makeRestInert(content);
    }
  });

  return {
    isOpen: () => state.get(),
    isPresent: () => presence.isPresent(),
    state: () => presence.state(),

    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!untrack(() => state.get())),

    triggerProps: () => ({
      'aria-haspopup': 'dialog',
      'aria-expanded': String(state.get()),
      'aria-controls': state.get() ? contentId : undefined,
    }),

    contentProps: () => ({
      id: contentId,
      role: 'dialog',
      'aria-modal': modal ? 'true' : undefined,
      'aria-labelledby': hasTitle.get() ? titleId : undefined,
      'aria-describedby': hasDescription.get() ? descriptionId : undefined,
      'data-state': presence.state(),
      tabindex: '-1',
    }),

    titleProps: () => ({ id: titleId }),
    descriptionProps: () => ({ id: descriptionId }),
  };
}

/**
 * Stop the page behind scrolling, and compensate for the scrollbar.
 *
 * Without the padding the page visibly jumps sideways as the scrollbar
 * disappears. Nesting is counted, so two stacked dialogs do not release the
 * lock when only the inner one closes — and only the first lock pads, since
 * by the second there is no scrollbar left to measure.
 */
let scrollLocks = 0;
let restoreScroll: (() => void) | null = null;

function lockScroll(gap: number): void {
  scrollLocks += 1;

  if (scrollLocks === 1 && typeof document !== 'undefined') {
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;

    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;

    restoreScroll = () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }

  onCleanup(() => {
    scrollLocks -= 1;
    if (scrollLocks === 0) {
      restoreScroll?.();
      restoreScroll = null;
    }
  });
}

/**
 * Make everything except the dialog inert while it is open.
 *
 * `inert` is the right tool and Volt targets browsers that all have it. It
 * does three things `aria-hidden` cannot: it removes the subtree from the tab
 * order, it stops pointer events reaching it, and it hides it from assistive
 * technology. A focus trap only covers the first of those, and a screen
 * reader's own cursor is not bound by focus at all — so with `aria-hidden`
 * alone the page behind is still clickable, and with a trap alone it is still
 * readable straight through the dialog.
 *
 * `aria-hidden` goes on beside it because some assistive technology still
 * honours it more reliably than `inert`, and the pair does no harm.
 */
function makeRestInert(content: Element): void {
  if (typeof document === 'undefined') return;

  const changed: { el: Element; inert: boolean; hidden: string | null }[] = [];

  for (const el of document.body.children) {
    if (el === content || el.contains(content)) continue;
    // A live region must keep announcing — a toast raised while a dialog is
    // open is exactly the case that matters. A toaster's region is not a live
    // region itself, and holds none until a toast arrives, so it says what it
    // is with a marker instead.
    if (el.hasAttribute('aria-live') || el.hasAttribute(TOASTER_ATTRIBUTE)) continue;

    changed.push({
      el,
      inert: (el as HTMLElement).inert,
      hidden: el.getAttribute('aria-hidden'),
    });
    (el as HTMLElement).inert = true;
    el.setAttribute('aria-hidden', 'true');
  }

  onCleanup(() => {
    for (const { el, inert, hidden } of changed) {
      (el as HTMLElement).inert = inert;
      if (hidden === null) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', hidden);
    }
  });
}
