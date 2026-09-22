# Vite plugin

```ts
import { defineConfig } from 'vite';
import { volt } from '@voltdev/vite-plugin';

export default defineConfig({
  plugins: [volt()],
});
```

## Why it is required

The plugin is not a convenience. It does three things nothing else in a
current Vite toolchain does.

**It lowers TC39 standard decorators.** They are stage 3 and implemented by
no JavaScript engine. Vite 8 transforms with oxc, which parses decorators but
emits them untouched, and TypeScript 7 is the native Go port with no
JavaScript transform API. Without this pass, `@Component` reaches the browser
as a syntax error.

Rather than ship a decorator runtime to evaluate them, the plugin *resolves*
them. It already knows every selector and prop name, and `@Component` only
ever ends in a registration call, so it emits that call and deletes the
syntax:

```ts
// what you write
@Component({ selector: 'v-counter', templateUrl: './counter.html' })
export class Counter {
  @Prop() start = new Signal.State(0);
}

// what ships
export class Counter {
  start = new Signal.State(0);
}
defineComponent(Counter, { selector: 'v-counter', render: __volt_render_0 },
  [{ property: 'start' }]);
```

Nothing about authoring changes — the decorators stay in your source, keep
their types, and still work at runtime for anyone without a build step. This
only means the bundle never carries the ~4.6 kB of helpers needed to run them.

A file using decorators Volt does not own falls back to esbuild, which lowers
the whole file the ordinary way. That is always correct, only larger.

**It compiles templates at build time.** `templateUrl` inside a `@Component`
is resolved, read, and compiled into a `render` function with hoisted static
markup, so no compiler ships to the browser and no template is parsed at
runtime. `styleUrl` and `styleUrls` are compiled from Sass the same way. Every file it
reads is registered with the watcher, so editing markup or CSS hot-reloads.

**It lowers the `Signal` namespace to direct imports.** `Signal` is the
spelling the TC39 proposal defines, and `export namespace` compiles to a
runtime object. An object is opaque to a bundler — reaching one property keeps
all of them — so an app that only ever writes `new Signal.State(0)` still
ships `currentComputed`, `introspectSources`, `introspectSinks`, `hasSinks`
and `hasSources`, with no line of the app able to reach any of them.

```ts
// what you write
import { Signal } from '@voltdev/core';
const count = new Signal.State(0);

// what ships
import { State as __volt_Signal_State } from '@voltdev/core/signals';
const count = new __volt_Signal_State(0);
```

What the rewrite is worth is decided by module layout rather than by the
rewrite, so the namespace has a module to itself and dropping it drops a
chunk. Measured on a Vite 8 production build of `examples/counter`: 24,466 to
23,944 bytes, 9,035 to 8,854 gzipped (−181 B, −2.0%). A module that
constructs a signal and runs no effect is a much smaller bundle and loses a
much larger share of it — 1,932 to 1,691 gzipped (−241 B, −12.5%).
`packages/vite-plugin/test/bundle.test.ts` builds an app both ways and holds
the saving. The lowered output is byte-for-byte identical to writing that
import by hand.

The watcher is not part of what leaves, and neither is `untrack` for an app
that uses `effect`: the graph asks `sink instanceof WatcherNode` on every
notification and `effect` imports both straight from it, so no lowering of the
namespace can reach what the runtime already holds.

Nothing about authoring changes here either. `@voltdev/core/signals` holds the
same bindings the namespace does — not copies — so `instanceof` and every
identity check give the same answer whichever spelling produced the signal,
and the namespace keeps working with no build step at all.

The pass only rewrites `Signal.State`, `Signal.Computed` and
`Signal.subtle.<member>` read directly off the imported binding. Anything else
the name is used for needs the object as an object, so the file is left
exactly as written:

```ts
const S = Signal;          // aliased
const { State } = Signal;  // destructured
register(Signal);          // passed on
new Signal[name](0);       // computed key
```

That costs bytes and nothing else. `debug: true` names the file and the reason
whenever it happens.

The pass also only ever sees your own source — `.ts`/`.mts` outside
`node_modules`. Volt's own packages ship pre-built, and every one that reaches
through the namespace hands the object back, so an app importing
`@voltdev/primitives`, `@voltdev/query` or `@voltdev/router` keeps it whatever
its own source says.

## Options

