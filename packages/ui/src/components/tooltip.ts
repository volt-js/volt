import { Component, Prop, Signal, effect } from '@voltdev/core';
import { createTooltip, type AnchorPlacement, type Tooltip } from '@voltdev/primitives';

/**
 * A tooltip: a short description of the control it is written around.
 *
 * ```html
 * <v-tooltip text="Delete permanently">
 *   <v-button :slot-trigger variant="danger">Delete</v-button>
 * </v-tooltip>
 * ```
 *
 * The control goes in the `trigger` slot and the description is the default
 * slot, or `text` when it is a line of text. It opens on hover *and* on
 * keyboard focus, which is the primitive's doing and the reason a tooltip is
 * worth having a primitive for: hover alone puts the text behind a pointer,
 * and the user with no pointer is the one the description was written for.
 *
 * The trigger therefore has to be something that can take focus — a button, a
 * link, an element the caller made focusable. A tooltip on a bare `<span>` is
 * unreachable by keyboard, and no attribute this writes fixes that.
 *
 * ## The wrapper, and what it is not
 *
 * The primitive is handed an element: it anchors to it, asks whether the
 * pointer went into it, and excludes it from dismissal. Slot content is the
 * caller's markup, which a template cannot `:ref`, so this draws a `<span>`
 * around the slot and hands the primitive that. A `<span>` is what makes the
 * wrapper free: it is inline, it takes no style of its own from the sheet,
 * and its box is its content's box — so it anchors where the control is and
 * lays out where the control did. A `<div>` here would break every row a
 * caller ever put a tooltip in.
 *
 * Two things the wrapper cannot stand in for, and both are handled below
 * rather than left broken, because both are exactly what a tooltip is for:
 *
 * - **What is announced belongs on the control.** `aria-describedby` on a
 *   `<span>` around a button describes nothing a screen reader will ever
 *   read. So the ARIA half of the primitive's bag is written onto the element
 *   inside the wrapper instead, and the rest is spread on the wrapper.
 * - **Focus does not bubble.** A `focus` listener on the wrapper never hears
 *   the control take focus. `focusin` and `focusout` do bubble, and what they
 *   run is the primitive's own handlers.
 *
 * `:host` is on the floating label, not on the wrapper, for the reason the
 * dialog puts it on its content: the trigger is markup the caller wrote and
 * can class themselves, and the label is the one element of this they cannot
 * otherwise reach.
 */
@Component({ selector: 'v-tooltip', templateUrl: './tooltip.html' })
export class VTooltip {
  /** The description, when it is a line of text; otherwise fill the default slot. */
  @Prop() text = new Signal.State<string | undefined>(undefined);

  /** Your own signal, if the open state belongs to your component. */
  @Prop() open?: Signal.State<boolean>;
  /**
   * The nine below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   */
  /** Where it starts, when the tooltip owns its state. */
  @Prop() defaultOpen = false;
  /** How long the pointer must rest before it opens, in ms. Default 700. */
  @Prop() openDelay?: number;
  /** How long it lingers after the pointer leaves, in ms. Default 300. */
  @Prop() closeDelay?: number;
  /** How long after the last tooltip closed another opens at once, in ms. */
  @Prop() skipDelay?: number;
  /**
   * A name for the trigger, for when this text is the only name it has.
   *
   * An icon button that is described but not named is announced as "button",
   * and some readers skip descriptions altogether. Pass the same words.
   */
  @Prop() label?: string;
  /** Which side of the trigger to sit on. Default `top`. */
  @Prop() placement?: AnchorPlacement;
  /** The gap between trigger and label. A number is pixels. */
  @Prop() offset?: number | string;
  /** Let the browser flip to the opposite side when it would overflow. */
  @Prop() flip = true;
  /** Escape closes it. Turned off, the key reaches the layer beneath. */
  @Prop() closeOnEscape = true;
  @Prop() onOpenChange?: (open: boolean) => void;

  /** The `<span>` around the trigger slot, which is what the primitive is given. */
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly tooltip: Tooltip = createTooltip({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
    ...(this.open ? { open: this.open } : {}),
    defaultOpen: this.defaultOpen,
    ...(this.openDelay !== undefined ? { openDelay: this.openDelay } : {}),
    ...(this.closeDelay !== undefined ? { closeDelay: this.closeDelay } : {}),
    ...(this.skipDelay !== undefined ? { skipDelay: this.skipDelay } : {}),
    ...(this.label !== undefined ? { label: this.label } : {}),
    ...(this.placement !== undefined ? { placement: this.placement } : {}),
    ...(this.offset !== undefined ? { offset: this.offset } : {}),
    flip: this.flip,
    closeOnEscape: this.closeOnEscape,
    ...(this.onOpenChange ? { onOpenChange: this.onOpenChange } : {}),
  });

  constructor() {
    // Describe the control, not the wrapper. This runs after the render lane
    // has written the page, which is the earliest the slot's element exists to
    // be found, and it is a user effect rather than a measure one because the
    // measure phase is read-only — a write there dirties the layout it just
    // forced. Every `aria-` entry of the bag moves, rather than the two the
    // primitive writes today: a list restated here is a list that goes stale
    // without anything failing. What it does not follow is the slot swapping
    // one control for another while open — nothing in a signal says that
    // happened, and a tooltip whose trigger is replaced mid-description is not
    // worth a MutationObserver per tooltip on the page.
    effect(() => {
      const control = this.trigger.get()?.firstElementChild;
      if (!control) return;
      for (const [name, value] of Object.entries(this.tooltip.triggerProps())) {
        if (!name.startsWith('aria-')) continue;
        if (typeof value === 'string') control.setAttribute(name, value);
        else control.removeAttribute(name);
      }
    });
  }

  /**
   * What the wrapper carries: the bag, less what is announced.
   *
   * The ARIA half is on the control instead, and leaving it here as well would
   * point a second `aria-describedby` at the same label from an element no
   * reader visits.
   */
  wrapperProps(): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(this.tooltip.triggerProps()).filter(([name]) => !name.startsWith('aria-')),
    );
  }

  /**
   * `focus` and `blur` do not bubble, so the listeners the bag puts on the
   * wrapper never hear the control inside it. These two do bubble, and what
   * they run is the primitive's own handlers, taken out of the bag it hands
   * out — a second copy of the press guard and the `:focus-visible` test would
   * be a second answer to the question this package should only know one
   * answer to.
   */
  focusIn(event: FocusEvent): void {
    (this.tooltip.triggerProps()['onFocus'] as (event: FocusEvent) => void)(event);
  }

  focusOut(): void {
    (this.tooltip.triggerProps()['onBlur'] as () => void)();
  }
}
