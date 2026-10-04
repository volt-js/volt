import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createPasswordInput } from '@voltdev/primitives';
import { show, step, type Scene } from '../scene.ts';

/**
 * `password-input.html`, with the toggle's `disabled` written from the same
 * flag the field's is, as the component writes it: the primitive has no
 * opinion about the toggle's, and the sheet selects on the attribute.
 */
@Component({
  selector: 'v-styled-password-input',
  render: compileTemplate(`
    <div class="volt-field" :spread="password.fieldProps()">
      <label class="volt-field-label" :ref="label" :spread="password.labelProps()">Password</label>
      <div class="volt-password-input">
        <input class="volt-field-control" :ref="control" :spread="password.inputProps()">
        <button class="volt-password-input-toggle" :disabled="off.get()"
                :spread="password.toggleProps()" :click="password.toggle()">{ words() }</button>
      </div>
      <p class="volt-field-description" :ref="hint" :spread="password.descriptionProps()">At least eight characters.</p>
      <p class="volt-field-error" :ref="error" :spread="password.errorMessageProps()">{ password.field.messages()[0] ?? '' }</p>
      <p class="volt-password-input-status" :spread="password.statusProps()">{ password.statusText() }</p>
    </div>
  `),
})
class StyledPasswordInput {
  label = new Signal.State<Element | null>(null);
  control = new Signal.State<Element | null>(null);
  hint = new Signal.State<Element | null>(null);
  error = new Signal.State<Element | null>(null);
  /** A signal, as `<v-password-input>` holds its `disabled` prop. */
  off = new Signal.State(false);
  /** And its `readOnly`, which the toggle does not follow. */
  locked = new Signal.State(false);

  password = createPasswordInput({
    input: () => this.control.get(),
    label: () => this.label.get(),
    description: () => this.hint.get(),
    errorMessage: () => this.error.get(),
    disabled: () => this.off.get(),
    readOnly: () => this.locked.get(),
  });

  words(): string {
    const name = this.password.toggleProps()['aria-label'];
    return typeof name === 'string' ? name : '';
  }
}

export const scene: Scene = (look) => {
  const { password, off, locked } = show(StyledPasswordInput);
  // Hidden, which is where every password field starts, and then shown.
  look();
  step(() => password.show());
  look();
  // Read-only leaves the toggle live, so the revealed rules still have one
  // to draw — and the pointer's with them.
  step(() => locked.set(true));
  look();
  step(() => locked.set(false));
  // Out of use in both states: the sheet draws the disabled look over
  // whichever one the toggle was left in.
  step(() => off.set(true));
  look();
  step(() => password.hide());
  look();
};
