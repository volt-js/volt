/**
 * Where an application's bytes actually go.
 *
 * `size.test.ts` weighs the published packages one file at a time, which
 * answers "did this change add weight" and cannot answer "weight spent on
 * what". The roadmap's two open bundle items are the second question — the
 * component and DOM runtime was recorded as 41% of an app bundle and the
 * generated template code as 21%, both from a reading nobody wrote down a
 * method for. This file is that method, so the next person arguing about
 * where to cut is arguing with a number they can reproduce.
 *
 * The subject is `examples/counter`: three components, a keyed list, a branch
 * chain, delegated events and a two-way binding. Small, but it exercises
 * enough of the runtime that tree shaking has something to decide.
 *
 * Bytes are attributed by source map, minified rather than gzipped. Gzip is
 * not additive — a module's compressed contribution depends on what else is
 * in the file — so per-source gzip shares are a number with no meaning. The
 * gzipped total is asserted separately, because that is the figure a user
 * downloads.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build as esbuild, transformSync } from 'esbuild';
import { build } from 'vite';
import type { RollupOutput } from 'rollup';
import { compile } from '@voltdev/compiler';

const root = resolve(import.meta.dirname, '../../..');
const example = resolve(root, 'examples/counter');

/**
 * The built packages, not the sources.
 *
 * An application resolves `@voltdev/core` to `dist`, and `dist` is what
 * decides which chunks exist and what a bundler is allowed to drop. Measuring
 * a build against the sources measures a bundle no user ever receives.
 */
const built = ['packages/core/dist/index.js', 'packages/reactivity/dist/index.js'].every((p) =>
  existsSync(resolve(root, p)),
);

// -----------------------------------------------------------------------------
// Source map attribution
// -----------------------------------------------------------------------------

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Map([...BASE64].map((c, i) => [c, i] as const));

function decodeVlq(field: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of field) {
    const digit = DIGIT.get(char)!;
    value |= (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    const negative = value & 1;
    value >>>= 1;
    out.push(negative ? -value : value);
    value = 0;
    shift = 0;
  }
  return out;
}

interface Segment {
  column: number;
  source: number;
  line: number;
  sourceColumn: number;
}

/** Segments per generated line, in column order, as the format already stores them. */
function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let source = 0;
  let line = 0;
  let column = 0;
  for (const encoded of mappings.split(';')) {
    const row: Segment[] = [];
    let generatedColumn = 0;
    if (encoded) {
      for (const field of encoded.split(',')) {
        const parts = decodeVlq(field);
        generatedColumn += parts[0]!;
        if (parts.length >= 4) {
          source += parts[1]!;
          line += parts[2]!;
          column += parts[3]!;
          row.push({ column: generatedColumn, source, line, sourceColumn: column });
        } else {
          row.push({ column: generatedColumn, source: -1, line: -1, sourceColumn: -1 });
        }
      }
    }
    lines.push(row);
  }
  return lines;
}

/** Bytes no original line owns: the chunk's wrapper and Vite's own preamble. */
const GLUE = '(module glue)';

interface SourceMap {
  sources: (string | null)[];
  mappings: string;
}

interface Decoded {
  dir: string;
  sources: (string | null)[];
  lines: Segment[][];
}

function decode(map: SourceMap, dir: string): Decoded {
  return { dir, sources: map.sources, lines: decodeMappings(map.mappings) };
}

