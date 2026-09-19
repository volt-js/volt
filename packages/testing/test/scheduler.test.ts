/**
 * The two things the package asks the scheduler for: let it settle, and say
 * what it is still holding.
 *
 * `liveEffectCount` finds the scheduler's watchers by introspection rather
 * than by an exported count, so it is worth testing on its own — a change to
 * how `@voltdev/reactivity` links effects would otherwise show up as a leak
 * test that quietly always passes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  Signal,
  createRoot,
  dataEffect,
  effect,
  flushSync,
  measureEffect,
  renderEffect,
} from '@voltdev/core';
import { liveEffectCount, settle } from '../src/scheduler.ts';

const disposers: (() => void)[] = [];

const track = (dispose: () => void): (() => void) => {
  disposers.push(dispose);
  return dispose;
};

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  flushSync();
});

describe('settle', () => {
  it('runs deferred effects without an explicit flush', async () => {
    const n = new Signal.State(0);
    const seen: number[] = [];
    track(effect(() => void seen.push(n.get())));

    await settle();
    expect(seen).toEqual([0]);

    n.set(1);
    await settle();
    expect(seen).toEqual([0, 1]);
  });

  it('gets through a chain of awaits, which one microtask would not', async () => {
    const value = new Signal.State('idle');
    const seen: string[] = [];
    track(effect(() => void seen.push(value.get())));

    void (async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      value.set('done');
    })();

    await settle();

    // The write path for anything asynchronous is `await` → signal write →
    // effect flush, and a resource with a retry adds a turn for each link.
    expect(seen).toEqual(['idle', 'done']);
  });
});

describe('live effect count', () => {
  it('counts every lane', () => {
    const before = liveEffectCount();
    const n = new Signal.State(0);

    const stopRender = renderEffect(() => void n.get());
    expect(liveEffectCount()).toBe(before + 1);

    const stopUser = effect(() => void n.get());
    // Counted from creation, before its first deferred run: an effect that has
    // never run is still watched, and is still a leak if nothing disposes it.
    expect(liveEffectCount()).toBe(before + 2);

    // The two lanes a leak is easiest to miss in: a resource fetches from the
    // data lane, and everything that measures the page reads from the measure
    // lane, so a count blind to either reports a leaked fetch as clean.
    const stopData = dataEffect(() => void n.get());
    expect(liveEffectCount()).toBe(before + 3);

    const stopMeasure = measureEffect(() => void n.get());
    expect(liveEffectCount()).toBe(before + 4);

    flushSync();
    expect(liveEffectCount()).toBe(before + 4);

    stopMeasure();
    stopData();
    stopUser();
    stopRender();
    expect(liveEffectCount()).toBe(before);
  });

  it('drops to the baseline when a scope is disposed', () => {
    const before = liveEffectCount();
    const n = new Signal.State(0);

    const dispose = createRoot((disposeRoot) => {
      effect(() => void n.get());
      renderEffect(() => {
        // Nested inside another effect, so disposal has to walk the scope tree.
        effect(() => void n.get());
      });
      return disposeRoot;
    }, null);

    flushSync();
    expect(liveEffectCount()).toBe(before + 3);

    dispose();
    expect(liveEffectCount()).toBe(before);
  });

  it('is not disturbed by the effects it creates to find the watchers', () => {
    // The first call builds a throwaway effect of each kind to ask what is
    // watching it. If either escaped, every leak assertion in the suite would
    // be off by one from then on.
    const first = liveEffectCount();
    expect(liveEffectCount()).toBe(first);
    expect(liveEffectCount()).toBe(first);
  });
});
