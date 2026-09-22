import { Component, Prop, Signal, useContext } from '@voltdev/core';
import { TableContext, type VTable } from './table.js';

/**
 * A column of a table.
 *
 * Two things at once, which is what makes the markup read the way it does. It
 * is a declaration — the table collects it and draws a `<td>` per row from
 * what it says — and it is a heading, which it draws itself. Whatever a caller
 * writes on the tag lands on that `<th>`, so a column is styled and labelled
 * like the element it is.
 *
 * The template for the body cells is written inside it and drawn by the table:
 *
 * ```html
 * <v-table-column label="Status">
 *   <template :slot-cell="{ row }">
 *     <v-badge :tone="row.tone">{ row.status }</v-badge>
 *   </template>
 * </v-table-column>
 * ```
 *
 * With no such template, the column shows `row[field]`.
 */
@Component({ selector: 'v-table-column', templateUrl: './table-column.html' })
export class VTableColumn {
  /** The field of a row this column shows. */
  @Prop() field = new Signal.State<string | undefined>(undefined);
  /** The heading, when it is a line of text; otherwise fill the `header` slot. */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  /** `end` for numbers, `center` where a column is a single mark. */
  @Prop() align = new Signal.State<'start' | 'center' | 'end' | undefined>(undefined);
  /** Any CSS width — `12rem`, `10%` — put on the heading, which sizes the column. */
  @Prop() width = new Signal.State<string | undefined>(undefined);

  /** The `<th>` this draws, which is how the table learns where the column is. */
  head: HTMLElement | null = null;

  /**
   * The table this was written inside.
   *
   * Read while the field initializes, because that is when the column is
   * inside the table's render — a component's fields are built where its tag
   * is, and a column's tag is inside a table's content.
   */
  readonly table: VTable = (() => {
    const table = useContext(TableContext);
    if (!table) {
      throw new Error(
        '[volt] <v-table-column> has to be written inside <v-table>: it has no markup of its ' +
          'own beyond its heading, and its cells are drawn by the table it belongs to.',
      );
    }
    return table;
  })();

  constructor() {
    this.table.columns.add(this);
  }
}
