/**
 * Row grouping, driven through a real mounted grid.
 *
 * The thing worth proving is that a grouped grid is still a grid: the group
 * headers are rows of the same virtualized collection, the counting attributes
 * describe what is actually there once a group is shut, aggregates are over the
 * rows a filter left, and a cell that changes still writes one text node.
 *
 * happy-dom lays nothing out, so every size is stated rather than measured and
 * the viewport arrives through a `ResizeObserver` that reports what a test
 * hands it, exactly as in `grid.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAnnouncer } from '@voltdev/primitives';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import {
  GRID_CELL_ATTRIBUTE,
  GRID_GROUP_ATTRIBUTE,
  createGrid,
  createGrouping,
  type Grid,
  type GridAggregation,
  type GridColumn,
  type GridGroupSpec,
  type GridGroupedRow,
  type GridGrouping,
  type GridRow,
  type GridSort,
} from '../src/index.ts';

/** A row whose every cell is a signal, so one value can be changed on its own. */
interface Person {
  readonly id: number;
  readonly cells: readonly Signal.State<string>[];
}

const ROW_HEIGHT = 20;
const COLUMN_WIDTH = 100;
/** Five rows and three columns are on screen; two more of each are overscan. */
const VIEWPORT_HEIGHT = 100;
const VIEWPORT_WIDTH = 300;

/** Every *rendering* accessor call, as `row:column`. */
let reads: string[] = [];

/**
 * Three columns, of which the third holds a number.
 *
 * The aggregation and filter accessors below read the same signals without the
 * bookkeeping: `reads` is the instrument for what re-rendered, and a total
 * being recomputed is not a cell re-reading its own value.
 */
function makeColumns(): GridColumn<Person>[] {
  return ['c0', 'c1', 'c2'].map((id, index) => ({
    id,
    header: `Column ${index}`,
    width: COLUMN_WIDTH,
    value: (row: Person) => {
      reads.push(`${row.id}:${index}`);
      return row.cells[index]!.get();
    },
    sortValue: (row: Person) => row.cells[index]!.get(),
    filterValue: (row: Person) => row.cells[index]!.get(),
  }));
}

/** The accessor an aggregate uses, which is not a cell rendering itself. */
const amount = (row: Person): unknown => row.cells[2]!.get();

const TABLE: readonly (readonly string[])[] = [
  ['east', 'london', '1'],
  ['east', 'paris', '2'],
  ['west', 'london', '4'],
  ['west', 'london', '8'],
];

function tableOf(cells: readonly (readonly string[])[]): Person[] {
  return cells.map((values, id) => ({
    id,
    cells: values.map((value) => new Signal.State(value)),
  }));
}

/** Three groups of twenty, which is more rows than a window holds. */
function manyRows(): Person[] {
  const rows: string[][] = [];
  for (let group = 0; group < 3; group++) {
    for (let i = 0; i < 20; i++) rows.push([`g${group}`, `city${i}`, String(i)]);
  }
  return tableOf(rows);
}

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;

let people: Signal.State<readonly Person[]>;
let columns: Signal.State<readonly GridColumn<Person>[]>;
let groupBy: Signal.State<readonly (string | GridGroupSpec<Person>)[]>;
let aggregations: Signal.State<readonly GridAggregation<Person>[]>;
let sortState: Signal.State<readonly GridSort[]>;
let collapsedState: Signal.State<ReadonlySet<string>>;

interface Measurement {
  target: Element;
  block: number;
  inline: number;
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

  static deliver(measurements: Measurement[]): void {
    const entries = measurements.map(({ target, block, inline }) => {
      const box: ResizeObserverSize = { blockSize: block, inlineSize: inline };
      return {
        target,
        borderBoxSize: [box],
        contentBoxSize: [box],
        devicePixelContentBoxSize: [box],
      } as unknown as ResizeObserverEntry;
    });
    for (const observer of FakeResizeObserver.live) {
      const seen = entries.filter((entry) => observer.targets.has(entry.target));
      if (seen.length > 0) observer.callback(seen, observer as unknown as ResizeObserver);
    }
    flushSync();
  }
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;

