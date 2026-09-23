# Navigation components

Moving between the parts of a page, between what they hold, and between pages.

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

## `<v-accordion>` and `<v-accordion-item>`

A stack of sections, each behind the heading that opens it — the APG accordion
pattern, which `createAccordion` owns down to the height a collapse animates
to.

<Demo name="accordion" height="420" />

```html
<v-accordion :value="open" :level="3">
  <v-accordion-item value="delivery" label="When will it arrive?">
    <p>Everything ordered before four leaves the same day.</p>
  </v-accordion-item>

  <v-accordion-item value="returns" label="Can I send it back?">
    <p>Thirty days, no questions asked.</p>
  </v-accordion-item>

  <v-accordion-item value="gifts" label="Do you wrap gifts?" :disabled="true">
    <p>Not until December.</p>
  </v-accordion-item>
</v-accordion>
```

One tag is one section, holding both halves of it: the heading `<v-accordion-item>`
draws — a real heading element around a button, because the level is how a
screen reader user skims the list and the button is what gives Enter and Space
for free — and the panel, which is what was written inside the tag. The
accordion around them owns what they share: which sections are open, whether
more than one may be, and the arrow keys between the headings.

| `<v-accordion>` | Type | Means |
|---|---|---|
| `value` | `Signal.State<string[]>` | Your signal. A list even for a single accordion, so changing `type` does not change the shape of state you already hold |
| `defaultValue` | `string[]` | Open from the start, when the open sections are the accordion's own |
| `type` | `'single' \| 'multiple'` | One section open at a time, or several. Default single |
| `collapsible` | `boolean` | Let a single accordion close its last open section. Default false |
| `orientation` | `'vertical' \| 'horizontal' \| 'both'` | Which arrows move between headings. Default vertical |
| `loop` | `boolean` | Wrap past the first and last heading. Default true |
| `region` | `boolean` | Give each panel `role="region"`. Default true |
| `disabled` | `boolean` | Refuse every heading at once, for a list that is off while something saves |
| `level` | `number \| string` | The heading level of every section. Default 3 |
| `onValueChange` | `(value: string[]) => void` | Called with the open sections a user opened or closed, never with a default |

| `<v-accordion-item>` | Type | Means |
|---|---|---|
| `value` | `string` | Identifies the section; the open ones are a list of these, and the pair of ids is minted from it |
| `label` | `string` | The heading's words, when they are a line of text |
| `disabled` | `boolean` | Refuses the press and says so, while staying reachable and announced |

Slots: the content of `<v-accordion-item>` is the panel, and `header` is the
heading's own markup, for a heading that is more than a line of text — which
keeps the content of the tag meaning the larger of the two things by far. The
sheet lays the heading out as a row with its words at one end, so a count or a
marker written beside them lands at the other:

```html
<v-accordion-item value="care">
  <template :slot-header>Looking after it<span class="count">4 steps</span></template>
  <p>Cold wash, no tumble, warm iron.</p>
</v-accordion-item>
```

`type`, `collapsible`, `orientation`, `loop`, `region` and `defaultValue` are
what the primitive is *built* with, read once while the component's fields
initialize, so changing one later does nothing — which is why they are written
down here. The rest follow their expressions like any other prop: `disabled`
and `level`, everything on `<v-accordion-item>`, and the open sections, which
are the thing that changes — pass `value` and it is one signal both sides hold,
so the page that writes `open.set(['returns'])` moves the accordion.

**A closed panel is not in the page**, which is the difference from
`<v-tabs>` and the one worth knowing before you write a panel. The content of a
section is built when it opens and thrown away when it closes, so a scroll
position, a half-filled field or an unsaved edit inside a panel does not
survive a close: keep that in a signal of yours rather than in the DOM the
panel made. A panel that is closing stays until the animation it started has
finished, which is what makes the collapse animatable at all — so a closing
panel is in the page with `data-state="closed"` for as long as the sheet's
collapse runs. Focus inside a panel that closes other than by its own
heading — another section opening in a single accordion, or your signal — moves
to the button in that panel's heading rather than falling to the top of the
document.

**Nothing may give `.volt-accordion-panel` padding**, yours included. The panel
is clipped to nothing as it collapses, and padding is what would be left over
at zero height — a strip of space under a section that is shut. The spacing
belongs to the content, which is yours anyway:

```html
<v-accordion-item value="returns" label="Can I send it back?">
  <div class="body"><p>Thirty days, no questions asked.</p></div>
</v-accordion-item>
```

```scss
.body { padding-block-end: var(--volt-space-3); padding-inline: var(--volt-space-2); }
```

The height the collapse travels is measured by the primitive and published on
the panel as `--volt-collapsible-height`, because `height: auto` has no number
to interpolate from and the number that would replace it is only known once the
content has been laid out. Nothing measures per frame, and the animation is
plain CSS.

A single accordion's heading is a switch between sections rather than a switch
for the section it sits on: the last open one will not close unless you write
`collapsible`. Its heading reports `aria-disabled="true"` while it is the only
one open, because pressing it does nothing and a user who has been told it is a
control deserves to know that before they press — but it is not marked
`data-disabled` and not greyed out, because it is the section being read rather
than one that is unavailable.

