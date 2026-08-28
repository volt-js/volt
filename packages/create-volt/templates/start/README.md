# __PROJECT_NAME__

A Volt project in `start` mode: the router, the query cache, server rendering
and server functions wired together, with each route saying where its markup is
made.

## What is here, and what is not

`vite.config.ts` is one line of configuration:

```ts
plugins: [volt({ start: true })]
```

Everything that line implies — matching a URL to a route, deciding whether to
render it, serializing what the server settled on, mounting server functions at
the same origin, and attaching the browser to what arrived — is generated into
this project's own module graph. You will not find it in these files, and there
is no package to read it in either: it is compiled from the plugin at the
versions this project has.

`server.ts` is the deployable entry, and it is a `(Request) => Promise<Response>`
with no `node:` import in it. That is what makes it deployable to an edge
runtime, and `renderPath` is the build check that keeps it true.

## Where each page is rendered

`src/routes.ts` says, and it says it per route:

| route | mode | why |
| --- | --- | --- |
| `/` | `ssg` | Nothing on it depends on the request. Built once. |
| `/pricing` | `ssr` | The answer depends on who asked. Rendered per request. |
| `/dashboard` | `csr` | Behind a login, and gains nothing from a server. |

`mode` is resolved leaf to root, so the layout says what the section does by
default and a page says when it knows better.

## Turning it off

Delete `start: true`. The project becomes an ordinary client-rendered
application and nothing else has to change — server rendering here is a choice,
and it stays one.

## Commands

```bash
pnpm dev      # develop
pnpm build    # build the client and the server entry
pnpm test     # run the tests
```
