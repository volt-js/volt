/**
 * Volt's effect system, layered on `Signal.subtle.Watcher`.
 *
 * The Signals proposal deliberately ships no `effect`, because scheduling is a
 * framework concern. Volt schedules in four phases:
 *
 *   - `renderEffect` — DOM patching. Runs immediately on creation so a
 *     template builds synchronously, and flushes before everything else.
 *   - `dataEffect` — asking for data. Deferred like a user effect, but drained
 *     ahead of one, because it is the only lane besides render that a server
 *     runs: the server has to start the fetches and wait for them, and it must
 *     do that without running user work that expects a live document.
 *   - `measureEffect` — reading geometry, once the DOM has settled and before
 *     anything writes again, so every read in a flush shares one layout.
 *   - `effect` — user work. Its first run is deferred along with the rest, so
 *     it always observes a settled tree.
 *
 * Data sits before measure rather than after it because a data effect that
 * writes a signal — a status turning `loading` — sends the flush back to the
 * render lane. Drained after measure, that write would dirty the layout the
 * measure phase had just paid for and force a second one.
 *
 * Updates are coalesced onto a microtask, which means a burst of `.set()`
 * calls repaints once. `flushSync()` drains the queues immediately when you
 * need the DOM up to date on the current turn (tests, measurement).
 *
 * Scopes give Volt the disposal story the proposal has no opinion on: every
 * effect belongs to the scope that created it, so tearing down a component
 * tears down its effects and their cleanups in one call.
 */

import { devListener, type EffectPhase } from './dev.js';
import { declareBoundary, raiseError, type ErrorHandler } from './errors.js';
import {
  ComputedSignal,
  WatcherNode,
  disposeComputed,
  markEffectComputed,
  untrack,
} from './graph.js';

export type Dispose = () => void;
export type CleanupFn = () => void;
export type EffectFn = () => void | CleanupFn;

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

export interface Scope {
  parent: Scope | null;
  /**
   * Allocated on first child; most scopes never have one.
   *
   * An array rather than a set: teardown walks the whole list and discards it,
   * which needs no membership test, and hashing every scope on the way out is
   * the bulk of the cost of clearing a large tree.
   */
  children: Scope[] | null;
  /**
   * This scope's index in `parent.children`, or -1 when it has no parent.
   *
   * Kept so a scope can detach itself without searching for its own slot. A
   * keyed list disposes rows one at a time, so a linear search here would make
   * clearing a list quadratic in its length.
   */
  slot: number;
  /** Allocated on first cleanup; most scopes never register one. */
  cleanups: CleanupFn[] | null;
  contexts: Map<symbol, unknown> | null;
  disposed: boolean;
}

let currentScope: Scope | null = null;

/**
 * A scope under the current one, torn down with it.
 *
 * `createRoot` is the other way to get a scope, and it untracks: what it makes
 * is a root, deliberately independent of whatever is building. This does not,
 * because the component layer needs a scope of its own around work whose
 * signal reads still belong to the effect that is building the tree.
 */
export function createScope(parent: Scope | null = currentScope): Scope {
  const scope: Scope = {
    parent,
    children: null,
    slot: -1,
    cleanups: null,
    contexts: null,
    disposed: false,
  };
  if (parent) {
    const siblings = (parent.children ??= []);
    scope.slot = siblings.length;
    siblings.push(scope);
  }
  return scope;
}

export function getScope(): Scope | null {
  return currentScope;
}

function runInScope<T>(scope: Scope | null, fn: () => T): T {
  const previous = currentScope;
  currentScope = scope;
  try {
    return fn();
  } finally {
    currentScope = previous;
  }
}

export function runWithScope<T>(scope: Scope | null, fn: () => T): T {
  return runInScope(scope, fn);
}

/** Tear down a scope's children and cleanups without disposing the scope. */
function clearScope(scope: Scope): void {
  const children = scope.children;
  if (children !== null) {
    // Children are told not to detach themselves: the whole list is discarded
    // straight after, so each one searching for its own slot would make
    // clearing a large tree quadratic.
    for (let i = children.length - 1; i >= 0; i--) disposeScope(children[i]!, false);
    children.length = 0;
  }

  const cleanups = scope.cleanups;
  if (cleanups !== null) {
    // Cleanups run newest-first so teardown mirrors construction order.
    for (let i = cleanups.length - 1; i >= 0; i--) {
      try {
        cleanups[i]!();
      } catch (err) {
        raiseError(err, scope);
      }
    }
    cleanups.length = 0;
  }
}

