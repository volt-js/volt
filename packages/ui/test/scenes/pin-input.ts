import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createPinInput } from '@voltdev/primitives';
import { clear, show, step, type Scene } from '../scene.ts';

/**
 * `pin-input.html`, with the primitive's own bags on the group and the boxes
 * where the component merges the caller's names into the one and moves
 * `aria-required` onto the other. The sheet reads none of those, so the
 * picture of what it selects on is the same — and `pin-input.test.ts` holds
 * the entry against the real template as well.
 */
@Component({
  selector: 'v-styled-pin-input',
  render: compileTemplate(`
    <form>
      <div class="volt-field" :spread="pin.fieldProps()">
        <label class="volt-field-label" :ref="label" :spread="pin.labelProps()">Verification code</label>
        <div :ref="group" class="volt-pin-input" :spread="pin.groupProps()">
          <input :for="index in boxes" :key="index" class="volt-pin-input-box"
                 :spread="pin.boxProps(index)" :keydown="pin.onKeyDown($event, index)"
                 :input="pin.onInput($event, index)" :paste="pin.onPaste($event, index)"
                 :focus="pin.onFocus(index)">
        </div>
        <input :ref="hidden" :spread="pin.hiddenInputProps()">
        <p class="volt-field-description" :ref="hint" :spread="pin.descriptionProps()">Sent by text message.</p>
        <p class="volt-field-error" :ref="error" :spread="pin.errorMessageProps()">{ pin.field.messages()[0] ?? '' }</p>
      </div>
    </form>
  `),
})
class StyledPinInput {
  label = new Signal.State<Element | null>(null);
  group = new Signal.State<Element | null>(null);
  hidden = new Signal.State<Element | null>(null);
  hint = new Signal.State<Element | null>(null);
  error = new Signal.State<Element | null>(null);
  /** A signal, as `<v-pin-input>` holds its `disabled` prop, so the field can be taken out of use. */
  off = new Signal.State(false);
  pin = createPinInput({
    container: () => this.group.get(),
    hiddenInput: () => this.hidden.get(),
    label: () => this.label.get(),
    description: () => this.hint.get(),
    errorMessage: () => this.error.get(),
    disabled: () => this.off.get(),
  });
  boxes = Array.from({ length: this.pin.length() }, (_, i) => i);
}

export const scene: Scene = (look) => {
  const { pin } = show(StyledPinInput);
  // Empty: the caret on the first box, every box waiting.
  look();
  // Half a code, and then the whole of it, which the primitive marks on the
  // group and on every box.
  step(() => pin.setValue('24'));
  look();
  step(() => pin.setValue('246810'));
  look();
  // Refused, which is on every box rather than on the group.
  step(() => pin.field.setCustomValidity('That code is wrong.'));
  look();
  clear();

  // Out of use, which the field answers with no verdict at all — so it is a
  // pass of its own rather than a step after the refusal.
  const other = show(StyledPinInput);
  step(() => other.pin.setValue('24'));
  step(() => other.off.set(true));
  look();
};
