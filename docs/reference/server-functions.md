# Server functions

`@voltdev/server` lets a method run on the server and be called from the browser
as if it were local.

::: warning Not on npm yet
`@voltdev/server` is not published. It works from a checkout of the Volt repository;
the packages on npm today are `@voltdev/core`, `@voltdev/reactivity`,
`@voltdev/compiler` and `@voltdev/vite-plugin`.
:::

```ts
import { Server, guard } from '@voltdev/server';

function session(request: Request): { id: string } | null {
  return lookUpSession(request.headers.get('cookie'));
}

export class Todos {
  @Server()
  async create(text: string): Promise<{ id: string }> {
    const user = await guard(session);
    return db.todos.insert({ owner: user.id, text });
  }
}

export const todos = new Todos();
```

```ts
// in a component, in the browser
const { id } = await todos.create('Buy milk');
```

In the server build the body runs as written. In the client build the
[Vite plugin](./vite-plugin) replaces the body with a POST to the server and
leaves the signature, so the call site is typed end to end and nothing in the
body — the database client, the secret, the query — reaches a bundle.

This page is about calling server code. Rendering pages on a server is
[server rendering](./server).

## Dependency-free, on purpose

The package is a `(Request) => Promise<Response>` and nothing else. It does not
depend on the router, the renderer, or the rest of Volt, and it does not know it
is part of a framework.

That is what makes it mountable anywhere a `Request` arrives — an edge function,
a Node server, a route inside another framework — and it is why
[`serverRender`](./server-render) generates its wiring into the application rather than
putting it here. The cost is that server functions are not aware of pages: a
function cannot read which route the caller was on unless the caller passes it.

## `@Server()`

```ts
Server(options?: { public?: boolean }): ServerDecorator
```

