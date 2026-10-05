/**
 * Right to left, driven through a real mounted grid under `dir="rtl"`.
 *
 * The geometry and the keyboard the grid has always had, asked again of a
 * grid whose page runs the other way: the same suites, run once in each
 * direction, with the transforms the grid composes and the arrows it reads
 * expected mirrored right to left and exactly as they were left to right.
 * Offsets measured along a row are distances from the inline start, which is
 * the right in a right-to-left page, so they are the same numbers both ways;
 * what changes is the sign of a physical transform and which arrow points at
 * the next column.
 *
 * happy-dom has no user-agent stylesheet, so a `dir` attribute alone gives an
 * element no `direction` there. The rule HTML gives every browser for it is
 * installed below, and the grid is asked the direction a browser would
 * compute — from the attribute, inherited, or from a stylesheet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLocale,
  createLocaleProvider,
  resetAnnouncer,
  type LocaleProvider,
} from '@voltdev/primitives';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, effect, flushSync, mount } from '@voltdev/core';
import {
  GRID_CELL_ATTRIBUTE,
  GRID_COLUMN_GROUP_RESIZER_ATTRIBUTE,
  GRID_GROUP_ATTRIBUTE,
  GRID_RESIZER_ATTRIBUTE,
  HEADER_ROW,
  createCellEditing,
  createExport,
  createGrid,
  createGridClipboard,
  createGrouping,
  type Grid,
  type GridCellEditing,
  type GridColumn,
  type GridColumnGroup,
  type GridColumnPin,
  type GridGroupedRow,
  type GridGrouping,
  type GridOptions,
  type GridRow,
  type GridSort,
} from '../src/index.ts';
import { gridDirection, watchDirection } from '../src/direction.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Person {
  readonly id: number;
  readonly cells: readonly Signal.State<string>[];
}

type Dir = 'ltr' | 'rtl';

const ROW_COUNT = 1000;
const COLUMN_COUNT = 12;
const ROW_HEIGHT = 20;
const COLUMN_WIDTH = 100;
/** Five rows and three columns are on screen; two more of each are overscan. */
const VIEWPORT_HEIGHT = 100;
const VIEWPORT_WIDTH = 300;

/** What HTML's user-agent stylesheet says of `dir`, which happy-dom does not ship. */
const UA_DIRECTION = '[dir="rtl" i] { direction: rtl; } [dir="ltr" i] { direction: ltr; }';

/** Every rendering accessor call, as `row:column`. */
let reads: string[] = [];

function makeRow(id: number): Person {
  return {
    id,
    cells: Array.from({ length: COLUMN_COUNT }, (_, col) => new Signal.State(`r${id}c${col}`)),
  };
}

