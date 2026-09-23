/**
 * Copy and paste, driven through a real mounted grid against a stubbed system
 * clipboard.
 *
 * The claims worth proving are the ones that are invisible when they fail: that
 * a paste hands over changes and never writes a row, that a refusal reports
 * every cell and not the first, that a paste too big for the grid is cut and
 * says so, that the clipboard refusing or not being there is a result rather
 * than an exception — and that none of it costs the grid its one text node per
 * value, which is asserted by counting accessor runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocaleProvider, resetAnnouncer, type MessageCatalog } from '@voltdev/primitives';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, effect, flushSync, mount } from '@voltdev/core';
import {
  GRID_CELL_ATTRIBUTE,
  GRID_EDITOR_ATTRIBUTE,
  createCellEditing,
  createGridClipboard,
  createGrid,
  type Grid,
  type GridCellEditing,
  type GridClipboard,
  type GridClipboardFailure,
  type GridColumn,
  type GridCopied,
  type GridEditChange,
  type GridEditor,
  type GridPasteRefusal,
  type GridPasteTruncation,
  type GridRow,
} from '../src/index.ts';

/** A row whose every cell is a signal — the shape the whole design rests on. */
interface Person {
  readonly id: number;
  readonly cells: readonly Signal.State<unknown>[];
}

const ROW_HEIGHT = 20;
const COLUMN_WIDTH = 100;
const VIEWPORT_HEIGHT = 100;
const VIEWPORT_WIDTH = 300;

/**
 * Row ids start well away from zero, so that a key and an index are never
 * the same number and a paste that confused one for the other cannot pass.
 */
const FIRST_ID = 10;

/** Every accessor call, as `id:column`. The evidence for what was read. */
let reads: string[] = [];

function makeColumns(): GridColumn<Person>[] {
  return ['c0', 'c1', 'c2'].map((id, index) => ({
    id,
    header: `Column ${index}`,
    width: COLUMN_WIDTH,
    value: (row: Person) => {
      reads.push(`${row.id}:${index}`);
      return row.cells[index]!.get();
    },
  }));
}

const TABLE: readonly (readonly unknown[])[] = [
  ['alpha', 'one', 1],
  ['beta', 'two', 2],
  ['gamma', 'three', 3],
  ['delta', 'four', 4],
];

function tableOf(cells: readonly (readonly unknown[])[]): Person[] {
  return cells.map((values, index) => ({
    id: FIRST_ID + index,
    cells: values.map((value) => new Signal.State<unknown>(value)),
  }));
}

/** As many rows as asked for, `r0` to `rN` in the first column. */
function manyRows(count: number): Person[] {
  return tableOf(Array.from({ length: count }, (_, i) => [`r${i}`, `s${i}`, i]));
}

/** The column that parses, validates and refuses a negative number. */
const NUMBER_EDITOR: GridEditor<Person> = {
  // A cleared cell is no number, where `Number('')` would make it 0.
  parse: (raw) => (raw.trim() === '' ? null : Number(raw)),
  validate: (value) =>
    typeof value !== 'number' || Number.isNaN(value)
      ? 'Enter a number'
      : value < 0
        ? 'Not negative'
        : null,
};

// ---------------------------------------------------------------------------
// The system clipboard, stubbed.
// ---------------------------------------------------------------------------

/** A `ClipboardItem` as far as the layer reads and writes one. */
class StubItem {
  constructor(readonly data: Readonly<Record<string, Blob>>) {}

  get types(): readonly string[] {
    return Object.keys(this.data);
  }

  getType(type: string): Promise<Blob> {
    const blob = this.data[type];
    return blob === undefined
      ? Promise.reject(new DOMException(`no ${type}`, 'NotFoundError'))
      : Promise.resolve(blob);
  }
}

interface StubClipboard {
  /** What the system clipboard holds, by type. */
  holds: Record<string, string>;
  /** How many writes and reads were started — counted when started, not when finished. */
  writes: number;
  reads: number;
  /** Set to make every write and read reject with it. */
  refuse: Error | null;
  /** Set to hold reads until it settles. */
  gate: Promise<void> | null;
}

let stub: StubClipboard;

function installClipboard(): StubClipboard {
  const installed: StubClipboard = { holds: {}, writes: 0, reads: 0, refuse: null, gate: null };
  const clipboard = {
    write: async (items: readonly StubItem[]): Promise<void> => {
      installed.writes++;
      if (installed.refuse !== null) throw installed.refuse;
      const held: Record<string, string> = {};
      for (const [type, blob] of Object.entries(items[0]!.data)) held[type] = await blob.text();
      installed.holds = held;
    },
    read: async (): Promise<StubItem[]> => {
      installed.reads++;
      if (installed.refuse !== null) throw installed.refuse;
      if (installed.gate !== null) await installed.gate;
      const data: Record<string, Blob> = {};
      for (const [type, text] of Object.entries(installed.holds)) {
        data[type] = new Blob([text], { type });
      }
      return [new StubItem(data)];
    },
  };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  return installed;
}

/** The page outside a secure context, where the API is absent rather than failing. */
function removeClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
}

// ---------------------------------------------------------------------------

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;

let people: Signal.State<readonly Person[]>;
let columns: Signal.State<readonly GridColumn<Person>[]>;
let editors: Signal.State<Readonly<Record<string, GridEditor<Person>>>>;
let catalogue: MessageCatalog | null;

/** Each call of `onPaste`, as it was made. */
let pastes: { changes: readonly GridEditChange<Person>[]; truncated: GridPasteTruncation | null }[];
let refused: (readonly GridPasteRefusal<Person>[])[];
let copies: GridCopied[];
let failures: GridClipboardFailure[];
/** Whether the caller applies what it is told, which is the only way a row changes. */
let applyChanges = true;
/**
 * Whether the caller's store also hands back a new object for each row a paste
 * changed, as a store that never mutates a row does.
 */
let replaceRows = false;

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
  pastes = [];
  refused = [];
  copies = [];
  failures = [];
  applyChanges = true;
  replaceRows = false;
  catalogue = null;
  people = new Signal.State<readonly Person[]>(tableOf(TABLE));
  columns = new Signal.State<readonly GridColumn<Person>[]>(makeColumns());
  // The middle column has no editor at all, which is how a column is made
  // read-only — to a double click, and to a paste.
  editors = new Signal.State<Readonly<Record<string, GridEditor<Person>>>>({
    c0: { validate: (value) => (String(value).trim() === '' ? 'A name is required' : null) },
    c2: NUMBER_EDITOR,
  });

  FakeResizeObserver.live = [];
  const view = window as unknown as { ResizeObserver: unknown; ClipboardItem: unknown };
  const originalObserver = view.ResizeObserver;
  view.ResizeObserver = FakeResizeObserver;
  const originalItem = view.ClipboardItem;
  view.ClipboardItem = StubItem;
  restores.push(() => {
    view.ResizeObserver = originalObserver;
    view.ClipboardItem = originalItem;
    delete (navigator as { clipboard?: unknown }).clipboard;
  });
  stub = installClipboard();
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  resetAnnouncer();
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
});

