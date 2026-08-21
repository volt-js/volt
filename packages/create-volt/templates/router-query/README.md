# __PROJECT_NAME__

A [Volt](https://voltjs.dev) application with the two packages an application
needs on day one: `@voltdev/router` for the URL and `@voltdev/query` for what
the server knows.

```bash
pnpm install
pnpm dev
```

| Command | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server, with templates and Sass hot-reloading |
| `pnpm build` | Production build into `dist/` |
| `pnpm preview` | Serve that build |
| `pnpm test` | Vitest, in happy-dom |
| `pnpm typecheck` | TypeScript, no emit |

## The files

```
src/main.ts       starts the router, which mounts the matched route
src/router.ts     the route table, and the router built from it
src/shell.ts      the layout every route renders inside; creates the cache
src/home.ts       the index route
src/users.ts      a list, read through the query cache
src/user.ts       one user, keyed by the URL parameter
src/api.ts        a stand-in backend — delete it and point at real URLs
src/app.test.ts   navigates between routes and asserts on the DOM
```

## What to notice

- **The layout does not re-mount.** Going from `/users` to `/users/2` swaps
  what is inside `<main data-volt-outlet>` and leaves the header alone.
- **Links are ordinary anchors.** `<a href="/users/2">` has a real `href`, so
  it previews in the status bar and opens in a new tab on middle-click. The
  router intercepts only the plain left-click.
- **The cache outlives the route.** Leaving `/users` and coming back paints
  from cache with no second request. `src/app.test.ts` asserts exactly that.
- **A query can follow a parameter.** `src/user.ts` passes a *function* as its
  key, so changing `:id` moves it to another cache entry rather than
  refetching into the same one.

## Next

- [Routing](https://voltjs.dev/guide/routing) — nested routes, loaders, guards
- [Server state](https://voltjs.dev/guide/query) — staleness, mutations, optimistic writes
- [Templates](https://voltjs.dev/reference/template-syntax) — the `:` syntax in full
