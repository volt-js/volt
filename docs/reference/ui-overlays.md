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

## `<v-menu>`, `<v-menu-item>` and `<v-menu-separator>`

A button, and the list of actions it opens — `createMenu`, with the markup
written. The WAI-ARIA menu-button pattern, down to the typeahead and the
roving tab stop.

<Demo name="menu" height="300" />

```html
<v-menu variant="primary" :onSelect="run">
  <template :slot-trigger>Actions</template>

  <v-menu-item value="rename">Rename…</v-menu-item>
  <v-menu-item value="duplicate">Duplicate</v-menu-item>

  <v-menu-separator></v-menu-separator>

  <v-menu-item value="delete" :disabled="locked.get()">Delete report</v-menu-item>
</v-menu>
```

The trigger is the component's, as the popover's is, and for the same reason:
the sheet of actions is placed against the button in CSS, and the
`anchor-name` that does it has to be on an element the component renders. So
the trigger is a `<button>` drawn with the sheet's button rules — `variant`
and `size` are that button's — and the `trigger` slot is what goes inside it.
That button is also what names the menu: it carries the primitive's own id and
the sheet points `aria-labelledby` at it.

| `<v-menu>` | Type | Means |
|---|---|---|
| `open` | `Signal.State<boolean>` | Your signal, when the state is yours |
| `defaultOpen` | `boolean` | Where it starts, when the menu owns its state |
| `placement` | `'top' \| 'right' \| 'bottom' \| 'left'`, each also as `-start` and `-end` | Which side of the trigger the sheet sits on, and which edge it lines up with. Default `bottom-start`, which is the leading edge and mirrors under `dir="rtl"` |
| `offset` | `number \| string` | The gap between trigger and sheet, written inline by the primitive. A bare number is pixels either way you write it: `offset="8"` and `:offset="8"` are the same gap |
| `flip` | `boolean` | Let the browser move the sheet to the opposite side when it would overflow. Default true |
| `orientation` | `'vertical' \| 'horizontal' \| 'both'` | Which arrows move between items, and which way a separator lies. Default `vertical` |
| `loop` | `boolean` | Wrap past the first and last item. Default true |
| `typeahead` | `boolean` | Typing letters jumps to the item they start. Default true |
| `typeaheadTimeout` | `number` | How long typed characters accumulate, in ms. Default 500 |
| `closeOnEscape`, `closeOnOutsidePointer` | `boolean` | Both default to true |
| `closeOnSelect` | `boolean` | Choosing an item closes it. Default true; an item may say otherwise for itself |
| `label` | `string` | The trigger's name, for a trigger whose words are an icon |
| `aria-label`, `aria-labelledby` | `string` | The same name, and the same id, in the platform's spelling. Both land on the **trigger** |
| `variant` | `'primary' \| 'danger' \| 'ghost'` | The trigger's look |
| `size` | `'sm' \| 'lg'` | The trigger's size |
| `onOpenChange` | `(open: boolean) => void` | |
| `onSelect` | `(value: string \| undefined) => void` | Called with the `value` of the item chosen |

| `<v-menu-item>` | Type | Means |
|---|---|---|
| `value` | `string` | What the menu's `onSelect` is handed. Carried on the element, which is what lets items be drawn from a loop |
| `role` | `'menuitem' \| 'menuitemcheckbox' \| 'menuitemradio'` | `menuitem` acts; the other two carry a state |
| `checked` | `boolean \| 'mixed'` | For those two roles. An omitted state is announced as unchecked, not absent |
| `disabled` | `boolean` | Skipped by the arrows and by typeahead, refuses a press, still announced |
| `textValue` | `string` | What typeahead matches on, when the visible words are not what anyone would type |
| `closeOnSelect` | `boolean` | Overrides the menu's, for this item alone |
| `onSelect` | `() => void` | Called when this item is chosen, by press or by key |

`<v-menu-separator>` takes no props. It is a tag rather than markup of yours
because the rule is the sheet's but the attributes are the primitive's: a
separator lies *across* the menu, so which way it runs is the menu's
orientation turned ninety degrees, and only the menu knows that. It is not a
prop on an item either, because an item is pressable, focusable and collected
and a separator is none of the three — which is also why nothing has to skip
it: it carries no item marker, so the arrows step from the item above to the
one below without being told to, while a reader still announces the grouping
it draws.

Slots: `trigger` is what the button holds, and the default one is the sheet —
the items, the separators, and any markup of yours between them. An item's own
words are the content of its tag; there is no `label` prop, because nothing
else ever draws that item.

`defaultOpen`, `placement`, `offset`, `flip`, `orientation`, `loop`, the two
typeahead props, the two `closeOn` props and `closeOnSelect` are read once,
when the primitive is built, so they are not signals and changing them later
does nothing — which is also why they are written down here. Everything on an
item, and `label`, `variant` and `size`, are the other kind: bind them and
they follow.

