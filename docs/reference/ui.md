# Components and the sheet that draws them

`@voltdev/ui` is two things over [`@voltdev/primitives`](./primitives), and you
can take either without the other.

The **components** are tags. `<v-button variant="primary">Save</v-button>` is a
button, `<v-table>` with `<v-table-column>` inside it is a table. Each is the
primitive with the markup already written, and each keeps that primitive within
reach — so a component is a shortcut, never a wall.

The **sheet** is what draws them: one stylesheet, the class names it selects on,
and the design tokens every rule is written in. Components use it; so can you,
on markup of your own with a primitive under it, for anything the components do
not cover yet.

<Demo name="button" />

```html
<v-button>Default</v-button>
<v-button variant="primary">Primary</v-button>
<v-button variant="danger">Danger</v-button>
<v-button variant="ghost">Ghost</v-button>
```

::: warning Not on npm yet
`@voltdev/ui` has not been released — see
[what is on npm](../guide/getting-started#what-is-on-npm). Everything on this
page works from a checkout of the Volt repository, where the package resolves
from the workspace.
:::

**It is early.** The package is `0.1.0-alpha.1`: twenty-seven components are
tags, out of the roughly fifty the roadmap names, and the rest of the primitives
have no styles here at all. What is missing is listed
[at the end](#what-is-not-here-yet).

## Two entries, because the halves run in different places

```ts
import { VButton, VTable, VTableColumn } from '@voltdev/ui/components';
import { stylesheet, classes } from '@voltdev/ui';
```

`@voltdev/ui/components` ships as **TypeScript source**, and your build compiles
it with the rest of your application. That is not a convenience: a compiled
template is compiled for one target — a client clones nodes, a server writes
bytes — and carries the identity of the build that made it, so only the build
that renders your page can compile it. The package says so with `"volt": {
"source": true }` in its manifest, and `@voltdev/vite-plugin` compiles any
dependency that does.

`@voltdev/ui` is ordinary built JavaScript, because `stylesheet()` is called
from a build script in Node, where nothing is compiling templates.

## Primitives alone, a component, or the sheet in between

| You want | Use |
|---|---|
| A button, a dialog, a table | `@voltdev/ui/components` — the tags below |
| Something a component does not do, in markup of your own | A primitive, with the sheet's class names on it |
| Your own design system, or one you already have to match | `@voltdev/primitives` alone |

The line between the layers is drawn so that any of them can be taken away.
Everything the sheet selects on is something a primitive already writes, or a
class or attribute you put on your own element; remove the sheet and every
component still opens, closes, traps focus and speaks to a screen reader. A
component that owned behaviour, or a sheet that did, would be one you could not
drop — and theming would become something to fight rather than use.

The sheet does not import the primitives. It restates the contract between them
— the `data-` attributes each primitive writes, and the one custom property a
primitive measures — in its own source, and its tests hold that restatement
against the primitives themselves. Each component's documented markup is
mounted with a real primitive's props spread onto it, through every state the
rules distinguish, on an engine with anchor positioning and on one without, and
every selector in the sheet has to match something the primitive rendered. A
primitive that renamed an attribute would leave a rule selecting on nothing,
and that test would fail.
## The components

| Group | Components |
|---|---|
| [Forms](./ui-forms) | `<v-button>`, `<v-checkbox>`, `<v-input>`, `<v-textarea>`, `<v-radio-group>`, `<v-switch>`, `<v-select>` |
| [Overlays](./ui-overlays) | `<v-dialog>`, `<v-popover>`, `<v-tooltip>`, `<v-menu>`, `<v-toaster>` |
| [Navigation](./ui-navigation) | `<v-tabs>`, `<v-accordion>`, `<v-collapsible>`, `<v-breadcrumb>`, `<v-pagination>`, `<v-stepper>` |
| [Feedback](./ui-feedback) | `<v-alert>`, `<v-progress>`, `<v-spinner>`, `<v-skeleton>` |
| [Data](./ui-data) | `<v-table>` and `<v-table-column>` |
| [Display](./ui-display) | `<v-avatar>`, `<v-badge>`, `<v-chip>`, `<v-kbd>` |

Every styled component is a tag now. The markup for writing one by hand is
still on each group's page, because that is what a component here is made of
and what to reach for when a component's shape does not fit.

Each is the primitive with the markup already written, and each keeps that
primitive within reach — so a component is a shortcut, never a wall. What a
caller writes on the tag lands on the element the component draws, the
primitive is a field `:ref` can reach, and every prop a template reads is a
signal, so binding one keeps it live.

The components that are not tags yet are markup you write by hand, and each
group's page carries it beside the components: the same primitive, the same
class names, and the same look.

## Getting the styles onto the page

```ts
stylesheet(components?: readonly ComponentStyles[]): string
```

One string: the `@layer` order statement, the token table and its
reduced-motion override, and every component's rules, in cascade order. Write
it to a file and import that file the way you import any other stylesheet.

```ts
// scripts/volt-css.ts
import { stylesheet } from '@voltdev/ui';

console.log(stylesheet());
```

```bash
node scripts/volt-css.ts > src/volt.css
```

Only a recent Node runs a `.ts` file without a flag. The script has no types
in it, so on an older one it runs unchanged renamed to `.mjs`.

The emitted sheet is 116 kB as written and 8.6 kB minified and gzipped.

It is a file rather than a call at runtime because the data the sheet is built
from weighs more than the sheet. Calling `stylesheet()` in the browser ships
every component's rules as JavaScript — about 96 kB minified, 12.1 kB gzipped —
and then assembles the string at startup, to arrive at CSS the build could
have written once.

That weight comes with the exports that hold rules — `stylesheet` and
`componentStyles` carry every component's, a `*Styles` object its own
component's — and with nothing else. Each component's rules are built in a
call marked pure, so a bundler leaves them behind when nothing reads them:
[`classes`](#classes) costs about 4.4 kB minified, 1.5 kB gzipped, and a layer
name costs its own string. Keep the package in build scripts all the same, and
put only the generated file in front of the browser.

The cost of the file is that it is a copy. It does not follow the package: an
upgrade changes nothing on your page until you generate it again.

It is one string rather than a file per component because the order between
components has to be decided in one place, and not by whichever import a
bundler happened to see first.

### Only some components

```ts
import { buttonStyles, dialogStyles, popoverStyles, stylesheet } from '@voltdev/ui';

const css = stylesheet([buttonStyles, dialogStyles, popoverStyles]);
```

Each of the twenty-six sheet entries is exported as `<entry>Styles` — one per
component, except that `<v-input>` and `<v-textarea>` share `fieldStyles`. A subset still
carries the whole token table and the reduced-motion override; only component
rules are left out. Build a subset with `stylesheet` rather than assembling one
from `tokensCss` and `componentCss`. Those two are there for the generator, and
a sheet built from them has no cascade layers and no reduced-motion block
unless you add both yourself.

## Putting classes on the markup

A primitive returns props. You spread them onto elements you write, and add the
class the sheet selects on. The dialog, end to end:

```ts
import { Component, Prop, Signal } from '@voltdev/core';
import { createDialog } from '@voltdev/primitives';

@Component({ selector: 'v-delete-project', templateUrl: './delete-project.html' })
export class DeleteProject {
  @Prop() onDelete?: () => void;

  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  dialog = createDialog({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
  });

  remove(): void {
    this.onDelete?.();
    this.dialog.close();
  }
}
```

```html
<button class="volt-button" data-variant="danger"
        :ref="trigger" :spread="dialog.triggerProps()" :click="dialog.open()">
  Delete project
</button>

<div :if="dialog.isPresent()" :portal
     class="volt-dialog-overlay" :data-state="dialog.state()"></div>

<div :if="dialog.isPresent()" :portal class="volt-dialog-content"
     :ref="content" :spread="dialog.contentProps()">
  <h2 class="volt-dialog-title" :spread="dialog.titleProps()">Delete this project?</h2>
  <p class="volt-dialog-description" :spread="dialog.descriptionProps()">
    Its history goes with it, and this cannot be undone.
  </p>
  <div class="volt-dialog-footer">
    <button class="volt-button" data-variant="ghost" :click="dialog.close()">Cancel</button>
    <button class="volt-button" data-variant="danger" :click="remove()">Delete</button>
  </div>
</div>
```

The overlay is the one element the primitive gives no props for. A scrim is
presentation, so it is your markup, and the `data-state` its animation keys
off is bound by hand from `dialog.state()`. It comes before the content
because both sit at the same `z-index`, and document order is what puts the
dialog on top. Everything else the sheet reads, the primitive wrote.
`:spread`, `:ref` and `:portal` are described in
[template syntax](./template-syntax).

### Which props go on which class

| Class | Spread |
|---|---|
| `volt-accordion` | `rootProps()` |
| `volt-accordion-item` | `itemProps(value)` |
| `volt-accordion-header` | — a heading element around the trigger |
| `volt-accordion-trigger` | `triggerProps(value)`, on a `<button>` |
| `volt-accordion-panel` | `contentProps(value)` |
| `volt-button` | — a `<button>` |
| `volt-checkbox-field` | — the `<label>` around the control |
| `volt-checkbox` | `controlProps()`, around the box and its words |
| `volt-checkbox-indicator` | — the box, with the mark inside it |
| `volt-dialog-overlay` | — bind `data-state` to `state()` |
| `volt-dialog-content` | `contentProps()` |
| `volt-dialog-title` | `titleProps()` |
| `volt-dialog-description` | `descriptionProps()` |
| `volt-dialog-footer` | — the row of actions |
| `volt-menu-content` | `contentProps()` |
| `volt-menu-item` | `itemProps(options)` |
| `volt-menu-separator` | `separatorProps()` |
| `volt-popover-content` | `contentProps()` |
| `volt-popover-title` | `titleProps()` |
| `volt-popover-description` | `descriptionProps()` |
| `volt-popover-arrow` | `arrowProps()`, on an element inside the content |
| `volt-tabs-list` | `listProps()` |
| `volt-tabs-tab` | `tabProps(value)` |
| `volt-tabs-panel` | `panelProps(value)` |
| `volt-toast-region` | `regionProps()` |
| `volt-toast` | `toastProps(toast)` |
| `volt-toast-title`, `-description`, `-actions` | — the toast's own text and buttons |
| `volt-tooltip-content` | `contentProps()` |

The trigger of a dialog, popover, menu or tooltip has no class of its own, and
neither do the close buttons `createPopover` and `createToaster` hand props to:
they are buttons you write, and `volt-button` is one way to draw them.

### `classes`

```ts
const classes: {
  readonly dialog: { readonly overlay: 'volt-dialog-overlay'; readonly content: 'volt-dialog-content'; … };
  …
}
```

Part name to class name, per component — the same objects the rules are built
from, so it cannot disagree with the sheet. Its type names every component and
every part, down to the string each one is.

```ts
import { classes } from '@voltdev/ui';

const content: string = classes.dialog.content; // 'volt-dialog-content'
```

| Component | Parts |
|---|---|
| `accordion` | `root`, `item`, `header`, `trigger`, `panel` |
| `button` | `root` |
| `checkbox` | `root`, `indicator`, `field` |
| `dialog` | `overlay`, `content`, `title`, `description`, `footer` |
| `menu` | `content`, `item`, `separator` |
| `popover` | `content`, `title`, `description`, `arrow` |
| `tabs` | `list`, `tab`, `panel` |
| `toast` | `region`, `root`, `title`, `description`, `actions` |
| `tooltip` | `content` |

A `root` part is `volt-<component>`; every other part is
`volt-<component>-<part>`.

A misspelt component or part is a compile error, and
`classes.dialog.content` compiles as it is under `noUncheckedIndexedAccess`,
which every [`create-volt`](./create-volt) template turns on. The tests compile
an application that uses it under each template's own compiler options.

Reaching for `classes` instead of writing the class out costs two things. It
is a runtime import — the class names of every component, about 4.4 kB
minified, 1.5 kB gzipped, and none of the rules. And a template reads its names
from the component instance, not from imports, so each component that uses it
needs a field holding it.

A class written out in the template costs nothing: it is part of the markup
the template clones. What it gives up is the link. If a later version changes
a class name, `classes` follows it and the written-out string does not.

## Theming

Every colour a component draws is a semantic token — a `var(--volt-color-*)`,
or the focus ring's own colour — and the tests refuse any other colour value in
a colour property, `transparent` and `currentColor` aside. Shadows are outside
that rule: a shadow's colour is part of its token's value, and no colour role
changes it. Every shadow is read from an elevation role instead, and the tests
refuse one read from anywhere else. Every duration is a `var(--volt-duration-*)`.
The tokens come in two layers.

| Layer | Holds | Example |
|---|---|---|
| Primitive | Raw values with no meaning — a palette, a type scale, a spacing ramp | `--volt-palette-accent-500: #2f6feb` |
| Semantic | Roles, each a single `var()` — at a primitive, except the focus ring's colour, which points at the accent role | `--volt-color-accent: var(--volt-palette-accent-500)` |

Components reach for the semantic layer for colour and never for the palette,
which is what makes a re-theme a matter of repointing a handful of roles rather
than hunting for the blue that happened to be a border. Declare the roles in
your own CSS, in no layer:

```css
:root {
  --volt-color-accent: #7c3aed;
  --volt-color-accent-hover: #6d28d9;
}
```

That wins over the package's own `:root` with no `!important` and no
specificity to match — see [overriding a rule](#overriding-a-rule) for why —
and the focus ring follows, because `--volt-focus-ring-color` points at the
accent.

**Repoint the palette at `:root` and nowhere else.** A `var()` inside a custom
property is resolved where the property is declared, so `--volt-color-accent`
has already become a colour at `:root`, and that colour is what everything
below inherits. A palette entry redefined on `.billing` reaches no role at all.
To theme one region, redefine the roles on it — including the ones that point
at other roles:

```css
.billing {
  --volt-color-accent: #0f766e;
  --volt-color-accent-hover: #115e59;
  --volt-focus-ring-color: #0f766e;
}
```

| Role | Tokens |
|---|---|
| Surfaces | `--volt-color-surface`, `--volt-color-surface-hover`, `--volt-color-surface-scrim`, `--volt-color-surface-sunken` |
| Text on a surface | `--volt-color-on-surface`, `--volt-color-on-surface-muted` |
| Edges | `--volt-color-border`, `--volt-color-border-strong` |
| Emphasis | `--volt-color-accent`, `--volt-color-accent-hover`, `--volt-color-accent-muted`, `--volt-color-on-accent` |
| Destruction | `--volt-color-danger`, `--volt-color-danger-hover`, `--volt-color-danger-muted`, `--volt-color-on-danger` |
| Status | `--volt-color-success`, `--volt-color-warning`, `--volt-color-info` |
| Focus | `--volt-focus-ring-color`, `--volt-focus-ring-width`, `--volt-focus-ring-offset` |
| Other | `--volt-disabled-opacity`, `--volt-elevation-raised`, `--volt-elevation-overlay` |

An `on-` role is the foreground guaranteed legible on the surface of the same
name. Three roles are defined and read by no component today —
`surface-sunken`, `accent-muted` and `danger-muted` — and are there for your
own markup.

Only colour and elevation go through the semantic layer. The dialog, menu,
popover and toast read `--volt-elevation-overlay`, and the tooltip
`--volt-elevation-raised`, so repointing either role moves every surface that
floats at that height. Spacing, type, radii, border widths, `z-index`,
durations and easing are read from the primitive tokens directly.

**The names are public API.** `--volt-<category>-<name>`, lowercase,
hyphen-separated. Renaming one is a breaking change, which is the point: a
token nobody can rely on is not a contract. The values are literal hex and
`rgb()` rather than `color-mix()` or `oklch()`, so the emitted sheet stays
readable and diffable once it is copied into a repository, and a theme is a
table of strings rather than a computation someone has to re-run.

One palette ships. There is no dark theme, and the sheet declares no
`color-scheme`, so native scrollbars and form controls stay light under a dark
palette unless you declare one yourself. A dark palette is a set of role
overrides under `prefers-color-scheme`, written by you.

| Export | Description |
|---|---|
| `primitiveTokens` | The raw table, name to value |
| `semanticTokens` | The roles, name to `var()` |
| `reducedMotionTokens` | What `prefers-reduced-motion: reduce` sets |
| `tokenNames` | Every token the sheet defines, as a `ReadonlySet<string>` |
| `tokensCss(indent?)` | The `:root` block on its own, in no layer |
| `TokenTable` | The type of the three tables: `Readonly<Record<string, string>>` |

## Overriding a rule

```css
@layer volt.base, volt.components, volt.overrides;
```

Every rule the sheet emits is inside a cascade layer, and that is the whole of
the override story. Within one origin, CSS in no layer beats CSS in any layer,
whatever the specificity on either side — so your
`.checkout-button { border-radius: 0 }` beats
`.volt-button[data-variant='primary']` without `!important`, and without
having to know how specific the package's selectors are. That only holds while
nothing in the sheet escapes a layer, which is one of the things the tests walk
the emitted text for.

| Layer | Holds |
|---|---|
| `volt.base` | The token table, and the reduced-motion override of it |
| `volt.components` | Everything a component draws |
| `volt.overrides` | Nothing. Declared for whoever ships on top of this package |

`volt.overrides` is the seam for CSS that has to beat the components and still
lose to the application — a design-system package built on this one, or a
theme file meant to stay overridable by whoever imports it.

The order statement comes first in the sheet, and has to. Without it the order
of layers is decided by which is written to first, so a sheet that only emitted
`volt.components` would put a later `volt.base` above it, and the tokens would
start beating the rules that use them.

CSS in layers of your own — a utility framework's, say — is a different case.
Between two layered sheets the order is decided by which layer name the browser
meets first, which means by load order. The three layers are sub-layers of one
layer named `volt`, so naming it first in the first of your own stylesheets to
load puts all of them beneath yours, whether the Volt sheet loads before that
one or after it:

```css
@layer volt, base, components, utilities;
```

| Export | Value |
|---|---|
| `LAYER_BASE` | `'volt.base'` |
| `LAYER_COMPONENTS` | `'volt.components'` |
| `LAYER_OVERRIDES` | `'volt.overrides'` |
| `layerOrder` | The three, weakest first |
| `layerOrderStatement()` | `'@layer volt.base, volt.components, volt.overrides;'` |
## Accessibility the sheet carries

**Forced colours.** Each component restates, under
`@media (forced-colors: active)`, the states it shows in colour, in a channel
the user's palette does not flatten: a checked box takes a thicker border, a
danger button a double one, the selected tab `Highlight` on its text and edge,
a hovered button or tab an underline, a hovered menu item the `Highlight` pair,
and a floating panel a border in place of the shadow forced-colors mode does
not paint. The dialog's scrim is dropped — a colour with an alpha would become
an opaque `Canvas` over the page — and the content's border separates the two
surfaces instead. Inside that block a colour is a system colour, `transparent`
or `currentColor`, and the tests refuse any other: any other colour is replaced
by whichever system colour the browser guesses fits, which is the guess the
block exists to take away. `transparent` hides nothing there except as a
background: an edge, an outline or text drawn in it is painted like any other
colour. So what the sheet hides with `transparent` in the ordinary palette —
an unselected tab's edge, an unchecked box's mark — is taken away, or given a
system colour, under forced colours.

**Reduced motion.** Every transition and animation reads its duration from
`--volt-duration-fast` or `--volt-duration-medium`, and
`prefers-reduced-motion: reduce` sets both to `0ms` in `volt.base`. Zero rather
than "very fast": the primitives' presence handling asks the element whether
anything is animating and releases a closing node at once when nothing is, so
a zero duration removes the wait instead of shortening it.

**Focus.** `:focus-visible` rather than `:focus`, so a mouse press leaves no
ring behind; and an `outline` rather than a border or shadow, because an
outline is the one focus indicator forced-colors mode keeps drawing.

### How much of that is checked

Each component has fixtures — pairs of markup that differ by one state a user
has to be able to see, such as checked and unchecked, or an item with the
pointer on it and one without. Each pair is mounted with the ordinary palette
and with a forced one, and has to compute to something different in both. In
the forced one a colour that is not a system colour counts as the palette's
choice rather than the sheet's, so a pair that differs only in colours the
palette would replace fails. Each fixture is mounted again with reduced motion
on, and every duration it computes has to be zero.

A difference in any of the measured properties counts, animation name
included. Where a component's only pair is open against closed — the dialog
and the tooltip — the two sides differ by which animation is on them in either
palette, so for those two the pair check passes without saying anything about
colour.

Two things a pair cannot see are checked across every fixture under the forced
palette, since both are about which colour the palette would paint. Nothing is
drawn in `transparent` — no edge, outline or text — because the palette would
show it. And every element that casts a shadow in the ordinary palette — the
dialog, menu, popover, toast and tooltip — draws an edge on all four sides in
a system colour other than its own fill, since that edge is all that is left
to tell it from the page.

Beside the fixtures, each primitive is mounted with its documented markup and
the sheet in the document, as described [at the top](#primitives-alone-a-component-or-the-sheet-in-between),
and what the two do together is measured there: the hover on a menu item, the
gap and the arrow of a popover in each of its twelve placements, the edge of a
tab in either orientation, the box and mark of a checkbox with its words
inside, and the scheme a context menu is placed with.

The limits are those of the environment. The tests run in happy-dom, which
supports both preferences as device settings and resolves `var()` through the
token chain, but drops `@layer` blocks whole — so the fixtures are measured
against an unlayered copy of the sheet built from the same data, and the claim
that your CSS beats the sheet is checked by walking the emitted text for
anything outside a layer, not by a browser deciding a cascade. It never matches
`:hover`, so that copy spells it `[data-hover]`, which is exactly as specific.
It gives a `<button>` none of a browser's own styling, so the checks on button
borders add the border a browser gives one. And it lays nothing out: no test
can see where an element ends up, only what the rules placing it compute to —
which is why the dialog's centring is checked by holding its keyframes to the
rule they animate, not by measuring a box. Nothing runs in a real browser, and
nothing is a visual test.
## Styles as data

The sheet is assembled from data rather than written as CSS, because the
promises above are properties of the whole sheet rather than of any rule: every
colour a token, no rule outside a layer, every coloured state restated for
forced colours. Those are checkable by walking declarations and only greppable
in a string. The generator that will copy components into a repository needs
the same data, one component at a time.

```ts
type Declarations = Readonly<Record<string, string>>;  // property → value, in order

interface ComponentStyles {
  readonly name: string;
  readonly classes: Readonly<Record<string, string>>;  // part → class
  readonly keyframes: readonly Keyframes[];
  readonly rules: readonly Rule[];
  readonly forcedColors: readonly Rule[];              // the forced-colors block
}

interface Rule {
  readonly selector: string;
  readonly declarations: Declarations;
}

interface Keyframes {
  readonly name: string;
  readonly steps: readonly KeyframeStep[];
}

interface KeyframeStep {
  readonly offset: string;                             // 'from', 'to' or a percentage
  readonly declarations: Declarations;
}
```

`forcedColors` is held apart from `rules` rather than being an optional block
inside them, because it is a required part of each component: a state shown in
colour has to be restated there, and something has to be able to check that
it was.

The rules keep to a few constraints, each checked by the tests:

- **Classes, attributes and pseudo-classes in selectors, nothing else.** No
  ids, and no pseudo-elements — a part drawn with `::before` is a part your
  markup cannot restructure.
- **No shorthand that resets what it does not name** — `background`,
  `border`, `margin`, `font`, `inset` and the rest. Overriding
  `background-color` should not mean discovering that a `background` elsewhere
  reset it.
- **No `!important`.**
- **Keyframes of its own.** Every animation name a component uses is defined
  by that component, so a component copied on its own does not name an
  animation that was left behind.
- **Every shadow an elevation role**, so that repointing
  `--volt-elevation-overlay` reaches every surface drawn at that height.
- **Animations that end where the rule rests.** An animation's value beats a
  rule's and these fill, so an entry animation has to end, and an exit start,
  at whatever value the component's own rule gives the property — the check
  that keeps the dialog centred. And an entry animation to a height a primitive
  measured fills backwards only, so the open element does not keep that height
  once it has run.
- **A forced-colours block.** Every component has one. The test checks only
  that it is not empty; what is in it is checked through the fixtures, as
  [above](#how-much-of-that-is-checked).

| Export | Description |
|---|---|
| `componentStyles` | Every component, alphabetical |
| `accordionStyles`, `buttonStyles`, `checkboxStyles`, `dialogStyles`, `menuStyles`, `popoverStyles`, `tabsStyles`, `toastStyles`, `tooltipStyles` | One component each |
| `componentCss(component, indent?)` | One component's CSS, in no layer |
| `rulesToCss(rules, indent?)` | Serialise rules, a blank line between each |
| `keyframesToCss(frames, indent?)` | Serialise `@keyframes` blocks |
| `wrap(prelude, body, indent?)` | Wrap serialised CSS in an at-rule block |
| `FORCED_COLORS_QUERY` | `'@media (forced-colors: active)'` |
| `VERSION` | `'0.1.0-alpha.1'`, the version the package is published as |

`componentCss` is what the generator will use, and its output is in no layer.
Written into a page as it is, it beats all of your layered CSS and fights your
unlayered CSS on specificity and source order — the fight the layers exist to
end. Wrap it before using it, and it still needs the tokens and the order
statement that only `stylesheet()` writes together:

```ts
import { componentCss, dialogStyles, LAYER_COMPONENTS, wrap } from '@voltdev/ui';

const css = wrap(`@layer ${LAYER_COMPONENTS}`, componentCss(dialogStyles, '  '));
```

## What is not here yet

- **Most of the inventory.** Twenty-seven components over twenty-six sheet entries,
  out of the roughly fifty the roadmap names. The application shell, the layout
  primitives, the date and time controls and the data components beyond the
  table are not built.
- **A `.css` file in the package.** Generate one with `stylesheet()`.
- **A release.** The package is not on npm.
- **A second palette**, and a `color-scheme` to go with one.
- **Most of the primitives.** Twenty-six of the seventy-one have a component
  over them. Combobox and the rest of the collections, and most of the form,
  display and data primitives, have no styles here yet.
