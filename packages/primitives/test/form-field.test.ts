/**
 * Form field, driven through real mounted components.
 *
 * What is asserted is the wiring rather than the rendering: which ids point at
 * which elements and when they stop pointing, what the platform is told, and
 * when validation is allowed to speak. The cases here that usually go wrong —
 * a required field announcing itself invalid before anyone has touched it, a
 * dangling `aria-describedby` to an error that has been fixed and unmounted, a
 * `setCustomValidity` nobody clears so the form can never be submitted again, a
 * disabled field blocking a submit it is not even part of, and a slow async
 * validator overwriting the answer to a newer question.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, flushSync, mount } from '@voltdev/core';
import {
  createFormField,
  type FormFieldOptions,
  type ValidationOutcome,
  type ValidationResult,
} from '../src/form-field.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
});

/** Type as a user would: set the value, then say so. */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function blur(el: Element): void {
  el.dispatchEvent(new Event('blur'));
  flushSync();
}

/** Let queued microtasks — and any awaited validator — run, then settle the DOM. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

/**
 * Reset the form in the order a browser does, which this environment's own
 * `reset()` does not: the event first, then every microtask its listeners
 * queued — a press on a reset button runs them as each listener returns, with
 * nothing else on the stack to wait for — and only then the controls put back.
 */
