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
 * **Two selections, because they answer different questions.** A row selection
 * is "these records" and is held by key, so it survives sorting, filtering and
 * scrolling and can be read by whatever acts on it. A cell range is "this
 * rectangle" and is held by position, so it is dropped the moment the
 * arrangement it described stops existing.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import {
  announce,
  createVirtualizer,
  useLocale,
  type Locale,
  type MessageValues,
  type VirtualOverscan,
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
  rangeContains,
  sameKeys,
  sameRange,
  type GridCellRange,
  type GridCellSelectionMode,
  type GridRowKey,
  type GridRowSelectionMode,
} from './selection.js';

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
 * The row index the column header navigates under.
 *
 * Data rows are 0-based, so the header needs a row of its own that is not one
 * of them. Negative rather than a separate flag on the position: every
 * comparison in the keyboard map then stays plain arithmetic, and "above row
 * zero" means the header without anything having to say so.
 */
export const HEADER_ROW = -1;

/** Row height when none is given, in px. */
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
}

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

/** One rendered row. Offsets are from the top of the collection, in px. */
export interface GridRow<T> {
  readonly index: number;
  readonly key: string | number;
  /** The row's data — what a column's accessor is given. */
  readonly item: T;
  readonly start: number;
  readonly size: number;
}

/** One rendered column. Offsets are from the left of the collection, in px. */
export interface GridColumnView<T> {
  readonly index: number;
  readonly key: string | number;
  readonly column: GridColumn<T>;
  readonly start: number;
  /** The width the geometry is using, which a resize has already clamped. */
  readonly width: number;
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
   * Every row is exactly this tall, which makes the vertical geometry
   * arithmetic: nothing is measured, nothing is observed, and a million rows
   * cost what ten do. Default 32.
   */
  rowHeight?: number;

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
}

export interface Grid<T> {
  /** The rows to render, in order. */
  rows(): readonly GridRow<T>[];
  /** The columns to render, in order. Both axes are windowed. */
  columns(): readonly GridColumnView<T>[];
  /**
   * How many rows the grid has, rendered or not — after filtering.
   *
   * This is the number `aria-rowcount` reports, and it has to be the filtered
   * one. A reader told there are ten thousand rows in a grid a filter has left
   * nine of is worse off than a reader told nothing.
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
   */
  columnIndex(id: string): number;

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
  headerRowProps(): GridProps;
  headerCellProps(column: GridColumnView<T>): GridProps;
  bodyProps(): GridProps;
  /** The empty element sized to the whole collection, on both axes. */
  sizerProps(): GridProps;
  containerProps(): GridProps;
  rowProps(row: GridRow<T>): GridProps;
  cellProps(row: GridRow<T>, column: GridColumnView<T>): GridProps;
  resizerProps(column: GridColumnView<T>): GridProps;
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
  const sortAnnouncement =
    options.sortAnnouncement ??
    ((sort: readonly GridSortDescriptor<T>[]): string => describeSortOrder(locale, sort));
  const filterAnnouncement =
    options.filterAnnouncement ??
    ((shown: number, total: number): string => describeFilterCount(locale, shown, total));

  const rowSelectionMode = options.rowSelection ?? 'none';
  const cellSelectionMode = options.cellSelection ?? 'none';

