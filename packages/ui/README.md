# @voltdev/ui

Components and the stylesheet that draws them, over
[`@voltdev/primitives`](https://voltjs.dev/reference/primitives). The
components are tags — `<v-button>`, `<v-dialog>`, `<v-select>`, `<v-table>` and
the rest — each one a primitive with its markup already written and the
primitive still reachable through `:ref`. The sheet is one stylesheet, the
class names it selects on and the design tokens every rule is written in, and
it works on markup of your own as well as on the components.

```bash
pnpm add @voltdev/ui@alpha
pnpm add -D @voltdev/vite-plugin@alpha vite
```

> **Not on npm yet.** The commands above are what install it once it is released.
> Until then it works from a checkout of the [Volt repository](https://github.com/volt-js/volt) —
> see [what is on npm](https://voltjs.dev/guide/getting-started#what-is-on-npm).

```ts
// page.ts
import { Component } from '@voltdev/core';
import { VButton } from '@voltdev/ui/components';

@Component({ selector: 'a-page', templateUrl: './page.html', imports: [VButton] })
export class Page {
  save = (): void => {};
}
```

```html
<!-- page.html -->
<v-button variant="primary" :onPress="save">Save</v-button>
```

```ts
// scripts/volt-css.ts — run once, and import the file it writes
import { stylesheet } from '@voltdev/ui';

console.log(stylesheet());
```

```bash
node scripts/volt-css.ts > src/volt.css
```

The two entries run in different places, and the package ships them
differently on purpose. `@voltdev/ui/components` is **TypeScript source**: a
compiled template is compiled for one target and one build, so your build
compiles these with the rest of your application. The manifest says so with
`"volt": { "source": true }`, and `@voltdev/vite-plugin` compiles any
dependency that does — which is why the plugin is required to use the
components, and why it is an optional peer dependency here. `@voltdev/ui` itself
is built JavaScript, because `stylesheet()` is called from a build script in
Node, where nothing is compiling templates.

`@voltdev/core` and `@voltdev/primitives` are peer dependencies: a component
runs on the application's own copies.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev/reference/ui](https://voltjs.dev/reference/ui)