function makeColumns(pins: Readonly<Record<string, GridColumnPin>> = {}): GridColumn<Person>[] {
  return Array.from({ length: COLUMN_COUNT }, (_, index) => {
    const id = `c${index}`;
    const column: GridColumn<Person> = {
      id,
      header: `Column ${index}`,
      width: COLUMN_WIDTH,
      value: (row: Person) => {
        reads.push(`${row.id}:${index}`);
        return row.cells[index]!.get();
      },
      sortValue: (row: Person) => row.cells[index]!.get(),
      filterValue: (row: Person) => row.cells[index]!.get(),
    };
    return id in pins ? { ...column, pin: pins[id] } : column;
  });
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

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;

let people: Signal.State<readonly Person[]>;
let columns: Signal.State<readonly GridColumn<Person>[]>;
let top: Signal.State<readonly Person[]>;
let gridOptions: Partial<GridOptions<Person>>;

beforeEach(() => {
  document.head.innerHTML = `<style>${UA_DIRECTION}</style>`;
  document.body.innerHTML = '<div id="app"></div>';
  document.documentElement.removeAttribute('dir');
  host = document.querySelector('#app')!;

  reads = [];
  people = new Signal.State<readonly Person[]>(
    Array.from({ length: ROW_COUNT }, (_, id) => makeRow(id)),
  );
  columns = new Signal.State<readonly GridColumn<Person>[]>(makeColumns());
  top = new Signal.State<readonly Person[]>([]);
  gridOptions = { rowHeight: ROW_HEIGHT, label: 'People', getRowKey: (row) => row.id };

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

const GRID = `
  <div class="grid" :ref="grid" :spread="g.gridProps()"
       :keydown="onKey($event)" :focusin="g.onFocusIn($event)">
    <div class="header" :spread="g.headerProps()">
      <div class="header-row" :spread="g.headerRowProps()">
        <div class="th" :for="col in g.columns()" :key="col.key" :spread="g.headerCellProps(col)">
          <span class="label">{ col.column.header }</span>
          <span class="resizer" :spread="g.resizerProps(col)"
                :pointerdown="g.onResizePointerDown($event)"></span>
        </div>
      </div>
      <div class="row top" :for="row in g.pinnedTopRows()" :key="row.key" :spread="g.rowProps(row)">
        <div class="cell" :for="col in g.columns()" :key="col.key"
             :spread="g.cellProps(row, col)">{ g.cellValue(row, col) }</div>
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

/** The same grid inside an element a locale provider governs. */
const IN_LOCALE = `<div class="locale" :ref="region" :spread="locale.providerProps()">${GRID}</div>`;

/** The same grid with every header row it hands out: the groups', then the columns'. */
const GROUP_HEADER = `
  <div class="grid" :ref="grid" :spread="g.gridProps()"
       :keydown="onKey($event)" :focusin="g.onFocusIn($event)">
    <div class="header" :spread="g.headerProps()">
      <div class="header-row" :for="hr in g.headerRows()" :key="hr.key" :spread="g.headerRowProps(hr)">
        <div class="th" :for="cell in hr.cells" :key="cell.key" :spread="g.headerCellProps(cell)">
          <span class="label">{ cell.header }</span>
          <span class="resizer" :spread="g.resizerProps(cell)"
                :pointerdown="g.onResizePointerDown($event)"></span>
        </div>
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

interface Harness {
  g: Grid<Person>;
  locale: LocaleProvider | null;
  root: HTMLElement;
  scroller: HTMLElement;
  container: HTMLElement;
  headerRow: HTMLElement;
}

/**
 * Mount a grid with `dir` written on the element it is mounted into, as a page
 * marks a region up — or, with `locale`, inside a locale provider's element.
 */
function setup({
  dir,
  locale = false,
  template = GRID,
}: { dir?: Dir; locale?: boolean; template?: string } = {}): Harness {
  if (dir !== undefined) host.setAttribute('dir', dir);
  else host.removeAttribute('dir');

  @Component({
    selector: `v-rtl-grid-${++selectors}`,
    render: compileTemplate(locale ? IN_LOCALE : template),
  })
  class GridComponent {
    region = new Signal.State<Element | null>(null);
    // Before the grid, which reads the nearest locale when it is created.
    locale: LocaleProvider | null = locale
      ? createLocaleProvider({ defaultLocale: 'en', element: () => this.region.get() })
      : null;
    grid = new Signal.State<Element | null>(null);
    scroller = new Signal.State<Element | null>(null);
    container = new Signal.State<Element | null>(null);
    g: Grid<Person> = createGrid<Person>({
      ...gridOptions,
      grid: () => this.grid.get(),
      scroller: () => this.scroller.get(),
      container: () => this.container.get(),
      rows: () => people.get(),
      columns: () => columns.get(),
      pinnedTop: () => top.get(),
    });

    onKey(event: KeyboardEvent): void {
      this.g.onKeyDown(event);
    }
  }

  const handle = mount(GridComponent, host);
  mounted.push(handle);

  const scroller = host.querySelector<HTMLElement>('.body')!;
  Object.defineProperty(scroller, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true });
  Object.defineProperty(scroller, 'clientWidth', { value: VIEWPORT_WIDTH, configurable: true });
  FakeResizeObserver.deliver(scroller, VIEWPORT_HEIGHT, VIEWPORT_WIDTH);

  const instance = handle.instance as unknown as GridComponent;
  return {
    g: instance.g,
    locale: instance.locale,
    root: host.querySelector<HTMLElement>('.grid')!,
    scroller,
    container: host.querySelector<HTMLElement>('.container')!,
    headerRow: host.querySelector<HTMLElement>('.header-row')!,
  };
}

/**
 * A scroll the reader performed, `left` the distance from the inline start —
 * written back the way the DOM reports it, negative in a right-to-left
 * scroller, as every current engine does.
 */
function userScroll(el: HTMLElement, dir: Dir, { top: y = 0, left = 0 } = {}): void {
  el.scrollTop = y;
  el.scrollLeft = dir === 'rtl' ? -left : left;
  el.dispatchEvent(new Event('scroll'));
  flushSync();
}

function press(el: Element, key: string, modifiers: Partial<KeyboardEventInit> = {}): void {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
  );
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

function resizerFor(id: string): HTMLElement {
  return host.querySelector<HTMLElement>(`[${GRID_RESIZER_ATTRIBUTE}="${id}"]`)!;
}

/** Stand on a cell, with focus on it, as a reader who walked there would. */
function standOn(harness: Harness, row: number, column: number): void {
  harness.g.focusCell({ row, column });
  flushSync();
}

/** The distance `x` along a row as a physical translate in `dir`: mirrored right to left. */
function physical(dir: Dir, x: number): number {
  return dir === 'rtl' ? -x : x;
}

// ---------------------------------------------------------------------------
// The same suites, both ways
// ---------------------------------------------------------------------------

describe.each(['ltr', 'rtl'] as const)('geometry, %s', (dir) => {
  it('reads the direction of the page it is in', () => {
    const harness = setup({ dir });
    expect(harness.g.direction()).toBe(dir);
  });

  it('starts at the inline start, unmoved', () => {
    const harness = setup({ dir });
    expect(harness.g.columns().map((col) => [col.index, col.start])).toEqual([
      [0, 0], [1, 100], [2, 200], [3, 300], [4, 400],
    ]);
    expect(harness.container.style.transform).toBe('translate(0px, 0px)');
    expect(harness.headerRow.style.transform).toBe('translateX(0px)');
  });

  it('moves the window toward the inline end with one transform', () => {
    const harness = setup({ dir });
    userScroll(harness.scroller, dir, { top: 500, left: 500 });

    // The same columns at the same distances from the inline start both ways.
    expect(harness.g.columns().map((col) => col.index)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(harness.g.columns().map((col) => col.start)).toEqual([300, 400, 500, 600, 700, 800, 900]);
    // Transforms are physical: right to left, the window moves left.
    expect(harness.container.style.transform).toBe(`translate(${physical(dir, 300)}px, 460px)`);
  });

  it('keeps the header in step with a horizontal scroll', () => {
    const harness = setup({ dir });
    userScroll(harness.scroller, dir, { top: 500, left: 500 });
    expect(harness.headerRow.style.transform).toBe(`translateX(${physical(dir, -200)}px)`);
  });

  it('keeps a pinned row in step as it keeps the header', () => {
    top.set([makeRow(9000)]);
    const harness = setup({ dir });
    userScroll(harness.scroller, dir, { left: 500 });
    const pinned = host.querySelector<HTMLElement>('.row.top')!;
    expect(pinned.style.transform).toBe(`translateX(${physical(dir, -200)}px)`);
    expect(pinned.style.transform).toBe(harness.headerRow.style.transform);
  });

  it('scrolls a column into view toward the inline end, as the DOM signs it', () => {
    const harness = setup({ dir });
    standOn(harness, 0, 9);
    // Column 9 ends 1000px from the inline start, and 300px of it are in view.
    expect(harness.scroller.scrollLeft).toBe(physical(dir, 700));
    expect(harness.g.columns().map((col) => col.index)).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });
});

describe.each(['ltr', 'rtl'] as const)('the keyboard, %s', (dir) => {
  /** The column one cell to the right of `column` on screen. */
  const rightOf = (column: number): number => (dir === 'rtl' ? column - 1 : column + 1);
  const leftOf = (column: number): number => (dir === 'rtl' ? column + 1 : column - 1);

  it('moves ArrowRight to the cell on the right, and ArrowLeft to the one on the left', () => {
    const harness = setup({ dir });
    standOn(harness, 0, 5);

    press(document.activeElement!, 'ArrowRight');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: rightOf(5) });
    press(document.activeElement!, 'ArrowLeft');
    press(document.activeElement!, 'ArrowLeft');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: leftOf(5) });
    expect(document.activeElement).toBe(cellAt(0, leftOf(5)));
  });

  it('stops at the edge the arrow points at', () => {
    const harness = setup({ dir });
    standOn(harness, 0, 0);
    // Column 0 is at the inline start: on the right of a right-to-left row.
    press(document.activeElement!, dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
  });

  it('goes to the inline start with Home and the inline end with End', () => {
    const harness = setup({ dir });
    standOn(harness, 0, 5);
    press(document.activeElement!, 'Home');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
    press(document.activeElement!, 'End');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: COLUMN_COUNT - 1 });
  });

  it('walks the column header the way the arrow points, as it walks a row of cells', () => {
    const harness = setup({ dir });
    standOn(harness, HEADER_ROW, 5);

    press(document.activeElement!, 'ArrowRight');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: rightOf(5) });
    press(document.activeElement!, 'ArrowLeft');
    press(document.activeElement!, 'ArrowLeft');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: leftOf(5) });
    expect(document.activeElement).toBe(cellAt(HEADER_ROW, leftOf(5)));
  });

  it('goes to the first cell of the grid with Ctrl+Home and the last with Ctrl+End', () => {
    const harness = setup({ dir });
    standOn(harness, 3, 5);
    // Ends of the data, not sides of the screen: the last cell is at the
    // inline end, on the left of a right-to-left row.
    press(document.activeElement!, 'End', { ctrlKey: true });
    expect(harness.g.activeCell()).toEqual({ row: ROW_COUNT - 1, column: COLUMN_COUNT - 1 });
    press(document.activeElement!, 'Home', { ctrlKey: true });
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
  });

  it('extends a range toward the arrow, by a cell and to the edge', () => {
    gridOptions = { ...gridOptions, cellSelection: 'range' };
    const harness = setup({ dir });
    standOn(harness, 0, 5);

    press(document.activeElement!, 'ArrowRight', { shiftKey: true });
    expect(harness.g.cellRange()).toEqual({
      anchor: { row: 0, column: 5 },
      focus: { row: 0, column: rightOf(5) },
    });

    press(document.activeElement!, 'ArrowRight', { shiftKey: true, ctrlKey: true });
    expect(harness.g.cellRange()!.focus).toEqual({
      row: 0,
      column: dir === 'rtl' ? 0 : COLUMN_COUNT - 1,
    });
    press(document.activeElement!, 'ArrowLeft', { shiftKey: true, ctrlKey: true });
    expect(harness.g.cellRange()!.focus).toEqual({
      row: 0,
      column: dir === 'rtl' ? COLUMN_COUNT - 1 : 0,
    });
  });

  it("moves a column's inline-end edge the way Alt and the arrow point", () => {
    const harness = setup({ dir });
    standOn(harness, HEADER_ROW, 0);

    // Its free edge is on its right left to right, and on its left right to
    // left: the arrow pointing away from the column widens it.
    press(document.activeElement!, 'ArrowRight', { altKey: true });
    expect(harness.g.columnWidth('c0')).toBe(dir === 'rtl' ? 84 : 116);
    press(document.activeElement!, 'ArrowLeft', { altKey: true });
    press(document.activeElement!, 'ArrowLeft', { altKey: true });
    expect(harness.g.columnWidth('c0')).toBe(dir === 'rtl' ? 116 : 84);
  });

  it('follows the pointer with the handle at the inline end of the column', () => {
    const harness = setup({ dir });
    const handle = resizerFor('c1');
    handle.dispatchEvent(pointer('pointerdown', { clientX: 400 }));
    handle.dispatchEvent(pointer('pointermove', { clientX: 440 }));
    flushSync();
    // Forty pixels to the right: away from the column left to right, into it
    // right to left.
    expect(harness.g.columnWidth('c1')).toBe(dir === 'rtl' ? 60 : 140);
    handle.dispatchEvent(pointer('pointermove', { clientX: 330 }));
    handle.dispatchEvent(pointer('pointerup', { clientX: 330 }));
    flushSync();
    expect(harness.g.columnWidth('c1')).toBe(dir === 'rtl' ? 170 : 40);
  });
});

