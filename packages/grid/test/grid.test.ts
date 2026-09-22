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
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDismiss,
  createLocaleProvider,
  resetAnnouncer,
  type MessageCatalog,
} from '@voltdev/primitives';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, flushSync, mount } from '@voltdev/core';
import {
  GRID_CELL_ATTRIBUTE,
  GRID_RESIZER_ATTRIBUTE,
  HEADER_ROW,
  VERSION,
  createGrid,
  rangeBounds,
  rangeContains,
  type Grid,
  type GridCellRange,
  type GridColumn,
  type GridFilter,
  type GridOptions,
  type GridSort,
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
    // The same signals, read without the bookkeeping. `reads` is the
    // instrument for what *rendered*, and a comparator or a filter reading a
    // value is not a cell re-rendering — mixing the two would make the
    // fine-grained assertions below unreadable. The default path, where both
    // of these fall back to `value`, is covered on its own.
    sortValue: (row: Person) => row.cells[index]!.get(),
    filterValue: (row: Person) => row.cells[index]!.get(),
  }));
}

/** Columns with neither accessor, so sorting and filtering fall back to `value`. */
function makeBareColumns(count: number): GridColumn<Person>[] {
  return makeColumns(count).map(({ id, header, width, value }) => ({ id, header, width, value }));
}

/**
 * A short, hand-written table.
 *
 * The generated thousand is right for virtualization and useless for asserting
 * an order: a test that says which rows came out first has to be able to hold
 * the whole answer.
 */
function tableOf(cells: readonly (readonly string[])[]): void {
  columns.set(makeColumns(cells[0]!.length));
  people.set(
    cells.map((values, id) => ({
      id,
      cells: values.map((value) => new Signal.State(value)),
    })),
  );
}

/** Rows identified by what they are, which is what selection and re-sorting need. */
function byId(): void {
  gridOptions = { ...gridOptions, getRowKey: (row: Person) => row.id };
}

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;

let people: Signal.State<readonly Person[]>;
let columns: Signal.State<readonly GridColumn<Person>[]>;
let gridOptions: Omit<GridOptions<Person>, 'grid' | 'scroller' | 'container' | 'rows' | 'columns'>;
/** Translations for a locale provided around the grid, or null for none. */
let catalogue: MessageCatalog | null;

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
  catalogue = null;

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
  // Sorting and filtering both announce, so most tests below leave a region
  // behind. One that outlived its test would make the next one's silence
  // impossible to tell from a stale sentence.
  resetAnnouncer();
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
});

