/**
 * An outlet that draws what was written inside another tag.
 *
 * `<v-table>` and `<v-table-column>` is the shape every component library
 * arrives at, and it is two things at once: the column is a declaration the
 * table collects, and it holds a template the table has to draw somewhere the
 * column is not — in every body cell, once per row.
 *
 * Volt had half of it. A component finds the tag it was written inside through
 * context, so the collecting works. What it could not do was draw the other
 * component's content: a slot outlet always looked in its own component, and
 * an expression that evaluates to nodes is read as text where it stands alone
 * in an element. The only way left was to render the child once per row, which
 * is a component instance per cell.
 *
 * `<slot :from="col" name="cell">` is the missing half, and it costs the
 * runtime nothing: `slot()` already took the component to look in as its first
 * argument, so this is the same call with a different one.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import {
  Component,
  Prop,
  Signal,
  createContext,
  flushSync,
  mount,
  onCleanup,
  provideContext,
  useContext,
} from '@voltdev/core';

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = '';
});

function show<T>(component: new () => T): { instance: T; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mount(component, host);
  unmount = handle.unmount;
  flushSync();
  return { instance: handle.instance as T, host };
}

interface Row {
  id: number;
  name: Signal.State<string>;
}

const TableContext = createContext<Table | null>(null);

/** The parent tag: it owns the shape, and draws what its children were given. */
@Component({
  selector: 'v-table',
  render: compileTemplate(`
    <table>
      <thead><tr><slot></slot></tr></thead>
      <tbody>
        <tr :for="row in rows.get()" :key="row.id">
          <td :for="col in columns.get()" :key="col.field">
            <slot :from="col" name="cell" :row="row">{ row[col.field].get() }</slot>
          </td>
        </tr>
      </tbody>
    </table>
  `),
})
class Table {
  @Prop() rows = new Signal.State<Row[]>([]);
  columns = new Signal.State<Column[]>([]);

  constructor() {
    provideContext(TableContext, this);
  }

  add(column: Column): void {
    this.columns.set([...this.columns.get(), column]);
  }

  drop(column: Column): void {
    this.columns.set(this.columns.get().filter((each) => each !== column));
  }
}

/** The child tag: a declaration that draws its own heading and nothing else. */
@Component({
  selector: 'v-column',
  render: compileTemplate(`<th>{ field }</th>`),
})
class Column {
  @Prop() field = '';
  table = useContext(TableContext);

  constructor() {
    const table = this.table;
    if (table) {
      table.add(this);
      onCleanup(() => table.drop(this));
    }
  }
}

function rows(): Signal.State<Row[]> {
  return new Signal.State<Row[]>([
    { id: 1, name: new Signal.State('Ada') },
    { id: 2, name: new Signal.State('Grace') },
  ]);
}

describe('a tag that draws what was written inside its child', () => {
  it('renders the content once per row, with the row it is for', () => {
    @Component({
      selector: 'v-page',
      imports: [Table, Column],
      render: compileTemplate(`
        <v-table :rows="rows.get()">
          <v-column field="name">
            <template :slot-cell="{ row }"><b>{ row.name.get() }</b></template>
          </v-column>
        </v-table>
      `),
    })
    class Page {
      rows = rows();
    }

    const { host } = show(Page);
    expect([...host.querySelectorAll('tbody b')].map((b) => b.textContent)).toEqual([
      'Ada',
      'Grace',
    ]);
    expect(host.querySelector('th')!.textContent).toBe('name');
  });

  it('falls back to the outlet’s own content where nothing was written', () => {
    @Component({
      selector: 'v-page',
      imports: [Table, Column],
      render: compileTemplate(`
        <v-table :rows="rows.get()"><v-column field="name"></v-column></v-table>
      `),
    })
    class Page {
      rows = rows();
    }

    expect(
      [...show(Page).host.querySelectorAll('tbody td')].map((td) => td.textContent),
    ).toEqual(['Ada', 'Grace']);
  });

  it('follows the row it was handed, without rebuilding the cell', () => {
    @Component({
      selector: 'v-page',
      imports: [Table, Column],
      render: compileTemplate(`
        <v-table :rows="rows.get()">
          <v-column field="name">
            <template :slot-cell="{ row }"><b>{ row.name.get() }</b></template>
          </v-column>
        </v-table>
      `),
    })
    class Page {
      rows = rows();
    }

    const { instance, host } = show(Page);
    const first = host.querySelector('tbody b')!;
    instance.rows.get()[0]!.name.set('ADA');
    flushSync();

    expect(host.querySelector('tbody b')!.textContent).toBe('ADA');
    expect(host.querySelector('tbody b')).toBe(first);
  });

  it('draws a column written after the first render, and stops when it goes', () => {
    @Component({
      selector: 'v-page',
      imports: [Table, Column],
      render: compileTemplate(`
        <v-table :rows="rows.get()">
          <v-column field="name"></v-column>
          <v-column :for="field in extra.get()" :key="field" :field="field">
            <template :slot-cell="{ row }"><i>{ row.id }</i></template>
          </v-column>
        </v-table>
      `),
    })
    class Page {
      rows = rows();
      extra = new Signal.State<string[]>([]);
    }

    const { instance, host } = show(Page);
    expect(host.querySelectorAll('tbody td')).toHaveLength(2);

    instance.extra.set(['id']);
    flushSync();
    expect([...host.querySelectorAll('tbody td')].map((td) => td.textContent)).toEqual([
      'Ada',
      '1',
      'Grace',
      '2',
    ]);

    instance.extra.set([]);
    flushSync();
    expect(host.querySelectorAll('tbody td')).toHaveLength(2);
  });

  it('keeps each column’s content to its own column', () => {
    @Component({
      selector: 'v-page',
      imports: [Table, Column],
      render: compileTemplate(`
        <v-table :rows="rows.get()">
          <v-column field="name">
            <template :slot-cell="{ row }"><b>{ row.name.get() }</b></template>
          </v-column>
          <v-column field="id">
            <template :slot-cell="{ row }"><i>#{ row.id }</i></template>
          </v-column>
        </v-table>
      `),
    })
    class Page {
      rows = rows();
    }

    const { host } = show(Page);
    expect([...host.querySelectorAll('tbody tr')].map((tr) => tr.textContent)).toEqual([
      'Ada#1',
      'Grace#2',
    ]);
  });
});
