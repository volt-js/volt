/**
 * Saving and restoring what a reader arranged, as one plain value.
 *
 * A reader who spends a minute putting the salary column first, hiding the
 * notes, widening the names, sorting, filtering and grouping by team has made
 * something, and a reload that throws it away has thrown away their minute.
 * This layer turns all of it into one object that `JSON.stringify` can write
 * and `JSON.parse` can give back exactly, and turns that object back into the
 * arrangement it describes.
 *
 *   class People {
 *     sort = new Signal.State<readonly GridSort[]>([]);
 *     filters = new Signal.State<ReadonlyMap<string, GridFilter>>(new Map());
 *     quickFilter = new Signal.State('');
 *     // Typed: the view and the grid each read the other, and TypeScript
 *     // cannot infer a pair of fields that refer to each other.
 *     view: GridStateLayer<Person> = createGridState<Person>({
 *       grid: () => this.table,
 *       columns: () => COLUMNS,
 *       sort: this.sort,
 *       filters: this.filters,
 *       quickFilter: this.quickFilter,
 *     });
 *     table = createGrid<Person>({
 *       columns: () => this.view.columns(),
 *       onColumnResize: this.view.onColumnResize,
 *       sort: this.sort,
 *       filters: this.filters,
 *       quickFilter: this.quickFilter,
 *       // ...the elements and the rows, as for any grid
 *     });
 *   }
 *
 * **The saved state is the arrangement and nothing else.** Column order,
 * visibility, widths and pins, the sort, the filters and the quick filter, the
 * grouping and which groups are shut. No row, no row key and nothing read from
 * a row is in it — nothing here reads a row at all — and what came from the
 * data is only what the reader typed or chose: a filter's text, a shut group's
 * key. Nor is anything held by position: the cursor, a cell range and the
 * scroll offset each name a place in the view as it was arranged, and the view
 * a restore produces is another one. Row selection is left out too, although
 * it is held by key: it is a choice of records rather than a way of looking at
 * them, and a saved view that brought back last week's ticked rows would hand
 * a bulk action rows the reader never chose today.
 *
 * **Restoring is forgiving, except about the future.** A saved state outlives
 * the code that wrote it: a column is renamed, one is added, a filter type
 * changes. Anything naming a column that no longer exists is dropped, anything
 * malformed is dropped, and a column added since the save takes its defaults —
 * shown unless the page starts it hidden, at its own width, and placed after
 * the column it follows in the list the caller gives. A piece the state leaves
 * out goes back to what the page started with. None of that throws, because a
 * stored value that cannot be read is a reason to show the default grid and
 * never a reason to show a broken page. A state written by a *newer* version is
 * the exception: this code cannot know what the fields it does not recognise
 * meant, and applying the ones it does would leave the grid in an arrangement
 * nobody made. So it is refused whole, with the reason, and nothing is written.
 * An older one is read as what it could say: version 1 had no pins, so a
 * version-1 state pins nothing, whatever it carries.
 *
 * **Every piece is a signal the caller shares.** The sort, the filters and the
 * quick filter are the signals the grid (or, on a grouped grid, the grouping)
 * already takes, handed to this layer as well — the same arrangement
 * `createGrouping` asks for with its sort. Restoring writes those signals
 * directly rather than calling `setFilter` and friends, because those are the
 * gestures: they announce, and a grid that announced a saved view on load
 * would talk over the page. A piece this layer is not handed is neither saved
 * nor restored.
 *
 * Column order and visibility are held here, because nothing else holds them:
 * the grid is handed a list of columns and renders that list. `columns()` is
 * that list, arranged — hand it to the grid, or to the grouping on a grouped
 * grid. A hidden column is out of the list, and the grid sorts, filters and
 * groups only by columns in its list, so a sort or a filter on a hidden column
 * stays in the state and comes back into force with the column, exactly as the
 * grid treats a column that has gone.
 *
 * The list is in the order the grid draws, pinned columns at their edges, so a
 * place in `allColumns()` is a place the reader sees, and moving a column into
 * or out of a pinned region pins or unpins it. **Pins are a signal the grid
 * shares,** as the sort is: hand the grid and this layer the same
 * `columnPins`, so a pin made at the grid is saved. Each pin is also baked into
 * the column `columns()` hands out, as a restored width is, so a grid that was
 * not handed the signal still draws what was restored.
 *
 * **A column group is kept together, and a shut one is the columns it hid.**
 * The grid draws a group over the columns that name it where they sit side by
 * side, so a column moved in between two of a group it is not in would part
 * the group. `moveColumn` and `moveGroup` keep every group whole, counting the
 * hidden columns as `moveColumn` always has, so a shut group opens where it
 * was. Shutting a group hides all but its first column, which is everything
 * the saved state needs to say about it: no field of its own, and so no new
 * version for older code to refuse.
 *
 * **Widths are the one piece the grid holds.** A resize writes a width into
 * the grid, keyed by column id, and that width wins over any `width` a column
 * definition gives for as long as the grid lives. So a width reaches this
 * layer from the grid's `onColumnResize`, and goes back two ways: into the
 * `width` of each column `columns()` hands out, which is how a freshly built
 * grid — or a column that is hidden when the state is restored — gets it; and
 * through `resizeColumn`, for a column whose width the grid already holds and
 * would otherwise keep.
 *
 * **Nothing here costs a row.** The saved state reads no row and no cell, so a
 * value changing in a cell recomputes nothing here. Recording a width changes
 * no column the grid is handed, so a resize on a sorted grid re-sorts nothing.
 * And a restore writes every piece before the grid reads any of them, so a
 * state that sorts and filters derives the view once, not once per piece.
 */

import { Signal, effect } from '@voltdev/core';
import { compileFilter, type GridFilter, type GridNumberOperator, type GridTextOperator } from './filter.js';
import {
  asPin,
  columnGroupPath,
  inDrawnOrder,
  pinOf,
  pinRegion,
  type Grid,
  type GridColumn,
  type GridColumnGroup,
  type GridColumnPin,
} from './grid.js';
import { sameSort, type GridSort, type GridSortDirection } from './sort.js';

const { untrack } = Signal.subtle;

