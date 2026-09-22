# Router

`@voltdev/router` is a declared route table: nested routes, loaders that run
before a route paints, typed parameters, and links that are real anchors.

::: warning Not on npm yet
`@voltdev/router` is not published. It works from a checkout of the Volt repository;
the packages on npm today are `@voltdev/core`, `@voltdev/reactivity`,
`@voltdev/compiler` and `@voltdev/vite-plugin`.
:::

```ts
import { createRouter, defineRoutes } from '@voltdev/router';

export const routes = defineRoutes([
  {
    path: '/',
    component: Shell,
    children: [
      { index: true, component: Home },
      { path: 'users', component: Users },
      { path: 'users/:id', component: User },
    ],
  },
]);

export const router = createRouter({ routes });
await router.start(document.querySelector('#app')!);
```

The table is data rather than a directory of files. A route is found by reading
the table, which a server and a build can do as easily as a browser — the same
table decides what a URL renders, what a prerender writes, and how a request is
answered. See [`serverRender`](./server-render) for all three at once.

## The route table

```ts
defineRoutes<const R extends readonly RouteDefinition[]>(routes: R): R
```

`defineRoutes` returns its argument unchanged. It exists for the type: it keeps
every pattern as a literal, so the router knows the full set of URLs the
application has and what parameters each one takes.

| Field | Description |
|---|---|
| `path` | This route's own path, relative to its parent. Omit for a layout that groups children without appearing in the URL |
| `index` | Shown at the parent's own URL. Mutually exclusive with `path` |
| `component` | A component, or `() => import(...)` to fetch it when the route is entered |
| `loader` | Run before the route renders; its result is in place for the first paint |
| `shouldRevalidate` | Whether a route that stays mounted across a navigation loads again. Default: no |
| `mode` | `'csr'`, `'ssr'` or `'ssg'` — where the route is rendered, when the application renders on a server |
| `meta` | Anything the application wants to carry per route: a title, a required permission |
| `id` | A stable identity. Defaults to the full pattern |
| `children` | Nested routes, rendered into this route's outlet |

### Patterns

A pattern is `/`-separated segments, and this is the whole syntax:

| Segment | Matches |
|---|---|
| `users` | That literal |
| `:id` | One segment, captured as `id` |
| `:page?` | The same, but the segment may be absent |
| `*` | The rest of the path, captured as `*` |
| `*file` | The rest of the path, captured as `file` |

There is no regular-expression form and no per-segment constraint. Both would
move "does this URL belong to this route" somewhere the type system cannot read,
and the parameter types are derived from the pattern string itself — so the
pattern has to stay something a template literal type can take apart. A splat
may only be last, because anywhere else it makes the split ambiguous.

Matching never backtracks. When two patterns both match, they are compared
segment by segment and the more specific wins: a literal beats a parameter, a
parameter beats an optional one, and an optional one beats a splat. Where every
segment ties, the longer pattern wins.

### Layouts and the outlet

A route with children renders them into an element marked `data-volt-outlet`
in its template:

```html
<div class="shell">
  <nav>…</nav>
  <main data-volt-outlet></main>
</div>
```

**A layout does not re-mount.** The old and new matches are compared position by
position, and every route that matches the same slice of the URL keeps its
component instance — its scroll position, its open menus, its work in flight.
Only from the first difference down is anything torn out. So a navigation from
`/users/1` to `/users/2` keeps the shell and re-mounts the user page, whose slice
of the URL changed. Re-mounting the shell on every navigation is the single thing
that makes a client-rendered application feel worse than the multi-page one it
replaced.

## Loaders

```ts
loader?: (args: LoaderArgs) => unknown
```

| `LoaderArgs` | Description |
|---|---|
| `params` | This route's parameters and every ancestor's |
| `url` | The URL being navigated to |
| `signal` | Aborted when a newer navigation supersedes this one, or the router stops |

A loader runs *before* the route renders, and the navigation waits for it. That
is the difference from fetching in the component: the route's code and its data
arrive together, and the page paints once rather than painting a placeholder and
then painting again.

Pass `signal` to `fetch`. A loader whose answer nobody wants any more — because
the reader clicked somewhere else — is the commonest wasted request in a router.

