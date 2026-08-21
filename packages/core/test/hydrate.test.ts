/**
 * Hydration: the client taking over markup the server already printed.
 *
 * The honest test of it is a round trip. One source is compiled twice, the
 * server emit writes bytes, those bytes are parsed into a document, and the
 * hydrate emit runs against the same values — and then the question is not
 * whether the page looks right, which it would even if hydration threw
 * everything away and rendered from scratch. The question is whether the nodes
 * afterwards are the *same objects*, because that is the only difference
 * between claiming a tree and replacing one, and it is the entire point.
 *
 * So every case here holds a node from before hydration and asserts it is
 * still the node on the page afterwards, and then writes a signal and asserts
 * the update landed on that same node. A test that only compared HTML would
 * pass against a hydration that did nothing at all.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { compile } from '@voltdev/compiler';
import { Signal, flushSync } from '@voltdev/core';
import type { RenderFn } from '@voltdev/core';
import { createRoot } from '@voltdev/reactivity';
import * as runtime from '@voltdev/core/runtime';
import { MarkupWriter } from '@voltdev/core/server';
import * as server from '@voltdev/core/server';
import { CORPUS, type CorpusEntry } from '../../compiler/test/corpus.js';

type ServerRender = (ctx: object, out: MarkupWriter) => void;

function serverMarkup(source: string, ctx: object): string {
  const { body } = compile(source, { runtime: '_rt', target: 'server' });
  const make = new Function('_rt', body) as (rt: unknown) => ServerRender;
  const out = new MarkupWriter();
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = true;
  try {
    make(server)(ctx, out);
  } finally {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = false;
  }
  return out.toString();
}

function renderFn(source: string, target: 'client' | 'hydrate'): RenderFn {
  const { body } = compile(source, { runtime: '_rt', target });
  return (new Function('_rt', body) as (rt: unknown) => RenderFn)(runtime);
}

/** Parse the server's bytes into a real container, as a browser would. */
function serve(source: string, ctx: object): Element {
  const host = document.createElement('div');
  host.innerHTML = serverMarkup(source, ctx);
  document.body.append(host);
  return host;
}

/** Hydrate a container the server filled, and hand back what was in it. */
function hydrate(host: Element, source: string, ctx: object): void {
  createRoot(() => {
    runtime.hydrate(host, () => renderFn(source, 'hydrate')(ctx));
  });
}

/** Every node in the subtree, comments included, in document order. */
function allNodes(root: Node, out: Node[] = []): Node[] {
  for (const child of Array.from(root.childNodes)) {
    out.push(child);
    allNodes(child, out);
  }
  return out;
}

/**
 * The tree as anything downstream can see it: tags, attributes and text.
 *
 * Comments are dropped and adjacent text is joined, because a hydrated tree
 * keeps the server's delimiters and the text they split — a `<!--[-->` between
 * two halves of a sentence is invisible to a reader, to a screen reader and to
 * `textContent`, and re-joining is what lets this compare a hydrated page with
 * a freshly rendered one rather than with a transcript of how it was built.
 */
function shape(root: Node, depth = 0, lines: string[] = []): string[] {
  let text = '';
  const flush = (): void => {
    const trimmed = text.replaceAll(/\s+/g, ' ').trim();
    if (trimmed !== '') lines.push(`${'  '.repeat(depth)}"${trimmed}"`);
    text = '';
  };
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 8) continue;
    if (child.nodeType === 3) {
      text += child.textContent ?? '';
      continue;
    }
    flush();
    const el = child as Element;
    const attrs = Array.from(el.attributes)
      .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
      .sort()
      .join(' ');
    lines.push(`${'  '.repeat(depth)}<${el.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>`);
    shape(el, depth + 1, lines);
  }
  flush();
  return lines;
}

