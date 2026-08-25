/**
 * Streaming server rendering: the shell now, the slow parts as they land.
 *
 * The difference between this and `renderToString` is not throughput, it is
 * what the user is looking at while a query runs. A buffered render holds
 * every byte until the slowest thing on the page has answered, so a shell that
 * was ready in two milliseconds is delivered in four hundred. This hands the
 * shell over the moment the synchronous walk has written it, and sends each
 * boundary afterwards as a chunk of its own.
 *
 * That trade has a price, and §3.5 of `docs/design/ssr.md` is where it is
 * named: once the first byte is out, the status line is gone. A render that
 * throws can no longer answer 500 — it can only write something else into a
 * response that has already started — which is why streaming waited for the
 * error channel, and why `fallback` here is markup rather than a status.
 *
 * Three mechanisms, and each is the smallest that works:
 *
 *   - **A boundary is a value in a hole.** `boundary(work, options)` returns a
 *     branded object placed where a dynamic child goes, so no compiler support
 *     is needed to declare one and nothing about the emitted static markup
 *     changes. The writer meets it in `child` and hands it straight back here.
 *   - **The work starts on the data lane.** `dataEffect` is deferred, which is
 *     what lets a boundary declared in a class field see the props assigned
 *     after construction, and it is drained on the server where a user effect
 *     is not — the lane the design record adds for exactly this.
 *   - **Late content is a `<template>` plus a record.** The bytes go into an
 *     inert element and `self.__VOLT__.push([op, …])` says what to do with
 *     them, appended to an array a boot line creates. An array that a runtime
 *     later swaps for something that executes is the only shape that composes
 *     with out-of-order flush: a boundary resolving before the runtime has
 *     loaded, or after hydration has finished, has somewhere to put its record
 *     either way.
 *
 * Out-of-order is the reason the tail loop waits on a wake channel rather than
 * on `Promise.allSettled` of a round. Waiting per round would deliver a fast
 * boundary and a slow one together, at the slow one's expense, which is the
 * cost streaming exists to avoid — so a boundary is queued the instant its own
 * work settles and written in that order, whatever order it was declared in.
 *
 * What is **not** here yet is the other end of the wire. Nothing in the client
 * runtime reads `__VOLT__` — the records and the `<template>`s are written and
 * sit there inert — so a streamed page today is a page that arrives in pieces
 * and is taken over as a whole once `$V` learns to drain the queue. That is
 * deliberate rather than unfinished: the records are the format the design
 * record specifies, and a boundary resolving before any runtime has loaded has
 * to be able to leave its record behind either way. Until the drain lands, a
 * boundary's content is visible to a reader without JavaScript only if the
 * fallback said something useful.
 */

import {
  createRequestScope,
  createRoot,
  currentRequest,
  dataEffect,
  flushSync,
  onError,
  requestState,
  runInRequest,
  type Dispose,
} from '@voltdev/reactivity';

import { renderComponent, requestStyles, type ComponentType } from './component.js';
import {
  BOUNDARY,
  MarkupWriter,
  escapeAttr,
  escapeJsonForScript,
  stateJson,
  stateScript,
  type BoundaryClaim,
  type PortalMarkup,
  type RenderOptions,
  type StateScriptOptions,
} from './server.js';
import { registeredState } from './state.js';

/**
 * The global the records are appended to.
 *
 * `self` rather than `window`, because a page may run this in a worker, and
 * `self.X = self.X || []` rather than a declaration because the boot line and
 * the client runtime race: whichever arrives first creates the array, and the
 * other finds it.
 */
const QUEUE = '__VOLT__';

/** The attribute a late chunk's `<template>` carries its boundary id on. */
const BOUNDARY_ATTRIBUTE = 'data-volt-b';

/** The attribute a relocatable portal's `<template>` carries its target on. */
const PORTAL_ATTRIBUTE = 'data-volt-portal';

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

