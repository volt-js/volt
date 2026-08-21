# Component API

## `@Component(config)`

```ts
interface ComponentConfig {
  selector: string;
  templateUrl?: string;
  render?: (ctx: unknown) => unknown;
  styleUrl?: string;
  styleUrls?: string[];
  styles?: string | string[];
  imports?: ComponentType[];
}
```

| Option | Description |
|---|---|
| `selector` | Tag this component answers to. Required |
| `templateUrl` | Path to an `.html` file, relative to this file |
| `render` | Pre-compiled render function; the Vite plugin fills this in |
| `styleUrl` / `styleUrls` | Path(s) to `.scss` files, relative to this file |
| `styles` | Compiled CSS, filled in by the plugin from `styleUrl` |
| `imports` | Components this template may reference |

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
[volt] <v-counter> has no prop "max-count". Did you mean "maxCount"?
Declared props: maxCount, onChanged.
```

There is one spelling: the declared one. Cannot be applied to static
or symbol-named members.

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