```ts
interface VoltPluginOptions {
  include?: RegExp;              // default: /\.m?ts$/
  exclude?: RegExp;              // default: /[\\/]node_modules[\\/]/
  precompileTemplates?: boolean; // default: true
  lowerSignals?: boolean;        // default: true
  runtimeModule?: string;        // default: '@voltdev/core/runtime'
  debug?: boolean;               // default: false
  start?: ServerRenderOptions | boolean;// default: false, see `serverRender`
  hydrate?: boolean;             // default: whether `start` is on
  serverModule?: string;         // default: '@voltdev/server'
  groupRowBindings?: boolean;    // default: false
  diagnostics?: boolean;         // default: true
  messages?: {                   // default: off, see Messages below
    catalog: string;
    locale?: string;             // default: the catalogue file's own name
    id?: string;                 // default: 'virtual:volt-messages'
    translate?: readonly string[]; // default: every `t(...)` is the locale's
    typesFile?: string;          // default: none
    unused?: 'warn' | 'off';     // default: 'warn'
    ignore?: readonly string[];  // default: the library's own keys
  };
}
```

`start` wires the router, the query cache, server rendering and server
functions together, and is the subject of [its own page](./server-render). It is off
until a project writes it.

`start` wires the router, the query cache, server rendering and server functions
together, and is off until a project writes it. It has [a page of its
own](./server-render), which also covers per-route rendering modes, static generation,
partial hydration, and the `renderPath` build check that keeps a render off
`node:` builtins.

`hydrate` decides which of the three emits the client build gets: `false`
clones a template into fresh nodes, `true` claims the ones a server already
printed. It is not inferable — a project may render on a server for a crawler
and ship a client build that never hydrates — so it is asked for rather than
guessed at. Turning `start` on turns it on too, because a server that writes
the markup and a client that builds its own on top of it are two halves of one
decision; pass `hydrate: false` beside `start: true` to take it back.