export function disposeScope(scope: Scope, detach = true): void {
  if (scope.disposed) return;
  scope.disposed = true;
  clearScope(scope);

  if (detach && scope.parent?.children) {
    const siblings = scope.parent.children;
    const index = scope.slot;
    if (index >= 0 && siblings[index] === scope) {
      // Order between siblings carries no meaning, so the last one fills the
      // hole rather than shifting everything after it — and it is told where
      // it landed, so it can still detach itself in constant time.
      const last = siblings.pop()!;
      if (index < siblings.length) {
        siblings[index] = last;
        last.slot = index;
      }
    }
  }

  scope.slot = -1;
  scope.contexts = null;
}

/**
 * Run `fn` in a fresh scope and hand it a disposer. Nothing created inside is
 * released until that disposer is called, which is how Volt keeps a mounted
 * component alive independently of whatever rendered it.
 */
export function createRoot<T>(
  fn: (dispose: Dispose) => T,
  parent: Scope | null = currentScope,
): T {
  const scope = createScope(parent);
  const dispose = () => disposeScope(scope);
  return runInScope(scope, () => untrack(() => fn(dispose)));
}

export function onCleanup(fn: CleanupFn): CleanupFn {
  if (currentScope === null) {
    if (__VOLT_DEV__ && typeof console !== 'undefined') {
      console.warn('[volt] onCleanup called outside a reactive scope — it will never run.');
    }
    return fn;
  }
  (currentScope.cleanups ??= []).push(fn);
  return fn;
}

/**
 * Make the current scope a boundary: errors thrown anywhere below it arrive
 * here instead of at the console.
 *
 * The handler is given the error and the scope that produced it, and decides
 * what happens next. Returning swallows the error. Throwing sends it — or a
 * different one — on to the boundary above, so a boundary that only knows how
 * to deal with one kind of failure can let the rest past. Replacing the failed
 * subtree with something that renders is what `errorBoundary` in
 * `@voltdev/core` does with this, and it is a separate thing because nothing
 * down here knows what DOM is.
 *
 * An error raised while a handler is running goes to the boundary above rather
 * than back to the one that is mid-recovery, which is what stops a fallback
 * that throws from replacing itself for ever.
 */
export function onError(handler: ErrorHandler): void {
  if (currentScope === null) {
    if (__VOLT_DEV__ && typeof console !== 'undefined') {
      console.warn('[volt] onError called outside a reactive scope — nothing will reach it.');
    }
    return;
  }
  declareBoundary(currentScope, handler);
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface Context<T> {
  readonly id: symbol;
  readonly defaultValue: T;
}

export function createContext<T>(defaultValue: T, name?: string): Context<T> {
  return { id: Symbol(name ?? 'volt.context'), defaultValue };
}

export function provideContext<T>(context: Context<T>, value: T): void {
  if (!currentScope) {
    throw new Error('[volt] provideContext must be called inside a reactive scope.');
  }
  (currentScope.contexts ??= new Map()).set(context.id, value);
}

export function useContext<T>(context: Context<T>): T {
  let scope = currentScope;
  while (scope) {
    if (scope.contexts?.has(context.id)) return scope.contexts.get(context.id) as T;
    scope = scope.parent;
  }
  return context.defaultValue;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

let scheduled = false;
let flushing = false;
let batchDepth = 0;

/**
 * The queues one flush drains, in the order it drains them.
 *
 * Held together in one object rather than as four module variables because a
 * server render swaps the whole set: an effect created for one request must
 * not be drained by another request's flush, and giving each request its own
 * queues is the only arrangement where that is structural instead of a check
 * paid on every effect that ever runs.
 */
export interface Lanes {
  readonly render: WatcherNode;
  readonly data: WatcherNode;
  readonly measure: WatcherNode;
  readonly user: WatcherNode;
}

function notifyScheduler(this: WatcherNode): void {
  schedule();
}

/** @internal Used by the request scope; not part of the public surface. */
export function createLanes(): Lanes {
  return {
    render: new WatcherNode(notifyScheduler),
    data: new WatcherNode(notifyScheduler),
    measure: new WatcherNode(notifyScheduler),
    user: new WatcherNode(notifyScheduler),
  };
}

const globalLanes = createLanes();

/**
 * The queues effects are filed into and flushes drain.
 *
 * Read at every use rather than captured, so entering a request redirects both
 * at once — an effect created inside a request belongs to it for as long as it
 * lives, because `createEffect` keeps the watcher it was filed into.
 */
let lanes = globalLanes;

/** @internal Enter a request's queues. Returns the ones it displaced. */
export function useLanes(next: Lanes): Lanes {
  const previous = lanes;
  lanes = next;
  return previous;
}

let pendingResolvers: (() => void)[] = [];

function schedule(): void {
  // Nothing self-flushes on a server. A queued microtask fires at the first
  // `await`, under whatever request happens to be current by then, which is
  // exactly how one render's effects end up in another's output. A server
  // render flushes explicitly instead, inside its own request, before it
  // awaits anything.
  if (__VOLT_SERVER__) return;
  if (scheduled || flushing || batchDepth > 0) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    flushSync();
  });
}

