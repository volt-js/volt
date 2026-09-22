# Navigation components

Moving between the parts of a page, and between what they hold.

Each component below is a tag you write, with the primitive that owns its
behaviour named beside it. What is not a tag yet is the markup to write by
hand: the same primitive, the same class names, and the same look — which is
what makes a component here a shortcut rather than a wall.

See [the package](./ui) for the two entries, the stylesheet, the tokens and
how to override a rule.

## `<v-tabs>` and `<v-tab>`

A list of tabs over the panel belonging to the one that is selected — the APG
tabs pattern, which `createTabs` owns down to the roving tab stop.

<Demo name="tabs" height="340" />

```html
<v-tabs :value="section" label="Settings">
  <v-tab value="account" label="Account">
    <p>Two people can sign in to this project.</p>
  </v-tab>

  <v-tab value="billing" label="Billing">
    <p>Nothing is owed until March.</p>
    <v-button size="sm" :onPress="addCard">Add a card</v-button>
  </v-tab>

  <v-tab value="archive" label="Archive" :disabled="true">
    <p>Nothing has been archived.</p>
  </v-tab>
</v-tabs>
```

One tag is one section, holding both halves of it. The tab is what `<v-tab>`
draws, inside the list; the panel is what was written inside the tag, which
`<v-tabs>` draws below the list with
[`<slot :from>`](./template-syntax#drawing-what-was-written-inside-another-tag).
The other arrangement — a tab tag and a panel tag paired by a value — has a
failure nothing catches: a mistyped value leaves a tab whose panel never shows
and a panel no tab points at, and each half is perfectly consistent with
itself. Here the value is written once, and the primitive mints the pair of ids
from it.

| `<v-tabs>` | Type | Means |
|---|---|---|
| `value` | `Signal.State<string>` | Your signal. Without one the tabs own the selection |
| `defaultValue` | `string` | Selected first, when the selection is the widget's own |
| `orientation` | `'horizontal' \| 'vertical'` | Which arrows move, and which edge the sheet draws. Default horizontal |
| `activation` | `'automatic' \| 'manual'` | `manual` moves focus with the arrows and selects on Enter or Space |
| `loop` | `boolean` | Wrap past the first and last tab. Default true |
| `label` | `string` | The name of the tab list, which has none by default |
| `labelledBy` | `string` | Id of the element naming the list, when that name is already on screen |
| `onValueChange` | `(value: string) => void` | Called with the value a user selected, never with a default |

| `<v-tab>` | Type | Means |
|---|---|---|
| `value` | `string` | Identifies the section; the selection and the pair of ids key off it |
| `label` | `string` | The tab's words, when they are a line of text |
| `disabled` | `boolean` | The arrows step over it and neither a click nor a key selects it |

Slots: the content of `<v-tab>` is the panel, and `tab` is the tab's own
markup, for a tab that is more than a line of text — which keeps the content of
the tag meaning the larger of the two things by far:

```html
<v-tab value="billing">
  <template :slot-tab><v-icon name="card"></v-icon> Billing</template>
  <p>What you owe.</p>
</v-tab>
```

`orientation`, `activation`, `loop` and `defaultValue` are what the primitive
is *built* with, read once while the component's fields initialize, so changing
one later does nothing — which is why they are written down here. The rest
follow their expressions like any other prop: `label` and `labelledBy`, because
the name of a widget is as often translated, or drawn from data, as it is a
literal; and the selection, because it is the thing that changes — pass `value`
and it is one signal both sides hold, so the page that writes
`section.set('billing')` moves the widget.

With neither `value` nor `defaultValue` the first tab selects itself as it
renders, since a tab list with nothing selected shows no panel at all. That is
a default rather than a choice anyone made, so `onValueChange` stays quiet for
it.

A selection that names no tab is brought back to one that is there, for the
same reason: with nothing selected there is no panel and every tab sits at
`tabindex="-1"`, so Tab steps over the widget and nothing but a pointer reaches
it again. Close the tab that was open and the one that took its place is
selected — the one before it at the end of the list, and never a disabled tab,
which a click and the arrow keys refuse too. Hand the widget a value whose tab
is not there, as a restored selection does after a rename, and the first tab is
selected. Rename the open tab and it keeps the selection, because it is the
same tab. All of these are defaults as much as the first one is, so
`onValueChange` stays quiet for them; a page that passed `value` reads the move
in its own signal.

Every panel is rendered, whichever tab is selected: the unselected ones carry
the `hidden` attribute rather than being taken out of the page, which is what
keeps every tab's `aria-controls` pointing at something. So nothing here — or
in your own CSS — may give `.volt-tabs-panel` a `display`, which would beat
`hidden` and show every panel at once; and a panel whose contents cost a
request should ask for it when the value becomes its own rather than on the
way in.

What you write on `<v-tabs>` lands on the element wrapping the list and the
panels, which is the one element the component adds that the sheet does not
draw. It is there to be laid out: a vertical tab list stands beside its panels
rather than above them, and that is the page's layout, not the widget's.

```html
<v-tabs class="beside" orientation="vertical" label="Reports">…</v-tabs>
```

```scss
.beside { display: flex; column-gap: var(--volt-space-4); }
```

That element carries no role, so `aria-label` written on the tag is a name on
nothing: it is the `role="tablist"` inside that needs naming, and `label` —
or `labelledBy`, for a heading already on the page — is what names it. A
development build says so in the console rather than leaving it to a screen
reader, and leaves the attribute where you wrote it.

A disabled tab is marked `aria-disabled`, not with the `disabled` attribute,
which means nothing on the `<div>` or `<a>` a tab is as often drawn as. It
stays announced among the others; what it loses is the keyboard, which steps
over it, and the selection, which it refuses by click as well as by key. A
pointer press still puts focus on it, and the list's one tab stop follows
focus, so while focus is there the disabled tab holds it — which is what keeps
a list whose selected tab is disabled reachable by Tab at all.

A `<v-tab>` written outside a `<v-tabs>` throws, naming both tags: its tab
belongs in that list, and its panel is drawn by the tabs it belongs to.

For anything the pair does not offer — selecting from elsewhere, asking what is
selected — take the primitive:

```html
<v-tabs :ref="settings" label="Settings">…</v-tabs>
```

```ts
settings: VTabs | null = null;
later(): void { this.settings?.tabs.select('billing'); }
```

## Written by hand

The same look without the tag: the primitive, the markup you want, and the
sheet's class names on it. This is what a component here is made of, and what
to reach for when a component's shape does not fit — or when the component does
not exist yet.

### Tabs

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

### Accordion

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
