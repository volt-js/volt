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
at the end, along with the known problems in what is.

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
| `resizeAnnouncement` | `'Name, 180 pixels'` | What a keyboard resize says aloud: `(column, width) => string` |
| `resizeStep` | `16` | Pixels per Alt+Arrow press |
| `sort` | owned | A `Signal.State<readonly GridSort[]>` |
| `onSortChange` | — | Told when the grid changes the sort |
| `sortAnnouncement` | `'Sorted by Name ascending, then …'`, or `'Not sorted'` | What a sort gesture says aloud: `(sort: readonly GridSortDescriptor<T>[]) => string` |
| `filters` | owned | A `Signal.State<ReadonlyMap<string, GridFilter>>`, by column id |
| `quickFilter` | owned | A `Signal.State<string>` searched across every column |
| `onFilterChange` | — | Told when the grid changes either kind of filter |
| `filterAnnouncement` | `'3 of 40 rows'`, or `'All 40 rows'` | What a filter change says aloud: `(shown, total) => string` |
| `rowSelection` | `'none'` | A `GridRowSelectionMode`: `'none'`, `'single'` or `'multiple'` |
| `selectedRows` | owned | A `Signal.State<ReadonlySet<GridRowKey>>` |
| `onRowSelectionChange` | — | Told when the grid changes the row selection |
| `cellSelection` | `'none'` | A `GridCellSelectionMode`: `'range'` turns on the rectangle of cells |
| `cellRange` | owned | A `Signal.State<GridCellRange \| null>` |
| `onCellRangeChange` | — | Told when the grid changes the rectangle |

Every piece of state has the same shape. Supply a `Signal.State` and the grid
reads and writes yours, which is how a saved view, a URL or a server that
already knows gets in; leave it out and the grid owns one. The `on…Change`
callbacks fire when the grid changes the state — a click, a key, a method — and
not when you write the signal yourself, since you already know.

The three announcements have English defaults and do not come from the locale's
message catalogue. They are defaulted rather than left out because the failure
of a missing one is silence, not a visible gap; for any other language, pass
your own. A sort sentence is handed `GridSortDescriptor<T>` terms — `{ column,
direction }`, the term with its column already looked up — so it can read each
column's `header` rather than its id.

**`rowHeight` is one number, not a measurement.** Every row is exactly that
tall, which makes the vertical geometry arithmetic: nothing is measured,
nothing is observed, and a million rows cost what ten do. The cost is that a row
cannot grow to fit wrapped text. Variable row height is not built.

**`getRowKey` defaults to the index**, which is right for a list that only ever
grows at the end and wrong for nearly everything else on this page. A keyed
`:for` reuses a row's elements by key; row selection is held by key; the cursor
follows its row through a sort by key. On the default, all three mean a
different row after every sort and filter — there is a test pinning exactly
that degraded behaviour. Give `getRowKey` before turning on selection or
sorting, and build the key from the row itself: the `index` it is handed is the
row's place in the sorted, filtered view, not in your array, so a key made from
it is the default again.

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
| `data-filtered` | header cell | The column has a filter set — even an unfinished one that filters nothing |
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
| `VERSION` | `'0.1.0'` | Without the prerelease tag the package is published under |

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

A position is two indices, not a row key and a column id, because the keyboard
map is arithmetic over it; which row sits at an index changes with every sort
and filter, and the grid moves the cursor to follow — see below.

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

One case gets focus wrong: a reader who focused a cell and then clicked the page
background. Focus is then nowhere, which the grid cannot tell apart from its
focused cell having been removed by a re-render, so the next re-sort pulls focus
back into the grid.

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
| `sortDirection(columnId)` | Which way a column is sorted, or `null` |
| `setSort(sort)` | Replace the whole order. Silent |
| `toggleSort(columnId, additive?)` | Cycle ascending, descending, none. Announces |

A sort is a list of terms, because "by department, then by salary" is one
question, and because the second term is what makes the first deterministic
when it ties. It holds no functions and names columns by id, so it can go into a
URL or a saved view and come straight back; a term naming a column that no
longer exists, or one marked `sortable: false`, is left out of the ordering
rather than thrown over. It is not removed from the signal, though: `sort()` and
`onSortChange` still carry it, and it still counts towards `data-sort-index`.

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
  anything else, and any mix of types, as text. `NaN` sorts after every number
  ascending, and so before them descending.
- **An invalid `Date` is not guarded.** It compares as equal to everything, and
  one in a column is enough to put the valid dates around it out of order. Have
  `sortValue` return `null` for it, and it sorts last as a blank.
