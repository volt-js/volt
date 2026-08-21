/**
 * The cache — one entry per key, shared by everything that asks for it.
 *
 * `createResource` owns one request's lifecycle and owns it well: a generation
 * counter that drops a superseded response even when the fetcher ignored its
 * abort signal, retry with a cancellable backoff, and data that survives a
 * later failure. All of that is reused here — one resource per entry — rather
 * than written a second time under a different name.
 *
 * What a cache adds is everything about *sharing* one request:
 *
 *   - **Deduplication**, which is the opposite of what a resource does. A
 *     second `refetch()` on a resource supersedes the first, because a
 *     combobox that has moved on to "cat" does not want the answer to "ca". A
 *     second subscriber to a key wants precisely the answer already in flight,
 *     so it joins it instead.
 *   - **Staleness**, so data can be served now and revalidated behind it —
 *     which needs a status that does not fall back to `loading` when there is
 *     already something on screen.
 *   - **Lifetime.** A resource dies with the component that made it. An entry
 *     outlives every component that used it, and is collected only once
 *     nobody has wanted it for `gcTime`.
 *   - **Reach.** Invalidation and optimistic writes address entries nobody
 *     holds a reference to, by key and by prefix.
 *
 *   const client = createQueryClient({ staleTime: 30_000 });
 *
 *   const users = client.observe({
 *     key: ['users', { team }],
 *     fetcher: ({ signal }) => fetch('/users', { signal }).then((r) => r.json()),
 *   });
 *
 *   await client.mutate(() => api.rename(id, name), {
 *     optimistic: [optimistic(['users', id], (u: User) => ({ ...u, name }))],
 *     invalidate: [['users']],
 *   });
 */

import {
  Signal,
  batch,
  createContext,
  createRoot,
  provideContext,
  useContext,
} from '@voltdev/core';
import {
  createResource,
  exponentialBackoff,
  type Resource,
  type ResourceRequest,
} from '@voltdev/primitives';
import { hashParts, hashQueryKey, isKeyPrefix, queryKeyParts, type QueryKey } from './key.js';

const { untrack } = Signal.subtle;

/**
 * Where an entry is. The same four states a resource has, with one difference
 * that stale-while-revalidate forces: `loading` means *and there is nothing to
 * show*. Revalidating over data reads as `success`, and `isFetching()` is how
 * a UI puts a quiet indicator on it.
 */
export type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

/** Given what is cached now, what should be cached instead. */
export type QueryUpdater<T> = (previous: T | undefined) => T | undefined;

/** Everything the fetcher is told about the call it is making. */
export interface QueryContext {
  /** The key this entry is filed under — the question, already parsed. */
  readonly key: QueryKey;
  /**
   * Aborted when this request is superseded, written over, or when the last
   * subscriber goes away. Pass it to `fetch`.
   */
  readonly signal: AbortSignal;
  /** 0 on the first try, then 1, 2, … for each retry. */
  readonly attempt: number;
}

export type QueryFetcher<T> = (context: QueryContext) => T | Promise<T>;

export interface QueryRetryOptions {
  /** How many times to try again after a failure. Default 0. */
  retry?: number;
  /** Milliseconds before retry `attempt` (1 for the first). Default `exponentialBackoff`. */
  retryDelay?: (attempt: number, error: unknown) => number;
  /** Whether this failure is worth another attempt. Default: all of them. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export interface QueryClientOptions extends QueryRetryOptions {
  /**
   * How long data counts as fresh, in ms. Default 0 — every new subscriber
   * revalidates, serving what is cached while it does.
   *
   * Zero rather than something generous because the cost of the two mistakes
   * is not symmetrical: a request that did not need making is wasted
   * bandwidth, and data older than the caller assumed is a wrong screen. Raise
   * it per query where the answer genuinely does not move.
   */
  staleTime?: number;
  /**
   * How long an entry survives with no subscribers, in ms. Default five
   * minutes. `Infinity` keeps it for the life of the cache.
   */
  gcTime?: number;
}

