# Start mode

An application that server-renders needs the router, the query cache, the
server package and the plugin wired together. Each of those is a deliverable
and each works; none of them is a way to begin. `start` is that wiring.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { volt } from '@voltdev/vite-plugin';

export default defineConfig({
  plugins: [volt({ start: true })],
});
```

::: danger Not finished — it does not run end to end yet
The pieces on this page are built and tested on their own: the handler's
logic, per-route modes, the partial-hydration decision, static generation and
the edge check. What is missing is what runs them, and building the `start`
template and requesting its pages shows where:

- **Routes are not part of the server render.** The router mounts each matched
  route into its parent's outlet in the browser, so rendering the root component
  on a server produces the application's shell with an empty outlet. The
  template also never starts its router, so its pages do not appear in the
  browser either.
- **The dev server does not use it.** Under `vite`, the handler is never
  called, and a server-function call is answered 404.
- **`vite build` builds the client only.** The server entry has to be built
  separately, with `vite build --ssr server.ts`.
- **The router cannot be created on a server.** `createRouter` reads
  `window.location` when it is created, so an application that makes its
  router at module scope — as the template does — throws as its server bundle
  loads, before any request arrives.
- **Data a page fetches while rendering does not reach the page.** A server
  function called during a server render is refused, because `guard` sees a
  request only when the function arrived as a call; and a server render waits
  only for data it was told about — see [one request](./server#one-request).

Until those are done, server rendering works through
[the renderers directly](./server), with a server entry you write yourself.
Start mode also needs `@voltdev/router`, `@voltdev/query` and
`@voltdev/server`, none of which are published yet.
:::

That is the whole configuration. What it gives the project is a request
handler, per-route rendering modes, server functions mounted on the same
origin, and a client that attaches to what the server sent — none of which
appears in the project's own files.

**It is off until you write it.** Client rendering is first-class here and
server rendering is something an application chooses; a turnkey mode that
quietly made every project a server project would take that choice away.
Deleting the option leaves an ordinary client-rendered application with nothing
else to change.

## What you supply

A route table and a root component, both by path.

```ts
interface StartOptions {
  routes?: string;              // default: '/src/routes.js'
  root?: string;                // default: '/src/app.js'
  defaultMode?: 'csr' | 'ssr' | 'ssg'; // default: 'ssr'
  base?: string;                // default: '/_volt/'
}
```

`routes` must export `routes`; `root` must export the root component as its
default. They are paths rather than values because both halves of the
generated wiring have to import them under the same specifier the application
does — one build, one module, so the server render and the client that attaches
to it cannot disagree about what the page is.

`base` is where server-function calls arrive, and it must match what the
call-site transform posts to. See [server functions](./server-functions).

## Where the wiring lives

Two virtual modules, generated into the application's own module graph rather
than shipped as a package.

| Module | Exports |
|---|---|
| `virtual:volt-start/server` | `handler(request): Promise<Response>`, `setShell(html)` |
| `virtual:volt-start/client` | nothing — imported for its effect |

Generating rather than publishing is deliberate, for three reasons.
[`@voltdev/server`](./server-functions) is dependency-free — a
`(Request) => Response` and nothing else — and giving it the router and the
renderer would end that. A sixth package is the opposite of what this mode is
for. And generated code that imports `@voltdev/core/server` by name is resolved
by *your* build, at the versions you have, where a package would have pinned
its own.

Neither module exists on disk, so a project that type-checks without the plugin
running needs them declared. The `start` template `create-volt` generates ships
that declaration in `src/volt-start.d.ts`.

### The server entry

```ts
// server.ts
import { handler, setShell } from 'virtual:volt-start/server';
import shell from './index.html?raw';

setShell(shell);

export default { fetch: handler };
```

`handler` is one `(Request) => Promise<Response>`, which is what makes edge
deployment fall out rather than be added. Nothing in it opens a file or reads a
process — and [the edge check](#the-edge-check) is what keeps that true as the
application grows.

It answers in three branches, and the order is the logic:

1. **A server-function call** is answered before the route table is consulted.
   The router knows nothing about that path, so answering it second would
   render a 404 page at every caller and the application would appear to have
   no server functions at all. "A server-function call" means a POST under the
   base, checked with `isServerCall` — so a page at `/_voltage`, or a reader who
   types a function's URL into the address bar, is routed as a page.
2. **A URL the table does not match** still gets the shell, with a 404 status.
   Your own not-found route is a route and still has to render; a 200 for a URL
   that does not exist would be worse than a 404 with a page that says so.
3. **Everything else** renders, or does not, according to the route's mode.

### The client entry

```ts
// src/main.ts
import './styles.scss';
import 'virtual:volt-start/client';
```

It calls [`hydrate`](./server#hydration) when the server sent markup and
[`mount`](./component#mount-component-target) when it did not, which is the difference between
an `ssr` route and a `csr` one on the same build.

## Per-route rendering modes

A route says where its markup is made.

```ts
import { defineRoutes } from '@voltdev/router';

