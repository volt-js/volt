/**
 * Grid — a virtualized, keyboard-navigable data grid.
 *
 * This is headless: it owns geometry, the keyboard map and the ARIA, and
 * returns prop objects to spread onto whatever markup the consumer writes.
 * Nothing here renders, and nothing here has an opinion about how a cell
 * looks.
 *
 *   class People {
 *     grid = new Signal.State<Element | null>(null);
 *     scroller = new Signal.State<Element | null>(null);
 *     container = new Signal.State<Element | null>(null);
 *     people = new Signal.State<Person[]>(rows);
 *     table = createGrid<Person>({
 *       grid: () => this.grid.get(),
 *       scroller: () => this.scroller.get(),
 *       container: () => this.container.get(),
 *       rows: () => this.people.get(),
 *       columns: () => COLUMNS,
 *       label: 'People',
 *     });
 *   }
 *
 *   <div :ref="grid" :spread="table.gridProps()"
 *        :keydown="table.onKeyDown($event)"
 *        :focusin="table.onFocusIn($event)">
 *     <div :spread="table.headerProps()">
 *       <div :spread="table.headerRowProps()">
 *         <div :for="col in table.columns()" :key="col.key"
 *              :spread="table.headerCellProps(col)"
 *              :click="table.onHeaderClick($event)">{ col.column.header }
 *           <span :spread="table.resizerProps(col)"
 *                 :pointerdown="table.onResizePointerDown($event)"></span>
 *         </div>
 *       </div>
 *     </div>
 *     <div :ref="scroller" :spread="table.bodyProps()">
 *       <div :spread="table.sizerProps()">
 *         <div :ref="container" :spread="table.containerProps()">
 *           <div :for="row in table.rows()" :key="row.key" :spread="table.rowProps(row)">
 *             <div :for="col in table.columns()" :key="col.key"
 *                  :spread="table.cellProps(row, col)"
 *                  :click="table.onCellClick($event)">{ table.cellValue(row, col) }</div>
 *           </div>
 *         </div>
 *       </div>
 *     </div>
 *   </div>
 *
 * **A cell owns its own binding.** That single text interpolation is the whole
 * reason a grid belongs in Volt rather than in a framework that re-renders. A
 * cell's value is read by one effect, and if the value came from a signal then
 * writing it invalidates that effect and no other: one text node changes, the
 * cell element is not replaced, the row around it is not rebuilt, and the
 * ninety-nine other cells on screen do not so much as re-read their own
 * values. Nothing in this file reads a cell's value, which is what keeps that
 * true — `cellValue` is called from the consumer's template and nowhere else.
 *
 * **Both axes are windowed by `createVirtualizer`**, one per axis, and neither
 * is a copy. A grid that grew its own windowing would be the second
 * implementation of a thing the listbox, combobox and tree have to agree with,
 * and the three would drift.
 *
 * The geometry the shared virtualizer expects is three elements per axis — a
 * scroller, an empty sizer as long as the whole collection, and a container
 * moved by one transform. Both axes share all three, because a grid scrolls
 * one box in two directions: `sizerProps` is as tall as every row and as wide
 * as every column, and `containerProps` carries a two-dimensional translate.
 * The header sits outside the scroller so that vertical scrolling never moves
 * it, and is kept in step horizontally by a transform of its own.
 *
 * What the arithmetic promises, and therefore what the consumer's stylesheet
 * has to leave alone: cells sit in a row in order, at the widths given here,
 * and rows sit in the container in order at the height given here. A row must
 * therefore be a flex row (or any other layout that keeps its cells on one
 * line), the sizer must be positioned so it can be taller than the viewport,
 * every cell must be `box-sizing: border-box` or its padding will push the
 * columns out of step with the header, and no cell may shrink — the header row
 * is only as wide as the grid while the columns it renders are wider, so a
 * flex item left to shrink narrows every header cell until it no longer lines
 * up with the body:
 *
 *   [role='row'] { display: flex; }
 *   [role='gridcell'], [role='columnheader'] { box-sizing: border-box; flex: none; }
 *
 * **Rows may each be a height of their own**, declared by a function of the
 * row or measured from the page, and the grid keeps no geometry of its own for
 * either: the row virtualizer already holds sizes by key in a tree, measures
 * what it renders, corrects as measurements land, and holds the view still
 * while it does. What the grid owns is the choosing. A declared height is
 * asked of the row at each place in the view, never of the index, so a sort
 * carries heights with the rows; it is stated back on the row, as a single
 * height is, since a declared height is not an estimate and nothing may
 * overrule it. A measured row is stated nothing, so it can be the height it
 * lays out at — and that is the one place where the promise above is the
 * page's rather than the grid's. The virtualizer looks for rows to measure
 * only when its window moves, and a sort can put other rows in a window that
 * did not, so the grid has it look again then. A row holding focus that rows
 * growing above it push out of the window is brought back, as one a sort
 * moves is. A grid of one height takes none of these paths: its geometry, its
 * props and its paging are what they were.
 *
 * The keyboard map, which is the WAI-ARIA grid pattern:
 *
 *   ArrowRight, ArrowLeft      next, previous cell in the row
 *   ArrowDown, ArrowUp         same column, next or previous row
 *   Home, End                  first, last cell of the row
 *   Ctrl + Home, Ctrl + End    first cell of the grid, last cell of the grid
 *   PageDown, PageUp           one viewport of rows down, up
 *   Alt + Arrow on a header    widen or narrow the column under the cursor
 *   Enter, Space on a header   sort the column: ascending, descending, none
 *   Shift + either of those    add the column to the order instead of replacing it
 *   Space on a data cell       select the row under the cursor
 *   Ctrl + A                   select every row the filter left
 *   Shift + Arrow              extend the cell range by one cell
 *   Shift + Ctrl + Arrow       extend the cell range to that edge of the grid
 *   Shift + Home, Shift + End  extend to the ends of the row
 *
 * Movement is arithmetic over row and column indices, not a walk over the
 * elements `createRovingFocus` would find. Roving focus moves between
 * *elements*, and the cell that Ctrl+End moves to is, in a grid of a hundred
 * thousand rows, not in the document at all — nor are the fifty rows a
 * PageDown crosses. So the index moves first, the scroll follows, and the
 * element is focused once the window has rendered it. That is the same
 * divergence `createListbox` documents, for the same reason, and it is the
 * only part of the primitives family a grid cannot reuse as it stands.
 *
 * **Right to left, the row runs from the right, and the data does not turn
 * round.** Column 0 is at the inline start whichever way the page runs, and
 * every position here — the cursor, a range, a column's `start`, a copy, an
 * export — is a place in the data. What turns round is what is physical: the
 * transforms that move the header's rows, a pinned row and the window, which
 * right to left carry them leftward; a drag's `clientX`, which grows to the
 * right, into a column whose handle is at its left edge; and the arrows, so
 * ArrowRight goes to the cell on the right, column − 1, as it does in the
 * browser's own controls. The map above is written as it reads left to right,
 * and every arrow in it is read toward the inline end or the start before
 * anything acts on it. The pinned columns' insets, and the margin and padding
 * a pinned grid moves by, are logical properties: the browser swaps their
 * sides by itself. The direction is the one the browser computes at the grid's
 * element, read in the measure lane — `direction.ts` says when, what it does
 * not hear, and how a layer over the grid asks for it. Left to right, every
 * one of those paths hands back what it always did.
 *
 * **The header row is row one, and it is navigable.** ArrowUp from the first
 * data row lands on the column header, which is where `aria-rowindex="1"` says
 * it is; data rows are numbered from two. A header a keyboard user cannot
 * reach is a column they cannot resize and, once sorting exists, cannot sort.
 * `HEADER_ROW` is the row index it navigates under.
 *
 * **Counting is the whole reason the ARIA here is not optional.** A window of
 * twelve rendered rows out of a hundred thousand is invisible to a sighted
 * reader and a lie to everyone else: without `aria-rowcount`, `aria-colcount`,
 * `aria-rowindex` and `aria-colindex` a screen reader announces row three of
 * twelve, in a grid whose scrollbar says otherwise. The counts come from the
 * model, never from the DOM, because the DOM only ever holds the window. They
 * count the *filtered* rows, for the same reason: a reader told there are ten
 * thousand rows in a grid a filter has left nine of is worse off than a reader
 * told nothing at all.
 *
 * **Sorting and filtering are derived, never stored.** The rows a caller hands
 * over stay theirs — same array, same order, same objects — and the grid holds
 * a computed view over them. `slice().sort()` reorders a copy of the
 * references, never the array and never a row, because a caller may hold
 * references into that array and because identity-keyed rendering only works
 * if the object at a key is still the same object. The view is the source array
 * itself, by identity, whenever there is nothing to sort or filter, which is
 * what keeps an ordinary grid subscribing to no cell value here at all.
 *
 * That is also how a re-sort stays cheap. The rendered `GridRow` for a row
 * whose key, data, index and offset are unchanged is handed back as the *same
 * object*, so the row's item signal is set to the value it already holds and
 * notifies nobody: a sort that leaves a row where it was costs that row
 * nothing, and a filter that removes rows below the window costs the window
 * nothing. Only the cells whose row genuinely moved are rebuilt.
 *
 * **The cursor follows a row, not an index.** A sort moves a row four hundred
 * places, and an index-based cursor would silently come to rest on somebody
 * else's data. So when the view changes, the row the cursor was on is read out
 * of the view being replaced, found again by key in the new one, and the cursor
 * is put back on it — with focus following only if focus was on the cursor to
 * begin with, since a sort is usually driven from the header where the reader
 * is standing. Nothing about the cursor is kept in a second place to go stale;
 * `previous[cursor.row]` is the row they were on, by construction.
 *
 * Its column is followed the same way. A column list handed over in another
 * order or without a column — `createGridState` moving or hiding one — would
 * leave an index-based cursor over another column, so the column is read out
 * of the list being replaced and found again by id. Where it has gone, the
 * cursor goes to the column that slid into its place, or the nearest one left.
 *
 * **Two selections, because they answer different questions.** A row selection
 * is "these records" and is held by key, so it survives sorting, filtering and
 * scrolling and can be read by whatever acts on it. A cell range is "this
 * rectangle" and is held by position, so it is dropped the moment the rows it
 * covered move. A change to the columns alone carries it, when the columns it
 * covered still sit side by side in the order they were — the same rectangle,
 * somewhere else — and drops it when they do not.
 *
 * **A pinned column is drawn in its row, held at the edge by `position:
 * sticky`.** Three regions — a start, a scrolling and an end container, each
 * with its own rows — would split every row into three elements, and a row
 * whose cells live in three places is three rows to a screen reader. So a
 * pinned column stays in the one row, and the grid hands it the sticky offset
 * that holds it: from the inline start of the start-pinned columns, or from the
 * inline end of the end-pinned ones, which is what `GridColumnView.start` says
 * along with the region. Sticky positioning is worked out from layout and
 * knows nothing of a transform, so a horizontal transform anywhere between a
 * pinned cell and the scroller would carry the cell off its edge. Where any
 * column is pinned, then, the window is moved across by the container's
 * padding, and the header row by its margin; where none is, both keep the
 * transforms they always had.
 *
 * **The columns are one list in the order they are drawn,** start-pinned,
 * scrolling, end-pinned, and every position counts in it — the cursor, a
 * range, `columnAt`, an export, a copy. Pinned columns are outside the
 * scrolling window, never windowed away, and a scroll to a scrolling column
 * stops short of the pinned ones rather than leaving it underneath them.
 *
 * **Pinned rows are outside the scroller,** in the header's rowgroup and a
 * footer's, so a vertical scroll never moves them and the row virtualizer
 * never sees them. They are counted in the same one list as the columns are:
 * the rows pinned to the top from position 0, the view after them, the rows
 * pinned to the bottom last — so ArrowUp from the first scrolling row is the
 * pinned row above it, and a position past the pinned rows is turned into the
 * row axis's own index wherever the axis is asked.
 *
 * **A column group is named on its columns, not handed over as a tree.** A
 * tree beside the column list would be a second list to keep in step with the
 * first, and every move, hide and pin would have to be made to both. Named on
 * the column, a group goes where its columns go, and is drawn over each run of
 * them that sits side by side — once over each part where a pin or a reorder
 * has parted them, since a cell can only span columns that are next to each
 * other. `headerRows()` hands out a row for each level of group above the
 * columns' own, each cell with the columns it spans, so the page draws what it
 * is given and does no arithmetic of its own; a cell over a run the window
 * holds part of is drawn as wide as that part, which keeps every header row in
 * line with the columns by the same transform.
 *
 * The rows of groups are rows of the grid, to a screen reader as to the
 * keyboard. A group's cell is a `columnheader` with `aria-colspan`, numbered by
 * its first column, because that is how a reader learns which columns a
 * heading is over; a column under no group at some level has a gap there that
 * is no cell at all, since an empty header would be read out as one, and a row
 * the window holds only gaps of is no row, since a row must hold a cell. The rows
 * are counted in `aria-rowcount` and number every row after them, or the row a
 * reader is told they are on would not be the row they are on. A position on a
 * row of groups is above `HEADER_ROW`, one less for each level up, and names
 * the group's first column, where its one cell carries it. A grid whose columns
 * name no group has the one header row it always had, and its props, its counts
 * and its keyboard are what they were.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import {
  announce,
  createVirtualizer,
  useLocale,
  type Direction,
  type Locale,
  type MessageValues,
  type VirtualOverscan,
  type Virtualizer,
} from '@voltdev/primitives';
import {
  nextDirection,
  sameSort,
  sortRows,
  type GridSort,
  type GridSortDirection,
  type GridSortTerm,
} from './sort.js';
import {
  asText,
  compileFilter,
  matchesQuickFilter,
  quickFilterTerms,
  type GridFilter,
} from './filter.js';
import {
  rangeBounds,
  rangeContains,
  sameKeys,
  sameRange,
  type GridCellRange,
  type GridCellSelectionMode,
  type GridRowKey,
  type GridRowSelectionMode,
} from './selection.js';
import { inlineKey, watchDirection } from './direction.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

/**
 * Marks a rendered cell, carrying its position as `row,column`.
 *
 * One attribute holding both halves rather than two, because half a position
 * is not something this can navigate to, and a cell that carried only one
 * would be found by a query that then had to guess the other. Cells are found
 * by attribute rather than registered, so a cell rendered from `:for` inside
 * whatever wrapper a consumer wrote needs no wiring of its own.
 */
export const GRID_CELL_ATTRIBUTE = 'data-volt-grid-cell';

/** Marks a column's resize handle, carrying the column's id. */
export const GRID_RESIZER_ATTRIBUTE = 'data-volt-grid-resizer';

/**
 * Marks a column group's resize handle, carrying the group's id.
 *
 * An attribute of its own rather than `GRID_RESIZER_ATTRIBUTE`, which carries a
 * column id: a group and a column may share an id, and a handle naming one
 * must never be read as naming the other.
 */
export const GRID_COLUMN_GROUP_RESIZER_ATTRIBUTE = 'data-volt-grid-column-group-resizer';

/**
 * The row index the column header navigates under.
 *
 * Data rows are 0-based, so the header needs a row of its own that is not one
 * of them. Negative rather than a separate flag on the position: every
 * comparison in the keyboard map then stays plain arithmetic, and "above row
 * zero" means the header without anything having to say so.
 */
export const HEADER_ROW = -1;

/** Row height when none is given, and the estimate for a row not yet measured, in px. */
const DEFAULT_ROW_HEIGHT = 32;
/** Column width for a column that declares none, in px. */
const DEFAULT_COLUMN_WIDTH = 150;
/** How narrow a column may be dragged when it sets no minimum, in px. */
const DEFAULT_MIN_COLUMN_WIDTH = 40;
/** How much one Alt+Arrow press resizes by, in px. */
const DEFAULT_RESIZE_STEP = 16;

/**
 * Rows a page key moves by when nothing better is known.
 *
 * Only reached before the scroller has been measured — in a hidden tab, or in
 * a test environment that lays nothing out. Otherwise the number of rows
 * actually on screen is what a page is worth.
 */
const DEFAULT_PAGE_ROWS = 10;

/**
 * Shared empties, so that "nothing is sorted" and "nothing is filtered" are
 * the same value every time they are asked for.
 *
 * A fresh `[]` per read would be a fresh identity per read, and the derived
 * view below is built on identity: a memo that recomputes because its input
 * was allocated again is a memo that does nothing.
 */
const EMPTY_SORT: readonly GridSort[] = [];
const EMPTY_FILTERS: ReadonlyMap<string, GridFilter> = new Map();

/** A column's filter, resolved to an accessor and a predicate. */
interface CompiledFilter<T> {
  readonly columnId: string;
  readonly value: (row: T) => unknown;
  readonly test: (value: unknown) => boolean;
}

export interface GridColumn<T> {
  /** Stable across re-fetches: resized widths are held against it. */
  id: string;
  /** The column header's text. */
  header: string;
  /**
   * The field accessor — what this column shows for a row.
   *
   * A function rather than a field name, because a field name can only reach
   * one level of a plain object, and because this is where a cell's binding
   * gets its dependencies: an accessor that reads a signal gives that cell a
   * binding of its own, which is the difference between writing one text node
   * and re-rendering a row.
   */
  value: (row: T) => unknown;
  /** Default 150. */
  width?: number;
  /** How narrow a resize may go. Default 40. */
  minWidth?: number;
  /** How wide a resize may go. Unbounded by default. */
  maxWidth?: number;
  /** Default true. */
  resizable?: boolean;

  /** Default true. A column that is not sortable carries no `aria-sort`. */
  sortable?: boolean;
  /**
   * The key this column sorts by. Defaults to `value`.
   *
   * Worth setting wherever the cell shows something other than the thing being
   * ordered: a date rendered "3 Feb" sorts April before February as text, and
   * a currency shown as "$1,000" sorts before "$9".
   */
  sortValue?: (row: T) => unknown;
  /**
   * A comparator over whole rows, always written ascending — a descending sort
   * negates whatever it returns. Used instead of `sortValue` when present, and
   * the way to order something no general comparator could: a priority scale,
   * a version string, a natural sort of names with numbers in them.
   */
  compare?: (a: T, b: T) => number;
  /**
   * The value this column filters on, for both its own filter and the quick
   * filter. Defaults to `value`, and worth setting for the same reason
   * `sortValue` is.
   */
  filterValue?: (row: T) => unknown;
  /**
   * Default true. A column that is not filterable is left out of the quick
   * filter, and a filter of its own is refused — or, handed in through a
   * signal, filters nothing and marks no header.
   *
   * `createGrouping` sets it false on every column it lifts. A grouped grid is
   * handed its group headers as rows, and a filter over those would strip the
   * headings from in front of the rows they describe; the grouping filters
   * instead, before it groups.
   */
  filterable?: boolean;
  /**
   * Hold the column at an inline edge, outside the horizontal scroll. Default
   * null: it scrolls.
   *
   * The model's own pin, which `pinColumn` overrules for as long as the grid
   * lives — as a resize overrules `width` — so a column that starts pinned
   * can be unpinned and one that does not can be pinned.
   */
  pin?: GridColumnPin;
  /**
   * The innermost group the column sits under; that group's `parent`, and its
   * parent's, are the groups above it. Default none.
   *
   * Named on the column rather than given as a tree of groups, because the
   * column list is the one list everything here reads in order: a group is a
   * run of side-by-side columns that name it, and a list that moves or hides a
   * column moves or hides it out of its group with nothing else to keep in
   * step.
   */
  group?: GridColumnGroup;
}

/**
 * A heading over a run of columns, drawn in a header row of its own above
 * them — as AG Grid's column groups are.
 *
 * Known by `id`, never by identity, so a column list handed over again with
 * fresh group objects is the same groups.
 */
export interface GridColumnGroup {
  /** Stable across re-fetches: a group is found, moved and shut by it. */
  readonly id: string;
  /** The group header's text, and the group's name in announcements. */
  readonly header: string;
  /** The group this one sits under, for a header of three rows or more. */
  readonly parent?: GridColumnGroup;
}

/**
 * Which inline edge a column is held at: the start (the left, in a language
 * written left to right), the end, or null for neither.
 */
export type GridColumnPin = 'start' | 'end' | null;

/** Which edge a pinned row is held at. */
export type GridRowPin = 'top' | 'bottom';

/** A sort entry paired with the column it names, for an announcement to read. */
export interface GridSortDescriptor<T> {
  readonly column: GridColumn<T>;
  readonly direction: GridSortDirection;
}

/** A position in the grid. `row` is `HEADER_ROW` for the column header. */
export interface GridCell {
  readonly row: number;
  readonly column: number;
}

/**
 * One rendered row. Offsets are from the top of the collection, in px.
 *
 * Where rows are measured, `start` and `size` are the estimate until the row
 * has rendered, and the measurement after: a row is handed out again, as a
 * new object, whenever a measurement moves it.
 */
export interface GridRow<T> {
  readonly index: number;
  readonly key: string | number;
  /** The row's data — what a column's accessor is given. */
  readonly item: T;
  readonly start: number;
  readonly size: number;
  /**
   * Present only on a row from `pinnedTopRows()` or `pinnedBottomRows()`, whose
   * `start` is then from the top of its own edge's rows.
   */
  readonly pin?: GridRowPin;
}

/**
 * One rendered column. `start` is from the inline start of the column's
 * region, in px: of the start-pinned columns, of the scrolling ones, or of the
 * end-pinned ones. With nothing pinned there is one region, the collection.
 */
export interface GridColumnView<T> {
  readonly index: number;
  readonly key: string | number;
  readonly column: GridColumn<T>;
  readonly start: number;
  /** The width the geometry is using, which a resize has already clamped. */
  readonly width: number;
  /** Present only on a pinned column: the region it is in. */
  readonly pin?: 'start' | 'end';
}

