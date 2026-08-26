/**
 * `:portal` — rendering into a different container.
 *
 * The two properties that make a portal usable for a dialog are not about
 * where the nodes land. They are that context still resolves from where the
 * content was *declared*, and that disposing the declaring component disposes
 * the portalled content wherever it went. Both follow from context and
 * ownership living on the reactive scope rather than on the DOM tree, and both
 * are what a portal built on a virtual DOM has to work to preserve.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import {
  Component,
  Signal,
  createContext,
  flushSync,
  mount,
  provideContext,
  useContext,
} from '@voltdev/core';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><div id="elsewhere"></div>';
  host = document.querySelector('#app')!;
});

describe('where the content lands', () => {
  it('defaults to the document body', () => {
    @Component({
      selector: 'v-p',
      render: compileTemplate(`<div><span :portal>hello</span></div>`),
    })
    class P {}

    mount(P, host);
    expect(host.querySelector('span')).toBeNull();
    expect(document.body.querySelector('span')?.textContent).toBe('hello');
  });

  it('accepts a selector string', () => {
    @Component({
      selector: 'v-p2',
      render: compileTemplate(`<div><span :portal="'#elsewhere'">hi</span></div>`),
    })
    class P {}

    mount(P, host);
    expect(document.querySelector('#elsewhere')!.textContent).toBe('hi');
    expect(host.textContent).toBe('');
  });

  it('accepts an element', () => {
    @Component({
      selector: 'v-p3',
      render: compileTemplate(`<div><span :portal="target">hi</span></div>`),
    })
    class P {
      target = document.querySelector('#elsewhere')!;
    }

    mount(P, host);
    expect(document.querySelector('#elsewhere')!.textContent).toBe('hi');
  });

  it('leaves no marker at the declaration site', () => {
    @Component({
      selector: 'v-p4',
      render: compileTemplate(`<div><b>a</b><span :portal>x</span><b>c</b></div>`),
    })
    class P {}

    mount(P, host);
    // The surrounding markup must come out as if the portal were not written.
    expect(host.querySelector('div')!.innerHTML).toBe('<b>a</b><b>c</b>');
  });

  it('keeps several portals into one container in declaration order', () => {
    @Component({
      selector: 'v-p5',
      render: compileTemplate(
        `<div><i :portal="'#elsewhere'">1</i><i :portal="'#elsewhere'">2</i></div>`,
      ),
    })
    class P {}

    mount(P, host);
    expect(document.querySelector('#elsewhere')!.textContent).toBe('12');
  });

  it('reports a target that matches nothing', () => {
    @Component({
      selector: 'v-p6',
      render: compileTemplate(`<div><span :portal="'#missing'">x</span></div>`),
    })
    class P {}

    expect(() => mount(P, host)).toThrow(/matched no element/);
  });
});

describe('the properties a dialog depends on', () => {
  it('resolves context from where the content was declared, not where it lands', () => {
    const Theme = createContext('light');

    @Component({ selector: 'v-reader', render: compileTemplate(`<span>{ theme }</span>`) })
    class Reader {
      theme = useContext(Theme);
    }

    @Component({
      selector: 'v-provider',
      imports: [Reader],
      render: compileTemplate(`<div><v-reader :portal></v-reader></div>`),
    })
    class Provider {
      #ctx = provideContext(Theme, 'dark');
    }

    mount(Provider, host);
    // The span is under <body>, nowhere near the provider in the DOM.
    expect(document.body.querySelector('span')!.textContent).toBe('dark');
  });

  it('stays reactive after being moved', () => {
    @Component({
      selector: 'v-live',
      render: compileTemplate(`<div><span :portal>{ n.get() }</span></div>`),
    })
    class Live {
      n = new Signal.State(1);
    }

    const handle = mount(Live, host);
    expect(document.body.querySelector('span')!.textContent).toBe('1');

    (handle.instance as Live).n.set(2);
    flushSync();
    expect(document.body.querySelector('span')!.textContent).toBe('2');
  });

  it('removes portalled content when the declaring component unmounts', () => {
    @Component({
      selector: 'v-gone',
      render: compileTemplate(`<div><span :portal="'#elsewhere'">x</span></div>`),
    })
    class Gone {}

    const handle = mount(Gone, host);
    expect(document.querySelector('#elsewhere')!.textContent).toBe('x');

    handle.unmount();
    // Nothing may be left behind — this is the leak a portal makes easy.
    expect(document.querySelector('#elsewhere')!.textContent).toBe('');
    expect(document.querySelector('#elsewhere')!.childNodes).toHaveLength(0);
  });

  it('is created and destroyed by a surrounding :if', () => {
    @Component({
      selector: 'v-cond',
      render: compileTemplate(
        `<div><span :if="open.get()" :portal="'#elsewhere'">modal</span></div>`,
      ),
    })
    class Cond {
      open = new Signal.State(false);
    }

    const handle = mount(Cond, host);
    const target = document.querySelector('#elsewhere')!;
    expect(target.textContent).toBe('');

    (handle.instance as Cond).open.set(true);
    flushSync();
    expect(target.textContent).toBe('modal');

    (handle.instance as Cond).open.set(false);
    flushSync();
    expect(target.textContent).toBe('');
    expect(target.childNodes).toHaveLength(0);
  });
});

describe('portalling a component', () => {
  it('moves a component, not just an element', () => {
    @Component({ selector: 'v-inner', render: compileTemplate(`<b>inner</b>`) })
    class Inner {}

    @Component({
      selector: 'v-outer',
      imports: [Inner],
      render: compileTemplate(`<div><v-inner :portal="'#elsewhere'"></v-inner></div>`),
    })
    class Outer {}

    mount(Outer, host);
    // Silently dropped before: a lone component child took a fast path that
    // never looked for `:portal`.
    expect(document.querySelector('#elsewhere')!.textContent).toBe('inner');
    expect(host.querySelector('b')).toBeNull();
  });

  it('portals a component that is also conditional', () => {
    @Component({ selector: 'v-inner2', render: compileTemplate(`<b>x</b>`) })
    class Inner {}

    @Component({
      selector: 'v-outer2',
      imports: [Inner],
      render: compileTemplate(
        `<div><v-inner2 :if="open.get()" :portal="'#elsewhere'"></v-inner2></div>`,
      ),
    })
    class Outer {
      open = new Signal.State(false);
    }

    const handle = mount(Outer, host);
    const target = document.querySelector('#elsewhere')!;
    expect(target.textContent).toBe('');

    (handle.instance as Outer).open.set(true);
    flushSync();
    expect(target.textContent).toBe('x');
  });
});

/**
 * The other half of a portal: the one a server wrote.
 *
 * The server cannot put portalled content where it belongs, because on a
 * server there is no document to look the target up in — so it writes the
 * markup into a `<template>` at the end of the response and a record saying
 * which selector it was meant for. `drainStream` moves it into the target,
 * and then the client's own `portal` used to run and append a second copy of
 * everything, which is a dialog rendered twice on every server-rendered page
 * that has one.
 *
 * So what these assert is one copy, and that the copy is the server's own
 * nodes rather than a rebuild of them — the same question `hydrate.test.ts`
 * asks about the rest of the page, and for the same reason: a test comparing
 * markup would pass against a hydration that threw the server's work away.
 */
