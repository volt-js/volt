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
 * visibility and widths, the sort, the filters and the quick filter, the
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
import type { Grid, GridColumn } from './grid.js';
import { sameSort, type GridSort, type GridSortDirection } from './sort.js';

const { untrack } = Signal.subtle;

/**
 * The version of the saved state this code writes, and the newest it reads.
 *
 * Raised whenever the saved state gains something older code could not honour
 * — a pinned side, say — so that older code refuses it rather than restoring
 * the half it understands.
 */
export const GRID_STATE_VERSION = 1;

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
   * with any restored width in place. Hand it to the grid's `columns`, or to
   * the grouping's.
   *
   * The same array for as long as the arrangement is the same — a sort, a
   * filter or a resize hands the grid no new list — and, with nothing
   * arranged, the caller's own array rather than a copy of it. A column
   * carrying a restored width is a copy of the caller's with that `width`, so
   * a column is known by its `id` and not by identity.
   */
  columns(): readonly GridColumn<T>[];
  /** Every column in the reader's order, hidden ones included: what a column chooser lists. */
  allColumns(): readonly GridColumn<T>[];
  /** Whether a column is hidden. */
  isColumnHidden(id: string): boolean;
  /** Hide or show a column. A column not in `columns` is ignored. */
  setColumnHidden(id: string, hidden: boolean): void;
  /**
   * Move a column to a place in `allColumns()`, clamped to the ends. Counted
   * among every column rather than the visible ones, so a hidden column keeps
   * the place it had.
   */
  moveColumn(id: string, index: number): void;
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
   * from outside. What the grid does after any sort or filter it still does:
   * the cursor follows its row, and a cell range is dropped, each saying so
   * through its own callback. Every piece the state leaves out goes back to
   * what its signal held when this layer was created, so
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
   * One copy of each column carrying a restored width, reused while the width
   * holds, so that the arranged list can be compared by identity.
   */
  const baked = new WeakMap<GridColumn<T>, GridColumn<T>>();
  const withWidth = (column: GridColumn<T>, width: number | undefined): GridColumn<T> => {
    if (width === undefined || width === column.width) return column;
    const cached = baked.get(column);
    if (cached !== undefined && cached.width === width) return cached;
    const copy = { ...column, width };
    baked.set(column, copy);
    return copy;
  };

  const keepAll = keeper(sameItems<GridColumn<T>>);
  const everyColumn = new Signal.Computed<readonly GridColumn<T>[]>(() => {
    const definitions = options.columns();
    const restored = restoredWidths.get();
    const arranged = arrange(definitions, orderState.get()).map((column) =>
      withWidth(column, restored.get(column.id)),
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
      const columns = everyColumn.get().map((column): GridColumnState => {
        const width = current.get(column.id);
        return {
          id: column.id,
          ...(width === undefined ? {} : { width }),
          ...(hidden.has(column.id) ? { hidden: true as const } : {}),
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
    const ids = untrack(() => everyColumn.get()).map((column) => column.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    const to = Math.min(Math.max(Math.trunc(index), 0), ids.length - 1);
    if (from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    orderState.set(ids);
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
    columns.push({
      id: entry.id,
      ...(width === undefined ? {} : { width }),
      ...(entry.hidden === true ? { hidden: true as const } : {}),
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