  reads = [];
  people = new Signal.State<readonly Person[]>(tableOf(TABLE));
  columns = new Signal.State<readonly GridColumn<Person>[]>(makeColumns());
  // The group key read without the bookkeeping, for the same reason the sort
  // and filter accessors are: re-grouping is not a cell rendering, and mixing
  // the two would make the fine-grained assertions below unreadable. The
  // default, where the key falls back to the column's own accessor, is covered
  // on its own.
  groupBy = new Signal.State<readonly (string | GridGroupSpec<Person>)[]>([
    { columnId: 'c0', value: (row) => row.cells[0]!.get() },
  ]);
  aggregations = new Signal.State<readonly GridAggregation<Person>[]>([]);
  sortState = new Signal.State<readonly GridSort[]>([]);
  collapsedState = new Signal.State<ReadonlySet<string>>(new Set());

  FakeResizeObserver.live = [];
  const view = window as unknown as { ResizeObserver: unknown };
  const original = view.ResizeObserver;
  view.ResizeObserver = FakeResizeObserver;
  restores.push(() => {
    view.ResizeObserver = original;
  });
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  resetAnnouncer();
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
});

/**
 * The props of both layers, merged where a consumer would merge them.
 *
 * The grid owns the row's role, index and height; the grouping adds what makes
 * it a group header. Neither knows about the other's attributes.
 */
const TEMPLATE = `
  <div class="grid" :ref="grid" :spread="g.gridProps()"
       :keydown="onKey($event)" :focusin="g.onFocusIn($event)">
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
                 :click="onCellClick($event)">{ cellText(row, col) }</div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

interface GroupedInstance {
  g: Grid<GridGroupedRow<Person>>;
  grouping: GridGrouping<Person>;
  handled: boolean;
}

interface Harness {
  g: Grid<GridGroupedRow<Person>>;
  grouping: GridGrouping<Person>;
  instance: GroupedInstance;
  root: HTMLElement;
  scroller: HTMLElement;
}

function setup({ height = VIEWPORT_HEIGHT, width = VIEWPORT_WIDTH } = {}): Harness {
  @Component({ selector: `v-group-${++selectors}`, render: compileTemplate(TEMPLATE) })
  class GroupedGrid {
    grid = new Signal.State<Element | null>(null);
    scroller = new Signal.State<Element | null>(null);
    container = new Signal.State<Element | null>(null);
    handled = false;

    grouping = createGrouping<Person>({
      rows: () => people.get(),
      columns: () => columns.get(),
      groupBy: () => groupBy.get(),
      aggregations: () => aggregations.get(),
      getRowKey: (row) => row.id,
      collapsed: collapsedState,
      sort: sortState,
    });

    g = createGrid<GridGroupedRow<Person>>({
      grid: () => this.grid.get(),
      scroller: () => this.scroller.get(),
      container: () => this.container.get(),
      rows: () => this.grouping.rows(),
      columns: () => this.grouping.columns(),
      getRowKey: this.grouping.rowKey,
      sort: sortState,
      rowHeight: ROW_HEIGHT,
      label: 'People',
    });

    rowProps(row: GridRow<GridGroupedRow<Person>>): Record<string, unknown> {
      return { ...this.g.rowProps(row), ...this.grouping.rowProps(row.item) };
    }

    /** A group header shows its label in the first column and its totals after. */
    cellText(row: GridRow<GridGroupedRow<Person>>, col: { index: number }): string {
      if (row.item.kind === 'group' && col.index === 0) return this.grouping.label(row.item);
      const value = this.g.cellValue(row, col as never);
      return value === null || value === undefined ? '' : String(value);
    }

    onKey(event: KeyboardEvent): void {
      this.handled = this.grouping.onKeyDown(event) || this.g.onKeyDown(event);
    }

    onCellClick(event: MouseEvent): void {
      // The grouping first: a click on a group header is a twisty and nothing
      // else, and the grid's own handler would read it as a row selection.
      if (this.grouping.onGroupClick(event)) return;
      this.g.onCellClick(event);
    }
  }

  const handle = mount(GroupedGrid, host);
  mounted.push(handle);

  const scroller = host.querySelector<HTMLElement>('.body')!;
  Object.defineProperty(scroller, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(scroller, 'clientWidth', { value: width, configurable: true });
  FakeResizeObserver.deliver([{ target: scroller, block: height, inline: width }]);

  const instance = handle.instance as GroupedInstance;
  return {
    g: instance.g,
    grouping: instance.grouping,
    instance,
    root: host.querySelector<HTMLElement>('.grid')!,
    scroller,
  };
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.row')];
}

function cells(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.cell')];
}

function cellAt(row: number, column: number): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[${GRID_CELL_ATTRIBUTE}="${row},${column}"]`);
}