`diagnostics` keeps the structure around an error in a production build: its
code, the identity of what failed, and a link to the sentence the build is not
carrying. It is separate from the message text, which `__VOLT_DEV__` strips
regardless, and it is on by default because a production failure that arrives
as an unattributed throw is a failure nobody can act on. Turn it off only for a
target counting every byte, and accept that a failure then arrives as a bare
code. See [Errors](./component#errors) for what an error carries, and
[Error codes](/e/) for every code there is.

### A dependency that ships Volt source

A component library cannot ship compiled templates, and the plugin compiles
one that says so:

```json
{ "name": "@acme/widgets", "volt": { "source": true } }
```

Its `.ts` files are compiled by the build that uses it, as if they were the
application's own — templates, styles and decorators alike — and everything
else in `node_modules` is left alone as before. Setting `exclude` yourself
turns this off, since the pattern is then yours to write.

It has to work this way. What a template compiles to depends on which side of
the render it is for, and that is this build's choice, made per environment: a
client clones markup, a hydrating client claims it, a server writes bytes. And
`__VOLT_BUILD__` identifies the build that printed a page, so a client can
refuse markup another build wrote — which a page compiled half by the
application and half by whoever published a dependency would silently break,
because it would claim to be one build while being two.

The cost is a compile per template in the consuming build, which is about
0.124 ms each.

`groupRowBindings` drives a `:for` row's bindings from one effect rather than
one each. It saves about 2.3 kB a row and costs 13–35% on updating a selection
across a long list, while winning 5–11% on building one — measured in a real
browser, not estimated. It is off because the selection cost is paid on every
interaction where the construction saving is paid once, and a list that never
selects is the case it is there for.

`debug: true` logs what the compiler folded away per file:

```
[volt] src/counter.ts: 2 template(s), 3 effect(s), 4 binding(s) folded, 1 markup dedupe(s)
```

## Messages

Opt-in, and off by default. Point the plugin at a catalogue and it compiles
that catalogue instead of loading it:

```ts
volt({ messages: { catalog: 'messages/en.json', typesFile: 'src/messages.d.ts' } })
```

```json
{
  "close": "Close",
  "pageOf": "Page {n} of {m}",
  "filesSelected": { "one": "{n} file selected", "other": "{n} files selected" }
}
```

Two things happen. The catalogue becomes a module — `virtual:volt-messages` —
holding one exported function per message and importing nothing, so a bundler
drops every message the application never named:

```ts
import { pageOf } from 'virtual:volt-messages';

pageOf({ n: 2, m: 10 }); // 'Page 2 of 10'
```

Parameters are read out of the message itself, so `'Page {n} of {m}'` takes two
and nobody declares them twice. A message with plural forms takes `n` and
selects its form through `Intl.PluralRules` for the catalogue's own locale;
numbers in a placeholder are formatted with `Intl.NumberFormat` for that same
locale. Both are built lazily, on the first call that needs one.

The other half is that **every `t('key')` in a template is checked**, because
the template compiler already parses it. A key the catalogue does not have
fails the build with the template's file and line — not the `.ts` file that
declared the component — and suggests the key you probably meant:

```
[volt:compiler] `t('clsoe')` — no such message in messages/en.json.
  Did you mean `t('close')`? (src/toolbar.html:3:11)
```

So does a call that leaves out a parameter the message needs, since
`'Page {n} of {m}'` says what it wants and `t('pageOf', { n })` does not supply
it. A call the template cannot read — `t(key)`, `t('pageOf', values)`, a
spread — is left alone rather than guessed at.

A message nothing asks for is a **warning**, never a refusal: a key added today
for a screen landing next week is not a mistake. The report names the line in
the catalogue to delete. It runs on production builds only — a dev-server
rebuild has seen only the modules that changed, so every message would look
unused — and `unused: 'off'` turns it off. The strings the component library
speaks for itself (`close`, `noResults`, `menu`, `removeItem` and every other
key its components ask for) are never reported, because an application
translating them is translating what a Dialog says, not what its own templates
ask for.

`ignore` lets a project name that list itself. It replaces the default rather
than adding to it: an application that renders no Dialog is right to want
`close` reported, so naming a list means naming every key to spare.

That is also the answer to the one case the report gets wrong. A build with a
client environment and a server one runs the whole cycle once per environment,
and each reports against the modules it walked: a message only a server-only
module asks for is unaccounted for in the client's graph, so the client half
reports it. The report cannot see the other half of the build to know better.
Name those keys in `ignore`, or set `unused: 'off'` and let the server build
alone do the reporting.

`typesFile` writes the declarations somewhere your tsconfig includes:

```ts
declare module 'virtual:volt-messages' {
  export interface Messages {
    close: () => string;
    pageOf: (params: { n: string | number; m: string | number }) => string;
    filesSelected: (params: { n: number }) => string;
  }
  // ...
}
```

With that in the project, `t('clsoe')` stops compiling in TypeScript too, and
so does `t('pageOf', { n: 1 })`.

A key has to be a plain identifier, because a compiled message is an exported
function and there is no second way to spell a function name. A nested or
dotted catalogue is refused with a suggestion rather than silently renamed —
`{ "nav": { "home": "Home" } }` says to write `navHome`. The same refusal
covers every other shape a `.json` file can hold and a message cannot: a plural
with no `other` form, a form that is not a string, a number, a list, `null`.
Each of them would otherwise compile to a function returning `undefined` under
a declaration promising a `string`, which is the blank-where-a-sentence-goes
this whole pass exists to prevent. The catalogue is checked when it is read, so
the build stops on the catalogue rather than on a page that used it.

One name is reserved while `messages` is configured: **`t`**. In a template,
every `t(...)` and every `<anything>.t(...)` with a literal first argument is
read as a translation call site — so a component method called `t` that is not
the locale's turns its first argument into a message key, and into a build
error when the catalogue has no such message. In ordinary source the same shape
is noted rather than checked, so there it costs nothing beyond a message that
stops being reported as unused. Call the method something else, or leave
`messages` off.

None of this replaces `createLocaleProvider`. Its runtime `MessageCatalog` is
still there, still the fallback, and still the whole story for a project with
no build step — and a template's `t('close')` still calls it. The compiled
module is the form to import from TypeScript when the catalogue is large enough
that shipping it whole costs something.

## What it will not touch

Precompilation locates `templateUrl:` by scanning tokens, not by matching
source patterns, so it correctly ignores:

- `templateUrl:` inside a comment or a string
- `templateUrl:` in an object literal that is not a `@Component` argument

A missing file, or a syntax error inside one, fails the build with the
**html file's** path and position — not the `.ts` file that referenced it.

## Without a build step

`templateUrl` is read from disk, which a browser cannot do. Where there is no
build step — a test, a playground — supply `render` directly:

```ts
import { compileTemplate } from '@voltdev/core/jit';

@Component({
  selector: 'v-greeting',
  render: compileTemplate(`<p>Hello, { name.get() }.</p>`),
})
export class Greeting {}
```

That entry pulls the compiler into the bundle, which is why it is a separate
import rather than a config option. A component declaring `templateUrl` with
no build-time pass throws with a message pointing at both options.
