/**
 * The cache.
 *
 * `createResource` is already tested for one request's lifecycle, so nothing
 * here re-tests abort, generation counting or retry. What is tested is the part
 * a cache adds and a resource cannot have: that several askers share one
 * request, that data can be served while it is revalidated behind it, that an
 * entry outlives the components that wanted it, and that a failed mutation puts
 * back exactly what it took away.
 *
 * The order things happen in matters more than usual, so the tests assert
 * synchronously wherever the behaviour is synchronous — a fetch count checked
 * after `await` cannot tell "joined the request in flight" from "made a second
 * one that also finished".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, effect, flushSync } from '@voltdev/core';
import {
  createQueryClient,
  optimistic,
  type QueryClient,
  type QueryObservation,
} from '../src/client.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let clients: QueryClient[] = [];
let held: QueryObservation<unknown>[] = [];

afterEach(() => {
  for (const observation of held) observation.release();
  held = [];
  for (const client of clients) client.clear();
  clients = [];
  flushSync();
  vi.useRealTimers();
  serverBuild(false);
});

function makeClient(...args: Parameters<typeof createQueryClient>): QueryClient {
  const client = createQueryClient(...args);
  clients.push(client);
  return client;
}

/** Subscribe, and release it in teardown whatever the test does. */
function hold<T>(observation: QueryObservation<T>): QueryObservation<T> {
  held.push(observation as QueryObservation<unknown>);
  return observation;
}

/** A promise resolved by hand, so a request can be held open mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Let the promise chain and the scheduler catch up.
 *
 * The write path is `await fetcher` → signal writes → effect flush, so a single
 * microtask is never enough.
 */
async function settle(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
    flushSync();
  }
}

/**
 * Fake only the clock and `setTimeout`.
 *
 * Volt's scheduler coalesces onto `queueMicrotask`; faking that would stop
 * effects running at all, and staleness is measured against `Date.now()`.
 */
