/**
 * Cell editing, driven through a real mounted grid.
 *
 * The claims worth proving are the ones that are easy to get wrong and
 * invisible when they are: that an edit reports a change rather than making
 * one, that validation refusing a commit leaves the reader holding what they
 * typed, that Enter, Escape and Tab do what a spreadsheet does, and that none
 * of it costs the grid its one-text-node-per-value property.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAnnouncer } from '@voltdev/primitives';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import {
  GRID_CELL_ATTRIBUTE,
  GRID_EDITOR_ATTRIBUTE,
  createCellEditing,
  createGrid,
  type Grid,
  type GridCellEditing,
  type GridColumn,
  type GridEditChange,
  type GridEditor,
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

const TABLE: readonly (readonly string[])[] = [
  ['alpha', 'one', '1'],
  ['beta', 'two', '2'],
  ['gamma', 'three', '3'],
  ['delta', 'four', '4'],
];

function tableOf(cells: readonly (readonly string[])[]): Person[] {
  return cells.map((values, id) => ({
    id,
    cells: values.map((value) => new Signal.State(value)),
  }));
}

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;

let people: Signal.State<readonly Person[]>;
let columns: Signal.State<readonly GridColumn<Person>[]>;
let editors: Signal.State<Readonly<Record<string, GridEditor<Person>>>>;
let changes: GridEditChange<Person>[];
/** Where each abandoned session was, as `onCancel` reported it. */
let cancelled: { row: number; column: number }[];
let refusals: string[];
/** Whether the caller applies what it is told, which is the only way a row changes. */
let applyChanges = true;

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
  changes = [];
  cancelled = [];
  refusals = [];
  applyChanges = true;
  people = new Signal.State<readonly Person[]>(tableOf(TABLE));
  columns = new Signal.State<readonly GridColumn<Person>[]>(makeColumns());
  // The middle column has no editor at all, which is how a column is made
  // read-only: there is no flag for it, and nothing to forget to set.
  editors = new Signal.State<Readonly<Record<string, GridEditor<Person>>>>({
    c0: {},
    c2: {
      parse: (raw) => Number(raw),
      validate: (value) => (Number(value) < 0 ? 'Not negative' : null),
    },
  });

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

const TEMPLATE = `
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
            <div class="cell" :for="col in g.columns()" :key="col.key"
                 :spread="cellProps(row, col)" :dblclick="onBegin(row, col)">
              <input :if="editing.isEditing(row.index, col.index)" class="editor"
                     :spread="editing.editorProps()" :value="editing.text()"
                     :input="editing.onInput($event)">
              <span :else class="text">{ g.cellValue(row, col) }</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <p class="error" :if="editing.error() !== null" :spread="editing.errorProps()">{ editing.error() }</p>
  </div>
`;

interface EditInstance {
  g: Grid<Person>;
  editing: GridCellEditing<Person>;
  handled: boolean;
}

interface Harness {
  g: Grid<Person>;
  editing: GridCellEditing<Person>;
  instance: EditInstance;
  root: HTMLElement;
  scroller: HTMLElement;
}

function setup({ height = VIEWPORT_HEIGHT, width = VIEWPORT_WIDTH } = {}): Harness {
  @Component({ selector: `v-edit-${++selectors}`, render: compileTemplate(TEMPLATE) })
  class EditableGrid {
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
      getRowKey: (row) => row.id,
      rowHeight: ROW_HEIGHT,
      label: 'People',
    });

    editing = createCellEditing<Person>({
      grid: () => this.g,
      editors: () => editors.get(),
      columns: () => columns.get(),
      onCommit: (change) => {
        changes.push(change);
        // What a caller does with it: write it into the store the rows came
        // from. Nothing in the grid or the editing session did this.
        if (applyChanges) {
          const index = columns.get().findIndex((column) => column.id === change.columnId);
          change.item.cells[index]!.set(String(change.value));
        }
      },
      onCancel: (session) => cancelled.push({ row: session.row, column: session.column }),
      onInvalid: (message) => refusals.push(message),
    });

    cellProps(row: GridRow<Person>, col: never): Record<string, unknown> {
      return { ...this.g.cellProps(row, col), ...this.editing.cellProps(row, col) };
    }

    onBegin(row: GridRow<Person>, col: never): void {
      this.editing.begin(row, col);
    }

    onKey(event: KeyboardEvent): void {
      this.handled = this.editing.onKeyDown(event) || this.g.onKeyDown(event);
    }
  }

  const handle = mount(EditableGrid, host);
  mounted.push(handle);

  const scroller = host.querySelector<HTMLElement>('.body')!;
  Object.defineProperty(scroller, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(scroller, 'clientWidth', { value: width, configurable: true });
  FakeResizeObserver.deliver([{ target: scroller, block: height, inline: width }]);

  const instance = handle.instance as EditInstance;
  return {
    g: instance.g,
    editing: instance.editing,
    instance,
    root: host.querySelector<HTMLElement>('.grid')!,
    scroller,
  };
}

