/**
 * `<v-input>`, driven the way a page drives it.
 *
 * The behaviour is `createInput`'s and `createFormField`'s, and is tested where
 * it lives. What is tested here is the shell: that what a caller writes on the
 * tag reaches the box rather than the layout around it, that the four parts are
 * really there and really tied to one another, that every state the sheet's
 * rules select on is written on the element those rules name, and that nothing
 * about the primitive is out of reach.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { VInput } from '../src/components/input.js';

compileComponents();

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = '';
});

function show<T>(component: new () => T): { instance: T; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mount(component, host);
  unmount = handle.unmount;
  flushSync();
  return { instance: handle.instance as T, host };
}

const field = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field')!;
const label = (host: HTMLElement): HTMLLabelElement => host.querySelector('label')!;
const box = (host: HTMLElement): HTMLInputElement => host.querySelector('input')!;
const hint = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-description')!;
const error = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-error')!;

/** An edit as the user makes it: the box first, then the event it fires. */
function type(el: HTMLInputElement, text: string): void {
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** Leaving the field. `blur` does not bubble, so it is sent where it lands. */
function leave(el: Element): void {
  el.dispatchEvent(new Event('blur'));
  flushSync();
}

/** A submit as a press on the button makes it, so it can be refused. */
function submit(form: HTMLFormElement): boolean {
  const event = new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  flushSync();
  return !event.defaultPrevented;
}

describe('v-input', () => {
  it('is a label, a box, a line of help and a message, tied to one another', () => {
    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(
        `<v-input class="mine" id="email" name="email" label="Email"
                  description="Only used to reply."></v-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // What the caller wrote lands on the box: it is the control, and the
    // `<div>` around it is layout nobody named.
    expect([...box(host).classList].sort()).toEqual(['mine', 'volt-field-control']);
    expect(field(host).classList.contains('mine')).toBe(false);

    // One id, used by both halves — the label's `for` is what makes a press on
    // the words put the caret in the box, which no amount of ARIA does.
    expect(box(host).id).toBe('email');
    expect(label(host).getAttribute('for')).toBe('email');
    expect(label(host).textContent).toBe('Email');
    expect(box(host).name).toBe('email');

    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(hint(host).textContent).toBe('Only used to reply.');
    // The standing explanation first and the news second, which is the order a
    // screen reader reads them in.
    expect(box(host).getAttribute('aria-describedby')).toBe(
      `${hint(host).id} ${error(host).id}`,
    );
  });

  it('keeps the message line on the page while there is no message', () => {
    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(`<v-input label="Email"></v-input>`),
    })
    class Page {}

    const { host } = show(Page);

    // A live region that arrives already holding its message is one nothing
    // was watching, and validation is reported when focus is on the submit
    // button rather than on the field.
    expect(error(host).getAttribute('role')).toBe('alert');
    expect(error(host).textContent).toBe('');
    expect(field(host).getAttribute('data-state')).toBe('valid');
    expect(box(host).hasAttribute('aria-invalid')).toBe(false);
  });

  it('lands everything else the caller wrote on the box as well', () => {
    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(
        `<v-input label="Email" title="Where the receipt goes"
                  lang="en" data-testid="email"></v-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    expect(box(host).getAttribute('title')).toBe('Where the receipt goes');
    expect(box(host).getAttribute('data-testid')).toBe('email');
    expect(box(host).getAttribute('lang')).toBe('en');
    expect(field(host).hasAttribute('title')).toBe(false);
    expect(field(host).hasAttribute('data-testid')).toBe(false);
  });

  it('forwards every option the primitive takes once', () => {
    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(
        `<v-input label="Card" type="tel" placeholder="0000 0000"
                  autoComplete="cc-number" inputMode="numeric"
                  :minLength="4" :maxLength="19" pattern="[0-9 ]+"></v-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    expect(box(host).getAttribute('type')).toBe('tel');
    expect(box(host).getAttribute('placeholder')).toBe('0000 0000');
    expect(box(host).getAttribute('autocomplete')).toBe('cc-number');
    expect(box(host).getAttribute('inputmode')).toBe('numeric');
    expect(box(host).getAttribute('minlength')).toBe('4');
    expect(box(host).getAttribute('maxlength')).toBe('19');
    expect(box(host).getAttribute('pattern')).toBe('[0-9 ]+');
  });

  it('writes every state the sheet’s rules select on', async () => {
    let answer: (message: string | undefined) => void = () => {};

    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(`
        <v-input label="Handle" validateOn="blur" :validate="check"
                 :disabled="off.get()" :readOnly="locked.get()"></v-input>
      `),
    })
    class Page {
      off = new Signal.State(false);
      locked = new Signal.State(false);
      check = (): Promise<string | undefined> =>
        new Promise<string | undefined>((resolve) => {
          answer = resolve;
        });
    }

    const { instance, host } = show(Page);
    const state = (): string | null => box(host).getAttribute('data-state');

    expect(state()).toBe('valid');

    // Waiting on an answer, and not yet wrong: drawn as attention rather than
    // as a fault, which is what the sheet's `pending` rule is for.
    type(box(host), 'ada');
    leave(box(host));
    expect(state()).toBe('pending');
    expect(box(host).getAttribute('aria-busy')).toBe('true');

    answer('That handle is taken.');
    await vi.waitUntil(() => state() === 'invalid');
    expect(box(host).getAttribute('aria-invalid')).toBe('true');
    expect(error(host).textContent).toBe('That handle is taken.');
    expect(field(host).getAttribute('data-state')).toBe('invalid');

    // Disabled is the platform's own attribute here, not `aria-disabled`
    // alone: the control *is* the native input, and only the attribute takes
    // it out of the form.
    instance.off.set(true);
    flushSync();
    expect(box(host).disabled).toBe(true);
    expect(box(host).getAttribute('aria-disabled')).toBe('true');

    instance.off.set(false);
    instance.locked.set(true);
    flushSync();
    expect(box(host).readOnly).toBe(true);
    expect(box(host).getAttribute('aria-readonly')).toBe('true');
  });

  it('follows a value bound to a signal, and reports every edit', () => {
    const seen: string[] = [];

    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(
        `<v-input label="Name" :value="name" :onValueChange="record"></v-input>`,
      ),
    })
    class Page {
      name = new Signal.State('Ada');
      record = (value: string): void => void seen.push(value);
    }

    const { instance, host } = show(Page);
    expect(box(host).value).toBe('Ada');
    expect(box(host).hasAttribute('data-empty')).toBe(false);

    // The box is the mirror: written from the signal, read back on `input`.
    instance.name.set('Grace');
    flushSync();
    expect(box(host).value).toBe('Grace');

    type(box(host), 'Grace H');
    expect(instance.name.get()).toBe('Grace H');
    expect(seen).toEqual(['Grace H']);

    type(box(host), '');
    expect(box(host).getAttribute('data-empty')).toBe('');
  });

  it('starts where it was told to, and goes back there on a reset', () => {
    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(`
        <form><v-input label="Name" name="name" defaultValue="Ada"></v-input></form>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    expect(box(host).value).toBe('Ada');
    expect(new FormData(form).get('name')).toBe('Ada');

    type(box(host), 'Grace');
    expect(box(host).value).toBe('Grace');

    form.reset();
    flushSync();
    // A reset restores the control's default and fires no `input`, so a field
    // that did not follow it would disagree with the box from then on.
    expect(box(host).value).toBe('Ada');
    expect(new FormData(form).get('name')).toBe('Ada');
  });

  it('validates when it was told to, and again when it was told to', () => {
    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(`
        <v-input label="Handle" validateOn="blur" revalidateOn="blur"
                 :validate="check"></v-input>
      `),
    })
    class Page {
      check = (value: string | null): string | undefined =>
        value === 'ada' ? undefined : 'Pick ada.';
    }

    const { host } = show(Page);
    const state = (): string | null => box(host).getAttribute('data-state');

    // Nothing is wrong before the trigger says so: a field that announces
    // itself invalid before anyone has typed is the commonest form bug there
    // is.
    type(box(host), 'grace');
    expect(state()).toBe('valid');

    leave(box(host));
    expect(state()).toBe('invalid');
    expect(error(host).textContent).toBe('Pick ada.');

    // `revalidateOn="blur"`, so the correction does not clear it until the
    // user leaves again.
    type(box(host), 'ada');
    expect(state()).toBe('invalid');

    leave(box(host));
    expect(state()).toBe('valid');
    expect(error(host).textContent).toBe('');
  });

  it('refuses the submit for the reason on screen, in the words it was given', () => {
    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(`
        <form>
          <v-input label="Email" name="email" required :labels="wording"></v-input>
        </form>
      `),
    })
    class Page {
      wording = { valueMissing: 'Tell us where to send the receipt.' };
    }

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    expect(box(host).required).toBe(true);
    expect(box(host).getAttribute('aria-required')).toBe('true');

    expect(submit(form)).toBe(false);
    expect(box(host).getAttribute('data-state')).toBe('invalid');
    expect(error(host).textContent).toBe('Tell us where to send the receipt.');

    // Typing is the default `revalidateOn`, so the message goes as it is
    // fixed rather than waiting for a second refusal.
    type(box(host), 'ada@example.com');
    expect(box(host).getAttribute('data-state')).toBe('valid');
    expect(submit(form)).toBe(true);
  });

  it('draws a label and a line of help written as markup', () => {
    @Component({
      selector: 'v-page2',
      imports: [VInput],
      render: compileTemplate(`
        <v-input>
          <template :slot-label>Email <abbr title="required">*</abbr></template>
          <template :slot-description>See the <a href="/privacy">privacy note</a>.</template>
        </v-input>
      `),
    })
    class Page2 {}

    const { host } = show(Page2);

    expect(label(host).querySelector('abbr')?.getAttribute('title')).toBe('required');
    expect(label(host).textContent).toContain('Email');
    expect(hint(host).querySelector('a')?.getAttribute('href')).toBe('/privacy');
    // Still the elements the field points at, whatever was written into them.
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(box(host).getAttribute('aria-describedby')).toContain(hint(host).id);
  });

  it('follows words that change', () => {
    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(
        `<v-input :label="words.get()" :description="help.get()"></v-input>`,
      ),
    })
    class Page {
      words = new Signal.State('Email');
      help = new Signal.State('Only used to reply.');
    }

    const { instance, host } = show(Page);
    expect(label(host).textContent).toBe('Email');

    instance.words.set('Work email');
    instance.help.set('Your company address.');
    flushSync();
    expect(label(host).textContent).toBe('Work email');
    expect(hint(host).textContent).toBe('Your company address.');
  });

  it('adds what the caller says about the control to what the field says', () => {
    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(`
        <span id="heading">Billing address</span>
        <span id="rules">Numbers and letters only.</span>
        <v-input label="Line 1" aria-labelledby="heading"
                 :aria-describedby="extra.get()"></v-input>
      `),
    })
    class Page {
      extra = new Signal.State('rules');
    }

    const { instance, host } = show(Page);

    // A name from elsewhere wins: naming the control from elsewhere is the
    // only reason to write it.
    expect(box(host).getAttribute('aria-labelledby')).toBe('heading');

    // A description is added, because the help and the message under the box
    // describe this control whatever else on the page also does.
    expect(box(host).getAttribute('aria-describedby')).toBe(
      `${hint(host).id} ${error(host).id} rules`,
    );

    instance.extra.set('');
    flushSync();
    expect(box(host).getAttribute('aria-describedby')).toBe(
      `${hint(host).id} ${error(host).id}`,
    );
  });

  it('lets a name the caller wrote be the name the box has', () => {
    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(
        `<v-input label="Email" aria-label="Email address"></v-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // `aria-labelledby` outranks `aria-label` wherever an accessible name is
    // computed, so a field that keeps pointing the first at its own label
    // leaves the second sitting on the element naming nothing. A plain
    // `<input>` beside a `<label for>` does the opposite — there the label is
    // the weaker of the two — and this is that input.
    expect(box(host).getAttribute('aria-label')).toBe('Email address');
    expect(box(host).hasAttribute('aria-labelledby')).toBe(false);

    // The words are still the label: the `for` is what makes a press on them
    // put the caret in the box, and standing a reference down is not giving
    // that up.
    expect(label(host).getAttribute('for')).toBe(box(host).id);
  });

  it('keeps both spellings when the caller wrote both', () => {
    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(`
        <span id="heading">Billing address</span>
        <v-input label="Line 1" aria-label="Street" aria-labelledby="heading"></v-input>
      `),
    })
    class Page {}

    const { host } = show(Page);

    // Both are the caller's, so both land and the platform's own order picks
    // between them. Nothing here is the field's to stand down.
    expect(box(host).getAttribute('aria-label')).toBe('Street');
    expect(box(host).getAttribute('aria-labelledby')).toBe('heading');
  });

  it('takes its own label back when the caller’s name goes away', () => {
    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(`<v-input label="Email" :aria-label="named.get()"></v-input>`),
    })
    class Page {
      named = new Signal.State<string | undefined>('Email address');
    }

    const { instance, host } = show(Page);
    expect(box(host).hasAttribute('aria-labelledby')).toBe(false);

    instance.named.set(undefined);
    flushSync();
    expect(box(host).hasAttribute('aria-label')).toBe(false);
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
  });

  it('treats a name that is nothing as no name at all', () => {
    @Component({
      selector: 'v-page',
      imports: [VInput],
      render: compileTemplate(`
        <span id="heading">Billing address</span>
        <v-input label="Line 1" :aria-labelledby="from.get()"
                 :aria-describedby="extra.get()"></v-input>
      `),
    })
    class Page {
      from = new Signal.State('');
      extra = new Signal.State('   ');
    }

    const { instance, host } = show(Page);

    // An id a caller has not chosen yet is an empty string, not an
    // instruction to name the box after nothing: pointing `aria-labelledby`
    // at no id at all cuts the box loose from its own label, which is the one
    // thing this prop exists to replace.
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(box(host).getAttribute('aria-describedby')).toBe(
      `${hint(host).id} ${error(host).id}`,
    );

    instance.from.set('heading');
    instance.extra.set('rules');
    flushSync();
    expect(box(host).getAttribute('aria-labelledby')).toBe('heading');
    expect(box(host).getAttribute('aria-describedby')).toBe(
      `${hint(host).id} ${error(host).id} rules`,
    );

    // And back: a name taken away gives the field's own label back rather
    // than leaving an empty attribute where a reference used to be.
    instance.from.set('  ');
    flushSync();
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page3',
      imports: [VInput],
      render: compileTemplate(
        `<v-input :ref="handle" label="Handle" :maxLength="8"></v-input>`,
      ),
    })
    class Page3 {
      handle: VInput | null = null;
    }

    const { instance, host } = show(Page3);
    expect(instance.handle?.input.isEmpty()).toBe(true);
    expect(instance.handle?.input.remaining()).toBe(8);

    instance.handle!.input.setValue('ada');
    flushSync();
    expect(box(host).value).toBe('ada');
    expect(instance.handle!.input.remaining()).toBe(5);

    instance.handle!.input.field.setCustomValidity('That one is reserved.');
    flushSync();
    expect(error(host).textContent).toBe('That one is reserved.');
    expect(box(host).getAttribute('data-state')).toBe('invalid');

    instance.handle!.input.clear();
    flushSync();
    expect(box(host).value).toBe('');
  });
});
