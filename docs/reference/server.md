# Server rendering

Volt renders to markup two ways. `renderToStaticMarkup` writes a page nothing
is going to attach to; `renderToString` writes one that will hydrate, and
carries the state its signals came to hold. Both are walks over the same
segments, so they write the same bytes — the delimiters a hydration walk steps
by are the writer's, not either consumer's.

`renderToStream` comes after both, because streaming has a hard dependency on
error boundaries: once the first byte is out the status line is gone, and a
throw has nowhere to go. That is exactly the capability `renderToString` still
has, and it is why it ships first.

Underneath it are two things the primitives already depend on: the lane a
server flushes, and the scope that keeps one request's state out of the next
one's page. Both are `@voltdev/reactivity`, re-exported through
`@voltdev/core`.

## Rendering

```ts
import { renderToStaticMarkup } from '@voltdev/core/server';

const { html, portals, styles } = await renderToStaticMarkup(App, {
  props: { title: 'Volt' },
});
```

| Field | Description |
|---|---|
| `html` | The component's own markup |
| `portals` | What `:portal` wrote, which belongs where this render does not reach |
| `styles` | The styles this request's components declared, by selector |

The render is one synchronous walk inside a request scope, and the request is
settled before it returns — so a resource that fetched is waited for. What it
does not do is put late data into bytes already written: a value is serialized
once, where it stood when the walk passed it. Rendering data that arrives after
the walk is what async boundaries are for, and they arrive with streaming.

It needs a server build. Templates are compiled for one side or the other, and
a client build emits render functions that clone markup rather than write it,
so calling this under `__VOLT_SERVER__ === false` throws rather than producing
something subtly wrong.

### What it does not write

A `<select>` bound with `:model` emits no selection. The selected state lives
on the `<option>`, and by the time the value is known the writer has passed the
place those options are written. Marking it needs a hole to come back to, which
is what the segment tree grows when hydration and streaming need one. This is a
gap rather than a decision.

## Rendering a page that hydrates

```ts
import { renderToString } from '@voltdev/core/server';

const page = await renderToString(App, { props: { title: 'Volt' }, nonce });
if (page.status === 500) return new Response('Internal Server Error', { status: 500 });

return new Response(
  `<!doctype html><html><body><div id="app">${page.html}</div>${page.state}</body></html>`,
  { status: page.status, headers: { 'content-type': 'text/html; charset=utf-8' } },
);
```

| Field | Description |
|---|---|
| `status` | `200` when the walk finished, `500` when it threw |
| `error` | What was thrown, or `null` |
| `html` | The markup, or `null` — typed so the compiler makes you look |
| `state` | The `<script>` carrying initial signal state, or `''` |
| `portals` | What `:portal` wrote |
| `styles` | The styles this request's components declared, by selector |

A failure is returned rather than thrown, and that is the whole point of this
entry. The walk buffers its bytes, so a throw discards them: there is no
half-written page to send by accident, and the status line has not gone out
yet. A build that is not a server build still throws, because that is not a
request failing — it is the wrong bundle, it fails identically every time, and
a 500 per request would hide it.

### The state payload

Markup alone hydrates a page that looks right and is empty behind it. The
client's signals start wherever their declarations say, so a value the server
already fetched and shipped is back at its default the moment the bundle runs,
and is fetched again to arrive at what is already on the screen.

`hydratable` is the signal that crosses, and `wasHydrated` is how a fetch knows
not to happen twice:

```ts
import { hydratable, wasHydrated } from '@voltdev/core';

class Profile {
  data = hydratable<User | undefined>('profile.user', () => undefined);
  user = createResource(load, { data: this.data, immediate: !wasHydrated(this.data) });
}
```

The key is a string an author writes rather than a position the two renders
happen to agree on: components are reached in different orders on the two sides
once a shell streams or a route resolves, while the names they know their own
data by do not move. It has to be unique across a page, and a server render
meeting the same key twice refuses rather than letting the last one win.

What is registered on the server is the signal, not its value — read after
`settleRequest` has finished, which is the only moment the answer is the one
the page was built from. A key still holding `undefined` is left out entirely,
so `wasHydrated` comes back false and whatever would have fetched still does.

Values are carried as JSON. Anything JSON would carry *wrongly* is refused with
the key named: `NaN` and `Infinity`, a `bigint`, a function, and a hole in an
array. `undefined` as an object property is allowed, because JSON drops the key
and reading it gives `undefined` on both sides. Dates, Maps and shared
references wait on the wire format server functions also need.

### The script, and the nonce

The payload is one `<script type="application/json" data-volt-state>`.
`JSON.parse` beats evaluating an object literal at size, and an element of that
type cannot execute however it was built.

```ts
import { stateScript } from '@voltdev/core/server';

stateScript({ 'profile.user': { name: 'Ada' } }, { nonce });
```

Inside it, `<` is written as `\u003C` — the one rule, because `<` is what
starts `</script>`, `<!--` and a nested `<script`, and escaping the character
all three begin with needs neither case folding nor lookahead. U+2028 and
U+2029 are escaped too: they are line terminators to a JavaScript parser and
ordinary characters to a JSON one, which costs nothing here and stops being
free the moment anything copies the document into a JS literal.

Pass `nonce` on any page with a `script-src` policy. Without it the element is
dropped by the browser, every signal starts at its default, and the page still
renders — so what a missing nonce looks like is server rendering having quietly
stopped paying for itself, on the deployment that has a CSP and not on the one
that does not.

## Hydration

Every dynamic child is written between `<!--[-->` and `<!--]-->`. The client's
template has a single comment marker in that position and the server has however
many nodes the value came to, so the delimiters are what let a hydration walk
step over a hole instead of counting siblings through it — and what tell the
block filling that hole which nodes it owns.

