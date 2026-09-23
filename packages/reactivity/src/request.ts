/**
 * One server request's share of everything that would otherwise be global.
 *
 * A browser runs one page at a time, so a module-level counter, a "styles
 * already injected" flag or a lazily created ambient locale are all safe
 * there. A server runs many pages at once, in one process, interleaved at
 * every `await` — and each of those becomes a way for one response to be
 * assembled out of another's state.
 *
 * `AsyncLocalStorage` would answer this and is deliberately not used: it is a
 * `node:` builtin, and the roadmap commits to running on edge runtimes that
 * have no such thing. What replaces it is a rule rather than a mechanism —
 * **flush to quiescence before every await** — which holds because Volt's
 * render is synchronous by construction. `settleRequest` is that rule written
 * out: enter the request, build and flush until nothing is left to do, leave
 * the request, and only then wait for the data. Nothing observes a request
 * scope across an `await`, so nothing needs to be carried across one.
 *
 * The quiescence rule alone is not enough, because two requests waiting on
 * staggered promises resume interleaved and would drain each other's effects
 * out of shared queues. So a request also owns its lanes; see `Lanes`.
 */

import { type Lanes, createLanes, flushSync, useLanes } from './effect.js';

export interface RequestScope {
  /** @internal The queues this request's effects are filed into. */
  readonly lanes: Lanes;
  /** @internal Slots keyed by symbol; see `requestState`. */
  readonly state: Map<symbol, unknown>;
  /** @internal Data started under this request that it has yet to wait for. */
  pending: Promise<unknown>[];
}

let current: RequestScope | null = null;

/**
 * Where request state lives when there is no request: a browser.
 *
 * The same accessors serve both, so nothing in a component has to know which
 * side it is running on.
 */
const processState = new Map<symbol, unknown>();

export function createRequestScope(): RequestScope {
  return { lanes: createLanes(), state: new Map(), pending: [] };
}

export function currentRequest(): RequestScope | null {
  return current;
}

/**
 * Run `fn` as part of `scope`.
 *
 * Synchronous by contract. Handing this a function that awaits would put the
 * request back where it started while the work carried on inside it, which is
 * the failure the whole module exists to prevent.
 */
export function runInRequest<T>(scope: RequestScope, fn: () => T): T {
  const previousScope = current;
  const previousLanes = useLanes(scope.lanes);
  current = scope;
  try {
    return fn();
  } finally {
    current = previousScope;
    useLanes(previousLanes);
  }
}

/**
 * A value that belongs to the current request, created once per request.
 *
 * The key is a symbol so the slot is owned by whoever declares it — component
 * styles, the ambient locale, the id positions — without this module knowing
 * what any of them are.
 *
 * In a browser with no request, the page is the request and keeps it. On a
 * server with no request, nothing keeps it: each read builds its own.
 */
export function requestState<T>(key: symbol, create: () => T): T {
  // A server with no request current is running for some request without
  // being inside it — a route loader, a promise's continuation — and the
  // process is every request's. Filed there, what the first reader's work kept
  // is what every later reader's finds, so it is built and kept by nothing.
  if (__VOLT_SERVER__ && !current) return create();
  const store = current ? current.state : processState;
  const existing = store.get(key);
  // `has` only on a miss, so a slot that legitimately holds `undefined` is
  // still created once rather than on every read.
  if (existing !== undefined || store.has(key)) return existing as T;
  const value = create();
  store.set(key, value);
  return value;
}

/** Forget a slot, so the next read builds it again. */
export function clearRequestState(key: symbol): void {
  (current ? current.state : processState).delete(key);
}

/**
 * Register data work the request has to wait for before it can be written out.
 *
 * Compiled out of a client build, where a resource's request is nobody's to
 * wait for: the page renders without it and updates when it lands. The guard
 * is more than the minifier's hint, because `runInRequest` is exported to both
 * sides: a scope entered on the client would collect promises that no
 * `settleRequest` — compiled out there — is ever going to drain.
 */
export function trackRequestData(work: Promise<unknown>): void {
  if (!__VOLT_SERVER__) return;
  current?.pending.push(work);
}

/**
 * How many times a request may go back for more data.
 *
 * Far below `flushSync`'s hundred passes, because a round here is a network
 * wait rather than a synchronous drain: a resource whose source is another
 * resource's data nests a handful deep in the worst honest design, and a page
 * that needs a twenty-first round is describing a cycle rather than a depth.
 */
const MAX_SETTLE_ROUNDS = 20;

function settleRoundsError(): Error {
  return new Error(
    __VOLT_DEV__
      ? '[volt] a request was still asking for data after ' +
        MAX_SETTLE_ROUNDS +
        ' rounds — something asks for another fetch every time the last one lands.'
      : '[volt] request did not settle',
  );
}

/**
 * Build one request and flush it to quiescence, repeatedly, until no data is
 * outstanding.
 *
 * The loop is the point. A first flush starts whatever fetches the tree asks
 * for; awaiting those may produce a tree that asks for more — a resource whose
 * source is another resource's data — so quiescence is only reached when a
 * flush adds nothing to the queue.
 *
 * And it is bounded, for the same reason `flushSync` is: a tree that asks for
 * one more fetch every time the last answer lands never reaches quiescence,
 * and without a bound that is a request that hangs until something upstream
 * times it out — the one failure a server must not have, because nothing in
 * the process is left to say what went wrong.
 *
 * `around` is entered inside the request for the build and for every flush,
 * each round and not only the first — the synchronous spans, which are the
 * only places the tree can start anything. It is how a second ambient that
 * must not be carried across an `await` is made visible to the render: a
 * server function's `guard` reads the request that way. What runs *between*
 * the spans is the continuation of whatever the request is waiting on, and
 * `around` does not cover it, because nothing can: those continuations run
 * interleaved with every other request's. A call that needs another's answer
 * belongs in something that answer re-runs — a resource whose source it is —
 * which runs again in the next round's flush, where `around` is.
 *
 * It is handed in rather than kept in request state because whoever supplies
 * it is outside the scope, where a server keeps no request state at all — and
 * an argument cannot be filed anywhere another request could find it.
 *
 * The whole body is a server build's. In a client build `__VOLT_SERVER__` is
 * `false`, the minifier removes everything below the guard, and a call here
 * does nothing at all: the server render path is not code a browser ships,
 * and a component's data is fetched by the client's own flush instead.
 */
export async function settleRequest(
  scope: RequestScope,
  build: () => void,
  around?: <T>(run: () => T) => T,
): Promise<void> {
  if (!__VOLT_SERVER__) {
    if (__VOLT_DEV__ && typeof console !== 'undefined') {
      console.warn(
        '[volt] settleRequest was called in a client build, where it is compiled out and ' +
          'does nothing. Server rendering needs a build with __VOLT_SERVER__ defined true — ' +
          '@voltdev/vite-plugin sets it for an SSR build.',
      );
    }
    return;
  }

  const span = (run: () => void): void =>
    runInRequest(scope, around ? () => around(run) : run);

  span(build);

  for (let round = 0; ; round++) {
    span(flushSync);
    const pending = scope.pending;
    if (pending.length === 0) return;
    scope.pending = [];
    // Settled rather than resolved: a fetch that rejects is the resource's
    // business — it has already written its own error state — and must not
    // take down the render that started it.
    await Promise.allSettled(pending);
    // Counted after the wait rather than before it, so the promises this round
    // started are observed either way and a rejection among them is nobody's
    // unhandled one.
    if (round >= MAX_SETTLE_ROUNDS) throw settleRoundsError();
  }
}
