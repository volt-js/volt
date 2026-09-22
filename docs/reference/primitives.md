# Primitives

`@voltdev/primitives` is component behaviour with nothing else attached: the
state a dialog, a menu or a date picker holds, the keyboard map it answers to,
and the ARIA a screen reader is told. It renders no markup and ships no styles.
A primitive hands back attributes and handlers, and you put them on elements
you wrote yourself.

The split is along what can be retrofitted. Markup and styles are what an
application changes, and changes often. The full keyboard interaction map of
the WAI-ARIA Authoring Practices — not only the roles, which are the easy tenth
of it — is what an application cannot add later without rewriting the
component. So that part is written once, here, and each primitive is held to
the pattern the Authoring Practices give for it. The one departure the source
records on purpose is shared by every list but the tree — the arrow keys skip
a disabled item — and is explained under
[conventions](#state-is-written-where-css-can-reach-it).

What it costs is that nothing appears on the page until you write the markup.
A primitive is a class field plus a template, not a tag you drop in, and every
part of a widget — the trigger, the list, each option — is an element you write
and spread its props onto. Styled components over a subset of these are
[`@voltdev/ui`](./ui).

::: warning Not on npm yet
`@voltdev/primitives` is not published, and the release deliberately leaves it
out: a version on npm cannot be taken back, so a package goes there when its
shape is meant to be permanent. Everything on this page works from a checkout of
the Volt repository, where it resolves from the workspace. The packages on npm
today are `@voltdev/core`, `@voltdev/reactivity`, `@voltdev/compiler` and
`@voltdev/vite-plugin`.
:::

There is one entry point, and everything on this page and the category pages is
imported from `@voltdev/primitives` itself — the package has no subpath
exports. It is marked side-effect free, so a bundler drops the primitives an
application never imports.

## Using one

```ts
import { Component, Signal } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { createDialog } from '@voltdev/primitives';

@Component({
  selector: 'v-confirm',
  render: compileTemplate(`
    <button :ref="trigger" :spread="dialog.triggerProps()" :click="dialog.open()">Delete</button>
    <div :if="dialog.isPresent()" :portal :ref="content" :spread="dialog.contentProps()">
      <h2 :spread="dialog.titleProps()">Delete this file?</h2>
      <p :spread="dialog.descriptionProps()">This cannot be undone.</p>
      <button :click="dialog.close()">Cancel</button>
    </div>
  `),
})
export class Confirm {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  dialog = createDialog({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
  });
}
```

What that buys, without another line: the content is a `role="dialog"` with
`aria-modal`, labelled by the `<h2>` and described by the `<p>` — and not
pointing at either if you leave it out, because a dangling `aria-labelledby`
hides the fact that a label is missing. Focus moves in on open, is held there,
and goes back on close to whatever held it before. Escape and a press outside
both close it, and only the topmost layer hears Escape. Every other child of
`<body>` is made `inert` and `aria-hidden` while it is open, except one that
carries `aria-live` or is a toaster's region (`data-volt-toaster`), so an
announcement or a toast raised meanwhile is still heard; and scrolling is
locked without the page shifting sideways as the scrollbar goes.
Content under a `[data-state='closed']` exit animation stays mounted until the
animation ends.

The `:portal` is not decoration. The dialog makes the page inert a child of
`<body>` at a time, and leaves alone the one that contains the content — so a
modal dialog rendered in place, inside the application's root element, leaves
that whole branch of the page live and readable behind it.

(The template here uses [`compileTemplate`](./component#compiletemplate-source-filename)
so the example is self-contained; in an application the markup lives in a
`templateUrl` file.)

## Conventions

These hold across the package, and the exceptions are named where they come
up.

### Created in a field initialiser

A `create*` function registers effects and cleanups on the scope it is called
in. From a field initialiser, that scope is the component's, so a primitive
lives exactly as long as the component holding it and nothing needs tearing
down by hand — listeners, timers, observers, the scroll lock and the entry on
the dismissal stack all go with it.

Called with no scope current, it has nothing to belong to and nothing ever
releases it. Where it registers a cleanup, a development build warns that the
cleanup will never run; its effects draw no warning, and run for the life of
the page. Outside a component — a test, a script — wrap it in
`createRoot` from `@voltdev/core` and keep the disposer.

### Elements are getters

Options that name an element take `() => Element | null | undefined`, never an
element. At construction nothing has rendered; `:ref` fills a signal once it
has, and the getter reads that signal, so the primitive sees the element
arrive, and sees it go when an `:if` removes it.

### State is read by calling it

`isOpen()`, `value()`, `state()`, `isPresent()`. Each reads a signal
underneath, so a template that calls one is subscribed to it and nothing has to
be told to re-render.

### Parts are prop bags

Every part of a widget has a method returning the attributes that part needs —
`triggerProps()`, `contentProps()`, `itemProps(item)` — carrying `role`,
`aria-*`, `id`, `tabindex` and `data-*`. Spread it with `:spread`, and call it
from the template rather than holding the object, because the bag is rebuilt
when the state beneath it changes.

Event handlers are mostly separate methods you bind yourself —
`menu.onTriggerKeyDown($event)`, `menu.onItemClick($event)` — because a handler
on the content that resolves the item from the event's target covers items
rendered from a `:for`, which cannot each hold a `:ref`. A few primitives put
handlers in the bag instead: the popover (and so the date picker's button,
which spreads the popover's), the tooltip, tabs, toggle and toggle group, the
navigation components, the clipboard trigger and an alert's dismiss button.
Read the category page for which: a dialog trigger spread without a `:click` is
a trigger nothing opens.

A bag of your own may carry `on*` handlers too. `:spread` attaches each with
`addEventListener`, and when the bag is rebuilt it swaps a handler whose
function changed for the new one and removes one the bag no longer carries — so
a fresh arrow per call is fine, and costs a remove and an add each time the bag
is rebuilt.

### Controlled or owned

A primitive that holds a value owns it unless you pass one. Hand it a
`Signal.State` in the option of the same name — `open`, `value`, `checked`,
`pressed`, `placement` — and it reads and writes yours instead. The matching
`default` option — `defaultOpen`, `defaultValue`, `defaultChecked` — sets the
starting point of one it owns, and is ignored when you pass the signal.

The callback is named for the value too — `onOpenChange`, `onValueChange`,
`onCheckedChange` — with one exception worth knowing: the listbox takes `value`
and reports it through `onSelectionChange`, as the tree does for `selected`. It
reports the changes that go through the primitive, whichever of you owns the
signal: a user closing it, choosing, typing, and your own call to `close()` or
`setValue()`, which a test pins for the dialog and the progress bar. A write you
make to the signal directly is not echoed back, nor is the default, nor a call
that changes nothing. A callback for something *derived* — the calendar's
`onVisibleMonthChange`, a virtualizer's `onRangeChange` — watches the result
instead, and fires however the change came about.

### Strings are options

Anything a primitive would put in front of a user — a close button's name,
"3 of 12 selected", a live-region sentence — comes from a `labels` option,
English when you pass nothing. A library that hard-codes English has to be
forked to ship anywhere else.

`createLocaleProvider` supplies a locale, a direction and a message catalogue
down the scope, and the primitives use it unevenly. The catalogue's strings are
read by the calendar (its month and year buttons, and what it announces), the
listbox (its selected count), the select and combobox, the tree (loading and
empty), the number, password, pin, tags and rating inputs, the date field's
and time picker's empty segments and the date picker's button, the popover's
close button, the menu's name, the toaster's region and close buttons, the
file upload's remove buttons, the clipboard, drag and drop, and the display
family — progress, badge, chip, keyboard key, code, chat, alert, skeleton,
spinner and empty state, each naming its keys under
[display primitives](./primitives-display#before-you-start). A `labels` entry
still wins over the catalogue wherever both are read. The slider takes the
locale's code, direction and formatters from the provider — digits,
percentages — and none of its strings. The date field, time picker and file
upload take the same, and beyond the entries named above none of their strings
either: the names of a date's fields and a file's size come from the
formatters, but what they say in sentences, and an upload's rejection, stay
English until you pass `labels`. The pager takes `pageOf` for the sentence it
announces — "Page 3 of 12" — and nothing else. Everything else takes its
strings through `labels` alone: a provider that says `next: 'Weiter'` names the
calendar's next-month button in German and leaves a pager's saying "Next page".
Two entries of the catalogue itself — `sortedAscending` and `sortedDescending`
— are read by no primitive yet, so translating them changes nothing. See
[data](./primitives-data).

### State is written where CSS can reach it

`data-state="open"` or `"closed"`, `data-disabled`, `data-orientation`,
`data-placement`. Style against those; the primitives add no classes.

One rule covers every disabled control in the package: it carries
`aria-disabled="true"` and `data-disabled`, never the `disabled` attribute, it
keeps its place in the tab order, and the primitive refuses the activation in
its own handlers. A control a keyboard user cannot reach is a control they
cannot discover is there, and the cost is a tab stop that does nothing. It
holds for the checkbox, the switch, the slider's thumbs, the toggle and the
toggle group — a group disabled as a whole keeps its one tab stop. An item
inside a list carries the same attributes; what a list changes is which item
holds its single tab stop.

Inside a list the `data-disabled` twin is also what the arrow keys skip by, so
in a menu, a listbox, a tab list or a toggle group a disabled item is passed
over and never holds the tab stop. That departs from the Authoring Practices,
which would rather a disabled item stayed arrowable too; the package takes one
rule across every list over an exception per component, because arrowing onto
something that cannot be activated has a cost of its own. The tree is the one
exception it makes, and keeps a disabled node arrowable. A disabled radio is
the other: the arrows step over it and it never holds the group's tab stop, so
a radio group disabled as a whole has no tab stop at all.

### Geometry is read in the measure lane

A primitive that has to measure — a collapsible's height, a scroll area's
thumb, a code block's overflow, a virtualizer's viewport, a textarea growing
with its text, a breadcrumb's trail — reads from `measureEffect`, so every read
in a flush shares one layout (see [effects](./reactivity#effects)). A test fails
for any of those that goes back to measuring from `effect`.

### Nothing browser-only runs on a server

The primitives render on a server, so their markup and ARIA are in the first
bytes a page sends. What reaches for a live document — focus, measuring,
listening, announcing — runs from effects a server never drains, or is guarded
on `document` being there, so it happens in the browser and not before. Ids are
positional, so the client arrives at the ids the server wrote.

## The building blocks

The components are mostly composition over a handful of shared behaviours.
Those are exported, because a widget the package does not have will be built
out of them too.

### Ids: `createId`

```ts
createId(prefix?: string): string
```

A unique id for wiring `aria-labelledby`, `aria-controls` and the rest. It is
`@voltdev/core`'s, re-exported here. The id is derived from the component's
position in the tree rather than from a counter, so a server and a client
rendering the same tree arrive at the same ids — which hydration needs — and
two requests rendering at once do not number from one sequence.

An id minted after the first render, from an effect rather than a constructor,
has no position to sit in: it is still unique, and not stable across a reload.
`resetIds()` is a test seam.

### Presence: `createPresence`

```ts
createPresence(open: () => boolean, node: () => Element | null | undefined): Presence
```

| Member | Description |
|---|---|
| `isPresent()` | Whether the content should be in the DOM now — put it on the `:if` |
| `state()` | `'open'` or `'closed'` — put it on `data-state` |

Keeps content mounted until its exit animation has finished. `state()` is
derived from `open`, so the element already carries `closed` when the close is
acted on; presence then asks the element what `getAnimations()` reports
running, and releases the node once all of it has settled — not the first to
end, so an exit that fades `opacity` over 150 ms and moves `transform` over
300 ms runs its full 300 ms. Nothing running — none declared, a
`prefers-reduced-motion` rule turning it off, or something declared that
closing does not start — and the node goes at once, so a library that never
animates pays nothing. An animation with no end is a loop rather than an exit
and is not waited for. Reopening mid-exit cancels the release, and only the
element's own animations count, so a child's cannot end the panel's exit.

The duration comes from CSS rather than a timer, so there is nothing to keep in
step. Scope the exit to the state:

```css
[data-state='open']   { animation: fade-in  150ms; }
[data-state='closed'] { animation: fade-out 150ms; }
```

An `animation` left on the element in every state has finished long before the
close and does not run again, and a `transition` the closed state does not set
off never starts. Neither is running when presence asks, so neither holds the
node.

```ts
import { Component, Signal } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { createPresence } from '@voltdev/primitives';

@Component({
  selector: 'v-saved',
  render: compileTemplate(`
    <p :if="presence.isPresent()" :ref="note" :attr-data-state="presence.state()">Saved</p>
  `),
})
export class Saved {
  shown = new Signal.State(false);
  note = new Signal.State<Element | null>(null);
  presence = createPresence(() => this.shown.get(), () => this.note.get());
}
```

### Dismissal: `createDismiss`

```ts
createDismiss(
  node: () => Element | null | undefined,
  onDismiss: (reason: DismissReason) => void,
  options?: DismissOptions,
): void
```

| Option | Default | Description |
|---|---|---|
| `exclude` | none | `() => (Element \| null \| undefined)[]` that also count as inside — the trigger, usually |
| `escape` | `true` | Escape dismisses this layer |
| `outsidePointer` | `true` | A press outside dismisses this layer |

`reason` is `'escape'` or `'outside-pointer'`.

The layer is registered on one stack shared by every dismissable thing on the
page, from the moment of the call for as long as the calling scope lives — not
from when `node` first answers. So call it where that scope is the layer's time
on screen: inside content rendered under `:if`, or from an effect that runs
while the layer is open, which is what every layer here does — the dialog,
popover, menu and tooltip, the select and combobox popup, a navigation
submenu. Called
from a field initialiser it would sit on the stack closed and take the Escape
meant for the layer below. Three rules come with it:

- **Only the topmost layer that takes Escape hears it.** A popover open inside
  a dialog closes on the first press and the dialog on the second.
- **Outside is judged on pointer down and acted on at pointer up**, and both
  ends have to be outside. Selecting text in a dialog and releasing past its
  edge does not close it.
- **A layer contains everything stacked above it.** A popover portalled out of a
  dialog is not a DOM descendant of it, and a press in it is still inside the
  dialog.

The first rule applies to presses as well as to Escape: a press outside
everything closes the popover and leaves the dialog under it open, and the next
press closes the dialog. Topmost means topmost of the layers that take that
kind of dismissal — a layer registered with `escape: false` is passed over and
the key goes to the layer beneath, and `outsidePointer: false` does the same
for a press. A layer that has to keep either from everything below it takes it
and declines in `onDismiss`, which is what the dialog, the popover, the menu,
the select and the combobox do for `closeOnEscape: false` and
`closeOnOutsidePointer: false`.

The listeners are on `document` in the capture phase, so a layer still
dismisses when something inside the page stops propagation. They are added by
the first layer and removed with the last. `dismissStackSize()` is a test seam.

### Focus scope: `createFocusScope`

```ts
createFocusScope(node: () => Element | null | undefined, options?: FocusScopeOptions): void
focusableWithin(container: Element): HTMLElement[]
```

| Option | Default | Description |
|---|---|---|
| `autoFocus` | `true` | Move focus inside when created |
| `restoreFocus` | `true` | Give focus back to whatever held it, on cleanup |
| `initialFocus` | first focusable | `() => Element \| null \| undefined` to focus instead |

Holds focus inside a layer and returns it afterwards. It watches `focusin` on
the document rather than intercepting Tab: intercepting the key means
reimplementing tab order, which the browser already computes and no
reimplementation gets right across shadow roots and `tabindex`. Watching where
focus lands catches every route out — keyboard, pointer, script. A focus that
escapes is pulled back to `initialFocus` when you gave one, else to the first
focusable element, else to the container itself, which is given
`tabindex="-1"` when it has nothing focusable inside. Recovery reads which way
focus was heading from the Tab press itself, which is still down while focus
moves: Shift+Tab off the first element wraps round to the last, and an escape
by a press or by script goes back to the start. Inside a modal dialog the page
behind is inert and cannot take focus at all, so there Tab past either end
leaves the document for the browser's own controls, and comes back in on the
dialog.

Focus is restored only to an element still in the document; one that was
removed is left alone rather than chased.

**`node` is read once, when it is called.** Unlike the options of the
components, it does not follow the getter, and if it answers `null` then there
is no trap at all and focus is not moved — only the restore on cleanup is
registered. Create the scope from an effect that runs once the layer is
rendered, as the dialog does, and the effect's cleanup is what releases it. On a
server it does nothing.

`focusableWithin` is the query the scope uses, and returns the tab sequence: a
positive `tabindex` first, lowest first and document order among equals, then
the rest in document order. The candidates are links with an `href`, enabled
form controls, media with controls, `contenteditable` and anything with a
`tabindex` — less any whose `tabindex` is negative, a native control included,
since that is how a roving group keeps its resting items out of the tab
sequence. It is a fixed selector list, so a `<summary>` or an `<iframe>` with no
`tabindex` of its own is focusable and not listed. Rendering is judged with
`checkVisibility()`, which asks the ancestors too, so an element inside a
`display: none` or `hidden` ancestor is left out.

A trap is not a modal. A screen reader's own cursor is not bound by focus, so
the page behind is still readable and still clickable; the dialog adds `inert`
to everything else for that reason, and so should anything else that claims to
be modal.

### Collection: `createCollection`

```ts
createCollection(container: () => Element | null | undefined, options?: CollectionOptions): Collection
```

| Member | Description |
|---|---|
| `all()` | Items in DOM order, disabled ones included |
| `enabled()` | Items that can be moved to |
| `indexOf(el)` | Index among the enabled items, or `-1` |
| `at(index, loop?)` | The enabled item at `index`, clamped — or wrapped with `loop` |
| `next(from, delta, loop?)` | The enabled item `delta` places away; wraps by default. From nothing, the first item going forward and the last going back |
| `first()` / `last()` | The ends |
| `match(search, from?)` | The next enabled item whose text starts with `search` |

| Option | Default | Description |
|---|---|---|
| `attribute` | `'data-volt-item'` | The attribute that marks an item — `ITEM_ATTRIBUTE` |
| `skipDisabled` | `true` | Leave out items with `data-disabled` or `disabled` |

The items of a menu, listbox or tab list, in the order they appear. The order is
read from the DOM on every call rather than kept from registration, because a
`:for` list registers in array order and is then reordered, filtered or split
across groups — the DOM is the only place the order is true. Items mark
themselves with an attribute rather than registering through a context, which
is what lets an item sit in a group or a fragment the consumer wrote without
knowing it is inside anything.

`match` compares against `data-label` where an item has one, and its text
otherwise, lowercased, and starts after `from` so repeated presses walk the
matches. It is a plain prefix test, not a collation: accents are not folded.

The cost is a `querySelectorAll` per call. For a menu or a tab list that is
nothing; a collection of thousands wants a [virtualizer](./primitives-collections).
The query also finds every marked descendant however deep it sits, so a second
group rendered inside the first — a submenu inside its parent's content — is
walked as part of it unless its items are marked with a different `attribute`
or it is portalled out.

### Roving focus: `createRovingFocus`

```ts
createRovingFocus(
  collection: Collection,
  active: () => Element | null | undefined,
  setActive: (el: HTMLElement | null) => void,
  options?: RovingFocusOptions,
): RovingFocus
```

| Member | Description |
|---|---|
| `onKeyDown(event)` | Handle a key. Returns `true` when it was consumed |
| `focus(item)` | Focus an item and make it the tab stop |
| `itemProps(item)` | `{ tabindex }` — `'0'` for the tab stop, `'-1'` for the rest |

| Option | Default | Description |
|---|---|---|
| `orientation` | `'vertical'` | `'vertical'`, `'horizontal'` or `'both'` — which arrows move |
| `loop` | `true` | Wrap past the ends |
| `typeahead` | `true` | Printable characters jump to a matching item |
| `typeaheadTimeout` | `500` | How long typed characters accumulate, in ms |
| `onSelect` | none | Enter or Space on the active item |

The pattern behind menus, tab lists, toolbars, radio groups and trees: the
group holds one tab stop and the arrows move it, so Tab enters and leaves the
whole group in one press. Left and Right swap under `dir="rtl"`, read from the
nearest `dir` attribute before computed style; Up and Down never swap. Home and
End go to the ends. A key with Ctrl, Meta or Alt held is left alone, because it
is a shortcut and not navigation.

Typeahead is in the same handler because it has to compose with the arrows.
Repeating one character walks the items beginning with it rather than searching
for "sss", which is what every native listbox does. Space is never a search
character: it is selection.

`onKeyDown` does not call `preventDefault`, and the decision is yours because it
depends on the key. An arrow it answered should be cancelled, or the arrow that
moved focus also scrolls the page. Enter and Space on a native `<button>` should
not: `onKeyDown` reports them consumed whenever an item is active, with or
without an `onSelect`, and cancelling them cancels the click they were about to
become, so the press does nothing at all. The toggle group makes the same
exception for the same reason.

```ts
import { Component, Signal } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { ITEM_ATTRIBUTE, createCollection, createRovingFocus } from '@voltdev/primitives';

@Component({
  selector: 'v-toolbar',
  render: compileTemplate(`
    <div role="toolbar" aria-label="Formatting" :ref="root"
         :keydown="keydown($event)" :focusin="focusin($event)">
      <button data-volt-item :ref="bold" :spread="roving.itemProps(bold.get())">Bold</button>
      <button data-volt-item :ref="italic" :spread="roving.itemProps(italic.get())">Italic</button>
    </div>
  `),
})
export class Toolbar {
  root = new Signal.State<Element | null>(null);
  bold = new Signal.State<Element | null>(null);
  italic = new Signal.State<Element | null>(null);
  active = new Signal.State<Element | null>(null);

  roving = createRovingFocus(
    createCollection(() => this.root.get()),
    () => this.active.get(),
    (el) => this.active.set(el),
    { orientation: 'horizontal' },
  );

  keydown(event: KeyboardEvent) {
    // Enter and Space on a button are already a click; leave them to it.
    if (event.key === 'Enter' || event.key === ' ') return;
    if (this.roving.onKeyDown(event)) event.preventDefault();
  }

  // A click or a Tab lands without a key handler hearing it.
  focusin(event: FocusEvent) {
    const item = (event.target as Element).closest(`[${ITEM_ATTRIBUTE}]`);
    if (item) this.active.set(item);
  }
}
```

`itemProps` carries the tab stop and nothing else — the item still needs
`data-volt-item` for the collection to find it, and the role its pattern asks
for. With nothing active, the tab stop is the first enabled item, so Tab can
enter the group at all. Focus that arrives by a click, or by Tab, is not seen
by a key handler, so it does not move the tab stop until you record it —
`setActive` from a `focusin` on the group, which is what the tabs and the toggle
group do. Without that, the first arrow after a click moves from wherever the
keys were last.

### Anchoring: `createAnchor`

```ts
createAnchor(options: AnchorOptions): Anchor
```

| Option | Default | Description |
|---|---|---|
| `anchor` | required | `() => Element \| null \| undefined` — the reference to position against |
| `placement` | owned | A `Signal.State<AnchorPlacement>` to drive it from outside |
| `defaultPlacement` | `'bottom'` | A side, optionally `-start` or `-end` |
| `offset` | none | The gap — a number in pixels, or any CSS length |
| `flip` | `true` | Let the browser try the opposite side when this one overflows |
| `shift` | `true` | Let it try the other alignments of the same side |
| `fallbacks` | `[]` | Further `@position-try` names or `position-area` values |
| `strategy` | `'absolute'` | `'fixed'` for an element already in the top layer |
| `positionVisibility` | none | Written as `position-visibility` |
| `dir` | read off `anchor` | `'ltr'` or `'rtl'`, forced |
| `name` | generated | The `anchor-name`, as a dashed-ident |
| `onPlacementChange` | none | Called when `setPlacement` changes it |

| Member | Description |
|---|---|
| `anchorProps()` | For the reference: its `anchor-name`, and nothing else |
| `floatingProps()` | For the floating element: `position`, `position-anchor`, `position-area`, the fallbacks, `data-placement`, `data-anchored`; with `offset`, the four margins and `--volt-anchor-offset`; with `positionVisibility`, that |
| `arrowProps()` | For a decorative arrow: positioned in the gap, `aria-hidden`, `data-side` |
| `placement()` / `side()` / `alignment()` | What was asked for |
| `setPlacement(p)` | Change it |
| `direction()` | The direction the placement was resolved against |
| `positionArea()` | The resolved `position-area`, for CSS you write yourself |
| `isSupported()` | Whether this browser has CSS anchor positioning |
| `name()` | The `anchor-name` in use |

This is CSS anchor positioning and nothing else. The reference gets an
`anchor-name`, the floating element a `position-anchor`, a `position-area` and
the fallbacks to try, and from there the browser keeps the two together through
scrolling, resizing, zooming and every layout change no script would hear
about. Nothing measures a rectangle, listens for scroll or asks for an
animation frame. Popover, tooltip, menu, select and combobox position through
it, and the date picker through the popover.

What that costs, plainly:

- **No script fallback.** Where the engine has no anchor positioning,
  `isSupported()` is false, the floating element carries
  `data-anchored="false"`, and it is not positioned at all — your CSS places it,
  and that browser gets no collision handling. Shipping a layout engine to
  everyone so one engine can flip a popover is the trade this declines.
- **The placement in use is not reported.** When the browser takes a fallback
  it does not say which, and there is no API to ask, so `placement()`,
  `data-placement` and the arrow's `data-side` are the side that was
  *requested*.
- **Inline styles win.** The positioning scheme is written inline because a
  `position-area` on a statically positioned element does nothing; the cost is
  that it beats your stylesheet, which is what `strategy` is for.
- **`offset` owns all four margins**, three of them zero, so a gap does not
  linger on the old side when the placement changes — and a margin your
  stylesheet gives the floating element loses to them. A flip the browser makes
  needs none of this: `flip-block` and `flip-inline` swap the margins with
  everything else.

Positions are written in physical keywords, resolved against the direction at
the *reference*. A floating element is nearly always portalled to `<body>`, and
the browser resolves logical keywords against the floating element's
containing block — so a trigger inside an RTL region of an LTR page would align
to the wrong edge. The nearest `dir` attribute wins over computed style, and it
is watched: one `MutationObserver` per document, shared by every anchor and
filtered to `dir`, so a language switch after mount moves what is anchored.
Passing `dir` skips the reading and the watching both.

`supportsAnchorPositioning()`, `positionAreaFor(placement, direction?)` and
`writingDirection(el)` are the pieces on their own. On a server
`supportsAnchorPositioning()` answers `true`, leaving the browser that receives
the markup to decide. A server has no element to read a direction from either,
so the markup it writes is resolved as `ltr` unless you pass `dir`; the client
reads the reference once it runs and corrects it.

### Announcements: `announce`

```ts
announce(message: string, options?: AnnounceOptions): void
```

| Option | Default | Description |
|---|---|---|
| `priority` | `'polite'` | `'assertive'` interrupts what is being read |
| `clearAfter` | `7000` | Milliseconds before the sentence is cleared |

For the sentence that has nowhere to appear: a sort order changed, a filter
matched nine rows, a value was copied. There are exactly two live regions per
document, one for each priority — politeness is fixed when a region is made —
mounted on first use and kept for the page's life, so a page with a sort
header, a pager and a copy button does not grow three regions that clip each
other.

A region has to be on the page before the words are, because a screen reader
announces what *changes* inside a region, not what a region arrives holding. So
the first call mounts the region and the sentence follows it 50 ms later; a
burst in that window keeps only the last message, since a burst nobody could
hear in order would bury the one still true. Two children are written
alternately, so announcing "3 results" twice is heard twice. An empty message is
ignored, and on a server the call does nothing.

Use `assertive` for an error that stopped what the user asked for, and for
little else. `resetAnnouncer()` removes the regions, for tests.

```ts
import { announce } from '@voltdev/primitives';

announce('Sorted by name, ascending');
announce('Upload failed: the server refused the file', { priority: 'assertive' });
```

### Islands: `createIsland`

```ts
createIsland<T>(options: IslandOptions<T>): Island<T>
```

| Option | Description |
|---|---|
| `host` | `() => Element \| null \| undefined` — the element the island owns. Everything inside it is yours |
| `setup` | `(host) => T \| (() => void) \| void` — draw it, on the client, once the host is in the document |
| `onError` | Called if `setup` throws; without it the error goes to the error channel |

| Member | Description |
|---|---|
| `sync(read, apply)` | Route one signal to one operation inside the island |
| `instance()` | What `setup` returned, or `null` — before it has run, on a server, and when it returned a function or nothing |
| `isReady()` | Whether the island has been drawn, whatever `setup` returned |
| `hostProps()` | `data-volt-island` on the host |

A subtree the framework does not own: a canvas, a map, a video player, an editor
surface, each of which draws its own DOM and is ruined by anything else
touching it. Volt has no re-render to suppress, so what an island adds is the
declaration — a boundary that says the region is yours, and a lifetime you do
not have to remember to end. Whatever `setup` returns as a function, and
whatever it registers with `onCleanup`, runs when the component goes.

`sync` is one effect per relationship: `read` is tracked and `apply` is not, so
a signal changing runs one applier and touches one object in the scene. A
viewer with a thousand annotations selects one by writing one property.

```ts
import { Component, Signal } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { createIsland } from '@voltdev/primitives';

@Component({
  selector: 'v-map',
  render: compileTemplate(`<div :ref="host" :spread="island.hostProps()"></div>`),
})
export class MapView {
  host = new Signal.State<Element | null>(null);
  zoom = new Signal.State(4);

  island = createIsland({
    host: () => this.host.get(),
    setup: (el) => new MapWidget(el),
  });

  constructor() {
    this.island.sync(
      () => this.zoom.get(),
      (zoom, map) => map.setZoom(zoom),
    );
  }
}
```

It never draws on a server: `setup` runs from a user effect, and a server flush
stops before those, so the host is sent empty and filled by the client.

Two things to know, both about `setup`:

- **It runs untracked, and once.** A signal it reads is not a reason to tear
  the island down and draw it again; only `host` becoming another element is.
  Read signals in `sync`, which is what routes one into the scene.
- **What it returns is what `instance()` holds.** Return the object the island
  is about — the map, the chart, the editor — and `sync` has something to apply
  to. Returning a teardown function instead, or nothing, is allowed and leaves
  `instance()` null; `isReady()` is true either way, because the island has
  drawn.

## Every primitive

One line each; the category page has the options, the keyboard map and an
example.

### [Overlays](./primitives-overlays)

| Primitive | What it is |
|---|---|
| `createDialog` | A modal or non-modal layer; a modal one holds and restores focus, makes the page behind `inert` and locks scrolling |
| `createPopover` | A non-modal layer anchored to the control that opened it |
| `createTooltip` | A short description of a control, on hover and on keyboard focus; the next one opens without the delay |
| `createMenu` | A dropdown menu or a context menu — items, checkbox and radio items, typeahead |
| `createToaster` | A queue of transient notifications, announced without taking focus |
| `createCollapsible` | One section that expands, with its height published for CSS to animate |
| `createAccordion` | Several collapsibles sharing one piece of state |

### [Forms](./primitives-forms)

| Primitive | What it is |
|---|---|
| `createFormField` | The wiring every input needs: label, description, error, validation, dirty state |
| `createInput` | A single-line text input |
| `createTextarea` | A multi-line input that grows with its content |
| `createNumberInput` | A spinbutton that parses and formats in the user's locale |
| `createPasswordInput` | A password field with a reveal toggle |
| `createPinInput` | One box per character, acting as one field |
| `createTagsInput` | A list of tags with a text input at the end |
| `createRating` | A star rating — a radio group wearing stars |
| `createCheckbox` | A checkbox, tri-state included, over a hidden native input |
| `createSwitch` | An on/off setting that takes effect at once |
| `createRadioGroup` | One control with one tab stop; arrowing is choosing |
| `createToggle` | A button that stays down |
| `createToggleGroup` | A set of toggles, single or multiple |
| `createSlider` | A slider, single or range, over native inputs a form submits |
| `createFileUpload` | A file upload's whole lifecycle — drop, paste, queue, progress, retry |
| `createClipboard` | Copy to the clipboard, with the result said out loud |

Alongside them: `parseLocaleNumber`, `supportsFieldSizing`, `matchesAccept`, and
the two upload transports `xhrTransport` and `fetchTransport`.

### [Selection](./primitives-selection)

| Primitive | What it is |
|---|---|
| `createListbox` | A collection of options — no selection, single, multiple or extended |
| `createSelect` | A button showing the value, over a popup listbox |
| `createCombobox` | A textbox that filters a popup listbox |
| `createCalendar` | A month grid of dates |
| `createDateField` | A date typed into segments rather than chosen |
| `createTimePicker` | A time of day, entered the same way |
| `createDatePicker` | A date field with a calendar behind a button |

Alongside them, the civil-date arithmetic exported from the calendar's module:
`addDays`, `addMonths`, `addYears`, `compareDates`, `isSameDate`, `clampDate`,
`toIsoDate`, `parseIsoDate`, `today`, `firstDayOfWeek`, `dayOfWeek`,
`daysInMonth`, `isLeapYear`, `toEpochDay`, `fromEpochDay`.

### [Collections](./primitives-collections)

| Primitive | What it is |
|---|---|
| `createTree` | A hierarchy that can be walked, searched, chosen from and rearranged |
| `createVirtualizer` | Windowed rendering of a long collection |
| `createDragDrop` | Sorting within a collection and transfer between connected ones, by pointer and by keyboard |
| `createTabs` | One tab list over one set of panels |
| `createBreadcrumb` | A trail that collapses its middle into a menu when it runs out of room |
| `createPagination` | A pager over a known number of items |
| `createStepper` | A sequence of steps with a status each, linear or not |
| `createNavigationMenu` | A menubar of links, each of which may open a submenu |
| `createScrollArea` | A scroll area with scrollbars of your own |
| `createResizable` | Panels a splitter moves between |
| `createAspectRatio` | A box that keeps its shape |

Alongside them, the layout helpers that return styles rather than behaviour:
`flex`, `stack`, `grid`, `container`, `center`, `spaceVar`, `sizeVar`.

### [Display](./primitives-display)

| Primitive | What it is |
|---|---|
| `createAvatar` | An image with a name behind it, and a fallback |
| `createProgress` | A progress bar, determinate or not |
| `createSeparator` | A divider, or — given a size to move — a window splitter |
| `visuallyHidden` | The style that hides content from the eye and not from a screen reader |
| `createBadge` | A count or a status, said properly |
| `createChip` | A removable tag |
| `createImage` | A picture that reserves its space and reports how loading went |
| `createKbd` | A keyboard shortcut, drawn as symbols and said as words |
| `createCode` | Code, inline or in a block |
| `createRelativeTime` | "3 minutes ago", kept true by one shared ticker |
| `createAlert` | A message announced where the user already is |
| `createSkeleton` | A placeholder for content that is loading, shown only if the wait is worth showing |
| `createSpinner` | A busy indicator that does not flash |
| `createEmptyState` | What a collection says when it holds nothing |
| `createLiveRegionTiming` | The live-region timing rule, for a region of your own |
| `createDeferredVisibility` | Show something only if a wait runs long enough |
| `createChat` | A transcript that grows at the bottom while someone is reading it, and a composer |

### [Data](./primitives-data)

| Primitive | What it is |
|---|---|
| `createResource` | One remote call's status, data and error, with stale answers dropped |
| `exponentialBackoff` | The retry delay `createResource` uses by default |
| `createLocaleProvider` | A locale, direction and message catalogue, provided down the scope |
| `useLocale` | The nearest provided locale, or the document's |
| `useProvidedLocale` | The nearest provided locale, or `null` |
| `createLocale` | A locale with nothing provided |
| `createFormatters` | `Intl` formatters bound to a locale accessor |

Alongside them: the getters for cached `Intl` instances (`getNumberFormat`,
`getDateTimeFormat`, `getCollator`, `getPluralRules`, `getListFormat`,
`getRelativeTimeFormat`), `resolveDirection`, `DEFAULT_MESSAGES` and
`DEFAULT_COLLATOR_OPTIONS`.

### Attribute and property names

Where a primitive finds its parts by attribute, or publishes a measurement as a
CSS custom property, the name is exported as a constant, so markup or CSS
written by hand spells the name the code reads. Most are written for you by a
prop bag; the ones you meet in your own CSS are the custom properties.

| Constant | Value | Page |
|---|---|---|
| `ITEM_ATTRIBUTE` | `data-volt-item` | this page |
| `ISLAND_ATTRIBUTE` | `data-volt-island` | this page |
| `COLLAPSIBLE_HEIGHT_PROPERTY` | `--volt-collapsible-height` | [overlays](./primitives-overlays) |
| `ACCORDION_TRIGGER_ATTRIBUTE` | `data-volt-accordion-trigger` | [overlays](./primitives-overlays) |
| `RADIO_VALUE_ATTRIBUTE` | `data-value` | [forms](./primitives-forms) |
| `VISUALLY_HIDDEN_INPUT_STYLE` | an inline style string | [forms](./primitives-forms) |
| `PIN_BOX_ATTRIBUTE` | `data-volt-pin-box` | [forms](./primitives-forms) |
| `SLIDER_THUMB_ATTRIBUTE` | `data-volt-slider-thumb` | [forms](./primitives-forms) |
| `SLIDER_INPUT_ATTRIBUTE` | `data-volt-slider-input` | [forms](./primitives-forms) |
| `OPTION_ATTRIBUTE` | `data-volt-option` | [selection](./primitives-selection) |
| `CALENDAR_DAY_ATTRIBUTE` | `data-volt-calendar-day` | [selection](./primitives-selection) |
| `SEGMENT_ATTRIBUTE` | `data-volt-segment` | [selection](./primitives-selection) |
| `TREE_ITEM_ATTRIBUTE` | `data-volt-tree-item` | [collections](./primitives-collections) |
| `TREE_TOGGLE_ATTRIBUTE` | `data-volt-tree-toggle` | [collections](./primitives-collections) |
| `TREE_CHECKBOX_ATTRIBUTE` | `data-volt-tree-checkbox` | [collections](./primitives-collections) |
| `VIRTUAL_ITEM_ATTRIBUTE` | `data-volt-virtual-index` | [collections](./primitives-collections) |
| `DRAG_CONTAINER_ATTRIBUTE` | `data-volt-drag-container` | [collections](./primitives-collections) |
| `DRAG_ITEM_ATTRIBUTE` | `data-volt-drag-item` | [collections](./primitives-collections) |
| `DRAG_HANDLE_ATTRIBUTE` | `data-volt-drag-handle` | [collections](./primitives-collections) |
| `TAB_VALUE_ATTRIBUTE` | `data-volt-tab-value` | [collections](./primitives-collections) |
| `CRUMB_ATTRIBUTE` | `data-volt-crumb` | [collections](./primitives-collections) |
| `CRUMB_OVERFLOW_ATTRIBUTE` | `data-volt-crumb-overflow` | [collections](./primitives-collections) |
| `PAGINATION_ITEM_ATTRIBUTE` | `data-volt-page` | [collections](./primitives-collections) |
| `STEP_ATTRIBUTE` | `data-volt-step` | [collections](./primitives-collections) |
| `NAV_ITEM_ATTRIBUTE` | `data-volt-nav-item` | [collections](./primitives-collections) |
| `NAV_SUBITEM_ATTRIBUTE` | `data-volt-nav-subitem` | [collections](./primitives-collections) |
| `SCROLL_THUMB_ATTRIBUTE` | `data-volt-scroll-thumb` | [collections](./primitives-collections) |
| `SCROLL_THUMB_SIZE_PROPERTY` | `--volt-scroll-thumb-size` | [collections](./primitives-collections) |
| `SCROLL_THUMB_OFFSET_PROPERTY` | `--volt-scroll-thumb-offset` | [collections](./primitives-collections) |
| `RESIZABLE_HANDLE_ATTRIBUTE` | `data-volt-resizable-handle` | [collections](./primitives-collections) |
| `RESIZABLE_SIZE_PROPERTY` | `--volt-resizable-size` | [collections](./primitives-collections) |
| `RESIZABLE_TEMPLATE_PROPERTY` | `--volt-resizable-template` | [collections](./primitives-collections) |
| `SPACE_PREFIX` | `--volt-space-` | [collections](./primitives-collections) |
| `SIZE_PREFIX` | `--volt-size-` | [collections](./primitives-collections) |

`RADIO_VALUE_ATTRIBUTE` is the one that is not namespaced. It is the plain
`data-value`, which a good many other parts write as well — menu and
navigation-menu items, toggle-group items, select and combobox options and
chips, the rating, the slider and the progress bar — so a bare `[data-value]`
selector in your CSS reaches all of them. Scope it under the component's root.

One custom property has no constant: the anchor's `--volt-anchor-offset`, the
gap `offset` asked for, written on the floating element and the arrow so that
an arrow can be drawn exactly as tall as the gap.

### Test seams

`resetIds`, `resetAnnouncer`, `resetTooltipDelayGroup`, `resetLocaleCaches`,
`dismissStackSize`, `directionWatcherCount` and `relativeTimeTickerSize` are
exported for tests. They reset or count state that outlives a component — the
dismissal stack, the shared ticker, the tooltip delay group, the direction
observer, the cached `Intl` instances, the id numbering — that an application
never needs to touch, and a test left without them passes on the previous
case's state.

## What is not finished

The package is an alpha, `0.1.0-alpha.1`, and unpublished. Everything in the
index above is exported and meant to be used, and every component is tested
through what it does. A few of the small helpers exported beside them are not
called by name in any test — `addYears`, `clampDate`, `isSameDate`,
`createFormatters`, the list, plural and relative-time `Intl` getters,
`matchesAccept` and `supportsFieldSizing` — and are covered only as far as the
components that use them reach; `addYears` no component uses. What follows are
the limits a user will meet, recorded rather than hidden.

- **Select, combobox, the inputs and the slider-and-upload module are the
  newest exports.** They were held back for several rounds of review, and
  released when a round found no defect in behaviour; the gaps in their tests
  that rounds found along the way were closed by writing the tests. That is
  what the round found, not a promise that nothing is left.
- **A combobox given a value it cannot name shows an empty box.** A
  `defaultValue` or `value` is an identifier, not text, and a textbox holds text
  somebody could have typed, so the box stays empty until something names the
  value — an option rendering, the text the page was served with, or
  `labelFor`. The value is held and submitted throughout. Supply `labelFor` and
  it is named from the first paint.
- **A tags input's `clear()` removes while the field is `disabled` or
  `readOnly`**, where `removeAt` refuses. That is deliberate — `clear()` is
  your own call, the same write you could make through the value signal — and
  it is pinned by a test so that changing it is a decision.
- **A slider cannot hear a write nobody announces.** A value written into a
  hidden input and announced with `input` or `change`, or by `pageshow`, moves
  the thumb — autofill and a session restore announce themselves with one of
  those, and the back-forward cache with the last — and the rendered
  `data-dirty` follows those and either reset. A script that assigns `value`
  and fires nothing leaves the thumb where it was until the slider next writes,
  and `data-dirty` as it was until the next render for any other reason; the
  platform says nothing when a property is assigned. `isDirty()` counts the
  write either way, the moment it is asked.
- **Not every string is localised through the provider**, as said
  [above](#strings-are-options).
- **Not every primitive has a stylesheet in `@voltdev/ui`**, and that is by
  design rather than a gap: this package is headless and the styled package
  covers a subset.
- **Anchoring has no fallback** in a browser without CSS anchor positioning, as
  described [above](#anchoring-createanchor).
