/**
 * Copy and paste against the system clipboard, where a paste is a list of
 * changes handed over rather than a write.
 *
 * Copy takes the cell range — or, with none, the cell under the cursor — and
 * puts it on the clipboard twice: as tab-separated text, which a spreadsheet
 * reads back into cells, and as an HTML table, which a document reads back into
 * a table. Either alone loses one of the two places a grid is pasted into.
 *
 * Paste goes the other way and stops short of the rows. What the clipboard
 * holds is laid over the grid from the cursor, run through the target column's
 * editor as a typed value is — `parse`, then `validate` — and handed over as
 * the same `GridEditChange` list `createCellEditing` commits, for the same
 * reason it gives: the rows belong to whoever passed them in, and a paste
 * usually has to reach a server before it is true.
 *
 *   class People {
 *     clipboard = createGridClipboard<Person>({
 *       grid: () => this.table,
 *       columns: () => COLUMNS,
 *       getRowKey: (person) => person.id,
 *       editing: () => this.editing,
 *       editors: () => EDITORS,
 *       onPaste: (changes) => this.store.writeAll(changes),
 *       onRefuse: (refusals) => this.refusals.set(refusals),
 *     });
 *
 *     onKey(event: KeyboardEvent): void {
 *       if (this.editing.onKeyDown(event) || this.clipboard.onKeyDown(event)) return;
 *       this.table.onKeyDown(event);
 *     }
 *   }
 *
 * **A paste is refused whole.** One cell that validation turns down, or that
 * cannot be edited, and nothing is handed to `onPaste`: every refusal is
 * reported instead, all of them, so the reader fixes the clipboard once rather
 * than once per complaint. A paste is one gesture, and half of one is a
 * rectangle with holes in it that the reader has to find cell by cell.
 *
 * **The keyboard goes through the asynchronous Clipboard API**, not the `copy`
 * and `paste` events. Those fire where the browser thinks there is something to
 * copy or somewhere to paste — a selection, an editable field — and a focused
 * grid cell is neither, so an engine is free to send them nowhere. The price
 * is the API's: it is absent outside a secure context, reading it can raise a
 * permission prompt, and either can refuse. All three are results here, never
 * exceptions, and each is said aloud, because a shortcut that silently does
 * nothing reads as a shortcut that worked.
 *
 * **A paste follows its cell across the wait.** Reading the clipboard can wait
 * on a prompt for as long as the reader takes to answer it, and the view can
 * be sorted or refreshed meanwhile. So the cell the paste was aimed at is held
 * by row key and column id, as an edit session is, and found again when the
 * clipboard answers; a paste whose cell has gone is reported, not laid over
 * whichever row slid into its place.
 *
 * **A cell still owns its own binding.** A copy reads each cell it copies, once
 * and without subscribing, and no other; a paste reads each cell it lands on,
 * for the value it would replace, and no other. Neither writes a signal the
 * cells render from, so nothing re-renders until the caller applies a change —
 * and then it is one text node per changed cell. Nothing here renders at all:
 * where a copy came from is the range the grid already marks, and there are no
 * props to spread.
 */

import { Signal } from '@voltdev/core';
import { announce, useProvidedLocale, type Locale, type MessageValues } from '@voltdev/primitives';
import { GRID_EDITOR_ATTRIBUTE, type GridCellEditing, type GridEditChange, type GridEditor } from './edit.js';
import { asText } from './filter.js';
import type { Grid, GridCell, GridColumn } from './grid.js';
import { rangeBounds, type GridCellRangeBounds, type GridRowKey } from './selection.js';

const { untrack } = Signal.subtle;

/**
 * The input types that take no typed text, and so hold nothing a shortcut
 * could mean to copy out of or paste into.
 */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * The elements a cell's text is broken around when a pasted table is read.
 *
 * A document's table puts each paragraph of a cell in a `<p>` and nothing
 * between them; reading those as one run would paste "FirstSecond".
 */
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  'address',
  'article',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tr',
  'ul',
]);

/** Elements whose text is never a cell's: markup that was never shown. */
const UNSHOWN_ELEMENTS: ReadonlySet<string> = new Set(['script', 'style', 'template', 'noscript']);

/**
 * The most rows and columns one pasted cell may span, as the HTML parser caps
 * `rowspan` and `colspan` — so a table from anywhere spans what the page it came
 * from showed, and no more.
 */
const MAX_ROW_SPAN = 65534;
const MAX_COLUMN_SPAN = 1000;

/** What a copy put on the clipboard. */
export interface GridCopied {
  readonly status: 'copied';
  /** The rectangle copied, by position in the view when it was copied. */
  readonly bounds: GridCellRangeBounds;
  /** The tab-separated text, as a spreadsheet reads it. */
  readonly text: string;
  /** The same cells as an HTML table, as a document reads them. */
  readonly html: string;
}

/**
 * Why the clipboard was not used, in words a caller can branch on.
 *
 * - `unavailable`: there is no Clipboard API — a page outside a secure
 *   context, where it is absent rather than failing, or no browser at all.
 * - `refused`: the browser or the reader said no — a denied permission, a
 *   document without focus. `error` is what the API rejected with.
 * - `empty`: a paste found nothing on the clipboard that reads as cells.
 * - `gone`: the cell a paste was aimed at left the view while the clipboard
 *   was being read.
 */
export type GridClipboardFailureReason = 'unavailable' | 'refused' | 'empty' | 'gone';

