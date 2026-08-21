/**
 * `__VOLT_BUILD__` — one comparison that catches a page printed by a compiler
 * the client no longer is.
 *
 * The failure it exists for leaves no evidence: paths still resolve, they just
 * land on nodes a different build put somewhere else, and bindings write over
 * whatever they find. So the only thing that keeps the guard honest is that
 * the hash covers every input capable of moving a byte — which is what these
 * tests hold it to, from three sides: a different compiler version hashes
 * differently, every covered option changes the hash, and every option the
 * compiler reads, across every construct in the corpus, is covered.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildHash, compile, COMPILER_VERSION, type CompileOptions } from '@voltdev/compiler';
import { buildHashFor, DEFAULTS } from '../src/build.js';
import { CORPUS } from './corpus.js';

/** A second legal value for each covered option, to hash against its default. */
const ALTERNATIVES: { [K in keyof typeof DEFAULTS]: (typeof DEFAULTS)[K] } = {
  whitespace: 'preserve',
  comments: true,
  runtime: '_v',
  ctx: '_self',
  runtimeModule: 'volt/runtime',
  groupRowBindings: true,
};

describe('the hash identifies the compiler that printed a page', () => {
  it('is the version this package publishes', () => {
    // A hash that keeps saying "same build" across a compiler upgrade is worse
    // than no hash, and nothing else in the repository would notice the drift.
    const pkg = JSON.parse(
      readFileSync(`${import.meta.dirname}/../package.json`, 'utf8'),
    ) as { version: string };
    expect(COMPILER_VERSION).toBe(pkg.version);
  });

  it('is a different hash for a different compiler version', () => {
    // Naming the version above proves only that the constant is current, not
    // that anything hashes it: with the version left out of the hash entirely
    // every other test here still passes, and two compilers a release apart
    // agree they printed the same page.
    expect(buildHashFor('0.1.0-alpha.2')).not.toBe(buildHashFor('0.1.0-alpha.1'));
    // And the hash this package hands out is that function at this version,
    // so the line above cannot pass against a second implementation.
    expect(buildHashFor(COMPILER_VERSION, { runtime: '_v' })).toBe(buildHash({ runtime: '_v' }));
  });

  it('is the same for the same options', () => {
    expect(buildHash({ runtime: '_v' })).toBe(buildHash({ runtime: '_v' }));
  });

  it('reads an omitted option as its default, so a filled-in config still matches', () => {
    // A dev server that normalises options and a build that passes none must
    // agree, or the guard discards every server-rendered page it sees.
    expect(buildHash({ ...DEFAULTS })).toBe(buildHash());
  });

  it('calls each option the value the compiler itself defaults to', () => {
    // The test above only proves `DEFAULTS` agrees with itself. If one of its
    // values drifts from the compiler's own, two builds that emit identical
    // output get different hashes, and every server-rendered page is thrown
    // away for a skew that never happened — a failure whose only symptom is
    // that server rendering stopped being worth anything.
    const template =
      `<div>\n  <!-- note -->\n` +
      `  <ul><li :for="n in ns.get()" :key="n" :class="{ big: n > 2 }">{ n }</li></ul>\n</div>`;
    const baseline = compile(template);
    for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      expect(compile(template, { [key]: DEFAULTS[key] }).code, key).toBe(baseline.code);
    }
  });

  it('is short enough to sit in a boot record', () => {
    expect(buildHash()).toMatch(/^[0-9a-z]{7}$/);
  });

  for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
    it(`changes when \`${key}\` does`, () => {
      expect(buildHash({ [key]: ALTERNATIVES[key] })).not.toBe(buildHash());
    });
  }
});

describe('every option the compiler reads is covered', () => {
  /** Option names `compile` looks at, over every construct it is given. */
  function optionsRead(templates: string[]): string[] {
    const seen = new Set<string>();
    const spy = new Proxy({} as CompileOptions, {
      get(target, key) {
        if (typeof key === 'string') seen.add(key);
        return Reflect.get(target, key);
      },
    });
    for (const template of templates) compile(template, spy);
    return [...seen].sort();
  }

  it('covers them all, bar the two that cannot move a byte', () => {
    // `filename` is deliberately outside the hash: it varies per template and
    // this identifies a build. `a11y` too, for its own reason — it decides
    // whether a template compiles at all, never what it compiles to, so two
    // builds that disagree about it still print identical markup and must
    // still hydrate each other's. `catalog` and `catalogFile` are excused on
    // exactly that second ground: a catalogue turns an unknown message key
    // into a build error, and a template that compiles compiles the same
    // bytes with it or without it. `target` is excused for the opposite
    // reason to all of them — not because it cannot change the emit, but
    // because it names which half of one build this is. The server emit and
    // the client emit of the same source differ by exactly this option, so
    // hashing it would make every hydration find a mismatch and discard the
    // markup it was given, which is the whole failure the hash exists to
    // prevent. Everything else the compiler consults can
    // move bytes, so it belongs in the hash whether or not it does so today.
    //
    // Driven over the whole corpus rather than one list: an option read on one
    // construct only — an event, a portal, a row inside an `<svg>` — is
    // invisible to a single template, and invisible is exactly how it would
    // stay out of the hash while moving bytes.
    expect(optionsRead(CORPUS.map((entry) => entry.template))).toEqual(
      [...Object.keys(DEFAULTS), 'filename', 'a11y', 'catalog', 'catalogFile', 'target'].sort(),
    );
  });
});

describe('the hash travels with the compile that produced it', () => {
  const template = `<ul><li :for="n in ns.get()" :key="n">{ n }</li></ul>`;

  it('is the hash of the options that compile was given', () => {
    // Otherwise every caller reconstructs an options object to hash, which is
    // the one way to end up with an identity for a build nobody ran.
    const sets: CompileOptions[] = [
      {},
      { runtime: '_v' },
      { whitespace: 'preserve' },
      { ...DEFAULTS, filename: 'src/page.html' },
    ];
    for (const options of sets) {
      expect(compile(template, options).buildHash, JSON.stringify(options)).toBe(
        buildHash(options),
      );
    }
  });

  it('separates two builds that emit different bytes', () => {
    expect(compile(template, { runtime: '_v' }).buildHash).not.toBe(
      compile(template).buildHash,
    );
  });

  it('is the same for every template one build compiles', () => {
    // It identifies the compiler, not the page — a boot record carries one of
    // these however many templates the page was assembled from.
    expect(compile(`<p>{ a.get() }</p>`).buildHash).toBe(compile(template).buildHash);
  });
});

describe('an option that moves bytes moves the hash', () => {
  /** Templates chosen so each option demonstrably changes what is emitted. */
  const observable: [key: keyof typeof DEFAULTS, template: string, field: 'body' | 'code'][] = [
    ['whitespace', `<div>\n  <b>a</b>\n</div>`, 'body'],
    ['comments', `<div><!-- note --></div>`, 'body'],
    ['runtime', `<span>{ n.get() }</span>`, 'body'],
    ['ctx', `<span>{ n.get() }</span>`, 'body'],
    ['runtimeModule', `<span>{ n.get() }</span>`, 'code'],
    [
      'groupRowBindings',
      `<ul><li :for="n in ns.get()" :key="n" :class="{ big: n > 2 }">{ n }</li></ul>`,
      'body',
    ],
  ];

  for (const [key, template, field] of observable) {
    it(`\`${key}\` is visible in the output and in the hash`, () => {
      const changed = { [key]: ALTERNATIVES[key] };
      expect(compile(template, changed)[field]).not.toBe(compile(template)[field]);
      expect(buildHash(changed)).not.toBe(buildHash());
    });
  }
});