Read the result in the component with `routeData`, in a field initializer:

```ts
import { Component } from '@voltdev/core';
import { routeData } from '@voltdev/router';

@Component({ selector: 'v-user', templateUrl: './user.html' })
export class User {
  user = routeData<{ name: string }>();
}
```

```html
<h1>{ user()?.name }</h1>
```

It is an accessor rather than a value because `revalidate()` writes new data into
a route that is still mounted, and a snapshot taken in the constructor would never
see it. The field initializer is the moment the router is mounting this route,
which is the only moment it knows which route "this" is.

`LoaderArgs<'/users/:id'>` types `params.id` as a `string` rather than a lookup
that might be anything. A nested table only knows the segment each route
declared, so this annotation takes the route's full pattern.

## The router

```ts
createRouter(options: RouterOptions): Router
```

| Option | Default | Description |
|---|---|---|
| `routes` | — | The table |
| `scroll` | `true` | Save and restore the scroll position across history entries |
| `preloadOnHover` | `true` | Fetch a route's chunk when the pointer reaches a link to it |
| `viewTransition` | `false` | Animate a navigation with the platform's View Transitions |

`preloadOnHover` fetches the chunk and **only** the chunk. A loader can be a
mutation-shaped POST or an expensive query, and running one because a pointer
crossed a link would be a side effect nobody asked for.

`viewTransition` is off because a view transition is document-scoped and
serialised — the platform allows one at a time, and a route change arriving while
a list reorder is mid-transition is a real conflict. Turning it on says this
application's navigations are the transition worth having. An engine without the
API, a reader who asked for reduced motion, and a navigation arriving mid-
transition all take the ordinary path.

### Reading where you are

| Member | Description |
|---|---|
| `pathname()`, `search()`, `hash()` | The current location, each on its own signal |
| `state()` | Application state stored on the current history entry |
| `matches()` | The routes rendering right now, outermost first |
| `params()` | Every parameter of the current match |
| `param(name)` | One parameter, read through its own signal |
| `query(name)` | One query-string parameter, likewise |
| `status()` | `'loading'` from the moment a navigation starts until it has rendered |
| `error()` | What the last navigation failed with |

Prefer `param(name)` to `params()[name]`. A component showing `:tab` is then not
woken when `:id` changes — the difference between a narrow read and a wide one is
the difference between updating one thing and updating everything that looked.

### Going somewhere

| Member | Description |
|---|---|
| `href(pattern, params?, options?)` | Build a URL from a pattern. The one place a link should be assembled |
| `navigate(to, options?)` | Go to a URL. Resolves with the outcome |
| `preload(to)` | Fetch what a URL would need to render, without going there |
| `revalidate()` | Run the current routes' loaders again, in place, without re-mounting |
| `block(blocker)` | Register a blocker; returns the function that removes it |
| `start(root)` | Match the current URL, mount it, and start listening |
| `stop()` | Stop listening |

`href` is typed against the table:

```ts
import { createRouter, defineRoutes } from '@voltdev/router';

const router = createRouter({
  routes: defineRoutes([{ path: '/users/:id', component: User }]),
});

router.href('/users/:id', { id: 42 }); // '/users/42'
```

A pattern that is not in the table, or a missing `id`, is a type error at the
call — so renaming a route turns every link to it into a compile error rather
than a 404 somebody finds later. Numbers are accepted because an id usually is
one.

`navigate` fails without touching the page when no route describes the URL, and
replaces rather than pushes when the URL is already the one on screen. It resolves
with `{ status, error? }`, where `status` is `'completed'`, `'blocked'`,
`'aborted'` (a newer navigation took over) or `'failed'`.

| `NavigateOptions` | Description |
|---|---|
| `replace` | Replace the current history entry rather than adding one |
| `state` | Stored on the history entry, readable as `state()` |
| `preserveScroll` | Leave the scroll position alone |

### Blocking a navigation

```ts
const stop = router.block(({ from, to, mode }) => form.dirty() && !confirm('Discard changes?'));
```

