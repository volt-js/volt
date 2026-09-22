import { Component, Prop, Signal } from '@voltdev/core';

/**
 * A button.
 *
 * The one component here with no primitive behind it: a `<button>` already has
 * the behaviour and the accessibility, and wrapping it would only add a way to
 * get them wrong. What it adds is the sheet's look, the attributes that choose
 * it, and the package's rule for a disabled control.
 *
 * Every prop the template reads is a signal, which is what makes it follow a
 * caller who binds it — a plain field is a value handed over once. A caller
 * writes the value either way: `variant="danger"` or `:variant="tone.get()"`.
 *
 * Everything else a caller writes on the tag — a class, an id, an `aria-label`
 * — reaches the `<button>` through `:host`, so this is a button in every way
 * that matters and a component only in how it is written.
 */
@Component({ selector: 'v-button', templateUrl: './button.html' })
export class VButton {
  /** `primary`, `danger`, `ghost`, or nothing for the plain button. */
  @Prop() variant = new Signal.State<'primary' | 'danger' | 'ghost' | undefined>(undefined);
  /** `sm`, `lg`, or nothing for the middle size. */
  @Prop() size = new Signal.State<'sm' | 'lg' | undefined>(undefined);
  /**
   * `button` unless asked otherwise.
   *
   * Defaulted rather than left to the platform, whose default submits the form
   * around it — rarely what a component's caller meant, and never what they
   * wrote.
   */
  @Prop() type = new Signal.State<'button' | 'submit' | 'reset'>('button');
  /**
   * Refuse the press, and say so.
   *
   * `aria-disabled` rather than the `disabled` attribute, so the button keeps
   * its place in the tab order: a control a keyboard user cannot reach is one
   * they cannot discover is there. The press is refused below instead.
   */
  @Prop() disabled = new Signal.State(false);
  /** Called on a press the button did not refuse. */
  @Prop() onPress?: (event: MouseEvent) => void;

  press(event: MouseEvent): void {
    if (this.disabled.get()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.onPress?.(event);
  }
}
