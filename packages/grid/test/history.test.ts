/**
 * Undo and redo, driven through a real mounted grid with an editing layer.
 *
 * The claims worth proving are the ones that fail quietly: that nothing is
 * recorded until the caller says it was applied, that a step finds its row by
 * key after a sort has moved it, that a row that has gone is skipped and said
 * so, that steps wait their turn behind a save that is still out, and that an
 * undo costs one accessor run and one text node — no more than the edit did.
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
  createEditHistory,
  createGrid,
  type Grid,
  type GridCellEditing,
  type GridClipboard,
  type GridColumn,
  type GridEditHistory,
  type GridHistoryKind,
  type GridHistoryRecord,
  type GridHistoryStep,
  type GridRow,
} from '../src/index.ts';

/** A row whose every cell is a signal — the shape the whole design rests on. */
interface Person {
  readonly id: number;
  readonly cells: readonly Signal.State<string>[];
}

const ROW_HEIGHT = 20;
const COLUMN_WIDTH = 100;
const VIEWPORT_HEIGHT = 100;
const VIEWPORT_WIDTH = 300;

/** Every accessor call, as `row:column`. The evidence for what re-rendered. */
let reads: string[] = [];
/** Every call to history's `getRowKey`. The evidence for what it scanned. */
let keyReads = 0;

const COLUMN_IDS: readonly string[] = ['c0', 'c1', 'c2'];

function makeColumns(): GridColumn<Person>[] {
  return COLUMN_IDS.map((id, index) => ({
    id,
    header: `Column ${index}`,
    width: COLUMN_WIDTH,
    value: (row: Person) => {
      reads.push(`${row.id}:${index}`);
      return row.cells[index]!.get();
    },
  }));
}

const TABLE: readonly (readonly string[])[] = [
  ['alpha', 'one', '1'],
  ['beta', 'two', '2'],
  ['gamma', 'three', '3'],
  ['delta', 'four', '4'],
];

/**
 * Frozen, rows and array alike. History has no business assigning to either,
 * and a frozen object turns a write that should never happen into a throw.
 */
function tableOf(cells: readonly (readonly string[])[]): readonly Person[] {
  return Object.freeze(
    cells.map((values, id) =>
      Object.freeze({ id, cells: values.map((value) => new Signal.State(value)) }),
    ),
  );
}

type Mode = 'accept' | 'refuse' | 'defer' | 'throw' | 'forget' | 'truthy' | 'response';

interface Pending {
  settle(applied: boolean): void;
  fail(error: Error): void;
}

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;

let people: Signal.State<readonly Person[]>;
let columns: Signal.State<readonly GridColumn<Person>[]>;
/** What the caller's store does with a step: take it, refuse it, or answer later. */
let mode: Mode;
let steps: GridHistoryStep<Person>[];
let pending: Pending[];
let skips: { skipped: readonly GridHistoryRecord[]; kind: GridHistoryKind }[];
let catalogue: MessageCatalog | null;
/** Something the store does as it is handed a step, before it answers. */
let during: ((step: GridHistoryStep<Person>) => void) | null;

/**
 * What a caller's store does: write each change into the signal its cell reads.
 * By the record's own fields, not the grid's columns: a column the grid has
 * stopped showing is still a field of the record.
 */
function write(step: GridHistoryStep<Person>): void {
  for (const change of step.changes) {
    change.item.cells[COLUMN_IDS.indexOf(change.columnId)]!.set(String(change.value));
  }
}

function apply(step: GridHistoryStep<Person>): boolean | Promise<boolean> {
  steps.push(step);
  during?.(step);
  switch (mode) {
    case 'refuse':
      return false;
    case 'throw':
      throw new Error('the store is down');
    case 'forget':
      // A caller in plain JavaScript that wrote the change and never said so.
      write(step);
      return undefined as unknown as boolean;
    case 'truthy':
      write(step);
      return 1 as unknown as boolean;
    case 'response':
      // The server's reply handed back as it came, rather than whether it took.
      write(step);
      return Promise.resolve({ ok: true } as unknown as boolean);
    case 'defer':
      return new Promise<boolean>((resolve, reject) => {
        pending.push({
          settle: (applied) => {
            if (applied) write(step);
            resolve(applied);
          },
          fail: reject,
        });
      });
    default:
      write(step);
      return true;
  }
}

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
  keyReads = 0;
  mode = 'accept';
  steps = [];
  pending = [];
  skips = [];
  catalogue = null;
  during = null;
  people = new Signal.State<readonly Person[]>(tableOf(TABLE));
  columns = new Signal.State<readonly GridColumn<Person>[]>(makeColumns());

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

// A search box sits in the header, inside the grid element, because that is
// where a filter row would put one — and Ctrl+Z typed into it is its own. The
// history is `edits` and not `history`, which a template reads as the
// browser's own.
const TEMPLATE = `
  <div class="toolbar">
    <button class="undo" :disabled="!edits.canUndo()" :click="edits.undo()">Undo</button>
    <button class="redo" :disabled="!edits.canRedo()" :click="edits.redo()">Redo</button>
  </div>
  <div class="grid" :ref="grid" :spread="g.gridProps()"
       :keydown="onKey($event)" :focusin="g.onFocusIn($event)">
    <div class="header" :spread="g.headerProps()">
      <input class="search">
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
              <input :if="editing.isEditing(row, col)" class="editor"
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

interface HistoryInstance {
  g: Grid<Person>;
  editing: GridCellEditing<Person>;
  edits: GridEditHistory<Person>;
  clipboard: GridClipboard<Person> | null;
  handled: boolean;
}

interface Harness {
  g: Grid<Person>;
  editing: GridCellEditing<Person>;
  history: GridEditHistory<Person>;
  instance: HistoryInstance;
  root: HTMLElement;
}

interface SetupOptions {
  keyed?: boolean;
  /** History given a grid function that answers null — a grid not built yet, or gone. */
  withoutGrid?: boolean;
  depth?: number;
  /** Wired before the editing layer, so only history's own check stands between Ctrl+Z and an open editor. */
  historyFirst?: boolean;
  announcement?: (kind: 'undo' | 'redo', count: number) => string;
  /** A clipboard layer whose pastes go through history, as the documentation wires one. */
  withClipboard?: boolean;
}

function setup({
  keyed = true,
  withoutGrid = false,
  depth,
  historyFirst = false,
  announcement,
  withClipboard = false,
}: SetupOptions = {}): Harness {
  @Component({ selector: `v-history-${++selectors}`, render: compileTemplate(TEMPLATE) })
  class HistoryGrid {
    // Before the history, which reads the nearest locale when it is created.
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
      // Left out for the grid the documentation warns about: one whose rows
      // are identified by nothing but the place they are in.
      getRowKey: keyed ? (row: Person) => row.id : undefined,
      rowHeight: ROW_HEIGHT,
      label: 'People',
    });

    editing = createCellEditing<Person>({
      grid: () => this.g,
      editors: () => ({ c0: {}, c1: {}, c2: {} }),
      columns: () => columns.get(),
      // The whole of the wiring: a commit goes through history on its way to
      // the store, and nothing else writes.
      onCommit: (change) => void this.edits.commit(change),
    });

    edits = createEditHistory<Person>({
      grid: () => (withoutGrid ? null : this.g),
      rows: () => people.get(),
      getRowKey: (row) => {
        keyReads++;
        return row.id;
      },
      editing: () => this.editing,
      depth,
      apply,
      onSkip: (skipped, kind) => skips.push({ skipped, kind }),
      announcement,
    });

    clipboard = withClipboard
      ? createGridClipboard<Person>({
          grid: () => this.g,
          columns: () => columns.get(),
          getRowKey: (row) => row.id,
          editing: () => this.editing,
          onPaste: (changes) => void this.edits.commit(changes),
        })
      : null;

    cellProps(row: GridRow<Person>, col: never): Record<string, unknown> {
      return { ...this.g.cellProps(row, col), ...this.editing.cellProps(row, col) };
    }

    onKey(event: KeyboardEvent): void {
      this.handled = historyFirst
        ? this.edits.onKeyDown(event) || this.editing.onKeyDown(event) || this.g.onKeyDown(event)
        : this.editing.onKeyDown(event) || this.edits.onKeyDown(event) || this.g.onKeyDown(event);
    }
  }

  const handle = mount(HistoryGrid, host);
  mounted.push(handle);

  const scroller = host.querySelector<HTMLElement>('.body')!;
  Object.defineProperty(scroller, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true });
  Object.defineProperty(scroller, 'clientWidth', { value: VIEWPORT_WIDTH, configurable: true });
  FakeResizeObserver.deliver([{ target: scroller, block: VIEWPORT_HEIGHT, inline: VIEWPORT_WIDTH }]);

  const instance = handle.instance as HistoryInstance;
  return {
    g: instance.g,
    editing: instance.editing,
    history: instance.edits,
    instance,
    root: host.querySelector<HTMLElement>('.grid')!,
  };
}

function cells(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.cell')];
}

function cellAt(row: number, column: number): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[${GRID_CELL_ATTRIBUTE}="${row},${column}"]`);
}

