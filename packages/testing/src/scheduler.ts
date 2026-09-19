/**
 * Two things every Volt test needs from the scheduler: a way to let it settle,
 * and a way to ask what it is still holding.
 *
 * Volt coalesces updates onto a microtask, so nothing a test does is visible
 * until the queues drain. `flushSync()` is enough when the work is
 * synchronous; `settle()` is for the rest, where a promise has to resolve
 * before the writes it causes can be flushed at all.
 *
 * `liveEffectCount()` is the other half. An unmount that leaves an effect
 * behind is invisible in the DOM — the elements are gone, the effect is still
 * subscribed — and it is the failure mode this whole package exists to make
 * assertable.
 */

import {
  Signal,
  dataEffect,
  effect,
  flushSync,
  measureEffect,
  renderEffect,
} from '@voltdev/core';

/**
 * How many times to hand control back before giving up on things settling.
 *
 * The write path for asynchronous work is `await` → signal writes → effect
 * flush, and each link in a chain — a resource's fetcher resolving, then its
 * `then`, then a retry's backoff — costs another turn. Eight covers the
 * chains this library builds; work that needs a timer needs the clock
 * advanced instead, which no number of turns can substitute for.
 */
const SETTLE_TURNS = 8;

/**
 * Let pending promises resolve and pending effects run.
 *
 * Deliberately microtask-driven rather than timer-driven, so it still works
 * with a fake clock installed — see `clock.ts` for why faking the microtask
 * queue is the one thing that must never happen.
 */
export async function settle(): Promise<void> {
  for (let i = 0; i < SETTLE_TURNS; i++) {
    await Promise.resolve();
    flushSync();
  }
}

type SchedulerWatcher = Signal.subtle.Watcher;

let watchers: SchedulerWatcher[] | null = null;

/**
 * The watchers the scheduler runs effects through, found by asking an effect
 * what is watching it.
 *
 * `@voltdev/reactivity` keeps its watchers module-private — one per lane:
 * render, data, measure and user — and exports no count of what is live, which
 * is the single number a leak test needs. Rather than widen that API for tests
 * alone, a throwaway effect of each kind reports its own lane: an effect is a
 * computed whose only sink is the watcher that queues it, and `Signal.subtle`
 * already exposes an edge walk. A lane with no probe here is a lane whose
 * leaks read as zero, so every kind of effect the package exports has one.
 */
function schedulerWatchers(): SchedulerWatcher[] {
  if (watchers) return watchers;

  const found: SchedulerWatcher[] = [];
  const report = (): void => {
    const node = Signal.subtle.currentComputed();
    if (!node) return;
    for (const sink of Signal.subtle.introspectSinks(node)) {
      if (sink instanceof Signal.subtle.Watcher && !found.includes(sink)) found.push(sink);
    }
  };

  const probes = [renderEffect(report), dataEffect(report), measureEffect(report), effect(report)];
  // Every lane but render defers its first run, so without a flush only the
  // render watcher would ever be found — and the effects a leak usually is are
  // the deferred ones.
  flushSync();
  for (const stop of probes) stop();

  watchers = found;
  return found;
}

/**
 * How many effects the scheduler is still watching, across every lane.
 *
 * Take it before mounting and compare after unmounting: equal means the
 * component released everything it created. It counts every effect in the
 * process, not only the ones a given test made, so compare against a baseline
 * rather than against zero.
 */
export function liveEffectCount(): number {
  let count = 0;
  for (const watcher of schedulerWatchers()) {
    count += Signal.subtle.introspectSources(watcher).length;
  }
  return count;
}
