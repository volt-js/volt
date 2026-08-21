/**
 * Grid, driven through a real mounted component.
 *
 * Everything worth testing about a data grid is what happens when the DOM
 * holds a window rather than the collection: the numbers a screen reader is
 * told, where the single tab stop goes when the cursor scrolls off screen,
 * where a key lands when the cell it names has never been rendered, and
 * whether changing one value costs one text node or a re-render. Those are
 * what this covers. That a few rows appear is the easy part.
 *
 * happy-dom lays nothing out, so every size here is stated rather than
 * measured: the scroller's client box is stubbed, and the measurement arrives
 * the way it does in a browser — through a `ResizeObserver` that reports
 * exactly what a test hands it, after mount.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import {
  GRID_CELL_ATTRIBUTE,
  GRID_RESIZER_ATTRIBUTE,
  HEADER_ROW,
  createGrid,
  type Grid,
  type GridColumn,
  type GridOptions,
} from '../src/index.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * A row whose every cell is a signal.
 *
 * That is the shape the whole design rests on: a column's accessor reads one
 * signal, so the cell that renders it subscribes to that signal and to nothing
 * else. Plain fields would make the fine-grained tests untestable — there
 * would be no way to change a value at all.
 */
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

/** Every accessor call, as `row:column`. The evidence for what re-ran. */
let reads: string[] = [];

function makePeople(count: number): Person[] {
  return Array.from({ length: count }, (_, row) => ({
    id: row,
    cells: Array.from({ length: COLUMN_COUNT }, (_, col) => new Signal.State(`r${row}c${col}`)),
  }));
}

function makeColumns(count = COLUMN_COUNT): GridColumn<Person>[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    header: `Column ${index}`,
    width: COLUMN_WIDTH,
    value: (row: Person) => {
      reads.push(`${row.id}:${index}`);
      return row.cells[index]!.get();
    },
  }));
}

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;

let people: Signal.State<readonly Person[]>;
let columns: Signal.State<readonly GridColumn<Person>[]>;
let gridOptions: Omit<GridOptions<Person>, 'grid' | 'scroller' | 'container' | 'rows' | 'columns'>;

interface Measurement {
  target: Element;
  /** Height, in a horizontal writing mode. */
  block: number;
  /** Width. */
  inline: number;
}

/**
 * A ResizeObserver that reports only what a test hands it.
 *
 * A grid runs two virtualizers over one scroller, so two of these exist per
 * grid and both watch it. A viewport measurement has to reach both, or one
 * axis never learns how much of it is on screen.
 */
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
  gridOptions = { rowHeight: ROW_HEIGHT, label: 'People' };

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
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
});