/**
 * One row of the header: a row of group headings, or the columns' own.
 *
 * A grid whose columns name no group has one, the columns' own, and its cells
 * stand for exactly the columns `columns()` hands out.
 */
export interface GridHeaderRow<T> {
  /**
   * The row the cursor goes by: `HEADER_ROW` for the columns' own, and one
   * less for each row of groups above it, so the top row of a header of three
   * is `HEADER_ROW - 2`.
   */
  readonly index: number;
  /** A row of groups is keyed by its level, the outermost 0; the columns' own by `'columns'`. */
  readonly key: string | number;
  /** The cells to render, from the inline start: only those over a column the window holds. */
  readonly cells: readonly GridHeaderCell<T>[];
}

/**
 * One cell of a header row: a column's header, a group's, or the gap over a
 * column that has no group at that row.
 */
export interface GridHeaderCell<T> {
  readonly key: string | number;
  /** The header row it is in, as `GridHeaderRow.index`. */
  readonly row: number;
  /** The first column it spans, as a place in the column list. */
  readonly index: number;
  /**
   * How many columns it spans — every one of the run, rendered or not, which
   * is what `aria-colspan` says. One on the columns' own row.
   */
  readonly colspan: number;
  /**
   * Where its first rendered column starts, from the inline start of its
   * region, as `GridColumnView.start` is.
   */
  readonly start: number;
  /**
   * The width of the columns under it that the window holds, which is the
   * width it is drawn at. A group partly scrolled out of the window is drawn
   * over the part still in it, so every header row lines up with the columns
   * by the same arithmetic the columns' own row does.
   */
  readonly width: number;
  /** Present only over pinned columns: the region they are in. */
  readonly pin?: 'start' | 'end';
  /** The text to show: the column's header, the group's, or empty for a gap. */
  readonly header: string;
  /** The column it stands for, on the columns' own row; null above it. */
  readonly column: GridColumnView<T> | null;
  /** The group it stands for, on a row of groups; null on the columns' own row, and for a gap. */
  readonly group: GridColumnGroup | null;
}

export type GridPropValue =
  | string
  | number
  | boolean
  | undefined
  | Readonly<Record<string, string>>;

export interface GridProps {
  readonly [key: string]: GridPropValue;
}

export interface GridOptions<T> {
  /** The element carrying `role="grid"`. Everything else lives inside it. */
  grid: () => Element | null | undefined;
  /** The element that scrolls, in both directions. Holds the data rows. */
  scroller: () => Element | null | undefined;
  /** The element holding the rendered window — what `containerProps()` goes on. */
  container: () => Element | null | undefined;

  /** The rows, in order. */
  rows: () => readonly T[];
  /** The columns, in order. */
  columns: () => readonly GridColumn<T>[];

  /**
   * How tall a row is, in px. Default 32.
   *
   * A number is a promise that every row is exactly this tall, which makes the
   * vertical geometry arithmetic: nothing is measured, nothing is observed, and
   * a million rows cost what ten do.
   *
   * A function gives each row a height of its own, for heights known before
   * anything renders — a group header taller than the rows under it, a row
   * opened to show more. It is handed the row and its place in the view, and
   * asked again for every row whenever the view changes or anything it read
   * does: a sort carries each height with its row, and a height held in a
   * signal is followed. Each row is stated back at its height, as a number is.
   *
   * `'auto'` measures each rendered row instead, for heights only layout knows
   * — wrapped text, an editor that grows. A row is `estimatedRowHeight` until
   * it has rendered, and the offsets, the sizer and the window are corrected
   * as measurements land, without moving what the reader is looking at.
   */
  rowHeight?: number | ((row: T, index: number) => number) | 'auto';
  /**
   * What a row is taken to be before it has been measured, in px. Read only
   * where `rowHeight` is `'auto'`. Default 32.
   *
   * Worth setting near a typical row: every row not yet rendered is this tall
   * as far as the sizer knows, so an estimate far out is a scrollbar thumb
   * that drifts under the reader as the real heights arrive.
   */
  estimatedRowHeight?: number;
  /**
   * `'auto'` makes the scroller as tall as its rows, up to `maxHeight`. Left
   * out, the scroller is whatever height the stylesheet gives it.
   *
   * The rows are still windowed: the window is whatever the scroller shows, so
   * below the cap every row renders and above it the grid scrolls as it does at
   * a fixed height. Without a cap, every row renders, however many there are.
   */
  height?: 'auto';
  /** The most the scroller may be, in px, whether or not `height` is `'auto'`. */
  maxHeight?: number;

  /**
   * What identifies a row, so that a keyed `:for` reuses a row's elements
   * rather than rebuilding them when the window moves. Defaults to the index,
   * which is right for a list that only ever grows at the end.
   *
   * A grid that can be edited wants a key of its own, as one with row
   * selection does: an edit session is over a row, and a key that is the row's
   * place stops naming that row the moment a sort moves it.
   */
  getRowKey?: (row: T, index: number) => string | number;

  /** Extra rows and columns rendered outside the viewport. Default 2 each way. */
  overscan?: number | Partial<VirtualOverscan>;

  /** The grid's accessible name. */
  label?: string;

  /**
   * Supply a signal to drive the cursor from outside. Without one the grid
   * owns it, which is what most callers want.
   */
  activeCell?: Signal.State<GridCell>;
  onActiveCellChange?: (cell: GridCell) => void;

  /** Called with the clamped width a resize settled on. */
  onColumnResize?: (id: string, width: number) => void;
  /**
   * The sentence announced when a column is resized from the keyboard.
   *
   * A default is given rather than left to the consumer, because the failure
   * mode of not having one is silence rather than a visible gap. It is the
   * locale's `gridColumnWidth` — `{column}` the header, `{n}` the width — or,
   * where the catalogue has none, English.
   */
  resizeAnnouncement?: (column: GridColumn<T>, width: number) => string;
  /**
   * The sentence announced when a column group is resized from the keyboard,
   * `width` being that of every column under the cell the cursor is on: the
   * whole group's, or one part's where a pin or a reorder has parted it.
   * Default the same `gridColumnWidth` sentence, with the group's header as
   * `{column}`.
   */
  groupResizeAnnouncement?: (group: GridColumnGroup, width: number) => string;
  /** How much one Alt+Arrow press resizes by, in px. Default 16. */
  resizeStep?: number;

  // --- Sorting -------------------------------------------------------------

  /**
   * Supply a signal to drive the sort from outside — which is also how a saved
   * view, a URL or a server-pushed order gets in. Without one the grid owns it.
   */
  sort?: Signal.State<readonly GridSort[]>;
  onSortChange?: (sort: readonly GridSort[]) => void;
  /**
   * The sentence announced when the reader changes the sort.
   *
   * Defaulted rather than left to the consumer for the same reason the resize
   * announcement is: without one the gesture is silent, and a sort's only other
   * evidence — rows in a different order — is exactly what a screen-reader user
   * cannot see. The default is built from the locale's `gridSortedBy`,
   * `gridAscending`, `gridDescending`, `gridThen` and `gridNotSorted`, each
   * falling back to English where the catalogue has none.
   */
  sortAnnouncement?: (sort: readonly GridSortDescriptor<T>[]) => string;

  // --- Filtering -----------------------------------------------------------

  /** The per-column filters, by column id. Supply a signal to drive them from outside. */
  filters?: Signal.State<ReadonlyMap<string, GridFilter>>;
  /** One string searched across every column that can be filtered. */
  quickFilter?: Signal.State<string>;
  onFilterChange?: (filters: ReadonlyMap<string, GridFilter>, quickFilter: string) => void;
  /**
   * The sentence announced when a filter changes what is on screen.
   *
   * The count is the whole point of it: the rows that stopped matching are not
   * in the DOM, and in a virtualized grid they never all were, so there is
   * nothing for a screen reader to notice going away. The default is the
   * locale's `gridRowsLeft`, or `gridAllRows` where nothing was left out —
   * `{n}` shown, `{m}` in all — or, where the catalogue has none, English.
   */
  filterAnnouncement?: (shown: number, total: number) => string;

  // --- Selection -----------------------------------------------------------

  /** Default `none`. `multiple` is what puts `aria-multiselectable` on the grid. */
  rowSelection?: GridRowSelectionMode;
  /**
   * The selected rows, by key.
   *
   * By key and not by index, because an index means a different row after
   * every sort and filter. A grid with row selection therefore wants
   * `getRowKey` — the default key *is* the index, and a selection held by it
   * cannot survive the thing selection exists to outlive.
   */
  selectedRows?: Signal.State<ReadonlySet<GridRowKey>>;
  onRowSelectionChange?: (keys: ReadonlySet<GridRowKey>) => void;
  /**
   * Whether this particular row can be selected. Default: all of them.
   *
   * For the rows of a collection that are not records — a group header, a
   * subtotal — and for the records a bulk action must not reach. Every gesture
   * asks it, and so does `selectAllRows`; a row it refuses carries no
   * `aria-selected`, which is how ARIA says a row cannot be. `selectRow` and
   * `toggleRowSelection` take a key and not a row, and are the caller's own.
   */
  selectable?: (row: T) => boolean;

  /** Default `none`. `range` turns on the keyboard-driven rectangle of cells. */
  cellSelection?: GridCellSelectionMode;
  cellRange?: Signal.State<GridCellRange | null>;
  onCellRangeChange?: (range: GridCellRange | null) => void;

  // --- Pinning -------------------------------------------------------------

  /**
   * The pins `pinColumn` has made, by column id, each overruling the column's
   * own `pin`; a column it does not name keeps its own. Supply a signal to
   * drive them from outside — `createGridState` takes the same one, which is
   * how a pin is saved.
   */
  columnPins?: Signal.State<ReadonlyMap<string, GridColumnPin>>;
  onColumnPinChange?: (pins: ReadonlyMap<string, GridColumnPin>) => void;
  /**
   * Rows held above the scrolling ones, outside the window: a total, a row
   * being compared against. Neither sorted nor filtered, and keyed by
   * `getRowKey` with their place among the rows pinned to that edge.
   */
  pinnedTop?: () => readonly T[];
  /** Rows held below the scrolling ones, as `pinnedTop` holds rows above them. */
  pinnedBottom?: () => readonly T[];
}

export interface Grid<T> {
  /** The rows to render, in order. */
  rows(): readonly GridRow<T>[];
  /** The columns to render, in order. Both axes are windowed. */
  columns(): readonly GridColumnView<T>[];
  /**
   * How many rows the grid has, rendered or not — after filtering, and with
   * the pinned rows.
   *
   * This is the number `aria-rowcount` reports, and it has to be the filtered
   * one. A reader told there are ten thousand rows in a grid a filter has left
   * nine of is worse off than a reader told nothing.
   *
   * Positions run through the rows as they are drawn: the rows pinned to the
   * top from 0, then the view, then the rows pinned to the bottom. That is the
   * one list the cursor, a cell range, `rowAt` and `rowIndex` all count in, so
   * ArrowUp from the first scrolling row is the pinned row above it.
   */
  rowCount(): number;
  /** How many rows were handed in, before any filter. */
  sourceRowCount(): number;
  columnCount(): number;
  /**
   * Where the row with this key sits in the view — sorted and filtered — or
   * -1 if the view does not hold it.
   *
   * The way from a record to a position: a position is what `focusCell` and
   * `scrollToCell` take, and which row is at one changes with every sort. A
   * scan of the view, so ask it once per change rather than once per cell.
   */
  rowIndex(key: GridRowKey): number;
  /**
   * The row at a position in the view, or undefined where the view does not
   * reach that far.
   *
   * The way back from a position to a record, as `rowIndex` is the way from a
   * record to a position. `rows()` answers it only for the rows the window
   * holds; this one reads the whole view, which is what a consumer holding a
   * cursor — or `createCellEditing`, checking that the key it is following
   * still names the row it opened on — has to ask about a row that is not on
   * screen.
   */
  rowAt(index: number): T | undefined;
  /**
   * Where the column with this id sits in the column list, or -1 if the list
   * does not hold it.
   *
   * The way from a column to a position, as `rowIndex` is from a record: a
   * column list handed over in another order, or without a column it had,
   * moves the columns after the change to other indices.
   *
   * The list is in the order the columns are drawn: the start-pinned ones,
   * then the scrolling ones, then the end-pinned ones, each in the order they
   * were handed over. Every position the grid gives or takes counts in it.
   */
  columnIndex(id: string): number;
  /**
   * The column at a position in the column list, or undefined where the list
   * does not reach that far.
   *
   * The way back from a position to a column, as `rowAt` is from a position
   * to a record, and for the same reason: `columns()` answers only for the
   * columns the window holds. Whatever has to remember the cursor's column
   * across a change to the list — `createEditHistory`, deciding whether the
   * reader is still where they pressed a key — remembers what it is, and a
   * position is only where it was.
   */
  columnAt(index: number): GridColumn<T> | undefined;
  /**
   * The width, in px, the column with this id is laid out at — rendered or
   * not — or undefined where the list does not hold it.
   *
   * `columns()` answers only for the columns the window holds, and a column
   * scrolled out of it keeps the width a resize gave it. Whatever lays the
   * grid out somewhere else — an export sizing a worksheet's columns — has to
   * ask about every one, and this is the grid's own arithmetic: what a resize
   * left, or the declared width, or the default, held to the column's bounds.
   */
  columnWidth(id: string): number | undefined;
  /**
   * Which way the columns run: `'ltr'` from the left, `'rtl'` from the right.
   *
   * The direction the browser lays the grid's element out in, read when it
   * mounts — or, mounted out of the document, once it is laid out — when a
   * `dir` is written on that element, and when the nearest locale's
   * direction changes. Column 0 is at the inline start either way;
   * what follows the direction is which side that is, the arrows, and the
   * horizontal transforms the props carry.
   *
   * A `dir` written on an element above the grid, with no locale there to
   * hear it, is not heard: watching every ancestor would cost every grid an
   * observer over the page. A page that turns round above the grid that way
   * mounts it again.
   */
  direction(): Direction;

  // --- Pinning -------------------------------------------------------------

  /**
   * Hold a column at an inline edge, or with null let it scroll. Within each
   * region the columns keep the order they were handed over in, so a column
   * pinned or unpinned goes where its place in that list puts it. The cursor
   * stays on its column, and a cell range is carried or dropped, as for any
   * change to the list. Silent: a column menu that pins says what it did.
   */
  pinColumn(id: string, side: GridColumnPin): void;
  /** Which edge a column is held at, or undefined where the list does not hold it. */
  columnPin(id: string): GridColumnPin | undefined;
  /** The rows pinned to the top, every one of them, in order. */
  pinnedTopRows(): readonly GridRow<T>[];
  /** The rows pinned to the bottom, every one of them, in order. */
  pinnedBottomRows(): readonly GridRow<T>[];

  /** Where the cursor is. `HEADER_ROW` means the column header. */
  activeCell(): GridCell;
  /** Move the cursor, scroll the cell into view, and focus it. */
  focusCell(cell: GridCell): void;
  /** Scroll a cell into view without moving the cursor or focus. */
  scrollToCell(cell: GridCell): void;

  /**
   * What this column shows for this row.
   *
   * Called from the consumer's template, once per cell, inside that cell's own
   * binding — which is what makes a value change write one text node.
   */
  cellValue(row: GridRow<T>, column: GridColumnView<T>): unknown;
  /** Resize a column. The width is clamped to the column's own bounds. */
  resizeColumn(id: string, width: number): void;

  // --- Column groups -------------------------------------------------------

  /**
   * The header rows to render, top to bottom: a row for each level of group,
   * the outermost first, then the columns' own. One row, the columns', where
   * no column names a group.
   */
  headerRows(): readonly GridHeaderRow<T>[];
  /**
   * Resize a group: every column under it, the new width shared among them
   * in proportion to the widths they have — evenly, where together they have
   * none, as there is then no proportion to keep. Each column is held to its own
   * bounds, one that cannot be resized keeps its width, and what a bound
   * refuses goes to the others. Reported through `onColumnResize`, a column
   * at a time.
   *
   * A drag of a group's handle, and Alt and an arrow on its cell, resize the
   * columns under that cell the same way — the whole group, unless a pin or
   * a reorder has parted it and the cell is drawn over one part of it.
   */
  resizeGroup(id: string, width: number): void;

  // --- Sorting -------------------------------------------------------------

  /** The sort order, outermost term first. */
  sort(): readonly GridSort[];
  /** Which way a column is sorted, or null if it is not part of the order. */
  sortDirection(columnId: string): GridSortDirection | null;
  /**
   * Replace the whole order. Silent: this is the state-restoring path, and a
   * grid that announced its own saved sort on load would talk over the page.
   */
  setSort(sort: readonly GridSort[]): void;
  /**
   * Cycle one column: ascending, descending, then out of the order entirely.
   * `additive` adds it to the existing order rather than replacing it.
   *
   * This is the gesture, so it announces.
   */
  toggleSort(columnId: string, additive?: boolean): void;

  // --- Filtering -----------------------------------------------------------

  filters(): ReadonlyMap<string, GridFilter>;
  /**
   * Set or, with null, remove one column's filter. Refused for a column that
   * is not `filterable`, which is every column of a grouped grid.
   */
  setFilter(columnId: string, filter: GridFilter | null): void;
  clearFilters(): void;
  quickFilter(): string;
  /** Search every column that can be filtered. Refused where none can. */
  setQuickFilter(text: string): void;

  // --- Selection -----------------------------------------------------------

  selectedRows(): ReadonlySet<GridRowKey>;
  isRowSelected(key: GridRowKey): boolean;
  /** Select one row, replacing the selection unless `additive`. */
  selectRow(key: GridRowKey, additive?: boolean): void;
  toggleRowSelection(key: GridRowKey): void;
  /** Every row the filter left — never a row the reader cannot see. */
  selectAllRows(): void;
  clearRowSelection(): void;

  /** The selected rectangle of cells, by position in the current view. */
  cellRange(): GridCellRange | null;
  setCellRange(range: GridCellRange | null): void;
  isCellSelected(row: number, column: number): boolean;

  /** Handle a keydown. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;
  /** Keeps the cursor and the browser's idea of focus from drifting apart. */
  onFocusIn(event: FocusEvent): void;
  /** Starts a column resize drag. Wire it to the resize handle. */
  onResizePointerDown(event: PointerEvent): void;
  /** Sorts the column clicked. Shift adds it to the order. Wire it to the header cell. */
  onHeaderClick(event: MouseEvent): boolean;
  /**
   * Selects the row clicked, where row selection is on. Ctrl toggles one row,
   * Shift takes a range. Wire it to the cell.
   */
  onCellClick(event: MouseEvent): boolean;

  gridProps(): GridProps;
  headerProps(): GridProps;
  /** A header row's props; with none named, the columns' own row's. */
  headerRowProps(row?: GridHeaderRow<T>): GridProps;
  /**
   * A header cell's props: a column's, from `columns()` or from the columns'
   * own header row, a group's, or a gap's, from a row of groups.
   */
  headerCellProps(cell: GridColumnView<T> | GridHeaderCell<T>): GridProps;
  bodyProps(): GridProps;
  /** The empty element sized to the whole collection, on both axes. */
  sizerProps(): GridProps;
  containerProps(): GridProps;
  /**
   * The rowgroup below the scroller that holds the rows pinned to the bottom,
   * as the header holds those pinned to the top.
   */
  footerProps(): GridProps;
  rowProps(row: GridRow<T>): GridProps;
  cellProps(row: GridRow<T>, column: GridColumnView<T>): GridProps;
  /** A resize handle's props: a column's, a group's, or a gap's, which resizes nothing. */
  resizerProps(cell: GridColumnView<T> | GridHeaderCell<T>): GridProps;
}

