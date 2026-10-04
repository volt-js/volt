/**
 * A lazy component on a server, and in the browser that hydrates what the
 * server wrote.
 *
 * The server's half is a render that waits for the chunk: the fallback goes
 * into a region, the load is data the request waits for, and the region is
 * rewritten with the component once it has arrived. What it must not do is
 * keep a failure — a process is every reader's, and one failed load has to be
 * one request's fallback rather than every later request's.
 *
 * The browser's half is identity, for the reason `hydrate.test.ts` gives: a
 * client that threw the server's nodes away and built its own would produce
 * the same markup. So every case holds the nodes from before hydration and
 * asserts they are the nodes on the page afterwards — while the chunk is in
 * flight, and once it has landed — and then clicks, to show the component is
 * attached to those nodes rather than merely standing beside them.
 *
 * Each side gets its own `lazy()` placeholder, compiled for its own target:
 * the two halves of one page run in two processes, and a record shared
 * between them here would hand the browser a chunk its own loader never
 * fetched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compile } from '@voltdev/compiler';
import {
  Component,
  Prop,
  Signal,
  createId,
  flushSync,
  hydrate,
  resetIds,
  trackRequestData,
  type ComponentType,
  type RenderFn,
} from '@voltdev/core';
import * as runtime from '@voltdev/core/runtime';
import { lazy, onHydrationMismatch, preload, type HydrationMismatch } from '@voltdev/core/runtime';
import * as server from '@voltdev/core/server';
import {
  MarkupWriter,
  boundary,
  renderComponent,
  renderToStaticMarkup,
  renderToStream,
  renderToString,
  type RenderedPage,
} from '@voltdev/core/server';

type Side = 'server' | 'hydrate';

function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

/** One template compiled for one side, against that side's runtime. */
function renderFor(source: string, side: Side): RenderFn {
  const { body } = compile(source, { runtime: '_rt', target: side });
  return (new Function('_rt', body) as (rt: unknown) => RenderFn)(side === 'server' ? server : runtime);
}

/** A loader resolved by hand, so the time before the chunk lands can be looked at. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const METER = `<p class="meter" :id="id"><span>{ label }: { count.get() }</span><button :click="bump()">+</button></p>`;
const TAG = `<em :id="id">tag</em>`;
const PAGE = `<main><h1>title</h1><v-meter label="fuel"></v-meter><v-tag></v-tag></main>`;

interface App {
  Page: ComponentType<unknown>;
  Meter: ComponentType<unknown>;
  Lazy: ComponentType<unknown>;
}

/**
 * One side's page: a heading, the lazy component, and a component after it.
 *
 * Both of the others mint an id from where they sit, which is the one thing a
 * component rendered after the walk can get wrong without any markup looking
 * different — the lazy one sits wherever the frame is when its chunk lands,
 * and the one after it is numbered from whatever the lazy one took.
 */
function app(
  side: Side,
  load: (meter: ComponentType<unknown>) => Promise<unknown>,
  options: Parameters<typeof lazy>[2] = {},
): App {
  @Component({ selector: 'v-meter', render: renderFor(METER, side) })
  class Meter {
    @Prop() label = '';
    count = new Signal.State(0);
    id = createId('meter');
    bump(): void {
      this.count.set(this.count.get() + 1);
    }
  }

  const Lazy = lazy('v-meter', () => load(Meter) as Promise<ComponentType<unknown>>, {
    fallback: () => 'loading…',
    ...options,
  });

  @Component({ selector: 'v-tag', render: renderFor(TAG, side) })
  class Tag {
    id = createId('tag');
  }

  @Component({ selector: 'v-page', imports: [Lazy, Tag], render: renderFor(PAGE, side) })
  class Page {}

  return { Page, Meter, Lazy };
}

/** A render that must have succeeded, narrowed so the fields are readable. */
async function page(component: ComponentType<unknown>): Promise<RenderedPage> {
  serverBuild(true);
  try {
    const rendered = await renderToString(component);
    if (rendered.status !== 200) throw rendered.error;
    return rendered;
  } finally {
    serverBuild(false);
  }
}

/** A streamed response, read to its end. */
async function whole(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return html;
    html += decoder.decode(value, { stream: true });
  }
}

/** Every node in the subtree, comments included, in document order. */
function allNodes(root: Node, out: Node[] = []): Node[] {
  for (const child of Array.from(root.childNodes)) {
    out.push(child);
    allNodes(child, out);
  }
  return out;
}

function expectSameNodes(now: Node[], before: Node[]): void {
  expect(now).toHaveLength(before.length);
  // The same objects, not equal ones: only identity tells claiming from
  // building a copy.
  now.forEach((node, index) => expect(node).toBe(before[index]));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  serverBuild(false);
  resetIds();
});

