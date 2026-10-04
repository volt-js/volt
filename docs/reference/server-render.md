# The `serverRender` option

An application that server-renders needs the router, the query cache, the
server package and the plugin wired together. Each of those is a deliverable
and each works; none of them is a way to begin. `serverRender` is that wiring.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { volt } from '@voltdev/vite-plugin';

export default defineConfig({
  plugins: [volt({ serverRender: true })],
});
```

That is the whole configuration. What it gives the project is a request
handler, per-route rendering modes, server functions mounted on the same
origin, and a client that attaches to what the server sent — none of which
appears in the project's own files. `vite` answers every page and every
server-function call through that handler, and `vite build` builds it.

::: warning Not on npm yet
`serverRender` also needs `@voltdev/router`, `@voltdev/query` and
`@voltdev/server`, none of which are published yet, so today it runs from a
checkout of the Volt repository. See [the example](#the-example) for what is
tested there.
:::

**It is off until you write it.** Client rendering is first-class here and
server rendering is something an application chooses; a turnkey mode that
quietly made every project a server project would take that choice away.
Turning it off is deleting the option and starting the application yourself:
the client entry imports `virtual:volt/client`, which exists only while the
option is on, so `src/main.ts` mounts the root with a router of its own instead,
and `server.ts` is no longer built. A server function still posts to `base`, so
a project that keeps one serves `createHandler` itself. The template's README
gives the steps in full.

## What you supply

A route table, a root component and a server entry, all by path.

```ts
interface ServerRenderOptions {
  routes?: string;              // default: '/src/routes.js'
  root?: string;                // default: '/src/app.js'
  entry?: string;               // default: '/server.ts'
  defaultMode?: 'csr' | 'ssr' | 'ssg'; // default: 'ssr'
  base?: string;                // default: '/_volt/'
  params?: ParamsForPattern;    // the pages of an `ssg` pattern with a parameter
}
```

`routes` must export `routes`; `root` must export the root component as its
default, and marks where the matched route renders with
[`:outlet`](./router#layouts-and-the-outlet). They are paths rather than values
because both halves of the generated wiring have to import them under the same
specifier the application does — one build, one module, so the server render
and the client that attaches to it cannot disagree about what the page is.

`entry` is [the server entry](#the-server-entry): what `vite` answers requests
with and what `vite build` builds for a host to run, so the server developed
against is the one deployed.

`base` is where server-function calls arrive, and it must match what the
call-site transform posts to. See [server functions](./server-functions).

`params` says which pages `vite build` writes for an `ssg` route whose pattern
has a parameter, such as `/docs/:page`. See
[the pages the build writes](#the-pages-the-build-writes).

## Where the wiring lives

Three virtual modules, generated into the application's own module graph
rather than shipped as a package.

| Module | Exports |
|---|---|
| `virtual:volt/server` | `handler(request): Promise<Response>` |
| `virtual:volt/client` | nothing — imported for its effect |
| `virtual:volt/shell` | the page the handler writes into, as a string |

Generating rather than publishing is deliberate, for three reasons.
[`@voltdev/server`](./server-functions) is dependency-free — a
`(Request) => Response` and nothing else — and giving it the router and the
renderer would end that. A sixth package is the opposite of what this mode is
for. And generated code that imports `@voltdev/core/server` by name is resolved
by *your* build, at the versions you have, where a package would have pinned
its own.

None of them exists on disk, so a project that type-checks without the plugin
running needs them declared. The `serverRender` template `create-volt` generates ships
that declaration in `src/volt-server-render.d.ts`.

### The server entry

```ts
// server.ts
import { handler } from 'virtual:volt/server';

