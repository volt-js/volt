/**
 * Popover — a layer anchored to the control that opened it.
 *
 * Non-modal by default: focus moves in, but the page behind stays live,
 * scrollable and readable. That is what separates a popover from a dialog, and
 * it is a behaviour difference rather than a visual one. `modal: true` is here
 * for the cases that need it, though wanting it is usually a sign that
 * `createDialog` was the component you were reaching for.
 *
 * Positioning is `createAnchor`, which is CSS anchor positioning and nothing
 * else: the trigger gets an `anchor-name`, the content a `position-anchor`, a
 * `position-area` and the fallbacks to try when the side it asked for would
 * overflow. No measuring, no scroll or resize listeners, no Floating UI — the
 * browser keeps the two together.
 *
 * It was written out inline here once, and the position areas were spelled in
 * logical keywords. That was a defect rather than a preference: the browser
 * resolves `span-x-end` and its friends against the *positioned* element's
 * containing block, which for a portalled popover is <body>, so a trigger
 * inside an RTL region of an otherwise LTR page aligned to the wrong edge.
 * The shared implementation reads the direction off the trigger and emits
 * physical keywords, which is what the migration fixed.
 *
 * Where anchor positioning is missing the content says so with
 * `data-anchored="false"` and your CSS can place it however you like; that
 * browser gets no collision handling, which is the price of not shipping a
 * layout engine to every browser that does not need one.
 *
 *   class Filters {
 *     trigger = new Signal.State<Element | null>(null);
 *     content = new Signal.State<Element | null>(null);
 *     popover = createPopover({
 *       trigger: () => this.trigger.get(),
 *       content: () => this.content.get(),
 *       placement: 'bottom-start',
 *     });
 *   }
 *
 *   <button :ref="trigger" :spread="popover.triggerProps()">Filters</button>
 *   <div :if="popover.isPresent()" :portal
 *        :ref="content" :spread="popover.contentProps()">
 *     <h2 :spread="popover.titleProps()">Filters</h2>
 *     <button :spread="popover.closeProps()">✕</button>
 *   </div>
 *
 * The positioning scheme is written inline, because a `position-area` on a
 * statically positioned element does nothing at all. The gap is yours, either
 * in CSS:
 *
 *   [data-state='open'] { margin: 4px; }
 *
 * or as `offset: 4`, which puts the margin on whichever side faces the trigger
 * and moves it when the browser takes a fallback.
 *
 * The trigger's props carry its own click and keydown handlers, so there is no
 * `:click` to remember and no way to ship a trigger the mouse can open and the
 * keyboard cannot.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createPresence, type PresenceState } from './presence.js';
import { createDismiss, isInsideLayer, type DismissReason } from './dismiss.js';
import { createFocusScope, focusableWithin } from './focus-scope.js';
import { createAnchor, type AnchorPlacement } from './anchoring.js';
import { createId } from './id.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

/**
 * Which side of the trigger the popover sits on, and how it lines up.
 *
 * The anchoring primitive's own type under a name that reads in place. Spelled
 * out again here once, which meant two lists to keep in step and no compiler
 * anywhere to notice when they drifted.
 */
export type PopoverPlacement = AnchorPlacement;

/**
 * Every string this component can put in front of a user.
 *
 * They are options because they will be localised, and a library that hard
 * codes English is a library that has to be forked to ship anywhere else.
 */
export interface PopoverLabels {
  /** Name for the popover itself, used when no title element is rendered. */
  content?: string;
  /** Name for the close control. Default `Close`. */
  close?: string;
}

export interface PopoverOptions {
  /** The popover's content element, once rendered. */
  content: () => Element | null | undefined;
  /**
   * The element that opens it. Optional, but without it a press on the trigger
   * counts as a press outside, and there is nowhere sensible to put focus back.
   */
  trigger?: () => Element | null | undefined;

  /**
   * Supply a signal to control the popover from outside. Without one it owns
   * its own state, which is what most callers want.
   */
  open?: Signal.State<boolean>;
  defaultOpen?: boolean;

  /**
   * Trap focus and mark the popover as modal. Default false.
   *
   * Unlike `createDialog` this does not make the rest of the page inert or
   * lock scrolling: a popover is small and transient, and a layer that needs
   * the page behind it switched off is a dialog. The tradeoff is that
   * `aria-modal` here is a claim about focus, not about the whole document.
   */
  modal?: boolean;

