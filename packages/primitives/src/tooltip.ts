/**
 * Tooltip — a short description of the control the pointer or focus is on.
 *
 * Headless, like the rest: it owns the delays, the dismissal and the ARIA
 * wiring, and returns prop objects to spread onto the consumer's markup.
 *
 *   class Toolbar {
 *     trigger = new Signal.State<Element | null>(null);
 *     content = new Signal.State<Element | null>(null);
 *     tip = createTooltip({
 *       trigger: () => this.trigger.get(),
 *       content: () => this.content.get(),
 *     });
 *   }
 *
 *   <button :ref="trigger" :spread="tip.triggerProps()">
 *     <svg …/>
 *   </button>
 *   <div :if="tip.isPresent()" :portal :ref="content" :spread="tip.contentProps()">
 *     Delete permanently
 *   </div>
 *
 * It opens on hover and on keyboard focus. Hover alone would put the text
 * behind a pointer, which a keyboard or screen-reader user does not have, and
 * that is precisely the user the description was written for.
 *
 * The trigger therefore has to be something that can take focus — a `<button>`,
 * a link, or an element the consumer has made focusable. A tooltip on a bare
 * `<span>` is unreachable by keyboard and no ARIA attribute fixes it.
 *
 * The tooltip *describes* the trigger, so it is referenced with
 * `aria-describedby`. When its text is the trigger's only name — the usual
 * icon-button case — pass the same text as `label`: a described but unnamed
 * button is announced as "button", and the description may never be read at
 * all, since some screen readers skip descriptions by default.
 *
 * Focus is never touched. A tooltip holds nothing interactive, so moving focus
 * into it would strand a keyboard user in a layer with no way out, and trapping
 * focus would do it deliberately. The pointer may still travel onto the
 * content — that is only so a long description can be read without the tooltip
 * vanishing halfway.
 *
 * Positioning is `createAnchor`, the same CSS anchor positioning the popover
 * and the menu use: above the trigger by default, flipped below it by the
 * browser when there is no room. This used to stop at naming the anchor and
 * leave the `position-area` to the consumer's stylesheet, which meant a
 * tooltip that was correct about everything except where it appeared, and a
 * fourth spelling of a thing this package should only know one way of doing.
 * Nothing measures a rectangle and nothing listens for scroll.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createPresence, type PresenceState } from './presence.js';
import { createDismiss } from './dismiss.js';
import { createAnchor, type AnchorPlacement } from './anchoring.js';
import { createId } from './id.js';

const { untrack } = Signal.subtle;

/**
 * A rest of about 700ms reads as deliberate without feeling slow. Shorter and
 * tooltips flash up while the pointer merely crosses a toolbar; longer and
 * people give up before the text arrives.
 */
const DEFAULT_OPEN_DELAY = 700;

/**
 * Leaving is more forgiving than arriving: the pointer often slips off an edge
 * on the way to the tooltip itself, and closing instantly makes the text
 * unreadable for anyone who moves a mouse imprecisely.
 */
const DEFAULT_CLOSE_DELAY = 300;

/** How long the group stays "warm" after the last tooltip closes. */
const DEFAULT_SKIP_DELAY = 300;

/**
 * The shared skip-delay window.
 *
 * Once one tooltip has opened, the next opens at once. Waiting the full delay
 * again on every button of a toolbar makes the row unusable, and by the time
 * the first tooltip appeared the user has plainly asked for tooltips. The
 * window outlives the first tooltip by `skipDelay` so that a gap between two
 * buttons does not drop the user back to the full delay halfway along.
 *
 * It is module state deliberately. The group spans components that know
 * nothing about each other — two toolbars, or a toolbar and a lone icon button
 * beside it — so scoping it to a provider would shrink it to whatever part of
 * the page one author happened to wrap. The tradeoff is that it is global:
 * every tooltip on the page shares one window, and a caller who wants an
 * isolated group cannot have one.
 */
let openTooltips = 0;
let skipUntil = 0;

function inSkipWindow(): boolean {
  return openTooltips > 0 || Date.now() < skipUntil;
}

/** Test seam: forget that any tooltip has been open. */
export function resetTooltipDelayGroup(): void {
  openTooltips = 0;
  skipUntil = 0;
}

export interface TooltipOptions {
  /** The tooltip's content element, once rendered. */
  content: () => Element | null | undefined;
  /** The element it describes, and the anchor it is positioned against. */
  trigger?: () => Element | null | undefined;

  /**
   * Supply a signal to control the tooltip from outside. Without one it owns
   * its own state, which is what most callers want.
   */
  open?: Signal.State<boolean>;
  defaultOpen?: boolean;

  /** How long the pointer must rest before it opens, in ms. Default 700. */
  openDelay?: number;
  /** How long it lingers after the pointer leaves, in ms. Default 300. */
  closeDelay?: number;
  /**
   * How long after the last tooltip closed another still opens at once, in ms.
   * Default 300. Zero turns the shared window off for tooltips this one closes.
   */
  skipDelay?: number;

