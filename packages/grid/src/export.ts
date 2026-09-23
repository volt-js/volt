/**
 * Export, as a file of what the grid is showing.
 *
 * Not the caller's array: the view. The rows in the order the sort put them,
 * without the ones a filter took out, with a grouping's headers where the
 * reader sees them, under the columns the grid holds in the order it holds
 * them. A reader pressing Export is asking for the table in front of them; a
 * file of the source array would hand them rows they filtered away, in an
 * order they never asked for.
 *
 *   class People {
 *     exporter = createExport<Person>({
 *       grid: () => this.table,
 *       columns: () => COLUMNS,
 *       // The cells show "$1,000" and "3 Feb"; the file keeps what is under them.
 *       format: () => ({
 *         salary: (_, person) => person.salary,
 *         started: (_, person) => person.started,
 *       }),
 *     });
 *
 *     async download(): Promise<void> {
 *       const { blob, filename } = await this.exporter.xlsx();
 *       const link = document.createElement('a');
 *       link.href = URL.createObjectURL(blob);
 *       link.download = filename;
 *       link.click();
 *     }
 *   }
 *
 * **It hands back a file and saves nothing.** A download is an anchor in a
 * browser, a write to disk in a desktop shell, and a buffer to inspect in a
 * test, and a layer that picked one would be wrong in the other two. So the
 * result is a `Blob` and a suggested filename, and what happens to them is the
 * caller's business — the same line the rest of this package draws when it
 * hands back a view or a change rather than making one.
 *
 * **The rows are fixed when the export is asked for; the values are read as
 * it is written.** The view is taken in one synchronous pass — every row, in
 * order, read from the grid without reading a single cell — so a sort or a
 * filter the reader applies while a long export runs cannot duplicate a row or
 * drop one. The cells are read slice by slice after that, because reading them
 * is the work being spread out. A value written during an export is in the
 * file if its row had not been reached yet.
 *
 * **A long export is written in slices, and yields between them.** Each slice
 * reads a bounded number of cells — `cellsPerSlice`, as whole rows — then
 * hands the main thread back with `scheduler.yield()`, or a message-channel
 * task where the engine has no scheduler. A hundred thousand rows of ten
 * columns are two hundred short tasks rather than one long one, and the page
 * answers input between them. The workbook is compressed a slice at a time as
 * well, through the platform's `CompressionStream`. Each slice becomes a `Blob`
 * as it is written — a CSV's text, a workbook's compressed bytes — so no step
 * holds the whole sheet as one string, and finishing the file joins `Blob`s
 * rather than encoding or copying everything in them in one last long task.
 *
 * **Every cell is read once, untracked.** One accessor call per cell, and a
 * formatter call where one is given — nothing reads a value twice to find out
 * what type it is. Nothing is subscribed either: an export started inside an
 * effect does not make that effect depend on the grid's data.
 *
 * **CSV is RFC 4180, and safe to open.** Comma-separated, CRLF-terminated,
 * quoted only where a field holds a comma, a quote or a line break, quotes
 * doubled inside — and a record's only field quoted when it is empty, which
 * would otherwise be a blank line some readers skip. A file someone exported
 * will be opened in a spreadsheet by someone who did not write the data in it,
 * so text beginning with `=`, `+`, `-`, `@`, a tab or a carriage return — the
 * characters a spreadsheet reads as the start of a formula — is escaped as
 * OWASP describes: a leading apostrophe, inside quotes. Numbers are exempt:
 * their text is written here from a number, never from the data's own
 * characters, and cannot carry one. The escape is at the start of a field,
 * which is where a comma-separated reader starts a cell; a spreadsheet that
 * splits at `;` instead starts cells this file cannot see, and the workbook is
 * the format for it.
 *
 * **The workbook is a real one.** An Office Open XML package, zipped and
 * written here without a dependency: numbers as numbers, dates as dates,
 * booleans as booleans and text as shared strings, the header row bold, each
 * column as wide as the grid draws it, and — given `outlineLevel` — a grouped
 * grid's rows as outline levels a reader can fold. Text in a workbook is a
 * string cell and never a formula, so nothing there needs the CSV escape.
 */

import { Signal } from '@voltdev/core';
import type { Grid, GridColumn } from './grid.js';

const { untrack } = Signal.subtle;

/**
 * Cells read between one yield and the next when nothing else is said.
 *
 * Small enough that a slice of ordinary accessors is a few milliseconds on a
 * slow machine, and large enough that the yields themselves cost nothing that
 * shows.
 */
const DEFAULT_CELLS_PER_SLICE = 5_000;

// The grid's own defaults for a column that declares no width. `createGrid`
// does not export them, so they are repeated here. A test writes the same
// columns inside the grid's window and outside it, so a change made in only
// one place fails it.
const DEFAULT_COLUMN_WIDTH = 150;
const DEFAULT_MIN_COLUMN_WIDTH = 40;

// What a worksheet can hold. A file past any of these is not refused by the
// zip; it is refused by the spreadsheet, as a file it has to "repair".
const XLSX_MAX_ROWS = 1_048_576;
const XLSX_MAX_COLUMNS = 16_384;
const XLSX_MAX_TEXT = 32_767;
const XLSX_MAX_OUTLINE = 7;
const XLSX_MAX_SHEET_NAME = 31;

