/**
 * What `:for`'s reused buffers cost in bytes.
 *
 * `each-buffers.test.ts` covers what reuse does to the DOM, which is what an
 * assertion can see. Three of the claims the reuse rests on have no DOM
 * consequence at all — a buffer that is never handed back, a spent slot that
 * goes on naming a disposed row, and the per-pass garbage the whole design
 * exists to remove. All three are invisible until a long-running page runs
 * out of memory, so this file measures rather than asserts on markup.
 *
 * Measuring a heap honestly takes three rules. Collection is forced through
 * V8's flag API, because `gc()` is not on the test global. Every claim is a
 * difference between two readings taken the same way, so whatever the
 * environment retains per node cancels instead of having to be budgeted for.
 * And allocation per pass is the smallest of several samples: interference can
 * only add bytes, so the smallest sample is the one nearest the truth and the
 * assertion over it is an upper bound. Bytes are a property of the code rather
 * than of the machine, so unlike a time budget these numbers travel.
 *
 * `each` is driven directly rather than through a mounted component, so the
 * numbers are the reconciler's own and not happy-dom's.
 */
import { describe, expect, it } from 'vitest';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { Signal, createRoot, flushSync } from '@voltdev/core';
import { each, type Accessor } from '../src/dom.js';

/** V8 hands `gc()` over on request; the test global does not have it. */
function exposeGc(): () => void {
  const already = (globalThis as { gc?: () => void }).gc;
  if (already) return already;

  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  // Put the flag back: it is process-wide, and nothing else here wants it.
  setFlagsFromString('--no-expose-gc');
  return gc;
}

const gc = exposeGc();

/**
 * Heap in use once collection has stopped finding anything to take.
 *
 * The floor across the rounds rather than the reading after the last one: a
 * round can leave more behind than the one before it, and every claim below is
 * a difference between two of these, so a noisy reading is a noisy answer. A
 * floor can only be reached by collection actually happening, so nothing a
 * later assertion asks for is made easier by taking one.
 */
function settled(): number {
  let floor = Infinity;
  for (let round = 0; round < 8; round++) {
    gc();
    floor = Math.min(floor, process.memoryUsage().heapUsed);
  }
  return floor;
}

const labels = (n: number, prefix = 'r'): string[] =>
  Array.from({ length: n }, (_, i) => prefix + i);

interface Reconciler {
  /** The node buffer as the reconciler last left it. */
  nodes: Accessor<Node[]>;
  /** Reconcile against `next` and let the effect settle. */
  set: (next: string[]) => void;
}

function reconciler(initial: string[]): Reconciler {
  const source = new Signal.State<string[]>(initial);
  let nodes!: Accessor<Node[]>;

  createRoot(() => {
    nodes = each(
      () => source.get(),
      (item) => document.createTextNode(String(item())),
      (label) => label,
    );
  });
  flushSync();

  return {
    nodes: () => nodes(),
    set(next: string[]) {
      source.set(next);
      flushSync();
    },
  };
}

describe('a list that spikes and settles', () => {
  it('hands the spent buffers back on the pass that shrinks', () => {
    const SPIKE = 50_000;
    const list = reconciler(labels(50));

    list.set(labels(SPIKE));
    list.set(labels(50));
    const shrunk = settled();

    // A list that settles is not reconciled again, so anything a later pass
    // would have released is held for as long as the list is on screen. This
    // pass changes nothing, and so must find nothing left to hand back — the
    // two spent buffers are 50,000 slots, 800 kB, between them.
    list.set(labels(50));
    const oneMorePass = settled();

    expect(list.nodes()).toHaveLength(50);
    expect(shrunk - oneMorePass).toBeLessThan(128 * 1024);
  });

  it('lets go of a disposed row as the buffers swap', async () => {
    const list = reconciler(['a', 'b', 'c']);
    const dropped = list.nodes().map((node) => new WeakRef(node));

    list.set(['x', 'y', 'z']);
    expect(list.nodes()).toHaveLength(3);

    // A `WeakRef`'s target survives the job that touched it, so the collection
    // that would take these has to happen in a later one — and V8 promises
    // nothing about which later one, so this asks again rather than deciding
    // on the strength of a single round. What is retained is retained however
    // many times it is asked; only the timing is being waited out.
    for (let round = 0; round < 20 && dropped.some((ref) => ref.deref()); round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      gc();
    }

    expect(dropped.map((ref) => ref.deref())).toEqual([undefined, undefined, undefined]);
  });
});

// Ten thousand rows reconciled nine times, with eight full collections before
// each of the five measured passes: seconds of work by design, which vitest's
// default of five cuts off whenever the machine is busy with anything else.
describe('what a no-op reconcile allocates', { timeout: 30_000 }, () => {
  it('stays inside the budget the buffer reuse bought', () => {
    const N = 10_000;
    const items = labels(N);
    // Two equal arrays alternated, so the pass is a genuine no-op — every key
    // is found and every row reused — without the harness allocating one.
    const same = items.slice();

    const list = reconciler(items);
    for (let warmup = 0; warmup < 4; warmup++) list.set(warmup % 2 === 0 ? same : items);

    const samples: number[] = [];
    for (let sample = 0; sample < 5; sample++) {
      const before = settled();
      list.set(sample % 2 === 0 ? same : items);
      samples.push(process.memoryUsage().heapUsed - before);
    }

    expect(list.nodes()).toHaveLength(N);

    // Measured at 92 B per row, nearly all of it the `available` map, which is
    // still built from scratch every pass. The budget is set where any one of
    // the removals coming back fails it on its own: bringing the `reused` Set
    // back measures 159 B per row, and a fresh keys/rows/nodes array per pass
    // was ~94 B of the ~323 B per row this cost before the buffers were
    // hoisted.
    expect(Math.min(...samples) / N).toBeLessThan(130);
  });
});