/** What one column of the rendered window says, top to bottom. */
function columnText(index: number): (string | null)[] {
  return rows().map((row) => row.querySelectorAll('.cell')[index]?.textContent ?? null);
}

function attrs(selector: string, name: string): (string | null)[] {
  return [...host.querySelectorAll<HTMLElement>(selector)].map((el) => el.getAttribute(name));
}

function press(el: Element, key: string, modifiers: Partial<KeyboardEventInit> = {}): void {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
  );
  flushSync();
}

function click(el: Element, modifiers: Partial<MouseEventInit> = {}): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers }));
  flushSync();
}

function userScroll(el: HTMLElement, { top = 0, left = 0 } = {}): void {
  el.scrollTop = top;
  el.scrollLeft = left;
  el.dispatchEvent(new Event('scroll'));
  flushSync();
}

// ---------------------------------------------------------------------------

describe('a group header is a row of the collection', () => {
  it('puts each header in front of the rows it describes', () => {
    const harness = setup();

    expect(harness.grouping.rows().map((row) => row.kind)).toEqual([
      'group', 'data', 'data', 'group', 'data', 'data',
    ]);
    // And in the DOM, as rows of the same rowgroup rather than a list beside it.
    expect(rows()).toHaveLength(6);
    expect(attrs('.row', 'data-group')).toEqual(['', null, null, '', null, null]);
    expect(columnText(0)).toEqual(['east', 'east', 'east', 'west', 'west', 'west']);
    expect(columnText(1)).toEqual(['', 'london', 'paris', '', 'london', 'london']);
  });

  it('groups by the column accessor when the level names nothing else', () => {
    groupBy.set(['c1']);
    const harness = setup();
    expect(harness.grouping.tree().map((node) => node.label)).toEqual(['london', 'paris']);
    expect(harness.grouping.tree()[0]!.count).toBe(3);
  });

  it('drops a level naming a column that is no longer there', () => {
    groupBy.set(['c0', 'gone']);
    const harness = setup();
    // A saved view outlives the columns it was saved against.
    expect(harness.grouping.tree().map((node) => node.label)).toEqual(['east', 'west']);
    expect(harness.grouping.tree()[0]!.children).toEqual([]);
  });

  it('carries the path on the header row, for whatever wants to toggle it', () => {
    groupBy.set(['c0', 'c1']);
    setup();
    expect(rows()[0]!.getAttribute(GRID_GROUP_ATTRIBUTE)).toBe('east');
    // Joined to its parent's, so two `london` groups under different regions
    // are two groups and not one.
    expect(rows()[1]!.getAttribute(GRID_GROUP_ATTRIBUTE)).toBe('east\u001flondon');
    expect(rows()[2]!.getAttribute(GRID_GROUP_ATTRIBUTE)).toBeNull();
  });

  it('counts the headers and the rows as one collection', () => {
    const harness = setup();
    // Six rows and the column header, not four rows and the column header: a
    // reader stepping through them meets the group headings too.
    expect(harness.root.getAttribute('aria-rowcount')).toBe('7');
    expect(harness.g.rowCount()).toBe(6);
    expect(harness.grouping.filteredRowCount()).toBe(4);
  });

  it('numbers the rows through the headers, so nothing is announced twice', () => {
    setup();
    expect(attrs('.row', 'aria-rowindex')).toEqual(['2', '3', '4', '5', '6', '7']);
  });

  it('says how deep a row sits, headers and rows alike', () => {
    groupBy.set(['c0', 'c1']);
    const harness = setup();

    expect(harness.grouping.rows().map((row) => row.depth)).toEqual([0, 1, 2, 1, 2, 0, 1, 2, 2]);
    // ARIA levels are 1-based, and a row under two headings is at level three.
    // Seven of the nine are rendered, which is what a window of five rows and
    // two of overscan holds.
    expect(attrs('.row', 'aria-level')).toEqual(['1', '2', '3', '2', '3', '1', '2']);
  });

  it('nests groups, outermost first', () => {
    groupBy.set(['c0', 'c1']);
    const harness = setup();

    // A heading, its sub-heading, then the row: three levels of the same
    // collection, of which the window holds seven rows.
    expect(columnText(0)).toEqual([
      'east', 'london', 'east', 'paris', 'east', 'west', 'london',
    ]);
    const tree = harness.grouping.tree();
    expect(tree.map((node) => node.label)).toEqual(['east', 'west']);
    expect(tree[0]!.children.map((node) => node.label)).toEqual(['london', 'paris']);
    expect(tree[1]!.children.map((node) => node.label)).toEqual(['london']);
    expect(tree[1]!.children[0]!.count).toBe(2);
  });

  it('keeps a header in the same window as its rows', () => {
    people.set(manyRows());
    const harness = setup();

    // Sixty rows and three headings, of which a window's worth is rendered.
    expect(harness.g.rowCount()).toBe(63);
    expect(rows().length).toBeLessThan(12);

    // The second heading is row 21 of the collection. Scrolling to it renders
    // it between the rows it separates, out of the same virtualizer.
    userScroll(harness.scroller, { top: 21 * ROW_HEIGHT });
    const rendered = harness.g.rows().map((row) => row.item.kind);
    expect(rendered).toContain('group');
    expect(rendered).toContain('data');
    expect(harness.g.rows().find((row) => row.item.kind === 'group')!.index).toBe(21);
  });
});