/**
 * The width, in px, of a digit in the workbook's default font.
 *
 * A worksheet measures a column in digits of its default font rather than in
 * pixels. The stylesheet below declares Calibri 11, whose digit is 7px wide at
 * 96 dpi, which is what makes a width converted by it come out as the pixels
 * the grid drew.
 */
const DIGIT_WIDTH = 7;

const CSV_TYPE = 'text/csv;charset=utf-8;header=present';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Indices into `cellXfs` in the stylesheet below.
const STYLE_HEADER = 1;
const STYLE_DATE = 2;
const STYLE_DATE_TIME = 3;

/**
 * Turns one column's value for a row into what the file should hold.
 *
 * Given the value the column's accessor returned and the row it came from.
 * What it returns is written by type — a number stays a number in a workbook,
 * a `Date` becomes a date — so returning the number and not "$1,000" is what
 * keeps a total summable. It is also where a grouped grid's header row gets
 * its label, which is in no column's value.
 */
export type GridExportFormatter<T> = (value: unknown, row: T) => unknown;

/** What to export, and how its cells are written. */
export interface GridExportOptions<T> {
  /**
   * The grid being exported.
   *
   * A function rather than the grid itself, because the two are usually fields
   * of the same component and the grid has to exist first.
   */
  grid: () => Grid<T> | null | undefined;
  /**
   * The columns, as definitions — the list the grid is given, or one holding
   * every column that list could ever hold.
   *
   * The grid renders a window of its columns and names the rest only by id,
   * so this is where the export finds each column's accessor and header. Which
   * of them are written, and in what order, is the grid's answer and not this
   * list's: a column the grid does not hold now is left out, and the rest are
   * written in the grid's order.
   */
  columns: () => readonly GridColumn<T>[];
  /**
   * What each column's cells become in the file, by column id. A column with
   * no entry writes its own value, as the grid displays it.
   */
  format?: () => Readonly<Record<string, GridExportFormatter<T>>>;
  /**
   * Where a row sits in a workbook's outline: 0 for none, up to 7.
   *
   * For a grouped grid, `(row) => row.depth`: a group header sits at its
   * group's depth and the rows under it one deeper, which is exactly the
   * outline a spreadsheet folds. A CSV has no outline, and ignores it.
   */
  outlineLevel?: (row: T) => number;
  /**
   * What the file is called, without its extension — and what the worksheet
   * in a workbook is called. Defaults to the grid's accessible name.
   */
  name?: () => string;
  /** How many cells are read between one yield and the next. Default 5000. */
  cellsPerSlice?: number;
}

/** One CSV export's own choices. */
export interface GridCsvOptions {
  /**
   * Begin the file with a UTF-8 byte order mark. Default false.
   *
   * RFC 4180 has none, and most readers do not want one. Excel does: without
   * it, a CSV opened by double-clicking is read in the system's legacy code
   * page, and every accented name in it comes out as two wrong characters.
   */
  bom?: boolean;
  /** Stops the export between two slices, rejecting with the signal's reason. */
  signal?: AbortSignal;
}

/** One workbook export's own choices. */
export interface GridXlsxOptions {
  /** Stops the export between two slices, rejecting with the signal's reason. */
  signal?: AbortSignal;
}

/** A finished export. Saving it is the caller's. */
export interface GridExportFile {
  readonly blob: Blob;
  /** The export's name, made safe to save under, with its extension. */
  readonly filename: string;
}

/**
 * An export of one grid's view, asked for as either format as often as needed.
 * Each call takes the view as it is at that moment.
 */
export interface GridExport {
  /** The view as RFC 4180 CSV, header row first. */
  csv(options?: GridCsvOptions): Promise<GridExportFile>;
  /** The view as an Excel workbook of one worksheet. */
  xlsx(options?: GridXlsxOptions): Promise<GridExportFile>;
}

/** A column resolved for one export: where it is, how wide, and how to read it. */
interface ExportColumn<T> {
  readonly id: string;
  readonly header: string;
  /** In px, as the grid draws it. */
  readonly width: number;
  readonly read: (row: T) => unknown;
  /** Whether this export has already said why a value of this column was not written. */
  warned: boolean;
}

/** The grid as it was when the export was asked for. */
interface View<T> {
  readonly name: string;
  readonly columns: readonly ExportColumn<T>[];
  readonly rows: readonly T[];
}

/**
 * Export a grid's view as CSV or as an Excel workbook.
 *
 * A layer over the grid rather than an option of it, as grouping and editing
 * are: it reads the grid's view and writes nothing to it, creates no effect,
 * and reads nothing at all until a file is asked for.
 */
