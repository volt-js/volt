# Form components

Controls a user fills in, and the button that submits them.

::: warning Not on npm yet
Part of `@voltdev/ui`, which is not published yet — see
[the package](./ui). Everything here works from a checkout of the Volt
repository.
:::

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

## `<v-input>`

`createInput`, with the markup written: the label, the box, a line of help and
the validation message. The value is one signal both sides hold — pass `value`
and it is yours to read and write, pass nothing and the field owns it.

<Demo name="input" height="420" />

```html
<v-input
  :value="email"
  label="Email"
  name="email"
  type="email"
  description="Only used to reply."
  required
  validateOn="blur"
></v-input>
```

The four parts are one tag because they are one field. The ids that tie the
label to the box, and the box to its help and its error, are
`createFormField`'s — as are the dirty and touched flags, the moment validation
is first allowed to speak, and the browser's own verdict pushed back into the
control so a submit is refused for the reason printed under it. The box is a
real `<input>`: that is what submits, what `FormData` reads, what
`form.reset()` restores and what the platform validates.

| Prop | Type | Means |
|---|---|---|
| `value` | `Signal.State<string>` | Your signal, when the text is yours |
| `defaultValue` | `string` | Where it starts when the value is the field's own, and what a reset goes back to |
| `id` | `string` | The box's id, and so the label's `for` |
| `name` | `string` | Submitted as `name=value`; without one the field submits nothing |
| `type` | `'text' \| 'email' \| 'password' \| 'search' \| 'tel' \| 'url'` | Default `text` |
| `placeholder` | `string` | Shown in an empty box |
| `autoComplete` | `string` | What the browser may fill in, in the platform's own vocabulary |
| `inputMode` | `string` | The on-screen keyboard to ask a phone for |
| `minLength`, `maxLength` | `number` | Enforced by the platform, and worded by it |
| `pattern` | `string` | A regular expression the whole value has to match |
| `validate` | `(value, control) => string \| string[] \| void \| Promise<…>` | What the platform cannot express. Nothing back is a pass |
| `validateOn` | `'submit' \| 'blur' \| 'input'` | When it first validates. Default `submit` |
| `revalidateOn` | `'submit' \| 'blur' \| 'input'` | When it validates again afterwards. Default `input` |
| `labels` | `FormFieldLabels` | Your wording for what the platform found wrong |
| `onValueChange` | `(value: string) => void` | Called with the text, on every edit |
| `label` | `string` | The words above the box |
| `description` | `string` | The line under it, shown whether or not the field is valid |
| `required` | `boolean` | Written through to the box, so the platform enforces it on submit |
| `disabled` | `boolean` | Written through as the platform's own `disabled` |
| `readOnly` | `boolean` | Refuses edits, keeps the tab stop, is never validated |
| `aria-label` | `string` | Names the box in the platform's own spelling, instead of the label |
| `aria-labelledby` | `string` | Names the box from elsewhere, instead of the label |
| `aria-describedby` | `string` | Ids of anything else that describes it, added to the field's own two |

Slots: `label` and `description`, for words that are more than words —

```html
<v-input :value="handle" name="handle" :maxLength="12">
  <template :slot-label>Handle <abbr title="required">*</abbr></template>
  <template :slot-description>See the <a href="/names">naming rules</a>.</template>
</v-input>
```

Both elements stay what the field points `aria-labelledby` and
`aria-describedby` at, whatever is written into them.

Everything from `defaultValue` to `onValueChange` in the table is read once,
while the primitive is built, so binding one to a signal changes nothing after
the first render — which is why they are written down here. `value`, `label`,
`description`, `required`, `disabled`, `readOnly` and the three ARIA props
follow whatever you bind them to.

All four parts are drawn whether or not they have anything to say, and the
message is the reason. It is a live region, and a live region that arrives
already holding its message is one no screen reader was watching — while
validation is reported at submit, when focus is on the button rather than on
the field, so a message nothing announced is a message nobody gets. The empty
line it holds is also the line the message will take, so a form that fails does
not push itself down the page.

Nothing is invalid before the trigger says so. A required field is empty the
moment it renders, and a box that announces itself as wrong before anyone has
typed a character is the commonest form bug there is — so `validateOn` starts
at `submit`, and `revalidateOn` at `input`, which is the pair that says nothing
until you ask and then stops the moment you start fixing it. Move the first to
`blur` for a field where waiting for the submit is too late.

Whatever the field decides goes into the control with `setCustomValidity`, so
the browser refuses the submit for exactly the reason on screen. An async
`validate` leaves the field `pending` while the answer is in flight, drawn as
attention rather than as a fault — and a submit refused only for want of that
answer is made again once it arrives and says yes.

What you write on the tag lands on the `<input>`: a class joins the sheet's own
there, and so do a `title`, a `data-*` and any ARIA. The box is the control, it
is the element carrying the role, and it is the only one a name means anything
on; the `<div>` around it is layout. Four attributes are exceptions, each for
its own reason. `id` is a prop, so that the id the label's `for` points at and
the id the box carries are the same one rather than two written a beat apart.
`aria-labelledby` is a prop because the field already points it at the label —
yours wins, since naming the box from elsewhere is the only reason to write it.
`aria-label` is a prop for the same reason said the other way round: landing it
on the box is not enough to make it the name, because the reference the field
points at its own label outranks it wherever a name is computed. Write one and
the field stands that reference down, which is what a plain `<input>` beside a
`<label for>` does as well — there the label is the weaker of the two, and it
should not become the stronger for being this component's. The `for` stays, so
a press on the words still puts the caret in the box. `aria-describedby` is a
prop because the field already points it at the help and the message — yours is
added to those rather than replacing them, and comes after them, which is the
order a screen reader reads them in.

`disabled` here is the platform's own attribute, not `aria-disabled` alone.
That is the opposite of `<v-button>` and `<v-checkbox>`, and the difference is
that there the visible control is not a native one, while here it is: a
disabled field is not part of the form, and only the attribute takes it out of
one. Read-only is the setting for a value that has to stay reachable — it keeps
its tab stop, it can be selected and copied, and it is never validated.

`number` is not one of the types on purpose. A native number input hands back
an empty string for "1.234,56", which is how most of Europe writes a thousand
and a bit, so a number field is its own control built on `createNumberInput`
rather than a `type` on this one.

The sheet entry is `field`, and it is shared: an input, a textarea, a number
field and a password field are one look with different contents. CSS you write
against `.volt-field-control` reaches all of them, which is the point — a look
repeated four times is a look that drifts three times. The rules select on
`data-state`, on `:disabled`, and on `aria-disabled` and `aria-readonly`; only
`invalid` and `pending` are drawn, because dirty and touched say where the user
has been, which is the field's business rather than the reader's.

For anything this does not offer, take the primitive:

```html
<v-input :ref="handle" label="Handle" name="handle" :maxLength="12"></v-input>
```

```ts
handle: VInput | null = null;
room(): number | null { return this.handle?.input.remaining() ?? null; }
reject(why: string): void { this.handle?.input.field.setCustomValidity(why); }
```

## `<v-textarea>`

`createTextarea`, with the markup written: the label, a box over several lines,
a line of help and the validation message. It is `<v-input>`'s field with a
`<textarea>` in the middle — the same four parts, the same ids tying them
together, the same moment validation is allowed to speak — and what is its own
is the shape of the box: how tall it opens, and how far it grows with what is
typed into it.

<Demo name="textarea" height="360" />

```html
<v-textarea
  :value="report"
  label="What went wrong?"
  name="report"
  description="A sentence or two, so we know where to look."
  rows="3"
  maxRows="8"
  :maxLength="280"
  validateOn="blur"
></v-textarea>
```

| Prop | Type | Means |
|---|---|---|
| `value` | `Signal.State<string>` | Your signal, when the text is yours |
| `defaultValue` | `string` | Where it starts when the value is the field's own, and what a reset goes back to |
| `id` | `string` | The box's id, and so the label's `for` |
| `name` | `string` | Submitted as `name=value`; without one the field submits nothing |
| `rows` | `number` | How tall the box opens. Default 2, and it grows from there |
| `maxRows` | `number` | The line it stops growing at, after which it scrolls. Without one it grows for ever |
| `autoSize` | `boolean` | Grow with the content. Default true — write `:autoSize="false"` to turn it off |
| `placeholder` | `string` | Shown in an empty box |
| `autoComplete` | `string` | What the browser may fill in, in the platform's own vocabulary |
| `minLength`, `maxLength` | `number` | Enforced by the platform, and worded by it |
| `validate` | `(value, control) => string \| string[] \| void \| Promise<…>` | What the platform cannot express. Nothing back is a pass |
| `validateOn` | `'submit' \| 'blur' \| 'input'` | When it first validates. Default `submit` |
| `revalidateOn` | `'submit' \| 'blur' \| 'input'` | When it validates again afterwards. Default `input` |
| `labels` | `FormFieldLabels` | Your wording for what the platform found wrong |
| `onValueChange` | `(value: string) => void` | Called with the text, on every edit |
| `label` | `string` | The words above the box |
| `description` | `string` | The line under it, shown whether or not the field is valid |
| `required` | `boolean` | Written through to the box, so the platform enforces it on submit |
| `disabled` | `boolean` | Written through as the platform's own `disabled` |
| `readOnly` | `boolean` | Refuses edits, keeps the tab stop, is never validated |
| `aria-label` | `string` | Names the box in the platform's own spelling, instead of the label |
| `aria-labelledby` | `string` | Names the box from elsewhere, instead of the label |
| `aria-describedby` | `string` | Ids of anything else that describes it, added to the field's own two |

Everything from `defaultValue` to `onValueChange` in the table is read once,
while the primitive is built, so binding one to a signal changes nothing after
the first render — `rows`, `maxRows` and `autoSize` among them. `value`,
`label`, `description`, `required`, `disabled`, `readOnly` and the three ARIA
props follow whatever you bind them to.

Slots: `label` and `description`, for words that are more than words —

```html
<v-textarea :value="report" name="report">
  <template :slot-label>Details <abbr title="required">*</abbr></template>
  <template :slot-description>Markdown is <a href="/markdown">supported</a>.</template>
</v-textarea>
```

Both elements stay what the field points `aria-labelledby` and
`aria-describedby` at, whatever is written into them. There is no slot for the
text in the box: **what you write between the tags goes nowhere.** A
`<textarea>`'s content is its value on the platform and a component's content
is its slots here, and the two cannot both be true — so the starting text is
`defaultValue`, or the signal you pass as `value`.

`rows` is where the box opens, not how big it stays. With `autoSize` on — it is
on unless you say otherwise — the box grows a line at a time as the text fills
it, and stops at `maxRows` if you gave one, after which it scrolls. Turning the
growing off is a binding: `autoSize="false"` is the string `"false"`, which is
a value, not a no.

The growing is one CSS declaration where the browser has it — `field-sizing:
content` — and the browser then keeps up with the edits no listener sees:
autofill, undo, an IME commit, dropped text. Two consequences are worth
knowing. The platform ignores `rows` on a box it is sizing to its content, so
the floor is written again as a `min-height` in `lh`, the box's own line height
— unless your stylesheet already gives the control a `min-height`, in which
case yours governs and nothing is written over it. And where the browser has no
`field-sizing`, the element is measured instead, which needs a numeric
`line-height` to turn `maxRows` into a height: under `line-height: normal`
there is no length to multiply, so the box is left uncapped rather than capped
somewhere you did not ask for.

Enter is a newline and stays one: nothing here takes the key, so the box does
not submit the form the way a single-line `<v-input>` does. A form with a
textarea in it is submitted from its button.

What you write on the tag lands on the `<textarea>`: a class joins the sheet's
own there, and so do a `title`, a `data-*` and any ARIA. The box is the
control, it is the element carrying the role, and it is the only one a name
means anything on; the `<div>` around it is layout. Four attributes are
exceptions, each for its own reason. `id` is a prop, so that the id the label's
`for` points at and the id the box carries are the same one rather than two
written a beat apart. `aria-labelledby` is a prop because the field already
points it at the label — yours wins, since naming the box from elsewhere is the
only reason to write it. `aria-label` is a prop for the same reason said the
other way round: landing it on the box is not enough to make it the name,
because the reference the field points at its own label outranks it wherever a
name is computed. Write one and the field stands that reference down, which is
what a plain `<textarea>` beside a `<label for>` does as well — there the label
is the weaker of the two, and it should not become the stronger for being this
component's. The `for` stays, so a press on the words still puts the caret in
the box. `aria-describedby` is a prop because the field already points it at
the help and the message — yours is added to those rather than replacing them,
and comes after them, which is the order a screen reader reads them in.

All three are read as unsaid when what you bind them to comes to nothing. An id
a page has not chosen yet is an empty string — `ids.join(' ')` over nothing, a
signal before its element exists — and taking one for a reference would point
the box at no id at all, which cuts it loose from the very label the prop
exists to replace.

All four parts are drawn whether or not they have anything to say, and the
message is the reason: it is a live region, and one that arrives already
holding its message is one no screen reader was watching. Nothing is invalid
before the trigger says so — `validateOn` starts at `submit` and `revalidateOn`
at `input`, which is the pair that says nothing until you ask and then stops
the moment you start fixing it. `disabled` is the platform's own attribute
rather than `aria-disabled` alone, because here the visible control is a native
one and only the attribute takes it out of the form; `readOnly` is the setting
for a value that has to stay selectable and copyable.

