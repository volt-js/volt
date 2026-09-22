import { Component, Prop, Signal } from '@voltdev/core';
import { createSwitch, type ControlProps, type Switch } from '@voltdev/primitives';

/**
 * A switch: a track, a thumb that slides along it, and the words that name it.
 *
 * ```html
 * <v-switch :checked="notify" name="notify">Email me about replies</v-switch>
 * ```
 *
 * A switch is not a checkbox with a different shape. It says a setting is on
 * or off and takes effect where it stands, rather than waiting for a form to
 * be submitted; it has no third state, because "partly on" is not a setting.
 * Use it where flipping it does something, and a checkbox where the answer is
 * collected and sent.
 *
 * Immediate is the promise, not the mechanism — a real
 * `<input type="checkbox">` sits behind the track, visually hidden by the
 * primitive and carrying the value, so a switch written inside a form still
 * submits, still resets, and is still what the browser validates `required`
 * against. Nothing assembled out of `<span>`s does any of that.
 *
 * The words are the default slot and they go *inside* the control, which is
 * how it takes its accessible name from its own contents — so a switch written
 * this way needs no `label` and no id pointing at one. A bare track is named
 * with `label`, or with `aria-label`, the same thing in the platform's
 * spelling.
 *
 * State is one signal both sides hold. Pass `checked` and it is yours to read
 * and write; pass nothing and the switch owns it.
 */
@Component({ selector: 'v-switch', templateUrl: './switch.html' })
export class VSwitch {
  /** Your own signal, if which way the switch is set belongs to your component. */
  @Prop() checked?: Signal.State<boolean>;
  /**
   * The three below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   */
  /** Where it starts, when the switch owns its state. */
  @Prop() defaultChecked?: boolean;
  /** Submitted as `name=value` while on. Without a name it submits nothing. */
  @Prop() name?: string;
  /** What is submitted under that name. `on` is what a native checkbox sends. */
  @Prop() value?: string;

  /** Names a switch that has no words written inside the tag to be named from. */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /** Id of the element that names it, when something already on the page does. */
  @Prop() labelledBy = new Signal.State<string | undefined>(undefined);

  /**
   * The same two in the platform's own spelling, and the third, which only the
   * platform has a spelling for.
   *
   * Declared rather than left to fall through to `:host`, which lands on this
   * component's control as well. A name written on the tag and a name the
   * primitive's bag carries would then be two spreads writing one attribute,
   * and the bag — which has no opinion about `aria-label` unless it was handed
   * one — would take the caller's name back on the first press. Declaring them
   * keeps them out of the host attributes and puts them in the bag, where they
   * are written together with the rest of what the control says.
   *
   * `aria-describedby` has no prop spelling of its own because nothing is
   * handed a description: its ids are what a hint or a validation message is,
   * and `createFormField` computes exactly this string for a field with both.
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
   * that a switch nobody can reach submits nothing.
   *
   * The control keeps its place in the tab order — `aria-disabled`, not the
   * `disabled` attribute — which is this package's rule for every disabled
   * control, and the primitive's.
   */
  @Prop() disabled = new Signal.State(false);
  /** Written through to the input, so the platform enforces it on submit. */
  @Prop() required = new Signal.State(false);

  /** Called with the setting the switch moved to, as it moves. */
  @Prop() onCheckedChange?: (checked: boolean) => void;

  /**
   * The hidden input.
   *
   * A signal rather than a plain field because the primitive watches it: the
   * element does not exist while this class is being built, and the mirror of
   * `checked` onto it has to start the moment it does.
   */
  input = new Signal.State<Element | null>(null);

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly switch: Switch = createSwitch({
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
   * keys the new object does not carry, so a name written next to it is a name
   * the first press wipes. The names are not handed to the primitive either,
   * which reads its options once: they are read here, so a name bound to a
   * signal — a row's label, a message that appears — follows it.
   *
   * What the caller wrote in ARIA wins over the prop that says the same thing.
   * Two spellings of one name can only disagree by mistake, and the attribute
   * is the one they wrote on the tag.
   */
  controlProps(): ControlProps {
    return {
      ...this.switch.controlProps(),
      'aria-label': this.ariaLabel.get() ?? this.label.get(),
      'aria-labelledby': this.ariaLabelledBy.get() ?? this.labelledBy.get(),
      'aria-describedby': this.describedBy.get(),
    };
  }
}