  /** Which side of the trigger to sit on. Default `bottom`. */
  placement?: PopoverPlacement;
  /**
   * The gap between trigger and popover. A number is pixels.
   *
   * Written as a margin on the side that faces the trigger, so it follows the
   * popover across a flip. A gap written in your own CSS does not: it stays on
   * the side you put it on, and ends up between the popover and nothing.
   */
  offset?: number | string;
  /**
   * Let the browser move the popover to the opposite side when it would
   * overflow. Default true. Costs nothing where anchor positioning is absent,
   * because the declaration is simply ignored there.
   */
  flip?: boolean;

  /** Escape closes it. Default true. */
  closeOnEscape?: boolean;
  /** A press outside closes it. Default true. */
  closeOnOutsidePointer?: boolean;
  /**
   * Focus landing outside closes it. Default true, and non-modal only — a
   * modal popover keeps focus inside, so nothing can land outside it.
   *
   * This is what stops a non-modal popover being left open and forgotten
   * behind the field the user has since tabbed to.
   */
  closeOnFocusOutside?: boolean;

  /** Move focus into the popover when it opens. Default true. */
  autoFocus?: boolean;
  /** Put focus back where it came from when it closes. Default true. */
  restoreFocus?: boolean;
  /** What to focus first, instead of the first focusable element. */
  initialFocus?: () => Element | null | undefined;

  labels?: PopoverLabels;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A bag of attributes to spread. Event handlers are included: they are created
 * once per popover, so spreading the same props again re-registers nothing.
 */
export interface PopoverProps {
  readonly [key: string]:
    | string
    | boolean
    | undefined
    | Readonly<Record<string, string>>
    | ((event: KeyboardEvent) => void)
    | (() => void);
}

export interface Popover {
  /** Whether the popover is logically open. */
  isOpen(): boolean;
  /** Whether its content should be in the DOM — stays true during exit. */
  isPresent(): boolean;
  /** `open` or `closed`, for CSS to animate against. */
  state(): PresenceState;
  /**
   * The placement it was asked for, for an arrow or a transform origin. Not
   * necessarily the side it is on: when the engine takes one of the fallbacks
   * it does not report which, and there is no API to ask.
   */
  placement(): PopoverPlacement;
  /**
   * The anchor's name, for CSS that wants to position something else against
   * the same trigger — `top: anchor(--volt-anchor-1 bottom)`.
   */
  anchorName(): string;

  open(): void;
  close(): void;
  toggle(): void;

  triggerProps(): PopoverProps;
  contentProps(): PopoverProps;
  titleProps(): PopoverProps;
  descriptionProps(): PopoverProps;
  closeProps(): PopoverProps;
  /** For a decorative arrow: anchored to the trigger, hidden from readers. */
  arrowProps(): PopoverProps;
}

export function createPopover(options: PopoverOptions): Popover {
  const state = options.open ?? new Signal.State(options.defaultOpen ?? false);
  const modal = options.modal === true;
  const labels = options.labels ?? {};

  const contentId = createId('popover-content');
  const titleId = createId('popover-title');
  const descriptionId = createId('popover-description');
  const anchor = createAnchor({
    anchor: () => options.trigger?.(),
    defaultPlacement: options.placement ?? 'bottom',
    offset: options.offset,
    flip: options.flip,
  });

  // Whether a title or description was actually rendered. Read from the DOM
  // rather than declared, so the consumer cannot forget to say so and get a
  // dangling `aria-labelledby` for their trouble.
  const hasTitle = new Signal.State(false);
  const hasDescription = new Signal.State(false);

  const presence = createPresence(
    () => state.get(),
    () => options.content(),
  );

  const setOpen = (next: boolean) => {
    // Untracked because `open()` may well be called from inside an effect, and
    // subscribing that effect to the state it just wrote would re-run it every
    // time the popover opens.
    if (untrack(() => state.get()) === next) return;
    state.set(next);
    options.onOpenChange?.(next);
  };
  const toggle = () => setOpen(!untrack(() => state.get()));

  // Handlers are created once, not per props call. `:spread` re-applies the
  // whole bag whenever any part of it changes, and `addEventListener` only
  // ignores a repeat registration when the function is the same one — a fresh
  // closure each time would stack a new listener on every open.
  const onTriggerClick = () => toggle();

  const onTriggerKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const el = event.currentTarget instanceof Element ? event.currentTarget : options.trigger?.();
    // A real button turns these keys into a click by itself. Handling them
    // here as well would toggle twice and leave the popover exactly as it was.
    if (activatesOnKey(el, event.key)) return;
    // Space scrolls the page unless we say otherwise.
    event.preventDefault();
    toggle();
  };