/** A copy or a paste that did not reach the clipboard or the grid. */
export interface GridClipboardFailure {
  readonly status: 'failed';
  readonly operation: 'copy' | 'paste';
  readonly reason: GridClipboardFailureReason;
  /** What the Clipboard API rejected with, for `refused`. */
  readonly error?: unknown;
}

/** How a copy ended. */
export type GridCopyResult = GridCopied | GridClipboardFailure;

/**
 * How much of a paste ran past the grid's last row or last column, and was
 * dropped rather than written.
 */
export interface GridPasteTruncation {
  /** Rows of the pasted block that fell below the last row. */
  readonly rows: number;
  /** Columns of the rows that landed that fell past the last column. */
  readonly columns: number;
  /** Every cell dropped, from both. */
  readonly cells: number;
}

/** A paste that every cell it covered accepted. */
export interface GridPasted<T> {
  readonly status: 'pasted';
  /**
   * The cells whose value the paste changes, as `createCellEditing` commits
   * them. A cell pasted with what it already held is not in it.
   */
  readonly changes: readonly GridEditChange<T>[];
  /** How many cells the paste covered, changed or not. */
  readonly cells: number;
  /** The rectangle it covered, by position in the view when it was read. */
  readonly bounds: GridCellRangeBounds;
  readonly truncated: GridPasteTruncation | null;
}

/** One cell that turned a paste down. */
export type GridPasteRefusal<T> = GridPasteRefusalCell<T> &
  (
    | {
        /** The column has no editor, or its `editable` refused this row. */
        readonly reason: 'read-only';
        readonly message: null;
      }
    | {
        /** The column's `validate` refused the value, with this message. */
        readonly reason: 'invalid';
        readonly message: string;
      }
  );

/** The cell a refusal is about, and what the paste would have put there. */
export interface GridPasteRefusalCell<T> {
  /** The caller's own row object. */
  readonly item: T;
  readonly rowKey: GridRowKey;
  /** Where the row was in the view when the paste was read. */
  readonly rowIndex: number;
  readonly columnId: string;
  readonly previous: unknown;
  /** What the paste would have written — parsed, where the column's editor parses. */
  readonly value: unknown;
  /** The text the clipboard held for this cell. */
  readonly text: string;
}

/** A paste that at least one cell turned down, so nothing was handed over. */
export interface GridPasteRefused<T> {
  readonly status: 'refused';
  /** Every cell that refused, not only the first. */
  readonly refusals: readonly GridPasteRefusal<T>[];
  readonly cells: number;
  readonly bounds: GridCellRangeBounds;
  readonly truncated: GridPasteTruncation | null;
}

/** How a paste ended. */
export type GridPasteResult<T> = GridPasted<T> | GridPasteRefused<T> | GridClipboardFailure;

/**
 * What the clipboard layer is laid over, and where what it does is reported.
 *
 * `columns`, `getRowKey` and `editors` are values the grid and the editing
 * layer are given too: the grid hands none of them to a layer above it, and a
 * copy has to read columns outside the window it renders.
 */
export interface GridClipboardOptions<T> {
  /**
   * The grid being copied from and pasted into.
   *
   * A function rather than the grid itself, because the two are usually fields
   * of the same component and the grid has to exist first.
   */
  grid: () => Grid<T> | null | undefined;
  /**
   * Every column the grid may show: the list it is given, or the whole list a
   * `createGridState` arranges and hides columns from.
   *
   * A copy reads cells the window does not hold, and a column outside the
   * window has no other way of being named. Each definition is placed where
   * the grid has its id, so the order here does not matter and a column the
   * grid is not showing is never copied or pasted into.
   */
  columns: () => readonly GridColumn<T>[];
  /**
   * The same function the grid is given, so a change names its row by the key
   * the grid knows it by. Defaults to the index, as the grid's does.
   */
  getRowKey?: (row: T, index: number) => GridRowKey;
  /**
   * The editing layer, where there is one. While it has a session open the
   * clipboard does nothing: the text field owns the clipboard then, and a
   * paste landing on the cell being edited would be overwritten by the draft.
   *
   * Only that: what each column takes is `editors`, which goes with it.
   */
  editing?: () => GridCellEditing<T> | null | undefined;
  /**
   * What each column can do when edited — the same record `createCellEditing`
   * is given. With it, a paste is parsed and validated as a typed value is,
   * and a column with no editor refuses one. Without it, every cell takes the
   * clipboard's text as it came.
   */
  editors?: () => Readonly<Record<string, GridEditor<T>>>;
  /**
   * Where a paste's changes go, and the only way a pasted value reaches a row.
   * Not called for a paste that changed nothing, nor for one that was refused.
   */
  onPaste: (changes: readonly GridEditChange<T>[], truncated: GridPasteTruncation | null) => void;
  /** Called when a paste was refused, with every cell that refused it. */
  onRefuse?: (refusals: readonly GridPasteRefusal<T>[]) => void;
  /** Called once a copy is on the clipboard. */
  onCopy?: (copied: GridCopied) => void;
  /** Called when a copy or a paste could not use the clipboard. */
  onError?: (failure: GridClipboardFailure) => void;
  /**
   * The sentence announced when a copy ends.
   *
   * A default is given because the failure of not having one is silence: a
   * copy changes nothing on screen, so without it a screen-reader user cannot
   * tell Ctrl+C that worked from Ctrl+C that did not. The locale's
   * `gridCellsCopied` — `{n}` the cells — and `copyFailed`, each falling back
   * to English. A failure is said assertively.
   */
  copyAnnouncement?: (result: GridCopyResult) => string;
  /**
   * The sentence announced when a paste ends.
   *
   * The locale's `gridCellsPasted` (`{n}` cells), `gridPasteTruncated` (`{n}`
   * of `{m}`), `gridPasteRefused` (`{n}` refusals), `gridNothingToPaste` and
   * `pasteFailed`, each falling back to English. A refusal or a failure is said
   * assertively.
   */
  pasteAnnouncement?: (result: GridPasteResult<T>) => string;
}

