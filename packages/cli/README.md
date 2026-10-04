# @voltdev/cli

The `volt` command. `volt check` type-checks the expressions inside every
component's template against the component's own class, with the real
TypeScript checker, and reports each finding at the template: the `.html` file,
line and column, the line itself and a caret under the column. The
[Vite plugin](https://www.npmjs.com/package/@voltdev/vite-plugin) compiles
templates but cannot check a type — Vite strips types without checking them —
so without this, `{ user.nmae }` compiles, bundles and reads `undefined` in
production. It runs beside `tsc`, as its own step.

```bash
pnpm add -D @voltdev/cli@alpha typescript
```

> **Not on npm yet.** The command above is what installs it once it is released.
> Until then it works from a checkout of the [Volt repository](https://github.com/volt-js/volt) —
> see [what is on npm](https://voltjs.dev/guide/getting-started#what-is-on-npm).

It needs TypeScript 7, whose checker it drives, as a peer dependency.

```bash
pnpm exec volt check
```

```
src/counter.html:7:33  error  TS2551
  Property 'incremnt' does not exist on type 'Counter'. Did you mean 'increment'?

  7 │     <button class="btn" :click="incremnt()">+</button>
    │                                 ^

Checked 3 templates. 1 error.
```

| Option | |
| --- | --- |
| `-p, --project <path>` | The tsconfig to check. Defaults to `./tsconfig.json` |
| `-h, --help` | Show the usage |
| `-v, --version` | Print the version |

It exits `0` when every template checked clean, `1` on findings or a usage
error, and `2` when the check produced no answer — the project would not load,
or the checker would not start — so CI can tell an unchecked project from a
typo.

The same check is a function, for a build script:

```ts
import { checkTemplates, formatReport } from '@voltdev/cli';

const result = await checkTemplates({ project: 'tsconfig.json', cwd: process.cwd() });
console.log(formatReport(result, process.cwd()));
```

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev/reference/cli](https://voltjs.dev/reference/cli)
