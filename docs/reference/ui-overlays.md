# Overlay components

Everything that floats over the page: a dialog, a popover, a tooltip, a menu, a toast.

Each component below is a tag you write, with the primitive that owns its
behaviour named beside it. What is not a tag yet is the markup to write by
hand: the same primitive, the same class names, and the same look — which is
what makes a component here a shortcut rather than a wall.

See [the package](./ui) for the two entries, the stylesheet, the tokens and
how to override a rule.

## `<v-dialog>`

`createDialog`, with the markup written. The state is one signal both sides
hold: pass `open` and it is yours to read and write, pass nothing and the
dialog owns it.

<Demo name="dialog" height="300" />

```html
<v-button variant="danger" :onPress="show">Delete project</v-button>

<v-dialog
  :open="open"
  title="Delete this project?"
  description="Its history goes with it, and this cannot be undone."
>
  <template :slot-footer>
    <v-button variant="ghost" :onPress="hide">Cancel</v-button>
    <v-button variant="danger" :onPress="remove">Delete</v-button>
  </template>
</v-dialog>
```

| Prop | Type | Means |
|---|---|---|
| `open` | `Signal.State<boolean>` | Your signal, when the state is yours |
| `defaultOpen` | `boolean` | Where it starts, when the dialog owns its state |
| `modal` | `boolean` | Traps focus, makes the rest inert, locks scrolling |
| `closeOnEscape`, `closeOnOutsidePointer` | `boolean` | Both default to true |
| `title`, `description` | `string` | Rendered, and named to the screen reader by the primitive's own ids |
| `onOpenChange` | `(open: boolean) => void` | |

Slots: the default one is the body, `header` replaces the title line when a
heading needs markup, and `footer` is the row of buttons. `modal`,
`defaultOpen` and the two `closeOn` props are read once, when the primitive is
built, so they are not signals and changing them later does nothing — which is
also why they are written down here.

For anything this does not offer — `dialog.open()` from elsewhere, the
primitive's own props on your own markup — take the primitive:

```html
<v-dialog :ref="box" title="Delete this project?"></v-dialog>
```

```ts
box: VDialog | null = null;
later(): void { this.box?.dialog.open(); }
```

## `<v-popover>`

A panel anchored to the button that opened it — `createPopover`, with the
markup written. Non-modal: focus moves into the panel, and the page behind
stays live, scrollable and readable.

<Demo name="popover" height="300" />

```html
<v-popover
  variant="primary"
  placement="bottom-start"
  :title="heading()"
  description="Only the runs that match stay in the list."
>
  <template :slot-trigger>Filters</template>
  <v-button size="sm" :onPress="clear">Clear them</v-button>
</v-popover>
```

The trigger is the component's, where the dialog's is markup of your own, and
the difference is the positioning: the panel is placed against the trigger in
CSS, and the `anchor-name` that does it has to be on an element the component
renders. So the trigger is a `<button>` drawn with the sheet's button rules —
`variant` and `size` are that button's — and the `trigger` slot is what goes
inside it.

| Prop | Type | Means |
|---|---|---|
| `open` | `Signal.State<boolean>` | Your signal, when the state is yours. A signal or nothing — see below |
| `defaultOpen` | `boolean` | Where it starts, when the popover owns its state |
| `placement` | `'top' \| 'right' \| 'bottom' \| 'left'`, each also as `-start` and `-end` | Which side of the trigger it sits on, and which edge it lines up with. Default `bottom` |
| `offset` | `number \| string` | The gap between trigger and panel, written inline in place of the sheet's. A bare number is pixels either way you write it: `offset="8"` and `:offset="8"` are the same gap |
| `flip`, `shift` | `boolean` | Let the browser move it when it would overflow. Both default to true |
| `modal` | `boolean` | Keeps focus inside. Unlike the dialog it leaves the page behind live |
| `closeOnEscape`, `closeOnOutsidePointer` | `boolean` | Both default to true |
| `title`, `description` | `string` | Rendered, and named to the screen reader by the primitive's own ids |
| `label` | `string` | The panel's name for a screen reader when it has no title |
| `variant` | `'primary' \| 'danger' \| 'ghost'` | The trigger's look |
| `size` | `'sm' \| 'lg'` | The trigger's size |
| `onOpenChange` | `(open: boolean) => void` | |