/** Copy and paste for one grid: the two gestures, and the keys that make them. */
export interface GridClipboard<T> {
  /**
   * Copy the cell range, or the cell under the cursor where there is none.
   *
   * Resolves to what happened, or to null where there was nothing to copy —
   * the cursor on the column header, or a grid with no rows. Call it from the
   * gesture that asked for it: the clipboard is written before anything is
   * awaited, which is what a browser that ties writing to a gesture requires.
   */
  copy(): Promise<GridCopyResult | null>;
  /**
   * Read the clipboard and lay it over the grid from the cursor — or from the
   * top-left corner of the cell range, where there is one.
   *
   * Resolves to what happened, or to null where there is nowhere to paste: the
   * cursor on the column header, a grid with no rows, or an editor open.
   */
  paste(): Promise<GridPasteResult<T> | null>;
  /**
   * Ctrl or Cmd with C, and with V. Returns true when it took the key.
   *
   * Wire it after the editing layer's `onKeyDown` and before the grid's. It
   * leaves every key alone while an editor is open, and every key that comes
   * from a field someone can type into.
   */
  onKeyDown(event: KeyboardEvent): boolean;
}

/** What the clipboard held, in the two formats a grid can read. */
interface ClipboardText {
  readonly text: string | null;
  readonly html: string | null;
}

/** The cell a paste is aimed at, held by what names it rather than where it is. */
interface PasteAim<T> {
  readonly item: T;
  readonly rowKey: GridRowKey;
  /** Where the row was when the paste was aimed — only to check the key finds it there. */
  readonly row: number;
  readonly columnId: string;
}

/**
 * Copy and paste against the system clipboard, over a grid that already
 * exists. A layer of its own rather than an option of `createGrid`, like
 * editing, because a grid that copies nothing should carry none of it.
 */
