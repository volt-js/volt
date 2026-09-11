# Display primitives

Avatars, images, progress bars, badges, timestamps, keyboard shortcuts, code,
separators and splitters, removable tags, the feedback family — alerts, empty
states, skeletons and spinners — and a chat transcript. All of them are in
`@voltdev/primitives`.

::: warning Not on npm yet
Part of `@voltdev/primitives`, which is not published yet — see
[the overview](./primitives). Everything here works from a checkout of the Volt
repository.
:::

What they have in common is that the hard part is never the pixels. A badge
draws "99+" and has to say "more than 99 unread messages". A spinner draws a
ring and has to say what the wait is. A timestamp draws "3 minutes ago" and
has to still be true a minute later, without every timestamp on the page owning
a timer. A chat has to stay at the bottom while a reply streams in, and let go
the moment the reader scrolls up. None of these renders anything or has an
opinion about styling: each owns its state and returns objects of attributes to
spread onto markup you write.

## Before you start

Every primitive here follows [the conventions the package shares](./primitives#conventions):
created in a component's field initialiser, elements handed over as getters,
state read by calling it, props spread with `:spread`, a `Signal.State` passed
in to control a value from outside, and every user-facing string under
`labels`, English by default.

Two things are specific to this page.

**Keyboard handlers return `true` when they consumed a key.** The chip's
handler and the alert's dismiss control call `preventDefault` themselves;
every other handler here leaves it to you, and the examples show where.

**Template expressions resolve against the component.** `visuallyHidden` is a
function you import, so a template can only call it once it is a member —
`hidden = visuallyHidden()` as a field, then `:style="hidden"`.

## Hiding text from sight but not from speech

```ts
visuallyHidden(): VisuallyHiddenStyle
```

The style that takes an element off the screen and leaves it in the
accessibility tree: a label with no room for one, the words "opens in a new
tab", a spinner's name. `display: none` and `visibility: hidden` are what it
must not do, because both remove the element from the accessibility tree too. A
zero-sized box is dropped by some engines, so the box stays one pixel and is
clipped away instead; `white-space: nowrap` stops a long string wrapping into a
one-pixel column that some screen readers read a line at a time.

```ts
import { visuallyHidden } from '@voltdev/primitives';

class SortButton {
  hidden = visuallyHidden();
}
```

```html
<button><svg aria-hidden="true">…</svg><span :style="hidden">Sort ascending</span></button>
```

The object is frozen and shared by every caller. It carries both `clip` and
`clip-path`; `clip` is deprecated and is there only for engines that predate
the other, at the cost of one declaration.

## Showing a person or a picture

### Avatar

```ts
createAvatar(options?: AvatarOptions): Avatar
```

An image with a name behind it, and initials when there is no image or it
fails.

| Option | Description |
|---|---|
| `image` | The `<img>` element, once rendered |
| `fallback` | The fallback element, once rendered. Whether it is on screen decides the image's `alt` |
| `src` | What to load. Empty, `null` or `undefined` means there is no picture |
| `name` | The accessible name, and where the initials come from |
| `status` | A `Signal.State<AvatarStatus>`, to control status from outside |
| `fallbackDelay` | Hold the fallback back this many ms after a load starts. Default `0` |
| `initials` | `(name) => string`, replacing the default derivation |
| `maxInitials` | `1` for the first word's initial only. Default `2`; the default derivation never returns more than two, so a larger number changes nothing |
| `onStatusChange` | Told each new status |

| Member | Description |
|---|---|
| `status()` | `'idle'`, `'loading'`, `'loaded'` or `'error'` |
| `isImageVisible()` | Whether the picture is the thing to show — the image has loaded |
| `isFallbackVisible()` | Whether the fallback is |
| `initials()` | Initials for the current name, or `''` |
| `rootProps()` / `imageProps()` / `fallbackProps()` | For the three elements. Each carries `data-status`; the image's also `alt` and, when there is one, `src`; the fallback's the name, below |

```ts
import { Signal } from '@voltdev/core';
import { createAvatar } from '@voltdev/primitives';

class Profile {
  user = new Signal.State({ name: 'Ada Lovelace', photo: '/ada.png' });
  img = new Signal.State<Element | null>(null);
  fallback = new Signal.State<Element | null>(null);
  avatar = createAvatar({
    image: () => this.img.get(),
    fallback: () => this.fallback.get(),
    src: () => this.user.get().photo,
    name: () => this.user.get().name,
  });
}
```

```html
<span :spread="avatar.rootProps()">
  <img :ref="img" :spread="avatar.imageProps()">
  <span :if="avatar.isFallbackVisible()" :ref="fallback"
        :spread="avatar.fallbackProps()">{ avatar.initials() }</span>
</span>
```

**Render the `<img>` unconditionally**, and hide it with CSS against
`data-status` until it has loaded. The load is watched on the element you
rendered, so an `<img>` under `:if="avatar.isImageVisible()"` never loads: it
is not rendered until it has loaded, and it does not load until it is
rendered. That constraint is the price of watching the rendered element rather
than a detached `new Image()`, and it buys three things: no second request;
`srcset`, `sizes` and `crossorigin` working, because the browser is doing the
choosing; and no `document` global in a primitive that may run on a server.
The avatar writes none of those three itself — put them on the `<img>` — and
it only knows there is a picture when `src` is set.

**One picture of one person is announced once.** While the fallback is on
screen it carries the name as `role="img"` with an `aria-label`, and the image
beside it gets `alt=""`. With no fallback rendered, the image carries the name
itself. With no name at all, the fallback is `aria-hidden`. The image always
has an `alt` attribute, because an `<img>` without one is announced by reading
its URL aloud.

**The default initials are the first and last word's first character**, so
"Ada King Lovelace" is "AL", and `maxInitials: 1` leaves the first alone. That
is the European convention and is wrong for names with no spaces to split on,
or one name, or five; `initials` replaces it, per locale if need be. Characters are counted as graphemes, so an emoji or an
accented letter written as two code points is not cut in half. Case is left as
written — upper-casing is `text-transform`'s job, and doing it here would need
a locale: a Turkish "i" upper-cases to "İ".

`fallbackDelay` is a straight trade. Waiting stops initials flashing in front
of an image that was already in cache, and leaves a hole for anyone whose
connection is slower than the delay. `0` favours the slow connection, which is
why it is the default. A load that has already failed or finished ends the
wait early.

An image that is complete with no width is not taken as a failure: a server
render or a test DOM looks exactly like that, so the status waits for the
browser's own `load` or `error` event.

### Image

```ts
createImage(options: ImageOptions): Image
```

A picture that reserves its space before it arrives and knows how the load
went.

**Decorative or described is in the type.** Either the picture carries meaning
the text around it does not, and it takes an `alt` saying what; or it is a
flourish beside text that already says everything, and it takes
`decorative: true`. There is no third answer, and leaving `alt` off is not one.
The options are a union, so a call with neither does not compile.

| Option | Description |
|---|---|
| `image` | The `<img>` element, once rendered. Required |
| `src` | What to load. Required; empty means nothing to fetch |
| `alt` | `() => string` — what the picture says. Required unless `decorative` |
| `decorative` | `true` for a picture announced as nothing |
| `srcset` / `sizes` | Candidate sources and the widths that choose between them. `srcset` alone counts as a source |
| `width` / `height` | Intrinsic size in CSS pixels. Together they reserve the box |
| `aspectRatio` | The box's ratio as CSS writes it — `'16 / 9'`. Overrides the ratio `width` and `height` imply; both are still written on the `<img>` |
| `loading` | `'eager'` or `'lazy'`. Default unset, which is the browser's eager loading |
| `decoding` | `'async'`, `'sync'` or `'auto'`. Default `'async'` |
| `fetchPriority` | `'high'`, `'low'` or `'auto'` |
| `status` | A `Signal.State<ImageStatus>`, to control status from outside |
| `onStatusChange` | Told each new status |

| Member | Description |
|---|---|
| `status()` | `'idle'`, `'loading'`, `'loaded'` or `'error'` |
| `isLoading()` / `isLoaded()` / `hasError()` | The same, as questions |
| `isDecorative()` | Whether the picture is announced at all |
| `aspectRatio()` | The reserved ratio, or `null` when no size is known |
| `boxProps()` | For a wrapper: `data-status`, and a `style` holding `aspect-ratio` when one is known |
| `imageProps()` | For the `<img>`: `alt`, `decoding`, `data-status`, the sources, the hints, `width`, `height`, and `role="presentation"` when decorative |

```ts
import { Signal } from '@voltdev/core';
import { createImage } from '@voltdev/primitives';

class Cover {
  img = new Signal.State<Element | null>(null);
  cover = createImage({
    image: () => this.img.get(),
    src: () => '/cover.jpg',
    alt: () => 'The first edition, in green cloth',
    width: 1200,
    height: 800,
  });
}
```

```html
<div :spread="cover.boxProps()">
  <img :ref="img" :spread="cover.imageProps()">
</div>
```

A decorative image gets `alt=""` and `role="presentation"` — the two say the
same thing, and a sanitiser or CMS that strips empty attributes leaves one of
them standing. `alt: () => ''` is not a shortcut for decorative; it writes the
empty `alt` without the role.

`lazy` is not the default because the image most likely to be marked up with
care is the one at the top of the page, and lazy-loading that one measurably
delays it. Below the fold, set it. A `width` or `height` that is not a positive
finite number is ignored rather than written. As with the avatar, the `<img>`
has to be rendered for the load to be watched.

## Showing a value that changes

### Progress

```ts
createProgress(options?: ProgressOptions): Progress
```

| Option | Description |
|---|---|
| `value` | A `Signal.State<number \| null>`. `null` is indeterminate |
| `defaultValue` | Starting value when the progress owns it. Default `null` |
| `min` / `max` | Default `0` and `100` |
| `label` | Accessible name. Ignored when `labelledBy` is given |
| `labelledBy` | Id of an element that already names it. Preferred over `label` |
| `valueText` | `(value, percent) => string` — a spoken alternative to the number |
| `labels.indeterminate` | Said in place of a value while there is none. Default `Loading…`; `''` says nothing |
| `onValueChange` | Told each value `setValue` writes |

| Member | Description |
|---|---|
| `value()` | Clamped to the range, or `null` when indeterminate |
| `percent()` | 0–100 for sizing the indicator, or `null` |
| `isIndeterminate()` | |
| `state()` | `'indeterminate'`, `'loading'` or `'complete'` — complete at `max` |
| `setValue(value)` | `null` to go indeterminate |
| `rootProps()` | `role="progressbar"`, the range, the value, the name, `data-state` and `data-value` |
| `indicatorProps()` | `data-state`, `data-value`, `data-max` — no ARIA, since a progressbar's children are presentational |

```ts
import { Signal } from '@voltdev/core';
import { createProgress } from '@voltdev/primitives';

class Upload {
  sent = new Signal.State<number | null>(0);
  progress = createProgress({
    value: this.sent,
    max: 8,
    label: 'Uploading',
    valueText: (value) => `${value} of 8 files`,
  });
}
```

```html
<div :spread="progress.rootProps()">
  <div :spread="progress.indicatorProps()" :style="{ width: (progress.percent() ?? 0) + '%' }"></div>
</div>
```

**With no value it starts indeterminate.** The value is nullable rather than a
number with a separate flag because the two states must be impossible to
confuse: while indeterminate, `aria-valuenow` is not written at all, and the
wrong state is a number a screen reader reads out as though it were true. A
value that is not a finite number is treated as indeterminate for the same
reason — `aria-valuenow="NaN"` is announced exactly as written.

The indicator's width is yours to set from `percent()`, because a width is
styling. Set `valueText` whenever the range is not 0–100: a screen reader
otherwise works out a percentage itself, and "37 percent" is not what "3 of 8
files" should sound like. It is not focusable; something a user can change is
a slider, which is a different role with a keyboard map.

### Badge

```ts
createBadge(options?: BadgeOptions): Badge
```

A count, or a status, that says what it is counting.

| Option | Description |
|---|---|
| `describes` | What the number counts — `'unread messages'` |
| `count` | A `Signal.State<number \| null>`. `null` is a badge with no count |
| `defaultCount` | Starting count when the badge owns it. Default `null` |
| `max` | Past this the text becomes `${max}+`. Default no cap |
| `showZero` | Stay visible at zero. Default `false` |
| `live` | `'off'`, `'polite'` or `'assertive'`. Default `'off'` |
| `labels.count` | `(count, describes) => string`. Default `3 unread messages` |
| `labels.overflow` | `(max, describes) => string`. Default `More than 99 unread messages` |
| `onCountChange` | Told each count `setCount` writes |

| Member | Description |
|---|---|
| `count()` / `setCount(n)` | The count, as a whole number, or `null` |
| `isVisible()` | Whether there is anything to show — the `:if` you write |
| `isOverflowed()` | Past `max` |
| `text()` | What is drawn: `3`, `99+`, or `''` for a badge with no count |
| `label()` | What a screen reader is told instead |
| `badgeProps()` | `role="img"` and the label, `data-count`, `data-overflow`, and the live attributes |

```ts
import { Signal } from '@voltdev/core';
import { createBadge } from '@voltdev/primitives';

class Inbox {
  unread = new Signal.State<number | null>(3);
  badge = createBadge({ count: this.unread, describes: 'unread messages', max: 99 });
}
```

```html
<button>
  Inbox
  <span :if="badge.isVisible()" :spread="badge.badgeProps()">{ badge.text() }</span>
</button>
```

The badge is a leaf named by its label, so that button is named "Inbox 3
unread messages" rather than "Inbox 3". "99+" read aloud is "ninety-nine plus"
or nothing, depending on the screen reader. Without `describes` the badge is a
bare numeral in the middle of a sentence, which is what this exists to
prevent.

A badge with no count — "Beta", "Deprecated" — is always visible and draws its
own content. Given a `describes`, it becomes a leaf named by it, which
replaces what it draws rather than adding to it: a badge drawn "Beta" with
`describes: 'status'` is heard as "status". Leave `describes` off a badge whose
own words say everything. A fraction is
truncated and a non-finite count becomes no count. Kept in the DOM while it is
empty, for an exit animation, the badge is `aria-hidden` and marked
`data-empty`, so it is not still announcing the number it is fading from.

**The default label does not pluralise**, because it cannot: the plural depends
on the locale and the noun. `Intl.PluralRules` picks the category but not the
words, so a page that needs "1 unread message" supplies both forms in
`labels.count`.

**`live` is off by default.** A badge summarises something already on the
page, so announcing each change is usually repetition, and a counter that ticks
during a page load interrupts continuously. Turning it on also sets
`aria-atomic`, so what is heard is the label rather than the digit that
changed. What it does not have is the timing gate the feedback primitives
keep, and that costs the change that matters most. Under `:if`, a badge going
from nothing to one appears holding its first count — region and words in one
mutation, the failure described under
[Announcing a change](#announcing-a-change). Kept mounted, it is no better: a
badge with nothing to show writes `aria-hidden` and `data-empty` and nothing
else, so at zero there is no `aria-live` on it either, and the live region,
its name and its first count all arrive in the same update. Either way the
first arrival is not announced by the rule this page is built on. `showZero:
true` keeps the region in place at zero, at the price of a visible "0". The
tests check that `aria-live` and `aria-atomic` are written on a badge that
already has a count, not what a screen reader says, so treat `live` as
unproven for anything but a count changing from one number to another.

### Relative time

```ts
createRelativeTime(options: RelativeTimeOptions): RelativeTime
```

A timestamp that reads the way a person would say it, and stays true.

| Option | Description |
|---|---|
| `date` | The moment — a `Date`, epoch ms, or a string `Date` parses. Pass ISO 8601 |
| `now` | A `Signal.State<number>` for "now" — a test, or a clock you already own |
| `live` | Keep it up to date. Default `true` |
| `locale` | BCP 47. Default the browser's |
| `style` | `Intl.RelativeTimeFormat` style. Default `'long'`, the one read as a sentence |
| `numeric` | Default `'auto'`, which says "yesterday" rather than "1 day ago" |
| `absoluteOptions` | How the absolute time in `title` is formatted. Default long date, short time |
| `labels.relative` | `(value, unit, date) => string`, replacing `Intl.RelativeTimeFormat` |
| `labels.absolute` | `(date) => string`, replacing the absolute format |

| Member | Description |
|---|---|
| `date()` | The parsed date, or `null` when it could not be parsed |
| `unit()` / `value()` | The unit on display, and how many of it — negative in the past |
| `text()` | "3 minutes ago", or `''` for a date it could not parse |
| `absolute()` | The absolute time, as it appears in `title` |
| `timeProps()` | `datetime` in ISO form, `title`, `data-unit`. Empty for an unparseable date |

```ts
import { createRelativeTime } from '@voltdev/primitives';

class Comment {
  postedAt = '2026-09-11T09:30:00Z';
  posted = createRelativeTime({ date: () => this.postedAt });
}
```

```html
<time :spread="posted.timeProps()">{ posted.text() }</time>
```

**Every live instance shares one ticker.** A timer each is the obvious
implementation and the wrong one: a thread with two hundred timestamps then
holds two hundred uncoordinated timers, none of them stopping when the tab goes
to the background. Here there is one timeout on the page, its period is the
shortest any instance asks for, and it stops when nothing is mounted or the
document is hidden, catching up the moment the tab is visible again. An
instance that passes `now` is not on the ticker at all; one with `live: false`
reads the clock each time it is read and never asks to be read again.

The unit, and how often an instance asks to be re-read:

| Distance | Unit | Asks for a tick every |
|---|---|---|
| Under a minute | `second` | 1 s |
| Under an hour | `minute` | 10 s |
| Under a day | `hour` | 1 min |
| Under 7 calendar days | `day` | 5 min |
| Until a calendar month has passed | `week` | 5 min |
| Under 12 months | `month` | 5 min |
| Beyond | `year` | 5 min |

The period is a fraction of the unit rather than the exact moment the text
would change, so the text can be up to that fraction stale; waking on the
boundary would need a timer per instance, which is the thing being avoided.
The other side of one shared clock is that a tick reaches every live instance,
not only the one that asked for it: while one timestamp on the page is under a
minute old, all two hundred work out their text and their props once a
second, and only a text that has changed is written back.

From a day upwards the distance is counted in midnights, not hours: at 01:00 on
Tuesday something posted at 23:00 on Sunday was the day before yesterday,
though it is only twenty-six hours old. A month needs the day of the month to
have come round, so 25 January to 3 February is a week, not a month.

There is no live region: a timestamp quietly becoming "4 minutes ago" is not
news, and a page of them announcing themselves in turn is unusable.
`relativeTimeTickerSize()` is also exported — how many instances the ticker is
driving — and is a test seam rather than something an application needs.

## Showing a shortcut or a piece of code

### Keyboard shortcut

```ts
createKbd(options: KbdOptions): Kbd
```

A chord drawn as symbols and said as words — `⌘K`, spoken "Command K".

| Option | Description |
|---|---|
| `keys` | The chord in `KeyboardEvent.key` names: `() => ['Meta', 'K']`, or `() => 'Meta+K'` |
| `platform` | `'apple'` or `'other'`. Default sniffed from the user agent |
| `labels.symbols` | What each key is drawn as, by key name. Merged over the defaults |
| `labels.names` | What each key is called aloud, by key name. Merged over the defaults |
| `labels.separator` | Drawn between keys. Default `''` on Apple, `'+'` elsewhere |
| `labels.join` | Spoken between keys. Default a space |

| Member | Description |
|---|---|
| `platform()` / `keys()` | |
| `parts()` | One `{ key, text, label }` per key, for markup that draws each key |
| `text()` | The chord as drawn — `⌘K`, `Ctrl+K` |
| `label()` | The chord as spoken — `Command K` |
| `kbdProps()` | `role="img"`, the spoken label, `data-platform` |
| `keyProps(key)` | `data-key`, for each key drawn as its own element |

```ts
import { createKbd } from '@voltdev/primitives';

const search = createKbd({ keys: () => ['Meta', 'K'], platform: 'apple' });
search.text();  // '⌘K'
search.label(); // 'Command K'
```

```html
<kbd :spread="search.kbdProps()">{ search.text() }</kbd>
```

| Key | Apple: drawn, said | Elsewhere: drawn, said |
|---|---|---|
| `Meta` | ⌘, Command | Win, Windows |
| `Control` | ⌃, Control | Ctrl, Control |
| `Alt` | ⌥, Option | Alt, Alt |
| `Shift` | ⇧, Shift | Shift, Shift |
| `Enter` | ↩, Enter | Enter, Enter |
| `Escape` | esc, Escape | Esc, Escape |
| `' '` | ␣, Space | Space, Space |
| `ArrowUp` | ↑, Up arrow | ↑, Up arrow |

Tab, Backspace, Delete, CapsLock, PageUp, PageDown, Home, End and the other
arrows have entries too. A key with none is drawn and said as written, and a
single character keeps the case it was given.

`⌘` read aloud is "place of interest sign" or, more often, silence — so the
element becomes a leaf with a name of its own. When keys are drawn as separate
`<kbd>` elements inside it, they are already out of the accessibility tree and
need nothing of their own. The string form is split on `+`, which is why the
array form exists: `'Meta++'` has no sensible reading, and the plus key can
only be written as `['Meta', '+']`.

**The platform is sniffed from the user agent**, which is unpleasant and is the
only thing left: `navigator.platform` is deprecated and `userAgentData` is
absent from exactly the browser this most needs to be right about. A server has
no browser to sniff, so a server render draws the `other` symbols and a Mac
replaces them when the page attaches. Pass `platform`, from the request's user
agent if you have it, to make both sides agree.

### Code

```ts
createCode(options?: CodeOptions): Code
```

Semantics for code, inline or in a block, and there are exactly two worth
having.

| Option | Description |
|---|---|
| `block` | A block rather than a run inside a sentence. Default `false` |
| `pre` | The `<pre>` around a block. Needed to know whether it scrolls |
| `language` | `() => string` — written to `data-language`, and used in the block's name |
| `label` | The block's accessible name, overriding the one built from `language` |
| `labels.block` | `(language) => string`. Default `TypeScript code` for `'TypeScript'`, or `Code` with no language |

| Member | Description |
|---|---|
| `language()` | |
| `isScrollable()` | Whether the block really overflows |
| `codeProps()` | For the `<code>`: `role="code"`, `data-language` |
| `preProps()` | For the `<pre>`: `data-block`, `data-language`, and while it overflows `tabindex="0"`, `role="region"` and a name. Empty for inline code |

```ts
import { Signal } from '@voltdev/core';
import { createCode } from '@voltdev/primitives';

class Sample {
  pre = new Signal.State<Element | null>(null);
  sample = createCode({ block: true, pre: () => this.pre.get(), language: () => 'TypeScript' });
}
```

```html
<pre :ref="pre" :spread="sample.preProps()"><code :spread="sample.codeProps()">…</code></pre>
```

`role="code"` goes on unconditionally, because this cannot see which element
it is spread onto: a `<span>` needs it and a `<code>` is not harmed by being
told what it is.

A block that overflows sideways is a scroll container, and one that cannot be
focused cannot be scrolled from the keyboard at all. So it becomes a focusable,
named region — but only while it really overflows, measured with a
`ResizeObserver` on the `<pre>` and the children it has when it is wired. A
permanent `tabindex="0"` would put an empty tab stop in front of every short
snippet on the page. The cost of naming it is one more entry in the landmark
list; the cost of not naming it would be a tab stop that says nothing when it
takes focus. Where there is no `ResizeObserver` — a server, a test DOM — the
block is taken not to scroll, which leaves a tab stop out rather than adding a
nameless one.

It is semantics only: no highlighting, no copy button, no line numbers.

## Dividing a layout, or resizing it

```ts
createSeparator(options?: SeparatorOptions): Separator
```

A divider, and — given a size to move — a window splitter.

| Option | Description |
|---|---|
| `orientation` | Which way the line runs. Default `'horizontal'` |
| `decorative` | Default `true`. Ignored when `resize` is given |
| `label` / `labelledBy` | Accessible name, for a separator that is not decorative |
| `resize` | Make it a splitter; see below |

| `resize` option | Description |
|---|---|
| `value` | A `Signal.State<number>` — the size of the pane it sizes, in your units |
| `defaultValue` | Starting size when the separator owns it. Default `50` |
| `min` / `max` | Default `0` and `100` |
| `step` | How far one arrow press moves it. Default `1` |
| `controls` | Id of the pane being sized, for `aria-controls` |
| `collapsible` | Enter collapses to `min` and restores. Default `false` |
| `valueText` | `(value) => string` — "30 percent" beats "30" |
| `onValueChange` | Told each new size |

| Member | Description |
|---|---|
| `orientation()` | |
| `value()` | The pane's size, clamped — `min` if the signal holds something that is not a finite number — or `null` when it does not resize |
| `setValue(value)` | Clamped. Ignored on a separator that does not resize, and for a value that is not a finite number |
| `onKeyDown(event)` | `true` when it consumed the key. Does not call `preventDefault` |
| `separatorProps()` | Decorative: `role="presentation"` and `data-orientation`. Otherwise `role="separator"`, `aria-orientation`, the name; a splitter adds `tabindex="0"`, `aria-valuenow`, `-min`, `-max`, `-valuetext` and `aria-controls` |

```ts
import { Signal } from '@voltdev/core';
import { createSeparator } from '@voltdev/primitives';

class Panes {
  sidebar = new Signal.State(30);
  splitter = createSeparator({
    orientation: 'vertical',
    label: 'Resize sidebar',
    resize: { value: this.sidebar, min: 15, max: 60, step: 5, controls: 'sidebar', collapsible: true },
  });

  onSplitterKey(event: KeyboardEvent): void {
    if (this.splitter.onKeyDown(event)) event.preventDefault();
  }
}
```

```html
<aside id="sidebar" :style="{ width: sidebar.get() + '%' }">…</aside>
<div :spread="splitter.separatorProps()" :keydown="onSplitterKey($event)"></div>
```

**Decorative is the default** because nearly every separator is: a rule between
two menu groups tells a screen reader nothing the grouping has not said, and
`role="separator"` on each one turns a menu into a list of announcements about
lines. A decorative separator gets `role="presentation"` and `data-orientation`,
and nothing else — a presentational element takes no ARIA properties.

**Orientation is the line's, not the movement's.** `<hr>` is horizontal. A
splitter between two side-by-side panes is a vertical line, and it is Left and
Right that move it.

**A splitter is a widget, never decorative.** It is focusable and reports its
position as a slider does. The keys are the Authoring Practices' window
splitter:

| Key | On a vertical line | On a horizontal line |
|---|---|---|
| Right | Larger — smaller in a right-to-left layout | Nothing |
| Left | Smaller — larger in a right-to-left layout | Nothing |
| Down | Nothing | Larger |
| Up | Nothing | Smaller |
| Home / End | `min` / `max` | `min` / `max` |
| Enter | Collapse to `min`, or restore, when `collapsible` | The same |

Any key with Ctrl, Meta or Alt held is left alone, and so is Enter on a
splitter that is not `collapsible`. Enter restores the last size it collapsed
from; a splitter Enter has never collapsed — one that started at `min`, or was
only ever taken there by Home — restores to `max`.

No name is invented for a splitter — "separator, 30" says nothing about which
pane moved, and a wrong name is worse than a missing one — so give it `label`
or `labelledBy`.

**Dragging is not here.** A drag is layout: you know where the panes are and
what a pixel is worth, and this does not. Moving the value from a pointer is
yours to write, through `setValue`.

## Removable tags

```ts
createChip(options: ChipOptions): Chip
```

A tag with a remove control, and the one thing that has to be got right: where
focus goes when it is removed.

| Option | Description |
|---|---|
| `chip` | The chip's own element. Required |
| `container` | The element holding the sibling chips. Default the chip's parent |
| `fallbackFocus` | Where focus goes when the last chip is removed. Default the container |
| `label` | `() => string` — what the chip says, for the remove control's name |
| `removable` | Default `true` |
| `disabled` | `() => boolean`. Announced as unavailable, and refuses removal |
| `focusable` | Put the chip itself in the tab order. Default `true` |
| `labels.remove` | `(label) => string`. Default `Remove Ada`, or `Remove` with no label |
| `onRemove` | Called when the chip asks to be removed. You drop it |

| Member | Description |
|---|---|
| `label()` / `isDisabled()` / `isRemovable()` | |
| `neighbour()` | The chip that will take focus when this one goes, or `null` |
| `remove()` | Move focus off, then call `onRemove`. Does nothing when not removable |
| `onKeyDown(event)` | Delete and Backspace remove. Calls `preventDefault` itself on a key it acts on, and on no other |
| `chipProps()` | `data-volt-item`, `data-label`, `tabindex="0"` when `focusable`, and `aria-disabled` with `data-disabled` when disabled |
| `removeProps()` | `type="button"`, the name, `tabindex="-1"` while the chip is the tab stop and `"0"` when it is not, `aria-disabled` when disabled, `data-disabled` when not `removable` |

```ts
import { Component, Prop, Signal } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { createChip } from '@voltdev/primitives';

@Component({
  selector: 'v-tag',
  render: compileTemplate(`
    <span :ref="el" :spread="chip.chipProps()" :keydown="chip.onKeyDown($event)">
      { tag }
      <button :spread="chip.removeProps()" :click="chip.remove()">×</button>
    </span>
  `),
})
export class Tag {
  @Prop() tag = '';
  @Prop() onDrop: () => void = () => {};
  el = new Signal.State<Element | null>(null);
  chip = createChip({
    chip: () => this.el.get(),
    label: () => this.tag,
    onRemove: () => this.onDrop(),
  });
}
```

**Focus moves before `onRemove` runs.** Removing the chip that has focus drops
a keyboard user on `<body>`, with no way back to the field they were filling
in, so focus goes to the next chip, else the previous one, else
`fallbackFocus`, else the container — which is given `tabindex="-1"` if it has
none, focusable without entering the tab order. Moving it first means the chip
is still in the document when `focusout` handlers run, and a consumer who wants
focus elsewhere can set it in `onRemove` and win.

The neighbour is found in the DOM, among the container's elements carrying
`data-volt-item`, rather than remembered — which is why `container` matters
when each chip is wrapped in something of its own, and why a list rendered
without `:key` can still lose focus, since the reconciler is then free to
replace the node underneath it. Disabled chips count as neighbours:
`aria-disabled` leaves an element focusable.

**The chip is the tab stop; the remove button is not.** Ten tags cost ten Tab
presses rather than twenty. The cost is that the button cannot be reached by
Tab, which is why Delete and Backspace on the chip do the same job. Nothing on
the chip tells a screen reader user those keys exist; the button, with its
name, is still reachable by a screen reader's own cursor and by pointer.

The keys are ignored when they come from a field inside the chip — an editable
tag owns its Backspace — and when Ctrl, Meta or Alt is held. The chip has no
role of its own, and arrow keys are deliberately absent: a row of chips is a
row of tab stops, and a primitive that owned the arrows would have to own the
tab order too. `focusable: false` exists for handing the chips to
[roving focus](./primitives#roving-focus-createrovingfocus), which then owns
their tab stops. It is not yet the saving it sounds like: the option cannot
tell a chip in a roving group from a chip nothing can focus, so it also makes
every remove button a tab stop of its own. A roving row of ten chips is then
eleven Tab presses — the row, and ten buttons — rather than one. Delete and
Backspace keep working on whichever chip the group has focused, since
`onKeyDown` does not read `focusable`.

## Announcing a change

Alerts, empty states, skeletons and spinners share one rule, and it is the
reason they are primitives at all: **a live region has to be on the page before
the words are.** A screen reader announces what changes inside a region, not
what a region arrives holding, so the markup everyone writes first —

```html
<div :if="failed" role="alert">Could not save</div>
```

— announces nothing in most screen readers. The region and the sentence land in
one mutation, and there was no region there to change.

Each of the four keeps a timing gate for its region and exposes it as
`isMessageVisible()`. Put the words inside a `:if` on it. The props that carry
the words also set `hidden` for the same window, so markup that ignores the
flag still gets the timing right. The gate opens 50 ms after the region is in
the document; a region mounted for the life of the page pays that once, early,
and one under `:if` pays it each time it appears. `announceDelay` overrides the
50 ms on every component that has a gate. The skeleton, spinner and empty state
take `region` as optional, and without one the gate stands open — a message
announced a little early is a smaller failure than one silently hidden.

Two consequences:

- **Politeness is fixed when the region is created.** Changing `aria-live` or
  `role` on an existing region is not reliably picked up, so an alert that has
  to switch between polite and assertive needs two regions, not an option.
- **No region is given a name.** `aria-label` on a live region is announced
  *instead of* its contents in some screen readers — the whole message lost.

A sentence that has no markup of its own to live in — a sort order changed, a
value was copied — belongs in the document's shared announcer, which the
[building blocks](./primitives#announcements-announce) cover; chat uses it.

### `createLiveRegionTiming`

```ts
createLiveRegionTiming(region: () => Element | null | undefined, delay?: number): LiveRegionTiming
```

The rule on its own, for a region of your own making. `isReady()` says whether
words written now would be announced. `delay` defaults to 50 ms.

```ts
import { Signal } from '@voltdev/core';
import { createLiveRegionTiming } from '@voltdev/primitives';

class Save {
  region = new Signal.State<Element | null>(null);
  message = new Signal.State('');
  timing = createLiveRegionTiming(() => this.region.get());
}
```

```html
<div :ref="region" role="status" aria-live="polite">
  <span :if="timing.isReady()">{ message.get() }</span>
</div>
```

A `delay` of `0` turns the wait off. That is right only for a region already on
the page, where the message is itself the first mutation; on a region under
`:if` it reinstates the bug.

### Alert

```ts
createAlert(options: AlertOptions): Alert
```

A message announced where the user already is.

| Option | Description |
|---|---|
| `region` | The live region element. Required |
| `priority` | `'assertive'` or `'polite'`. Default `'assertive'`; fixed for the alert's life |
| `open` | A `Signal.State<boolean>`, to control it from outside |
| `defaultOpen` | Starting state when the alert owns it. Default `false` |
| `closeOnEscape` | Default `true`. Listened for on the region, not the document |
| `announceDelay` | Override the region timing |
| `labels.dismiss` | The dismiss control's name. Default `Dismiss` |
| `onOpenChange` | Told each change |

| Member | Description |
|---|---|
| `isOpen()` | Whether the alert is logically up |
| `isPresent()` | Whether the region should be in the DOM — true through an exit animation |
| `isMessageVisible()` | Whether the message may be rendered yet |
| `state()` | `'open'` or `'closed'`, for CSS to animate against |
| `priority()` | |
| `open()` / `close()` / `toggle()` | |
| `rootProps()` | `role="alert"` or `"status"`, the matching `aria-live`, `aria-atomic`, `data-state`, `data-priority` |
| `messageProps()` | `hidden` while closed and until the region has settled, `data-state` |
| `dismissProps()` | Button semantics, the name, and its own click and key handlers |

```ts
import { Signal } from '@voltdev/core';
import { createAlert } from '@voltdev/primitives';

class Editor {
  region = new Signal.State<Element | null>(null);
  failed = createAlert({ region: () => this.region.get() });
}
```

```html
<div :ref="region" :spread="failed.rootProps()">
  <p :if="failed.isMessageVisible()" :spread="failed.messageProps()">
    Could not save. Check your connection.
    <button :spread="failed.dismissProps()">×</button>
  </p>
</div>
```

Keep the region mounted whether or not there is anything to say; that makes the
announcement immediate. Rendering it under `:if="failed.isPresent()"` also
works, and pays the announce delay on each appearance. `isMessageVisible()`
goes false the moment the alert closes, so the words leave at once; the region
is what `isPresent()` and `data-state` hold for an exit animation.

**Reserve `assertive` for something the user must act on now** — a failure, a
session about to expire. An assertive region cuts a sentence off mid-word, and a
page that interrupts for confirmations trains people to ignore it.

**An alert never takes focus.** Moving focus to announce would interrupt
whatever the user was typing, and the live region makes it unnecessary. A
message that must be dealt with before anything else is a modal `alertdialog`,
which is a dialog — see [overlays](./primitives-overlays). When the user has
walked into the alert themselves, to press dismiss, closing it puts focus back
where it was before, so it does not fall to `<body>`. That happens on every
path through the alert itself — `close()`, `toggle()`, the dismiss control,
Escape. A consumer who writes a controlled `open` signal directly closes the
alert without it, and owns where focus lands: the focus has to move before the
message is removed, and by the time an effect could react to the write, it
already has been.

`dismissProps()` carries its own `onclick` and `onkeydown`, so it needs no
`:click`. It sets `role="button"`, `type="button"` and `tabindex="0"` together,
because it cannot see what it was spread onto: the role is what makes a `<div>`
announce as a button, and `type` is what stops a `<button>` submitting its
form. On a real button, Enter and Space are left to the browser.

Escape is listened for on the region, so it answers only with focus inside the
alert: an alert is not a layer, and one that swallowed the page's Escape would
take it from the dialog or menu it sits in. The other side of that is that an
alert *inside* an open dialog cannot stop Escape reaching the dialog, whose
dismiss stack listens in the capture phase — one keypress closes both.

### Empty state

```ts
createEmptyState(options: EmptyStateOptions): EmptyState
```

What a collection says when it holds nothing.

| Option | Description |
|---|---|
| `collection` | The list, grid or table. Required. Keep it mounted when empty |
| `region` | The empty state's own element, which is the live region |
| `count` | `() => number`. Left out, items are counted from the DOM |
| `itemAttribute` | The attribute marking an item, when counting from the DOM. Default `data-volt-item` |
| `query` | `() => string` — the search or filter that produced the emptiness |
| `loading` | `() => boolean`. An empty collection mid-load is not empty |
| `announceDelay` | Override the region timing |
| `labels.empty` | Default `Nothing here yet.` |
| `labels.noResults` | `(query) => string`. Default `No results for “query”.` |

| Member | Description |
|---|---|
| `isEmpty()` | Empty and finished loading |
| `count()` | |
| `status()` | `'loading'`, `'empty'` or `'filled'` |
| `message()` | What to show and announce, or `''` |
| `isMessageVisible()` | Whether it may be rendered yet |
| `collectionProps()` | `aria-describedby` while there is a message, `aria-busy` while loading, `data-status`, `data-empty` |
| `rootProps()` | The region: an `id`, `role="status"`, `aria-live="polite"`, `aria-atomic`, `data-status` |
| `messageProps()` | `hidden` except while the collection is empty and the region has settled |

```ts
import { Signal } from '@voltdev/core';
import { createEmptyState } from '@voltdev/primitives';

class Results {
  list = new Signal.State<Element | null>(null);
  region = new Signal.State<Element | null>(null);
  query = new Signal.State('');
  rows = new Signal.State<{ id: string; name: string }[]>([]);
  empty = createEmptyState({
    collection: () => this.list.get(),
    region: () => this.region.get(),
    count: () => this.rows.get().length,
    query: () => this.query.get(),
  });
}
```

```html
<ul :ref="list" :spread="empty.collectionProps()">
  <li :for="row in rows.get()" :key="row.id" data-volt-item>{ row.name }</li>
</ul>
<div :ref="region" :spread="empty.rootProps()">
  <div :if="empty.isMessageVisible()" :spread="empty.messageProps()">
    <h3>{ empty.message() }</h3>
    <button :click="query.set('')">Clear the search</button>
  </div>
</div>
```

**Pass `count` when you have it.** Without it the items are counted from the
DOM, which costs a `MutationObserver` over the whole subtree and sees only
elements carrying the item attribute — the one the package's collections use.
Disabled items are counted: emptiness is about what is there, not what can be
reached.

"Nothing here yet" and "no results" are two messages because they call for two
actions — create something, or search for something else — and a query that is
only whitespace counts as none. It is a live region because filtering a list to
nothing is a change a sighted user sees and a screen reader user is told about
only if something says so. The message is tied to the collection with
`aria-describedby` only while there is one: a reference to an element holding
nothing describes nothing.

## Showing that something is loading

The skeleton and spinner follow the rule under
[Announcing a change](#announcing-a-change) for what they say. What they add is
the other half of a loading indicator: when to show it at all.

### `createDeferredVisibility`

```ts
createDeferredVisibility(active: () => boolean, options?: DeferredVisibilityOptions): DeferredVisibility
```

Show an indicator only if the wait is long enough to be worth showing. The
skeleton and spinner are built on it, and it is exported for any other
indicator with the same problem.

| Option | Description |
|---|---|
| `delay` | Wait this long before showing anything, in ms. Default `0` |
| `minDuration` | Once shown, stay at least this long, in ms. Default `0` |

`isVisible()` and `state()` — `'idle'`, `'delayed'` or `'visible'` — are the
whole surface.

```ts
import { Signal } from '@voltdev/core';
import { createDeferredVisibility } from '@voltdev/primitives';

class Saving {
  busy = new Signal.State(false);
  indicator = createDeferredVisibility(() => this.busy.get(), { delay: 300, minDuration: 500 });
}
```

The delay alone does not remove the flash, it moves it: a response landing
shortly after the delay still puts an indicator up for a few frames.
`minDuration` is the other half, and its cost is real content held back for up
to that long, which is why it is zero unless asked for. A wait that resumes
while the indicator is still up on its minimum does not restart the clock.

### Skeleton

```ts
createSkeleton(options?: SkeletonOptions): Skeleton
```

A placeholder standing in for content while it loads.

| Option | Description |
|---|---|
| `region` | The live region carrying the loading message |
| `loading` | A `Signal.State<boolean>` — a resource's status, most often |
| `defaultLoading` | Starting state when the skeleton owns it. Default `false` |
| `delay` | Hold the placeholder back, in ms. Default `0` |
| `minDuration` | Once up, keep it up at least this long, in ms. Default `0` |
| `announceDelay` | Override the region timing |
| `labels.loading` | Default `Loading…` |
| `labels.loaded` | Default `Loaded`. `''` says nothing |
| `onLoadingChange` | Told each change `setLoading` makes |

| Member | Description |
|---|---|
| `isLoading()` / `setLoading(b)` | |
| `isVisible()` | Whether the placeholder should be on screen |
| `state()` | `'idle'`, `'delayed'` or `'visible'` |
| `message()` | What the status region should say now, or `''` |
| `isMessageVisible()` | Whether it may be rendered yet |
| `placeholderProps()` | `aria-hidden`, `inert` and `data-state` — the boxes and lines |
| `contentProps()` | `aria-busy` while loading, and `data-state` — the container the real content lands in |
| `statusProps()` | The live region: `role="status"`, `aria-live="polite"`, `aria-atomic`, `data-state`. Keep it mounted |
| `messageProps()` | The words inside it: `hidden` until the region has settled and while there is nothing to say |

```ts
import { Signal } from '@voltdev/core';
import { createSkeleton } from '@voltdev/primitives';

class Feed {
  region = new Signal.State<Element | null>(null);
  loading = new Signal.State(true);
  skeleton = createSkeleton({ loading: this.loading, region: () => this.region.get() });
}
```

```html
<div :spread="skeleton.contentProps()">
  <div :if="skeleton.isVisible()" :spread="skeleton.placeholderProps()">
    <div class="line"></div><div class="line"></div>
  </div>
  <article :if="!skeleton.isLoading()">…</article>
</div>
<div :ref="region" :spread="skeleton.statusProps()">
  <span :if="skeleton.isMessageVisible()"
        :spread="skeleton.messageProps()">{ skeleton.message() }</span>
</div>
```

The placeholder is hidden from assistive technology *and* inert. Left visible
to it, a dozen empty boxes are read out as a dozen empty boxes; `aria-hidden`
alone would be a lie on a placeholder holding anything focusable, which stays
reachable by Tab and is nameless when it gets there. One "Loading…" in the
status region replaces the wall. `aria-busy` goes on the content, never on the
region, where it would mean "do not announce me".

"Loaded" is said only after a load has actually started, so a page that was
never loading does not announce a finish. The delay defaults to zero, unlike
the spinner's, because a skeleton *is* the layout: delaying it shows a blank
hole and then a jump, which is worse than the flash it would have avoided.

**`delay` holds back the placeholder, not the words.** The message follows
`loading` and the region's gate and nothing else, so a skeleton given a
`delay` still says "Loading…" once the gate opens and "Loaded" when it ends,
for a wait too short ever to have shown a placeholder. The spinner is the
other way round: nothing is said while it waits out its delay. No test covers
what a delayed skeleton says, so this is read from the source.

### Spinner

```ts
createSpinner(options?: SpinnerOptions): Spinner
```

A busy indicator that does not flash, and says what it is.

| Option | Description |
|---|---|
| `region` | The live region carrying the label |
| `loading` | A `Signal.State<boolean>`, to drive it from outside |
| `defaultLoading` | Starting state when the spinner owns it. Default `false` |
| `delay` | Wait before showing anything, in ms. Default `500` |
| `minDuration` | Once up, keep it up at least this long, in ms. Default `0` |
| `announceDelay` | Override the region timing |
| `labels.loading` | What the wait is called. Default `Loading…` |
| `onLoadingChange` | Told each change `setLoading` makes |

| Member | Description |
|---|---|
| `isLoading()` / `setLoading(b)` | |
| `isVisible()` | Whether the graphic should be on screen — false during the delay |
| `state()` | `'idle'`, `'delayed'` or `'visible'` |
| `label()` | The name of the wait |
| `isMessageVisible()` | Whether the label may be rendered — false during the delay too |
| `rootProps()` | The live region: `role="status"`, `aria-live="polite"`, `aria-atomic`, `data-state`. Keep it mounted |
| `indicatorProps()` | `aria-hidden` and `data-state` — the graphic |
| `labelProps()` | The words: `hidden` whenever `isMessageVisible()` is false |
| `contentProps()` | `aria-busy` while loading, and `data-state` — whatever the user is waiting for |

```ts
import { Signal } from '@voltdev/core';
import { createSpinner, visuallyHidden } from '@voltdev/primitives';

class Save {
  region = new Signal.State<Element | null>(null);
  spinner = createSpinner({ region: () => this.region.get() });
  hidden = visuallyHidden();
}
```

```html
<div :ref="region" :spread="spinner.rootProps()">
  <svg :if="spinner.isVisible()" :spread="spinner.indicatorProps()">…</svg>
  <span :if="spinner.isMessageVisible()" :spread="spinner.labelProps()"
        :style="hidden">{ spinner.label() }</span>
</div>
```

The graphic is hidden from assistive technology and the label carries the
meaning, because a spinning ring has no name and an SVG announced by its markup
is noise. The label is not put on the root as `aria-label`, because a name on a
live region is announced instead of its contents. Nothing is said during the
delay: a wait too short to show is a wait too short to mention.

500 ms is the usual compromise: under about a second a spinner is on and off
before it can be read and the flicker reads as a fault, but a real wait should
be acknowledged before anyone reaches to click again.

## A chat transcript

```ts
createChat<T = unknown>(options: ChatOptions<T>): Chat<T>
```

A transcript that grows at the bottom while someone is reading it, its scroll
position, and a composer.

Built from a list and a textarea, a chat goes wrong in three ways everyone who
uses one recognises: the view jumps when a reply arrives, the reader loses
their place scrolling back through history, and every token of a streamed
answer re-renders the whole conversation. Those three are the hard part, and
they are what `createChat` owns.

### What it covers, and what a chat product still needs

| `createChat` owns | Your application still owns |
|---|---|
| The transcript, with each message's text as a signal of its own | Where messages come from and go — the network, persistence |
| Streaming: `append` changes one text node, and the list does not re-render | The request that produces a reply, reading its stream, and turning it into `append` calls |
| Following the conversation, the unread count, jump-to-latest | Paging older history in at the top — see [Messages](#messages); there is no prepend |
| Windowing, through `createVirtualizer` with measurement on | Every pixel of the layout and all of the styling |
| Author grouping, answered per row | Avatars, names, timestamps — their markup |
| The composer's Enter, its growth, edit-and-resend | Attachments, mentions, slash commands, rich text, drafts that survive a reload |
| Per-message state: typing, streaming, failed | Finding out that someone is typing; presence, read receipts, reactions |
| Per-message actions as one tab stop each | What regenerate, retry and cancel actually *do* |
| The shape of a reply: text, code, quote, reasoning, source | Markdown parsing, syntax highlighting, sanitising what a reply contains |
| The log's ARIA, and saying arrivals in the shared announcer | Branching: an edit or a regeneration drops everything after it |

Two rows in the right-hand column need planning for. **There is no markdown
parser and no syntax highlighter**, deliberately: both are choices about
rendering, and neither could be undone by an application that wanted a
different one. Turning a reply's text into parts is yours, and `addPart` and
`setParts` are where the result goes. **A transcript is a line, not a tree**:
editing a message or regenerating a reply deletes every message after it,
because leaving them in place would show a conversation that never happened.
An application that wants to keep the old branch has to keep it itself.

Some of the left-hand column is not finished, and each gap is described where
it comes up:

- a reply added as `typing` is never counted as unread, even once it has
  arrived; `cancel` does not stop `append` writing; and `retry` cannot put a
  reply back to waiting, so a failed reply is restarted with `regenerate` —
  [Streaming a reply](#streaming-a-reply);
- nothing keeps a focused message rendered, so scrolling it out of the window
  drops focus on `<body>` — [Actions](#actions);
- every code part is a tab stop whether or not it overflows, and a source
  part with no `href` is spread as a link to "undefined" — [Parts](#parts);
- a server renders the oldest messages rather than the newest —
  [On a server](#on-a-server).

### Wiring it up

```ts
import { Component, Signal } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { createChat, type Chat, type ChatMessage } from '@voltdev/primitives';

@Component({
  selector: 'v-room',
  render: compileTemplate(`
    <div :ref="scroller" :spread="chat.logProps()" :keydown="onLogKey($event)">
      <div :spread="chat.sizerProps()">
        <div :ref="list" :spread="chat.containerProps()">
          <div :for="row in chat.rendered()" :key="row.id" :spread="chat.messageProps(row)">
            <b :if="row.startsGroup">{ row.message.name }</b>
            <p>{ row.message.text() }</p>
            <span>{ chat.statusText(row.message) }</span>
            <div :spread="chat.actionsProps(row.message)" :keydown="onActionKey(row.message, $event)">
              <button :for="action in chat.actionsFor(row.message)" :key="action"
                      :spread="chat.actionProps(row.message, action)"
                      :click="chat.activate(row.message, action)">{ action }</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <button :if="chat.showJumpToLatest()" :spread="chat.jumpToLatestProps()"
            :click="chat.jumpToLatest()">{ chat.unreadCount() } new</button>
    <textarea :ref="composer" :spread="chat.composerProps()"
              :input="chat.onComposerInput($event)" :keydown="onComposerKey($event)"></textarea>
  `),
})
export class Room {
  scroller = new Signal.State<Element | null>(null);
  list = new Signal.State<Element | null>(null);
  composer = new Signal.State<Element | null>(null);

  // Annotated because the callbacks refer to the field they initialise.
  chat: Chat = createChat({
    scroller: () => this.scroller.get(),
    container: () => this.list.get(),
    composer: () => this.composer.get(),
    self: 'ada',
    onSend: (text) => {
      this.chat.add({ author: 'ada', name: 'Ada', text });
      this.ask(text);
    },
    // Everything after the edited message has already been removed.
    onResend: (_message, text) => this.ask(text),
    // Already emptied and set typing; fetching the new reply is ours.
    onRegenerate: (reply) => void this.stream(reply, this.promptBefore(reply)),
    // `retry` leaves a message idle, and only `regenerate` sets one waiting
    // again. Only Ben's replies fail in this example.
    onRetry: (reply) => this.chat.regenerate(reply.id),
  });

  ask(text: string): void {
    const reply = this.chat.add({ author: 'ben', name: 'Ben', typing: true });
    void this.stream(reply, text);
  }

  promptBefore(reply: ChatMessage): string {
    const list = this.chat.messages();
    return list[list.indexOf(reply) - 1]?.text() ?? '';
  }

  async stream(reply: ChatMessage, prompt: string): Promise<void> {
    try {
      for await (const token of replyTokens(prompt)) {
        // Stopped, or thrown away. `append` would write the token regardless.
        const status = reply.status();
        if (status !== 'typing' && status !== 'streaming') return;
        this.chat.append(reply.id, token);
      }
      this.chat.finish(reply.id);
    } catch {
      this.chat.fail(reply.id, 'The connection dropped');
    }
  }

  onLogKey(event: KeyboardEvent): void {
    // A key the action toolbar already used has bubbled here; Home and End
    // would otherwise also scroll the whole transcript.
    if (!event.defaultPrevented && this.chat.onKeyDown(event)) event.preventDefault();
  }

  onActionKey(message: ChatMessage, event: KeyboardEvent): void {
    if (this.chat.onActionKeyDown(message, event)) event.preventDefault();
  }

  onComposerKey(event: KeyboardEvent): void {
    if (this.chat.onComposerKeyDown(event)) event.preventDefault();
  }
}
```

The three elements are the scroller, a sizer as long as the transcript claims
to be, and a container the rendered window is translated into. `scroller` and
`container` are required; `composer` is needed only by what writes to it —
`send`, `setDraft`, `beginEdit`.

| Props | For | Carries |
|---|---|---|
| `logProps()` | The scroller | `tabindex="0"`, a style of `overflow-anchor: none`, `role="log"`, `aria-live="off"`, the name |
| `sizerProps()` | The sizer | A style whose `height` is the transcript's total size, `role="presentation"` |
| `containerProps()` | The container | A style of `transform: translateY(…)` to the window's offset, `role="presentation"` |
| `messageProps(row)` | Each rendered row's outermost element | `data-volt-virtual-index`, which is how the row is found and measured, and the rest under [Messages](#messages) |
| `composerProps()` | The `<textarea>` | `rows`, the name, `enterkeyhint="send"`, and the sizing style under [The composer](#the-composer) |
| `jumpToLatestProps()` | The jump control | `type="button"` and a name carrying the unread count |

None of them makes the scroller scroll. Its height and `overflow-y: auto` are
your CSS, and a scroller left to grow with its content has nothing to window
and no end to follow.

None of the keyboard handlers call `preventDefault`. The log's `onKeyDown` in
particular must not be left without it, or the browser scrolls a second time on
Page Down. And because the action toolbars sit inside the log, their keys reach
the log's handler too: `onKeyDown` does not look at where a key came from, so
the check on `defaultPrevented` above is what stops Home in a toolbar from also
sending the reader to the first message.

### Options

| Option | Description |
|---|---|
| `scroller` | The element that scrolls, which carries `role="log"`. Required |
| `container` | The element the rendered window lives in. Required |
| `composer` | The `<textarea>` |
| `itemSize` | First guess at a message's height, or `(index) => number`. Default `72` |
| `gap` | The space your CSS puts between messages, in px, so the arithmetic agrees with it. It adds no space itself. Default `0` |
| `overscan` | Messages rendered beyond the viewport, as a number for both ways or `{ before, after }`. Default `2` |
| `bottomThreshold` | How close to the end still counts as at the end, in px. Default `32` |
| `groupWithin` | Same-author messages group only this close together, in ms. Default no limit |
| `announceMessages` | Say arriving messages in the shared announcer. Default `true` |
| `rows` / `maxRows` | Composer lines at the start, and at most. Default `1` and no limit |
| `self` | Which author is the person at this keyboard |
| `actions` | `(message) => ChatActionName[]`. Replaces the default set entirely |
| `labels` | Every string it says; see [Labels](#labels) |
| `onSend` | `(text)` — the composer sent a message. You call `add` |
| `onResend` | `(message, text)` — an edited message was sent again |
| `onRegenerate` / `onRetry` / `onCancel` | `(message)` — that action was taken |
| `onPinnedChange` | `(pinned)` — the view stopped or started following |

### Messages

| Member | Description |
|---|---|
| `messages()` | The whole transcript, oldest first |
| `rendered()` | The window to render: each row's `index`, `id`, `message`, `startsGroup`, `endsGroup` |
| `add(input)` | Append a message and return it |
| `setMessages(inputs)` | Replace the transcript, opening it at its end with nothing unread |

A message input is `{ author, id?, name?, text?, timestamp?, streaming?,
typing?, parts?, data? }`. `author` is an identity, not a display name —
grouping compares it, so two people called Sam must not share it. `name` is
what is shown and announced, and defaults to `author`. `timestamp` defaults to
now and is read only by `groupWithin`. `data` carries whatever your application
needs, typed by `T`.

A `ChatMessage` has `id`, `author`, `name`, `timestamp` and `data`, and reads
the rest through signals: `text()`, `streaming()`, `status()` — `'idle'`,
`'typing'`, `'streaming'` or `'error'` — `error()` and `parts()`.

**A message's text is its own signal**, and that is why streaming is cheap
here. `append` writes one signal; one text binding re-runs; one text node's
data changes. The array of messages never fires, so the loop never re-runs, no
element is created or destroyed, and the scroll position cannot move because
nothing was replaced. Read `row.message.text()` in the template rather than
reading it out and passing a string down — the binding subscribed to that
signal is what makes a token cost one text node instead of one list.

**Grouping is a view, not a change to the data.** `startsGroup` and `endsGroup`
are answered per rendered row from its neighbours, so nothing is written onto
the messages and a message arriving mid-run re-groups both sides of itself.
They reach the DOM as `data-group-start` and `data-group-end` on
`messageProps(row)`, which also carries `role="article"`, the author's name as
`aria-label`, `data-streaming`, `data-status` whenever it is not idle, and the
virtualizer's `data-volt-virtual-index`.

**Windowing is `createVirtualizer` with measurement on**, because no message
has a knowable height. `itemSize` is only the first guess. Measurements are
cached against the message id rather than its position, and each row carries
`aria-setsize` and `aria-posinset` for the whole transcript rather than the
window.

**Loading a conversation is supported; paging older history in is not.**
`add` appends and `setMessages` replaces; `regenerate` and a resend only ever
remove. `setMessages` rebuilds every message, is not announced — history is not
news — forgets an edit in progress, and re-pins, so the view goes to the newest
message. That is right for opening a conversation or switching to another. It
is wrong for a reader who scrolled to the top to see more: calling
`setMessages` with older messages in front keeps the measurements of every
message whose `id` it is given again — they are keyed by id, and an input
without one is given a fresh id and measured from scratch — but takes the
reader to the bottom. There is no prepend that holds their place.

### Streaming a reply

| Member | Description |
|---|---|
| `append(id, token)` | Add to the last part's text. The first token turns `typing` into `streaming` |
| `finish(id)` | A typing or streaming message is done — which is when it is announced |
| `fail(id, error?)` | Status becomes `'error'`, and the reason is announced |
| `cancel(id)` | Stop a typing or streaming message: it goes idle, and `onCancel` is called |
| `retry(id)` | Clear a failure, go idle, and call `onRetry` |
| `regenerate(id)` | Delete everything after the message, empty it, set it typing, call `onRegenerate` |
| `statusText(message)` | "Ada is typing", "Ada is replying", the failure — or `''` |

**A message's state is the message's.** Typing, generating and failed are read
from the message they are about, so they change with it. Tracked alongside the
transcript instead, each becomes a second thing to keep in step, and the one
that drifts is always the indicator that never goes away.

`add` with `typing: true` shows that a reply is coming before there is a token
of it, and is not counted as unread — the count is of things there are to read.
**Nothing counts it later, either.** Neither the first token nor `finish`
touches the count, so a reply started as `typing` — the pattern in the example
above — that arrives while the reader is scrolled up leaves `unreadCount()`
where it was. The jump control still appears, since it follows the pin, but it
is named "Jump to latest" rather than "1 new message". A message added with
`streaming: true` is counted when it is added. The tests check that a typing
message is not counted; none follows one through to its finish.

A streaming or typing message is not announced when it is added, only when it
is finished: once per token would be an unusable stutter. `finish` will not
clear a failure, so a message that failed mid-stream keeps its retry. A
cancelled message keeps whatever text had arrived and is not announced.
`append` ignores an unknown id and an empty token.

**`cancel` stops the message, not your request.** `append` checks the id and
that the token is not empty, and not the status, so a token that arrives after
`cancel` is still written into the cancelled message. Abort the request in `onCancel`, or check the status before
each `append` as the example does.

**`retry` does not restart a reply.** It clears the failure and leaves the
message `idle` with whatever text it had, which suits a message the reader
sent and the network refused. Nothing but `regenerate` puts a message back to
`typing`, and `append` does not move an idle message to `streaming`, so a reply
retried with `retry` alone would take new tokens on the end of the old ones
and never be announced. The example's `onRetry` calls `regenerate`, which
empties it and asks through `onRegenerate`.

### Parts

A message is one text part over its `text` unless it is given `parts`. Each
kind exists because it changes the *accessible shape* of the message — a name,
a role or a control — not because it looks different, which is why emphasis
and links are not on the list.

| Kind | What `partProps(part)` makes of it |
|---|---|
| `text` | Nothing but `data-part` |
| `code` | `role="group"` named `Code, ts`, `data-language`; its content gets `tabindex="0"`, since code scrolls sideways. Always, unlike [`createCode`](#code), which measures and adds the tab stop only while the block overflows — so every code part in the window is a Tab press, a one-line snippet included |
| `quote` | `role="blockquote"` |
| `reasoning` | `role="group"` named `Reasoning` or its `title`, `data-state`; closed unless `open: true` |
| `source` | A name — `Source 2: Widgets` — and `href`, so it belongs on an `<a>` |

| Member | Description |
|---|---|
| `addPart(id, part)` | Give a message another part, and return it. Tokens then stream into it |
| `setParts(id, parts)` | Replace a message's shape. An empty list makes it a plain message with no text |
| `partProps(part)` | The part's outer element, where its role and name live |
| `partContentProps(part)` | The element holding its text: an `id`, `hidden` while folded, `tabindex="0"` on code |
| `partToggleProps(part)` | The button that folds reasoning: `type="button"`, `aria-expanded`, `aria-controls`, `data-state` |
| `partCopyProps(part)` | The button that copies a code block: `type="button"`, named `Copy code`, `data-state` from `copyStatus` |

A `ChatPart` has `id`, `kind`, `index`, `ordinal` — its position among parts of
the same kind, from 1, which is what "Source 2" counts — `language`, `href`,
`title`, and `text()`, `isOpen()` and `toggle(open?)`. A plain message's one
part shares the message's own text signal, so a template that walks parts pays
for a token exactly what one that renders `text()` pays.

```html
<template :for="part in row.message.parts()" :key="part.id">
  <a :if="part.kind === 'source'" :spread="chat.partProps(part)">[{ part.ordinal }]</a>
  <div :else :spread="chat.partProps(part)">
    <button :if="part.kind === 'reasoning'" :spread="chat.partToggleProps(part)"
            :click="part.toggle()">Reasoning</button>
    <button :if="part.kind === 'code'" :spread="chat.partCopyProps(part)"
            :click="chat.copyPart(part)">Copy</button>
    <div :spread="chat.partContentProps(part)">{ part.text() }</div>
  </div>
</template>
```

Tokens never decide for themselves where a part ends — deciding that is
parsing, and parsing is yours — so `append` always writes into the last part,
and `addPart` is how a new one starts. What a structured message *says*, for
copying and for its announcement, is its parts joined with blank lines,
leaving out reasoning and sources: reasoning is how the answer was reached and
is usually folded away unread, and a citation's body is a URL. Its number and
title are in its accessible name, which is where they belong.

**Give every source an `href`.** `partProps` writes `href` whether or not the
part has one, and `:spread` sets `href` on an `<a>` as a property, so a source
without one is spread as `href="undefined"` — a link to a page called
"undefined" beside the current one. A citation with nothing to point at
belongs in a `<span>`.

### Actions

| Member | Description |
|---|---|
| `actionsFor(message)` | Which of `copy`, `edit`, `regenerate`, `retry`, `cancel` it offers, in order |
| `activate(message, action)` | Run one — what a `:click` binds to |
| `actionsProps(message)` | `role="toolbar"`, named `Message actions` |
| `actionProps(message, action)` | Each button: `type`, the roving `tabindex`, its name, `data-state` for copy |
| `onActionKeyDown(message, event)` | Left and Right across the toolbar, wrapping at the ends; Home and End. `true` when consumed |
| `copyMessage(id)` / `copyPart(part)` | Copy through the shared clipboard. Resolve `true` on success |
| `copyStatus(key)` | The copy state of a message id or part id; `'idle'` for everything else |

The default set is decided by the message's state first, then by who sent it:

| Message | Offers |
|---|---|
| Typing or streaming | `cancel` |
| Failed | `retry`, `copy` |
| No `self` given | `copy` |
| Sent by `self` | `copy`, `edit` |
| Sent by anyone else | `copy`, `regenerate` |

Without `self`, a message offers copy alone — a primitive that cannot tell
whose message it is has no business guessing. `actions` replaces the whole
rule for an application whose rule is different.

**Each message's actions are one tab stop.** A transcript of forty messages
with four buttons each would otherwise be a hundred and sixty Tab presses deep.
The arrows move within a toolbar, mirrored in a right-to-left layout, and
Enter and Space are left to the buttons. The tab stop remembers its column
across messages, so a reader tabbing down the transcript stays on "Copy"
rather than being put back at the start of every row; a click moves it too. The
toolbar and its buttons are found through the `data-chat-actions` and
`data-chat-action` attributes the props write, so whatever markup you put
between them is yours.

**Tab walks the window, not the transcript.** Only rendered messages have
toolbars in the DOM, so Tab visits the messages in and around the viewport
and then leaves the log; the log's own keys are how a keyboard reader goes
further. Nothing keeps a focused message rendered, either. Scroll it out of
the window — with Page Down, or by the view following new messages while it
is pinned — and the button holding focus is removed with its row, which
leaves focus on `<body>`. A windowed tree moves focus with its window — see
[collections](./primitives-collections#windowing-a-tree); the chat does not
yet, and no test covers focus while the transcript scrolls.

Only one copy is in flight at a time, because there is one clipboard; two
messages copied in turn do not both show as copied.

### Following the conversation

| Member | Description |
|---|---|
| `isPinned()` | Whether new content will be followed |
| `isAtBottom()` | Whether the view is at the end right now |
| `unreadCount()` | Messages that arrived while not following |
| `showJumpToLatest()` | Whether the jump control has anything to offer |
| `jumpToLatest(options?)` | Go to the newest message, clear the count and follow again. `options` is `{ behavior }`, default `'auto'` |

*At the bottom* is an observation about geometry. *Pinned* is an intention —
whether new content should be followed. They must not be the same value,
because the instant a message arrives the view is no longer at the bottom, and
a pin derived from geometry would release itself exactly when it is needed. So
the pin changes on one thing only: the scroll offset *moving*. Growth is not
movement.

| Case | What happens |
|---|---|
| A message arrives while pinned | The view follows the new end — and again when the message is measured and turns out taller than guessed |
| A message arrives while scrolled up | Nothing scrolls, and `unreadCount()` goes up by one — unless it was added as `typing`; see [Streaming a reply](#streaming-a-reply) |
| The reader scrolls away | Following stops on that move, not after a timeout |
| The reader scrolls back within `bottomThreshold` | Following resumes and the count clears; there is nothing to press |
| Content above the viewport grows | The virtualizer compensates so the view stays on what was being read; the pin is untouched |

`logProps()` turns the browser's own scroll anchoring off, so it and the
virtualizer do not both correct the same shift. Nothing else touches the pin
except `jumpToLatest` and `setMessages`, which opens a conversation at its end
with nothing unread. `bottomThreshold` defaults to 32 px rather than zero
because fractional layout and zoom leave a reader who is visibly at the bottom
a fraction of a pixel short, and a chat that unpins there stops following for
no reason anyone can see; it is not larger because a reader who scrolled up
one line would be dragged back down. Both ends are yours to choose — nothing
refuses a zero.

Because the pin follows every reported offset, a jump with `behavior:
'smooth'` works against it: each frame of the animation further than
`bottomThreshold` from the end is a move away from it, so the view is unpinned
until the animation lands — `onPinnedChange` told `false`, and the jump
control back on screen meanwhile. A message that arrives during the animation
is counted as unread and moves the end, so the jump can land short of it and
stay unpinned. The tests jump with the default, which lands in one move.

### The composer

| Member | Description |
|---|---|
| `draft()` / `setDraft(text)` | What is in the composer. `setDraft` writes the box too |
| `canSend()` | Whether there is anything but whitespace |
| `send()` | Send the draft, trimmed, empty the composer, and return what was sent — or `null` when there was only whitespace |
| `editing()` | The message being edited, or `null` |
| `beginEdit(id)` | Put a message's text in the composer, and focus it |
| `cancelEdit()` | Leave the message alone and empty the composer |
| `onComposerKeyDown(event)` | Enter sends. `true` when it consumed the key |
| `onComposerInput(event)` | Keeps the draft in step with the box |

Enter sends; Shift+Enter is a newline; an Enter that commits an input method's
candidate is left alone, or it would cut a sentence in half in every language
that composes; Enter with Ctrl, Meta or Alt is left to whatever the application
bound it to. Enter on a composer holding only whitespace sends nothing but is
still consumed, so it does not leave a blank line behind.

The box is the source of truth while someone is typing: the draft follows it on
input, and it is written only when something other than typing changed the
draft. A value written back on every keystroke moves the caret to the end.

An edited message sent again calls `onResend`, not `onSend`: the transcript
already holds that message, and a second copy is what edit-and-resend must not
produce. Everything after it is removed, as with `regenerate`. `setMessages`
forgets an edit in progress.

**The composer grows by CSS, not by script.** `composerProps()` sets
`field-sizing: content` with a `min-height` of `rows` and a `max-height` of
`maxRows`, in `lh`. A hidden mirror element measured on every keystroke is the
alternative, and it has to track every font, padding and border the real box
has. The cost is that growth depends on the browser supporting
`field-sizing`; where it does not, the composer stays at `rows` lines and
scrolls.

### What it says

The log is `role="log"`, named `Messages`, with `aria-live="off"`. A log is a
polite live region by default, and under virtualization that is a trap: rows
enter and leave the DOM as the reader scrolls, and the region would read out
old messages for being scrolled past. Arrivals are said instead through the
document's shared polite announcer — one sentence per message that arrived,
`Ada: hello` by default — and never assertively, because a conversation that
cuts the reader off every time somebody types is worse than one that says
nothing. A failure is said the same way, through `labels.failed`. History
loaded with `setMessages` is not announced.

Every message `add` receives in the `idle` state is said, the reader's own
included: `self` is read only by the default actions, so in the example above
pressing Enter on "hello" is followed by "Ada: hello". Whether that echo is a
confirmation or noise is a product decision. `announceMessages: false` turns
off all of it — arrivals, finishes and failures — and leaves what is said to
your own calls to the [shared announcer](./primitives#announcements-announce).

### Labels

| Label | Default |
|---|---|
| `log` | `Messages` |
| `composer` | `Message` |
| `jumpToLatest(unread)` | `Jump to latest`, `1 new message`, `3 new messages` |
| `messageArrived(message)` | `Ada: hello` |
| `actions` | `Copy message`, `Edit and resend`, `Regenerate reply`, `Try again`, `Stop generating` |
| `actionGroup(message)` | `Message actions` |
| `typing(message)` | `Ada is typing` |
| `generating(message)` | `Ada is replying` |
| `failed(message, error)` | `Ada: rate limited`, or `Ada's message could not be sent` |
| `codeBlock(language)` | `Code, ts`, or `Code` |
| `copyCode` | `Copy code` |
| `reasoning(title)` | The title, or `Reasoning` |
| `source(ordinal, title)` | `Source 2: Widgets`, or `Source 2` |

The jump control's name carries the count because that is the only place a
screen reader user can hear it: a "3" drawn beside the button is invisible to
them.

## Types

Every option bag, return type, prop bag and union above is exported by name,
for code that has to write one down — an annotated field, as in the chat
example, or a function that takes a message.

| For | Types |
|---|---|
| `visuallyHidden` | `VisuallyHiddenStyle` |
| `createAvatar` | `Avatar`, `AvatarOptions`, `AvatarProps`, `AvatarStatus` |
| `createImage` | `Image`, `ImageOptions`, `ImageProps`, `ImageBoxProps`, `ImageBoxStyle`, `ImageStatus` |
| `createProgress` | `Progress`, `ProgressOptions`, `ProgressLabels`, `ProgressProps`, `ProgressState` |
| `createBadge` | `Badge`, `BadgeOptions`, `BadgeLabels`, `BadgeProps`, `BadgeLive` |
| `createRelativeTime` | `RelativeTime`, `RelativeTimeOptions`, `RelativeTimeLabels`, `RelativeTimeProps`, `RelativeTimeUnit` |
| `createKbd` | `Kbd`, `KbdOptions`, `KbdLabels`, `KbdProps`, `KbdPart`, `KbdPlatform` |
| `createCode` | `Code`, `CodeOptions`, `CodeLabels`, `CodeProps` |
| `createSeparator` | `Separator`, `SeparatorOptions`, `SeparatorResizeOptions`, `SeparatorProps`, `SeparatorOrientation` |
| `createChip` | `Chip`, `ChipOptions`, `ChipLabels`, `ChipProps` |
| `createLiveRegionTiming` | `LiveRegionTiming` |
| `createAlert` | `Alert`, `AlertOptions`, `AlertLabels`, `AlertProps`, `AlertPriority` |
| `createEmptyState` | `EmptyState`, `EmptyStateOptions`, `EmptyStateLabels`, `EmptyStateProps`, `EmptyStateStatus` |
| `createDeferredVisibility` | `DeferredVisibility`, `DeferredVisibilityOptions`, `LoadingState` |
| `createSkeleton` | `Skeleton`, `SkeletonOptions`, `SkeletonLabels`, `SkeletonProps` |
| `createSpinner` | `Spinner`, `SpinnerOptions`, `SpinnerLabels`, `SpinnerProps` |
| The feedback prop bags | `FeedbackProps`, `FeedbackHandler` — the alert's, skeleton's, spinner's and empty state's props are this type |
| `createChat` | `Chat`, `ChatOptions`, `ChatLabels`, `ChatProps`, `ChatPropValue`, `ChatMessage`, `ChatMessageInput`, `ChatMessageStatus`, `ChatRow`, `ChatPart`, `ChatPartInput`, `ChatPartKind`, `ChatActionName` |

`Image` has the name of the DOM's own `Image` constructor. Imported into a
module, it hides the global there, so a file that also calls `new Image()`
should import it under another name.

## On a server

A server drains render and data effects and stops there — see
[what a server does not run](./server#what-a-server-does-not-run). Several
primitives here rely on an ordinary `effect`, so their server markup is what
they start from, not where they end up:

| Primitive | What the server writes |
|---|---|
| Avatar, Image | `data-status="idle"` whatever the source; the load is watched once the page attaches |
| Alert, Empty state, Skeleton, Spinner, given a `region` | The region, empty. The gate opens only in a browser, so the words arrive after the page attaches |
| Skeleton, Spinner | No placeholder or graphic — deferred visibility never turns on |
| Empty state without `count` | A count of zero, because the DOM count is taken by an effect — so a full list is written with `data-empty` and an `aria-describedby` pointing at the empty region until the page attaches. Pass `count` |
| Code | Never scrollable, so no tab stop and no region |
| Keyboard shortcut | The `other` symbols, unless `platform` is passed |
| Relative time | The text as of the render; the page rewrites it when it attaches |
| Chat | The *oldest* messages — the first and its overscan — because a server has no viewport and does not run the effect that follows the end. The view moves to the newest once the page attaches. Nothing is announced |

The badge, progress bar, separator and chip compute their props directly and
write the same thing on both sides.