import { compile } from '@voltdev/compiler';
import { createRoot } from '@voltdev/reactivity';
import * as runtime from '@voltdev/core/runtime';
import * as serverRuntime from '@voltdev/core/server';
import { MarkupWriter, type PortalMarkup } from '@voltdev/core/server';
import type { RenderFn } from '@voltdev/core';

type ServerRender = (ctx: object, out: MarkupWriter) => void;

/** What a server render leaves: the document's bytes, and the portals' own. */
function renderOnServer(source: string, ctx: object): { html: string; portals: PortalMarkup[] } {
  const { body } = compile(source, { runtime: '_rt', target: 'server' });
  const make = new Function('_rt', body) as (rt: unknown) => ServerRender;
  const out = new MarkupWriter();
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = true;
  try {
    make(serverRuntime)(ctx, out);
  } finally {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = false;
  }
  return { html: out.toString(), portals: out.portals() };
}

/**
 * The response, parsed into the document the way a browser would hold it.
 *
 * The `<template>` and the `["p", selector]` record are what `stream.ts`
 * writes in its epilogue, spelled out here rather than driven through
 * `renderToStream` so that the two orders below — record before boot, record
 * after it — can be produced at will. They are the two a network produces.
 */
function serve(source: string, ctx: object) {
  document.body.innerHTML = '<div id="app"></div><aside id="dock"></aside>';
  const app = document.querySelector('#app')!;
  const { html, portals } = renderOnServer(source, ctx);
  app.innerHTML = html;

  const records: unknown[][] = [];
  const written: Node[] = [];
  for (const portalled of portals) {
    const holder = document.createElement('template');
    holder.setAttribute('data-volt-portal', portalled.target!);
    holder.innerHTML = portalled.html;
    written.push(...Array.from(holder.content.childNodes));
    document.body.append(holder);
    records.push(['p', portalled.target]);
  }

  return { app, records, written };
}

