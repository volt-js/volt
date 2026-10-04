# Component API

## `@Component(config)`

```ts
interface ComponentConfig {
  selector: string;
  templateUrl?: string;
  render?: RenderFn;
  needsHydration?: boolean;
  styleUrl?: string;
  styleUrls?: string[];
  styles?: string | string[];
  imports?: ComponentType[] | (() => ComponentType[]);
}
```

| Option | Description |
|---|---|
| `selector` | Tag this component answers to. Required |
| `templateUrl` | Path to an `.html` file, relative to this file |
| `render` | Pre-compiled render function; the Vite plugin fills this in |
| `needsHydration` | Whether the template has anything to attach in a browser; the Vite plugin fills this in. See [`needsHydration`](#needshydration-component) |
| `styleUrl` / `styleUrls` | Path(s) to `.scss` files, relative to this file |
| `styles` | Compiled CSS, filled in by the plugin from `styleUrl` |
| `imports` | Components this template may reference, or a function returning them |

`imports` takes a function for components that use each other: `imports: () =>
[Other]` defers the read, where a plain array would read `Other` before its
class exists. A component never lists itself — recursion into its own selector
resolves on its own.

`templateUrl`, `styleUrl` and `styleUrls` are resolved **at build time** by
`@voltdev/vite-plugin`, which also registers each file with the watcher so
edits hot-reload. Without the plugin they cannot be resolved — the browser has
no filesystem — and Volt throws with a message saying so.

Applied to a class. Runs after every member decorator, so the input and
output metadata it reads is complete.

## `@Prop(options?)`

```ts
interface PropOptions {
  alias?: string;    // template-facing name
  required?: boolean;
}
```

Two forms, differing in reactivity:

```ts
@Prop() a = new Signal.State(0);  // parent writes call .set() — reactive
@Prop() b = 0;                    // plain assignment — not reactive
```

A prop is reactive because it holds a signal, never because the decorator
rewrote the property. `@Prop() accessor` is rejected for that reason: it would
make `{ b }` a tracked read while looking like a plain field.

A missing required prop throws at construction.

An **undeclared** prop throws too. Volt has no fall-through for unrecognised
attributes, so a name matching no prop can only be a mistake — most often a
kebab-cased spelling of a camelCase prop:

```
[volt] V0208 <v-counter> has no prop "max-count". Did you mean "maxCount"? Declared props: maxCount, onChanged.
```

There is one spelling: the declared one. Cannot be applied to static
or symbol-named members.

## What a caller writes on the tag

A component refuses a prop it does not declare, which is what catches a
kebab-cased spelling of a camelCase prop. The exceptions are the names that
describe an element rather than a component — `class`, `style`, `id`, `title`,
`role`, `lang`, `dir` — and anything named `data-*` or `aria-*`. Those reach
the element the component's template marks with
[`:host`](./template-syntax#host), merged with what the template already put
there.

```html
<!-- v-button -->
<button :host class="volt-button" type="button"><slot></slot></button>
```

A component handed one of them whose template marks no element is told so.

## Notifying the parent

A component notifies its parent by calling a function the parent gave it:

```ts
@Prop() onChanged?: (value: number) => void;

// somewhere in the class
this.onChanged?.(next);
```

```html
<v-counter :onChanged="handle"></v-counter>
```

A prop matching `on[A-Z]` given a bare method reference is bound to the
component that declared it, so `this` is correct without an arrow.

`:on-*` is the syntax for real DOM and custom-element events. Applying it to a
Volt component throws, naming the callback prop to use instead.

## Lifecycle

```ts
interface OnMount { onMount(): void }
```

| | when |
|---|---|
| field initializers | at construction — computeds are lazy and effects are deferred, so both see props |
| `onMount` | after the component's DOM is in the document |
| `onCleanup(fn)` | registered anywhere in the component; runs on teardown |

Setup belongs in field initializers: a `Signal.Computed` reads props lazily,
and an `effect` has its first run deferred until after props are applied, so
both see the values the parent passed. Teardown belongs in `onCleanup`,
written beside the setup it undoes.

`onMount` exists for the one thing neither can do — touching DOM that is
already in the document, for focus, measurement, or handing an element to a
library.

`mount()` flushes before returning, so the tree it hands back already
reflects any field effects.

## `mount(component, target)`

```ts
const app = mount(App, '#app');       // selector or Element

app.instance;   // the component instance
app.unmount();  // dispose every effect, then clear the host
```

A target that matches nothing throws [V0212](/e/V0212).

## `hydrate(component, target)`

```ts
import { hydrate } from '@voltdev/core';

const app = hydrate(App, '#app');
```

The same as `mount`, and the same handle back, except that it attaches to
markup a server already wrote instead of building it. The templates have to be
compiled to claim nodes rather than create them — `hydrate: true` on
[the Vite plugin](./vite-plugin), which [`serverRender`](./server-render) turns on. See
[Hydration](./server#hydration) for what is claimed and why this is a separate
entry rather than a flag on `mount`.

## `needsHydration(component)`

```ts
needsHydration(component: ComponentType): boolean
```

Whether rendering this component in a browser has anything to do. The Vite
plugin records the compiler's answer beside the render function: a template
that only clones fixed markup has no binding, listener, block or child to set
up, and a page made only of components like that needs no JavaScript.
[`serverRender`](./server-render#partial-hydration) reads it to leave the script off such a
page.

It is `true` unless the build said otherwise — a component compiled without the
plugin, in a test or a playground, has no answer recorded, and treating unknown
as static would ship a page that never wakes up.

## `compileTemplate(source, filename?)`

From `@voltdev/core/jit`. Compiles template source into a render function at
runtime, for tests and playgrounds:

```ts
import { compileTemplate } from '@voltdev/core/jit';

@Component({
  selector: 'v-greeting',
  render: compileTemplate(`<p>Hello, { name.get() }.</p>`),
})
export class Greeting {}
```

Importing this entry pulls the compiler into the bundle. Production
components use `templateUrl`, which needs none of it at runtime.

## Error boundaries

`errorBoundary(children, options?)` wraps a piece of the tree. Anything thrown
below it — while it is being built, or by one of its effects long afterwards —
arrives at the boundary instead of the console.

```ts
import { errorBoundary } from '@voltdev/core';
import { insert } from '@voltdev/core/runtime';

insert(
  host,
  errorBoundary(() => createComponent(ctx, 'v-report', props, null, null), {
    fallback: (error, retry) => renderProblem(error, retry),
    onError: (error) => {
      if (!(error instanceof ReportFailed)) throw error; // to the boundary above
    },
  }),
);
```

The boundary decides one of three things. `onError` throwing sends the error
to the next boundary up. A `fallback` replaces the subtree: everything below is
disposed first, so its cleanups run and its listeners detach, and the fallback
is built in a fresh scope. With neither, the error is swallowed.

`retry` builds the subtree again from its inputs, which is only correct because
a component is constructed once and holds no render state — the second attempt
is a new instance, not a resumed one.

A component can be its own boundary by calling
[`onError`](./reactivity.md#errors) in its constructor. It catches its own
subtree and nothing wider, because a component owns a scope.

## Errors

Every refusal the framework makes throws a `VoltError`, exported from
`@voltdev/core`:

| Field | Description |
|---|---|
| `code` | `'V0208'` — stable across releases, and what a report should group by |
| `detail` | What failed, named: `{ selector: 'v-counter', prop: 'max-count' }` |
| `docs` | `'https://voltjs.dev/e/V0208'` — the page with the full sentence |
| `message` | The sentence in development; the fields above, as text, in production |

`detail` holds identities — a selector, a prop's name, a boundary's id — and
never the data itself. A production error is read by whoever operates the
application, and the row that failed is not theirs to see.

**A production build leaves the sentence out.** Every message is written as
`__VOLT_DEV__ && '…'`, which a production build folds to `false` and a minifier
deletes along with the text, so an application does not ship the bytes of every
message it might one day print. The throw itself is unchanged — same call, same
line, same type — and what is left says what failed and where to read the rest:

```
[volt] V0212 target=#app https://voltjs.dev/e/V0212
```

The message repeats `code` and `detail` because a log that keeps only `message`
is the common case. Every code has a page, generated from the source — see
[Error codes](/e/).

Two constants, deliberately separate, and both defined by the Vite plugin:

| Constant | Gates | In production |
|---|---|---|
| `__VOLT_DEV__` | the sentence | `false` |
| `__VOLT_DIAGNOSTICS__` | `detail`, `docs`, and the fields in `message` | `true` |

A build counting every byte sets `diagnostics: false` on
[the plugin](./vite-plugin) and gets a bare `[volt] V0212`. A build that
defines neither constant keeps its diagnostics rather than crashing on an
undefined name.

Some codes are never seen in production at all: a prop that does not exist, a
required prop left out, `:on-*` on a component. Those are authoring mistakes the
framework checks only in development, and the check goes with its sentence. The
[list of codes](/e/) marks which they are.

## Runtime helpers

`createComponent` and `slot` are called by compiled templates. You should not
need them directly.

## Code splitting

There is nothing to write. The compiler works out which components cannot be
on screen when the page first renders — every use of them sits behind a `:if`
or a `:portal` — and the build splits exactly those into their own chunks,
fetching them ahead of time once the page is idle.

A component used directly is never split, because putting it in another chunk
would add a network round trip to the first paint. Neither is a small one:
chunks compress against their own contents, so splitting a component that
saves less than it costs in compression makes the application larger.

Nothing about a component changes to make this happen, and there is no
directive or option to reach for.

While its chunk is in flight a split component renders a fallback, and if the
chunk fails to load, an error output with a way to try again.

On a server the chunk is waited for, the way a resource's fetch is. The
fallback goes into a region while the chunk loads, and the component is
written over it once the chunk has landed, in the frame the walk gave it, so
its ids and styles are the ones it would have had in the walk itself. A page
is not sent with a fallback in it for want of a chunk that was a moment away,
and a chunk loaded once is the process's, so the next request writes the
component in the walk. When the chunk fails to load there — a module that
reads the window when it is evaluated cannot be loaded by a server at all —
the page still answers, with the fallback in the component's place and a
`<!--fallback-->` mark ahead of it. The failure is forgotten rather than kept:
a process serves every reader, and a load that failed once must not be missing
from every later page. The error output is not written, since the retry it
offers is a button nobody can press until the page hydrates, by which time the
browser has loaded the chunk for itself.

When that page hydrates, the component's range is the one thing the client
cannot claim at once. It is held instead — the nodes the reader is looking at
stay, with neither the fallback nor a second copy drawn over them — and
claimed when the chunk lands, so the rest of the page is live at once and the
component is live when it can be. A range the server marked as its fallback is
shown until the component is built, then replaced rather than claimed: a
fallback whose first node happened to share the component's tag would pass the
one comparison a claim makes, and the component's bindings would land on the
wrong nodes. A chunk that fails in the browser leaves what the server wrote in
place, inert, unless there is an error output to show instead — or unless what
the server wrote was its fallback, which says the component is on its way and
so goes, as a fallback drawn in the browser would.