function textAt(row: number, column: number): string | null {
  return cellAt(row, column)?.textContent ?? null;
}

/** The text node each cell renders its value into, by the cell that holds it. */
function textNodesByCell(): Map<HTMLElement, ChildNode | null> {
  const nodes = new Map<HTMLElement, ChildNode | null>();
  for (const cell of cells()) nodes.set(cell, cell.querySelector('.text')?.firstChild ?? null);
  return nodes;
}

function changedTextNodes(before: Map<HTMLElement, ChildNode | null>): HTMLElement[] {
  return cells().filter((cell) => before.get(cell) !== (cell.querySelector('.text')?.firstChild ?? null));
}

function button(name: 'undo' | 'redo'): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>(`.${name}`)!;
}

function press(el: Element, key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

/** A key pressed where the reader is: on whatever has focus, inside the grid. */
function pressHere(key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return press(document.activeElement!, key, modifiers);
}

/** An edit made the way a reader makes one: open the cell, type, press Enter. */
function edit(harness: Harness, row: number, column: number, text: string): void {
  harness.g.focusCell({ row, column });
  flushSync();
  pressHere('Enter');
  const input = host.querySelector<HTMLInputElement>(`[${GRID_EDITOR_ATTRIBUTE}]`)!;
  input.focus();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  press(input, 'Enter');
}

/** A paste's worth of changes: one per cell, each from what the cell holds now. */
function paste(harness: Harness, cellsToWrite: readonly [number, number, string][]): Promise<boolean> {
  const source = people.get();
  const ids = columns.get();
  const promise = harness.history.commit(
    cellsToWrite.map(([id, column, value]) => ({
      item: source.find((person) => person.id === id)!,
      columnId: ids[column]!.id,
      previous: source.find((person) => person.id === id)!.cells[column]!.get(),
      value,
    })),
  );
  flushSync();
  return promise;
}

/** What one step asked the store to write, without the row objects in the way. */
function changesOf(index: number): { rowKey: unknown; rowIndex: number; value: unknown }[] {
  return steps[index]!.changes.map(({ rowKey, rowIndex, value }) => ({ rowKey, rowIndex, value }));
}

const untracked = Signal.subtle.untrack;

/** Long enough for every promise a settled `apply` started to have run its course. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
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

function undo(harness: Harness): Promise<boolean> {
  const promise = harness.history.undo();
  flushSync();
  return promise;
}

function redo(harness: Harness): Promise<boolean> {
  const promise = harness.history.redo();
  flushSync();
  return promise;
}

// ---------------------------------------------------------------------------

describe('committing through history', () => {
  it('hands a commit to apply, and records it once apply says it took', async () => {
    const harness = setup();
    const row = people.get()[1]!;
    expect(harness.history.canUndo()).toBe(false);

    edit(harness, 1, 0, 'beta!');

    expect(steps).toEqual([
      {
        kind: 'commit',
        changes: [
          { item: row, rowKey: 1, rowIndex: 1, columnId: 'c0', previous: 'beta', value: 'beta!' },
        ],
      },
    ]);
    expect(textAt(1, 0)).toBe('beta!');
    expect(harness.history.canUndo()).toBe(true);
    expect(harness.history.canRedo()).toBe(false);
  });

  it('records nothing apply refused, as the server that said no would want', async () => {
    mode = 'refuse';
    const harness = setup();

    edit(harness, 1, 0, 'beta!');

    expect(steps).toHaveLength(1);
    // Refused, so nothing changed and nothing is there to take back: a Ctrl+Z
    // now would "undo" a value no store ever held.
    expect(textAt(1, 0)).toBe('beta');
    expect(harness.history.canUndo()).toBe(false);
    await expect(undo(harness)).resolves.toBe(false);
    expect(steps).toHaveLength(1);
  });

  it('resolves whether the change was applied', async () => {
    const harness = setup();
    await expect(paste(harness, [[0, 0, 'ALPHA']])).resolves.toBe(true);
    mode = 'refuse';
    await expect(paste(harness, [[0, 0, 'Alpha']])).resolves.toBe(false);
  });

  it('never writes to a row or to the array itself', async () => {
    // The caller declines everything, so anything that changed was changed by
    // history — and the rows are frozen, so an assignment would have thrown.
    mode = 'refuse';
    const harness = setup();
    const source = people.get();

    await paste(harness, [[0, 0, 'ALPHA'], [1, 1, 'TWO']]);
    await undo(harness);
    await redo(harness);

    expect(people.get()).toBe(source);
    expect(source.map((person) => person.cells.map((cell) => cell.get()))).toEqual(TABLE);
  });

  it('drops a change that leaves the value as it was at once, without waiting behind a save', async () => {
    const harness = setup();
    mode = 'defer';
    const saving = paste(harness, [[1, 0, 'B']]);
    const dropped = harness.history.commit({
      item: people.get()[0]!,
      columnId: 'c0',
      previous: 'alpha',
      value: 'alpha',
    });
    const first = await Promise.race([dropped.then(() => 'answered'), settled().then(() => 'waiting')]);
    expect(first).toBe('answered');
    await expect(dropped).resolves.toBe(false);
    expect(steps).toHaveLength(1);

    pending[0]!.settle(true);
    await expect(saving).resolves.toBe(true);
  });

  it('drops a change that leaves the value as it was, and hands apply nothing', async () => {
    const harness = setup();
    const row = people.get()[0]!;

    await expect(
      harness.history.commit({ item: row, columnId: 'c0', previous: 'alpha', value: 'alpha' }),
    ).resolves.toBe(false);
    expect(steps).toEqual([]);
    expect(harness.history.canUndo()).toBe(false);
  });

  it('makes one step of many changes, and undoes them together, last first', async () => {
    const harness = setup();

    await paste(harness, [
      [0, 0, 'ALPHA'],
      [0, 1, 'ONE'],
      [1, 0, 'BETA'],
      [1, 1, 'TWO'],
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.changes).toHaveLength(4);

    await undo(harness);
    // One press took back the whole paste, in reverse.
    expect(steps).toHaveLength(2);
    expect(steps[1]!.kind).toBe('undo');
    expect(steps[1]!.changes.map((change) => [change.rowKey, change.columnId, change.value])).toEqual([
      [1, 'c1', 'two'],
      [1, 'c0', 'beta'],
      [0, 'c1', 'one'],
      [0, 'c0', 'alpha'],
    ]);
    expect([textAt(0, 0), textAt(0, 1), textAt(1, 0), textAt(1, 1)]).toEqual([
      'alpha',
      'one',
      'beta',
      'two',
    ]);
    expect(harness.history.canUndo()).toBe(false);
  });

  it('makes one step of a paste the clipboard layer hands over, and undoes it with one key', async () => {
    const offered = 'ALPHA\tONE\nBETA\tTWO';
    const view = navigator as unknown as { clipboard: unknown };
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: async () => [
          {
            types: ['text/plain'],
            getType: async (type: string) => new Blob([offered], { type }),
          },
        ],
      },
    });
    restores.push(() => {
      if (original === undefined) delete view.clipboard;
      else Object.defineProperty(navigator, 'clipboard', original);
    });
    const harness = setup({ withClipboard: true });
    harness.g.focusCell({ row: 0, column: 0 });
    flushSync();

    await harness.instance.clipboard!.paste();
    await settled();
    expect(steps).toHaveLength(1);
    expect(changesOf(0).map((change) => change.value)).toEqual(['ALPHA', 'ONE', 'BETA', 'TWO']);

    pressHere('z', { ctrlKey: true });
    expect(steps).toHaveLength(2);
    expect([textAt(0, 0), textAt(0, 1), textAt(1, 0), textAt(1, 1)]).toEqual(['alpha', 'one', 'beta', 'two']);
    expect(harness.history.canUndo()).toBe(false);
  });

  it('puts a cell a step wrote twice back as it was before either write', async () => {
    const harness = setup();
    const row = people.get()[0]!;

    await harness.history.commit([
      { item: row, columnId: 'c0', previous: 'alpha', value: 'first' },
      { item: row, columnId: 'c0', previous: 'first', value: 'second' },
    ]);
    flushSync();
    expect(textAt(0, 0)).toBe('second');

    await undo(harness);
    expect(textAt(0, 0)).toBe('alpha');
  });

  it('clears redo when a new change is recorded, and not before', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'ALPHA']]);
    await undo(harness);
    expect(harness.history.canRedo()).toBe(true);

    // A refused change is not a change, and leaves the future where it was.
    mode = 'refuse';
    await paste(harness, [[1, 0, 'BETA']]);
    expect(harness.history.canRedo()).toBe(true);

    mode = 'accept';
    await paste(harness, [[1, 0, 'BETA']]);
    expect(harness.history.canRedo()).toBe(false);
  });
});

describe('undo and redo', () => {
  it('hands back the inverse, and moves the step to redo once apply took it', async () => {
    const harness = setup();
    const row = people.get()[1]!;
    edit(harness, 1, 0, 'beta!');

    await expect(undo(harness)).resolves.toBe(true);

    expect(steps[1]).toEqual({
      kind: 'undo',
      changes: [{ item: row, rowKey: 1, rowIndex: 1, columnId: 'c0', previous: 'beta!', value: 'beta' }],
    });
    expect(textAt(1, 0)).toBe('beta');
    expect(harness.history.canUndo()).toBe(false);
    expect(harness.history.canRedo()).toBe(true);

    await expect(redo(harness)).resolves.toBe(true);
    expect(steps[2]).toEqual({
      kind: 'redo',
      changes: [{ item: row, rowKey: 1, rowIndex: 1, columnId: 'c0', previous: 'beta', value: 'beta!' }],
    });
    expect(textAt(1, 0)).toBe('beta!');
    expect(harness.history.canUndo()).toBe(true);
    expect(harness.history.canRedo()).toBe(false);
  });

  it('leaves the step where it was when apply refuses the undo, to be tried again', async () => {
    const harness = setup();
    edit(harness, 1, 0, 'beta!');

    mode = 'refuse';
    await expect(undo(harness)).resolves.toBe(false);
    expect(textAt(1, 0)).toBe('beta!');
    expect(harness.history.canUndo()).toBe(true);
    expect(harness.history.canRedo()).toBe(false);

    mode = 'accept';
    await expect(undo(harness)).resolves.toBe(true);
    expect(textAt(1, 0)).toBe('beta');
  });

  it('leaves the step where it was when apply refuses the redo', async () => {
    const harness = setup();
    edit(harness, 1, 0, 'beta!');
    await undo(harness);

    mode = 'refuse';
    await expect(redo(harness)).resolves.toBe(false);
    expect(harness.history.canRedo()).toBe(true);
    expect(harness.history.canUndo()).toBe(false);
  });

  it('resolves false with nothing to undo or redo, and hands apply nothing', async () => {
    const harness = setup();
    await expect(undo(harness)).resolves.toBe(false);
    await expect(redo(harness)).resolves.toBe(false);
    expect(steps).toEqual([]);
  });

  it('records nothing while a save is out, and moves the step once it answers', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'ALPHA']]);

    mode = 'defer';
    const done = undo(harness);
    expect(steps).toHaveLength(2);
    // The server has not answered, so nothing has moved.
    expect(textAt(0, 0)).toBe('ALPHA');
    expect(harness.history.canRedo()).toBe(false);

    pending[0]!.settle(true);
    await expect(done).resolves.toBe(true);
    await settled();
    expect(textAt(0, 0)).toBe('alpha');
    expect(harness.history.canUndo()).toBe(false);
    expect(harness.history.canRedo()).toBe(true);
  });

  it('takes back two steps for two undos pressed while a save is out, not one step twice', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'ALPHA']]);
    await paste(harness, [[1, 0, 'BETA']]);

    mode = 'defer';
    const first = undo(harness);
    const second = undo(harness);
    // The second waits its turn rather than being handed the same step.
    expect(steps).toHaveLength(3);
    expect(steps[2]!.changes[0]!.rowKey).toBe(1);

    pending[0]!.settle(true);
    await first;
    await settled();
    expect(steps).toHaveLength(4);
    expect(steps[3]!.changes[0]!.rowKey).toBe(0);

    pending[1]!.settle(true);
    await second;
    await settled();
    expect([textAt(0, 0), textAt(1, 0)]).toEqual(['alpha', 'beta']);
    expect(harness.history.canUndo()).toBe(false);
  });

  it('undoes an edit still saving once it lands, rather than the one before it', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);

    mode = 'defer';
    const committed = paste(harness, [[1, 0, 'B']]);
    // Pressed straight after the edit, while its save is out. The top of the
    // stack is still the older step; the one the reader means is on its way.
    const undone = undo(harness);
    expect(steps).toHaveLength(2);

    pending[0]!.settle(true);
    await committed;
    await settled();
    expect(changesOf(2)).toEqual([{ rowKey: 1, rowIndex: 1, value: 'beta' }]);

    pending[1]!.settle(true);
    await expect(undone).resolves.toBe(true);
    await settled();
    expect([textAt(0, 0), textAt(1, 0)]).toEqual(['A', 'beta']);
  });

  it('lands a commit made during an undo after it, rather than beside it', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'ALPHA']]);

    mode = 'defer';
    const undone = undo(harness);
    const committed = paste(harness, [[1, 0, 'BETA']]);
    // Not handed over yet: two writes in flight at once could reach the store
    // in either order.
    expect(steps).toHaveLength(2);

    pending[0]!.settle(true);
    await undone;
    await settled();
    expect(steps).toHaveLength(3);
    expect(steps[2]!.kind).toBe('commit');

    pending[1]!.settle(true);
    await committed;
    await settled();
    // The commit came after the undo, so the undo's future is gone and the
    // commit is what Ctrl+Z reaches next.
    expect(harness.history.canRedo()).toBe(false);
    mode = 'accept';
    await undo(harness);
    expect([textAt(0, 0), textAt(1, 0)]).toEqual(['alpha', 'beta']);
    expect(harness.history.canUndo()).toBe(false);
  });

  it('rejects when apply throws, records nothing, and carries on with the next step', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'ALPHA']]);

    mode = 'throw';
    await expect(undo(harness)).rejects.toThrow('the store is down');
    expect(harness.history.canUndo()).toBe(true);
    expect(harness.history.canRedo()).toBe(false);

    mode = 'accept';
    await expect(undo(harness)).resolves.toBe(true);
    expect(textAt(0, 0)).toBe('alpha');
  });

  it('takes anything but true as a refusal, however truthy', async () => {
    const harness = setup();
    for (const answer of ['truthy', 'response'] as const) {
      mode = answer;
      await expect(paste(harness, [[0, 0, answer]])).resolves.toBe(false);
      expect(textAt(0, 0)).toBe(answer);
      expect(harness.history.canUndo()).toBe(false);
    }
  });

  it('takes an apply that answers nothing as a refusal, rather than failing', async () => {
    const harness = setup();
    mode = 'forget';
    await expect(paste(harness, [[0, 0, 'A']])).resolves.toBe(false);
    // Written, because the store did write it — but not recorded, because
    // nothing said it had: only a `true` is a yes.
    expect(textAt(0, 0)).toBe('A');
    expect(harness.history.canUndo()).toBe(false);
  });

  it('rejects when a deferred apply fails, records nothing, and runs what was waiting', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'ALPHA']]);

    mode = 'defer';
    const failed = undo(harness);
    const waiting = paste(harness, [[1, 0, 'BETA']]);
    pending[0]!.fail(new Error('timed out'));
    await expect(failed).rejects.toThrow('timed out');
    await settled();

    expect(harness.history.canRedo()).toBe(false);
    // The commit behind it was not lost with it.
    expect(steps).toHaveLength(3);
    pending[1]!.settle(true);
    await expect(waiting).resolves.toBe(true);
  });

  it('runs the step queued behind one whose apply throws at once, with nothing else asking', async () => {
    const harness = setup();
    mode = 'defer';
    const saving = paste(harness, [[0, 0, 'A']]);
    mode = 'accept';
    during = (step) => {
      if (step.changes[0]!.rowKey === 1) throw new Error('the store is down');
    };
    const failing = paste(harness, [[1, 0, 'B']]);
    const waiting = paste(harness, [[2, 0, 'C']]);
    failing.catch(() => {});

    pending[0]!.settle(true);
    await saving;
    await settled();
    await expect(failing).rejects.toThrow('the store is down');
    // Run as the queue drained past the throw, not left for the next step
    // someone asks for.
    expect(steps).toHaveLength(3);
    await expect(waiting).resolves.toBe(true);
    expect(textAt(2, 0)).toBe('C');
  });

  it('forgets every step on clear, including one still being undone', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'ALPHA']]);
    await paste(harness, [[1, 0, 'BETA']]);

    mode = 'defer';
    const undone = undo(harness);
    harness.history.clear();
    flushSync();
    expect(harness.history.canUndo()).toBe(false);

    pending[0]!.settle(true);
    await undone;
    await settled();
    // Applied, because the store took it — but not remembered, because the
    // history it belonged to was cleared while it was out.
    expect(textAt(1, 0)).toBe('beta');
    expect(harness.history.canUndo()).toBe(false);
    expect(harness.history.canRedo()).toBe(false);
  });

  it('forgets a commit that lands after clear, as it forgets an undo', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'ALPHA']]);
    await undo(harness);

    mode = 'defer';
    const saving = paste(harness, [[1, 0, 'BETA']]);
    // Asked for before the clear, and waiting behind a save when it came.
    const waiting = paste(harness, [[2, 0, 'GAMMA']]);
    harness.history.clear();
    flushSync();

    pending[0]!.settle(true);
    await expect(saving).resolves.toBe(true);
    await settled();
    pending[1]!.settle(true);
    await expect(waiting).resolves.toBe(true);
    await settled();
    // Written, because the store took them — but a Ctrl+Z now would write the
    // values of data the caller has since replaced wholesale.
    expect([textAt(1, 0), textAt(2, 0)]).toEqual(['BETA', 'GAMMA']);
    expect(harness.history.canUndo()).toBe(false);
    expect(harness.history.canRedo()).toBe(false);

    // And the history after the clear is an ordinary one.
    mode = 'accept';
    await paste(harness, [[3, 0, 'DELTA']]);
    expect(harness.history.canUndo()).toBe(true);
    await undo(harness);
    expect(textAt(3, 0)).toBe('delta');
  });

  it('queues a step asked for inside apply behind the one being applied', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'ALPHA']]);
    let nested: Promise<boolean> | null = null;
    let seenWhenAsked = -1;
    during = (step) => {
      if (step.kind !== 'commit' || nested !== null) return;
      // A store whose write sets off a step of its own.
      nested = harness.history.undo();
      seenWhenAsked = steps.length;
    };

    await paste(harness, [[1, 0, 'BETA']]);
    // Not run in the middle of the commit, before it was recorded — which
    // would have taken back the step below it — but straight after it.
    expect(seenWhenAsked).toBe(2);
    expect(steps.map((step) => step.kind)).toEqual(['commit', 'commit', 'undo']);
    await expect(nested).resolves.toBe(true);
    expect(changesOf(2)).toEqual([{ rowKey: 1, rowIndex: 1, value: 'beta' }]);
    expect([textAt(0, 0), textAt(1, 0)]).toEqual(['ALPHA', 'beta']);
  });
});

describe('held by key', () => {
  it('records only the part of a commit whose rows were still there when it ran', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'ALPHA']]);

    mode = 'defer';
    const undone = undo(harness);
    const committed = paste(harness, [
      [1, 0, 'BETA'],
      [2, 0, 'GAMMA'],
    ]);
    const beta = people.get()[1]!;
    people.set(Object.freeze(people.get().filter((person) => person.id !== 1)));
    flushSync();
    pending[0]!.settle(true);
    await undone;
    await settled();
    pending[1]!.settle(true);
    await expect(committed).resolves.toBe(true);
    await settled();
    expect(skips).toHaveLength(1);

    // The row comes back. Undoing the commit takes back what it wrote, and
    // does not write "beta" over a cell the commit never reached.
    beta.cells[0]!.set('someone else');
    people.set(Object.freeze([people.get()[0]!, beta, ...people.get().slice(1)]));
    flushSync();
    mode = 'accept';
    await undo(harness);
    expect(changesOf(3).map((change) => change.rowKey)).toEqual([2]);
    expect(beta.cells[0]!.get()).toBe('someone else');
    expect(skips).toHaveLength(1);
  });

  it('lands on the first of two rows sharing a key, where the grid would look for it', async () => {
    const rows = tableOf(TABLE);
    const twin = Object.freeze({ id: 1, cells: ['beta twin', 'two', '2'].map((value) => new Signal.State(value)) });
    // Two records under key 1, and the first of them in the view twice.
    people.set(Object.freeze([rows[0]!, rows[1]!, twin, rows[3]!, rows[1]!]));
    const harness = setup({ keyed: false });

    await harness.history.commit({ item: twin, columnId: 'c0', previous: 'beta twin', value: 'TWIN' });
    flushSync();
    expect(steps[0]!.changes[0]!.item).toBe(rows[1]);
    expect(changesOf(0)).toEqual([{ rowKey: 1, rowIndex: 1, value: 'TWIN' }]);
    await undo(harness);
    expect(changesOf(1)).toEqual([{ rowKey: 1, rowIndex: 1, value: 'beta twin' }]);
  });

  it('still undoes and redoes where the grid answers null', async () => {
    const harness = setup({ withoutGrid: true });
    await paste(harness, [[1, 0, 'BETA']]);
    harness.g.focusCell({ row: 3, column: 2 });
    flushSync();

    pressHere('z', { ctrlKey: true });
    expect(textAt(1, 0)).toBe('beta');
    // Nowhere in a view it has not got, and no cursor of its own to move.
    expect(changesOf(1)).toEqual([{ rowKey: 1, rowIndex: -1, value: 'beta' }]);
    expect(harness.g.activeCell()).toEqual({ row: 3, column: 2 });
    await expect(redo(harness)).resolves.toBe(true);
    expect(textAt(1, 0)).toBe('BETA');
  });

  it('finds and undoes a row the window is nowhere near', async () => {
    people.set(tableOf(Array.from({ length: 500 }, (_, i) => [`row ${i}`, `${i}`, `${i}`])));
    const harness = setup();
    await paste(harness, [[400, 0, 'CHANGED']]);
    expect(cellAt(400, 0)).toBeNull();
    harness.g.focusCell({ row: 0, column: 1 });
    flushSync();

    pressHere('z', { ctrlKey: true });
    flushSync();
    expect(people.get()[400]!.cells[0]!.get()).toBe('row 400');
    expect(changesOf(1)).toEqual([{ rowKey: 400, rowIndex: 400, value: 'row 400' }]);
    // The cursor went to it, which meant scrolling it into the window first.
    expect(harness.g.activeCell()).toEqual({ row: 400, column: 0 });
    expect(document.activeElement).toBe(cellAt(400, 0));
    expect(textAt(400, 0)).toBe('row 400');
  });

  it('undoes the right row after a sort has moved it', async () => {
    const harness = setup();
    edit(harness, 1, 0, 'beta!');

    harness.g.setSort([{ columnId: 'c0', direction: 'descending' }]);
    flushSync();
    // gamma, delta, beta!, alpha: beta! is third now.
    expect(textAt(2, 0)).toBe('beta!');

    await undo(harness);
    expect(steps[1]!.changes[0]).toMatchObject({ rowKey: 1, rowIndex: 2, value: 'beta' });
    expect(steps[1]!.changes[0]!.item).toBe(people.get()[1]);
    expect(textAt(2, 0)).toBe('beta');
    expect(textAt(1, 0)).toBe('delta');
  });

  it('undoes the right row on a grid that keys its rows by place', async () => {
    // The grid's key is the row's place in the view, and the edit reports that
    // place as its key. History keys by its own getRowKey, so it is not fooled
    // when the sort hands the place to another row.
    const harness = setup({ keyed: false });
    harness.g.setSort([{ columnId: 'c0', direction: 'descending' }]);
    flushSync();
    // gamma, delta, beta, alpha: gamma is on top, and is row 2 of the data.
    edit(harness, 0, 0, 'gamma!');
    expect(changesOf(0)).toEqual([{ rowKey: 2, rowIndex: 0, value: 'gamma!' }]);

    harness.g.setSort([]);
    flushSync();

    await undo(harness);
    expect(steps[1]!.changes[0]!.item).toBe(people.get()[2]);
    expect(changesOf(1)).toEqual([{ rowKey: 2, rowIndex: 2, value: 'gamma' }]);
    expect(people.get().map((person) => person.cells[0]!.get())).toEqual([
      'alpha',
      'beta',
      'gamma',
      'delta',
    ]);
  });

  it('hands back the row that holds the key now, where the data replaced it', async () => {
    const harness = setup();
    await paste(harness, [[1, 0, 'BETA']]);

    // The same record under the same key, in a new object — what a store that
    // replaces rather than writes hands back.
    const replaced = Object.freeze({ ...people.get()[1]! });
    people.set(Object.freeze(people.get().map((person) => (person.id === 1 ? replaced : person))));
    flushSync();

    await undo(harness);
    expect(steps[1]!.changes[0]!.item).toBe(replaced);
    expect(textAt(1, 0)).toBe('beta');
  });

  it('still undoes a row a filter hides, which has not gone anywhere', async () => {
    const harness = setup();
    await paste(harness, [[1, 0, 'BETA']]);
    harness.g.setFilter('c0', { type: 'text', value: 'g', operator: 'startsWith' });
    flushSync();
    expect(harness.g.rowCount()).toBe(1);

    await expect(undo(harness)).resolves.toBe(true);
    // Not in the view, and said so; written all the same.
    expect(steps[1]!.changes[0]).toMatchObject({ rowKey: 1, rowIndex: -1, value: 'beta' });
    expect(skips).toEqual([]);

    harness.g.clearFilters();
    flushSync();
    expect(textAt(1, 0)).toBe('beta');
  });

  it('skips a change whose row has gone, says so, and undoes the rest', async () => {
    const harness = setup();
    await paste(harness, [
      [0, 0, 'ALPHA'],
      [1, 0, 'BETA'],
    ]);
    const alpha = people.get()[0]!;
    people.set(Object.freeze(people.get().filter((person) => person.id !== 0)));
    flushSync();

    await expect(undo(harness)).resolves.toBe(true);
    expect(skips).toEqual([
      { kind: 'undo', skipped: [{ rowKey: 0, columnId: 'c0', previous: 'alpha', value: 'ALPHA' }] },
    ]);
    expect(steps[1]!.changes.map((change) => change.rowKey)).toEqual([1]);
    expect(people.get()[0]!.cells[0]!.get()).toBe('beta');

    // What goes to redo is what was undone. The row coming back does not make
    // a redo write over a cell this undo never touched.
    people.set(Object.freeze([alpha, ...people.get()]));
    flushSync();
    await redo(harness);
    expect(steps[2]!.changes.map((change) => change.rowKey)).toEqual([1]);
    expect(alpha.cells[0]!.get()).toBe('ALPHA');
    expect(skips).toHaveLength(1);
  });

  it('drops a step none of whose rows are left, and the next undo reaches the one below', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'ALPHA']]);
    await paste(harness, [[1, 0, 'BETA']]);
    people.set(Object.freeze(people.get().filter((person) => person.id !== 1)));
    flushSync();

    await expect(undo(harness)).resolves.toBe(false);
    expect(steps).toHaveLength(2);
    expect(skips).toEqual([
      { kind: 'undo', skipped: [{ rowKey: 1, columnId: 'c0', previous: 'beta', value: 'BETA' }] },
    ]);
    expect(harness.history.canRedo()).toBe(false);
    expect(harness.history.canUndo()).toBe(true);

    await expect(undo(harness)).resolves.toBe(true);
    expect(textAt(0, 0)).toBe('alpha');
    expect(skips).toHaveLength(1);
  });

  it('skips a commit to a row that went before its turn came', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'ALPHA']]);

    mode = 'defer';
    const undone = undo(harness);
    const committed = paste(harness, [[1, 0, 'BETA']]);
    people.set(Object.freeze(people.get().filter((person) => person.id !== 1)));
    flushSync();

    pending[0]!.settle(true);
    await undone;
    await expect(committed).resolves.toBe(false);
    expect(skips).toEqual([
      { kind: 'commit', skipped: [{ rowKey: 1, columnId: 'c0', previous: 'beta', value: 'BETA' }] },
    ]);
    expect(steps).toHaveLength(2);
  });
});

describe('depth', () => {
  it('keeps no more steps than its depth, dropping the oldest', async () => {
    const harness = setup({ depth: 2 });
    await paste(harness, [[0, 0, 'A']]);
    await paste(harness, [[1, 0, 'B']]);
    await paste(harness, [[2, 0, 'C']]);

    await expect(undo(harness)).resolves.toBe(true);
    await expect(undo(harness)).resolves.toBe(true);
    await expect(undo(harness)).resolves.toBe(false);
    // The first change stands: it fell off the bottom when the third came in.
    expect([textAt(0, 0), textAt(1, 0), textAt(2, 0)]).toEqual(['A', 'beta', 'gamma']);
  });

  it('keeps nothing at a depth of zero, and still applies every commit', async () => {
    const harness = setup({ depth: 0 });
    await expect(paste(harness, [[0, 0, 'A']])).resolves.toBe(true);
    expect(textAt(0, 0)).toBe('A');
    expect(harness.history.canUndo()).toBe(false);
  });

  it('takes a depth as a whole number of steps, and never fewer than none', async () => {
    const fractional = setup({ depth: 2.5 });
    for (const value of ['A', 'B', 'C']) await paste(fractional, [[0, 0, value]]);
    await undo(fractional);
    await undo(fractional);
    await expect(undo(fractional)).resolves.toBe(false);

    const negative = setup({ depth: -1 });
    await paste(negative, [[1, 0, 'B']]);
    expect(negative.history.canUndo()).toBe(false);
  });

  it('keeps a hundred steps when given no depth, or none it can count', async () => {
    for (const depth of [undefined, Number.NaN]) {
      people.set(tableOf(TABLE));
      const harness = setup({ depth });
      for (let i = 0; i < 101; i++) await paste(harness, [[0, 0, `v${i}`]]);
      let undone = 0;
      while (await undo(harness)) undone++;
      expect(undone).toBe(100);
      // The first change is the one that fell off.
      expect(people.get()[0]!.cells[0]!.get()).toBe('v0');
      mounted.pop()!.unmount();
    }
  });
});

describe('the keyboard', () => {
  it('undoes on Ctrl+Z and on Cmd+Z', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    await paste(harness, [[1, 0, 'B']]);
    harness.g.focusCell({ row: 3, column: 2 });
    flushSync();

    const ctrl = pressHere('z', { ctrlKey: true });
    expect(harness.instance.handled).toBe(true);
    expect(ctrl.defaultPrevented).toBe(true);
    expect(textAt(1, 0)).toBe('beta');

    pressHere('z', { metaKey: true });
    expect(textAt(0, 0)).toBe('alpha');
  });

  it('redoes on Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    await paste(harness, [[1, 0, 'B']]);
    await paste(harness, [[2, 0, 'C']]);
    await undo(harness);
    await undo(harness);
    await undo(harness);
    harness.g.focusCell({ row: 3, column: 2 });
    flushSync();

    // Shift turns the letter upper case, and the key reports it that way.
    pressHere('Z', { ctrlKey: true, shiftKey: true });
    expect(textAt(0, 0)).toBe('A');
    pressHere('Z', { metaKey: true, shiftKey: true });
    expect(textAt(1, 0)).toBe('B');
    const y = pressHere('y', { ctrlKey: true });
    expect(y.defaultPrevented).toBe(true);
    expect(textAt(2, 0)).toBe('C');
  });

  it('leaves Cmd+Y to the browser, whose history it is on a Mac', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    await undo(harness);
    harness.g.focusCell({ row: 3, column: 2 });
    flushSync();

    const event = pressHere('y', { metaKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(harness.instance.handled).toBe(false);
    expect(textAt(0, 0)).toBe('alpha');

    // Nor is Ctrl+Shift+Y a redo: it is nothing here, and a browser's own.
    const shifted = pressHere('Y', { ctrlKey: true, shiftKey: true });
    expect(shifted.defaultPrevented).toBe(false);
    expect(textAt(0, 0)).toBe('alpha');
  });

  it('leaves Alt alone, which with Ctrl is AltGr and types characters', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    harness.g.focusCell({ row: 3, column: 2 });
    flushSync();

    const event = pressHere('z', { ctrlKey: true, altKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(textAt(0, 0)).toBe('A');
    // And a plain z is a letter, not a shortcut.
    pressHere('z');
    expect(textAt(0, 0)).toBe('A');
  });

  it('claims the key with nothing to undo, since it means this grid either way', () => {
    const harness = setup();
    harness.g.focusCell({ row: 0, column: 0 });
    flushSync();

    const event = pressHere('z', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(harness.instance.handled).toBe(true);
    expect(steps).toEqual([]);
  });

  it('leaves the keys to an open editor, whichever layer is wired first', async () => {
    for (const historyFirst of [false, true]) {
      people.set(tableOf(TABLE));
      steps = [];
      const harness = setup({ historyFirst });
      await paste(harness, [[0, 0, 'A']]);
      harness.g.focusCell({ row: 1, column: 0 });
      flushSync();
      pressHere('Enter');
      expect(harness.editing.session()).not.toBeNull();

      // Focus still on the cell, as it is until the caller moves it into the
      // control: history has only the editing layer's word that one is open.
      const event = pressHere('z', { ctrlKey: true });
      expect(steps).toHaveLength(1);
      expect(textAt(0, 0)).toBe('A');
      expect(event.defaultPrevented).toBe(false);
      harness.editing.cancel();
      flushSync();
      mounted.pop()!.unmount();
    }
  });

  it('leaves the keys to a text control inside the grid, whose undo is its own', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    const search = host.querySelector<HTMLInputElement>('.search')!;
    search.focus();

    const event = press(search, 'z', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(harness.instance.handled).toBe(false);
    expect(textAt(0, 0)).toBe('A');
  });

  it('undoes from a checkbox or a select inside the grid, which have no undo of their own', async () => {
    // A boolean column drawn as a checkbox, a status as a select: each commits
    // through history when it changes, and keeps focus once it has.
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    await paste(harness, [[1, 0, 'B']]);
    const box = document.createElement('input');
    box.type = 'checkbox';
    cellAt(2, 2)!.append(box);
    const select = document.createElement('select');
    cellAt(3, 2)!.append(select);

    box.focus();
    const fromBox = press(box, 'z', { ctrlKey: true });
    expect(fromBox.defaultPrevented).toBe(true);
    expect(textAt(1, 0)).toBe('beta');

    select.focus();
    const fromSelect = press(select, 'z', { ctrlKey: true });
    expect(fromSelect.defaultPrevented).toBe(true);
    expect(textAt(0, 0)).toBe('alpha');
  });

  it('undoes from every input that takes no typed text, and so keeps no undo of its own', async () => {
    const types = ['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'];
    const harness = setup();
    for (let i = 0; i < types.length; i++) await paste(harness, [[0, 0, `v${i}`]]);

    for (const [i, type] of types.entries()) {
      const input = Object.assign(document.createElement('input'), { type });
      cellAt(2, 2)!.append(input);
      input.focus();
      const event = press(input, 'z', { ctrlKey: true });
      expect([type, event.defaultPrevented]).toEqual([type, true]);
      expect([type, textAt(0, 0)]).toEqual([type, i === types.length - 1 ? 'alpha' : `v${types.length - 2 - i}`]);
      input.remove();
    }
  });

  it('leaves the keys to a field of any type that takes typed text', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    const fields = [
      Object.assign(document.createElement('input'), { type: 'number' }),
      document.createElement('textarea'),
      Object.assign(document.createElement('div'), { contentEditable: 'true' }),
    ];
    for (const field of fields) {
      cellAt(2, 2)!.append(field);
      field.focus();
      const event = press(field, 'z', { ctrlKey: true });
      expect(event.defaultPrevented).toBe(false);
      expect(textAt(0, 0)).toBe('A');
      field.remove();
    }
    expect(harness.history.canUndo()).toBe(true);
  });

  it('undoes and redoes on the keys marked Z and Y of a layout that types another script', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    await paste(harness, [[1, 0, 'B']]);
    harness.g.focusCell({ row: 3, column: 2 });
    flushSync();

    // Russian: the key a Latin layout calls Z types я, and Y types н.
    const undone = pressHere('я', { ctrlKey: true, code: 'KeyZ' });
    expect(undone.defaultPrevented).toBe(true);
    expect(textAt(1, 0)).toBe('beta');
    pressHere('Я', { ctrlKey: true, shiftKey: true, code: 'KeyZ' });
    expect(textAt(1, 0)).toBe('B');
    pressHere('я', { metaKey: true, code: 'KeyZ' });
    expect(textAt(1, 0)).toBe('beta');
    pressHere('н', { ctrlKey: true, code: 'KeyY' });
    expect(textAt(1, 0)).toBe('B');
    // Cmd with the key marked Y is still the browser's, whatever it types.
    const browsers = pressHere('н', { metaKey: true, code: 'KeyY' });
    expect(browsers.defaultPrevented).toBe(false);
    expect(textAt(1, 0)).toBe('B');
  });

  it('matches a Latin letter as itself, wherever the layout puts it', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    harness.g.focusCell({ row: 3, column: 2 });
    flushSync();

    // German swaps Z and Y: the key marked Z is where QWERTY has Y.
    pressHere('z', { ctrlKey: true, code: 'KeyY' });
    expect(textAt(0, 0)).toBe('alpha');
    pressHere('y', { ctrlKey: true, code: 'KeyZ' });
    expect(textAt(0, 0)).toBe('A');

    // Dvorak types a semicolon where QWERTY has Z. Ctrl+; is not an undo —
    // it is a spreadsheet's "today", should the caller give it one.
    const semicolon = pressHere(';', { ctrlKey: true, code: 'KeyZ' });
    expect(semicolon.defaultPrevented).toBe(false);
    expect(harness.instance.handled).toBe(false);
    expect(textAt(0, 0)).toBe('A');
  });

  it('leaves the cursor where the reader went along the row while the step waited', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    mode = 'defer';
    const committed = paste(harness, [[1, 0, 'B']]);
    harness.g.focusCell({ row: 2, column: 1 });
    flushSync();

    pressHere('z', { ctrlKey: true });
    pressHere('ArrowRight');
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 2 });

    pending[0]!.settle(true);
    await committed;
    await settled();
    expect(steps[2]!.kind).toBe('undo');
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 2 });
  });

  it('knows the column the reader stood on by what it is, not where it was', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    await paste(harness, [[3, 2, 'D']]);
    mode = 'defer';
    const committed = paste(harness, [[1, 0, 'B']]);
    harness.g.focusCell({ row: 2, column: 1 });
    flushSync();

    // Queued behind the save. Then the reader's column goes to the front, the
    // cursor with it, and they step right — onto c0, which the move put in
    // the place their column had.
    pressHere('z', { ctrlKey: true });
    const [c0, c1, c2] = columns.get();
    columns.set([c1!, c0!, c2!]);
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 0 });
    pressHere('ArrowRight');
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 1 });

    pending[0]!.settle(true);
    await committed;
    await settled();
    expect(steps[3]!.kind).toBe('undo');
    // They moved on, whatever index the column they are on has.
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 1 });

    // And one who stays on their column while a move takes it somewhere else
    // has not moved: the step takes them to its cell.
    pressHere('ArrowLeft');
    pressHere('z', { ctrlKey: true });
    columns.set([c0!, c2!, c1!]);
    flushSync();
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 2 });
    pending[1]!.settle(true);
    await settled();
    expect(steps[4]!.kind).toBe('undo');
    expect(harness.g.activeCell()).toEqual({ row: 3, column: 1 });
    pending[2]!.settle(true);
    await settled();
    expect(textAt(3, 1)).toBe('4');
  });

  it('puts the cursor on the cell it changed', async () => {
    const harness = setup();
    edit(harness, 1, 0, 'beta!');
    // Enter committed and moved the cursor down a row.
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 0 });

    pressHere('z', { ctrlKey: true });
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 0 });
    expect(document.activeElement).toBe(cellAt(1, 0));

    harness.g.focusCell({ row: 3, column: 2 });
    flushSync();
    pressHere('y', { ctrlKey: true });
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 0 });
  });

  it("puts the cursor on a paste's top-left corner, though an undo hands it over last", async () => {
    const harness = setup();
    // A row at a time from the corner, as the clipboard lays a paste out, so
    // the undo's first change is the far corner.
    await paste(harness, [
      [1, 1, 'x'],
      [1, 2, 'x'],
      [2, 1, 'x'],
      [2, 2, 'x'],
    ]);
    harness.g.focusCell({ row: 3, column: 0 });
    flushSync();

    pressHere('z', { ctrlKey: true });
    expect(changesOf(1)[0]).toMatchObject({ rowKey: 2, rowIndex: 2 });
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 1 });

    harness.g.focusCell({ row: 3, column: 0 });
    flushSync();
    pressHere('y', { ctrlKey: true });
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 1 });
  });

  it('writes a column the grid no longer shows, and leaves the cursor where it was', async () => {
    const harness = setup();
    await paste(harness, [[1, 2, 'X']]);
    columns.set(makeColumns().slice(0, 2));
    flushSync();
    harness.g.focusCell({ row: 3, column: 1 });
    flushSync();

    pressHere('z', { ctrlKey: true });
    expect(people.get()[1]!.cells[2]!.get()).toBe('2');
    expect(harness.g.activeCell()).toEqual({ row: 3, column: 1 });
  });

  it('follows the row to where a sort moved it', async () => {
    const harness = setup();
    await paste(harness, [[1, 0, 'zeta']]);
    harness.g.setSort([{ columnId: 'c0', direction: 'ascending' }]);
    flushSync();
    // alpha, delta, gamma, zeta: the changed row is last.
    harness.g.focusCell({ row: 0, column: 2 });
    flushSync();

    pressHere('z', { ctrlKey: true });
    // Undone to beta, which sorts second — and the cursor went there, not to
    // where the row was when the key was pressed.
    expect(textAt(1, 0)).toBe('beta');
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 0 });
  });

  it('leaves the cursor alone when the changed row is hidden', async () => {
    const harness = setup();
    await paste(harness, [[1, 0, 'BETA']]);
    harness.g.setFilter('c0', { type: 'text', value: 'g', operator: 'startsWith' });
    flushSync();
    harness.g.focusCell({ row: 0, column: 2 });
    flushSync();

    pressHere('z', { ctrlKey: true });
    expect(people.get()[1]!.cells[0]!.get()).toBe('beta');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 2 });
  });

  it('moves the cursor as the step is handed over, before the save answers', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    harness.g.focusCell({ row: 2, column: 1 });
    flushSync();

    mode = 'defer';
    pressHere('z', { ctrlKey: true });
    // On the cell whose value is about to change, while the store decides.
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
    expect(textAt(0, 0)).toBe('A');

    pending[0]!.settle(true);
    await settled();
    expect(textAt(0, 0)).toBe('alpha');
    expect(harness.g.activeCell()).toEqual({ row: 0, column: 0 });
  });

  it('leaves the cursor where the reader went while the step waited its turn', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    mode = 'defer';
    const committed = paste(harness, [[1, 0, 'B']]);
    harness.g.focusCell({ row: 2, column: 1 });
    flushSync();

    // Queued behind the save, and the reader moves on before its turn comes.
    pressHere('z', { ctrlKey: true });
    pressHere('ArrowDown');
    expect(harness.g.activeCell()).toEqual({ row: 3, column: 1 });

    pending[0]!.settle(true);
    await committed;
    await settled();
    expect(steps).toHaveLength(3);
    expect(steps[2]!.kind).toBe('undo');
    expect(harness.g.activeCell()).toEqual({ row: 3, column: 1 });
  });

  it('leaves focus outside the grid when the reader left it before the step had its turn', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    mode = 'defer';
    const committed = paste(harness, [[1, 0, 'B']]);
    harness.g.focusCell({ row: 2, column: 1 });
    flushSync();

    pressHere('z', { ctrlKey: true });
    button('undo').focus();
    expect(document.activeElement).toBe(button('undo'));

    pending[0]!.settle(true);
    await committed;
    await settled();
    expect(steps).toHaveLength(3);
    expect(document.activeElement).toBe(button('undo'));
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 1 });
  });

  it('follows though the reader scrolled their cell out of the window while the step waited', async () => {
    people.set(tableOf(Array.from({ length: 500 }, (_, i) => [`row ${i}`, `${i}`, `${i}`])));
    const harness = setup();
    mode = 'defer';
    const committed = paste(harness, [[300, 0, 'CHANGED']]);
    harness.g.focusCell({ row: 2, column: 1 });
    flushSync();

    // Queued behind the save. The reader scrolls the body, which moves no
    // cursor: the cell holding focus leaves the window, and focus goes with it.
    pressHere('z', { ctrlKey: true });
    const scroller = host.querySelector<HTMLElement>('.body')!;
    scroller.scrollTop = 200 * ROW_HEIGHT;
    scroller.dispatchEvent(new Event('scroll'));
    flushSync();
    expect(cellAt(2, 1)).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 1 });

    pending[0]!.settle(true);
    await committed;
    await settled();
    expect(steps.map((step) => step.kind)).toEqual(['commit', 'undo']);
    expect(harness.g.activeCell()).toEqual({ row: 300, column: 0 });
    expect(document.activeElement).toBe(cellAt(300, 0));
  });

  it('leaves focus where the reader took it after scrolling their cell out of the window', async () => {
    people.set(tableOf(Array.from({ length: 500 }, (_, i) => [`row ${i}`, `${i}`, `${i}`])));
    const harness = setup();
    mode = 'defer';
    const committed = paste(harness, [[300, 0, 'CHANGED']]);
    harness.g.focusCell({ row: 2, column: 1 });
    flushSync();

    // The scroll takes the cell and focus with it; then the reader goes on to
    // a control of their own, outside the grid.
    pressHere('z', { ctrlKey: true });
    const scroller = host.querySelector<HTMLElement>('.body')!;
    scroller.scrollTop = 200 * ROW_HEIGHT;
    scroller.dispatchEvent(new Event('scroll'));
    flushSync();
    expect(cellAt(2, 1)).toBeNull();
    const elsewhere = document.body.appendChild(document.createElement('input'));
    elsewhere.focus();
    expect(document.activeElement).toBe(elsewhere);

    pending[0]!.settle(true);
    await committed;
    await settled();
    expect(steps.map((step) => step.kind)).toEqual(['commit', 'undo']);
    expect(document.activeElement).toBe(elsewhere);
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 1 });
  });

  it('moves no cursor in a grid taken out of the page while the step waited', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    mode = 'defer';
    const committed = paste(harness, [[1, 0, 'B']]);
    harness.g.focusCell({ row: 2, column: 1 });
    flushSync();

    pressHere('z', { ctrlKey: true });
    const focusCell = vi.spyOn(harness.g, 'focusCell');
    // Focus is nowhere and the cell that held it has gone, as after a scroll —
    // but so has the grid, and there is nothing to follow into.
    mounted.pop()!.unmount();
    flushSync();
    expect(document.activeElement).toBe(document.body);

    pending[0]!.settle(true);
    await committed;
    await settled();
    expect(steps.map((step) => step.kind)).toEqual(['commit', 'commit', 'undo']);
    expect(focusCell).not.toHaveBeenCalled();
  });

  it('leaves the cursor alone when the reader sent focus nowhere while the step waited', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    mode = 'defer';
    const committed = paste(harness, [[1, 0, 'B']]);
    harness.g.focusCell({ row: 2, column: 1 });
    flushSync();

    // Clicking the page's background: focus is nowhere, as it is when a
    // scroll takes the cell away, but the cell is still there to hold it.
    pressHere('z', { ctrlKey: true });
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);

    pending[0]!.settle(true);
    await committed;
    await settled();
    expect(steps).toHaveLength(3);
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 1 });
    expect(document.activeElement).toBe(document.body);
  });

  it('moves no cursor and no focus when undone from a button', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    harness.g.focusCell({ row: 2, column: 1 });
    flushSync();

    button('undo').click();
    flushSync();
    expect(textAt(0, 0)).toBe('alpha');
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 1 });
  });
});

describe('the toolbar', () => {
  it('follows canUndo and canRedo, and so does a button bound to them', async () => {
    const harness = setup();
    expect([button('undo').disabled, button('redo').disabled]).toEqual([true, true]);

    edit(harness, 1, 0, 'beta!');
    expect([button('undo').disabled, button('redo').disabled]).toEqual([false, true]);

    button('undo').click();
    flushSync();
    expect(textAt(1, 0)).toBe('beta');
    expect([button('undo').disabled, button('redo').disabled]).toEqual([true, false]);

    button('redo').click();
    flushSync();
    expect(textAt(1, 0)).toBe('beta!');
    expect([button('undo').disabled, button('redo').disabled]).toEqual([false, true]);

    harness.history.clear();
    flushSync();
    expect([button('undo').disabled, button('redo').disabled]).toEqual([true, true]);
  });

  it('refuses undo and redo while an editor is open, and the buttons say so', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    await paste(harness, [[1, 0, 'B']]);
    await undo(harness);
    expect([button('undo').disabled, button('redo').disabled]).toEqual([false, false]);

    harness.g.focusCell({ row: 2, column: 0 });
    flushSync();
    pressHere('Enter');
    expect(harness.editing.session()).not.toBeNull();
    expect(harness.history.canUndo()).toBe(false);
    expect(harness.history.canRedo()).toBe(false);
    expect([button('undo').disabled, button('redo').disabled]).toEqual([true, true]);
    // Called anyway — from code, or a button someone forgot to disable.
    await expect(undo(harness)).resolves.toBe(false);
    await expect(redo(harness)).resolves.toBe(false);
    expect(steps).toHaveLength(3);

    harness.editing.cancel();
    flushSync();
    expect([button('undo').disabled, button('redo').disabled]).toEqual([false, false]);
  });

  it('drops an undo whose turn comes while an editor is open', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);

    mode = 'defer';
    const committed = paste(harness, [[1, 0, 'B']]);
    const undone = undo(harness);
    harness.g.focusCell({ row: 2, column: 0 });
    flushSync();
    pressHere('Enter');

    pending[0]!.settle(true);
    await committed;
    // The cell open now may be the one it would change, and a session whose
    // cell changed under it would commit from a value that was not there.
    await expect(undone).resolves.toBe(false);
    expect(steps).toHaveLength(2);
  });
});

describe('while an editor is open, with a save still out', () => {
  it('refuses an undo or a redo as it is asked for, rather than once the save lands', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    await paste(harness, [[1, 0, 'B']]);
    await undo(harness);

    mode = 'defer';
    const saving = paste(harness, [[2, 0, 'C']]);
    harness.g.focusCell({ row: 3, column: 0 });
    flushSync();
    pressHere('Enter');
    expect(harness.editing.session()).not.toBeNull();

    // The same answer it gives with nothing out. Queued, it would run once the
    // editor had closed, and whether it did would turn on how slow a save was.
    const undone = undo(harness);
    const redone = redo(harness);
    const first = await Promise.race([
      Promise.all([undone, redone]).then(() => 'answered'),
      settled().then(() => 'waiting'),
    ]);
    expect(first).toBe('answered');
    await expect(undone).resolves.toBe(false);
    await expect(redone).resolves.toBe(false);

    harness.editing.cancel();
    flushSync();
    pending[0]!.settle(true);
    await expect(saving).resolves.toBe(true);
    await settled();
    expect(steps.map((step) => step.kind)).toEqual(['commit', 'commit', 'undo', 'commit']);
    expect([textAt(0, 0), textAt(1, 0), textAt(2, 0)]).toEqual(['A', 'beta', 'C']);
  });
});

describe('a step landing on a cell the reader has opened', () => {
  /** Opens the cell the way a reader does — Enter on it — with focus put in the editor. */
  function open(harness: Harness, row: number, column: number): HTMLInputElement {
    harness.g.focusCell({ row, column });
    flushSync();
    pressHere('Enter');
    const input = host.querySelector<HTMLInputElement>(`[${GRID_EDITOR_ATTRIBUTE}]`)!;
    input.focus();
    return input;
  }

  function type(input: HTMLInputElement, text: string): void {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }

  it('shows the value an undo already on its way left there, where the reader has typed nothing', async () => {
    const harness = setup();
    await paste(harness, [[1, 0, 'B']]);

    mode = 'defer';
    const undone = undo(harness);
    // Handed over before the cell was opened, so nothing refused it.
    expect(steps).toHaveLength(2);
    const input = open(harness, 1, 0);
    expect(harness.editing.text()).toBe('B');

    pending[0]!.settle(true);
    await expect(undone).resolves.toBe(true);
    await settled();
    // The editor is over a cell that holds "beta" now, and says so.
    expect(harness.editing.session()).toMatchObject({ columnId: 'c0', initial: 'beta' });
    expect(harness.editing.text()).toBe('beta');
    expect(input.value).toBe('beta');

    // Closed as it stands, it is no change: the cell already holds it.
    mode = 'accept';
    press(input, 'Enter');
    expect(steps).toHaveLength(2);
    expect(textAt(1, 0)).toBe('beta');
  });

  it('keeps what the reader typed, and commits it as a change from what the undo left', async () => {
    const harness = setup();
    await paste(harness, [[1, 0, 'B']]);

    mode = 'defer';
    const undone = undo(harness);
    const input = open(harness, 1, 0);
    type(input, 'C');

    pending[0]!.settle(true);
    await undone;
    await settled();
    expect(harness.editing.text()).toBe('C');
    expect(harness.editing.session()).toMatchObject({ initial: 'beta' });

    mode = 'accept';
    press(input, 'Enter');
    await settled();
    expect(steps[2]!.changes[0]).toMatchObject({ rowKey: 1, previous: 'beta', value: 'C' });
    // So undoing it puts back what the cell held before it, and not the value
    // the undo had already taken away.
    await undo(harness);
    expect(textAt(1, 0)).toBe('beta');
    expect(harness.history.canUndo()).toBe(false);
  });

  it('records a commit made before the undo landed as a change from what the undo left', async () => {
    const harness = setup();
    await paste(harness, [[1, 0, 'B']]);

    mode = 'defer';
    const undone = undo(harness);
    // Opened, typed and committed while the undo was out: the commit waits
    // its turn, holding the "B" the editor opened with.
    edit(harness, 1, 0, 'C');
    expect(steps).toHaveLength(2);

    mode = 'accept';
    pending[0]!.settle(true);
    await undone;
    await settled();
    expect(steps).toHaveLength(3);
    expect(steps[2]!.changes[0]).toMatchObject({ rowKey: 1, previous: 'beta', value: 'C' });
    expect(textAt(1, 0)).toBe('C');

    await undo(harness);
    expect(textAt(1, 0)).toBe('beta');
    expect(harness.history.canUndo()).toBe(false);
  });

  it('leaves an editor open on another cell of the row or the column as it was', async () => {
    const harness = setup();
    await paste(harness, [[2, 0, 'G'], [1, 1, 'T']]);

    mode = 'defer';
    const undone = undo(harness);
    // Row 1's first column: the undo writes the cell below it and the one
    // beside it, and neither is this one.
    const input = open(harness, 1, 0);
    type(input, 'beta!');

    pending[0]!.settle(true);
    await undone;
    await settled();
    expect([textAt(2, 0), textAt(1, 1)]).toEqual(['gamma', 'two']);
    expect(harness.editing.session()).toMatchObject({ row: 1, columnId: 'c0', initial: 'beta' });
    expect(harness.editing.text()).toBe('beta!');

    mode = 'accept';
    press(input, 'Enter');
    expect(steps[2]!.changes[0]).toMatchObject({ rowKey: 1, columnId: 'c0', previous: 'beta', value: 'beta!' });
  });

  it('moves an editor and a waiting commit onto what a commit still saving wrote', async () => {
    const harness = setup();
    mode = 'defer';
    // A commit out, and the cell it is writing opened before it lands.
    const saving = paste(harness, [[1, 0, 'B']]);
    const input = open(harness, 1, 0);
    expect(harness.editing.text()).toBe('beta');

    pending[0]!.settle(true);
    await saving;
    await settled();
    expect(harness.editing.session()).toMatchObject({ initial: 'B' });
    expect(input.value).toBe('B');

    // Committed while a second save is out on the same cell: it waits, and
    // is recorded as a change from what that save leaves.
    type(input, 'C');
    const second = paste(harness, [[1, 0, 'D']]);
    press(input, 'Enter');
    mode = 'accept';
    pending[1]!.settle(true);
    await second;
    await settled();
    expect(steps[2]!.changes[0]).toMatchObject({ rowKey: 1, previous: 'D', value: 'C' });
    expect(textAt(1, 0)).toBe('C');

    await undo(harness);
    expect(textAt(1, 0)).toBe('D');
  });

  it('hands apply nothing for a waiting commit the undo has made no change', async () => {
    const harness = setup();
    await paste(harness, [[1, 0, 'B']]);

    mode = 'defer';
    const undone = undo(harness);
    // The reader typed back the value the undo is about to put there.
    edit(harness, 1, 0, 'beta');
    const committed = harness.history.commit({
      item: people.get()[1]!,
      columnId: 'c0',
      previous: 'B',
      value: 'beta',
    });

    mode = 'accept';
    pending[0]!.settle(true);
    await undone;
    await expect(committed).resolves.toBe(false);
    await settled();
    expect(steps).toHaveLength(2);
    expect(harness.history.canUndo()).toBe(false);
    expect(harness.history.canRedo()).toBe(true);
  });
});