async function browserReset(form: HTMLFormElement): Promise<void> {
  const event = new Event('reset', { bubbles: true, cancelable: true });
  if (!form.dispatchEvent(event)) return;
  await settle();

  // The environment's `reset()` puts the controls back and then dispatches an
  // event of its own, which is the one that has just been heard.
  const dispatch = form.dispatchEvent;
  form.dispatchEvent = () => true;
  try {
    form.reset();
  } finally {
    form.dispatchEvent = dispatch;
  }
  await settle();
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// A field with every part rendered
// ---------------------------------------------------------------------------

/** Options the test varies, read through accessors so they stay reactive. */
interface Knobs {
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  describe?: boolean;
}

let knobs: Signal.State<Knobs>;
let fieldOptions: Partial<FormFieldOptions>;

@Component({
  selector: 'v-signup',
  render: compileTemplate(`
    <form :ref="form">
      <div :ref="wrapper" :spread="field.fieldProps()">
        <label :ref="label" :spread="field.labelProps()">Email</label>
        <input type="email" name="email" :ref="control" :spread="field.controlProps()">
        <p :if="describe()" :ref="hint" :spread="field.descriptionProps()">Only used to reply.</p>
        <p :if="field.isInvalid()" :ref="error" :spread="field.errorMessageProps()">{ message() }</p>
      </div>
      <button type="submit">Save</button>
    </form>
  `),
})
class Signup {
  form = new Signal.State<Element | null>(null);
  wrapper = new Signal.State<Element | null>(null);
  control = new Signal.State<Element | null>(null);
  label = new Signal.State<Element | null>(null);
  hint = new Signal.State<Element | null>(null);
  error = new Signal.State<Element | null>(null);

  field = createFormField({
    control: () => this.control.get(),
    label: () => this.label.get(),
    description: () => this.hint.get(),
    errorMessage: () => this.error.get(),
    required: () => knobs.get().required ?? false,
    disabled: () => knobs.get().disabled ?? false,
    readOnly: () => knobs.get().readOnly ?? false,
    ...fieldOptions,
  });

  describe(): boolean {
    return knobs.get().describe !== false;
  }

  message(): string {
    return this.field.messages()[0] ?? '';
  }
}

function signup(initial: Knobs = {}, options: Partial<FormFieldOptions> = {}) {
  knobs = new Signal.State<Knobs>(initial);
  fieldOptions = options;

  const handle = track(mount(Signup, host));
  flushSync();
  const instance = handle.instance as Signup;

  return {
    instance,
    field: instance.field,
    set: (next: Knobs) => {
      knobs.set({ ...knobs.get(), ...next });
      flushSync();
    },
    form: () => host.querySelector('form') as HTMLFormElement,
    wrapper: () => host.querySelector('div') as HTMLElement,
    label: () => host.querySelector('label') as HTMLLabelElement,
    input: () => host.querySelector('input') as HTMLInputElement,
    hint: () => host.querySelector('p[id]:not([role])') as HTMLElement | null,
    error: () => host.querySelector('[role="alert"]') as HTMLElement | null,
  };
}

/**
 * Submit the way a user does. `requestSubmit` runs the platform's own
 * validation first, so an invalid field never reaches the submit event at all
 * — which is exactly the path being tested.
 */
function submit(form: HTMLFormElement): { submitted: boolean; prevented: boolean } {
  let submitted = false;
  let prevented = false;
  const listener = (event: Event) => {
    submitted = true;
    prevented = event.defaultPrevented;
    // Stop happy-dom trying to navigate.
    event.preventDefault();
  };
  form.addEventListener('submit', listener);
  form.requestSubmit();
  form.removeEventListener('submit', listener);
  flushSync();
  return { submitted, prevented };
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe('what the parts are told about each other', () => {
  it('links the label both ways, so a press on the words reaches the control', () => {
    const { input, label, field } = signup();

    expect(label().getAttribute('for')).toBe(input().id);
    expect(input().getAttribute('aria-labelledby')).toBe(label().id);
    expect(field.ids().control).toBe(input().id);
  });

  it('describes the control with the description alone while it is valid', () => {
    const { input, hint } = signup();
    expect(input().getAttribute('aria-describedby')).toBe(hint()!.id);
  });

  it('adds the error message to the description once there is one, in reading order', () => {
    const { input, hint, error, form } = signup({ required: true });
    submit(form());

    expect(error()).not.toBeNull();
    // The standing explanation first, the news second.
    expect(input().getAttribute('aria-describedby')).toBe(`${hint()!.id} ${error()!.id}`);
  });

  it('drops the error from aria-describedby when it is fixed and unmounted', () => {
    const { input, hint, error, form } = signup({ required: true });
    submit(form());
    expect(error()).not.toBeNull();

    type(input(), 'someone@example.com');

    expect(error()).toBeNull();
    expect(input().getAttribute('aria-describedby')).toBe(hint()!.id);
  });

  it('omits aria-describedby entirely when nothing describes it', () => {
    const { input } = signup({ describe: false });
    expect(input().hasAttribute('aria-describedby')).toBe(false);
  });

  it('never points at an id no element carries', () => {
    // The description is rendered but the spread was forgotten, so it has no
    // id. A reference to the id it was offered would announce nothing while
    // hiding the mistake from every audit that only checks the attribute.
    @Component({
      selector: 'v-forgot',
      render: compileTemplate(
        `<div><input :ref="control" :spread="field.controlProps()">` +
          `<p :ref="hint">Only used to reply.</p></div>`,
      ),
    })
    class Forgot {
      control = new Signal.State<Element | null>(null);
      hint = new Signal.State<Element | null>(null);
      field = createFormField({
        control: () => this.control.get(),
        description: () => this.hint.get(),
      });
    }

    track(mount(Forgot, host));
    flushSync();

    expect(host.querySelector('input')!.hasAttribute('aria-describedby')).toBe(false);
  });

  it('omits aria-labelledby when nothing labels it', () => {
    @Component({
      selector: 'v-unlabelled',
      render: compileTemplate(`<div><input :ref="control" :spread="field.controlProps()"></div>`),
    })
    class Unlabelled {
      control = new Signal.State<Element | null>(null);
      field = createFormField({ control: () => this.control.get() });
    }

    track(mount(Unlabelled, host));
    flushSync();

    expect(host.querySelector('input')!.hasAttribute('aria-labelledby')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// State that is only claimed once it is true
// ---------------------------------------------------------------------------

describe('aria-invalid', () => {
  it('is absent on a required field nobody has touched', () => {
    const { input, field } = signup({ required: true });

    // The field is empty and required, so it would fail if asked — but nobody
    // has asked, and announcing every fresh form as wrong is the most common
    // form bug there is.
    expect(field.state()).toBe('valid');
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('is still absent after typing, because the default trigger is submit', () => {
    const { input } = signup({ required: true });
    type(input(), 'not-an-email');

    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('appears once a submit has been attempted', () => {
    const { input, form } = signup({ required: true });
    submit(form());

    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  it('goes away again as the value is corrected', () => {
    const { input, form } = signup({ required: true });
    submit(form());

    // Once it has reported, it re-reports on every keystroke: an error the
    // user is in the middle of fixing should disappear as they fix it.
    type(input(), 'still-wrong');
    expect(input().getAttribute('aria-invalid')).toBe('true');

    type(input(), 'someone@example.com');
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('required, disabled and readonly', () => {
  it('says required in ARIA and writes it through to the platform', () => {
    const { input } = signup({ required: true });

    expect(input().getAttribute('aria-required')).toBe('true');
    // Without the property the browser would never refuse the submit, and the
    // field would be the only thing that thought the value mattered.
    expect(input().required).toBe(true);
  });

  it('leaves a required attribute the consumer wrote alone', () => {
    @Component({
      selector: 'v-own-required',
      render: compileTemplate(
        `<div><input required :ref="control" :spread="field.controlProps()"></div>`,
      ),
    })
    class OwnRequired {
      control = new Signal.State<Element | null>(null);
      field = createFormField({ control: () => this.control.get() });
    }

    track(mount(OwnRequired, host));
    flushSync();

    // No `required` option was given, so the field does not claim to own it —
    // and must not quietly switch it off.
    expect(host.querySelector('input')!.required).toBe(true);
  });

  it('propagates disabled to the control and to ARIA', () => {
    const { input, set } = signup();
    expect(input().disabled).toBe(false);

    set({ disabled: true });
    expect(input().disabled).toBe(true);
    expect(input().getAttribute('aria-disabled')).toBe('true');
  });

  it('propagates readonly to the control and to ARIA', () => {
    const { input, set } = signup();
    set({ readOnly: true });

    expect(input().readOnly).toBe(true);
    expect(input().getAttribute('aria-readonly')).toBe('true');
  });

  it('never validates a disabled field, so it cannot block a submit', () => {
    const { field, form, input } = signup({ required: true, disabled: true });

    // A disabled control is not part of the form. An error against it is one
    // nobody can act on, and it would stop a form the user has finished.
    expect(field.report()).toBe(true);
    expect(field.state()).toBe('valid');
    expect(submit(form()).submitted).toBe(true);
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('never validates a readonly field', () => {
    const { field } = signup({ required: true, readOnly: true });

    expect(field.report()).toBe(true);
    expect(field.state()).toBe('valid');
  });
});

// ---------------------------------------------------------------------------
// Constraint validation
// ---------------------------------------------------------------------------

describe('the platform half', () => {
  it('reports on submit rather than on every keystroke', () => {
    const { field, input, form } = signup({ required: true });

    type(input(), '');
    expect(field.state()).toBe('valid');

    submit(form());
    expect(field.state()).toBe('invalid');
    expect(field.messages()).toEqual(['Fill in this field.']);
  });

  it('takes the message from the failing constraint, not from the first one', () => {
    const { field, input, form } = signup();
    type(input(), 'definitely not an email');
    submit(form());

    expect(field.messages()).toEqual(['This value is not in the expected format.']);
  });

  it('lets every message be overridden through labels', () => {
    const { field, form } = signup({ required: true }, { labels: { valueMissing: 'Enter your email.' } });
    submit(form());

    expect(field.messages()).toEqual(['Enter your email.']);
  });

  it('cancels the platform’s own bubble, since the message is rendered instead', () => {
    const { input } = signup({ required: true });

    const event = new Event('invalid', { bubbles: true, cancelable: true });
    input().dispatchEvent(event);
    flushSync();

    // Left alone the browser draws its own tooltip over markup the consumer
    // styled, next to the message this field just rendered.
    expect(event.defaultPrevented).toBe(true);
  });

  it('surfaces the messages from a submit the platform refused', () => {
    const { field, form, error } = signup({ required: true });

    // `requestSubmit` validates first, so an invalid field never reaches the
    // submit event — the `invalid` event is the only notice the field gets.
    const result = submit(form());

    expect(result.submitted).toBe(false);
    expect(field.state()).toBe('invalid');
    expect(error()!.textContent).toBe('Fill in this field.');
  });

  it('blocks a novalidate form itself, since the platform has stood down', () => {
    const { field, form } = signup({ required: true });
    form().noValidate = true;

    const result = submit(form());

    expect(result.submitted).toBe(true);
    expect(result.prevented).toBe(true);
    expect(field.state()).toBe('invalid');
  });

  it('lets a valid field through', () => {
    const { input, form } = signup({ required: true });
    type(input(), 'someone@example.com');

    expect(submit(form()).submitted).toBe(true);
  });

  it('keeps the platform’s own wording for a constraint while a custom message is set', () => {
    // A control that words its constraints itself, as a browser does for every
    // native one in the user's language — the part of a browser this test
    // environment leaves out. It has the platform's single message slot: once
    // a custom message is set, `validationMessage` is that message.
    class Picker extends HTMLElement {
      value = '';
      #custom = '';
      get willValidate(): boolean {
        return true;
      }
      get validity(): ValidityState {
        const valueMissing = this.value === '';
        const customError = this.#custom !== '';
        return { valueMissing, customError, valid: !valueMissing && !customError } as ValidityState;
      }
      get validationMessage(): string {
        return this.#custom || (this.value === '' ? 'Choisissez une couleur.' : '');
      }
      setCustomValidity(message: string): void {
        this.#custom = message;
      }
    }
    customElements.define('v-wording-picker', Picker);
    const picker = document.createElement('v-wording-picker');
    host.append(picker);

    createRoot((dispose) => {
      mounted.push({ unmount: dispose });
      const field = createFormField({ control: () => picker });
      flushSync();
      field.setCustomValidity('Cette couleur est prise.');
      flushSync();

      expect(field.messages()).toEqual(['Choisissez une couleur.', 'Cette couleur est prise.']);
      expect(picker.validationMessage).toBe('Cette couleur est prise.');

      // And again with the custom message already in the slot, which is how
      // every evaluation after the first finds the control.
      field.report();
      flushSync();
      expect(field.messages()).toEqual(['Choisissez une couleur.', 'Cette couleur est prise.']);
      expect(picker.validationMessage).toBe('Cette couleur est prise.');
    });
  });
});

describe('setCustomValidity', () => {
  it('shows the message and makes the platform refuse the submit', () => {
    const { field, input, form } = signup();
    type(input(), 'someone@example.com');

    field.setCustomValidity('That address is already registered.');
    flushSync();

    expect(field.state()).toBe('invalid');
    expect(field.messages()).toEqual(['That address is already registered.']);
    expect(input().validity.customError).toBe(true);
    // Two sources of truth would diverge immediately; there is only one.
    expect(form().checkValidity()).toBe(false);
  });

  it('clears itself on the next edit, so the field can be fixed', () => {
    const { field, input, form } = signup();
    type(input(), 'someone@example.com');
    field.setCustomValidity('That address is already registered.');
    flushSync();

    // A verdict on a value that no longer exists. Left in place it survives
    // every correction the user makes, and the form can never be submitted.
    type(input(), 'someone.else@example.com');

    expect(field.state()).toBe('valid');
    expect(input().validity.customError).toBe(false);
    expect(form().checkValidity()).toBe(true);
  });

  it('is cleared by an empty string', () => {
    const { field, input } = signup();
    type(input(), 'someone@example.com');
    field.setCustomValidity('Taken.');
    flushSync();

    field.setCustomValidity('');
    flushSync();

    expect(field.state()).toBe('valid');
    expect(input().validity.customError).toBe(false);
  });

  it('says nothing about an untouched field when a message it never had is cleared', () => {
    const { field, input, error } = signup({ required: true });

    // What an effect that mirrors a server's verdict does on its first run.
    // Clearing is not a request to judge the field, and judging it here would
    // put the required message on screen before anyone had typed.
    field.setCustomValidity('');
    flushSync();

    expect(field.state()).toBe('valid');
    expect(input().hasAttribute('aria-invalid')).toBe(false);
    expect(error()).toBeNull();
  });

  it('stops refusing the submit at the next edit, whenever the screen catches up', () => {
    const { field, input, form } = signup({}, { revalidateOn: 'blur' });
    type(input(), 'someone@example.com');
    field.setCustomValidity('Taken.');
    flushSync();

    type(input(), 'someone.else@example.com');
    // The message waits for the blur, as asked; the platform does not, or a
    // submit made before the blur is refused on a verdict about a value that
    // is no longer there, with nothing on screen to say why.
    expect(input().validity.customError).toBe(false);

    const result = submit(form());
    expect(result.submitted).toBe(true);
    expect(result.prevented).toBe(false);
    expect(field.state()).toBe('valid');
  });
});

// ---------------------------------------------------------------------------
// Custom validation
// ---------------------------------------------------------------------------

describe('a validator of the consumer’s own', () => {
  it('runs alongside the platform and reaches the platform', async () => {
    const { field, input, form } = signup(
      {},
      { validate: (value) => (value === 'taken@example.com' ? 'Already registered.' : null) },
    );
    type(input(), 'taken@example.com');

    await field.validate();
    flushSync();

    expect(field.messages()).toEqual(['Already registered.']);
    // Pushed into the control, so the browser refuses the submit for exactly
    // the reason the field shows a message.
    expect(form().checkValidity()).toBe(false);
  });

  it('reports both its message and the platform’s', async () => {
    const { field, input } = signup(
      {},
      { validate: () => 'This domain is not allowed.', labels: { typeMismatch: 'Not an email.' } },
    );
    type(input(), 'nonsense');

    await field.validate();
    flushSync();

    expect(field.messages()).toEqual(['Not an email.', 'This domain is not allowed.']);
  });

  it('goes pending while an async answer is outstanding, and says so', async () => {
    const gate = deferred<ValidationOutcome>();
    const { field, input } = signup({}, { validate: () => gate.promise });
    type(input(), 'someone@example.com');

    const running = field.validate();
    flushSync();

    expect(field.state()).toBe('pending');
    expect(input().getAttribute('aria-busy')).toBe('true');
    // Nobody has finished checking, so it cannot be called valid yet.
    expect(field.report()).toBe(false);

    gate.resolve('Already registered.');
    await running;
    await settle();

    expect(field.state()).toBe('invalid');
    expect(input().hasAttribute('aria-busy')).toBe(false);
    expect(field.messages()).toEqual(['Already registered.']);
  });

  it('ignores a slow answer to a question that has been superseded', async () => {
    const gates = [deferred<ValidationOutcome>(), deferred<ValidationOutcome>()];
    let call = 0;
    const { field, input } = signup({}, { validate: () => gates[call++]!.promise });
    type(input(), 'someone@example.com');

    const first = field.validate();
    const second = field.validate();

    // The stale answer arrives last and must not win: the value it judged is
    // two edits old.
    gates[1]!.resolve(null);
    gates[0]!.resolve('Already registered.');
    await Promise.all([first, second]);
    await settle();

    expect(field.messages()).toEqual([]);
    expect(field.state()).toBe('valid');
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('treats a validator that threw as a failure, not as approval', async () => {
    const { field } = signup(
      {},
      {
        validate: () => Promise.reject(new Error('network')),
        labels: { validationFailed: 'We could not check that just now.' },
      },
    );

    await field.validate();
    await settle();

    expect(field.state()).toBe('invalid');
    expect(field.messages()).toEqual(['We could not check that just now.']);
  });

  it('is not run for a disabled field', async () => {
    const validate = vi.fn(() => 'no');
    const { field } = signup({ disabled: true }, { validate });

    await field.validate();

    expect(validate).not.toHaveBeenCalled();
    expect(field.state()).toBe('valid');
  });

  it('does not refuse a submit on its verdict about a value that has since changed', () => {
    const { field, input, form } = signup(
      {},
      {
        revalidateOn: 'submit',
        validate: (value) => (value === 'taken@example.com' ? 'Already registered.' : null),
      },
    );
    type(input(), 'taken@example.com');
    submit(form());
    expect(field.messages()).toEqual(['Already registered.']);

    type(input(), 'free@example.com');
    // Re-checked by the submit itself — which the platform must let happen,
    // rather than refuse on the old verdict before the submit event can fire.
    const result = submit(form());

    expect(result.submitted).toBe(true);
    expect(result.prevented).toBe(false);
    expect(field.state()).toBe('valid');
  });
});

describe('an async validator and a native submit', () => {
  it('lets the submit through once the validator has passed the value', async () => {
    const validate = vi.fn(() => Promise.resolve<ValidationOutcome>(null));
    const { field, input, form } = signup({}, { validate });
    type(input(), 'someone@example.com');
    await field.validate();
    await settle();
    expect(field.state()).toBe('valid');

    const result = submit(form());

    expect(result.submitted).toBe(true);
    expect(result.prevented).toBe(false);
    // The answer about this value is in. Asking again would put the field back
    // to pending, and a pending field is one no submit can get past.
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('makes the submit it had to refuse once the check that refused it passes', async () => {
    const gate = deferred<ValidationOutcome>();
    const { field, input, form } = signup({}, { validate: () => gate.promise });
    type(input(), 'someone@example.com');

    const seen: boolean[] = [];
    form().addEventListener('submit', (event) => {
      seen.push(event.defaultPrevented);
      event.preventDefault();
    });
    form().requestSubmit();
    flushSync();
    expect(seen).toEqual([true]);
    expect(field.state()).toBe('pending');

    gate.resolve(null);
    await settle();

    expect(seen).toEqual([true, false]);
    expect(field.state()).toBe('valid');
  });

  it('keeps refusing, and says why, when the check fails', async () => {
    const gate = deferred<ValidationOutcome>();
    const { field, input, form } = signup({}, { validate: () => gate.promise });
    type(input(), 'taken@example.com');

    const seen: boolean[] = [];
    form().addEventListener('submit', (event) => {
      seen.push(event.defaultPrevented);
      event.preventDefault();
    });
    form().requestSubmit();
    gate.resolve('Already registered.');
    await settle();

    expect(seen).toEqual([true]);
    expect(field.messages()).toEqual(['Already registered.']);
    // The verdict stands until the value changes, so the next submit is
    // refused on it rather than asking the server the same question again.
    expect(submit(form()).submitted).toBe(false);
  });

  it('does not submit on an answer about a value that has since been edited', async () => {
    const gates = [deferred<ValidationOutcome>(), deferred<ValidationOutcome>()];
    let call = 0;
    const { input, form } = signup({}, { validate: () => gates[call++]!.promise });
    type(input(), 'someone@example.com');

    const seen: boolean[] = [];
    form().addEventListener('submit', (event) => {
      seen.push(event.defaultPrevented);
      event.preventDefault();
    });
    form().requestSubmit();
    flushSync();
    // The submit was for the value that was there when it was made.
    type(input(), 'someone.else@example.com');

    gates[0]!.resolve(null);
    gates[1]!.resolve(null);
    await settle();

    expect(seen).toEqual([true]);
  });

  it('drops an answer that lands after the edit, when nothing asks again until the submit', async () => {
    const gates = [deferred<ValidationOutcome>(), deferred<ValidationOutcome>()];
    let call = 0;
    const { field, input, form } = signup(
      {},
      { revalidateOn: 'submit', validate: () => gates[call++]!.promise },
    );
    type(input(), 'taken@example.com');
    expect(submit(form()).prevented).toBe(true);
    expect(field.state()).toBe('pending');

    // The edit asks nothing — that waits for the submit — so the answer still
    // on its way is the only thing that could land, and it is about the old
    // value.
    type(input(), 'free@example.com');
    expect(field.state()).toBe('valid');
    expect(input().hasAttribute('aria-busy')).toBe(false);

    gates[0]!.resolve('Already registered.');
    await settle();

    expect(field.messages()).toEqual([]);
    expect(input().validity.customError).toBe(false);

    // So the next submit reaches the field, which asks about the value that
    // is there now, and goes when that answer says yes.
    const seen: boolean[] = [];
    form().addEventListener('submit', (event) => {
      seen.push(event.defaultPrevented);
      event.preventDefault();
    });
    form().requestSubmit();
    flushSync();
    expect(call).toBe(2);

    gates[1]!.resolve(null);
    await settle();

    expect(seen).toEqual([true, false]);
  });

  it('asks again at the next submit when the validator could not be reached', async () => {
    let call = 0;
    const validate = vi.fn(() =>
      call++ === 0
        ? Promise.reject<ValidationOutcome>(new Error('network'))
        : Promise.resolve<ValidationOutcome>(null),
    );
    const { field, input, form } = signup({}, { validate });
    type(input(), 'someone@example.com');

    const seen: boolean[] = [];
    form().addEventListener('submit', (event) => {
      seen.push(event.defaultPrevented);
      event.preventDefault();
    });
    form().requestSubmit();
    await settle();

    // Nobody has passed the value, so it is not let through — and says why.
    expect(seen).toEqual([true]);
    expect(field.messages()).toEqual(['This value could not be checked.']);
    // But no answer is not an answer about the value. Held in the platform, it
    // would refuse the next submit before the field heard it, and the check
    // could never be tried again without changing what was typed.
    expect(input().validity.customError).toBe(false);

    form().requestSubmit();
    await settle();

    expect(validate).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([true, true, false]);
    expect(field.state()).toBe('valid');
  });
});

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

describe('when validation is allowed to speak', () => {
  it('waits for blur when asked to', () => {
    const { field, input } = signup({ required: true }, { validateOn: 'blur' });

    type(input(), '');
    expect(field.state()).toBe('valid');

    blur(input());
    expect(field.state()).toBe('invalid');
  });

  it('speaks on the first keystroke when asked to', () => {
    const { field, input } = signup({ required: true }, { validateOn: 'input' });

    type(input(), 'x');
    type(input(), '');
    expect(field.state()).toBe('invalid');
  });

  it('holds its peace until submit even after a blur, by default', () => {
    const { field, input } = signup({ required: true });

    blur(input());
    expect(field.isTouched()).toBe(true);
    expect(field.state()).toBe('valid');
  });

  it('re-checks on blur rather than on input when told to', () => {
    const { field, input, form } = signup({ required: true }, { revalidateOn: 'blur' });
    submit(form());
    expect(field.state()).toBe('invalid');

    type(input(), 'someone@example.com');
    expect(field.state()).toBe('invalid');

    blur(input());
    expect(field.state()).toBe('valid');
  });
});

// ---------------------------------------------------------------------------
// Dirty and touched
// ---------------------------------------------------------------------------

describe('dirty and touched', () => {
  it('starts as neither', () => {
    const { field, wrapper } = signup();

    expect(field.isDirty()).toBe(false);
    expect(field.isTouched()).toBe(false);
    expect(wrapper().hasAttribute('data-dirty')).toBe(false);
    expect(wrapper().hasAttribute('data-touched')).toBe(false);
  });

  it('is dirty against the value a reset would restore, not against having been typed in', () => {
    const { field, input, wrapper } = signup();

    type(input(), 'a');
    expect(field.isDirty()).toBe(true);
    expect(wrapper().getAttribute('data-dirty')).toBe('');

    // Typed back to where it started, so a reset would change nothing.
    type(input(), '');
    expect(field.isDirty()).toBe(false);
  });

  it('measures a checkbox against defaultChecked, not against its value', () => {
    @Component({
      selector: 'v-terms',
      render: compileTemplate(
        `<div><input type="checkbox" checked :ref="control" :spread="field.controlProps()"></div>`,
      ),
    })
    class Terms {
      control = new Signal.State<Element | null>(null);
      field = createFormField({ control: () => this.control.get() });
    }

    const handle = track(mount(Terms, host));
    flushSync();
    const field = (handle.instance as Terms).field;
    const box = host.querySelector('input') as HTMLInputElement;

    expect(field.value()).toBe('true');
    expect(field.isDirty()).toBe(false);

    box.checked = false;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    expect(field.isDirty()).toBe(true);
  });

  it('is touched only once the control has been left', () => {
    const { field, input, wrapper } = signup();

    type(input(), 'a');
    expect(field.isTouched()).toBe(false);

    blur(input());
    expect(field.isTouched()).toBe(true);
    expect(wrapper().getAttribute('data-touched')).toBe('');
  });
});

describe('reset', () => {
  it('follows the form back to pristine', async () => {
    const { field, input, form } = signup({ required: true });
    submit(form());
    type(input(), 'a');
    blur(input());
    expect(field.isDirty()).toBe(true);
    expect(field.isTouched()).toBe(true);

    // As a script resets it. This environment puts the controls back before it
    // dispatches the event; a browser's order is the next test.
    form().reset();
    await settle();

    expect(input().value).toBe('');
    expect(field.isDirty()).toBe(false);
    expect(field.isTouched()).toBe(false);
    expect(field.state()).toBe('valid');
  });

  it('is pristine after a reset button is pressed, when the event comes before the value', async () => {
    const { field, input, form } = signup({ required: true });
    submit(form());
    type(input(), 'a');
    expect(field.isDirty()).toBe(true);

    await browserReset(form());

    // Nothing is fired once the platform has put the value back, so there is
    // no later moment to read it at: the field has to know where it is going.
    expect(input().value).toBe('');
    expect(field.value()).toBe('');
    expect(field.isDirty()).toBe(false);
    expect(field.state()).toBe('valid');
  });

  it('leaves everything alone when the reset is cancelled', async () => {
    const { field, input, form } = signup({ required: true });
    type(input(), 'a');
    blur(input());
    form().addEventListener('reset', (event) => event.preventDefault(), true);

    await browserReset(form());

    expect(input().value).toBe('a');
    expect(field.isDirty()).toBe(true);
    expect(field.isTouched()).toBe(true);
  });

  it('clears a custom message from the control as well as from the field', () => {
    const { field, input, form } = signup();
    type(input(), 'someone@example.com');
    field.setCustomValidity('Taken.');
    flushSync();

    field.reset();
    flushSync();

    expect(field.state()).toBe('valid');
    expect(input().validity.customError).toBe(false);
    expect(form().checkValidity()).toBe(true);
  });

  it('puts the field back to waiting for a submit', () => {
    const { field, input, form } = signup({ required: true });
    submit(form());
    field.reset();
    flushSync();

    // It had reported once, so it was re-checking on every keystroke. After a
    // reset it is a fresh field again.
    type(input(), '');
    expect(field.state()).toBe('valid');
  });
});

// ---------------------------------------------------------------------------
// Controlled from outside
// ---------------------------------------------------------------------------

describe('driven from outside', () => {
  it('takes its state from a supplied signal', () => {
    const validity = new Signal.State<ValidationResult>({ state: 'valid', messages: [] });
    const { field, input, error } = signup({}, { validity });

    validity.set({ state: 'invalid', messages: ['That address is already registered.'] });
    flushSync();

    expect(field.state()).toBe('invalid');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(error()!.textContent).toBe('That address is already registered.');
  });

  it('reports a change once, not once per evaluation', () => {
    const onValidityChange = vi.fn();
    const { form } = signup({ required: true }, { onValidityChange });

    submit(form());
    submit(form());

    expect(onValidityChange).toHaveBeenCalledTimes(1);
    expect(onValidityChange).toHaveBeenCalledWith({
      state: 'invalid',
      messages: ['Fill in this field.'],
    });
  });
});

// ---------------------------------------------------------------------------
// Controls the platform knows nothing about
// ---------------------------------------------------------------------------

describe('a control that is not a native one', () => {
  @Component({
    selector: 'v-custom',
    render: compileTemplate(`
      <div>
        <span :ref="label" :spread="field.labelProps()">Colour</span>
        <div role="textbox" tabindex="0" :ref="control" :spread="field.controlProps()"></div>
        <p :if="field.isInvalid()" :ref="error" :spread="field.errorMessageProps()">{ message() }</p>
      </div>
    `),
  })
  class Custom {
    control = new Signal.State<Element | null>(null);
    label = new Signal.State<Element | null>(null);
    error = new Signal.State<Element | null>(null);

    field = createFormField({
      control: () => this.control.get(),
      label: () => this.label.get(),
      errorMessage: () => this.error.get(),
      required: () => true,
      validate: () => 'Choose a colour.',
    });

    message(): string {
      return this.field.messages()[0] ?? '';
    }
  }

  function custom() {
    const handle = track(mount(Custom, host));
    flushSync();
    return {
      field: (handle.instance as Custom).field,
      control: () => host.querySelector('[role="textbox"]') as HTMLElement,
    };
  }

  it('still gets the ids, the ARIA and the state', async () => {
    const { field, control } = custom();

    expect(control().getAttribute('aria-labelledby')).toBe(host.querySelector('span')!.id);
    expect(control().getAttribute('aria-required')).toBe('true');
    // Nothing to write `required` to, and no meaningless attribute invented
    // to pretend otherwise.
    expect(control().hasAttribute('required')).toBe(false);

    await field.validate();
    flushSync();

    expect(field.messages()).toEqual(['Choose a colour.']);
    expect(control().getAttribute('aria-invalid')).toBe('true');
    expect(control().getAttribute('aria-describedby')).toBe(
      host.querySelector('[role="alert"]')!.id,
    );
  });

  it('records edits and visits it cannot hear for itself', () => {
    const { field } = custom();

    expect(field.isDirty()).toBe(false);
    field.markEdited();
    field.markTouched();

    expect(field.isTouched()).toBe(true);
    // A widget with no value of its own: the field says what it honestly
    // knows, which is nothing, rather than inventing a difference.
    expect(field.value()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The error message element
// ---------------------------------------------------------------------------

describe('the error message', () => {
  it('is a live region, because on submit focus is on the button', () => {
    const { form, error } = signup({ required: true });
    submit(form());

    // Without this the user is told nothing at all: they are on the submit
    // button, and `aria-describedby` only speaks when the control is reached.
    expect(error()!.getAttribute('role')).toBe('alert');
  });

  it('carries the state for CSS on every part', () => {
    const { form, wrapper, input, error } = signup({ required: true });
    submit(form());

    expect(wrapper().getAttribute('data-state')).toBe('invalid');
    expect(input().getAttribute('data-state')).toBe('invalid');
    expect(error()!.getAttribute('data-state')).toBe('invalid');
  });
});