  /**
   * An accessible name for the trigger, for when the tooltip's text is also
   * the only name it has. Every user-visible string belongs to the consumer,
   * so nothing here is ever written for them.
   */
  label?: string;

  /**
   * Which side of the trigger to sit on. Default `top`, which is the one side
   * a pointer resting on the trigger cannot cover.
   */
  placement?: AnchorPlacement;
  /** The gap between trigger and tooltip. A number is pixels. */
  offset?: number | string;
  /** Let the browser flip to the opposite side when it would overflow. Default true. */
  flip?: boolean;

  /** Escape closes it. Default true. */
  closeOnEscape?: boolean;

  onOpenChange?: (open: boolean) => void;
}

/**
 * A bag of attributes to spread; `style` is an object of CSS declarations.
 *
 * Written as an object type rather than an interface so it satisfies
 * `Record<string, unknown>`, which is what `:spread` takes — and with an index
 * signature rather than the exact key lists these two carried before, because
 * the positioning half of both bags now comes from `createAnchor` and is
 * spread in whole. A key list declared in this file and filled from another is
 * a key list that goes stale without anything failing to compile.
 */
export type TooltipProps = {
  readonly [key: string]:
    | string
    | undefined
    | Readonly<Record<string, string>>
    | ((event: PointerEvent) => void)
    | ((event: FocusEvent) => void)
    | (() => void);
};

/** The two bags have the same shape, and the method names say which is which. */
export type TooltipTriggerProps = TooltipProps;
export type TooltipContentProps = TooltipProps;

export interface Tooltip {
  /** Whether the tooltip is logically open. */
  isOpen(): boolean;
  /** Whether its content should be in the DOM — stays true during exit. */
  isPresent(): boolean;
  /** `open` or `closed`, for CSS to animate against. */
  state(): PresenceState;
  /** The anchor name tying content to trigger, for CSS that needs to name it. */
  anchorName(): string;
  /**
   * The side the tooltip was asked to sit on, for an arrow or a transform
   * origin. Not necessarily the side it is on: when the engine takes one of
   * the fallbacks it does not report which, and there is no API to ask.
   */
  placement(): AnchorPlacement;

  /** Open now, ignoring the open delay. */
  open(): void;
  /** Close now, ignoring the close delay. */
  close(): void;

  triggerProps(): TooltipTriggerProps;
  contentProps(): TooltipContentProps;
}

