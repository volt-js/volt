import { Component, Prop, Signal } from '@voltdev/core';
import {
  createCheckbox,
  type Checkbox,
  type CheckedState,
  type ControlProps,
} from '@voltdev/primitives';

/**
 * A checkbox: a box, and the words that name it.
 *
 * ```html
 * <v-checkbox :checked="agreed" name="terms">I accept the terms</v-checkbox>
 * ```
 *
 * The words are the default slot and they go *inside* the control, which is
 * how the control takes its accessible name from its own contents — so a
 * checkbox written this way needs no `label` and no id pointing at one. A box
 * with nothing written inside it is named with `label` — or with `aria-label`,
 * the same thing in the platform's own spelling — because a control with no
 * text has nothing to be named from.
 *
 * Behind the box is a real `<input type="checkbox">`, visually hidden by the
 * primitive and carrying the value. That is what submits with the form, what
 * `FormData` reads, what `form.reset()` puts back, and what the browser
 * validates `required` against; a control assembled out of `<span>`s does none
 * of it. The `<label>` around both is what makes a press on the words count
 * exactly once — the press lands there whether the user hit the box or the
 * text, and the press the label forwards to the hidden input is swallowed by
 * the primitive.
 *
 * State is one signal both sides hold. Pass `checked` and it is yours to read
 * and write, pass nothing and the checkbox owns it — including the third
 * state, `indeterminate`, which a parent box shows while only some of its
 * children are ticked and which becomes `true` when toggled, as the platform's
 * own does.
 */
@Component({ selector: 'v-checkbox', templateUrl: './checkbox.html' })
export class VCheckbox {
  /** Your own signal, if the checked state belongs to your component. */
  @Prop() checked?: Signal.State<CheckedState>;
  /**
   * The three below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   */
  /** Where it starts, when the checkbox owns its state. */
  @Prop() defaultChecked?: CheckedState;
  /** Submitted as `name=value` while checked. Without a name it submits nothing. */
  @Prop() name?: string;
  /** What is submitted under that name. `on` is what a native checkbox sends. */
  @Prop() value?: string;

  /** Names a box that has no words written inside the tag to be named from. */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /** Id of the element that names it, when something already on the page does. */
  @Prop() labelledBy = new Signal.State<string | undefined>(undefined);

  /**
   * The same two, in the spelling the platform already has — and the third,
   * which only the platform has a spelling for.
   *
   * These are declared rather than left to fall through to `:host`, and that
   * is the whole of the fix they are. `:host` is on the row, because the row
   * is what a caller sees and would have classed by hand; everything they
   * write that this does not claim lands there. For a class or a `data-*`
   * that is right. For these three it is a silent loss: the row carries no
   * role, so a name on it names nothing, and the `role="checkbox"` element is
   * left with none. A declared prop is never a host attribute, so writing
   * them down is what keeps them off the row and puts them on the control
   * with the rest of its bag.
   *
   * `aria-describedby` has no prop of its own because nothing is handed a
   * description — not the primitive, not the control. Its ids are what a hint
   * or a validation message is, and `createFormField` computes exactly this
   * string for a field that has both.
   */
  @Prop({ alias: 'aria-label' }) ariaLabel = new Signal.State<string | undefined>(undefined);
  @Prop({ alias: 'aria-labelledby' }) ariaLabelledBy = new Signal.State<string | undefined>(
    undefined,
  );
  @Prop({ alias: 'aria-describedby' }) describedBy = new Signal.State<string | undefined>(
    undefined,
  );

  /**
   * Refuses the press and the keyboard, and is written through to the input so
   * that a disabled box submits nothing.
   *
   * The control keeps its place in the tab order — `aria-disabled`, not the
   * `disabled` attribute — which is this package's rule for every disabled
   * control, and the primitive's.
   */
  @Prop() disabled = new Signal.State(false);
  /** Written through to the input, so the platform enforces it on submit. */
  @Prop() required = new Signal.State(false);

  /** Called with the state the box moved to. */
  @Prop() onCheckedChange?: (checked: CheckedState) => void;

  /**
   * The hidden input.
   *
   * A signal rather than a plain field because the primitive watches it: the
   * element does not exist while this class is being built, and the mirror of
   * `checked` and `indeterminate` onto it has to start the moment it does.
   */
  input = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly checkbox: Checkbox = createCheckbox({
    input: () => this.input.get(),
    disabled: () => this.disabled.get(),
    required: () => this.required.get(),
    ...(this.checked ? { checked: this.checked } : {}),
    ...(this.defaultChecked !== undefined ? { defaultChecked: this.defaultChecked } : {}),
    ...(this.name !== undefined ? { name: this.name } : {}),
    ...(this.value !== undefined ? { value: this.value } : {}),
    ...(this.onCheckedChange ? { onCheckedChange: this.onCheckedChange } : {}),
  });

  /**
   * What the control carries: the primitive's bag, and what names it.
   *
   * One bag rather than a spread and an attribute beside it. `:spread`
   * rewrites the element whenever the state it reads changes and clears the
   * keys the new object does not carry, so a name written next to it is a
   * name the first press wipes. The names are not handed to the primitive
   * either, which reads its options once: they are read here, so a name bound
   * to a signal — a row's label, a message that appears — follows it.
   *
   * What the caller wrote in ARIA wins over the prop that says the same
   * thing. Two spellings of one name can only disagree by mistake, and the
   * attribute is the one they wrote on the tag.
   */
  controlProps(): ControlProps {
    return {
      ...this.checkbox.controlProps(),
      'aria-label': this.ariaLabel.get() ?? this.label.get(),
      'aria-labelledby': this.ariaLabelledBy.get() ?? this.labelledBy.get(),
      'aria-describedby': this.describedBy.get(),
    };
  }

  /**
   * The mark inside the box, when nothing was written for the `mark` slot.
   *
   * Drawn in every state and shown by its colour, which is the sheet's doing:
   * an unchecked box draws the mark in `transparent` so that the box does not
   * resize between states. A glyph rather than an SVG because a glyph is
   * `currentColor` already, which is what that trick needs.
   */
  mark(): string {
    return this.checkbox.isIndeterminate() ? '–' : '✓';
  }
}
