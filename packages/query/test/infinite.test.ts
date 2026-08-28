/**
 * Infinite queries.
 *
 * The cache and `createQuery` are tested on their own, so what is left here is
 * what a list of pages adds: that appending a page keeps the ones on screen,
 * that the cursor is read from the page that carried it, that a refetch asks
 * for every page the list is showing rather than only its first, and that two
 * scroll events do not ask for the same rows twice.
 *
 * Timing matters as much as it does in the cache tests: whether the pages
 * survive the moment the next request goes out is a synchronous question, and
 * a count checked after an `await` cannot answer it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Signal, createRoot, flushSync } from '@voltdev/core';
import { createQueryClient, provideQueryClient, type QueryClient } from '../src/client.js';
import { createInfiniteQuery } from '../src/infinite.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Page {
  readonly rows: readonly string[];
  readonly next?: number;
}

let disposers: (() => void)[] = [];
let clients: QueryClient[] = [];

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  for (const client of clients) client.clear();
  clients = [];
  flushSync();
  vi.useRealTimers();
});

function makeClient(...args: Parameters<typeof createQueryClient>): QueryClient {
  const client = createQueryClient(...args);
  clients.push(client);
  return client;
}

function withScope<T>(build: () => T): T {
  let value!: T;
  createRoot((dispose) => {
    disposers.push(dispose);
    value = build();
  });
  flushSync();
  return value;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function settle(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
    flushSync();
  }
}

/** A cursor server: page `n` carries one row and points at `n + 1` until the end. */
function pages(count: number) {
  const asked: number[] = [];
  const fetcher = vi.fn(({ pageParam }: { pageParam: number }) => {
    asked.push(pageParam);
    return Promise.resolve<Page>({
      rows: [`row ${pageParam}`],
      next: pageParam + 1 < count ? pageParam + 1 : undefined,
    });
  });
  return { asked, fetcher };
}

const nextCursor = (page: Page): number | undefined => page.next;

// ---------------------------------------------------------------------------
// The first page
// ---------------------------------------------------------------------------