export function createGridClipboard<T>(options: GridClipboardOptions<T>): GridClipboard<T> {
  /**
   * Taken now, because a paste ends after an `await`, where no component's
   * scope is current and the nearest provider can no longer be found. Only a
   * provider is asked: the clipboard only wants its words, and has English of
   * its own.
   */
  const locale = useProvidedLocale();

  const copyAnnouncement =
    options.copyAnnouncement ?? ((result: GridCopyResult): string => describeCopy(locale, result));
  const pasteAnnouncement =
    options.pasteAnnouncement ??
    ((result: GridPasteResult<T>): string => describePaste(locale, result));

  if (__VOLT_DEV__ && options.editing !== undefined && options.editors === undefined) {
    warnEditingWithoutEditors();
  }

  const grid = (): Grid<T> | null => options.grid() ?? null;
  const rowKeyOf = (row: T, index: number): GridRowKey => options.getRowKey?.(row, index) ?? index;

  const editorOpen = (): boolean => untrack(() => options.editing?.()?.session() ?? null) !== null;

  /**
   * The grid's columns in the grid's order, as the definitions this layer was
   * given — with a gap wherever it was given none.
   *
   * Placed by the index the grid gives each id, as the export places them,
   * rather than read off `columns` by position: the grid is the authority on
   * which columns are showing and where. A grid behind `createGridState` shows
   * fewer columns than exist, in the reader's order, and a list read by
   * position would copy a hidden column's value out from under the cursor and
   * paste into a column nobody can see.
   */
  const columnsOf = (table: Grid<T>): readonly (GridColumn<T> | undefined)[] => {
    const placed = new Array<GridColumn<T> | undefined>(table.columnCount()).fill(undefined);
    for (const column of options.columns()) {
      const index = table.columnIndex(column.id);
      if (index >= 0 && placed[index] === undefined) placed[index] = column;
    }
    return placed;
  };

  /**
   * The range, cut to the grid as it is now, or null where there is none or
   * nothing of it is left.
   *
   * Cut rather than trusted, because `setCellRange` takes a range unchecked and
   * a column list can shrink under one — neither of which the grid clears. A
   * range cut to nothing is no range: the cursor is still somewhere, and a key
   * that did nothing because of cells nobody can see any more reads as broken.
   */
  const rangeNow = (table: Grid<T>): GridCellRangeBounds | null => {
    const range = table.cellRange();
    if (range === null) return null;
    const b = rangeBounds(range);
    const bounds = {
      fromRow: Math.max(b.fromRow, 0),
      toRow: Math.min(b.toRow, table.rowCount() - 1),
      fromColumn: Math.max(b.fromColumn, 0),
      toColumn: Math.min(b.toColumn, table.columnCount() - 1),
    };
    return bounds.fromRow > bounds.toRow || bounds.fromColumn > bounds.toColumn ? null : bounds;
  };

  /** The cursor, where it stands on a cell rather than on the header or past the edge. */
  const cursorNow = (table: Grid<T>): GridCell | null => {
    const cursor = table.activeCell();
    return inside(cursor, table.rowCount(), table.columnCount()) ? cursor : null;
  };

  /** The rectangle a copy takes: the range, or the cell under the cursor. */
  const copyBounds = (table: Grid<T>): GridCellRangeBounds | null => {
    const range = rangeNow(table);
    if (range !== null) return range;
    const cursor = cursorNow(table);
    if (cursor === null) return null;
    const { row, column } = cursor;
    return { fromRow: row, toRow: row, fromColumn: column, toColumn: column };
  };

  /**
   * Each copied cell as the text the reader sees in it — its column's `value`.
   *
   * A column the grid holds and `columns` does not define is an empty cell
   * rather than a missing one, so the rest of the row still lands under the
   * columns it came from.
   */
  const readBlock = (
    table: Grid<T>,
    bounds: GridCellRangeBounds,
    columns: readonly (GridColumn<T> | undefined)[],
  ): string[][] => {
    const block: string[][] = [];
    for (let row = bounds.fromRow; row <= bounds.toRow; row++) {
      const item = table.rowAt(row)!;
      const cells: string[] = [];
      for (let column = bounds.fromColumn; column <= bounds.toColumn; column++) {
        const definition = columns[column];
        cells.push(definition === undefined ? '' : asText(definition.value(item)));
      }
      block.push(cells);
    }
    return block;
  };

  /**
   * The cell a paste starts from, named by what finds it again — or null where
   * there is nowhere to paste.
   *
   * The top-left corner of the range rather than the cursor wherever there is
   * a range, because the cursor sits at whichever corner the range was dragged
   * to — and a paste that landed somewhere different depending on which way
   * the reader had selected would be a paste nobody could aim. A column
   * `columns` does not define has no id to be found again by, and is nowhere.
   */
  const aimAt = (
    table: Grid<T>,
    columns: readonly (GridColumn<T> | undefined)[],
  ): PasteAim<T> | null => {
    const range = rangeNow(table);
    const origin =
      range === null ? cursorNow(table) : { row: range.fromRow, column: range.fromColumn };
    if (origin === null) return null;
    const column = columns[origin.column];
    if (column === undefined) return null;
    const item = table.rowAt(origin.row)!;
    return { item, rowKey: rowKeyOf(item, origin.row), row: origin.row, columnId: column.id };
  };

  /**
   * Where the aimed-at cell is now, or null once it has gone.
   *
   * Found by key, then checked against what the key was meant to name. With a
   * `getRowKey`, that is the record: a row back under the same key in a new
   * object is the same one — a store that never mutates hands one back for
   * every change, a refetch for every row — and the paste lands on it, naming
   * the object the view holds now, because no change names the one it was
   * aimed at. Asking this layer's own `getRowKey` about it also catches a grid
   * keyed differently, whose key finds some other row. Without one the key is
   * a place, which a sort hands to whichever row it puts there, so the only
   * thing still naming the row is the object itself.
   */
  const find = (table: Grid<T>, aim: PasteAim<T>): GridCell | null => {
    const row = table.rowIndex(aim.rowKey);
    if (row < 0) return null;
    const item = table.rowAt(row)!;
    const same =
      options.getRowKey === undefined ? item === aim.item : rowKeyOf(item, row) === aim.rowKey;
    if (!same) return null;
    const column = table.columnIndex(aim.columnId);
    if (column < 0) return null;
    return { row, column };
  };

  /**
   * Lay a block over the grid from one cell, and decide every cell of it.
   *
   * A cell is decided as `createCellEditing` decides a commit: the value is the
   * editor's `parse` of the text, a value equal to what the cell holds is no
   * change, and `validate` refuses the rest or lets them through. What differs
   * is that nothing stops at the first refusal, because the reader should hear
   * about all of them at once.
   */
  const lay = (
    table: Grid<T>,
    block: readonly (readonly string[])[],
    origin: GridCell,
    columns: readonly (GridColumn<T> | undefined)[],
  ): GridPasted<T> | GridPasteRefused<T> => {
    const rowTotal = table.rowCount();
    const columnTotal = columns.length;
    const editors = options.editors?.();

    const changes: GridEditChange<T>[] = [];
    const refusals: GridPasteRefusal<T>[] = [];
    let cells = 0;
    let droppedRows = 0;
    let droppedCells = 0;
    // The widest row that landed, not the widest pasted: a long row that fell
    // below the last one covered nothing, and is counted among the rows cut.
    let width = 0;

    for (let dy = 0; dy < block.length; dy++) {
      const texts = block[dy]!;
      const row = origin.row + dy;
      // Rows past the last are counted and never read: a paste of ten thousand
      // lines onto the last row of a grid costs one row's worth of reading.
      if (row >= rowTotal) {
        droppedRows++;
        droppedCells += texts.length;
        continue;
      }
      width = Math.max(width, texts.length);
      const item = table.rowAt(row)!;
      const rowKey = rowKeyOf(item, row);

      for (let dx = 0; dx < texts.length; dx++) {
        const index = origin.column + dx;
        if (index >= columnTotal) {
          droppedCells += texts.length - dx;
          break;
        }
        cells++;
        const column = columns[index];
        // A column the grid holds and `columns` does not define has no id for
        // a change to name, and is left as it was.
        if (column === undefined) continue;
        // Undefined where there is no editing at all, and null where there is
        // and this column has no editor — which makes it read-only, exactly
        // as it is to a double click.
        const editor = editors === undefined ? undefined : (editors[column.id] ?? null);
        const verdict = judge({ item, rowKey, rowIndex: row, column }, editor, texts[dx]!);
        if (verdict === null) continue;
        if ('reason' in verdict) refusals.push(verdict);
        else changes.push(verdict);
      }
    }

    const bounds = {
      fromRow: origin.row,
      toRow: Math.min(origin.row + block.length, rowTotal) - 1,
      fromColumn: origin.column,
      toColumn: Math.min(origin.column + width, columnTotal) - 1,
    };
    const truncated =
      droppedCells === 0
        ? null
        : {
            rows: droppedRows,
            columns: Math.max(0, origin.column + width - columnTotal),
            cells: droppedCells,
          };

    return refusals.length > 0
      ? { status: 'refused', refusals, cells, bounds, truncated }
      : { status: 'pasted', changes, cells, bounds, truncated };
  };

  const endCopy = (result: GridCopyResult): GridCopyResult => {
    if (result.status === 'copied') options.onCopy?.(result);
    else options.onError?.(result);
    announce(copyAnnouncement(result), {
      priority: result.status === 'failed' ? 'assertive' : 'polite',
    });
    return result;
  };

  const endPaste = (result: GridPasteResult<T>): GridPasteResult<T> => {
    if (result.status === 'pasted') {
      if (result.changes.length > 0) options.onPaste(result.changes, result.truncated);
    } else if (result.status === 'refused') {
      options.onRefuse?.(result.refusals);
    } else {
      options.onError?.(result);
    }
    announce(pasteAnnouncement(result), {
      priority: result.status === 'pasted' ? 'polite' : 'assertive',
    });
    return result;
  };

  const copyNow = async (): Promise<GridCopyResult | null> => {
    const table = grid();
    if (table === null || editorOpen()) return null;
    const bounds = copyBounds(table);
    if (bounds === null) return null;
    const columns = columnsOf(table);
    if (__VOLT_DEV__) warnIfMissing(columns);
    const block = readBlock(table, bounds, columns);
    const text = toTabSeparated(block);
    const html = toHtmlTable(block);

    const clipboard = systemClipboard();
    if (clipboard === null || typeof ClipboardItem === 'undefined') {
      return endCopy({ status: 'failed', operation: 'copy', reason: 'unavailable' });
    }
    try {
      // Nothing is awaited before this call, and nothing may be: a browser
      // that ties clipboard writes to a gesture checks for one when the write
      // starts, and a write started after an `await` has left it behind.
      await clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
    } catch (error) {
      return endCopy({ status: 'failed', operation: 'copy', reason: 'refused', error });
    }
    return endCopy({ status: 'copied', bounds, text, html });
  };

  const pasteNow = async (): Promise<GridPasteResult<T> | null> => {
    const table = grid();
    if (table === null || editorOpen()) return null;
    const columns = columnsOf(table);
    if (__VOLT_DEV__) warnIfMissing(columns);
    const aim = aimAt(table, columns);
    if (aim === null) return null;
    if (__VOLT_DEV__ && table.rowIndex(aim.rowKey) !== aim.row) warnRowKey();

    const clipboard = systemClipboard();
    if (clipboard === null) {
      return endPaste({ status: 'failed', operation: 'paste', reason: 'unavailable' });
    }
    let data: ClipboardText;
    try {
      // Started before anything is awaited, for the reason a copy's write is.
      data = await readClipboard(clipboard);
    } catch (error) {
      return endPaste({ status: 'failed', operation: 'paste', reason: 'refused', error });
    }

    // Asked again, because the wait can be as long as a prompt stays open. An
    // editor opened meanwhile owns the clipboard as much as one open at the
    // key, and its draft would write the value it opened with back over
    // whatever landed on its cell. Nothing is said: the reader has gone on to
    // type, and an assertive failure would talk over the field they are in.
    if (editorOpen()) return null;

    const block = tabular(data);
    if (block === null) return endPaste({ status: 'failed', operation: 'paste', reason: 'empty' });

    // The grid again, and the cell again: both are what they are now, which is
    // not necessarily what they were when the reader pressed the key.
    const now = grid();
    const start = now === null ? null : find(now, aim);
    if (now === null || start === null) {
      return endPaste({ status: 'failed', operation: 'paste', reason: 'gone' });
    }
    return endPaste(lay(now, block, start, columnsOf(now)));
  };

  /**
   * Everything up to a copy's or a paste's first `await` runs inside whatever
   * called it, and that can be an effect — as can the failure announced
   * before the clipboard is ever reached. So each starts untracked: the caller
   * subscribes to nothing here, not the grid option, not a cell, and not the
   * locale a failure is said in. What runs after the `await` runs in a task of
   * its own, where nothing is tracking.
   */
  const copy = (): Promise<GridCopyResult | null> => untrack(copyNow);
  const paste = (): Promise<GridPasteResult<T> | null> => untrack(pasteNow);

  return {
    copy,
    paste,

    onKeyDown: (event) => {
      const action = shortcut(event);
      if (action === null) return false;
      // The text field owns the clipboard: an editor's, or any other a consumer
      // put in the grid — a filter box in a header cell is typed into, and its
      // Ctrl+C means the text selected in it.
      if (ownsClipboard(event.target) || editorOpen()) return false;
      const table = grid();
      if (table === null) return false;
      const target = untrack(() =>
        action === 'copy' ? copyBounds(table) !== null : aimAt(table, columnsOf(table)) !== null,
      );
      // Nothing to copy, or nowhere to paste — the column header, an empty
      // grid — leaves the key to the page.
      if (!target) return false;
      // Prevented, so the browser does not run its own copy or paste of
      // whatever else it thinks is selected on the page as well.
      event.preventDefault();
      void (action === 'copy' ? copy() : paste());
      return true;
    },
  };
}

