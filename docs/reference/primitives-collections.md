# Collections and navigation

The primitives on this page are the ones a reader moves *through*: a tab list,
a long list, a tree, a list that can be reordered, the trail, pager, stepper
and menubar that say where the reader is, and the scroll areas and splitters
that hold the rest. All of them come from `@voltdev/primitives`.

::: warning Not on npm yet
Part of `@voltdev/primitives`, which is not published yet — see
[the overview](./primitives). Everything here works from a checkout of the Volt
repository.
:::

Every one is headless. It owns state, the keyboard map and the ARIA, and hands
back prop objects to spread onto markup you write; nothing here renders, and
nothing here has an opinion about how anything looks. The keyboard map is the
part written out in full on this page, because it is the part that cannot be
added to a component afterwards.

## The shape they share

Five conventions hold across the whole page, and knowing them makes every
signature below shorter to read.

**Elements arrive as accessors.** An option such as `list`, `tree` or
`scroller` is a function returning the element or `null`, and it is normally a
read of a signal that `:ref` fills. It is a function rather than an element
because the element does not exist when the class field is initialised, and a
signal read is what lets the primitive's effects wake up once it does.

**They belong to a scope.** Every factory here except `createAspectRatio`
registers effects and cleanups on the scope it is created in, so create them as
class fields, where the component's own scope disposes them with it. Created
outside any scope, their cleanups never run — Volt warns about that in
development. The spacing helpers are plain functions and have no scope at all.

**State is either owned or controlled.** Where a primitive holds something a
parent might want to drive — the selected tab, the current page, the expanded
nodes — it takes an optional `Signal.State` for it. Pass one and the primitive
reads and writes yours; leave it out and it keeps its own, starting from the
matching `default…` option. The `on…Change` callbacks fire either way, but not
for a default the primitive chose itself, because that is not a user's action.

**Props are spread.** Methods ending in `Props` return a plain object for
`:spread`. A `style` in one is applied property by property, so it merges into
whatever `style` or `:style` the element already has rather than replacing it;
where both name the same property, the one applied last wins. Tabs and the
four navigation primitives put their key and click handlers in those objects;
the tree, the virtualizer, drag and drop, the scroll area and the splitter hand
the handlers back as methods for you to bind with `:keydown` and friends.

**Every visible string is a label.** Each primitive that puts words in front of
a user takes a `labels` object, and every one of those words can be replaced
there, because a hard-coded English sentence is not something a consumer can
work around. Tabs and the aspect ratio write no words of their own: the tab
list's name is its `label` or `labelledBy` option, and has no default.

## Tabs

```ts
function createTabs(options: TabsOptions): Tabs
```

One tab list over one set of panels, to the WAI-ARIA tabs pattern.

```ts
import { Component, Signal } from '@voltdev/core';
import { createTabs } from '@voltdev/primitives';

@Component({ selector: 'v-settings', templateUrl: './settings.html' })
export class Settings {
  list = new Signal.State<Element | null>(null);
  tabs = createTabs({ list: () => this.list.get(), label: 'Settings' });
}
```

```html
<div :ref="list" :spread="tabs.listProps()">
  <button type="button" :spread="tabs.tabProps('account')">Account</button>
  <button type="button" :spread="tabs.tabProps('billing')">Billing</button>
</div>
<div :spread="tabs.panelProps('account')">…</div>
<div :spread="tabs.panelProps('billing')">…</div>
```

| Option | Default | Description |
|---|---|---|
| `list` | required | The tab list element. The tabs are found inside it |
| `value` | — | A `Signal.State<string>` to control the selection |
| `defaultValue` | the first enabled tab | Selected on first render |
| `orientation` | `'horizontal'` | Which arrows move between tabs |
| `activation` | `'automatic'` | `'manual'` moves focus with the arrows and selects on Enter or Space |
| `loop` | `true` | Wrap past the first and last tab |
| `label` | — | Accessible name for the tab list |
| `labelledBy` | — | Id of an element already naming it, preferred when that name is on screen |
| `onValueChange` | — | Called with the new value |

| Member | Description |
|---|---|
| `value()` / `isSelected(value)` | The selection |
| `select(value)` | Select a tab, unless it is disabled |
| `listProps()` | `role="tablist"`, orientation, name, and the key and focus handlers |
| `tabProps(value, { disabled? })` | One tab, with its id, `aria-controls` and roving `tabindex` |
| `panelProps(value)` | Its panel: `role="tabpanel"`, labelled by the tab, `hidden` unless selected |

The element it is given is the tab list, not a root wrapping list and panels
both. A panel very often holds a second tabs widget, and a query from a root
would gather that widget's tabs as members of the outer list.

Selection follows focus by default, which is what the practice recommends while
showing a panel is cheap. Where a panel costs a request, or its content moves
focus itself, `activation: 'manual'` separates the two.

Panels are hidden rather than unmounted, so every tab's `aria-controls`
resolves; a consumer who prefers `:if` loses nothing else by it. Every panel
carries `tabindex="0"`, whether or not it holds anything focusable, because
deciding would mean inspecting its content on every render and the two ways of
being wrong are not equal: one costs a Tab press, the other leaves content a
keyboard user cannot reach.

A disabled tab is marked `aria-disabled` rather than natively `disabled`, so it
stays in the accessibility tree and is announced among the others. The arrow
keys skip it and it cannot be selected, by keyboard or by click.

A `<button>` used as a tab inside a form still needs `type="button"` from you.
The primitive cannot set it: a tab is as often a `<div>` or an `<a>`, where the
attribute means nothing.

### Tab list keyboard

| Key | Action |
|---|---|
| Tab | Into the list on the selected tab; the next Tab leaves it |
| ArrowRight / ArrowLeft | Next / previous enabled tab (horizontal), mirrored under `dir="rtl"` |
| ArrowDown / ArrowUp | Next / previous enabled tab (vertical) |
| Home / End | First / last enabled tab |
| Enter, Space | Select the focused tab (what `'manual'` waits for) |

Only the keys the list consumed are prevented, so an ArrowDown a horizontal
list did not claim still scrolls the page. A key with Ctrl, Alt or Meta held is
a shortcut and is left alone. There is no typeahead: the practice gives letters
no meaning in a tab list, and claiming them would only take them from whatever
else on the page wants them. Under manual activation, leaving the list hands
the tab stop back to the selected tab, which is where the practice puts focus
when Tab comes round again.

## Long lists

```ts
function createVirtualizer(options: VirtualizerOptions): Virtualizer
```

Ten thousand rows cost ten thousand elements and ten thousand bindings.
Rendering only what is on screen costs a fixed handful of each, and everything
else becomes arithmetic. That trade is the whole primitive.

It knows nothing about lists, options, rows or cells. The tree below, the
listbox and the [grid](./grid) all want the same three answers — which items to
render, where to put them, and how big the whole collection is — so those are
what it returns, and each component decides what an item means. The grid runs
two, one per axis, which is why the axis is an option rather than an
assumption.

```ts
import { Component, Signal } from '@voltdev/core';
import { createVirtualizer } from '@voltdev/primitives';

@Component({ selector: 'v-log', templateUrl: './log.html' })
export class Log {
  scroller = new Signal.State<Element | null>(null);
  container = new Signal.State<Element | null>(null);
  lines = new Signal.State<string[]>([]);

  rows = createVirtualizer({
    scroller: () => this.scroller.get(),
    container: () => this.container.get(),
    count: () => this.lines.get().length,
    itemSize: 24,
    focusable: true,
  });

  onKeyDown(event: KeyboardEvent) {
    if (this.rows.onKeyDown(event)) event.preventDefault();
  }
}
```

```html
<div :ref="scroller" :spread="rows.scrollerProps()"
     :keydown="onKeyDown($event)" style="block-size: 20rem; overflow: auto">
  <div :spread="rows.sizerProps()">
    <div :ref="container" :spread="rows.containerProps()">
      <div :for="item in rows.items()" :key="item.key"
           :spread="rows.itemProps(item.index)">{ lines.get()[item.index] }</div>
    </div>
  </div>
</div>
```

Three elements, each with one job. The scroller scrolls, and its client box is
the viewport. The sizer is empty and exists only to be the full length of the
collection, so the scrollbar tells the truth. The container holds the rendered
window and is moved into place with one transform — one composited property on
one element per scroll, rather than a position written to every row. Making the
scroller scroll is your stylesheet's job; nothing here sets `overflow`.

| Option | Default | Description |
|---|---|---|
| `scroller` | required | The element that scrolls |
| `container` | the scroller | Where rendered items are looked for when measuring |
| `count` | required | How many items there are |
| `itemSize` | required | A number is exact; a function is an estimate |
| `measure` | `true` when `itemSize` is a function | Measure rendered items and correct the estimate |
| `gap` | `0` | Space between items in px — part of the arithmetic, not of layout |
| `axis` | `'vertical'` | Or `'horizontal'` |
| `overscan` | `2` each way | Or `{ before, after }` |
| `getItemKey` | the index | What a measurement is cached against |
| `counting` | `'set'` | `'set'`, `'row'`, `'column'` or `'none'` — which position attributes items carry |
| `indexBase` | `1` | The ARIA index of item 0 |
| `focusable` | `false` | Put the scroller in the tab order |
| `labels` | — | `range(first, last, count)` (default "Items 20 to 40 of 1000"), `empty` (default "No items") |
| `onRangeChange` | — | Called when the rendered window changes — where an infinite list loads more |

| Member | Description |
|---|---|
| `items()` | The items to render, in order |
| `range()` | `startIndex`, `endIndex`, `visibleStartIndex`, `visibleEndIndex` — all `-1` when empty |
| `totalSize()` | The collection's extent in px |
| `offset()` | Where the rendered window starts |
| `scrollOffset()` / `viewportSize()` | The scroller's position and client size |
| `sizeOf(index)` / `offsetOf(index)` | One item's size and start |
| `indexAt(offset)` | The item at a pixel offset, clamped to the collection; `-1` only when it is empty |
| `scrollToIndex(index, { align?, behavior? })` | `align` defaults to `'nearest'`, which leaves a visible item alone |
| `scrollToOffset(offset, { behavior? })` | Clamped to the collection |
| `remeasure(index?)` | Forget one measurement, or all, and take them again. Does nothing on the fixed path, where there is nothing to forget |
| `onKeyDown(event)` | Returns `true` when it consumed the key |
| `scrollerProps()` `sizerProps()` `containerProps()` `itemProps(index)` | The three elements and each item |
| `countProps()` | For the element carrying the collection's role |
| `status()` / `statusProps()` | Text and props for an optional live region |

Each `VirtualItem` carries `index`, `key`, `start`, `size`, `end`, `visible`
(inside the viewport rather than the overscan) and `measured`.

### What it can and cannot measure

There are two geometries behind the one interface, and `itemSize` and
`measure` decide which you get.

| `itemSize` | `measure` | Geometry | What is measured |
|---|---|---|---|
| a number | left out, or `false` | Fixed: pure arithmetic | Nothing. `itemProps` writes the size back onto each item |
| a number | `true` | Measured, starting from that guess | Every rendered item |
| a function | left out, or `true` | Measured, starting from the estimate | Every rendered item |
| a function | `false` | Per-item sizes, never corrected | Nothing; the function is taken at its word |

