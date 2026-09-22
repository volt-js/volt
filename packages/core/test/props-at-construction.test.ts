/**
 * When a prop is there.
 *
 * A prop used to land after the constructor returned, so a field initializer
 * — which is where Volt tells you to do your setup — saw the default and never
 * the value. Every component built over a primitive hits that: the primitive
 * is made in a field, and what it is made with is a prop.
 *
 * `@Prop` is a field initializer now, so the field takes the value as it is
 * made, and a field declared after it sees what the parent passed.
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

describe('a prop while the fields are being made', () => {
  it('is what a field built from it is built with', () => {
    @Component({ selector: 'v-greet', render: compileTemplate(`<b>{ greeting }</b>`) })
    class Greet {
      @Prop() name = 'nobody';
      // The shape every component over a primitive has: something made in a
      // field, out of a prop.
      greeting = `Hello, ${this.name}.`;
    }

    @Component({
      selector: 'v-page',
      imports: [Greet],
      render: compileTemplate(`<v-greet name="Ada"></v-greet>`),
    })
    class Page {}

    expect(show(Page).host.querySelector('b')!.textContent).toBe('Hello, Ada.');
  });

  it('is in the signal a field reads at construction', () => {
    @Component({ selector: 'v-count', render: compileTemplate(`<b>{ doubledAtBirth }</b>`) })
    class Count {
      @Prop() start = new Signal.State(0);
      // Read now, not lazily: this is the value the field was built from.
      doubledAtBirth = this.start.get() * 2;
    }

    @Component({
      selector: 'v-page',
      imports: [Count],
      render: compileTemplate(`<v-count :start="21"></v-count>`),
    })
    class Page {}

    const { host } = show(Page);
    expect(host.querySelector('b')!.textContent).toBe('42');
  });

  it('keeps a dynamic prop live after the field has taken it', () => {
    @Component({ selector: 'v-label', render: compileTemplate(`<b>{ caption.get() }</b>`) })
    class Label {
      @Prop() caption = new Signal.State('');
      firstSeen = this.caption.get();
    }

    @Component({
      selector: 'v-page',
      imports: [Label],
      render: compileTemplate(`<v-label :caption="word.get()"></v-label>`),
    })
    class Page {
      word = new Signal.State('one');
    }

    const { instance, host } = show(Page);
    expect(host.querySelector('b')!.textContent).toBe('one');

    instance.word.set('two');
    flushSync();
    expect(host.querySelector('b')!.textContent).toBe('two');
  });

  it('leaves the default alone where the parent passed nothing', () => {
    @Component({ selector: 'v-plain', render: compileTemplate(`<b>{ label }</b>`) })
    class Plain {
      @Prop() label = 'default';
      copy = this.label;
    }

    @Component({
      selector: 'v-page',
      imports: [Plain],
      render: compileTemplate(`<v-plain></v-plain>`),
    })
    class Page {}

    expect(show(Page).host.querySelector('b')!.textContent).toBe('default');
  });

  it('is still a class a test can construct with new', () => {
    @Component({ selector: 'v-alone', render: compileTemplate(`<b>{ label }</b>`) })
    class Alone {
      @Prop() label = 'default';
    }

    expect(new Alone().label).toBe('default');
  });
});