export interface QueryEntryOptions<T> extends QueryRetryOptions {
  key: QueryKey;
  fetcher: QueryFetcher<T>;
  staleTime?: number;
  gcTime?: number;
  /** Seeds an entry that has nothing — a server-rendered payload. Ignored otherwise. */
  initialData?: T;
}

/** Everything a subscriber can read from, and do to, one entry. */
export interface Query<T> {
  /** The key being read, or null for a query whose `enabled` is false. */
  key(): QueryKey | null;
  data(): T | undefined;
  /** The last failure, as thrown. `unknown`, because a `throw` can be anything. */
  error(): unknown;
  status(): QueryStatus;
  /** Fetching with nothing to show yet. The one that means "render a skeleton". */
  isLoading(): boolean;
  /** A request is in flight, first or otherwise. The one that means "render a spinner beside the data". */
  isFetching(): boolean;
  isError(): boolean;
  /** Whether the next subscriber would trigger a refetch. A snapshot; the clock is not reactive. */
  isStale(): boolean;
  /**
   * Whether `data()` answers a key this query has already moved on from — see
   * `keepPreviousData`. Always false on an entry, which only ever holds answers
   * to its own key.
   */
  isPlaceholder(): boolean;
  /** When data last landed, as `Date.now()`. 0 when none ever has. */
  updatedAt(): number;
  /**
   * Ask again now, superseding anything in flight — a Retry button, a pull to
   * refresh. Never rejects; the failure is in `error()`.
   */
  refetch(): Promise<T | undefined>;
  /** Write the cache locally. Anything in flight is abandoned; see `QueryClient.setData`. */
  setData(next: T | undefined | QueryUpdater<T>): void;
}

export interface QueryObservation<T> {
  readonly query: Query<T>;
  /** Stop watching. The last one out cancels the request and starts the gc clock. */
  release(): void;
}

/** One local write, and how to undo it. Build with `optimistic()`. */
export interface OptimisticWrite {
  readonly key: QueryKey;
  readonly apply: (previous: unknown) => unknown;
}

/**
 * An optimistic write, typed.
 *
 * The indirection exists for TypeScript's sake: a heterogeneous list of writes
 * has to be typed at `unknown`, and an updater is contravariant in its
 * parameter, so `(list: Todo[]) => Todo[]` will not sit in a
 * `readonly OptimisticWrite[]` on its own. Doing the cast here means callers
 * keep inference and the library owns the one unchecked step.
 */
export function optimistic<T>(key: QueryKey, next: T | QueryUpdater<T>): OptimisticWrite {
  return {
    key,
    apply: (previous) =>
      typeof next === 'function'
        ? (next as QueryUpdater<T>)(previous as T | undefined)
        : (next as T),
  };
}

export interface MutateOptions {
  /**
   * Applied before the call goes out and undone if it fails. Each write is
   * exact: an optimistic update is a value, and a prefix does not name one.
   */
  optimistic?: readonly OptimisticWrite[];
  /**
   * Marked stale once the call settles — success or failure. Prefixes, so
   * `[['users']]` covers every user and every list of them.
   */
  invalidate?: readonly QueryKey[];
}

export interface QueryFilter {
  /** Match this key alone rather than everything under it. Default false. */
  exact?: boolean;
  /**
   * Narrow further, for the entries a key shape cannot name: every list whose
   * filter mentions a team, every page past the first. Called with the key the
   * entry was filed under, and applied on top of the key match — so
   * `invalidate(['users'], { predicate })` never reaches outside `['users']`.
   */
  predicate?: (key: QueryKey) => boolean;
}