const TEMPLATE = `
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
  /** What `onKeyDown` returned for the last key the grid saw. */
  handled: boolean;
  onKey(event: KeyboardEvent): void;
}

interface Harness {
  g: Grid<Person>;
  instance: GridInstance;
  root: HTMLElement;
  scroller: HTMLElement;
  sizer: HTMLElement;
  container: HTMLElement;
  headerRow: HTMLElement;
}

function setup({ height = VIEWPORT_HEIGHT, width = VIEWPORT_WIDTH } = {}): Harness {
  @Component({ selector: `v-grid-${++selectors}`, render: compileTemplate(TEMPLATE) })
  class GridComponent {
    grid = new Signal.State<Element | null>(null);
    scroller = new Signal.State<Element | null>(null);
    container = new Signal.State<Element | null>(null);
    handled = false;
    g = createGrid<Person>({
      ...gridOptions,
      grid: () => this.grid.get(),
      scroller: () => this.scroller.get(),
      container: () => this.container.get(),
      rows: () => people.get(),
      columns: () => columns.get(),
    });

    onKey(event: KeyboardEvent): void {
      this.handled = this.g.onKeyDown(event);
    }
  }

  const handle = mount(GridComponent, host);
  mounted.push(handle);

  const scroller = host.querySelector<HTMLElement>('.body')!;
  stubBox(scroller, height, width);
  // The size then arrives the way it does in a browser: through the observer,
  // after layout. Mounting already flushed, so this is the only way in.
  FakeResizeObserver.deliver([{ target: scroller, block: height, inline: width }]);

  const instance = handle.instance as GridInstance;
  return {
    g: instance.g,
    instance,
    root: host.querySelector<HTMLElement>('.grid')!,
    scroller,
    sizer: host.querySelector<HTMLElement>('.sizer')!,
    container: host.querySelector<HTMLElement>('.container')!,
    headerRow: host.querySelector<HTMLElement>('.header-row')!,
  };
}

function stubBox(el: Element, height: number, width: number): void {
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
}

/** A scroll the reader performed. happy-dom fires no event of its own. */
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

function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.row')];
}

function cells(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.cell')];
}

function headerCells(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.th')];
}

/** A column's resize handle, found the way a consumer's stylesheet would. */
function resizerFor(id: string): HTMLElement {
  return host.querySelector<HTMLElement>(`[${GRID_RESIZER_ATTRIBUTE}="${id}"]`)!;
}

function attrs(selector: string, name: string): (string | null)[] {
  return [...host.querySelectorAll<HTMLElement>(selector)].map((el) => el.getAttribute(name));
}

/** Every cell holding the grid's tab stop. There must never be more than one. */
function tabStops(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(`[${GRID_CELL_ATTRIBUTE}]`)].filter(
    (el) => el.getAttribute('tabindex') === '0',
  );
}

// ---------------------------------------------------------------------------

describe('the shape it renders', () => {
  it('marks up a grid, its rowgroups, its rows and its two kinds of cell', () => {
    const harness = setup();

    expect(harness.root.getAttribute('role')).toBe('grid');
    expect(harness.root.getAttribute('aria-label')).toBe('People');
    expect(attrs('.header, .body', 'role')).toEqual(['rowgroup', 'rowgroup']);
    expect(harness.headerRow.getAttribute('role')).toBe('row');
    expect(headerCells()[0]!.getAttribute('role')).toBe('columnheader');
    expect(rows()[0]!.getAttribute('role')).toBe('row');
    expect(cells()[0]!.getAttribute('role')).toBe('gridcell');
  });

  it('keeps the geometry wrappers out of the accessibility tree', () => {
    const harness = setup();
    // A `grid` owns `row` children, and a plain div between the two breaks
    // that relationship wherever the tree is built from the DOM.
    expect(harness.sizer.getAttribute('role')).toBe('none');
    expect(harness.container.getAttribute('role')).toBe('none');
  });

  it('renders a window of both axes rather than twelve thousand cells', () => {
    const harness = setup();

    // Five rows fill a hundred pixels, three columns fill three hundred, and
    // two more of each are the overscan.
    expect(harness.g.rows().map((row) => row.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(harness.g.columns().map((col) => col.index)).toEqual([0, 1, 2, 3, 4]);
    expect(rows()).toHaveLength(7);
    expect(cells()).toHaveLength(35);
    expect(harness.g.rowCount()).toBe(ROW_COUNT);
    expect(harness.g.columnCount()).toBe(COLUMN_COUNT);
  });

  it('renders each cell through its own column accessor', () => {
    setup();
    expect(cellAt(0, 0)!.textContent).toBe('r0c0');
    expect(cellAt(6, 4)!.textContent).toBe('r6c4');
  });

  it('renders a header and a tab stop for a grid with no rows at all', () => {
    people.set([]);
    const harness = setup();

    expect(rows()).toEqual([]);
    expect(headerCells()).toHaveLength(5);
    // The cursor has nowhere else to be, and Tab still has to find a way in.
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 0 });
    expect(tabStops()).toHaveLength(1);
    expect(harness.root.getAttribute('aria-rowcount')).toBe('1');
  });

  it('falls back to a tab stop on the grid when there is not a cell to hold one', () => {
    columns.set([]);
    const harness = setup();

    expect(cells()).toEqual([]);
    // Without this the grid drops out of the tab order altogether.
    expect(harness.root.getAttribute('tabindex')).toBe('0');
  });
});

describe('what a screen reader is told', () => {
  it('counts the whole collection, header row included', () => {
    const harness = setup();
    // Not 7 and 5, which is all the DOM holds.
    expect(harness.root.getAttribute('aria-rowcount')).toBe(String(ROW_COUNT + 1));
    expect(harness.root.getAttribute('aria-colcount')).toBe(String(COLUMN_COUNT));
  });

  it('numbers the header row one, and the first data row two', () => {
    const harness = setup();
    expect(harness.headerRow.getAttribute('aria-rowindex')).toBe('1');
    expect(rows()[0]!.getAttribute('aria-rowindex')).toBe('2');
  });

  it('numbers rendered rows by their place in the collection, not in the window', () => {
    const harness = setup();
    userScroll(harness.scroller, { top: 10_000 });

    // Row 500 is the five hundred and second row of the grid, and the first
    // one in the DOM. Counting the elements would call it row one.
    expect(harness.g.rows()[0]!.index).toBe(498);
    expect(rows()[0]!.getAttribute('aria-rowindex')).toBe('500');
    expect(attrs('.row', 'aria-rowindex')).toEqual([
      '500', '501', '502', '503', '504', '505', '506', '507', '508',
    ]);
  });

  it('numbers cells by their place in the column list after a horizontal scroll', () => {
    const harness = setup();
    userScroll(harness.scroller, { left: 500 });

    expect(harness.g.columns().map((col) => col.index)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(attrs('.th', 'aria-colindex')).toEqual(['4', '5', '6', '7', '8', '9', '10']);
    expect(
      [...rows()[0]!.querySelectorAll('.cell')].map((el) => el.getAttribute('aria-colindex')),
    ).toEqual(['4', '5', '6', '7', '8', '9', '10']);
  });
});

describe('geometry', () => {
  it('sizes the sizer to the whole collection on both axes', () => {
    const harness = setup();
    expect(harness.sizer.style.height).toBe(`${ROW_COUNT * ROW_HEIGHT}px`);
    expect(harness.sizer.style.width).toBe(`${COLUMN_COUNT * COLUMN_WIDTH}px`);
  });

  it('moves the window with one transform rather than positioning each row', () => {
    const harness = setup();
    expect(harness.container.style.transform).toBe('translate(0px, 0px)');
    expect(rows().every((row) => row.style.top === '')).toBe(true);

    userScroll(harness.scroller, { top: 500, left: 500 });
    // Two rows and two columns of overscan sit before the first visible one.
    expect(harness.container.style.transform).toBe('translate(300px, 460px)');
  });

  it('keeps the header in step with a horizontal scroll and still of the vertical', () => {
    const harness = setup();
    expect(harness.headerRow.style.transform).toBe('translateX(0px)');

    userScroll(harness.scroller, { top: 500, left: 500 });
    // The header is outside the scroller, so it has to be moved by both the
    // window's offset and the scroll the browser already applied to the body.
    expect(harness.headerRow.style.transform).toBe('translateX(-200px)');
  });

  it('gives every row its height and every cell its column width', () => {
    const harness = setup();
    expect(rows()[0]!.style.height).toBe(`${ROW_HEIGHT}px`);
    expect(cells()[0]!.style.width).toBe(`${COLUMN_WIDTH}px`);
    // The header is laid out by the same numbers, or the two fall out of step.
    expect(headerCells()[0]!.style.width).toBe(`${COLUMN_WIDTH}px`);
    expect(cells()[0]!.getAttribute('data-column')).toBe('c0');
    expect(headerCells()[0]!.getAttribute('data-column')).toBe('c0');
    expect(harness.g.columns().map((col) => col.start)).toEqual([0, 100, 200, 300, 400]);
  });

  it('renders the first row and column before the scroller has been measured', () => {
    // A zero-size scroller is what a grid in a hidden tab looks like. It has
    // to render something, or there is nothing to measure and it stays empty.
    const harness = setup({ height: 0, width: 0 });
    expect(harness.g.rows().map((row) => row.index)).toEqual([0, 1, 2]);
    expect(harness.g.columns().map((col) => col.index)).toEqual([0, 1, 2]);
  });
});

describe('columns', () => {
  it('resizes a column and moves the ones after it', () => {
    const harness = setup();
    harness.g.resizeColumn('c0', 200);
    flushSync();

    expect(harness.g.columns()[0]!.width).toBe(200);
    // Column zero now fills two thirds of the viewport, so one column fewer
    // is on screen and the overscan reaches one column less far.
    expect(harness.g.columns().map((col) => col.start)).toEqual([0, 200, 300, 400]);
    expect(cellAt(0, 0)!.style.width).toBe('200px');
    expect(cellAt(0, 1)!.style.width).toBe('100px');
    // The collection is a hundred pixels wider than it was, and the scrollbar
    // has to say so.
    expect(harness.sizer.style.width).toBe('1300px');
  });

  it('clamps a resize to the column and reports what it settled on', () => {
    const resized: [string, number][] = [];
    gridOptions = {
      ...gridOptions,
      onColumnResize: (id, width) => resized.push([id, width]),
    };
    const list = makeColumns();
    list[0] = { ...list[0]!, minWidth: 60, maxWidth: 180 };
    columns.set(list);

    const harness = setup();
    harness.g.resizeColumn('c0', 10_000);
    flushSync();
    expect(harness.g.columns()[0]!.width).toBe(180);

    harness.g.resizeColumn('c0', 0);
    flushSync();
    expect(harness.g.columns()[0]!.width).toBe(60);
    expect(resized).toEqual([
      ['c0', 180],
      ['c0', 60],
    ]);
  });

  it('refuses to resize a column that says it cannot be', () => {
    const list = makeColumns();
    list[1] = { ...list[1]!, resizable: false };
    columns.set(list);

    const harness = setup();
    harness.g.resizeColumn('c1', 300);
    flushSync();

    expect(harness.g.columns()[1]!.width).toBe(COLUMN_WIDTH);
    expect(resizerFor('c1').getAttribute('data-disabled')).toBe('');
  });

  it('resizes by dragging the handle, and marks the handle while it is held', () => {
    const harness = setup();
    const handle = resizerFor('c0');

    handle.dispatchEvent(pointer('pointerdown', { clientX: 0 }));
    flushSync();
    expect(handle.getAttribute('data-resizing')).toBe('');

    handle.dispatchEvent(pointer('pointermove', { clientX: 40 }));
    flushSync();
    expect(harness.g.columns()[0]!.width).toBe(140);

    handle.dispatchEvent(pointer('pointerup', { clientX: 40 }));
    flushSync();
    expect(handle.getAttribute('data-resizing')).toBe(null);

    // The drag is over, so the pointer moving on is not a resize.
    handle.dispatchEvent(pointer('pointermove', { clientX: 200 }));
    flushSync();
    expect(harness.g.columns()[0]!.width).toBe(140);
  });

  it('puts the width back where the drag started when Escape cancels it', () => {
    const harness = setup();
    const handle = resizerFor('c0');

    handle.dispatchEvent(pointer('pointerdown', { clientX: 0 }));
    handle.dispatchEvent(pointer('pointermove', { clientX: 40 }));
    flushSync();
    expect(harness.g.columns()[0]!.width).toBe(140);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    // The whole gesture, not the last increment.
    expect(harness.g.columns()[0]!.width).toBe(COLUMN_WIDTH);
    expect(handle.getAttribute('data-resizing')).toBe(null);
  });

  it('ignores a press that is not the primary button', () => {
    const harness = setup();
    const handle = resizerFor('c0');

    handle.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 2 }));
    handle.dispatchEvent(pointer('pointermove', { clientX: 40 }));
    flushSync();
    expect(harness.g.columns()[0]!.width).toBe(COLUMN_WIDTH);
  });

  it('rebuilds the geometry when the column definitions are replaced', () => {
    const harness = setup();
    const wider = makeColumns();
    wider[0] = { ...wider[0]!, width: 250 };
    // The same number of columns, so nothing the virtualizer watches changed.
    columns.set(wider);
    flushSync();

    expect(harness.g.columns()[0]!.width).toBe(250);
    expect(harness.g.columns()[1]!.start).toBe(250);
    expect(harness.sizer.style.width).toBe('1350px');
  });
});

describe('the keyboard', () => {
  it('moves the cursor one cell at a time with the arrows', () => {
    const harness = setup();
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });

    press(harness.root, 'ArrowRight');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 1 });

    press(harness.root, 'ArrowDown');
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 1 });

    press(harness.root, 'ArrowLeft');
    press(harness.root, 'ArrowUp');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
  });

  it('holds exactly one cell in the tab order, and moves it with the cursor', () => {
    const harness = setup();
    expect(tabStops()).toHaveLength(1);
    expect(tabStops()[0]).toBe(cellAt(0, 0));

    press(harness.root, 'ArrowDown');
    expect(tabStops()).toHaveLength(1);
    expect(tabStops()[0]).toBe(cellAt(1, 0));
    expect(cellAt(1, 0)!.getAttribute('data-active')).toBe('');
    expect(cellAt(0, 0)!.getAttribute('tabindex')).toBe('-1');
  });

  it('moves focus with the cursor', () => {
    const harness = setup();
    press(harness.root, 'ArrowDown');
    expect(document.activeElement).toBe(cellAt(1, 0));
  });

  it('goes to the ends of the row with Home and End', () => {
    const harness = setup();
    press(harness.root, 'ArrowDown');
    press(harness.root, 'End');
    expect(harness.g.activeCell()).toEqual({ row: 1, column: COLUMN_COUNT - 1 });

    press(harness.root, 'Home');
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 0 });
  });

  it('goes to the ends of the grid with Ctrl+Home and Ctrl+End', () => {
    const harness = setup();
    press(harness.root, 'End', { ctrlKey: true });
    expect(harness.g.activeCell()).toEqual({ row: ROW_COUNT - 1, column: COLUMN_COUNT - 1 });

    // The cell it named had never been rendered: the scroll had to happen
    // first, and the element only exists a render later.
    expect(harness.scroller.scrollTop).toBe(ROW_COUNT * ROW_HEIGHT - VIEWPORT_HEIGHT);
    expect(harness.scroller.scrollLeft).toBe(COLUMN_COUNT * COLUMN_WIDTH - VIEWPORT_WIDTH);
    expect(document.activeElement).toBe(cellAt(ROW_COUNT - 1, COLUMN_COUNT - 1));

    press(harness.root, 'Home', { ctrlKey: true });
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
    expect(harness.scroller.scrollTop).toBe(0);
    expect(document.activeElement).toBe(cellAt(0, 0));
  });

  it('moves by what is actually on screen with PageDown and PageUp', () => {
    const harness = setup();
    press(harness.root, 'PageDown');
    // Five rows fill the viewport, so a page is five rows.
    expect(harness.g.activeCell()).toEqual({ row: 5, column: 0 });

    press(harness.root, 'PageDown');
    expect(harness.g.activeCell()).toEqual({ row: 10, column: 0 });

    press(harness.root, 'PageUp');
    expect(harness.g.activeCell()).toEqual({ row: 5, column: 0 });
  });

  it('lands on the column header going up off the first row', () => {
    const harness = setup();
    press(harness.root, 'ArrowUp');

    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 0 });
    expect(document.activeElement).toBe(headerCells()[0]);
    expect(tabStops()).toHaveLength(1);
    expect(headerCells()[0]!.getAttribute('tabindex')).toBe('0');

    // And back down into the data.
    press(harness.root, 'ArrowDown');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
  });

  it('stops at the edges rather than wrapping round them', () => {
    const harness = setup();
    press(harness.root, 'ArrowLeft');
    press(harness.root, 'ArrowUp');
    press(harness.root, 'ArrowUp');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 0 });

    press(harness.root, 'End', { ctrlKey: true });
    press(harness.root, 'ArrowRight');
    press(harness.root, 'ArrowDown');
    expect(harness.g.activeCell()).toEqual({ row: ROW_COUNT - 1, column: COLUMN_COUNT - 1 });
  });

  it('scrolls the cursor into view rather than leaving it off screen', () => {
    const harness = setup();
    for (let i = 0; i < 6; i++) press(harness.root, 'ArrowDown');

    // Six rows down with five on screen: the last press had to scroll.
    expect(harness.g.activeCell().row).toBe(6);
    expect(harness.scroller.scrollTop).toBe(40);
    expect(document.activeElement).toBe(cellAt(6, 0));
  });

  it('leaves keys it does not own alone', () => {
    const harness = setup();
    press(harness.root, 'a');
    expect(harness.instance.handled).toBe(false);

    // Ctrl and the arrows is a browser shortcut, not a grid movement.
    press(harness.root, 'ArrowDown', { ctrlKey: true });
    expect(harness.instance.handled).toBe(false);
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
  });

  it('resizes the column under the cursor with Alt and an arrow', () => {
    const harness = setup();
    press(harness.root, 'ArrowUp');
    press(harness.root, 'ArrowRight', { altKey: true });
    expect(harness.g.columns()[0]!.width).toBe(COLUMN_WIDTH + 16);

    press(harness.root, 'ArrowLeft', { altKey: true });
    press(harness.root, 'ArrowLeft', { altKey: true });
    expect(harness.g.columns()[0]!.width).toBe(COLUMN_WIDTH - 16);
  });

  it('leaves Alt alone anywhere but the header, where there is nothing to resize', () => {
    const harness = setup();
    press(harness.root, 'ArrowRight', { altKey: true });
    expect(harness.instance.handled).toBe(false);
    expect(harness.g.columns()[0]!.width).toBe(COLUMN_WIDTH);
  });

  it('adopts the cursor from focus arriving on a cell some other way', () => {
    const harness = setup();
    cellAt(3, 2)!.focus();
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: 3, column: 2 });
    expect(tabStops()[0]).toBe(cellAt(3, 2));

    // And the cursor carries on from there.
    press(harness.root, 'ArrowRight');
    expect(harness.g.activeCell()).toEqual({ row: 3, column: 3 });
  });

  it('keeps a tab stop in the window when the cursor scrolls away from it', () => {
    const harness = setup();
    press(harness.root, 'ArrowDown');
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 0 });

    // The reader takes the wheel, and the cell holding the tab stop leaves the
    // window under them.
    userScroll(harness.scroller, { top: 10_000 });
    expect(cellAt(1, 0)).toBe(null);

    // A tab stop on a cell that is not in the document is a grid Tab skips
    // entirely, and a keyboard user with no way back into it.
    const stops = tabStops();
    expect(stops).toHaveLength(1);
    expect(stops[0]!.getAttribute(GRID_CELL_ATTRIBUTE)).toBe('498,0');
    // The cursor itself has not moved: the reader scrolled, they did not
    // navigate.
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 0 });
  });

  it('keeps the cursor inside the grid when the rows underneath it go away', () => {
    const harness = setup();
    press(harness.root, 'End', { ctrlKey: true });
    expect(harness.g.activeCell().row).toBe(ROW_COUNT - 1);

    people.set(people.get().slice(0, 3));
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: 2, column: COLUMN_COUNT - 1 });

    // With nothing left at all, the header is the only place a cursor can be.
    people.set([]);
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: COLUMN_COUNT - 1 });
  });

  it('reports every move to a consumer holding the cursor itself', () => {
    const seen: string[] = [];
    const cursor = new Signal.State({ row: 2, column: 1 });
    gridOptions = { ...gridOptions, activeCell: cursor, onActiveCellChange: (cell) => seen.push(`${cell.row},${cell.column}`) };

    const harness = setup();
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 1 });
    expect(tabStops()[0]).toBe(cellAt(2, 1));

    press(harness.root, 'ArrowRight');
    expect(cursor.get()).toEqual({ row: 2, column: 2 });
    expect(seen).toEqual(['2,2']);
  });
});

describe('a cell owns its own binding', () => {
  it('writes one text node when one value changes, and re-renders nothing', () => {
    const harness = setup();
    const before = cells();
    const texts = before.map((cell) => cell.firstChild);
    const rendered = before.map((cell) => cell.textContent);
    reads = [];

    people.get()[3]!.cells[1]!.set('changed');
    flushSync();

    // One accessor ran: the cell that reads that signal. Not the row, not the
    // column, not the window.
    expect(reads).toEqual(['3:1']);
    expect(cellAt(3, 1)!.textContent).toBe('changed');

    // The same elements and the same text nodes, updated in place. A grid that
    // re-rendered would have replaced them.
    const after = cells();
    expect(after).toEqual(before);
    expect(after.map((cell) => cell.firstChild)).toEqual(texts);

    // And every other cell still says exactly what it said.
    const target = cellAt(3, 1);
    for (let i = 0; i < after.length; i++) {
      if (after[i] === target) continue;
      expect(after[i]!.textContent).toBe(rendered[i]);
    }
    expect(harness.g.rows()).toHaveLength(7);
  });

  it('does not re-read a value when the cursor moves over it', () => {
    const harness = setup();
    reads = [];

    press(harness.root, 'ArrowRight');
    press(harness.root, 'ArrowDown');

    // Moving the tab stop rewrites two attributes. It is not a reason to ask
    // thirty-five cells what they hold.
    expect(reads).toEqual([]);
    expect(cellAt(1, 1)!.getAttribute('tabindex')).toBe('0');
  });

  it('reuses the elements of a row the window keeps', () => {
    gridOptions = { ...gridOptions, getRowKey: (row) => row.id };
    const harness = setup();
    const kept = cellAt(6, 0)!;

    userScroll(harness.scroller, { top: 40 });

    // Row 6 was rendered before the scroll and is rendered after it. A keyed
    // loop moves the element it already has rather than building another.
    expect(harness.g.rows().map((row) => row.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(cellAt(6, 0)).toBe(kept);
  });
});

describe('what it does when it is not told', () => {
  it('falls back to a row height and a column width of its own', () => {
    gridOptions = { label: 'People' };
    const bare = makeColumns();
    bare[0] = { id: 'c0', header: 'Column 0', value: bare[0]!.value };
    columns.set(bare);

    const harness = setup();
    expect(rows()[0]!.style.height).toBe('32px');
    expect(harness.g.columns()[0]!.width).toBe(150);
    expect(harness.g.columns()[1]!.start).toBe(150);
  });

  it('will not let a resize take a column below a width worth clicking on', () => {
    const harness = setup();
    harness.g.resizeColumn('c0', 5);
    flushSync();
    expect(harness.g.columns()[0]!.width).toBe(40);
  });

  it('pages by a stated guess while the scroller has never been measured', () => {
    // One row is what an unmeasured viewport reports, and paging by one row is
    // an arrow key wearing a page key's name.
    const harness = setup({ height: 0, width: 0 });
    press(harness.root, 'PageDown');
    expect(harness.g.activeCell()).toEqual({ row: 10, column: 0 });
  });

  it('takes an overscan of its own', () => {
    gridOptions = { ...gridOptions, overscan: 0 };
    const harness = setup();
    // Exactly what is on screen, and nothing held in reserve around it.
    expect(harness.g.rows().map((row) => row.index)).toEqual([0, 1, 2, 3, 4]);
    expect(harness.g.columns().map((col) => col.index)).toEqual([0, 1, 2]);
  });

  it('takes a resize step of its own', () => {
    gridOptions = { ...gridOptions, resizeStep: 25 };
    const harness = setup();
    press(harness.root, 'ArrowUp');
    press(harness.root, 'ArrowRight', { altKey: true });
    expect(harness.g.columns()[0]!.width).toBe(COLUMN_WIDTH + 25);
  });

  it('keeps the scroller out of the browser scroll anchoring it fights with', () => {
    const harness = setup();
    // Both would compensate for content resizing above the viewport, by
    // different amounts, and the rows would drift as they were scrolled up.
    expect(harness.scroller.style.getPropertyValue('overflow-anchor')).toBe('none');
  });
});

describe('moving without the keyboard', () => {
  it('scrolls a cell into view without moving the cursor or focus', () => {
    const harness = setup();
    harness.g.scrollToCell({ row: 900, column: COLUMN_COUNT - 1 });
    flushSync();

    // Nearest: the smallest move that brings the whole cell into view.
    expect(harness.scroller.scrollTop).toBe(17_920);
    expect(harness.scroller.scrollLeft).toBe(900);
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
  });

  it('moves the cursor to a cell that has never been rendered', () => {
    const harness = setup();
    harness.g.focusCell({ row: 900, column: COLUMN_COUNT - 1 });
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: 900, column: COLUMN_COUNT - 1 });
    expect(document.activeElement).toBe(cellAt(900, COLUMN_COUNT - 1));
  });

  it('clamps a cell nobody could point at into the grid', () => {
    const harness = setup();
    harness.g.focusCell({ row: 10_000, column: 10_000 });
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: ROW_COUNT - 1, column: COLUMN_COUNT - 1 });
  });

  it('leaves the cursor alone when focus lands on something that is not a cell', () => {
    const harness = setup();
    harness.root.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
  });
});
