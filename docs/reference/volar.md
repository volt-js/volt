# Editor support

`@voltdev/volar` is a [Volar](https://volarjs.dev) language plugin for Volt
templates. Given an `.html` file that some component's `templateUrl` points at,
it restates the template's expressions as TypeScript typed against that
component's class, and gives Volar a table saying which characters of the
restatement came from which characters of the template. Completion, hover,
go-to-definition, rename and live errors inside the template are then the
TypeScript service answering against the restatement, with every answer mapped
back.

::: warning Not on npm yet, and no editor uses it yet
`@voltdev/volar` is not published, and nothing ships that loads it into an
editor — see [what exists today](#what-exists-today). It runs from a checkout of
the Volt repository, and until an integration exists, [`volt check`](./cli) is
how a template's expressions get checked.
:::

A language plugin rather than a language server of its own, because the rest
already exists: Volar is the framework-agnostic half of the tooling Vue and
Astro use, and writing a Language Server Protocol implementation instead would
mean reimplementing completion, rename and the rest against a type system that
already answers those questions.

## What exists today

The plugin, the index it runs on, and the translation it serves. **Not an
editor integration.** There is no VS Code extension, no language server entry
and no tsserver plugin in this release, and the package depends on none of
Volar's integration packages — `@volar/typescript`, `@volar/language-server` —
only on `@volar/language-core`. The plugin is tested inside a real Volar
`Language`, and what an editor would then ask is tested by writing the
restatements to disk and putting completion, type, definition, reference and
diagnostic questions to TypeScript 7's own API at mapped positions. No test
runs it inside an editor or through a Volar integration.

So a Volt project cannot turn this on by installing something. What it takes is
a host — code inside whichever Volar integration an extension is built on — and
[the second half of this page](#wiring-it-into-a-host) is what that host does.
The first half is what a template gets once one exists, and what it does not.

## What a template gets

Everything below happens inside an expression — an interpolation, a binding,
an event handler, a `:for` or an `:if` — and nowhere else.

```ts
// counter.ts
import { Component, Signal } from '@voltdev/core';

@Component({ selector: 'v-counter', templateUrl: './counter.html' })
export class Counter {
  count = new Signal.State(0);
  step = 1;

  increment(): void {
    this.count.set(this.count.get() + this.step);
  }
}
```

```html
<!-- counter.html -->
<button :click="increment()">+{ step }</button>
<p>{ count.get() }</p>
```

| Feature | What it answers |
|---|---|
| Completion | The component's fields and methods; a `:for` item's own members inside its row; the members after a dot with nothing typed after it yet |
| Hover | The type of a name — `StateSignal<number>` for `count`, the item type inside a `:for`, `KeyboardEvent` for `$event` on `:keydown` |
| Go-to-definition | The member's declaration, in the real `.ts` file |
| Rename | Across the boundary both ways — the template's `step` and the class's are one symbol |
| Errors | TypeScript's own — a member the class does not have, an argument of the wrong type — underlined on the name or the expression that caused it |

Go-to-definition and rename work because the restatement reaches the class
through its module's exports rather than through a copy of it: the declaration
the checker resolves to is the one a person edits.

How far each row is shown matters, because no editor has run any of it. The
package's tests write the restatements to disk and ask TypeScript's API at
positions mapped from the template, against a stand-in declaration of
`Component` and `Signal` rather than the built `@voltdev/core`. Completion,
hover, definition and errors are asked for directly. Rename is shown only as
far as the template's name and the class's resolving to one declaration, with
the references in the restatement mapping back to the template's text — no
test performs one.

`$event` is typed by the event's name, from the DOM's own event map, so a
`:keydown` handler gets a `KeyboardEvent` and a name the map does not know — a
custom element's event through [`:on-*`](./template-syntax) — gets plain
`Event`.

`<!-- volt-ignore -->` spares the node after it, children included, exactly as
it does for [`volt check`](./cli): nothing inside is reported. The expressions
are still restated — the names a `:for` binds are what the rest of its row is
typed against — so completion and navigation keep working there.

Markup is left alone. Tags, attribute names and ordinary attributes belong to
whatever HTML support the editor already has, and the plugin maps the file onto
itself so an HTML service sees what it would have seen without it installed.

### What the editor does not report that `volt check` does

Both run the same restatement, `generateTypeCheckBlock` from
`@voltdev/compiler` — one analysis with two consumers, so each expression is
restated the same way in both. What differs is how `_ctx` reaches the class:
`volt check` appends the block to the component's own module, where the class
is in scope under any name, and the editor has to reach it through the
module's exports. They do not report the same things.

| `volt check` reports | The editor | Why |
|---|---|---|
| `volt/signal-read` — `{ count }` where `{ count.get() }` was meant | Says nothing | The rule is carried by a marker argument no mapping covers. Translating its message needs a Volar service plugin, which does not exist, so the diagnostic is dropped rather than shown as TypeScript's own complaint — that `0` is not assignable to `never` — which describes the trick and not the mistake |
| `volt/expression-syntax` — an expression that does not parse | Says nothing | The expression is left out of the restatement, so it has no completion, no hover and no error; the rest of the template carries on. A `:for` whose expression does not parse takes its whole row with it: the loop is never written, so nothing inside it is restated either |
| `volt/template-syntax` — a template that does not parse | Says nothing | See [a template that does not parse](#a-template-that-does-not-parse) |
| `volt/missing-template` — a `templateUrl` naming no file | Says nothing | The mistake is in the `.ts` file, which the plugin never touches, and there is no template to put it on |
| Every error in a template whose class nothing exports, or whose export is misread | Says nothing | The restatement cannot name the class, so `_ctx` is `any` — see [a class nothing exports](#a-class-nothing-exports) |
| Errors against the second of two classes sharing one template | Says nothing | `volt check` checks the template once per class that points at it; the editor types it against one — see [two owners](#two-owners-of-one-template) |

The first is the one to know about. A signal written without `.get()` renders
the signal object rather than its value and never updates, and in an `:if` it
is always true. Today only `volt check` catches it — run it in CI whether or
not an editor is set up.

## Wiring it into a host

A host builds an index of which class owns which template, creates the plugin
over it, and hands the plugin to its Volar integration.

```ts
import { createTemplateIndex, createVoltLanguagePlugin } from '@voltdev/volar';

const index = createTemplateIndex();
await index.scan('/work/my-app/src');

const plugin = createVoltLanguagePlugin<string>({
  index,
  toFileName: (scriptId) => scriptId,
  fromFileName: (fileName) => fileName,
});
```

The package is built for Node — ESM only, Node 22 or later — and reads the
disk and resolves paths with `node:fs` and `node:path`. The build keeps every
dependency external, `@volar/language-core` (`^2.4.28`) included, so the
plugin imports the copy installed beside it rather than carrying one of its
own: the point is that the integration loading it and the plugin can share one
copy of Volar. Nothing enforces that. It is a `dependency`, not a
`peerDependency`, so whether the host ends up with one copy or two is the
package manager's decision, and a host should check that its lockfile resolves
one.

`T` is whatever the integration identifies a script by — a plain path in
tsserver, a URI in a language server — and the two functions translate between
that and a path on disk, because the index speaks paths:

```ts
import { createTemplateIndex, createVoltLanguagePlugin } from '@voltdev/volar';

const index = createTemplateIndex();
await index.scan('/work/my-app/src');

// URI from vscode-uri, as a Volar language server uses it.
const plugin = createVoltLanguagePlugin<URI>({
  index,
  toFileName: (uri) => uri.fsPath,
  fromFileName: (file) => URI.file(file),
});
```

Whatever `toFileName` returns is what the index is asked about, so it has to
spell a path the way the index stored it. See
[the case of a path](#the-case-of-a-path) for where that goes wrong.

### Keeping it current

A template's meaning lives in another file: editing `counter.ts` changes what
`counter.html` means without touching a byte of it. Two mechanisms cover that,
and a host is responsible for the second.

**The component's module is an associated script.** Building a template's
virtual code asks Volar for the component's module, which registers it as a
dependency: when that module's text changes, Volar marks the template out of
date and rebuilds it the next time anything asks about it. The module is read
from whatever text the host has given Volar for it — the editor's buffer,
not the disk — and the index is brought up to that text on the way, so an
unsaved rename in the class reaches the template at once.

The host has one obligation here. Volar registers a script only once some
plugin names its language, and this plugin's `getLanguageId` answers nothing
for a `.ts` file. So the host's synchronisation has to register the component
module with a language id of its own — the tests pass `'typescript'`. If it
does not, Volar logs `languageId not found`, no dependency is recorded, and an
edit to the class never reaches the template.

**Everything the index has not read is the host's to report.** A new
component, or one whose `templateUrl` has moved to a file that until now
belonged to nobody, is invisible to the first mechanism — no template depends
on it yet.
Call `moduleChanged` whenever a `.ts` file changes on disk or in a buffer, with
`null` for a deletion:

```ts
import { createTemplateIndex, createVoltLanguagePlugin } from '@voltdev/volar';

const index = createTemplateIndex();
await index.scan('/work/my-app/src');

const plugin = createVoltLanguagePlugin<string>({
  index,
  toFileName: (id) => id,
  fromFileName: (file) => file,
});

// Wired to whatever tells the host a module changed: a watcher, a save, an edit.
// `language` is the Volar Language the integration created over the plugin.
function onModuleChange(file: string, text: string | null): void {
  plugin.moduleChanged(language, file, text);
}
```

It updates the index, then deletes every template whose owner changed from the
language's script registry — the source script, not only what the plugin
generated for it — and returns those templates. The next question about any of
them goes through the host's synchronisation, which registers it again and
builds it afresh; a host whose synchronisation does not register a script it
is asked for loses the template instead. Without `moduleChanged`, a component
that starts pointing at a template is not noticed until something else makes
the editor rebuild that file.

**Deletions are not found by scanning again.** `scan` updates only the modules
it reads, and it skips a file that does not contain the word `templateUrl`
before updating anything. So a module deleted since the last scan, or one that
no longer mentions `templateUrl` at all, keeps its templates claimed until
`update` hears about it — through `moduleChanged`, or through the plugin
reading the module's text when it next rebuilds the template. That second path
catches an edit but not a deletion: a deleted module has no text to read, so
its template goes on being claimed by a class that is gone, and goes quiet. A
stale entry is worse than a missing one, which is why the host has to report
changes rather than rescan for them.

## `createTemplateIndex`

```ts
createTemplateIndex(options?: TemplateIndexOptions): TemplateIndex
```

`templateUrl`, read backwards. A Vue single-file component carries its template
and its class in one file, so a language server always knows which class a
template belongs to. Volt separated them, and this is where that is paid for:
nothing in `counter.html` says which class it belongs to, and the arrow exists
only in a module the template has never heard of. Something has to read every
module and remember.

| Member | Description |
|---|---|
| `scan(dir)` | Read every `.ts` and `.mts` module under `dir` and index what it claims. Resolves to the modules whose claims changed — every claiming module on a first scan, and on a repeat only those that changed since. A `dir` that does not exist or cannot be read resolves to an empty list, not an error |
| `update(module, code)` | Replace what `module` claims with what `code` says it claims, or drop it when `code` is `null`. Returns the templates whose owner changed |
| `lookup(template)` | The `ComponentBinding` that owns `template`, or `undefined` |
| `owns(template)` | Whether anything claims `template` |
| `templates()` | Every template currently claimed, as absolute paths, in no particular order |

| Option | Type | Default |
|---|---|---|
| `caseSensitive` | `boolean` — whether two paths differing only in case are two files | `false` on Windows, `true` everywhere else |
| `ignore` | `Iterable<string>` — directory names `scan` never descends into | `node_modules`, `dist`, `build`, `coverage`, `.git`, `.tsc`, `.cache` |

**Nothing in it watches a filesystem.** It is only as current as what it has
been told. `update` returns an empty array and touches nothing for a module
that says what it said before — the same binding object stays in place — which
is what makes it safe to call on every keystroke. It still scans the text it
is handed each time to find that out; what it saves is everything downstream.

Every path it is handed — `dir`, `module`, `template` — is resolved against
the process's working directory, so a relative one means whatever that
happens to be. Hosts should pass absolute paths.

What it reads is the text, not a parse: the `@Component` decorator, its
`templateUrl` as a quoted string literal, and the class after it. A
`templateUrl` built any other way — a template literal, a constant, a
concatenation — is not seen. A component rendered with `compileTemplate()`
from `@voltdev/core/jit` has no template file and nothing to claim, so a
template written as a string gets no editor support at all.

`caseSensitive` is an option because the host, not the index, is the one that
knows: a case-insensitive volume mounted on Linux is still case-insensitive.
The default is decided by platform alone, so on macOS — whose default volume is
not case-sensitive — it is `true`, and a host there should pass what the file
system actually does.

`ignore` replaces the default list rather than adding to it. Anything whose
name starts with `.` is skipped whatever the list says, and a symbolic link to
a directory is not followed, so components reached only through one are not
indexed. `scan` reads every module it finds in full; files that never contain
the word `templateUrl` are skipped after that read.

### Two owners of one template

A template two classes point at is legal — a base class and a variant of it —
and the index keeps both. `lookup` answers with the one whose module path sorts
first, so the answer does not depend on the order the files were read in, and
the template is typed against that class alone. `volt check` checks the
template once for each class that points at it, so an error only the second
class would raise is one the check reports and the editor does not. When the
first withdraws, the second takes over.

### The case of a path

On a case-insensitive index, looking a path up ignores case, but withdrawing a
module's old claims does not: they are matched against the path exactly as it
was first stored. So a module indexed under one spelling and later reported
under another — a scan that found `C:\app\counter.ts` and an editor URI that
says `c:\app\counter.ts` — does not lose its old claims when it moves its
`templateUrl` or is deleted. The template it used to point at stays claimed by
a stale entry. Until that is fixed, a host has to report every module under
the same spelling the scan used, which on Windows means normalising the drive
letter.

### `ComponentBinding`

| Field | Description |
|---|---|
| `template` | Absolute path of the template |
| `module` | Absolute path of the module the class is declared in |
| `className` | The class as named inside its own module |
| `exportedAs` | The name the class is exported under — `'default'` for a default export — or `null` |
| `templateUrl` | The `templateUrl` exactly as written |

A template's path is resolved against the directory of the module that names
it, not against the working directory — the same rule `volt check` and the
build follow.

## `createVoltLanguagePlugin`

```ts
createVoltLanguagePlugin<T>(options: VoltLanguagePluginOptions<T>): VoltLanguagePlugin<T> & {
  typescript: TypeScriptIntegration<VoltVirtualCode>;
}
```

| Option | Description |
|---|---|
| `index` | The `TemplateIndex`. Which files are claimed and what they are typed against both come out of it |
| `toFileName(scriptId)` | A script id as a path on disk |
| `fromFileName(fileName)` | The same in reverse, for naming the module a template depends on |

The result is a `VoltLanguagePlugin<T>` — a Volar
`LanguagePlugin<T, VoltVirtualCode>` with `moduleChanged` added — and a
`typescript` member beside it:

| Member | Description |
|---|---|
| `getLanguageId(scriptId)` | `'html'` for a file ending `.html` that the index says is claimed; `undefined` for everything else, every `.ts` file included |
| `createVirtualCode(...)` | Builds a `VoltVirtualCode` for a script handed over as `'html'`, when its file ends `.html` and the index claims it; nothing otherwise. Reads the component's module on the way — see [keeping it current](#keeping-it-current) |
| `updateVirtualCode(...)` | Rebuilds it whole, from a fresh parse — or returns nothing once the file has stopped being a template, and Volar then deletes the script |
| `moduleChanged(language, module, code)` | Updates the index, deletes every template whose owner changed from the language's script registry, and returns those templates |
| `typescript` | What Volar's TypeScript layer reads — see [the TypeScript half](#the-typescript-half) |

### Which files it claims

Not every `.html`. Most `.html` files in a project are not templates, and a
plugin that claimed all of them would put TypeScript diagnostics on an email
layout. A file is a template exactly when the index says something points at
it, so a lookup that misses is the plugin declining the file — installing it
changes nothing about any file no component names.

The extension is checked as well: a `templateUrl` naming a file that does not
end in `.html` is indexed but never claimed.

### `VoltVirtualCode`

The root the plugin produces for a template. It is the template, mapped onto
itself for an HTML service, with one embedded code under it — the TypeScript
restatement — and a `binding` field carrying the `ComponentBinding` it was
typed against. The field is there because everything else downstream is
anonymous, an embedded file and a table of offsets, and something asked what a
template is typed against has nowhere else to read it from.

The root's `id` is `'root'` and its `languageId` is `'html'`; the restatement
under it has the id `'template_ts'` and the language `'typescript'`. Neither id
is in the type — they are what the code writes today.

A template is rebuilt whole on every edit rather than patched: the restatement
comes from a parse of the template, and the parser has no incremental form.
While an expression ends in a dot, that is two parses — see
[a half-typed expression](#a-half-typed-expression). Each rebuild also reads
the component module's text again and passes it to `update`, so the cost of a
keystroke in a template includes a text scan of its class's module.

### The TypeScript half

| Member | Description |
|---|---|
| `extraFileExtensions` | `html`, as mixed content with a deferred script kind — tsserver keeps the file rather than skipping it as an asset, and does not parse it as TypeScript |
| `getServiceScript(root)` | The embedded restatement, as the code to type-check, served with the extension `.ts` |

These are the members `@volar/typescript` reads, restated in this package
rather than imported. That package declares them by augmenting
`LanguagePlugin` against the classic `typescript` type definitions, and
TypeScript 7 ships a native compiler with no such definitions, so the
augmentation cannot be typed here. The shape is what `@volar/typescript` reads
at runtime; no test in this package runs it through that integration, and the
only assertions on it are the values in the table. `TypeScriptIntegration` is
not exported, so a host that needs to name the type writes
`ReturnType<typeof createVoltLanguagePlugin>['typescript']`.

## Seeing what the editor sees

`generateTemplateModule` is the translation on its own — what the plugin calls
on every edit, and the thing to run when a template is not answering the way
you expected.

```ts
generateTemplateModule(source: string, binding: ComponentBinding): GeneratedTemplate
```

| Field | Description |
|---|---|
| `code` | The restatement, as a whole TypeScript module |
| `mappings` | Volar `CodeMapping`s from that module back to the template |
| `broken` | `true` when the template itself did not parse, so nothing was restated |

```ts
import { readFile } from 'node:fs/promises';
import { createTemplateIndex, generateTemplateModule } from '@voltdev/volar';

const index = createTemplateIndex();
await index.scan('/work/my-app/src');

for (const template of index.templates()) {
  const binding = index.lookup(template)!;
  const { code, broken } = generateTemplateModule(await readFile(template, 'utf8'), binding);
  console.log(broken ? `${template}: does not parse` : code);
}
```

For the counter above, `code` is:

```ts
// ./counter.html, restated against Counter.
// Generated by @voltdev/volar. Every name in it maps back to the template.
{
  type __VoltInstance<C> = C extends abstract new (...a: never[]) => infer I ? I : never;
  const _ctx = null! as __VoltInstance<typeof import("./counter.js").Counter>;
  type __VoltSignal = { get(): unknown };
  type __VoltRead<T> = [T] extends [__VoltSignal] ? never : 0;
  const __volt_read = null! as <T>(value: T, read: __VoltRead<T>) => void;
  type __VoltEvent<K extends string> = K extends keyof HTMLElementEventMap ? HTMLElementEventMap[K] : Event;
  const __volt_handler = null! as <E>(handler: (event: E) => unknown) => void;
  __volt_handler<__VoltEvent<"click">>(($event) => (_ctx./*@volt:0*/increment()));
  __volt_read(_ctx./*@volt:0*/step, 0);
  __volt_read(_ctx./*@volt:0*/count./*@volt:6*/get(), 0);
}
export {};
```

Besides the two comment lines at the top, three things in it are this
package's rather than the compiler's:

- **The class is reached by a type-level `import()`.** `volt check` appends the
  block to the component's own module, where the class is in scope; an
  editor's virtual file is a module of its own, so it goes through the
  exports. A type-level import names no value, so nothing in the block can
  collide with it and nothing reports it unused.
- **The specifier ends in `.js`.** TypeScript substitutes `.ts` for it under
  every resolution mode, while an extensionless specifier resolves under some
  and not others. It is relative to the template's directory, because Volar
  serves the restatement at the template's own path with `.ts` appended —
  `counter.html.ts`.
- **`export {}` makes it a module**, so its declarations stay out of the
  global scope every other virtual file shares.

Each expression comes back as three layers of mapping, and only the first is
exact. Each name — `increment`, `step`, `count`, `get` — maps character for
character, and it is the only mapping that answers completion, hover,
navigation or rename. Each name is then mapped again with the `_ctx.` and the
marker comment in front of it, and each whole expression once more; those two
carry diagnostics and nothing else, so an error TypeScript reports on
`_ctx.step` underlines `step`, and one about a call underlines the call.

The header maps to nothing, so an error there never surfaces on a line of the
template. That cuts both ways. An import that does not resolve — the module
moved, or is reached through a path alias the host's TypeScript project does
not know — is not reported; `_ctx` becomes TypeScript's error type, and the
template goes quiet exactly as it does for
[a class nothing exports](#a-class-nothing-exports).

### A half-typed expression

`{ user. }` is not an expression, and a checker that gives up on it gives up at
the moment completion matters most. When an expression fails to parse only
because it ends in a dot, it is completed with a placeholder name and restated
again; the placeholder's position maps back to the empty space after the dot,
so completion there lists the members of whatever comes before it. Nothing
about that expression is reported until it parses as written.

Only a dot at the end of the whole expression is recovered. `{ user. }` is;
`:click="save(user.)"` is not, and until it parses that handler has no
completion at all. Every other way an expression can be unfinished is a guess
about what was meant, and a guess that completes to the wrong thing offers the
wrong list.

### A template that does not parse

A half-typed tag — `<div><p>{ label }</p>` — produces a module with nothing
from the template in it, no mappings, and `broken: true`. Every expression in the template stops answering until the tag
is closed, and nothing says why. That is the price of keeping a half-written
file from taking the editor's TypeScript service down with it.

### A class nothing exports

A class its module does not export cannot be named from the restatement, which
is a module of its own, so `_ctx` is typed as `any`: no completion and no
errors, rather than invented errors on every line. Export the class to get the
rest back.

`exportedName(code, className)` is how the index decides, and it reads the
module's text rather than parsing it, because it runs on every rebuild of a
template:

```ts
import { exportedName } from '@voltdev/volar';

exportedName('export default class Counter {}', 'Counter');         // 'default'
exportedName('class Counter {}\nexport { Counter as Tally };', 'Counter'); // 'Tally'
exportedName('class Counter {}', 'Counter');                        // null
```

Getting it wrong costs completion, never a false error. A name that looks
exported but is not leaves `_ctx` as TypeScript's error type, whose diagnostics
land in the header no mapping covers; a name that is exported but does not
look it gives `any`. Either way the whole template is untyped — no completion,
no errors, and `any` on hover — and `volt check`, which does not go through
the exports, goes on checking it. Four spellings it currently misreads:

- `export default abstract class Counter` is read as exported under
  `Counter`, not `default`.
- `export @Component({ ... }) class Counter` — a decorator between `export`
  and `class` — is read as not exported at all. Writing the decorator first,
  as everywhere in these docs, avoids it.
- A comment or string containing the words `class Counter` anywhere before the
  declaration — `/** The class Counter renders a number. */` — is taken for
  the declaration, which has no `export` in front of it, and the class is read
  as not exported.
- `export default Counter` with neither a semicolon nor a line break after it
  — the last line of a file with no final newline — is not seen.

### `textSnapshot`

```ts
textSnapshot(text: string): IScriptSnapshot
```

A Volar snapshot over a string that never changes, which generated code is.
Exported for hosts and tests that hold a file's text and need to hand it to
Volar. Volar tells a file has changed by its snapshot's identity, so a host
should keep one per text and hand out a new one only when the text changes — a
fresh snapshot on every question regenerates every template on every question.

## What it does not do yet

- **No editor integration.** No extension, language server or tsserver plugin
  ships with Volt, and no test runs the plugin through a Volar integration.
  Until one ships, this is a library for whoever writes it.
- **No `volt/signal-read`.** A signal rendered or tested without `.get()` is
  caught by `volt check` and not by the editor.
- **No syntax errors.** An expression or a template that does not parse goes
  quiet rather than red.
- **No child component props.** A binding on a child's tag is checked as an
  expression — its names must exist — but not against the type of the prop it
  sets, and prop names are not completed on the tag. `volt check` shares the
  restatement and has the same gap.
- **No directive or tag completion.** `:cl` does not complete to `:click`, and
  a component's selector does not complete as a tag.
- **No template written as a string.** Only a `templateUrl` file is indexed; a
  template passed to `compileTemplate()` gets nothing.
- **One owner per template.** A template two classes point at is typed against
  the first, and errors that only the second would raise are not shown.
- **Paths must be spelled one way.** A case-insensitive index can keep a stale
  claim when one module is reported under two spellings of its path — see
  [the case of a path](#the-case-of-a-path).