/**
 * The version of the saved state this code writes, and the newest it reads.
 *
 * Raised whenever the saved state gains something older code could not honour,
 * so that older code refuses it rather than restoring the half it understands.
 * Version 2 added pins. Each older version is read as what it could say: a
 * version-1 state pins nothing.
 */
export const GRID_STATE_VERSION = 2;

/**
 * The width `createGrid` gives a column that declares none, in px.
 *
 * Needed here only to put a width the reader chose back to the column's
 * default: the grid keeps a resized width until something overwrites it, and
 * it has no way to be asked what the default would have been. A test pins the
 * two together, so this cannot drift from the grid's without failing.
 */
const DEFAULT_COLUMN_WIDTH = 150;

/**
 * What `createGrouping` joins a group's key to its parent's with, which makes
 * it part of every saved path: changing it there changes what a saved state
 * means, and needs a new `GRID_STATE_VERSION`. Needed here to tell how deep a
 * saved path goes. A test pins the two together, as with the width above.
 */
const GROUP_PATH_SEPARATOR = '\u001f';

/** One column's place in the arrangement. */
export interface GridColumnState {
  readonly id: string;
  /**
   * The width the reader chose, in px. Absent where they chose none, so a
   * column whose declared width changes in a later release shows the new one
   * to every reader who never resized it.
   */
  readonly width?: number;
  /** Present, and true, only for a column the reader hid. */
  readonly hidden?: true;
  /**
   * The edge the reader pinned it to, or null where they unpinned a column the
   * page pins. Absent where they did neither, so a column whose own `pin`
   * changes in a later release is held where that release says.
   */
  readonly pin?: GridColumnPin;
}

/**
 * Everything a reader arranged, as a value `JSON.stringify` writes and
 * `JSON.parse` gives back unchanged.
 *
 * Every column is listed, in the reader's order, hidden ones included: a
 * hidden column keeps its place for when it is shown again.
 */
export interface GridState {
  readonly version: number;
  readonly columns: readonly GridColumnState[];
  /** Outermost term first. */
  readonly sort: readonly GridSort[];
  /** By column id. */
  readonly filters: Readonly<Record<string, GridFilter>>;
  readonly quickFilter: string;
  /** Column ids, outermost level first. */
  readonly groupBy: readonly string[];
  /** The paths of the groups the reader shut. Every other group is open. */
  readonly collapsed: readonly string[];
}

/**
 * Why `apply` wrote nothing.
 *
 * A code rather than a sentence, so that whatever tells the reader their saved
 * view could not be restored can say so in their language.
 */
export type GridStateRefusal =
  | {
      readonly applied: false;
      /** The value is not a saved grid state at all: not an object, or no version. */
      readonly reason: 'not-a-state';
    }
  | {
      readonly applied: false;
      /** Written by newer code than this, which reads up to `GRID_STATE_VERSION`. */
      readonly reason: 'newer-version';
      /** The version it was written as. */
      readonly version: number;
    };

/** What `apply` did: everything it could read, or nothing at all. */
export type GridStateApplyResult = { readonly applied: true } | GridStateRefusal;

/**
 * What to save and restore, and where each piece lives.
 *
 * A piece left out is neither saved nor restored. The exceptions are `order`
 * and `hidden`, which nothing but this layer holds: left out, it owns them.
 *
 * What each signal holds when the layer is created is the page's own
 * arrangement — the one a first visit shows — and what a restore puts back
 * for whatever its state leaves out.
 */
export interface GridStateOptions<T> {
  /**
   * The grid being arranged.
   *
   * A function rather than the grid itself, because the grid is handed this
   * layer's `columns()` and so is created after it. All this asks of it is
   * `resizeColumn`, which is also what lets it take a grid over any rows: a
   * grouped grid's rows are the grouping's wrappers, not the caller's own.
   */
  grid: () => Pick<Grid<unknown>, 'resizeColumn'> | null | undefined;
  /**
   * Every column, in its default order — hidden or not. The same list a grid
   * would be given if nothing were arranged; `columns()` is that list
   * arranged.
   */
  columns: () => readonly GridColumn<T>[];

  /**
   * Column ids in the reader's order. Supply a signal to drive the order from
   * outside; without one this layer owns it. A column the order does not name
   * goes after the column it follows in `columns`.
   */
  order?: Signal.State<readonly string[]>;
  /** The ids of the hidden columns. Supply a signal to drive it from outside. */
  hidden?: Signal.State<ReadonlySet<string>>;
  /**
   * The pins the grid is handed as its `columnPins`, so that a pin made at the
   * grid is saved. Without one this layer holds its own, which reaches the grid
   * only through the `pin` each column `columns()` hands out carries.
   */
  columnPins?: Signal.State<ReadonlyMap<string, GridColumnPin>>;

  /** The sort signal the grid is handed. Without one, the sort is not saved. */
  sort?: Signal.State<readonly GridSort[]>;
  /**
   * The filters signal the grid is handed — or, on a grouped grid, the one the
   * grouping is handed, since that is where a grouped grid filters.
   */
  filters?: Signal.State<ReadonlyMap<string, GridFilter>>;
  /** The quick-filter signal, from wherever the filters signal is. */
  quickFilter?: Signal.State<string>;
  /**
   * The column ids the grouping groups by, outermost first — read by the
   * grouping's `groupBy`. Ids rather than `GridGroupSpec`s, because a spec
   * carries functions and a saved state cannot: map an id to its spec where the
   * grouping reads it.
   */
  groupBy?: Signal.State<readonly string[]>;
  /** The collapsed signal the grouping is handed. */
  collapsed?: Signal.State<ReadonlySet<string>>;
}