`level` is written as `aria-level` over the element's own level, and it has to
fit the page around it: an accordion under an `<h2>` holds `<h3>`s, one under
an `<h3>` holds `<h4>`s. It is the accordion's rather than each section's,
because the sections are siblings and a list whose headings were at different
levels would not be one list to anybody skimming by heading.

Every heading stays in the page's tab sequence. That is where this departs from
every other roving-focus widget in the package, and APG asks for it: an
accordion is part of the document's reading order rather than one composite
widget like a menu, so Tab walks the headings and the arrow keys are an
addition. A disabled heading keeps its place in both orders — it is announced,
it can be read, and what it refuses is the press.

`region` gives each panel a landmark, which is what the pattern recommends and
what APG's own advice says to drop once an accordion runs past roughly six
sections: past that the regions crowd out every other landmark on the page.
Either way the heading names the panel, so nothing invents a string for it.

What you write on `<v-accordion>` lands on the element wrapping the sections,
which carries no role — the pattern's roles are on the headings and the panels
— so it is there to be laid out. What you write on `<v-accordion-item>` lands
on the section itself: the element the sheet draws the border on, and the one
carrying `data-state`, so `.mine[data-state='open']` is yours to style. Both
survive every open and close, so a class or an id you wrote is still there
after the first press.

A name is the one thing neither element can carry. `aria-label` on an element
with no role is thrown away by every screen reader, and nothing on the page
looks wrong afterwards — so one written on either tag is said out loud in
development, naming what does name a section: `label`, or the `header` slot.
An accordion is not one control, and a name for the group belongs on the
landmark or the heading the accordion sits under. Give either tag a `role` of
your own and the name is yours to keep, in silence.

A `<v-accordion-item>` written outside a `<v-accordion>` throws, naming both
tags, and so do two sections in one accordion carrying the same value: the
value is what the open sections are a list of and what the ids pairing a
heading with its panel are minted from, so both would open at once, under one
id.

For anything the pair does not offer — opening a section from elsewhere, asking
what is open — take the primitive:

```html
<v-accordion :ref="questions">…</v-accordion>
```

```ts
questions: VAccordion | null = null;
later(): void { this.questions?.accordion.open('returns'); }
```

## `<v-collapsible>`

One section that opens and closes: a trigger, and the panel it shows — the APG
disclosure pattern, which `createCollapsible` owns down to the height a
collapse animates to.

<Demo name="collapsible" height="380" />

```html
<v-collapsible :open="details" label="Delivery details">
  <p>Everything ordered before four leaves the same day.</p>
</v-collapsible>
```

An accordion is a stack of these sharing one piece of state, and this is the
one on its own: the same primitive underneath, the same measured height to
animate to, and an accordion's type and spacing, so a page holding both does
not draw one idea in two sizes. It adds a marker at the end of the trigger that
turns as it opens, which an accordion does without: a lone section has no rules
around it to say it is one. The trigger is a `<button>` carrying
`aria-expanded`, and the panel is what was written inside the tag.

| Prop | Type | Means |
|---|---|---|
| `open` | `Signal.State<boolean>` | Your signal, when whether it is open belongs to your component |
| `defaultOpen` | `boolean` | Open from the start, when the section owns its state |
| `region` | `boolean` | Give the panel `role="region"`, named by the trigger or by `panelLabel`. Default false, and then the panel is not named at all |
| `label` | `string` | The trigger's words, when they are a line of text |
| `panelLabel` | `string` | Names the panel's landmark, for when the trigger's words do not name it well. Only with `region`. Unset, the trigger names it |
| `disabled` | `boolean` | Refuses the press and says so, while staying reachable and announced |
| `id` | `string` | The trigger's id, which a `region` is named after. Unset, the primitive mints one |
| `lang`, `dir` | `string` | The language and direction of the whole section, trigger and panel both |
| `onOpenChange` | `(open: boolean) => void` | Called when the trigger or a call on the primitive moved it — never for a write to your own signal, and never for `defaultOpen` |

Slots: the content of the tag is the panel, and `trigger` is the trigger's own
markup, for one that is more than a line of text — which keeps the content of
the tag meaning the larger of the two. Whatever the slot holds stays together
at the start of the row, and the marker the sheet draws goes to the end, so a
count written beside the words sits beside them:

```html
<v-collapsible>
  <template :slot-trigger>In the parcel<span class="count">3 items</span></template>
  <ul>…</ul>
</v-collapsible>
```

`defaultOpen`, `region` and `onOpenChange` are what the primitive is *built*
with, read once while the component's fields initialize, so changing one later
does nothing. The rest follow their expressions like any other prop, and the
open state is the thing that changes — pass `open` and it is one signal both
sides hold, so the page that writes `details.set(true)` opens the section.

**`open` takes a signal, not a boolean.** `<details open>` is how the platform
spells a disclosure that starts open, and it is the first thing anyone who
knows it writes — here that is `defaultOpen`. `<v-collapsible open>` hands
`open` a `true`, and it throws at once saying so, rather than failing later
inside the primitive where nothing would lead back to the tag. A derived
signal — a `Signal.Computed` — is refused the same way: the trigger opens and
closes the section by writing to `open`, and a signal nothing can write to
would pass every read and throw on the first press. Pass the `Signal.State` it
is computed from.

