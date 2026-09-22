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

## `<v-checkbox>`

`createCheckbox`, with the markup written: a box, the words that name it, and
the hidden input that submits. The state is one signal both sides hold — pass
`checked` and it is yours to read and write, pass nothing and the checkbox owns
it.

<Demo name="checkbox" height="300" />

```html
<v-checkbox :checked="agreed" name="terms">I accept the terms</v-checkbox>
```

The words are the default slot and they are drawn *inside* the control, which
is how it takes its accessible name from its own contents — so a checkbox
written this way needs no `label` and no id pointing at one. A box with nothing
written in it has nothing to be named from, and is named with `label` instead —
or with `aria-label`, which is the same thing in the spelling the platform
already has.

| Prop | Type | Means |
|---|---|---|
| `checked` | `Signal.State<boolean \| 'indeterminate'>` | Your signal, when the state is yours |
| `defaultChecked` | `boolean \| 'indeterminate'` | Where it starts, when the checkbox owns its state |
| `name` | `string` | Submitted as `name=value` while checked; without one it submits nothing |
| `value` | `string` | What is submitted under that name. Default `on`, as a native checkbox sends |
| `label` | `string` | Names a box that has no words written inside the tag |
| `labelledBy` | `string` | Id of the element that names it, when something on the page already does |
| `aria-label` | `string` | The same name, written the platform's way. It lands on the control |
| `aria-labelledby` | `string` | The same id, likewise |
| `aria-describedby` | `string` | Ids of what describes it — a hint, a validation message |
| `disabled` | `boolean` | Refuses the press and the keyboard, and is written through to the input |
| `required` | `boolean` | Written through to the input, so the platform enforces it on submit |
| `onCheckedChange` | `(checked: boolean \| 'indeterminate') => void` | Called with the state the box moved to |

Slots: the default one is the words, and `mark` is what is drawn inside the
box, handed `{ state }` — `true`, `false` or `'indeterminate'` — for a mark
that differs between them:

```html
<v-checkbox :checked="agreed">
  <template :slot-mark="{ state }">
    <svg viewBox="0 0 16 16" aria-hidden="true" width="12" height="12">
      <path :d="state === 'indeterminate' ? 'M3 8h10' : 'M3 8l4 4 6-8'"
            fill="none" stroke="currentColor" stroke-width="2" />
    </svg>
  </template>
  I accept the terms
</v-checkbox>
```

Draw it in `currentColor`. The sheet shows and hides the mark by its colour
rather than with `display`, so that the box does not change size between
states — a mark with a colour of its own is one that shows in every state,
including the empty box.

`defaultChecked`, `name` and `value` are read once, when the primitive is
built, so they are not signals and changing them later does nothing — which is
also why they are written down here. `checked`, `disabled`, `required` and
everything that names or describes the control follow whatever you bind them
to.

A hint under the box, or the message saying why the box has to be ticked, is
pointed at with `aria-describedby`. It is the one thing here with no prop
spelling, because nothing is handed a description — the ids are the whole of
it, and they are what `createFormField` computes for a field that has both a
description and an error:

```html
<span id="terms-hint">We will email you a copy of what you agreed to.</span>
<v-checkbox aria-describedby="terms-hint" name="terms">I accept the terms</v-checkbox>
```

Behind the box is a real `<input type="checkbox">`, visually hidden and
carrying the value. It is the half that submits, that `FormData` reads, that
`form.reset()` puts back, and that the browser validates `required` against;
none of that can be had from a control assembled out of `<span>`s, which is why
the input is there rather than left out. It is hidden by clipping rather than
by `display: none`, because the browser refuses to submit an invalid control it
cannot focus and then has nowhere to say why.

The third state is for a box that stands for others — the parent of a list
where only some are ticked. `indeterminate` is presentation only on the
platform: checkedness alone decides what is submitted, so a mixed box submits
nothing, and toggling one checks it, exactly as a native checkbox behaves.

One thing about the markup is worth knowing before you write CSS against it.
What you write on the tag — a class, an id, a `data-*` — lands on the `<label>`
that wraps the whole row, because that is the element you can see and the one
that positions the control; it is also why a press on the words counts exactly
once, whether it landed on the box or on the text. The exceptions are the three
attributes above that say what the control is called: those go on the control,
which is the element carrying `role="checkbox"` and the only one a reader
announces. The row has no role, so a name left on it would name nothing.

Any other ARIA you write, and `role`, do land on the row. The role in
particular is the primitive's and stays that way: a box that announces itself
as something other than a checkbox is a different control, and writing the word
on the tag would not make the rest of it behave like one.

Space toggles and Enter is left alone, so a checkbox inside a form does not
steal the submit. A disabled box keeps its place in the tab order —
`aria-disabled`, not the `disabled` attribute, this package's rule for every
disabled control — while the input behind it carries the real `disabled`, so
nothing about it submits.

For anything this does not offer, take the primitive:

```html
<v-checkbox :ref="terms" name="terms">I accept the terms</v-checkbox>
```

```ts
terms: VCheckbox | null = null;
clear(): void { this.terms?.checkbox.setChecked('indeterminate'); }
```

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

## Written by hand

The same look without the tag: the primitive, the markup you want, and the
sheet's class names on it. This is what a component here is made of, and what
to reach for when a component's shape does not fit — or when the component does
not exist yet.

### Button

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

### Checkbox

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