/** The arranged columns to hand the grid, the gestures that arrange them, and the saved state. */
export interface GridStateLayer<T> {
  /**
   * The columns to render, in the reader's order, without the hidden ones and
   * with any restored width and pin in place. Hand it to the grid's `columns`,
   * or to the grouping's. The pinned columns come first and last, as the grid
   * draws them.
   *
   * The same array for as long as the arrangement is the same — a sort, a
   * filter or a resize hands the grid no new list — and, with nothing
   * arranged, the caller's own array rather than a copy of it. A column
   * carrying a restored width or pin is a copy of the caller's with that
   * `width` or `pin`, so a column is known by its `id` and not by identity.
   */
  columns(): readonly GridColumn<T>[];
  /**
   * Every column in the reader's order, hidden ones included: what a column
   * chooser lists. Start-pinned first and end-pinned last, as drawn.
   */
  allColumns(): readonly GridColumn<T>[];
  /** Whether a column is hidden. */
  isColumnHidden(id: string): boolean;
  /** Hide or show a column. A column not in `columns` is ignored. */
  setColumnHidden(id: string, hidden: boolean): void;
  /**
   * Move a column to a place in `allColumns()`, clamped to the ends. Counted
   * among every column rather than the visible ones, so a hidden column keeps
   * the place it had.
   *
   * A place inside a pinned region pins the column there, and a place among
   * the scrolling columns unpins it: the list is drawn in regions, and a
   * column dropped among the start-pinned ones but left to scroll would be
   * drawn somewhere other than where it was dropped. The pin is written to
   * `columnPins`, where the grid and the saved state read it. A place on the
   * boundary between two regions — straight after the last start-pinned
   * column, say — is in both, and the column keeps whichever it was in.
   *
   * A column moves only among the columns of its group, and is never put
   * between two columns of a group it is not in: a place that would part a
   * group is moved to the nearest place that does not, the side the column
   * came from where two are as near. Among them means beside one of them in
   * the region the column lands in, so a group a pin has parted is not parted
   * again by a column dropped in the gap between its parts. With no groups,
   * every place will do.
   */
  moveColumn(id: string, index: number): void;
  /**
   * Move a group — every column under it, in their order — so that its first
   * column is at a place in `allColumns()`, counted among the columns outside
   * it and clamped to the ends. Kept together as `moveColumn` keeps a column:
   * inside the group it is part of, and never inside another. A place in a
   * pinned region pins every column of the group there, and a place among the
   * scrolling columns unpins them. A group no column names is ignored.
   */
  moveGroup(id: string, index: number): void;
  /**
   * Shut a group to its first column in `allColumns()`: every other column
   * under it is hidden, as `setColumnHidden` hides one, and the first is
   * shown. Nothing else is held, so the saved state carries a shut group as
   * the columns it hid. A group of one column, or none, is ignored.
   */
  collapseGroup(id: string): void;
  /**
   * Open a group: show every column under it — those a reader hid one at a
   * time as well, since what is saved cannot tell those from the ones a shut
   * group hid.
   */
  expandGroup(id: string): void;
  /** Whether a group is shut: of its columns, its first is shown and every other hidden. */
  isGroupCollapsed(id: string): boolean;
  /**
   * Hand this to the grid as its `onColumnResize`. It is how a width the reader
   * chose reaches the saved state: the grid holds widths, and says when one
   * changes.
   */
  onColumnResize(id: string, width: number): void;

  /**
   * The current arrangement, as a signal: read it in an effect to persist it on
   * change, with whatever debounce suits the storage — a drag reports every
   * move.
   *
   * A new object only when the arrangement changed. A signal written with an
   * equal value, a column list handed over again, a row selected, a cell
   * changed: none of them makes a new state, so none of them wakes the effect.
   */
  state(): GridState;
  /**
   * Restore an arrangement. Takes `unknown`, because it is usually handed
   * whatever came back from storage.
   *
   * Silent — nothing is announced, and neither `onSortChange`,
   * `onFilterChange` nor `onCollapsedChange` fires, as with any signal written
   * from outside. What the grid does after any sort, filter or new column list
   * it still does: the cursor follows its row and its column, and a cell range
   * is dropped — or, where only the columns moved, carried with them — each
   * saying so through its own callback. Every piece the state leaves out goes
   * back to what its signal held when this layer was created, so
   * `apply({ version: GRID_STATE_VERSION })` resets to the page's own
   * arrangement.
   */
  apply(state: unknown): GridStateApplyResult;
}

const EMPTY_IDS: readonly string[] = [];
const EMPTY_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_SORT: readonly GridSort[] = [];
const EMPTY_FILTERS: ReadonlyMap<string, GridFilter> = new Map();
const EMPTY_WIDTHS: ReadonlyMap<string, number> = new Map();
const EMPTY_PINS: ReadonlyMap<string, GridColumnPin> = new Map();
const APPLIED: GridStateApplyResult = { applied: true };
const NOT_A_STATE: GridStateRefusal = { applied: false, reason: 'not-a-state' };

/**
 * The operators a saved filter may name, as records rather than lists, so the
 * compiler insists on every operator the filter module declares.
 */
const TEXT_OPERATORS: Readonly<Record<GridTextOperator, true>> = {
  contains: true,
  notContains: true,
  equals: true,
  notEquals: true,
  startsWith: true,
  endsWith: true,
};
const NUMBER_OPERATORS: Readonly<Record<GridNumberOperator, true>> = {
  equals: true,
  notEquals: true,
  greaterThan: true,
  greaterThanOrEqual: true,
  lessThan: true,
  lessThanOrEqual: true,
  between: true,
};
const DIRECTIONS: Readonly<Record<GridSortDirection, true>> = {
  ascending: true,
  descending: true,
};

/**
 * Hold a grid's column order and visibility, and save and restore everything a
 * reader arranged as one plain, versioned value.
 *
 * Call it where a component's fields are initialised, as `createGrid` is: it
 * creates an effect, which is disposed with the component that owns it.
 */
