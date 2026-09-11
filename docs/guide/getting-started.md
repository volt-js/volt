# Getting started

## Requirements

Volt targets current engines and carries no legacy support. You need **Node
22+** and **pnpm 10+**.

## Install

::: warning Under active development
Volt is pre-alpha. Nothing here is stable: APIs may change shape between
versions without a deprecation path, and there is no support commitment.
Pin an exact version if you build anything on it.
:::

```bash
pnpm add @voltdev/core@alpha
pnpm add -D @voltdev/vite-plugin@alpha vite
```

### What is on npm

The published alpha is the core. This site documents the repository, which is
ahead of it, so a page describing something newer than the alpha — or a package
that has not been released — says so at the top.

| Package | On npm |
|---|---|
| `@voltdev/core`, `@voltdev/reactivity`, `@voltdev/compiler`, `@voltdev/vite-plugin` | Yes, as `alpha` |
| [`router`](../reference/router), [`query`](../reference/query), [`server`](../reference/server-functions) | Not yet |
| [`primitives`](../reference/primitives), [`ui`](../reference/ui), [`grid`](../reference/grid), [`editor`](../reference/editor) | Not yet |
| [`testing`](../reference/testing), [`cli`](../reference/cli), [`create-volt`](../reference/create-volt), [`volar`](../reference/volar) | Not yet |

Everything in the second half works from a checkout of the Volt repository,
where the packages resolve from the workspace. A package reaches npm when its
shape is meant to be permanent — a version published at `0.1.0` cannot be taken
back, so nothing is released before that.

## Configure Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { volt } from '@voltdev/vite-plugin';

export default defineConfig({
  plugins: [volt()],
  build: { target: 'esnext' },
});
```

The plugin is **required**, not a convenience. It does two things nothing
else in the toolchain currently does:

1. **Lowers TC39 standard decorators.** They are stage 3 and implemented by
   no JavaScript engine. Vite 8 transforms with oxc, which parses decorators
   but emits them untouched, so `@Component` would reach the browser as a
   syntax error.
2. **Compiles templates at build time**, so the compiler never ships to the
   browser and no template is parsed at runtime.

::: tip No build step?
Import `@voltdev/core/jit` once at startup to compile templates in the browser
instead. Convenient for prototypes and playgrounds — but it ships the
compiler, so prefer the plugin for anything real.
:::

## TypeScript configuration

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable", "ESNext.Decorators"],
    "strict": true,
    "useDefineForClassFields": true,
    "experimentalDecorators": false
  }
}
```

`experimentalDecorators` must be **off**. Volt uses standard decorators; the
legacy transform is a different feature with different semantics and is not
supported.

## Your first component

```ts
// src/counter.ts
import { Component, Signal } from '@voltdev/core';

@Component({
  selector: 'v-counter',
  templateUrl: './counter.html',
  styleUrl: './counter.scss',
})
export class Counter {
  count = new Signal.State(0);

  increment() {
    this.count.set(this.count.get() + 1);
  }

  decrement() {
    this.count.set(this.count.get() - 1);
  }
}
```

```html
<!-- src/counter.html -->
<div class="counter">
  <button :click="decrement()">−</button>
  <output>{ count.get() }</output>
  <button :click="increment()">+</button>
</div>
```

```scss
// src/counter.scss
.counter {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
```

Stylesheets are **Sass**. `styleUrl` takes a `.scss` file and nothing else —
a plain `.css` file is rejected with a message saying so. Both paths resolve
relative to the `.ts` file, are compiled at build time, and are watched, so
editing the markup or the styles hot-reloads on its own. Partials pulled in
with `@use` are watched too.

## Mount it

```ts
// src/main.ts
import { mount } from '@voltdev/core';
import { Counter } from './counter.js';

mount(Counter, '#app');
```

```html
<!-- index.html -->
<div id="app"></div>
<script type="module" src="/src/main.ts"></script>
```

`mount` returns a handle:

```ts
const app = mount(Counter, '#app');

app.instance;   // the component instance
app.unmount();  // disposes every effect it created, then clears the host
```

## Using one component from another

A template may only reference components listed in its `imports`. There is no
global registry — this keeps resolution explicit and lets bundlers see the
dependency.

```ts
@Component({
  selector: 'v-app',
  imports: [Counter],
  templateUrl: './app.html',
})
export class App {}
```

## Starting from a template

`create-volt` generates a project with the toolchain, a component and a passing
test. It is not on npm yet; from a checkout of the repository:

```bash
node packages/create-volt/bin/create-volt.js my-app --template minimal
```

`minimal` is the one template it can generate today. `router-query` and `start` —
the second wiring server rendering, per-route modes and server functions through
[start mode](../reference/start) — need packages that are not published yet, and a
generated project installs from npm, so it refuses them rather than producing a
project that cannot install. See [create-volt](../reference/create-volt).

## Next

- [Components](./components) — props, callbacks, lifecycle
- [Reactivity](./reactivity) — signals, computeds, effects
- [Templates](./templates) — the `:` syntax in full