const MAX_FLUSH_PASSES = 100;

/**
 * The lane being drained, for the tools.
 *
 * A module variable rather than an argument to `runEffectComputed`, because
 * every read of it is inside a dropped branch in a production build — which
 * leaves a declaration nothing references, and that goes too. Threading the
 * phase through the call would survive as four string literals on the hot
 * path instead.
 */
let devPhase: EffectPhase = 'user';

export interface FlushMetrics {
  /** Flushes that ran at least one effect, since the last reset. */
  flushes: number;
  /** Forced layouts the most recent of those flushes cost. */
  forcedLayouts: number;
  /** The worst any single flush has cost since the last reset. */
  peakForcedLayouts: number;
  /** Geometry read outside the measure lane, in the most recent flush. */
  strayReads: number;
  /** The worst any single flush has read since the last reset. */
  peakStrayReads: number;
}

const metrics: FlushMetrics = {
  flushes: 0,
  forcedLayouts: 0,
  peakForcedLayouts: 0,
  strayReads: 0,
  peakStrayReads: 0,
};

/**
 * A snapshot of what the scheduler cost.
 *
 * Two numbers, because they answer opposite questions.
 *
 * `forcedLayouts` is what the lane costs when it is used: measure drains that
 * followed a write, counted from the phase transitions rather than by
 * instrumenting reads, so a drain is charged one layout whether or not a
 * callback asked for geometry. An upper bound, and the cheap one. Tracked in
 * production too — a metric that disappears from the build where performance
 * matters defends nothing. One per flush is the healthy shape; it climbs when
 * a measure writes a signal that sends the flush back through the render lane.
 *
 * `strayReads` is the failure the lane exists to prevent, and it is a
 * different number precisely because `forcedLayouts` cannot show it: geometry
 * read from a render or user effect never enters a measure drain at all, so a
 * page that measures entirely from the wrong phase drives `forcedLayouts` to
 * zero rather than up. Counting it means instrumenting the reads, which is
 * done by wrapping the accessors that force layout — a development price. A
 * production build installs no wrappers and this stays at zero there.
 *
 * The returned object is a copy: holding on to one and reading it after
 * another flush would otherwise report that flush instead of the measured one.
 */
export function getFlushMetrics(): FlushMetrics {
  return { ...metrics };
}

export function resetFlushMetrics(): void {
  metrics.flushes = 0;
  metrics.forcedLayouts = 0;
  metrics.peakForcedLayouts = 0;
  metrics.strayReads = 0;
  metrics.peakStrayReads = 0;
}

function settleError(phase: string): Error {
  return new Error(
    __VOLT_DEV__
      ? '[volt] ' +
        phase +
        ' effects did not settle after ' +
        MAX_FLUSH_PASSES +
        ' passes — one of them is very likely writing a signal it also reads.'
      : '[volt] effects did not settle',
  );
}

/**
 * Drain the queues now, in phase order: render effects settle completely,
 * then data effects ask, then measure effects read, then user effects run.
 * Every pass starts again from the top, so a user effect that writes still
 * gets its DOM patched — and anything measuring it re-read — before this
 * returns.
 *
 * A server build stops after the data lane. Measurement needs a layout engine
 * and a user effect is written against a document that is in a browser, so
 * neither has anything to do before the bytes are written; and the lanes below
 * data are precisely the ones the roadmap says must not run on a server.
 */
