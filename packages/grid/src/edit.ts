/**
 * Cell editing, as a session that reports a change rather than making one.
 *
 * Nothing here writes to a row. An edit ends by handing the caller a change —
 * which row, which column, what it was, what it is now — and the caller applies
 * it to their own store, exactly as sorting and filtering hand back a view and
 * never reorder the array they were given. That is not squeamishness: the rows
 * belong to whoever passed them in, a commit usually has to reach a server
 * before it is true, and a grid that had already written the new value would
 * have no way to put the old one back when the server said no.
 *
 *   class People {
 *     editing = createCellEditing<Person>({
 *       grid: () => this.table,
 *       editors: () => ({
 *         name: { validate: (value) => (String(value) === '' ? 'A name is required' : null) },
 *         salary: {
 *           // A cleared field is no number, where `Number('')` would make it 0.
 *           parse: (raw) => (raw.trim() === '' ? null : Number(raw)),
 *           validate: (value) =>
 *             typeof value !== 'number' || Number.isNaN(value) ? 'Enter a number'
 *             : value < 0 ? 'Not negative' : null,
 *         },
 *       }),
 *       onCommit: (change) => this.store.write(change.item, change.columnId, change.value),
 *     });
 *   }
 *
 *   <div class="cell" :for="col in table.columns()" :key="col.key"
 *        :spread="table.cellProps(row, col)"
 *        :spread="editing.cellProps(row, col)"
 *        :dblclick="editing.begin(row, col)">
 *     <input :if="editing.isEditing(row.index, col.index)"
 *            :spread="editing.editorProps()" :value="editing.text()"
 *            :input="editing.onInput($event)" :keydown="editing.onKeyDown($event)">
 *     <span :else>{ table.cellValue(row, col) }</span>
 *   </div>
 *
 * **One session at a time**, because a cell editor is a focused control and
 * there is one focus. Opening a second commits the first, which is what a
 * reader clicking from one cell to the next means by it.
 *
 * The keyboard is the spreadsheet's, and it is the whole reason an edit session
 * is a state machine rather than an input with a blur handler:
 *
 *   Enter, F2                  open the cell under the cursor
 *   Enter                      commit, and move down one row
 *   Shift + Enter              commit, and move up one row
 *   Escape                     abandon the edit, and stay where it was
 *   Tab, Shift + Tab           commit, move to the next cell that can be
 *                              edited, and open it
 *
 * Tab is the one that has to be taken from the browser: left alone it would
 * move focus out of a grid whose only tab stop is the cell being edited, and
 * the reader would land somewhere after the table with their edit half made.
 *
 * Every *other* key is claimed too, and deliberately not handled. While an
 * editor is open the grid's own navigation is suspended: an arrow inside a text
 * field moves the caret, and a grid that also moved its cursor would leave the
 * reader editing one cell while standing on another.
 *
 * **Validation refuses a commit rather than reporting one.** A `validate` that
 * returns a message leaves the session open, the value the reader typed still
 * in it, focus still in the editor, and `aria-invalid` on it — nothing is
 * handed to `onCommit`, because a change that failed validation is not a change
 * that happened. The message is rendered into a `role="alert"`, which is what
 * makes a refusal audible to a reader who cannot see the cell turn red.
 *
 * **A cell still owns its own binding.** Opening an editor reads no cell's
 * value: the session is a signal the cells' *prop* bindings depend on, and a
 * prop binding re-running rewrites two attributes without asking the cell what
 * it holds. Committing reads none either — the new value reaches the DOM only
 * when the caller writes it into whatever signal their accessor reads, and then
 * one text node changes.
 */

import { Signal, effect } from '@voltdev/core';
import { createId } from '@voltdev/primitives';
import { asText } from './filter.js';
import type {
  Grid,
  GridCell,
  GridColumn,
  GridColumnView,
  GridProps,
  GridRow,
} from './grid.js';
import type { GridRowKey } from './selection.js';

const { untrack } = Signal.subtle;

/** Marks the control an edit session is being typed into. */
export const GRID_EDITOR_ATTRIBUTE = 'data-volt-grid-editor';

/**
 * What a column can do when it is edited.
 *
 * A column with no entry in `editors` cannot be edited at all, which is what
 * makes an editable grid's read-only columns say so rather than silently
 * swallowing a double click.
 */