const TEMPLATE = `
  <div class="grid" :ref="grid" :spread="g.gridProps()"
       :keydown="onKey($event)" :focusin="g.onFocusIn($event)">
    <div class="header" :spread="g.headerProps()">
      <input class="search" type="search">
      <div class="header-row" :spread="g.headerRowProps()">
        <div class="th" :for="col in g.columns()" :key="col.key"
             :spread="g.headerCellProps(col)">{ col.column.header }</div>
      </div>
    </div>
    <div class="body" :ref="scroller" :spread="g.bodyProps()">
      <div class="sizer" :spread="g.sizerProps()">
        <div class="container" :ref="container" :spread="g.containerProps()">
          <div class="row" :for="row in g.rows()" :key="row.key" :spread="g.rowProps(row)">
            <div class="cell" :for="col in g.columns()" :key="col.key"
                 :spread="cellProps(row, col)">
              <input :if="editing.isEditing(row.index, col.index)" class="editor"
                     :spread="editing.editorProps()" :value="editing.text()"
                     :input="editing.onInput($event)">
              <span :else class="text">{ g.cellValue(row, col) }</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

interface ClipboardInstance {
  locale: ReturnType<typeof createLocaleProvider> | null;
  g: Grid<Person>;
  editing: GridCellEditing<Person>;
  clipboard: GridClipboard<Person>;
  handled: boolean;
}

interface Harness {
  g: Grid<Person>;
  editing: GridCellEditing<Person>;
  clipboard: GridClipboard<Person>;
  instance: ClipboardInstance;
  root: HTMLElement;
}

interface SetupOptions {
  /**
   * Whether the clipboard is given the editing layer and its editors, which is
   * what makes it parse and validate. Without them the grid has no editing.
   */
  editable?: boolean;
  /** Whether the clipboard is given the grid's `getRowKey`, or left on the index. */
  clipboardKeys?: boolean;
  /** Whether the grid is given a `getRowKey`, or keys its rows by their place. */
  gridKeys?: boolean;
}

function setup({ editable = true, clipboardKeys = true, gridKeys = true }: SetupOptions = {}): Harness {
  @Component({ selector: `v-clipboard-${++selectors}`, render: compileTemplate(TEMPLATE) })
  class ClipboardGrid {
    // Before the clipboard, which takes the nearest locale when it is created.
    locale = catalogue && createLocaleProvider({ defaultLocale: 'de-DE', messages: catalogue });
    grid = new Signal.State<Element | null>(null);
    scroller = new Signal.State<Element | null>(null);
    container = new Signal.State<Element | null>(null);
    handled = false;

    g = createGrid<Person>({
      grid: () => this.grid.get(),
      scroller: () => this.scroller.get(),
      container: () => this.container.get(),
      rows: () => people.get(),
      columns: () => columns.get(),
      getRowKey: gridKeys ? (row: Person) => row.id : undefined,
      rowHeight: ROW_HEIGHT,
      cellSelection: 'range',
      label: 'People',
    });

    editing = createCellEditing<Person>({
      grid: () => this.g,
      editors: () => editors.get(),
      columns: () => columns.get(),
      onCommit: () => {},
    });

    clipboard = createGridClipboard<Person>({
      grid: () => this.g,
      columns: () => columns.get(),
      getRowKey: clipboardKeys ? (row: Person) => row.id : undefined,
      editing: editable ? () => this.editing : undefined,
      editors: editable ? () => editors.get() : undefined,
      onPaste: (changes, truncated) => {
        pastes.push({ changes, truncated });
        // What a caller does with them: write each into the store the rows
        // came from. Nothing in the grid or the clipboard did this.
        if (applyChanges) apply(changes);
        if (replaceRows) {
          const changed = new Set(changes.map((change) => change.item));
          people.set(people.get().map((person) => (changed.has(person) ? { ...person } : person)));
        }
      },
      onRefuse: (refusals) => refused.push(refusals),
      onCopy: (copied) => copies.push(copied),
      onError: (failure) => failures.push(failure),
    });

    cellProps(row: GridRow<Person>, col: never): Record<string, unknown> {
      return { ...this.g.cellProps(row, col), ...this.editing.cellProps(row, col) };
    }

    onKey(event: KeyboardEvent): void {
      this.handled =
        this.editing.onKeyDown(event) || this.clipboard.onKeyDown(event) || this.g.onKeyDown(event);
    }
  }

  const handle = mount(ClipboardGrid, host);
  mounted.push(handle);

  const scroller = host.querySelector<HTMLElement>('.body')!;
  Object.defineProperty(scroller, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true });
  Object.defineProperty(scroller, 'clientWidth', { value: VIEWPORT_WIDTH, configurable: true });
  FakeResizeObserver.deliver([{ target: scroller, block: VIEWPORT_HEIGHT, inline: VIEWPORT_WIDTH }]);

  const instance = handle.instance as ClipboardInstance;
  return {
    g: instance.g,
    editing: instance.editing,
    clipboard: instance.clipboard,
    instance,
    root: host.querySelector<HTMLElement>('.grid')!,
  };
}

function apply(changes: readonly GridEditChange<Person>[]): void {
  for (const change of changes) {
    const index = columns.get().findIndex((column) => column.id === change.columnId);
    change.item.cells[index]!.set(change.value);
  }
}

/** What every row holds, in the caller's own store — never the DOM. */
function stored(): unknown[][] {
  return people.get().map((person) => person.cells.map((cell) => cell.get()));
}

function cells(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.cell')];
}

function cellAt(row: number, column: number): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[${GRID_CELL_ATTRIBUTE}="${row},${column}"]`);
}

/** The rendered cells, the text node each shows its value in, and what it says. */
interface Snapshot {
  readonly cells: readonly HTMLElement[];
  readonly nodes: readonly (ChildNode | null)[];
  readonly texts: readonly (string | null)[];
}

function textNode(cell: HTMLElement): ChildNode | null {
  return cell.querySelector('.text')?.firstChild ?? null;
}

function snapshot(): Snapshot {
  const all = cells();
  return {
    cells: all,
    nodes: all.map(textNode),
    texts: all.map((cell) => cell.textContent),
  };
}

/**
 * The cells re-rendered since the snapshot — a cell element or its text node
 * replaced — as `row,column`. A value written in place is not a re-render.
 */
function rerendered(before: Snapshot): string[] {
  const now = cells();
  if (now.length !== before.cells.length) return ['(the window itself)'];
  return now
    .filter((cell, i) => cell !== before.cells[i] || textNode(cell) !== before.nodes[i])
    .map((cell) => cell.getAttribute(GRID_CELL_ATTRIBUTE)!);
}

/** The cells whose text changed since the snapshot, as `row,column`. */
function rewritten(before: Snapshot): string[] {
  return cells()
    .filter((cell, i) => cell.textContent !== before.texts[i])
    .map((cell) => cell.getAttribute(GRID_CELL_ATTRIBUTE)!);
}

