/**
 * Focus scope — trapping focus inside a layer and restoring it afterwards.
 *
 * A modal that does not trap focus is not modal for keyboard users: Tab walks
 * straight out into the page behind it, which is still there and still
 * interactive. Restoring focus on close matters just as much — losing focus to
 * `<body>` drops a keyboard user back at the top of the document with no way
 * back to where they were.
 *
 * Focus is trapped by watching `focusin` rather than by intercepting Tab.
 * Intercepting the key means reimplementing tab order, which browsers already
 * compute and which no reimplementation gets right for shadow roots, iframes,
 * or `tabindex` ordering. Watching where focus lands catches every route in —
 * keyboard, mouse, programmatic, and the browser's own address-bar cycle.
 */

import { Signal, onCleanup } from '@voltdev/core';
import { isInsideLayer } from './dismiss.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

/**
 * Elements that can hold focus. The disabled checks remove the common cases
 * cheaply; a negative `tabindex` and visibility are checked separately, since
 * the first can take a native control out of the tab order as well as leave
 * anything else out of it, and the second needs style.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
].join(',');

export interface FocusScopeOptions {
  /** Move focus into the layer on mount. Default true. */
  autoFocus?: boolean;
  /** Restore focus to whatever had it before. Default true. */
  restoreFocus?: boolean;
  /** What to focus first, instead of the first focusable element. */
  initialFocus?: () => Element | null | undefined;
}

export function createFocusScope(
  node: () => Element | null | undefined,
  options: FocusScopeOptions = {},
): void {
  if (typeof document === 'undefined') return;

  const previouslyFocused = document.activeElement as HTMLElement | null;

  // Registered before the trap, and cleanups run newest-first, so this runs
  // *after* the trap has been removed. The other order restores focus while
  // the trap is still live, which immediately drags it back inside.
  onCleanup(() => {
    if (options.restoreFocus === false) return;
    // Only restore if the element is still in the document and can take focus;
    // otherwise leaving focus where the browser put it is the lesser evil.
    if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  });

  // Read untracked, wherever it is asked. The scope is created from an effect
  // and recovers inside whatever moved focus, which can be another effect, and
  // either one depending on what the getter reads would run again when that
  // changes — building the scope again, or moving focus back to where it was.
  const initialFocus = () => untrack(() => options.initialFocus?.());

  const container = node();
  if (container) {
    if (options.autoFocus !== false) focusFirst(container, initialFocus());

    // Guards against the trap re-entering itself. Moving focus fires `blur` on
    // whatever held it and `focusin` on whatever takes it, so a container with
    // nothing focusable inside — or an element that refuses focus — bounces
    // between the two until the stack runs out. The flag makes one recovery
    // attempt per escape, which is all a recovery can usefully be.
    let recovering = false;

    // Whether focus is on its way backwards. `focusin` says where focus landed
    // and not which way it was heading, and Shift+Tab off the first element
    // wants the last one, not the first again. Tab moves focus between the key
    // going down and coming up, so the direction holds for exactly that long —
    // an escape by a press or by script afterwards was not heading anywhere.
    let backwards = false;
    const onTab = (event: KeyboardEvent) => {
      if (event.key === 'Tab') backwards = event.type === 'keydown' && event.shiftKey;
    };

    const onFocusIn = (event: FocusEvent) => {
      if (recovering) return;
      const target = event.target;
      // A layer opened from inside this one — a popover or a menu from a
      // dialog — is portalled out of the container, and focus going into it
      // has not escaped.
      if (!(target instanceof Node) || isInsideLayer(container, target)) return;

      recovering = true;
      try {
        // Focus escaped — pull it back to the first thing inside, or round to
        // the last when it left backwards.
        const last = backwards ? focusableWithin(container).at(-1) : undefined;
        if (last) last.focus();
        else focusFirst(container, initialFocus());
      } finally {
        recovering = false;
      }
    };
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('keydown', onTab, true);
    document.addEventListener('keyup', onTab, true);
    onCleanup(() => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('keydown', onTab, true);
      document.removeEventListener('keyup', onTab, true);
    });
  }
}

/**
 * The descendants Tab stops on, in the order it visits them, minus anything
 * not actually visible.
 *
 * The order is the browser's rather than the document's: a positive
 * `tabindex` comes before everything else, lowest first. And `tabindex="-1"`
 * leaves an element out even when it is a button, because that is how a
 * roving group keeps its resting items off the tab sequence — Tab-out of a
 * popover that landed on one would be landing where Tab itself never does.
 */
export function focusableWithin(container: Element): HTMLElement[] {
  const natural: HTMLElement[] = [];
  const positive: HTMLElement[] = [];
  for (const el of container.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    const index = tabIndexOf(el);
    if (index < 0 || !isVisible(el)) continue;
    (index > 0 ? positive : natural).push(el);
  }
  if (positive.length === 0) return natural;
  // A stable sort, so equal indexes keep their document order.
  positive.sort((a, b) => tabIndexOf(a) - tabIndexOf(b));
  return [...positive, ...natural];
}

/** Its own `tabindex`, or 0 for a control that is in the tab order by nature. */
function tabIndexOf(el: Element): number {
  const value = Number.parseInt(el.getAttribute('tabindex') ?? '', 10);
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Whether it is rendered, asked of the ancestors as well as the element. A
 * button inside a `display: none` panel computes a display of its own, so a
 * look at its own style alone lists something that cannot take focus.
 * `checkVisibility()` walks up for itself, and answers for `hidden` too, by
 * way of the user-agent rule that gives it `display: none` — so an author's
 * rule that shows a `hidden` element anyway leaves it listed here, as it is
 * focusable in the page.
 */
function isVisible(el: HTMLElement): boolean {
  return el.checkVisibility({ visibilityProperty: true });
}

function focusFirst(container: Element, preferred: Element | null | undefined): void {
  const target =
    (preferred as HTMLElement | null) ?? focusableWithin(container)[0] ?? (container as HTMLElement);

  // A container with nothing focusable inside still has to hold focus, or it
  // escapes to the page behind. `tabindex="-1"` makes that possible without
  // putting the container into the tab order.
  if (target === container && !container.hasAttribute('tabindex')) {
    container.setAttribute('tabindex', '-1');
  }
  (target as HTMLElement).focus?.();
}
