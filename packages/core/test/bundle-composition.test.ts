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
import { transformSync } from 'esbuild';
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
 * Minified bytes per original source file.
 *
 * Two levels of map, because the application's map names the *packages'* built
 * files — `core/dist/component-*.js` — and a budget written against a content
 * hash measures nothing the first time the chunk changes. Following each
 * package's own map the rest of the way lands on `src/dom.ts`, which is a name
 * that survives a rebuild and a name somebody can act on.
 */
function attribute(code: string, map: SourceMap, dir: string): Map<string, number> {
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

  const bytes = new Map<string, number>();
  const add = (key: string, count: number): void => bytes.set(key, (bytes.get(key) ?? 0) + count);

  for (const [generatedLine, row] of top.lines.entries()) {
    // The newline is a byte of the file too, and dropping it leaves the parts
    // adding up to less than the whole for no reason a reader could guess.
    const lineLength = (codeLines[generatedLine] ?? '').length + 1;
    if (row.length === 0) {
      add('(module glue)', lineLength);
      continue;
    }
    if (row[0]!.column > 0) add('(module glue)', row[0]!.column);

    for (const [i, segment] of row.entries()) {
      const end = i + 1 < row.length ? row[i + 1]!.column : lineLength;
      const count = Math.max(0, end - segment.column);
      if (segment.source < 0) {
        add('(module glue)', count);
        continue;
      }
      const chain = chainFor(segment.source);
      if (!chain) {
        add(relative(root, resolve(dir, top.sources[segment.source] ?? '')), count);
        continue;
      }
      const inner = segmentAt(chain, segment.line, segment.sourceColumn);
      if (!inner || inner.source < 0) {
        add('(module glue)', count);
        continue;
      }
      add(relative(root, resolve(chain.dir, chain.sources[inner.source] ?? '')), count);
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

  const bytes = attribute(chunk.code, chunk.map as SourceMap, resolve(example, 'dist/assets'));
  return { code: chunk.code, bytes };
})();

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
  it('weighs 24 kB minified and 8.7 kB gzipped', async () => {
    const { code } = await bundled;
    const gzipped = gzipSync(code, { level: 9 }).length;
    expect(code.length, 'minified').toBeGreaterThan(22_000);
    expect(code.length, 'minified').toBeLessThanOrEqual(25_500);
    expect(gzipped, 'gzipped').toBeGreaterThan(8_000);
    expect(gzipped, 'gzipped').toBeLessThanOrEqual(9_500);
  });

  it('spends two fifths on the component and DOM runtime and three tenths on reactivity', async () => {
    const { code, bytes } = await bundled;
    const report = [...bytes]
      .sort((a, b) => b[1] - a[1])
      .map(([file, count]) => `${String(count).padStart(6)}  ${file}`)
      .join('\n');
    const layer = (prefix: string): number => share(bytes, [prefix]) / code.length;

    // 9,649 B of 23,936: 40.3%, which is the roadmap's "41%" confirmed by a
    // method somebody can rerun rather than by memory.
    expect(layer('packages/core/src/'), `\n${report}\n`).toBeGreaterThan(0.37);
    expect(layer('packages/core/src/'), `\n${report}\n`).toBeLessThan(0.43);

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