  const onContentKeyDown = (event: KeyboardEvent) => {
    // A modal popover keeps focus inside; the focus scope owns Tab there.
    if (modal || event.key !== 'Tab') return;

    const content = options.content();
    const trigger = options.trigger?.();
    if (!content || !trigger) return;

    const items = focusableWithin(content);
    const active = content.ownerDocument.activeElement;
    const backwards = event.shiftKey;
    const leaving = backwards
      ? items.length === 0 || active === content || active === items[0]
      : items.length === 0 || active === items.at(-1);
    if (!leaving) return;

    // The content is normally portalled to the end of <body>, so the browser's
    // own tab order would carry focus off to whatever happens to sit beside the
    // portal. Tab out of a popover belongs either side of its trigger instead.
    const next = backwards ? trigger : tabbableAfter(trigger, content);
    event.preventDefault();
    // With nothing after the trigger there is nowhere better to go: the trigger
    // is at least where the user was, and is never a trap.
    ((next ?? trigger) as HTMLElement).focus?.();
    setOpen(false);
  };

  const onCloseClick = () => setOpen(false);

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
        // the popover is told not to close on them: a layer that holds focus and
        // stays open still keeps them from the layer beneath it.
        // The trigger is not "outside": dismissing on it would close the
        // popover and then the trigger's own handler would reopen it.
        exclude: () => (options.trigger ? [options.trigger()] : []),
      },
    );

    if (modal) {
      createFocusScope(() => options.content(), {
        autoFocus: options.autoFocus !== false,
        restoreFocus: options.restoreFocus !== false,
        initialFocus: options.initialFocus,
      });
      return;
    }

    nonModalFocus(content, {
      trigger: () => options.trigger?.(),
      close: () => setOpen(false),
      autoFocus: options.autoFocus !== false,
      restoreFocus: options.restoreFocus !== false,
      closeOnFocusOutside: options.closeOnFocusOutside !== false,
      initialFocus: options.initialFocus,
    });
  });

  return {
    isOpen: () => state.get(),
    isPresent: () => presence.isPresent(),
    state: () => presence.state(),
    placement: () => anchor.placement(),
    anchorName: () => anchor.name(),

    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle,

    triggerProps: () => {
      const props: Record<string, PopoverProps[string]> = {
        'aria-haspopup': 'dialog',
        'aria-expanded': String(state.get()),
        // Only while it exists: an `aria-controls` pointing at nothing tells a
        // screen reader there is something to go to, and then loses it.
        'aria-controls': state.get() ? contentId : undefined,
        onclick: onTriggerClick,
        onkeydown: onTriggerKeyDown,
      };

      // A <div> trigger is not focusable and does not announce itself; a real
      // <button> is both already, and would rather not be told twice.
      if (needsButtonRole(options.trigger?.())) {
        props.role = 'button';
        props.tabindex = '0';
      }

      // Assigned rather than read off a known key, because anchoring hands
      // back an empty bag where the browser cannot do it — and writing
      // `style: undefined` is not the same as writing no style at all.
      Object.assign(props, anchor.anchorProps());
      return props;
    },

    contentProps: () => {
      const props: Record<string, PopoverProps[string]> = {
        id: contentId,
        role: 'dialog',
        // Only claimed when focus is actually held inside. Saying it otherwise
        // tells a screen reader the rest of the page is unavailable while the
        // user can still tab straight into it.
        'aria-modal': modal ? 'true' : undefined,
        'aria-labelledby': hasTitle.get() ? titleId : undefined,
        // A name given as an option is the fallback, not the preference: a
        // visible title labels the popover for everyone, not just for readers.
        'aria-label': !hasTitle.get() && labels.content ? labels.content : undefined,
        'aria-describedby': hasDescription.get() ? descriptionId : undefined,
        'data-state': presence.state(),
        // The content itself must be able to hold focus, or a popover with
        // nothing focusable inside has nowhere to put it.
        tabindex: '-1',
        onkeydown: onContentKeyDown,
      };

      // Where it goes, what to try instead when that would overflow, and
      // `data-placement` and `data-anchored` — the second of which is advisory,
      // for CSS that has to place the popover itself on a browser that cannot:
      // `[data-anchored='false'] { … }`.
      Object.assign(props, anchor.floatingProps());
      return props;
    },

    titleProps: () => ({ id: titleId }),
    descriptionProps: () => ({ id: descriptionId }),

    closeProps: () => ({
      // Inside a form, a button with no type submits it.
      type: 'button',
      // A close control is usually a glyph, and a glyph is not a name. If yours
      // has visible text, pass that text as `labels.close` so that the name and
      // the text cannot disagree — or be in different languages.
      'aria-label': labels.close ?? 'Close',
      onclick: onCloseClick,
    }),

    // Deliberately not `anchor.arrowProps()`. That places the arrow in the
    // trigger's own position-area grid, which is right for an arrow that is a
    // sibling of the content; this one is a child of it, drawn against the
    // content's own edge from `data-placement`, and an inline `position-area`
    // would lift it out of that box. All it takes from anchoring is the name,
    // so that CSS which does want to reach the trigger can.
    arrowProps: () => {
      const props: Record<string, PopoverProps[string]> = {
        'data-placement': anchor.placement(),
        // An arrow is a drawing of the relationship the ARIA already states.
        'aria-hidden': 'true',
      };
      if (anchor.isSupported()) props.style = { 'position-anchor': anchor.name() };
      return props;
    },
  };
}