export interface GridEditor<T> {
  /**
   * Whether this particular row's cell may be edited. Default: all of them.
   *
   * Per row and not per column, because "everything except the archived ones"
   * is the common case and a column-level flag cannot express it.
   */
  readonly editable?: (row: T) => boolean;
  /** The value the editor opens with. Defaults to the column's own accessor. */
  readonly read?: (row: T) => unknown;
  /**
   * What the control produced, as the value to commit. Default: the text
   * itself.
   *
   * Run on every keystroke, and never written back: the control keeps the text
   * the reader typed, so a parse may return anything for text they have not
   * finished. `Number` is most of a numeric column's, but not all of it — it
   * reads a half-typed "-" as NaN, which `validate` has to refuse, and a
   * cleared field as 0, which is the trap `Number('')` sets.
   */
  readonly parse?: (raw: string) => unknown;
  /**
   * Refuse a commit: a message to show, or null to accept.
   *
   * The message is the point — a boolean would leave the reader with a cell
   * that will not close and no way to find out why.
   */
  readonly validate?: (value: unknown, row: T) => string | null;
}

/** What an edit did, once it was allowed to. */
export interface GridEditChange<T> {
  /** The caller's own row object — not a copy, and not written to. */
  readonly item: T;
  readonly rowKey: GridRowKey;
  /**
   * Where the row was in the view when the change was committed — a place in
   * the sorted, filtered view and not in the caller's array, and one the
   * change itself may move the row from. Find the row by `rowKey` or `item`,
   * not by this.
   */
  readonly rowIndex: number;
  readonly columnId: string;
  readonly previous: unknown;
  readonly value: unknown;
}

/**
 * The cell being edited, and what it held when the session opened.
 *
 * `row` is where that row sits in the view now, and `column` where that column
 * sits in the column list: the session is held by `rowKey` and `columnId`, and
 * follows its cell through a sort, a filter, or a column list given in another
 * order. A session abandoned because its cell has gone is reported with -1 for
 * whichever of the two went.
 */
export interface GridEditSession<T> {
  readonly row: number;
  readonly column: number;
  readonly columnId: string;
  readonly item: T;
  readonly rowKey: GridRowKey;
  readonly initial: unknown;
}

export interface GridCellEditingOptions<T> {
  /**
   * The grid being edited.
   *
   * A function rather than the grid itself, because the two are usually fields
   * of the same component and the grid has to exist first.
   */
  grid: () => Grid<T> | null | undefined;
  /** What each column can do when edited, by column id. */
  editors: () => Readonly<Record<string, GridEditor<T>>>;
  /**
   * The columns, in order — the same list the grid is given.
   *
   * Only Tab needs it, and only to step over the columns that have no editor:
   * the grid renders a window, so the column at an index outside it has no
   * other way of being named. Without it Tab lands on the next cell whatever
   * it is, and opens nothing when that cell cannot be edited.
   */
  columns?: () => readonly GridColumn<T>[];
  /**
   * Where a committed change goes. The only way a value ever changes: apply it
   * to the store the rows came from, and the cell's own binding does the rest.
   */
  onCommit: (change: GridEditChange<T>) => void;
  /**
   * Called when a session is abandoned, with the cell it was on — or, where
   * the session went because its row or its column did, with -1 in its place.
   */
  onCancel?: (session: GridEditSession<T>) => void;
  /** Called when validation refused a commit, before the message is shown. */
  onInvalid?: (message: string, session: GridEditSession<T>) => void;
}

export interface GridCellEditing<T> {
  /** The open session, or null. */
  session(): GridEditSession<T> | null;
  isEditing(row: number, column: number): boolean;
  /** Whether this cell could be opened at all. */
  isEditable(row: GridRow<T>, column: GridColumnView<T>): boolean;

  /** Opens a session. Returns false where the cell cannot be edited. */
  begin(row: GridRow<T>, column: GridColumnView<T>): boolean;
  /** Opens the cell at a position, if it is rendered and editable. */
  beginAt(cell: GridCell): boolean;

  /** What the reader has typed, parsed. */
  draft(): unknown;
  /**
   * What the control should hold: the text the reader typed, as they typed it,
   * or the draft's own text once code has set it.
   */
  text(): string;
  /**
   * Replace the draft from code — a `<select>`, a picker, a stepper. Clears a
   * refusal, as typing does.
   */
  setDraft(value: unknown): void;
  /** The message validation refused with, or null. */
  error(): string | null;

  /**
   * Commits, unless validation refuses. Returns whether it closed the session.
   * A value the reader did not change reports nothing and closes.
   */
  commit(): boolean;
  /** Abandons the edit and puts focus back on the cell. */
  cancel(): void;

