/**
 * `createQuery` — one component's view of one entry.
 *
 * The cache is tested on its own, so what is left here is the part that belongs
 * to the component: a key that is allowed to change, a subscription that lasts
 * exactly as long as the scope, and the release on unmount that is what makes
 * the cache's last-one-out cancellation ever happen in a real application.
 *
 * The mounted half exists because that release only works if disposal reaches
 * it through the real component lifecycle, and a directly-created scope proves
 * less than a component that goes away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import {
  Component,
  Signal,
  createRequestScope,
  createRoot,
  flushSync,
  mount,
  settleRequest,
} from '@voltdev/core';
import {
  createQueryClient,
  provideQueryClient,
  useQueryClient,
  type QueryClient,
  type QueryFetcher,
} from '../src/client.js';
import { createQuery } from '../src/query.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let disposers: (() => void)[] = [];
let mounted: { unmount(): void }[] = [];
let clients: QueryClient[] = [];
let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app') as HTMLElement;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
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

/** Build something inside a scope the test tears down afterwards. */
function withScope<T>(build: () => T): T {
  let value!: T;
  createRoot((dispose) => {
    disposers.push(dispose);
    value = build();
  });
  // The first run of a user effect is deferred, so nothing is subscribed until
  // the queue drains — which is exactly what a component's first paint does.
  flushSync();
  return value;
}

/** Build inside a scope the test disposes by hand, to stand in for an unmount. */
function withDisposableScope<T>(build: () => T): { value: T; dispose: () => void } {
  let value!: T;
  let dispose!: () => void;
  createRoot((end) => {
    dispose = end;
    value = build();
  });
  flushSync();
  return { value, dispose };
}

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
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

// ---------------------------------------------------------------------------
// Following a key
// ---------------------------------------------------------------------------