describe.each(['ltr', 'rtl'] as const)('pinned columns, %s', (dir) => {
  it('holds them at the inline edges with logical offsets, which swap sides by themselves', () => {
    columns.set(makeColumns({ c0: 'start', c11: 'end' }));
    const harness = setup({ dir });
    userScroll(harness.scroller, dir, { left: 500 });

    const first = harness.g.columns()[0]!;
    const last = harness.g.columns().at(-1)!;
    expect(harness.g.headerCellProps(first).style).toStrictEqual({
      width: '100px', position: 'sticky', 'inset-inline-start': '0px',
    });
    expect(harness.g.cellProps(harness.g.rows()[0]!, last).style).toStrictEqual({
      width: '100px', position: 'sticky', 'inset-inline-end': '0px',
    });
    // No transform across where a sticky cell would be carried off its edge,
    // and nothing physical either way: the browser puts the start on the right.
    expect(harness.g.containerProps().style).toStrictEqual({
      transform: 'translate(0px, 0px)',
      'padding-inline-start': '200px',
    });
    expect(harness.g.headerRowProps().style).toStrictEqual({ 'margin-inline-start': '-300px' });
    const body = harness.g.bodyProps().style as Record<string, string>;
    expect(body['scroll-padding-inline-start']).toBe('100px');
    expect(body['scroll-padding-inline-end']).toBe('100px');
  });

  it('scrolls a column clear of the pinned ones toward the inline end, as the DOM signs it', () => {
    columns.set(makeColumns({ c0: 'start', c11: 'end' }));
    const harness = setup({ dir });
    standOn(harness, 0, 9);
    // Column 9 ends 1000px from the inline start, and the band the pinned
    // columns leave is the 100px to 200px of the viewport: its end at 200px.
    expect(harness.scroller.scrollLeft).toBe(physical(dir, 800));
    expect(harness.g.columns().map((col) => col.index)).toContain(9);
    expect(document.activeElement).toBe(cellAt(0, 9));
  });
});

describe.each(['ltr', 'rtl'] as const)('a header of groups, %s', (dir) => {
  const NAME: GridColumnGroup = { id: 'name', header: 'Name' };
  const WORK: GridColumnGroup = { id: 'work', header: 'Work' };
  const OTHER: GridColumnGroup = { id: 'other', header: 'Other' };
  /** The one row of groups, above the columns' own. */
  const GROUPS = HEADER_ROW - 1;

  /** c0–c1 under Name, c2–c4 under Work, the rest under Other. */
  const withGroups = (): Harness => {
    columns.set(
      makeColumns().map((column, i) => ({ ...column, group: i < 2 ? NAME : i < 5 ? WORK : OTHER })),
    );
    return setup({ dir, template: GROUP_HEADER });
  };

  /** Work's width: every column under it. */
  const work = (g: Grid<Person>): number =>
    ['c2', 'c3', 'c4'].reduce((sum, id) => sum + g.columnWidth(id)!, 0);

  it('moves every row of the header across with the columns, mirrored as the one row is', () => {
    const harness = withGroups();
    userScroll(harness.scroller, dir, { left: 500 });
    const rows = [...host.querySelectorAll<HTMLElement>('.header-row')];
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.style.transform).toBe(`translateX(${physical(dir, -200)}px)`);
  });

  it('goes to the group the arrow points at, and to the ends of the row with Home and End', () => {
    const harness = withGroups();
    standOn(harness, GROUPS, 2);

    press(document.activeElement!, 'ArrowRight');
    // Other is on Work's right left to right, and Name is right to left.
    expect(harness.g.activeCell()).toEqual({ row: GROUPS, column: dir === 'rtl' ? 0 : 5 });
    press(document.activeElement!, 'ArrowLeft');
    press(document.activeElement!, 'ArrowLeft');
    expect(harness.g.activeCell()).toEqual({ row: GROUPS, column: dir === 'rtl' ? 5 : 0 });
    press(document.activeElement!, 'Home');
    expect(harness.g.activeCell()).toEqual({ row: GROUPS, column: 0 });
    press(document.activeElement!, 'End');
    expect(harness.g.activeCell()).toEqual({ row: GROUPS, column: 5 });
  });

  it("moves a group's inline-end edge the way Alt and the arrow point", () => {
    const harness = withGroups();
    standOn(harness, GROUPS, 2);
    press(document.activeElement!, 'ArrowRight', { altKey: true });
    expect(work(harness.g)).toBe(dir === 'rtl' ? 284 : 316);
  });

  it("follows the pointer with a group's handle at its inline end", () => {
    const harness = withGroups();
    const handle = host.querySelector<HTMLElement>(`[${GRID_COLUMN_GROUP_RESIZER_ATTRIBUTE}="work"]`)!;
    handle.dispatchEvent(pointer('pointerdown', { clientX: 400 }));
    handle.dispatchEvent(pointer('pointermove', { clientX: 440 }));
    handle.dispatchEvent(pointer('pointerup', { clientX: 440 }));
    flushSync();
    expect(work(harness.g)).toBe(dir === 'rtl' ? 260 : 340);
  });
});

// ---------------------------------------------------------------------------
// Following the page
// ---------------------------------------------------------------------------