function cells(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.cell')];
}

/**
 * The text node each cell renders its value into, by the cell that holds it.
 *
 * Keyed by the cell rather than by position, because a cell being edited has no
 * text node at all — an editor stands where it was — and a positional list
 * would report every cell after it as changed.
 */
function textNodesByCell(): Map<HTMLElement, ChildNode | null> {
  const nodes = new Map<HTMLElement, ChildNode | null>();
  for (const cell of cells()) {
    nodes.set(cell, cell.querySelector('.text')?.firstChild ?? null);
  }
  return nodes;
}

/** The cells whose text node is not the one they had. */
function changedTextNodes(before: Map<HTMLElement, ChildNode | null>): HTMLElement[] {
  return cells().filter((cell) => {
    const node = cell.querySelector('.text')?.firstChild ?? null;
    return before.get(cell) !== node;
  });
}

function cellAt(row: number, column: number): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[${GRID_CELL_ATTRIBUTE}="${row},${column}"]`);
}

function textAt(row: number, column: number): string | null {
  return cellAt(row, column)?.textContent ?? null;
}

function editor(): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>(`[${GRID_EDITOR_ATTRIBUTE}]`);
}

function attrs(selector: string, name: string): (string | null)[] {
  return [...host.querySelectorAll<HTMLElement>(selector)].map((el) => el.getAttribute(name));
}

function press(el: Element, key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

/** The reader typing into the open editor. */
function type(text: string): void {
  const input = editor()!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** Opens the cell at a position through the model, as a double click would. */
function begin(harness: Harness, row: number, column: number): boolean {
  const view = harness.g.rows().find((candidate) => candidate.index === row)!;
  const col = harness.g.columns().find((candidate) => candidate.index === column)!;
  const opened = harness.editing.begin(view, col);
  flushSync();
  return opened;
}

// ---------------------------------------------------------------------------

describe('opening a session', () => {
  it('opens on the cell it is given, holding what that cell held', () => {
    const harness = setup();
    expect(begin(harness, 1, 0)).toBe(true);

    expect(harness.editing.session()).toMatchObject({
      row: 1,
      column: 0,
      columnId: 'c0',
      initial: 'beta',
    });
    expect(harness.editing.text()).toBe('beta');
    // The editor is inside the cell it is editing, and nowhere else.
    expect(editor()!.value).toBe('beta');
    expect(editor()!.closest('.cell')).toBe(cellAt(1, 0));
    expect(cellAt(1, 0)!.getAttribute('data-editing')).toBe('');
  });

  it('opens from a double click on the cell', () => {
    const harness = setup();
    cellAt(2, 2)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    flushSync();
    expect(harness.editing.session()!.column).toBe(2);
  });

  it('refuses a column that has no editor, and says so on every one of its cells', () => {
    const harness = setup();
    expect(begin(harness, 1, 1)).toBe(false);
    expect(harness.editing.session()).toBeNull();
    expect(editor()).toBeNull();

    // Only the read-only cells carry it: in a grid where editing is the point,
    // `false` on every editable cell is noise for the few that are not.
    const row = cells().slice(3, 6);
    expect(row.map((cell) => cell.getAttribute('aria-readonly'))).toEqual([null, 'true', null]);
  });

  it('refuses a row the column says cannot be edited', () => {
    editors.set({ c0: { editable: (row) => row.id !== 2 } });
    const harness = setup();

    expect(begin(harness, 2, 0)).toBe(false);
    expect(cellAt(2, 0)!.getAttribute('aria-readonly')).toBe('true');
    // Its neighbours in the same column are editable, which is what a
    // per-column flag could not express.
    expect(begin(harness, 1, 0)).toBe(true);
    expect(cellAt(1, 0)!.getAttribute('aria-readonly')).toBeNull();
  });

  it('opens the cell under the cursor with Enter, and with F2', () => {
    const harness = setup();
    harness.g.focusCell({ row: 2, column: 0 });
    flushSync();

    press(harness.root, 'Enter');
    expect(harness.editing.session()!.row).toBe(2);
    harness.editing.cancel();
    flushSync();

    press(harness.root, 'F2');
    expect(harness.editing.session()!.row).toBe(2);
  });

  it('leaves Enter on the column header alone, where there is nothing to edit', () => {
    const harness = setup();
    harness.g.focusCell({ row: -1, column: 0 });
    flushSync();

    press(harness.root, 'Enter');
    expect(harness.editing.session()).toBeNull();
    // And the grid took it instead, as the sort gesture it is up there.
    expect(harness.g.sortDirection('c0')).toBe('ascending');
  });

  it('commits what is open when a second cell is opened', () => {
    const harness = setup();
    begin(harness, 1, 0);
    type('beta!');

    begin(harness, 2, 0);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ rowIndex: 1, columnId: 'c0', value: 'beta!' });
    expect(harness.editing.session()!.row).toBe(2);
  });
});

describe('committing', () => {
  it('reports the change and never writes the row', () => {
    applyChanges = false;
    const harness = setup();
    const source = people.get();
    const row = source[1]!;

    begin(harness, 1, 0);
    type('beta!');
    expect(harness.editing.commit()).toBe(true);
    flushSync();

    expect(changes).toEqual([
      {
        item: row,
        rowKey: 1,
        rowIndex: 1,
        columnId: 'c0',
        previous: 'beta',
        value: 'beta!',
      },
    ]);
    // The caller declined to apply it, so nothing anywhere has changed: not the
    // row, not the array, and not the cell the reader was typing into.
    expect(row.cells[0]!.get()).toBe('beta');
    expect(people.get()).toBe(source);
    expect(textAt(1, 0)).toBe('beta');
    expect(harness.editing.session()).toBeNull();
  });

  it('writes one text node once the caller applies it, and re-renders nothing', () => {
    const harness = setup();
    begin(harness, 1, 0);
    const before = cells();
    const texts = textNodesByCell();
    reads = [];

    type('beta!');
    harness.editing.commit();
    flushSync();

    expect(textAt(1, 0)).toBe('beta!');
    // One accessor ran: the cell whose value the caller wrote. The editor that
    // replaced its text is gone, so that one cell renders a new node; every
    // other cell in the window still holds the node it already had.
    expect(reads).toEqual(['1:0']);
    expect(cells()).toEqual(before);
    expect(changedTextNodes(texts)).toEqual([cellAt(1, 0)]);
  });

  it('asks no other cell what it holds when an editor opens and shuts', () => {
    const harness = setup();
    const before = cells();
    const texts = textNodesByCell();
    reads = [];

    begin(harness, 1, 0);
    // Thirty-five cells rewrote two attributes each. Not one of them was asked
    // for its value: the session is a signal their *prop* bindings depend on,
    // and a prop binding does not read a cell.
    expect(reads.filter((read) => read !== '1:0')).toEqual([]);
    expect(cells()).toEqual(before);
    expect(changedTextNodes(texts)).toEqual([cellAt(1, 0)]);

    reads = [];
    harness.editing.cancel();
    flushSync();
    // And coming back costs exactly the one cell that went away.
    expect(reads).toEqual(['1:0']);
    expect(changedTextNodes(texts)).toEqual([cellAt(1, 0)]);
  });

  it('reports nothing when the value the reader left is the value it had', () => {
    const harness = setup();
    begin(harness, 1, 0);

    expect(harness.editing.commit()).toBe(true);
    flushSync();
    // Nothing changed, so nothing happened: no request, no undo entry, no
    // dirty flag for a reader who opened a cell and pressed Enter.
    expect(changes).toEqual([]);
    expect(harness.editing.session()).toBeNull();
  });

  it('leaves the text the reader typed in the control while it parses it', () => {
    const harness = setup();
    begin(harness, 1, 2);

    // On the way to a negative number: `Number('-')` is NaN, `Number('-0')`
    // reads back as "0", and the reader is looking at neither.
    type('-');
    expect(editor()!.value).toBe('-');
    expect(harness.editing.draft()).toBeNaN();
    type('-0');
    expect(editor()!.value).toBe('-0');
    type('-0.5');
    expect(editor()!.value).toBe('-0.5');
    expect(harness.editing.draft()).toBe(-0.5);

    // A cleared field stays clear, though `Number('')` is 0, and a number that
    // reads back differently from how it was typed is left as it was typed.
    type('');
    expect(editor()!.value).toBe('');
    type('.5');
    expect(editor()!.value).toBe('.5');
    expect(harness.editing.text()).toBe('.5');
    expect(harness.editing.draft()).toBe(0.5);
  });

  it('commits what the column parsed, not the text the control held', () => {
    const harness = setup();
    begin(harness, 1, 2);
    type('42');

    expect(harness.editing.draft()).toBe(42);
    harness.editing.commit();
    expect(changes[0]!.value).toBe(42);
    expect(changes[0]!.previous).toBe('2');
  });
});

describe('the view moving under a session', () => {
  it('keeps the editor on its row when a sort moves it, and commits to that row', () => {
    const harness = setup();
    begin(harness, 1, 0);
    type('beta!');

    // A click on a header while a cell is open does this.
    harness.g.setSort([{ columnId: 'c0', direction: 'descending' }]);
    flushSync();

    // gamma, delta, beta, alpha: beta is third now, and the editor went with it.
    expect(harness.editing.session()!.row).toBe(2);
    expect(editor()!.closest('.cell')).toBe(cellAt(2, 0));
    expect(editor()!.value).toBe('beta!');
    expect(harness.editing.isEditing(1, 0)).toBe(false);
    expect(textAt(1, 0)).toBe('delta');

    harness.editing.commit();
    flushSync();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ rowKey: 1, rowIndex: 2, value: 'beta!' });
    expect(changes[0]!.item).toBe(people.get()[1]);
    expect(textAt(2, 0)).toBe('beta!');
    expect(textAt(1, 0)).toBe('delta');
  });

  it('abandons the session when its row leaves the view, and says the row has gone', () => {
    const harness = setup();
    begin(harness, 1, 0);
    type('beta!');
    // Moved first, so that the place it opened at and the place it had last
    // are both somewhere, and neither is where it is now.
    harness.g.setSort([{ columnId: 'c0', direction: 'descending' }]);
    flushSync();
    expect(harness.editing.session()!.row).toBe(2);

    harness.g.setFilter('c0', { type: 'text', value: 'a', operator: 'startsWith' });
    flushSync();

    // Nothing is left to show the editor in, and nothing was committed: an
    // edit nobody can see is not one to write, nor one to keep claiming keys.
    expect(harness.editing.session()).toBeNull();
    expect(editor()).toBeNull();
    expect(changes).toEqual([]);
    expect(host.querySelector('[data-editing]')).toBeNull();
    // Told where the cell is now: its row is nowhere, and its column is where
    // it always was.
    expect(cancelled).toEqual([{ row: -1, column: 0 }]);
  });

  it('keeps the editor on its column when the columns come in another order, and commits to it', () => {
    applyChanges = false;
    const harness = setup();
    begin(harness, 1, 0);
    type('beta!');

    columns.set([...columns.get()].reverse());
    flushSync();

    // c2, c1, c0: the column opened is last now, and the editor went with it.
    expect(harness.editing.session()).toMatchObject({ row: 1, column: 2, columnId: 'c0' });
    expect(editor()!.closest('.cell')).toBe(cellAt(1, 2));
    expect(cellAt(1, 2)!.getAttribute('data-column')).toBe('c0');
    expect(editor()!.value).toBe('beta!');
    expect(harness.editing.isEditing(1, 0)).toBe(false);

    harness.editing.commit();
    flushSync();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ rowKey: 1, columnId: 'c0', value: 'beta!' });
  });

  it('abandons the session when its column is taken out of the list', () => {
    const harness = setup();
    begin(harness, 1, 2);
    type('7');

    columns.set(columns.get().filter((column) => column.id !== 'c2'));
    flushSync();

    expect(harness.editing.session()).toBeNull();
    expect(editor()).toBeNull();
    expect(changes).toEqual([]);
    expect(cancelled).toEqual([{ row: 1, column: -1 }]);
  });
});

describe('cancelling', () => {
  it('abandons the edit and leaves the value where it was', () => {
    const harness = setup();
    begin(harness, 1, 0);
    type('beta!');

    harness.editing.cancel();
    flushSync();

    expect(changes).toEqual([]);
    expect(cancelled).toEqual([{ row: 1, column: 0 }]);
    expect(harness.editing.session()).toBeNull();
    expect(textAt(1, 0)).toBe('beta');
  });

  it('puts focus back on the cell, rather than dropping it out of the grid', () => {
    const harness = setup();
    begin(harness, 1, 0);
    editor()!.focus();
    expect(document.activeElement).toBe(editor());

    press(editor()!, 'Escape');

    // The element that had focus has just stopped existing. Without this the
    // browser puts focus on the document and a keyboard reader is outside the
    // grid with no way back to where they were.
    expect(document.activeElement).toBe(cellAt(1, 0));
    expect(harness.editing.session()).toBeNull();
  });
});

describe('validation', () => {
  it('refuses the commit, and keeps what the reader typed', () => {
    const harness = setup();
    begin(harness, 1, 2);
    type('-5');

    expect(harness.editing.commit()).toBe(false);
    flushSync();

    // Still open, still holding the refused value, and nothing was reported as
    // a change — because a change that failed validation did not happen.
    expect(changes).toEqual([]);
    expect(harness.editing.session()!.column).toBe(2);
    expect(harness.editing.draft()).toBe(-5);
    expect(editor()!.value).toBe('-5');
    expect(harness.editing.error()).toBe('Not negative');
    expect(refusals).toEqual(['Not negative']);
  });

  it('says so on the control and in something that will be read out', () => {
    const harness = setup();
    begin(harness, 1, 2);
    type('-5');
    harness.editing.commit();
    flushSync();

    const message = host.querySelector<HTMLElement>('.error')!;
    expect(message.getAttribute('role')).toBe('alert');
    expect(message.textContent).toBe('Not negative');
    expect(editor()!.getAttribute('aria-invalid')).toBe('true');
    // Named by the control, so a reader who moves back to it is told why.
    expect(editor()!.getAttribute('aria-errormessage')).toBe(message.getAttribute('id'));
    expect(cellAt(1, 2)!.getAttribute('aria-invalid')).toBe('true');
  });

  it('clears the refusal as soon as the reader answers it', () => {
    const harness = setup();
    begin(harness, 1, 2);
    type('-5');
    harness.editing.commit();
    flushSync();
    expect(harness.editing.error()).toBe('Not negative');

    type('5');
    expect(harness.editing.error()).toBeNull();
    expect(host.querySelector('.error')).toBeNull();
    expect(editor()!.getAttribute('aria-invalid')).toBeNull();

    expect(harness.editing.commit()).toBe(true);
    expect(changes[0]!.value).toBe(5);
  });

  it('clears the refusal when the draft is replaced from code, as it does for typing', () => {
    const harness = setup();
    begin(harness, 1, 2);
    type('-5');
    harness.editing.commit();
    flushSync();
    expect(harness.editing.error()).toBe('Not negative');

    // A picker or a stepper answering the refusal, rather than the keyboard.
    harness.editing.setDraft(5);
    flushSync();
    expect(harness.editing.error()).toBeNull();
    expect(host.querySelector('.error')).toBeNull();
    expect(editor()!.getAttribute('aria-invalid')).toBeNull();
    // And the control shows what the draft now is.
    expect(editor()!.value).toBe('5');
  });

  it('will not let Enter or Tab leave a cell the validator refused', () => {
    const harness = setup();
    begin(harness, 1, 2);
    type('-5');

    press(editor()!, 'Enter');
    expect(harness.editing.session()!.row).toBe(1);
    press(editor()!, 'Tab');
    expect(harness.editing.session()!.column).toBe(2);
    expect(changes).toEqual([]);
  });

  it('refuses to open another cell while one is refusing to close', () => {
    const harness = setup();
    begin(harness, 1, 2);
    type('-5');
    harness.editing.commit();

    expect(begin(harness, 2, 0)).toBe(false);
    expect(harness.editing.session()!.row).toBe(1);
  });
});

describe('the keyboard', () => {
  it('commits and moves down a row on Enter', () => {
    const harness = setup();
    begin(harness, 1, 0);
    type('beta!');

    press(editor()!, 'Enter');

    expect(changes[0]!.value).toBe('beta!');
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 0 });
    // Down, not into another editor: the reader asked to be finished.
    expect(harness.editing.session()).toBeNull();
    expect(textAt(1, 0)).toBe('beta!');
  });

  it('goes back up a row on Shift and Enter', () => {
    const harness = setup();
    begin(harness, 2, 0);
    press(editor()!, 'Enter', { shiftKey: true });
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 0 });
  });

  it('commits and opens the next cell that can be edited on Tab', () => {
    const harness = setup();
    begin(harness, 1, 0);
    type('beta!');

    const event = press(editor()!, 'Tab');

    expect(changes[0]!.value).toBe('beta!');
    // Column one has no editor, so it is stepped over rather than landed on: a
    // Tab that stopped there would need a second Tab to do anything.
    expect(harness.editing.session()).toMatchObject({ row: 1, column: 2 });
    expect(editor()!.closest('.cell')).toBe(cellAt(1, 2));
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 2 });
    // Taken from the browser: the editor is the only tab stop in the grid, and
    // left alone this would put the reader somewhere after the table.
    expect(event.defaultPrevented).toBe(true);
  });

  it('goes back a cell on Shift and Tab', () => {
    const harness = setup();
    begin(harness, 1, 2);
    press(editor()!, 'Tab', { shiftKey: true });
    expect(harness.editing.session()).toMatchObject({ row: 1, column: 0 });
  });

  it('stops at the end of the collection, on the cell it committed', () => {
    const harness = setup();
    begin(harness, 3, 2);
    editor()!.focus();

    const event = press(editor()!, 'Tab');

    // The last editable cell of the last row. There is no next cell to open,
    // and the editor that held focus has gone: focus goes back to the cell it
    // was in, rather than to the document.
    expect(harness.editing.session()).toBeNull();
    expect(harness.g.activeCell()).toEqual({ row: 3, column: 2 });
    expect(document.activeElement).toBe(cellAt(3, 2));
    expect(event.defaultPrevented).toBe(true);
  });

  it('stays on the cell it committed when Enter has no row below to go to', () => {
    const harness = setup();
    begin(harness, 3, 0);
    editor()!.focus();
    type('delta!');

    press(editor()!, 'Enter');

    expect(changes[0]!.value).toBe('delta!');
    expect(harness.editing.session()).toBeNull();
    expect(harness.g.activeCell()).toEqual({ row: 3, column: 0 });
    expect(document.activeElement).toBe(cellAt(3, 0));
  });

  it.each(['Enter', 'Tab'])(
    'puts focus on the header when %s commits away the last row there was',
    (key) => {
      const harness = setup();
      harness.g.setFilter('c0', { type: 'text', value: 'a', operator: 'startsWith' });
      flushSync();
      expect(harness.g.rowCount()).toBe(1);

      begin(harness, 0, 0);
      editor()!.focus();
      type('zeta');
      press(editor()!, key);

      // The value written no longer matches the filter, and its row was the
      // only one. The header is where a grid with no rows keeps its cursor,
      // and focus goes there with it rather than to the document.
      expect(changes[0]!.value).toBe('zeta');
      expect(harness.g.rowCount()).toBe(0);
      expect(harness.editing.session()).toBeNull();
      expect(harness.g.activeCell()).toEqual({ row: -1, column: 0 });
      expect(document.activeElement).toBe(cellAt(-1, 0));
    },
  );

  it('runs off the end of a row into the next one', () => {
    const harness = setup();
    begin(harness, 1, 2);

    press(editor()!, 'Tab');

    expect(harness.editing.session()).toMatchObject({ row: 2, column: 0 });
    expect(harness.g.activeCell()).toEqual({ row: 2, column: 0 });
  });

  it('runs back off the front of a row into the one before it', () => {
    const harness = setup();
    begin(harness, 2, 0);

    press(editor()!, 'Tab', { shiftKey: true });

    expect(harness.editing.session()).toMatchObject({ row: 1, column: 2 });
  });

  it('gives every other key to the control being typed into', () => {
    const harness = setup();
    begin(harness, 1, 0);
    const cursor = harness.g.activeCell();

    // An arrow inside an editor is the caret moving through the text. The grid
    // must not also move its cursor, or the reader is editing one cell and
    // standing on another.
    const event = press(editor()!, 'ArrowRight');
    expect(harness.editing.session()!.column).toBe(0);
    expect(harness.g.activeCell()).toEqual(cursor);
    // Claimed, but not prevented: the control still does what the key means.
    expect(event.defaultPrevented).toBe(false);

    // And with nothing open, an arrow is the grid's as it always was.
    harness.editing.cancel();
    flushSync();
    press(harness.root, 'ArrowRight');
    expect(harness.g.activeCell()).toEqual({ row: 1, column: 1 });
  });

  it('marks the editable cells for a stylesheet, and only while they are open', () => {
    const harness = setup();
    expect(attrs('.cell', 'data-editing').filter((value) => value !== null)).toEqual([]);

    begin(harness, 1, 0);
    expect(attrs('.cell', 'data-editing').filter((value) => value !== null)).toEqual(['']);

    harness.editing.cancel();
    flushSync();
    expect(attrs('.cell', 'data-editing').filter((value) => value !== null)).toEqual([]);
  });
});
