/**
 * Inputs, driven through real mounted components.
 *
 * Every control here is a native `<input>` or `<textarea>` wearing a
 * component, so the first thing each section asserts is the boring one that
 * everything else depends on: put it in a plain `<form>` and the right value
 * comes out of `FormData`. A composite that only looks like a field submits
 * nothing, and no amount of ARIA on top of it helps.
 *
 * After that, the parts a consumer cannot retrofit — the keyboard map, the
 * spinbutton's numbers, where focus lands after a box is emptied, and whether
 * an `aria-*` reference points at an element that is really on the page. The
 * cases gone after by preference are the ones usually wrong rather than the
 * ones usually right: a listener or an observer left attached after unmount,
 * a value that works uncontrolled but not controlled, a locale that can format
 * but not read back what it formatted, and a horizontal keyboard that ignores
 * writing direction.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { createLocaleProvider, resolveDirection } from '../src/i18n.ts';
import {
  PIN_BOX_ATTRIBUTE,
  createInput,
  createNumberInput,
  createPasswordInput,
  createPinInput,
  createRating,
  createTagsInput,
  createTextarea,
  parseLocaleNumber,
  type InputOptions,
  type NumberInputOptions,
  type PasswordInputOptions,
  type PinInputOptions,
  type RatingOptions,
  type TagsInputOptions,
  type TextareaOptions,
} from '../src/inputs.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
/** Every component gets its own selector: two with one name cannot both register. */
let selectors = 0;

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  inputOptions = {};
  textareaOptions = {};
  numberOptions = {};
  passwordOptions = {};
  pinOptions = {};
  tagsOptions = {};
  tagsVisible = null;
  ratingOptions = {};
  FakeResizeObserver.live = [];
  FakeResizeObserver.disconnects = 0;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A keydown as the user sends one: bubbling, and cancellable. */
function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

