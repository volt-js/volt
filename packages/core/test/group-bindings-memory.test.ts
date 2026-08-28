/**
 * What one effect per row costs against one per binding.
 *
 * `groupRowBindings` has been written, tested and off by default since it
 * landed, "while the two shapes are being measured against each other". This
 * is that measurement. The roadmap's estimate is that an effect costs roughly
 * 1.6 kB against 31 bytes for a signal and that a row typically has three, so
 * grouping should remove most of what a row allocates — but an estimate is not
 * a measurement, and a default should not be decided by one.
 *
 * The rules are `each-memory.test.ts`'s, for its reasons. Collection is forced
 * through V8's flag API. Every number is a difference between two readings
 * taken the same way, so whatever happy-dom retains per node cancels rather
 * than having to be budgeted for — which is what makes this measurable at all
 * in an environment whose DOM is JavaScript. And the smallest of several
 * samples is taken, because interference can only add bytes.
 *
 * The two variants build byte-identical DOM from one template. The only
 * difference between them is how many effects were created to do it, which is
 * exactly the quantity in question.
 */
import { describe, expect, it } from 'vitest';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { compile } from '@voltdev/compiler';
import { Signal, flushSync } from '@voltdev/core';
import type { RenderFn } from '@voltdev/core';
import { createRoot } from '@voltdev/reactivity';
import * as runtime from '@voltdev/core/runtime';

function exposeGc(): () => void {
  const already = (globalThis as { gc?: () => void }).gc;
  if (already) return already;
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  setFlagsFromString('--no-expose-gc');
  return gc;
}

const gc = exposeGc();

function settled(): number {
  let floor = Infinity;
  for (let round = 0; round < 8; round++) {
    gc();
    floor = Math.min(floor, process.memoryUsage().heapUsed);
  }
  return floor;
}

/** Three bindings a row: a class toggle, a text hole, and a nested one. */
const LIST = `<ul>
  <li :for="row in rows.get()" :key="row.id" :class="{ on: row.id === sel.get() }">
    <span>{ row.id }</span><b>{ row.label.get() }</b>
  </li>
</ul>`;

interface Row {
  id: number;
  label: Signal.State<string>;
}

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, label: new Signal.State(`row ${i}`) }));
}

function render(grouped: boolean): RenderFn {
  const { body } = compile(LIST, { runtime: '_rt', groupRowBindings: grouped });
  return (new Function('_rt', body) as (rt: unknown) => RenderFn)(runtime);
}

/** Bytes retained by a mounted list of `n` rows, over the rows themselves. */
function costOf(grouped: boolean, n: number): number {
  const fn = render(grouped);
  const data = rows(n);
  const ctx = { rows: new Signal.State(data), sel: new Signal.State(-1) };

  const host = document.createElement('div');
  document.body.append(host);

  // The rows exist before the reading, so what is measured is the machinery
  // built over them rather than the data itself.
  const before = settled();
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    runtime.insert(host, fn(ctx));
  });
  flushSync();
  const after = settled();

  // Held across the reading so nothing above can be collected before it.
  expect(host.querySelectorAll('li')).toHaveLength(n);

  dispose();
  host.remove();
  return after - before;
}

/** The smallest of several runs: interference can only add. */
function lowest(grouped: boolean, n: number, samples = 3): number {
  let floor = Infinity;
  for (let i = 0; i < samples; i++) floor = Math.min(floor, costOf(grouped, n));
  return floor;
}

describe('one effect per row against one per binding', () => {
  const ROWS = 500;

  // Three samples of two shapes at five hundred rows is three thousand row
  // constructions, each with a heap measurement around it. The default five
  // seconds was never a budget chosen for that: it holds when this file runs
  // on its own and does not when the whole workspace runs beside it, which
  // made a real gate look like a flaky one. Thirty is chosen for the work.
  it('costs measurably less per row', { timeout: 30_000 }, () => {
    const perRow = (bytes: number): number => bytes / ROWS;
    const plain = perRow(lowest(false, ROWS));
    const grouped = perRow(lowest(true, ROWS));

    // Stated as a ratio rather than an absolute, because the absolute carries
    // whatever happy-dom retains per element and that is not the framework's
    // number. What travels is the difference: about 2.3 kB a row when this was
    // written, against a roadmap estimate of an effect costing 1.6 kB and a row
    // holding three of them — the same order, arrived at by measuring.
    expect(grouped).toBeLessThan(plain);
    expect(grouped / plain).toBeLessThan(0.95);
  });

  it('builds the same DOM either way, or the comparison means nothing', () => {
    const html: string[] = [];
    for (const grouped of [false, true]) {
      const ctx = { rows: new Signal.State(rows(3)), sel: new Signal.State(1) };
      const host = document.createElement('div');
      document.body.append(host);
      createRoot(() => {
        runtime.insert(host, render(grouped)(ctx));
      });
      flushSync();
      html.push(host.innerHTML);
      host.remove();
    }
    expect(html[1]).toBe(html[0]);
  });
});
