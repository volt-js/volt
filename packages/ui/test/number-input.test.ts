/**
 * `<v-number-input>`, driven the way a page drives it.
 *
 * The behaviour is `createNumberInput`'s and `createFormField`'s, and is
 * tested where it lives. What is tested here is the shell: that what a caller
 * writes on the tag reaches the box rather than the row around it, that the
 * parts are really there and really tied to one another, that every state the
 * sheet's rules select on is written on the element those rules name, that
 * every option handed to the primitive does something, and that nothing about
 * the primitive is out of reach.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { VNumberInput } from '../src/components/number-input.js';
import { numberInputStyles } from '../src/sheet/number-input.js';

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
const row = (host: HTMLElement): HTMLElement => host.querySelector('.volt-number-input')!;
const label = (host: HTMLElement): HTMLLabelElement => host.querySelector('label')!;
const box = (host: HTMLElement): HTMLInputElement => host.querySelector('input[type="text"]')!;
const hidden = (host: HTMLElement): HTMLInputElement => host.querySelector('input[type="hidden"]')!;
const hint = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-description')!;
const error = (host: HTMLElement): HTMLElement => host.querySelector('.volt-field-error')!;
const buttons = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>('.volt-number-input-button'),
];
const decrease = (host: HTMLElement): HTMLButtonElement => buttons(host)[0]!;
const increase = (host: HTMLElement): HTMLButtonElement => buttons(host)[1]!;

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

/** A keydown as the user sends one: bubbling, and cancellable. */
function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  flushSync();
}

/** A submit as a press on the button makes it, so it can be refused. */
function submit(form: HTMLFormElement): boolean {
  const event = new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  flushSync();
  return !event.defaultPrevented;
}