  const columnList = (): readonly GridColumn<T>[] => options.columns();
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
    if (!column) return 0;
    return clampWidth(column, widths.get().get(column.id) ?? column.width ?? DEFAULT_COLUMN_WIDTH);
  };

  /** The same width, read from a handler that must not subscribe to it. */
  const widthOf = (index: number): number => untrack(() => sizeOf(index));

  // --- The two axes --------------------------------------------------------

  const rowAxis = createVirtualizer({
    scroller: options.scroller,
    container: options.container,
    count: rowCount,
    itemSize: rowHeight,
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

  const columnAxis = createVirtualizer({
    scroller: options.scroller,
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
    for (const item of rowAxis.items()) {
      const data = list[item.index];
      // The window was computed from a count, and this is the list itself; a
      // consumer whose `rows()` filters on the fly hands back a different
      // array to each caller, and the two can disagree by a row. Rendering one
      // row fewer is better than rendering a hole.
      if (data === undefined) continue;
      const cached = previous.get(item.key);
      const view: GridRow<T> =
        cached !== undefined &&
        cached.item === data &&
        cached.index === item.index &&
        cached.start === item.start &&
        cached.size === item.size
          ? cached
          : { index: item.index, key: item.key, item: data, start: item.start, size: item.size };
      next.set(item.key, view);
      views.push(view);
    }
    rowViewCache = next;
    return views;
  });

  const columnViews = new Signal.Computed<readonly GridColumnView<T>[]>(() => {
    const list = columnList();
    const views: GridColumnView<T>[] = [];
    for (const item of columnAxis.items()) {
      const column = list[item.index];
      if (!column) continue;
      views.push({
        index: item.index,
        key: item.key,
        column,
        start: item.start,
        // From the geometry rather than from the definition, so that a cell's
        // width and the offset of the column after it can never disagree.
        width: item.size,
      });
    }
    return views;
  });

  // --- The cursor ----------------------------------------------------------

  const clampCell = (cell: GridCell): GridCell => {
    const columns = columnCount();
    if (columns === 0) return { row: HEADER_ROW, column: 0 };
    const column = clamp(Math.trunc(cell.column), 0, columns - 1);
    const rows = rowCount();
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
    const column = clamp(cursor.column, columnRange.startIndex, columnRange.endIndex);

    if (cursor.row === HEADER_ROW) return { row: HEADER_ROW, column };
    const rowRange = rowAxis.range();
    // The header is always rendered, so it is where the tab stop goes when no
    // data row is.
    if (rowRange.startIndex < 0) return { row: HEADER_ROW, column };
    return { row: clamp(cursor.row, rowRange.startIndex, rowRange.endIndex), column };
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

  const scrollToCell = (cell: GridCell): void => {
    columnAxis.scrollToIndex(cell.column);
    // The header is outside the scroller, so there is nothing to scroll to
    // vertically when the cursor is on it.
    if (cell.row >= 0) rowAxis.scrollToIndex(cell.row);
  };

  const focusCell = (cell: GridCell): void => {
    const target = clampCell(cell);
    setActive(target);
    scrollToCell(target);

    const el = elementAt(target);
    if (el) {
      pendingFocus = null;
      focusOnCursor = true;
      el.focus();
      return;
    }
    pendingFocus = target;
  };

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
    const row = rowList()[index];
    return row === undefined || !isSelectable(row) ? null : rowKeyOf(row, index);
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
   * Put the cursor back on the row it was on, wherever that row has gone.
   *
   * The row is worked out from the view being replaced rather than from a key
   * kept alongside the cursor, which is what makes it right no matter who
   * moved the cursor last: `previous[cursor.row]` *is* the row the reader was
   * standing on, by construction, and there is no second copy of that fact to
   * go stale.
   */
  const followRows = (rows: readonly T[], previous: readonly T[]): void => {
    // A rectangle of cells is a region of the grid *as it was arranged*, and
    // the arrangement has just changed: the rows between its corners are
    // somewhere else now, and the reader never asked for whatever is between
    // them today. Row selection is held by key and survives this; a range
    // cannot, so it goes.
    setRange(null);

    const cursor = untrack(() => active.get());
    // The column header is row one whatever the data does, so there is nothing
    // underneath the cursor to follow.
    if (cursor.row < 0) return;

    const was = previous[cursor.row];
    if (was === undefined) return;
    const index = indexOfKey(rows, rowKeyOf(was, cursor.row));

    // The row was filtered away. The clamp below keeps the cursor legal, and it
    // stays at the position it had, which is where a reader watching rows
    // disappear would expect to still be.
    if (index < 0 || index === cursor.row) return;

    // Focus follows the cursor only if it was on the cursor to begin with. A
    // sort is almost always driven from the column header, which is where the
    // reader is standing when the data moves underneath them — pulling focus
    // down into the body would take them off the control they just used.
    const next = { row: index, column: cursor.column };
    if (cursorHeldFocus()) focusCell(next);
    else setActive(next);
  };

  /**
   * Keep the cursor on the row it was on, and inside the grid.
   *
   * One effect rather than two, because the two answers interfere: a clamp run
   * first would re-anchor the cursor to whichever row had slid under it, and
   * the lookup would then have nothing left to look up. Stating the order here
   * is better than leaving it to the order the effects happen to be created in.
   */
  let renderedRows: readonly T[] | null = null;
  effect(() => {
    const rows = rowList();
    // Read tracked: the cursor has to be re-examined when either axis changes.
    columnCount();

    const previous = renderedRows;
    renderedRows = rows;
    if (previous !== null && previous !== rows) followRows(rows, previous);

    setActive(untrack(() => active.get()));
  });

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

  const onResizePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (stopResize) return;

    const handle = event.currentTarget;
    if (!(handle instanceof HTMLElement)) return;
    const id = handle.getAttribute(GRID_RESIZER_ATTRIBUTE);
    if (id === null) return;

    const index = indexOfColumn(id);
    const column = untrack(() => columnList()[index]);
    if (!column || column.resizable === false) return;

    // A press on the handle is a resize and nothing else: without this it is
    // also a press on the header cell it sits in, which moves the cursor.
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = widthOf(index);
    handle.setPointerCapture?.(event.pointerId);
    resizing.set(id);

    const onMove = (move: PointerEvent): void => {
      if (move.pointerId !== event.pointerId) return;
      resizeColumn(id, startWidth + (move.clientX - startX));
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
      resizeColumn(id, startWidth);
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
      resizing.set(null);
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

  const onKeyDown = (event: KeyboardEvent): boolean => {
    const columns = untrack(columnCount);
    if (columns === 0) return false;
    const cursor = untrack(() => active.get());

    // Alt is the resize modifier, and only on the header — where the column
    // the arrows would resize is the one the reader is standing on. Taken
    // before the guard below, which throws away every other modified key.
    if (event.altKey) {
      if (cursor.row !== HEADER_ROW) return false;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false;
      const column = untrack(() => columnList()[cursor.column]);
      if (!column) return false;
      const step = event.key === 'ArrowRight' ? resizeStep : -resizeStep;
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

    if (modified && !event.shiftKey && (event.key === 'a' || event.key === 'A')) {
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
      const key = untrack(() => selectableKeyAt(cursor.row));
      // A row that cannot be selected still spends the key. Left to the
      // browser, Space scrolls the page — under a reader who pressed it to
      // select, in a grid where it does.
      if (key !== null) toggleRowSelection(key);
      event.preventDefault();
      return true;
    }

    const rows = untrack(rowCount);
    const toEnd = { row: rows - 1, column: columns - 1 };

    // Shift extends the rectangle. It never reaches the column header, because
    // a range of data cells with a header in it is not a range of data — and
    // where there is no cell selection at all, Shift belongs to the page.
    const extend = event.shiftKey && cellSelectionMode === 'range' && cursor.row >= 0;
    if (event.shiftKey && !extend) return false;

    let next: GridCell;

    if (modified) {
      switch (event.key) {
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
      switch (event.key) {
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
          next = { row: cursor.row + pageRows(), column: cursor.column };
          break;
        case 'PageUp':
          next = { row: cursor.row - pageRows(), column: cursor.column };
          break;
        default:
          return false;
      }
    }

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
    rowCount,
    sourceRowCount,
    columnCount,
    rowIndex: (key) => indexOfKey(rowList(), key),
    rowAt: (index) => rowList()[index],
    columnIndex: (id) => columnList().findIndex((column) => column.id === id),

    activeCell: () => active.get(),
    focusCell,
    scrollToCell,

    cellValue: (row, column) => column.column.value(row.item),
    resizeColumn,

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
      ...rowAxis.countProps(),
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
        // this the columns scrolled off the left would be painted outside the
        // grid rather than clipped by it.
        overflow: 'hidden',
      },
    }),

    headerRowProps: () => ({
      role: 'row',
      'aria-rowindex': '1',
      style: {
        // The body's container is inside the scroller, so the browser has
        // already moved it by the scroll offset; this one is not, so it has to
        // be moved by both. One transform on one element per scroll, rather
        // than a position written to every header cell.
        transform: `translateX(${columnAxis.offset() - columnAxis.scrollOffset()}px)`,
      },
    }),

    headerCellProps: (column) => {
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
        style: { width: `${column.width}px` },
      };
    },

    bodyProps: () => ({
      // Both axes share the scroller, so both have an opinion about it. They
      // agree, and spreading both is what keeps that true if they ever stop.
      ...rowAxis.scrollerProps(),
      ...columnAxis.scrollerProps(),
      role: 'rowgroup',
    }),

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
      style: {
        transform: `translate(${columnAxis.offset()}px, ${rowAxis.offset()}px)`,
      },
    }),

    rowProps: (row) => {
      const selectable = rowSelectionMode !== 'none' && isSelectable(row.item);
      const selected = selectable && isRowSelected(row.key);
      return {
        // Carries `aria-rowindex` and the row's height, and marks the element
        // for the virtualizer that owns it.
        ...rowAxis.itemProps(row.index),
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
        style: { width: `${column.width}px` },
      };
    },

    /**
     * Hidden from assistive technology, like the tree's twisty: it is a
     * pointer affordance for something the keyboard reaches another way —
     * Alt+Arrow on the header cell — and a separator announcing a width in the
     * middle of every column header is one more thing to hear on the way past.
     */
    resizerProps: (column) => ({
      [GRID_RESIZER_ATTRIBUTE]: column.column.id,
      'aria-hidden': 'true',
      'data-resizing': resizing.get() === column.column.id ? '' : undefined,
      'data-disabled': column.column.resizable === false ? '' : undefined,
      style: {
        // Without it the browser treats a touch on the handle as the start of
        // a scroll, and the drag never gets a second event.
        'touch-action': 'none',
      },
    }),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
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
function describeWidth<T>(locale: Locale, column: GridColumn<T>, width: number): string {
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