/** What a boundary writes, and when. */
export interface BoundaryOptions<T> {
  /**
   * Written into the shell, where the answer will go.
   *
   * Optional, and an omitted one is a boundary that shows nothing until it
   * resolves — which is the right choice for content below the fold and the
   * wrong one for content the layout depends on, since the page will jump.
   */
  fallback?: (out: MarkupWriter) => void;
  /** Written into the stream once the work settles. */
  content: (value: T, out: MarkupWriter) => void;
  /**
   * Written instead when the work rejects, or when `content` itself throws.
   *
   * This is the half of the four-tier failure story that only streaming has to
   * answer: the response has already started, so a rejection here cannot
   * become a status. Without one the boundary writes nothing at all and the
   * fallback in the shell is what the reader is left with.
   */
  failed?: (error: unknown, out: MarkupWriter) => void;
}

/**
 * A region of the page whose content is not ready when the shell is.
 *
 * Placed in a dynamic-child position and nowhere else. The brand is what the
 * writer recognises, and the writer only sees the value itself where the
 * compiler emitted `child` — which it does for a hole with siblings, and does
 * not for the one case where an element's children are all text: there it
 * folds `toDisplayString` into the call and the writer is handed a string.
 *
 * That case is a mistake nothing else can catch, so it is made to fail loudly
 * rather than quietly: an object with one symbol key serializes to `{}`, and a
 * page that shows `{}` where a product listing belongs is a bug found by a
 * customer. `toJSON` and `toString` are the two doors `toDisplayString` goes
 * through, and both of them are shut.
 */
export interface Boundary {
  readonly [BOUNDARY]: BoundaryClaim;
  /** Both throw; see above. Declared so the shut doors are part of the type. */
  toJSON(): never;
  toString(): never;
}

function misplaced(): never {
  throw new Error(
    '[volt] a boundary was written as text rather than as a child. An element whose ' +
      'children are all text is emitted as one write, so there is no hole for a late ' +
      'answer to land in — give the boundary an element sibling, as in ' +
      '`<div><span></span>{ body }</div>`.',
  );
}

/** One boundary, from declared to written. */
interface Waiting<T> {
  readonly work: () => T | PromiseLike<T>;
  readonly options: BoundaryOptions<T>;
  /** Assigned when the placeholder is written, which is when the id exists. */
  id: string;
  state: 'waiting' | 'done' | 'failed';
  value: T | undefined;
  error: unknown;
  started: boolean;
}

/**
 * Declare an async boundary.
 *
 * `work` is called once, from the data lane, and never again: this is a server
 * render, so there is no second answer to re-render for. It is called at all
 * only if the boundary reaches the page — a boundary built and then not placed
 * starts no request, which is what keeps a conditional branch from fetching
 * for a side of the page nobody is going to see.
 *
 * Outside a streaming render there is nowhere to put a late answer, so the
 * fallback is written and the work never starts. That is what `renderToString`
 * and `renderToStaticMarkup` do with one, and it is deliberate: a buffered
 * render that quietly awaited boundaries would be a page whose time-to-first-
 * byte silently depended on whether anyone had streamed it.
 */
export function boundary<T>(
  work: () => T | PromiseLike<T>,
  options: BoundaryOptions<T>,
): Boundary {
  const waiting: Waiting<T> = {
    work,
    options,
    id: '',
    state: 'waiting',
    value: undefined,
    error: null,
    started: false,
  };

  return {
    toJSON: misplaced,
    toString: misplaced,
    [BOUNDARY]: (out: MarkupWriter): void => {
      const collector = collectorOf();
      if (collector === null) {
        options.fallback?.(out);
        return;
      }
      collector.open(waiting as Waiting<unknown>, out);
    },
  };
}

/**
 * The slot a streaming render keeps its collector in.
 *
 * Per request rather than per module, for the reason every other slot in this
 * codebase is: one process renders many pages at once, and a module-level
 * collector would file request A's boundary into request B's stream. The
 * quiescence rule keeps a *synchronous* walk safe on its own; this keeps the
 * asynchronous tail safe too, since a boundary claimed inside a late chunk is
 * claimed long after some other request has been current.
 */
const COLLECTOR = Symbol('volt.stream.collector');

function collectorOf(): Collector | null {
  // `requestState` falls back to a process-wide store when no request is
  // current, which for this slot would be a browser reading a server's
  // collector. There is no request outside a server render, and no collector
  // either, so the question is answered before the slot is consulted.
  if (currentRequest() === null) return null;
  return requestState<Collector | null>(COLLECTOR, () => null);
}