export function createGridState<T>(options: GridStateOptions<T>): GridStateLayer<T> {
  const orderState = options.order ?? new Signal.State<readonly string[]>(EMPTY_IDS);
  const hiddenState = options.hidden ?? new Signal.State<ReadonlySet<string>>(EMPTY_SET);
  const pinState =
    options.columnPins ?? new Signal.State<ReadonlyMap<string, GridColumnPin>>(EMPTY_PINS);

  /**
   * The arrangement a first visit shows: what each signal held when this layer
   * was created. Whatever a restored state leaves out goes back to it, so a
   * reset returns a page that starts sorted to its sort rather than to none,
   * and a column the state does not list — one added since it was saved —
   * starts hidden where the page starts it hidden.
   */
  const defaults = untrack(() => ({
    order: orderState.get(),
    hidden: hiddenState.get(),
    pins: pinState.get(),
    sort: options.sort?.get() ?? EMPTY_SORT,
    filters: options.filters?.get() ?? EMPTY_FILTERS,
    quickFilter: options.quickFilter?.get() ?? '',
    groupBy: options.groupBy?.get() ?? EMPTY_IDS,
    collapsed: options.collapsed?.get() ?? EMPTY_SET,
  }));

  /**
   * The widths the last restore handed out, baked into the columns.
   *
   * Written by `apply` and nothing else. A resize the reader makes is held by
   * the grid and reported to `widths` below; baking it in here as well would
   * hand the grid a new column list on every move of a drag, and a new column
   * list makes a sorted grid re-sort every row.
   */
  const restoredWidths = new Signal.State<ReadonlyMap<string, number>>(EMPTY_WIDTHS);
  /** Every width the reader has: those restored, then each one the grid reports. */
  const widths = new Signal.State<ReadonlyMap<string, number>>(EMPTY_WIDTHS);

  /**
   * The ids of the columns the grid holds a width for — every one it has ever
   * reported. The grid never lets go of a width, so neither does this.
   */
  const held = new Set<string>();
  /**
   * Held columns a restore has not yet put right: their width in the grid is
   * whatever the reader left, and the restore says otherwise. A column is
   * reachable through `resizeColumn` only while the grid's list holds it, so a
   * hidden one waits here until it is shown.
   */
  const owed = new Set<string>();
  /** Set while this layer is resizing, so the grid's report of it is not taken for the reader's. */
  let restoring = false;

  /**
   * One copy of each column carrying a restored width or a pin, reused while
   * both hold, so that the arranged list can be compared by identity. A copy
   * carries only what differs from the caller's column.
   */
  const baked = new WeakMap<GridColumn<T>, GridColumn<T>>();
  const bake = (
    column: GridColumn<T>,
    width: number | undefined,
    pins: ReadonlyMap<string, GridColumnPin>,
  ): GridColumn<T> => {
    const sized = width !== undefined && width !== column.width;
    const pin = pinOf(column, pins);
    const pinned = pin !== asPin(column.pin);
    if (!sized && !pinned) return column;
    const cached = baked.get(column);
    const wantWidth = sized ? width : column.width;
    const wantPin = pinned ? pin : column.pin;
    if (cached !== undefined && cached.width === wantWidth && cached.pin === wantPin) return cached;
    const copy = { ...column, ...(sized ? { width } : {}), ...(pinned ? { pin } : {}) };
    baked.set(column, copy);
    return copy;
  };

  const keepAll = keeper(sameItems<GridColumn<T>>);
  const everyColumn = new Signal.Computed<readonly GridColumn<T>[]>(() => {
    const definitions = options.columns();
    const restored = restoredWidths.get();
    const pins = pinState.get();
    const arranged = inDrawnOrder(
      arrange(definitions, orderState.get()).map((column) =>
        bake(column, restored.get(column.id), pins),
      ),
      pins,
    );
    // The caller's own array when arranging it changed nothing, so an
    // unarranged grid is handed exactly the list it would have been handed
    // without this layer.
    return keepAll(sameItems(arranged, definitions) ? definitions : arranged);
  });

  const keepShown = keeper(sameItems<GridColumn<T>>);
  const visibleColumns = new Signal.Computed<readonly GridColumn<T>[]>(() => {
    const all = everyColumn.get();
    const hidden = hiddenState.get();
    const shown = all.filter((column) => !hidden.has(column.id));
    // The whole list itself where nothing in it is hidden — a hidden set may
    // name a column that has gone — so an unarranged grid is still handed
    // the caller's own array.
    return keepShown(shown.length === all.length ? all : shown);
  });

  /**
   * Put right every owed width the grid can reach, which is every visible one:
   * to the reader's width, or where the state gives none, to the width the
   * caller declared — read from their own column, since a held column's baked
   * copy may carry a width the grid has been ignoring.
   */
  const settle = (shown: readonly GridColumn<T>[]): void => {
    if (owed.size === 0) return;
    const table = options.grid();
    if (!table) return;
    const chosen = untrack(() => widths.get());
    const declared = new Map<string, number | undefined>();
    for (const column of untrack(options.columns)) declared.set(column.id, column.width);
    restoring = true;
    try {
      for (const column of shown) {
        if (!owed.has(column.id)) continue;
        owed.delete(column.id);
        const width = chosen.get(column.id) ?? declared.get(column.id) ?? DEFAULT_COLUMN_WIDTH;
        table.resizeColumn(column.id, width);
      }
    } finally {
      restoring = false;
    }
  };

  // A held column shown after a restore still carries the width the reader
  // left in the grid. Heard here rather than in `setColumnHidden`, because a
  // caller who supplied `hidden` shows columns by writing it.
  effect(() => {
    const shown = visibleColumns.get();
    untrack(() => settle(shown));
  });

  const keepState = keeper<GridState>(sameJson);
  const state = new Signal.Computed<GridState>(
    () => {
      const current = widths.get();
      const hidden = hiddenState.get();
      const pins = pinState.get();
      const columns = everyColumn.get().map((column): GridColumnState => {
        const width = current.get(column.id);
        const pin = readersPin(column.id, pins, defaults.pins);
        return {
          id: column.id,
          ...(width === undefined ? {} : { width }),
          ...(hidden.has(column.id) ? { hidden: true as const } : {}),
          ...(pin === undefined ? {} : { pin }),
        };
      });
      const read = readState(
        {
          version: GRID_STATE_VERSION,
          columns,
          sort: options.sort?.get() ?? [],
          filters: Object.fromEntries(options.filters?.get() ?? []),
          quickFilter: options.quickFilter?.get() ?? '',
          groupBy: options.groupBy?.get() ?? [],
          collapsed: [...(options.collapsed?.get() ?? EMPTY_SET)],
        },
        options.columns(),
        warnLostFilter,
      );
      // Built from this module's own values at this module's version, so a
      // refusal is not a thing it can produce.
      return keepState(read as GridState);
    },
  );

  const setColumnHidden = (id: string, hidden: boolean): void => {
    if (!untrack(options.columns).some((column) => column.id === id)) return;
    const current = untrack(() => hiddenState.get());
    if (current.has(id) === hidden) return;
    const next = new Set(current);
    if (hidden) next.add(id);
    else next.delete(id);
    hiddenState.set(next);
  };

  const moveColumn = (id: string, index: number): void => {
    if (Number.isNaN(index)) return;
    const all = untrack(() => everyColumn.get());
    const from = all.findIndex((column) => column.id === id);
    if (from < 0) return;
    const asked = Math.min(Math.max(Math.trunc(index), 0), all.length - 1);
    const pins = untrack(() => pinState.get());
    const was = pinOf(all[from]!, pins);
    const to = keptTogether(all, [from], asked, columnGroupPath(all[from]!), pins, was);
    const rest = all.filter((_, i) => i !== from);
    const region = regionAt(rest, to, was, pins);
    if (from === to && region === was) return;
    if (region !== was) {
      const next = new Map(pins);
      next.set(id, region);
      pinState.set(next);
    }
    const ids = rest.map((column) => column.id);
    ids.splice(to, 0, id);
    orderState.set(ids);
  };

  /** Where in a list each column under a group is, hidden ones included. */
  const placesUnder = (list: readonly GridColumn<T>[], id: string): number[] =>
    list.flatMap((column, i) => (columnGroupPath(column).some((group) => group.id === id) ? [i] : []));

  const moveGroup = (id: string, index: number): void => {
    if (Number.isNaN(index)) return;
    const all = untrack(() => everyColumn.get());
    const moved = placesUnder(all, id);
    if (moved.length === 0) return;
    const block = moved.map((i) => all[i]!);
    const rest = all.filter((_, i) => !moved.includes(i));
    // The groups it sits in are those above it on its first column.
    const path = columnGroupPath(block[0]!);
    const inside = path.slice(0, path.findIndex((group) => group.id === id));
    const asked = Math.min(Math.max(Math.trunc(index), 0), rest.length);
    const pins = untrack(() => pinState.get());
    const was = pinOf(block[0]!, pins);
    const to = keptTogether(all, moved, asked, inside, pins, was);
    const region = regionAt(rest, to, was, pins);
    const repinned = block.filter((column) => pinOf(column, pins) !== region);
    const ids = rest.map((column) => column.id);
    ids.splice(to, 0, ...block.map((column) => column.id));
    if (repinned.length === 0 && ids.every((place, i) => place === all[i]!.id)) return;
    if (repinned.length > 0) {
      const next = new Map(pins);
      for (const column of repinned) next.set(column.id, region);
      pinState.set(next);
    }
    orderState.set(ids);
  };

  const collapseGroup = (id: string): void => {
    const all = untrack(() => everyColumn.get());
    const under = placesUnder(all, id);
    if (under.length < 2) return;
    const current = untrack(() => hiddenState.get());
    const next = new Set(current);
    next.delete(all[under[0]!]!.id);
    for (const place of under.slice(1)) next.add(all[place]!.id);
    if (!sameKeySet(current, next)) hiddenState.set(next);
  };

  const expandGroup = (id: string): void => {
    const all = untrack(() => everyColumn.get());
    const current = untrack(() => hiddenState.get());
    const shown = placesUnder(all, id).map((place) => all[place]!.id);
    if (!shown.some((column) => current.has(column))) return;
    const next = new Set(current);
    for (const column of shown) next.delete(column);
    hiddenState.set(next);
  };

  const isGroupCollapsed = (id: string): boolean => {
    const all = everyColumn.get();
    const under = placesUnder(all, id);
    if (under.length < 2) return false;
    const hidden = hiddenState.get();
    return under.every((place, i) => hidden.has(all[place]!.id) === (i > 0));
  };

  const onColumnResize = (id: string, width: number): void => {
    held.add(id);
    if (restoring) return;
    const current = untrack(() => widths.get());
    if (current.get(id) === width) return;
    const next = new Map(current);
    next.set(id, width);
    widths.set(next);
  };

  const apply = (input: unknown): GridStateApplyResult => {
    const read = readState(input, untrack(options.columns));
    if ('applied' in read) {
      refuse(read, input);
      return read;
    }

    // A record, or `readState` would have refused it.
    const given = input as Readonly<Record<string, unknown>>;
    const left = (piece: keyof GridState): boolean => given[piece] === undefined;

    const listed = read.columns.map((column) => column.id);
    const order = left('columns') ? defaults.order : listed;
    const hidden = new Set(read.columns.filter((column) => column.hidden).map((column) => column.id));
    // A column the state does not list was never arranged by this reader, so
    // it starts as it starts for everyone.
    for (const id of defaults.hidden) if (!listed.includes(id)) hidden.add(id);
    // The pins the state gives, over the page's own: those it starts with
    // hold for every column the state gives none — one it does not list, one
    // the reader neither pinned nor unpinned, and every column of a version-1
    // state, which could say nothing of pins. What goes is the reader's own.
    const pins = new Map<string, GridColumnPin>(defaults.pins);
    for (const column of read.columns) if (column.pin !== undefined) pins.set(column.id, column.pin);
    const sized = new Map<string, number>();
    for (const column of read.columns) {
      if (column.width !== undefined) sized.set(column.id, column.width);
    }
    // Baked only into a column the grid holds no width for. A held width wins
    // over any column's `width`, so a held column is put right through
    // `resizeColumn` below instead, and its baked entry is left as it was:
    // the grid ignores it, and changing it would hand the grid a new column
    // list — and a sorted grid a re-sort — for nothing.
    const restored = untrack(() => restoredWidths.get());
    const baking = new Map<string, number>();
    for (const column of read.columns) {
      const width = held.has(column.id) ? restored.get(column.id) : column.width;
      if (width !== undefined) baking.set(column.id, width);
    }

    // Every collection a caller shares is compared before it is written. An
    // equal one written anyway is a new identity, and what reads it is derived
    // from identities: a sort array rewritten with the same terms re-sorts
    // every row. A string needs no comparing, since a signal ignores an equal
    // one, and the widths are this layer's own, read only by computeds that
    // hand back what they had when nothing changed.
    untrack(() => {
      if (!sameItems(orderState.get(), order)) orderState.set(order);
      if (!sameKeySet(hiddenState.get(), hidden)) hiddenState.set(hidden);
      if (!samePins(pinState.get(), pins)) pinState.set(pins);
      restoredWidths.set(baking);
      widths.set(sized);

      const { sort, filters, quickFilter, groupBy, collapsed } = options;
      if (sort) {
        const next = left('sort') ? defaults.sort : read.sort;
        if (!sameSort(sort.get(), next)) sort.set(next);
      }
      if (filters) {
        const next = left('filters') ? defaults.filters : new Map(Object.entries(read.filters));
        if (!sameFilters(filters.get(), next)) filters.set(next);
      }
      quickFilter?.set(left('quickFilter') ? defaults.quickFilter : read.quickFilter);
      if (groupBy) {
        const next = left('groupBy') ? defaults.groupBy : read.groupBy;
        if (!sameItems(groupBy.get(), next)) groupBy.set(next);
      }
      if (collapsed) {
        const next = left('collapsed') ? defaults.collapsed : new Set(read.collapsed);
        if (!sameKeySet(collapsed.get(), next)) collapsed.set(next);
      }
    });

    // The widths the grid holds are the reader's, and win over any column's
    // `width`. Every one of them is put right: to the restored width, or to
    // the column's own where the state gives none.
    for (const id of held) owed.add(id);
    untrack(() => settle(visibleColumns.get()));
    return APPLIED;
  };

  return {
    columns: () => visibleColumns.get(),
    allColumns: () => everyColumn.get(),
    isColumnHidden: (id) => hiddenState.get().has(id),
    setColumnHidden,
    moveColumn,
    moveGroup,
    collapseGroup,
    expandGroup,
    isGroupCollapsed,
    onColumnResize,
    state: () => state.get(),
    apply,
  };
}