A `@Server()` method must be an `async` **instance** method, and its arguments
and return value must be [serialisable](#what-crosses-the-wire).

Instance, because the handler constructs the class once per call: nothing a
method assigns to `this` outlives the request that assigned it. A static member
would be one object shared by every caller the process is serving, so the build
refuses `@Server()` on one. TypeScript itself accepts a decorator on a static
method, which is why this is caught by the build and not by the type checker.

**A method that does not reach a guard fails the build.** An endpoint is public
the moment it is deployed — anyone with `curl` can call it — so an unguarded one
is a decision, and the build insists it be written down:

```ts
import { Server } from '@voltdev/server';

export class Status {
  @Server({ public: true })
  async ping(): Promise<'ok'> {
    return 'ok';
  }
}
```

`public: true` is the whole of that option. Saying it is the point: an open
endpoint should be a sentence somebody wrote, in the diff, next to the method.
The same rule as the template compiler refusing `:for` without `:key` — a mistake
the build can see is refused rather than warned about.

## `guard`

```ts
guard<T>(check: (request: Request) => T | Promise<T>): Promise<Exclude<Awaited<T>, null | undefined | false>>
```

`check` is handed the incoming `Request` and returns who is asking, or `null`,
`undefined` or `false` to refuse. A refusal becomes a 401 before the rest of the
body runs, so what `guard` resolves with is never empty and needs no narrowing.

```ts
import { Server, guard } from '@voltdev/server';

function session(request: Request): { id: string } | null {
  const cookie = request.headers.get('cookie');
  return cookie ? lookUp(cookie) : null;
}

export class Account {
  @Server()
  async rename(name: string): Promise<void> {
    const user = await guard(session);
    await saveName(user.id, name);
  }
}
```

**It must be the first statement, awaited.** The request is reachable only
synchronously: once a body has awaited anything, another call may be the one in
flight, and a guard that read the request then would authorise against someone
else's cookies. Called anywhere else, it throws and says so.

## Errors

```ts
new ServerError(message: string, status?: number, options?: { cause?: unknown })
```

| Class | Status | Meaning |
|---|---|---|
| `ServerError` | `500` unless given | Anything the author chose to tell the caller |
| `Unauthorized` | `401` | No credentials, or none this endpoint recognises |
| `Forbidden` | `403` | Recognised, and not allowed to do this |
| `BadRequest` | `400` | The arguments were not what the method's type says |

**By default a caller is told nothing.** An endpoint is public, so its failure
path is read by whoever is probing it, and a stack trace or a driver's message
— `relation "users" does not exist` — is reconnaissance. An error reaches the
client only when it was thrown as a `ServerError`, which is a decision the author
made about that sentence. Everything else becomes a 500 with no detail, and the
original goes to the handler's `onError`.

`cause` is kept for the server's own log and is never serialised into a response.

In the browser, a failed call rejects with a `ServerCallError` carrying `status`
(`0` when the request got no answer at all) and `endpoint`, the id a server log
correlates against.

## The handler

```ts
createHandler(options?: HandlerOptions): (request: Request) => Promise<Response>
```

| Option | Default | Description |
|---|---|---|
| `base` | `'/_volt/'` | The URL prefix the endpoints answer under |
| `maxBodyBytes` | `1048576` (1 MiB) | The largest request body accepted |
| `onError` | — | `(error, { endpoint, name, request }) => void` for everything that escaped |

```ts
import { createHandler } from '@voltdev/server';

const handle = createHandler({
  onError: (error, { name }) => log.error(`${name} failed`, error),
});

export default { fetch: handle };
```

**Pass `onError`.** It is the only place an unexpected failure is visible — the
caller was deliberately told nothing — so a handler without it throws away its own
incident reports.

`maxBodyBytes` has a default rather than being opt-in because a public endpoint
with no ceiling is a way to exhaust memory that needs no account. A body over it
is refused with 413 before it is parsed.

A call with fewer arguments than the method declares is refused with 400 rather
than run with `undefined` in their place.

### Mounting it among other routes

`createHandler` answers 404 for anything that is not a call, which is right when
it owns the process. Inside another framework, ask first:

```ts
import { createHandler, isServerCall } from '@voltdev/server';

const functions = createHandler();

export async function fetch(request: Request): Promise<Response> {
  if (isServerCall(request)) return functions(request);
  return renderPage(request);
}
```

`isServerCall(request, base?)` is true for a POST under the base. A GET is never a
call, so a reader who types a function's URL into the address bar is sent to the
page renderer, and a route at `/_voltage` is not mistaken for one.

### Why a browser cannot forge a call

Every call carries a custom header. A browser will not send a custom header
cross-site without a CORS preflight, and the handler never answers one — so a
form on another site cannot submit to these endpoints with the user's cookies.
Nothing needs configuring for that; it is a property of the transport.

## The client

```ts
import { configureServerCalls } from '@voltdev/server/client';

configureServerCalls({ base: 'https://api.example.com/_volt/' });
```

| Option | Description |
|---|---|
| `base` | Where the endpoints are mounted. Must match the handler's; may carry an origin |
| `fetch` | Replaces `globalThis.fetch` — a test double, or an instrumented one |
| `headers` | Sent with every call, for a tracing or tenant header |

The call sites themselves are generated; `callServer` is what a stripped method
body becomes, and it is not meant to be called by hand.

## What crosses the wire

Arguments and return values may be strings, numbers, booleans, `null`,
`undefined`, bigints, `Date`s, arrays, and plain objects of those. The
`Serializable` type says so to the type checker, which is where an author meets
it; the encoder enforces the same at runtime, which is what still holds when a
value came back from a driver typed `any`.

`JSON.stringify` is not the format, and it would fail silently three ways:
`undefined` vanishes from objects and becomes `null` in arrays; `NaN` and
`Infinity` become `null`; and a class instance is flattened to its own fields —
which is exactly how a database row, or a `User` carrying its password hash,
crosses a boundary nobody meant to open. The first two are corruption and the
third is a leak.

So values JSON cannot carry are tagged and restored, and a value whose prototype
is anything but `Object.prototype` or `null` is **refused**, with the path to it:

```
[volt] the return value at user.owner cannot cross a @Server() boundary: an instance of Row.
  Only strings, numbers, booleans, null, undefined, bigints, Dates,
  arrays and plain objects are serialized. Map the value to a plain
  object whose type says exactly what leaves the server.
```

A refusal without a path is a message you have to bisect a response to act on.

`toWire` and `fromWire` are the encoder, exported for a caller building its own
transport; a `WireError` is what they throw.

## What it does not do

- **No streaming responses.** A call returns one value. A server function cannot
  yield a sequence to the caller as it produces it.
- **No file uploads.** Arguments are serialised values, not `FormData`; send a
  file to an ordinary endpoint.
- **No retries.** A failed call rejects once. Whether a second attempt is safe
  depends on whether the call was idempotent, which only its author knows —
  [the query cache](./query) retries reads, and a mutation should be retried
  deliberately or not at all.
