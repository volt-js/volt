# @voltdev/query

One cache for server state, keyed by structural query keys. Two components
asking the same question make one request; cached data is served while it is
revalidated behind them; a mutation invalidates by prefix and rolls back
exactly when it fails.

```bash
pnpm add @voltdev/query@alpha
```

> **Not on npm yet.** The command above is what installs it once it is released.
> Until then it works from a checkout of the [Volt repository](https://github.com/volt-js/volt) —
> see [what is on npm](https://voltjs.dev/guide/getting-started#what-is-on-npm).

```ts
import { createQuery } from '@voltdev/query';

class UserCard {
  id = new Signal.State(1);
  user = createQuery({
    key: () => ['users', this.id.get()],
    fetcher: ({ key, signal }) =>
      fetch(`/users/${key[1]}`, { signal }).then((r) => r.json()),
    staleTime: 30_000,
  });
}
```

```html
<p :if="user.isLoading()">Loading…</p>
<p :if="user.isError()">Could not load that user.</p>
<article :if="user.data()" :class="{ stale: user.isFetching() }">
  { user.data().name }
</article>
```

A key is an array naming a question, compared by value — so the object literal
a component rebuilds on every read still hits the cache, and `{ page, filter }`
finds what `{ filter, page }` stored. Each part is hashed on its own, so
`['a/b']` and `['a', 'b']` are different entries and invalidating `['user']`
cannot reach `['users', 1]`.

Mutations apply their optimistic writes before the call goes out and put back
exactly what they took away if it throws — skipping any value something newer
has already replaced:

```ts
await queryClient.mutate(() => api.rename(id, name), {
  optimistic: [optimistic(['users', id], (u: User) => ({ ...u, name }))],
  invalidate: [['users']],
});
```

`createQuery` is a component's view of one entry: it follows a key that is
allowed to change, and releases its subscription on unmount — which is what
makes the last component out cancel the request nobody is waiting for. Pass
`keepPreviousData` and a paginated list keeps its rows on screen while the next
page loads.

The cache lives beside [`createResource`](https://voltjs.dev), not inside it: a
resource is one request's lifecycle, a cache is the application's.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev](https://voltjs.dev)