function useClock(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

/**
 * Compile as a server build does.
 *
 * The test config compiles `__VOLT_SERVER__` to a live read of this global, so
 * one file can exercise both sides.
 */
function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

/** Run something reactively in a scope the caller ends, and count the runs. */
function watch(run: () => void): () => void {
  let stop!: () => void;
  createRoot((dispose) => {
    stop = dispose;
    effect(run);
  }, null);
  flushSync();
  return stop;
}

// ---------------------------------------------------------------------------
// One request, however many askers
// ---------------------------------------------------------------------------

describe('sharing one request', () => {
  it('makes one request for two subscribers to the same key', async () => {
    const client = makeClient();
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    const a = hold(client.observe({ key: ['users', 1], fetcher }));
    const b = hold(client.observe({ key: ['users', 1], fetcher }));

    // Synchronously: a second subscriber that has to await to find out whether
    // it started its own request has already lost the race it was meant to win.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.size()).toBe(1);

    gate.resolve('Ada');
    await settle();

    expect(a.query.data()).toBe('Ada');
    expect(b.query.data()).toBe('Ada');
  });

  it('adds no request for a third subscriber arriving mid-flight', async () => {
    const client = makeClient();
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    const a = hold(client.observe({ key: ['users', 1], fetcher }));
    const b = hold(client.observe({ key: ['users', 1], fetcher }));
    expect(a.query.isLoading()).toBe(true);

    // Arriving late, while the answer is already on its way. This is the case a
    // resource gets wrong on purpose: a new `refetch()` supersedes the old one,
    // which is right for a combobox and wrong for a shared key.
    const c = hold(client.observe({ key: ['users', 1], fetcher }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(c.query.isLoading()).toBe(true);

    gate.resolve('Ada');
    await settle();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(c.query.data()).toBe('Ada');
  });

  it('makes one request per key, not one per cache', () => {
    const client = makeClient();
    const fetcher = vi.fn(() => deferred<string>().promise);

    hold(client.observe({ key: ['users', 1], fetcher }));
    hold(client.observe({ key: ['users', 2], fetcher }));

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.size()).toBe(2);
  });

  it('joins an in-flight request from the imperative fetch too', async () => {
    const client = makeClient();
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    hold(client.observe({ key: ['users', 1], fetcher }));
    const joined = client.fetch({ key: ['users', 1], fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);

    gate.resolve('Ada');
    await expect(joined).resolves.toBe('Ada');
  });

  it('runs one request for two concurrent imperative fetches', async () => {
    const client = makeClient();
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    const both = Promise.all([
      client.fetch({ key: ['users', 1], fetcher }),
      client.fetch({ key: ['users', 1], fetcher }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    gate.resolve('Ada');
    await expect(both).resolves.toEqual(['Ada', 'Ada']);
  });

  it('tells the fetcher which key it is answering', async () => {
    const client = makeClient();
    const keys: unknown[][] = [];
    await client.fetch({
      key: ['users', 1, { page: 2 }],
      fetcher: ({ key }) => {
        keys.push([...key]);
        return 'Ada';
      },
    });
    expect(keys).toEqual([['users', 1, { page: 2 }]]);
  });

  it('serves fresh data to a later fetch without asking again', async () => {
    useClock();
    const client = makeClient({ staleTime: 1000 });
    const fetcher = vi.fn(() => Promise.resolve('Ada'));

    await client.fetch({ key: ['users', 1], fetcher });
    await expect(client.fetch({ key: ['users', 1], fetcher })).resolves.toBe('Ada');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not join a request that was already abandoned', async () => {
    const client = makeClient();
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    const first = client.observe({ key: ['users', 1], fetcher });
    first.release();
    // The abandoned request's promise still settles; a subscriber arriving
    // after the cancel must start a new one rather than wait for an answer
    // that has already been discarded.
    hold(client.observe({ key: ['users', 1], fetcher }));

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Stale while revalidate
// ---------------------------------------------------------------------------

describe('staleness', () => {
  it('serves what it has immediately and refetches behind it', async () => {
    useClock();
    const client = makeClient({ staleTime: 100 });
    const answers = ['first', 'second'];
    const fetcher = vi.fn(() => Promise.resolve(answers.shift() as string));

    const first = client.observe({ key: ['users', 1], fetcher });
    await settle();
    expect(first.query.data()).toBe('first');
    first.release();

    await advance(200);

    const second = hold(client.observe({ key: ['users', 1], fetcher }));
    // Synchronously, before any await: the data is there and the request is
    // out. A template branching on status must not swap the list it is showing
    // for a spinner while the cache goes to check.
    expect(second.query.data()).toBe('first');
    expect(second.query.status()).toBe('success');
    expect(second.query.isLoading()).toBe(false);
    expect(second.query.isFetching()).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);

    await settle();
    expect(second.query.data()).toBe('second');
    expect(second.query.isFetching()).toBe(false);
  });

  it('does not refetch while the data is still fresh', async () => {
    useClock();
    const client = makeClient({ staleTime: 1000 });
    const fetcher = vi.fn(() => Promise.resolve('Ada'));

    const first = client.observe({ key: ['users', 1], fetcher });
    await settle();
    first.release();

    await advance(500);

    const second = hold(client.observe({ key: ['users', 1], fetcher }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second.query.isFetching()).toBe(false);
    expect(second.query.isStale()).toBe(false);
  });

  it('revalidates on every new subscriber by default', async () => {
    const client = makeClient();
    const fetcher = vi.fn(() => Promise.resolve('Ada'));

    const first = client.observe({ key: ['users', 1], fetcher });
    await settle();
    first.release();

    hold(client.observe({ key: ['users', 1], fetcher }));
    // staleTime defaults to zero: data older than the caller assumed is a
    // wrong screen, and a request that did not need making is only bandwidth.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('never goes stale on its own with an infinite staleTime', async () => {
    useClock();
    const client = makeClient({
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
    });
    const fetcher = vi.fn(() => Promise.resolve('Ada'));

    const first = client.observe({ key: ['users', 1], fetcher });
    await settle();
    first.release();
    await advance(10 * 60_000);

    const second = hold(client.observe({ key: ['users', 1], fetcher }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second.query.isStale()).toBe(false);
  });

  it('counts an entry that holds nothing as stale', () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    client.setData(['users', 1], undefined);
    const query = hold(
      client.observe({ key: ['users', 1], fetcher: () => Promise.resolve('Ada') }),
    ).query;
    expect(query.isFetching()).toBe(true);
    expect(query.updatedAt()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lifetime
// ---------------------------------------------------------------------------

describe('lifetime', () => {
  it('aborts the request when the last subscriber goes away', async () => {
    const client = makeClient();
    const gate = deferred<string>();
    let signal!: AbortSignal;
    const fetcher = vi.fn(({ signal: s }: { signal: AbortSignal }) => {
      signal = s;
      return gate.promise;
    });

    const a = client.observe({ key: ['users', 1], fetcher });
    const b = client.observe({ key: ['users', 1], fetcher });

    a.release();
    expect(signal.aborted).toBe(false);

    b.release();
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
    expect((signal.reason as DOMException).name).toBe('AbortError');
  });

  it('drops the answer to a request nobody is waiting for any more', async () => {
    const client = makeClient();
    const gate = deferred<string>();
    // A fetcher that ignores its signal, which is the normal case for anything
    // reading from a cache or a service worker.
    const fetcher = vi.fn(() => gate.promise);
    const observation = client.observe({ key: ['users', 1], fetcher });

    observation.release();
    gate.resolve('Ada');
    await settle();

    // And no second request in its place: a mount that unmounts again before
    // the scheduler has run must leave nothing behind.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.getData(['users', 1])).toBeUndefined();
  });

  it('keeps releasing idempotent, so a double dispose cannot cancel a live request', () => {
    const client = makeClient();
    const gate = deferred<string>();
    let signal!: AbortSignal;
    const fetcher = ({ signal: s }: { signal: AbortSignal }) => {
      signal = s;
      return gate.promise;
    };

    const a = client.observe({ key: ['users', 1], fetcher });
    hold(client.observe({ key: ['users', 1], fetcher }));

    a.release();
    a.release();

    expect(signal.aborted).toBe(false);
  });

  it('stops a retry nobody is waiting for any more', async () => {
    useClock();
    const client = makeClient();
    const fetcher = vi.fn(() => {
      throw new Error('down');
    });
    const observation = client.observe({
      key: ['users', 1],
      fetcher,
      retry: 3,
      retryDelay: () => 10,
    });
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);

    observation.release();
    await advance(60_000);

    // A backoff that outlives its subscriber would keep asking for an answer
    // the application has already stopped rendering.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('aborts what is in flight when the entry is removed', () => {
    const client = makeClient();
    let signal!: AbortSignal;
    const observation = client.observe({
      key: ['users', 1],
      fetcher: ({ signal: s }) => {
        signal = s;
        return deferred<string>().promise;
      },
    });
    observation.release();

    client.remove(['users', 1]);
    expect(signal.aborted).toBe(true);
    expect(client.size()).toBe(0);
  });

  it('keeps two caches apart', async () => {
    const one = makeClient();
    const two = makeClient();
    const fetcher = vi.fn(() => Promise.resolve('Ada'));

    hold(one.observe({ key: ['users', 1], fetcher }));
    hold(two.observe({ key: ['users', 1], fetcher }));

    // One cache per request is what keeps a server from serving one user's
    // data to the next.
    expect(fetcher).toHaveBeenCalledTimes(2);
    one.setData(['users', 1], 'Grace');
    expect(two.getData(['users', 1])).toBeUndefined();
  });

  it('keeps the data after the last subscriber leaves', async () => {
    const client = makeClient();
    const observation = client.observe({ key: ['users', 1], fetcher: () => Promise.resolve('Ada') });
    await settle();
    observation.release();

    expect(client.getData(['users', 1])).toBe('Ada');
    expect(client.size()).toBe(1);
  });

  it('collects an entry nobody has wanted for gcTime', async () => {
    useClock();
    const client = makeClient({ gcTime: 1000 });
    const observation = client.observe({ key: ['users', 1], fetcher: () => Promise.resolve('Ada') });
    await settle();
    observation.release();

    await advance(999);
    expect(client.size()).toBe(1);

    await advance(2);
    expect(client.size()).toBe(0);
  });

  it('stops the clock when someone subscribes again', async () => {
    useClock();
    const client = makeClient({ gcTime: 1000 });
    const fetcher = () => Promise.resolve('Ada');
    const first = client.observe({ key: ['users', 1], fetcher });
    await settle();
    first.release();

    await advance(800);
    hold(client.observe({ key: ['users', 1], fetcher }));
    await advance(800);

    expect(client.size()).toBe(1);
  });

  it('collects an entry that was only ever written to', async () => {
    useClock();
    const client = makeClient({ gcTime: 1000 });
    client.setData(['users', 1], 'Ada');

    // The gc clock starts when the last subscriber leaves, and nothing ever
    // subscribed here — without a clock started at creation this sits in the
    // map for the life of the process.
    await advance(1001);
    expect(client.size()).toBe(0);
  });

  it('starts the clock on an entry a write left behind before it finished', async () => {
    useClock();
    const client = makeClient({ gcTime: 1000 });

    // An updater written as though there were already data, run against a key
    // that holds none. The entry is in the map by the time the updater throws,
    // with nothing written to it and nobody subscribed — so only the clock
    // started when it was created can ever collect it.
    expect(() =>
      client.setData<string[]>(['todos'], (list) => (list as string[]).map((todo) => todo)),
    ).toThrow(TypeError);
    expect(client.size()).toBe(1);

    await advance(1001);
    expect(client.size()).toBe(0);
  });

  it('restarts the clock on a write, rather than collecting on the age of the entry', async () => {
    useClock();
    const client = makeClient({ gcTime: 1000 });
    client.setData(['users', 1], 'Ada');

    await advance(900);
    client.setData(['users', 1], 'Grace');

    // The deadline belongs to the value, not to the entry that holds it.
    // Otherwise something written a moment ago is dropped on the deadline the
    // entry was created with, with nothing having gone wrong and nobody told.
    await advance(200);
    expect(client.getData(['users', 1])).toBe('Grace');

    await advance(900);
    expect(client.size()).toBe(0);
  });

  it('starts no clock on a server, where the cache is dropped whole', async () => {
    useClock();
    serverBuild(true);
    const client = makeClient({ gcTime: 1000 });
    const observation = client.observe({ key: ['users', 1], fetcher: () => Promise.resolve('Ada') });
    await settle();
    observation.release();

    // A timer armed here outlives the response that armed it: the cache is
    // one request's and dies with it, and a prerender process would sit on
    // the event loop for `gcTime` after its page was written.
    expect(vi.getTimerCount()).toBe(0);

    await advance(1001);
    expect(client.size()).toBe(1);
  });

  it('keeps an entry for the life of the cache when gcTime is infinite', async () => {
    useClock();
    const client = makeClient({ gcTime: Number.POSITIVE_INFINITY });
    const observation = client.observe({ key: ['users', 1], fetcher: () => Promise.resolve('Ada') });
    await settle();
    observation.release();

    await advance(60 * 60_000);
    expect(client.size()).toBe(1);
    expect(client.getData(['users', 1])).toBe('Ada');
  });
});

// ---------------------------------------------------------------------------
// Reading and writing directly
// ---------------------------------------------------------------------------

describe('reading and writing', () => {
  it('finds the same entry however the key was constructed', async () => {
    const client = makeClient();
    const fetcher = vi.fn(() => Promise.resolve('Ada'));
    const id = 1;

    hold(client.observe({ key: ['users', 1], fetcher }));
    hold(client.observe({ key: ['users', id], fetcher }));
    hold(client.observe({ key: ['users', ...[id]], fetcher }));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.size()).toBe(1);

    await settle();
    client.setData(['users', id], 'Grace');
    expect(client.getData(['users', 1])).toBe('Grace');
  });

  it('finds the same entry when an object part is rebuilt or reordered', () => {
    const client = makeClient();
    client.setData(['list', { page: 2, filter: 'open' }], ['a']);

    expect(client.getData(['list', { filter: 'open', page: 2 }])).toEqual(['a']);
    expect(client.size()).toBe(1);
  });

  it('takes an updater, and treats undefined as holding nothing', () => {
    const client = makeClient();
    client.setData<string[]>(['todos'], ['a']);
    client.setData<string[]>(['todos'], (previous) => [...(previous ?? []), 'b']);
    expect(client.getData(['todos'])).toEqual(['a', 'b']);

    client.setData(['todos'], undefined);
    expect(client.getData(['todos'])).toBeUndefined();
  });

  it('abandons a request that is carrying what was just written over', async () => {
    const client = makeClient();
    const gate = deferred<string>();
    hold(client.observe({ key: ['users', 1], fetcher: () => gate.promise }));

    client.setData(['users', 1], 'Grace');
    gate.resolve('Ada');
    await settle();

    // The response was already on its way and carries the value the caller
    // just replaced.
    expect(client.getData(['users', 1])).toBe('Grace');
  });

  it('reads nothing for a key it has never seen, without creating it', () => {
    const client = makeClient();
    expect(client.getData(['users', 1])).toBeUndefined();
    expect(client.size()).toBe(0);
  });

  it('reads the cache without subscribing whatever is running', async () => {
    const client = makeClient();
    hold(client.observe({ key: ['users', 1], fetcher: () => Promise.resolve('Ada') }));
    await settle();

    let runs = 0;
    const stop = watch(() => {
      runs += 1;
      client.getData(['users', 1]);
    });
    expect(runs).toBe(1);

    client.setData(['users', 1], 'Grace');
    flushSync();
    // A snapshot read, by contract — `createQuery` is how you follow an entry.
    expect(runs).toBe(1);
    stop();
  });
});

// ---------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------

describe('invalidation', () => {
  it('refetches what is being watched now', async () => {
    useClock();
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const fetcher = vi.fn(() => Promise.resolve('Ada'));
    hold(client.observe({ key: ['users', 1], fetcher }));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await client.invalidate(['users', 1]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('resolves only once the refetches have settled', async () => {
    const client = makeClient();
    const gates = [deferred<string>(), deferred<string>()];
    let call = 0;
    const query = hold(
      client.observe({ key: ['users', 1], fetcher: () => gates[call++]!.promise }),
    ).query;
    gates[0]!.resolve('Ada');
    await settle();

    let settled = false;
    const done = client.invalidate(['users', 1]).then(() => {
      settled = true;
    });
    await settle();
    // A mutation awaits this to know the screen has caught up.
    expect(settled).toBe(false);

    gates[1]!.resolve('Grace');
    await done;
    expect(query.data()).toBe('Grace');
  });

  it('marks an unwatched entry rather than fetching data nobody is looking at', async () => {
    useClock();
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const fetcher = vi.fn(() => Promise.resolve('Ada'));

    const first = client.observe({ key: ['users', 1], fetcher });
    await settle();
    first.release();

    await client.invalidate(['users', 1]);
    // A prefix invalidation after one mutation would otherwise cost a request
    // for every list the user has visited this session.
    expect(fetcher).toHaveBeenCalledTimes(1);

    hold(client.observe({ key: ['users', 1], fetcher }));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('covers everything under a prefix', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const one = vi.fn(() => Promise.resolve('one'));
    const two = vi.fn(() => Promise.resolve('two'));
    const other = vi.fn(() => Promise.resolve('other'));

    hold(client.observe({ key: ['users', 1], fetcher: one }));
    hold(client.observe({ key: ['users', 2], fetcher: two }));
    hold(client.observe({ key: ['teams', 1], fetcher: other }));
    await settle();

    await client.invalidate(['users']);
    expect(one).toHaveBeenCalledTimes(2);
    expect(two).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('does not reach an id that merely starts with the one invalidated', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const one = vi.fn(() => Promise.resolve('one'));
    const twelve = vi.fn(() => Promise.resolve('twelve'));

    hold(client.observe({ key: ['users', 1], fetcher: one }));
    hold(client.observe({ key: ['users', 12], fetcher: twelve }));
    await settle();

    await client.invalidate(['users', 1]);
    expect(one).toHaveBeenCalledTimes(2);
    expect(twelve).toHaveBeenCalledTimes(1);
  });

  it('touches one entry only when asked exactly', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const list = vi.fn(() => Promise.resolve(['a']));
    const one = vi.fn(() => Promise.resolve('a'));

    hold(client.observe({ key: ['users'], fetcher: list }));
    hold(client.observe({ key: ['users', 1], fetcher: one }));
    await settle();

    await client.invalidate(['users'], { exact: true });
    expect(list).toHaveBeenCalledTimes(2);
    expect(one).toHaveBeenCalledTimes(1);
  });

  it('supersedes a request that went out before the invalidation', async () => {
    const client = makeClient();
    const gates = [deferred<string>(), deferred<string>()];
    let call = 0;
    const query = hold(
      client.observe({ key: ['users', 1], fetcher: () => gates[call++]!.promise }),
    ).query;

    void client.invalidate(['users', 1]);
    // The first response is carrying exactly the answer being invalidated, so
    // joining it would defeat the invalidation.
    expect(call).toBe(2);

    gates[1]!.resolve('fresh');
    gates[0]!.resolve('stale');
    await settle();

    expect(query.data()).toBe('fresh');
  });

  it('joins an invalidation already in flight rather than superseding it', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const signals: AbortSignal[] = [];
    let call = 0;
    const query = hold(
      client.observe({
        key: ['users', 1],
        fetcher: ({ signal }) => {
          signals.push(signal);
          return gates[call++]!.promise;
        },
      }),
    ).query;
    gates[0]!.resolve('Ada');
    await settle();

    // One mutation naming a list and a row under it — the shape this file's own
    // header recommends — reaches this entry twice.
    const list = client.invalidate(['users']);
    const row = client.invalidate(['users', 1]);

    // Synchronously: the second invalidation is already answered by the request
    // the first one sent, so it costs no request and kills none.
    expect(call).toBe(2);
    expect(signals[1]!.aborted).toBe(false);

    gates[1]!.resolve('Grace');
    await Promise.all([list, row]);
    expect(query.data()).toBe('Grace');
  });

  it('narrows by predicate, for what a key shape cannot name', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const fetchers = new Map<number, ReturnType<typeof vi.fn>>();
    for (const page of [1, 2, 3]) {
      const fetcher = vi.fn(() => Promise.resolve(`page ${page}`));
      fetchers.set(page, fetcher);
      hold(client.observe({ key: ['rows', { page }], fetcher }));
    }
    await settle();

    // Every page past the first: a question about the keys' contents, which no
    // prefix can ask.
    await client.invalidate(['rows'], {
      predicate: (key) => (key[1] as { page: number }).page > 1,
    });

    expect(fetchers.get(1)).toHaveBeenCalledTimes(1);
    expect(fetchers.get(2)).toHaveBeenCalledTimes(2);
    expect(fetchers.get(3)).toHaveBeenCalledTimes(2);
  });

  it('applies the predicate on top of the key, never instead of it', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const users = vi.fn(() => Promise.resolve('u'));
    const teams = vi.fn(() => Promise.resolve('t'));

    hold(client.observe({ key: ['users', 1], fetcher: users }));
    hold(client.observe({ key: ['teams', 1], fetcher: teams }));
    await settle();

    // A predicate that says yes to everything still cannot reach outside the
    // key it was given — otherwise one careless filter invalidates the cache.
    await client.invalidate(['users'], { predicate: () => true });

    expect(users).toHaveBeenCalledTimes(2);
    expect(teams).toHaveBeenCalledTimes(1);
  });

  it('is handed the key the entry was filed under', async () => {
    const client = makeClient();
    const seen: unknown[][] = [];
    client.setData(['rows', { page: 2 }], ['a']);

    await client.invalidate(['rows'], {
      predicate: (key) => {
        seen.push([...key]);
        return false;
      },
    });

    expect(seen).toEqual([['rows', { page: 2 }]]);
  });
});

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

describe('removal', () => {
  it('drops an unwatched entry', async () => {
    const client = makeClient();
    const observation = client.observe({ key: ['users', 1], fetcher: () => Promise.resolve('Ada') });
    await settle();
    observation.release();

    client.remove(['users']);
    expect(client.size()).toBe(0);
    expect(client.getData(['users', 1])).toBeUndefined();
  });

  it('empties a watched entry and asks again', async () => {
    const client = makeClient();
    const fetcher = vi.fn(() => Promise.resolve('Ada'));
    const query = hold(client.observe({ key: ['users', 1], fetcher })).query;
    await settle();

    client.remove(['users', 1]);
    // An entry cannot be disposed out from under a subscriber holding its
    // signals — those reads would go quiet for good.
    expect(query.data()).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);

    await settle();
    expect(query.data()).toBe('Ada');
  });

  it('clears everything', async () => {
    const client = makeClient();
    const fetcher = vi.fn(() => Promise.resolve('Ada'));
    // One entry with a live subscriber, because that is the case that matters:
    // a sign-out happens with components still mounted, and an entry nothing is
    // watching takes the easy branch.
    const watched = hold(client.observe({ key: ['users', 1], fetcher }));
    await settle();
    client.setData(['teams', 1], 'Core');
    expect(client.size()).toBe(2);

    client.clear();
    expect(client.size()).toBe(0);
    expect(client.keys()).toEqual([]);
    expect(watched.query.data()).toBeUndefined();

    await settle();
    // And it stays cleared. Asking again here would re-issue the departing
    // user's request and refill the cache the caller was told was empty.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.size()).toBe(0);
    expect(client.getData(['users', 1])).toBeUndefined();
  });

  it('lets a subscriber that outlived a clear go on working', async () => {
    useClock();
    // Fresh for good, so the holder below reads the replacement rather than
    // revalidating it away — the assertion is about which entry is in the map,
    // and a refetch answering over it would decide the value either way.
    const client = makeClient({ gcTime: 1000, staleTime: Number.POSITIVE_INFINITY });
    const fetcher = vi.fn(() => Promise.resolve('Ada'));
    const watched = client.observe({ key: ['users', 1], fetcher });
    await settle();
    client.clear();

    // The entry is gone from the cache but not dead: a component still holding
    // it can refetch, and the key is free for whoever asks next.
    await watched.query.refetch();
    expect(watched.query.data()).toBe('Ada');
    client.setData(['users', 1], 'Grace');
    expect(client.size()).toBe(1);

    // And the orphan's own collection must not take that replacement with it.
    // The replacement has to be held while that is checked, or its own
    // collection — legitimate, since nothing is observing it — is what removes
    // it, and the assertion passes or fails for the wrong reason.
    const holder = client.observe({ key: ['users', 1], fetcher });
    watched.release();
    await advance(1001);

    // The map is what is being tested: the orphan is filed under the same hash
    // as the replacement, and evicting by hash alone would drop a live entry
    // the cache was still serving.
    expect(client.size()).toBe(1);
    expect(client.keys()).toEqual([['users', 1]]);
    expect(client.getData(['users', 1])).toBe('Grace');
    expect(fetcher).toHaveBeenCalledTimes(2);
    holder.release();
  });

  it('lists the keys it holds', () => {
    const client = makeClient();
    client.setData(['users', 1], 'Ada');
    client.setData(['teams'], ['Core']);
    expect(client.keys()).toEqual([
      ['users', 1],
      ['teams'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

describe('mutations', () => {
  it('applies an optimistic write before the call goes out', async () => {
    const client = makeClient();
    client.setData<string[]>(['todos'], ['a']);

    const gate = deferred<void>();
    const running = client.mutate(() => gate.promise, {
      optimistic: [optimistic<string[]>(['todos'], (list) => [...(list ?? []), 'b'])],
    });

    expect(client.getData(['todos'])).toEqual(['a', 'b']);
    gate.resolve();
    await running;
    expect(client.getData(['todos'])).toEqual(['a', 'b']);
  });

  it('puts back exactly what it took away when the call fails', async () => {
    const client = makeClient();
    const before = ['a'];
    client.setData<string[]>(['todos'], before);

    await expect(
      client.mutate(() => Promise.reject(new Error('offline')), {
        optimistic: [optimistic<string[]>(['todos'], (list) => [...(list ?? []), 'b'])],
      }),
    ).rejects.toThrow('offline');

    expect(client.getData(['todos'])).toBe(before);
  });

  it('unwinds several writes, newest first', async () => {
    const client = makeClient();
    client.setData(['users', 1], 'Ada');
    client.setData(['users', 2], 'Grace');

    await expect(
      client.mutate(() => Promise.reject(new Error('nope')), {
        optimistic: [
          optimistic(['users', 1], 'Ada L.'),
          optimistic(['users', 2], 'Grace H.'),
          optimistic(['users', 1], 'A. Lovelace'),
        ],
      }),
    ).rejects.toThrow('nope');

    expect(client.getData(['users', 1])).toBe('Ada');
    expect(client.getData(['users', 2])).toBe('Grace');
  });

  it('does not reinstate the old value over something newer', async () => {
    const client = makeClient();
    client.setData(['users', 1], 'Ada');

    const gate = deferred<void>();
    const running = client.mutate(() => gate.promise, {
      optimistic: [optimistic(['users', 1], 'Ada L.')],
    });

    // A websocket push, or another mutation that succeeded, landing while this
    // call was still out.
    client.setData(['users', 1], 'A. Lovelace');
    gate.reject(new Error('offline'));
    await expect(running).rejects.toThrow('offline');

    // This is what "exactly" means: the rollback is skipped, not applied over
    // the newer truth.
    expect(client.getData(['users', 1])).toBe('A. Lovelace');
  });

  it('leaves an entry it created holding nothing again', async () => {
    const client = makeClient();
    await expect(
      client.mutate(() => Promise.reject(new Error('nope')), {
        optimistic: [optimistic(['todos'], ['a'])],
      }),
    ).rejects.toThrow('nope');

    expect(client.getData(['todos'])).toBeUndefined();
  });

  it('resolves with the call result and leaves the writes in place', async () => {
    const client = makeClient();
    client.setData(['users', 1], 'Ada');

    await expect(
      client.mutate(() => Promise.resolve({ id: 1 }), {
        optimistic: [optimistic(['users', 1], 'Ada L.')],
      }),
    ).resolves.toEqual({ id: 1 });

    expect(client.getData(['users', 1])).toBe('Ada L.');
  });

  it('invalidates whether the call succeeded or failed', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const fetcher = vi.fn(() => Promise.resolve(['a']));
    hold(client.observe({ key: ['todos'], fetcher }));
    await settle();

    await client.mutate(() => Promise.resolve(null), { invalidate: [['todos']] });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // A call that threw may still have changed something, and only the server
    // knows which.
    await expect(
      client.mutate(() => Promise.reject(new Error('nope')), { invalidate: [['todos']] }),
    ).rejects.toThrow('nope');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('resolves once the screens it invalidated have caught up', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const gates = [deferred<string[]>(), deferred<string[]>()];
    let call = 0;
    const query = hold(client.observe({ key: ['todos'], fetcher: () => gates[call++]!.promise }))
      .query;
    gates[0]!.resolve(['a']);
    await settle();

    let done = false;
    const running = client.mutate(() => Promise.resolve(null), { invalidate: [['todos']] }).then(
      () => {
        done = true;
      },
    );
    await settle();

    // The refetch is out, and the mutation has not finished until it lands —
    // otherwise a handler that navigates on the next line does it while the
    // list it just changed is still the old one.
    expect(call).toBe(2);
    expect(done).toBe(false);

    gates[1]!.resolve(['a', 'b']);
    await running;
    expect(query.data()).toEqual(['a', 'b']);
  });

  it('waits for its invalidations when the call failed too', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const gates = [deferred<string[]>(), deferred<string[]>()];
    let call = 0;
    hold(client.observe({ key: ['todos'], fetcher: () => gates[call++]!.promise }));
    gates[0]!.resolve(['a']);
    await settle();

    let rejected = false;
    const running = client
      .mutate(() => Promise.reject(new Error('nope')), { invalidate: [['todos']] })
      .catch(() => {
        rejected = true;
      });
    await settle();

    // The rejection is held back with the refetch: a cache that is consistent
    // "either way" has to include the way that failed.
    expect(rejected).toBe(false);

    gates[1]!.resolve(['a']);
    await running;
    expect(rejected).toBe(true);
  });

  it('invalidates by prefix', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const one = vi.fn(() => Promise.resolve('one'));
    const list = vi.fn(() => Promise.resolve(['one']));
    hold(client.observe({ key: ['users', 1], fetcher: one }));
    hold(client.observe({ key: ['users'], fetcher: list }));
    await settle();

    await client.mutate(() => Promise.resolve(null), { invalidate: [['users']] });

    expect(one).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('takes a value as well as an updater', async () => {
    const client = makeClient();
    client.setData(['users', 1], { id: 1, name: 'Ada' });

    await expect(
      client.mutate(() => Promise.reject(new Error('nope')), {
        optimistic: [optimistic(['users', 1], { id: 1, name: 'Ada L.' })],
      }),
    ).rejects.toThrow('nope');

    expect(client.getData(['users', 1])).toEqual({ id: 1, name: 'Ada' });
  });
});

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

describe('failure', () => {
  it('records the error rather than rejecting out of refetch', async () => {
    const client = makeClient();
    const query = hold(
      client.observe({
        key: ['users', 1],
        fetcher: () => {
          throw new Error('down');
        },
      }),
    ).query;
    await settle();

    expect(query.status()).toBe('error');
    expect(query.isError()).toBe(true);
    expect((query.error() as Error).message).toBe('down');
    await expect(query.refetch()).resolves.toBeUndefined();
  });

  it('resolves the imperative fetch with nothing, leaving the error on the entry', async () => {
    const client = makeClient();
    const fetcher = () => {
      throw new Error('down');
    };
    const query = hold(client.observe({ key: ['users', 1], fetcher })).query;
    await settle();

    // Nothing awaits a fetch from a template or a handler, so rejecting here
    // would be an unhandled rejection rather than a state.
    await expect(client.fetch({ key: ['users', 1], fetcher })).resolves.toBeUndefined();
    expect((query.error() as Error).message).toBe('down');
  });

  it('refuses a key it cannot compare by value', () => {
    const client = makeClient();
    expect(() => client.observe({ key: ['x', new Map()], fetcher: () => 'Ada' })).toThrow(
      /comparable by value/,
    );
    expect(client.size()).toBe(0);
  });

  it('keeps the last good data through a later failure', async () => {
    const client = makeClient();
    let succeed = true;
    const query = hold(
      client.observe({
        key: ['users', 1],
        fetcher: () => {
          if (!succeed) throw new Error('dropped');
          return 'Ada';
        },
      }),
    ).query;
    await settle();

    succeed = false;
    await query.refetch();
    await settle();

    expect(query.status()).toBe('error');
    expect(query.data()).toBe('Ada');
  });

  it('retries the number of times the entry was configured for', async () => {
    useClock();
    const client = makeClient();
    const fetcher = vi.fn(() => {
      throw new Error('down');
    });
    const query = hold(
      client.observe({ key: ['users', 1], fetcher, retry: 2, retryDelay: () => 10 }),
    ).query;

    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(10);
    await advance(10);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(query.status()).toBe('error');
  });

  it('does not retry by default', async () => {
    useClock();
    const client = makeClient();
    const fetcher = vi.fn(() => {
      throw new Error('down');
    });
    hold(client.observe({ key: ['users', 1], fetcher }));
    await advance(60_000);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stops retrying when the failure will not change', async () => {
    useClock();
    const client = makeClient();
    const fetcher = vi.fn(() => {
      throw new Error('404');
    });
    hold(
      client.observe({
        key: ['users', 1],
        fetcher,
        retry: 5,
        retryDelay: () => 10,
        shouldRetry: (error) => (error as Error).message !== '404',
      }),
    );
    await advance(60_000);

    // A 404 is a fact about the request, and five more of them only make the
    // user wait longer for the same answer.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('counts the attempts it hands the fetcher', async () => {
    useClock();
    const client = makeClient();
    const attempts: number[] = [];
    hold(
      client.observe({
        key: ['users', 1],
        fetcher: ({ attempt }) => {
          attempts.push(attempt);
          if (attempt < 2) throw new Error('down');
          return 'Ada';
        },
        retry: 3,
        retryDelay: () => 10,
      }),
    );
    await advance(10);
    await advance(10);

    expect(attempts).toEqual([0, 1, 2]);
    expect(client.getData(['users', 1])).toBe('Ada');
  });

  it('holds one shared request open across a retry', async () => {
    useClock();
    const client = makeClient();
    let calls = 0;
    const fetcher = () => {
      calls += 1;
      if (calls === 1) throw new Error('down');
      return 'Ada';
    };

    hold(client.observe({ key: ['users', 1], fetcher, retry: 1, retryDelay: () => 10 }));
    await settle();

    // Mid-backoff there is nothing in flight, but the request is not over
    // either — a subscriber arriving now must wait for it, not start a second.
    hold(client.observe({ key: ['users', 1], fetcher, retry: 1, retryDelay: () => 10 }));
    expect(calls).toBe(1);

    await advance(10);
    expect(calls).toBe(2);
    expect(client.getData(['users', 1])).toBe('Ada');
  });
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

describe('initial data', () => {
  it('seeds an entry that holds nothing', () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const fetcher = vi.fn(() => Promise.resolve('fetched'));
    const query = hold(
      client.observe({ key: ['users', 1], fetcher, initialData: 'server' }),
    ).query;

    expect(query.data()).toBe('server');
    expect(query.status()).toBe('success');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not overwrite what the entry already learned', async () => {
    const client = makeClient();
    const fetcher = vi.fn(() => Promise.resolve('fetched'));
    const first = client.observe({ key: ['users', 1], fetcher });
    await settle();
    first.release();

    const second = hold(client.observe({ key: ['users', 1], fetcher, initialData: 'server' }));
    // A prop passed at construction is older news than a response that landed.
    expect(second.query.data()).toBe('fetched');
  });

  it('does not seed over a request that is already in flight', async () => {
    const client = makeClient({ staleTime: 60_000 });
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    const a = hold(client.observe({ key: ['users', 1], fetcher }));
    // A second component mounting with a server payload. The entry holds
    // nothing yet, but it is already being told what it holds.
    hold(client.observe({ key: ['users', 1], fetcher, initialData: 'server' }));
    expect(fetcher).toHaveBeenCalledTimes(1);

    gate.resolve('Ada');
    await settle();

    expect(a.query.data()).toBe('Ada');
  });

  it('revalidates behind the seed at the default staleTime', () => {
    const client = makeClient();
    const fetcher = vi.fn(() => Promise.resolve('fetched'));
    const query = hold(
      client.observe({ key: ['users', 1], fetcher, initialData: 'server' }),
    ).query;

    expect(query.data()).toBe('server');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe('configuration', () => {
  it('takes the fetcher of whoever subscribed most recently', async () => {
    const client = makeClient();
    const first = vi.fn(() => Promise.resolve('first'));
    const second = vi.fn(() => Promise.resolve('second'));

    const a = client.observe({ key: ['users', 1], fetcher: first });
    await settle();
    a.release();

    // A component re-created with a fresh closure is the case this exists for.
    const b = hold(client.observe({ key: ['users', 1], fetcher: second }));
    await settle();
    expect(b.query.data()).toBe('second');
  });

  it('lets an entry override the cache default', async () => {
    useClock();
    const client = makeClient({ staleTime: 0 });
    const fetcher = vi.fn(() => Promise.resolve('Ada'));

    const first = client.observe({ key: ['users', 1], fetcher, staleTime: 1000 });
    await settle();
    first.release();
    await advance(500);

    hold(client.observe({ key: ['users', 1], fetcher, staleTime: 1000 }));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
