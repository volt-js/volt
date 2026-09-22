import { Component, Prop, Signal, useContext } from '@voltdev/core';
import { RadioGroupContext, type VRadioGroup } from './radio-group.js';

/** Replaced by the build; `true` where there is none, which is a test run. */
declare const __VOLT_DEV__: boolean;

/**
 * One choice of a radio group.
 *
 * ```html
 * <v-radio value="monthly">Monthly</v-radio>
 * ```
 *
 * The words written inside the tag go *inside* the control, which is how a
 * radio takes its accessible name from its own contents — so a choice written
 * this way needs no `label` and no id pointing at one. A radio with nothing
 * written inside it is named with `aria-label`, which lands on the control
 * because that is the element `:host` marks.
 *
 * Behind it is a real `<input type="radio">`, visually hidden by the primitive
 * and carrying the value under the group's name. That input is what submits,
 * what `form.reset()` puts back, and what the browser validates the group's
 * `required` against. The `<label>` around both is what makes a press count
 * exactly once wherever in the row it lands — the press the label forwards to
 * the hidden input is swallowed by the primitive, which then points every
 * hidden input back at the value the group actually holds.
 */
@Component({ selector: 'v-radio', templateUrl: './radio.html' })
export class VRadio {
  /** Identifies the choice: it is what the group holds and what submits. */
  @Prop() value = new Signal.State('');
  /**
   * Refuses this choice and says so.
   *
   * The arrows step over it and it never holds the group's tab stop, which is
   * what a native radio group does with a disabled radio and the package's one
   * exception to leaving a disabled control reachable.
   */
  @Prop() disabled = new Signal.State(false);

  /** The row this draws, which is how the group learns where the radio is. */
  field: HTMLElement | null = null;

  /**
   * The group this was written inside, read while the field initializes —
   * which is when a radio is inside the group's own render.
   */
  readonly group: VRadioGroup = (() => {
    const group = useContext(RadioGroupContext);
    if (!group) {
      throw new Error(
        '[volt] <v-radio> has to be written inside <v-radio-group>: the group owns which ' +
          'radio is chosen, the arrow keys between them, and the name they all submit under.',
      );
    }
    return group;
  })();

  constructor() {
    this.group.radios.add(this);
    if (__VOLT_DEV__) {
      const value = this.value.get();
      const twin = this.group.radios.all
        .get()
        .find((radio) => radio !== this && radio.value.get() === value);
      if (twin) {
        throw new Error(
          `[volt] Two <v-radio> tags in one <v-radio-group> carry the value "${value}".\n` +
            '  A value identifies a choice — the group holds one of them and the form ' +
            'submits it — so both of these would be drawn as chosen at once.',
        );
      }
    }
  }
}