export function flushSync(): void {
  // An open batch wins: nothing is allowed to observe a half-applied group,
  // including an explicit flush from inside it.
  if (flushing || batchDepth > 0) return;
  flushing = true;
  scheduled = false;
  if (__VOLT_DEV__) {
    if (!probed) installProbes();
    devListener?.flushStarted();
  }

  // Whether a read would have to wait for layout. It starts true because
  // whatever caused this flush — an event handler, a bare `.set()` — has
  // already written something the engine has not laid out since.
  let layoutStale = true;
  let forcedLayouts = 0;
  let passes = 0;

  try {
    for (;;) {
      const renderPending = lanes.render.getPending();
      if (renderPending.length > 0) {
        if (__VOLT_DEV__) devPhase = 'render';
        for (const node of renderPending) runEffectComputed(node);
        lanes.render.watch();
        layoutStale = true;
        if (++passes > MAX_FLUSH_PASSES) throw settleError('Render');
        continue;
      }

      const dataPending = lanes.data.getPending();
      if (dataPending.length > 0) {
        // `layoutStale` is deliberately left alone: asking for data writes no
        // DOM, and anything it does write to a signal comes back through the
        // render lane above, which sets it.
        if (__VOLT_DEV__) devPhase = 'data';
        for (const node of dataPending) runEffectComputed(node);
        lanes.data.watch();
        if (++passes > MAX_FLUSH_PASSES) throw settleError('Data');
        continue;
      }


      if (__VOLT_SERVER__) break;

      const measurePending = lanes.measure.getPending();
      if (measurePending.length > 0) {
        // The whole point of the lane: the first read pays for layout and
        // every other read in the drain is then free.
        if (layoutStale) {
          forcedLayouts++;
          layoutStale = false;
        }
        if (__VOLT_DEV__) devPhase = 'measure';
        drainMeasure(measurePending);
        lanes.measure.watch();
        if (++passes > MAX_FLUSH_PASSES) throw settleError('Measure');
        continue;
      }

      const effectPending = lanes.user.getPending();
      if (effectPending.length === 0) break;

      if (__VOLT_DEV__) devPhase = 'user';
      for (const node of effectPending) runEffectComputed(node);
      lanes.user.watch();
      layoutStale = true;
      if (++passes > MAX_FLUSH_PASSES) throw settleError('User');
    }
  } finally {
    flushing = false;
    // A flush that found nothing to do is not a flush: counting it would
    // overwrite the last real measurement with a zero on the next `tick()`.
    if (passes > 0) {
      metrics.flushes++;
      metrics.forcedLayouts = forcedLayouts;
      if (forcedLayouts > metrics.peakForcedLayouts) metrics.peakForcedLayouts = forcedLayouts;
    }
    if (__VOLT_DEV__) {
      if (passes > 0) {
        metrics.strayReads = strayReads;
        if (strayReads > metrics.peakStrayReads) metrics.peakStrayReads = strayReads;
      }
      // Zeroed on the way out rather than on the way in, so a read made
      // between two flushes is charged to neither.
      strayReads = 0;
      devListener?.flushEnded(passes, forcedLayouts);
    }
    const resolvers = pendingResolvers;
    pendingResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}

/**
 * A measure drain, watched in development for writes.
 *
 * The phase is read-only by contract: a write in the middle of it invalidates
 * the layout the drain just paid for, so the next read forces another one and
 * the thrash the lane exists to remove is back, silently, visible only under
 * a profiler.
 *
 * Two mechanisms, because neither sees what the other does. A MutationObserver
 * catches anything that lands in the tree — attributes, children, text —
 * whichever API made it, including `style.top = ...`, which patching
 * individual DOM methods would miss. It cannot see a write that changes no
 * node, so the scroll properties are wrapped as well: `scrollTop` is named in
 * `measureEffect`'s own contract as geometry, and reading it and writing it
 * back is the round trip this phase most specifically forbids.
 *
 * Past those two the guard is blind by construction. A property write that
 * touches no node and moves no scroller — `input.value`, `el.focus()`,
 * `element.animate()` — is not reported, and neither is a write to a subtree
 * that is not in the document. Everything on that list with an implementation
 * to call is pinned by test, so widening the guard reddens one rather than
 * being noticed by whoever is surprised by it later.
 */
function drainMeasure(pending: ComputedSignal<unknown>[]): void {
  if (!__VOLT_DEV__) {
    for (const node of pending) runEffectComputed(node);
    return;
  }

  if (measureObserver === undefined) {
    measureObserver =
      typeof MutationObserver === 'function' && typeof document !== 'undefined'
        ? // Records are taken synchronously below, so the callback is never
          // left anything to deliver.
          new MutationObserver(() => {})
        : null;
  }
  measureObserver?.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const written: string[] = [];
  measureWrites = written;

  try {
    for (const node of pending) runEffectComputed(node);
  } finally {
    collectMutations();
    measureWrites = null;
    measureObserver?.disconnect();
    if (written.length > 0 && typeof console !== 'undefined') {
      // All of them, not the first one: a measure that patched twenty
      // attributes reported one and left the other nineteen to be found one
      // re-run at a time.
      const rest = written.length > 1 ? ` and ${written.length - 1} more` : '';
      console.error(
        `[volt] A measure effect wrote to the DOM (${written[0]}${rest}). The measure ` +
          'phase is read-only: a write there dirties the layout the phase just forced, ' +
          'so the next read forces another one. Set a signal instead and let a render ' +
          'effect apply it, or move the write to effect().',
      );
    }
  }
}

let measureObserver: MutationObserver | null | undefined;

/** Writes seen during the measure drain in progress; null outside one. */
let measureWrites: string[] | null = null;

/** Geometry reads charged to the flush in progress. */
let strayReads = 0;

let probed = false;

/** Move what the observer has seen so far into the drain's list of writes. */
function collectMutations(): void {
  const records = measureObserver?.takeRecords();
  if (!records || measureWrites === null) return;
  for (const record of records) {
    measureWrites.push(
      record.type === 'attributes'
        ? `${record.attributeName} on <${tagOf(record.target)}>`
        : `${record.type} on <${tagOf(record.target)}>`,
    );
  }
}

/**
 * Stop charging DOM writes to the measure that is draining, until the mark
 * this returns is handed back.
 *
 * A render effect created inside a measure runs immediately, by design, so the
 * DOM it patches lands in the middle of the drain. Charging it to the measure
 * printed "set a signal instead and let a render effect apply it" at code that
 * had done precisely that.
 */
function beginForeignWrites(): number {
  if (measureWrites === null) return 0;
  collectMutations();
  return measureWrites.length;
}

function endForeignWrites(mark: number): void {
  if (measureWrites === null) return;
  measureObserver?.takeRecords();
  measureWrites.length = mark;
}

/**
 * Properties and methods the engine cannot answer without laying out first.
 *
 * Wrapping them is what makes `strayReads` possible: a read from a render or
 * user effect never reaches a measure drain, so the phase transitions
 * `forcedLayouts` is counted from cannot see it. `scrollTop` and `scrollLeft`
 * carry the write half of the guard as well — they move a scroller without
 * changing a node, which is why the MutationObserver never sees them.
 */
const GEOMETRY_ACCESSORS = [
  'offsetWidth',
  'offsetHeight',
  'offsetTop',
  'offsetLeft',
  'clientWidth',
  'clientHeight',
  'clientTop',
  'clientLeft',
  'scrollWidth',
  'scrollHeight',
  'scrollTop',
  'scrollLeft',
];

const GEOMETRY_METHODS = ['getBoundingClientRect', 'getClientRects'];

/** Methods that move a scroller, changing no attribute, child or text. */
const SCROLL_METHODS = ['scrollIntoView', 'scroll', 'scrollTo', 'scrollBy'];

function installProbes(): void {
  probed = true;
  if (typeof HTMLElement !== 'function') return;
  for (const name of GEOMETRY_ACCESSORS) probeAccessor(name);
  for (const name of GEOMETRY_METHODS) probeMethod(name, false);
  for (const name of SCROLL_METHODS) probeMethod(name, true);
}

/**
 * Where a DOM property is really defined, walking up from `HTMLElement`:
 * `scrollTop` belongs to `Element` and `offsetWidth` to `HTMLElement`, and
 * redefining one on the wrong prototype would shadow it for that subtree only.
 */
function ownerOf(name: string): [object, PropertyDescriptor] | null {
  let proto: object | null = HTMLElement.prototype;
  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (descriptor) return descriptor.configurable === true ? [proto, descriptor] : null;
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return null;
}

function probeAccessor(name: string): void {
  const found = ownerOf(name);
  const read = found?.[1].get;
  if (!found || !read) return;
  const write = found[1].set;
  Object.defineProperty(found[0], name, {
    configurable: true,
    enumerable: found[1].enumerable,
    get(this: Element): unknown {
      countRead();
      return read.call(this);
    },
    set: write
      ? function (this: Element, value: unknown): void {
          noteWrite(name, this);
          write.call(this, value);
        }
      : undefined,
  });
}

function probeMethod(name: string, writes: boolean): void {
  const found = ownerOf(name);
  const original = found?.[1].value as ((...args: unknown[]) => unknown) | undefined;
  if (!found || typeof original !== 'function') return;
  Object.defineProperty(found[0], name, {
    ...found[1],
    value(this: Element, ...args: unknown[]): unknown {
      if (writes) noteWrite(name, this);
      else countRead();
      return original.apply(this, args);
    },
  });
}

/**
 * Only inside a flush, and only outside the measure drain: a read from an
 * event handler or an animation frame is not the scheduler's to account for,
 * and the drain is where reads are supposed to happen.
 */
function countRead(): void {
  if (flushing && devPhase !== 'measure') strayReads++;
}

function noteWrite(name: string, target: Element): void {
  measureWrites?.push(`${name} on <${tagOf(target)}>`);
}

function tagOf(node: Node): string {
  return (node as Partial<Element>).nodeName?.toLowerCase() ?? 'node';
}

function runEffectComputed(node: ComputedSignal<unknown>): void {
  if (__VOLT_DEV__) devListener?.runStarted(node, devPhase);
  try {
    node.get();
  } catch (err) {
    // An effect is its own scope, and the scope is where the error has to
    // start from: a boundary is found by walking up from here. Which write
    // woke this effect is the first thing anyone debugging it asks, and it is
    // known here and nowhere downstream of here.
    raiseError(err, node as unknown as Scope, __VOLT_DEV__ ? devListener?.explain(node) : null);
  } finally {
    if (__VOLT_DEV__) devListener?.runEnded(node);
  }
}

/** Resolves once the DOM reflects every pending change. */
export function tick(): Promise<void> {
  flushSync();
  return new Promise<void>((resolve) => {
    pendingResolvers.push(resolve);
    queueMicrotask(() => {
      if (!flushing) {
        const index = pendingResolvers.indexOf(resolve);
        if (index !== -1) pendingResolvers.splice(index, 1);
        resolve();
      }
    });
  });
}

/**
 * Group writes so nothing flushes until the whole group is applied. Updates
 * already coalesce on a microtask, so this only matters alongside
 * `flushSync()` or when a partially-applied state would be observable.
 */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) schedule();
  }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/**
 * An effect's computed node, which is also its scope.
 *
 * Two objects were allocated per effect: the computed, and a separate scope
 * holding its children and cleanups. Effect construction is what building a
 * list row is made of, so that second object was paid for on every binding of
 * every row. A subclass keeps the scope fields off ordinary computeds, which
 * never need them, while giving effects both roles in one allocation.
 */
