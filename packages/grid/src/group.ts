/**
 * Row grouping, as one more derived view over rows the caller still owns.
 *
 * A grouped grid is not a grid of groups. It is the same virtualized grid over
 * a *longer* collection: the group headers are rows in it, sitting between the
 * data rows they describe, so one window and one row height cover both and a
 * grid grouped into four thousand departments still renders twelve elements.
 * A separate list of headers rendered outside the scroller would have to be
 * kept in step with a window it is not part of, and would stop being a grid
 * the moment a group grew past the viewport.
 *
 *   class Staff {
 *     sort = new Signal.State<readonly GridSort[]>([]);
 *     grouping = createGrouping<Person>({
 *       rows: () => this.people.get(),
 *       columns: () => COLUMNS,
 *       groupBy: () => ['department'],
 *       aggregations: () => [{ columnId: 'salary', kind: 'sum' }],
 *       sort: this.sort,
 *     });
 *     table = createGrid<GridGroupedRow<Person>>({
 *       rows: () => this.grouping.rows(),
 *       columns: () => this.grouping.columns(),
 *       getRowKey: this.grouping.rowKey,
 *       sort: this.sort,
 *       // ...the elements, as an ungrouped grid takes them
 *     });
 *   }
 *
 * **This sits above `createGrid`, not inside it**, which is what decides the
 * shape of everything below. The grid's own filter runs over whatever array it
 * is handed, and the array it is handed here already has group headers in it —
 * a filter that dropped a header would leave its rows orphaned, and one that
 * dropped rows inside a collapsed group would never see them at all. So
 * filtering happens *before* grouping and lives here, over the caller's own
 * rows, which is also the only order in which an aggregate can be over the rows
 * the reader can actually see — and the columns handed to the grid are all
 * unfilterable, so the grid refuses a filter rather than run one.
 *
 * Sorting is the exception, and deliberately: the affordance for it — the
 * header cell, its `aria-sort`, the click that cycles it, the sentence it
 * announces — belongs to the grid, and duplicating it here would be a second
 * implementation of the thing the reader is looking at. So the caller hands the
 * *same* `sort` signal to both. The grid then sorts a list that is already
 * grouped, which would scramble it — and does not, because `columns()` below
 * gives every column a comparator that returns zero. `Array#sort` is stable, so
 * the grid's sort becomes a copy that changes nothing, `aria-sort` and the
 * announcement keep working, and the ordering the reader asked for is applied
 * here, before the rows are grouped at all.
 *
 * **The counting attributes stay honest by construction.** `aria-rowcount` is
 * the length of the collection the grid was given, and the collection this
 * hands over is the flattened view *after* collapsing: a collapsed group's rows
 * are not in it, so they are not counted. Nothing has to remember to subtract
 * them.
 *
 * **A cell still owns its own binding.** The flattened rows are cached by key
 * and handed back as the same objects whenever the row under a key has not
 * moved, exactly as `createGrid` caches its rendered row views and for exactly
 * the same reason: `each` writes the item into the row's signal, and a signal
 * set to the value it already holds notifies nobody. So opening a group reads
 * the rows that appeared and nothing above them, and collapsing one below the
 * window costs the window nothing at all. What it does cost is the rows *after*
 * the group, which have moved and are re-read — the same price `createGrid`
 * documents for a row a sort moved, and for the same reason: a row's place in
 * the collection is part of what its cells are rendered from.
 *
 * A value changing under an aggregate rebuilds the group headers whose
 * aggregate moved and no data cell but its own. Group nodes are reused on the
 * same terms — same rows, same count, same aggregates — so a change inside one
 * group leaves every other group's header alone.
 */

import { Signal } from '@voltdev/core';
import { announce, useLocale } from '@voltdev/primitives';
import {
  GRID_CELL_ATTRIBUTE,
  describeFilterCount,
  quickFilterValues,
  type GridColumn,
  type GridProps,
} from './grid.js';
import {
  asNumber,
  asText,
  compileFilter,
  matchesQuickFilter,
  quickFilterTerms,
  type GridFilter,
} from './filter.js';
import { sortRows, type GridSort, type GridSortTerm } from './sort.js';
import type { GridRowKey } from './selection.js';

const { untrack } = Signal.subtle;

/** Marks a rendered group header row, carrying the group's path. */
export const GRID_GROUP_ATTRIBUTE = 'data-volt-grid-group';