describe('a lazy component in a server render', () => {
  it('writes the component once its chunk has loaded, not the fallback', async () => {
    const loader = vi.fn(async (meter: ComponentType<unknown>) => meter);
    const { Page } = app('server', loader);

    const first = await page(Page);
    expect(first.html).toContain('<p class="meter"');
    expect(first.html).toContain('fuel: 0');
    expect(first.html).not.toContain('loading…');

    // A loaded chunk is the process's, as the module cache is: the next
    // request renders the component in the walk itself. Its bytes are the
    // same bytes, ids included — the component rendered late sat where the
    // one rendered in the walk sits.
    const second = await page(Page);
    expect(second.html).toBe(first.html);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('writes the same for a page with nothing to hydrate', async () => {
    const { Page } = app('server', async (meter) => meter);
    serverBuild(true);
    try {
      const { html } = await renderToStaticMarkup(Page);
      expect(html).toContain('fuel: 0');
      expect(html).not.toContain('loading…');
    } finally {
      serverBuild(false);
    }
  });

  it('writes the fallback when the chunk fails to load, and answers 200', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { Page } = app(
        'server',
        async () => {
          throw new Error('chunk gone');
        },
        { error: () => 'failed' },
      );

      const rendered = await page(Page);
      expect(rendered.html).toContain('loading…');
      expect(rendered.html).not.toContain('<p class="meter"');
      // The error output is the browser's: its retry is a button nobody can
      // press until the page hydrates, and by then the browser has loaded the
      // chunk for itself.
      expect(rendered.html).not.toContain('failed');
      // And the rest of the page is written around it.
      expect(rendered.html).toContain('<em id="tag-');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('tries again on the next request after a load failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let attempts = 0;
      const { Page } = app('server', async (meter) => {
        attempts++;
        if (attempts === 1) throw new Error('chunk gone');
        return meter;
      });

      const failed = await page(Page);
      expect(failed.html).toContain('loading…');

      const recovered = await page(Page);
      expect(attempts).toBe(2);
      expect(recovered.html).toContain('fuel: 0');
      expect(recovered.html).not.toContain('loading…');
    } finally {
      warn.mockRestore();
    }
  });

  it('streams the fallback, marked, when the chunk had not loaded before the shell went out', async () => {
    const { Page } = app('server', async (meter) => meter);
    serverBuild(true);
    try {
      // The shell goes out the moment the walk is done, before a chunk that
      // was not already there can land, and bytes sent cannot be written
      // again — so the browser loads the chunk itself, as it does after a
      // failure. The stream still waits for the load, as it waits for any
      // data the request registered, and then ends.
      const first = await whole(renderToStream(Page));
      expect(first).toContain('<!--fallback-->loading…');
      expect(first).not.toContain('<p class="meter"');
      expect(first).toContain('<em id="tag-');

      // Loaded now, so the next request writes the component in its walk.
      const second = await whole(renderToStream(Page));
      expect(second).toContain('fuel: 0');
      expect(second).not.toContain('loading…');
    } finally {
      serverBuild(false);
    }
  });

  it('shares one load between requests rendering at once', async () => {
    const gate = deferred<ComponentType<unknown>>();
    const loader = vi.fn(() => gate.promise);
    const { Page, Meter } = app('server', loader);

    // The flag once around both, since each render reads it until it settles.
    serverBuild(true);
    let pages: Awaited<ReturnType<typeof renderToString>>[];
    try {
      const both = Promise.all([renderToString(Page), renderToString(Page)]);
      await Promise.resolve();
      gate.resolve(Meter);
      pages = await both;
    } finally {
      serverBuild(false);
    }

    expect(loader).toHaveBeenCalledTimes(1);
    expect(pages[0]!.html).toContain('fuel: 0');
    expect(pages[1]!.html).toBe(pages[0]!.html);
  });

  it('builds the component once in a request, though a signal it read while built changes after', async () => {
    // What a component reads while it is built is the walk's business, not
    // the region's: written once, where it stood. A region that rewrote
    // itself on such a read would build the component again — its
    // constructor, its fetches, its hydratable keys — in every later round.
    const source = new Signal.State('first');
    let built = 0;

    @Component({ selector: 'v-reads', render: renderFor(`<p>{ seen }</p>`, 'server') })
    class Reads {
      seen = source.get();
      constructor() {
        built++;
        // Data the request waits for, which moves what the component read.
        trackRequestData(Promise.resolve().then(() => source.set('second')));
      }
    }

    const Lazy = lazy('v-reads', async () => Reads, { fallback: () => 'loading…' });

    @Component({ selector: 'v-page', imports: [Lazy], render: renderFor(`<main><v-reads></v-reads></main>`, 'server') })
    class Page {}

    const { html } = await page(Page);
    expect(built).toBe(1);
    expect(html).toContain('<p>first</p>');
  });

  it('builds nothing into a streamed shell that has gone, so a component that fails there ends nothing', async () => {
    // The shell went out with the fallback before the chunk could land, and
    // bytes sent cannot be written again: building the component then would
    // be work nobody sees — its constructor, the data it asks for, which the
    // stream would wait on — and a throw from it would end a response that
    // was fine, with a boundary still to answer.
    const chunk = deferred<ComponentType<unknown>>();
    const answer = deferred<string>();
    let built = 0;

    @Component({ selector: 'v-window', render: renderFor(`<p>window</p>`, 'server') })
    class NeedsWindow {
      constructor() {
        built++;
        throw new Error('window is not defined');
      }
    }

    const Lazy = lazy('v-window', () => chunk.promise, { fallback: () => 'loading…' });

    @Component({
      selector: 'v-page',
      imports: [Lazy],
      render: renderFor(`<main><v-window></v-window><hr>{ later }</main>`, 'server'),
    })
    class Page {
      later = boundary(() => answer.promise, {
        fallback: (out: MarkupWriter) => out.raw('<i>waiting</i>'),
        content: (value: string, out: MarkupWriter) => out.child(value),
      });
    }

    serverBuild(true);
    try {
      const streamed = whole(renderToStream(Page));
      await new Promise((settle) => setTimeout(settle, 0));
      chunk.resolve(NeedsWindow);
      await new Promise((settle) => setTimeout(settle, 0));
      answer.resolve('the answer');
      const html = await streamed;

      expect(built).toBe(0);
      expect(html).toContain('<!--fallback-->loading…');
      expect(html).toContain('the answer');
      expect(html).not.toContain('the render failed');
    } finally {
      serverBuild(false);
    }
  });

  it('builds nothing into a late chunk that has gone, either', async () => {
    // The same for a lazy component in a boundary's answer: the chunk carrying
    // it is sent the moment it is written, fallback and all.
    const chunk = deferred<ComponentType<unknown>>();
    const answer = deferred<string>();
    const after = deferred<string>();
    let built = 0;

    @Component({ selector: 'v-window', render: renderFor(`<p>window</p>`, 'server') })
    class NeedsWindow {
      constructor() {
        built++;
        throw new Error('window is not defined');
      }
    }

    const Lazy = lazy('v-window', () => chunk.promise, { fallback: () => 'loading…' });

    @Component({ selector: 'v-panel', imports: [Lazy], render: renderFor(`<section><v-window></v-window></section>`, 'server') })
    class Panel {}

    @Component({ selector: 'v-page', render: renderFor(`<main>{ first }<hr>{ second }</main>`, 'server') })
    class Page {
      first = boundary(() => answer.promise, {
        content: (_: string, out: MarkupWriter) => void renderComponent(Panel, out, null),
      });
      second = boundary(() => after.promise, {
        content: (value: string, out: MarkupWriter) => out.child(value),
      });
    }

    serverBuild(true);
    try {
      const streamed = whole(renderToStream(Page));
      await new Promise((settle) => setTimeout(settle, 0));
      answer.resolve('now');
      await new Promise((settle) => setTimeout(settle, 0));
      chunk.resolve(NeedsWindow);
      await new Promise((settle) => setTimeout(settle, 0));
      after.resolve('the answer after');
      const html = await streamed;

      expect(built).toBe(0);
      expect(html).toContain('<!--fallback-->loading…');
      expect(html).toContain('the answer after');
      expect(html).not.toContain('the render failed');
    } finally {
      serverBuild(false);
    }
  });
});

describe('hydrating a lazy component the server rendered', () => {
  /** The server's page, parsed into a document the way a browser would have it. */
  async function served(load: (meter: ComponentType<unknown>) => Promise<unknown>): Promise<Element> {
    const rendered = await page(app('server', load).Page);
    const host = document.createElement('div');
    host.innerHTML = rendered.html;
    document.body.append(host);
    return host;
  }

  let mismatches: HydrationMismatch[];
  let stop: () => void;

  beforeEach(() => {
    mismatches = [];
    stop = onHydrationMismatch((mismatch) => mismatches.push(mismatch));
    // The browser numbers from its own root, as a fresh page does.
    resetIds();
  });

  afterEach(() => stop());

  it('keeps the server’s nodes while the chunk loads, and claims them when it lands', async () => {
    const host = await served(async (meter) => meter);
    const printed = allNodes(host);
    const ids = [host.querySelector('p')!.id, host.querySelector('em')!.id];

    const gate = deferred<ComponentType<unknown>>();
    const browser = app('hydrate', () => gate.promise);
    const handle = hydrate(browser.Page, host);

    // In flight: what the reader is looking at stays, with no fallback drawn
    // over it and nothing rebuilt beside it.
    expectSameNodes(allNodes(host), printed);
    expect(host.textContent).not.toContain('loading…');

    gate.resolve(browser.Meter);
    await preload(browser.Lazy);
    flushSync();

    // Landed: the same nodes again, now the component's own.
    expectSameNodes(allNodes(host), printed);
    expect([host.querySelector('p')!.id, host.querySelector('em')!.id]).toEqual(ids);

    const span = host.querySelector('span')!;
    host.querySelector('button')!.click();
    flushSync();
    expect(host.querySelector('span')).toBe(span);
    expect(span.textContent).toBe('fuel: 1');
    expect(mismatches).toEqual([]);

    handle.unmount();
  });

  it('claims them at once when the chunk was loaded before hydrating', async () => {
    const host = await served(async (meter) => meter);
    const printed = allNodes(host);

    const browser = app('hydrate', async (meter) => meter);
    await preload(browser.Lazy);
    const handle = hydrate(browser.Page, host);

    expectSameNodes(allNodes(host), printed);
    host.querySelector('button')!.click();
    flushSync();
    expect(host.querySelector('span')!.textContent).toBe('fuel: 1');
    expect(mismatches).toEqual([]);

    handle.unmount();
  });

  it('replaces the fallback the server wrote, rather than claiming it as the component', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let host: Element;
    try {
      host = await served(async () => {
        throw new Error('chunk gone');
      });
    } finally {
      warn.mockRestore();
    }
    const heading = host.querySelector('h1');
    const tag = host.querySelector('em');
    const fallback = allNodes(host).find((node) => node.textContent === 'loading…' && node.nodeType === 3);
    expect(fallback).toBeDefined();

    const gate = deferred<ComponentType<unknown>>();
    const browser = app('hydrate', () => gate.promise);
    const handle = hydrate(browser.Page, host);

    // Until the chunk lands, the fallback the reader already has is the one
    // on the page — the server's node, not a second one drawn in its place.
    expect(allNodes(host)).toContain(fallback);

    gate.resolve(browser.Meter);
    await preload(browser.Lazy);
    flushSync();

    expect(host.textContent).not.toContain('loading…');
    expect(host.querySelector('span')!.textContent).toBe('fuel: 0');
    // Only the lazy component's own range was rebuilt.
    expect(host.querySelector('h1')).toBe(heading);
    expect(host.querySelector('em')).toBe(tag);
    // Built rather than claimed, so nothing was compared and nothing
    // disagreed: the fallback was never offered as the component's markup.
    expect(mismatches).toEqual([]);

    host.querySelector('button')!.click();
    flushSync();
    expect(host.querySelector('span')!.textContent).toBe('fuel: 1');

    handle.unmount();
  });

  it('leaves the server’s nodes when the chunk fails in the browser with no error to show', async () => {
    const host = await served(async (meter) => meter);
    const printed = allNodes(host);

    const browser = app('hydrate', async () => {
      throw new Error('offline');
    });
    const handle = hydrate(browser.Page, host);
    await preload(browser.Lazy);
    flushSync();

    // Inert, but what the page says is still true — which nothing would be.
    expectSameNodes(allNodes(host), printed);

    handle.unmount();
  });

  it('takes away a fallback the server printed when the chunk fails in the browser too', async () => {
    // A fallback says the component is on its way, which stops being true
    // when the browser's load fails as well. With no error output to show,
    // what is left is what a page built in the browser shows: nothing.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let host: Element;
    try {
      host = await served(async () => {
        throw new Error('chunk gone');
      });
    } finally {
      warn.mockRestore();
    }
    const heading = host.querySelector('h1');
    const tag = host.querySelector('em');
    expect(host.textContent).toContain('loading…');

    const browser = app('hydrate', async () => {
      throw new Error('offline');
    });
    const handle = hydrate(browser.Page, host);
    await preload(browser.Lazy);
    flushSync();

    expect(host.textContent).not.toContain('loading…');
    expect(host.querySelector('h1')).toBe(heading);
    expect(host.querySelector('em')).toBe(tag);
    expect(mismatches).toEqual([]);

    handle.unmount();
  });

  it('shows the error output in their place when there is one', async () => {
    const host = await served(async (meter) => meter);

    const browser = app(
      'hydrate',
      async () => {
        throw new Error('offline');
      },
      { error: () => 'could not load the meter' },
    );
    const handle = hydrate(browser.Page, host);
    await preload(browser.Lazy);
    flushSync();

    expect(host.querySelector('p')).toBeNull();
    expect(host.textContent).toContain('could not load the meter');
    expect(host.querySelector('em')).not.toBeNull();

    handle.unmount();
  });
});