describe('what it says', () => {
  it('announces an undo and a redo, and how many cells went', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    await paste(harness, [
      [1, 0, 'B'],
      [2, 0, 'C'],
    ]);

    await undo(harness);
    expect(await announced()).toBe('2 changes undone');
    resetAnnouncer();
    await undo(harness);
    expect(await announced()).toBe('Change undone');
    resetAnnouncer();
    await redo(harness);
    expect(await announced()).toBe('Change redone');
  });

  it('says nothing for a commit, which the reader has just watched happen', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    await settled();
    expect(document.querySelector("[data-volt-announcer='polite']")?.textContent ?? '').toBe('');
  });

  it("takes its sentences from the locale's catalogue", async () => {
    catalogue = {
      gridUndone: '{n} Änderungen rückgängig gemacht',
      gridRedone: '{n} Änderungen wiederhergestellt',
    };
    const harness = setup();
    await paste(harness, [
      [0, 0, 'A'],
      [1, 0, 'B'],
    ]);
    await undo(harness);
    expect(await announced()).toBe('2 Änderungen rückgängig gemacht');
    resetAnnouncer();
    await redo(harness);
    expect(await announced()).toBe('2 Änderungen wiederhergestellt');
  });

  it('says a sentence of its own, and nothing for an empty one', async () => {
    let said = '';
    const harness = setup({ announcement: (kind, count) => (said = kind === 'undo' ? `back ${count}` : '') });
    await paste(harness, [[0, 0, 'A']]);
    await undo(harness);
    expect(await announced()).toBe('back 1');
    resetAnnouncer();

    await redo(harness);
    expect(said).toBe('');
    await settled();
    expect(document.querySelector("[data-volt-announcer='polite']")?.textContent ?? '').toBe('');
  });
});

