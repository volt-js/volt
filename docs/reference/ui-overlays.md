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

## Dialog

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

## Popover, menu and tooltip

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

## Toast

`data-type` is drawn as the colour of the toast's leading edge: `info`,
`success`, `warning` or `error`. Under forced colours every severity would come
out the same colour, so the edge also takes a border style per type — solid,
double, dashed, dotted — which is geometry, and survives. That is a second cue,
not the message: severity belongs in the words of the toast. The region is
fixed to the bottom inline-end corner and has a focus ring, which is the only
sign that the hotkey moving focus into it — `F6` unless you choose another —
landed anywhere. The `data-paused` the primitive writes on the region is not
styled.