export function createExport<T>(options: GridExportOptions<T>): GridExport {
  const cellsPerSlice = Math.max(1, Math.floor(options.cellsPerSlice ?? DEFAULT_CELLS_PER_SLICE));

  /** Whole rows, never fewer than one, so a slice cannot end halfway along a row. */
  const rowsPerSlice = (columns: number): number =>
    Math.max(1, Math.floor(cellsPerSlice / Math.max(1, columns)));

  /**
   * The columns to write, in the grid's order.
   *
   * The grid is the authority on which columns are showing and where, and it
   * answers by id. So the definitions are placed by the index the grid gives
   * each one, rather than written in the order they were handed over — which
   * is what lets a caller pass every column they have and still get only the
   * ones the reader can see.
   */
  const columnsOf = (table: Grid<T>): ExportColumn<T>[] => {
    const count = table.columnCount();
    const placed = new Array<GridColumn<T> | undefined>(count);
    for (const column of options.columns()) {
      const index = table.columnIndex(column.id);
      if (index >= 0 && placed[index] === undefined) placed[index] = column;
    }

    // The grid's widths reach outside it only through the columns it renders:
    // a column in the window is as wide as the reader left it, and one outside
    // it has not been drawn since it was last declared.
    const drawn = new Map<string, number>();
    for (const view of table.columns()) drawn.set(view.column.id, view.width);

    const formatters = options.format?.() ?? {};
    const resolved: ExportColumn<T>[] = [];
    let missing = 0;
    for (const column of placed) {
      if (column === undefined) {
        missing += 1;
        continue;
      }
      // Own entries only. A column id is the caller's text, and `constructor`,
      // `toString` or `valueOf` would otherwise find the member every object
      // inherits under that name, and write what it returns for the value.
      const format = Object.hasOwn(formatters, column.id) ? formatters[column.id] : undefined;
      resolved.push({
        id: column.id,
        header: column.header,
        width: drawn.get(column.id) ?? declaredWidth(column),
        // Called on the column, as the grid calls it, so an accessor written
        // as a method keeps its `this`.
        read:
          format === undefined
            ? (row) => column.value(row)
            : (row) => format(column.value(row), row),
        warned: false,
      });
    }
    if (missing > 0) warnMissingColumns(missing, count);
    return resolved;
  };

  /**
   * Every row of the view, in order, and the columns over it.
   *
   * One synchronous pass, untracked. It reads rows and never a cell: the view
   * is the caller's own array whenever nothing is sorted or filtered, and
   * `rowAt` hands its objects back as they are.
   */
  const view = (): View<T> =>
    untrack(() => {
      const table = options.grid();
      if (table === null || table === undefined) {
        throw new Error('[volt] createExport: `grid` returned no grid, so there is nothing to export.');
      }
      const columns = columnsOf(table);
      const count = table.rowCount();
      const rows = new Array<T>(count);
      for (let i = 0; i < count; i++) rows[i] = table.rowAt(i) as T;
      const label = table.gridProps()['aria-label'];
      const name = options.name?.() ?? (typeof label === 'string' ? label : '');
      return { name, columns, rows };
    });

  const csv = async (call: GridCsvOptions = {}): Promise<GridExportFile> => {
    call.signal?.throwIfAborted();
    const { name, columns, rows } = view();

    const bom = call.bom === true ? '\uFEFF' : '';
    // Each slice becomes a Blob as it is written, and the file is those Blobs
    // joined. Handed the slices' text instead, the file's own Blob would
    // encode all of it in the one task that makes it — for a large export,
    // the freeze the slices exist to avoid, moved to the end.
    const parts: Blob[] = [];
    // A CSV with no columns has no field to put in a record, and a file of
    // empty lines is not a table of nothing — it is nothing, said at length.
    if (columns.length === 0) {
      if (bom !== '') parts.push(new Blob([bom]));
    } else {
      parts.push(new Blob([bom + csvRecord(columns.map((column) => csvText(column.header)))]));
      await inSlices(rows.length, rowsPerSlice(columns.length), call.signal, (from, to) => {
        parts.push(new Blob([untrack(() => csvRows(rows, columns, from, to))]));
      });
    }
    return { blob: new Blob(parts, { type: CSV_TYPE }), filename: fileName(name, 'csv') };
  };

  const xlsx = async (call: GridXlsxOptions = {}): Promise<GridExportFile> => {
    call.signal?.throwIfAborted();
    const { name, columns, rows } = view();

    // Refused before a byte is written. A sheet past these limits is a file
    // the spreadsheet opens only by throwing rows away, and a reader told
    // afterwards that part of their export is missing has been told too late.
    if (rows.length + 1 > XLSX_MAX_ROWS) {
      throw new RangeError(
        `[volt] createExport: ${rows.length} rows and a header row are more than the ` +
          `${XLSX_MAX_ROWS} rows a worksheet holds. Filter the grid first, or export CSV.`,
      );
    }
    if (columns.length > XLSX_MAX_COLUMNS) {
      throw new RangeError(
        `[volt] createExport: ${columns.length} columns are more than the ` +
          `${XLSX_MAX_COLUMNS} a worksheet holds.`,
      );
    }

    // Taken with the rows, because the sheet has to say how deep its outline
    // goes before the first row is written — and because a row's level is part
    // of the arrangement being fixed, not a value being read.
    const outline = options.outlineLevel;
    const levels = outline === undefined ? null : new Uint8Array(rows.length);
    let deepest = 0;
    if (outline !== undefined && levels !== null) {
      untrack(() => {
        for (let i = 0; i < rows.length; i++) {
          const level = clampLevel(outline(rows[i] as T));
          levels[i] = level;
          if (level > deepest) deepest = level;
        }
      });
    }

    const strings = createSharedStrings();
    const zip = createZip();
    await zip.file('[Content_Types].xml', CONTENT_TYPES);
    await zip.file('_rels/.rels', PACKAGE_RELATIONSHIPS);
    await zip.file('xl/workbook.xml', workbookXml(sheetName(name)));
    await zip.file('xl/_rels/workbook.xml.rels', WORKBOOK_RELATIONSHIPS);
    await zip.file('xl/styles.xml', STYLES);

    const sheet = zip.entry('xl/worksheets/sheet1.xml');
    await sheet.write(sheetHead(columns, rows.length, deepest));
    if (columns.length > 0) {
      const refs = columns.map((_, index) => columnName(index));
      await sheet.write(headerRow(columns, refs, strings));
      await inSlices(rows.length, rowsPerSlice(columns.length), call.signal, (from, to) =>
        sheet.write(untrack(() => sheetRows(rows, levels, columns, refs, strings, from, to))),
      );
    }
    await sheet.write('</sheetData></worksheet>');
    await sheet.close();

    // Written after the sheet, because the sheet is what fills it.
    const shared = zip.entry('xl/sharedStrings.xml');
    await shared.write(
      `${XML_DECLARATION}<sst xmlns="${MAIN_NAMESPACE}" count="${strings.count()}" ` +
        `uniqueCount="${strings.list.length}">`,
    );
    await inSlices(strings.list.length, cellsPerSlice, call.signal, (from, to) =>
      shared.write(sharedStringItems(strings.list, from, to)),
    );
    await shared.write('</sst>');
    await shared.close();

    return { blob: zip.blob(XLSX_TYPE), filename: fileName(name, 'xlsx') };
  };

  return { csv, xlsx };
}

