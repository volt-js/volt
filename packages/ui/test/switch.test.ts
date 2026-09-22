/**
 * `<v-switch>`, driven the way a page drives it.
 *
 * The behaviour is `createSwitch`'s and is tested where it lives. What is
 * tested here is the shell: that what a caller writes on the tag reaches the
 * control rather than the row around it, that both states the sheet draws are
 * on the element its rules select on, that the hidden input a form reads is
 * really there, that every prop forwarded to the primitive does something, and
 * that nothing about the primitive is out of reach.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { VSwitch } from '../src/components/switch.js';

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
const control = (host: HTMLElement): HTMLElement => host.querySelector('.volt-switch')!;
const track = (host: HTMLElement): HTMLElement => host.querySelector('.volt-switch-track')!;
const thumb = (host: HTMLElement): HTMLElement => host.querySelector('.volt-switch-thumb')!;
const mirror = (host: HTMLElement): HTMLInputElement => host.querySelector('input')!;

describe('v-switch', () => {
  it('is a track, a thumb and the words, with the sheet’s classes and the caller’s own', () => {
    @Component({
      selector: 'v-page',
      imports: [VSwitch],
      render: compileTemplate(
        `<v-switch class="mine" id="notify" data-test="row" name="notify">Email me</v-switch>`,
      ),
    })
    class Page {}

    const { host } = show(Page);

    // What the caller wrote lands on the control, which is the element
    // carrying the role and the only one a reader announces.
    expect([...control(host).classList].sort()).toEqual(['mine', 'volt-switch']);
    expect(control(host).id).toBe('notify');
    expect(control(host).dataset['test']).toBe('row');
    expect([...row(host).classList]).toEqual(['volt-switch-field']);
    expect(row(host).id).toBe('');

    expect(control(host).getAttribute('role')).toBe('switch');
    expect(control(host).getAttribute('tabindex')).toBe('0');
    expect(control(host).textContent).toContain('Email me');

    // The track is drawn, not read: the words beside it are the name.
    expect(track(host).getAttribute('aria-hidden')).toBe('true');
    expect(track(host).contains(thumb(host))).toBe(true);

    // Behind it is a real input, hidden by the primitive rather than left out:
    // it is the half that submits, validates and resets.
    expect(mirror(host).type).toBe('checkbox');
    expect(mirror(host).name).toBe('notify');
    expect(mirror(host).getAttribute('aria-hidden')).toBe('true');
    expect(mirror(host).getAttribute('tabindex')).toBe('-1');
    expect(row(host).contains(mirror(host))).toBe(true);
  });

  it('writes every state the sheet’s rules select on', () => {
    @Component({
      selector: 'v-page',
      imports: [VSwitch],
      render: compileTemplate(
        `<v-switch :checked="on" :disabled="off.get()">Email me</v-switch>`,
      ),
    })
    class Page {
      on = new Signal.State(false);
      off = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const state = () => control(host).getAttribute('data-state');

    expect(state()).toBe('unchecked');
    expect(control(host).getAttribute('aria-checked')).toBe('false');

    // A prop bound to a signal follows it, rather than being read once.
    instance.on.set(true);
    flushSync();
    expect(state()).toBe('checked');
    expect(control(host).getAttribute('aria-checked')).toBe('true');
    expect(mirror(host).checked).toBe(true);

    // There is no third state to find: a switch is one setting or the other.
    expect(control(host).getAttribute('aria-checked')).not.toBe('mixed');

    // The sheet dims a control marked `data-disabled`, and only that.
    expect(control(host).hasAttribute('data-disabled')).toBe(false);
    instance.off.set(true);
    flushSync();
    expect(control(host).getAttribute('data-disabled')).toBe('');
    expect(control(host).getAttribute('aria-disabled')).toBe('true');
    // Refused, and still reachable by keyboard, which is the package's rule
    // for every disabled control.
    expect(control(host).getAttribute('tabindex')).toBe('0');
    expect(mirror(host).disabled).toBe(true);

    row(host).click();
    flushSync();
    expect(instance.on.get()).toBe(true);
  });

  it('commits on a press, wherever in the row it lands, and once', () => {
    const changes: boolean[] = [];

    @Component({
      selector: 'v-page',
      imports: [VSwitch],
      render: compileTemplate(
        `<v-switch :checked="on" :onCheckedChange="record">Email me</v-switch>`,
      ),
    })
    class Page {
      on = new Signal.State(false);
      record = (checked: boolean): void => void changes.push(checked);
    }

    const { instance, host } = show(Page);

    // The words: a label forwards this press to the hidden input it labels, so
    // a row that does not swallow that one toggles twice and looks dead.
    row(host).click();
    flushSync();
    expect(instance.on.get()).toBe(true);
    expect(changes).toEqual([true]);

    // And the track, which is what most people will aim at.
    track(host).click();
    flushSync();
    expect(instance.on.get()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('takes Space and leaves Enter to the form', () => {
    @Component({
      selector: 'v-page',
      imports: [VSwitch],
      render: compileTemplate(`<v-switch :checked="on">Email me</v-switch>`),
    })
    class Page {
      on = new Signal.State(false);
    }

    const { instance, host } = show(Page);

    const space = press(control(host), ' ');
    expect(instance.on.get()).toBe(true);
    // Uncancelled, Space scrolls the page.
    expect(space.defaultPrevented).toBe(true);

    const enter = press(control(host), 'Enter');
    expect(instance.on.get()).toBe(true);
    expect(enter.defaultPrevented).toBe(false);
  });

  it('submits with the form it is written in, and only while on', () => {
    @Component({
      selector: 'v-page',
      imports: [VSwitch],
      render: compileTemplate(`
        <form>
          <v-switch :checked="on" :required="must.get()" name="notify" value="email">
            Email me
          </v-switch>
        </form>
      `),
    })
    class Page {
      on = new Signal.State(false);
      must = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const form = host.querySelector('form')!;
    const submitted = (): [string, FormDataEntryValue][] => [...new FormData(form).entries()];

    expect(submitted()).toEqual([]);

    row(host).click();
    flushSync();
    // `value` is what goes under the name, rather than the `on` a native
    // checkbox falls back to.
    expect(submitted()).toEqual([['notify', 'email']]);

    // `required` is the platform's to enforce, which is why it reaches the
    // input rather than stopping at the ARIA.
    instance.on.set(false);
    instance.must.set(true);
    flushSync();
    expect(control(host).getAttribute('aria-required')).toBe('true');
    expect(mirror(host).required).toBe(true);
    expect(form.checkValidity()).toBe(false);

    instance.on.set(true);
    flushSync();
    expect(form.checkValidity()).toBe(true);

    // A reset puts back what the switch was built with, on both halves.
    form.reset();
    flushSync();
    expect(instance.on.get()).toBe(false);
    expect(control(host).getAttribute('data-state')).toBe('unchecked');
  });

  it('starts where it was told to, when the state is its own', () => {
    @Component({
      selector: 'v-page',
      imports: [VSwitch],
      render: compileTemplate(`<v-switch :defaultChecked="true">Email me</v-switch>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(control(host).getAttribute('data-state')).toBe('checked');
    expect(mirror(host).checked).toBe(true);

    row(host).click();
    flushSync();
    expect(control(host).getAttribute('data-state')).toBe('unchecked');
  });

  it('leaves off every name it was not given, rather than leaving one empty', () => {
    @Component({
      selector: 'v-page',
      imports: [VSwitch],
      render: compileTemplate(`<v-switch>Email me</v-switch>`),
    })
    class Page {}

    const { host } = show(Page);

    // A switch named by the words inside it carries none of the three. An
    // empty `aria-label` is a name a reader has to decide what to do with,
    // and an empty `aria-labelledby` or `aria-describedby` is a list of ids
    // pointing at nothing — all three are ways of saying nothing that a
    // reader may take for something.
    const names = ['aria-label', 'aria-labelledby', 'aria-describedby'];
    for (const name of names) expect(control(host).hasAttribute(name), name).toBe(false);

    // And still none of them once the bag has been written again, which is
    // where a value that is nothing tends to arrive.
    row(host).click();
    flushSync();
    for (const name of names) expect(control(host).hasAttribute(name), name).toBe(false);
  });

  it('names a switch that has no words of its own', () => {
    @Component({
      selector: 'v-page',
      imports: [VSwitch],
      render: compileTemplate(`
        <span id="heading">Email me about replies</span>
        <v-switch label="Email"></v-switch>
        <v-switch labelledBy="heading"></v-switch>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const controls = [...host.querySelectorAll('.volt-switch')];

    expect(controls[0]!.getAttribute('aria-label')).toBe('Email');
    expect(controls[1]!.getAttribute('aria-labelledby')).toBe('heading');
  });

  it('follows a name that changes, and keeps it across a press', () => {
    @Component({
      selector: 'v-page',
      imports: [VSwitch],
      render: compileTemplate(`<v-switch :label="name.get()"></v-switch>`),
    })
    class Page {
      name = new Signal.State('Email me');
    }

    const { instance, host } = show(Page);
    expect(control(host).getAttribute('aria-label')).toBe('Email me');

    instance.name.set('Email me about replies');
    flushSync();
    expect(control(host).getAttribute('aria-label')).toBe('Email me about replies');

    // The control's attributes are rewritten on every change of state, and a
    // name written beside them rather than among them is wiped by the first
    // press.
    row(host).click();
    flushSync();
    expect(control(host).getAttribute('aria-label')).toBe('Email me about replies');
  });

  it('prefers the name the caller wrote in the platform’s own spelling', () => {
    @Component({
      selector: 'v-page',
      imports: [VSwitch],
      render: compileTemplate(`
        <span id="heading">Email me about replies</span>
        <v-switch aria-label="Email" label="stale"></v-switch>
        <v-switch aria-labelledby="heading" labelledBy="stale"></v-switch>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const controls = [...host.querySelectorAll('.volt-switch')];

    // Two spellings of one name can only disagree by mistake, and the one on
    // the tag is the one that counts.
    expect(controls[0]!.getAttribute('aria-label')).toBe('Email');
    expect(controls[1]!.getAttribute('aria-labelledby')).toBe('heading');
    expect(row(host).hasAttribute('aria-label')).toBe(false);
  });

  it('describes the control, including a message that arrives later', () => {
    @Component({
      selector: 'v-page',
      imports: [VSwitch],
      render: compileTemplate(`
        <span id="hint">We will only email you about replies.</span>
        <v-switch :aria-describedby="described.get()">Email me</v-switch>
      `),
    })
    class Page {
      described = new Signal.State('hint');
    }

    const { instance, host } = show(Page);
    expect(control(host).getAttribute('aria-describedby')).toBe('hint');

    instance.described.set('hint error');
    flushSync();
    expect(control(host).getAttribute('aria-describedby')).toBe('hint error');
  });

  it('draws what a caller put in the thumb, with the setting to draw it from', () => {
    @Component({
      selector: 'v-page2',
      imports: [VSwitch],
      render: compileTemplate(`
        <v-switch :checked="on">
          <template :slot-thumb="{ checked }"><i>{ checked ? 'on' : 'off' }</i></template>
          Email me
        </v-switch>
      `),
    })
    class Page2 {
      on = new Signal.State(false);
    }

    const { instance, host } = show(Page2);
    const mark = (): string | undefined => thumb(host).querySelector('i')?.textContent ?? undefined;

    expect(mark()).toBe('off');

    // The slot's values are live, so the mark follows the setting it was
    // handed rather than being built again for it.
    instance.on.set(true);
    flushSync();
    expect(mark()).toBe('on');
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    @Component({
      selector: 'v-page3',
      imports: [VSwitch],
      render: compileTemplate(`<v-switch :ref="notify">Email me</v-switch>`),
    })
    class Page3 {
      notify: VSwitch | null = null;
    }

    const { instance, host } = show(Page3);
    expect(instance.notify?.switch.checked()).toBe(false);

    instance.notify!.switch.setChecked(true);
    flushSync();
    expect(control(host).getAttribute('data-state')).toBe('checked');
    expect(instance.notify!.switch.isDisabled()).toBe(false);
  });
});