**A number is a promise.** With `itemSize: 24` and nothing else, every item is
24px, the geometry is arithmetic, and nothing is observed or allocated per item
however many there are — a million rows cost what ten do. `itemProps` states
the promise back as an explicit `height` (or `width`) on each item, because the
arithmetic is only true while it holds; a row whose size should come from CSS
belongs on the measured path instead.

**Otherwise sizes live in a Fenwick tree**, so an item's offset, the item at an
offset and recording a new size are each O(log n). Changing the item count
rebuilds it in O(n), which is the one linear cost left.

What the measured path can see, and what it cannot:

- **It sees rendered items, through one `ResizeObserver`.** The size is the
  entry's `borderBoxSize`, so the observer's own report is used and no row
  forces a second layout. An item is found by the attribute `itemProps` puts on
  it, inside `container` — so spread `itemProps` on the element whose box is
  the item's size.
- **It does not see margins.** The border box is what counts. Space between
  items belongs in `gap`, where it is arithmetic.
- **It does not see what has never been rendered.** An item that has not been
  in the window is still its estimate, so `totalSize()` and the scrollbar are
  estimates until everything has been seen. A good estimate is what keeps the
  thumb from jumping as real sizes arrive.
- **It does not see an item with no box.** An element under `display: none`,
  its own or an ancestor's, or inside `content-visibility: hidden`, fails
  `checkVisibility()` and is skipped, rather than recorded as zero and
  collapsing everything below it. `visibility: hidden` and `opacity: 0` still
  have a box, and are measured.
- **It reads the physical axis.** A vertical list takes the block size and a
  horizontal one the inline size, which is right in every horizontal writing
  mode and swapped in a vertical one. Fixing that would mean reading
  `writing-mode` off the scroller, a style read it deliberately does not make.
- **It measures nothing without a layout engine.** With no `ResizeObserver`, or
  one that never reports — on a server, or under a DOM emulation in tests — the
  estimates stand. Before the scroller has a size, in a hidden tab say, the
  visible range is the first item alone and what renders is that item and the
  overscan after it, because something has to render before anything can be
  measured.

**Measurements are cached by key and never evicted.** Without `getItemKey` an
item is its index, which is right for a list that grows at the end and wrong
for one that grows at the front. Keys are read across the whole collection only
when `count` changes, because re-keying every item on every frame would be the
one O(n) step the primitive otherwise avoids — so a collection whose items move
or are replaced without its length changing has to say so with `remeasure()`.
Nothing is dropped from the cache: a million rows scrolled past leave a million
numbers behind, which is the price of scrolling back through them without the
list rearranging itself.

**The view is held still for you.** When an item above the viewport turns out
taller or shorter than its estimate, the scroll offset moves by the difference,
so the rows being read do not slide. The browser's own scroll anchoring would
make the same correction at the same moment, measured against a box about to be
replaced, so `scrollerProps()` turns it off with `overflow-anchor: none`.

**A jump corrects itself, briefly.** `scrollToIndex` into unmeasured territory
is aimed with estimates and lands short or long. For the next four updates of
the window — the landing itself is the first — the measurements arriving from
where it landed re-aim it; after that, anything moving underneath is somebody
else's change. A scroll by the reader ends the correction at once, and a
`behavior: 'smooth'` scroll is never corrected, because its own scroll events
cannot be told apart from the reader's. Only the measured path corrects; a
fixed size has nothing to correct.

