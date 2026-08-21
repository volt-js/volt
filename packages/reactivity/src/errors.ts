/**
 * Where a thrown error goes.
 *
 * An effect that threw used to reach `console.error` and stop there: no
 * boundary saw it, no application could observe it, and the tree was left
 * half-updated with nothing able to say so. Fine-grained reactivity makes that
 * worse rather than better — there is no re-render to fall back on, so the
 * nodes after the throw stay stale until something replaces them.
 *
 * Scopes already form the tree an error needs to travel, so a boundary is not
 * a new structure: it is a scope that declares itself one, and an error walks
 * the parent chain until it finds the first. What that boundary does with it
 * is its own decision — return and the error is swallowed, throw and it
 * continues up to the next boundary.
 *
 * Boundaries and owners live in weak maps rather than in fields on `Scope`. A
 * field would be paid for by every effect, which is what a list row is made
 * of, and both are rare: nothing in here is read until something has already
 * gone wrong.
 */

import type { Scope } from './effect.js';

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

/**
 * What a boundary does with an error from somewhere below it.
 *
 * It is handed the error and the scope that produced it — not the boundary's
 * own scope, which it already knows. Returning swallows the error; throwing
 * sends that error, or a different one, to the boundary above. Replacing the
 * subtree with a fallback is something the handler arranges before it returns,
 * and belongs to the layer that owns DOM rather than to this one.
 */
export type ErrorHandler = (error: unknown, scope: Scope) => void;

interface Boundary {
  handler: ErrorHandler;
  /**
   * True for the span of its handler, so an error thrown while recovering goes
   * to the boundary above instead of back to the boundary that is mid-recovery.
   */
  handling: boolean;
}

const boundaries = new WeakMap<Scope, Boundary>();

/**
 * @internal Declare a scope a boundary. `onError` is the public spelling.
 *
 * One handler per scope: a second declaration replaces the first, which is why
 * the component layer and `errorBoundary` each take a scope of their own
 * rather than sharing whatever was current.
 */
export function declareBoundary(scope: Scope, handler: ErrorHandler): void {
  boundaries.set(scope, { handler, handling: false });
}

// ---------------------------------------------------------------------------
// Owners
// ---------------------------------------------------------------------------

/**
 * What created a scope, for a report to name.
 *
 * The reactive core has no idea what a component is; it only knows that a
 * scope may know what made it. The component layer fills this in on the scope
 * it opens per instance, which is what lets an error raised five effects deep
 * still be reported against the component whose template built them.
 */
export interface ScopeOwner {
  /** The component instance. */
  readonly component: unknown;
  /** Read only when a report is actually made — peeking every prop is not free. */
  readonly props: () => Record<string, unknown>;
}

const owners = new WeakMap<Scope, ScopeOwner>();

/** @internal Called once per component instance, on the scope it owns. */
export function attachOwner(scope: Scope, owner: ScopeOwner): void {
  owners.set(scope, owner);
}

function ownerOf(scope: Scope | null): ScopeOwner | undefined {
  for (let at = scope; at !== null; at = at.parent) {
    const owner = owners.get(at);
    if (owner !== undefined) return owner;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The global hook
// ---------------------------------------------------------------------------

export interface ErrorReport {
  readonly error: unknown;
  /** The scope that produced it. */
  readonly scope: Scope | null;
  /** The nearest component above that scope, or null outside one. */
  readonly component: unknown;
  /** That component's props, as it currently holds them. */
  readonly props: Record<string, unknown> | null;
  /**
   * Which write woke the failing effect, phrased for a message. Only a
   * development build knows this; a production one reports null.
   */
  readonly cause: string | null;
  /** Whether a boundary took responsibility for it. */
  readonly handled: boolean;
}

export type ErrorReporter = (report: ErrorReport) => void;

let reporter: ErrorReporter | null = null;

/**
 * Send every error that enters the channel to the application's own reporting,
 * handled or not — a boundary that swallowed one still had something go wrong
 * behind it, and that is exactly what a production report is for.
 *
 * Installing a reporter takes over from the console, because an application
 * that has said where its errors go should not have them appear twice. Pass
 * null to hand the console back.
 */
export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

// ---------------------------------------------------------------------------
// The channel
// ---------------------------------------------------------------------------

/**
 * Put an error into the channel: it travels up from `scope` to the nearest
 * boundary, and reaches the reporter — or, with nothing to take it, the
 * console — on the way out.
 *
 * The effect system calls this for everything it catches. It is exported
 * because that is not everything that can fail: `onMount` runs in a microtask
 * of its own, long after the call that created it has returned, and an error
 * there belongs to the same component as an error in one of its effects.
 *
 * `scope` is where the error was thrown, which is where the walk starts and
 * what a handler is told about. A rethrown error carries on from the boundary
 * that rethrew it rather than from the top, so a chain of boundaries is walked
 * once rather than once per link. `cause` names the write that woke the
 * failing effect and is only ever known to a development build.
 */
export function raiseError(error: unknown, scope: Scope | null, cause?: string | null): void {
  let thrown = error;

  for (let at = scope; at !== null; at = at.parent) {
    const boundary = boundaries.get(at);
    if (boundary === undefined || boundary.handling) continue;

    boundary.handling = true;
    try {
      boundary.handler(thrown, scope!);
      report(thrown, scope, cause, true);
      return;
    } catch (rethrown) {
      thrown = rethrown;
    } finally {
      boundary.handling = false;
    }
  }

  report(thrown, scope, cause, false);
}

function report(
  error: unknown,
  scope: Scope | null,
  cause: string | null | undefined,
  handled: boolean,
): void {
  const sink = reporter;
  if (sink !== null) {
    try {
      const owner = ownerOf(scope);
      sink({
        error,
        scope,
        component: owner ? owner.component : null,
        props: owner ? owner.props() : null,
        cause: cause ?? null,
        handled,
      });
      return;
    } catch {
      // A reporter cannot report itself, and letting it out of here would take
      // the flush down and lose the original error along with it. Falling
      // through means the error that mattered still reaches the console.
    }
  } else if (handled) {
    // A boundary dealt with it and nobody asked to hear about it.
    return;
  }

  if (typeof console !== 'undefined') {
    console.error('[volt] Uncaught error in effect' + (cause ? ' — ' + cause : '') + ':', error);
  }
}
