/**
 * Resource — the state of one remote call, owned properly.
 *
 * Six things in this library need the same shape and get it wrong in the same
 * way: an async combobox search, a grid fetching rows from a server, a tree
 * loading children on expand, an infinite list, an upload, and a streamed
 * reply. Each needs a status, the data, the error, a way to ask again, a way
 * to write the answer locally before the server confirms it, and — the part
 * that is nearly always missing — a guarantee that a slow earlier response
 * cannot overwrite a fast later one.
 *
 * That last guarantee is the reason this is shared. Type "ca" then "cat" in a
 * combobox and two requests are in the air; if "ca" answers second, its
 * results land under the word "cat" and the list is wrong in a way that looks
 * like a backend bug. Aborting the first request is not enough — abort is a
 * request to stop, not a promise that nothing arrives, and a fetcher reading
 * from cache, from a service worker, or simply ignoring the signal will
 * resolve anyway. So every write is checked against a generation counter and a
 * stale one is dropped before it can touch a signal. The `AbortController` is
 * still there, because stopping work nobody wants is worth doing; it is just
 * not what makes this correct.
 *
 * Headless like the rest: it owns state and returns prop objects to spread
 * onto whatever markup the consumer writes. Nothing here renders.
 *
 *   class Search {
 *     query = new Signal.State('');
 *     results = createResource(
 *       async ({ source, signal }) => {
 *         const response = await fetch(`/search?q=${source}`, { signal });
 *         return (await response.json()) as Item[];
 *       },
 *       {
 *         source: () => this.query.get(),
 *         enabled: () => this.query.get().length > 1,
 *         debounce: 200,
 *         retry: 2,
 *       },
 *     );
 *   }
 *
 *   <input :value="query.get()" :input="query.set($event.target.value)">
 *   <p :spread="results.statusProps()">{ results.announcement() }</p>
 *   <p :if="results.isError()" :spread="results.errorProps()">{ results.errorMessage() }</p>
 *   <ul :spread="results.contentProps()">
 *     <li :for="item of results.data() ?? []" :key="item.id">{ item.name }</li>
 *   </ul>
 *
 * Three rules are worth knowing before reading the options:
 *
 *   - **`debounce` and `throttle` apply to the dependency, not to calls.**
 *     They exist for search-as-you-type, where the input changes far faster
 *     than a server can answer. `refetch()` is an explicit act — a Retry
 *     button, a pull to refresh — and runs at once; a Retry that appears to do
 *     nothing for 300ms reads as broken.
 *   - **Data outlives a failure.** A refetch that fails leaves the last good
 *     data in place and sets the error beside it, because a list that empties
 *     itself on a dropped connection loses work the user could still see. Call
 *     `mutate(undefined)` to clear it deliberately.
 *   - **A fetcher can answer more than once.** `request.push()` writes a
 *     partial result without ending the request, which is what a streamed
 *     reply and an upload's progress both need. `mutate()` cannot serve that
 *     purpose: it means "the answer is known now", so it abandons the request.
 */

import { Signal, batch, currentRequest, dataEffect, onCleanup, trackRequestData } from '@voltdev/core';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

/**
 * Where a resource is.
 *
 * `success` and `error` describe the last completed request, not the data:
 * data from an earlier success survives a later failure, so `error` with data
 * present is an ordinary state and not a contradiction.
 */
export type ResourceStatus = 'idle' | 'loading' | 'success' | 'error';

/** Given what is there now, what should be there instead. */
export type ResourceUpdater<T> = (previous: T | undefined) => T | undefined;

