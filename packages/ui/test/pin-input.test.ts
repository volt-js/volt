/**
 * `<v-pin-input>`, driven the way a page drives it.
 *
 * The behaviour is `createPinInput`'s and `createFormField`'s, and is tested
 * where it lives. What is tested here is the shell: that what a caller writes
 * on the tag reaches the group rather than the layout around it, that the
 * parts are really there and really tied to one another, that every state the
 * sheet's rules select on is written on the element those rules name, that
 * each prop handed to the primitive does something, and that nothing about
 * the primitive is out of reach.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Component, Signal, flushSync, hydrate, mount, type RenderFn } from '@voltdev/core';
import { compile, compileTemplate } from '@voltdev/core/jit';
import * as runtime from '@voltdev/core/runtime';
import * as server from '@voltdev/core/server';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { compileComponents } from './render.js';
import { VPinInput } from '../src/components/pin-input.js';
import template from '../src/components/pin-input.html?raw';
import { FORCED_COLORS_QUERY, rulesToCss, wrap, type Rule } from '../src/index.ts';
import { pinInputStyles } from '../src/sheet/pin-input.js';
import { standIn, styledDocument, SYSTEM_COLORS, type Fixture } from './harness.ts';
import { mounted } from './scene.ts';
import { scene } from './scenes/pin-input.ts';

compileComponents();

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  for (const handle of mounted.splice(0)) handle.unmount();
  flushSync();
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
const group = (host: HTMLElement): HTMLElement => host.querySelector('.volt-pin-input')!;
const boxes = (host: HTMLElement): HTMLInputElement[] => [
  ...host.querySelectorAll<HTMLInputElement>('.volt-pin-input-box'),
];
const box = (host: HTMLElement, index: number): HTMLInputElement => boxes(host)[index]!;
/** The one that submits: inside the field, outside the group. */
const hidden = (host: HTMLElement): HTMLInputElement =>
  host.querySelector<HTMLInputElement>('.volt-field > input')!;
const hint = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-description')!;
const error = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-error')!;
const tabStops = (host: HTMLElement): string[] =>
  boxes(host).map((el) => el.getAttribute('tabindex') ?? '');
const shown = (host: HTMLElement): string[] => boxes(host).map((el) => el.value);