describe('expanding and collapsing', () => {
  it('marks a header expanded, and says so when it is not', () => {
    const harness = setup();
    expect(attrs('.row', 'aria-expanded')).toEqual(['true', null, null, 'true', null, null]);

    harness.grouping.collapse('east');
    flushSync();
    expect(attrs('.row', 'aria-expanded')).toEqual(['false', 'true', null, null]);
  });

  it('takes a collapsed group out of the collection, and out of the count', () => {
    const harness = setup();

    harness.grouping.collapse('east');
    flushSync();

    // The two rows under it are not rendered, not in the model, and not in the
    // number a screen reader is told.
    expect(harness.grouping.rows().map((row) => row.kind)).toEqual(['group', 'group', 'data', 'data']);
    expect(rows()).toHaveLength(4);
    expect(harness.g.rowCount()).toBe(4);
    expect(harness.root.getAttribute('aria-rowcount')).toBe('5');
    expect(attrs('.row', 'aria-rowindex')).toEqual(['2', '3', '4', '5']);
  });

  it('leaves the rows of the groups that are still open', () => {
    const harness = setup();
    harness.grouping.collapse('west');
    flushSync();

    expect(columnText(1)).toEqual(['', 'london', 'paris', '']);
    expect(harness.grouping.isExpanded('east')).toBe(true);
    expect(harness.grouping.isExpanded('west')).toBe(false);
  });

  it('toggles a group from a click on its header row', () => {
    const harness = setup();

    click(cellAt(0, 1)!);
    expect(harness.grouping.isExpanded('east')).toBe(false);
    expect(rows()).toHaveLength(4);

    click(cellAt(0, 1)!);
    expect(harness.grouping.isExpanded('east')).toBe(true);
    expect(rows()).toHaveLength(6);
  });

  it('leaves a click on a data row to the grid', () => {
    const harness = setup();
    click(cellAt(1, 0)!);
    // Nothing collapsed, and nothing threw: the grouping did not claim it.
    expect(harness.grouping.rows()).toHaveLength(6);
    expect(rows()).toHaveLength(6);
  });

  it('collapses and expands from the first cell with the arrows', () => {
    const harness = setup();

    press(cellAt(0, 0)!, 'ArrowLeft');
    expect(harness.grouping.isExpanded('east')).toBe(false);
    expect(harness.instance.handled).toBe(true);

    press(cellAt(0, 0)!, 'ArrowRight');
    expect(harness.grouping.isExpanded('east')).toBe(true);
  });

  it('toggles from Enter wherever the cursor is on the header row', () => {
    const harness = setup();
    press(cellAt(0, 2)!, 'Enter');
    expect(harness.grouping.isExpanded('east')).toBe(false);
  });

  it('leaves the arrows to the grid everywhere they would move the cursor', () => {
    const harness = setup();

    // On a group header, but not on the cell with the twisty: the reader is
    // walking the columns, and the grid moves them.
    press(cellAt(0, 1)!, 'ArrowLeft');
    expect(harness.grouping.isExpanded('east')).toBe(true);
    press(cellAt(0, 1)!, 'ArrowRight');
    expect(harness.grouping.isExpanded('east')).toBe(true);
    // The grid moved the cursor from where it was, which is what the key is
    // for everywhere but the twisty.
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 1 });

    // And on a data row, where there is no group to open at all.
    press(cellAt(1, 0)!, 'ArrowLeft');
    expect(harness.grouping.rows()).toHaveLength(6);
  });

  it('leaves an arrow that would do nothing to the grid as well', () => {
    const harness = setup();
    harness.grouping.collapse('east');
    flushSync();

    // Collapsed already: ArrowLeft has nothing to collapse, so it moves.
    harness.g.focusCell({ row: 0, column: 1 });
    flushSync();
    press(cellAt(0, 0)!, 'ArrowLeft');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
    expect(harness.grouping.isExpanded('east')).toBe(false);
  });

  it('shuts every group at once, and opens them again', () => {
    groupBy.set(['c0', 'c1']);
    const harness = setup();

    harness.grouping.collapseAll();
    flushSync();
    expect(harness.grouping.rows().map((row) => row.kind)).toEqual(['group', 'group']);
    expect(harness.root.getAttribute('aria-rowcount')).toBe('3');

    harness.grouping.expandAll();
    flushSync();
    expect(harness.grouping.rows()).toHaveLength(9);
  });

  it('lets a consumer drive expansion from a signal it holds', () => {
    const reported: string[][] = [];
    collapsedState = new Signal.State<ReadonlySet<string>>(new Set(['west']));
    const harness = setup();
    // The grid opens on what the signal already said, rather than opening
    // everything and collapsing a frame later.
    expect(rows()).toHaveLength(4);
    expect(attrs('.row', 'aria-expanded')).toEqual(['true', null, null, 'false']);

    harness.grouping.toggle('west');
    flushSync();
    reported.push([...collapsedState.get()]);
    expect(reported).toEqual([[]]);
    expect(rows()).toHaveLength(6);
  });

  it('holds expansion by path, so a filter cannot lose it', () => {
    const harness = setup();
    harness.grouping.collapse('west');
    flushSync();

    harness.grouping.setFilter('c1', { type: 'text', value: 'london' });
    flushSync();

    // 'west' still has a row, and is still shut.
    expect(harness.grouping.isExpanded('west')).toBe(false);
    expect(columnText(0)).toEqual(['east', 'east', 'west']);
  });
});

