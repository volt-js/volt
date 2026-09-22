/**
 * `<v-textarea>`, driven the way a page drives it.
 *
 * The behaviour is `createTextarea`'s and `createFormField`'s, and is tested
 * where it lives. What is tested here is the shell: that what a caller writes
 * on the tag reaches the box rather than the layout around it, that the four
 * parts are really there and really tied to one another, that every state the
 * sheet's rules select on is written on the element those rules name, that the
 * box opens and grows the way it was told to, and that nothing about the
 * primitive is out of reach.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { VTextarea } from '../src/components/textarea.js';

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
const box = (host: HTMLElement): HTMLTextAreaElement => host.querySelector('textarea')!;
const hint = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-description')!;
const error = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-error')!;

/** An edit as the user makes it: the box first, then the event it fires. */
function type(el: HTMLTextAreaElement, text: string): void {
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** Leaving the field. `blur` does not bubble, so it is sent where it lands. */
function leave(el: Element): void {
  el.dispatchEvent(new Event('blur'));
  flushSync();
}

/** A keydown as the user sends it: bubbling, and cancellable. */
function press(el: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

/** A submit as a press on the button makes it, so it can be refused. */
function submit(form: HTMLFormElement): boolean {
  const event = new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  flushSync();
  return !event.defaultPrevented;
}

describe('v-textarea', () => {
  it('is a label, a box, a line of help and a message, tied to one another', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(
        `<v-textarea class="mine" id="bio" name="bio" label="About you"
                     description="A sentence or two."></v-textarea>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    expect(box(host).tagName).toBe('TEXTAREA');
    // What the caller wrote lands on the box: it is the control, and the
    // `<div>` around it is layout nobody named.
    expect([...box(host).classList].sort()).toEqual(['mine', 'volt-field-control']);
    expect(field(host).classList.contains('mine')).toBe(false);
    expect(field(host).classList.contains('volt-field')).toBe(true);
    expect(field(host).hasAttribute('id')).toBe(false);
    expect(label(host).className).toBe('volt-field-label');
    expect(hint(host).className).toBe('volt-field-description');

    // One id, used by both halves — the label's `for` is what makes a press on
    // the words put the caret in the box, which no amount of ARIA does.
    expect(box(host).id).toBe('bio');
    expect(label(host).getAttribute('for')).toBe('bio');
    expect(label(host).textContent).toBe('About you');
    expect(box(host).name).toBe('bio');

    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(hint(host).textContent).toBe('A sentence or two.');
    // The standing explanation first and the news second, which is the order a
    // screen reader reads them in.
    expect(box(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id}`);
  });

  it('keeps the message line on the page while there is no message', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`<v-textarea label="About you"></v-textarea>`),
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
      imports: [VTextarea],
      render: compileTemplate(
        `<v-textarea label="Notes" title="Anything you want us to know"
                     aria-label="Notes about the order" data-testid="notes"></v-textarea>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    expect(box(host).getAttribute('title')).toBe('Anything you want us to know');
    expect(box(host).getAttribute('data-testid')).toBe('notes');
    expect(box(host).getAttribute('aria-label')).toBe('Notes about the order');
    expect(field(host).hasAttribute('title')).toBe(false);
    expect(field(host).hasAttribute('aria-label')).toBe(false);

    // And still there after the box's own attributes have been rewritten: a
    // name applied beside the primitive's bag rather than among it is a name
    // the first edit takes back.
    type(box(host), 'Leave it at the door.');
    expect(box(host).getAttribute('aria-label')).toBe('Notes about the order');
  });

  it('forwards every option the primitive takes once', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(
        `<v-textarea label="Bio" placeholder="Start anywhere." autoComplete="off"
                     :minLength="4" :maxLength="280"></v-textarea>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    expect(box(host).getAttribute('placeholder')).toBe('Start anywhere.');
    expect(box(host).getAttribute('autocomplete')).toBe('off');
    expect(box(host).getAttribute('minlength')).toBe('4');
    expect(box(host).getAttribute('maxlength')).toBe('280');
    // The hook an empty box is drawn by, which is the field's own rather than
    // a state this component invented.
    expect(box(host).getAttribute('data-empty')).toBe('');

    type(box(host), 'Something.');
    expect(box(host).hasAttribute('data-empty')).toBe(false);
  });

  it('opens at the rows it was given and stops growing where it was told', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`<v-textarea label="Bio" rows="4" maxRows="6"></v-textarea>`),
    })
    class Page {}

    const { host } = show(Page);

    expect(box(host).getAttribute('rows')).toBe('4');
    // One declaration beats measuring: the browser then re-sizes on the edits
    // no listener sees — autofill, undo, an IME commit.
    expect(box(host).style.getPropertyValue('field-sizing')).toBe('content');
    // The platform drops `rows` on a box it is sizing to its content, so the
    // floor is said again as a height — in the box's own line height, which is
    // the unit the author thinks in.
    expect(box(host).style.getPropertyValue('min-height')).toBe('4lh');
    expect(box(host).style.getPropertyValue('max-height')).toBe('6lh');
  });

  it('writes no style at all when the box is not to grow', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`<v-textarea label="Bio" rows="3" :autoSize="false"></v-textarea>`),
    })
    class Page {}

    const { host } = show(Page);

    expect(box(host).getAttribute('style')).toBeNull();
    // `rows` still opens the box, because the platform honours it on one it is
    // not sizing itself.
    expect(box(host).getAttribute('rows')).toBe('3');
  });

  it('writes every state the sheet’s rules select on', async () => {
    let answer: (message: string | undefined) => void = () => {};

    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`
        <v-textarea label="Bio" validateOn="blur" :validate="check"
                    :disabled="off.get()" :readOnly="locked.get()"></v-textarea>
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
    type(box(host), 'Too short.');
    leave(box(host));
    expect(state()).toBe('pending');
    expect(box(host).getAttribute('aria-busy')).toBe('true');

    answer('A little more than that, please.');
    await vi.waitUntil(() => state() === 'invalid');
    expect(box(host).getAttribute('aria-invalid')).toBe('true');
    expect(error(host).textContent).toBe('A little more than that, please.');
    expect(field(host).getAttribute('data-state')).toBe('invalid');

    // Where the user has been is not drawn, and is on the wrapper for CSS of
    // the caller's own.
    expect(field(host).getAttribute('data-dirty')).toBe('');
    expect(field(host).getAttribute('data-touched')).toBe('');

    // Disabled is the platform's own attribute here, not `aria-disabled`
    // alone: the control *is* the native textarea, and only the attribute
    // takes it out of the form.
    instance.off.set(true);
    flushSync();
    expect(box(host).disabled).toBe(true);
    expect(box(host).getAttribute('aria-disabled')).toBe('true');

    instance.off.set(false);
    instance.locked.set(true);
    flushSync();
    expect(box(host).readOnly).toBe(true);
    expect(box(host).getAttribute('aria-readonly')).toBe('true');
    // Read-only is not disabled: the value can still be selected and copied,
    // and the box keeps its place in the tab order.
    expect(box(host).disabled).toBe(false);
  });

  it('is a plain textarea in a plain form, newline and all', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`
        <form><v-textarea label="Bio" name="bio"></v-textarea></form>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    // Enter is the newline, and nothing here takes it: a multi-line box that
    // submitted the form on Enter would be a box nobody can write in.
    const enter = press(box(host), 'Enter');
    expect(enter.defaultPrevented).toBe(false);

    type(box(host), 'Two lines\nof it');
    expect([...new FormData(form).entries()]).toEqual([['bio', 'Two lines\nof it']]);
  });

  it('follows a value bound to a signal, and reports every edit', () => {
    const seen: string[] = [];

    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(
        `<v-textarea label="Bio" :value="bio" :onValueChange="record"></v-textarea>`,
      ),
    })
    class Page {
      bio = new Signal.State('Hello.');
      record = (value: string): void => void seen.push(value);
    }

    const { instance, host } = show(Page);
    expect(box(host).value).toBe('Hello.');

    type(box(host), 'Hello again.');
    expect(instance.bio.get()).toBe('Hello again.');
    expect(seen).toEqual(['Hello again.']);

    instance.bio.set('Written from the page.');
    flushSync();
    expect(box(host).value).toBe('Written from the page.');
  });

  it('starts where it was told to, and goes back there on a reset', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`
        <form><v-textarea label="Bio" name="bio" defaultValue="Hello."></v-textarea></form>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    // The starting text is the element's own default, not only its value: that
    // is what a reset restores and what dirty is measured against, so a box
    // without it would be dirty from the moment it mounted.
    expect(box(host).value).toBe('Hello.');
    expect(box(host).defaultValue).toBe('Hello.');
    expect(new FormData(form).get('bio')).toBe('Hello.');

    type(box(host), 'Something else.');
    expect(box(host).value).toBe('Something else.');

    form.reset();
    flushSync();
    // A reset restores the control's default and fires no `input`, so a field
    // that did not follow it would disagree with the box from then on.
    expect(box(host).value).toBe('Hello.');
    expect(new FormData(form).get('bio')).toBe('Hello.');
  });

  it('validates when it was told to, and again when it was told to', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`
        <v-textarea label="Bio" validateOn="blur" revalidateOn="blur"
                    :validate="check"></v-textarea>
      `),
    })
    class Page {
      check = (value: string | null): string | undefined =>
        (value ?? '').length >= 10 ? undefined : 'Say a little more than that.';
    }

    const { host } = show(Page);
    const state = (): string | null => box(host).getAttribute('data-state');

    // Nothing is wrong before the trigger says so: a field that announces
    // itself invalid before anyone has typed is the commonest form bug there
    // is.
    type(box(host), 'no');
    expect(state()).toBe('valid');

    leave(box(host));
    expect(state()).toBe('invalid');
    expect(error(host).textContent).toBe('Say a little more than that.');

    // `revalidateOn="blur"`, so the correction does not clear it until the
    // user leaves again.
    type(box(host), 'Enough about it to go on with.');
    expect(state()).toBe('invalid');

    leave(box(host));
    expect(state()).toBe('valid');
    expect(error(host).textContent).toBe('');
  });

  it('hands `required` to the platform rather than enforcing it itself', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`
        <form><v-textarea label="What went wrong?" name="bio" required></v-textarea></form>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    expect(box(host).required).toBe(true);
    expect(box(host).getAttribute('aria-required')).toBe('true');
    expect(field(host).getAttribute('data-required')).toBe('');

    // The attribute is what makes the browser refuse the submit, which no
    // amount of ARIA does: `aria-required` says it and `required` means it.
    expect(box(host).validity.valueMissing).toBe(true);
    expect(form.checkValidity()).toBe(false);

    type(box(host), 'The lid was loose.');
    expect(box(host).validity.valueMissing).toBe(false);
    expect(submit(form)).toBe(true);
  });

  it('follows `required` bound to a signal', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`
        <form><v-textarea label="Why?" name="bio" :required="must.get()"></v-textarea></form>
      `),
    })
    class Page {
      must = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;

    expect(box(host).required).toBe(false);
    expect(box(host).hasAttribute('aria-required')).toBe(false);
    expect(form.checkValidity()).toBe(true);

    // A field that reads `required` once is a field a page can never turn on:
    // "required only when they picked 'other'" is the ordinary case, and it
    // arrives after the first render.
    instance.must.set(true);
    flushSync();
    expect(box(host).required).toBe(true);
    expect(box(host).getAttribute('aria-required')).toBe('true');
    expect(field(host).getAttribute('data-required')).toBe('');
    expect(form.checkValidity()).toBe(false);

    instance.must.set(false);
    flushSync();
    expect(box(host).required).toBe(false);
    expect(field(host).hasAttribute('data-required')).toBe(false);
  });

  it('says what went wrong in the words it was given', async () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`
        <v-textarea :ref="bio" label="Bio" :validate="check" :labels="wording"></v-textarea>
      `),
    })
    class Page {
      bio: VTextarea | null = null;
      wording = { validationFailed: 'We could not check that just now.' };
      check = (): Promise<string | undefined> => Promise.reject(new Error('offline'));
    }

    const { instance, host } = show(Page);
    await instance.bio!.textarea.field.validate();
    flushSync();

    // A validator that threw has not said the value is good, and treating
    // silence as approval is how bad values get through — so the field says so
    // in the caller's own language rather than in the library's.
    expect(box(host).getAttribute('data-state')).toBe('invalid');
    expect(error(host).textContent).toBe('We could not check that just now.');
  });

  it('draws a label and a line of help written as markup', () => {
    @Component({
      selector: 'v-page2',
      imports: [VTextarea],
      render: compileTemplate(`
        <v-textarea>
          <template :slot-label>Bio <abbr title="required">*</abbr></template>
          <template :slot-description>See the <a href="/privacy">privacy note</a>.</template>
        </v-textarea>
      `),
    })
    class Page2 {}

    const { host } = show(Page2);

    expect(label(host).querySelector('abbr')?.getAttribute('title')).toBe('required');
    expect(label(host).textContent).toContain('Bio');
    expect(hint(host).querySelector('a')?.getAttribute('href')).toBe('/privacy');
    // Still the elements the field points at, whatever was written into them.
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(box(host).getAttribute('aria-describedby')).toContain(hint(host).id);
  });

  it('follows words that change', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(
        `<v-textarea :label="words.get()" :description="help.get()"></v-textarea>`,
      ),
    })
    class Page {
      words = new Signal.State('Bio');
      help = new Signal.State('A sentence or two.');
    }

    const { instance, host } = show(Page);
    expect(label(host).textContent).toBe('Bio');

    instance.words.set('About you');
    instance.help.set('As much as you like.');
    flushSync();
    expect(label(host).textContent).toBe('About you');
    expect(hint(host).textContent).toBe('As much as you like.');
  });

  it('adds what the caller says about the control to what the field says', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`
        <span id="heading">Report a problem</span>
        <span id="rules">Plain text only.</span>
        <v-textarea label="Details" aria-labelledby="heading"
                    :aria-describedby="extra.get()"></v-textarea>
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
    expect(box(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id}`);
  });

  it('lets a name the caller wrote be the name the box has', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`<v-textarea label="Bio" aria-label="About you"></v-textarea>`),
    })
    class Page {}

    const { host } = show(Page);

    // `aria-labelledby` outranks `aria-label` wherever an accessible name is
    // computed, so a field that keeps pointing the first at its own label
    // leaves the second sitting on the element naming nothing. A plain
    // `<textarea>` beside a `<label for>` does the opposite — there the label
    // is the weaker of the two — and this is that textarea.
    expect(box(host).getAttribute('aria-label')).toBe('About you');
    expect(box(host).hasAttribute('aria-labelledby')).toBe(false);

    // The words are still the label: the `for` is what makes a press on them
    // put the caret in the box, and standing a reference down is not giving
    // that up.
    expect(label(host).getAttribute('for')).toBe(box(host).id);
  });

  it('keeps both spellings when the caller wrote both', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`
        <span id="heading">Report a problem</span>
        <v-textarea label="Details" aria-label="What went wrong"
                    aria-labelledby="heading"></v-textarea>
      `),
    })
    class Page {}

    const { host } = show(Page);

    // Both are the caller's, so both land and the platform's own order picks
    // between them. Nothing here is the field's to stand down.
    expect(box(host).getAttribute('aria-label')).toBe('What went wrong');
    expect(box(host).getAttribute('aria-labelledby')).toBe('heading');
  });

  it('takes its own label back when the caller\u2019s name goes away', () => {
    @Component({
      selector: 'v-page',
      imports: [VTextarea],
      render: compileTemplate(`<v-textarea label="Bio" :aria-label="named.get()"></v-textarea>`),
    })
    class Page {
      named = new Signal.State<string | undefined>('About you');
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
      imports: [VTextarea],
      render: compileTemplate(`
        <span id="heading">Report a problem</span>
        <v-textarea label="Details" :aria-label="spoken.get()"
                    :aria-labelledby="from.get()"
                    :aria-describedby="extra.get()"></v-textarea>
      `),
    })
    class Page {
      spoken = new Signal.State(' ');
      from = new Signal.State('');
      extra = new Signal.State('   ');
    }

    const { instance, host } = show(Page);

    // An id a caller has not chosen yet is an empty string, not an
    // instruction to name the box after nothing: pointing `aria-labelledby`
    // at no id at all cuts the box loose from its own label, which is the one
    // thing this prop exists to replace.
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(box(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id}`);
    // And a name that is only spaces is not a name either: standing the
    // field's own reference down for it would leave the box with no name at
    // all, which is worse than the one it had.
    expect(box(host).hasAttribute('aria-label')).toBe(false);

    instance.spoken.set('What went wrong');
    instance.from.set('heading');
    instance.extra.set('rules');
    flushSync();
    expect(box(host).getAttribute('aria-label')).toBe('What went wrong');
    expect(box(host).getAttribute('aria-labelledby')).toBe('heading');
    expect(box(host).getAttribute('aria-describedby')).toBe(
      `${hint(host).id} ${error(host).id} rules`,
    );

    // And back: a name taken away gives the field's own label back rather
    // than leaving an empty attribute where a reference used to be.
    instance.spoken.set('   ');
    instance.from.set('  ');
    flushSync();
    expect(box(host).hasAttribute('aria-label')).toBe(false);
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page3',
      imports: [VTextarea],
      render: compileTemplate(`<v-textarea :ref="bio" label="Bio" :maxLength="8"></v-textarea>`),
    })
    class Page3 {
      bio: VTextarea | null = null;
    }

    const { instance, host } = show(Page3);
    expect(instance.bio?.textarea.isEmpty()).toBe(true);
    expect(instance.bio?.textarea.remaining()).toBe(8);

    instance.bio!.textarea.setValue('Hello.');
    flushSync();
    expect(box(host).value).toBe('Hello.');
    // Counted in the UTF-16 code units `maxlength` itself counts in, so the
    // number agrees with the box rather than with the person reading it.
    expect(instance.bio!.textarea.remaining()).toBe(2);

    instance.bio!.textarea.field.setCustomValidity('That went to the wrong team.');
    flushSync();
    expect(error(host).textContent).toBe('That went to the wrong team.');
    expect(box(host).getAttribute('data-state')).toBe('invalid');

    instance.bio!.textarea.clear();
    flushSync();
    expect(box(host).value).toBe('');

    // Nothing is laid out here, so what matters is that a caller who has just
    // changed a layout the box cannot see can ask for the measurement again.
    expect(() => instance.bio!.textarea.resize()).not.toThrow();
  });
});