/**
 * The columns in the reader's order.
 *
 * A column the order does not name — one added since it was written — goes
 * directly after the column it follows in the caller's list, which is where
 * whoever added it put it. Placed in the caller's order, so a run of new
 * columns keeps its own order too; the first column of the list, if new, goes
 * first.
 */
function arrange<T>(
  definitions: readonly GridColumn<T>[],
  order: readonly string[],
): GridColumn<T>[] {
  const byId = new Map<string, GridColumn<T>>();
  for (const column of definitions) byId.set(column.id, column);

  const out: GridColumn<T>[] = [];
  const placed = new Set<string>();
  for (const id of order) {
    const column = byId.get(id);
    if (column === undefined || placed.has(id)) continue;
    placed.add(id);
    out.push(column);
  }
  if (placed.size === definitions.length) return out;

  for (let i = 0; i < definitions.length; i++) {
    const column = definitions[i]!;
    if (placed.has(column.id)) continue;
    // Already placed by now, whether it was in the order or new itself.
    const after = i === 0 ? -1 : out.indexOf(definitions[i - 1]!);
    out.splice(after + 1, 0, column);
    placed.add(column.id);
  }
  return out;
}

/**
 * Read a saved state against the columns there are now: a clean copy holding
 * only what those columns can take, or the reason there is none.
 *
 * The one reader of a state, for saving as much as for restoring. `state()`
 * goes through it too, which is what makes a saved state exactly what a
 * restore keeps: nothing is saved that `apply` would drop.
 */
