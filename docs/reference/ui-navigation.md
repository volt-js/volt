# Navigation components

Moving between the parts of a page, and between what they hold.

Each component below is a tag you write, with the primitive that owns its
behaviour named beside it. What is not a tag yet is the markup to write by
hand: the same primitive, the same class names, and the same look — which is
what makes a component here a shortcut rather than a wall.

See [the package](./ui) for the two entries, the stylesheet, the tokens and
how to override a rule.

## Tabs

The primitive hides inactive panels with the `hidden` attribute rather than
unmounting them, so nothing in the sheet sets `display` on a panel, and
nothing in yours should: a `display` of any kind beats `hidden` and shows every
panel at once. The selected tab is marked three ways — weight, colour and an
edge — so that the selection does not rest on colour, which a forced palette
replaces; under forced colours the text and the edge take `Highlight`. Panels
have a focus ring, since each is in the tab order.

The edge is the one that faces the panels: beneath a tab in a horizontal list,
and at the inline end of a tab in a vertical one, where the list draws its own
edge too. A tab draws that edge and no other, so a tab written as a `<button>`,
as the primitive's own example writes it, loses the browser's button border.
An unselected tab keeps its edge clear with `transparent`, which a forced
palette paints like any other colour, so under forced colours the sheet takes
that edge away instead, and only the selected tab has one.

## Accordion

The header is a heading element wrapping the trigger, as the pattern asks; the
sheet takes its type scale away so the button inside is the visible thing. The
panel animates its height between zero and `--volt-collapsible-height`, which
`createAccordion` measures in [the measure lane](./reactivity#effects) and
writes on the panel's `style` — `auto` does not interpolate, so without a real
number there is nothing to animate between. The primitive keeps a closing panel
present until that animation has run, so render the panel under
`:if="isPresent(value)"` and the collapse is seen before it goes.

The expand animation fills backwards only. Once it has run, the open panel
goes back to the height of its content rather than staying at the height
measured when it opened, so content that grows inside it later — an image
arriving — is not clipped. The collapse fills forwards, and holds the panel
shut until the primitive lets it go.

`contractProperties`, a `ReadonlySet<string>`, is the list of such properties —
the ones a primitive writes and a rule may read — and
`--volt-collapsible-height` is the only one; `createCollapsible` writes it too.
It is not a token: nobody decides in advance how tall a panel's content is.