/** Everything the fetcher is told about, and can do to, the call it is making. */
export interface ResourceRequest<T, S> {
  /** The dependency's value when this request started. */
  readonly source: S;
  /**
   * Aborted when this request is superseded, cancelled, mutated over, or its
   * scope is disposed. Pass it to `fetch`.
   */
  readonly signal: AbortSignal;
  /** 0 on the first try, then 1, 2, … for each retry. */
  readonly attempt: number;
  /**
   * The last data that landed — earlier responses, mutations and this
   * request's own pushes. This is what makes an infinite list a one-liner:
   * return `[...previous ?? [], ...page]`.
   *
   * On a retry it therefore still holds whatever the failed attempt managed to
   * push, which a resumable stream wants and a restarting one does not;
   * `attempt` is how you tell the two apart.
   */
  readonly previous: T | undefined;
  /**
   * Publish a partial result without ending the request: a streamed chunk, an
   * upload's byte count, the first page of a paged read. The status stays
   * `loading`.
   *
   * Dropped silently once this request is no longer the newest, so a stream
   * the user has moved on from cannot keep writing over its replacement.
   *
   * A function is treated as an updater, so a `T` that is itself a function
   * type must be wrapped: `push(() => fn)`.
   */
  push(next: T | ResourceUpdater<T>): void;
}

export type ResourceFetcher<T, S> = (request: ResourceRequest<T, S>) => T | Promise<T>;

/**
 * Every string this can put in front of a user.
 *
 * All of them are overridable because the library is localised later, and a
 * hard-coded English message is not something a consumer can work around.
 */
export interface ResourceLabels {
  /** Announced while the first attempt is in flight. Default `Loading…`. */
  loading?: string;
  /** Announced while a retry is in flight. Default `Retrying…`. */
  retrying?: string;
  /**
   * Announced when data arrives. Default `` — silence.
   *
   * Search-as-you-type would otherwise say "Loaded" after every keystroke,
   * over the top of the result count the combobox itself announces. A resource
   * whose success is an event in its own right — an upload finishing — should
   * set this.
   */
  success?: string;
  /**
   * Shown by `errorMessage()`. Default `Something went wrong.`
   *
   * The function form receives the thrown value, for a consumer who maps
   * status codes to sentences. The default deliberately does not read the
   * error's own message: it is written for whoever wrote the server, and
   * routinely names tables, hosts and stack frames.
   */
  error?: string | ((error: unknown) => string);
}

export interface ResourceOptions<T, S> {
  /**
   * The inputs. A change here refetches, subject to `debounce`, `throttle` and
   * `equals`. Leave it out for a resource that only ever runs on demand.
   */
  source?: () => S;
  /**
   * Whether two source values mean the same request. Default `Object.is`,
   * which is right for a string or a number and wrong for the object literal a
   * derived source usually builds — `{ page, filter }` is a new object every
   * read, and without an `equals` every unrelated render refetches.
   */
  equals?: (a: S, b: S) => boolean;
  /**
   * Gate on the source being worth a request: a query long enough to search
   * for, a tree node that is actually expanded. Default true.
   *
   * Turning this off aborts anything in flight and forgets the request, so
   * turning it back on asks again rather than waiting for an answer that was
   * cancelled. It gates the automatic fetches only — `refetch()` is explicit
   * and runs either way.
   */
  enabled?: () => boolean;

  /**
   * Data to start from — a server-rendered payload, a cached page. The
   * resource starts in `success` with it, since a template branching on status
   * would otherwise show a spinner over data it already has.
   *
   * Ignored when `data` is supplied; that signal already holds the truth.
   */
  initialData?: T;
  /**
   * Supply a signal to own the data from outside — a store shared with a grid,
   * or a cache that outlives this component. Without one the resource owns it.
   */
  data?: Signal.State<T | undefined>;
  /** Likewise for the status, for a shell that shows one spinner for many resources. */
  status?: Signal.State<ResourceStatus>;

  /**
   * Fetch once as soon as this is created. Default true.
   *
   * With it off nothing goes out until the source changes or `refetch()` is
   * called — which is what a form's submit-driven resource wants, and what a
   * resource hydrating from `initialData` wants until something invalidates it.
   */
  immediate?: boolean;

  /**
   * Wait this many ms of quiet before fetching a changed source. Default 0.
   *
   * The cost is exactly the delay: every search is that much later, including
   * the one where the user typed three characters and stopped. It buys back
   * every request in between.
   */
  debounce?: number;
  /**
   * Fetch at most once per this many ms. Default 0.
   *
   * Unlike `debounce` the first change goes out immediately and the last one
   * is never dropped, only delayed to the end of the window — so a user who
   * types steadily sees results throughout rather than only when they pause.
   * The two combine: the wait is whichever is longer.
   */
  throttle?: number;

