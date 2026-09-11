# Selection primitives

Choosing a value out of a set: an option out of a list, a date out of a month.
Seven primitives in `@voltdev/primitives` do it, and the date arithmetic under
the calendar is exported beside them.

::: warning Not on npm yet
Part of `@voltdev/primitives`, which is not published yet — see
[the overview](./primitives). Everything here works from a checkout of the Volt
repository.
:::

| You want | Use |
|---|---|
| A list of options that is on the page | [`createListbox`](#a-list-on-the-page-createlistbox) |
| A button that shows the value and opens a list | [`createSelect`](#a-button-that-opens-a-list-createselect) |
| A textbox that filters a list, or searches for one | [`createCombobox`](#a-textbox-that-filters-a-list-createcombobox) |
| A month grid | [`createCalendar`](#a-month-grid-createcalendar) |
| A date or a time that is typed | [`createDateField`, `createTimePicker`](#typing-a-date-or-a-time) |
| Both: a typed date with a calendar behind a button | [`createDatePicker`](#a-field-with-a-calendar-behind-it-createdatepicker) |

All of them follow the [package conventions](./primitives#conventions): created
in a field initialiser, elements passed as getters, state read by calling it,
parts spread as prop bags. Three things on this page depart from those, and
none of them fails loudly when it is missed.

- **Some `onKeyDown` methods leave `preventDefault` to you.** The listbox, the
  calendar, the date field, the time picker and the date picker return `true` when
  they consumed a key and do not cancel it themselves, so the handler you bind
  has to — otherwise the arrow that moved the highlight also scrolls the page,
  and Space does too. Select's `onTriggerKeyDown` and combobox's
  `onInputKeyDown` cancel what they consume and return nothing.
- **The date picker's `triggerProps()` and `contentProps()` carry handlers.**
  They are [`createPopover`](./primitives-overlays)'s, with its click and key
  listeners in the bag, so the trigger needs no `:click` of its own — and must
  not have one that calls `open()`: the bag's click already toggles, the second
  listener opens again on the same press, and the button can never close the
  calendar. Every other bag here is attributes only.
- **The locale is the ambient one.** Names, digits, the first day of the week,
  the listbox's typeahead collation and the combobox's filter come from
  `useLocale()`: the nearest
  `createLocaleProvider`, else the document's `lang`, else the browser's. See
  [`createLocaleProvider`](./primitives-data#createlocaleprovider).

## A list on the page: `createListbox`

A list of options the user chooses from, with the list itself on the page. Select
and Combobox are a listbox with something in front of it, but they carry their
own implementation of the popup case — see [below](#what-select-and-combobox-share).
This is the one to use when the list is always visible.

```ts
createListbox<T>(options: ListboxOptions<T>): Listbox<T>
```

```ts
// fruits.ts
import { Component, Signal } from '@voltdev/core';
import { createListbox } from '@voltdev/primitives';

@Component({ selector: 'v-fruits', templateUrl: './fruits.html' })
export class Fruits {
  root = new Signal.State<Element | null>(null);
  items = new Signal.State(['Apple', 'Banana', 'Cherry']);
  list = createListbox<string>({
    listbox: () => this.root.get(),
    items: () => this.items.get(),
    label: 'Fruit',
  });

  onKey(event: KeyboardEvent): void {
    if (this.list.onKeyDown(event)) event.preventDefault();
  }
}
```

```html
<!-- fruits.html -->
<div :ref="root" :spread="list.listboxProps()"
     :keydown="onKey($event)"
     :click="list.onOptionClick($event)">
  <div :for="(item, i) in items.get()" :key="item"
       :spread="list.optionProps({ index: i, value: item })">{ item }</div>
</div>
```

**Every option declares its index.** That is the one demand this primitive
makes, and virtualization is why. A list of ten thousand options has ten of
them in the document, so range selection, `aria-posinset`, paging and typeahead
cannot read position out of it; position is part of the contract instead. The
cost is `index: i` in the loop. The alternative was a second, weaker listbox
for the virtualized case.

**Values are compared by `compareBy`, not by `===`.** A list re-fetched from a
server hands back equal objects with new identities, and a selection held by
identity empties itself without a word. `compareBy` returns what identifies an
option — `item.id`, usually — and it is also the key membership is looked up
by, so `isSelected` is a lookup rather than a scan. Without it, objects compare
by identity, which is right for strings and numbers and wrong the moment the
list is re-fetched.

### Options

| Option | Default | Description |
|---|---|---|
| `listbox` | required | The element with `role="listbox"`; the scroller when virtualized |
| `items` | — | Every option's value, in order. Lets range selection and select-all reach options never rendered |
| `count` | `items().length`, then the options in the DOM | How many options there are. A virtualized listbox needs this or `items` |
| `textValue` | the rendered option's `textValue`, then its text | `(index) => string`, what typeahead matches at a position |
| `isDisabled` | what the rendered option said | `(index) => boolean` |
| `selectionMode` | `'single'` | `'none'`, `'single'`, `'multiple'` or `'extended'` |
| `value` | — | A `Signal.State<readonly T[]>`, to control the selection from outside |
| `defaultValue` | `[]` | The selection to start with |
| `compareBy` | the value itself | `(value) => unknown`, what identifies a value |
| `selectionFollowsFocus` | `true` in `extended`, else `false` | Moving the active option also selects it |
| `disallowEmptySelection` | `false` | Refuse to leave nothing selected once something is |
| `orientation` | `'vertical'` | `'horizontal'` moves on Left and Right, mirrored under RTL |
| `loop` | `false` | Arrow keys wrap past the ends |
| `typeahead` | `true` | Typing letters jumps to a matching option |
| `typeaheadTimeout` | `500` | How long typed characters accumulate, in ms |
| `pageSize` | what the viewport holds, else 10 | Options a page key moves by |
| `virtualFocus` | `false` | Move `aria-activedescendant` instead of DOM focus |
| `focusable` | `true` under virtual focus, else `false` | Put the listbox element itself in the tab order |
| `focusOnHover` | `false` | Moving the pointer over an option makes it active |
| `disabled` | — | `() => boolean`. No navigation and no selection |
| `label` / `labelledBy` | — | The accessible name. A listbox takes none from its options |
| `labels` | the catalogue | `selected(count)`, the live-region text |
| `virtual` | — | Geometry, when virtualized — see [below](#ten-thousand-options) |
| `onSelectionChange` | — | Called with every selected value |
| `onActiveChange` | — | Called with the active index, `-1` for none |

`selectionFollowsFocus` is safe only when selecting has no side effect beyond
the selection. A single-select listbox that loads a page per option becomes
unusable from the keyboard with it on: every arrow press is a page load.

`disallowEmptySelection` refuses the write that would empty a non-empty
selection — `clear()`, deselecting the last value, Ctrl+A on a full list. It
does not choose something for a list that starts empty.

### Selection modes

| Mode | A plain press | Shift + a move |
|---|---|---|
| `none` | Moves only — a list that is read rather than chosen from | Moves |
| `single` | Replaces the one value | Moves |
| `multiple` | Toggles that option, leaving the rest — a filter list | Toggles the option moved to |
| `extended` | Replaces the selection; Ctrl toggles one; Shift takes a range | Extends a range from the anchor |

`multiple` and `extended` differ on Shift because the two patterns do. The APG
multi-select listbox has Shift+Arrow toggle the next option, building a
selection one at a time; an extended list — every desktop file manager —
extends a contiguous range from the last option deliberately chosen.

The selection is one array-shaped signal in every mode, rather than a bare
value for `single` and an array for the rest. Two shapes would fork every
method, and leave `null` and `[]` both meaning nothing is selected. The cost is
that a single-select consumer unwraps a one-element array, which
`selectedValue()` does for them.

### Keyboard

| Key | Does |
|---|---|
| ArrowDown, ArrowUp | Next, previous option — ArrowRight, ArrowLeft when horizontal |
| Home, End | First, last option that can be moved to |
| PageDown, PageUp | `pageSize` options on, stopping at the ends |
| Printable characters | Typeahead, accumulating for `typeaheadTimeout` |
| Enter, Space | Choose the active option — toggle it in `multiple` |
| Ctrl + a move | Move without changing the selection |
| Ctrl + Space | Toggle the active option alone, in `multiple` and `extended` |
| Shift + Space | Select from the anchor to the active option, in `multiple` and `extended` |
| Ctrl + A | Select every option, or clear if all are selected; `multiple` and `extended` only |

Disabled options are skipped by all of these and stay in the accessibility
tree, so they can be found and heard to be unavailable. Alt is never consumed:
it belongs to whatever wraps the listbox.

Typeahead compares with a collator at base sensitivity, so "e" finds "Éclair".
Repeating one character walks through the options starting with it rather than
searching for "eee", which is what a native listbox does. A capital letter is a
search, never a Shift range.

A listbox is entered on the option already selected, not on the first one. The
APG asks for it, and a list showing "Cherry" whose tab stop is on "Apple" makes
the reader walk back to where they were. With nothing selected, it falls back
to the first option.

The key map is this primitive's own rather than
[`createRovingFocus`](./primitives#roving-focus-createrovingfocus)'s. Roving focus moves between elements it
can find in the document, and the option Shift+End extends to may not exist
yet. Movement here is arithmetic over indices, and roving focus is used only to
put DOM focus on the option the arithmetic chose.

### Members

| Member | Description |
|---|---|
| `selectedValues()` | Every selected value, in the order it was selected |
| `selectedValue()` | The first, which is the only one in `single`, or `null` |
| `isSelected(value)` | Membership, by `compareBy` |
| `count()` | How many options there are, rendered or not |
| `activeIndex()` / `activeValue()` | The option the keyboard acts on; `-1` / `undefined` for none |
| `activeOption()` | Its element, or `null` when it is not rendered |
| `select(v)`, `deselect(v)`, `toggle(v)` | Change the selection from code |
| `selectAll()` | Every enabled option with a known value; `multiple` and `extended` only |
| `clear()` | Nothing selected, unless `disallowEmptySelection` refuses |
| `focusIndex(i)`, `focusFirst()`, `focusLast()` | Make an option active and scroll it into view |
| `onKeyDown(event)` | Returns `true` when it consumed the key |
| `onOptionClick(event)` | Bind to `click` on the listbox. Where several may be chosen, Ctrl toggles, Shift takes a range, and Ctrl+Shift adds a second range |
| `onOptionPointerMove(event)` | Bind to `pointermove`. Does nothing unless `focusOnHover` |
| `listboxProps()` | For the listbox element |
| `optionProps({ index, value?, disabled?, textValue? })` | For each option. `value` may be left out only when `items` was given |
| `groupProps(key)` / `groupLabelProps(key)` | A section and its heading. `key` is yours and only has to be stable |
| `activeDescendantProps()` | `aria-activedescendant`, for whatever holds focus under virtual focus |
| `status()` / `statusProps()` | A selection count for a live region you render — see below |

An option whose value is unknown — never rendered, and no `items` to ask — is
skipped by range selection and select-all rather than put into the selection
as `undefined`.

A group is named by its heading only while `groupLabelProps` is being rendered.
A group whose heading sits behind an `:if` loses the reference when the heading
goes, because a dangling `aria-labelledby` hides a missing name rather than
reporting it.

`status()` says "3 selected" for a multi-select list and nothing for a single
one, where the option that was chosen has already been announced. Nothing renders
the region for you: it is worth it where one press changes several options — a
range, select-all — and is noise otherwise.

### Virtual focus

`virtualFocus: true` leaves DOM focus where it is and moves an
`aria-activedescendant` instead. Anything that must not steal focus needs it —
a list driven from a text input, a list inside a dialog where moving focus
would disturb something else. Spread `activeDescendantProps()` onto the element
that holds focus, and set `focusable: false` when that element is not the
listbox.

The attribute names only an option that is rendered. An id that left with a
virtualized window would leave the reader with no virtual cursor and no way to
tell, so the attribute is dropped instead until the option is back.

### Ten thousand options

With `virtual`, the listbox composes
[`createVirtualizer`](./primitives-collections) and puts back by hand the two
things virtualization takes from assistive technology: `aria-setsize` and
`aria-posinset`, so an option announces as "7 of 10,000" rather than as "7 of
12", the size of the window that happens to be rendered.

```ts
// customers.ts
import { Component, Signal } from '@voltdev/core';
import { createListbox } from '@voltdev/primitives';

interface Customer { id: string; name: string }

@Component({ selector: 'v-customers', templateUrl: './customers.html' })
export class Customers {
  root = new Signal.State<Element | null>(null);
  box = new Signal.State<Element | null>(null);
  rows = new Signal.State<readonly Customer[]>([]);
  list = createListbox<Customer>({
    listbox: () => this.root.get(),
    items: () => this.rows.get(),
    compareBy: (row) => row.id,
    // Typeahead can only read text for options it can see, unless told.
    textValue: (index) => this.rows.get()[index]?.name ?? '',
    virtual: { container: () => this.box.get(), itemSize: 32 },
    label: 'Customers',
  });

  nameAt(index: number): string {
    return this.rows.get()[index]?.name ?? '';
  }

  onKey(event: KeyboardEvent): void {
    if (this.list.onKeyDown(event)) event.preventDefault();
  }
}
```

```html
<!-- customers.html -->
<div :ref="root" :spread="list.listboxProps()" :keydown="onKey($event)"
     :click="list.onOptionClick($event)">
  <div :spread="list.sizerProps()">
    <div :ref="box" :spread="list.containerProps()">
      <div :for="v in list.virtualItems()" :key="v.key"
           :spread="list.optionProps({ index: v.index })">{ nameAt(v.index) }</div>
    </div>
  </div>
</div>
```

| `virtual` option | Description |
|---|---|
| `container` | The element the rendered window lives in — where `containerProps()` goes |
| `itemSize` | A number promises every option is exactly that tall; a function is an estimate and turns measurement on |
| `measure` | Measure rendered options and correct the estimate |
| `gap` | Space between options, in px. Part of the arithmetic, not of the layout |
| `overscan` | Default 2 each way |
| `getItemKey` | What identifies an option, so measurements survive the list growing at the front |
| `onRangeChange` | The rendered window moved — where an infinite list loads its next page |

| Member | Description |
|---|---|
| `virtualItems()` | The window to render; empty when not virtualized |
| `sizerProps()` / `containerProps()` | The full-length sizer and the window inside it, both `role="presentation"` so the scaffolding adds nothing to the accessibility tree |
| `scrollToIndex(index, options?)` | Bring an option into view |

What it costs: outside the window, typeahead and disabled-skipping know only
what `textValue` and `isDisabled` tell them. Without those, an option that has
never been rendered has no text to match and is taken to be enabled. A tab stop
never sits on an option outside the window — it moves to the nearest rendered
one — because an element that does not exist cannot be tabbed to.

## A list behind a control

Select and Combobox share one implementation, because they differ by less than
they share: a popup listbox, a set of chosen values, virtual focus over the
options, a real form control behind the scenes, and the same announcements.
What separates them is the element the user operates — a button showing the
value, which jumps by typeahead, or a textbox, which filters instead.

Neither uses `createListbox`. Their options are keyed by a string `value`
rather than by index, and exist only while the popup does.

### A button that opens a list: `createSelect`

```ts
createSelect(options: SelectOptions): Select
```

```ts
// country.ts
import { Component, Signal } from '@voltdev/core';
import { createSelect } from '@voltdev/primitives';

@Component({ selector: 'v-country', templateUrl: './country.html' })
export class Country {
  label = new Signal.State<Element | null>(null);
  trigger = new Signal.State<Element | null>(null);
  list = new Signal.State<Element | null>(null);
  native = new Signal.State<Element | null>(null);
  countries = [
    { code: 'fr', name: 'France' },
    { code: 'jp', name: 'Japan' },
  ];
  select = createSelect({
    trigger: () => this.trigger.get(),
    listbox: () => this.list.get(),
    native: () => this.native.get(),
    name: 'country',
    field: { label: () => this.label.get() },
  });
}
```

```html
<!-- country.html -->
<label :ref="label" :spread="select.field.labelProps()">Country</label>

<select :ref="native" :spread="select.nativeProps()">
  <option value=""></option>
  <option :for="c of countries" :key="c.code"
          :spread="select.nativeOptionProps({ value: c.code })">{ c.name }</option>
</select>

<button :ref="trigger" :spread="select.triggerProps()"
        :click="select.onTriggerClick()"
        :keydown="select.onTriggerKeyDown($event)"
        :blur="select.onTriggerBlur()">{ select.displayValue() }</button>

<div :if="select.isPresent()" :portal :ref="list"
     :spread="select.listboxProps()"
     :click="select.onOptionClick($event)"
     :pointerdown="select.onListboxPointerDown($event)"
     :pointermove="select.onOptionPointerMove($event)">
  <div :for="c of countries" :key="c.code"
       :spread="select.optionProps({ value: c.code })">{ c.name }</div>
</div>

<p :spread="select.statusProps()">{ select.status() }</p>
```

The trigger carries `role="combobox"` rather than staying a button, which is the
APG select-only pattern. It is the element that owns `aria-expanded`,
`aria-controls` and `aria-activedescendant`, and a button role cannot carry the
last of those. Render it as a `<button>` all the same: the role is overridden,
a button's behaviour is not. `triggerProps()` also says `type="button"`, since
a button in a form submits it otherwise.

| State | Key | Does |
|---|---|---|
| Closed | Enter, Space, ArrowDown, ArrowUp | Open, on the selected option |
| | Alt+ArrowDown, Alt+ArrowUp | Open with nothing highlighted |
| | Home, End | Open on the first, last option |
| | Printable characters | Choose the match without opening |
| Open | ArrowDown, ArrowUp | Next, previous option |
| | Home, End | First, last |
| | PageDown, PageUp | Ten options on |
| | Enter, Space, Alt+ArrowUp | Choose the highlighted option, close |
| | Tab | Choose it, close, and let Tab carry on out |
| | Escape | Close, value unchanged |
| | Printable characters | Move to the match |

Typeahead on a closed trigger reads the native `<select>`: its options are real,
in document order, with the disabled ones already skipped. Without a native
control there is nothing to search while the popup is closed, so the first
character only opens it — on the selected option, or the first — and the
highlight moves to a match from the second character on, the first still
counted if it came inside `typeaheadTimeout`. In the example above without its
`<select>`, "j" opens the list on France; with it, "j" chooses Japan and
nothing opens. A space in the middle of a typed run is part of the search —
"New " is how you get past "New York" to "New Zealand".

Select's typeahead is not the listbox's. It goes through
[`createCollection`](./primitives#collection-createcollection)'s match, which
compares lower-cased prefixes with no collator, so it is accent-sensitive: "e"
finds "Eclair" but not "Éclair". Nothing in its options changes that, and the
text it matches on a closed select is the native `<option>`'s, which is also
the name the trigger shows.

| Member only Select has | Description |
|---|---|
| `triggerProps()` | For the button |
| `onTriggerClick()` | Bind to `click`. Opens on the selected option, or closes |
| `onTriggerKeyDown(event)` | Bind to `keydown`. Cancels what it consumes |
| `onTriggerBlur()` | Bind to `blur`. Marks the field touched, for validation that waits for it |

### A textbox that filters a list: `createCombobox`

```ts
createCombobox<T = unknown>(options: ComboboxOptions<T>): Combobox<T>
```

```ts
// fruit.ts
import { Component, Signal } from '@voltdev/core';
import { createCombobox } from '@voltdev/primitives';

@Component({ selector: 'v-fruit', templateUrl: './fruit.html' })
export class Fruit {
  label = new Signal.State<Element | null>(null);
  input = new Signal.State<Element | null>(null);
  list = new Signal.State<Element | null>(null);
  native = new Signal.State<Element | null>(null);
  fruits = ['Apple', 'Banana', 'Cherry', 'Damson'];
  combo = createCombobox({
    input: () => this.input.get(),
    listbox: () => this.list.get(),
    native: () => this.native.get(),
    name: 'fruit',
    field: { label: () => this.label.get() },
  });

  visible(): string[] {
    return this.fruits.filter((fruit) => this.combo.matches(fruit));
  }
}
```

```html
<!-- fruit.html -->
<label :ref="label" :spread="combo.field.labelProps()">Fruit</label>
<input :ref="input" :spread="combo.inputProps()"
       :input="combo.onInput($event)"
       :keydown="combo.onInputKeyDown($event)"
       :click="combo.onInputClick()"
       :blur="combo.onInputBlur()" />
<input :ref="native" :spread="combo.nativeProps()" />

<div :if="combo.isPresent()" :portal :ref="list"
     :spread="combo.listboxProps()"
     :click="combo.onOptionClick($event)"
     :pointerdown="combo.onListboxPointerDown($event)"
     :pointermove="combo.onOptionPointerMove($event)">
  <div :for="f of visible()" :key="f"
       :spread="combo.optionProps({ value: f })">{ f }</div>
  <div :if="combo.isEmpty()">{ combo.emptyMessage() }</div>
</div>

<p :spread="combo.statusProps()">{ combo.status() }</p>
```

The filtering is yours: `matches(text)` answers whether an option survives what
has been typed, and the template decides what to render. That is what lets the
list come from anywhere — a constant, a store, a search — without the combobox
holding a copy of it.

The label goes through `field`, which hands it to
[`createFormField`](./primitives-forms): `labelProps()` points the `<label>` at
the textbox, so a press on the words focuses the control the user operates
rather than the hidden one, and the popup is named by the same element.

DOM focus stays in the textbox for the whole interaction. That is the defining
constraint of the pattern — typing has to keep working — and virtual focus, no
focus trap, and a popup that cancels the pointer press landing on it all follow
from it. The textbox's value is written by the combobox rather than bound: it
completes it, reverts it and clears it, and a `:value` binding beside that
would be two writers for one string.

| Key | Does |
|---|---|
| ArrowDown | Open with the first option highlighted; then move on |
| Alt+ArrowDown | Open with nothing highlighted |
| ArrowUp | Open with the last option highlighted; then move back |
| Alt+ArrowUp | Close, keeping what is typed |
| PageDown, PageUp | Ten options on, while open |
| Enter | Take the highlighted option; else the typed text, with `allowCustomValue`; else leave the key to the form |
| Escape | Close the popup; once it is closed, clear the text |
| Tab | Take the highlighted option, close, and let Tab carry on out |
| Backspace | In an empty box of a `multiple`, remove the last chip |
| Home, End | Left alone — in a textbox they belong to the caret |
| Printable characters | Filter, and open if closed |

**Escape goes in two stages, popup first.** The APG is explicit, and the
visible layer is what the user is addressing: the other order clears text they
can still see under a list they wanted rid of. The second stage empties a
single-value combobox's value as well as its text, because a box showing
nothing holds nothing; a `multiple` keeps its chips. Inside a dialog, the second
stage is claimed before the dialog hears the press, so emptying the box does not
also close the dialog.

Enter with nothing highlighted and nothing to commit is left alone on purpose.
Swallowing it is how a combobox stops a one-field form from ever submitting.

When focus leaves, the box goes back to naming the value it holds — anything
still typed there is not a value, and leaving it would show text the form does
not hold. With `allowCustomValue`, a single-value combobox first commits what
was typed — the typed text, even over a highlighted option; see
[where it falls short](#where-it-falls-short).

| Option only Combobox has | Default | Description |
|---|---|---|
| `input` | required | The textbox |
| `autocomplete` | `'list'` | `'list'` filters; `'both'` also completes the text inline; `'none'` shows every option however much is typed |
| `allowCustomValue` | `false` | Commit the typed text as the value — on Enter when nothing is highlighted, and on blur in a single-value combobox. It is not checked against the options; see [below](#where-it-falls-short) |
| `filter` | case- and accent-insensitive substring, in the locale | `(text, query) => boolean`, what `matches` asks |
| `search` | — | Fetch the options for a query, through `createResource` |
| `searchDebounce` | `250` | Quiet time before a changed query is sent, in ms |
| `searchRetry` | `0` | Retries after a failed search |
| `minLength` | `1` | Characters before a search goes out at all |
| `onInputValueChange` | — | Called with the text as it changes |

`allowCustomValue` is off because a combobox that quietly accepts anything is a
text field with a list beside it, and the caller has to be able to say which of
the two they meant. Typed text that names a value already held is refused even
with it on, since taking it would replace an option's identifier with its
label behind the form's back.

`autocomplete: 'both'` looks at the first enabled option rendered, and only
that one: when its text starts with what was typed, the box is completed to it,
the part not typed is selected, and that option becomes the one Enter takes.
It does not search further down the list, so in an alphabetical list with the
default substring filter, typing "na" puts "Banana" ahead of "Nashi pear" and
completes nothing. Filter by prefix, or render prefix matches first, when
completion matters. It completes after an insertion and never after a deletion —
completing after Backspace puts the deleted characters straight back, and the
field could never be emptied.

| Member only Combobox has | Description |
|---|---|
| `search` | The resource behind the `search` option, or `null` |
| `inputValue()` | What the box says: the question typed, or the name of the value held |
| `setInputValue(text)` | Put text in the box from outside. It stands as a question, so `search` is asked |
| `isFiltering()` | Whether typed text is narrowing the list — false again once a choice has answered it |
| `matches(text)` | Whether an option's text survives the current filter |
| `items()` | The last results from `search`, or `[]` |
| `isLoading()` | A search is in flight. False during the debounce, before the request has gone out — `status()` already says loading then |
| `commitCustomValue()` | Take the typed text as the value. Does nothing without `allowCustomValue` |
| `inputProps()` | For the textbox. Turns the browser's autocomplete and spellcheck off |
| `onInput`, `onInputKeyDown`, `onInputClick`, `onInputBlur` | Bind to the textbox |
| `toggleProps()`, `onToggleClick()`, `onTogglePointerDown(event)` | A button beside the box that opens the popup |
| `chipsProps()`, `chipProps(v)`, `removeChipProps(v)` | The chips of a `multiple` |

The toggle needs `onTogglePointerDown` on its `pointerdown` as well as
`onToggleClick` on its `click`. Without the first, the press takes focus out of
the textbox, the blur closes the popup, and the click opens it again: a button
that can never close anything.

#### Searching

`search` is handed to [`createResource`](./primitives-data#createresource), which is what stops a
slow answer to an old query landing on a new one. It is asked with the query as
the request's `source`; render the options from `items()`.

```ts
// city-field.ts
import { Component, Signal } from '@voltdev/core';
import { createCombobox } from '@voltdev/primitives';

interface City { id: string; name: string }

@Component({ selector: 'v-city-field', templateUrl: './city-field.html' })
export class CityField {
  input = new Signal.State<Element | null>(null);
  list = new Signal.State<Element | null>(null);
  combo = createCombobox<City>({
    input: () => this.input.get(),
    listbox: () => this.list.get(),
    search: async ({ source, signal }) => {
      const res = await fetch(`/api/cities?q=${encodeURIComponent(source)}`, { signal });
      return (await res.json()) as City[];
    },
    minLength: 2,
  });
}
```

```html
<div :for="city of combo.items()" :key="city.id"
     :spread="combo.optionProps({ value: city.id })">{ city.name }</div>
```

What is searched for is the question typed, never the box. The text the
combobox writes to name the value it holds is an answer, and searching for it
would mean a request at mount for a value nobody typed and another after every
choice. `minLength: 0` makes the empty box a question too, so a request for
`''` goes out as soon as the component mounts, before anyone has opened the
popup — even when the box is showing the name of a value already held. That is
how a caller loads every option up front. Each query typed after that is still
its own request; the answer to `''` is not narrowed locally for you.

`isEmpty()` and `status()` stay off "No results" until the list has caught up
with the box, including the debounce window before a request has even gone
out. A list that has not been asked is not a list that came back with nothing,
and a popup that flashed "No results" between every keystroke and its answer
would be saying something untrue.

#### Several values, as chips

```ts
// toppings.ts
import { Component, Signal } from '@voltdev/core';
import { createCombobox } from '@voltdev/primitives';

@Component({ selector: 'v-toppings', templateUrl: './toppings.html' })
export class Toppings {
  wrapper = new Signal.State<Element | null>(null);
  input = new Signal.State<Element | null>(null);
  list = new Signal.State<Element | null>(null);
  native = new Signal.State<Element | null>(null);
  combo = createCombobox({
    input: () => this.input.get(),
    listbox: () => this.list.get(),
    native: () => this.native.get(),
    anchor: () => this.wrapper.get(),
    multiple: true,
    name: 'topping',
  });
}
```

```html
<!-- toppings.html -->
<div :ref="wrapper" :spread="combo.anchorProps()">
  <ul :spread="combo.chipsProps()">
    <li :for="v of combo.values()" :key="v" :spread="combo.chipProps(v)">
      { combo.labelOf(v) }
      <button :spread="combo.removeChipProps(v)" :click="combo.deselect(v)">×</button>
    </li>
  </ul>
  <input :ref="input" :spread="combo.inputProps()"
         :input="combo.onInput($event)"
         :keydown="combo.onInputKeyDown($event)"
         :click="combo.onInputClick()"
         :blur="combo.onInputBlur()" />
</div>

<select :ref="native" :spread="combo.nativeProps()">
  <option :for="v of combo.values()" :key="v"
          :spread="combo.nativeOptionProps({ value: v })">{ combo.labelOf(v) }</option>
</select>
```

`anchor` moves the popup's alignment off the textbox and onto the field
wrapper, so it spans the chips as well. Supplying it takes `anchorProps()` off
the control, and you spread it on the wrapper yourself.

Each remove button is its own tab stop. A roving tabindex over the chips would
be one more keyboard pattern to discover, and Backspace from the textbox
already removes the one added last. The box empties after each choice, so the
list is not left narrowed to the chip it has taken.

### What Select and Combobox share

| Option | Default | Description |
|---|---|---|
| `listbox` | required | The popup listbox element |
| `native` | — | The visually hidden `<select>` or `<input>` that submits and validates |
| `anchor` | the control | What the popup lines up with, when it is not the trigger or the textbox |
| `open` / `defaultOpen` | owned, `false` | A `Signal.State<boolean>` to control the popup |
| `value` / `defaultValue` | owned, `[]` | The value — always a list; `defaultValue` also takes one string |
| `multiple` | `false` | More than one value at a time |
| `name` | — | Submitted as `name=value`. Without one the native control submits nothing |
| `labelFor` | — | `(value) => string \| undefined`, text for a value nothing has rendered |
| `disabled` | — | Blocks opening and choosing; written through to the native control |
| `readOnly` | — | Blocks choosing but not opening, so the values can still be read |
| `required` | — | Written through to the native control, so the platform enforces it |
| `placement` | `'bottom-start'` | Which side of the anchor the popup sits on |
| `offset` | — | The gap between anchor and popup. A number is pixels |
| `flip` | `true` | Let the browser flip it when it would overflow |
| `loop` | `false` | Arrow keys wrap past the ends |
| `closeOnSelect` | `true`, `false` when `multiple` | Choosing closes the popup |
| `closeOnEscape` | `true` | |
| `closeOnOutsidePointer` | `true` | |
| `typeaheadTimeout` | `500` | In ms. Select only: a combobox's typing filters rather than jumps, and never reads it |
| `field` | — | The label, description, error element and validation, handed to [`createFormField`](./primitives-forms) |
| `labels` | the catalogue | Every user-visible string — see [labels](#labels-for-select-and-combobox) |
| `onOpenChange` / `onValueChange` | — | |

The value is a list even for a single select: one shape means one code path,
and `value()` returns the first entry for the common case.

| Member | Description |
|---|---|
| `field` / `anchor` | The form field and the anchor this composes |
| `isOpen()` / `isPresent()` / `state()` | Logically open; still in the DOM during an exit animation; `'open'` or `'closed'` |
| `value()` / `values()` / `hasValue()` | The first value or `null`; every value, in the order chosen |
| `isSelected(v)` | Membership |
| `labelOf(v)` | The text last seen for a value, falling back to the value itself |
| `displayValue()` | Every chosen label, joined the way the locale joins a list |
| `activeValue()` / `activeOption()` / `setActiveValue(v)` | Virtual focus, as a value and as an element |
| `optionCount()` / `isEmpty()` | How many enabled options are showing — disabled ones are left out of the count and so out of "n results available"; open, settled, and showing nothing |
| `status()` / `emptyMessage()` | What the live region says now; the empty text, for the popup too |
| `open(focus?)` / `close()` / `toggle()` | `focus` is `'selected'` (default), `'first'`, `'last'` or `'none'` |
| `select(v)`, `deselect(v)`, `toggleValue(v)`, `clear()` | Change the value from code. Refused while disabled or read-only |
| `onOptionClick`, `onOptionPointerMove`, `onListboxPointerDown` | Bind to the popup |
| `listboxProps()` | The popup |
| `optionProps({ value, disabled?, textValue? })` | Each option |
| `groupProps(label)` / `groupLabelProps()` / `separatorProps()` | Grouping. The group is named by its `aria-label`; the visible heading is hidden so it is not read twice |
| `nativeProps()` / `nativeOptionProps(option)` | The hidden form control |
| `statusProps()` | The polite live region |
| `anchorProps()` | For the element named by `anchor` |
| `clearProps()` | A button that empties the value — bind its `click` to `clear()`. Out of the tab order, since Escape and Backspace already do it from the control |

A press on an option does what the widget holds suggests: a `multiple` toggles,
because the same gesture is how a chip comes off again; a single takes, because
pressing the option already held is not a request to hold none, and a native
select does not answer it that way either.

`textValue` is for when the visible text is not what anyone would type — a
label leading with an icon's alt text, or trailing a badge. Select's typeahead
and the combobox's inline completion match on it, and it is the name filed for
the value once seen, so it is what the textbox, the chips and `displayValue()`
show after a choice (a Select's native `<option>` text outranks it). It does
not reach filtering: `matches(text)` tests whatever string you hand it, so hand
it the same one.

#### A real form control behind it

A widget made of `<div>`s submits nothing and validates nothing, and is
invisible to `FormData`, to `form.reset()` and to the browser's own
required-field handling. So you render a visually hidden `<select>` or
`<input>`, and the primitive keeps it in step; `nativeProps()` hides it from
sight, from Tab and from assistive technology, since the visible control
already carries the role and announcing both would announce the widget twice.

One value goes behind either element. Several can only go behind a `<select
multiple>`, rendered with one option per chosen value as in the chips example
above: an `<input>` holds one string. A `multiple` widget backed by an
`<input>` leaves it **empty** rather than giving it the first value, because a
form that receives one of three things chosen is wrong in a way nobody sees in
the payload, while an empty one fails the required check and says so.

For a select, the native options pay for themselves twice: they are what
typeahead reads while the popup is closed, and where labels come from when
nothing else is rendered. A required `<select>` needs an empty first option, or
the browser selects the first real one and the field can never be missing.

A form reset puts the widget back on `defaultValue`, and writes the native
control again even when that value did not move — the platform has already
blanked the element, and a widget that trusted "nothing changed" would go on
reporting a value the form no longer submits. It is `defaultValue` and nothing
else: a widget controlled through `value` alone is reset to empty, and the
empty list is written into your signal, since the signal's starting value was
never recorded. Pass both when a reset should restore something.

`required`, `disabled` and `readOnly` are written to the native control as
properties on every change, whether or not you passed them, so a `required`
attribute in your own markup on the hidden `<select>` is overwritten with
`false` on the first run. Say it through the `required` option.

#### Naming a value nothing has rendered

A select reads labels off its native `<select>`, which has an `<option>` per
value whether or not the popup has opened. A combobox has no such list: its
native control is an `<input>`, and its options exist only while the popup does.

So a combobox handed a value it has not seen rendered holds something it cannot
yet name, and its textbox stays **empty** until it can — from the text the page
was server-rendered with, from `labelFor`, or from the first option that
renders, whichever comes first. It fills in by itself at that moment. Empty
rather than the identifier, because a textbox holds text somebody could have
typed; it is filtered on, searched for and, with `allowCustomValue`,
committed, and an internal token in it would be the component claiming the
user typed something they never saw. The value is held, submitted and reported
by `value()` the whole time.

Supply `labelFor` and there is nothing to leave empty. It is read whenever a
name is wanted, so a catalogue that arrives late names everything the moment it
does, and it ranks lowest: text an option was really seen to carry wins over a
promise about the data.

#### What is announced

`status()` carries the result count, the empty message and — for a search — the
loading message and the search's error message, into one polite region. **Render
the region whether or not it has anything to say.** A live region announces
changes inside a region that was already there; one that appears together with
its message announces nothing.

#### Labels for Select and Combobox

Each label falls back to the locale's catalogue, then to English, so a
translated catalogue has translated these too.

| Label | Catalogue key | English |
|---|---|---|
| `listbox` | `suggestions` | Suggestions. Used only when `field.label` names no element |
| `empty` | `noResults` | No results |
| `loading` | `loading` | Loading… |
| `results(count)` | `resultsAvailable` | "1 result available", "n results available" |
| `toggle` | `showSuggestions` | Show suggestions |
| `remove(label)` | `remove`, followed by the label | Remove {label} |
| `selected(count)` | `selected` | n selected — names the chip list, through `chipsProps()` |
| `clear` | `clear` | Clear — see [below](#where-it-falls-short) |

`suggestions`, `resultsAvailable` and `showSuggestions` are not in the default
catalogue; a catalogue that adds them is read. The `remove` key is followed by
the label rather than containing it, so a language that puts the object first
needs `labels.remove`.

## Dates are plain records

```ts
interface PlainDateValue {
  readonly year: number;
  readonly month: number; // 1–12
  readonly day: number;   // 1–31
}

interface PlainTimeValue {
  readonly hour: number;   // 0–23
  readonly minute: number;
  readonly second: number;
}

interface DateRange {
  readonly start: PlainDateValue; // never after end
  readonly end: PlainDateValue;
}
```

A date here is `{ year, month, day }`: no time, no zone, which is what a
calendar actually selects. Two alternatives were turned down.

**Not `Date`.** A `Date` is an instant, not a day. Its month overflows —
January 31 plus a month is March 3 — its local midnight drifts with the
runtime's zone, its setters mutate, and its months count from zero, which
nobody reading `month: 3` expects. None of it appears here; `month` runs 1–12.
The only clock reading is `Date.now()` inside `today()`, turned into a civil
date through `Intl` rather than through `Date`'s local getters.

**Not `Temporal`, but shaped like it.** `Temporal` is the right answer to date
arithmetic, and this package cannot assume every browser it supports has it. So
the record is exactly the readable surface of a `Temporal.PlainDate`: a caller
holding one passes it straight in, and `Temporal.PlainDate.from(value)` takes
one back out. That is the whole interop, and it needs no shim. Everything
underneath routes through a day number — `toEpochDay` and `fromEpochDay`,
Howard Hinnant's civil-date algorithms — so that is the seam a move to
`Temporal` would replace.

### Arithmetic

All pure, all exported, proleptic Gregorian.

| Function | Returns |
|---|---|
| `isLeapYear(year)` | The Gregorian rule: 1900 is not, 2000 is |
| `daysInMonth(year, month)` | 28 to 31. `month` is 1–12 |
| `toEpochDay(date)` / `fromEpochDay(n)` | Days since 1970-01-01, and back |
| `dayOfWeek(date)` | ISO weekday: 1 is Monday, 7 is Sunday |
| `addDays(date, n)` | |
| `addMonths(date, n)` | Clamps the day: January 31 plus a month is February 28 |
| `addYears(date, n)` | February 29 plus a year is February 28 |
| `compareDates(a, b)` | Negative when `a` is earlier, zero on the same day |
| `isSameDate(a, b)` | Either may be `null`, which is never the same as anything |
| `clampDate(date, min?, max?)` | The date, or the bound it crossed |
| `toIsoDate(date)` | `YYYY-MM-DD` — what the day cells carry and what a form posts |
| `parseIsoDate(text)` | A date, or `null` for anything else, including a day the month does not have |
| `firstDayOfWeek(locale)` | The locale's first day of the week, as an ISO weekday |
| `today(timeZone?)` | Today in that IANA zone, or in the runtime's. A zone name `Intl` does not know throws a `RangeError` |

`addMonths` clamps because PageDown from the last day of a long month has to
land inside the next month, not skip into the one after — which is what
`Date#setMonth` does. It matches `Temporal`'s default `constrain` overflow.

`parseIsoDate` returns `null` rather than throwing because what it reads came
from an attribute, a query string or a server, and a page that stops rendering
over a malformed date is a worse failure than a picker that starts empty.

`dayOfWeek` is ISO rather than `Date`'s Sunday-is-zero because the locale's
week info reports its first day on the ISO scale, and the two have to be
subtractable.

```ts
import { addMonths, compareDates, parseIsoDate, toIsoDate } from '@voltdev/primitives';

const start = parseIsoDate('2024-01-31');
if (start) {
  const next = addMonths(start, 1);
  toIsoDate(next);                // '2024-02-29'
  compareDates(start, next) < 0;  // true
}
```

## A month grid: `createCalendar`

```ts
createCalendar(options: CalendarOptions): Calendar
```

```ts
// arrival.ts
import { Component, Signal } from '@voltdev/core';
import { createCalendar } from '@voltdev/primitives';

@Component({ selector: 'v-arrival', templateUrl: './arrival.html' })
export class Arrival {
  root = new Signal.State<Element | null>(null);
  cal = createCalendar({ calendar: () => this.root.get(), label: 'Arrival' });

  onKey(event: KeyboardEvent): void {
    if (this.cal.onKeyDown(event)) event.preventDefault();
  }
}
```

```html
<!-- arrival.html -->
<div :ref="root" :spread="cal.calendarProps()"
     :keydown="onKey($event)" :click="cal.onDayClick($event)">
  <button :spread="cal.previousMonthProps()" :click="cal.previousMonth()">‹</button>
  <button :spread="cal.nextMonthProps()" :click="cal.nextMonth()">›</button>
  <div :for="month in cal.months()" :key="month.index">
    <h2 :spread="cal.headingProps(month.index)">{ month.label }</h2>
    <table :spread="cal.gridProps(month.index)">
      <thead>
        <tr :spread="cal.rowProps()">
          <th :for="d in cal.weekdays()" :key="d.dayOfWeek"
              :spread="cal.weekdayProps(d)">{ d.short }</th>
        </tr>
      </thead>
      <tbody>
        <tr :for="week in month.weeks" :key="week.key" :spread="cal.rowProps()">
          <td :for="day in week.days" :key="day.key"
              :spread="cal.dayProps(day)">{ day.date.day }</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

### What comes from the locale

Everything the primitive writes. The first day of the week comes from the
locale's week info — Monday in most of Europe, Sunday in the United States and
Japan, Saturday across much of the Arabic-speaking world — and the columns are
laid out in that order. Guessing any one of them is wrong for most people,
which is why it is read rather than configured. The month and weekday names
come from `Intl.DateTimeFormat`, and the digits in `month.label` and in every
cell's accessible name follow the locale's numbering system, so an `ar-SA`
month heading is written in Arabic-Indic numerals.

The number printed inside each cell is yours, and is not localised for you.
`CalendarDay` carries `date.day` as a plain number, so `{ day.date.day }`
prints Western digits in every locale. Where that matters, print
`useLocale().format.number(day.date.day)` instead. A screen reader hears the
locale's digits either way, because it reads the cell's `aria-label`.

The `firstDayOfWeek` option exists for calendars that are contractually ISO — a
timesheet, a sprint board — not for the common case. A runtime whose
`Intl.Locale` has no week info falls back to Monday.

**The grid is Gregorian even where the locale's calendar is not.** `ar-SA`
resolves to the Umm al-Qura calendar, and formatting a Gregorian grid with a
Hijri formatter produces a heading that names one month over cells belonging to
another. So every formatter pins `calendar: 'gregory'`, the only honest label
for the grid the arithmetic built. The numbering system still follows the
locale.

### Options

| Option | Default | Description |
|---|---|---|
| `calendar` | required | Wraps every visible month. Direction is read from it, and cells are found beneath it |
| `mode` | `'single'` | `'range'` takes two presses and reports an interval |
| `value` / `defaultValue` | owned, `null` | The selected date, in single mode |
| `range` / `defaultRange` | owned, `null` | The selected interval, in range mode |
| `focusedDate` / `defaultFocusedDate` | the selection, else today, clamped to the bounds | The date holding the grid's tab stop |
| `today` | the runtime clock | `() => PlainDateValue`, what counts as today |
| `min` / `max` | — | `() => PlainDateValue \| null \| undefined` |
| `isDateDisabled` | — | `(date) => boolean`, dates inside the bounds that still cannot be chosen |
| `visibleMonths` | `1` | Months laid out side by side |
| `firstDayOfWeek` | the locale's | An ISO weekday, to override it |
| `fixedWeeks` | `false` | Always six rows, so the grid does not change height between months |
| `disabled` | — | `() => boolean`. No navigation, no selection |
| `label` / `labelledBy` | — | The accessible name of the group of months |
| `labels` | see [below](#calendar-labels) | |
| `onChange` / `onRangeChange` | — | |
| `onFocusedDateChange` / `onVisibleMonthChange` | — | The second fires on a change, not for the month it starts on |

`today` is an option so that a test, a server render and a page pinned to
another zone agree about which cell is today. Without it, each cell reads the
clock when its props are computed, and nothing watches the clock: a calendar
left open across midnight goes on marking yesterday until the grid next
re-renders.

**Bounds and unavailable dates are one question with two answers on screen.**
A date outside `min` or `max` is never reached — navigation clamps before it
moves, and a month button whose month lies wholly outside the bounds is
disabled. A date `isDateDisabled` refuses is reached, focused and announced as
unavailable, which is the only way a keyboard user can find out why it cannot
be booked. That is the difference between a month that does not exist and a
night that is full.

### Keyboard

| Key | Does |
|---|---|
| ArrowRight, ArrowLeft | Next, previous day — mirrored under RTL |
| ArrowDown, ArrowUp | Next, previous week |
| Home, End | First, last day of the focused week, in the locale's order |
| PageDown, PageUp | Same day of the next, previous month |
| Shift + PageDown, PageUp | Same day of the next, previous year |
| Enter, Space | Select the focused date. Consumed even when refused, so Space does not scroll |

Alt, Ctrl and Meta are left alone: Alt+Arrow is browser history and Ctrl+Arrow a
caret move. The day arrows are mirrored under RTL because the APG defines them
by where the cell is, not by which way time runs — the key towards the right
edge moves to the cell at the right edge, which in Arabic is the earlier date.
The week arrows are not, since rows do not mirror.

**The focused date is not the selected date.** An empty calendar still needs a
tab stop, so exactly one cell is focusable at a time — the selected date, else
today, else the nearest date the bounds allow — and arrowing moves that cell,
not the selection. Across several visible months it is still one tab stop, so a
two-month grid is one widget and not two. Arrowing off the end of a month moves
the visible month with it, and DOM focus lands on the new cell once it has
rendered.

**Moving the month is announced; moving within it is not.** A cell's
accessible name is the full date, so arrowing from March 31 into April already
says "April 1" out loud, and a second announcement would talk over it. Pressing
the next-month button does not: focus stays on the button, the grid changes in
silence, and that change goes through the shared announcer instead. The
focused date travels with the month, so the tab stop is never left on a month
the user cannot see.

### Members

| Member | Description |
|---|---|
| `months()` | The visible months, laid out |
| `weekdays()` | The column heads, in the locale's order: `dayOfWeek`, `narrow`, `short`, `long` |
| `visibleMonth()` | `{ year, month }` of the first visible month |
| `selectedDate()` / `selectedRange()` | The selection, per mode |
| `focusedDate()` / `focusedCell()` | The tab stop, and its element |
| `isSelected`, `isDisabled`, `isToday` | Per-date state. `isDisabled` is true outside `min` and `max` as well as where `isDateDisabled` says so |
| `isRangeStart`, `isRangeEnd`, `isInRange` | Range state, including the interval being drawn |
| `dateLabel(date)` | The locale's full name for a date, as a screen reader hears it |
| `select(date)` / `clear()` | Change the selection from code. A disabled date is refused |
| `focusDate(date)` | Move the tab stop, bringing its month into view and taking DOM focus |
| `previousMonth()`, `nextMonth()`, `previousYear()`, `nextYear()` | Page the view, leaving DOM focus where it is |
| `setVisibleMonth(year, month)` | Jump the view |
| `onKeyDown(event)` | Returns `true` when consumed |
| `onDayClick(event)` | Bind to `click` on the calendar element |
| `onDayPointerOver(event)` / `onPointerLeave()` | Range mode: draw the pending interval under the pointer |
| `calendarProps()`, `gridProps(i?)`, `headingProps(i?)`, `rowProps()` | Structure. Each grid is named by its own heading |
| `weekdayProps(weekday)` | A column head, named by the full weekday — "Mo" is not a word |
| `dayProps(day)` | A cell |
| `previousMonthProps()`, `nextMonthProps()`, `previousYearProps()`, `nextYearProps()` | Navigation buttons |

A `CalendarDay` carries only structural facts: `date`, `key` (unique across the
visible months, which the date alone is not), `monthIndex`, and `outsideMonth`
for a neighbouring month's days padding the first and last rows. Selected,
focused, disabled and today are asked for separately, so moving the highlight
re-runs the cells' bindings rather than rebuilding the grid. A press on a
padding day selects it and moves the grid onto its month.

A cell is styled through `data-selected`, `data-today`, `data-disabled`,
`data-outside-month`, `data-in-range`, `data-range-start` and
`data-range-end`. `aria-selected` is stated on every cell of a range grid and
only on the selected one in a single-date grid, where thirty cells saying "not
selected" is thirty announcements of a fact already known.

### Ranges

```ts
// stay.ts
import { Component, Signal } from '@voltdev/core';
import { createCalendar, type DateRange } from '@voltdev/primitives';

@Component({ selector: 'v-stay', templateUrl: './stay.html' })
export class Stay {
  root = new Signal.State<Element | null>(null);
  nights = new Signal.State<DateRange | null>(null);
  cal = createCalendar({
    calendar: () => this.root.get(),
    mode: 'range',
    range: this.nights,
    visibleMonths: 2,
    label: 'Stay',
  });
}
```

```html
<div :ref="root" :spread="cal.calendarProps()"
     :click="cal.onDayClick($event)"
     :pointerover="cal.onDayPointerOver($event)"
     :pointerleave="cal.onPointerLeave()">…</div>
```

The first press sets one end, clears whatever interval was there, and the grid
waits; the second closes it, in whichever order the two dates came — `start` is
never after `end`. Clearing on the first press is deliberate: two intervals on
screen at once leave the user unable to tell which one the next press keeps.
`selectedRange()` is `null` between the presses, and `isInRange` paints the
pending interval out to the date under the pointer.

### Calendar labels

| Label | Default | Used for |
|---|---|---|
| `previousMonth`, `nextMonth` | the catalogue's `previous`, `next` | The month buttons |
| `previousYear`, `nextYear` | the catalogue's `previous`, `next` | The year buttons — the same names as the month buttons |
| `monthChanged(label)` | the month's own name, "September 2026" | Said when the month buttons or `setVisibleMonth` move the view — not when arrowing does |
| `dateSelected(date)` | "{date} selected" | Said when a date is chosen |
| `rangeStartSelected(date)` | "{date} selected. Choose an end date." | Said when the first end of a range is chosen |
| `rangeSelected(start, end)` | "{start} to {end} selected" | Said when a range closes |
| `unavailable` | "unavailable" | Appended to a disabled cell's name |
| `today` | "today" | Appended to today's name, since `aria-current="date"` alone is read unevenly |

The dates handed to these are already localised. The sentences around them,
and the two suffixes, are English literals rather than catalogue entries — pass
them through `labels` on a page in any other language.

## Typing a date or a time

A calendar alone is not a date input. Somebody entering a birth date does not
want to page back four hundred months, and somebody who already knows the date
wants to type it. The grid is for choosing and the field is for saying.

```ts
createDateField(options: DateFieldOptions): DateField
createTimePicker(options: TimePickerOptions): TimePicker
```

**A segmented field, not a masked text input.** A text input holding
"03/04/2026" cannot say whether that is March or April, cannot be arrowed, and
announces the whole string every time one character changes. So each part is
its own `spinbutton` — the role the parts of `<input type="date">` carry — and the
parts, their order and the separators between them come from
`Intl.DateTimeFormat.formatToParts`. That is the only thing that knows Japanese
writes the year first and Arabic writes the day first with a right-to-left mark
between. Each segment's accessible name comes from `Intl.DisplayNames`, so it
is "Monat" in German without a label being passed.

**Half a date is not a date.** The segments hold their own partial state, and
the value stays `null` until every one of them has something. The segments are
the state and the value is derived from them, not the other way round: a value
cannot represent "the month is typed and the day is still being typed", and a
field that cannot represent that eats the first keystroke of every entry.

```ts
// birthday.ts
import { Component, Signal } from '@voltdev/core';
import { createDateField } from '@voltdev/primitives';

@Component({ selector: 'v-birthday', templateUrl: './birthday.html' })
export class Birthday {
  el = new Signal.State<Element | null>(null);
  date = createDateField({ field: () => this.el.get(), label: 'Date of birth', name: 'dob' });

  onKey(event: KeyboardEvent): void {
    if (this.date.onKeyDown(event)) event.preventDefault();
  }
}
```

```html
<!-- birthday.html -->
<div :ref="el" :spread="date.fieldProps()" :keydown="onKey($event)">
  <span :for="seg in date.segments()" :key="seg.key"
        :spread="date.segmentProps(seg)">{ seg.text }</span>
</div>
<input :spread="date.hiddenInputProps()" />
```

Render every segment, separators included; `segmentProps` hides a separator
from assistive technology, which would otherwise read "slash" between every part
of the date. The hidden input carries the ISO value — `2026-09-11`, or `14:30`
for a time — so a plain form post has something a server can read, whatever
the locale printed.

| Key | Does |
|---|---|
| ArrowUp, ArrowDown | One step on this segment, wrapping at its ends |
| PageUp, PageDown | A larger step: ten years, three months, a week, two hours, fifteen minutes or seconds. On the minutes it is fifteen `minuteStep`s — see [below](#where-it-falls-short) |
| ArrowLeft, ArrowRight | Previous, next segment — mirrored under RTL |
| Home, End | This segment's smallest, largest value |
| 0–9 | Type into the segment, moving on when it is full |
| a, p | Morning or afternoon, where the clock has a period |
| Backspace, Delete | Empty this segment |

Wrapping is deliberate: a minute segment that stopped at 59 would make 23:59 to
00:00 impossible without reaching for the hour, and every native time input
wraps. Typing past the top of a range starts a new number rather than refusing
the key — 1 then 9 in a month is not month 19, it is September — and a day that
no longer exists when the month changes is clamped rather than left to compose
a date that is not one. An arrow on an empty year starts from the current year;
an empty day starts at 1.

The field is one tab stop. Exactly one segment is in the tab order, and DOM
focus decides which segment is current, so a click on a segment is heard even
though it goes through no handler of this one.

### Options

| Option | Date | Time | Description |
|---|---|---|---|
| `field` | required | required | The element wrapping the segments |
| `value` / `defaultValue` | ✓ | ✓ | A `PlainDateValue` or `PlainTimeValue`, or `null` |
| `today` | ✓ | | Where an arrow on an empty year starts. Defaults to the clock |
| `granularity` | | `'minute'` | `'second'` adds a seconds segment |
| `minuteStep` | | `1` | What one arrow press moves the minutes by |
| `hourCycle` | | the locale's | `'h11'`, `'h12'`, `'h23'` or `'h24'`, to force a clock |
| `disabled` / `readOnly` / `required` | ✓ | ✓ | Getters. Read-only still moves between segments. `required` is neither enforced nor announced — see [below](#where-it-falls-short) |
| `name` | ✓ | ✓ | Names the hidden input — see [below](#where-it-falls-short) |
| `label` / `labelledBy` / `describedBy` | ✓ | ✓ | For the group |
| `labels` | ✓ | ✓ | `placeholder(type, width)`, `segment(type)`, `empty` |
| `onChange` | ✓ | ✓ | Called with the composed value, `null` while incomplete |

The year runs from 1 to 9999 rather than to a window around today, because a
field that refuses 1901 is useless for a birth date and one that refuses 2087
is useless for a maturity date. Bounds belong to whatever knows what the date
is for; the field takes none.

The time picker's clock is the locale's unless forced — American English is
12-hour and British English 24-hour, and there is no rule connecting the two
beyond the data `Intl` already carries. A 12-hour value stays `null` until the
period is given, since the field cannot say which half of the day it is.
`minuteStep` moves the arrows by that many minutes; typed minutes are taken as
typed, and nothing snaps to the step.

The time picker has no popup list of times, whatever its name suggests. A
dropdown of generated times is a
listbox, which [`createListbox`](#a-list-on-the-page-createlistbox) already is;
what is available nowhere else is segmented entry, and that is all this is.

| `labels` | Default |
|---|---|
| `placeholder(type, width)` | A run of dashes as wide as the segment |
| `segment(type)` | The locale's own name for the field, from `Intl.DisplayNames` |
| `empty` | "Empty" — what an empty segment's `aria-valuetext` says. English |

### Members

| Member | Description |
|---|---|
| `value()` / `setValue(v)` | The composed value, `null` while any segment is empty |
| `clear()` / `isEmpty()` | Every segment emptied; nothing entered at all |
| `segments()` | What to render, in the locale's order, separators included |
| `focusSegment(type?)` | DOM focus on a segment — the first editable one by default |
| `onKeyDown(event)` | Returns `true` when consumed |
| `fieldProps()` / `segmentProps(seg)` | The wrapper, which is a `group`, and each segment |
| `hiddenInputProps()` | An `<input type="hidden">` carrying the ISO value |

A `DateSegment` carries `type`, `key`, `index`, `text`, `isEditable`,
`isPlaceholder`, `value`, `min` and `max`. `value` is in display units, so a
12-hour clock's hour segment reports 1–12 while the composed value holds 0–23.
`text` is in the locale's digits.

## A field with a calendar behind it: `createDatePicker`

```ts
createDatePicker(options: DatePickerOptions): DatePicker
```

A date field and a calendar sharing one value signal. The field decomposes it
into segments and the calendar selects it in a grid, so typing moves the grid
and choosing in the grid fills the segments, and neither holds a copy that can
drift from the other. The popover, its anchoring, dismissal and focus restore
are `createPopover`'s.

```ts
// departure.ts
import { Component, Signal } from '@voltdev/core';
import { createDatePicker, today } from '@voltdev/primitives';

@Component({ selector: 'v-departure', templateUrl: './departure.html' })
export class Departure {
  field = new Signal.State<Element | null>(null);
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  months = new Signal.State<Element | null>(null);
  picker = createDatePicker({
    field: () => this.field.get(),
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
    calendar: () => this.months.get(),
    min: () => today(),
    label: 'Departure',
    name: 'departure',
    labels: { trigger: 'Choose a departure date' },
  });

  onFieldKey(event: KeyboardEvent): void {
    if (this.picker.onKeyDown(event)) event.preventDefault();
  }

  onGridKey(event: KeyboardEvent): void {
    if (this.picker.calendar.onKeyDown(event)) event.preventDefault();
  }
}
```

```html
<!-- departure.html -->
<div :ref="field" :spread="picker.field.fieldProps()" :keydown="onFieldKey($event)">
  <span :for="seg in picker.field.segments()" :key="seg.key"
        :spread="picker.field.segmentProps(seg)">{ seg.text }</span>
</div>
<input :spread="picker.field.hiddenInputProps()" />
<button :ref="trigger" :spread="picker.triggerProps()">📅</button>

<div :if="picker.popover.isPresent()" :ref="content" :spread="picker.contentProps()">
  <div :ref="months" :spread="picker.calendar.calendarProps()"
       :keydown="onGridKey($event)" :click="picker.calendar.onDayClick($event)">
    <!-- the months, as in the calendar example -->
  </div>
</div>
```

The trigger has no `:click`: its handlers come in through `triggerProps()`.
Opening puts the grid's tab stop on the date the field holds, or today, and
takes DOM focus there. Choosing a date closes the popover, and focus goes back
to whatever held it when the popover opened — the trigger, or the segment
Alt+ArrowDown was pressed in — unless the user has already moved it somewhere
else.

Alt+ArrowDown in the field opens the calendar. That is what a native date input
does, and the only keyboard route to the grid that does not mean finding the
button first.

| Option | Default | Description |
|---|---|---|
| `field`, `trigger`, `content`, `calendar` | required | The segments' wrapper, the button, the popover, and the months inside it |
| `value` / `defaultValue` | owned, `null` | The one value both halves share |
| `open` / `defaultOpen` | owned, `false` | The popover |
| `closeOnSelect` | `true` | Close as soon as a date is chosen in the grid |
| `placement` | `'bottom-start'` | Where the popover sits |
| `disabled` / `readOnly` | — | Both disable the grid and the trigger; read-only leaves the segments reachable |
| `labels` | | The field's and the calendar's labels, plus `trigger` and `calendar` |
| `onChange`, `onOpenChange` | — | `onChange` fires once whichever half made the change |

The calendar options `min`, `max`, `isDateDisabled`, `visibleMonths`,
`firstDayOfWeek` and `fixedWeeks` go to the grid; `required`, `name`,
`labelledBy` and `describedBy` go to the field; `today` and `label` go to both,
`label` naming the group of months when `labels.calendar` does not.

**`min` and `max` bound the grid, not the typing.** The field takes no bounds,
so a date typed outside them becomes the value, and the grid shows it selected
and unavailable. Check the value where you validate the form. Nor do they move
where the grid opens: with nothing chosen it opens on today, even when `min`
is next month, so it shows a month of unavailable cells with the tab stop on
one of them. The first arrow press jumps to `min`; a pointer user has to page
forward. Overriding `today` would move the opening month, but it also moves
the cell marked as today, so it is not a fix.

| `labels` beyond the field's and the calendar's | Default |
|---|---|
| `trigger` | "Choose date" — English. The button is usually a glyph, and a glyph is not a name |
| `calendar` | Names the popover, which is otherwise a `dialog` with no name unless a heading carries `picker.popover.titleProps()`. The group of months takes it too, falling back to `label` |

| Member | Description |
|---|---|
| `field` / `calendar` / `popover` | The three parts. Render the field and the grid through the first two; reach for the popover when the members below do not cover it |
| `value()` / `setValue(v)` | The shared value |
| `isOpen()` / `open()` / `close()` | The popover |
| `onKeyDown(event)` | For the field: Alt+ArrowDown, then the field's own keys. Returns `true` when consumed |
| `triggerProps()` / `contentProps()` | The button and the popover, handlers included |

## Attribute names

Options and cells are found by attribute rather than registered, so one rendered
from a `:for`, or nested inside markup of your own, needs no wiring.

| Constant | Value | Carried by |
|---|---|---|
| `OPTION_ATTRIBUTE` | `data-volt-option` | A listbox option, holding its index |
| `CALENDAR_DAY_ATTRIBUTE` | `data-volt-calendar-day` | A day cell, holding its ISO date |
| `SEGMENT_ATTRIBUTE` | `data-volt-segment` | An editable segment, holding its field name |

A day cell carries its date rather than an index because a click has to say
which day it was, and an index would have to be decoded against the month on
screen — the thing the click may itself have changed. A segment carries its field
name rather than a position because the pattern is rebuilt when the locale
changes, and Japanese puts the year where English puts the month.

## Types

Every type below is exported, for annotating a field or a function that passes
one of these along. The option and member tables above are their contents.

| Type | What it is |
|---|---|
| `ListboxOptions<T>`, `Listbox<T>` | `createListbox`'s options and return |
| `ListboxOptionOptions<T>` | What `optionProps` takes |
| `ListboxVirtualOptions`, `ListboxLabels` | The `virtual` and `labels` options |
| `ListboxSelectionMode`, `ListboxOrientation` | `'none' \| 'single' \| 'multiple' \| 'extended'`, `'vertical' \| 'horizontal'` |
| `ListboxProps`, `ListboxPropValue` | The listbox's prop bags |
| `SelectOptions`, `Select` | `createSelect`'s options and return |
| `ComboboxOptions<T>`, `Combobox<T>` | `createCombobox`'s options and return |
| `ListboxSharedOptions` | The options Select and Combobox share |
| `ComboboxOptionOptions` | What `optionProps` and `nativeOptionProps` take |
| `ComboboxAutocomplete`, `ListboxOpenFocus` | `'none' \| 'list' \| 'both'`, and what `open(focus?)` takes |
| `ComboboxLabels`, `ComboboxProps` | Select and Combobox's labels and prop bags |
| `PlainDateValue`, `PlainTimeValue`, `DateRange` | The values |
| `CalendarOptions`, `Calendar`, `CalendarLabels` | `createCalendar`'s options, return and labels |
| `CalendarMonth`, `CalendarWeek`, `CalendarDay`, `CalendarWeekday` | What `months()` and `weekdays()` hand back |
| `CalendarSelectionMode` | `'single' \| 'range'` |
| `CalendarProps`, `CalendarPropValue` | The calendar's prop bags |
| `DateFieldOptions`, `DateField` | `createDateField`'s options and return |
| `TimePickerOptions`, `TimePicker`, `HourCycle` | `createTimePicker`'s options, return, and `'h11' \| 'h12' \| 'h23' \| 'h24'` |
| `SegmentedField<T>` | What `DateField` and `TimePicker` both are |
| `DateSegment`, `DateSegmentType` | One segment, and its `type` |
| `SegmentedFieldLabels`, `SegmentedFieldProps`, `SegmentedFieldPropValue` | The field's labels and prop bags |
| `DatePickerOptions`, `DatePicker`, `DatePickerLabels` | `createDatePicker`'s options, return and labels |

Two types in these signatures are not exported. The editable segment types
that `focusSegment(type?)` and the `labels` functions take are
`Exclude<DateSegmentType, 'literal'>`; write that where you need to name them.
The surface Select and Combobox share — the members table under
[What Select and Combobox share](#what-select-and-combobox-share) — has no
exported name of its own; `Select` and `Combobox` each include it.

## What is not built

- **Time zones.** A `PlainDateValue` has no zone and none of these primitives
  takes one. The only zone anywhere is the argument to `today(timeZone?)`, for
  reading the clock; a calendar, field or picker that must agree with a zone
  other than the runtime's is handed `today: () => today('Asia/Tokyo')`. There
  is no zoned date-time value, no conversion between zones, and no picker for
  an instant. A date field and a time picker side by side give a wall-clock date
  and time with no zone attached, and which zone they mean is the application's
  to decide and to store.
- **Presets.** There is no "last 7 days" or "this month" list for a range
  calendar. A row of buttons that set the `range` signal composes one; none
  ships.
- **Calendar systems other than Gregorian.** The arithmetic is proleptic
  Gregorian and the formatters pin it, so a locale whose own calendar is Hijri,
  Hebrew, Persian, Buddhist or Japanese-era gets a Gregorian grid with its
  names and digits. A real grid in another calendar needs `Temporal`'s calendar
  support, and is not here.
- **A range date picker.** `createCalendar` selects ranges; `createDatePicker`
  is single-date, and there is no segmented field for a start and an end.
- **Week numbers.** A `CalendarWeek` is an object so that a week number has
  somewhere to go, but none is computed.
- **Bounds on typed values.** The date field and the time picker take no `min`
  or `max`, and the picker's bounds reach only its grid.
- **Touch and paste entry in a segmented field.** The segments are focusable
  spans driven by `keydown`, not editable elements, so a phone shows no
  on-screen keyboard for them — `inputmode="numeric"` is set, and only an
  editable element acts on it. Pasting a whole date is not handled either.

## Where it falls short

What follows is how the code behaves today, recorded so that nobody finds it by
shipping it.

- **`labels.clear` is not read.** `clearProps()` takes its name from the
  catalogue's `clear` key alone. To rename the button, put `clear` in the
  catalogue, or spread a bag of your own — `{ ...this.combo.clearProps(),
  'aria-label': 'Remove all' }` from a method — since the spread re-applies its
  `aria-label` over one written in the markup.
- **`required` on a segmented field does nothing a user meets.** The date
  field, the time picker and the date picker write it to the hidden input and
  nowhere else, and the platform does not validate a hidden input: a form
  with an empty required date submits, and no segment says `aria-required`.
  Check `value()` in your submit handler, and say "required" in the label.
- **A segmented field with no `name` names its hidden input "undefined".** The
  spread assigns `name` as a property, and an `undefined` assigned to it becomes
  the string. Render `hiddenInputProps()` only when you have passed `name`.
- **The calendar's year buttons share the month buttons' names.** Both default
  to the catalogue's `previous` and `next`, so a calendar rendering all four
  has two buttons called "Previous". Pass `labels.previousYear` and
  `labels.nextYear` whenever you render the year buttons.
- **The calendar's sentences, and the picker's trigger and empty-segment
  names, are English by default** and are not catalogue entries, although the
  dates inside them are localised. Other languages pass them through `labels`.
- **A `multiple` select closes on a keyboard choice.** Enter, Space and
  Alt+ArrowUp choose and close whatever `closeOnSelect` says; only a pointer
  press honours it. A multiple combobox does not have this difference.
- **Tab toggles in a `multiple` widget.** Tab takes the highlighted option on
  its way out, and taking an option a `multiple` already holds removes it. In
  both Select and Combobox, leaving the popup with Tab while the highlight rests
  on a chosen value drops that value. A `multiple` Select makes this the common
  case: it opens with the highlight on the first chosen value, so opening one
  that holds "Banana" and "Cherry" and pressing Tab straight away leaves it
  holding "Cherry". Press Escape before Tab, or open with Alt+ArrowDown, which
  highlights nothing.
- **PageUp and PageDown on the minutes multiply `minuteStep`.** A page is
  fifteen arrow steps, and an arrow step is `minuteStep` minutes, wrapped
  inside the hour. With `minuteStep: 5` that is 75 minutes, which happens to
  land a quarter hour on; with 15 it lands 45 minutes on; with 4 or 20 it goes
  all the way round and changes nothing. Leave `minuteStep` at 1 where paging
  matters, or handle PageUp and PageDown on the minute segment yourself before
  calling `onKeyDown`.
- **A range can span dates `isDateDisabled` refuses.** Only the two presses are
  checked; the dates between them are not, so a stay can be drawn across a
  booked night, and `isInRange` paints it. Check the interval in
  `onRangeChange` and `clear()` it when a date inside it is unavailable.
- **A read-only date picker still opens on Alt+ArrowDown.** Its `onKeyDown`
  checks `disabled` and not `readOnly`, so the popover appears over a grid that
  answers no keys and takes no presses. While read-only, drop Alt+ArrowDown in
  your own handler before handing the event on; the other keys still have to
  reach it, since read-only segments can be moved between.
- **With `allowCustomValue`, leaving the box commits what was typed, whatever
  is highlighted.** Enter and Tab take a highlighted option first; blur does not
  look. Type "Cher", arrow onto Cherry, click elsewhere, and the value is the
  string `Cher`. Under `autocomplete: 'both'` the box goes on showing the
  completion "Cherry" while the value, and the form, hold the `Ch` that was
  typed. Separately, the guard against swapping an option's identifier for its
  label looks only at values already held, so "Cherry" typed in full with
  nothing highlighted is committed as the string `Cherry`, not the option's
  `ch`. Bind `:blur` to a method of your own that takes the highlighted option
  before anything else, as below; the last case still needs `onValueChange` to
  map typed text back to an option.

```ts
// custom-fruit.ts
import { Component, Signal } from '@voltdev/core';
import { createCombobox } from '@voltdev/primitives';

@Component({ selector: 'v-custom-fruit', templateUrl: './custom-fruit.html' })
export class CustomFruit {
  input = new Signal.State<Element | null>(null);
  list = new Signal.State<Element | null>(null);
  combo = createCombobox({
    input: () => this.input.get(),
    listbox: () => this.list.get(),
    allowCustomValue: true,
  });

  // Bound as :blur="onBlur()" in place of combo.onInputBlur().
  onBlur(): void {
    const active = this.combo.activeValue();
    if (active === null) return this.combo.onInputBlur();
    this.combo.select(active);
    this.combo.close();
    this.combo.field.markTouched();
  }
}
```
