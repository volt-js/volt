# @voltdev/primitives

Component behaviour with nothing else attached: the state a dialog, a menu or a
date picker holds, the keyboard map it answers to, and the ARIA a screen reader
is told, each held to the WAI-ARIA Authoring Practices pattern for it. It
renders no markup and ships no styles. A primitive hands back attributes and
handlers, and you spread them onto elements you wrote yourself. Styled
components over a subset of these are `@voltdev/ui`.

```bash
pnpm add @voltdev/primitives@alpha
```

> **Not on npm yet.** The command above is what installs it once it is released.
> Until then it works from a checkout of the [Volt repository](https://github.com/volt-js/volt) —
> see [what is on npm](https://voltjs.dev/guide/getting-started#what-is-on-npm).

`@voltdev/core` is a peer dependency: a primitive runs on the application's
own copy, so its effects, contexts and ids are the same ones your components
use.

```ts
// confirm.ts
import { Component, Signal } from '@voltdev/core';
import { createDialog } from '@voltdev/primitives';

@Component({ selector: 'v-confirm', templateUrl: './confirm.html' })
export class Confirm {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  dialog = createDialog({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
  });
}
```

```html
<!-- confirm.html -->
<button :ref="trigger" :spread="dialog.triggerProps()" :click="dialog.open()">Delete</button>
<div :if="dialog.isPresent()" :portal :ref="content" :spread="dialog.contentProps()">
  <h2 :spread="dialog.titleProps()">Delete this file?</h2>
  <p :spread="dialog.descriptionProps()">This cannot be undone.</p>
  <button :click="dialog.close()">Cancel</button>
</div>
```

That is a modal dialog labelled by its heading and described by its paragraph,
with focus moved in, held, and returned on close, Escape and an outside press
handled, and the rest of the page made inert while it is open.

There is one entry point and no subpaths. The package is marked side-effect
free, so a bundler drops every primitive an application never imports.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev/reference/primitives](https://voltjs.dev/reference/primitives)
