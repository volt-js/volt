/**
 * Saving and restoring an arrangement, driven through a real mounted grid.
 *
 * The thing worth proving is the round trip: whatever a reader arranged comes
 * back — in the DOM, not only in a signal — on a grid built from nothing,
 * handed nothing but what `JSON.parse` returned. Around that, the promises
 * that make a saved state safe to keep for months: what it leaves out, what a
 * restore forgives, what it refuses, and that none of it costs a row.
 *
 * happy-dom lays nothing out, so the viewport arrives through a
 * `ResizeObserver` that reports what a test hands it, as in `grid.test.ts`.
 * It is wide and tall enough that every row and every column is rendered, so
 * what the DOM shows is the whole arrangement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAnnouncer } from '@voltdev/primitives';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, effect, flushSync, mount } from '@voltdev/core';
import {
  GRID_CELL_ATTRIBUTE,
  GRID_STATE_VERSION,
  HEADER_ROW,
  createGrid,
  createGridState,
  createGrouping,
  type Grid,
  type GridColumn,
  type GridColumnView,
  type GridFilter,
  type GridGroupedRow,
  type GridGrouping,
  type GridNumberOperator,
  type GridRow,
  type GridSort,
  type GridState,
  type GridStateLayer,
  type GridStateOptions,
  type GridTextOperator,
} from '../src/index.ts';

interface Person {
  readonly id: number;
  /** A signal, so one cell can change on its own. */
  readonly name: Signal.State<string>;
  readonly team: string;
  readonly salary: number;
}

const ROW_HEIGHT = 20;
const VIEWPORT_HEIGHT = 400;
const VIEWPORT_WIDTH = 900;

const PEOPLE: readonly (readonly [string, string, number])[] = [
  ['Ada', 'east', 300],
  ['Bea', 'west', 100],
  ['Cy', 'east', 200],
  ['Di', 'west', 400],
  ['Ed', 'east', 500],
];

/** Every accessor run, by kind: what the grid rendered, sorted by and filtered on. */
const counts = { value: 0, sort: 0, filter: 0 };

function column(
  id: string,
  header: string,
  read: (row: Person) => unknown,
  extra: Partial<GridColumn<Person>> = {},
): GridColumn<Person> {
  return {
    id,
    header,
    value: (row) => {
      counts.value += 1;
      return read(row);
    },
    sortValue: (row) => {
      counts.sort += 1;
      return read(row);
    },
    filterValue: (row) => {
      counts.filter += 1;
      return read(row);
    },
    ...extra,
  };
}

const NAME = column('name', 'Name', (row) => row.name.get(), { width: 100 });
const TEAM = column('team', 'Team', (row) => row.team, { width: 100 });
const SALARY = column('salary', 'Salary', (row) => row.salary, { width: 100 });
/** Declares no width, so it is shown at the grid's own default. */
const NOTES = column('notes', 'Notes', () => '');
const EMAIL = column('email', 'Email', (row) => `${row.name.get()}@example.com`, { width: 100 });

function peopleOf(): Person[] {
  return PEOPLE.map(([name, team, salary], id) => ({
    id,
    name: new Signal.State(name),
    team,
    salary,
  }));
}

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;

let people: Signal.State<readonly Person[]>;
let definitions: Signal.State<readonly GridColumn<Person>[]>;
let sortState: Signal.State<readonly GridSort[]>;
let filterState: Signal.State<ReadonlyMap<string, GridFilter>>;
let quickState: Signal.State<string>;
let groupByState: Signal.State<readonly string[]>;
let collapsedState: Signal.State<ReadonlySet<string>>;
/** Whatever a test hands the layer, or takes away from it. */
let stateOptions: Partial<GridStateOptions<Person>>;
/** A saved state the flat harness restores as it is built, or undefined for none. */
let restoreAtInit: unknown;

/** Everything a harness reads, made again: a grid rebuilt from scratch shares nothing. */
function fresh(): void {
  people = new Signal.State<readonly Person[]>(peopleOf());
  definitions = new Signal.State<readonly GridColumn<Person>[]>([NAME, TEAM, SALARY, NOTES]);
  sortState = new Signal.State<readonly GridSort[]>([]);
  filterState = new Signal.State<ReadonlyMap<string, GridFilter>>(new Map());
  quickState = new Signal.State('');
  groupByState = new Signal.State<readonly string[]>([]);
  collapsedState = new Signal.State<ReadonlySet<string>>(new Set());
  stateOptions = {};
  restoreAtInit = undefined;
}

/** A ResizeObserver that reports only what a test hands it. */
class FakeResizeObserver {
  static live: FakeResizeObserver[] = [];

  readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.live.push(this);
  }

  observe(el: Element): void {
    this.targets.add(el);
  }

  unobserve(el: Element): void {
    this.targets.delete(el);
  }

  disconnect(): void {
    this.targets.clear();
  }

  static deliver(target: Element, block: number, inline: number): void {
    const box: ResizeObserverSize = { blockSize: block, inlineSize: inline };
    const entry = {
      target,
      borderBoxSize: [box],
      contentBoxSize: [box],
      devicePixelContentBoxSize: [box],
    } as unknown as ResizeObserverEntry;
    for (const observer of FakeResizeObserver.live) {
      if (observer.targets.has(target)) observer.callback([entry], observer as unknown as ResizeObserver);
    }
    flushSync();
  }
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  counts.value = 0;
  counts.sort = 0;
  counts.filter = 0;
  fresh();

  FakeResizeObserver.live = [];
  const view = window as unknown as { ResizeObserver: unknown };
  const original = view.ResizeObserver;
  view.ResizeObserver = FakeResizeObserver;
  restores.push(() => {
    view.ResizeObserver = original;
  });
});

afterEach(() => {
  teardown();
  resetAnnouncer();
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
});

function teardown(): void {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
}

/**
 * One template for both harnesses. The component supplies the three props
 * bags and the text a cell shows, because a grouped grid merges the grouping's
 * into the grid's and shows a group's label in its first column.
 */
