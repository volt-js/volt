/**
 * What `:spread` remembers from one object to the next.
 *
 * A primitive's part is a bag rebuilt whenever the state beneath it changes,
 * and a bag that builds its handler inside the method hands `:spread` a new
 * function every time. Each was added with `addEventListener` and none was
 * ever taken back, so a button whose bag had been rebuilt twice ran its
 * handler three times a click — the clipboard trigger copied once per status
 * it had been through. A handler dropped from the bag kept firing for the same
 * reason.
 *
 * Classes and styles had the same fault in another shape: each object's were
 * written by a binding made for that object alone, which had no record of what
 * the last one added. A class the next object did not carry stayed on the
 * element, and an object with no `class` at all removed the whole attribute —
 * the template's own classes with it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = '';
});

function render<T>(component: new () => T): { instance: T; button: HTMLButtonElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mount(component, host);
  unmount = handle.unmount;
  return { instance: handle.instance as T, button: host.querySelector('button')! };
}

describe(':spread and the handlers in its bag', () => {
  it('runs a handler rebuilt with every bag once per click, however often it was rebuilt', () => {
    @Component({
      selector: 'v-copy',
      render: compileTemplate(`<button :spread="props()">copy</button>`),
    })
    class Copy {
      status = new Signal.State('idle');
      copies = 0;
      props(): Record<string, unknown> {
        // A fresh arrow per call, as a bag built inside its method has.
        return { 'data-state': this.status.get(), onclick: () => this.copies++ };
      }
    }

    const { instance, button } = render(Copy);
    instance.status.set('copied');
    flushSync();
    instance.status.set('idle');
    flushSync();
    expect(button.getAttribute('data-state')).toBe('idle');

    button.click();
    expect(instance.copies).toBe(1);
  });

  it('stops running a handler the bag no longer carries', () => {
    @Component({
      selector: 'v-toggle-handler',
      render: compileTemplate(`<button :spread="props()">go</button>`),
    })
    class ToggleHandler {
      armed = new Signal.State(true);
      runs = 0;
      handle = (): void => {
        this.runs++;
      };
      props(): Record<string, unknown> {
        return this.armed.get() ? { onclick: this.handle } : {};
      }
    }

    const { instance, button } = render(ToggleHandler);
    button.click();
    expect(instance.runs).toBe(1);

    instance.armed.set(false);
    flushSync();
    button.click();
    expect(instance.runs).toBe(1);

    instance.armed.set(true);
    flushSync();
    button.click();
    expect(instance.runs).toBe(2);
  });

  it('adds a handler kept as the same function once, across every update', () => {
    @Component({
      selector: 'v-stable',
      render: compileTemplate(`<button :spread="props()">go</button>`),
    })
    class Stable {
      tick = new Signal.State(0);
      runs = 0;
      handle = (): void => {
        this.runs++;
      };
      props(): Record<string, unknown> {
        return { 'data-tick': this.tick.get(), onclick: this.handle };
      }
    }

    const { instance, button } = render(Stable);
    for (let i = 1; i <= 3; i++) {
      instance.tick.set(i);
      flushSync();
    }
    button.click();
    expect(instance.runs).toBe(1);
  });
});

describe(':spread and the class and style in its bag', () => {
  @Component({
    selector: 'v-styled-bag',
    render: compileTemplate(`<div class="fixed" style="margin: 1px" :spread="props()"></div>`),
  })
  class StyledBag {
    step = new Signal.State(0);
    props(): Record<string, unknown> {
      const step = this.step.get();
      if (step === 0) return { class: 'a', style: { color: 'red' } };
      if (step === 1) return { class: 'b', style: { fontWeight: 'bold' } };
      return {};
    }
  }

  function element(): { instance: StyledBag; el: HTMLElement } {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = mount(StyledBag, host);
    unmount = handle.unmount;
    return { instance: handle.instance as StyledBag, el: host.querySelector('div')! };
  }

  it('takes back a class or a style property the next object does not carry', () => {
    const { instance, el } = element();
    expect([...el.classList]).toEqual(['fixed', 'a']);
    instance.step.set(1);
    flushSync();
    expect([...el.classList]).toEqual(['fixed', 'b']);
    expect(el.style.getPropertyValue('color')).toBe('');
    expect(el.style.getPropertyValue('font-weight')).toBe('bold');
  });

  it("keeps the template's own class and style when an object drops both", () => {
    const { instance, el } = element();
    instance.step.set(2);
    flushSync();
    expect([...el.classList]).toEqual(['fixed']);
    expect(el.style.getPropertyValue('margin')).toBe('1px');
    expect(el.style.getPropertyValue('color')).toBe('');
  });
});
