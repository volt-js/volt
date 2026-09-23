# Data grid

`@voltdev/grid` is a virtualized, keyboard-navigable data grid. It is headless:
it owns the geometry, the keyboard map and the ARIA, and hands back prop
objects to spread onto markup you write. Nothing in it renders, and nothing in
it has an opinion about how a cell looks. There is no styled grid in
[`@voltdev/ui`](./ui) and no example application using this one, so the markup
and the stylesheet are yours.

::: warning Not on npm yet
`@voltdev/grid` has not been released — see
[what is on npm](../guide/getting-started#what-is-on-npm). Everything on this
page works from a checkout of the Volt repository.
:::

```ts
import { createGrid, createGrouping, createCellEditing } from '@voltdev/grid';
```

Three entry points, and the split is the design. `createGrid` is the grid:
rows, columns, both axes windowed, sorting, filtering and two kinds of
selection. `createGrouping` and `createCellEditing` are layers *over* it rather
than options *of* it — grouping hands the grid a longer collection with the
group headers in it, and editing hands you a change and never writes a row.
Both decisions have consequences you will meet, and each section below says
which.

The package is `0.1.0-alpha.1`. [What is not built](#what-is-not-built) is listed
at the end.

## Why a grid belongs here

A cell owns its own binding. The value a cell shows is read by one effect, and
when that value came from a signal, writing it invalidates that effect and no
other: one text node changes, the cell element is not replaced, the row around
it is not rebuilt, and the other cells on screen do not re-read their values.
With nothing sorted or filtered, nothing in `createGrid` reads a cell's value —
`cellValue` is called from your template and nowhere else — which is what keeps
that true.

It survives sorting and filtering, because both are derived views over the rows
you passed in rather than anything the grid stores or reorders. What that
costs: with no sort and no filter the grid subscribes to no cell value at all,
but once either is active it reads the sorted or filtered value of *every*
row, and a change to one of those re-sorts or re-filters the whole view. A live
view cannot avoid that — a value that changes what a filter matches has to
re-filter, or the grid is showing a row that no longer qualifies.

## Setting one up

```ts
createGrid<T>(options: GridOptions<T>): Grid<T>
```

A grid needs three elements and two lists.

```ts
import { Component, Signal } from '@voltdev/core';
import { createGrid, type GridColumn } from '@voltdev/grid';

interface Person {
  id: number;
  name: string;
  department: string;
  salary: number;
}

const COLUMNS: GridColumn<Person>[] = [
  { id: 'name', header: 'Name', value: (p) => p.name },
  { id: 'department', header: 'Department', value: (p) => p.department },
  { id: 'salary', header: 'Salary', value: (p) => p.salary, width: 120 },
];

@Component({ selector: 'v-people', templateUrl: './people.html' })
export class People {
  grid = new Signal.State<Element | null>(null);
  scroller = new Signal.State<Element | null>(null);
  container = new Signal.State<Element | null>(null);
  people = new Signal.State<Person[]>([]);

  table = createGrid<Person>({
    grid: () => this.grid.get(),
    scroller: () => this.scroller.get(),
    container: () => this.container.get(),
    rows: () => this.people.get(),
    columns: () => COLUMNS,
    getRowKey: (person) => person.id,
    label: 'People',
  });
}
```

```html
<!-- people.html -->
<div class="people" :ref="grid" :spread="table.gridProps()"
     :keydown="table.onKeyDown($event)"
     :focusin="table.onFocusIn($event)">
  <div :spread="table.headerProps()">
    <div :spread="table.headerRowProps()">
      <div :for="col in table.columns()" :key="col.key"
           :spread="table.headerCellProps(col)"
           :click="table.onHeaderClick($event)">{ col.column.header }
        <span :spread="table.resizerProps(col)"
              :pointerdown="table.onResizePointerDown($event)"></span>
      </div>
    </div>
  </div>
  <div class="people-body" :ref="scroller" :spread="table.bodyProps()">
    <div :spread="table.sizerProps()">
      <div :ref="container" :spread="table.containerProps()">
        <div :for="row in table.rows()" :key="row.key" :spread="table.rowProps(row)">
          <div :for="col in table.columns()" :key="col.key"
               :spread="table.cellProps(row, col)"
               :click="table.onCellClick($event)">{ table.cellValue(row, col) }</div>
        </div>
      </div>
    </div>
  </div>
</div>
```

The three elements are the geometry the shared
[`createVirtualizer`](./primitives-collections#long-lists) expects: a scroller, an empty
sizer as long as the whole collection, and a container moved by one transform.
Both axes are windowed by it — one virtualizer per axis, neither a copy — and a
grid scrolls one box in two directions, so the two share all three elements.
The sizer is as tall as every row and as wide as every column; the container
carries a two-dimensional translate. The header sits outside the scroller so
vertical scrolling never moves it, and is kept in step horizontally by a
transform of its own.

Call `createGrid` where a component's fields are initialised, for two reasons.
It reads the nearest locale when it is called — see [Sorting](#sorting) — so it
has to run inside the scope a `createLocaleProvider` would reach; with no
provider it uses the document's `lang`, then the browser's. And it creates
effects and registers a cleanup that ends a resize drag in flight, which are
disposed with the component that owns them; called outside any component they
are never disposed, and development builds warn. The shorter examples further
down leave the component out to stay short, not because it is optional.

### The stylesheet it needs

The arithmetic promises that cells sit in a row, in order, at the widths it
gives them, and that rows sit in the container at the height it gives them. The
props carry those sizes as inline styles; the stylesheet has to leave them
alone and supply the rest:

```css
.people-body { height: 480px; overflow: auto; }   /* the scroller: bounded, and scrolling */
.people [role='row'] { display: flex; }
.people [role='gridcell'],
.people [role='columnheader'] { box-sizing: border-box; flex: none; }
```

Each line is load-bearing. A scroller with no bounded height never scrolls, so
the window is the whole collection. A cell without `border-box` is its width
*plus* its padding, and the columns drift out of step with the header. And
without `flex: none` the header row — which is only as wide as the grid, while
the columns it renders, overscan included, are wider — shrinks its cells to fit,
so the header stops lining up with the body the moment there are more columns
than fit. The body rows do not shrink, because they sit in a sizer as wide as
every column; that is why the fault shows in the header alone.

The scroller is given `overflow-anchor: none` by the grid. Browser scroll
anchoring and virtualization both try to hold the view still as content above
it changes, by different amounts, and the rows drift when both do.

### `GridOptions`

| Option | Default | Description |
|---|---|---|
| `grid` | required | The element carrying `role="grid"` |
| `scroller` | required | The element that scrolls, both ways; holds the data rows |
| `container` | required | The element `containerProps()` goes on |
| `rows` | required | The rows, in order |
| `columns` | required | The columns, in order |
| `rowHeight` | `32` | Every row is exactly this tall, in px |
| `getRowKey` | the row's index in the view | `(row, index) => string \| number` — what identifies a row |
| `overscan` | `2` each way | Rows and columns rendered outside the viewport: a number, or `{ before, after }` with either left out — the same for both axes |
| `label` | — | The grid's accessible name |
| `activeCell` | owned | A `Signal.State<GridCell>` to drive the cursor from outside |
| `onActiveCellChange` | — | Told every time the cursor moves |
| `onColumnResize` | — | Told the clamped width a resize settled on |
| `resizeAnnouncement` | the catalogue's, else `'Name, 180 pixels'` | What a keyboard resize says aloud: `(column, width) => string` |
| `resizeStep` | `16` | Pixels per Alt+Arrow press |
| `sort` | owned | A `Signal.State<readonly GridSort[]>` |
| `onSortChange` | — | Told when the grid changes the sort |
| `sortAnnouncement` | the catalogue's, else `'Sorted by Name ascending, then …'`, or `'Not sorted'` | What a sort gesture says aloud: `(sort: readonly GridSortDescriptor<T>[]) => string` |
| `filters` | owned | A `Signal.State<ReadonlyMap<string, GridFilter>>`, by column id |
| `quickFilter` | owned | A `Signal.State<string>` searched across every column |
| `onFilterChange` | — | Told when the grid changes either kind of filter |
| `filterAnnouncement` | the catalogue's, else `'3 of 40 rows'`, or `'All 40 rows'` | What a filter change says aloud: `(shown, total) => string` |
| `rowSelection` | `'none'` | A `GridRowSelectionMode`: `'none'`, `'single'` or `'multiple'` |
| `selectedRows` | owned | A `Signal.State<ReadonlySet<GridRowKey>>` |
| `onRowSelectionChange` | — | Told when the grid changes the row selection |
| `selectable` | every row | `(row) => boolean` — whether a gesture, or `selectAllRows`, may select this row |
| `cellSelection` | `'none'` | A `GridCellSelectionMode`: `'range'` turns on the rectangle of cells |
| `cellRange` | owned | A `Signal.State<GridCellRange \| null>` |
| `onCellRangeChange` | — | Told when the grid changes the rectangle |

Every piece of state has the same shape. Supply a `Signal.State` and the grid
reads and writes yours, which is how a saved view, a URL or a server that
already knows gets in; leave it out and the grid owns one. The `on…Change`
callbacks fire when the grid changes the state — a click, a key, a method — and
not when you write the signal yourself, since you already know.

The three announcements are defaulted rather than left out, because the failure
of a missing one is silence, not a visible gap. Each default is read from the
locale's [message catalogue](./primitives-data#messages) where it has the key,
and is English where it does not; none of these keys is in the default
catalogue, so a translation that adds them is heard and one that never heard of
the grid is not made to grow them. A number in a catalogue's sentence is
formatted for its locale — "1.000" in German — where the English default writes
it as a plain number.

| Key | Values | English |
|---|---|---|
| `gridRowsLeft` | `{n}` shown, `{m}` in all | `3 of 40 rows` |
| `gridAllRows` | the same, where the two are equal | `All 40 rows` |
| `gridColumnWidth` | `{column}`, the header; `{n}`, the width | `Name, 180 pixels` |
| `gridAscending`, `gridDescending` | `{column}` | `Name ascending`, `Name descending` |
| `gridThen` | `{terms}`, the ones before; `{term}`, the next | `Department ascending, then Name descending` |
| `gridSortedBy` | `{terms}`, the whole order | `Sorted by …` |
| `gridNotSorted` | — | `Not sorted` |

A sort sentence is built a term at a time: each term, then each one joined to
the ones before it by `gridThen`, then the lot by `gridSortedBy`. A function of
your own replaces the whole sentence. A sort's is handed `GridSortDescriptor<T>`
terms — `{ column, direction }`, the term with its column already looked up —
so it can read each column's `header` rather than its id.

**`rowHeight` is one number, not a measurement.** Every row is exactly that
tall, which makes the vertical geometry arithmetic: nothing is measured,
nothing is observed, and a million rows cost what ten do. The cost is that a row
cannot grow to fit wrapped text. Variable row height is not built.

**`getRowKey` defaults to the index**, which is right for a list that only ever
grows at the end and wrong for nearly everything else on this page. A keyed
`:for` reuses a row's elements by key; row selection is held by key; the cursor
follows its row through a sort by key. On the default, all three mean a
different row after every sort and filter — there is a test pinning exactly
that degraded behaviour — and an open editor, which has to be over the row it
will write to, is abandoned rather than left over another. Give `getRowKey`
before turning on selection or sorting, and to any grid that can be edited;
build the key from the row itself:
the `index` it is handed is the row's place in the sorted, filtered view, not in
your array, so a key made from it is the default again.

## Columns

```ts
interface GridColumn<T> {
  id: string;
  header: string;
  value: (row: T) => unknown;
  width?: number;         // default 150
  minWidth?: number;      // default 40
  maxWidth?: number;      // default: unbounded
  resizable?: boolean;    // default true
  sortable?: boolean;     // default true
  sortValue?: (row: T) => unknown;
  compare?: (a: T, b: T) => number;
  filterValue?: (row: T) => unknown;
  filterable?: boolean;   // default true
}
```

| Field | Description |
|---|---|
| `id` | Stable across re-fetches: widths, sorts and filters are held against it |
| `header` | The header's text, and the column's name in announcements |
| `value` | What the cell shows for a row |
| `width` | The starting width, in px |
| `minWidth`, `maxWidth` | The bounds every resize is clamped to |
| `resizable` | `false` makes the handle inert and marks it `data-disabled` |
| `sortable` | `false` removes the column from sorting and leaves it no `aria-sort` |
| `sortValue` | The key this column sorts by. Defaults to `value` |
| `compare` | A comparator over whole rows, written ascending. Used instead of `sortValue` |
| `filterValue` | What this column's filter and the quick filter test. Defaults to `value` |
| `filterable` | `false` refuses a filter on the column and leaves it out of the quick filter. Every column of a [grouped grid](#what-a-layer-above-the-grid-means) says it |

`value` is a function rather than a field name for two reasons: a field name
reaches one level of a plain object, and this is where a cell's binding gets its
dependencies. An accessor that reads a signal gives that cell a binding of its
own — which is the difference between writing one text node and rebuilding a
row.

Set `sortValue` and `filterValue` wherever the cell shows something other than
the thing being ordered or searched: a date rendered "3 Feb" sorts April before
February as text, and "$1,000" sorts before "$9".

The column list is data you replace rather than mutate. Handing the grid a new
array rebuilds the column geometry; editing a column object in place changes
nothing the grid can see.

## Rendering

### What to render

| Member | Description |
|---|---|
| `rows()` | The rows to render — the window, not the collection |
| `columns()` | The columns to render — also windowed |
| `cellValue(row, col)` | What this column shows for this row. Call it inside the cell's own binding |
| `rowCount()` | Rows after filtering, rendered or not — what `aria-rowcount` is built from |
| `sourceRowCount()` | Rows handed in, before any filter |
| `columnCount()` | Every column, rendered or not |

A rendered row is a `GridRow<T>`: `index` in the view, `key`, the `item`
itself, and its `start` and `size` in pixels. A rendered column is a
`GridColumnView<T>`: `index`, `key`, the `column` definition, `start`, and the
`width` the geometry is actually using, after any resize and clamp.

Rendered rows are cached by key and handed back as the *same objects* whenever
their key, item, index and offset have not changed. `:for` writes each item into
its row's signal, and a signal set to the value it already holds notifies
nobody — so a re-sort that leaves a row where it was costs that row nothing,
and a filter that removes rows below the window costs the window nothing. Only
rows that genuinely moved are rebuilt.

### Props

| Member | Goes on | Carries |
|---|---|---|
| `gridProps()` | The outer element | `role="grid"`, `aria-rowcount`, `aria-colcount`, `aria-label`, `aria-multiselectable` |
| `headerProps()` | The header's wrapper, outside the scroller | `role="rowgroup"`, `overflow: hidden` |
| `headerRowProps()` | The header row | `role="row"`, `aria-rowindex="1"`, the horizontal transform |
| `headerCellProps(col)` | Each header cell | `role="columnheader"`, `aria-colindex`, `aria-sort`, `tabindex`, width |
| `resizerProps(col)` | A column's resize handle | `aria-hidden`, `touch-action: none` |
| `bodyProps()` | The scroller | `role="rowgroup"`, `overflow-anchor: none` |
| `sizerProps()` | The empty element sized to the whole collection | `role="none"`, height and width |
| `containerProps()` | The element holding the rendered window | `role="none"`, the two-axis transform |
| `rowProps(row)` | Each rendered row | `role="row"`, `aria-rowindex`, `aria-selected`, height |
| `cellProps(row, col)` | Each rendered cell | `role="gridcell"`, `aria-colindex`, `aria-selected`, `tabindex`, width |

Each returns a `GridProps` — attribute name to `GridPropValue`, which is a
string, a number, a boolean, `undefined` for an attribute left off, or a record
of style properties — shaped for `:spread`. The sizer and container are
`role="none"` because a `grid` owns `row` children, and a plain `div` between
the two breaks that relationship wherever the accessibility tree is built from
the DOM.

The counts are the reason the ARIA is not optional. A window of twelve rows out
of a hundred thousand is invisible to a sighted reader and a lie to everyone
else: without `aria-rowcount`, `aria-colcount`, `aria-rowindex` and
`aria-colindex` a screen reader announces row three of twelve in a grid whose
scrollbar says otherwise. The counts come from the model, never from the DOM,
because the DOM only ever holds the window.

The resize handle is hidden from assistive technology on purpose. It is a
pointer affordance for something the keyboard reaches another way —
Alt+Arrow on the header — and a separator announcing a width in the middle of
every header is one more thing to hear on the way past.

### Handlers

| Member | Wire to |
|---|---|
| `onKeyDown(event)` | `keydown` on the grid. Returns `true` when it consumed the key |
| `onFocusIn(event)` | `focusin` on the grid. Keeps the cursor and the browser's focus together |
| `onHeaderClick(event)` | `click` on a header cell. Sorts; Shift adds to the order |
| `onCellClick(event)` | `click` on a cell. Selects the row, where row selection is on |
| `onResizePointerDown(event)` | `pointerdown` on a resize handle |

Handlers find their cell from the event target by attribute rather than by
registration, so a cell rendered inside whatever wrapper you wrote needs no
wiring of its own. A click that ends a resize drag is not taken as a sort.

### Styling hooks

| Attribute | On | Present when |
|---|---|---|
| `data-active` | cell, header cell | It holds the cursor |
| `data-selected` | row, cell | The row is selected; the cell is inside the range |
| `data-column` | cell, header cell | Always — the column's `id` |
| `data-sort` | header cell | Sorted: `ascending` or `descending` |
| `data-sort-index` | header cell | Its 1-based place in a sort of two or more columns |
| `data-filtered` | header cell | The column has a filter that runs — an unfinished one, or one held for a column that is not `filterable`, filters nothing and marks nothing |
| `data-resizing` | resize handle | A drag is in progress |
| `data-disabled` | resize handle | The column is not resizable |
| `data-group`, `data-count` | row, from `grouping.rowProps` | It is a group header; how many rows it holds |
| `data-depth` | row, from `grouping.rowProps` | Always — how many groups it sits inside |
| `data-editing` | cell, from `editing.cellProps` | Its edit session is open |
| `data-invalid` | edit control, from `editing.editorProps` | Validation refused what it holds |

### Constants

| Export | Value | Description |
|---|---|---|
| `GRID_CELL_ATTRIBUTE` | `'data-volt-grid-cell'` | On every cell, carrying `row,column` |
| `GRID_RESIZER_ATTRIBUTE` | `'data-volt-grid-resizer'` | On a resize handle, carrying the column id |
| `HEADER_ROW` | `-1` | The row index of the column header |
| `GRID_GROUP_ATTRIBUTE` | `'data-volt-grid-group'` | On a group header row, carrying its path |
| `GRID_EDITOR_ATTRIBUTE` | `'data-volt-grid-editor'` | On the control an edit is typed into |
| `VERSION` | `'0.1.0-alpha.1'` | The version the package is published under |

## Moving around

```ts
interface GridCell {
  readonly row: number;     // index in the view; HEADER_ROW for the column header
  readonly column: number;  // index in the column list
}
```

| Member | Description |
|---|---|
| `activeCell()` | Where the cursor is. `row` is `HEADER_ROW` on the column header |
| `focusCell(cell)` | Move the cursor, scroll the cell into view, focus it — once rendered, if it is not yet. Clamped into the grid |
| `scrollToCell(cell)` | Scroll a cell into view without moving the cursor or focus |
| `rowIndex(key)` | Where the row with this key sits in the view now, or `-1` where the view does not hold it |
| `rowAt(index)` | The row at a position in the view, or `undefined` where the view does not reach — including rows the window is not rendering |
| `columnIndex(id)` | Where the column with this id sits in the column list now, or `-1` where the list does not hold it |

A position is two indices, not a row key and a column id, because the keyboard
map is arithmetic over it; which row sits at an index changes with every sort
and filter, and the grid moves the cursor to follow — see below. `rowIndex` is
the way from a record to a position, `rowAt` the way back, and `columnIndex`
from a column. `rowIndex` scans the view, so ask it once per change rather than
once per cell; `rowAt` is a lookup. `rows()` answers `rowAt`'s question only for
the rows the window holds, so reading the record under the cursor — a position,
and one that can sit off screen — goes through `rowAt`.

The keyboard map is the WAI-ARIA grid pattern, plus sorting, resizing and
selection:

| Keys | Does |
|---|---|
| Arrow keys | One cell along the row, or one row up or down the column |
| Home, End | First, last cell of the row |
| Ctrl + Home, Ctrl + End | First cell of the first data row, last cell of the last |
| PageDown, PageUp | By as many rows as are on screen |
| Enter, Space on a header | Sort the column: ascending, descending, none |
| Shift + Enter or Space on a header | Add the column to the order instead of replacing it |
| Alt + ArrowRight, ArrowLeft on a header | Widen or narrow the column by `resizeStep` |
| Space on a data cell | Toggle the row's selection, where row selection is on |
| Ctrl + A | Select every row the filter left, in `'multiple'` mode |
| Shift + Arrow, Home, End, PageUp, PageDown | Extend the cell range, in `'range'` mode |
| Shift + Ctrl + Arrow | Extend the cell range to that edge of the grid |
| Shift + Ctrl + Home, End | Extend the cell range to the first or last cell of the grid |

The cursor stops at the edges rather than wrapping round them. Keys it does not
own it leaves alone and reports as not consumed — Ctrl with an arrow and no
Shift among them, since that belongs to the browser or the page — and Shift with
a movement key belongs to the page wherever there is no cell range to extend:
outside `'range'` mode, and on the header row. Meta is read as Ctrl, so Cmd does
the same on a Mac.

**Movement is arithmetic over indices, not a walk over elements.** In a grid of
a hundred thousand rows the cell Ctrl+End goes to is not in the document, and
neither are the rows a PageDown crosses. So the index moves first, the scroll
follows, and the cell is focused once the window has rendered it. That is why
the grid does not use `createRovingFocus`, which moves between elements that
exist.

**The header is row one, and it is navigable.** ArrowUp from the first data row
lands on the column header, which is where `aria-rowindex="1"` says it is; data
rows are numbered from two. A header a keyboard user cannot reach is a column
they cannot sort or resize. `HEADER_ROW` is the index it navigates under —
negative, so every comparison in the keyboard map stays plain arithmetic.

**There is one tab stop**, and it is on the cursor's cell when that is rendered.
When the reader has scrolled the cursor out of the window, the tab stop moves to
the nearest cell that is — a `tabindex="0"` on an element that does not exist
would drop the grid out of the tab order entirely. With no data row rendered —
an empty result, say — the header holds it, because the header is always
rendered; only a grid with no columns at all puts `tabindex="0"` on the grid
element itself.

**The cursor follows a row, not an index.** When a sort moves the row the cursor
was on, the cursor goes with it, found again by key. Focus follows only if focus
was on the cursor to begin with, since a sort is usually driven from the header
where the reader is standing. When the row is filtered away, the cursor stays at
the position it had, clamped into the grid.

Focus that leaves the grid is the reader's, wherever it goes — to another
control, or nowhere, by a click on the page background. The grid hears it leave,
and the next re-sort moves the cursor without pulling focus back. A focused cell
removed by the re-render itself is not focus leaving, and focus still follows
the row.

## Sorting

```ts
interface GridSort {
  readonly columnId: string;
  readonly direction: GridSortDirection;
}

type GridSortDirection = 'ascending' | 'descending';
```

| Member | Description |
|---|---|
| `sort()` | The order, outermost term first |
| `sortDirection(columnId)` | Which way a column is sorted, or `null` — also for a term that orders nothing |
| `setSort(sort)` | Replace the whole order. Silent |
| `toggleSort(columnId, additive?)` | Cycle ascending, descending, none. Announces |

A sort is a list of terms, because "by department, then by salary" is one
question, and because the second term is what makes the first deterministic
when it ties. It holds no functions and names columns by id, so it can go into a
URL or a saved view and come straight back; a term naming a column that no
longer exists, or one marked `sortable: false`, is left out of the ordering
rather than thrown over. It is not removed from the signal, though: `sort()` and
`onSortChange` still carry it, so it comes back with the column. Nothing the
grid reports counts it — `sortDirection` is `null` for it, it takes no place in
`data-sort-index`, and the announcement leaves it out — because it is not a
claim the rows on screen bear out.

The cycle has three states rather than two. A grid that could not be put back
into its source order would have lost something the reader may want back. A
plain click starts a new order but still cycles from where that column already
was, so clicking the second of two sorted columns reverses it rather than
starting over; Shift-click adds, cycles or removes one term and leaves the rest.

`setSort` is silent and `toggleSort` announces, on purpose. One is the path that
restores state, and a grid that announced its own saved sort on load would talk
over the page; the other is the gesture, and the rows moving is the only other
sign of it — which is exactly what a screen-reader user cannot see. The
announcement carries the whole order, because the column the reader clicked is
the one thing they already know.

Every sortable column carries `aria-sort`, `none` until it is sorted: a column
has to say it can be sorted *before* it is, or the affordance exists only for
readers who can see the arrow. ARIA says an author should mark one sorted header
at a time; a multi-column sort is the case where that costs more than it buys,
so every term is marked and the announcement says the order.

How values compare:

- **Typed first.** Numbers as numbers, bigints, booleans and `Date`s by value;
  anything else, and any mix of types, as text.
- **Blanks last, both ways.** `null`, `undefined` and `''` sort after everything
  whichever way the column is sorted. Reversing a sort is a request to see the
  largest values first, not the rows with no value at all. `NaN` and an invalid
  `Date` are blanks too: neither is ordered against anything, and a comparator
  that called one equal to every value would let the engine put the rows around
  it out of order.
- **Ties keep source order.** `Array#sort` is stable, which is what makes a
  second term a refinement rather than a reshuffle.
- **Text is collated in the application's locale,** from `useLocale()` — not
  `localeCompare` with no argument, which uses the runtime's. The default
  collator is numeric, so "Item 9" comes before "Item 10".
- **`compare` gets the rows, not values,** and skips the blank handling.

**The grid never reorders your array.** It sorts a copy of the references —
same objects, your array untouched — and with nothing sorted or filtered the
view *is* your array, by identity.

```ts
import { Signal } from '@voltdev/core';
import { createGrid, type GridSort } from '@voltdev/grid';

// A saved order, restored before the first render. Silent, because the reader did not ask.
const saved = new Signal.State<readonly GridSort[]>([
  { columnId: 'department', direction: 'ascending' },
  { columnId: 'salary', direction: 'descending' },
]);

const table = createGrid<Person>({
  grid: () => gridElement,
  scroller: () => scrollerElement,
  container: () => containerElement,
  rows: () => people,
  columns: () => COLUMNS,
  getRowKey: (person) => person.id,
  sort: saved,
  onSortChange: (sort) => history.replaceState(null, '', `?sort=${encodeURIComponent(JSON.stringify(sort))}`),
});

table.sortDirection('salary'); // 'descending'
```

## Filtering

```ts
type GridFilter = GridTextFilter | GridNumberFilter | GridSetFilter;
```

| Filter | Fields |
|---|---|
| `GridTextFilter` — `{ type: 'text' }` | `value: string`; `operator`, default `'contains'`; `caseSensitive`, default `false` |
| `GridNumberFilter` — `{ type: 'number' }` | `value: number`; `operator`, default `'equals'`; `to`, the other end of a `'between'` — both ends inclusive, in either order |
| `GridSetFilter` — `{ type: 'set' }` | `values: readonly unknown[]` — what a row may hold to be kept, compared as a `Set` compares |

| Operator type | Values |
|---|---|
| `GridTextOperator` | `contains`, `notContains`, `equals`, `notEquals`, `startsWith`, `endsWith` |
| `GridNumberOperator` | `equals`, `notEquals`, `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`, `between` |

| Member | Description |
|---|---|
| `filters()` | The column filters, by column id |
| `setFilter(columnId, filter)` | Set one column's filter, or remove it with `null`. Refused for a column that is not `filterable` |
| `clearFilters()` | Remove every column filter and the quick filter |
| `quickFilter()` | The quick-filter text |
| `setQuickFilter(text)` | Search every column that can be filtered. Refused where none can |

A filter is a plain value for the reason a sort is: it has to survive a trip
through a URL or a saved view. It is compiled once into a predicate rather than
interpreted per row — a text filter over a hundred thousand rows would
otherwise fold the same needle a hundred thousand times, and a set filter would
build its `Set` once per row.

**A column can refuse to be filtered.** `filterable: false` leaves a column out
of the quick filter and refuses a filter of its own — `setFilter` does nothing
and says so while you are developing, and one handed in through the `filters`
signal, from a saved view, filters nothing and marks no header. A grouped
grid's columns all say it, which is what keeps a grid filter off a grouped grid;
see [What a layer above the grid means](#what-a-layer-above-the-grid-means).

**An unfinished filter is no filter.** An empty text box, a number filter whose
`value` is not a number yet, a `between` missing its `to` — these compile to
nothing, not to a predicate that happens to match everything. It matters
because "no active filters" is what lets the grid hand back your array by
identity; a match-everything predicate would still allocate a copy and wake
everything downstream of it.

**An empty set filter keeps nothing.** That is what "no boxes ticked" means on
the checklist it exists to drive. To keep everything, remove the filter.

**The quick filter wants every word.** It is split on whitespace, and each word
must appear in some column — "smith london" finds the Smith in London, not every
Smith and every Londoner. Words are matched against each column separately,
never against the columns joined, so a word cannot straddle two cells and match
text that appears nowhere on the row.

A number filter compares numbers whatever the cell holds: numeric strings (a
value straight out of JSON) are parsed, a `Date` compares by its timestamp, a
bigint is converted, and an empty string is not zero. A value that is none of
those never matches — not even `notEquals`, so a blank cell is not "not 5", and
neither is an invalid `Date`. Text filters fold case in the locale, because
Turkish I and dotless ı are different letters and the invariant fold runs them
together, and read a blank as `''`, so `notContains` keeps it. A set filter compares the raw
value, not its text: `1` and `'1'` are different members.

```ts
import type { Grid } from '@voltdev/grid';

declare const table: Grid<Person>;

table.setFilter('salary', { type: 'number', operator: 'between', value: 40_000, to: 80_000 });
table.setFilter('department', { type: 'set', values: ['Sales', 'Support'] });
table.setQuickFilter('smith london');

table.rowCount();       // rows the filters left
table.sourceRowCount(); // rows handed in
```

`rowCount()` — and so `aria-rowcount` — counts the *filtered* rows. A reader
told there are ten thousand rows in a grid a filter has left nine of is worse
off than one told nothing. Every change made through the grid announces the new
count, since the rows that stopped matching are not in the document and in a
virtualized grid never all were.

There is no filter UI: the grid gives you the model and marks a filtered column
with `data-filtered`, and the input, the menu or the checklist are yours. There
is no date filter type either — a number filter over timestamps is what there
is.

## Selection

Two selections, because they answer different questions.

| | Row selection | Cell range |
|---|---|---|
| Means | These records — act on them | This rectangle — look at it |
| Held by | Key | Position |
| After a sort or filter | Kept | Dropped |
| Turned on by | `rowSelection: 'single'` or `'multiple'` | `cellSelection: 'range'` |

A row's key still names the same record after a re-sort has moved it four
hundred places. A range's corners name positions, and the rows that used to lie
between them are somewhere else now — so the grid follows a row selection
through a re-sort and drops a range at it.

### Rows

A selected row is named by its `GridRowKey` — `string | number`, whatever
`getRowKey` returned for it.

| Member | Description |
|---|---|
| `selectedRows()` | The selected keys, a `ReadonlySet<GridRowKey>` |
| `isRowSelected(key)` | Whether one is selected |
| `selectRow(key, additive?)` | Select one row, replacing the selection unless `additive` |
| `toggleRowSelection(key)` | Flip one row |
| `selectAllRows()` | Every row the filter left. `'multiple'` only |
| `clearRowSelection()` | Select nothing |

With `rowSelection: 'none'`, the default, `selectRow`, `toggleRowSelection` and
`selectAllRows` do nothing, and `rowProps` carries no `aria-selected` or
`data-selected`. `'single'` holds at most one key: `selectRow` ignores
`additive`, and `toggleRowSelection` swaps or empties.

With the pointer, a click selects the row; in `'multiple'` mode Ctrl-click
toggles one and Shift-click takes every row between it and the last row
deliberately chosen. If that row has been filtered away since, Shift-click falls
back to a plain selection rather than measuring a range from a guess.

`selectAllRows` — and Ctrl+A — take only the rows the filter left. Selecting the
whole source instead would hand a bulk action rows the reader cannot see and did
not mean, which is the standard way a filtered grid deletes the wrong thing.

The other half of that is yours. A filter does not deselect anything: a row
selected before a filter hid it is still in `selectedRows()`, because a
selection held by key outlives the view by design. A bulk action that should
touch only what is on screen has to intersect the selection with the rows the
filter left.

`aria-selected` appears on rows only where it says something: on every row in
`'multiple'` mode, where `false` is what makes the set legible, and only on the
selected row in `'single'`, where a screenful of "not selected" would bury the
one that is.

`selectable` keeps rows out of all of it. A row it refuses is not selected by a
click, by Space — which it still spends, rather than let the page scroll — by a
Shift-click range that crosses it, or by `selectAllRows`, and it carries no
`aria-selected`, which is how a row says it cannot be. It is for the rows of a
collection that are not records, such as a
[grouped grid's headers](#what-a-layer-above-the-grid-means), and for the
records a bulk action must not reach. `selectRow` and `toggleRowSelection` take
a key rather than a row, and do not ask it.

### Cell ranges

```ts
interface GridCellRange {
  readonly anchor: GridCell;
  readonly focus: GridCell;
}
```

| Member | Description |
|---|---|
| `cellRange()` | The rectangle, or `null` |
| `setCellRange(range)` | Replace it, or clear it with `null`. Not checked against the grid |
| `isCellSelected(row, column)` | Whether a cell is inside it |

A range is kept as the two corners the reader made rather than as normalised
bounds: the anchor is where Shift was first held and the focus is where the
cursor has reached. Keeping them apart is what lets a range be dragged back
through its own anchor and out the other side.

Two functions — not members of the grid, but exports of the package that take
any range — turn the corners into edges:

```ts
function rangeBounds(range: GridCellRange): GridCellRangeBounds
function rangeContains(range: GridCellRange, row: number, column: number): boolean

interface GridCellRangeBounds {
  readonly fromRow: number;    // inclusive, every one
  readonly toRow: number;
  readonly fromColumn: number;
  readonly toColumn: number;
}
```

They are exported because painting a range's border needs to know which cell is
on which edge, and working that out from the corners by hand comes out inverted
when the range is dragged upwards.

```ts
import { rangeBounds, type Grid, type GridColumnView, type GridRow } from '@voltdev/grid';

declare const table: Grid<Person>;

// Which edges of the range this cell sits on, for a stylesheet to draw.
function rangeEdges(row: GridRow<Person>, col: GridColumnView<Person>): string {
  const range = table.cellRange();
  if (range === null || !table.isCellSelected(row.index, col.index)) return '';
  const b = rangeBounds(range);
  return [
    row.index === b.fromRow ? 'top' : '',
    row.index === b.toRow ? 'bottom' : '',
    col.index === b.fromColumn ? 'left' : '',
    col.index === b.toColumn ? 'right' : '',
  ].filter(Boolean).join(' ');
}
```

A range the keyboard makes never includes the column header: extending from a
data row stops at the first data row, and Shift on the header is left to the
page. `setCellRange` takes what it is given without checking it. Any key that
moves the cursor without extending the range ends it, as does any change to the
view; a click, or `focusCell` from code, moves the cursor and leaves the range
where it was. There is no pointer drag selection and no copy of a range to the
clipboard; the range is a model you can read, and acting on it is yours.

`rowSelection: 'multiple'` and `cellSelection: 'range'` each put
`aria-multiselectable` on the grid — a range is more than one cell by
construction. `'single'` does not. In `'range'` mode every cell carries
`aria-selected`, `false` outside the range, for the same reason rows do in
`'multiple'`.

## Resizing columns

| Member | Description |
|---|---|
| `resizeColumn(id, width)` | Resize from code, clamped to the column's bounds |
| `onResizePointerDown(event)` | Starts a drag. Primary button only, one drag at a time |

The reader resizes by dragging the handle or with Alt+Arrow on a header. Every
path clamps to the column's `minWidth` and `maxWidth`, refuses a column marked
`resizable: false`, and tells `onColumnResize` the width it settled on — during
a drag, that is every move that changed it, not only the last. Escape during a
drag puts the width back where the drag started: one gesture, undone whole. That
Escape is the drag's alone: it is heard before anything else on the page and
goes no further, so a grid inside a dialog that closes on Escape loses the drag
and keeps the dialog. The next Escape is the dialog's again.

A keyboard resize is announced, because nothing else would report it: the handle
is hidden, the header text is unchanged and focus has not moved. A resize the
clamp turned into no change says nothing, so a bound is not reported as a
success — and neither does Alt+Arrow on a column marked `resizable: false`,
which the grid still consumes. A pointer resize is not announced; the reader
doing it is watching the column move.

Widths the reader chose are held inside the grid, keyed by column `id`, and
are not a signal you can hand in. To restore saved widths, record them from
`onColumnResize` and put them back as each column's `width` when the grid is
created. That is also the limit of it: once a column has been resized, the width
held for its id wins over any `width` a later column list gives it, for as long
as the grid lives, and nothing clears the held widths short of `resizeColumn`
for each one.

## Grouping

```ts
createGrouping<T>(options: GridGroupingOptions<T>): GridGrouping<T>
```

A grouped grid is not a grid of groups. It is the same grid over a *longer*
collection: the group headers are rows in it, sitting between the data rows they
describe, so one window and one row height cover both, and a grid grouped into
four thousand departments still renders a screenful of elements. A list of
headers kept beside the scroller would have to follow a window it is not part
of, and would stop being a grid the moment one group grew past the viewport.

The price of that is the whole shape of the API. `createGrouping` sits *above*
`createGrid`, not inside it: it filters, sorts and groups your rows, then hands
the grid a flattened list of `GridGroupedRow<T>` — group headers and your rows,
each wrapped — and the grid renders that list as if it were ordinary data. The
grid does not know it is grouped. [What that means for you](#what-a-layer-above-the-grid-means)
follows the reference.

```ts
import { Component, Signal } from '@voltdev/core';
import {
  createGrid,
  createGrouping,
  type GridColumnView,
  type GridGroupedRow,
  type GridRow,
  type GridSort,
} from '@voltdev/grid';

@Component({ selector: 'v-staff', templateUrl: './staff.html' })
export class Staff {
  grid = new Signal.State<Element | null>(null);
  scroller = new Signal.State<Element | null>(null);
  container = new Signal.State<Element | null>(null);
  people = new Signal.State<Person[]>([]);

  // One sort signal, handed to both. The header is the grid's; the ordering happens here.
  sort = new Signal.State<readonly GridSort[]>([]);

  grouping = createGrouping<Person>({
    rows: () => this.people.get(),
    columns: () => COLUMNS,
    groupBy: () => ['department'],
    aggregations: () => [
      { columnId: 'name', kind: 'count' },
      { columnId: 'salary', kind: 'sum' },
    ],
    getRowKey: (person) => person.id,
    sort: this.sort,
  });

  table = createGrid<GridGroupedRow<Person>>({
    grid: () => this.grid.get(),
    scroller: () => this.scroller.get(),
    container: () => this.container.get(),
    rows: () => this.grouping.rows(),
    columns: () => this.grouping.columns(),
    getRowKey: this.grouping.rowKey,
    sort: this.sort,
    label: 'Staff',
  });

  // A grouped grid is a treegrid; the grouping says so over the grid's own role.
  gridProps() {
    return { ...this.table.gridProps(), ...this.grouping.gridProps() };
  }

  rowProps(row: GridRow<GridGroupedRow<Person>>) {
    return { ...this.table.rowProps(row), ...this.grouping.rowProps(row.item) };
  }

  // A group header shows its label in the first column and its aggregates under the rest.
  cellText(row: GridRow<GridGroupedRow<Person>>, col: GridColumnView<GridGroupedRow<Person>>): string {
    if (row.item.kind === 'group' && col.index === 0) return this.grouping.label(row.item);
    const value = this.table.cellValue(row, col);
    return value === null || value === undefined ? '' : String(value);
  }

  // The grouping first: it claims only the keys and clicks that open and shut a group.
  onKey(event: KeyboardEvent): void {
    if (!this.grouping.onKeyDown(event)) this.table.onKeyDown(event);
  }

  onCellClick(event: MouseEvent): void {
    if (!this.grouping.onGroupClick(event)) this.table.onCellClick(event);
  }
}
```

```html
<!-- staff.html: as for any grid, except the grid element's :spread is gridProps() and
     its :keydown is onKey($event), and the body's rows and cells go through the
     component's own methods -->
<div :for="row in table.rows()" :key="row.key" :spread="rowProps(row)">
  <div :for="col in table.columns()" :key="col.key"
       :spread="table.cellProps(row, col)"
       :click="onCellClick($event)">{ cellText(row, col) }</div>
</div>
```

With `groupBy` empty, every row still comes back wrapped as `kind: 'data'`, so
one template serves a grid that can be grouped and ungrouped.

### `GridGroupingOptions`

| Option | Default | Description |
|---|---|---|
| `rows` | required | Your rows, in order. Never written to |
| `columns` | required | Your columns — the same list you would give an ungrouped grid |
| `groupBy` | required | The levels, outermost first: a column id, or a `GridGroupSpec` |
| `aggregations` | none | What to compute under each group header |
| `getRowKey` | its place in the grouped order | What identifies one of your rows. [See below](#expansion-and-row-keys) |
| `collapsed` | owned | A `Signal.State<ReadonlySet<string>>` of collapsed group paths |
| `onCollapsedChange` | — | Told when a group opens or shuts |
| `sort` | none: no column can be sorted | The sort — pass the grid's signal. See below |
| `filters` | owned | Column filters. These belong here, not on the grid |
| `quickFilter` | owned | The quick filter. Also here, not on the grid |
| `onFilterChange` | — | Told when either kind of filter changes |
| `filterAnnouncement` | the catalogue's, else `'3 of 40 rows'`, or `'All 40 rows'` | What a filter change says aloud, counting your rows: `(shown, total) => string`. The same keys as the grid's |

```ts
interface GridGroupSpec<T> {
  readonly columnId: string;
  readonly value?: (row: T) => unknown;                        // default: the column's value
  readonly label?: (value: unknown, rows: readonly T[]) => string; // default: the key as text
}

interface GridAggregation<T> {
  readonly columnId: string;                                   // the column it shows under
  readonly kind: 'count' | 'sum' | 'min' | 'max' | 'average' | ((rows: readonly T[]) => unknown);
  readonly value?: (row: T) => unknown;                        // default: the column's value
}
```

A level or an aggregation naming a column that is no longer in the list is
dropped rather than thrown over, because a saved view outlives the columns it
was saved against — but only when it has nothing else to read. One that brings
its own `value` is kept, as are `count` and a function `kind`, which read no
column at all; their results go into the group's `aggregates` under an id no
column shows.

### `GridGrouping`

| Member | Description |
|---|---|
| `rows()` | The flattened collection — headers and rows — for the grid's `rows` |
| `columns()` | Your columns, lifted to `GridGroupedRow<T>`, for the grid's `columns`. Every one comes back `filterable: false` |
| `rowKey(row)` | For the grid's `getRowKey` |
| `label(row)` | A group header's text; `''` for a data row |
| `tree()` | The groups themselves, nested |
| `filteredRowCount()` | Your rows the filter left, headers not counted |
| `sourceRowCount()` | Your rows, before any filter |
| `isExpanded(path)` | Whether a group is open |
| `expand(path)`, `collapse(path)`, `toggle(path)` | Open or shut one group |
| `expandAll()` | Open every group |
| `collapseAll()` | Shut every group that exists now. Groups that appear later are open |
| `filters()`, `setFilter()`, `clearFilters()` | As on the grid |
| `quickFilter()`, `setQuickFilter()` | As on the grid |
| `gridProps()` | Spread onto the grid element after the grid's own `gridProps` |
| `rowProps(row.item)` | Spread onto the row after the grid's own `rowProps` |
| `onGroupClick(event)` | Toggles the group clicked. Before the grid's `onCellClick` |
| `onKeyDown(event)` | Opens and shuts from the keyboard. Before the grid's `onKeyDown` |

A row of the flattened collection is one of two shapes, and a template has to
branch on `kind` anyway — a header renders a label where a row renders a value:

```ts
type GridGroupedRow<T> =
  | { readonly kind: 'group'; readonly key: GridRowKey; readonly node: GridGroupNode<T>; readonly depth: number }
  | { readonly kind: 'data'; readonly key: GridRowKey; readonly item: T; readonly depth: number };
```

A `GridGroupNode<T>` carries its `path`, `columnId`, the key `value` before it
became text, its `label`, `depth` (zero outermost), every leaf row under it in
`rows` and their `count`, its `aggregates` as a map by column id, and its nested
`children`.

`gridProps` makes a grouped grid `role="treegrid"`, which is the role ARIA
defines row levels and expansion for; ungrouped, it adds nothing and the grid's
own `role="grid"` stands. `rowProps` adds `data-depth` to every row and
`aria-level` to every row of a grouped grid, and to a header `aria-expanded`,
`data-group`, `data-count` and `GRID_GROUP_ATTRIBUTE` with the path.
`aria-expanded` is the one thing a collapsed group has that a sighted reader
gets from the twisty; without it a screen reader is told the rows went away and
never told they can come back.

On a group header, Enter toggles the group from any cell. ArrowRight opens and
ArrowLeft shuts it from the first cell only, and only when there is something to
do; everywhere else the arrows belong to the grid, because a header has columns
like any other row and the reader walks them the same way.

### What a layer above the grid means

These follow from the grid not knowing it is grouped. The grouping guards what
it can see from where it sits; the rest is wiring the grid and the editing have
to be given, the way the example above gives the grid `getRowKey`.

**Filter the grouping, never the grid.** The grid's filter runs over whatever it
is handed, and here that is the flattened list. A grid filter would test each
group header as though it were a row — by that column's aggregate, which is
usually nothing — and so usually drop it, leaving its rows orphaned under no
heading (a `notContains` keeps it, which is no better); and it would never see
the rows inside a collapsed group at all. So filtering happens in
`createGrouping`, before grouping, which is also the only order in which an
aggregate is over the rows the reader can see. Every column `columns()` hands
the grid comes back `filterable: false` to keep it there: the grid's
`setFilter` and `setQuickFilter` refuse, saying so while you are developing, and
`filters` or `quickFilter` passed to the grid anyway filter nothing. The
header's `data-filtered` hook reads the grid's own filters, so on a grouped grid
it is never set; style a filtered column from `grouping.filters()` instead. A
column *you* mark `filterable: false` is left out of the grouping's filtering
the same way it would be left out of an ungrouped grid's.

**The grouping announces the count.** The grid says how many rows a filter left,
but on a grouped grid nothing filters there. The grouping says it instead, from
its own `setFilter`, `setQuickFilter` and `clearFilters`, counting your rows and
not the headers — "3 of 40 rows", or the catalogue's `gridRowsLeft` and
`gridAllRows` — or in your words, from `filterAnnouncement`.

**Hand the same `sort` signal to both.** The header — its click, its
`aria-sort`, its announcement — belongs to the grid, and duplicating it in the
grouping would be a second implementation of what the reader is looking at. The
ordering has to happen before grouping, or it would scramble the headers out of
their groups. So `columns()` gives every lifted column a comparator that returns
zero, the grid's sort becomes a stable copy that moves nothing, and the grouping
reads the same signal and orders your rows before it groups them. Give the
grouping no signal and it has nothing to order by, so every lifted column comes
back `sortable: false`: no `aria-sort`, and a header click does nothing. Give
the two separate signals and neither can tell — a header click marks the column
`aria-sort="ascending"`, announces "Sorted by Name ascending", and moves
nothing.

That no-op sort is not free. With a sort active, the grid still copies the
flattened list and sorts the copy on every change to it — every open, every
shut, every filter. Because every comparison says "equal", the engine finds the
list already in order, so in V8 it is one pass, `n − 1` calls per sort term, and
not `n log n`; but it is a pass over every header and every open row, on top of
the grouping's own real sort of your rows.

**The grid's rows are the wrappers.** `row.item` in the grid is a
`GridGroupedRow<T>`, not your row, so the template branches on
`row.item.kind`. On a header, `cellValue` returns that column's aggregate, or
`undefined` where the column has none; the label is in no column at all, and
`label(row)` is what you render wherever the twisty goes.

**The grid's counts include the headers.** `table.rowCount()` and
`aria-rowcount` count group headers and the rows of open groups — which is what
a reader stepping through meets, and why a collapsed group's rows come out of the
count without anyone subtracting them. `table.sourceRowCount()` is the length of
the flattened list, not your data. For your rows, ask the grouping:
`filteredRowCount()` and `sourceRowCount()`.

**Tell the grid which rows can be selected.** The grid selects by its row keys,
and a row of yours is keyed by what your `getRowKey` returned for it, as it is —
so `selectedRows()` holds your own ids. A header is keyed `'g\u001f' + path`,
which no key of yours begins with. Headers are rows of the collection all the
same, so give the grid `selectable: (row) => row.kind === 'data'`, or Space on a
header selects it and Ctrl+A takes every header in the list. `selectAllRows()`
takes none of the rows inside a collapsed group: they are not in the collection
the grid was given, and a select-all never reaches a row the reader cannot see.
Route clicks through `onGroupClick` first, as above, so a click on a header
toggles it.

**Tell each editor which rows it may edit.** A `createCellEditing` over a
grouped grid is typed over `GridGroupedRow<T>`, so give every editor
`editable: (row) => row.kind === 'data'` — the boundary `selectable` draws, per
editor because that is where `editable` lives, and drawn for the same reason: a
session is opened on whatever its editor allows, and an unguarded one opens on a
header's aggregate and commits a change whose `item` is the heading. Unwrap
`change.item` in `onCommit`. Put the grouping's `onKeyDown` ahead of the editing
one as well: with the guard, Enter on a header falls through editing to the
grouping either way; without it, Enter on a header goes to whichever handler
comes first — the grouping toggles the group, the editing opens an editor on the
aggregate.

### Group keys, order and aggregates

**Rows are grouped by their key's text.** A path is a string, because a path is
what goes into a URL or a saved view — and two keys that render the same are one
group to the person reading them. The consequences: `1` and `'1'` are one group;
`null`, `undefined` and `''` are one group with an empty label; and an object
key groups every row together as `[object Object]`. Give a `GridGroupSpec` a
`value` that returns something with a meaningful text, and a `label` where the
text is not what the reader should see.

A nested group's path is its key joined to its parents' with U+001F, a character
no one types, so two `London` groups under different regions are two groups. So
are a `London` city under a blank region and a top-level `London` region: a
child's path always has the separator in front of its own text, even where its
parent's text is empty.

**Groups come out in the order of their first row.** Sorting by the grouped
column therefore orders the groups; sorting by anything else orders rows within
each group and puts first the group holding the row that sorts first. Groups cannot be
ordered by their aggregates — departments by total salary is not built. A group
a filter empties disappears.

**Aggregates are over the filtered rows** of each group, including every leaf of
its subgroups.

| Kind | Result |
|---|---|
| `count` | The number of rows. Reads no value at all |
| `sum`, `min`, `max`, `average` | Over the values that are numbers; `null` when none is |
| a function | Whatever it returns, given the group's rows |

`GridAggregateKind` is the union of the five names. Aggregates are held by
column id, one per column: two aggregations naming the same column leave only
the later one's result, so a column that needs both a sum and an average needs
a function `kind` that returns both.

Values that are not numbers are skipped rather than counted as zero: a column
with three numbers and a blank averages the three, because the blank is a row
with no salary, not a row that earns nothing. Numeric strings count; an empty
string does not; a `Date` counts as its timestamp, so `min` and `max` of a date
column come back as numbers, and an invalid `Date` does not count at all. A
group with nothing to total gets `null` rather than `0`, which would be a number
a reader could act on and a claim the data does not make.

**What it costs.** Grouping reads the group key of every row, and an aggregate
reads its value from every row, so a change to any grouped or aggregated value
rebuilds the whole tree. The rebuild reuses every group whose rows, count and
aggregates came out the same, and the flattened rows are cached by key the way
the grid caches its row views — so on screen, a value changing under a total
updates, in place and on the same elements, the headers whose totals moved
(every level above the row, since each total covers its subgroups) and the one
data cell that changed. No other data cell is asked for its value. Opening a
group builds the rows that appeared; the rows *after* it have moved and are
re-read, which is the same price a sort pays for a row it moved.

### Expansion, and row keys

Expansion is held by path, so it survives a re-sort and a filter the way a row
selection held by key does. Everything is open until it is shut, and
`collapsed` holds only the shut ones. Nothing prunes it: the path of a group a
filter has emptied stays in the set, which is what brings the group back shut
when the filter is cleared, and also means the set only grows until
`expandAll()` empties it.

`getRowKey` defaults to a row's place in the grouped order. Shutting a group does
not change the keys of the rows below it — the count runs on through a collapsed
group — but a sort, a filter or a change of grouping does, so the default is no
more use to row selection or the cursor here than it is on a flat grid. Give
`getRowKey`. The `index` your own `getRowKey` is handed is that same place in
the grouped order, not the row's index in your array.

## Editing

```ts
createCellEditing<T>(options: GridCellEditingOptions<T>): GridCellEditing<T>
```

An edit is a session that reports a change rather than making one. Nothing here
writes to a row: an edit ends by handing you which row, which column, what it
was and what it is now, and you apply it to your own store — the same way
sorting and filtering hand back a view and never reorder your array. The rows
belong to whoever passed them in, a commit usually has to reach a server before
it is true, and a grid that had already written the new value would have no way
to put the old one back when the server said no.

```ts
import { Component, Signal } from '@voltdev/core';
import { createCellEditing, createGrid, type GridColumnView, type GridRow } from '@voltdev/grid';

@Component({ selector: 'v-people-editor', templateUrl: './people-editor.html' })
export class PeopleEditor {
  grid = new Signal.State<Element | null>(null);
  scroller = new Signal.State<Element | null>(null);
  container = new Signal.State<Element | null>(null);
  people = new Signal.State<Person[]>([]);

  table = createGrid<Person>({
    grid: () => this.grid.get(),
    scroller: () => this.scroller.get(),
    container: () => this.container.get(),
    rows: () => this.people.get(),
    columns: () => COLUMNS,
    getRowKey: (person) => person.id,
  });

  editing = createCellEditing<Person>({
    grid: () => this.table,
    columns: () => COLUMNS,
    editors: () => ({
      name: { validate: (value) => (String(value).trim() === '' ? 'A name is required' : null) },
      salary: {
        // A cleared field is no number, where `Number('')` would make it 0. See "Numbers" below.
        parse: (raw) => (raw.trim() === '' ? null : Number(raw)),
        validate: (value) =>
          typeof value !== 'number' || Number.isNaN(value) ? 'Enter a number'
          : value < 0 ? 'Cannot be negative'
          : null,
      },
    }),
    onCommit: (change) => saveChange(change),
  });

  cellProps(row: GridRow<Person>, col: GridColumnView<Person>) {
    return { ...this.table.cellProps(row, col), ...this.editing.cellProps(row, col) };
  }

  // Editing first: while a cell is open it claims every key.
  onKey(event: KeyboardEvent): void {
    if (!this.editing.onKeyDown(event)) this.table.onKeyDown(event);
  }
}
```

```html
<!-- people-editor.html: the grid element's :keydown is onKey($event); this is the
     cell, and the refusal message -->
<div :for="col in table.columns()" :key="col.key"
     :spread="cellProps(row, col)"
     :dblclick="editing.begin(row, col)">
  <input :if="editing.isEditing(row.index, col.index)"
         :spread="editing.editorProps()" :value="editing.text()"
         :input="editing.onInput($event)">
  <span :else>{ table.cellValue(row, col) }</span>
</div>

<p :if="editing.error() !== null" :spread="editing.errorProps()">{ editing.error() }</p>
```

A column with no entry in `editors` cannot be edited at all. There is no
read-only flag to forget: an editable grid's read-only columns say so with
`aria-readonly`, rather than silently swallowing a double-click.

Call `createCellEditing` where a component's fields are initialised, as
`createGrid` is: it creates an effect — the one that abandons a session whose
cell has gone, below — which is disposed with the component that owns it.

### `GridEditor`

| Field | Default | Description |
|---|---|---|
| `editable` | every row | `(row) => boolean` — per row, because "all but the archived ones" is the usual case |
| `read` | the column's `value` | The value the editor opens with |
| `parse` | the text itself | Turns what the control holds into the value to commit |
| `validate` | accept | `(value, row) => string \| null` — a message refuses the commit |

### `GridCellEditingOptions`

| Option | Default | Description |
|---|---|---|
| `grid` | required | `() => Grid<T> \| null \| undefined` — a function, because the grid is usually a field declared first |
| `editors` | required | `() => Record<columnId, GridEditor<T>>` — what each column can do when edited |
| `onCommit` | required | `(change: GridEditChange<T>) => void` — where a change goes, and the only way a value ever changes |
| `columns` | — | The same column list the grid has. Only Tab uses it, to step over columns with no editor |
| `onCancel` | — | `(session: GridEditSession<T>) => void` — told when a session is abandoned, with `-1` for its `row` or `column` where that is what went |
| `onInvalid` | — | `(message, session) => void` — told when validation refuses, before the message shows |

### `GridCellEditing`

| Member | Description |
|---|---|
| `begin(row, col)` | Open a session on a rendered cell. `false` where it cannot be edited. Moves neither the cursor nor focus |
| `beginAt(cell)` | Open by position, if that cell is rendered and editable |
| `session()` | The open `GridEditSession<T>` — `row`, `column`, `columnId`, `item`, `rowKey`, `initial` — or `null`. `row` and `column` are where its cell sits now |
| `isEditing(row, column)` | Whether this position is the one open |
| `isEditable(row, col)` | Whether this cell could be opened at all |
| `draft()`, `text()` | What has been typed, parsed; and the text itself, as typed, for the control |
| `setDraft(value)` | Replace the draft, and the control's text with its text, from code — a `<select>`, a picker, a stepper. Clears `error()` |
| `error()` | The message validation refused with, or `null` |
| `commit()` | Commit unless validation refuses. Returns whether the session closed. Moves no focus |
| `cancel()` | Abandon the edit and put focus back on the cell |
| `editorProps()` | Spread onto the control: `GRID_EDITOR_ATTRIBUTE`, and while refused `aria-invalid`, `aria-errormessage`, `data-invalid` |
| `errorProps()` | Spread onto the message: its id, and `role="alert"` |
| `cellProps(row, col)` | Spread onto the cell after the grid's: `aria-readonly`, `aria-invalid`, `data-editing` |
| `onKeyDown(event)` | The editing keyboard. Before the grid's `onKeyDown` |
| `onInput(event)` | Reads an `<input>` or `<textarea>`, keeps the draft in step, clears `error()` |

**Nothing here moves focus into the control.** Opening a session renders your
`:if` branch, and the control appears with focus still on the cell around it —
where keys go to the grid element's handler rather than into the text. Focusing
the control once it exists is yours: the tests for this package do it by hand.
Everything the rest of this section says about focus "staying in the editor"
assumes you put it there.

A committed change is a `GridEditChange<T>`: your `item` (the object itself,
not a copy, and not written to), its `rowKey`, the `rowIndex` it had in the view
when it was committed, the `columnId`, and `previous` and `value`. Apply it by
`rowKey` or `item`, never by `rowIndex`, which is a position — and one the
change itself may move the row from. A value the reader left as it was is
not a change: the session closes and `onCommit` is not called, because a write
through a request, an undo entry or a dirty flag for a reader who opened a cell
and pressed Enter is a write for nothing. The comparison is `Object.is` against
what the editor opened with, so an editor with no `parse` over a numeric column
reports a change whenever the reader retypes the same number — as a string.

**A session follows its cell, not its position.** It is held by the row's key
and the column's id, so a sort or a filter while a cell is open — a click on a
header will do it — moves the editor with its row, a column list handed over in
another order moves it with its column, and the commit goes to the cell the
reader can see it in. A session whose cell goes altogether — its row filtered
away or gone from your data, its column taken out of the list — is abandoned,
and `onCancel` is told, with `-1` for the row or the column that went: an edit
nobody can see is not one to write, nor one to keep claiming every key for.
Unlike Escape, this puts focus nowhere, because the cell it would go back to is
what went; focus is where a focused cell a filter hides leaves it in a grid with
no editing.

Like the cursor, following the row needs `getRowKey`. The default key is the
row's place, and a place names whichever row is there now: the first sort hands
it to another row, so the session's own row is gone and the edit is abandoned —
`onCancel` with `-1` for the row, as for a row a filter took away. The same
happens on a keyed grid whose data replaced the row object the session opened
on, because that object is what a commit names. Give `getRowKey` to an editable
grid, and apply a change by `rowKey` or `item`.

### The keyboard

| Keys | Does |
|---|---|
| Enter, F2 | Open the cell under the cursor |
| Enter | Commit, and move down a row |
| Shift + Enter | Commit, and move up a row |
| Escape | Abandon the edit, and stay on the cell |
| Tab, Shift + Tab | Commit, move to the next or previous editable cell, and open it |

Enter on the last row, and Tab off the last editable cell, commit and stay on
the cell just committed, focus included: the editor that held focus has gone,
and the key was taken from the browser, so there is nowhere else for it to be.
A commit that filters away the last row there was puts the cursor and focus on
the column header, which is where a grid with no rows keeps them.

Tab is the key that has to be taken from the browser: left alone, it would move
focus out of a grid whose only tab stop is the cell being edited, and the reader
would land after the table with their edit half made. Given `columns`, it steps
over columns with no editor — without it, Tab lands on the very next cell and
opens it only if that cell can be edited. It runs off the end of a row into the
next, and opens the cell it lands on only if the window already holds it;
otherwise the cursor moves and the reader presses Enter. A row whose `editable`
refuses is landed on, not stepped over: which columns have editors is known
without a row, but whether a row refuses is not until it is rendered, so the
cursor stops there and nothing opens.

Every other key is claimed while a cell is open, and deliberately not handled.
The grid's own navigation is suspended: an arrow in a text field moves the
caret, and a grid that also moved its cursor would leave the reader editing one
cell while standing on another.

There is no commit on blur. An edit session is a state machine rather than an
input with a blur handler, and a reader clicking away is not something it hears
about. Opening a second cell commits the first — one session at a time, because
an editor is a focused control and there is one focus — but a click outside the
grid leaves the session open until you call `commit()` or `cancel()`. So does a
single click on another cell: the cursor moves there, the session stays on the
first cell, and since an open session claims every key, the arrows do nothing
until it is committed or cancelled. If clicking away should keep the edit, call
`commit()` from whatever handles the click.

### Validation

A `validate` that returns a message refuses the commit rather than reporting
one. The session stays open with what the reader typed still in it, focus stays
in the editor, `aria-invalid` goes on the control and the cell, and nothing
reaches `onCommit` — a change that failed validation is not a change that
happened. Enter and Tab will not leave the cell, and no other cell will open.
The message is rendered into `role="alert"`, which is what makes a refusal
audible to a reader who cannot see the cell turn red; it clears as soon as the
reader answers it — by typing again through `onInput`, or by a `<select>` or a
picker calling `setDraft`.

### Keeping one text node per change

Opening an editor reads the value of the cell being opened, once and without
subscribing, and no other: the session is a signal the cells' *prop* bindings
depend on, and a prop binding re-running rewrites the cell's attributes without
asking it what it holds. Committing reads nothing. The new value reaches the
screen when you write it into whatever your column's `value` reads —
and then it is one text node, if that is a signal. Replace the row object
instead, and the grid sees a different item under that key and rebuilds the
row's cells. Both are correct; only one is the property this package exists for.

### Numbers

`parse` runs on every keystroke, and nothing it returns is written back into the
control: `text()`, which the control's value is bound to, is what the reader
typed, as they typed it. So a parse may return anything for text that is not
finished, and `validate` is where unfinished text is refused. `Number` is most of
a numeric column's parse. It reads a half-typed "-" as `NaN`, which the
`validate` above refuses as "Enter a number", and a cleared field as `0`, which
is the trap `Number('')` sets — hence the guard for a blank. What the reader
typed stays in the field either way, minus sign, ".5" and all, and the caret
stays where they left it.

## Copy and paste

```ts
createGridClipboard<T>(options: GridClipboardOptions<T>): GridClipboard<T>
```

Copy puts the cell range — or, with none, the cell under the cursor — on the
system clipboard twice: as tab-separated text, which a spreadsheet reads back
into cells, and as an HTML table, which a document reads back into a table.
Either alone would lose one of the two places a grid gets pasted into.

Paste goes the other way and stops short of your rows, as editing does. What the
clipboard holds is laid over the grid from the cursor, run through each target
column's editor exactly as a typed value is — `parse`, then `validate` — and
handed to you as the same list of `GridEditChange`s a commit is. You apply them
to your store. The rows are yours, a paste usually has to reach a server before
it is true, and a grid that had already written forty cells would have no way to
put them back when the server said no.

```ts
import { Component, Signal } from '@voltdev/core';
import {
  createCellEditing,
  createGridClipboard,
  createGrid,
  type GridColumnView,
  type GridEditChange,
  type GridEditor,
  type GridColumn,
  type GridPasteRefusal,
  type GridRow,
} from '@voltdev/grid';

interface Person {
  id: number;
  name: string;
  department: string;
  salary: number;
}

const COLUMNS: GridColumn<Person>[] = [
  { id: 'id', header: 'ID', value: (p) => p.id },
  { id: 'name', header: 'Name', value: (p) => p.name },
  { id: 'department', header: 'Department', value: (p) => p.department },
  { id: 'salary', header: 'Salary', value: (p) => p.salary, width: 120 },
];

// One record for both layers: a paste is parsed and validated as typing is, and
// `id`, which has no editor, refuses a paste as it refuses a double-click.
const EDITORS: Record<string, GridEditor<Person>> = {
  name: { validate: (value) => (String(value).trim() === '' ? 'A name is required' : null) },
  salary: {
    parse: (raw) => (raw.trim() === '' ? null : Number(raw)),
    validate: (value) =>
      typeof value !== 'number' || Number.isNaN(value) ? 'Enter a number'
      : value < 0 ? 'Cannot be negative'
      : null,
  },
};

/** Your rows with the changes in them — each changed row a new object, the rest as they were. */
function withChanges(people: readonly Person[], changes: readonly GridEditChange<Person>[]): Person[] {
  const byId = new Map(people.map((person) => [person.id, person]));
  for (const change of changes) {
    const person = byId.get(change.item.id)!;
    byId.set(person.id, { ...person, [change.columnId]: change.value });
  }
  return people.map((person) => byId.get(person.id)!);
}

@Component({ selector: 'v-people-sheet', templateUrl: './people-sheet.html' })
export class PeopleSheet {
  grid = new Signal.State<Element | null>(null);
  scroller = new Signal.State<Element | null>(null);
  container = new Signal.State<Element | null>(null);
  people = new Signal.State<Person[]>([]);
  refusals = new Signal.State<readonly GridPasteRefusal<Person>[]>([]);

  table = createGrid<Person>({
    grid: () => this.grid.get(),
    scroller: () => this.scroller.get(),
    container: () => this.container.get(),
    rows: () => this.people.get(),
    columns: () => COLUMNS,
    getRowKey: (person) => person.id,
    // So Shift+Arrow can mark out a rectangle to copy.
    cellSelection: 'range',
  });

  editing = createCellEditing<Person>({
    grid: () => this.table,
    columns: () => COLUMNS,
    editors: () => EDITORS,
    onCommit: (change) => this.people.set(withChanges(this.people.get(), [change])),
  });

  clipboard = createGridClipboard<Person>({
    grid: () => this.table,
    columns: () => COLUMNS,
    getRowKey: (person) => person.id,
    editing: () => this.editing,
    editors: () => EDITORS,
    onPaste: (changes) => {
      this.refusals.set([]);
      this.people.set(withChanges(this.people.get(), changes));
    },
    onRefuse: (refusals) => this.refusals.set(refusals),
  });

  cellProps(row: GridRow<Person>, col: GridColumnView<Person>) {
    return { ...this.table.cellProps(row, col), ...this.editing.cellProps(row, col) };
  }

  refusalText(refusal: GridPasteRefusal<Person>): string {
    const column = COLUMNS.find((candidate) => candidate.id === refusal.columnId)!.header;
    return `${refusal.item.name}, ${column}: ${refusal.message ?? 'cannot be edited'}`;
  }

  // Editing first, the clipboard second, the grid last: each claims only the keys it owns.
  onKey(event: KeyboardEvent): void {
    if (!this.editing.onKeyDown(event) && !this.clipboard.onKeyDown(event)) this.table.onKeyDown(event);
  }
}
```

```html
<!-- people-sheet.html: the grid as in Editing, with its :keydown onKey($event);
     this is the toolbar above it, and the refusals below it -->
<div role="toolbar" aria-label="Clipboard">
  <button :click="clipboard.copy()">Copy</button>
  <button :click="clipboard.paste()">Paste</button>
</div>

<ul :if="refusals.get().length > 0" role="alert">
  <li :for="refusal in refusals.get()" :key="refusal.rowKey + ':' + refusal.columnId">{ refusalText(refusal) }</li>
</ul>
```

The buttons are there because not every reader knows the shortcuts, and because
a context menu item of your own does the same thing: `copy()` and `paste()` act
on the grid's range or cursor wherever focus happens to be. Call them straight
from the click, not after an `await` of your own — see
[When the clipboard says no](#when-the-clipboard-says-no).

With [history](#undo-and-redo), hand a paste to it instead of to your store —
`onPaste: (changes) => void this.edits.commit(changes)` — and the whole paste is
one undo step.

Call `createGridClipboard` where a component's fields are initialised, as the grid
is: it reads the nearest locale then, for what it says aloud, because a paste
finishes after the clipboard answers, where no component's scope is current. It
creates no effect and no signal, and writes nothing onto the DOM: there are no
props to spread.

### `GridClipboardOptions`

| Option | Default | Description |
|---|---|---|
| `grid` | required | `() => Grid<T> \| null \| undefined` — a function, because the grid is usually a field declared first |
| `columns` | required | Every column the grid may show: the list it is given, or the whole list a [`createGridState`](#saving-and-restoring-a-view) arranges and hides columns from. A copy reads cells outside the rendered window, whose columns have no other way of being named. Each is placed where the grid has its id, so the order does not matter and a column the grid is not showing is never copied or pasted into |
| `onPaste` | required | `(changes, truncated) => void` — where a paste goes, and the only way a pasted value reaches a row. Not called for a paste that changed nothing, nor for one that was refused |
| `getRowKey` | the index | `(row, index) => GridRowKey` — the same key the grid has, so each change names its row the way the grid does |
| `editing` | — | `() => GridCellEditing<T> \| null \| undefined` — while its session is open, copy and paste do nothing. It says only that; what each column takes is `editors`, so give both, and in development the console says so when `editors` is missing |
| `editors` | — | The same `Record<columnId, GridEditor<T>>` editing has. With it, a paste is parsed and validated, and a column with no editor refuses one. Without it, every cell takes the text as it came |
| `onRefuse` | — | `(refusals: GridPasteRefusal<T>[]) => void` — told when a paste was refused, with every cell that refused it |
| `onCopy` | — | `(copied: GridCopied) => void` — told once a copy is on the clipboard |
| `onError` | — | `(failure: GridClipboardFailure) => void` — told when a copy or a paste could not use the clipboard |
| `copyAnnouncement` | the locale's `gridCellsCopied` / `copyFailed`, then English | `(result: GridCopyResult) => string` — said when a copy ends. `''` says nothing |
| `pasteAnnouncement` | the locale's `gridCellsPasted`, `gridPasteTruncated`, `gridPasteRefused`, `gridNothingToPaste` / `pasteFailed`, then English | `(result: GridPasteResult<T>) => string` — said when a paste ends |

### `GridClipboard`

| Member | Description |
|---|---|
| `copy()` | Copy the range, or the cell under the cursor. Resolves to a `GridCopyResult`, or `null` where there was nothing to copy — the cursor on the column header, a grid with no rows, an editor open |
| `paste()` | Read the clipboard and lay it over the grid. Resolves to a `GridPasteResult<T>`, or `null` where there was nowhere to paste, for the same reasons |
| `onKeyDown(event)` | Ctrl or Cmd with C, and with V. After the editing layer's `onKeyDown`, before the grid's |

Both methods resolve rather than reject: every way a copy or a paste can end is
a result you can branch on.

```ts
type GridCopyResult =
  | { status: 'copied'; bounds: GridCellRangeBounds; text: string; html: string }
  | GridClipboardFailure;

type GridPasteResult<T> =
  | { status: 'pasted'; changes: GridEditChange<T>[]; cells: number; bounds: GridCellRangeBounds; truncated: GridPasteTruncation | null }
  | { status: 'refused'; refusals: GridPasteRefusal<T>[]; cells: number; bounds: GridCellRangeBounds; truncated: GridPasteTruncation | null }
  | GridClipboardFailure;

interface GridClipboardFailure {
  status: 'failed';
  operation: 'copy' | 'paste';
  reason: 'unavailable' | 'refused' | 'empty' | 'gone';
  error?: unknown;   // what the Clipboard API rejected with, for 'refused'
}

interface GridPasteTruncation {
  rows: number;      // rows of the pasted block below the last row
  columns: number;   // columns of the rows that landed, past the last column
  cells: number;     // every cell dropped, from both
}
```

`cells` is how many cells the paste covered, changed or not; `bounds` is the
rectangle it covered, by position in the view when the clipboard was read.

### What a copy puts on the clipboard

Each cell is its column's `value`, as text — what the reader sees in it, not
what it sorts or filters by. `null` and `undefined` are empty cells, and so is a
column the grid holds that `columns` does not define, which keeps the cells
after it under the columns they came from; in development the console says so.

The range is cut to the grid as it is now, because a column list can shrink
under one and the grid does not clear it. A range with nothing left of it is no
range: the cell under the cursor is copied, and a paste starts there.

The text is one line per row and a tab between cells, quoted only where a
spreadsheet would quote it: a cell with a tab or a line break in it, or one that
starts with a quote, is wrapped in quotes with its own quotes doubled. Every
other cell is written as it is, because every spreadsheet reads an unquoted cell
as exactly what it says. There is no line break after the last row, so a single
cell pasted into a text field does not bring one with it.

The HTML is a bare `<table>` of `<td>`s, escaped, with a cell's line breaks as
`<br>`s that Excel keeps inside the cell rather than reading as the end of a
row. No styles and no header row: the headers are not cells the reader
selected, and a header row in the HTML would come back as a row of data the next
time it was pasted.

### What a paste reads

Both formats, when the clipboard has both, and the text wins wherever the two
agree on how many rows and columns there are. A spreadsheet's text is exact — it
quotes a cell with a line break in it — while HTML has had its whitespace
collapsed, as HTML always does, so `"  two  spaces "` survives the text and not
the table. Where they disagree, it is the text that lost the shape: a document or
a web page writes a cell's line break into its plain text unquoted, and the
table is the only thing still saying where the cells are. What the grid itself
copies always agrees with itself, so it pastes back exactly what it copied.

The text is read as it was written: quoted cells may hold tabs, line breaks and
doubled quotes, either kind of line break ends a row, and one at the very end
closes the last row rather than opening another. A quote that is never closed was
never a quote, and is kept. Empty text is nothing to paste; a lone line break is
one empty cell, which is what a spreadsheet puts on the clipboard for one.

A table is read the way it was shown: runs of whitespace are one space, a `<br>`
or a new paragraph is a line break, a non-breaking space is kept — a French
number is written with one — and a script or style inside a cell is not text. A
cell that spans rows or columns fills the rest of what it spans with empty
cells, which is how a spreadsheet copies a merged cell. The HTML is parsed into a
document of its own with `DOMParser`, never into the page, so nothing in it runs
or loads.

A row shorter than the others writes the cells it has and leaves the rest of its
width alone. Writing empties into cells the clipboard said nothing about would
be erasing them.

### Where a paste lands, and what it hands you

A paste starts at the top-left corner of the range when there is one, and at the
cursor otherwise. The corner rather than the cursor, because the cursor sits at
whichever corner the range was dragged to, and a paste that landed somewhere
different depending on which way the reader had selected would be one nobody
could aim. Rows are the view's, in its order: under a sort the block runs down
the rows as they are sorted, and under a filter it lands on the rows the filter
left, never on one the reader cannot see.

Each cell is then decided as a commit is:

- The value is the column editor's `parse` of the text, or the text itself
  where there is no `parse`.
- A value the cell already holds is no change and is left out. With a `parse`
  the comparison is `Object.is` against what the editor would open with — its
  `read`, or the column's `value` — exactly as a commit compares. Without one
  the text *is* the value, so it is compared with what the cell reads as: `"2"`
  pasted over the number `2` changes nothing.
- A column with no editor, or a row its editor's `editable` refuses, is
  read-only, and refuses any change.
- `validate` refuses the rest or lets them through.

Changes come to `onPaste` as `GridEditChange`s — your `item`, its `rowKey`, the
`rowIndex` it had in the view, the `columnId`, `previous` and `value` — to apply
by `rowKey` or `item`, never by `rowIndex`, just as for a commit. Without
`editors` there is no editing to borrow rules from: every cell takes the text as
it came, uncompared by type, and what to make of it is yours.

**A paste is refused whole.** If any cell refuses, nothing reaches `onPaste`:
`onRefuse` gets every refusal, not the first one, so the reader fixes the
clipboard once rather than once per complaint. A paste is one gesture, and half
of one is a rectangle with holes in it that the reader has to find cell by cell.
A `GridPasteRefusal<T>` carries the cell — `item`, `rowKey`, `rowIndex`,
`columnId`, `previous` — what the paste would have written there as `value` and
`text`, and a `reason`: `'read-only'` with a `null` message, or `'invalid'` with
the message `validate` gave.

A read-only cell pasted with what it already shows is not a change, so it is not
a refusal either. That is what lets a whole copied row, its identifier column
with it, go back over the row it came from — and what still refuses the same row
pasted over a different one.

**A paste too big for the grid is cut, and says so.** Rows past the last row and
columns past the last column are dropped rather than written, counted in
`truncated`, and handed to `onPaste` beside the changes; the announcement says
how many of how many cells went in. They are never read: a paste of ten
thousand lines onto the last row costs one row's worth of work. The grid does not
grow, because the rows are yours, and a row to append is not something a grid
can make up.

**A paste follows its cell across the wait.** Reading the clipboard can wait on
a permission prompt for as long as the reader takes to answer it, and a sort or
a refresh can move the rows meanwhile. The cell the paste was aimed at is held by
its row's key and its column's id, as an edit session is, and found again when
the clipboard answers; a paste whose row or column has gone ends as `gone`
rather than landing on whatever slid into its place. That needs the same
`getRowKey` the grid has. Given a different one — or none, on a keyed grid —
a paste cannot find its row again and ends as `gone`, and in development the
console says why.

### The keyboard

| Keys | Does |
|---|---|
| Ctrl + C, Cmd + C | Copy the range, or the cell under the cursor |
| Ctrl + V, Cmd + V | Paste from the corner of the range, or from the cursor |

Taken from the browser when they act, so it does not also copy or paste whatever
else it thinks is selected on the page. Left to the page when they do not: on
the column header, which is not data; in an empty grid; while an editor is open,
because then the text field owns the clipboard; and from any field someone types
into, such as a search box you put in a header. With Shift or Alt, neither
key is the shortcut — Ctrl+Shift+V is "paste as plain text" to the browser, and
is left to it.

On a layout that types another script, Ctrl with the key a Latin layout calls C
still copies: Cyrillic "с" reports its own letter, so the physical key decides
wherever the letter is not a Latin one. A Latin letter always decides for itself,
accented or not, so on Dvorak it is the key labelled C that copies, wherever it
sits, and Neo's "ä" on that key is not copy. A key that types no letter is no
shortcut at all — the rule [history](#undo-and-redo) keeps for Z and Y.

### When the clipboard says no

The keyboard goes through the asynchronous Clipboard API, not the `copy` and
`paste` events. Those fire where the browser thinks there is something to copy
or somewhere to paste — a text selection, an editable field — and a focused grid
cell is neither, so an engine is free to send them nowhere. The price is the
API's own, and each part of it ends as a result rather than an exception:

| `reason` | When |
|---|---|
| `unavailable` | There is no `navigator.clipboard` — outside a secure context it is absent, not failing — or, for a copy, no `ClipboardItem` to write two formats with |
| `refused` | The browser or the reader said no: a denied permission, a document without focus. `error` is what the API rejected with |
| `empty` | A paste found nothing that reads as cells — no text, no table |
| `gone` | The cell a paste was aimed at left the view while the clipboard was read |

Each is said aloud, assertively, as a refused paste is — "Could not copy",
"Could not paste", "Nothing to paste", "Nothing pasted: 2 cells refused" — and a
copy or paste that worked is said politely: "Copied 4 cells", "Pasted 6 cells".
A copy changes nothing on screen, so without a sentence a screen-reader user
cannot tell a Ctrl+C that worked from one that did not.

Both methods start their clipboard call before anything is awaited, because a
browser that ties clipboard access to a gesture checks for one when the call
starts. Reading can raise a permission prompt or a Paste button of the
browser's own, and the grid waits on it. The same holds for your own buttons:
call `copy()` or `paste()` from the click handler itself, not after an `await`.

There is no fallback outside a secure context. The older `execCommand` route
cannot read the clipboard at all, so paste would be missing anyway, and a grid
that copied out but could not paste back in would be half of the feature looking
like all of it. The primitives' [copy button](./primitives-forms.md#copying-createclipboard) does fall
back, for a single string, which is all it needs.

### Keeping one text node per change

A copy reads each cell it copies — its column's `value`, once, without
subscribing — and no other. A paste reads each cell it lands on, for the value
it would replace, and no other. Neither writes anything the cells render from,
so nothing re-renders when you copy or paste, and nothing changes on screen
until you apply the changes. Then it is one text node per changed cell, if your
columns read signals, exactly as for a commit. Nor does either subscribe whatever
called it: a copy or a paste started inside an effect leaves it depending on
nothing — not a cell, not the `grid` option, and not the locale a failure is
announced in.

### What it deliberately does not do

- **Fill.** One value pasted over a range goes into the range's corner, not into
  every cell of it, and a block is not repeated to fill a bigger range. A paste
  is always the clipboard's size, from one corner.
- **Grow the grid.** What runs past the last row or column is dropped and
  reported, never appended.
- **Paste part of a paste.** One refusal refuses it all, and says where every
  refusal is.
- **Cut.** Ctrl+X is left to the page. A cut is a copy and a list of changes
  that empty the cells, and emptying is a paste of empty text you can make
  yourself.
- **Copy headers, formats or styles.** The copy is values as text; the HTML is a
  bare table. A spreadsheet will make of "007" what it makes of it anywhere.
- **Listen to the browser's own menus.** The Edit menu and the context menu fire
  `copy` and `paste` events, which this does not handle. A menu item of your own
  calls `copy()` and `paste()`.
- **Mark what was copied.** There are no props: the range the grid already marks
  is what was copied, and a dashed "copied" border that outlived it would be one
  more thing to clear.

## Undo and redo

```ts
createEditHistory<T>(options: GridEditHistoryOptions<T>): GridEditHistory<T>
```

Editing hands you a change and never writes a row, so history cannot undo by
writing one either. Instead it is the road a change takes to your store: a
commit, an undo and a redo are each handed to one function of yours, `apply`,
and only what `apply` says it took is recorded. A write the server refused never
reaches the undo stack, and an undo the server refused leaves its step where it
was, to be tried again. A history that recorded first and hoped would offer a
Ctrl+Z that "undoes" a value no store ever held.

So the wiring changes in one place: `onCommit` hands the change to history
instead of to your store, and `apply` is where every write happens.

```ts
import { Component, Signal } from '@voltdev/core';
import {
  createCellEditing,
  createEditHistory,
  createGrid,
  type GridColumnView,
  type GridEditChange,
  type GridRow,
} from '@voltdev/grid';

/** Your rows with the changes in them — each changed row a new object, the rest as they were. */
function withChanges(people: readonly Person[], changes: readonly GridEditChange<Person>[]): Person[] {
  const byId = new Map(people.map((person) => [person.id, person]));
  for (const change of changes) {
    const person = byId.get(change.item.id)!;
    byId.set(person.id, { ...person, [change.columnId]: change.value });
  }
  return people.map((person) => byId.get(person.id)!);
}

@Component({ selector: 'v-people-editor', templateUrl: './people-editor.html' })
export class PeopleEditor {
  grid = new Signal.State<Element | null>(null);
  scroller = new Signal.State<Element | null>(null);
  container = new Signal.State<Element | null>(null);
  people = new Signal.State<Person[]>([]);

  table = createGrid<Person>({
    grid: () => this.grid.get(),
    scroller: () => this.scroller.get(),
    container: () => this.container.get(),
    rows: () => this.people.get(),
    columns: () => COLUMNS,
    getRowKey: (person) => person.id,
  });

  editing = createCellEditing<Person>({
    grid: () => this.table,
    columns: () => COLUMNS,
    editors: () => ({ name: {}, department: {} }),
    // Not to the store: through history, which records it once apply has written it.
    onCommit: (change) => void this.edits.commit(change),
  });

  // `edits` and not `history`: a template reads `history` as the browser's own.
  edits = createEditHistory<Person>({
    grid: () => this.table,
    rows: () => this.people.get(),
    getRowKey: (person) => person.id,
    editing: () => this.editing,
    apply: (step) => {
      this.people.set(withChanges(this.people.get(), step.changes));
      return true;
    },
  });

  cellProps(row: GridRow<Person>, col: GridColumnView<Person>) {
    return { ...this.table.cellProps(row, col), ...this.editing.cellProps(row, col) };
  }

  // Editing first, history second, the grid last: each claims only the keys it owns.
  onKey(event: KeyboardEvent): void {
    if (!this.editing.onKeyDown(event) && !this.edits.onKeyDown(event)) this.table.onKeyDown(event);
  }
}
```

```html
<!-- people-editor.html: the grid as in Editing, with its :keydown onKey($event);
     this is the toolbar above it -->
<div role="toolbar" aria-label="Edits">
  <button :disabled="!edits.canUndo()" :click="edits.undo()">Undo</button>
  <button :disabled="!edits.canRedo()" :click="edits.redo()">Redo</button>
</div>
```

With a server, `apply` is where the request goes, and its answer is the answer:

```ts
apply: async (step) => {
  const response = await fetch('/api/people', {
    method: 'PATCH',
    body: JSON.stringify(
      step.changes.map(({ rowKey, columnId, previous, value }) => ({ id: rowKey, columnId, previous, value })),
    ),
  });
  if (!response.ok) return false;
  this.people.set(withChanges(this.people.get(), step.changes));
  return true;
},
```

`previous` travels with each change so the server can refuse one whose cell
someone else has changed since — an undo hands back as `previous` the value it
expects to find there.

Call `createEditHistory` where a component's fields are initialised, as the grid
is: it reads the nearest locale, for what it says aloud. It creates no effect.

### `GridEditHistoryOptions`

| Option | Default | Description |
|---|---|---|
| `grid` | required | `() => Grid<T> \| null \| undefined` — where a row sits in the view, and where the cursor goes after a keyboard undo |
| `rows` | required | `() => readonly T[]` — the same rows the grid has. Every row, not the view: a row a filter hides still exists |
| `getRowKey` | required | `(row) => GridRowKey` — the same key the grid has. Required here where the grid defaults it to the index |
| `apply` | required | `(step: GridHistoryStep<T>) => boolean \| Promise<boolean>` — write the step and say whether it took. The only way history changes a value |
| `editing` | — | `() => GridCellEditing<T> \| null \| undefined` — while its session is open the keys are the editor's, and undo and redo are refused |
| `depth` | `100` | Steps kept. The oldest goes when a new one would pass it. `0` keeps nothing and still hands every commit to `apply` |
| `onSkip` | — | `(skipped: GridHistoryRecord[], kind) => void` — told which changes were left out because their row has gone |
| `announcement` | the locale's `gridUndone` / `gridRedone`, then English | `(kind, count) => string` — said when an undo or redo has been applied. `''` says nothing |

### `GridEditHistory`

| Member | Description |
|---|---|
| `commit(change)` | Hand a change — or an array of them, which is one step — to `apply`, and record it once `apply` says it took. Clears redo when it is recorded. Resolves whether it was applied |
| `undo()` | Hand the last step's inverse to `apply`, and move the step to redo once it took. Resolves whether it did |
| `redo()` | Hand the last undone step to `apply` again, and move it back once it took |
| `canUndo()`, `canRedo()` | Whether there is a step to take back or make again — `false` for both while an editor is open. Signals: a toolbar bound to them follows |
| `clear()` | Forget every step. For data replaced wholesale — a reload, another record — whose rows the kept steps no longer describe |
| `onKeyDown(event)` | The history keyboard. After the editing layer's `onKeyDown`, before the grid's |

`commit` takes anything with `item`, `columnId`, `previous` and `value` — a
`GridEditChange` as editing hands it over, or the cells of a paste. The key is
worked out again from `item` with history's own `getRowKey`, and whatever
`rowKey` and `rowIndex` the change carried are not kept: a place in the view
stops being true at the next sort.

A step reaches `apply` as a `GridHistoryStep<T>`: its `kind` — `'commit'`,
`'undo'` or `'redo'` — and its `changes`, each a `GridEditChange<T>`, so the
function that writes an edit writes an undo without knowing the difference. Each
change is resolved against your rows as they are when `apply` is called: `item`
is the row that holds the key now — which, for a store that replaces rows as the
one above does, is not the object the edit was made to — and `rowIndex` is
where that row sits in the view now, or `-1` where a filter hides it. For an
undo, `previous` and `value` are the recorded ones swapped, and the changes come
last first, so a cell a step wrote twice ends as it was before either.

### The keyboard

| Keys | Does |
|---|---|
| Ctrl + Z, Cmd + Z | Undo |
| Ctrl + Shift + Z, Cmd + Shift + Z | Redo |
| Ctrl + Y | Redo |

While the grid has focus and no editor is open. Ctrl+Y and not Cmd+Y, because on
a Mac Cmd+Y is the browser's history. Alt is never part of it: Ctrl+Alt is AltGr
on many keyboards, and types characters. A key that types a Latin letter is
matched on that letter, so a layout that puts Z elsewhere — German, French —
undoes with the key marked Z. A key that types a letter of another script is
matched on where it sits, so the key a Russian or Greek keyboard types я or ζ
with, which is where a Latin layout has Z, undoes too, as it does in the page's
own text fields. A key that types no letter is never the shortcut: Dvorak types
a semicolon where QWERTY has Z, and Ctrl+; is not an undo.

A key pressed in a text control inside the grid — an editor, a search box in the
header — is left to it, because Ctrl+Z there is the text's own undo. So is every
key while an editing session is open, even with focus still on the cell rather
than in the control: given `editing`, history asks it, and does not rely on your
having wired the editor's handler first. The shortcut is claimed, and its
default prevented, even with nothing to undo — it means this grid's undo while
the grid has focus.

While an editor is open, `undo()` and `redo()` resolve `false` at once, called
from anywhere, even with a save still out ahead of them. Queued, they would run
once the editor had closed, and whether they ran at all would turn on how slow
that save was.

### Recorded once it is true

`apply` returns — or resolves — `true` once the step is written and `false`
where it was refused, and only `true` records anything. A refused commit is not
on the undo stack. A refused undo stays on it, and redo is untouched, so the
reader can try again. Refuse by returning `false`, not by throwing: a throw is
an error rather than an answer, and is handed back through the promise that
asked for the step — which, for a key, nothing awaits, so it surfaces as any
unhandled rejection does. Either way nothing is recorded, and the next step
still runs.

A change that leaves its value as it was is dropped before it reaches `apply`,
and `commit` resolves `false` — as editing reports nothing for a cell the reader
opened and closed, and for the same reason: a step of nothing would spend a
Ctrl+Z on a value nobody would see move.

**One step at a time.** Steps are handed to `apply` in the order they were asked
for, each once the one before has settled. Two undos pressed while a save is out
take back two steps rather than one step twice, a commit made during an undo
lands after it, and two writes to one cell cannot reach the server in the wrong
order. The step to undo is the top of the stack *when its turn comes*, so a
Ctrl+Z pressed while an edit is still saving takes back that edit once it has
landed. An `apply` that answers at once, like the one above, is never kept
waiting: every step runs inside the call that asked for it.

**One step per gesture.** A paste of forty cells is one step, undone and redone
whole: forty Ctrl+Zs to take back one paste is a paste nobody dares make.

### Held by key

A step names each cell by its row's key and its column's id, and is resolved
when it is applied. A sort between an edit and its undo moves the row, and the
undo follows it. That holds on a grid given no `getRowKey`, too: the grid's key
is then the row's place, which editing reports as the change's `rowKey`, but
history keys by its own `getRowKey` over the change's `item` and is not fooled
when the sort hands the place to another row.

A row a filter hides still exists, and its change is still undone, with
`rowIndex` `-1`. A row gone from your data is skipped: `onSkip` is told which
changes were left out, and `apply` is handed the rest. What moves to the other
stack is what was written — a row that comes back later is not written over by
a redo of a change its undo never made. A step with nothing left is dropped,
`apply` is not called, and the promise resolves `false`; the next Ctrl+Z reaches
the step below. Keeping it would spend a Ctrl+Z doing nothing every time it came
round.

### Where the cursor goes

A keyboard undo or redo puts the cursor, and focus, on the first cell the step
changes — the one nearest the top of the view, then the left, which for a paste
is its corner. The cursor moves as the step is handed to `apply`, not when
`apply` answers: the grid carries a cursor with its row when the view changes,
so a cursor put there before the write goes wherever the write's re-sort takes
that row. It also puts a reader waiting on a slow save on the cell whose value
is about to change — including one whose change is then refused.

It moves only if the reader is still where they pressed the key: focus in the
grid, the cursor on the same row and column. A step that waited its turn behind
a save does not drag back a reader who has moved on, or pull focus back from
wherever they went. Scrolling is not moving on: scrolling the body takes the
focused cell out of the window, and focus with it, but the cursor has not moved
and the step still takes the reader to its cell — as the grid itself still
counts focus as on a cursor whose cell was scrolled away. A step whose rows a
filter hides leaves the cursor alone, and so does an undo from a button — the
reader is on the button, and taking focus from it would move them off the
control they are using.

An undo or redo that was applied is announced — "Change undone", "3 changes
undone", "Change redone" — from the locale's `gridUndone` and `gridRedone`, with
`{n}` the count, or in English where the catalogue has neither. A commit is not:
the reader has just watched it happen.

### What it costs

History reads no cell. A step holds the values it was given, and an undo hands
back `previous` rather than asking the cell what it holds, so undoing a change
costs what committing it did: your `apply` writes, and if the column's `value`
reads a signal, one accessor runs and one text node changes. The buttons bound
to `canUndo` and `canRedo` re-read nothing in the grid.

Finding a row by key is a lookup, not a scan: `rows` is read into an index once
per change to it, and a store that writes a cell's signal rather than replacing
the array pays for that once however many steps go by. One that replaces the
array on every write, as `withChanges` above does, rebuilds it once per step.
Where a row sits in the view, which each change carries as `rowIndex`, is found
the same way: the view is read into an index the first time a step asks after
the view changed. That is once however many steps go by for an unsorted grid
over a store that writes signals, and once per step where every write moves the
view — a replaced array, or a sort on the column being written. Neither index
runs an accessor.

### What it does not do

- **Check the cell before undoing it.** An undo hands back the value history
  recorded, not the value the cell holds now; if someone else changed the cell
  since, the undo writes over them. `previous` is there for your server to
  refuse it.
- **Record changes it did not apply.** There is no way to push a change you
  wrote yourself onto the stack. Everything goes through `commit`, so that one
  function writes and history never records an undo of its own as a new change.
- **Undo sorting, filtering, resizing or grouping.** Only cell values. Those are
  views over your rows, not changes to them, and each is already a value you can
  hold and hand back.
- **Undo the text in an open editor.** That is the control's own undo, and
  history leaves it alone.
- **Hold a cell shut while a step is saving.** Undo and redo are refused while
  an editor is open, but a step already handed to a slow `apply` still lands
  if the reader opens its cell meanwhile. The editor keeps the value it opened
  with, and its commit records that value as `previous`, so undoing the edit
  puts back what the earlier step had taken away.
- **Reselect a paste's range.** The cursor goes to its corner; the cell range
  does not come back.
- **Survive a reload.** The stacks live in memory, and hold values as they were
  handed over.
- **Undo a grouped grid's hidden rows.** Over `createGrouping`, the rows history
  is given are the grouping's collection, which leaves out the rows of a
  collapsed group and the rows the grouping's filter hides. So a change to one
  of those is skipped as gone, where an ungrouped grid's filter hides a row
  without history losing it. Expanded, or with the filter cleared, before an
  undo comes round to it, the row is found again; an undo that comes round while
  it is hidden skips it for good.

## Exporting

```ts
createExport<T>(options: GridExportOptions<T>): GridExport
```

An export is a file of what the grid is showing — the view, not your array. The
rows are in the order the sort put them, without the ones a filter took out,
with a grouping's headers where the reader sees them, under the columns the grid
holds in the order it holds them. A reader who presses Export is asking for the
table in front of them. A file of your source array would give them rows they
had filtered away, in an order they never asked for.

It comes in two formats: CSV that follows RFC 4180 exactly, and a real Excel
workbook, written without a dependency. Either way the result is a `Blob` and a
suggested filename, and nothing is saved. A download is an anchor in a browser,
a write to disk in a desktop shell and a buffer to inspect in a test, so saving
is yours. Grouping and editing hand you a view or a change rather than acting on
it, and export hands you a file on the same terms.

```ts
import { Component, Signal } from '@voltdev/core';
import { useLocale } from '@voltdev/primitives';
import { createExport, createGrid, type GridColumn, type GridExportFile } from '@voltdev/grid';

interface Person {
  id: number;
  name: string;
  department: string;
  salary: number;
  started: Date;
}

@Component({ selector: 'v-people-export', templateUrl: './people-export.html' })
export class PeopleExport {
  grid = new Signal.State<Element | null>(null);
  scroller = new Signal.State<Element | null>(null);
  container = new Signal.State<Element | null>(null);
  people = new Signal.State<Person[]>([]);
  exporting = new Signal.State(false);
  // The application's locale, not the runtime's: "$120,000.00" in English,
  // "120.000,00 $" in German.
  locale = useLocale();

  columns: GridColumn<Person>[] = [
    { id: 'name', header: 'Name', value: (p) => p.name },
    { id: 'department', header: 'Department', value: (p) => p.department },
    // The cell shows formatted text, and sorts by the value underneath it.
    {
      id: 'salary',
      header: 'Salary',
      value: (p) => this.locale.format.currency(p.salary, 'USD'),
      sortValue: (p) => p.salary,
      width: 120,
    },
    {
      id: 'started',
      header: 'Started',
      value: (p) => this.locale.format.date(p.started),
      sortValue: (p) => p.started,
    },
  ];

  table = createGrid<Person>({
    grid: () => this.grid.get(),
    scroller: () => this.scroller.get(),
    container: () => this.container.get(),
    rows: () => this.people.get(),
    columns: () => this.columns,
    getRowKey: (person) => person.id,
    label: 'People',
  });

  exporter = createExport<Person>({
    grid: () => this.table,
    columns: () => this.columns,
    // The grid shows text; the file keeps the number and the date underneath it,
    // so the salary column still sums and the dates still sort.
    format: () => ({
      salary: (_, person) => person.salary,
      started: (_, person) => person.started,
    }),
  });

  async download(kind: 'csv' | 'xlsx'): Promise<void> {
    this.exporting.set(true);
    try {
      save(kind === 'csv' ? await this.exporter.csv({ bom: true }) : await this.exporter.xlsx());
    } finally {
      this.exporting.set(false);
    }
  }
}

// Saving is yours. In a browser it is an anchor with a `download` attribute.
function save({ blob, filename }: GridExportFile): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked after the click has been handled, not during it.
  setTimeout(() => URL.revokeObjectURL(url));
}
```

```html
<!-- people-export.html: a toolbar above the grid, which is as in "Setting one up" -->
<div class="people-toolbar">
  <button type="button" :click="download('csv')" :disabled="exporting.get()">Export CSV</button>
  <button type="button" :click="download('xlsx')" :disabled="exporting.get()">Export Excel</button>
</div>
<div class="people" :ref="grid" :spread="table.gridProps()"
     :keydown="table.onKeyDown($event)"
     :focusin="table.onFocusIn($event)">
  <!-- …the header and body, unchanged -->
</div>
```

The files are `People.csv` and `People.xlsx`, named after the grid's `label`.
The buttons are disabled while an export runs. The page itself stays live,
because an export yields as it goes ([Large exports](#large-exports) says how),
and a second press would start a second export alongside the first.

`createExport` creates no effect and reads nothing until it is asked for a file,
so it can be called anywhere, not only where a component's fields are
initialised.

### `GridExportOptions`

| Option | Default | Description |
|---|---|---|
| `grid` | required | `() => Grid<T> \| null \| undefined`. A function, because the grid is usually a field declared first. A call with no grid rejects |
| `columns` | required | Column definitions: the list the grid is given, or one holding every column it could hold. [Which are written](#which-rows-which-columns-which-values) is the grid's answer |
| `format` | — | `() => Record<columnId, (value, row) => unknown>`: what a column's cells become in the file |
| `outlineLevel` | — | `(row) => number`: a row's outline level in a workbook, `0` to `7`. For a grouped grid, `(row) => row.depth`. A CSV ignores it |
| `name` | the grid's `label`, else `'export'` | `() => string`: the file's name without its extension, and the worksheet's |
| `cellsPerSlice` | `5000` | How many cells are read between one yield and the next, in whole rows |

### `GridExport`

| Member | Description |
|---|---|
| `csv(options?)` | The view as RFC 4180 CSV, header row first. `Promise<GridExportFile>` |
| `xlsx(options?)` | The view as an Excel workbook of one worksheet. `Promise<GridExportFile>` |

| Call option | On | Default | Description |
|---|---|---|---|
| `bom` | `csv` | `false` | Begin the file with a UTF-8 byte order mark |
| `signal` | both | — | An `AbortSignal`. The export stops at the next yield and rejects with the signal's reason, an `AbortError` unless you gave another |

A `GridExportFile` is `{ blob, filename }`. The blob's type is
`text/csv;charset=utf-8;header=present` or
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, and the
filename has its extension. The name is made safe to save under: the characters
Windows refuses anywhere in a name become spaces, the spaces and dots it drops
from the ends are dropped, and a name left empty becomes `export`.

### Which rows, which columns, which values

**The rows are fixed when you ask; the values are read as the file is
written.** The call takes the view in one synchronous pass, every row in order,
and reads no cell to do it: with nothing sorted or filtered the view is your
array, and its objects are handed back as they are. So a sort, a filter or new
data arriving while a long export runs cannot duplicate a row or drop one. The
cells are read slice by slice after that, because reading them is the work
being spread out. A value you write during an export is in the file only if its
row had not been reached yet.

**The columns are the grid's.** The grid renders only the window of its
columns, and names the rest by id, so `columns` is where the export finds each
column's accessor and header. It asks the grid where each id sits and writes the
columns in that order, leaving out any the grid does not hold. You can hand it
the same list the grid has, or every column you define: either way the file
holds the columns the reader sees, in the reader's order. A column the grid
holds that `columns` gives no definition for is left out, and a development
build says so.

**A value is written by its type.** A column's own value is written as the grid
displays it. A `format` entry replaces it with whatever the function returns,
given the column's value and the row. The formatter is the place to hand the
file the number under a cell that shows "$1,000", the date under one that shows
"3 Feb", or a group's label. Whatever it returns is written by the same rules:

| Value | CSV | Workbook |
|---|---|---|
| `null`, `undefined`, `NaN`, `''` | an empty field | no cell |
| a string | the text, quoted and escaped as below | a shared string |
| a finite number | as JavaScript writes it: `-5`, `0.5`, `1e+21` | a number |
| `Infinity`, `-Infinity` | the text, escaped as below | a string |
| a bigint | its digits | a number where a double holds it exactly; otherwise its digits, as a string |
| a boolean | `true`, `false` | a boolean |
| a `Date` | `2024-01-05`, or `2024-01-05 14:30:00` with a time of day, and `.007` with milliseconds | a date: its serial number, shown as the reader's short date, or date and time |
| an invalid `Date` | an empty field | no cell |
| a `Date` before 1900 or after 9999 | as above | its text, as a string |
| anything else | its JSON | its JSON, as a string |

Dates are written in the reader's wall clock, the local fields rather than the
timestamp, because a worksheet's dates have no zone, and 9am in the grid has to
be 9am in the cell. A CSV of the same export says the same thing. A space
separates the date from the time rather than ISO 8601's `T`, because
spreadsheets read the space form back as a date and not all of them read the
`T` form. A value exactly at midnight is written as a date alone, in both
formats.

An object is written as its JSON because that is what the grid's cell shows:
a template's text binding renders an object as JSON. It is never written as
`String(value)`, which gives `[object Object]`, a value nobody saw. A value JSON
cannot write (a cycle, a bigint inside an object, a function) is left empty,
and a development build names the column once per export. Give that column a
formatter.

Every cell is read once, and untracked: one call of its accessor, and one of its
formatter where there is one. Nothing reads a value a second time to find out
its type. Starting an export inside an effect does not make that effect depend
on the grid's data.

### CSV

The file follows RFC 4180. It starts with a header record of the columns'
`header`s, the fields are separated by commas, every record ends with CRLF, and
a field is quoted only where it holds a comma, a quote or a line break, with its
quotes doubled. Spaces are part of a field and are left alone. The text is
UTF-8.

The one empty field quoted anyway is a record's only field. A grid of one
column writes an empty cell as `""` rather than as a blank line. RFC 4180 reads
a blank line as a record of one empty field, but readers that skip blank lines
(pandas does by default) would drop the row, and every row after it would be
read one row higher than it is.

There is no byte order mark unless you ask with `bom: true`. RFC 4180 has none,
and most readers do not want one. Excel does: without it, a CSV opened by
double-clicking is read in the system's legacy code page, and every accented
name in it comes out as two wrong characters. Ask for one when the file is for
Excel.

**Text that a spreadsheet would run as a formula is escaped.** An exported file
gets opened in a spreadsheet by someone who did not write the data in it. A
field beginning with `=`, `+`, `-`, `@`, a tab or a carriage return is a formula
to a spreadsheet, and a formula runs on the machine of whoever opens it:
`=HYPERLINK` can send the sheet's contents somewhere, and `=cmd|…` can run a
program in a spreadsheet that still honours DDE. Such a field is escaped the
way OWASP describes: an apostrophe in front, which a spreadsheet reads as
"this is text", and the whole field in quotes with its own quotes doubled, so
nothing inside it can close the field and start a new cell with the formula
after all. `=1+2";=1+2` is written `"'=1+2"";=1+2"`. Headers are escaped the same
way, since a header can come from data too.

Numbers and bigints are exempt. Their text is written by the export from a
number, never copied from the data's own characters, so it cannot carry a
formula. `-5` the number is written `-5`, while `-5` the string is written
`"'-5"`. The apostrophe shows when a spreadsheet opens the file, which is the
cost of OWASP's escape. If a column's `-` values are numbers, return numbers
from its formatter rather than text.

Numbers are written with a point, as JavaScript writes them, never in the
locale's format. In a comma-separated file, a decimal comma would split one
field into two.

### The workbook

`xlsx()` writes an Office Open XML package, which is what a `.xlsx` is: a zip
of a workbook, one worksheet, a stylesheet and a table of shared strings. It is
built here, deflated through the platform's `CompressionStream`, and needs no
dependency.

- **Typed cells.** Numbers are numbers, booleans are booleans, dates are date
  serials in a date format, and text is a shared string: each distinct text is
  stored once and every cell holding it refers to it. A text cell is a string
  and never a formula, so nothing in a workbook needs the CSV escape, and
  `=SUM(A1:A9)` arrives as the text it was.
- **Dates in the reader's own order.** The formats are the workbook's built-in
  short date and date-and-time, which a spreadsheet shows in the reader's locale,
  so a German reader sees `05.01.2024` and an American `1/5/2024`. Before 1 March
  1900 a serial is one lower than the arithmetic says, because every
  spreadsheet counts a 29 February 1900 that never was. That is a bug kept since
  Lotus 1-2-3, and the export keeps it too so that the dates come out right.
- **A bold header row.** The columns' `header`s, in bold. Nothing else is
  styled.
- **Columns as wide as the grid draws them.** A worksheet measures width in
  digits of its default font, and the stylesheet declares Calibri 11, whose
  digit is 7px wide, so a column the grid draws at 180px is 180px wide in Excel
  at 100%. LibreOffice measures the font its own way and draws every column
  about a fifth wider, in proportion. A column in the grid's horizontal window is as wide as the reader
  left it after resizing. The grid does not report the width of a column outside
  that window, so such a column is written at its declared `width`, clamped to
  its bounds as the grid clamps it. A column resized and then scrolled out of
  view exports at its declared width.
- **The worksheet's name** is the file's name, as a worksheet will take it:
  without `\ / ? * [ ] :`, without an apostrophe at either end, at most 31
  characters, and `Sheet1` where that leaves nothing or leaves `History`, which
  a spreadsheet reserves.
- **The same view gives the same bytes.** The zip's timestamps are fixed rather
  than taken from the clock.

A worksheet has limits, and the export refuses before it reads a single cell
rather than write a file the spreadsheet can open only by throwing part of it
away. More than 1,048,575 rows (a worksheet holds 1,048,576, the header
included) or more than 16,384 columns rejects with a `RangeError`. Filter the
grid first, or export CSV, which has no limit. A text longer than the 32,767
characters a cell holds is cut to fit, never between the two halves of a
surrogate pair, and a development build names the column. A sheet whose text
passes 4 GiB is refused too, with a `RangeError`, but only when the text gets
there: see Zip64 under [What it does not do](#what-it-does-not-do).

Text XML cannot carry is escaped the way a spreadsheet escapes it: a control
character, including a carriage return, is written `_xHHHH_`. A literal
`_x0041_` in your data has its underscore escaped the same way, so it is not
decoded into an `A`. A text with a space at either end is marked to keep it.

### Large exports

An export of a hundred thousand rows is too much work for one task: the page
would freeze until it finished. So an export is written in slices, and yields
between them:

1. **The view is taken first,** in one synchronous pass over the rows (not the
   cells). For a million rows this is a few milliseconds, and it is what fixes
   the rows the file will hold. A workbook asks `outlineLevel` of every row in
   the same pass, because a sheet declares its outline before its first row,
   so keep that function to a field read like `row.depth`. Placing the columns
   asks the grid where each one sits, which is a scan of its column list per
   column: nothing at a few hundred columns, and half a second at a
   worksheet's limit of 16,384.
2. **Each slice reads at most `cellsPerSlice` cells,** as whole rows: 5,000 by
   default, which is 500 rows of a ten-column grid. The slice is turned into
   text, and for a workbook it is encoded, checksummed and handed to the
   compressor.
3. **Between slices the export gives the thread back,** with `scheduler.yield()`
   where the browser has it and a `MessageChannel` task where it does not. Not
   `setTimeout`, which browsers clamp to 4ms once calls nest, and an export of
   two hundred slices nests two hundred calls. Input, rendering and anything
   else waiting run in between.
4. **Each slice becomes a `Blob` as it is written, and the file is those
   `Blob`s joined.** For a CSV, the slice's text goes into a `Blob` of its own.
   For a workbook, each chunk of compressed bytes goes into one as the
   compressor hands it over. Joining `Blob`s copies nothing, so finishing the
   file is quick however large it is. A file handed all its text at the end
   would have to encode every character in that one task: about half a second
   for 100 MB, which is the freeze the slices exist to avoid. Nothing joins the
   sheet into one string or one buffer.

An export small enough to fit in one slice never yields. Lower `cellsPerSlice`
if your accessors or formatters are expensive. The count is of cells rather
than rows, so a wide grid gets fewer rows per slice.

To stop an export, pass a `signal` and abort it. The export stops at the next
yield and rejects with the signal's reason. A signal already aborted rejects
before anything is read.

```ts
private running: AbortController | null = null;

async downloadWorkbook(): Promise<void> {
  this.running?.abort();
  const running = (this.running = new AbortController());
  try {
    save(await this.exporter.xlsx({ signal: running.signal }));
  } catch (error) {
    if (!running.signal.aborted) throw error;
  }
}
```

### A grouped grid

A grouped grid's rows are the grouping's wrappers, so the export is typed over
`GridGroupedRow<T>` and given the grouping's columns. Two options finish it:
`outlineLevel` tells a workbook where each row sits, and a formatter puts each
group's label where your template renders it.

```ts
exporter = createExport<GridGroupedRow<Person>>({
  grid: () => this.table,
  columns: () => this.grouping.columns(),
  // A header sits at its group's depth, and the rows under it one deeper:
  // exactly the outline a spreadsheet folds.
  outlineLevel: (row) => row.depth,
  // The label is in no column's value, so it goes where the template puts it.
  format: () => ({
    name: (value, row) => (row.kind === 'group' ? this.grouping.label(row) : value),
  }),
});
```

A group header's other columns hold their aggregates, typed like any other
value, so a sum under a header is a number in the workbook. The worksheet
declares its outline with each group's summary *above* its rows, because that
is where a grid's group header sits, and a spreadsheet draws its fold buttons
from that. The outline is at most seven levels deep, the most a worksheet has;
deeper levels are written as seven. A CSV has no outline, and its rows come out
in the same order without one.

A collapsed group exports as its header alone. Its rows are not in the view, so
the reader does not see them and they are not in the file. Call `expandAll()`
first to export every row.

### What it does not do

- **Save the file.** No download is started and nothing is written to disk.
  `save` above is one way, and a test reads the blob instead.
- **Export anything the reader cannot see.** That means rows a filter removed,
  rows inside a collapsed group, columns the grid does not hold, and your source
  array. Exporting only the selected rows, or only a cell range, is not built
  either.
- **Style beyond the bold header.** There are no number formats (a currency, a
  count of decimals), no colours, no borders, no frozen header row, no
  autofilter and no auto-sized columns. Group headers are not styled apart from
  the rows under them.
- **Write more than one worksheet, a formula, or a merged cell.**
- **Write a CSV for a comma-decimal locale.** RFC 4180 separates fields with a
  comma, and so does this. Excel set to a locale whose list separator is `;`
  (German and French among them) splits a double-clicked CSV at each `;`
  instead, and leaves the commas inside the cells. A value with a `;` before
  `=`, `+`, `-` or `@` then starts a cell of its own with a formula in it. The
  escape above does not reach that cell, because it looks only at the start of
  a field. For a file opened in such a locale, or holding data you do not
  trust, export the workbook: its text cells are never formulas.
- **Snapshot the values.** The rows are fixed when you ask, but each value is
  read when its slice is written.
- **Report progress or announce anything.** A download is visible in the
  browser's own interface. A long export has no progress callback; disable the
  control that started it, as above.
- **Write Zip64.** A zip without it cannot record a part of more than 4 GiB.
  At the worksheet's limit of a million rows, a sheet's text reaches that at
  roughly a hundred columns. The export refuses with a `RangeError` when a part
  passes it, rather than write a file whose headers wrap round to a size that
  is wrong. It cannot know sooner, because the size is only known once the text
  is written, so the refusal comes partway through. Filter the grid first, or
  export CSV.
- **Run in a worker, or stream to disk.** The slices keep the page responsive,
  but the work is on the main thread, and the finished file is held in memory as
  the blob's parts.
- **Know a resized column's width once it scrolls out of the window.** The grid
  does not report it, so the declared width is written.

## Saving and restoring a view

```ts
createGridState<T>(options: GridStateOptions<T>): GridStateLayer<T>
```

A reader who puts the salary column first, hides the notes, widens the names,
sorts, filters and groups by team has made something, and a reload that throws
it away has thrown away their work. `createGridState` turns all of it into one
plain object — `JSON.stringify` writes it and `JSON.parse` gives it back
unchanged — and turns that object back into the arrangement it describes.

It is also where column order and visibility live. Nothing else holds them: the
grid renders the list of columns it is handed, so reordering and hiding are a
matter of which list that is, and `columns()` here is that list, arranged.

Every piece of the arrangement is a signal you already hand the grid, or the
grouping, handed to this layer as well — the same arrangement `createGrouping`
asks for with its sort. Restoring writes those signals directly, so it is
silent: `setFilter` and `toggleSort` are gestures, they announce, and a grid that
announced a saved view on load would talk over the page.

```ts
import { Component, Signal, effect, onCleanup } from '@voltdev/core';
import {
  GRID_STATE_VERSION,
  createGrid,
  createGridState,
  type GridFilter,
  type GridSort,
  type GridStateLayer,
} from '@voltdev/grid';

const STORAGE_KEY = 'people-view';

/** Whatever was saved, or nothing — storage can be missing, full, or hold anything. */
function savedView(): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

@Component({ selector: 'v-people', templateUrl: './people.html' })
export class People {
  grid = new Signal.State<Element | null>(null);
  scroller = new Signal.State<Element | null>(null);
  container = new Signal.State<Element | null>(null);
  people = new Signal.State<Person[]>([]);

  // One of each, handed to the grid and to the view alike.
  sort = new Signal.State<readonly GridSort[]>([]);
  filters = new Signal.State<ReadonlyMap<string, GridFilter>>(new Map());
  quickFilter = new Signal.State('');

  // Typed, because the view and the grid each read the other.
  view: GridStateLayer<Person> = createGridState<Person>({
    grid: () => this.table,
    columns: () => COLUMNS,
    sort: this.sort,
    filters: this.filters,
    quickFilter: this.quickFilter,
  });

  table = createGrid<Person>({
    grid: () => this.grid.get(),
    scroller: () => this.scroller.get(),
    container: () => this.container.get(),
    rows: () => this.people.get(),
    columns: () => this.view.columns(),
    getRowKey: (person) => person.id,
    sort: this.sort,
    filters: this.filters,
    quickFilter: this.quickFilter,
    onColumnResize: this.view.onColumnResize,
    label: 'People',
  });

  // Before the first flush, so the save below never writes the default grid
  // over the view it is about to restore. Kept, in case the page wants to say
  // a saved view was too new to read.
  restored = this.view.apply(savedView());

  // A moment after the last change, not on every move of a drag.
  saving = effect(() => {
    const json = JSON.stringify(this.view.state());
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, json);
      } catch {
        // Full, or refused: the view is still arranged, just not kept.
      }
    }, 300);
    onCleanup(() => clearTimeout(timer));
  });

  toggleColumn(id: string): void {
    this.view.setColumnHidden(id, !this.view.isColumnHidden(id));
  }

  resetView(): void {
    this.view.apply({ version: GRID_STATE_VERSION });
  }
}
```

```html
<!-- people.html: the grid is any grid; the chooser lists every column, hidden or not -->
<fieldset class="chooser">
  <legend>Columns</legend>
  <label :for="col in view.allColumns()" :key="col.id">
    <input type="checkbox" :checked="!view.isColumnHidden(col.id)" :change="toggleColumn(col.id)">
    { col.header }
  </label>
  <button type="button" :click="resetView()">Reset view</button>
</fieldset>

<div class="people" :ref="grid" :spread="table.gridProps()"
     :keydown="table.onKeyDown($event)"
     :focusin="table.onFocusIn($event)">
  <div :spread="table.headerProps()">
    <div :spread="table.headerRowProps()">
      <div :for="col in table.columns()" :key="col.key"
           :spread="table.headerCellProps(col)"
           :click="table.onHeaderClick($event)">{ col.column.header }
        <span :spread="table.resizerProps(col)"
              :pointerdown="table.onResizePointerDown($event)"></span>
      </div>
    </div>
  </div>
  <div class="people-body" :ref="scroller" :spread="table.bodyProps()">
    <div :spread="table.sizerProps()">
      <div :ref="container" :spread="table.containerProps()">
        <div :for="row in table.rows()" :key="row.key" :spread="table.rowProps(row)">
          <div :for="col in table.columns()" :key="col.key"
               :spread="table.cellProps(row, col)">{ table.cellValue(row, col) }</div>
        </div>
      </div>
    </div>
  </div>
</div>
```

**The type on `view` is not optional.** The view reads the grid, for widths,
and the grid reads the view, for its columns. TypeScript cannot infer a pair of
class fields that refer to each other, and says so — "implicitly has type
`any`" — unless one of them is declared. Declaring the view's is the smaller
change.

**Restore before the first flush.** An effect's first run is deferred to the
next flush, so a `restored` field initialised after the grid runs before the
save does. Restore later — once a request for the saved view comes back — and
the save's first run writes the default arrangement over it; start saving only
once the restore has happened. The same goes for columns that arrive late:
restore against the columns you will render, because anything naming a column
that is not in the list yet is dropped.

Call `createGridState` where a component's fields are initialised, as
`createGrid` is: it creates an effect, which is disposed with the component that
owns it.

On a grouped grid, hand the grouping the view's columns and the signals it
filters and groups by; the grid is handed the grouping's columns, as ever:

```ts
groupBy = new Signal.State<readonly string[]>([]);
collapsed = new Signal.State<ReadonlySet<string>>(new Set());

view: GridStateLayer<Person> = createGridState<Person>({
  grid: () => this.table,
  columns: () => COLUMNS,
  sort: this.sort,
  filters: this.filters,
  quickFilter: this.quickFilter,
  groupBy: this.groupBy,
  collapsed: this.collapsed,
});

grouping = createGrouping<Person>({
  rows: () => this.people.get(),
  columns: () => this.view.columns(),
  groupBy: () => this.groupBy.get(),
  getRowKey: (person) => person.id,
  sort: this.sort,
  filters: this.filters,
  quickFilter: this.quickFilter,
  collapsed: this.collapsed,
});

table = createGrid<GridGroupedRow<Person>>({
  // ...the elements
  rows: () => this.grouping.rows(),
  columns: () => this.grouping.columns(),
  getRowKey: this.grouping.rowKey,
  sort: this.sort,
  onColumnResize: this.view.onColumnResize,
});
```

### `GridStateOptions`

| Option | Default | Description |
|---|---|---|
| `grid` | required | `() => grid \| null \| undefined` — the grid being arranged. All it is asked for is `resizeColumn`, so a grouped grid does as well as a flat one |
| `columns` | required | Every column, in its default order, hidden or not — the list a grid would be given if nothing were arranged |
| `order` | owned | A `Signal.State<readonly string[]>` of column ids in the reader's order |
| `hidden` | owned | A `Signal.State<ReadonlySet<string>>` of the hidden columns' ids |
| `sort` | not saved | The sort signal the grid is handed |
| `filters` | not saved | The filters signal — the grid's, or on a grouped grid the grouping's |
| `quickFilter` | not saved | The quick-filter signal, from the same place |
| `groupBy` | not saved | A `Signal.State<readonly string[]>` of column ids, read by the grouping's `groupBy` |
| `collapsed` | not saved | The collapsed signal the grouping is handed |

A piece you do not hand over is neither saved nor restored: `state()` carries
its empty value and `apply` leaves it alone. `order` and `hidden` are different,
because this layer is the only thing that holds them — supply them to drive the
order or the visibility from outside, as the grid lets you supply its sort, or
to start with a column hidden.

What the signals hold when `createGridState` is called is your page's own
arrangement, the one a first visit shows, and `apply` puts it back for whatever
a state leaves out. Give them their starting values before creating the view.

`groupBy` holds ids rather than `GridGroupSpec`s, because a spec carries
functions and a saved state cannot. Where a level needs a spec, map the id to
it where the grouping reads it:
`groupBy: () => this.groupBy.get().map((id) => SPECS[id] ?? id)`. A level is
read against your columns like everything else, so an id that names no column
is not saved. To group one column two ways — a date by year, then by month —
list its id at both levels and pick each level's spec by its position.

### `GridStateLayer`

| Member | Description |
|---|---|
| `columns()` | The columns to render: the reader's order, no hidden ones, restored widths in place. For the grid's `columns`, or the grouping's |
| `allColumns()` | Every column in the reader's order, hidden ones included — what a column chooser lists |
| `isColumnHidden(id)` | Whether a column is hidden |
| `setColumnHidden(id, hidden)` | Hide or show one. An id not in `columns` is ignored |
| `moveColumn(id, index)` | Move one to a place in `allColumns()`, clamped to the ends |
| `onColumnResize` | For the grid's `onColumnResize`. How a width the reader chose reaches the state |
| `state()` | The arrangement now, as a `GridState`. A signal: read it in an effect to persist it |
| `apply(state)` | Restore one. Returns a `GridStateApplyResult` |

`columns()` is the same array for as long as the arrangement is: a sort, a
filter, a resize, or your own column list handed over again as a new array
hands the grid no new list — which matters, because a new column list makes a
sorted grid re-sort every row. With nothing arranged it is your own array.

`moveColumn` counts among every column, not the visible ones, so a hidden column
keeps its place: hide Team, move Notes to the front, show Team, and Team is back
where it was. A drag across the visible headers has to turn its drop position
into a place in `allColumns()`.

`state()` is a new object only when the arrangement changed. A signal written
with an equal value, a column list handed over again, a row selected, a cell
edited: none of them makes a new state, so none of them wakes the effect that
saves it. A resize drag makes one per move — debounce, as above.

### The saved state

```ts
interface GridState {
  readonly version: number;                            // GRID_STATE_VERSION when written
  readonly columns: readonly GridColumnState[];        // every column, in the reader's order
  readonly sort: readonly GridSort[];
  readonly filters: Readonly<Record<string, GridFilter>>;
  readonly quickFilter: string;
  readonly groupBy: readonly string[];
  readonly collapsed: readonly string[];               // the paths of the shut groups
}

interface GridColumnState {
  readonly id: string;
  readonly width?: number;                             // only where the reader resized it
  readonly hidden?: true;                              // only where the reader hid it
}
```

```json
{
  "version": 1,
  "columns": [
    { "id": "salary" },
    { "id": "name", "width": 180 },
    { "id": "department", "hidden": true },
    { "id": "notes" }
  ],
  "sort": [{ "columnId": "salary", "direction": "descending" }],
  "filters": { "salary": { "type": "number", "operator": "greaterThan", "value": 40000 } },
  "quickFilter": "",
  "groupBy": [],
  "collapsed": []
}
```

`GRID_STATE_VERSION` is exported: the version this code writes, and the newest
it reads.

Every column is listed, hidden ones too, so a hidden column keeps its place for
when it is shown again. A width is saved only for a column the reader resized:
a column whose declared `width` changes in a later release shows the new one to
everyone who never touched it. Filters are listed in column order and shut
groups sorted, so the order the reader did things in never changes the text —
compare two saved strings to tell whether a view has changed. A filter is saved
as the value it is, though, so two filters that mean the same thing — a set
filter listing the same values in another order — save as different text.

**What is not in it.** No row, no row key, and nothing read from a row —
nothing in this layer reads a row at all. What it holds that came from your
data is only what the reader typed or chose: a filter's text, a set filter's
members, and the keys of the groups they shut, which is what a group's path is
made of. Nothing held by position either: the cursor, a cell range
and the scroll offset each name a place in the view as it was arranged, and the
view a restore produces is another one. Row selection is left out too, though it
is held by key: it is a choice of records rather than a way of looking at them,
and a saved view that brought back last week's ticked rows would hand a bulk
action rows the reader never chose today.

**What JSON cannot carry, it leaves out.** A set filter over values that are not
strings, finite numbers, booleans or `null` — a `Date`, a `bigint`, `undefined`
— and a number filter over `NaN` or an infinity, or a range open at the top,
would not come back as they went: a `Date` returns as a string that no longer
equals it, and `NaN` and the infinities return as `null`. Such a filter is left out of the saved state, and a development
build says so once. Filter on something JSON holds — a timestamp rather than a
`Date` — and it is saved like any other. A number filter with no number in it
yet filters nothing, loses nothing by being left out, and is left out without a
word, since a filter box is in that state on every keystroke.

### Restoring

`apply` takes `unknown`, because what it is usually handed is whatever came back
from storage, and it returns what it did:

```ts
type GridStateApplyResult =
  | { readonly applied: true }
  | { readonly applied: false; readonly reason: 'not-a-state' }
  | { readonly applied: false; readonly reason: 'newer-version'; readonly version: number };
```

**It forgives the past.** A saved state outlives the code that wrote it, and a
stored value that cannot be read is a reason to show the default grid, never a
broken page. So nothing it is handed throws:

- An entry naming a column that no longer exists — in the column list, the sort,
  the filters, the grouping — is dropped.
- A column added since the save takes its defaults: shown — or hidden, if your
  `hidden` signal starts with it hidden — at its own width, and placed directly
  after the column it follows in your list. The first column of your list, if
  new, goes first.
- A malformed entry is dropped: a direction that is not one, a width that is not
  a positive number, a filter of an unknown type or with an unknown operator. A
  width is rounded to a whole pixel.
- A saved width for a column marked `resizable: false` is ignored. The reader
  could not have made it.
- A piece the state leaves out goes back to what its signal held when
  `createGridState` was called — the arrangement a first visit shows. So
  `apply({ version: GRID_STATE_VERSION })` resets to it: a page that starts
  sorted by date, with its notes column hidden, resets to that and not to an
  unsorted grid showing everything.

**It refuses the future.** A state written by a newer version than this one
reads — `GRID_STATE_VERSION` — is refused whole, and nothing is written. This
code cannot know what the fields it does not recognise meant, and restoring the
ones it does would leave the grid in an arrangement nobody made. A value that is
not a saved state at all — not an object, or no whole-number `version` — is
refused the same way. Both say why in a development build, except for `null` and
`undefined`: nothing saved yet is the first visit, not a mistake. The reason is
a code rather than a sentence, so whatever tells the reader their saved view
could not be restored says it in their language.

**It is silent.** Nothing is announced, and neither `onSortChange`,
`onFilterChange` nor `onCollapsedChange` fires, as with any signal you write
yourself. When the restore moves rows, the grid's cursor follows its row through
the new order and a cell range is dropped, exactly as for any other sort or
filter — and says so through `onActiveCellChange` and `onCellRangeChange`, as
then.

The grid holds its cursor and a cell range by column position, and does not yet
follow them when its column list changes. A restore that reorders or hides
columns — like `moveColumn` and `setColumnHidden` — leaves them at the same
positions, over whichever columns are there now.

**It writes nothing that has not changed.** A restore compares each piece with
what is there and leaves an equal one alone, so handing `apply` the state it
already has wakes nothing and costs no row.

### Widths

Widths are the one piece the grid holds rather than a signal: a resize writes a
width into the grid, keyed by column id, and that width wins over any column's
`width` for as long as the grid lives. So a width reaches the saved state from
the grid's `onColumnResize` — wire it, or no resize is ever saved — and a
restore puts widths back two ways. A column the grid holds no width for is
handed its restored width as its `width` in `columns()`, which is how a grid
built from scratch gets every one. A column the grid does hold a width for is
put right through `resizeColumn`: to the restored width, or where the state
gives none, back to the column's own. A column hidden at the time is put right
when it is shown.

A column handed out with a restored width is a copy of yours carrying that
`width` — the same accessors, the same everything else. Know a column by its
`id`, as the grid does, rather than by comparing it with your own object.

The grid clamps a restored width to the column's bounds, as it clamps every
width. The state keeps the number it was given until the reader resizes the
column again, so a width saved before a column's `minWidth` was raised reads as
the old number while the grid shows the new bound.

### Hidden columns

A hidden column is out of the list the grid is given, and the grid sorts,
filters and searches only the columns in its list. So a sort or a filter on a
hidden column stays in the state and comes back into force with the column —
exactly as the grid treats a column that has gone, and for the same reason. A
grouping handed `columns()` treats it the same way: a level naming a hidden
column is dropped until it is shown. To group by a column the reader has hidden,
give that level a `GridGroupSpec` with its own `value`, which the grouping keeps
whether or not the column is in its list.

### What it costs

Nothing here reads a row. Saving reads the signals and the column list and
nothing else, so a cell changing recomputes nothing here, and reading the state
runs no accessor. Recording a width changes no column the grid is handed, so a
resize on a sorted, filtered grid re-sorts and re-filters nothing. A restore
writes every piece before the grid reads any of them, so a state that both
sorts and filters derives the view once, not once per piece. Each of those is
asserted by counting accessor runs.

### What it does not do

- **No pinning.** The grid has no pinned columns yet. When it does, they join
  the saved state under a new version, which is what the version is for: this
  version refuses a state that pins, rather than restoring it unpinned.
- **No gestures for arranging.** There is no header drag to reorder and no
  column menu: `moveColumn` and `setColumnHidden` are the model, and the
  chooser, the drag and the menu are yours.
- **No storage.** It hands you a value and takes one back; where it goes —
  `localStorage`, a URL, a server keyed by user — and when is yours. The same
  goes for the debounce.
- **No row selection, cursor, cell range or scroll position**, for the reasons
  under [The saved state](#the-saved-state).
- **No migration of older versions.** There is one version so far. When there
  is a second, a version-1 state is read as version 1; a state newer than the
  code is refused, never guessed at.
- **No partial restore.** `apply` restores the whole arrangement, putting back
  to default whatever the state leaves out. To restore some pieces and keep the
  rest as they are, fill the rest in from `state()`:
  `view.apply({ ...view.state(), columns: saved.columns })`.

## What is not built

On the roadmap, and not started:

- **Rendering** — variable row height, auto-height, pinned rows and columns,
  right-to-left. The grid composes its own transforms and lays columns out left
  to right only, and ArrowRight is column + 1 whatever the page's direction.
- **Columns** — reorder, hide, auto-size, column groups, multi-row headers.
- **Data** — a date filter type, an external filter, pivoting, tree data,
  master/detail.
- **Editing** — typed editors, full-row editing, fill handle.
- **Selection** — header-driven selection.
- **Data sources** — anything but rows held in memory: no infinite scroll, and
  nothing pushed to a server.
- **The rest** — drag and drop of rows and columns.
- **Chrome, listed as planned but not yet specified** — a filter row under the
  header, a filters panel, a toolbar with the quick search in it, column menus
  and a column chooser, loading, empty and error states, sticky group rows,
  and a library of cell renderers. Today there is no filter UI, no menu and no
  renderer: the grid gives you the model and the `data-*` hooks, and every
  control is yours.

Absent, and not on the roadmap by name: selecting a range with the pointer,
ordering groups by their aggregates, and moving focus into an edit control.
