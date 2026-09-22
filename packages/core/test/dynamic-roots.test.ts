/**
 * A template whose roots are several, one of them dynamic.
 *
 * `<b>x</b><i :for="…">` has two roots, and the second is a hole: the compiler
 * builds the pair in a fragment, puts a marker where the loop goes, and hands
 * the caller the fragment's children to place. Which means the binding that
 * fills the hole is made while its marker is still in the fragment, and is
 * used long after the nodes have been moved into the page.
 *
 * It remembered the fragment. The first render was right — everything was
 * still in there — and every render after it inserted into a fragment nobody
 * was looking at, or threw for inserting before a marker that had left. A list
 * that grew after a header stopped growing; the header made it look fine.
 *
 * A marker is the one node a binding can always ask, because it sits in the
 * content it delimits and goes wherever that content goes. So the parent is
 * read from the marker at the moment of writing rather than remembered from
 * the moment of building.
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

@Component({ selector: 'v-frame', render: compileTemplate(`<div><slot></slot></div>`) })
class Frame {}

@Component({ selector: 'v-kid', render: compileTemplate(`<i>{ n }</i>`) })
class Kid {
  @Prop() n = 0;
}

describe('a loop that is one root among several', () => {
  @Component({
    selector: 'v-listed',
    render: compileTemplate(`<b>x</b><i :for="n in items.get()" :key="n">{ n }</i>`),
  })
  class Listed {
    items = new Signal.State([1]);
  }

  it('grows', () => {
    const { instance, host } = show(Listed);
    expect(host.textContent).toBe('x1');
    instance.items.set([1, 2, 3]);
    flushSync();
    expect(host.textContent).toBe('x123');
  });

  it('shrinks', () => {
    const { instance, host } = show(Listed);
    instance.items.set([1, 2, 3]);
    flushSync();
    instance.items.set([2]);
    flushSync();
    expect(host.textContent).toBe('x2');
  });

  it('reorders without rebuilding what it keyed', () => {
    const { instance, host } = show(Listed);
    instance.items.set([1, 2]);
    flushSync();
    const first = host.querySelectorAll('i')[0]!;
    instance.items.set([2, 1]);
    flushSync();
    expect(host.textContent).toBe('x21');
    expect(host.querySelectorAll('i')[1]).toBe(first);
  });

  it('grows when what it draws is a component', () => {
    @Component({
      selector: 'v-listed-kids',
      imports: [Kid],
      render: compileTemplate(`<b>x</b><v-kid :for="n in items.get()" :key="n" :n="n"></v-kid>`),
    })
    class ListedKids {
      items = new Signal.State([1]);
    }

    const { instance, host } = show(ListedKids);
    instance.items.set([1, 2, 3]);
    flushSync();
    expect(host.textContent).toBe('x123');
  });

  it('grows inside the content a caller wrote for a slot', () => {
    @Component({
      selector: 'v-page',
      imports: [Frame],
      render: compileTemplate(
        `<v-frame><b>x</b><i :for="n in items.get()" :key="n">{ n }</i></v-frame>`,
      ),
    })
    class Page {
      items = new Signal.State([1]);
    }

    const { instance, host } = show(Page);
    instance.items.set([1, 2, 3]);
    flushSync();
    expect(host.textContent).toBe('x123');
  });
});

describe('the other holes that are one root among several', () => {
  it('toggles a branch', () => {
    @Component({
      selector: 'v-branched',
      render: compileTemplate(`<b>x</b><i :if="on.get()">here</i>`),
    })
    class Branched {
      on = new Signal.State(false);
    }

    const { instance, host } = show(Branched);
    expect(host.textContent).toBe('x');
    instance.on.set(true);
    flushSync();
    expect(host.textContent).toBe('xhere');
    instance.on.set(false);
    flushSync();
    expect(host.textContent).toBe('x');
  });

  it('rewrites a value', () => {
    @Component({
      selector: 'v-valued',
      render: compileTemplate(`<b>x</b>{ name.get() }`),
    })
    class Valued {
      name = new Signal.State('one');
    }

    const { instance, host } = show(Valued);
    instance.name.set('two');
    flushSync();
    expect(host.textContent).toBe('xtwo');
  });
});
