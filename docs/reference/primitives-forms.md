# Form primitives

The controls a form is made of — text, numbers, codes, tags, checkboxes,
switches, radios, ratings, toggles, sliders and file uploads — and the field
that ties a label, a description and an error message to any of them. All of
them are in `@voltdev/primitives`, alongside the rest of the headless layer
described in [primitives](./primitives).

::: warning Not on npm yet
Part of `@voltdev/primitives`, which is not published yet — see
[the overview](./primitives). Everything here works from a checkout of the Volt
repository.
:::

Every one of them that holds a form value keeps a real native input — the
toggles, which hold none, are the exception. That is the design rather than a
detail: a control assembled out of `<div>`s submits nothing, validates nothing,
and is invisible to `FormData`, to `form.reset()`, to `:invalid` and to the
browser's own required-field handling. So the value always lives on an
`<input>`, a `<textarea>`, or a hidden input behind the visible part, and a
plain `<form method="post">` carries it with no script of yours in the way.
[What a plain form post carries](#what-a-plain-form-post-carries) lists which
element carries what.

Nothing here renders. Each factory owns state, keyboard and ARIA, and returns
prop objects you spread onto markup you write. Nothing has an opinion about
styling either, with two exceptions the sections below give reasons for: the
visually-hidden style on a mirrored input, and the height of an auto-sizing
textarea.

The native-input rule is also what makes a reset work. A mirrored input has to
agree with the state it stands for through a submit *and* a `form.reset()`, and
each control here writes the default the platform restores as well as the value
it holds. [What a form reset does](#what-a-form-reset-does) says what each one
goes back to.

## The shape they share

```ts
import { Signal } from '@voltdev/core';
import { createInput } from '@voltdev/primitives';

class Signup {
  input = new Signal.State<Element | null>(null);
  label = new Signal.State<Element | null>(null);

  email = createInput({
    input: () => this.input.get(),
    label: () => this.label.get(),
    type: 'email',
    name: 'email',
    required: () => true,
  });
}
```

```html
<div :spread="email.fieldProps()">
  <label :ref="label" :spread="email.labelProps()">Email</label>
  <input :ref="input" :spread="email.inputProps()">
</div>
```

**Elements are getters, not values.** The factory runs in a field initialiser,
before anything has rendered, so it is handed a function over the signal a
`:ref` writes into and reads it when it needs the element.

**State is yours or theirs.** Pass a `Signal.State` as `value` (or `checked`,
`pressed`, `queue`) to drive a control from outside; leave it out and the
control owns one, seeded from `defaultValue`. The element is written from the
signal and read back on `input`, so the two cannot disagree. In the text-shaped
controls — text, textarea, password, number and the tags input's box — a
`value` written in your own markup is adopted rather than wiped, because an
empty signal is not an instruction to erase what is there. The mirrored inputs
behind the other controls are written from state and take nothing from markup.

**Flags are accessors.** `required`, `disabled` and `readOnly` are
`() => boolean`, because options are read once at construction and a disabled
state usually comes from something that changes — a pending save, a
permission. The controls built on the form field forward only the flags you
supplied, so a `required` attribute in your own markup is not wiped by a factory
that was never told about it. Checkbox, switch and radio group own their hidden
inputs outright and always write both.

**Prop objects carry attributes, not handlers.** Events are wired in the
template, where you can see them: `:keydown="qty.onKeyDown($event)"`. The
exceptions are `createToggle`, `createToggleGroup` and `createClipboard`, whose
prop objects carry an `onclick`; `:spread` attaches it, and swaps it for the new
one when the object is rebuilt.

**They need a scope.** Listeners on the control and its form are attached by
effects and removed when the calling scope is disposed, which a component's
field initialiser provides. Created outside one, nothing is ever cleaned up.

Every control that validates exposes the [form field](#labelling-and-validating-createformfield)
it is built on as `field` — the place to read validation state, dirty and
touched from. Checkbox, switch, radio group, toggle, toggle group and clipboard
have none.

## Labelling and validating: `createFormField`

```ts
createFormField(options: FormFieldOptions): FormField
```

A label, a description, an error message and a control are four elements that
have to agree about four ids, one `aria-invalid`, one `aria-required`, a dirty
flag, a touched flag, and when the browser's own validation gets to speak.
Every input on this page composes this. Use it directly for a native control
with no factory of its own — a `<select>`, a date input, a form-associated
custom element.

| Option | Default | Description |
|---|---|---|
| `control` | — | The element the user operates. Required |
| `label` | — | The visible label, if there is one |
| `description` | — | Help text, shown whether or not the field is valid |
| `errorMessage` | — | Where validation messages are rendered |
| `validity` | own state | A `Signal.State<ValidationResult>` to read or seed the state from outside |
| `id` | generated | A fixed id for the control |
| `required` / `disabled` / `readOnly` | unset | Written through to the control, and to ARIA |
| `validate` | — | `(value, control) => ValidationOutcome \| Promise<ValidationOutcome>` |
| `validateOn` | `'submit'` | When the field first validates: `'submit'`, `'blur'` or `'input'` |
| `revalidateOn` | `'input'` | When it validates again, once it has at all |
| `labels` | — | A message per constraint (`valueMissing`, `typeMismatch`, …), and `validationFailed` |
| `onValidityChange` | — | Called once per change of state or messages |

| Member | Description |
|---|---|
| `ids()` | The control, label, description and error-message ids |
| `state()` | `'valid'`, `'invalid'` or `'pending'` |
| `isValid()` / `isInvalid()` / `isPending()` | The same, as booleans |
| `messages()` | Empty while valid. While pending, the last verdict's messages are kept |
| `value()` | The control's value as last read, or `null` for an element with none |
| `isDirty()` | Whether the value differs from what `form.reset()` would restore |
| `isTouched()` | Whether the control has been left at least once |
| `isRequired()` / `isDisabled()` / `isReadOnly()` | The resolved flags |
| `validate()` | Run everything, an async validator included. Resolves to whether it passed |
| `report()` | Validate and show the result now; `false` while an async validator runs. One already asked about this value is not asked again, unless it rejected |
| `setCustomValidity(message)` | A message the platform cannot derive, shown at once. `''` clears it, and says nothing about a field nobody has validated yet |
| `markEdited()` / `markTouched()` | Record an edit or a visit for a control that fires no `input` or `blur` |
| `reset()` | Clear validation and touched, and measure dirty again — it stays `true` while the value still differs from its default. Does not touch the value |
| `fieldProps()` | The wrapper: `data-state`, `data-dirty`, `data-touched`, `data-required`, … |
| `labelProps()` | `id`, and `for` pointing at the control |
| `controlProps()` | `id`, `aria-labelledby`, `aria-describedby`, `aria-invalid`, `aria-required`, `aria-busy`, … |
| `descriptionProps()` | `id` |
| `errorMessageProps()` | `id`, `role="alert"`, `data-state` |

```ts
import { Signal } from '@voltdev/core';
import { createFormField } from '@voltdev/primitives';

class Country {
  control = new Signal.State<Element | null>(null);
  label = new Signal.State<Element | null>(null);
  error = new Signal.State<Element | null>(null);

  field = createFormField({
    control: () => this.control.get(),
    label: () => this.label.get(),
    errorMessage: () => this.error.get(),
    required: () => true,
    labels: { valueMissing: 'Choose the country you are shipping to.' },
  });
}
```

```html
<div :spread="field.fieldProps()">
  <label :ref="label" :spread="field.labelProps()">Country</label>
  <select name="country" :ref="control" :spread="field.controlProps()">…</select>
  <p :if="field.isInvalid()" :ref="error" :spread="field.errorMessageProps()">
    { field.messages()[0] }
  </p>
</div>
```

The field attaches its own listeners — `input`, `change`, `blur` and `invalid`
on the control, `submit` and `reset` on its form — so there is nothing for you
to wire. The control is recognised by asking it for `setCustomValidity` rather
than by its tag, which is what lets a form-associated custom element take part;
any other element still gets the ids, the ARIA and the state, and has nothing
for the platform to validate.

### References only to parts that are there

`aria-labelledby` and `aria-describedby` name the id each element actually
carries, read from the element rather than from what it was handed. A
reference to an id nothing has leaves the control unlabelled exactly as no
reference would, and hides the mistake from every audit that only checks the
attribute is present. So an error message rendered with `:if` drops out of
`aria-describedby` when it goes, and the description comes first when both are
there: it is the standing explanation, and the error is the news.

### When validation speaks

**Nothing is invalid until validation has run.** A required field is empty the
moment it renders, and a control that announces itself invalid before anyone
has typed tells a screen-reader user that every empty field is wrong before
they have started. `state()` starts `'valid'`, no
`aria-invalid` is written, and only a trigger moves it — a submit by default,
which covers both a real submit and `report()`. After that `revalidateOn` takes
over, so an error the user is in the middle of fixing disappears as they fix
it.

A disabled or read-only control is never validated. The platform bars both
from constraint validation, and an error against a value nobody can change is
an error nobody can act on.

The error element is a live region. On a submit, focus is on the button rather
than on the field, and without one the user is told nothing; the cost is that
the message is announced when it appears and again when the user reaches the
control that `aria-describedby` points from.

### What it does to the form

**Custom messages go through the platform.** Whatever the field decides —
your `validate`, `setCustomValidity` — is pushed into the control with the
control's own `setCustomValidity`, so the browser refuses the submit for
exactly the reasons the page shows. A field that looks invalid while the form
submits anyway is two sources of truth, and they diverge at once.

**The submit is checked in the capture phase**, so a handler that stops
propagation cannot skip it, and cancelled when the field is not valid. At the
target the capturing listeners run first, so it runs before a `submit` handler
you added to the form itself, whichever was added first. Only a capturing
listener on an ancestor, or one added to the form ahead of the field, runs
earlier — a form you submit by hand from there should check
`event.defaultPrevented`.

**The browser's own bubble is cancelled.** When the platform refuses a submit
it fires `invalid` at the control; the field cancels it and shows the same
messages in your markup instead. Where a message comes from the platform, the
browser's `validationMessage` is used — it is already in the user's language —
unless `labels` names that constraint. The platform has one message slot, and a
custom message occupies it, so the field reads the platform's own wording with
that slot momentarily empty and puts the custom message back before it returns:
a malformed address and a duplicate one are reported in the browser's words and
in yours, in that order.

### Messages from a server

`setCustomValidity(message)` is the one to use. It shows at once, blocks the
submit through the platform, and is dropped by the next edit — a verdict on a
value that no longer exists would otherwise survive every correction and leave
a form nobody can submit.

Dropped is not the same as gone from the screen. With the default
`revalidateOn: 'input'` the edit re-validates at once, so the message and the
state go together. With `'blur'` or `'submit'` the message stays on screen
until that trigger, as asked — but the platform's refusal is lifted at the
edit either way, so a submit made before the blur is re-checked rather than
refused on a verdict about a value that is no longer there.

The `validity` option is not a substitute. It lets you read the field's state
as a signal, or seed it, but the field writes it on every validation: an
`invalid` set on it from outside is shown until the next submit, which
re-evaluates, overwrites it and lets the submit through.

### Async validators

A `validate` that returns a promise puts the field in `'pending'` and sets
`aria-busy` until it answers. `messages()` keeps the last verdict's messages
while it runs, so the field need not flicker back to looking fine — but
`isInvalid()` is `false` while pending and `aria-invalid` goes with it, so an
error element rendered on `:if="field.isInvalid()"`, as in the example above,
does disappear for the wait. Render it on `field.messages().length` to keep
it. An answer about a value that has since been edited is dropped, whether or
not the edit asked again — with `revalidateOn: 'blur'` or `'submit'` it does
not, and the field leaves `'pending'` at the edit rather than waiting for an
answer it will not use. A validator that rejects is reported as invalid with
`labels.validationFailed` ("This value could not be checked."), because a value
that could not be checked has not passed. But no answer is not a verdict on
the value: it is not put into the platform's validity, and the next submit
asks again, so a moment's network trouble does not leave the form refusing
every submit until someone changes what they typed.

**A native submit waits for the answer rather than failing for having asked.**
A validator that has answered about the value as it stands, or is still
answering, is not asked again, so a submit made after it has passed goes
straight through. A submit made while it
is still running is refused once — there is nothing else to do with a value
nobody has finished checking — and made again, as the user made it and through
`requestSubmit`, as soon as the answer comes back and says yes. An answer about
a value that has since been edited is dropped, and takes the waiting submit
with it: what is submitted is only ever a value that was checked. `validate()`
asks again whatever has been asked before, for a form you submit yourself.

### Dirty and touched

`isDirty()` compares the control's value with the one `form.reset()` would
restore — `defaultValue`, or `defaultChecked` on a checkbox or radio — rather
than recording that something was typed. `isTouched()` is set by the first
`blur`. Neither takes a signal, because they are records of what the user did
rather than settings: they can be read and reset, not dictated. A control that
fires no `input` or `blur` of its own reports them through `markEdited()` and
`markTouched()`.

## Typing text: `createInput`, `createTextarea`, `createPasswordInput`

All three take the same options and return the same base object; each adds
one prop object for its own element.

| Option | Default | Description |
|---|---|---|
| `input` | — | The `<input>` or `<textarea>`. Required |
| `label` / `description` / `errorMessage` | — | Passed to the form field |
| `value` | own state | A `Signal.State<string>` |
| `defaultValue` | `''` | The starting value, and what a reset goes back to |
| `id` / `name` / `placeholder` / `autoComplete` | — | Written to the control |
| `required` / `disabled` / `readOnly` | unset | Accessors |
| `minLength` / `maxLength` / `pattern` | — | Written to the control, so the platform checks them |
| `validate` / `validateOn` / `revalidateOn` / `labels` | | As for the form field |
| `onValueChange` | — | Called with each new value |

| Member | Description |
|---|---|
| `field` | The composed `FormField` |
| `value()` / `setValue(value)` / `clear()` | The value |
| `isEmpty()` | Whether it is `''` |
| `remaining()` | Room left before `maxLength`, or `null` without one. See below |
| `fieldProps()` / `labelProps()` / `descriptionProps()` / `errorMessageProps()` | From the field |
| `controlProps()` | The field's control props, the native text attributes and `data-empty` |

There is no `value` in any prop object. The value is written to the element's
property from the signal, and only when it differs — assigning `value` moves the
caret to the end, which is what makes a naively controlled input unusable.

`remaining()` counts in the UTF-16 code units `maxlength` itself counts in, so
it agrees with the box: an emoji is one character to a person and two to the
platform, and a counter that said otherwise would promise room the box is about
to refuse.

### `createInput`

```ts
createInput(options?: InputOptions): TextInput
```

A single line. `type` is `'text'` (the default), `'email'`, `'password'`,
`'search'`, `'tel'` or `'url'`, and `inputMode` asks for an on-screen keyboard.
`inputProps()` goes on the `<input>`.

`number` is not among the types on purpose: a native number input cannot hold a
locale-formatted value, and [`createNumberInput`](#typing-a-number-createnumberinput)
is what that should be.

### `createTextarea`

```ts
createTextarea(options?: TextareaOptions): Textarea
```

| Option | Default | Description |
|---|---|---|
| `rows` | `2` | Lines to show while empty |
| `maxRows` | — | Stop growing here. Without it the box grows for ever |
| `autoSize` | `true` | Grow with the content |

`textareaProps()` goes on the `<textarea>`; `resize()` re-measures now, for a
layout change the control cannot see.

Auto-sizing is one CSS declaration where the browser has it —
`field-sizing: content` — and the browser then keeps up with every edit,
including the ones no listener sees: autofill, undo, an IME commit, dropped
text. `supportsFieldSizing()` is the check, exported for anyone who needs the
same answer. Where it says no, the real element is measured instead, with the
reset, the read and the write spread across the render and measure phases so
that a page of them shares one layout rather than forcing one each; a
`ResizeObserver` re-measures when the width changes. What is not done either
way is the mirror-element trick: a hidden clone has to follow every font,
padding, border and width of the original and still cannot copy its scrollbar.

This is one of the two places the library writes a style — `field-sizing`,
`min-height` and `max-height`, or `height` and `overflow-y` on the measuring
path — because "as tall as its content" cannot be said in your stylesheet
without the same measurement. With `autoSize: false` nothing is written. On the measuring path
`maxRows` needs a numeric `line-height`; with `line-height: normal` there is no
length to multiply and the box is left uncapped rather than capped somewhere
you did not ask for.

`rows` holds on both paths. The platform ignores it on an element with
`field-sizing: content`, so the auto-sizing path says the floor itself, as a
`min-height` in `lh` — the element's own line height, the same unit `maxRows`
is stated in — and the measuring path uses `rows` as the height it starts from.
Under `box-sizing: border-box` a height counts the padding and border and a
line of text does not, so both `min-height` and `max-height` add them, read
once when the control mounts: `calc(4lh + 10px)` for four lines inside 4px of
padding and a 1px border. A `min-height` your own stylesheet already gives the
textarea is left to govern — an inline one would beat it — so `rows` is not
written over it. Everything written is removed again when the scope goes away.

### `createPasswordInput`

```ts
createPasswordInput(options?: PasswordInputOptions): PasswordInput
```

Adds `revealed` / `defaultRevealed` / `onRevealedChange`, and `isRevealed()`,
`show()`, `hide()`, `toggle()` and `statusText()`. Its `labels` take `show` and
`hide` for the button's name — the locale's `showPassword` and `hidePassword`,
else "Show password" and "Hide password" — and `shown` and `hidden` for what
the live region says — the locale's `passwordShown` and `passwordHidden`, else
"Password shown" and "Password hidden" — alongside the form field's own.

| Prop object | Goes on |
|---|---|
| `inputProps()` | The `<input>`. `type` follows the reveal state; `autocomplete` defaults to `current-password` |
| `toggleProps()` | The reveal button: `type="button"`, a changing `aria-label`, `aria-controls`. No handler — wire `:click` to `toggle()` |
| `statusProps()` | A polite live region, whose text is `statusText()` |

The state is announced twice, and both are needed. The toggle's name changes
between "Show password" and "Hide password", which is what a screen reader
reads when the user next lands on it — but a name that changes as a result of
pressing the thing it names is not reliably announced when it changes, so the
live region says "Password shown" as well. The cost is one element you have to
render. `aria-pressed` is not used, because a toggle whose name already changes
would then read "Hide password, pressed", as though hiding were in force. The
caret is put back after the type changes, since some engines drop the
selection with it.

For a new password, pass `autoComplete: 'new-password'`.

## Typing a number: `createNumberInput`

```ts
createNumberInput(options: NumberInputOptions): NumberInput
```

The visible control is `type="text"` with `role="spinbutton"`, not
`type="number"`, and the reason is locales: much of the world writes 1234.56 as
"1.234,56", and a native number input treats that as bad input and hands back
an empty string. So this parses and formats through `Intl` — and pays for it,
because the platform's own range and step validation goes with the type. That
is done here instead, through the field's custom validity, so the form still
refuses to submit for exactly the reasons the message gives.

A hidden input carries the canonical value, so what reaches the server is
`1234.56` whatever the box says.

| Option | Default | Description |
|---|---|---|
| `input` | — | The visible text input. Required |
| `value` | own state | A `Signal.State<number \| null>`; `null` is empty |
| `defaultValue` | `null` | The starting value |
| `name` | — | Goes on the hidden input, not the visible one |
| `min` / `max` | — | The range |
| `step` | `1` | How far one arrow press moves |
| `largeStep` | ten steps | How far PageUp and PageDown move |
| `enforceStep` | `false` | Report a value off the step grid as invalid |
| `clampOnBlur` | `true` | Pull an out-of-range value back into range when the field is left |
| `formatOptions` | grouping, at the step's precision | `Intl.NumberFormatOptions` for display |
| `locale` | the ambient locale | For a field that is deliberately not localised |
| `labels` | — | Adds `increase`, `decrease`, `notANumber` (each also the locale's key of that name, else "Increase", "Decrease" and "Enter a number."), `tooSmall(min)`, `tooLarge(max)`, `notAStep(step)` |

Plus the common `label`, `description`, `errorMessage`, `id`, `placeholder`,
`required`, `disabled`, `readOnly`, `validate`, `validateOn`, `revalidateOn`
and `onValueChange`.

`enforceStep` is off because a native number input rejects `1.5` against its
default step of `1`, turning what was meant as the size of an arrow press into a
rule about the value. Here a step is how far the arrows move unless you say it
is a constraint.

| Member | Description |
|---|---|
| `value()` | The number, or `null` while empty |
| `text()` | What is in the box, which is not the value while it is being typed |
| `setValue(n)` / `clear()` | Clamped and formatted |
| `increment()` / `decrement()` | One step from the current value, or from empty to `min` (or `0`). Refused while disabled or read-only |
| `canIncrement()` / `canDecrement()` | False at the ends, and while disabled or read-only |
| `commit()` | Parse, clamp (unless `clampOnBlur` is off) and reformat — what leaving the field does |
| `onKeyDown(event)` / `onBlur()` | Wire on the visible input |
| `inputProps()` / `hiddenInputProps()` | The visible input and the one that submits |
| `incrementProps()` / `decrementProps()` | The two spin buttons |
| `field` / `fieldProps()` / `labelProps()` / `descriptionProps()` / `errorMessageProps()` | The composed form field and its parts |

Nothing snaps a value to the step. With a `step` of `1`, typing `1.5` and
leaving the field keeps `1.5`, and an arrow press from there lands on `2.5`;
only `enforceStep` makes the grid a rule, and then by reporting the value
invalid rather than by moving it.

```ts
import { Signal } from '@voltdev/core';
import { createNumberInput } from '@voltdev/primitives';

class Quantity {
  input = new Signal.State<Element | null>(null);
  label = new Signal.State<Element | null>(null);

  qty = createNumberInput({
    input: () => this.input.get(),
    label: () => this.label.get(),
    name: 'quantity',
    min: 1,
    max: 99,
  });
}
```

```html
<div :spread="qty.fieldProps()">
  <label :ref="label" :spread="qty.labelProps()">Quantity</label>
  <input :ref="input" :spread="qty.inputProps()"
         :keydown="qty.onKeyDown($event)" :blur="qty.onBlur()">
  <input :spread="qty.hiddenInputProps()">
  <button :spread="qty.decrementProps()" :click="qty.decrement()">−</button>
  <button :spread="qty.incrementProps()" :click="qty.increment()">+</button>
</div>
```

| Key | Does |
|---|---|
| ArrowUp / ArrowDown | One step |
| PageUp / PageDown | One large step |
| Home / End | `min` / `max`, and nothing when that end is not set |
| Enter | Commits the typed text, then leaves the key to the form so it still submits |

A modified key is left to whatever shortcut owns it. While the box is being
typed into, the value follows the text but the text is not reformatted —
rewriting a box under the caret on every keystroke is the classic way a
formatted field becomes unusable. Text that is not a number is kept as typed,
the value becomes `null`, and validation says why; it is not erased.

The spin buttons are out of the tab order and hidden from assistive technology,
because the spinbutton's own keys do the same job and a second and third tab
stop per field is noise. `aria-valuetext` is written only when the formatted
text says something the bare number does not.

### `parseLocaleNumber`

```ts
parseLocaleNumber(text: string, locale: string): number | null
```

Formatting is the easy half; parsing is where a number field is usually wrong.
Every decimal digit Unicode knows is read, not only the locale's own: `hi-IN`
numbers in Latin digits by default while a Devanagari keyboard types the other
kind and an input method in full-width mode types a third, and a digit read as
decoration and dropped would change the number without a word. Decoration — a
currency symbol, a percent sign, the space inside a French thousands group — is
dropped rather than rejected, because someone who pastes "£1,234.56" means
1234.56.

The one ambiguous case is a lone separator: "1.234" is 1234 in German and
1.234 in English. A separator that is not the locale's decimal is read as
grouping only when a full group of three digits follows it, so "1.5" is a
decimal in every locale. That is a rule, not a certainty.

## Entering a code: `createPinInput`

```ts
createPinInput(options: PinInputOptions): PinInput
```

One box per character, behaving as one field. Pasting a code into any box fills
them all, Backspace in an empty box goes back and deletes, deleting a character
shifts the rest along, and the group holds one tab stop with the arrows moving
inside it — Tab steps over the whole field in one press rather than six.

There are no holes. Focusing a box beyond the first empty one bounces to the
first empty one, because a code with a gap is not a code, and allowing one would
stop the value being a string. The cost is that an empty box further along
cannot be reached at all — by a press or by the keyboard — until the ones
before it are filled; a filled box can still be pressed and typed over.

| Option | Default | Description |
|---|---|---|
| `container` | — | The element holding the boxes. Required |
| `hiddenInput` | — | The hidden input carrying the whole value. Required |
| `length` | `6` | How many boxes |
| `type` | `'numeric'` | `'numeric'`, `'alphanumeric'` or `'any'` |
| `allow` | — | A stricter per-character rule |
| `mask` | `false` | Render dots. A code copied off a screen is not a secret |
| `autoComplete` | `'one-time-code'` | Given to the first box only, which is what autofill expects |
| `onComplete` | — | Called with the code whenever a change leaves every box filled — again if a character of a full code is replaced |
| `labels` | — | Adds `box(position, length)` ("Digit 3 of 6") and `incomplete` (the locale's `incomplete`, else "Enter all the characters.") |

Plus the common `label`, `description`, `errorMessage`, `value`,
`defaultValue` (the starting code, and what a reset goes back to), `id`,
`name`, `required`, `disabled`, `readOnly`, `validate`, `validateOn`,
`revalidateOn` and `onValueChange`.

| Member | Description |
|---|---|
| `value()` / `setValue(code)` / `clear()` | The code. `setValue` cuts it to `length` but does not apply `type` or `allow`, which govern typing and pasting; `clear()` also focuses the first box |
| `length()` / `isComplete()` / `charAt(i)` | How many boxes, whether all are filled, and one box's character |
| `focusBox(i)` | Move focus to a box, and make it the tab stop |
| `onKeyDown(event, i)` / `onInput(event, i)` / `onPaste(event, i)` / `onFocus(i)` | Wire on every box |
| `groupProps()` / `boxProps(i)` / `hiddenInputProps()` | The group, one box, and the input that submits |
| `field` / `fieldProps()` / `labelProps()` / `descriptionProps()` / `errorMessageProps()` | The composed form field and its parts |

`hiddenInput` is required because it is the field's control — what submits,
what the platform validates and what a reset restores — and its value is
written only through that accessor. The boxes are for typing into; nothing in
them reaches the server.

```ts
import { Signal } from '@voltdev/core';
import { createPinInput } from '@voltdev/primitives';

class Verify {
  container = new Signal.State<Element | null>(null);
  hidden = new Signal.State<Element | null>(null);
  label = new Signal.State<Element | null>(null);

  pin = createPinInput({
    container: () => this.container.get(),
    hiddenInput: () => this.hidden.get(),
    label: () => this.label.get(),
    name: 'code',
    required: () => true,
  });

  slots = Array.from({ length: this.pin.length() }, (_, i) => i);
}
```

```html
<label :ref="label" :spread="pin.labelProps()">Verification code</label>
<div :ref="container" :spread="pin.groupProps()">
  <input :for="i in slots" :key="i" :spread="pin.boxProps(i)"
         :keydown="pin.onKeyDown($event, i)" :input="pin.onInput($event, i)"
         :paste="pin.onPaste($event, i)" :focus="pin.onFocus(i)">
</div>
<input :ref="hidden" :spread="pin.hiddenInputProps()">
```

The boxes come from an array of indices because `:for` iterates a collection,
not a count: `:for="i in pin.length()"` renders no boxes at all, and says
nothing about it. Each box is found, in order, by the `PIN_BOX_ATTRIBUTE`
(`data-volt-pin-box`) that `boxProps(i)` writes.

The label's `for` points at the first box rather than at the hidden input, so
pressing it puts the caret where typing starts; the group borrows the field's
ARIA without its id. The group carries the error message, and each box only
`aria-invalid` — six copies of one message is six announcements of one
mistake — and a half-filled code is reported with `labels.incomplete` ("Enter
all the characters."), while an empty one is left to `required`.

## Entering a list: `createTagsInput`

```ts
createTagsInput(options: TagsInputOptions): TagsInput
```

A row of tags with a text input at the end. The tags are one roving-focus group
— one tab stop, arrows inside it — and the text input is a tab stop of its own,
so a field holding twenty tags costs two Tab presses rather than twenty-one.

| Option | Default | Description |
|---|---|---|
| `input` | — | The text input tags are typed into. Required |
| `list` | — | The element holding the tags. Required |
| `root` | — | The element the whole field is drawn on. Required |
| `value` | own state | A `Signal.State<readonly string[]>` |
| `defaultValue` | `[]` | The starting tags |
| `name` | — | Each tag submits as `name=tag` |
| `max` | — | Most tags the field will hold |
| `allowDuplicates` | `false` | |
| `caseSensitive` | `false` | Compared with the locale's collator at accent sensitivity |
| `delimiters` | `[',']` | End a tag when typed and split a paste. A newline always splits a paste |
| `addOnBlur` | `true` | Add the half-typed draft when the field is left |
| `transform` | trim | Clean a tag before it is added |
| `validateTag` | — | Refuse a tag outright |
| `onReject` | — | `(tag, reason)` — `'duplicate'`, `'invalid'` or `'full'` |
| `labels` | — | Adds `list` (the locale's `tags`, else "Tags"), `remove(tag)` (the locale's `removeItem` with the tag as `{label}`, else its `remove` and the tag), `added(tag)`, `removed(tag)`, `duplicate(tag)`, `cleared` (the locale's `tagsCleared`, else "All tags removed"), `empty` (the locale's `tagsEmpty`, else "Add at least one tag.") |

Plus the common `label`, `description`, `errorMessage`, `id`, `placeholder`,
`required`, `disabled`, `readOnly`, `validate`, `validateOn`, `revalidateOn`
and `onValueChange`.

| Member | Description |
|---|---|
| `tags()` / `draft()` / `setDraft(text)` | The tags, and what is half-typed |
| `add(text?)` | Add the draft, or a tag given outright. Returns whether it went in; refused while disabled or read-only |
| `removeAt(i)` / `removeLast()` | Refused while disabled or read-only |
| `clear()` | Empties the row — allowed while disabled, and says so when it took any tags away; see below. The draft is left alone |
| `isFull()` | Whether `max` tags are in |
| `duplicateIndex()` | The tag a refused duplicate collided with, until the next edit — for flashing it |
| `onKeyDown` / `onTagKeyDown` / `onPaste` / `onBlur` | Wire on the text input and on each tag |
| `rootProps()` / `listProps()` / `tagProps(i)` / `removeProps(i)` / `inputProps()` | |
| `hiddenInputProps(i)` | One `type="hidden"` input per tag, so `FormData.getAll(name)` is the list |
| `statusProps()` / `statusText()` | A live region, and what it says |
| `field` / `fieldProps()` / `labelProps()` / `descriptionProps()` / `errorMessageProps()` | The composed form field, whose control is the text input |

```ts
import { Signal } from '@voltdev/core';
import { createTagsInput } from '@voltdev/primitives';

class Topics {
  root = new Signal.State<Element | null>(null);
  list = new Signal.State<Element | null>(null);
  input = new Signal.State<Element | null>(null);
  label = new Signal.State<Element | null>(null);

  tags = createTagsInput({
    input: () => this.input.get(),
    list: () => this.list.get(),
    root: () => this.root.get(),
    label: () => this.label.get(),
    name: 'topic',
    max: 10,
  });
}
```

```html
<label :ref="label" :spread="tags.labelProps()">Topics</label>
<div :ref="root" :spread="tags.rootProps()">
  <ul :ref="list" :spread="tags.listProps()">
    <li :for="(tag, i) in tags.tags()" :key="tag" :spread="tags.tagProps(i)"
        :keydown="tags.onTagKeyDown($event, i)">
      { tag }
      <button :spread="tags.removeProps(i)" :click="tags.removeAt(i)">×</button>
    </li>
  </ul>
  <input :ref="input" :spread="tags.inputProps()" :keydown="tags.onKeyDown($event)"
         :paste="tags.onPaste($event)" :blur="tags.onBlur()">
  <input :for="(tag, i) in tags.tags()" :key="tag" :spread="tags.hiddenInputProps(i)">
</div>
<p :spread="tags.statusProps()">{ tags.statusText() }</p>
```

Keyed by the tag, which is unique unless `allowDuplicates` is on; with
duplicates allowed, key by position instead.

`list` and `root` are required because focus after a removal is placed from
them: the tag that took the removed one's place, the last tag when the row is
now shorter, the text box when none is left, the row when the box refuses focus
— a disabled one does — and the root when the row itself has gone. `<body>` is
the one answer never given, because the next Tab would start from the top of
the document. The rule holds however the tag went, including a write to a value
signal you own.

Adding and removing a tag changes the page without moving focus, which is
silence to a screen reader, so `statusProps()` is a live region that says what
happened, `clear()` included — it says `cleared` when it took any tags away,
and nothing when the row was already empty. `clear()` also empties the row
while disabled or read-only, on purpose, because it is your call rather than
something the user pressed. A form reset puts the tags back silently, as the
platform resets every other control.

Enter adds the draft, and is left to the form when there is no draft, so a form
can still be submitted from its last field. A delimiter typed ends the tag;
Backspace in an empty box removes the last tag, and Escape abandons the draft;
the back arrow in an empty box steps into the row, and the forward arrow off the
last tag steps back out. Both arrows follow writing direction. A paste with a
delimiter or a newline in it becomes several tags, and whatever was already
half-typed in the box is cleared rather than added; a paste without one is left
in the box to be edited.

`required` is checked against the tags rather than written to the text input,
because an empty text box beside five tags is a filled-in field. The field
still answers for it — `isRequired()` is `true` and `data-required` is
written — and an empty row is refused with `labels.empty` ("Add at least one
tag."), which is the field's own sentence rather than the catalogue's generic
"Required".

For a tag that is its own component with its own element,
[`createChip`](./primitives-display#removable-tags) is the primitive to reach
for. This one keeps the row flat because the field owns focus, and where focus
goes after a removal cannot be decided a chip at a time.

## Ticking, switching and choosing one

```ts
createCheckbox(options?: CheckboxOptions): Checkbox
createSwitch(options?: SwitchOptions): Switch
createRadioGroup(options: RadioGroupOptions): RadioGroup
```

All three are built the same way: you render whatever the control looks like,
and a native input sits behind it, visually hidden, carrying the value. The
visible element owns the role, the ARIA and the keyboard; the hidden input owns
submission and constraint validation. None of the three composes the form
field, so none has a `field`, an error-message part or dirty tracking.

```ts
import { Signal } from '@voltdev/core';
import { createCheckbox } from '@voltdev/primitives';

class Terms {
  input = new Signal.State<Element | null>(null);
  agree = createCheckbox({ input: () => this.input.get(), name: 'terms', required: () => true });
}
```

```html
<label :click="agree.toggle()" :keydown="agree.onKeyDown($event)">
  <input :ref="input" :spread="agree.inputProps()">
  <span :spread="agree.controlProps()">I accept the terms</span>
</label>
```

Put the press handler on the outermost element a user can press — the
`<label>`, where there is one. A label forwards presses to the control it
labels, which here is the hidden input, and those forwarded presses are
cancelled so they cannot change the input behind the state's back. The label is
therefore the one place a press is seen exactly once, whether it landed on the
box or on the words beside it.

Each of the three remembers what it was created holding and goes back to it
when its form is reset, writing that starting state to the hidden input as the
`checked` attribute so the platform puts the mirror back to the same place.
Both halves move together, so a box that is plainly ticked after a reset is a
box the form submits. A reset a listener ahead of the control has cancelled is
left alone.

Space toggles and Enter does not, as on the native controls: inside a form
Enter submits, and a control that consumed it would take that away from the
keyboard. A disabled checkbox or switch stays in the tab order with
`aria-disabled`, because a control a keyboard user cannot reach is one they
cannot discover is there; the cost is a tab stop that does nothing. A disabled
radio is the exception — the arrows step over it, and it never holds the
group's tab stop, so a radio group disabled as a whole has no tab stop at all.
`setChecked`, `toggle` and `select` refuse while disabled; an application that
has to change one anyway writes the signal it passed in.

### The hidden input

`VISUALLY_HIDDEN_INPUT_STYLE` is the style `inputProps()` carries, exported for
anything else that needs a control present but unseen. `display: none` is the
obvious answer and the wrong one: an unrendered control cannot be focused, so
when it is `required` and empty the browser blocks the submit and has nowhere to
put the message explaining why — a form that silently refuses to submit. This
keeps a real box one pixel square and clipped away, with pointer events off so
a press always lands on the control you rendered. The input also carries
`aria-hidden` and `tabindex="-1"`, so it is announced and reached once, through
the visible control.

### `createCheckbox`

| Option | Default | Description |
|---|---|---|
| `input` | — | The hidden native input |
| `checked` | own state | A `Signal.State<boolean \| 'indeterminate'>` |
| `defaultChecked` | `false` | |
| `name` | — | Submitted as `name=value` while checked. Without it nothing submits |
| `value` | `'on'` | What a native checkbox submits when given none |
| `disabled` / `required` | — | Accessors |
| `label` / `labelledBy` | — | For a control with no text of its own |
| `onCheckedChange` | — | |

| Member | Description |
|---|---|
| `checked()` | `true`, `false` or `'indeterminate'` |
| `isChecked()` / `isIndeterminate()` / `isDisabled()` | |
| `setChecked(state)` / `toggle()` | Indeterminate counts as unchecked, so toggling it checks |
| `onKeyDown(event)` | Returns whether it was consumed |
| `controlProps()` | `role="checkbox"`, `aria-checked` (`mixed` when indeterminate), `data-state` |
| `inputProps()` | The hidden input |

An indeterminate checkbox submits nothing: on the platform `indeterminate` is
presentation only, and `checked` alone decides what is sent. Without `input` the
checkbox still works and is still announced correctly, but nothing submits,
`indeterminate` cannot be shown to the platform, and a wrapping `<label>` can
toggle the input behind the state's back.

### `createSwitch`

The same options and members without the mixed state, and `role="switch"`. A
switch reports itself as one of two settings rather than as a box that is
ticked, and "partly on" is not a setting. The mirror stays an ordinary
checkbox: the native `switch` attribute changes how a control is painted, and
this one is never seen.

### `createRadioGroup`

| Option | Default | Description |
|---|---|---|
| `group` | — | The group element, so radios are found in document order. Required |
| `value` | own state | A `Signal.State<string \| null>` |
| `defaultValue` | `null` | |
| `name` | — | The shared submission name — what makes the mirrors one group |
| `disabled` / `required` | — | `required` goes on every mirror; the platform treats one checked as all satisfied |
| `loop` | `true` | Arrows wrap past the ends |
| `orientation` | — | Written to `aria-orientation`. The keyboard is unchanged |
| `label` / `labelledBy` | — | A radiogroup takes no name from its contents |
| `onValueChange` | — | Called with `null` when a reset puts back a group that started with nothing chosen |

| Member | Description |
|---|---|
| `value()` / `isSelected(v)` / `select(v)` / `isDisabled()` | |
| `onKeyDown(event)` | Wire on the group |
| `groupProps()` | `role="radiogroup"` |
| `itemProps(value, disabled?)` | The visible radio. Its value is written to `RADIO_VALUE_ATTRIBUTE` (`data-value`) |
| `inputProps(value, disabled?)` | Its hidden native radio |

```ts
import { Signal } from '@voltdev/core';
import { createRadioGroup } from '@voltdev/primitives';

class Plan {
  group = new Signal.State<Element | null>(null);
  options = [{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }];
  plans = createRadioGroup({ group: () => this.group.get(), name: 'plan', label: 'Billing plan' });
}
```

```html
<div :ref="group" :spread="plans.groupProps()" :keydown="plans.onKeyDown($event)">
  <label :for="option in options" :key="option.value" :click="plans.select(option.value)">
    <input :spread="plans.inputProps(option.value)">
    <span :spread="plans.itemProps(option.value)">{ option.label }</span>
  </label>
</div>
```

A radio group is one control: a single tab stop — the selected radio, or the
first while nothing is selected — and moving is choosing, so arrowing onto a
radio selects it, as native radios do. All four arrows move whatever the
orientation, because native radios answer to all four; Home and End jump to the
ends; Space chooses the focused radio, which is how a group entered with
nothing selected gets its first answer. There is no typeahead, because in a
group where moving selects, a stray keystroke would quietly change the answer.

## Rating: `createRating`

```ts
createRating(options: RatingOptions): Rating
```

A star rating, which is a radio group wearing stars — it composes
`createRadioGroup`, so the arrows move and select in one press, Home and End
jump to the ends, exactly one option is in the tab order, and a hidden native
radio per value carries the score into the form. What it adds is halves, a
preview for a hovering pointer, a form field, and a name per option: "3 of 5"
rather than "3", because a bare number in a row of five bare numbers has told
the user nothing.

| Option | Default | Description |
|---|---|---|
| `group` | — | The group element. Required |
| `value` | own state | A `Signal.State<number>`; zero is unrated |
| `defaultValue` | `0` | Also what a form reset goes back to. With a `value` signal, a reset goes back to what the signal held at construction |
| `max` | `5` | Whole steps |
| `allowHalf` | `false` | Offer halves |
| `allowClear` | `true` | Delete and Backspace set it back to zero |
| `name` | — | Shared by the hidden radios |
| `readOnly` | — | A rating that reports a score rather than collecting one |
| `labels` | — | Adds `item(value, max)`, `value(value, max)`, `group` |

Plus the common `label`, `description`, `errorMessage`, `id`, `required`,
`disabled`, `validate`, `validateOn`, `revalidateOn` and `onValueChange`.

| Member | Description |
|---|---|
| `value()` / `setValue(n)` / `clear()` | The score. The setters refuse while disabled or read-only, and `setValue` clamps to 0–`max` without rounding to a step — a value between steps selects no radio and submits nothing |
| `displayValue()` | The previewed value, or the real one — what to paint |
| `values()` | Every selectable value, in order |
| `isSelected(v)` / `isFilled(v)` | Whether a step is chosen, or filled at the value shown |
| `preview(v \| null)` | Show a value without committing to it. Ignored while disabled or read-only |
| `valueText()` | The whole rating as a sentence — "Rated 3 of 5" |
| `isReadOnly()` | Whether it is showing a score rather than asking for one |
| `onKeyDown(event)` | Wire on the group |
| `groupProps()` / `itemProps(v)` / `inputProps(v)` | The group, one visible star, and its hidden radio |
| `field` / `fieldProps()` / `labelProps()` / `descriptionProps()` / `errorMessageProps()` | The composed form field, whose control is the group |

```ts
import { Signal } from '@voltdev/core';
import { createRating } from '@voltdev/primitives';

class Review {
  group = new Signal.State<Element | null>(null);
  label = new Signal.State<Element | null>(null);
  rating = createRating({
    group: () => this.group.get(),
    label: () => this.label.get(),
    name: 'score',
    allowHalf: true,
  });
}
```

```html
<span :ref="label" :spread="rating.labelProps()">Your rating</span>
<div :ref="group" :spread="rating.groupProps()"
     :keydown="rating.onKeyDown($event)" :pointerleave="rating.preview(null)">
  <label :for="v in rating.values()" :key="v"
         :click="rating.setValue(v)" :pointerenter="rating.preview(v)">
    <input :spread="rating.inputProps(v)">
    <span :spread="rating.itemProps(v)">★</span>
  </label>
</div>
```

The label is a `<span>` here because the group, not an input, is what it
names — `for` on a `<label>` would point at a `<div>` and do nothing. Paint the
stars from `data-filled` or `isFilled(v)`, which follow the preview while a
pointer hovers.

The arrows do not wrap: arrowing past five stars back to one is a misclick
waiting to happen.

A `required` rating that nobody has answered is refused by the platform, which
carries `required` on the hidden radios — and the refusal is heard where the
platform makes it. `invalid` is fired at a radio and does not bubble, so the
rating catches it on the way down, cancels the browser's own bubble (it would
point at a radio nobody can see) and puts the message on the page through the
field, exactly as a control of the field's own would.

A read-only rating stops being a radio group and becomes one `role="img"` whose
name is the whole score, and the stars become `aria-hidden` decoration. Five
radios nobody can change are five tab stops that do nothing; the score is one
fact. It still submits — read-only is not disabled — and its `required` is
dropped, since a constraint on an answer nobody can give is a form that can
never be submitted.

## Buttons that stay down: `createToggle`, `createToggleGroup`

```ts
createToggle(options?: ToggleOptions): Toggle
createToggleGroup(options: ToggleGroupSingleOptions): ToggleGroupSingle
createToggleGroup(options: ToggleGroupMultipleOptions): ToggleGroupMultiple
```

A toggle keeps `role="button"` and says which state it is in with
`aria-pressed`. It is not a switch and not a checkbox: a switch is announced as
on or off, a checkbox belongs to a form and submits a value, and a toggle is an
action that stays applied — bold, mute, pin. **Neither of these submits
anything.** There is no hidden input and no `name`; a pressed state that has to
reach a server belongs on a checkbox or a switch.

| Option | Default | Description |
|---|---|---|
| `pressed` | own state | A `Signal.State<boolean>` |
| `defaultPressed` | `false` | |
| `disabled` | — | Accessor |
| `label` | — | `string`, or `(pressed) => string` — "Mute" against "Unmute" |
| `onPressedChange` | — | |

| Member | Description |
|---|---|
| `isPressed()` / `isDisabled()` / `state()` | `state()` is `'on'` or `'off'`, matching `data-state` |
| `press()` / `release()` / `toggle()` | Not refused while disabled: the application can still change it |
| `props()` | Everything, including the click and keydown handlers |

```ts
import { createToggle } from '@voltdev/primitives';

class Editor {
  bold = createToggle({ label: 'Bold' });
}
```

```html
<button :spread="bold.props()">B</button>
```

`props()` works on a `<button>` or on a `<div>`: it carries both `role` and
`type="button"`, because headless code cannot see which element it was handed.
On a real button Enter and Space are left to become the click the browser makes
of them; elsewhere the keydown handler does the activating.

A disabled toggle stays in the tab order with `aria-disabled`, as a disabled
checkbox, switch or slider thumb does: `props()` never writes the native
`disabled` attribute, and the click and keydown handlers refuse the activation
instead — Space is still cancelled first, since a toggle a keyboard user can
reach is one they can press. A disabled group keeps its one tab stop too, on
the chosen item, and its arrows and clicks do nothing. An item disabled on its
own inside an enabled group is passed over by the arrows and never holds the
tab stop, which is the rule every list in the package follows.

A toggle group is a set of them over one value, holding one tab stop. It is
`type: 'single'` (the default) or `type: 'multiple'`, where the value is an array
in the order items were chosen.

| Option | Default | Description |
|---|---|---|
| `group` | — | The element the items are rendered into. Required |
| `value` / `defaultValue` | own state | `string \| null`, or `string[]` when multiple |
| `orientation` | `'horizontal'` | Which arrows move |
| `loop` | `true` | |
| `deselectable` | `true` | The last selected item can be deselected |
| `selectionFollowsFocus` | `true` for a radio group, else `false` | |
| `typeahead` | `false` | Icons have no text to match |
| `disabled` / `label` / `labelledBy` | — | |
| `onValueChange` | — | |

Turning `deselectable` off in single mode makes the group a radio group, and the
role follows: "exactly one of these" has no other correct announcement.

| Member | Description |
|---|---|
| `value()` | `string \| null` in single mode, `string[]` in multiple |
| `isSelected(v)` / `isDisabled()` | |
| `select(v)` / `deselect(v)` / `toggle(v)` | Not refused while disabled, as on `createToggle`. `deselect` refuses the last one when `deselectable` is off |
| `focus(v)` | Move focus to an item and make it the tab stop |
| `groupProps()` | `role`, the name, and the delegated click, keydown and focusin handlers |
| `itemProps(v, { disabled, label }?)` | One item: `aria-pressed`, or `aria-checked` in a radio group |

```ts
import { Signal } from '@voltdev/core';
import { createToggleGroup } from '@voltdev/primitives';

class Toolbar {
  group = new Signal.State<Element | null>(null);
  options = [{ value: 'left', text: 'Left' }, { value: 'right', text: 'Right' }];
  align = createToggleGroup({
    group: () => this.group.get(),
    deselectable: false,
    defaultValue: 'left',
    label: 'Alignment',
  });
}
```

```html
<div :ref="group" :spread="align.groupProps()">
  <button :for="opt in options" :key="opt.value"
          :spread="align.itemProps(opt.value)">{ opt.text }</button>
</div>
```

Items are addressed by value — `itemProps(value, { disabled, label })` — rather
than by element, because a list rendered with `:for` has nowhere stable to hang
a per-item ref. That is also what keeps the group's tab stop across a
re-render that replaces every item element. The handlers are delegated from
`groupProps()`, one set for the whole group.

## Choosing a value on a track: `createSlider`

```ts
createSlider(options: SliderOptions): Slider
```

`<input type="range">` cannot be given two thumbs and cannot be styled, so the
slider is assembled here, with one hidden native input per thumb carrying its
value. One thumb or several is decided by the length of the value array — a
range slider is a slider with a second thumb, and a separate `range` flag would
only let the two disagree.

| Option | Default | Description |
|---|---|---|
| `root` | — | The whole slider. Required |
| `track` | the root | The element whose box maps onto min–max |
| `input` | found under the root | The first thumb's hidden input, which the field validates |
| `value` | own state | A `Signal.State<readonly number[]>` |
| `defaultValue` | `[min]` | One entry per thumb |
| `min` / `max` / `step` | `0` / `100` / `1` | |
| `largeStep` | ten steps | PageUp and PageDown |
| `minStepsBetweenThumbs` | `0` | Thumbs may meet but never pass |
| `orientation` | `'horizontal'` | |
| `dir` | resolved | Force a writing direction |
| `inverted` | `false` | Put the minimum at the other end |
| `marks` / `snapToMarks` | — | Ticks, and whether only they are reachable |
| `name` | — | Submitted once per thumb, so a range submits repeated entries |
| `valueText` | the value, formatted for the locale | What a screen reader hears instead of the number |
| `validate` | — | Given every value |
| `labels` | — | Names for the thumbs: `thumb`, `minimum`, `maximum`, `nth(position)` |
| `onValueChange` | — | Every change, every frame of a drag |
| `onValueCommit` | — | Once it settles — the one to send to a server |

Plus `label`, `description`, `errorMessage`, `disabled` and `required`, passed
to the form field.

Separate `track` whenever the root has padding: a press is otherwise measured
against the box around the track and reported as a value the thumb cannot
reach.

```ts
import { Signal } from '@voltdev/core';
import { createSlider } from '@voltdev/primitives';

class Price {
  root = new Signal.State<Element | null>(null);
  slider = createSlider({ root: () => this.root.get(), defaultValue: [20, 80], name: 'price' });
}
```

```html
<div :ref="root" :spread="slider.rootProps()"
     :pointerdown="slider.onPointerDown($event)"
     :keydown="slider.onKeyDown($event)">
  <span :spread="slider.trackProps()">
    <span :spread="slider.rangeProps()"></span>
  </span>
  <span :for="(v, i) in slider.values()" :key="i" :spread="slider.thumbProps(i)"></span>
  <input :for="(v, i) in slider.values()" :key="i" :spread="slider.inputProps(i)">
</div>
```

Both handlers resolve the thumb from the event, so wiring them once on the root
covers every thumb — which is what lets thumbs come out of a loop. They find it
through `SLIDER_THUMB_ATTRIBUTE` (`data-volt-slider-thumb`), which
`thumbProps(i)` writes, and each thumb's hidden input through
`SLIDER_INPUT_ATTRIBUTE`; both are exported for a stylesheet or a test that
needs the same hook.

| Key | Moves |
|---|---|
| ArrowRight, ArrowUp | One step up |
| ArrowLeft, ArrowDown | One step down |
| PageUp / PageDown | One large step |
| Home / End | The lowest or highest value this thumb may take |

Left and Right follow writing direction and swap under `dir="rtl"`. Up and Down
never swap: vertical order is not mirrored by language, and a vertical slider
whose Up key went down would be unusable.

**Thumbs cannot cross.** Each is clamped between its neighbours, and
`aria-valuemin` and `aria-valuemax` report those constrained bounds. A screen
reader hears a range that shrinks as the other thumb approaches; the
alternative is announcing values the thumb will refuse.

**The nearest thumb takes a press.** With two thumbs on one value the distance
is a tie, and the one that can move towards the press wins — otherwise a stack
of thumbs at the maximum could never be pulled apart.

**Position is a percentage.** `percentAt(i)` and `fill()` are 0–100 along the
value axis, and you place the thumb with `inset-inline-start` or `bottom`, which
mirror themselves. Only the pointer needs to know about direction.

| Member | Description |
|---|---|
| `values()` / `value()` | Every thumb, ascending; the first, for one thumb |
| `setValue(i, v)` / `setValues(list)` / `stepBy(i, steps)` | Quantised, clamped, refused while disabled |
| `percentFor(v)` / `percentAt(i)` | Positions, 0–100 |
| `fill()` | `{ start, end }`, 0–100: from the minimum for one thumb, thumb to thumb for several |
| `boundsAt(i)` | What thumb `i` may move between, once its neighbours are counted |
| `marks()` / `markProps(mark)` | Sorted marks, and `data-state="active"` on a mark inside the filled span |
| `isDisabled()` / `isDragging()` / `activeIndex()` / `orientation()` / `direction()` | |
| `onPointerDown(event)` / `onKeyDown(event)` | Wire once, on the root |
| `rootProps()` / `labelProps()` / `trackProps()` / `rangeProps()` | |
| `thumbProps(i)` / `inputProps(i)` | A thumb, and its hidden input |
| `descriptionProps()` / `errorMessageProps()` | From the field |
| `field` | The composed `FormField`, with `isDirty()` and `reset()` replaced — see below |

Every thumb is a tab stop of its own, with `role="slider"`. A single thumb is
named by the label, or "Value" without one; the thumbs of a range are named
"Minimum" and "Maximum" (`labels` replaces them), because two thumbs called
"Price" do not say which end is which. The label has no `for`: it would point
at a one-pixel hidden input rather than at the thumb.

### The slider in a form

The hidden inputs are `type="range"`, not `type="hidden"`, so the platform
range-checks what they hold and a reset has a control to reset. Each carries
the slider's starting value as its `defaultValue`, and a `reset` on the form
puts the slider back to that value too — so a reset returns the slider to where
it started, and the mirrors agree with it.

`field.reset()` behaves differently here than on every other control: it puts
the value and the mirrors back as well as clearing the record, because a
slider reporting itself clean while it would submit something else is the
disagreement the mirrors exist to prevent. `field.isDirty()` compares what a
submit would send, read from the mirrors on every call, with what a reset would
restore — so a value written into a mirror by a session restore or the
back-forward cache counts, even when nothing announced it.

Both resets put the value back whether or not the slider is disabled. They
write the signal directly rather than going through `setValues`, which refuses
while disabled — and a value nobody may change is exactly the one a reset has
to put back rather than leave behind for the form to submit the moment the
slider is enabled again. The mirrors are written by hand at the same time,
because the platform announces nothing when it puts one back and a rendered
`data-dirty` has to hear about it.

A value written into a mirror from outside is taken up as soon as something
announces it — `input` or `change` on the mirror, or `pageshow` for a page back
from the back-forward cache. The thumb moves to it, settled onto the grid and
into order like any value, `onValueChange` hears it, and the mirrors are filled
from the settled value; a thumb left where it was would show one value over a
form that submits another. It is written directly, as a reset is, so a
disabled slider takes it up too. A write nothing announces cannot be heard: a
script that assigns a mirror and fires nothing leaves the thumb where it was,
and a rendered `data-dirty` catches up on the next render for any other reason
— though `isDirty()` counts it whenever it is asked, and the next value the
slider writes fills the mirrors from itself again.

A range input always holds a value, so `required` can never be what refuses a
slider. Use `validate`, which is handed every value, for a rule about them.

## Uploading files: `createFileUpload`

```ts
createFileUpload(options: FileUploadOptions): FileUpload
```

`<input type="file">` is a picker, not an uploader — no queue, no progress, no
cancel, no retry. This is the whole lifecycle, and it keeps the input: the
picker is the only keyboard route to choosing a file and the only one a screen
reader can reach, and it is what puts the files into a native submit. A drop
zone is the shortcut, not the mechanism.

| Option | Default | Description |
|---|---|---|
| `input` | — | The `<input type="file">`. Required |
| `dropZone` | — | Scopes `onKeyDown` to the zone |
| `liveRegion` | — | Where progress is announced |
| `queue` | own state | A `Signal.State<readonly UploadItem[]>`, for a store that outlives the component |
| `transport` | — | How bytes leave. Without one nothing is sent |
| `auto` | `true` | Start as soon as files are added |
| `concurrency` | `3` | Files in flight at once |
| `chunkSize` | — | Split each file into chunks of this many bytes |
| `resumeFrom` | — | Ask the server how much it has, for a chunked upload |
| `retries` | `0` | Attempts after a failure |
| `retryDelay` | [`exponentialBackoff`](./primitives-data#retrying) | `(attempt, error) => milliseconds`. The default waits a random time between half and all of 300 ms × 2^(attempt − 1), capped at 30 s |
| `name` | — | The submission name for the input, so a plain form post carries the files. Dropped when there is a `transport` |
| `accept` / `maxSize` / `maxFiles` | — | `maxSize` in bytes; `maxFiles` counts the whole queue |
| `multiple` | `true` | With `false`, each file added replaces the queue |
| `directory` / `maxDirectoryDepth` | — / `8` | Pick and walk directories |
| `validate` | — | `(file) => rejection`. A string, or `{ code, message }`, refuses the file; nothing accepts it |
| `paste` / `fullPage` | — | Take files pasted anywhere on the page; take a drop anywhere on the page |
| `blockSubmitWhileBusy` | `true` | A form that posts half an upload is worse than one that waits |
| `label` / `description` / `errorMessage` / `required` / `disabled` | — | Passed to the form field |
| `labels` | — | Every string: the drop zone's and the bars' names, the cancel, retry and remove buttons' names, the three refusal reasons, `uploadFailed`, `busy`, and the three announcements. `remove(item)` defaults to the locale's `removeItem` with the file's name as `{label}`, else its `remove` and the name |
| `on…` | — | `onFilesAdded`, `onReject`, `onItemProgress`, `onItemComplete`, `onItemError`, `onComplete` |

Without a `transport` nothing is sent, and the files sit at `'pending'` for
ever. That is the shape for a form that posts its files through the input
itself, and it submits: a file nothing will ever send is not a file on its way
anywhere, so the busy rule applies only where there is a transport to be busy
with. Give that form a `name` and it posts every queued file.

**Rejected files stay in the queue**, with status `'rejected'` and a reason
code — `'type'`, `'size'`, `'count'` or `'custom'`. A file that silently fails
to appear leaves "why isn't my photo uploading" with no answer on the page.

**Progress is announced by events, not bytes.** The live region speaks when a
file finishes or fails, never on the way, because a percentage read aloud four
times a second is not information.

**The transport is asked for one body at a time.** Chunking, concurrency,
retries and resumption are decided here, and the transport sees only "send
these bytes, report progress, honour this signal".

```ts
import { Signal } from '@voltdev/core';
import { createFileUpload, xhrTransport } from '@voltdev/primitives';

class Attachments {
  input = new Signal.State<Element | null>(null);
  zone = new Signal.State<Element | null>(null);
  label = new Signal.State<Element | null>(null);
  live = new Signal.State<Element | null>(null);

  upload = createFileUpload({
    input: () => this.input.get(),
    dropZone: () => this.zone.get(),
    label: () => this.label.get(),
    liveRegion: () => this.live.get(),
    transport: xhrTransport({ url: '/api/files' }),
    accept: 'image/*',
    maxSize: 5_000_000,
  });
}
```

```html
<div :spread="upload.rootProps()">
  <label :ref="label" :spread="upload.labelProps()">Attachments</label>
  <div :ref="zone" :spread="upload.dropZoneProps()"
       :dragenter="upload.onDragEnter($event)" :dragover="upload.onDragOver($event)"
       :dragleave="upload.onDragLeave($event)" :drop="upload.onDrop($event)"
       :keydown="upload.onKeyDown($event)" :click="upload.open()">Drop files here</div>
  <input :ref="input" :spread="upload.inputProps()" :change="upload.onInputChange($event)">
  <ul>
    <li :for="item in upload.items()" :key="item.id" :spread="upload.itemProps(item)">
      { item.file.name } { item.error?.message }
      <div :spread="upload.itemProgressProps(item)"></div>
      <button :spread="upload.cancelProps(item)" :click="upload.cancel(item.id)">Cancel</button>
      <button :spread="upload.retryProps(item)" :click="upload.retry(item.id)">Retry</button>
      <button :spread="upload.removeProps(item)" :click="upload.remove(item.id)">Remove</button>
    </li>
  </ul>
  <div :ref="live" :spread="upload.liveRegionProps()">{ upload.announcement() }</div>
</div>
```

| Member | Description |
|---|---|
| `items()` / `item(id)` / `counts()` | The queue, one item, and how many are in each status |
| `progress()` / `loadedBytes()` / `totalBytes()` | Across every file not refused or cancelled — waiting ones included — by bytes rather than by count |
| `isUploading()` / `isDragging()` / `isPageDragging()` | |
| `announcement()` | What the live region should say — `''` until the region can be heard |
| `add(files)` | Validate and enqueue. Returns the items added, refusals included |
| `upload()` / `uploadItem(id)` | Start what is pending, when `auto` is off. `uploadItem` also restarts a failed or cancelled file |
| `cancel(id)` / `cancelAll()` / `retry(id)` / `retryFailed()` | `retryFailed()` retries failed and cancelled files. A refused file is never retried |
| `remove(id)` / `clear()` | Cancel and forget |
| `open()` | Open the picker. Refused while disabled |
| `onInputChange` / `onDragEnter` / `onDragOver` / `onDragLeave` / `onDrop` / `onPaste` / `onKeyDown` | Wire in the template |
| `rootProps()` / `dropZoneProps()` / `inputProps()` / `triggerProps()` | `triggerProps()` is for a separate browse button |
| `itemProps(item)` / `itemProgressProps(item)` / `progressProps()` | Progress bars built on [`createProgress`](./primitives-display#progress) |
| `cancelProps(item)` / `retryProps(item)` / `removeProps(item)` / `liveRegionProps()` | |
| `labelProps()` / `descriptionProps()` / `errorMessageProps()` / `field` | |

Each `UploadItem` is one file's whole life, and a new object each time it
changes:

| Field | Description |
|---|---|
| `id` / `file` / `path` | `path` is the file's place inside a dropped directory, or its name |
| `status` | `'pending'`, `'uploading'`, `'success'`, `'error'`, `'cancelled'` or `'rejected'` |
| `loaded` / `total` / `progress` | Bytes confirmed sent, the size, and 0–100 |
| `error` | `{ code, message, cause? }` — `code` is `'type'`, `'size'`, `'count'`, `'custom'` or `'transport'` |
| `response` | What the transport resolved with, once it succeeded |
| `attempts` / `chunk` | Tries so far, and the chunks the server has taken — where a retry resumes |

The drop zone is `role="button"` and stays in the tab order even while
disabled — a zone nobody can reach from a keyboard is worse than one reached
twice. Enter and Space on it open the picker; when a `dropZone` accessor is
given, a key from anywhere else is left alone, so a handler wired higher up does
not swallow Enter from the fields beneath it. `announcement()` stays empty
until the region has been on the page long enough for a screen reader to hear
it change, which is what `liveRegion` is for; keep the region mounted rather
than under `:if`, or it pays that wait every time it appears.

### The upload in a form

The input's own list of files is rewritten from the queue whenever it changes,
so a dropped or pasted file is part of a native submit and satisfies
`required`, exactly as a picked one would. Refused files are listed in the
queue for the user to read and are never put in the input.

**`name` makes the form carry the files**, and `inputProps()` writes it to the
input. It is dropped when a `transport` is given, because the input holds every
queued file, already-sent ones included, and a named input would post their
bytes a second time with the form. A `name` written in your own markup is your
own business and is left alone.

**The queue decides whether the form may submit.** A refused or failed file is
pushed into the input's custom validity the moment it happens — it is news
about something the user just did — so the submit is refused with that file's
reason until the user removes it or retries it until it succeeds.

A file still going up refuses the submit too, with `labels.busy` ("Wait for
the upload to finish."), unless `blockSubmitWhileBusy` is `false` or there is
no transport. That one is checked when the field validates rather than pushed
in as it happens: an upload in progress is not a mistake, and announcing one in
a `role="alert"` region every time a file was added would be an alarm about
nothing. So the message arrives with the submit it refuses, and goes again when
the upload finishes rather than waiting for the next submit to take it back.
Nothing here makes an untouched `required` upload invalid before anyone has
submitted.

The cost is the one every `validate` rule carries until its field has
validated: the platform does not hold it. `form.checkValidity()` answers
`true` while a file is going up, and a `submit` listener that runs ahead of the
field — one capturing on an ancestor — hears the submit before the field has
refused it. Such a listener can ask `upload.field.report()` itself, which
refuses for the same reason the field will, or read `upload.counts()`.

**Hide the input with `VISUALLY_HIDDEN_INPUT_STYLE`**, if you hide it at all,
not with `display: none`: a required file input the browser cannot render has
nowhere to point when it refuses the submit. `inputProps()` leaves the choice
to you.

### Transports

```ts
xhrTransport(options: HttpTransportOptions): UploadTransport
fetchTransport(options: HttpTransportOptions): UploadTransport
type UploadTransport = (request: UploadRequest) => Promise<unknown>
```

| Option | Default | Description |
|---|---|---|
| `url` | — | A string, or a function for a URL signed per file or chunk |
| `method` | `'POST'` | |
| `headers` | — | An object, or a function of the request |
| `raw` | `false` | Send the bytes as the body; a chunk's range goes in `Content-Range` |
| `fieldName` | `'file'` | The multipart field |
| `fields` | — | `(request) => Record<string, string>`: extra multipart fields — a CSRF token, an album id |
| `withCredentials` | `false` | Send cookies cross-origin |
| `parse` | JSON when the response says so, else text | |

A transport of your own is handed an `UploadRequest` — `file`, `item`, `body`
(the whole file, or one chunk's slice), `chunk` (`{ index, count, start, end }`,
or `null`), an `AbortSignal` to honour, and `progress(loaded)` to report bytes
of `body` sent — and resolves with whatever should land in `item.response`.
Throwing is a failure the retry policy sees.

The two shipped transports send multipart form data: the file under
`fieldName`, its `name`, its `path` when a directory upload gave it one, and
for a chunk `chunkIndex`, `chunkCount`, `chunkOffset`, `fileSize` and an
`uploadId` that stays the same across every chunk and retry of one file. A
status outside 200–299 is a failure.

`xhrTransport` exists because `XMLHttpRequest` is still the only way to observe
an upload's progress. `fetchTransport` is smaller and cannot report progress,
so each file jumps from nothing to done; pair it with `chunkSize` and the bar
moves once per chunk.

```ts
matchesAccept(file: File, accept: string): boolean
```

The `accept` check on its own: an extension, a wildcard type or an exact type,
with extensions matched case-insensitively because a camera writes `.JPG`. An
empty list accepts everything. It reads the name and the type the browser
reports, never the bytes, so it is a filter for the user's benefit and not a
check a server can skip.

## Copying: `createClipboard`

```ts
createClipboard(options: ClipboardOptions): Clipboard
```

| Option | Default | Description |
|---|---|---|
| `text` | — | `() => string`, read at the moment of the copy. Required |
| `resetAfter` | `2000` | How long `status()` stays at `copied` or `failed` |
| `labels` | — | `copied` and `failed`, for what is announced. Without them the locale's `copied` and `copyFailed`, and "Copied" and "Could not copy" where the catalogue has neither |
| `onCopy` / `onError` | — | `(text)` after a copy; `(error)` with whatever the refusal threw |

| Member | Description |
|---|---|
| `status()` | `'idle'`, `'copied'` or `'failed'` |
| `isCopied()` | Whether the last attempt succeeded and its window is still open |
| `copy()` | Resolves to whether the text reached the clipboard |
| `triggerProps()` | `type="button"`, `data-state`, and an `onclick` — see below |

```ts
import { createClipboard } from '@voltdev/primitives';

class RequestId {
  id = 'req_8f2c';
  clip = createClipboard({ text: () => this.id });
}
```

```html
<button :spread="clip.triggerProps()">Copy id</button>
```

`triggerProps()` builds its `onclick` each time it is read, and `:spread` reads
it again whenever `status()` changes — twice a copy — replacing the listener
each time, so a press copies once however often the status has changed.

The copied state ends on a timer, cancelled if the component goes away first —
a button that says "Copied" for ever is lying by the time anyone looks back. The
result is announced through
[the shared announcer](./primitives#announcements-announce) rather than by
changing the button's own name, which screen readers announce inconsistently
while focus is on it; a failure is announced assertively. The sentence is the
whole of what a screen-reader user is told about the copy, so it comes from the
locale catalogue — `labels` is for wording that is about this particular
button, "Link copied".

Outside a secure context `navigator.clipboard` is not there, and the fallback
is the deprecated selection-and-`execCommand` route, which is still the only
thing that works on a plain-HTTP internal tool. It moves focus to a temporary element and puts it
back. A refusal is reported as `'failed'`, not swallowed.

## What a plain form post carries

| Factory | The element that carries the value | Submits |
|---|---|---|
| `createInput`, `createPasswordInput` | The `<input>` itself | `name=value` |
| `createTextarea` | The `<textarea>` itself | `name=value` |
| `createNumberInput` | A `type="hidden"` input | `name=1234.56`, never the formatted text |
| `createPinInput` | A visually-hidden text input, via `hiddenInput` | `name=` the whole code |
| `createTagsInput` | One `type="hidden"` input per tag | `name` once per tag |
| `createCheckbox`, `createSwitch` | A visually-hidden checkbox | `name=value` while checked |
| `createRadioGroup`, `createRating` | A visually-hidden radio per option | `name=value` for the chosen one |
| `createSlider` | A visually-hidden range input per thumb | `name` once per thumb |
| `createFileUpload` | The `<input type="file">` | every queued file not refused, as a native submit sends them — with a `name` and no `transport` |
| `createToggle`, `createToggleGroup` | nothing | — |
| `createFormField` | whatever control you gave it | — |

Nothing submits without a `name`. Where `name` is absent it is left off the
element rather than set to `undefined`, which a form would send as the string
"undefined".

## What a form reset does

A reset restores each native control to its default — the `value` *attribute*,
the `checked` *attribute* — and fires one `reset` event at the form and no
`input` at anything. A value written to an element's *property* is not a
default, so each control here writes its starting state as the default too, and
the platform and the state then go back to the same place.

**Where it is going is known, not read back.** `reset` is dispatched before the
platform puts anything back, nothing is fired once it has, and when a press on
a reset button is what dispatched it, even a microtask queued from a listener
runs first. So nothing here waits for the event and reads the control: each
control writes what it is going back to, as the platform is about to, and the
platform then writes the same thing over it. A reset a listener ahead of the
control has cancelled — the "discard your changes?" answered no — is left
alone by every one of them.

| Control | After `form.reset()` |
|---|---|
| `createInput`, `createTextarea`, `createPasswordInput` | Goes back to `defaultValue`, or to what a `value` signal held at construction |
| `createNumberInput` | The same, formatted for the locale; the hidden input follows the box |
| `createPinInput` | The same, and the tab stop moves to where the next character goes — the first box, for an empty code. `onComplete` is not called for a code nobody completed |
| `createRating` | Goes back to `defaultValue`, its hidden radios with it — read-only or disabled included |
| `createTagsInput` | Goes back to `defaultValue`, and clears the draft |
| `createCheckbox`, `createSwitch`, `createRadioGroup` | Go back to how they were created, state and hidden input together |
| `createSlider` | Goes back to the value it started with, mirrors and all, whether or not it is disabled |
| `createFileUpload` | Empties the queue, cancelling anything in flight — a file input has no default list of files, so the platform empties the input and the queue goes with it |
| `createFormField` | Validation, touched and dirty are cleared, and dirty is measured against the value the reset is restoring |

`field.reset()` is the other half of the same thing. It clears validation and
touched and measures dirty again without touching the value — the slider's
excepted, which puts the value back as well — for a form reset some other way:
a "discard" button that writes the signals back itself, then calls it.

A control created with a `defaultValue` is not dirty at mount, because that
value is its default as well as its value. A `value` attribute of your own in
the markup is adopted rather than overwritten in the text-shaped controls, and
is then what the control starts at and goes back to.

## Type names

Every option object, return value and prop bag above is exported as a type,
for a wrapper component that has to spell one. The ones not already named on
this page:

| Type | What it is |
|---|---|
| `ValidationState`, `ValidationTrigger` | `'valid' \| 'invalid' \| 'pending'`, and `'submit' \| 'blur' \| 'input'` |
| `ConstraintKey` | The nine `ValidityState` names `labels` can override, `valueMissing` to `stepMismatch` |
| `FormFieldIds` | What `ids()` returns: `control`, `label`, `description`, `errorMessage` |
| `TextFieldOptions` | The options the three text controls share; `InputOptions` and `TextareaOptions` extend it, and `PasswordInputOptions` extends it with its own `labels` |
| `TextInputType` | `'text' \| 'email' \| 'password' \| 'search' \| 'tel' \| 'url'` |
| `CheckedState` | `boolean \| 'indeterminate'` |
| `TagRejection` | `'duplicate' \| 'invalid' \| 'full'`, what `onReject` is told |
| `ToggleState`, `CopyStatus` | `'on' \| 'off'`, and `'idle' \| 'copied' \| 'failed'` |
| `SliderMark`, `SliderOrientation` | `{ value, label? }`, and `'horizontal' \| 'vertical'` |
| `ToggleGroupOptions`, `ToggleGroup` | The single and multiple shapes as unions; `ToggleGroupBaseOptions` and `ToggleGroupBase` are what they share |
| `ToggleGroupItemOptions` | `itemProps`' second argument: `{ disabled?, label? }` |
| `UploadStatus`, `UploadErrorCode`, `UploadError` | An item's `status`, its error's `code`, and the error itself |
| `UploadChunk`, `UploadRejection` | A request's `chunk`, and what `validate` may return |
| `FormFieldLabels`, `NumberInputLabels`, `PasswordInputLabels`, `PinInputLabels`, `TagsInputLabels`, `RatingLabels`, `SliderLabels`, `FileUploadLabels`, `ClipboardLabels` | Each factory's `labels` option |
| `FormFieldProps`, `InputProps`, `ControlProps`, `SliderProps`, `FileUploadProps`, `ToggleGroupItemProps` | The prop bags that hold attributes only |
| `ToggleProps`, `ToggleGroupProps`, `ClipboardProps`, `ToggleHandler` | The prop bags that also hold handlers, and the handler type, `(event: Event) => void` |

```ts
import type { SliderMark, UploadItem, ValidationTrigger } from '@voltdev/primitives';

// A scale described as data, for a slider's `marks` option.
const scale: SliderMark[] = [{ value: 0, label: 'Off' }, { value: 50 }, { value: 100, label: 'Full' }];

// One timing chosen for every field in a form.
const validateOn: ValidationTrigger = 'blur';

// What a row in an upload list shows.
const caption = (item: UploadItem): string =>
  item.status === 'rejected' ? `${item.file.name}: ${item.error?.message ?? ''}` : item.file.name;
```