describe('following a key', () => {
  it('subscribes to the key it is given', async () => {
    const client = makeClient();
    const fetcher = vi.fn(() => Promise.resolve('Ada'));
    const query = withScope(() => createQuery({ key: ['users', 1], fetcher, client }));

    expect(query.key()).toEqual(['users', 1]);
    expect(query.isLoading()).toBe(true);
    await settle();
    expect(query.data()).toBe('Ada');
    expect(query.status()).toBe('success');
  });

  it('swaps entries when the key changes', async () => {
    const client = makeClient();
    const id = new Signal.State(1);
    const fetcher = vi.fn(({ key }: { key: readonly unknown[] }) => Promise.resolve(`user ${key[1]}`));
    const query = withScope(() => createQuery({ key: () => ['users', id.get()], fetcher, client }));
    await settle();
    expect(query.data()).toBe('user 1');

    id.set(2);
    await settle();

    expect(query.key()).toEqual(['users', 2]);
    expect(query.data()).toBe('user 2');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('shows what is already cached the moment the key changes back', async () => {
    const client = makeClient({ staleTime: 60_000 });
    const id = new Signal.State(1);
    const fetcher = vi.fn(({ key }: { key: readonly unknown[] }) => Promise.resolve(`user ${key[1]}`));
    const query = withScope(() => createQuery({ key: () => ['users', id.get()], fetcher, client }));
    await settle();

    id.set(2);
    await settle();
    id.set(1);
    flushSync();

    // Cached and still fresh: the card shows the other user immediately rather
    // than blanking while it asks again.
    expect(query.data()).toBe('user 1');
    expect(query.isFetching()).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not resubscribe when the key expression re-runs to the same key', async () => {
    const client = makeClient();
    const tick = new Signal.State(0);
    const fetcher = vi.fn(() => Promise.resolve('Ada'));
    withScope(() =>
      createQuery({
        // An unrelated signal read in the key expression: the key is the same
        // by value every time, and resubscribing means a cancel and a refetch.
        key: () => ['users', 1, { page: 1, tick: tick.get() > 100 }],
        fetcher,
        client,
      }),
    );
    await settle();

    tick.set(1);
    await settle();
    tick.set(2);
    await settle();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.size()).toBe(1);
  });

  it('releases the old key when it moves on', async () => {
    const client = makeClient();
    const id = new Signal.State(1);
    const gates = new Map<number, ReturnType<typeof deferred<string>>>();
    const signals = new Map<number, AbortSignal>();

    withScope(() =>
      createQuery({
        key: () => ['users', id.get()],
        fetcher: ({ key, signal }) => {
          const at = key[1] as number;
          signals.set(at, signal);
          const gate = deferred<string>();
          gates.set(at, gate);
          return gate.promise;
        },
        client,
      }),
    );

    id.set(2);
    flushSync();

    expect(signals.get(1)?.aborted).toBe(true);
    expect(signals.get(2)?.aborted).toBe(false);
  });

  it('shares one request with another query on the same key', async () => {
    const client = makeClient();
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    const a = withScope(() => createQuery({ key: ['users', 1], fetcher, client }));
    const b = withScope(() => createQuery({ key: ['users', 1], fetcher, client }));

    expect(fetcher).toHaveBeenCalledTimes(1);
    gate.resolve('Ada');
    await settle();

    expect(a.data()).toBe('Ada');
    expect(b.data()).toBe('Ada');
  });

});

// ---------------------------------------------------------------------------
// Which cache
// ---------------------------------------------------------------------------

describe('the cache in scope', () => {
  it('hands a query the cache its scope was given', async () => {
    const client = makeClient();
    const fetcher = vi.fn(() => Promise.resolve('Ada'));
    const query = withScope(() => {
      provideQueryClient(client);
      return createQuery({ key: ['users', 1], fetcher });
    });
    await settle();

    expect(query.data()).toBe('Ada');
    expect(client.getData(['users', 1])).toBe('Ada');
  });

  it('keeps two scopes on caches of their own', async () => {
    const one = makeClient();
    const two = makeClient();
    const fetcher = vi.fn(() => Promise.resolve('Ada'));
    const a = withScope(() => {
      provideQueryClient(one);
      return createQuery({ key: ['users', 1], fetcher });
    });
    const b = withScope(() => {
      provideQueryClient(two);
      return createQuery({ key: ['users', 1], fetcher });
    });
    await settle();

    // The whole reason the cache is not a module-level value: on a server these
    // two scopes are two requests, and one cache would answer the second with
    // the first user's data.
    expect(fetcher).toHaveBeenCalledTimes(2);
    one.setData(['users', 1], 'Grace');
    expect(a.data()).toBe('Grace');
    expect(b.data()).toBe('Ada');
  });

  it('lets a query name a cache of its own', async () => {
    const scoped = makeClient();
    const own = makeClient();
    const fetcher = vi.fn(() => Promise.resolve('Ada'));
    withScope(() => {
      provideQueryClient(scoped);
      return createQuery({ key: ['users', 1], fetcher, client: own });
    });
    await settle();

    expect(own.getData(['users', 1])).toBe('Ada');
    expect(scoped.size()).toBe(0);
  });

  it('refuses to invent a cache when the scope has none', () => {
    const fetcher = vi.fn(() => Promise.resolve('Ada'));

    // A cache conjured here would be a second one nobody can reach, holding the
    // answers the application's own is missing.
    expect(() => withScope(() => createQuery({ key: ['users', 1], fetcher }))).toThrow(
      /provideQueryClient/,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('says what to do when it is asked for outside a scope', () => {
    expect(() => useQueryClient()).toThrow(/No query cache in scope/);
  });

  it('reaches a component mounted under the provider', async () => {
    const client = makeClient();
    const fetcher = vi.fn(() => Promise.resolve('Ada'));

    @Component({ selector: 'v-scoped-card', render: compileTemplate('<p>{ user.data() }</p>') })
    class ScopedCard {
      user = createQuery({ key: ['users', 1], fetcher });
    }

    createRoot((dispose) => {
      disposers.push(dispose);
      provideQueryClient(client);
      // The application's own shape: provided once where it boots, found by
      // every component under it without any of them naming a cache.
      track(mount(ScopedCard, host));
    });
    await settle();

    expect(client.getData(['users', 1])).toBe('Ada');
    expect(host.textContent).toContain('Ada');
  });
});

// ---------------------------------------------------------------------------
// enabled
// ---------------------------------------------------------------------------

describe('enabled', () => {
  it('asks nothing while it is off', async () => {
    const client = makeClient();
    const fetcher = vi.fn(() => Promise.resolve('Ada'));
    const query = withScope(() =>
      createQuery({ key: ['users', 1], fetcher, client, enabled: () => false }),
    );
    await settle();

    expect(fetcher).not.toHaveBeenCalled();
    expect(query.status()).toBe('idle');
    expect(query.key()).toBeNull();
    expect(query.data()).toBeUndefined();
    expect(client.size()).toBe(0);
  });

  it('subscribes as soon as it is turned on', async () => {
    const client = makeClient();
    const selected = new Signal.State<number | null>(null);
    const fetcher = vi.fn(() => Promise.resolve('Ada'));
    const query = withScope(() =>
      createQuery({
        key: () => ['users', selected.get()],
        fetcher,
        client,
        enabled: () => selected.get() !== null,
      }),
    );
    await settle();
    expect(fetcher).not.toHaveBeenCalled();

    selected.set(1);
    await settle();

    expect(query.data()).toBe('Ada');
    expect(query.key()).toEqual(['users', 1]);
  });

  it('lets go of the entry when it is turned off, keeping its data', async () => {
    const client = makeClient();
    const on = new Signal.State(true);
    const query = withScope(() =>
      createQuery({
        key: ['users', 1],
        fetcher: () => Promise.resolve('Ada'),
        client,
        enabled: () => on.get(),
      }),
    );
    await settle();
    expect(query.data()).toBe('Ada');

    on.set(false);
    flushSync();
    expect(query.status()).toBe('idle');
    expect(query.data()).toBeUndefined();

    on.set(true);
    flushSync();
    // The entry kept its data, so turning it back on shows it again at once.
    expect(query.data()).toBe('Ada');
  });

  it('cancels the request it was waiting on', async () => {
    const client = makeClient();
    const on = new Signal.State(true);
    let signal!: AbortSignal;
    withScope(() =>
      createQuery({
        key: ['users', 1],
        fetcher: ({ signal: s }) => {
          signal = s;
          return deferred<string>().promise;
        },
        client,
        enabled: () => on.get(),
      }),
    );

    on.set(false);
    flushSync();
    expect(signal.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------

describe('disposal', () => {
  it('releases the subscription when the scope ends', async () => {
    const client = makeClient();
    let signal!: AbortSignal;
    const { dispose } = withDisposableScope(() =>
      createQuery({
        key: ['users', 1],
        fetcher: ({ signal: s }) => {
          signal = s;
          return deferred<string>().promise;
        },
        client,
      }),
    );

    dispose();
    expect(signal.aborted).toBe(true);
  });

  it('leaves a request alone while another query still wants it', async () => {
    const client = makeClient();
    let signal!: AbortSignal;
    const fetcher = ({ signal: s }: { signal: AbortSignal }) => {
      signal = s;
      return deferred<string>().promise;
    };

    const first = withDisposableScope(() => createQuery({ key: ['users', 1], fetcher, client }));
    withScope(() => createQuery({ key: ['users', 1], fetcher, client }));

    first.dispose();
    expect(signal.aborted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Writing through the query
// ---------------------------------------------------------------------------

describe('writing through the query', () => {
  it('refetches on demand', async () => {
    const client = makeClient({ staleTime: 60_000 });
    let call = 0;
    const query = withScope(() =>
      createQuery({ key: ['users', 1], fetcher: () => Promise.resolve(`call ${++call}`), client }),
    );
    await settle();
    expect(query.data()).toBe('call 1');

    await query.refetch();
    await settle();
    // A Retry button runs at once, whatever the staleness clock says.
    expect(query.data()).toBe('call 2');
  });

  it('writes the cache, not a copy of it', async () => {
    const client = makeClient();
    const query = withScope(() =>
      createQuery({ key: ['users', 1], fetcher: () => Promise.resolve('Ada'), client }),
    );
    await settle();

    query.setData('Grace');
    expect(client.getData(['users', 1])).toBe('Grace');
  });

  it('does nothing at all while disabled', async () => {
    const client = makeClient();
    const query = withScope(() =>
      createQuery({
        key: ['users', 1],
        fetcher: () => Promise.resolve('Ada'),
        client,
        enabled: () => false,
      }),
    );
    await settle();

    query.setData('Grace');
    await expect(query.refetch()).resolves.toBeUndefined();
    expect(client.size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Seeding a key that is allowed to change
// ---------------------------------------------------------------------------

describe('initial data', () => {
  it('seeds the key it was rendered for', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const fetcher = vi.fn(() => Promise.resolve('fetched'));
    const query = withScope(() =>
      createQuery({ key: ['users', 1], fetcher, client, initialData: 'server' }),
    );

    expect(query.data()).toBe('server');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not carry the seed onto the next key', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const id = new Signal.State(1);
    const fetcher = vi.fn(({ key }) => Promise.resolve(`user ${key[1]}`));
    const query = withScope(() =>
      createQuery({ key: () => ['users', id.get()], fetcher, client, initialData: 'server' }),
    );
    expect(query.data()).toBe('server');

    id.set(2);
    flushSync();
    await settle();

    // A payload rendered for user 1 is not information about user 2 — and a
    // seeded entry counts as fresh, so filing it under the second key would
    // show the wrong user for as long as the tab stayed open.
    expect(query.data()).toBe('user 2');
    expect(client.getData(['users', 2])).toBe('user 2');
  });

  it('does not seed again when the key comes back', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const id = new Signal.State(1);
    const fetcher = vi.fn(({ key }) => Promise.resolve(`user ${key[1]}`));
    const query = withScope(() =>
      createQuery({ key: () => ['users', id.get()], fetcher, client, initialData: 'server' }),
    );

    id.set(2);
    flushSync();
    await settle();
    client.remove(['users', 1]);

    id.set(1);
    flushSync();
    await settle();

    // The seed is spent. What comes back is what the server says now, not the
    // payload this component was rendered with however long ago.
    expect(query.data()).toBe('user 1');
  });

  it('spends the seed on the first key it actually observes', async () => {
    const client = makeClient({ staleTime: Number.POSITIVE_INFINITY });
    const on = new Signal.State(false);
    const fetcher = vi.fn(() => Promise.resolve('fetched'));
    const query = withScope(() =>
      createQuery({ key: ['users', 1], fetcher, client, enabled: () => on.get(), initialData: 'server' }),
    );
    expect(query.data()).toBeUndefined();

    on.set(true);
    flushSync();

    // Starting disabled must not throw the payload away: nothing was observed
    // while it was off, so nothing has been seeded yet.
    expect(query.data()).toBe('server');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Keeping the previous page
// ---------------------------------------------------------------------------

describe('keepPreviousData', () => {
  it('holds the last page on screen while the next one loads', async () => {
    const client = makeClient();
    const page = new Signal.State(1);
    const gates = [deferred<string>(), deferred<string>()];
    const query = withScope(() =>
      createQuery({
        key: () => ['rows', page.get()],
        fetcher: ({ key }) => gates[(key[1] as number) - 1]!.promise,
        client,
        keepPreviousData: true,
      }),
    );

    gates[0]!.resolve('page one');
    await settle();
    expect(query.data()).toBe('page one');
    expect(query.isPlaceholder()).toBe(false);

    page.set(2);
    flushSync();

    // The rows do not vanish. A template branching on status keeps rendering
    // them, and the spinner is the one `isFetching` puts beside them.
    expect(query.data()).toBe('page one');
    expect(query.isPlaceholder()).toBe(true);
    expect(query.isLoading()).toBe(false);
    expect(query.status()).toBe('success');
    expect(query.isFetching()).toBe(true);

    gates[1]!.resolve('page two');
    await settle();

    expect(query.data()).toBe('page two');
    expect(query.isPlaceholder()).toBe(false);
    expect(query.isFetching()).toBe(false);
  });

  it('lets go of the held page when the next one fails', async () => {
    const client = makeClient();
    const page = new Signal.State(1);
    const query = withScope(() =>
      createQuery({
        key: () => ['rows', page.get()],
        fetcher: ({ key }) => {
          if ((key[1] as number) === 1) return Promise.resolve('page one');
          throw new Error('down');
        },
        client,
        keepPreviousData: true,
      }),
    );
    await settle();

    page.set(2);
    flushSync();
    await settle();

    // Reporting success and an error at once is the state this avoids: the
    // user asked to leave page one, and needs to be told that it did not work.
    expect(query.isError()).toBe(true);
    expect(query.status()).toBe('error');
    expect(query.isPlaceholder()).toBe(false);
    expect(query.data()).toBeUndefined();
  });

  it('lets go of the held page once the new one has answered', async () => {
    const client = makeClient();
    const page = new Signal.State(1);
    const query = withScope(() =>
      createQuery({
        key: () => ['rows', page.get()],
        fetcher: ({ key }) => Promise.resolve(`page ${key[1]}`),
        client,
        keepPreviousData: true,
      }),
    );
    await settle();

    page.set(2);
    await settle();
    expect(query.data()).toBe('page 2');

    // Whatever empties the entry next — a removal, a sign-out, a websocket
    // write. Page one is not what this key holds, and a page held past the
    // moment it was needed is a flag only ever set.
    client.setData(['rows', 2], undefined);
    flushSync();

    expect(query.data()).toBeUndefined();
    expect(query.isPlaceholder()).toBe(false);
    expect(query.status()).toBe('idle');
  });

  it('shows a skeleton for the first page, having nothing to hold', () => {
    const client = makeClient();
    const query = withScope(() =>
      createQuery({
        key: ['rows', 1],
        fetcher: () => deferred<string>().promise,
        client,
        keepPreviousData: true,
      }),
    );

    expect(query.data()).toBeUndefined();
    expect(query.isPlaceholder()).toBe(false);
    expect(query.isLoading()).toBe(true);
  });

  it('blanks rather than holding the last page under no key at all', async () => {
    const client = makeClient();
    const on = new Signal.State(true);
    const query = withScope(() =>
      createQuery({
        key: ['rows', 1],
        fetcher: () => Promise.resolve('page one'),
        client,
        enabled: () => on.get(),
        keepPreviousData: true,
      }),
    );
    await settle();
    expect(query.data()).toBe('page one');

    on.set(false);
    flushSync();

    // Disabled means the application is not asking. Rows held over from a key
    // it has stopped asking about are rows nobody requested.
    expect(query.data()).toBeUndefined();
    expect(query.isPlaceholder()).toBe(false);
    expect(query.status()).toBe('idle');
  });

  it('lets the page blank when it is not asked for', async () => {
    const client = makeClient();
    const page = new Signal.State(1);
    const gate = deferred<string>();
    const query = withScope(() =>
      createQuery({
        key: () => ['rows', page.get()],
        fetcher: ({ key }) => ((key[1] as number) === 1 ? Promise.resolve('page one') : gate.promise),
        client,
      }),
    );
    await settle();

    page.set(2);
    flushSync();

    expect(query.data()).toBeUndefined();
    expect(query.isLoading()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Through a mounted component
// ---------------------------------------------------------------------------

const CARD_TEMPLATE = `
  <article class="card">
    <p :if="user.isLoading()" class="skeleton">Loading…</p>
    <p :if="user.isError()" class="failed">Could not load that user.</p>
    <p :if="user.data()" class="name" :class="{ stale: user.isFetching() }">{ user.data() }</p>
  </article>
`;

function mountCard(client: QueryClient, fetcher: QueryFetcher<string>) {
  @Component({ selector: 'v-user-card', render: compileTemplate(CARD_TEMPLATE) })
  class UserCard {
    user = createQuery({ key: ['users', 1], fetcher, client });
  }

  const handle = track(mount(UserCard, host));
  flushSync();
  return {
    handle,
    name: () => host.querySelector('.name'),
    skeleton: () => host.querySelector('.skeleton'),
    failed: () => host.querySelector('.failed'),
  };
}

describe('through a mounted component', () => {
  it('shows a skeleton, then the data', async () => {
    const client = makeClient();
    const gate = deferred<string>();
    const ui = mountCard(client, () => gate.promise);

    expect(ui.skeleton()).not.toBeNull();
    expect(ui.name()).toBeNull();

    gate.resolve('Ada');
    await settle();

    expect(ui.skeleton()).toBeNull();
    expect(ui.name()?.textContent).toBe('Ada');
  });

  it('keeps the data on screen while it revalidates behind it', async () => {
    const client = makeClient();
    const answers = ['Ada', 'Ada L.'];
    const first = mountCard(client, () => Promise.resolve(answers.shift() as string));
    await settle();
    first.handle.unmount();
    mounted = mounted.filter((handle) => handle !== first.handle);

    const second = mountCard(client, () => Promise.resolve(answers[0] as string));
    // The list is not swapped for a spinner while the cache goes to check —
    // which is the whole point of stale-while-revalidate.
    expect(second.skeleton()).toBeNull();
    expect(second.name()?.textContent).toBe('Ada');
    expect(second.name()?.classList.contains('stale')).toBe(true);

    await settle();
    expect(second.name()?.textContent).toBe('Ada L.');
    expect(second.name()?.classList.contains('stale')).toBe(false);
  });

  it('shows the failure without a skeleton behind it', async () => {
    const client = makeClient();
    const ui = mountCard(client, () => {
      throw new Error('down');
    });
    await settle();

    expect(ui.failed()).not.toBeNull();
    expect(ui.skeleton()).toBeNull();
  });

  it('cancels the request when the component unmounts', () => {
    const client = makeClient();
    let signal!: AbortSignal;
    const ui = mountCard(client, ({ signal: s }) => {
      signal = s;
      return deferred<string>().promise;
    });
    expect(ui.skeleton()).not.toBeNull();

    ui.handle.unmount();
    mounted = mounted.filter((handle) => handle !== ui.handle);

    // The whole lifetime story, end to end: nobody is waiting for this answer
    // any more, so it is not asked for any more.
    expect(signal.aborted).toBe(true);
    expect(client.size()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// On a server
// ---------------------------------------------------------------------------

describe('on a server', () => {
  /**
   * The build flag, which the test config compiles to a live read of this
   * global so one file can render both sides.
   */
  function serverBuild(on: boolean): void {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  }

  afterEach(() => serverBuild(false));

  it('asks during the render, and the render waits for the answer', async () => {
    const client = makeClient();
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    // Defined before the flag goes up, so the template is compiled for the DOM
    // host below; it is the flush, not the template, that is the server's.
    @Component({
      selector: 'v-user-server',
      render: compileTemplate(`<p>{ user.status() }: { user.data() ?? 'waiting' }</p>`),
    })
    class ServerUser {
      user = createQuery({ key: ['users', 1], fetcher, client });
    }

    // A server flush drains the data lane and never the user lane, so a query
    // that subscribed from a user effect would never ask here — and one whose
    // request the render did not wait for would ship its skeleton.
    serverBuild(true);
    const scope = createRequestScope();
    const rendered = settleRequest(scope, () => {
      track(mount(ServerUser, host));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    gate.resolve('Ada');
    await rendered;

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.innerHTML).toContain('<p>success: Ada</p>');
  });
});