describe('aggregation', () => {
  it('computes each named aggregate over the rows of its group', () => {
    aggregations.set([
      { columnId: 'c1', kind: 'count' },
      { columnId: 'c2', kind: 'sum', value: amount },
    ]);
    const harness = setup();

    const [east, west] = harness.grouping.tree();
    expect(east!.aggregates.get('c1')).toBe(2);
    expect(east!.aggregates.get('c2')).toBe(3);
    expect(west!.aggregates.get('c2')).toBe(12);
    // And they are what the header row's own cells show.
    expect(columnText(2)).toEqual(['3', '1', '2', '12', '4', '8']);
  });

  it('computes the least, the most and the mean', () => {
    aggregations.set([
      { columnId: 'c2', kind: 'min', value: amount },
      { columnId: 'c1', kind: 'max', value: amount },
      { columnId: 'c0', kind: 'average', value: amount },
    ]);
    const harness = setup();

    const [east, west] = harness.grouping.tree();
    expect(east!.aggregates.get('c2')).toBe(1);
    expect(east!.aggregates.get('c1')).toBe(2);
    expect(east!.aggregates.get('c0')).toBe(1.5);
    expect(west!.aggregates.get('c2')).toBe(4);
    expect(west!.aggregates.get('c1')).toBe(8);
    expect(west!.aggregates.get('c0')).toBe(6);
  });

  it('takes an aggregate of the callers own over the whole group', () => {
    aggregations.set([
      {
        columnId: 'c1',
        kind: (group) => group.map((row) => row.cells[1]!.get()).join('+'),
      },
    ]);
    const harness = setup();

    expect(harness.grouping.tree()[0]!.aggregates.get('c1')).toBe('london+paris');
    expect(columnText(1)).toEqual(['london+paris', 'london', 'paris', 'london+london', 'london', 'london']);
  });

  it('skips the values that are not numbers rather than counting them as zero', () => {
    people.set(tableOf([
      ['east', 'london', '4'],
      ['east', 'paris', ''],
      ['east', 'rome', '8'],
    ]));
    aggregations.set([
      { columnId: 'c2', kind: 'average', value: amount },
      { columnId: 'c1', kind: 'count' },
    ]);
    const harness = setup();

    // Six, not four: the row with no amount is a row with no amount, and not a
    // row that has none of it. The count still counts it, because a count is
    // over rows and not over values.
    expect(harness.grouping.tree()[0]!.aggregates.get('c2')).toBe(6);
    expect(harness.grouping.tree()[0]!.aggregates.get('c1')).toBe(3);
  });

  it('says nothing rather than zero for a group with nothing to total', () => {
    people.set(tableOf([['east', 'london', ''], ['east', 'paris', '']]));
    aggregations.set([{ columnId: 'c2', kind: 'sum', value: amount }]);
    const harness = setup();
    expect(harness.grouping.tree()[0]!.aggregates.get('c2')).toBeNull();
  });

  it('falls back to the column accessor when an aggregate names none', () => {
    aggregations.set([{ columnId: 'c2', kind: 'sum' }]);
    const harness = setup();
    expect(harness.grouping.tree()[0]!.aggregates.get('c2')).toBe(3);
  });

  it('totals the rows a filter left, and not the rows it removed', () => {
    aggregations.set([
      { columnId: 'c2', kind: 'sum', value: amount },
      { columnId: 'c1', kind: 'count' },
    ]);
    const harness = setup();
    expect(harness.grouping.tree()[1]!.aggregates.get('c2')).toBe(12);

    // Only one of west's two rows survives.
    harness.grouping.setFilter('c2', { type: 'number', value: 5, operator: 'lessThan' });
    flushSync();

    expect(harness.grouping.tree()[1]!.aggregates.get('c2')).toBe(4);
    expect(harness.grouping.tree()[1]!.aggregates.get('c1')).toBe(1);
    expect(harness.grouping.filteredRowCount()).toBe(3);
    expect(harness.grouping.sourceRowCount()).toBe(4);
  });

  it('drops a group the filter emptied', () => {
    const harness = setup();
    harness.grouping.setFilter('c0', { type: 'text', value: 'east' });
    flushSync();

    expect(harness.grouping.tree().map((node) => node.label)).toEqual(['east']);
    expect(rows()).toHaveLength(3);
    expect(harness.root.getAttribute('aria-rowcount')).toBe('4');
  });

  it('searches every column with the quick filter, before grouping', () => {
    const harness = setup();
    harness.grouping.setQuickFilter('paris');
    flushSync();

    expect(columnText(1)).toEqual(['', 'paris']);
    expect(harness.grouping.quickFilter()).toBe('paris');

    harness.grouping.clearFilters();
    flushSync();
    expect(rows()).toHaveLength(6);
  });
});

