# The `volt` command

`@voltdev/cli` provides `volt check`, which type-checks the expressions inside
every component's template against the component's own class.

::: warning Not on npm yet
`@voltdev/cli` is not published. It runs from a checkout of the Volt repository,
where the example applications use it — and CI runs it on every push.
:::

```bash
volt check
```

```
src/counter.html:7:33  error  TS2551
  Property 'incremnt' does not exist on type 'Counter'. Did you mean 'increment'?

  7 │     <button class="btn" :click="incremnt()">+</button>
    │                                 ^

Checked 3 templates. 1 error.
```

## Why it is a command and not part of the build

A template is compiled by the [Vite plugin](./vite-plugin), and the plugin cannot
check a type. Vite transforms TypeScript with oxc, which strips types without
checking them, so by the time a module reaches the transform there is no type
information left to check against. Type-checking needs a type checker, which
means it runs beside `tsc`, as its own step — the same way `tsc --noEmit` is
already a separate step from `vite build`.

Without it, `{ user.nmae }` in a template compiles, bundles and ships, and reads
`undefined` in production. A misspelling in a `.ts` file has never been allowed
to do that, and a misspelling in a `.html` file is the same mistake.

## `volt check`

```
volt check [options]
```

| Option | Description |
|---|---|
| `-p`, `--project <path>` | The tsconfig to check. Defaults to `./tsconfig.json` |
| `-h`, `--help` | Show the usage |
| `-v`, `--version` | Print the version |

It finds every component with a template in the project, restates each
template's expressions as TypeScript appended to the component's own module —
which is what makes the context typed without inventing an import: the class is
already in scope, whatever it is called and however the project resolves modules
— and runs that through the real type checker. Nothing on disk is touched: the
checker reads through a filesystem overlay, and each module is rewritten in
memory only.

Every finding is reported **at the template**, not at the generated code: the
`.html` file, line and column, the template line itself, and a caret under the
column. A location on its own is a claim; the line under the caret is the claim
being shown. The report is plain text with no colour, because the same output is
read in a terminal and in a CI log, and the log is where it matters most.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Every template checked, no errors |
| `1` | Findings — or a usage error |
| `2` | The check produced no answer: the project would not load, or the checker would not start |

`2` is separate from `1` on purpose. A project that fails to load has not been
checked, and reporting that as "no errors" — or as the same failure as a typo —
would make the two indistinguishable in CI.

## Sparing an expression

Some expressions are legitimately beyond a type — a value from an untyped
library, a template that reaches into something dynamic by design. A comment
spares the element after it, and everything inside that element:

```html
<!-- volt-ignore -->
<div :class="legacyWidget.classFor(row)">{ legacyWidget.render(row) }</div>
```

The expressions are still restated, because the names they bind — a `:for` item
above all — are what the rest of the template is typed against. Only their
findings are dropped.

Every run says how many findings were spared:

```
Checked 12 templates. No errors. 2 findings ignored.
```

A suppression nobody is reminded of is one that outlives the reason it was
written for. Without an escape hatch at all, the checker would be something a
project turns off whole, which is worse.

## In CI

```yaml
- name: Check templates
  run: pnpm exec volt check
```

It needs the packages the project imports to have their type declarations
available, so run it after `pnpm build` in a monorepo, where a package's
declarations only exist once it is built.

## From code

```ts
import { checkTemplates, formatReport } from '@voltdev/cli';

const result = await checkTemplates({ project: 'tsconfig.json', cwd: process.cwd() });
console.log(formatReport(result, process.cwd()));
```

`checkTemplates` resolves with the findings, how many templates it read, and how
many findings were ignored. `formatReport` and `formatDiagnostic` produce the text
`volt check` prints. The command is a function of its arguments and an I/O object,
so it is tested by calling it rather than by spawning a process.

## What it does not do

- **It checks expressions, not structure.** An element the template does not
  allow, or a directive in the wrong place, is the compiler's to refuse, and it
  does — at build time, with its own error.
- **It does not watch.** Run it again. [Editor support](./volar) restates the
  same expressions for checking as you type, but no editor integration ships
  yet, so today this command is the check.
- **One command.** `check` is all there is today.