export function createGrid<T>(options: GridOptions<T>): Grid<T> {
  /**
   * The locale, for ordering and folding text and for what the grid says.
   *
   * `String#localeCompare` and `String#toLowerCase` with no argument both use
   * the *runtime's* locale rather than the application's, and both are wrong
   * in the same languages: Swedish sorts ö after z rather than beside o, and
   * Turkish has a dotless ı that the invariant fold runs together with i — so
   * a filter for "ilk" would match "Ilk" in a language where those are
   * different words.
   */
  const locale = useLocale();
  const compareText = (a: string, b: string): number => locale.compare(a, b);
  const fold = (text: string): string => text.toLocaleLowerCase(locale.code());

  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const resizeStep = options.resizeStep ?? DEFAULT_RESIZE_STEP;
  const resizeAnnouncement =
    options.resizeAnnouncement ??
    ((column: GridColumn<T>, width: number): string => describeWidth(locale, column, width));
  const groupResizeAnnouncement =
    options.groupResizeAnnouncement ??
    ((group: GridColumnGroup, width: number): string => describeWidth(locale, group, width));
  const sortAnnouncement =
    options.sortAnnouncement ??
    ((sort: readonly GridSortDescriptor<T>[]): string => describeSortOrder(locale, sort));
  const filterAnnouncement =
    options.filterAnnouncement ??
    ((shown: number, total: number): string => describeFilterCount(locale, shown, total));

  const rowSelectionMode = options.rowSelection ?? 'none';
  const cellSelectionMode = options.cellSelection ?? 'none';

  const columnPins =
    options.columnPins ?? new Signal.State<ReadonlyMap<string, GridColumnPin>>(EMPTY_PINS);
  const drawnColumns = drawnColumnList(options.columns, columnPins);
  /**
   * Every column, in the order it is drawn, and the only list anything here
   * reads: one index means one column to the cursor, a range, an export and
   * the clipboard alike. Where nothing is pinned it is the caller's own list.
   */
  const columnList = (): readonly GridColumn<T>[] => drawnColumns.get();
  const columnCount = (): number => columnList().length;
  const columnById = (id: string): GridColumn<T> | undefined =>
    columnList().find((column) => column.id === id);

  // --- The derived view ----------------------------------------------------

  const sortState = options.sort ?? new Signal.State<readonly GridSort[]>(EMPTY_SORT);
  const filterState =
    options.filters ?? new Signal.State<ReadonlyMap<string, GridFilter>>(EMPTY_FILTERS);
  const quickState = options.quickFilter ?? new Signal.State('');

  /**
   * The terms of the sort that order anything: those naming a column that is
   * still in the list and can be sorted.
   *
   * The others stay in the signal rather than being thrown over, because a
   * saved view outlives the column list it was saved against. But everything
   * the grid reports about the sort — a direction, `aria-sort`, a place in the
   * order — reads this, since a term that orders nothing is not a claim the
   * rows on screen bear out.
   */
  const activeSort = new Signal.Computed<readonly GridSort[]>(() => {
    const list = columnList();
    const entries = sortState.get();
    const kept = entries.filter((entry) => {
      const column = list.find((candidate) => candidate.id === entry.columnId);
      return column !== undefined && column.sortable !== false;
    });
    // The signal's own array when nothing was left out, so the common case
    // hands every header the value it would have read from the signal.
    return kept.length === entries.length ? entries : kept;
  });

  /**
   * The sort, resolved against the columns it names.
   *
   * Resolved once per change rather than once per comparison — a comparator
   * that looked its own accessor up would do so `n log n` times.
   */
  const sortTerms = new Signal.Computed<readonly GridSortTerm<T>[]>(() => {
    const list = columnList();
    return activeSort.get().map((entry) => {
      const column = list.find((candidate) => candidate.id === entry.columnId)!;
      return {
        direction: entry.direction,
        value: column.sortValue ?? column.value,
        compare: column.compare,
      };
    });
  });

  /**
   * One compiled predicate per column whose filter actually filters something.
   *
   * Compiling here and not in the row loop is what keeps a text filter from
   * folding the same needle a hundred thousand times and a set filter from
   * rebuilding its `Set` per row. It is also where a filter the reader has
   * started but not finished — an empty text box, a range missing its second
   * number — becomes no filter at all, which is what lets the view below hand
   * back the caller's own array untouched.
   */
  const columnFilters = new Signal.Computed<readonly CompiledFilter<T>[]>(() => {
    const map = filterState.get();
    const compiled: CompiledFilter<T>[] = [];
    if (map.size === 0) return compiled;
    for (const column of columnList()) {
      const filter = map.get(column.id);
      // Left in the signal, as a sort term naming an unsortable column is, and
      // left out of everything that filters or reports a filter.
      if (filter === undefined || column.filterable === false) continue;
      const test = compileFilter(filter, fold);
      if (test === null) continue;
      compiled.push({ columnId: column.id, value: column.filterValue ?? column.value, test });
    }
    return compiled;
  });

  const quickTerms = new Signal.Computed<readonly string[]>(() =>
    quickFilterTerms(quickState.get(), fold),
  );

  /**
   * The rows as the grid presents them — and never the array the caller passed.
   *
   * Sorting and filtering are derived here rather than stored anywhere. The
   * caller's array is theirs: they may hold references into it, render the same
   * objects somewhere else, or hand the identical array back on the next tick,
   * and a grid that reordered it in place would break all three. So the source
   * is read, never written, and the rows inside the result are the caller's own
   * objects — which is also the contract identity-keyed rendering rests on.
   *
   * With neither a filter nor a sort this returns the source array itself, by
   * identity. That matters more than it looks: it means an unsorted, unfiltered
   * grid subscribes to no cell's value here at all, so writing one cell still
   * invalidates one cell's binding and nothing else.
   *
   * With a filter or a sort it necessarily does subscribe — to the values those
   * read, for every row. That is the honest cost of a live view: a value that
   * changes what a filter matches has to re-filter, or the grid is showing a
   * row that no longer qualifies.
   */
  const view = new Signal.Computed<readonly T[]>(() => {
    const source = options.rows();
    const filters = columnFilters.get();
    const terms = quickTerms.get();
    // Resolved outside the loop: the quick filter searches every column that
    // can be filtered, and looking the accessors up per row would be most of
    // what it costs. With no such column it has nowhere to look, and filters
    // nothing.
    const quick = terms.length > 0 ? quickFilterValues(columnList()) : null;

    let rows = source;
    if (filters.length > 0 || quick !== null) {
      // Reused across rows, for the same reason.
      const texts: string[] = quick === null ? [] : new Array<string>(quick.length);

      rows = source.filter((row) => {
        for (const filter of filters) {
          if (!filter.test(filter.value(row))) return false;
        }
        if (quick === null) return true;
        for (let i = 0; i < quick.length; i++) texts[i] = fold(asText(quick[i]!(row)));
        return matchesQuickFilter(texts, terms);
      });
    }

    return sortRows(rows, sortTerms.get(), compareText);
  });

  const rowList = (): readonly T[] => view.get();
  const rowCount = (): number => rowList().length;
  const sourceRowCount = (): number => options.rows().length;

  const rowKeyOf = (row: T, index: number): GridRowKey =>
    options.getRowKey?.(row, index) ?? index;

  /**
   * Where a key's row sits in a list of rows, or -1.
   *
   * A linear scan. A map from key to index would have to be rebuilt every time
   * the view changes, at an allocation per row, to save a walk that is asked
   * for once per change. Rows identified only by their index — the default —
   * find themselves where they already were, which is the documented cost of
   * not giving `getRowKey`.
   */
  const indexOfKey = (rows: readonly T[], key: GridRowKey): number => {
    for (let i = 0; i < rows.length; i++) {
      if (rowKeyOf(rows[i]!, i) === key) return i;
    }
    return -1;
  };

  /**
   * Widths a resize has written, by column id.
   *
   * Held apart from the column definitions because those are the consumer's,
   * and a grid that rewrote them would be a grid that fights whatever produced
   * them. Keyed by id rather than by index so a column list that is re-fetched,
   * or reordered by the consumer, keeps the widths the user chose.
   */
  const widths = new Signal.State<ReadonlyMap<string, number>>(new Map());
  /** The column currently being dragged, for the handle's own state. */
  const resizing = new Signal.State<string | null>(null);

  const active = options.activeCell ?? new Signal.State<GridCell>({ row: 0, column: 0 });

  const clampWidth = (column: GridColumn<T>, width: number): number => {
    const low = column.minWidth ?? DEFAULT_MIN_COLUMN_WIDTH;
    const high = column.maxWidth ?? Number.POSITIVE_INFINITY;
    return Math.round(clamp(width, low, Math.max(low, high)));
  };

  /** One column's width, which `columnWidth` answers from as well as the geometry. */
  const widthFor = (column: GridColumn<T>): number =>
    clampWidth(column, widths.get().get(column.id) ?? column.width ?? DEFAULT_COLUMN_WIDTH);

  /**
   * The width the geometry should use for a column.
   *
   * Read tracked, as the virtualizer's `itemSize`: the column geometry is
   * rebuilt whenever anything a size reads changes, so a resize writing
   * `widths` and a consumer handing in a new column list both rebuild it, once,
   * with nothing having to ask. Column geometry is declared rather than
   * measured — a column's width is state the grid holds, being exactly what a
   * resize writes — so this is the only way in.
   */
  const sizeOf = (index: number): number => {
    const column = columnList()[index];
    return column ? widthFor(column) : 0;
  };

  /** The same width, read from a handler that must not subscribe to it. */
  const widthOf = (index: number): number => untrack(() => sizeOf(index));

  // --- Pinned columns and rows ---------------------------------------------

  /**
   * How many columns each edge holds, and how wide each edge is.
   *
   * Counted from the ends of the drawn list, which is where the pinned columns
   * are. Equal for as long as those four numbers are, so resizing a scrolling
   * column tells nothing that reads it.
   */
  const pinLayout = new Signal.Computed<PinLayout>(
    () => measurePins(columnList(), columnPins.get(), widthFor),
    { equals: samePinLayout },
  );

  /** Whether any column is pinned — the one question every unpinned path asks. */
  const pinsColumns = (): boolean => pinLayout.get() !== NO_PINS;

  /** Whether the column at a drawn position is pinned, and so always rendered. */
  const isPinnedColumn = (index: number): boolean => {
    const { start, end } = pinLayout.get();
    const count = columnCount();
    return index >= 0 && index < count && (index < start || index >= count - end);
  };

  const pinColumn = (id: string, side: GridColumnPin): void => {
    const column = untrack(options.columns).find((candidate) => candidate.id === id);
    if (column === undefined) return;
    const current = untrack(() => columnPins.get());
    const next = asPin(side);
    if (pinOf(column, current) === next) return;
    const pins = new Map(current);
    pins.set(id, next);
    columnPins.set(pins);
    options.onColumnPinChange?.(pins);
  };

  /**
   * Where the first scrolling column rendered starts in the scrolling region,
   * which is how far the window has moved.
   */
  const scrollingWindowStart = (): number => {
    const { start, end, startWidth } = pinLayout.get();
    const last = columnCount() - end;
    for (const item of columnAxis.items()) {
      if (item.index >= start && item.index < last) return item.start - startWidth;
    }
    return 0;
  };

  /**
   * What keeps a row outside the scroller — the header row, a pinned row — in
   * step with the columns under a horizontal scroll.
   *
   * One transform where nothing is pinned, as the header row always had. A
   * pinned cell is held at its edge by `position: sticky`, which places it by
   * layout, so a transform on the row around it would carry it off the edge
   * it is stuck to; where a column is pinned the row is moved by a margin.
   */
  const horizontalShift = (): Readonly<Record<string, string>> =>
    pinsColumns()
      ? { 'margin-inline-start': `${scrollingWindowStart() - columnAxis.scrollOffset()}px` }
      : { transform: `translateX(${inline(columnAxis.offset() - columnAxis.scrollOffset())}px)` };

  /**
   * The container's style. The window is moved by padding where a column is
   * pinned, for the reason a row outside the scroller is moved by a margin: a
   * horizontal transform between a sticky cell and the scroller would move
   * the cell as well. The vertical one moves no pinned cell off its edge, and
   * stays.
   */
  const containerStyle = (): Readonly<Record<string, string>> =>
    pinsColumns()
      ? {
          transform: `translate(0px, ${rowAxis.offset()}px)`,
          'padding-inline-start': `${scrollingWindowStart()}px`,
        }
      : { transform: `translate(${inline(columnAxis.offset())}px, ${rowAxis.offset()}px)` };

  /**
   * A cell's style, header or body: its width, and on a pinned column the
   * sticky offset that holds it at its edge — from the start of the start
   * region, or from the end of the end region.
   */
  const cellStyle = (
    column: Pick<GridColumnView<T>, 'start' | 'width' | 'pin'>,
  ): Readonly<Record<string, string>> => {
    const width = `${column.width}px`;
    if (column.pin === undefined) return { width };
    if (column.pin === 'start') {
      return { width, position: 'sticky', 'inset-inline-start': `${column.start}px` };
    }
    const inset = pinLayout.get().endWidth - column.start - column.width;
    return { width, position: 'sticky', 'inset-inline-end': `${inset}px` };
  };

  /**
   * The scroller's props, told how much of each edge the pinned columns cover.
   * Focus the browser moves itself — Tab into the grid, a click on a cell half
   * under a pinned one — then scrolls the cell clear of them, as the keyboard
   * does here.
   */
  const padForPins = (props: GridProps): GridProps => {
    const layout = pinLayout.get();
    if (layout === NO_PINS) return props;
    const style = props.style as Readonly<Record<string, string>> | undefined;
    return {
      ...props,
      style: {
        ...style,
        'scroll-padding-inline-start': `${layout.startWidth}px`,
        'scroll-padding-inline-end': `${layout.endWidth}px`,
      },
    };
  };

  const pinnedTop = new Signal.Computed<readonly T[]>(() => options.pinnedTop?.() ?? NO_ROWS);
  const pinnedBottom = new Signal.Computed<readonly T[]>(
    () => options.pinnedBottom?.() ?? NO_ROWS,
  );
  /**
   * How many rows each edge holds, apart from which rows they are. A row of
   * totals is a new object whenever a value under it changes, and every
   * scrolling row's place, and every cell's tab stop, depends on the count
   * alone: read through the rows, one edit would ask all of them again.
   */
  const topCounted = new Signal.Computed(() => pinnedTop.get().length);
  const bottomCounted = new Signal.Computed(() => pinnedBottom.get().length);
  const topCount = (): number => topCounted.get();
  const bottomCount = (): number => bottomCounted.get();

  /** Every row the cursor can stand on: the pinned rows and the view. */
  const allRowCount = (): number => topCount() + rowCount() + bottomCount();

  /** Whether a position names a pinned row rather than a row of the view. */
  const isPinnedRow = (row: number): boolean => {
    if (row < 0) return false;
    const top = topCount();
    return row < top || (bottomCount() > 0 && row >= top + rowCount());
  };

  /** The row at a position, and the key it goes by, wherever it is drawn. */
  const rowAtPosition = (index: number): { item: T; key: GridRowKey } | null => {
    if (index < 0) return null;
    const top = pinnedTop.get();
    if (index < top.length) return { item: top[index]!, key: rowKeyOf(top[index]!, index) };
    const rows = rowList();
    const at = index - top.length;
    if (at < rows.length) return { item: rows[at]!, key: rowKeyOf(rows[at]!, at) };
    const below = pinnedBottom.get();
    const under = at - rows.length;
    return under < below.length ? { item: below[under]!, key: rowKeyOf(below[under]!, under) } : null;
  };

  /** Where a key's row is drawn, pinned or not, or -1. */
  const positionOfKey = (key: GridRowKey): number => {
    const top = pinnedTop.get();
    const pinned = indexOfKey(top, key);
    if (pinned >= 0) return pinned;
    const rows = rowList();
    const inView = indexOfKey(rows, key);
    if (inView >= 0) return top.length + inView;
    const below = indexOfKey(pinnedBottom.get(), key);
    return below < 0 ? -1 : top.length + rows.length + below;
  };

  /**
   * A pinned row's height, as `rowHeight` gives one. Measured rows are not
   * measured here: a pinned row lies in a rowgroup of its own, in the flow,
   * and is whatever height it lays out at, so its `size` is the estimate.
   */
  const pinnedRowHeight = (item: T, index: number): number => {
    if (typeof rowHeight === 'number') return rowHeight;
    if (typeof rowHeight === 'function') return rowHeight(item, index);
    return options.estimatedRowHeight ?? DEFAULT_ROW_HEIGHT;
  };

  /**
   * The rows pinned to one edge, as rows. Every one is rendered, so there is
   * no window; each is handed back as the same object while its key, item,
   * position and height hold, as a scrolling row is, so that nothing about the
   * rows scrolling past makes a pinned cell read its value again.
   */
  const pinnedRowViews = (edge: GridRowPin): Signal.Computed<readonly GridRow<T>[]> => {
    let cache = new Map<GridRowKey, GridRow<T>>();
    return new Signal.Computed(() => {
      const items = edge === 'top' ? pinnedTop.get() : pinnedBottom.get();
      if (items.length === 0) {
        cache = new Map();
        return NO_ROW_VIEWS as readonly GridRow<T>[];
      }
      const base = edge === 'top' ? 0 : topCount() + rowCount();
      const next = new Map<GridRowKey, GridRow<T>>();
      const views: GridRow<T>[] = [];
      let start = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const key = rowKeyOf(item, i);
        const size = pinnedRowHeight(item, i);
        const cached = cache.get(key);
        const view: GridRow<T> =
          cached !== undefined &&
          cached.item === item &&
          cached.index === base + i &&
          cached.start === start &&
          cached.size === size
            ? cached
            : { index: base + i, key, item, start, size, pin: edge };
        next.set(key, view);
        views.push(view);
        start += size;
      }
      cache = next;
      return views;
    });
  };
  const pinnedTopViews = pinnedRowViews('top');
  const pinnedBottomViews = pinnedRowViews('bottom');

  /**
   * A pinned row's props. Not the virtualizer's to place or measure, so none
   * of its attributes; its place in the count is stated here, and it is moved
   * across with the columns as the header row is.
   */
  const pinnedRowProps = (row: GridRow<T>): GridProps => {
    const selectable = rowSelectionMode !== 'none' && isSelectable(row.item);
    const selected = selectable && isRowSelected(row.key);
    const stated = rowHeight !== 'auto';
    return {
      'aria-rowindex': String(row.index + 2 + groupRowCount()),
      style: { ...(stated ? { height: `${row.size}px` } : {}), ...horizontalShift() },
      role: 'row',
      'aria-selected':
        selectable && rowSelectionMode === 'multiple'
          ? String(selected)
          : selected
            ? 'true'
            : undefined,
      'data-selected': selected ? '' : undefined,
      'data-pinned': row.pin,
    };
  };

  /**
   * The row count and a scrolling row's place in it, where rows are pinned or
   * the header has rows of groups. The row axis counts only the view, under
   * one header row, so its numbers are moved past the rows pinned above and
   * the rows of groups; with neither they are its own.
   */
  const rowCountProps = (): GridProps =>
    topCount() + bottomCount() + groupRowCount() === 0
      ? rowAxis.countProps()
      : { 'aria-rowcount': String(allRowCount() + 1 + groupRowCount()) };

  const scrollingRowProps = (row: GridRow<T>): GridProps => {
    const top = topCount();
    const groups = groupRowCount();
    if (top + groups === 0) return rowAxis.itemProps(row.index);
    return {
      ...rowAxis.itemProps(row.index - top),
      'aria-rowindex': String(row.index + 2 + groups),
    };
  };

  /**
   * Bring a column wholly into view. Where columns are pinned the view is the
   * band between the two pinned edges, which the virtualizer does not know
   * about: aimed at the viewport, it would leave a column under a pinned one.
   * A pinned column is always in view. Untracked, as the row's is.
   */
  const scrollToColumn = (column: number): void =>
    untrack(() => {
      if (!pinsColumns()) {
        columnAxis.scrollToIndex(column);
        return;
      }
      const count = columnCount();
      if (count === 0) return;
      const index = clamp(Math.trunc(column), 0, count - 1);
      if (isPinnedColumn(index)) return;
      const viewport = columnAxis.viewportSize();
      if (viewport <= 0) {
        columnAxis.scrollToIndex(index);
        return;
      }
      const { startWidth, endWidth } = pinLayout.get();
      const from = columnAxis.offsetOf(index);
      const to = from + columnAxis.sizeOf(index);
      const scroll = columnAxis.scrollOffset();
      if (from < scroll + startWidth) {
        columnAxis.scrollToOffset(from - startWidth);
      } else if (to > scroll + viewport - endWidth) {
        // A column wider than the band shows its start.
        columnAxis.scrollToOffset(Math.min(from - startWidth, to - viewport + endWidth));
      }
    });

  // --- The two axes --------------------------------------------------------

  /**
   * Created before the axes, so that it is read before them when the grid
   * first settles: the column axis decides which way to write a scroll as it
   * first looks at the scroller, and asked after the direction is known it
   * does not have to look again.
   *
   * A grid built out of the document is read once it is laid out, which the
   * column axis hears first: its observer sees the scroller get a box.
   */
  const direction = watchDirection(options.grid, locale, () => columnAxis.viewportSize());

  /**
   * A distance along the row as a physical x. Transforms are physical, and
   * right to left the row runs from the right, so a distance toward its
   * inline end is a move to the left.
   */
  const inline = (distance: number): number => (direction() === 'rtl' ? -distance : distance);

  /**
   * The scroller, as the column axis is told it: read with the direction, so
   * that a direction changed after mounting has the axis look at the scroller
   * again. It decides there which way a scroll is written — leftward is
   * negative right to left — and would otherwise go on writing scrolls the
   * old way under transforms that had flipped.
   */
  const columnScroller = (): Element | null | undefined => {
    direction();
    return options.scroller();
  };

  const rowSizes = rowSizesFor(
    rowHeight,
    options.estimatedRowHeight ?? DEFAULT_ROW_HEIGHT,
    rowList,
  );

  /**
   * A declared height, stated back on its row.
   *
   * The virtualizer states a single height back and states nothing for sizes
   * that vary, since sizes that vary are usually estimates. A declared one is
   * not, and the arithmetic is only true while the element is the size the
   * geometry was told — so it is stated here, from the row view that carries
   * it. A measured row is left to be whatever height it lays out at.
   */
  const declaredHeight = (row: GridRow<T>): GridProps | undefined =>
    typeof rowHeight === 'function' ? { style: { height: `${row.size}px` } } : undefined;

  const scrollerHeight = scrollerHeightStyle(options.height, options.maxHeight);

  const rowAxis = createVirtualizer({
    scroller: options.scroller,
    container: options.container,
    count: rowCount,
    itemSize: rowSizes.itemSize,
    measure: rowSizes.measure,
    overscan: options.overscan,
    // Read tracked, unlike the column axis below. A row's key names the row at
    // that index, and a sort changes which row that is without changing how
    // many there are — so a window that did not depend on the view would hand
    // `:for` last order's keys and reuse the wrong row's elements. The column
    // axis can afford to untrack its keys: its sizes read the column list the
    // keys come from, so the keys are read again whenever that list changes.
    getItemKey: (index) => {
      const item = rowList()[index];
      return item === undefined ? index : rowKeyOf(item, index);
    },
    // Rows count with `aria-rowindex`, and the count lives on the grid rather
    // than on each row. Two, because the column header is row one.
    counting: 'row',
    indexBase: 2,
    axis: 'vertical',
  });
  if (rowSizes.measure) watchRowsBroughtIn(rowAxis);

  const columnAxis = createVirtualizer({
    scroller: columnScroller,
    // Deliberately empty, and nothing measured: nothing may observe a header
    // cell and quietly overrule the width the grid is holding. The sizes are
    // the grid's own, and rebuild the geometry by being read.
    container: () => null,
    count: columnCount,
    itemSize: sizeOf,
    measure: false,
    overscan: options.overscan,
    getItemKey: (index) => untrack(() => columnList()[index]?.id ?? index),
    counting: 'column',
    indexBase: 1,
    axis: 'horizontal',
  });

  /**
   * The last set of row views, by key — so that a row nothing has changed about
   * is handed back as the identical object.
   *
   * This is what makes a re-sort cheap. `each` writes the item it is given into
   * the row's own signal, and a signal set to the value it already holds
   * notifies nobody; so returning the same `GridRow` for a row whose key, data,
   * index and offset are all unchanged means the cells inside it do not re-run
   * their bindings at all. A fresh object every pass would be indistinguishable
   * in the DOM and would cost a re-read of every cell on screen on every sort,
   * every filter and every scroll — which is precisely the re-render this whole
   * design exists to avoid.
   */
  let rowViewCache = new Map<string | number, GridRow<T>>();

  const rowViews = new Signal.Computed<readonly GridRow<T>[]>(() => {
    const list = rowList();
    const previous = rowViewCache;
    const next = new Map<string | number, GridRow<T>>();
    const views: GridRow<T>[] = [];
    // Counted past the rows pinned above, so that a row's index is the
    // position the cursor, a range and `rowAt` all use.
    const top = topCount();
    for (const item of rowAxis.items()) {
      const data = list[item.index];
      // The window was computed from a count, and this is the list itself; a
      // consumer whose `rows()` filters on the fly hands back a different
      // array to each caller, and the two can disagree by a row. Rendering one
      // row fewer is better than rendering a hole.
      if (data === undefined) continue;
      const index = top + item.index;
      const cached = previous.get(item.key);
      const view: GridRow<T> =
        cached !== undefined &&
        cached.item === data &&
        cached.index === index &&
        cached.start === item.start &&
        cached.size === item.size
          ? cached
          : { index, key: item.key, item: data, start: item.start, size: item.size };
      next.set(item.key, view);
      views.push(view);
    }
    rowViewCache = next;
    return views;
  });

  /**
   * The last set of column views, by key, for the reason rows keep theirs.
   *
   * A cell's binding reads its column view as much as its row view, so a fresh
   * object for every column would have every cell on screen read its value
   * again whenever the columns are handed over — two of them trading places,
   * one hidden past the window, one more scrolled into it. Handed back as the
   * same object, a column whose definition, index, offset and width all held
   * costs its cells nothing, and only the columns that genuinely moved are
   * read again.
   */
  let columnViewCache = new Map<string | number, GridColumnView<T>>();

  const columnViews = new Signal.Computed<readonly GridColumnView<T>[]>(() => {
    const list = columnList();
    const previous = columnViewCache;
    const next = new Map<string | number, GridColumnView<T>>();
    const views: GridColumnView<T>[] = [];
    const place = (
      index: number,
      key: string | number,
      start: number,
      width: number,
      pin: 'start' | 'end' | undefined,
    ): void => {
      const column = list[index];
      if (!column) return;
      const cached = previous.get(key);
      const view: GridColumnView<T> =
        cached !== undefined &&
        cached.column === column &&
        cached.index === index &&
        cached.start === start &&
        cached.width === width &&
        cached.pin === pin
          ? cached
          : {
              index,
              key,
              column,
              start,
              // From the geometry rather than from the definition, so that a
              // cell's width and the offset of the column after it can never
              // disagree.
              width,
              ...(pin === undefined ? {} : { pin }),
            };
      next.set(key, view);
      views.push(view);
    };

    const layout = pinLayout.get();
    if (layout === NO_PINS) {
      for (const item of columnAxis.items()) place(item.index, item.key, item.start, item.size, undefined);
    } else {
      // Every pinned column whatever the window holds, since none may be
      // windowed away, and each offset from the start of its own region,
      // which is what its sticky inset is measured from.
      const last = list.length - layout.end;
      const endsAt = columnAxis.totalSize() - layout.endWidth;
      for (let i = 0; i < layout.start; i++) {
        place(i, list[i]!.id, columnAxis.offsetOf(i), columnAxis.sizeOf(i), 'start');
      }
      for (const item of columnAxis.items()) {
        if (item.index < layout.start || item.index >= last) continue;
        place(item.index, item.key, item.start - layout.startWidth, item.size, undefined);
      }
      for (let i = last; i < list.length; i++) {
        place(i, list[i]!.id, columnAxis.offsetOf(i) - endsAt, columnAxis.sizeOf(i), 'end');
      }
    }
    columnViewCache = next;
    return views;
  });

  // --- Column groups -------------------------------------------------------

  /**
   * Which columns each group spans, at each level, over the whole list.
   *
   * Runs, not groups: a group is drawn over the columns that name it and sit
   * side by side, so one whose columns a reorder or a pin has parted is drawn
   * once over each part. A run stops at a pinned edge, since a pinned cell is
   * held at its edge and the cells beside it scroll away, and wherever the run
   * above it stops, so no group is drawn wider than the group it is in.
   *
   * Nothing is read but each column's `group` where no column names one, so
   * a grid without groups asks nothing of the pins and nothing of a width.
   * Equal for as long as every run and every column's groups are the same
   * objects, so a resize that moves no column tells nothing that reads it.
   */
  const columnGroups = new Signal.Computed<ColumnGroupLayout>(
    () => {
      const list = columnList();
      if (!list.some((column) => column.group !== undefined)) return NO_COLUMN_GROUPS;
      const { start, end } = pinLayout.get();
      const last = list.length - end;
      return layoutColumnGroups(list, (index) => (index < start ? 0 : index >= last ? 2 : 1));
    },
    { equals: sameColumnGroupLayout },
  );

  /**
   * How many rows of groups sit above the columns' own header row. Apart from
   * the layout, so that every row's `aria-rowindex` hears of a new depth and
   * of nothing else about the groups.
   */
  const groupDepth = new Signal.Computed(() => columnGroups.get().depth);
  const groupRowCount = (): number => groupDepth.get();

  /** The run of a row of groups over a column, or null where either is not there. */
  const runAt = (layout: ColumnGroupLayout, row: number, column: number): GroupRun | null => {
    const level = row - HEADER_ROW + layout.depth;
    if (level < 0 || level >= layout.depth) return null;
    const of = layout.runOf[level]!;
    if (column < 0 || column >= of.length) return null;
    return layout.levels[level]![of[column]!]!;
  };

  /**
   * A position on a row of groups, put on the group it falls in, at the
   * group's first column — where its one cell carries its position. Above the
   * top row is the top row. A position over a gap, or on a row of groups there
   * is no longer, is put on the columns' header row below it, which is always
   * there.
   */
  const clampToGroups = (row: number, column: number): GridCell => {
    const layout = columnGroups.get();
    const at = Math.max(Math.trunc(row), HEADER_ROW - layout.depth);
    const run = runAt(layout, at, column);
    return run !== null && run.group !== null
      ? { row: at, column: run.from }
      : { row: HEADER_ROW, column };
  };

  /** Whether the window draws any of a run: a pinned one always, a scrolling one where they meet. */
  const runIsDrawn = (run: GroupRun): boolean => {
    if (isPinnedColumn(run.from)) return true;
    const { startIndex, endIndex } = columnAxis.range();
    return startIndex >= 0 && run.from <= endIndex && run.to >= startIndex;
  };

  /**
   * The tab stop while the cursor is on a row of groups: its group's cell
   * wherever the window draws any of the group, as a group scrolled half out
   * of it is drawn over the half still in. A group the window has left
   * entirely has no cell to hold it, and the columns' header row below has
   * one at every column the window holds.
   */
  const groupTabStop = (cursor: GridCell, column: number): GridCell => {
    const run = runAt(columnGroups.get(), cursor.row, cursor.column);
    return run !== null && run.group !== null && runIsDrawn(run)
      ? { row: cursor.row, column: run.from }
      : { row: HEADER_ROW, column };
  };

  /**
   * The column window before focus moves to a cell on a row of groups, so
   * that afterwards it can be told whether the move scrolled it. Null for any
   * other row, which asks nothing of the window here.
   */
  const windowBeforeGroupFocus = (cell: GridCell): ReturnType<Virtualizer['range']> | null =>
    cell.row < HEADER_ROW ? untrack(() => columnAxis.range()) : null;

  /**
   * Whether a group's cell, focused at once, has to be focused again once the
   * window is drawn: where the move scrolled the window under it. A column's
   * cell is focused at once only when its column is already in the window, but
   * a group's stays drawn across a scroll that takes its columns far out of
   * and into the window, and drawing its row again can take it out of the
   * document and put it back — and focus with it, to nowhere.
   */
  const groupFocusRedrawn = (before: ReturnType<Virtualizer['range']> | null): boolean => {
    if (before === null) return false;
    const after = untrack(() => columnAxis.range());
    return after.startIndex !== before.startIndex || after.endIndex !== before.endIndex;
  };

  /**
   * Put a cursor that was on a group back on that group after the column list
   * changed, found again by id over the column the cursor follows, in
   * whichever row the group is drawn now — or on the header below, where the
   * group is no longer over that column. Rows of groups are numbered up from
   * the columns' own, so a row added or taken away under a group moves the
   * number it is drawn at, and the number alone would leave the cursor on
   * some other group, or on a gap.
   *
   * The whole of following such a cursor is done here, its column as well, so
   * it moves once: `follow` leaves it alone. Put back by its row number first,
   * it would land on whatever group or gap is drawn there now — over a column
   * a group that went gave its place to, the first column of some other group
   * — and focus and `onActiveCellChange` would be taken there on the way.
   *
   * `before` is the cursor as it was in `previous`, the list being replaced.
   * Nothing is asked of the columns where the cursor was not on a group.
   */
  const followGroup = (
    before: GridCell,
    previous: readonly GridColumn<T>[],
    columns: readonly GridColumn<T>[],
  ): void => {
    if (before.row >= HEADER_ROW) return;
    const paths = previous.map(columnGroupPath);
    const depth = paths.reduce((deepest, path) => Math.max(deepest, path.length), 0);
    const group = paths[before.column]?.[before.row - HEADER_ROW + depth];
    // The column the cursor follows, found again by id as any cursor's column
    // is, or the nearest one left where it has gone.
    const column = sameIds(previous, columns)
      ? before.column
      : (followColumn(before.column, placesOf(columns), previous) ?? before.column);

    const cursor = untrack(() => active.get());
    const layout = untrack(() => columnGroups.get());
    const level =
      group === undefined
        ? -1
        : (layout.paths[column]?.findIndex((under) => under.id === group.id) ?? -1);
    const next = untrack(() =>
      level < 0
        ? { row: HEADER_ROW, column }
        : clampToGroups(HEADER_ROW - layout.depth + level, column),
    );
    if (next.row === cursor.row && next.column === cursor.column) {
      refocusGroupCell(next);
      return;
    }
    if (cursorHeldFocus() && !focusInsideCell()) focusFollowedGroup(next);
    else setActive(next);
  };

  /**
   * Bring focus back to the cursor's group cell where the cursor stayed put
   * and the element under it did not. A part's cell is keyed by how many parts
   * of its group come before it, so a part added, cut or joined ahead of the
   * cursor's hands the cursor's element to another part, or takes it out of
   * the document, and focus goes with it. Only where focus was on the cursor,
   * and on the cell rather than on a control inside it; and only where the
   * cell is drawn, since a group the window has left has no cell to hold it.
   *
   * Focused where it is drawn, not through `focusCell`, which would scroll the
   * window to the part's first column: the part has not moved, and a reader
   * who scrolled that column out of view would be taken back to it for a
   * change somewhere they were not looking.
   */
  const refocusGroupCell = (cell: GridCell): void => {
    if (!cursorHeldFocus() || focusInsideCell()) return;
    const el = elementAt(cell);
    if (el !== null && el !== el.ownerDocument.activeElement) el.focus();
  };

  /**
   * Whether the reader can see any of a run: a pinned one always, a scrolling
   * one where it meets the band between the pinned edges, measured as
   * `scrollToColumn` measures a column. Before the scroller is measured there
   * is no band, and the window is all there is to go by.
   */
  const runInView = (run: GroupRun): boolean => {
    if (isPinnedColumn(run.from)) return true;
    const viewport = columnAxis.viewportSize();
    if (viewport <= 0) return runIsDrawn(run);
    const { startWidth, endWidth } = pinLayout.get();
    const scroll = columnAxis.scrollOffset();
    const from = columnAxis.offsetOf(run.from);
    const to = columnAxis.offsetOf(run.to) + columnAxis.sizeOf(run.to);
    return from < scroll + viewport - endWidth && to > scroll + startWidth;
  };

  /**
   * Focus the group cell a cursor was followed to, without the reader having
   * moved it: on the cell as the window draws it where they can see any of
   * the group, and through `focusCell` where they can see none. `focusCell`
   * brings a group's first column into view, as a key that moves onto a group
   * should; for a group followed to another row, its columns where they were,
   * that would take a reader who had scrolled its first column away back to
   * it for a change they did not make.
   */
  const focusFollowedGroup = (cell: GridCell): void => {
    const run = cell.row < HEADER_ROW ? untrack(() => runAt(columnGroups.get(), cell.row, cell.column)) : null;
    if (run === null || run.group === null || !untrack(() => runInView(run))) {
      focusCell(cell);
      return;
    }
    setActive(cell);
    const el = elementAt(cell);
    // A row of groups added under it is in the document a render from now.
    pendingFocus = el === null ? cell : null;
    if (el === null) return;
    focusOnCursor = true;
    el.focus();
  };

  /**
   * Follow the cursor's group across the rows of groups laid out again over
   * the same column list, as a pin does at either end of the list: a column
   * pinned or let go there moves no column, but cuts its group's run at the
   * pinned edge or joins it up again, and a part joined into the one before it
   * takes the cursor onto that one's first column. A change to the list itself
   * is `followGroup`'s, which finds the group by id, and is left to it here:
   * clamped first, the cursor would be followed from somewhere it never was.
   *
   * An effect of its own rather than one more read in the effect that follows
   * the cursor. That one has to run after the effect that focuses a cell once
   * its window is drawn, or a cell it scrolls to would be looked for before it
   * is drawn and never focused; and which of two effects runs first follows
   * what each of them reads.
   */
  const followGroupCuts = (): void => {
    let seen: { list: readonly GridColumn<T>[]; layout: ColumnGroupLayout } | null = null;
    effect(() => {
      const list = columnList();
      const layout = columnGroups.get();
      const before = seen;
      seen = { list, layout };
      if (before === null || before.layout === layout || before.list !== list) return;
      untrack(() => {
        const cursor = active.get();
        if (cursor.row >= HEADER_ROW) return;
        const next = clampCell(cursor);
        if (next.row === cursor.row && next.column === cursor.column) refocusGroupCell(next);
        else if (cursorHeldFocus() && !focusInsideCell()) focusFollowedGroup(next);
        else setActive(next);
      });
    });
  };
  followGroupCuts();

  /** The places in the column list of every column under a group, at any depth. */
  const columnsOfGroup = (id: string): number[] => {
    const { paths } = untrack(() => columnGroups.get());
    const places: number[] = [];
    for (let i = 0; i < paths.length; i++) {
      if (paths[i]!.some((group) => group.id === id)) places.push(i);
    }
    return places;
  };

  /**
   * The places of the columns one cell of a group spans, `from` to `to`.
   *
   * What a gesture on a group's cell resizes, rather than every column under
   * the group: a group a pin or a reorder has parted is drawn once over each
   * part, and a drag that also moved the part drawn elsewhere — pinned at the
   * other edge, perhaps — would move columns the reader is not touching and
   * leave the cell behind the pointer. Where nothing has parted the group,
   * its one cell spans all of it.
   */
  const columnsBetween = (from: number, to: number): number[] =>
    Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

  /** The columns at these places in the list, read without subscribing to it. */
  const columnsAt = (places: readonly number[]): GridColumn<T>[] => {
    const list = untrack(columnList);
    return places.flatMap((index) => (list[index] === undefined ? [] : [list[index]!]));
  };

  /** Whether any of these columns can be resized, which is what a group's handle says. */
  const anyResizable = (columns: readonly GridColumn<T>[]): boolean =>
    columns.some((column) => column.resizable !== false);

  /**
   * The group being dragged, for its handles' own state — apart from a
   * column's, whose id it may share — and the id of a column of the part
   * whose handle it is, or null where the handle was in no cell of the group
   * and the drag is the whole group's. A column's id rather than the cell's
   * place, so a list reordered under the drag leaves the mark on its handle.
   */
  const resizingGroup = new Signal.State<{ readonly id: string; readonly at: string | null } | null>(
    null,
  );

  /** The width each column is laid out at, read without subscribing to the widths. */
  const widthsOf = (columns: readonly GridColumn<T>[]): number[] =>
    untrack(() => columns.map(widthFor));

  /**
   * Share a width among columns, in proportion to `from` — the widths they
   * have, or for a drag the widths it started at, so a drag that comes back
   * comes back to where it began rather than to what rounding and the bounds
   * made of each move on the way. One write to the widths, so the geometry
   * rebuilds once however many columns moved. Their new width together, or
   * null where nothing changed.
   */
  const shareAmong = (
    columns: readonly GridColumn<T>[],
    width: number,
    from?: readonly number[],
  ): number | null => {
    if (columns.length === 0) return null;
    const now = widthsOf(columns);
    const was = from !== undefined && from.length === columns.length ? from : now;
    const shared = shareWidth(columns, was, width, (column, w) => clampWidth(column, w));
    if (shared === null) return null;

    const map = new Map(untrack(() => widths.get()));
    const changed: [string, number][] = [];
    for (let i = 0; i < columns.length; i++) {
      if (shared[i] === now[i]) continue;
      map.set(columns[i]!.id, shared[i]!);
      changed.push([columns[i]!.id, shared[i]!]);
    }
    if (changed.length === 0) return null;
    widths.set(map);
    for (const [column, settled] of changed) options.onColumnResize?.(column, settled);
    return shared.reduce((sum, w) => sum + w, 0);
  };

  /**
   * A drag of a group's handle, or null where the handle names no group that
   * can be resized there.
   *
   * It resizes the part of the group drawn under the handle's cell, found
   * from the cell it sits in as a click finds its cell. A handle in no cell
   * of its group has no part to name, and resizes the whole group, as
   * `resizeGroup` does.
   *
   * The columns it took hold of are held by id, as a column's drag holds its
   * column: a list reordered under the drag would put other columns at the
   * same places. One that leaves the list is let go, with its share.
   */
  const groupResizeDrag = (handle: Element): ResizeDrag | null => {
    const id = handle.getAttribute(GRID_COLUMN_GROUP_RESIZER_ATTRIBUTE);
    if (id === null) return null;
    const cell = cellFrom(handle);
    const run = cell === null ? null : untrack(() => runAt(columnGroups.get(), cell.row, cell.column));
    const own = run !== null && run.group?.id === id;
    const taken = columnsAt(own ? columnsBetween(run.from, run.to) : columnsOfGroup(id));
    if (!anyResizable(taken)) return null;
    const ids = taken.map((column) => column.id);
    const startWidths = widthsOf(taken);
    const shareFrom = (delta: number): void => {
      const columns: GridColumn<T>[] = [];
      const from: number[] = [];
      for (let i = 0; i < ids.length; i++) {
        const column = untrack(() => columnById(ids[i]!));
        if (column === undefined) continue;
        columns.push(column);
        from.push(startWidths[i]!);
      }
      shareAmong(columns, from.reduce((sum, w) => sum + w, 0) + delta, from);
    };
    return {
      hold: (on) => resizingGroup.set(on ? { id, at: own ? ids[0]! : null } : null),
      to: shareFrom,
      // Shared at the scale it started at, every column comes back to the
      // whole pixels it had: nothing is left over to round.
      cancel: () => shareFrom(0),
    };
  };

  /**
   * Header cells already handed out, by level and key, and the columns' own by
   * the column view each stands for, so that a cell nothing has changed about
   * is handed back as the same object and its props are not asked for again.
   */
  let groupCellCache = new Map<string, GridHeaderCell<T>>();
  const columnHeaderCells = new WeakMap<GridColumnView<T>, GridHeaderCell<T>>();
  let headerRowCache: readonly GridHeaderRow<T>[] = [];

  const columnHeaderCell = (view: GridColumnView<T>): GridHeaderCell<T> => {
    const cached = columnHeaderCells.get(view);
    if (cached !== undefined) return cached;
    const cell: GridHeaderCell<T> = {
      key: view.key,
      row: HEADER_ROW,
      index: view.index,
      colspan: 1,
      start: view.start,
      width: view.width,
      ...(view.pin === undefined ? {} : { pin: view.pin }),
      header: view.column.header,
      column: view,
      group: null,
    };
    columnHeaderCells.set(view, cell);
    return cell;
  };

  /**
   * One row of groups as cells: one over each run the window draws any of,
   * as wide as the columns of it the window holds and starting where the
   * first of them does.
   */
  const groupCells = (
    layout: ColumnGroupLayout,
    level: number,
    views: readonly GridColumnView<T>[],
    previous: ReadonlyMap<string, GridHeaderCell<T>>,
    next: Map<string, GridHeaderCell<T>>,
  ): GridHeaderCell<T>[] => {
    const row = HEADER_ROW - layout.depth + level;
    const runs = layout.levels[level]!;
    const of = layout.runOf[level]!;
    const cells: GridHeaderCell<T>[] = [];
    let run: GroupRun | null = null;
    let first: GridColumnView<T> | null = null;
    let width = 0;
    const close = (): void => {
      if (run === null || first === null) return;
      const id = `${level}\u0000${run.key}`;
      const cached = previous.get(id);
      const header = run.group?.header ?? '';
      const cell: GridHeaderCell<T> =
        cached !== undefined &&
        cached.row === row &&
        cached.index === run.from &&
        cached.colspan === run.to - run.from + 1 &&
        cached.start === first.start &&
        cached.width === width &&
        cached.pin === first.pin &&
        cached.header === header &&
        cached.group === run.group
          ? cached
          : {
              key: run.key,
              row,
              index: run.from,
              colspan: run.to - run.from + 1,
              start: first.start,
              width,
              ...(first.pin === undefined ? {} : { pin: first.pin }),
              header,
              column: null,
              group: run.group,
            };
      next.set(id, cell);
      cells.push(cell);
    };
    for (const view of views) {
      const at = runs[of[view.index]!]!;
      if (at === run) {
        width += view.width;
        continue;
      }
      close();
      run = at;
      first = view;
      width = view.width;
    }
    close();
    return cells;
  };

  /**
   * The header rows, top to bottom. A row is handed back as the same object
   * while its cells are, and the list while its rows are, so a vertical
   * scroll — or a horizontal one the window absorbs — touches no header cell.
   */
  const headerRowViews = new Signal.Computed<readonly GridHeaderRow<T>[]>(() => {
    const views = columnViews.get();
    const layout = columnGroups.get();
    const previous = headerRowCache;
    const nextCells = new Map<string, GridHeaderCell<T>>();
    const rows: GridHeaderRow<T>[] = [];
    const keep = (key: string | number, index: number, cells: GridHeaderCell<T>[]): void => {
      const before = previous.find((row) => row.key === key);
      rows.push(
        before !== undefined && before.index === index && sameItems(before.cells, cells)
          ? before
          : { index, key, cells },
      );
    };
    for (let level = 0; level < layout.depth; level++) {
      const cells = groupCells(layout, level, views, groupCellCache, nextCells);
      keep(level, HEADER_ROW - layout.depth + level, cells);
    }
    keep(COLUMNS_ROW_KEY, HEADER_ROW, views.map(columnHeaderCell));
    groupCellCache = nextCells;
    headerRowCache = sameItems(previous, rows) ? previous : rows;
    return headerRowCache;
  });

  /** The column a header cell stands for, or null for a group's or a gap's. */
  const columnOfHeaderCell = (
    cell: GridColumnView<T> | GridHeaderCell<T>,
  ): GridColumnView<T> | null => ('colspan' in cell ? cell.column : cell);

  /**
   * A group's header cell, or a gap's. A group is a column header spanning
   * its columns, navigable as the columns' own are. A gap stands for nothing
   * and is no cell at all — a column header with no text would be read out as
   * one — so it keeps only its place in the row.
   */
  const groupHeaderCellProps = (cell: GridHeaderCell<T>): GridProps => {
    const style = cellStyle(cell);
    const pinned = cell.pin === undefined ? {} : { 'data-pinned': cell.pin };
    if (cell.group === null) return { role: 'none', 'data-column-group-gap': '', style, ...pinned };
    return {
      [GRID_CELL_ATTRIBUTE]: cellKey(cell.row, cell.index),
      role: 'columnheader',
      'aria-colindex': String(cell.index + 1),
      'aria-colspan': String(cell.colspan),
      tabindex: isTabStop(cell.row, cell.index) ? '0' : '-1',
      'data-active': isActive(cell.row, cell.index) ? '' : undefined,
      'data-column-group': cell.group.id,
      style,
      ...pinned,
    };
  };

  /**
   * Whether a header row is a row of groups the window holds nothing but gaps
   * of — scrolled to a stretch under no group at that level. A row must hold a
   * cell, so such a row is no row to a screen reader. It is drawn all the
   * same, its gaps keeping the rows above and below it in line, and it is
   * counted, as a row the window has left is.
   */
  const onlyGaps = (row: GridHeaderRow<T> | undefined): boolean =>
    row !== undefined && row.index < HEADER_ROW && row.cells.every((cell) => cell.group === null);

  /** A group's resize handle, or a gap's, which has nothing to resize. */
  const groupResizerProps = (cell: GridHeaderCell<T>): GridProps => {
    const group = cell.group;
    if (group === null) {
      return { 'aria-hidden': 'true', 'data-disabled': '', style: { 'touch-action': 'none' } };
    }
    // Read tracked: a column made resizable or not changes no cell.
    const spanned = columnList().slice(cell.index, cell.index + cell.colspan);
    const held = resizingGroup.get();
    const dragged =
      held !== null &&
      held.id === group.id &&
      (held.at === null || spanned.some((column) => column.id === held.at));
    return {
      [GRID_COLUMN_GROUP_RESIZER_ATTRIBUTE]: group.id,
      'aria-hidden': 'true',
      'data-resizing': dragged ? '' : undefined,
      'data-disabled': anyResizable(spanned) ? undefined : '',
      style: { 'touch-action': 'none' },
    };
  };

  /**
   * Where a move off the top of the columns' header row goes. ArrowUp goes to
   * the innermost group over the column, where it has one; anything else that
   * overshoots the header — a page up — stops on the columns' header row, as
   * it always did, rather than landing among the groups.
   */
  const aboveColumnHeader = (cursor: GridCell, next: GridCell, stepping: boolean): GridCell => {
    if (!stepping || cursor.row !== HEADER_ROW) return { row: HEADER_ROW, column: next.column };
    const layout = untrack(() => columnGroups.get());
    const depth = layout.paths[cursor.column]?.length ?? 0;
    if (depth === 0) return { row: HEADER_ROW, column: next.column };
    return untrack(() => clampToGroups(HEADER_ROW - layout.depth + depth - 1, cursor.column));
  };

  /** The nearest group along a row of groups from a column, that way, or null for none. */
  const groupAlong = (
    layout: ColumnGroupLayout,
    row: number,
    column: number,
    step: 1 | -1,
  ): GridCell | null => {
    const level = row - HEADER_ROW + layout.depth;
    const runs = layout.levels[level]!;
    const of = layout.runOf[level]!;
    if (column < 0 || column >= of.length) return null;
    for (let i = of[column]!; i >= 0 && i < runs.length; i += step) {
      if (runs[i]!.group !== null) return { row, column: runs[i]!.from };
    }
    return null;
  };

  /**
   * A key pressed on a row of groups. The arrows go between groups, past the
   * gaps; down is the group under the first column, or that column's header;
   * a page down is a page from the columns' header, and a page up is already
   * as far up as it goes. Alt and an arrow resize the group. Undefined for a
   * key the grid answers here as it does anywhere — Ctrl+Home, Ctrl+A — or
   * leaves to the page, as Enter and Space are: a group neither sorts nor
   * selects, and what shuts one is the page's.
   */
  const onGroupRowKeyDown = (
    event: KeyboardEvent,
    key: string,
    cursor: GridCell,
  ): boolean | undefined => {
    const layout = untrack(() => columnGroups.get());
    const run = runAt(layout, cursor.row, cursor.column);
    if (run === null || run.group === null) return undefined;

    if (event.altKey) {
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
      const step = key === 'ArrowRight' ? resizeStep : -resizeStep;
      // The part under the cursor, as a drag of its handle would be.
      const part = columnsAt(columnsBetween(run.from, run.to));
      const settled = shareAmong(part, widthsOf(part).reduce((sum, w) => sum + w, 0) + step);
      if (settled !== null) announce(groupResizeAnnouncement(run.group, settled));
      event.preventDefault();
      return true;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) return undefined;

    const level = cursor.row - HEADER_ROW + layout.depth;
    const below = (): GridCell => {
      const under = runAt(layout, cursor.row + 1, run.from);
      return under !== null && under.group !== null
        ? { row: cursor.row + 1, column: under.from }
        : { row: HEADER_ROW, column: run.from };
    };
    let next: GridCell | null;
    switch (key) {
      case 'ArrowRight':
        next = groupAlong(layout, cursor.row, run.to + 1, 1);
        break;
      case 'ArrowLeft':
        next = groupAlong(layout, cursor.row, run.from - 1, -1);
        break;
      case 'Home':
        next = groupAlong(layout, cursor.row, 0, 1);
        break;
      case 'End':
        next = groupAlong(layout, cursor.row, layout.runOf[level]!.length - 1, -1);
        break;
      case 'ArrowUp': {
        const above = runAt(layout, cursor.row - 1, run.from);
        next = above !== null && above.group !== null ? { row: cursor.row - 1, column: above.from } : null;
        break;
      }
      case 'ArrowDown':
        next = below();
        break;
      case 'PageDown':
        next = { row: pageAcrossPins(HEADER_ROW, 1), column: run.from };
        break;
      case 'PageUp':
        next = null;
        break;
      default:
        return undefined;
    }
    event.preventDefault();
    // Nowhere to go spends the key, as at the edge of any row; and asks for
    // no scroll, which on a group drawn half out of the window would bring
    // its first column into view for a key that moved nothing.
    if (next === null) return true;
    setRange(null);
    focusCell(next);
    return true;
  };

  // --- The cursor ----------------------------------------------------------

  const clampCell = (cell: GridCell): GridCell => {
    const columns = columnCount();
    if (columns === 0) return { row: HEADER_ROW, column: 0 };
    const column = clamp(Math.trunc(cell.column), 0, columns - 1);
    if (cell.row < HEADER_ROW) return clampToGroups(cell.row, column);
    const rows = allRowCount();
    // With no data rows the header is the only place a cursor can be.
    const row = rows === 0 ? HEADER_ROW : clamp(Math.trunc(cell.row), HEADER_ROW, rows - 1);
    return { row, column };
  };

  /**
   * Move the cursor, and say so.
   *
   * Every path that changes it comes through here — keys, focus arriving from
   * outside, and the clamp below — because a consumer mirroring
   * `onActiveCellChange` into their own state is otherwise left holding a
   * position that no longer exists.
   */
  const setActive = (cell: GridCell): void => {
    const next = clampCell(cell);
    const current = untrack(() => active.get());
    if (current.row === next.row && current.column === next.column) return;
    active.set(next);
    options.onActiveCellChange?.(next);
  };

  /**
   * Whether any cell is rendered to hold the tab stop.
   *
   * Asked separately from `tabStop` so the grid element's own props do not
   * have to depend on where the cursor is: whether a cell exists at all and
   * which one it is are different questions, and the first changes far less
   * often than the second.
   */
  const hasTabStop = (): boolean => columnCount() > 0 && columnAxis.range().startIndex >= 0;

  /**
   * The cell that holds the grid's single tab stop.
   *
   * Not always the cursor. A tab stop on a cell outside the rendered window is
   * a tab stop on nothing: the element carrying `tabindex="0"` does not exist,
   * so Tab skips the grid entirely and a keyboard user has no way back into
   * it. The alternative — pinning the cursor's row into the window so it always
   * renders — puts a row the reader has scrolled away from back under their
   * cursor and lies to the virtualizer about its own geometry.
   */
  const tabStop = (): GridCell | null => {
    if (!hasTabStop()) return null;
    const cursor = active.get();

    const columnRange = columnAxis.range();
    // A pinned column and a pinned row are rendered wherever the scroll is, so
    // the cursor on one holds the tab stop itself. Asked only outside the
    // window, so a cell's props come to depend on the pins no sooner than
    // the answer could differ.
    const inWindow =
      cursor.column >= columnRange.startIndex && cursor.column <= columnRange.endIndex;
    const column =
      inWindow || isPinnedColumn(cursor.column)
        ? cursor.column
        : clamp(cursor.column, columnRange.startIndex, columnRange.endIndex);

    if (cursor.row < HEADER_ROW) return groupTabStop(cursor, column);
    if (cursor.row === HEADER_ROW) return { row: HEADER_ROW, column };
    if (isPinnedRow(cursor.row)) return { row: cursor.row, column };
    const rowRange = rowAxis.range();
    // The header is always rendered, so it is where the tab stop goes when no
    // data row is.
    if (rowRange.startIndex < 0) return { row: HEADER_ROW, column };
    const top = topCount();
    return { row: clamp(cursor.row, top + rowRange.startIndex, top + rowRange.endIndex), column };
  };

  const isTabStop = (row: number, column: number): boolean => {
    const stop = tabStop();
    return stop !== null && stop.row === row && stop.column === column;
  };

  const isActive = (row: number, column: number): boolean => {
    const cursor = active.get();
    return cursor.row === row && cursor.column === column;
  };

  // --- Focus ---------------------------------------------------------------

  const cellKey = (row: number, column: number): string => `${row},${column}`;

  const elementAt = (cell: GridCell): HTMLElement | null => {
    const root = options.grid();
    if (!root) return null;
    // The value is two integers this generated, so it needs no escaping — and
    // escaping it would pull in `CSS`, which does not exist on a server.
    return root.querySelector<HTMLElement>(
      `[${GRID_CELL_ATTRIBUTE}="${cellKey(cell.row, cell.column)}"]`,
    );
  };

  /**
   * A cell that arithmetic moved to before it existed.
   *
   * The target of Ctrl+End, or of a page, is almost never in the rendered
   * window: the scroll is asked for, and the element appears a render later.
   * Held here until it does. Not a signal — nothing renders from it.
   */
  let pendingFocus: GridCell | null = null;

  /**
   * Whether focus was last put on the cell the cursor names.
   *
   * Every path that focuses a cell sets it, and focus leaving the grid clears
   * it — heard as it leaves, below, because afterwards a reader who clicked the
   * page background and a cell removed from under them look the same: focus
   * is nowhere in both.
   */
  let focusOnCursor = false;

  effect(() => {
    const root = options.grid();
    if (!root) return;
    const onFocusOut = (event: Event): void => {
      // `Element` has no typed map entry for focusout, so the event arrives
      // as a bare `Event` and `relatedTarget` has to be asked for. Focus moving
      // from one cell to the next is every arrow key, and costs nothing more.
      const next = 'relatedTarget' in event ? event.relatedTarget : null;
      if (next instanceof Node && root.contains(next)) return;
      // Focus handed to an element outside the grid says plainly that the reader
      // left, and nothing that happens to the cell afterwards changes that: only
      // a focusout that names nowhere needs the wait below.
      if (next instanceof Node) {
        focusOnCursor = false;
        return;
      }
      const target = event.target;
      // Judged a microtask later, because at this moment the two cases still
      // look alike: an engine that reports a cell removed by a re-render does
      // so before the cell has gone. By then the flush doing the removing has
      // finished — the cell is out of the document, or following the row has
      // put focus back in the grid — and neither is the reader leaving. Nor is
      // the window losing focus, which blurs the cell and leaves it the
      // document's active element.
      queueMicrotask(() => {
        if (root.contains(root.ownerDocument.activeElement)) return;
        if (target instanceof Node && !target.isConnected) return;
        focusOnCursor = false;
      });
    };
    root.addEventListener('focusout', onFocusOut);
    onCleanup(() => root.removeEventListener('focusout', onFocusOut));
  });

  /**
   * Put back a scroll the browser gives a rowgroup outside the scroller.
   *
   * The header and the footer clip their rows rather than scroll them — the
   * grid moves those rows itself, by a transform or a margin — but a box that
   * clips is a box the browser can scroll, and it does, to show a cell it
   * focuses: one the window has rendered past the edge, as the cursor walks
   * along the header row or a pinned row. Left scrolled, the rowgroup holds
   * its rows out of line with the body's for good. Heard on the way down,
   * since a scroll does not bubble, and put back before the frame is painted.
   * Only a rowgroup: what scrolls inside a cell is the consumer's.
   */
  effect(() => {
    const root = options.grid();
    if (!root) return;
    const onScroll = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element) || target.getAttribute('role') !== 'rowgroup') return;
      if (target === options.scroller()) return;
      if (target.scrollLeft !== 0) target.scrollLeft = 0;
      if (target.scrollTop !== 0) target.scrollTop = 0;
    };
    root.addEventListener('scroll', onScroll, true);
    onCleanup(() => root.removeEventListener('scroll', onScroll, true));
  });

  effect(() => {
    // Read both windows: this effect exists to run again when either moves.
    rowAxis.items();
    columnAxis.items();
    const target = pendingFocus;
    if (target === null) return;
    const el = elementAt(target);
    if (!el) return;
    pendingFocus = null;
    focusOnCursor = true;
    el.focus();
  });

  /**
   * The row the last jump among unequal rows was aimed at, or -1.
   *
   * The virtualizer goes on correcting a jump for a few frames, and only
   * another scroll lets it go. A cursor moved on to a row already in view asks
   * for no scroll, so the correction would carry on — and as the row it was
   * for is measured, take the row the reader is now on off the screen. Moving
   * along the row the jump was for is still waiting on that jump to land.
   */
  let jumpedTo = -1;

  /**
   * Bring a row wholly into view, by the least scroll that does — or, for a
   * row taller than the viewport, bring its start into view, unless it fills
   * the viewport already.
   *
   * Where rows differ the edge is chosen here rather than left to the
   * virtualizer's `nearest`, for two reasons. A jump into rows not yet
   * measured is aimed with estimates, and the virtualizer goes on correcting
   * it as they land only while it has an offset to aim at — but `nearest` has
   * none once the estimate says the row is in view, so the jump is let go on
   * its first frame, and a row that measures taller than its estimate is left
   * with its foot below the viewport. An edge is always an offset. And a row
   * taller than the viewport is never wholly in view: `nearest` takes it to
   * its foot from below and to its start from above, so every arrow along it
   * would throw the reader from one end to the other. Its start is where its
   * cells begin, as a column wider than the band shows its start. A row that
   * fills the viewport is as much in view as it can be, and a reader part way
   * down it — or a jump that came to rest on its foot — is left there. Read
   * untracked: the cursor following its row calls this from inside an effect,
   * which must not come to depend on the scroll.
   */
  const scrollToRow = (row: number): void => {
    if (typeof rowHeight === 'number') {
      rowAxis.scrollToIndex(row);
      return;
    }
    untrack(() => {
      const count = rowCount();
      if (count === 0) return;
      const index = clamp(Math.trunc(row), 0, count - 1);
      const start = rowAxis.offsetOf(index);
      const size = rowAxis.sizeOf(index);
      const top = rowAxis.scrollOffset();
      const viewport = rowAxis.viewportSize();
      if (start <= top && start + size >= top + viewport) return;
      if (start < top) {
        jumpedTo = index;
        rowAxis.scrollToIndex(index, { align: 'start' });
      } else if (start + size > top + viewport) {
        jumpedTo = index;
        rowAxis.scrollToIndex(index, { align: size > viewport ? 'start' : 'end' });
      } else if (index !== jumpedTo) {
        // Wholly in view, where `nearest` scrolls nothing: all it does here is
        // let go of the jump still settling on another row.
        jumpedTo = -1;
        rowAxis.scrollToIndex(index);
      }
    });
  };

  const scrollToCell = (cell: GridCell): void => {
    scrollToColumn(cell.column);
    // The header is outside the scroller, so there is nothing to scroll to
    // vertically when the cursor is on it — nor on a pinned row, which is
    // outside it too. A scrolling row is found by its place in the view.
    if (cell.row >= 0 && !untrack(() => isPinnedRow(cell.row))) {
      scrollToRow(cell.row - untrack(topCount));
    }
  };

  const focusCell = (cell: GridCell): void => {
    const target = clampCell(cell);
    const before = windowBeforeGroupFocus(target);
    setActive(target);
    scrollToCell(target);

    const el = elementAt(target);
    if (el) {
      pendingFocus = groupFocusRedrawn(before) ? target : null;
      focusOnCursor = true;
      el.focus();
      return;
    }
    pendingFocus = target;
  };

  /**
   * The cell the reader was on, brought back after the grid turns round.
   *
   * A browser puts a scroller whose direction turns back at its inline start,
   * and the window follows the scroll: a focused cell past the first screen
   * leaves the document with focus on it, and the reader is left on nothing.
   * Where focus was on the cursor's cell, that cell is scrolled back into view
   * and focused again. Focus the reader took elsewhere stays there, and a grid
   * with nothing focused does nothing beyond the scroll the browser made.
   */
  let turnedFrom: Direction | undefined;
  effect(() => {
    const now = direction();
    const before = turnedFrom;
    turnedFrom = now;
    if (before === undefined || before === now || !focusOnCursor) return;
    untrack(() => focusCell(active.get()));
  });

  const cellFrom = (target: EventTarget | null): GridCell | null => {
    if (!(target instanceof Element)) return null;
    const el = target.closest(`[${GRID_CELL_ATTRIBUTE}]`);
    const raw = el?.getAttribute(GRID_CELL_ATTRIBUTE);
    if (!raw) return null;
    const [row, column] = raw.split(',');
    const parsed = { row: Number(row), column: Number(column) };
    if (!Number.isInteger(parsed.row) || !Number.isInteger(parsed.column)) return null;
    return parsed;
  };

  // --- Sorting -------------------------------------------------------------

  const describeSort = (entries: readonly GridSort[]): readonly GridSortDescriptor<T>[] => {
    const list = untrack(columnList);
    const described: GridSortDescriptor<T>[] = [];
    for (const entry of entries) {
      const column = list.find((candidate) => candidate.id === entry.columnId);
      // Only the terms that order anything, as everywhere else the sort is
      // reported.
      if (column && column.sortable !== false) {
        described.push({ column, direction: entry.direction });
      }
    }
    return described;
  };

  const setSort = (next: readonly GridSort[], speak: boolean): void => {
    const current = untrack(() => sortState.get());
    if (sameSort(current, next)) return;
    sortState.set(next);
    options.onSortChange?.(next);
    // Nothing else reports it. The rows move, which a sighted reader sees and
    // nobody else does, and `aria-sort` on the header is only read out when
    // focus reaches that header — which on a pointer-driven sort it never does.
    if (speak) announce(sortAnnouncement(describeSort(next)));
  };

  const sortDirection = (columnId: string): GridSortDirection | null =>
    activeSort.get().find((entry) => entry.columnId === columnId)?.direction ?? null;

  const toggleSort = (columnId: string, additive = false): void => {
    const column = untrack(() => columnById(columnId));
    if (!column || column.sortable === false) return;

    const current = untrack(() => sortState.get());
    const existing = current.find((entry) => entry.columnId === columnId) ?? null;
    const direction = nextDirection(existing?.direction ?? null);

    if (!additive) {
      // A plain click is a new order rather than an addition — but it still
      // cycles this column from wherever this column already was, so clicking
      // the second of two sorted columns reverses it instead of starting over.
      setSort(direction === null ? EMPTY_SORT : [{ columnId, direction }], true);
      return;
    }
    if (existing === null) {
      setSort([...current, { columnId, direction: 'ascending' }], true);
      return;
    }
    if (direction === null) {
      setSort(
        current.filter((entry) => entry.columnId !== columnId),
        true,
      );
      return;
    }
    setSort(
      current.map((entry) => (entry.columnId === columnId ? { columnId, direction } : entry)),
      true,
    );
  };

  // --- Filtering -----------------------------------------------------------

  /**
   * Say how many rows are left.
   *
   * The count is the one thing a filter changes that has no other way of being
   * noticed: the rows that stopped matching are simply not in the document, and
   * in a virtualized grid they never all were. Read after the write, because
   * the view is derived and this is the first pull of the new one.
   */
  const announceFilterCount = (): void => {
    announce(filterAnnouncement(untrack(rowCount), untrack(sourceRowCount)));
  };

  const setFilter = (columnId: string, filter: GridFilter | null): void => {
    if (filter !== null && untrack(() => columnById(columnId))?.filterable === false) {
      refuseFilter(`column "${columnId}" is not filterable`, 'setFilter');
      return;
    }
    const current = untrack(() => filterState.get());
    if (filter === null ? !current.has(columnId) : current.get(columnId) === filter) return;
    const next = new Map(current);
    if (filter === null) next.delete(columnId);
    else next.set(columnId, filter);
    filterState.set(next);
    options.onFilterChange?.(next, untrack(() => quickState.get()));
    announceFilterCount();
  };

  const clearFilters = (): void => {
    const current = untrack(() => filterState.get());
    const quick = untrack(() => quickState.get());
    if (current.size === 0 && quick === '') return;
    if (current.size > 0) filterState.set(EMPTY_FILTERS);
    if (quick !== '') quickState.set('');
    options.onFilterChange?.(
      untrack(() => filterState.get()),
      untrack(() => quickState.get()),
    );
    announceFilterCount();
  };

  const setQuickFilter = (text: string): void => {
    if (untrack(() => quickState.get()) === text) return;
    if (text !== '' && quickFilterValues(untrack(columnList)) === null) {
      refuseFilter('no column is filterable', 'setQuickFilter');
      return;
    }
    quickState.set(text);
    options.onFilterChange?.(untrack(() => filterState.get()), text);
    announceFilterCount();
  };

  // --- Selection -----------------------------------------------------------

  const selectedRowKeys =
    options.selectedRows ?? new Signal.State<ReadonlySet<GridRowKey>>(new Set<GridRowKey>());
  const cellRange = options.cellRange ?? new Signal.State<GridCellRange | null>(null);

  /**
   * Where a Shift-click's range of rows measures from.
   *
   * The last row deliberately chosen, not the last row the cursor passed over:
   * a range is taken from where the reader started choosing, and the cursor
   * moves for reasons that have nothing to do with selecting.
   */
  let selectionAnchorKey: GridRowKey | null = null;

  const setSelectedRows = (next: ReadonlySet<GridRowKey>): void => {
    if (sameKeys(untrack(() => selectedRowKeys.get()), next)) return;
    selectedRowKeys.set(next);
    options.onRowSelectionChange?.(next);
  };

  const setRange = (next: GridCellRange | null): void => {
    if (sameRange(untrack(() => cellRange.get()), next)) return;
    cellRange.set(next);
    options.onCellRangeChange?.(next);
  };

  const isRowSelected = (key: GridRowKey): boolean => selectedRowKeys.get().has(key);
  const isSelectable = (row: T): boolean => options.selectable?.(row) ?? true;

  /** The key a gesture on this row selects by, or null where there is no row to select. */
  const selectableKeyAt = (index: number): GridRowKey | null => {
    const row = rowAtPosition(index);
    return row === null || !isSelectable(row.item) ? null : row.key;
  };

  const selectRow = (key: GridRowKey, additive = false): void => {
    if (rowSelectionMode === 'none') return;
    selectionAnchorKey = key;
    if (rowSelectionMode === 'single' || !additive) {
      setSelectedRows(new Set([key]));
      return;
    }
    const next = new Set(untrack(() => selectedRowKeys.get()));
    next.add(key);
    setSelectedRows(next);
  };

  const toggleRowSelection = (key: GridRowKey): void => {
    if (rowSelectionMode === 'none') return;
    selectionAnchorKey = key;
    const current = untrack(() => selectedRowKeys.get());
    if (rowSelectionMode === 'single') {
      setSelectedRows(current.has(key) ? new Set() : new Set([key]));
      return;
    }
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    setSelectedRows(next);
  };

  /**
   * Every row the filter left, and no row it removed.
   *
   * Selecting all of the *source* instead would hand a bulk action rows the
   * reader cannot see and did not mean, which is the standard way a filtered
   * grid deletes the wrong thing.
   */
  const selectAllRows = (): void => {
    if (rowSelectionMode !== 'multiple') return;
    const rows = untrack(rowList);
    const next = new Set<GridRowKey>();
    for (let i = 0; i < rows.length; i++) {
      if (isSelectable(rows[i]!)) next.add(rowKeyOf(rows[i]!, i));
    }
    setSelectedRows(next);
  };

  const clearRowSelection = (): void => {
    selectionAnchorKey = null;
    setSelectedRows(new Set());
  };

  /** Everything between the last row deliberately chosen and this one. */
  const selectRowRange = (key: GridRowKey): void => {
    if (rowSelectionMode !== 'multiple' || selectionAnchorKey === null) {
      selectRow(key);
      return;
    }
    const rows = untrack(rowList);
    let from = -1;
    let to = -1;
    for (let i = 0; i < rows.length; i++) {
      const candidate = rowKeyOf(rows[i]!, i);
      if (candidate === selectionAnchorKey) from = i;
      if (candidate === key) to = i;
    }
    // The anchored row has been filtered away since it was chosen. Falling back
    // to a plain selection is better than a range measured from a guess.
    if (from < 0 || to < 0) {
      selectRow(key);
      return;
    }
    const next = new Set<GridRowKey>();
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
      if (isSelectable(rows[i]!)) next.add(rowKeyOf(rows[i]!, i));
    }
    // The anchor deliberately stays where it was, so shift-clicking back and
    // forth grows and shrinks one range rather than leaving a trail of them.
    setSelectedRows(next);
  };

  const isCellSelected = (row: number, column: number): boolean => {
    const range = cellRange.get();
    return range !== null && rangeContains(range, row, column);
  };

  /** Extend the rectangle to a new focus corner, keeping the anchor it had. */
  const extendRange = (from: GridCell, to: GridCell): void => {
    const current = untrack(() => cellRange.get());
    setRange({ anchor: current === null ? from : current.anchor, focus: to });
  };

  // --- Following the data --------------------------------------------------

  /**
   * Whether the reader had focus on the cursor's own cell.
   *
   * Remembered rather than read back, because the moment it matters is *after*
   * the rows have changed — and by then the reconciler has removed the element
   * that had focus and the browser has put focus on the document. Asking the
   * DOM at that point always answers no, which is how a keyboard user ends up
   * silently dumped at the top of the page by a sort.
   */
  const cursorHeldFocus = (): boolean => {
    if (!focusOnCursor) return false;
    const root = options.grid();
    const focused = root?.ownerDocument.activeElement ?? null;
    // Still somewhere in the grid: the reader has not gone anywhere.
    if (root && focused && root.contains(focused)) return true;
    // Or nowhere at all, which is where focus lands when the element holding
    // it is removed — which is precisely what the re-sort just did. A reader
    // who sent it nowhere themselves cleared the flag on the way out.
    if (focused === null || focused === root?.ownerDocument.body) return true;
    // Anywhere else is the reader having tabbed out, and focus is theirs now.
    focusOnCursor = false;
    return false;
  };

  /**
   * Whether focus is on something inside one of this grid's cells rather than
   * on the cell itself — an editor, a checkbox — and so is still where the
   * reader put it.
   *
   * `onFocusIn` counts such a control as focus on the cursor, since it sits
   * in the cursor's cell. Only the cell moving decides whether that focus has
   * gone: moved in the document, it takes the control with it and focus
   * lands nowhere, which `cursorHeldFocus` hears; left where it is, the
   * control keeps focus and needs nothing brought to it.
   */
  const focusInsideCell = (): boolean => {
    const root = options.grid();
    const focused = root?.ownerDocument.activeElement ?? null;
    if (!root || focused === null || !root.contains(focused)) return false;
    if (focused.hasAttribute(GRID_CELL_ATTRIBUTE)) return false;
    return focused.closest(`[${GRID_CELL_ATTRIBUTE}]`) !== null;
  };

  /**
   * Where the row the cursor was on sits in the new view — or the position it
   * had, where there is no row to follow.
   *
   * The row is worked out from the view being replaced rather than from a key
   * kept alongside the cursor, which is what makes it right no matter who
   * moved the cursor last: `previous[row]` *is* the row the reader was standing
   * on, by construction, and there is no second copy of that fact to go stale.
   */
  const followRow = (row: number, rows: readonly T[], previous: readonly T[]): number => {
    // The column header is row one whatever the data does, so there is nothing
    // underneath the cursor to follow.
    if (row < 0) return row;
    const was = previous[row];
    if (was === undefined) return row;
    const index = indexOfKey(rows, rowKeyOf(was, row));
    // The row was filtered away. The clamp keeps the cursor legal, and it stays
    // at the position it had, which is where a reader watching rows disappear
    // would expect to still be.
    return index < 0 ? row : index;
  };

  /**
   * Where the row at a position sits after the rows changed, pinned ones
   * included: a pinned row is found again by key among the rows pinned to its
   * edge, and a row of the view by `followRow`, each then counted past
   * whatever is pinned above it now. A pinned row that has gone leaves the
   * cursor at its place among that edge's rows.
   */
  const followPosition = (
    row: number,
    rows: readonly T[],
    previous: readonly T[],
    pinned: PinnedRows<T>,
    before: PinnedRows<T>,
  ): number => {
    if (row < 0) return row;
    const followPinned = (at: number, now: readonly T[], was: readonly T[]): number => {
      const index = indexOfKey(now, rowKeyOf(was[at]!, at));
      return index < 0 ? Math.min(at, Math.max(0, now.length - 1)) : index;
    };
    if (row < before.top.length) return followPinned(row, pinned.top, before.top);
    const at = row - before.top.length;
    if (at >= previous.length && at - previous.length < before.bottom.length) {
      const below = followPinned(at - previous.length, pinned.bottom, before.bottom);
      return pinned.top.length + rows.length + below;
    }
    // A row of the view that a filter took stays at its place, held to the
    // view: past its end are the rows pinned below, which are not data, and a
    // reader watching rows go is still among the rows. With none pinned below,
    // the clamp that keeps every cursor legal does the same.
    const inView = followRow(at, rows, previous);
    const held = pinned.bottom.length > 0 && rows.length > 0;
    return pinned.top.length + (held ? Math.min(inView, rows.length - 1) : inView);
  };

  /**
   * Where the column the cursor was on sits in the new list — or, where it has
   * gone, its nearest neighbour that stayed. Null where the position named no
   * column, or nothing of the old list is left, and a clamp is all there is.
   *
   * Worked out from the list being replaced, as the row is from the view, and
   * found again by id, as the row is by key. The neighbour after it goes first:
   * it is the column a reader watching one disappear sees slide into its
   * place, as the next row slides under a cursor whose row a filter took away.
   * Then the one before, and on outwards, because the columns either side are
   * the ones the reader was looking at.
   */
  const followColumn = (
    column: number,
    places: ReadonlyMap<string, number>,
    previous: readonly GridColumn<T>[],
  ): number | null => {
    const placeOf = (index: number): number => {
      const was = previous[index];
      return was === undefined ? -1 : (places.get(was.id) ?? -1);
    };
    if (previous[column] === undefined) return null;
    const same = placeOf(column);
    if (same >= 0) return same;
    for (let distance = 1; distance < previous.length; distance++) {
      const after = placeOf(column + distance);
      if (after >= 0) return after;
      const before = placeOf(column - distance);
      if (before >= 0) return before;
    }
    return null;
  };

  /**
   * Carry the cell range across a change to the column list, or drop it.
   *
   * Carried only where every column it covered is still in the list, side by
   * side and in the order they were: one shift then moves both corners, and
   * the rectangle holds exactly the cells the reader chose. Anything else is
   * dropped rather than redrawn. A range is two corners, and a column moved in
   * between them, moved out from between them or hidden there leaves no pair of
   * corners around what was chosen — the rectangle between the old ones would
   * take in a column nobody chose or leave out one somebody did, and a range
   * the reader can no longer trust is worse than none.
   */
  const followRange = (
    places: ReadonlyMap<string, number>,
    previous: readonly GridColumn<T>[],
  ): void => {
    const range = untrack(() => cellRange.get());
    if (range === null) return;
    const { fromColumn, toColumn } = rangeBounds(range);
    const placeOf = (index: number): number | undefined => {
      const was = previous[index];
      return was === undefined ? undefined : places.get(was.id);
    };
    const start = placeOf(fromColumn);
    if (start === undefined) {
      setRange(null);
      return;
    }
    for (let index = fromColumn + 1; index <= toColumn; index++) {
      if (placeOf(index) !== start + (index - fromColumn)) {
        setRange(null);
        return;
      }
    }
    const shift = start - fromColumn;
    if (shift === 0) return;
    setRange({
      anchor: { row: range.anchor.row, column: range.anchor.column + shift },
      focus: { row: range.focus.row, column: range.focus.column + shift },
    });
  };

  /**
   * Put the cursor back on the cell it was on, wherever its row and its column
   * have gone, and carry the range with them or drop it.
   *
   * Each of the two lists is null where it did not change.
   */
  const follow = (
    rows: readonly T[],
    previousRows: readonly T[] | null,
    columns: readonly GridColumn<T>[],
    previousColumns: readonly GridColumn<T>[] | null,
    pinned: PinnedRows<T>,
    pinnedBefore: PinnedRows<T>,
  ): void => {
    const places = previousColumns === null ? null : placesOf(columns);

    // A rectangle of cells is a region of the grid *as it was arranged*, and
    // the rows have just been arranged again: the rows between its corners are
    // somewhere else now, and the reader never asked for whatever is between
    // them today. Row selection is held by key and survives this; a range
    // cannot, so it goes. Columns are few and always named, so a change to
    // them alone can say whether the range still stands.
    if (previousRows !== null) setRange(null);
    else if (places !== null && previousColumns !== null) followRange(places, previousColumns);

    const cursor = untrack(() => active.get());
    // A cursor on a row of groups is `followGroup`'s, column and all.
    if (cursor.row < HEADER_ROW) return;
    const row =
      previousRows === null
        ? cursor.row
        : followPosition(cursor.row, rows, previousRows, pinned, pinnedBefore);
    let column = cursor.column;
    // Moved even where the column that took its place sits at the same index,
    // when the one the cursor was on has gone: the reader is on another column
    // now, and focus has to be brought to it from a cell no longer there. Not
    // where no column is left to take its place, and no cell to bring it to.
    let columnWent = false;
    if (places !== null && previousColumns !== null) {
      const followed = followColumn(cursor.column, places, previousColumns);
      const was = previousColumns[cursor.column];
      if (followed !== null) column = followed;
      columnWent = followed !== null && was !== undefined && !places.has(was.id);
    }
    if (row === cursor.row && column === cursor.column && !columnWent) return;

    // Focus follows the cursor only if it was on the cursor to begin with. A
    // sort is almost always driven from the column header, and a column is
    // moved or hidden from a chooser beside the grid, which is where the reader
    // is standing when the cells move underneath them — pulling focus into the
    // body would take them off the control they just used. Nor where it is on
    // a control inside the cell, still in the document: that is an editor
    // being typed in, and focus brought to the cell would leave the reader's
    // next keystrokes nowhere.
    const next = { row, column };
    if (cursorHeldFocus() && !focusInsideCell()) focusCell(next);
    else setActive(next);
  };

  /**
   * Keep the cursor on the cell it was on, the range over the cells it covered
   * or gone, and the cursor inside the grid.
   *
   * One effect rather than several, because the answers interfere: a clamp run
   * first would re-anchor the cursor to whichever row or column had slid under
   * it, and the lookups would then have nothing left to look up. Stating the
   * order here is better than leaving it to the order the effects happen to be
   * created in.
   *
   * A list handed over again with the same rows, or the same column ids, in
   * the same order is no change. A new column list re-sorts a sorted grid, and
   * the rows come back in the order they were in: a range dropped for that
   * would be dropped for a sort that moved nothing. The comparison is by
   * identity, a walk the derivation that made the new list has already paid
   * for many times over, and it reads no cell.
   */
  let renderedRows: readonly T[] | null = null;
  let renderedColumns: readonly GridColumn<T>[] | null = null;
  // The rows pinned to each edge count in every position after them, so a
  // change to them moves the rows as much as a sort does. Compared by key
  // rather than by identity: a row of totals is a new object after every edit
  // under it, and a range dropped for that would be dropped for an edit.
  let renderedPinned: PinnedRows<T> = { top: NO_ROWS, bottom: NO_ROWS };
  const samePinnedRows = (a: readonly T[], b: readonly T[]): boolean => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    return untrack(() => a.every((row, i) => rowKeyOf(row, i) === rowKeyOf(b[i]!, i)));
  };
  effect(() => {
    // Read tracked: the cursor has to be re-examined when either axis changes.
    const rows = rowList();
    const columns = columnList();
    const pinned: PinnedRows<T> = { top: pinnedTop.get(), bottom: pinnedBottom.get() };

    const previousRows = renderedRows;
    const previousColumns = renderedColumns;
    const previousPinned = renderedPinned;
    renderedRows = rows;
    renderedColumns = columns;
    renderedPinned = pinned;
    const rowsMoved =
      previousRows !== null &&
      (!sameItems(previousRows, rows) ||
        !samePinnedRows(previousPinned.top, pinned.top) ||
        !samePinnedRows(previousPinned.bottom, pinned.bottom));
    const columnsMoved = previousColumns !== null && !sameIds(previousColumns, columns);
    const cursorBefore = untrack(() => active.get());
    if (rowsMoved || columnsMoved) {
      follow(
        rows,
        rowsMoved ? previousRows : null,
        columns,
        columnsMoved ? previousColumns : null,
        pinned,
        previousPinned,
      );
    }
    // A cursor on a group, which `follow` leaves alone. Not only when the ids
    // move: the same columns handed over under other groups can move a group
    // to another row.
    if (previousColumns !== null && previousColumns !== columns) {
      followGroup(cursorBefore, previousColumns, columns);
    }

    setActive(untrack(() => active.get()));
  });

  /**
   * Bring the cursor's row back into the window, and focus with it, when rows
   * changing height above it on screen push it out.
   *
   * Past the rows rendered below the viewport a row is not in the document,
   * and the cell holding focus goes with it, leaving the reader's next key to
   * the page. A view that changed is the cursor following its row, above,
   * which brings it back the same way; a scroll of the reader's own moves the
   * viewport rather than the row, and a row it takes away is theirs to leave.
   * So only the same row, at the same place, rendered before and starting
   * somewhere else now, is a row heights moved. A grid of one height has no
   * heights to change, and does not watch.
   */
  const followRowHeights = (): void => {
    let last: { row: number; item: T | undefined; start: number; rendered: boolean } | null =
      null;
    effect(() => {
      const cursor = active.get();
      const index = cursor.row - topCount();
      const scrolling = cursor.row >= 0 && !isPinnedRow(cursor.row);
      const item = scrolling ? rowList()[index] : undefined;
      const start = item === undefined ? -1 : rowAxis.offsetOf(index);
      const { startIndex, endIndex } = rowAxis.range();
      const rendered = item !== undefined && index >= startIndex && index <= endIndex;
      const before = last;
      last = { row: cursor.row, item, start, rendered };
      if (before === null || before.row !== cursor.row || before.item !== item) return;
      if (!before.rendered || rendered || before.start === start) return;
      // Unlike the cursor following a sort, focus inside a cell needs no
      // sparing here: a control in the row left the document with it.
      untrack(() => {
        if (cursorHeldFocus()) focusCell(cursor);
      });
    });
  };
  if (typeof rowHeight !== 'number') followRowHeights();

  // --- Resizing ------------------------------------------------------------

  const indexOfColumn = (id: string): number =>
    untrack(() => columnList().findIndex((column) => column.id === id));

  const resizeColumn = (id: string, width: number): number | null => {
    const index = indexOfColumn(id);
    const column = untrack(() => columnList()[index]);
    if (!column || column.resizable === false) return null;

    const next = clampWidth(column, width);
    if (next === widthOf(index)) return null;

    const map = new Map(untrack(() => widths.get()));
    map.set(id, next);
    // Every offset after this column moves with it: the geometry reads the
    // widths, and rebuilds once for this write.
    widths.set(map);
    options.onColumnResize?.(id, next);
    return next;
  };

  /** Ends the drag in flight, if there is one, however it ends. */
  let stopResize: (() => void) | null = null;
  onCleanup(() => stopResize?.());

  /** A drag of a column's handle, or null where the handle names no column that can be resized. */
  const columnResizeDrag = (handle: Element): ResizeDrag | null => {
    const id = handle.getAttribute(GRID_RESIZER_ATTRIBUTE);
    if (id === null) return null;
    const index = indexOfColumn(id);
    const column = untrack(() => columnList()[index]);
    if (!column || column.resizable === false) return null;
    const startWidth = widthOf(index);
    return {
      hold: (on) => resizing.set(on ? id : null),
      to: (delta) => {
        resizeColumn(id, startWidth + delta);
      },
      cancel: () => {
        resizeColumn(id, startWidth);
      },
    };
  };

  const onResizePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (stopResize) return;

    const handle = event.currentTarget;
    if (!(handle instanceof HTMLElement)) return;
    // A column's handle or a group's: one gesture either way, whatever it resizes.
    const drag = columnResizeDrag(handle) ?? groupResizeDrag(handle);
    if (drag === null) return;

    // A press on the handle is a resize and nothing else: without this it is
    // also a press on the header cell it sits in, which moves the cursor.
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    // The handle is at the column's inline end, which right to left is its
    // left edge: a drag to the left there is a drag away from the column.
    const rtl = untrack(direction) === 'rtl';
    handle.setPointerCapture?.(event.pointerId);
    drag.hold(true);

    const onMove = (move: PointerEvent): void => {
      if (move.pointerId !== event.pointerId) return;
      const moved = move.clientX - startX;
      drag.to(rtl ? -moved : moved);
    };

    // Heard on the window, capturing, so it is the first thing to hear the key
    // and can keep it: a drag in flight is the topmost thing Escape can undo,
    // and a grid inside a dialog that also closed on it would lose the dialog
    // with the drag.
    const view = handle.ownerDocument.defaultView;

    const onCancelKey = (key: KeyboardEvent): void => {
      if (key.key !== 'Escape') return;
      key.preventDefault();
      key.stopPropagation();
      // A drag is a single gesture, so cancelling it puts the width back where
      // it started rather than undoing the last increment.
      drag.cancel();
      stop();
    };

    const stop = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      handle.removeEventListener('lostpointercapture', stop);
      view?.removeEventListener('keydown', onCancelKey, true);
      if (handle.hasPointerCapture?.(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      drag.hold(false);
      stopResize = null;
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('lostpointercapture', stop);
    view?.addEventListener('keydown', onCancelKey, true);
    stopResize = stop;
  };

  // --- The keyboard --------------------------------------------------------

  /** How many rows a page key moves by — what is actually on screen. */
  const pageRows = (): number => {
    // A scroller nothing has measured reports exactly one row on screen, which
    // would quietly turn a page key into an arrow key. Before layout — a
    // hidden tab, or an environment that lays nothing out — a stated guess is
    // better than a measurement that is not one.
    if (untrack(() => rowAxis.viewportSize()) <= 0) return DEFAULT_PAGE_ROWS;
    const range = untrack(() => rowAxis.range());
    return Math.max(1, range.visibleEndIndex - range.visibleStartIndex + 1);
  };

  /**
   * The row a page key lands on from `row`, `direction` rows of one viewport.
   *
   * Where every row is one height, the rows on screen are a viewport, and a
   * count of them is what a page has always been. Where heights differ, a count
   * taken here is wrong a page further on — four short rows on screen are not
   * four tall ones — so a page is the viewport's height in pixels: the furthest
   * row starting within that distance, either way.
   */
  const pageFrom = (row: number, direction: 1 | -1): number =>
    typeof rowHeight === 'number' ? row + direction * pageRows() : pageByPixels(row, direction);

  /**
   * A page key's target, past any pinned rows. A page by a count is the same
   * count in the one list of rows. A page by pixels is measured in the view,
   * which is all the row axis holds, so a row of the view is paged there and
   * counted back past the rows pinned above it; from a pinned row a page goes
   * into the view from its near end, or off it to the header above.
   */
  const pageAcrossPins = (row: number, direction: 1 | -1): number => {
    const top = untrack(topCount);
    const below = untrack(bottomCount);
    if (typeof rowHeight === 'number' || top + below === 0) return pageFrom(row, direction);
    const count = untrack(rowCount);
    if (row < top) return direction > 0 ? top + pageFrom(HEADER_ROW, 1) : HEADER_ROW;
    if (row >= top + count) return direction > 0 ? row + 1 : top + pageFrom(count - 1, -1);
    const target = pageFrom(row - top, direction);
    return target < 0 ? HEADER_ROW : top + target;
  };

  const pageByPixels = (row: number, direction: 1 | -1): number =>
    untrack(() => {
      const viewport = rowAxis.viewportSize();
      if (viewport <= 0) return row + direction * DEFAULT_PAGE_ROWS;
      // The header is above the scroller and has no offset in it. Its page ends
      // on the last row the first screen shows, which is where counting rows
      // puts it in a grid of one height.
      if (row < 0) return direction > 0 ? Math.max(0, rowAxis.indexAt(viewport - 1)) : row;
      const target = rowAxis.offsetOf(row) + direction * viewport;
      // Above the first row is the header, as it is for a count that overshoots.
      if (target < 0) return HEADER_ROW;
      const index = rowAxis.indexAt(target);
      // A row taller than the viewport would otherwise hold a page down to itself.
      if (direction > 0) return Math.max(index, row + 1);
      // Down is the furthest row starting within a viewport, so up is too: the
      // row the target falls inside starts further up than that, and a page
      // up from where a page down landed would pass the row it came from.
      const within = rowAxis.offsetOf(index) < target ? index + 1 : index;
      return Math.min(within, row - 1);
    });

  const onKeyDown = (event: KeyboardEvent): boolean => {
    const columns = untrack(columnCount);
    if (columns === 0) return false;
    const cursor = untrack(() => active.get());
    const key = inlineKey(event.key, untrack(direction));
    if (cursor.row < HEADER_ROW) {
      const handled = onGroupRowKeyDown(event, key, cursor);
      if (handled !== undefined) return handled;
    }

    // Alt is the resize modifier, and only on the header — where the column
    // the arrows would resize is the one the reader is standing on. Taken
    // before the guard below, which throws away every other modified key.
    if (event.altKey) {
      if (cursor.row !== HEADER_ROW) return false;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
      const column = untrack(() => columnList()[cursor.column]);
      if (!column) return false;
      // Toward the inline end moves the column's free edge away from it.
      const step = key === 'ArrowRight' ? resizeStep : -resizeStep;
      const settled = resizeColumn(column.id, widthOf(cursor.column) + step);
      // A pointer user watches the column move. Resizing from the keyboard
      // changes nothing a screen reader would otherwise report: the handle is
      // `aria-hidden`, the header's text is unchanged, and focus has not
      // moved. Without this the gesture is silent, and silence here reads as
      // the key not having worked.
      if (settled !== null) announce(resizeAnnouncement(column, settled));
      event.preventDefault();
      return true;
    }

    const modified = event.ctrlKey || event.metaKey;

    // Sorting from the keyboard, on the header the arrows already reach. A
    // column a pointer user can order and a keyboard user cannot is a column
    // only some readers can order at all.
    if (cursor.row === HEADER_ROW && !modified && (event.key === 'Enter' || event.key === ' ')) {
      const column = untrack(() => columnList()[cursor.column]);
      if (!column || column.sortable === false) return false;
      toggleSort(column.id, event.shiftKey);
      event.preventDefault();
      return true;
    }

    if (modified && !event.shiftKey && isKeyA(event)) {
      if (rowSelectionMode !== 'multiple') return false;
      selectAllRows();
      event.preventDefault();
      return true;
    }

    // Space selects the row under the cursor. Nothing else claims it: a grid
    // that does not edit has no cell to open, and the header's Space is taken
    // above by the sort.
    if (event.key === ' ' && !modified && !event.shiftKey) {
      if (rowSelectionMode === 'none' || cursor.row < 0) return false;
      const rowKey = untrack(() => selectableKeyAt(cursor.row));
      // A row that cannot be selected still spends the key. Left to the
      // browser, Space scrolls the page — under a reader who pressed it to
      // select, in a grid where it does.
      if (rowKey !== null) toggleRowSelection(rowKey);
      event.preventDefault();
      return true;
    }

    const rows = untrack(allRowCount);
    const toEnd = { row: rows - 1, column: columns - 1 };

    // Shift extends the rectangle. It never reaches the column header, because
    // a range of data cells with a header in it is not a range of data — and
    // where there is no cell selection at all, Shift belongs to the page.
    const extend = event.shiftKey && cellSelectionMode === 'range' && cursor.row >= 0;
    if (event.shiftKey && !extend) return false;

    let next: GridCell;

    if (modified) {
      switch (key) {
        case 'Home':
          next = { row: 0, column: 0 };
          break;
        case 'End':
          next = toEnd;
          break;
        // Ctrl and an arrow is a shortcut the browser or the page owns. With
        // Shift it is the range's own gesture: out to that edge of the grid.
        case 'ArrowRight':
          if (!extend) return false;
          next = { row: cursor.row, column: columns - 1 };
          break;
        case 'ArrowLeft':
          if (!extend) return false;
          next = { row: cursor.row, column: 0 };
          break;
        case 'ArrowDown':
          if (!extend) return false;
          next = { row: rows - 1, column: cursor.column };
          break;
        case 'ArrowUp':
          if (!extend) return false;
          next = { row: 0, column: cursor.column };
          break;
        default:
          return false;
      }
    } else {
      switch (key) {
        case 'ArrowRight':
          next = { row: cursor.row, column: cursor.column + 1 };
          break;
        case 'ArrowLeft':
          next = { row: cursor.row, column: cursor.column - 1 };
          break;
        case 'ArrowDown':
          next = { row: cursor.row + 1, column: cursor.column };
          break;
        case 'ArrowUp':
          // Off the top of the data is the column header, which is row one.
          next = { row: cursor.row - 1, column: cursor.column };
          break;
        case 'Home':
          next = { row: cursor.row, column: 0 };
          break;
        case 'End':
          next = { row: cursor.row, column: columns - 1 };
          break;
        case 'PageDown':
          next = { row: pageAcrossPins(cursor.row, 1), column: cursor.column };
          break;
        case 'PageUp':
          next = { row: pageAcrossPins(cursor.row, -1), column: cursor.column };
          break;
        default:
          return false;
      }
    }

    if (next.row < HEADER_ROW) next = aboveColumnHeader(cursor, next, key === 'ArrowUp');

    if (extend) {
      // Clamped off the header: the cursor may sit on row one, but a rectangle
      // of cells starts at the first row of data.
      const target = { row: clamp(next.row, 0, rows - 1), column: next.column };
      extendRange(cursor, target);
      focusCell(target);
    } else {
      // Any move that is not an extension ends the rectangle. A range left
      // behind by the cursor is a selection whose edges the reader can no
      // longer see, and whose next Shift+Arrow would grow it from nowhere.
      setRange(null);
      focusCell(next);
    }

    // Every one of these would otherwise scroll the page as well, and Ctrl+Home
    // would jump to the top of it.
    event.preventDefault();
    return true;
  };

  const onHeaderClick = (event: MouseEvent): boolean => {
    // A drag that ends on the resize handle fires a click too, and a column the
    // reader has just finished resizing is not a column they asked to sort.
    if (event.target instanceof Element && event.target.closest(`[${GRID_RESIZER_ATTRIBUTE}]`)) {
      return false;
    }
    const cell = cellFrom(event.target);
    if (cell === null || cell.row !== HEADER_ROW) return false;
    const column = untrack(() => columnList()[cell.column]);
    if (!column || column.sortable === false) return false;
    // Shift adds the column to the order rather than replacing it, which is the
    // only way a pointer reaches a two-column sort.
    toggleSort(column.id, event.shiftKey);
    return true;
  };

  const onCellClick = (event: MouseEvent): boolean => {
    if (rowSelectionMode === 'none') return false;
    const cell = cellFrom(event.target);
    if (cell === null || cell.row < 0) return false;
    const key = untrack(() => selectableKeyAt(cell.row));
    if (key === null) return false;

    if (rowSelectionMode === 'multiple' && event.shiftKey) selectRowRange(key);
    else if (rowSelectionMode === 'multiple' && (event.ctrlKey || event.metaKey)) {
      toggleRowSelection(key);
    } else selectRow(key);
    return true;
  };

  // --- The component's view of it ------------------------------------------

  return {
    rows: () => rowViews.get(),
    columns: () => columnViews.get(),
    rowCount: allRowCount,
    sourceRowCount,
    columnCount,
    rowIndex: positionOfKey,
    rowAt: (index) => rowAtPosition(index)?.item,
    columnIndex: (id) => columnList().findIndex((column) => column.id === id),
    columnAt: (index) => columnList()[index],
    columnWidth: (id) => {
      const column = columnById(id);
      return column === undefined ? undefined : widthFor(column);
    },
    direction,

    pinColumn,
    columnPin: (id) => {
      const column = columnById(id);
      return column === undefined ? undefined : pinOf(column, columnPins.get());
    },
    pinnedTopRows: () => pinnedTopViews.get(),
    pinnedBottomRows: () => pinnedBottomViews.get(),

    activeCell: () => active.get(),
    focusCell,
    scrollToCell,

    cellValue: (row, column) => column.column.value(row.item),
    resizeColumn,

    headerRows: () => headerRowViews.get(),
    resizeGroup: (id, width) => {
      shareAmong(columnsAt(columnsOfGroup(id)), width);
    },

    sort: () => sortState.get(),
    sortDirection,
    setSort: (next) => setSort(next, false),
    toggleSort,

    filters: () => filterState.get(),
    setFilter,
    clearFilters,
    quickFilter: () => quickState.get(),
    setQuickFilter,

    selectedRows: () => selectedRowKeys.get(),
    isRowSelected,
    selectRow,
    toggleRowSelection,
    selectAllRows,
    clearRowSelection,

    cellRange: () => cellRange.get(),
    setCellRange: setRange,
    isCellSelected,

    onKeyDown,

    onFocusIn(event) {
      const cell = cellFrom(event.target);
      // Focus inside the grid but not on a cell — a control a consumer put in
      // one — is focus the cursor is not holding.
      if (cell === null) {
        focusOnCursor = false;
        return;
      }
      focusOnCursor = true;
      setActive(cell);
    },

    onResizePointerDown,
    onHeaderClick,
    onCellClick,

    gridProps: () => ({
      // `aria-rowcount` includes the header, which is what `indexBase` already
      // accounted for; `aria-colcount` is the columns themselves.
      ...rowCountProps(),
      ...columnAxis.countProps(),
      role: 'grid',
      'aria-label': options.label,
      // Where more than one thing can be chosen. Both selections qualify: a
      // multi-row selection obviously, and a cell range because a rectangle is
      // more than one cell by construction.
      'aria-multiselectable':
        rowSelectionMode === 'multiple' || cellSelectionMode === 'range' ? 'true' : undefined,
      // A grid with no cell rendered has no roving tab stop, and would drop
      // out of the tab order altogether. An empty result set still has its
      // column header to hold one; a grid with no columns at all has nothing.
      tabindex: hasTabStop() ? undefined : '0',
    }),

    headerProps: () => ({
      role: 'rowgroup',
      style: {
        // The header row is wider than the header, and slides under it. Without
        // this the columns scrolled past the inline start would be painted
        // outside the grid rather than clipped by it.
        overflow: 'hidden',
      },
    }),

    headerRowProps: (row) => ({
      role: onlyGaps(row) ? 'none' : 'row',
      // Numbered from the top row of groups, so the columns' own row comes
      // after every one of them, and the first data row after that.
      'aria-rowindex': onlyGaps(row)
        ? undefined
        : String((row?.index ?? HEADER_ROW) - HEADER_ROW + groupRowCount() + 1),
      style: {
        // The body's container is inside the scroller, so the browser has
        // already moved it by the scroll offset; this one is not, so it has to
        // be moved by both. One transform on one element per scroll, rather
        // than a position written to every header cell — or, with a column
        // pinned, one margin.
        ...horizontalShift(),
      },
    }),

    headerCellProps: (cell) => {
      const column = columnOfHeaderCell(cell);
      if (column === null) return groupHeaderCellProps(cell as GridHeaderCell<T>);
      const sortable = column.column.sortable !== false;
      // Read only where it means something, so a grid that never sorts adds no
      // dependency on the sort to every one of its header cells.
      const entries = sortable ? activeSort.get() : EMPTY_SORT;
      const at = entries.findIndex((entry) => entry.columnId === column.column.id);
      const direction = at < 0 ? null : entries[at]!.direction;

      return {
        [GRID_CELL_ATTRIBUTE]: cellKey(HEADER_ROW, column.index),
        role: 'columnheader',
        'aria-colindex': String(column.index + 1),
        tabindex: isTabStop(HEADER_ROW, column.index) ? '0' : '-1',
        // A sortable column has to say so *before* it is sorted, or the
        // affordance exists only for readers who can see the arrow — and
        // `none` on the others is what makes `ascending` on one of them mean
        // anything, the same argument the listbox makes for `aria-selected`.
        // ARIA says an author SHOULD mark one header at a time; a multi-column
        // sort is the case where that guidance costs more than it buys, so
        // every sorted column is marked and the whole order is announced.
        'aria-sort': sortable ? (direction ?? 'none') : undefined,
        'data-active': isActive(HEADER_ROW, column.index) ? '' : undefined,
        'data-sort': direction ?? undefined,
        // Which of several. A single-column sort has no ordinal worth showing.
        'data-sort-index': at >= 0 && entries.length > 1 ? String(at + 1) : undefined,
        // From the compiled filters and not the signal: a filter the reader has
        // started and not finished is in the signal and removes no row, and a
        // header marked for it would be pointing at nothing.
        'data-filtered': columnFilters.get().some((filter) => filter.columnId === column.column.id)
          ? ''
          : undefined,
        'data-column': column.column.id,
        style: cellStyle(column),
        ...(column.pin === undefined ? {} : { 'data-pinned': column.pin }),
      };
    },

    bodyProps: () =>
      padForPins(
        sizeScroller(
          {
            // Both axes share the scroller, so both have an opinion about it.
            // They agree, and spreading both is what keeps that true if they
            // ever stop.
            ...rowAxis.scrollerProps(),
            ...columnAxis.scrollerProps(),
            role: 'rowgroup',
          },
          scrollerHeight,
        ),
      ),

    // Composed by hand rather than spread from the two axes: each returns a
    // whole `style` object, and the second would replace the first — leaving a
    // sizer as wide as the columns and no taller than the viewport.
    sizerProps: () => ({
      role: 'none',
      style: {
        height: `${rowAxis.totalSize()}px`,
        width: `${columnAxis.totalSize()}px`,
      },
    }),

    containerProps: () => ({
      role: 'none',
      style: containerStyle(),
    }),

    // Clipped as the header is, for the same reason: its rows are as wide as
    // the columns, and slide under it.
    footerProps: () => ({
      role: 'rowgroup',
      style: { overflow: 'hidden' },
    }),

    rowProps: (row) => {
      if (row.pin !== undefined) return pinnedRowProps(row);
      const selectable = rowSelectionMode !== 'none' && isSelectable(row.item);
      const selected = selectable && isRowSelected(row.key);
      return {
        // Carries `aria-rowindex` and the row's height, and marks the element
        // for the virtualizer that owns it.
        ...scrollingRowProps(row),
        ...declaredHeight(row),
        role: 'row',
        // Only where selection is what `aria-selected` reports. In a
        // single-select grid, `false` on every other row is a screenful of
        // "not selected" for the one that is; where any number of rows can be
        // chosen, that false is what makes the set legible.
        'aria-selected':
          selectable && rowSelectionMode === 'multiple'
            ? String(selected)
            : selected
              ? 'true'
              : undefined,
        'data-selected': selected ? '' : undefined,
      };
    },

    cellProps: (row, column) => {
      const selected = cellSelectionMode === 'range' && isCellSelected(row.index, column.index);
      return {
        [GRID_CELL_ATTRIBUTE]: cellKey(row.index, column.index),
        role: 'gridcell',
        // `aria-rowindex` belongs to the row, and is on it. This is the other
        // half of the pair, and the reason a windowed grid can be read at all:
        // the fourth rendered cell is column forty of two hundred, and nothing
        // in the DOM says so.
        'aria-colindex': String(column.index + 1),
        tabindex: isTabStop(row.index, column.index) ? '0' : '-1',
        // A range holds more than one cell by construction, so the cells
        // outside it say `false` rather than staying silent.
        'aria-selected': cellSelectionMode === 'range' ? String(selected) : undefined,
        'data-active': isActive(row.index, column.index) ? '' : undefined,
        'data-selected': selected ? '' : undefined,
        'data-column': column.column.id,
        style: cellStyle(column),
        ...(column.pin === undefined ? {} : { 'data-pinned': column.pin }),
      };
    },

    /**
     * Hidden from assistive technology, like the tree's twisty: it is a
     * pointer affordance for something the keyboard reaches another way —
     * Alt+Arrow on the header cell — and a separator announcing a width in the
     * middle of every column header is one more thing to hear on the way past.
     */
    resizerProps: (cell) => {
      const column = columnOfHeaderCell(cell);
      if (column === null) return groupResizerProps(cell as GridHeaderCell<T>);
      return {
        [GRID_RESIZER_ATTRIBUTE]: column.column.id,
        'aria-hidden': 'true',
        'data-resizing': resizing.get() === column.column.id ? '' : undefined,
        'data-disabled': column.column.resizable === false ? '' : undefined,
        style: {
          // Without it the browser treats a touch on the handle as the start of
          // a scroll, and the drag never gets a second event.
          'touch-action': 'none',
        },
      };
    },
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Whether a key is the one marked A, which with Ctrl selects every row.
 *
 * The character decides where it is a Latin letter, so a layout that puts A
 * somewhere else — AZERTY, on the key QWERTY calls Q — selects with the key
 * marked A. Where it is a letter of another script the physical key decides:
 * a Hebrew layout types ש on that key and an Arabic one ش, and with Ctrl it
 * is still the key that selects all there, as it is to the editing history's
 * shortcuts and the clipboard's. A key that types no letter is no shortcut.
 */
function isKeyA(event: KeyboardEvent): boolean {
  if (!LETTER.test(event.key)) return false;
  if (LATIN_LETTER.test(event.key)) return event.key === 'a' || event.key === 'A';
  return event.code === 'KeyA';
}

const LETTER = /^\p{L}$/u;
const LATIN_LETTER = /^\p{Script=Latin}$/u;

/** Whether two lists hold the same items in the same order, by identity. */
function sameItems<V>(a: readonly V[], b: readonly V[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Whether two column lists name the same columns in the same order.
 *
 * By id and not by identity: a list handed over again with fresh objects for
 * the same columns — a re-fetch, a width restored into a copy — moves nothing.
 */
function sameIds<T>(a: readonly GridColumn<T>[], b: readonly GridColumn<T>[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]!.id !== b[i]!.id) return false;
  return true;
}

/** Where each column id sits in a list — the first place, as `columnIndex` finds it. */
function placesOf<T>(columns: readonly GridColumn<T>[]): Map<string, number> {
  const places = new Map<string, number>();
  for (let i = 0; i < columns.length; i++) {
    if (!places.has(columns[i]!.id)) places.set(columns[i]!.id, i);
  }
  return places;
}

/** What the row axis is told about heights. */
interface RowSizes {
  readonly itemSize: number | ((index: number) => number);
  /** Whether rendered rows are measured, which only `'auto'` asks for. */
  readonly measure: boolean;
}

/**
 * The row axis's sizes, for each way a caller can give a row its height.
 *
 * A number is handed over as it is, which keeps a grid of one height on the
 * virtualizer's arithmetic path with nothing held per row. A function is asked
 * of the row at each place in the view rather than of the index, because a
 * sort changes which row is at an index and a height belongs to the row. And
 * it is not measured: a declared height is not an estimate, and measuring it
 * would let a stylesheet overrule the caller.
 */
function rowSizesFor<T>(
  height: number | ((row: T, index: number) => number) | 'auto',
  estimate: number,
  rows: () => readonly T[],
): RowSizes {
  if (typeof height === 'number') return { itemSize: height, measure: false };
  if (height === 'auto') return { itemSize: () => estimate, measure: true };
  // The count the virtualizer sizes for is the length of this same view, so
  // every index it asks about holds a row.
  return { itemSize: (index) => height(rows()[index]!, index), measure: false };
}

/**
 * Have the row axis watch the rows a change to the view brings into a window
 * that has not moved.
 *
 * The virtualizer looks for the rows to measure again only when its window's
 * range moves. A sort, a filter or a group shut can put other rows in every
 * place of the window and leave the range where it was, and the rows brought
 * in would then never be measured — they would stay the estimate, and the
 * sizer and the window with them, until the reader scrolled — while the rows
 * taken out stayed watched. `remeasure` is the one way to have it look again.
 *
 * It also forgets the height of the row at the index it is handed, and any
 * row's height forgotten here is a row that shrinks back to the estimate until
 * the observer reports it again: the rows below it rebuilt twice, and near the
 * foot of the grid a sizer that shrinks under the scroll and clamps it. So it
 * is handed an index that names no row. Past the view, the row axis keys an
 * index by the index itself, and no row can be keyed NaN in this grid: every
 * lookup by key is by `===`, under which NaN is equal to nothing.
 */
function watchRowsBroughtIn(rows: Virtualizer): void {
  let window: { start: number; end: number; keys: ReadonlySet<string | number> } | null = null;
  effect(() => {
    const items = rows.items();
    const { startIndex, endIndex } = rows.range();
    const before = window;
    window = { start: startIndex, end: endIndex, keys: new Set(items.map((item) => item.key)) };
    // A window that moved is looked through again by the virtualizer itself.
    if (before === null || before.start !== startIndex || before.end !== endIndex) return;
    if (items.every((item) => before.keys.has(item.key))) return;
    untrack(() => rows.remeasure(Number.NaN));
  });
}

/**
 * The scroller's height and cap, as styles, or null where neither was asked for.
 *
 * Inline, so they win over a stylesheet that bounds the scroller — which a grid
 * of a fixed height needs one to, and which is what `height: 'auto'` undoes.
 */
function scrollerHeightStyle(
  height: 'auto' | undefined,
  maxHeight: number | undefined,
): Readonly<Record<string, string>> | null {
  if (height === undefined && maxHeight === undefined) return null;
  const style: Record<string, string> = {};
  if (height === 'auto') style.height = 'auto';
  if (maxHeight !== undefined) style['max-height'] = `${maxHeight}px`;
  return style;
}

/**
 * The scroller's props with its height and cap added to the style the axes
 * gave it — added rather than spread beside it, since a second `style` would
 * replace the first and take `overflow-anchor` with it.
 */
function sizeScroller(props: GridProps, height: Readonly<Record<string, string>> | null): GridProps {
  if (height === null) return props;
  const style = props.style as Readonly<Record<string, string>> | undefined;
  return { ...props, style: { ...style, ...height } };
}

/**
 * What the quick filter reads from a row: the filter value of every column
 * that can be filtered, or null where none can and there is nothing to search.
 *
 * Shared with `createGrouping`, which filters a grouped grid in the grid's
 * place and searches the same columns.
 */
export function quickFilterValues<T>(
  columns: readonly GridColumn<T>[],
): ((row: T) => unknown)[] | null {
  const values: ((row: T) => unknown)[] = [];
  for (const column of columns) {
    if (column.filterable !== false) values.push(column.filterValue ?? column.value);
  }
  return values.length === 0 ? null : values;
}

/**
 * Says, in development, why the grid did not filter.
 *
 * A grid whose columns cannot be filtered is almost always a grouped one:
 * `createGrouping` lifts every column unfilterable, because the grid is handed
 * the group headers as rows and a filter over them would strip the headings
 * from the rows they describe. The call that was refused did nothing at all,
 * which is otherwise indistinguishable from a filter that matched every row.
 */
function refuseFilter(reason: string, method: string): void {
  if (__VOLT_DEV__ && typeof console !== 'undefined') {
    console.warn(
      `[volt] createGrid: ${reason}, so ${method} did nothing. ` +
        'Every column of a grouped grid says so, because the grid is handed the group headers ' +
        'as rows and a filter over those would strip each heading from in front of the rows ' +
        `it describes: filter through the grouping instead, with its own ${method}.`,
    );
  }
}

/**
 * A sentence the grid says aloud: the locale's catalogue where it has the key,
 * then English.
 *
 * None of the grid's keys is in the library's own catalogue, so a translation
 * that has never heard of a grid is not made to grow them: one that declares
 * them is heard, numbers formatted for its locale, and without them the English
 * stands. Asked when the sentence is said, so a catalogue swapped later is
 * heard from then on.
 */
function said(locale: Locale, key: string, english: string, values?: MessageValues): string {
  return locale.has(key) ? locale.t(key, values) : english;
}

/** A column's new width, after a resize from the keyboard. */
function describeWidth(locale: Locale, column: { readonly header: string }, width: number): string {
  const n = Math.round(width);
  return said(locale, 'gridColumnWidth', `${column.header}, ${n} pixels`, {
    column: column.header,
    n,
  });
}

/**
 * The whole order, not just the column that changed.
 *
 * "Sorted by Department ascending, then Salary descending" is the sentence a
 * reader needs, because the column they just clicked is the one thing they
 * already know: what they cannot see is what it did to the terms around it.
 * Built a term at a time, each joined to the ones before it, so a catalogue
 * can put the words of every piece in its own language's order.
 */
function describeSortOrder<T>(locale: Locale, sort: readonly GridSortDescriptor<T>[]): string {
  if (sort.length === 0) return said(locale, 'gridNotSorted', 'Not sorted');
  const terms = sort
    .map(({ column: { header: column }, direction }) =>
      direction === 'ascending'
        ? said(locale, 'gridAscending', `${column} ascending`, { column })
        : said(locale, 'gridDescending', `${column} descending`, { column }),
    )
    .reduce((before, term) =>
      said(locale, 'gridThen', `${before}, then ${term}`, { terms: before, term }),
    );
  return said(locale, 'gridSortedBy', `Sorted by ${terms}`, { terms });
}

/**
 * How many rows a filter left, out of how many there were.
 *
 * Shared with `createGrouping`, which filters a grouped grid in the grid's
 * place and has the same count to say.
 */
export function describeFilterCount(locale: Locale, shown: number, total: number): string {
  const values = { n: shown, m: total };
  return shown === total
    ? said(locale, 'gridAllRows', `All ${total} rows`, values)
    : said(locale, 'gridRowsLeft', `${shown} of ${total} rows`, values);
}

// --- Pinning ---------------------------------------------------------------

/** No pin made at the grid: every column keeps the pin its definition gives it. */
const EMPTY_PINS: ReadonlyMap<string, GridColumnPin> = new Map();
/** No rows pinned to an edge, shared so that none is the same value every time. */
const NO_ROWS: readonly never[] = [];
const NO_ROW_VIEWS: readonly never[] = [];

/** How the pinned columns divide the drawn list: a count and a width per edge. */
interface PinLayout {
  readonly start: number;
  readonly end: number;
  readonly startWidth: number;
  readonly endWidth: number;
}

/** Nothing pinned, as one value, so that asking whether anything is costs a comparison. */
const NO_PINS: PinLayout = { start: 0, end: 0, startWidth: 0, endWidth: 0 };

function samePinLayout(a: PinLayout, b: PinLayout): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.startWidth === b.startWidth &&
    a.endWidth === b.endWidth
  );
}

/** A pin as the grid reads one: anything but an edge is no pin. */
export function asPin(value: unknown): GridColumnPin {
  return value === 'start' || value === 'end' ? value : null;
}

/** Where a column is held: a pin made at the grid, else the column's own. */
export function pinOf<T>(column: GridColumn<T>, pins: ReadonlyMap<string, GridColumnPin>): GridColumnPin {
  return asPin(pins.has(column.id) ? pins.get(column.id) : column.pin);
}

/** Start-pinned first, end-pinned last: the order a region is drawn in, as a number. */
export function pinRegion(pin: GridColumnPin): 0 | 1 | 2 {
  return pin === 'start' ? 0 : pin === 'end' ? 2 : 1;
}

/**
 * The columns in the order they are drawn — start-pinned, scrolling,
 * end-pinned, each in the order handed over.
 *
 * Shared with `createGridState`, which hands the grid its columns in this
 * order so that a place in its list and a place in the grid's are the same.
 * The list itself where it is in that order already, which is every list that
 * pins nothing.
 */
export function inDrawnOrder<T>(
  list: readonly GridColumn<T>[],
  pins: ReadonlyMap<string, GridColumnPin>,
): readonly GridColumn<T>[] {
  let last = 0;
  let ordered = true;
  for (const column of list) {
    const region = pinRegion(pinOf(column, pins));
    if (region < last) ordered = false;
    last = Math.max(last, region);
  }
  if (ordered) return list;
  const regions: [GridColumn<T>[], GridColumn<T>[], GridColumn<T>[]] = [[], [], []];
  for (const column of list) regions[pinRegion(pinOf(column, pins))].push(column);
  return [...regions[0], ...regions[1], ...regions[2]];
}

/**
 * The grid's own column list: the caller's, in drawn order.
 *
 * The caller's array itself wherever it is in that order, so a grid that pins
 * nothing reads exactly the list it always did. A reordering is kept while it
 * holds the same columns in the same order, so writing a pin that moves
 * nothing — a column already at the edge it is pinned to — hands nothing a
 * new list, and a sorted grid re-sorts nothing for it.
 */
function drawnColumnList<T>(
  columns: () => readonly GridColumn<T>[],
  pins: Signal.State<ReadonlyMap<string, GridColumnPin>>,
): Signal.Computed<readonly GridColumn<T>[]> {
  let reordered: readonly GridColumn<T>[] | null = null;
  return new Signal.Computed(() => {
    const list = columns();
    const drawn = inDrawnOrder(list, pins.get());
    if (drawn === list) return list;
    if (reordered === null || !sameItems(reordered, drawn)) reordered = drawn;
    return reordered;
  });
}

/** Count the pinned columns at each end of a drawn list, and how wide each edge is. */
function measurePins<T>(
  list: readonly GridColumn<T>[],
  pins: ReadonlyMap<string, GridColumnPin>,
  widthFor: (column: GridColumn<T>) => number,
): PinLayout {
  let start = 0;
  let startWidth = 0;
  while (start < list.length && pinOf(list[start]!, pins) === 'start') {
    startWidth += widthFor(list[start]!);
    start++;
  }
  let end = 0;
  let endWidth = 0;
  while (end < list.length - start && pinOf(list[list.length - 1 - end]!, pins) === 'end') {
    endWidth += widthFor(list[list.length - 1 - end]!);
    end++;
  }
  return start === 0 && end === 0 ? NO_PINS : { start, end, startWidth, endWidth };
}

/** The rows pinned to each edge, as one snapshot the cursor can be followed across. */
interface PinnedRows<T> {
  readonly top: readonly T[];
  readonly bottom: readonly T[];
}

// --- Column groups -----------------------------------------------------------

/** The key of the columns' own header row, below every row of groups. */
const COLUMNS_ROW_KEY = 'columns';

/** A column under no group, shared so that none is the same value every time. */
const NO_GROUP_PATH: readonly GridColumnGroup[] = [];

/**
 * Side-by-side columns under the same group at one level, or a gap: columns
 * with no group at that level. `from` and `to` are places in the column list,
 * both included.
 */
interface GroupRun {
  readonly from: number;
  readonly to: number;
  readonly group: GridColumnGroup | null;
  readonly key: string;
}

/** Which columns every group spans, at every level, over the whole column list. */
interface ColumnGroupLayout {
  /** How many rows of groups sit above the columns' own. */
  readonly depth: number;
  /** The groups each column sits under, outermost first, by its place in the list. */
  readonly paths: readonly (readonly GridColumnGroup[])[];
  /** The runs of each level, outermost first, in the order of the columns, covering every column. */
  readonly levels: readonly (readonly GroupRun[])[];
  /** For each level, the run each column is in, as a place in that level's runs. */
  readonly runOf: readonly Int32Array[];
}

/** No group named, as one value, so that asking whether a grid has any costs a comparison. */
const NO_COLUMN_GROUPS: ColumnGroupLayout = { depth: 0, paths: [], levels: [], runOf: [] };

/**
 * The groups a column sits under, outermost first.
 *
 * Shared with `createGridState`, which keeps a group's columns together. A
 * group named twice up one chain ends the chain there: a parent that is its
 * own ancestor has no outermost group to start from.
 */
export function columnGroupPath<T>(column: GridColumn<T>): readonly GridColumnGroup[] {
  if (column.group === undefined) return NO_GROUP_PATH;
  const path: GridColumnGroup[] = [];
  const seen = new Set<string>();
  for (let group: GridColumnGroup | undefined = column.group; group !== undefined; group = group.parent) {
    if (seen.has(group.id)) break;
    seen.add(group.id);
    path.push(group);
  }
  return path.reverse();
}

/**
 * Lay the groups the columns name out in rows: level 0 the outermost group
 * over each column, level 1 the one inside that, and so on — so each column's
 * groups sit at the top, and a column under fewer groups than the deepest has
 * gaps beneath its innermost one, down to its own header.
 *
 * A run is cut wherever the group changes, wherever the run above it is cut,
 * and wherever `regionOf` says a pinned edge falls. A group's runs are keyed
 * by its id and how many runs of it came before at that level, so a group
 * drawn once keeps its key however its columns are moved inside it; a gap is
 * keyed by its first column, a column's id being unique and a number before a
 * colon being no gap's.
 */
function layoutColumnGroups<T>(
  list: readonly GridColumn<T>[],
  regionOf: (index: number) => number,
): ColumnGroupLayout {
  const paths = list.map(columnGroupPath);
  const depth = paths.reduce((deepest, path) => Math.max(deepest, path.length), 0);
  if (depth === 0) return NO_COLUMN_GROUPS;

  const levels: GroupRun[][] = [];
  const runOf: Int32Array[] = [];
  let cut = list.map((_, i) => i === 0 || regionOf(i) !== regionOf(i - 1));
  for (let level = 0; level < depth; level++) {
    const runs: { from: number; to: number; group: GridColumnGroup | null; key: string }[] = [];
    const of = new Int32Array(list.length);
    const drawn = new Map<string, number>();
    const below = cut.slice();
    for (let i = 0; i < list.length; i++) {
      const group = paths[i]![level] ?? null;
      const before = i === 0 ? null : (paths[i - 1]![level] ?? null);
      if (cut[i] || group?.id !== before?.id) {
        below[i] = true;
        const times = group === null ? 0 : (drawn.get(group.id) ?? 0);
        if (group !== null) drawn.set(group.id, times + 1);
        const key = group === null ? `gap:${list[i]!.id}` : `${times}:${group.id}`;
        runs.push({ from: i, to: i, group, key });
      } else {
        runs[runs.length - 1]!.to = i;
      }
      of[i] = runs.length - 1;
    }
    cut = below;
    levels.push(runs);
    runOf.push(of);
  }
  return { depth, paths, levels, runOf };
}

/**
 * Whether two layouts say the same: every run over the same columns under
 * the same group object, and every column under the same group objects. By
 * identity, so a group handed over again with a new header is a change.
 */
function sameColumnGroupLayout(a: ColumnGroupLayout, b: ColumnGroupLayout): boolean {
  if (a === b) return true;
  if (a.depth !== b.depth || a.paths.length !== b.paths.length) return false;
  for (let i = 0; i < a.paths.length; i++) if (!sameItems(a.paths[i]!, b.paths[i]!)) return false;
  for (let level = 0; level < a.depth; level++) {
    const left = a.levels[level]!;
    const right = b.levels[level]!;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      const x = left[i]!;
      const y = right[i]!;
      if (x.from !== y.from || x.to !== y.to || x.group !== y.group || x.key !== y.key) return false;
    }
  }
  return true;
}

