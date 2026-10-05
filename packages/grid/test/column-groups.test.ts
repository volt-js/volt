/**
 * Column groups and the header rows they make, driven through a real mounted
 * component.
 *
 * A group is a heading over a run of columns, so what is worth testing is what
 * the grid tells the page about each header row: which cells it holds, how many
 * columns each spans, how wide each is drawn while the window holds only part
 * of a run, and what a screen reader is told about the rows and the spans. Then
 * the keyboard through the rows of groups, a group's resize shared among its
 * columns, and the saved view's part — a group shut to its first column, and
 * a group's columns kept together however they are moved. A grid with no
 * groups is checked against what it handed out before.
 *
 * happy-dom lays nothing out, so the viewport arrives through a
 * `ResizeObserver` that reports what a test hands it, as in `grid.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAnnouncer } from '@voltdev/primitives';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, flushSync, mount } from '@voltdev/core';
import {
  GRID_CELL_ATTRIBUTE,
  GRID_COLUMN_GROUP_RESIZER_ATTRIBUTE,
  GRID_RESIZER_ATTRIBUTE,
  HEADER_ROW,
  createCellEditing,
  createGrid,
  createGridClipboard,
  createGridState,
  createGrouping,
  type Grid,
  type GridColumn,
  type GridColumnGroup,
  type GridColumnPin,
  type GridHeaderCell,
  type GridOptions,
  type GridStateLayer,
} from '../src/index.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Person {
  readonly id: number;
  readonly cells: readonly Signal.State<string>[];
}

const ROW_COUNT = 1000;
const COLUMN_COUNT = 12;
const ROW_HEIGHT = 20;
const COLUMN_WIDTH = 100;
/** Five rows and three columns of it are on screen; the rest is overscan. */
const VIEWPORT_HEIGHT = 100;
const VIEWPORT_WIDTH = 300;

const NAME: GridColumnGroup = { id: 'name', header: 'Name' };
const WORK: GridColumnGroup = { id: 'work', header: 'Work' };
const ROLE: GridColumnGroup = { id: 'role', header: 'Role', parent: WORK };
const PAY: GridColumnGroup = { id: 'pay', header: 'Pay', parent: WORK };
const OTHER: GridColumnGroup = { id: 'other', header: 'Other' };

/**
 * c0–c1 under Name; c2–c4 under Work › Role; c5–c6 under Work › Pay; c7 under
 * nothing; c8–c11 under Other. Two rows of groups, then the columns.
 */
const GROUPS: Readonly<Record<string, GridColumnGroup>> = {
  c0: NAME,
  c1: NAME,
  c2: ROLE,
  c3: ROLE,
  c4: ROLE,
  c5: PAY,
  c6: PAY,
  c8: OTHER,
  c9: OTHER,
  c10: OTHER,
  c11: OTHER,
};

/** Every rendering accessor call, as `row:column`. */
let reads: string[] = [];

function makePeople(count: number): Person[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    cells: Array.from({ length: COLUMN_COUNT }, (_, col) => new Signal.State(`r${id}c${col}`)),
  }));
}

/** Twelve columns, `c0` to `c11`, under the groups given and with anything else a test adds. */
function makeColumns(
  groups: Readonly<Record<string, GridColumnGroup>> = GROUPS,
  extra: Readonly<Record<string, Partial<GridColumn<Person>>>> = {},
): GridColumn<Person>[] {
  return Array.from({ length: COLUMN_COUNT }, (_, index) => {
    const id = `c${index}`;
    return {
      id,
      header: `Column ${index}`,
      width: COLUMN_WIDTH,
      value: (row: Person) => {
        reads.push(`${row.id}:${index}`);
        return row.cells[index]!.get();
      },
      sortValue: (row: Person) => row.cells[index]!.get(),
      filterValue: (row: Person) => row.cells[index]!.get(),
      ...(id in groups ? { group: groups[id] } : {}),
      ...extra[id],
    };
  });
}

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;

let people: Signal.State<readonly Person[]>;
let columns: Signal.State<readonly GridColumn<Person>[]>;
let gridOptions: Omit<GridOptions<Person>, 'grid' | 'scroller' | 'container' | 'rows' | 'columns'>;
/** A view layer to put between the columns and the grid, or null for none. */
let layer: ((columns: () => readonly GridColumn<Person>[]) => GridStateLayer<Person>) | null;

interface Measurement {
  target: Element;
  block: number;
  inline: number;
}

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
  people = new Signal.State<readonly Person[]>(makePeople(ROW_COUNT));
  columns = new Signal.State<readonly GridColumn<Person>[]>(makeColumns());
  gridOptions = { rowHeight: ROW_HEIGHT, label: 'People', getRowKey: (row) => row.id };
  layer = null;

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

/** Every header row, every cell in it, each with its resize handle. */
const TEMPLATE = `
  <div class="grid" :ref="grid" :spread="g.gridProps()"
       :keydown="onKey($event)" :focusin="g.onFocusIn($event)">
    <div class="header" :spread="g.headerProps()">
      <div class="header-row" :for="hr in g.headerRows()" :key="hr.key" :spread="g.headerRowProps(hr)">
        <div class="th" :for="cell in hr.cells" :key="cell.key" :spread="g.headerCellProps(cell)"
             :click="g.onHeaderClick($event)"><span class="label">{ cell.header }</span><span
             class="resizer" :spread="g.resizerProps(cell)"
             :pointerdown="g.onResizePointerDown($event)"></span></div>
      </div>
    </div>
    <div class="body" :ref="scroller" :spread="g.bodyProps()">
      <div class="sizer" :spread="g.sizerProps()">
        <div class="container" :ref="container" :spread="g.containerProps()">
          <div class="row" :for="row in g.rows()" :key="row.key" :spread="g.rowProps(row)">
            <div class="cell" :for="col in g.columns()" :key="col.key"
                 :spread="g.cellProps(row, col)">{ g.cellValue(row, col) }</div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

/** The header as every grid before groups rendered it: one row, from `columns()`. */
const ONE_ROW_TEMPLATE = `
  <div class="grid" :ref="grid" :spread="g.gridProps()"
       :keydown="onKey($event)" :focusin="g.onFocusIn($event)">
    <div class="header" :spread="g.headerProps()">
      <div class="header-row" :spread="g.headerRowProps()">
        <div class="th" :for="col in g.columns()" :key="col.key" :spread="g.headerCellProps(col)"
             :click="g.onHeaderClick($event)"><span class="label">{ col.column.header }</span><span
             class="resizer" :spread="g.resizerProps(col)"
             :pointerdown="g.onResizePointerDown($event)"></span></div>
      </div>
    </div>
    <div class="body" :ref="scroller" :spread="g.bodyProps()">
      <div class="sizer" :spread="g.sizerProps()">
        <div class="container" :ref="container" :spread="g.containerProps()">
          <div class="row" :for="row in g.rows()" :key="row.key" :spread="g.rowProps(row)">
            <div class="cell" :for="col in g.columns()" :key="col.key"
                 :spread="g.cellProps(row, col)">{ g.cellValue(row, col) }</div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

interface GridInstance {
  g: Grid<Person>;
  view: GridStateLayer<Person> | null;
  handled: boolean;
  onKey(event: KeyboardEvent): void;
}

interface Harness {
  g: Grid<Person>;
  view: GridStateLayer<Person> | null;
  instance: GridInstance;
  root: HTMLElement;
  scroller: HTMLElement;
}

function setup(template = TEMPLATE, mountOn: HTMLElement = host): Harness {
  @Component({ selector: `v-column-groups-${++selectors}`, render: compileTemplate(template) })
  class GridComponent {
    grid = new Signal.State<Element | null>(null);
    scroller = new Signal.State<Element | null>(null);
    container = new Signal.State<Element | null>(null);
    handled = false;
    view: GridStateLayer<Person> | null = layer && layer(() => columns.get());
    g: Grid<Person> = createGrid<Person>({
      ...gridOptions,
      grid: () => this.grid.get(),
      scroller: () => this.scroller.get(),
      container: () => this.container.get(),
      rows: () => people.get(),
      columns: () => (this.view === null ? columns.get() : this.view.columns()),
      ...(this.view === null ? {} : { onColumnResize: this.view.onColumnResize }),
    });

    onKey(event: KeyboardEvent): void {
      this.handled = this.g.onKeyDown(event);
    }
  }

  const handle = mount(GridComponent, mountOn);
  mounted.push(handle);

  const scroller = mountOn.querySelector<HTMLElement>('.body')!;
  Object.defineProperty(scroller, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true });
  Object.defineProperty(scroller, 'clientWidth', { value: VIEWPORT_WIDTH, configurable: true });
  FakeResizeObserver.deliver([{ target: scroller, block: VIEWPORT_HEIGHT, inline: VIEWPORT_WIDTH }]);

  const instance = handle.instance as unknown as GridInstance;
  return {
    g: instance.g,
    view: instance.view,
    instance,
    root: mountOn.querySelector<HTMLElement>('.grid')!,
    scroller,
  };
}

/** A view layer over the columns, holding its own order and hidden set. */
function withView(): void {
  layer = (list) => createGridState<Person>({ grid: () => null, columns: list });
}

function userScroll(el: HTMLElement, { top = 0, left = 0 } = {}): void {
  el.scrollTop = top;
  el.scrollLeft = left;
  el.dispatchEvent(new Event('scroll'));
  flushSync();
}

function press(el: Element, key: string, modifiers: Partial<KeyboardEventInit> = {}): void {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
  );
  flushSync();
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  flushSync();
}

function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    ...init,
  });
}