// --- The system clipboard ----------------------------------------------------

/**
 * The Clipboard API, or null where the page has none.
 *
 * Absent rather than failing outside a secure context, so the check is for the
 * object and not for an exception it would never get to throw.
 */
function systemClipboard(): Clipboard | null {
  if (typeof navigator === 'undefined') return null;
  return navigator.clipboard ?? null;
}

/**
 * Both formats the clipboard offers, from the first item that has each.
 *
 * `read` is called before anything is awaited: it is what raises the
 * permission prompt, and a browser only raises one inside the gesture.
 */
async function readClipboard(clipboard: Clipboard): Promise<ClipboardText> {
  const items = await clipboard.read();
  let text: string | null = null;
  let html: string | null = null;
  for (const item of items) {
    if (text === null && item.types.includes('text/plain')) {
      text = await (await item.getType('text/plain')).text();
    }
    if (html === null && item.types.includes('text/html')) {
      html = await (await item.getType('text/html')).text();
    }
  }
  return { text, html };
}

// --- Keys ----------------------------------------------------------------------

/**
 * Which clipboard shortcut a key is, if either.
 *
 * A layout that types another script reports its own letter — Cyrillic "с" on
 * the key a Latin layout calls C — and Ctrl with that key is still copy there.
 * So the physical key decides where `key` is a letter of another script, and
 * only there. A Latin letter decides for itself, accented or not: a Dvorak "j"
 * sits where QWERTY has C, and a Neo "ä" too, and neither is copy. A key that
 * types no letter at all is no shortcut, as it is to the editing history.
 */
