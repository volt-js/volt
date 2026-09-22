# Form components

Controls a user fills in, and the button that submits them.

Each component below is a tag you write, with the primitive that owns its
behaviour named beside it. What is not a tag yet is the markup to write by
hand: the same primitive, the same class names, and the same look — which is
what makes a component here a shortcut rather than a wall.

See [the package](./ui) for the two entries, the stylesheet, the tokens and
how to override a rule.

## `<v-button>`

A `<button>`, with the sheet's look and the package's rule for a disabled
control.

| Prop | Type | Means |
|---|---|---|
| `variant` | `'primary' \| 'danger' \| 'ghost'` | Absent for the plain button |
| `size` | `'sm' \| 'lg'` | Absent for the middle size |
| `type` | `'button' \| 'submit' \| 'reset'` | `button` unless asked, rather than the platform's submit |
| `disabled` | `boolean` | Refuses the press |
| `onPress` | `(event: MouseEvent) => void` | Called on a press it did not refuse |

```html
<v-button variant="primary" :disabled="busy.get()" :onPress="save">
  { busy.get() ? 'Saving…' : 'Save' }
</v-button>
```

Disabled is written as `aria-disabled`, not the `disabled` attribute, so the
button keeps its place in the tab order: a control a keyboard user cannot reach
is one they cannot discover is there. The press is refused instead.

## `<v-select>` and `<v-option>`

A button showing the value, over a popup list — the APG select-only combobox,
which `createSelect` implements down to the typeahead.

<Demo name="select" height="300" />

```html
<v-select :value="chosen" name="country" placeholder="Choose a country">
  <v-option
    :for="country in countries"
    :key="country.code"
    :value="country.code"
    :label="country.name"
    :disabled="country.closed === true"
  ></v-option>
</v-select>
```

Each `<v-option>` draws a real `<option>` inside a hidden native `<select>`,
which is the part that is easy to skip and expensive to skip: it is what
submits with the form, what the platform validates, and what lets the control
show the name of a value it was handed before its popup had ever been opened.
The rows you see are drawn from the same options when the list opens, so an
option is one component whether the list is open or shut.

| `<v-select>` | Type | Means |
|---|---|---|
| `value` | `Signal.State<readonly string[]>` | Your signal. A list even for one value — `values()` is the list, `value()` the first of it |
| `defaultValue` | `string \| readonly string[]` | Where it starts, when the value is the select's own |
| `multiple` | `boolean` | More than one at a time |
| `name` | `string` | Submitted as `name=value`; without one the native control submits nothing |
| `open` | `Signal.State<boolean>` | Your signal for the popup, when you need to drive it |
| `placeholder` | `string` | Shown while nothing is chosen |
| `disabled`, `readOnly`, `required` | `boolean` | Written through to the native control |
| `onValueChange`, `onOpenChange` | callbacks | |

| `<v-option>` | Type | Means |
|---|---|---|
| `value` | `string` | Identifies the option; everything is keyed off it |
| `label` | `string` | The name of the value, in the button and the native control |
| `disabled` | `boolean` | Skipped by navigation and typeahead, still announced |

Write a template inside the tag for a row that is more than a line of text —
`label` is still needed, because an `<option>` holds text and nothing else, and
that text is what a screen reader reads and what typeahead searches:

```html
<v-option value="fr" label="France">
  <img src="/flags/fr.svg" alt=""> France
</v-option>
```

Two things the sheet draws are information rather than emphasis, and both
survive a forced palette. Which option is chosen is the obvious one. The other
is the highlight: focus stays on the trigger — it is the element carrying
`aria-activedescendant` — so an option under the keyboard has no `:focus` for
CSS to find, and `data-highlighted` is the only mark saying where the keyboard
is.

## Button

```html
<button class="volt-button" data-variant="primary" data-size="sm">Save</button>
```

| Attribute | Values |
|---|---|
| `data-variant` | `primary`, `danger`, `ghost`; absent for the plain button |
| `data-size` | `sm`, `lg`; absent for the middle size |

Attributes rather than a class per variant, so that a variant is a value the
markup carries rather than a string somebody has to concatenate correctly.
Disabled is `disabled` or `aria-disabled="true"`, drawn the same; use the
second when the button has to stay reachable by keyboard. Hover is not drawn on
a disabled button, because a control that lights up under the pointer looks
like it will do something.

## Checkbox

The control holds the box and the words that name it, the way the primitive's
own example writes it, so the control takes its name from its contents and
needs no `labelledBy`:

```ts
import { Signal } from '@voltdev/core';
import { createCheckbox } from '@voltdev/primitives';

class Terms {
  input = new Signal.State<Element | null>(null);
  agree = createCheckbox({ input: () => this.input.get(), name: 'terms' });
}
```

```html
<label class="volt-checkbox-field" :click="agree.toggle()" :keydown="agree.onKeyDown($event)">
  <input :ref="input" :spread="agree.inputProps()">
  <span class="volt-checkbox" :spread="agree.controlProps()">
    <span class="volt-checkbox-indicator" aria-hidden="true">✓</span>
    I accept the terms
  </span>
</label>
```

The box is drawn on the indicator, and the control is the row the box and the
words sit on — its focus ring goes round both. A control with no words of its
own, named with `label`, is the box alone.

The sheet draws the box, its fill and its border; it does not draw a tick.
There are no pseudo-elements anywhere in it, so the mark is yours — a glyph,
or an SVG drawn in `currentColor` — and it is shown for `checked` and
`indeterminate` by its colour: an unchecked box draws it in `transparent`, so
the box does not change size between states. A mark with a colour of its own
shows in every state. Reading `agree.isIndeterminate()` is how you draw a
different mark for the third state. The rules select on `data-state` and
`data-disabled` only, and on no ARIA attribute: ARIA is there to be spoken, not
styled against.