describe('the rows stay the callers', () => {
  it('never reorders or rewrites the array it was given', () => {
    const harness = setup();
    const source = people.get();
    const order = [...source];

    harness.grouping.setFilter('c1', { type: 'text', value: 'london' });
    flushSync();
    harness.grouping.collapse('east');
    flushSync();

    expect(people.get()).toBe(source);
    expect(source.every((row, index) => row === order[index])).toBe(true);
    // And the objects inside the flattened view are the caller's own.
    const data = harness.grouping.rows().filter((row) => row.kind === 'data');
    expect(data.map((row) => (row.kind === 'data' ? row.item : null))).toEqual([source[2], source[3]]);
  });

  it('orders the groups by the sort the grid header drives', () => {
    const harness = setup();
    expect(harness.grouping.tree().map((node) => node.label)).toEqual(['east', 'west']);

    // The header belongs to the grid; the ordering is applied before grouping.
    const header = host.querySelectorAll<HTMLElement>('.th')[0]!;
    click(header);
    click(header);
    expect(harness.g.sortDirection('c0')).toBe('descending');
    expect(header.getAttribute('aria-sort')).toBe('descending');

    expect(harness.grouping.tree().map((node) => node.label)).toEqual(['west', 'east']);
    // And the grid's own sort of the already-grouped list moved nothing: every
    // header still sits in front of its own rows.
    expect(columnText(0)).toEqual(['west', 'west', 'west', 'east', 'east', 'east']);
    expect(columnText(1)).toEqual(['', 'london', 'london', '', 'london', 'paris']);
  });

  it('orders the rows inside a group by a second sort term', () => {
    sortState.set([
      { columnId: 'c0', direction: 'ascending' },
      { columnId: 'c2', direction: 'descending' },
    ]);
    const harness = setup();

    expect(columnText(2)).toEqual(['', '2', '1', '', '8', '4']);
    expect(harness.grouping.tree().map((node) => node.label)).toEqual(['east', 'west']);
  });
});