// --- Slicing -----------------------------------------------------------------

/**
 * Run `write` over `[0, total)` in slices of `size`, yielding between them.
 *
 * Not before the first, so an export small enough to be one slice never
 * yields. The signal is checked after each yield, which is the only moment
 * anything else could have aborted it.
 */
async function inSlices(
  total: number,
  size: number,
  signal: AbortSignal | undefined,
  write: (from: number, to: number) => void | Promise<void>,
): Promise<void> {
  for (let from = 0; from < total; from += size) {
    if (from > 0) {
      await yieldToPage();
      signal?.throwIfAborted();
    }
    await write(from, Math.min(total, from + size));
  }
}

interface YieldingScheduler {
  yield(): Promise<void>;
}

/**
 * Hand the main thread back, and resume as soon as the page has had it.
 *
 * `scheduler.yield()` where the engine has it, because its continuation goes
 * ahead of other queued tasks: the export keeps its place instead of waiting
 * behind every timer on the page. A message-channel task where it has not —
 * not `setTimeout`, which browsers clamp to 4ms once calls nest, and an export
 * of two hundred slices is two hundred nested calls.
 */
function yieldToPage(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Partial<YieldingScheduler> }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

// --- Values --------------------------------------------------------------------

/**
 * A column's width as the grid would lay it out without having drawn it.
 *
 * The grid's own clamp, repeated: the declared width or the default, held to
 * the column's bounds and rounded.
 */
function declaredWidth<T>(column: GridColumn<T>): number {
  const low = column.minWidth ?? DEFAULT_MIN_COLUMN_WIDTH;
  const high = Math.max(low, column.maxWidth ?? Number.POSITIVE_INFINITY);
  const width = column.width ?? DEFAULT_COLUMN_WIDTH;
  return Math.round(Math.min(Math.max(width, low), high));
}

/**
 * The text of a value that is not a string, number, boolean or date — as the
 * grid displays it, and never `String(value)`.
 *
 * A template's text binding shows an object as its JSON, so that is what the
 * reader saw and what the file says. `String` would write `[object Object]`,
 * which is not a value anyone saw. What JSON cannot write — a cycle, a bigint
 * inside an object, a function — is left empty, and a development build says
 * which column needs a formatter.
 */
function displayText<T>(value: unknown, column: ExportColumn<T>): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    text = undefined;
  }
  if (text === undefined) {
    warnOnce(column, 'holds a value that cannot be written as text');
    return '';
  }
  return text;
}

/**
 * A date as the reader's wall clock reads it: `2024-01-05`, or
 * `2024-01-05 14:30:00` where it has a time of day.
 *
 * The local time, because a worksheet's dates have no zone and are written in
 * the reader's own, and a CSV of the same export ought to say the same thing.
 * A space rather than ISO 8601's `T`, because spreadsheets read the space form
 * back as a date and not all of them read the `T` one. Empty for an invalid
 * date, which is no date at all.
 */