export interface QueryClient {
  /**
   * Take a subscription on a key: the entry is kept alive, fetched if it is
   * stale, and handed back to read from. `createQuery` is this plus an effect
   * that follows a reactive key — use that in a component, and this anywhere
   * else.
   */
  observe<T>(options: QueryEntryOptions<T>): QueryObservation<T>;
  /**
   * Fetch once and resolve with the data, joining a request already in flight
   * and returning what is cached when it is still fresh. Never rejects; a
   * failure resolves undefined and is left on the entry.
   */
  fetch<T>(options: QueryEntryOptions<T>): Promise<T | undefined>;
  /** What is cached for a key right now. A snapshot — `createQuery` is how you follow one. */
  getData<T>(key: QueryKey): T | undefined;
  /**
   * Write the cache directly — the row a mutation just returned, a value from
   * a websocket. Anything in flight for that key is abandoned, because a
   * response already on its way carries what was just replaced.
   *
   * A function is treated as an updater; a `T` that is itself a function must
   * be wrapped: `setData(key, () => fn)`.
   */
  setData<T>(key: QueryKey, next: T | undefined | QueryUpdater<T>): void;
  /**
   * Mark everything at or under a key stale. What is being watched refetches
   * now; the rest refetches the next time something observes it.
   *
   * Resolves when those refetches have settled, so a mutation can await the
   * screen catching up.
   */
  invalidate(key: QueryKey, filter?: QueryFilter): Promise<void>;
  /** Drop everything at or under a key. Entries still being watched are emptied and asked again. */
  remove(key: QueryKey, filter?: QueryFilter): void;
  /**
   * Drop all of it — a sign-out, or a test tearing down. Unlike `remove`,
   * nothing is asked for again: whatever is still watching reads nothing.
   */
  clear(): void;
  /**
   * Apply optimistic writes, run the call, and put the old values back if it
   * throws. Resolves with the call's result and rejects with its error — once
   * the invalidations have settled, so the cache is consistent and the screen
   * has caught up either way.
   */
  mutate<R>(run: () => Promise<R>, options?: MutateOptions): Promise<R>;
  /** Every key currently held, for tests and for reasoning about lifetime. */
  keys(): QueryKey[];
  size(): number;
}

const DEFAULT_GC_TIME = 5 * 60_000;

interface EntryConfig<T> extends QueryRetryOptions {
  fetcher?: QueryFetcher<T>;
  staleTime?: number;
  gcTime?: number;
  initialData?: T;
}

interface CacheEntry<T> {
  readonly key: QueryKey;
  readonly parts: readonly string[];
  readonly query: Query<T>;
  configure(next: EntryConfig<T>): void;
  subscribe(): () => void;
  subscriberCount(): number;
  /** Fetch unless what is cached is still fresh. Joins a request in flight. */
  fetchIfStale(): Promise<T | undefined>;
  invalidate(): Promise<T | undefined>;
  /** Apply a local write and return the undo for it. */
  applyOptimistic(apply: (previous: unknown) => unknown): () => void;
  /** Back to holding nothing, without disposing — for an entry someone still watches. */
  reset(): void;
  scheduleGc(): void;
  dispose(): void;
}

