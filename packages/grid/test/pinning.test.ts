/**
 * Pinned columns and pinned rows, driven through a real mounted component.
 *
 * A pinned column is drawn in the same row as every other cell, held at the
 * inline edge by `position: sticky`, so what is worth testing is what the grid
 * tells the page: which region each column is in and its offset there, the
 * styles that hold it, the one list the cursor and every range walk, and that
 * neither scrolling axis reads a pinned cell again. happy-dom lays nothing out
 * and has no sticky positioning, so the styles are asserted as the browser
 * would be handed them, and the scroll the grid asks for as the offset it
 * writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAnnouncer } from '@voltdev/primitives';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import {
  GRID_CELL_ATTRIBUTE,
  GRID_GROUP_ATTRIBUTE,
  GRID_STATE_VERSION,
  HEADER_ROW,
  createCellEditing,
  createEditHistory,
  createExport,
  createGrid,
  createGridClipboard,
  createGridState,
  createGrouping,
  type Grid,
  type GridColumn,
  type GridColumnPin,
  type GridGroupedRow,
  type GridOptions,
  type GridRow,
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
const VIEWPORT_HEIGHT = 100;
const VIEWPORT_WIDTH = 300;

/** Every rendering accessor call, as `row:column`. */
let reads: string[] = [];

function makeRow(id: number, prefix = 'r'): Person {
  return {
    id,
    cells: Array.from(
      { length: COLUMN_COUNT },
      (_, col) => new Signal.State(`${prefix}${id}c${col}`),
    ),
  };
}

function makePeople(count: number): Person[] {
  return Array.from({ length: count }, (_, row) => makeRow(row));
}

/** Twelve columns, `c0` to `c11`, with whatever pins the model gives them. */
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

/** One column pinned to each edge, out of list order: c3 at the start, c7 at the end. */
const START_AND_END = { c3: 'start', c7: 'end' } as const;

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;

let people: Signal.State<readonly Person[]>;
let columns: Signal.State<readonly GridColumn<Person>[]>;
let top: Signal.State<readonly Person[]>;
let bottom: Signal.State<readonly Person[]>;
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
  top = new Signal.State<readonly Person[]>([]);
  bottom = new Signal.State<readonly Person[]>([]);
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

/**
 * The header rowgroup holds the header row and the rows pinned to the top; the
 * footer holds the rows pinned to the bottom. Both are outside the scroller,
 * so a vertical scroll never moves them.
 */
const TEMPLATE = `
  <div class="grid" :ref="grid" :spread="g.gridProps()"
       :keydown="onKey($event)" :focusin="g.onFocusIn($event)">
    <div class="header" :spread="g.headerProps()">
      <div class="header-row" :spread="g.headerRowProps()">
        <div class="th" :for="col in g.columns()" :key="col.key" :spread="g.headerCellProps(col)">{ col.column.header }</div>
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
    <div class="footer" :spread="g.footerProps()">
      <div class="row bottom" :for="row in g.pinnedBottomRows()" :key="row.key" :spread="g.rowProps(row)">
        <div class="cell" :for="col in g.columns()" :key="col.key"
             :spread="g.cellProps(row, col)">{ g.cellValue(row, col) }</div>
      </div>
    </div>
  </div>
`;

interface GridInstance {
  g: Grid<Person>;
  view: GridStateLayer<Person> | null;
  onKey(event: KeyboardEvent): void;
}

interface Harness {
  g: Grid<Person>;
  view: GridStateLayer<Person> | null;
  root: HTMLElement;
  scroller: HTMLElement;
  container: HTMLElement;
  headerRow: HTMLElement;
}

