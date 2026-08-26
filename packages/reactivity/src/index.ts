/**
 * @voltdev/reactivity
 *
 * The reactive core is the TC39 Signals proposal, implemented faithfully:
 *
 *   const count = new Signal.State(0);
 *   const doubled = new Signal.Computed(() => count.get() * 2);
 *   count.set(1);
 *   doubled.get(); // 2
 *
 * Volt adds only what the proposal deliberately leaves to frameworks —
 * effects, scheduling, and disposal scopes — all built on
 * `Signal.subtle.Watcher`.
 */

/**
 * The namespace lives in its own module so that a bundler can leave it out of
 * an app that never names it; see `namespace.ts`.
 */
export { Signal } from './namespace.js';

/** Any readable signal — `Signal.State` or `Signal.Computed`. */
export type ReadableSignal<T> = { get(): T };

export type { SignalOptions } from './graph.js';
export { isSignal, isWritableSignal } from './graph.js';

// --- Volt's layer on top ---------------------------------------------------

export {
  effect,
  renderEffect,
  measureEffect,
  dataEffect,
  batch,
  flushSync,
  tick,
  getFlushMetrics,
  serverSkippedEffects,
  resetFlushMetrics,
  createRoot,
  onCleanup,
  onError,
  getScope,
  runWithScope,
  createScope,
  disposeScope,
  createContext,
  useContext,
  provideContext,
} from './effect.js';

export type {
  Scope,
  Context,
  Dispose,
  CleanupFn,
  EffectFn,
  FlushMetrics,
  SkippedEffect,
} from './effect.js';

// --- Where a thrown error goes ---------------------------------------------

/**
 * `attachOwner` is not an application API: it is how the component layer tells
 * the channel which component a scope belongs to, so that a report can name
 * one. It is exported because the two live in different packages.
 */
export { raiseError, setErrorReporter, attachOwner } from './errors.js';

export type { ErrorHandler, ErrorReport, ErrorReporter, ScopeOwner } from './errors.js';

// --- What a server keeps apart, one request from the next -----------------

export {
  createRequestScope,
  currentRequest,
  runInRequest,
  requestState,
  clearRequestState,
  trackRequestData,
  settleRequest,
} from './request.js';

export type { RequestScope } from './request.js';

// --- What the developer tools attach to ------------------------------------

/**
 * Instrumentation, not application API. `@voltdev/core/devtools` is the thing
 * to import; this is the socket it plugs into, exported because the graph and
 * the scheduler are the only places that know what the tools want to show.
 * Every call into a listener is guarded by `__VOLT_DEV__`, so a production
 * build removes the calls and then this module along with them.
 */
export { setDevListener } from './dev.js';

export type { DevListener, EffectPhase } from './dev.js';