function dateText(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  let yyyy = pad(year, 4);
  // ISO 8601's expanded form for a year four digits cannot hold.
  if (year < 0) yyyy = `-${pad(-year, 6)}`;
  else if (year > 9999) yyyy = `+${pad(year, 6)}`;
  const day = `${yyyy}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
  if (isMidnight(date)) return day;
  const clock = `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}`;
  const ms = date.getMilliseconds();
  return ms === 0 ? `${day} ${clock}` : `${day} ${clock}.${pad(ms, 3)}`;
}

function isMidnight(date: Date): boolean {
  return (
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0
  );
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

// --- CSV -----------------------------------------------------------------------

/**
 * The characters a spreadsheet reads as the start of a formula: OWASP's list.
 *
 * A formula in an exported file runs on the machine of whoever opens it, with
 * their permissions — `=HYPERLINK` to send the sheet's contents somewhere, or
 * `=cmd|...` in a spreadsheet that still honours DDE.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * A text field, quoted only where RFC 4180 needs it and escaped where a
 * spreadsheet would run it.
 *
 * The escape is OWASP's: an apostrophe in front, which a spreadsheet reads as
 * "this is text", and the whole field in quotes with its own quotes doubled,
 * so that a quote or a comma inside it cannot close the field and begin a new
 * cell that starts with the formula after all.
 */
function csvText(text: string): string {
  if (FORMULA_START.test(text)) return `"'${text.replaceAll('"', '""')}"`;
  if (NEEDS_QUOTES.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function csvField<T>(column: ExportColumn<T>, row: T): string {
  const value = column.read(row);
  if (value === null || value === undefined) return '';
  switch (typeof value) {
    case 'string':
      return csvText(value);
    case 'number':
      // Blank, as NaN is everywhere else in this package: it is ordered
      // against nothing and totals to nothing, and "NaN" is not a value
      // anyone reading a spreadsheet can use. An infinity is text a
      // spreadsheet cannot hold as a number, and goes through the text path.
      if (Number.isNaN(value)) return '';
      return Number.isFinite(value) ? String(value) : csvText(String(value));
    case 'bigint':
      return String(value);
    case 'boolean':
      return value ? 'true' : 'false';
  }
  if (value instanceof Date) return csvText(dateText(value));
  return csvText(displayText(value, column));
}

/**
 * A record from its fields, ended.
 *
 * A record of one empty field is written `""` rather than as nothing. RFC 4180
 * reads a blank line as that record, but the readers that skip blank lines —
 * pandas by default among them — read no record at all, and every row under
 * it would be read one row higher than it is.
 */
function csvRecord(fields: readonly string[]): string {
  return fields.length === 1 && fields[0] === '' ? '""\r\n' : `${fields.join(',')}\r\n`;
}

function csvRows<T>(
  rows: readonly T[],
  columns: readonly ExportColumn<T>[],
  from: number,
  to: number,
): string {
  let out = '';
  const fields = new Array<string>(columns.length);
  for (let r = from; r < to; r++) {
    const row = rows[r] as T;
    for (let c = 0; c < columns.length; c++) fields[c] = csvField(columns[c]!, row);
    out += csvRecord(fields);
  }
  return out;
}

// --- The workbook ----------------------------------------------------------------

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NAMESPACE = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIP_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIP_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships';

const CONTENT_TYPES =
  XML_DECLARATION +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
  '</Types>';

const PACKAGE_RELATIONSHIPS =
  XML_DECLARATION +
  `<Relationships xmlns="${PACKAGE_RELATIONSHIP_NAMESPACE}">` +
  `<Relationship Id="rId1" Type="${RELATIONSHIP_NAMESPACE}/officeDocument" Target="xl/workbook.xml"/>` +
  '</Relationships>';

const WORKBOOK_RELATIONSHIPS =
  XML_DECLARATION +
  `<Relationships xmlns="${PACKAGE_RELATIONSHIP_NAMESPACE}">` +
  `<Relationship Id="rId1" Type="${RELATIONSHIP_NAMESPACE}/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="${RELATIONSHIP_NAMESPACE}/styles" Target="styles.xml"/>` +
  `<Relationship Id="rId3" Type="${RELATIONSHIP_NAMESPACE}/sharedStrings" Target="sharedStrings.xml"/>` +
  '</Relationships>';

/**
 * Four cell formats: plain, the bold header, a date, and a date with a time.
 *
 * The date formats are the built-in 14 and 22 rather than a pattern written
 * here, because a spreadsheet shows those two in the reader's own locale's
 * order — a German reader gets `05.01.2024`, not an American's `1/5/2024`.
 */
const STYLES =
  XML_DECLARATION +
  `<styleSheet xmlns="${MAIN_NAMESPACE}">` +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '</fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function workbookXml(sheet: string): string {
  return (
    XML_DECLARATION +
    `<workbook xmlns="${MAIN_NAMESPACE}" xmlns:r="${RELATIONSHIP_NAMESPACE}">` +
    `<sheets><sheet name="${xmlText(sheet)}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>'
  );
}

/**
 * Everything in the worksheet before its first row.
 *
 * The outline is declared up front — how deep it goes, and that a group's
 * summary sits *above* its rows — because the fold buttons a spreadsheet draws
 * are placed from it, and a grid's group header is above the rows it heads.
 */
function sheetHead<T>(columns: readonly ExportColumn<T>[], rows: number, deepest: number): string {
  let xml = `${XML_DECLARATION}<worksheet xmlns="${MAIN_NAMESPACE}">`;
  if (deepest > 0) xml += '<sheetPr><outlinePr summaryBelow="0"/></sheetPr>';
  const last = columns.length === 0 ? '' : `:${columnName(columns.length - 1)}${rows + 1}`;
  xml += `<dimension ref="A1${last}"/>`;
  xml += `<sheetFormatPr defaultRowHeight="15"${deepest > 0 ? ` outlineLevelRow="${deepest}"` : ''}/>`;
  if (columns.length > 0) {
    xml += '<cols>';
    for (let i = 0; i < columns.length; i++) {
      xml += `<col min="${i + 1}" max="${i + 1}" width="${columnWidth(columns[i]!.width)}" customWidth="1"/>`;
    }
    xml += '</cols>';
  }
  return xml + '<sheetData>';
}

function headerRow<T>(
  columns: readonly ExportColumn<T>[],
  refs: readonly string[],
  strings: SharedStrings,
): string {
  let xml = '<row r="1">';
  for (let c = 0; c < columns.length; c++) {
    xml += textCell(`${refs[c]}1`, columns[c]!.header, columns[c]!, strings, STYLE_HEADER);
  }
  return xml + '</row>';
}

function sheetRows<T>(
  rows: readonly T[],
  levels: Uint8Array | null,
  columns: readonly ExportColumn<T>[],
  refs: readonly string[],
  strings: SharedStrings,
  from: number,
  to: number,
): string {
  let xml = '';
  for (let r = from; r < to; r++) {
    const row = rows[r] as T;
    // One for the header, one because a worksheet counts from one.
    const number = r + 2;
    const level = levels === null ? 0 : levels[r]!;
    xml += level > 0 ? `<row r="${number}" outlineLevel="${level}">` : `<row r="${number}">`;
    for (let c = 0; c < columns.length; c++) {
      xml += cell(`${refs[c]}${number}`, columns[c]!, row, strings);
    }
    xml += '</row>';
  }
  return xml;
}

/** One cell, typed by what its value is. Nothing at all for a value that is absent. */
function cell<T>(ref: string, column: ExportColumn<T>, row: T, strings: SharedStrings): string {
  const value = column.read(row);
  if (value === null || value === undefined) return '';
  switch (typeof value) {
    case 'string':
      return textCell(ref, value, column, strings);
    case 'number':
      if (Number.isNaN(value)) return '';
      return Number.isFinite(value)
        ? `<c r="${ref}"><v>${value}</v></c>`
        : textCell(ref, String(value), column, strings);
    case 'bigint':
      // A number where a worksheet's double holds it exactly, and its digits
      // as text where it would not: a bigint is chosen because every digit
      // matters, and a cell that rounded the last few would be wrong silently.
      return Number.isSafeInteger(Number(value))
        ? `<c r="${ref}"><v>${value}</v></c>`
        : textCell(ref, String(value), column, strings);
    case 'boolean':
      return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const serial = excelSerial(value);
    // A date a worksheet cannot hold as one is still worth its text.
    if (serial === null) return textCell(ref, dateText(value), column, strings);
    const style = isMidnight(value) ? STYLE_DATE : STYLE_DATE_TIME;
    return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`;
  }
  return textCell(ref, displayText(value, column), column, strings);
}