describe('a hydrated tree is the server’s tree, not a copy of it', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps the root element the server printed', () => {
    const ctx = { label: new Signal.State('one') };
    const host = serve(`<p class="a">{ label.get() }</p>`, ctx);
    const paragraph = host.firstChild!;
    const text = paragraph.firstChild!;

    hydrate(host, `<p class="a">{ label.get() }</p>`, ctx);

    expect(host.firstChild).toBe(paragraph);
    // The text node too: `bindText` patches `.data` when the element holds
    // exactly one text child, which is what the server wrote.
    expect(paragraph.firstChild).toBe(text);
    expect(paragraph.textContent).toBe('one');

    ctx.label.set('two');
    flushSync();
    expect(paragraph.firstChild).toBe(text);
    expect((text as Text).data).toBe('two');
  });

  it('claims the nodes a hole holds rather than replacing them', () => {
    const source = `<div><header>top</header><b :if="on.get()">mid</b><footer>end</footer></div>`;
    const ctx = { on: new Signal.State(true) };
    const host = serve(source, ctx);
    const before = allNodes(host);
    const branch = host.querySelector('b')!;

    hydrate(host, source, ctx);

    // Not one node in the subtree was replaced: hydration walked into the
    // server's markup and bound to what it found.
    expect(allNodes(host)).toEqual(before);
    expect(host.querySelector('b')).toBe(branch);

    // And the hole is live afterwards, which is the other half of the claim:
    // the delimiters bound what the branch owns, so switching it off removes
    // exactly those nodes and leaves its siblings alone.
    ctx.on.set(false);
    flushSync();
    expect(host.querySelector('b')).toBeNull();
    expect(host.textContent).toBe('topend');
    ctx.on.set(true);
    flushSync();
    expect(host.textContent).toBe('topmidend');
  });

  it('steps over a hole rather than through it, so later siblings still bind', () => {
    // The case the delimiters exist for: the server writes one text node where
    // the client's template has three children, so a plain `.nextSibling` from
    // the marker lands on the wrong node and every binding after it is off by
    // however many nodes the value came to.
    const source = `<p>[{ v.get() }]<b>{ w.get() }</b></p>`;
    const ctx = { v: new Signal.State('x'), w: new Signal.State('y') };
    const host = serve(source, ctx);
    const bold = host.querySelector('b')!;
    const before = allNodes(host);

    hydrate(host, source, ctx);

    expect(allNodes(host)).toEqual(before);
    expect(host.querySelector('b')).toBe(bold);
    expect(bold.textContent).toBe('y');

    ctx.w.set('z');
    flushSync();
    expect(host.querySelector('b')).toBe(bold);
    expect(bold.textContent).toBe('z');
    expect(host.textContent).toBe('[x]z');
  });

  it('keeps the rows of a list, which have no marker to be found by', () => {
    // `<ul>` wrapping one `:for` is the shape D1 called non-negotiable:
    // `replaceContent` with no marker clears the parent outright, so without
    // the claimed range seeded as `current` every server-rendered row is gone
    // before the first client row arrives.
    const source = `<ul><li :for="n in items.get()" :key="n">{ n }</li></ul>`;
    const ctx = { items: new Signal.State(['a', 'b', 'c']) };
    const host = serve(source, ctx);
    const rows = Array.from(host.querySelectorAll('li'));
    expect(rows).toHaveLength(3);

    hydrate(host, source, ctx);

    expect(Array.from(host.querySelectorAll('li'))).toEqual(rows);
    expect(host.textContent).toBe('abc');

    ctx.items.set(['a', 'c']);
    flushSync();
    // Keyed reconciliation over the server's own nodes: the surviving rows are
    // the elements the server printed, moved rather than rebuilt.
    expect(Array.from(host.querySelectorAll('li'))).toEqual([rows[0], rows[2]]);
  });

  it('claims a block with several roots', () => {
    const source = `<h1>{ a.get() }</h1><p>{ b.get() }</p>`;
    const ctx = { a: new Signal.State('one'), b: new Signal.State('two') };
    const host = serve(source, ctx);
    const before = allNodes(host);

    hydrate(host, source, ctx);

    expect(allNodes(host)).toEqual(before);
    ctx.b.set('three');
    flushSync();
    expect(host.querySelector('p')).toBe(before[2]);
    expect(host.textContent).toBe('onethree');
  });

  it('claims through nested holes', () => {
    const source =
      `<section><div :if="outer.get()"><span>{ label.get() }</span>` +
      `<em :if="inner.get()">deep</em></div></section>`;
    const ctx = {
      outer: new Signal.State(true),
      inner: new Signal.State(true),
      label: new Signal.State('hi'),
    };
    const host = serve(source, ctx);
    const before = allNodes(host);
    const deep = host.querySelector('em')!;

    hydrate(host, source, ctx);

    expect(allNodes(host)).toEqual(before);
    expect(host.querySelector('em')).toBe(deep);

    ctx.inner.set(false);
    flushSync();
    expect(host.querySelector('em')).toBeNull();
    expect(host.querySelector('span')!.textContent).toBe('hi');
  });

  it('binds attributes onto the element the server wrote them on', () => {
    const source = `<a href="/x" :class="{ on: v.get() }" :title="t.get()">go</a>`;
    const ctx = { v: new Signal.State(true), t: new Signal.State('first') };
    const host = serve(source, ctx);
    const link = host.querySelector('a')!;

    hydrate(host, source, ctx);

    expect(host.querySelector('a')).toBe(link);
    expect(link.getAttribute('title')).toBe('first');
    expect(link.className).toContain('on');

    ctx.t.set('second');
    ctx.v.set(false);
    flushSync();
    expect(link.getAttribute('title')).toBe('second');
    expect(link.className).not.toContain('on');
  });

  it('builds fresh once hydration is over, from the same emit', () => {
    // The hydrate emit is what an SSR client build ships, so it has to serve a
    // block created long after the page was claimed — a branch turning true.
    // `hClaim` clones with nothing to claim from, and `hClose` gives back the
    // marker it was handed, which is what a client build steps from anyway.
    const source = `<div><b :if="on.get()">mid</b></div>`;
    const ctx = { on: new Signal.State(false) };
    const host = serve(source, ctx);
    expect(host.querySelector('b')).toBeNull();

    hydrate(host, source, ctx);
    ctx.on.set(true);
    flushSync();

    expect(host.querySelector('b')!.textContent).toBe('mid');
    ctx.on.set(false);
    flushSync();
    expect(host.querySelector('b')).toBeNull();
  });
});