describe('a change of direction', () => {
  it("follows a dir written on the grid's own element", async () => {
    const harness = setup();
    userScroll(harness.scroller, 'ltr', { left: 500 });
    expect(harness.container.style.transform).toBe('translate(300px, 0px)');

    harness.root.setAttribute('dir', 'rtl');
    await vi.waitFor(() => expect(harness.g.direction()).toBe('rtl'));
    flushSync();

    expect(harness.container.style.transform).toBe('translate(-300px, 0px)');
    expect(harness.headerRow.style.transform).toBe('translateX(200px)');
    standOn(harness, 0, 5);
    press(document.activeElement!, 'ArrowRight');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 4 });
    // The column axis writes its scrolls the new way too: a grid whose
    // transforms flipped and whose scrolling did not would scroll to nothing.
    standOn(harness, 0, 11);
    expect(harness.scroller.scrollLeft).toBe(-900);

    harness.root.setAttribute('dir', 'ltr');
    await vi.waitFor(() => expect(harness.g.direction()).toBe('ltr'));
  });

  it("follows the direction of the locale it is in, the page's own answer read again", async () => {
    const harness = setup({ locale: true });
    expect(harness.g.direction()).toBe('ltr');
    userScroll(harness.scroller, 'ltr', { left: 500 });

    harness.locale!.setDirection('rtl');
    flushSync();
    await vi.waitFor(() => expect(harness.g.direction()).toBe('rtl'));
    expect(host.querySelector('.locale')!.getAttribute('dir')).toBe('rtl');
    expect(harness.container.style.transform).toBe('translate(-300px, 0px)');
  });

  it('is not told of a dir written above it with no locale watching, and reads it when mounted again', async () => {
    let harness = setup();
    document.documentElement.setAttribute('dir', 'rtl');
    // Nothing observes the whole document on the grid's behalf.
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(harness.g.direction()).toBe('ltr');

    mounted.pop()!.unmount();
    host.innerHTML = '';
    harness = setup();
    expect(harness.g.direction()).toBe('rtl');
  });

  it('reads the direction a stylesheet gives it, with no dir anywhere', () => {
    host.style.direction = 'rtl';
    const harness = setup();
    expect(harness.g.direction()).toBe('rtl');
    userScroll(harness.scroller, 'rtl', { left: 500 });
    expect(harness.container.style.transform).toBe('translate(-300px, 0px)');
  });
});

describe('a dir written as the grid first settles', () => {
  /**
   * The grid, with an effect that writes `dir` on its element made before it
   * or after it: the effects of one settling run in the order they were made,
   * after the measure lane has read the direction.
   */
  const marked = (order: 'before' | 'after'): Grid<Person> => {
    @Component({ selector: `v-rtl-marked-${++selectors}`, render: compileTemplate(GRID) })
    class Marked {
      grid = new Signal.State<Element | null>(null);
      scroller = new Signal.State<Element | null>(null);
      container = new Signal.State<Element | null>(null);
      early = order === 'before' ? this.mark() : null;
      g: Grid<Person> = createGrid<Person>({
        ...gridOptions,
        grid: () => this.grid.get(),
        scroller: () => this.scroller.get(),
        container: () => this.container.get(),
        rows: () => people.get(),
        columns: () => columns.get(),
      });
      late = order === 'after' ? this.mark() : null;

      mark(): null {
        effect(() => {
          this.grid.get()?.setAttribute('dir', 'rtl');
        });
        return null;
      }

      onKey(event: KeyboardEvent): void {
        this.g.onKeyDown(event);
      }
    }
    const handle = mount(Marked, host);
    mounted.push(handle);
    const scroller = host.querySelector<HTMLElement>('.body')!;
    Object.defineProperty(scroller, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: VIEWPORT_WIDTH, configurable: true });
    FakeResizeObserver.deliver(scroller, VIEWPORT_HEIGHT, VIEWPORT_WIDTH);
    return (handle.instance as unknown as Marked).g;
  };

  it.each(['before', 'after'] as const)('hears it from an effect made %s the grid', async (order) => {
    const g = marked(order);
    expect(host.querySelector('.grid')!.getAttribute('dir')).toBe('rtl');
    await vi.waitFor(() => expect(g.direction()).toBe('rtl'));
    userScroll(host.querySelector<HTMLElement>('.body')!, 'rtl', { left: 500 });
    expect(host.querySelector<HTMLElement>('.container')!.style.transform).toBe('translate(-300px, 0px)');
  });
});

describe('turning round with focus on a cell', () => {
  /**
   * What a browser does to a scroller whose direction turns: puts it back at
   * its inline start. happy-dom keeps the old `scrollLeft`, so the reset is
   * made here, as the reader sees it, with the scroll event it sends.
   */
  const turn = async (harness: Harness, to: Dir): Promise<void> => {
    harness.root.setAttribute('dir', to);
    harness.scroller.scrollLeft = 0;
    harness.scroller.dispatchEvent(new Event('scroll'));
    flushSync();
    await vi.waitFor(() => expect(harness.g.direction()).toBe(to));
    flushSync();
  };

  it.each([
    ['ltr', 'rtl'],
    ['rtl', 'ltr'],
  ] as const)('brings the cell back into view, with focus, when %s turns to %s', async (from, to) => {
    const harness = setup({ dir: from });
    standOn(harness, 3, 10);
    expect(document.activeElement).toBe(cellAt(3, 10));

    await turn(harness, to);

    expect(harness.g.activeCell()).toEqual({ row: 3, column: 10 });
    expect(document.activeElement).toBe(cellAt(3, 10));
    // Column 10 ends 1100px from the inline start: 800px of scroll shows it.
    expect(harness.scroller.scrollLeft).toBe(physical(to, 800));
    press(document.activeElement!, 'ArrowDown');
    expect(document.activeElement).toBe(cellAt(4, 10));
  });

  it('leaves focus the reader took out of the grid where it is', async () => {
    const harness = setup({ dir: 'ltr' });
    standOn(harness, 3, 10);
    const outside = document.createElement('button');
    document.body.append(outside);
    restores.push(() => outside.remove());
    outside.focus();

    await turn(harness, 'rtl');

    expect(document.activeElement).toBe(outside);
    expect(harness.scroller.scrollLeft).toBe(0);
  });

  it('reads no cell more than the scroll the browser made does', async () => {
    const harness = setup({ dir: 'ltr' });
    // Nothing focused in the grid: a turn is a transform and the browser's scroll.
    userScroll(harness.scroller, 'ltr', { left: 700 });
    reads = [];
    await turn(harness, 'rtl');
    const turned = reads.length;

    const again = setup({ dir: 'ltr' });
    userScroll(again.scroller, 'ltr', { left: 700 });
    reads = [];
    userScroll(again.scroller, 'ltr', { left: 0 });
    expect(turned).toBe(reads.length);
  });
});

describe('reading the direction', () => {
  it('reads it once as the grid mounts, never for a scroll or a key, and once more for a dir', async () => {
    const styles = vi.spyOn(document.defaultView!, 'getComputedStyle');
    restores.push(() => styles.mockRestore());
    const harness = setup({ dir: 'rtl' });
    const reads = (): number => styles.mock.calls.filter(([el]) => el === harness.root).length;
    expect(reads()).toBe(1);

    userScroll(harness.scroller, 'rtl', { top: 200, left: 500 });
    standOn(harness, 0, 5);
    press(document.activeElement!, 'ArrowLeft');
    press(document.activeElement!, 'End');
    press(document.activeElement!, 'ArrowDown');
    expect(reads()).toBe(1);

    harness.root.setAttribute('dir', 'ltr');
    await vi.waitFor(() => expect(harness.g.direction()).toBe('ltr'));
    expect(reads()).toBe(2);
  });

  it('reads none for a locale that changes its language and not its direction', async () => {
    const styles = vi.spyOn(document.defaultView!, 'getComputedStyle');
    restores.push(() => styles.mockRestore());
    const harness = setup({ locale: true });
    const reads = (): number => styles.mock.calls.filter(([el]) => el === harness.root).length;
    const mounted = reads();

    harness.locale!.setLocale('fr');
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(reads()).toBe(mounted);

    // A language written the other way is a direction, and is read.
    harness.locale!.setLocale('ar');
    flushSync();
    await vi.waitFor(() => expect(harness.g.direction()).toBe('rtl'));
    expect(reads()).toBe(mounted + 1);
  });
});