Slots: `trigger` is what the button holds, the default one is the body, and
`title` and `description` are drawn *inside* the elements those two props fill.
That is where markup for a heading has to go: the primitive names the panel
after the element carrying its own id, so a heading written beside that element
would be a panel with a visible title and no name. Which makes the prop the
thing that says there is a heading at all — without one the element is not
rendered, and `label` names the panel rather than an empty line.

Which is also the one sharp edge here: the element carries the slot, so
**`:slot-title` and `:slot-description` are drawn only when the matching prop
is set**, and markup put in either slot without it is never rendered. Set the
prop to the words a reader should hear and put the rest in the slot.

```html
<v-popover title="Filters">
  <template :slot-title>Filters <v-button size="sm" :onPress="clear">clear</v-button></template>
</v-popover>
```

`defaultOpen`, `placement`, `offset`, `flip`, `shift`, `modal`, `label` and the
two `closeOn` props are read once, when the primitive is built, so they are not
signals and changing them later does nothing — which is also why they are
written down here. `title` and `description` are the other kind: bind them and
the panel's name and description follow, including while it is open.

`open` is the one signal both sides hold, and markup cannot write a signal —
`open` on its own, or `:open="true"`, is refused by name rather than taken. To
have a popover start open, write `defaultOpen`.

What you write on the tag reaches the **panel**, not the trigger. The panel is
portalled to `<body>`, and it is the thing `<v-popover class="wide">` is about;
the trigger is a button, and `variant` and `size` are how it is drawn. A
popover renders its own trigger, so there is no button of yours to wrap it in.
An `aria-label` of your own reaches it too, and names the panel where there is
no `title` and no `label`.

Two attributes are the component's rather than yours, and both are load
bearing: the panel's `id`, which is what the trigger's `aria-controls` points
at, and `role="dialog"`, which is what the trigger's `aria-haspopup` promises.
Writing either on the tag does not take. Reach the panel with a class, or take
the element itself with `:ref`.

The arrow is drawn from the placement that was asked for, and no engine reports
which fallback it took — so a panel the browser flips or shifts keeps an arrow
pointing at nothing. `:flip="false"` and `:shift="false"` together hold the
placement, at the price of a panel that can run off the edge of the viewport.

Tab out of the panel lands either side of the trigger rather than beside the
portal, and closes the popover on the way. There is no close button: the body
is yours, and so is whatever closes it.

For anything this does not offer — closing it from elsewhere, the primitive's
own props on markup of your own — take the primitive:

```html
<v-popover :ref="filters" title="Filters"><p>…</p></v-popover>
```

```ts
filters: VPopover | null = null;
later(): void { this.filters?.popover.close(); }
```

## `<v-tooltip>`

A short description of the control it is written around, shown on hover and on
keyboard focus — `createTooltip`, with the markup written and the delay group
already shared.

<Demo name="tooltip" height="220" />

```html
<v-tooltip text="Delete permanently">
  <v-button :slot-trigger variant="danger">Delete</v-button>
</v-tooltip>
```

The control goes in the `trigger` slot and the description is the default slot,
or `text` when it is a line of text. It opens on focus as well as on hover,
which is the point: hover alone puts the text behind a pointer, and the user
with no pointer is the one the description was written for. So the trigger has
to be something that can take focus — a button, a link, an element you have
made focusable. A tooltip on a bare `<span>` is unreachable by keyboard, and no
attribute this writes fixes it.

| Prop | Type | Means |
|---|---|---|
| `text` | `string` | The description, when it is a line of text |
| `open` | `Signal.State<boolean>` | Your signal, when the state is yours |
| `defaultOpen` | `boolean` | Where it starts, when the tooltip owns its state |
| `openDelay`, `closeDelay` | `number` | ms before it opens and after the pointer leaves. Default 700 and 300 |
| `skipDelay` | `number` | ms after the last tooltip closed that the next still opens at once. Default 300 |
| `label` | `string` | An accessible name for the trigger, for when this text is the only name it has |
| `placement` | `'top' \| 'bottom' \| 'left' \| 'right'`, each also `-start` or `-end` | Default `top`, the one side a pointer resting on the trigger cannot cover |
| `offset` | `number \| string` | The gap between trigger and label. A number is pixels |
| `flip` | `boolean` | Let the browser take the opposite side when this one would overflow |
| `closeOnEscape` | `boolean` | Escape closes it. Turned off, the key reaches the layer beneath |
| `onOpenChange` | `(open: boolean) => void` | |