describe('a claim that finds the wrong thing gives up on that hole alone', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reports the mismatch, clones, and leaves the rest of the page claimed', () => {
    const source = `<div><header>top</header><b :if="on.get()">mid</b><footer>end</footer></div>`;
    const ctx = { on: new Signal.State(true) };
    const host = serve(source, ctx);
    // Markup from a build that disagreed about this branch. Everything else is
    // the same bytes, which is what makes this a per-hole failure rather than
    // a page-wide one.
    host.innerHTML = host.innerHTML.replace('<b>mid</b>', '<i>mid</i>');
    const header = host.querySelector('header')!;
    const footer = host.querySelector('footer')!;

    const found: string[] = [];
    const stop = runtime.onHydrationMismatch((mismatch) => {
      found.push(`${mismatch.expected}/${mismatch.found?.nodeName ?? 'nothing'}`);
    });
    try {
      hydrate(host, source, ctx);
    } finally {
      stop();
    }

    expect(found).toEqual(['B/I']);
    // The wrongly-claimed node is gone and the branch is the clone's.
    expect(host.querySelector('i')).toBeNull();
    expect(host.querySelector('b')!.textContent).toBe('mid');
    // Damage bounded to the hole: its siblings are still the server's nodes.
    expect(host.querySelector('header')).toBe(header);
    expect(host.querySelector('footer')).toBe(footer);
    expect(host.textContent).toBe('topmidend');
  });

  it('reports once for a range, however many blocks would have counted from it', () => {
    const source = `<ul><li :for="n in items.get()" :key="n">{ n }</li></ul>`;
    const ctx = { items: new Signal.State(['a', 'b', 'c']) };
    const host = serve(source, ctx);
    host.innerHTML = host.innerHTML.replaceAll('<li>', '<div>').replaceAll('</li>', '</div>');

    const found: string[] = [];
    const stop = runtime.onHydrationMismatch((mismatch) => found.push(mismatch.expected));
    try {
      hydrate(host, source, ctx);
    } finally {
      stop();
    }

    expect(found).toEqual(['LI']);
    expect(host.querySelectorAll('div')).toHaveLength(0);
    expect(host.textContent).toBe('abc');
  });
});

/**
 * Templates whose markup is not this emitter's to print.
 *
 * A child component's markup comes from that child's own emit, reached through
 * the parent's `imports`, so rendering one here would be a claim about the
 * component graph rather than about the walk. The same exclusion
 * `server-client-parity.test.ts` makes, for the same reason.
 */
function nestsComponent(entry: CorpusEntry): boolean {
  return /<(?:[a-z]+-[a-z-]+|[A-Z][A-Za-z]*)[\s/>]/.test(entry.template);
}

const STRING_METHODS = new Set(['toUpperCase', 'toLowerCase', 'trim', 'slice', 'replace', 'at']);

/**
 * A value that answers whatever a template expression asks of it, identically
 * on both sides — see `server-client-parity.test.ts`, which needs the same
 * thing for the same reason: a context that varied between the two renders
 * would make every difference here meaningless.
 */