function readState<T>(
  input: unknown,
  definitions: readonly GridColumn<T>[],
  onLostFilter?: (columnId: string, filter: unknown) => void,
): GridState | GridStateRefusal {
  if (!isRecord(input)) return NOT_A_STATE;
  const version = input.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return NOT_A_STATE;
  if (version > GRID_STATE_VERSION) return { applied: false, reason: 'newer-version', version };

  const byId = new Map<string, GridColumn<T>>();
  for (const column of definitions) byId.set(column.id, column);

  const columns: GridColumnState[] = [];
  const listed = new Set<string>();
  for (const entry of listOf(input.columns)) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    const column = byId.get(entry.id);
    if (column === undefined || listed.has(entry.id)) continue;
    listed.add(entry.id);
    // A column the reader cannot resize takes its declared width whatever the
    // state says: the only way a width could be saved for it is by hand, or
    // before the column was made fixed.
    const width = column.resizable === false ? undefined : wholeWidth(entry.width);
    // Version 1 had no pins: one in a version-1 state was put there by hand,
    // and the version says the reader pinned nothing.
    const pin = version >= 2 && Object.hasOwn(entry, 'pin') ? savedPin(entry.pin) : undefined;
    columns.push({
      id: entry.id,
      ...(width === undefined ? {} : { width }),
      ...(entry.hidden === true ? { hidden: true as const } : {}),
      ...(pin === undefined ? {} : { pin }),
    });
  }

  const sort: GridSort[] = [];
  const sorted = new Set<string>();
  for (const entry of listOf(input.sort)) {
    if (!isRecord(entry)) continue;
    const { columnId, direction } = entry;
    if (typeof columnId !== 'string' || !byId.has(columnId) || sorted.has(columnId)) continue;
    if (!isKey(DIRECTIONS, direction)) continue;
    sorted.add(columnId);
    sort.push({ columnId, direction });
  }

  // In the order of the caller's columns rather than the order the entries
  // came in, so the same filters always save as the same object.
  // Its own entries only, so a column whose id an object inherits — a
  // `constructor`, a `__proto__` — does not read what every object carries.
  const filters: [string, GridFilter][] = [];
  const saved = new Map(isRecord(input.filters) ? Object.entries(input.filters) : []);
  for (const column of definitions) {
    const raw = saved.get(column.id);
    const filter = jsonFilter(raw);
    if (filter !== null) filters.push([column.id, filter]);
    else onLostFilter?.(column.id, raw);
  }

  const { groupBy, collapsed } = readGrouping(input.groupBy, input.collapsed, byId);

  return {
    version: GRID_STATE_VERSION,
    columns,
    sort,
    filters: Object.fromEntries(filters),
    quickFilter: typeof input.quickFilter === 'string' ? input.quickFilter : '',
    groupBy,
    collapsed,
  };
}