/** Type as a user does: the element changes first, then it says so. */
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function pasteInto(target: Element, text: string): ClipboardEvent {
  const data = new DataTransfer();
  data.setData('text', text);
  const event = new ClipboardEvent('paste', {
    clipboardData: data,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

function blur(el: Element): void {
  el.dispatchEvent(new Event('blur'));
  flushSync();
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  flushSync();
}

function submitted(form: HTMLFormElement): [string, FormDataEntryValue][] {
  return [...new FormData(form).entries()];
}

/** Let a queued microtask — a reset read-back, a caret restore — run. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

/**
 * A `ResizeObserver` that delivers exactly what a test asks it to.
 *
 * happy-dom lays nothing out, so the real one would never fire, and the count
 * of disconnects is what proves the textarea lets go of its observer.
 */
class FakeResizeObserver {
  static live: FakeResizeObserver[] = [];
  static disconnects = 0;

  readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.live.push(this);
  }

  observe(el: Element): void {
    this.targets.add(el);
  }

  unobserve(el: Element): void {
    this.targets.delete(el);
  }

  disconnect(): void {
    this.targets.clear();
    FakeResizeObserver.disconnects += 1;
  }

  deliver(target: Element, width: number): void {
    this.callback(
      [{ target, contentRect: { width } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
    flushSync();
  }
}

/** A second component in the same test needs somewhere of its own to live. */
function newHost(): void {
  host = document.createElement('div');
  document.body.append(host);
}

/**
 * Make the browser say it cannot size a field to its own content.
 *
 * happy-dom answers yes to `field-sizing`, so the measuring fallback — the
 * half with an observer to leak — is unreachable without this.
 */
function withoutFieldSizing(): void {
  vi.stubGlobal('CSS', { supports: () => false });
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
}

// ---------------------------------------------------------------------------
// Text input
// ---------------------------------------------------------------------------

let inputOptions: Partial<InputOptions>;

interface TextInstance {
  text: ReturnType<typeof createInput>;
}

function textInput(markup = '') {
  @Component({
    selector: `v-text-${++selectors}`,
    render: compileTemplate(`
      <form :ref="form">
        <div :ref="wrapper" :spread="text.fieldProps()">
          <label :ref="label" :spread="text.labelProps()">Nickname</label>
          <input :ref="input" :spread="text.inputProps()"${markup}>
          <p :ref="hint" :spread="text.descriptionProps()">Anything you like.</p>
        </div>
      </form>
    `),
  })
  class TextComponent {
    form = new Signal.State<Element | null>(null);
    wrapper = new Signal.State<Element | null>(null);
    input = new Signal.State<Element | null>(null);
    label = new Signal.State<Element | null>(null);
    hint = new Signal.State<Element | null>(null);

    text = createInput({
      ...inputOptions,
      input: () => this.input.get(),
      label: () => this.label.get(),
      description: () => this.hint.get(),
    });
  }

  const handle = track(mount(TextComponent, host));
  flushSync();

  return {
    instance: handle.instance as TextInstance,
    handle,
    input: () => host.querySelector('input')!,
    label: () => host.querySelector('label')!,
    hint: () => host.querySelector('p')!,
    wrapper: () => host.querySelector('div')!,
    form: () => host.querySelector('form')!,
  };
}

describe('text input', () => {
  it('submits from a plain form, because it is a plain input', () => {
    inputOptions = { name: 'nickname', type: 'email', autoComplete: 'email' };
    const { input, form } = textInput();

    expect(input().tagName).toBe('INPUT');
    expect(input().type).toBe('email');
    expect(input().getAttribute('autocomplete')).toBe('email');

    typeInto(input(), 'ada@example.com');
    expect(submitted(form())).toEqual([['nickname', 'ada@example.com']]);
  });

  it('ties the label, the description and the control together by real ids', () => {
    const { input, label, hint } = textInput();

    // Every reference names an id something on the page actually carries; a
    // dangling one leaves the field unlabelled while looking wired up.
    expect(label().getAttribute('for')).toBe(input().id);
    expect(document.getElementById(input().getAttribute('aria-labelledby')!)).toBe(label());
    expect(document.getElementById(input().getAttribute('aria-describedby')!)).toBe(hint());
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('mirrors a signal both ways without a value prop on the element', () => {
    const value = new Signal.State('');
    inputOptions = { value };
    const { instance, input } = textInput();

    value.set('ada');
    flushSync();
    expect(input().value).toBe('ada');

    typeInto(input(), 'grace');
    expect(value.get()).toBe('grace');
    expect(instance.text.value()).toBe('grace');
  });

  it('adopts a value written in the markup rather than erasing it', () => {
    const value = new Signal.State('');
    inputOptions = { value };
    const { input } = textInput(' value="ada"');

    // An empty signal is the absence of an instruction, not an instruction to
    // clear the box the consumer filled in.
    expect(input().value).toBe('ada');
    expect(value.get()).toBe('ada');
  });

  it('follows a form reset, which fires no input event', async () => {
    inputOptions = { name: 'nickname' };
    const { instance, input, form } = textInput();

    typeInto(input(), 'grace');
    form().reset();
    await settle();

    expect(input().value).toBe('');
    expect(instance.text.value()).toBe('');
  });

  it('lets go of the control when the component unmounts', () => {
    const value = new Signal.State('ada');
    inputOptions = { value };
    const { handle, input } = textInput();
    const el = input();

    handle.unmount();
    flushSync();

    // A listener left on a detached control keeps the signal alive with it,
    // which is a leak the consumer has no way to see.
    el.value = 'someone else';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(value.get()).toBe('ada');
  });

  it('counts what is left by characters, not by code units', () => {
    inputOptions = { maxLength: 4 };
    const { instance, input } = textInput();

    expect(input().getAttribute('maxlength')).toBe('4');
    typeInto(input(), '👍👍');
    // Two thumbs are two characters to a person and four to `String#length`.
    expect(instance.text.remaining()).toBe(2);
  });

  it('reports emptiness for CSS without a class from the consumer', () => {
    const { input } = textInput();
    expect(input().hasAttribute('data-empty')).toBe(true);

    typeInto(input(), 'x');
    expect(input().hasAttribute('data-empty')).toBe(false);
  });

  it('puts the field state on the wrapper, so styling needs no class of its own', () => {
    const { input, wrapper } = textInput();

    expect(wrapper().getAttribute('data-state')).toBe('valid');
    expect(wrapper().hasAttribute('data-dirty')).toBe(false);

    typeInto(input(), 'ada');
    expect(wrapper().hasAttribute('data-dirty')).toBe(true);
  });

  it('leaves required alone unless it was told about it', () => {
    const { input } = textInput();
    // `() => false` for an option nobody supplied would wipe a `required` the
    // consumer wrote in their own markup.
    expect(input().required).toBe(false);
    expect(input().hasAttribute('aria-required')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Textarea
// ---------------------------------------------------------------------------

let textareaOptions: Partial<TextareaOptions>;

interface TextareaInstance {
  area: ReturnType<typeof createTextarea>;
}

function textarea() {
  @Component({
    selector: `v-area-${++selectors}`,
    render: compileTemplate(`
      <form>
        <label :ref="label" :spread="area.labelProps()">Bio</label>
        <textarea :ref="input" :spread="area.textareaProps()"></textarea>
      </form>
    `),
  })
  class AreaComponent {
    input = new Signal.State<Element | null>(null);
    label = new Signal.State<Element | null>(null);

    area = createTextarea({
      ...textareaOptions,
      input: () => this.input.get(),
      label: () => this.label.get(),
    });
  }

  const handle = track(mount(AreaComponent, host));
  flushSync();

  return {
    instance: handle.instance as TextareaInstance,
    handle,
    area: () => host.querySelector('textarea')!,
    form: () => host.querySelector('form')!,
  };
}

describe('textarea', () => {
  it('submits from a plain form, because it is a plain textarea', () => {
    textareaOptions = { name: 'bio', rows: 4 };
    const { area, form } = textarea();

    expect(area().tagName).toBe('TEXTAREA');
    expect(area().getAttribute('rows')).toBe('4');

    typeInto(area(), 'Two lines\nof it');
    expect(submitted(form())).toEqual([['bio', 'Two lines\nof it']]);
  });

  it('asks the browser to size itself, and cleans the declaration up after', () => {
    textareaOptions = { maxRows: 3 };
    const { area, handle } = textarea();
    const el = area();

    // One declaration beats measuring: the browser then re-sizes on the edits
    // no listener sees — autofill, undo, an IME commit.
    expect(el.style.getPropertyValue('field-sizing')).toBe('content');
    // `lh` says the cap in the unit the author thinks in.
    expect(el.style.getPropertyValue('max-height')).toBe('3lh');

    handle.unmount();
    flushSync();
    expect(el.style.getPropertyValue('field-sizing')).toBe('');
  });

  it('writes no style at all when auto-sizing is declined', () => {
    textareaOptions = { autoSize: false };
    const { area } = textarea();
    expect(area().getAttribute('style')).toBeNull();
  });

  it('measures where the browser cannot, and lets go of the observer', () => {
    withoutFieldSizing();

    const { area, handle } = textarea();
    const el = area();
    Object.defineProperty(el, 'scrollHeight', { value: 48, configurable: true });

    typeInto(el, 'grown');
    expect(el.style.height).toBe('48px');
    // Uncapped, so it must never show a scrollbar it does not need.
    expect(el.style.overflowY).toBe('hidden');

    expect(FakeResizeObserver.live).toHaveLength(1);
    handle.unmount();
    flushSync();
    // An observer that outlives its element pins the element in memory.
    expect(FakeResizeObserver.disconnects).toBe(1);
  });

  it('re-measures for a width change, and ignores the height it wrote itself', () => {
    withoutFieldSizing();

    const { area } = textarea();
    const el = area();
    const observer = FakeResizeObserver.live[0]!;

    Object.defineProperty(el, 'scrollHeight', { value: 20, configurable: true });
    observer.deliver(el, 300);
    expect(el.style.height).toBe('20px');

    // Reacting to its own height would be a measuring loop that never settles,
    // so the same width twice must change nothing.
    Object.defineProperty(el, 'scrollHeight', { value: 90, configurable: true });
    observer.deliver(el, 300);
    expect(el.style.height).toBe('20px');

    observer.deliver(el, 500);
    expect(el.style.height).toBe('90px');
  });

  it('refuses to measure a box that is not being rendered', () => {
    withoutFieldSizing();

    const { area, instance } = textarea();
    const el = area();
    Object.defineProperty(el, 'scrollHeight', { value: 20, configurable: true });
    instance.area.resize();
    expect(el.style.height).toBe('20px');

    Object.defineProperty(el, 'checkVisibility', { value: () => false, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 0, configurable: true });
    instance.area.resize();

    // A textarea nobody is rendering reports a scrollHeight of 0, and writing
    // that back collapses the box the moment it is shown again.
    expect(el.style.height).toBe('20px');
  });
});

// ---------------------------------------------------------------------------
// Number input
// ---------------------------------------------------------------------------

let numberOptions: Partial<NumberInputOptions>;

interface NumberInstance {
  num: ReturnType<typeof createNumberInput>;
  handled: boolean;
}

function numberInput(markup = '') {
  @Component({
    selector: `v-num-${++selectors}`,
    render: compileTemplate(`
      <form :ref="form">
        <div :spread="num.fieldProps()">
          <label :ref="label" :spread="num.labelProps()">Quantity</label>
          <input :ref="input" :spread="num.inputProps()"${markup}
                 :keydown="onKey($event)" :blur="num.onBlur()">
          <input class="hidden" :spread="num.hiddenInputProps()">
          <button class="dec" :spread="num.decrementProps()" :click="num.decrement()">-</button>
          <button class="inc" :spread="num.incrementProps()" :click="num.increment()">+</button>
        </div>
      </form>
    `),
  })
  class NumberComponent {
    form = new Signal.State<Element | null>(null);
    input = new Signal.State<Element | null>(null);
    label = new Signal.State<Element | null>(null);
    handled = false;

    num = createNumberInput({
      ...numberOptions,
      input: () => this.input.get(),
      label: () => this.label.get(),
    });

    onKey(event: KeyboardEvent): void {
      this.handled = this.num.onKeyDown(event);
    }
  }

  const handle = track(mount(NumberComponent, host));
  flushSync();

  return {
    instance: handle.instance as unknown as NumberInstance,
    handle,
    input: () => host.querySelector('input')!,
    hidden: () => host.querySelector<HTMLInputElement>('.hidden')!,
    increase: () => host.querySelector<HTMLButtonElement>('.inc')!,
    decrease: () => host.querySelector<HTMLButtonElement>('.dec')!,
    form: () => host.querySelector('form')!,
  };
}

describe('number input', () => {
  it('is a spinbutton over a text box, with the numbers ARIA asks for', () => {
    numberOptions = { min: 0, max: 10, defaultValue: 4 };
    const { input } = numberInput();

    // `type="number"` cannot hold a locale-formatted value, so the role is
    // said rather than inherited.
    expect(input().type).toBe('text');
    expect(input().getAttribute('role')).toBe('spinbutton');
    expect(input().getAttribute('aria-valuenow')).toBe('4');
    expect(input().getAttribute('aria-valuemin')).toBe('0');
    expect(input().getAttribute('aria-valuemax')).toBe('10');
    // A dropdown over a spinbutton swallows the arrow keys it needs.
    expect(input().getAttribute('autocomplete')).toBe('off');
  });

  it('says nothing about a value nobody has entered', () => {
    const { input } = numberInput();
    // A zero here would announce a number the user never typed.
    expect(input().hasAttribute('aria-valuenow')).toBe(false);
    expect(input().value).toBe('');
  });

  it('reads the formatted spelling out only when it differs from the number', () => {
    numberOptions = { locale: 'en-US', defaultValue: 1234.56 };
    const { input } = numberInput();

    expect(input().value).toBe('1,234.56');
    expect(input().getAttribute('aria-valuenow')).toBe('1234.56');
    expect(input().getAttribute('aria-valuetext')).toBe('1,234.56');

    numberOptions = { locale: 'en-US', defaultValue: 7 };
    newHost();
    const plain = numberInput();
    // "7" twice over is one announcement too many.
    expect(plain.input().hasAttribute('aria-valuetext')).toBe(false);
  });

  it('submits the canonical number, whatever the box spells', () => {
    numberOptions = { locale: 'de-DE', name: 'qty', defaultValue: 1234.56 };
    const { input, hidden, form } = numberInput();

    expect(input().value).toBe('1.234,56');
    expect(hidden().type).toBe('hidden');
    // A server parses a number, not a locale's punctuation.
    expect(submitted(form())).toEqual([['qty', '1234.56']]);
  });

  it('reads back what the locale writes, which is the half usually missing', () => {
    numberOptions = { locale: 'de-DE', name: 'qty' };
    const { instance, input, hidden } = numberInput();

    typeInto(input(), '1.234,56');
    blur(input());
    // In German this is one thousand two hundred and thirty-four, and to a
    // naive `parseFloat` it is 1.234.
    expect(instance.num.value()).toBe(1234.56);
    expect(hidden().value).toBe('1234.56');
    expect(input().value).toBe('1.234,56');
  });

  it('reads the same number written the English way', () => {
    numberOptions = { locale: 'en-US' };
    const { instance, input } = numberInput();

    typeInto(input(), '1,234.56');
    blur(input());
    expect(instance.num.value()).toBe(1234.56);
  });

  it('does not rewrite the box under the caret while it is being typed into', () => {
    numberOptions = { locale: 'en-US' };
    const { instance, input } = numberInput();

    typeInto(input(), '1234.5');
    // Reformatting on every keystroke is what makes a formatted number field
    // unusable; the value follows the text, and the text is left alone.
    expect(input().value).toBe('1234.5');
    expect(instance.num.value()).toBe(1234.5);
  });

  it('moves by a step with the arrows and by a larger one with the pages', () => {
    numberOptions = { defaultValue: 5, step: 1, largeStep: 10 };
    const { instance, input } = numberInput();

    expect(press(input(), 'ArrowUp').defaultPrevented).toBe(true);
    expect(instance.num.value()).toBe(6);
    press(input(), 'ArrowDown');
    press(input(), 'ArrowDown');
    expect(instance.num.value()).toBe(4);

    press(input(), 'PageUp');
    expect(instance.num.value()).toBe(14);
    press(input(), 'PageDown');
    expect(instance.num.value()).toBe(4);
  });

  it('takes ten steps for a page when it was not told otherwise', () => {
    numberOptions = { defaultValue: 0, step: 0.5 };
    const { instance, input } = numberInput();

    press(input(), 'PageUp');
    expect(instance.num.value()).toBe(5);
  });

  it('jumps to the ends with Home and End, and leaves them alone without a range', () => {
    numberOptions = { min: 1, max: 9, defaultValue: 4 };
    const { instance, input } = numberInput();

    press(input(), 'End');
    expect(instance.num.value()).toBe(9);
    press(input(), 'Home');
    expect(instance.num.value()).toBe(1);

    numberOptions = { defaultValue: 4 };
    newHost();
    const open = numberInput();
    // With no range there is nowhere to jump to, so the document keeps the key.
    expect(press(open.input(), 'End').defaultPrevented).toBe(false);
    expect(open.instance.handled).toBe(false);
    // Both ends, or the one without a test jumps to `undefined` and the box
    // reads NaN.
    expect(press(open.input(), 'Home').defaultPrevented).toBe(false);
    expect(open.instance.handled).toBe(false);
    expect(open.instance.num.value()).toBe(4);
  });

  it('clamps what the arrows and the box can reach', () => {
    numberOptions = { min: 0, max: 10, defaultValue: 10 };
    const { instance, input } = numberInput();

    press(input(), 'ArrowUp');
    expect(instance.num.value()).toBe(10);

    typeInto(input(), '50');
    blur(input());
    expect(instance.num.value()).toBe(10);
    expect(input().value).toBe('10');
  });

  it('clamps at the bottom of the range as well as the top', () => {
    numberOptions = { min: 0, max: 10, defaultValue: 0 };
    const { instance, input } = numberInput();

    press(input(), 'ArrowDown');
    expect(instance.num.value()).toBe(0);

    typeInto(input(), '-5');
    blur(input());
    expect(instance.num.value()).toBe(0);
    expect(input().value).toBe('0');
  });

  it('leaves an out-of-range value alone when asked, and reports it instead', () => {
    numberOptions = { min: 0, max: 10, clampOnBlur: false };
    const { instance, input } = numberInput();

    typeInto(input(), '50');
    blur(input());
    expect(instance.num.value()).toBe(50);

    instance.num.field.report();
    flushSync();
    expect(instance.num.field.messages()).toEqual(['Enter a number no larger than 10.']);
  });

  it('keeps text that is not a number, and says why rather than erasing it', () => {
    const { instance, input } = numberInput();

    typeInto(input(), 'twelve');
    blur(input());
    // Erased, the user cannot see what was rejected or fix it.
    expect(input().value).toBe('twelve');
    expect(instance.num.value()).toBeNull();

    instance.num.field.report();
    flushSync();
    expect(instance.num.field.messages()).toEqual(['Enter a number.']);
  });

  it('starts from the end of the range rather than a step away from nothing', () => {
    numberOptions = { min: 3, max: 9 };
    const { instance, input } = numberInput();

    press(input(), 'ArrowUp');
    expect(instance.num.value()).toBe(3);
  });

  it('adds a tenth to a tenth and gets two tenths', () => {
    numberOptions = { step: 0.1, defaultValue: 0.1, locale: 'en-US' };
    const { instance, input } = numberInput();

    press(input(), 'ArrowUp');
    // 0.1 + 0.2 is 0.30000000000000004 in a quantity field nobody wants.
    expect(instance.num.value()).toBe(0.2);
    expect(input().value).toBe('0.2');
  });

  it('leaves a modified key to whatever shortcut owns it', () => {
    numberOptions = { defaultValue: 5 };
    const { instance, input } = numberInput();

    expect(press(input(), 'ArrowUp', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(instance.num.value()).toBe(5);
  });

  it('settles the value on Enter but leaves the key to the form', () => {
    numberOptions = { min: 0, max: 10 };
    const { instance, input } = numberInput();

    typeInto(input(), '99');
    const event = press(input(), 'Enter');
    // Consumed, the form could not be submitted from its last field; not
    // committed first, the form would submit the half-typed text.
    expect(event.defaultPrevented).toBe(false);
    expect(instance.handled).toBe(false);
    expect(instance.num.value()).toBe(10);
  });

  it('answers no key at all while read-only', () => {
    numberOptions = { defaultValue: 5, readOnly: () => true };
    const { instance, input } = numberInput();

    expect(press(input(), 'ArrowUp').defaultPrevented).toBe(false);
    expect(instance.num.value()).toBe(5);
  });

  it('keeps the spin buttons out of the way of the keyboard', () => {
    numberOptions = { min: 0, max: 2, defaultValue: 2 };
    const { increase, decrease } = numberInput();

    // Inside a form a button with no type submits it.
    expect(increase().type).toBe('button');
    // The spinbutton is the tab stop, and its arrows do the same job.
    expect(increase().getAttribute('tabindex')).toBe('-1');
    expect(increase().getAttribute('aria-hidden')).toBe('true');
    expect(increase().getAttribute('aria-label')).toBe('Increase');
    expect(decrease().getAttribute('aria-label')).toBe('Decrease');

    expect(increase().disabled).toBe(true);
    expect(decrease().disabled).toBe(false);
  });

  it('steps from a press on the buttons', () => {
    numberOptions = { defaultValue: 5 };
    const { instance, increase, decrease } = numberInput();

    click(increase());
    expect(instance.num.value()).toBe(6);
    click(decrease());
    click(decrease());
    expect(instance.num.value()).toBe(4);
  });

  it('asks for a decimal keypad only where decimals are possible', () => {
    numberOptions = { step: 1 };
    const whole = numberInput();
    expect(whole.input().getAttribute('inputmode')).toBe('numeric');

    newHost();
    numberOptions = { step: 0.5 };
    const fractional = numberInput();
    expect(fractional.input().getAttribute('inputmode')).toBe('decimal');
  });

  it('reports a value off the step only when a step is a constraint', () => {
    numberOptions = { step: 1, enforceStep: true, locale: 'en-US' };
    const { instance, input } = numberInput();

    typeInto(input(), '1.5');
    instance.num.field.report();
    flushSync();
    expect(instance.num.field.messages()).toEqual(['Enter a number in steps of 1.']);
  });

  it('accepts a value off the step by default', () => {
    numberOptions = { step: 1, locale: 'en-US' };
    const { instance, input } = numberInput();

    // A native number input rejects "1.5" against its default step of 1, which
    // is the single most complained-about thing it does.
    typeInto(input(), '1.5');
    instance.num.field.report();
    flushSync();
    expect(instance.num.field.messages()).toEqual([]);
  });

  it('can be driven from the signal it was handed', () => {
    const value = new Signal.State<number | null>(5);
    numberOptions = { value, locale: 'en-US' };
    const { input, hidden } = numberInput();

    value.set(42);
    flushSync();

    expect(input().getAttribute('aria-valuenow')).toBe('42');
    expect(hidden().value).toBe('42');
    // "Supply a signal to control the value from outside" is the contract, and
    // the box is the half the user reads. A spinbutton announcing 42 over a
    // box that still says 5 is worse than either alone.
    expect(input().value).toBe('42');
  });

  it('adopts a number written in the markup rather than showing what it will not submit', () => {
    numberOptions = { locale: 'en-US', name: 'qty' };
    const { instance, input, hidden } = numberInput(' value="7"');

    expect(input().value).toBe('7');
    // The box says 7, so the field has to as well: a control that submits an
    // empty string while showing a number is showing a lie.
    expect(instance.num.value()).toBe(7);
    expect(hidden().value).toBe('7');
  });

  it('empties the box when the signal it was handed is emptied', () => {
    const value = new Signal.State<number | null>(5);
    numberOptions = { value, locale: 'en-US', name: 'qty' };
    const { input, hidden, form } = numberInput();

    value.set(null);
    flushSync();

    // Nothing is a value like any other. Leaving "5" on screen would show a
    // number the field no longer holds and would not submit.
    expect(input().value).toBe('');
    expect(input().hasAttribute('aria-valuenow')).toBe(false);
    expect(hidden().value).toBe('');
    expect(submitted(form())).toEqual([['qty', '']]);
  });

  it('leaves a half-typed number alone while the value follows it', () => {
    const value = new Signal.State<number | null>(null);
    numberOptions = { value, locale: 'en-US' };
    const { input } = numberInput();

    typeInto(input(), '1.50');
    // The value moving is not an outside write, so the trailing zero survives:
    // re-deriving the box from every change of value is how a formatted number
    // field starts fighting the person typing into it.
    expect(value.get()).toBe(1.5);
    expect(input().value).toBe('1.50');
  });
});

describe('number input and the locale under it', () => {
  function localised(initial: string) {
    @Component({
      selector: `v-loc-${++selectors}`,
      render: compileTemplate(`
        <div :ref="root" :spread="locale.providerProps()">
          <input :ref="input" :spread="num.inputProps()" :blur="num.onBlur()">
        </div>
      `),
    })
    class LocalisedNumber {
      root = new Signal.State<Element | null>(null);
      input = new Signal.State<Element | null>(null);
      locale = createLocaleProvider({ defaultLocale: initial });
      num = createNumberInput({ ...numberOptions, input: () => this.input.get() });
    }

    const handle = track(mount(LocalisedNumber, host));
    flushSync();
    const instance = handle.instance as LocalisedNumber;
    return { instance, input: () => host.querySelector('input')! };
  }

  it('reformats a value nobody is editing when the language changes', () => {
    numberOptions = { defaultValue: 1234.56 };
    const { instance, input } = localised('en-US');

    expect(input().value).toBe('1,234.56');
    instance.locale.setLocale('de-DE');
    flushSync();
    // Otherwise a German page is left showing an American number.
    expect(input().value).toBe('1.234,56');
  });

  it('leaves the box alone while someone is typing in it', () => {
    numberOptions = { defaultValue: 1234.56 };
    const { instance, input } = localised('en-US');

    input().focus();
    typeInto(input(), '999.5');
    instance.locale.setLocale('de-DE');
    flushSync();

    // Rewriting a focused box moves the caret to the end of it.
    expect(input().value).toBe('999.5');
  });
});

describe('reading a number the way a locale writes one', () => {
  it('reads the same string as two different numbers in two locales', () => {
    // The whole reason this exists rather than `parseFloat`.
    expect(parseLocaleNumber('1.234', 'de-DE')).toBe(1234);
    expect(parseLocaleNumber('1.234', 'en-US')).toBe(1.234);
    expect(parseLocaleNumber('1,234', 'en-US')).toBe(1234);
    expect(parseLocaleNumber('1,234', 'de-DE')).toBe(1.234);
  });

  it('reads a lone separator as grouping only before a full group of three', () => {
    // A rule rather than a certainty, and the one it has to get right: "1.5"
    // is a decimal in every locale, whichever character writes it.
    expect(parseLocaleNumber('1.5', 'de-DE')).toBe(1.5);
    expect(parseLocaleNumber('1,5', 'de-DE')).toBe(1.5);
    expect(parseLocaleNumber('1.5', 'en-US')).toBe(1.5);
    expect(parseLocaleNumber('12.3456', 'de-DE')).toBe(12.3456);
  });

  it('drops decoration rather than refusing it', () => {
    // Someone who pastes "£1,234.56" means 1234.56.
    expect(parseLocaleNumber('£1,234.56', 'en-GB')).toBe(1234.56);
    expect(parseLocaleNumber('  -42 ', 'en-US')).toBe(-42);
    expect(parseLocaleNumber('1 234,56', 'fr-FR')).toBe(1234.56);
  });

  it('reads the digits of another numbering system', () => {
    expect(parseLocaleNumber('١٢٣٤٫٥٦', 'ar-EG')).toBe(1234.56);
  });

  it('answers null for text that is not a number', () => {
    expect(parseLocaleNumber('', 'en-US')).toBeNull();
    expect(parseLocaleNumber('twelve', 'en-US')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Password input
// ---------------------------------------------------------------------------

let passwordOptions: Partial<PasswordInputOptions>;

interface PasswordInstance {
  pw: ReturnType<typeof createPasswordInput>;
}

function passwordInput() {
  @Component({
    selector: `v-pw-${++selectors}`,
    render: compileTemplate(`
      <form>
        <label :ref="label" :spread="pw.labelProps()">Password</label>
        <input :ref="input" :spread="pw.inputProps()">
        <button class="toggle" :spread="pw.toggleProps()" :click="pw.toggle()">eye</button>
        <p class="status" :spread="pw.statusProps()">{ pw.statusText() }</p>
      </form>
    `),
  })
  class PasswordComponent {
    input = new Signal.State<Element | null>(null);
    label = new Signal.State<Element | null>(null);

    pw = createPasswordInput({
      ...passwordOptions,
      input: () => this.input.get(),
      label: () => this.label.get(),
    });
  }

  const handle = track(mount(PasswordComponent, host));
  flushSync();

  return {
    instance: handle.instance as PasswordInstance,
    input: () => host.querySelector('input')!,
    toggle: () => host.querySelector<HTMLButtonElement>('.toggle')!,
    status: () => host.querySelector<HTMLElement>('.status')!,
    form: () => host.querySelector('form')!,
  };
}

describe('password input', () => {
  it('submits from a plain form, and asks for none of the browser help it should not have', () => {
    passwordOptions = { name: 'password' };
    const { input, form } = passwordInput();

    expect(input().type).toBe('password');
    expect(input().getAttribute('autocomplete')).toBe('current-password');
    // A password is not a word, and a spellchecker's dictionary is not where
    // it belongs.
    expect(input().getAttribute('spellcheck')).toBe('false');
    expect(input().getAttribute('autocapitalize')).toBe('off');

    typeInto(input(), 'correct horse');
    expect(submitted(form())).toEqual([['password', 'correct horse']]);
  });

  it('announces the state twice over, because once is not reliable', () => {
    const { input, toggle, status } = passwordInput();

    expect(toggle().getAttribute('aria-label')).toBe('Show password');
    expect(status().getAttribute('role')).toBe('status');
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(status().textContent).toBe('Password hidden');

    click(toggle());
    expect(input().type).toBe('text');
    // The name a screen reader reads next time it lands here...
    expect(toggle().getAttribute('aria-label')).toBe('Hide password');
    expect(toggle().getAttribute('data-state')).toBe('revealed');
    // ...and the region that speaks at the moment the press happens, because a
    // name that changes as a result of being pressed is not reliably read.
    expect(status().textContent).toBe('Password shown');

    click(toggle());
    expect(input().type).toBe('password');
    expect(status().textContent).toBe('Password hidden');
  });

  it('never claims to be pressed', () => {
    const { toggle } = passwordInput();
    // "Hide password, pressed" reads as though hiding is what is in force.
    expect(toggle().hasAttribute('aria-pressed')).toBe(false);
  });

  it('points aria-controls at an element that is really there', () => {
    const { input, toggle } = passwordInput();
    expect(document.getElementById(toggle().getAttribute('aria-controls')!)).toBe(input());
  });

  it('keeps the caret where it was when the type changed under it', async () => {
    const { input, toggle } = passwordInput();

    typeInto(input(), 'secret');
    input().focus();
    input().setSelectionRange(2, 4);

    click(toggle());
    await settle();

    // A reveal in the middle of correcting a typo should not send the caret to
    // the end of the box.
    expect(input().selectionStart).toBe(2);
    expect(input().selectionEnd).toBe(4);
    expect(input().value).toBe('secret');
  });

  it('can be driven from the signal it was handed', () => {
    const revealed = new Signal.State(false);
    passwordOptions = { revealed };
    const { input } = passwordInput();

    revealed.set(true);
    flushSync();
    expect(input().type).toBe('text');
    expect(input().hasAttribute('data-revealed')).toBe(true);
  });

  it('takes the wording a consumer gives it', () => {
    passwordOptions = { labels: { show: 'Reveal', shown: 'Now visible' } };
    const { toggle, status } = passwordInput();

    expect(toggle().getAttribute('aria-label')).toBe('Reveal');
    click(toggle());
    expect(status().textContent).toBe('Now visible');
  });
});

// ---------------------------------------------------------------------------
// PIN input
// ---------------------------------------------------------------------------

let pinOptions: Partial<PinInputOptions>;

interface PinInstance {
  pin: ReturnType<typeof createPinInput>;
  handled: boolean;
}

function pinInput(dir = '') {
  @Component({
    selector: `v-pin-${++selectors}`,
    render: compileTemplate(`
      <form${dir}>
        <label :ref="label" :spread="pin.labelProps()">One-time code</label>
        <div :ref="container" :spread="pin.groupProps()">
          <input class="box" :for="(slot, i) in slots()" :key="slot" :spread="pin.boxProps(i)"
                 :keydown="onKey($event, i)" :input="pin.onInput($event, i)"
                 :paste="pin.onPaste($event, i)" :focus="pin.onFocus(i)">
        </div>
        <input :ref="hidden" :spread="pin.hiddenInputProps()">
      </form>
    `),
  })
  class PinComponent {
    container = new Signal.State<Element | null>(null);
    hidden = new Signal.State<Element | null>(null);
    label = new Signal.State<Element | null>(null);
    handled = false;

    pin = createPinInput({
      ...pinOptions,
      container: () => this.container.get(),
      hiddenInput: () => this.hidden.get(),
      label: () => this.label.get(),
    });

    slots(): number[] {
      return Array.from({ length: this.pin.length() }, (_, i) => i);
    }

    onKey(event: KeyboardEvent, index: number): void {
      this.handled = this.pin.onKeyDown(event, index);
    }
  }

  const handle = track(mount(PinComponent, host));
  flushSync();

  return {
    instance: handle.instance as unknown as PinInstance,
    boxes: () => [...host.querySelectorAll<HTMLInputElement>('.box')],
    box: (index: number) => host.querySelectorAll<HTMLInputElement>('.box')[index]!,
    hidden: () => host.querySelector<HTMLInputElement>('form > input')!,
    group: () => host.querySelector<HTMLElement>('[role="group"]')!,
    label: () => host.querySelector('label')!,
    form: () => host.querySelector('form')!,
    values: () => [...host.querySelectorAll<HTMLInputElement>('.box')].map((el) => el.value),
  };
}

describe('PIN input', () => {
  it('carries the whole code on one hidden input, and submits it', () => {
    pinOptions = { name: 'code', length: 6, defaultValue: '123456' };
    const { hidden, form, values } = pinInput();

    expect(values()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(hidden().value).toBe('123456');
    // Six boxes are a presentation of one value, and one value is what a form
    // should receive.
    expect(submitted(form())).toEqual([['code', '123456']]);
  });

  it('hides the input that submits from everything but the platform', () => {
    pinOptions = { name: 'code' };
    const { hidden } = pinInput();

    // The boxes carry the semantics; announcing both announces the field twice.
    expect(hidden().getAttribute('aria-hidden')).toBe('true');
    expect(hidden().getAttribute('tabindex')).toBe('-1');
    expect(hidden().getAttribute('style')).toContain('clip-path');
  });

  it('names each box by its position, and points the label at the first', () => {
    pinOptions = { length: 4 };
    const { boxes, label, box } = pinInput();

    expect(boxes().map((el) => el.getAttribute('aria-label'))).toEqual([
      'Digit 1 of 4',
      'Digit 2 of 4',
      'Digit 3 of 4',
      'Digit 4 of 4',
    ]);
    // Pressing the label should put the caret where typing starts, not on the
    // hidden input the field calls its control.
    expect(label().getAttribute('for')).toBe(box(0).id);
    expect(document.getElementById(label().getAttribute('for')!)).toBe(box(0));
  });

  it('calls them characters when they are not digits', () => {
    pinOptions = { length: 3, type: 'alphanumeric' };
    const { box } = pinInput();
    expect(box(0).getAttribute('aria-label')).toBe('Character 1 of 3');
    expect(box(0).getAttribute('inputmode')).toBe('text');
  });

  it('holds one tab stop for the whole field', () => {
    pinOptions = { length: 4 };
    const { boxes } = pinInput();
    // Tab steps over the field in one press instead of once per character.
    expect(boxes().map((el) => el.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
  });

  it('offers the code to autofill once rather than six times over', () => {
    pinOptions = { length: 3 };
    const { boxes } = pinInput();
    expect(boxes().map((el) => el.getAttribute('autocomplete'))).toEqual([
      'one-time-code',
      'off',
      'off',
    ]);
  });

  it('spreads a paste across the boxes and reports the code complete', () => {
    const onComplete = vi.fn();
    pinOptions = { length: 6, onComplete };
    const { box, hidden, values, instance } = pinInput();

    const event = pasteInto(box(0), '123456');
    // Left alone the browser drops the whole code into one box.
    expect(event.defaultPrevented).toBe(true);
    expect(values()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(hidden().value).toBe('123456');
    expect(instance.pin.isComplete()).toBe(true);
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(document.activeElement).toBe(box(5));
  });

  it('drops what a code cannot contain out of a paste', () => {
    pinOptions = { length: 6 };
    const { values } = pinInput();
    // A code copied out of an email arrives with spaces in it.
    pasteInto(host.querySelector('.box')!, '12 34-56');
    expect(values().join('')).toBe('123456');
  });

  it('pastes from the box that was pasted into', () => {
    pinOptions = { length: 6, defaultValue: '12' };
    const { box, values } = pinInput();

    pasteInto(box(2), '99');
    expect(values()).toEqual(['1', '2', '9', '9', '', '']);
  });

  it('moves to the next box as each character is typed', () => {
    pinOptions = { length: 4 };
    const { box, values } = pinInput();

    typeInto(box(0), '7');
    expect(values()).toEqual(['7', '', '', '']);
    expect(document.activeElement).toBe(box(1));

    typeInto(box(1), '8');
    expect(document.activeElement).toBe(box(2));
  });

  it('refuses a character the code cannot hold', () => {
    pinOptions = { length: 4 };
    const { box, instance, values } = pinInput();

    typeInto(box(0), 'x');
    expect(instance.pin.value()).toBe('');
    expect(values()).toEqual(['', '', '', '']);
  });

  it('goes back and deletes on Backspace in an empty box', () => {
    pinOptions = { length: 4, defaultValue: '12' };
    const { box, instance, values } = pinInput();

    box(2).focus();
    press(box(2), 'Backspace');
    // What a single field does: the character before the caret goes.
    expect(instance.pin.value()).toBe('1');
    expect(values()).toEqual(['1', '', '', '']);
    expect(document.activeElement).toBe(box(1));
  });

  it('clears the character it is on when there is one', () => {
    pinOptions = { length: 4, defaultValue: '123' };
    const { box, instance } = pinInput();

    box(1).focus();
    press(box(1), 'Backspace');
    // The rest shift along: a code with a hole in it is not a code.
    expect(instance.pin.value()).toBe('13');
  });

  it('shifts the rest along on Delete', () => {
    pinOptions = { length: 4, defaultValue: '1234' };
    const { box, instance } = pinInput();

    box(0).focus();
    press(box(0), 'Delete');
    expect(instance.pin.value()).toBe('234');
  });

  it('moves between the boxes with the arrows', () => {
    pinOptions = { length: 4, defaultValue: '1234' };
    const { box } = pinInput();

    box(0).focus();
    expect(press(box(0), 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(box(1));

    press(box(1), 'ArrowRight');
    expect(document.activeElement).toBe(box(2));
    press(box(2), 'ArrowLeft');
    expect(document.activeElement).toBe(box(1));
  });

  it('mirrors the arrows where the writing runs the other way', () => {
    pinOptions = { length: 4, defaultValue: '1234' };
    const { box } = pinInput(' dir="rtl"');

    box(0).focus();
    press(box(0), 'ArrowLeft');
    expect(document.activeElement).toBe(box(1));
    press(box(1), 'ArrowRight');
    expect(document.activeElement).toBe(box(0));
  });

  it('bounces focus back to where the next character belongs', () => {
    pinOptions = { length: 6, defaultValue: '12' };
    const { box } = pinInput();

    box(4).focus();
    flushSync();
    // A box past the first empty one is not somewhere a character can go.
    expect(document.activeElement).toBe(box(2));
  });

  it('selects what is in a box when it is entered, so typing replaces it', () => {
    pinOptions = { length: 4, defaultValue: '1234' };
    const { box } = pinInput();

    box(2).focus();
    flushSync();
    expect(box(2).selectionStart).toBe(0);
    expect(box(2).selectionEnd).toBe(1);
  });

  it('leaves Enter and takes the space bar', () => {
    pinOptions = { length: 4 };
    const { box, instance } = pinInput();

    box(0).focus();
    // Enter is the form's; a field that swallowed it would take the form's
    // default action away from keyboard users.
    expect(press(box(0), 'Enter').defaultPrevented).toBe(false);
    expect(instance.handled).toBe(false);
    // Space is in no code, and it would scroll the page.
    expect(press(box(0), ' ').defaultPrevented).toBe(true);
  });

  it('answers no key and takes no paste while disabled', () => {
    pinOptions = { length: 4, defaultValue: '12', disabled: () => true };
    const { box, instance } = pinInput();

    expect(press(box(0), 'Backspace').defaultPrevented).toBe(false);
    expect(pasteInto(box(0), '3456').defaultPrevented).toBe(false);
    expect(instance.pin.value()).toBe('12');
    expect(box(0).disabled).toBe(true);
  });

  it('renders dots when the code is meant to be secret', () => {
    pinOptions = { length: 4, mask: true };
    const { box } = pinInput();
    expect(box(0).type).toBe('password');
  });

  it('reports a half-typed code as incomplete, and an empty one as required', () => {
    pinOptions = { length: 6, defaultValue: '123' };
    const { instance } = pinInput();

    instance.pin.field.report();
    flushSync();
    expect(instance.pin.field.messages()).toEqual(['Enter all the characters.']);
    expect(instance.pin.field.isInvalid()).toBe(true);
  });

  it('says nothing extra about an empty code, which is required to say', () => {
    pinOptions = { length: 6 };
    const { instance } = pinInput();

    instance.pin.field.report();
    flushSync();
    // Two messages for one mistake is one message too many.
    expect(instance.pin.field.messages()).toEqual([]);
  });

  it('marks the group invalid, and every box with it, exactly once', () => {
    pinOptions = { length: 4, defaultValue: '12' };
    const { instance, boxes, group } = pinInput();

    instance.pin.field.report();
    flushSync();

    expect(group().getAttribute('role')).toBe('group');
    expect(boxes().every((el) => el.getAttribute('aria-invalid') === 'true')).toBe(true);
    // The message is described once, on the group.
    expect(group().hasAttribute('id')).toBe(false);
  });

  it('can be driven from the signal it was handed', () => {
    const value = new Signal.State('');
    pinOptions = { length: 4, value };
    const { values, hidden } = pinInput();

    value.set('4321');
    flushSync();
    expect(values()).toEqual(['4', '3', '2', '1']);
    expect(hidden().value).toBe('4321');
  });

  it('marks the boxes so the collection can find them in order', () => {
    pinOptions = { length: 3 };
    const { boxes } = pinInput();
    expect(boxes().map((el) => el.getAttribute(PIN_BOX_ATTRIBUTE))).toEqual(['0', '1', '2']);
  });

  it('borrows the field label for the group without borrowing its id', () => {
    pinOptions = { length: 4, name: 'code' };
    const { group, label, hidden } = pinInput();

    // The name is on the group, the id stays with what the label points at.
    expect(document.getElementById(group().getAttribute('aria-labelledby')!)).toBe(label());
    expect(hidden().id).toBeTruthy();
    expect(group().id).toBe('');
  });

  it('empties the boxes and puts the caret back at the start', () => {
    pinOptions = { length: 4, defaultValue: '1234' };
    const { instance, box, values } = pinInput();

    box(3).focus();
    instance.pin.clear();
    flushSync();

    expect(values()).toEqual(['', '', '', '']);
    // Cleared but left focused on box four, the next character would go
    // nowhere the user is looking.
    expect(document.activeElement).toBe(box(0));
  });

  it('follows a form reset, which fires no input event', async () => {
    pinOptions = { name: 'code', length: 6, defaultValue: '123456' };
    const { instance, hidden, form, values } = pinInput();

    expect(submitted(form())).toEqual([['code', '123456']]);
    form().reset();
    await settle();

    // The browser blanks the boxes and the hidden input either way. A value
    // that did not hear about it would leave the field claiming a complete
    // code that nothing on screen shows and nothing would submit.
    expect(values()).toEqual(['', '', '', '', '', '']);
    expect(hidden().value).toBe('');
    expect(instance.pin.value()).toBe('');
    expect(instance.pin.isComplete()).toBe(false);
    expect(submitted(form())).toEqual([['code', '']]);
  });

  it('starts the next code from empty after a reset', async () => {
    pinOptions = { length: 6, defaultValue: '123456' };
    const { instance, box, boxes, form, values } = pinInput();

    box(5).focus();
    form().reset();
    await settle();

    // The tab stop belongs where the next character does, and after a reset
    // that is the first box rather than the last one anybody touched.
    expect(boxes().map((el) => el.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
    ]);

    typeInto(box(0), '9');
    // Typing over a code the field still held turned one keystroke into
    // "923456": the character was distributed into a string of six.
    expect(instance.pin.value()).toBe('9');
    expect(values()).toEqual(['9', '', '', '', '', '']);
  });
});

// ---------------------------------------------------------------------------
// Tags input
// ---------------------------------------------------------------------------

let tagsOptions: Partial<TagsInputOptions>;
/**
 * What the row shows, when that is not the whole value.
 *
 * A consumer's row is not obliged to render every tag it holds, and where
 * focus goes after a removal is a question about the row.
 */
let tagsVisible: ((tags: readonly string[]) => readonly string[]) | null;

interface TagsInstance {
  tags: ReturnType<typeof createTagsInput>;
  hidden: Signal.State<readonly string[]>;
  input: Signal.State<Element | null>;
  handled: boolean;
}

function tagsInput(dir = '', row = '') {
  @Component({
    selector: `v-tags-${++selectors}`,
    render: compileTemplate(`
      <form${dir}>
        <label :ref="label" :spread="tags.labelProps()">Topics</label>
        <div :ref="root" :spread="tags.rootProps()">
          <ul${row} :ref="list" :spread="tags.listProps()">
            <li class="tag" :for="(tag, i) in visible()" :key="tag" :spread="tags.tagProps(i)"
                :keydown="onTagKey($event, i)">
              <span class="text">{ tag }</span>
              <button class="remove" :spread="tags.removeProps(i)" :click="tags.removeAt(i)">x</button>
            </li>
          </ul>
          <input :ref="input" :spread="tags.inputProps()" :keydown="onKey($event)"
                 :paste="onPaste($event)" :blur="tags.onBlur()">
          <input class="hidden" :for="(tag, i) in tags.tags()" :key="tag"
                 :spread="tags.hiddenInputProps(i)">
        </div>
        <p class="status" :spread="tags.statusProps()">{ tags.statusText() }</p>
      </form>
    `),
  })
  class TagsComponent {
    root = new Signal.State<Element | null>(null);
    list = new Signal.State<Element | null>(null);
    input = new Signal.State<Element | null>(null);
    label = new Signal.State<Element | null>(null);
    handled = false;

    tags = createTagsInput({
      ...tagsOptions,
      input: () => this.input.get(),
      list: () => this.list.get(),
      root: () => this.root.get(),
      label: () => this.label.get(),
    });

    /**
     * A row a consumer narrows for reasons of their own.
     *
     * `hidden` is a signal rather than the module-level `tagsVisible` beside
     * it, because the case worth testing is the row changing *without* the
     * value changing — a search term narrowing what is shown. A filter that is
     * not reactive can only be set before the component mounts, so the suite
     * could not express that case at all.
     */
    hidden = new Signal.State<readonly string[]>([]);

    visible(): readonly string[] {
      const tags = this.tags.tags();
      const filtered = tagsVisible ? tagsVisible(tags) : tags;
      const out = this.hidden.get();
      return out.length === 0 ? filtered : filtered.filter((tag) => !out.includes(tag));
    }

    onKey(event: KeyboardEvent): void {
      this.handled = this.tags.onKeyDown(event);
    }

    onTagKey(event: KeyboardEvent, index: number): void {
      this.handled = this.tags.onTagKeyDown(event, index);
    }

    onPaste(event: ClipboardEvent): void {
      this.handled = this.tags.onPaste(event);
    }
  }

  const handle = track(mount(TagsComponent, host));
  flushSync();

  return {
    instance: handle.instance as unknown as TagsInstance,
    input: () => host.querySelector<HTMLInputElement>('div > input')!,
    chips: () => [...host.querySelectorAll<HTMLElement>('.tag')],
    chip: (index: number) => host.querySelectorAll<HTMLElement>('.tag')[index]!,
    remove: (index: number) => host.querySelectorAll<HTMLButtonElement>('.remove')[index]!,
    list: () => host.querySelector<HTMLElement>('ul')!,
    root: () => host.querySelector<HTMLElement>('div[role="group"]')!,
    status: () => host.querySelector<HTMLElement>('.status')!,
    form: () => host.querySelector('form')!,
    labels: () =>
      [...host.querySelectorAll<HTMLElement>('.text')].map((el) => el.textContent ?? ''),
  };
}

describe('what a disabled or read-only field refuses', () => {
  // The same class of gap the combobox had: state guards on the public surface
  // that nothing distinguished. Found by deleting each guard and watching the
  // suite stay green.
  it('offers no step in either direction while disabled', () => {
    numberOptions = { defaultValue: 4, min: 0, max: 10, disabled: () => true };
    const { instance } = numberInput();

    expect(instance.num.canIncrement()).toBe(false);
    expect(instance.num.canDecrement()).toBe(false);
  });

  it('offers no step while read-only either, where the value is not the user’s to move', () => {
    numberOptions = { defaultValue: 4, min: 0, max: 10, readOnly: () => true };
    const { instance } = numberInput();

    expect(instance.num.canIncrement()).toBe(false);
    expect(instance.num.canDecrement()).toBe(false);
  });

  it('does not move the value when told to step anyway', () => {
    // `increment` and `decrement` are on the public surface, so a consumer can
    // ask for a step without going through a control that is greyed out — and
    // the guard inside is then the only thing that refuses.
    numberOptions = { defaultValue: 4, min: 0, max: 10, disabled: () => true };
    const { instance } = numberInput();

    // One direction at a time: a step up followed by a step down returns to
    // where it started whether the guard is there or not, which is a test that
    // cannot fail.
    instance.num.increment();
    expect(instance.num.value()).toBe(4);

    instance.num.decrement();
    expect(instance.num.value()).toBe(4);
  });

  it('does not report a field the user cannot reach as invalid', async () => {
    // A disabled control is left out of a form's submission entirely, so
    // failing a form over a value it never sends would be a form nobody can
    // submit and nothing on screen to explain why.
    numberOptions = { defaultValue: 4, min: 10, max: 20, disabled: () => true };
    const { instance } = numberInput();

    expect(await instance.num.field.validate()).toBe(true);
    expect(instance.num.field.isInvalid()).toBe(false);
  });

  it('leaves a read-only field alone too, where the value is not the user’s to correct', async () => {
    numberOptions = { defaultValue: 4, min: 10, max: 20, readOnly: () => true };
    const { instance } = numberInput();

    expect(await instance.num.field.validate()).toBe(true);
  });

  it('adds no tag while disabled, which a consumer can ask for directly', () => {
    tagsOptions = { disabled: () => true };
    const { instance } = tagsInput();

    expect(instance.tags.add('ada')).toBe(false);
    expect(instance.tags.tags()).toEqual([]);
  });

  it('adds no tag while read-only either', () => {
    tagsOptions = { readOnly: () => true };
    const { instance } = tagsInput();

    expect(instance.tags.add('ada')).toBe(false);
    expect(instance.tags.tags()).toEqual([]);
  });
});

describe('tags input', () => {
  it('submits one entry per tag, so the server reads a list', () => {
    tagsOptions = { name: 'topics', defaultValue: ['ada', 'grace'] };
    const { form } = tagsInput();

    expect(submitted(form())).toEqual([
      ['topics', 'ada'],
      ['topics', 'grace'],
    ]);
  });

  it('adds what is typed on Enter', () => {
    const { instance, input, labels } = tagsInput();

    typeInto(input(), 'ada');
    expect(press(input(), 'Enter').defaultPrevented).toBe(true);

    expect(instance.tags.tags()).toEqual(['ada']);
    expect(labels()).toEqual(['ada']);
    // The box is emptied for the next one.
    expect(input().value).toBe('');
  });

  it('leaves Enter to the form when there is nothing half-typed', () => {
    const { instance, input } = tagsInput();
    // Otherwise a form cannot be submitted from its last field.
    expect(press(input(), 'Enter').defaultPrevented).toBe(false);
    expect(instance.handled).toBe(false);
  });

  it('ends a tag on the delimiter as it is typed', () => {
    tagsOptions = { delimiters: [';'] };
    const { instance, input } = tagsInput();

    typeInto(input(), 'ada');
    press(input(), ';');
    expect(instance.tags.tags()).toEqual(['ada']);
  });

  it('removes the last tag with Backspace in an empty box', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { instance, input } = tagsInput();

    press(input(), 'Backspace');
    expect(instance.tags.tags()).toEqual(['ada']);
  });

  it('keeps the text when Backspace has something to delete', () => {
    tagsOptions = { defaultValue: ['ada'] };
    const { instance, input } = tagsInput();

    typeInto(input(), 'gr');
    press(input(), 'Backspace');
    expect(instance.tags.tags()).toEqual(['ada']);
  });

  it('splits a paste on the delimiter and on newlines', () => {
    const { instance, input } = tagsInput();

    const event = pasteInto(input(), 'ada, grace\nedsger');
    expect(event.defaultPrevented).toBe(true);
    // Text pasted out of a spreadsheet arrives one item per line whatever the
    // delimiter is.
    expect(instance.tags.tags()).toEqual(['ada', 'grace', 'edsger']);
  });

  it('leaves a paste with nothing to split alone', () => {
    const { instance, input } = tagsInput();

    const event = pasteInto(input(), 'ada');
    // It is just typing, and the user can still edit it before pressing Enter.
    expect(event.defaultPrevented).toBe(false);
    expect(instance.handled).toBe(false);
    expect(instance.tags.tags()).toEqual([]);
  });

  it('refuses a tag that is already there, and says which one it clashed with', () => {
    const onReject = vi.fn();
    tagsOptions = { defaultValue: ['ada'], onReject };
    const { instance, input, chip, status } = tagsInput();

    typeInto(input(), 'Ada');
    press(input(), 'Enter');

    // Through the locale's collator, so Turkish dotless i and the accents are
    // right where `toLowerCase` is not.
    expect(instance.tags.tags()).toEqual(['ada']);
    expect(instance.tags.duplicateIndex()).toBe(0);
    expect(chip(0).hasAttribute('data-duplicate')).toBe(true);
    expect(status().textContent).toBe('Ada is already in the list');
    expect(onReject).toHaveBeenCalledWith('Ada', 'duplicate');
  });

  it('tells case apart when it is asked to', () => {
    tagsOptions = { defaultValue: ['ada'], caseSensitive: true };
    const { instance, input } = tagsInput();

    typeInto(input(), 'Ada');
    press(input(), 'Enter');
    expect(instance.tags.tags()).toEqual(['ada', 'Ada']);
  });

  it('keeps duplicates when it is told they are allowed', () => {
    tagsOptions = { defaultValue: ['ada'], allowDuplicates: true };
    const { instance, input } = tagsInput();

    typeInto(input(), 'ada');
    press(input(), 'Enter');
    expect(instance.tags.tags()).toEqual(['ada', 'ada']);
  });

  it('forgets the clash as soon as the text changes', () => {
    tagsOptions = { defaultValue: ['ada'] };
    const { instance, input } = tagsInput();

    typeInto(input(), 'ada');
    press(input(), 'Enter');
    expect(instance.tags.duplicateIndex()).toBe(0);

    typeInto(input(), 'adam');
    expect(instance.tags.duplicateIndex()).toBeNull();
  });

  it('names each remove control with what it removes', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { remove } = tagsInput();

    // "Remove" five times over tells a screen reader user nothing about which
    // one they are about to press.
    expect(remove(0).getAttribute('aria-label')).toBe('Remove ada');
    expect(remove(1).getAttribute('aria-label')).toBe('Remove grace');
    // The tag is the tab stop, and Backspace on it does the same job.
    expect(remove(0).getAttribute('tabindex')).toBe('-1');
    expect(remove(0).type).toBe('button');
  });

  it('removes on a press, and says so out loud', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { instance, remove, status, labels } = tagsInput();

    click(remove(0));
    expect(instance.tags.tags()).toEqual(['grace']);
    expect(labels()).toEqual(['grace']);
    // Removing a tag changes the page without moving focus, which is silence.
    expect(status().textContent).toBe('ada removed');
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(status().getAttribute('aria-atomic')).toBe('true');
  });

  it('removes no tag while the field is disabled or read-only', () => {
    const disabled = new Signal.State(true);
    const readOnly = new Signal.State(false);
    tagsOptions = {
      defaultValue: ['ada', 'grace'],
      disabled: () => disabled.get(),
      readOnly: () => readOnly.get(),
    };
    const { instance } = tagsInput();

    // This is what backs the remove control inside each tag, and Backspace on
    // it: a field that refuses everything else the user presses cannot answer
    // those two.
    instance.tags.removeAt(0);
    flushSync();
    expect(instance.tags.tags()).toEqual(['ada', 'grace']);

    disabled.set(false);
    readOnly.set(true);
    instance.tags.removeAt(0);
    flushSync();
    expect(instance.tags.tags()).toEqual(['ada', 'grace']);

    readOnly.set(false);
    instance.tags.removeAt(0);
    flushSync();
    expect(instance.tags.tags()).toEqual(['grace']);
  });

  it('clears while disabled, because clearing is nothing the user pressed', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'], disabled: () => true };
    const { instance } = tagsInput();

    // The asymmetry with `removeAt` above, pinned deliberately: `clear` is the
    // consumer's own call and not a control this field describes, and the same
    // write through the value signal beside it could refuse nothing anyway.
    // Whichever way it is settled, it has to be settled on purpose.
    instance.tags.clear();
    flushSync();

    expect(instance.tags.tags()).toEqual([]);
  });

  it('says nothing when the row is emptied, where removing one tag speaks', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { instance, status } = tagsInput();

    instance.tags.removeAt(0);
    flushSync();
    expect(status().textContent).toBe('ada removed');

    // Pinned as it stands rather than as it should be. Emptying the row is the
    // largest change the field makes and the only silent one, and there is no
    // label to say it with yet; this line is what makes closing that a change
    // somebody made rather than one that happened.
    instance.tags.clear();
    flushSync();
    expect(status().textContent).toBe('ada removed');
  });

  it('stops flashing a duplicate when the row it pointed into is cleared', () => {
    tagsOptions = { defaultValue: ['ada'] };
    const { instance } = tagsInput();

    instance.tags.add('ada');
    expect(instance.tags.duplicateIndex()).toBe(0);

    // The index is a place in a row that no longer exists: kept, it would
    // flash whichever tag arrives at that place next, for a clash nobody made.
    instance.tags.clear();
    flushSync();

    expect(instance.tags.duplicateIndex()).toBe(null);
  });

  it('makes the list a list, and each tag an item in it', () => {
    tagsOptions = { defaultValue: ['ada'] };
    const { list, chip } = tagsInput();

    expect(list().getAttribute('role')).toBe('list');
    expect(list().getAttribute('aria-label')).toBe('Tags');
    expect(chip(0).getAttribute('role')).toBe('listitem');
    expect(chip(0).getAttribute('data-label')).toBe('ada');
  });

  it('holds one tab stop for the whole row of tags', () => {
    tagsOptions = { defaultValue: ['ada', 'grace', 'edsger'] };
    const { chips } = tagsInput();
    // Twenty tags cost two Tab presses, not twenty-one.
    expect(chips().map((el) => el.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('steps left out of the empty box and into the last tag', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { input, chip } = tagsInput();

    input().focus();
    expect(press(input(), 'ArrowLeft').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(chip(1));

    press(chip(1), 'ArrowLeft');
    expect(document.activeElement).toBe(chip(0));
  });

  it('steps right off the last tag and back into the box', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { input, chip } = tagsInput();

    chip(1).focus();
    press(chip(1), 'ArrowRight');
    // Where the next thing typed belongs.
    expect(document.activeElement).toBe(input());
  });

  it('mirrors the row where the writing runs the other way', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { input, chip } = tagsInput(' dir="rtl"');

    input().focus();
    // In an RTL row the tags sit to the right of the box, so Right is the key
    // that reaches them — the same mirroring roving focus does between tags.
    press(input(), 'ArrowRight');
    expect(document.activeElement).toBe(chip(1));

    press(chip(1), 'ArrowLeft');
    expect(document.activeElement).toBe(input());
  });

  it('leaves focus somewhere useful when the tag holding it goes', () => {
    tagsOptions = { defaultValue: ['ada', 'grace', 'edsger'] };
    const { instance, chip } = tagsInput();

    chip(1).focus();
    press(chip(1), 'Backspace');

    expect(instance.tags.tags()).toEqual(['ada', 'edsger']);
    // The row closes up leftwards, so the one after is where the eye already
    // is — and `<body>` is where a keyboard user must never be thrown.
    expect(document.activeElement).toBe(chip(1));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('hands focus to the tag now at the end when the one that goes was there', () => {
    tagsOptions = { defaultValue: ['ada', 'grace', 'edsger'] };
    const { chip, chips } = tagsInput();

    chip(2).focus();
    press(chip(2), 'Backspace');

    // Nothing took its place — the row is shorter than the index that held
    // focus — so the tag now at the end is the one nearest where the eye was.
    // Falling through to the text box would step past the whole row.
    expect(document.activeElement).toBe(chip(1));
    expect(chips().map((el) => el.getAttribute('tabindex'))).toEqual(['-1', '0']);
  });

  it('rescues focus again when the tag it rescued to goes too', () => {
    tagsOptions = { defaultValue: ['ada', 'grace', 'edsger'] };
    const { chip } = tagsInput();

    chip(1).focus();
    press(chip(1), 'Backspace');
    expect(document.activeElement).toBe(chip(1));

    // The second removal in a row is what says whether the first left a record
    // of where it put focus. A rescue that forgets its own answer has nothing
    // to rescue from next time, and `<body>` is where that lands.
    press(chip(1), 'Backspace');
    expect(document.activeElement).toBe(chip(0));
  });

  it('leaves focus somewhere useful when the remove control itself goes', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { instance, chip, remove } = tagsInput();

    // The pointer and screen-reader path: the control that was pressed is
    // inside the tag it removes, so it goes with it.
    remove(0).focus();
    click(remove(0));

    expect(instance.tags.tags()).toEqual(['grace']);
    // The tag that took its place, named rather than picked out of a list of
    // acceptable answers: `<body>` and the text box are both wrong here, and
    // only one of the two is obviously wrong.
    expect(document.activeElement).toBe(chip(0));
    expect(document.activeElement?.textContent).toContain('grace');
  });

  it('leaves focus where it is when the tag that goes was not holding it', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { instance, input } = tagsInput();

    input().focus();
    instance.tags.removeAt(0);
    flushSync();

    // Rescuing focus is for the element being destroyed. A removal driven from
    // somewhere else on the page destroys nothing focused, and pulling the
    // caret out of the box the user is typing in would be the worse bug.
    expect(document.activeElement).toBe(input());
  });

  it('leaves the other arrow to the caret where the writing runs the other way', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { instance, input } = tagsInput(' dir="rtl"');

    input().focus();
    // Left moves along an RTL row, so it cannot also mean "enter the tags":
    // one key meaning both is how the field ends up with no way back out.
    expect(press(input(), 'ArrowLeft').defaultPrevented).toBe(false);
    expect(instance.handled).toBe(false);
    expect(document.activeElement).toBe(input());
  });

  it('reads a direction the markup delegates the way the library reads it', () => {
    tagsOptions = { defaultValue: ['ada', 'grace', 'zoe'] };
    // `dir="auto"` states no direction, so the stylesheet's is the one left,
    // and `resolveDirection` is where the whole library goes to be told that.
    // A rule of its own here would answer the same element differently from
    // every other part of the field that has to ask.
    const { instance, input, chip } = tagsInput(' dir="auto" style="direction: rtl"');

    expect(resolveDirection(input())).toBe('rtl');

    input().focus();
    press(input(), 'ArrowRight');
    expect(document.activeElement).toBe(chip(2));

    input().focus();
    // Left runs along an RTL row, so it stays the caret's.
    expect(press(input(), 'ArrowLeft').defaultPrevented).toBe(false);
    expect(instance.handled).toBe(false);
    expect(document.activeElement).toBe(input());
  });

  it('falls back to the text box when the last tag goes', () => {
    tagsOptions = { defaultValue: ['ada'] };
    const { input, chip } = tagsInput();

    chip(0).focus();
    press(chip(0), 'Delete');
    expect(document.activeElement).toBe(input());
  });

  it('falls back to the text box when every tag goes at once', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { instance, input, chip } = tagsInput();

    // A "clear all" pressed from inside the row destroys the focused tag just
    // as its own remove control would, and there is no next tag to land on.
    chip(0).focus();
    instance.tags.clear();
    flushSync();

    expect(instance.tags.tags()).toEqual([]);
    expect(document.activeElement).toBe(input());
  });

  it('leaves focus where it is when the tags cleared were not holding it', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { instance, chip } = tagsInput();

    // Left the row before the clear arrived. Landing the user in the text box
    // would be the field grabbing focus off whatever they moved on to, so the
    // record has to be let go of on the way out and not only on the removal.
    chip(0).focus();
    chip(0).blur();
    instance.tags.clear();
    flushSync();

    expect(document.activeElement).toBe(document.body);
  });

  it('falls back to the text box when the row goes with the tag in it', () => {
    tagsOptions = { defaultValue: ['ada'] };
    // A row a consumer only renders when there is something in it: the last
    // tag and the list around it go in the same change, so a rescue hung off
    // the row's own listeners would have let go of the tag before it acted.
    const { instance, input, chip } = tagsInput('', ' :if="tags.tags().length > 0"');

    chip(0).focus();
    instance.tags.removeAt(0);
    flushSync();

    expect(document.activeElement).toBe(input());
  });

  it('falls back to the text box when clearing takes the row with it', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { instance, input, chip } = tagsInput('', ' :if="tags.tags().length > 0"');

    chip(1).focus();
    instance.tags.clear();
    flushSync();

    expect(document.activeElement).toBe(input());
  });

  it('keeps the record when a tag off the page announces the focus it lost', () => {
    tagsOptions = { defaultValue: ['ada'] };
    const { instance, input, chip, list } = tagsInput('', ' :if="tags.tags().length > 0"');

    chip(0).focus();
    const tag = chip(0);
    // Engines disagree about whether removing the focused element announces
    // the focus loss; the one these tests run in is silent, so the
    // announcement is made by hand. It reaches the field at all only because
    // the row went with the tag, and what it reports is a rescue still owed —
    // read as the user leaving, it would cancel the rescue instead.
    list().remove();
    tag.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    instance.tags.removeAt(0);
    flushSync();

    expect(document.activeElement).toBe(input());
  });

  it('hands the tab stop back to the first tag after a clear', () => {
    tagsOptions = { defaultValue: ['ada', 'grace', 'edsger'] };
    const { instance, input, chips } = tagsInput();

    // The stop is on the last tag when the row is emptied. More than one tag
    // has to come back for the answer to be visible: with one, every index the
    // row could have remembered clamps to it, and the tags that come back are
    // new ones the user has never been in.
    press(input(), 'ArrowLeft');
    instance.tags.clear();
    flushSync();
    for (const tag of ['x', 'y', 'z']) instance.tags.add(tag);
    flushSync();

    expect(chips().map((el) => el.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('keeps the row reachable by Tab when the tag holding the stop is removed', () => {
    tagsOptions = { defaultValue: ['ada', 'grace', 'edsger'] };
    const { instance, input, chips } = tagsInput();

    press(input(), 'ArrowLeft');
    // Left the row again before the removal, so there is no focus to rescue —
    // but the stop went with the tag, and the removal is not the one call site
    // that thought to hand it on.
    input().focus();
    instance.tags.removeAt(2);
    flushSync();

    expect(chips().map((el) => el.getAttribute('tabindex'))).toEqual(['-1', '0']);
  });

  it('moves the stop to the tag the rescue put focus on', () => {
    tagsOptions = { defaultValue: ['ada', 'grace', 'edsger'] };
    const { chip, chips } = tagsInput();

    chip(1).focus();
    press(chip(1), 'Backspace');

    // The other removal tests leave the row first, so none of them sees where
    // the stop goes when focus is re-placed. A stop left on the tag that was
    // holding it answers Tab with one tag and focus with another, which is the
    // split this model exists to close.
    expect(document.activeElement).toBe(chip(1));
    expect(chips().map((el) => el.getAttribute('tabindex'))).toEqual(['-1', '0']);
  });

  it('moves the stop to the tag a click put focus on', () => {
    tagsOptions = { defaultValue: ['ada', 'grace', 'edsger'] };
    const { chip, chips } = tagsInput();

    // A pointer is the one way into the row no key handler sees. A stop left
    // where the keys last put it answers Tab with one tag while the user is
    // on another, which is the split the whole model exists to close.
    chip(2).focus();
    flushSync();

    expect(document.activeElement).toBe(chip(2));
    expect(chips().map((el) => el.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  });

  it('keeps the stop inside a row a consumer write shortened', () => {
    const value = new Signal.State<readonly string[]>(['ada', 'grace', 'edsger']);
    tagsOptions = { value };
    const { input, chips } = tagsInput();

    press(input(), 'ArrowLeft');
    input().focus();
    // The site no guard can be put on: the row shrinks under the stop without
    // the field being asked, so the stop has to be read back from the row.
    value.set(['ada']);
    flushSync();

    expect(chips().map((el) => el.getAttribute('tabindex'))).toEqual(['0']);
  });

  it('keeps the stop inside a row showing fewer tags than the value holds', () => {
    tagsOptions = { defaultValue: ['ada', 'grace', 'edsger'] };
    // The row a consumer filtered, as above — but here the stop is the thing
    // left behind rather than focus. Counted against the value the stop is
    // still in range and so nothing corrects it, while the row it is supposed
    // to be pointing into is a tag shorter than that.
    tagsVisible = (tags) => tags.filter((tag) => tag !== 'edsger');
    const { instance, chip, input, chips } = tagsInput();

    chip(1).focus();
    // Out of the row before the removal, so there is no focus to rescue and
    // nothing arrives anywhere to say where the stop belongs now.
    input().focus();
    instance.tags.removeAt(1);
    flushSync();

    expect(chips()).toHaveLength(1);
    // Every tag at `-1` is a row Tab cannot reach at all, which is the exact
    // failure the stop is read back off the row to prevent.
    expect(chips().map((el) => el.getAttribute('tabindex'))).toEqual(['0']);
  });

  it('carries the stop along with the tag focus is on when the row opens up before it', () => {
    const value = new Signal.State<readonly string[]>(['ada', 'grace', 'edsger']);
    tagsOptions = { value };
    const { chip, chips } = tagsInput();

    const held = chip(0);
    held.focus();
    value.set(['zoe', 'ada', 'grace', 'edsger']);
    flushSync();

    // Focus never moved, so nothing announced an arrival to write the stop
    // from — and the tag it is on is one further along the row than it was.
    expect(document.activeElement).toBe(held);
    expect(chips().map((el) => el.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1']);
  });

  it('hands focus to the row when the text box will not take it', () => {
    const value = new Signal.State<readonly string[]>(['ada']);
    tagsOptions = { value, disabled: () => true };
    const { chip, list } = tagsInput();

    chip(0).focus();
    // A disabled field's box refuses focus, so the fallback falls through —
    // and falling through to `<body>` puts the next Tab at the top of the
    // document. The row itself is the last place inside the field.
    value.set([]);
    flushSync();

    expect(document.activeElement).toBe(list());
    // This environment focuses whatever it is asked to; a browser focuses only
    // what can take it, so the attribute is the half that has to be asserted.
    expect(list().getAttribute('tabindex')).toBe('-1');
  });

  it('hands focus to the field itself when neither the row nor the box will take it', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'], disabled: () => true };
    // Each half of this has a test of its own above, and together they leave
    // the chain with nothing on the end of it: the row is rendered only while
    // there are tags, so it goes with the last one, and a disabled field's box
    // refuses focus. What is left is the field, which is still on the page.
    const { instance, chip, list, root } = tagsInput('', ' :if="tags.tags().length > 0"');

    chip(0).focus();
    instance.tags.clear();
    flushSync();

    expect(list()).toBe(null);
    expect(document.activeElement).toBe(root());
    // As with the row: this environment focuses whatever it is asked to, so
    // the attribute is the half a browser would be answering.
    expect(root().getAttribute('tabindex')).toBe('-1');
  });

  it('will not hand focus to a ref that is not a text control', () => {
    tagsOptions = { defaultValue: ['ada'] };
    const { instance, chip, list, root } = tagsInput();

    // A `:ref` that landed on the wrapper instead of the control. Focus that
    // goes somewhere nothing can be typed is the dead end `<body>` is, one
    // element further in; a browser would refuse the wrapper and this
    // environment would not, so the refusal has to be the library's.
    instance.input.set(root());
    chip(0).focus();
    instance.tags.removeAt(0);
    flushSync();

    expect(document.activeElement).toBe(list());
  });

  it('holds focus given to the row itself without taking it off the tags', () => {
    tagsOptions = { defaultValue: ['ada', 'grace'] };
    const { instance, chips, list } = tagsInput();

    // Focusable to be handed focus also means focusable by a click in the
    // row's own padding, which is focus in the field but on no tag.
    list().focus();
    instance.tags.removeAt(0);
    flushSync();

    // Nothing to rescue, so nothing is pulled off the row; and the row is out
    // of the tab order, so the tags keep the one stop between them.
    expect(document.activeElement).toBe(list());
    expect(list().getAttribute('tabindex')).toBe('-1');
    expect(chips().map((el) => el.getAttribute('tabindex'))).toEqual(['0']);
  });

  it('leaves focus somewhere useful when a tag goes from the signal it was handed', () => {
    const value = new Signal.State<readonly string[]>(['ada', 'grace']);
    tagsOptions = { value };
    const { chip } = tagsInput();

    chip(0).focus();
    // The value is the consumer's to write, and a tag removed that way
    // destroys the focused element exactly as its own remove control would.
    // Nothing here called `removeAt`, so nothing but the row itself can have
    // noticed.
    value.set(['grace']);
    flushSync();

    expect(document.activeElement).toBe(chip(0));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('falls back to the text box when the signal it was handed is emptied', () => {
    const value = new Signal.State<readonly string[]>(['ada', 'grace']);
    tagsOptions = { value };
    const { chip, input } = tagsInput();

    chip(1).focus();
    value.set([]);
    flushSync();

    expect(document.activeElement).toBe(input());
  });

  it('leaves focus where the user moved it when a tag goes later', () => {
    const value = new Signal.State<readonly string[]>(['ada', 'grace']);
    tagsOptions = { value };
    const { chip, input } = tagsInput();

    chip(0).focus();
    input().focus();
    // Having once held focus is not a claim on it. A tag the user has already
    // left is not somewhere focus has to be put back to, and doing it would
    // pull the caret out of the box they are typing in.
    value.set(['grace']);
    flushSync();

    expect(document.activeElement).toBe(input());
  });

  it('follows the tag holding focus when the row moves under it', () => {
    const value = new Signal.State<readonly string[]>(['ada', 'grace', 'edsger']);
    tagsOptions = { value };
    const { chip } = tagsInput();

    const held = chip(0);
    held.focus();
    // A tag that moves along the row is not a tag that goes: it is still on
    // the page, and still has the focus it had.
    value.set(['zoe', 'ada', 'grace', 'edsger']);
    flushSync();
    expect(document.activeElement).toBe(held);

    value.set(['zoe', 'grace', 'edsger']);
    flushSync();
    // Where 'ada' ended up, not where it started: the tag that took its place
    // is the one the eye is on, and the one before it is a step backwards.
    expect(document.activeElement).toBe(chip(1));
    expect(document.activeElement?.textContent).toContain('grace');
  });

  it('hands off to a tag on the page rather than one only the value has', () => {
    tagsOptions = { defaultValue: ['ada', 'grace', 'edsger'] };
    // A row showing less than the whole value — filtered, or cut short by the
    // space there was for it. After the removal the value is two tags long and
    // the row is one, and only one of those is somewhere focus can be put.
    tagsVisible = (tags) => tags.filter((tag) => tag !== 'edsger');
    const { instance, chip } = tagsInput();

    chip(1).focus();
    instance.tags.removeAt(1);
    flushSync();

    // Clamped against the value the index would point past the end of the row,
    // giving up on a row that still has a tag in it.
    expect(document.activeElement).toBe(chip(0));
    expect(document.activeElement?.textContent).toContain('ada');
  });

  it('lets go of a tag that has left the row', () => {
    const value = new Signal.State<readonly string[]>(['ada', 'grace', 'edsger']);
    tagsOptions = { value };
    const { chip } = tagsInput();

    chip(1).focus();
    const lifted = chip(1);
    // Out of the row and into a layer of its own, as a drag lifts one. It is
    // still on the page, so nothing has been destroyed and there is nothing to
    // rescue — and it is no longer one of the row's tags, so when it does go
    // the field has no business pulling focus back into a box nobody is near.
    document.body.append(lifted);
    value.set(['ada', 'grace']);
    flushSync();

    value.set(['ada']);
    flushSync();

    expect(lifted.isConnected).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('adds a half-typed tag when the field is left', () => {
    const { instance, input } = tagsInput();

    typeInto(input(), 'ada');
    blur(input());
    // The commonest way a tags field loses what someone typed.
    expect(instance.tags.tags()).toEqual(['ada']);
  });

  it('leaves a half-typed tag alone when told to', () => {
    tagsOptions = { addOnBlur: false };
    const { instance, input } = tagsInput();

    typeInto(input(), 'ada');
    blur(input());
    expect(instance.tags.tags()).toEqual([]);
  });

  it('abandons what is half-typed on Escape', () => {
    const { instance, input } = tagsInput();

    typeInto(input(), 'ada');
    expect(press(input(), 'Escape').defaultPrevented).toBe(true);
    expect(instance.tags.draft()).toBe('');
    expect(input().value).toBe('');
  });

  it('stops at the most tags it will hold', () => {
    const onReject = vi.fn();
    tagsOptions = { defaultValue: ['ada'], max: 1, onReject };
    const { instance, input } = tagsInput();

    typeInto(input(), 'grace');
    press(input(), 'Enter');

    expect(instance.tags.tags()).toEqual(['ada']);
    expect(instance.tags.isFull()).toBe(true);
    expect(onReject).toHaveBeenCalledWith('grace', 'full');
    expect(input().hasAttribute('data-full')).toBe(true);
  });

  it('refuses a tag its own rule rejects', () => {
    const onReject = vi.fn();
    tagsOptions = { validateTag: (tag) => tag.length > 2, onReject };
    const { instance, input } = tagsInput();

    typeInto(input(), 'ab');
    press(input(), 'Enter');
    expect(instance.tags.tags()).toEqual([]);
    expect(onReject).toHaveBeenCalledWith('ab', 'invalid');
  });

  it('trims a tag before it goes in', () => {
    const { instance, input } = tagsInput();

    typeInto(input(), '   ada  ');
    press(input(), 'Enter');
    expect(instance.tags.tags()).toEqual(['ada']);
  });

  it('puts required on the field rather than on the text box', () => {
    tagsOptions = { required: () => true, name: 'topics' };
    const { instance, input, form } = tagsInput();

    // An empty text box next to five tags is a filled-in field, so the
    // constraint cannot live on the box.
    expect(input().required).toBe(false);
    expect(input().getAttribute('aria-required')).toBe('true');

    const event = new Event('submit', { bubbles: true, cancelable: true });
    form().dispatchEvent(event);
    flushSync();
    expect(event.defaultPrevented).toBe(true);
    expect(instance.tags.field.isInvalid()).toBe(true);
  });

  it('lets a form with tags in it through', () => {
    tagsOptions = { required: () => true, name: 'topics', defaultValue: ['ada'] };
    const { form } = tagsInput();

    const event = new Event('submit', { bubbles: true, cancelable: true });
    form().dispatchEvent(event);
    flushSync();
    expect(event.defaultPrevented).toBe(false);
  });

  it('can be driven from the signal it was handed', () => {
    const value = new Signal.State<readonly string[]>([]);
    tagsOptions = { value };
    const { labels } = tagsInput();

    value.set(['ada', 'grace']);
    flushSync();
    expect(labels()).toEqual(['ada', 'grace']);
  });
});

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

let ratingOptions: Partial<RatingOptions>;

interface RatingInstance {
  rating: ReturnType<typeof createRating>;
  handled: boolean;
}

function rating() {
  @Component({
    selector: `v-rating-${++selectors}`,
    render: compileTemplate(`
      <form>
        <span :ref="label" :spread="rating.labelProps()">Rating</span>
        <div :ref="group" :spread="rating.groupProps()" :keydown="onKey($event)"
             :pointerleave="rating.preview(null)">
          <label class="star" :for="(v, i) in rating.values()" :key="v"
                 :click="rating.setValue(v)" :pointerenter="rating.preview(v)">
            <input :spread="rating.inputProps(v)">
            <span class="mark" :spread="rating.itemProps(v)">*</span>
          </label>
        </div>
      </form>
    `),
  })
  class RatingComponent {
    group = new Signal.State<Element | null>(null);
    label = new Signal.State<Element | null>(null);
    handled = false;

    rating = createRating({
      ...ratingOptions,
      group: () => this.group.get(),
      label: () => this.label.get(),
    });

    onKey(event: KeyboardEvent): void {
      this.handled = this.rating.onKeyDown(event);
    }
  }

  const handle = track(mount(RatingComponent, host));
  flushSync();

  return {
    instance: handle.instance as unknown as RatingInstance,
    group: () => host.querySelector<HTMLElement>('div')!,
    marks: () => [...host.querySelectorAll<HTMLElement>('.mark')],
    mark: (index: number) => host.querySelectorAll<HTMLElement>('.mark')[index]!,
    stars: () => [...host.querySelectorAll<HTMLElement>('.star')],
    radios: () => [...host.querySelectorAll<HTMLInputElement>('.star input')],
    form: () => host.querySelector('form')!,
  };
}

  it('keeps the stop inside a row a consumer narrowed without touching the value', async () => {
    // The settle effect that clamps the stop observes the value's length and
    // nothing else, so a row narrowed for any other reason — a search term, a
    // filter — never re-runs it. The row is a live DOM query with no reactive
    // surface, which is why the clamp is where it is; this is the path that
    // leaves open.
    tagsOptions = { defaultValue: ['ada', 'grace', 'edsger'] };
    const { instance, chip, chips } = tagsInput();

    chip(2).focus();
    flushSync();
    instance.input.get();
    // Leave the row, so no focus is anywhere to speak for the stop.
    (document.activeElement as HTMLElement | null)?.blur();
    flushSync();

    instance.hidden.set(['edsger']);
    flushSync();
    // The row is observed rather than derived, and a MutationObserver reports
    // on a microtask — so the turn the removal happened in is not the turn the
    // record is corrected in.
    await Promise.resolve();
    flushSync();

    expect(chips()).toHaveLength(2);
    const stops = chips().map((el) => el.getAttribute('tabindex'));
    expect(stops).toContain('0');
  });

describe('rating', () => {
  it('is a radio group, and submits like one', () => {
    ratingOptions = { name: 'score', defaultValue: 3 };
    const { group, marks, radios, form } = rating();

    expect(group().getAttribute('role')).toBe('radiogroup');
    expect(marks()).toHaveLength(5);
    expect(marks().every((el) => el.getAttribute('role') === 'radio')).toBe(true);
    expect(radios().map((el) => el.type)).toEqual(Array(5).fill('radio'));
    // The shared name is what makes five inputs one group.
    expect(submitted(form())).toEqual([['score', '3']]);
  });

  it('names every step rather than leaving a row of bare numbers', () => {
    ratingOptions = { max: 5 };
    const { marks } = rating();

    // "3" in a row of five bare numbers has told the user nothing.
    expect(marks().map((el) => el.getAttribute('aria-label'))).toEqual([
      '1 of 5',
      '2 of 5',
      '3 of 5',
      '4 of 5',
      '5 of 5',
    ]);
  });

  it('states which step is chosen, and which are not', () => {
    ratingOptions = { defaultValue: 2 };
    const { marks } = rating();

    expect(marks().map((el) => el.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
    ]);
  });

  it('holds one tab stop, on the first step until something is chosen', () => {
    const { marks } = rating();
    expect(marks().map((el) => el.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);

    ratingOptions = { defaultValue: 4 };
    newHost();
    const chosen = rating();
    expect(chosen.marks().map((el) => el.getAttribute('tabindex'))).toEqual([
      '-1',
      '-1',
      '-1',
      '0',
      '-1',
    ]);
  });

  it('moves and chooses in one press, the way a radio group does', () => {
    ratingOptions = { name: 'score', defaultValue: 2 };
    const { instance, mark, form } = rating();

    mark(1).focus();
    press(mark(1), 'ArrowRight');
    expect(instance.rating.value()).toBe(3);
    expect(submitted(form())).toEqual([['score', '3']]);

    press(document.activeElement!, 'ArrowLeft');
    expect(instance.rating.value()).toBe(2);
  });

  it('stops at the ends rather than wrapping round', () => {
    ratingOptions = { defaultValue: 5 };
    const { instance, mark } = rating();

    mark(4).focus();
    press(mark(4), 'ArrowRight');
    // Arrowing past five stars back to one is a misclick waiting to happen.
    expect(instance.rating.value()).toBe(5);
  });

  it('sets the score back to nothing on Delete', () => {
    ratingOptions = { name: 'score', defaultValue: 3 };
    const { instance, group, form } = rating();

    expect(press(group(), 'Delete').defaultPrevented).toBe(true);
    expect(instance.rating.value()).toBe(0);
    // Nothing checked, so nothing submitted — which is what "unrated" is.
    expect(submitted(form())).toEqual([]);
  });

  it('keeps the score when clearing is refused', () => {
    ratingOptions = { defaultValue: 3, allowClear: false };
    const { instance, group } = rating();

    press(group(), 'Backspace');
    expect(instance.rating.value()).toBe(3);
  });

  it('chooses on a press', () => {
    ratingOptions = { name: 'score' };
    const { instance, stars, form } = rating();

    click(stars()[3]!);
    expect(instance.rating.value()).toBe(4);
    expect(submitted(form())).toEqual([['score', '4']]);
  });

  it('offers halves when it is asked to', () => {
    ratingOptions = { max: 3, allowHalf: true };
    const { instance, marks } = rating();

    expect(instance.rating.values()).toEqual([0.5, 1, 1.5, 2, 2.5, 3]);
    expect(marks()[0]!.getAttribute('aria-label')).toBe('0.5 of 3');
  });

  it('paints what the pointer is over without committing to it', () => {
    ratingOptions = { defaultValue: 2 };
    const { instance, stars, marks } = rating();

    stars()[3]!.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
    flushSync();

    expect(instance.rating.displayValue()).toBe(4);
    expect(instance.rating.value()).toBe(2);
    expect(marks().map((el) => el.hasAttribute('data-filled'))).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);

    instance.rating.preview(null);
    flushSync();
    expect(instance.rating.displayValue()).toBe(2);
  });

  it('becomes one fact when it only reports a score', () => {
    ratingOptions = { defaultValue: 4, readOnly: () => true };
    const { group, marks } = rating();

    // Five radios nobody can change are five tab stops that do nothing.
    expect(group().getAttribute('role')).toBe('img');
    expect(group().getAttribute('aria-label')).toBe('Rated 4 of 5');
    expect(marks().every((el) => el.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(marks().every((el) => !el.hasAttribute('role'))).toBe(true);
  });

  it('says the score rather than the label when it only reports one', () => {
    ratingOptions = { defaultValue: 4, readOnly: () => true };
    const { group } = rating();

    // A name is computed from `aria-labelledby` ahead of `aria-label`, so the
    // reference borrowed from the field would name this "Rating" and never
    // speak the score — and the stars are aria-hidden, so nothing else would.
    expect(group().getAttribute('aria-label')).toBe('Rated 4 of 5');
    expect(group().hasAttribute('aria-labelledby')).toBe(false);
  });

  it('submits the score it only reports, because read-only is not disabled', () => {
    ratingOptions = { name: 'score', defaultValue: 4, readOnly: () => true };
    const { radios, form } = rating();

    // A disabled control is left out of the submission and a read-only one is
    // not — that is the whole difference between the two states, and a score
    // nobody may change is still the score the form is sending.
    expect(radios().some((el) => el.disabled)).toBe(false);
    expect(submitted(form())).toEqual([['score', '4']]);
  });

  it('still refuses to be changed while it only reports', () => {
    ratingOptions = { name: 'score', defaultValue: 4, readOnly: () => true };
    const { instance, marks, stars, form } = rating();

    click(stars()[0]!);
    expect(instance.rating.value()).toBe(4);
    // No radio to press and no tab stop to reach, either.
    expect(marks().every((el) => !el.hasAttribute('tabindex'))).toBe(true);
    expect(submitted(form())).toEqual([['score', '4']]);
  });

  it('answers no key and no pointer while it only reports', () => {
    ratingOptions = { defaultValue: 4, readOnly: () => true };
    const { instance, group, stars } = rating();

    expect(press(group(), 'ArrowRight').defaultPrevented).toBe(false);
    stars()[0]!.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
    flushSync();
    expect(instance.rating.displayValue()).toBe(4);
  });

  it('submits the score it only reports after the form is reset', async () => {
    ratingOptions = { name: 'score', defaultValue: 4, readOnly: () => true };
    const { instance, radios, form } = rating();

    form().reset();
    await settle();

    // The hidden radios have no `checked` attribute to be restored to — their
    // checkedness is a property — so a reset unchecks all five, and the score
    // the field still reports would submit nothing at all.
    expect(instance.rating.value()).toBe(4);
    expect(radios().filter((el) => el.checked)).toHaveLength(1);
    expect(submitted(form())).toEqual([['score', '4']]);
  });

  it('goes back to the score it started with when the form is reset', async () => {
    ratingOptions = { name: 'score', defaultValue: 2 };
    const { instance, stars, form } = rating();

    click(stars()[4]!);
    expect(submitted(form())).toEqual([['score', '5']]);

    form().reset();
    await settle();

    // What a reset means for every other control in the form: back to the
    // default the markup declared, not back to nothing.
    expect(instance.rating.value()).toBe(2);
    expect(submitted(form())).toEqual([['score', '2']]);
  });

  it('restores a score the caller owns, and it is the caller that hears about it', async () => {
    const value = new Signal.State(4);
    const changes: number[] = [];
    ratingOptions = {
      name: 'score',
      value,
      readOnly: () => true,
      onValueChange: (next) => changes.push(next),
    };
    const { radios, form } = rating();

    value.set(1);
    flushSync();
    form().reset();
    await settle();

    // The signal is the contract, so a reset that put the score back only in
    // the mirrors would leave the caller holding a number the form is no
    // longer sending.
    expect(value.get()).toBe(4);
    expect(changes).toEqual([4]);
    expect(radios().filter((el) => el.checked)).toHaveLength(1);
    expect(submitted(form())).toEqual([['score', '4']]);
  });

  it('goes back to a half step when the form is reset', async () => {
    ratingOptions = { name: 'score', defaultValue: 2.5, allowHalf: true };
    const { instance, marks, stars, form } = rating();

    click(stars()[8]!);
    expect(submitted(form())).toEqual([['score', '4.5']]);

    form().reset();
    await settle();

    // What is painted, what is reported and what submits are one answer, and
    // a half is the one a mirror keyed by whole numbers would miss.
    expect(instance.rating.value()).toBe(2.5);
    expect(marks().filter((el) => el.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(marks()[4]!.getAttribute('aria-checked')).toBe('true');
    expect(submitted(form())).toEqual([['score', '2.5']]);
  });

  it('starts the next answer from nothing when it had no default', async () => {
    ratingOptions = { name: 'score' };
    const { instance, stars, form } = rating();

    click(stars()[2]!);
    form().reset();
    await settle();

    expect(instance.rating.value()).toBe(0);
    expect(submitted(form())).toEqual([]);
  });

  it('does not make a score nobody can set a constraint on the form', () => {
    ratingOptions = { name: 'score', required: () => true, readOnly: () => true };
    const { radios, form } = rating();

    // A required rating nobody may answer is a form that can never be
    // submitted, and the bubble would point at a hidden radio the user cannot
    // act on. The platform bars a disabled control from validation for the
    // same reason, and a read-only one is barred too.
    expect(radios().some((el) => el.required)).toBe(false);
    // Still submitted, though — that is what separates read-only from disabled.
    expect(radios().some((el) => el.disabled)).toBe(false);
    expect(form().checkValidity()).toBe(true);
  });

  it('takes the constraint back the moment the rating can be answered', () => {
    const readOnly = new Signal.State(true);
    ratingOptions = { name: 'score', required: () => true, readOnly: () => readOnly.get() };
    const { radios, form } = rating();

    expect(form().checkValidity()).toBe(true);

    // Read-only is a state a field moves in and out of, so the constraint has
    // to follow it rather than be settled once when the rating was built.
    readOnly.set(false);
    flushSync();

    expect(radios().every((el) => el.required)).toBe(true);
    expect(form().checkValidity()).toBe(false);
  });

  it('reports an unrated required field', () => {
    ratingOptions = { required: () => true, name: 'score' };
    const { instance, radios } = rating();

    // The platform refuses the submit through the hidden radios; this is what
    // puts a message on screen for the same refusal.
    expect(radios().every((el) => el.required)).toBe(true);
    instance.rating.field.report();
    flushSync();
    expect(instance.rating.field.isInvalid()).toBe(true);
  });

  it('can be driven from the signal it was handed', () => {
    const value = new Signal.State(0);
    ratingOptions = { value, name: 'score' };
    const { marks, form } = rating();

    value.set(2);
    flushSync();
    expect(marks()[1]!.getAttribute('aria-checked')).toBe('true');
    expect(submitted(form())).toEqual([['score', '2']]);
  });

  it('borrows the field label for the group without borrowing its id', () => {
    ratingOptions = { defaultValue: 2 };
    const { group } = rating();

    const label = host.querySelector('span')!;
    expect(document.getElementById(group().getAttribute('aria-labelledby')!)).toBe(label);
  });

  it('takes the wording a consumer gives it', () => {
    ratingOptions = {
      defaultValue: 2,
      readOnly: () => true,
      labels: { value: (value, max) => `${value} out of ${max} stars` },
    };
    const { group } = rating();
    expect(group().getAttribute('aria-label')).toBe('2 out of 5 stars');
  });
});