describe('the first page', () => {
  it('is asked for with the cursor the query was given', async () => {
    const client = makeClient();
    const server = pages(3);
    const query = withScope(() =>
      createInfiniteQuery({
        key: ['rows'],
        client,
        initialPageParam: 0,
        fetcher: server.fetcher,
        getNextPageParam: nextCursor,
      }),
    );

    expect(query.isLoading()).toBe(true);
    await settle();

    expect(server.asked).toEqual([0]);
    expect(query.pages()).toEqual([{ rows: ['row 0'], next: 1 }]);
    expect(query.status()).toBe('success');
    expect(query.hasNextPage()).toBe(true);
  });

  it('has no next page before it has a first one', () => {
    const client = makeClient();
    const query = withScope(() =>
      createInfiniteQuery({
        key: ['rows'],
        client,
        initialPageParam: 0,
        fetcher: () => deferred<Page>().promise,
        getNextPageParam: nextCursor,
      }),
    );

    // "No pages yet" is not "one more page available": the first one is what
    // the query asks for on its own account, and a More button offered before
    // any rows exist asks for the page that is already in flight.
    expect(query.pages()).toEqual([]);
    expect(query.hasNextPage()).toBe(false);
  });

  it('takes the cache in scope, like any other query', async () => {
    const client = makeClient();
    const server = pages(1);
    const query = withScope(() => {
      provideQueryClient(client);
      return createInfiniteQuery({
        key: ['rows'],
        initialPageParam: 0,
        fetcher: server.fetcher,
        getNextPageParam: nextCursor,
      });
    });
    await settle();

    expect(query.pages()).toHaveLength(1);
    expect(client.getData(['rows'])).toEqual({
      pages: [{ rows: ['row 0'], next: undefined }],
      pageParams: [0],
    });
  });

  it('asks nothing while it is disabled', async () => {
    const client = makeClient();
    const server = pages(3);
    const query = withScope(() =>
      createInfiniteQuery({
        key: ['rows'],
        client,
        enabled: () => false,
        initialPageParam: 0,
        fetcher: server.fetcher,
        getNextPageParam: nextCursor,
      }),
    );
    await settle();
    await query.fetchNextPage();

    expect(server.fetcher).not.toHaveBeenCalled();
    expect(query.status()).toBe('idle');
    expect(query.pages()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Growing the list
// ---------------------------------------------------------------------------

describe('appending a page', () => {
  it('keeps the pages on screen while the next one loads', async () => {
    const client = makeClient();
    const gate = deferred<Page>();
    let call = 0;
    const query = withScope(() =>
      createInfiniteQuery({
        key: ['rows'],
        client,
        initialPageParam: 0,
        fetcher: ({ pageParam }) =>
          call++ === 0
            ? Promise.resolve<Page>({ rows: ['row 0'], next: 1 })
            : (expect(pageParam).toBe(1), gate.promise),
        getNextPageParam: nextCursor,
      }),
    );
    await settle();

    const growing = query.fetchNextPage();

    // Synchronously, while the request is out: the rows the reader is looking
    // at do not vanish, and nothing reads as a fresh load.
    expect(query.pages()).toEqual([{ rows: ['row 0'], next: 1 }]);
    expect(query.isFetchingNextPage()).toBe(true);
    expect(query.isFetching()).toBe(true);
    expect(query.isLoading()).toBe(false);
    expect(query.status()).toBe('success');

    gate.resolve({ rows: ['row 1'], next: undefined });
    await growing;
    await settle();

    expect(query.pages()).toEqual([
      { rows: ['row 0'], next: 1 },
      { rows: ['row 1'], next: undefined },
    ]);
    expect(query.isFetchingNextPage()).toBe(false);
    expect(query.hasNextPage()).toBe(false);
  });

  it('asks for one page when two scrolls arrive together', async () => {
    const client = makeClient();
    const server = pages(3);
    const query = withScope(() =>
      createInfiniteQuery({
        key: ['rows'],
        client,
        initialPageParam: 0,
        fetcher: server.fetcher,
        getNextPageParam: nextCursor,
      }),
    );
    await settle();

    // Two scroll handlers in one turn. Without a join the second supersedes the
    // first and both answer with the same rows.
    await Promise.all([query.fetchNextPage(), query.fetchNextPage()]);
    await settle();

    expect(server.asked).toEqual([0, 1]);
    expect(query.pages()).toHaveLength(2);
  });

  it('does nothing at the end of the list', async () => {
    const client = makeClient();
    const server = pages(1);
    const query = withScope(() =>
      createInfiniteQuery({
        key: ['rows'],
        client,
        initialPageParam: 0,
        fetcher: server.fetcher,
        getNextPageParam: nextCursor,
      }),
    );
    await settle();
    expect(query.hasNextPage()).toBe(false);

    await query.fetchNextPage();
    await settle();

    expect(server.asked).toEqual([0]);
    expect(query.pages()).toHaveLength(1);
  });

  it('retries the page it was appending, not the whole list', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const client = makeClient();
    const asked: number[] = [];
    let fail = true;
    const query = withScope(() =>
      createInfiniteQuery({
        key: ['rows'],
        client,
        initialPageParam: 0,
        retry: 1,
        retryDelay: () => 10,
        fetcher: ({ pageParam }) => {
          asked.push(pageParam);
          if (pageParam === 1 && fail) {
            fail = false;
            throw new Error('down');
          }
          return Promise.resolve<Page>({
            rows: [`row ${pageParam}`],
            next: pageParam + 1 < 3 ? pageParam + 1 : undefined,
          });
        },
        getNextPageParam: nextCursor,
      }),
    );
    await settle();

    const growing = query.fetchNextPage();
    await vi.advanceTimersByTimeAsync(20);
    await growing;
    await settle();

    // The retry repeats the request that failed. Deciding again from scratch
    // would turn one page's failure into a second request for every page the
    // list already has.
    expect(asked).toEqual([0, 1, 1]);
    expect(query.pages()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Asking again
// ---------------------------------------------------------------------------

describe('refetching', () => {
  it('asks for every page the list is showing', async () => {
    const client = makeClient();
    const server = pages(3);
    const query = withScope(() =>
      createInfiniteQuery({
        key: ['rows'],
        client,
        initialPageParam: 0,
        fetcher: server.fetcher,
        getNextPageParam: nextCursor,
      }),
    );
    await settle();
    await query.fetchNextPage();
    await settle();
    expect(server.asked).toEqual([0, 1]);

    await query.refetch();
    await settle();

    // Both pages, in order. Refetching only the first would leave the second
    // describing a list that has moved.
    expect(server.asked).toEqual([0, 1, 0, 1]);
    expect(query.pages()).toHaveLength(2);
  });

  it('takes each cursor from the page that just landed', async () => {
    const client = makeClient();
    const asked: number[] = [];
    // A feed with something inserted at the top between the two rounds: the
    // cursor that used to point at page two now points at what page one is
    // showing.
    let shift = 0;
    const fetcher = vi.fn(({ pageParam }: { pageParam: number }) => {
      asked.push(pageParam);
      return Promise.resolve<Page>({ rows: [`row ${pageParam}`], next: pageParam + 1 + shift });
    });
    const query = withScope(() =>
      createInfiniteQuery({
        key: ['rows'],
        client,
        initialPageParam: 0,
        fetcher,
        getNextPageParam: nextCursor,
      }),
    );
    await settle();
    await query.fetchNextPage();
    await settle();
    expect(asked).toEqual([0, 1]);

    shift = 10;
    await query.refetch();
    await settle();

    // The second round asks 0 and then 11 — the cursor the fresh first page
    // handed back. Replaying the stored one would ask for a window the server
    // has already moved, and the reader would see a row twice.
    expect(asked).toEqual([0, 1, 0, 11]);
    expect(query.pages()).toEqual([
      { rows: ['row 0'], next: 11 },
      { rows: ['row 11'], next: 22 },
    ]);
  });

  it('drops the pages a shortened list no longer has', async () => {
    const client = makeClient();
    let count = 3;
    const asked: number[] = [];
    const query = withScope(() =>
      createInfiniteQuery({
        key: ['rows'],
        client,
        initialPageParam: 0,
        fetcher: ({ pageParam }) => {
          asked.push(pageParam);
          return Promise.resolve<Page>({
            rows: [`row ${pageParam}`],
            next: pageParam + 1 < count ? pageParam + 1 : undefined,
          });
        },
        getNextPageParam: nextCursor,
      }),
    );
    await settle();
    await query.fetchNextPage();
    await settle();
    expect(query.pages()).toHaveLength(2);

    count = 1;
    await query.refetch();
    await settle();

    // The walk ends where the fresh data does. Keeping the second page would
    // leave rows on screen the list no longer contains.
    expect(asked).toEqual([0, 1, 0]);
    expect(query.pages()).toEqual([{ rows: ['row 0'], next: undefined }]);
    expect(query.hasNextPage()).toBe(false);
  });

  it('refetches the whole list when something supersedes an append', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const asked: number[] = [];
    const stuck = deferred<Page>();
    const query = withScope(() =>
      createInfiniteQuery({
        key: ['rows'],
        client,
        initialPageParam: 0,
        fetcher: ({ pageParam }) => {
          asked.push(pageParam);
          // The page being appended never answers; the invalidation below is
          // what takes the entry over.
          if (pageParam === 2) return stuck.promise;
          return Promise.resolve<Page>({ rows: [`row ${pageParam}`], next: pageParam + 1 });
        },
        getNextPageParam: nextCursor,
      }),
    );
    await settle();
    await query.fetchNextPage();
    await settle();
    expect(asked).toEqual([0, 1]);

    const growing = query.fetchNextPage();
    expect(asked).toEqual([0, 1, 2]);

    await client.invalidate(['rows']);
    await growing;
    await settle();

    // The invalidation asks for the list, not for the page the abandoned append
    // was after: a list being revalidated is not the list that append was
    // computed against.
    expect(asked).toEqual([0, 1, 2, 0, 1]);
    expect(query.pages()).toHaveLength(2);
    expect(query.isFetchingNextPage()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// One entry, like any other
// ---------------------------------------------------------------------------

describe('sharing the entry', () => {
  it('follows a key that changes, dropping the pages of the old one', async () => {
    const client = makeClient();
    const feed = new Signal.State('news');
    const asked: string[] = [];
    const query = withScope(() =>
      createInfiniteQuery({
        key: () => ['rows', feed.get()],
        client,
        initialPageParam: 0,
        fetcher: ({ key, pageParam }) => {
          asked.push(`${key[1] as string}/${pageParam}`);
          return Promise.resolve<Page>({ rows: [`${key[1] as string} ${pageParam}`], next: 1 });
        },
        getNextPageParam: nextCursor,
      }),
    );
    await settle();

    feed.set('jobs');
    await settle();

    expect(asked).toEqual(['news/0', 'jobs/0']);
    expect(query.pages()).toEqual([{ rows: ['jobs 0'], next: 1 }]);
  });

  it('shares one request and one list with another query on the same key', async () => {
    const client = makeClient();
    const server = pages(3);
    const build = () =>
      createInfiniteQuery({
        key: ['rows'],
        client,
        initialPageParam: 0,
        fetcher: server.fetcher,
        getNextPageParam: nextCursor,
      });
    const a = withScope(build);
    const b = withScope(build);
    await settle();

    expect(server.asked).toEqual([0]);

    // One of them scrolls; both are showing the same list, because the pages
    // live in the entry rather than in either query.
    await a.fetchNextPage();
    await settle();

    expect(server.asked).toEqual([0, 1]);
    expect(b.pages()).toHaveLength(2);
  });
});
