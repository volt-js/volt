<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/public/logo-dark.svg">
  <img src="docs/public/logo.svg" alt="Volt" width="72" height="72">
</picture>

# Volt

A TypeScript UI framework built from three ideas that fit together:

- **Components are classes**, declared with TC39 standard decorators
- **Templates are HTML** where everything dynamic starts with `:`
- **Reactivity is the [TC39 Signals proposal](https://github.com/tc39/proposal-signals)** — with no virtual DOM anywhere

```ts
// counter.ts
import { Component, Signal } from '@voltdev/core';

@Component({
  selector: 'v-counter',
  templateUrl: './counter.html',
  styleUrl: './counter.scss',
})
export class Counter {
  count = new Signal.State(0);

  increment() { this.count.set(this.count.get() + 1); }
  decrement() { this.count.set(this.count.get() - 1); }
}
```

```html
<!-- counter.html -->
<div>
  <button :click="decrement()">−</button>
  <output>{ count.get() }</output>
  <button :click="increment()">+</button>

  <p :if="count.get() > 9">That's a lot.</p>
</div>
```

```ts
import { mount } from '@voltdev/core';
mount(Counter, '#app');
```

## What makes it different

**A component class is constructed once.** Its methods are never re-run to
produce a view. The template compiles to code that clones static markup and
wires one effect per dynamic binding, so an update touches exactly the nodes
whose inputs changed. There is no re-render, no diff, and no virtual DOM.

**The reactive core is the standard, not a lookalike.** `Signal.State`,
`Signal.Computed`, and `Signal.subtle.Watcher` are implemented to the TC39
proposal — lazy computeds, glitch-free diamonds, `watched`/`unwatched`
liveness callbacks and all. The proposal deliberately ships no `effect`,
because scheduling belongs to the framework; Volt supplies that layer and
nothing else.

**The compiler does the work the browser would otherwise repeat.** Static
subtrees are baked into cloned markup. Identical markup is deduplicated into
one shared template. Bindings whose expressions are provably constant are
folded into the markup and emit no effect at all. An element whose children
are all text compiles to a single text binding rather than one marker per
hole.

## One prefix, one meaning

Everything dynamic is `:`-prefixed. The name alone decides what it does,
resolved in a fixed order so a name always means one thing:

| Kind | Examples |
|---|---|
| Structure | `:if` `:else-if` `:else` `:for` `:key` `:text` `:html` `:model` `:ref` `:slot` |
| Events | `:click` `:input` `:submit.prevent` `:keydown.enter` `:on-customEvent` |
| Callbacks | `:onChanged="(n) => handle(n)"` — a component notifies its parent through a function input |
| Bindings | `:class` `:style` `:disabled` `:value` `:attr-foo` `:prop-foo` |

```html
<form :submit.prevent="save()">
  <input :model.trim="draft" :keydown.escape="draft.set('')" />

  <ul>
    <li :for="todo in visible.get()" :key="todo.id" :class="{ done: todo.done }">
      { todo.text }
    </li>
  </ul>
</form>
```

Escape hatches keep it unambiguous: `:on-*` forces an event (for component
outputs and custom events), `:prop-*` and `:attr-*` force the other direction.

## Packages

| Package | What it is |
|---|---|
| `@voltdev/reactivity` | The TC39 Signals implementation, plus effect scheduling and disposal scopes |
| `@voltdev/compiler` | Template source → fine-grained DOM code. Pure `string → string`, no DOM needed |
| `@voltdev/core` | The DOM runtime and the component layer |
| `@voltdev/vite-plugin` | Lowers standard decorators and compiles templates at build time |
| `@voltdev/editor` | A rich-text editor engine: document model, schema, steps, history and a DOM view, with no dependencies |
| `@voltdev/create-volt` | Scaffolds a project: `pnpm create @voltdev/volt@alpha my-app` |

## Getting started

```bash
pnpm add @voltdev/core@alpha
pnpm add -D @voltdev/vite-plugin@alpha
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { volt } from '@voltdev/vite-plugin';

export default defineConfig({ plugins: [volt()] });
```

The plugin is not optional convenience — it does two things nothing else
currently can:

1. **Lowers TC39 standard decorators.** They are stage 3, implemented by no
   engine, and Vite 8's oxc transformer emits them untouched.
2. **Compiles templates at build time**, so the compiler never reaches the
   browser.

Without a build step, import `@voltdev/core/jit` to compile templates in the
browser instead. Good for prototypes and playgrounds; it ships the compiler.

## Requirements

Volt targets current engines and carries no legacy baggage — no legacy
decorators, no `reflect-metadata`, no downlevelled output, no dependency
injection container. Node 22+, and a browser with `Symbol.metadata`
polyfilled (Volt installs it).

## Development

```bash
pnpm install
pnpm test          # the full suite: reactivity, compiler, runtime, plugin, primitives
pnpm typecheck
pnpm build
pnpm dev           # the example app
pnpm docs:dev      # the documentation site
```

## Documentation

Run `pnpm docs:dev`, or see [`docs/`](docs/).

## Sponsorship

Volt is built in the open and is free to use under the MIT licence. If it saves
you time, [sponsoring the work](https://github.com/sponsors/hnviradiya) pays
for the parts nobody volunteers for — accessibility conformance, browser
testing, and keeping the benchmark honest.

## License

MIT
