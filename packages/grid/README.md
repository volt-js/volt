# @voltdev/grid

A virtualized, keyboard-navigable data grid for Volt. It is headless: it owns
the geometry, the keyboard map and the ARIA, and hands back prop objects to
spread onto markup you write. Nothing in it renders, so the markup and the
stylesheet are yours. Both axes are windowed, and a cell owns its own binding,
so a change to one value rewrites one text node — not the row, not the grid.

```bash
pnpm add @voltdev/grid@alpha
```

> **Not on npm yet.** The command above is what installs it once it is released.
> Until then it works from a checkout of the [Volt repository](https://github.com/volt-js/volt) —
> see [what is on npm](https://voltjs.dev/guide/getting-started#what-is-on-npm).

`@voltdev/core` and `@voltdev/primitives` are peer dependencies: the grid runs
on the application's own copies, so the locale it sorts by and the live region
it announces through are the ones the rest of the page uses.

```ts
// people.ts
import { Component, Signal } from '@voltdev/core';
import { createGrid, type GridColumn } from '@voltdev/grid';

interface Person {
  id: number;
  name: string;
  department: string;
  salary: number;
}

const COLUMNS: GridColumn<Person>[] = [
  { id: 'name', header: 'Name', value: (p) => p.name },
  { id: 'department', header: 'Department', value: (p) => p.department },
  { id: 'salary', header: 'Salary', value: (p) => p.salary, width: 120 },
];

@Component({ selector: 'v-people', templateUrl: './people.html' })
export class People {
  grid = new Signal.State<Element | null>(null);
  scroller = new Signal.State<Element | null>(null);
  container = new Signal.State<Element | null>(null);
  people = new Signal.State<Person[]>([]);

  table = createGrid<Person>({
    grid: () => this.grid.get(),
    scroller: () => this.scroller.get(),
    container: () => this.container.get(),
    rows: () => this.people.get(),
    columns: () => COLUMNS,
    getRowKey: (person) => person.id,
    label: 'People',
  });
}
```

```html
<!-- people.html -->
<div class="people" :ref="grid" :spread="table.gridProps()"
     :keydown="table.onKeyDown($event)"
     :focusin="table.onFocusIn($event)">
  <div :spread="table.headerProps()">
    <div :spread="table.headerRowProps()">
      <div :for="col in table.columns()" :key="col.key"
           :spread="table.headerCellProps(col)"
           :click="table.onHeaderClick($event)">{ col.column.header }
        <span :spread="table.resizerProps(col)"
              :pointerdown="table.onResizePointerDown($event)"></span>
      </div>
    </div>
  </div>
  <div class="people-body" :ref="scroller" :spread="table.bodyProps()">
    <div :spread="table.sizerProps()">
      <div :ref="container" :spread="table.containerProps()">
        <div :for="row in table.rows()" :key="row.key" :spread="table.rowProps(row)">
          <div :for="col in table.columns()" :key="col.key"
               :spread="table.cellProps(row, col)"
               :click="table.onCellClick($event)">{ table.cellValue(row, col) }</div>
        </div>
      </div>
    </div>
  </div>
</div>
```

`createGrid` is the grid — rows, columns, sorting, filtering and two kinds of
selection. `createGrouping` and `createCellEditing` are layers over it rather
than options of it: grouping hands the grid a longer collection with the group
headers in it, and editing hands you a change and never writes a row.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev/reference/grid](https://voltjs.dev/reference/grid)