- **Blanks last, both ways.** `null`, `undefined` and `''` sort after everything
  whichever way the column is sorted. Reversing a sort is a request to see the
  largest values first, not the rows with no value at all.
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
| `setFilter(columnId, filter)` | Set one column's filter, or remove it with `null` |
| `clearFilters()` | Remove every column filter and the quick filter |
| `quickFilter()` | The quick-filter text |
| `setQuickFilter(text)` | Search every column |

A filter is a plain value for the reason a sort is: it has to survive a trip
through a URL or a saved view. It is compiled once into a predicate rather than
interpreted per row — a text filter over a hundred thousand rows would
otherwise fold the same needle a hundred thousand times, and a set filter would
build its `Set` once per row.

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
those never matches — not even `notEquals`, so a blank cell is not "not 5". An
invalid `Date` slips through as `NaN`, which fails every operator but
`notEquals`. Text filters fold case in the locale, because Turkish I and
dotless ı are different letters and the invariant fold runs them together, and
read a blank as `''`, so `notContains` keeps it. A set filter compares the raw
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
drag puts the width back where the drag started: one gesture, undone whole. It
does not consume the Escape, though — the key still reaches the grid and
anything else listening, so a grid inside a dialog that closes on Escape loses
the dialog as well as the drag.

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
<!-- staff.html: as for any grid, except the grid element's :keydown is onKey($event),
     and the body's rows and cells go through the component's own methods -->
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
| `sort` | owned | The sort — pass the grid's signal. See below |
| `filters` | owned | Column filters. These belong here, not on the grid |
| `quickFilter` | owned | The quick filter. Also here, not on the grid |
| `onFilterChange` | — | Told when either kind of filter changes |

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
| `columns()` | Your columns, lifted to `GridGroupedRow<T>`, for the grid's `columns` |
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

`rowProps` adds `aria-level` and `data-depth` to every row, and to a header
`aria-expanded`, `data-group`, `data-count` and `GRID_GROUP_ATTRIBUTE` with the
path. `aria-expanded` is the one thing a collapsed group has that a sighted
reader gets from the twisty; without it a screen reader is told the rows went
away and never told they can come back.

On a group header, Enter toggles the group from any cell. ArrowRight opens and
ArrowLeft shuts it from the first cell only, and only when there is something to
do; everywhere else the arrows belong to the grid, because a header has columns
like any other row and the reader walks them the same way.

### What a layer above the grid means

These follow from the grid not knowing it is grouped. None of them is guarded
against; each is what happens if you do the natural thing.

**Filter the grouping, never the grid.** The grid's filter runs over whatever it
is handed, and here that is the flattened list. A grid filter tests each group
header as though it were a row — by that column's aggregate, which is usually
nothing — and so usually drops it, leaving its rows orphaned under no heading
(a `notContains` keeps it, which is no better); and it never sees the rows
inside a collapsed group at all. The lifted columns carry no `filterValue`, so a
grid filter also tests your rows by `value`, not by the `filterValue` you gave. So
filtering happens in `createGrouping`, before grouping, which is also the only
order in which an aggregate is over the rows the reader can see. Do not pass
`filters` or `quickFilter` to the grid, and do not call its `setFilter`. The
header's `data-filtered` hook reads the grid's own filters, so on a grouped grid
it is never set; style a filtered column from `grouping.filters()` instead.

**Filter changes are silent.** The grid announces how many rows a filter left;
the grouping does not, and nothing else will. Say it from `onFilterChange`:

```ts
import { announce } from '@voltdev/primitives';
import { createGrouping } from '@voltdev/grid';

const grouping = createGrouping<Person>({
  rows: () => people,
  columns: () => COLUMNS,
  groupBy: () => ['department'],
  onFilterChange: () =>
    announce(`${grouping.filteredRowCount()} of ${grouping.sourceRowCount()} rows`),
});
```

**Hand the same `sort` signal to both.** The header — its click, its
`aria-sort`, its announcement — belongs to the grid, and duplicating it in the
grouping would be a second implementation of what the reader is looking at. The
ordering has to happen before grouping, or it would scramble the headers out of
their groups. So `columns()` gives every lifted column a comparator that returns
zero, the grid's sort becomes a stable copy that moves nothing, and the grouping
reads the same signal and orders your rows before it groups them. Give the two
separate signals — or give the grouping none — and a header click marks the
column `aria-sort="ascending"`, announces "Sorted by Name ascending", and moves
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