Return `true` to stop the navigation — synchronously, or from a promise. `mode`
says how it started: `'push'`, `'replace'`, `'pop'` for the back button,
`'initial'`, or `'unload'` when the tab is closing.

`'unload'` is the exception, and it cannot be avoided. The browser decides whether
to prompt the moment its handler returns, so only a synchronous `true` counts there
— a promise resolving later has nothing left to stop — and what the reader sees is
the browser's own prompt rather than anything the application draws.

## Links

Links are ordinary `<a href>` elements. Middle-click, open-in-new-tab and crawlers
all behave, because it is a real link; the router layers its interception over it
rather than replacing it with a click handler.

It intercepts a plain left click on a same-origin link, and leaves to the browser:

- a click with a modifier key held, or with any button but the primary one
- a link with `download`, which means "save this"
- a `target` other than `_self` — a new tab, a named frame
- another origin, which includes every non-HTTP scheme: `mailto:`, `tel:`, `blob:`
- `rel="external"` or `data-volt-no-router`, the two ways to say "this same-origin
  URL belongs to the server"

A click some handler already called `preventDefault()` on is left alone too.

`findAnchor`, `isRoutableAnchor` and `shouldInterceptClick` are exported for a
component that needs to make the same decision the router does.

## Rendering modes

```ts
routeMode(chain: RouteBranch | readonly RouteMatch[], fallback: RenderMode): RenderMode
```

A route's `mode` says where its markup is made: `'ssg'` built once, `'ssr'`
rendered per request, `'csr'` in the browser. It is resolved **leaf to root** — a
layout says what its section does by default, and a page inside it says when it
knows better. A site prerendered whole with one live `/pricing` is the ordinary
shape; resolving root-first would leave the layout unable to say anything.

```ts
import { defineRoutes, flattenRoutes, matchRoutes, routeMode } from '@voltdev/router';

const routes = defineRoutes([
  {
    path: '/',
    mode: 'ssg',
    children: [
      { index: true },
      { path: 'pricing', mode: 'ssr' },
    ],
  },
]);

routeMode(matchRoutes(flattenRoutes(routes), '/pricing'), 'csr'); // 'ssr'
```

It takes either what `matchRoutes` returns for one URL or a branch from
`flattenRoutes`, because those are what its two callers hold: a server answering
one request has matches, and a build enumerating every route has branches.

`fallback` is the application's own default. Nothing in the router decides that
server rendering happens at all. [`serverRender`](./server-render) is what reads this.

## Without a browser

```ts
flattenRoutes(routes: readonly RouteDefinition[]): RouteBranch[]
matchRoutes(branches: readonly RouteBranch[], pathname: string): readonly RouteMatch[]
```

For a caller with a URL and no DOM — a server deciding what a request resolves
to, a build enumerating what to prerender, a test asserting on a table.

`matchRoutes` returns every route that renders for the pathname, **outermost
first**, and an **empty array** when nothing matches. That is deliberately not an
error: a table with a `'*'` route handles an unknown URL as a page, and one
without renders nothing, which is the honest answer for a URL the application does
not have. Test it with `.length` — an empty array is truthy.

| `RouteMatch` | Description |
|---|---|
| `route` | The `RouteDefinition` |
| `id` | Its identity |
| `pattern` | The full pattern up to and including this route |
| `pathname` | The portion of the URL this route accounts for |
| `params` | This route's parameters and every ancestor's |

`buildPath(pattern, params?)` and `normalizePathname(pathname)` are the pieces
`href` is made of, exported for code that builds paths outside a router.

## What it does not do

- **It does not run on a server.** `createRouter` reads `window.location` when
  it is created and navigates with the History API, so a server bundle that
  creates one throws as it loads. A server decides what a URL resolves to with
  [`matchRoutes`, `flattenRoutes` and `routeMode`](#without-a-browser),
  which touch no DOM.
- **No file-system routing.** The table is declared. A generator that writes one
  from a directory is a reasonable thing to build on top; it is not built here.
- **No hash routing.** URLs are paths, handled with the History API.
- **Loaders are not cached across navigations.** Leaving a route and coming back
  runs its loader again. Data that should outlive a route belongs in
  [the query cache](./query), which a loader can read from.
