/**
 * @voltdev/core
 *
 * Volt is a TypeScript UI framework built from three ideas that fit together:
 *
 *   - components are classes, declared with standard TC39 decorators
 *   - templates are HTML where everything dynamic starts with `:`
 *   - reactivity is the TC39 Signals proposal, with no virtual DOM anywhere
 *
 * A component class is constructed once. Its template compiles to code that
 * clones static markup and wires one effect per dynamic binding, so an update
 * touches exactly the nodes whose inputs changed — never a re-render.
 */

export {
  Component,
  Prop,
  defineComponent,
  mount,
  hydrate,
  getComponentConfig,
  isComponent,
  createComponent,
  requestStyles,
  slot,
} from './component.js';

export { createId, resetIds } from './ids.js';

/**
 * State the server's render hands to the client's, so a hydrated page starts
 * where the server left it rather than at a default it has already replaced.
 * Written by an application and by the primitives that fetch, which is why it
 * is here rather than in the server entry — the same call has to compile into
 * a client bundle and find the payload there.
 */
export { hydratable, wasHydrated, STATE_ATTRIBUTE } from './state.js';

/**
 * A boundary is content, like `:if` is: it decides what is on screen. It lives
 * in the DOM runtime with the rest of the control flow, and is re-exported
 * here because an application writes it by hand rather than through a compiled
 * template.
 */
export { errorBoundary } from './dom.js';
/**
 * The error every refusal in this framework throws.
 *
 * Public because an application is expected to branch on it: `code` is stable
 * across releases and survives the production strip that removes the sentence,
 * so a reporter can group by it. An error type a consumer is meant to act on
 * and cannot name is not a contract.
 */
export { VoltError } from './diagnostics.js';

export type { BoundaryOptions } from './dom.js';

export type {
  ComponentConfig,
  ComponentType,
  PropOptions,
  PropDefinition,
  MountHandle,
  OnMount,
  RenderFn,
  SlotMap,
} from './component.js';

// The reactive core is re-exported so an app needs a single import.
export {
  Signal,
  batch,
  effect,
  renderEffect,
  measureEffect,
  dataEffect,
  flushSync,
  tick,
  getFlushMetrics,
  resetFlushMetrics,
  createRoot,
  onCleanup,
  onError,
  raiseError,
  setErrorReporter,
  createContext,
  useContext,
  provideContext,
  isSignal,
  isWritableSignal,
  createRequestScope,
  currentRequest,
  runInRequest,
  requestState,
  clearRequestState,
  trackRequestData,
  settleRequest,
} from '@voltdev/reactivity';

export type {
  Context,
  Dispose,
  CleanupFn,
  EffectFn,
  ErrorHandler,
  ErrorReport,
  ErrorReporter,
  FlushMetrics,
  ReadableSignal,
  RequestScope,
  Scope,
  SignalOptions,
} from '@voltdev/reactivity';