function press(el: Element, key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

/** Puts the cursor on a cell, as a reader arriving there would. */
function standOn(harness: Harness, row: number, column: number): void {
  harness.g.focusCell({ row, column });
  flushSync();
}

/** Lets a copy or paste the keyboard started run to its end. */
async function settled(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

/** The live region's text, once it has one. */
async function announced(priority: 'polite' | 'assertive' = 'polite'): Promise<string> {
  let text = '';
  await vi.waitFor(() => {
    text = document.querySelector(`[data-volt-announcer='${priority}']`)?.textContent ?? '';
    expect(text).not.toBe('');
  });
  return text;
}

/** Puts text on the stubbed clipboard, as another application would. */
function holds(text: string | null, html: string | null = null): void {
  stub.holds = {};
  if (text !== null) stub.holds['text/plain'] = text;
  if (html !== null) stub.holds['text/html'] = html;
}

/** The values a paste handed over, as `rowId:columnId=value`. */
function changed(): string[] {
  return pastes.flatMap(({ changes }) =>
    changes.map((change) => `${change.rowKey}:${change.columnId}=${String(change.value)}`),
  );
}

// ---------------------------------------------------------------------------

describe('copying', () => {
  it('copies the cell under the cursor, as text and as a table', async () => {
    const harness = setup();
    standOn(harness, 1, 0);

    const event = press(harness.root, 'c', { ctrlKey: true });
    expect(harness.instance.handled).toBe(true);
    // Taken from the browser, which would otherwise copy whatever it thinks is
    // selected on the page as well.
    expect(event.defaultPrevented).toBe(true);
    await settled();

    expect(stub.holds).toEqual({
      'text/plain': 'beta',
      'text/html': '<table><tbody><tr><td>beta</td></tr></tbody></table>',
    });
    expect(copies).toHaveLength(1);
    expect(copies[0]!.bounds).toEqual({ fromRow: 1, toRow: 1, fromColumn: 0, toColumn: 0 });
  });

  it('copies with Cmd as well as Ctrl', async () => {
    const harness = setup();
    standOn(harness, 2, 1);
    press(harness.root, 'c', { metaKey: true });
    await settled();
    expect(stub.holds['text/plain']).toBe('three');
  });

  it('copies the range as rows of cells, whichever way it was dragged', async () => {
    const harness = setup();
    standOn(harness, 2, 2);
    // Dragged up and to the left: the cursor ends at the top-left corner and
    // the anchor at the bottom-right, and the copy is the same rectangle.
    press(harness.root, 'ArrowUp', { shiftKey: true });
    press(harness.root, 'ArrowLeft', { shiftKey: true });
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 1 });

    press(harness.root, 'c', { ctrlKey: true });
    await settled();

    expect(stub.holds['text/plain']).toBe('two\t2\nthree\t3');
    expect(stub.holds['text/html']).toBe(
      '<table><tbody><tr><td>two</td><td>2</td></tr><tr><td>three</td><td>3</td></tr></tbody></table>',
    );
  });

  it('quotes a cell only where a spreadsheet would, and escapes the table', async () => {
    people.set(tableOf([['a\tb', 'line\nbreak', '"quoted" first'], ['plain "inner"', '<b>&', '']]));
    const harness = setup();
    harness.g.setCellRange({ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 2 } });

    await harness.clipboard.copy();

    expect(stub.holds['text/plain']).toBe(
      '"a\tb"\t"line\nbreak"\t"""quoted"" first"\nplain "inner"\t<b>&\t',
    );
    expect(stub.holds['text/html']).toBe(
      '<table><tbody>' +
        '<tr><td>a\tb</td><td>line<br style="mso-data-placement:same-cell">break</td>' +
        '<td>"quoted" first</td></tr>' +
        '<tr><td>plain "inner"</td><td>&lt;b&gt;&amp;</td><td></td></tr>' +
        '</tbody></table>',
    );
  });

  it("keeps a line break inside its cell in the table, where a spreadsheet would start a row", async () => {
    people.set(tableOf([['two\nlines', 'b', 'c']]));
    const harness = setup();
    standOn(harness, 0, 0);

    await harness.clipboard.copy();

    // Excel reads a bare `<br>` in a pasted table as the end of a row, and
    // pushes every cell under it down one; this is its own mark for a break
    // that stays in the cell, and everything else reads it as a `<br>`.
    expect(stub.holds['text/html']).toBe(
      '<table><tbody><tr><td>two<br style="mso-data-placement:same-cell">lines</td></tr></tbody></table>',
    );
  });

  it('writes the clipboard before anything is awaited, inside the gesture', () => {
    const harness = setup();
    standOn(harness, 0, 0);
    void harness.clipboard.copy();
    // Synchronously: a browser that ties clipboard writes to a gesture checks
    // for one when the write starts.
    expect(stub.writes).toBe(1);
  });

  it('reads each copied cell once and no other, and re-renders nothing', async () => {
    const harness = setup();
    harness.g.setCellRange({ anchor: { row: 1, column: 0 }, focus: { row: 2, column: 1 } });
    flushSync();
    const before = snapshot();
    reads = [];

    await harness.clipboard.copy();
    flushSync();

    expect(reads).toEqual([
      `${FIRST_ID + 1}:0`,
      `${FIRST_ID + 1}:1`,
      `${FIRST_ID + 2}:0`,
      `${FIRST_ID + 2}:1`,
    ]);
    expect(rerendered(before)).toEqual([]);
    expect(rewritten(before)).toEqual([]);
  });

  it('subscribes to nothing, even when a copy or a paste starts inside an effect', async () => {
    const harness = setup();
    harness.g.setCellRange({ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } });
    flushSync();
    holds('X');
    let runs = 0;
    let done: Promise<unknown> = Promise.resolve();
    restores.push(
      createRoot((dispose) => {
        effect(() => {
          runs += 1;
          done = Promise.all([harness.clipboard.copy(), harness.clipboard.paste()]);
        });
        return dispose;
      }),
    );
    flushSync();
    await done;
    expect(runs).toBe(1);

    // A value it copied, the range and the cursor it read, and the rows.
    people.get()[0]!.cells[0]!.set('changed');
    harness.g.setCellRange(null);
    standOn(harness, 3, 2);
    people.set([...people.get()]);
    flushSync();
    expect(runs).toBe(1);
  });

  it('subscribes to nothing when a copy or a paste fails before the clipboard', async () => {
    catalogue = { copyFailed: 'Kopieren fehlgeschlagen', pasteFailed: 'Einfügen fehlgeschlagen' };
    removeClipboard();
    const harness = setup();
    standOn(harness, 0, 0);
    let runs = 0;
    restores.push(
      createRoot((dispose) => {
        effect(() => {
          runs += 1;
          // Both fail before any `await`, and announce right here, in the
          // locale's words.
          void harness.clipboard.copy();
          void harness.clipboard.paste();
        });
        return dispose;
      }),
    );
    flushSync();
    await settled();
    expect(await announced('assertive')).toBe('Einfügen fehlgeschlagen');

    harness.instance.locale!.setMessages({ copyFailed: 'Nein', pasteFailed: 'Nein' });
    flushSync();
    expect(runs).toBe(1);
  });

  it('does not subscribe to a grid option that reads a signal', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    const table = new Signal.State<Grid<Person> | null>(harness.g);
    const clipboard = createClipboardFor(harness, { grid: () => table.get() });
    holds('X');
    let runs = 0;
    restores.push(
      createRoot((dispose) => {
        effect(() => {
          runs += 1;
          void clipboard.copy();
          void clipboard.paste();
        });
        return dispose;
      }),
    );
    flushSync();
    await settled();

    table.set(null);
    flushSync();
    expect(runs).toBe(1);
  });

  it('copies rows the window does not hold, and reads only those', async () => {
    people.set(manyRows(1000));
    const harness = setup();
    harness.g.setCellRange({ anchor: { row: 500, column: 0 }, focus: { row: 502, column: 0 } });
    flushSync();
    reads = [];

    await harness.clipboard.copy();

    expect(stub.holds['text/plain']).toBe('r500\nr501\nr502');
    expect(reads).toHaveLength(3);
  });

  it('cuts a range the grid no longer reaches to the cells that are there', async () => {
    const harness = setup();
    // `setCellRange` takes what it is given, unchecked.
    harness.g.setCellRange({ anchor: { row: 2, column: 1 }, focus: { row: 40, column: 9 } });

    const result = await harness.clipboard.copy();

    expect(result).toMatchObject({
      status: 'copied',
      text: 'three\t3\nfour\t4',
      bounds: { fromRow: 2, toRow: 3, fromColumn: 1, toColumn: 2 },
    });
    expect(await announced()).toBe('Copied 4 cells');
  });

  it('copies a range one row tall, and one column wide', async () => {
    const harness = setup();
    standOn(harness, 1, 0);
    press(harness.root, 'ArrowRight', { shiftKey: true });
    await harness.clipboard.copy();
    expect(stub.holds['text/plain']).toBe('beta\ttwo');

    harness.g.setCellRange(null);
    standOn(harness, 1, 2);
    press(harness.root, 'ArrowDown', { shiftKey: true });
    await harness.clipboard.copy();
    expect(stub.holds['text/plain']).toBe('2\n3');
  });

  it('copies the cell under the cursor when nothing of the range is left', async () => {
    const harness = setup();
    standOn(harness, 1, 0);
    // Wholly past the last column, which `setCellRange` takes unchecked: the
    // grid drops a range whose columns leave its list, but never trims one it
    // was handed.
    harness.g.setCellRange({ anchor: { row: 0, column: 5 }, focus: { row: 2, column: 7 } });

    const event = press(harness.root, 'c', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    await settled();
    expect(stub.holds['text/plain']).toBe('beta');

    holds('BETA');
    await harness.clipboard.paste();
    expect(changed()).toEqual([`${FIRST_ID + 1}:c0=BETA`]);
  });

  it('copies the columns the grid shows, in its order, from a list of every column', async () => {
    const all = makeColumns();
    // What `createGridState` hands the grid: c0 hidden and c2 moved first.
    columns.set([all[2]!, all[1]!]);
    const harness = setup();
    const clipboard = createClipboardFor(harness, { columns: () => all });
    harness.g.setCellRange({ anchor: { row: 1, column: 0 }, focus: { row: 2, column: 1 } });

    const result = await clipboard.copy();

    // Never the hidden column's value, which a list read by position would
    // have copied out from under the cursor.
    expect(result).toMatchObject({ status: 'copied', text: '2\ttwo\n3\tthree' });
  });

  it('copies a column it has no definition for as an empty cell, and says why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    restores.push(() => warn.mockRestore());
    const harness = setup();
    const [c0, , c2] = makeColumns();
    const clipboard = createClipboardFor(harness, { columns: () => [c0!, c2!] });
    harness.g.setCellRange({ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 2 } });
    expect(warn).not.toHaveBeenCalled();

    const result = await clipboard.copy();

    // Empty rather than missing, so the cell after it stays under its column.
    expect(result).toMatchObject({ status: 'copied', text: 'alpha\t\t1' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('defines only 2 of them');
  });

  it('leaves Ctrl+C on the column header to the page', async () => {
    const harness = setup();
    standOn(harness, -1, 0);
    const event = press(harness.root, 'c', { ctrlKey: true });
    await settled();

    expect(harness.instance.handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(stub.writes).toBe(0);
    expect(await harness.clipboard.copy()).toBeNull();
  });

  it('says how many cells it copied', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    await harness.clipboard.copy();
    expect(await announced()).toBe('Copied 1 cell');

    resetAnnouncer();
    harness.g.setCellRange({ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } });
    await harness.clipboard.copy();
    expect(await announced()).toBe('Copied 4 cells');
  });
});

