/**
 * The gate the SSR design record puts in front of hydration.
 *
 * `docs/design/ssr.md` ends stage three with a condition rather than a
 * feature: the server's output must parse to a tree structurally identical to
 * the one the client builds, "now with values", across the whole template
 * corpus — and hydration starts only once that holds, because hydration's
 * correctness is defined against these bytes. Stage three shipped without it.
 * `template-markup.test.ts` proves the *static* halves match, which is the
 * claim about chunks and holes; nothing ran values through both emitters and
 * compared what came out.
 *
 * So each template is compiled twice from one source, run against one context,
 * and the two results are compared as trees. A difference here is not a
 * cosmetic one: it is a node the client would bind to and the server never
 * wrote, which is precisely the class of bug that turns into a scrambled page
 * once hydration claims nodes by walking.
 *
 * What is compared is the element skeleton and the text it contains, not the
 * bytes. The two are allowed to disagree about comment markers — the client
 * leaves them behind as anchors it needs to reconcile against and the server
 * has nothing to reconcile — and about attribute order, which no consumer of
 * either tree can observe.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '@voltdev/compiler';
import { createRoot } from '@voltdev/reactivity';
import type { RenderFn } from '@voltdev/core';
import * as runtime from '@voltdev/core/runtime';
import { MarkupWriter } from '@voltdev/core/server';
import { CORPUS, type CorpusEntry } from '../../compiler/test/corpus.js';

/**
 * A value that answers whatever a template expression asks of it.
 *
 * The corpus is a survey of the emitter, not of any one application, so its
 * expressions call methods, index, iterate, chain optionally and reach for
 * globals. One object has to satisfy all of it and, more importantly, has to
 * answer *identically* on both sides — a context that varied between the two
 * renders would make every difference here meaningless.
 */
const STRING_METHODS = new Set(['toUpperCase', 'toLowerCase', 'trim', 'slice', 'replace', 'at']);

function value(seed: string, depth = 0): unknown {
  const rows = depth > 1 ? [] : [0, 1, 2].map((i) => value(`${seed}${i}`, depth + 1));
  // A plain object, deliberately not callable: the runtime treats a function
  // child as an accessor thunk (`dom.ts`, `materializeBlock`), so a callable
  // stand-in would be invoked, return another one, and never settle.
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
      // `:bind` spreads call their source. It is the one name in the corpus
      // used as a function rather than read, and it has to return real
      // attributes rather than another stand-in, since the two emitters write
      // whatever it yields.
      if (key === 'props') return () => ({ id: 'spread', title: 'from a spread' });
      return value(key);
    },
  });
}

/**
 * Templates whose markup is not this emitter's to print.
 *
 * A child component's markup comes from that child's own emit, reached through
 * the parent's `imports`, so rendering one here would be a claim about the
 * component graph rather than about the writer. Every construct these use is
 * covered by an entry that does not nest a component.
 */
function nestsComponent(entry: CorpusEntry): boolean {
  return /<(?:[a-z]+-[a-z-]+|[A-Z][A-Za-z]*)[\s/>]/.test(entry.template);
}

function serverOf(source: string): string {
  const { body } = compile(source, { runtime: '_rt', target: 'server' });
  const make = new Function('_rt', body) as (rt: unknown) => (ctx: object, out: MarkupWriter) => void;
  const out = new MarkupWriter();
  make(server)(context(), out);
  return out.toString();
}

function clientOf(source: string): string {
  const { body } = compile(source, { runtime: '_rt' });
  const fn = (new Function('_rt', body) as (rt: unknown) => RenderFn)(runtime);
  const host = document.createElement('div');
  document.body.append(host);
  createRoot(() => {
    runtime.insert(host, fn(context()));
  });
  // What a control holds lives in a property on this side and in an attribute
  // on the other, and only the attribute survives serialization. Reflecting
  // them makes the two comparable; it does not paper over a difference,
  // because a property and the attribute a server writes for it are exactly
  // the two ways of saying the same thing.
  for (const el of Array.from(host.querySelectorAll('input, textarea, select'))) {
    const control = el as HTMLInputElement;
    if (control.tagName === 'TEXTAREA') {
      if (control.value !== '') control.textContent = control.value;
    } else if (control.tagName === 'SELECT') {
      const chosen = (control as unknown as HTMLSelectElement).selectedOptions[0];
      if (chosen) chosen.setAttribute('selected', '');
    } else if (control.type === 'checkbox' || control.type === 'radio') {
      if (control.checked) control.setAttribute('checked', '');
    } else if (control.value !== '') {
      control.setAttribute('value', control.value);
    }
  }
  const html = host.innerHTML;
  host.remove();
  return html;
}

