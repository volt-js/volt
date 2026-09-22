# Overlay primitives

Dialogs, popovers, tooltips, menus, toasts and disclosures, from
`@voltdev/primitives`. Each is headless: it owns state, the keyboard and the
ARIA wiring, and hands back prop objects to spread onto markup you write.
Nothing here renders, and nothing here has an opinion about how anything
looks.

::: warning Not on npm yet
Part of `@voltdev/primitives`, which is not published yet — see
[the overview](./primitives). Everything here works from a checkout of the Volt
repository.
:::

They are built from four shared behaviours — presence, dismissal, focus scope
and anchoring — and those are exported too, for the layer this page does not
have. They are described [at the end](#the-behaviours-underneath). The rest
of the package is listed under [primitives](./primitives).

## The shape they share

Every overlay is created in a component's field initialiser, is handed its
elements as getters, and gives back methods that read state and methods that
return props.

```ts
import { Signal } from '@voltdev/core';
import { createPopover } from '@voltdev/primitives';

class Filters {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  popover = createPopover({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
  });
}
```

```html
<button :ref="trigger" :spread="popover.triggerProps()">Filters</button>
<div :if="popover.isPresent()" :portal :ref="content" :spread="popover.contentProps()">
  …
</div>
```

**Elements are getters, not values.** The content does not exist until `:if`
builds it, and it is gone again once it closes. A getter over a signal that
[`:ref`](./template-syntax#ref) writes into is read at the moment it is
needed, so nothing holds a node that has left the document.

**Open state is yours or theirs.** Pass `open: Signal.State<boolean>` to drive
it from outside; leave it out and the primitive owns one, seeded from
`defaultOpen`. `onOpenChange` is called when the primitive itself changes the
state — its own `open()`, `close()` and `toggle()`, a dismissal, a key. A write
you make to your own signal is not reported back to you, since you already
know about it.

**Opening from an effect does not subscribe it.** Every one of them reads its
own state untracked inside `open()`, `close()` and `toggle()` — and the
collapsible reads `disabled` the same way. So an effect that opens a dialog
when an upload fails does not start depending on the dialog; tracked, closing
it would run the effect again and, the condition still holding, open it
straight back up:

```ts
import { Signal, effect } from '@voltdev/core';
import { createDialog } from '@voltdev/primitives';

class Upload {
  failed = new Signal.State(false);
  content = new Signal.State<Element | null>(null);
  dialog = createDialog({ content: () => this.content.get() });

  constructor() {
    effect(() => {
      if (this.failed.get()) this.dialog.open();
    });
  }
}
```

**Three answers to "is it open".**

| Method | Answers |
|---|---|
| `isOpen()` | Whether it is logically open — false the moment it closes |
| `isPresent()` | Whether its content should be in the DOM — stays true while an exit animation runs |
| `state()` | `'open'` or `'closed'`, for the `data-state` attribute CSS animates against |

Put `isPresent()` on the `:if`, never `isOpen()`. The second removes the node
the instant it closes, and no exit animation can play on a node that is gone.
See [`createPresence`](#createpresence) for how the wait is decided.

**Portal the content.** [`:portal`](./template-syntax#portal) with no target puts
it at the end of `<body>`. A modal dialog makes the page inert by walking the
children of `<body>` and skipping the one that holds it, so a dialog rendered
inline inside `#app` leaves everything else in `#app` live. Anchored content
is placed against its trigger by CSS whatever its parent, but left inside
the page it is still clipped by an `overflow: hidden` ancestor it is
positioned within — a scrolling panel, a card with `position: relative` — and
it shares that ancestor's stacking context.

**They need a scope.** Dismissal, focus handling and timers register listeners
for as long as the calling scope lives, and a component's field initialiser is
that scope. Created with no scope current, nothing is ever cleaned up, and a
development build says so on the console; outside a component — a test, a
script — wrap the call in `createRoot` from `@voltdev/core` and keep the
disposer.

**Their words come from a provider when there is one.** The popover's close
button, the menu's name and the toaster's region and close buttons read the
catalogue of the nearest
[`createLocaleProvider`](./primitives-data#createlocaleprovider) — `close`,
`menu`, `notifications` and `closeNotification` — when it has an entry, and
are said in English otherwise; a `labels` entry wins over both. They ask a
provider and nothing else, not the document's `lang` as `useLocale` would, so
an overlay does not bring a whole locale into a bundle to say one word. Each
name is read when it is said, so a catalogue swapped later renames what is
already on screen. The dialog has no default string of its own: it is named
by its title.

**Not every prop bag carries its handlers.** The popover and the tooltip put
their event handlers in the props, so spreading them is the whole of the
wiring. The others leave the events to you, and a trigger with no `:click`
does nothing:

| Primitive | Handlers inside the props | What you bind yourself |
|---|---|---|
| `createDialog` | none | `:click` on the trigger and on any close button |
| `createPopover` | trigger, content, close button | nothing |
| `createTooltip` | trigger, content | nothing |
| `createMenu` | none | the trigger's `:click` and `:keydown`, or the area's `:contextmenu`; the content's `:keydown`, `:click` and `:pointermove` |
| `createToaster` | none | each close button's `:click` |
| `createCollapsible` | none | the trigger's `:click` |
| `createAccordion` | none | each header's `:click`, and `:keydown` on the container |

The inconsistency is real and is the package as it stands, not a convention
to learn.

## Showing a modal: `createDialog`

```ts
createDialog(options: DialogOptions): Dialog
```

| Option | Default | Description |
|---|---|---|
| `content` | — | The dialog's content element, once rendered. Required |
| `trigger` | — | The element that opens it, so a press on it is not treated as outside |
| `open` | own state | A `Signal.State<boolean>` to control it from outside |
| `defaultOpen` | `false` | Initial state when it owns its own |
| `modal` | `true` | Trap focus, make the rest of the page inert, lock scrolling |
| `closeOnEscape` | `true` | Escape closes it |
| `closeOnOutsidePointer` | `true` | A press outside closes it |
| `onOpenChange` | — | Called with the new state when the dialog changes it |

| Member | Description |
|---|---|
| `isOpen()` / `isPresent()` / `state()` | See [the shape they share](#the-shape-they-share) |
| `open()` / `close()` / `toggle()` | Change the state |
| `triggerProps()` | `aria-haspopup="dialog"`, `aria-expanded`, and `aria-controls` while open |
| `contentProps()` | `id`, `role="dialog"`, `aria-modal` while `modal`, the label and description references, `data-state`, `tabindex="-1"` |
| `titleProps()` | An `id` for the heading that names it |
| `descriptionProps()` | An `id` for the text that describes it |

```ts
import { Signal } from '@voltdev/core';
import { createDialog } from '@voltdev/primitives';

class DeleteFile {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  dialog = createDialog({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
  });
}
```

```html
<button :ref="trigger" :spread="dialog.triggerProps()" :click="dialog.open()">Delete</button>

<div :if="dialog.isPresent()" :portal :ref="content" :spread="dialog.contentProps()">
  <h2 :spread="dialog.titleProps()">Delete this file?</h2>
  <p :spread="dialog.descriptionProps()">This cannot be undone.</p>
  <button :click="dialog.close()">Cancel</button>
</div>
```

### What modal means

With `modal` left on, opening the dialog does three things, and closing it
undoes them in reverse:

- **Focus moves in and stays in.** The first focusable element inside takes
  focus — the content itself, if there is none — and focus that lands
  anywhere outside is pulled back. When it closes, focus goes back to whatever
  held it before, if that is still in the document. See
  [`createFocusScope`](#createfocusscope).
- **The rest of the page is inert.** Every other child of `<body>` gets
  `inert` and `aria-hidden="true"`: out of the tab order, deaf to the pointer,
  and hidden from a screen reader's own cursor, which a focus trap alone does
  not reach. A child carrying `aria-live` is left alone so it can keep
  announcing, and so is a toaster's region: it is not a live region itself and
  holds none until a toast arrives, so it says what it is with a
  `data-volt-toaster` marker (`TOASTER_ATTRIBUTE`) instead. Both have to be
  children of `<body>` to be spared — a region left inside the application's
  root goes inert with the root.
- **The page stops scrolling.** `overflow: hidden` goes on `<body>`, with
  right padding the width of the scrollbar that disappears so the page does
  not shift sideways. Locks are counted, so an inner dialog closing does not
  release an outer one's — and only the first lock pads, since by the second
  there is no scrollbar left to measure. That width is read in the measure
  lane, which drains before user effects, so taking the lock shares the
  flush's one layout instead of forcing another — see
  [effects](./reactivity#effects).

`modal: false` drops all three, and with them any focus handling at all: a
non-modal dialog does not move focus in and does not put it back. Escape and
a press outside still close it.

A popover, a menu or a second dialog opened from inside a modal one keeps
focus and stays open — see
[opening one layer from another](#opening-one-layer-from-another).

### Naming

`aria-labelledby` and `aria-describedby` are written only when an element with
the title's or description's id was actually found inside the content.
Pointing at an id that does not exist is worse than pointing at nothing: an
unlabelled dialog is announced as unlabelled either way, but a dangling
reference hides the fact that the label is missing. The check runs once, when
the dialog opens — a title rendered later under its own `:if` is not noticed.

### What a dialog does not do

- **Choose where focus starts.** There is no `initialFocus`. A confirmation
  that should land on Cancel rather than on the destructive button has to put
  Cancel first in the markup.
- **Use the top layer.** It is not `<dialog>`. Stacking above the page is
  `z-index`, which is yours.
- **Make inert what shares its parent.** Only the other children of `<body>`
  are touched, which is why the dialog has to be portalled. Anything portalled
  to `<body>` *after* it opened — a popover from inside it — is left live,
  or it could not be pressed at all.

## Anchoring a panel to a control: `createPopover`

```ts
createPopover(options: PopoverOptions): Popover
```

Non-modal by default: focus moves in, but the page behind stays live,
scrollable and readable. That is the difference between a popover and a
dialog, and it is a difference of behaviour rather than appearance.

| Option | Default | Description |
|---|---|---|
| `content` | — | The popover's content element, once rendered. Required |
| `trigger` | — | The element that opens it and the anchor it is placed against. Without one a press on the trigger counts as outside, the content is written a `position-anchor` that nothing carries, and Tab out of it is left to the browser |
| `open` | own state | A `Signal.State<boolean>` to control it from outside |
| `defaultOpen` | `false` | Initial state when it owns its own |
| `modal` | `false` | Trap focus and set `aria-modal` |
| `placement` | `'bottom'` | Which side of the trigger, and how it lines up |
| `offset` | — | The gap to the trigger. A number is pixels, a string any CSS length |
| `flip` | `true` | Let the browser try the opposite side when this one would overflow |
| `shift` | `true` | Let the browser try another alignment on the same side when this one would overflow |
| `closeOnEscape` | `true` | Escape closes it |
| `closeOnOutsidePointer` | `true` | A press outside closes it |
| `closeOnFocusOutside` | `true` | Focus landing outside closes it. Non-modal only |
| `autoFocus` | `true` | Move focus in when it opens |
| `restoreFocus` | `true` | Put focus back when it closes |
| `initialFocus` | — | What to focus first, instead of the first focusable element |
| `labels.content` | — | A name for the popover, used only when no title is rendered |
| `labels.close` | the locale's `close`, else `'Close'` | The close button's accessible name |
| `onOpenChange` | — | Called with the new state when the popover changes it |

| Member | Description |
|---|---|
| `isOpen()` / `isPresent()` / `state()` | See [the shape they share](#the-shape-they-share) |
| `placement()` | The placement asked for — see [anchoring](#createanchor) for why not the one in use |
| `anchorName()` | The trigger's `anchor-name`, for CSS that positions something else against it |
| `open()` / `close()` / `toggle()` | Change the state |
| `triggerProps()` | ARIA, the anchor name, and click and keydown handlers |
| `contentProps()` | `role="dialog"`, naming, positioning, and a keydown handler for Tab |
| `titleProps()` / `descriptionProps()` | Ids for the heading and the description |
| `closeProps()` | `type="button"`, an `aria-label`, and a click handler |
| `arrowProps()` | For a decorative arrow inside the content |

```ts
import { Signal } from '@voltdev/core';
import { createPopover } from '@voltdev/primitives';

class Filters {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  popover = createPopover({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
    placement: 'bottom-start',
    offset: 4,
    labels: { close: 'Close filters' },
  });
}
```

```html
<button :ref="trigger" :spread="popover.triggerProps()">Filters</button>

<div :if="popover.isPresent()" :portal :ref="content" :spread="popover.contentProps()">
  <h2 :spread="popover.titleProps()">Filters</h2>
  <button :spread="popover.closeProps()">✕</button>
  …
</div>
```

### Keyboard

| Key | Where | Does |
|---|---|---|
| Enter, Space | trigger | Toggle. On a `<button>` the browser's own click does it, and the handler stands aside so it does not happen twice |
| Tab | last element in the content | Close, and move focus to whatever follows the trigger |
| Shift+Tab | first element in the content | Close, and move focus to the trigger |
| Escape | anywhere | Close the topmost layer — see [`createDismiss`](#createdismiss) |

The content is normally portalled to the end of `<body>`, so the browser's
own tab order would carry focus from the popover's last element to whatever
happens to follow the portal. Tabbing out is therefore handled, and lands
either side of the trigger instead. A modal popover leaves Tab to its focus
trap.

### Focus

A non-modal popover moves focus in on open — to `initialFocus`, else the first
focusable element, else the content — and, unless `closeOnFocusOutside` is
off, closes when focus lands anywhere that is not the content or the trigger.
That is what stops one being left open and forgotten behind the field the
user has since tabbed to.

On close it puts focus back only if the popover still held it, or if it was
dropped on `<body>` when the content went. A user who has moved on to another
field is left there.

Focus in a layer opened from inside the popover — a second popover, a menu —
is focus inside it, so opening one does not close the one it came from. See
[opening one layer from another](#opening-one-layer-from-another).

`modal: true` swaps that for [`createFocusScope`](#createfocusscope)'s trap,
and nothing more. It does not make the page inert or lock scrolling — a layer
that needs the page switched off is a dialog — so `aria-modal` on a popover is
a claim about focus, not about the whole document.

### ARIA

The trigger gets `aria-haspopup="dialog"`, `aria-expanded`, and
`aria-controls` only while the popover is open, since a reference to content
that is not there sends a screen reader looking for nothing. A trigger that is
not a `<button>`, `<input>`, `<summary>` or a link with an `href` is also given
`role="button"` and `tabindex="0"`; the handlers in the props then give it the
keyboard a button would have had.

The content is `role="dialog"` with `tabindex="-1"`, named by the rendered
title, else by `labels.content`, and described by the rendered description.

### Positioning

The placement is [`createAnchor`](#createanchor): `anchor-name` on the
trigger, `position-anchor`, `position-area` and `position-try-fallbacks` on
the content, written inline. Nothing measures and nothing listens for scroll.
`offset` is written as a margin on the side facing the trigger, which follows
the popover across a flip; a gap written in your own CSS stays on the side you
wrote it on.

`arrowProps()` is not the anchor's arrow. It carries `data-placement`,
`data-align`, `aria-hidden` and the anchor name, but no `position-area`: it is
meant to be a child of the content, drawn against the content's own edge by
your CSS from `data-placement`, and an inline `position-area` would lift it out
of that box. `data-align` is the physical edge an aligned popover lines up with
— `left`, `right`, `top` or `bottom`, and absent for a centred placement —
resolved against the trigger's writing direction, which a popover portalled to
`<body>` does not inherit. Style the arrow's offset along the edge from that
rather than from the `-start` or `-end` in `data-placement`.

### What a popover does not do

- **Take the other anchor options.** Only `placement`, `offset`, `flip` and
  `shift` reach [`createAnchor`](#createanchor) from here, and `strategy` is
  always `absolute`, so content that is itself in the top layer — an element
  with the `popover` attribute — has the browser's `position: fixed`
  overridden.
- **Move.** The placement is fixed for the popover's life; there is no
  `setPlacement` on it.

## Describing a control: `createTooltip`

```ts
createTooltip(options: TooltipOptions): Tooltip
```

| Option | Default | Description |
|---|---|---|
| `content` | — | The tooltip's content element, once rendered. Required |
| `trigger` | — | The element it describes, and the anchor it is positioned against |
| `open` | own state | A `Signal.State<boolean>` to control it from outside |
| `defaultOpen` | `false` | Initial state when it owns its own |
| `openDelay` | `700` | How long the pointer rests on the trigger before it opens, in ms |
| `closeDelay` | `300` | How long it lingers after the pointer leaves, in ms |
| `skipDelay` | `300` | How long after a tooltip closes the next still opens at once, in ms. `0` gives no window after this one closes |
| `label` | — | An accessible name for the trigger, when the tooltip's text is the only name it has |
| `placement` | `'top'` | The one side a pointer resting on the trigger cannot cover |
| `offset` | — | The gap to the trigger |
| `flip` | `true` | Let the browser flip it when it would overflow |
| `closeOnEscape` | `true` | Escape closes it |
| `onOpenChange` | — | Called with the new state when the tooltip changes it |

| Member | Description |
|---|---|
| `isOpen()` / `isPresent()` / `state()` | See [the shape they share](#the-shape-they-share) |
| `anchorName()` / `placement()` | As on the popover |
| `open()` / `close()` | Now, ignoring the delays |
| `triggerProps()` | `aria-describedby`, `aria-label`, the anchor name, pointer and focus handlers |
| `contentProps()` | `role="tooltip"`, the id, `data-state`, positioning, pointer handlers |

```ts
import { Signal } from '@voltdev/core';
import { createTooltip } from '@voltdev/primitives';

class DeleteButton {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  tip = createTooltip({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
    label: 'Delete permanently',
  });
}
```

```html
<button :ref="trigger" :spread="tip.triggerProps()"><svg>…</svg></button>
<div :if="tip.isPresent()" :portal :ref="content" :spread="tip.contentProps()">
  Delete permanently
</div>
```

### When it opens and closes

It opens on hover **and** on keyboard focus. Hover alone would put the text
behind a pointer, and the keyboard and screen-reader user is the one the
description was written for.

| Event | Does |
|---|---|
| Pointer enters the trigger | Opens `openDelay` later if it has not left — or at once, inside the skip window |
| Keyboard focus on the trigger | Opens at once. A Tab press is not a pointer passing by |
| Pointer leaves trigger and content | Closes after `closeDelay` |
| Pointer moves from the trigger straight onto the content | Stays open, at any `closeDelay`, so a long description can be read. Across a gap — an `offset` is one — only `closeDelay` carries it |
| Press on the trigger | Closes, and stays shut until the pointer leaves and comes back |
| Blur | Closes, unless the pointer is still over it |
| Escape | Closes, if it is the topmost layer |

Keyboard focus is told apart from focus that came with a press by
`:focus-visible` and by the press itself, so clicking a button does not show
its tooltip over whatever the click opened. Touch is ignored entirely: the
hover a tap emulates never leaves, and the tooltip would sit over whatever
had been tapped. After Escape it stays shut while the pointer rests where it is,
and opens again once the pointer leaves and comes back.

The crossing onto the content is recognised from where the pointer went — the
leave event's `relatedTarget` — rather than from a timer. That is what makes it
safe with `closeDelay: 0`, and it is also why it needs the two to touch: a
margin is not part of the element it belongs to, so a pointer in the gap is
over the page, and a zero delay closes the tooltip before it arrives.

Open, it is a layer like any other on the [dismissal](#createdismiss) stack.
With a tooltip showing inside a dialog, the first Escape — or the first press
outside both — closes the tooltip, and the dialog needs a second. With
`closeOnEscape: false` it stays on that stack all the same, but it has said
the key is not its own, so Escape goes to the dialog beneath it instead.

**The skip window is global.** Once one tooltip has opened, the next opens
without its delay, and that lasts until `skipDelay` after the last one
closed — so moving along a toolbar is not a full delay per button. It is
module state on purpose, because the group spans components that know nothing
of each other. The cost is that every tooltip on the page shares it, and a
caller who wants an isolated group cannot have one. `resetTooltipDelayGroup()`
forgets that any tooltip has been open, and is there so that one test's
tooltips do not shorten the next test's delays. It starts a fresh group, so a
tooltip that was open when it was called is forgotten with the rest: closing
afterwards it neither takes the new count below zero nor warms the window.

### ARIA

The tooltip *describes* its trigger: `aria-describedby` points at it for as
long as it is present, exit animation included. When its text is the
trigger's only name — the icon-button case — pass the same text as `label`.
A described but unnamed button is announced as "button", and some screen
readers skip descriptions by default.

### What a tooltip does not do

- **Take focus.** A tooltip holds nothing interactive, and one with a link or
  a button in it is a popover.
- **Make its trigger focusable.** A tooltip on a bare `<span>` is unreachable
  from the keyboard, and no ARIA attribute fixes that.
- **Respond to touch.** There is no long-press or tap-to-show; on a touch
  screen the description is reachable only as the trigger's
  `aria-describedby`, while something else has opened it.
- **Exist while closed.** The content is under an `:if` and `aria-describedby`
  is written only while it is present, so a screen reader that reaches the
  trigger without moving focus to it — a reading cursor rather than Tab —
  finds no description to read.
- **Keep a group of its own.** See the skip window, above.

## A list of actions: `createMenu`

```ts
createMenu(options: MenuOptions): Menu
```

One primitive for a dropdown menu and a context menu. They differ in two
ways only: a dropdown hangs off a trigger and borrows its name; a context menu
opens at the pointer, has no trigger, and needs a name of its own.

| Option | Default | Description |
|---|---|---|
| `content` | — | The menu element, once rendered. Required |
| `trigger` | — | The element that opens it and names it. Omit it for a context menu |
| `open` | own state | A `Signal.State<boolean>` to control it from outside |
| `defaultOpen` | `false` | Initial state when it owns its own |
| `placement` | `'bottom-start'` | Which side of the trigger. Ignored by a context menu |
| `offset` | — | The gap to the trigger |
| `flip` | `true` | Let the browser flip it when it would overflow |
| `orientation` | `'vertical'` | Which arrow keys move: `'vertical'`, `'horizontal'` or `'both'` |
| `loop` | `true` | Arrow keys wrap past the ends |
| `typeahead` | `true` | Typing letters jumps to a matching item |
| `typeaheadTimeout` | `500` | How long typed characters accumulate, in ms |
| `closeOnEscape` | `true` | Escape closes it |
| `closeOnOutsidePointer` | `true` | A press outside closes it |
| `closeOnSelect` | `true` | Choosing an item closes it |
| `labels.menu` | the locale's `menu`, else `'Menu'` | The menu's name when no trigger names it |
| `onOpenChange` | — | Called with the new state when the menu changes it |
| `onSelect` | — | `(item, value)` — the chosen element and the `value` its props were given |

| Member | Description |
|---|---|
| `isOpen()` / `isPresent()` / `state()` | See [the shape they share](#the-shape-they-share) |
| `position()` | Where a context menu was opened, in viewport coordinates, or `null` |
| `activeItem()` | The item holding focus, for styling the highlight |
| `anchorName()` / `placement()` | As on the popover |
| `open(focus?)` | Open, with focus on the `'first'` item, the `'last'`, or `'none'` — the menu itself, the default |
| `close()` | Close |
| `toggle()` | Open with focus on the menu itself, or close |
| `focusItem(item)` | Focus an item and make it the one the arrows move on from |
| `select(item)` | Choose an item: report it, and close unless it says otherwise |
| `onTriggerKeyDown(event)` | Bind to the trigger's `:keydown` |
| `onContentKeyDown(event)` | Bind to the content's `:keydown` |
| `onContextMenu(event)` | Bind to the area's `:contextmenu` |
| `onItemClick(event)` | Bind to the content's `:click` |
| `onItemPointerMove(event)` | Bind to the content's `:pointermove` |
| `triggerProps()` | `id`, `aria-haspopup="menu"`, `aria-expanded`, `aria-controls` while open, `data-state`, the anchor name |
| `contentProps()` | `id`, `role="menu"`, the name, `aria-orientation` when horizontal, `data-state`, `tabindex="-1"`, positioning for a dropdown |
| `itemProps(options?)` | For each item — see below |
| `separatorProps()` | `role="separator"`, and `aria-orientation="vertical"` in a horizontal menu |

`itemProps` takes the item's own options:

| Option | Default | Description |
|---|---|---|
| `value` | — | Passed to `onSelect`, so a loop of items needs no wiring of its own |
| `role` | `'menuitem'` | Or `'menuitemcheckbox'`, `'menuitemradio'` |
| `checked` | `false` | For the checkbox and radio roles; `'mixed'` is part-checked |
| `disabled` | `false` | Skipped by the arrows, still announced |
| `textValue` | — | What typeahead matches, when the visible text is not what anyone would type |
| `closeOnSelect` | the menu's | Overrides the menu's `closeOnSelect` for this item |

```ts
import { Signal } from '@voltdev/core';
import { createMenu } from '@voltdev/primitives';

class FileActions {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  menu = createMenu({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
    onSelect: (_item, value) => this.run(value),
  });

  run(action: string | undefined) {
    console.log(action);
  }
}
```

```html
<button :ref="trigger" :spread="menu.triggerProps()"
        :click="menu.toggle()" :keydown="menu.onTriggerKeyDown($event)">Actions</button>

<div :if="menu.isPresent()" :portal :ref="content" :spread="menu.contentProps()"
     :keydown="menu.onContentKeyDown($event)"
     :click="menu.onItemClick($event)"
     :pointermove="menu.onItemPointerMove($event)">
  <button :spread="menu.itemProps({ value: 'rename' })">Rename</button>
  <div :spread="menu.separatorProps()"></div>
  <button :spread="menu.itemProps({ value: 'delete', disabled: true })">Delete</button>
</div>
```

The content's handlers find the item from the event's target, so binding them
once on the menu covers every item — including items rendered from a `:for`,
which cannot each hold a `:ref`.

### Keyboard

The WAI-ARIA menu button and menu patterns:

| Key | Where | Does |
|---|---|---|
| Enter, Space, ArrowDown | trigger | Open with the first item focused |
| ArrowUp | trigger | Open with the last item focused |
| ArrowDown, ArrowUp | menu | Next, previous — wrapping unless `loop: false`. Not when `orientation` is `'horizontal'` |
| ArrowRight, ArrowLeft | menu | The same, when `orientation` is `'horizontal'` or `'both'`. Mirrored under `dir="rtl"` — see below |
| Home, End | menu | First, last |
| Printable characters | menu | Typeahead. Repeating one letter walks the items starting with it |
| Enter, Space | menu | Choose the focused item |
| Escape | menu | Close; focus goes back to where it was when the menu opened — ordinarily the trigger |
| Tab | menu | Close, and let the browser carry on from there |

A key held with Ctrl, Alt or Meta is left alone everywhere: it is a shortcut,
not an instruction to the menu. Disabled items are skipped by the arrows,
Home, End and typeahead alike. Opened by a click, the menu focuses itself
rather than its first item, because highlighting an item would claim a choice
nobody has made; ArrowDown then lands on the first item and ArrowUp on the
last, and Enter and Space do nothing until an item is focused.

The left-right mirroring is read from the element the key was bound on — the
menu itself — not from the trigger. A portalled menu sits under `<body>`, so
a horizontal menu opened from an RTL region of an LTR page is not mirrored,
though its position is: [anchoring](#createanchor) reads the trigger.

### A context menu

Leave `trigger` out and open it from the area:

```ts
import { Signal } from '@voltdev/core';
import { createMenu } from '@voltdev/primitives';

class Canvas {
  content = new Signal.State<Element | null>(null);
  menu = createMenu({
    content: () => this.content.get(),
    labels: { menu: 'Canvas actions' },
  });

  at() {
    const p = this.menu.position();
    return p ? { position: 'fixed', left: `${p.x}px`, top: `${p.y}px` } : {};
  }
}
```

```html
<div :contextmenu="menu.onContextMenu($event)">…</div>

<div :if="menu.isPresent()" :portal :ref="content" :spread="menu.contentProps()"
     :style="at()" :keydown="menu.onContentKeyDown($event)" :click="menu.onItemClick($event)">
  …
</div>
```

`onContextMenu` suppresses the platform's own menu and records the pointer.
The area is not a trigger: it gets no `aria-expanded`, and a press on it
dismisses the menu like a press anywhere else. Where that position turns into
pixels is yours — a context menu is not anchored, and nothing stops it running
off the edge of the window.

A `contextmenu` event that arrives while the menu is open moves it rather
than reopening it — a second right-click, and what the keyboard's
context-menu key and Shift+F10 produce alike. A right-click is also a press,
and the area is outside the menu, so where the platform asks as the button
goes down (macOS, Linux) the release would otherwise dismiss the menu the
press had just moved. Asking for the menu spends the press: the release that
follows ends without dismissing anything, and the next press outside closes
the menu as usual. Where the platform asks once the button is up (Windows),
the menu closes on the press and opens again at the new point.

### Focus

Focus is trapped inside an open menu, because every deliberate way out —
Escape, Tab, choosing an item, a press outside — closes it first. A menu
opened from inside a modal dialog keeps its own focus and its own arrow keys;
see [opening one layer from another](#opening-one-layer-from-another).

The cost is one real case: a press on a text field elsewhere on the page
closes the menu but does not focus the field, because the trap is still live
when the browser moves focus and only lets go at pointer-up. That field takes
a second click.
The alternative is focus escaping a menu that is still open, stranding a
keyboard user behind an overlay they cannot see.

### What a menu does not do

- **Submenus.** `placement: 'right-start'` positions a second menu beside an
  item, but there is no ArrowRight to open it, no ArrowLeft to come back, and
  the parent's focus trap does not know the child exists.
- **Checked state.** `checked` is written as `aria-checked`, and that is all.
  Toggling it in `onSelect` is yours, and so is keeping one radio item checked
  per group — there is no `role="group"` and no grouping.
- **Placing a context menu.** See above.

## Notifications: `createToaster`

```ts
createToaster<T = unknown>(options: ToasterOptions<T>): Toaster<T>
```

A queue of transient notifications, announced without taking focus. `T` is
whatever you want each toast to carry — a title, a message, an action.

| Option | Default | Description |
|---|---|---|
| `region` | — | The element the toasts are rendered into, once it exists. Required |
| `toasts` | own queue | A `Signal.State<Toast<T>[]>` to hold the queue from outside — two regions sharing one store. An entry removed by hand skips its exit animation |
| `max` | `3` | How many are on screen at once. The rest wait their turn |
| `duration` | `5000` | Default lifetime, in ms |
| `hotkey` | `'F6'` | The key that moves focus to the region, matched with no modifier held; or a predicate |
| `labels.region` | the locale's `notifications`, else `'Notifications'` | The region's accessible name |
| `labels.close` | the locale's `closeNotification`, else `'Close notification'` | A close button's accessible name |
| `onDismiss` | — | `(toast, reason)` — `'timeout'` for its own clock, `'api'` for a call |

| Member | Description |
|---|---|
| `toasts()` | Everything live, oldest first — on screen and waiting alike |
| `visible()` | The ones to render now — the first `max` |
| `queued()` | The ones waiting for a slot |
| `isPaused()` | Whether the countdowns are held |
| `add(data, options?)` | Raise a toast and return its id |
| `update(id, data, options?)` | Replace a toast's contents. `false` when it has already gone |
| `dismiss(id)` / `dismissAll()` | Take one or all away |
| `focusRegion()` | Move focus to the region, as the hotkey does |
| `regionProps()` | `role="region"`, `aria-label`, `tabindex="-1"`, `data-paused`, and the `data-volt-toaster` marker |
| `toastProps(toast)` | `id`, `role`, `aria-live`, `aria-atomic`, `data-state`, `data-type` |
| `closeProps()` | `aria-label` only |

`add` and `update` take the same options:

| Option | Default | Description |
|---|---|---|
| `id` | generated | Reuse an id and `add` updates that toast rather than raising a second |
| `type` | `'info'` | `'info'`, `'success'`, `'warning'` or `'error'` |
| `priority` | from `type` | `'polite'`, or `'assertive'` — which `error` implies |
| `duration` | the toaster's | Milliseconds on screen. `0` or `Infinity` keeps it until dismissed |

Each `Toast<T>` has a readonly `id` and `data()`, `type()`, `priority()`,
`duration()`, `isOpen()`, `isPresent()`, `state()` and `dismiss()`. `data()` is
reactive, so `update` re-renders it in place.

```ts
import { Signal } from '@voltdev/core';
import { createToaster } from '@voltdev/primitives';

class Shell {
  region = new Signal.State<Element | null>(null);
  toaster = createToaster<{ title: string }>({
    region: () => this.region.get(),
  });

  saved() {
    this.toaster.add({ title: 'Saved' }, { type: 'success' });
  }
}
```

```html
<div :portal :ref="region" :spread="toaster.regionProps()">
  <div :for="toast in toaster.visible()" :key="toast.id" :spread="toaster.toastProps(toast)">
    <p>{ toast.data().title }</p>
    <button :spread="toaster.closeProps()" :click="toast.dismiss()">×</button>
  </div>
</div>
```

There is no `:if` on a toast. A dismissed toast stays in the queue, marked
`closed`, until its exit animation has run, and the `:for` removes it when
the queue lets it go. Render the region itself unconditionally: it is what
the pointer and focus pauses listen on, and what the hotkey moves focus to.

Portal it too. A modal dialog makes every other child of `<body>` inert, and
spares a toaster's region only when the region is one of those children, which
is what `:portal` makes it. Left inside the application's root, it goes inert
with the root, and a toast raised while the dialog is open is never heard.

### Announcement

Each toast is its own live region — `role="status"` with `aria-live="polite"`,
or `role="alert"` with `aria-live="assertive"` for errors — with
`aria-atomic="true"`, so the whole message is read on every change rather
than the words that changed. A screen reader reads it where the user already
is. Focus is never moved to announce one, because that would interrupt
whatever they were typing.

There is deliberately no `aria-labelledby` on a toast: a name on a live region
is announced *instead of* its contents by some screen readers.

The cost of a region per toast is that each one arrives with its words
already in it. Screen readers are more consistent about announcing a change
inside a live region that was on the page beforehand than about a region
that appears fully formed, and there is no standing region here for toasts
to speak through.

### Timing

A toast counts down only while it can be read: while it is among the visible
ones, and not while the pointer is over the region, focus is inside it, or the
document is hidden. A toast that expires in a background tab was never seen.
The countdown is held rather than restarted, so a pointer that keeps crossing
the region does not keep a toast up for ever.

`update` restarts the countdown, because new words need their own reading
time, and an update that lands during the exit animation brings the toast
back. That is what reusing an id is for — one notification that becomes its
result:

```ts
import { createToaster } from '@voltdev/primitives';

declare const toaster: ReturnType<typeof createToaster<{ title: string }>>;
declare function upload(): Promise<void>;

const id = toaster.add({ title: 'Uploading…' }, { duration: Infinity });
upload().then(
  () => toaster.update(id, { title: 'Uploaded' }, { type: 'success', duration: 4000 }),
  () => toaster.update(id, { title: 'Upload failed' }, { type: 'error' }),
);
```

An `update` that gives a toast with no end — `0` or `Infinity` — a finite
duration starts the clock on it, so the "Uploaded" toast leaves on its own
four seconds later. An `update` that names no duration leaves the toast the
one it already had: the "Upload failed" branch keeps the `Infinity` it was
raised with and stays until it is dismissed, which is what a failure the user
has to do something about wants. Either way the countdown is held while the
pointer or focus is on the region, as any other toast's is.

### Keyboard

Nothing links to a toast, so without a key the actions inside one are
unreachable from the keyboard. The hotkey — F6 by default — moves focus to the
region when there is something visible in it, and Escape from inside the
region puts focus back where it came from. When a toast holding focus is
dismissed, focus moves to the region if others remain, and back to where the
hotkey found it if not, rather than falling to `<body>`.

Where it came from is recorded only by the hotkey and by `focusRegion()`, and
forgotten as soon as focus leaves the region by any other route. Focus that
reached a toast by a click or by Tab has no origin, so Escape there does
nothing, and when the last toast goes focus does fall to `<body>`.

### What a toaster does not do

- **Swipe to dismiss.** That belongs with gesture support, which is not here.
- **Wire the close button.** `closeProps()` is a name and nothing else — no
  handler and no `type="button"`, unlike the popover's.
- **Check that an id is unique.** A toast's DOM `id` is the id it was added
  with, and nothing stops the page carrying that id elsewhere too. The search
  for a toast's element runs from the region rather than over the document, so
  an id used elsewhere costs this toast nothing — but two elements answering
  to one id is still markup a validator will refuse.

## Expanding a section: `createCollapsible` and `createAccordion`

### `createCollapsible`

```ts
createCollapsible(options: CollapsibleOptions): Collapsible
```

| Option | Default | Description |
|---|---|---|
| `content` | — | The content element, once rendered. Required |
| `open` | own state | A `Signal.State<boolean>` to control it from outside |
| `defaultOpen` | `false` | Initial state when it owns its own |
| `disabled` | — | `() => boolean`. While true, `open`, `close` and `toggle` refuse |
| `region` | `false` | Give the content `role="region"` |
| `labels.content` | — | A name for the content; unset, it is labelled by its trigger |
| `onOpenChange` | — | Called with the new state when it changes it |

| Member | Description |
|---|---|
| `isOpen()` / `isPresent()` / `state()` | See [the shape they share](#the-shape-they-share) |
| `isDisabled()` | Whether `disabled` says so |
| `open()` / `close()` / `toggle()` | Change the state, unless disabled |
| `triggerProps()` | `id`, `type="button"`, `aria-expanded`, `aria-controls` while present, `aria-disabled` and `data-disabled` while disabled, `data-state` |
| `contentProps()` | `id`, `aria-labelledby` or `aria-label`, `role="region"` when asked for, `data-state`, `data-disabled`, the measured height as a `style` |

```ts
import { Signal } from '@voltdev/core';
import { createCollapsible } from '@voltdev/primitives';

class Details {
  content = new Signal.State<Element | null>(null);
  more = createCollapsible({ content: () => this.content.get() });
}
```

```html
<button :spread="more.triggerProps()" :click="more.toggle()">Details</button>
<div :if="more.isPresent()" :ref="content" :spread="more.contentProps()">…</div>
```

`disabled` is enforced by the methods rather than by the trigger, so a
consumer who wires the trigger by hand cannot forget it. A caller that has to
move a disabled section anyway writes to its own `open` signal.

A lone disclosure is not a landmark by default: landmarks that name nothing
in particular make the landmark list harder to use, not easier.

### Animating the height

The one thing every collapsible wants to animate is the one thing CSS cannot:
`height: auto` has no number to interpolate from. So the panel's height is
measured when it appears and whenever it resizes, and published on the
content as `--volt-collapsible-height` (exported as
`COLLAPSIBLE_HEIGHT_PROPERTY`):

```css
[data-state='open']   { animation: expand   150ms ease-out; }
[data-state='closed'] { animation: collapse 150ms ease-out; }

@keyframes expand   { from { height: 0 } to { height: var(--volt-collapsible-height) } }
@keyframes collapse { from { height: var(--volt-collapsible-height) } to { height: 0 } }
```

It is read from `measureEffect`, so it shares the flush's one layout with
everything else measuring — see [effects](./reactivity#effects) — and nothing
measures per frame. It is `scrollHeight`, the natural height even while the
box is clipped to nothing, which is the distance the animation has to travel;
the cost is that it is a whole number, so a fractional layout can lose up to a
pixel at the end. Where there is no `ResizeObserver`, the last measurement
stands.

### `createAccordion`

```ts
createAccordion(options: AccordionOptions): Accordion
```

Several collapsibles sharing one piece of state, with the keyboard the
pattern asks for between the headers.

| Option | Default | Description |
|---|---|---|
| `container` | — | The element the headers live in; their order is read from it. Required |
| `type` | `'single'` | One panel open at a time, or `'multiple'` |
| `value` | own state | A `Signal.State<string[]>` of open panels — a list even for a single accordion |
| `defaultValue` | `[]` | Initial open panels when it owns its own |
| `collapsible` | `false` | Let a single accordion close its last open panel |
| `disabled` | — | `(value) => boolean` — which panels cannot be toggled |
| `orientation` | `'vertical'` | Which arrows move between headers |
| `loop` | `true` | Wrap past the first and last header |
| `region` | `true` | Give each panel `role="region"` |
| `labels.content` | — | `(value) => string \| undefined` — a name for one panel |
| `onValueChange` | — | Called with the new list when it changes it |

| Member | Description |
|---|---|
| `value()` | The open panels, in the order they were opened |
| `isOpen(value)` / `isPresent(value)` / `state(value)` | Per panel |
| `isDisabled(value)` | Whether `disabled` says so |
| `open(value)` / `close(value)` / `toggle(value)` | Change one panel |
| `onTriggerKeyDown(event)` | Bind on the container; returns whether it handled the key |
| `rootProps()` | `data-orientation` |
| `itemProps(value)` | `data-state`, `data-disabled`, `data-orientation` |
| `triggerProps(value)` | The collapsible's trigger props, plus `data-volt-accordion-trigger` with the value, and a marker of this accordion's own |
| `contentProps(value)` | The collapsible's content props |

```ts
import { Signal } from '@voltdev/core';
import { createAccordion } from '@voltdev/primitives';

class Faq {
  root = new Signal.State<Element | null>(null);
  sections = [
    { id: 'billing', title: 'Billing', body: '…' },
    { id: 'refunds', title: 'Refunds', body: '…' },
  ];
  faq = createAccordion({ container: () => this.root.get(), collapsible: true });
}
```

```html
<div :ref="root" :spread="faq.rootProps()" :keydown="faq.onTriggerKeyDown($event)">
  <div :for="s in sections" :key="s.id" :spread="faq.itemProps(s.id)">
    <h3>
      <button :spread="faq.triggerProps(s.id)" :click="faq.toggle(s.id)">{ s.title }</button>
    </h3>
    <div :if="faq.isPresent(s.id)" :spread="faq.contentProps(s.id)">{ s.body }</div>
  </div>
</div>
```

The panels need no `:ref`: they are found by the ids their props carry, since
twenty panels would otherwise need twenty refs threaded through the template.

The headers must be buttons inside headings. The heading level is how a
screen-reader user skims the list, and the button gives Enter and Space for
free — which is why the key handler leaves those two alone.

| Key | Does |
|---|---|
| ArrowDown, ArrowUp | Next, previous header — ArrowRight and ArrowLeft when horizontal |
| Home, End | First, last header |
| Enter, Space | Left to the button's own click |
| Tab | The page's own tab order: every header is a tab stop |

Every header stays in the tab sequence, and there is no typeahead. An
accordion is part of the document's reading order rather than one composite
widget, so the arrows are an addition to Tab rather than the only way
through. A disabled header is reachable both ways, so the two orders never
disagree about which headers exist. A key pressed inside a panel — an arrow
in a text field there — is left alone.

**An accordion in a panel.** Each accordion moves between its own headers and
no others. `data-volt-accordion-trigger` (`ACCORDION_TRIGGER_ATTRIBUTE`) is on
every header of every accordion, so each one also marks its headers with an
attribute it generates and reads only that. The outer one's arrow keys pass
over the inner one's headers, and a key pressed on an inner header is the
inner one's alone.

**The panel that cannot close.** In a single accordion without
`collapsible`, the open panel's header reports `aria-disabled="true"`, as the
pattern asks, because pressing it does nothing. It is not given
`data-disabled` — it is not greyed out, it is the panel being read. The cost
of that default is that a user who opened a panel cannot get back to a fully
collapsed list, which is why `collapsible` is worth turning on when the
panels are long.

**Regions.** Each panel is a landmark by default, as the pattern recommends.
Past roughly six panels they crowd out every other landmark on the page, and
`region: false` is the fix.

### What neither does

- Closed content is not in the document, because presence works by keeping
  an `:if` true and then letting it go. The browser's find-in-page cannot
  reach it, and a fragment link cannot open it.
- A value that disappears from the list keeps its panel — its presence and its
  height measurement, three signals and two effects — until the accordion
  itself goes. Panels get a scope of their own so that a re-render does not
  abandon one mid-animation, and that is the price.

## Opening one layer from another

Dismissal understands nesting. Every layer goes on one shared stack, so one
Escape closes one layer, and a press inside a popover opened from a dialog is
not a press outside the dialog, though once portalled the popover is not its
descendant. A tooltip nests anywhere, because it never takes focus.

Focus reads the same stack. A focus scope, and the popover's focus-outside
rule, each count the layers registered above their own as inside it, so focus
moving into a layer opened from within one has not left the one it came from:

| Combination | What happens |
|---|---|
| A popover, from inside a popover | Both stay open while focus is in the inner one. Escape closes the inner and hands focus back to the outer; a second closes the outer |
| A popover, from inside a modal dialog | It opens, takes focus and keeps it; the dialog's trap counts it as inside itself, and has the focus back when it closes |
| A menu, from inside a modal dialog | It opens with focus and arrow keys of its own, and hands focus back into the dialog when it closes |
| A dialog, from inside a dialog | The inner one traps focus and gives it back to the outer; the scroll lock is counted, so only the last close releases it |

Two things make that work. A layer's containment is its own subtree plus every
layer stacked above it, which is what stops two traps pulling focus in
opposite directions. And a scope reads `initialFocus` untracked, so asking
which item a menu has active cannot make the step that opened the menu depend
on it — and re-run, re-focusing where it opened, at every arrow key.

Focus that goes somewhere else entirely still closes what it left behind:
both popovers, when the inner one was opened from the outer. A press on the
page behind closes one layer at a time, as for any stack — the inner one
first, handing focus back to its trigger inside the outer one, and the outer
one on the next press — unless the press lands on something focusable, which
takes focus out of both.

## The behaviours underneath

Each overlay above is these four, composed. Use them directly for a layer the
package does not have — a drawer, a command palette, a hover card.

### `createPresence`

```ts
createPresence(open: () => boolean, node: () => Element | null | undefined): Presence
```

| Member | Description |
|---|---|
| `isPresent()` | Whether the content should be in the DOM right now |
| `state()` | `'open'` or `'closed'`, for `data-state` |

```ts
import { Signal } from '@voltdev/core';
import { createPresence } from '@voltdev/primitives';

class Drawer {
  open = new Signal.State(false);
  panel = new Signal.State<Element | null>(null);
  presence = createPresence(
    () => this.open.get(),
    () => this.panel.get(),
  );
}
```

```html
<aside :if="presence.isPresent()" :ref="panel" :attr-data-state="presence.state()">…</aside>
```

`state()` is derived from `open` rather than held, so the element already
carries `data-state="closed"` by the time the close is acted on. Presence then
asks the element what `getAnimations()` reports running on it — which is
whatever the closed rule has just started — and keeps the node until all of
them have finished, not until the first does: a fade over 150ms and a slide
over 300ms are one exit. Nothing running means nothing to wait for and the
node goes at once — no exit declared, a `prefers-reduced-motion` rule turning
it off, an animation that closing does not start. CSS stays the only place a
duration is written, and a library that never animates pays nothing.

Asking what runs rather than what is declared is what makes that safe. A
`transition: color 150ms` kept on the element for a hover effect starts
nothing when closing changes no colour, and an `animation` written on the
element in every state finished long before the close and does not run again.
Neither sends an end event, and waiting on either would keep the node in the
page for good.

A cancelled animation settles too, so an exit interrupted for any reason still
lets the node go, and reopening during the exit cancels the wait. What it does
not do:

- **Wait for a child.** Only the element's own animations count, so a spinner
  inside a panel cannot end the panel's exit.
- **Wait for something with no end.** An animation that loops for ever in the
  closed state is a loop rather than an exit, so the node goes at once rather
  than never.

### `createDismiss`

```ts
createDismiss(
  node: () => Element | null | undefined,
  onDismiss: (reason: DismissReason) => void,
  options?: DismissOptions,
): void
```

| Option | Default | Description |
|---|---|---|
| `exclude` | — | `() => (Element \| null \| undefined)[]` — elements that count as inside, such as a trigger |
| `escape` | `true` | Escape dismisses this layer |
| `outsidePointer` | `true` | A press outside dismisses this layer |

`DismissReason` is `'escape'` or `'outside-pointer'`. `dismissStackSize()`
returns how many layers are registered, and is there for tests.

```ts
import { Signal, effect } from '@voltdev/core';
import { createDismiss } from '@voltdev/primitives';

class CommandPalette {
  open = new Signal.State(false);
  panel = new Signal.State<Element | null>(null);

  constructor() {
    effect(() => {
      if (!this.open.get()) return;
      createDismiss(() => this.panel.get(), () => this.open.set(false));
    });
  }
}
```

It registers the layer for as long as the calling scope lives — above, for as
long as the palette is open, since an effect clears its scope on every run.
It is on the stack from the moment of the call, not from when `node` first
answers, so called from a field initialiser it would sit there closed and take
the Escape meant for the layer below. Three rules, and they are where
hand-written dismissal usually goes wrong:

- **One layer responds — the topmost that takes it.** With a popover open
  inside a dialog, one Escape closes one layer. That needs a stack shared by
  every layer on the page, which is why it is module state rather than
  per-component. The same holds for the pointer: a press outside everything
  closes one layer, and the next press closes the one beneath. A layer
  registered with `escape: false` has said the key is not its own, so it is
  passed over and the layer beneath is asked; `outsidePointer: false` does the
  same for a press.
- **Outside is decided on pointer down and acted on at pointer up.** Both
  ends of the press have to be outside. Selecting text in a dialog and
  releasing past its edge does not dismiss it.
- **Layers above are inside.** A popover opened from a dialog is not outside
  the dialog, though once portalled it is not its descendant. The containment
  walk starts at the layer being asked and counts every layer above it, which
  is what keeps that true now that the layer asked need not be the top one.

A layer that has to keep Escape from everything under it — a dialog that will
not close until it is answered — takes the key and declines it in `onDismiss`
rather than turning it off. That is what the dialog, the popover and the menu
do with `closeOnEscape: false` and `closeOnOutsidePointer: false`: they stay
open, and nothing beneath them closes either. The tooltip does the opposite,
because it holds nothing of its own: its `closeOnEscape: false` lets the key
through to the layer it is showing in.

The listeners are on the document in the capture phase, so a handler in the
page that stops propagation cannot keep a layer open, and they are removed
when the last layer goes. "Topmost" means most recently registered — the
stack does not read `z-index` or the top layer.

Focus leaving a layer is not a dismissal reason here. The popover handles it
itself, because only a non-modal layer wants it.

### `createFocusScope`

```ts
createFocusScope(node: () => Element | null | undefined, options?: FocusScopeOptions): void
```

| Option | Default | Description |
|---|---|---|
| `autoFocus` | `true` | Move focus into the layer when the scope is created |
| `restoreFocus` | `true` | Put focus back where it was when the scope ends |
| `initialFocus` | — | `() => Element \| null \| undefined` — what to focus instead of the first focusable element |

`focusableWithin(container)` returns the descendants Tab stops on, in the
order it visits them: a positive `tabindex` first, lowest first and document
order among equals, then everything else in document order. The candidates
are links with an `href`, enabled form controls, media with controls,
`contenteditable`, and anything carrying a `tabindex` — less any whose
`tabindex` is negative, `<button tabindex="-1">` included, since that is how
a roving group keeps its resting items out of the tab sequence. Rendering is
judged with `checkVisibility()`, which asks the ancestors as well, so a button
inside a `display: none` or `hidden` panel is left out rather than offered as
somewhere focus can go — and one that a stylesheet shows despite `hidden` is
kept, as the browser would let it take focus. `<summary>` and `<iframe>` are
not on the list.

```ts
import { Signal, effect } from '@voltdev/core';
import { createFocusScope } from '@voltdev/primitives';

class Lightbox {
  open = new Signal.State(false);
  panel = new Signal.State<Element | null>(null);

  constructor() {
    effect(() => {
      if (!this.open.get() || !this.panel.get()) return;
      createFocusScope(() => this.panel.get());
    });
  }
}
```

The element is read **once**, when the scope is created. Created before the
element exists, it traps nothing and focuses nothing, though it still puts
focus back when it ends — which is why every overlay here creates its scope
from an effect that waits for the content, as above.

Focus is trapped by watching where it lands (`focusin`, on the document)
rather than by intercepting Tab. Intercepting the key means reimplementing tab
order, which browsers already compute and which no reimplementation gets
right for shadow roots, iframes or `tabindex` ordering; watching where focus
lands catches every route in — keyboard, pointer, script, and the browser's
own cycle through its address bar. When focus escapes it is sent to
`initialFocus`, else the first focusable element, else the container itself,
which is given `tabindex="-1"` if it needs one.

Which way focus was heading is the one thing `focusin` does not carry, and
the ends of the scope need it: Shift+Tab off the first element wants the
last, not the first again. It is read from the Tab press itself, which is
still down while focus moves, so focus that escapes backwards is sent to the
last element inside and an escape by a press or by script afterwards is not
treated as heading anywhere. Under a modal dialog the page behind is inert
and cannot take focus at all, so Tab past either end goes to the browser's
own controls and comes back to the dialog.

Scopes stack. A scope counts every dismissal layer above its own as inside
it, so a menu or a popover opened from a dialog keeps the focus it takes; see
[opening one layer from another](#opening-one-layer-from-another). And
`initialFocus` is read untracked, so a getter that reads a signal — which
item a menu has active — cannot make the effect that built the scope depend
on it and rebuild it, moving focus, at every change.

Focus is restored only if the element that had it is still in the document;
otherwise it is left where the browser put it.

### `createAnchor`

```ts
createAnchor(options: AnchorOptions): Anchor
```

Keeps a floating element attached to its reference with CSS anchor
positioning and nothing else. The reference gets an `anchor-name`, the
floating element a `position-anchor`, a `position-area` and the fallbacks to
try, and from there the browser keeps the two together through scrolling,
resizing, zooming and every layout change no script would hear about.

| Option | Default | Description |
|---|---|---|
| `anchor` | — | The reference element, once rendered. Required |
| `placement` | own state | A `Signal.State<AnchorPlacement>` to drive it from outside |
| `defaultPlacement` | `'bottom'` | Initial placement when it owns its own |
| `offset` | — | The gap. A number is pixels, a string any CSS length |
| `flip` | `true` | Try the opposite side when this one overflows |
| `shift` | `true` | Try the other alignment of the same side |
| `fallbacks` | `[]` | Further `@position-try` names or `position-area` values, tried after those |
| `strategy` | `'absolute'` | Or `'fixed'`, for an element already in the top layer |
| `positionVisibility` | — | `'always'`, `'anchors-valid'`, `'anchors-visible'` or `'no-overflow'`, written as `position-visibility` |
| `dir` | read from the anchor | `'ltr'` or `'rtl'`, to skip reading it |
| `name` | generated | The `anchor-name`, as a dashed-ident |
| `onPlacementChange` | — | Called when `setPlacement` changes it |

`AnchorPlacement` is a side — `top`, `right`, `bottom`, `left` — optionally
followed by `-start` or `-end`.

| Member | Description |
|---|---|
| `name()` | The `anchor-name` in use |
| `placement()` / `side()` / `alignment()` | The placement asked for, and its two halves |
| `direction()` | The writing direction it was resolved against |
| `positionArea()` | The resolved `position-area`, for CSS you write yourself |
| `isSupported()` | Whether this browser can do anchor positioning |
| `setPlacement(placement)` | Move it |
| `anchorProps()` | For the reference: the `anchor-name`, and nothing else |
| `floatingProps()` | For the floating element: `data-placement`, `data-anchored`, and the positioning `style` |
| `arrowProps()` | For a decorative arrow: `aria-hidden`, `data-side`, and a `style` centring it on the reference |

```ts
import { Signal } from '@voltdev/core';
import { createAnchor } from '@voltdev/primitives';

class HoverCard {
  reference = new Signal.State<Element | null>(null);
  anchor = createAnchor({
    anchor: () => this.reference.get(),
    defaultPlacement: 'right-start',
    offset: 8,
    positionVisibility: 'anchors-visible',
  });
}
```

```html
<a :ref="reference" :spread="anchor.anchorProps()" href="/people/ada">Ada</a>
<div :portal :spread="anchor.floatingProps()">…</div>
```

**Positions are physical.** `position-area` is written with `top`, `left`,
`span-right` and so on, never the logical `x-start` family. The browser
resolves logical keywords against the *floating* element's containing block,
which for a portalled element is `<body>` — so a trigger inside an RTL region
of an LTR page would align to the wrong edge. The direction is read from the
reference instead: the nearest `dir` attribute, else computed style, and
watched, so a language switch that flips `dir` on `<html>` moves everything
anchored. One `MutationObserver` per document serves every anchor on it.
Direction mirrors the inline axis only; a page in a vertical writing mode
should ask for the placement it wants.

**Fallbacks are discrete.** CSS has no continuous shift: a fallback is a
position to try, not a distance to slide. The list is the opposite side
first, then the other alignment, then both, then your `fallbacks`. A centred
placement has no other alignment, so it gets its two aligned variants on the
side asked for instead, and no "both": `bottom` tries `flip-block`, then
`bottom span-right` and `bottom span-left`, and never an aligned variant
above. With `flip` and `shift` both off and no `fallbacks`, no
`position-try-fallbacks` is written at all, so a stylesheet can own it.

**The placement reported is the one asked for.** When the browser takes a
fallback it does not say which, and there is no API to ask. An arrow styled
from `data-side` therefore stays on the requested side after a flip. That is
the price of letting the engine do the work.

**`offset` owns the margins** — all four, three of them zero — so the gap
moves with the placement instead of lingering on the old side. It is also
published as `--volt-anchor-offset`, so an arrow can be drawn exactly as tall
as the gap.

**There is no script fallback.** Where the engine cannot do it,
`isSupported()` is false, `data-anchored="false"` says so to CSS, and
`floatingProps()` writes no style at all, so your stylesheet can place the
element another way. Shipping a layout engine to every browser so that the
ones without anchor positioning get collision detection is the wrong trade,
and it is the one that never gets taken back. On a server, where there is no
`CSS` global to ask, support is assumed, and the browser that receives the
markup decides.

`position` is written inline, because a `position-area` on a statically
positioned element does nothing at all, and a silently unplaced popover is
the most common way to get this wrong. The cost is that it beats your
stylesheet, which is what `strategy` is for.

The module also exports what it is built from:

| Function | Description |
|---|---|
| `supportsAnchorPositioning()` | One `CSS.supports` check, not cached |
| `positionAreaFor(placement, direction?)` | The physical `position-area` for a placement; `direction` defaults to `'ltr'` |
| `writingDirection(el)` | The nearest `dir` attribute, else computed style; `'ltr'` for no element |
| `directionWatcherCount(doc?)` | How many anchors are watching a document — for tests |

Nothing here is announced. Positioning is presentation, so the only ARIA it
writes is `aria-hidden` on the arrow, which is a drawing of a relationship
rather than content.

## On a server

Every overlay's behaviour — dismissal, focus, the tooltip's timers, the
toaster's clocks, the collapsible's measurement, reading the writing
direction — is set up from a user or measure effect, and a server runs
neither (see [what a server does not run](./server#what-a-server-does-not-run)).
The props are ordinary computations, so a server render writes the roles,
the ids, `aria-expanded` and the anchor styles for whatever is open, and the
behaviour attaches when the page hydrates.

A server render sets no `:ref`, so every element getter answers `null` there,
and what the props learn from the rendered DOM is missing from that markup
until the client runs: a dialog's or popover's `aria-labelledby` and
`aria-describedby`, which wait for the title and description to be found — a
popover given `labels.content` carries that as its name meanwhile, title or
not; a menu's name, which is its own — `labels.menu`, the provider's or
English — until the trigger has been checked; a `<div>` popover trigger's
`role="button"` and `tabindex`, which wait for the trigger element; and the
collapsible's `--volt-collapsible-height`.

Anchor positions are resolved left-to-right, because the effect that reads
`dir` off the trigger does not run. `createAnchor` takes `dir` for exactly
that, but the popover, tooltip and menu do not pass it through, so on an RTL
page their server markup aligns to the wrong edge until the client has read
the trigger.

## Type names

Every option object, return value and prop bag above is exported as a type,
for a wrapper component that has to spell one. The ones not already named on
this page:

| Type | What it is |
|---|---|
| `PresenceState` | `'open' \| 'closed'` — what every `state()` returns |
| `DialogProps`, `PopoverProps`, `TooltipProps`, `MenuProps`, `ToastProps`, `DisclosureProps`, `AnchorProps` | The prop bags, each an index signature over the values it can hold. `PopoverProps` and `TooltipProps` include functions, because those bags carry handlers |
| `TooltipTriggerProps`, `TooltipContentProps` | Both `TooltipProps`, named for the method that returns them |
| `DisclosurePropValue` | One value in a `DisclosureProps` — a string, a boolean, `undefined` or a style object |
| `PopoverPlacement` | `AnchorPlacement` under the popover's name |
| `AnchorSide`, `AnchorAlignment` | The two halves of a placement: `'top' \| 'right' \| 'bottom' \| 'left'`, and `'start' \| 'center' \| 'end'` |
| `AnchorStrategy`, `AnchorVisibility`, `WritingDirection` | The values of `strategy`, `positionVisibility` and `dir` |
| `PopoverLabels`, `MenuLabels`, `ToastLabels`, `CollapsibleLabels`, `AccordionLabels` | Each primitive's `labels` option |
| `MenuItemOptions`, `MenuItemRole`, `MenuOpenFocus`, `MenuPosition` | `itemProps`' argument, its `role`, `open`'s argument, and what `position()` returns |
| `ToastOptions`, `ToastType`, `ToastPriority`, `ToastDismissReason` | `add` and `update`'s options, and the values of `type`, `priority` and `onDismiss`'s reason |
| `AccordionType` | `'single' \| 'multiple'` |

```ts
import type { MenuItemOptions, ToastType } from '@voltdev/primitives';

// Menu items described as data, for a template that renders them from a :for
// and spreads menu.itemProps(item) on each.
const formatting: (MenuItemOptions & { label: string })[] = [
  { value: 'bold', label: 'Bold', role: 'menuitemcheckbox', checked: false, closeOnSelect: false },
  { value: 'clear', label: 'Clear formatting', textValue: 'clear' },
];

const severity: ToastType = 'warning';
```
