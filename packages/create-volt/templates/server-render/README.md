# __PROJECT_NAME__

A Volt project with `serverRender` on: the router, the query cache, server rendering
and server functions wired together, with each route saying where its markup is
made.

## What is here, and what is not

`vite.config.ts` is one line of configuration:

```ts
plugins: [renderPath(), volt({ serverRender: true })]
```

Everything `serverRender` implies — matching a URL to a route, deciding whether to
render it, serializing what the server settled on, mounting server functions at
the same origin, and attaching the browser to what arrived — is generated into
this project's own module graph. You will not find it in these files, and there
is no package to read it in either: it is compiled from the plugin at the
versions this project has.

`server.ts` is the deployable entry, and it is a `(Request) => Promise<Response>`
with no `node:` import in it. That is what makes it deployable to an edge
runtime, and `renderPath()` is the build check that keeps it true: `pnpm build`
fails, naming the chain of imports, when anything a page renders reaches a
`node:` builtin. A `@Server()` method is the other side of the network and may
import one.

`server.ts` is also what `pnpm dev` answers every page and every
server-function call with, so the server you develop against is the one you
deploy.

`pnpm build` builds the client first and the server second, because the server
needs two things only the client build has: the `index.html` it emitted, which
asks for the hashed assets rather than `/src/main.ts`, and the identity of that
build, which the server writes onto every page it renders so a browser holding
a previous deploy's JavaScript builds the page again rather than claiming
markup it does not match.

```text
dist/client/   the files a host serves as they are, index.html among them
dist/server/   server.js, which a host runs — and never serves
```

Then it writes the `ssg` pages: it renders `/` through `server.js` and writes
the page to `dist/client/index.html`, byte for byte what the server would answer
for `/`, so the browser claims it the same way.

A host serves `dist/client` as files and hands every other request to the
`fetch` that `server.js` exports. The empty page the server renders into is
inside `server.js`, not in `dist/client`, so no host can answer a path with it
unrendered.

## Where each page is rendered

`src/routes.ts` says, and it says it per route:

| route | mode | why |
| --- | --- | --- |
| `/` | `ssg` | Nothing on it depends on the request. Written to a file by `pnpm build`. |
| `/pricing` | `ssr` | The answer depends on who asked. Rendered per request. |
| `/dashboard` | `csr` | Behind a login, and gains nothing from a server. |

`mode` is resolved leaf to root, so the layout says what the section does by
default and a page says when it knows better.

An `ssg` page is rendered once, at build time, for a request that is nobody's:
no cookies, no headers. Its loaders run there, and so do the guards of the
server functions they call: on `/` the `session` in `src/api.ts` would find no
cookie and answer for an anonymous reader, and every reader would be sent that
page — which is why `/pricing` is `ssr`. A guard that refuses such a request
fails the build, naming the page, rather than writing the refusal into a file.
The server renders an `ssg` path it is asked for from that same request, so it
answers with the page the build wrote. A route whose pattern has a parameter,
such as `/docs/:page`, is told which pages to write with `serverRender.params`;
see
[the pages the build writes](https://voltjs.dev/reference/server-render#the-pages-the-build-writes).

A route's loader answer is sent with its page, so the browser starts `/pricing`
from it rather than running its loader again; see
[what data during a render covers](https://voltjs.dev/reference/server-render#data-during-a-render).

## Turning it off

Server rendering here is a choice, and it stays one — but the option is also
what generates the modules this project imports, so turning it off is more than
deleting a line. Delete `serverRender: true`, and then:

`src/main.ts` imports `virtual:volt/client`, which exists only while the option
is on. Start the application yourself instead:

```ts
// src/main.ts
import './styles.scss';
import { mount, provideOutlet } from '@voltdev/core';
import { createRouter, provideRouter } from '@voltdev/router';
import App from './app.js';
import { routes } from './routes.js';

const router = createRouter({ routes });
await router.resolve(location.href);
mount(App, '#app', {
  setup: () => {
    provideRouter(router);
    provideOutlet(router.outletAt(0));
  },
});
await router.start({ resolve: false });
```

`server.ts` and `src/volt-server-render.d.ts` are no longer built or read, so
delete them. `pnpm build` then writes an ordinary client build to `dist`.

`currentPlan()` still posts to `/_volt/`, and nothing answers it any more: the
`/pricing` loader fails until a server of your own mounts `createHandler` from
`@voltdev/server` at that path.

## Commands

```bash
pnpm dev      # develop, with every page rendered by server.ts
pnpm build    # build dist/client, then dist/server, then write the ssg pages
pnpm preview  # serve that build as a host would: the files, then server.js
pnpm test     # run the tests
```