describe('pasting', () => {
  it('hands over the changes from the cursor, and never writes a row', async () => {
    applyChanges = false;
    const harness = setup();
    standOn(harness, 1, 0);
    holds('BETA');
    const rows = people.get();
    const before = stored();

    const pasted = await harness.clipboard.paste();

    expect(pasted).toMatchObject({ status: 'pasted', cells: 1, truncated: null });
    expect(pastes).toHaveLength(1);
    const [change] = pastes[0]!.changes;
    expect(change).toEqual({
      item: rows[1],
      rowKey: FIRST_ID + 1,
      rowIndex: 1,
      columnId: 'c0',
      previous: 'beta',
      value: 'BETA',
    });
    // Reported, and nothing more: the same array, the same objects, and every
    // value where it was.
    expect(people.get()).toBe(rows);
    expect(stored()).toEqual(before);
    expect(cellAt(1, 0)!.textContent).toBe('beta');
    expect(await announced()).toBe('Pasted 1 cell');
  });

  it('pastes with Ctrl+V, and Cmd+V', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    holds('ALPHA');

    const event = press(harness.root, 'v', { ctrlKey: true });
    expect(harness.instance.handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    await settled();
    expect(changed()).toEqual([`${FIRST_ID}:c0=ALPHA`]);

    holds('ALPHA!');
    press(harness.root, 'v', { metaKey: true });
    await settled();
    expect(changed()).toEqual([`${FIRST_ID}:c0=ALPHA`, `${FIRST_ID}:c0=ALPHA!`]);
  });

  it('reads the clipboard before anything is awaited, inside the gesture', () => {
    const harness = setup();
    standOn(harness, 0, 0);
    void harness.clipboard.paste();
    expect(stub.reads).toBe(1);
  });

  it('reads each cell it lands on once and no other, and re-renders nothing until applied', async () => {
    applyChanges = false;
    editors.set({ c0: {}, c1: {}, c2: NUMBER_EDITOR });
    const harness = setup();
    standOn(harness, 1, 0);
    const before = snapshot();
    reads = [];
    holds('B\tTWO\nG\tTHREE');

    await harness.clipboard.paste();
    flushSync();

    expect(reads).toEqual([
      `${FIRST_ID + 1}:0`,
      `${FIRST_ID + 1}:1`,
      `${FIRST_ID + 2}:0`,
      `${FIRST_ID + 2}:1`,
    ]);
    expect(rerendered(before)).toEqual([]);
    expect(rewritten(before)).toEqual([]);
  });

  it('writes one text node per changed cell once the caller applies it', async () => {
    editors.set({ c0: {}, c1: {}, c2: NUMBER_EDITOR });
    const harness = setup();
    standOn(harness, 1, 0);
    const before = snapshot();
    // The second cell already holds what is pasted over it, so it is no change.
    holds('B\ttwo\nG\tTHREE');
    reads = [];

    await harness.clipboard.paste();
    flushSync();

    // The same cells and the same text nodes, three of them written in place.
    expect(rerendered(before)).toEqual([]);
    expect(rewritten(before)).toEqual(['1,0', '2,0', '2,1']);
    expect(cellAt(2, 1)!.textContent).toBe('THREE');
    // The paste's four reads of what it was replacing, and then only the three
    // changed cells' own bindings, once each.
    expect(reads).toHaveLength(7);
    expect(reads.slice(4).sort()).toEqual([
      `${FIRST_ID + 1}:0`,
      `${FIRST_ID + 2}:0`,
      `${FIRST_ID + 2}:1`,
    ]);
  });

  it('starts from the top-left corner of the range, wherever the cursor is', async () => {
    const harness = setup();
    standOn(harness, 1, 0);
    press(harness.root, 'ArrowDown', { shiftKey: true });
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 0 });
    holds('X');

    await harness.clipboard.paste();
    expect(changed()).toEqual([`${FIRST_ID + 1}:c0=X`]);
  });

  it("parses through the column's editor, and hands over what it parsed", async () => {
    const harness = setup();
    standOn(harness, 0, 2);
    holds(' 42 ');
    await harness.clipboard.paste();
    expect(pastes[0]!.changes[0]!.value).toBe(42);
  });

  it('reports nothing for a cell pasted with what it already holds', async () => {
    const harness = setup();
    standOn(harness, 1, 2);
    holds('2');
    const result = await harness.clipboard.paste();
    expect(result).toMatchObject({ status: 'pasted', changes: [], cells: 1 });
    // Nothing to write is nothing to call about: a request, an undo entry and
    // a dirty flag would all be for nothing.
    expect(pastes).toEqual([]);
  });

  it('leaves the cells after a short row alone rather than emptying them', async () => {
    editors.set({ c0: {}, c1: {}, c2: NUMBER_EDITOR });
    const harness = setup();
    standOn(harness, 0, 0);
    holds('A\tONE\nB');
    await harness.clipboard.paste();
    expect(changed()).toEqual([`${FIRST_ID}:c0=A`, `${FIRST_ID}:c1=ONE`, `${FIRST_ID + 1}:c0=B`]);
    expect(stored()[1]).toEqual(['B', 'two', 2]);
    expect(await announced()).toBe('Pasted 3 cells');
  });

  it('takes the text as it came in every cell when there is no editing', async () => {
    const harness = setup({ editable: false });
    standOn(harness, 0, 1);
    holds('ONE\t-5');
    await harness.clipboard.paste();
    // Neither read-only nor parsed nor validated: without editors, a paste is
    // the text, and what to do with it is the caller's.
    expect(changed()).toEqual([`${FIRST_ID}:c1=ONE`, `${FIRST_ID}:c2=-5`]);
    expect(pastes[0]!.changes[1]!.value).toBe('-5');
  });

  it('does nothing where there is nowhere to paste', async () => {
    const harness = setup();
    standOn(harness, -1, 0);
    holds('X');
    const event = press(harness.root, 'v', { ctrlKey: true });
    expect(harness.instance.handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(await harness.clipboard.paste()).toBeNull();
    expect(stub.reads).toBe(0);
  });

  it('pastes into the columns the grid shows, in its order, from a list of all', async () => {
    const all = makeColumns();
    columns.set([all[2]!, all[1]!]);
    const harness = setup({ editable: false });
    const clipboard = createClipboardFor(harness, {
      columns: () => all,
      onPaste: (c) => pastes.push({ changes: c, truncated: null }),
    });
    standOn(harness, 1, 0);
    holds('9\tTWO');

    await clipboard.paste();

    // Along the columns as the reader sees them, and never into the hidden one.
    expect(changed()).toEqual([`${FIRST_ID + 1}:c2=9`, `${FIRST_ID + 1}:c1=TWO`]);
  });

  it('leaves a column it has no definition for alone, and cannot be aimed at one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    restores.push(() => warn.mockRestore());
    const harness = setup({ editable: false });
    const [c0, , c2] = makeColumns();
    const clipboard = createClipboardFor(harness, {
      columns: () => [c0!, c2!],
      onPaste: (c) => pastes.push({ changes: c, truncated: null }),
    });
    standOn(harness, 0, 0);
    holds('A\tB\t7');

    const result = await clipboard.paste();

    expect(result).toMatchObject({ status: 'pasted', cells: 3 });
    expect(changed()).toEqual([`${FIRST_ID}:c0=A`, `${FIRST_ID}:c2=7`]);
    expect(warn).toHaveBeenCalledTimes(1);

    // With no id to find it again by, the column is nowhere to paste.
    standOn(harness, 0, 1);
    const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true });
    expect(clipboard.onKeyDown(event)).toBe(false);
    expect(await clipboard.paste()).toBeNull();
    expect(stub.reads).toBe(1);
  });
});