function textCell<T>(
  ref: string,
  text: string,
  column: ExportColumn<T>,
  strings: SharedStrings,
  style?: number,
): string {
  // An empty string and no value are the same blank to the reader, and a
  // shared string of nothing is bytes for nothing.
  if (text === '' && style === undefined) return '';
  let written = text;
  if (written.length > XLSX_MAX_TEXT) {
    // Cut short rather than written whole, because a cell past the limit is a
    // file the spreadsheet will only open by "repairing" it — and cut on a
    // character, never between the halves of one.
    const cut = isHighSurrogate(written.charCodeAt(XLSX_MAX_TEXT - 1))
      ? XLSX_MAX_TEXT - 1
      : XLSX_MAX_TEXT;
    written = written.slice(0, cut);
    warnOnce(column, `holds text longer than the ${XLSX_MAX_TEXT} characters a cell can, and was cut short`);
  }
  const s = style === undefined ? '' : ` s="${style}"`;
  return `<c r="${ref}"${s} t="s"><v>${strings.add(written)}</v></c>`;
}

/**
 * A date as a worksheet stores it: days since 1899-12-30 in the reader's wall
 * clock, or null for a date a worksheet cannot hold — before 1900 or after
 * 9999.
 *
 * Read from the local fields rather than the timestamp, because a worksheet's
 * dates have no zone: 9am in the grid has to be 9am in the cell. Dates before
 * 1 March 1900 are one lower than the arithmetic says, since a worksheet's
 * serials count a 29 February 1900 that never was — a bug kept for
 * compatibility with Lotus 1-2-3, which every spreadsheet has kept since.
 */