/**
 * The boundaries one stream is waiting on, and the channel that wakes it.
 *
 * The wake channel is a promise that is replaced every time it resolves, and
 * the tail only ever waits on it after checking — in the same synchronous
 * block — that there is still something to wait for. That ordering is the
 * whole correctness argument against a lost wakeup: nothing can settle between
 * the check and the wait, because nothing else runs between them.
 */
class Collector {
  private nextId = 0;
  /** Boundaries claimed and not yet written out. */
  outstanding = 0;
  /** Settled and unwritten, in the order they settled — not the declared one. */
  readonly ready: Waiting<unknown>[] = [];
  private wake: (() => void) | null = null;
  private waiting: Promise<void> | null = null;

  open(record: Waiting<unknown>, out: MarkupWriter): void {
    record.id = String(this.nextId++);
    this.outstanding++;

    // Delimiters of its own rather than the hole's: the compiler elides
    // `openHole`/`closeHole` for a lone dynamic child, and a boundary needs
    // somewhere to put its content whether or not that elision happened.
    out.comment(`v${record.id}`);
    record.options.fallback?.(out);
    out.comment(`/v${record.id}`);

    dataEffect(() => {
      // Deferred by the lane, so this runs in the first flush rather than
      // during the walk — and guarded, because a boundary whose work reads a
      // signal would otherwise start a second request when that signal moved.
      if (record.started) return;
      record.started = true;
      let started: unknown;
      try {
        started = record.work();
      } catch (error) {
        this.settle(record, 'failed', undefined, error);
        return;
      }
      Promise.resolve(started).then(
        (value) => this.settle(record, 'done', value, null),
        (error: unknown) => this.settle(record, 'failed', undefined, error),
      );
    });
  }

  private settle(
    record: Waiting<unknown>,
    state: 'done' | 'failed',
    value: unknown,
    error: unknown,
  ): void {
    record.state = state;
    record.value = value;
    record.error = error;
    this.ready.push(record);
    this.bump();
  }

  /** Wake the tail, if it is waiting. */
  bump(): void {
    const wake = this.wake;
    this.waiting = null;
    this.wake = null;
    wake?.();
  }