function createEntry<T>(
  key: QueryKey,
  parts: readonly string[],
  defaults: QueryClientOptions,
  evict: () => void,
): CacheEntry<T> {
  const data = new Signal.State<T | undefined>(undefined);
  /** When data last landed. 0 means none ever has, which is stale by definition. */
  const updatedAt = new Signal.State(0);
  const invalidated = new Signal.State(false);

  /**
   * Mutable, because an entry is configured by whoever happens to subscribe,
   * and that is not always the same call site that created it.
   */
  const config = {
    fetcher: null as QueryFetcher<T> | null,
    staleTime: defaults.staleTime ?? 0,
    gcTime: defaults.gcTime ?? DEFAULT_GC_TIME,
    retry: defaults.retry ?? 0,
    retryDelay: defaults.retryDelay,
    shouldRetry: defaults.shouldRetry,
  };

  const peek = <V>(signal: Signal.State<V>): V => untrack(() => signal.get());

  let resource!: Resource<T>;
  let disposeScope!: () => void;

  // Rooted at nothing rather than at whichever component asked first: the
  // entry has to outlive all of them, and a scope inherited from the first
  // subscriber would take the cache down with that component's unmount.
  createRoot((dispose) => {
    disposeScope = dispose;
    resource = createResource<T, undefined>(
      // Guarded by `startFetch`, which is the only thing that starts a request.
      (request: ResourceRequest<T, undefined>) =>
        config.fetcher!({ key, signal: request.signal, attempt: request.attempt }),
      {
        // The cache owns the data, which is the hook `createResource` already
        // documents for exactly this — "a cache that outlives this component".
        data,
        // Off for good, so the resource never starts a request on its own
        // account. `enabled` gates the automatic, source-driven fetches only —
        // `refetch()` is explicit and runs either way — which is exactly the
        // split a cache needs, since requests can only be deduplicated if one
        // place decides when one starts.
        //
        // Left on, the resource's first effect run — deferred to the scheduler,
        // and so still pending for a component that mounts and unmounts in the
        // same turn — starts a request for an entry nobody is watching, whose
        // answer then lands in the cache.
        enabled: () => false,
        // The retry *count* is read through `shouldRetry` rather than fixed
        // here, because `retry` is captured once at creation and an entry can
        // be reconfigured by a later subscriber.
        retry: Number.POSITIVE_INFINITY,
        shouldRetry: (error, attempt) =>
          attempt <= config.retry && (config.shouldRetry?.(error, attempt) ?? true),
        // Wrapped rather than passed straight through: `exponentialBackoff`
        // takes a base and a cap where `retryDelay` passes the error, and the
        // two would line up silently.
        retryDelay: (attempt, error) =>
          config.retryDelay ? config.retryDelay(attempt, error) : exponentialBackoff(attempt),
        onSuccess: () => {
          batch(() => {
            updatedAt.set(Date.now());
            invalidated.set(false);
          });
        },
      },
    );
  }, null);

  let subscribers = 0;
  let inFlight: Promise<T | undefined> | null = null;
  /**
   * Whether what is in flight was started by `invalidate`, which is what tells
   * a second invalidation to join it rather than supersede it.
   */
  let inFlightAnswersInvalidation = false;
  let gcTimer: ReturnType<typeof setTimeout> | null = null;

  const staleAgainst = (at: number, invalid: boolean): boolean =>
    at === 0 || invalid || Date.now() - at >= config.staleTime;

  /** The fetch path must not subscribe whatever computation happens to be running. */
  const isStaleNow = (): boolean => staleAgainst(peek(updatedAt), peek(invalidated));

  /** Nothing is in flight any more, whatever it was answering. */
  const forget = (): void => {
    inFlight = null;
    inFlightAnswersInvalidation = false;
  };

  const trackFetch = (
    run: Promise<T | undefined>,
    forInvalidation: boolean,
  ): Promise<T | undefined> => {
    inFlight = run;
    inFlightAnswersInvalidation = forInvalidation;
    void run.finally(() => {
      if (inFlight === run) forget();
    });
    return run;
  };

  /** Start a request that supersedes anything already in flight. */
  const startFetch = (forInvalidation = false): Promise<T | undefined> => {
    if (!config.fetcher) return Promise.resolve(peek(data));
    return trackFetch(resource.refetch(), forInvalidation);
  };

  /**
   * Start a request, or join the one already going.
   *
   * This is the whole point of a shared cache, and it is where a resource and
   * a cache disagree: `resource.refetch()` always starts a new request, and
   * three components mounting together would make three.
   */
  const joinFetch = (): Promise<T | undefined> => inFlight ?? startFetch();

  const fetchIfStale = (): Promise<T | undefined> =>
    isStaleNow() ? joinFetch() : Promise.resolve(peek(data));

  const cancel = (): void => {
    // Cleared first: the aborted request's promise still settles eventually,
    // and a subscriber arriving in between must not join a request whose
    // answer has already been discarded.
    forget();
    resource.abort();
  };

  const scheduleGc = (): void => {
    if (gcTimer !== null) clearTimeout(gcTimer);
    gcTimer = null;
    if (config.gcTime === Number.POSITIVE_INFINITY) return;
    gcTimer = setTimeout(() => {
      gcTimer = null;
      dispose();
      evict();
    }, config.gcTime);
  };

  const dispose = (): void => {
    if (gcTimer !== null) clearTimeout(gcTimer);
    gcTimer = null;
    forget();
    // The resource's own cleanup aborts whatever is in flight.
    disposeScope();
  };

  const setData = (next: T | undefined | QueryUpdater<T>): void => {
    const value = typeof next === 'function' ? (next as QueryUpdater<T>)(peek(data)) : next;
    forget();
    // Wrapped in an updater so a `T` that is itself a function is not read as
    // one. `mutate` aborts what is in flight, which is the intent: the answer
    // is known now.
    resource.mutate(() => value);
    batch(() => {
      // Clearing an entry leaves nothing to serve, so it counts as stale
      // rather than as a freshly cached nothing.
      updatedAt.set(value === undefined ? 0 : Date.now());
      invalidated.set(false);
    });
    // The clock starts when an entry is created so that one seeded by
    // `setData` and never observed cannot sit in the map forever. Writing to
    // it has to restart that clock, or the age of the entry decides when data
    // written just now is collected: a value stored a moment ago would be
    // dropped on the original deadline, with nothing having gone wrong and
    // nobody told. Only while unobserved — a watched entry has no clock
    // running, and starting one here would collect it out from under its
    // subscribers.
    if (subscribers === 0) scheduleGc();
  };

  const status = (): QueryStatus => {
    const current = resource.status();
    // Revalidating over data we already have is not `loading`. Without this a
    // template branching on status would swap the list it is showing for a
    // spinner every time the cache went to check, which is the exact thing
    // stale-while-revalidate exists to avoid.
    return current === 'loading' && data.get() !== undefined ? 'success' : current;
  };

  const query: Query<T> = {
    key: () => key,
    data: () => data.get(),
    error: () => resource.error(),
    status,
    isLoading: () => status() === 'loading',
    isFetching: () => resource.status() === 'loading',
    isError: () => status() === 'error',
    isStale: () => staleAgainst(updatedAt.get(), invalidated.get()),
    isPlaceholder: () => false,
    updatedAt: () => updatedAt.get(),
    // Wrapped rather than passed through: `refetch()` is public, and its
    // argument list must not reach `startFetch`'s invalidation flag.
    refetch: () => startFetch(),
    setData,
  };

  return {
    key,
    parts,
    query,

    configure(next) {
      // The newest subscriber's fetcher wins. Two genuinely different fetchers
      // under one key is a bug in the caller — the key is meant to *be* the
      // question — but a component re-created with a fresh closure is not, and
      // that is the case that actually happens.
      if (next.fetcher) config.fetcher = next.fetcher;
      if (next.staleTime !== undefined) config.staleTime = next.staleTime;
      if (next.gcTime !== undefined) config.gcTime = next.gcTime;
      if (next.retry !== undefined) config.retry = next.retry;
      if (next.retryDelay !== undefined) config.retryDelay = next.retryDelay;
      if (next.shouldRetry !== undefined) config.shouldRetry = next.shouldRetry;
      // Only ever a seed: an entry that already holds something — or that is
      // already being told what it holds — has better information than a prop
      // passed at construction. Seeding over a request in flight would abort
      // it, since `setData` means the answer is known now, and the answer it
      // was carrying is newer than the payload this subscriber was rendered
      // with.
      if (next.initialData !== undefined && peek(updatedAt) === 0 && inFlight === null) {
        setData(() => next.initialData);
      }
    },

    subscribe() {
      subscribers += 1;
      if (gcTimer !== null) clearTimeout(gcTimer);
      gcTimer = null;

      let released = false;
      return () => {
        // Idempotent: a component disposed twice must not take a live
        // subscriber's count with it.
        if (released) return;
        released = true;
        subscribers -= 1;
        if (subscribers > 0) return;
        // Nobody is waiting for this answer any more. The data stays; the
        // request does not.
        cancel();
        scheduleGc();
      };
    },

    subscriberCount: () => subscribers,
    fetchIfStale,

    invalidate() {
      invalidated.set(true);
      // Only what someone is looking at is refetched now. A prefix
      // invalidation after one mutation would otherwise cost a request for
      // every list the user has visited this session.
      if (subscribers === 0) return Promise.resolve(peek(data));
      // A request already out to answer an invalidation answers this one too.
      // Without this, one mutation naming `[['users'], ['users', 1]]` — the
      // shape this file's own header recommends — reaches this entry twice and
      // costs two requests, the second aborting the first mid-flight.
      if (inFlight !== null && inFlightAnswersInvalidation) return inFlight;
      // Anything else in flight is deliberately not joined: a request that went
      // out before the invalidation was asked for is carrying exactly the answer
      // being invalidated.
      return startFetch(true);
    },

    applyOptimistic(apply) {
      const before = {
        data: peek(data),
        updatedAt: peek(updatedAt),
        invalidated: peek(invalidated),
      };
      const next = apply(before.data) as T | undefined;
      setData(() => next);

      return () => {
        // Only if the optimistic value is still what is there. A call that
        // fails after something newer has already landed — the server pushed
        // an update, another mutation succeeded — must not reinstate the old
        // value over it. This is what makes the rollback exact.
        if (!Object.is(peek(data), next)) return;
        forget();
        resource.mutate(() => before.data);
        batch(() => {
          updatedAt.set(before.updatedAt);
          invalidated.set(before.invalidated);
        });
      };
    },

    reset() {
      cancel();
      resource.mutate(() => undefined);
      batch(() => {
        updatedAt.set(0);
        invalidated.set(false);
      });
    },

    scheduleGc,
    dispose,
  };
}

