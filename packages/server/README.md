# @voltdev/server

Server functions for Volt. A method marked `@Server()` runs on the server and
is called from the browser as though it were local: the server build keeps the
body as written, and the client build — done by the Vite plugin — replaces it
with a POST to a generated endpoint and leaves the signature, so the call site
is typed end to end and nothing in the body reaches a bundle. A method that
does not reach a guard fails the build, so an open endpoint is a decision
written down next to the method rather than something forgotten.

```bash
pnpm add @voltdev/server@alpha
```

> **Not on npm yet.** The command above is what installs it once it is released.
> Until then it works from a checkout of the [Volt repository](https://github.com/volt-js/volt) —
> see [what is on npm](https://voltjs.dev/guide/getting-started#what-is-on-npm).

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

The server side is a `(Request) => Promise<Response>` and nothing else. It
does not depend on the router, the renderer or the rest of Volt, so it mounts
wherever a `Request` arrives — an edge function, a Node server, a route inside
another framework:

```ts
import { createHandler } from '@voltdev/server';

const handle = createHandler({
  onError: (error, { name }) => log.error(`${name} failed`, error),
});

export default { fetch: handle };
```

Arguments and return values are serialized rather than `JSON.stringify`d:
`undefined`, bigints and `Date`s survive the trip, and a value whose prototype
is anything but `Object.prototype` — a database row, a class instance — is
refused with the path to it, so nothing crosses the boundary unless its type
says it may. An error reaches the caller only when it was thrown as a
`ServerError`; everything else becomes a 500 with no detail, and the original
goes to the handler's `onError`.

`@voltdev/server/client` is the browser's half. The generated stubs call it,
and `configureServerCalls` sets the base URL, the headers and the `fetch` they
use.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev/reference/server-functions](https://voltjs.dev/reference/server-functions)