function value(seed: string, depth = 0): unknown {
  const rows = depth > 1 ? [] : [0, 1, 2].map((i) => value(`${seed}${i}`, depth + 1));
  return new Proxy(Object.create(null) as object, {
    has: () => true,
    get(_t, key: string | symbol) {
      if (key === Symbol.iterator) return () => rows[Symbol.iterator]();
      if (key === Symbol.toPrimitive) return (hint: string) => (hint === 'number' ? 1 : seed);
      if (key === 'toJSON') return () => seed;
      if (key === 'toString') return () => seed;
      if (key === 'length') return rows.length;
      if (key === 'get') return () => value(seed, depth);
      if (typeof key === 'symbol') return undefined;
      if (STRING_METHODS.has(key)) return () => seed;
      if (key === 'id') return seed;
      if (/^\d+$/.test(key)) return rows[Number(key)];
      return value(`${seed}.${key}`, depth);
    },
  });
}

function context(): object {
  return new Proxy(Object.create(null) as object, {
    has: () => true,
    get(_t, key: string | symbol) {
      if (typeof key === 'symbol') return undefined;
      if (key === 'props') return () => ({ id: 'spread', title: 'from a spread' });
      return value(key);
    },
  });
}

/**
 * The corpus, hydrated.
 *
 * The cases above prove identity on the shapes that carry the mechanism; this
 * proves the mechanism does not *break* anything, across every construct the
 * compiler emits markup for. What it compares is a hydrated page against a
 * freshly client-rendered one: hydration is allowed to arrive at the tree by a
 * different route, and not allowed to arrive anywhere else.
 */
/**
 * Where a hydrated tree keeps something a fresh client render never has, and
 * why each one is allowed to.
 *
 * All of them are one divergence, the one `server-client-parity.test.ts`
 * already names twice: a control's value lives in markup on the server's side
 * and in an IDL property on the client's, and `value` and `checked` are the
 * two attributes that do not reflect. Hydration sets the property and leaves
 * the server's spelling of the value standing beside it — which is what a
 * server-rendered form looks like, and is what makes the page survive a reset
 * or a back-button restore. It is visible here at all only because what it is
 * compared against is a tree that was never server-rendered.
 *
 * Asserted to still differ rather than skipped, so that closing either one
 * fails this test and says so.
 */
const KEEPS_THE_SERVERS_MARKUP: Record<string, string> = {
  'bind-prop': 'the server wrote `value` as an attribute; `:value` sets the property',
  'model-text': 'the server wrote `value` as an attribute; `:model` sets the property',
  'model-modifiers': 'the server wrote `value` as an attribute; `:model` sets the property',
  'model-number':
    'the server wrote `value` as an attribute and `:model` sets the property, so the ' +
    'attribute a number input would not have accepted stays in the tree — which is ' +
    'the divergence the parity gate already names for this template',
  'model-with-sibling': 'the server wrote `value` as an attribute; `:model` sets the property',
  'model-checkbox': 'the server wrote `checked`; `:model` sets the property',
  'model-textarea':
    'a textarea holds its value as its content, which is what the server wrote; ' +
    '`:model` sets the property and leaves that content standing behind it',
};

describe('every template in the corpus hydrates to the tree a client build renders', () => {
  const covered = CORPUS.filter((entry) => !nestsComponent(entry));

  beforeEach(() => {
    document.body.innerHTML = '';
    // `:portal` resolves its selector against the live document and refuses to
    // guess, so the targets it names have to exist.
    for (const id of ['elsewhere', 'x']) {
      const target = document.createElement('div');
      target.id = id;
      document.body.append(target);
    }
  });

  it('covers the corpus apart from the templates that nest a component', () => {
    expect(covered.length).toBeGreaterThan(CORPUS.length * 0.75);
    // Named rather than silently skipped: a shrinking denominator is how a
    // gate like this stops meaning anything.
    expect(
      Object.keys(KEEPS_THE_SERVERS_MARKUP).every((name) => covered.some((e) => e.name === name)),
    ).toBe(true);
  });

  for (const entry of covered) {
    it(entry.name, () => {
      const hydrated = serve(entry.template, context());
      hydrate(hydrated, entry.template, context());

      const fresh = document.createElement('div');
      document.body.append(fresh);
      createRoot(() => {
        runtime.insert(fresh, renderFn(entry.template, 'client')(context()));
      });

      const reason = KEEPS_THE_SERVERS_MARKUP[entry.name];
      if (reason === undefined) {
        expect(shape(hydrated)).toEqual(shape(fresh));
      } else {
        expect(shape(hydrated), reason).not.toEqual(shape(fresh));
      }
    });
  }
});