  /**
   * How many times to try again after a failure. Default 0.
   *
   * Zero, because retrying is not free and not always wanted: a search whose
   * user has already typed something else does not want two more attempts at
   * the old query, and a POST that may have half-succeeded must not be
   * repeated by a library that cannot know it was a POST.
   */
  retry?: number;
  /** Milliseconds before retry `attempt` (1 for the first). Default `exponentialBackoff`. */
  retryDelay?: (attempt: number, error: unknown) => number;
  /**
   * Whether this failure is worth another attempt. Default: all of them.
   *
   * The usual implementation is "not the ones that will fail identically" —
   * a 404 or a 422 is a fact about the request, and three more of them only
   * make the user wait longer for the same answer.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;

  labels?: ResourceLabels;

  onSuccess?: (data: T) => void;
  /** Only for a failure that is final: retries that succeed never reach here. */
  onError?: (error: unknown) => void;
}

export interface ResourceProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface Resource<T> {
  status(): ResourceStatus;
  /** The last data that landed. Survives a later failure — see `mutate` to clear it. */
  data(): T | undefined;
  /** The last failure, as thrown. `unknown`, because a `throw` can be anything. */
  error(): unknown;
  /**
   * The retry number of the attempt in flight, or of the last one to finish.
   * 0 on a first try. For "Attempt 2 of 3".
   */
  attempt(): number;
  isLoading(): boolean;
  isError(): boolean;

  /** What the polite live region should be saying right now, or ''. */
  announcement(): string;
  /** The error in a sentence a user can read, or '' when there is no error. */
  errorMessage(): string;

  /**
   * Fetch now, whatever the timers and `enabled` say. Resolves with the data,
   * or `undefined` if it failed or was superseded.
   *
   * It never rejects: `refetch()` is called from templates and event handlers
   * where nothing awaits it, and a rejection there is an unhandled one. The
   * failure is in `error()`, which is where a UI reads it from anyway.
   */
  refetch(): Promise<T | undefined>;

  /**
   * Write the data locally — an optimistic update, an edit the server has yet
   * to confirm.
   *
   * Anything in flight is aborted and its response discarded: a mutation says
   * the answer is known now, and a response already on its way carries the
   * value the user just changed. So the order in the usual flow matters —
   * mutate, save, then `refetch()` to reconcile. To add to the data *during* a
   * request, which is a different thing, use `request.push()`.
   *
   * A function is treated as an updater. A resource whose `T` is itself a
   * function type must therefore wrap it: `mutate(() => fn)`.
   */
  mutate(next: T | undefined | ResourceUpdater<T>): void;

  /**
   * Cancel what is in flight and anything queued, leaving the data alone.
   * Loading falls back to `success` if there is data and `idle` if there is
   * not, because a spinner that stays up after a cancel is the bug this
   * prevents.
   */
  abort(): void;

  /** For the polite live region carrying `announcement()`. */
  statusProps(): ResourceProps;
  /** For the element whose contents are being replaced — the list, the grid body. */
  contentProps(): ResourceProps;
  /** For the element carrying `errorMessage()`. */
  errorProps(): ResourceProps;
}

const DEFAULT_RETRY_BASE = 300;
const DEFAULT_RETRY_CAP = 30_000;

/**
 * Doubling backoff with jitter: 300ms, 600ms, 1.2s, … capped at 30s, each
 * multiplied by a random factor between a half and one.
 *
 * The jitter is not decoration. Failures are correlated — a server that falls
 * over drops every client at once — and a fixed schedule has all of them
 * return together, at the moment it is least able to cope. The cost is that
 * the delay is not reproducible; a test that needs an exact one passes its own
 * `retryDelay`.
 */
export function exponentialBackoff(
  attempt: number,
  base = DEFAULT_RETRY_BASE,
  cap = DEFAULT_RETRY_CAP,
): number {
  const capped = Math.min(base * 2 ** Math.max(0, attempt - 1), cap);
  return capped / 2 + Math.random() * (capped / 2);
}

