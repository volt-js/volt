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

### What a condition narrows

```html
<b :if="entry.kind === 'page'">{ entry.number }</b>
<i :else-if="entry.kind === 'link'">{ entry.href }</i>
<s :else>{ entry.label }</s>
```

An `:if` chain is checked as the control flow it is. Under
`:if="entry.kind === 'page'"`, `entry` is a page, so `{ entry.number }` is read
against the type a page has, and each arm after it reads what the arms before
it left: the `:else` here sees only an entry that is neither a page nor a link.
That is what keeps a union — a row of several kinds, an optional field tested
before it is read — from being reported in every arm as the whole union.

What TypeScript does not narrow, neither does the check. A condition that calls
something narrows nothing, because a call is not assumed to return the same
thing twice: under `:if="selected.get()"`, `{ selected.get().label }` is still
possibly null. Test a name instead — a `:for` row, a field, something a slot
passed — or read through it with `?.`.

### What a scoped slot hands its content

```html
<v-rows>
  <template :slot-row="{ row, total }">{ row.name } of { total.get() }</template>
</v-rows>
```

`row` and `total` are typed by what `<v-rows>` passes: the expressions on its
own outlet, `<slot name="row" :row="person" :total="total">`, read against its
class, inside whatever `:for` the outlet sits in and under whatever `:if` it is
drawn in. So `{ row.nmae }` is reported against the type a row really is, and a
signal the slot hands over is still caught when it is rendered without
`.get()`. A component that draws an outlet only where `entry.kind === 'page'`
hands its content a page, not every kind of entry.

A literal arrives as the literal it is. An outlet written
`:state="task.done ? 'done' : 'todo'"`, or `tone="calm"`, hands its content
`'done' | 'todo'` and `'calm'` rather than any string, so a record keyed by
those states, or a parameter that takes only them, accepts the name. The other
side of the same coin: a comparison against a value the slot never passes, such
as `state === 'failed'`, is reported, as it would be against a declared union.

The check finds that outlet by following the tag: to the class your component
lists in `imports`, to the module that declares it, to the `selector` and
`templateUrl` there. A class from a package is followed through its
declaration map to the source beside it, so a package that ships its
`.d.ts.map` files, its source and its templates — `@voltdev/ui` does — has its
slots typed like your own components'.

Where that trail ends — a tag no `imports` lists, an `imports` that is not a
list of names, a package without its maps — the names are `any`. An `any`
reports nothing, a signal least of all: nothing about it says it is one, so a
value typed `any` rendered bare is never reported as a signal anywhere in a
template. Nor is a `never` — a row of a list declared as a bare `[]`, say —
which holds nothing at all.

A generic component's type parameters are `any` there too. In
`class List<T> { items: T[] }`, what `T` is depends on the `items` your tag
passes, and the check does not follow a tag's props. So a row its outlet
passes as a `T` is `any` to your content, while a count it passes as a
`number` is still checked as one.

The names are in scope where the content renders, which is not always the
whole tag they are written on. On an element filling a slot, the pattern is
the scope of everything else on it, a `:for` included:
`<li :for="tag in row.tags" :slot-row="{ row }">` loops over the row it was
handed. Several elements filling one slot share the pattern one of them names,
so `<i :slot-row>` beside `<b :slot-row="{ row }">` reads the same `row`. On a
component's own tag, `:slot-default` binds the default content and nothing
more: the tag's props and its `:for` are read where the tag is written, and a
child filling another slot by name is rendered without them.

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