export default { fetch: handler };
```

`handler` is one `(Request) => Promise<Response>`, which is what makes edge
deployment fall out rather than be added. Nothing in it opens a file or reads a
process — and [the edge check](#the-edge-check) is what keeps that true as the
application grows.

Nothing hands it a page to write into. The shell is `virtual:volt/shell`: in a
build, the `index.html` the client build emitted, whose module script and
stylesheet are the hashed files in `dist/client`; under `vite`, the project's
own `index.html`, read again when it changes. A shell imported from the source
`index.html` would ask for `/src/main.ts`, a file no build produces, and every
page would arrive complete and never wake up.

The page goes into `<div id="app"></div>`, spelled exactly so in the shell's
`<body>`: no attributes and nothing inside it. The client takes `#app` however
it is written, but the handler looks for that one spelling, and a render
written anywhere else is one the client never claims — it would find its mount
point empty, build the page into it, and the reader would get two copies. So
`vite build` fails, and `vite` fails the request, on a shell without it. Style
an element around the mount point rather than the mount point itself.

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

A page it renders gets a router of its own — one at module scope would be
shared by every request in flight, and the second reader would see the first
reader's page. The handler resolves the URL, which runs every loader on the
branch, and then renders the root, with the branch written through the
`:outlet`s in the application's templates. A loader or a render that throws is
answered with a bare 500; under `vite` it is thrown instead, so it reaches the
overlay with the source's line in the stack.

### The client entry

```ts
// src/main.ts
import './styles.scss';
import 'virtual:volt/client';
```

