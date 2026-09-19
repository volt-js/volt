/**
 * `createQuery` — one component's view of one cache entry.
 *
 * Everything hard happens in the cache. What is left here is the part that
 * belongs to the component: follow a key that is allowed to change, hold a
 * subscription for exactly as long as the scope lives, and let go of it on
 * disposal — which is what makes the last component to unmount cancel the
 * request nobody is waiting for any more.
 *
 * The cache itself comes from the scope, provided once where the application
 * starts — `provideQueryClient(createQueryClient())` — so a server can give
 * each request its own.
 *
 *   class UserCard {
 *     id = new Signal.State(1);
 *     user = createQuery({
 *       key: () => ['users', this.id.get()],
 *       fetcher: ({ key, signal }) =>
 *         fetch(`/users/${key[1]}`, { signal }).then((r) => r.json()),
 *       staleTime: 30_000,
 *     });
 *   }
 *
 *   <p :if="user.isLoading()">Loading…</p>
 *   <p :if="user.isError()">Could not load that user.</p>
 *   <article :if="user.data()" :class="{ stale: user.isFetching() }">
 *     { user.data().name }
 *   </article>
 *
 * Two components with the same key share one entry and one request. Changing
 * `id` above does not fetch again if the new key is already cached and fresh —
 * it swaps to that entry, and the card shows the other user immediately.
 *
 * When the new key is *not* cached, the default is a skeleton, which is right
 * for a detail panel and wrong for a paginated list: the rows vanish and the
 * scroll position goes with them. `keepPreviousData` holds the last key's data
 * on screen until the new one answers, which is what makes pagination not
 * flicker.
 */

import { Signal, dataEffect, effect, onCleanup } from '@voltdev/core';
import { hashQueryKey, type QueryKey } from './key.js';
import {
  useQueryClient,
  type Query,
  type QueryClient,
  type QueryFetcher,
  type QueryObservation,
  type QueryRetryOptions,
  type QueryStatus,
  type QueryUpdater,
} from './client.js';

export interface QueryOptions<T> extends QueryRetryOptions {
  /**
   * The key, or a function of signals returning one. The function form is what
   * makes a query follow a route parameter or a selected row.
   */
  key: QueryKey | (() => QueryKey);
  fetcher: QueryFetcher<T>;
  /**
   * Which cache. Defaults to the one in scope — see `provideQueryClient`, which
   * is how a server gives every request its own.
   */
  client?: QueryClient;
  /**
   * Gate on the key being worth asking about — a detail panel with nothing
   * selected, a query that needs a token first. Default true.
   *
   * Turning it off releases the subscription, which cancels the request if
   * nothing else wants it, and leaves this query reading as `idle`. The entry
   * keeps its data, so turning it back on shows it again at once.
   */
  enabled?: () => boolean;
  staleTime?: number;
  gcTime?: number;
  /**
   * Seeds the first entry this query observes, and only that one — a payload
   * rendered on the server for the key the component mounted with.
   *
   * It is deliberately not carried to whatever the key changes to. A payload
   * for user 1 is not information about user 2, and an entry counts as fresh
   * once seeded, so filing it under the second key would show the wrong user
   * and never correct itself.
   */
  initialData?: T;
  /**
   * While the key changes, keep showing the data the last key had until the
   * new one answers. Default false.
   *
   * This is what makes pagination not flicker: page 2 arrives to a list that is
   * still showing page 1 rather than to a skeleton, so the rows do not vanish
   * and the scroll position survives. `isFetching()` stays true throughout —
   * that is where the quiet indicator goes — and `isPlaceholder()` says the
   * data on screen answers the previous key rather than this one.
   */
  keepPreviousData?: boolean;
}