Nothing else marks anything. Attributes and an element's own content are written
where they stand and are found by the same build-time path a client build
resolves, so they cost no bytes at all.

A page is claimed by compiling the client's templates with `target: 'hydrate'`
and starting the walk at the container the server's markup was parsed into:

```ts
import { hydrate } from '@voltdev/core/runtime';

hydrate(document.getElementById('app')!, () => render(ctx));
```

Blocks are claimed rather than cloned, so the nodes on the page after hydration
are the nodes the server printed. What is compared is one name per block — the
tag the markup should have started with. Bindings write rather than compare, so
a *value* cannot mismatch; a structural disagreement is undetectable by
construction, which leaves that name as the only evidence a block is standing
where it thinks it is. When it disagrees, the block clones, the wrongly-claimed
nodes are removed by the hole that owns them, and `onHydrationMismatch` is told.
The damage stops at the hole.

## The build flag

```ts
declare const __VOLT_SERVER__: boolean;
```

Which side of the render this build is, and it decides behaviour rather than
diagnostics:

| When it is `true` | When it is `false` |
|---|---|
| `onMount` is never queued | `onMount` runs after the DOM is in the document |
| A flush stops after the data phase | Measure and user effects run too |
| Nothing self-flushes on a microtask | Updates coalesce onto one, as always |
| `settleRequest` drives the render | `settleRequest` does nothing and says so |

`@voltdev/vite-plugin` defines it per environment: `true` for anything an
environment consumes on the server, `false` for the client, on a dev server as
much as on a build. Without the plugin, define it yourself — a bundler that
leaves the identifier undefined crashes on the first read.

## One request

```ts
import { createRequestScope, mount, requestStyles, runInRequest, settleRequest }
  from '@voltdev/core';

const scope = createRequestScope();
const host = document.createElement('div');

await settleRequest(scope, () => {
  mount(App, host);
});
```

| Function | Description |
|---|---|
| `createRequestScope()` | A `RequestScope`: its own effect queues, state and pending data |
| `settleRequest(scope, build)` | Build and flush inside `scope` until no data is outstanding |
| `runInRequest(scope, fn)` | Run `fn` with `scope` current, and return what it returns |
| `currentRequest()` | The scope a call is running under, or `null` |
| `requestState(key, create)` | A symbol-keyed slot belonging to the current request |
| `clearRequestState(key)` | Forget a slot, so the next read builds it again |
| `trackRequestData(promise)` | Data the request must wait for before it is written out |
| `requestStyles()` | What this request's components declared, by selector |

### `settleRequest`

Enters the scope, runs `build`, and flushes to quiescence; then awaits the data
that flush started and does it again, until a flush asks for nothing. The loop
is not a formality — a resource whose source is another resource's data does
not exist until the first answer lands.

Two things follow from how it waits:

- **Nothing observes a request across an `await`.** The rule is to flush to
  quiescence *before* every await, which holds because Volt's render is
  synchronous by construction. There is no `AsyncLocalStorage` underneath this
  — it is a `node:` builtin, and Volt runs on edge runtimes that have none.
  So `currentRequest()` is null inside a `.then`, and anything that needs to
  know which request it belongs to must read it on the way in.
- **A rejection is the resource's business.** Data is awaited settled, not
  resolved: a fetch that fails has already written its own error state, and
  the page that state renders is still a page.

The loop is bounded at 20 rounds and throws past it. A tree that asks for one
more fetch every time the last one lands would otherwise be a request that
never answers at all.

In a client build the whole body is compiled out, and calling it in
development warns rather than silently rendering nothing.

### `runInRequest`

Synchronous by contract. Handing it a function that awaits puts the request
back where it started while the work carries on inside it, which is the failure
the scope exists to prevent.

It is also how you read what a settled request collected:

```ts
const styles = runInRequest(scope, () =>
  [...requestStyles()]
    .map(([selector, css]) => `<style data-volt="${selector}">${css}</style>`)
    .join(''),
);

return `<!doctype html><html><head>${styles}</head><body>${host.innerHTML}</body></html>`;
```

Styles are collected rather than injected under a request, for two reasons: a
server has no `document` to append to, and the process-global "already
injected" mark a browser relies on would give the first request every
component's styles and every request after it none.

### `requestState`

The mechanism the rest of this is built out of. The key is a symbol, so a slot
belongs to whoever declares it rather than to this module:

```ts
const LOCALE = Symbol('app.locale');

function useRequestLocale(): Signal.State<string> {
  return requestState(LOCALE, () => new Signal.State('en'));
}
```

Created once per request, including when what it holds is `undefined`. With
no request current — a browser — the same call reads a process-wide slot
instead, so nothing in a component has to know which side it is running on.

### `trackRequestData`

What `createResource` calls with the promise it just started, so
`settleRequest` knows to wait for it. Reach for it directly when a component
fetches without a resource. Compiled out of a client build, where a request is
nobody's to wait for: the page renders without the data and updates when it
lands.

## What a server does not run

Measure effects and user effects are not drained on a server, and `onMount` is
never queued — not merely never awaited, since a queued microtask fires at the
first `await` inside the render. Anything that reads geometry or touches a live
document therefore belongs in one of those two, and anything that has to happen
on both sides belongs in a field initializer, a `renderEffect` or a
`dataEffect`.

Module-scope state is per process, not per request. A `Signal.State` at module
scope is shared by every response the process is assembling at once; keep
read-mostly configuration there and nothing else, and put request-derived state
in a component or a `requestState` slot.
