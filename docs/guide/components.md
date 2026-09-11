# Components

A component is a class. It is constructed once per mounted instance and never
re-run to produce a view.

```ts
// greeting.ts
import { Component, Signal } from '@voltdev/core';

@Component({
  selector: 'v-greeting',
  templateUrl: './greeting.html',
})
export class Greeting {
  name = new Signal.State('world');
}
```

```html
<!-- greeting.html -->
<p>Hello, { name.get() }.</p>
```

## Configuration

| Option | Meaning |
|---|---|
| `selector` | The tag this component answers to. Required. |
| `templateUrl` | Path to an `.html` file, relative to this file |
| `render` | A pre-compiled render function (the Vite plugin fills this in) |
| `styleUrl` / `styleUrls` | Path(s) to `.scss` files, relative to this file |
| `styles` | Compiled CSS, filled in by the plugin from `styleUrl` |
| `imports` | Components this template may reference |

Templates always live in a `.html` file. There is no inline form: a real file
gets syntax highlighting, formatting, Emmet and folding, and one way to write
a component beats two.

`templateUrl`, `styleUrl` and `styleUrls` are resolved relative to the
declaring file, compiled at build time, and registered with the watcher, so
editing markup or CSS hot-reloads without touching the TypeScript.

Where there is no build step — a test, a playground — supply `render`
directly:

```ts
import { compileTemplate } from '@voltdev/core/jit';

@Component({
  selector: 'v-greeting',
  render: compileTemplate(`<p>Hello, { name.get() }.</p>`),
})
export class Greeting {
  name = new Signal.State('world');
}
```

That entry pulls the compiler in, which is exactly why it is a separate
import rather than a config option.

## Props

`@Prop()` declares a property the parent can bind to. Which form you choose
decides whether the child reacts to changes:

```ts
export class Counter {
  // Reactive: a parent write flows in through .set()
  @Prop() step = new Signal.State(1);

  // Not reactive: plain assignment, fine for values that never change
  @Prop() id = '';
}
```

```html
<v-counter :step="stepSize.get()" :label="'Total'"></v-counter>
```

When the parent's binding is an expression, Volt keeps it live — the child
sees each new value without either component re-rendering.

Rename or require an input:

```ts
@Prop({ alias: 'for', required: true }) target = new Signal.State('');
```

A missing required input throws at construction.

## Notifying the parent

Volt has no separate event channel for components. A parent passes a function
in as an ordinary input, and the child calls it:

```ts
export class Counter {
  @Prop() onChanged?: (value: number) => void;

  increment() {
    this.count.set(this.count.get() + 1);
    this.onChanged?.(this.count.get());
  }
}
```

```html
<v-counter :onChanged="record"></v-counter>
```

A prop named `onSomething` given a bare method reference is invoked on the
component that declared it, so `this` is the parent — passing `record`
directly does the right thing. Write an arrow when you want to reshape the
arguments:

```html
<v-counter :onChanged="(n) => record(n * 2)"></v-counter>
```

That is the whole mechanism — no emitter to construct, no subscription to
register, nothing to unsubscribe. The callback is typed like any other
property, so a wrong argument type is a compile error rather than a runtime
surprise.

Svelte 5 deprecated its own event dispatcher in favour of exactly this, and
React never had one.

::: tip `:on-*` is for the DOM
`:on-*` attaches a real event listener, which is meaningful for elements and
web components but not for Volt components. Using it on a component is an
error that names the callback prop you meant.
:::

## Setup, teardown, and the DOM

Volt has one lifecycle hook. Most of what a hook is usually for belongs in a
field initializer instead.

**Derived state** is a computed. It is lazy, so it reads props at render time:

```ts
export class Counter {
  @Prop() step = new Signal.State(1);
  label = new Signal.Computed(() => `Steps of ${this.step.get()}`);
}
```

**Work with side effects** is an effect. Its first run is deferred, so props
have landed by the time it fires:

```ts
export class UserCard {
  @Prop() userId = new Signal.State('');
  user = new Signal.State<User | null>(null);

  #load = effect(() => {
    fetchUser(this.userId.get()).then((u) => this.user.set(u));
  });
}
```

That effect also re-runs whenever `userId` changes, which a one-shot
initialisation hook could not do.

**Teardown** is `onCleanup`, beside the setup it undoes — no instance field to
park a handle on:

```ts
export class Clock {
  #tick = effect(() => {
    const id = setInterval(() => this.now.set(Date.now()), 1000);
    onCleanup(() => clearInterval(id));
  });
}
```

### `onMount`

The one hook, for the one thing none of the above can do: touch DOM that is
in the document.

```ts
export class Search implements OnMount {
  input: HTMLInputElement | null = null;

  onMount() {
    this.input?.focus();   // focus and measurement need a document-attached node
  }
}
```

Use it for focus, `getBoundingClientRect`, or handing an element to a library
that expects a live node. `:ref` fires during render, before insertion, so it
cannot substitute.

## Composition

A template may reference components listed in its `imports`:

```ts
@Component({
  selector: 'v-app',
  imports: [Counter, Todos],
  templateUrl: './app.html',
})
export class App {}
```

`imports` is the **only** way a template can reference another component.
There is no global registry, so a tag either appears in the using component's
`imports` or it does not resolve — which keeps the dependency visible in the
source and lets a bundler see it.

A hyphenated tag that matches nothing in `imports` is treated as a real custom
element **if it has been defined** with `customElements.define`. Otherwise it
is an error naming the tag and the component that used it — Volt selectors are
hyphenated too, so a forgotten import must not be mistaken for a web
component and silently render nothing.

### Recursion

A component always resolves its own selector, so a tree, menu, or comment
thread can render itself with no import:

```html
<!-- tree-node.html -->
<li>
  <span>{ node.label }</span>
  <ul>
    <v-tree-node :for="child in node.children" :key="child.id" :node="child"></v-tree-node>
  </ul>
</li>
```

It could not be expressed through `imports` in any case: the class binding
does not exist yet when its own decorator runs.

For **mutual** recursion, where two components reference each other, give
`imports` a function so the reference is read later:

```ts
@Component({
  selector: 'v-branch',
  templateUrl: './branch.html',
  imports: () => [Leaf],
})
export class Branch {}
```

## Sharing state

Volt has **no dependency injection**. Share state the way plain TypeScript
does — with a module:

```ts
// store.ts
import { Signal } from '@voltdev/core';

export const user = new Signal.State<User | null>(null);
export const isSignedIn = new Signal.Computed(() => user.get() !== null);
```

```ts
import { user } from './store.js';

@Component({ selector: 'v-header', templateUrl: './header.html' })
export class Header {
  user = user;
}
```

When state should be scoped to a subtree rather than global, use context:

```ts
import { createContext, provideContext, useContext } from '@voltdev/core';

const Theme = createContext<'light' | 'dark'>('light');

export class Shell {
  // Provided during construction, so descendants see it as they are built.
  #theme = provideContext(Theme, 'dark');
}

export class Button {
  theme = useContext(Theme); // resolved from the nearest provider
}
```

This is scope lookup, not injection: there is no container, no token
registry, and no lifetime management.

## Testing

A component is a class, so unit tests need no framework:

```ts
const counter = new Counter();
counter.increment();
expect(counter.count.get()).toBe(1);
```

For DOM behaviour, mount and flush:

```ts
import { flushSync, mount } from '@voltdev/core';

const app = mount(Counter, host);
host.querySelector('button')!.click();
flushSync();
expect(host.textContent).toContain('1');
app.unmount();
```
