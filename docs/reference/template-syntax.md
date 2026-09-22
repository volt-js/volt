# Template syntax

Volt has exactly one piece of dynamic syntax in markup: a `:` prefix.
Structure, events, and bindings all share it.

## How a name is resolved

`:name` is resolved in a fixed order, so a given name always means one thing:

1. **Structural directives** — `if`, `else-if`, `else`, `for`, `key`, `text`,
   `html`, `model`, `ref`, `slot`
2. **Explicit escapes** — `:on-*` (event), `:prop-*` (property), `:attr-*`
   (attribute)
3. **`:class` and `:style`**, which have their own merge semantics
4. **A known DOM event name** → an event listener
5. **Anything else** → a property or attribute binding

So `:click` is an event because `click` is a DOM event, and `:value` is a
binding because `value` is not. When in doubt — a custom event on a
component, a property that shares a name with an event — use the escape.

## Interpolation

```html
<p>Hello, { name.get() }.</p>
```

Expressions are real JavaScript, parsed to an AST. Free identifiers resolve
to the component instance; loop bindings and a fixed set of globals
(`Math`, `JSON`, `Date`, `console`, …) do not.

A constant interpolation is evaluated at build time and baked into the
markup: <code v-pre>{ 2 + 3 }</code> compiles to the text `5` with no effect
at all.

## Structure

### `:if` / `:else-if` / `:else`

```html
<p :if="count.get() > 5">Lots</p>
<p :else-if="count.get() > 0">Some</p>
<p :else>None</p>
```

Conditions are tested in order and short-circuit; only the winning branch is
built. Leaving a branch disposes its effects and removes its DOM.

`:else-if` and `:else` must directly follow the matching element.

### `:for` and `:key`

```html
<li :for="todo in todos.get()" :key="todo.id">{ todo.text }</li>
```

With an index:

```html
<li :for="(todo, i) in todos.get()" :key="todo.id">{ i }. { todo.text }</li>
```

Destructuring works, and stays reactive — each bound name becomes its own
accessor rather than a snapshot:

```html
<li :for="{ id, text } in todos.get()" :key="id">{ text }</li>
```

Rows are keyed. A row that survives a change is **never rebuilt** — its item
and index update in place, so only the bindings that actually read them
re-run. Reordering a list moves existing elements rather than recreating
them.

**`:key` is required.** Neither possible default is safe, so the choice is
yours every time:

| | meaning |
|---|---|
| `:key="item.id"` | a stable identity that survives the item object being replaced |
| `:key="$index"` | positional reuse, for a list that is never reordered |

Keying by position strands DOM state on the wrong row after a reorder — the
text updates correctly while focus, input values and animations stay behind.
Keying by object identity is correct on reorder but rebuilds the whole list
when data is refetched as equal-but-new objects. A `:for` without `:key` is a
compile error naming both options.

### `:text` and `:html`

```html
<p :text="message.get()"></p>
<article :html="rendered.get()"></article>
```

Both replace the element's children. `:html` does not sanitise — never pass
untrusted input.

On a component's tag they are props named `text` and `html`, because a
component has no content of its own to replace — its template has, and what
goes in it is the component's business. `<v-tip :text="label.get()">` and
`<v-tip text="Copied">` therefore mean the same thing, which is the point: a
prop you can write but not bind would be a trap.

### `:ref`

```html
<input :ref="inputEl" />
```

Assigns the element to `this.inputEl`. If that property holds a
`Signal.State`, the element is `.set()` into it instead. Cleared on unmount.

### `:model`

Two-way binding to a `Signal.State`:

```html
<input :model="name" />
<input type="checkbox" :model="agreed" />
<select :model="choice">…</select>
```

Modifiers: `.trim`, `.number`, `.lazy` (sync on `change` instead of `input`).

## Events

Any known DOM event name:

```html
<button :click="save()">Save</button>
<input :input="onInput($event)" />
<form :submit.prevent="submit()">…</form>
```

`$event` is available in inline expressions. An expression that is a bare
reference or an arrow function is used as the handler directly; anything else
is wrapped so it runs on each event.

```html
<button :click="handler">…</button>        <!-- used as-is -->
<button :click="() => save(1)">…</button>  <!-- used as-is -->
<button :click="save(1)">…</button>        <!-- wrapped -->
```

### Modifiers

| Modifier | Effect |
|---|---|
| `.stop` | `stopPropagation()` |
| `.prevent` | `preventDefault()` |
| `.self` | Only when `event.target` is this element |
| `.capture` `.once` `.passive` | Listener options |
| `.ctrl` `.alt` `.shift` `.meta` | Only with that modifier key held |
| `.enter` `.escape` `.tab` `.space` `.up` `.down` `.left` `.right` `.delete` `.backspace` | Only for that key |

```html
<input :keydown.enter="submit()" :keydown.escape="cancel()" />
<div :click.self.stop="close()">…</div>
```

### How listeners are attached