export function createQueryClient(defaults: QueryClientOptions = {}): QueryClient {
  /**
   * Heterogeneous by construction: the key says what the value's type is, and
   * only the caller knows. The cast on the way out is the boundary — inside an
   * entry everything is typed.
   */
  const entries = new Map<string, CacheEntry<unknown>>();

  const entryFor = <T>(key: QueryKey, configure?: EntryConfig<T>): CacheEntry<T> => {
    const parts = queryKeyParts(key);
    const hash = hashParts(parts);

    let entry = entries.get(hash) as CacheEntry<T> | undefined;
    if (!entry) {
      const created: CacheEntry<T> = createEntry<T>(key, parts, defaults, () => {
        // Only if this is still the entry filed here. One dropped by `clear`
        // while it was being watched outlives the map, and its gc must not take
        // the replacement filed under the same hash with it.
        if (entries.get(hash) === (created as CacheEntry<unknown>)) entries.delete(hash);
      });
      entry = created;
      entries.set(hash, created as CacheEntry<unknown>);
      // Nothing has subscribed yet, and the gc clock only starts when the last
      // subscriber leaves — an entry seeded by `setData` and never observed
      // would otherwise sit in the map for the life of the process.
      entry.scheduleGc();
    }
    if (configure) entry.configure(configure);
    return entry;
  };

  const matching = (key: QueryKey, filter: QueryFilter): [string, CacheEntry<unknown>][] => {
    const prefix = queryKeyParts(key);
    const hash = hashParts(prefix);
    return [...entries].filter(
      ([entryHash, entry]) =>
        (filter.exact ? entryHash === hash : isKeyPrefix(prefix, entry.parts)) &&
        (filter.predicate?.(entry.key) ?? true),
    );
  };

  const invalidate = (key: QueryKey, filter: QueryFilter = {}): Promise<void> =>
    Promise.all(matching(key, filter).map(([, entry]) => entry.invalidate())).then(() => undefined);

  const remove = (key: QueryKey, filter: QueryFilter = {}): void => {
    for (const [hash, entry] of matching(key, filter)) {
      if (entry.subscriberCount() > 0) {
        // An entry cannot be disposed out from under a subscriber holding its
        // signals — those reads would go quiet for good. Emptied and asked
        // again is the same outcome from the subscriber's side.
        entry.reset();
        void entry.fetchIfStale();
        continue;
      }
      entries.delete(hash);
      entry.dispose();
    }
  };

  /**
   * Deliberately not `remove([])`.
   *
   * `remove` empties a watched entry and asks again, which is right for "this
   * data is wrong, get it again" and exactly wrong for a sign-out: the entries
   * would survive with their keys, re-issue the departing user's requests, and
   * refill the cache the caller was told was empty. So a watched entry is
   * emptied and let go of instead. The components still holding it read nothing,
   * which is what an empty cache means, and it is collected when they unmount.
   */
  const clear = (): void => {
    for (const [hash, entry] of entries) {
      entries.delete(hash);
      if (entry.subscriberCount() > 0) {
        entry.reset();
        continue;
      }
      entry.dispose();
    }
  };

  return {
    observe<T>(options: QueryEntryOptions<T>): QueryObservation<T> {
      const entry = entryFor<T>(options.key, options);
      const release = entry.subscribe();
      // Subscribing is what makes an entry worth fetching: the cache does not
      // chase data nobody is looking at.
      void entry.fetchIfStale();
      return { query: entry.query, release };
    },

    async fetch<T>(options: QueryEntryOptions<T>): Promise<T | undefined> {
      const entry = entryFor<T>(options.key, options);
      // An imperative fetch counts as a subscriber for as long as it is
      // waiting, so the last-one-out cancellation cannot pull the request out
      // from under it when an unrelated component unmounts.
      const release = entry.subscribe();
      try {
        return await entry.fetchIfStale();
      } finally {
        release();
      }
    },

    getData<T>(key: QueryKey): T | undefined {
      const entry = entries.get(hashQueryKey(key)) as CacheEntry<T> | undefined;
      return entry ? untrack(() => entry.query.data()) : undefined;
    },

    setData<T>(key: QueryKey, next: T | undefined | QueryUpdater<T>): void {
      entryFor<T>(key).query.setData(next);
    },

    invalidate,
    remove,
    clear,

    async mutate<R>(run: () => Promise<R>, options: MutateOptions = {}): Promise<R> {
      const rollbacks = (options.optimistic ?? []).map((write) =>
        entryFor(write.key).applyOptimistic(write.apply),
      );

      try {
        return await run();
      } catch (error) {
        // Newest first, so the writes unwind in the order they were made.
        for (let i = rollbacks.length - 1; i >= 0; i--) rollbacks[i]!();
        throw error;
      } finally {
        // Invalidated whether it succeeded or failed: a call that threw may
        // still have changed something, and only the server knows.
        //
        // Awaited, because `invalidate` resolving on its refetches is only
        // worth anything if something waits for it: a caller that navigates or
        // closes a dialog on the line after `await mutate(...)` would otherwise
        // do it while the list it just changed was still the old one. A
        // `finally` that awaits holds the rejection back too, so the failure
        // path arrives at the same caught-up cache. All of them together, since
        // they are independent requests.
        await Promise.all((options.invalidate ?? []).map((key) => invalidate(key)));
      }
    },

    keys: () => [...entries.values()].map((entry) => entry.key),
    size: () => entries.size,
  };
}