function excelSerial(date: Date): number | null {
  const year = date.getFullYear();
  if (year < 1900 || year > 9999) return null;
  const wall = Date.UTC(
    year,
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
  const serial = (wall - EXCEL_EPOCH) / 86_400_000;
  return serial < 61 ? serial - 1 : serial;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** The digits-of-the-default-font width a worksheet wants, from the px the grid drew. */
function columnWidth(px: number): number {
  return Math.floor((px / DIGIT_WIDTH) * 256) / 256;
}

/** `A` for the first column, `Z` for the 26th, then `AA`, up to `XFD`. */
function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/**
 * A row's outline level as a worksheet can hold it: a whole number from 0 to 7.
 *
 * Anything deeper is seven, an infinity included: a row nested further than a
 * worksheet can show is still nested, and folds with the deepest. Only what is
 * no number at all is no level.
 */
function clampLevel(level: number): number {
  if (Number.isNaN(level)) return 0;
  return Math.min(XLSX_MAX_OUTLINE, Math.max(0, Math.trunc(level)));
}

/** Every distinct text in the sheet, each written once and referred to by index. */
interface SharedStrings {
  readonly list: string[];
  /** Where this text is in the list, adding it if it is new. */
  add(text: string): number;
  /** How many cells refer to the list, repeats included. */
  count(): number;
}

function createSharedStrings(): SharedStrings {
  const list: string[] = [];
  const index = new Map<string, number>();
  let references = 0;
  return {
    list,
    add(text) {
      references += 1;
      let at = index.get(text);
      if (at === undefined) {
        at = list.length;
        index.set(text, at);
        list.push(text);
      }
      return at;
    },
    count: () => references,
  };
}

function sharedStringItems(list: readonly string[], from: number, to: number): string {
  let xml = '';
  for (let i = from; i < to; i++) {
    const text = list[i]!;
    // Without it, a reader of the XML may drop the spaces at either end — and
    // a code padded to width, or an indented label, loses what it is.
    const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
    xml += `<si><t${space}>${xmlText(text)}</t></si>`;
  }
  return xml;
}

/**
 * Text made safe for an element or an attribute of a workbook part.
 *
 * The five XML escapes, and the workbook format's own for what XML cannot
 * carry at all: a control character is written `_xHHHH_`, as a spreadsheet
 * writes one — a carriage return included, since XML would otherwise fold it
 * into the newline beside it. A literal `_xHHHH_` in the text has its
 * underscore written that way too, or the reader would decode it into a
 * character nobody typed.
 */
function xmlText(text: string): string {
  return text.replace(XML_ESCAPES, (match) => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return `_x${match.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`;
    }
  });
}

// Tab and newline are the two control characters XML carries as they are.
const XML_ESCAPES = /[&<>"\u0000-\u0008\u000b-\u001f\ufffe\uffff]|_(?=x[0-9a-fA-F]{4}_)/g;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

// --- Names ---------------------------------------------------------------------

/**
 * A name made safe to save a file under, with its extension.
 *
 * What Windows refuses anywhere in a name is taken out, as are the spaces and
 * dots it silently drops from the ends, so the name a reader is offered is the
 * name they get.
 */
function fileName(name: string, extension: string): string {
  const base = trimEnds(
    name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' '),
    FILE_NAME_EDGE,
  );
  return `${base === '' ? 'export' : base}.${extension}`;
}

/**
 * A name a worksheet will take: none of `\ / ? * [ ] :`, no apostrophe at
 * either end, 31 characters at most, and not "History", which a spreadsheet
 * keeps for itself. A name it would refuse becomes `Sheet1`.
 */