Events that bubble are **delegated**: Volt installs one listener per event
type on the document and dispatches by walking up from the target. A
thousand-row table with two handlers per row costs two listeners, not two
thousand, and adding or removing rows never touches the listener registry.

This is mostly invisible, with three consequences worth knowing:

- **DevTools shows no listener on the element.** The handler is stored on the
  node under a `$$click`-style property; the listener lives on `document`.
- **`event.currentTarget`** is set to the element the handler was attached to
  during the walk, so `.self` and manual comparisons behave as written.
- **`stopPropagation()` works**, including from a `.stop` modifier — it halts
  the walk as well as native bubbling.

Delegation is skipped, and a real listener attached, when:

- the event does not bubble — `focus`, `blur`, media and animation events
- you use `.capture`, `.once` or `.passive`, which need real listener options
- the event is `wheel`, `mousewheel`, `touchstart` or `touchmove`, which
  browsers force to be passive on the document — a delegated `preventDefault()`
  would be discarded, so `:wheel.prevent` would silently do nothing. This is
  those four specifically, not touch events in general: `touchend` and
  `touchcancel` are cancellable at the document.
- the event fires continuously — `pointermove`, `mousemove`, `pointerover`,
  `mouseover`, `pointerout`, `mouseout`, `dragover` — where a walk to the
  document per event costs more
  than the listener it saves. Hover belongs in CSS, and a gesture should listen
  on the document only for as long as the gesture lasts.

You never choose between them; the compiler picks based on the event name and
modifiers.

### Custom and component events

`:on-*` forces an event listener for names Volt does not recognise:

```html
<my-element :on-custom-thing="handle($event)"></my-element>
```

This is a real `addEventListener`, so it applies to elements and web
components. Volt components have no event channel — they notify a parent
through a callback passed in as an input:

```html
<v-counter :onChanged="(n) => onCount(n)"></v-counter>
```

Using `:on-*` on a Volt component throws, naming the callback prop to use.

## Bindings

```html
<input :value="text.get()" :disabled="busy.get()" :placeholder="hint" />
```

Volt writes the IDL property when the element has one and falls back to the
attribute otherwise. Boolean attributes are removed when falsy, never set to
`"false"`.

Force the choice when you need to:

```html
<div :attr-data-id="id.get()"></div>
<my-element :prop-config="config.get()"></my-element>
```

### `:class`

Accepts a string, an array, or an object:

```html
<div class="card" :class="{ active: isActive.get(), done: isDone.get() }"></div>
<div :class="['a', 'b']"></div>
<div :class="theme.get()"></div>
```

Classes written literally in `class` are **preserved** — only what the
binding added is ever removed.

A constant `:class` is folded into the markup: `:class="'btn'"` becomes
`class="btn"` with no runtime cost.

### `:style`

```html
<div :style="{ color: color.get(), fontWeight: 'bold' }"></div>
<div :style="'color: red'"></div>
```

Camel-case keys are hyphenated. Properties the binding previously set and no
longer includes are removed.

There is no `:show` directive — hiding an element is a style binding, and an
empty string lets the stylesheet decide the visible value:

```html
<div :style="{ display: visible.get() ? '' : 'none' }">…</div>
```

Prefer `:if` when the content is expensive or genuinely absent; the element is
then not in the DOM, the accessibility tree, or the tab order at all.

### `:spread`

```html
<div :spread="attrs.get()"></div>
```

Applies every entry of an object, and applies it again whenever what the
expression reads changes. It is how a [primitive](./primitives)'s part props
reach an element, and it works the same on a component's tag, where each entry
is a prop rather than an attribute and the tag's own props win over the bag's.

| Entry | Becomes |
|---|---|
| `class`, `style` | The same as `:class` and `:style` — a string, an object or an array |
| a name the element has as a property — `value`, `checked`, `tabIndex` | That property |
| `on` + an event name, holding a function — `onclick`, `onkeydown` | A listener for that event |
| `ref`, holding a function | Called once with the element, so a part can hand it back to whatever needs it |
| anything else | An attribute; `null`, `undefined` and `false` remove it |

Each object is applied against what the last one wrote. An entry the next
object does not carry is taken back — its attribute removed, its listener
detached, the classes and style properties it added removed while the ones the
template wrote itself stay. A listener whose function changed is swapped for
the new one, so an object built with a fresh arrow each time is safe. Taking
back a property removes the attribute of the same name, which resets a property
that reflects its attribute, like `tabIndex`, and leaves one that does not, like
a text field's current `value`, as it was.

### `:host`

What a caller writes on a component's tag — a `class`, a `style`, an `id`, a
`title`, a `role`, a `lang`, a `dir`, any `data-*` or any `aria-*` — lands on
the element the component marks with `:host`:

```html
<!-- v-button -->
<button :host class="volt-button" type="button"><slot></slot></button>
```

```html
<v-button class="wide" aria-label="Save">Go</v-button>
```