/**
 * The shapes the fixed page above cannot take: two instances, slotted
 * content, a component with more than one root, a branch, a list, a lazy
 * component inside another.
 */
interface Shape {
  /** The lazy component's template; `METER` unless said otherwise. */
  meter?: string;
  page: string;
  /** Fields the page's template reads, assigned as the page is constructed. */
  fields?: () => Record<string, unknown>;
  /** Styles on the lazy component, and on the tag after it. */
  styles?: { meter: string; tag: string };
}

function shaped(
  side: Side,
  load: (meter: ComponentType<unknown>) => Promise<unknown>,
  shape: Shape,
  options: Parameters<typeof lazy>[2] = {},
): App {
  @Component({
    selector: 'v-meter',
    render: renderFor(shape.meter ?? METER, side),
    ...(shape.styles ? { styles: shape.styles.meter } : {}),
  })
  class Meter {
    @Prop() label = '';
    count = new Signal.State(0);
    id = createId('meter');
    bump(): void {
      this.count.set(this.count.get() + 1);
    }
  }

  const Lazy = lazy('v-meter', () => load(Meter) as Promise<ComponentType<unknown>>, {
    fallback: () => 'loading…',
    ...options,
  });

  @Component({
    selector: 'v-tag',
    render: renderFor(TAG, side),
    ...(shape.styles ? { styles: shape.styles.tag } : {}),
  })
  class Tag {
    id = createId('tag');
  }

  @Component({ selector: 'v-page', imports: [Lazy, Tag], render: renderFor(shape.page, side) })
  class Page {
    constructor() {
      Object.assign(this, shape.fields?.());
    }
  }

  return { Page, Meter, Lazy };
}