  /** Resolves the next time anything settles. */
  idle(): Promise<void> {
    if (this.waiting === null) {
      this.waiting = new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
    return this.waiting;
  }
}

// ---------------------------------------------------------------------------
// The stream
// ---------------------------------------------------------------------------

export interface StreamOptions extends RenderOptions, StateScriptOptions {
  /**
   * Markup for a failure the page cannot answer with a status.
   *
   * Reached when something fails after the shell has flushed and no boundary
   * took responsibility for it — an effect that threw on a later flush, a
   * style that cannot be written. The bytes are appended and the stream is
   * closed; there is no way to retract what has already been sent, so the
   * honest options are to say something and stop, or to stop silently.
   *
   * The default is an HTML comment, which is inert, survives a minifier and
   * is visible to anyone reading the response — the failure has already been
   * reported through the error channel, and putting an exception message into
   * a page is how internals reach a stranger's browser.
   */
  fallback?: (error: unknown) => string;
}

function defaultFallback(): string {
  return '<!--[volt] the render failed after the response had started-->';
}

/**
 * Render a component to a stream, flushing the shell as soon as it is written.
 *
 * The shell is the synchronous walk plus one flush: every render effect and
 * every data effect the page created, drained to quiescence inside the
 * request. Whatever is in the writer at that point is enqueued immediately —
 * before a single boundary's promise is awaited — which is the property this
 * whole module exists for, and the one worth testing first.
 *
 * What arrives after it, in the order it settles: one chunk per boundary,
 * carrying any styles the components in it declared, the content in an inert
 * `<template>`, and the record that says where it goes. Then, once nothing is
 * outstanding, the state that changed after the shell was written and whatever
 * `:portal` collected.
 *
 * A failure *before* the first byte still errors the stream rather than
 * writing a fallback, because at that moment the caller has sent nothing and
 * can still answer 500. After it, see `fallback`.
 */
export function renderToStream(
  component: ComponentType<unknown>,
  options: StreamOptions = {},
): ReadableStream<Uint8Array> {
  if (!__VOLT_SERVER__) {
    throw new Error(
      '[volt] renderToStream needs a server build. Templates are compiled for one side or ' +
        'the other, and a client build emits render functions that clone markup rather than ' +
        'write it — @voltdev/vite-plugin decides this per environment.',
    );
  }

  const encoder = new TextEncoder();
  const nonce = options.nonce === undefined ? '' : ` nonce="${escapeAttr(options.nonce)}"`;
  const collector = new Collector();
  const scope = createRequestScope();
  const writer = new MarkupWriter();
  const portals: PortalMarkup[] = [];
  /** Data the request registered that this stream has yet to see settle. */
  const live = new Set<Promise<unknown>>();

  let dispose: Dispose = () => {};
  let shellFlushed = false;
  let stopped = false;
  let booted = false;
  /** How many of the request's collected styles have already been written. */
  let stylesWritten = 0;
  let shellState: Record<string, unknown> = {};
  /** A failure raised through the error channel before the shell went out. */
  let shellError: { error: unknown } | null = null;
  let sink: ReadableStreamDefaultController<Uint8Array> | null = null;
  /** Assigned once the controller exists; see `start`. */
  let failStream: (error: unknown) => void = () => {};

  const send = (html: string): void => {
    if (html === '' || sink === null) return;
    sink.enqueue(encoder.encode(html));
  };

  /** One `self.__VOLT__.push([op, …])`, with the boot line if it is the first. */
  const record = (json: string): string => {
    const boot = booted ? '' : `<script${nonce}>self.${QUEUE}=self.${QUEUE}||[]</script>`;
    booted = true;
    return `${boot}<script${nonce}>self.${QUEUE}.push(${json})</script>`;
  };

  /**
   * The styles collected since the last chunk.
   *
   * A streaming page cannot put its styles in a `<head>` that has already been
   * sent, so each chunk carries whatever the components in it declared. The
   * map is insertion-ordered and only ever grows, so a count is a complete
   * record of what has gone out.
   */
  const styles = (): string => {
    const collected = runInRequest(scope, requestStyles);
    if (collected.size === stylesWritten) return '';
    let html = '';
    let index = 0;
    for (const [selector, css] of collected) {
      if (index++ < stylesWritten) continue;
      // Style content is raw text: an entity in it is not decoded, so there is
      // no escaping that both keeps the CSS working and keeps `</style` from
      // ending the element. Refused rather than written, exactly as `rawText`
      // refuses the same shape.
      if (css.toLowerCase().includes('</style')) {
        throw new Error(
          `[volt] the styles for <${selector}> contain "</style", which ends the element ` +
            'rather than appearing inside it. Raw text cannot be escaped, so the stylesheet ' +
            'has to be written without it.',
        );
      }
      html += `<style data-volt="${escapeAttr(selector)}">${css}</style>`;
    }
    stylesWritten = collected.size;
    return html;
  };

  /** Everything a settled boundary contributes to the stream. */
  const chunkFor = (waiting: Waiting<unknown>): string => {
    // Written now, so it stops holding the stream open. Counted from the claim
    // rather than from the settle because the two are what the tail has to
    // tell apart: a boundary that has not answered keeps the response open,
    // and one that has answered and been written keeps nothing.
    collector.outstanding--;
    let out = new MarkupWriter();
    try {
      if (waiting.state === 'done') waiting.options.content(waiting.value, out);
      else waiting.options.failed?.(waiting.error, out);
    } catch (error) {
      // Half-written bytes are discarded with the writer they went into, which
      // is the one thing a buffered segment buys that a socket cannot: the
      // reader never sees the first half of a region that failed.
      waiting.state = 'failed';
      out = new MarkupWriter();
      try {
        waiting.options.failed?.(error, out);
      } catch {
        // A fallback that throws has nothing left to fall back to. The
        // boundary writes nothing and the shell's placeholder stands.
      }
    }
    for (const collected of out.portals()) portals.push(collected);
    const op = waiting.state === 'done' ? 'b' : 'e';
    return (
      styles() +
      `<template ${BOUNDARY_ATTRIBUTE}="${waiting.id}">${out.toString()}</template>` +
      record(`["${op}","${waiting.id}"]`)
    );
  };

  /** The state that moved after the shell was written, and where portals went. */
  const epilogue = (): string => {
    let html = styles();

    const now = runInRequest(scope, () =>
      Object.fromEntries([...registeredState()].map(([key, signal]) => [key, signal.get()])),
    );
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(now)) {
      // Identity, not equality: a signal holding an object that was mutated in
      // place is indistinguishable from one that was not, and re-sending every
      // object every time would make the increment as big as the payload.
      if (!Object.is(now[key], shellState[key])) changed[key] = now[key];
    }
    const json = stateJson(changed);
    if (json !== '') html += record(`["s",${json}]`);

    for (const collected of portals) {
      // A body target needs no instruction: the client's own `portal` appends
      // to the body, and content written last is content appended last, so the
      // two orders already agree. A selector target has to be moved, and until
      // it is it must not be rendered — which is what a `<template>` is.
      if (collected.target === null) {
        html += collected.html;
        continue;
      }
      html +=
        `<template ${PORTAL_ATTRIBUTE}="${escapeAttr(collected.target)}">` +
        `${collected.html}</template>` +
        record(`["p",${escapeJsonForScript(JSON.stringify(collected.target))}]`);
    }

    return html;
  };