function sheetName(name: string): string {
  let text = trimEnds(
    name.replace(/[\\/?*[\]:\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' '),
    SHEET_NAME_EDGE,
  );
  if (text.length > XLSX_MAX_SHEET_NAME) {
    const cut = isHighSurrogate(text.charCodeAt(XLSX_MAX_SHEET_NAME - 1))
      ? XLSX_MAX_SHEET_NAME - 1
      : XLSX_MAX_SHEET_NAME;
    text = trimEnds(text.slice(0, cut), SHEET_NAME_EDGE);
  }
  return text === '' || text.toLowerCase() === 'history' ? 'Sheet1' : text;
}

/** What a file name loses from its ends: spaces, and the dots Windows drops. */
const FILE_NAME_EDGE = /[\s.]/;
/** What a sheet name loses from its ends: spaces, and the apostrophes it may not have. */
const SHEET_NAME_EDGE = /[\s']/;

/**
 * Text without the characters `edge` matches at either end.
 *
 * A walk rather than `replace(/^x+|x+$/)`, whose second half is quadratic on a
 * long run of `x` with something else after it.
 */
function trimEnds(text: string, edge: RegExp): string {
  let start = 0;
  let end = text.length;
  while (start < end && edge.test(text[start]!)) start += 1;
  while (end > start && edge.test(text[end - 1]!)) end -= 1;
  return text.slice(start, end);
}

// --- The zip ---------------------------------------------------------------------

/** One file of the archive, written a piece at a time. */
interface ZipEntry {
  write(text: string): Promise<void>;
  /** Finishes the file. Entries are written one after another, never interleaved. */
  close(): Promise<void>;
}

interface Zip {
  entry(name: string): ZipEntry;
  file(name: string, text: string): Promise<void>;
  blob(type: string): Blob;
}

// 1 January 1980, the earliest time a zip can say, as MS-DOS packs it. Fixed
// rather than now, so the same view exports to the same bytes.
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const DEFLATE = 8;
const ZIP_VERSION = 20;
/**
 * The most a zip header's four bytes can say a part holds. Past it a size
 * written there wraps round to a small one, and the archive lies about the
 * part: a corrupt file, where Zip64 — not written here — would be needed.
 */
const ZIP_MAX_SIZE = 0xffff_ffff;

/**
 * A zip archive, deflated, assembled as the parts of a `Blob`.
 *
 * Each file is streamed through `CompressionStream` as it is written, and only
 * its compressed bytes are kept; the local header goes in front of them once
 * the file is finished and its size and checksum are known.
 *
 * Each compressed chunk goes into a `Blob` as it is drained, so the archive's
 * own `Blob` is made of `Blob`s and a few headers. Handed the bytes
 * themselves, it would copy every one of them in the one task that makes it.
 */
function createZip(): Zip {
  const encoder = new TextEncoder();
  const parts: (Blob | Uint8Array<ArrayBuffer>)[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  let entries = 0;

  const entry = (name: string): ZipEntry => {
    const stream = new CompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    const compressed: Blob[] = [];
    let compressedSize = 0;
    // Read while the file is written, not after: the stream holds nothing
    // back, so a write waits until what it produced has been taken.
    const drained = (async () => {
      const reader = stream.readable.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        compressed.push(new Blob([value]));
        compressedSize += value.byteLength;
      }
    })();
    let crc = 0;
    let size = 0;

    return {
      async write(text) {
        const bytes = encoder.encode(text);
        // Refused before the bytes go in, however late: a file that says it
        // is a workbook and is not one is worse than no file.
        if (size + bytes.byteLength > ZIP_MAX_SIZE) {
          throw new RangeError(
            `[volt] createExport: ${name} is more than the 4 GiB a zip without Zip64 records, ` +
              'which this does not write. Filter the grid first, or export CSV.',
          );
        }
        crc = crc32(crc, bytes);
        size += bytes.byteLength;
        await writer.write(bytes);
      },
      async close() {
        await writer.close();
        await drained;
        const path = encoder.encode(name);
        const record = { path, crc, compressedSize, size, offset };
        const local = localHeader(record);
        parts.push(local);
        // One at a time: a sheet can be thousands of chunks, more than a
        // spread into `push` may pass as arguments.
        for (const blob of compressed) parts.push(blob);
        directory.push(centralHeader(record));
        offset += local.byteLength + compressedSize;
        entries += 1;
      },
    };
  };

  return {
    entry,
    async file(name, text) {
      const file = entry(name);
      await file.write(text);
      await file.close();
    },
    blob(type) {
      let directorySize = 0;
      for (const header of directory) directorySize += header.byteLength;
      const end = new Uint8Array(22);
      const view = new DataView(end.buffer);
      view.setUint32(0, 0x06054b50, true);
      view.setUint16(8, entries, true);
      view.setUint16(10, entries, true);
      view.setUint32(12, directorySize, true);
      view.setUint32(16, offset, true);
      return new Blob([...parts, ...directory, end], { type });
    },
  };
}

interface ZipRecord {
  readonly path: Uint8Array;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  /** Where the file's local header starts. */
  readonly offset: number;
}

function localHeader(record: ZipRecord): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(30 + record.path.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(8, DEFLATE, true);
  view.setUint16(10, DOS_TIME, true);
  view.setUint16(12, DOS_DATE, true);
  view.setUint32(14, record.crc, true);
  view.setUint32(18, record.compressedSize, true);
  view.setUint32(22, record.size, true);
  view.setUint16(26, record.path.byteLength, true);
  bytes.set(record.path, 30);
  return bytes;
}

function centralHeader(record: ZipRecord): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(46 + record.path.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, ZIP_VERSION, true);
  view.setUint16(10, DEFLATE, true);
  view.setUint16(12, DOS_TIME, true);
  view.setUint16(14, DOS_DATE, true);
  view.setUint32(16, record.crc, true);
  view.setUint32(20, record.compressedSize, true);
  view.setUint32(24, record.size, true);
  view.setUint16(28, record.path.byteLength, true);
  view.setUint32(42, record.offset, true);
  bytes.set(record.path, 46);
  return bytes;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 as zip uses it, continued from `crc` over `bytes`. Pass 0 to start. */
function crc32(crc: number, bytes: Uint8Array): number {
  const table = (crcTable ??= buildCrcTable());
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

// --- Diagnostics -----------------------------------------------------------------

/**
 * Says, once per column per export and in development only, why a value was
 * written some other way than the one it holds.
 */
function warnOnce<T>(column: ExportColumn<T>, message: string): void {
  if (__VOLT_DEV__ && typeof console !== 'undefined' && !column.warned) {
    column.warned = true;
    console.warn(
      `[volt] createExport: column "${column.id}" ${message}. ` +
        'Give it a formatter in `format` that returns what the file should hold.',
    );
  }
}

/**
 * Says, in development, that the grid holds columns the export was given no
 * definition for. They are left out of the file, which is otherwise
 * indistinguishable from a grid that never had them.
 */
function warnMissingColumns(missing: number, total: number): void {
  if (__VOLT_DEV__ && typeof console !== 'undefined') {
    console.warn(
      `[volt] createExport: the grid holds ${total} columns and \`columns\` defines only ` +
        `${total - missing} of them, so ${missing} ${missing === 1 ? 'is' : 'are'} left out. ` +
        'Pass the list the grid is given, or one holding every column it could be.',
    );
  }
}