The scroller's viewport and offset are first read from
[`measureEffect`](./reactivity#effects); after that they arrive through scroll
events and the observer, which fire outside any flush. The one exception is the
jump correction above: it re-aims from an ordinary effect, writing the scroll
position and reading it back there, so a flush that corrects a jump pays a
layout of its own and, in development, counts it in `strayReads`.

### What a screen reader is told

Items carry `aria-setsize` and `aria-posinset` computed from the collection,
never counted from the DOM: the DOM holds a window, and counting it announces
"3 of 12" in a list of ten thousand. A grid counts rows instead, with
`counting: 'row'` and `countProps()` on the grid element; `indexBase` exists
because `aria-rowindex` counts a header row the virtualizer does not own.

`focusable` is off by default. A plain scrolling region that cannot be focused
cannot be scrolled from the keyboard at all, which fails WCAG 2.1.1; but a
listbox or grid is already focusable, and a second tab stop on the same element
is worse than none.

`statusProps()` is `role="status"` and nothing more, and nothing renders it for
you. Announcing the window is worth it where scrolling is a discrete act —
paging, or jumping to a letter — and unbearable during a continuous drag.

### Virtualizer keyboard

For a plain scrolling region only. A listbox, grid or tree should **not** wire
`onKeyDown` — their arrows move the selection — and should call
`scrollToIndex` from their own handler instead.

| Key | Action |
|---|---|
| Home / End | First item at the start / last item at the end |
| PageUp / PageDown | One viewport back / forward |
| ArrowUp / ArrowDown | One whole item (vertical) |
| ArrowLeft / ArrowRight | One whole item (horizontal), mirrored under `dir="rtl"` |

The arrows step by item rather than by a fixed number of pixels: where rows
differ in height, a fixed step leaves a different sliver showing every time. A
key with Ctrl, Alt or Meta held is left alone.

Unlike the other handlers on this page, `onKeyDown` does not prevent the
default itself; it returns whether it consumed the key, and the caller prevents
it, as the example above does. Left to the browser, an arrow on a focused
scroller would scroll it a second time.

## Trees

```ts
function createTree<T = unknown>(options: TreeOptions<T>): Tree<T>
```

A hierarchy that can be walked, searched, chosen from, loaded lazily, windowed
and rearranged. It owns the model, the keyboard, the ARIA and the drop
arithmetic. It does not move a node: `onDrop` reports where one landed, and
changing the data is yours, because only you know what your tree is made of.

```ts
import { Component, Signal } from '@voltdev/core';
import { createTree, type TreeNode } from '@voltdev/primitives';

@Component({ selector: 'v-files', templateUrl: './files.html' })
export class Files {
  tree = new Signal.State<Element | null>(null);
  nodes = new Signal.State<TreeNode[]>([
    { id: 'src', label: 'src', children: [{ id: 'src/main.ts', label: 'main.ts' }] },
    { id: 'package.json', label: 'package.json' },
  ]);

  files = createTree({
    tree: () => this.tree.get(),
    nodes: () => this.nodes.get(),
    selectionMode: 'single',
    labels: { tree: 'Files' },
  });
}
```

```html
<div :ref="tree" :spread="files.treeProps()"
     :keydown="files.onKeyDown($event)"
     :click="files.onItemClick($event)"
     :focusin="files.onFocusIn($event)">
  <div :for="row in files.rendered()" :key="row.id"
       :spread="files.itemProps(row)"
       :style="{ 'padding-inline-start': row.level + 'rem' }">
    <span :spread="files.toggleProps()">▸</span>{ row.label }
  </div>
</div>
```

**One flat list, not a nest of lists.** Every visible node is flattened into a
linear model, and that model is what the arrow keys walk, what typeahead
searches, and what the virtualizer windows. A nested rendering would give each
of those three a different structure to agree about. The cost is that
indentation is yours — `row.level` is the number, and CSS is the place for it.

**The counted attributes are computed, never read back.** `aria-level`,
`aria-setsize`, `aria-posinset` and `aria-expanded` come from the flat model,
where they are true whatever is on screen. `aria-expanded` is left off a leaf,
where it would announce a branch that is never going to open, and
`aria-selected` appears only on the chosen node in a single-select tree rather
than as `false` on the other nine hundred.

The twisty and the checkbox are `aria-hidden`: the node already says what they
say. A press on either means something narrower than a press on the row — it
expands, or it checks, and does not select.

### Nodes and rows

```ts
interface TreeNode<T = unknown> {
  readonly id: string;              // unique across the whole tree
  readonly label?: string;          // what typeahead and the filter match; falls back to id
  readonly children?: readonly TreeNode<T>[];
  readonly hasChildren?: boolean;   // with no children: load them on first expansion
  readonly disabled?: boolean;
  readonly dropsOn?: boolean;       // a drop may land on it; default: whether it can have children
  readonly data?: T;                // yours; never read here
}
```

A `TreeRow` is one visible node, flattened: `node`, `id`, `label`, `level`
(1-based), `posinset`, `setsize`, `parentId`, `index` in the flat model,
`expandable`, `expanded`, `disabled`, and `matched` — true when it matched the
filter itself rather than being kept for a relative. `posinset` and `setsize`
count the siblings that survive the filter, because that is the set the reader
is in.

**Ids must be unique, and nothing enforces it.** The map the tree looks nodes up
in keeps the first node with a given id, but the visible rows are walked from
your data again and do not skip a repeat: a repeated id renders as two rows
answering to one id, and `rowOf` finds only the later. A cycle is not detected
either: the same node object placed inside its own children, or a lazy load
that hands back the id of a lazily loaded ancestor — the node being loaded
included — whose children are then found again by that id. Either overflows the
stack as soon as the loop is expanded, and at once under any filter, because
the filter walks everything loaded whether it is open or not.

### Tree options

| Option | Default | Description |
|---|---|---|
| `tree` | required | The element carrying `role="tree"` |
| `nodes` | required | The roots |
| `expanded` / `defaultExpanded` | empty | Controlled or initial expansion, as a set of ids |
| `selected` / `defaultSelected` | empty | Likewise for the selection |
| `filter` / `defaultFilter` | `''` | Likewise for the search text |
| `selectionMode` | `'none'` | `'single'`, `'multiple'` or `'checkbox'` |
| `cascade` | `true` | Checking a node checks its subtree (`'checkbox'` only) |
| `typeahead` | `true` | Typing letters jumps to a match |
| `typeaheadTimeout` | `500` | How long typed characters accumulate, in ms |
| `match` | label contains the query, case-folded for the locale | Whether a node survives the filter |
| `loadChildren` | — | `(node, signal) => children`, or a promise of them |
| `virtual` | — | Windowing; supplying it turns virtualization on |
| `autoExpandDelay` | `600` | Hover time over a closed node during a drag before it opens, in ms |
| `labels` | — | `tree`, `loading`, `empty`, `error`, and `drag` for the drag primitive |
| `onExpandedChange` / `onSelectionChange` | — | Called with the new set |
| `onActivate` | — | Called with the row when Enter is pressed on it |
| `onDrop` | — | `(drop, mode)`. Supplying it is what turns dragging on |

`labels.tree` has no default, because a tree is nearly always named by a
heading beside it; point `aria-labelledby` at that heading when there is one.
`loading` and `empty` default to the message catalogue's `loading` and
`noResults`, so an application that has already translated them does not do it
twice. `error` defaults to "Could not load".

The default `match` folds case with the locale's rules rather than
`toLowerCase()`, which is not the same thing in Turkish.

### Tree members

| Member | Description |
|---|---|
| `rows()` | Every visible node, flattened, in the order the arrows walk |
| `rendered()` | The window when virtualized, otherwise every row |
| `rowOf(id)` / `count()` | One row, or how many there are |
| `activeId()` / `activeRow()` | The node focus was last on, or `null` before there has been one. The tab stop sits on it while it is rendered, and on the first rendered row otherwise |
| `focusNode(id)` | Move focus to a node, scrolling it into view first when windowed |
| `expanded()` `isExpanded(id)` `expand(id)` `collapse(id)` `toggleExpanded(id)` | Expansion. `expanded()` is the set you control or seeded; `isExpanded(id)` also counts what a filter opened |
| `expandAll()` / `collapseAll()` | Open every node the tree knows of that can have children — a lazy one among them is fetched, but what it brings back stays closed / close everything, including what a filter opened |
| `expandSiblings(id)` | What `*` does |
| `selection()` `isSelected(id)` `select(id, { additive?, range? })` `toggleSelected(id)` | Selection |
| `checkedState(id)` / `setChecked(id, checked)` | `true`, `false` or `'indeterminate'` |
| `selectAll()` / `clearSelection()` | Every visible row that is not disabled in `'multiple'`; every loaded node that is not disabled in `'checkbox'`, on screen or not. `selectAll` does nothing in `'none'` or `'single'` |
| `filter()` / `setFilter(query)` | The search text |
| `isLoading(id)` `loadError(id)` `reload(id)` `nodeStatus(id)` | Lazy loading |
| `drag` / `virtualizer` | The underlying primitives, or `null` when not in use |
| `dropTarget()` / `indicator()` | Where a live drag would land, in data terms and in pixels |
| `lift(id)` | Start a keyboard drag; `false` when the node cannot be picked up |
| `onKeyDown` `onItemClick` `onPointerDown` `onFocusIn` | Bind on the tree element |
| `treeProps()` `itemProps(row)` `toggleProps()` `checkboxProps(row)` | |
| `sizerProps()` / `contentProps()` | Virtualized trees only |
| `status()` / `statusProps()` | An optional live region: the `loading` label while fetching, the `empty` label when a filter matches nothing, otherwise `''` |

`onActivate` is documented in the package's own types as "Enter, or a
double-press", but nothing in the tree listens for a double press. Only Enter
calls it. To open a file on a double click, bind `:dblclick` on the row
yourself.

### Choosing nodes

| Mode | What a press on a row does | What is reported |
|---|---|---|
| `'none'` | Opens or closes a folder | Nothing; Space is left free to lift a node, when `onDrop` is set |
| `'single'` | Selects it. Space on the chosen node does not unselect it | `aria-selected` on the chosen node |
| `'multiple'` | Replaces the selection; with Ctrl or Cmd toggles it in or out; with Shift takes a range | `aria-selected` on every node, `aria-multiselectable` on the tree |
| `'checkbox'` | Toggles its check | `aria-checked`, including `mixed` |

`'checkbox'` is a different model from `'multiple'`, not a decoration on it: it
says so with `aria-checked`, it has a third state, and with `cascade` on, its
state flows both ways — checking a folder checks everything under it, and a
folder with some of its descendants checked reports `'indeterminate'`. A folder
checked before its lazy children arrived finishes the cascade when they land.
Turn `cascade` off for a tree where every checkbox is its own fact, which is
what a tree of independent permissions wants.

Enter on a node activates it and, in `'single'` and `'multiple'`, selects it
too — replacing the selection, in `'multiple'` — because doing only one of the
two makes the pressed node and the chosen node disagree.

**Disabled nodes stay reachable.** The arrow keys stop on them and they carry
`aria-disabled`, rather than being skipped: a node a keyboard user cannot reach
is a node they cannot discover is there. They refuse selection, activation and
being picked up, and a cascade passes through them without changing them.

### Filtering

`setFilter(query)`, or a `filter` signal a search box owns, narrows the tree.
A match keeps itself, every ancestor above it, and everything below it. The
ancestors are opened, so the match is on screen; the subtree under a match is
kept but left closed, so a search for a common word costs nothing for the
branches it holds until one is asked for.

The filter's opening is derived rather than written into the expansion set, so
clearing the search does not leave the whole tree standing open. A branch the
reader closes under a filter stays closed until the query changes.

The filter searches what is loaded. Lazy children that have never been fetched
are not searched, and nothing is fetched to search them.

When the node holding focus is filtered out, collapsed away or removed from the
data, the tab stop — and focus, if the tree had it — moves to the nearest
ancestor still showing, or the first row. A filter that matches nothing leaves
the tree itself as the tab stop, so a reader in the tree has somewhere to stay.

### Children that load later

A node opts in with `hasChildren: true` and no `children`. The first time it is
expanded, `loadChildren` is called with it and an `AbortSignal`.

Requests run one at a time, in the order the nodes were opened: a user who
expands ten folders in a second should not open ten connections. The cost is
that the tenth waits for the first nine. Collapsing a node that is still
waiting takes it out of the queue, and aborts it if it is in flight; so does
unmounting the tree.

A node whose children arrive empty becomes a leaf, whatever it claimed before
it was opened. A failure is kept: `loadError(id)` has it, `nodeStatus(id)`
gives the string to show, and `reload(id)` forgets it — or the children that
did arrive — and asks again while the node is open, or on its next expansion
if it is closed. While a request is out, the node and the tree carry
`aria-busy`.

### Tree keyboard

The WAI-ARIA tree view pattern.

| Key | Action |
|---|---|
| ArrowDown / ArrowUp | Next / previous visible node |
| ArrowRight | Expand a closed node; on an open one, move to its first child |
| ArrowLeft | Collapse an open node; on a closed node or a leaf, move to its parent |
| Home / End | First / last visible node |
| `*` | Expand every sibling of the focused node |
| Enter | Activate, and select in `'single'` and `'multiple'` |
| Space | Select (`'single'`), toggle in or out (`'multiple'`), or toggle the checkbox; with `'none'` and `onDrop` set, lift for dragging |
| Printable characters | Typeahead, accumulating for `typeaheadTimeout` |
| Shift + ArrowDown / ArrowUp | Move, and toggle the node moved to (`'multiple'`, `'checkbox'`) |
| Shift + Space | Select from the last chosen node to this one (`'multiple'`) |
| Ctrl + Shift + Home / End | Move to the first / last node and select from the focused node to it, replacing the selection (`'multiple'`) |
| Shift + Home / End | The same, without the Ctrl |
| Ctrl + A | Select everything (`'multiple'`, `'checkbox'`) |

Cmd stands in for Ctrl in both chords. Where Ctrl + A has nothing to select —
`'none'` and `'single'` — it is not prevented, and the browser selects the
page's text as usual.

The tree pattern spells the range chords with Ctrl, where the multi-select
listbox spells them without. Both are accepted: the practice's own chord has to
work, and a reader arriving from a list with the shorter one in their fingers
finds it does what they meant rather than nothing. In a checkbox tree the range
chords move without selecting, because every node's state there is a fact about
its own subtree and there is no range to draw.

Left and Right are resolved against writing direction, so they swap under
`dir="rtl"`; Up and Down never swap. Any other key with Ctrl, Alt or Meta held
is a shortcut and passes through.

Movement, Home, End and typeahead are decided on the flat model, not on the
DOM, because each has to reach rows a windowed tree has not rendered. Typeahead
therefore finds any visible node, including one scrolled out of the window —
but not one inside a collapsed folder. Repeating one letter walks through the
nodes that start with it, as a native list does.

### Dragging nodes

Supply `onDrop` and nodes can be picked up by pointer or keyboard, through
[`createDragDrop`](#reordering). Bind `onPointerDown` on the tree element as
well as the others. The `TreeDrop` it reports is in terms of your data rather
than the flat list:

| Field | Description |
|---|---|
| `sourceId` | The node that moved |
| `targetId` | The node the drop was resolved against, or `null` for the empty root |
| `position` | `'before'`, `'after'` or `'on'` |
| `parentId` | The parent it ends up under; `null` is the root |
| `index` | Its index among that parent's children, with the dragged node already taken out |

That last field means "remove it, then `splice(index, 0, node)`" is correct
with no adjustment, which is the off-by-one every sortable tree gets wrong. A
drop `on` a node puts it last among that node's children. A line drawn directly
below an open folder means the top of that folder, index 0, rather than a
sibling after everything it contains.

```ts
import { Component, Signal } from '@voltdev/core';
import { createTree, type TreeDrop, type TreeNode } from '@voltdev/primitives';

@Component({ selector: 'v-outline', templateUrl: './outline.html' })
export class Outline {
  tree = new Signal.State<Element | null>(null);
  nodes = new Signal.State<TreeNode[]>([]);

  outline = createTree({
    tree: () => this.tree.get(),
    nodes: () => this.nodes.get(),
    onDrop: (drop: TreeDrop) => this.nodes.set(moveNode(this.nodes.get(), drop)),
  });
}
```

A node cannot be dropped onto itself or into its own subtree, which is the
classic way to lose one. A closed folder that a drag rests `on` for
`autoExpandDelay` opens, by pointer or by keyboard, so a node can be carried
into a branch that was not on screen when the drag began; the delay keeps
merely passing over a folder from opening it.

**Keyboard dragging needs a door.** Space lifts a node only in
`selectionMode: 'none'`, where it has nothing else to do. A selectable tree has
to open the drag some other way, and `lift(id)` is that way — wire it to a
"Move" item in the row's context menu, which is both unambiguous and more
discoverable than an undocumented chord. Once lifted, the keyboard belongs to
[the drag keyboard map](#drag-keyboard).

**This layer has no tests yet.** The tree's own tests drive none of it:
nothing in the suite exercises `onDrop`, `lift`, the drop resolution or the
auto-expansion through a tree. The drag
primitive underneath is tested on its own, including collections nested the way
a tree nests them; what the tree adds on top — turning a flat drop into a
parent and an index — is not yet.

### Windowing a tree

```ts
interface TreeVirtualOptions {
  scroller: () => Element | null | undefined;   // the same element treeProps() is on
  container?: () => Element | null | undefined; // where contentProps() is
  itemSize: number | ((index: number) => number);
  measure?: boolean;
  gap?: number;
  overscan?: number | Partial<VirtualOverscan>; // default 2 each way
}
```

```ts
import { Component, Signal } from '@voltdev/core';
import { createTree, type TreeNode } from '@voltdev/primitives';

@Component({ selector: 'v-big-files', templateUrl: './big-files.html' })
export class BigFiles {
  tree = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  nodes = new Signal.State<TreeNode[]>([]);

  files = createTree({
    tree: () => this.tree.get(),
    nodes: () => this.nodes.get(),
    virtual: {
      scroller: () => this.tree.get(),
      container: () => this.content.get(),
      itemSize: 28,
    },
  });
}
```

```html
<div :ref="tree" :spread="files.treeProps()" style="block-size: 24rem; overflow: auto"
     :keydown="files.onKeyDown($event)"
     :click="files.onItemClick($event)"
     :focusin="files.onFocusIn($event)">
  <div :spread="files.sizerProps()">
    <div :ref="content" :spread="files.contentProps()">
      <div :for="row in files.rendered()" :key="row.id" :spread="files.itemProps(row)">
        { row.label }
      </div>
    </div>
  </div>
</div>
```

With `virtual` set, `rendered()` is the window and the tree element is also the
scroller. The sizer and content wrappers carry `role="none"`, because a
`tree` owns its `treeitem`s and a plain element between them breaks that
relationship. The tree keys measurements by node id, so opening a folder keeps
the sizes already known for the rows below it.

What a windowed tree can measure is what [the virtualizer](#long-lists) can,
with one consequence worth spelling out: a move between rows that are already
showing keeps the row count the same, and the virtualizer re-reads keys only
when the count changes. After applying such a drop in a *measured* windowed
tree, call `files.virtualizer?.remeasure()`, or rows of different heights keep
each other's sizes. It forgets every measurement and takes the rendered rows
again, so the rows off screen go back to their estimates. A fixed `itemSize` is
not affected.

Focus follows the window. Moving to a row that is not rendered scrolls to it
first and focuses it once it has been rendered, a frame later — unless the
reader has moved on in the meantime, in which case the request is dropped
rather than stealing focus back. The tab stop is always on a rendered row, so
Tab can never point at an element that does not exist.

## Reordering

```ts
function createDragDrop(options: DragDropOptions): DragDrop
```

Sorting within a collection, transfer between connected collections, and a
keyboard drag that is not an afterthought. Like the tree, it does not move
anything: `onDrop` reports where an item landed and reordering the model is
yours.

```ts
import { Component, Signal } from '@voltdev/core';
import { createDragDrop } from '@voltdev/primitives';

@Component({ selector: 'v-playlist', templateUrl: './playlist.html' })
export class Playlist {
  root = new Signal.State<Element | null>(null);
  tracks = new Signal.State(['Kite', 'Grace', 'Numb']);

  dnd = createDragDrop({
    root: () => this.root.get(),
    onDrop: ({ source, target }) => {
      const next = [...this.tracks.get()];
      const [moved] = next.splice(source.index, 1);
      next.splice(target.index, 0, moved);
      this.tracks.set(next);
    },
  });
}
```

```html
<div :ref="root"
     :pointerdown="dnd.onPointerDown($event)"
     :keydown="dnd.onKeyDown($event)">
  <ul :spread="dnd.containerProps({ id: 'tracks', label: 'Playlist' })">
    <li :for="track in tracks.get()" :key="track" tabindex="0"
        :spread="dnd.itemProps({ id: track })"
        :style="{ transform: dnd.transformFor(track) }">{ track }</li>
  </ul>
  <div class="sr-only" :spread="dnd.liveRegionProps()">{ dnd.announcement() }</div>
  <div class="sr-only" :spread="dnd.instructionsProps()">{ dnd.instructions() }</div>
</div>
```

The last two elements are for screen readers alone, and both must be hidden
the visual way — clipped, not `hidden` and not `display: none`, which would take
the announcement out of the accessibility tree along with the pixels. The live
region is assertive, unlike a toast's: a polite queue would read out where the
item was three arrow presses ago. Items are pointed at the instructions with
`aria-describedby` only if that element is in the document, so forgetting to
render it costs the description rather than leaving a dangling reference. The
check is made when the root element arrives and again only if the root changes,
so an instructions element rendered later — behind an `:if`, say — is never
picked up.

`itemProps` gives an item no `role` and no `tabindex`. The component it is
composed into owns both — a tree item, a grid row and a tab are all draggable
and none of them is a button — so a plain list has to make its items focusable
itself, as the `tabindex="0"` above does. It does set `draggable="false"`, on
items and handles alike, because otherwise the browser's own drag starts on any
image or link in the row and fights the pointer drag for the same gesture. For
styling, the dragged item carries `data-dragging`, the item a target is placed
against carries `data-drop-position` with `before`, `after` or `on`, and the
collection the target is in carries `data-drop-target`.

Four decisions carry the rest:

- **Pointer Events, not the HTML drag-and-drop API.** The native API cannot be
  styled, cannot be driven from the keyboard, and on touch does not exist. The
  cost is a hit test written here rather than supplied by the browser.
- **The keyboard is a mode, not a shortcut.** Space lifts, the arrows move,
  Space drops, Escape cancels, and every step is announced. A component that
  grows pointer dragging first never gets the keyboard afterwards.
- **Hit testing is geometry, not `elementFromPoint`.** Under the pointer is
  usually the dragged item itself, so the rects of the registered items are
  asked instead — which also lets a drop resolve to before, after or on.
- **Positions count every item, disabled ones included.** An index that
  skipped unavailable rows would not be an index into your array. Hidden items
  are another matter, below.

`onDrop` receives a `DropEvent` of `source`, `target` and `mode`. A
`DragSource` is `itemId`, `containerId`, `index` (where it was when the drag
began), `label`, and `element` — the element itself, which may be gone by the
time you apply the move. A `DropTarget` is `containerId`, `itemId` (`null` for
an empty collection), `position` and `index`.

`DropTarget.index` is the index the item will occupy once it is taken out of
where it was, so `splice(from, 1)` then `splice(index, 0, item)` is correct
with no adjustment. It is `-1` for an `on` drop, which inserts nothing.

**Both indices count what is in the DOM.** `source.index` and `target.index`
are positions among the rendered items of a collection, so they are indices
into your array only while every item is rendered. In a windowed list they
index the window. They do not even count the same things: `source.index`
counts every item element, while `target.index` leaves out items with no box —
`hidden` or `display: none` — and items inside a region `content-visibility`
is skipping. A list that hides some rows rather than removing them gets two
indices into two different arrays. In either case, resolve the move
from `source.itemId`, `target.itemId` and `target.position` instead, which is
what the tree does.

### Drag options

| Option | Default | Description |
|---|---|---|
| `root` | required | Contains every connected collection. Two lists under different roots never accept each other's items |
| `target` | — | A `Signal.State<DropTarget \| null>` to drive the drop target from outside |
| `orientation` | `'vertical'` | Which way the collections run, and so what before and after mean |
| `axis` | `'both'` | Constrains `offset()` to `'x'` or `'y'` |
| `boundary` | — | Keeps `offset()` inside this element's box |
| `activationDistance` | `4` | Pointer travel in px before a mouse or pen press becomes a drag |
| `touchDelay` | `250` | How long a touch is held before it becomes a drag, in ms |
| `touchTolerance` | `5` | How far a touch may drift during that delay before it counts as a scroll, in px |
| `autoScroll` | `true` | During a pointer drag, scroll the nearest scrollable ancestor near its edges |
| `autoScrollThreshold` | `48` | Distance from the edge, in px, where scrolling starts |
| `autoScrollSpeed` | `12` | Top speed, in px per frame, reached right at the edge |
| `onZoneRatio` | `0.25` | For items that take an `on` drop, the share at each end meaning before or after; the default leaves the middle half for `on` |
| `restoreFocus` | `'item'` | Where focus goes after: `'item'`, `'container'` or `'none'` |
| `labels` | — | `item` and `handle` role descriptions, `instructions`, and `lifted`, `moved`, `invalid`, `dropped`, `cancelled` |
| `canDrag(source, mode)` | — | Refuse to start |
| `canDrop(target, source)` | — | Refuse a target. Refused targets are skipped by the arrows, not stopped on |
| `onDragStart(source, mode)` `onDragOver(target, source)` `onDrop(event)` `onDragEnd(reason, source)` | — | `onDragOver` is given `null` when there is nowhere to drop. `onDragEnd` always runs, with `'drop'` or `'cancel'`, after `onDrop` when there was one |

A target set through `target` moves the indicator and decides the drop, but is
not announced, because only the caller knows whether the change is worth
interrupting a screen reader for.

`restoreFocus` finds the item again by id after your re-render, because the
element the drag started on may not have survived the move; if the item is
gone, focus falls back to its collection. It is applied only when the drag
began from the keyboard, or when focus was inside the item when a pointer
picked it up — moving focus after a mouse drag would take it away from wherever
the user is.

The default role descriptions are "draggable" and "drag handle", and the
default instructions and announcements are English sentences ("Picked up Kite.
Item 1 of 3 in Playlist."). They are not taken from the message catalogue, so
a localised application replaces them through `labels`. An empty string for
`item` or `handle` leaves the role description off. Each announcement is a
function of a `DragAnnouncement`: the `source` and `target`, `itemLabel`,
`targetLabel`, `containerLabel`, `position` (1-based, or 0 for an `on` drop)
and `total` (how many items the destination will hold, the dragged one
included). A collection's label falls back to its `aria-label`, then its id; an
item's to its text.

### Drag members

| Member | Description |
|---|---|
| `isDragging()` / `mode()` | Whether a drag is live, and whether by `'pointer'` or `'keyboard'` |
| `source()` / `target()` | What is being dragged, and where it would land now |
| `offset()` | Pointer travel since the drag began, after the axis lock and boundary |
| `transformFor(itemId)` | A `translate()` for the dragged item, `undefined` for every other |
| `indicator()` | The target with viewport geometry: a zero-thickness line, or the item's box for `on` |
| `announcement()` / `instructions()` | Live-region text, and the standing instructions |
| `lift(item)` / `drop()` / `cancel()` | Drive a drag by hand. `lift` takes an element or an item id and starts a *keyboard* drag, returning `false` when the item cannot be picked up; `drop()` with nowhere to go is a cancel |
| `onPointerDown(event)` / `onKeyDown(event)` | Bind once, on the root |
| `containerProps({ id, label?, dropDisabled? })` | A collection |
| `itemProps({ id, label?, disabled?, dropsOn? })` | An item |
| `handleProps({ label? })` | The part of an item that starts a pointer drag |
| `liveRegionProps()` / `instructionsProps()` | The two screen-reader elements |

Where an item contains a handle, only the handle starts a pointer drag; the
rest of the row stays free for selecting text, following a link and pressing
the buttons in it. A disabled item cannot be picked up but is still a place
others can be put, and is not marked `aria-disabled`, because it is still
selectable, expandable and linked.

A pointer drag starts from the primary button only. It captures the pointer,
so the drag survives leaving the handle; it stops the page selecting text until
it ends; and releasing where nothing can take the item is a cancel, not a
drop. A platform `pointercancel` — a system swipe — cancels too.

### Drag keyboard

The WAI-ARIA drag-and-drop practice.

| State | Key | Action |
|---|---|---|
| idle | Space | Lift the focused item |
| dragging | ArrowUp / ArrowDown | Previous / next position (vertical collections) |
| | ArrowLeft / ArrowRight | Previous / next collection (vertical collections), mirrored under `dir="rtl"` |
| | ArrowLeft / ArrowRight | Previous / next position (horizontal), mirrored under `dir="rtl"` |
| | ArrowUp / ArrowDown | Previous / next collection (horizontal) |
| | Home / End | First / last position in the collection |
| | Space, Enter | Drop |
| | Escape | Cancel, and put the item back |
| | Tab | Swallowed — a drag is finished, not left |

Space lifts, not Enter, because Enter already means "open this" on a tree node,
a row or a tab, and taking it would break the component this is composed into.

The positions a keyboard drag steps through are before each item, `on` each
item that takes it, and after the last. The arrows do not wrap: a drag that
jumps from the end of a list to its start moves the item much further than one
press has any right to. Moving to another collection enters it at the same
depth, and skips a collection with nowhere valid to put the item. A pointer
press anywhere during a keyboard drag cancels it, so reaching for the mouse
does not leave an item lifted.

While a drag is live the keys are taken on `window` in the capture phase and
stopped there. Dismissal listens on `document`, also capturing, so without this
an Escape meant to cancel a drag inside a dialog would close the dialog and
leave the drag running under it. During a pointer drag only Escape is taken;
the arrows belong to the pointer.

### What dragging does not cover

**Files dragged in from outside the page.** Those arrive only through the
native drag-and-drop API — no pointer enters the document — so a file drop
zone is a different mechanism wearing the same word, and needs an
`<input type="file">` beside it because a drop zone alone cannot be used from a
keyboard. Sorting the files once they are in is this.

**`touch-action` on the handle is yours.** `touch-action: none` makes a touch
drag start at once but takes scrolling away from that finger; leaving the
default keeps scrolling and relies on `touchDelay` to tell a press-and-hold
from a swipe. Neither is right for every list, so it is not decided here.

**Scrolling during a keyboard drag.** Auto-scroll follows the pointer and
nothing else. A keyboard drag steps its target through a list longer than its
scroller without bringing it into view, so the indicator can leave the screen;
where that matters, watch `target()` and scroll its item into view yourself.

**Auto-scrolling the page.** When no ancestor of the collection scrolls, the
page's own scroller is used instead, but its edges are read from the root
element's box rather than from the window. On a page taller than the window
that box runs off screen, so the page does not scroll when the pointer reaches
the bottom of the window. A long sortable list belongs inside a scroller of its
own, which is the case the tests cover.

## Where the reader is

Breadcrumb, pagination, stepper and navigation menu answer the same question —
where am I, and where else can I go — and share one rule that sets them apart
from the menu pattern: **a link's keyboard contract is Enter.** Where
an item is an `<a href>`, Enter is left to the browser, which follows the link
and fires the click that carries the component's own handling with it; Space is
left alone too, because on a link Space scrolls the page. A menu item *acts*; a
navigation item *goes somewhere*. Getting this wrong is the usual way a headless
navigation menu breaks middle-click, ⌘-click and Enter all at once.

All four return `NavigationProps`, and each puts its own handlers in them:
nothing on the trail, the pager, the stepper or the menubar needs a `:keydown`
of yours.

### Breadcrumb

```ts
function createBreadcrumb(options: BreadcrumbOptions): Breadcrumb
```

A trail that collapses its middle into a menu when it runs out of room.

```ts
import { Component, Signal } from '@voltdev/core';
import { createBreadcrumb } from '@voltdev/primitives';

@Component({ selector: 'v-trail', templateUrl: './trail.html' })
export class Trail {
  list = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  trigger = new Signal.State<Element | null>(null);
  trail = new Signal.State(['Home', 'Docs', 'Guides', 'Routing']);

  crumbs = createBreadcrumb({
    list: () => this.list.get(),
    count: () => this.trail.get().length,
    overflowContent: () => this.content.get(),
    overflowTrigger: () => this.trigger.get(),
  });
}
```

```html
<nav :spread="crumbs.navProps()">
  <ol :ref="list" :spread="crumbs.listProps()">
    <li :for="(name, i) in trail.get()" :key="name" :spread="crumbs.itemProps(i)">
      <a href="…" :spread="crumbs.linkProps(i)">{ name }</a>
    </li>
    <li :spread="crumbs.overflowProps()">
      <button :ref="trigger" :spread="crumbs.overflowTriggerProps()">…</button>
      <div :if="crumbs.menu.isPresent()" :ref="content"
           :spread="crumbs.overflowContentProps()">
        <a :for="i in crumbs.collapsed()" :key="i"
           :spread="crumbs.overflowLinkProps(i)">{ trail.get()[i] }</a>
      </div>
    </li>
  </ol>
</nav>
```

| Option | Default | Description |
|---|---|---|
| `list` | required | The `<ol>` holding the crumbs |
| `count` | required | How many crumbs, the root first and the current page last |
| `overflowContent` | — | The overflow menu's content element |
| `overflowTrigger` | — | Its trigger. Given, a press on it does not count as outside the menu |
| `itemsBefore` | `1` | Crumbs always kept at the start — the root |
| `itemsAfter` | `1` | Crumbs always kept at the end — the current page |
| `collapse` | `true` | Off, nothing is measured and nothing collapses |
| `labels` | — | `nav` (default "Breadcrumb"), `overflow` (default "Show the rest of the path") |
| `onCollapseChange` | — | The indices now in the overflow menu |

| Member | Description |
|---|---|
| `count()` `collapsed()` `isCollapsed(i)` `isCurrent(i)` | The trail's state |
| `menu` | The overflow menu, from [`createMenu`](./primitives-overlays), for `isOpen`, `isPresent` and `close` |
| `measure()` | Decide again what fits |
| `navProps()` `listProps()` `itemProps(i)` `linkProps(i)` `separatorProps()` | The trail |
| `overflowProps()` `overflowTriggerProps()` `overflowContentProps()` `overflowLinkProps(i)` | The overflow menu |

The last crumb's link gets `aria-current="page"`. The separators are
`aria-hidden`: read aloud they are "slash" between every pair of names. The
overflow trigger is named by `labels.overflow`, because its visible text is
usually an ellipsis, which is read out as "dot dot dot" or not at all.

**It measures rather than taking a number.** A fixed "collapse past four" is
wrong at both ends: four short crumbs fit on a phone and four long ones do not
fit on a desktop. So every crumb's width, the list's width and the trigger's
width are measured, and the fewest middle crumbs are collapsed that make the
rest fit — starting after the kept start, so the shallowest ancestors, the
ones furthest from where the reader is, go first.

What that costs:

- **Every crumb is rendered twice.** Collapsed crumbs are hidden, not unmounted
  — a crumb out of the document has no width, and its width is what decides
  whether it comes back — so the trail holds them all and the menu holds the
  collapsed ones again. `hidden` keeps the trail's copies out of the
  accessibility tree, so nothing is announced twice.
- **Each measure is a forced layout, outside the measure lane.** It runs from an
  ordinary effect on mount and from a `ResizeObserver` on the list, and it has
  to un-hide the collapsed crumbs to read them — a DOM write the read-only
  [measure phase](./reactivity#effects) does not allow. So it pays for a layout
  of its own, and in development the reads made from that effect — on mount,
  and whenever `count` changes — count towards `strayReads`. A test asserting
  `strayReads` is zero across those flushes will not hold on a page with a
  collapsing breadcrumb. The re-measures a resize triggers happen outside any
  flush and are not counted.
- **The list needs a width of its own.** It measures against the list's client
  width, so a list that shrink-wraps its crumbs changes size as they collapse,
  and the measurement chases itself.
- **Separators are assumed alike.** Whatever sits between crumbs is shared out
  evenly across the gaps; a trail with one enormous separator collapses one
  crumb too few.
- **With no layout, nothing changes.** On a server, in a test environment, or
  before the list is painted, the last measurement stands rather than reading
  zero and collapsing a trail that may fit.

The overflow slot belongs after the first `itemsBefore` crumbs, and one `:for`
cannot put it there. Split the trail into two loops, or leave the slot after
them and give it a CSS `order`. Call `measure()` by hand when something changes
width without resizing the list — a web font arriving, or the trail being
translated.

The crumbs themselves are ordinary links, each its own tab stop; there is no
roving focus in the trail. The overflow trigger is a menu button, and keeps the
menu button's keys:

| Where | Key | Action |
|---|---|---|
| trigger | Enter, Space, ArrowDown | Open the menu on its first link |
| | ArrowUp | Open it on its last link |
| menu | ArrowDown / ArrowUp | Next / previous link, wrapping |
| | Home / End | First / last link |
| | Printable characters | Typeahead |
| | Enter | Follow the link, and close |
| | Escape | Close, focus back on the trigger |
| | Tab | Close, and carry on out |

Enter and Space inside the menu are left to the browser, because the items are
links: Enter follows one and fires the click that closes the menu, and Space
scrolls.

### Pagination

```ts
function createPagination(options: PaginationOptions): Pagination
```

A pager over a known number of items.

```ts
import { Component, Signal } from '@voltdev/core';
import { createPagination } from '@voltdev/primitives';

@Component({ selector: 'v-results', templateUrl: './results.html' })
export class Results {
  list = new Signal.State<Element | null>(null);
  rows = new Signal.State<string[]>([]);

  pager = createPagination({
    list: () => this.list.get(),
    total: () => this.rows.get().length,
  });
}
```

```html
<nav :spread="pager.navProps()">
  <ul :ref="list" :spread="pager.listProps()">
    <li><button :spread="pager.controlProps('previous')">‹</button></li>
    <li :for="entry in pager.pages()" :key="entry.key">
      <span :if="entry.type === 'ellipsis'" :spread="pager.ellipsisProps()">…</span>
      <button :if="entry.type === 'page'" :spread="pager.pageProps(entry.page)">
        { entry.page }
      </button>
    </li>
    <li><button :spread="pager.controlProps('next')">›</button></li>
  </ul>
  <p :spread="pager.statusProps()">{ pager.announcement() }</p>
</nav>
```

| Option | Default | Description |
|---|---|---|
| `list` | required | The element holding the controls. They share one tab stop inside it |
| `total` | required | How many items there are to page through |
| `page` / `defaultPage` | `1` | Controlled or initial page, numbered from 1 |
| `pageSize` / `defaultPageSize` | `10` | Controlled or initial page size |
| `siblings` | `1` | Pages shown either side of the current one |
| `boundaries` | `1` | Pages pinned at each end of the row |
| `loop` | `false` | Arrow keys wrap past the ends of the row |
| `labels` | — | `nav` ("Pagination"), `page(n)` ("Page 3"), `first`, `previous`, `next`, `last` ("First page" and so on), `status(page, count)` ("Page 3 of 9") |
| `onPageChange` / `onPageSizeChange` | — | |

| Member | Description |
|---|---|
| `page()` `pageCount()` `pageSize()` | |
| `range()` | `{ start, end }` of the items on this page, from 1; both 0 when there are none |
| `pages()` | The row: `{ type: 'page', key, page }` or `{ type: 'ellipsis', key, from, to, count }` |
| `announcement()` | What the live region says |
| `goTo(page)` `first()` `previous()` `next()` `last()` | Clamped to the range |
| `setPageSize(size)` | Keeps the first item of the current page in view |
| `isDisabled(control)` | For `'first'`, `'previous'`, `'next'`, `'last'` |
| `navProps()` `listProps()` `pageProps(page)` `ellipsisProps()` `controlProps(control)` `statusProps()` | |

The whole row is one tab stop and the arrow keys move within it, because a
pager with fifteen page buttons is fifteen Tab presses to step over. Arrowing
moves focus without paging; Enter or Space on the focused button pages. Home
and End go to the ends of the *row* — the first and last usable controls —
rather than to the first and last page, because that is what they mean
everywhere else a group of controls roves. There is no typeahead: typing "2"
would have to page as well as move, which is two things at once.

| Key | Action |
|---|---|
| ArrowRight / ArrowLeft | Next / previous control, mirrored under `dir="rtl"`; disabled ones and the ellipsis are skipped |
| Home / End | First / last usable control in the row |
| Enter, Space | Press the focused button |

The controls at the ends of the range are `aria-disabled`, never natively
disabled, so they stay in the widget; a click on one is swallowed, which also
stops an `<a>` used as one from following its href. When focus leaves the row,
the tab stop goes back to the current page.

The controls are buttons. Where a crawler needs real URLs, render `<a href>`
instead: Enter and Space on it are left to the browser, and the click that
follows still sets the page here. Page buttons are named "Page 3" rather than
by their bare number, and the current page is marked `aria-current` rather than
named twice.

An ellipsis standing for exactly one page shows that page instead, since the
gap would take the same room and cost a click to find out what it hid. The
row's width changes as the current page moves, because the ellipses come and
go; pinning it would mean showing more siblings near the ends, which moves the
numbers under the pointer instead.

There is always at least one page. Nothing to show is "page 1 of 1" with an
empty range, because "page 1 of 0" is a sentence a screen reader reads out
exactly as written. A page given from outside that is past the end is clamped
rather than believed.

### Stepper

```ts
function createStepper(options: StepperOptions): Stepper
```

A sequence of steps with a status each, linear or not.

```ts
import { Component, Signal } from '@voltdev/core';
import { createStepper } from '@voltdev/primitives';

@Component({ selector: 'v-checkout', templateUrl: './checkout.html' })
export class Checkout {
  list = new Signal.State<Element | null>(null);
  postcodeInvalid = new Signal.State(false);
  steps = ['Basket', 'Delivery', 'Payment'];

  stepper = createStepper({
    list: () => this.list.get(),
    count: () => this.steps.length,
    error: (i) => i === 1 && this.postcodeInvalid.get(),
  });
}
```

```html
<nav :spread="stepper.navProps()">
  <ol :ref="list" :spread="stepper.listProps()">
    <li :for="(name, i) in steps" :key="name">
      <button :spread="stepper.stepProps(i)">
        { name } <span class="sr-only">{ stepper.statusLabel(i) }</span>
      </button>
    </li>
  </ol>
</nav>
<section :for="(name, i) in steps" :key="name" :spread="stepper.panelProps(i)">…</section>
```

| Option | Default | Description |
|---|---|---|
| `list` | required | The list holding the steps |
| `count` | required | How many steps |
| `value` / `defaultValue` | `0` | Controlled or initial step, indexed from 0 |
| `complete(i)` | the user has been past it | Whether a step's work is done |
| `error(i)` | `false` | Whether a step is in error |
| `disabled(i)` | `false` | Whether a step cannot be used at all |
| `linear` | `true` | Steps must be reached in order |
| `orientation` | `'horizontal'` | Which arrows move between steps |
| `loop` | `false` | Arrow keys wrap past the ends |
| `labels` | — | `nav` ("Progress"), `step(position, count)` ("Step 2 of 5"), `status(status)` ("Completed", "Current step", "Not started", "Error") |
| `onValueChange` | — | |

| Member | Description |
|---|---|
| `value()` `count()` `isFirst()` `isLast()` | |
| `status(i)` | `'complete'`, `'current'`, `'upcoming'` or `'error'` |
| `statusLabel(i)` / `stepLabel(i)` | "Completed", "Step 2 of 5" — for visually hidden text in the step |
| `isSelectable(i)` | Whether `goTo` would move there |
| `goTo(i)` | Move to a step, if it can be reached from here |
| `next()` / `previous()` | Skip disabled steps; not subject to `linear` |
| `navProps()` `listProps()` `stepProps(i)` `panelProps(i)` `separatorProps()` | |

**What is a status and what is a state.** The stepper owns one thing: which
step is current. Complete, error and disabled are the application's, because
only it knows whether the payment step validated — so they arrive as
accessors and are never mirrored here. An errored step reports `'error'` even
while it is current, because that is the thing worth saying about it.

**Linear navigation gates selection, not progress.** `goTo` refuses a step the
user has not earned — one beyond how far they have been, while any step before
it is incomplete. `next` and `previous` do not refuse, because they are what the
flow's own Continue button calls, and that button has already done the
validating. How far the user has been is tracked even when the step is set from
outside, so a flow driven by the URL still counts.

A step that cannot be selected yet stays focusable and is marked
`aria-disabled`, so a keyboard user can read ahead to see what is coming. A
step that `disabled(i)` rules out is different: the arrow keys skip it. The
current step carries `aria-current="step"`, and each panel is a `group` labelled by its
step, hidden unless current — a group rather than a region, because a landmark
per step would bury the page's real landmarks.

| Key | Action |
|---|---|
| ArrowRight / ArrowLeft | Next / previous step (horizontal), mirrored under `dir="rtl"`; disabled steps skipped |
| ArrowDown / ArrowUp | Next / previous step (vertical) |
| Home / End | First / last step that is not disabled |
| Enter, Space | Go to the focused step, if it is selectable; left to the browser on a link |

The arrows move focus, not the current step. Leaving the list hands the tab
stop back to the current step.

### Navigation menu

```ts
function createNavigationMenu(options: NavigationMenuOptions): NavigationMenu
```

A menubar of links, each of which may open a submenu of more links.

```ts
import { Component, Signal } from '@voltdev/core';
import { createNavigationMenu } from '@voltdev/primitives';

@Component({ selector: 'v-site-nav', templateUrl: './site-nav.html' })
export class SiteNav {
  bar = new Signal.State<Element | null>(null);
  docsPanel = new Signal.State<Element | null>(null);

  nav = createNavigationMenu({
    menubar: () => this.bar.get(),
    submenu: (key) => (key === 'docs' ? this.docsPanel.get() : null),
  });
}
```

```html
<nav>
  <ul :ref="bar" :spread="nav.menubarProps()">
    <li><a href="/pricing" :spread="nav.itemProps('pricing')">Pricing</a></li>
    <li>
      <button :spread="nav.triggerProps('docs')">Docs</button>
      <ul :if="nav.isOpen('docs')" :ref="docsPanel" :spread="nav.submenuProps('docs')">
        <li><a href="/docs/start" :spread="nav.submenuItemProps()">Get started</a></li>
      </ul>
    </li>
  </ul>
</nav>
```

| Option | Default | Description |
|---|---|---|
| `menubar` | required | The menubar element |
| `submenu(key)` | — | A submenu's content element, by the key of the item that owns it |
| `loop` | `true` | Arrow keys wrap past the ends, on the bar and in a submenu |
| `typeahead` | `true` | Typing letters jumps to a matching item |
| `labels` | — | `menubar` (default "Main navigation") |
| `onOpenChange(key)` | — | The open submenu's key, or `null` |
| `onSelect(item, value)` | — | A link was used; `value` is whatever its props were given |

| Member | Description |
|---|---|
| `openKey()` / `isOpen(key)` | The open submenu |
| `activeKey()` | The item holding the bar's tab stop |
| `open(key, focus?)` | `focus` is `'first'`, `'last'` or `'none'`, the default |
| `close(restoreFocus?)` | `restoreFocus` puts focus back on the trigger |
| `menubarProps()` | |
| `itemProps(key, { value?, current?, disabled? })` | A top-level link with no submenu |
| `triggerProps(key, { value?, current?, disabled? })` | A top-level item that opens one |
| `submenuProps(key)` / `submenuItemProps({ value?, current?, disabled? })` | The submenu and its links |

`submenu` must read a signal for every key, closed ones included. The effect
that wires dismissal and focus subscribes to whatever the accessor reads, and
one that returns `undefined` without reading anything never tells it the
submenu has rendered.

**How this differs from a menu.** A menu item runs a command, so Enter and
Space both activate it. A navigation item goes somewhere, so the browser
decides: Enter follows the link and Space does nothing. Only the submenu
triggers are buttons, and those take Space because that is a button's
contract. That is why this does not compose [`createMenu`](./primitives-overlays), which
would bring the wrong contract with it — and why an open submenu has no focus
trap: Left and Right have to carry focus out of it and along the bar, which is
the move a trap exists to prevent.

**The cost of `role="menubar"`.** Its items are announced as menu items rather
than links, which is the price of the bar being one tab stop instead of twenty.
A site whose navigation is a handful of links is better served by a plain list
of them, where Tab reaches each and each is announced as what it is.

The bar is horizontal, and there is no option for anything else. A menubar is
horizontal by definition in ARIA, and a column of links down the side of a page
is a different pattern with a different keyboard map — one this would only half
implement. Submenus open on a press, never on hover: nothing here listens for
the pointer passing over.

| Where | Key | Action |
|---|---|---|
| bar | ArrowRight / ArrowLeft | Next / previous item, wrapping, mirrored under `dir="rtl"`. Carries an open submenu along |
| | ArrowDown / ArrowUp | On a trigger, open its submenu on the first / last item; on a link, nothing |
| | Enter | Follow a link, or open a submenu |
| | Space | Open a submenu; nothing on a link |
| | Home / End | First / last item |
| | Printable characters | Typeahead |
| | Tab | Close any open submenu, and carry on out |
| submenu | ArrowDown / ArrowUp | Next / previous item, skipping disabled ones |
| | Home / End | First / last item |
| | Printable characters | Typeahead, unless `typeahead` is off |
| | ArrowRight / ArrowLeft | The next / previous bar item, opening its submenu if it has one |
| | Enter | Follow the link |
| | Escape | Close, focus back on the trigger |
| | Tab | Close, focus back on the trigger, and carry on out |

Moving along a closed bar moves focus and nothing else: opening menus as focus
passes over them is what makes a menubar unusable from a keyboard. A key with
Ctrl, Alt or Meta held passes through, so ⌘-Enter still opens a link in a new
tab. A press outside an open submenu closes it without taking focus back from
whatever was pressed.

## Layout

Most of `layout.ts` computes styles rather than behaviour, which is unusual for
a headless library and worth saying plainly. `stack`, `flex`, `grid`,
`container` and `center` are pure functions, and `createAspectRatio` holds a
ratio and nothing more; none of them registers an effect or listens to
anything. Two do carry real interaction — the scroll area and the resizable
panel group — and both hand you their handlers to bind.

### Scroll area

```ts
function createScrollArea(options: ScrollAreaOptions): ScrollArea
```

A scroll area with scrollbars of your own. The rule it is built around: **the
viewport keeps scrolling itself.** The usual way to fake a scrollbar —
`overflow: hidden` plus a transform driven from wheel events — breaks the
wheel's acceleration curve, touch momentum, trackpad rubber-banding, keyboard
scrolling, scroll anchoring, find-in-page and every `scrollIntoView` in the
application. So native scrolling stays exactly as it is, the platform's bars
are hidden with `scrollbar-width: none`, and this reads the resulting offsets
back through a passive `scroll` listener. It never sets `overflow` or
`touch-action` on the viewport; making it scroll is your stylesheet's job.

```ts
import { Component, Signal } from '@voltdev/core';
import { createScrollArea } from '@voltdev/primitives';

@Component({ selector: 'v-log-view', templateUrl: './log-view.html' })
export class LogView {
  viewport = new Signal.State<Element | null>(null);
  bar = new Signal.State<Element | null>(null);

  area = createScrollArea({
    viewport: () => this.viewport.get(),
    verticalScrollbar: () => this.bar.get(),
    labels: { viewport: 'Build log' },
  });
}
```

```html
<div :ref="viewport" :spread="area.viewportProps()">…</div>
<div :if="area.vertical.overflows()" :ref="bar"
     :spread="area.vertical.scrollbarProps()"
     :pointerdown="area.vertical.onTrackPointerDown($event)"
     :keydown="area.vertical.onKeyDown($event)">
  <div :spread="area.vertical.thumbProps()"
       :pointerdown="area.vertical.onThumbPointerDown($event)"></div>
</div>
```

The thumb's length and position are emitted as custom properties rather than
as sizes, so positioning stays the stylesheet's business:

```css
.thumb {
  block-size: var(--volt-scroll-thumb-size);
  inset-block-start: var(--volt-scroll-thumb-offset);
}
```

They are complete CSS expressions — the minimum length is a `max()` of pixels
and a percentage — whose percentages resolve against the track at layout time,
so the thumb stays right when the track changes size without anything here
measuring it.

| Option | Default | Description |
|---|---|---|
| `viewport` | required | The element that scrolls |
| `content` | — | The content inside it, watched for growth. Without it, growth is noticed on the next scroll, resize or `measure()` |
| `verticalScrollbar` / `horizontalScrollbar` | the thumb's parent | The tracks, for the arithmetic a drag needs |
| `minThumbSize` | `20` | Shortest the thumb gets, in px |
| `step` | `40` | How far an arrow press scrolls, in px |
| `pageOverlap` | `40` | How much of the current view a page press keeps, in px |
| `trackPointer` | `'page'` | A press on the track pages once towards the pointer — it does not repeat while held, as a native track does — or `'jump'`s there with the thumb centred |
| `hideNativeScrollbar` | `true` | Sets `scrollbar-width: none` on the viewport |
| `hideDelay` | `600` | How long after the last scroll `isScrolling()` stays true, in ms |
| `focusableScrollbars` | `false` | Put the scrollbars in the tab order |
| `dir` | read from the DOM | `'ltr'` or `'rtl'` |
| `labels` | — | `verticalScrollbar` ("Vertical scrollbar"), `horizontalScrollbar` ("Horizontal scrollbar"), `viewport` and `scrollPosition(percent, axis)` (no default for either) |
| `onScroll({ top, left })` | — | Once per change, whether the scroll was the reader's or yours. `left` is the raw `scrollLeft`, negative in a right-to-left document; `horizontal.offset()` is the logical one |

| Member | Description |
|---|---|
| `vertical` / `horizontal` | One `ScrollAreaAxis` each |
| `overflows()` / `hasCorner()` | Whether either axis overflows; whether both do |
| `isScrolling()` / `isDragging()` | For overlay bars that show while in use |
| `measure()` | Re-read the geometry, for content that changed without resizing |
| `viewportProps()` / `cornerProps()` | |

| Axis member | Description |
|---|---|
| `overflows()` | Whether there is anything to scroll on this axis |
| `viewportSize()` / `scrollSize()` / `range()` | Visible length, content length, how far it can travel |
| `offset()` / `progress()` | Distance from the start, and the same as 0 to 1 |
| `thumbSize()` | Thumb length as a fraction of the track, before the minimum |
| `scrollTo(offset)` / `scrollBy(delta)` | Clamped |
| `onKeyDown` `onThumbPointerDown` `onTrackPointerDown` | Bind on the scrollbar and thumb |
| `scrollbarProps()` / `thumbProps()` | |

`offset()` counts up from the inline start in both writing directions. In a
right-to-left document `scrollLeft` starts at zero and runs negative, so code
written against it gets the sign wrong exactly once, in the language nobody
tested in.

The viewport gets `tabindex="0"` only while it has something to scroll: WCAG
asks for the tab stop exactly then, and a scroll container that cannot scroll
is a stop that does nothing. Give it `labels.viewport` and it becomes a named
`group` — not a `region`, because a page of scrollable panels should not be a
page of landmarks. The scrollbars stay out of the tab order by default, because
the focused viewport already scrolls with the platform's own keys; their key
map below only matters with `focusableScrollbars` on, which is for an
application that replaces scrolling entirely.

| Key, on a focused scrollbar | Action |
|---|---|
| ArrowDown / ArrowUp | `step` forward / back (vertical) |
| ArrowRight / ArrowLeft | `step` forward / back (horizontal), mirrored under `dir="rtl"` |
| PageDown / PageUp | A viewport less `pageOverlap`, never less than `step` |
| Home / End | The start / the end |
| Space / Shift + Space | Page down / up (vertical only) |

A page press never moves a whole viewport: a page that scrolls by exactly its
own height leaves no line in common between the two views, and no way to tell
whether anything was skipped. A thumb drag captures the pointer, maps its
travel onto the scroll range from where the drag began, and puts everything
back on Escape. The thumb's props carry `touch-action: none`, scoped to the
thumb, so a touch that starts there drags it; the viewport keeps its default,
or touch scrolling would die with it.

The first measurement is taken from `measureEffect`; later ones come from
scroll and resize events, which happen outside any flush, and from your own
calls to `scrollTo`, `scrollBy` and `measure`, which read the geometry wherever
you make them.

### Resizable panels

```ts
function createResizable(options: ResizableOptions): Resizable
```

The WAI-ARIA window splitter, generalised to any number of panels, in either
axis, nestable, with per-panel limits, collapse and persisted sizes.

```ts
import { Component, Signal } from '@voltdev/core';
import { createResizable } from '@voltdev/primitives';

@Component({ selector: 'v-workspace', templateUrl: './workspace.html' })
export class Workspace {
  group = new Signal.State<Element | null>(null);

  split = createResizable({
    group: () => this.group.get(),
    panels: [{ defaultSize: 25, min: 15, collapsible: true }, { min: 40 }],
    storageKey: 'workspace.split',
  });
}
```

```html
<div class="workspace" :ref="group" :spread="split.groupProps()">
  <div class="panel" :spread="split.panelProps(0)">…</div>
  <div class="handle" :spread="split.handleProps(0, { label: 'Resize sidebar' })"
       :keydown="split.onHandleKeyDown(0, $event)"
       :pointerdown="split.onHandlePointerDown(0, $event)"
       :dblclick="split.onHandleDoubleClick(0, $event)"></div>
  <div class="panel" :spread="split.panelProps(1)">…</div>
</div>
```

**Sizes are percentages of the group**, held as an array that always sums to
100. That is what lets a group survive a window resize without measuring
anything, and it is what `aria-valuenow` wants to say. The cost is that a limit
cannot be written in pixels: "this sidebar never goes below 200px" has to
become a percentage the application computes for the width it has.

**Nothing is sized until your stylesheet says so.** Each panel gets its share
as `--volt-resizable-size` ("25%"), and the group gets
`--volt-resizable-template`, every share with an `auto` track between each pair
("25% auto 75%"). The handles take room of their own on top of shares that
already add up to 100%, so the group overflows by their width unless something
gives. In a flex group, let the panels shrink: flex shrinking is weighted by the
basis, so the proportions survive.

```css
.workspace { display: flex; }
.panel     { flex: 0 1 var(--volt-resizable-size); min-inline-size: 0; }
.handle    { flex: none; inline-size: 6px; }
```

A grid group written as `grid-template-columns: var(--volt-resizable-template)`
overflows by the handle widths, unless the handles take no width of their own —
a zero-width track with the visible grip drawn over the edge.

The one style the handles do carry is `touch-action: none`, because without it
the browser takes a touch on the handle as the start of a scroll and the drag
never gets a second event.

| Option | Default | Description |
|---|---|---|
| `panels` | required | One entry per panel: `min` (0), `max` (100), `defaultSize`, `collapsible`, `collapsedSize` (0). Fixed for the life of the group |
| `group` | required | The element the panels sit in — measured to turn a drag into a share |
| `orientation` | `'horizontal'` | The group's axis; horizontal is a row |
| `sizes` | — | A `Signal.State<number[]>` to control the sizes |
| `step` / `largeStep` | `1` / `10` | Percentage points per arrow press, and per shifted press |
| `collapseThreshold` | half the gap between `min` and `collapsedSize` | How far past its minimum a collapsible panel is pushed before it snaps shut |
| `storageKey` | — | Remember the sizes under this key. Nothing is stored without one |
| `storage` | `localStorage` | Anything with `getItem` and `setItem` |
| `dir` | read from the DOM | |
| `labels` | — | `handle(index)` (default "Resize panel N"), `valueText(size, index)` (default "N percent") |
| `onSizesChange(sizes)` `onCollapse(index)` `onExpand(index)` | — | |

Panels without a `defaultSize` split whatever the declared ones leave. Sizes
handed in through `setSizes` or a stored layout are scaled to 100 and clamped
into each panel's limits, so `[5, 5]` means two equal halves rather than
`[95, 5]`.

| Member | Description |
|---|---|
| `orientation()` / `separatorOrientation()` | The group's axis, and the perpendicular each separator line runs along |
| `sizes()` / `size(i)` / `setSizes(sizes)` | |
| `isCollapsed(i)` `collapse(i)` `expand(i)` `toggleCollapse(i)` | |
| `resize(i, delta)` | Move the boundary after panel `i` by `delta` points |
| `resizeTo(i, size)` | Set one panel, taking the difference from its neighbours |
| `reset()` | Back to the declared defaults |
| `isDragging()` / `activeHandle()` | |
| `groupProps()` `panelProps(i)` `handleProps(i, { label?, labelledBy?, disabled? })` | Handle `i` is the boundary between panels `i` and `i + 1` |
| `onHandleKeyDown(i, e)` `onHandlePointerDown(i, e)` `onHandleDoubleClick(i, e)` | Bound per handle |

**`aria-orientation` describes the line, not the movement** — the rule that
makes `<hr>` horizontal. A horizontal group, whose panels sit side by side, is
divided by *vertical* separators, and Left and Right move them.
`separatorOrientation()` gives the same answer when you need it.

When a boundary runs out of room it takes from the panels further along, in
order of nearness, so a three-panel group whose middle panel is at its minimum
keeps moving rather than stopping dead. Pushed far enough past a collapsible
panel's minimum, the panel snaps shut; pulled far enough back, it opens again.
A panel is never left between its collapsed size and its minimum.

Nesting works because nothing is delegated from the group: each handle carries
its own handlers, so an event on an inner handle bubbles out past the outer
group with nothing there to act on it.

| Key, on a handle | Action |
|---|---|
| ArrowRight / ArrowLeft | Grow / shrink the panel before a vertical separator by `step`, mirrored under `dir="rtl"` |
| ArrowDown / ArrowUp | The same for a horizontal separator |
| Shift + arrow | By `largeStep` |
| Home / End | Take the panel before the handle to its own `min` / `max`, as far as the other panels' limits allow |
| Enter | Collapse or expand — the panel before the handle if it is collapsible, else the one after |

A double click collapses and expands the same panel Enter does, so the two ways
of asking cannot disagree. A pointer drag is measured from where it began, so
pushing into a limit and back out does not lose ground, and Escape puts the
whole gesture back. A drag on a group with no measurable size is refused, which
leaves the keyboard working. A disabled handle stays in the tab order,
announced as unavailable, and refuses keys, drags and double clicks alike.

**What persistence does and does not keep.** With `storageKey`, sizes are
written whenever they change and read back when the group is created. A stored
layout of the wrong length, or anything that is not a list of sizes, is
ignored rather than mapped onto the wrong panels, and storage that refuses to
answer is survived. Three limits:

- The size a collapsed panel will expand back to is not stored, so after a
  reload an expand goes to the panel's minimum.
- Stored sizes are read only when the group owns its state. Pass a `sizes`
  signal and they are still written under the key but never read back; restore
  them into your signal yourself.
- Node has no `localStorage` by default, so a server-rendered group is written
  at its defaults and the stored sizes arrive with the client. The default is
  whatever global `localStorage` exists, though: on a server runtime that
  provides one, every request would read the same stored layout, so pass
  `storage` explicitly there.

### Aspect ratio

```ts
function createAspectRatio(options?: AspectRatioOptions): AspectRatio
```

A box that keeps its shape. `aspect-ratio` is the whole implementation: the
padding-top trick it replaces needed a wrapper and absolute positioning and
could only derive height from width, where `aspect-ratio` works from whichever
dimension is constrained.

```ts
import { Component, Signal } from '@voltdev/core';
import { createAspectRatio, type AspectRatioValue } from '@voltdev/primitives';

@Component({ selector: 'v-player', templateUrl: './player.html' })
export class Player {
  shape = new Signal.State<AspectRatioValue>([16, 9]);
  frame = createAspectRatio({ ratio: this.shape, fit: 'contain' });
}
```

```html
<div :spread="frame.rootProps()">
  <video :spread="frame.contentProps()" src="…"></video>
</div>
```

| Option | Default | Description |
|---|---|---|
| `ratio` / `defaultRatio` | `1` | Controlled or initial: `[16, 9]` as a pair, or `1.7778` as a number |
| `fit` | `'cover'` | `object-fit` for the content |
| `onRatioChange` | — | |

| Member | Description |
|---|---|
| `ratio()` / `setRatio(ratio)` | |
| `value()` | The ratio as one number, or `null` when it cannot be used |
| `style()` | The `aspect-ratio` declaration alone, for `:style` |
| `rootProps()` | The box |
| `contentProps()` | The `<img>`, `<video>` or `<iframe>` filling it: block, full size, `object-fit` |

Pass the pair. `16 / 9` evaluated in JavaScript is a repeating decimal, and
rounding it puts a fraction of a pixel of letterboxing into every video on the
page; given the pair, the browser divides at full precision.

A ratio of zero, a negative, `NaN`, `Infinity` or a pair with a zero
denominator becomes `aspect-ratio: auto`, and `value()` returns `null`. Each of
those would otherwise be a box with no height and nothing on the page to say
why; refusing them leaves the box sized by its content, which is at least
visible.

### Spacing helpers

```ts
import { Component } from '@voltdev/core';
import { container, grid, stack } from '@voltdev/primitives';

@Component({ selector: 'v-catalogue', templateUrl: './catalogue.html' })
export class Catalogue {
  page = container({ size: 'lg', padding: 4 });
  cards = grid({ minColumn: 'card', gap: 3 });
  form = stack({ gap: 2 });
}
```

```html
<main :style="page">
  <div :style="cards">…</div>
  <form :style="form">…</form>
</main>
```

The styles are fields rather than module constants because a template's free
identifiers resolve against the component: a `const` beside the class is not
something the template can see.

| Function | Returns a style object for |
|---|---|
| `flex(options?)` | A flex box; `direction` and `wrap` as given |
| `stack(options?)` | A flex column with an even gap |
| `grid(options?)` | A grid of `columns`, `rows`, or as many columns as fit at `minColumn` |
| `container(options?)` | A centred column of maximum inline size `size`, padded inline |
| `center(options?)` | Children centred on both axes, optionally in a `column` with a `minBlockSize` |
| `spaceVar(token, prefix?)` / `sizeVar(token, prefix?)` | The `var()` a token refers to |

`flex`, `stack` and `grid` share `gap`, `rowGap`, `columnGap`, `padding`,
`paddingInline`, `paddingBlock`, `align`, `justify` (`'between'`, `'around'` and
`'evenly'` are the `space-` keywords), `inline` and `spacePrefix`. Padding is
written with logical properties, so it mirrors under `dir="rtl"`. What comes
back is frozen, because one object is often handed to several elements.

They take tokens, never lengths. `gap: 3` becomes `var(--volt-space-3)` and
`size: 'lg'` becomes `var(--volt-size-lg)`, because a theme cannot restyle
`gap: 12px` but can redefine a custom property. The cost is that a one-off value
has nowhere to go here and belongs in your own stylesheet. No fallback is
written into the `var()`: a token the theme has not defined makes the
declaration invalid, the property falls back to its initial value, and the
mistake is visible rather than silently `0`.

A gap belongs on the parent rather than as a margin on each child, which is
why `stack` exists: margins collapse, do not follow reordering, and leave a
stray one at the end. `grid({ minColumn })` writes the auto-fitting track list
with its floor wrapped in `min(…, 100%)`, so a floor wider than the viewport
does not scroll the row sideways; it takes precedence over `columns`.
`container()` sets `box-sizing: border-box`, so the padding comes out of the
maximum instead of being added to it.

`visuallyHidden` is in [display](./primitives-display), not here.

## Exported constants

The attributes the props objects write, and the custom properties they set, are
exported under names, for stylesheets and tests that want to find an element
without spelling the string.

| Constant | Value | Marks |
|---|---|---|
| `TAB_VALUE_ATTRIBUTE` | `data-volt-tab-value` | A tab, carrying its value |
| `VIRTUAL_ITEM_ATTRIBUTE` | `data-volt-virtual-index` | A rendered item, carrying its index; what measurement finds |
| `TREE_ITEM_ATTRIBUTE` | `data-volt-tree-item` | A tree node, carrying its id |
| `TREE_TOGGLE_ATTRIBUTE` | `data-volt-tree-toggle` | The twisty inside a node |
| `TREE_CHECKBOX_ATTRIBUTE` | `data-volt-tree-checkbox` | The checkbox inside a node |
| `DRAG_CONTAINER_ATTRIBUTE` | `data-volt-drag-container` | A collection, carrying its id |
| `DRAG_ITEM_ATTRIBUTE` | `data-volt-drag-item` | A draggable item, carrying its id |
| `DRAG_HANDLE_ATTRIBUTE` | `data-volt-drag-handle` | The part of an item that starts a pointer drag |
| `CRUMB_ATTRIBUTE` | `data-volt-crumb` | A crumb, carrying its position |
| `CRUMB_OVERFLOW_ATTRIBUTE` | `data-volt-crumb-overflow` | The slot the overflow trigger sits in |
| `PAGINATION_ITEM_ATTRIBUTE` | `data-volt-page` | A page button or a first / previous / next / last control |
| `STEP_ATTRIBUTE` | `data-volt-step` | A step, carrying its index |
| `NAV_ITEM_ATTRIBUTE` | `data-volt-nav-item` | A top-level menubar item, carrying its key |
| `NAV_SUBITEM_ATTRIBUTE` | `data-volt-nav-subitem` | An item inside a submenu |
| `SCROLL_THUMB_ATTRIBUTE` | `data-volt-scroll-thumb` | A scrollbar thumb |
| `SCROLL_THUMB_SIZE_PROPERTY` | `--volt-scroll-thumb-size` | The thumb's length, minimum applied |
| `SCROLL_THUMB_OFFSET_PROPERTY` | `--volt-scroll-thumb-offset` | The thumb's distance from the track's start |
| `RESIZABLE_HANDLE_ATTRIBUTE` | `data-volt-resizable-handle` | A splitter handle, carrying its index |
| `RESIZABLE_SIZE_PROPERTY` | `--volt-resizable-size` | One panel's share, as a percentage |
| `RESIZABLE_TEMPLATE_PROPERTY` | `--volt-resizable-template` | Every share, with an `auto` track between each pair |
| `SPACE_PREFIX` / `SIZE_PREFIX` | `--volt-space-` / `--volt-size-` | What a spacing or size token is appended to |

## Exported types

Every option, member and value type above is exported under the name the
signatures use, for code that builds options or holds a primitive in a field of
its own type.

| Primitive | Types |
|---|---|
| Tabs | `TabsOptions` `Tabs` `TabOptions` `TabsOrientation` `TabsActivation` `TabsProps` `TabsPropValue` |
| Virtualizer | `VirtualizerOptions` `Virtualizer` `VirtualItem` `VirtualRange` `VirtualAxis` `VirtualAlignment` `VirtualCounting` `VirtualOverscan` `VirtualizerLabels` `VirtualScrollOptions` `VirtualScrollToIndexOptions` `VirtualizerProps` `VirtualizerPropValue` |
| Tree | `TreeOptions` `Tree` `TreeNode` `TreeRow` `TreeDrop` `TreeSelectionMode` `TreeSelectOptions` `TreeVirtualOptions` `TreeLabels` `TreeProps` `TreePropValue` |
| Drag and drop | `DragDropOptions` `DragDrop` `DragSource` `DropTarget` `DropIndicator` `DropEvent` `DropPosition` `DragMode` `DragOrientation` `DragAxis` `DragEndReason` `DragFocusTarget` `DragPoint` `DragAnnouncement` `DragDropLabels` `DragContainerOptions` `DragItemOptions` `DragHandleOptions` `DragDropProps` |
| Navigation | `NavigationProps` `NavigationPropValue` `BreadcrumbOptions` `Breadcrumb` `BreadcrumbLabels` `PaginationOptions` `Pagination` `PaginationControl` `PaginationEntry` `PaginationLabels` `StepperOptions` `Stepper` `StepStatus` `StepperLabels` `NavigationMenuOptions` `NavigationMenu` `NavigationItemOptions` `NavigationOpenFocus` `NavigationMenuLabels` |
| Layout | `LayoutStyle` `LayoutProps` `LayoutPropValue` `LayoutAxis` `SpaceToken` `SizeToken` `LayoutAlign` `LayoutJustify` `BoxOptions` `FlexOptions` `StackOptions` `GridOptions` `ContainerOptions` `CenterOptions` `AspectRatioOptions` `AspectRatio` `AspectRatioValue` `AspectRatioFit` `ScrollAreaOptions` `ScrollArea` `ScrollAreaAxis` `ScrollAreaAxisName` `ScrollAreaLabels` `ResizableOptions` `Resizable` `ResizablePanel` `ResizableHandleOptions` `ResizableLabels` `ResizableStorage` |