/**
 * What joins a group's key to its parent's, and marks a group header's row key
 * apart from the keys the caller gave their own rows.
 *
 * A unit separator rather than a slash or a dot, because a path is built out of
 * data — department names contain both of those and no control character at
 * all, so nothing a reader can type can forge a path that is not theirs.
 */
const SEPARATOR = '\u001f';

const EMPTY_NODES: readonly GridGroupNode<never>[] = [];
const EMPTY_SORT: readonly GridSort[] = [];
const EMPTY_FILTERS: ReadonlyMap<string, GridFilter> = new Map();
const EMPTY_COLLAPSED: ReadonlySet<string> = new Set<string>();
const TREEGRID_PROPS: GridProps = { role: 'treegrid' };
const NO_PROPS: GridProps = {};

/** The aggregates that need no function of the caller's. */
export type GridAggregateKind = 'count' | 'sum' | 'min' | 'max' | 'average';

/**
 * One number under a group header.
 *
 * `value` defaults to the column's own accessor, and is worth giving wherever
 * the cell shows something other than the thing being totalled — a currency
 * rendered "$1,000" sums to nothing as text.
 */
export interface GridAggregation<T> {
  /** The column the result belongs under. */
  readonly columnId: string;
  /** A named aggregate, or a function over the group's rows. */
  readonly kind: GridAggregateKind | ((rows: readonly T[]) => unknown);
  readonly value?: (row: T) => unknown;
}

/**
 * One level of grouping.
 *
 * A bare column id is the common case and is accepted in its place. `value`
 * defaults to the column's accessor, and `label` to the key's own text.
 */
export interface GridGroupSpec<T> {
  readonly columnId: string;
  readonly value?: (row: T) => unknown;
  readonly label?: (value: unknown, rows: readonly T[]) => string;
}

/** One group, and every group nested inside it. */
export interface GridGroupNode<T> {
  /**
   * What identifies this group among all of them — its key joined to its
   * parents'. Expansion is held by path, so it survives a re-sort and a filter
   * the way a row selection held by key does.
   */
  readonly path: string;
  readonly columnId: string;
  /** The key value itself, before it was turned into text. */
  readonly value: unknown;
  readonly label: string;
  /** Zero for an outermost group. */
  readonly depth: number;
  /** Every leaf row under this group, filtered and in order. */
  readonly rows: readonly T[];
  readonly count: number;
  /** The aggregates, by column id. */
  readonly aggregates: ReadonlyMap<string, unknown>;
  readonly children: readonly GridGroupNode<T>[];
}

/**
 * A row of the flattened collection: either a group header or one of the
 * caller's rows.
 *
 * A discriminated union rather than a row with an optional node, because every
 * consumer of it has to branch anyway — a group header renders a twisty and a
 * label where a data row renders a value — and an optional field makes that
 * branch a runtime check the types do not enforce.
 */
export type GridGroupedRow<T> =
  | {
      readonly kind: 'group';
      readonly key: GridRowKey;
      readonly node: GridGroupNode<T>;
      readonly depth: number;
    }
  | {
      readonly kind: 'data';
      readonly key: GridRowKey;
      readonly item: T;
      /** How many groups this row sits inside. */
      readonly depth: number;
    };

export interface GridGroupingOptions<T> {
  /** The rows, in order — the caller's own array, never written to. */
  rows: () => readonly T[];
  /** The columns, in order. The same list the grid is given. */
  columns: () => readonly GridColumn<T>[];
  /** The levels of grouping, outermost first. Empty means no grouping at all. */
  groupBy: () => readonly (string | GridGroupSpec<T>)[];
  /** What to compute under each group header. */
  aggregations?: () => readonly GridAggregation<T>[];

  /**
   * What identifies one of the caller's rows, for keyed rendering — and, used
   * as it is, what the grid's row selection holds for that row.
   *
   * Defaults to the row's place in the grouped collection, counted as though
   * every group were open — so collapsing a group re-keys nothing below it.
   * It is still the footgun `createGrid` documents: a sort or a filter moves
   * rows, and a row identified by where it is changes identity when it moves.
   */
  getRowKey?: (row: T, index: number) => GridRowKey;