const TEMPLATE = `
  <div class="grid" :ref="grid" :spread="g.gridProps()"
       :keydown="onKey($event)" :focusin="g.onFocusIn($event)">
    <div class="header" :spread="g.headerProps()">
      <div class="header-row" :spread="g.headerRowProps()">
        <div class="th" :for="col in g.columns()" :key="col.key" :spread="g.headerCellProps(col)"
             :click="g.onHeaderClick($event)">
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
                 :spread="g.cellProps(row, col)"
                 :click="g.onCellClick($event)">{ g.cellValue(row, col) }</div>
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
    // Before the grid, which reads the nearest locale when it is created.
    locale = catalogue && createLocaleProvider({ defaultLocale: 'de-DE', messages: catalogue });
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

function click(el: Element, modifiers: Partial<MouseEventInit> = {}): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers }));
  flushSync();
}

/** What one column of the rendered window says, top to bottom. */
function columnText(index: number): (string | null)[] {
  return rows().map((row) => row.querySelectorAll('.cell')[index]?.textContent ?? null);
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

  it('spends the Escape that cancels a drag on the drag, and not on a dialog around it', () => {
    const harness = setup();
    // The grid sits in a layer that closes on Escape, the way a dialog does.
    const dismissed: string[] = [];
    restores.push(
      createRoot((dispose) => {
        createDismiss(() => harness.root, (reason) => dismissed.push(reason));
        return dispose;
      }),
    );
    const handle = resizerFor('c0');
    handle.dispatchEvent(pointer('pointerdown', { clientX: 0 }));
    handle.dispatchEvent(pointer('pointermove', { clientX: 40 }));
    flushSync();

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    harness.root.dispatchEvent(escape);
    flushSync();
    // One key, one layer: the drag is undone and the dialog is still open.
    expect(harness.g.columns()[0]!.width).toBe(COLUMN_WIDTH);
    expect(dismissed).toEqual([]);
    expect(escape.defaultPrevented).toBe(true);

    // With no drag in flight, the next Escape is the dialog's again.
    harness.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dismissed).toEqual(['escape']);
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
    // The same number of columns, so only the widths say anything changed.
    columns.set(wider);
    flushSync();

    expect(harness.g.columns()[0]!.width).toBe(250);
    expect(harness.g.columns()[1]!.start).toBe(250);
    expect(harness.sizer.style.width).toBe('1350px');
  });

  it('rebuilds the column geometry once for a resize, and once for a new column list', () => {
    // A rebuild asks every column how wide it is, so the columns keep count.
    let asked = 0;
    const counted = (): GridColumn<Person>[] =>
      makeColumns().map((column) => {
        const copy = { ...column };
        Object.defineProperty(copy, 'width', {
          enumerable: true,
          get: () => {
            asked += 1;
            return COLUMN_WIDTH;
          },
        });
        return copy;
      });
    columns.set(counted());
    const harness = setup();

    // Every move of a drag is one of these, and each costs a pass over the
    // columns: the resize asks the column where it starts, and the one rebuild
    // asks the other eleven, the resized one answering from the width it holds.
    asked = 0;
    harness.g.resizeColumn('c0', 150);
    flushSync();
    expect(asked).toBe(1 + (COLUMN_COUNT - 1));
    expect(harness.g.columns()[1]!.start).toBe(150);

    asked = 0;
    columns.set(counted());
    flushSync();
    expect(asked).toBe(COLUMN_COUNT - 1);
    expect(harness.g.columns()[1]!.start).toBe(150);
    expect(harness.sizer.style.width).toBe(`${150 + (COLUMN_COUNT - 1) * COLUMN_WIDTH}px`);
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

  it('says the new width out loud, since nothing else reports a keyboard resize', async () => {
    // The handle is `aria-hidden`, the header text does not change, and focus
    // does not move: without an announcement the gesture is silent, and
    // silence reads as the key not having worked.
    const harness = setup();
    press(harness.root, 'ArrowUp');
    press(harness.root, 'ArrowRight', { altKey: true });

    await vi.waitFor(() => {
      const region = document.querySelector("[data-volt-announcer='polite']");
      expect(region?.textContent ?? '').toContain(`${COLUMN_WIDTH + 16} pixels`);
    });
    resetAnnouncer();
  });

  it('says nothing when the resize changed nothing, so a clamp is not a false report', async () => {
    // 100 down by 16s reaches the default floor of 40; from there the key
    // still fires and the width no longer moves. Announcing a width that did
    // not change would tell a keyboard user the column is still shrinking.
    const harness = setup();
    press(harness.root, 'ArrowUp');
    for (let i = 0; i < 6; i++) press(harness.root, 'ArrowLeft', { altKey: true });
    expect(harness.g.columns()[0]!.width).toBe(40);

    resetAnnouncer();
    press(harness.root, 'ArrowLeft', { altKey: true });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(document.querySelector("[data-volt-announcer='polite']")).toBe(null);
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

/**
 * A short table with something to sort and something to filter in every
 * column: text, numbers that arrived as strings, a small set of categories,
 * and one blank.
 */
const FRUIT: readonly (readonly string[])[] = [
  ['pear', '3', 'red'],
  ['apple', '10', 'green'],
  ['plum', '7', 'red'],
  ['fig', '', 'blue'],
];

describe('sorting', () => {
  it('cycles a column through ascending, descending and unsorted as its header is clicked', () => {
    tableOf(FRUIT);
    const harness = setup();

    click(headerCells()[0]!);
    expect(columnText(0)).toEqual(['apple', 'fig', 'pear', 'plum']);
    expect(headerCells()[0]!.getAttribute('aria-sort')).toBe('ascending');

    click(headerCells()[0]!);
    expect(columnText(0)).toEqual(['plum', 'pear', 'fig', 'apple']);
    expect(headerCells()[0]!.getAttribute('aria-sort')).toBe('descending');

    // The third state is the order the rows arrived in. A grid that could not
    // be put back has lost something the reader may want.
    click(headerCells()[0]!);
    expect(columnText(0)).toEqual(['pear', 'apple', 'plum', 'fig']);
    expect(headerCells()[0]!.getAttribute('aria-sort')).toBe('none');
    expect(harness.g.sort()).toEqual([]);
  });

  it('sorts a view and never the array it was given', () => {
    tableOf(FRUIT);
    const harness = setup();
    const source = people.get();
    const order = [...source];

    harness.g.toggleSort('c0');
    flushSync();
    expect(columnText(0)).toEqual(['apple', 'fig', 'pear', 'plum']);

    // The same array, holding the same objects in the same places. A caller
    // rendering these rows somewhere else is rendering what they were.
    expect(people.get()).toBe(source);
    expect(source.every((row, index) => row === order[index])).toBe(true);
    // And the grid hands back those very objects, not copies of them.
    expect(harness.g.rows()[0]!.item).toBe(source[1]);
    expect(harness.g.rows()[3]!.item).toBe(source[2]);
  });

  it('adds a column to the order with a shift-click rather than replacing it', () => {
    tableOf([
      ['b', '2'],
      ['a', '2'],
      ['b', '1'],
      ['a', '1'],
    ]);
    const harness = setup();

    click(headerCells()[0]!);
    click(headerCells()[1]!, { shiftKey: true });

    expect(harness.g.sort()).toEqual([
      { columnId: 'c0', direction: 'ascending' },
      { columnId: 'c1', direction: 'ascending' },
    ]);
    expect(columnText(0)).toEqual(['a', 'a', 'b', 'b']);
    expect(columnText(1)).toEqual(['1', '2', '1', '2']);
    expect(attrs('.th', 'aria-sort')).toEqual(['ascending', 'ascending']);
    // Which term is which, for a header that wants to show a 1 and a 2.
    expect(attrs('.th', 'data-sort-index')).toEqual(['1', '2']);

    // Cycling the second term off leaves the first alone.
    click(headerCells()[1]!, { shiftKey: true });
    click(headerCells()[1]!, { shiftKey: true });
    expect(harness.g.sort()).toEqual([{ columnId: 'c0', direction: 'ascending' }]);
    expect(attrs('.th', 'data-sort-index')).toEqual([null, null]);
  });

  it('keeps rows the terms cannot separate in the order they arrived in', () => {
    tableOf([
      ['b', '2'],
      ['a', '2'],
      ['b', '1'],
      ['a', '1'],
    ]);
    const harness = setup();

    harness.g.toggleSort('c0');
    flushSync();
    // Both `a` rows tie, and a stable sort leaves them as they were — which is
    // what makes a second sort a refinement of the first rather than a reshuffle.
    expect(columnText(1)).toEqual(['2', '1', '2', '1']);
  });

  it('sorts by a comparator of the column\'s own when it has one', () => {
    tableOf(FRUIT);
    const list = makeColumns(3);
    // Nothing a general comparator could reach: the row's identity.
    list[0] = { ...list[0]!, compare: (a, b) => b.id - a.id };
    columns.set(list);
    const harness = setup();

    harness.g.toggleSort('c0');
    flushSync();
    expect(columnText(0)).toEqual(['fig', 'plum', 'apple', 'pear']);

    harness.g.toggleSort('c0');
    flushSync();
    // Descending negates whatever the comparator returned.
    expect(columnText(0)).toEqual(['pear', 'apple', 'plum', 'fig']);
  });

  it('puts blank values last whichever way the column is sorted', () => {
    tableOf(FRUIT);
    const harness = setup();

    harness.g.toggleSort('c1');
    flushSync();
    expect(columnText(1)).toEqual(['3', '7', '10', '']);

    harness.g.toggleSort('c1');
    flushSync();
    // Reversing a sort asks for the largest values first, not for the rows
    // that have no value at all.
    expect(columnText(1)).toEqual(['10', '7', '3', '']);
  });

  it('sorts an invalid date and NaN with the blanks, last whichever way', () => {
    // Twelve dates out of order and one that is not a date, which is enough
    // rows for an engine's sort to be thrown by a comparator that calls the
    // invalid one equal to everything.
    const days = [1, 8, -1, 0, 9, 4, 10, 11, 2, 7, 3, 6, 5];
    tableOf(
      days.map((day) =>
        day < 0 ? ['not a date', 'x'] : [`2024-01-${String(day + 1).padStart(2, '0')}`, String(day)],
      ),
    );
    const list = makeColumns(2);
    list[0] = { ...list[0]!, sortValue: (row) => new Date(row.cells[0]!.get()) };
    // `Number('x')` is NaN, the other value that is ordered against nothing.
    list[1] = { ...list[1]!, sortValue: (row) => Number(row.cells[1]!.get()) };
    columns.set(list);
    const harness = setup({ height: 400 });
    const ordered = (column: number) => harness.g.rows().map((row) => row.item.cells[column]!.get());

    harness.g.toggleSort('c0');
    flushSync();
    expect(ordered(1)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'x']);

    harness.g.toggleSort('c0');
    flushSync();
    expect(ordered(1)).toEqual(['11', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1', '0', 'x']);

    harness.g.setSort([{ columnId: 'c1', direction: 'descending' }]);
    flushSync();
    expect(ordered(1)[0]).toBe('11');
    expect(ordered(1).at(-1)).toBe('x');
  });

  it('sorts by what the cell shows when the column names no other key', () => {
    tableOf(FRUIT);
    columns.set(makeBareColumns(1));
    const harness = setup();

    harness.g.toggleSort('c0');
    flushSync();
    expect(columnText(0)).toEqual(['apple', 'fig', 'pear', 'plum']);
  });

  it('marks every sortable column and leaves one that says it is not', () => {
    const list = makeColumns(3);
    list[1] = { ...list[1]!, sortable: false };
    columns.set(list);
    const harness = setup();

    // `none` on a sortable column is the affordance: without it the header
    // says nothing about being sortable until it already is.
    expect(attrs('.th', 'aria-sort')).toEqual(['none', null, 'none']);

    click(headerCells()[1]!);
    expect(harness.g.sort()).toEqual([]);
    expect(harness.g.sortDirection('c1')).toBe(null);
  });

  it('reports no direction for a term the sort cannot use', async () => {
    const list = makeColumns(3);
    list[1] = { ...list[1]!, sortable: false };
    columns.set(list);
    const harness = setup();

    harness.g.setSort([
      { columnId: 'gone', direction: 'ascending' },
      { columnId: 'c1', direction: 'descending' },
      { columnId: 'c2', direction: 'ascending' },
    ]);
    flushSync();

    // The saved order keeps every term, in case the column comes back...
    expect(harness.g.sort()).toHaveLength(3);
    // ...but only one of them orders anything, and that is all the grid says.
    expect(harness.g.sortDirection('gone')).toBe(null);
    expect(harness.g.sortDirection('c1')).toBe(null);
    expect(harness.g.sortDirection('c2')).toBe('ascending');
    expect(attrs('.th', 'aria-sort')).toEqual(['none', null, 'ascending']);
    // One term that orders is a sort of one, with no ordinal worth showing.
    expect(attrs('.th', 'data-sort-index')).toEqual([null, null, null]);

    // And the sentence a gesture speaks names only what the rows are sorted by.
    harness.g.toggleSort('c2', true);
    flushSync();
    expect(await announced()).toBe('Sorted by Column 2 descending');
  });

  it('ignores the click that ends a resize drag', () => {
    const harness = setup();
    const handle = resizerFor('c0');

    handle.dispatchEvent(pointer('pointerdown', { clientX: 0 }));
    handle.dispatchEvent(pointer('pointermove', { clientX: 40 }));
    handle.dispatchEvent(pointer('pointerup', { clientX: 40 }));
    flushSync();
    expect(harness.g.columns()[0]!.width).toBe(140);

    // The browser fires a click after the drag, on the handle, and it bubbles
    // to the header cell around it.
    click(handle);
    expect(harness.g.sort()).toEqual([]);
  });

  it('sorts from the header with Enter, and adds a column with Shift and Space', () => {
    tableOf(FRUIT);
    const harness = setup();

    press(harness.root, 'ArrowUp');
    press(harness.root, 'Enter');
    expect(harness.g.sort()).toEqual([{ columnId: 'c0', direction: 'ascending' }]);

    press(harness.root, 'ArrowRight');
    press(harness.root, ' ', { shiftKey: true });
    expect(harness.instance.handled).toBe(true);
    expect(harness.g.sort()).toEqual([
      { columnId: 'c0', direction: 'ascending' },
      { columnId: 'c1', direction: 'ascending' },
    ]);
  });

  it('says the whole order out loud, since the rows moving is the only other sign', async () => {
    tableOf(FRUIT);
    const harness = setup();

    harness.g.toggleSort('c0');
    flushSync();
    expect(await announced()).toContain('Sorted by Column 0 ascending');
    resetAnnouncer();

    harness.g.toggleSort('c1', true);
    flushSync();
    // The column just clicked is the one thing the reader already knows; what
    // they cannot see is what it did to the terms around it.
    expect(await announced()).toContain('Sorted by Column 0 ascending, then Column 1 ascending');
  });

  it('says nothing when a saved order is restored rather than chosen', async () => {
    const harness = setup();
    harness.g.setSort([{ columnId: 'c0', direction: 'descending' }]);
    flushSync();

    expect(harness.g.sortDirection('c0')).toBe('descending');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(document.querySelector("[data-volt-announcer='polite']")).toBe(null);
  });

  it('keeps the cursor on the row it was on when a sort moves it', () => {
    byId();
    const harness = setup();

    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown');
    expect(harness.g.activeCell()).toEqual({ row: 3, column: 0 });
    expect(document.activeElement).toBe(cellAt(3, 0));

    // Ascending is the order the rows were already in, so nothing moves.
    harness.g.toggleSort('c0');
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: 3, column: 0 });

    harness.g.toggleSort('c0');
    flushSync();
    // Row `r3` is now the fourth from the end. The cursor is on it, not on
    // whatever slid into position three.
    expect(harness.g.activeCell()).toEqual({ row: ROW_COUNT - 4, column: 0 });
    expect(cellAt(ROW_COUNT - 4, 0)!.textContent).toBe('r3c0');
    // Focus was on the cursor, so it came along.
    expect(document.activeElement).toBe(cellAt(ROW_COUNT - 4, 0));
  });

  it('follows the row without pulling focus when focus was not on the cursor', () => {
    byId();
    const harness = setup();

    // A pointer user clicking a header twice: nothing in the body has focus.
    click(headerCells()[0]!);
    click(headerCells()[0]!);
    expect(harness.g.sortDirection('c0')).toBe('descending');

    // The cursor started on row zero, which is now last — and stays with it.
    expect(harness.g.activeCell()).toEqual({ row: ROW_COUNT - 1, column: 0 });
    // Without scrolling the grid to it, and without taking focus off whatever
    // the reader was using to sort.
    expect(harness.scroller.scrollTop).toBe(0);
    expect(cellAt(ROW_COUNT - 1, 0)).toBe(null);
    expect(document.activeElement).not.toBe(harness.root);
  });

  it('leaves focus where the reader put it when they clicked away onto nothing', async () => {
    byId();
    const harness = setup();
    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown');
    expect(document.activeElement).toBe(cellAt(3, 0));

    // A click on the page background: focus goes nowhere, and the cell that
    // had it is still in the document. The sort is a later gesture.
    cellAt(3, 0)!.blur();
    expect(document.activeElement).toBe(document.body);
    await Promise.resolve();

    harness.g.toggleSort('c0');
    harness.g.toggleSort('c0');
    flushSync();
    // The cursor still follows its row, but focus is the reader's, and they
    // put it outside the grid.
    expect(harness.g.activeCell()).toEqual({ row: ROW_COUNT - 4, column: 0 });
    expect(document.activeElement).toBe(document.body);
  });

  it('still brings focus along when the blur was a re-render taking the cell', async () => {
    byId();
    const harness = setup();
    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown');

    // What an engine that reports a removed cell's blur does: focus is already
    // on the document and the cell is still in it when the event comes, and
    // the rows move in the same breath. At that moment it looks exactly like
    // the reader clicking away.
    cellAt(3, 0)!.blur();
    expect(document.activeElement).toBe(document.body);
    harness.g.toggleSort('c0');
    harness.g.toggleSort('c0');
    flushSync();
    expect(document.activeElement).toBe(cellAt(ROW_COUNT - 4, 0));

    // And the verdict, when it comes, is that the reader never left: the next
    // re-sort brings focus along as well.
    await Promise.resolve();
    harness.g.toggleSort('c0');
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: 3, column: 0 });
    expect(document.activeElement).toBe(cellAt(3, 0));
  });

  it('cannot follow a row when nothing identifies one', () => {
    // The default key is the row's index, and an index names a different row
    // after every sort. This is the documented cost of leaving `getRowKey` out.
    const harness = setup();
    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown');

    harness.g.toggleSort('c0');
    harness.g.toggleSort('c0');
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 0 });
  });
});

describe('filtering', () => {
  it('filters a view and never the array it was given', () => {
    tableOf(FRUIT);
    const harness = setup();
    const source = people.get();

    harness.g.setFilter('c2', { type: 'set', values: ['red'] });
    flushSync();

    expect(columnText(0)).toEqual(['pear', 'plum']);
    expect(people.get()).toBe(source);
    expect(source).toHaveLength(4);
    expect(harness.g.rows()[0]!.item).toBe(source[0]);
    expect(harness.g.rows()[1]!.item).toBe(source[2]);
  });

  it('counts the rows a filter left, not the rows it was given', () => {
    const harness = setup();
    harness.g.setFilter('c0', { type: 'text', value: 'r99', operator: 'startsWith' });
    flushSync();

    // `r99`, and `r990` through `r999`.
    expect(harness.g.rowCount()).toBe(11);
    expect(harness.g.sourceRowCount()).toBe(ROW_COUNT);
    // A reader told there are a thousand rows in a grid holding eleven is
    // worse off than a reader told nothing. One more than eleven, for the
    // header row.
    expect(harness.root.getAttribute('aria-rowcount')).toBe('12');
    expect(harness.sizer.style.height).toBe(`${11 * ROW_HEIGHT}px`);
    expect(attrs('.row', 'aria-rowindex')).toEqual(['2', '3', '4', '5', '6', '7', '8']);
  });

  it('matches text with the operator the filter names', () => {
    tableOf(FRUIT);
    const harness = setup();

    harness.g.setFilter('c0', { type: 'text', value: 'p' });
    flushSync();
    expect(columnText(0)).toEqual(['pear', 'apple', 'plum']);

    harness.g.setFilter('c0', { type: 'text', value: 'p', operator: 'startsWith' });
    flushSync();
    expect(columnText(0)).toEqual(['pear', 'plum']);

    // Folded in the grid's locale unless the filter asks otherwise.
    harness.g.setFilter('c0', { type: 'text', value: 'PLUM', operator: 'equals' });
    flushSync();
    expect(columnText(0)).toEqual(['plum']);

    harness.g.setFilter('c0', {
      type: 'text',
      value: 'PLUM',
      operator: 'equals',
      caseSensitive: true,
    });
    flushSync();
    expect(columnText(0)).toEqual([]);

    harness.g.setFilter('c0', { type: 'text', value: 'p', operator: 'notContains' });
    flushSync();
    expect(columnText(0)).toEqual(['fig']);
  });

  it('compares a number filter as numbers, whatever the cell is holding', () => {
    tableOf(FRUIT);
    const harness = setup();

    // The cells hold strings, which is what a number out of JSON looks like.
    harness.g.setFilter('c1', { type: 'number', value: 5, operator: 'greaterThan' });
    flushSync();
    expect(columnText(1)).toEqual(['10', '7']);

    harness.g.setFilter('c1', { type: 'number', value: 3, operator: 'between', to: 7 });
    flushSync();
    expect(columnText(1)).toEqual(['3', '7']);

    // And an empty cell is not zero, which is the trap `Number('')` sets.
    harness.g.setFilter('c1', { type: 'number', value: 0, operator: 'greaterThanOrEqual' });
    flushSync();
    expect(columnText(1)).toEqual(['3', '10', '7']);
  });

  it('reads an invalid date as no number, which not even notEquals keeps', () => {
    tableOf([
      ['2024-01-01'],
      ['not a date'],
      ['2024-03-01'],
    ]);
    const list = makeColumns(1);
    list[0] = { ...list[0]!, filterValue: (row) => new Date(row.cells[0]!.get()) };
    columns.set(list);
    const harness = setup();

    // A blank is not "not 5", and neither is a date that holds no time at all.
    harness.g.setFilter('c0', { type: 'number', value: 0, operator: 'notEquals' });
    flushSync();
    expect(columnText(0)).toEqual(['2024-01-01', '2024-03-01']);
  });

  it('keeps only the values a set filter names', () => {
    tableOf(FRUIT);
    const harness = setup();

    harness.g.setFilter('c2', { type: 'set', values: ['red', 'blue'] });
    flushSync();
    expect(columnText(2)).toEqual(['red', 'red', 'blue']);

    // Nothing ticked is nothing kept — a caller who wants everything removes
    // the filter rather than emptying it.
    harness.g.setFilter('c2', { type: 'set', values: [] });
    flushSync();
    expect(columnText(2)).toEqual([]);
  });

  it('searches every column with the quick filter, and wants every word', () => {
    tableOf(FRUIT);
    const harness = setup();

    harness.g.setQuickFilter('red');
    flushSync();
    expect(columnText(0)).toEqual(['pear', 'plum']);

    // Two words mean both, and they may land in different columns.
    harness.g.setQuickFilter('plum red');
    flushSync();
    expect(columnText(0)).toEqual(['plum']);

    harness.g.setQuickFilter('fig red');
    flushSync();
    expect(columnText(0)).toEqual([]);

    harness.g.setQuickFilter('   ');
    flushSync();
    expect(columnText(0)).toEqual(['pear', 'apple', 'plum', 'fig']);
  });

  it('treats a filter the reader has not finished as no filter at all', () => {
    tableOf(FRUIT);
    const harness = setup();

    harness.g.setFilter('c0', { type: 'text', value: '' });
    flushSync();
    expect(harness.g.rowCount()).toBe(4);

    // A range with only one end typed into it.
    harness.g.setFilter('c1', { type: 'number', value: 3, operator: 'between' });
    flushSync();
    expect(harness.g.rowCount()).toBe(4);
    // Held, though — the filter UI is still showing what the reader typed.
    expect(harness.g.filters().size).toBe(2);
  });

  it('combines a column filter with the quick filter', () => {
    tableOf(FRUIT);
    const harness = setup();

    harness.g.setFilter('c2', { type: 'set', values: ['red'] });
    harness.g.setQuickFilter('plum');
    flushSync();
    expect(columnText(0)).toEqual(['plum']);

    harness.g.clearFilters();
    flushSync();
    expect(harness.g.filters().size).toBe(0);
    expect(harness.g.quickFilter()).toBe('');
    expect(columnText(0)).toEqual(['pear', 'apple', 'plum', 'fig']);
  });

  it('marks a column whose filter is doing something', () => {
    const harness = setup();
    harness.g.setFilter('c1', { type: 'text', value: 'r1' });
    flushSync();
    expect(attrs('.th', 'data-filtered')).toEqual([null, '', null, null, null]);
  });

  it('does not mark a column whose filter is not finished, since it filters nothing', () => {
    const harness = setup();
    // An empty text box and a range missing its far end: both are in the
    // filters, and neither has removed a row.
    harness.g.setFilter('c1', { type: 'text', value: '' });
    harness.g.setFilter('c2', { type: 'number', operator: 'between', value: 1 });
    flushSync();
    expect(harness.g.rowCount()).toBe(ROW_COUNT);
    expect(attrs('.th', 'data-filtered')).toEqual([null, null, null, null, null]);

    harness.g.setFilter('c1', { type: 'text', value: 'r1' });
    flushSync();
    expect(attrs('.th', 'data-filtered')).toEqual([null, '', null, null, null]);
  });

  it('says how many rows are left, since nothing else reports it', async () => {
    const harness = setup();
    harness.g.setFilter('c0', { type: 'text', value: 'r99', operator: 'startsWith' });
    flushSync();

    // The rows that stopped matching are not in the document, and in a
    // virtualized grid they never all were.
    expect(await announced()).toContain('11 of 1000 rows');
  });

  it('keeps the cursor inside a view a filter has shrunk', () => {
    byId();
    const harness = setup();
    press(harness.root, 'End', { ctrlKey: true });
    expect(harness.g.activeCell().row).toBe(ROW_COUNT - 1);

    harness.g.setFilter('c0', { type: 'text', value: 'r99c0', operator: 'equals' });
    flushSync();
    expect(harness.g.rowCount()).toBe(1);
    expect(harness.g.activeCell()).toEqual({ row: 0, column: COLUMN_COUNT - 1 });
  });

  it('finds a row by its key wherever the sort and the filter have put it', () => {
    byId();
    tableOf(FRUIT);
    const harness = setup();
    expect(harness.g.rowIndex(2)).toBe(2);

    harness.g.toggleSort('c0');
    flushSync();
    // apple, fig, pear, plum: plum, the row keyed 2, is last.
    expect(harness.g.rowIndex(2)).toBe(3);

    harness.g.setFilter('c2', { type: 'set', values: ['green', 'blue'] });
    flushSync();
    expect(harness.g.rowIndex(2)).toBe(-1);
    expect(harness.g.rowIndex(3)).toBe(1);
  });

  it('sorts what the filter left, in that order', () => {
    tableOf(FRUIT);
    const harness = setup();

    harness.g.setFilter('c2', { type: 'set', values: ['red', 'green'] });
    harness.g.toggleSort('c0');
    flushSync();
    expect(columnText(0)).toEqual(['apple', 'pear', 'plum']);
  });

  it('refuses a filter on a column that cannot be filtered, and says why', () => {
    tableOf(FRUIT);
    columns.set(
      columns.get().map((column) => (column.id === 'c2' ? { ...column, filterable: false } : column)),
    );
    const reported: number[] = [];
    gridOptions = { ...gridOptions, onFilterChange: (filters) => reported.push(filters.size) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    restores.push(() => warn.mockRestore());
    const harness = setup();

    harness.g.setFilter('c2', { type: 'set', values: ['red'] });
    flushSync();
    // Not held, not reported, and nothing filtered.
    expect(harness.g.filters().size).toBe(0);
    expect(reported).toEqual([]);
    expect(harness.g.rowCount()).toBe(4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('"c2" is not filterable');

    // Nor does the quick filter search it: "red" is in that column and no other.
    harness.g.setQuickFilter('red');
    flushSync();
    expect(harness.g.rowCount()).toBe(0);
    harness.g.setQuickFilter('plum');
    flushSync();
    expect(columnText(0)).toEqual(['plum']);
  });

  it('filters nothing by a filter held for a column that cannot be filtered, and marks nothing', () => {
    tableOf(FRUIT);
    columns.set(
      columns.get().map((column) => (column.id === 'c2' ? { ...column, filterable: false } : column)),
    );
    // Handed in from outside, where nothing refused it — a saved view, say.
    gridOptions = {
      ...gridOptions,
      filters: new Signal.State<ReadonlyMap<string, GridFilter>>(
        new Map([['c2', { type: 'set', values: ['red'] }]]),
      ),
    };
    const harness = setup();

    expect(harness.g.rowCount()).toBe(4);
    expect(attrs('.th', 'data-filtered')).toEqual([null, null, null]);
    // Kept in the signal all the same, as a sort term for a column that cannot
    // be sorted is.
    expect(harness.g.filters().size).toBe(1);
  });

  it('refuses a quick filter where no column can be filtered, and says why', () => {
    tableOf(FRUIT);
    columns.set(columns.get().map((column) => ({ ...column, filterable: false })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    restores.push(() => warn.mockRestore());
    const harness = setup();

    harness.g.setQuickFilter('plum');
    flushSync();
    expect(harness.g.quickFilter()).toBe('');
    expect(harness.g.rowCount()).toBe(4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('no column is filterable');
  });
});

describe('selection', () => {
  it('says nothing about selection in a grid that has none', () => {
    const harness = setup();
    expect(harness.root.getAttribute('aria-multiselectable')).toBe(null);
    expect(rows()[0]!.getAttribute('aria-selected')).toBe(null);
    expect(cellAt(0, 0)!.getAttribute('aria-selected')).toBe(null);
  });

  it('holds one row at a time when only one may be chosen', () => {
    byId();
    gridOptions = { ...gridOptions, rowSelection: 'single' };
    const harness = setup();

    click(cellAt(2, 0)!);
    expect([...harness.g.selectedRows()]).toEqual([2]);
    expect(rows()[2]!.getAttribute('aria-selected')).toBe('true');
    // Not `false` on the rest: a screenful of "not selected" for the one that
    // is, in a grid where only one can be.
    expect(rows()[3]!.getAttribute('aria-selected')).toBe(null);
    expect(harness.root.getAttribute('aria-multiselectable')).toBe(null);

    click(cellAt(4, 0)!);
    expect([...harness.g.selectedRows()]).toEqual([4]);
    expect(rows()[2]!.getAttribute('aria-selected')).toBe(null);
  });

  it('holds any number of rows, and says so on the grid', () => {
    byId();
    const seen: number[][] = [];
    gridOptions = {
      ...gridOptions,
      rowSelection: 'multiple',
      onRowSelectionChange: (keys) => seen.push([...keys] as number[]),
    };
    const harness = setup();

    expect(harness.root.getAttribute('aria-multiselectable')).toBe('true');

    click(cellAt(1, 0)!);
    click(cellAt(3, 0)!, { ctrlKey: true });
    expect([...harness.g.selectedRows()]).toEqual([1, 3]);
    // Here the `false` is what makes the set legible.
    expect(attrs('.row', 'aria-selected')).toEqual([
      'false', 'true', 'false', 'true', 'false', 'false', 'false',
    ]);
    expect(seen).toEqual([[1], [1, 3]]);

    click(cellAt(3, 0)!, { ctrlKey: true });
    expect([...harness.g.selectedRows()]).toEqual([1]);
  });

  it('takes a range of rows from the last one deliberately chosen', () => {
    byId();
    gridOptions = { ...gridOptions, rowSelection: 'multiple' };
    const harness = setup();

    click(cellAt(1, 0)!);
    click(cellAt(4, 0)!, { shiftKey: true });
    expect([...harness.g.selectedRows()].sort()).toEqual([1, 2, 3, 4]);

    // The anchor stays put, so dragging the shift-click back shrinks the one
    // range rather than leaving a trail of them.
    click(cellAt(2, 0)!, { shiftKey: true });
    expect([...harness.g.selectedRows()].sort()).toEqual([1, 2]);
  });

  it('toggles the row under the cursor with Space', () => {
    byId();
    gridOptions = { ...gridOptions, rowSelection: 'multiple' };
    const harness = setup();

    press(harness.root, 'ArrowDown');
    press(harness.root, ' ');
    expect([...harness.g.selectedRows()]).toEqual([1]);
    expect(harness.instance.handled).toBe(true);

    press(harness.root, ' ');
    expect([...harness.g.selectedRows()]).toEqual([]);
  });

  it('leaves Space alone in a grid with no row selection', () => {
    const harness = setup();
    press(harness.root, ' ');
    expect(harness.instance.handled).toBe(false);
  });

  it('selects every row the filter left with Ctrl+A, and no row it removed', () => {
    byId();
    gridOptions = { ...gridOptions, rowSelection: 'multiple' };
    tableOf(FRUIT);
    const harness = setup();

    harness.g.setFilter('c2', { type: 'set', values: ['red'] });
    flushSync();

    press(harness.root, 'a', { ctrlKey: true });
    // Not the green one and not the blue one: a bulk action must not reach
    // rows the reader cannot see and did not mean.
    expect([...harness.g.selectedRows()].sort()).toEqual([0, 2]);

    harness.g.clearRowSelection();
    flushSync();
    expect(harness.g.selectedRows().size).toBe(0);
  });

  it('selects no row the caller says cannot be, by any gesture', () => {
    byId();
    tableOf(FRUIT);
    gridOptions = {
      ...gridOptions,
      rowSelection: 'multiple',
      // Every row but the green one.
      selectable: (row) => row.cells[2]!.get() !== 'green',
    };
    const harness = setup();
    expect(columnText(2)).toEqual(['red', 'green', 'red', 'blue']);

    click(cellAt(1, 0)!);
    expect(harness.g.selectedRows().size).toBe(0);
    harness.g.focusCell({ row: 1, column: 0 });
    press(harness.root, ' ');
    expect(harness.g.selectedRows().size).toBe(0);
    // Spent all the same: the browser's Space would scroll the page.
    expect(harness.instance.handled).toBe(true);

    press(harness.root, 'a', { ctrlKey: true });
    expect([...harness.g.selectedRows()].sort()).toEqual([0, 2, 3]);
    // Absent rather than false: that is how a row says it cannot be selected.
    expect(attrs('.row', 'aria-selected')).toEqual(['true', null, 'true', 'true']);
  });

  it('keeps a row selected through a re-sort, because it is held by key', () => {
    byId();
    gridOptions = { ...gridOptions, rowSelection: 'multiple' };
    tableOf(FRUIT);
    const harness = setup();

    click(cellAt(2, 0)!);
    expect(columnText(0)).toEqual(['pear', 'apple', 'plum', 'fig']);
    expect(attrs('.row', 'aria-selected')).toEqual(['false', 'false', 'true', 'false']);

    harness.g.toggleSort('c0');
    flushSync();
    expect(columnText(0)).toEqual(['apple', 'fig', 'pear', 'plum']);
    // The same record, three places along.
    expect([...harness.g.selectedRows()]).toEqual([2]);
    expect(attrs('.row', 'aria-selected')).toEqual(['false', 'false', 'false', 'true']);
  });

  it('extends a rectangle of cells with Shift and the arrows', () => {
    gridOptions = { ...gridOptions, cellSelection: 'range' };
    const harness = setup();

    expect(harness.root.getAttribute('aria-multiselectable')).toBe('true');

    press(harness.root, 'ArrowDown', { shiftKey: true });
    expect(harness.g.cellRange()).toEqual({
      anchor: { row: 0, column: 0 },
      focus: { row: 1, column: 0 },
    });

    press(harness.root, 'ArrowRight', { shiftKey: true });
    // The anchor is pinned where Shift was first held; only the focus moves.
    expect(harness.g.cellRange()).toEqual({
      anchor: { row: 0, column: 0 },
      focus: { row: 1, column: 1 },
    });
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 1 });

    expect(cellAt(0, 0)!.getAttribute('aria-selected')).toBe('true');
    expect(cellAt(0, 1)!.getAttribute('aria-selected')).toBe('true');
    expect(cellAt(1, 1)!.getAttribute('aria-selected')).toBe('true');
    expect(cellAt(1, 1)!.getAttribute('data-selected')).toBe('');
    expect(cellAt(2, 0)!.getAttribute('aria-selected')).toBe('false');
    expect(cellAt(0, 2)!.getAttribute('aria-selected')).toBe('false');
  });

  it('extends to the far edge of the grid with Shift and Ctrl', () => {
    gridOptions = { ...gridOptions, cellSelection: 'range' };
    const harness = setup();

    press(harness.root, 'ArrowDown', { shiftKey: true });
    press(harness.root, 'ArrowDown', { shiftKey: true, ctrlKey: true });

    expect(harness.g.cellRange()).toEqual({
      anchor: { row: 0, column: 0 },
      focus: { row: ROW_COUNT - 1, column: 0 },
    });
    // The cell it named had never been rendered, so the scroll came first.
    expect(document.activeElement).toBe(cellAt(ROW_COUNT - 1, 0));

    press(harness.root, 'ArrowRight', { shiftKey: true, ctrlKey: true });
    expect(harness.g.cellRange()!.focus).toEqual({
      row: ROW_COUNT - 1,
      column: COLUMN_COUNT - 1,
    });
  });

  it('never extends the rectangle onto the column header', () => {
    gridOptions = { ...gridOptions, cellSelection: 'range' };
    const harness = setup();

    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowUp', { shiftKey: true, ctrlKey: true });

    // Row zero, not the header: a rectangle with a column header in it is not
    // a rectangle of data.
    expect(harness.g.cellRange()).toEqual({
      anchor: { row: 2, column: 0 },
      focus: { row: 0, column: 0 },
    });
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
    expect(headerCells()[0]!.getAttribute('aria-selected')).toBe(null);
  });

  it('ends the rectangle on any move that is not an extension', () => {
    gridOptions = { ...gridOptions, cellSelection: 'range' };
    const harness = setup();

    press(harness.root, 'ArrowDown', { shiftKey: true });
    expect(harness.g.cellRange()).not.toBe(null);

    press(harness.root, 'ArrowDown');
    expect(harness.g.cellRange()).toBe(null);
    expect(attrs('.cell', 'aria-selected').every((value) => value === 'false')).toBe(true);
  });

  it('drops the rectangle when the rows are re-sorted underneath it', () => {
    byId();
    gridOptions = { ...gridOptions, cellSelection: 'range' };
    const harness = setup();

    press(harness.root, 'ArrowDown', { shiftKey: true });
    press(harness.root, 'ArrowRight', { shiftKey: true });
    expect(harness.g.cellRange()).not.toBe(null);

    // The rows between its corners are somewhere else now, and the reader
    // never asked for whatever is between them today.
    harness.g.toggleSort('c0');
    flushSync();
    expect(harness.g.cellRange()).toBe(null);
  });

  it('leaves Shift alone where there is no rectangle to make', () => {
    const harness = setup();
    press(harness.root, 'ArrowRight', { shiftKey: true });

    expect(harness.instance.handled).toBe(false);
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
    expect(harness.g.cellRange()).toBe(null);
  });

  it('reports a range as the two spans it covers, however it was dragged', () => {
    // A consumer painting the border of a range needs to know which cell is on
    // which edge, and that arithmetic comes out inverted when done by hand.
    expect(rangeBounds({ anchor: { row: 4, column: 3 }, focus: { row: 1, column: 5 } })).toEqual({
      fromRow: 1,
      toRow: 4,
      fromColumn: 3,
      toColumn: 5,
    });
  });

  it('lets a consumer drive both selections from outside', () => {
    byId();
    const chosen = new Signal.State<ReadonlySet<string | number>>(new Set([2]));
    gridOptions = { ...gridOptions, rowSelection: 'multiple', selectedRows: chosen };
    const harness = setup();

    expect(rows()[2]!.getAttribute('aria-selected')).toBe('true');

    harness.g.selectRow(5, true);
    flushSync();
    expect([...chosen.get()].sort()).toEqual([2, 5]);
    expect(rows()[5]!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('a cell still owns its binding once the view is derived', () => {
  it('writes one text node when a value changes under an active sort', () => {
    byId();
    const harness = setup();
    harness.g.toggleSort('c0');
    flushSync();

    const before = cells();
    const texts = before.map((cell) => cell.firstChild);
    reads = [];

    // Column four is no part of the sort, so the view does not even recompute.
    people.get()[3]!.cells[4]!.set('changed');
    flushSync();

    expect(reads).toEqual(['3:4']);
    expect(cellAt(3, 4)!.textContent).toBe('changed');
    expect(cells()).toEqual(before);
    expect(cells().map((cell) => cell.firstChild)).toEqual(texts);
  });

  it('rebuilds no cell when a re-sort leaves the rows where they were', () => {
    byId();
    const harness = setup();

    const before = cells();
    const texts = before.map((cell) => cell.firstChild);
    const rendered = before.map((cell) => cell.textContent);
    reads = [];

    // Ascending is the order they are already in, so every row keeps its key,
    // its index and its offset.
    harness.g.toggleSort('c0');
    flushSync();
    expect(harness.g.sortDirection('c0')).toBe('ascending');

    // Not one accessor ran. The view is a different array holding the same
    // rows in the same places, and a row handed back as the same object sets
    // its own item signal to the value it already had.
    expect(reads).toEqual([]);
    expect(cells()).toEqual(before);
    expect(cells().map((cell) => cell.firstChild)).toEqual(texts);
    expect(cells().map((cell) => cell.textContent)).toEqual(rendered);
  });

  it('re-reads one cell when a sorted value changes without moving its row', () => {
    byId();
    const harness = setup();
    harness.g.toggleSort('c0');
    flushSync();

    const before = cells();
    const texts = before.map((cell) => cell.firstChild);
    reads = [];

    // A value the comparator itself reads, changed so that the order holds.
    people.get()[3]!.cells[0]!.set('r3c0!');
    flushSync();

    // The whole thousand rows were re-compared, and one cell rendered.
    expect(reads).toEqual(['3:0']);
    expect(cellAt(3, 0)!.textContent).toBe('r3c0!');
    expect(cells()).toEqual(before);
    expect(cells().map((cell) => cell.firstChild)).toEqual(texts);
  });

  it('rebuilds no cell in the window when a filter removes rows below it', () => {
    byId();
    const harness = setup();

    const before = cells();
    const texts = before.map((cell) => cell.firstChild);
    reads = [];

    // A row a thousand places below the seven on screen.
    harness.g.setFilter('c0', { type: 'text', value: 'r999c0', operator: 'notEquals' });
    flushSync();

    expect(harness.g.rowCount()).toBe(ROW_COUNT - 1);
    expect(reads).toEqual([]);
    expect(cells()).toEqual(before);
    expect(cells().map((cell) => cell.firstChild)).toEqual(texts);
  });
});

describe('driven from outside', () => {
  it('takes the sort, the filters and the quick filter from signals a consumer holds', () => {
    const sort = new Signal.State<readonly GridSort[]>([
      { columnId: 'c0', direction: 'descending' },
    ]);
    const filters = new Signal.State<ReadonlyMap<string, GridFilter>>(new Map());
    const quick = new Signal.State('');
    gridOptions = { ...gridOptions, sort, filters, quickFilter: quick };
    tableOf(FRUIT);
    const harness = setup();

    // A saved view, restored before the first render.
    expect(columnText(0)).toEqual(['plum', 'pear', 'fig', 'apple']);
    expect(headerCells()[0]!.getAttribute('data-sort')).toBe('descending');

    filters.set(new Map([['c2', { type: 'set', values: ['red'] }]]));
    flushSync();
    expect(columnText(0)).toEqual(['plum', 'pear']);

    quick.set('plum');
    flushSync();
    expect(columnText(0)).toEqual(['plum']);

    // And the grid writes back into the same signals.
    harness.g.toggleSort('c0');
    flushSync();
    expect(sort.get()).toEqual([]);
  });

  it('reports every change to a consumer mirroring the state', () => {
    const sorts: string[] = [];
    const filtered: string[] = [];
    gridOptions = {
      ...gridOptions,
      onSortChange: (sort) => sorts.push(sort.map((entry) => entry.direction).join(',')),
      onFilterChange: (map, quick) => filtered.push(`${[...map.keys()].join(',')}|${quick}`),
    };
    tableOf(FRUIT);
    const harness = setup();

    harness.g.toggleSort('c0');
    harness.g.setSort([]);
    harness.g.setFilter('c1', { type: 'number', value: 5, operator: 'greaterThan' });
    harness.g.setQuickFilter('red');
    harness.g.clearFilters();
    flushSync();

    expect(sorts).toEqual(['ascending', '']);
    expect(filtered).toEqual(['c1|', 'c1|red', '|']);
  });

  it('takes announcements of its own for both', async () => {
    gridOptions = {
      ...gridOptions,
      sortAnnouncement: (sort) =>
        sort.length === 0 ? 'unsorted' : `${sort[0]!.column.header} is ${sort[0]!.direction}`,
      filterAnnouncement: (shown, total) => `${shown}/${total}`,
    };
    tableOf(FRUIT);
    const harness = setup();

    harness.g.toggleSort('c0');
    flushSync();
    expect(await announced()).toContain('Column 0 is ascending');
    resetAnnouncer();

    harness.g.setQuickFilter('red');
    flushSync();
    expect(await announced()).toContain('2/4');
  });

  it('sets a rectangle of cells without the keyboard, and reports it', () => {
    const seen: (GridCellRange | null)[] = [];
    gridOptions = { ...gridOptions, cellSelection: 'range', onCellRangeChange: (r) => seen.push(r) };
    const harness = setup();

    const range = { anchor: { row: 1, column: 1 }, focus: { row: 3, column: 2 } };
    harness.g.setCellRange(range);
    flushSync();

    expect(harness.g.isCellSelected(2, 1)).toBe(true);
    expect(harness.g.isCellSelected(0, 1)).toBe(false);
    expect(rangeContains(range, 3, 2)).toBe(true);
    expect(cellAt(2, 2)!.getAttribute('aria-selected')).toBe('true');
    expect(cellAt(4, 2)!.getAttribute('aria-selected')).toBe('false');

    // Setting the same rectangle again is not a change, and is not reported.
    harness.g.setCellRange({ anchor: { row: 1, column: 1 }, focus: { row: 3, column: 2 } });
    flushSync();
    expect(seen).toEqual([range]);
  });

  it('answers whether a row is selected, and marks it for a stylesheet', () => {
    byId();
    gridOptions = { ...gridOptions, rowSelection: 'multiple' };
    const harness = setup();

    harness.g.selectRow(2);
    harness.g.selectRow(4, true);
    flushSync();

    expect(harness.g.isRowSelected(2)).toBe(true);
    expect(harness.g.isRowSelected(3)).toBe(false);
    expect(attrs('.row', 'data-selected')).toEqual([null, null, '', null, '', null, null]);
  });
});

describe('the cursor and the view', () => {
  it('follows the row the cursor is on even when a consumer put it there', () => {
    // Nothing told the grid this move happened: the row the cursor is on is
    // worked out from the view being replaced, so there is no second copy of
    // it to have gone stale.
    byId();
    const cursor = new Signal.State({ row: 3, column: 0 });
    gridOptions = { ...gridOptions, activeCell: cursor };
    tableOf(FRUIT);
    const harness = setup();

    cursor.set({ row: 3, column: 1 });
    flushSync();

    harness.g.toggleSort('c0');
    flushSync();
    expect(columnText(0)).toEqual(['apple', 'fig', 'pear', 'plum']);
    // `fig` was third and is now second.
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 1 });
    expect(cursor.get()).toEqual({ row: 1, column: 1 });
  });

  it('leaves the cursor where it is when the row under it is filtered away', () => {
    byId();
    tableOf(FRUIT);
    const harness = setup();

    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown');
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 0 });

    // `plum` goes; there is no row left to follow, so the position stands.
    harness.g.setFilter('c0', { type: 'text', value: 'plum', operator: 'notEquals' });
    flushSync();
    expect(columnText(0)).toEqual(['pear', 'apple', 'fig']);
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 0 });
  });

  it('leaves the cursor on the header when the rows move underneath it', () => {
    byId();
    tableOf(FRUIT);
    const harness = setup();

    press(harness.root, 'ArrowUp');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 0 });

    press(harness.root, 'Enter');
    press(harness.root, 'Enter');
    expect(columnText(0)).toEqual(['plum', 'pear', 'fig', 'apple']);
    // Row one is row one whatever the data does, and focus has not left it.
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 0 });
    expect(document.activeElement).toBe(headerCells()[0]);
  });
});

describe('what it says, in the language the application speaks', () => {
  it("takes its sentences from the locale's catalogue, numbers and all", async () => {
    catalogue = {
      gridRowsLeft: '{n} von {m} Zeilen',
      gridAllRows: 'Alle {m} Zeilen',
      gridColumnWidth: '{column}, {n} Pixel',
      gridSortedBy: 'Sortiert nach {terms}',
      gridAscending: '{column} aufsteigend',
      gridDescending: '{column} absteigend',
      gridThen: '{terms}, dann {term}',
      gridNotSorted: 'Nicht sortiert',
    };
    const harness = setup();

    // r1, r10 to r19 and r100 to r199: a hundred and eleven, of a thousand
    // written the way German writes it.
    harness.g.setFilter('c0', { type: 'text', value: 'r1', operator: 'startsWith' });
    flushSync();
    expect(await announced()).toBe('111 von 1.000 Zeilen');
    resetAnnouncer();

    harness.g.clearFilters();
    flushSync();
    expect(await announced()).toBe('Alle 1.000 Zeilen');
    resetAnnouncer();

    harness.g.toggleSort('c0');
    harness.g.toggleSort('c1', true);
    harness.g.toggleSort('c1', true);
    flushSync();
    expect(await announced()).toBe('Sortiert nach Column 0 aufsteigend, dann Column 1 absteigend');
    resetAnnouncer();

    // A plain click on the second of two sorted columns, already descending,
    // takes the order out altogether.
    harness.g.toggleSort('c1');
    flushSync();
    expect(await announced()).toBe('Nicht sortiert');
    resetAnnouncer();

    press(harness.root, 'ArrowUp');
    press(harness.root, 'ArrowRight', { altKey: true });
    expect(await announced()).toBe(`Column 0, ${COLUMN_WIDTH + 16} Pixel`);
  });

  it('says it in English where the catalogue has no word for it', async () => {
    catalogue = { gridRowsLeft: '{n} von {m} Zeilen' };
    const harness = setup();

    harness.g.toggleSort('c0');
    flushSync();
    expect(await announced()).toBe('Sorted by Column 0 ascending');
  });
});

describe('the package', () => {
  it('reports the version it is published as', () => {
    // A constant nothing compares against the manifest drifts from it, and
    // then says the wrong thing to everything that asks.
    const manifest = JSON.parse(
      readFileSync(`${import.meta.dirname}/../package.json`, 'utf8'),
    ) as { version: string };
    expect(VERSION).toBe(manifest.version);
  });
});
