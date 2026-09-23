# Feedback components

What the page says about itself: that something went wrong or went well, how
far along a piece of work is, that work is happening and nobody knows how much,
and the shape of what has not arrived yet.

Each component below is a tag you write, with the primitive that owns its
behaviour named beside it. See [the package](./ui) for the two entries, the
stylesheet, the tokens and how to override a rule.

Three of the four move, and all three are timed with `--volt-duration-slow`,
which is the whole of how `prefers-reduced-motion` reaches them: the preference
repoints that token at zero. Each is drawn so that it says the same thing
standing still — a spinner is a full ring with one edge picked out, not a dot
that only reads as work while it orbits.

## `<v-alert>`

`createAlert`, with the markup written: something about the page itself, said
where the reader already is. Not a toast — it sits in the layout you wrote it
in, and it stays until something takes it away.

<Demo name="alert" height="420" />

```html
<v-alert
  :ref="failure"
  severity="danger"
  title="Could not save the project"
  :open="failed"
  dismissible
  actionLabel="Retry"
  :onAction="retry"
>
  The connection dropped at 40%. Everything saved before that is still there.
</v-alert>
```

```ts
failed = new Signal.State(false);
failure: VAlert | null = null;

retry = (): void => {
  // The press came from inside the alert, so close it through the primitive:
  // that moves focus out before the box goes.
  this.failure?.alert.close();
};
```