  /**
   * The groups the reader has collapsed, by path. Everything else is expanded:
   * a group that has never been touched shows its rows.
   *
   * Supply a signal to drive expansion from outside — a saved view, a URL, or
   * a server that already knows which department the reader was looking at.
   */
  collapsed?: Signal.State<ReadonlySet<string>>;
  onCollapsedChange?: (collapsed: ReadonlySet<string>) => void;

  /**
   * The sort, which the grid writes and this reads. Hand the same signal to
   * both: the header is the grid's, and the ordering is applied here. Without
   * one there is nothing to order by, and `columns()` comes back unsortable.
   */
  sort?: Signal.State<readonly GridSort[]>;

  /** The per-column filters, by column id. These belong here, not to the grid. */
  filters?: Signal.State<ReadonlyMap<string, GridFilter>>;
  /** One string searched across every column that can be filtered. */
  quickFilter?: Signal.State<string>;
  onFilterChange?: (filters: ReadonlyMap<string, GridFilter>, quickFilter: string) => void;
  /**
   * The sentence announced when a filter changes what is on screen: how many
   * of the caller's rows it left, headings not counted.
   *
   * The grid's own announcement for the same thing, said here because the
   * filtering happens here — the grid is handed rows already filtered, and has
   * nothing to announce. The default is the grid's too: the locale's
   * `gridRowsLeft` or `gridAllRows`, then English.
   */
  filterAnnouncement?: (shown: number, total: number) => string;
}

export interface GridGrouping<T> {
  /** The flattened collection — group headers and rows — for the grid to render. */
  rows(): readonly GridGroupedRow<T>[];
  /** The groups themselves, nested. */
  tree(): readonly GridGroupNode<T>[];
  /** How many of the caller's rows the filter left, headers not counted. */
  filteredRowCount(): number;
  sourceRowCount(): number;

  /**
   * The caller's columns, lifted to the flattened row type.
   *
   * Also what makes sharing one `sort` signal with the grid safe: every column
   * comes back with a comparator that returns zero, so the grid's own sort is a
   * stable copy and this module's is the one that orders anything — and with
   * no `sort` signal to share, every column comes back `sortable: false`.
   * Every column comes back `filterable: false` too, so the grid refuses the
   * filter that belongs here.
   */
  columns(): readonly GridColumn<GridGroupedRow<T>>[];
  /** Pass as the grid's `getRowKey`. */
  rowKey(row: GridGroupedRow<T>): GridRowKey;
  /** A group header's text, for the cell that renders it. */
  label(row: GridGroupedRow<T>): string;

  isExpanded(path: string): boolean;
  expand(path: string): void;
  collapse(path: string): void;
  toggle(path: string): void;
  expandAll(): void;
  /** Collapses every group that exists now. Groups that appear later are open. */
  collapseAll(): void;

  filters(): ReadonlyMap<string, GridFilter>;
  setFilter(columnId: string, filter: GridFilter | null): void;
  clearFilters(): void;
  quickFilter(): string;
  setQuickFilter(text: string): void;

  /**
   * Spread onto the grid element, after the grid's own `gridProps`.
   *
   * A grouped grid is a `treegrid`: that is the role ARIA defines row levels
   * and expansion for, and the grid, which does not know it is grouped, says
   * `grid`. Ungrouped, this adds nothing and the grid's own role stands.
   */
  gridProps(): GridProps;
  /** Spread onto the row, after the grid's own `rowProps`. */
  rowProps(row: GridGroupedRow<T>): GridProps;
  /** Toggles the group clicked. Wire it before the grid's `onCellClick`. */
  onGroupClick(event: MouseEvent): boolean;
  /**
   * Expands and collapses from the keyboard. Wire it before the grid's own
   * `onKeyDown`, which owns every key this leaves alone.
   */
  onKeyDown(event: KeyboardEvent): boolean;
}

/** A group spec with its accessors resolved against the column it names. */
interface ResolvedSpec<T> {
  readonly columnId: string;
  readonly value: (row: T) => unknown;
  readonly label: (value: unknown, rows: readonly T[]) => string;
}

/** An aggregation with its accessor resolved and its kind reduced to a function. */
interface ResolvedAggregation<T> {
  readonly columnId: string;
  readonly compute: (rows: readonly T[]) => unknown;
}

/** A column filter, resolved to an accessor and a predicate. */
interface CompiledFilter<T> {
  readonly value: (row: T) => unknown;
  readonly test: (value: unknown) => boolean;
}

