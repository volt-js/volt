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
 *              :spread="table.headerCellProps(col)">{ col.column.header }
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
 *                  :spread="table.cellProps(row, col)">{ table.cellValue(row, col) }</div>
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
 * and every cell must be `box-sizing: border-box` or its padding will push the
 * columns out of step with the header:
 *
 *   [role='row'] { display: flex; }
 *   [role='gridcell'], [role='columnheader'] { box-sizing: border-box; }
 *
 * The keyboard map, which is the WAI-ARIA grid pattern:
 *
 *   ArrowRight, ArrowLeft      next, previous cell in the row
 *   ArrowDown, ArrowUp         same column, next or previous row
 *   Home, End                  first, last cell of the row
 *   Ctrl + Home, Ctrl + End    first cell of the grid, last cell of the grid
 *   PageDown, PageUp           one viewport of rows down, up
 *   Alt + Arrow on a header    widen or narrow the column under the cursor
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
 * model, never from the DOM, because the DOM only ever holds the window.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createVirtualizer, type VirtualOverscan } from '@voltdev/primitives';

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
  /** How much one Alt+Arrow press resizes by, in px. Default 16. */
  resizeStep?: number;
}

export interface Grid<T> {
  /** The rows to render, in order. */
  rows(): readonly GridRow<T>[];
  /** The columns to render, in order. Both axes are windowed. */
  columns(): readonly GridColumnView<T>[];
  /** How many rows the collection has, rendered or not. */
  rowCount(): number;
  columnCount(): number;

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

  /** Handle a keydown. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;
  /** Keeps the cursor and the browser's idea of focus from drifting apart. */
  onFocusIn(event: FocusEvent): void;
  /** Starts a column resize drag. Wire it to the resize handle. */
  onResizePointerDown(event: PointerEvent): void;

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
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const resizeStep = options.resizeStep ?? DEFAULT_RESIZE_STEP;

  const columnList = (): readonly GridColumn<T>[] => options.columns();
  const rowList = (): readonly T[] => options.rows();
  const rowCount = (): number => rowList().length;
  const columnCount = (): number => columnList().length;

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
   * Read untracked, and only ever from the virtualizer's `itemSize`. Column
   * geometry is declared rather than measured — a column's width is state the
   * grid holds, being exactly what a resize writes — so the one path that
   * changes it is `resizeColumn` telling the virtualizer to rebuild. Letting
   * the geometry subscribe to the widths as well would give the same change
   * two ways in, arriving a frame apart.
   */
  const widthOf = (index: number): number =>
    untrack(() => {
      const column = columnList()[index];
      if (!column) return 0;
      return clampWidth(column, widths.get().get(column.id) ?? column.width ?? DEFAULT_COLUMN_WIDTH);
    });

  // --- The two axes --------------------------------------------------------

  const rowAxis = createVirtualizer({
    scroller: options.scroller,
    container: options.container,
    count: rowCount,
    itemSize: rowHeight,
    overscan: options.overscan,
    getItemKey: (index) =>
      untrack(() => {
        const item = rowList()[index];
        return item === undefined ? index : (options.getRowKey?.(item, index) ?? index);
      }),
    // Rows count with `aria-rowindex`, and the count lives on the grid rather
    // than on each row. Two, because the column header is row one.
    counting: 'row',
    indexBase: 2,
    axis: 'vertical',
  });

  const columnAxis = createVirtualizer({
    scroller: options.scroller,
    // Deliberately empty: nothing may observe a header cell and quietly
    // overrule the width the grid is holding. A function `itemSize` is what
    // turns `remeasure()` on, and `remeasure()` is how a resize gets the
    // geometry rebuilt — the virtualizer otherwise rebuilds only when the
    // count changes, and a resize does not change how many columns there are.
    container: () => null,
    count: columnCount,
    itemSize: widthOf,
    overscan: options.overscan,
    getItemKey: (index) => untrack(() => columnList()[index]?.id ?? index),
    counting: 'column',
    indexBase: 1,
    axis: 'horizontal',
  });

  /**
   * Rebuild the column geometry when the definitions themselves change.
   *
   * A consumer swapping in a list of the same length with different widths
   * changes nothing the virtualizer watches: the count is what it rebuilds on.
   * Identity is enough to spot it, because a column list is data the consumer
   * replaces rather than mutates.
   */
  let lastColumns: readonly GridColumn<T>[] | null = null;
  effect(() => {
    const list = columnList();
    if (lastColumns === list) return;
    const first = lastColumns === null;
    lastColumns = list;
    if (!first) columnAxis.remeasure();
  });