What you write on the tag reaches the **sheet**, not the trigger. The sheet is
portalled to `<body>`, and it is the thing `<v-menu class="wide">` is about;
the trigger is a button, and `variant` and `size` are how it is drawn. The
exceptions are the three attributes that say what the control is called:
`label`, `aria-label` and `aria-labelledby` go on the button, which is the
element a reader announces, and through it they name the sheet as well. A name
landing on the sheet would be outranked by the `aria-labelledby` pointing at
the trigger and would say nothing at all. Where both spellings are written the
attribute wins, because that is the one you wrote on the tag.

Two attributes on the sheet are the component's rather than yours, and both are
load bearing: its `id`, which is what the trigger's `aria-controls` points at,
and `role="menu"`, which is what its `aria-haspopup` promises. Reach the sheet
with a class, or take the element itself with `:ref`.

Everything else you write stays. The sheet, an item and a separator each carry
a bag of the primitive's attributes, and an entry a bag has no value for is
dropped rather than written — because writing it as nothing would not skip the
attribute but take yours off the element. So `aria-orientation` on a vertical
menu, `data-label` on an item, `aria-keyshortcuts` anywhere: yours, kept. The
`data-` attributes an item is read back by — `data-value`, `data-label`,
`data-close-on-select` — are the props' own spelling, and writing one by hand
works, which is what lets an item be drawn by markup the component never sees.

**There is no highlighted-item attribute, and no rule in the sheet wants one.**
Roving focus moves real DOM focus between items, so the item under the keyboard
is the focused item and `:focus-visible` is what marks it — which also keeps a
focus ring from being dragged around behind a pointer. In a menu opened with
the pointer the hover background is what marks the item instead, and
`Highlight` under forced colours. A menu opened with the pointer highlights
nothing at all: the sheet itself takes focus, because marking an item would
claim a choice nobody has made.

**An item exists only while the menu is open.** The items are written in the
default slot, which is the portalled sheet, so each `<v-menu-item>` is built
when the menu opens and disposed when it closes. State an item shows — whether
it is ticked, whether it is disabled — belongs to your page and is bound in,
which it would have been anyway.

**One press, one action.** An item carrying its own `onSelect` is not also
reported to the menu's: running both would do two things for one choice. Use
the menu's callback with `value` for a sheet drawn from a list, and the item's
for the handful that are each their own thing.

The tick on a checkbox item is yours. The sheet draws the row an item sits on
and nothing inside it, so a `menuitemcheckbox` shows its state with markup you
write — and `checked` is what a screen reader is told, so both have to be set
from the same signal:

```html
<v-menu-item role="menuitemcheckbox" :checked="wrap.get()"
             :closeOnSelect="false" :onSelect="toggleWrap">
  <span aria-hidden="true">{ wrap.get() ? '✓' : '' }</span> Wrap lines
</v-menu-item>
```

`open` is the one signal both sides hold, and markup cannot write a signal. To
have a menu start open, write `defaultOpen`.

A disabled item keeps its place in the accessibility tree — `aria-disabled`,
never the `disabled` attribute, this package's rule for every disabled control
— so it is announced as being there and unavailable rather than appearing to
have vanished.