The tag draws two elements, and the split is the point. The outer one is a
live region, and it is on the page from the moment the tag is, whether there
is anything to say or not; the box with the border, the mark and the words is
inside it and comes and goes. That order is what makes an alert audible: a
screen reader announces what *changes* inside a region, not what a region
arrives holding, so markup that puts `role="alert"` and a sentence into the
page in one mutation — which is what everybody writes — announces nothing at
all. The primitive owns the timing, and the words are held back until the
region has settled. Nothing here ever moves focus; a message that has to be
dealt with before anything else is a modal `alertdialog`, which is
[`<v-dialog>`](./ui-overlays#v-dialog).

| `<v-alert>` | Type | Means |
|---|---|---|
| `open` | `Signal.State<boolean>` | Your signal, when whether the alert is up belongs to your component |
| `defaultOpen` | `boolean` | Where it starts, when the alert owns that. Default true |
| `severity` | `'info' \| 'success' \| 'warning' \| 'danger'` | What kind of thing this is. Default `info` |
| `title` | `string` | The line in bold over the words. Left out, the body is the whole message |
| `dismissible` | `boolean` | Draw the control that takes the alert away. Default false |
| `dismissLabel` | `string` | What that control is called. Default the locale's word for it, then `Dismiss` |
| `actionLabel` | `string` | The words on the one thing to do about this. Blank draws no button |
| `onAction` | `() => void` | What pressing that button does. The alert stays up |
| `priority` | `'polite' \| 'assertive'` | Override the priority `severity` implies |
| `closeOnEscape` | `boolean` | Escape dismisses it, while focus is inside it. Default true |
| `onOpenChange` | `(open: boolean) => void` | Called each time it opens or closes |

Slots: the default slot is the body — whatever the alert has to say, as much
markup as it takes. `icon` is the mark drawn beside it, and taking it replaces
the glyph the component draws with your own:

```html
<v-alert severity="warning" title="Storage is almost full">
  <template :slot-icon><MyIcon name="gauge" /></template>
  You are using 92% of 10 GB.
</v-alert>
```

**Severity is drawn three times, because once is not enough.** A hue down the
leading edge is the one everybody sees; a user with a forced palette sees none
of it, since four hues come out of their palette as one, so the same edge
carries a border style per severity, which is geometry. The third is the mark:
`i`, `✓`, `!`, `✕`, drawn by the component rather than left to the caller,
because an icon the caller has to remember is a default that distinguishes
severity by colour alone. What severity is *not* is a word anyone hears. A
screen reader is told how urgent the alert is — `danger` gets `role="alert"`
and interrupts, everything else gets `role="status"` and waits for a gap — and
nothing more, so a message whose severity matters says so in its own words:
`title="Could not save"`, not `title="Save"` in red.

**Do not name it.** `aria-label` and `aria-labelledby` on a live region are
announced *instead of* its contents in some screen readers, which here is the
whole message lost. Nothing in the component writes a name, and one written on
the tag reaches the region through `:host` — which is where everything else
you write on the tag lands too, because the region is the element carrying the
role. `<v-alert class="wide" id="save-failed">` is about that element: your
class joins the sheet's, and your id addresses the thing with `aria-live` on
it.

**The action does not take the alert down.** That is the opposite of a toast,
and deliberate: a toast is an announcement that something happened and is
stale once its one action has been taken, while an alert is a statement about
the page, and `Retry` does not make it untrue. The page that knows whether the
retry worked is the page that closes it. Close it through the primitive —
`:ref` on the tag and `alert.close()` — rather than by writing your own `open`
signal, whenever the press that closes it came from inside the alert: the
button being pressed is inside the box about to be removed, and `close()` puts
focus back where it came from first, where a write straight to the signal
leaves a keyboard user on `<body>` at the top of the document. Driving `open`
from elsewhere on the page has nothing to move and is fine either way. An
`actionLabel` that is blank draws no button at all, rather than an unnamed one
in the middle of a live region — and so is a blank `dismissLabel`, which keeps
the primitive's name rather than erasing the only one that control has.

The alert starts up, which the primitive does not: `createAlert` begins closed
because most of its callers raise an alert from code that has just failed, and
a tag written in markup is there because the page put it there. Write
`:defaultOpen="false"` for one that waits, or hand it an `open` signal and
drive it from outside.

`defaultOpen`, `priority` and `closeOnEscape` are read once, when the
primitive is built, so they are not signals and changing them later does
nothing — `role` and `aria-live` in particular are not reliably re-read once a
region exists, which is why an alert cannot change its mind about how loud it
is. Everything else in the table is a signal: bind one and it follows,
including while the alert is up.

Escape is the alert's only while focus is inside it. An alert is not a layer,
and one that swallowed the page's Escape would take it from the dialog or the
menu it sits in — so it joins the dismiss stack as focus enters and leaves as
focus does, and inside an open dialog one press closes the alert and leaves
the dialog open. Dismissing puts focus back where it came from rather than
dropping it on `<body>`.

A closed alert is still in your layout: its region is an empty block, which a
flex or grid column counts as an item. That is the trade the announcement is
worth — and it is the shape the primitive recommends, so a message that has
been up once is the only one that ever pays the settling wait.

For anything this does not offer — the presence state, the priority it
settled on, opening it from somewhere else entirely — take the primitive:

```html
<v-alert :ref="failure" severity="danger" title="Could not save"></v-alert>
```

```ts
failure: VAlert | null = null;
recovered(): void { this.failure?.alert.close(); }
```

## `<v-progress>`

`createProgress`, with the markup written: a track, a bar inside it, and the
value underneath in the language the page is written in. Determinate or not —
`null` is the bar that says work is happening without claiming how much is
left.

<Demo name="progress" height="260" />

```html
<v-progress :value="sent" label="Uploading photos"></v-progress>
```

```ts
sent = new Signal.State<number | null>(0);
```

The value is nullable rather than a number beside an `indeterminate` flag, and
that is the one design decision here worth reading twice. A flag and a number
can disagree, and when they do the number is the one a screen reader announces
as fact — "0 percent" on a bar that may be nearly finished. With `null` there
is nothing to disagree with: no `aria-valuenow` is written at all, and the
sheet puts the bar in motion instead of at a width.

| Prop | Type | Means |
|---|---|---|
| `value` | `Signal.State<number \| null>` | Your signal. `null` is indeterminate |
| `defaultValue` | `number \| null` | Where it starts, when the bar owns its value |
| `min`, `max` | `number` | The range, reported as `aria-valuemin` and `aria-valuemax`. Default 0 and 100; `max` is the value that counts as done |
| `format` | `(value: number, percent: number) => string` | What the value reads as, in the label and in `aria-valuetext` |
| `indeterminateLabel` | `string` | What is said while there is no value. Default the locale's `Loading…`; `''` says nothing |
| `label` | `string` | Names the bar, which cannot be named by the label drawn inside it |
| `labelledBy` | `string` | Id of the element that names it, when something on the page already does |
| `aria-label`, `aria-labelledby`, `aria-describedby` | `string` | The same names in the platform's spelling, and the one only the platform has |
| `showValue` | `boolean` | Whether the value is drawn under the track. Default true |
| `onValueChange` | `(value: number \| null) => void` | Called with the value the bar moved to |

Slots: the default one is the label, handed `{ value, percent, valueText }` —
the clamped number, its percentage of the range, and the string the label would
otherwise have said. Write it for a sentence around the value:

```html
<v-progress :value="sent" label="Uploading photos" :slot-default="{ valueText }">
  { valueText } of the album
</v-progress>
```

Turning `showValue` off removes the label element, and takes whatever was
written inside the tag with it. Nothing is lost to a screen reader either way:
the value is in `aria-valuetext`, and the label is not announced at all.

That last part is the thing to know before writing this by hand. `progressbar`
makes its children presentational, so nothing inside the bar reaches the
accessibility tree — not the label, not an icon, not a heading. It is why the
bar has to be named from outside its own contents, with `label` or
`labelledBy`, and why the visible value and `aria-valuetext` are the same
string computed once rather than two that can drift.

That string comes from `Intl.NumberFormat`, so a French page gets `38 %` and an
Arabic one its own digits, where `${percent}%` would have written English
everywhere. Give `format` whenever the range is not a proportion of anything:
`3 of 8 files` is what "step 3 of 8" should sound like, and a reader told `38%`
about eight files has been told the wrong thing.

`defaultValue`, `min`, `max` and `onValueChange` are read once, when the
primitive is built, so they are not signals and changing them later does
nothing. Everything the bar draws follows whatever you bind it to: `value`,
`showValue`, `format`, `indeterminateLabel` and everything that names or
describes the bar. `format` and `indeterminateLabel` reach `aria-valuetext` on
the same pass as the label, because the two are one string read twice.

`value` is a signal your component holds, and markup has no way to write one —
`value="40"` hands over the string, so it is refused with a message that names
the tag and points at `defaultValue`. `defaultValue` itself takes either
spelling: `defaultValue="40"` and `:defaultValue="40"` are the same number.

Two of the things the sheet draws are information rather than emphasis, and
both survive a reader's own palette. Whether the bar has finished is one: a
full track and a nearly full one are the same picture at a glance, so `complete`
is a second colour, and a forced palette gets `LinkText` where it had
`Highlight`. Whether there is a value at all is the other, and it is drawn as
movement — a short bar travelling the track — because a bar standing still at
any width is a claim about progress that was never made.

That movement is timed with `--volt-duration-medium` like every other animation
here, so `prefers-reduced-motion` already turns it off and there is no media
query to add. Because it turns off, the resting look is in the rule and the
animation fills neither way: a stopped bar sits at the start of the track
rather than wherever the last frame left it. If you replace the rule, keep
`animation-fill-mode: none` and keep the travel on `margin-inline-start` — a
translation runs along the physical inline axis and sends the bar the wrong way
in a right-to-left page.

How far a determinate bar has come is a width, and a width is a number, so it
is written inline on the indicator rather than in the sheet. A rule of your own
that sizes `.volt-progress-indicator` loses to it — style the fill, the height
and the ends, and leave the width alone.

What you write on the tag — a class, an id, a `data-*`, any ARIA — lands on the
element carrying `role="progressbar"`, which is the outer one, not the track.
That is the element a reader announces, so it is the one a name has to reach.

A progress bar takes no input, holds no focus and answers no keys. Something
the user can change is a slider, which is a different role with a keyboard map
of its own.

For anything this does not offer, take the primitive:

```html
<v-progress :ref="upload" label="Uploading photos"></v-progress>
```

```ts
upload: VProgress | null = null;
finish(): void { this.upload?.progress.setValue(100); }
```

## `<v-spinner>`

`createSpinner`, with the markup written: a ring that turns, the words that
name the wait for a screen reader, and the half second of nothing that keeps a
fast response from flashing one.

<Demo name="spinner" height="300" />

```html
<v-spinner :loading="saving" label="Saving your draft"></v-spinner>
```

```ts
saving = new Signal.State(false);
```

Write the tag where the wait will be and leave it there. It draws nothing and
says nothing until there is a wait worth mentioning, and that is the reason it
is written unconditionally rather than under an `:if`: a screen reader
announces what *changes* inside a live region, so a region that arrives already
holding its message announces nothing at all. The region has to be on the page
first, empty. That bug is invisible to everyone who can see the screen, which
is why this component exists rather than a `<div>` with a class on it.

The other half is the delay. Nothing is drawn and nothing is announced for the
first 500ms, because a wait too short to read is a wait too short to mention,
and a mark that comes and goes inside a couple of frames reads as a fault
rather than as progress. `minDuration` is the other end of the same idea: once
the ring is up, keep it up long enough to be read.

| Prop | Type | Means |
|---|---|---|
| `loading` | `Signal.State<boolean>` | Your signal. Without one the spinner owns the state, and `setLoading` moves it |
| `defaultLoading` | `boolean` | Where it starts, when the spinner owns it |
| `delay` | `number` | ms a wait has to last before anything is drawn. Default 500; `0` draws at once, and flashes |
| `minDuration` | `number` | ms the ring stays up once drawn. Default 0 |
| `label` | `string` | What the wait is called. Default the locale's `Loading…` |
| `aria-label` | `string` | The same words in the platform's spelling — the region's contents, never its name |
| `aria-labelledby` | `string` | What already names the wait — put on the words, never on the region |
| `size` | `'sm' \| 'lg'` | The ring's size; absent for the middle one |
| `onLoadingChange` | `(loading: boolean) => void` | Called with the state `setLoading` moved to |

Slots: none. The words are a string, and they are the one thing in here a
screen reader gets — markup in a live region is read out as its text anyway,
and a slot whose content is never drawn is a trap rather than a feature.

**The words are never drawn.** `label` is heard and not seen: the ring is what
everybody else has, and it is `aria-hidden`, because a spinning mark has no
accessible name and one read out of its markup is noise. Name the wait wherever
a page has more than one thing to wait for — "Loading results" and "Saving your
draft" are worth the sentence, and "Loading" twice on one screen is not.

**`aria-label` on the tag becomes those words rather than a name on the
region.** This is the one place the component refuses to do what the attribute
literally says, and it is deliberate: `aria-label` on a live region is
announced *instead of* its contents in some screen readers, so the obvious
spelling would silence the message and only a screen reader user would ever
find out. Written on the tag it lands inside the region instead, which is what
whoever wrote it meant.

`aria-labelledby` is the same name in the same place and is diverted the same
way, onto the words rather than onto the region. It cannot *become* the words —
they are in an element this component has no business reading — so it names
them, and a reference that resolves to nothing leaves the label's own text to
stand. Either way there is something inside the region to announce, which is
the part that has to be true.

Everything else — a class, an id, a `data-*`, an `aria-describedby` — reaches
the region itself, which is the element carrying `role="status"`. A description
is not a name, and does not replace what a region says.

**Do not put one inside a button.** A control takes its accessible name from
its own contents, so a spinner written between `<v-button>`'s tags renames the
button to "Loading… Save" while it turns. Put the ring there by hand and leave
the words to a region outside it:

```html
<v-button variant="primary" :disabled="saving.get()">
  <span class="volt-spinner-indicator" aria-hidden="true"></span>
  Save
</v-button>
```

The class alone is the ring, turning; `data-size` sizes it, and the two states
before a wait has earned the screen — `data-state="idle"` and
`data-state="delayed"` — are what take it away again. It takes the colour of
the text around it, so it needs no variant to sit on a button, a card or an
accent fill.

**What the user is waiting *for* is yours to mark.** The region holds the ring
and the words and nothing else, because a live region announces everything
inside it every time any of it changes — content that is being rebuilt inside
one is content read out on every keystroke of a filter. `aria-busy="true"`
belongs on that content, which is your markup and one attribute:

```html
<v-spinner :loading="saving" label="Loading results"></v-spinner>
<ul :attr-aria-busy="saving.get() ? 'true' : undefined">…</ul>
```

`createSpinner`'s `contentProps()` is the same attribute with the state beside
it, for markup assembled around the primitive rather than around this tag.

`defaultLoading`, `delay`, `minDuration` and `onLoadingChange` are read once,
when the primitive is built, so they are not signals and changing them later
does nothing. `loading`, `label` and `size` follow whatever you bind them to.
The two timings are read as durations, so `delay="0"` written as an attribute
is the zero it looks like — and `delay="half a second"` is refused where it was
written rather than becoming a `NaN` timeout, which fires immediately and
brings back the flash the delay exists to prevent. So are the other numbers
that fire immediately: `setTimeout` takes a `long`, which turns `Infinity` into
zero and treats a negative timeout as already due, so `delay="Infinity"` and
`minDuration="-1"` are refused too. Each of them reads like the opposite of a
flash and is one.

The turn is timed with `--volt-duration-medium`, like every other animation
here, so `prefers-reduced-motion` already turns it off and there is no media
query to add. That is why the mark is a full ring with one edge picked out
rather than a lone travelling dot: stopped, it still reads as an indeterminate
wait, where an arc with no circle behind it reads as nothing. Forced colours
keep the same picture — the head is `currentColor` and the track `GrayText`.

A status region takes no focus and answers no keys. There is nothing to press
here, and nothing the keyboard can reach.

For anything this does not offer, take the primitive:

```html
<v-spinner :ref="save" label="Saving your draft"></v-spinner>
```

```ts
save: VSpinner | null = null;
begin(): void { this.save?.spinner.setLoading(true); }
```

## `<v-skeleton>` and `<v-skeleton-shape>`

`createSkeleton`, with the markup written: the shape of content that has not
arrived, the content itself once it has, and the polite live region that says
so in one sentence instead of reading out a wall of empty boxes.

<Demo name="skeleton" height="420" />

```html
<v-skeleton :loading="pending" shape="text" :count="3">
  <p>{ article.get().body }</p>
</v-skeleton>
```

The content is the default slot, and it is the placeholder's other half rather
than something beside it: while the load is on, the boxes stand where the
paragraph will be, and when it ends they are replaced by it. That is what a
skeleton is worth over a spinner — it holds the layout the content is coming
into, so nothing below it jumps when it lands.

| `<v-skeleton>` | Type | Means |
|---|---|---|
| `loading` | `Signal.State<boolean>` | Your signal, when what is being waited for is yours |
| `defaultLoading` | `boolean` | Where it starts, when the skeleton owns its state |
| `shape` | `'block' \| 'text' \| 'circle'` | Which shape the boxes are. Default `text` |
| `count` | `number` | How many of them. Default 1; rounded down, and never below one |
| `width` | `string` | Any CSS length, put on every box — `12rem`, `60%`. A circle's diameter |
| `height` | `string` | Any CSS length, likewise. A circle takes its height from `width` |
| `delay` | `number` | Hold the boxes back this long, in ms. Default 0 |
| `minDuration` | `number` | Once up, keep them up at least this long, in ms. Default 0 |
| `label` | `string` | What the region says while the boxes are up. Default `Loading…`; `''` says nothing |
| `loadedLabel` | `string` | What it says once the content arrives. Default `Loaded`; `''` says nothing |
| `announceDelay` | `number` | How long the region must have been on the page first, in ms. Default 50 |
| `onLoadingChange` | `(loading: boolean) => void` | Called with the state the load moved to, as it moves |

| `<v-skeleton-shape>` | Type | Means |
|---|---|---|
| `shape` | `'block' \| 'text' \| 'circle'` | Which shape this box is. Default `text` |
| `width` | `string` | Any CSS length. A circle's diameter |
| `height` | `string` | Any CSS length. A circle takes its height from `width` |

Slots: the default one is the content, and `placeholder` is the boxes. Fill the
second when `shape` and `count` cannot say what you want — a card is a circle,
then two lines, then a block, and no pair of props describes that:

```html
<v-skeleton :loading="pending">
  <template :slot-placeholder>
    <div class="head">
      <v-skeleton-shape shape="circle" width="2.5rem"></v-skeleton-shape>
      <v-skeleton-shape shape="text" width="8rem"></v-skeleton-shape>
    </div>
    <v-skeleton-shape shape="block" height="4rem"></v-skeleton-shape>
  </template>

  <article>…</article>
</v-skeleton>
```

What is written for that slot replaces the boxes rather than joining them, so
`shape` and `count` are doing nothing once it is filled. A placeholder you
assembled is one this component cannot count the lines of, so the short last
line is yours to ask for: `data-trailing` written on the tag reaches the box,
where the sheet draws it at 60%.

`<v-skeleton-shape>` registers with nothing and needs no skeleton around it —
it is a box with no behaviour to coordinate — so it is also the tag to reach
for anywhere else a shape is wanted.

`defaultLoading`, `delay`, `minDuration`, `label`, `loadedLabel` and
`announceDelay` are read once, when the primitive is built, so they are not
signals and changing them later does nothing — which is also why they are
written down here. `loading`, `shape`, `count`, `width` and `height` follow
whatever you bind them to.

The three timings may be written as attributes — `delay="300"` is the usual
spelling — and are read as numbers rather than handed on as the strings they
arrive as. One that is not a number is refused by name when the component is
built: passed on, `delay="1s"` is a `NaN` timeout, which fires on the next
tick, so the option reads as honoured and does nothing.

Three things about the markup are worth knowing before you write CSS against
it. What you write on the tag — a class, an id, a `data-*`, any ARIA — lands on
the element standing in for your content, which is the one your layout has a
place for and the one carrying `aria-busy` while the load is on. It does not
land on the boxes, which are decoration, and it does not land on the live
region: a name on a live region is announced *instead of* its contents in some
screen readers, which for this region is the whole message lost. And the region
is a sibling of the content rather than a child of it, because `aria-busy` on
an ancestor of a live region means "do not announce what changes in here yet".

A name is the one thing the tag will not carry anywhere useful. The element it
lands on has no role — `aria-busy` is a state, not one — and `aria-label` on a
roleless element is thrown away by every screen reader, while the region that
does have a role is the one place it must never go. So `aria-label` written on
`<v-skeleton>` is left where you put it and said out loud in development.
Name the content instead, or give the element a `role` of your own to hold it.

The boxes carry `aria-hidden` and `inert`, both from the primitive, and the
pair is exact rather than belt and braces: `aria-hidden` alone would leave
anything inside them reachable by Tab and nameless when it got there. There is
no keyboard here and that is the point — a skeleton is something to look at and
nothing to operate. The one thing a reader gets is the sentence in the region,
which is why `label=""` is worth knowing: six skeletons in a list are six
regions all saying "Loading…" for one wait, so silence the five that are not
speaking for the group. The demo above is two skeletons on one wait, and does
exactly that — the card speaks, the paragraph below it is `label=""`.

`delay` exists for a load that may be over before anyone sees it, and it is
drawn rather than left out of the markup — the boxes are on the page with
`data-state="delayed"` and `display: none`, taking no room. Default 0, unlike a
spinner's, because a skeleton *is* the layout: delaying it shows a blank hole
first and then a jump, which is worse than the flash it would have avoided.
`minDuration` holds the boxes up once they are up, and holds the content back
with them — showing it the instant a fast answer lands is the flash the minimum
exists to prevent.

What the sheet draws it draws on three attributes: `data-state` (`idle`,
`delayed`, `visible`) on the content and on the placeholder, `data-shape` on
each box, and `data-trailing` on the last of several text lines, which is drawn
short so that a column of lines ending together does not read as a table.

The pulse is an animation, timed by `--volt-duration-medium` like every other
motion in this package, so `prefers-reduced-motion` already stops it and there
is no media query to add. It alternates rather than starting again each time,
which halves how often the brightness turns around: both durations here are
short, and a pulse that restarted every two hundred milliseconds would flash
near the rate WCAG 2.3.1 refuses.

A box is a fill and nothing else, and a forced palette replaces every fill the
sheet chose — so the boxes come back as `GrayText`, the palette's own word for
something there is nothing behind yet. It is the one colour this component
spends, and that is deliberate: a placeholder drawn in the reader's accent
would be indistinguishable from content.

For anything this does not offer, take the primitive:

```html
<v-skeleton :ref="feed"><article>…</article></v-skeleton>
```

```ts
feed: VSkeleton | null = null;
refresh(): void { this.feed?.skeleton.setLoading(true); }
```