export function createTooltip(options: TooltipOptions): Tooltip {
  const state = options.open ?? new Signal.State(options.defaultOpen ?? false);
  const openDelay = options.openDelay ?? DEFAULT_OPEN_DELAY;
  const closeDelay = options.closeDelay ?? DEFAULT_CLOSE_DELAY;
  const skipDelay = options.skipDelay ?? DEFAULT_SKIP_DELAY;

  const contentId = createId('tooltip-content');
  const anchor = createAnchor({
    anchor: () => options.trigger?.(),
    defaultPlacement: options.placement ?? 'top',
    offset: options.offset,
    flip: options.flip,
  });

  const presence = createPresence(
    () => state.get(),
    () => options.content(),
  );

  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  // Where the pointer is. Tracked rather than derived, because `:hover` cannot
  // be asked of an element that is about to be removed, and because the
  // trigger and its content are two elements with one hover between them.
  let onTrigger = false;
  let onContent = false;

  // Whether focus is about to arrive from a press rather than from the
  // keyboard. Set on pointerdown, which browsers dispatch before they move
  // focus, and consumed by the very next focus event.
  let pressedTrigger = false;

  const clearTimers = () => {
    if (openTimer !== null) clearTimeout(openTimer);
    if (closeTimer !== null) clearTimeout(closeTimer);
    openTimer = null;
    closeTimer = null;
  };

  onCleanup(clearTimers);

  const setOpen = (next: boolean) => {
    clearTimers();
    // Read without subscribing: `open()` and `close()` are public, so they may
    // well be called from inside a consumer's own effect, and that effect has
    // no business re-running because the tooltip it opened is now open.
    if (untrack(() => state.get()) === next) return;

    // The content is unmounted on close, so no pointerleave can ever arrive
    // for it; without this the hover would look stuck on for good.
    if (!next) onContent = false;

    state.set(next);
    options.onOpenChange?.(next);
  };

  const scheduleOpen = () => {
    clearTimers();
    const delay = inSkipWindow() ? 0 : openDelay;
    if (delay <= 0) {
      setOpen(true);
      return;
    }
    openTimer = setTimeout(() => {
      openTimer = null;
      setOpen(true);
    }, delay);
  };

  const scheduleClose = () => {
    clearTimers();
    if (closeDelay <= 0) {
      setOpen(false);
      return;
    }
    closeTimer = setTimeout(() => {
      closeTimer = null;
      setOpen(false);
    }, closeDelay);
  };

  /**
   * Whether the pointer merely crossed between the trigger and the content.
   *
   * The close delay covers the gap between the two on its own, but only by
   * accident: a caller who sets `closeDelay: 0` would lose the tooltip the
   * instant the pointer touched it. Asking where the pointer went makes the
   * crossing safe at any delay.
   */
  const movedWithin = (event: PointerEvent): boolean => {
    const to = event.relatedTarget;
    if (!(to instanceof Node)) return false;
    return Boolean(options.trigger?.()?.contains(to)) || Boolean(options.content()?.contains(to));
  };

  const onTriggerPointerEnter = (event: PointerEvent) => {
    // Touch has no hover. The emulated one arrives with the tap and never
    // leaves, so the tooltip would sit over whatever was just tapped.
    if (event.pointerType === 'touch') return;
    onTrigger = true;
    scheduleOpen();
  };

  const onTriggerPointerLeave = (event: PointerEvent) => {
    onTrigger = false;
    pressedTrigger = false;
    if (movedWithin(event)) return;
    scheduleClose();
  };

  const onTriggerPointerDown = () => {
    pressedTrigger = true;
    // A press means the user has stopped reading and started acting: the
    // tooltip has done its job, and would otherwise cover whatever the press
    // opened. It stays shut until the pointer leaves and comes back.
    setOpen(false);
  };

  const onTriggerFocus = (event: FocusEvent) => {
    const fromPress = pressedTrigger;
    pressedTrigger = false;
    if (fromPress) return;
    if (!isKeyboardFocus(event.target)) return;
    // No delay. The open delay exists to filter out a pointer passing over
    // something; a Tab press is unambiguous, and there is nothing a keyboard
    // user can do to "hover a little longer".
    setOpen(true);
  };

  const onTriggerBlur = () => {
    pressedTrigger = false;
    // Tab moves focus without moving the pointer, and the pointer resting on
    // the trigger is its own reason for the tooltip to be open.
    if (onTrigger || onContent) return;
    setOpen(false);
  };

  const onContentPointerEnter = () => {
    onContent = true;
    // Cancels the close the trigger's own leave scheduled, and nothing more:
    // the content exists only while the tooltip is open or on its way out, and
    // hovering something mid-exit should not drag it back.
    clearTimers();
  };

  const onContentPointerLeave = (event: PointerEvent) => {
    onContent = false;
    if (movedWithin(event)) return;
    scheduleClose();
  };

  // Everything that only applies while open lives in one effect, so it is set
  // up and torn down as a unit — including on unmount, which is the case that
  // would otherwise leave the shared group counting a tooltip that no longer
  // exists.
  effect(() => {
    if (!state.get()) return;

    openTooltips += 1;
    onCleanup(() => {
      openTooltips -= 1;
      skipUntil = Date.now() + skipDelay;
    });

    createDismiss(() => options.content(), () => setOpen(false), {
      escape: options.closeOnEscape !== false,
      // Outside presses are already covered by leave and blur, so this rule
      // never fires first. It is on because dismissal only ever acts on the
      // topmost layer: a tooltip that opted out would swallow the press that
      // was meant to close the dialog underneath it.
      outsidePointer: true,
      // The trigger is not "outside" — its own press handler closes the
      // tooltip, and dismissing here as well would race with it.
      exclude: () => (options.trigger ? [options.trigger()] : []),
    });
  });

  return {
    isOpen: () => state.get(),
    isPresent: () => presence.isPresent(),
    state: () => presence.state(),
    anchorName: () => anchor.name(),
    placement: () => anchor.placement(),

    open: () => setOpen(true),
    close: () => setOpen(false),

    triggerProps: () => ({
      // Tied to presence rather than to open: during an exit animation the
      // content is still in the document, and a reference that blinks off
      // early is a dangling one for as long as the animation lasts.
      'aria-describedby': presence.isPresent() ? contentId : undefined,
      'aria-label': options.label,
      // The name the content positions against, and nothing else: being
      // pointed at by a tooltip changes nothing about what the trigger is.
      ...anchor.anchorProps(),
      onPointerEnter: onTriggerPointerEnter,
      onPointerLeave: onTriggerPointerLeave,
      onPointerDown: onTriggerPointerDown,
      onFocus: onTriggerFocus,
      onBlur: onTriggerBlur,
    }),

    contentProps: () => ({
      id: contentId,
      role: 'tooltip',
      'data-state': presence.state(),
      // Which side it sits on, how far off, and what to try instead when that
      // side would leave the viewport — all of it declared, none of it
      // measured, and nothing to reposition on scroll. `data-anchored` carries
      // the browser's answer into CSS for the engines that cannot do it, which
      // is what this leaves room for instead of a polyfill.
      ...anchor.floatingProps(),
      onPointerEnter: onContentPointerEnter,
      onPointerLeave: onContentPointerLeave,
    }),
  };
}

/**
 * Whether focus arrived by keyboard.
 *
 * `:focus-visible` is the browser's own answer to this, heuristics and all,
 * and it is the only one that knows how the user has been driving the page.
 * `matches` throws on a selector the engine does not know, and an engine
 * without it should still show tooltips on focus — so the fallback is yes, and
 * the pointer-press flag remains the floor either way.
 */
function isKeyboardFocus(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  try {
    return target.matches(':focus-visible');
  } catch {
    return true;
  }
}