**A closed panel is not in the page.** The content is built when the section
opens and thrown away when it closes, so a scroll position, a half-filled field
or an unsaved edit inside it does not survive a close: keep that in a signal of
yours rather than in the DOM the panel made. A panel that is closing stays, with
`data-state="closed"`, until the animation it started has finished, which is
what makes the collapse animatable at all.

Focus is not thrown away with it. A section closed from inside itself — a Done
button in the panel that writes `false` to your signal, or a call to
`collapsible.close()` — puts focus on the trigger as it starts to close, rather
than letting it fall to the top of the document with the element that held it.
A press on the trigger has already put focus there, and focus anywhere outside
the panel stays where it is.

**Nothing may give `.volt-collapsible-panel` padding**, yours included. The
panel is clipped to nothing as it collapses, and padding is what would be left
over at zero height — a strip of space under a section that is shut. The
spacing belongs to the content, which is yours anyway:

```html
<v-collapsible label="Delivery details">
  <div class="body"><p>Everything ordered before four leaves the same day.</p></div>
</v-collapsible>
```

```scss
.body { padding-block-end: var(--volt-space-3); padding-inline: var(--volt-space-2); }
```

The panel is clipped only while its height is moving. At rest nothing cuts
off what is inside it, so the focus ring of a field or a button against its
edge is drawn whole, and content wider than the panel overflows it the way it
would anywhere else — give it a scroll container of its own if it can be wide.
A margin inside stays inside: the panel is its own formatting context, so the
height the collapse starts from is the height the content takes.

The height the collapse travels is measured by the primitive and published on
the panel as `--volt-collapsible-height`, because `height: auto` has no number
to interpolate from and the number that would replace it is only known once the
content has been laid out. The animation is timed with `--volt-duration-fast`,
so the reduced-motion preference reaches it the way it reaches everything else.

Whether the section is open is information rather than decoration, and it is
drawn twice: the marker turns from pointing down to pointing up, and the panel
is there or it is not. Neither is carried by a colour, so a forced palette
loses neither. The marker points down and up rather than along the line because
a rotation does not mirror with the text around it — a marker pointing at the
end of the line would point the wrong way in a right-to-left page.

**What you write on the tag lands on the trigger.** It is the element with a
role — the button carrying `aria-expanded` — so `aria-label` written there
names the control, and `.mine[data-state='open']` selects on the element that
says whether it is open. The element wrapping the trigger and the panel carries
no role and nothing of yours; to lay the whole section out, wrap it in an
element of your own. An `id` is the trigger's as well — a link or a test finds
the section by it — and a `region`, which the trigger names, is named after
yours rather than after the one the primitive would have minted.

`lang` and `dir` are the exceptions. They describe the text rather than the
control, so they land on the element around the trigger and the panel: a
section marked as written in another language is marked so all the way down,
and one marked right-to-left turns its panel as well as its trigger.

**The trigger is not a heading.** A lone disclosure is a button in the flow of
the page, not an entry in its outline. A section a reader has to be able to
find by heading is an accordion of one — `<v-accordion collapsible>` with a
single `<v-accordion-item>` — which draws a real heading around the same kind
of button.

There are no arrow keys, which is the other difference from `<v-accordion>`:
there is nothing to move between. Enter and Space are the button's own, and
nothing answers the key itself — the browser turns both into a click, and
answering the key as well would open the section and close it again in one
press. A disabled trigger keeps its place in the tab order — `aria-disabled`,
not the `disabled` attribute — so it can be reached and read, and what it
refuses is the press. The refusal is the trigger's: your own signal can still
open a section that is off.

`region` is off by default, as the primitive has it: a lone disclosure is
rarely worth a landmark, and landmarks that name nothing in particular make the
landmark list harder to use. Turn it on for a section a reader should be able
to jump to, and name it with `panelLabel` when the trigger's words would make a
poor entry in that list. Either way exactly one name is written, never both.
Without `region` the panel has no role, and no name is written at all: ARIA
prohibits naming an element with no role, and there is nothing a screen reader
could read the name out as — so `panelLabel` on its own does nothing.

For anything the tag does not offer — opening the section from elsewhere,
asking whether it is open — take the primitive:

```html
<v-collapsible :ref="details" label="Delivery details">…</v-collapsible>
```

```ts
details: VCollapsible | null = null;
later(): void { this.details?.collapsible.open(); }
```

## `<v-breadcrumb>` and `<v-breadcrumb-item>`

Where the current page sits in the hierarchy above it — `createBreadcrumb`, with
the markup written: a navigation landmark, an ordered list of links, and the
page the reader is on at the end of it, marked rather than linked.

<Demo name="breadcrumb" height="320" />

```html
<v-breadcrumb>
  <v-breadcrumb-item
    :for="crumb in trail.get()"
    :key="crumb.href"
    :href="crumb.href"
  >{ crumb.name }</v-breadcrumb-item>
</v-breadcrumb>
```

One tag is one crumb, the root first. Each draws its own `<li>` where it is
written, with a link in it holding what was written inside the tag. The last
crumb is the page the reader is on: it keeps its words, loses its `href` and
carries `aria-current="page"` instead, because a link to where you already are
is a way to go nowhere. The separators between crumbs are `aria-hidden` — a
screen reader already hears a list of five, and "slash" between every pair of
names is noise.

