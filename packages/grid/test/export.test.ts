/**
 * Export, driven through a real mounted grid and read back byte by byte.
 *
 * The claims worth proving are the ones a file makes to somebody who was not
 * there when it was written: that it holds the rows the reader was looking at
 * and not the caller's array, that a CSV parses as RFC 4180 and cannot run a
 * formula in the spreadsheet it is opened in, and that a workbook is a real
 * zip whose every part is intact and typed. The performance claims are counted
 * rather than timed — accessor calls per cell, cells per slice, yields per
 * export — because a count is what a regression changes and a clock is not.
 *
 * Workbooks are unzipped with `node:zlib`, not with the platform stream the
 * export compressed them through, so a checksum or a length the writer got
 * wrong is caught by a reader that did not share its mistakes.
 */
import { crc32, inflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAnnouncer } from '@voltdev/primitives';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, effect, flushSync, mount } from '@voltdev/core';
import {
  createExport,
  createGrid,
  createGrouping,
  type Grid,
  type GridColumn,
  type GridExport,
  type GridExportFile,
  type GridExportOptions,
  type GridGroupedRow,
  type GridSort,
} from '../src/index.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** A row whose every cell is a signal, so a value can change mid-export. */
interface Person {
  readonly id: number;
  readonly cells: readonly Signal.State<unknown>[];
}

const ROW_HEIGHT = 20;
const COLUMN_WIDTH = 100;
/** Three columns are on screen, and two more are rendered as overscan. */
const VIEWPORT_WIDTH = 300;
const VIEWPORT_HEIGHT = 100;

/** Every accessor call, as `row:column`. The evidence for what was read. */
let reads: string[] = [];
/** How many times the export handed the thread back. */
let yields = 0;
/** Run at each yield, with the yield's number — where a test acts mid-export. */
let onYield: ((count: number) => void) | null = null;

function makeColumns(count = 3): GridColumn<Person>[] {
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

function tableOf(values: readonly (readonly unknown[])[]): Person[] {
  return values.map((cells, id) => ({
    id,
    cells: cells.map((value) => new Signal.State<unknown>(value)),
  }));
}

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;

let people: Signal.State<readonly Person[]>;
/** The columns the grid is given. */
let gridColumns: Signal.State<readonly GridColumn<Person>[]>;
/** The columns the export is given, which need not be the same list. */
let exportColumns: Signal.State<readonly GridColumn<Person>[]>;
let exportOptions: Partial<GridExportOptions<Person>>;
let label: string | undefined;

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
      if (observer.targets.has(target)) {
        observer.callback([entry], observer as unknown as ResizeObserver);
      }
    }
    flushSync();
  }
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  reads = [];
  yields = 0;
  onYield = null;
  label = 'People';
  exportOptions = {};
  people = new Signal.State<readonly Person[]>(
    tableOf([
      ['delta', 4, true],
      ['alpha', 1, false],
      ['charlie', 3, true],
      ['bravo', 2, false],
    ]),
  );
  const columns = makeColumns();
  gridColumns = new Signal.State<readonly GridColumn<Person>[]>(columns);
  exportColumns = new Signal.State<readonly GridColumn<Person>[]>(columns);

  FakeResizeObserver.live = [];
  const view = window as unknown as { ResizeObserver: unknown };
  const original = view.ResizeObserver;
  view.ResizeObserver = FakeResizeObserver;
  restores.push(() => {
    view.ResizeObserver = original;
  });

  // A scheduler that counts, and lets a test do something while the export
  // is between two slices — which is the whole point of there being slices.
  const global = globalThis as { scheduler?: unknown };
  const had = 'scheduler' in global;
  const previous = global.scheduler;
  global.scheduler = {
    yield: (): Promise<void> => {
      yields += 1;
      onYield?.(yields);
      return Promise.resolve();
    },
  };
  restores.push(() => {
    if (had) global.scheduler = previous;
    else delete global.scheduler;
  });
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  resetAnnouncer();
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
  vi.restoreAllMocks();
});

