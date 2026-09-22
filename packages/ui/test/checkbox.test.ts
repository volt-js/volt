/**
 * `<v-checkbox>`, driven the way a page drives it.
 *
 * The behaviour is `createCheckbox`'s and is tested where it lives. What is
 * tested here is the shell: that what a caller writes on the tag reaches the
 * row — or, when it says what the control is called, the control — that the
 * three states the sheet draws are on the element its rules select on, that
 * the hidden input the form reads is really there, and that nothing about the
 * primitive is out of reach.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { VCheckbox } from '../src/components/checkbox.js';
import type { CheckedState } from '@voltdev/primitives';

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

/** A keydown as the user sends it: bubbling, and cancellable. */
function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

const row = (host: HTMLElement): HTMLLabelElement => host.querySelector('label')!;
const control = (host: HTMLElement): HTMLElement => host.querySelector('.volt-checkbox')!;
const box = (host: HTMLElement): HTMLInputElement => host.querySelector('input')!;

describe('v-checkbox', () => {
  it('is a row of a box and its words, with the sheet’s classes and the caller’s own', () => {
    @Component({
      selector: 'v-page',
      imports: [VCheckbox],
      render: compileTemplate(
        `<v-checkbox class="mine" id="terms" name="terms">I accept the terms</v-checkbox>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // What the caller wrote lands on the row, which is the element they can
    // see and the one they would have put a class on by hand.
    expect([...row(host).classList].sort()).toEqual(['mine', 'volt-checkbox-field']);
    expect(row(host).id).toBe('terms');

    expect(control(host).getAttribute('role')).toBe('checkbox');
    expect(control(host).getAttribute('tabindex')).toBe('0');
    expect(control(host).textContent).toContain('I accept the terms');

    // The box is a real input, hidden by the primitive rather than left out:
    // it is the half that submits, validates and resets.
    expect(box(host).type).toBe('checkbox');
    expect(box(host).name).toBe('terms');
    expect(box(host).getAttribute('aria-hidden')).toBe('true');
    expect(box(host).getAttribute('tabindex')).toBe('-1');
    expect(row(host).contains(box(host))).toBe(true);
  });

  it('writes every state the sheet’s rules select on', () => {
    @Component({
      selector: 'v-page',
      imports: [VCheckbox],
      render: compileTemplate(
        `<v-checkbox :checked="agreed" :disabled="off.get()">Terms</v-checkbox>`,
      ),
    })
    class Page {
      agreed = new Signal.State<CheckedState>(false);
      off = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const state = () => control(host).getAttribute('data-state');

    expect(state()).toBe('unchecked');
    expect(control(host).getAttribute('aria-checked')).toBe('false');

    instance.agreed.set(true);
    flushSync();
    expect(state()).toBe('checked');
    expect(control(host).getAttribute('aria-checked')).toBe('true');
    expect(box(host).checked).toBe(true);

    instance.agreed.set('indeterminate');
    flushSync();
    expect(state()).toBe('indeterminate');
    // Mixed to a screen reader; a property with no attribute behind it on the
    // input, which is the only place the platform can be told about it.
    expect(control(host).getAttribute('aria-checked')).toBe('mixed');
    expect(box(host).indeterminate).toBe(true);

    // The sheet dims a row marked `data-disabled`, and only that.
    expect(control(host).hasAttribute('data-disabled')).toBe(false);
    instance.off.set(true);
    flushSync();
    expect(control(host).getAttribute('data-disabled')).toBe('');
    expect(control(host).getAttribute('aria-disabled')).toBe('true');
    // Refused, and still reachable by keyboard, which is the package's rule
    // for every disabled control.
    expect(control(host).getAttribute('tabindex')).toBe('0');
    expect(box(host).hasAttribute('disabled')).toBe(true);
  });

  it('draws the mark in every state, so the box cannot change size', () => {
    @Component({
      selector: 'v-page',
      imports: [VCheckbox],
      render: compileTemplate(`<v-checkbox :checked="agreed">Terms</v-checkbox>`),
    })
    class Page {
      agreed = new Signal.State<CheckedState>(false);
    }

    const { instance, host } = show(Page);
    const indicator = host.querySelector('.volt-checkbox-indicator')!;

    // Present while unchecked — the sheet hides it by drawing it in no colour
    // — and read by nobody, since the words next to it are the name.
    expect(indicator.textContent).toBe('✓');
    expect(indicator.getAttribute('aria-hidden')).toBe('true');

    instance.agreed.set('indeterminate');
    flushSync();
    expect(indicator.textContent).toBe('–');
  });

  it('draws the mark a caller wrote instead, with the state to draw it from', () => {
    @Component({
      selector: 'v-page2',
      imports: [VCheckbox],
      render: compileTemplate(`
        <v-checkbox :checked="agreed">
          <template :slot-mark="{ state }">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path :d="state === 'indeterminate' ? 'M3 8h10' : 'M3 8l4 4 6-8'"
                    fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
          </template>
          Terms
        </v-checkbox>
      `),
    })
    class Page2 {
      agreed = new Signal.State<CheckedState>(true);
    }

    const { instance, host } = show(Page2);
    const path = (): string | null =>
      host.querySelector('.volt-checkbox-indicator path')!.getAttribute('d');
    expect(path()).toBe('M3 8l4 4 6-8');

    // The slot's values are live, so the mark follows the state it was handed
    // rather than being built again for it.
    instance.agreed.set('indeterminate');
    flushSync();
    expect(path()).toBe('M3 8h10');
  });

  it('toggles once on a press, wherever in the row it lands', () => {
    const changes: CheckedState[] = [];

    @Component({
      selector: 'v-page',
      imports: [VCheckbox],
      render: compileTemplate(
        `<v-checkbox :checked="agreed" :onCheckedChange="record">Terms</v-checkbox>`,
      ),
    })
    class Page {
      agreed = new Signal.State<CheckedState>(false);
      record = (state: CheckedState): void => void changes.push(state);
    }

    const { instance, host } = show(Page);

    // The words: a label forwards this press to the hidden input it labels, so
    // a row that does not swallow that one toggles twice and looks dead.
    row(host).click();
    flushSync();
    expect(instance.agreed.get()).toBe(true);
    expect(changes).toEqual([true]);

    control(host).click();
    flushSync();
    expect(instance.agreed.get()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('takes Space and leaves Enter to the form', () => {
    @Component({
      selector: 'v-page',
      imports: [VCheckbox],
      render: compileTemplate(`<v-checkbox :checked="agreed">Terms</v-checkbox>`),
    })
    class Page {
      agreed = new Signal.State<CheckedState>(false);
    }

    const { instance, host } = show(Page);

    const space = press(control(host), ' ');
    expect(instance.agreed.get()).toBe(true);
    // Uncancelled, Space scrolls the page.
    expect(space.defaultPrevented).toBe(true);

    const enter = press(control(host), 'Enter');
    expect(instance.agreed.get()).toBe(true);
    expect(enter.defaultPrevented).toBe(false);
  });

  it('submits with the form it is written in, and only while checked', () => {
    @Component({
      selector: 'v-page',
      imports: [VCheckbox],
      render: compileTemplate(`
        <form>
          <v-checkbox :checked="agreed" :required="must.get()" name="terms" value="yes">
            Terms
          </v-checkbox>
        </form>
      `),
    })
    class Page {
      agreed = new Signal.State<CheckedState>(false);
      must = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;
    const submitted = (): [string, FormDataEntryValue][] => [...new FormData(form).entries()];

    expect(submitted()).toEqual([]);

    row(host).click();
    flushSync();
    expect(submitted()).toEqual([['terms', 'yes']]);

    // A box the user has not answered is not a box that is off: on the
    // platform `indeterminate` is presentation, and checkedness alone submits.
    instance.agreed.set('indeterminate');
    flushSync();
    expect(submitted()).toEqual([]);

    // `required` is the platform's to enforce, which is why it reaches the
    // input rather than stopping at the ARIA.
    instance.must.set(true);
    flushSync();
    expect(control(host).getAttribute('aria-required')).toBe('true');
    expect(box(host).required).toBe(true);
    expect(form.checkValidity()).toBe(false);

    instance.agreed.set(true);
    flushSync();
    expect(form.checkValidity()).toBe(true);
  });

  it('names a box that has no words of its own', () => {
    @Component({
      selector: 'v-page',
      imports: [VCheckbox],
      render: compileTemplate(`<v-checkbox label="Select row"></v-checkbox>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(control(host).getAttribute('aria-label')).toBe('Select row');
    expect(control(host).textContent?.trim()).toBe('✓');
  });

  it('starts where it was told to, when the state is its own', () => {
    @Component({
      selector: 'v-page',
      imports: [VCheckbox],
      render: compileTemplate(`<v-checkbox defaultChecked="indeterminate">Terms</v-checkbox>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(control(host).getAttribute('data-state')).toBe('indeterminate');

    // Indeterminate counts as unchecked, so the first press checks it.
    row(host).click();
    flushSync();
    expect(control(host).getAttribute('data-state')).toBe('checked');
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page3',
      imports: [VCheckbox],
      render: compileTemplate(`<v-checkbox :ref="terms">Terms</v-checkbox>`),
    })
    class Page3 {
      terms: VCheckbox | null = null;
    }

    const { instance, host } = show(Page3);
    expect(instance.terms?.checkbox.checked()).toBe(false);

    instance.terms!.checkbox.setChecked('indeterminate');
    flushSync();
    expect(instance.terms!.checkbox.isIndeterminate()).toBe(true);
    expect(control(host).getAttribute('data-state')).toBe('indeterminate');
  });

  it('names the control, not the row, when the name is written in ARIA', () => {
    @Component({
      selector: 'v-page',
      imports: [VCheckbox],
      render: compileTemplate(`<v-checkbox aria-label="Select row"></v-checkbox>`),
    })
    class Page {}

    const { host } = show(Page);

    // The row carries no role, so a name on it names nothing. It belongs on
    // the element the reader announces.
    expect(control(host).getAttribute('aria-label')).toBe('Select row');
    expect(row(host).hasAttribute('aria-label')).toBe(false);

    // And it is still there after the state moved: the control's attributes
    // are rewritten on every change, and a name written beside them rather
    // than among them is wiped by the first press.
    row(host).click();
    flushSync();
    expect(control(host).getAttribute('aria-label')).toBe('Select row');
  });

  it('takes its name from an element that already says it', () => {
    @Component({
      selector: 'v-page',
      imports: [VCheckbox],
      render: compileTemplate(`
        <span id="heading">Ship to this address</span>
        <v-checkbox labelledBy="heading"></v-checkbox>
        <v-checkbox aria-labelledby="heading" labelledBy="stale"></v-checkbox>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const controls = [...host.querySelectorAll('.volt-checkbox')];

    expect(controls[0]!.getAttribute('aria-labelledby')).toBe('heading');
    expect(row(host).hasAttribute('aria-labelledby')).toBe(false);

    // Two spellings of one name can only disagree by mistake, and the one the
    // caller wrote on the tag is the one that counts.
    expect(controls[1]!.getAttribute('aria-labelledby')).toBe('heading');
  });

  it('follows a name that changes', () => {
    @Component({
      selector: 'v-page',
      imports: [VCheckbox],
      render: compileTemplate(`<v-checkbox :label="name.get()"></v-checkbox>`),
    })
    class Page {
      name = new Signal.State('Select this row');
    }

    const { instance, host } = show(Page);
    expect(control(host).getAttribute('aria-label')).toBe('Select this row');

    instance.name.set('Select every row');
    flushSync();
    expect(control(host).getAttribute('aria-label')).toBe('Select every row');
  });

  it('describes the control, including a message that arrives later', () => {
    @Component({
      selector: 'v-page',
      imports: [VCheckbox],
      render: compileTemplate(`
        <span id="hint">We will email you a copy.</span>
        <span id="error">You have to accept them to go on.</span>
        <v-checkbox aria-describedby="hint">Terms</v-checkbox>
        <v-checkbox :aria-describedby="described.get()">Terms</v-checkbox>
      `),
    })
    class Page {
      described = new Signal.State('hint');
    }

    const { instance, host } = show(Page);
    const controls = [...host.querySelectorAll('.volt-checkbox')];

    expect(controls[0]!.getAttribute('aria-describedby')).toBe('hint');
    expect(row(host).hasAttribute('aria-describedby')).toBe(false);

    // What a form field computes moves as the field does: the hint alone
    // while nothing is wrong, the hint and the message once something is.
    expect(controls[1]!.getAttribute('aria-describedby')).toBe('hint');
    instance.described.set('hint error');
    flushSync();
    expect(controls[1]!.getAttribute('aria-describedby')).toBe('hint error');
  });
});
