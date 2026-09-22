# Data components

Rows, and what draws them.

Each component below is a tag you write, with the primitive that owns its
behaviour named beside it. What is not a tag yet is the markup to write by
hand: the same primitive, the same class names, and the same look — which is
what makes a component here a shortcut rather than a wall.

See [the package](./ui) for the two entries, the stylesheet, the tokens and
how to override a rule.

## `<v-table>` and `<v-table-column>`

A real `<table>`: the row and column relationships a screen reader reads out
are the platform's, not a grid of `<div>`s.

<Demo name="table" height="260" />

```html
<v-table :data="people.get()" :selected="chosen.get()" :striped="true">
  <v-table-column field="name" label="Name"></v-table-column>
  <v-table-column field="role" label="Role"></v-table-column>

  <v-table-column label="Owed" align="end">
    <template :slot-cell="{ row }">{ money(row.owed) }</template>
  </v-table-column>

  <v-table-column label="" align="end">
    <template :slot-cell="{ row }">
      <v-button size="sm" :onPress="() => toggle(row)">Select</v-button>
    </template>
  </v-table-column>
</v-table>
```

A column is a tag because that is where its template belongs: the markup for a
cell is written inside the column that draws it. The table fetches it from
there with [`<slot :from>`](./template-syntax#drawing-what-was-written-inside-another-tag),
which means a column is rendered once — for its heading — and never once per
cell.

| `<v-table>` | Type | Means |
|---|---|---|
| `data` | `readonly Record<string, unknown>[]` | The rows, in the order they are shown |
| `rowKey` | `string` | The field that identifies a row. Default `id` |
| `striped` | `boolean` | Shade every second row |
| `selected` | `ReadonlySet<unknown> \| null` | The keys of the rows an action is about to be taken on |
| `empty` | `string` | Shown in place of the rows when there are none |
| `onRowPress` | `(row, index) => void` | |

| `<v-table-column>` | Type | Means |
|---|---|---|
| `field` | `string` | The field of a row this column shows |
| `label` | `string` | The heading, when it is a line of text |
| `align` | `'start' \| 'center' \| 'end'` | `end` for numbers |
| `width` | `string` | Any CSS width, put on the heading, which sizes the column |

Slots: `cell` is drawn per row and is handed `{ row, value }`; `header` replaces
the label when a heading needs markup. The table's own `empty` slot replaces the
empty message.

Selection is drawn, not owned. What selecting means — one row or many, and what
happens next — is yours; what the table does is mark those rows with
`aria-selected` and a colour a forced palette keeps. Striping and the pointer
are emphasis, and are handed back when the palette is the user's, which leaves
its two surface colours for the row that is actually selected.