The button ends up with both classes. A class joins the template's own rather
than replacing it, a style merges, and an expression stays live, exactly as
[`:spread`](#spread) does — which is what the element is given.

Everything else written on a component's tag is a prop, and a prop it does not
declare is still refused, so `max-count` written for `maxCount` is the mistake
it always was. A component that is handed a class and marks no `:host` is told
so rather than dropping it.

One element carries it, and it must be an element: `:host` on a `<template>` is
refused, because a `<template>` groups nodes without producing one and the
attributes would have nowhere to go.

A prop written twice — `text="Copied" :text="label.get()"` — is refused as
well. One of the two would be lost, and which one is an accident of how an
object literal is read. `class` and `style` are the exceptions, and compose,
because there both halves can be meant.

## Slots

```html
<!-- v-card -->
<div class="card">
  <header><slot name="title">Untitled</slot></header>
  <main><slot></slot></main>
</div>
```

```html
<v-card>
  <h1 :slot-title>Hello</h1>
  <p>Body</p>
</v-card>
```

`:slot-<name>` fills the slot of that name. Content without one goes to the
default slot, and a `<slot>`'s children are its fallback, used when nothing is
projected.

### What a slot passes back

A slot can hand its content something to draw with. The component writes what
it has:

```html
<!-- v-rows -->
<li :for="row in rows.get()" :key="row.id">
  <slot name="row" :row="row" :index="row.id">{ row.label }</slot>
</li>
```

and the content names it, with the pattern `:for` takes on its left:

```html
<v-rows :rows="people.get()">
  <template :slot-row="{ row, index }">
    <b>{ index }. { row.label }</b>
  </template>
</v-rows>
```

That is what lets a component render one piece of markup many times — a row, a
cell, an option — and hand each rendering its own value. Bind the whole object
under one name with `:slot-row="scope"`, or destructure and rename it the way
`:for` allows: `:slot-row="{ row: person }"`.

The names are live. Each is an accessor over what the slot passed, so content
that draws a row follows that row's own signals; it is never rebuilt to show a
new value, and the elements it made stay the elements they were.

The default slot's own values are named on the component's tag, because its
content is written bare and has no element to carry the pattern:

```html
<v-frame :slot-default="{ name }"><b>{ name }</b></v-frame>
```

### Drawing what was written inside another tag

An outlet looks in its own component. `:from` points it at another one:

```html
<!-- v-table -->
<td :for="col in columns.get()" :key="col.field">
  <slot :from="col" name="cell" :row="row">{ row[col.field] }</slot>
</td>
```

This is what a pair of tags is built out of — a table and its columns, a select
and its options, tabs and their panels. The caller writes the template where it
belongs, inside the child:

```html
<v-table :rows="people.get()">
  <v-table-column field="name" label="Name"></v-table-column>
  <v-table-column label="Actions">
    <template :slot-cell="{ row }">
      <v-button :onPress="() => edit(row)">Edit</v-button>
    </template>
  </v-table-column>
</v-table>
```

and the parent draws it where it belongs, in every body cell. Everything else
about the outlet is unchanged: the props are the same getters, the fallback is
the same fallback, and the content still follows the row it was handed.

The other half of the pair is how the child finds the parent to register with,
which is [context](/reference/reactivity#context) — `useContext` while the
child's fields initialize, because the content of a tag is built inside the
render of the tag it sits in.

`:from` is the one `:` on an outlet that is not a prop handed to the content,
and there is one of it: written twice, or written out as `from="col"`, it is
refused rather than quietly becoming something else.

Structure belongs around an outlet rather than on it. `:if` and `:for` on a
`<slot>` are refused — an outlet is a position, and what it draws is what a
caller sent — so the shape to write is:

```html
<template :if="expanded.get()"><slot name="detail"></slot></template>
```

## Grouping without an element

`<template>` groups nodes without producing DOM:

```html
<template :if="ready.get()">
  <h2>Title</h2>
  <p>Body</p>
</template>
```

## Comments and whitespace

Comments are stripped. Whitespace is condensed the way Vue does it:
whitespace-only text between elements that spans a line break is removed, and
other runs collapse to a single space. `<pre>`, `<textarea>`, `<script>`, and
`<style>` are left alone.

## `:portal`

Render an element into a different container. Overlays need this: a dialog
nested inside a scrolling panel has to escape that panel's `overflow: hidden`
and its stacking context.

```html
<div :portal>…</div>                  <!-- document.body -->
<div :portal="'#modals'">…</div>      <!-- CSS selector -->
<div :portal="container">…</div>      <!-- an element -->
```

Nothing is left at the declaration site — the surrounding markup compiles
exactly as if the element had not been written there.

Two things hold regardless of where the content lands, because Volt tracks
both on the reactive scope rather than on the DOM tree:

- **Context resolves from where the content was declared.** A dialog inside a
  provider still sees it, even though it renders under `<body>`.
- **Disposal follows the declaring component.** Unmounting it removes the
  portalled content too, which is the leak portals otherwise make easy.

Combine with `:if` to mount and unmount the overlay:

```html
<div :if="open.get()" :portal>…</div>
```

The target is read once. Re-homing live content to a new container is not
something an overlay needs, and supporting it would cost every portal a move
path it never uses.