const TEMPLATE = `
  <div class="grid" :ref="grid" :spread="g.gridProps()">
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
                 :spread="g.cellProps(row, col)">{ g.cellValue(row, col) }</div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

interface Harness {
  g: Grid<Person>;
  exporter: GridExport;
}

function setup(): Harness {
  @Component({ selector: `v-export-${++selectors}`, render: compileTemplate(TEMPLATE) })
  class ExportedGrid {
    grid = new Signal.State<Element | null>(null);
    scroller = new Signal.State<Element | null>(null);
    container = new Signal.State<Element | null>(null);

    g = createGrid<Person>({
      grid: () => this.grid.get(),
      scroller: () => this.scroller.get(),
      container: () => this.container.get(),
      rows: () => people.get(),
      columns: () => gridColumns.get(),
      getRowKey: (row) => row.id,
      rowHeight: ROW_HEIGHT,
      label,
    });

    exporter = createExport<Person>({
      grid: () => this.g,
      columns: () => exportColumns.get(),
      ...exportOptions,
    });
  }

  const handle = mount(ExportedGrid, host);
  mounted.push(handle);

  const scroller = host.querySelector<HTMLElement>('.body')!;
  Object.defineProperty(scroller, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true });
  Object.defineProperty(scroller, 'clientWidth', { value: VIEWPORT_WIDTH, configurable: true });
  FakeResizeObserver.deliver(scroller, VIEWPORT_HEIGHT, VIEWPORT_WIDTH);

  // What rendering the window read is not what exporting reads.
  reads = [];
  const instance = handle.instance as Harness;
  return { g: instance.g, exporter: instance.exporter };
}

/**
 * The parts of every `Blob` made from here to the end of the test, in order.
 *
 * What a file's own `Blob` is handed is what its constructor has to do in one
 * synchronous call: encode every string, copy every buffer.
 */
function recordBlobs(): BlobPart[][] {
  const made: BlobPart[][] = [];
  const Original = globalThis.Blob;
  globalThis.Blob = class extends Original {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options);
      made.push([...(parts ?? [])]);
    }
  };
  restores.push(() => {
    globalThis.Blob = Original;
  });
  return made;
}

/** A grid of these rows, exported as CSV, as the text a reader opens. */
async function csvOf(values: readonly (readonly unknown[])[]): Promise<string> {
  people.set(tableOf(values));
  const { exporter } = setup();
  return (await exporter.csv()).blob.text();
}

// --- Reading the files back ------------------------------------------------

const decoder = new TextDecoder();

/**
 * Every record of an RFC 4180 file, each as its fields.
 *
 * Written from the RFC's grammar and nothing else, so a file it reads back
 * field for field is a file any conforming reader will.
 */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let at = 0;
  while (at < text.length) {
    const record: string[] = [];
    for (;;) {
      let field = '';
      if (text[at] === '"') {
        at += 1;
        for (;;) {
          const quote = text.indexOf('"', at);
          if (quote < 0) throw new Error('an unterminated quoted field');
          field += text.slice(at, quote);
          at = quote + 1;
          if (text[at] !== '"') break;
          field += '"';
          at += 1;
        }
      } else {
        while (at < text.length && text[at] !== ',' && text[at] !== '\r') {
          if (text[at] === '"' || text[at] === '\n') throw new Error(`a bare ${text[at]} at ${at}`);
          field += text[at];
          at += 1;
        }
      }
      record.push(field);
      if (text[at] === ',') {
        at += 1;
        continue;
      }
      if (text.slice(at, at + 2) !== '\r\n') throw new Error(`a record not ended by CRLF at ${at}`);
      at += 2;
      break;
    }
    records.push(record);
  }
  return records;
}

/**
 * Whether a part parses as XML: one root, every element closed, in order.
 *
 * The regular expressions that read cells back would find them in a part
 * whose root was never closed, which a spreadsheet refuses to open.
 */
function wellFormed(text: string): boolean {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return doc.getElementsByTagName('parsererror').length === 0;
}

/** The parts of a zip, each inflated, checked against both of its headers, and parsed. */
async function unzip(blob: Blob): Promise<Map<string, string>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  expect(view.getUint16(end + 8, true)).toBe(count);
  const directorySize = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  expect(at + directorySize).toBe(end);

  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    // The local header says what the directory says. A reader that walks the
    // archive from the front reads only these, and a strict one refuses a
    // file whose two accounts of an entry disagree.
    const localName = decoder.decode(
      bytes.subarray(offset + 30, offset + 30 + view.getUint16(offset + 26, true)),
    );
    expect(localName).toBe(name);
    expect(view.getUint16(offset + 4, true)).toBe(view.getUint16(at + 6, true));
    expect(view.getUint16(offset + 4, true)).toBeLessThanOrEqual(20);
    expect(view.getUint16(offset + 10, true)).toBe(view.getUint16(at + 12, true));
    expect(view.getUint16(offset + 12, true)).toBe(view.getUint16(at + 14, true));
    // An MS-DOS date whose month and day are real ones.
    const date = view.getUint16(offset + 12, true);
    expect((date >> 5) & 0xf).toBeGreaterThanOrEqual(1);
    expect((date >> 5) & 0xf).toBeLessThanOrEqual(12);
    expect(date & 0x1f).toBeGreaterThanOrEqual(1);
    expect(view.getUint16(offset + 8, true)).toBe(method);
    expect(view.getUint32(offset + 14, true)).toBe(crc);
    expect(view.getUint32(offset + 18, true)).toBe(compressedSize);
    expect(view.getUint32(offset + 22, true)).toBe(size);
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);

    expect(method).toBe(8);
    const data = inflateRawSync(bytes.subarray(start, start + compressedSize));
    expect(data.byteLength).toBe(size);
    expect(crc32(data)).toBe(crc);
    const text = decoder.decode(data);
    expect(wellFormed(text), `${name} is not well-formed XML`).toBe(true);
    files.set(name, text);
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  expect(at).toBe(end);
  return files;
}

interface SheetCell {
  readonly type: string | null;
  readonly style: string | null;
  readonly value: string;
}

interface Workbook {
  readonly files: Map<string, string>;
  readonly sheet: string;
  readonly styles: string;
  /** The shared strings, entities decoded and the workbook's own escapes left as they are. */
  readonly strings: string[];
  readonly cells: Map<string, SheetCell>;
  /** What a spreadsheet reads a cell as: its text, its number or its boolean. */
  read(ref: string): unknown;
}

function unescapeXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
}

async function openWorkbook(file: GridExportFile): Promise<Workbook> {
  const files = await unzip(file.blob);
  const sheet = files.get('xl/worksheets/sheet1.xml')!;
  const shared = files.get('xl/sharedStrings.xml')!;
  const strings = [...shared.matchAll(/<si><t(?: xml:space="preserve")?>([^<]*)<\/t><\/si>/g)].map(
    (match) => unescapeXml(match[1]!),
  );
  const cells = new Map<string, SheetCell>();
  for (const match of sheet.matchAll(
    /<c r="([A-Z]+\d+)"(?: s="(\d+)")?(?: t="(\w+)")?><v>([^<]*)<\/v><\/c>/g,
  )) {
    cells.set(match[1]!, { style: match[2] ?? null, type: match[3] ?? null, value: match[4]! });
  }
  return {
    files,
    sheet,
    styles: files.get('xl/styles.xml')!,
    strings,
    cells,
    read(ref) {
      const cell = cells.get(ref);
      if (cell === undefined) return undefined;
      if (cell.type === 's') return strings[Number(cell.value)];
      if (cell.type === 'b') return cell.value === '1';
      return Number(cell.value);
    },
  };
}

/** A grid of these rows, exported as a workbook and opened again. */
async function workbookOf(values: readonly (readonly unknown[])[]): Promise<Workbook> {
  people.set(tableOf(values));
  const { exporter } = setup();
  return openWorkbook(await exporter.xlsx());
}

/** Each row element of the sheet, as its opening tag. */
function rowTags(sheet: string): string[] {
  return [...sheet.matchAll(/<row [^>]*>/g)].map((match) => match[0]);
}

// --- A grouped grid ----------------------------------------------------------

interface Sale {
  readonly id: number;
  readonly region: string;
  readonly city: string;
  readonly amount: number;
}

const SALES: readonly Sale[] = [
  { id: 1, region: 'east', city: 'london', amount: 1 },
  { id: 2, region: 'east', city: 'paris', amount: 2 },
  { id: 3, region: 'west', city: 'london', amount: 4 },
  { id: 4, region: 'west', city: 'london', amount: 8 },
];

const SALE_COLUMNS: readonly GridColumn<Sale>[] = [
  { id: 'region', header: 'Region', value: (sale) => sale.region },
  { id: 'city', header: 'City', value: (sale) => sale.city },
  { id: 'amount', header: 'Amount', value: (sale) => sale.amount },
];

/**
 * A grid grouped by these levels, and an export of it wired the way the
 * documentation says: the level from each row's depth, and the group's label
 * in the first column, where the template puts it.
 */
function grouped(groupBy: readonly string[], collapsed: readonly string[] = []): GridExport {
  return createRoot((dispose) => {
    restores.push(dispose);
    const sort = new Signal.State<readonly GridSort[]>([]);
    const grouping = createGrouping<Sale>({
      rows: () => SALES,
      columns: () => SALE_COLUMNS,
      groupBy: () => groupBy,
      aggregations: () => [{ columnId: 'amount', kind: 'sum' }],
      getRowKey: (sale) => sale.id,
      collapsed: new Signal.State<ReadonlySet<string>>(new Set(collapsed)),
      sort,
    });
    const grid = createGrid<GridGroupedRow<Sale>>({
      grid: () => null,
      scroller: () => null,
      container: () => null,
      rows: () => grouping.rows(),
      columns: () => grouping.columns(),
      getRowKey: grouping.rowKey,
      sort,
      label: 'Sales',
    });
    return createExport<GridGroupedRow<Sale>>({
      grid: () => grid,
      columns: () => grouping.columns(),
      outlineLevel: (row) => row.depth,
      format: () => ({
        region: (value, row) => (row.kind === 'group' ? grouping.label(row) : value),
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

describe('what it exports', () => {
  it('exports the rows the grid shows, sorted and filtered, and not the array it was given', async () => {
    const { g, exporter } = setup();
    const before = people.get();
    g.setFilter('c1', { type: 'number', value: 1, operator: 'greaterThan' });
    g.setSort([{ columnId: 'c0', direction: 'ascending' }]);
    flushSync();

    const text = await (await exporter.csv()).blob.text();
    expect(parseCsv(text)).toEqual([
      ['Column 0', 'Column 1', 'Column 2'],
      ['bravo', '2', 'false'],
      ['charlie', '3', 'true'],
      ['delta', '4', 'true'],
    ]);
    // The caller's array, as it was: the same object, in the same order.
    expect(people.get()).toBe(before);
    expect(before.map((row) => row.id)).toEqual([0, 1, 2, 3]);
  });

  it('writes the columns the grid holds, in the order it holds them', async () => {
    const [c0, c1, c2] = makeColumns();
    // The grid shows two of three, the third first; the export is handed all
    // three in their declared order, and the grid's answer wins.
    gridColumns.set([c2!, c0!]);
    exportColumns.set([c0!, c1!, c2!]);
    const { exporter } = setup();

    const text = await (await exporter.csv()).blob.text();
    expect(parseCsv(text)[0]).toEqual(['Column 2', 'Column 0']);
    expect(parseCsv(text)[1]).toEqual(['true', 'delta']);
  });

  it('leaves out a column it was given no definition for, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [c0, , c2] = makeColumns();
    exportColumns.set([c0!, c2!]);
    const { exporter } = setup();

    const text = await (await exporter.csv()).blob.text();
    expect(parseCsv(text)[0]).toEqual(['Column 0', 'Column 2']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('holds 3 columns and `columns` defines only 2');
  });

  it('fixes the rows when it is asked, so a sort during the export moves nothing in it', async () => {
    exportOptions = { cellsPerSlice: 3 };
    const { g, exporter } = setup();
    onYield = (count) => {
      if (count !== 1) return;
      g.setSort([{ columnId: 'c1', direction: 'descending' }]);
      people.set([...people.get(), ...tableOf([['echo', 5, true]])]);
      flushSync();
    };

    const text = await (await exporter.csv()).blob.text();
    expect(yields).toBe(3);
    expect(parseCsv(text).map((record) => record[0])).toEqual([
      'Column 0',
      'delta',
      'alpha',
      'charlie',
      'bravo',
    ]);
  });

  it('reads each value as its slice is written', async () => {
    exportOptions = { cellsPerSlice: 3 };
    const { exporter } = setup();
    onYield = (count) => {
      if (count !== 1) return;
      // The first row is written, the third is not.
      people.get()[0]!.cells[0]!.set('DELTA');
      people.get()[2]!.cells[0]!.set('CHARLIE');
    };

    const text = await (await exporter.csv()).blob.text();
    expect(parseCsv(text).map((record) => record[0])).toEqual([
      'Column 0',
      'delta',
      'alpha',
      'CHARLIE',
      'bravo',
    ]);
  });

  it('never writes to the rows it was handed', async () => {
    const rows = people.get().map((row) => Object.freeze(row));
    people.set(Object.freeze(rows));
    const { g, exporter } = setup();
    g.setSort([{ columnId: 'c1', direction: 'ascending' }]);
    flushSync();

    // A frozen row throws on any write in a module, which this is.
    await exporter.csv();
    await exporter.xlsx();
    expect(people.get().map((row) => row.id)).toEqual([0, 1, 2, 3]);
  });

  it('refuses when there is no grid to export', async () => {
    const exporter = createExport<Person>({ grid: () => null, columns: () => makeColumns() });
    await expect(exporter.csv()).rejects.toThrow('`grid` returned no grid');
    await expect(exporter.xlsx()).rejects.toThrow('`grid` returned no grid');
  });

  it('exports a grouped grid as the reader sees it: each header above the rows it heads', async () => {
    const text = await (await grouped(['region']).csv()).blob.text();
    expect(parseCsv(text)).toEqual([
      ['Region', 'City', 'Amount'],
      ['east', '', '3'],
      ['east', 'london', '1'],
      ['east', 'paris', '2'],
      ['west', '', '12'],
      ['west', 'london', '4'],
      ['west', 'london', '8'],
    ]);
  });

  it('exports a collapsed group as its header alone, which is all the reader sees of it', async () => {
    const text = await (await grouped(['region'], ['west']).csv()).blob.text();
    expect(parseCsv(text)).toEqual([
      ['Region', 'City', 'Amount'],
      ['east', '', '3'],
      ['east', 'london', '1'],
      ['east', 'paris', '2'],
      ['west', '', '12'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Reading cells
// ---------------------------------------------------------------------------

describe('reading cells', () => {
  it('reads nothing until it is asked for a file', () => {
    const { g } = setup();
    createExport<Person>({ grid: () => g, columns: () => exportColumns.get() });
    expect(reads).toEqual([]);
  });

  it('reads each cell exactly once', async () => {
    people.set(tableOf(Array.from({ length: 1000 }, (_, i) => [`name ${i}`, i, i % 2 === 0])));
    const { exporter } = setup();

    await exporter.csv();
    expect(reads).toHaveLength(3000);
    expect(new Set(reads).size).toBe(3000);

    reads = [];
    await exporter.xlsx();
    expect(reads).toHaveLength(3000);
    expect(new Set(reads).size).toBe(3000);
  });

  it('calls a formatter once per cell, with the value and the row', async () => {
    const calls: string[] = [];
    exportOptions = {
      format: () => ({
        c1: (value, row) => {
          calls.push(`${row.id}=${String(value)}`);
          return value;
        },
      }),
    };
    const { exporter } = setup();

    await exporter.csv();
    expect(calls).toEqual(['0=4', '1=1', '2=3', '3=2']);
    // The accessor still ran once per cell, formatted or not.
    expect(reads).toHaveLength(12);
  });

  it('finds a formatter only where `format` gives one, whatever a column is called', async () => {
    // Ids every object inherits a member under. A lookup that followed the
    // prototype would format these with `Object`, `Object.prototype.toString`
    // and `valueOf` — the last of which throws.
    const ids = ['constructor', 'toString', 'valueOf'];
    const columns = makeColumns().map((column, index) => ({ ...column, id: ids[index]! }));
    gridColumns.set(columns);
    exportColumns.set(columns);
    exportOptions = { format: () => ({ toString: (value: unknown) => `#${String(value)}` }) };
    const { exporter } = setup();

    expect(parseCsv(await (await exporter.csv()).blob.text())[1]).toEqual(['delta', '#4', 'true']);
    const book = await openWorkbook(await exporter.xlsx());
    expect([book.read('A2'), book.read('B2'), book.read('C2')]).toEqual(['delta', '#4', true]);
  });

  it('finds no formatter by an inherited name when `format` is not given at all', async () => {
    const ids = ['constructor', 'toString', 'hasOwnProperty'];
    const columns = makeColumns().map((column, index) => ({ ...column, id: ids[index]! }));
    gridColumns.set(columns);
    exportColumns.set(columns);
    const { exporter } = setup();

    expect(parseCsv(await (await exporter.csv()).blob.text())[1]).toEqual(['delta', '4', 'true']);
  });

  it('subscribes to nothing, even when an export starts inside an effect', async () => {
    const { g, exporter } = setup();
    let runs = 0;
    let file: Promise<GridExportFile> | null = null;
    restores.push(
      createRoot((dispose) => {
        effect(() => {
          runs += 1;
          file = exporter.csv();
        });
        return dispose;
      }),
    );
    flushSync();
    await file;
    expect(runs).toBe(1);

    // A value it read, the sort, and the rows themselves.
    people.get()[0]!.cells[0]!.set('changed');
    g.setSort([{ columnId: 'c0', direction: 'descending' }]);
    people.set([...people.get()]);
    flushSync();
    expect(runs).toBe(1);
  });

  it('subscribes to nothing when a workbook starts inside an effect, its outline included', async () => {
    // The outline is read with the rows, before the first await, so it runs
    // inside the effect that asked for the file.
    const depth = new Signal.State(1);
    exportOptions = { outlineLevel: () => depth.get() };
    const { exporter } = setup();
    let runs = 0;
    let file: Promise<GridExportFile> | null = null;
    restores.push(
      createRoot((dispose) => {
        effect(() => {
          runs += 1;
          file = exporter.xlsx();
        });
        return dispose;
      }),
    );
    flushSync();
    await file;
    expect(runs).toBe(1);

    depth.set(2);
    people.get()[0]!.cells[0]!.set('changed');
    flushSync();
    expect(runs).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------

describe('slices', () => {
  it('reads at most `cellsPerSlice` cells, as whole rows, between one yield and the next', async () => {
    people.set(tableOf(Array.from({ length: 10 }, (_, i) => [i, i, i])));
    // Seven cells is two whole rows of three.
    exportOptions = { cellsPerSlice: 7 };
    const { exporter } = setup();
    const readAtYield: number[] = [];
    onYield = () => readAtYield.push(reads.length);

    await exporter.csv();
    expect(readAtYield).toEqual([6, 12, 18, 24]);
    expect(reads).toHaveLength(30);
  });

  it('never makes a slice smaller than one row', async () => {
    exportOptions = { cellsPerSlice: 1 };
    const { exporter } = setup();
    const readAtYield: number[] = [];
    onYield = () => readAtYield.push(reads.length);

    await exporter.csv();
    expect(readAtYield).toEqual([3, 6, 9]);
  });

  it('yields nothing for an export that fits in one slice', async () => {
    const { exporter } = setup();
    await exporter.csv();
    expect(yields).toBe(0);
  });

  it('yields between the slices of a workbook too', async () => {
    people.set(tableOf(Array.from({ length: 10 }, (_, i) => [i, i, i])));
    exportOptions = { cellsPerSlice: 6 };
    const { exporter } = setup();
    const readAtYield: number[] = [];
    onYield = () => readAtYield.push(reads.length);

    await exporter.xlsx();
    // Five slices of the sheet, then the shared strings — only the three
    // headers here — which fit in one.
    expect(readAtYield).toEqual([6, 12, 18, 24]);
  });

  it('writes the shared strings in slices of their own', async () => {
    people.set(tableOf(Array.from({ length: 4 }, (_, i) => [`a${i}`, `b${i}`, `c${i}`])));
    exportOptions = { cellsPerSlice: 6 };
    const { exporter } = setup();

    const book = await openWorkbook(await exporter.xlsx());
    // Two slices of the sheet, then fifteen strings in three slices.
    expect(book.strings).toHaveLength(15);
    expect(yields).toBe(1 + 2);
  });

  it('stops between slices when it is aborted, and reads no further', async () => {
    exportOptions = { cellsPerSlice: 3 };
    const { exporter } = setup();
    const controller = new AbortController();
    onYield = () => controller.abort();

    await expect(exporter.csv({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(reads).toHaveLength(3);

    reads = [];
    const again = new AbortController();
    onYield = () => again.abort();
    await expect(exporter.xlsx({ signal: again.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(reads).toHaveLength(3);
  });

  it('does not start when it is already aborted', async () => {
    const { exporter } = setup();
    const signal = AbortSignal.abort();
    await expect(exporter.csv({ signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(exporter.xlsx({ signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(reads).toEqual([]);
  });

  it('hands each slice of a CSV to the file as it is written, leaving nothing to encode at the end', async () => {
    const made = recordBlobs();
    people.set(tableOf(Array.from({ length: 10 }, (_, i) => [`é${i}`, i, i])));
    exportOptions = { cellsPerSlice: 6 };
    const { exporter } = setup();

    const file = await exporter.csv({ bom: true });
    // A string handed to the file's own Blob would be encoded there, in one
    // task, however large the export: the whole file's text at once.
    const parts = made.at(-1)!;
    expect(parts.every((part) => part instanceof Blob)).toBe(true);
    // The header, then five slices of two rows — each its own Blob, made as
    // the slice was written.
    expect(parts).toHaveLength(6);
    expect(made.slice(0, -1).map((each) => each.length)).toEqual([1, 1, 1, 1, 1, 1]);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await file.blob.arrayBuffer());
    expect(text.startsWith('﻿Column 0,')).toBe(true);
    expect(parseCsv(text.slice(1))).toHaveLength(11);
  });

  it('hands each slice of a workbook to the file as it is compressed, leaving only headers to add', async () => {
    const made = recordBlobs();
    people.set(tableOf(Array.from({ length: 200 }, (_, i) => [`row ${i}`, i, i % 2 === 0])));
    exportOptions = { cellsPerSlice: 30 };
    const { exporter } = setup();

    const book = await openWorkbook(await exporter.xlsx());
    expect(book.read('A201')).toBe('row 199');
    // Everything in the file that is not a Blob is a zip header or the end
    // record, which exist only once every part is finished.
    const signatures = [0x04034b50, 0x02014b50, 0x06054b50];
    for (const part of made.at(-1)!) {
      if (part instanceof Blob) continue;
      const bytes = part as Uint8Array;
      const signature = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
      expect(signatures).toContain(signature);
    }
  });

  it('hands the thread back through a message channel where there is no scheduler', async () => {
    delete (globalThis as { scheduler?: unknown }).scheduler;
    const Original = globalThis.MessageChannel;
    let channels = 0;
    globalThis.MessageChannel = class extends Original {
      constructor() {
        super();
        channels += 1;
      }
    };
    restores.push(() => {
      globalThis.MessageChannel = Original;
    });
    exportOptions = { cellsPerSlice: 3 };
    const { exporter } = setup();

    const text = await (await exporter.csv()).blob.text();
    expect(channels).toBe(3);
    expect(parseCsv(text)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('CSV', () => {
  it('is RFC 4180: a header record, comma-separated fields, and CRLF after every record', async () => {
    const text = await csvOf([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
    expect(text).toBe('Column 0,Column 1,Column 2\r\na,b,c\r\nd,e,f\r\n');
  });

  it('quotes a field only where it holds a comma, a quote or a line break', async () => {
    const values = ['a,b', 'say "hi"', 'one\ntwo', 'one\rtwo', ' spaced ', 'plain'];
    const text = await csvOf(values.map((value) => [value, 'x', 'y']));
    expect(text.split('\r\n').slice(1, 3)).toEqual(['"a,b",x,y', '"say ""hi""",x,y']);
    expect(text).toContain('\r\n"one\ntwo",x,y\r\n');
    expect(text).toContain('\r\n"one\rtwo",x,y\r\n');
    expect(text).toContain('\r\n spaced ,x,y\r\n');
    expect(text).toContain('\r\nplain,x,y\r\n');
    // And every one of them comes back as it went in.
    expect(parseCsv(text).slice(1).map((record) => record[0])).toEqual(values);
  });

  it('writes a lone empty field as "", so a record of one column is never a blank line', async () => {
    // A blank line is a record of one empty field to RFC 4180, and no record
    // at all to the readers that skip blank lines — which would move every
    // row under it up by one.
    const [c0] = makeColumns();
    const columns = [{ ...c0!, header: '' }];
    gridColumns.set(columns);
    exportColumns.set(columns);
    const text = await csvOf([['a'], [''], [null], ['b']]);
    expect(text).toBe('""\r\na\r\n""\r\n""\r\nb\r\n');
    expect(parseCsv(text)).toEqual([[''], ['a'], [''], [''], ['b']]);
  });

  it('leaves an empty field bare where the record has others', async () => {
    const text = await csvOf([['', null, '']]);
    expect(text.split('\r\n')[1]).toBe(',,');
  });

  it('begins with a byte order mark only when asked for one', async () => {
    const { exporter } = setup();
    const plain = new Uint8Array(await (await exporter.csv()).blob.arrayBuffer());
    expect([...plain.subarray(0, 3)]).toEqual([0x43, 0x6f, 0x6c]); // "Col"

    const marked = new Uint8Array(await (await exporter.csv({ bom: true })).blob.arrayBuffer());
    expect([...marked.subarray(0, 6)]).toEqual([0xef, 0xbb, 0xbf, 0x43, 0x6f, 0x6c]);
    expect(marked.byteLength).toBe(plain.byteLength + 3);
  });

  it('escapes a field a spreadsheet would run as a formula, the way OWASP describes', async () => {
    const dangerous = ['=SUM(A1:A9)', '+1', '-1+2', '@cmd', '\tx', '\rx'];
    const text = await csvOf(dangerous.map((value) => [value, 'x', 'y']));
    expect(text.split('\r\n').slice(1, 5)).toEqual([
      `"'=SUM(A1:A9)",x,y`,
      `"'+1",x,y`,
      `"'-1+2",x,y`,
      `"'@cmd",x,y`,
    ]);
    expect(text).toContain(`\r\n"'\tx",x,y\r\n`);
    expect(text).toContain(`\r\n"'\rx",x,y\r\n`);
    // Read back, each is its text with the apostrophe that makes it text.
    expect(parseCsv(text).slice(1).map((record) => record[0])).toEqual(
      dangerous.map((value) => `'${value}`),
    );
  });

  it("writes OWASP's own two examples exactly as OWASP escapes them", async () => {
    const text = await csvOf([
      ['=1+2";=1+2', 'x', 'y'],
      [`=1+2'" ;,=1+2`, 'x', 'y'],
    ]);
    expect(text.split('\r\n').slice(1, 3)).toEqual([
      `"'=1+2"";=1+2",x,y`,
      `"'=1+2'"" ;,=1+2",x,y`,
    ]);
  });

  it('escapes a header the same way, since a header can come from data too', async () => {
    const [c0, c1, c2] = makeColumns();
    const columns = [{ ...c0!, header: '=HYPERLINK("http://evil")' }, c1!, c2!];
    gridColumns.set(columns);
    exportColumns.set(columns);
    const { exporter } = setup();

    const text = await (await exporter.csv()).blob.text();
    expect(text.split('\r\n')[0]).toBe(`"'=HYPERLINK(""http://evil"")",Column 1,Column 2`);
  });

  it('leaves a number alone, and escapes the same characters as text', async () => {
    const text = await csvOf([[-5, '-5', 1e21]]);
    expect(text.split('\r\n')[1]).toBe(`-5,"'-5",1e+21`);
  });

  it('writes each kind of value the way a spreadsheet reads it', async () => {
    const text = await csvOf([
      [null, undefined, Number.NaN],
      [true, false, 0.5],
      [12345678901234567890n, -0, Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY, '', 0],
    ]);
    expect(text.split('\r\n').slice(1, 5)).toEqual([
      ',,',
      'true,false,0.5',
      '12345678901234567890,0,Infinity',
      `"'-Infinity",,0`,
    ]);
  });

  it("writes a date in the reader's own wall clock, with a time only where it has one", async () => {
    const text = await csvOf([
      [new Date(2024, 0, 5), new Date(2024, 0, 5, 14, 30), new Date(2024, 0, 5, 14, 30, 5, 7)],
      [new Date(Number.NaN), new Date(-1, 0, 1), new Date(12024, 0, 1)],
    ]);
    expect(text.split('\r\n').slice(1, 3)).toEqual([
      '2024-01-05,2024-01-05 14:30:00,2024-01-05 14:30:05.007',
      // Text a spreadsheet would read as arithmetic, escaped like any other.
      `,"'-000001-01-01","'+012024-01-01"`,
    ]);
  });

  it('writes an object as the grid displays it, and never as [object Object]', async () => {
    const text = await csvOf([[{ amount: 5, currency: 'EUR' }, [1, 'two'], 'x']]);
    expect(text).not.toContain('[object Object]');
    expect(parseCsv(text)[1]).toEqual(['{"amount":5,"currency":"EUR"}', '[1,"two"]', 'x']);
  });

  it('leaves out a value that cannot be written as text, and names its column once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const text = await csvOf([
      [cycle, 'x', () => 1],
      [cycle, 'y', 'z'],
    ]);
    expect(parseCsv(text).slice(1)).toEqual([
      ['', 'x', ''],
      ['', 'y', 'z'],
    ]);
    // Once for each column, not once for each cell.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toContain('column "c0" holds a value that cannot be written');
    expect(warn.mock.calls[1]![0]).toContain('column "c2"');
  });

  it('writes what a formatter returns in place of the value', async () => {
    exportOptions = {
      format: () => ({
        c0: (value, row) => `#${row.id} ${String(value).toUpperCase()}`,
        c1: (value) => ({ units: value }),
      }),
    };
    const { exporter } = setup();

    const text = await (await exporter.csv()).blob.text();
    expect(parseCsv(text)[1]).toEqual(['#0 DELTA', '{"units":4}', 'true']);
  });

  it('writes a header alone for a grid with no rows, and nothing for one with no columns', async () => {
    people.set([]);
    const { exporter } = setup();
    expect(await (await exporter.csv()).blob.text()).toBe('Column 0,Column 1,Column 2\r\n');

    gridColumns.set([]);
    flushSync();
    expect((await exporter.csv()).blob.size).toBe(0);
    // Asked for, the mark is still the one thing a file of nothing begins with.
    const marked = new Uint8Array(await (await exporter.csv({ bom: true })).blob.arrayBuffer());
    expect([...marked]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("is typed as CSV with a header, and named after the grid", async () => {
    const { exporter } = setup();
    const file = await exporter.csv();
    expect(file.blob.type).toBe('text/csv;charset=utf-8;header=present');
    expect(file.filename).toBe('People.csv');
  });

  it('is named what it is told to be, made safe to save under', async () => {
    const name = new Signal.State(' Q1/Q2: "sales" <draft>. ');
    exportOptions = { name: () => name.get() };
    const { exporter } = setup();
    expect((await exporter.csv()).filename).toBe('Q1 Q2 sales draft.csv');

    name.set('...');
    expect((await exporter.csv()).filename).toBe('export.csv');
  });

  it('is named "export" when the grid has no name and none is given', async () => {
    label = undefined;
    const { exporter } = setup();
    expect((await exporter.csv()).filename).toBe('export.csv');
    expect((await exporter.xlsx()).filename).toBe('export.xlsx');
  });
});

// ---------------------------------------------------------------------------
// The workbook
// ---------------------------------------------------------------------------

describe('Excel workbook', () => {
  it('is a zip of the parts a workbook needs, every one intact and declared', async () => {
    const { exporter } = setup();
    const file = await exporter.xlsx();
    expect(file.filename).toBe('People.xlsx');
    expect(file.blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const files = await unzip(file.blob);
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/sharedStrings.xml',
    ]);
    const types = files.get('[Content_Types].xml')!;
    for (const part of ['workbook', 'worksheets/sheet1', 'styles', 'sharedStrings']) {
      expect(types).toContain(`PartName="/xl/${part}.xml"`);
    }
    // Every part has a type, by its name or by its extension: a part with
    // none makes the whole package one a spreadsheet calls corrupt.
    const doc = new DOMParser().parseFromString(types, 'application/xml');
    const overrides = new Set(
      [...doc.getElementsByTagName('Override')].map((node) => node.getAttribute('PartName')),
    );
    const defaults = new Set(
      [...doc.getElementsByTagName('Default')].map((node) => node.getAttribute('Extension')),
    );
    for (const name of files.keys()) {
      if (name === '[Content_Types].xml') continue;
      const typed = overrides.has(`/${name}`) || defaults.has(name.slice(name.lastIndexOf('.') + 1));
      expect(typed, `${name} has no content type`).toBe(true);
    }
    expect(files.get('_rels/.rels')).toContain('Target="xl/workbook.xml"');
    const relationships = files.get('xl/_rels/workbook.xml.rels')!;
    for (const target of ['worksheets/sheet1.xml', 'styles.xml', 'sharedStrings.xml']) {
      expect(relationships).toContain(`Target="${target}"`);
    }
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="People" sheetId="1" r:id="rId1"/>');
  });

  it('writes numbers as numbers, booleans as booleans and text as shared strings', async () => {
    const book = await workbookOf([['delta', 4.5, true]]);
    expect(book.cells.get('A2')).toEqual({ type: 's', style: null, value: '3' });
    expect(book.cells.get('B2')).toEqual({ type: null, style: null, value: '4.5' });
    expect(book.cells.get('C2')).toEqual({ type: 'b', style: null, value: '1' });
    expect(book.read('A2')).toBe('delta');
  });

  it('writes a date as a date: its serial number, in a date format or a date-and-time one', async () => {
    const book = await workbookOf([
      [new Date(2024, 0, 5), new Date(2024, 0, 5, 12), new Date(2024, 0, 5, 6, 0, 0, 1)],
    ]);
    expect(book.cells.get('A2')).toEqual({ type: null, style: '2', value: '45296' });
    expect(book.cells.get('B2')).toEqual({ type: null, style: '3', value: '45296.5' });
    expect(book.cells.get('C2')?.style).toBe('3');
    // A quarter of a day and one millisecond: every field of the clock counts.
    expect(book.read('C2')).toBeCloseTo(45296.25 + 1 / 86_400_000, 10);
    // Style 2 is the built-in short date, and 3 the built-in date and time,
    // both shown in the reader's own locale's order.
    const formats = [...book.styles.matchAll(/<xf numFmtId="(\d+)"[^>]*xfId="0"/g)].map(
      (match) => match[1],
    );
    expect(formats).toEqual(['0', '0', '14', '22']);
  });

  it('keeps the time of a date within the first hour, minute or second of its day', async () => {
    const book = await workbookOf([
      [new Date(2024, 0, 5, 0, 30), new Date(2024, 0, 5, 0, 0, 5), new Date(2024, 0, 5)],
    ]);
    expect(['A2', 'B2', 'C2'].map((ref) => book.cells.get(ref)?.style)).toEqual(['3', '3', '2']);
    expect(book.read('A2')).toBeCloseTo(45296 + 30 / 1440, 10);
    expect(book.read('B2')).toBeCloseTo(45296 + 5 / 86_400, 10);

    const text = await csvOf([
      [new Date(2024, 0, 5, 0, 30), new Date(2024, 0, 5, 0, 0, 5), new Date(2024, 0, 5)],
    ]);
    expect(text.split('\r\n')[1]).toBe('2024-01-05 00:30:00,2024-01-05 00:00:05,2024-01-05');
  });

  it("counts a date's serial from the worksheet epoch, false leap day included", async () => {
    const book = await workbookOf([
      [new Date(1900, 0, 1), new Date(1900, 1, 28), new Date(1900, 2, 1)],
    ]);
    expect([book.read('A2'), book.read('B2'), book.read('C2')]).toEqual([1, 59, 61]);
  });

  it('writes a date a worksheet cannot hold as its text, and an invalid one as nothing', async () => {
    const book = await workbookOf([
      [new Date(1899, 11, 31), new Date(10000, 0, 1), new Date(Number.NaN)],
    ]);
    expect(book.read('A2')).toBe('1899-12-31');
    expect(book.read('B2')).toBe('+010000-01-01');
    expect(book.cells.has('C2')).toBe(false);
  });

  it('writes nothing for a value that is absent, NaN or empty, and text for an infinity', async () => {
    const book = await workbookOf([
      [null, undefined, Number.NaN],
      ['', Number.POSITIVE_INFINITY, 0],
    ]);
    expect(['A2', 'B2', 'C2', 'A3'].map((ref) => book.cells.has(ref))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(book.read('B3')).toBe('Infinity');
    expect(book.read('C3')).toBe(0);
  });

  it('keeps every digit of a bigint too large for a number, as text', async () => {
    const book = await workbookOf([[42n, 2n ** 53n, -(2n ** 53n) + 1n]]);
    expect(book.cells.get('A2')).toEqual({ type: null, style: null, value: '42' });
    expect(book.read('B2')).toBe('9007199254740992');
    expect(book.cells.get('C2')).toEqual({ type: null, style: null, value: '-9007199254740991' });
  });

  it('writes text that looks like a formula as text, and nothing that is one', async () => {
    const book = await workbookOf([['=SUM(A1:A9)', '@cmd', '-1+2']]);
    expect([book.read('A2'), book.read('B2'), book.read('C2')]).toEqual([
      '=SUM(A1:A9)',
      '@cmd',
      '-1+2',
    ]);
    expect(book.sheet).not.toContain('<f>');
  });

  it('writes an object as the grid displays it, as it does in a CSV', async () => {
    const book = await workbookOf([[{ amount: 5 }, [1, 'two'], 'x']]);
    expect(book.read('A2')).toBe('{"amount":5}');
    expect(book.read('B2')).toBe('[1,"two"]');
  });

  it('has a stylesheet whose every count is true and every reference resolves', async () => {
    const book = await workbookOf([['a', 'b', 'c']]);
    const doc = new DOMParser().parseFromString(book.styles, 'application/xml');
    const children = (collection: string, item: string): Element[] => {
      const nodes = doc.getElementsByTagName(collection);
      expect(nodes, `no <${collection}>`).toHaveLength(1);
      const list = [...nodes[0]!.children].filter((node) => node.tagName === item);
      expect(nodes[0]!.getAttribute('count'), `<${collection}> count`).toBe(String(list.length));
      return list;
    };
    const fonts = children('fonts', 'font');
    const fills = children('fills', 'fill');
    const borders = children('borders', 'border');
    const styleXfs = children('cellStyleXfs', 'xf');
    const cellXfs = children('cellXfs', 'xf');
    const cellStyles = children('cellStyles', 'cellStyle');

    // The first two fills are reserved, and a spreadsheet expects them there.
    expect(fills.map((fill) => fill.firstElementChild?.getAttribute('patternType'))).toEqual([
      'none',
      'gray125',
    ]);
    const within = (value: string | null, length: number): boolean =>
      value !== null && Number(value) >= 0 && Number(value) < length;
    for (const xf of [...styleXfs, ...cellXfs]) {
      expect(within(xf.getAttribute('fontId'), fonts.length)).toBe(true);
      expect(within(xf.getAttribute('fillId'), fills.length)).toBe(true);
      expect(within(xf.getAttribute('borderId'), borders.length)).toBe(true);
    }
    for (const xf of cellXfs) expect(within(xf.getAttribute('xfId'), styleXfs.length)).toBe(true);
    for (const style of cellStyles) {
      expect(within(style.getAttribute('xfId'), styleXfs.length)).toBe(true);
    }
    // The header's style, whatever its index, is the bold font.
    const header = cellXfs[Number(book.cells.get('A1')!.style)]!;
    expect(fonts[Number(header.getAttribute('fontId'))]!.getElementsByTagName('b')).toHaveLength(1);
    expect(fonts[0]!.getElementsByTagName('b')).toHaveLength(0);
  });

  it('leaves out a value that cannot be written as text, as it does in a CSV', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const book = await workbookOf([
      [cycle, 'x', 1n],
      [cycle, 'y', () => 1],
    ]);
    expect(['A2', 'A3', 'C3'].map((ref) => book.cells.has(ref))).toEqual([false, false, false]);
    expect([book.read('B2'), book.read('C2')]).toEqual(['x', 1]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toContain('column "c0" holds a value that cannot be written');
    expect(warn.mock.calls[1]![0]).toContain('column "c2"');
  });

  it('makes the header row bold', async () => {
    const book = await workbookOf([['a', 'b', 'c']]);
    for (const ref of ['A1', 'B1', 'C1']) expect(book.cells.get(ref)?.style).toBe('1');
    expect(book.cells.get('A2')?.style).toBeNull();
    expect(book.styles).toContain('<font><b/>');
    expect(book.styles).toMatch(/<cellXfs count="4"><xf [^>]*\/><xf numFmtId="0" fontId="1"/);
    expect([book.read('A1'), book.read('B1'), book.read('C1')]).toEqual([
      'Column 0',
      'Column 1',
      'Column 2',
    ]);
  });

  it('sizes each column as the grid draws it', async () => {
    const columns = makeColumns(8);
    // Outside the window, which ends at the fifth column: the grid has not
    // drawn these, and their declared widths stand — clamped, as it would.
    columns[6] = { ...columns[6]!, width: 60 };
    columns[7] = { ...columns[7]!, width: 10 };
    columns[5] = { ...columns[5]!, width: undefined };
    gridColumns.set(columns);
    exportColumns.set(columns);
    people.set(tableOf([[0, 1, 2, 3, 4, 5, 6, 7]]));
    const { g, exporter } = setup();
    g.resizeColumn('c1', 180);
    flushSync();

    const book = await openWorkbook(await exporter.xlsx());
    const widths = [...book.sheet.matchAll(/<col min="(\d+)" max="\1" width="([\d.]+)" customWidth="1"\/>/g)].map(
      (match) => Number(match[2]),
    );
    // Pixels over a 7px digit, in 256ths: what a worksheet turns back into
    // 100, 180, 150, 60 and 40 pixels.
    expect(widths).toEqual([
      14.28515625, 25.7109375, 14.28515625, 14.28515625, 14.28515625, 21.42578125, 8.5703125,
      5.7109375,
    ]);
  });

  it('sizes a column outside the window exactly as the grid would draw it inside', async () => {
    // The export repeats the grid's default and bounds for the columns the
    // grid has not drawn. The same definitions, drawn and not, must agree —
    // or the two copies have drifted apart.
    const [c0, c1, c2] = makeColumns();
    const sized: GridColumn<Person>[] = [
      { ...c0!, width: undefined },
      { ...c1!, width: 10 },
      { ...c2!, width: 300, minWidth: 80, maxWidth: 90 },
    ];
    const widthsOf = async (exporter: GridExport): Promise<number[]> => {
      const book = await openWorkbook(await exporter.xlsx());
      return [...book.sheet.matchAll(/<col [^>]*width="([\d.]+)"/g)].map((match) => Number(match[1]));
    };

    people.set(tableOf([[0, 1, 2, 3, 4, 5, 6, 7]]));
    gridColumns.set(sized);
    exportColumns.set(sized);
    const drawn = await widthsOf(setup().exporter);

    // Five columns in front push these three past the window's end.
    const filler = makeColumns(8).slice(3);
    gridColumns.set([...filler, ...sized]);
    exportColumns.set([...filler, ...sized]);
    const declared = (await widthsOf(setup().exporter)).slice(5);

    expect(declared).toEqual(drawn);
    expect(drawn).toEqual([150, 40, 90].map((px) => Math.floor((px / 7) * 256) / 256));
  });

  it("folds a grouped grid's rows into the outline levels of their groups", async () => {
    const book = await openWorkbook(await grouped(['region']).xlsx());
    expect(rowTags(book.sheet)).toEqual([
      '<row r="1">',
      '<row r="2">',
      '<row r="3" outlineLevel="1">',
      '<row r="4" outlineLevel="1">',
      '<row r="5">',
      '<row r="6" outlineLevel="1">',
      '<row r="7" outlineLevel="1">',
    ]);
    // The summary of a group is its header, which is above its rows.
    expect(book.sheet).toContain('<sheetPr><outlinePr summaryBelow="0"/></sheetPr>');
    expect(book.sheet).toContain('<sheetFormatPr defaultRowHeight="15" outlineLevelRow="1"/>');
    expect([book.read('A2'), book.read('C2'), book.read('A5'), book.read('C5')]).toEqual([
      'east',
      3,
      'west',
      12,
    ]);
  });

  it('nests the outline as deep as the grouping goes', async () => {
    const book = await openWorkbook(await grouped(['region', 'city']).xlsx());
    const levels = rowTags(book.sheet).map((tag) => /outlineLevel="(\d)"/.exec(tag)?.[1] ?? '0');
    // east, east/london, a row, east/paris, a row, west, west/london, two rows.
    expect(levels).toEqual(['0', '0', '1', '2', '1', '2', '0', '1', '2', '2']);
    expect(book.sheet).toContain('outlineLevelRow="2"');
  });

  it('outlines nothing when it is not told where a row sits', async () => {
    const book = await workbookOf([['a', 'b', 'c']]);
    expect(book.sheet).not.toContain('outline');
    expect(book.sheet).not.toContain('<sheetPr>');
  });

  it('holds an outline to the seven levels a worksheet has', async () => {
    // Deeper than seven is seven, however deep; below none, or no number, is none.
    const levels = [9, -1, Number.NaN, 2.7, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    exportOptions = { outlineLevel: (row) => levels[row.id]! };
    const book = await workbookOf(levels.map((_, i) => [i, i, i]));
    expect(rowTags(book.sheet).slice(1)).toEqual([
      '<row r="2" outlineLevel="7">',
      '<row r="3">',
      '<row r="4">',
      '<row r="5" outlineLevel="2">',
      '<row r="6" outlineLevel="7">',
      '<row r="7">',
    ]);
    expect(book.sheet).toContain('outlineLevelRow="7"');
  });

  it('writes each distinct text once, however many cells hold it', async () => {
    const book = await workbookOf([
      ['same', 'same', 'other'],
      ['same', 'other', 'same'],
    ]);
    expect(book.strings).toEqual(['Column 0', 'Column 1', 'Column 2', 'same', 'other']);
    expect(book.files.get('xl/sharedStrings.xml')).toContain('count="9" uniqueCount="5"');
    expect(['A2', 'B2', 'A3', 'C3'].map((ref) => book.cells.get(ref)?.value)).toEqual([
      '3',
      '3',
      '3',
      '3',
    ]);
  });

  it('escapes what XML cannot carry, the way a worksheet escapes it', async () => {
    const book = await workbookOf([['<b>&"x"', 'a\u0001b\rc', '_x0041_ and tab\there\nnewline']]);
    expect(book.files.get('xl/sharedStrings.xml')).toContain('<t>&lt;b&gt;&amp;&quot;x&quot;</t>');
    expect(book.read('A2')).toBe('<b>&"x"');
    // A control character, carriage return included, as `_xHHHH_`; a literal
    // `_xHHHH_` with its underscore escaped, so it is not decoded into an A.
    expect(book.read('B2')).toBe('a_x0001_b_x000D_c');
    expect(book.read('C2')).toBe('_x005F_x0041_ and tab\there\nnewline');
  });

  it('keeps the spaces at either end of a text', async () => {
    const book = await workbookOf([[' padded ', 'inner space', 'x']]);
    const shared = book.files.get('xl/sharedStrings.xml')!;
    expect(shared).toContain('<t xml:space="preserve"> padded </t>');
    expect(shared).toContain('<t>inner space</t>');
  });

  it('cuts a text too long for a cell short, on a character, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // An emoji straddling the limit, which a cut by length would halve.
    const straddling = 'x'.repeat(32_766) + '\u{1F600}';
    const book = await workbookOf([[straddling, 'x', 'y'], ['z'.repeat(40_000), 'x', 'y']]);
    expect(book.read('A2')).toBe('x'.repeat(32_766));
    expect(book.read('A3')).toBe('z'.repeat(32_767));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('column "c0" holds text longer than the 32767');
  });

  it('refuses more rows than a worksheet holds, before reading a single cell', async () => {
    let read = 0;
    const exporter = createRoot((dispose) => {
      restores.push(dispose);
      const rows = Array.from({ length: 1_048_576 }, (_, i) => i);
      const grid = createGrid<number>({
        grid: () => null,
        scroller: () => null,
        container: () => null,
        rows: () => rows,
        columns: () => [{ id: 'n', header: 'N', value: (n) => (read += 1, n) }],
      });
      return createExport<number>({
        grid: () => grid,
        columns: () => [{ id: 'n', header: 'N', value: (n) => (read += 1, n) }],
      });
    });
    await expect(exporter.xlsx()).rejects.toThrow(RangeError);
    await expect(exporter.xlsx()).rejects.toThrow('more than the 1048576 rows a worksheet holds');
    expect(read).toBe(0);
  });

  it('refuses a part longer than a zip records without Zip64, rather than write a corrupt one', async () => {
    // Four gigabytes of text is not a test's to write, so the third slice of
    // rows says it encoded to that much. It takes the sheet past what a zip
    // header's four bytes can hold, where the size would wrap round to a small
    // one and the archive would lie about the part.
    const encode = TextEncoder.prototype.encode;
    vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (
      this: TextEncoder,
      text?: string,
    ) {
      const bytes = encode.call(this, text);
      if (text?.startsWith('<row r="4"') === true) {
        Object.defineProperty(bytes, 'byteLength', { value: 2 ** 32 });
      }
      return bytes;
    });
    people.set(tableOf(Array.from({ length: 10 }, (_, i) => [i, i, i])));
    exportOptions = { cellsPerSlice: 3 };
    const { exporter } = setup();
    const readAtYield: number[] = [];
    onYield = () => readAtYield.push(reads.length);

    await expect(exporter.xlsx()).rejects.toThrow(
      'xl/worksheets/sheet1.xml is more than the 4 GiB a zip without Zip64 records',
    );
    // Refused at the slice that crossed the line, not after the rest.
    expect(readAtYield).toEqual([3, 6]);
    expect(reads).toHaveLength(9);
  });

  it('refuses more columns than a worksheet holds', async () => {
    const columns: GridColumn<number>[] = Array.from({ length: 16_385 }, (_, i) => ({
      id: `c${i}`,
      header: `${i}`,
      value: (n: number) => n,
    }));
    const exporter = createRoot((dispose) => {
      restores.push(dispose);
      const grid = createGrid<number>({
        grid: () => null,
        scroller: () => null,
        container: () => null,
        rows: () => [1],
        columns: () => columns,
      });
      return createExport<number>({ grid: () => grid, columns: () => columns });
    });
    await expect(exporter.xlsx()).rejects.toThrow('16385 columns are more than the 16384');
  });

  it('names its worksheet as a worksheet will take it', async () => {
    const name = new Signal.State('[Q1]: sales/returns');
    exportOptions = { name: () => name.get() };
    const { exporter } = setup();
    const sheetOf = async (): Promise<string> => {
      const files = await unzip((await exporter.xlsx()).blob);
      return /<sheet name="([^"]*)"/.exec(files.get('xl/workbook.xml')!)![1]!;
    };

    expect(await sheetOf()).toBe('Q1 sales returns');
    name.set(`'quoted'`);
    expect(await sheetOf()).toBe('quoted');
    name.set('A name much longer than thirty-one characters');
    expect(await sheetOf()).toBe('A name much longer than thirty-');
    name.set('R&D');
    expect(await sheetOf()).toBe('R&amp;D');
    name.set('History');
    expect(await sheetOf()).toBe('Sheet1');
    name.set('');
    expect(await sheetOf()).toBe('Sheet1');
  });

  it('writes the same bytes for the same view', async () => {
    const { exporter } = setup();
    const first = new Uint8Array(await (await exporter.xlsx()).blob.arrayBuffer());
    const second = new Uint8Array(await (await exporter.xlsx()).blob.arrayBuffer());
    expect(second).toEqual(first);
  });

  it('writes an empty worksheet for a grid with no columns', async () => {
    gridColumns.set([]);
    const { exporter } = setup();
    const book = await openWorkbook(await exporter.xlsx());
    expect(book.sheet).toContain('<dimension ref="A1"/>');
    expect(book.sheet).toContain('<sheetData></sheetData>');
    expect(book.sheet).not.toContain('<cols>');
  });

  it('declares the extent of what it wrote', async () => {
    const book = await workbookOf([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
    expect(book.sheet).toContain('<dimension ref="A1:C3"/>');
  });
});
