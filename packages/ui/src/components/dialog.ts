import { Component, Prop, Signal } from '@voltdev/core';
import { createDialog, type Dialog } from '@voltdev/primitives';

/**
 * A dialog.
 *
 * The shape every component here has: the primitive holds the behaviour —
 * focus, dismissal, inertness, the scroll lock, the ARIA — and this holds the
 * markup and the classes the sheet draws. Nothing about the dialog is
 * reimplemented, and the primitive itself is `dialog` on the instance, for a
 * caller who needs something this does not offer.
 *
 * State is one signal both sides hold. Pass `open` and it is yours to read and
 * write; pass nothing and the dialog owns it, which is what most callers want.
 *
 * Everything written on the tag reaches the content element, with one
 * exception worth knowing: its `id` is the primitive's, because that is what
 * names the dialog to a screen reader and what a trigger would point at. Name
 * it with a class, or take the element itself with `:ref`.
 */
@Component({ selector: 'v-dialog', templateUrl: './dialog.html' })
export class VDialog {
  /** Your own signal, if the dialog's open state belongs to your component. */
  @Prop() open?: Signal.State<boolean>;
  /**
   * The four below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   */
  /** Where it starts, when the dialog owns its state. */
  @Prop() defaultOpen = false;
  /** Traps focus, makes the rest of the page inert, locks scrolling. */
  @Prop() modal = true;
  /** Escape closes it. */
  @Prop() closeOnEscape = true;
  /** A press outside closes it. */
  @Prop() closeOnOutsidePointer = true;
  /** The heading, when the markup for it is a line of text. */
  @Prop() title = new Signal.State<string | undefined>(undefined);
  /** The line under the heading. */
  @Prop() description = new Signal.State<string | undefined>(undefined);
  @Prop() onOpenChange?: (open: boolean) => void;

  content = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly dialog: Dialog = createDialog({
    content: () => this.content.get(),
    ...(this.open ? { open: this.open } : {}),
    defaultOpen: this.defaultOpen,
    modal: this.modal,
    closeOnEscape: this.closeOnEscape,
    closeOnOutsidePointer: this.closeOnOutsidePointer,
    ...(this.onOpenChange ? { onOpenChange: this.onOpenChange } : {}),
  });
}