export function createGrouping<T>(options: GridGroupingOptions<T>): GridGrouping<T> {
  // The places a grid has to know a locale: ordering text, folding it for a
  // filter, and saying what the filter left. The first two are wrong in the
  // runtime's own locale rather than the application's — Swedish sorts
  // o-umlaut after z, and Turkish has a dotless i the invariant fold runs
  // together with the dotted one.
  const locale = useLocale();
  const compareText = (a: string, b: string): number => locale.compare(a, b);
  const fold = (text: string): string => text.toLocaleLowerCase(locale.code());

  const sortState = options.sort ?? new Signal.State<readonly GridSort[]>(EMPTY_SORT);
  const filterState =
    options.filters ?? new Signal.State<ReadonlyMap<string, GridFilter>>(EMPTY_FILTERS);
  const quickState = options.quickFilter ?? new Signal.State('');
  const collapsedState =
    options.collapsed ?? new Signal.State<ReadonlySet<string>>(EMPTY_COLLAPSED);

  const columnList = (): readonly GridColumn<T>[] => options.columns();

  const specs = new Signal.Computed<readonly ResolvedSpec<T>[]>(() => {
    const list = columnList();
    const resolved: ResolvedSpec<T>[] = [];
    for (const entry of options.groupBy()) {
      const spec: GridGroupSpec<T> = typeof entry === 'string' ? { columnId: entry } : entry;
      const column = list.find((candidate) => candidate.id === spec.columnId);
      const value = spec.value ?? column?.value;
      // A saved view outlives the column list it was saved against, and a level
      // naming a column that is gone is better dropped than thrown over.
      if (value === undefined) continue;
      resolved.push({
        columnId: spec.columnId,
        value,
        label: spec.label ?? ((key) => asText(key)),
      });
    }
    return resolved;
  });

  const aggregations = new Signal.Computed<readonly ResolvedAggregation<T>[]>(() => {
    const list = columnList();
    const resolved: ResolvedAggregation<T>[] = [];
    for (const entry of options.aggregations?.() ?? []) {
      if (typeof entry.kind === 'function') {
        const custom = entry.kind;
        resolved.push({ columnId: entry.columnId, compute: (rows) => custom(rows) });
        continue;
      }
      // The one aggregate that reads no value at all, and so subscribes to
      // nothing: a group's size is a property of the grouping, not of a column.
      if (entry.kind === 'count') {
        resolved.push({ columnId: entry.columnId, compute: (rows) => rows.length });
        continue;
      }
      const value = entry.value ?? list.find((column) => column.id === entry.columnId)?.value;
      if (value === undefined) continue;
      const kind = entry.kind;
      resolved.push({ columnId: entry.columnId, compute: (rows) => reduce(rows, value, kind) });
    }
    return resolved;
  });

  /**
   * One compiled predicate per column whose filter actually filters something.
   *
   * Compiled here rather than in the row loop for the reason `createGrid`
   * compiles its own there: a text filter would otherwise fold the same needle
   * once per row, and a filter the reader has started but not finished would
   * become a predicate matching everything rather than no filter at all.
   */
  const columnFilters = new Signal.Computed<readonly CompiledFilter<T>[]>(() => {
    const map = filterState.get();
    const compiled: CompiledFilter<T>[] = [];
    if (map.size === 0) return compiled;
    for (const column of columnList()) {
      const filter = map.get(column.id);
      // A column the caller made unfilterable is as unfilterable here as it
      // would be on an ungrouped grid.
      if (filter === undefined || column.filterable === false) continue;
      const test = compileFilter(filter, fold);
      if (test === null) continue;
      compiled.push({ value: column.filterValue ?? column.value, test });
    }
    return compiled;
  });

  const quickTerms = new Signal.Computed<readonly string[]>(() =>
    quickFilterTerms(quickState.get(), fold),
  );

  const sortTerms = new Signal.Computed<readonly GridSortTerm<T>[]>(() => {
    const list = columnList();
    const terms: GridSortTerm<T>[] = [];
    for (const entry of sortState.get()) {
      const column = list.find((candidate) => candidate.id === entry.columnId);
      if (!column || column.sortable === false) continue;
      terms.push({
        direction: entry.direction,
        value: column.sortValue ?? column.value,
        compare: column.compare,
      });
    }
    return terms;
  });

  /**
   * The caller's rows, filtered and ordered, and still the caller's rows.
   *
   * The same contract `createGrid` keeps one level up: the source array is read
   * and never written, the objects in the result are the caller's own, and with
   * nothing to filter or sort this is the source array itself by identity.
   */
  const presented = new Signal.Computed<readonly T[]>(() => {
    const source = options.rows();
    const filters = columnFilters.get();
    const terms = quickTerms.get();
    // Resolved outside the loop: the quick filter searches every column that
    // can be filtered, and looking the accessors up per row would be most of
    // what it costs.
    const quick = terms.length > 0 ? quickFilterValues(columnList()) : null;

    let rows = source;
    if (filters.length > 0 || quick !== null) {
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

  /**
   * The nodes of the last tree, by path — so a group nothing has changed about
   * is handed back as the identical object.
   *
   * The same trick, and the same reason, as the row-view cache in `createGrid`.
   * An aggregate subscribes to the values it totals, so a single cell changing
   * rebuilds this whole tree; without the reuse below, every group header on
   * screen would re-render because of a number in one of them.
   */
  let nodeCache = new Map<string, GridGroupNode<T>>();

  const tree = new Signal.Computed<readonly GridGroupNode<T>[]>(() => {
    const levels = specs.get();
    const rows = presented.get();
    if (levels.length === 0) return EMPTY_NODES as readonly GridGroupNode<T>[];

    const aggregates = aggregations.get();
    const previous = nodeCache;
    const next = new Map<string, GridGroupNode<T>>();

    const build = (
      source: readonly T[],
      depth: number,
      prefix: string,
    ): readonly GridGroupNode<T>[] => {
      const spec = levels[depth]!;
      // Groups come out in the order their first row does, which is what makes
      // sorting by the grouped column order the groups as well.
      const order: string[] = [];
      const buckets = new Map<string, { value: unknown; rows: T[] }>();
      for (const row of source) {
        const value = spec.value(row);
        // Grouped by the key's *text*: a path is a string a consumer stores in
        // a URL or a saved view, and two keys that render the same are one
        // group to the reader looking at them.
        const id = asText(value);
        let bucket = buckets.get(id);
        if (bucket === undefined) {
          bucket = { value, rows: [] };
          buckets.set(id, bucket);
          order.push(id);
        }
        bucket.rows.push(row);
      }

      const nodes: GridGroupNode<T>[] = [];
      for (const id of order) {
        const bucket = buckets.get(id)!;
        // By depth rather than by whether the prefix is empty: a parent whose
        // key is blank has an empty path, and a child joined to it without the
        // separator would take the path of a top-level group of the same name.
        const path = depth === 0 ? id : `${prefix}${SEPARATOR}${id}`;
        const children =
          depth + 1 < levels.length
            ? build(bucket.rows, depth + 1, path)
            : (EMPTY_NODES as readonly GridGroupNode<T>[]);

        const totals = new Map<string, unknown>();
        for (const aggregate of aggregates) {
          totals.set(aggregate.columnId, aggregate.compute(bucket.rows));
        }

        const built: GridGroupNode<T> = {
          path,
          columnId: spec.columnId,
          value: bucket.value,
          label: spec.label(bucket.value, bucket.rows),
          depth,
          rows: bucket.rows,
          count: bucket.rows.length,
          aggregates: totals,
          children,
        };
        const before = previous.get(path);
        const node = before !== undefined && sameNode(before, built) ? before : built;
        next.set(path, node);
        nodes.push(node);
      }
      return nodes;
    };

    const built = build(rows, 0, '');
    nodeCache = next;
    return built;
  });

  const isExpanded = (path: string): boolean => !collapsedState.get().has(path);

  /**
   * The flattened collection, which is what the grid is actually given.
   *
   * Cached by key for the reason the tree is: `each` writes the item into a
   * row's signal, and handing back the identical object for a row that has not
   * moved sets that signal to the value it already holds. A fresh wrapper per
   * pass would be indistinguishable in the DOM and would re-read every cell on
   * screen every time any group was opened.
   */
  let rowCache = new Map<GridRowKey, GridGroupedRow<T>>();

  const flat = new Signal.Computed<readonly GridGroupedRow<T>[]>(() => {
    const nodes = tree.get();
    const rows = presented.get();
    const collapsed = collapsedState.get();
    const previous = rowCache;
    const next = new Map<GridRowKey, GridGroupedRow<T>>();
    const out: GridGroupedRow<T>[] = [];

    // Counted across the whole collection rather than per group, so the default
    // key of a row is its place in the data and not its place under a heading.
    let ordinal = 0;
    // The caller's own key, as it is: the grid selects rows by it, and a
    // selection is only any use to the caller if it holds the ids they know.
    // The group headers share this key space and are the ones kept apart, by a
    // prefix no key a caller wrote begins with.
    const keyOf = (item: T): GridRowKey => {
      const key = options.getRowKey?.(item, ordinal) ?? ordinal;
      ordinal += 1;
      return key;
    };

    const pushData = (item: T, depth: number): void => {
      const key = keyOf(item);
      const cached = previous.get(key);
      const row: GridGroupedRow<T> =
        cached !== undefined &&
        cached.kind === 'data' &&
        cached.item === item &&
        cached.depth === depth
          ? cached
          : { kind: 'data', key, item, depth };
      next.set(key, row);
      out.push(row);
    };

    const walk = (list: readonly GridGroupNode<T>[]): void => {
      for (const node of list) {
        const key = `g${SEPARATOR}${node.path}`;
        const cached = previous.get(key);
        const header: GridGroupedRow<T> =
          cached !== undefined && cached.kind === 'group' && cached.node === node
            ? cached
            : { kind: 'group', key, node, depth: node.depth };
        next.set(key, header);
        out.push(header);

        // A collapsed group's rows are not in the collection, which is the
        // whole reason `aria-rowcount` comes out right without anyone
        // subtracting anything. Their ordinals are still counted, so the
        // default key of every row below does not change when a group closes.
        if (collapsed.has(node.path)) {
          ordinal += node.count;
          continue;
        }
        if (node.children.length > 0) walk(node.children);
        else for (const item of node.rows) pushData(item, node.depth + 1);
      }
    };

    if (nodes.length === 0) {
      // Not grouped at all: still wrapped, so a consumer's template does not
      // have to be written twice for the two shapes.
      for (const item of rows) pushData(item, 0);
    } else {
      walk(nodes);
    }

    rowCache = next;
    return out;
  });

  /**
   * The caller's columns, lifted onto the flattened row.
   *
   * A group header shows the aggregate for the column it is under, if there is
   * one, and nothing where there is not — the label belongs to whichever cell
   * the consumer decides renders it, which is theirs to choose and not a thing
   * a column accessor can know.
   *
   * Every lifted column carries `compare: () => 0`. That is what lets one sort
   * signal drive the grid's header and this module's ordering at once: the grid
   * still cycles the column, still writes `aria-sort`, still announces the
   * order — and its own sort of the already-grouped list becomes a stable copy
   * that moves nothing.
   */
  let liftedFrom: readonly GridColumn<T>[] | null = null;
  let lifted: readonly GridColumn<GridGroupedRow<T>>[] = [];
  const columns = (): readonly GridColumn<GridGroupedRow<T>>[] => {
    const list = columnList();
    // Held by identity, because the grid reads this list once per column every
    // time it rebuilds its column geometry, and again from each thing it
    // derives from the columns: a fresh list per read would be a whole lifted
    // list allocated per column, per rebuild.
    if (liftedFrom === list) return lifted;
    liftedFrom = list;
    lifted = list.map((column) => ({
      ...column,
      value: (row: GridGroupedRow<T>) =>
        row.kind === 'group' ? row.node.aggregates.get(column.id) : column.value(row.item),
      // Both belong to this module now, and a grid holding them as well would
      // filter and order the flattened list a second time.
      sortValue: undefined,
      filterValue: undefined,
      compare: () => 0,
      // The grid's filter would run over the flattened list, testing each
      // heading as though it were a row and stripping it from in front of the
      // rows it describes. Filtering happens here, before grouping, and the
      // grid refuses a filter on a column that says so.
      filterable: false,
      // With no sort signal handed in there is no order this module could ever
      // be asked to apply, and a header that still cycled, marked itself and
      // announced would be describing rows that never move.
      sortable: options.sort === undefined ? false : column.sortable,
    }));
    return lifted;
  };

  const setCollapsed = (next: ReadonlySet<string>): void => {
    collapsedState.set(next);
    options.onCollapsedChange?.(next);
  };

  const collapse = (path: string): void => {
    const current = untrack(() => collapsedState.get());
    if (current.has(path)) return;
    const next = new Set(current);
    next.add(path);
    setCollapsed(next);
  };

  const expand = (path: string): void => {
    const current = untrack(() => collapsedState.get());
    if (!current.has(path)) return;
    const next = new Set(current);
    next.delete(path);
    setCollapsed(next);
  };

  const toggle = (path: string): void => {
    if (untrack(() => collapsedState.get()).has(path)) expand(path);
    else collapse(path);
  };

  const collapseAll = (): void => {
    const next = new Set<string>();
    const walk = (list: readonly GridGroupNode<T>[]): void => {
      for (const node of list) {
        next.add(node.path);
        walk(node.children);
      }
    };
    walk(untrack(() => tree.get()));
    setCollapsed(next);
  };

  const filterAnnouncement =
    options.filterAnnouncement ??
    ((shown: number, total: number): string => describeFilterCount(locale, shown, total));

  const reportFilters = (): void => {
    options.onFilterChange?.(
      untrack(() => filterState.get()),
      untrack(() => quickState.get()),
    );
    // The count is the one thing a filter changes that has no other way of
    // being noticed: the rows that stopped matching are not in the document.
    // Read after the write, because this is the first pull of the new view.
    announce(
      filterAnnouncement(
        untrack(() => presented.get().length),
        untrack(() => options.rows().length),
      ),
    );
  };

  const setFilter = (columnId: string, filter: GridFilter | null): void => {
    if (filter !== null) {
      const column = untrack(columnList).find((candidate) => candidate.id === columnId);
      if (column?.filterable === false) {
        refuseFilter(`column "${columnId}" is not filterable`, 'setFilter');
        return;
      }
    }
    const current = untrack(() => filterState.get());
    if (filter === null ? !current.has(columnId) : current.get(columnId) === filter) return;
    const next = new Map(current);
    if (filter === null) next.delete(columnId);
    else next.set(columnId, filter);
    filterState.set(next);
    reportFilters();
  };

  const clearFilters = (): void => {
    const current = untrack(() => filterState.get());
    const quick = untrack(() => quickState.get());
    if (current.size === 0 && quick === '') return;
    if (current.size > 0) filterState.set(EMPTY_FILTERS);
    if (quick !== '') quickState.set('');
    reportFilters();
  };

  const setQuickFilter = (text: string): void => {
    if (untrack(() => quickState.get()) === text) return;
    if (text !== '' && quickFilterValues(untrack(columnList)) === null) {
      refuseFilter('no column is filterable', 'setQuickFilter');
      return;
    }
    quickState.set(text);
    reportFilters();
  };

  /** The flattened row a cell's `row,column` attribute names, if it is one. */
  const rowAt = (index: number): GridGroupedRow<T> | undefined => untrack(() => flat.get())[index];

  const cellFrom = (target: EventTarget | null): { row: number; column: number } | null => {
    if (!(target instanceof Element)) return null;
    const raw = target.closest(`[${GRID_CELL_ATTRIBUTE}]`)?.getAttribute(GRID_CELL_ATTRIBUTE);
    if (!raw) return null;
    const [row, column] = raw.split(',');
    const parsed = { row: Number(row), column: Number(column) };
    if (!Number.isInteger(parsed.row) || !Number.isInteger(parsed.column)) return null;
    return parsed;
  };

  return {
    rows: () => flat.get(),
    tree: () => tree.get(),
    filteredRowCount: () => presented.get().length,
    sourceRowCount: () => options.rows().length,
    columns,
    rowKey: (row) => row.key,
    label: (row) => (row.kind === 'group' ? row.node.label : ''),

    isExpanded,
    expand,
    collapse,
    toggle,
    expandAll: () => {
      if (untrack(() => collapsedState.get()).size === 0) return;
      setCollapsed(EMPTY_COLLAPSED);
    },
    collapseAll,

    filters: () => filterState.get(),
    setFilter,
    clearFilters,
    quickFilter: () => quickState.get(),
    setQuickFilter,

    gridProps: () => (specs.get().length > 0 ? TREEGRID_PROPS : NO_PROPS),

    rowProps: (row) => {
      if (row.kind === 'data') {
        return {
          // Levels are 1-based in ARIA, and a row two groups deep is at level
          // three. A row in no group at all has none: the grid is not a
          // treegrid then, and a grid's rows have no levels.
          'aria-level': row.depth === 0 ? undefined : String(row.depth + 1),
          'data-depth': String(row.depth),
        };
      }
      return {
        [GRID_GROUP_ATTRIBUTE]: row.node.path,
        // The one thing a collapsed group has that a sighted reader gets from
        // the twisty. Without it a screen reader is told the rows went away and
        // never told they can be brought back.
        'aria-expanded': isExpanded(row.node.path) ? 'true' : 'false',
        'aria-level': String(row.depth + 1),
        'data-group': '',
        'data-depth': String(row.depth),
        'data-count': String(row.node.count),
      };
    },

    onGroupClick: (event) => {
      if (!(event.target instanceof Element)) return false;
      const path = event.target
        .closest(`[${GRID_GROUP_ATTRIBUTE}]`)
        ?.getAttribute(GRID_GROUP_ATTRIBUTE);
      if (path === null || path === undefined) return false;
      toggle(path);
      return true;
    },

    onKeyDown: (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
      const cell = cellFrom(event.target);
      if (cell === null || cell.row < 0) return false;
      const row = rowAt(cell.row);
      if (row === undefined || row.kind !== 'group') return false;

      const open = untrack(() => isExpanded(row.node.path));
      if (event.key === 'Enter') {
        toggle(row.node.path);
        event.preventDefault();
        return true;
      }
      // The arrows belong to the grid everywhere else: they are how a reader
      // walks the columns, and a group header has columns like any other row.
      // Only the first cell — the one carrying the twisty — spends them on the
      // group, and only when there is something for them to do.
      if (cell.column !== 0) return false;
      if (event.key === 'ArrowRight' && !open) {
        expand(row.node.path);
        event.preventDefault();
        return true;
      }
      if (event.key === 'ArrowLeft' && open) {
        collapse(row.node.path);
        event.preventDefault();
        return true;
      }
      return false;
    },
  };
}

/**
 * Says, in development, why the grouping did not filter: the caller marked
 * the column unfilterable, and a refused call otherwise looks exactly like a
 * filter that matched every row.
 */
function refuseFilter(reason: string, method: string): void {
  if (__VOLT_DEV__ && typeof console !== 'undefined') {
    console.warn(`[volt] createGrouping: ${reason}, so ${method} did nothing.`);
  }
}

/**
 * A named aggregate over one column's values.
 *
 * Rows whose value is not a number are skipped rather than counted as zero: a
 * column with three numbers and a blank averages the three, because the blank
 * is a row with no salary and not a row that earns nothing.
 */
function reduce<T>(
  rows: readonly T[],
  value: (row: T) => unknown,
  kind: Exclude<GridAggregateKind, 'count'>,
): unknown {
  let total = 0;
  let count = 0;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const number = asNumber(value(row));
    if (number === null) continue;
    count += 1;
    total += number;
    if (number < low) low = number;
    if (number > high) high = number;
  }
  // Nothing to reduce. Null rather than zero, which would be a number the
  // reader could act on and a claim the data does not make.
  if (count === 0) return null;
  switch (kind) {
    case 'sum':
      return total;
    case 'min':
      return low;
    case 'max':
      return high;
    case 'average':
      return total / count;
  }
}

/** Whether a rebuilt group says exactly what the one it replaces said. */
function sameNode<T>(a: GridGroupNode<T>, b: GridGroupNode<T>): boolean {
  if (a.label !== b.label || a.count !== b.count || !Object.is(a.value, b.value)) return false;
  if (a.rows.length !== b.rows.length) return false;
  for (let i = 0; i < a.rows.length; i++) {
    if (a.rows[i] !== b.rows[i]) return false;
  }
  if (a.aggregates.size !== b.aggregates.size) return false;
  for (const [key, value] of a.aggregates) {
    if (!b.aggregates.has(key) || !Object.is(b.aggregates.get(key), value)) return false;
  }
  if (a.children.length !== b.children.length) return false;
  for (let i = 0; i < a.children.length; i++) {
    // Identity, because the children were built first and reused on these same
    // terms: a child that changed is a child that is a different object.
    if (a.children[i] !== b.children[i]) return false;
  }
  return true;
}
