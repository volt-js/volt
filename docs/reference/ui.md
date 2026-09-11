# Styled components

`@voltdev/ui` is the styled layer over [`@voltdev/primitives`](./primitives).
The primitives own behaviour — state, keyboard, focus, ARIA, positioning — and
write what they know onto the element as `data-` attributes. This package owns
what those elements look like, and nothing else: one stylesheet, the class
names it selects on, and the design tokens every rule is written in.

There is no component here to render. A styled dialog is `createDialog` from
the primitives, spread onto markup you write, with `volt-dialog-content` in its
`class`. What you install is a stylesheet and a vocabulary, not a tag.

::: warning Not on npm yet
`@voltdev/ui` has not been released — see
[what is on npm](../guide/getting-started#what-is-on-npm). Everything on this
page works from a checkout of the Volt repository, where the package resolves
from the workspace.
:::

**It is early, and the delivery is not built.** The package is
`0.1.0-alpha.1` and styles nine components. It is designed to be copied into
your repository by a CLI, as source you own and edit rather than a dependency
you override; that CLI does not exist, so today the sheet is a string you
generate and write to a file. What is missing, and what is wrong in what is
here, is listed [at the end](#what-is-not-here-yet).

## Primitives alone, or with this on top

| You want | Use |
|---|---|
| Your own design system, or one you already have to match | `@voltdev/primitives` alone |
| A working default look you can repoint and override | The primitives, with this sheet |
| A button | This sheet — a `<button>` already has the behaviour, so there is no primitive |

The line between the two is drawn so that the styled layer can always be taken
away. Everything the sheet selects on is something a primitive already writes,
or a class or attribute you put on your own element; remove the sheet and every
component still opens, closes, traps focus and speaks to a screen reader. A
styled layer that owned any behaviour would be one you could not drop, and
theming would become something to fight rather than use.

For the same reason this package does not import `@voltdev/primitives`. It
restates the contract between them — the `data-` attributes each primitive
writes, and the one custom property a primitive measures — in its own source.
**Nothing checks that restatement against the primitives.** Read side by side
today the two agree — every `data-` attribute a rule expects from a primitive is
one that primitive writes, with the values the rule expects — but the tests
hold the sheet only to itself: every class it declares has a rule, every
`var()` names a token or a known contract property. A primitive that renamed an attribute would leave a rule selecting on
nothing, and no test in this package would fail.

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

The emitted sheet is 34.8 kB as written and 3.6 kB minified and gzipped.

It is a file rather than a call at runtime because the data the sheet is built
from weighs more than the sheet. Calling `stylesheet()` in the browser ships
every component's rules as JavaScript — about 32 kB minified, 4.9 kB gzipped —
and then assembles the string at startup, to arrive at CSS the build could
have written once.

That weight comes with any runtime import from the package, not only with
`stylesheet`. The package is bundled into one module that computes `classes`
and its token sets as it loads, so a bundler cannot prove any of the style data
unused: an application that imports a single layer name ships about 30 kB
minified, 4.3 kB gzipped, of rules it never runs. Keep the package in build
scripts, as a dev dependency, and put only the generated file in front of the
browser.

The cost of the file is that it is a copy. It does not follow the package: an
upgrade changes nothing on your page until you generate it again.

It is one string rather than a file per component because the order between
components has to be decided in one place, and not by whichever import a
bundler happened to see first.

### Only some components

```ts
import { buttonStyles, componentStyles, dialogStyles, stylesheet } from '@voltdev/ui';

const css = stylesheet([buttonStyles, dialogStyles]);

// accordion, menu and tooltip have no export of their own
const menu = componentStyles.filter((component) => component.name === 'menu');
const withMenu = stylesheet([buttonStyles, ...menu]);
```

A subset still carries the whole token table and the reduced-motion override;
only component rules are left out. Build a subset with `stylesheet` rather than
assembling one from `tokensCss` and `componentCss`. Those two are there for the
generator, and a sheet built from them has no cascade layers and no
reduced-motion block unless you add both yourself.

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
[template syntax](./template-syntax). As written, this dialog is not centred
on the screen — see [dialog](#dialog) for why, and for the rule that fixes it.

### Which props go on which class

| Class | Spread |
|---|---|
| `volt-accordion` | `rootProps()` |
| `volt-accordion-item` | `itemProps(value)` |
| `volt-accordion-header` | — a heading element around the trigger |
| `volt-accordion-trigger` | `triggerProps(value)`, on a `<button>` |
| `volt-accordion-panel` | `contentProps(value)` |
| `volt-button` | — a `<button>` |
| `volt-checkbox-field` | — the `<label>` around the box and its text |
| `volt-checkbox` | `controlProps()` |
| `volt-checkbox-indicator` | — the mark, inside the box |
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
const classes: Readonly<Record<string, Readonly<Record<string, string>>>>
```

Part name to class name, per component, built from the same objects the rules
are, so it cannot disagree with the sheet.

```ts
import { classes } from '@voltdev/ui';

classes.dialog?.content; // 'volt-dialog-content'
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

Reaching for `classes` instead of writing the class out costs three things.
It is a runtime import, so it carries every component's style data into the
client bundle — about 30 kB minified, 4.3 kB gzipped, for the reason given
[above](#getting-the-styles-onto-the-page). Its type says nothing about which
components or parts exist, so a misspelt name is not a compile error, and under
`noUncheckedIndexedAccess`, which every [`create-volt`](./create-volt) template
turns on, `classes.dialog.content` does not compile without a `?.` or an
assertion. And a template reads its names from the component instance, not
from imports, so each component that uses it needs a field holding it.

A class written out in the template costs nothing: it is part of the markup
the template clones. What it gives up is the link. If a later version changes
a class name, `classes` follows it and the written-out string does not.

## Theming

Every colour a component draws is a semantic token — a `var(--volt-color-*)`,
or the focus ring's own colour — and the tests refuse any other colour value in
a colour property, `transparent` and `currentColor` aside. Shadows are outside
that rule: a shadow's colour is part of its token's value, and no role changes
it. Every duration is a `var(--volt-duration-*)`. The tokens come in two
layers.

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
name. Four roles are defined and read by no component today —
`surface-sunken`, `accent-muted`, `danger-muted` and `elevation-raised` — and
are there for your own markup.

Only colour goes through the semantic layer. Spacing, type, radii, border
widths, `z-index`, durations and easing are read from the primitive tokens
directly, and so are two shadows: the dialog, popover and toast read
`--volt-elevation-overlay`, but the menu reads `--volt-shadow-2` and the
tooltip `--volt-shadow-1`, so repointing the elevation role leaves those two
where they were.

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

## What each component expects

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

The box is a fixed square that holds only the mark, so the text cannot go
inside the control the way the primitive's own example puts it. Put the text
beside the box, and name the control with `labelledBy`:

```ts
import { Signal } from '@voltdev/core';
import { createCheckbox, createId } from '@voltdev/primitives';

class Terms {
  labelId = createId('terms-label');
  input = new Signal.State<Element | null>(null);
  agree = createCheckbox({
    input: () => this.input.get(),
    name: 'terms',
    labelledBy: this.labelId,
  });
}
```

```html
<label class="volt-checkbox-field" :click="agree.toggle()" :keydown="agree.onKeyDown($event)">
  <input :ref="input" :spread="agree.inputProps()">
  <span class="volt-checkbox" :spread="agree.controlProps()">
    <span class="volt-checkbox-indicator" aria-hidden="true">✓</span>
  </span>
  <span :id="labelId">I accept the terms</span>
</label>
```

The id is generated rather than written out because an id names one element in
the whole page, and a component rendered twice would otherwise name both boxes
with the first label.

The sheet draws the box, its fill and its border; it does not draw a tick.
There are no pseudo-elements anywhere in it, so the mark is yours — a glyph
or an SVG — and it is shown for `checked` and `indeterminate` with
`visibility`, so the box does not change size between states. Reading
`agree.isIndeterminate()` is how you draw a different mark for the third
state. The rules select on `data-state` and `data-disabled` only, and on no
ARIA attribute: ARIA is there to be spoken, not styled against.

### Dialog

The content is fixed to the viewport, at most 30rem wide, and never taller than
the viewport less a margin — it scrolls instead, because a dialog taller than
the screen with no way to scroll is a dialog with an unreachable confirm
button. The overlay is yours, as in [the example above](#putting-classes-on-the-markup).
The content has a focus ring of its own, since it takes focus itself when
nothing inside it wants to.

**It is not centred today.** The rule centres the content with
`translate: -50% -50%`, and the entry animation animates `translate` too,
ending at `0 0`. An animation's value beats a rule's, and the animation fills
forwards, so once it has run the content sits with its top-left corner at the
centre of the viewport — and a dialog tall enough to scroll runs off the bottom
of the screen, confirm button included. Reduced motion does not help: an
animation of zero length still fills. Until the sheet is fixed, centre it
without `translate` in your own CSS, which beats the layer:

```css
.volt-dialog-content {
  inset-block: 0;
  inset-inline: 0;
  margin: auto;
  inline-size: fit-content;
  block-size: fit-content;
}
```

The animation still ends at `translate: 0 0`, which now moves nothing, and the
entrance keeps its short rise.

### Popover, menu and tooltip

All three are positioned by the primitive through CSS anchor positioning, which
writes `position-anchor` and `position-area` inline and marks the element
`data-anchored="true"`. Where the browser has no anchor positioning it writes
`data-anchored="false"` and no position at all, and the sheet falls back to
placing the element against its nearest positioned ancestor — below it for
the popover and the menu, above it for the tooltip. That is not correct
placement, and it is only near the trigger at all when the element sits inside
a `position: relative` wrapper shared with its trigger.

That rules out `:portal`, which the primitives' own examples use for all
three. A portalled element with nothing positioned above it is placed against
the page: the fallback puts a popover or a menu at the start edge below the
first screenful, and a tooltip above the top of the page, where it cannot be
seen. On an engine without anchor positioning, choose between the portal and
the fallback.

The popover arrow is drawn from `data-placement`, which the primitive writes
on it, and only for the `top` and `bottom` placements: the sheet moves it onto
the edge that faces the trigger and hides the two borders that would show
inside the popover. Along that edge nothing places it, so it sits at the start
of the content box — under the trigger for a `-start` placement, and not for a
centred one. On a `left` or `right` placement it is drawn as a full square with
no offset. And `data-placement` is the placement asked for: when the browser
flips the popover to the other side it does not say so, and the arrow stays on
the edge that now faces away.

The gap the sheet leaves between a popover and its trigger is a margin above
and below it, so a `left` or `right` popover sits against its trigger. Pass
`offset` to `createPopover` and the primitive writes the gap on whichever side
faces the trigger instead.

The menu marks the item under keyboard focus with `:focus-visible`. Roving
focus moves real focus between items, so there is no highlighted-item attribute
to style, and in a menu opened with the pointer, focus that follows the pointer
draws no ring — the hover background is what is meant to mark that item, and
**today it does not**. The rule is emitted as
`.volt-menu-item:disabled, .volt-menu-item[aria-disabled='true']:hover`: it
selects disabled items where it means enabled ones, and its first half has no
`:hover` at all. An enabled item gets no highlight in either palette; an item
disabled through `itemProps` never matches, because the sheet also switches off
its pointer events; and an item that is a natively `disabled` `<button>` is
painted in the hover colour — `Highlight`, under forced colours — all the time.
Until that rule is fixed, write the hover yourself:

```css
.volt-menu-item:not(:disabled):not([data-disabled]):hover {
  background-color: var(--volt-color-surface-hover);
}

@media (forced-colors: active) {
  .volt-menu-item:not(:disabled):not([data-disabled]):hover {
    background-color: Highlight;
    color: HighlightText;
  }
}
```

A menu item written as a `<button>`, as the primitive's own example writes it,
also keeps the browser's button border; [tabs](#tabs) has the rule that clears
it.

A context menu — `createMenu` with no `trigger` — is not anchored and carries no
`data-anchored`, so neither placement rule applies. The sheet still makes it
`position: absolute`, while `position()` reports the press in viewport
coordinates, so give it `position: fixed` in your own CSS before placing it
there, or it opens in the wrong place on a scrolled page.

The tooltip is `pointer-events: none`, deliberately — a tooltip that can be
hovered can be hovered off the control it describes. That overrides the
primitive, which lets the pointer travel onto the tooltip so a long
description can be read without it closing, as WCAG's Content on Hover or
Focus criterion (1.4.13) asks. With this sheet the pointer cannot reach it.
Keep tooltips short, or set `pointer-events` back to `auto` in your own CSS.

### Tabs

The primitive hides inactive panels with the `hidden` attribute rather than
unmounting them, so nothing in the sheet sets `display` on a panel, and
nothing in yours should: a `display` of any kind beats `hidden` and shows every
panel at once. The selected tab is marked three ways — weight, colour and an
underline — so that the selection does not rest on colour, which a forced
palette replaces; under forced colours the text and the underline take
`Highlight`. Panels have a focus ring, since each is in the tab order.

The tab rule draws only the bottom edge. A tab written as a `<button>`, as the
primitive's own example writes it, keeps the browser's button border on the
other three sides, and a `<button>` menu item keeps it on all four, because the
item rule sets no border at all. Until the sheet resets them, do it in your own
CSS:

```css
.volt-tabs-tab {
  border-block-start-style: none;
  border-inline-start-style: none;
  border-inline-end-style: none;
}

.volt-menu-item {
  border-style: none;
}
```

A vertical list moves its edge to the inline end, but nothing changes for the
tabs in it: the selected one is still underlined along its bottom edge rather
than marked on the edge beside the panels.

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

### Accordion

The header is a heading element wrapping the trigger, as the pattern asks; the
sheet takes its type scale away so the button inside is the visible thing. The
panel animates its height between zero and `--volt-collapsible-height`, which
`createAccordion` measures in [the measure lane](./reactivity#effects) and
writes on the panel's `style` — `auto` does not interpolate, so without a real
number there is nothing to animate between. The primitive keeps a closing panel
present until that animation has run, so render the panel under
`:if="isPresent(value)"` and the collapse is seen before it goes.

The expand animation fills forwards, so an open panel is held at the height
measured when it opened rather than going back to `auto`. The primitive
measures again when the panel's own box changes size, which a new width does,
but content that grows inside it without that — an image arriving — is clipped
until then. In your own CSS, a `backwards` fill on the open panel lets it go
back to `auto` once the animation has run:

```css
.volt-accordion-panel[data-state='open'] {
  animation-fill-mode: backwards;
}
```

`contractProperties`, a `ReadonlySet<string>`, is the list of such properties —
the ones a primitive writes and a rule may read — and
`--volt-collapsible-height` is the only one; `createCollapsible` writes it too.
It is not a token: nobody decides in advance how tall a panel's content is.

## Accessibility the sheet carries

**Forced colours.** Each component restates, under
`@media (forced-colors: active)`, the states it shows in colour, in a channel
the user's palette does not flatten: a checked box takes a thicker border, a
danger button a double one, the selected tab `Highlight` on its text and
underline, and a floating panel a border in place of the shadow forced-colors
mode does not paint. The dialog's scrim is dropped — a colour with an alpha
would become an opaque `Canvas` over the page — and the content's border
separates the two surfaces instead. Two states are not carried across: a tab's
hover is drawn only in colour and never restated, and the menu item's hover is
restated in the same broken selector as its ordinary rule. Inside that block a
colour is a system colour, `transparent` or `currentColor`, and the tests
refuse any other: any other colour is replaced by whichever system colour the
browser guesses fits, which is the guess the block exists to take away.

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
has to be able to see, such as checked and unchecked. Each pair is mounted with
the ordinary palette and with a forced one, and has to compute to something
different in both. Each fixture is mounted again with reduced motion on, and
every duration it computes has to be zero.

A difference in any of the measured properties counts, animation name
included. Where a component's only pair is open against closed — the dialog
and the tooltip — the two sides differ by which animation is on them in either
palette, so for those two the forced-colours check passes without saying
anything about colour.

The limits are those of the environment. The tests run in happy-dom, which
supports both preferences as device settings and resolves `var()` through the
token chain, but drops `@layer` blocks whole — so the fixtures are measured
against an unlayered copy of the sheet built from the same data, and the claim
that your CSS beats the sheet is checked by walking the emitted text for
anything outside a layer, not by a browser deciding a cascade. happy-dom lays
nothing out and gives a `<button>` none of a browser's own styling, so no test
can see where a rule puts an element or what a button brings with it — which is
how the dialog's position and the borders on `<button>` tabs got through. A
state with no fixture is not checked at all: no fixture hovers anything, which
is how the menu's hover rule got through. Nothing runs in a real browser, and
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
- **A forced-colours block.** Every component has one. The test checks only
  that it is not empty; what is in it is checked through the fixtures, as
  [above](#how-much-of-that-is-checked).

| Export | Description |
|---|---|
| `componentStyles` | Every component, alphabetical |
| `buttonStyles`, `checkboxStyles`, `dialogStyles`, `popoverStyles`, `tabsStyles`, `toastStyles` | One component each |
| `componentCss(component, indent?)` | One component's CSS, in no layer |
| `rulesToCss(rules, indent?)` | Serialise rules, a blank line between each |
| `keyframesToCss(frames, indent?)` | Serialise `@keyframes` blocks |
| `wrap(prelude, body, indent?)` | Wrap serialised CSS in an at-rule block |
| `FORCED_COLORS_QUERY` | `'@media (forced-colors: active)'` |
| `VERSION` | `'0.1.0'` — behind the package's own `0.1.0-alpha.1` |

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

- **The CLI.** Copying each component into your repository as source is the
  intended distribution, and the reason the styles are data. Nothing ships it.
- **A `.css` file in the package.** Generate one with `stylesheet()`.
- **A release.** The package is not on npm.
- **Individual exports for three components.** `accordionStyles`,
  `menuStyles` and `tooltipStyles` exist in the source but are not exported
  from the package; the three are reachable through `componentStyles`,
  `classes` and the sheet.
- **Typed class names.** `classes` is a string-keyed record; there is no type
  that knows `dialog` has a `content`.
- **A second palette**, and a `color-scheme` to go with one.
- **Most of the primitives.** Nine are styled. Switch, radio group, select,
  combobox and the rest of the collections, form, display and data primitives
  have no styles here; the package covers a subset on purpose.

## Known problems

Each is described under its component, with a rule of your own that works
around it where there is one.

- **The dialog is not centred.** Its entry animation replaces the `translate`
  that centres it — [dialog](#dialog).
- **The menu has no hover highlight**, and paints a natively disabled
  `<button>` item in the hover colour all the time —
  [popover, menu and tooltip](#popover-menu-and-tooltip).
- **A `<button>` tab or menu item keeps the browser's border** — [tabs](#tabs).
- **An open accordion panel is held at its measured height**, so content that
  grows later is clipped — [accordion](#accordion).
- **The tooltip's `pointer-events: none`** switches off the primitive's
  hoverable content — [popover, menu and tooltip](#popover-menu-and-tooltip).
- **The popover arrow** has no rules for `left` or `right` placements, sits at
  the start of its edge rather than under the trigger, and stays on the
  requested side after a flip — [popover, menu and tooltip](#popover-menu-and-tooltip).
- **The no-anchor fallback** cannot work for the portalled markup the
  primitives' own examples use — [popover, menu and tooltip](#popover-menu-and-tooltip).
- **A vertical tab list** still underlines its selected tab — [tabs](#tabs).
- **A tab's hover** is not restated for forced colours —
  [accessibility](#accessibility-the-sheet-carries).
