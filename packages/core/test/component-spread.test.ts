/**
 * A bag of props spread onto a component's tag.
 *
 * It used to be spread into the props object once, so the child kept whatever
 * the bag held when the tag was first rendered. That is the shape a component
 * library is made of — a part handed a primitive's props — and it meant a
 * trigger given `dialog.triggerProps()` froze at its first `aria-expanded`
 * and never said it was open again.
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

@Component({ selector: 'v-readout', render: compileTemplate(`<b>{ state.get() } { extra }</b>`) })
class Readout {
  // A signal, which is what makes a prop reactive here; `extra` is the plain
  // form, which is a value the child is given once.
  @Prop() state = new Signal.State('closed');
  @Prop() extra = '-';
}

describe('a component given a bag', () => {
  it('sees what the bag holds now, not what it held first', () => {
    @Component({
      selector: 'v-page',
      imports: [Readout],
      render: compileTemplate(`<v-readout :spread="bag()"></v-readout>`),
    })
    class Page {
      open = new Signal.State(false);
      bag(): Record<string, unknown> {
        return { state: this.open.get() ? 'open' : 'closed' };
      }
    }

    const { instance, host } = show(Page);
    expect(host.querySelector('b')!.textContent).toBe('closed -');

    instance.open.set(true);
    flushSync();
    expect(host.querySelector('b')!.textContent).toBe('open -');
  });

  it('lets what the tag writes itself win over the bag', () => {
    @Component({
      selector: 'v-page',
      imports: [Readout],
      render: compileTemplate(`<v-readout :spread="bag()" state="mine"></v-readout>`),
    })
    class Page {
      bag(): Record<string, unknown> {
        return { state: 'theirs', extra: 'from the bag' };
      }
    }

    expect(show(Page).host.querySelector('b')!.textContent).toBe('mine from the bag');
  });

  it('still refuses a prop the component does not declare', () => {
    @Component({
      selector: 'v-page',
      imports: [Readout],
      render: compileTemplate(`<v-readout :spread="bag()"></v-readout>`),
    })
    class Page {
      bag(): Record<string, unknown> {
        return { stat: 'typo' };
      }
    }

    expect(() => show(Page)).toThrow(/has no prop "stat"/);
  });
});