/**
 * Whether a value handed to `mutate` or `push` is an updater.
 *
 * There is no way to tell an updater from a `T` that happens to be a function,
 * so this picks the common case and both call sites document the wrap.
 */
function isUpdater<T>(next: T | undefined | ResourceUpdater<T>): next is ResourceUpdater<T> {
  return typeof next === 'function';
}

export function createResource<T, S = undefined>(
  fetcher: ResourceFetcher<T, S>,
  options: ResourceOptions<T, S> = {},
): Resource<T> {
  const data = options.data ?? new Signal.State<T | undefined>(options.initialData);
  const status =
    options.status ??
    new Signal.State<ResourceStatus>(untrack(() => data.get()) === undefined ? 'idle' : 'success');
  const failure = new Signal.State<unknown>(undefined);
  const attempt = new Signal.State(0);

  const labels = options.labels ?? {};
  const debounce = Math.max(0, options.debounce ?? 0);
  const throttle = Math.max(0, options.throttle ?? 0);
  const retries = Math.max(0, options.retry ?? 0);
  const sameSource = options.equals ?? Object.is;
  // Wrapped rather than passed straight through: `exponentialBackoff` takes a
  // base and a cap where `retryDelay` passes the error, and the two would line
  // up silently.
  const retryDelay = options.retryDelay ?? ((n: number) => exponentialBackoff(n));

  /**
   * Which request is allowed to write. Bumped by every new request and by
   * everything that invalidates one, so a write only has to prove it is still
   * the newest — which is the check `signal.aborted` cannot make, because an
   * abort a fetcher ignored leaves a perfectly resolved promise.
   */
  let generation = 0;
  let controller: AbortController | null = null;
  /** The debounce or throttle wait, holding the run below. */
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: { source: S } | null = null;
  /** Cancels a retry backoff, resolving its wait as "do not continue". */
  let stopWaiting: (() => void) | null = null;
  /** When the last request actually went out, for throttling. */
  let lastStart = 0;
  let disposed = false;

  /** Reading the resource's own state must never subscribe anything to it. */
  const peek = <V>(signal: Signal.State<V>): V => untrack(() => signal.get());

  // With no dependency accessor there is nothing to depend on and `S` defaults
  // to `undefined`, which is then what the fetcher is handed.
  const readSource = (): S => (options.source ? options.source() : (undefined as S));

  /**
   * Stop everything and invalidate anything still coming.
   *
   * The generation bump is the load-bearing half; the abort is a courtesy to
   * the network. `reason` is carried on `signal.reason`, where it is the only
   * clue a consumer debugging a cancelled request has.
   */
  const stop = (reason: string): void => {
    generation += 1;

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    queued = null;

    const waiting = stopWaiting;
    stopWaiting = null;
    waiting?.();

    // A DOMException named AbortError, rather than a bare string, because that
    // is what `fetch` rejects with when it aborts itself — so consumer code
    // that checks `err.name === 'AbortError'` keeps working when the abort
    // comes from here instead.
    controller?.abort(new DOMException(reason, 'AbortError'));
    controller = null;
  };

  /** A cancellable wait. Resolves false when something cut it short. */
  const wait = (ms: number): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      const handle = setTimeout(() => {
        stopWaiting = null;
        resolve(true);
      }, ms);
      stopWaiting = () => {
        clearTimeout(handle);
        resolve(false);
      };
    });

  const execute = async (source: S): Promise<T | undefined> => {
    stop('Superseded by a newer request');
    if (disposed) return undefined;

    const id = generation;
    lastStart = Date.now();
    /**
     * Whether a server render is waiting on this.
     *
     * Read here rather than where it is used, because this is the last line
     * that still runs inside the request's own flush: nothing observes a
     * request across an `await`, by design.
     */
    const awaited = currentRequest() !== null;

    /** True only while this call is still the one whose answer anyone wants. */
    const current = (): boolean => id === generation && !disposed;

    const push = (next: T | ResourceUpdater<T>): void => {
      // A chunk from a stream that has been superseded. Dropped for the same
      // reason a whole response is: the newest request owns the data.
      if (!current()) return;
      data.set(isUpdater(next) ? next(peek(data)) : next);
    };

    for (let tries = 0; ; tries++) {
      const request = new AbortController();
      controller = request;

      batch(() => {
        // The error is cleared as the attempt starts, so a retry does not run
        // underneath the error message from the try before it.
        failure.set(undefined);
        attempt.set(tries);
        status.set('loading');
      });

      try {
        const value = await fetcher({
          source,
          signal: request.signal,
          attempt: tries,
          previous: peek(data),
          push,
        });

        // The whole point of the exercise: a response that is no longer the
        // newest is dropped here, resolved or not, aborted or not.
        if (!current()) return undefined;

        controller = null;
        batch(() => {
          data.set(value);
          failure.set(undefined);
          status.set('success');
        });
        options.onSuccess?.(value);
        return value;
      } catch (error) {
        if (!current()) return undefined;

        if (tries < retries && (options.shouldRetry?.(error, tries + 1) ?? true)) {
          // The schedule is the client's, exactly as the debounce below is: a
          // server render is already waiting on this inside `settleRequest`,
          // and seconds tuned to let a flaky phone connection recover are
          // seconds a response spends holding its socket open. The retry still
          // happens — it is only the wait between attempts that has no one to
          // benefit.
          const backoff = awaited ? 0 : retryDelay(tries + 1, error);
          // Cancellable, so a source change during it starts the new request
          // instead of queueing behind a wait for the old one.
          if (!(await wait(backoff))) return undefined;
          if (!current()) return undefined;
          continue;
        }

        controller = null;
        batch(() => {
          // The data is deliberately left alone: see the note at the top.
          failure.set(error);
          status.set('error');
        });
        options.onError?.(error);
        return undefined;
      }
    }
  };

  /** Run whatever the wait was holding, if it has not been invalidated since. */
  const runQueued = (): void => {
    const next = queued;
    queued = null;
    // Handed to the request rather than dropped: a server render has to wait
    // for what it started before it can write the answer into the markup. A
    // client build compiles that away and the promise goes unobserved, as it
    // always did — the resource writes its own state when it lands.
    if (next) trackRequestData(execute(next.source));
  };

  /**
   * Hold a source-driven run for as long as debounce and throttle ask.
   *
   * Only the latest source survives the wait: a run that was queued and then
   * superseded was for a query the user has already replaced.
   */
  const schedule = (source: S): void => {
    queued = { source };
    if (timer !== null) clearTimeout(timer);

    const sinceLast = throttle > 0 ? throttle - (Date.now() - lastStart) : 0;
    // Both are the client's: they exist to coalesce keystrokes, and a server
    // has none. A wait there is worse than useless — the request tracks the
    // fetches it started, and a fetch that has not started yet is one the
    // render finishes without, so the page ships with the data missing.
    const delay = currentRequest() ? 0 : Math.max(debounce, sinceLast);

    if (delay <= 0) {
      timer = null;
      runQueued();
      return;
    }

    timer = setTimeout(() => {
      timer = null;
      runQueued();
    }, delay);
  };

  /** The source the newest request was started for, or null for none. */
  let requested: { source: S } | null = null;
  let started = false;

  const abort = (): void => {
    const wasLoading = peek(status) === 'loading';
    stop('Aborted by the consumer');
    // Forgotten rather than remembered, so the same source can be asked for
    // again — a cancelled upload retried against the same file is the case.
    requested = null;
    // A spinner left up after a cancel is the bug this exists to prevent.
    if (wasLoading) status.set(peek(data) === undefined ? 'idle' : 'success');
  };

  /**
   * What `enabled` last said, so that only the change to false cancels.
   *
   * Seeded before the effect exists, because its first run is deferred: a
   * resource created disabled has nothing in flight to cancel, and a
   * `refetch()` issued in the meantime must survive that first run. Cancelling
   * on every run while disabled would also mean any unrelated re-render killed
   * an explicit refetch, which `enabled` is documented not to gate.
   */
  let wasEnabled = untrack(() => (options.enabled ? options.enabled() : true));

  // The data lane, not the user lane. The first run still has to be deferred —
  // a resource in a class field must see the props assigned after construction
  // — but a server drains data and never drains user work, so a resource
  // triggered from an `effect` would simply never fetch there.
  dataEffect(() => {
    const enabled = options.enabled ? options.enabled() : true;
    const source = readSource();

    // The dependencies above are tracked; everything below reads and writes
    // this resource's own state, and tracking that would make the effect
    // depend on what it writes.
    untrack(() => {
      const toggled = enabled !== wasEnabled;
      wasEnabled = enabled;

      if (!enabled) {
        if (toggled) abort();
        return;
      }

      if (!started) {
        started = true;
        requested = { source };
        if (options.immediate === false) return;
        schedule(source);
        return;
      }

      // Re-running for a source that is already in flight, or already
      // answered, would throw away a good response to ask the same question.
      if (requested && sameSource(source, requested.source)) return;

      requested = { source };
      schedule(source);
    });
  });

  onCleanup(() => {
    disposed = true;
    stop('The owning scope was disposed');
  });

  return {
    status: () => status.get(),
    data: () => data.get(),
    error: () => failure.get(),
    attempt: () => attempt.get(),
    isLoading: () => status.get() === 'loading',
    isError: () => status.get() === 'error',

    announcement: () => {
      switch (status.get()) {
        case 'loading':
          return attempt.get() > 0
            ? (labels.retrying ?? 'Retrying…')
            : (labels.loading ?? 'Loading…');
        case 'success':
          return labels.success ?? '';
        default:
          // Idle has nothing to say, and an error is announced by the alert
          // region instead — in both, a screen reader reads it out twice.
          return '';
      }
    },

    errorMessage: () => {
      if (status.get() !== 'error') return '';
      const label = labels.error ?? 'Something went wrong.';
      return typeof label === 'function' ? label(failure.get()) : label;
    },

    refetch: () => {
      const source = untrack(readSource);
      // Recorded, so the effect that is about to see this same source does not
      // treat it as a change and ask again.
      requested = { source };
      started = true;
      return execute(source);
    },

    mutate: (next) => {
      stop('Superseded by a local mutation');
      const value = isUpdater(next) ? next(peek(data)) : next;
      batch(() => {
        data.set(value);
        failure.set(undefined);
        // Clearing the data returns the resource to having none, rather than
        // claiming success at holding nothing.
        status.set(value === undefined ? 'idle' : 'success');
      });
    },

    abort,

    statusProps: () => ({
      // The role and the `aria-live` say the same thing on purpose: the role's
      // implicit value satisfies the specification, and some assistive
      // technology still honours only the explicit attribute.
      //
      // Render this element unconditionally. A live region only announces
      // changes to text inside a region that was already there, so one that
      // appears together with its message is a region that says nothing.
      role: 'status',
      'aria-live': 'polite',
      // The message is one sentence and replaces the last one; half of it is
      // worse than a repeat.
      'aria-atomic': 'true',
      // No `aria-busy` here. On a live region it means "do not announce me
      // yet", which would silence the very message this region carries — it
      // belongs on the content instead.
      'data-status': status.get(),
    }),

    contentProps: () => ({
      // Announce the list once it has settled rather than partway through
      // being rebuilt, which is what a screen reader would otherwise read.
      'aria-busy': status.get() === 'loading' ? 'true' : undefined,
      'data-status': status.get(),
    }),

    errorProps: () => ({
      // A failure interrupts: the user is most likely still looking at the
      // input that caused it, and a polite message waits behind whatever else
      // is queued. Two regions rather than one that changes politeness,
      // because changing `aria-live` on a live region is not reliably picked
      // up once the region exists.
      //
      // `role="alert"` is the one live region that may be rendered with its
      // message, since it is announced on insertion as well as on change.
      role: 'alert',
      'aria-live': 'assertive',
      'aria-atomic': 'true',
    }),
  };
}
