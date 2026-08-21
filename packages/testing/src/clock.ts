/**
 * A fake clock that leaves the microtask queue alone.
 *
 * This is the one piece of the package that exists because of a bug rather
 * than for convenience. Volt coalesces every update onto `queueMicrotask`, so
 * a fake-timer implementation that replaces the microtask queue — which is
 * what "fake all timers" means in most libraries — takes the scheduler's flush
 * away with it. Nothing throws. `await tick()` never resolves, an effect
 * nobody flushed by hand never runs, and the test fails on an assertion about
 * rendering while the cause is three layers away. It cost an afternoon while
 * `createResource`'s debounce was being tested, and the fix at the time was a
 * list of primitives to fake, written out by hand at every call site that
 * wanted a clock and silently wrong at the first one that forgot.
 *
 * So this clock fakes exactly the wall clock and the task timers, and the
 * guarantee that it never touches `queueMicrotask`, `Promise` or
 * `process.nextTick` is a property of the implementation rather than an
 * argument the caller passes:
 *
 *   const clock = installClock();
 *   view.instance.query.set('cat');
 *   await clock.advance(200);          // effects flushed, DOM settled
 *   clock.uninstall();
 *
 * `advance` cooperates with the scheduler rather than merely coexisting with
 * it: effects are flushed after every timer callback, the way a browser
 * reaches a microtask checkpoint at the end of every task. A component that
 * schedules a second timer from the first therefore sees a settled tree in
 * between, exactly as it would in a browser.
 */

import { settle } from './scheduler.js';

export interface FakeClock {
  /**
   * Run every timer due in the next `ms`, in time order, flushing effects
   * after each. Timers scheduled by those callbacks run too if they fall
   * inside the window.
   */
  advance(ms: number): Promise<void>;

  /**
   * Run every pending timer whatever its delay, and anything they schedule.
   * For a test that wants the settled end state rather than a moment in it.
   */
  runAll(): Promise<void>;

  /** The current fake time, as `Date.now()` reports it. */
  now(): number;

  /**
   * How many timers are outstanding.
   *
   * A component that never clears a timeout shows up here after unmount, the
   * way a component that never disposes an effect shows up in
   * `leakedEffects()`.
   */
  pending(): number;

  /** Put the real timers back. */
  uninstall(): void;
}

interface Timer {
  id: number;
  due: number;
  /** Milliseconds between repeats, or null for a one-shot. */
  period: number | null;
  run: () => void;
}

/**
 * A timer callback that schedules another at zero delay is a loop the clock
 * cannot see the end of, and a hung test says far less than a thrown one.
 */
const MAX_STEPS = 100_000;

/** What a browser calls a frame, for `requestAnimationFrame`. */
const FRAME_MS = 16;

let installed: FakeClock | null = null;

export interface ClockOptions {
  /**
   * Where the clock starts, as an epoch millisecond value. Defaults to the
   * real time at install, so anything formatting a date still produces
   * something plausible; pin it when the output is asserted on.
   */
  now?: number;
}

export function installClock(options: ClockOptions = {}): FakeClock {
  if (installed) {
    throw new Error(
      '[volt] A fake clock is already installed. Call uninstall() on it first — ' +
        'two clocks would each hold half the pending timers.',
    );
  }

  const view = globalThis as unknown as Record<string, unknown>;
  const real = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    dateNow: Date.now,
    performanceNow: performance.now,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };

  const start = options.now ?? real.dateNow();
  // Rounded, so that differences are exact. `performance.now()` returns a
  // float with fractional bits; adding a whole number of milliseconds to it
  // and subtracting the origin again loses precision, and an advance of 250
  // reads back as 249.99999999999994. A whole-number origin keeps integer
  // advances exact, and the absolute value is arbitrary anyway.
  const performanceStart = Math.round(real.performanceNow.call(performance));
  let current = start;

  const timers = new Map<number, Timer>();
  let nextId = 1;

  const schedule = (run: () => void, delay: unknown, period: number | null): number => {
    const ms = Math.max(0, Number(delay) || 0);
    const id = nextId++;
    timers.set(id, { id, due: current + ms, period, run });
    return id;
  };

  const cancel = (id: unknown): void => {
    timers.delete(Number(id));
  };

  /**
   * The next timer to run, or null.
   *
   * A linear scan rather than a heap: a test has a handful of timers pending,
   * and a heap would be more code to be wrong in for no measurable gain. Ties
   * go to the timer scheduled first, which is the order a browser runs them.
   */
  const earliest = (limit: number): Timer | null => {
    let best: Timer | null = null;
    for (const timer of timers.values()) {
      if (timer.due > limit) continue;
      if (!best || timer.due < best.due || (timer.due === best.due && timer.id < best.id)) {
        best = timer;
      }
    }
    return best;
  };

  const drain = async (limit: number): Promise<void> => {
    for (let step = 0; ; step++) {
      const timer = earliest(limit);
      if (!timer) return;

      if (step >= MAX_STEPS) {
        throw new Error(
          `[volt] The fake clock ran ${MAX_STEPS} timers without emptying — ` +
            'something is rescheduling itself faster than time is passing.',
        );
      }

      current = timer.due;
      if (timer.period === null) timers.delete(timer.id);
      else timer.due = current + Math.max(1, timer.period);

      timer.run();
      // The microtask checkpoint a browser reaches at the end of every task.
      // Without it a timer that resolves a promise would leave the work that
      // promise unblocks for whenever the test next awaited something.
      await settle();
    }
  };

  const clock: FakeClock = {
    async advance(ms: number): Promise<void> {
      const target = current + Math.max(0, ms);
      await drain(target);
      // Land on the requested time even when the last timer fired before it,
      // so two advances of 100 are the same as one of 200.
      current = target;
      await settle();
    },

    async runAll(): Promise<void> {
      await drain(Number.POSITIVE_INFINITY);
      await settle();
    },

    now: () => current,
    pending: () => timers.size,

    uninstall(): void {
      if (installed !== clock) return;
      view.setTimeout = real.setTimeout;
      view.clearTimeout = real.clearTimeout;
      view.setInterval = real.setInterval;
      view.clearInterval = real.clearInterval;
      Date.now = real.dateNow;
      performance.now = real.performanceNow;
      view.requestAnimationFrame = real.requestAnimationFrame;
      view.cancelAnimationFrame = real.cancelAnimationFrame;
      timers.clear();
      installed = null;
    },
  };

  // Assigned onto the global rather than onto `window`: the two are the same
  // object in every environment Volt runs a test in, and code under test
  // resolves `setTimeout` at the call, so nothing that captured it earlier
  // matters.
  view.setTimeout = (fn: () => void, delay?: unknown, ...args: unknown[]) =>
    schedule(() => fn(...(args as [])), delay, null);
  view.clearTimeout = cancel;
  view.setInterval = (fn: () => void, delay?: unknown, ...args: unknown[]) =>
    schedule(() => fn(...(args as [])), delay, Math.max(0, Number(delay) || 0));
  view.clearInterval = cancel;

  Date.now = () => current;
  performance.now = () => performanceStart + (current - start);

  view.requestAnimationFrame = (fn: FrameRequestCallback) =>
    schedule(() => fn(current - start), FRAME_MS, null);
  view.cancelAnimationFrame = cancel;

  // Deliberately absent: queueMicrotask, Promise, process.nextTick. See the
  // note at the top of this file — faking any of them stops Volt's scheduler
  // dead, and silently.

  installed = clock;
  return clock;
}