| `<v-breadcrumb>` | Type | Means |
|---|---|---|
| `label` | `string` | The landmark's name. Default "Breadcrumb", which is English whatever the page is written in |
| `aria-label` | `string` | The same name in the platform's spelling. Lands on the `<nav>`, and wins over `label` |
| `overflowLabel` | `string` | The name of the button standing for the collapsed crumbs, and through it of the menu it opens. Default "Show the rest of the path" |
| `itemsBefore` | `number` | Crumbs always shown at the start. Default 1, the root |
| `itemsAfter` | `number` | Crumbs always shown at the end. Default 1, the current page; at 0 the page itself can fold into the menu, where it is still marked as the page |
| `collapse` | `boolean` | Fold the middle of the trail into a menu when it does not fit. Default true |
| `onCollapseChange` | `(collapsed: readonly number[]) => void` | Called with the indices now in the menu, in trail order |

| `<v-breadcrumb-item>` | Type | Means |
|---|---|---|
| `href` | `string` | Where the crumb goes. Dropped from the last crumb; a crumb without one is a section with no page of its own, and reads as text |
| `rel` | `string` | On the link in the trail and on its copy in the menu alike. `external` is the one a router reads |
| `aria-label` | `string` | The crumb's name, for one whose words are not it — an icon, say. On the link in the trail and on its copy in the menu alike |

Slots: the content of `<v-breadcrumb-item>` is the crumb's words, which can be
markup — an icon before the root's name, say. On `<v-breadcrumb>`, `separator`
is what goes between two crumbs, `/` when nothing fills it, and `overflow` is
what the button holds, `…` when nothing fills it:

```html
<v-breadcrumb overflowLabel="Show the folders above">
  <template :slot-separator>›</template>
  <template :slot-overflow><v-icon name="more"></v-icon></template>
  …
</v-breadcrumb>
```

A separator is text in the writing direction, and `›` does not turn round
under `dir="rtl"` the way the trail does. `/` needs no turning.

`itemsBefore`, `itemsAfter` and `collapse` are what the primitive is *built*
with, read once while the component's fields initialize, so changing one later
does nothing — the overflow button included, which follows what the trail was
built with rather than the binding — and that is why they are written down
here. The two counts can be
written as attributes, `itemsBefore="2"`, and are read as the numbers they
look like; one that is not a whole number of crumbs throws, rather than leaving
a trail that never collapses and never says why. `collapse` has to be bound —
`:collapse="false"` — because an attribute is a string, and `"false"` is a
string with something in it. Everything else follows its expression like any
other prop: the names, because a name is as often translated as it is a
literal, and every crumb's `href` and `rel`.

What you write on `<v-breadcrumb>` lands on the `<nav>`, which is the landmark
and the thing a page lays out. What you write on a `<v-breadcrumb-item>` lands
on its link — the thing a reader follows, a screen reader announces and a
router looks at — so a class there styles it. The `<li>` around it is the
component's. `aria-label` goes further: it names the link in the trail and
its copy in the menu both, because one place to go has one name wherever it
is drawn. Everything else stays on the link in the trail.

**Which crumb is the page is decided by position.** The last crumb is; there is
no prop for it. That makes `aria-current` the trail's to write: every crumb is
the last one for a moment while the trail is being built, one registering
after another, so a value written on a tag is replaced then and taken back
after.

**It measures rather than taking a number.** A fixed "collapse past four" is
wrong at both ends: four short crumbs fit on a phone and four long ones do not
fit on a desktop. So when the trail is wider than its list, the fewest crumbs
from the middle are folded that make the rest fit — the shallowest ancestors
first, which are the furthest from where the reader is — and a button takes
their place that opens them as a menu. The root and the current page stay, or
as many at each end as `itemsBefore` and `itemsAfter` say.

What that costs, and what to know:

- **A crumb that folds is drawn twice while the menu is open.** It is hidden
  in the trail rather than taken out, because a crumb that is not in the
  document has no width, and its width is what decides whether it comes back;
  and the menu draws it again, as a link. `hidden` keeps the trail's copy out
  of the accessibility tree, so nothing is announced twice. Anything you put
  inside a crumb is built a second time when the menu opens.
- **The button is in the list, where the folded crumbs were.** It is drawn by
  the first crumb that can fold, in front of that crumb's own `<li>`, so the
  order a reader tabs through is the order they see. A button drawn after the
  crumbs and moved into place with CSS `order` would be seen second and
  reached last. So `.volt-breadcrumb-item` matches the button's `<li>` as well
  as every crumb's; `data-volt-crumb` and `data-volt-crumb-overflow` tell them
  apart.
- **The list needs a width that is not its crumbs'.** It is measured against
  its own width, and inside the component it takes the `<nav>`'s. A
  `<v-breadcrumb>` that shrink-wraps its contents — an item in a flex row with
  no `flex-grow`, an inline block — gets narrower as crumbs fold, and the
  measurement chases itself. Give the landmark a width, or `flex: 1` and
  `min-inline-size: 0` in a row.
- **It measures again** when it mounts, when the crumbs change — a trail
  replaced by another of the same length counts, because the words are what
  changed — and when the list is resized. Not when something changes a crumb's
  width without doing any of those: a web font arriving, or a crumb's words
  changing where they are. Call `measure()` then:

  ```html
  <v-breadcrumb :ref="path">…</v-breadcrumb>
  ```

  ```ts
  path: VBreadcrumb | null = null;

  async fontsArrived(): Promise<void> {
    await document.fonts.ready;
    this.path?.crumbs.measure();
  }
  ```