Slots: `trigger` is the control, and the default slot is the description —
markup, when a line of text is not enough:

```html
<v-tooltip label="Delete">
  <button :slot-trigger class="volt-button" data-variant="danger">✕</button>
  <b>Delete</b> permanently
</v-tooltip>
```

`label` is what names that button. A control described but not named is
announced as "button", and some screen readers skip descriptions by default, so
an icon trigger wants the same words twice.

Everything but `text` and `open` is read once, when the primitive is built, so
those props are not signals and changing them later does nothing — which is
also why they are written down here.

Turning one of the booleans off means binding it — `:flip="false"` and
`:closeOnEscape="false"`, not `flip="false"`. A plain attribute is the string
`"false"`, which is truthy, so the unbound spelling asks for the opposite of
what it reads like. That is how attributes work rather than anything this
component does, and `<v-dialog>` takes its booleans the same way.

**The tooltip owns a `<span>` around your trigger.** The primitive is handed an
element — it anchors to it, asks whether the pointer moved into it, and
excludes it from dismissal — and slot content is your markup, which a template
cannot `:ref`. A `<span>` is what makes that free: it is inline, takes no rule
from the sheet, and its box is its content's box, so the label is anchored
where the control is and the row lays out as it did. Two things the wrapper
cannot stand in for, and the component does not leave either broken:
`aria-describedby` and `aria-label` are written onto the control inside it,
because a description on a `<span>` around a button is one no screen reader
will read; and focus is heard through `focusin` and `focusout`, since `focus`
and `blur` do not bubble past the control that took them.

**The control is the first thing in the slot that can take focus**, so you may
group it with an icon or a badge and the description still lands on the element
a reader announces:

```html
<v-tooltip text="Remove" label="Remove">
  <span :slot-trigger class="with-badge">
    <button>✕</button>
    <b class="badge">3</b>
  </span>
</v-tooltip>
```

**What you wrote on that control stays.** The label's id is added to your
`aria-describedby` rather than written over it, and taken out again when the
tooltip closes:

```html
<v-tooltip text="Deleted rows go to the bin for thirty days">
  <button :slot-trigger aria-label="Delete row" aria-describedby="bin-help">✕</button>
</v-tooltip>
```

Open, that button is `aria-describedby="bin-help tooltip-content-1"`; closed, it
is `aria-describedby="bin-help"` again, and its `aria-label` is its own the
whole time. `label` is the one exception, because it is you asking this tooltip
to name the trigger: pass it and it wins over a name on the control.

`:host` is on the floating label, not on the wrapper — so
`<v-tooltip class="wide">` widens the label. The trigger is markup you wrote
and can class yourself; the label is the one element of this you cannot
otherwise reach. A caller who needs more than that takes the primitive:

```html
<v-tooltip :ref="tip" text="Delete permanently">
  <button :slot-trigger class="volt-button">Delete</button>
</v-tooltip>
```

```ts
tip: VTooltip | null = null;
later(): void { this.tip?.tooltip.open(); }
```

The delay group is shared by every tooltip on the page, not by the ones inside
one component: once the first has opened, the next opens at once, and the
window outlives it by `skipDelay` so that crossing a gap between two buttons
does not drop you back to the full wait. That is global on purpose — a toolbar
and the lone icon button beside it are one group to the person using them — and
it is the one thing here you cannot scope.

## Written by hand

The same look without the tag: the primitive, the markup you want, and the
sheet's class names on it. This is what a component here is made of, and what
to reach for when a component's shape does not fit — or when the component does
not exist yet.

### Dialog