const TEMPLATE = `
  <div class="grid" :ref="grid" :spread="gridProps()"
       :keydown="g.onKeyDown($event)" :focusin="g.onFocusIn($event)">
    <div class="header" :spread="g.headerProps()">
      <div class="header-row" :spread="g.headerRowProps()">
        <div class="th" :for="col in g.columns()" :key="col.key" :spread="g.headerCellProps(col)"
             :click="g.onHeaderClick($event)">{ col.column.header }</div>
      </div>
    </div>
    <div class="body" :ref="scroller" :spread="g.bodyProps()">
      <div class="sizer" :spread="g.sizerProps()">
        <div class="container" :ref="container" :spread="g.containerProps()">
          <div class="row" :for="row in g.rows()" :key="row.key" :spread="rowProps(row)">
            <div class="cell" :for="col in g.columns()" :key="col.key"
                 :spread="g.cellProps(row, col)"
                 :click="g.onCellClick($event)">{ cellText(row, col) }</div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

interface FlatHarness {
  g: Grid<Person>;
  view: GridStateLayer<Person>;
}

interface GroupedHarness {
  g: Grid<GridGroupedRow<Person>>;
  grouping: GridGrouping<Person>;
  view: GridStateLayer<Person>;
}

function measure(): void {
  const scroller = host.querySelector<HTMLElement>('.body')!;
  Object.defineProperty(scroller, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true });
  Object.defineProperty(scroller, 'clientWidth', { value: VIEWPORT_WIDTH, configurable: true });
  FakeResizeObserver.deliver(scroller, VIEWPORT_HEIGHT, VIEWPORT_WIDTH);
}

/** A grid over the caller's own rows: the grid sorts and filters. */
function setupFlat(): FlatHarness {
  @Component({ selector: `v-state-flat-${++selectors}`, render: compileTemplate(TEMPLATE) })
  class Flat {
    grid = new Signal.State<Element | null>(null);
    scroller = new Signal.State<Element | null>(null);
    container = new Signal.State<Element | null>(null);

    // Typed, because the layer and the grid each read the other and TypeScript
    // cannot infer a pair of fields that refer to each other.
    view: GridStateLayer<Person> = createGridState<Person>({
      grid: () => this.g,
      columns: () => definitions.get(),
      sort: sortState,
      filters: filterState,
      quickFilter: quickState,
      ...stateOptions,
    });

    g = createGrid<Person>({
      grid: () => this.grid.get(),
      scroller: () => this.scroller.get(),
      container: () => this.container.get(),
      rows: () => people.get(),
      columns: () => this.view.columns(),
      getRowKey: (row) => row.id,
      rowHeight: ROW_HEIGHT,
      sort: sortState,
      filters: filterState,
      quickFilter: quickState,
      onColumnResize: this.view.onColumnResize,
      rowSelection: 'multiple',
      cellSelection: 'range',
      label: 'People',
    });

    // Where the docs say to restore: a field after the grid, before the first flush.
    restored = restoreAtInit === undefined ? null : this.view.apply(restoreAtInit);

    gridProps(): Record<string, unknown> {
      return { ...this.g.gridProps() };
    }

    rowProps(row: GridRow<Person>): Record<string, unknown> {
      return { ...this.g.rowProps(row) };
    }

    cellText(row: GridRow<Person>, col: GridColumnView<Person>): string {
      return String(this.g.cellValue(row, col) ?? '');
    }
  }

  const handle = mount(Flat, host);
  mounted.push(handle);
  measure();
  const instance = handle.instance as Flat;
  return { g: instance.g, view: instance.view };
}

/** A grid over a grouping: the grouping filters, sorts and groups; the grid renders. */
function setupGrouped(): GroupedHarness {
  @Component({ selector: `v-state-grouped-${++selectors}`, render: compileTemplate(TEMPLATE) })
  class Grouped {
    grid = new Signal.State<Element | null>(null);
    scroller = new Signal.State<Element | null>(null);
    container = new Signal.State<Element | null>(null);

    view: GridStateLayer<Person> = createGridState<Person>({
      grid: () => this.g,
      columns: () => definitions.get(),
      sort: sortState,
      filters: filterState,
      quickFilter: quickState,
      groupBy: groupByState,
      collapsed: collapsedState,
      ...stateOptions,
    });

    grouping = createGrouping<Person>({
      rows: () => people.get(),
      columns: () => this.view.columns(),
      groupBy: () => groupByState.get(),
      getRowKey: (row) => row.id,
      sort: sortState,
      filters: filterState,
      quickFilter: quickState,
      collapsed: collapsedState,
    });

    g = createGrid<GridGroupedRow<Person>>({
      grid: () => this.grid.get(),
      scroller: () => this.scroller.get(),
      container: () => this.container.get(),
      rows: () => this.grouping.rows(),
      columns: () => this.grouping.columns(),
      getRowKey: this.grouping.rowKey,
      rowHeight: ROW_HEIGHT,
      sort: sortState,
      onColumnResize: this.view.onColumnResize,
      label: 'People',
    });

    gridProps(): Record<string, unknown> {
      return { ...this.g.gridProps(), ...this.grouping.gridProps() };
    }

    rowProps(row: GridRow<GridGroupedRow<Person>>): Record<string, unknown> {
      return { ...this.g.rowProps(row), ...this.grouping.rowProps(row.item) };
    }

    cellText(
      row: GridRow<GridGroupedRow<Person>>,
      col: GridColumnView<GridGroupedRow<Person>>,
    ): string {
      if (row.item.kind === 'group' && col.index === 0) return this.grouping.label(row.item);
      return String(this.g.cellValue(row, col) ?? '');
    }
  }

  const handle = mount(Grouped, host);
  mounted.push(handle);
  measure();
  const instance = handle.instance as Grouped;
  return { g: instance.g, grouping: instance.grouping, view: instance.view };
}

function headerCells(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.th')];
}

function headers(): string[] {
  return headerCells().map((cell) => cell.textContent ?? '');
}

function headerWidths(): string[] {
  return headerCells().map((cell) => cell.style.width);
}

function headerFor(text: string): HTMLElement {
  const found = headerCells().find((cell) => cell.textContent === text);
  if (found === undefined) throw new Error(`no header "${text}"`);
  return found;
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.row')];
}

/** What one column of the rendered rows says, top to bottom. */
function columnText(index: number): string[] {
  return rows().map((row) => row.querySelectorAll('.cell')[index]?.textContent ?? '');
}

/** The cell at a position — a header cell for `HEADER_ROW` — found the way the grid finds it. */
function cellAt(row: number, column: number): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[${GRID_CELL_ATTRIBUTE}="${row},${column}"]`);
}

/** The column each cell in the range sits under, left to right along its first row. */
function rangeColumns(): string[] {
  const first = host.querySelector<HTMLElement>('.row [data-selected]')?.closest('.row');
  if (!first) return [];
  return [...first.querySelectorAll<HTMLElement>('[data-selected]')].map(
    (cell) => cell.getAttribute('data-column') ?? '',
  );
}

/** A saved state as it comes back from storage: through JSON and out again. */
function stored(state: GridState): unknown {
  return JSON.parse(JSON.stringify(state));
}

/** Counts the runs of an effect that reads the saved state, as a persister would. */
function watch(view: GridStateLayer<Person>): { runs: number } {
  const seen = { runs: 0 };
  const stop = effect(() => {
    view.state();
    seen.runs += 1;
  });
  restores.push(stop);
  flushSync();
  return seen;
}

function silenceWarnings(): ReturnType<typeof vi.spyOn> {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  restores.push(() => warn.mockRestore());
  return warn;
}

// ---------------------------------------------------------------------------