- **With no layout, nothing folds.** On a server, in a test environment, or
  before the list is painted, the last measurement stands rather than reading
  zero and folding a trail that may well fit.

**Links are links.** Every crumb is an `<a href>`, in the trail and in the
menu, and no click on one is prevented here — choosing a crumb in the menu
closes the menu and lets the click carry on. So a router listening on the
document takes a plain click on either copy the way it takes any other link,
and a Cmd-click or a middle click still opens a tab. For a crumb the browser
should load — a page the server owns — write `rel="external"`, which reaches
both copies. `data-volt-no-router` works on the tag too, but it lands where
everything else written there does, on the link in the trail, and the copy in
the menu goes on being routed.

The crumbs are ordinary links, each its own tab stop; there is no roving focus
in the trail, and the current page, having no `href`, is not a stop at all.
The button is a menu button and keeps the menu button's keys:

| Where | Key | Action |
|---|---|---|
| crumb | Enter | Follow the link |
| button | Enter, Space, ArrowDown | Open the menu on its first link |
| | ArrowUp | Open it on its last link |
| menu | ArrowDown / ArrowUp | Next / previous link, wrapping |
| | Home / End | First / last link |
| | Printable characters | Typeahead, on the crumbs' words |
| | Enter | Follow the link, and close; on a crumb with no link, just close |
| | Escape | Close, focus back on the button |
| | Tab | Close, and carry on out |

Enter and Space inside the menu are left to the browser, because its items are
links: Enter follows one and fires the click that closes the menu, and Space
scrolls. The exception is a crumb with no `href` — a section with no page of
its own, or the page itself folded in — where the browser would do nothing at
all: Enter there closes the menu and puts focus back on the button, which is
what a press on the same item does.

The current page is drawn in weight as well as in colour, and in `CanvasText`
against the links' `LinkText` when the palette is forced, so "you are here"
does not rest on a colour the user's palette replaces. The weight is semibold:
the stack starts at `system-ui` — Segoe UI on Windows, where forced colours
live, and Noto Sans on a common Linux — and neither has a 500, so a medium page
would be drawn at the regular weight of the crumbs around it. Folded into the menu, by
a trail with `itemsAfter` at 0, it keeps the weight, and nothing separates the
button from a page that is no longer beside it. A crumb with no `href`
is muted text. Nothing in the sheet gives `.volt-breadcrumb-item` a `display`,
and nothing in yours should: `hidden` is how a crumb folds, and a `display` of
any kind beats it — every crumb stays on screen, and the trail overflows
instead of folding. A crumb neither shrinks nor wraps, either: the width the
primitive reads has to be the width the crumb wants.

The menu is drawn with the menu's classes, `volt-menu-content` and
`volt-menu-item`, because it is the menu: `createBreadcrumb` builds it with
`createMenu`, and the same primitive gets the same look. A sheet built from a
subset of the components needs `menuStyles` beside `breadcrumbStyles`.

A `<v-breadcrumb-item>` written outside a `<v-breadcrumb>` throws, naming both
tags: whether it is the current page, and whether it folds, is decided by its
place among the others.

For anything the pair does not offer — which crumbs are folded, closing the
menu from elsewhere, measuring again — take the primitive:

```html
<v-breadcrumb :ref="path">…</v-breadcrumb>
```

```ts
path: VBreadcrumb | null = null;
later(): void { this.path?.crumbs.menu.close(); }
```

## `<v-pagination>`

`createPagination`, with the markup written: previous and next, the page
numbers the primitive chooses to show with an ellipsis where it leaves some
out, and the live region that says where the reader has got to. The page is
one signal both sides hold — pass `page` and it is yours to read and write,
pass nothing and the pager owns it.

<Demo name="pagination" height="240" />

```html
<v-pagination :page="page" :total="results.get().length" pageSize="20" label="Results">
</v-pagination>
```

The row is one tab stop, on the current page, so a pager with fifteen numbers
is one Tab press to step over rather than fifteen. The arrow keys move along it
— past the ellipsis, which is not a stop, and past a control that has nowhere to
go — and Enter or Space goes to the page under focus. Moving is not paging:
arrowing from 4 to 7 pages nothing until Enter says so. Home and End reach the
ends of the row — the controls, rather than the first and last page — because
that is what they mean everywhere else a group of controls roves. There is no
typeahead: the labels are numbers, and a "2" that moved focus without paging
would be a key doing two things at once.