export const routes = defineRoutes([
  {
    path: '/',
    component: Shell,
    mode: 'ssg',
    children: [
      { index: true, component: Home },
      { path: 'pricing', component: Pricing, mode: 'ssr' },
      { path: 'dashboard', component: Dashboard, mode: 'csr' },
    ],
  },
]);
```

| Mode | Where the markup is made |
|---|---|
| `ssg` | Once, at build time, written to a file and served as bytes |
| `ssr` | Per request, because the answer depends on the request |
| `csr` | In the browser — the server sends the shell and stops |

Three rather than the six a rendering-modes table usually lists: streaming is
how an `ssr` route is *delivered* rather than a fourth choice, and edge is a
constraint on the whole build rather than something one route opts into.

**The mode is resolved leaf to root.** A layout says what its section does by
default and the page inside it says when it knows better — a site prerendered
whole with one live `/pricing` is the ordinary shape, and resolving root-first
would leave the layout unable to say anything. `routeMode(matches, fallback)`
from [`@voltdev/router`](./router) is the resolution, and the fallback is the
application's: nothing in the router decides that server rendering happens at
all.

## Partial hydration

A route whose components have nothing to attach is sent no JavaScript.

There is no island annotation, because the compiler already knows. Every markup
string is hoisted out of a render body, so a template that only clones one and
hands it back touches the runtime nowhere — and a binding, a listener, a block,
a child component or a ref all call it. "Does this body reach for the runtime at
all" is therefore the whole question, and it is asked of the emit rather than of
a list of features, so a dynamic construct added later is counted the day it is
written.

The compiler's answer travels with the render the plugin writes, and
`needsHydration(component)` from `@voltdev/core` reads it back. A route is
interactive if *any* component on its branch is: the outlet renders the leaf's
markup inside the layout's and either can hold a binding.

When a route is not, `start` omits two things from the page — the module
script, and the state payload hydration would have read. On a page of prose the
payload is easily the larger half.

**What this does not do:** the chunk still exists in the build, for the routes
that need it. What a static route does is decline to ask for it.

A component the build never answered for — one compiled without the plugin, in
a test or a playground — is treated as interactive. Reporting a dynamic
component as static ships a page that never wakes up, which is a much worse
failure than shipping JavaScript nobody needed.

## Static generation

`@voltdev/vite-plugin/ssg` is the build-time half. It is a separate entry point
because a project calls it from a script after `vite build`, never from a module
the browser loads.

```ts
import { enumerateRoutes, prerender } from '@voltdev/vite-plugin/ssg';
import { flattenRoutes } from '@voltdev/router';
import { routes } from './src/routes.js';

const { pages, skipped } = await prerender({
  branches: flattenRoutes(routes),
  outDir: 'dist',
  render: (pathname) => renderPage(pathname),
});
```

| Function | What it does |
|---|---|
| `enumerateRoutes(branches, params?)` | Every URL the table can produce, and what it could not |
| `prerender(options)` | Renders each and writes the files |
| `createRenderCache(options)` | A staleness policy over one renderer |
| `fileForPathname(outDir, pathname, layout?)` | Where a URL's file goes |

Routes are enumerated from the router's own table rather than by re-reading the
filesystem, and only the `ssg` ones are written. A `csr` or `ssr` route comes
back in `skipped` with the reason `not-static` rather than being quietly
missing — a route absent from a build output with no reason given is
indistinguishable from one the enumerator failed to see. A table with no modes
anywhere is taken as wholly static, which is what a site with no server is.

A pattern with parameters needs values; supply them with `params`, and a
pattern that needs some and is offered none is skipped with `no-params`.

### Revalidation

`createRenderCache` is the revalidation story, and it is a policy over the
renderer that already exists rather than a second renderer. That is what makes
a prerendered page and a per-request page differ in *when* they were produced
and in nothing else — the hydration story on the client is identical for both.

```ts
const cache = createRenderCache({
  render: (pathname) => renderPage(pathname),
  revalidate: 60_000,
  serveStale: true,
});

const page = await cache.get('/pricing');
```

| Member | Description |
|---|---|
| `get(pathname)` | The page, rendering it if the policy says the copy is no good |
| `peek(pathname)` | What is held, rendering nothing and starting no refresh |
| `invalidate(pathname?)` | Drop one URL, or everything |
| `refreshing` | How many refreshes are running behind a stale answer |
| `idle()` | Settles once no refresh is outstanding, so a process can exit knowing |

Three things it does that a `Map` would not: concurrent requests for one URL
collapse onto a single render, because a cache miss on a popular page otherwise
becomes as many renders as there are readers; the previous markup is kept when
a refresh throws, because a page that was right a minute ago beats an error
page; and with `serveStale` it answers from the old copy while the new one is
produced, which is the difference between revalidation costing one reader the
full render and costing none of them.

## The edge check

An edge runtime has no `node:` builtins, and a deployment that reaches for one
fails where the tests never ran. `renderPath` refuses it at build time.

```ts
import { volt, renderPath } from '@voltdev/vite-plugin';

export default defineConfig({
  plugins: [renderPath(), volt({ start: true })],
});
```

The judgement it makes is the feature. A `@Server()` body never reaches the
client and keeps its builtins; everything a render can reach does not. It
follows the import graph, because the import that breaks a deploy is normally
three modules below whatever the reviewer of the entry was reading, and it
reports every offender with the chain that reached it rather than the first one
— the chains usually share a link, and seeing four at once is what shows which
module is the real problem.

Both spellings count: `fs` resolves to the same module as `node:fs` and fails
the same deploy, while `fs-extra` is a package and is left alone.

| Option | Default |
|---|---|
| `level` | `'error'` — also `'warn'` and `'off'` |
| `allow` | `[]` — specifiers to permit anyway |
| `entries` | detected: a module importing a renderer from `@voltdev/core/server` |

It is ordered `pre`, because the pass it reads the `@Server()` boundary from is
the pass that erases it.

## The example

`create-volt` has a `start` template: three routes using all three modes, a
`server.ts` in the shape a host expects, and one line of configuration. It is
the example the status note at the top of this page was found with, and it does
not run as a server yet for the reasons listed there. It also cannot be
generated into a standalone project until the packages it needs are published —
a project outside the repository installs from npm — so read it in the
repository, under `packages/create-volt/templates/start/`. See
[`create-volt`](./create-volt) for why that refusal is deliberate.
