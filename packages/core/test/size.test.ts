/**
 * Bundle size is a benchmark, so it gets a test.
 *
 * These are ceilings on the built packages, not targets. They exist so a
 * change that quietly adds a kilobyte has to justify itself by moving the
 * number in this file.
 */
import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { transformSync } from 'esbuild';

const root = resolve(import.meta.dirname, '../../..');

/**
 * The built file a budget names, or null when the package is not built.
 *
 * A `*` stands for the content hash rollup gives a shared chunk, which changes
 * with every edit to the chunk. Naming one exactly would mean the budget stops
 * matching anything the first time the code inside it moves — which is a
 * budget that silently measures nothing, the thing this file exists to catch.
 */
function fileFor(pattern: string): string | null {
  const full = resolve(root, pattern);
  if (!pattern.includes('*')) return existsSync(full) ? full : null;
  const directory = dirname(full);
  if (!existsSync(directory)) return null;
  const [head, tail] = basename(full).split('*');
  const hit = readdirSync(directory).find(
    (name) => name.startsWith(head!) && name.endsWith(tail!),
  );
  return hit ? resolve(directory, hit) : null;
}

/**
 * Minified, gzipped size in bytes.
 *
 * The published bundles are deliberately unminified, so an app's bundler can
 * minify them in context. Measuring them as-is therefore measured the
 * comments: explaining why a loop is written a certain way cost more
 * "bundle size" than the loop, which is precisely the wrong incentive.
 */
function measured(file: string): number {
  const source = readFileSync(file, 'utf8');
  const minified = transformSync(source, { loader: 'js', minify: true, target: 'esnext' }).code;
  return gzipSync(minified, { level: 9 }).length;
}

/**
 * Ceilings, set just above the measured size at the time of writing. They are
 * ratchets: a change that adds weight has to move the number here and say why.
 * The compiler is excluded — it runs at build time and never ships.
 */