class EffectNode extends ComputedSignal<void> implements Scope {
  parent: Scope | null = null;
  children: Scope[] | null = null;
  slot = -1;
  cleanups: CleanupFn[] | null = null;
  contexts: Map<symbol, unknown> | null = null;
  disposed = false;
}

/** Which lane a watcher is, for the tools. Never called in a shipped build. */
function phaseOf(watcher: WatcherNode): EffectPhase {
  if (watcher === lanes.render) return 'render';
  if (watcher === lanes.data) return 'data';
  if (watcher === lanes.measure) return 'measure';
  return 'user';
}

function createEffect(fn: EffectFn, watcher: WatcherNode, immediate: boolean): Dispose {
  const parent = currentScope;
  const phase: EffectPhase = __VOLT_DEV__ ? phaseOf(watcher) : 'user';
  let cleanup: CleanupFn | null = null;
  let disposed = false;

  // No options object. An effect must re-run on every notification rather than
  // dedupe on its result, which used to be said with `equals: () => false` —
  // three allocations per effect (the object, that arrow, and the wrapper the
  // constructor builds around it) for a comparison that is never reached,
  // because a node marked as an effect skips the equality path entirely. Row
  // creation is dominated by effect construction, so this is not incidental.
  const computed: EffectNode = new EffectNode(function effectBody() {
    // Each run starts from a clean slate: children disposed, cleanups run.
    clearScope(scope);
    if (cleanup) {
      const previous = cleanup;
      cleanup = null;
      try {
        previous();
      } catch (err) {
        raiseError(err, scope);
      }
    }
    const result = runInScope(scope, fn);
    if (typeof result === 'function') cleanup = result;
  });

  // The node is its own scope, so nothing else is allocated for one.
  const scope: Scope = computed;
  computed.parent = parent;
  if (parent) {
    const siblings = (parent.children ??= []);
    computed.slot = siblings.length;
    siblings.push(computed);
  }

  markEffectComputed(computed as unknown as ComputedSignal<unknown>);

  if (__VOLT_DEV__) devListener?.effectCreated(computed, phase);

  watcher.watch(computed as unknown as ComputedSignal<unknown>);

  if (immediate) {
    // Untracked so that creating an effect inside another effect does not make
    // the outer one depend on the inner.
    untrack(() => {
      const mark = __VOLT_DEV__ ? beginForeignWrites() : 0;
      if (__VOLT_DEV__) devListener?.runStarted(computed, phase);
      try {
        computed.get();
      } catch (err) {
        raiseError(err, scope, __VOLT_DEV__ ? devListener?.explain(computed) : null);
      } finally {
        if (__VOLT_DEV__) {
          devListener?.runEnded(computed);
          endForeignWrites(mark);
        }
      }
    });
  } else {
    // A fresh computed is already DIRTY; queueing it means the first run
    // happens in the next flush rather than at creation. That is what lets an
    // effect declared in a class field observe values assigned to the
    // instance afterwards — component props, most importantly — instead of
    // firing once against the field's initial value.
    watcher.pending.add(computed as unknown as ComputedSignal<unknown>);
    schedule();
  }

  const dispose: Dispose = () => {
    if (disposed) return;
    disposed = true;
    watcher.unwatch(computed as unknown as ComputedSignal<unknown>);
    // Unwatching stops it being scheduled; this detaches it from its sources
    // so they stop retaining and re-marking it.
    disposeComputed(computed as unknown as ComputedSignal<unknown>);
    if (__VOLT_DEV__) devListener?.effectDisposed(computed);
    if (cleanup) {
      try {
        cleanup();
      } catch (err) {
        raiseError(err, scope);
      }
      cleanup = null;
    }
    disposeScope(scope);
  };

  // Disposing the owning scope disposes its effects.
  if (parent) (parent.cleanups ??= []).push(dispose);
  return dispose;
}