describe('mounting right to left', () => {
  it("asks for the scroller's style no more often than mounting left to right", () => {
    const styles = vi.spyOn(document.defaultView!, 'getComputedStyle');
    restores.push(() => styles.mockRestore());
    // A stylesheet's direction with no dir anywhere, so the axes ask the
    // scroller's style. The column axis asks again whenever the direction it
    // was given changes, and a direction read after it would change under it
    // the moment the grid mounted.
    const scrollerReads = (dir: Dir): number => {
      host.style.direction = dir;
      styles.mockClear();
      setup();
      const count = styles.mock.calls.filter(([el]) => (el as Element).classList.contains('body')).length;
      mounted.pop()!.unmount();
      host.innerHTML = '';
      host.style.direction = '';
      return count;
    };
    const ltr = scrollerReads('ltr');
    expect(ltr).toBeGreaterThan(0);
    expect(scrollerReads('rtl')).toBe(ltr);
  });
});

describe("a locale that governs the grid's own element", () => {
  /** The grid's element is the locale's region: the provider writes its `dir` there. */
  const ON_ROOT = GRID.replace(':spread="g.gridProps()"', ':spread="rootProps()"');

  it('reads the style once for a change of direction it hears twice', async () => {
    @Component({ selector: `v-rtl-locale-root-${++selectors}`, render: compileTemplate(ON_ROOT) })
    class LocaleOnRoot {
      grid = new Signal.State<Element | null>(null);
      scroller = new Signal.State<Element | null>(null);
      container = new Signal.State<Element | null>(null);
      locale: LocaleProvider = createLocaleProvider({
        defaultLocale: 'en',
        element: () => this.grid.get(),
      });
      g: Grid<Person> = createGrid<Person>({
        ...gridOptions,
        grid: () => this.grid.get(),
        scroller: () => this.scroller.get(),
        container: () => this.container.get(),
        rows: () => people.get(),
        columns: () => columns.get(),
      });

      rootProps(): Record<string, unknown> {
        return { ...this.g.gridProps(), ...this.locale.providerProps() };
      }

      onKey(event: KeyboardEvent): void {
        this.g.onKeyDown(event);
      }
    }

    const styles = vi.spyOn(document.defaultView!, 'getComputedStyle');
    restores.push(() => styles.mockRestore());
    const handle = mount(LocaleOnRoot, host);
    mounted.push(handle);
    flushSync();
    const { g, locale } = handle.instance as unknown as LocaleOnRoot;
    const root = host.querySelector('.grid')!;
    const reads = (): number => styles.mock.calls.filter(([el]) => el === root).length;
    const atMount = reads();

    // The locale says so, and the `dir` it writes on the element says so again.
    locale.setDirection('rtl');
    flushSync();
    await vi.waitFor(() => expect(g.direction()).toBe('rtl'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(root.getAttribute('dir')).toBe('rtl');
    expect(reads()).toBe(atMount + 1);

    // A `dir` the page writes there afterwards is still heard.
    root.setAttribute('dir', 'ltr');
    await vi.waitFor(() => expect(g.direction()).toBe('ltr'));
    expect(reads()).toBe(atMount + 2);
  });
});

describe('two grids on one element', () => {
  it('answers for the grid mounted there since, when an earlier one lets go of it', () => {
    host.setAttribute('dir', 'rtl');
    const root = document.createElement('div');
    const cell = document.createElement('span');
    // A label running its own way, which a layer's arrows must not follow.
    cell.setAttribute('dir', 'ltr');
    root.append(cell);
    host.append(root);
    const locale = createLocale();
    let earlier!: () => void;
    let later!: () => void;
    createRoot((dispose) => {
      earlier = dispose;
      watchDirection(() => root, locale, () => 0);
    });
    flushSync();
    createRoot((dispose) => {
      later = dispose;
      watchDirection(() => root, locale, () => 0);
    });
    flushSync();
    restores.push(() => later());

    earlier();
    flushSync();
    expect(gridDirection(cell)).toBe('rtl');
  });
});

describe('a grid built before the page attaches it', () => {
  /**
   * Mount into an element out of the document, as a page that builds first
   * and attaches after. Out of the document nothing has a box, and that is
   * what the scroller and its observer say.
   */
  const built = (): { harness: Harness; element: HTMLElement } => {
    const page = host;
    const element = document.createElement('div');
    host = element;
    try {
      const harness = setup();
      laidOutAt(harness.scroller, 0, 0);
      return { harness, element };
    } finally {
      host = page;
    }
  };

  /** The scroller's box, and the observer telling the axes about it, as layout would. */
  const laidOutAt = (scroller: HTMLElement, height: number, width: number): void => {
    Object.defineProperty(scroller, 'clientHeight', { value: height, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: width, configurable: true });
    FakeResizeObserver.deliver(scroller, height, width);
  };

  it('reads its direction once it is attached and laid out, and scrolls that way', () => {
    host.setAttribute('dir', 'rtl');
    const { harness, element } = built();

    host.append(element);
    laidOutAt(harness.scroller, VIEWPORT_HEIGHT, VIEWPORT_WIDTH);
    expect(harness.g.direction()).toBe('rtl');

    userScroll(harness.scroller, 'rtl', { left: 500 });
    expect(harness.container.style.transform).toBe('translate(-300px, 0px)');
    standOn(harness, 0, 9);
    expect(harness.scroller.scrollLeft).toBe(physical('rtl', 700));
    expect(document.activeElement).toBe(cellAt(0, 9));
  });

  it('asks for no style while it is out of the document, and once when it is laid out', () => {
    const styles = vi.spyOn(document.defaultView!, 'getComputedStyle');
    restores.push(() => styles.mockRestore());
    host.setAttribute('dir', 'rtl');
    const { harness, element } = built();
    const reads = (): number => styles.mock.calls.filter(([el]) => el === harness.root).length;
    expect(reads()).toBe(0);

    host.append(element);
    laidOutAt(harness.scroller, VIEWPORT_HEIGHT, VIEWPORT_WIDTH);
    expect(reads()).toBe(1);
    // Laid out again at another size, it does not ask again.
    laidOutAt(harness.scroller, VIEWPORT_HEIGHT * 2, VIEWPORT_WIDTH * 2);
    expect(reads()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// What does not change
// ---------------------------------------------------------------------------

describe('a keyboard that types a right-to-left script', () => {
  /**
   * Ctrl and the key a Latin layout calls A, as a Hebrew or an Arabic layout
   * reports it: the letter it types, on the physical key `code` names.
   */
  it.each([
    ['Hebrew', 'ש'],
    ['Arabic', 'ش'],
  ])('selects every row with Ctrl and the key marked A, on a layout that types %s', (_, letter) => {
    gridOptions = { ...gridOptions, rowSelection: 'multiple' };
    const harness = setup({ dir: 'rtl' });
    standOn(harness, 0, 0);
    const event = new KeyboardEvent('keydown', {
      key: letter,
      code: 'KeyA',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.activeElement!.dispatchEvent(event);
    flushSync();
    expect(harness.g.selectedRows().size).toBe(ROW_COUNT);
    // Spent, or the browser selects the page's text under the rows as well.
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets a Latin letter decide for itself, wherever its layout puts it', () => {
    gridOptions = { ...gridOptions, rowSelection: 'multiple' };
    const harness = setup({ dir: 'rtl' });
    standOn(harness, 0, 0);
    // AZERTY types Q on the key QWERTY calls A, and A on the one it calls Q.
    press(document.activeElement!, 'q', { ctrlKey: true, code: 'KeyA' });
    expect(harness.g.selectedRows().size).toBe(0);
    press(document.activeElement!, 'a', { ctrlKey: true, code: 'KeyQ' });
    expect(harness.g.selectedRows().size).toBe(ROW_COUNT);
  });

  it('takes no key that types no letter for it', () => {
    gridOptions = { ...gridOptions, rowSelection: 'multiple' };
    const harness = setup({ dir: 'rtl' });
    standOn(harness, 0, 0);
    press(document.activeElement!, '1', { ctrlKey: true, code: 'KeyA' });
    expect(harness.g.selectedRows().size).toBe(0);
  });
});

describe('the data keeps its own order', () => {
  it('copies a range in the order of its columns, whichever way it was drawn', async () => {
    gridOptions = { ...gridOptions, cellSelection: 'range' };
    const harness = setup({ dir: 'rtl' });
    const view = window as unknown as { ClipboardItem: unknown };
    const original = view.ClipboardItem;
    const clipboardWas = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    view.ClipboardItem = class {
      constructor(readonly data: Record<string, Blob>) {}
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: async () => {} },
      configurable: true,
    });
    restores.push(() => {
      view.ClipboardItem = original;
      if (clipboardWas) Object.defineProperty(navigator, 'clipboard', clipboardWas);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    });
    const clipboard = createGridClipboard<Person>({
      grid: () => harness.g,
      columns: () => columns.get(),
      getRowKey: (row) => row.id,
      onPaste: () => {},
    });

    standOn(harness, 0, 0);
    // ArrowLeft is toward the inline end right to left: column 0, then 1.
    press(document.activeElement!, 'ArrowLeft', { shiftKey: true });
    const copied = await clipboard.copy();

    expect(copied).toMatchObject({ status: 'copied', text: 'r0c0\tr0c1' });
  });

  it('exports its columns in the order of the data', async () => {
    people.set([makeRow(0)]);
    const harness = setup({ dir: 'rtl' });
    const exporter = createExport<Person>({ grid: () => harness.g, columns: () => columns.get() });
    const text = await (await exporter.csv()).blob.text();
    const [header, row] = text.split(/\r?\n/);
    expect(header!.split(',').slice(0, 3)).toEqual(['Column 0', 'Column 1', 'Column 2']);
    expect(row!.split(',').slice(0, 3)).toEqual(['r0c0', 'r0c1', 'r0c2']);
  });
});

/** The same grid with an editor in the cell being edited. */
const EDITABLE = `
  <div class="grid" :ref="grid" :spread="g.gridProps()"
       :keydown="onKey($event)" :focusin="g.onFocusIn($event)">
    <div class="header" :spread="g.headerProps()">
      <div class="header-row" :spread="g.headerRowProps()">
        <div class="th" :for="col in g.columns()" :key="col.key"
             :spread="g.headerCellProps(col)">{ col.column.header }</div>
      </div>
    </div>
    <div class="body" :ref="scroller" :spread="g.bodyProps()">
      <div class="sizer" :spread="g.sizerProps()">
        <div class="container" :ref="container" :spread="g.containerProps()">
          <div class="row" :for="row in g.rows()" :key="row.key" :spread="g.rowProps(row)">
            <div class="cell" :for="col in g.columns()" :key="col.key" :spread="cellProps(row, col)">
              <input :if="editing.isEditing(row, col)" class="editor"
                     :spread="editing.editorProps()" :value="editing.text()"
                     :input="editing.onInput($event)">
              <span :else>{ g.cellValue(row, col) }</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

describe.each(['ltr', 'rtl'] as const)('editing, %s', (dir) => {
  const editable = (): { g: Grid<Person>; editing: GridCellEditing<Person> } => {
    host.setAttribute('dir', dir);

    @Component({ selector: `v-rtl-editable-${++selectors}`, render: compileTemplate(EDITABLE) })
    class Editable {
      grid = new Signal.State<Element | null>(null);
      scroller = new Signal.State<Element | null>(null);
      container = new Signal.State<Element | null>(null);
      g: Grid<Person> = createGrid<Person>({
        ...gridOptions,
        grid: () => this.grid.get(),
        scroller: () => this.scroller.get(),
        container: () => this.container.get(),
        rows: () => people.get(),
        columns: () => columns.get(),
      });
      editing = createCellEditing<Person>({
        grid: () => this.g,
        // c5 has no editor, so a Tab steps over it.
        editors: () =>
          Object.fromEntries(columns.get().flatMap((column) => (column.id === 'c5' ? [] : [[column.id, {}]]))),
        columns: () => columns.get(),
        onCommit: () => {},
      });

      cellProps(row: GridRow<Person>, col: never): Record<string, unknown> {
        return { ...this.g.cellProps(row, col), ...this.editing.cellProps(row, col) };
      }

      onKey(event: KeyboardEvent): void {
        if (!this.editing.onKeyDown(event)) this.g.onKeyDown(event);
      }
    }

    const handle = mount(Editable, host);
    mounted.push(handle);
    const scroller = host.querySelector<HTMLElement>('.body')!;
    Object.defineProperty(scroller, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: VIEWPORT_WIDTH, configurable: true });
    FakeResizeObserver.deliver(scroller, VIEWPORT_HEIGHT, VIEWPORT_WIDTH);
    const instance = handle.instance as unknown as Editable;
    return { g: instance.g, editing: instance.editing };
  };

  const editor = (): HTMLElement => host.querySelector<HTMLElement>('.editor')!;

  it('moves Tab to the next column of the data, toward the inline end, whichever way the row runs', () => {
    const { g, editing } = editable();
    g.focusCell({ row: 0, column: 3 });
    flushSync();
    press(document.activeElement!, 'Enter');
    expect(editing.session()).toMatchObject({ row: 0, column: 3 });

    // Tab follows the reading order, as it does through a page that runs
    // either way: right to left, the next column is the one on the left.
    press(editor(), 'Tab');
    expect(editing.session()).toMatchObject({ row: 0, column: 4 });
    press(editor(), 'Tab');
    expect(editing.session()).toMatchObject({ row: 0, column: 6 });
    press(editor(), 'Tab', { shiftKey: true });
    expect(editing.session()).toMatchObject({ row: 0, column: 4 });
    expect(g.activeCell()).toEqual({ row: 0, column: 4 });
  });
});

describe('right to left, set beside left to right', () => {
  /**
   * Every prop the grid hands out for what its window holds, and the markup
   * they render, after the same scroll and the same walk of the cursor.
   */
  const everything = (dir: Dir) => {
    const harness = setup({ dir });
    userScroll(harness.scroller, dir, { top: 500, left: 500 });
    standOn(harness, 26, 6);
    const { g } = harness;
    const cols = g.columns();
    const rows = [...g.pinnedTopRows(), ...g.rows()];
    const seen = {
      columns: cols.map((col) => ({ ...col, column: col.column.id })),
      rows: rows.map((row) => ({ ...row, item: row.item.id })),
      gridProps: g.gridProps(),
      headerProps: g.headerProps(),
      headerRowProps: g.headerRowProps(),
      headerCells: cols.map((col) => g.headerCellProps(col)),
      resizers: cols.map((col) => g.resizerProps(col)),
      bodyProps: g.bodyProps(),
      sizerProps: g.sizerProps(),
      containerProps: g.containerProps(),
      rowProps: rows.map((row) => g.rowProps(row)),
      cells: rows.map((row) => cols.map((col) => g.cellProps(row, col))),
      html: harness.root.outerHTML,
    };
    mounted.pop()!.unmount();
    host.innerHTML = '';
    return seen;
  };

  /** A horizontal translate, written the other way: what right to left asks of one. */
  const turned = (css: string): string =>
    css.replace(/(translateX?\()(-?[\d.]+)px/g, (_, head: string, x: string) => `${head}${-Number(x) || 0}px`);

  /** `seen` with every horizontal translate in it turned the other way. */
  const mirrored = (seen: unknown): unknown => {
    if (typeof seen === 'string') return turned(seen);
    if (Array.isArray(seen)) return seen.map(mirrored);
    if (seen === null || typeof seen !== 'object') return seen;
    return Object.fromEntries(Object.entries(seen).map(([key, value]) => [key, mirrored(value)]));
  };

  it('hands out what left to right does, each horizontal translate turned the other way', () => {
    top.set([makeRow(9000)]);
    const ltr = everything('ltr');
    const rtl = everything('rtl');
    // The comparison is of translates that move something, and not of zeros.
    expect(ltr.containerProps.style).toStrictEqual({ transform: 'translate(300px, 460px)' });
    expect(rtl.containerProps.style).toStrictEqual({ transform: 'translate(-300px, 460px)' });
    // The pinned row: its height as every row of one height states it, and
    // its translate turned.
    expect(rtl.rowProps[0]!.style).toStrictEqual({ height: '20px', transform: 'translateX(200px)' });
    expect(rtl).toStrictEqual(mirrored(ltr));
  });

  it('hands out what left to right does, and nothing turned, where a column is pinned', () => {
    columns.set(makeColumns({ c0: 'start', c11: 'end' }));
    top.set([makeRow(9000)]);
    const ltr = everything('ltr');
    const rtl = everything('rtl');
    expect(rtl.containerProps.style).toStrictEqual({
      transform: 'translate(0px, 460px)',
      'padding-inline-start': '200px',
    });
    expect(rtl).toStrictEqual(ltr);
  });

  it('hands out what left to right does for every row of a header of groups, each translate turned', () => {
    const name: GridColumnGroup = { id: 'name', header: 'Name' };
    const work: GridColumnGroup = { id: 'work', header: 'Work' };
    const other: GridColumnGroup = { id: 'other', header: 'Other' };
    const header = (dir: Dir) => {
      columns.set(
        makeColumns().map((column, i) => ({ ...column, group: i < 2 ? name : i < 5 ? work : other })),
      );
      const harness = setup({ dir, template: GROUP_HEADER });
      userScroll(harness.scroller, dir, { top: 500, left: 500 });
      // On the row of groups, so a group's cell holds the tab stop.
      standOn(harness, HEADER_ROW - 1, 5);
      const { g } = harness;
      const rows = g.headerRows();
      const seen = {
        rows: rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            column: cell.column?.key ?? null,
            group: cell.group?.id ?? null,
          })),
        })),
        rowProps: rows.map((row) => g.headerRowProps(row)),
        cells: rows.map((row) => row.cells.map((cell) => g.headerCellProps(cell))),
        resizers: rows.map((row) => row.cells.map((cell) => g.resizerProps(cell))),
        gridProps: g.gridProps(),
        html: harness.root.outerHTML,
      };
      mounted.pop()!.unmount();
      host.innerHTML = '';
      return seen;
    };

    const ltr = header('ltr');
    const rtl = header('rtl');
    expect(ltr.rowProps.map((props) => props.style)).toStrictEqual([
      { transform: 'translateX(-200px)' },
      { transform: 'translateX(-200px)' },
    ]);
    // Work cut at the window's inline start, Other from its first column.
    expect(rtl.rows[0]!.cells.map((cell) => [cell.group, cell.start, cell.width])).toEqual([
      ['work', 300, 200],
      ['other', 500, 500],
    ]);
    expect(rtl).toStrictEqual(mirrored(ltr));
  });
});

describe('what it costs', () => {
  /** How many cells read their value at each step of the same walk. */
  const walk = (dir: Dir): number[] => {
    const counts: number[] = [];
    const harness = setup({ dir });
    counts.push(reads.length);
    reads = [];
    userScroll(harness.scroller, dir, { left: 500 });
    counts.push(reads.length);
    reads = [];
    standOn(harness, 0, 5);
    press(document.activeElement!, dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
    press(document.activeElement!, 'End');
    counts.push(reads.length);
    reads = [];
    userScroll(harness.scroller, dir, { top: 200, left: 500 });
    counts.push(reads.length);
    mounted.pop()!.unmount();
    host.innerHTML = '';
    reads = [];
    return counts;
  };

  it('reads no cell more right to left than left to right', () => {
    const ltr = walk('ltr');
    const rtl = walk('rtl');
    // Mounting reads the window once: seven rows of five columns.
    expect(ltr[0]).toBe(35);
    expect(rtl).toEqual(ltr);
  });

  it('reads no cell when the direction changes', async () => {
    const harness = setup();
    userScroll(harness.scroller, 'ltr', { left: 500 });
    reads = [];
    harness.root.setAttribute('dir', 'rtl');
    await vi.waitFor(() => expect(harness.g.direction()).toBe('rtl'));
    flushSync();
    expect(harness.container.style.transform).toBe('translate(-300px, 0px)');
    expect(reads).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Left to right, as it was
// ---------------------------------------------------------------------------

describe('a grid laid out left to right is what it was', () => {
  it('hands out the same props, byte for byte', () => {
    const harness = setup({ dir: 'ltr' });
    const row = harness.g.rows()[0]!;
    const col = harness.g.columns()[0]!;

    expect(Object.keys(col)).toEqual(['index', 'key', 'column', 'start', 'width']);
    expect(Object.keys(row)).toEqual(['index', 'key', 'item', 'start', 'size']);
    expect(harness.g.headerRowProps()).toStrictEqual({
      role: 'row',
      'aria-rowindex': '1',
      style: { transform: 'translateX(0px)' },
    });
    expect(harness.g.containerProps()).toStrictEqual({
      role: 'none',
      style: { transform: 'translate(0px, 0px)' },
    });
    expect(harness.g.resizerProps(col)).toStrictEqual({
      [GRID_RESIZER_ATTRIBUTE]: 'c0',
      'aria-hidden': 'true',
      'data-resizing': undefined,
      'data-disabled': undefined,
      style: { 'touch-action': 'none' },
    });
    expect(harness.g.headerCellProps(col)).toStrictEqual({
      [GRID_CELL_ATTRIBUTE]: '-1,0',
      role: 'columnheader',
      'aria-colindex': '1',
      tabindex: '-1',
      'aria-sort': 'none',
      'data-active': undefined,
      'data-sort': undefined,
      'data-sort-index': undefined,
      'data-filtered': undefined,
      'data-column': 'c0',
      style: { width: '100px' },
    });
    expect(harness.g.cellProps(row, col)).toStrictEqual({
      [GRID_CELL_ATTRIBUTE]: '0,0',
      role: 'gridcell',
      'aria-colindex': '1',
      tabindex: '0',
      'aria-selected': undefined,
      'data-active': '',
      'data-selected': undefined,
      'data-column': 'c0',
      style: { width: '100px' },
    });
    expect(harness.g.gridProps()).toStrictEqual({
      'aria-rowcount': String(ROW_COUNT + 1),
      'aria-colcount': String(COLUMN_COUNT),
      role: 'grid',
      'aria-label': 'People',
      'aria-multiselectable': undefined,
      tabindex: undefined,
    });

    userScroll(harness.scroller, 'ltr', { top: 500, left: 500 });
    expect(harness.g.containerProps()).toStrictEqual({
      role: 'none',
      style: { transform: 'translate(300px, 460px)' },
    });
    expect(harness.g.headerRowProps()).toStrictEqual({
      role: 'row',
      'aria-rowindex': '1',
      style: { transform: 'translateX(-200px)' },
    });
  });

  it('is what it was with no dir anywhere, as a page that never says is', () => {
    const harness = setup();
    expect(harness.g.direction()).toBe('ltr');
    userScroll(harness.scroller, 'ltr', { top: 500, left: 500 });
    expect(harness.container.style.transform).toBe('translate(300px, 460px)');
    standOn(harness, 0, 5);
    press(document.activeElement!, 'ArrowRight');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 6 });
  });
});

// ---------------------------------------------------------------------------
// A grouped grid
// ---------------------------------------------------------------------------

const GROUPED = `
  <div class="grid" :ref="grid" :spread="g.gridProps()"
       :keydown="onKey($event)" :focusin="g.onFocusIn($event)">
    <div class="header" :spread="g.headerProps()">
      <div class="header-row" :spread="g.headerRowProps()">
        <div class="th" :for="col in g.columns()" :key="col.key"
             :spread="g.headerCellProps(col)">{ col.column.header }</div>
      </div>
    </div>
    <div class="body" :ref="scroller" :spread="g.bodyProps()">
      <div class="sizer" :spread="g.sizerProps()">
        <div class="container" :ref="container" :spread="g.containerProps()">
          <div class="row" :for="row in g.rows()" :key="row.key" :spread="rowProps(row)">
            <div class="cell" :for="col in g.columns()" :key="col.key"
                 :spread="g.cellProps(row, col)">{ text(row, col) }</div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

describe.each(['ltr', 'rtl'] as const)('a group header, %s', (dir) => {
  /** The arrow pointing toward the inline end, where a group's rows are indented. */
  const inward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const outward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';

  const grouped = (): { g: Grid<GridGroupedRow<Person>>; grouping: GridGrouping<Person> } => {
    host.setAttribute('dir', dir);
    const groupColumns = makeColumns().slice(0, 3);
    const rows = [makeRow(0), makeRow(1), makeRow(2)];
    rows[1]!.cells[0]!.set('r0c0');

    @Component({ selector: `v-rtl-grouped-${++selectors}`, render: compileTemplate(GROUPED) })
    class Grouped {
      grid = new Signal.State<Element | null>(null);
      scroller = new Signal.State<Element | null>(null);
      container = new Signal.State<Element | null>(null);
      sort = new Signal.State<readonly GridSort[]>([]);
      grouping = createGrouping<Person>({
        rows: () => rows,
        columns: () => groupColumns,
        groupBy: () => ['c0'],
        getRowKey: (row) => row.id,
        sort: this.sort,
      });
      g = createGrid<GridGroupedRow<Person>>({
        grid: () => this.grid.get(),
        scroller: () => this.scroller.get(),
        container: () => this.container.get(),
        rows: () => this.grouping.rows(),
        columns: () => this.grouping.columns(),
        getRowKey: this.grouping.rowKey,
        sort: this.sort,
        rowHeight: ROW_HEIGHT,
      });

      rowProps(row: GridRow<GridGroupedRow<Person>>): Record<string, unknown> {
        return { ...this.g.rowProps(row), ...this.grouping.rowProps(row.item) };
      }

      text(row: GridRow<GridGroupedRow<Person>>, col: { index: number }): string {
        if (row.item.kind === 'group') return col.index === 0 ? this.grouping.label(row.item) : '';
        return String(this.g.cellValue(row, col as never));
      }

      onKey(event: KeyboardEvent): void {
        if (!this.grouping.onKeyDown(event)) this.g.onKeyDown(event);
      }
    }

    const handle = mount(Grouped, host);
    mounted.push(handle);
    const scroller = host.querySelector<HTMLElement>('.body')!;
    Object.defineProperty(scroller, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: VIEWPORT_WIDTH, configurable: true });
    FakeResizeObserver.deliver(scroller, VIEWPORT_HEIGHT, VIEWPORT_WIDTH);
    const instance = handle.instance as unknown as Grouped;
    return { g: instance.g, grouping: instance.grouping };
  };

  it('shuts with the arrow pointing out of the row, and opens with the one pointing in', () => {
    const { g, grouping } = grouped();
    const path = host.querySelector(`[${GRID_GROUP_ATTRIBUTE}]`)!.getAttribute(GRID_GROUP_ATTRIBUTE)!;
    g.focusCell({ row: 0, column: 0 });
    flushSync();
    expect(grouping.isExpanded(path)).toBe(true);

    press(document.activeElement!, outward);
    expect(grouping.isExpanded(path)).toBe(false);
    expect(g.activeCell()).toEqual({ row: 0, column: 0 });

    press(document.activeElement!, inward);
    expect(grouping.isExpanded(path)).toBe(true);
    expect(g.activeCell()).toEqual({ row: 0, column: 0 });

    // Open, the arrow pointing in walks to the next column, as on any row.
    press(document.activeElement!, inward);
    expect(g.activeCell()).toEqual({ row: 0, column: 1 });
  });

  it("takes its arrows from the grid's direction, whatever a cell inside it says", () => {
    const { g, grouping } = grouped();
    const path = host.querySelector(`[${GRID_GROUP_ATTRIBUTE}]`)!.getAttribute(GRID_GROUP_ATTRIBUTE)!;
    g.focusCell({ row: 0, column: 0 });
    flushSync();
    // A label of the page's own, marked to run its own way inside the row.
    cellAt(0, 0)!.setAttribute('dir', dir === 'rtl' ? 'ltr' : 'rtl');

    press(document.activeElement!, outward);
    expect(grouping.isExpanded(path)).toBe(false);
    press(document.activeElement!, inward);
    expect(grouping.isExpanded(path)).toBe(true);
    expect(g.activeCell()).toEqual({ row: 0, column: 0 });
  });

  it('reads no style for a key that opens or shuts a group', () => {
    const { g, grouping } = grouped();
    const path = host.querySelector(`[${GRID_GROUP_ATTRIBUTE}]`)!.getAttribute(GRID_GROUP_ATTRIBUTE)!;
    g.focusCell({ row: 0, column: 0 });
    flushSync();
    const styles = vi.spyOn(document.defaultView!, 'getComputedStyle');
    restores.push(() => styles.mockRestore());

    press(document.activeElement!, outward);
    press(document.activeElement!, inward);
    expect(grouping.isExpanded(path)).toBe(true);
    expect(styles).not.toHaveBeenCalled();
  });
});