  /** Spread onto the editing control. */
  editorProps(): GridProps;
  /** Spread onto the element showing the refusal message. */
  errorProps(): GridProps;
  /** Spread onto the cell, after the grid's own `cellProps`. */
  cellProps(row: GridRow<T>, column: GridColumnView<T>): GridProps;

  /**
   * The editing keyboard. Wire it before the grid's own `onKeyDown`, which owns
   * every key this leaves alone.
   */
  onKeyDown(event: KeyboardEvent): boolean;
  /** Reads the control and keeps the draft in step. */
  onInput(event: Event): void;
}

export function createCellEditing<T>(options: GridCellEditingOptions<T>): GridCellEditing<T> {
  const state = new Signal.State<GridEditSession<T> | null>(null);
  const draft = new Signal.State<unknown>(null);
  /**
   * The control's text, held apart from the draft it parses to.
   *
   * The control is bound to this, so it has to be what the reader typed and
   * not the parsed draft read back: `Number('-')` is NaN and `Number('')` is 0,
   * and a control bound to the draft would write "NaN" over a minus sign and
   * "0" over a field the reader had just cleared.
   */
  const text = new Signal.State('');
  const error = new Signal.State<string | null>(null);
  // Stable across the session's whole life, because `aria-errormessage` on the
  // control has to name an element that will exist by the time it is read.
  const errorId = createId('volt-grid-error');

  const editorFor = (columnId: string): GridEditor<T> | null =>
    options.editors()[columnId] ?? null;

  const isEditable = (row: GridRow<T>, column: GridColumnView<T>): boolean => {
    const editor = editorFor(column.column.id);
    if (editor === null) return false;
    return editor.editable?.(row.item) ?? true;
  };

  const grid = (): Grid<T> | null => options.grid() ?? null;

  /**
   * Where the open session's row sits in the view now, or -1 once the view no
   * longer holds it.
   *
   * A session is held by its row's key, not by the place the row had when it
   * opened. A sort or a filter while a cell is open — a click on a header is
   * enough — moves rows under it, and a place would leave the editor over
   * whichever row slid into it while the commit still went to the row it was
   * opened on. Found again on every change to the view: a scan of it while a
   * session is open, and nothing at all while none is.
   *
   * Which is only as good as the key. The default key is the row's index, and
   * finds whatever row is at that index now — so without `getRowKey` a sort
   * still leaves the editor over another row, the cost `createGrid` documents
   * for the cursor, here with the commit going to the row it was opened on.
   */
  const openRow = new Signal.Computed<number>(() => {
    const session = state.get();
    if (session === null) return -1;
    const table = grid();
    return table === null ? session.row : table.rowIndex(session.rowKey);
  });

  /**
   * Where the open session's column sits in the column list now, or -1 once
   * the list no longer holds it.
   *
   * By id, for the reason the row is found by key: a column list handed over
   * in another order, or with a column taken out, would otherwise leave the
   * editor over a different column from the one the commit names.
   */
  const openColumn = new Signal.Computed<number>(() => {
    const session = state.get();
    if (session === null) return -1;
    const table = grid();
    return table === null ? session.column : table.columnIndex(session.columnId);
  });

  /** The open session, at its cell's place now — null once that cell is gone. */
  const live = new Signal.Computed<GridEditSession<T> | null>(() => {
    const session = state.get();
    if (session === null) return null;
    const row = openRow.get();
    const column = openColumn.get();
    if (row < 0 || column < 0) return null;
    return row === session.row && column === session.column
      ? session
      : { ...session, row, column };
  });

  const open = (row: GridRow<T>, column: GridColumnView<T>): boolean => {
    const editor = editorFor(column.column.id);
    if (editor === null) return false;
    if (editor.editable?.(row.item) === false) return false;

    // Whatever is already open is finished first. A reader who clicks from one
    // cell to the next means the first one to stand, and dropping it silently
    // is how an edit disappears without anyone noticing.
    const current = untrack(() => live.get());
    if (current !== null) {
      if (current.row === row.index && current.column === column.index) return true;
      if (!commit()) return false;
    }

    const initial = untrack(() => (editor.read ?? column.column.value)(row.item));
    state.set({
      row: row.index,
      column: column.index,
      columnId: column.column.id,
      item: row.item,
      rowKey: row.key,
      initial,
    });
    draft.set(initial);
    text.set(asText(initial));
    error.set(null);
    return true;
  };

  /** The rendered row and column at a position, if the window holds them. */
  const viewsAt = (
    cell: GridCell,
  ): { row: GridRow<T>; column: GridColumnView<T> } | null => {
    const table = grid();
    if (table === null) return null;
    const row = untrack(() => table.rows()).find((candidate) => candidate.index === cell.row);
    const column = untrack(() => table.columns()).find(
      (candidate) => candidate.index === cell.column,
    );
    if (row === undefined || column === undefined) return null;
    return { row, column };
  };

  const beginAt = (cell: GridCell): boolean => {
    const views = viewsAt(cell);
    return views !== null && open(views.row, views.column);
  };

  const close = (): void => {
    state.set(null);
    draft.set(null);
    text.set('');
    error.set(null);
  };

  // A session whose cell has gone — a filter hid its row, the data no longer
  // holds it, or its column was taken out of the list — is abandoned. Kept
  // open, it would claim every key for an editor nobody can see, and commit to
  // a cell the reader can no longer check. `onCancel` is told where the cell
  // is now, which for the half that went is nowhere. Unlike Escape, this puts
  // no focus back: the cell it would go back to is the thing that went, and
  // focus is left where the grid leaves it when a filter hides a focused cell.
  effect(() => {
    if (live.get() !== null) return;
    const session = untrack(() => state.get());
    if (session === null) return;
    const gone = {
      ...session,
      row: untrack(() => openRow.get()),
      column: untrack(() => openColumn.get()),
    };
    close();
    options.onCancel?.(gone);
  });

  /**
   * Replace the draft, and the text the control shows for it.
   *
   * Typing and code come through here alike, and either one is the reader
   * answering a refusal that is up. Leaving it up until the next commit would
   * mean a cell that reads as invalid while it is being made valid.
   */
  const write = (value: unknown, typed: string): void => {
    draft.set(value);
    text.set(typed);
    if (untrack(() => error.get()) !== null) error.set(null);
  };

  function commit(): boolean {
    const session = untrack(() => live.get());
    if (session === null) return true;

    const value = untrack(() => draft.get());
    const editor = editorFor(session.columnId);
    const message = editor?.validate?.(value, session.item) ?? null;
    if (message !== null) {
      // The session stays open, holding what the reader typed. Closing it would
      // throw the value away in the one case where they most want it back.
      error.set(message);
      options.onInvalid?.(message, session);
      return false;
    }

    close();
    // An edit that changed nothing is not a change. Reporting it would put a
    // write through whatever `onCommit` is wired to — a request, an undo entry,
    // a dirty flag — for a reader who opened a cell and pressed Enter.
    if (!Object.is(value, session.initial)) {
      options.onCommit({
        item: session.item,
        rowKey: session.rowKey,
        rowIndex: session.row,
        columnId: session.columnId,
        previous: session.initial,
        value,
      });
    }
    return true;
  }

  const cancel = (): void => {
    const session = untrack(() => live.get());
    if (session === null) return;
    close();
    // Focus is in the editor, which is about to stop existing. Putting it back
    // on the cell is what keeps Escape from dropping a keyboard reader out of
    // the grid entirely.
    grid()?.focusCell({ row: session.row, column: session.column });
    options.onCancel?.(session);
  };

  /**
   * One cell along, running off the end of a row into the next one.
   *
   * Which is what a reader filling a table in means by Tab, and what makes the
   * last column reachable without a second gesture. Null at either end of the
   * collection, where there is no cell to move to and a row that does not
   * exist is not one to invent.
   */
  const step = (from: GridCell, delta: number, columns: number, rows: number): GridCell | null => {
    let row = from.row;
    let column = from.column + delta;
    if (column >= columns) {
      column = 0;
      row += 1;
    } else if (column < 0) {
      column = columns - 1;
      row -= 1;
    }
    if (row < 0 || row >= rows) return null;
    return { row, column };
  };

  /**
   * Commit, move to the next cell that can be edited, and open it.
   *
   * The columns with no editor are stepped over rather than landed on, because
   * a Tab that stopped on a read-only cell would need a second Tab to do
   * anything, and a grid whose first three columns are identifiers would need
   * four. Which columns those are is knowable without a row; whether a
   * particular *row* refuses the edit is not, unless the window happens to hold
   * it, so `editable` narrows the landing and never the search.
   *
   * The destination is opened only when the window already holds it. A Tab off
   * the last rendered row asks the grid to scroll, and the row it scrolls to is
   * not in the document yet — so the cursor moves and the reader presses Enter,
   * rather than an editor opening on a cell that may not be the one they were
   * sent to.
   */
  const commitAndMove = (rowDelta: number, columnDelta: number, reopen: boolean): boolean => {
    const session = untrack(() => live.get());
    if (session === null) return false;
    if (!commit()) return true;

    const table = grid();
    if (table === null) return true;

    const columns = untrack(() => table.columnCount());
    const rows = untrack(() => table.rowCount());
    // No rows left is not nowhere. A commit can filter away the last one, and
    // the cell focused below is then clamped to the header, which is the one
    // place a grid with no rows has for focus to be.
    if (columns === 0) return true;

    let target: GridCell | null = null;
    if (columnDelta === 0) {
      const row = session.row + rowDelta;
      target = row < 0 || row >= rows ? null : { row, column: session.column };
    } else {
      const ids = options.columns?.();
      let cursor: GridCell = session;
      // Bounded by the whole collection, so a grid with no editable column at
      // all stops rather than walking to the end of a million rows.
      for (let guard = 0; guard < columns * 2; guard++) {
        const next = step(cursor, columnDelta, columns, rows);
        if (next === null) break;
        cursor = next;
        if (ids === undefined || editorFor(ids[next.column]?.id ?? '') !== null) {
          target = next;
          break;
        }
      }
    }

    // Nowhere to go — the last row for Enter, the last editable cell for Tab —
    // is still somewhere to be. The editor that held focus has just closed,
    // and the key was taken from the browser, so focus goes back to the cell
    // just committed rather than falling to the document.
    if (target === null) {
      table.focusCell({ row: session.row, column: session.column });
      return true;
    }
    table.focusCell(target);
    if (reopen) beginAt(target);
    return true;
  };

  const isEditing = (row: number, column: number): boolean => {
    const session = live.get();
    return session !== null && session.row === row && session.column === column;
  };

  return {
    session: () => live.get(),
    isEditing,
    isEditable,
    begin: open,
    beginAt,

    draft: () => draft.get(),
    text: () => text.get(),
    setDraft: (value) => write(value, asText(value)),
    error: () => error.get(),

    commit,
    cancel,

    editorProps: () => {
      const message = error.get();
      return {
        [GRID_EDITOR_ATTRIBUTE]: '',
        'aria-invalid': message === null ? undefined : 'true',
        // Named rather than described, so the message is read as the reason the
        // value was refused and not as help text the reader could ignore.
        'aria-errormessage': message === null ? undefined : errorId,
        'data-invalid': message === null ? undefined : '',
      };
    },

    errorProps: () => ({
      id: errorId,
      // Announced when it appears. `aria-errormessage` alone is read only when
      // something moves focus back to the control, and focus is already there.
      role: 'alert',
    }),

    cellProps: (row, column) => {
      const editing = isEditing(row.index, column.index);
      return {
        // Only on the cells that cannot be edited: in a grid where editing is
        // the point, silence means editable, and `false` on every editable cell
        // is a screenful of noise for the few that are not.
        'aria-readonly': isEditable(row, column) ? undefined : 'true',
        'aria-invalid': editing && error.get() !== null ? 'true' : undefined,
        'data-editing': editing ? '' : undefined,
      };
    },

    onKeyDown: (event) => {
      const session = untrack(() => live.get());

      if (session === null) {
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
        if (event.key !== 'Enter' && event.key !== 'F2') return false;
        const table = grid();
        if (table === null) return false;
        const cursor = untrack(() => table.activeCell());
        // The column header is row one, and there is nothing on it to edit.
        if (cursor.row < 0 || !beginAt(cursor)) return false;
        event.preventDefault();
        return true;
      }

      const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
      if (plain && event.key === 'Escape') {
        cancel();
        event.preventDefault();
        return true;
      }
      if (plain && event.key === 'Enter') {
        // Down a row rather than along, because a column is what a reader is
        // usually filling in, and it is where every spreadsheet puts them.
        commitAndMove(event.shiftKey ? -1 : 1, 0, false);
        event.preventDefault();
        return true;
      }
      if (plain && event.key === 'Tab') {
        commitAndMove(0, event.shiftKey ? -1 : 1, true);
        // Without this the browser moves focus out of the grid: the editor is
        // the only thing in it holding a tab stop, and the cell it belongs to
        // has just stopped being edited.
        event.preventDefault();
        return true;
      }

      // Everything else belongs to the control the reader is typing into, and
      // is claimed rather than handled: an arrow inside an editor moves the
      // caret through the text, and a grid that also moved its cursor would
      // leave the reader editing one cell and standing on another. Nothing is
      // prevented, so the control still does what the key means to it.
      return true;
    },

    onInput: (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
      const session = untrack(() => live.get());
      if (session === null) return;
      const parse = editorFor(session.columnId)?.parse;
      write(parse === undefined ? target.value : parse(target.value), target.value);
    },
  };
}