function shortcut(event: KeyboardEvent): ClipboardAction | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null;
  if (!LETTER.test(event.key)) return null;
  if (LATIN_LETTER.test(event.key)) return BY_LETTER.get(event.key.toLowerCase()) ?? null;
  return BY_KEY_CODE.get(event.code) ?? null;
}

const LETTER = /^\p{L}$/u;
const LATIN_LETTER = /^\p{Script=Latin}$/u;

type ClipboardAction = 'copy' | 'paste';

const BY_LETTER: ReadonlyMap<string, ClipboardAction> = new Map([
  ['c', 'copy'],
  ['v', 'paste'],
]);

const BY_KEY_CODE: ReadonlyMap<string, ClipboardAction> = new Map([
  ['KeyC', 'copy'],
  ['KeyV', 'paste'],
]);

/** Whether a key came from a field someone types into, which has a clipboard of its own. */
function ownsClipboard(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  // An editor that is not a native field — a custom element, a picker — says
  // what it is with the editing layer's own marker.
  return target.closest(`[${GRID_EDITOR_ATTRIBUTE}]`) !== null;
}

/** A pasted cell's place: its row, and the column it lands in. */
interface PasteTarget<T> {
  readonly item: T;
  readonly rowKey: GridRowKey;
  readonly rowIndex: number;
  readonly column: GridColumn<T>;
}

/**
 * One pasted cell, decided: a change, a refusal, or null for a cell the paste
 * leaves as it was.
 *
 * `editor` is undefined where there is no editing at all, and every cell takes
 * the text as it came; null where there is and the column has none, which
 * makes the cell read-only.
 */
function judge<T>(
  target: PasteTarget<T>,
  editor: GridEditor<T> | null | undefined,
  text: string,
): GridEditChange<T> | GridPasteRefusal<T> | null {
  const { item, rowKey, rowIndex, column } = target;
  const previous = (editor?.read ?? column.value)(item);
  const parse = editor?.parse;
  const value = parse === undefined ? text : parse(text);
  // With no parse the text is the value, and it changes nothing where it is
  // already what the cell reads as — which is also what lets a whole copied
  // row, read-only key and all, go back over the row it came from.
  if (parse === undefined ? asText(previous) === text : Object.is(value, previous)) return null;

  const cell = { item, rowKey, rowIndex, columnId: column.id, previous, value, text };
  if (editor === null || editor?.editable?.(item) === false) {
    return { ...cell, reason: 'read-only', message: null };
  }
  const message = editor?.validate?.(value, item) ?? null;
  if (message !== null) return { ...cell, reason: 'invalid', message };
  return { item, rowKey, rowIndex, columnId: column.id, previous, value };
}

function inside(cell: GridCell, rows: number, columns: number): boolean {
  return cell.row >= 0 && cell.row < rows && cell.column >= 0 && cell.column < columns;
}

// --- Writing -------------------------------------------------------------------

/**
 * Cells as tab-separated text, one line per row.
 *
 * A cell is quoted only where it has to be — a tab or a line break in it, or a
 * quote at its start, which a reader would otherwise take for the start of a
 * quoted cell — because every spreadsheet quotes the same way and reads an
 * unquoted cell as exactly what it says. No line break after the last row: a
 * single copied cell pasted into a text field should not bring one with it.
 */
function toTabSeparated(block: readonly (readonly string[])[]): string {
  return block.map((cells) => cells.map(quoteCell).join('\t')).join('\n');
}