The sheet entry is `field`, and it is shared with `<v-input>` and every other
text-shaped control: an input, a textarea, a number field and a password field
are one look with different contents, so CSS you write against
`.volt-field-control` reaches all of them. A look repeated four times is a look
that drifts three times. The rules select on `data-state`, on `:disabled`, and
on `aria-disabled` and `aria-readonly`; only `invalid` and `pending` are drawn,
because dirty and touched say where the user has been, which is the field's
business rather than the reader's.

For anything this does not offer, take the primitive:

```html
<v-textarea :ref="report" label="Details" name="report" :maxLength="280"></v-textarea>
```

```ts
report: VTextarea | null = null;
/** Room left, in the UTF-16 code units `maxlength` itself counts in. */
room(): number | null { return this.report?.textarea.remaining() ?? null; }
/** Re-measure after a layout change the box cannot see — a panel opening beside it. */
settle(): void { this.report?.textarea.resize(); }
```

## `<v-radio-group>` and `<v-radio>`

`createRadioGroup`, with the markup written: a group that is one control, a
circle and its words per choice, and a hidden native radio behind each one. The
answer is one signal both sides hold — pass `value` and it is yours to read and
write, pass nothing and the group owns it.

<Demo name="radio-group" height="380" />

```html
<v-radio-group :value="plan" name="plan" label="Billing plan">
  <v-radio value="monthly">Monthly</v-radio>
  <v-radio value="yearly">Yearly, two months free</v-radio>
  <v-radio value="lifetime" :disabled="true">Lifetime</v-radio>
</v-radio-group>
```

A radio group is one control rather than a row of them. It holds a single tab
stop — the chosen radio, or the first while nothing is chosen — so Tab steps
over the whole question in one press, and the arrows move inside it. Moving is
choosing: arrowing onto a radio chooses it, which is what native radios do and
what lets a keyboard answer the question with one press per option instead of
two. All four arrows move whatever the `orientation` says, Home and End jump to
the ends, and Space chooses whatever has focus, which is how a group entered
with nothing chosen gets its first answer. There is no typeahead, because in a
group where moving chooses, a stray keystroke would quietly change the answer.

| `<v-radio-group>` | Type | Means |
|---|---|---|
| `value` | `Signal.State<string \| null>` | Your signal. `null` is nothing chosen |
| `defaultValue` | `string \| null` | Chosen from the start, when the group owns the answer |
| `name` | `string` | What every radio submits under, and what makes the hidden inputs one group; without it the group submits nothing |
| `loop` | `boolean` | Arrows wrap past the first and last radio. Default true |
| `orientation` | `'vertical' \| 'horizontal'` | How the sheet lays the radios out, and what `aria-orientation` says. Default vertical. It does not change the keyboard |
| `label` | `string` | The question the radios answer, for a group with no heading of its own |
| `labelledBy` | `string` | Id of the element that asks it — a heading, a legend |
| `aria-label` | `string` | The same name, written the platform's way. It wins over `label` |
| `aria-labelledby` | `string` | The same id, likewise |
| `disabled` | `boolean` | Refuses every radio at once, and is written through to the inputs |
| `required` | `boolean` | Written through to every input, so the platform enforces it on submit |
| `onValueChange` | `(value: string \| null) => void` | Called with the value a user chose, and with `null` when a reset puts back a group that started empty |

| `<v-radio>` | Type | Means |
|---|---|---|
| `value` | `string` | Identifies the choice: it is what the group holds and what the form submits |
| `disabled` | `boolean` | Refuses this one. The arrows step over it and it never holds the group's tab stop |

Slots: the content of `<v-radio-group>` is the radios, and the content of a
`<v-radio>` is its words — drawn *inside* the control, which is how a radio
takes its accessible name from its own contents, so a choice written this way
needs no `label`. The circle and the dot in it are the sheet's, and have no
slot: which radio is chosen is the one thing here a reader must not be able to
miss, and it is said in a channel a forced palette cannot flatten.

**The group has to be named, and it cannot name itself.** A `radiogroup` takes
no accessible name from the radios inside it — the words belong to each answer,
not to the question — so without `label`, `labelledBy` or `aria-label` a screen
reader announces the answers and never the question. Point `labelledBy` at the
heading you already wrote, rather than saying it twice:

```html
<h3 id="plan-heading">Billing plan</h3>
<v-radio-group :value="plan" name="plan" labelledBy="plan-heading">…</v-radio-group>
```

`defaultValue`, `name` and `loop` are read once, while the primitive is built,
so they are not signals and changing one later does nothing — which is why they
are written down here. Everything else follows whatever you bind it to:
`orientation`, `disabled`, `required`, both names, the answer itself, and both
props on `<v-radio>`.

What you write on either tag lands on the element carrying the role. On the
group that is the `radiogroup` itself; on a radio it is the element with
`role="radio"` — the circle and its words — and not the `<label>` around that
row, which carries no role and is not reachable from the tag at all. So a class
that lays out the whole question goes on `<v-radio-group>`, whose sheet already
stacks the rows and spaces them, and a class on `<v-radio>` styles the answer
it names.

Behind each radio is a real `<input type="radio">`, visually hidden and
carrying the value under the group's `name`. It is the half that submits, that
`FormData` reads, that `form.reset()` puts back, and that the browser validates
`required` against — the constraint goes on every input, because it belongs to
the group and the platform treats them all as satisfied the moment one is
checked. A press on a row is forwarded by the `<label>` to the input it labels;
the primitive swallows that forwarded press and points every input back at the
value the group holds, so what is submitted is always what is on screen.

Two radios in one group carrying the same value throws in development. A value
identifies a choice, so both would draw as chosen and both would submit.

A disabled radio is this package's one exception to keeping a disabled control
reachable: the arrows step over it and it never holds the group's tab stop,
which is what a native radio group does — and it follows that a group disabled
as a whole has no tab stop at all. Chosen and disabled, a radio hands the stop
to the first radio that can take it — in a group of numbers, to the nearest
below it — so the answer can still be changed. The stop is placed again
whenever the radios change — enabled, disabled, or drawn from data that has
just arrived — so the group is not left where Tab steps over it. A server
writes it on the chosen radio, or, while nothing is chosen, on the first radio
that can take it; a choice whose radio is disabled, or that names none of the
radios, has its stop once a script has read the page. Enter is left to the
form, so a group inside one does not steal the submit.

Moving is choosing, which is worth remembering if answering costs something.
Arrowing from the first option to the fourth calls `onValueChange` four times;
do the expensive part when the form is submitted, or from the value settling,
rather than from every change.

For anything this does not offer, take the primitive:

```html
<v-radio-group :ref="plans" name="plan" label="Billing plan">…</v-radio-group>
```

```ts
plans: VRadioGroup | null = null;
/** What the "recommended" button beside the group presses. */
recommend(): void { this.plans?.radioGroup.select('yearly'); }
```

What you write on either tag that this has no opinion about is left where it
lands: `aria-describedby` pointing at a hint, a `data-` attribute of your own,
and the ARIA spellings of states the group is not in — a group you named
`aria-required` yourself keeps it, because a group that was never told it is
required has nothing to say there rather than something to take away.

## `<v-switch>`

`createSwitch`, with the markup written: a track, a thumb that slides along it,
the words that name it, and the hidden input that submits. The state is one
signal both sides hold — pass `checked` and it is yours to read and write, pass
nothing and the switch owns it.

<Demo name="switch" height="300" />

```html
<v-switch :checked="notify" name="notify">Email me about replies</v-switch>
```