**Row selection sees headers and wrapped keys.** The grid selects by its row
keys, and those are the wrappers' keys: your key prefixed to keep it apart from
the group paths (`'r\u001f' + key`), and `'g\u001f' + path` for a header. So
`selectedRows()` does not hold your ids, and nothing exported maps one back —
find the wrapper in `grouping.rows()` by `key` and read its `item`. Space on a
header selects the header; `selectAllRows()` and Ctrl+A select every header the
flattened list holds, on screen or not, and none of the rows inside a collapsed
group, because those are not in the collection the grid was given. Route clicks
through `onGroupClick` first, as above, or a click on a header both toggles it
and selects it.

**Editing sees the wrappers too.** A `createCellEditing` over a grouped grid is
typed over `GridGroupedRow<T>`, and nothing stops it opening a header's cell: it
opens on the aggregate and commits a change whose `item` is the header. Give
every editor `editable: (row) => row.kind === 'data'`, and unwrap `change.item`
in `onCommit`. Put the grouping's `onKeyDown` ahead of the editing one as well.
With the guard, Enter on a header falls through editing to the grouping either
way; without it, Enter on a header goes to whichever handler comes first —
the grouping toggles the group, the editing opens an editor on the aggregate.

**The role stays `grid`.** Rows carry `aria-level` and headers `aria-expanded`,
but nothing switches the grid to `role="treegrid"`, which is the role ARIA
defines levels and expansion on rows for. How much of that a screen reader
reports inside a plain `grid` is up to the screen reader.

### Group keys, order and aggregates

**Rows are grouped by their key's text.** A path is a string, because a path is
what goes into a URL or a saved view — and two keys that render the same are one
group to the person reading them. The consequences: `1` and `'1'` are one group;
`null`, `undefined` and `''` are one group with an empty label; and an object
key groups every row together as `[object Object]`. Give a `GridGroupSpec` a
`value` that returns something with a meaningful text, and a `label` where the
text is not what the reader should see.

A nested group's path is its key joined to its parents' with U+001F, a character
no one types, so two `London` groups under different regions are two groups —
unless the parent's key is blank. A blank key's text is empty, and a child of it
is given its own text as its path with no separator in front, so a `London`
city under a blank region has the same path, and the same row key, as a
top-level `London` region. Both then open and shut together, and the grid is
handed two rows under one key. Give blank keys a non-empty text from a
`GridGroupSpec`'s `value` wherever a nested level could repeat an outer one.

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
column come back as numbers. A group with nothing to total gets `null` rather
than `0`, which would be a number a reader could act on and a claim the data
does not make. An invalid `Date` is the exception that gets through: it counts,
as `NaN`, so one in a group makes its `sum` and `average` `NaN`, and a group of
nothing else gets `min` `Infinity` and `max` `-Infinity` rather than `null`.
Return `null` for it from the aggregation's `value`.

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

/** Leaves unfinished text alone, so `validate` can refuse it — see "Numbers" below. */
const toNumber = (raw: string): unknown => {
  const parsed = Number(raw);
  // '' is not 0, '-' is not NaN, and '-0' on the way to '-0.5' is not 0.
  return raw.trim() === '' || Number.isNaN(parsed) || Object.is(parsed, -0) ? raw : parsed;
};

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
        parse: toNumber,
        validate: (value) =>
          typeof value !== 'number' ? 'Enter a number' : value < 0 ? 'Cannot be negative' : null,
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
| `onCancel` | — | `(session: GridEditSession<T>) => void` — told when a session is abandoned |
| `onInvalid` | — | `(message, session) => void` — told when validation refuses, before the message shows |

### `GridCellEditing`

| Member | Description |
|---|---|
| `begin(row, col)` | Open a session on a rendered cell. `false` where it cannot be edited. Moves neither the cursor nor focus |
| `beginAt(cell)` | Open by position, if that cell is rendered and editable |
| `session()` | The open `GridEditSession<T>` — `row`, `column`, `columnId`, `item`, `rowKey`, `initial` — or `null` |
| `isEditing(row, column)` | Whether this position is the one open |
| `isEditable(row, col)` | Whether this cell could be opened at all |
| `draft()`, `text()` | What has been typed, parsed; and the same as text for the control |
| `setDraft(value)` | Replace the draft from code — a `<select>`, a picker, a stepper. Does not clear `error()` |
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
when the session opened, the `columnId`, and `previous` and `value`. Apply it by
`rowKey` or `item`, never by `rowIndex`, which is a position and names whatever
row is there now. A value the reader left as it was is
not a change: the session closes and `onCommit` is not called, because a write
through a request, an undo entry or a dirty flag for a reader who opened a cell
and pressed Enter is a write for nothing. The comparison is `Object.is` against
what the editor opened with, so an editor with no `parse` over a numeric column
reports a change whenever the reader retypes the same number — as a string.