  const finish = (): void => {
    if (stopped) return;
    stopped = true;
    runInRequest(scope, dispose);
    sink?.close();
    sink = null;
  };

  /**
   * Everything after the shell: wait, flush, write whatever settled.
   *
   * The wait is on the collector's channel rather than on this round's
   * promises, so a boundary that answers in ten milliseconds is written then,
   * even when the boundary declared above it takes a second. Ordering in the
   * stream is settle order; the records are what put it back into document
   * order on the client.
   */
  const tail = async (): Promise<void> => {
    for (;;) {
      let html = '';
      // Registered inside the request by whatever asked for it, drained here
      // so that a resource nobody declared a boundary for still holds the
      // stream open long enough for its state to be sent.
      for (const work of scope.pending) hold(work);
      scope.pending = [];
      runInRequest(scope, () => {
        while (collector.ready.length > 0) html += chunkFor(collector.ready.shift()!);
      });
      send(html);
      if (stopped) return;
      if (live.size === 0 && collector.outstanding === 0) break;
      // Nothing can settle between the check above and the wait below —
      // nothing else runs — so this cannot miss a wake it was told about.
      await collector.idle();
      if (stopped) return;
      runInRequest(scope, flushSync);
    }
    send(epilogue());
    finish();
  };

  function hold(work: Promise<unknown>): void {
    const held = Promise.allSettled([work]).then(() => {
      live.delete(held);
      collector.bump();
    });
    live.add(held);
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      sink = controller;
      failStream = (error: unknown) => {
        if (stopped) return;
        send(options.fallback ? options.fallback(error) : defaultFallback());
        finish();
      };

      try {
        runInRequest(scope, () => {
          requestState(COLLECTOR, () => collector);
          createRoot((disposeRoot) => {
            dispose = disposeRoot;
            onError((error) => {
              // Before the first byte this is still a 500 the caller can send;
              // after it, it is markup or it is nothing. The two are the same
              // failure and the response is what decides which answer exists.
              if (shellFlushed) failStream(error);
              else if (shellError === null) shellError = { error };
            });
            renderComponent(component, writer, options.props ?? null);
          });
          flushSync();
        });

        if (shellError !== null) throw shellError.error;

        shellState = runInRequest(scope, () =>
          Object.fromEntries([...registeredState()].map(([key, signal]) => [key, signal.get()])),
        );
        for (const collected of writer.portals()) portals.push(collected);
        send(styles() + writer.toString() + stateScript(shellState, options));
        shellFlushed = true;
      } catch (error) {
        // Nothing has been written, so the writer's bytes go with it and the
        // caller still has a status line to send.
        stopped = true;
        runInRequest(scope, dispose);
        sink = null;
        controller.error(error);
        return;
      }

      // Deliberately not awaited: `start` resolving is what lets the first read
      // through, and holding it until the last boundary answers would buffer
      // the shell behind exactly the query streaming exists to get out from
      // under.
      void tail().catch(failStream);
    },
    cancel() {
      // The reader has gone. Everything still outstanding is work for a
      // response nobody is reading, and the effects behind it are a leak per
      // abandoned request.
      if (stopped) return;
      stopped = true;
      runInRequest(scope, dispose);
      sink = null;
    },
  });
}