describe('reading what is on the clipboard', () => {
  it('reads quoted cells, doubled quotes, and either kind of line break', async () => {
    editors.set({ c0: {}, c1: {}, c2: {} });
    const harness = setup();
    standOn(harness, 0, 0);
    holds('"a\tb"\t"two\r\nlines"\t"say ""hi"""\r\nx\t"unclosed\ty\r\n');

    await harness.clipboard.paste();

    expect(pastes[0]!.changes.map((change) => change.value)).toEqual([
      'a\tb',
      'two\r\nlines',
      'say "hi"',
      'x',
      // A quote that is never closed was never a quote.
      '"unclosed',
      'y',
    ]);
  });

  it('ends the last row at a trailing line break rather than starting another', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    holds('A\nB\n');
    const result = await harness.clipboard.paste();
    expect(result).toMatchObject({ status: 'pasted', cells: 2 });
  });

  it('reads a lone line break as one empty cell, and empty text as nothing', async () => {
    editors.set({ c0: {} });
    const harness = setup();
    standOn(harness, 0, 0);

    holds('\n');
    await harness.clipboard.paste();
    expect(changed()).toEqual([`${FIRST_ID}:c0=`]);

    holds('');
    const result = await harness.clipboard.paste();
    expect(result).toEqual({ status: 'failed', operation: 'paste', reason: 'empty' });
    expect(await announced('assertive')).toBe('Nothing to paste');
  });

  it('reads an HTML table the way it was shown', async () => {
    editors.set({ c0: {}, c1: {}, c2: {} });
    const harness = setup();
    standOn(harness, 0, 0);
    holds(
      null,
      '<meta charset="utf-8"><table><thead><tr><th>  Head\n  one </th><th>a<br>b</th>' +
        '<th>x <b> y</b></th></tr></thead><tbody>' +
        '<tr><td><p>First</p><p>Second</p></td><td>10&nbsp;000</td>' +
        '<td><script>no()</script>lead<div>more</div></td></tr>' +
        '</tbody></table>',
    );

    await harness.clipboard.paste();

    expect(pastes[0]!.changes.map((change) => change.value)).toEqual([
      'Head one',
      'a\nb',
      'x y',
      'First\nSecond',
      // A non-breaking space is not whitespace to HTML, and is kept.
      '10 000',
      'lead\nmore',
    ]);
  });

  it('reads a zero rowspan to the end of the table, and a zero colspan as one', async () => {
    editors.set({ c0: {}, c1: {}, c2: {} });
    const harness = setup();
    standOn(harness, 0, 0);
    holds(
      null,
      '<table><tr><td rowspan="0">A</td><td colspan="0">B</td><td>C</td></tr>' +
        '<tr><td>D</td><td>E</td></tr><tr><td>F</td><td>G</td></tr></table>',
    );

    await harness.clipboard.paste();

    expect(stored().slice(0, 3)).toEqual([
      ['A', 'B', 'C'],
      ['', 'D', 'E'],
      ['', 'F', 'G'],
    ]);
  });

  it("reads a table's own rows, and not those of a table inside one of its cells", async () => {
    editors.set({ c0: {}, c1: {}, c2: {} });
    const harness = setup();
    standOn(harness, 0, 0);
    holds(
      null,
      '<table><tr><td>A<table><tr><td>x</td></tr><tr><td>y</td></tr></table></td><td>B</td></tr>' +
        '<tr><td>C</td><td>D</td></tr></table>',
    );

    await harness.clipboard.paste();

    expect(stored()).toEqual([
      ['A\nx\ny', 'B', 1],
      ['C', 'D', 2],
      ['gamma', 'three', 3],
      ['delta', 'four', 4],
    ]);
  });

  it('fills what a merged cell spans with empty cells', async () => {
    editors.set({ c0: {}, c1: {}, c2: {} });
    const harness = setup();
    standOn(harness, 0, 0);
    holds(
      null,
      '<table><tr><td colspan="2">A</td><td rowspan="2">B</td></tr><tr><td>C</td><td>D</td></tr></table>',
    );

    await harness.clipboard.paste();

    expect(stored().slice(0, 2)).toEqual([
      ['A', '', 'B'],
      ['C', 'D', ''],
    ]);
  });

  it('reads the table where the text has lost its shape', async () => {
    editors.set({ c0: {}, c1: {}, c2: {} });
    const harness = setup();
    standOn(harness, 0, 0);
    // A document writes a cell's line break into its plain text unquoted, so
    // the text says three rows and the table says two.
    holds('one\ttwo\nlines\nthree\tfour', '<table><tr><td>one</td><td>two<br>lines</td></tr><tr><td>three</td><td>four</td></tr></table>');

    await harness.clipboard.paste();

    expect(stored().slice(0, 2)).toEqual([
      ['one', 'two\nlines', 1],
      ['three', 'four', 2],
    ]);
  });

  it('reads the text where the two agree, because only the text keeps its spaces', async () => {
    editors.set({ c0: {}, c1: {}, c2: {} });
    const harness = setup();
    standOn(harness, 0, 0);
    holds('  two  spaces ', '<table><tr><td>  two  spaces </td></tr></table>');
    await harness.clipboard.paste();
    expect(stored()[0]![0]).toBe('  two  spaces ');
  });

  it('pastes back exactly what it copied', async () => {
    people.set(
      tableOf([
        ['a\tb', 'two\nlines', '"quoted"'],
        ['  spaced  ', '<b>&amp;', ''],
        ['x', 'y', 'z'],
        ['x', 'y', 'z'],
      ]),
    );
    editors.set({ c0: {}, c1: {}, c2: {} });
    const harness = setup();
    harness.g.setCellRange({ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 2 } });
    await harness.clipboard.copy();

    harness.g.setCellRange(null);
    standOn(harness, 2, 0);
    await harness.clipboard.paste();

    expect(stored().slice(2)).toEqual(stored().slice(0, 2));
  });

  it('ends a row at a lone carriage return, and keeps a blank line as an empty row', async () => {
    editors.set({ c0: {} });
    const harness = setup();
    standOn(harness, 0, 0);
    holds('A\rB\n\nD');
    await harness.clipboard.paste();
    expect(stored().map((row) => row[0])).toEqual(['A', 'B', '', 'D']);
  });

  it('breaks a line after a block in a cell, and once however many runs follow it', async () => {
    editors.set({ c0: {} });
    const harness = setup();
    standOn(harness, 0, 0);
    holds(null, '<table><tr><td><div>a</div>b <i>c</i></td></tr></table>');
    await harness.clipboard.paste();
    expect(stored()[0]![0]).toBe('a\nb c');
  });

  it("reads only a row's cells, not a template or a script the parser keeps beside them", async () => {
    editors.set({ c0: {}, c1: {}, c2: {} });
    const harness = setup();
    standOn(harness, 0, 0);
    // A browser's parser keeps a <template> and a <script> inside a <tr>, as
    // the HTML standard says; happy-dom's moves them out of the table. So the
    // document a browser would build is built here, by hand.
    vi.stubGlobal(
      'DOMParser',
      class {
        parseFromString(): Document {
          const doc = document.implementation.createHTMLDocument('');
          doc.body.innerHTML = '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>';
          const tr = doc.querySelector('tr')!;
          const template = doc.createElement('template');
          template.innerHTML = 'T';
          const script = doc.createElement('script');
          script.textContent = 's()';
          tr.insertBefore(script, tr.lastElementChild);
          tr.insertBefore(template, tr.lastElementChild);
          return doc;
        }
      },
    );
    restores.push(() => vi.unstubAllGlobals());
    holds(null, '<table><tr><td>A</td><template>T</template><script>s()</script><td>B</td></tr></table>');

    await harness.clipboard.paste();

    expect(changed()).toEqual([`${FIRST_ID}:c0=A`, `${FIRST_ID}:c1=B`]);
  });

  it('reads a span it cannot make sense of as one', async () => {
    editors.set({ c0: {}, c1: {}, c2: {} });
    const harness = setup();
    standOn(harness, 0, 0);
    holds(
      null,
      '<table><tr><td rowspan="many">A</td><td colspan="-2">B</td><td>C</td></tr>' +
        '<tr><td>D</td><td>E</td><td>F</td></tr></table>',
    );
    await harness.clipboard.paste();
    expect(stored().slice(0, 2)).toEqual([
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
    ]);
  });

  it('reads the text where the HTML holds no table, as a spreadsheet copying one cell writes it', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    holds('ALPHA', '<meta charset="utf-8"><span data-sheets-value="x">ALPHA</span>');
    await harness.clipboard.paste();
    expect(changed()).toEqual([`${FIRST_ID}:c0=ALPHA`]);
  });

  it('reads the text alone where the page has no HTML parser', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    vi.stubGlobal('DOMParser', undefined);
    restores.push(() => vi.unstubAllGlobals());

    holds('ALPHA', '<table><tr><td>IGNORED</td></tr></table>');
    await harness.clipboard.paste();
    expect(changed()).toEqual([`${FIRST_ID}:c0=ALPHA`]);

    holds(null, '<table><tr><td>IGNORED</td></tr></table>');
    expect(await harness.clipboard.paste()).toMatchObject({ status: 'failed', reason: 'empty' });
  });

  it('reads the text where the HTML holds a table with no cells in it', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    holds('ALPHA', '<table><tr></tr></table>');
    await harness.clipboard.paste();
    expect(changed()).toEqual([`${FIRST_ID}:c0=ALPHA`]);
  });

  it('finds nothing on a clipboard holding neither text nor a table', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    stub.holds = { 'image/png': 'not text' };
    const result = await harness.clipboard.paste();
    expect(result).toEqual({ status: 'failed', operation: 'paste', reason: 'empty' });
    expect(failures).toEqual([result]);
  });
});