function cellAt(row: number, column: number): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[${GRID_CELL_ATTRIBUTE}="${row},${column}"]`);
}

/** What each rendered header row says, top to bottom, a cell at a time. */
function headerText(): string[][] {
  return [...host.querySelectorAll<HTMLElement>('.header-row')].map((row) =>
    [...row.querySelectorAll<HTMLElement>('.th')].map((th) => th.textContent!.trim()),
  );
}

/** What each header cell the grid hands out stands for: its text, first column, span and drawn width. */
function described(g: Grid<Person>): [string, number, number, number][][] {
  const describe = (cell: GridHeaderCell<Person>): [string, number, number, number] => [
    cell.header,
    cell.index,
    cell.colspan,
    cell.width,
  ];
  return g.headerRows().map((row) => row.cells.map(describe));
}

/** The group header cell standing for a group, in whichever row it is. */
function groupCell(id: string): HTMLElement {
  return host.querySelector<HTMLElement>(`.th[data-column-group="${id}"]`)!;
}

/** A group's resize handle, found the way a consumer's stylesheet would. */
function groupResizer(id: string): HTMLElement {
  return host.querySelector<HTMLElement>(`[${GRID_COLUMN_GROUP_RESIZER_ATTRIBUTE}="${id}"]`)!;
}

/** Every cell holding the grid's tab stop. There must never be more than one. */
function tabStops(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(`[${GRID_CELL_ATTRIBUTE}]`)].filter(
    (el) => el.getAttribute('tabindex') === '0',
  );
}

/** The column ids in the grid's own order, every one of them. */
function order(g: Grid<Person>): string[] {
  return Array.from({ length: g.columnCount() }, (_, i) => g.columnAt(i)!.id);
}

/** The width the grid lays each column out at, by id. */
function widths(g: Grid<Person>, ids: readonly string[]): (number | undefined)[] {
  return ids.map((id) => g.columnWidth(id));
}

/** The polite live region's text, once it has one. */
async function announced(): Promise<string> {
  let text = '';
  await vi.waitFor(() => {
    text = document.querySelector("[data-volt-announcer='polite']")?.textContent ?? '';
    expect(text).not.toBe('');
  });
  return text;
}

// ---------------------------------------------------------------------------
// The rows of the header
// ---------------------------------------------------------------------------

describe('a header of more than one row', () => {
  it('stacks a row for each level of group above the columns, the outermost on top', () => {
    const harness = setup();

    expect(harness.g.headerRows().map((row) => [row.index, row.key])).toEqual([
      [HEADER_ROW - 2, 0],
      [HEADER_ROW - 1, 1],
      [HEADER_ROW, 'columns'],
    ]);
    expect(headerText()).toEqual([
      ['Name', 'Work'],
      ['', 'Role'],
      ['Column 0', 'Column 1', 'Column 2', 'Column 3', 'Column 4'],
    ]);
  });

  it("spans a group's cell over its columns, and draws it as wide as the ones the window holds", () => {
    const harness = setup();
    expect(described(harness.g).slice(0, 2)).toEqual([
      [['Name', 0, 2, 200], ['Work', 2, 5, 300]],
      [['', 0, 2, 200], ['Role', 2, 3, 300]],
    ]);

    // The window now holds c3 to c9. Work still spans the five columns from
    // c2, and is drawn over the four of them that are rendered.
    userScroll(harness.scroller, { left: 500 });
    expect(described(harness.g).slice(0, 2)).toEqual([
      [['Work', 2, 5, 400], ['', 7, 1, 100], ['Other', 8, 4, 200]],
      [['Role', 2, 3, 200], ['Pay', 5, 2, 200], ['', 7, 1, 100], ['', 8, 4, 200]],
    ]);
    expect(harness.g.headerRows()[0]!.cells.map((cell) => cell.start)).toEqual([300, 700, 800]);
    expect(groupCell('work').style.width).toBe('400px');
  });

  it('stands each cell for its group or its column, and leaves a gap for neither', () => {
    const harness = setup();
    const [top, middle, bottom] = harness.g.headerRows();

    expect(top!.cells.map((cell) => cell.group)).toEqual([NAME, WORK]);
    expect(middle!.cells.map((cell) => cell.group)).toEqual([null, ROLE]);
    expect(top!.cells.every((cell) => cell.column === null)).toBe(true);
    expect(middle!.cells[0]!.column).toBeNull();
    // The bottom row is the columns, as `columns()` hands them out.
    expect(bottom!.cells.map((cell) => cell.column)).toEqual(harness.g.columns());
    expect(bottom!.cells.every((cell) => cell.group === null && cell.colspan === 1)).toBe(true);
    expect(bottom!.cells.map((cell) => cell.row)).toEqual(Array(5).fill(HEADER_ROW));
    expect(top!.cells.map((cell) => cell.row)).toEqual([HEADER_ROW - 2, HEADER_ROW - 2]);
  });

  it('marks a group cell a column header spanning its columns, and a gap as no cell at all', () => {
    const harness = setup();
    const role = harness.g.headerRows()[1]!.cells[1]!;
    expect(harness.g.headerCellProps(role)).toStrictEqual({
      [GRID_CELL_ATTRIBUTE]: `${HEADER_ROW - 1},2`,
      role: 'columnheader',
      'aria-colindex': '3',
      'aria-colspan': '3',
      tabindex: '-1',
      'data-active': undefined,
      'data-column-group': 'role',
      style: { width: '300px' },
    });

    const gap = harness.g.headerRows()[1]!.cells[0]!;
    expect(harness.g.headerCellProps(gap)).toStrictEqual({
      role: 'none',
      'data-column-group-gap': '',
      style: { width: '200px' },
    });
    expect(groupCell('role').getAttribute('aria-colspan')).toBe('3');
    expect(groupCell('name').getAttribute('role')).toBe('columnheader');
  });

  it('keys each cell uniquely in its row, a group split in two included', () => {
    // Role's columns are not side by side: c7 sits between c3 and c4.
    const list = makeColumns();
    columns.set([...list.slice(0, 4), list[7]!, ...list.slice(4, 7), ...list.slice(8)]);
    const harness = setup();

    const middle = harness.g.headerRows()[1]!.cells;
    expect(middle.map((cell) => [cell.header, cell.index, cell.colspan])).toEqual([
      ['', 0, 2],
      ['Role', 2, 2],
      ['', 4, 1],
    ]);
    userScroll(harness.scroller, { left: 300 });
    const keys = harness.g.headerRows().flatMap((row) => row.cells.map((cell) => `${row.key}/${cell.key}`));
    expect(new Set(keys).size).toBe(keys.length);
    expect(described(harness.g)[1]!.filter(([header]) => header === 'Role')).toEqual([
      ['Role', 2, 2, 200],
      ['Role', 5, 1, 100],
    ]);
  });

  it('splits a group across a pinned edge, and holds the pinned part with its columns', () => {
    columns.set(makeColumns(GROUPS, { c3: { pin: 'start' as GridColumnPin } }));
    const harness = setup();
    // Drawn: c3 | c0 c1 c2 c4 ...
    const top = harness.g.headerRows()[0]!.cells;
    expect(top.map((cell) => [cell.header, cell.index, cell.colspan, cell.pin ?? null])).toEqual([
      ['Work', 0, 1, 'start'],
      ['Name', 1, 2, null],
      ['Work', 3, 4, null],
    ]);
    expect(harness.g.headerCellProps(top[0]!)).toMatchObject({
      style: { width: '100px', position: 'sticky', 'inset-inline-start': '0px' },
      'data-pinned': 'start',
    });
  });

  it('parts a group at a pinned edge even where its columns sit side by side across it', () => {
    columns.set(makeColumns(GROUPS, { c0: { pin: 'start' as GridColumnPin } }));
    const harness = setup();
    const top = harness.g.headerRows()[0]!.cells;
    expect(top.map((cell) => [cell.header, cell.index, cell.colspan, cell.pin ?? null])).toEqual([
      ['Name', 0, 1, 'start'],
      ['Name', 1, 1, null],
      ['Work', 2, 5, null],
    ]);
  });

  it('moves every row of the header across with the columns, as the one row was', () => {
    const harness = setup();
    userScroll(harness.scroller, { left: 500 });
    const rows = harness.g.headerRows();
    const shift = harness.g.headerRowProps();
    for (const row of rows) expect(harness.g.headerRowProps(row).style).toStrictEqual(shift.style);
    expect(harness.g.headerRowProps(rows[0]!)).toStrictEqual({
      role: 'row',
      'aria-rowindex': '1',
      style: { transform: 'translateX(-200px)' },
    });
  });

  it('hands back the same rows and cells for a vertical scroll', () => {
    const harness = setup();
    const before = harness.g.headerRows();
    const cells = before.map((row) => row.cells);

    userScroll(harness.scroller, { top: 300 });

    expect(harness.g.headerRows()).toBe(before);
    expect(harness.g.headerRows().map((row) => row.cells)).toEqual(cells);
  });

  it('hands back the cells of a row the window did not change when it moves', () => {
    const harness = setup();
    const [, , columnsRow] = harness.g.headerRows();
    const kept = columnsRow!.cells[3]!;

    userScroll(harness.scroller, { left: 100 });

    // The window gained c5 and kept c3, so c3's cell is the one it was.
    const after = harness.g.headerRows()[2]!.cells;
    expect(after.find((cell) => cell.key === 'c3')).toBe(kept);
  });

  it("hands back a group's cell the move left as it was, and a new one for a group it widened", () => {
    const harness = setup();
    const [name, work] = harness.g.headerRows()[0]!.cells;

    userScroll(harness.scroller, { left: 100 });

    const [nameAfter, workAfter] = harness.g.headerRows()[0]!.cells;
    expect(nameAfter).toBe(name);
    expect(workAfter).not.toBe(work);
    expect(workAfter!.width).toBeGreaterThan(work!.width);
  });

  it('draws one cell over columns that name a group by the same id, whatever objects they hand over', () => {
    // Each column names its groups with objects of its own, as a list built a
    // column at a time would.
    const role = (): GridColumnGroup => ({ id: 'role', header: 'Role', parent: { id: 'work', header: 'Work' } });
    columns.set(makeColumns({ c0: role(), c1: role(), c2: role() }));
    const harness = setup();

    expect(described(harness.g).map((row) => row[0])).toEqual([
      ['Work', 0, 3, 300],
      ['Role', 0, 3, 300],
      ['Column 0', 0, 1, 100],
    ]);
  });

  it('ends a chain of parents that comes back on itself where it does', () => {
    const inner: { id: string; header: string; parent?: GridColumnGroup } = { id: 'inner', header: 'Inner' };
    const outer: GridColumnGroup = { id: 'outer', header: 'Outer', parent: inner };
    inner.parent = outer;
    columns.set(makeColumns({ c0: inner, c1: inner }));
    const harness = setup();

    expect(harness.g.headerRows()).toHaveLength(3);
    expect(headerText().slice(0, 2)).toEqual([['Outer', ''], ['Inner', '']]);
  });

  it('follows the groups the columns name when the list is handed over again', () => {
    const harness = setup();
    columns.set(makeColumns({ c0: OTHER, c1: OTHER }));
    flushSync();
    expect(headerText()).toEqual([
      ['Other', ''],
      ['Column 0', 'Column 1', 'Column 2', 'Column 3', 'Column 4'],
    ]);
    expect(harness.g.gridProps()['aria-rowcount']).toBe(String(ROW_COUNT + 2));
  });
});

// ---------------------------------------------------------------------------
// What a screen reader is told
// ---------------------------------------------------------------------------

describe('the header rows, to a screen reader', () => {
  it('counts every header row in aria-rowcount, and numbers the rows after them', () => {
    const harness = setup();

    expect(harness.g.gridProps()['aria-rowcount']).toBe(String(ROW_COUNT + 3));
    expect([...host.querySelectorAll('.header-row')].map((row) => row.getAttribute('aria-rowindex'))).toEqual([
      '1', '2', '3',
    ]);
    expect(harness.g.headerRowProps()['aria-rowindex']).toBe('3');
    const rows = [...host.querySelectorAll('.row')].map((row) => row.getAttribute('aria-rowindex'));
    expect(rows.slice(0, 3)).toEqual(['4', '5', '6']);
  });

  it('counts the rows pinned above and below past the header rows too', () => {
    const top = makePeople(1).map((row) => ({ ...row, id: -1 }));
    gridOptions = { ...gridOptions, pinnedTop: () => top };
    const harness = setup();
    expect(harness.g.gridProps()['aria-rowcount']).toBe(String(ROW_COUNT + 1 + 3));
    expect(harness.g.rowProps(harness.g.pinnedTopRows()[0]!)['aria-rowindex']).toBe('4');
    expect(harness.g.rowProps(harness.g.rows()[0]!)['aria-rowindex']).toBe('5');
  });
});

// ---------------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------------

describe('the keyboard among the groups', () => {
  it("goes up from a column's header to its innermost group, and on up to the outermost", () => {
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW, column: 3 });

    press(document.activeElement!, 'ArrowUp');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 2 });
    expect(document.activeElement).toBe(groupCell('role'));

    press(document.activeElement!, 'ArrowUp');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 2 });
    expect(document.activeElement).toBe(groupCell('work'));

    press(document.activeElement!, 'ArrowUp');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 2 });
    expect(harness.instance.handled).toBe(true);
  });

  it('goes up past the gap under a group that is not as deep as the others', () => {
    const harness = setup();
    // Name is on the top row, and the row under it is a gap over c0 and c1.
    harness.g.focusCell({ row: HEADER_ROW, column: 1 });
    press(document.activeElement!, 'ArrowUp');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 0 });
    expect(document.activeElement).toBe(groupCell('name'));
  });

  it('goes nowhere up from a column under no group', () => {
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW, column: 7 });
    press(document.activeElement!, 'ArrowUp');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 7 });
  });

  it('goes from one group to the next along its row, past the gaps, and stops at the ends', () => {
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 0 });

    const visited: number[] = [];
    for (let i = 0; i < 3; i++) {
      press(document.activeElement!, 'ArrowRight');
      visited.push(harness.g.activeCell().column);
    }
    // Work, then Other past the gap over c7, then nowhere further.
    expect(visited).toEqual([2, 8, 8]);
    expect(document.activeElement).toBe(groupCell('other'));

    press(document.activeElement!, 'ArrowLeft');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 2 });
    press(document.activeElement!, 'Home');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 0 });
    press(document.activeElement!, 'End');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 8 });

    // In the row below, nothing to the left of Role is a group.
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 2 });
    press(document.activeElement!, 'ArrowLeft');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 2 });
    press(document.activeElement!, 'ArrowRight');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 5 });
  });

  it("goes down from a group to the group under its first column, or past a gap to that column's header", () => {
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 2 });
    press(document.activeElement!, 'ArrowDown');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 2 });
    press(document.activeElement!, 'ArrowDown');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 2 });

    harness.g.focusCell({ row: HEADER_ROW - 2, column: 0 });
    press(document.activeElement!, 'ArrowDown');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 0 });
    expect(document.activeElement).toBe(cellAt(HEADER_ROW, 0));
  });

  it('puts a position inside a group on its first column, and one over a gap on the header below', () => {
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 4 });
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 2 });
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 0 });
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 0 });
    // Above the top row is the top row.
    harness.g.focusCell({ row: -40, column: 3 });
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 2 });
  });

  it('takes the cursor from focus arriving on a group cell some other way', () => {
    const harness = setup();
    groupCell('role').focus();
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 2 });
    expect(groupCell('role').getAttribute('tabindex')).toBe('0');
    expect(groupCell('role').hasAttribute('data-active')).toBe(true);
    expect(tabStops()).toHaveLength(1);
  });

  it('holds the tab stop on a group the window still draws, and on the header below one it does not', () => {
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 2 });

    // c2 has left the window, but Work is drawn over the c3 to c6 it still holds.
    userScroll(harness.scroller, { left: 500 });
    expect(tabStops()).toEqual([groupCell('work')]);

    // Name is not drawn at all now, so the tab stop goes to the header row.
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 0 });
    userScroll(harness.scroller, { left: 500 });
    expect(tabStops()).toEqual([cellAt(HEADER_ROW, 3)]);
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 0 });
  });

  it('never pages up into the groups, and pages down from them as from the header', () => {
    const harness = setup();
    harness.g.focusCell({ row: 3, column: 2 });
    press(document.activeElement!, 'PageUp');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 2 });
    // Nor from the columns' own header, where ArrowUp would go to Role.
    press(document.activeElement!, 'PageUp');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 2 });
    expect(harness.instance.handled).toBe(true);

    harness.g.focusCell({ row: HEADER_ROW - 2, column: 2 });
    press(document.activeElement!, 'PageDown');
    const fromGroup = harness.g.activeCell();
    harness.g.focusCell({ row: HEADER_ROW, column: 2 });
    press(document.activeElement!, 'PageDown');
    expect(fromGroup).toEqual(harness.g.activeCell());

    harness.g.focusCell({ row: HEADER_ROW - 1, column: 2 });
    press(document.activeElement!, 'PageUp');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 2 });
  });

  it('goes home with Ctrl as from any cell, and leaves Shift to the page', () => {
    gridOptions = { ...gridOptions, cellSelection: 'range' };
    const harness = setup();
    // Pay is past the window, so its cell is focused once the scroll has drawn it.
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 5 });
    flushSync();
    expect(document.activeElement).toBe(groupCell('pay'));

    press(document.activeElement!, 'ArrowRight', { shiftKey: true });
    expect(harness.instance.handled).toBe(false);
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 5 });
    expect(harness.g.cellRange()).toBeNull();

    press(document.activeElement!, 'Home', { ctrlKey: true });
    expect(harness.instance.handled).toBe(true);
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
  });

  it('sorts from a column header and from no group, by key or by click', () => {
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 2 });
    press(document.activeElement!, 'Enter');
    expect(harness.instance.handled).toBe(false);
    click(groupCell('role'));
    expect(harness.g.sort()).toEqual([]);

    click(cellAt(HEADER_ROW, 3)!);
    expect(harness.g.sort()).toEqual([{ columnId: 'c3', direction: 'ascending' }]);
    harness.g.setFilter('c4', { type: 'text', value: 'r1' });
    flushSync();
    expect(harness.g.rowCount()).toBeLessThan(ROW_COUNT);
  });

  it('keeps the cursor on its group when the columns move under it', () => {
    withView();
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 2 });

    harness.view!.moveGroup('work', 0);
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 0 });
    expect(document.activeElement).toBe(groupCell('work'));

    // To the end, past Other: the place it left is under no group now.
    harness.view!.moveGroup('work', COLUMN_COUNT);
    flushSync();
    expect(order(harness.g).slice(-5)).toEqual(['c2', 'c3', 'c4', 'c5', 'c6']);
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 7 });
  });

  it('goes back to the header below when the group the cursor was on goes', () => {
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 2 });
    columns.set(makeColumns({}));
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 2 });

    // Role goes and Work stays: Role's row is Work's now, and the cursor was
    // not on Work.
    columns.set(makeColumns());
    flushSync();
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 2 });
    const work = { c2: WORK, c3: WORK, c4: WORK, c5: WORK, c6: WORK };
    columns.set(makeColumns({ ...GROUPS, ...work }));
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 2 });
  });

  it('stays on its group when a row of groups is added above the columns or taken away', () => {
    const shallow = { ...GROUPS, c2: WORK, c3: WORK, c4: WORK, c5: WORK, c6: WORK };
    columns.set(makeColumns(shallow));
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 0 });
    expect(document.activeElement).toBe(groupCell('name'));

    // Role and Pay add a row under Work, and Name, on the top row, is a row
    // further up than it was.
    columns.set(makeColumns());
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 0 });
    expect(document.activeElement).toBe(groupCell('name'));

    columns.set(makeColumns(shallow));
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 0 });
    expect(document.activeElement).toBe(groupCell('name'));
  });

  it('stays on its group when hiding and showing columns changes how many rows of groups there are', () => {
    withView();
    const harness = setup();
    const view = harness.view!;
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 0 });

    // Without Work's columns nothing is two groups deep.
    for (const id of ['c2', 'c3', 'c4', 'c5', 'c6']) view.setColumnHidden(id, true);
    flushSync();
    expect(harness.g.headerRows()).toHaveLength(2);
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 0 });

    for (const id of ['c2', 'c3', 'c4', 'c5', 'c6']) view.setColumnHidden(id, false);
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 0 });
    expect(document.activeElement).toBe(groupCell('name'));
  });

  it('keeps focus on a group whose cell the window draws again as it scrolls to it', () => {
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 8 });
    flushSync();
    expect(document.activeElement).toBe(groupCell('other'));
    // The window holds c4 to c10, so Work is drawn over c4 to c6, and going
    // to it scrolls to its first column: its cell is drawn again, after Name's.
    expect(harness.g.columns()[0]!.index).toBe(4);
    press(document.activeElement!, 'ArrowLeft');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 2 });
    expect(harness.g.columns()[0]!.index).toBe(0);
    expect(document.activeElement).toBe(groupCell('work'));
  });
});

// ---------------------------------------------------------------------------
// Resizing a group
// ---------------------------------------------------------------------------

describe('resizing a group', () => {
  it('shares the new width among its columns in proportion to the widths they had', () => {
    const resized: [string, number][] = [];
    gridOptions = { ...gridOptions, onColumnResize: (id, width) => resized.push([id, width]) };
    const harness = setup();
    harness.g.resizeColumn('c2', 200);
    resized.length = 0;

    harness.g.resizeGroup('role', 800);
    flushSync();
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([400, 200, 200]);
    expect(resized).toEqual([['c2', 400], ['c3', 200], ['c4', 200]]);
    expect(groupCell('role').style.width).toBe('800px');

    // A group of groups shares it among every column under it.
    harness.g.resizeGroup('work', 1200);
    flushSync();
    expect(widths(harness.g, ['c2', 'c3', 'c4', 'c5', 'c6'])).toEqual([480, 240, 240, 120, 120]);
  });

  it('gives a width that does not divide evenly to the columns first in line, pixel by pixel', () => {
    const harness = setup();
    harness.g.resizeGroup('role', 302);
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([101, 101, 100]);
  });

  it('holds each column to its bounds and shares what is left among the others', () => {
    columns.set(makeColumns(GROUPS, { c3: { maxWidth: 120 }, c4: { resizable: false } }));
    const harness = setup();
    harness.g.resizeGroup('role', 700);
    // c4 keeps its hundred, c3 stops at its cap, and c2 takes the rest.
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([480, 120, 100]);

    harness.g.resizeGroup('role', 0);
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([40, 40, 100]);
  });

  it('resizes nothing for a group the list does not hold, or one no column of can be resized', () => {
    columns.set(makeColumns(GROUPS, { c0: { resizable: false }, c1: { resizable: false } }));
    const resized: string[] = [];
    gridOptions = { ...gridOptions, onColumnResize: (id) => resized.push(id) };
    const harness = setup();
    harness.g.resizeGroup('name', 500);
    harness.g.resizeGroup('nobody', 500);
    expect(resized).toEqual([]);
    expect(groupResizer('name').hasAttribute('data-disabled')).toBe(true);
    expect(groupResizer('work').hasAttribute('data-disabled')).toBe(false);
  });

  it("resizes by dragging the group's handle, from the widths the drag started at", () => {
    const harness = setup();
    harness.g.resizeColumn('c2', 200);
    flushSync();
    const handle = groupResizer('role');

    handle.dispatchEvent(pointer('pointerdown', { clientX: 400 }));
    flushSync();
    expect(handle.hasAttribute('data-resizing')).toBe(true);
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });

    handle.dispatchEvent(pointer('pointermove', { clientX: 800 }));
    flushSync();
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([400, 200, 200]);
    // Narrower than the bounds allow, every column at its minimum: shared from
    // there, the next move would be shared evenly.
    handle.dispatchEvent(pointer('pointermove', { clientX: 0 }));
    flushSync();
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([40, 40, 40]);
    // Back towards where it began: shared from the widths it started with,
    // not from those the last move left.
    handle.dispatchEvent(pointer('pointermove', { clientX: 500 }));
    flushSync();
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([250, 125, 125]);

    handle.dispatchEvent(pointer('pointerup'));
    flushSync();
    expect(handle.hasAttribute('data-resizing')).toBe(false);
  });

  it('puts every column back where the drag started when Escape cancels it', () => {
    const harness = setup();
    harness.g.resizeColumn('c3', 130);
    const handle = groupResizer('role');
    handle.dispatchEvent(pointer('pointerdown', { clientX: 0 }));
    handle.dispatchEvent(pointer('pointermove', { clientX: -170 }));
    flushSync();
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).not.toEqual([100, 130, 100]);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([100, 130, 100]);
    expect(handle.hasAttribute('data-resizing')).toBe(false);
  });

  it('keeps to the columns it took hold of when the list is reordered under the drag', () => {
    const harness = setup();
    const handle = groupResizer('role');
    handle.dispatchEvent(pointer('pointerdown', { clientX: 400 }));
    flushSync();

    // Name goes after Work, and Role's columns are now first.
    const list = makeColumns();
    columns.set([...list.slice(2, 7), list[0]!, list[1]!, ...list.slice(7)]);
    flushSync();

    handle.dispatchEvent(pointer('pointermove', { clientX: 550 }));
    flushSync();
    expect(widths(harness.g, ['c2', 'c3', 'c4', 'c5', 'c6', 'c0', 'c1'])).toEqual([
      150, 150, 150, 100, 100, 100, 100,
    ]);
    expect(handle.hasAttribute('data-resizing')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(widths(harness.g, ['c2', 'c3', 'c4', 'c5', 'c6'])).toEqual([100, 100, 100, 100, 100]);
  });

  it('resizes the group under the cursor with Alt and an arrow, and says its new width', async () => {
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 2 });
    press(document.activeElement!, 'ArrowRight', { altKey: true });
    expect(harness.instance.handled).toBe(true);
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([106, 105, 105]);
    expect(await announced()).toBe('Role, 316 pixels');

    press(document.activeElement!, 'ArrowLeft', { altKey: true });
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([100, 100, 100]);
  });

  it('takes an announcement of its own for a group', async () => {
    gridOptions = {
      ...gridOptions,
      groupResizeAnnouncement: (group, width) => `${group.id} is ${width}`,
    };
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 0 });
    press(document.activeElement!, 'ArrowRight', { altKey: true });
    expect(await announced()).toBe('name is 216');
  });

  it('gives a gap a handle that does nothing', () => {
    const harness = setup();
    const gap = harness.g.headerRows()[1]!.cells[0]!;
    expect(harness.g.resizerProps(gap)).toStrictEqual({
      'aria-hidden': 'true',
      'data-disabled': '',
      style: { 'touch-action': 'none' },
    });
    const role = harness.g.headerRows()[1]!.cells[1]!;
    expect(harness.g.resizerProps(role)).toStrictEqual({
      [GRID_COLUMN_GROUP_RESIZER_ATTRIBUTE]: 'role',
      'aria-hidden': 'true',
      'data-resizing': undefined,
      'data-disabled': undefined,
      style: { 'touch-action': 'none' },
    });
  });
});

describe('resizing a group a pin has parted', () => {
  // Drawn: c3 | c0 c1 c2 c4 … — Role is drawn twice in the middle row: over
  // c3, pinned, at column 0, and over c2 and c4 at column 3.
  beforeEach(() => {
    columns.set(makeColumns(GROUPS, { c3: { pin: 'start' as GridColumnPin } }));
  });

  /** A part's cell in the middle row, by the column it starts at. */
  function part(column: number): HTMLElement {
    return cellAt(HEADER_ROW - 1, column)!;
  }

  function partResizer(column: number): HTMLElement {
    return part(column).querySelector<HTMLElement>(`[${GRID_COLUMN_GROUP_RESIZER_ATTRIBUTE}]`)!;
  }

  it('drags the columns under the part whose handle it is, and leaves the other part alone', () => {
    const harness = setup();
    expect(order(harness.g).slice(0, 5)).toEqual(['c3', 'c0', 'c1', 'c2', 'c4']);

    const handle = partResizer(3);
    handle.dispatchEvent(pointer('pointerdown', { clientX: 400 }));
    handle.dispatchEvent(pointer('pointermove', { clientX: 500 }));
    handle.dispatchEvent(pointer('pointerup', { clientX: 500 }));
    flushSync();

    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([150, 100, 150]);
    expect(part(3).style.width).toBe('300px');
    expect(part(0).style.width).toBe('100px');
  });

  it('marks only the handle being dragged as resizing', () => {
    setup();
    const handle = partResizer(3);
    handle.dispatchEvent(pointer('pointerdown', { clientX: 400 }));
    flushSync();
    expect(handle.hasAttribute('data-resizing')).toBe(true);
    expect(partResizer(0).hasAttribute('data-resizing')).toBe(false);

    handle.dispatchEvent(pointer('pointerup', { clientX: 400 }));
    flushSync();
    expect(handle.hasAttribute('data-resizing')).toBe(false);
  });

  it("resizes with Alt and an arrow the part the cursor is on, and says that part's width", async () => {
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 0 });
    expect(document.activeElement).toBe(part(0));

    press(document.activeElement!, 'ArrowRight', { altKey: true });
    expect(harness.instance.handled).toBe(true);
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([100, 116, 100]);
    expect(await announced()).toBe('Role, 116 pixels');
  });

  it("marks the handle of a part none of whose columns can be resized, and not the other part's", () => {
    columns.set(makeColumns(GROUPS, { c3: { pin: 'start' as GridColumnPin, resizable: false } }));
    const harness = setup();
    expect(partResizer(0).hasAttribute('data-disabled')).toBe(true);
    expect(partResizer(3).hasAttribute('data-disabled')).toBe(false);

    const handle = partResizer(0);
    handle.dispatchEvent(pointer('pointerdown', { clientX: 100 }));
    handle.dispatchEvent(pointer('pointermove', { clientX: 300 }));
    flushSync();
    expect(handle.hasAttribute('data-resizing')).toBe(false);
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([100, 100, 100]);
  });

  it('resizes every column under the group, in each part, when asked for it by id', () => {
    const harness = setup();
    harness.g.resizeGroup('role', 600);
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([200, 200, 200]);
  });
});

// ---------------------------------------------------------------------------
// The saved view: a group shut, and a group kept together
// ---------------------------------------------------------------------------

describe('a group shut to its first column', () => {
  beforeEach(withView);

  it('hides every column of the group but the first, and shows them again when opened', () => {
    const harness = setup();
    const view = harness.view!;

    view.collapseGroup('work');
    flushSync();
    expect(order(harness.g)).toEqual(['c0', 'c1', 'c2', 'c7', 'c8', 'c9', 'c10', 'c11']);
    expect(view.isGroupCollapsed('work')).toBe(true);
    expect(['c3', 'c4', 'c5', 'c6'].every((id) => view.isColumnHidden(id))).toBe(true);
    expect(described(harness.g)[0]!.slice(0, 2)).toEqual([['Name', 0, 2, 200], ['Work', 2, 1, 100]]);

    view.expandGroup('work');
    flushSync();
    expect(order(harness.g)).toEqual(columns.get().map((column) => column.id));
    expect(view.isGroupCollapsed('work')).toBe(false);
  });

  it('is saved as the columns it hid, and restored from them', () => {
    const first = setup();
    first.view!.collapseGroup('role');
    flushSync();
    const saved = JSON.parse(JSON.stringify(first.view!.state()));
    expect(Object.keys(saved).sort()).toEqual(
      ['collapsed', 'columns', 'filters', 'groupBy', 'quickFilter', 'sort', 'version'],
    );
    expect(saved.columns.filter((column: { hidden?: true }) => column.hidden)).toEqual([
      { id: 'c3', hidden: true },
      { id: 'c4', hidden: true },
    ]);

    const second = setup(TEMPLATE, document.body.appendChild(document.createElement('div')));
    expect(second.view!.isGroupCollapsed('role')).toBe(false);
    second.view!.apply(saved);
    flushSync();
    expect(second.view!.isGroupCollapsed('role')).toBe(true);
    expect(second.view!.isGroupCollapsed('work')).toBe(false);
  });

  it('shows the first column when it shuts a group whose first column was hidden', () => {
    const harness = setup();
    harness.view!.setColumnHidden('c2', true);
    harness.view!.collapseGroup('role');
    flushSync();
    expect(order(harness.g).slice(0, 4)).toEqual(['c0', 'c1', 'c2', 'c5']);
  });

  it('is not shut with every column hidden, its first among them', () => {
    const harness = setup();
    for (const id of ['c2', 'c3', 'c4']) harness.view!.setColumnHidden(id, true);
    flushSync();
    expect(harness.view!.isGroupCollapsed('role')).toBe(false);
    harness.view!.setColumnHidden('c2', false);
    expect(harness.view!.isGroupCollapsed('role')).toBe(true);
  });

  it('leaves the one column of a group of one as it was, hidden or shown', () => {
    columns.set(makeColumns({ ...GROUPS, c7: { id: 'alone', header: 'Alone' } }));
    const harness = setup();
    harness.view!.setColumnHidden('c7', true);
    harness.view!.collapseGroup('alone');
    flushSync();
    expect(harness.view!.isColumnHidden('c7')).toBe(true);
  });

  it('shuts nothing for a group of one column, or one the columns do not name', () => {
    columns.set(makeColumns({ ...GROUPS, c7: { id: 'alone', header: 'Alone' } }));
    const harness = setup();
    harness.view!.collapseGroup('alone');
    harness.view!.collapseGroup('nobody');
    flushSync();
    expect(harness.g.columnCount()).toBe(COLUMN_COUNT);
    expect(harness.view!.isGroupCollapsed('alone')).toBe(false);
    expect(harness.view!.isGroupCollapsed('nobody')).toBe(false);
  });
});

describe("a group's columns kept together", () => {
  beforeEach(withView);

  it('moves a grouped column only within its group', () => {
    const harness = setup();
    const view = harness.view!;

    view.moveColumn('c3', 0);
    flushSync();
    expect(order(harness.g).slice(0, 7)).toEqual(['c0', 'c1', 'c3', 'c2', 'c4', 'c5', 'c6']);

    view.moveColumn('c3', COLUMN_COUNT - 1);
    flushSync();
    expect(order(harness.g).slice(0, 7)).toEqual(['c0', 'c1', 'c2', 'c4', 'c3', 'c5', 'c6']);

    // Within it, anywhere.
    view.moveColumn('c3', 2);
    flushSync();
    expect(order(harness.g).slice(0, 7)).toEqual(['c0', 'c1', 'c3', 'c2', 'c4', 'c5', 'c6']);
  });

  it('puts a column dropped inside a group it is not in at the nearer edge of that group', () => {
    const harness = setup();
    const view = harness.view!;

    // Into the middle of Work, nearer its start than its end.
    view.moveColumn('c7', 3);
    flushSync();
    expect(order(harness.g).slice(0, 4)).toEqual(['c0', 'c1', 'c7', 'c2']);

    // Into Name, as near one edge as the other: the side it came from.
    view.moveColumn('c7', 1);
    flushSync();
    expect(order(harness.g).slice(0, 3)).toEqual(['c0', 'c1', 'c7']);
    view.moveColumn('c7', 0);
    flushSync();
    expect(order(harness.g).slice(0, 3)).toEqual(['c7', 'c0', 'c1']);
  });

  it('moves a whole group, and keeps one inside the group it is part of', () => {
    const harness = setup();
    const view = harness.view!;

    view.moveGroup('pay', 0);
    flushSync();
    expect(order(harness.g).slice(0, 8)).toEqual(['c0', 'c1', 'c5', 'c6', 'c2', 'c3', 'c4', 'c7']);

    view.moveGroup('work', 0);
    flushSync();
    expect(order(harness.g).slice(0, 8)).toEqual(['c5', 'c6', 'c2', 'c3', 'c4', 'c0', 'c1', 'c7']);

    // Into the middle of Work is not a place for Name: the nearer edge is.
    view.moveGroup('name', 1);
    flushSync();
    expect(order(harness.g).slice(0, 8)).toEqual(['c0', 'c1', 'c5', 'c6', 'c2', 'c3', 'c4', 'c7']);

    view.moveGroup('other', 0);
    view.moveGroup('nobody', 0);
    flushSync();
    expect(order(harness.g).slice(0, 5)).toEqual(['c8', 'c9', 'c10', 'c11', 'c0']);
    expect(view.state().columns.slice(0, 2)).toEqual([{ id: 'c8' }, { id: 'c9' }]);
  });

  it('pins every column of a group moved into a pinned region', () => {
    columns.set(makeColumns(GROUPS, { c0: { pin: 'start' as GridColumnPin } }));
    const harness = setup();
    harness.view!.moveGroup('work', 0);
    flushSync();
    expect(order(harness.g).slice(0, 7)).toEqual(['c2', 'c3', 'c4', 'c5', 'c6', 'c0', 'c1']);
    expect(order(harness.g).slice(0, 7).map((id) => harness.g.columnPin(id))).toEqual([
      'start', 'start', 'start', 'start', 'start', 'start', null,
    ]);

    // Role stays inside Work, wherever it is asked to go.
    harness.view!.moveGroup('role', 7);
    flushSync();
    expect(order(harness.g).slice(0, 5)).toEqual(['c5', 'c6', 'c2', 'c3', 'c4']);
  });
});

// ---------------------------------------------------------------------------
// Under a grouping of the rows
// ---------------------------------------------------------------------------

describe('column groups on a grid whose rows are grouped', () => {
  it('hands the grid every column under the group it names', () => {
    const grouping = createGrouping<Person>({
      rows: () => people.get(),
      columns: () => columns.get(),
      groupBy: () => ['c7'],
    });
    expect(grouping.columns().map((column) => column.group)).toEqual(
      columns.get().map((column) => column.group),
    );
  });
});

// ---------------------------------------------------------------------------
// What groups cost
// ---------------------------------------------------------------------------

describe('what groups cost the cells', () => {
  /**
   * Every accessor run a run of gestures costs, stage by stage, on a grid
   * whose columns name the groups given — mounted, used and taken down again,
   * so that two grids can be compared one after the other.
   */
  function readsThrough(groups: Readonly<Record<string, GridColumnGroup>>): string[][] {
    columns.set(makeColumns(groups));
    people.set(makePeople(ROW_COUNT));
    reads = [];
    const harness = setup();
    const stages: string[][] = [];
    const stage = (): void => {
      stages.push(reads);
      reads = [];
    };
    stage();

    harness.g.focusCell({ row: 0, column: 3 });
    press(document.activeElement!, 'ArrowUp');
    press(document.activeElement!, 'ArrowDown');
    stage();
    // Up among the groups and back, where there are any: on a grid without
    // them the first lands on the header. Either way the cursor ends where it
    // began, so what follows is the same work on both.
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 2 });
    harness.g.focusCell({ row: 0, column: 3 });
    stage();
    userScroll(harness.scroller, { top: 300 });
    stage();
    userScroll(harness.scroller, { top: 300, left: 400 });
    stage();
    harness.g.resizeColumn('c6', 160);
    flushSync();
    stage();
    // Twice, to descending: ascending leaves every row where it was.
    click(cellAt(HEADER_ROW, 5)!);
    click(cellAt(HEADER_ROW, 5)!);
    stage();
    harness.g.setFilter('c5', { type: 'text', value: '1' });
    flushSync();
    stage();
    const shown = harness.g.rows()[2]!.item;
    shown.cells[6]!.set('changed');
    flushSync();
    stage();

    for (const handle of mounted) handle.unmount();
    mounted = [];
    flushSync();
    host.innerHTML = '';
    return stages;
  }

  it('reads each cell no more often than the same grid without groups, nor in another order', () => {
    const plain = readsThrough({});
    const grouped = readsThrough(GROUPS);

    expect(grouped).toEqual(plain);
    // Pinned so the comparison is of work done and not of empty lists: every
    // stage reads something — the focus scrolls a column in, the edit reads
    // its one cell — but the trip among the groups, which ends where it began
    // and scrolls nothing in, on either grid.
    expect(plain.map((stage) => stage.length)).toEqual([35, 7, 0, 45, 36, 27, 121, 21, 1]);
  });
});

// ---------------------------------------------------------------------------
// A grid with no groups
// ---------------------------------------------------------------------------

describe('a grid with no groups is what it was', () => {
  beforeEach(() => {
    columns.set(makeColumns({}));
  });

  it('hands out one header row, its cells the columns', () => {
    const harness = setup();
    const rows = harness.g.headerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.index).toBe(HEADER_ROW);
    expect(rows[0]!.cells.map((cell) => cell.column)).toEqual(harness.g.columns());
    expect(rows[0]!.cells.map((cell) => cell.header)).toEqual(
      harness.g.columns().map((col) => col.column.header),
    );
  });

  it('hands out the same props through the header rows as through the columns, byte for byte', () => {
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW, column: 1 });
    harness.g.toggleSort('c1');
    flushSync();

    const [row] = harness.g.headerRows();
    expect(harness.g.headerRowProps(row)).toStrictEqual(harness.g.headerRowProps());
    expect(harness.g.headerRowProps()).toStrictEqual({
      role: 'row',
      'aria-rowindex': '1',
      style: { transform: 'translateX(0px)' },
    });
    for (const cell of row!.cells) {
      const col = cell.column!;
      expect(harness.g.headerCellProps(cell)).toStrictEqual(harness.g.headerCellProps(col));
      expect(harness.g.resizerProps(cell)).toStrictEqual(harness.g.resizerProps(col));
    }
    expect(harness.g.headerCellProps(row!.cells[1]!)).toStrictEqual({
      [GRID_CELL_ATTRIBUTE]: `${HEADER_ROW},1`,
      role: 'columnheader',
      'aria-colindex': '2',
      tabindex: '0',
      'aria-sort': 'ascending',
      'data-active': '',
      'data-sort': 'ascending',
      'data-sort-index': undefined,
      'data-filtered': undefined,
      'data-column': 'c1',
      style: { width: '100px' },
    });
    expect(harness.g.resizerProps(row!.cells[1]!)).toStrictEqual({
      [GRID_RESIZER_ATTRIBUTE]: 'c1',
      'aria-hidden': 'true',
      'data-resizing': undefined,
      'data-disabled': undefined,
      style: { 'touch-action': 'none' },
    });
    expect(harness.g.gridProps()['aria-rowcount']).toBe(String(ROW_COUNT + 1));
    expect(harness.g.rowProps(harness.g.rows()[0]!)).toStrictEqual({
      'data-volt-virtual-index': '0',
      'aria-rowindex': '2',
      style: { height: `${ROW_HEIGHT}px` },
      role: 'row',
      'aria-selected': undefined,
      'data-selected': undefined,
    });
  });

  it('renders the header through the rows exactly as it rendered it through the columns', () => {
    setup(ONE_ROW_TEMPLATE);
    const before = host.querySelector('.header')!.outerHTML;
    for (const handle of mounted) handle.unmount();
    mounted = [];
    flushSync();

    setup();
    const strip = (html: string): string => html.replace(/<!--[^>]*-->/g, '');
    expect(strip(host.querySelector('.header')!.outerHTML)).toBe(strip(before));
  });

  it('moves a column anywhere, and has no group to shut', () => {
    withView();
    const harness = setup();
    harness.view!.moveColumn('c7', 3);
    harness.view!.collapseGroup('c0');
    flushSync();
    expect(order(harness.g).slice(0, 5)).toEqual(['c0', 'c1', 'c2', 'c7', 'c3']);
    expect(harness.g.columnCount()).toBe(COLUMN_COUNT);
  });

  it('keeps the arrows on the header row and Alt resizing its column', () => {
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW, column: 2 });
    press(document.activeElement!, 'ArrowUp');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 2 });
    press(document.activeElement!, 'ArrowRight', { altKey: true });
    expect(harness.g.columnWidth('c2')).toBe(COLUMN_WIDTH + 16);
    harness.g.resizeGroup('c2', 500);
    expect(harness.g.columnWidth('c2')).toBe(COLUMN_WIDTH + 16);
  });

  it('asks nothing of the pins: a pin that moves no column lays out no groups', () => {
    // Every column's `group` read is counted. With no column naming a group the
    // layout is not worked out at all, so it hears nothing of the pins.
    let looked = 0;
    const counted = makeColumns({}).map((column) => {
      const copy = { ...column };
      Object.defineProperty(copy, 'group', {
        get: () => {
          looked += 1;
          return undefined;
        },
      });
      return copy;
    });
    columns.set(counted);
    const harness = setup();
    flushSync();
    looked = 0;

    // c0 is already first, so pinning it to the start moves no column.
    harness.g.pinColumn('c0', 'start');
    flushSync();

    expect(harness.g.columnPin('c0')).toBe('start');
    expect(looked).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The groups laid out again under the cursor
// ---------------------------------------------------------------------------

describe('the cursor on a group laid out again under it', () => {
  it('keeps focus on its group when an unpin joins the part it was on to the one before', () => {
    const harness = setup();
    // c0 is already first, so pinning it moves no column: it only cuts Name
    // at the pinned edge, into a part over c0 and a part over c1.
    harness.g.pinColumn('c0', 'start');
    flushSync();
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 1 });
    flushSync();
    expect(document.activeElement).toBe(cellAt(HEADER_ROW - 2, 1));

    harness.g.pinColumn('c0', null);
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 0 });
    expect(document.activeElement).toBe(groupCell('name'));
    expect(tabStops()).toEqual([groupCell('name')]);
  });

  it('keeps focus on its part when a pin cuts an earlier part of the same group', () => {
    // Name is drawn twice, over c0–c1 and over c3, with c2 under nothing between.
    columns.set(makeColumns({ c0: NAME, c1: NAME, c3: NAME }));
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 3 });
    flushSync();
    expect(document.activeElement).toBe(cellAt(HEADER_ROW - 1, 3));

    // Cut at c0, the first part becomes two: the part the cursor is on is the
    // group's third run now, where it was its second.
    harness.g.pinColumn('c0', 'start');
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 3 });
    expect(document.activeElement).toBe(cellAt(HEADER_ROW - 1, 3));
    expect(document.activeElement!.getAttribute('aria-colspan')).toBe('1');
  });

  it('leaves focus where the reader put it, outside the grid', () => {
    const outside = document.body.appendChild(document.createElement('button'));
    const harness = setup();
    harness.g.pinColumn('c0', 'start');
    flushSync();
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 1 });
    outside.focus();
    flushSync();

    harness.g.pinColumn('c0', null);
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 0 });
    expect(document.activeElement).toBe(outside);
  });

  it('keeps focus on its part when the list is handed over with a part of its group before it', () => {
    columns.set(makeColumns({ c2: NAME, c3: NAME }));
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 2 });
    flushSync();
    expect(document.activeElement).toBe(groupCell('name'));

    // c0 joins Name, and the part over c2 and c3 is the group's second now.
    columns.set(makeColumns({ c0: NAME, c2: NAME, c3: NAME }));
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 2 });
    expect(document.activeElement).toBe(cellAt(HEADER_ROW - 1, 2));
  });

  it('leaves focus outside the grid where a part is added ahead of the one it was on', () => {
    const outside = document.body.appendChild(document.createElement('button'));
    columns.set(makeColumns({ c2: NAME, c3: NAME }));
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 2 });
    flushSync();
    outside.focus();
    flushSync();

    columns.set(makeColumns({ c0: NAME, c2: NAME, c3: NAME }));
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 2 });
    expect(document.activeElement).toBe(outside);
  });

  it('stays on its group, not the one moved to its place, when a group moves to the front', () => {
    withView();
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 0 });
    flushSync();
    const announcedFocus: (string | null)[] = [];
    harness.root.addEventListener('focusin', (event) =>
      announcedFocus.push((event.target as Element).getAttribute('data-column-group')),
    );

    harness.view!.moveGroup('work', 0);
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 5 });
    expect(document.activeElement).toBe(groupCell('name'));
    // Never by way of Work, now where Name was.
    expect(announcedFocus).not.toContain('work');
  });

  it('leaves focus on a control inside the group cell as its group is shut and opened', () => {
    withView();
    // A control of the page's own in every header cell, as a group's shut button is.
    const harness = setup(
      TEMPLATE.replace(
        '<span class="label">{ cell.header }</span>',
        '<span class="label">{ cell.header }</span><button class="control">Shut</button>',
      ),
    );
    const control = groupCell('work').querySelector<HTMLElement>('.control')!;
    control.focus();
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 2 });

    harness.view!.collapseGroup('work');
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 2 });
    expect(document.activeElement).toBe(control);

    harness.view!.expandGroup('work');
    flushSync();
    expect(document.activeElement).toBe(control);
  });
});

// ---------------------------------------------------------------------------
// A group with no width to share by
// ---------------------------------------------------------------------------

describe('resizing a group whose columns have no width', () => {
  const ZERO = { width: 0, minWidth: 0 };

  it('shares the width evenly, there being no proportion to keep', () => {
    columns.set(makeColumns(GROUPS, { c2: ZERO, c3: ZERO, c4: ZERO }));
    const harness = setup();
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([0, 0, 0]);

    harness.g.resizeGroup('role', 300);
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([100, 100, 100]);
  });

  it('opens up from nothing with a drag of its handle and with Alt and an arrow', () => {
    columns.set(makeColumns(GROUPS, { c2: ZERO, c3: ZERO, c4: ZERO }));
    const harness = setup();
    const handle = groupResizer('role');
    handle.dispatchEvent(pointer('pointerdown', { clientX: 400 }));
    handle.dispatchEvent(pointer('pointermove', { clientX: 490 }));
    handle.dispatchEvent(pointer('pointerup', { clientX: 490 }));
    flushSync();
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([30, 30, 30]);

    harness.g.resizeGroup('role', 0);
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 2 });
    press(document.activeElement!, 'ArrowRight', { altKey: true });
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([6, 5, 5]);
  });

  it('keeps a column with no width at none while the others in the group have some', () => {
    columns.set(makeColumns(GROUPS, { c2: ZERO }));
    const harness = setup();
    harness.g.resizeGroup('role', 400);
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([0, 200, 200]);
  });
});

describe('resizing a group to within a pixel of a bound', () => {
  it('holds a column at its minimum where its share falls short of it by less than a pixel', () => {
    columns.set(makeColumns(GROUPS, { c1: { width: 300 } }));
    const harness = setup();
    // In proportion, c0 would be 39.25, short of its 40, and c1 117.75.
    harness.g.resizeGroup('name', 157);
    expect(widths(harness.g, ['c0', 'c1'])).toEqual([40, 117]);
  });

  it('holds a column at its maximum where its share passes it by less than a pixel', () => {
    columns.set(makeColumns(GROUPS, { c0: { maxWidth: 120 } }));
    const harness = setup();
    // In proportion, each would be 120.5, past c0's 120.
    harness.g.resizeGroup('name', 241);
    expect(widths(harness.g, ['c0', 'c1'])).toEqual([120, 121]);
  });
});

// ---------------------------------------------------------------------------
// The layers over the grid
// ---------------------------------------------------------------------------

describe("the layers over the grid, on a group's cell", () => {
  it('opens no editor there, and neither copies nor pastes', async () => {
    const harness = setup();
    const layers = createRoot((dispose) => {
      restores.push(dispose);
      const editing = createCellEditing<Person>({
        grid: () => harness.g,
        editors: () => ({ c2: {}, c3: {} }),
        onCommit: () => {},
      });
      const clipboard = createGridClipboard<Person>({
        grid: () => harness.g,
        columns: () => columns.get(),
        getRowKey: (row) => row.id,
        editing: () => editing,
      });
      return { editing, clipboard };
    });
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 2 });
    flushSync();
    const cursor = harness.g.activeCell();
    expect(cursor).toEqual({ row: HEADER_ROW - 2, column: 2 });

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    groupCell('work').dispatchEvent(enter);
    expect(layers.editing.onKeyDown(enter)).toBe(false);
    expect(layers.editing.beginAt(cursor)).toBe(false);
    expect(layers.editing.session()).toBeNull();
    expect(await layers.clipboard.copy()).toBeNull();
    expect(await layers.clipboard.paste()).toBeNull();
    expect(harness.g.activeCell()).toEqual(cursor);
  });
});

// ---------------------------------------------------------------------------
// The cursor on a group while the columns under it change
// ---------------------------------------------------------------------------

describe('the cursor on a group as the column list changes', () => {
  /** Every cell focus lands on in the grid, by its group, or by its place where it has none. */
  function focusTrail(root: HTMLElement): string[] {
    const trail: string[] = [];
    root.addEventListener('focusin', (event) => {
      const el = event.target as Element;
      trail.push(el.getAttribute('data-column-group') ?? el.getAttribute(GRID_CELL_ATTRIBUTE) ?? '');
    });
    return trail;
  }

  it("goes down to the header of the column it follows when every column of its group goes, by way of nothing else", () => {
    withView();
    const moves: string[] = [];
    gridOptions = { ...gridOptions, onActiveCellChange: (cell) => moves.push(`${cell.row},${cell.column}`) };
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 5 });
    flushSync();
    expect(document.activeElement).toBe(groupCell('pay'));
    const trail = focusTrail(harness.root);
    moves.length = 0;

    // Pay's columns go; c4, before them, is the nearest column left, and Pay is
    // not over it.
    harness.view!.setColumnHidden('c5', true);
    harness.view!.setColumnHidden('c6', true);
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 4 });
    expect(document.activeElement).toBe(cellAt(HEADER_ROW, 4));
    // Never by way of Role, which is drawn over c4 on the row Pay was on.
    expect(trail).toEqual([`${HEADER_ROW},4`]);
    expect(moves).toEqual([`${HEADER_ROW},4`]);
  });

  it('goes straight to the row its group is drawn on when showing columns adds a row of groups', () => {
    withView();
    const moves: string[] = [];
    gridOptions = { ...gridOptions, onActiveCellChange: (cell) => moves.push(`${cell.row},${cell.column}`) };
    const harness = setup();
    const work = ['c2', 'c3', 'c4', 'c5', 'c6'];
    for (const id of work) harness.view!.setColumnHidden(id, true);
    flushSync();
    expect(harness.g.headerRows()).toHaveLength(2);
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 3 });
    flushSync();
    expect(document.activeElement).toBe(groupCell('other'));
    const trail = focusTrail(harness.root);
    moves.length = 0;

    // Work's columns come back two groups deep, so Other is on the row above
    // the one it was on, over c8, past the window.
    for (const id of work) harness.view!.setColumnHidden(id, false);
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 8 });
    expect(document.activeElement).toBe(groupCell('other'));
    // Not by way of c8's header, which is what the old row number names over c8 now.
    expect(moves).toEqual([`${HEADER_ROW - 2},8`]);
    expect(trail.every((step) => step === 'other')).toBe(true);
  });
});

describe('a group a pin or a reorder has parted, kept from parting further', () => {
  beforeEach(withView);

  /**
   * How many parts each group is drawn in, by id, over every column whether
   * the window holds it or not: a part ends where the next column is not
   * under the group, or is held at another edge.
   */
  function parts(g: Grid<Person>): Record<string, number> {
    const count: Record<string, number> = {};
    const groupsOf = (index: number): string[] => {
      const ids: string[] = [];
      for (let group = g.columnAt(index)?.group; group !== undefined; group = group.parent) ids.push(group.id);
      return ids;
    };
    for (let i = 0; i < g.columnCount(); i++) {
      const before = i === 0 ? [] : groupsOf(i - 1);
      const samePin = i > 0 && g.columnPin(g.columnAt(i - 1)!.id) === g.columnPin(g.columnAt(i)!.id);
      for (const id of groupsOf(i)) {
        if (!samePin || !before.includes(id)) count[id] = (count[id] ?? 0) + 1;
      }
    }
    return count;
  }

  it('keeps a column beside a column of its group in the region it lands in, never in the gap a pin left', () => {
    // Drawn: c3 | c0 c1 c2 c4 … — Role and Work are drawn over c3, pinned, and again from c2.
    columns.set(makeColumns(GROUPS, { c3: { pin: 'start' as GridColumnPin } }));
    const harness = setup();
    expect(parts(harness.g)).toMatchObject({ work: 2, role: 2, name: 1 });

    // Straight after the pinned c3 is the first place among the scrolling
    // columns, before Name: a part of Role and of Work of its own. The nearest
    // place beside a column of Role is before c3, among the pinned columns.
    harness.view!.moveColumn('c2', 1);
    flushSync();

    expect(order(harness.g).slice(0, 6)).toEqual(['c2', 'c3', 'c0', 'c1', 'c4', 'c5']);
    expect(harness.g.columnPin('c2')).toBe('start');
    expect(parts(harness.g)).toMatchObject({ work: 2, role: 2, name: 1 });
  });

  it('keeps a group beside a column of the group it is in, in the region it lands in', () => {
    columns.set(makeColumns(GROUPS, { c3: { pin: 'start' as GridColumnPin } }));
    const harness = setup();

    harness.view!.moveGroup('pay', 1);
    flushSync();

    expect(order(harness.g).slice(0, 7)).toEqual(['c5', 'c6', 'c3', 'c0', 'c1', 'c2', 'c4']);
    expect(['c5', 'c6'].map((id) => harness.g.columnPin(id))).toEqual(['start', 'start']);
    expect(parts(harness.g)).toMatchObject({ work: 2, pay: 1, role: 2, name: 1 });
  });

  it('leaves a column a pin parted from its group where it is, for a move to where it already is', () => {
    columns.set(makeColumns(GROUPS, { c0: { pin: 'start' as GridColumnPin } }));
    const harness = setup();
    const before = order(harness.g);

    // c1 is the one column of Name that scrolls; its place is beside no other.
    harness.view!.moveColumn('c1', 1);
    flushSync();

    expect(order(harness.g)).toEqual(before);
    expect(harness.g.columnPin('c1')).toBeNull();
  });

  it('keeps a column beside a column of its group, never between two columns a reorder put in its gap', () => {
    // Role over c0 c1 and again over c4, with c2 and c3 under nothing between.
    columns.set(makeColumns({ c0: ROLE, c1: ROLE, c4: ROLE }));
    const harness = setup();
    expect(parts(harness.g)).toMatchObject({ role: 2, work: 2 });

    harness.view!.moveColumn('c0', 2);
    flushSync();

    // As near beside c1 as beside c4: the side it came from.
    expect(order(harness.g).slice(0, 5)).toEqual(['c1', 'c0', 'c2', 'c3', 'c4']);
    expect(parts(harness.g)).toMatchObject({ role: 2, work: 2 });
  });
});

describe('a pinned group, and a group resize that changes some columns or none', () => {
  it("keeps the tab stop on a pinned group's cell however far the columns scroll", () => {
    columns.set(makeColumns(GROUPS, { c0: { pin: 'start' as GridColumnPin }, c1: { pin: 'start' as GridColumnPin } }));
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 0 });
    flushSync();
    expect(document.activeElement).toBe(groupCell('name'));

    // The window is far past c0 and c1, which are drawn at the edge all the same.
    userScroll(harness.scroller, { left: 800 });

    expect(harness.g.columns()[2]!.index).toBeGreaterThan(5);
    expect(groupCell('name').getAttribute('data-pinned')).toBe('start');
    expect(tabStops()).toEqual([groupCell('name')]);
  });

  it('tells onColumnResize only of the columns the share changed', () => {
    const resized: [string, number][] = [];
    gridOptions = { ...gridOptions, onColumnResize: (id, width) => resized.push([id, width]) };
    // c3 is at its cap already, and c4 cannot be resized: only c2 can take more.
    columns.set(makeColumns(GROUPS, { c3: { maxWidth: 100 }, c4: { resizable: false } }));
    const harness = setup();

    harness.g.resizeGroup('role', 400);

    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([200, 100, 100]);
    expect(resized).toEqual([['c2', 200]]);
  });

  it('says nothing for Alt and an arrow on a group none of whose columns can grow', () => {
    const resized: string[] = [];
    gridOptions = { ...gridOptions, onColumnResize: (id) => resized.push(id) };
    const capped = { maxWidth: COLUMN_WIDTH };
    columns.set(makeColumns(GROUPS, { c2: capped, c3: capped, c4: capped }));
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 2 });

    press(document.activeElement!, 'ArrowRight', { altKey: true });

    // Spent, as at the edge of any row, and silent: no width changed to say.
    expect(harness.instance.handled).toBe(true);
    expect(widths(harness.g, ['c2', 'c3', 'c4'])).toEqual([100, 100, 100]);
    expect(resized).toEqual([]);
    expect(document.querySelector('[data-volt-announcer]')).toBeNull();
  });
});

describe("a group's cell handed out again for what changed under it", () => {
  it('moves a group cell when a column before it is resized, and nothing else about it changes', () => {
    const harness = setup();
    const work = (): GridHeaderCell<Person> => harness.g.headerRows()[0]!.cells.find((cell) => cell.group?.id === 'work')!;
    expect([work().start, work().width]).toEqual([200, 300]);

    harness.g.resizeColumn('c0', 150);
    flushSync();

    // Drawn over the same three columns, as wide as before, from further along.
    expect([work().start, work().width]).toEqual([250, 300]);
  });

  it('holds a group at the edge when the columns under it are pinned where they already were', () => {
    const harness = setup();
    harness.g.pinColumn('c0', 'start');
    harness.g.pinColumn('c1', 'start');
    flushSync();

    const name = harness.g.headerRows()[0]!.cells[0]!;
    expect([name.index, name.colspan, name.start, name.width, name.pin]).toEqual([0, 2, 0, 200, 'start']);
    expect(groupCell('name').style.position).toBe('sticky');
    expect(groupCell('name').getAttribute('data-pinned')).toBe('start');
  });

  it('hands out the group the columns name now, under its new heading or its old one', () => {
    const harness = setup();
    const renamed: GridColumnGroup = { id: 'name', header: 'Full name' };
    columns.set(makeColumns({ ...GROUPS, c0: renamed, c1: renamed }));
    flushSync();
    expect(harness.g.headerRows()[0]!.cells[0]!.group).toBe(renamed);
    expect(headerText()[0]![0]).toBe('Full name');

    // A fresh object under the same heading is still the one handed out.
    const again: GridColumnGroup = { ...renamed };
    columns.set(makeColumns({ ...GROUPS, c0: again, c1: again }));
    flushSync();
    expect(harness.g.headerRows()[0]!.cells[0]!.group).toBe(again);
  });

  it('lets go of a column that leaves the list during a drag, and shares the drag among the rest', () => {
    withView();
    const harness = setup();
    const handle = groupResizer('role');
    handle.dispatchEvent(pointer('pointerdown', { clientX: 400 }));
    flushSync();

    harness.view!.setColumnHidden('c3', true);
    flushSync();
    handle.dispatchEvent(pointer('pointermove', { clientX: 600 }));
    handle.dispatchEvent(pointer('pointerup', { clientX: 600 }));
    flushSync();

    expect(widths(harness.g, ['c2', 'c4'])).toEqual([200, 200]);
    harness.view!.setColumnHidden('c3', false);
    flushSync();
    expect(harness.g.columnWidth('c3')).toBe(COLUMN_WIDTH);
  });
});

describe('a gap over a pinned column, and a cell range under the keys among the groups', () => {
  it('holds a gap over a pinned column at the edge, as the cells beside it are', () => {
    columns.set(makeColumns(GROUPS, { c7: { pin: 'start' as GridColumnPin } }));
    const harness = setup();
    // Drawn: c7 | c0 c1 …, and c7 is under no group.
    const gap = harness.g.headerRows()[0]!.cells[0]!;
    expect([gap.group, gap.index, gap.pin]).toEqual([null, 0, 'start']);
    expect(harness.g.headerCellProps(gap)).toStrictEqual({
      role: 'none',
      'data-column-group-gap': '',
      style: { width: '100px', position: 'sticky', 'inset-inline-start': '0px' },
      'data-pinned': 'start',
    });
  });

  it('ends a cell range when the arrows move along a row of groups, as any move but an extension does', () => {
    gridOptions = { ...gridOptions, cellSelection: 'range' };
    const harness = setup();
    harness.g.setCellRange({ anchor: { row: 1, column: 1 }, focus: { row: 2, column: 2 } });
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 0 });
    flushSync();
    expect(harness.g.cellRange()).not.toBeNull();

    press(document.activeElement!, 'ArrowRight');

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 2 });
    expect(harness.g.cellRange()).toBeNull();
  });
});

describe('a group cell holding focus while columns change elsewhere', () => {
  it('leaves the window where the reader scrolled it when a column after the group goes', () => {
    withView();
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 2 });
    flushSync();
    // c2 leaves the window; Work is still drawn over c3 to c6, and keeps focus.
    userScroll(harness.scroller, { left: 500 });
    expect(document.activeElement).toBe(groupCell('work'));
    const window = harness.g.columns().map((col) => col.index);
    expect(window).not.toContain(2);

    harness.view!.setColumnHidden('c11', true);
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 2 });
    expect(document.activeElement).toBe(groupCell('work'));
    expect(harness.scroller.scrollLeft).toBe(500);
    expect(harness.g.columns().map((col) => col.index)).toEqual(window);
  });

  it('brings focus back to its part, and leaves the window where it was, when a part is added off screen ahead of it', () => {
    columns.set(makeColumns({ c2: NAME, c3: NAME, c4: NAME, c5: NAME, c6: NAME }));
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 1, column: 2 });
    flushSync();
    userScroll(harness.scroller, { left: 500 });
    const window = harness.g.columns().map((col) => col.index);
    expect(window).not.toContain(2);
    expect(document.activeElement).toBe(cellAt(HEADER_ROW - 1, 2));

    // c0 joins Name, out of the window: the part the cursor is on is Name's
    // second now, and its cell another element. Nothing the reader sees moved.
    columns.set(makeColumns({ c0: NAME, c2: NAME, c3: NAME, c4: NAME, c5: NAME, c6: NAME }));
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 2 });
    expect(document.activeElement).toBe(cellAt(HEADER_ROW - 1, 2));
    expect(harness.scroller.scrollLeft).toBe(500);
    expect(harness.g.columns().map((col) => col.index)).toEqual(window);
  });

  /** Wide over c0 to c8; Top › Sub over c9 to c11, which makes the header two groups deep. */
  function wideAndDeep(): void {
    const wide: GridColumnGroup = { id: 'wide', header: 'Wide' };
    const sub: GridColumnGroup = { id: 'sub', header: 'Sub', parent: { id: 'top', header: 'Top' } };
    const groups: Record<string, GridColumnGroup> = {};
    for (let i = 0; i < 9; i++) groups[`c${i}`] = wide;
    for (let i = 9; i < COLUMN_COUNT; i++) groups[`c${i}`] = sub;
    columns.set(makeColumns(groups));
  }

  it('follows its group to another row without scrolling, where the reader can see the group', () => {
    withView();
    wideAndDeep();
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 0 });
    flushSync();
    // c0 out of view; Wide still on screen, over c3 to c8.
    userScroll(harness.scroller, { left: 500 });
    expect(harness.g.columns()[0]!.index).toBe(3);

    // Sub's columns go, after Wide: one row of groups is left, and Wide is on
    // it. Nothing moved across.
    for (const id of ['c9', 'c10', 'c11']) harness.view!.setColumnHidden(id, true);
    flushSync();

    expect(harness.g.headerRows()).toHaveLength(2);
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 0 });
    expect(document.activeElement).toBe(groupCell('wide'));
    expect(harness.scroller.scrollLeft).toBe(500);
    expect(harness.g.columns()[0]!.index).toBe(3);
  });

  it('scrolls to its group where the reader can see none of it once followed', () => {
    withView();
    wideAndDeep();
    const harness = setup();
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 0 });
    flushSync();
    expect(harness.scroller.scrollLeft).toBe(0);

    // Wide goes after Top: c9 to c11 fill the screen, and Wide starts at c3,
    // in the window's overscan, drawn but out of sight.
    harness.view!.moveGroup('wide', COLUMN_COUNT);
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 2, column: 3 });
    expect(document.activeElement).toBe(groupCell('wide'));
    // Brought into view by the least scroll, as a column followed out of
    // sight is.
    expect(harness.scroller.scrollLeft).toBe(100);
  });
});

describe('a row of groups the window holds none of', () => {
  /** Every element exposed as a row, and how many cells it holds. */
  function cellsPerRow(): [string | null, number][] {
    return [...host.querySelectorAll('[role="row"]')].map((row) => [
      row.getAttribute('aria-rowindex'),
      row.querySelectorAll('[role="columnheader"], [role="gridcell"]').length,
    ]);
  }

  it('is no row to a screen reader while it holds only gaps, and a row again once it holds a group', () => {
    const harness = setup();
    // Far enough along that the middle row is over c7 to c11, under no group
    // at that level: two gaps and nothing else.
    userScroll(harness.scroller, { left: 900 });
    const middle = host.querySelectorAll<HTMLElement>('.header-row')[1]!;
    expect(middle.querySelectorAll('[data-column-group-gap]')).toHaveLength(2);

    // A row must hold a cell. Still drawn, as the gaps keep the rows in line,
    // and still counted, as a row the window has left is.
    expect(middle.getAttribute('role')).toBe('none');
    expect(middle.hasAttribute('aria-rowindex')).toBe(false);
    expect(cellsPerRow().every(([, cells]) => cells > 0)).toBe(true);
    expect(harness.g.gridProps()['aria-rowcount']).toBe(String(ROW_COUNT + 3));
    expect(host.querySelectorAll<HTMLElement>('.header-row')[2]!.getAttribute('aria-rowindex')).toBe('3');

    userScroll(harness.scroller, { left: 0 });
    expect(middle.getAttribute('role')).toBe('row');
    expect(middle.getAttribute('aria-rowindex')).toBe('2');
  });
});

describe('a group followed while the pinned columns cover it', () => {
  /** Work in one row over c2 to c6, so Role and Pay going takes a row of groups away. */
  const SHALLOW = { ...GROUPS, c2: WORK, c3: WORK, c4: WORK, c5: WORK, c6: WORK };

  it('scrolls it out from under the columns pinned at the start', () => {
    const pinned = { c7: { pin: 'start' as const } };
    columns.set(makeColumns(GROUPS, pinned));
    const harness = setup();
    // c7 is held at the start, so Name sits at 100 to 300.
    expect(order(harness.g).slice(0, 3)).toEqual(['c7', 'c0', 'c1']);
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 1 });
    flushSync();
    expect(document.activeElement).toBe(groupCell('name'));
    // Scrolled 200 along: what is left of Name is under c7, drawn but out of
    // sight.
    userScroll(harness.scroller, { left: 200 });
    expect(harness.g.columns().some((col) => col.index === 1)).toBe(true);
    expect(document.activeElement).toBe(groupCell('name'));

    // A row of groups goes, and Name with the cursor on it goes down a row.
    columns.set(makeColumns(SHALLOW, pinned));
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 1 });
    expect(document.activeElement).toBe(groupCell('name'));
    // Clear of c7, by the least scroll that does it.
    expect(harness.scroller.scrollLeft).toBe(0);
  });

  it('scrolls it out from under the columns pinned at the end', () => {
    const pinned = { c7: { pin: 'end' as const } };
    columns.set(makeColumns(GROUPS, pinned));
    const harness = setup();
    // c7 is held at the end, so Other sits at 700 to 1100.
    expect(order(harness.g).slice(-2)).toEqual(['c11', 'c7']);
    harness.g.focusCell({ row: HEADER_ROW - 2, column: 7 });
    flushSync();
    expect(document.activeElement).toBe(groupCell('other'));
    // Scrolled back to 450: the band between the edges ends at 650, and
    // Other starts under c7, drawn but out of sight.
    userScroll(harness.scroller, { left: 450 });
    expect(harness.g.columns().some((col) => col.index === 7)).toBe(true);
    expect(document.activeElement).toBe(groupCell('other'));

    columns.set(makeColumns(SHALLOW, pinned));
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW - 1, column: 7 });
    expect(document.activeElement).toBe(groupCell('other'));
    // Its first column clear of c7: 700 to 800 in a band of 200.
    expect(harness.scroller.scrollLeft).toBe(600);
  });
});
