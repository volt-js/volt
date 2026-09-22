/**
 * What a caller may write on a component's tag.
 *
 * Volt refuses a prop a component does not declare, which is what catches
 * `max-count` written for `maxCount`. That left nowhere for the things a
 * caller writes about the element rather than the component — a class, a
 * style, an `aria-label` — so `<v-button class="wide">` was an error and a
 * component library could not be used.
 *
 * `:host` is the component saying which element stands for it. What the caller
 * wrote lands there, merged rather than replacing: the template's own classes
 * stay, and a style of its own survives one written on the tag.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Prop, Signal, flushSync, mount } from '@voltdev/core';

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

@Component({
  selector: 'v-button',
  render: compileTemplate(`<button :host class="volt-button" type="button"><slot></slot></button>`),
})
class Button {
  @Prop() variant = 'primary';
}

describe('what a caller writes on the tag', () => {
  it('reaches the element the template marks, keeping the template’s own classes', () => {
    @Component({
      selector: 'v-page',
      imports: [Button],
      render: compileTemplate(`<v-button class="wide" aria-label="Save" id="save">Go</v-button>`),
    })
    class Page {}

    const button = show(Page).host.querySelector('button')!;
    expect([...button.classList].sort()).toEqual(['volt-button', 'wide']);
    expect(button.getAttribute('aria-label')).toBe('Save');
    expect(button.id).toBe('save');
    expect(button.type).toBe('button');
  });

  it('stays live when what was written is an expression', () => {
    @Component({
      selector: 'v-page',
      imports: [Button],
      render: compileTemplate(`<v-button :class="{ busy: busy.get() }">Go</v-button>`),
    })
    class Page {
      busy = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    const button = host.querySelector('button')!;
    expect(button.classList.contains('busy')).toBe(false);

    instance.busy.set(true);
    flushSync();
    expect(button.classList.contains('busy')).toBe(true);
    expect(button.classList.contains('volt-button')).toBe(true);
  });

  it('is still a prop where the component declares one', () => {
    @Component({
      selector: 'v-page',
      imports: [Button],
      render: compileTemplate(`<v-button variant="danger">Go</v-button>`),
    })
    class Page {}

    // `variant` is declared, so it is the prop it looks like and never an
    // attribute on the button.
    expect(show(Page).host.querySelector('button')!.getAttribute('variant')).toBe(null);
  });

  it('still refuses a prop the component does not declare', () => {
    @Component({
      selector: 'v-typo',
      render: compileTemplate(`<button :host>x</button>`),
    })
    class Typo {
      @Prop() maxCount = 1;
    }

    @Component({
      selector: 'v-page',
      imports: [Typo],
      render: compileTemplate(`<v-typo max-count="2"></v-typo>`),
    })
    class Page {}

    expect(() => show(Page)).toThrow(/has no prop "max-count".*Did you mean "maxCount"/);
  });

  it('says so when there is nowhere to put what was written', () => {
    @Component({ selector: 'v-plain', render: compileTemplate(`<span>x</span>`) })
    class Plain {}

    @Component({
      selector: 'v-page',
      imports: [Plain],
      render: compileTemplate(`<v-plain class="wide"></v-plain>`),
    })
    class Page {}

    expect(() => show(Page)).toThrow(/marks no element with `:host`/);
  });
});

describe('a tag that writes a class and binds one', () => {
  it('keeps both, as an element does', () => {
    @Component({
      selector: 'v-page',
      imports: [Button],
      render: compileTemplate(`<v-button class="wide" :class="{ busy: busy.get() }">Go</v-button>`),
    })
    class Page {
      busy = new Signal.State(true);
    }

    const button = show(Page).host.querySelector('button')!;
    expect([...button.classList].sort()).toEqual(['busy', 'volt-button', 'wide']);
  });
});