describe('a paste too big for the grid', () => {
  it('is cut at the last row, and says so', async () => {
    editors.set({ c0: {} });
    const harness = setup();
    standOn(harness, 2, 0);
    holds('G\nD\nE\nF');

    const result = await harness.clipboard.paste();

    expect(changed()).toEqual([`${FIRST_ID + 2}:c0=G`, `${FIRST_ID + 3}:c0=D`]);
    const truncated = { rows: 2, columns: 0, cells: 2 };
    expect(result).toMatchObject({ status: 'pasted', cells: 2, truncated });
    expect(pastes[0]!.truncated).toEqual(truncated);
    expect(await announced()).toBe('Pasted 2 of 4 cells; the rest ran past the edge of the grid');
  });

  it('is cut at the last column, and says so', async () => {
    editors.set({ c0: {}, c1: {}, c2: {} });
    const harness = setup();
    standOn(harness, 0, 1);
    // Two columns past the edge, so each cut cell is counted once, not once
    // per column still to go.
    holds('A\tB\tC\tX\nD\tE\tF\tY');

    const result = await harness.clipboard.paste();

    expect(changed()).toEqual([
      `${FIRST_ID}:c1=A`,
      `${FIRST_ID}:c2=B`,
      `${FIRST_ID + 1}:c1=D`,
      `${FIRST_ID + 1}:c2=E`,
    ]);
    expect(result).toMatchObject({
      cells: 4,
      truncated: { rows: 0, columns: 2, cells: 4 },
      bounds: { fromRow: 0, toRow: 1, fromColumn: 1, toColumn: 2 },
    });
    expect(await announced()).toBe('Pasted 4 of 8 cells; the rest ran past the edge of the grid');
  });

  it('counts a long row that fell below the last among the rows cut, not the columns covered', async () => {
    editors.set({ c0: {}, c1: {}, c2: {} });
    const harness = setup();
    standOn(harness, 3, 0);
    holds('A\nB\tC\tD');

    const result = await harness.clipboard.paste();

    // One cell landed; the three-cell row below it covered nothing.
    expect(result).toMatchObject({
      cells: 1,
      bounds: { fromRow: 3, toRow: 3, fromColumn: 0, toColumn: 0 },
      truncated: { rows: 1, columns: 0, cells: 3 },
    });
  });

  it('reads nothing past the edge, however much was pasted', async () => {
    applyChanges = false;
    editors.set({ c0: {} });
    const harness = setup();
    standOn(harness, 3, 0);
    reads = [];
    holds(Array.from({ length: 10_000 }, (_, i) => `line ${i}`).join('\n'));

    const result = await harness.clipboard.paste();

    expect(reads).toEqual([`${FIRST_ID + 3}:0`]);
    expect(result).toMatchObject({ cells: 1, truncated: { rows: 9_999, cells: 9_999 } });
  });
});

describe('refusing a paste', () => {
  it('refuses the whole paste, and reports every cell that refused', async () => {
    const harness = setup();
    standOn(harness, 0, 2);
    const before = stored();
    holds('5\nlots\n7\n-1');

    const result = await harness.clipboard.paste();

    expect(result!.status).toBe('refused');
    // Not the first refusal: both of them, so the reader fixes the clipboard
    // once rather than once per complaint.
    expect(refused).toHaveLength(1);
    expect(
      refused[0]!.map(({ rowKey, reason, message, text }) => ({ rowKey, reason, message, text })),
    ).toEqual([
      { rowKey: FIRST_ID + 1, reason: 'invalid', message: 'Enter a number', text: 'lots' },
      { rowKey: FIRST_ID + 3, reason: 'invalid', message: 'Not negative', text: '-1' },
    ]);
    // And the cells that would have been accepted are not handed over either:
    // half a paste is a rectangle with holes in it.
    expect(pastes).toEqual([]);
    expect(stored()).toEqual(before);
    expect(await announced('assertive')).toBe('Nothing pasted: 2 cells refused');
  });

  it('refuses a column with no editor, and a row its editor will not edit', async () => {
    editors.set({ c0: { editable: (row) => row.id !== FIRST_ID + 1 }, c2: NUMBER_EDITOR });
    const harness = setup();
    standOn(harness, 0, 0);
    holds('A\tONE\nB\ttwo');

    await harness.clipboard.paste();

    expect(refused[0]!.map(({ rowKey, columnId, reason, message }) => ({ rowKey, columnId, reason, message }))).toEqual([
      { rowKey: FIRST_ID, columnId: 'c1', reason: 'read-only', message: null },
      { rowKey: FIRST_ID + 1, columnId: 'c0', reason: 'read-only', message: null },
    ]);
  });

  it('finds an editor only where `editors` gives one, whatever a column is called', async () => {
    // Ids every object inherits a member under. Looked up as a property, each
    // would find that member — a function — and paste through it as an editor.
    columns.set(
      makeColumns().map((column, index) =>
        index === 1 ? { ...column, id: 'constructor' } : index === 2 ? { ...column, id: 'toString' } : column,
      ),
    );
    editors.set({ c0: {} });
    const harness = setup();
    standOn(harness, 0, 1);
    holds('ONE\t9');

    const result = await harness.clipboard.paste();

    expect(result!.status).toBe('refused');
    expect(refused[0]!.map(({ columnId, reason }) => `${columnId}:${reason}`)).toEqual([
      'constructor:read-only',
      'toString:read-only',
    ]);
    expect(pastes).toEqual([]);
  });

  it('lets a read-only cell be pasted over with what it already shows', async () => {
    // The last column read-only this time, and holding numbers, as a key does:
    // what it shows is "2", and the number 2 is not the text "2".
    editors.set({ c0: {}, c1: {} });
    const harness = setup();
    standOn(harness, 1, 0);
    // A whole copied row, its read-only column with it, back over its own row.
    holds('Beta\tTWO\t2');

    await harness.clipboard.paste();

    expect(refused).toEqual([]);
    expect(changed()).toEqual([`${FIRST_ID + 1}:c0=Beta`, `${FIRST_ID + 1}:c1=TWO`]);

    // Over a different row it is a change, and the column refuses it.
    holds('Beta\tTWO\t2');
    standOn(harness, 2, 0);
    await harness.clipboard.paste();
    expect(refused[0]!.map(({ columnId, reason }) => `${columnId}:${reason}`)).toEqual(['c2:read-only']);
  });
});