function quoteCell(text: string): string {
  return /[\t\n\r]/.test(text) || text.startsWith('"') ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Cells as an HTML table, with a cell's line breaks kept as `<br>`. */
function toHtmlTable(block: readonly (readonly string[])[]): string {
  const rows = block.map((cells) => '<tr>' + cells.map(htmlCell).join('') + '</tr>');
  return '<table><tbody>' + rows.join('') + '</tbody></table>';
}

/**
 * A line break that stays in its cell.
 *
 * Excel reads a pasted table's bare `<br>` as the end of a row, and pushes
 * every cell below it down one: a copied block with one two-line cell in it
 * would arrive a row taller and misaligned. This is Office's own mark for a
 * break inside the cell, and to everything else it is a `<br>`.
 */
const CELL_BREAK = '<br style="mso-data-placement:same-cell">';

function htmlCell(text: string): string {
  return '<td>' + escapeHtml(text).replace(/\r\n|\r|\n/g, CELL_BREAK) + '</td>';
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// --- Reading -------------------------------------------------------------------

/**
 * What the clipboard holds as rows of cells, or null where nothing does.
 *
 * Both formats are read, and the text is preferred wherever the two agree on
 * how many rows and columns there are. A spreadsheet's text is exact — a cell
 * with a line break in it is quoted — while a table's HTML has had its
 * whitespace collapsed, as HTML always does. Where they disagree, it is the
 * text that lost the shape: a document or a web page writes a cell's line
 * break into its plain text unquoted, and the table is the only thing still
 * saying where the cells are.
 */
function tabular(data: ClipboardText): string[][] | null {
  const text = data.text === null ? null : parseTabSeparated(data.text);
  const table = data.html === null ? null : parseHtmlTable(data.html);
  const usable = (block: string[][] | null): block is string[][] =>
    block?.some((cells) => cells.length > 0) ?? false;
  if (usable(table) && !(usable(text) && sameShape(text, table))) return table;
  return usable(text) ? text : null;
}

function sameShape(a: readonly (readonly string[])[], b: readonly (readonly string[])[]): boolean {
  const width = (block: readonly (readonly string[])[]): number =>
    block.reduce((widest, cells) => Math.max(widest, cells.length), 0);
  return a.length === b.length && width(a) === width(b);
}

/**
 * Tab-separated text as rows of cells.
 *
 * A cell that starts with a quote runs to the matching one, doubled quotes
 * inside it standing for one, so a quoted cell may hold tabs and line breaks.
 * A quote that is never closed was never a quote, and is kept as text. One
 * line break at the very end closes the last row rather than opening another,
 * which is how a spreadsheet ends what it copies; empty text is no rows, while
 * a lone line break is one empty cell.
 */
function parseTabSeparated(text: string): string[][] {
  const rows: string[][] = [];
  if (text === '') return rows;
  let row: string[] = [];
  let at = 0;
  for (;;) {
    let cell = '';
    if (text[at] === '"') {
      const close = closingQuote(text, at + 1);
      if (close >= 0) {
        cell = text.slice(at + 1, close).replaceAll('""', '"');
        at = close + 1;
      }
    }
    let end = at;
    while (end < text.length && text[end] !== '\t' && text[end] !== '\n' && text[end] !== '\r') {
      end++;
    }
    cell += text.slice(at, end);
    at = end;
    row.push(cell);

    if (at >= text.length) break;
    if (text[at] === '\t') {
      at++;
      continue;
    }
    at += text[at] === '\r' && text[at + 1] === '\n' ? 2 : 1;
    rows.push(row);
    row = [];
    if (at >= text.length) return rows;
  }
  rows.push(row);
  return rows;
}

function closingQuote(text: string, from: number): number {
  for (let at = from; at < text.length; at++) {
    if (text[at] !== '"') continue;
    if (text[at + 1] !== '"') return at;
    at++;
  }
  return -1;
}

/**
 * The first table in some HTML, as rows of cells, or null where there is none.
 *
 * Parsed into a document of its own, never into the page: one made by
 * `DOMParser` runs no script and loads nothing, which is the only safe place
 * for markup from anywhere on the reader's clipboard. A cell that spans rows or
 * columns fills the rest of what it spans with empty cells, which is how a
 * spreadsheet copies a merged cell as text.
 */
function parseHtmlTable(html: string): string[][] | null {
  if (typeof DOMParser === 'undefined') return null;
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
  if (table === null) return null;

  // The table's own rows, and not the rows of a table nested in one of its
  // cells, which belong to that cell's text.
  const trs = table.querySelectorAll(
    ':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr',
  );
  const rows: string[][] = Array.from({ length: trs.length }, () => []);
  trs.forEach((tr, r) => {
    const row = rows[r]!;
    let column = 0;
    for (const cell of tr.children) {
      if (cell.localName !== 'td' && cell.localName !== 'th') continue;
      // Past whatever a cell above has already spanned down into.
      while (row[column] !== undefined) column++;
      // A `colspan` of zero is one, and a `rowspan` of zero runs to the end of
      // the table, which is what each attribute says zero means.
      const across = span(cell.getAttribute('colspan'), MAX_COLUMN_SPAN) || 1;
      const down = span(cell.getAttribute('rowspan'), MAX_ROW_SPAN) || trs.length - r;
      const text = cellText(cell);
      for (let dy = 0; dy < down && r + dy < trs.length; dy++) {
        const target = rows[r + dy]!;
        for (let dx = 0; dx < across; dx++) {
          target[column + dx] = dy === 0 && dx === 0 ? text : '';
        }
      }
      column += across;
    }
  });
  // A row a span skipped over has holes where no cell reached, and a hole is
  // an empty cell.
  return rows.map((row) => Array.from(row, (text) => text ?? ''));
}

/** A span attribute as HTML reads one: missing, unreadable or negative is one. */
function span(value: string | null, max: number): number {
  const parsed = value === null ? 1 : Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 0 ? 1 : Math.min(parsed, max);
}

/**
 * A cell's text as a reader saw it rendered.
 *
 * HTML's whitespace — spaces, tabs, line breaks, form feeds — collapses to one
 * space and not to nothing, a `<br>` is a line break, and a paragraph or other
 * block is broken around, however many of them meet. A non-breaking space is
 * not whitespace to HTML, and is kept: a French number is written with one.
 */
function cellText(cell: Element): string {
  let out = '';
  // A block boundary waiting to be written: several in a row are one break,
  // and one at the very start or end of the cell is none.
  let broken = false;
  const write = (text: string): void => {
    if (broken && out !== '') out += '\n';
    broken = false;
    out += text;
  };
  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child as Text).data.replace(/[ \t\n\r\f]+/g, ' ');
        if (text !== '') write(text);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const name = (child as Element).localName;
      if (UNSHOWN_ELEMENTS.has(name)) continue;
      if (name === 'br') {
        write('\n');
        continue;
      }
      const block = BLOCK_ELEMENTS.has(name);
      if (block) broken = true;
      walk(child);
      if (block) broken = true;
    }
  };
  walk(cell);
  // Every run of whitespace is one space by now, but two runs meet wherever
  // an element boundary fell between them — "a <b> b</b>" — and HTML shows
  // those as one too. A line's edges show none at all.
  return out.replace(/ {2,}/g, ' ').split('\n').map(trimSpaces).join('\n');
}