### The keyboard

| Keys | Does |
|---|---|
| Enter, F2 | Open the cell under the cursor |
| Enter | Commit, and move down a row |
| Shift + Enter | Commit, and move up a row |
| Escape | Abandon the edit, and stay on the cell |
| Tab, Shift + Tab | Commit, move to the next or previous editable cell, and open it |

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
reader types again through `onInput`. `setDraft` does not clear it, so a
`<select>` or a picker driving the draft from code leaves the message up, over a
value that may already be valid, until the next `commit()` clears or replaces
it.

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

`parse` runs on every keystroke, and the control's value is bound to `text()`,
which is the parsed draft as text — so whenever the parsed value changes, the
binding writes its text back into the control, over what was typed. With
`parse: Number` the two disagree about unfinished input: `Number('-')` is `NaN`,
so typing a minus sign replaces the field's text with "NaN", and `Number('')` is
`0`, so clearing the field fills it with "0". A negative number cannot be typed
from empty. The same trap is subtler one step on: `Number('-0')` is `-0`, whose
text is "0", so a parse that only guards blanks and `NaN` drops the minus from
"-0.5" and commits 0.5. The `toNumber` above returns the text itself in all
three cases, and leaves `validate` to refuse what is not a number.

The rewrite remains wherever a number reads back differently from how it was
typed — ".5" becomes "0.5", "1e3" becomes "1000" — and each one puts the caret
at the end of the field. To keep exactly what the reader typed, leave `parse`
out, give the editor a `read` that returns the value as text — so an untouched
value still compares equal and reports nothing — and turn the text into a number
in `onCommit`.

## What is not built

On the roadmap, and not started:

- **Rendering** — variable row height, auto-height, pinned rows and columns,
  right-to-left. The grid composes its own transforms and lays columns out left
  to right only, and ArrowRight is column + 1 whatever the page's direction.
- **Columns** — reorder, hide, auto-size, column groups, multi-row headers.
- **Data** — a date filter type, an external filter, pivoting, tree data,
  master/detail.
- **Editing** — typed editors, full-row editing, undo and redo, fill handle,
  copy and paste against the clipboard.
- **Selection** — header-driven selection.
- **Data sources** — anything but rows held in memory: no infinite scroll, and
  nothing pushed to a server.
- **The rest** — drag and drop of rows and columns, CSV and Excel export, and
  saving and restoring the grid's state as one thing. Today sort, filters,
  selection and collapsed groups are each a plain value you can hold and hand
  back; column widths come back only through each column's `width`.
- **Chrome, listed as planned but not yet specified** — a filter row under the
  header, a filters panel, a toolbar with the quick search in it, column menus
  and a column chooser, loading, empty and error states, sticky group rows,
  and a library of cell renderers. Today there is no filter UI, no menu and no
  renderer: the grid gives you the model and the `data-*` hooks, and every
  control is yours.

Absent, and not on the roadmap by name: selecting a range with the pointer,
ordering groups by their aggregates, and moving focus into an edit control.

Built, and wrong in ways you will hit:

- **An edit session is held by position.** Sorting or filtering while a cell is
  open — a click on a header will do it — leaves the editor at the same index
  over whichever row has moved there, while the commit still goes to the row the
  session opened on. Commit or cancel before the view changes.
- **Enter on the last row and Tab off the last cell lose focus.** The edit
  commits, the editor closes, and focus lands on the document body rather than
  on the cell or on whatever follows the grid.
- **An invalid `Date` scrambles a sort** of the column it is in — see
  [Sorting](#sorting) for the `sortValue` that avoids it — and turns a group's
  `sum` and `average` into `NaN`; see
  [Group keys, order and aggregates](#group-keys-order-and-aggregates).
- **A blank outer group key lets a nested group take a top-level path.** Under
  a blank key, a child's path is its own text alone, so it can collide with a
  top-level group of the same text: one row key for two rows, and one
  expansion state for two groups. See
  [Group keys, order and aggregates](#group-keys-order-and-aggregates).
- **A grouped grid's `aria-level` and `aria-expanded` sit inside `role="grid"`**,
  not a treegrid.