describe('the clipboard refusing, or not being there', () => {
  it('reports a copy with no Clipboard API as unavailable, and says so', async () => {
    removeClipboard();
    const harness = setup();
    standOn(harness, 0, 0);

    press(harness.root, 'c', { ctrlKey: true });
    await settled();

    expect(failures).toEqual([{ status: 'failed', operation: 'copy', reason: 'unavailable' }]);
    expect(await announced('assertive')).toBe('Could not copy');
  });

  it('reports a copy as unavailable where the page has no ClipboardItem to write', async () => {
    (window as unknown as { ClipboardItem: unknown }).ClipboardItem = undefined;
    const harness = setup();
    standOn(harness, 0, 0);

    expect(await harness.clipboard.copy()).toEqual({
      status: 'failed',
      operation: 'copy',
      reason: 'unavailable',
    });
    expect(stub.writes).toBe(0);
  });

  it('reports both as unavailable where there is no browser at all', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    vi.stubGlobal('navigator', undefined);
    restores.push(() => vi.unstubAllGlobals());

    expect(await harness.clipboard.copy()).toEqual({
      status: 'failed',
      operation: 'copy',
      reason: 'unavailable',
    });
    expect(await harness.clipboard.paste()).toEqual({
      status: 'failed',
      operation: 'paste',
      reason: 'unavailable',
    });
  });

  it('reports a paste with no Clipboard API as unavailable', async () => {
    removeClipboard();
    const harness = setup();
    standOn(harness, 0, 0);

    const result = await harness.clipboard.paste();

    expect(result).toEqual({ status: 'failed', operation: 'paste', reason: 'unavailable' });
    expect(await announced('assertive')).toBe('Could not paste');
  });

  it('reports a refused write with what the browser rejected it with', async () => {
    const denied = new DOMException('Write permission denied.', 'NotAllowedError');
    stub.refuse = denied;
    const harness = setup();
    standOn(harness, 0, 0);

    const result = await harness.clipboard.copy();

    expect(result).toEqual({ status: 'failed', operation: 'copy', reason: 'refused', error: denied });
    expect(copies).toEqual([]);
    expect(failures).toEqual([result]);
  });

  it('reports a refused read, from the keyboard, without throwing', async () => {
    const denied = new DOMException('Read permission denied.', 'NotAllowedError');
    stub.refuse = denied;
    const harness = setup();
    standOn(harness, 0, 0);

    press(harness.root, 'v', { ctrlKey: true });
    await settled();

    expect(failures).toEqual([{ status: 'failed', operation: 'paste', reason: 'refused', error: denied }]);
    expect(pastes).toEqual([]);
    expect(await announced('assertive')).toBe('Could not paste');
  });
});

describe('the view moving while the clipboard is read', () => {
  /** Holds reads until released, as a permission prompt the reader has not answered does. */
  function hold(): () => void {
    let release!: () => void;
    stub.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  it('pastes onto the row it was aimed at, wherever a sort has moved it', async () => {
    const harness = setup();
    standOn(harness, 1, 0);
    holds('BETA');
    const release = hold();

    const pasting = harness.clipboard.paste();
    harness.g.setSort([{ columnId: 'c0', direction: 'descending' }]);
    flushSync();
    // delta, gamma, beta, alpha: the row the reader aimed at is third now, and
    // gamma has slid into the place it had.
    expect(harness.g.rowIndex(FIRST_ID + 1)).toBe(2);
    release();
    await pasting;

    expect(pastes[0]!.changes).toMatchObject([{ rowKey: FIRST_ID + 1, rowIndex: 2, previous: 'beta' }]);
  });

  it('reports a paste whose row has gone, rather than lay it over another', async () => {
    const harness = setup();
    standOn(harness, 1, 0);
    holds('BETA');
    const release = hold();

    const pasting = harness.clipboard.paste();
    harness.g.setFilter('c0', { type: 'text', value: 'alpha', operator: 'equals' });
    flushSync();
    release();

    expect(await pasting).toEqual({ status: 'failed', operation: 'paste', reason: 'gone' });
    expect(pastes).toEqual([]);
  });

  it('pastes onto its row when a refresh has handed the same record back as a new object', async () => {
    const harness = setup();
    standOn(harness, 1, 0);
    holds('BETA');
    const release = hold();

    const pasting = harness.clipboard.paste();
    // A store that replaces what it changes, or a refetch: every record is
    // where it was, under the key it had, in an object it did not have.
    const fresh = people.get().map((person) => ({ ...person }));
    people.set(fresh);
    flushSync();
    release();

    expect(await pasting).toMatchObject({ status: 'pasted' });
    expect(pastes[0]!.changes).toMatchObject([{ rowKey: FIRST_ID + 1, previous: 'beta' }]);
    // Named by the object the view holds now, which is the one the caller has.
    expect(pastes[0]!.changes[0]!.item).toBe(fresh[1]);
  });

  it('lands both of two pastes pressed before the clipboard answered, on a store that replaces rows', async () => {
    replaceRows = true;
    const harness = setup();
    standOn(harness, 1, 0);
    holds('BETA');
    const release = hold();

    // Ctrl+V pressed twice, or held down: both reads are out before either
    // answers, and the first to land hands its row back as a new object.
    const first = harness.clipboard.paste();
    const second = harness.clipboard.paste();
    release();

    expect(await first).toMatchObject({ status: 'pasted' });
    expect(await second).toMatchObject({ status: 'pasted', changes: [] });
    expect(failures).toEqual([]);
  });

  it('reports a paste as gone on a grid keyed by place, once a sort gives the place to another row', async () => {
    const harness = setup({ gridKeys: false, clipboardKeys: false });
    standOn(harness, 1, 0);
    holds('BETA');
    const release = hold();

    const pasting = harness.clipboard.paste();
    // delta, gamma, beta, alpha: key 1 is gamma's now.
    harness.g.setSort([{ columnId: 'c0', direction: 'descending' }]);
    flushSync();
    release();

    expect(await pasting).toEqual({ status: 'failed', operation: 'paste', reason: 'gone' });
    expect(pastes).toEqual([]);
  });

  it('hands nothing over when an editor has opened while the clipboard was read', async () => {
    const harness = setup();
    standOn(harness, 1, 0);
    holds('BETA');
    const release = hold();

    const pasting = harness.clipboard.paste();
    // The reader went on to type into the very cell the paste was aimed at.
    expect(harness.editing.beginAt({ row: 1, column: 0 })).toBe(true);
    flushSync();
    release();

    expect(await pasting).toBeNull();
    expect(pastes).toEqual([]);
    expect(harness.editing.session()).not.toBeNull();
  });

  it('pastes into the column it was aimed at, wherever the columns have moved', async () => {
    editors.set({ c0: {}, c1: {}, c2: {} });
    const harness = setup();
    standOn(harness, 1, 1);
    holds('TWO');
    const release = hold();

    const pasting = harness.clipboard.paste();
    // c1, c2, c0: the column aimed at is first now, and c2 has its place.
    const [first, ...rest] = columns.get();
    columns.set([...rest, first!]);
    flushSync();
    release();
    await pasting;

    expect(changed()).toEqual([`${FIRST_ID + 1}:c1=TWO`]);
  });

  it('reports a paste whose column has gone', async () => {
    const harness = setup();
    standOn(harness, 1, 2);
    holds('9');
    const release = hold();

    const pasting = harness.clipboard.paste();
    columns.set(columns.get().slice(0, 2));
    flushSync();
    release();

    expect(await pasting).toEqual({ status: 'failed', operation: 'paste', reason: 'gone' });
  });

  it('says, in development, when it was given row keys the grid does not use', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    restores.push(() => warn.mockRestore());
    const harness = setup({ clipboardKeys: false });
    standOn(harness, 1, 0);
    holds('BETA');

    // Given the grid's own, it has nothing to say.
    await createClipboardFor(harness, {}).paste();
    expect(warn).not.toHaveBeenCalled();

    const result = await harness.clipboard.paste();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('same getRowKey');
    expect(result).toMatchObject({ status: 'failed', reason: 'gone' });
  });
});

