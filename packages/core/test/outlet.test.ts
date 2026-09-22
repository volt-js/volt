/**
 * `:outlet` — a hole whose content the enclosing render decides.
 *
 * The router's outlet used to be a DOM search: mount the layout, find
 * `[data-volt-outlet]` in what it produced, mount the child into that. Which
 * works in a browser and nowhere else — a server writes its bytes in one pass
 * and never goes back, so a page rendered that way arrived as a shell with a
 * hole in it, and that is the whole of the first gap in server rendering.
 *
 * As a template construct it is a hole like any other: a server fills it in
 * order, a hydrating client claims what the server put there, and a client
 * with nothing to claim builds it. Nothing here knows about routes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount, provideOutlet } from '@voltdev/core';
import { createRoot } from '@voltdev/reactivity';

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

describe('an outlet in a template', () => {
  it('renders nothing when nobody said what goes there', () => {
    @Component({
      selector: 'v-shell',
      render: compileTemplate(`<div><header>top</header><main :outlet></main></div>`),
    })
    class Shell {}

    const { host } = show(Shell);
    expect(host.querySelector('main')!.textContent).toBe('');
    expect(host.querySelector('header')!.textContent).toBe('top');
  });

  it('renders what the enclosing render provided', () => {
    @Component({ selector: 'v-child', render: compileTemplate(`<p>child</p>`) })
    class Child {}

    @Component({
      selector: 'v-shell2',
      imports: [Child],
      render: compileTemplate(`<div><main :outlet></main></div>`),
    })
    class Shell {
      constructor() {
        // What a router does at each depth: hand the render below it down.
        provideOutlet(() => document.createTextNode('filled'));
      }
    }

    expect(show(Shell).host.querySelector('main')!.textContent).toBe('filled');
  });

  it('follows a render that changes, which is what a navigation is', () => {
    const page = new Signal.State('one');

    @Component({
      selector: 'v-shell3',
      render: compileTemplate(`<div><main :outlet></main></div>`),
    })
    class Shell {
      constructor() {
        provideOutlet(() => () => document.createTextNode(page.get()));
      }
    }

    const { host } = show(Shell);
    expect(host.querySelector('main')!.textContent).toBe('one');

    page.set('two');
    flushSync();
    expect(host.querySelector('main')!.textContent).toBe('two');
  });

  it('belongs to the enclosing render, so two subtrees do not share one', () => {
    const seen: string[] = [];

    @Component({ selector: 'v-leaf', render: compileTemplate(`<i :outlet></i>`) })
    class Leaf {}

    @Component({
      selector: 'v-branch',
      imports: [Leaf],
      render: compileTemplate(`<section><v-leaf></v-leaf></section>`),
    })
    class Branch {
      constructor() {
        provideOutlet(() => {
          seen.push('branch');
          return document.createTextNode('inner');
        });
      }
    }

    @Component({
      selector: 'v-page',
      imports: [Branch],
      render: compileTemplate(`<div><v-branch></v-branch><b :outlet></b></div>`),
    })
    class Page {
      constructor() {
        provideOutlet(() => {
          seen.push('page');
          return document.createTextNode('outer');
        });
      }
    }

    const { host } = show(Page);
    // The leaf inside the branch takes the branch's; the one beside it takes
    // the page's. A single shared slot would give both the same answer.
    expect(host.querySelector('i')!.textContent).toBe('inner');
    expect(host.querySelector('b')!.textContent).toBe('outer');
    expect(seen.sort()).toEqual(['branch', 'page']);
  });

  it('is provided to the subtree, not to whoever provided last', () => {
    createRoot((dispose) => {
      provideOutlet(() => document.createTextNode('root'));
      dispose();
    });

    @Component({ selector: 'v-shell4', render: compileTemplate(`<main :outlet></main>`) })
    class Shell {}

    // A provider on a scope that is gone says nothing here.
    expect(show(Shell).host.querySelector('main')!.textContent).toBe('');
  });
});

/**
 * The same hole, on a server.
 *
 * This is the half that could not exist before. A server writes its bytes in
 * one pass and never goes back, so an outlet filled afterwards is a page with
 * a hole in it — which is what a server-rendered route was. Filled in the
 * walk, the child's markup is simply where it belongs, and the bytes a client
 * hydrates are the bytes it would have built.
 */
describe('an outlet on a server', () => {
  function serverBuild(on: boolean): void {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  }

  it('writes the child where the hole is, in one pass', async () => {
    serverBuild(true);
    const { renderToStaticMarkup } = await import('@voltdev/core/server');
    const { renderComponent } = await import('@voltdev/core');

    @Component({ selector: 'v-page-body', render: compileTemplate(`<p>page</p>`) })
    class Body {}

    @Component({
      selector: 'v-layout',
      render: compileTemplate(`<div><header>top</header><main :outlet></main><footer>end</footer></div>`),
    })
    class Layout {
      constructor() {
        provideOutlet((out) => {
          renderComponent(Body, out);
          return null;
        });
      }
    }

    const { html } = await renderToStaticMarkup(Layout);
    serverBuild(false);

    expect(html).toBe(
      '<div><header>top</header><main><p>page</p></main><footer>end</footer></div>',
    );
  });

  it('writes nothing where nobody filled it, and the page is still whole', async () => {
    serverBuild(true);
    const { renderToStaticMarkup } = await import('@voltdev/core/server');

    @Component({ selector: 'v-bare', render: compileTemplate(`<div><main :outlet></main></div>`) })
    class Bare {}

    const { html } = await renderToStaticMarkup(Bare);
    serverBuild(false);
    expect(html).toBe('<div><main></main></div>');
  });
});
