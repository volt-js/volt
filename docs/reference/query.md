# Query cache

`@voltdev/query` is a cache for data that lives on a server: one entry per
question, so two components asking the same thing make one request between them.

::: warning Not on npm yet
`@voltdev/query` is not published. It works from a checkout of the Volt repository;
the packages on npm today are `@voltdev/core`, `@voltdev/reactivity`,
`@voltdev/compiler` and `@voltdev/vite-plugin`.
:::

```ts
import { Component } from '@voltdev/core';
import { createQuery } from '@voltdev/query';

@Component({ selector: 'v-user', templateUrl: './user.html' })
export class UserPanel {
  user = createQuery({
    key: ['users', 42],
    fetcher: ({ signal }) => fetch('/api/users/42', { signal }).then((r) => r.json()),
  });
}
```

```html
<p :if="user.isLoading()">Loading…</p>
<h1 :else>{ user.data()?.name }</h1>
```

## Beside `createResource`, not inside it

[`createResource`](./primitives-data) owns one request's lifecycle — a combobox
search, a form submission — and owns it well: a superseded response is dropped,
retries back off, a server render waits for it. Its state belongs to the
component that made it, which is right for a search box and wrong for data two
components both want. A user's name shown in the header and in a settings panel
is one answer, and two resources holding it are two requests and two copies that
can disagree.

This package is the layer above that: the answer belongs to the application,
filed under a key, and components *subscribe* to it. A resource is one request's
lifecycle; a cache is the application's.

## Keys

```ts
type QueryKey = readonly unknown[];
```

A key is an array describing the question, from general to specific:
`['users']`, `['users', 42]`, `['users', 42, 'posts', { page: 2 }]`. Two keys are
the same entry when their parts are equal **by value** — so the object literal a
component rebuilds on every read still hits the cache, and `{ page, filter }`
finds what `{ filter, page }` stored. Property order is not information.

A part can be a string, number, boolean, `null`, `undefined`, a bigint, a `Date`,
an array, or a plain object of those. A `Map`, a `Set` or a class instance is
**rejected with an error** rather than hashed. `JSON.stringify` would turn each of
them into `{}`, and two different keys hashing to the same `{}` is a cache that
serves one query's data to another.

Keys are **prefixes** when you act on them. Invalidating `['users']` reaches
`['users', 42]` and every list of users, which is how one mutation says "anything
about users may have changed" without enumerating what the screen is showing. The
comparison is part by part, not by string: `['user']` does not reach
`['users', 1]`, and `['a/b']` is not `['a', 'b']`. Joining a key into a string is
the implementation most caches reach for first, and it gets both of those wrong
silently.

## `createQuery`

```ts
createQuery<T>(options: QueryOptions<T>): Query<T>
```