| `<v-pagination>` | Type | Means |
|---|---|---|
| `page` | `Signal.State<number>` | Your signal, numbered from 1 — from the URL, most often |
| `defaultPage` | `number` | The page to start on, when the pager owns the page. Default 1 |
| `total` | `number` | How many items there are to page through |
| `pageSize` | `number` | How many make a page. Default 10. A change keeps the reader's place |
| `siblings` | `number` | Pages shown either side of the current one. Default 1 |
| `boundaries` | `number` | Pages always shown at each end of the row. Default 1 |
| `showFirstLast` | `boolean` | Draw first-page and last-page controls outside previous and next. Default false |
| `href` | `(page: number) => string` | A page's URL. Given, every control is a link; without it, every control is a button |
| `loop` | `boolean` | The arrow keys wrap past the ends of the row. Default false. Write it bare — `loop` |
| `label` | `string` | Names the landmark. Default "Pagination" |
| `labelledBy` | `string` | Id of the element naming it, when a heading on the page already does |
| `aria-label` | `string` | The same name, written the platform's way. It wins over `label` |
| `aria-labelledby` | `string` | The same id, likewise. An `aria-label` you write beside it stays |
| `labels` | `{ previous?, next?, first?, last?: string; page?: (n) => string; status?: (n, count) => string }` | Your wording for the name of every control and page, and for what the live region says |
| `onPageChange` | `(page: number) => void` | Called with the page the pager moved to — by a press, a key or a change of `pageSize` — never with where it started |

Slots: `previous`, `next`, `first` and `last` are what each control shows —
`‹`, `›`, `«` and `»` until you fill them. The page numbers have no slot; they
are drawn in the page's own digits, the way the live region says them. There is
no default slot.

```html
<v-pagination :page="page" :total="count.get()" :labels="{ previous: 'Previous', next: 'Next' }">
  <template :slot-previous>Previous</template>
  <template :slot-next>Next</template>
</v-pagination>
```

**Every control is a button, until you give it somewhere to go.** A button is
the default because this cannot know what a page's URL is, and a link without a
real one — `href="#"` — is a promise the control does not keep: it is announced
as a link, it opens a copy of the same page on a middle-click, and a crawler
following it finds nothing. When pages do have URLs, give `href` a function from
a page to its URL and every control is an `<a href>`, with the middle-click, the
address bar and the crawler that come with one:

```html
<v-pagination :page="page" :total="count.get()" :href="pageUrl"></v-pagination>
```

```ts
/** The first page is the list's own URL; every other one says which it is. */
pageUrl = (n: number): string =>
  router.href('/results', {}, { search: { page: n === 1 ? undefined : n } });
```

A function rather than a string with a hole in it, because the URL is rarely
the page number and nothing else: it keeps the rest of the query string, it
leaves `?page=1` off the first page, or it comes from `router.href`, and a
function is the one shape all three fit. `href="/results?page={page}"` reads
like a pattern and is not one — markup fills in no attribute — so it throws in
development rather than drawing a row of controls that do nothing.

As links, Enter is the browser's: it follows the link, and the click that
follows is what moves the pager, so the address bar and the page never
disagree. Space is the browser's too, and scrolls the page as it does on any
link. A press sets `page` *and* navigates — the router, if it intercepts
the link, sees an ordinary click on an ordinary anchor. A ⌘- or Ctrl-click, a
Shift-click or an Alt-click is the browser's alone: it opens that page in a new
tab or window, or downloads it, and this one stays on the page it was showing
— the same four clicks the router leaves alone. A control with nowhere
to go keeps its place in the row and loses its `href`, because with one it
would still open a tab on a middle-click, to page 0; `role="link"` keeps it
announced as what it is, and `aria-disabled` says why.

**Draw the rows from `range()`, not from `page`.** The signal is not clamped:
a page restored from the URL before the total has arrived is kept, and shown
the moment there is a page of that number to show — where clamping it would
have thrown the reader back to page 1 while the request was still in flight.
What the pager shows is clamped, and `pagination.range()` is that page's items,
numbered from 1:

```html
<ol :attr-start="range().start">
  <li :for="row in shown()" :key="row.id">{ row.name }</li>
</ol>
<v-pagination :ref="pager" :page="page" :total="rows.get().length"></v-pagination>
```

```ts
/** A signal, so the list is drawn again once the pager is there to ask. */
pager = new Signal.State<VPagination | null>(null);

range() {
  return this.pager.get()?.pagination.range() ?? { start: 0, end: 0 };
}

shown() {
  const { start, end } = this.range();
  return start === 0 ? [] : this.rows.get().slice(start - 1, end);
}
```

Nothing to page through is "page 1 of 1" with a range of `0` to `0`, never
"page 1 of 0", which a screen reader would read out exactly as written.

A change of `pageSize` keeps the reader's place rather than the number: on
page 5 of ten to a page, items 41 to 50, a size of twenty moves to page 3,
which holds item 41 — not to page 5, which would now be showing items 81 to
100. That is a move, so it is written to your `page` and reported to
`onPageChange`. A size set together with a new `page` is not: when the back
button restores `?page=3&size=20`, page 3 is the page being restored, and
the pager takes both as written rather than moving to keep a place nobody
was reading.

`defaultPage` and `loop` are read once, while the primitive is built, and so is
which signal `page` is — so none of them is a signal, and changing one later
does nothing, which is why they are written down here. Everything else follows
whatever you bind it to: the total, the size, the shape of the row, `href`, the
names and the wording. `page` refuses anything that is not a signal, and says
so by name — to start on page 3, write `defaultPage="3"`.

**Name the landmark when there are two.** Without a name it is "Pagination",
which is enough for one pager and nothing like enough for a pager above a list
and another below it, or for one beside another landmark doing the same job.
`labelledBy` pointing at the list's heading says it once rather than twice.
A reference replaces the name the pager would make up — the default, or
`label` — and never one you wrote: an `aria-label` beside your own
`aria-labelledby` stays, as it would on a `<nav>` of yours, where it is what
the platform falls back on if the reference finds nothing.

