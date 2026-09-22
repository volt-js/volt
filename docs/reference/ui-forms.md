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
as a whole has no tab stop at all. Enter is left to the form, so a group inside
one does not steal the submit.

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