describe('v-number-input', () => {
  it('is a label, a spinbutton, a hidden number and a button each way, tied to one another', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input class="mine" id="qty" name="qty" label="Quantity"
                         description="Up to 99 per order." locale="en-US"
                         :min="1" :max="99" :defaultValue="5"></v-number-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // What the caller wrote lands on the box: it is the control, and the row
    // and the field around it are layout nobody named.
    expect([...box(host).classList].sort()).toEqual(['mine', 'volt-field-control']);
    expect(field(host).classList.contains('mine')).toBe(false);
    expect(row(host).classList.contains('mine')).toBe(false);

    // Text with the role said, because `type="number"` cannot hold "1.234,56".
    expect(box(host).type).toBe('text');
    expect(box(host).getAttribute('role')).toBe('spinbutton');
    expect(box(host).value).toBe('5');
    expect(box(host).getAttribute('aria-valuenow')).toBe('5');
    expect(box(host).getAttribute('aria-valuemin')).toBe('1');
    expect(box(host).getAttribute('aria-valuemax')).toBe('99');

    // One id, used by both halves — the label's `for` is what makes a press on
    // the words put the caret in the box, which no amount of ARIA does.
    expect(box(host).id).toBe('qty');
    expect(label(host).getAttribute('for')).toBe('qty');
    expect(label(host).textContent).toBe('Quantity');
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(hint(host).textContent).toBe('Up to 99 per order.');
    expect(box(host).getAttribute('aria-describedby')).toBe(`${hint(host).id} ${error(host).id}`);

    // The name is the hidden input's: what submits is the number, not its
    // spelling, so the box carries none.
    expect(hidden(host).name).toBe('qty');
    expect(hidden(host).value).toBe('5');
    expect(box(host).hasAttribute('name')).toBe(false);

    // Down then up, at the inline end of the row, each named by the primitive
    // and kept out of the way of the keyboard: the spinbutton is the tab stop
    // and its arrows do the same job.
    expect(buttons(host)).toHaveLength(2);
    expect(decrease(host).getAttribute('aria-label')).toBe('Decrease');
    expect(increase(host).getAttribute('aria-label')).toBe('Increase');
    for (const button of buttons(host)) {
      expect(button.type).toBe('button');
      expect(button.getAttribute('tabindex')).toBe('-1');
      expect(button.getAttribute('aria-hidden')).toBe('true');
      expect(button.parentElement).toBe(row(host));
    }
  });

  it('keeps the message line on the page while there is no message', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`<v-number-input label="Quantity"></v-number-input>`),
    })
    class Page {}

    const { host } = show(Page);

    expect(error(host).getAttribute('role')).toBe('alert');
    expect(error(host).textContent).toBe('');
    expect(field(host).getAttribute('data-state')).toBe('valid');
    expect(box(host).hasAttribute('aria-invalid')).toBe(false);
    // Absent while empty, which is how ARIA says "no value yet".
    expect(box(host).hasAttribute('aria-valuenow')).toBe(false);
  });

  it('lands everything else the caller wrote on the box as well', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input label="Quantity" title="How many to send"
                         lang="en" data-testid="qty"></v-number-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    expect(box(host).getAttribute('title')).toBe('How many to send');
    expect(box(host).getAttribute('data-testid')).toBe('qty');
    expect(box(host).getAttribute('lang')).toBe('en');
    expect(row(host).hasAttribute('title')).toBe(false);
    expect(field(host).hasAttribute('data-testid')).toBe(false);
  });

  it('reads and writes the number the way its locale does', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <form>
          <v-number-input :value="price" label="Price" name="price" locale="de-DE"></v-number-input>
        </form>
      `),
    })
    class Page {
      price = new Signal.State<number | null>(1234.56);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;

    expect(box(host).value).toBe('1.234,56');
    expect(box(host).getAttribute('aria-valuenow')).toBe('1234.56');
    // The spelling is read out only where it says something the bare number
    // does not.
    expect(box(host).getAttribute('aria-valuetext')).toBe('1.234,56');
    // The canonical number is what reaches a server, whatever the box says.
    expect(hidden(host).value).toBe('1234.56');
    expect(new FormData(form).get('price')).toBe('1234.56');

    // In German this is two thousand five hundred and a half, and to a naive
    // `parseFloat` it is 2.5.
    type(box(host), '2.500,5');
    expect(instance.price.get()).toBe(2500.5);
    leave(box(host));
    expect(box(host).value).toBe('2.500,5');
    expect(new FormData(form).get('price')).toBe('2500.5');
  });

  it('writes the number the way it was told to', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input label="Price" locale="en-US" :format="euros" :defaultValue="12"></v-number-input>`,
      ),
    })
    class Page {
      euros: Intl.NumberFormatOptions = { style: 'currency', currency: 'EUR' };
    }

    const { host } = show(Page);
    expect(box(host).value).toBe('€12.00');

    // Decoration is dropped on the way back in: someone who types "15" into a
    // price means fifteen euros.
    type(box(host), '15');
    leave(box(host));
    expect(box(host).value).toBe('€15.00');
    expect(box(host).getAttribute('aria-valuenow')).toBe('15');
  });

  it('steps by the arrows and the pages, and jumps to the ends', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input label="Volume" locale="en-US" :min="0" :max="100"
                         :step="5" :largeStep="25" :defaultValue="50"></v-number-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);
    const value = (): string | null => box(host).getAttribute('aria-valuenow');

    // Consumed, or the page would scroll behind the value changing.
    expect(press(box(host), 'ArrowUp').defaultPrevented).toBe(true);
    expect(value()).toBe('55');
    expect(box(host).value).toBe('55');
    press(box(host), 'ArrowDown');
    press(box(host), 'ArrowDown');
    expect(value()).toBe('45');

    press(box(host), 'PageUp');
    expect(value()).toBe('70');
    press(box(host), 'PageDown');
    expect(value()).toBe('45');

    press(box(host), 'End');
    expect(value()).toBe('100');
    press(box(host), 'Home');
    expect(value()).toBe('0');

    // A modified key is a shortcut, not a nudge.
    expect(press(box(host), 'ArrowUp', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(value()).toBe('0');
  });

  it('leaves the keys to an input method while it is composing', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input label="Quantity" locale="ja-JP" :min="0" :max="10" :defaultValue="5"></v-number-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // Mid-word, the arrows choose among the candidates and Enter commits one:
    // they are the input method's keys, not the spinbutton's. A step taken
    // there moves the value under a word still being written, and a commit
    // rewrites the box before the word is in it.
    const down = press(box(host), 'ArrowDown', { isComposing: true });
    expect(down.defaultPrevented).toBe(false);
    expect(box(host).getAttribute('aria-valuenow')).toBe('5');

    type(box(host), '７');
    press(box(host), 'Enter', { isComposing: true });
    expect(box(host).value).toBe('７');

    // Composed, they are the field's again: the full-width seven is a seven.
    expect(press(box(host), 'ArrowUp').defaultPrevented).toBe(true);
    expect(box(host).value).toBe('8');
  });

  it('steps from a press on the buttons, and stops each at its end', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input label="Copies" locale="en-US" :min="0" :max="2" :defaultValue="1"></v-number-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);
    expect(increase(host).disabled).toBe(false);
    expect(decrease(host).disabled).toBe(false);

    // A press leaves focus in the box: a focused button would be an element a
    // screen reader is told is not there, holding the arrow keys hostage.
    box(host).focus();
    for (const button of buttons(host)) {
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      button.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
    }
    expect(document.activeElement).toBe(box(host));

    click(increase(host));
    expect(box(host).value).toBe('2');
    // At the top, the way up is dead and the way down is not: the button is
    // left in the row, so the row does not move under the pointer.
    expect(increase(host).disabled).toBe(true);
    expect(decrease(host).disabled).toBe(false);

    click(decrease(host));
    click(decrease(host));
    expect(box(host).value).toBe('0');
    expect(decrease(host).disabled).toBe(true);
    expect(increase(host).disabled).toBe(false);
  });

  it('writes every state the sheet’s rules select on', async () => {
    let answer: (message: string | undefined) => void = () => {};

    // Judged on leaving, both times: the number's own check reads the text
    // the box held when the field was told of the edit, and on the `input`
    // trigger that is the text before this keystroke — so a verdict on what
    // was typed is one the field gives when the box is left.
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <v-number-input label="Seats" locale="en-US" validateOn="blur" revalidateOn="blur"
                        :validate="check" :disabled="off.get()" :readOnly="locked.get()"></v-number-input>
      `),
    })
    class Page {
      off = new Signal.State(false);
      locked = new Signal.State(false);
      check = (value: string | null): Promise<string | undefined> | undefined =>
        value === '13'
          ? new Promise<string | undefined>((resolve) => {
              answer = resolve;
            })
          : undefined;
    }

    const { instance, host } = show(Page);
    const state = (): string | null => box(host).getAttribute('data-state');

    expect(state()).toBe('valid');

    // Not a number: kept as typed so it can be corrected, and said to be
    // wrong by the field rather than erased.
    type(box(host), 'twelve');
    leave(box(host));
    expect(box(host).value).toBe('twelve');
    expect(state()).toBe('invalid');
    expect(box(host).getAttribute('aria-invalid')).toBe('true');
    expect(error(host).textContent).toBe('Enter a number.');
    expect(field(host).getAttribute('data-state')).toBe('invalid');

    // Waiting on an answer, and not yet wrong: drawn as attention rather than
    // as a fault, which is what the sheet's `pending` rule is for.
    type(box(host), '13');
    leave(box(host));
    expect(state()).toBe('pending');
    expect(box(host).getAttribute('aria-busy')).toBe('true');

    answer('Not that one.');
    await vi.waitUntil(() => error(host).textContent === 'Not that one.');
    expect(state()).toBe('invalid');

    type(box(host), '12');
    leave(box(host));
    expect(state()).toBe('valid');
    expect(error(host).textContent).toBe('');

    // Disabled is the platform's own attribute here, not `aria-disabled`
    // alone: the control *is* the native input, and only the attribute takes
    // it out of the form. Both buttons go with it.
    instance.off.set(true);
    flushSync();
    expect(box(host).disabled).toBe(true);
    expect(box(host).getAttribute('aria-disabled')).toBe('true');
    expect(increase(host).disabled).toBe(true);
    expect(decrease(host).disabled).toBe(true);

    instance.off.set(false);
    instance.locked.set(true);
    flushSync();
    expect(box(host).disabled).toBe(false);
    expect(box(host).readOnly).toBe(true);
    expect(box(host).getAttribute('aria-readonly')).toBe('true');
    expect(increase(host).disabled).toBe(true);
    expect(decrease(host).disabled).toBe(true);
    // And the arrows answer nothing while the value is not the user's to change.
    expect(press(box(host), 'ArrowUp').defaultPrevented).toBe(false);
    expect(box(host).value).toBe('12');
  });

  it('follows a value bound to a signal, and reports every change', () => {
    const seen: (number | null)[] = [];

    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input :value="qty" label="Quantity" name="qty" locale="en-US"
                         :onValueChange="record"></v-number-input>`,
      ),
    })
    class Page {
      qty = new Signal.State<number | null>(5);
      record = (value: number | null): void => void seen.push(value);
    }

    const { instance, host } = show(Page);
    expect(box(host).value).toBe('5');

    // A write from outside reaches the box as well as the hidden input and
    // the announced value: a spinbutton saying 42 over a box still reading 5
    // is worse than either alone.
    instance.qty.set(42);
    flushSync();
    expect(box(host).value).toBe('42');
    expect(box(host).getAttribute('aria-valuenow')).toBe('42');
    expect(hidden(host).value).toBe('42');

    // Typing moves the signal without the box being rewritten under the
    // caret: the trailing zero survives.
    type(box(host), '7.50');
    expect(instance.qty.get()).toBe(7.5);
    expect(box(host).value).toBe('7.50');

    type(box(host), '');
    expect(instance.qty.get()).toBeNull();
    expect(hidden(host).value).toBe('');
    expect(seen).toEqual([7.5, null]);
  });

  it('says what the caller says is wrong, until the box changes or they take it back', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <form>
          <v-number-input :ref="handle" label="Copies" name="copies" locale="en-US"
                          :defaultValue="3" :prop-error="problem.get()"></v-number-input>
        </form>
      `),
    })
    class Page {
      handle: VNumberInput | null = null;
      problem = new Signal.State('');
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;
    const own = instance.handle!;
    expect(box(host).getAttribute('data-state')).toBe('valid');

    // At once, rather than at the next trigger: asking for a message is asking
    // for it to be shown, and the browser refuses the submit over the same
    // sentence.
    instance.problem.set('Only two left.');
    flushSync();
    expect(error(host).textContent).toBe('Only two left.');
    expect(box(host).getAttribute('data-state')).toBe('invalid');
    expect(box(host).getAttribute('aria-invalid')).toBe('true');
    expect(submit(form)).toBe(false);

    // A verdict on the value as it stands: the next edit lets go of it, the
    // platform at once and the prop with it, so the two agree.
    type(box(host), '2');
    expect(own.error.get()).toBe('');
    expect(error(host).textContent).toBe('');
    expect(submit(form)).toBe(true);

    // The same words again are a change only once the caller's own value has
    // been cleared in between — and then they are shown.
    instance.problem.set('');
    flushSync();
    instance.problem.set('Only two left.');
    flushSync();
    expect(error(host).textContent).toBe('Only two left.');
    expect(submit(form)).toBe(false);

    // A step is an edit as much as a keystroke is: the value it was about is
    // gone either way.
    press(box(host), 'ArrowDown');
    expect(box(host).value).toBe('1');
    expect(own.error.get()).toBe('');
    expect(submit(form)).toBe(true);

    // Taken back by the caller, the field judges what is left — which here is
    // nothing.
    instance.problem.set('');
    flushSync();
    instance.problem.set('Only two left.');
    flushSync();
    instance.problem.set('');
    flushSync();
    expect(error(host).textContent).toBe('');
    expect(box(host).getAttribute('data-state')).toBe('valid');
    expect(submit(form)).toBe(true);
  });

  it('lets go of the caller’s message without judging the box ahead of its trigger', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <form>
          <v-number-input :ref="handle" label="Copies" name="copies" locale="en-US"
                          revalidateOn="blur" :defaultValue="3" :prop-error="problem.get()"></v-number-input>
        </form>
      `),
    })
    class Page {
      handle: VNumberInput | null = null;
      problem = new Signal.State('');
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;

    instance.problem.set('Only two left.');
    flushSync();
    expect(error(host).textContent).toBe('Only two left.');

    // The platform lets go at once, so the next submit is not refused on the
    // old value's account, and so does the prop. What is on screen stays until
    // the box is left, as any verdict does under `revalidateOn="blur"`: the
    // prop letting go is the edit's doing, and is not a second request to
    // judge the box now.
    type(box(host), '2');
    expect(instance.handle!.error.get()).toBe('');
    expect(box(host).validationMessage).toBe('');
    expect(error(host).textContent).toBe('Only two left.');
    expect(box(host).getAttribute('data-state')).toBe('invalid');

    leave(box(host));
    expect(error(host).textContent).toBe('');
    expect(box(host).getAttribute('data-state')).toBe('valid');
    expect(submit(form)).toBe(true);
  });

  it('shows a message written on the tag from the first frame', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input label="Copies" locale="en-US" :defaultValue="3" error="Sold out."></v-number-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // On screen and in the platform both, before anything has changed: a
    // message that waited for its first change would never come for one
    // written once and left.
    expect(error(host).textContent).toBe('Sold out.');
    expect(box(host).getAttribute('data-state')).toBe('invalid');
    expect(box(host).validationMessage).toBe('Sold out.');
  });

  it('refuses the submit for the reason on screen, in the words it was given', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <form>
          <v-number-input label="Quantity" name="qty" locale="en-US" required
                          :max="10" :clampOnBlur="false" :labels="wording"></v-number-input>
        </form>
      `),
    })
    class Page {
      wording = {
        valueMissing: 'How many?',
        tooLarge: (max: string): string => `No more than ${max}.`,
        increase: 'More',
        decrease: 'Fewer',
      };
    }

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    expect(box(host).required).toBe(true);
    expect(box(host).getAttribute('aria-required')).toBe('true');
    expect(increase(host).getAttribute('aria-label')).toBe('More');
    expect(decrease(host).getAttribute('aria-label')).toBe('Fewer');

    expect(submit(form)).toBe(false);
    expect(box(host).getAttribute('data-state')).toBe('invalid');
    expect(error(host).textContent).toBe('How many?');

    // Left where it was typed rather than pulled back to 10, since clamping
    // was turned off — and reported instead, in the caller's words.
    type(box(host), '50');
    leave(box(host));
    expect(box(host).value).toBe('50');
    expect(submit(form)).toBe(false);
    expect(error(host).textContent).toBe('No more than 10.');

    // Judged again by the next submit, on what the box holds by then.
    type(box(host), '3');
    expect(submit(form)).toBe(true);
    expect(box(host).getAttribute('data-state')).toBe('valid');
    expect(error(host).textContent).toBe('');
    expect(new FormData(form).get('qty')).toBe('3');
  });

  it('judges a correction made in one keystroke on what the box now says', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <form>
          <v-number-input label="Quantity" name="qty" locale="en-US"></v-number-input>
        </form>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const form = host.querySelector('form')!;

    type(box(host), 'x');
    expect(submit(form)).toBe(false);
    expect(error(host).textContent).toBe('Enter a number.');

    // One backspace. The field is told of the edit before the number has
    // read the box, so the check it runs then is a check on "x" — and its
    // verdict goes into the platform, which refuses the submit before any
    // `submit` listener could ask again. Leaving the box moves no text and so
    // asks nothing either: a press on the submit button would be refused, for
    // a box that is empty and allowed to be.
    type(box(host), '');
    expect(error(host).textContent).toBe('');
    expect(box(host).validationMessage).toBe('');
    leave(box(host));
    expect(form.checkValidity()).toBe(true);

    // Replaced whole, the same way.
    type(box(host), 'abc');
    expect(submit(form)).toBe(false);
    type(box(host), '5');
    expect(error(host).textContent).toBe('');
    expect(form.checkValidity()).toBe(true);
    expect(new FormData(form).get('qty')).toBe('5');
  });

  it('says nothing about what is typed before the first submit', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <form>
          <v-number-input label="Quantity" name="qty" locale="en-US" :max="10"></v-number-input>
        </form>
      `),
    })
    class Page {}

    const { host } = show(Page);

    // `validateOn` is `submit` by default: a field that called every
    // half-typed number wrong would be wrong about most of them.
    type(box(host), 'abc');
    type(box(host), '50');
    expect(error(host).textContent).toBe('');
    expect(box(host).getAttribute('data-state')).toBe('valid');
    expect(box(host).hasAttribute('aria-invalid')).toBe(false);
  });

  it('pulls a typed value back into range when the field is left', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input label="Quantity" locale="en-US" :min="1" :max="10"></v-number-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);
    type(box(host), '50');
    leave(box(host));
    expect(box(host).value).toBe('10');
    expect(box(host).getAttribute('aria-valuenow')).toBe('10');

    // Enter settles the text the same way, and is left to the form so that it
    // still submits — with the settled number rather than the half-typed one.
    type(box(host), '0');
    expect(press(box(host), 'Enter').defaultPrevented).toBe(false);
    expect(box(host).value).toBe('1');
    expect(hidden(host).value).toBe('1');
  });

  it('treats the step as a constraint only when told to', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <form>
          <v-number-input label="Whole" name="whole" locale="en-US" :step="1" enforceStep></v-number-input>
          <v-number-input label="Any" name="any" locale="en-US" :step="1"></v-number-input>
        </form>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const form = host.querySelector('form')!;
    const [whole, any] = [...host.querySelectorAll<HTMLInputElement>('input[type="text"]')];
    const [wholeError, anyError] = [...host.querySelectorAll('.volt-field-error')];

    type(whole!, '1.5');
    type(any!, '1.5');
    expect(submit(form)).toBe(false);
    // A native number input rejects "1.5" against its default step of 1,
    // which is the single most complained-about thing it does. Here a step is
    // how far the arrows move unless the caller says it is a rule.
    expect(wholeError!.textContent).toBe('Enter a number in steps of 1.');
    expect(anyError!.textContent).toBe('');
  });

  it('asks for the keypad the step implies, and shows the placeholder', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <div>
          <v-number-input label="Whole" :step="1" placeholder="0"></v-number-input>
          <v-number-input label="Halves" :step="0.5"></v-number-input>
        </div>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const [whole, halves] = [...host.querySelectorAll<HTMLInputElement>('input[type="text"]')];

    expect(whole!.getAttribute('inputmode')).toBe('numeric');
    expect(whole!.getAttribute('placeholder')).toBe('0');
    expect(halves!.getAttribute('inputmode')).toBe('decimal');
    // The browser has nothing useful to offer a spinbutton, and a dropdown
    // over one swallows the arrow keys.
    expect(whole!.getAttribute('autocomplete')).toBe('off');
  });

  it('reads a number written as an attribute, and goes back to it on a reset', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <form>
          <v-number-input label="Quantity" name="qty" locale="en-US"
                          defaultValue="7" min="1" max="9" step="2" largeStep="4"></v-number-input>
        </form>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const form = host.querySelector('form')!;
    const value = (): string | null => box(host).getAttribute('aria-valuenow');

    // An attribute arrives as its spelling, and a step that was the string
    // "2" would add itself to the value as text.
    expect(box(host).value).toBe('7');
    expect(new FormData(form).get('qty')).toBe('7');
    press(box(host), 'ArrowUp');
    expect(value()).toBe('9');
    press(box(host), 'ArrowUp');
    expect(value()).toBe('9');
    expect(box(host).getAttribute('aria-valuemin')).toBe('1');

    // The ends are values the field lands on, so they have to be numbers as
    // well: a maximum of "9", once the value is pulled back to it, is "9-2"
    // one step down, and a minimum of "1" is "12" one step up.
    press(box(host), 'ArrowDown');
    expect(value()).toBe('7');
    press(box(host), 'Home');
    expect(value()).toBe('1');
    press(box(host), 'ArrowUp');
    expect(value()).toBe('3');
    press(box(host), 'End');
    press(box(host), 'ArrowDown');
    expect(value()).toBe('7');

    // And so does the large step, which "4" would add to 3 as "34".
    press(box(host), 'PageDown');
    expect(value()).toBe('3');
    press(box(host), 'PageUp');
    expect(value()).toBe('7');

    form.reset();
    flushSync();
    expect(box(host).value).toBe('7');
    expect(new FormData(form).get('qty')).toBe('7');
  });

  it('validates when it was told to, and again when it was told to', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <v-number-input label="Guess" locale="en-US" validateOn="blur" revalidateOn="blur"
                        :validate="check"></v-number-input>
      `),
    })
    class Page {
      check = (value: string | null): string | undefined => (value === '7' ? undefined : 'Guess again.');
    }

    const { host } = show(Page);
    const state = (): string | null => box(host).getAttribute('data-state');

    // Nothing is wrong before the trigger says so.
    type(box(host), '3');
    expect(state()).toBe('valid');

    leave(box(host));
    expect(state()).toBe('invalid');
    expect(error(host).textContent).toBe('Guess again.');

    // `revalidateOn="blur"`, so the correction does not clear it until the
    // user leaves again.
    type(box(host), '7');
    expect(state()).toBe('invalid');

    leave(box(host));
    expect(state()).toBe('valid');
    expect(error(host).textContent).toBe('');
  });

  it('draws a label and a line of help written as markup', () => {
    @Component({
      selector: 'v-page2',
      imports: [VNumberInput],
      render: compileTemplate(`
        <v-number-input>
          <template :slot-label>Quantity <abbr title="required">*</abbr></template>
          <template :slot-description>See the <a href="/limits">order limits</a>.</template>
        </v-number-input>
      `),
    })
    class Page2 {}

    const { host } = show(Page2);

    expect(label(host).querySelector('abbr')?.getAttribute('title')).toBe('required');
    expect(label(host).textContent).toContain('Quantity');
    expect(hint(host).querySelector('a')?.getAttribute('href')).toBe('/limits');
    // Still the elements the field points at, whatever was written into them.
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
    expect(box(host).getAttribute('aria-describedby')).toContain(hint(host).id);
  });

  it('follows words that change', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input :label="words.get()" :description="help.get()"></v-number-input>`,
      ),
    })
    class Page {
      words = new Signal.State('Quantity');
      help = new Signal.State('Up to 99.');
    }

    const { instance, host } = show(Page);
    expect(label(host).textContent).toBe('Quantity');
    expect(hint(host).textContent).toBe('Up to 99.');

    instance.words.set('Copies');
    instance.help.set('Up to 9.');
    flushSync();
    expect(label(host).textContent).toBe('Copies');
    expect(hint(host).textContent).toBe('Up to 9.');
  });

  it('adds what the caller says about the control to what the field says', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <span id="heading">Seats</span>
        <span id="rules">Whole numbers only.</span>
        <v-number-input label="Seats" aria-labelledby="heading"
                        :aria-describedby="extra.get()"></v-number-input>
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

  it('follows a name from elsewhere that changes, and goes back to its label without one', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <span id="seats">Seats</span>
        <span id="guests">Guests</span>
        <v-number-input label="How many" :aria-labelledby="from.get()"></v-number-input>
      `),
    })
    class Page {
      from = new Signal.State('seats');
    }

    const { instance, host } = show(Page);
    expect(box(host).getAttribute('aria-labelledby')).toBe('seats');

    // A table whose heading row is chosen later, or a step in a wizard that
    // renames the question: the box is named by whatever the caller now says.
    instance.from.set('guests');
    flushSync();
    expect(box(host).getAttribute('aria-labelledby')).toBe('guests');

    // An id still to be chosen names nothing, so the field's own label is
    // the name again rather than a reference to no element.
    instance.from.set('');
    flushSync();
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
  });

  it('follows a requirement that changes, on the box and in the submit', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <form>
          <v-number-input label="Quantity" name="qty" locale="en-US"
                          :required="needed.get()"></v-number-input>
        </form>
      `),
    })
    class Page {
      needed = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;
    expect(box(host).required).toBe(false);
    expect(submit(form)).toBe(true);

    // Required from a choice made elsewhere on the form — a box ticked for
    // delivery, say. The platform refuses an empty box from then on, and the
    // field says why.
    instance.needed.set(true);
    flushSync();
    expect(box(host).required).toBe(true);
    expect(box(host).getAttribute('aria-required')).toBe('true');
    expect(submit(form)).toBe(false);
    expect(error(host).textContent).not.toBe('');

    instance.needed.set(false);
    flushSync();
    expect(box(host).required).toBe(false);
    expect(box(host).hasAttribute('aria-required')).toBe(false);
    expect(submit(form)).toBe(true);
  });

  it('lets a name the caller wrote be the name the box has, and takes its label back after', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input label="Seats" :aria-label="named.get()"></v-number-input>`,
      ),
    })
    class Page {
      named = new Signal.State<string | undefined>('Seats to book');
    }

    const { instance, host } = show(Page);

    // `aria-labelledby` outranks `aria-label` wherever an accessible name is
    // computed, so the field stands its own reference down. The `for` stays:
    // a press on the words still puts the caret in the box.
    expect(box(host).getAttribute('aria-label')).toBe('Seats to book');
    expect(box(host).hasAttribute('aria-labelledby')).toBe(false);
    expect(label(host).getAttribute('for')).toBe(box(host).id);

    instance.named.set(undefined);
    flushSync();
    expect(box(host).hasAttribute('aria-label')).toBe(false);
    expect(box(host).getAttribute('aria-labelledby')).toBe(label(host).id);
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page3',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input :ref="handle" label="Quantity" locale="en-US" :min="0" :max="5"></v-number-input>`,
      ),
    })
    class Page3 {
      handle: VNumberInput | null = null;
    }

    const { instance, host } = show(Page3);
    const qty = instance.handle!.number;
    expect(qty.value()).toBeNull();
    expect(qty.canDecrement()).toBe(true);

    // Clamped and formatted, the way everything but typing is.
    qty.setValue(9);
    flushSync();
    expect(box(host).value).toBe('5');
    expect(qty.canIncrement()).toBe(false);

    qty.decrement();
    flushSync();
    expect(box(host).value).toBe('4');

    qty.field.setCustomValidity('Sold out.');
    flushSync();
    expect(error(host).textContent).toBe('Sold out.');
    expect(box(host).getAttribute('data-state')).toBe('invalid');

    qty.clear();
    flushSync();
    expect(box(host).value).toBe('');
    expect(box(host).hasAttribute('aria-valuenow')).toBe(false);
  });

  it('lands a class, an id and a name written on the tag on the spinbutton, and nowhere else', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input class="mine" id="qty" aria-label="Quantity to order"
                         label="Quantity"></v-number-input>`,
      ),
    })
    class Page {}

    const { host } = show(Page);
    const spin = host.querySelector('[role="spinbutton"]')!;

    // The element with the role is the one a caller is talking about: the
    // row and the field around it are layout, and the hidden input is never
    // seen.
    expect(spin).toBe(box(host));
    expect(spin.classList.contains('mine')).toBe(true);
    expect(spin.id).toBe('qty');
    expect(spin.getAttribute('aria-label')).toBe('Quantity to order');
    expect(host.querySelectorAll('.mine')).toHaveLength(1);
    expect(host.querySelectorAll('#qty')).toHaveLength(1);
    expect(host.querySelectorAll('[aria-label="Quantity to order"]')).toHaveLength(1);
  });

  it('takes a disabled field out of the form, number and all', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <form>
          <v-number-input label="Quantity" name="qty" locale="en-US" :defaultValue="5"
                          :disabled="off.get()" :readOnly="locked.get()"></v-number-input>
        </form>
      `),
    })
    class Page {
      off = new Signal.State(true);
      locked = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;

    // The number submits from the hidden input, not the box, so the box's
    // own `disabled` takes nothing out of the request by itself.
    expect(box(host).disabled).toBe(true);
    expect(hidden(host).disabled).toBe(true);
    expect(new FormData(form).has('qty')).toBe(false);

    instance.off.set(false);
    flushSync();
    expect(hidden(host).disabled).toBe(false);
    expect(new FormData(form).get('qty')).toBe('5');

    // A read-only control submits: its value is the user's to see, not to
    // change, and it is still part of the form.
    instance.locked.set(true);
    flushSync();
    expect(hidden(host).disabled).toBe(false);
    expect(new FormData(form).get('qty')).toBe('5');
  });

  it('lets the caller say how the value is read out', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <div>
          <v-number-input class="fixed" :value="guests" label="Guests" locale="en-US"
                          aria-valuetext="A party"></v-number-input>
          <v-number-input class="bound" :value="guests" label="Guests" locale="en-US"
                          :aria-valuetext="spoken.get()"></v-number-input>
        </div>
      `),
    })
    class Page {
      guests = new Signal.State<number | null>(5);
      spoken = new Signal.State<string | undefined>('5 guests');
    }

    const { instance, host } = show(Page);
    const fixed = host.querySelector<HTMLInputElement>('input.fixed')!;
    const bound = host.querySelector<HTMLInputElement>('input.bound')!;

    expect(fixed.getAttribute('aria-valuetext')).toBe('A party');
    expect(bound.getAttribute('aria-valuetext')).toBe('5 guests');

    // At a value whose spelling the field would read out itself, and back at
    // one where it would say nothing: the caller's words stand through both,
    // rather than being written over and then taken away.
    instance.guests.set(1234);
    instance.spoken.set('1234 guests');
    flushSync();
    expect(fixed.getAttribute('aria-valuetext')).toBe('A party');
    expect(bound.getAttribute('aria-valuetext')).toBe('1234 guests');

    instance.guests.set(6);
    flushSync();
    expect(fixed.getAttribute('aria-valuetext')).toBe('A party');

    // Nothing said is the field's own spelling again.
    instance.guests.set(1234);
    instance.spoken.set(undefined);
    flushSync();
    expect(bound.getAttribute('aria-valuetext')).toBe('1,234');
    expect(bound.getAttribute('aria-valuenow')).toBe('1234');
  });

  it('reads a flag written as an attribute the way it was meant', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <form>
          <v-number-input label="Any" name="any" locale="en-US" :step="1" enforceStep="false"></v-number-input>
          <v-number-input label="Capped" name="capped" locale="en-US" :max="10"
                          clampOnBlur="false"></v-number-input>
        </form>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const form = host.querySelector('form')!;
    const [any, capped] = [...host.querySelectorAll<HTMLInputElement>('input[type="text"]')];
    const [anyError, cappedError] = [...host.querySelectorAll('.volt-field-error')];

    // An attribute arrives as its spelling, and the string "false" is truthy:
    // read as written, `enforceStep="false"` would enforce the step and
    // `clampOnBlur="false"` would clamp.
    type(any!, '1.5');
    type(capped!, '50');
    leave(capped!);
    expect(capped!.value).toBe('50');
    expect(submit(form)).toBe(false);
    expect(anyError!.textContent).toBe('');
    expect(cappedError!.textContent).toBe('Enter a number no larger than 10.');
  });

  it('says a message handed over while the field was out of use once it is back', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <form>
          <v-number-input :ref="handle" label="Copies" name="copies" locale="en-US" :defaultValue="3"
                          :disabled="off.get()" :readOnly="locked.get()"
                          :prop-error="problem.get()"></v-number-input>
        </form>
      `),
    })
    class Page {
      handle: VNumberInput | null = null;
      off = new Signal.State(false);
      locked = new Signal.State(false);
      problem = new Signal.State('');
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;

    // A page that takes the field out of use while it asks a server, and
    // hears back before handing it over again. Nothing is judged while it is
    // out, so nothing is shown yet.
    instance.off.set(true);
    flushSync();
    instance.problem.set('Only two left.');
    flushSync();
    expect(error(host).textContent).toBe('');

    // Back, the refusal is on screen and in the platform at once, rather than
    // waiting for a submit the user has no reason to make.
    instance.off.set(false);
    flushSync();
    expect(error(host).textContent).toBe('Only two left.');
    expect(box(host).validationMessage).toBe('Only two left.');
    expect(box(host).getAttribute('data-state')).toBe('invalid');

    // Read-only is out of use the same way.
    instance.problem.set('');
    flushSync();
    instance.locked.set(true);
    flushSync();
    instance.problem.set('Only one left.');
    flushSync();
    expect(error(host).textContent).toBe('');
    instance.locked.set(false);
    flushSync();
    expect(error(host).textContent).toBe('Only one left.');

    // One an edit let go of stays gone.
    type(box(host), '2');
    leave(box(host));
    expect(instance.handle!.error.get()).toBe('');
    instance.off.set(true);
    flushSync();
    instance.off.set(false);
    flushSync();
    expect(error(host).textContent).toBe('');
    expect(submit(form)).toBe(true);
  });

  it('does not judge the box for coming back into use', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <v-number-input label="Copies" locale="en-US" validateOn="blur" revalidateOn="blur"
                        :disabled="off.get()"></v-number-input>
      `),
    })
    class Page {
      off = new Signal.State(false);
    }

    const { instance, host } = show(Page);

    type(box(host), 'abc');
    leave(box(host));
    expect(error(host).textContent).toBe('Enter a number.');

    // Corrected, and waiting on `revalidateOn` to say so. A message is said
    // again when the field comes back, but only one of the caller's: with
    // none standing, coming back is not a trigger the caller chose, and the
    // verdict waits for the one they did.
    type(box(host), '5');
    instance.off.set(true);
    flushSync();
    instance.off.set(false);
    flushSync();
    expect(error(host).textContent).toBe('Enter a number.');

    leave(box(host));
    expect(error(host).textContent).toBe('');
  });

  it('lets go of the caller’s message on a reset, the prop with it', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`
        <form>
          <v-number-input :ref="handle" label="Copies" name="copies" locale="en-US" :defaultValue="3"
                          :disabled="off.get()" :prop-error="problem.get()"></v-number-input>
        </form>
      `),
    })
    class Page {
      handle: VNumberInput | null = null;
      off = new Signal.State(false);
      problem = new Signal.State('');
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;

    instance.problem.set('Only two left.');
    flushSync();
    expect(error(host).textContent).toBe('Only two left.');

    // The box already holds its default, so the reset moves no text — and
    // the field forgets the message all the same. The prop follows, so the
    // two agree and nothing brings the message back later.
    form.reset();
    flushSync();
    expect(error(host).textContent).toBe('');
    expect(instance.handle!.error.get()).toBe('');
    expect(submit(form)).toBe(true);

    instance.off.set(true);
    flushSync();
    instance.off.set(false);
    flushSync();
    expect(error(host).textContent).toBe('');

    // A reset a listener called off put nothing back, and the message stands.
    instance.problem.set('');
    flushSync();
    instance.problem.set('Only two left.');
    flushSync();
    form.addEventListener('reset', (event) => event.preventDefault(), { capture: true, once: true });
    form.reset();
    flushSync();
    expect(instance.handle!.error.get()).toBe('Only two left.');
    expect(error(host).textContent).toBe('Only two left.');
  });

  it('reads an empty locale or id as unsaid', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input label="Quantity" :locale="code.get()" :id="chosen.get()" :defaultValue="5"></v-number-input>`,
      ),
    })
    class Page {
      // Neither chosen yet: a setting still loading, an id still to be made.
      code = new Signal.State('');
      chosen = new Signal.State('');
    }

    // `Intl` refuses an empty locale outright, which would take the page down
    // with it; an empty id points the label's `for` at nothing, so a press on
    // the words no longer reaches the box.
    const { host } = show(Page);
    expect(box(host).value).toBe('5');
    expect(box(host).id).not.toBe('');
    expect(label(host).getAttribute('for')).toBe(box(host).id);
  });

  it('renders every state the entry draws, from its own template', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(
        `<v-number-input :ref="handle" label="Copies" locale="en-US" :min="0" :max="2"
                         :defaultValue="1" :disabled="off.get()"></v-number-input>`,
      ),
    })
    class Page {
      handle: VNumberInput | null = null;
      off = new Signal.State(false);
    }

    const { instance } = show(Page);
    const qty = instance.handle!.number;

    // The scene in `scenes/number-input.ts` holds the entry against a copy of
    // this markup. This holds it against the markup itself, so a class or a
    // state the template stopped writing is caught here, not in a copy.
    const unmatched = new Set(
      [...numberInputStyles.rules, ...numberInputStyles.forcedColors].map((rule) =>
        rule.selector.replaceAll(':hover', '').replaceAll(':focus-visible', ''),
      ),
    );
    const look = (): void => {
      for (const selector of unmatched) if (document.querySelector(selector)) unmatched.delete(selector);
    };

    look();
    qty.setValue(2);
    flushSync();
    look();
    qty.setValue(0);
    flushSync();
    look();
    instance.off.set(true);
    flushSync();
    look();

    expect([...unmatched]).toEqual([]);
  });

});