/** Attach the hydrate emit to what the server left. */
function claim(host: Element, source: string, ctx: object): void {
  const { body } = compile(source, { runtime: '_rt', target: 'hydrate' });
  const render = (new Function('_rt', body) as (rt: unknown) => RenderFn)(runtime);
  createRoot(() => {
    runtime.hydrate(host, () => render(ctx));
  });
}

const DOCKED = `<div><p>page</p><span :portal="'#dock'">{ label.get() }</span></div>`;

/**
 * What a portal put in the container, without the anchor it put there too.
 *
 * Every portal — server-adopted or client-built — ends with a comment of its
 * own, which is how several into one container keep a stable order and how
 * each removes only its own nodes on disposal. It is part of the container's
 * children and is not part of its content, and the assertions below are about
 * the second. The one place the anchor itself is asserted is disposal, where
 * the claim is that nothing at all is left.
 */
function content(container: Element): Node[] {
  return [...container.childNodes].filter((node) => node.nodeType !== 8);
}

describe('a portal the server rendered', () => {
  it('adopts the server’s nodes instead of appending a second copy', () => {
    const ctx = { label: new Signal.State('docked') };
    const { app, records, written } = serve(DOCKED, ctx);
    // The record is in the boot array before the runtime loads, which is what
    // a response that finished before the script ran looks like.
    (globalThis as { __VOLT__?: unknown[] }).__VOLT__ = records;

    claim(app, DOCKED, ctx);

    const dock = document.querySelector('#dock')!;
    expect(content(dock)).toHaveLength(1);
    expect(dock.textContent).toBe('docked');
    // The server's own span, not a rebuild of it.
    expect(dock.firstChild).toBe(written[0]);
    expect(document.querySelector('template[data-volt-portal]')).toBeNull();
  });

  it('keeps writing to the adopted node', () => {
    const ctx = { label: new Signal.State('first') };
    const { app, records, written } = serve(DOCKED, ctx);
    (globalThis as { __VOLT__?: unknown[] }).__VOLT__ = records;

    claim(app, DOCKED, ctx);
    ctx.label.set('second');
    flushSync();

    const dock = document.querySelector('#dock')!;
    expect(content(dock)).toHaveLength(1);
    expect(dock.firstChild).toBe(written[0]);
    expect(dock.textContent).toBe('second');
  });

  it('claims nothing from the hole around it', () => {
    // The content is not in the enclosing hole's range — the server wrote it
    // into a segment of its own — so a block claiming from that range would
    // take a node belonging to something else, and report a disagreement that
    // is nothing of the sort.
    const seen: runtime.HydrationMismatch[] = [];
    const stop = runtime.onHydrationMismatch((mismatch) => seen.push(mismatch));
    try {
      const ctx = { label: new Signal.State('docked') };
      const { app, records } = serve(DOCKED, ctx);
      (globalThis as { __VOLT__?: unknown[] }).__VOLT__ = records;
      claim(app, DOCKED, ctx);
    } finally {
      stop();
    }

    expect(seen).toEqual([]);
  });

  it('keeps two portals into one container in the order they were declared', () => {
    const source =
      `<div><i :portal="'#dock'">{ a.get() }</i><i :portal="'#dock'">{ b.get() }</i></div>`;
    const ctx = { a: new Signal.State('1'), b: new Signal.State('2') };
    const { app, records, written } = serve(source, ctx);
    (globalThis as { __VOLT__?: unknown[] }).__VOLT__ = records;

    claim(app, source, ctx);

    const dock = document.querySelector('#dock')!;
    expect(content(dock)).toHaveLength(2);
    expect(dock.textContent).toBe('12');
    expect(content(dock)).toEqual(written);
  });

  it('keeps each portal’s anchor behind its own content, so a later write lands in place', () => {
    // The anchor is where `insertExpression` puts the next value, so a portal
    // whose anchor sits behind its neighbour's content writes into the
    // neighbour's place. Nothing sees that until something updates, which is
    // why asserting the adopted order alone is not enough.
    const source =
      `<div><i :portal="'#dock'">{ a.get() }</i><i :portal="'#dock'">{ b.get() }</i></div>`;
    const ctx = { a: new Signal.State('1'), b: new Signal.State('2') };
    const { app, records } = serve(source, ctx);
    (globalThis as { __VOLT__?: unknown[] }).__VOLT__ = records;

    claim(app, source, ctx);
    ctx.a.set('one');
    flushSync();

    const dock = document.querySelector('#dock')!;
    expect(dock.textContent).toBe('one2');
    expect(content(dock).map((node) => node.textContent)).toEqual(['one', '2']);
  });

  it('drops the server’s copy when the record lands after the page has booted', () => {
    // A streamed response writes its portals last, so on a page that booted
    // early this is the ordinary order: the client has already built the
    // content by the time the record arrives.
    const ctx = { label: new Signal.State('late') };
    const { app, records } = serve(DOCKED, ctx);
    (globalThis as { __VOLT__?: unknown[] }).__VOLT__ = [];

    claim(app, DOCKED, ctx);
    const dock = document.querySelector('#dock')!;
    const built = dock.firstChild;
    expect(content(dock)).toHaveLength(1);

    // The live sink the drain installed, which is what a late chunk pushes to.
    (globalThis as { __VOLT__?: { push(...records: unknown[][]): void } }).__VOLT__!.push(
      ...records,
    );

    expect(content(dock)).toHaveLength(1);
    expect(dock.firstChild).toBe(built);
    expect(dock.textContent).toBe('late');
    expect(document.querySelector('template[data-volt-portal]')).toBeNull();
  });

  it('removes the adopted content when the page it was declared in is disposed', () => {
    const ctx = { label: new Signal.State('docked') };
    const { app, records } = serve(DOCKED, ctx);
    (globalThis as { __VOLT__?: unknown[] }).__VOLT__ = records;

    const { body } = compile(DOCKED, { runtime: '_rt', target: 'hydrate' });
    const render = (new Function('_rt', body) as (rt: unknown) => RenderFn)(runtime);
    const dispose = createRoot((stop) => {
      runtime.hydrate(app, () => render(ctx));
      return stop;
    });

    const dock = document.querySelector('#dock')!;
    expect(content(dock)).toHaveLength(1);

    dispose();

    // Adopted nodes are this portal's to remove, exactly as built ones are —
    // and `childNodes` rather than `content` here, because the anchor is the
    // portal's too and a disposal that left it behind would accumulate one
    // comment per mount.
    expect(dock.childNodes).toHaveLength(0);
  });
});
