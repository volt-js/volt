---
layout: home

hero:
  name: Volt
  text: Classes, templates, signals.
  tagline: A TypeScript UI framework with Angular-shaped components, Vue-shaped templates, and TC39 signals — and no virtual DOM anywhere.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why Volt
      link: /guide/introduction

features:
  - title: Components are classes
    details: Declared with TC39 standard decorators. A component is constructed once and never re-run to produce a view.
  - title: One prefix, one meaning
    details: Everything dynamic starts with ':' — :if, :for, :click, :class. The name alone decides what it does.
  - title: Standard signals
    details: Signal.State and Signal.Computed implemented to the TC39 proposal. Lazy, glitch-free, and standards-tracking.
  - title: The compiler does the work
    details: Static markup is cloned, constant bindings are folded away, and identical templates are shared. What is left is one effect per binding that can actually change.
  - title: Server rendering is a choice
    details: Off until you ask for it. Render to a string or a stream, attach to it with hydrate, and let the compiler say which components have nothing to attach — no island annotation to write.
    link: /reference/server
    linkText: Server rendering
  - title: Behaviour, not markup
    details: Headless primitives held to the WAI-ARIA Authoring Practices — keyboard models, focus, roles and announcements — with a styled layer, a data grid and a rich-text editor built on them.
    link: /reference/primitives
    linkText: Primitives
---

## In one file

```ts
import { Component, Signal } from '@voltdev/core';

@Component({
  selector: 'v-counter',
  templateUrl: './counter.html',
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

Pressing `+` updates one text node. Not the component, not a subtree — the
text node whose value changed.

## What else is here

The core is components, templates and signals. Around it, each in a package of
its own so an application carries only what it imports:

- [**Router**](/reference/router) — a declared route table whose links are real
  anchors, with typed parameters and a rendering mode per route.
- [**Query cache**](/reference/query) — one entry per question, so two components
  asking it make one request.
- [**Server functions**](/reference/server-functions) — a method marked
  `@Server()` runs on the server and is called from the browser as if it were
  local.
- [**Server rendering**](/reference/server) — to a string, or streamed with the
  slowest query filled in last, and hydrated by claiming the server's nodes.
- [**Primitives**](/reference/primitives), [**styled components**](/reference/ui),
  a [**data grid**](/reference/grid) and a [**rich-text editor**](/reference/editor).
- [**Testing**](/reference/testing) helpers that find parts by role and name, a
  [**template type-checker**](/reference/cli), [**editor support**](/reference/volar),
  and [**create-volt**](/reference/create-volt) to start a project with any of it.

Volt is pre-alpha, and two things follow from that. Several of these are partly
built, and each page says which parts — a reader who finds out from an exception
is worse off than one who read it first. And only the core is on npm: `core`,
`reactivity`, `compiler` and the Vite plugin. The rest are in the repository and
not yet released, and each of their pages says so at the top. This site
documents the repository, which is ahead of the published alpha.