/**
 * The levels of a saved grouping that name a column there is now, and the
 * paths of the groups shut under them.
 *
 * A shut group's path is its key at every level down to its own, so once a
 * level is dropped every path at it or below is read against the wrong column
 * — and could shut a group nobody shut. Those paths go, and their groups open,
 * as a group nobody touched does. With every level kept, every path is kept,
 * including those a deeper grouping left behind: the grouping itself keeps
 * them for when it is regrouped.
 */
function readGrouping(
  savedGroupBy: unknown,
  savedCollapsed: unknown,
  byId: ReadonlyMap<string, unknown>,
): { groupBy: string[]; collapsed: string[] } {
  // Not deduplicated: a column listed twice is two levels to the grouping — a
  // date by year and then by month, each mapped to its spec by position.
  const levels = listOf(savedGroupBy);
  const groupBy = levels.filter((id): id is string => typeof id === 'string' && byId.has(id));
  let intact = 0;
  while (intact < groupBy.length && levels[intact] === groupBy[intact]) intact++;
  const kept = (path: string): boolean =>
    intact === levels.length || path.split(GROUP_PATH_SEPARATOR).length <= intact;

  // Sorted, so a set that was filled in another order saves the same. By code
  // unit, not by locale: these are identifiers, and no reader sees the order.
  const collapsed = [...new Set(listOf(savedCollapsed))]
    .filter((path): path is string => typeof path === 'string' && kept(path))
    .sort();
  return { groupBy, collapsed };
}

/**
 * A clean copy of a filter that JSON carries exactly, or null.
 *
 * Only the fields the filter module reads, so nothing a caller hung on a filter
 * object rides along into storage. Null for anything malformed — an unknown
 * type or operator is a filter this code cannot apply — and for anything JSON
 * would change on the way through: `NaN` and the infinities come back as
 * `null`, and a `Date` in a set filter comes back as a string that no longer
 * equals the value it stood for.
 */
function jsonFilter(value: unknown): GridFilter | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case 'text': {
      const { operator, caseSensitive } = value;
      if (typeof value.value !== 'string') return null;
      if (operator !== undefined && !isKey(TEXT_OPERATORS, operator)) return null;
      if (caseSensitive !== undefined && typeof caseSensitive !== 'boolean') return null;
      return {
        type: 'text',
        value: value.value,
        ...(operator === undefined ? {} : { operator }),
        ...(caseSensitive === undefined ? {} : { caseSensitive }),
      };
    }
    case 'number': {
      const { operator, to } = value;
      if (!isFiniteNumber(value.value)) return null;
      if (operator !== undefined && !isKey(NUMBER_OPERATORS, operator)) return null;
      // The bound of a range open at the top — an infinity, or the null JSON
      // makes of one — is one JSON cannot carry. Saved without it, the range
      // would come back as no filter at all.
      if (operator === 'between' && to !== undefined && !isFiniteNumber(to)) return null;
      return {
        type: 'number',
        value: value.value,
        ...(operator === undefined ? {} : { operator }),
        // Kept only as a number. A `between` without one is an unfinished
        // filter, which is what it was — the filter module compiles neither.
        ...(isFiniteNumber(to) ? { to } : {}),
      };
    }
    case 'set': {
      const { values } = value;
      if (!Array.isArray(values) || !values.every(isJsonScalar)) return null;
      return { type: 'set', values: [...values] };
    }
  }
  return null;
}

/** The filters already warned about, since the state is recomputed for every change to it. */
const warned = new WeakSet<object>();

/**
 * Says, in development, that a filter the reader set was left out of the
 * saved state because JSON cannot carry what it holds.
 *
 * Only for a filter that filters something: one that does not — a number
 * filter with no number in it yet — loses nothing by being left out, and is
 * the state a filter box is in on every keystroke. Once per filter object.
 */
function warnLostFilter(columnId: string, filter: unknown): void {
  if (!__VOLT_DEV__ || typeof console === 'undefined') return;
  if (!isRecord(filter) || warned.has(filter)) return;
  warned.add(filter);
  // Asked only whether it compiles, so how text is folded does not matter. It
  // came out of the filters signal, so it is a filter the grid compiles too.
  if (compileFilter(filter as unknown as GridFilter, (text) => text) === null) return;
  console.warn(
    `[volt] createGridState: the filter on column "${columnId}" holds a value JSON cannot carry ` +
      '— NaN, an infinity, or a set value that is not a string, a finite number, a boolean or null — ' +
      'so it is left out of the saved state. Filter on a value JSON can hold: a timestamp rather ' +
      'than a Date, a string rather than a bigint.',
  );
}

/** Says, in development, why a state was not applied. */
function refuse(refusal: GridStateRefusal, input: unknown): void {
  if (!__VOLT_DEV__ || typeof console === 'undefined') return;
  if (refusal.reason === 'newer-version') {
    console.warn(
      `[volt] createGridState: this state was saved as version ${refusal.version}, and this code ` +
        `reads up to version ${GRID_STATE_VERSION}, so none of it was applied. Restoring the parts ` +
        'this version understands would leave the grid in an arrangement nobody made.',
    );
    return;
  }
  // Nothing saved yet is the first visit, not a mistake.
  if (input === null || input === undefined) return;
  console.warn(
    '[volt] createGridState: apply was handed something that is not a saved grid state — ' +
      'it has to be an object with a whole-number `version`, as `state()` returns — so nothing ' +
      'was applied.',
  );
}

/**
 * The pin a reader gave a column, or undefined where the pin is the page's:
 * none made, or one the page's own signal started with. Saved only where it is
 * the reader's, so a page that pins differently in a later release is heard by
 * every reader who never changed it.
 */
function readersPin(
  id: string,
  pins: ReadonlyMap<string, GridColumnPin>,
  page: ReadonlyMap<string, GridColumnPin>,
): GridColumnPin | undefined {
  if (!pins.has(id)) return undefined;
  const pin = asPin(pins.get(id));
  return page.has(id) && asPin(page.get(id)) === pin ? undefined : pin;
}