/**
 * A user effect.
 *
 * The first run is deferred to the next flush, so the effect observes a
 * settled tree — and, for an effect declared in a class field, values
 * assigned to the instance after construction.
 */
export function effect(fn: EffectFn): Dispose {
  return createEffect(fn, lanes.user, false);
}

/**
 * An effect that asks for data.
 *
 * Deferred exactly like a user effect, so a resource declared in a class field
 * still observes the props assigned after construction — but drained before
 * one, because this is the lane a server runs. `createResource` starts its
 * first request from here, which is what makes "the server awaits the data"
 * and "no user effects on the server" able to hold at the same time: without
 * a lane of its own, the fetch either never starts or drags every user effect
 * onto the server with it.
 *
 * Nothing here may touch the DOM. On a server there is none.
 */
export function dataEffect(fn: EffectFn): Dispose {
  return createEffect(fn, lanes.data, false);
}

/**
 * A DOM-patching effect. Runs synchronously on creation, because a template
 * has to produce its nodes before anything can insert them.
 */
export function renderEffect(fn: EffectFn): Dispose {
  return createEffect(fn, lanes.render, true);
}

/**
 * A read-only effect, run after the DOM has settled and before any user
 * effect writes to it again.
 *
 * Geometry — `getBoundingClientRect`, `offsetWidth`, `scrollTop` — is only
 * meaningful once rendering has finished, and reading it forces the engine to
 * lay out everything written since the last frame. Read from an `effect` and
 * every component that positions a popover, syncs a scroller or measures
 * overflow forces a layout of its own, turning one flush into write, layout,
 * write, layout, once per component. Read from here and they all share the
 * single layout the phase forces once.
 *
 * Writing a signal from here is the intended way out: the render effect that
 * reads it patches the DOM on the next pass, still ahead of user effects.
 * Writing to the DOM directly is what reinstates the thrash, so in
 * development the drain reports it.
 */
export function measureEffect(fn: EffectFn): Dispose {
  return createEffect(fn, lanes.measure, false);
}
