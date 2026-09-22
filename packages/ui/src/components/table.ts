import { Component, Prop, Signal, createContext, provideContext } from '@voltdev/core';
import { TagChildren } from './children.js';
import type { VTableColumn } from './table-column.js';

/** A row is whatever the caller's data holds; a column names fields of it. */
export type TableRow = Readonly<Record<string, unknown>>;

/**
 * How a column finds the table it was written inside.
 *
 * The content of a tag is built while the tag it sits in is rendering, so the
 * scope a column initializes in descends from the table's. That is the whole
 * mechanism: no registry, no lookup by name, and a column outside a table
 * finds nothing and says so.
 */
export const TableContext = createContext<VTable | null>(null);

/**
 * A table.
 *
 * ```html
 * <v-table :data="people.get()" row-key="id" striped>
 *   <v-table-column field="name" label="Name"></v-table-column>
 *   <v-table-column label="Actions" align="end">
 *     <template :slot-cell="{ row }">
 *       <v-button :onPress="() => edit(row)">Edit</v-button>
 *     </template>
 *   </v-table-column>
 * </v-table>
 * ```
 *
 * The columns are tags because that is where their templates belong: a cell's
 * markup is written inside the column it draws, and the table fetches it from
 * there with `<slot :from>`. A column is rendered once, for its heading —
 * never once per cell — so a hundred rows of five columns is five component
 * instances and five hundred `<td>`s, which is what it would have been had
 * the markup been written by hand.
 *
 * It is a real `<table>`. The row and column relationships a screen reader
 * reads out are the platform's, and nothing here replaces them with `<div>`s.
 */
@Component({ selector: 'v-table', templateUrl: './table.html' })
export class VTable {
  /** The rows, in the order they are shown. */
  @Prop() data = new Signal.State<readonly TableRow[]>([]);
  /** The field that identifies a row, so a list that changes is keyed by it. */
  @Prop() rowKey = new Signal.State('id');
  /** Shade every second row. */
  @Prop() striped = new Signal.State(false);
  /**
   * The keys of the rows an action is about to be taken on.
   *
   * Selection is the caller's, because what selecting means — one row or many,
   * and what happens next — is theirs. What this owns is drawing it, which it
   * does in a colour a forced palette keeps.
   */
  @Prop() selected = new Signal.State<ReadonlySet<unknown> | null>(null);
  /** Shown in place of the rows when there are none. */
  @Prop() empty = new Signal.State('Nothing to show.');
  /** Called with the row a press landed on. */
  @Prop() onRowPress?: (row: TableRow, index: number) => void;

  /** The row the headings are in, which is where their order is kept. */
  headings: Element | null = null;

  /** The columns, in the order their headings are in. */
  readonly columns = new TagChildren<VTableColumn>(
    () => this.headings,
    (column) => column.head,
  );

  constructor() {
    provideContext(TableContext, this);
  }

  /** What a row is keyed by, falling back to the row itself. */
  keyOf(row: TableRow): unknown {
    return row[this.rowKey.get()] ?? row;
  }

  /** What a column shows for a row, when nothing was written for its cell. */
  value(column: VTableColumn, row: TableRow): unknown {
    const field = column.field.get();
    return field === undefined ? '' : row[field];
  }

  isSelected(row: TableRow): boolean {
    const keys = this.selected.get();
    return keys === null ? false : keys.has(this.keyOf(row));
  }

  pressRow(row: TableRow, index: number): void {
    this.onRowPress?.(row, index);
  }
}