/** A saved pin: an edge, or null for a pin the reader took off. Anything else is no pin saved. */
function savedPin(value: unknown): GridColumnPin | undefined {
  return value === 'start' || value === 'end' || value === null ? value : undefined;
}

/**
 * The region a column dropped at `to` among the others lands in: the region
 * of the columns either side where they agree, and on a boundary — or across
 * an empty region between two others — the nearest to the one it came from.
 * Before the first column and after the last there is only the one side.
 */
function regionAt<T>(
  others: readonly GridColumn<T>[],
  to: number,
  was: GridColumnPin,
  pins: ReadonlyMap<string, GridColumnPin>,
): GridColumnPin {
  const low = to === 0 ? 0 : pinRegion(pinOf(others[to - 1]!, pins));
  const high = to >= others.length ? 2 : pinRegion(pinOf(others[to]!, pins));
  const region = Math.min(Math.max(pinRegion(was), low), high);
  return region === 0 ? 'start' : region === 2 ? 'end' : null;
}

/**
 * The place among the columns not being moved, nearest to `to`, that keeps
 * every group together: beside a column of the innermost of the groups
 * `inside` names that holds a column left behind, and never between two
 * columns of a group the moved ones are not in. Where two places are as
 * near, the one on the side the columns came from.
 *
 * Beside one in the region the columns land in, as `regionAt` decides it for
 * `was`, their pin, and not merely between the group's first column and its
 * last: a pinned edge parts a group whatever the order, so a group a pin has
 * parted has a gap between its parts — straight after the pinned columns,
 * among other groups' — where a column dropped would be a part of its own.
 * Where they came from always does: a move back there parts nothing that was
 * not parted already.
 *
 * `moved` are the places in `all` of the columns being moved, in order, and
 * the first of them is where they came from: every column before it stays.
 * With no group named anywhere, every place will do and `to` is the answer.
 */
function keptTogether<T>(
  all: readonly GridColumn<T>[],
  moved: readonly number[],
  to: number,
  inside: readonly GridColumnGroup[],
  pins: ReadonlyMap<string, GridColumnPin>,
  was: GridColumnPin,
): number {
  const from = moved[0]!;
  const others = all.filter((_, i) => !moved.includes(i));
  const paths = others.map(columnGroupPath);
  if (inside.length === 0 && paths.every((path) => path.length === 0)) return to;

  const ids = new Set(inside.map((group) => group.id));
  let keeper: string | null = null;
  for (let level = inside.length - 1; level >= 0 && keeper === null; level--) {
    const id = inside[level]!.id;
    if (paths.some((path) => path.some((group) => group.id === id))) keeper = id;
  }
  const besideKeeper = (place: number): boolean => {
    if (keeper === null) return true;
    const region = regionAt(others, place, was, pins);
    const beside = (i: number): boolean =>
      i >= 0 &&
      i < others.length &&
      pinOf(others[i]!, pins) === region &&
      paths[i]!.some((group) => group.id === keeper);
    return beside(place - 1) || beside(place);
  };
  const fits = (place: number): boolean => {
    if (!besideKeeper(place)) return false;
    if (place === 0 || place === paths.length) return true;
    const left = paths[place - 1]!;
    const right = paths[place]!;
    // The groups both neighbours sit in are the ones a column put between
    // them would part, unless it sits in them too.
    for (let level = 0; level < Math.min(left.length, right.length); level++) {
      if (left[level]!.id !== right[level]!.id) break;
      if (!ids.has(left[level]!.id)) return false;
    }
    return true;
  };

  // Where they came from always does, whether or not it fits.
  let best = from;
  for (let place = 0; place <= paths.length; place++) {
    if (!fits(place)) continue;
    const nearer = Math.abs(place - to) - Math.abs(best - to);
    if (nearer < 0 || (nearer === 0 && Math.abs(place - from) < Math.abs(best - from))) best = place;
  }
  return best;
}

function samePins(
  a: ReadonlyMap<string, GridColumnPin>,
  b: ReadonlyMap<string, GridColumnPin>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, pin] of a) if (!b.has(id) || b.get(id) !== pin) return false;
  return true;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : EMPTY_IDS;
}

function isKey<K extends string>(record: Readonly<Record<K, true>>, value: unknown): value is K {
  return typeof value === 'string' && Object.hasOwn(record, value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A width in whole pixels, or undefined for anything that is not positive once
 * it is one. Rounded before it is judged, because a width that rounds to zero
 * would reach the grid as a zero — shown at the column's minimum — while the
 * state, reading it back, said no width had been chosen.
 */
function wholeWidth(value: unknown): number | undefined {
  if (!isFiniteNumber(value)) return undefined;
  const whole = Math.round(value);
  return whole > 0 ? whole : undefined;
}

function isJsonScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    isFiniteNumber(value)
  );
}

/**
 * Hands back the value it was last given wherever the new one says the same.
 *
 * A computed that returns the object it returned before is a computed that did
 * not change: nothing downstream is woken, and whoever compares by identity —
 * the grid's own memos, a grouping's lifted columns, a caller asking whether
 * the view is dirty — sees the value it already had. An `equals` option would
 * stop the notification and still hand the new copy to the next reader.
 */
function keeper<V>(same: (a: V, b: V) => boolean): (next: V) => V {
  let last: { value: V } | null = null;
  return (next) => {
    if (last !== null && same(last.value, next)) return last.value;
    last = { value: next };
    return next;
  };
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameKeySet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

function sameFilters(
  a: ReadonlyMap<string, GridFilter>,
  b: ReadonlyMap<string, GridFilter>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, filter] of a) if (!sameJson(filter, b.get(id))) return false;
  return true;
}

/**
 * Whether two JSON values say the same thing.
 *
 * Structural, because a saved state is rebuilt whenever anything it reads
 * changes and is only worth telling anyone about when the result differs.
 */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameJson(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(right, key) || !sameJson(left[key], right[key])) return false;
  }
  return true;
}