**Say the words a control shows.** Each control and page is named — a bare
"3" tells a screen reader nothing about what pressing it does, and a "‹" is
read as "single left-pointing angle quotation mark", if at all — and the names
are English until `labels` says otherwise. Fill a slot with "Précédent" and
leave the name as "Previous page", and a voice user who says what they can see
presses nothing. The announcement comes from the locale's `pageOf` unless
`labels.status` replaces it.

The live region is kept in the page and out of sight: it is what tells someone
who pressed Next, and whose focus is still on Next, which page they are now on.
It is not the place for "Showing 21–30 of 94" — that is yours to draw, from
`range()`.

What you write on the tag lands on the `<nav>`, which is the landmark, so an
`aria-describedby` pointing at a note on the sort order describes the right
thing — and stays through every page change, because the landmark's own
attributes carry nothing that could write over it.

Two states the sheet draws are information rather than emphasis, and both
survive a forced palette: the current page is drawn in `Highlight` and a
heavier weight, and a control at the end of the range in `GrayText`, the
palette's own word for unavailable. That control is left in the row rather than
taken out of it, so the row does not shift under the pointer as the page
reaches an end, and it stays announced as off; the arrow keys step over it, and
Tab into the row lands on the current page rather than on it.

For anything this does not offer, take the primitive:

```html
<v-pagination :ref="pager" :page="page" :total="count.get()"></v-pagination>
```

```ts
pager: VPagination | null = null;
/** What the "back to the top" link under the list presses. */
toStart(): void { this.pager?.pagination.first(); }
```

## `<v-stepper>` and `<v-step>`

A multi-step process — the steps in order, the one the user is on, the ones
they have finished and the ones they have not reached — `createStepper`, with
the markup written.

<Demo name="stepper" height="340" />

```html
<v-stepper :ref="checkout" :value="step" label="Checkout">
  <v-step label="Basket" description="Two items">
    <basket-summary></basket-summary>
    <v-button variant="primary" :onPress="next">Continue</v-button>
  </v-step>

  <v-step label="Delivery" :errored="postcodeMissing.get()">
    <v-input :value="postcode" label="Postcode"></v-input>
    <v-button :onPress="back">Back</v-button>
    <v-button variant="primary" :onPress="deliver">Continue</v-button>
  </v-step>

  <v-step label="Payment" :complete="paid.get()">…</v-step>
</v-stepper>
```

```ts
checkout: VStepper | null = null;
step = new Signal.State(0);

next = (): void => this.checkout?.stepper.next();
back = (): void => this.checkout?.stepper.previous();
deliver = (): void => {
  this.postcodeMissing.set(this.postcode.get().trim() === '');
  if (!this.postcodeMissing.get()) this.next();
};
```

