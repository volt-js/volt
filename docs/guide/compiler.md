# How the compiler works

The compiler is a pure `string → string` transform with no DOM and no Node
dependencies. That is what lets the same code path run in two places — at
build time through the Vite plugin, and at runtime through `new Function` —
so behaviour never diverges between development and production.

## The pipeline

```
template source
  → parse        HTML-ish scanner → AST, resolving `:name` directives
  → analyse      expressions parsed to an AST; scope and constants resolved
  → generate     DOM-building JavaScript
```

## Parsing expressions properly

Early template engines rewrote expressions with patterns — prefixing anything
that looked like an identifier. That breaks on property keys, string
contents, and shadowed names.

Volt parses template expressions with a Pratt parser into a real AST. The
payoff is that two things become reliable:

**Scope-aware identifier resolution.** A free identifier becomes `_ctx.x`; a
`:for` binding or arrow parameter of the same name stays local.

```html
<li :for="item in items.get()">{ item.name } of { items.get().length }</li>
```

```js
// `item` is local; `items` is on the component
(item, _i) => (… item().name … _ctx.items.get().length …)
```

**Provably safe constant folding.** An expression is foldable only if it
contains nothing but literals and operators over literals. That is decided on
the AST, not guessed.

## What gets removed at build time

### Static markup is cloned, not built

A subtree with no bindings becomes one string, parsed once into a
`<template>` and cloned per instance:

```html
<div class="card"><h2>Title</h2><p>Body</p></div>
```

```js
const _tmpl0 = _rt.template('<div class="card"><h2>Title</h2><p>Body</p></div>');
// zero effects
```

### Identical markup is shared

Two branches with the same static shape share one hoisted template:

```html
<p :if="a.get()"><b>same</b></p>
<p :else><b>same</b></p>
```

Both branches clone from a single `_tmpl0`.

### Constant bindings are folded into markup

```html
<div :class="'btn'" :disabled="1 > 0">{ 2 + 3 }</div>
```

```js
const _tmpl0 = _rt.template('<div class="btn" disabled="">5</div>');
// zero effects — every binding was resolved at build time
```

### Text-only elements get one binding

An element whose children are all text and interpolations compiles to a
single text binding over one text node, instead of one insertion marker per
hole:

```html
<p>Hi, { name.get() }! You have { count.get() } messages.</p>
```

```js
_rt.bindText(_el1, () => (
  "Hi, " + _rt.toDisplayString(_ctx.name.get()) +
  "! You have " + _rt.toDisplayString(_ctx.count.get()) + " messages."
));
```

No comment markers appear in the output, and one effect covers both holes.

### Node references are resolved at build time

Dynamic nodes are reached by `firstChild`/`nextSibling` chains computed
during compilation, reusing earlier references where possible — the second
element steps from the first rather than restarting from the root:

```js
const _el1 = _tmpl0();
const _el2 = _el1.firstChild;
const _el3 = _el2.nextSibling;
```

There is no `querySelector`, no id lookup, and no traversal at runtime.

## What the generated code looks like

```html
<span>{ count.get() }</span>
```

```js
const _tmpl0 = _rt.template("<span></span>");

return function render(_ctx) {
  const _el1 = _tmpl0();
  _rt.bindText(_el1, () => (_rt.toDisplayString(_ctx.count.get())));
  return _el1;
};
```

Generated code only ever calls into `_rt`, the runtime namespace. It imports
nothing, which is why it works equally well as a module or through
`new Function`.

## Compilation statistics

`compile()` reports what it removed:

```ts
import { compile } from '@voltdev/compiler';

const { stats } = compile(source);
// {
//   templates: 1,          hoisted <template> elements
//   dedupedTemplates: 0,   markup reused across templates
//   effects: 1,            bindings that survived to runtime
//   foldedBindings: 3,     bindings resolved at build time
//   staticNodes: 4,        nodes with no bindings at all
// }
```

Pass `debug: true` to the Vite plugin to log this per file.

## Two modes, one output

`compile()` returns both forms:

```ts
const result = compile(source);

result.body;         // for `new Function('_rt', body)`
result.code;         // a standalone ES module exporting `render`
result.hoisted;      // module-level declarations, for build-time embedding
result.renderParams; // the parameters the render function takes
result.renderBody;   // its body
result.target;       // 'client' or 'server'
```

The Vite plugin uses `hoisted` plus `renderParams` and `renderBody` to inline
the render function into the module that declared the component, so hoisted
templates end up at module scope and tree-shaking still works.

The parameters and the body are separate rather than one expression because
the server emit needs them apart: it writes bytes through a segment tree
rather than building nodes, so it composes a different function around the
same body.