It resolves the URL, then attaches, then listens for navigations — resolving
first so that what it attaches is the branch the page shows. What decides
between [`hydrate`](./server#hydration) and
[`mount`](./component#mount-component-target) is what the server said it did.
The mount point of a page the server rendered carries `data-volt-build`, the
identity of the build that rendered it, and `data-volt-path`, the path it was
rendered for. The client hydrates only when the identity is its own and the
path is the one in the address bar. A `csr` route's mount point carries no
mark, so the page is built in the browser. A mark from another build, or for
another path — a host that rewrites `/` to `/pricing` hands the browser one
route's markup at another route's address — is markup whose paths would land on
the wrong nodes, so that page is built afresh too, and its
[state payload](./server#the-state-payload) is dropped unread, along with
[the loader answers](#data-during-a-render) it carried: another build may
have kept a `hydratable` key, or a route, and changed what it holds, and
another page's values are not this one's. Building again is the right answer and a quiet
one — the reader sees the page drawn twice — so a development build says which
it was in the console: the two builds, or the two paths. A production build
carries none of that.

The identity is two hashes. The first is the compiler's, over its version and
its options, and on its own it names a compiler rather than a deploy: two
deploys with different templates on the same compiler share it, and a client
cached from the first would claim the second's markup. The second is over the
code the client build emitted, which is what makes the pair name a build. Under
`vite` it is one per dev server, since the code changes with every edit.

A component in a chunk of its own is the one thing on a claimed page the
client cannot claim at once. Its range is held until the chunk lands and
claimed then, so the rest of the page is live at once and the component is
live when it can be; where the server could not load the chunk and printed the
fallback instead, the browser builds the component in the fallback's place.
See [hydration](./server#hydration).

## Developing and building

**`vite`** answers every request its own middlewares leave through the server
entry, so a page under development is rendered by the handler that will be
deployed and a server-function call reaches its function. Vite's client, the
modules it compiles and `public/` are answered first. The entry runs in the dev
server's `ssr` environment. The shell goes through Vite's HTML transform once,
as the file it is, which is what puts `@vite/client` in every page; the render
never does. That transform is written for a page that is the same for every
reader and keeps what it made of one under its URL, so over two readers' renders
of one URL at once it would hand each whatever it finished last. A page under
`vite` is the handler's page as written, as it is in a deploy.

**`vite build`** builds twice, client first, and then writes the `ssg` pages:

```text
dist/client/   the files a host serves as they are, each `ssg` page among them
dist/server/   server.js, which a host runs — and never serves
```

The client is built first because the server is built with two things only the
client build has: its page and its identity. The page is taken out of
`dist/client` rather than copied, because as a file there it is what a host
that serves files first would send for `/`, unrendered, without the handler
hearing of the request. When `/` is an `ssg` route, `index.html` is back in
`dist/client` once the build ends — rendered, which is what a host should send.
The server bundle is self-contained — an edge runtime has no `node_modules` to
resolve anything from — and holds every `@Server()` body, which is why it is not
written beside the client's files. The `ssg` pages are written last, through
that bundle; see [the pages the build writes](#the-pages-the-build-writes).

A deployment serves `dist/client` as files and hands every other request to the
`fetch` that `server.js` exports.

**`vite preview`** is that deployment on your machine: the files in
`dist/client` as they are, and every other request through the `fetch` in
`dist/server`. A path the build wrote a page for is answered with the file, as
a static host answers it — `/` with `index.html`, `/about` with `about.html`.
It serves the last build, so build first.

## Data during a render

A page's data reaches its markup through its route's **loader**. The handler
resolves the URL before it renders, so every loader on the branch has answered
before the first byte is written, and the route reads its answer as the walk
passes it:

```ts
// src/routes.ts
{ path: 'pricing', component: Pricing, mode: 'ssr', loader: () => currentPlan() }

// src/pricing.ts
export class Pricing {
  plan = routeData<string>(); // <strong>{ plan() }</strong>
}
```

`currentPlan()` there is a [server function](./server-functions): a direct
call on the server and a POST from the browser, one line on both sides. On the
server nothing arrives as a call for its `guard` to read, so the handler lends
it the page's request — for each synchronous span of the work, and never across
an `await`, where another request's work runs next. An `ssg` page's request is
nobody's, and its loaders run once, at build time; see
[the pages the build writes](#the-pages-the-build-writes).

What that covers:

- **A loader's call to a server function**, made before the loader's first
  `await`. `resolve()` calls every loader on the branch before it awaits
  anything, and that prologue runs with the request lent.
- **A server function called by the render itself** — from a constructor, a
  data effect or a resource's fetcher, in any round the render settles
  through. Each span re-lends the request; see
  [`around`](./server#render-options). A call the render was told about —
  `createResource`, `createQuery` or `trackRequestData` — is waited for, and a
  value held in a `hydratable` reaches the browser in
  [the state payload](./server#the-state-payload), not in the markup.

What it does not:

- **Bytes already written.** The render is one buffered walk, and data that
  answers after the walk passed its place is not in the markup. That is why a
  loader is how data reaches bytes.
- **A promise nobody tracks** is not waited for at all.
- **A call from a promise's continuation** — the `.then` of another call, or a
  line after an `await` in a loader — is refused by its guard. Continuations
  run between spans, interleaved with other requests', and nothing that runs
  on an edge can say whose request they belong to. A call that needs another's
  answer belongs in a resource whose source is that answer; it runs in the
  next round's span.
- **Loaders run outside the render's request scope.** A loader's
  `trackRequestData` is not waited for, and `requestState` or `hydratable` in a
  loader is kept by nothing: on a server each read outside a request builds
  its own, because the process is every request's, so what a loader files
  there reaches no page — its own included.
- **The handler does not stream.** It renders with `renderToString`, so a page
  goes out when its slowest data has answered. `renderToStream` lends the
  request to its late chunks as well, for an entry that streams.

**What the loaders answered goes with the page.** The client resolves the URL
itself before it hydrates, and asking every loader on the branch again for a
page that was printed from their answers is a second round trip to arrive at
what is already on the screen. So a page that will be claimed carries them: a
`<script type="application/json" data-volt-loaders>` beside the state payload,
holding what a server build's `resolve()` answered with — each loader's answer,
under the path it answered for and then the depth of its route in the branch.
The client hands them to its first `resolve`, which adopts each in place of
calling that loader; see
[`resolve(url, { data })`](./router#a-server-s-answers-in-the-browser). The
template's `/pricing` asks for its plan once, on the server. Only that first
resolve starts from them: a navigation after it, and a revalidation, ask the
loaders as ever. And only the page's own: one the client builds afresh —
another build's, another path's — drops them unread with the state payload,
and a route that is not [interactive](#partial-hydration) is sent none, since
nothing would read them.

They travel through the state payload's serializer, under
[its rule](./server#the-state-payload): JSON, with a value JSON would carry
wrongly — `NaN`, a `bigint`, a function, a hole in an array — refused, which
fails the request naming the route whose loader answered it, rather than
sending the browser a value the page was not rendered from. A loader that
answers `undefined` is left out, and asked again. A `Date` is carried as the
string its `toJSON` gives, exactly as a `hydratable` holding one is, so a
template that calls a method of it renders on the server and throws in the
browser; it waits, with Maps and shared references, on the wire format server
functions also need.

**A query cache is the root component's to provide.** The handler puts the
router and the outlet in each render's scope and nothing else, so an
application that uses [the query cache](./query) provides it where every render
builds something of its own — a field of the root:

```ts
// src/app.ts
import { Component } from '@voltdev/core';
import { createQueryClient, provideQueryClient } from '@voltdev/query';

@Component({ selector: 'v-app', templateUrl: './app.html' })
export default class App {
  cache = provideQueryClient(createQueryClient());
}
```

That is one cache per request on the server and one per page in a browser. A
cache created at module scope is one per *process* on the server: every reader's
answers under the same keys, and a render that subscribes to another request's
entry waits on work that request's render owns.

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

**`vite build` writes each `ssg` page to a file** in `dist/client`, which a
host serves as one, and the handler answers the same path with the same page;
see [the pages the build writes](#the-pages-the-build-writes).

**An `ssr` page is answered with `Cache-Control: private`.** It was rendered
for the request that asked — every guard on the way read that request — and a
CDN or proxy in front of the host keeps pages by URL, so a page kept there is
the next reader's too. `private` keeps it out of any cache but the reader's
own. An `ssg` page, a `csr` shell and a 404 say nothing: the first is the same
for everyone by its own declaration, and the other two have nothing of anyone's
in them. A host that wants a different policy sets the header on the way out.

**The mode is resolved leaf to root.** A layout says what its section does by
default and the page inside it says when it knows better — a site prerendered
whole with one live `/pricing` is the ordinary shape, and resolving root-first
would leave the layout unable to say anything. `routeMode(matches, fallback)`
from [`@voltdev/router`](./router) is the resolution, and the fallback is the
application's: nothing in the router decides that server rendering happens at
all.

### The pages the build writes

Once both builds are done, `vite build` imports `dist/server/server.js` in Node,
reads the route table in it, and renders every `ssg` route's page through it —
the bundle a host will run rather than the source, so each page is the
handler's answer for its path, byte for byte: the build's mark and the
path's, the state payload, the loader answers, the styles, the hashed assets.
A client claims the file exactly as it claims a page the handler rendered.
Each goes into `dist/client`, where a static host finds it without being told
anything:

| Path | File in `dist/client` |
|---|---|
| `/` | `index.html` |
| `/about` | `about.html` |
| `/docs/intro` | `docs/intro.html` |

`about.html` rather than `about/index.html`, because of what hosts do with each
by default. Cloudflare, Netlify and GitHub Pages serve `about.html` at `/about`
as they find it. `about/index.html` they serve at `/about/`, and they answer
`/about` with a redirect there — after which the address bar names a path the
page was not rendered for, and the client builds the page again rather than
claiming it. A host that serves neither at `/about` hands the request to the
handler, which answers it with the same page.

The server is imported whether or not any route is `ssg`, because only the
table in it can say. A server entry that cannot start in Node — one that reaches
for its host's own modules as it loads — fails the build, and the build says
what it was starting it for. It is started in a worker thread of its own, which
is ended once the pages are written: a timer or a connection the server opens
as it loads ends with it, rather than keeping `vite build` running when the
build is done. An entry that imports `virtual:volt/server` behind an `import()`
is started at the chunk that import loads. A page that fails there, or a server
that cannot start, is reported with the frames of the stack it was thrown with
in the server; only its message would otherwise cross from the thread. A
server that ends the thread while a page is owed fails the build too.

**A loader on an `ssg` route runs at build time**, once, for a request that is
nobody's: a `GET` of the path at `http://localhost`, with no query, no headers
and no cookies. That is the request its server functions' guards read. A guard
that needs a reader refuses it, and the build fails naming the path and what
refused rather than writing a page with the failure in it: a file is what every
reader is sent. A loader that needs the reader's request belongs on an `ssr`
route. That is the page's first render only: once a client has claimed a page,
a navigation to an `ssg` route runs its loaders in the browser like any route's,
and their server functions are calls from the reader, with the reader's cookies.
A page the handler answers 404 fails the build as well, since a host
would serve the file with a 200: that is a route no request reaches, such as a
static segment a URL percent-encodes — `café`, which a request spells
`caf%C3%A9` — because the router compares a static segment as it is written.

**The handler answers an `ssg` path with the same page.** It cannot answer with
the file — an edge runtime has no filesystem, and the pages are written after
the bundle that would have to carry them — so it renders the page, from the
request the build rendered it from rather than the one that arrived. Same
bundle, same request, same page: not this reader's cookies or query, which would
make it this reader's page at an address that promises everyone one, and with
no `private` to keep a shared cache from keeping it. What can differ is what the
loaders read: if that has changed since the build, the handler's page is the one
the next build would write, and a client claims either, since both carry this
build's mark. A host that serves `dist/client` first never sends the handler a
path the build wrote; one that does not sends it every path, and any host sends
it a path the build did not write. Under `vite` an `ssg` route is rendered from
that same request, so a loader that needs a reader fails there as it will fail
the build.

**A pattern with a parameter names no path**, so the build is told which pages
to write for it, with `params`:

```ts
// vite.config.ts
import { readdir } from 'node:fs/promises';
import { defineConfig } from 'vite';
import { volt } from '@voltdev/vite-plugin';

export default defineConfig({
  plugins: [
    volt({
      serverRender: {
        params: async ({ pattern }) =>
          pattern === '/docs/:page'
            ? (await readdir('content/docs')).map((file) => ({ page: file.replace(/\.md$/, '') }))
            : undefined,
      },
    }),
  ],
});
```

It is asked once for each `ssg` pattern with a parameter, with the pattern and
the route's id, and answers with the parameters of each page to write. It is the
one place the build learns them: in the config rather than on the route, because
they come from somewhere — a directory, a content API — and the config runs in
Node at build time, where the route table, which is on the render path, may not
reach. It is the same function [`prerender`](#static-generation) takes as
`params`.

- **Saying nothing** — `undefined` or `null`, or no `params` at all — for a
  pattern with a required parameter fails the build, naming the pattern: a page
  left unwritten with no word said is one the handler renders on demand, and
  nobody would know. An optional parameter or a splat can be left out, so such
  a pattern answered with nothing is written at the path it has without one.
- **An empty list** writes no page for the pattern beyond that one — a section
  with no pages yet — and each of its other paths is the handler's to render
  when asked.
- **A list with values** is the whole of what is written for the pattern. For
  `/docs/:page?` that leaves out `/docs`, unless `{}` is among them.
- **Each value is a page at the address a link to it has**, encoded as
  [`buildPath`](./router#without-a-browser) encodes it: `{ page: 'q&a' }` is
  the page for `/docs/q%26a`, written to `docs/q&a.html`, which is the name a
  host decodes that address to. A value that makes `index` the last segment
  fails the build: `/docs/index` would be `docs/index.html`, which a host
  serves at `/docs/`, and `/index` would be `/`'s own `index.html`. Leave it
  out, and the handler answers it.
- **A path it does not name** is the handler's too, rendered when asked from
  the build's request, like any `ssg` path.
- **A path it names that a more specific route answers**, where that route is
  not `ssg`, is left to the handler rather than written, and the build says
  so. See below.

**A file is written only where a request renders an `ssg` route.** The
pattern a path comes from and the route a request for the path renders can
differ: `/*` matches `/` by leaving `*` empty, but a request for `/` renders
the index route ([which route renders](./router#which-route-renders)). Where
the route a request renders is not `ssg`, a file would be what a host serves
in that route's place, to every reader, so the build writes none and says
which path it left and why:

```text
[volt] / is left to the handler rather than written from /*: / matches it ahead of /*, and does not render as `ssg`.
```

A catch-all marked `ssg` beside a home page rendered per request therefore
writes every page it is given except `/`, and the build succeeds. The line
names the route where the table names the path: a route that is not `ssg`
claims the path it has with nothing supplied (its literal one, an optional
parameter left out, a splat matching nothing). A path such a route claims
only through a parameter, such as `/en` beside a `/:lang` rendered per
request, is one only the built router can place. The build asks it as each
page is rendered, leaves the path to the handler all the same, and the line
says that another route renders it rather than which one.

An `ssg` route keeps its own path the same way where `params` leaves that path
out of its pages. Answered with `{ page: 'intro' }`, `/docs/:page?` keeps
`/docs` from a catch-all given it, since a request for `/docs` renders
`/docs/:page?`, and the line says so:

```text
[volt] /docs is left to the handler rather than written from /*: /docs/:page? matches it ahead of /*, and `params` leaves it out of that route's pages.
```

That holds for the path such a route has with nothing supplied. The build
cannot see a path another `ssg` route claims only through a parameter, such
as `/docs/setup` given to the catch-all. It writes that path, and the file
is that route's page, because every page is the handler's answer for its
path. A loader on that route runs for a value its own `params` never named,
so give the catch-all only paths nothing more specific claims.

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

When a route is not, `serverRender` omits three things from the page — the
module script, the state payload hydration would have read, and the loader
answers its first resolve would have started from. On a page of prose the
payload is easily the larger half.

**What this does not do:** the chunk still exists in the build, for the routes
that need it. What a static route does is decline to ask for it.

A component the build never answered for — one compiled without the plugin, in
a test or a playground — is treated as interactive. Reporting a dynamic
component as static ships a page that never wakes up, which is a much worse
failure than shipping JavaScript nobody needed.

## Static generation

`@voltdev/vite-plugin/ssg` is the machinery underneath
[the pages the build writes](#the-pages-the-build-writes), for a project that
renders without `serverRender` — a client-rendered site prerendering with a
renderer of its own. It is a separate entry point because such a project calls
it from a script after `vite build`, never from a module the browser loads.
`serverRender` calls it for you, and nothing here is needed beside it.

```ts
import { enumerateRoutes, prerender } from '@voltdev/vite-plugin/ssg';
import { flattenRoutes } from '@voltdev/router';
import { routes } from './src/routes.js';

const { pages, skipped, withheld } = await prerender({
  branches: flattenRoutes(routes),
  outDir: 'dist',
  render: (pathname) => renderPage(pathname),
});
```

| Function | What it does |
|---|---|
| `enumerateRoutes(branches, params?, defaultMode?)` | Every URL the table can produce, what it could not, and what another route claims |
| `prerender(options)` | Renders each and writes the files |
| `createRenderCache(options)` | A staleness policy over one renderer |
| `fileForPathname(outDir, pathname, layout?)` | Where a URL's file goes |

Routes are enumerated from the router's own table rather than by re-reading the
filesystem, and only the `ssg` ones are written. A `csr` or `ssr` route comes
back in `skipped` with the reason `not-static` rather than being quietly
missing — a route absent from a build output with no reason given is
indistinguishable from one the enumerator failed to see. A route that declares
no mode anywhere on its branch renders as `defaultMode`, which is `ssg` unless
given: a table with no modes anywhere is taken as wholly static, which is what a
site with no server is. `serverRender` gives its own default, `ssr` unless
configured.

A pattern with parameters needs values; supply them with `params`, and a
pattern that needs some and is offered none is skipped with `no-params`.
`layout` is `'directory'` unless given, writing `/about` as `about/index.html`;
`serverRender` writes `'flat'`, `about.html`, for the reason given above. Flat,
a page whose last segment is `index` is refused, since its file is the one a
host serves at its directory's address.

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
  plugins: [renderPath(), volt({ serverRender: true })],
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

`create-volt` has a `serverRender` template: three routes using all three modes, a
`server.ts` in the shape a host expects, and one line of configuration.

It runs end to end, and `packages/create-volt/test/server-render-e2e.test.ts` is
the proof: it generates the template, installs Volt's packages into it from their
built output the way a registry would, and then builds it through its own
config, checks that the build wrote the `ssg` home page to
`dist/client/index.html` as the handler answers `/` and wrote nothing for the
other two, asks the server bundle for every route, a server-function call and a
URL the table does not have, serves the rendered pages again behind a host that
serves the client's files as they are, hydrates the home page it serves from
that file and the pricing page in a DOM — asserting the nodes afterwards are the
ones the file or the server printed, and that booting asked the host for no
plan — navigates from it, previews the build as `pnpm preview` does, and asks
its dev server for a page. It also builds the template with a `node:` import added to a page, to
watch `renderPath` refuse it, and turns the option off by the README's steps
and runs what is left in a DOM as a client-rendered application.

It cannot yet be generated into a standalone project until the packages it
needs are published — a project outside the repository installs from npm — so
read it in the repository, under `packages/create-volt/templates/server-render/`.
See [`create-volt`](./create-volt) for why that refusal is deliberate.

A URL that a more specific route which is not `ssg` claims is not written from
a less specific pattern. It comes back in `withheld`, with that route
as `owner`, while the pattern's other URLs are written as usual. A `/*` beside
an index route rendered per request writes everything it is given except `/`.
The table can say this wherever the skipped route names the URL with nothing
supplied: `/` for an index route, `/pricing` for a literal, `/docs` for
`/docs/:page?` or `/docs/*`. It cannot say it for a URL the route claims only
through a parameter, because nothing asks for the values of a route the build
does not write. A `/:lang` rendered per request beside a `/*` given
`{ '*': 'en' }` still has `/en` written from the catch-all. Give the catch-all
only values nothing more specific claims, or mark it `ssr` and let the server
render what it catches. A more specific `ssg` route skipped with `no-params`
claims its URLs just as unseen; give it its `params`, and each is written from
it rather than from the catch-all.

An `ssg` route whose `params` leave out the URL it has with nothing supplied
keeps that URL as well: `/docs/:page?` answered with `{ page: 'intro' }`
keeps `/docs` from a `/*` given it, and the URL comes back in `withheld` with
`/docs/:page?` as `owner`. `owner.mode` tells the two cases apart: `ssg`
here, and `ssr` or `csr` for a route rendered per request or in the browser.

A renderer that resolves the route itself can catch every URL a route that is
not `ssg` claims: answering `null` withholds the URL rather than writing it,
and the cache keeps nothing for it. `serverRender` does this through the
server it built.

```ts
import { prerender } from '@voltdev/vite-plugin/ssg';
import { flattenRoutes, matchRoutes, routeMode } from '@voltdev/router';

const branches = flattenRoutes(routes);
await prerender({
  branches,
  outDir: 'dist',
  render: (pathname) =>
    routeMode(matchRoutes(branches, pathname), 'ssg') === 'ssg' ? renderPage(pathname) : null,
});
```