/**
 * The cache everything under a scope shares.
 *
 * Deliberately not a module-level `createQueryClient()` that queries fall back
 * to. Volt does share state by importing it — but `docs/design/ssr.md` settles
 * the limit of that: module scope holds read-mostly configuration, and
 * request-derived state lives in a scope. A server-state cache is the second
 * kind by definition, and one per process serves the first user's data to
 * whoever asks next.
 *
 * So the cache is provided where its lifetime starts — once at boot in a
 * browser, once per request on a server — and a query with no `client` of its
 * own finds it by scope rather than by import.
 */
const QueryClientContext = createContext<QueryClient | null>(null, 'volt.queryClient');

/**
 * Put a cache in scope for everything created under it, and hand it back:
 *
 *   const client = provideQueryClient(createQueryClient());
 */
export function provideQueryClient(client: QueryClient): QueryClient {
  provideContext(QueryClientContext, client);
  return client;
}

/**
 * The cache in scope. Throws rather than inventing one, because the alternative
 * is a second cache nobody can see, holding the answers the first one is
 * missing.
 */
export function useQueryClient(): QueryClient {
  const client = useContext(QueryClientContext);
  if (!client) {
    throw new Error(
      '[volt] No query cache in scope. Call provideQueryClient(createQueryClient()) where the ' +
        'application starts — once at boot in a browser, once per request on a server — ' +
        'or pass `client` to this query.',
    );
  }
  return client;
}