describe('the keyboard', () => {
  it('does nothing while an editor is open, because the text field owns the clipboard', async () => {
    const harness = setup();
    const row = harness.g.rows().find((candidate) => candidate.index === 1)!;
    const col = harness.g.columns().find((candidate) => candidate.index === 0)!;
    harness.editing.begin(row, col);
    flushSync();
    expect(host.querySelector(`[${GRID_EDITOR_ATTRIBUTE}]`)).not.toBeNull();
    holds('X');

    // Asked directly, without the editing layer in front of it claiming the key.
    const paste = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true });
    expect(harness.clipboard.onKeyDown(paste)).toBe(false);
    expect(paste.defaultPrevented).toBe(false);
    const copy = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true });
    expect(harness.clipboard.onKeyDown(copy)).toBe(false);

    expect(await harness.clipboard.paste()).toBeNull();
    expect(await harness.clipboard.copy()).toBeNull();
    expect(stub.reads).toBe(0);
    expect(stub.writes).toBe(0);
  });

  it('leaves a field someone types into to its own clipboard', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    const search = host.querySelector<HTMLInputElement>('.search')!;

    const event = press(search, 'c', { ctrlKey: true });
    press(search, 'v', { ctrlKey: true });
    await settled();

    expect(harness.instance.handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(stub.writes + stub.reads).toBe(0);
  });

  it('leaves every kind of text field to its own clipboard, and takes the key from any other control', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    const cell = cellAt(0, 0)!;
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    const fields = [document.createElement('textarea'), editable];

    for (const field of fields) {
      cell.append(field);
      const event = press(field, 'c', { ctrlKey: true });
      expect(harness.instance.handled).toBe(false);
      expect(event.defaultPrevented).toBe(false);
      field.remove();
    }
    await settled();
    expect(stub.writes).toBe(0);

    // A checkbox in a cell takes no typed text, so Ctrl+C there is the cell's.
    const box = document.createElement('input');
    box.type = 'checkbox';
    cell.append(box);
    press(box, 'c', { ctrlKey: true });
    expect(harness.instance.handled).toBe(true);
    await settled();
    expect(stub.holds['text/plain']).toBe('alpha');

    // Nor does an icon, which is not even an HTML element.
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    cell.append(icon);
    press(icon, 'c', { ctrlKey: true });
    expect(harness.instance.handled).toBe(true);
  });

  it('does nothing, and leaves the keys to the page, before there is a grid', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    const early = createClipboardFor(harness, { grid: () => null });
    const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true });

    expect(early.onKeyDown(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(await early.copy()).toBeNull();
    expect(await early.paste()).toBeNull();
    expect(stub.writes + stub.reads).toBe(0);
  });

  it("leaves an editor that is not a native field to itself, by the editing layer's mark", async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    // No editing layer to ask whether a session is open: the mark is all
    // there is to say a custom editor — a picker, a stepper — has the keys.
    const bare = createClipboardFor(harness, {});
    const picker = document.createElement('div');
    picker.setAttribute(GRID_EDITOR_ATTRIBUTE, '');
    const button = document.createElement('button');
    picker.append(button);
    cellAt(0, 0)!.append(picker);
    let handled: boolean | null = null;
    button.addEventListener('keydown', (event) => {
      handled = bare.onKeyDown(event);
    });

    press(button, 'v', { ctrlKey: true });
    await settled();

    expect(handled).toBe(false);
    expect(stub.reads).toBe(0);
  });

  it('leaves C and V with Shift or Alt alone', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    press(harness.root, 'V', { ctrlKey: true, shiftKey: true });
    press(harness.root, 'c', { ctrlKey: true, altKey: true });
    press(harness.root, 'c');
    await settled();
    expect(stub.writes + stub.reads).toBe(0);
  });

  it('knows the keys by where they are on a layout that types another script', async () => {
    const harness = setup();
    standOn(harness, 0, 0);

    // Russian: the key a Latin layout calls C types "с", and V types "м".
    press(harness.root, 'с', { ctrlKey: true, code: 'KeyC' });
    await settled();
    expect(stub.holds['text/plain']).toBe('alpha');
    press(harness.root, 'м', { ctrlKey: true, code: 'KeyV' });
    await settled();
    expect(stub.reads).toBe(1);

    // Dvorak: "j" sits where QWERTY has C, and is a Latin letter that is not C.
    stub.holds = {};
    press(harness.root, 'j', { ctrlKey: true, code: 'KeyC' });
    await settled();
    expect(stub.writes).toBe(1);
  });

  it('takes an accented Latin letter for itself, and a key that types no letter for nothing', async () => {
    const harness = setup();
    standOn(harness, 0, 0);
    holds('X');

    // Neo: "ä" sits where QWERTY has C. It is a Latin letter, and not C.
    press(harness.root, 'ä', { ctrlKey: true, code: 'KeyC' });
    // A layout that put punctuation where QWERTY has V.
    press(harness.root, '.', { ctrlKey: true, code: 'KeyV' });
    await settled();

    expect(harness.instance.handled).toBe(false);
    expect(stub.writes + stub.reads).toBe(0);
  });
});

describe('what it says, in the language the application speaks', () => {
  it("takes its sentences from the locale's catalogue, counts and all", async () => {
    catalogue = {
      gridCellsCopied: { one: '{n} Zelle kopiert', other: '{n} Zellen kopiert' },
      gridPasteRefused: 'Nichts eingefügt: {n} abgelehnt',
    };
    const harness = setup();
    harness.g.setCellRange({ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } });
    await harness.clipboard.copy();
    expect(await announced()).toBe('4 Zellen kopiert');

    harness.g.setCellRange(null);
    standOn(harness, 0, 1);
    holds('EINS');
    await harness.clipboard.paste();
    expect(await announced('assertive')).toBe('Nichts eingefügt: 1 abgelehnt');
  });

  it('says how much of a cut paste went in, in the catalogue\'s words', async () => {
    catalogue = { gridPasteTruncated: '{n} von {m} Zellen eingefügt' };
    editors.set({ c0: {} });
    const harness = setup();
    standOn(harness, 3, 0);
    holds('D\nE\nF');
    await harness.clipboard.paste();
    expect(await announced()).toBe('1 von 3 Zellen eingefügt');
  });

  it('takes sentences of its own for both', async () => {
    catalogue = null;
    const harness = setup();
    standOn(harness, 0, 0);
    // Replaced wholesale rather than through the catalogue: the caller's own
    // words for its own grid.
    const custom = createClipboardFor(harness, {
      copyAnnouncement: (result) => (result.status === 'copied' ? 'Row copied' : 'No'),
      pasteAnnouncement: (result) => (result.status === 'pasted' ? 'Row pasted' : 'No'),
    });
    await custom.copy();
    expect(await announced()).toBe('Row copied');

    resetAnnouncer();
    holds('ALPHA');
    await custom.paste();
    expect(await announced()).toBe('Row pasted');
  });
});

describe('what it says in development', () => {
  it('says when it was given the editing layer without its editors', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    restores.push(() => warn.mockRestore());
    // Both, and neither: nothing to say.
    const harness = setup();
    createClipboardFor(harness, {});
    expect(warn).not.toHaveBeenCalled();

    // A paste would write every column's text — the read-only ones too —
    // unparsed and unvalidated, with nothing to say why.
    createClipboardFor(harness, { editing: () => harness.editing });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('no `editors`');
  });
});

/** A second clipboard over the same grid, for options the harness does not set. */
function createClipboardFor(
  harness: Harness,
  extra: Partial<Parameters<typeof createGridClipboard<Person>>[0]>,
): GridClipboard<Person> {
  return createGridClipboard<Person>({
    grid: () => harness.g,
    columns: () => columns.get(),
    getRowKey: (row) => row.id,
    onPaste: () => {},
    ...extra,
  });
}