export function createQuery<T>(options: QueryOptions<T>): Query<T> {
  // Resolved here rather than at the first read: this runs while the component
  // that declared the field is being constructed, which is the only moment its
  // scope — and so the cache its subtree was given — is the current one.
  const client = options.client ?? useQueryClient();
  const observation = new Signal.State<QueryObservation<T> | null>(null);

  let current: QueryObservation<T> | null = null;
  let currentHash: string | null = null;
  /** Whether the seed has been spent. See `initialData`. */
  let seeded = false;
  /** The last data a previous key held, for `keepPreviousData`. */
  let previous: T | undefined;

  const readKey = (): QueryKey | null => {
    if (options.enabled && !options.enabled()) return null;
    return typeof options.key === 'function' ? options.key() : options.key;
  };

  // The data lane, as a resource's own fetches are: still deferred, so a key
  // read from a prop sees the value assigned after construction, but drained
  // by a server's flush as well as a browser's — subscribing is what asks for
  // the data, and a server that never subscribed would render the skeleton.
  dataEffect(() => {
    const key = readKey();

    // The key and `enabled` above are tracked; everything below reads and
    // writes this query's own state, and tracking that would make the effect
    // depend on what it writes.
    Signal.subtle.untrack(() => {
      const hash = key === null ? null : hashQueryKey(key);
      // The same key by value is the same entry, however many times the
      // expression that produced it has been re-evaluated. Without this every
      // unrelated signal change in the key expression would resubscribe, and
      // resubscribing means a cancel and a refetch.
      if (hash === currentHash) return;
      currentHash = hash;

      // Read before letting go: once released, the entry can be collected out
      // from under this query, and its data is what the next key renders over.
      if (options.keepPreviousData && current) {
        const held = current.query.data();
        if (held !== undefined) previous = held;
      }

      current?.release();
      current =
        key === null
          ? null
          : client.observe<T>({
              key,
              fetcher: options.fetcher,
              staleTime: options.staleTime,
              gcTime: options.gcTime,
              retry: options.retry,
              retryDelay: options.retryDelay,
              shouldRetry: options.shouldRetry,
              initialData: seeded ? undefined : options.initialData,
            });
      if (current) seeded = true;
      observation.set(current);
    });
  });

  // Let go of the held page as soon as the new key answers. Kept any longer it
  // is a flag only ever set: the moment this entry went back to holding nothing
  // — a removal, a sign-out, a websocket write — the old page would reappear,
  // reported as `success` under a key that never held it.
  if (options.keepPreviousData) {
    effect(() => {
      if (observation.get()?.query.data() !== undefined) previous = undefined;
    });
  }

  onCleanup(() => {
    current?.release();
    current = null;
  });

  /** The entry being read, or null while disabled — before the first effect run too. */
  const view = (): Query<T> | null => observation.get()?.query ?? null;

  /**
   * Whether what `data()` returns answers the previous key rather than this
   * one. False while disabled: showing one key's rows under no key at all
   * would be a list the application never asked for.
   *
   * A failure ends it too. Holding page 1 on screen once page 2 has failed
   * would report `success` out of `status()` and `true` out of `isError()` at
   * the same time, and leave the user looking at rows they asked to leave with
   * nothing saying that leaving them did not work.
   */
  const placeholding = (): boolean => {
    const entry = view();
    if (entry === null || entry.isError()) return false;
    return entry.data() === undefined && previous !== undefined;
  };

  return {
    key: () => view()?.key() ?? null,
    data: () => (placeholding() ? previous : view()?.data()),
    error: () => view()?.error(),
    // A page still showing the last one's rows is not loading as far as a
    // template is concerned — that is the whole point of holding them.
    status: (): QueryStatus => (placeholding() ? 'success' : (view()?.status() ?? 'idle')),
    isLoading: () => !placeholding() && (view()?.isLoading() ?? false),
    isFetching: () => view()?.isFetching() ?? false,
    isError: () => view()?.isError() ?? false,
    isPlaceholder: placeholding,
    isStale: () => view()?.isStale() ?? false,
    updatedAt: () => view()?.updatedAt() ?? 0,
    refetch: () => view()?.refetch() ?? Promise.resolve(undefined),
    setData: (next: T | undefined | QueryUpdater<T>) => view()?.setData(next),
  };
}