A switch is not a checkbox in a different shape. It says a setting is on or
off, and it takes effect where it stands rather than waiting for a form to be
sent; it has no third state, because "partly on" is not a setting. Reach for it
when flipping it *does* something, and for [`<v-checkbox>`](#v-checkbox) when
the answer is collected and submitted with the rest.

The words are the default slot and they are drawn *inside* the control, which
is how it takes its accessible name from its own contents — so a switch written
this way needs no `label` and no id pointing at one. A bare track has nothing to
be named from, and is named with `label` instead — or with `aria-label`, which
is the same thing in the spelling the platform already has.

| Prop | Type | Means |
|---|---|---|
| `checked` | `Signal.State<boolean>` | Your signal, when the setting is yours |
| `defaultChecked` | `boolean` | Where it starts, when the switch owns its state |
| `name` | `string` | Submitted as `name=value` while on; without one it submits nothing |
| `value` | `string` | What is submitted under that name. Default `on`, as a native checkbox sends |
| `label` | `string` | Names a switch that has no words written inside the tag |
| `labelledBy` | `string` | Id of the element that names it, when something on the page already does |
| `aria-label` | `string` | The same name, written the platform's way |
| `aria-labelledby` | `string` | The same id, likewise |
| `aria-describedby` | `string` | Ids of what describes it — a hint, a line saying what it costs |
| `disabled` | `boolean` | Refuses the press and the keyboard, and is written through to the input |
| `required` | `boolean` | Written through to the input, so the platform enforces it on submit |
| `onCheckedChange` | `(checked: boolean) => void` | Called with the setting it moved to, as it moves |

Slots: the default one is the words, and `thumb` is what is drawn inside the
thumb, handed `{ checked }` for a mark that differs between the two settings.
The thumb is empty unless something is written for it:

```html
<v-switch :checked="notify">
  <template :slot-thumb="{ checked }">
    <svg viewBox="0 0 16 16" aria-hidden="true" width="10" height="10">
      <path :d="checked ? 'M3 8l4 4 6-8' : 'M4 4l8 8M12 4l-8 8'"
            fill="none" stroke="currentColor" stroke-width="2" />
    </svg>
  </template>
  Email me about replies
</v-switch>
```

Draw it in `currentColor`. The thumb's own colour flips with the setting, so a
mark that follows it stays legible against the knob it sits on; a colour of its
own will be right in one setting and wrong in the other.

`defaultChecked`, `name` and `value` are read once, when the primitive is
built, so they are not signals and changing them later does nothing — which is
also why they are written down here. `checked`, `disabled`, `required` and
everything that names or describes the control follow whatever you bind them
to.

Behind the track is a real `<input type="checkbox">`, visually hidden and
carrying the value. Immediate is the promise a switch makes to the reader, not
a reason to leave the platform out: the input is what submits when a switch
does sit in a form, what `FormData` reads, what `form.reset()` puts back, and
what the browser validates `required` against. It is hidden by clipping rather
than by `display: none`, because the browser refuses to submit an invalid
control it cannot focus and then has nowhere to say why. There is no native
`switch` attribute on it, and that is deliberate: the attribute changes how the
platform paints a checkbox, and this one is never seen.

One thing about the markup is worth knowing before you write CSS against it.
What you write on the tag — a class, an id, a `data-*`, any ARIA — lands on the
control, the element carrying `role="switch"`, and not on the `<label>` that
wraps the row. That is the element a reader announces, so it is the one a name
has to reach; it is also the row of track-and-words, which is what you would
have put a class on by hand. The `<label>` around it is what makes a press
count exactly once, whether it landed on the track or on the text. `role` is
the exception and stays the primitive's: a control that announces itself as
something other than a switch is a different control, and writing the word on
the tag would not make the rest of it behave like one.

Space toggles and Enter is left alone, so a switch inside a form does not steal
the submit. A disabled switch keeps its place in the tab order —
`aria-disabled`, not the `disabled` attribute, this package's rule for every
disabled control — while the input behind it carries the real `disabled`, so
nothing about it submits.

Which way the switch is set is information, and the sheet says it three times:
the track's fill, the thumb's fill, and where along the track the thumb has come
to rest. The last one is the one that survives a reader's own palette, which
flattens hue and leaves shape and position alone — and when the palette is
forced the ring round an on track doubles in width besides. A filled track and
an empty one that differed only in colour would be the same track to that
reader.

The travel is `margin-inline-start`, transitioned over `--volt-duration-fast`,
rather than a translation. A translation runs along the physical inline axis and
would send the thumb the wrong way in a right-to-left page, and the usual repair
— a rule selecting `[dir='rtl']` — is one this sheet cannot write, since every
selector in it names a class the markup carries. If you replace the rule, keep
the logical property. The duration is a token like every other, so
`prefers-reduced-motion` is already honoured and there is no media query to add.

For anything this does not offer, take the primitive:

```html
<v-switch :ref="notify" name="notify">Email me about replies</v-switch>
```

```ts
notify: VSwitch | null = null;
turnOff(): void { this.notify?.switch.setChecked(false); }
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

## `<v-number-input>`

`createNumberInput`, with the markup written: the label, a box with a button
each way at its inline end, a line of help and the validation message. A
number field in the reader's locale — typed and shown as "1.234,56" on a
German page and "1,234.56" on an English one, and submitted as `1234.56`
either way.

<Demo name="number-input" height="520" />

```html
<v-number-input
  :value="quantity"
  label="Quantity"
  name="quantity"
  :min="1"
  :max="99"
  description="Up to 99 per order."
  required
  :prop-error="refused.get()"
></v-number-input>
```

The box is `type="text"` with `role="spinbutton"`, and the reason is locales:
a native number input treats "1.234,56" as bad input and hands back an empty
string. So the primitive parses and formats through `Intl`, and a hidden input
beside the box carries the canonical spelling into the form — what `FormData`
reads and what a server receives is the number, whatever the box says. What
the platform would have checked for `type="number"`, the range and the step,
the primitive checks instead and says through the field's own message, so the
browser still refuses the submit for the reason on screen.

It is `<v-input>`'s field with a spinbutton in the middle: the same four
parts, the same ids tying them together, the same moment validation is first
allowed to speak. What is its own is the row the box sits in and the two spin
buttons at its inline end, which the primitive names, steps, and switches off
at the ends of the range.

| Prop | Type | Means |
|---|---|---|
| `value` | `Signal.State<number \| null>` | Your signal, when the number is yours. `null` is empty |
| `defaultValue` | `number \| null` | Where it starts when the value is the field's own, and what a reset goes back to |
| `id` | `string` | The box's id, and so the label's `for` |
| `name` | `string` | Submitted as `name=value`, from the hidden input; without one the field submits nothing |
| `placeholder` | `string` | Shown in an empty box |
| `min`, `max` | `number` | The range. The arrows stop at each end, and a typed value outside it is pulled back or reported |
| `step` | `number` | How far one arrow press moves. Default 1. Not a constraint unless `enforceStep` says so |
| `largeStep` | `number` | How far PageUp and PageDown move. Default ten steps |
| `enforceStep` | `boolean` | Report a value off the step's grid as invalid. Default false |
| `clampOnBlur` | `boolean` | Pull a value outside the range back into it when the field is left. Default true; `clampOnBlur="false"` reports it instead |
| `locale` | `string` | The locale to read and write in, for a field that is deliberately not the page's |
| `format` | `Intl.NumberFormatOptions` | How the number is written — a fixed precision, or a currency whose symbol comes first, as below. Default grouping, at the precision the step implies |
| `validate` | `(value, control) => string \| string[] \| void \| Promise<…>` | What the primitive cannot express. Nothing back is a pass. `value` is the box's text as typed — "1.234,5" on a German page — not the number; read it with `parseLocaleNumber` |
| `validateOn` | `'submit' \| 'blur' \| 'input'` | When it first validates. Default `submit` |
| `revalidateOn` | `'submit' \| 'blur' \| 'input'` | When it validates again afterwards. Default `input` |
| `labels` | `NumberInputLabels` | Your wording: `increase` and `decrease` for the buttons, `notANumber`, `tooSmall(min)`, `tooLarge(max)` and `notAStep(step)` for the value, and the field's own |
| `onValueChange` | `(value: number \| null) => void` | Called with the number on every change, or `null` for a box that is empty or unreadable |
| `label` | `string` | The words above the box |
| `description` | `string` | The line under it, shown whether or not the field is valid |
| `error` | `string` | A message of your own, shown at once and pushed into the control. The next change to the box lets go of it. Bound as `:prop-error` |
| `required` | `boolean` | Written through to the box, so the platform enforces it on submit |
| `disabled` | `boolean` | Written through as the platform's own `disabled`, on the box and on the hidden input that carries the number, so a disabled field submits nothing. Both buttons go dead with it |
| `readOnly` | `boolean` | Refuses edits and the arrows, keeps the tab stop, is never validated. The property's spelling, as on every field here; `readonly` on the tag is refused with a pointer to it |
| `aria-label` | `string` | Names the box in the platform's own spelling, instead of the label |
| `aria-labelledby` | `string` | Names the box from elsewhere, instead of the label |
| `aria-describedby` | `string` | Ids of anything else that describes it, added to the field's own two |
| `aria-valuetext` | `string` | How the value is read out — "5 guests" — in place of the field's own spelling |

Everything from `defaultValue` to `onValueChange` in the table is read once,
while the primitive is built, so binding one to a signal changes nothing after
the first render — `min`, `max`, `step`, `locale` and `format` among them.
`value`, `label`, `description`, `error`, `required`, `disabled`, `readOnly`
and the four ARIA props follow whatever you bind them to.

Slots: `label` and `description`, for words that are more than words —

```html
<v-number-input :value="quantity" name="quantity" :min="1">
  <template :slot-label>Quantity <abbr title="required">*</abbr></template>
  <template :slot-description>See the <a href="/limits">order limits</a>.</template>
</v-number-input>
```

Both elements stay what the field points `aria-labelledby` and
`aria-describedby` at, whatever is written into them. The glyphs on the two
buttons are the component's, and there is no slot for them: the buttons are
hidden from assistive technology and named by the primitive, so what is drawn
on them is decoration.

| Key | Does |
|---|---|
| ArrowUp / ArrowDown | One step |
| PageUp / PageDown | One large step |
| Home / End | `min` / `max`; with that end not set, the key is left to move the caret |
| Enter | Settles the typed text, then leaves the key to the form so it still submits |

All of them are the primitive's, and none of them answers while the field is
disabled or read-only, or with Ctrl, Alt or Meta held — a modified key is a
shortcut, not a nudge — or while an input method is composing, when the arrows
choose among its candidates and Enter commits one.

**The numbers can be written either way.** `:min="1"` binds a number, and
`min="1"` arrives as its spelling, which the component reads as the number it
names before the primitive sees it — a step that reached the primitive as the
string `"1"` would add itself to the value as text. A spelling that names no
number is no number at all: `max="ten"` is no maximum. The two flags are read
the same way — bare is on, and `clampOnBlur="false"` and `enforceStep="false"`
are off, where the truthy string they arrive as would have left them on — and
a `locale` or an `id` that comes to nothing, a setting still loading, is not
said at all rather than handed to `Intl`, which throws on an empty locale.

**A step is how far the arrows move, not a rule about the value.** A native
number input rejects `1.5` against its default step of `1`, which is the
single most complained-about thing it does; here `1.5` is accepted, and an
arrow press from it lands on `2.5`. Write `enforceStep` when the grid is a
constraint, and the field reports a value off it rather than moving it.

**What is typed is not reformatted under the caret.** The value follows the
text on every keystroke — `"1.50"` is 1.5 and stays `"1.50"` on screen — and
the box is rewritten only when the field is left, when an arrow or a button
moves the value, or when your signal is written from outside. Text that is not
a number is kept as typed and the value becomes `null`, and the field says
"Enter a number." rather than erasing what was rejected — at the moment
`validateOn` names, like any other verdict. Decoration is dropped on the way
in, so "$1,234.56" pasted into a price field is 1234.56.

**A format is read back as well as written.** Whatever `format` writes is what
the field parses when it is left, so a format has to be one the parser reads.
A fixed precision does, and so does a currency whose symbol comes first — `$`,
`£`, `€` in English, `¥` in Japanese. Text written after the number does not
yet: `1.5 kg`, or the euro on a German page, `1.234,50 €`, is misread as a
number ten or a hundred times larger, and leaving the field writes that number
back. `percent` is misread too, because "25%" comes back as 25 rather than
0.25. None of those is one to ship: put the unit in the label instead, as the
demo does with its weight, and write a rate as the number of percent.

**The two buttons are not controls a screen reader meets.** They are
`tabindex="-1"` and `aria-hidden="true"`: the spinbutton is the tab stop and
its arrow keys do the same job, so a second and third stop per field would be
noise. A press on one leaves focus where it was rather than on the button, so
the arrow keys stay with the box. A button with nowhere left to go is left in
the row and disabled rather than removed, so the row does not move under the
pointer. They mirror in a right-to-left page, since the sheet lays them out in
logical properties: after the box in a left-to-right page, before it in a
right-to-left one.

**The message is the field's, and yours goes in through `error`.** A value
the locale cannot read, one outside the range, or one off an enforced step is
reported by the primitive in the same line the platform's `required` is, and
`labels` is where the wording lives — `tooLarge` is handed the maximum
already formatted. A verdict of your own — a server saying there are only two
left — is `error`: shown at once, and pushed into the control with
`setCustomValidity`, so the browser refuses the next submit over the same
sentence. It is bound as `:prop-error`, because `error` is a DOM event's name
as well and `:error` on any tag is read as a listener for it; written out,
`error="…"` is a prop like any other.

The next change to the box lets go of it — typed, stepped by an arrow or a
button, or written from your own `value` — the platform at once, so the next
submit is not refused on the old value's account, and the prop with it, so
what you read back agrees. A message that survived every correction would be a
form nobody could submit. What is bound to `error` is written in whenever it
changes, so the same words twice are a change only if your value was cleared
in between — clear it when you start checking:

```ts
refused = new Signal.State('');

order = async (event: Event): Promise<void> => {
  if (event.defaultPrevented) return;
  event.preventDefault();
  this.refused.set('');
  const left = await stock(this.quantity.get());
  if (left < (this.quantity.get() ?? 0)) this.refused.set(`Only ${left} left in stock.`);
};
```

Hand the message over once a write to `value` has reached the box, not in the
same turn: the write is a change to the box, and a change lets go of whatever
message came with it. A form reset lets go of it too, the prop with it. A
disabled or read-only field is never validated, so a message handed to one is
held rather than shown — and shown the moment the field is back in use, so a
page that takes its fields out of use while it asks a server can hand the
refusal over before or after it puts them back.

**A correction made in one keystroke is judged on what the box now says.**
The field is told of each edit before the number has read the box, so the
check it runs then is a check on the text from before the keystroke. Where
that leaves the field invalid under `revalidateOn="input"`, the default, the
component judges it again once the text is current — so "abc" typed over with
"5", or "x" backspaced away, clears "Enter a number." on screen and in the
platform, and the next submit goes. The other way round is not chased: a
number replaced in one keystroke by something that is not one is called wrong
at the next keystroke, or by the submit, which judges what the box then
says.

What you write on the tag lands on the box: a class joins the sheet's own
there, and so do a `title`, a `data-*` and any ARIA. The box is the control,
it is the element carrying the role, and it is the only one a name means
anything on; the row and the field around it are layout. `id`, `aria-label`,
`aria-labelledby` and `aria-describedby` are props for the reasons
[`<v-input>`](#v-input) gives: one id for both halves, a name of yours that
outranks the field's own reference, and a description added to the field's
two rather than written over them. `aria-valuetext` is a prop for the
spinbutton's own reason: the field writes one whenever its spelling says more
than the bare number — "1,234" for 1234 — and takes it away when it does not,
so yours, left to fall through, would be written over at one value and removed
at the next. Given, it wins; unsaid, the field's spelling is read out.

`disabled` here is the platform's own attribute, not `aria-disabled` alone:
the visible control is a native input, and only the attribute takes it out of
the form. Read-only keeps the tab stop and refuses the arrows as well as the
keys, since a value that is not the user's to change is not theirs to nudge
either.

The sheet entry is `number-input`, and it is small on purpose: the label, the
box, the help and the message wear the shared `field` entry, so CSS you write
against `.volt-field-control` reaches this box with every other. What is its
own is `volt-number-input`, the row, and `volt-number-input-button`, the two
buttons — drawn from `:disabled`, which the primitive writes on whichever has
nowhere to go, and on both while the field is disabled or read-only. A dead
button keeps its look once the palette is the user's, in `GrayText`, since it
says the value is at the end of its range.

For anything this does not offer — moving the value from elsewhere, reading
the text as it is being typed — take the primitive:

```html
<v-number-input :ref="quantity" label="Quantity" :min="1" :max="99"></v-number-input>
```

```ts
quantity: VNumberInput | null = null;
more(): void { this.quantity?.number.increment(); }
typed(): string { return this.quantity?.number.text() ?? ''; }
```

## `<v-password-input>`

`createPasswordInput`, with the markup written: the label, the box, a toggle
that shows what is in it, a line of help and the validation message. It is
`<v-input>`'s field with a password in the box — the same four parts, the same
ids tying them together, the same moment validation is first allowed to speak —
and what is its own is the toggle at the inline end, and the two ways the
primitive says what a press of it did.

<Demo name="password-input" height="520" />

```html
<v-password-input
  :value="password"
  label="Password"
  name="password"
  required
  :prop-error="refused.get()"
></v-password-input>
```

The toggle is named `Show password` and then `Hide password`, which is what a
screen reader reads next time it lands on it — and a live region says
`Password shown` as well, because a name that changes as a result of pressing
the thing it names is not reliably announced at the moment it changes. Both
are the primitive's. The region is drawn whether or not anything has been
pressed, since a region that arrives together with its message announces
nothing, and the sheet keeps it off the screen without taking it out of the
accessibility tree.

| Prop | Type | Means |
|---|---|---|
| `value` | `Signal.State<string>` | Your signal, when the text is yours |
| `revealed` | `Signal.State<boolean>` | Your signal for whether the password is on the screen, when you need to drive it |
| `defaultRevealed` | `boolean` | Start with it on the screen, when the state is the field's own |
| `defaultValue` | `string` | Where it starts when the value is the field's own, and what a reset goes back to |
| `id` | `string` | The box's id, and so the label's `for` and the toggle's `aria-controls` |
| `name` | `string` | Submitted as `name=value`; without one the field submits nothing |
| `autoComplete` | `'current-password' \| 'new-password'` | Default `current-password`. `new-password` keeps a password manager from filling in the one it holds, and lets it offer a generated one |
| `placeholder` | `string` | Shown in an empty box |
| `minLength`, `maxLength` | `number` | Enforced by the platform, and worded by it |
| `pattern` | `string` | A regular expression the whole value has to match |
| `validate` | `(value, control) => string \| string[] \| void \| Promise<…>` | What the platform cannot express. Nothing back is a pass |
| `validateOn` | `'submit' \| 'blur' \| 'input'` | When it first validates. Default `submit` |
| `revalidateOn` | `'submit' \| 'blur' \| 'input'` | When it validates again afterwards. Default `input` |
| `labels` | `PasswordInputLabels` | Your wording: `show` and `hide` for the toggle's two names, `shown` and `hidden` for what the region says, and what the platform found wrong |
| `onValueChange` | `(value: string) => void` | Called with the text, on every edit |
| `onRevealedChange` | `(revealed: boolean) => void` | Called when a press, or a call on the primitive, shows or hides it — not when your own `revealed` is set |
| `label` | `string` | The words above the box |
| `description` | `string` | The line under it, shown whether or not the field is valid |
| `error` | `string` | A verdict of your own, shown at once and pushed into the control. Bound as `:prop-error` |
| `required` | `boolean` | Written through to the box, so the platform enforces it on submit |
| `disabled` | `boolean` | Written through as the platform's own `disabled`, on the box and on the toggle |
| `readOnly` | `boolean` | Refuses edits, keeps the tab stop, is never validated. The toggle stays in use |
| `aria-label` | `string` | Names the box in the platform's own spelling, instead of the label |
| `aria-labelledby` | `string` | Names the box from elsewhere, instead of the label |
| `aria-describedby` | `string` | Ids of anything else that describes it, added to the field's own two |

Everything from `defaultRevealed` to `onRevealedChange` in the table is read
once, while the primitive is built, so binding one to a signal changes nothing
after the first render — `autoComplete` and `labels` among them. `value`,
`revealed`, `label`, `description`, `error`, `required`, `disabled`,
`readOnly` and the three ARIA props follow whatever you bind them to.

Slots: `label` and `description`, for words that are more than words, and
`toggle`, for a toggle that is not words at all —

```html
<v-password-input :value="chosen" name="new-password" autoComplete="new-password">
  <template :slot-label>New password <abbr title="required">*</abbr></template>
  <template :slot-toggle="{ revealed }">
    <span class="icon" aria-hidden="true">
      <svg :if="!revealed">…</svg>
      <svg :else>…</svg>
    </span>
  </template>
</v-password-input>
```

The `toggle` slot is handed `revealed`, live, so an icon pair picks its half
from it. Keep the pair inside one element, as above: a `:if`/`:else` chain
written straight into the slot is not drawn until the state first changes. Left empty, the toggle shows its name — `Show password`, then `Hide
password`, in whatever language the name is in: `labels`, the locale
catalogue, or the default. The words a sighted user reads are then the words a
screen reader hears, and renaming the toggle renames what is seen without a
second prop to keep in step. Make an icon pair `aria-hidden`: the name is the
primitive's and stays whatever is drawn, and an icon that is read out as well
is read out twice. The label and the description stay the elements the field
points `aria-labelledby` and `aria-describedby` at, whatever is written into
them.

The toggle is a real `<button type="button">`. It never submits the form
around it, Enter and Space on it are the platform's own, it takes the tab stop
after the box, and nothing of it goes into `FormData` — the box is the one
control the form has. It goes out of use with `disabled`, as the platform's own
attribute, for the reason the box does: a disabled field is not part of the
form, and a toggle a keyboard could still reach would show a password nobody
can edit. It never goes out of use with `readOnly`. A value that cannot be
edited can still be looked at, and reading it back is the whole reason a
read-only password field would exist.

`error` is for a verdict the platform cannot reach on its own — a server
saying the password is wrong for this account. It is shown at once, in the
message line, and pushed into the control with `setCustomValidity`, so the
browser refuses the next submit for the reason on screen; whatever the
platform itself found wrong is listed first, in its own wording. It is bound
as `:prop-error`, because `error` is a DOM event's name as well and `:error`
on any tag is read as a listener for it. Written out, `error="…"` is a prop
like any other.

The next edit lets go of it, as it does any message: the platform at once, so
the next submit is not refused on the old value's account, and the screen when
`revalidateOn` says so — at once under the default `input`, at the next blur
under `blur`. A message that survived every correction would be a form nobody
could submit. Writing into the box from your own `value` signal is an edit too,
but a refusal that arrives in the same moment as the box is emptied is still
said, whichever of the two you set first.

What the edit does not touch is the prop. It stays what you bound — the
component never writes over it — and a signal set to the string it already
holds has not changed, so the same words after a second wrong attempt would
say nothing. Clear yours as each attempt starts:

```ts
refused = new Signal.State('');

signIn = async (event: Event): Promise<void> => {
  if (event.defaultPrevented) return;
  event.preventDefault();
  this.refused.set('');
  const ok = await check(this.password.get());
  if (!ok) this.refused.set('That is not the password for this account.');
};
```

A disabled or read-only field is never validated, so a refusal that arrives
while the field is out of use — a page that disables it while it asks the
server, and hands it back after a pause — is held rather than shown, and said
the moment the field is back in use. One an edit has let go of in the
meantime stays gone; taking the field out of use and back says nothing new
about the value.

What you write on the tag lands on the `<input>`: a class joins the sheet's
own there, and so do a `title`, a `data-*` and any ARIA. The box is the
control, it is the element carrying the role, and it is the only one a name
means anything on; the row around it and the toggle beside it are the sheet's.
The same four attributes are exceptions as on `<v-input>`, for the same
reasons. `id` is a prop so that the id the label's `for` and the toggle's
`aria-controls` point at is the one the box carries. `aria-labelledby` is a
prop because the field already points it at the label, and yours wins.
`aria-label` is a prop because landing it on the box is not enough to make it
the name — the field's reference outranks it — so writing one stands that
reference down, and the `for` stays. `aria-describedby` is a prop because the
field already points it at the help and the message; yours is added after
them. All three are read as unsaid when what you bind them to comes to
nothing.

The box asks for none of the help a text box gets — `spellcheck="false"` and
`autocapitalize="off"`, because a password is not a word and a spellchecker's
dictionary is not where it belongs. Revealing it changes the box's `type` and
keeps its value. When the box has focus at the moment it changes — a shortcut
that calls `password.toggle()`, say — the primitive puts the caret and the
selection back as well, since some engines drop them when the type changes
under them.

Nothing hides the password again on its own: not a submit, not leaving the
page. Some browsers keep what a text box submitted in their autofill history,
and a password revealed at the moment a form is sent is in a text box. A page
that posts the form natively hides it in its submit handler, and flushes, so
the box is a password box again before the browser reads it:

```html
<form method="post" :submit="send()">
  <v-password-input :ref="handle" label="Password" name="password"></v-password-input>
</form>
```

```ts
handle: VPasswordInput | null = null;

send(): void {
  this.handle?.password.hide();
  flushSync();
}
```

The sheet entry is `password-input`, and it draws only what the field does
not: the row that puts the toggle at the inline end of the box, the toggle,
and the live region. The label, the box, the help and the message are
`field`'s, so CSS you write against `.volt-field-control` reaches this box as
it reaches every other. The toggle's rules select on `data-state` — `hidden`
or `revealed`, which the primitive writes — and on `:disabled`, which the
markup writes from the field's flag. Revealed is drawn, in the accent and,
when the palette is the user's, in its emphasis pair, under the pointer as
well as away from it: a password on the screen is something a user has to be
able to see at a glance, before reading the words in the button. A toggle out
of use is `GrayText` in that palette whichever state it was left in.

A revealed toggle is also taken out from under that palette, with
`forced-color-adjust: none`. Left under it, Chrome paints a backplate of
`Canvas` behind every run of text, and `HighlightText` is that same colour, so
the one control that hides the password again would show a blank where its
name was. Everything it paints is still a colour from the palette, and an icon
in the `toggle` slot drawn in `currentColor` takes the words' colour. The
palette no longer replaces anything there, so CSS you write against a revealed
toggle under `forced-colors: active` is drawn exactly as written: keep it to
system colours.

For anything this does not offer, take the primitive:

```html
<v-password-input :ref="handle" label="Password" name="password"></v-password-input>
```

```ts
handle: VPasswordInput | null = null;
left(): number | null { return this.handle?.password.remaining() ?? null; }
reject(why: string): void { this.handle?.password.field.setCustomValidity(why); }
```

## `<v-pin-input>`

`createPinInput`, with the markup written: the label, one box per character,
a line of help and the validation message. The code is one signal both sides
hold — pass `value` and it is yours to read and write, pass nothing and the
field owns it.

<Demo name="pin-input" height="380" />

```html
<v-pin-input
  :value="code"
  name="code"
  label="Verification code"
  description="Sent by text message."
  required
  :onComplete="verify"
></v-pin-input>
```

The boxes are a presentation of one value, and they behave as one field. A
paste into any box fills them all — a code copied from a message arrives with
the spaces it was sent with, and those are dropped — Backspace in an empty box
goes back and deletes, deleting a character shifts the rest along, and the
group holds a single tab stop with the arrows moving inside it, so Tab steps
over the whole code in one press rather than six. There are no holes: focusing
a box beyond the first empty one lands on the first empty one, because a code
with a gap in it is not a code.

What submits is a hidden `<input>` carrying the whole code under `name`. It is
the field's control — what `FormData` reads, what the platform validates
`required` against, what `form.reset()` restores — and the boxes borrow its
ARIA. A screen reader hears one field, named by the label and described by the
help and the message, and each box inside it as "Digit 3 of 6".

| `<v-pin-input>` | Type | Means |
|---|---|---|
| `value` | `Signal.State<string>` | Your signal, when the code is yours. Anything else is refused by name: `value="2468"` is `defaultValue` |
| `defaultValue` | `string` | Where the code starts when it is the field's own, and what a form reset goes back to |
| `length` | `number` | How many boxes. Default 6. `length="4"` means the number 4, as `:length="4"` does; bound to `undefined` it is the default |
| `type` | `'numeric' \| 'alphanumeric'` | What a box takes. Default `numeric`, which also asks a phone for its number pad; `alphanumeric` takes letters too and names each box a character. Anything else — `type="number"` — is refused rather than read as "anything but a space"; bound to `undefined`, the default |
| `mask` | `boolean` | Dots in place of the characters. Default off. Written bare — `mask` — or bound |
| `name` | `string` | Submitted as `name=code`; without one the field submits nothing |
| `autoComplete` | `string` | What the platform may fill in. Default `one-time-code`, given to the first box only |
| `labels` | `PinInputLabels` | Your wording: `box(position, length)` names each box — `Digit 3 of 6` in English otherwise — `incomplete` is the line an unfinished code is refused with, and the platform's messages besides |
| `onValueChange` | `(code: string) => void` | Called with the code on every edit |
| `onComplete` | `(code: string) => void` | Called with the code once every box is filled — once per completion, and again if a character is replaced |
| `label` | `string` | The words above the boxes |
| `description` | `string` | The line under them, shown whether or not the code is valid |
| `error` | `string` | Your verdict on the code, shown as the message and pushed into the control. Empty is no verdict |
| `required` | `boolean` | Written through to the hidden input, so the platform refuses a submit over an empty code, and said on every box in ARIA |
| `disabled` | `boolean` | Written through to every box as the platform's own `disabled`, and said once on the group |
| `aria-label` | `string` | Names the group in the platform's own spelling, instead of the label |
| `aria-labelledby` | `string` | Names the group from elsewhere, instead of the label |
| `aria-describedby` | `string` | Ids of anything else that describes it, added to the field's own two |

Slots: `label` and `description`, for words that are more than words —

```html
<v-pin-input :value="code" name="code">
  <template :slot-label>Code <abbr title="required">*</abbr></template>
  <template :slot-description>Sent to <b>+44 7700 900123</b>.</template>
</v-pin-input>
```

Both elements stay what the field points `aria-labelledby` and
`aria-describedby` at, whatever is written into them.

Everything from `defaultValue` to `onComplete` in the table is read once, while the
primitive is built, so binding one to a signal changes nothing after the first
render — which is why they are written down here. `value`, `label`,
`description`, `error`, `required`, `disabled` and the three ARIA props follow
whatever you bind them to.

**`onComplete` is the moment to send.** A one-time code has a known length, so
the last box being filled is the submit; a form that also waits for a press is
one the user has to find the button for. It is called once for each
completion — a paste that fills the row calls it once, and a character deleted
and retyped calls it again — and never for a reset, since a code put back whole
was not completed by anyone.

**`error` is bound as `:prop-error`.** It shares its name with a DOM event, and
on a component tag `:error="…"` is read as that event and refused. Written out
— `error="Codes expire after ten minutes."` — it is a prop like any other;
bound, the escape says which it is:

```html
<v-pin-input :value="code" :prop-error="problem.get()" :onValueChange="edited"
             :onComplete="check"></v-pin-input>
```

```ts
problem = new Signal.State('');
check = (code: string): void => {
  if (code !== expected) this.problem.set('That code is wrong.');
};
edited = (): void => this.problem.set('');
```

The verdict is pushed into the hidden input with `setCustomValidity`, so the
browser refuses the submit for exactly the reason on screen. The field lets it
go on the next edit, as it does any message — the user is fixing the code, and
a message that outlives its correction is how a form becomes impossible to
submit. Clear the signal in `onValueChange`, as above: a signal set to the
string it already holds has not changed, so a second wrong attempt would
otherwise say nothing. And since a verdict is the field's first validation,
every edit after it re-validates, which for a code that is not yet whole says
"Enter all the characters." until it is.

While it stands, the verdict is the line on screen, ahead of anything the
platform says. A page that empties a wrong code and says why — `pin.clear()`,
then the verdict — leaves a `required` row empty, and the platform has a
complaint of its own about that; the control refuses with your words, so the
screen shows them too. A verdict that arrives while the field is `disabled` —
the page took it out of use while it asked the server — is held until the
field is back, and shown then: a disabled field validates as valid, and one
handed over before that would be judged no complaint and lost.

Nothing is invalid before something says so. An empty code is `required`'s
business, worded by the platform on submit, and a half-typed one is the
primitive's — "Enter all the characters.", in the locale's words where it has
them — reported on the group and marked on every box, because six copies of
one message is six announcements of one mistake.

What you write on the tag lands on the group: a class joins the sheet's own
there and lays the row out, and so do a `title`, a `data-*` and any ARIA. The
group is the element carrying the role, and the only one a name means anything
on; the `<div>` around it is layout. The three ARIA props are exceptions for
the reason `<v-input>`'s are: the field already points `aria-labelledby` and
`aria-describedby` at its own parts, and `aria-label` written beside that
reference would be outranked by it. Write one and the field stands its
reference down; write `aria-labelledby` and yours replaces it; write
`aria-describedby` and yours is added after the help and the message. The
label's `for` points at the box where the next character goes — the first,
until something is typed — rather than at the hidden input, either way. A
press on the words puts the caret where typing resumes, as Tab does, rather
than on a first box whose character the next keystroke would replace.

`disabled` is the platform's own attribute on every box, as it is on
`<v-input>`: the boxes are native inputs, and only the attribute takes them out
of the form. There is no `readOnly`, because a code is entered once and read
by nobody.

`required` is the hidden input's, which is what the platform validates, and
in ARIA it is on every box rather than on the group. `aria-required` belongs to
a widget a value is typed into, and a group is not one: written there it is
announced by nothing and reported by every checker. The date picker's segments
carry it for the same reason.

Rendered on a server, the field goes out whole: the group named by its label
and described by its help and message, and the code it starts with in the
boxes and in the hidden input, so a submit before the page attaches still
sends it. A verdict is the exception — it is handed to the field once the
control exists, so `error` reaches the screen when the page attaches.

`mask` is off by default on purpose. A one-time code being copied off a text
message is not a secret, and dots over it hide the mistake the user is about to
make; turn it on for a passcode that is.

`mask`, `required` and `disabled` are on written bare and off written as
`"false"`, the same as bound to `false`: an attribute is a string, and
`disabled="false"` taking the field out of the form is not what anybody wrote it
for.

The sheet entry is `pin-input`, and it draws the row and the boxes only — the
label, the help and the message are `field`'s, so CSS you write against
`.volt-field-label` reaches this component too. A box is square, its glyph
centred, and the rules select on three things the primitive writes: `tabindex`,
which is `0` on exactly one box, the one where the next character goes, drawn
as a thicker lower edge in the accent; `aria-invalid`, on every box of a
refused code, every edge in the danger colour — the caret's too, which keeps its
width, so the box the user is on is still told apart; and `:disabled`. The
caret is not drawn on a disabled box: the field keeps its tab stop for when it
comes back, but an accent edge saying "type here" over a box nobody can type
into is a promise it breaks. Under a forced palette the refusal is a doubled
edge and the caret is the one edge in `Highlight`. `data-filled` is the
character itself and is not drawn, and `data-complete` on the group says
nothing a full row of glyphs does not.

For anything this does not offer, take the primitive:

```html
<v-pin-input :ref="handle" label="Code" name="code"></v-pin-input>
```

```ts
handle: VPinInput | null = null;
whole(): boolean { return this.handle?.pin.isComplete() ?? false; }
again(): void { this.handle?.pin.clear(); }
```

## `<v-slider>`

`createSlider`, with the markup written: a track, the span filled along it, and
a thumb per value with `role="slider"` — one thumb for a slider, two for a
range, decided by how many numbers the value holds rather than by a flag.

<Demo name="slider" height="460" />

```html
<v-slider :value="volume" label="Volume" name="volume"></v-slider>

<v-slider
  :value="price"
  label="Price per night"
  name="price"
  step="5"
  :format="pounds"
  :marks="[{ value: 0, label: '£0' }, { value: 50, label: '£50' }, { value: 100, label: '£100' }]"
  :onValueCommit="search"
></v-slider>
```

```ts
volume = new Signal.State<readonly number[]>([40]);
price = new Signal.State<readonly number[]>([20, 80]);
pounds = (value: number): string => `£${value}`;
```

Each thumb takes the WAI-ARIA slider keys: the arrows move one `step`, PageUp
and PageDown ten, and Home and End go to the ends of *that thumb's* range. A
press on the track moves the nearest thumb there and picks it up, so the value
follows the pointer from the first frame, and focus goes to the thumb that
moved so the arrows carry on from it. Thumbs never pass each other: each one is
held between its neighbours, and its `aria-valuemin` and `aria-valuemax` say
so, which is why a screen reader hears the low thumb's range shrink as the high
one comes down to meet it.

Behind every thumb is a real `<input type="range">`, visually hidden, which is
what submits with the form, what `form.reset()` puts back, and what the
platform range-checks. A range therefore submits `name` twice, low then high —
read it on the server as a list, not as one field.

| `<v-slider>` | Type | Means |
|---|---|---|
| `value` | `Signal.State<readonly number[]>` | Your signal. One number for a slider, two for a range — a list either way |
| `defaultValue` | `number \| readonly number[]` | Where it starts, when the value is the slider's own. `defaultValue="20, 80"` spells a range as an attribute. Default the minimum |
| `min`, `max` | `number` | The ends of the track. Default 0 and 100 |
| `step` | `number` | What every value is rounded to, and what one arrow press moves. Default 1 |
| `orientation` | `'horizontal' \| 'vertical'` | Which way the track runs. Vertical grows upwards. Default horizontal; any other word is refused, naming the tag, rather than written into `aria-orientation` |
| `name` | `string` | Submitted as `name=value` once per thumb; without one the slider submits nothing |
| `marks` | `readonly (number \| { value: number; label?: string })[]` | Ticks along the track. One with a `label` has words under it; one outside `min`–`max` is dropped. `marks="0, 50, 100"` spells bare ticks as an attribute |
| `label` | `string` | The name of the whole control, drawn above the track |
| `thumbLabels` | `readonly string[]` | A name per thumb, in order. Default "Minimum" and "Maximum" for a range, and the slider's own name for a single thumb. `thumbLabels="From, To"` spells the list as an attribute; a name with a comma in it needs the binding. A blank entry is no name, and leaves that thumb its default |
| `format` | `(value: number, index: number) => string` | What a screen reader hears in place of the number — `aria-valuetext`. Default the number written the locale's way. Bind it — `:format="pounds"`; `format="pounds"` hands over the word, and is refused |
| `aria-label` | `string` | Names the slider, and its one thumb, in place of `label`. A blank one is no name, and leaves `label` naming it |
| `aria-labelledby` | `string` | Id of whatever already names it. Wins over `aria-label` and `label`; a blank one wins over nothing |
| `aria-describedby` | `string` | Ids of whatever describes it, written on every thumb |
| `disabled` | `boolean` | Refuses the pointer and the keys, and is written through to the hidden inputs. Written bare or bound; `disabled="false"` is off |
| `onValueChange` | `(values: readonly number[]) => void` | Called with every value, including every frame of a drag |
| `onValueCommit` | `(values: readonly number[]) => void` | Called once a gesture ends — a drag let go of, or a key pressed |

Slots: `label`, which fills the element `label` draws, for a name that is more
than a line of text. The slot only has somewhere to go when `label` is set,
because `label` is what says there is a label at all — the thumbs point at that
element by id, and an empty one drawn for every slider would be a name of
nothing:

```html
<v-slider :value="price" label="Price">
  <template :slot-label>Price <small>per night</small></template>
</v-slider>
```

**`value` takes a signal, never a number.** Markup has no way to write a
signal, so `value="40"` hands over the string `"40"` — and the slider refuses
it, naming the tag, rather than rendering a group with no thumb in it. To
start at a number, write `defaultValue`; to read or drive the value, hold a
`new Signal.State<readonly number[]>([40])` and bind it with `:value`. The value
is always a list, even for one thumb, and a list of a different length is a
different number of thumbs: setting `[20, 80]` on a single slider gives it a
second thumb without remounting anything.

`onValueChange` fires on every pointer move of a drag. Send the value to a
server — a search, a filter, a save — from `onValueCommit`, which fires once
when the drag is let go of, and once per key press, since a key is a whole
gesture on its own.

`value`, `defaultValue`, `min`, `max`, `step`, `orientation`, `name`, `marks`
and both callbacks are what the primitive is *built* with, read once while the
component's fields initialize, so changing one later does nothing — which is
why they are written down here. Everything else follows whatever you bind it
to: `label`, `thumbLabels`, `format`, the three ARIA names, `disabled`, and the
numbers inside the value signal.

**How each thumb is named.** A name from `thumbLabels` is that thumb's own and
always wins. Without one, a single thumb is the control, so it takes whatever
names the group — `aria-labelledby`, then `aria-label`, then the drawn
`label` — and the thumbs of a range are named apart from the group, as
"Minimum" and "Maximum", so a reader hears "Price, Minimum" and learns which
end this is. A range's thumbs are never also given the group's name, which
would read as "Price Minimum Price". With nothing named at all, a lone thumb is
called "Value": name the slider, because "Value, slider, 40" tells nobody what
40 is.

What you write on the tag lands on the group, which is the element you can see
— a class sizes or spaces the whole slider, and `dir="rtl"` turns it round.
The three ARIA names are the exception: they are props, so a name reaches a
lone thumb as well as the group, a description reaches every thumb — the
thumbs are where focus lands and a description is read — and the group's own
bag, which points `aria-labelledby` at its label or at nothing, cannot write
over either.

Right to left, the track runs from the right and the arrows swap: Left raises
the value, as it does in every native right-to-left slider. Up and Down never
swap, in either orientation, because vertical order is not mirrored by
language. The sheet needs no rule for any of this — every position is written
on a logical edge, `inset-inline-start` along the track and `inset-block-end`
up it, which mirrors itself.

A disabled slider keeps every thumb in the tab order, marked `aria-disabled`
rather than given the `disabled` attribute, so a keyboard user can find it and
learn it is unavailable; the hidden inputs are disabled outright, so it submits
nothing. The sheet dims the whole control, and under a forced palette says it
in `GrayText` on every edge, every tick and every word of its scale instead.

The thumb's hit target is the whole thumb, 1.5rem — 24 pixels at the default
type size — which is wider than the track it rides, so one at either end hangs
half its width past the end and over both sides; the track's margins pay for
that, so the thumb stays inside the slider's own box. A tick with words under it asks for room beneath
the track, and the group takes it. A vertical slider has no height to take from
the page, so the group gives itself 10rem; set `block-size` with a class of
your own for another.

Under a forced palette the fill is `Highlight`, each thumb is `Canvas` with an
edge in `CanvasText`, a tick inside the fill is `HighlightText` and one outside
it `CanvasText`, and the focus ring is an outline, which the palette keeps.

The tag takes the props above and no others. For the rest of what
`createSlider` takes — `largeStep`, `minStepsBetweenThumbs`,
`inverted`, `snapToMarks`, `required`, `validate`, a description or an error
message — write the markup by hand around the primitive, with the same class
names. For reading or driving a slider the tag drew, take the primitive:

```html
<v-slider :ref="prices" :defaultValue="[20, 80]" label="Price" name="price"></v-slider>
```

```ts
prices: VSlider | null = null;
/** What the "under £50" button beside the slider presses. */
cheap(): void { this.prices?.slider.setValues([0, 50]); }
```

## `<v-tags-input>`

`createTagsInput`, with the markup written: the label, a box holding the tags
and a text input after them, a line of help, the validation message and a live
region. The tags are one signal both sides hold — pass `value` and it is yours
to read and write, pass nothing and the field owns it.

<Demo name="tags-input" height="460" />

```html
<v-tags-input
  :value="topics"
  name="topic"
  label="Topics"
  description="Up to five. Enter or a comma adds one."
  max="5"
  required
  :validate="oneWord"
></v-tags-input>
```

The tags are one tab stop and the text input is another, so a field holding
twenty tags costs two Tab presses rather than twenty-one. Enter or a separator
adds what is typed, a paste with separators or line breaks in it becomes several
tags at once, Escape takes back what is half-typed, and what is half-typed when
the field is left is added rather than lost. Backspace in an empty text input
takes the last tag away, and the back arrow there steps into the row, onto the
last tag. Along the row the arrows move, Home and End go to either end, Delete
and Backspace take away the tag under the keyboard, and the forward arrow off
the last tag steps back out into the text input. When the tag holding focus is
taken away — by a key, by its button, or by your own write to `value` — focus
goes to the tag that took its place, else the last tag, else the text input,
and never to `<body>` — with `allowDuplicates` as well, where two tags share
their words: the copy that goes is the one that was taken away, not the first
one that reads the same.

Adding and removing a tag changes the page without moving focus, which is
silence to a screen reader, so a polite live region under the field says what
was added, what was removed, and which tag a refused duplicate collided with.
That tag is marked in the row at the same moment, which for a sighted user is
the only sign that Enter was refused rather than ignored.

What submits is one hidden `<input>` per tag under `name`, so
`FormData.getAll('topic')` is the list and a server reads `topic=design&topic=rust`.
The text input is never submitted. `form.reset()` puts the row back to where it
started.

| `<v-tags-input>` | Type | Means |
|---|---|---|
| `value` | `Signal.State<readonly string[]>` | Your signal, when the tags are yours |
| `defaultValue` | `string \| readonly string[]` | Where the row starts when the tags are the field's own, and what a reset goes back to. Written as an attribute it is split on the separators: `defaultValue="design, rust"` |
| `id` | `string` | The text input's id, and so the label's `for` |
| `name` | `string` | Each tag submits as `name=tag`; without one the field submits nothing |
| `placeholder` | `string` | Shown in the empty text input |
| `max` | `number` | Most tags the row holds. `max="5"` means the number 5, as `:max="5"` does; anything but a whole number is an error when the field is built |
| `allowDuplicates` | `boolean` | Keep a tag that is already there. Default off. Written bare — `allowDuplicates` — or bound; `allowDuplicates="false"` is the false it says |
| `separators` | `string \| readonly string[]` | What ends a tag as it is typed, and splits a paste. Default a comma. Written as an attribute, every character is one: `separators=",; "` |
| `validate` | `(tag: string) => string \| null` | Your rule for one tag. A message refuses it; nothing back is a pass |
| `labels` | `TagsInputLabels` | Your wording: `list`, `remove`, `added`, `removed`, `duplicate`, `cleared`, and `empty` for `required` |
| `onValueChange` | `(tags: readonly string[]) => void` | Called with the tags whenever one is added or removed, and when a reset puts them back |
| `label` | `string` | The words above the box |
| `description` | `string` | The line under it, shown whether or not the field is valid |
| `error` | `string` | Your verdict on the row, shown as the message and pushed into the text input. Empty is no verdict |
| `required` | `boolean` | Refuses a submit while the row is empty |
| `disabled` | `boolean` | Written through to the text input as the platform's own `disabled`, and said on the box |
| `readOnly` | `boolean` | Refuses adding and removing, keeps both tab stops, is never validated |

`required`, `disabled` and `readOnly` are written bare or bound, as `allowDuplicates`
is, and `="false"` written on any of the four is the false it says rather than a
string that happens to be truthy.
| `aria-label` | `string` | Names the field in the platform's own spelling, instead of the label |
| `aria-labelledby` | `string` | Names the field from elsewhere, instead of the label |
| `aria-describedby` | `string` | Ids of anything else that describes it, added to the field's own two |

Slots: `label` and `description`, for words that are more than words, and
`tag`, for a tag that is more than its words —

```html
<v-tags-input :value="people" name="reviewer">
  <template :slot-label>Reviewers <abbr title="required">*</abbr></template>
  <template :slot-description>Anyone on <a href="/team">the team</a>.</template>
  <template :slot-tag="{ tag }"><img :src="avatar(tag)" alt=""> { tag }</template>
</v-tags-input>
```

The label and the help stay what the field points `aria-labelledby` and
`aria-describedby` at, whatever is written into them. A tag drawn through `tag`
is still the tag the row moves along and removes, and its button is still named
after the tag itself — `Remove ada` — rather than after whatever drew it.

Everything from `defaultValue` to `onValueChange` in the table is read once,
while the primitive is built, so binding one to a signal changes nothing after
the first render — `validate` and `onValueChange` aside, which are asked when
they are called, so a function the page rebinds is the one heard. `value`,
`label`, `description`, `error`, `required`, `disabled`, `readOnly` and the
three ARIA props follow whatever you bind them to.

**`required` is about the tags, not the text input.** An empty text input
beside five tags is a filled-in field, so the platform's own `required` is never
written to the text input; the field checks the row on submit and refuses an
empty one with "Add at least one tag.", or with `labels.empty`. The text input
says `aria-required` all the same, since it is the half of the field a screen
reader announces as editable.

**Two tags that differ only in case are one tag.** They are compared through
the locale's collator at accent sensitivity, so `Rust` beside `rust` is refused
and the existing one is marked, while `resume` and `résumé` are two. Turn on
`allowDuplicates` to keep every copy.

**At `max`, the next tag is refused without a word.** The box and the text input
are marked `data-full` and nothing is announced, because the row is exactly as
long as it was allowed to be. Say the limit in `description`, where it is read
before anyone reaches it.

**A refusal from `validate` is a message, not a mark.** The message is shown
under the field and pushed into the text input, so the browser would refuse a
submit over the same sentence; the text stays in the box to be fixed, and the
next edit takes the message away. A refused piece of a paste is left out and the
rest go in. `validate` is asked about a tag after the limit and before the
duplicate check, so it is never asked about a tag that `max` already refused.

**Enter is the form's when nothing is typed.** With text in the box Enter adds
it; with the box empty it submits the form, as it would from any other field.
A line break in a paste always splits, whatever `separators` says.

**`error` is bound as `:prop-error`.** It shares its name with a DOM event, and
on a component tag `:error="…"` is read as that event and refused. Written out
— `error="That list is closed."` — it is a prop like any other. The field lets
the verdict go on the next edit, as it does any message, so clear your signal
in `onValueChange` and set it again after the next attempt: a signal set to the
string it already holds has not changed, and says nothing.

What you write on the tag lands on the box: a class joins the sheet's own there,
and so do a `title`, a `data-*` and any ARIA. The box is the element carrying
the role, `group`, and the one a class lays out; the `<div>` around it is
layout. `id` is the exception that goes elsewhere: it is the text input's, so
the id the label's `for` points at is the one the element typed into carries.
The three ARIA props are exceptions for the reason `<v-input>`'s are: the field
already points `aria-labelledby` and `aria-describedby` at its own parts, on the
box and on the text input both, and `aria-label` written beside that reference
would be outranked by it. Write one and the field stands its reference down;
write `aria-labelledby` and yours replaces it; write `aria-describedby` and
yours is added after the help and the message. The label's `for` stays either
way, so a press on the words puts the caret in the text input — as does a press
anywhere in the box that is not a tag.

`disabled` is the platform's own attribute on the text input, which takes the
field out of the form, and the remove buttons are not drawn while it is set, nor
while `readOnly` is — a button that does nothing is a lie to whoever finds it.
The tags themselves stay where Tab reaches them in both, so they can still be
read; read-only keeps the text input's stop as well, and its text can be
selected and copied. Read-only is said in ARIA on the text input, which is a
control; the box is a `group`, which ARIA does not let be read-only, so it is
marked `data-readonly` instead and drawn from that.

Each tag is drawn as a `<v-chip>` is, on the chip sheet's classes, but is not a
`<v-chip>`: the field owns focus across the whole row, and a chip deciding where
focus goes one tag at a time would fight it.

The sheet entry is `tags-input`, and it draws only the row: the box is a
`.volt-field-control`, drawn by `field`, with the label, the help and the
message; each tag is a `.volt-chip` with a `.volt-chip-remove`, drawn by `chip`.
A subset of the sheet that takes `tagsInputStyles` takes `fieldStyles` and
`chipStyles` with it, or the box has no edge and the tags no shape. What the
entry draws of its own is the wrapping row inside the box, the text input
stripped back to its caret, and two states the other two cannot see. Focus is
one: the text input has no edge of its own, so while it holds focus the ring is
drawn on the box, through `:has()`, and while a tag holds focus the tag draws
its own and the box stays quiet. The other is `data-duplicate`, on the tag a
refused entry collided with, drawn as the accent hue and a doubled edge that
keeps its width, in `Highlight`, once the palette is the user's. It also draws
the field's sunken read-only surface on the box, from `data-readonly`, since the
field's own rule reads `aria-readonly` and a group may not carry it. `data-full`
is not drawn.

For anything this does not offer, take the primitive:

```html
<v-tags-input :ref="handle" label="Topics" name="topic"></v-tags-input>
```

```ts
handle: VTagsInput | null = null;
suggest(topic: string): void { this.handle?.tags.add(topic); }
full(): boolean { return this.handle?.tags.isFull() ?? false; }
empty(): void { this.handle?.tags.clear(); }
```

## `<v-rating>`

`createRating`, with the markup written: a row of stars that is a radio group
wearing them — a radio per value, a real `<input type="radio">` behind each
one, and a name for each that says it against the whole. The score is one
signal both sides hold: pass `value` and it is yours to read and write, pass
nothing and the rating owns it.

<Demo name="rating" height="340" />

```html
<h3 id="stay-heading">How was your stay?</h3>
<v-rating :value="stay" name="stay" aria-labelledby="stay-heading"></v-rating>

<v-rating halves name="food" label="The food" :defaultValue="3.5"></v-rating>

<v-rating readOnly halves :defaultValue="4.5"></v-rating>
```

```ts
stay = new Signal.State<number | null>(null);
```

A rating is a radio group, and it is one control rather than a row of them. It
holds a single tab stop — the star that is the score, or the first while there
is none — so Tab steps over the whole question in one press and the arrows move
inside it. Moving is choosing, as it is in a native radio group, so a keyboard
gives a score with one press per star rather than two. Each star is named
against the whole, "3 of 5" rather than "3", because five bare numbers in a row
tell a screen reader nothing about what they are out of.

| Key | Does |
|---|---|
| ArrowRight, ArrowDown | The next value up — half a star with `halves` — and stops at the top |
| ArrowLeft, ArrowUp | The next value down, and stops at the bottom |
| Home / End | The lowest value / `max` |
| Space | Chooses the star that has focus, which is how a rating entered with nothing chosen gets its first answer |
| Delete / Backspace | Clears it: unrated, `null` |
| Enter | Nothing. It is the form's, so a rating inside one does not steal the submit |

All of them are the primitive's, and none of them answers while the rating is
disabled or read-only. The row does not wrap: arrowing past five back to one is
a misclick waiting to happen.

| `<v-rating>` | Type | Means |
|---|---|---|
| `value` | `Signal.State<number \| null>` | Your signal. `null` is unrated |
| `defaultValue` | `number \| null` | Where it starts when the score is the rating's own, and what a form reset goes back to. A score outside `0` to `max` starts at the nearer end. Default unrated |
| `max` | `number` | How many stars: a whole number. Default 5 |
| `halves` | `boolean` | Two radios to a star, the half before the whole, so a step is half a star. Default false |
| `id` | `string` | The group's id |
| `name` | `string` | What every hidden radio submits under, and what makes them one group; without it the rating submits nothing |
| `label` | `string` | The question the stars answer — the group's name |
| `aria-label` | `string` | The same name, written the platform's way. It wins over `label` |
| `aria-labelledby` | `string` | Id of the element that already asks the question. It wins over both, which are then left off |
| `format` | `(value: number, max: number) => string` | Each star's name. Default `3 of 5`, with the number written the page language's way |
| `formatScore` | `(value: number, max: number) => string` | The whole score as one sentence: what a read-only rating is called. Default `Rated 3 of 5` |
| `disabled` | `boolean` | Refuses the press, the pointer and the keys, takes the rating out of the tab order, and is written through to the hidden radios, so nothing submits |
| `readOnly` | `boolean` | Shows a score nobody can change: one image named by the score, with no radios, no tab stop and no preview. It still submits |
| `onValueChange` | `(value: number \| null) => void` | Called with the score a user chose or a form reset put back; `null` once it is cleared |

Slots: `icon`, drawn inside every radio in place of the star and handed
`{ value, filled }` — the value that radio stands for, and whether it is drawn
filled right now, the pointer's preview included. Draw the whole shape in a
square box that fills its parent, and leave its paint to the sheet:

```html
<v-rating name="staff" label="The staff">
  <template :slot-icon>
    <svg viewBox="0 0 24 24" width="100%" height="100%">
      <path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"></path>
    </svg>
  </template>
</v-rating>
```

The sheet strokes the shape in `currentColor` and fills it in `currentColor`
only while it is filled, so a chosen star and an empty one differ in shape —
solid against hollow — as well as in colour. That is the difference a forced
palette keeps, and a path that sets its own `fill` or `stroke` throws it away:
it is solid in both states, and a reader with their own palette sees five stars
that never change. Draw the whole shape even with `halves`. Each radio clips a
full-size copy to its own half of the star, so a shape drawn at half width
would come out as a quarter.

**`value` takes a signal, never a number.** Markup has no way to write a
signal, so `value="3"` hands over the string `"3"` — and the rating refuses it,
naming the tag, rather than failing with an error about a method that names
nothing you wrote. To start at
a score, write `defaultValue`; to read or drive one, hold a
`new Signal.State<number | null>(null)` and bind it with `:value`. Unrated is
`null` on your side, though the primitive counts it as zero: the two spellings
are kept in step for you, and zero shows through only on the primitive itself —
`rating.value()`, and the group's `data-value`.

**Name the group, and know that read-only renames it.** A radio group takes no
name from the radios inside it — "3 of 5" belongs to the answer, not to the
question — so without `label`, `aria-label` or `aria-labelledby` a screen reader
hears five options and never what they rate. Point `aria-labelledby` at the
heading you already wrote rather than saying it twice. A read-only rating is not
a question any more, and its one name is the score: `label`, `aria-label` and
`aria-labelledby` all stand down while it is read-only, and come back when it
ends. To put the score in other words, give `formatScore`.

**Both wordings are English until you give your own.** `format` names each star
and `formatScore` names a read-only rating; the number in each is written the
page language's way, and the words around it are not. A page in another
language needs both:

```html
<v-rating :value="note" name="note" label="Votre note"
          :format="(value, max) => `${value} sur ${max}`"
          :formatScore="(value, max) => `Noté ${value} sur ${max}`"></v-rating>
```

**Read-only is not disabled.** A read-only rating is an answer that is already
given: an image named by its score, its stars hidden from assistive technology,
and its hidden radios still sent with the form. A disabled one is a question
nobody may answer now: still a radio group, so a screen reader still hears what
it asks, but with no tab stop at all — the one exception this package makes to
keeping a disabled control reachable, as a native radio group does — and with
its hidden radios disabled, so it submits nothing. Both at once is a score the
form will not send: still the image named by its score, drawn out of use as a
disabled rating is, so it does not look like the read-only one that is sent.

**Moving is choosing**, which is worth remembering if a score costs something
to send. Arrowing from one star to four calls `onValueChange` three times; save
from the form's submit, or once the score has settled, rather than from every
change. And Up lowers the score: a native radio group moves to the previous
option on Up whatever its layout, and a rating is one.

`defaultValue`, `max`, `halves`, `id` and `name` are what the primitive is
*built* with, read once while the component's fields initialize, so changing
one later does nothing — which is why they are written down here. Everything
else follows whatever you bind it to: `label`, `format`, `formatScore`, both
ARIA props, `disabled`, `readOnly`, `onValueChange`, which is looked up each
time it is called, and the score inside your `value` signal. `max="10"` and
`defaultValue="3.5"` are read as the numbers they spell, a `defaultValue` that
spells no number is unrated, and a `max` that is not a whole number of stars is
refused rather than drawn as no stars at all. The
flags are read the way they are written: `halves`, `disabled` and `readOnly`
bare are on, and `="false"` is off, as it is bound.

**A score between the stars is shown, and still reachable.** An average, or
3.5 where the stars count in wholes, is a value no radio stands for, so no
radio is checked and none submits. The stars it fills are drawn, and the tab
stop goes to the last of them — so a keyboard can still reach the rating, and
Space or an arrow from there chooses a score that is one of the stars. Shown
read-only, which is where an average usually belongs, it is spoken exactly:
"Rated 4.3 of 5".

What you write on the tag lands on the group, which is the element carrying the
role: a class there sizes or spaces the whole row, `aria-describedby` describes
the question, and `dir="rtl"` turns the row round — the stars run from the
right, Left becomes the arrow that raises the score, and a half star fills from
the right, since the sheet clips on the logical edge. `id`, `aria-label` and
`aria-labelledby` are props rather than attributes that fall through, because
each has to be merged with what the primitive writes on that same element: it
writes the group's id and its `aria-label` itself, and a name or a reference
left to fall through beside them would be overwritten, or taken back the first
time read-only ended.

**The preview is the pointer's.** With the pointer over a star, the row shows
what a press there would choose. Stars beyond the score that the preview lights
are drawn lighter than the score, so the score stays readable underneath;
stars between a lower preview and the score go hollow, because that is what a
press would leave. Leaving the row puts the score back, and so does the rating
turning disabled or read-only under a pointer that has not moved. On a touch
screen a tap previews and chooses in one, so the preview is never seen on its
own there.

**A half is half a target.** A star is 1.5rem — 24 pixels at the default type
size, the smallest target WCAG asks a pointer to be offered — and with `halves`
each radio is half of that. Where a half has to be easy to hit, size the stars
up with a class of your own on the tag; the star and the shape inside it are
sized apart, so set both:

```css
.roomy .volt-rating-star,
.roomy .volt-rating-icon {
  inline-size: 2.5rem;
  block-size: 2.5rem;
}
```

Behind every value is a real `<input type="radio">`, visually hidden and
carrying that value under `name`. It is what submits, what `FormData` reads,
and what `form.reset()` puts back — the reset is reported through
`onValueChange`, and reaches your signal, like any other change. With `halves`
there are twice as many, so a rating of 3.5 submits `stars=3.5`; read the field
on the server as a number, not as an integer.

The sheet entry is `rating`, with four classes: `volt-rating` on the group,
`volt-rating-star` on each star, `volt-rating-item` on each radio, and
`volt-rating-icon` round the shape. The states it draws are the primitive's
`data-filled` on a radio, `data-disabled` on the group and every radio (and on
the read-only image, from the component, when it is disabled as well),
`data-readonly` on the group, and
the component's own `data-preview` on a radio lit only by the pointer — the
primitive marks every star at or below the value it shows as filled, and which
of those are the score is a comparison of numbers a stylesheet cannot make.
Under a forced palette a filled star is `Highlight` and an empty one
`CanvasText`, both in `GrayText` while disabled, solid against hollow
throughout; the preview stays lighter, since opacity is a channel the palette
leaves alone, and the focus ring is an outline, which it keeps.

The tag takes the props above and no others. For the rest of what
`createRating` takes — `required`, `validate`, a description, an error message,
`allowClear: false` — write the markup by hand around the primitive, with the
same class names. `required` in particular needs an error message to go with
it: the primitive cancels the browser's own bubble, which would point at a
radio nobody can see, and reports the refusal in the field's message instead,
so a required rating without one refuses the submit and says nothing. For
reading or driving a rating the tag drew, take the primitive:

```html
<v-rating :ref="review" name="stars" label="Your rating"></v-rating>
```

```ts
review: VRating | null = null;
/** What the "Start over" button beside the rating presses. */
startOver(): void { this.review?.rating.clear(); }
```

## `<v-toggle-group>` and `<v-toggle>`

`createToggleGroup`, with the markup written: a segmented row of buttons that
stay down, over one value. A `<v-toggle>` written anywhere else is a toggle on
its own, over `createToggle` — bold, mute, pin — with the same look and all four
corners back.

<Demo name="toggle-group" height="300" />

```html
<v-toggle-group :value="align" label="Alignment">
  <v-toggle value="start">Left</v-toggle>
  <v-toggle value="center">Centre</v-toggle>
  <v-toggle value="end">Right</v-toggle>
</v-toggle-group>

<v-toggle-group :value="marks" type="multiple" label="Formatting">
  <v-toggle value="bold" label="Bold"><b>B</b></v-toggle>
  <v-toggle value="italic" label="Italic"><i>I</i></v-toggle>
  <v-toggle value="underline" label="Underline"><u>U</u></v-toggle>
</v-toggle-group>

<v-toggle :pressed="wrap">Wrap lines</v-toggle>
```

The group holds a single tab stop — on the toggle that is down, on the last one
used after that, and on the first while nothing is down — so Tab steps over the
row in one press and lands on what is in effect. Inside it the arrows move,
Home and End reach the ends, `loop` decides whether they wrap, and a disabled
toggle is stepped over. Items are addressed by value: each `<v-toggle>` draws
its own button inside the group and registers by value, so a row drawn with
`:for` works as well as one written out, and the tab stop survives a re-render
that replaces every button.

**Which role the group takes follows what it does, not a prop.** A single group
that must keep one value — the default — is a radio group, because "exactly one
of these" has no other correct announcement: its toggles are radios, checked
rather than pressed, all four arrows move, and moving chooses. Make it
`deselectable`, or `type="multiple"`, and it is a group of toggle buttons
instead: each one is pressed or not, only the arrows along `orientation` move,
and they move without pressing — Space or Enter does that — because a toolbar
whose buttons applied themselves as you arrowed past would be unusable.

| `<v-toggle-group>` | Type | Means |
|---|---|---|
| `value` | `Signal.State<string>` or `Signal.State<string[]>` | Your signal. A string for a single group, where `''` is nothing chosen; a list for `type="multiple"`, in the order the values were pressed |
| `defaultValue` | `string \| readonly string[]` | Down from the start, when the group owns the value. A multiple group takes a single string too, which is all an attribute can write |
| `type` | `'single' \| 'multiple'` | One value at a time, or any number. Default single |
| `deselectable` | `boolean` | A single group may go back to none. Default false; a multiple group can always be emptied, and does not read it |
| `orientation` | `'horizontal' \| 'vertical'` | Which arrows move, and which way the sheet lays the row out. Default horizontal |
| `loop` | `boolean` | Arrows wrap past the first and last toggle. Default true |
| `disabled` | `boolean` | Refuses every toggle at once, and says so on the group and each toggle |
| `label` | `string` | The name of the group, which has none by default |
| `labelledBy` | `string` | Id of an element already naming it — a heading, a legend |
| `aria-label`, `aria-labelledby` | `string` | The same two, written the platform's way. They win over `label` and `labelledBy` |
| `onValueChange` | `(value: string) => void` or `(value: string[]) => void` | Called with what a user chose, never with a default: the value — `''` once a deselectable group's toggle is let up — or the whole list for a multiple group |

| `<v-toggle>` | Type | Means |
|---|---|---|
| `value` | `string` | Identifies the toggle in its group: what the group holds and reports. Required inside a group |
| `label` | `string` | The button's name, for a toggle whose content is an icon. Bind it for a name that changes with the state |
| `aria-label` | `string` | The same name, written the platform's way. It wins over `label` |
| `disabled` | `boolean` | Refuses the press, and says so. In a group the arrows step over it |
| `pressed` | `Signal.State<boolean>` | On its own only: your signal for whether it is down |
| `defaultPressed` | `boolean` | On its own only: down from the start, when the toggle owns its state |
| `onPressedChange` | `(pressed: boolean) => void` | On its own only: called with the new state on a press it did not refuse |

Slots: the content of `<v-toggle-group>` is its toggles, and the content of a
`<v-toggle>` is its button's — words, which name it, or an icon, which needs a
`label` to. Write nothing inside a group but `<v-toggle>` tags. The row rounds
its first and last child and shares the edges between the rest, so anything
else written there takes an end of the row, and the corners with it, from the
toggle that should have had them; and a toggle wrapped in something else is not
a child of the row, so it is drawn whole, as a toggle on its own is.

**Name the group, and every toggle that is only an icon.** A group takes no
name from the toggles inside it, so without `label`, `labelledBy` or
`aria-label` a screen reader announces the choices and never the question. A
`<b>B</b>` is not a name either: `label="Bold"` is what a toggle drawn as a
glyph is announced by.

The value of a single group is a string whichever kind of group it is, and `''`
is how it says nothing is chosen — so a `deselectable` group writes `''` into
your signal when its toggle is let up, and setting `''` lets every toggle up.
That makes `''` the one value a toggle cannot have. The likely slip is the other
way round: a `Signal.State<string[]>` handed to a group without
`type="multiple"`, or a string to one with it, throws in development rather
than drawing nothing pressed and writing the wrong shape into your signal on
the first press.

`defaultValue`, `type`, `deselectable`, `orientation` and `loop` are what the
primitive is *built* with, read once while the component's fields initialize,
so changing one later does nothing. The same goes for `pressed` and
`defaultPressed` on a lone toggle. Everything else follows whatever you bind it
to: `disabled`, both names, the value itself, and `value`, `label` and
`disabled` on each toggle. Moving is choosing in a radio group, so arrowing from
the first toggle to the third calls `onValueChange` twice — do anything
expensive when the value settles, not on every change.

Whether a `<v-toggle>` is a member or a toggle on its own is decided by where it
is written, once, as it is built. Inside a group the group holds whether it is
down, so `pressed`, `defaultPressed` and `onPressedChange` written there are
never read, and a development build says so in the console; read the group's
`value` and listen on its `onValueChange` instead. A toggle inside a group with
no `value`, or with one a sibling already has, throws in development: a value
identifies a toggle, so two that shared one would be drawn down together.

What you write on either tag lands on the element carrying the role: the group
element itself, and each toggle's button. So a class that lays the row out goes
on `<v-toggle-group>`, a class on `<v-toggle>` styles that segment, and
`aria-describedby` pointing at a hint lands where it is read and stays there
through every press.

A disabled toggle is marked `aria-disabled` rather than given the `disabled`
attribute, so a lone toggle keeps its place in the tab order and a keyboard
user can find out it is there. In a group the arrows step over a disabled
toggle and it never holds the tab stop — unless the whole group is disabled,
which keeps its one way in, as a disabled checkbox does, and refuses the press
from there.

Which toggles are down is information rather than emphasis, so the sheet says
it in three ways at once: a filled background in the accent, an edge to match,
and a heavier weight on the words. Under a forced palette the fill becomes
`Highlight` with `HighlightText` on it, the pair the palette keeps for exactly
this, and the weight stays, which is a channel no palette touches. That toggle
is taken out from under the palette with `forced-color-adjust: none`, every
colour on it still one of the palette's own: left under it, the backplate a
browser paints behind text is the colour of `HighlightText`, and the words
would vanish into the fill. The row is
drawn in logical properties only, so in a page written right to left it
mirrors without a rule saying so.

For anything the tags do not offer, take the primitive — the group's, or a lone
toggle's:

```html
<v-toggle-group :ref="formatting" type="multiple" label="Formatting">…</v-toggle-group>
<v-toggle :ref="pin" label="Pin"><v-icon name="pin"></v-icon></v-toggle>
```

```ts
formatting: VToggleGroup | null = null;
pin: VToggle | null = null;

clear(): void {
  for (const mark of ['bold', 'italic', 'underline']) this.formatting?.toggleGroup.deselect(mark);
  this.pin?.toggle?.release();
}
```

The primitive keeps a single group's value in its own spelling, where nothing
chosen is `null` rather than `''`: `toggleGroup.value()` reads your signal
through, never a copy of it, so the two always agree on everything else.
`toggle` is `null` on a toggle inside a group, whose state is the group's
primitive's to hold.

## `<v-file-upload>`

A file upload with its whole life written: a drop zone with a hidden picker
behind it, a list of the files with a bar each, a reason under each one that
failed, and a retry and a remove per file — `createFileUpload`, with the
markup written and the transport yours.

<Demo name="file-upload" height="520" />

```html
<form :submit="claim($event)">
  <v-file-upload
    :transport="send"
    name="receipts"
    accept="image/*,.pdf"
    :maxSize="2_000_000"
    :maxFiles="5"
    description="Photos or PDFs, up to 2 MB each."
    :onComplete="finished"
  ></v-file-upload>
</form>
```

```ts
send = xhrTransport({ url: '/api/receipts', parse: (body) => JSON.parse(body).id });
```

The zone is a button: a press, Enter or Space opens the platform's own file
picker, and a drag over it is a drop target. Behind it is a real
`<input type="file">`, visually hidden and out of the tab order — the zone is
the tab stop that opens it — and it is not decoration. It is the only thing on
any platform that opens the picker, and it carries the field's validity, so a
form around the upload refuses a submit while a file is still on its way, has
failed, or was refused, with the reason printed under the zone.

| Prop | Type | Means |
|---|---|---|
| `transport` | `UploadTransport` | Required. How the files leave the page: `xhrTransport`, `fetchTransport`, or your own function from a request to a promise |
| `accept` | `string` | The `accept` syntax, `.png,image/*`. The picker's filter, and checked again on every file that arrives, dropped ones included |
| `multiple` | `boolean` | More than one file. Default true. `:multiple="false"` replaces the file rather than adding one |
| `maxSize` | `number` | In bytes. A bigger file is listed as refused and never sent |
| `maxFiles` | `number` | Across the whole list, not per drop |
| `onChange` | `(items: readonly UploadItem[]) => void` | The list, when a file arrives, leaves, or moves from one state to another — not on every byte |
| `onComplete` | `(items: readonly UploadItem[]) => void` | Every upload has finished, one way or another |
| `onError` | `(item: UploadItem) => void` | A file failed or was refused; `item.error.code` says which — `type`, `size`, `count` or `transport` |
| `label` | `string` | The words in the zone. Default "Drop files here, or press to choose files" |
| `description` | `string` | The line under the zone, shown whether or not the field is valid |
| `error` | `string` | A verdict of your own on the files, shown at once and pushed into the picker. Bound as `:prop-error` |
| `disabled` | `boolean` | Refuses drops, the picker, the keys and every row's buttons |
| `name` | `string` | What a form posts each finished file's reference as — not the files |
| `labels` | `UploadLabels` | Your wording: the row's buttons, where a file is, why one was refused, and what the live region says |
| `aria-label` | `string` | Names the zone and the picker instead of the words |
| `aria-labelledby` | `string` | Names both from elsewhere on the page; outranks `aria-label` |
| `aria-describedby` | `string` | Ids of anything else that describes them, added after the help and the message |

Everything from `transport` to `onError` is read once, while the primitive is
built, so binding one to a signal changes nothing after the first render —
`accept`, `maxSize` and `maxFiles` among them. The three callbacks are read
when they are called, so a page that rebinds one is heard. `label`,
`description`, `error`, `disabled`, `name`, `labels` and the three ARIA props
follow whatever you bind them to.

Slots: the default slot is what the zone holds, in place of `label` — an icon
and the words, usually — and `file` draws a row of your own, handed the file
and what to do with it:

```html
<v-file-upload :transport="send" accept="image/*" :multiple="false">
  <span class="icon" aria-hidden="true">⇪</span>
  <span>Drop a profile photo here</span>

  <template :slot-file="{ file, progress, status, item, retry, remove }">
    <span>{ file.name }</span>
    <span>{ status === 'uploading' ? Math.round(progress) + '%' : status }</span>
    <span :if="item.error">{ item.error.message }</span>
    <v-button
      :if="status !== 'rejected'"
      :disabled="status !== 'error' && status !== 'cancelled'"
      :onPress="() => retry()"
    >Retry</v-button>
    <v-button :onPress="() => remove()">Remove</v-button>
  </template>
</v-file-upload>
```

Keep a retry of your own on the row the way the default row keeps its own:
there whatever the file's state, and unavailable when there is nothing to
send — `<v-button>`'s `disabled` is `aria-disabled`, so it keeps focus. A
retry drawn only while the file has failed is gone the moment it is pressed,
and takes focus with it to the top of the page. The `remove` handed to the
slot moves focus to the zone itself, so a remove of your own needs nothing.

`progress` is 0 to 100, `status` is `pending`, `uploading`, `success`,
`error`, `cancelled` or `rejected`, and `item` is the whole `UploadItem`, for
the reason, the file's size, and what the server answered. The names are live:
a row follows its file without being rebuilt. The row around your content
stays the sheet's — its edge, and the danger edge when the file failed — so a
row of your own still says at a glance which file did.
What the default slot holds is the zone's name and the picker's label, so a
zone holding an icon alone is a zone with no name: give it words, or
`aria-label`.

| Key | Does |
|---|---|
| Enter / Space | Opens the picker, from the zone |

The key is the primitive's, and does nothing while the upload is disabled or
with Ctrl, Alt or Meta held. Each row's buttons are buttons, reached with Tab
like any other.

**The transport is required, and has to be a function.** Markup has no way to
write one: `transport="/api/files"` is a string, and `:transport="{ url }"`
is the options rather than what `xhrTransport` makes from them. Either is
refused when the tag is built, naming the tag, rather than failing every file
later for a reason about strings. `xhrTransport` is the one to reach for: it is
still the only way to see an upload's bytes leave, and so the only one whose
bar moves; `fetchTransport` jumps from nothing to done.

**`name` posts references, not files.** The transport has already sent the
bytes, so the picker is left unnamed — naming it would post every file a
second time with the form. What a form posts under `name` instead is what the
transport resolved with, once per file that finished: a string as it is, a
number or a flag spelled out, anything else as JSON. A transport that resolved
with nothing, or with an empty string, posts nothing for that file. So have
the transport resolve with exactly the reference the form should carry —
`xhrTransport`'s `parse` is where an id is picked out of a response. A disabled
upload posts nothing, as any disabled field does.

**A refused file is listed, not dropped.** A file of the wrong type, too big,
or one past `maxFiles` is a row with the reason under it and no bar, and it is
never sent. It also keeps the form from submitting, through the picker's
validity, until it is removed: a form that posts while a file the user chose is
not among what it posts is a form that lost something without saying so. A
file the server refused is the same, until it is retried or removed, and so is
a file still on its way — though that one is not a mistake, so nothing is said
about it until a submit is refused for it, and the message under the zone then
says to wait.

**The message is the field's, and yours goes in through `error`.** A refusal
or a failure is said in the line under the zone, in the same words as the row,
and that line is a live region, so the news is heard as well as seen. A verdict
of your own — a server that refused the whole batch — is `error`: shown ahead
of any reason of the upload's own, and pushed into the picker, so the browser
refuses the submit over the same sentence. It is bound as `:prop-error`,
because `error` is a DOM event's name as well and `:error` on any tag is read
as a listener for it; written out, `error="…"` is a prop like any other.

Adding or removing a file lets go of it — the files it was about are not the
files there now — and clears the prop with it, so what you read back agrees.
A file moving on, or a byte arriving, is not a change to the files and keeps
it. What is bound to `error` is written in whenever it changes, so the same
words a second time are a change only if your value was cleared in between.
Set it from `onChange`, which runs after the letting go, and it stays.

**The retry stays where it is.** Every file that was taken has a retry
button, unavailable — `aria-disabled` — while there is nothing to retry: a
button that appeared on failure and went the moment it was pressed would drop
focus to the top of the page, which is where a keyboard user would find
themselves after every retry. A refused file has none, since sending it again
would be refused the same way. Removing a file whose button had focus puts
focus on the zone, which is where the next thing anyone does with the upload
starts.

**The words name it.** The zone takes its name from what it holds, not from a
second name written over it, so what a reader hears is what is on screen. The
same words label the picker. `aria-label` and `aria-labelledby` replace both,
and `aria-describedby` is added to the help and the message rather than written
over them. What else you write on the tag — a class, an id, a `title`, a
`data-*` — lands on the zone: it is the control, it carries the role, and it is
the element a keyboard reaches.

`disabled` is `aria-disabled` on the zone, so it keeps its place in the tab
order and says "unavailable" to whoever reaches it, and the platform's own
`disabled` on the inputs, so a form posts nothing for it. The row buttons go
unavailable with it — a field that refuses new files but lets its old ones be
removed or sent again has not been disabled.

**`labels` is the wording, and it is live.** `remove`, `retry` and
`itemProgress` name a row's two buttons and its bar, and take the file;
`typeRejected`, `sizeRejected`, `countRejected` and `uploadFailed` say why a
file was not taken; `busy` is the wait; `announceProgress`, `announceComplete` and
`announceFailed` are what the live region says; `dropZone` is the zone's words
when `label` is not given; and `status` is the words after a file's size,
which this component adds — default `Waiting`, the percentage, `Uploaded`,
`Failed`, `Cancelled` and `Not accepted`, and an empty string leaves the size
alone. A page that changes language reaches the rows already on screen, except
for a bar's name, which is settled when the bar is made, and a reason, which
is written into the file when it happens. Left unwritten, the count of files
in `countRejected` and the three announcements comes from the locale
catalogue's `uploadTooMany`, `uploadProgress`, `uploadComplete` and
`uploadFailures` where it has them — plural records, chosen by the number of
files as `{n}`, so a Polish page has its four forms, with how many have gone up
as `{done}` and how many failed as `{failed}` — and otherwise from English that
agrees with the count: "No more than 1 file", "2 files uploaded".

**Numbers can be written either way.** `:maxSize="2_000_000"` hands over a
number and `maxSize="2000000"` its spelling, and the component reads both as
the number. `multiple="false"` and `disabled="false"` are read as false, not
as the truthy string `"false"`, and any other word — written bare, `"true"`,
`disabled="disabled"` — as true; `:multiple="false"` is the spelling to prefer.

The sheet entry is `file-upload`, and each row's bar is not drawn there: it is
`createProgress` underneath and wears `<v-progress>`'s classes, so a sheet
built from a subset needs `progressStyles` beside `fileUploadStyles`, or every
bar is an empty box. A bar wears the finished colour only for a file that
arrived: one whose bytes all went up before the server refused it — which is
where `xhrTransport` is when the answer is a 413 or a 500 — is a full bar in
the ordinary fill, beside the row's danger edge. The zone's edge is dashed and thickens while a drag is
over it — `data-dragging`, which the primitive writes — and the padding gives
back what the edge takes, so the zone does not grow under the pointer. A file
that failed or was refused, and the message under the zone, are drawn the way
`<v-alert>` draws danger: a thick edge down the start of the box, from
`data-error` on the row and `data-state="invalid"` on the message. Every state
survives a forced palette — the thicker edge is a width, the danger edge turns
to dots, the disabled zone is `GrayText`, its words included, a drag over it is `Highlight`.

For anything this does not offer, take the primitive:

```html
<v-file-upload :ref="photos" :transport="send"></v-file-upload>
```

```ts
photos: VFileUpload | null = null;
paste(event: ClipboardEvent): void { this.photos?.upload.onPaste(event); }
again(): void { this.photos?.upload.retryFailed(); }
```

Chunked and resumable uploads, retries with a backoff, concurrency, folders
and a page-wide drop are options `createFileUpload` takes when it is built,
and this component does not pass them. For those, write the markup by hand
with the primitive: the same parts, the same class names, and the same look.

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

### Rating

```html
<div :ref="group" class="volt-rating" :spread="rating.groupProps()"
     :keydown="rating.onKeyDown($event)" :pointerleave="rating.preview(null)">
  <span :for="star in stars" :key="star.at" class="volt-rating-star">
    <span :for="value in star.values" :key="value" class="volt-rating-item"
          :spread="rating.itemProps(value)"
          :attr-data-preview="rating.value() < value && rating.isFilled(value) ? '' : undefined"
          :click="rating.setValue(value)" :pointerenter="rating.preview(value)">
      <span class="volt-rating-icon" aria-hidden="true"><slot name="icon">
        <svg viewBox="0 0 24 24" width="100%" height="100%"><path d="…"></path></svg>
      </slot></span>
    </span>
  </span>
  <input :for="value in rating.values()" :key="value" :spread="rating.inputProps(value)">
</div>
```

`stars` is `rating.values()` grouped by `Math.ceil`, one value to a star or the
half and the whole. Write `data-preview` yourself, as above: the sheet draws a
star the pointer lit beyond the score lighter than the score, and only the
markup knows the two apart. Keep the hidden inputs outside the stars, which
clip whatever they hold, and inside the group, which is positioned so that what
the primitive hides stays inside the rating.

The component does four more things over the primitive's props, which markup
written by hand has to do as well until the primitive does them itself: it
leaves `aria-readonly` off the read-only image, which `role="img"` does not
allow, and writes `data-disabled` on that image when the rating is disabled as
well, which the primitive's image leaves off; on a server it gives the tab stop
for a score no star stands for to the last star the score fills, or to the
first for a score below them all — the primitive finds that star on the page,
and a server, writing each star once and in order, has no page to find it on;
and it calls `rating.preview(null)` when the rating turns disabled or
read-only, so a preview left under a resting pointer does not outlast the
choice it showed.
