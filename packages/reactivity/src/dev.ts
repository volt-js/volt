/**
 * The seam the developer tools attach to.
 *
 * Causality lives here and nowhere else: only the graph knows which write
 * coloured which effect, and only the scheduler knows what a flush cost. The
 * tools that read that are a `@voltdev/core` concern, so this file holds a
 * listener slot and no policy — no buffers, no timers, no formatting.
 *
 * Every call site sits inside `if (__VOLT_DEV__)`, so a production build drops
 * the calls, then this module with them, and the listener is never installed
 * because the code that installs it is gone too. `packages/core/test/
 * devtools.test.ts` asserts that on built bytes.
 */

export type EffectPhase = 'render' | 'data' | 'measure' | 'user';

export interface DevListener {
  /**
   * A `Signal.State` changed. Called after the equality check and before the
   * write propagates, so every `wake` that follows belongs to this write —
   * the two are a pair, and that implicit ordering is what lets `wake` take
   * one argument instead of repeating the write for each effect it reaches.
   */
  write(signal: object, previous: unknown, value: unknown): void;

  /** The write currently propagating reached `effect` and will re-run it. */
  wake(effect: object): void;

  /**
   * A new effect. `target` is the DOM node a binding named as its own when it
   * created this, which is attribution by declaration rather than by watching
   * what changed — see `declareTarget`. Absent for every effect that is not a
   * binding, and for a binding sharing a grouped effect with its neighbours,
   * where one effect has several targets and naming one would be a lie.
   */
  effectCreated(effect: object, phase: EffectPhase, target?: object): void;
  effectDisposed(effect: object): void;

  /** Brackets one run. `runEnded` is called even if the effect threw. */
  runStarted(effect: object, phase: EffectPhase): void;
  runEnded(effect: object): void;

  flushStarted(): void;
  flushEnded(passes: number, forcedLayouts: number): void;

  /**
   * Why this effect was last woken, phrased for an error message — the same
   * fact the panel shows as "why did this update", asked for by the code that
   * has an exception in its hand rather than a user with a mouse.
   */
  explain(effect: object): string | null;
}

export let devListener: DevListener | null = null;

export function setDevListener(listener: DevListener | null): void {
  devListener = listener;
}