function trimSpaces(line: string): string {
  let start = 0;
  let end = line.length;
  while (start < end && line[start] === ' ') start++;
  while (end > start && line[end - 1] === ' ') end--;
  return line.slice(start, end);
}

// --- What it says ----------------------------------------------------------------

/**
 * A sentence said aloud: the locale's catalogue where it has the key, then
 * English — singular where the count is one.
 */
function said(
  locale: Locale | null,
  key: string,
  english: string,
  values?: MessageValues,
): string {
  return locale?.has(key) ? locale.t(key, values) : english;
}

function cellCount(n: number): string {
  return n === 1 ? '1 cell' : `${n} cells`;
}

function describeCopy(locale: Locale | null, result: GridCopyResult): string {
  if (result.status === 'failed') return said(locale, 'copyFailed', 'Could not copy');
  const b = result.bounds;
  const n = (b.toRow - b.fromRow + 1) * (b.toColumn - b.fromColumn + 1);
  return said(locale, 'gridCellsCopied', `Copied ${cellCount(n)}`, { n });
}

function describePaste<T>(locale: Locale | null, result: GridPasteResult<T>): string {
  switch (result.status) {
    case 'pasted': {
      const n = result.cells;
      if (result.truncated === null) {
        return said(locale, 'gridCellsPasted', `Pasted ${cellCount(n)}`, { n });
      }
      const m = n + result.truncated.cells;
      return said(
        locale,
        'gridPasteTruncated',
        `Pasted ${n} of ${m} cells; the rest ran past the edge of the grid`,
        { n, m },
      );
    }
    case 'refused': {
      const n = result.refusals.length;
      return said(locale, 'gridPasteRefused', `Nothing pasted: ${cellCount(n)} refused`, { n });
    }
    case 'failed':
      return result.reason === 'empty'
        ? said(locale, 'gridNothingToPaste', 'Nothing to paste')
        : said(locale, 'pasteFailed', 'Could not paste');
  }
}

/**
 * Says, in development, that the row keys this was given are not the grid's.
 *
 * The key a paste is aimed by is found again in the grid once the clipboard
 * answers, and a key the grid does not know finds nothing: every paste would
 * then end as `gone`, with no hint that the two were simply given different
 * `getRowKey` functions.
 */
function warnRowKey(): void {
  if (__VOLT_DEV__ && typeof console !== 'undefined') {
    console.warn(
      '[volt] createGridClipboard: the row under the cursor has a key the grid does not know it by, ' +
        'so the paste will not find it again. Give createGridClipboard the same getRowKey as createGrid.',
    );
  }
}

/**
 * Says, in development, that the grid holds columns this layer was given no
 * definition for. A copy writes each as an empty cell and a paste leaves each
 * alone, and nothing else would say why.
 */
function warnIfMissing<T>(columns: readonly (GridColumn<T> | undefined)[]): void {
  const missing = columns.filter((column) => column === undefined).length;
  if (missing > 0 && typeof console !== 'undefined') {
    console.warn(
      `[volt] createGridClipboard: the grid holds ${columns.length} columns and \`columns\` ` +
        `defines only ${columns.length - missing} of them, so ${missing} ` +
        `${missing === 1 ? 'is' : 'are'} copied empty and never pasted into. ` +
        'Pass the list the grid is given, or one holding every column it could be.',
    );
  }
}

/**
 * Says, in development, that the editing layer was given without its editors.
 *
 * `editing` only tells this layer when a cell is open; what a column may take
 * is in `editors`. Given the one without the other, a paste would write the
 * clipboard's text into every column — the ones editing treats as read-only
 * included — unparsed and unvalidated.
 */
function warnEditingWithoutEditors(): void {
  if (typeof console !== 'undefined') {
    console.warn(
      '[volt] createGridClipboard: given `editing` but no `editors`, so a paste takes the ' +
        "text as it came into every column — read-only ones included — without parsing or " +
        'validating it. Give createGridClipboard the same editors as createCellEditing.',
    );
  }
}