describe('a cell still owns its own binding', () => {
  it('writes one text node when a value changes, and re-renders nothing', () => {
    const harness = setup();
    const before = cells();
    const texts = before.map((cell) => cell.firstChild);
    reads = [];

    people.get()[3]!.cells[1]!.set('changed');
    flushSync();

    // One accessor ran: the cell that reads that signal. Not the row it is in,
    // not the group header above it, not the window.
    expect(reads).toEqual(['3:1']);
    expect(cellAt(5, 1)!.textContent).toBe('changed');
    expect(cells()).toEqual(before);
    expect(cells().map((cell) => cell.firstChild)).toEqual(texts);
    expect(harness.grouping.rows()).toHaveLength(6);
  });

  it('rebuilds only the header whose total moved', () => {
    aggregations.set([{ columnId: 'c2', kind: 'sum', value: amount }]);
    const harness = setup();
    const before = cells();
    const texts = before.map((cell) => cell.firstChild);
    reads = [];

    // A value inside east. West's total is unchanged, so west's header is
    // handed back as the same node and its cells are never asked again.
    people.get()[0]!.cells[2]!.set('16');
    flushSync();

    expect(harness.grouping.tree()[0]!.aggregates.get('c2')).toBe(18);
    expect(cellAt(0, 2)!.textContent).toBe('18');
    expect(cellAt(3, 2)!.textContent).toBe('12');
    // Only the one data cell re-read its own value; the headers read no
    // accessor at all, because an aggregate is not a cell rendering.
    expect(reads).toEqual(['0:2']);
    // Same elements, same text nodes, updated in place.
    expect(cells()).toEqual(before);
    expect(cells().map((cell) => cell.firstChild)).toEqual(texts);
  });

  it('hands back the same group when nothing about it changed', () => {
    aggregations.set([{ columnId: 'c2', kind: 'sum', value: amount }]);
    const harness = setup();
    const [east, west] = harness.grouping.tree();

    people.get()[0]!.cells[2]!.set('16');
    flushSync();

    // An aggregate subscribes to the values it totals, so one cell changing
    // rebuilds the whole tree. West's total did not move, so west is the same
    // object it was — and the header row rendering it is not touched.
    const [nextEast, nextWest] = harness.grouping.tree();
    expect(nextEast).not.toBe(east);
    expect(nextWest).toBe(west);
  });

  it('rebuilds no cell when a group below the window is collapsed', () => {
    people.set(manyRows());
    const harness = setup();
    const before = cells();
    const texts = before.map((cell) => cell.firstChild);
    reads = [];

    // The third group starts forty rows below anything on screen.
    harness.grouping.collapse('g2');
    flushSync();

    expect(harness.g.rowCount()).toBe(43);
    expect(reads).toEqual([]);
    expect(cells()).toEqual(before);
    expect(cells().map((cell) => cell.firstChild)).toEqual(texts);
  });

  it('reads only the rows that appeared when a group is opened', () => {
    collapsedState = new Signal.State<ReadonlySet<string>>(new Set(['west']));
    const harness = setup();
    const above = cellAt(1, 1)!;
    reads = [];

    harness.grouping.expand('west');
    flushSync();

    // West's two rows were built. Nothing above them moved, so east's heading
    // and both its rows were never asked what they hold — and the elements
    // they were already rendered into are the same elements.
    expect(reads.sort()).toEqual(['2:0', '2:1', '2:2', '3:0', '3:1', '3:2']);
    expect(cellAt(1, 1)).toBe(above);
    expect(columnText(1)).toEqual(['', 'london', 'paris', '', 'london', 'london']);
  });
});