| Option | Default | Description |
|---|---|---|
| `key` | — | The key, or a function of signals returning one |
| `fetcher` | — | `({ key, signal, attempt }) => T \| Promise<T>` |
| `enabled` | `() => true` | Gate on the key being worth asking about |
| `staleTime` | the client's (`0`) | How long data counts as fresh, in ms |
| `gcTime` | the client's (5 min) | How long an unwatched entry survives |
| `keepPreviousData` | `false` | While the key changes, keep showing the last key's data |
| `initialData` | — | Seeds the first entry observed, for a server-rendered payload |
| `retry`, `retryDelay`, `shouldRetry` | no retry | See [retrying](#retrying) |
| `client` | the one in scope | Which cache |

A function key is what makes a query follow a route parameter or a selected row:

```ts
import { Signal } from '@voltdev/core';
import { createQuery } from '@voltdev/query';

const selected = new Signal.State(1);

const user = createQuery({
  key: () => ['users', selected.get()],
  fetcher: ({ key, signal }) => fetch(`/api/users/${String(key[1])}`, { signal }).then((r) => r.json()),
});
```

Changing `selected` moves the query to another entry. The old one keeps its
data for `gcTime` in case the reader comes back.

`enabled` turning false releases the subscription — cancelling the request if
nothing else wants it — and leaves the query reading `'idle'`. The entry keeps
its data, so turning it back on shows it again at once.

`keepPreviousData` is what makes pagination not flicker: page 2 arrives into a
list still showing page 1 rather than into a skeleton, so the rows do not vanish
and the scroll position survives. `isPlaceholder()` says the data on screen
answers the previous key rather than this one.

`initialData` seeds only the first entry the query observes, and deliberately
does not follow the key. A payload for user 1 is not information about user 2,
and a seeded entry counts as fresh — filing it under the second key would show
the wrong user and never correct itself.

### Reading a query

| Member | Description |
|---|---|
| `data()` | What is cached, or `undefined` |
| `error()` | The last failure, as thrown |
| `status()` | `'idle'`, `'loading'`, `'success'` or `'error'` |
| `isLoading()` | Fetching with nothing to show yet — render a skeleton |
| `isFetching()` | Any request in flight — render a spinner beside the data |
| `isError()` | Whether the last attempt failed |
| `isStale()` | Whether the next subscriber would refetch. A snapshot; the clock is not reactive |
| `isPlaceholder()` | Whether `data()` answers a key this query has moved on from |
| `updatedAt()` | When data last landed, as `Date.now()`; `0` if it never has |
| `key()` | The key being read, or `null` while `enabled` is false |
| `refetch()` | Ask again now, superseding anything in flight. Never rejects |
| `setData(next)` | Write this entry locally; anything in flight is abandoned |

`isLoading` and `isFetching` are two because they call for two different things
on screen. The first means there is nothing to show; the second means there is,
and it may be about to change. Collapsing them is how an application ends up
blanking a page of data every time it refreshes it.

## Freshness

`staleTime` defaults to **0**: every new subscriber revalidates, serving what is
cached while it does. That is deliberate. The two mistakes do not cost the same
— a request that did not need making is bandwidth, and data older than the
reader assumed is a wrong screen — so the default errs towards asking. Raise it
per query where the answer genuinely does not move.

Stale data is still served. A stale entry is shown immediately and refetched
behind it; the reader sees the old answer and then the new one, never a blank.

`gcTime` defaults to five minutes: how long an entry nobody is watching survives
before it is dropped. `Infinity` keeps it for the life of the cache.

## Changing data

```ts
import { createQueryClient, optimistic } from '@voltdev/query';

interface User { id: number; name: string }

const client = createQueryClient();

await client.mutate(() => api.rename(42, 'Ada'), {
  optimistic: [optimistic<User>(['users', 42], (user) => user && { ...user, name: 'Ada' })],
  invalidate: [['users']],
});
```

`mutate` applies the optimistic writes, runs the call, and **puts the old values
back if it throws**. Either way it then marks the `invalidate` keys stale and
waits for the refetches, so when it resolves — or rejects — the cache is
consistent and the screen has caught up.

| `MutateOptions` | Description |
|---|---|
| `optimistic` | Writes applied before the call and undone if it fails. Exact keys: an optimistic update is a value, and a prefix does not name one |
| `invalidate` | Keys marked stale once the call settles. Prefixes |

`optimistic(key, next)` exists for the type system. A list of writes to
different entries has to be typed at `unknown`, and an updater is contravariant
in its parameter, so `(list: Todo[]) => Todo[]` will not fit in one on its own.
The helper does that single unchecked step so the call site keeps its inference.

## The client

```ts
createQueryClient(defaults?: QueryClientOptions): QueryClient
```

Defaults are `staleTime`, `gcTime` and the retry options, applied to every
entry that does not say otherwise.

| Member | Description |
|---|---|
| `observe(options)` | Take a subscription on a key. `createQuery` is this plus an effect that follows a reactive key |
| `fetch(options)` | Fetch once and resolve with the data, joining a request in flight. Never rejects |
| `getData(key)` | What is cached now. A snapshot |
| `setData(key, next)` | Write the cache directly — the row a mutation returned, a websocket message |
| `invalidate(key, filter?)` | Mark everything at or under a key stale. Watched entries refetch now |
| `remove(key, filter?)` | Drop everything at or under a key. Watched entries are emptied and asked again |
| `clear()` | Drop all of it, asking nothing again — a sign-out, a test tearing down |
| `mutate(run, options?)` | See above |
| `keys()`, `size()` | What is held, for tests and for reasoning about lifetime |

`setData` abandons anything in flight for that key, because a response already
on its way carries exactly what was just replaced.

`QueryFilter` narrows `invalidate` and `remove`: `exact: true` matches the key
alone rather than everything under it, and `predicate(key)` narrows further for
entries a key shape cannot name — every list whose filter mentions a team. The
predicate is applied *on top of* the key, so it can never reach outside it.

### Which cache

```ts
import { createQueryClient, provideQueryClient, useQueryClient } from '@voltdev/query';

const client = provideQueryClient(createQueryClient());
```

`provideQueryClient` puts a cache in scope for everything created under it;
`useQueryClient` reads it. On a server this is how each request gets its own
cache, which it must: a module-level cache on a server is shared by every
response the process is assembling at once, and one reader's data ends up in
another's page.

A query asks for its data during a server render, as a resource does: it
follows its key from a [data effect](./reactivity#effects), which a server's
flush drains, and [`settleRequest`](./server#settlerequest) waits for the
request before the page is written.

Nothing is collected on a server. The cache is that one request's and is
dropped whole once the response is written, so `gcTime` starts no clock there —
a timer for it would outlive the response, and a process that renders a page
and exits would wait on the event loop until it fired.

`useQueryClient` **throws** when there is no cache in scope rather than making
one. The alternative is a second cache nobody can see, holding the answers the
first one is missing.

## Infinite lists

```ts
createInfiniteQuery<T, P>(options: InfiniteQueryOptions<T, P>): InfiniteQuery<T, P>
```

A list that grows a page at a time is **one** question — "the rows, from the
start" — so it is one entry holding every page fetched for it, not an entry per
page that nothing knows how to put back together.

```ts
import { createInfiniteQuery } from '@voltdev/query';

interface Page { rows: string[]; next?: number }

const feed = createInfiniteQuery<Page, number>({
  key: ['feed'],
  initialPageParam: 0,
  fetcher: ({ pageParam, signal }) =>
    fetch(`/api/feed?cursor=${pageParam}`, { signal }).then((r) => r.json()),
  getNextPageParam: (last) => last.next,
});
```

```html
<button :click="feed.fetchNextPage()" :disabled="!feed.hasNextPage()">More</button>
```

| Option | Description |
|---|---|
| `initialPageParam` | The cursor the first page is asked for with |
| `getNextPageParam` | `(lastPage, pages, lastPageParam) => cursor \| undefined`. `undefined` ends the list |
| `fetcher` | Told `pageParam` beside the usual `key`, `signal` and `attempt` |

It takes `key`, `enabled`, `staleTime`, `gcTime`, `client` and the retry options
like `createQuery`, and adds:

| Member | Description |
|---|---|
| `pages()` | The pages in order. Empty until the first lands |
| `hasNextPage()` | Whether `getNextPageParam` named a page after the last one |
| `isFetchingNextPage()` | A page is being appended — `isFetching()` is any request |
| `fetchNextPage()` | Ask for the next page and append it. Never rejects |

A second `fetchNextPage()` while one is in flight joins it rather than asking for
the same page twice — two scroll events in one turn are one page.

**Refetching refetches the list.** Revalidation asks for every page on screen
again, in order, taking each cursor from the page that just arrived rather than
from the one it replaced: a cursor is a position in data the server has already
changed, and the old one asks for a window that has moved. A list that has
shrunk ends the walk early, which is how pages that no longer exist go away. It
also means a refetch of a long list costs one request per page.

An invalidation that arrives while a page is being appended wins: the append is
abandoned and the whole list is refetched, since a list being revalidated is not
the list that append was computed against.

Two infinite queries on one key share one entry and one list, like any other
query — whichever of them asks for the next page, both show it.

## Retrying

| Option | Default | Description |
|---|---|---|
| `retry` | `0` | How many times to try again after a failure |
| `retryDelay` | exponential backoff | `(attempt, error) => ms` |
| `shouldRetry` | every failure | `(error, attempt) => boolean` |

Off by default. A retry is a second request against a server that just refused
the first, and whether that is wise depends on why it refused — a timeout, yes; a
401, never. `shouldRetry` is where that is decided, and it defaults to retrying
everything only because it cannot know.

## What it does not do

- **No persistence.** The cache is memory; a reload starts empty. Writing it to
  storage means deciding what is safe to keep and for how long, which is an
  application's decision.
- **No window-focus or reconnect refetching.** An entry revalidates when a new
  subscriber arrives and when it is invalidated, not when the tab regains focus.
- **No devtools panel.** `keys()` and `size()` are what there is for inspecting
  it.