function setup(): Harness {
  @Component({ selector: `v-pinned-grid-${++selectors}`, render: compileTemplate(TEMPLATE) })
  class GridComponent {
    grid = new Signal.State<Element | null>(null);
    scroller = new Signal.State<Element | null>(null);
    container = new Signal.State<Element | null>(null);
    view: GridStateLayer<Person> | null = layer && layer(() => columns.get());
    g: Grid<Person> = createGrid<Person>({
      ...gridOptions,
      grid: () => this.grid.get(),
      scroller: () => this.scroller.get(),
      container: () => this.container.get(),
      rows: () => people.get(),
      columns: () => (this.view === null ? columns.get() : this.view.columns()),
      pinnedTop: () => top.get(),
      pinnedBottom: () => bottom.get(),
      ...(this.view === null ? {} : { onColumnResize: this.view.onColumnResize }),
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
  FakeResizeObserver.deliver([{ target: scroller, block: VIEWPORT_HEIGHT, inline: VIEWPORT_WIDTH }]);

  const instance = handle.instance as unknown as GridInstance;
  return {
    g: instance.g,
    view: instance.view,
    root: host.querySelector<HTMLElement>('.grid')!,
    scroller,
    container: host.querySelector<HTMLElement>('.container')!,
    headerRow: host.querySelector<HTMLElement>('.header-row')!,
  };
}

function userScroll(el: HTMLElement, { top: y = 0, left = 0 } = {}): void {
  el.scrollTop = y;
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

function cellAt(row: number, column: number): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[${GRID_CELL_ATTRIBUTE}="${row},${column}"]`);
}

function headerCells(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.th')];
}

function attrs(selector: string, name: string): (string | null)[] {
  return [...host.querySelectorAll<HTMLElement>(selector)].map((el) => el.getAttribute(name));
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

/** The header cell for a column, by id. */
function headerOf(id: string): HTMLElement {
  return host.querySelector<HTMLElement>(`.th[data-column="${id}"]`)!;
}

/** What each rendered column is: id, region, offset in it, width. */
function layout(g: Grid<Person>): [string, GridColumnPin, number, number][] {
  return g.columns().map((col) => [col.column.id, col.pin ?? null, col.start, col.width]);
}

/** The column ids in the grid's own order, every one of them. */
function order(g: Grid<Person>): string[] {
  return Array.from({ length: g.columnCount() }, (_, i) => g.columnAt(i)!.id);
}

/** Reads of a column, by its id's number. */
function readsOf(column: number): string[] {
  return reads.filter((read) => read.endsWith(`:${column}`));
}

// ---------------------------------------------------------------------------
// Pinned columns
// ---------------------------------------------------------------------------

describe('columns pinned to an inline edge', () => {
  beforeEach(() => {
    columns.set(makeColumns(START_AND_END));
  });

  it('puts the start-pinned first and the end-pinned last, whatever order the list is in', () => {
    const harness = setup();

    expect(order(harness.g)).toEqual([
      'c3', 'c0', 'c1', 'c2', 'c4', 'c5', 'c6', 'c8', 'c9', 'c10', 'c11', 'c7',
    ]);
    expect(harness.g.columnIndex('c7')).toBe(COLUMN_COUNT - 1);
    // The ARIA count is of that list: the end-pinned column is column twelve
    // of twelve, rendered fifth.
    expect(attrs('.th', 'data-column')).toEqual(['c3', 'c0', 'c1', 'c2', 'c4', 'c7']);
    expect(attrs('.th', 'aria-colindex')).toEqual(['1', '2', '3', '4', '5', '12']);
  });

  it('says which region each column is in and where in it, and nothing for an unpinned one', () => {
    const harness = setup();

    // Each offset is from the start of the column's own region: the scrolling
    // columns start at nought after the hundred pixels pinned before them.
    expect(layout(harness.g)).toEqual([
      ['c3', 'start', 0, 100],
      ['c0', null, 0, 100],
      ['c1', null, 100, 100],
      ['c2', null, 200, 100],
      ['c4', null, 300, 100],
      ['c7', 'end', 0, 100],
    ]);
    expect('pin' in harness.g.columns()[1]!).toBe(false);
  });

  it('holds a pinned cell at its edge with sticky offsets, and marks it', () => {
    const harness = setup();
    const row = harness.g.rows()[0]!;
    const [first, , , , , last] = harness.g.columns();

    expect(harness.g.cellProps(row, first!).style).toStrictEqual({
      width: '100px',
      position: 'sticky',
      'inset-inline-start': '0px',
    });
    expect(harness.g.cellProps(row, last!).style).toStrictEqual({
      width: '100px',
      position: 'sticky',
      'inset-inline-end': '0px',
    });
    expect(harness.g.headerCellProps(first!).style).toStrictEqual(
      harness.g.cellProps(row, first!).style,
    );
    expect(attrs('.th', 'data-pinned')).toEqual(['start', null, null, null, null, 'end']);
    expect(cellAt(0, 0)!.getAttribute('data-pinned')).toBe('start');
    expect(cellAt(0, 11)!.style.getPropertyValue('inset-inline-end')).toBe('0px');
  });

  it('offsets a second pinned column by the first, from its own edge', () => {
    columns.set(makeColumns({ c3: 'start', c5: 'start', c1: 'end', c7: 'end' }));
    setup();

    expect(attrs('.th', 'data-column')).toEqual(['c3', 'c5', 'c0', 'c2', 'c4', 'c1', 'c7']);
    // The end region is c1 then c7: c7 sits at the very edge, c1 a column in.
    expect(headerCells().map((th) => th.getAttribute('style'))).toEqual([
      'width: 100px; position: sticky; inset-inline-start: 0px;',
      'width: 100px; position: sticky; inset-inline-start: 100px;',
      'width: 100px;',
      'width: 100px;',
      'width: 100px;',
      'width: 100px; position: sticky; inset-inline-end: 100px;',
      'width: 100px; position: sticky; inset-inline-end: 0px;',
    ]);
  });

  it('never windows a pinned column away, and moves the scrolling ones without a transform', () => {
    const harness = setup();
    expect(harness.container.style.transform).toBe('translate(0px, 0px)');
    expect(harness.container.style.getPropertyValue('padding-inline-start')).toBe('0px');
    expect(harness.headerRow.style.getPropertyValue('margin-inline-start')).toBe('0px');
    expect(harness.headerRow.style.transform).toBe('');

    userScroll(harness.scroller, { left: 500 });

    // Columns three to nine of the list are the window; the two pinned ones
    // are outside it and rendered all the same.
    expect(harness.g.columns().map((col) => col.index)).toEqual([0, 3, 4, 5, 6, 7, 8, 9, 11]);
    // A horizontal transform between a sticky cell and the scroller would
    // carry the cell with it, so the window is moved by padding: the first
    // scrolling column rendered starts two hundred pixels into its region.
    expect(harness.container.style.transform).toBe('translate(0px, 0px)');
    expect(harness.container.style.getPropertyValue('padding-inline-start')).toBe('200px');
    // The header row is outside the scroller, so it is moved by the scroll as
    // well as by the window.
    expect(harness.headerRow.style.getPropertyValue('margin-inline-start')).toBe('-300px');

    // At the far end the end-pinned column is inside the window too, and is
    // still rendered once.
    userScroll(harness.scroller, { left: 900 });
    expect(harness.g.columns().map((col) => col.index)).toEqual([0, 7, 8, 9, 10, 11]);
    expect(harness.container.style.getPropertyValue('padding-inline-start')).toBe('600px');
    expect(harness.headerRow.style.getPropertyValue('margin-inline-start')).toBe('-300px');
  });

  it('reads no pinned cell again, and hands back the same pinned columns, on a horizontal scroll', () => {
    const harness = setup();
    const [first] = harness.g.columns();
    const last = harness.g.columns().at(-1)!;
    const styles = [headerOf('c3').getAttribute('style'), headerOf('c7').getAttribute('style')];
    reads = [];

    userScroll(harness.scroller, { left: 500 });
    userScroll(harness.scroller, { left: 900 });

    expect(harness.g.columns()[0]).toBe(first);
    expect(harness.g.columns().at(-1)).toBe(last);
    expect(readsOf(3)).toEqual([]);
    expect(readsOf(7)).toEqual([]);
    expect([headerOf('c3').getAttribute('style'), headerOf('c7').getAttribute('style')]).toEqual(
      styles,
    );
  });

  it('tells the browser the pinned widths, so focus it moves itself lands clear of them', () => {
    const harness = setup();
    expect(harness.g.bodyProps().style).toStrictEqual({
      'overflow-anchor': 'none',
      'scroll-padding-inline-start': '100px',
      'scroll-padding-inline-end': '100px',
    });
  });

  it('scrolls a scrolling column clear of the pinned ones, and never scrolls for a pinned one', () => {
    const harness = setup();

    // Column six of the list is c6, from 600 to 700 in the whole width. With
    // a hundred pixels pinned at each edge only a hundred are left to show it
    // in, so the scroll that brings it out from under c7 is 500.
    harness.g.focusCell({ row: 0, column: 6 });
    flushSync();
    expect(harness.scroller.scrollLeft).toBe(500);
    expect(document.activeElement).toBe(cellAt(0, 6));

    // c0 is at 100: out from under c3 means scrolled back to nought.
    press(harness.root, 'Home');
    expect(harness.scroller.scrollLeft).toBe(500);
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
    press(harness.root, 'ArrowRight');
    expect(harness.scroller.scrollLeft).toBe(0);

    // A pinned column is on screen wherever the scroll is.
    harness.g.focusCell({ row: 0, column: 6 });
    flushSync();
    press(harness.root, 'End');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: COLUMN_COUNT - 1 });
    expect(harness.scroller.scrollLeft).toBe(500);
    expect(document.activeElement).toBe(cellAt(0, COLUMN_COUNT - 1));
  });

  it('keeps the tab stop on a pinned column the window has scrolled past', () => {
    const harness = setup();
    harness.g.focusCell({ row: 0, column: 0 });
    flushSync();

    userScroll(harness.scroller, { left: 900 });

    expect(cellAt(0, 0)!.getAttribute('tabindex')).toBe('0');
  });

  it('walks the cursor and a range through the columns in the order they are drawn', () => {
    gridOptions = { ...gridOptions, cellSelection: 'range' };
    const harness = setup();
    harness.g.focusCell({ row: 0, column: 0 });
    flushSync();

    press(harness.root, 'ArrowRight');
    expect(document.activeElement!.getAttribute('data-column')).toBe('c0');
    press(harness.root, 'ArrowLeft');
    expect(document.activeElement!.getAttribute('data-column')).toBe('c3');

    press(harness.root, 'ArrowRight', { shiftKey: true });
    press(harness.root, 'ArrowRight', { shiftKey: true });
    expect(harness.g.cellRange()).toEqual({
      anchor: { row: 0, column: 0 },
      focus: { row: 0, column: 2 },
    });
    expect(
      [...host.querySelectorAll('.row')][0]!.querySelectorAll('[data-selected]').length,
    ).toBe(3);
    expect(
      [...[...host.querySelectorAll('.row')][0]!.querySelectorAll('[data-selected]')].map((el) =>
        el.getAttribute('data-column'),
      ),
    ).toEqual(['c3', 'c0', 'c1']);

    press(harness.root, 'End', { shiftKey: true });
    expect(harness.g.isCellSelected(0, COLUMN_COUNT - 1)).toBe(true);
    expect(cellAt(0, COLUMN_COUNT - 1)!.hasAttribute('data-selected')).toBe(true);
  });

  it('pins and unpins a column by id, and the cursor stays on its column', () => {
    const changes: string[] = [];
    gridOptions = {
      ...gridOptions,
      onColumnPinChange: (pins) => changes.push(JSON.stringify([...pins])),
    };
    const harness = setup();
    harness.g.focusCell({ row: 0, column: 5 });
    flushSync();
    expect(harness.g.columnAt(5)!.id).toBe('c5');

    harness.g.pinColumn('c5', 'start');
    flushSync();

    // Second of the start region, in the order of the caller's list.
    expect(order(harness.g).slice(0, 3)).toEqual(['c3', 'c5', 'c0']);
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 1 });
    expect(harness.g.columns()[1]).toMatchObject({ pin: 'start', start: 100 });
    expect(changes).toEqual(['[["c5","start"]]']);

    // A pin the model declared is overruled the same way.
    harness.g.pinColumn('c3', null);
    flushSync();
    expect(order(harness.g)).toEqual([
      'c5', 'c0', 'c1', 'c2', 'c3', 'c4', 'c6', 'c8', 'c9', 'c10', 'c11', 'c7',
    ]);
    expect(changes.at(-1)).toBe('[["c5","start"],["c3",null]]');

    // Asking for what is already so, or for a column there is not, is nothing.
    harness.g.pinColumn('c5', 'start');
    harness.g.pinColumn('nope', 'end');
    expect(changes).toHaveLength(2);
    expect(harness.g.columnPin('c5')).toBe('start');
    expect(harness.g.columnPin('c3')).toBe(null);
    expect(harness.g.columnPin('c7')).toBe('end');
    expect(harness.g.columnPin('nope')).toBe(undefined);
  });

  it('takes the pins from a signal the caller holds, and writes into it', () => {
    const pins = new Signal.State<ReadonlyMap<string, GridColumnPin>>(new Map([['c1', 'end']]));
    gridOptions = { ...gridOptions, columnPins: pins };
    const harness = setup();

    expect(order(harness.g).slice(-2)).toEqual(['c1', 'c7']);

    pins.set(new Map());
    flushSync();
    expect(order(harness.g).slice(-2)).toEqual(['c11', 'c7']);

    harness.g.pinColumn('c0', 'end');
    expect([...pins.get()]).toEqual([['c0', 'end']]);
  });
});

// ---------------------------------------------------------------------------
// Pinned rows
// ---------------------------------------------------------------------------

describe('rows pinned to the top and the bottom', () => {
  beforeEach(() => {
    top.set([makeRow(5000, 't'), makeRow(5001, 't')]);
    bottom.set([makeRow(9000, 'b')]);
  });

  it('renders them outside the window, keyed and placed like any row', () => {
    const harness = setup();

    expect(harness.g.pinnedTopRows().map(({ index, key, start, size, pin }) => [index, key, start, size, pin])).toEqual([
      [0, 5000, 0, 20, 'top'],
      [1, 5001, 20, 20, 'top'],
    ]);
    expect(harness.g.pinnedBottomRows().map(({ index, key, start, size, pin }) => [index, key, start, size, pin])).toEqual([
      [ROW_COUNT + 2, 9000, 0, 20, 'bottom'],
    ]);
    // The scrolling rows come after the pinned top ones in the one list.
    expect(harness.g.rows()[0]).toMatchObject({ index: 2, key: 0 });
    expect('pin' in harness.g.rows()[0]!).toBe(false);
    expect(host.querySelector('.top .cell')!.textContent).toBe('t5000c0');
    expect(host.querySelector('.bottom .cell')!.textContent).toBe('b9000c0');
  });

  it('counts them in the rows a screen reader is told about', () => {
    const harness = setup();

    expect(harness.root.getAttribute('aria-rowcount')).toBe(String(ROW_COUNT + 3 + 1));
    expect(attrs('.top', 'aria-rowindex')).toEqual(['2', '3']);
    expect(host.querySelector('.container .row')!.getAttribute('aria-rowindex')).toBe('4');
    expect(attrs('.bottom', 'aria-rowindex')).toEqual([String(ROW_COUNT + 4)]);
    // A pinned row is not the virtualizer's to measure or place.
    expect(attrs('.top', 'data-volt-virtual-index')).toEqual([null, null]);
    expect(host.querySelector('.container .row')!.getAttribute('data-volt-virtual-index')).toBe('0');
    expect(attrs('.top', 'data-pinned')).toEqual(['top', 'top']);
    expect(attrs('.bottom', 'data-pinned')).toEqual(['bottom']);
  });

  it('answers for them by position and by key', () => {
    const harness = setup();

    expect(harness.g.rowCount()).toBe(ROW_COUNT + 3);
    expect(harness.g.sourceRowCount()).toBe(ROW_COUNT);
    expect(harness.g.rowAt(1)!.id).toBe(5001);
    expect(harness.g.rowAt(2)!.id).toBe(0);
    expect(harness.g.rowAt(ROW_COUNT + 2)!.id).toBe(9000);
    expect(harness.g.rowIndex(9000)).toBe(ROW_COUNT + 2);
    expect(harness.g.rowIndex(5000)).toBe(0);
    expect(harness.g.rowIndex(3)).toBe(5);
  });

  it('reaches the pinned row above from the first scrolling row, and the header above that', () => {
    const harness = setup();
    harness.g.focusCell({ row: 2, column: 0 });
    flushSync();

    press(harness.root, 'ArrowUp');
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 0 });
    expect(document.activeElement!.textContent).toBe('t5001c0');
    press(harness.root, 'ArrowUp');
    press(harness.root, 'ArrowUp');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 0 });

    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown');
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 0 });
  });

  it('reaches the pinned row below from the last scrolling row, and ends there', () => {
    const harness = setup();

    press(harness.root, 'End', { ctrlKey: true });
    expect(harness.g.activeCell()).toEqual({ row: ROW_COUNT + 2, column: COLUMN_COUNT - 1 });
    expect(document.activeElement!.textContent).toBe(`b9000c${COLUMN_COUNT - 1}`);

    press(harness.root, 'ArrowUp');
    expect(harness.g.activeCell()).toEqual({ row: ROW_COUNT + 1, column: COLUMN_COUNT - 1 });
    expect(document.activeElement!.textContent).toBe(`r${ROW_COUNT - 1}c${COLUMN_COUNT - 1}`);
    press(harness.root, 'ArrowDown');
    expect(document.activeElement!.textContent).toBe(`b9000c${COLUMN_COUNT - 1}`);
  });

  it('pages by pixels in the view, counted past the rows pinned above', () => {
    top.set([makeRow(5000, 't')]);
    bottom.set([]);
    // Twenty for an even id, forty for an odd one: the view runs 0, 20, 60,
    // 80, 120, 140, 180 down its first seven rows.
    gridOptions = { ...gridOptions, rowHeight: (row: Person) => (row.id % 2 === 0 ? 20 : 40) };
    const harness = setup();

    // Position 6 is row 5 of the view, at 140. A viewport up is 40, and the
    // nearest row starting below that is row 2 of the view, at 60: position 3.
    harness.g.focusCell({ row: 6, column: 0 });
    flushSync();
    press(harness.root, 'PageUp');
    expect(harness.g.activeCell()).toEqual({ row: 3, column: 0 });
    // From 60, a viewport up is above the view, and above the pinned row too.
    press(harness.root, 'PageUp');
    expect(harness.g.activeCell()).toEqual({ row: HEADER_ROW, column: 0 });

    // From the pinned row a page goes into the view from its top: the first
    // screen ends in row 3 of the view, which is position 4.
    harness.g.focusCell({ row: 0, column: 0 });
    flushSync();
    press(harness.root, 'PageDown');
    expect(harness.g.activeCell()).toEqual({ row: 4, column: 0 });
  });

  it('stays where it is on a vertical scroll, reading no pinned cell, and scrolls nothing to focus one', () => {
    const harness = setup();
    const before = harness.g.pinnedTopRows();
    reads = [];

    userScroll(harness.scroller, { top: 10_000 });

    expect(harness.g.pinnedTopRows()).toBe(before);
    expect(reads.filter((read) => read.startsWith('5000:') || read.startsWith('9000:'))).toEqual([]);
    expect(host.querySelectorAll('.top').length).toBe(2);

    harness.g.focusCell({ row: 1, column: 0 });
    flushSync();
    expect(harness.scroller.scrollTop).toBe(10_000);
    expect(document.activeElement!.textContent).toBe('t5001c0');
    // The tab stop is the pinned cell, rendered, and not one clamped into the
    // window.
    expect(cellAt(1, 0)!.getAttribute('tabindex')).toBe('0');
  });

  it('scrolls a scrolling row into view by its place in the window, not in the list', () => {
    const harness = setup();

    // Row 500 of the data is position 502.
    harness.g.scrollToCell({ row: 502, column: 0 });
    flushSync();
    expect(harness.scroller.scrollTop).toBe(500 * ROW_HEIGHT + ROW_HEIGHT - VIEWPORT_HEIGHT);
  });

  it('is neither sorted nor filtered, and the filter counts only the rows it filters', async () => {
    const harness = setup();

    harness.g.setFilter('c0', { type: 'text', value: 'r1', operator: 'startsWith' });
    flushSync();
    expect(await announced()).toBe(`111 of ${ROW_COUNT} rows`);

    // r1, r10 to r19, r100 to r199: 111 rows.
    expect(harness.g.rowCount()).toBe(111 + 3);
    expect(harness.g.rowAt(0)!.id).toBe(5000);
    expect(harness.g.pinnedBottomRows()[0]!.index).toBe(113);
    expect(harness.g.rowIndex(9000)).toBe(113);

    harness.g.toggleSort('c0');
    harness.g.toggleSort('c0');
    flushSync();
    expect(harness.g.rowAt(0)!.id).toBe(5000);
    expect(harness.g.rowAt(113)!.id).toBe(9000);
  });

  it('follows the cursor row through a sort, by its place after the pinned rows', () => {
    const harness = setup();
    harness.g.focusCell({ row: 7, column: 0 });
    flushSync();
    expect(harness.g.rowAt(7)!.id).toBe(5);

    harness.g.toggleSort('c0');
    harness.g.toggleSort('c0');
    flushSync();

    const row = harness.g.activeCell().row;
    expect(row).not.toBe(7);
    expect(harness.g.rowAt(row)!.id).toBe(5);
    expect(row).toBe(harness.g.rowIndex(5));
    expect(document.activeElement).toBe(cellAt(row, 0));
  });

  it('keeps the cursor on a pinned row when the rows under it change', () => {
    const harness = setup();
    harness.g.focusCell({ row: ROW_COUNT + 2, column: 0 });
    flushSync();

    harness.g.setFilter('c0', { type: 'text', value: 'r1', operator: 'startsWith' });
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: 113, column: 0 });
    expect(harness.g.rowAt(113)!.id).toBe(9000);
  });

  it('follows the cursor row when a row is pinned above it', () => {
    const harness = setup();
    harness.g.focusCell({ row: 7, column: 0 });
    flushSync();
    expect(harness.g.rowAt(7)!.id).toBe(5);

    top.set([...top.get(), makeRow(5002, 't')]);
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: 8, column: 0 });
    expect(document.activeElement).toBe(cellAt(8, 0));
    expect(document.activeElement!.textContent).toBe('r5c0');
  });

  it('opens a pinned cell for editing by its position, as any cell', () => {
    const harness = setup();
    const committed: string[] = [];
    const editing = createCellEditing<Person>({
      grid: () => harness.g,
      editors: () => ({ c0: {} }),
      onCommit: (change) => committed.push(`${String(change.rowKey)}:${String(change.value)}`),
    });

    expect(editing.beginAt({ row: 1, column: 0 })).toBe(true);
    expect(editing.session()).toMatchObject({ rowKey: 5001, columnId: 'c0' });
    editing.setDraft('changed');
    expect(editing.commit()).toBe(true);
    expect(committed).toEqual(['5001:changed']);
  });

  it('selects a pinned row as it selects any', () => {
    gridOptions = { ...gridOptions, rowSelection: 'multiple' };
    const harness = setup();
    harness.g.focusCell({ row: 0, column: 0 });
    flushSync();

    press(harness.root, ' ');

    expect([...harness.g.selectedRows()]).toEqual([5000]);
    expect(host.querySelector('.top')!.getAttribute('aria-selected')).toBe('true');
  });

  it('moves the pinned rows with a horizontal scroll, as the header row is moved', () => {
    const harness = setup();
    userScroll(harness.scroller, { left: 500 });

    const pinnedTop = host.querySelector<HTMLElement>('.top')!;
    expect(pinnedTop.style.transform).toBe(harness.headerRow.style.transform);
    expect(pinnedTop.style.transform).toBe('translateX(-200px)');
    expect(pinnedTop.style.height).toBe('20px');
    expect(host.querySelector<HTMLElement>('.bottom')!.style.transform).toBe('translateX(-200px)');

    columns.set(makeColumns(START_AND_END));
    flushSync();
    expect(pinnedTop.style.getPropertyValue('margin-inline-start')).toBe(
      harness.headerRow.style.getPropertyValue('margin-inline-start'),
    );
  });

  it('gives the footer the header rowgroup clipping', () => {
    const harness = setup();
    expect(harness.g.footerProps()).toStrictEqual(harness.g.headerProps());
  });
});

// ---------------------------------------------------------------------------
// Export and the clipboard
// ---------------------------------------------------------------------------

describe('export and the clipboard walk what is drawn', () => {
  beforeEach(() => {
    columns.set(makeColumns(START_AND_END));
    people.set(makePeople(3));
    top.set([makeRow(5000, 't')]);
    bottom.set([makeRow(9000, 'b')]);
  });

  it('exports the columns start-pinned first and the rows pinned top first', async () => {
    const harness = setup();
    const exporter = createExport<Person>({
      grid: () => harness.g,
      columns: () => makeColumns(),
    });

    const text = await (await exporter.csv()).blob.text();
    const lines = text.split('\r\n').filter((line) => line !== '');
    expect(lines[0]).toBe(
      'Column 3,Column 0,Column 1,Column 2,Column 4,Column 5,Column 6,Column 8,Column 9,Column 10,Column 11,Column 7',
    );
    expect(lines.map((line) => line.split(',')[0])).toEqual([
      'Column 3', 't5000c3', 'r0c3', 'r1c3', 'r2c3', 'b9000c3',
    ]);
  });

  it('copies a range in the order it is drawn', async () => {
    gridOptions = { ...gridOptions, cellSelection: 'range' };
    let held = '';
    const clipboard = {
      write: async (items: readonly { data: Record<string, Blob> }[]): Promise<void> => {
        held = await items[0]!.data['text/plain']!.text();
      },
    };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    const view = window as unknown as { ClipboardItem: unknown };
    const original = view.ClipboardItem;
    view.ClipboardItem = class {
      constructor(readonly data: Record<string, Blob>) {}
    };
    restores.push(() => {
      view.ClipboardItem = original;
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });

    const harness = setup();
    const copier = createGridClipboard<Person>({
      grid: () => harness.g,
      columns: () => makeColumns(),
      getRowKey: (row) => row.id,
      onPaste: () => {},
    });
    // From the pinned top row across into the data, and from the start-pinned
    // column into the first scrolling one.
    harness.g.setCellRange({ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } });

    await copier.copy();

    expect(held).toBe('t5000c3\tt5000c0\nr0c3\tr0c0');
  });
});

// ---------------------------------------------------------------------------
// The saved view
// ---------------------------------------------------------------------------

describe('pins in the saved view', () => {
  let pins: Signal.State<ReadonlyMap<string, GridColumnPin>>;

  beforeEach(() => {
    pins = new Signal.State<ReadonlyMap<string, GridColumnPin>>(new Map());
    gridOptions = { ...gridOptions, columnPins: pins };
    layer = (list) => createGridState<Person>({ grid: () => null, columns: list, columnPins: pins });
  });

  it('is written as version 2', () => {
    expect(GRID_STATE_VERSION).toBe(2);
    const harness = setup();
    expect(harness.view!.state().version).toBe(2);
  });

  it('saves a pin only where the reader chose one, with the columns in the order drawn', () => {
    columns.set(makeColumns({ c3: 'start' }));
    const harness = setup();
    expect(harness.view!.state().columns.slice(0, 2)).toEqual([{ id: 'c3' }, { id: 'c0' }]);

    harness.g.pinColumn('c5', 'end');
    harness.g.pinColumn('c3', null);
    flushSync();

    const saved = harness.view!.state().columns;
    expect(saved.map((column) => column.id)).toEqual([
      'c0', 'c1', 'c2', 'c3', 'c4', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c5',
    ]);
    expect(saved.find((column) => column.id === 'c3')).toEqual({ id: 'c3', pin: null });
    expect(saved.find((column) => column.id === 'c5')).toEqual({ id: 'c5', pin: 'end' });
    expect(JSON.parse(JSON.stringify(harness.view!.state()))).toEqual(harness.view!.state());
  });

  it('restores the pins a state saved', () => {
    const harness = setup();

    const result = harness.view!.apply({
      version: 2,
      columns: [{ id: 'c9', pin: 'start' }, { id: 'c0' }, { id: 'c1', pin: 'end' }],
    });
    flushSync();

    expect(result).toEqual({ applied: true });
    expect([...pins.get()]).toEqual([['c9', 'start'], ['c1', 'end']]);
    expect(order(harness.g)[0]).toBe('c9');
    expect(order(harness.g).at(-1)).toBe('c1');
    expect(harness.g.columns()[0]!.pin).toBe('start');
  });

  it('reads a version-1 state as one that pins nothing', () => {
    const harness = setup();
    harness.g.pinColumn('c5', 'start');
    flushSync();

    // Version 1 had no pins, so a pin in one was put there by hand.
    const ids = ['c2', 'c5', 'c0', 'c1', 'c3', 'c4', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11'];
    const result = harness.view!.apply({
      version: 1,
      columns: ids.map((id) =>
        id === 'c5' ? { id, pin: 'start' } : id === 'c0' ? { id, width: 180 } : { id },
      ),
    });
    flushSync();

    expect(result).toEqual({ applied: true });
    expect(pins.get().size).toBe(0);
    expect(order(harness.g).slice(0, 3)).toEqual(['c2', 'c5', 'c0']);
    expect(harness.g.columns().some((col) => col.pin !== undefined)).toBe(false);
    expect(harness.g.columnWidth('c0')).toBe(180);
  });

  it('refuses a state newer than it reads', () => {
    const harness = setup();
    expect(harness.view!.apply({ version: 3, columns: [] })).toEqual({
      applied: false,
      reason: 'newer-version',
      version: 3,
    });
  });

  it('pins a column moved into a pinned region, and unpins one moved out of it', () => {
    columns.set(makeColumns(START_AND_END));
    const harness = setup();
    const view = harness.view!;
    expect(view.allColumns().map((column) => column.id).slice(0, 2)).toEqual(['c3', 'c0']);

    // Before the start-pinned column is inside the start region.
    view.moveColumn('c1', 0);
    flushSync();
    expect(pins.get().get('c1')).toBe('start');
    expect(order(harness.g).slice(0, 3)).toEqual(['c1', 'c3', 'c0']);

    // Past the last scrolling column, among the end-pinned, is the end region.
    view.moveColumn('c3', COLUMN_COUNT - 1);
    flushSync();
    expect(pins.get().get('c3')).toBe('end');
    expect(order(harness.g).slice(-2)).toEqual(['c7', 'c3']);

    // And the scrolling region in between.
    view.moveColumn('c1', 4);
    flushSync();
    expect(pins.get().get('c1')).toBe(null);
    expect(harness.g.columnPin('c1')).toBe(null);
    expect(view.state().columns.find((column) => column.id === 'c1')).toEqual({ id: 'c1', pin: null });
  });

  it('keeps the region a column was in when it is moved to the edge of it', () => {
    columns.set(makeColumns({ c3: 'start', c5: 'start', c7: 'end' }));
    const harness = setup();
    const view = harness.view!;
    expect(order(harness.g).slice(0, 4)).toEqual(['c3', 'c5', 'c0', 'c1']);

    // Dropped straight after c5: the last of the start region, or the first of
    // the scrolling one. c2 was scrolling, and so it stays.
    view.moveColumn('c2', 2);
    flushSync();
    expect(pins.get().size).toBe(0);
    expect(order(harness.g).slice(0, 4)).toEqual(['c3', 'c5', 'c2', 'c0']);

    // The same place for c3, which was start-pinned, keeps it pinned.
    view.moveColumn('c3', 1);
    flushSync();
    expect(pins.get().size).toBe(0);
    expect(order(harness.g).slice(0, 4)).toEqual(['c5', 'c3', 'c2', 'c0']);

    // And the front of a grid with nothing pinned at the start is the front of
    // the scrolling columns, not a start region of one.
    view.moveColumn('c3', 5);
    view.moveColumn('c5', 5);
    view.moveColumn('c9', 0);
    flushSync();
    expect(pins.get().get('c9')).toBe(undefined);
    expect(order(harness.g)[0]).toBe('c9');
    expect(harness.g.columnPin('c9')).toBe(null);
  });

  it('pins through the columns it hands out, where the grid is not given the signal', () => {
    gridOptions = { rowHeight: ROW_HEIGHT, label: 'People', getRowKey: (row) => row.id };
    layer = (list) => createGridState<Person>({ grid: () => null, columns: list });
    const harness = setup();

    columns.set(makeColumns(START_AND_END));
    flushSync();
    // In front of the start-pinned c3 is the start region.
    harness.view!.moveColumn('c4', 0);
    flushSync();

    expect(harness.view!.columns()[0]).toMatchObject({ id: 'c4', pin: 'start' });
    expect(order(harness.g).slice(0, 3)).toEqual(['c4', 'c3', 'c0']);
    expect(harness.g.columns()[0]).toMatchObject({ pin: 'start', start: 0 });
    expect(harness.view!.state().columns[0]).toEqual({ id: 'c4', pin: 'start' });
  });
});

// ---------------------------------------------------------------------------
// Nothing pinned
// ---------------------------------------------------------------------------

describe('a grid with nothing pinned is what it was', () => {
  it('hands out the same props, byte for byte', () => {
    const harness = setup();
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
    expect(harness.g.bodyProps()).toStrictEqual({
      style: { 'overflow-anchor': 'none' },
      tabindex: undefined,
      role: 'rowgroup',
    });
    const header = harness.g.headerCellProps(col);
    expect(Object.keys(header)).toEqual([
      GRID_CELL_ATTRIBUTE, 'role', 'aria-colindex', 'tabindex', 'aria-sort', 'data-active',
      'data-sort', 'data-sort-index', 'data-filtered', 'data-column', 'style',
    ]);
    expect(header.style).toStrictEqual({ width: '100px' });
    const cell = harness.g.cellProps(row, col);
    expect(Object.keys(cell)).toEqual([
      GRID_CELL_ATTRIBUTE, 'role', 'aria-colindex', 'tabindex', 'aria-selected', 'data-active',
      'data-selected', 'data-column', 'style',
    ]);
    expect(cell.style).toStrictEqual({ width: '100px' });
    expect(Object.keys(harness.g.gridProps())).toEqual([
      'aria-rowcount', 'aria-colcount', 'role', 'aria-label', 'aria-multiselectable', 'tabindex',
    ]);
    expect(harness.g.gridProps()['aria-rowcount']).toBe(String(ROW_COUNT + 1));
  });

  it('moves the window and the header with the transforms it always did', () => {
    const harness = setup();
    userScroll(harness.scroller, { top: 500, left: 500 });
    expect(harness.container.style.transform).toBe('translate(300px, 460px)');
    expect(harness.container.style.getPropertyValue('padding-inline-start')).toBe('');
    expect(harness.headerRow.style.transform).toBe('translateX(-200px)');
    expect(harness.g.columns().map((col) => col.start)).toEqual([300, 400, 500, 600, 700, 800, 900]);
  });

  it('hands the caller their own column list back, as the order it draws', () => {
    const harness = setup();
    expect(order(harness.g)).toEqual(columns.get().map((column) => column.id));
    expect(harness.g.columnAt(0)).toBe(columns.get()[0]);
  });
});

// ---------------------------------------------------------------------------
// Pinning meets the rest of the grid
// ---------------------------------------------------------------------------

/** A grouped grid of two groups, east and west, with one row pinned above them. */
const GROUPED_TEMPLATE = `
  <div class="grid" :ref="grid" :spread="g.gridProps()" :keydown="onKey($event)" :focusin="g.onFocusIn($event)">
    <div :spread="g.headerProps()">
      <div :spread="g.headerRowProps()">
        <div :for="col in g.columns()" :key="col.key" :spread="g.headerCellProps(col)">{ col.column.header }</div>
      </div>
      <div class="row top" :for="row in g.pinnedTopRows()" :key="row.key" :spread="rowProps(row)">
        <div :for="col in g.columns()" :key="col.key" :spread="g.cellProps(row, col)">{ g.cellValue(row, col) }</div>
      </div>
    </div>
    <div class="body" :ref="scroller" :spread="g.bodyProps()">
      <div :spread="g.sizerProps()">
        <div :ref="container" :spread="g.containerProps()">
          <div class="row" :for="row in g.rows()" :key="row.key" :spread="rowProps(row)">
            <div :for="col in g.columns()" :key="col.key" :spread="g.cellProps(row, col)">{ g.cellValue(row, col) }</div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

describe('pinning meets the rest of the grid', () => {
  it('hands a column pinned where it already stood its region, and holds it there', () => {
    const harness = setup();
    expect(harness.g.columns()[0]!.pin).toBe(undefined);

    // The first column pinned to the start: the same place, offset and width.
    harness.g.pinColumn('c0', 'start');
    flushSync();

    expect(order(harness.g)).toEqual(columns.get().map((column) => column.id));
    expect(harness.g.columns()[0]).toMatchObject({ index: 0, start: 0, width: 100, pin: 'start' });
    expect(cellAt(0, 0)!.getAttribute('data-pinned')).toBe('start');
    expect(cellAt(0, 0)!.style.position).toBe('sticky');
  });

  it('tells the browser each edge by its own width', () => {
    columns.set(makeColumns({ c3: 'start', c5: 'start', c7: 'end' }));
    const harness = setup();
    expect(harness.g.bodyProps().style).toMatchObject({
      'scroll-padding-inline-start': '200px',
      'scroll-padding-inline-end': '100px',
    });
  });

  it('shows the start of a scrolling column wider than the band between the pinned ones', () => {
    columns.set(makeColumns(START_AND_END));
    const harness = setup();
    harness.g.resizeColumn('c5', 250);
    flushSync();

    // c5 runs from 500 to 750 of the whole width, and the band between c3 and
    // c7 is a hundred pixels: its start goes just clear of c3.
    harness.g.focusCell({ row: 0, column: 5 });
    flushSync();
    expect(harness.scroller.scrollLeft).toBe(400);
  });

  it('re-sorts nothing for a pin that moves no column', () => {
    let sorted = 0;
    columns.set(
      makeColumns(START_AND_END).map((column) =>
        column.id === 'c1'
          ? {
              ...column,
              sortValue: (row: Person) => {
                sorted++;
                return row.cells[1]!.get();
              },
            }
          : column,
      ),
    );
    const pins = new Signal.State<ReadonlyMap<string, GridColumnPin>>(new Map());
    gridOptions = { ...gridOptions, columnPins: pins };
    const harness = setup();
    harness.g.toggleSort('c1');
    flushSync();
    expect(sorted).toBeGreaterThan(0);
    sorted = 0;

    // A column that scrolls already, unpinned: a new map, and the columns
    // where they were.
    pins.set(new Map([['c5', null]]));
    flushSync();

    expect(sorted).toBe(0);
  });

  it('reads no cell but its own when a pinned column is resized', () => {
    columns.set(makeColumns(START_AND_END));
    const harness = setup();
    const columnsRead = (): string[] => [...new Set(reads.map((read) => read.split(':')[1]!))];

    reads = [];
    harness.g.resizeColumn('c3', 150);
    flushSync();
    expect(columnsRead()).toEqual(['3']);

    reads = [];
    harness.g.resizeColumn('c7', 150);
    flushSync();
    expect(columnsRead()).toEqual(['7']);
  });

  it('reads no pinned cell for a sort, and hands back the same pinned rows', () => {
    top.set([makeRow(5000, 't')]);
    bottom.set([makeRow(9000, 'b')]);
    const harness = setup();
    const [first] = harness.g.pinnedTopRows();
    const [last] = harness.g.pinnedBottomRows();
    reads = [];

    harness.g.toggleSort('c0');
    harness.g.toggleSort('c0');
    flushSync();

    expect(harness.g.pinnedTopRows()[0]).toBe(first);
    expect(harness.g.pinnedBottomRows()[0]).toBe(last);
    expect(reads.filter((read) => read.startsWith('5000:') || read.startsWith('9000:'))).toEqual([]);
  });

  it('asks nothing of a scrolling row when a pinned row is handed over again', () => {
    let asked: number[] = [];
    gridOptions = {
      ...gridOptions,
      rowSelection: 'multiple',
      selectable: (row: Person) => {
        asked.push(row.id);
        return true;
      },
    };
    top.set([makeRow(5000, 't')]);
    setup();
    asked = [];
    reads = [];

    // A row of totals, recomputed: a new object under the same key.
    top.set([makeRow(5000, 'u')]);
    flushSync();

    expect(asked).toEqual([5000]);
    expect(reads.filter((read) => !read.startsWith('5000:'))).toEqual([]);
    expect(host.querySelector('.top .cell')!.textContent).toBe('u5000c0');
  });

  it('measures no pinned row, and states it no height, where rows are measured', () => {
    gridOptions = { ...gridOptions, rowHeight: 'auto', estimatedRowHeight: 25 };
    top.set([makeRow(5000, 't')]);
    const harness = setup();
    const row = host.querySelector<HTMLElement>('.top')!;

    expect(harness.g.pinnedTopRows()[0]).toMatchObject({ start: 0, size: 25 });
    expect(row.style.height).toBe('');
    expect(FakeResizeObserver.live.some((observer) => observer.targets.has(row))).toBe(false);
  });

  it('keeps the tab stop on a rendered row of the view when the window has left the cursor behind', () => {
    top.set([makeRow(5000, 't'), makeRow(5001, 't')]);
    const harness = setup();
    harness.g.focusCell({ row: 2, column: 0 });
    flushSync();

    userScroll(harness.scroller, { top: 10_000 });

    const stops = [...host.querySelectorAll('[tabindex="0"]')];
    expect(stops).toHaveLength(1);
    expect(stops[0]!.closest('.container')).not.toBe(null);
  });

  it('keeps the tab stop on a row pinned below, and scrolls nothing to focus one', () => {
    bottom.set([makeRow(9000, 'b')]);
    const harness = setup();
    harness.g.focusCell({ row: ROW_COUNT, column: 0 });
    flushSync();
    expect(harness.scroller.scrollTop).toBe(0);
    expect(document.activeElement!.textContent).toBe('b9000c0');

    userScroll(harness.scroller, { top: 5_000 });
    expect(cellAt(ROW_COUNT, 0)!.getAttribute('tabindex')).toBe('0');
  });

  it('leaves the cursor among the rows a filter left, not on a row pinned below them', () => {
    bottom.set([makeRow(9000, 'b')]);
    const harness = setup();
    harness.g.focusCell({ row: 500, column: 0 });
    flushSync();

    harness.g.setFilter('c0', { type: 'text', value: 'r1', operator: 'startsWith' });
    flushSync();

    // 111 rows are left, and the last of them is position 110.
    expect(harness.g.activeCell()).toEqual({ row: 110, column: 0 });
  });

  it('carries a range past a column pinned outside it, and drops one a pin splits', () => {
    gridOptions = { ...gridOptions, cellSelection: 'range' };
    const harness = setup();
    // c1 to c3, three columns side by side.
    harness.g.setCellRange({ anchor: { row: 0, column: 1 }, focus: { row: 2, column: 3 } });

    // c9 goes to the front: the same three columns, one place further on.
    harness.g.pinColumn('c9', 'start');
    flushSync();
    expect(harness.g.cellRange()).toEqual({
      anchor: { row: 0, column: 2 },
      focus: { row: 2, column: 4 },
    });

    // c2 goes to the end, out from between c1 and c3: no rectangle holds
    // what was chosen, so there is none.
    harness.g.pinColumn('c2', 'end');
    flushSync();
    expect(harness.g.cellRange()).toBe(null);
  });

  it('puts back a scroll the browser gives the rowgroups outside the scroller, and no other', () => {
    top.set([makeRow(5000, 't')]);
    bottom.set([makeRow(9000, 'b')]);
    const harness = setup();
    // What focusing a cell the window has rendered past the edge does to the
    // box clipping it: the browser scrolls that box to show the cell.
    const scrolled = (el: HTMLElement, left: number): number => {
      el.scrollLeft = left;
      el.dispatchEvent(new Event('scroll'));
      flushSync();
      return el.scrollLeft;
    };

    expect(scrolled(host.querySelector<HTMLElement>('.header')!, 200)).toBe(0);
    expect(scrolled(host.querySelector<HTMLElement>('.footer')!, 200)).toBe(0);
    // The scroller is the one box that scrolls, and a cell's own content is
    // the consumer's.
    expect(scrolled(harness.scroller, 250)).toBe(250);
    expect(scrolled(cellAt(0, 0)!, 10)).toBe(10);
  });

  it('keeps a range when a pinned row is handed over again under its key, and not when one is added', () => {
    gridOptions = { ...gridOptions, cellSelection: 'range' };
    top.set([makeRow(5000, 't')]);
    const harness = setup();
    const range = { anchor: { row: 1, column: 0 }, focus: { row: 2, column: 1 } };
    harness.g.setCellRange(range);

    top.set([makeRow(5000, 'u')]);
    flushSync();
    expect(harness.g.cellRange()).toEqual(range);

    // A row pinned above moves every row under it, as a sort does.
    top.set([makeRow(5000, 'u'), makeRow(5001, 't')]);
    flushSync();
    expect(harness.g.cellRange()).toBe(null);
  });

  it('keys each row by its place in its own list: the view, or the rows pinned to its edge', () => {
    gridOptions = {
      ...gridOptions,
      rowSelection: 'multiple',
      getRowKey: (row: Person, index: number) => `${row.id}@${index}`,
    };
    top.set([makeRow(5000, 't')]);
    bottom.set([makeRow(9000, 'b')]);
    const harness = setup();

    expect(harness.g.pinnedTopRows()[0]!.key).toBe('5000@0');
    expect(harness.g.rows()[0]!.key).toBe('0@0');
    expect(harness.g.pinnedBottomRows()[0]!.key).toBe('9000@0');
    expect(harness.g.rowIndex('3@3')).toBe(4);
    expect(harness.g.rowIndex('9000@0')).toBe(ROW_COUNT + 1);

    // A gesture selects by the key the row is drawn with.
    harness.g.focusCell({ row: 1, column: 0 });
    flushSync();
    press(harness.root, ' ');
    harness.g.focusCell({ row: ROW_COUNT + 1, column: 0 });
    flushSync();
    press(harness.root, ' ');
    expect([...harness.g.selectedRows()]).toEqual(['0@0', '9000@0']);
    expect(attrs('.bottom', 'aria-selected')).toEqual(['true']);
  });

  it("asks a height function of a pinned row with its place among its edge's rows", () => {
    const asked = new Set<string>();
    gridOptions = {
      ...gridOptions,
      rowHeight: (row: Person, index: number) => {
        if (row.id < 5000) return ROW_HEIGHT;
        asked.add(`${row.id}@${index}`);
        return 30 + index;
      },
    };
    top.set([makeRow(5000, 't'), makeRow(5001, 't')]);
    bottom.set([makeRow(9000, 'b')]);
    const harness = setup();

    expect(harness.g.pinnedTopRows().map(({ start, size }) => [start, size])).toEqual([[0, 30], [30, 31]]);
    expect(harness.g.pinnedBottomRows().map(({ start, size }) => [start, size])).toEqual([[0, 30]]);
    expect([...host.querySelectorAll<HTMLElement>('.top')].map((row) => row.style.height)).toEqual([
      '30px',
      '31px',
    ]);
    expect([...asked].sort()).toEqual(['5000@0', '5001@1', '9000@0']);
  });

  it('follows the cursor along the rows pinned to its edge, and keeps it there when its row goes', () => {
    top.set([makeRow(5000, 't'), makeRow(5001, 't')]);
    const harness = setup();
    harness.g.focusCell({ row: 0, column: 0 });
    flushSync();

    top.set([makeRow(5001, 't'), makeRow(5000, 't')]);
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 0 });

    // Its row gone, and the edge shorter than its place: the nearest row
    // still pinned there, not the view under it.
    top.set([makeRow(5002, 't')]);
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
    expect(harness.g.rowAt(0)!.id).toBe(5002);
  });

  it('follows the cursor along the rows pinned below as along those above', () => {
    bottom.set([makeRow(9000, 'b'), makeRow(9001, 'b')]);
    const harness = setup();
    harness.g.focusCell({ row: ROW_COUNT, column: 0 });
    flushSync();

    bottom.set([makeRow(9001, 'b'), makeRow(9000, 'b')]);
    flushSync();

    expect(harness.g.activeCell()).toEqual({ row: ROW_COUNT + 1, column: 0 });
    expect(harness.g.rowAt(ROW_COUNT + 1)!.id).toBe(9000);
  });

  it('pages up from a row pinned below by a page from the foot of the view', () => {
    bottom.set([makeRow(9000, 'b')]);
    // Twenty for an even id, forty for an odd one: row 999 starts at 29960.
    gridOptions = { ...gridOptions, rowHeight: (row: Person) => (row.id % 2 === 0 ? 20 : 40) };
    const harness = setup();
    harness.g.focusCell({ row: ROW_COUNT, column: 0 });
    flushSync();

    press(harness.root, 'PageUp');

    // A viewport above 29960 is 29860, inside row 995 (29840 to 29880); the
    // nearest row starting below it is row 996, at 29880.
    expect(harness.g.activeCell()).toEqual({ row: 996, column: 0 });
  });

  it('names a pasted row by the key the grid draws it with, pinned or not', async () => {
    const getRowKey = (row: Person, index: number): string => `${row.id}@${index}`;
    gridOptions = { ...gridOptions, getRowKey };
    top.set([makeRow(5000, 't')]);
    bottom.set([makeRow(9000, 'b')]);
    const text = new Blob(['x\ny\nz'], { type: 'text/plain' });
    const item = { types: ['text/plain'], getType: async (): Promise<Blob> => text };
    const clipboard = { read: async (): Promise<(typeof item)[]> => [item] };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    restores.push(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });
    const harness = setup();
    const pasted: string[] = [];
    const failures: string[] = [];
    const copier = createGridClipboard<Person>({
      grid: () => harness.g,
      columns: () => makeColumns(),
      getRowKey,
      onPaste: (changes) => {
        for (const change of changes) pasted.push(`${String(change.rowKey)} ${String(change.value)}`);
      },
      onError: (failure) => failures.push(failure.reason),
    });

    // From the first row of the view down past its second.
    harness.g.focusCell({ row: 1, column: 0 });
    flushSync();
    await copier.paste();
    // From the last row of the view down onto the row pinned below it.
    harness.g.focusCell({ row: ROW_COUNT, column: 0 });
    flushSync();
    await copier.paste();
    // And from the row pinned above down into the view.
    harness.g.focusCell({ row: 0, column: 0 });
    flushSync();
    await copier.paste();

    expect(failures).toEqual([]);
    expect(pasted).toEqual([
      '0@0 x', '1@1 y', '2@2 z',
      '999@999 x', '9000@0 y',
      '5000@0 x', '0@0 y', '1@1 z',
    ]);
  });

  it('undoes an edit to a pinned row, which is not among the data', async () => {
    top.set([makeRow(5000, 't')]);
    const harness = setup();
    const applied: string[] = [];
    const skipped: unknown[] = [];
    const edits = createEditHistory<Person>({
      grid: () => harness.g,
      rows: () => people.get(),
      getRowKey: (row) => row.id,
      apply: (step) => {
        for (const change of step.changes) {
          applied.push(`${step.kind} ${String(change.rowKey)} ${change.rowIndex} ${String(change.value)}`);
        }
        return true;
      },
      onSkip: (records) => skipped.push(...records.map((record) => record.rowKey)),
    });
    const item = harness.g.rowAt(0)!;

    await edits.commit({ item, columnId: 'c0', previous: 't5000c0', value: 'x' });
    expect(await edits.undo()).toBe(true);
    expect(await edits.redo()).toBe(true);

    expect(skipped).toEqual([]);
    expect(applied).toEqual(['commit 5000 0 x', 'undo 5000 0 t5000c0', 'redo 5000 0 x']);
  });

  it('opens and shuts a group from its own header, whatever is pinned above it', () => {
    type Row = GridGroupedRow<Person>;
    const grouped = [makeRow(1, 'east'), makeRow(2, 'west')];
    const totals: Row = { kind: 'data', key: 'totals', item: makeRow(7000, 't'), depth: 0 };

    @Component({ selector: `v-pinned-grouped-${++selectors}`, render: compileTemplate(GROUPED_TEMPLATE) })
    class Grouped {
      grid = new Signal.State<Element | null>(null);
      scroller = new Signal.State<Element | null>(null);
      container = new Signal.State<Element | null>(null);
      grouping = createGrouping<Person>({
        rows: () => grouped,
        columns: () => makeColumns(),
        groupBy: () => ['c0'],
        getRowKey: (row) => row.id,
      });
      g = createGrid<Row>({
        grid: () => this.grid.get(),
        scroller: () => this.scroller.get(),
        container: () => this.container.get(),
        rows: () => this.grouping.rows(),
        columns: () => this.grouping.columns(),
        getRowKey: this.grouping.rowKey,
        rowHeight: ROW_HEIGHT,
        pinnedTop: () => [totals],
      });
      rowProps(row: GridRow<Row>): Record<string, unknown> {
        return { ...this.g.rowProps(row), ...this.grouping.rowProps(row.item) };
      }
      onKey(event: KeyboardEvent): void {
        if (!this.grouping.onKeyDown(event)) this.g.onKeyDown(event);
      }
    }
    mounted.push(mount(Grouped, host));
    flushSync();
    const expanded = (): (string | null)[] => attrs(`[${GRID_GROUP_ATTRIBUTE}]`, 'aria-expanded');
    expect(expanded()).toEqual(['true', 'true']);

    // Position 0 is the pinned row, and the grouping's own first row is a
    // header: Enter on the pinned row is not Enter on that header.
    press(cellAt(0, 0)!, 'Enter');
    expect(expanded()).toEqual(['true', 'true']);

    press(cellAt(1, 0)!, 'Enter');
    expect(expanded()).toEqual(['false', 'true']);

    // West's header is position 2 now, and shuts from its first cell.
    press(cellAt(2, 0)!, 'ArrowLeft');
    expect(expanded()).toEqual(['false', 'false']);
  });

  it('restores a state over the pins the page started with, keeping them where it says nothing', () => {
    const pins = new Signal.State<ReadonlyMap<string, GridColumnPin>>(new Map([['c4', 'start']]));
    gridOptions = { ...gridOptions, columnPins: pins };
    layer = (list) => createGridState<Person>({ grid: () => null, columns: list, columnPins: pins });
    const harness = setup();
    expect(order(harness.g)[0]).toBe('c4');
    harness.g.pinColumn('c9', 'end');
    flushSync();

    // Version 1 could say nothing of pins: the page's own holds, and the
    // reader's goes.
    harness.view!.apply({ version: 1, columns: makeColumns().map((column) => ({ id: column.id })) });
    flushSync();
    expect(harness.g.columnPin('c4')).toBe('start');
    expect(harness.g.columnPin('c9')).toBe(null);

    // A version-2 state that gives c4 no pin leaves it the page's.
    harness.g.pinColumn('c4', null);
    flushSync();
    harness.view!.apply({ version: 2, columns: makeColumns().map((column) => ({ id: column.id })) });
    flushSync();
    expect(harness.g.columnPin('c4')).toBe('start');
  });

  it('saves no pin the page started with, and saves the reader taking it off', () => {
    const pins = new Signal.State<ReadonlyMap<string, GridColumnPin>>(new Map([['c4', 'start']]));
    gridOptions = { ...gridOptions, columnPins: pins };
    layer = (list) => createGridState<Person>({ grid: () => null, columns: list, columnPins: pins });
    const harness = setup();
    expect(harness.view!.state().columns[0]).toEqual({ id: 'c4' });

    harness.g.pinColumn('c4', null);
    flushSync();

    expect(harness.view!.state().columns.find((column) => column.id === 'c4')).toEqual({
      id: 'c4',
      pin: null,
    });
  });
});
