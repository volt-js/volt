import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createNumberInput } from '@voltdev/primitives';
import { clear, show, step, type Scene } from '../scene.ts';

/**
 * The field's own two flags, set before each pass rather than bound: each
 * takes both buttons out with it, and a pass is a mount.
 */
let off = false;
let locked = false;

/**
 * `number-input.html` with the field around it, since the row is drawn inside
 * one and the buttons follow the field's state as well as the range's.
 */
@Component({
  selector: 'v-styled-number-input',
  render: compileTemplate(`
    <div class="volt-field" :spread="qty.fieldProps()">
      <label class="volt-field-label" :ref="label" :spread="qty.labelProps()">Quantity</label>
      <div class="volt-number-input">
        <input class="volt-field-control" :ref="input" :spread="qty.inputProps()"
               :keydown="qty.onKeyDown($event)" :blur="qty.onBlur()">
        <input :spread="qty.hiddenInputProps()">
        <button class="volt-number-input-button" :spread="qty.decrementProps()"
                :mousedown="stay($event)" :click="qty.decrement()">−</button>
        <button class="volt-number-input-button" :spread="qty.incrementProps()"
                :mousedown="stay($event)" :click="qty.increment()">+</button>
      </div>
      <p class="volt-field-description" :ref="hint" :spread="qty.descriptionProps()">Up to 99 per order.</p>
      <p class="volt-field-error" :ref="error" :spread="qty.errorMessageProps()">{ qty.field.messages()[0] ?? '' }</p>
    </div>
  `),
})
class StyledNumberInput {
  label = new Signal.State<Element | null>(null);
  input = new Signal.State<Element | null>(null);
  hint = new Signal.State<Element | null>(null);
  error = new Signal.State<Element | null>(null);

  qty = createNumberInput({
    input: () => this.input.get(),
    label: () => this.label.get(),
    description: () => this.hint.get(),
    errorMessage: () => this.error.get(),
    locale: 'en-US',
    min: 1,
    max: 99,
    // At the top of the range, so the first look sees one button dead and
    // the other live: the two states the sheet draws, side by side.
    defaultValue: 99,
    disabled: () => off,
    readOnly: () => locked,
  });

  /** As the component's: a press leaves focus in the box. */
  stay(event: MouseEvent): void {
    event.preventDefault();
  }
}

export const scene: Scene = (look) => {
  for (const [disabled, readOnly] of [
    [false, false],
    [true, false],
    [false, true],
  ] as const) {
    off = disabled;
    locked = readOnly;
    const { qty } = show(StyledNumberInput);
    look();
    // The other end, where the dead button and the live one swap.
    step(() => qty.setValue(1));
    look();
    // The middle, where both have somewhere to go.
    step(() => qty.setValue(50));
    look();
    clear();
  }
};