describe('the sheet entry', () => {
  it('puts the buttons at the inline end, so they cross over in a right-to-left page', () => {
    @Component({
      selector: 'v-page',
      imports: [VNumberInput],
      render: compileTemplate(`<div dir="rtl"><v-number-input label="Quantity"></v-number-input></div>`),
    })
    class Page {}

    const { host } = show(Page);

    // The order is the markup's and the side is the writing direction's: a
    // grid lays its tracks out along the inline axis, so the box first and the
    // buttons after it is box-then-buttons in English and buttons-then-box in
    // Arabic, with no rule of its own for either. The hidden input takes no
    // track, since it is not rendered.
    const tracks = [...row(host).children].filter(
      (el) => (el as HTMLInputElement).type !== 'hidden',
    );
    expect(tracks).toEqual([box(host), decrease(host), increase(host)]);

    // A physical side anywhere in the entry would be one thing that stayed
    // put when the rest turned round.
    const physical: string[] = [];
    for (const rule of [...numberInputStyles.rules, ...numberInputStyles.forcedColors]) {
      for (const [property, value] of Object.entries(rule.declarations)) {
        if (/(^|-)(left|right|top|bottom)(-|$)/.test(property) || /\b(left|right)\b/.test(value)) {
          physical.push(`${rule.selector} { ${property}: ${value} }`);
        }
      }
    }
    expect(physical).toEqual([]);
    expect(
      numberInputStyles.rules.find((rule) => rule.selector === '.volt-number-input')?.declarations[
        'grid-template-columns'
      ],
    ).toBe('minmax(0, 1fr) auto auto');
  });
});