/** An edit as the user makes it: the box first, then the event it fires. */
function type(el: HTMLInputElement, text: string): void {
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** A keydown as the user sends one: bubbling, and cancellable. */
function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

function paste(target: Element, text: string): ClipboardEvent {
  const data = new DataTransfer();
  data.setData('text', text);
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
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

describe('v-pin-input', () => {
  it('is a label, a row of boxes, a hidden input, a line of help and a message, tied to one another', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(
        `<v-pin-input class="mine" id="code" name="code" label="Verification code"
                      description="Sent by text message."></v-pin-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // What the caller wrote lands on the group: it is the element carrying
    // the role, and the row a class lays out. The `<div>` around it is
    // layout nobody named.
    expect([...group(host).classList].sort()).toEqual(['mine', 'volt-pin-input']);
    expect(group(host).id).toBe('code');
    expect(field(host).classList.contains('mine')).toBe(false);
    expect(group(host).getAttribute('role')).toBe('group');

    // Six boxes, each a real input named by its place, found by the primitive
    // through the attribute it writes.
    expect(boxes(host)).toHaveLength(6);
    expect(boxes(host).map((el) => el.getAttribute('data-volt-pin-box'))).toEqual([
      '0', '1', '2', '3', '4', '5',
    ]);
    expect(box(host, 2).getAttribute('aria-label')).toBe('Digit 3 of 6');
    expect(box(host, 0).getAttribute('inputmode')).toBe('numeric');
    expect(box(host, 0).type).toBe('text');

    // The label points at the first box rather than at the control, so a
    // press on the words puts the caret where typing starts; the group
    // borrows the control's ARIA, which is how a screen reader hears one
    // field rather than six.
    expect(label(host).textContent).toBe('Verification code');
    expect(label(host).getAttribute('for')).toBe(box(host, 0).id);
    expect(group(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(hint(host).textContent).toBe('Sent by text message.');
    // The standing explanation first and the news second, which is the order
    // a screen reader reads them in.
    expect(group(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id}`);

    // The hidden input is what submits: named, reachable to the platform, and
    // out of the way of everything else.
    expect(hidden(host).name).toBe('code');
    expect(hidden(host).getAttribute('aria-hidden')).toBe('true');
    expect(hidden(host).getAttribute('tabindex')).toBe('-1');
    expect(group(host).contains(hidden(host))).toBe(false);

    // A live region that arrives already holding its message is one nothing
    // was watching.
    expect(error(host).getAttribute('role')).toBe('alert');
    expect(error(host).textContent).toBe('');
    expect(field(host).getAttribute('data-state')).toBe('valid');
  });

  it('lands everything else the caller wrote on the group as well', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(
        `<v-pin-input label="Code" title="Six digits" lang="en" data-testid="code"
                      aria-label="Verification code, six digits"></v-pin-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    expect(group(host).getAttribute('title')).toBe('Six digits');
    expect(group(host).getAttribute('data-testid')).toBe('code');
    expect(group(host).getAttribute('lang')).toBe('en');
    expect(field(host).hasAttribute('title')).toBe(false);
    expect(field(host).hasAttribute('data-testid')).toBe(false);
    // A name written on the tag names the element with the role, and nothing
    // around it: not the layout, not the label, not a box.
    expect(group(host).getAttribute('aria-label')).toBe('Verification code, six digits');
    expect(field(host).hasAttribute('aria-label')).toBe(false);
    expect(label(host).hasAttribute('aria-label')).toBe(false);
    expect(box(host, 0).getAttribute('aria-label')).toBe('Digit 1 of 6');
  });

  it('forwards every option the primitive takes once', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(
        `<v-pin-input label="Passcode" length="4" type="alphanumeric" mask
                      autoComplete="off"></v-pin-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // `length="4"` is the string '4' until it is read as the number it is.
    expect(boxes(host)).toHaveLength(4);
    // Letters as well as digits: a keyboard rather than a number pad, and a
    // box named a character rather than a digit.
    expect(box(host, 0).getAttribute('inputmode')).toBe('text');
    expect(box(host, 0).getAttribute('aria-label')).toBe('Character 1 of 4');
    type(box(host, 0), 'k');
    expect(shown(host)).toEqual(['k', '', '', '']);
    // Dots, which is the platform's own password rendering.
    expect(boxes(host).every((el) => el.type === 'password')).toBe(true);
    expect(box(host, 0).getAttribute('autocomplete')).toBe('off');
  });

  it('offers the code to autofill once, through the first box', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code"></v-pin-input>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(boxes(host).map((el) => el.getAttribute('autocomplete'))).toEqual([
      'one-time-code', 'off', 'off', 'off', 'off', 'off',
    ]);
  });

  it('reads a flag the way a tag delivers one, and refuses a length that is not a count', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code" mask="false"></v-pin-input>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(box(host, 0).type).toBe('text');
    unmount?.();
    document.body.innerHTML = '';

    // And the two flags that are signals, read the same way: a field that
    // took `disabled="false"` as on was out of the form, and one that took
    // `required="false"` as on refused every submit over an empty code. A
    // verdict waits for the field to be in use, so it waited for ever.
    @Component({
      selector: 'v-page3',
      imports: [VPinInput],
      render: compileTemplate(
        `<form><v-pin-input label="Code" name="code" required="false" disabled="false"
                            error="Codes expire after ten minutes."></v-pin-input></form>`,
      ),
    })
    class Page3 {}

    const off = show(Page3).host;
    expect(hidden(off).required).toBe(false);
    expect(boxes(off).some((el) => el.hasAttribute('aria-required'))).toBe(false);
    expect(hidden(off).disabled).toBe(false);
    expect(boxes(off).every((el) => !el.disabled)).toBe(true);
    expect(group(off).hasAttribute('aria-disabled')).toBe(false);
    expect(error(off).textContent).toBe('Codes expire after ten minutes.');
    unmount?.();
    unmount = null;
    document.body.innerHTML = '';

    @Component({
      selector: 'v-page2',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code" length="six"></v-pin-input>`),
    })
    class Page2 {}

    expect(() => show(Page2)).toThrow(/`length` on <v-pin-input> takes a whole number of boxes/);
  });

  it('reads a flag bound to nothing as off', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(
        `<v-pin-input label="Code" :mask="unset"></v-pin-input><v-pin-input label="Code" :mask="none"></v-pin-input>`,
      ),
    })
    class Page {
      unset: boolean | undefined = undefined;
      none: boolean | null = null;
    }

    const { host } = show(Page);
    expect(boxes(host).every((el) => el.type === 'text')).toBe(true);
  });

  it.each(['4.5', '0', '-2'])('refuses `length="%s"`, which is not a count of boxes', (written) => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code" length="${written}"></v-pin-input>`),
    })
    class Page {}

    expect(() => show(Page)).toThrow(/`length` on <v-pin-input> takes a whole number of boxes/);
  });

  it('refuses a `type` it has no rule for, rather than letting every character in', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code" type="number"></v-pin-input>`),
    })
    class Page {}

    // `number` is what a caller reaches for meaning digits, and the primitive
    // would read it as "anything but a space": letters in a numeric code, and
    // each box named a character.
    expect(() => show(Page)).toThrow(/`type` on <v-pin-input> is `numeric` or `alphanumeric`/);
  });

  it('refuses a `value` that is not a signal, and starts from `defaultValue`', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code" value="2468"></v-pin-input>`),
    })
    class Page {}

    // A string has no `.get()`, and without this the primitive found that out
    // in an effect, as a TypeError naming none of it.
    expect(() => show(Page)).toThrow(/`value` on <v-pin-input> takes a signal/);
    unmount = null;
    document.body.innerHTML = '';

    @Component({
      selector: 'v-page2',
      imports: [VPinInput],
      render: compileTemplate(
        `<form><v-pin-input label="Code" name="code" defaultValue="2468"></v-pin-input></form>`,
      ),
    })
    class Page2 {}

    const { host } = show(Page2);
    expect(shown(host)).toEqual(['2', '4', '6', '8', '', '']);
    expect(hidden(host).value).toBe('2468');

    // And it is what a reset goes back to, as it is for every other field.
    type(box(host, 4), '1');
    host.querySelector('form')!.reset();
    flushSync();
    expect(shown(host)).toEqual(['2', '4', '6', '8', '', '']);
    expect(hidden(host).value).toBe('2468');
  });

  it('says what each box is, and what an unfinished code lacks, in the words it is given', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`
        <form><v-pin-input label="Code" name="code" length="4" :labels="words"></v-pin-input></form>
      `),
    })
    class Page {
      words = {
        box: (position: number, length: number) => `Chiffre ${position} sur ${length}`,
        incomplete: 'Saisissez tous les chiffres.',
      };
    }

    const { host } = show(Page);
    expect(boxes(host).map((el) => el.getAttribute('aria-label'))).toEqual([
      'Chiffre 1 sur 4', 'Chiffre 2 sur 4', 'Chiffre 3 sur 4', 'Chiffre 4 sur 4',
    ]);

    paste(box(host, 0), '24');
    expect(submit(host.querySelector('form')!)).toBe(false);
    expect(error(host).textContent).toBe('Saisissez tous les chiffres.');
  });

  it('holds one tab stop, and moves it to where the next character goes', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code"></v-pin-input>`),
    })
    class Page {}

    const { host } = show(Page);

    // The caret is the sheet's mark for `tabindex="0"`, and there is exactly
    // one: Tab steps over the whole field in one press.
    expect(tabStops(host)).toEqual(['0', '-1', '-1', '-1', '-1', '-1']);

    type(box(host, 0), '2');
    expect(shown(host)).toEqual(['2', '', '', '', '', '']);
    expect(box(host, 0).getAttribute('data-filled')).toBe('');
    expect(box(host, 1).hasAttribute('data-filled')).toBe(false);
    expect(document.activeElement).toBe(box(host, 1));
    expect(tabStops(host)).toEqual(['-1', '0', '-1', '-1', '-1', '-1']);

    // Backspace in an empty box goes back and deletes, as one field does.
    press(box(host, 1), 'Backspace');
    expect(shown(host)).toEqual(['', '', '', '', '', '']);
    expect(document.activeElement).toBe(box(host, 0));
    expect(tabStops(host)).toEqual(['0', '-1', '-1', '-1', '-1', '-1']);

    // The arrows move inside the group, and only over filled boxes: a box
    // past the first empty one is not somewhere a character can go.
    type(box(host, 0), '2');
    type(box(host, 1), '4');
    expect(press(box(host, 2), 'ArrowLeft').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(box(host, 1));
    press(box(host, 1), 'ArrowLeft');
    expect(document.activeElement).toBe(box(host, 0));
    press(box(host, 0), 'ArrowRight');
    expect(document.activeElement).toBe(box(host, 1));

    // Enter is the form's, and a keydown the primitive answers is consumed.
    expect(press(box(host, 1), 'Enter').defaultPrevented).toBe(false);
  });

  it('points the label at the box where typing resumes, as Tab does', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code"></v-pin-input>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(label(host).getAttribute('for')).toBe(box(host, 0).id);

    // Half a code, and the user looks away to read the rest of it.
    type(box(host, 0), '2');
    type(box(host, 1), '4');
    type(box(host, 2), '6');
    box(host, 3).blur();
    flushSync();

    // Back by the words. A press on a label focuses what its `for` names —
    // happy-dom does not, so it is followed here by hand. Pointed at the
    // first box, it selected the 2 there, and the rest of the code typed
    // after it replaced the half already entered: 246 and then 810 came to
    // "810". Tab comes back to the fourth box, and the label has to as well.
    expect(label(host).getAttribute('for')).toBe(box(host, 3).id);
    document.getElementById(label(host).htmlFor)!.focus();
    flushSync();
    for (const digit of '810') type(document.activeElement as HTMLInputElement, digit);
    expect(shown(host)).toEqual(['2', '4', '6', '8', '1', '0']);
  });

  it('deletes in place, ignores a space, and jumps to either end', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code"></v-pin-input>`),
    })
    class Page {}

    const { host } = show(Page);
    paste(box(host, 0), '2468');

    // Delete takes the character under the caret and shifts the rest along,
    // which is what it does in one field: no hole is left behind.
    box(host, 1).focus();
    flushSync();
    expect(press(box(host, 1), 'Delete').defaultPrevented).toBe(true);
    expect(shown(host)).toEqual(['2', '6', '8', '', '', '']);

    // No code contains a space, and an unclaimed one would scroll the page.
    expect(press(box(host, 1), ' ').defaultPrevented).toBe(true);
    expect(shown(host)).toEqual(['2', '6', '8', '', '', '']);

    expect(press(box(host, 1), 'Home').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(box(host, 0));
    // The last box is past the first empty one, so End lands where the next
    // character goes rather than leaving a gap.
    press(box(host, 0), 'End');
    expect(document.activeElement).toBe(box(host, 3));
    expect(tabStops(host)).toEqual(['-1', '-1', '-1', '0', '-1', '-1']);
  });

  it('shows a verdict given when the code completes, and lets it go on the next edit', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(
        `<v-pin-input label="Code" :prop-error="problem.get()" :onValueChange="edited"
                      :onComplete="check"></v-pin-input>`,
      ),
    })
    class Page {
      problem = new Signal.State('');
      check = (code: string): void => {
        if (code !== '246810') this.problem.set('That code is wrong.');
      };
      edited = (): void => this.problem.set('');
    }

    const { host } = show(Page);

    // The pattern the reference page gives: clear on every edit, judge on
    // completion. The completing edit is also the edit the field lets a
    // verdict go on, and the verdict has to be the one left standing.
    paste(box(host, 0), '111111');
    expect(error(host).textContent).toBe('That code is wrong.');
    expect(boxes(host).every((el) => el.getAttribute('aria-invalid') === 'true')).toBe(true);
    expect(hidden(host).validationMessage).toBe('That code is wrong.');

    press(box(host, 5), 'Backspace');
    expect(error(host).textContent).toBe('Enter all the characters.');

    // The same words a second time, which reach the field only because the
    // edit in between cleared them.
    type(box(host, 5), '1');
    expect(error(host).textContent).toBe('That code is wrong.');

    paste(box(host, 0), '246810');
    expect(error(host).textContent).toBe('');
    expect(boxes(host).every((el) => !el.hasAttribute('aria-invalid'))).toBe(true);
    expect(hidden(host).validationMessage).toBe('');
  });

  it('empties every box when the form is reset', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<form><v-pin-input label="Code" name="code"></v-pin-input></form>`),
    })
    class Page {}

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    paste(box(host, 0), '2468');
    expect(tabStops(host)).toEqual(['-1', '-1', '-1', '-1', '0', '-1']);

    // A reset fires no `input`, so it reaches the boxes only through the
    // hidden input's form — which is why that input is inside it.
    form.reset();
    flushSync();
    expect(shown(host)).toEqual(['', '', '', '', '', '']);
    expect(hidden(host).value).toBe('');
    expect(tabStops(host)).toEqual(['0', '-1', '-1', '-1', '-1', '-1']);
    expect(new FormData(form).get('code')).toBe('');
  });

  it('spreads a paste across the boxes, and says when the code is complete', () => {
    const completed: string[] = [];
    const edits: string[] = [];

    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(
        `<v-pin-input label="Code" :onComplete="done" :onValueChange="edit"></v-pin-input>`,
      ),
    })
    class Page {
      done = (value: string): void => void completed.push(value);
      edit = (value: string): void => void edits.push(value);
    }

    const { host } = show(Page);

    // A code pasted from a message arrives with the spaces it was sent with.
    expect(paste(box(host, 0), '246 810').defaultPrevented).toBe(true);
    expect(shown(host)).toEqual(['2', '4', '6', '8', '1', '0']);
    expect(group(host).getAttribute('data-complete')).toBe('');
    expect(completed).toEqual(['246810']);
    expect(edits).toEqual(['246810']);
    expect(document.activeElement).toBe(box(host, 5));

    // Once per completion, and not for an edit that leaves a box empty.
    press(box(host, 5), 'Backspace');
    expect(group(host).hasAttribute('data-complete')).toBe(false);
    expect(completed).toEqual(['246810']);
    expect(edits).toEqual(['246810', '24681']);
  });

  it('follows a value bound to a signal, and writes every edit back into it', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code" :value="code"></v-pin-input>`),
    })
    class Page {
      code = new Signal.State('24');
    }

    const { instance, host } = show(Page);
    expect(shown(host)).toEqual(['2', '4', '', '', '', '']);

    // The boxes are the mirror: written from the signal, read back on input.
    instance.code.set('2468');
    flushSync();
    expect(shown(host)).toEqual(['2', '4', '6', '8', '', '']);
    expect(hidden(host).value).toBe('2468');

    type(box(host, 4), '1');
    expect(instance.code.get()).toBe('24681');
  });

  it('writes every state the sheet’s rules select on', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(
        // `error` shares its name with a DOM event, which is what `:error`
        // would mean; the escape says it is the prop.
        `<v-pin-input label="Code" :disabled="off.get()" :required="must.get()"
                      :prop-error="verdict.get()"></v-pin-input>`,
      ),
    })
    class Page {
      off = new Signal.State(false);
      must = new Signal.State(false);
      verdict = new Signal.State('');
    }

    const { instance, host } = show(Page);

    // The caller's verdict: on the message line, on every box, and pushed
    // into the control so the platform refuses the submit for the same
    // reason.
    expect(boxes(host).every((el) => !el.hasAttribute('aria-invalid'))).toBe(true);
    instance.verdict.set('That code is wrong.');
    flushSync();
    expect(error(host).textContent).toBe('That code is wrong.');
    expect(boxes(host).every((el) => el.getAttribute('aria-invalid') === 'true')).toBe(true);
    expect(group(host).getAttribute('aria-invalid')).toBe('true');
    expect(field(host).getAttribute('data-state')).toBe('invalid');
    expect(hidden(host).validationMessage).toBe('That code is wrong.');

    // Taken back: no verdict is no verdict.
    instance.verdict.set('');
    flushSync();
    expect(error(host).textContent).toBe('');
    expect(boxes(host).every((el) => !el.hasAttribute('aria-invalid'))).toBe(true);
    expect(field(host).getAttribute('data-state')).toBe('valid');

    // Required is the hidden input's, since that is what the platform
    // validates, and every box's in ARIA, since a box is what is heard.
    expect(hidden(host).required).toBe(false);
    instance.must.set(true);
    flushSync();
    expect(hidden(host).required).toBe(true);
    expect(boxes(host).every((el) => el.getAttribute('aria-required') === 'true')).toBe(true);

    // Disabled is the platform's own attribute on every box — they are native
    // inputs, and only the attribute takes them out of the form — and said
    // once on the group.
    instance.off.set(true);
    flushSync();
    expect(boxes(host).every((el) => el.disabled)).toBe(true);
    expect(group(host).getAttribute('aria-disabled')).toBe('true');
    expect(field(host).getAttribute('data-disabled')).toBe('');
    // Refused: a disabled field is not one anybody can type into.
    type(box(host, 0), '2');
    expect(shown(host)).toEqual(['', '', '', '', '', '']);
    expect(press(box(host, 0), 'Backspace').defaultPrevented).toBe(false);

    instance.off.set(false);
    flushSync();
    expect(boxes(host).every((el) => !el.disabled)).toBe(true);
    expect(group(host).hasAttribute('aria-disabled')).toBe(false);
  });

  it('says `required` on the boxes a reader is on, and not on the group, which cannot carry it', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code" :required="must.get()"></v-pin-input>`),
    })
    class Page {
      must = new Signal.State(true);
    }

    const { instance, host } = show(Page);

    // `aria-required` belongs to a widget a value is entered into — a
    // textbox, which each box is — and a group is not one: written there it
    // is an attribute the role does not support, which a screen reader does
    // not announce and a checker reports. The date picker's segments carry it
    // for the same reason.
    expect(group(host).hasAttribute('aria-required')).toBe(false);
    expect(boxes(host).map((el) => el.getAttribute('aria-required'))).toEqual(
      Array.from({ length: 6 }, () => 'true'),
    );
    // Only in ARIA: a native `required` on a box would have the platform
    // refuse a submit six times over, for boxes nobody is meant to fill alone.
    expect(boxes(host).every((el) => !el.required)).toBe(true);

    instance.must.set(false);
    flushSync();
    expect(boxes(host).some((el) => el.hasAttribute('aria-required'))).toBe(false);
    expect(group(host).hasAttribute('aria-required')).toBe(false);
  });

  it('reads a length or a type bound to nothing as the default, as it does a flag', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(
        `<v-pin-input label="Code" :length="count" :type="kind"></v-pin-input>
         <v-pin-input label="Code" :length="none" :type="nothing"></v-pin-input>`,
      ),
    })
    class Page {
      // What a wrapper forwarding its own optional props hands over when its
      // caller wrote neither.
      count: number | undefined = undefined;
      kind: 'numeric' | 'alphanumeric' | undefined = undefined;
      none: number | null = null;
      nothing: 'numeric' | null = null;
    }

    const { host } = show(Page);
    const groups = [...host.querySelectorAll<HTMLElement>('.volt-pin-input')];
    expect(groups).toHaveLength(2);
    for (const each of groups) {
      const inside = [...each.querySelectorAll<HTMLInputElement>('.volt-pin-input-box')];
      expect(inside).toHaveLength(6);
      expect(inside[0]!.getAttribute('inputmode')).toBe('numeric');
      expect(inside[0]!.getAttribute('aria-label')).toBe('Digit 1 of 6');
    }
  });

  it('writes, in its own markup, every state the sheet selects on', () => {
    // The scene in `scenes/pin-input.ts` holds the entry against a copy of
    // this markup. This holds it against the markup itself, so a class or a
    // state the template stopped writing is caught here, not in a copy.
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(
        `<v-pin-input :ref="handle" label="Code" :disabled="off.get()"
                      :prop-error="verdict.get()"></v-pin-input>`,
      ),
    })
    class Page {
      handle: VPinInput | null = null;
      off = new Signal.State(false);
      verdict = new Signal.State('');
    }

    const { instance } = show(Page);
    const unmatched = new Set(
      [...pinInputStyles.rules, ...pinInputStyles.forcedColors].map((rule) =>
        rule.selector.replaceAll(':hover', '').replaceAll(':focus-visible', ''),
      ),
    );
    const look = (): void => {
      for (const selector of unmatched) if (document.querySelector(selector)) unmatched.delete(selector);
    };

    look();
    instance.handle!.pin.setValue('24');
    flushSync();
    look();
    instance.verdict.set('That code is wrong.');
    flushSync();
    look();
    instance.off.set(true);
    flushSync();
    look();

    expect([...unmatched]).toEqual([]);
  });

  it('shows a verdict that arrived while the field was out of use, once it is back', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(
        `<v-pin-input label="Code" :disabled="busy.get()" :prop-error="problem.get()"></v-pin-input>`,
      ),
    })
    class Page {
      busy = new Signal.State(false);
      problem = new Signal.State('');
    }

    const { instance, host } = show(Page);

    // The page takes the field out of use while it asks, hears back while it
    // is still out of use — a wait before the next attempt — and then hands it
    // back. The verdict still stands, so it has to be on screen and in the
    // control, or the next submit is let through the platform on a code the
    // page has already refused.
    paste(box(host, 0), '111111');
    instance.busy.set(true);
    flushSync();
    instance.problem.set('That code is wrong.');
    flushSync();
    instance.busy.set(false);
    flushSync();

    expect(error(host).textContent).toBe('That code is wrong.');
    expect(boxes(host).every((el) => el.getAttribute('aria-invalid') === 'true')).toBe(true);
    expect(hidden(host).validationMessage).toBe('That code is wrong.');
  });

  it('does not raise again, on the way back into use, a verdict the field has let go', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(
        `<v-pin-input label="Code" :disabled="busy.get()" :prop-error="problem.get()"></v-pin-input>`,
      ),
    })
    class Page {
      busy = new Signal.State(false);
      problem = new Signal.State('');
    }

    const { instance, host } = show(Page);

    // A page that never clears its signal: the verdict is given once, and
    // the user's edit is what lets it go.
    paste(box(host, 0), '111111');
    instance.problem.set('That code is wrong.');
    flushSync();
    expect(error(host).textContent).toBe('That code is wrong.');
    paste(box(host, 0), '246810');
    expect(error(host).textContent).toBe('');

    // Out of use and back is not the page saying anything new.
    instance.busy.set(true);
    flushSync();
    instance.busy.set(false);
    flushSync();
    expect(error(host).textContent).toBe('');
    expect(hidden(host).validationMessage).toBe('');

    // A verdict taken back while the field was out of use is taken back.
    instance.problem.set('Codes expire after ten minutes.');
    flushSync();
    instance.busy.set(true);
    flushSync();
    instance.problem.set('');
    flushSync();
    instance.busy.set(false);
    flushSync();
    expect(error(host).textContent).toBe('');
    expect(hidden(host).validationMessage).toBe('');
  });

  it('draws no caret in a field nobody can type into', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code" :disabled="off.get()"></v-pin-input>`),
    })
    class Page {
      off = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    // The caret is the rule that paints the accent edge; it is found by what
    // it draws rather than by its selector, which is what is under test.
    const caret = pinInputStyles.rules.find(
      (rule) => rule.declarations['border-block-end-color'] === 'var(--volt-color-accent)',
    )!;

    expect(box(host, 0).matches(caret.selector)).toBe(true);

    // Out of use, the box keeps the group's tab stop for when it comes back,
    // but the accent mark says "type here" to a field that takes nothing.
    instance.off.set(true);
    flushSync();
    expect(box(host, 0).getAttribute('tabindex')).toBe('0');
    expect(box(host, 0).matches(caret.selector)).toBe(false);
  });

  it('shows the verdict over a code the page emptied, which is what the platform refuses with', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`
        <form><v-pin-input :ref="handle" label="Code" name="code" required
                           :prop-error="problem.get()" :onValueChange="edited"></v-pin-input></form>
      `),
    })
    class Page {
      handle: VPinInput | null = null;
      problem = new Signal.State('');
      edited = (): void => this.problem.set('');
    }

    const { instance, host } = show(Page);

    // The usual answer to a wrong one-time code: take it away, so the next
    // attempt starts from an empty row, and say why. The row is empty and
    // `required`, so the platform has a complaint of its own — but the
    // control refuses with the verdict, and the screen has to say the same.
    paste(box(host, 0), '111111');
    instance.handle!.pin.clear();
    instance.problem.set('That code is wrong. Enter the new one we sent.');
    flushSync();

    expect(shown(host)).toEqual(['', '', '', '', '', '']);
    expect(hidden(host).validationMessage).toBe('That code is wrong. Enter the new one we sent.');
    expect(error(host).textContent).toBe('That code is wrong. Enter the new one we sent.');

    // Once it is let go, the platform's own complaint is what is left.
    type(box(host, 0), '2');
    expect(error(host).textContent).toBe('Enter all the characters.');
  });

  it('reads an `aria-label` of nothing but spaces as no name at all', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code" aria-label="   "></v-pin-input>`),
    })
    class Page {}

    const { host } = show(Page);
    // Blank words standing the label's reference down would leave the group
    // with no name at all.
    expect(group(host).hasAttribute('aria-label')).toBe(false);
    expect(group(host).getAttribute('aria-labelledby')).toBe(label(host).id);
  });

  it('shows a verdict given before anything was typed', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input label="Code" error="Codes expire after ten minutes."></v-pin-input>`),
    })
    class Page {}

    const { host } = show(Page);
    // Handed to the field once the control is on the page, rather than while
    // the class is built, when there is nothing to measure it against.
    expect(error(host).textContent).toBe('Codes expire after ten minutes.');
    expect(field(host).getAttribute('data-state')).toBe('invalid');
  });

  it('submits the whole code under its name, and refuses one that is not whole', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`
        <form><v-pin-input label="Code" name="code" required></v-pin-input></form>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    // Empty is `required`'s business, worded by the platform.
    expect(submit(form)).toBe(false);
    expect(field(host).getAttribute('data-state')).toBe('invalid');
    expect(error(host).textContent).not.toBe('');

    // Half a code is the primitive's, in its own words, and the boxes carry it.
    paste(box(host, 0), '246');
    expect(submit(form)).toBe(false);
    expect(error(host).textContent).toBe('Enter all the characters.');
    expect(boxes(host).every((el) => el.getAttribute('aria-invalid') === 'true')).toBe(true);

    paste(box(host, 3), '810');
    expect(error(host).textContent).toBe('');
    expect(submit(form)).toBe(true);
    expect(new FormData(form).get('code')).toBe('246810');
  });

  it('draws a label and a line of help written as markup', () => {
    @Component({
      selector: 'v-page2',
      imports: [VPinInput],
      render: compileTemplate(`
        <v-pin-input>
          <template :slot-label>Code <abbr title="required">*</abbr></template>
          <template :slot-description>Sent to <b>+44 7700 900123</b>.</template>
        </v-pin-input>
      `),
    })
    class Page2 {}

    const { host } = show(Page2);

    expect(label(host).querySelector('abbr')?.getAttribute('title')).toBe('required');
    expect(label(host).textContent).toContain('Code');
    expect(hint(host).querySelector('b')?.textContent).toBe('+44 7700 900123');
    // Still the elements the field points at, whatever was written into them.
    expect(group(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(group(host).getAttribute('aria-describedby')).toContain(hint(host).id);
  });

  it('follows words that change', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(
        `<v-pin-input :label="words.get()" :description="help.get()"></v-pin-input>`,
      ),
    })
    class Page {
      words = new Signal.State('Code');
      help = new Signal.State('Sent by text message.');
    }

    const { instance, host } = show(Page);
    expect(label(host).textContent).toBe('Code');

    instance.words.set('Verification code');
    instance.help.set('Sent by email.');
    flushSync();
    expect(label(host).textContent).toBe('Verification code');
    expect(hint(host).textContent).toBe('Sent by email.');
  });

  it('adds what the caller says about the group to what the field says', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(`
        <span id="heading">Confirm it is you</span>
        <span id="step">Step 2</span>
        <span id="rules">Digits only.</span>
        <v-pin-input label="Code" :aria-labelledby="named.get()"
                     :aria-describedby="extra.get()"></v-pin-input>
      `),
    })
    class Page {
      named = new Signal.State<string | undefined>('heading');
      extra = new Signal.State('rules');
    }

    const { instance, host } = show(Page);

    // A name from elsewhere wins: naming the group from elsewhere is the only
    // reason to write it. Bound, it follows; taken away, the label is back.
    expect(group(host).getAttribute('aria-labelledby')).toBe('heading');
    instance.named.set('step heading');
    flushSync();
    expect(group(host).getAttribute('aria-labelledby')).toBe('step heading');
    instance.named.set(undefined);
    flushSync();
    expect(group(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    instance.named.set('heading');
    flushSync();
    // A description is added, after the field's own two.
    expect(group(host).getAttribute('aria-describedby')).toBe(
      `${hint(host).id} ${error(host).id} rules`,
    );

    instance.extra.set('');
    flushSync();
    expect(group(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id}`);
  });

  it('lets a name the caller wrote be the name the group has', () => {
    @Component({
      selector: 'v-page',
      imports: [VPinInput],
      render: compileTemplate(
        `<v-pin-input label="Code" :aria-label="named.get()"></v-pin-input>`,
      ),
    })
    class Page {
      named = new Signal.State<string | undefined>('Six-digit code');
    }

    const { instance, host } = show(Page);

    // `aria-labelledby` outranks `aria-label` wherever a name is computed, so
    // the field's reference to its own label is stood down. The `for` stays:
    // a press on the words still puts the caret in the first box.
    expect(group(host).getAttribute('aria-label')).toBe('Six-digit code');
    expect(group(host).hasAttribute('aria-labelledby')).toBe(false);
    expect(label(host).getAttribute('for')).toBe(box(host, 0).id);

    // And back, once the name goes away.
    instance.named.set(undefined);
    flushSync();
    expect(group(host).hasAttribute('aria-label')).toBe(false);
    expect(group(host).getAttribute('aria-labelledby')).toBe(label(host).id);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page3',
      imports: [VPinInput],
      render: compileTemplate(`<v-pin-input :ref="handle" label="Code" length="4"></v-pin-input>`),
    })
    class Page3 {
      handle: VPinInput | null = null;
    }

    const { instance, host } = show(Page3);
    expect(instance.handle?.pin.length()).toBe(4);
    expect(instance.handle?.pin.isComplete()).toBe(false);

    // Told where the parts are, so the bag it hands a caller who draws a group
    // of their own points at the label, the help and the message this drew.
    // The component works its own references out from the ids, which a
    // server can do too; the primitive reads them off the elements.
    const bag = instance.handle!.pin.groupProps();
    expect(bag['aria-labelledby']).toBe(label(host).id);
    expect(bag['aria-describedby']).toBe(`${hint(host).id} ${error(host).id}`);

    instance.handle!.pin.setValue('2468');
    flushSync();
    expect(shown(host)).toEqual(['2', '4', '6', '8']);
    expect(instance.handle!.pin.isComplete()).toBe(true);
    expect(instance.handle!.pin.charAt(2)).toBe('6');

    instance.handle!.pin.clear();
    flushSync();
    expect(shown(host)).toEqual(['', '', '', '']);
    expect(document.activeElement).toBe(box(host, 0));
  });

  it('draws nothing the primitive never renders', () => {
    // What `primitives.test.ts` holds every registered sheet to, run here as
    // well: the scene walks the documented markup through every state its
    // rules distinguish, and a selector nothing in it ever matched is a rule
    // that draws nothing.
    document.body.innerHTML = '<div id="app"></div>';
    const selectors = [...pinInputStyles.rules, ...pinInputStyles.forcedColors]
      .flatMap((rule) => rule.selector.split(','))
      .map((selector) => selector.trim().replaceAll(':hover', '').replaceAll(':focus-visible', ''));
    const unmatched = new Set(selectors);

    scene(() => {
      for (const selector of unmatched) if (document.querySelector(selector)) unmatched.delete(selector);
    });

    expect([...unmatched]).toEqual([]);
  });
});

/**
 * The cascade, measured rather than read. The pairs in `forced-colors.test.ts`
 * ask only whether two states differ, and a caret drawn in the accent over a
 * refused code still differs from a box that is neither — what a reader is
 * shown on the box they are on is asked here.
 */
describe('v-pin-input, as the sheet draws a box', () => {
  const plain = styledDocument();
  const forced = styledDocument({ forcedColors: true });

  /** The sheet as `harness.ts` installs it, with system colours as stand-ins. */
  const asTested = (rules: readonly Rule[]): Rule[] =>
    rules.map((rule) => ({
      selector: rule.selector,
      declarations: Object.fromEntries(
        Object.entries(rule.declarations).map(([property, value]) => [
          property,
          SYSTEM_COLORS.includes(value) ? standIn(value) : value,
        ]),
      ),
    }));

  beforeAll(() => {
    for (const dom of [plain, forced]) {
      dom.addConsumerCss(
        `${rulesToCss(asTested(pinInputStyles.rules))}\n` +
          wrap(FORCED_COLORS_QUERY, rulesToCss(asTested(pinInputStyles.forcedColors), '  ')),
      );
    }
  });

  afterAll(() => Promise.all([plain.close(), forced.close()]));

  const box = (attributes: Record<string, string>): Fixture => ({
    tag: 'input',
    classes: ['volt-pin-input-box'],
    attributes: { type: 'text', tabindex: '-1', 'data-volt-pin-box': '0', ...attributes },
  });

  /** The lower edge, which is where the caret is drawn. */
  const edge = (dom: typeof plain, attributes: Record<string, string>) => {
    const element = dom.mount(box(attributes));
    // Computed in the document it was mounted into, which is the one whose
    // palette is under test.
    const style = element.ownerDocument.defaultView!.getComputedStyle(element);
    return {
      colour: style.getPropertyValue('border-block-end-color'),
      width: style.getPropertyValue('border-block-end-width'),
    };
  };

  it('colours the caret’s edge with the rest of a refused code, and keeps it thick', () => {
    const refused = edge(plain, { 'aria-invalid': 'true' });
    const caret = edge(plain, { 'aria-invalid': 'true', tabindex: '0' });

    // One colour for the whole of a refused code: an accent edge under it says
    // "type here" over a box the field is saying is wrong.
    expect(caret.colour).toBe(refused.colour);
    expect(caret.colour).not.toBe(edge(plain, { tabindex: '0' }).colour);
    // And the box the user is on is still told apart, by its width.
    expect(caret.width).not.toBe(refused.width);
  });

  it('keeps the caret in the palette’s own colour over a refused code once it is forced', () => {
    // The refusal is the doubled edge there, and the caret is still the one
    // edge in `Highlight`.
    expect(edge(forced, { 'aria-invalid': 'true', tabindex: '0' }).colour).toBe(standIn('Highlight'));
    expect(edge(forced, { tabindex: '0' }).colour).toBe(standIn('Highlight'));
  });

  it('draws no caret on a box nobody can type into, refused or not', () => {
    expect(edge(plain, { tabindex: '0', disabled: '' })).toEqual(edge(plain, { disabled: '' }));
    expect(edge(plain, { tabindex: '0', disabled: '', 'aria-invalid': 'true' })).toEqual(
      edge(plain, { disabled: '', 'aria-invalid': 'true' }),
    );
  });
});

/**
 * `compileTemplate` picks its target from `__VOLT_SERVER__` when it is called,
 * so the tag is compiled here with the flag up, as a subclass that inherits
 * every prop: the client registration the rest of this file uses is left as
 * it is.
 */
describe('v-pin-input, written by a server', () => {
  const serverBuild = (on: boolean): void => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  };
  beforeAll(() => serverBuild(true));
  afterAll(() => serverBuild(false));

  it('names the group after the label it draws, and writes the code it starts with', async () => {
    @Component({ selector: 'v-pin-input', render: compileTemplate(template, 'v-pin-input') })
    class ServerPinInput extends VPinInput {}

    @Component({
      selector: 'v-page-server',
      imports: [ServerPinInput],
      render: compileTemplate(`
        <form><v-pin-input id="code" class="mine" name="code" label="Code" description="Sent by text."
                           defaultValue="2468" required></v-pin-input></form>
      `),
    })
    class Page {}

    const { html } = await renderToStaticMarkup(Page);
    const page = new DOMParser().parseFromString(html, 'text/html').body;

    const drawn = label(page).id;
    expect(drawn).not.toBe('');
    expect(group(page).id).toBe('code');
    expect([...group(page).classList].sort()).toEqual(['mine', 'volt-pin-input']);

    // A server sets no ref, so names read off the parts' elements are names a
    // reader without script never hears: the group went out with no name and
    // no description, and the label's words reached nothing — its `for` is
    // the first box, which is named "Digit 1 of 6" by its own `aria-label`.
    expect(group(page).getAttribute('aria-labelledby')).toBe(drawn);
    expect(group(page).getAttribute('aria-describedby')).toBe(`${hint(page).id} ${error(page).id}`);

    // The code it starts with, in the boxes and in what submits: the boxes
    // went out marked `data-filled` and empty, and a submit before the page
    // attached sent `code=` with nothing after it.
    expect(boxes(page).map((el) => el.getAttribute('value') ?? '')).toEqual(['2', '4', '6', '8', '', '']);
    expect(boxes(page).map((el) => el.hasAttribute('data-filled'))).toEqual([
      true, true, true, true, false, false,
    ]);
    expect(hidden(page).getAttribute('value')).toBe('2468');
    expect(new FormData(page.querySelector('form')!).get('code')).toBe('2468');
  });

  it('writes no more of a code than it has boxes for', async () => {
    @Component({ selector: 'v-pin-input', render: compileTemplate(template, 'v-pin-input') })
    class ServerPinInput extends VPinInput {}

    @Component({
      selector: 'v-page-server-long',
      imports: [ServerPinInput],
      render: compileTemplate(
        `<form><v-pin-input name="code" label="Code" length="4" :value="code"></v-pin-input></form>`,
      ),
    })
    class Page {
      // A caller's own signal is theirs to fill, from a link's query string as
      // easily as from the boxes, and nothing has cut it to length yet.
      code = new Signal.State('24681012');
    }

    const { html } = await renderToStaticMarkup(Page);
    const page = new DOMParser().parseFromString(html, 'text/html').body;

    // Four boxes take four characters, and what submits is what they show.
    expect(boxes(page).map((el) => el.getAttribute('value'))).toEqual(['2', '4', '6', '8']);
    expect(hidden(page).getAttribute('value')).toBe('2468');
  });
});

/**
 * One template, compiled for both halves of a page: written as bytes while
 * the build flag is up, and claimed from those bytes once it is down.
 */
function both(source: string, filename: string): RenderFn {
  const forServer = compile(source, { filename, runtime: '_rt', target: 'server' }).body;
  const forHydrate = compile(source, { filename, runtime: '_rt', target: 'hydrate' }).body;
  const write = (new Function('_rt', forServer) as (rt: unknown) => RenderFn)(server);
  const claim = (new Function('_rt', forHydrate) as (rt: unknown) => RenderFn)(runtime);
  return (ctx, out) =>
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ === true
      ? write(ctx, out)
      : claim(ctx, out);
}

describe('v-pin-input, written by a server and claimed by a browser', () => {
  @Component({ selector: 'v-pin-input', render: both(template, 'v-pin-input'), host: true })
  class RoundTripPinInput extends VPinInput {}

  @Component({
    selector: 'v-page-served',
    imports: [RoundTripPinInput],
    render: both(
      `<form><v-pin-input :value="code" name="code" label="Code" description="Sent by text."
                          id="code" class="mine" required></v-pin-input></form>`,
      'v-page-served',
    ),
  })
  class Served {
    code = new Signal.State('24');
  }

  it('claims the boxes the server wrote, with the names and the code the client would give them', async () => {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = true;
    let html: string;
    try {
      html = (await renderToStaticMarkup(Served)).html;
    } finally {
      (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = false;
    }

    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    const first = box(host, 0);

    const mismatches: unknown[] = [];
    const stop = runtime.onHydrationMismatch((mismatch) => mismatches.push(mismatch));
    let instance: Served;
    try {
      const handle = hydrate(Served, host);
      unmount = handle.unmount;
      instance = handle.instance as Served;
      flushSync();
    } finally {
      stop();
    }

    expect(mismatches).toEqual([]);
    expect(box(host, 0)).toBe(first);
    expect(group(host).id).toBe('code');
    expect([...group(host).classList].sort()).toEqual(['mine', 'volt-pin-input']);
    expect(group(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(group(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id}`);
    expect(label(host).getAttribute('for')).toBe(first.id);
    expect(shown(host)).toEqual(['2', '4', '', '', '', '']);
    expect(hidden(host).value).toBe('24');

    // And live from there on: an edit reaches the caller's signal and what
    // submits, and a reset goes back to where the page started.
    type(box(host, 2), '6');
    expect(instance!.code.get()).toBe('246');
    expect(hidden(host).value).toBe('246');
    host.querySelector('form')!.reset();
    flushSync();
    expect(shown(host)).toEqual(['2', '4', '', '', '', '']);
    expect(instance!.code.get()).toBe('24');
  });
});