describe('the columns it hands the grid', () => {
  it('are the caller\'s own list while nothing is arranged', () => {
    const harness = setupFlat();
    expect(harness.view.columns()).toBe(definitions.get());
    expect(harness.view.allColumns()).toBe(definitions.get());
    expect(headers()).toEqual(['Name', 'Team', 'Salary', 'Notes']);
  });

  it('follow a move, and the grid renders the new order', () => {
    const harness = setupFlat();
    harness.view.moveColumn('salary', 0);
    flushSync();
    expect(headers()).toEqual(['Salary', 'Name', 'Team', 'Notes']);
    // And the cells under them, so a move is not a header relabelled.
    expect(columnText(0)).toEqual(['300', '100', '200', '400', '500']);

    // Past the end is the end; a column that is not there, or no place at all,
    // moves nothing.
    harness.view.moveColumn('salary', 99);
    harness.view.moveColumn('gone', 0);
    harness.view.moveColumn('team', Number.NaN);
    flushSync();
    expect(headers()).toEqual(['Name', 'Team', 'Notes', 'Salary']);
  });

  it('leave a hidden column out, and keep its place for when it is shown', () => {
    const harness = setupFlat();
    harness.view.setColumnHidden('team', true);
    flushSync();
    expect(headers()).toEqual(['Name', 'Salary', 'Notes']);
    expect(harness.view.isColumnHidden('team')).toBe(true);
    // A chooser lists it, where it was.
    expect(harness.view.allColumns().map((col) => col.id)).toEqual([
      'name', 'team', 'salary', 'notes',
    ]);
    // Counted among every column, so a hidden one keeps its place through a move.
    harness.view.moveColumn('notes', 0);
    harness.view.setColumnHidden('team', false);
    harness.view.setColumnHidden('gone', true);
    flushSync();
    expect(headers()).toEqual(['Notes', 'Name', 'Team', 'Salary']);
    expect(harness.view.isColumnHidden('gone')).toBe(false);
  });

  it('put a column the order does not name after the one it follows', () => {
    const harness = setupFlat();
    harness.view.moveColumn('salary', 0);
    // Email is added after Name, and a new first column in front of everything.
    const first = column('id', 'Id', (row) => row.id, { width: 50 });
    definitions.set([first, NAME, EMAIL, TEAM, SALARY, NOTES]);
    flushSync();
    expect(harness.view.allColumns().map((col) => col.id)).toEqual([
      'id', 'salary', 'name', 'email', 'team', 'notes',
    ]);
    expect(headers()).toEqual(['Id', 'Salary', 'Name', 'Email', 'Team', 'Notes']);

    // And a column the order still names, once it has gone, is simply not there.
    definitions.set([first, NAME, EMAIL, TEAM, NOTES]);
    flushSync();
    expect(headers()).toEqual(['Id', 'Name', 'Email', 'Team', 'Notes']);
  });

  it('stay the same list through a sort, a filter and a resize', () => {
    const harness = setupFlat();
    harness.view.moveColumn('salary', 0);
    flushSync();
    const before = harness.view.columns();

    harness.g.toggleSort('salary');
    harness.g.setFilter('team', { type: 'text', value: 'east' });
    harness.g.resizeColumn('name', 180);
    flushSync();
    expect(harness.view.columns()).toBe(before);

    // Nor through the same columns handed over again as a new array.
    const all = harness.view.allColumns();
    definitions.set([...definitions.get()]);
    flushSync();
    expect(harness.view.columns()).toBe(before);
    expect(harness.view.allColumns()).toBe(all);

    // Nor through a hidden column moving, which changes nothing on screen.
    harness.view.setColumnHidden('team', true);
    flushSync();
    const shown = harness.view.columns();
    harness.view.moveColumn('team', 3);
    flushSync();
    expect(harness.view.columns()).toBe(shown);
  });

  it('keep a column carrying a restored width the same object while the width holds', () => {
    const harness = setupFlat();
    harness.view.apply({ version: GRID_STATE_VERSION, columns: [{ id: 'name', width: 180 }] });
    flushSync();
    const before = harness.view.columns();
    expect(before[0]).not.toBe(NAME);
    expect(before[0]!.width).toBe(180);

    definitions.set([...definitions.get()]);
    flushSync();
    expect(harness.view.columns()).toBe(before);
  });

  it('follow an order and a hidden set supplied from outside', () => {
    const order = new Signal.State<readonly string[]>(['notes', 'salary']);
    const hidden = new Signal.State<ReadonlySet<string>>(new Set(['team']));
    stateOptions = { order, hidden };
    const harness = setupFlat();
    // Name is not named, and comes first in the caller's list, so it goes first.
    expect(headers()).toEqual(['Name', 'Notes', 'Salary']);

    hidden.set(new Set());
    order.set(['team']);
    flushSync();
    expect(headers()).toEqual(['Name', 'Team', 'Salary', 'Notes']);
    // The layer writes the caller's signal, not a copy of its own.
    harness.view.moveColumn('notes', 0);
    expect(order.get()).toEqual(['notes', 'name', 'team', 'salary']);
    // And leaves both alone when a restore has nothing to change: whatever
    // else reads the caller's signals is not woken for an equal copy.
    const written = [order.get(), hidden.get()] as const;
    harness.view.apply(stored(harness.view.state()));
    expect(order.get()).toBe(written[0]);
    expect(hidden.get()).toBe(written[1]);
    // Nor does a gesture that changes nothing.
    harness.view.moveColumn('notes', 0);
    harness.view.setColumnHidden('team', false);
    expect(order.get()).toBe(written[0]);
    expect(hidden.get()).toBe(written[1]);
  });

  it('are still the caller\'s own list when the hidden set names no column there is', () => {
    stateOptions = { hidden: new Signal.State<ReadonlySet<string>>(new Set(['gone'])) };
    const harness = setupFlat();
    expect(harness.view.columns()).toBe(definitions.get());
  });
});

describe('the cursor and a cell range, as the columns are arranged', () => {
  it('keeps the cursor, and focus, on its column wherever a move takes it', () => {
    const harness = setupFlat();
    harness.g.focusCell({ row: 2, column: 1 });
    flushSync();
    expect(document.activeElement).toBe(cellAt(2, 1));

    harness.view.moveColumn('team', 3);
    flushSync();
    expect(headers()).toEqual(['Name', 'Salary', 'Notes', 'Team']);
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 3 });
    expect(cellAt(2, 3)!.getAttribute('data-column')).toBe('team');
    expect(document.activeElement).toBe(cellAt(2, 3));

    // Another column moved past it moves it too.
    harness.view.moveColumn('salary', 3);
    flushSync();
    expect(headers()).toEqual(['Name', 'Notes', 'Team', 'Salary']);
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 2 });
    expect(document.activeElement).toBe(cellAt(2, 2));

    // The header is a row like any other: the column under it is followed too.
    harness.g.focusCell({ row: HEADER_ROW, column: 0 });
    flushSync();
    harness.view.moveColumn('name', 2);
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 2 });
    expect(cellAt(HEADER_ROW, 2)!.getAttribute('data-column')).toBe('name');
  });

  it('moves the cursor to the column that takes the place of one hidden under it', () => {
    const harness = setupFlat();
    harness.g.focusCell({ row: 2, column: 1 });
    flushSync();

    harness.view.setColumnHidden('team', true);
    flushSync();
    // Salary slid into its place, as the next row slides under a cursor whose
    // row a filter took away — and focus went with the cursor, rather than
    // being left on a cell that is no longer in the document.
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 1 });
    expect(cellAt(2, 1)!.getAttribute('data-column')).toBe('salary');
    expect(document.activeElement).toBe(cellAt(2, 1));

    // A column hidden in front of it moves it back one, on the column it was on.
    harness.view.setColumnHidden('name', true);
    flushSync();
    expect(headers()).toEqual(['Salary', 'Notes']);
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 0 });
    expect(document.activeElement).toBe(cellAt(2, 0));

    // And shown again, too: the cursor stays on salary, wherever that now is.
    harness.view.setColumnHidden('name', false);
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 1 });
    expect(cellAt(2, 1)!.getAttribute('data-column')).toBe('salary');

    // The last column hidden has nothing after it, so the one before it takes the cursor.
    harness.g.focusCell({ row: 2, column: 2 });
    flushSync();
    harness.view.setColumnHidden('notes', true);
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 1 });
    expect(cellAt(2, 1)!.getAttribute('data-column')).toBe('salary');
  });

  it('takes no focus back into the grid for a column hidden with none left to take its place', () => {
    const harness = setupFlat();
    for (const id of ['team', 'salary', 'notes']) harness.view.setColumnHidden(id, true);
    flushSync();
    harness.g.focusCell({ row: 2, column: 0 });
    flushSync();

    // The last column goes with focus on it, and there is no cell to bring
    // focus to. The reader goes elsewhere; the column coming back later is
    // not a reason to take them out of it.
    harness.view.setColumnHidden('name', true);
    flushSync();
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    harness.view.setColumnHidden('name', false);
    flushSync();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('carries a cell range across a move that keeps its columns together, and drops one that parts them', () => {
    const harness = setupFlat();
    harness.g.setCellRange({ anchor: { row: 1, column: 0 }, focus: { row: 2, column: 1 } });
    flushSync();
    expect(rangeColumns()).toEqual(['name', 'team']);

    // Salary moved in front of both: they shift together, and so does the range.
    harness.view.moveColumn('salary', 0);
    flushSync();
    expect(harness.g.cellRange()).toEqual({
      anchor: { row: 1, column: 1 },
      focus: { row: 2, column: 2 },
    });
    expect(rangeColumns()).toEqual(['name', 'team']);

    // A column hidden outside it moves it, too.
    harness.view.setColumnHidden('salary', true);
    flushSync();
    expect(harness.g.cellRange()).toEqual({
      anchor: { row: 1, column: 0 },
      focus: { row: 2, column: 1 },
    });

    // Notes moved in between its columns: a rectangle between the same corners
    // would take in a column nobody chose, so there is no range at all.
    harness.view.moveColumn('notes', 2);
    flushSync();
    expect(headers()).toEqual(['Name', 'Notes', 'Team']);
    expect(harness.g.cellRange()).toBe(null);
    expect(rangeColumns()).toEqual([]);

    // Nor does one survive a column of its own being hidden, or moved out.
    harness.view.moveColumn('notes', 3);
    harness.g.setCellRange({ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 1 } });
    flushSync();
    harness.view.setColumnHidden('team', true);
    flushSync();
    expect(harness.g.cellRange()).toBe(null);
  });

  it('carries a range across a move on a sorted grid, whose rows the move left where they were', () => {
    const harness = setupFlat();
    harness.g.toggleSort('salary');
    flushSync();
    harness.g.setCellRange({ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } });
    flushSync();

    // A new column list re-sorts, and the rows come back in the order they
    // were in: nothing about them moved, so nothing about them drops the range.
    harness.view.moveColumn('notes', 0);
    flushSync();
    expect(harness.g.cellRange()).toEqual({
      anchor: { row: 0, column: 1 },
      focus: { row: 1, column: 1 },
    });
    expect(rangeColumns()).toEqual(['name']);
  });
});

