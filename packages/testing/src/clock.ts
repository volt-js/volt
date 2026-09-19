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
   *
   * An interval is never done, so it cannot be run to the end: it runs each
   * time it falls due while anything else is pending, and is left set once
   * nothing but intervals remains.
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
  /** Set for `requestAnimationFrame`, so a runaway loop can be named. */
  frame: boolean;
  run: () => void;
}

/**
 * A callback that schedules another every time it runs is a loop the clock
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
    Date: globalThis.Date,
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

  /**
   * `performance.now()` on the fake clock — and the time a frame is handed,
   * which a browser measures from the same origin, so an animation comparing
   * the two sees them agree.
   */
  const performanceNow = (): number => performanceStart + (current - start);

  const timers = new Map<number, Timer>();
  let nextId = 1;

  const schedule = (
    run: () => void,
    delay: unknown,
    period: number | null,
    frame = false,
  ): number => {
    const ms = Math.max(0, Number(delay) || 0);
    const id = nextId++;
    timers.set(id, { id, due: current + ms, period, frame, run });
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
   * `oneShot` leaves the intervals out, for asking what is left that can finish.
   */
  const earliest = (limit: number, oneShot = false): Timer | null => {
    let best: Timer | null = null;
    for (const timer of timers.values()) {
      if (timer.due > limit || (oneShot && timer.period !== null)) continue;
      if (!best || timer.due < best.due || (timer.due === best.due && timer.id < best.id)) {
        best = timer;
      }
    }
    return best;
  };

  /**
   * The error for a drain that ran out of steps, naming what kept it going.
   *
   * A loop at no delay holds time still; an animation loop, an interval or a
   * poll built from timeouts lets time pass and simply never stops. The two
   * want different fixes, and a message that calls a one-second interval
   * "faster than time" sends the reader looking for the wrong one.
   *
   * A one-shot that was pending before the drain began, and is still waiting,
   * is no loop at all: nothing set it again, and the steps went to an interval
   * falling due on the way to it — a poll every 16 ms beside a timeout half an
   * hour off. The blame goes to the interval that falls due most often.
   */
  const runaway = (timer: Timer, limit: number, firstId: number): Error => {
    if (timer.due === current) {
      return new Error(
        `[volt] The fake clock ran ${MAX_STEPS} timers without emptying — something is ` +
          'rescheduling itself at no delay, so time never moves on.',
      );
    }
    let blamed = timer;
    if (timer.period === null && timer.id < firstId) {
      for (const other of timers.values()) {
        if (other.period === null) continue;
        if (blamed.period === null || other.period < blamed.period) blamed = other;
      }
    }
    if (blamed !== timer && limit === Number.POSITIVE_INFINITY) {
      return new Error(
        `[volt] The fake clock ran ${MAX_STEPS} timers without emptying — an interval every ` +
          `${blamed.period} ms fell due that many times on the way to a timer set before ` +
          `runAll() began, still ${timer.due - current} ms off. That timer is not a loop, only ` +
          'far away: advance(ms) to it in steps.',
      );
    }
    const loop = blamed.frame
      ? 'an animation frame keeps requesting the next one'
      : blamed.period === null
        ? 'a timer keeps setting another from its own callback'
        : `an interval every ${blamed.period} ms is still running`;
    return new Error(
      `[volt] The fake clock ran ${MAX_STEPS} timers without emptying — ${loop}, ` +
        (limit === Number.POSITIVE_INFINITY
          ? 'so there is always one more to run. advance(ms) runs a loop like that only as ' +
            'far as the time it is given.'
          : 'and the time advanced over holds more turns of it than that. Advance in ' +
            'smaller steps.'),
    );
  };

  const drain = async (limit: number, leaveIntervals = false): Promise<void> => {
    // Every timer with an id from here on was set by something this drain ran.
    const firstId = nextId;
    for (let step = 0; ; step++) {
      const timer = earliest(limit);
      // What can still finish. A drain that leaves intervals set ends when
      // nothing but intervals is left, so an interval never keeps it going on
      // its own. It can still use the steps up on the way to a timer far off,
      // which `runaway` tells apart from a loop.
      const unfinished = leaveIntervals ? earliest(limit, true) : timer;
      if (!timer || !unfinished) return;

      if (step >= MAX_STEPS) throw runaway(unfinished, limit, firstId);

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
      // Until nothing but intervals is left, because an interval never is: a
      // component with a clock ticking or a poll running would otherwise have
      // no end state at all, and every `runAll()` near one would throw.
      await drain(Number.POSITIVE_INFINITY, true);
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
      view.Date = real.Date;
      real.Date.prototype.constructor = real.Date;
      real.Date.now = real.dateNow;
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

  // `new Date()` and `Date()` read the clock as well, and code that takes the
  // current date that way is as common as code that calls `Date.now()`. Every
  // other form of the constructor — a time, a string, a set of parts — goes
  // straight through, and what comes back is a real `Date`. The fake answers
  // to the real one's name and arity, and is what a date names as its
  // `constructor` while it is installed, so code that asks what made a value
  // gets `Date`.
  //
  // What it cannot reach is `new` on the real constructor: a subclass declared
  // before the install, or a reference to `Date` held from before, constructs
  // on real time. `now` is replaced on the real constructor, which the fake
  // inherits its statics from, so `now()` on either still reads the clock.
  function FakeDate(...args: unknown[]): Date | string {
    if (new.target === undefined) return new real.Date(current).toString();
    return Reflect.construct(real.Date, args.length === 0 ? [current] : args, new.target) as Date;
  }
  Object.defineProperties(FakeDate, { name: { value: 'Date' }, length: { value: 7 } });
  FakeDate.prototype = real.Date.prototype;
  Object.setPrototypeOf(FakeDate, real.Date);
  view.Date = FakeDate;
  real.Date.prototype.constructor = FakeDate as unknown as DateConstructor;
  real.Date.now = () => current;
  performance.now = performanceNow;

  view.requestAnimationFrame = (fn: FrameRequestCallback) =>
    schedule(() => fn(performanceNow()), FRAME_MS, null, true);
  view.cancelAnimationFrame = cancel;

  // Deliberately absent: queueMicrotask, Promise, process.nextTick. See the
  // note at the top of this file — faking any of them stops Volt's scheduler
  // dead, and silently.

  installed = clock;
  return clock;
}