describe('what it costs', () => {
  it('runs one accessor and rewrites one text node for an undo, and the same for a redo', async () => {
    const harness = setup();
    edit(harness, 1, 0, 'beta!');
    harness.g.focusCell({ row: 3, column: 2 });
    flushSync();
    const before = cells();
    const texts = textNodesByCell();
    reads = [];

    pressHere('z', { ctrlKey: true });
    // One accessor ran: the cell whose value the caller wrote. History asked
    // no cell what it held, and the buttons that changed state re-read none.
    expect(reads).toEqual(['1:0']);
    expect(cells()).toEqual(before);
    // The text node is the one it had: a value written into it, not a new one.
    expect(changedTextNodes(texts)).toEqual([]);
    expect(textAt(1, 0)).toBe('beta');

    reads = [];
    pressHere('y', { ctrlKey: true });
    expect(reads).toEqual(['1:0']);
    expect(changedTextNodes(texts)).toEqual([]);
  });

  it('subscribes nothing that asked for a step to what apply reads', async () => {
    const harness = setup();
    let runs = 0;
    let done: Promise<unknown> = Promise.resolve();
    restores.push(
      createRoot((dispose) => {
        effect(() => {
          runs += 1;
          // A caller committing from an effect — a change pushed from a
          // server, say. Resolving the step reads the rows, and apply reads
          // and writes the store; none of that is this effect's business.
          done = harness.history.commit({
            item: untracked(() => people.get()[0]!),
            columnId: 'c0',
            previous: 'alpha',
            value: 'ALPHA',
          });
        });
        return dispose;
      }),
    );
    flushSync();
    await done;
    expect(runs).toBe(1);
    expect(textAt(0, 0)).toBe('ALPHA');

    people.set(Object.freeze([...people.get()]));
    columns.set([...columns.get()]);
    await undo(harness);
    flushSync();
    expect(runs).toBe(1);
  });

  it('reads the keys of the rows once per change to the data, not once per step', async () => {
    const harness = setup();
    await paste(harness, [[0, 0, 'A']]);
    await paste(harness, [[1, 0, 'B']]);

    keyReads = 0;
    await undo(harness);
    await undo(harness);
    await redo(harness);
    // The index built for the first commit still stands: nothing replaced the
    // array, so nothing was scanned again.
    expect(keyReads).toBe(0);

    // A commit asks for the key of the row it names, and nothing else.
    await paste(harness, [[2, 0, 'C']]);
    expect(keyReads).toBe(1);

    people.set(Object.freeze([...people.get()]));
    flushSync();
    keyReads = 0;
    await undo(harness);
    expect(keyReads).toBe(TABLE.length);
  });
});