/**
 * Share a width among columns in proportion to the widths they have, or
 * evenly where together they have none.
 *
 * A column that cannot be resized keeps its width. Each of the rest is held to
 * its bounds, and what a bound refuses one column is shared among the others,
 * again in proportion. The whole pixels rounding leaves over go one each to
 * the columns with the most of a pixel left, the first in line where they tie,
 * so the columns add up to the width asked for wherever their bounds allow.
 * Null where no column can be resized.
 */
function shareWidth<T>(
  columns: readonly GridColumn<T>[],
  current: readonly number[],
  width: number,
  clampWidth: (column: GridColumn<T>, width: number) => number,
): number[] | null {
  let open = columns.flatMap((column, i) => (column.resizable === false ? [] : [i]));
  if (open.length === 0) return null;
  // Each column's bounds, asked of the clamp at either extreme. A share is held
  // where it falls outside them, by however little: one let through for being
  // within a pixel of a bound is floored or given a spare pixel below, and the
  // clamp at the end then moves it back onto the bound — leaving the columns a
  // pixel off the width asked for, where another column could have taken it.
  const low = columns.map((column) => clampWidth(column, Number.NEGATIVE_INFINITY));
  const high = columns.map((column) => clampWidth(column, Number.POSITIVE_INFINITY));
  const exact = current.slice();
  const free = new Set(open);
  let left = width - current.reduce((sum, w, i) => (free.has(i) ? sum : sum + w), 0);
  while (open.length > 0) {
    const base = open.reduce((sum, i) => sum + current[i]!, 0);
    const scale = base > 0 ? left / base : 0;
    // Columns with no width among them have no proportion to keep: shared in
    // proportion to nothing, they would stay at nothing whatever was asked.
    const even = base > 0 ? 0 : left / open.length;
    const held = open.filter((i) => {
      const want = base > 0 ? current[i]! * scale : even;
      if (want >= low[i]! && want <= high[i]!) return false;
      exact[i] = clampWidth(columns[i]!, want);
      return true;
    });
    if (held.length === 0) {
      for (const i of open) exact[i] = base > 0 ? current[i]! * scale : even;
      break;
    }
    for (const i of held) left -= exact[i]!;
    open = open.filter((i) => !held.includes(i));
  }

  const shared = exact.map((w, i) => (free.has(i) ? Math.floor(w) : w));
  const owed = Math.round([...free].reduce((sum, i) => sum + exact[i]!, 0));
  let spare = owed - [...free].reduce((sum, i) => sum + shared[i]!, 0);
  const byFraction = [...free].sort((x, y) => exact[y]! - shared[y]! - (exact[x]! - shared[x]!) || x - y);
  for (const i of byFraction) {
    if (spare <= 0) break;
    shared[i] = shared[i]! + 1;
    spare--;
  }
  return shared.map((w, i) => (free.has(i) ? clampWidth(columns[i]!, w) : w));
}

/** A resize drag of one handle: what it holds, and how it moves and is put back. */
interface ResizeDrag {
  /** Mark the handle as held, or let it go. */
  hold(on: boolean): void;
  /** Move to `delta` px from where the drag started. */
  to(delta: number): void;
  /** Put back what the drag started with. */
  cancel(): void;
}