/** A page the server wrote, in a document, with the browser's ids reset. */
function parsed(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  resetIds();
  return host;
}

describe('the shapes a lazy component takes on a server-rendered page', () => {
  let mismatches: HydrationMismatch[];
  let stop: () => void;

  beforeEach(() => {
    mismatches = [];
    stop = onHydrationMismatch((mismatch) => mismatches.push(mismatch));
  });

  afterEach(() => stop());

  const SLOTTED = `<p class="meter" :id="id"><span>{ label }: { count.get() }</span><slot></slot><button :click="bump()">+</button></p>`;
  const TWICE = `<main><h1>title</h1><v-meter label="a"></v-meter><v-meter label="b"><v-tag></v-tag></v-meter><v-tag></v-tag></main>`;

  it('writes two instances, and the content slotted into one, where the walk would have', async () => {
    const { Page } = shaped('server', async (meter) => meter, { meter: SLOTTED, page: TWICE });
    // Late: both regions written again after the chunk lands, from the places
    // the walk held for them. Then in the walk. The bytes must agree, ids
    // included — the slotted tag's, minted inside the held place, among them.
    const late = await page(Page);
    const walked = await page(Page);
    expect(late.html).toBe(walked.html);
    expect(late.html).toContain('<p class="meter" id="meter-');
    expect(late.html.match(/<em id="tag-[^"]+"/g)).toHaveLength(2);
    expect(late.html).not.toContain('loading…');
  });

  it('claims both instances, and the slotted content, when the chunk lands', async () => {
    const served = shaped('server', async (meter) => meter, { meter: SLOTTED, page: TWICE });
    const host = parsed((await page(served.Page)).html);
    const printed = allNodes(host);

    const gate = deferred<ComponentType<unknown>>();
    const browser = shaped('hydrate', () => gate.promise, { meter: SLOTTED, page: TWICE });
    const handle = hydrate(browser.Page, host);
    expectSameNodes(allNodes(host), printed);

    gate.resolve(browser.Meter);
    await preload(browser.Lazy);
    flushSync();
    expectSameNodes(allNodes(host), printed);
    expect(mismatches).toEqual([]);

    const [first, second] = Array.from(host.querySelectorAll('button'));
    second!.click();
    flushSync();
    expect(host.querySelectorAll('span')[1]!.textContent).toBe('b: 1');
    first!.click();
    flushSync();
    expect(host.querySelectorAll('span')[0]!.textContent).toBe('a: 1');

    handle.unmount();
  });

  it('claims both at once, ids agreeing, when the chunk was loaded before hydrating', async () => {
    const served = shaped('server', async (meter) => meter, { meter: SLOTTED, page: TWICE });
    const host = parsed((await page(served.Page)).html);
    const printed = allNodes(host);
    const ids = Array.from(host.querySelectorAll('[id]'), (node) => node.id);

    // The server built both late, from held places; the browser builds both
    // in the walk, from frames entered. The ids have to be the same ids.
    const browser = shaped('hydrate', async (meter) => meter, { meter: SLOTTED, page: TWICE });
    await preload(browser.Lazy);
    const handle = hydrate(browser.Page, host);
    expectSameNodes(allNodes(host), printed);
    expect(Array.from(host.querySelectorAll('[id]'), (node) => node.id)).toEqual(ids);
    expect(mismatches).toEqual([]);

    handle.unmount();
  });

  it('writes a fallback that mints an id without moving the ids after it', async () => {
    // The fallback is the server's alone: the browser holds what the server
    // wrote rather than drawing its own. So whatever the fallback takes from
    // the frame must not be taken from the place everything after the lazy
    // component counts from, or the server numbers the tag one higher than a
    // walk with the chunk does, and than the browser does.
    const fallback = () => `loading ${createId('spinner')}`;
    const served = shaped('server', async (meter) => meter, { page: PAGE }, { fallback });
    const late = await page(served.Page);
    const walked = await page(served.Page);
    expect(late.html).toBe(walked.html);

    const host = parsed(late.html);
    const ids = Array.from(host.querySelectorAll('[id]'), (node) => node.id);
    const gate = deferred<ComponentType<unknown>>();
    const browser = shaped('hydrate', () => gate.promise, { page: PAGE }, { fallback });
    const handle = hydrate(browser.Page, host);
    gate.resolve(browser.Meter);
    await preload(browser.Lazy);
    flushSync();
    expect(Array.from(host.querySelectorAll('[id]'), (node) => node.id)).toEqual(ids);
    expect(mismatches).toEqual([]);

    handle.unmount();
  });

  it('builds over a printed fallback at once when the chunk was loaded before hydrating', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let host: Element;
    try {
      host = parsed(
        (
          await page(
            shaped(
              'server',
              async () => {
                throw new Error('chunk gone');
              },
              { page: PAGE },
            ).Page,
          )
        ).html,
      );
    } finally {
      warn.mockRestore();
    }
    const heading = host.querySelector('h1');
    const tag = host.querySelector('em');
    expect(host.textContent).toContain('loading…');

    const browser = shaped('hydrate', async (meter) => meter, { page: PAGE });
    await preload(browser.Lazy);
    const handle = hydrate(browser.Page, host);
    expect(host.textContent).not.toContain('loading…');
    expect(host.querySelector('h1')).toBe(heading);
    expect(host.querySelector('em')).toBe(tag);
    expect(mismatches).toEqual([]);
    host.querySelector('button')!.click();
    flushSync();
    expect(host.querySelector('span')!.textContent).toBe('fuel: 1');

    handle.unmount();
  });

  it('gives up on a range the page was cut off inside, and builds the component afresh', async () => {
    // The component alone in its parent, so its own delimiters are all the
    // hole has: a response cut off inside it leaves an open delimiter with no
    // close among what follows.
    const LONE = `<main><v-meter label="fuel"></v-meter></main>`;
    const served = shaped('server', async (meter) => meter, { page: LONE });
    const { html } = await page(served.Page);
    const cut = html.indexOf('<button');
    expect(cut).toBeGreaterThan(0);
    const host = parsed(html.slice(0, cut) + '</p>');
    expect(host.querySelector('button')).toBeNull();

    const gate = deferred<ComponentType<unknown>>();
    const browser = shaped('hydrate', () => gate.promise, { page: LONE });
    const handle = hydrate(browser.Page, host);
    expect(mismatches).toHaveLength(1);

    gate.resolve(browser.Meter);
    await preload(browser.Lazy);
    flushSync();
    expect(host.querySelectorAll('p')).toHaveLength(1);
    host.querySelector('button')!.click();
    flushSync();
    expect(host.querySelector('span')!.textContent).toBe('fuel: 1');

    handle.unmount();
  });

  it('collects the styles of a component written after the walk', async () => {
    const styles = { meter: '.meter{color:red}', tag: 'em{color:blue}' };
    const { Page } = shaped('server', async (meter) => meter, { page: PAGE, styles });
    const late = await page(Page);
    const walked = await page(Page);
    expect(late.styles.get('v-meter')).toBe(walked.styles.get('v-meter'));
    expect(late.styles.get('v-tag')).toBe(walked.styles.get('v-tag'));
    // Collected in the order first asked for, which puts a component written
    // after the walk behind everything the walk asked for: the same styles,
    // in the order a streamed page's late chunks would carry them.
    expect([...late.styles.keys()].sort()).toEqual([...walked.styles.keys()].sort());
  });

  it('writes and claims a component with more than one root', async () => {
    const FRAGMENT = `<span :id="id">{ label }: { count.get() }</span><button :click="bump()">+</button>`;
    const served = shaped('server', async (meter) => meter, { meter: FRAGMENT, page: PAGE });
    const late = await page(served.Page);
    expect(late.html).toBe((await page(served.Page)).html);
    expect(late.html).toContain('<span id="meter-');

    const host = parsed(late.html);
    const printed = allNodes(host);
    const gate = deferred<ComponentType<unknown>>();
    const browser = shaped('hydrate', () => gate.promise, { meter: FRAGMENT, page: PAGE });
    const handle = hydrate(browser.Page, host);
    gate.resolve(browser.Meter);
    await preload(browser.Lazy);
    flushSync();
    expectSameNodes(allNodes(host), printed);
    expect(mismatches).toEqual([]);
    host.querySelector('button')!.click();
    flushSync();
    expect(host.querySelector('span')!.textContent).toBe('fuel: 1');

    handle.unmount();
  });

  it('is let go by a branch that closes while the chunk is in flight, and built afresh when it opens again', async () => {
    const COND = `<main><v-meter :if="show.get()" label="fuel"></v-meter><v-tag></v-tag></main>`;
    const fields = () => ({ show: new Signal.State(true) });
    const served = shaped('server', async (meter) => meter, { page: COND, fields });
    const host = parsed((await page(served.Page)).html);
    const meter = host.querySelector('p')!;

    const gate = deferred<ComponentType<unknown>>();
    const browser = shaped('hydrate', () => gate.promise, { page: COND, fields });
    const handle = hydrate(browser.Page, host);
    expect(host.querySelector('p')).toBe(meter);

    // Closed while the chunk is in flight: the held nodes go with the branch,
    // and the chunk landing afterwards has nothing to claim and nowhere to
    // draw — the page it was for is gone.
    const show = (handle.instance as { show: Signal.State<boolean> }).show;
    show.set(false);
    flushSync();
    expect(host.querySelector('p')).toBeNull();
    expect(meter.isConnected).toBe(false);

    gate.resolve(browser.Meter);
    await preload(browser.Lazy);
    flushSync();
    expect(host.querySelector('p')).toBeNull();
    expect(host.textContent).not.toContain('loading…');

    // Opened again, the chunk is here and the component is built where a
    // client build would have built it: nothing left to claim.
    show.set(true);
    flushSync();
    const rebuilt = host.querySelector('p')!;
    expect(rebuilt).not.toBe(meter);
    host.querySelector('button')!.click();
    flushSync();
    expect(host.querySelector('span')!.textContent).toBe('fuel: 1');
    expect(mismatches).toEqual([]);

    handle.unmount();
  });

  it('writes each row of a list where the walk would have, and claims them when the chunk lands', async () => {
    const ROWS = `<ul><v-meter :for="m in meters.get()" :key="$index" :label="m"></v-meter></ul>`;
    const fields = () => ({ meters: new Signal.State(['a', 'b']) });
    const served = shaped('server', async (meter) => meter, { page: ROWS, fields });
    const late = await page(served.Page);
    expect(late.html).toBe((await page(served.Page)).html);
    expect(late.html.match(/<p class="meter" id="meter-[^"]+"/g)).toHaveLength(2);

    const host = parsed(late.html);
    const rows = Array.from(host.querySelectorAll('p'));
    const gate = deferred<ComponentType<unknown>>();
    const browser = shaped('hydrate', () => gate.promise, { page: ROWS, fields });
    const handle = hydrate(browser.Page, host);
    // In flight, the rows on the page are the server's.
    expect(Array.from(host.querySelectorAll('p'))).toEqual(rows);

    gate.resolve(browser.Meter);
    await preload(browser.Lazy);
    flushSync();
    // Landed: the same elements, each now its own row's.
    expect(Array.from(host.querySelectorAll('p'))).toEqual(rows);
    expect(mismatches).toEqual([]);
    rows[1]!.querySelector('button')!.click();
    flushSync();
    expect(rows[1]!.querySelector('span')!.textContent).toBe('b: 1');
    expect(rows[0]!.querySelector('span')!.textContent).toBe('a: 0');

    handle.unmount();
  });

  it('keeps the component it claimed when a signal it read while built changes', async () => {
    // Read once, in the constructor, by a component claimed after the walk.
    // The read belongs to the instance, not to the hole that built it: a hole
    // that answered it would build a second component over fresh nodes and
    // throw the claimed ones away.
    const source = new Signal.State('first');
    let built = 0;
    function reads(side: Side) {
      @Component({ selector: 'v-reads', render: renderFor(`<p>{ seen }</p>`, side) })
      class Reads {
        seen = source.get();
        constructor() {
          built++;
        }
      }
      return Reads;
    }
    function readsPage(side: Side, load: () => Promise<unknown>) {
      const Lazy = lazy('v-reads', load as () => Promise<ComponentType<unknown>>, { fallback: () => 'loading…' });
      @Component({ selector: 'v-page', imports: [Lazy], render: renderFor(`<main><v-reads></v-reads></main>`, side) })
      class Page {}
      return { Page, Lazy };
    }

    const onServer = reads('server');
    const host = parsed((await page(readsPage('server', async () => onServer).Page)).html);
    const claimed = host.querySelector('p')!;

    const gate = deferred<ComponentType<unknown>>();
    const browser = readsPage('hydrate', () => gate.promise);
    const handle = hydrate(browser.Page, host);
    gate.resolve(reads('hydrate'));
    await preload(browser.Lazy);
    flushSync();
    expect(host.querySelector('p')).toBe(claimed);
    const before = built;

    source.set('second');
    flushSync();
    expect(built).toBe(before);
    expect(host.querySelector('p')).toBe(claimed);
    expect(mismatches).toEqual([]);

    handle.unmount();
  });

  it('retries in the browser over the markup the server printed', async () => {
    const served = shaped('server', async (meter) => meter, { page: PAGE });
    const host = parsed((await page(served.Page)).html);
    const tag = host.querySelector('em');
    const printed = host.querySelector('p');

    let attempts = 0;
    const browser = shaped(
      'hydrate',
      async (meter) => {
        attempts++;
        if (attempts === 1) throw new Error('offline');
        return meter;
      },
      { page: PAGE },
      { error: (_, retry) => renderFor(`<button class="retry" :click="retry()">again</button>`, 'hydrate')({ retry }) },
    );
    const handle = hydrate(browser.Page, host);
    await preload(browser.Lazy);
    flushSync();
    expect(host.querySelector('p')).toBeNull();
    expect(host.querySelector('.retry')).not.toBeNull();

    // The server's nodes went with the error output; the retry builds the
    // component in its place rather than over nodes no longer there — the
    // fallback stands in while it loads, as on a page built in the browser.
    (host.querySelector('.retry') as HTMLElement).click();
    flushSync();
    expect(host.textContent).toContain('loading…');
    expect(host.querySelector('p')).toBeNull();
    await preload(browser.Lazy);
    flushSync();
    expect(attempts).toBe(2);
    expect(host.querySelector('.retry')).toBeNull();
    expect(host.querySelector('em')).toBe(tag);
    // Built, not claimed: the nodes the error output took away are not put
    // back and bound to.
    expect(host.querySelector('p')).not.toBe(printed);
    host.querySelector('button')!.click();
    flushSync();
    expect(host.querySelector('span')!.textContent).toBe('fuel: 1');
    expect(mismatches).toEqual([]);

    handle.unmount();
  });
});

describe('a lazy component inside another', () => {
  const OUTER = `<section :id="id"><v-meter label="inner"></v-meter></section>`;
  const NESTED = `<main><v-outer></v-outer><v-tag></v-tag></main>`;

  /** One side's page, with the meter in a chunk the outer component's chunk asks for. */
  function nested(
    side: Side,
    loadOuter: (outer: ComponentType<unknown>) => Promise<unknown>,
    loadMeter: (meter: ComponentType<unknown>) => Promise<unknown>,
  ) {
    const inner = shaped(side, loadMeter, { page: NESTED });

    @Component({ selector: 'v-outer', imports: [inner.Lazy], render: renderFor(OUTER, side) })
    class Outer {
      id = createId('outer');
    }

    const LazyOuter = lazy('v-outer', () => loadOuter(Outer) as Promise<ComponentType<unknown>>, {
      fallback: () => 'loading the outer…',
    });

    @Component({ selector: 'v-tag', render: renderFor(TAG, side) })
    class Tag {
      id = createId('tag');
    }

    @Component({ selector: 'v-page', imports: [LazyOuter, Tag], render: renderFor(NESTED, side) })
    class Page {}

    return { Page, Outer, LazyOuter, Meter: inner.Meter, LazyMeter: inner.Lazy };
  }

  let mismatches: HydrationMismatch[];
  let stop: () => void;

  beforeEach(() => {
    mismatches = [];
    stop = onHydrationMismatch((mismatch) => mismatches.push(mismatch));
  });

  afterEach(() => stop());

  it('is waited for in turn on the server, and written where the walk would have', async () => {
    const { Page } = nested(
      'server',
      async (outer) => outer,
      async (meter) => meter,
    );
    // Two rounds: the inner chunk is asked for only once the outer has
    // landed and been written, which is the next round's flush.
    const late = await page(Page);
    const walked = await page(Page);
    expect(late.html).toBe(walked.html);
    expect(late.html).toContain('<section id="outer-');
    expect(late.html).toContain('inner: 0');
    expect(late.html).not.toContain('loading');
  });

  it('holds the inner range through the outer chunk landing, and claims each as it lands', async () => {
    const served = nested(
      'server',
      async (outer) => outer,
      async (meter) => meter,
    );
    const host = document.createElement('div');
    host.innerHTML = (await page(served.Page)).html;
    document.body.append(host);
    resetIds();
    const printed = allNodes(host);
    const ids = [host.querySelector('section')!.id, host.querySelector('p')!.id, host.querySelector('em')!.id];

    const outerGate = deferred<ComponentType<unknown>>();
    const meterGate = deferred<ComponentType<unknown>>();
    const browser = nested(
      'hydrate',
      () => outerGate.promise,
      () => meterGate.promise,
    );
    const handle = hydrate(browser.Page, host);
    expectSameNodes(allNodes(host), printed);

    // The outer lands first: its range is claimed, and the inner's — found
    // inside it — is held in turn.
    outerGate.resolve(browser.Outer);
    await preload(browser.LazyOuter);
    flushSync();
    expectSameNodes(allNodes(host), printed);

    meterGate.resolve(browser.Meter);
    await preload(browser.LazyMeter);
    flushSync();
    expectSameNodes(allNodes(host), printed);
    expect([host.querySelector('section')!.id, host.querySelector('p')!.id, host.querySelector('em')!.id]).toEqual(ids);
    expect(mismatches).toEqual([]);

    host.querySelector('button')!.click();
    flushSync();
    expect(host.querySelector('span')!.textContent).toBe('inner: 1');

    handle.unmount();
  });
});
