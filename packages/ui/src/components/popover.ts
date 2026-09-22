import { Component, Prop, Signal } from '@voltdev/core';
import { createPopover, type Popover, type PopoverPlacement } from '@voltdev/primitives';

/**
 * A popover: a panel anchored to the control that opened it.
 *
 * ```html
 * <v-popover title="Filters" description="Narrow the list." placement="bottom-start">
 *   <template :slot-trigger>Filters</template>
 *   <p>Everything since Monday.</p>
 * </v-popover>
 * ```
 *
 * The trigger belongs to the component, where the dialog's belongs to the
 * caller, and the difference is the positioning: the panel is placed against
 * the trigger in CSS, and the `anchor-name` that does it has to be on an
 * element this renders. So the trigger is a `<button>` drawn with the sheet's
 * button rules — `variant` and `size` are that button's — and the `trigger`
 * slot is what goes inside it.
 *
 * The panel portals, so it is the panel that carries `:host`:
 * `<v-popover class="wide">` is about the thing the caller can see opening,
 * not about the button left behind.
 *
 * `title` and `description` are props, and the slots of the same names are
 * drawn *inside* the elements those props would have filled. That is what
 * keeps the naming honest: the primitive names the panel after the element
 * carrying its own id, so markup written for a heading has to land in that
 * element rather than beside it. The prop is therefore what says the panel has
 * a heading at all — without one the element is not rendered, and the panel is
 * named by `label` instead of by an empty line.
 *
 * Non-modal, like the primitive: focus moves into the panel, the page behind
 * stays live and scrollable, and focus landing anywhere else closes it.
 * `modal` traps focus instead — and wanting that is usually a sign that
 * `<v-dialog>` was the component being reached for.
 */
@Component({ selector: 'v-popover', templateUrl: './popover.html' })
export class VPopover {
  /** Your own signal, if the open state belongs to your component. */
  @Prop() open?: Signal.State<boolean>;

  /**
   * The nine below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   */
  /** Where it starts, when the popover owns its state. */
  @Prop() defaultOpen = false;
  /** Which side of the trigger the panel sits on, and which edge it lines up with. */
  @Prop() placement: PopoverPlacement = 'bottom';
  /**
   * The gap between trigger and panel; a number is pixels.
   *
   * Written inline by the primitive, on the side that faces the trigger, which
   * replaces the gap the sheet leaves. Worth setting only when that gap is
   * wrong for your design.
   */
  @Prop() offset?: number | string;
  /**
   * Let the browser move the panel to the opposite side when it would
   * overflow the viewport.
   *
   * The arrow is drawn from the placement that was asked for, and no engine
   * says which fallback it took — so a panel that flips keeps an arrow
   * pointing at nothing. Turning this and `shift` off holds the placement, at
   * the price of a panel that can run off the edge.
   */
  @Prop() flip = true;
  /** Let the browser line it up with the trigger's other edge instead. Same catch as `flip`. */
  @Prop() shift = true;
  /**
   * Keep focus inside the panel.
   *
   * Unlike the dialog this leaves the rest of the page live and scrolling: a
   * popover is small and transient, and a layer that needs the page behind it
   * switched off is a dialog.
   */
  @Prop() modal = false;
  /** Escape closes it. */
  @Prop() closeOnEscape = true;
  /** A press outside closes it. */
  @Prop() closeOnOutsidePointer = true;
  /**
   * The panel's name for a screen reader, for a popover with no title.
   *
   * The fallback rather than the preference: a visible title names the panel
   * for everyone, and is used instead whenever there is one.
   */
  @Prop() label?: string;

  /** The heading, when the markup for it is a line of text. */
  @Prop() title = new Signal.State<string | undefined>(undefined);
  /** The line under the heading. */
  @Prop() description = new Signal.State<string | undefined>(undefined);
  /** The trigger's look: `primary`, `danger`, `ghost`, or nothing for the plain button. */
  @Prop() variant = new Signal.State<'primary' | 'danger' | 'ghost' | undefined>(undefined);
  /** The trigger's size: `sm`, `lg`, or nothing for the middle one. */
  @Prop() size = new Signal.State<'sm' | 'lg' | undefined>(undefined);
  @Prop() onOpenChange?: (open: boolean) => void;

  /** The button the panel is anchored to, and the press is not "outside" of. */
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly popover: Popover = createPopover({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
    ...(this.open ? { open: this.open } : {}),
    defaultOpen: this.defaultOpen,
    placement: this.placement,
    ...(this.offset !== undefined ? { offset: this.offset } : {}),
    flip: this.flip,
    shift: this.shift,
    modal: this.modal,
    closeOnEscape: this.closeOnEscape,
    closeOnOutsidePointer: this.closeOnOutsidePointer,
    ...(this.label !== undefined ? { labels: { content: this.label } } : {}),
    ...(this.onOpenChange ? { onOpenChange: this.onOpenChange } : {}),
  });
}