  const rowViews = new Signal.Computed<readonly GridRow<T>[]>(() => {
    const list = rowList();
    const views: GridRow<T>[] = [];
    for (const item of rowAxis.items()) {
      const data = list[item.index];
      // The window was computed from a count, and this is the list itself; a
      // consumer whose `rows()` filters on the fly hands back a different
      // array to each caller, and the two can disagree by a row. Rendering one
      // row fewer is better than rendering a hole.
      if (data === undefined) continue;
      views.push({
        index: item.index,
        key: item.key,
        item: data,
        start: item.start,
        size: item.size,
      });
    }
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

  /** Keep the cursor inside the grid as rows are filtered away or columns drop. */
  effect(() => {
    // Read tracked: this exists to run again when either count changes.
    rowCount();
    columnCount();
    setActive(untrack(() => active.get()));
  });

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

  effect(() => {
    // Read both windows: this effect exists to run again when either moves.
    rowAxis.items();
    columnAxis.items();
    const target = pendingFocus;
    if (target === null) return;
    const el = elementAt(target);
    if (!el) return;
    pendingFocus = null;
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

  // --- Resizing ------------------------------------------------------------

  const indexOfColumn = (id: string): number =>
    untrack(() => columnList().findIndex((column) => column.id === id));

  const resizeColumn = (id: string, width: number): void => {
    const index = indexOfColumn(id);
    const column = untrack(() => columnList()[index]);
    if (!column || column.resizable === false) return;

    const next = clampWidth(column, width);
    if (next === widthOf(index)) return;

    const map = new Map(untrack(() => widths.get()));
    map.set(id, next);
    widths.set(map);
    // The one path that gets the column geometry rebuilt. Without it the
    // widths would change and every offset after this column would not.
    columnAxis.remeasure();
    options.onColumnResize?.(id, next);
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

    const onCancelKey = (key: KeyboardEvent): void => {
      if (key.key !== 'Escape') return;
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
      handle.ownerDocument.removeEventListener('keydown', onCancelKey, true);
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
    handle.ownerDocument.addEventListener('keydown', onCancelKey, true);
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
      resizeColumn(column.id, widthOf(cursor.column) + step);
      event.preventDefault();
      return true;
    }

    const rows = untrack(rowCount);
    const toEnd = { row: rows - 1, column: columns - 1 };
    let next: GridCell;

    if (event.ctrlKey || event.metaKey) {
      // Only the two grid-extreme chords are ours. Everything else with a
      // modifier is a shortcut the browser or the page owns.
      if (event.key === 'Home') next = { row: 0, column: 0 };
      else if (event.key === 'End') next = toEnd;
      else return false;
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

    focusCell(next);
    // Every one of these would otherwise scroll the page as well, and Ctrl+Home
    // would jump to the top of it.
    event.preventDefault();
    return true;
  };

  // --- The component's view of it ------------------------------------------

  return {
    rows: () => rowViews.get(),
    columns: () => columnViews.get(),
    rowCount,
    columnCount,

    activeCell: () => active.get(),
    focusCell,
    scrollToCell,

    cellValue: (row, column) => column.column.value(row.item),
    resizeColumn,

    onKeyDown,

    onFocusIn(event) {
      const cell = cellFrom(event.target);
      if (cell === null) return;
      setActive(cell);
    },

    onResizePointerDown,

    gridProps: () => ({
      // `aria-rowcount` includes the header, which is what `indexBase` already
      // accounted for; `aria-colcount` is the columns themselves.
      ...rowAxis.countProps(),
      ...columnAxis.countProps(),
      role: 'grid',
      'aria-label': options.label,
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

    headerCellProps: (column) => ({
      [GRID_CELL_ATTRIBUTE]: cellKey(HEADER_ROW, column.index),
      role: 'columnheader',
      'aria-colindex': String(column.index + 1),
      tabindex: isTabStop(HEADER_ROW, column.index) ? '0' : '-1',
      'data-active': isActive(HEADER_ROW, column.index) ? '' : undefined,
      'data-column': column.column.id,
      style: { width: `${column.width}px` },
    }),

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

    rowProps: (row) => ({
      // Carries `aria-rowindex` and the row's height, and marks the element
      // for the virtualizer that owns it.
      ...rowAxis.itemProps(row.index),
      role: 'row',
    }),

    cellProps: (row, column) => ({
      [GRID_CELL_ATTRIBUTE]: cellKey(row.index, column.index),
      role: 'gridcell',
      // `aria-rowindex` belongs to the row, and is on it. This is the other
      // half of the pair, and the reason a windowed grid can be read at all:
      // the fourth rendered cell is column forty of two hundred, and nothing
      // in the DOM says so.
      'aria-colindex': String(column.index + 1),
      tabindex: isTabStop(row.index, column.index) ? '0' : '-1',
      'data-active': isActive(row.index, column.index) ? '' : undefined,
      'data-column': column.column.id,
      style: { width: `${column.width}px` },
    }),

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