/**
 * Whether this trigger has to be told that it is a button.
 *
 * Anything that is not already an activatable control needs the role and a tab
 * stop. Until the ref has landed there is nothing to look at, and adding
 * attributes we would then have to take back is worse than adding them a tick
 * later.
 */
function needsButtonRole(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SUMMARY') return false;
  return !(tag === 'A' && el.hasAttribute('href'));
}

/** Whether the browser will turn this key into a click on this element. */
function activatesOnKey(el: Element | null | undefined, key: string): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SUMMARY') return true;
  // A link is activated by Enter alone. Space scrolls the page there, and a
  // trigger that does nothing on Space is worse than one that opens: the author
  // asked for a popover when they spread these props.
  return key === 'Enter' && tag === 'A' && el.hasAttribute('href');
}

/**
 * The next thing in the page's tab order after `trigger`, ignoring anything
 * inside the popover itself.
 */
function tabbableAfter(trigger: Element, content: Element): HTMLElement | null {
  const all = focusableWithin(trigger.ownerDocument.body).filter((el) => !content.contains(el));
  // Widened rather than narrowing `trigger`: every HTMLElement is an Element,
  // and the reverse would be an assertion this cannot make good on.
  const index = (all as Element[]).indexOf(trigger);
  if (index === -1) return null;
  return all[index + 1] ?? null;
}

interface NonModalFocusOptions {
  trigger: () => Element | null | undefined;
  close: () => void;
  autoFocus: boolean;
  restoreFocus: boolean;
  closeOnFocusOutside: boolean;
  initialFocus?: () => Element | null | undefined;
}

/**
 * Focus for a non-modal popover: move in on open, come back out on close, and
 * close if the user takes focus somewhere else entirely.
 *
 * This deliberately does not use `createFocusScope`, which traps — trapping is
 * the one thing "non-modal" rules out. What is shared is `focusableWithin`,
 * so both agree on what counts as focusable, and the ordering trick below.
 */
function nonModalFocus(content: Element, options: NonModalFocusOptions): void {
  const doc = content.ownerDocument;
  const previouslyFocused = doc.activeElement as HTMLElement | null;

  // Registered before the listener, and cleanups run newest-first, so this runs
  // last — after the listener that would otherwise see focus coming back and
  // read it as a reason to close something that is already closing.
  onCleanup(() => {
    if (!options.restoreFocus) return;

    const active = doc.activeElement;
    // Only take focus back if the popover still had it, or if it was dropped on
    // the body when the content went away. If the user has moved on — tabbed to
    // the next field, clicked into an editor — hauling focus back to the trigger
    // is the rudest thing this could do.
    if (active && active !== doc.body && !content.contains(active)) return;

    if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  });

  if (options.autoFocus) {
    // Untracked: this runs inside the popover's open step, which must not be
    // set up again — moving focus as it goes — because what the getter reads
    // has changed.
    const preferred = untrack(() => options.initialFocus?.()) as HTMLElement | null | undefined;
    const target = preferred ?? focusableWithin(content)[0] ?? (content as HTMLElement);
    target.focus?.();
  }

  if (!options.closeOnFocusOutside) return;

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    // A popover opened from inside this one is portalled out of it, but focus
    // going there has not gone somewhere else entirely.
    if (!(target instanceof Node) || isInsideLayer(content, target)) return;
    // The trigger is not outside. Focusing it on the way to a click has to
    // leave the popover alone, or the press would close it here and the
    // trigger's own handler would open it straight back up.
    if (options.trigger()?.contains(target)) return;
    options.close();
  };

  doc.addEventListener('focusin', onFocusIn, true);
  onCleanup(() => doc.removeEventListener('focusin', onFocusIn, true));
}