The content is fixed to the centre of the viewport, at most 30rem wide, and
never taller than the viewport less a margin — it scrolls instead, because a
dialog taller than the screen with no way to scroll is a dialog with an
unreachable confirm button. The overlay is yours, as in
[the example on the package's own page](./ui#putting-classes-on-the-markup). The content has a focus
ring of its own, since it takes focus itself when nothing inside it wants to.

The centring is a `translate`, and the entry and exit animations move
`translate` too — rising into the centre and sinking out of it. An animation's
value beats a rule's, and these fill forwards, so their keyframes carry the
centring with them and end exactly where the rule puts the content. The same
fill beats a `translate` of your own on the content, so a dialog you want
somewhere else wants new keyframes as well as a new rule.

### Popover, menu and tooltip

All three are positioned by the primitive through CSS anchor positioning, which
writes the positioning scheme, `position-anchor` and `position-area` inline,
so where they go is none of the sheet's business and `:portal` is safe for all
three, as the primitives' own examples use it. The `data-anchored="false"` a
primitive writes where the browser cannot anchor gets no rule: every current
engine anchors, and a portalled element has no positioned ancestor near its
trigger that a rule could place it against.

The gap the sheet leaves between a popover and its trigger is a margin on the
side that faces the trigger — above and below it for a `top` or `bottom`
placement, beside it for a `left` or `right` one, and none across it, where it
would push a popover aligned to one of the trigger's edges off that edge. Pass
`offset` to `createPopover` and the primitive writes the gap inline instead.

The popover arrow is drawn from `data-placement` and `data-align`, which the
primitive writes on it, for all twelve placements: the sheet moves it onto the
edge that faces the trigger, hides the two borders that would show inside the
popover, and sets it along that edge where the trigger is — the middle for a
centred placement, and near the aligned edge for a `-start` or `-end` one.
`data-align` names that edge physically — `left`, `right`, `top` or `bottom` —
and the primitive resolves it against the trigger's own writing direction,
which a popover portalled to `<body>` does not share: a trigger inside a
`dir="rtl"` region of a left-to-right page gets a popover aligned to its right
edge and an arrow at the popover's right one.

It is right while the browser uses the placement asked for. `data-placement` is
that placement, not the one in use. When the popover would overflow, the
browser may move it to the other side, or to another alignment — a centred
popover to one lined up with either edge of the trigger — and nothing on the
element changes to say so. The arrow stays where the requested placement put
it, pointing at nothing. Chrome can tell a stylesheet which fallback it took,
through anchored container queries (`@container anchored(fallback: …)`);
Firefox cannot, and the sheet does not use them. `flip: false` and
`shift: false` together rule the fallbacks out instead: the popover stays at
the placement it was given and the arrow stays right, at the price of a popover
that can run off the edge of the viewport.

The menu marks the item under keyboard focus with `:focus-visible`. Roving
focus moves real focus between items, so there is no highlighted-item attribute
to style, and in a menu opened with the pointer, focus that follows the pointer
draws no ring — the hover background is what marks that item, and
`Highlight` under forced colours. An item that is unavailable, through
`itemProps({ disabled: true })` or as a natively `disabled` `<button>`, is
drawn in the muted text colour, `GrayText` under forced colours, and takes no
hover: a control that lights up under the pointer looks like it will do
something. An item written as a `<button>`, as the primitive's own example
writes it, loses the browser's button border.

A context menu — `createMenu` with no `trigger` — is not anchored, and
`position()` reports the press in viewport coordinates, so the sheet makes the
menu `position: fixed` to match: set its `left` and `top` from `position()`
and it opens at the press on a scrolled page too. A dropdown menu is not
affected, since the primitive writes its own scheme inline.

The tooltip can be hovered. The primitive keeps it open while the pointer is
on it, so a long description can be read without it closing, as WCAG's Content
on Hover or Focus criterion (1.4.13) asks, and the sheet leaves pointer events
on for that to work.

### Toast

`data-type` is drawn as the colour of the toast's leading edge: `info`,
`success`, `warning` or `error`. Under forced colours every severity would come
out the same colour, so the edge also takes a border style per type — solid,
double, dashed, dotted — which is geometry, and survives. That is a second cue,
not the message: severity belongs in the words of the toast. The region is
fixed to the bottom inline-end corner and has a focus ring, which is the only
sign that the hotkey moving focus into it — `F6` unless you choose another —
landed anywhere. The `data-paused` the primitive writes on the region is not
styled.