This is the dropdown half of `createMenu`. A context menu has no trigger to
hang off, is placed from `position()` in viewport coordinates, and needs a name
of its own, so it stays markup you write, with the same primitive and the same
classes — [the page's own section](#popover-menu-and-tooltip) has it.

For anything this does not offer — opening it from elsewhere, moving focus to a
particular item — take the primitive:

```html
<v-menu :ref="actions"><template :slot-trigger>Actions</template>…</v-menu>
```

```ts
actions: VMenu | null = null;
later(): void { this.actions?.menu.open('first'); }
```

## `<v-toaster>`

The region short messages arrive in — `createToaster`, with the markup
written. Each toast is its own live region, announced where the reader already
is, and nothing ever takes focus.

<Demo name="toast" height="320" />

```html
<v-toaster></v-toaster>
```

```ts
import { toaster } from '@voltdev/ui/components';

toaster().add({ title: 'Project saved' }, { type: 'success' });

toaster().add(
  { title: 'Message deleted', action: { label: 'Undo', onPress: restore } },
  { duration: 0 },
);
```

Write the tag once, in the markup that stays up for the whole application — a
layout or a shell, not a page that comes and goes — and raise from anywhere
with `toaster()`.

That function is the one thing here that is not like the rest of the package,
and it is deliberate. A toast is raised where the thing worth saying happened:
a fetch wrapper, a store, a route guard, a retry that finally worked. None of
those is a component. `:ref` on the tag reaches this one, and context reaches
what is written *inside* it — which for a toaster is nothing, because the
region is a leaf whose contents arrive from calls. So the way in is a function
that answers with the toaster that is mounted, and what it answers with is the
primitive itself: `add`, `update`, `dismiss`, `dismissAll`, `toasts`, `queued`
and `focusRegion` are
[`createToaster`](./primitives-overlays#notifications-createtoaster)'s own, so
there is no second surface to learn or to keep in step.

| `<v-toaster>` | Type | Means |
|---|---|---|
| `max` | `number \| string` | How many are on screen at once; the rest wait their turn. Default 3 |
| `duration` | `number \| string` | How long one stays up, in milliseconds. Default 5000; `0` keeps it up until something dismisses it |
| `hotkey` | `string \| ((event: KeyboardEvent) => boolean)` | The key that moves focus to the region, matched with no modifier held. Default `F6` |
| `label` | `string` | The region's accessible name. Default the locale's word for notifications, then `Notifications` |
| `aria-label` | `string` | The same name in the platform's spelling, and the one that wins |
| `closeLabel` | `string` | What a close button is called. Default the locale's word, then `Close notification` |
| `onDismiss` | `(toast: Toast<ToastMessage>, reason: 'timeout' \| 'api') => void` | Called with each toast as it goes, and why it went |

| `add(message, options?)` | Type | Means |
|---|---|---|
| `title` | `string` | The line in bold — the message itself, for a toast that is one line |
| `description` | `string` | The line under it, drawn only where there is one |
| `action` | `{ label: string; onPress: () => void }` | The one thing to do about it, drawn as a button beside the close, where the label is not blank |
| `options.type` | `'info' \| 'success' \| 'warning' \| 'error'` | What kind of thing happened. Default `info` |
| `options.duration` | `number` | This toast's own lifetime, over the toaster's |
| `options.id` | `string` | Reuse one and `add` updates that toast instead of raising a second |
| `options.priority` | `'polite' \| 'assertive'` | Override the priority `type` implies |

Slots: `toast` is the words, handed the toast it is drawing, and taking it
replaces the title and the description with your own markup. The chrome stays
the component's either way — the live region's attributes, the action and the
close button — so a toast a page draws itself is still a toast a screen reader
reads and a keyboard can reach:

```html
<v-toaster>
  <template :slot-toast="{ toast }">
    <p class="volt-toast-title">{ toast.data().title } <b>{ toast.type() }</b></p>
  </template>
</v-toaster>
```

`toaster()` throws when no toaster is mounted, rather than dropping the
message: the failure it stands for is a `<v-toaster>` nobody wrote, and a call
that quietly does nothing turns that into a user reporting a save that said
nothing. Mount a second toaster and the one mounted last answers, and the one
before it answers again when that goes — which is what makes a toaster inside a
route behave the way it reads. Two regions announcing at once is a design
problem rather than a feature.

`max`, `duration`, `hotkey` and `onDismiss` are read once, when the primitive
is built, so they are not signals and changing them later does nothing — which
is why they are written down here. `label`, `aria-label` and `closeLabel` are
the other kind: bind one and the name follows it, including while toasts are
up. The two counts take a string because an attribute is only ever one —
`max="1"` and `duration="2000"` are the same as `:max="1"` and `:duration="2000"`
— and something that is not a number at all is refused by name rather than
left to become a toaster that shows nothing.

A toast carrying an action should be raised with `duration: 0`. An undo the
countdown can take away mid-reach is worse than no undo. Pressing the action
takes the toast down and then runs it, in that order: a toast left up with a
pressed undo invites a second undo, and an action that raises the next thing to
say under this toast's own id becomes this toast rather than being taken down
by the press that asked for it. An action whose `label` is blank is left out
rather than drawn unnamed: a button with no accessible name, inside a live
region, is one a screen reader reaches in the middle of the announcement and
can say nothing about — and the gap where it should be is what tells you what
you wrote.

`update(id, message)` — or `add` with an `id` already in use — replaces a
toast's words and starts its reading time again, which is what a promise wants:
one notification that becomes its own result rather than a second toast under
the first.

What you write on the tag reaches the **region**: it is what carries
`role="region"`, and `<v-toaster class="corner">` is about the element the
toasts are in. That region is portalled to `<body>`, and not for the usual
reason — a modal dialog makes every other child of `<body>` inert, and an inert
subtree is out of the accessibility tree, so a region nested anywhere else
announces nothing while a dialog is open. Name it with `label` or `aria-label`
rather than by hand: the primitive's own props are spread onto that element and
reapplied whenever they change, so an attribute written beside them lasts until
the first time a pointer pauses the queue.

Type is drawn as a colour down the leading edge, and colour is the one channel
a forced palette does not have spare — so the same edge carries a border style
per type, which survives one. That is a second cue rather than a replacement:
severity belongs in the words of the toast, and `title` is where a reader who
sees neither edge will find it.

F6 moves focus into the region and Escape puts it back where it came from,
which is the only keyboard route to the action inside a toast — nothing links
to one. The countdown stops while the pointer is over the region, while it
holds focus, and while the tab is in the background, because a toast that
expires unread was never shown. A dismissed toast stays in the DOM, marked
`data-state="closed"`, until its exit animation has finished.

The close button has no class of its own: it is a `<button>` drawn with the
sheet's button rules, like the popover's, and its glyph is decoration — the
name a screen reader reads is `closeLabel`.

For anything this does not offer — the queue itself, a toaster that is not the
mounted one, the primitive's props on markup of your own — take the primitive:

```html
<v-toaster :ref="notices"></v-toaster>
```

```ts
notices: VToaster | null = null;
later(): void { this.notices?.toaster.dismissAll(); }
```

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
