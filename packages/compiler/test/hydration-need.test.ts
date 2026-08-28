/**
 * "Can this ever change?" — the question partial hydration turns on.
 *
 * The roadmap's position is that Volt does not need an island annotation
 * because the compiler already separates static from dynamic per node. What it
 * was missing is not the boundary but the answer: whether a template, taken
 * whole, has anything to attach at all.
 *
 * Asked of the emit rather than of a feature list. That matters for the tests
 * below as much as for the code: a case here that a future construct breaks
 * will break loudly, where a list of flags would quietly gain a hole.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.js';
import { CORPUS } from './corpus.js';

const needs = (source: string): boolean =>
  compile(source, { runtime: '_rt', target: 'client' }).needsHydration;

describe('a template with nothing that can change', () => {
  it('needs no hydration', () => {
    expect(needs(`<article><h1>Title</h1><p>Some prose.</p></article>`)).toBe(false);
  });

  it('still needs none when it is deep, or has attributes', () => {
    expect(
      needs(`<section class="a"><div><ul><li>one</li><li>two</li></ul></div></section>`),
    ).toBe(false);
  });

  it('needs none for an anchor, which the browser handles itself', () => {
    // The case that makes this worth having: a page of prose and links is the
    // shape that should ship no JavaScript, and an `href` is not a binding.
    expect(needs(`<nav><a href="/about">About</a></nav>`)).toBe(false);
  });
});

describe('a template with something that can', () => {
  it('needs it for an interpolation', () => {
    expect(needs(`<p>{ title }</p>`)).toBe(true);
  });

  it('needs it for a bound attribute', () => {
    expect(needs(`<div><p :class="{ on: active }">x</p></div>`)).toBe(true);
  });

  it('needs it for an event handler', () => {
    expect(needs(`<div><button :click="go()">go</button></div>`)).toBe(true);
  });

  it('needs it for a block', () => {
    expect(needs(`<div><p :if="shown">x</p></div>`)).toBe(true);
    expect(needs(`<ul><li :for="row in rows" :key="row">x</li></ul>`)).toBe(true);
  });

  it('needs it for a ref, which changes nothing on screen', () => {
    // Nothing about the markup depends on it, and the component still has to
    // be handed the node — so a page that shipped no JavaScript here would
    // leave a field null for ever.
    expect(needs(`<div><input :ref="field"></div>`)).toBe(true);
  });

  it('needs it for a child component', () => {
    expect(needs(`<div><v-badge></v-badge></div>`)).toBe(true);
  });
});

describe('the invariant the answer rests on', () => {
  it('never leaves a template call in the render body, for any corpus entry', () => {
    // `needsHydration` reads "does the body touch the runtime at all", which is
    // only the right question because every markup string is hoisted out of
    // the body first. If that ever stopped being true, every template with
    // markup in it would read as dynamic — the safe direction, and still
    // wrong, and silently so. This is where it stops being silent.
    const inBody: string[] = [];
    for (const entry of CORPUS) {
      for (const target of ['client', 'hydrate', 'server'] as const) {
        let compiled;
        try {
          compiled = compile(entry.source, { runtime: '_rt', target });
        } catch {
          // An entry the compiler refuses is not a statement about hoisting.
          continue;
        }
        if (/_rt\.template\(/.test(compiled.renderBody)) inBody.push(`${entry.name} (${target})`);
      }
    }
    expect(inBody).toEqual([]);
  });
});