describe('the saved state', () => {
  it('is plain JSON, and comes back from JSON unchanged', () => {
    const harness = setupFlat();
    harness.view.moveColumn('salary', 0);
    harness.view.setColumnHidden('notes', true);
    harness.g.resizeColumn('name', 180);
    harness.g.toggleSort('team');
    harness.g.toggleSort('salary', true);
    harness.g.toggleSort('salary', true);
    harness.g.setFilter('name', { type: 'text', value: 'a', operator: 'startsWith', caseSensitive: false });
    harness.g.setFilter('salary', { type: 'number', operator: 'between', value: 100, to: 400 });
    harness.g.setFilter('team', { type: 'set', values: ['east', null, 3, true] });
    harness.g.setQuickFilter('a');
    flushSync();

    const state = harness.view.state();
    expect(state).toEqual({
      version: GRID_STATE_VERSION,
      columns: [
        { id: 'salary' },
        { id: 'name', width: 180 },
        { id: 'team' },
        { id: 'notes', hidden: true },
      ],
      sort: [
        { columnId: 'team', direction: 'ascending' },
        { columnId: 'salary', direction: 'descending' },
      ],
      filters: {
        name: { type: 'text', value: 'a', operator: 'startsWith', caseSensitive: false },
        team: { type: 'set', values: ['east', null, 3, true] },
        salary: { type: 'number', value: 100, operator: 'between', to: 400 },
      },
      quickFilter: 'a',
      groupBy: [],
      collapsed: [],
    });
    expect(stored(state)).toEqual(state);
    // In column order whatever order they were set in, so the same filters
    // always serialize to the same text.
    expect(Object.keys(state.filters)).toEqual(['name', 'team', 'salary']);
  });

  it('lists shut groups in one order however they were shut', () => {
    const harness = setupGrouped();
    groupByState.set(['team']);
    flushSync();
    harness.grouping.collapse('west');
    harness.grouping.collapse('east');
    flushSync();
    const before = harness.view.state();
    expect(before.collapsed).toEqual(['east', 'west']);

    collapsedState.set(new Set(['east', 'west']));
    flushSync();
    expect(harness.view.state()).toBe(before);
  });

  it('records a width only for a column the reader resized', () => {
    const harness = setupFlat();
    expect(harness.view.state().columns.some((col) => 'width' in col)).toBe(false);

    harness.g.resizeColumn('notes', 240);
    flushSync();
    expect(harness.view.state().columns).toEqual([
      { id: 'name' },
      { id: 'team' },
      { id: 'salary' },
      { id: 'notes', width: 240 },
    ]);
  });

  it('holds no row, no row key and nothing held by position', () => {
    const harness = setupFlat();
    harness.g.toggleSort('salary');
    flushSync();
    const before = harness.view.state();

    harness.g.selectRow(3);
    harness.g.setCellRange({ anchor: { row: 0, column: 0 }, focus: { row: 2, column: 1 } });
    harness.g.focusCell({ row: 2, column: 1 });
    host.querySelector<HTMLElement>('.body')!.scrollTop = 20;
    flushSync();

    // Not merely equal: the same object, because nothing it reads has changed.
    expect(harness.view.state()).toBe(before);
    const json = JSON.stringify(before);
    for (const [name] of PEOPLE) expect(json).not.toContain(name);
    expect(Object.keys(before)).toEqual([
      'version', 'columns', 'sort', 'filters', 'quickFilter', 'groupBy', 'collapsed',
    ]);
  });

  it('is a signal that changes when the arrangement does, and only then', () => {
    const harness = setupFlat();
    const seen = watch(harness.view);
    expect(seen.runs).toBe(1);

    harness.g.toggleSort('salary');
    flushSync();
    expect(seen.runs).toBe(2);

    // The same arrangement, written again as new values: nothing to save.
    definitions.set([...definitions.get()]);
    sortState.set([{ columnId: 'salary', direction: 'ascending' }]);
    flushSync();
    expect(seen.runs).toBe(2);

    // Nor is anything that is not the arrangement.
    harness.g.selectRow(1);
    people.get()[0]!.name.set('Zed');
    flushSync();
    expect(seen.runs).toBe(2);

    harness.view.setColumnHidden('notes', true);
    flushSync();
    expect(seen.runs).toBe(3);
  });

  it('reads no row: a cell changing costs it nothing, and reading it runs no accessor', () => {
    const harness = setupFlat();
    const seen = watch(harness.view);
    counts.value = 0;
    counts.sort = 0;
    counts.filter = 0;

    harness.view.state();
    expect(counts).toEqual({ value: 0, sort: 0, filter: 0 });

    people.get()[0]!.name.set('Zed');
    flushSync();
    // One text node: the cell that changed, and nothing here.
    expect(counts).toEqual({ value: 1, sort: 0, filter: 0 });
    expect(seen.runs).toBe(1);
  });

  it('leaves out a filter JSON cannot carry, and says so once', () => {
    const warn = silenceWarnings();
    const harness = setupFlat();
    const dated: GridFilter = { type: 'set', values: [new Date(0)] };
    // Unfinished: filters nothing, so nothing is lost and nothing is said.
    const unfinished: GridFilter = { type: 'number', value: Number.NaN };
    // A bound only `between` reads, and one JSON would turn into null.
    const bounded: GridFilter = { type: 'number', operator: 'greaterThan', value: 5, to: Number.NaN };
    filterState.set(
      new Map<string, GridFilter>([['team', dated], ['salary', unfinished], ['name', bounded]]),
    );
    flushSync();

    expect(harness.view.state().filters).toEqual({
      name: { type: 'number', operator: 'greaterThan', value: 5 },
    });
    expect(stored(harness.view.state())).toEqual(harness.view.state());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('"team"');

    harness.g.toggleSort('name');
    flushSync();
    expect(harness.view.state().sort).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('leaves out a range whose upper bound JSON cannot carry, rather than saving it open', () => {
    const warn = silenceWarnings();
    const harness = setupFlat();
    // Everything from 250 up. It filters, and JSON would write its bound as
    // null: saved without the bound, it would come back as no filter at all.
    filterState.set(
      new Map<string, GridFilter>([
        ['salary', { type: 'number', operator: 'between', value: 250, to: Number.POSITIVE_INFINITY }],
      ]),
    );
    flushSync();
    expect(columnText(0)).toEqual(['Ada', 'Di', 'Ed']);

    expect(harness.view.state().filters).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('"salary"');
  });

  it('reads a filter only from a state\'s own entries', () => {
    const warn = silenceWarnings();
    // Ids every object inherits something under.
    definitions.set([NAME, column('__proto__', 'Proto', () => ''), column('constructor', 'Ctor', () => '')]);
    const harness = setupFlat();
    expect(harness.view.state().filters).toEqual({});
    harness.view.apply({ version: GRID_STATE_VERSION, filters: {} });
    expect(harness.g.filters().size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('saves and restores only the pieces it was handed', () => {
    stateOptions = { sort: undefined, filters: undefined, quickFilter: undefined };
    const harness = setupFlat();
    harness.g.toggleSort('salary');
    harness.g.setFilter('team', { type: 'text', value: 'east' });
    flushSync();
    expect(harness.view.state().sort).toEqual([]);
    expect(harness.view.state().filters).toEqual({});

    harness.view.apply({
      version: GRID_STATE_VERSION,
      sort: [{ columnId: 'name', direction: 'descending' }],
    });
    expect(harness.g.sort()).toEqual([{ columnId: 'salary', direction: 'ascending' }]);
    expect(harness.g.filters().size).toBe(1);
  });
});

describe('restoring', () => {
  it('brings every arrangement back to a grid rebuilt from scratch', () => {
    const first = setupFlat();
    first.view.moveColumn('salary', 0);
    first.view.setColumnHidden('team', true);
    first.g.resizeColumn('name', 180);
    first.g.toggleSort('salary');
    first.g.toggleSort('salary');
    first.g.setFilter('salary', { type: 'number', operator: 'greaterThan', value: 150 });
    first.g.setQuickFilter('d');
    flushSync();

    const arranged = {
      headers: headers(),
      widths: headerWidths(),
      names: columnText(1),
      sort: headerFor('Salary').getAttribute('aria-sort'),
    };
    expect(arranged).toEqual({
      headers: ['Salary', 'Name', 'Notes'],
      widths: ['100px', '180px', '150px'],
      names: ['Ed', 'Di', 'Ada'],
      sort: 'descending',
    });
    const saved = JSON.stringify(first.view.state());

    teardown();
    fresh();
    const second = setupFlat();
    expect(headers()).toEqual(['Name', 'Team', 'Salary', 'Notes']);

    expect(second.view.apply(JSON.parse(saved))).toEqual({ applied: true });
    flushSync();

    expect({
      headers: headers(),
      widths: headerWidths(),
      names: columnText(1),
      sort: headerFor('Salary').getAttribute('aria-sort'),
    }).toEqual(arranged);
    expect(second.view.isColumnHidden('team')).toBe(true);
    expect(second.view.allColumns().map((col) => col.id)).toEqual([
      'salary', 'name', 'team', 'notes',
    ]);
    expect(second.g.filters()).toEqual(
      new Map([['salary', { type: 'number', operator: 'greaterThan', value: 150 }]]),
    );
    expect(second.g.quickFilter()).toBe('d');
    expect(JSON.stringify(second.view.state())).toBe(saved);
  });

  it('restores as the grid is built, so the first render is the restored view', () => {
    restoreAtInit = {
      version: GRID_STATE_VERSION,
      columns: [{ id: 'salary' }, { id: 'name', width: 180 }, { id: 'team', hidden: true }, { id: 'notes' }],
      sort: [{ columnId: 'salary', direction: 'descending' }],
      filters: { salary: { type: 'number', operator: 'greaterThan', value: 150 } },
      quickFilter: '',
      groupBy: [],
      collapsed: [],
    };
    const harness = setupFlat();

    expect(headers()).toEqual(['Salary', 'Name', 'Notes']);
    expect(headerWidths()).toEqual(['100px', '180px', '150px']);
    expect(columnText(1)).toEqual(['Ed', 'Di', 'Ada', 'Cy']);
    // One filter pass: the default view was never derived on the way.
    expect(counts.filter).toBe(PEOPLE.length);
    // So whatever saves on change first saves what was restored.
    expect(harness.view.state()).toEqual(restoreAtInit);
  });

  it('brings grouping and shut groups back with the rest', () => {
    const first = setupGrouped();
    first.view.moveColumn('salary', 0);
    first.view.setColumnHidden('notes', true);
    first.g.resizeColumn('name', 180);
    groupByState.set(['team']);
    first.g.toggleSort('salary');
    first.grouping.setFilter('salary', { type: 'number', operator: 'lessThan', value: 450 });
    flushSync();
    first.grouping.collapse('west');
    flushSync();

    const arranged = {
      headers: headers(),
      widths: headerWidths(),
      groups: rows().map((row) => row.getAttribute('data-volt-grid-group')),
      expanded: rows().map((row) => row.getAttribute('aria-expanded')),
      names: columnText(1),
      sort: headerFor('Salary').getAttribute('aria-sort'),
    };
    expect(arranged).toEqual({
      headers: ['Salary', 'Name', 'Team'],
      widths: ['100px', '180px', '100px'],
      // West comes first because its first row does: Bea, on the lowest salary.
      groups: ['west', 'east', null, null],
      expanded: ['false', 'true', null, null],
      names: ['', '', 'Cy', 'Ada'],
      sort: 'ascending',
    });
    const saved = JSON.stringify(first.view.state());

    teardown();
    fresh();
    const second = setupGrouped();
    expect(rows().every((row) => row.getAttribute('data-volt-grid-group') === null)).toBe(true);

    expect(second.view.apply(JSON.parse(saved))).toEqual({ applied: true });
    flushSync();

    expect({
      headers: headers(),
      widths: headerWidths(),
      groups: rows().map((row) => row.getAttribute('data-volt-grid-group')),
      expanded: rows().map((row) => row.getAttribute('aria-expanded')),
      names: columnText(1),
      sort: headerFor('Salary').getAttribute('aria-sort'),
    }).toEqual(arranged);
    expect(groupByState.get()).toEqual(['team']);
    expect([...collapsedState.get()]).toEqual(['west']);
    expect(second.grouping.filters().get('salary')).toEqual({
      type: 'number',
      operator: 'lessThan',
      value: 450,
    });
    expect(JSON.stringify(second.view.state())).toBe(saved);
  });

  it('keeps a column grouped at two levels as two levels', () => {
    // What a date grouped by year and then by month looks like once each level
    // is mapped to its spec by position: one column, listed twice.
    const first = setupGrouped();
    groupByState.set(['team', 'team']);
    flushSync();
    expect(first.grouping.tree()[0]!.children).toHaveLength(1);
    const saved = stored(first.view.state());
    expect(saved).toMatchObject({ groupBy: ['team', 'team'] });

    teardown();
    fresh();
    const second = setupGrouped();
    second.view.apply(saved);
    flushSync();
    expect(groupByState.get()).toEqual(['team', 'team']);
    expect(second.grouping.tree()[0]!.children).toHaveLength(1);
  });

  it('drops whatever names a column that no longer exists', () => {
    const first = setupGrouped();
    first.view.moveColumn('team', 0);
    first.view.setColumnHidden('team', true);
    first.g.resizeColumn('team', 220);
    groupByState.set(['team', 'salary']);
    first.g.toggleSort('team');
    first.g.toggleSort('name', true);
    first.grouping.setFilter('team', { type: 'text', value: 'east' });
    first.grouping.setFilter('name', { type: 'text', value: 'a' });
    flushSync();
    const saved = stored(first.view.state());

    teardown();
    fresh();
    definitions.set([NAME, SALARY, NOTES]);
    const second = setupGrouped();

    expect(second.view.apply(saved)).toEqual({ applied: true });
    flushSync();
    const state = second.view.state();
    expect(JSON.stringify(state)).not.toContain('team');
    expect(state.columns.map((col) => col.id)).toEqual(['name', 'salary', 'notes']);
    expect(state.sort).toEqual([{ columnId: 'name', direction: 'ascending' }]);
    expect(Object.keys(state.filters)).toEqual(['name']);
    expect(state.groupBy).toEqual(['salary']);
    expect(headers()).toEqual(['Name', 'Salary', 'Notes']);
  });

  it('drops the groups shut under a level that has gone, and keeps those above it', () => {
    const harness = setupGrouped();
    // Shut under a grouping by region, which this release no longer has. Read
    // against the grouping that is left, `east` would shut a team nobody shut.
    harness.view.apply({
      version: GRID_STATE_VERSION,
      groupBy: ['region', 'team'],
      collapsed: ['east'],
    });
    flushSync();
    expect(harness.view.state().groupBy).toEqual(['team']);
    expect(harness.view.state().collapsed).toEqual([]);
    expect(rows().map((row) => row.getAttribute('aria-expanded')).filter((open) => open !== null)).toEqual([
      'true',
      'true',
    ]);

    // Shut by the reader under two levels, the inner of which goes.
    groupByState.set(['team', 'salary']);
    flushSync();
    const east = harness.grouping.tree().find((node) => node.label === 'east')!;
    harness.grouping.collapse(east.children[0]!.path);
    harness.grouping.collapse('west');
    flushSync();
    const saved = stored(harness.view.state());

    teardown();
    fresh();
    definitions.set([NAME, TEAM, NOTES]);
    const second = setupGrouped();
    second.view.apply(saved);
    flushSync();
    // The outer level still means what it did, so the group shut at it stays
    // shut; the one shut beneath the level that went does not come back.
    expect(second.view.state().groupBy).toEqual(['team']);
    expect(second.view.state().collapsed).toEqual(['west']);
    expect(rows().map((row) => row.getAttribute('aria-expanded')).filter((open) => open !== null)).toEqual([
      'true',
      'false',
    ]);
  });

  it('gives a column added since the save its defaults', () => {
    const first = setupFlat();
    first.view.moveColumn('salary', 0);
    first.g.resizeColumn('name', 180);
    flushSync();
    const saved = stored(first.view.state());

    teardown();
    fresh();
    definitions.set([NAME, EMAIL, TEAM, SALARY, NOTES]);
    const second = setupFlat();
    second.view.apply(saved);
    flushSync();

    // After the column it follows in the caller's list, shown, at its own width.
    expect(headers()).toEqual(['Salary', 'Name', 'Email', 'Team', 'Notes']);
    expect(headerWidths()).toEqual(['100px', '180px', '100px', '100px', '150px']);
    expect(second.view.state().columns[2]).toEqual({ id: 'email' });
  });

  it('keeps a column added since the save hidden, where the page starts it hidden', () => {
    const first = setupFlat();
    first.view.moveColumn('salary', 0);
    flushSync();
    const saved = stored(first.view.state());

    teardown();
    fresh();
    // New in this release, and one a first visit does not show.
    definitions.set([NAME, EMAIL, TEAM, SALARY, NOTES]);
    stateOptions = { hidden: new Signal.State<ReadonlySet<string>>(new Set(['email'])) };
    const second = setupFlat();
    second.view.apply(saved);
    flushSync();

    expect(headers()).toEqual(['Salary', 'Name', 'Team', 'Notes']);
    expect(second.view.isColumnHidden('email')).toBe(true);
    // Still in its place, for when the reader shows it.
    expect(second.view.allColumns().map((col) => col.id)).toEqual([
      'salary', 'name', 'email', 'team', 'notes',
    ]);
  });

  it('refuses a state written by a newer version, and writes nothing', () => {
    const warn = silenceWarnings();
    const harness = setupFlat();
    harness.g.toggleSort('salary');
    flushSync();
    const before = harness.view.state();

    const newer = {
      ...before,
      version: GRID_STATE_VERSION + 1,
      columns: [{ id: 'notes', hidden: true }],
      sort: [],
      pinned: { left: ['name'] },
    };
    expect(harness.view.apply(newer)).toEqual({
      applied: false,
      reason: 'newer-version',
      version: GRID_STATE_VERSION + 1,
    });
    flushSync();

    expect(harness.view.state()).toBe(before);
    expect(headers()).toEqual(['Name', 'Team', 'Salary', 'Notes']);
    expect(harness.g.sort()).toEqual([{ columnId: 'salary', direction: 'ascending' }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(`version ${GRID_STATE_VERSION + 1}`);
  });

  it('refuses what is not a saved state at all', () => {
    const warn = silenceWarnings();
    const harness = setupFlat();
    const before = harness.view.state();

    for (const input of ['x', 42, [], {}, { version: '1' }, { version: 0 }, { version: 1.5 }]) {
      expect(harness.view.apply(input)).toEqual({ applied: false, reason: 'not-a-state' });
    }
    expect(warn).toHaveBeenCalledTimes(7);

    // Nothing saved yet is the first visit, and not worth a word.
    expect(harness.view.apply(null)).toEqual({ applied: false, reason: 'not-a-state' });
    expect(harness.view.apply(undefined)).toEqual({ applied: false, reason: 'not-a-state' });
    expect(warn).toHaveBeenCalledTimes(7);
    expect(harness.view.state()).toBe(before);
  });

  it('drops malformed entries rather than throwing', () => {
    const harness = setupGrouped();
    const result = harness.view.apply({
      version: GRID_STATE_VERSION,
      columns: [
        { id: 'salary', width: -5 },
        { id: 3 },
        null,
        'name',
        // A number in a string is still not a number.
        { id: 'team', width: '180', hidden: 'yes' },
        { id: 'salary', hidden: true },
        { id: 'notes', width: 212.4, hidden: true },
      ],
      sort: [
        { columnId: 'name', direction: 'up' },
        { columnId: 'salary', direction: 'descending' },
        { columnId: 'salary', direction: 'ascending' },
        null,
      ],
      filters: {
        name: { type: 'regex', value: 'a' },
        team: { type: 'text', value: 'e', operator: 'fuzzy' },
        salary: { type: 'number', value: '5' },
        notes: { type: 'set', values: [{}] },
      },
      quickFilter: 42,
      // The unreadable level is inside the one that is kept, so the groups
      // shut at the outer level still mean what they meant.
      groupBy: ['team', 1],
      collapsed: ['b', 2, 'a', 'b'],
    });

    expect(result).toEqual({ applied: true });
    expect(harness.view.state()).toEqual({
      version: GRID_STATE_VERSION,
      // Name was never listed by an entry that could be read, so it takes the
      // place a new column would: first, as it is first in the caller's list.
      columns: [{ id: 'name' }, { id: 'salary' }, { id: 'team' }, { id: 'notes', width: 212, hidden: true }],
      sort: [{ columnId: 'salary', direction: 'descending' }],
      filters: {},
      quickFilter: '',
      groupBy: ['team'],
      collapsed: ['a', 'b'],
    });
  });

  it('drops a width that rounds to nothing, rather than handing the grid a zero', () => {
    const harness = setupFlat();
    harness.view.apply({
      version: GRID_STATE_VERSION,
      columns: [{ id: 'name', width: 0.3 }, { id: 'team', width: 0.5 }],
    });
    flushSync();
    // Name keeps its own width, where a zero would have the grid show its
    // minimum while the state said no width was chosen. Half a pixel is a
    // whole one, and clamped like any other.
    expect(headerWidths().slice(0, 2)).toEqual(['100px', '40px']);
    expect(harness.view.state().columns.slice(0, 2)).toEqual([{ id: 'name' }, { id: 'team', width: 1 }]);
  });

  it('drops a filter it cannot read, and keeps one it can', () => {
    const harness = setupFlat();
    const malformed: unknown[] = [
      null,
      'text',
      { type: 'regex', value: 'a' },
      { type: 'text', value: 1 },
      { type: 'text', value: 'a', operator: 'fuzzy' },
      { type: 'text', value: 'a', caseSensitive: 'yes' },
      { type: 'number', value: '5' },
      { type: 'number', value: Number.POSITIVE_INFINITY },
      { type: 'number', value: 5, operator: 'about' },
      // What JSON makes of a range open at the top.
      { type: 'number', value: 5, operator: 'between', to: null },
      { type: 'set', values: 'a' },
      { type: 'set', values: [{}] },
      { type: 'set', values: [undefined] },
    ];
    for (const filter of malformed) {
      expect(harness.view.apply({ version: GRID_STATE_VERSION, filters: { name: filter } })).toEqual({
        applied: true,
      });
      expect(harness.g.filters().size).toBe(0);
    }

    harness.view.apply({
      version: GRID_STATE_VERSION,
      filters: {
        // Fields no filter has ride nowhere; a bound only `between` reads is kept as given.
        salary: { type: 'number', value: 5, operator: 'between', to: 9, colour: 'red' },
        team: { type: 'set', values: ['east'], colour: 'red' },
        notes: { type: 'text', value: '', operator: 'contains', caseSensitive: true, colour: 'red' },
      },
    });
    expect(harness.g.filters()).toEqual(
      new Map<string, GridFilter>([
        ['team', { type: 'set', values: ['east'] }],
        ['salary', { type: 'number', value: 5, operator: 'between', to: 9 }],
        ['notes', { type: 'text', value: '', operator: 'contains', caseSensitive: true }],
      ]),
    );
  });

  it('keeps every operator a filter can name', () => {
    const harness = setupFlat();
    const text: readonly GridTextOperator[] = [
      'contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith',
    ];
    const number: readonly GridNumberOperator[] = [
      'equals', 'notEquals', 'greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual', 'between',
    ];
    for (const operator of text) {
      const filter: GridFilter = { type: 'text', value: 'a', operator };
      harness.view.apply({ version: GRID_STATE_VERSION, filters: { name: filter } });
      expect(harness.g.filters().get('name')).toEqual(filter);
    }
    for (const operator of number) {
      const filter: GridFilter = { type: 'number', value: 1, operator, to: 2 };
      harness.view.apply({ version: GRID_STATE_VERSION, filters: { salary: filter } });
      expect(harness.g.filters().get('salary')).toEqual(filter);
    }
  });

  it('puts a width the reader chose back to the column\'s default', () => {
    const harness = setupFlat();
    const defaults = headerWidths();
    harness.g.resizeColumn('name', 180);
    harness.g.resizeColumn('notes', 300);
    flushSync();
    expect(headerWidths()).toEqual(['180px', '100px', '100px', '300px']);

    harness.view.apply({ version: GRID_STATE_VERSION });
    flushSync();
    // Notes declares no width, so this is also the grid's own default and this
    // layer's copy of it agreeing.
    expect(headerWidths()).toEqual(defaults);
    expect(harness.view.state().columns.some((col) => 'width' in col)).toBe(false);
  });

  it('puts right the width of a column hidden at the time, once it is shown', () => {
    const harness = setupFlat();
    harness.g.resizeColumn('team', 250);
    harness.g.resizeColumn('salary', 260);
    harness.view.setColumnHidden('team', true);
    harness.view.setColumnHidden('salary', true);
    flushSync();

    harness.view.apply({
      version: GRID_STATE_VERSION,
      columns: [
        { id: 'name' },
        { id: 'team', hidden: true, width: 120 },
        { id: 'salary', hidden: true },
        { id: 'notes' },
      ],
    });
    flushSync();
    harness.view.setColumnHidden('team', false);
    harness.view.setColumnHidden('salary', false);
    flushSync();

    // The grid still held what the reader left: 250 and 260.
    expect(headerWidths()).toEqual(['100px', '120px', '100px', '150px']);
    expect(harness.view.state().columns[1]).toEqual({ id: 'team', width: 120 });
    expect(harness.view.state().columns[2]).toEqual({ id: 'salary' });
  });

  it('records the reader\'s next resize once a restore has put a width right', () => {
    const harness = setupFlat();
    harness.g.resizeColumn('name', 180);
    flushSync();
    harness.view.apply({ version: GRID_STATE_VERSION, columns: [{ id: 'name', width: 120 }] });
    flushSync();
    expect(headerWidths()[0]).toBe('120px');

    // The restore's own resize is not the reader's; the one after it is.
    harness.g.resizeColumn('name', 210);
    flushSync();
    expect(harness.view.state().columns[0]).toEqual({ id: 'name', width: 210 });
  });

  it('puts a restored width the reader then changed back to the declared one', () => {
    const harness = setupFlat();
    harness.view.apply({ version: GRID_STATE_VERSION, columns: [{ id: 'name', width: 180 }] });
    flushSync();
    harness.g.resizeColumn('name', 200);
    flushSync();
    expect(headerWidths()[0]).toBe('200px');

    // Listing every column, as a saved state does, with no width for any.
    harness.view.apply({
      version: GRID_STATE_VERSION,
      columns: [{ id: 'name' }, { id: 'team' }, { id: 'salary' }, { id: 'notes' }],
    });
    flushSync();
    // Not the 180 the first restore handed out: that was a restored width, and
    // this state restores none.
    expect(headerWidths()[0]).toBe('100px');
    expect(harness.view.state().columns[0]).toEqual({ id: 'name' });
  });

  it('restores without a grid to reach, and puts widths right once there is one', () => {
    let reachable: Grid<Person> | null = null;
    stateOptions = { grid: () => reachable };
    const harness = setupFlat();
    harness.g.resizeColumn('name', 180);
    flushSync();

    expect(harness.view.apply({ version: GRID_STATE_VERSION })).toEqual({ applied: true });
    flushSync();
    // Nothing could reach the width the grid holds, so it stands.
    expect(headerWidths()[0]).toBe('180px');

    reachable = harness.g;
    harness.view.apply({ version: GRID_STATE_VERSION });
    flushSync();
    expect(headerWidths()[0]).toBe('100px');
  });

  it('ignores a saved width for a column the reader cannot resize', () => {
    definitions.set([{ ...NAME, resizable: false }, TEAM, SALARY, NOTES]);
    const harness = setupFlat();
    harness.view.apply({ version: GRID_STATE_VERSION, columns: [{ id: 'name', width: 300 }] });
    flushSync();
    expect(headerWidths()[0]).toBe('100px');
    expect(harness.view.state().columns[0]).toEqual({ id: 'name' });
  });

  it('says nothing, since the reader did not ask', async () => {
    const harness = setupFlat();
    harness.view.apply({
      version: GRID_STATE_VERSION,
      sort: [{ columnId: 'salary', direction: 'descending' }],
      filters: { team: { type: 'text', value: 'east' } },
    });
    flushSync();
    expect(harness.g.rowCount()).toBe(3);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(document.querySelector("[data-volt-announcer='polite']")).toBeNull();
  });

  it('resets everything given nothing but a version', () => {
    const harness = setupGrouped();
    harness.view.moveColumn('salary', 0);
    harness.view.setColumnHidden('notes', true);
    harness.g.resizeColumn('name', 180);
    groupByState.set(['team']);
    harness.g.toggleSort('salary');
    harness.grouping.setFilter('salary', { type: 'number', operator: 'lessThan', value: 450 });
    harness.grouping.setQuickFilter('a');
    flushSync();
    harness.grouping.collapse('east');
    flushSync();

    harness.view.apply({ version: GRID_STATE_VERSION });
    flushSync();

    expect(harness.view.state()).toEqual({
      version: GRID_STATE_VERSION,
      columns: [{ id: 'name' }, { id: 'team' }, { id: 'salary' }, { id: 'notes' }],
      sort: [],
      filters: {},
      quickFilter: '',
      groupBy: [],
      collapsed: [],
    });
    expect(headers()).toEqual(['Name', 'Team', 'Salary', 'Notes']);
    expect(headerWidths()).toEqual(['100px', '100px', '100px', '150px']);
    expect(columnText(0)).toEqual(['Ada', 'Bea', 'Cy', 'Di', 'Ed']);
  });

  it('resets to the arrangement the page started with, not to an empty one', () => {
    // A page whose first visit is sorted, filtered, reordered and has a column
    // hidden: what a reader resetting their view expects to get back.
    sortState.set([{ columnId: 'name', direction: 'descending' }]);
    filterState.set(new Map<string, GridFilter>([['salary', { type: 'number', operator: 'greaterThan', value: 150 }]]));
    quickState.set('d');
    stateOptions = {
      order: new Signal.State<readonly string[]>(['salary', 'name']),
      hidden: new Signal.State<ReadonlySet<string>>(new Set(['notes'])),
    };
    const harness = setupFlat();
    const start = {
      state: harness.view.state(),
      headers: headers(),
      names: columnText(1),
    };
    expect(start.headers).toEqual(['Salary', 'Name', 'Team']);
    expect(start.names).toEqual(['Ed', 'Di', 'Ada']);

    harness.view.moveColumn('salary', 0);
    harness.view.setColumnHidden('notes', false);
    harness.g.toggleSort('salary');
    harness.g.setFilter('salary', null);
    harness.g.setQuickFilter('');
    flushSync();

    harness.view.apply({ version: GRID_STATE_VERSION });
    flushSync();
    expect({ state: harness.view.state(), headers: headers(), names: columnText(1) }).toEqual(start);
  });

  it('resets a grouped page to the grouping it started with', () => {
    groupByState.set(['team']);
    collapsedState.set(new Set(['west']));
    const harness = setupGrouped();
    const shown = (): (string | null)[][] =>
      rows().map((row) => [row.getAttribute('data-volt-grid-group'), row.getAttribute('aria-expanded')]);
    const start = { state: harness.view.state(), rows: shown() };
    expect(start.rows.slice(0, 2)).toEqual([['east', 'true'], [null, null]]);

    harness.grouping.expand('west');
    groupByState.set(['salary']);
    flushSync();

    harness.view.apply({ version: GRID_STATE_VERSION });
    flushSync();
    expect({ state: harness.view.state(), rows: shown() }).toEqual(start);
  });

  it('swaps what is hidden and what is shut, however many there were', () => {
    const harness = setupGrouped();
    groupByState.set(['team']);
    harness.view.setColumnHidden('notes', true);
    flushSync();
    harness.grouping.collapse('east');
    flushSync();

    // As many hidden and as many shut as there are now, just not the same ones.
    harness.view.apply({
      version: GRID_STATE_VERSION,
      columns: [{ id: 'name' }, { id: 'team' }, { id: 'salary', hidden: true }, { id: 'notes' }],
      groupBy: ['team'],
      collapsed: ['west'],
    });
    flushSync();
    expect(headers()).toEqual(['Name', 'Team', 'Notes']);
    expect(rows().map((row) => row.getAttribute('aria-expanded')).filter((open) => open !== null)).toEqual([
      'true',
      'false',
    ]);
  });

  it('leaves the grouping\'s signals alone when handed the state it already has', () => {
    const harness = setupGrouped();
    groupByState.set(['team']);
    harness.g.toggleSort('salary');
    harness.grouping.setFilter('name', { type: 'text', value: 'a' });
    flushSync();
    harness.grouping.collapse('east');
    flushSync();
    const before = [groupByState.get(), collapsedState.get(), sortState.get(), filterState.get()];

    harness.view.apply(stored(harness.view.state()));
    // The same values, not equal copies: whatever reads them is not woken.
    const after = [groupByState.get(), collapsedState.get(), sortState.get(), filterState.get()];
    after.forEach((value, i) => expect(value).toBe(before[i]));
  });

  it('changes nothing when handed the state it already has', () => {
    const harness = setupFlat();
    harness.view.moveColumn('salary', 0);
    harness.view.setColumnHidden('team', true);
    harness.g.resizeColumn('name', 180);
    harness.g.toggleSort('salary');
    harness.g.setFilter('salary', { type: 'number', operator: 'greaterThan', value: 150 });
    harness.g.setQuickFilter('d');
    flushSync();
    const seen = watch(harness.view);
    const before = harness.view.state();
    counts.value = 0;
    counts.sort = 0;
    counts.filter = 0;

    harness.view.apply(stored(before));
    flushSync();

    expect(counts).toEqual({ value: 0, sort: 0, filter: 0 });
    expect(seen.runs).toBe(1);
    expect(harness.view.state()).toBe(before);
  });
});

describe('what it costs', () => {
  it('derives the view once for a restore that both sorts and filters', () => {
    // What deriving that view once costs: both pieces written together.
    setupFlat();
    counts.sort = 0;
    sortState.set([{ columnId: 'salary', direction: 'descending' }]);
    filterState.set(new Map<string, GridFilter>([['team', { type: 'text', value: 'east' }]]));
    flushSync();
    const once = counts.sort;
    expect(once).toBeGreaterThan(0);
    teardown();
    fresh();

    const harness = setupFlat();
    counts.sort = 0;
    counts.filter = 0;

    harness.view.apply({
      version: GRID_STATE_VERSION,
      columns: [{ id: 'salary' }, { id: 'name', width: 180 }],
      sort: [{ columnId: 'salary', direction: 'descending' }],
      filters: { team: { type: 'text', value: 'east' } },
      quickFilter: '',
    });
    flushSync();

    // One filter pass, each row's team read once, and one sort of the rows it
    // left. A view derived between the pieces would have sorted all five.
    expect(counts.filter).toBe(PEOPLE.length);
    expect(counts.sort).toBe(once);
    expect(columnText(0)).toEqual(['500', '300', '200']);
  });

  it('re-reads only the cells of the columns a move moved, grouped or not', () => {
    /** Every accessor run, by the column it belongs to. */
    const byColumn = new Map<string, number>();
    const counted = (id: string, read: (row: Person) => unknown, width?: number): GridColumn<Person> => ({
      id,
      header: id,
      width,
      value: (row) => {
        byColumn.set(id, (byColumn.get(id) ?? 0) + 1);
        return read(row);
      },
    });
    const own = (): GridColumn<Person>[] => [
      counted('name', (row) => row.name.get(), 100),
      counted('team', (row) => row.team, 100),
      counted('salary', (row) => row.salary, 100),
      counted('notes', () => ''),
    ];

    for (const grouped of [false, true]) {
      teardown();
      fresh();
      definitions.set(own());
      if (grouped) groupByState.set(['team']);
      const { view } = grouped ? setupGrouped() : setupFlat();
      byColumn.clear();

      // Notes and Salary trade places. Name and Team stay where they were, and
      // not one of their cells is asked again what it holds.
      view.moveColumn('notes', 2);
      flushSync();
      expect(headers()).toEqual(['name', 'team', 'notes', 'salary']);
      expect(byColumn.get('name') ?? 0).toBe(0);
      expect(byColumn.get('salary')).toBe(PEOPLE.length);
      expect(byColumn.get('notes')).toBe(PEOPLE.length);
    }
  });

  it('records a resize without re-sorting or re-filtering a row', () => {
    const harness = setupFlat();
    harness.g.toggleSort('salary');
    harness.g.setFilter('team', { type: 'text', value: 'east' });
    flushSync();
    counts.sort = 0;
    counts.filter = 0;

    harness.g.resizeColumn('name', 180);
    flushSync();
    expect(harness.view.state().columns[0]).toEqual({ id: 'name', width: 180 });
    expect(counts).toMatchObject({ sort: 0, filter: 0 });
  });
});