/** The last segment at or before a position, which is the one that owns it. */
function segmentAt(decoded: Decoded, line: number, column: number): Segment | null {
  const row = decoded.lines[line];
  if (!row || row.length === 0) return null;
  let low = 0;
  let high = row.length - 1;
  let found: Segment | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (row[mid]!.column <= column) {
      found = row[mid]!;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * Minified bytes per original source file, and per line within it.
 *
 * Two levels of map, because the application's map names the *packages'* built
 * files — `core/dist/component-*.js` — and a budget written against a content
 * hash measures nothing the first time the chunk changes. Following each
 * package's own map the rest of the way lands on `src/dom.ts`, which is a name
 * that survives a rebuild and a name somebody can act on.
 *
 * The line is kept as well as the file because "40% is the component and DOM
 * runtime" is not an answer anybody can act on either: it says where the bytes
 * are and not what they buy. A line resolves to a declaration, and a
 * declaration is a thing a reader can decide is worth its weight.
 */
function attribute(code: string, map: SourceMap, dir: string): Map<string, Map<number, number>> {
  const top = decode(map, dir);
  const codeLines = code.split('\n');
  const nested = new Map<number, Decoded | null>();

  const chainFor = (index: number): Decoded | null => {
    if (nested.has(index)) return nested.get(index)!;
    const file = resolve(dir, top.sources[index] ?? '');
    const sidecar = `${file}.map`;
    const loaded =
      existsSync(sidecar) && existsSync(file)
        ? decode(JSON.parse(readFileSync(sidecar, 'utf8')) as SourceMap, dirname(sidecar))
        : null;
    nested.set(index, loaded);
    return loaded;
  };

  const bytes = new Map<string, Map<number, number>>();
  const add = (key: string, line: number, count: number): void => {
    const lines = bytes.get(key) ?? new Map<number, number>();
    lines.set(line, (lines.get(line) ?? 0) + count);
    bytes.set(key, lines);
  };

  for (const [generatedLine, row] of top.lines.entries()) {
    // The newline is a byte of the file too, and dropping it leaves the parts
    // adding up to less than the whole for no reason a reader could guess.
    const lineLength = (codeLines[generatedLine] ?? '').length + 1;
    if (row.length === 0) {
      add(GLUE, 0, lineLength);
      continue;
    }
    if (row[0]!.column > 0) add(GLUE, 0, row[0]!.column);

    for (const [i, segment] of row.entries()) {
      const end = i + 1 < row.length ? row[i + 1]!.column : lineLength;
      const count = Math.max(0, end - segment.column);
      if (segment.source < 0) {
        add(GLUE, 0, count);
        continue;
      }
      const chain = chainFor(segment.source);
      if (!chain) {
        add(relative(root, resolve(dir, top.sources[segment.source] ?? '')), segment.line, count);
        continue;
      }
      const inner = segmentAt(chain, segment.line, segment.sourceColumn);
      if (!inner || inner.source < 0) {
        add(GLUE, 0, count);
        continue;
      }
      add(relative(root, resolve(chain.dir, chain.sources[inner.source] ?? '')), inner.line, count);
    }
  }
  return bytes;
}

// -----------------------------------------------------------------------------
// The bundle under measurement
// -----------------------------------------------------------------------------

const bundled = (async () => {
  const result = (await build({
    root: example,
    logLevel: 'silent',
    build: { write: false, sourcemap: true },
  })) as unknown as RollupOutput[];

  const chunk = (Array.isArray(result) ? result[0]! : (result as RollupOutput)).output.find(
    (o) => o.type === 'chunk',
  )!;
  if (chunk.type !== 'chunk' || !chunk.map) throw new Error('the example built without a map');

  const lines = attribute(chunk.code, chunk.map as SourceMap, resolve(example, 'dist/assets'));
  return { code: chunk.code, bytes: totals(lines), lines };
})();

/** One entry per file, which is what every share below is taken over. */
function totals(bytes: Map<string, Map<number, number>>): Map<string, number> {
  const flat = new Map<string, number>();
  for (const [file, lines] of bytes) {
    flat.set(file, [...lines.values()].reduce((a, b) => a + b, 0));
  }
  return flat;
}

/** Every source under a package directory, added together. */
function share(bytes: Map<string, number>, prefixes: string[]): number {
  let total = 0;
  for (const [file, count] of bytes) {
    if (prefixes.some((p) => file.startsWith(p))) total += count;
  }
  return total;
}

/**
 * The code the compiler writes into the application's own modules.
 *
 * Not taken from the map: the template transform returns no source map of its
 * own, so Vite treats it as identity and the generated header is attributed to
 * whichever original lines it happens to overlap. Compiling the same templates
 * and minifying the result the same way measures the same bytes without
 * asking the map a question it cannot answer.
 */
const generated = (): number => {
  let total = 0;
  for (const template of ['app.html', 'counter.html', 'todos.html']) {
    const source = readFileSync(resolve(example, 'src', template), 'utf8');
    const { body } = compile(source, { runtime: '_rt' });
    total += transformSync(`function _render(_ctx, _rt) {${body}}`, {
      loader: 'js',
      minify: true,
      target: 'esnext',
    }).code.length;
  }
  return total;
};

/**
 * What a top-level declaration is called, and the line it starts on.
 *
 * Read from the source rather than from the map's `names` field: that field
 * records what the minifier renamed, which for a module-private helper is a
 * single letter. The declaration keyword at column zero is the whole rule, and
 * it holds because these are hand-written modules rather than generated ones.
 */
function declarations(file: string): { name: string; line: number }[] {
  const source = readFileSync(resolve(root, file), 'utf8').split('\n');
  const found: { name: string; line: number }[] = [];
  for (const [index, text] of source.entries()) {
    const match = /^(?:export )?(?:declare )?(?:async )?(?:function\*? |class |const |let |var )([A-Za-z_$][\w$]*)/.exec(text);
    if (match) found.push({ name: match[1]!, line: index });
  }
  return found;
}

/**
 * Minified bytes per declaration of one source file, largest first.
 *
 * A line belongs to the last declaration that began at or before it, which is
 * what a flat module means: everything after `function insert(` and before the
 * next declaration is `insert`.
 */
function perDeclaration(lines: Map<number, number>, file: string): [string, number][] {
  const marks = declarations(file);
  const bytes = new Map<string, number>();
  for (const [line, count] of lines) {
    let owner = '(module top)';
    for (const mark of marks) {
      if (mark.line > line) break;
      owner = mark.name;
    }
    bytes.set(owner, (bytes.get(owner) ?? 0) + count);
  }
  return [...bytes].sort((a, b) => b[1] - a[1]);
}

/** The sources under a package directory that carry any bytes at all, by file name. */
function modulesUnder(bytes: Map<string, number>, prefix: string): string[] {
  return [...bytes]
    .filter(([file, count]) => file.startsWith(prefix) && count > 0)
    .map(([file]) => file.slice(prefix.length))
    .sort();
}

/**
 * Every figure below is a reading, not a target.
 *
 * The temptation with a table like this is to write down what the runtime
 * ought to cost and assert that instead. A ceiling the code does not clear is
 * a wish with a test runner attached: red from the day it lands, and it
 * teaches whoever inherits it to skip the file. So each layer is pinned to a
 * band around what it actually measures, wide enough for ordinary churn and
 * narrow enough that a real shift in composition has to be looked at. The lower bounds are not
 * decoration: attribution failing open would drop every share to zero, and a
 * one-sided assertion would call that a triumph.
 *
 * Where to cut, if the answer is wanted: `dom.ts` alone is a quarter of the
 * bundle, and `graph.ts` and `effect.ts` together are another quarter.
 */
describe.skipIf(!built)('what an application bundle is made of', { timeout: 120_000 }, () => {
  it('weighs 26 kB minified and 9 kB gzipped', async () => {
    const { code } = await bundled;
    const gzipped = gzipSync(code, { level: 9 }).length;
    // It was 24 kB. Two correctness changes bought the rest and are named so
    // that the next person can argue with them: props that arrive while a
    // field initializes put `initProp` and what it calls into every lowered
    // build for the first time, and a block that owns what its holes draw
    // added the span walk and the sweep that goes with it.
    expect(code.length, 'minified').toBeGreaterThan(22_000);
    expect(code.length, 'minified').toBeLessThanOrEqual(27_000);
    expect(gzipped, 'gzipped').toBeGreaterThan(8_000);
    expect(gzipped, 'gzipped').toBeLessThanOrEqual(10_000);
  });

  it('spends two fifths on the component and DOM runtime and three tenths on reactivity', async () => {
    const { code, bytes } = await bundled;
    const report = [...bytes]
      .sort((a, b) => b[1] - a[1])
      .map(([file, count]) => `${String(count).padStart(6)}  ${file}`)
      .join('\n');
    const layer = (prefix: string): number => share(bytes, [prefix]) / code.length;

    // 11,137 B of 25,752: 43.2%, which is the roadmap's "41%" confirmed by a
    // method somebody can rerun rather than by memory. It rose by about three
    // points when props began arriving while a field initializes: a build that
    // lowers `@Prop` away calls `initProp` from every field, so the code that
    // reads what the parent passed is in the bundle for the first time. That
    // is the feature, not overhead — the alternative was every component built
    // on a primitive handing it a default.
    expect(layer('packages/core/src/'), `\n${report}\n`).toBeGreaterThan(0.37);
    expect(layer('packages/core/src/'), `\n${report}\n`).toBeLessThan(0.46);

    // 7,403 B: 30.9%, and the largest single item in the whole table after
    // `dom.ts` is the reactive graph.
    expect(layer('packages/reactivity/src/'), `\n${report}\n`).toBeGreaterThan(0.28);
    expect(layer('packages/reactivity/src/'), `\n${report}\n`).toBeLessThan(0.34);

    // 6,171 B: 25.8%. The application's own three components are the only part
    // of this table that a framework change cannot move.
    expect(layer('examples/counter/src/'), `\n${report}\n`).toBeGreaterThan(0.23);
    expect(layer('examples/counter/src/'), `\n${report}\n`).toBeLessThan(0.29);
  });

  it('carries only the modules the application names', async () => {
    const { bytes } = await bundled;

    // The share above is worth reading only because this holds. `devtools.ts`
    // is 984 lines and `server.ts` 1,080 — between them larger than everything
    // that does ship — and neither reaches a browser, along with the JIT
    // template compiler and the hydration registry. An import that reached any
    // of them from `mount` would roughly triple the runtime's share without
    // any one function looking expensive, so the set is pinned by name rather
    // than left to a byte ceiling to notice.
    expect(modulesUnder(bytes, 'packages/core/src/')).toEqual([
      'component.ts',
      // The shape every refusal in the framework throws. It is here because
      // the throw itself is behaviour a correct program depends on — only the
      // sentence inside it is stripped — so a build that dropped this module
      // would be a build that stopped refusing.
      'diagnostics.ts',
      'dom.ts',
      'ids.ts',
      'reuse-marks.ts',
    ]);
    expect(modulesUnder(bytes, 'packages/reactivity/src/')).toEqual([
      'effect.ts',
      'errors.ts',
      'graph.ts',
      'request.ts',
    ]);
  });

  it('emits a sixth of the bundle from the three templates', async () => {
    const { code } = await bundled;
    const emitted = generated();
    // 4,085 B: 17.1%, against the 21% the roadmap recorded. The gap is the
    // difference between counting the generated code alone and counting the
    // application modules it sits inside, which are 25.8% together — so both
    // readings were of something real and neither said which. This one is the
    // generated code by itself.
    //
    // It is also the one line in the table that grows with the application
    // rather than with the framework, so the share is what is held; the
    // absolute figure is allowed to move when a template does.
    expect(emitted / code.length, `${emitted} B of generated code`).toBeGreaterThan(0.14);
    expect(emitted / code.length, `${emitted} B of generated code`).toBeLessThan(0.21);
  });

  it('spends a third of the DOM runtime on keyed lists, and names the rest', async () => {
    const { code, lines } = await bundled;
    const dom = perDeclaration(lines.get('packages/core/src/dom.ts')!, 'packages/core/src/dom.ts');
    const report = dom.map(([name, count]) => `${String(count).padStart(5)}  ${name}`).join('\n');
    const bytes = (name: string): number => dom.find(([n]) => n === name)?.[1] ?? 0;

    // The roadmap asks what 41% is spent on, and a share of a file is not an
    // answer to that: `dom.ts` is one flat module, so the reply has to be per
    // declaration. `each` is the largest single thing in the bundle at 1,034 B
    // and its reconciler is the second at 781 B — together with `createRow`,
    // 2,000 B, a twelfth of everything the browser downloads, for keeping a
    // keyed list in step with an array without re-rendering it.
    expect(dom[0]![0], `\n${report}\n`).toBe('each');
    const keyed = bytes('each') + bytes('reconcileArrays') + bytes('createRow');
    expect(keyed / code.length, `${keyed} B of keyed-list machinery`).toBeGreaterThan(0.06);
    expect(keyed / code.length, `${keyed} B of keyed-list machinery`).toBeLessThan(0.11);
  });

  it('carries only the parts of the DOM runtime these three templates reach', async () => {
    const { lines } = await bundled;
    const dom = perDeclaration(lines.get('packages/core/src/dom.ts')!, 'packages/core/src/dom.ts');

    // The module-level pin above says `dom.ts` ships; this says what of it,
    // which is the only form in which "40%" is something a reader can argue
    // with. Every name here is reached by one of `app.html`, `counter.html`
    // and `todos.html`, and the names that are *not* here are the argument
    // that the share is a floor rather than a slack: no hydration walk, no
    // lazy boundary, no portal, and one `:model` entry point out of four
    // because the compiler picks the control at build time rather than
    // switching on it at runtime. A binding kind appearing here that no
    // template asks for is a tree-shaking regression, and it would otherwise
    // be invisible — `dom.ts` would simply weigh more.
    expect(dom.map(([name]) => name).sort()).toEqual([
      'appendAll',
      'bind',
      'bindClassToggle',
      'bindProp',
      'bindText',
      'branch',
      'buildEffect',
      'collecting',
      'createRow',
      'delegate',
      'delegatedTypes',
      'dispatchDelegated',
      'each',
      'flattenToNodes',
      'guard',
      'insert',
      'insertExpression',
      'materializeBlock',
      'modelText',
      'on',
      // Four bytes of call for the question every marker-based binding has to
      // ask each time it writes: where its content is now, rather than where
      // it was built. A template with several roots is built in a fragment it
      // is then moved out of.
      'parentOf',
      'readModel',
      'reconcileArrays',
      'removeNodes',
      'replaceContent',
      // The positional scan the reconcile tries before building its key map.
      // It is here because every keyed list reaches it, which is the point of
      // it — a list that never takes the fast path pays one pointer comparison
      // per row to find that out.
      'sameKeysInOrder',
      // A block is the span between its first root and its last, so that what
      // a hole among them draws afterwards belongs to it: `spanOf` reads that
      // span back, and `sweepOrphans` lets go of what is in it and in neither
      // list when a row goes.
      'spanOf',
      'sweepOrphans',
      'template',
      'toDisplayString',
      'writeModel',
    ]);
  });

  it('spends three fifths of the reactive graph on its three kinds of node', async () => {
    const { lines } = await bundled;
    const file = 'packages/reactivity/src/graph.ts';
    const graph = perDeclaration(lines.get(file)!, file);
    const report = graph.map(([name, count]) => `${String(count).padStart(5)}  ${name}`).join('\n');
    const bytes = (name: string): number => graph.find(([n]) => n === name)?.[1] ?? 0;

    // The other half of the same question. 30.9% of the bundle is the reactive
    // core, and 2,479 B of it — three fifths of its largest module — is three
    // class bodies: a signal that is written, one that is derived, and the
    // watcher an effect hangs from. The graph algorithm they share is a
    // quarter of the file between `track`, `propagate`, `link` and the two
    // unlinks; nothing else in there is above 250 B. There is no single
    // expensive function to remove, which is the reading that matters: the
    // weight is the data structure, so cutting it means changing what a signal
    // is rather than tidying a routine.
    const total = [...lines.get(file)!.values()].reduce((a, b) => a + b, 0);
    const nodes = bytes('StateSignal') + bytes('ComputedSignal') + bytes('WatcherNode');
    expect(graph.slice(0, 3).map(([name]) => name).sort(), `\n${report}\n`).toEqual([
      'ComputedSignal',
      'StateSignal',
      'WatcherNode',
    ]);
    expect(nodes / total, `${nodes} B of ${total} B`).toBeGreaterThan(0.55);
    expect(nodes / total, `${nodes} B of ${total} B`).toBeLessThan(0.68);
  });

  it('leaves the bundle accounted for', async () => {
    const { code, bytes } = await bundled;
    const attributed = [...bytes.values()].reduce((a, b) => a + b, 0);
    // A map that stopped resolving would quietly move every byte into
    // `(module glue)` and every share above would pass by collapsing, so the
    // unattributed remainder is held down too. What is legitimately in there
    // is Vite's modulepreload polyfill and the chunk's own wrapper.
    expect(attributed).toBeGreaterThan(code.length - 200);
    expect(bytes.get('(module glue)') ?? 0).toBeLessThanOrEqual(900);
  });
});

/**
 * Whether the largest single thing in the runtime is a floor or a bill.
 *
 * The table above says `packages/core/src/` is two fifths of the bundle, and
 * the largest block inside it is keyed lists — `each`, `reconcileArrays` and
 * `createRow` together. That number only means something alongside its
 * opposite: an application with no `:for` in it must not pay for any of them,
 * and the way to know is to build one and look.
 *
 * Built with esbuild from a compiled template rather than as a second Vite
 * project, because the question is about the module graph and not about the
 * bundler — and a fixture app is a thing to maintain.
 */
describe('what an application does not use', { timeout: 120_000 }, () => {
  const root = resolve(import.meta.dirname, '../../..');

  /** An application entry whose whole template is `source`, bundled and minified. */
  async function appFor(source: string): Promise<string> {
    const { body } = compile(source, { runtime: '_rt', target: 'client' });
    const result = await esbuild({
      stdin: {
        contents:
          "import * as _rt from '@voltdev/core/runtime';\n" +
          `const render = (function () {\n${body}\n})();\n` +
          'globalThis.app = { render, mount: _rt.hydrate };',
        resolveDir: root,
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'esm',
      target: 'esnext',
      minify: true,
      alias: {
        '@voltdev/reactivity/signals': resolve(root, 'packages/reactivity/src/signals.ts'),
        '@voltdev/reactivity': resolve(root, 'packages/reactivity/src/index.ts'),
        '@voltdev/core/runtime': resolve(root, 'packages/core/src/runtime.ts'),
        '@voltdev/core': resolve(root, 'packages/core/src/index.ts'),
      },
      define: { __VOLT_DEV__: 'false', __VOLT_SERVER__: 'false' },
    });
    return result.outputFiles[0]!.text;
  }

  it('leaves the list reconciler out of an application with no list in it', async () => {
    const withList = await appFor(
      `<ul><li :for="row in rows" :key="row.id">{ row.label }</li></ul>`,
    );
    const withoutList = await appFor(`<div><h1>{ title }</h1><p>{ body }</p></div>`);

    // Asserted on the pair rather than on one of them. Local names are
    // mangled, so no string proves the reconciler is present — but the
    // difference between a bundle that reaches it and one that does not is
    // thousands of bytes, and that is not something churn produces.
    expect(withList.length - withoutList.length).toBeGreaterThan(1_500);

    // And the small one is genuinely a working application, not an empty
    // module that shrank because nothing survived: it still carries the
    // binding layer the template asks for.
    expect(withoutList.length).toBeGreaterThan(3_000);
  });
});