/**
 * The tree as anything downstream can see it: tags, attributes and text.
 *
 * Comments are dropped because the client keeps markers it needs and the
 * server writes none, and attributes are sorted because neither side promises
 * an order. Whitespace is collapsed rather than removed: text that ran
 * together on one side and not the other is a real difference.
 */
function skeleton(html: string): string {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const lines: string[] = [];

  const walk = (node: Node, depth: number): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 8) continue;
      if (child.nodeType === 3) {
        const text = (child.textContent ?? '').replace(/\s+/g, ' ');
        if (text.trim() !== '') lines.push(`${'  '.repeat(depth)}"${text.trim()}"`);
        continue;
      }
      const el = child as Element;
      const attrs = Array.from(el.attributes)
        .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
        .sort()
        .join(' ');
      lines.push(`${'  '.repeat(depth)}<${el.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>`);
      walk(el, depth + 1);
    }
  };

  walk(holder, 0);
  return lines.join('\n');
}

import * as server from '@voltdev/core/server';

const COVERED = CORPUS.filter((entry) => !nestsComponent(entry));
const EXCLUDED = CORPUS.filter(nestsComponent);

beforeAll(() => {
  // `:portal` resolves its selector against the live document on the client,
  // and refuses to guess. The server hands portalled markup back separately
  // rather than writing it inline, so on both sides what is compared here is
  // the remainder — which is the part a hydration walk has to agree about.
  for (const id of ['elsewhere', 'x']) {
    const target = document.createElement('div');
    target.id = id;
    document.body.append(target);
  }
});

describe('the server writes the tree the client builds', () => {
  it('covers the corpus apart from the templates that nest a component', () => {
    // Named rather than silently skipped: a shrinking denominator is how a
    // gate like this stops meaning anything.
    expect(COVERED.length + EXCLUDED.length).toBe(CORPUS.length);
    expect(COVERED.length).toBeGreaterThan(CORPUS.length * 0.75);
  });

/**
 * Where the two are known to disagree, and why each one is allowed to.
 *
 * Named rather than skipped, and asserted to still differ: if one of these is
 * ever made to agree, this test fails and says so, which is the only way a
 * list like it stays honest. Every other template in the corpus must match
 * exactly.
 */
const DIVERGES: Record<string, string> = {
  'interpolation-with-siblings':
    'the server writes one text node where the client builds two — hydration ' +
    'claims nodes by walking, so this is the case markers exist for',
  'for-table-rows':
    'a `:class` that resolves to nothing sets an empty class attribute on the ' +
    'client and writes none on the server',
  'model-select':
    'the server writes no selection at all: it has passed the options by the ' +
    'time the value is known, which `docs/reference/server.md` records as a gap',
  'model-number':
    'a number input rejects a value it cannot parse and the string writer ' +
    'does not — the DOM normalises, the server does not',
  'bind-style-object':
    'the CSSOM drops a declaration it cannot parse and the string writer does ' +
    'not — the same normalisation difference as model-number',
};

describe('where the two are allowed to differ', () => {
  it('names every one of them', () => {
    expect(Object.keys(DIVERGES).every((name) => CORPUS.some((e) => e.name === name))).toBe(true);
  });
});

  for (const entry of COVERED) {
    it(entry.name, () => {
      (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = true;
      const fromServer = serverOf(entry.template);
      (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = false;
      const fromClient = clientOf(entry.template);

      const reason = DIVERGES[entry.name];
      if (reason === undefined) {
        expect(skeleton(fromServer)).toBe(skeleton(fromClient));
      } else {
        expect(skeleton(fromServer), reason).not.toBe(skeleton(fromClient));
      }
    });
  }
});