const BUDGETS: Record<string, number> = {
  // Raised from 3000 by the request scope and the data lane: a server keeps
  // one render's queues, styles, ids and locale apart from another's, and the
  // published bundle carries that with the defines still open, so the guarded
  // server paths are measured here even though an application's own build
  // removes them. 122 B of the raise is the devtools seam, which is here for
  // the same reason: the graph and the scheduler are the only places that know
  // which write woke which effect and what a flush cost. Measured by building
  // the package twice, once with the `devListener` call sites, the `explain`
  // argument to `reportError` and the `setDevListener` re-export taken out.
  // Raised again from 3350, by 99 B measured the same way, for the bound on
  // `settleRequest`'s loop and the sentence it throws: unbounded, a tree that
  // asks for one more fetch every time the last answer lands is a request that
  // never answers and a message nobody gets.
  // Raised again from 3450, by 313 B measured by bundling the package with and
  // without it, for the error channel: the boundary registry, the walk up the
  // scope chain, and the report the global hook is handed. What it replaces
  // was a single `console.error`, and the difference it buys is between a
  // message nobody reads in production and a report naming the component that
  // failed.
  'packages/reactivity/dist/index.js': 3_750,
  // The rest of that seam: `wake` and `write` are called from the propagation
  // code, which ships as its own chunk. 60 B of this is the seam, by the same
  // measurement, and the chunk is budgeted at all because bytes moved out of
  // `index.js` into a file nothing measures have not moved anywhere.
  'packages/reactivity/dist/graph-*.js': 1_700,
  // The `Signal` namespace, which ships as its own chunk so that an app whose
  // build lowered it away can drop the whole file. Budgeted separately for the
  // same reason it was split out: bytes that leave `index.js` for a file
  // nothing measures have not left anything.
  'packages/reactivity/dist/namespace.js': 300,
  // Raised from 750 when lazy/preload moved to the runtime entry, which is
  // where generated code reaches them now that splitting is the build's
  // decision rather than something an application writes.
  //
  // Raised again from 800 by the hydration walk — `hClaim`, `hClose`,
  // `hInsert`, `hydrate` and `onHydrationMismatch` — which is 85 B measured by
  // building the package with and without them. What it buys is a page the
  // server printed being adopted rather than rebuilt: the claim, the range a
  // hole owns seeded as what is already on screen, and one name comparison per
  // block so a disagreement costs that block instead of the document. An
  // application that never server-renders pays it only until its bundler
  // shakes them out, since nothing in a client emit calls any of them — which
  // is the whole reason hydration is a third compile target and not a flag
  // read at every instantiation.
  //
  // Raised again from 850 by `:model` becoming one entry point per control —
  // `modelText`, `modelCheckbox`, `modelRadio`, `modelSelect` — where there
  // was one function switching on a `kind` string. 53 B measured by building
  // the package with and without the split, 827 B to 880 B. This file weighs
  // the whole runtime, which now carries four bodies and the shared read
  // instead of one body, so it is the one place the split can only look like
  // a loss. What it buys is paid to an application rather than to this
  // number: the compiler already knows which control it is looking at, so a
  // page that binds a text input no longer drags the checkbox, radio and
  // select paths in behind it, and a runtime switch no longer re-decides per
  // instantiation what the build settled.
  //
  // Raised again from 900 by the drain — `drainStream` and the relocations
  // behind it — which is 22 B measured by building the package with and
  // without the block, 880 B to 902 B. It is the client half of streaming:
  // without it a streamed page arrives in pieces and stays in pieces, since
  // the `<template>`s a stream writes are inert and the records saying where
  // they belong are pushed into an array nothing reads. A page that never
  // boots a streamed response drops the name with the rest of the hydration
  // entries, because nothing in a compiled template calls any of them.
  'packages/core/dist/runtime.js': 925,
  // Raised from 400 when ids moved here from @voltdev/primitives, which is
  // where they have to be minted: an id is now a component's position in the
  // tree rather than a number from a counter, and only the component runtime
  // knows the position.
  //
  // Raised again from 550 by the error channel's three public names —
  // `errorBoundary`, `onError` and `setErrorReporter`. This entry is a
  // re-export barrel, so what it weighs is names rather than code; the channel
  // itself is measured against the reactivity budget above. 21 B for somewhere
  // for a thrown error to go is the cheapest line in this table.
  //
  // Raised again from 600 by `hydratable`, `wasHydrated` and `STATE_ATTRIBUTE`,
  // which is 61 B measured by building the package with and without the
  // re-export — 572 B to 633 B. What that buys is the second half of
  // hydration: the delimiters carry the shape of a render across and these
  // carry its values, so a page arrives holding the data the server fetched
  // instead of fetching it again over the connection the user is waiting on.
  // An application that never declares hydratable state drops the names and
  // the chunk below with them — building without the re-export emits no
  // `state-*.js` at all — because nothing in a client emit reaches them
  // unless that application wrote the call itself.
  'packages/core/dist/index.js': 675,
  // The state a server render hands to the page that hydrates it. Its own
  // chunk because both entries import it — the index for the browser and the
  // server entry for `renderToString` — and it is budgeted for the reason the
  // reactivity graph chunk is: bytes that leave a measured file for one
  // nothing weighs have not left anything. 694 B at the time of writing, and
  // most of what is in there is the refusals and the two guarded halves — the
  // registry a server build keeps and the payload a client build reads — since
  // the published bundle carries both with the defines still open. A key
  // claimed twice and a payload that did not parse are failures whose only
  // other symptom is server rendering having quietly stopped paying for
  // itself, which is what makes them worth their bytes.
  'packages/core/dist/state-*.js': 750,
  // What a server build resolves, and nothing a browser ever does:
  // `@voltdev/core/server` is the module generated server templates are
  // compiled against, plus the three consumers of the writer. It is budgeted
  // now because streaming made it worth weighing — and because the entry
  // stopped being one file when it did. `server.ts` and `stream.ts` reference
  // each other (the writer meets a boundary; the boundary needs a writer), so
  // the bundle hoists both into a shared chunk and leaves the entry a
  // re-export barrel. Bytes that move from a measured file into one nothing
  // weighs have not moved anywhere, which is why both are named.
  //
  // 333 B and 4232 B at the time of writing, against 2616 B for the single
  // `server.js` before streaming: 1949 B for the boundary machinery, the wake
  // channel the tail waits on, the `__VOLT__` records, the per-chunk styles
  // and the epilogue. Measured by building the package with and without
  // `stream.ts` and its re-export. It is the largest single raise in this
  // table and it is paid only by a server: the client entry, the runtime and
  // the state chunk are all unchanged by it, which is the point of the entry
  // being separate at all.
  'packages/core/dist/server.js': 400,
  // Raised from 4400 by making the streamed and buffered failure paths one
  // mechanism rather than two: an error raised anywhere under a boundary now
  // reaches the same fallback whether the headers have gone or not. Measured
  // at 4588 B gzipped.
  'packages/core/dist/server-*.js': 4_600,
  // The tools themselves. A production build drops the whole file — that is
  // asserted on bundled bytes in `devtools.test.ts` — so this is a ceiling on
  // what a development build carries, and it is here so that growing it is a
  // decision rather than a side effect.
  //
  // Raised from 2850 by write history and `travelTo`, which is 124 B and the
  // decision this comment asks for: stepping back through what was written is
  // the one thing in here a panel cannot reconstruct from the outside, since
  // the value a signal held before is gone the moment it is overwritten.
  // Nothing is kept unless a session asks for it, so the cost to a
  // development build that never opens the panel is the code alone.
  // Raised from 2975 by `nodesWrittenBy`, which records the nodes an effect
  // wrote so a panel can show the DOM a binding is responsible for. Measured
  // at 3313 B gzipped. A production build drops this file whole, which
  // `devtools.test.ts` asserts on bundled bytes, so this is a ceiling on what
  // a development build carries.
  'packages/core/dist/devtools.js': 3_350,
};

describe('bundle budgets', () => {
  for (const [file, budget] of Object.entries(BUDGETS)) {
    // Skipped rather than passed when `pnpm build` has not run. A budget that
    // reports green having weighed nothing is worse than one that reports
    // nothing, because only the second is visible in the run.
    it.skipIf(fileFor(file) === null)(`${file} stays under ${budget} B gzipped`, () => {
      const size = measured(fileFor(file)!);
      expect(size, `${file} is ${size} B gzipped`).toBeLessThanOrEqual(budget);
    });
  }
});