One tag is one step, holding both halves of it, the way a tab does. The step is
what `<v-step>` draws, inside the list; the panel is what was written inside the
tag, which `<v-stepper>` draws after the list with
[`<slot :from>`](./template-syntax#drawing-what-was-written-inside-another-tag).
Every panel is rendered and the ones not showing carry `hidden`, so what the
user typed on a step is still there when they come back to it.

| `<v-stepper>` | Type | Means |
|---|---|---|
| `value` | `Signal.State<number>` | Your signal: the position of the current step, counted from 0. Without one the stepper owns it |
| `defaultValue` | `number` | The step to start on, when the position is the stepper's own. `defaultValue="2"` means the number 2, as `:defaultValue="2"` does |
| `linear` | `boolean` | Steps are reached in order. Default true |
| `orientation` | `'horizontal' \| 'vertical'` | Which arrows move between steps, and which way the list runs. Default horizontal |
| `loop` | `boolean` | The arrows wrap past the first and last step. Default false. Written bare — `loop` — or bound |
| `label` | `string` | The name of the navigation landmark. Default "Progress" |
| `labelledBy` | `string` | Id of the element naming it, when that name is already on screen |
| `aria-label`, `aria-labelledby` | `string` | The same two, written the platform's way. Each wins over its own counterpart, and a reference, written either way, wins over a name |
| `statusLabel` | `(status: StepStatus) => string` | What each status is called in the words read out inside every step. Default "Completed", "Current step", "Not started", "Error" |
| `onValueChange` | `(index: number) => void` | Called with the step moved to — by a click, a key, `next` or `previous` — and never for a write to your own signal |

| `<v-step>` | Type | Means |
|---|---|---|
| `label` | `string` | The step's words, when they are a line of text |
| `description` | `string` | A quieter second line under the label — "Optional", "Address and date" |
| `complete` | `boolean \| undefined` | Whether the step's work is done. Unset, it is done once the user has been past it |
| `errored` | `boolean` | Something on the step needs fixing. Said over every other status, even while the user is on it |
| `disabled` | `boolean` | The step cannot be used at all: the arrows and `next` step over it, and neither a click nor a key selects it |
| `id` | `string` | The step's own id. The panel is named by it |

Slots: the content of `<v-step>` is the panel, and `label` is the step's own
markup, for a step that is more than a line of text — the marker, the
description and the status read out beside it stay the stepper's:

```html
<v-step>
  <template :slot-label><v-icon name="card"></v-icon> Payment</template>
  <payment-form></payment-form>
</v-step>
```

**The value is a position.** It counts from 0, as the primitive does, because a
step is identified by where it is. `value` takes a signal, and a number is the
easiest thing to write where a signal was meant: `:value="1"` throws, naming
`defaultValue`, which is how starting somewhere is spelled. So does a computed
signal, which can be read and not written — and the stepper writes the step a
user moves to.

**Linear gates selection, not progress.** In a linear stepper a step the user
has not reached is refused, by a click and by a key. `stepper.next()` is not:
it is what the flow's own Continue calls, and Continue has just done the
checking. So the Back and Continue buttons are yours, written in each panel,
and they reach the primitive through `:ref` — which also has `goTo`, `isFirst`,
`isLast` and `stepLabel` for anything else a flow needs. The stepper draws no
buttons of its own, because only the page knows what "this step is done" means.

**Focus moves to the step when its panel is hidden under it.** A Continue or
Back written in a panel is inside the panel that pressing it hides, and a
browser drops focus on a hidden element to `<body>` — the top of the document.
So when the step changes while focus is in a panel that is now hidden, the
stepper moves it to the step that is now current: that says where the user is,
and Tab from it reaches the panel it shows. The same happens when the page
moves the step by writing its own signal. Focus anywhere else stays where it
is — including a field in the new panel the page focused itself, after
`flushSync()` from `@voltdev/core` has shown it.

A step the user has been on stays reachable after they go back: selecting step
1 from step 3 does not lose the way forward to step 3 again. `:linear="false"`
lets any step be selected at any time — a settings flow whose order is only a
suggestion. `linear="false"`, written as an attribute, is the string `"false"`,
which is not false; bind it.

The same goes for every true-or-false prop here. `errored`, `disabled`,
`complete` and `loop` are on when written bare, when bound to something true,
and when written with any value at all — `disabled="disabled"` and
`errored="true"` both mean what they say — so `disabled="false"` is disabled,
and `complete="false"` is complete. Bind the value to say no.

**Complete is yours to say, one step at a time.** A step that says nothing is
complete once the user has been past it, which is right for a flow that checks
as it goes. Bind `complete` where that is not true: `false` for a step the user
filled in and then invalidated, `true` for one whose work was done somewhere
else before they reached it. In a linear stepper a step is also selectable once
every step before it is complete, so `complete` is how a page unlocks the steps
ahead. A step that stops saying — `complete` back to `undefined` — is judged by
how far the user has been again.

**`errored`, not `error`.** The primitive calls the status `error`, and the
prop cannot be: `error` is a DOM event, so `:error` on any tag is a listener,
and on a component tag the compiler refuses it with a message about callbacks.
An errored step reports `error` over every other status, including while it is
the one the user is on — it still carries `aria-current="step"`, and the sheet
reads "current" from there, so a step that is both is drawn as both.

**Not reached is not disabled.** A step the flow refuses is marked
`aria-disabled` and stays in the arrow keys' path, so a keyboard user can read
ahead to see what is coming. `disabled` is for a step that does not apply at
all: the arrows and `next` step over it, while it stays announced among the
others. Neither is given the platform's `disabled` attribute, which would make
the step impossible to focus at all.

What you write on `<v-stepper>` lands on the `<nav>`, which carries the
landmark: a `class`, an `aria-describedby`, a `data-` attribute. The panels are
outside it — a navigation landmark holding a whole form would announce the form
as navigation — so the stepper is more than one element, and a class on the tag
lays out the list, not the list and the panels. To stand a vertical stepper
beside its panels, wrap it:

```html
<div class="beside">
  <v-stepper orientation="vertical" label="Setup">…</v-stepper>
</div>
```

```scss
.beside { display: flex; column-gap: var(--volt-space-6); }
```

A horizontal list too long for its width — four steps with descriptions, at
the width of a phone — wraps onto a second row, the line it ends on leading
there, rather than drawing one step over the next. For more steps than that on
a narrow screen, a vertical stepper reads better.

The panels are only ever `hidden`, never given a `display`, so nothing in your
CSS may give `.volt-stepper-panel` one either: it would beat `hidden` and show
every panel at once.

What you write on `<v-step>` lands on the step's button, not on the `<li>`
around it. An `id` written there is kept — the primitive writes one of its own
on every step, and the panel's name points at whichever the step has.

The status of every step is read out in words, inside the step and out of
sight: "Completed", "Current step", "Not started", "Error". The marker it
describes is hidden from a screen reader. Those words, and the landmark's
default name "Progress", are English; give `statusLabel` and `label` for any
other language.

The sheet draws each status as a shape as well as a colour, and the shape is
what a forced palette leaves standing: a filled marker with a check for a
complete step, a ring twice as thick and a bold label for the current one, a
dashed ring for a step the flow will not let the user select yet, and a wavy
underline with `!` in the marker for a step in error. The line after a step is
solid once that step is complete and dashed until then.

`defaultValue`, `linear`, `orientation` and `loop` are what the primitive is
built with, read once while the component's fields initialize, so changing one
later does nothing. Everything else follows whatever it is bound to.

A `<v-step>` written outside a `<v-stepper>` throws, naming both tags.

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
