# Display components

What a page shows beside its content: who someone is, how many of something
there are, a tag in a set, and which keys to press.

Each component below is a tag you write, with the primitive that owns its
behaviour named beside it. See [the package](./ui) for the two entries, the
stylesheet, the tokens and how to override a rule.

None of the four is a control. What each carries is a name a screen reader
says once — an avatar's is the person's, a badge's is the words its digits
stand for, a chip's names the button that removes it, a shortcut's is the keys
read as words — and the sheet draws each so that it says the same thing without
its colour, since a forced palette replaces every colour it uses.

## `<v-avatar>`

`createAvatar`, with the markup written: a person's picture, and their initials
behind it. The picture once it has loaded; the initials while it loads, when it
fails, and when there is no picture at all — and one name, said once, whichever
of the two is up.

<Demo name="avatar" height="280" />

```html
<v-avatar :src="user.get().photo" :name="user.get().name"></v-avatar>
```

The two are stacked in one box, so the swap from initials to picture moves
nothing on the page. Nothing is announced about the swap either: the primitive
moves the name from one to the other, and a reader hears the same name
wherever they meet the avatar.

| Prop | Type | Means |
|---|---|---|
| `src` | `string \| null` | The picture. Empty, `null` or left off means there is none, and the initials stand alone |
| `name` | `string \| null` | Who is pictured: what a reader hears, once, and what the initials are taken from |
| `size` | `'sm' \| 'md' \| 'lg'` | Default `md` — `1.5rem`, `2rem` and `3rem` across |
| `shape` | `'circle' \| 'square'` | Default `circle`. The square has rounded corners |
| `aria-label` | `string` | What is heard in place of `name`, over initials that are still the name's. Without `name`, it is the name |
| `aria-labelledby` | `string` | Id of the element that names the picture. Needs `name` or `aria-label` beside it |
| `aria-describedby` | `string` | Id of an element that says more — "online", "away". Needs `name` or `aria-label` beside it |

Slots: `fallback` is what stands in for the picture, in place of the initials,
and is handed `{ initials }`. Fill it for an icon, or for initials drawn some
other way:

```html
<v-avatar :src="team.logo" :name="team.name">
  <svg :slot-fallback viewBox="0 0 24 24" width="60%" height="60%">…</svg>
</v-avatar>

<v-avatar :name="user.get().name">
  <template :slot-fallback="{ initials }"><b>{ initials }</b></template>
</v-avatar>
```

What is written there goes inside the element carrying the name, where
`role="img"` makes it part of the picture — so an icon is not a second thing
heard, and does not need `aria-hidden` of its own.

Every prop follows whatever it is bound to: a new `src` is a new load, with the
initials back in front of it while it comes, and a new `name` is new initials
and a new name at once.

**The initials are what is seen, not what is said.** "AL" is either spelled out
or read as a word, and neither is who this is. While they are up they are
`role="img"` with the name as their label, and the picture beside them is
`alt=""`; once the picture has loaded the initials are gone and its `alt` is
the name. So there is nothing to add: an `alt` or a label written around the
avatar, or a caption repeating the name inside the same link, is the name heard
twice. With no `name` at all both are silent, because a blank circle announced
as "image" is noise — which makes a picture of nobody in particular
decoration, and makes `name` the prop to leave off for one.

**What you write on the tag lands on the box.** It is the element your layout
places — the one a row of them overlaps, the one a class sizes — and it has no
role, because the element carrying the name changes as the picture loads. So
`aria-label`, `aria-labelledby` and `aria-describedby` are props rather than
attributes that land there: a name on an element with no role is thrown away by
most screen readers and read as well as the picture's own by the rest. Each is
put on whichever element carries the name at the time — the initials, then the
picture — and the name stays beside a reference, to be heard if the reference
finds nothing. A reference without a name has nowhere to go, since the avatar
is then decoration, and says so in development.

**The `<img>` never leaves the page.** An image that is not in the document is
never fetched, so the picture is on the page from the first render, and it is
the sheet that keeps it out of sight until it has loaded — with `opacity`,
because `display: none` and `visibility: hidden` would take it out of the
accessibility tree as well. That is worth knowing before writing a rule of your
own against `.volt-avatar-image`: one that hides it any other way hides the
name with it.

A server render writes the initials, carrying the name, and the picture beside
them quiet — the same markup the client draws while a load is under way — so
the name is said once from the first byte. The picture is only drawn once a
script has seen it load: until the page has hydrated, the initials are what is
shown, even for a picture already in the cache.

The initials are the first letter of the first word and of the last, which is
the European convention and wrong for a name with no spaces to split on. The
case is left as written and drawn in capitals by `text-transform`, which
capitalises in the element's own `lang` — a Turkish "i" becomes "İ", not "I".
Where the convention does not fit, the `fallback` slot is the way round it.

A picture is something to look at, so there is no keyboard here and nothing in
the tab order. An avatar that goes somewhere is an avatar inside a link, which
takes its name from the picture:

```html
<a href="/people/ada"><v-avatar :src="ada.photo" name="Ada Lovelace"></v-avatar></a>
```

**A row of overlapping avatars is layout, not a tag.** Write it in your CSS,
against the sheet's own class — each box pulled under the one before it, and
ringed in the colour it sits on, so that two of them read as two:

```html
<div class="reviewers" role="group" aria-label="Reviewers">
  <v-avatar :for="person in reviewers" :key="person.id"
            :src="person.photo" :name="person.name"></v-avatar>
</div>
```

```scss
.reviewers { display: flex; }
.reviewers > .volt-avatar + .volt-avatar { margin-inline-start: calc(-1 * var(--volt-space-2)); }
.reviewers > .volt-avatar { outline: var(--volt-border-width-2) solid var(--volt-color-surface); }
```

An outline rather than a border, because a border is inside the box and would
eat into the picture; and rather than a shadow, because a forced palette paints
no shadows and does paint outlines. A count after the row — "+3" — is an
element of yours in the same row, worth writing as "3 more" for the reader who
hears it.

The sheet draws on three attributes. `data-status` (`idle`, `loading`,
`loaded`, `error`) is written by the primitive on the box, the picture and the
initials, and the picture is drawn only at `loaded`. `data-size` and
`data-shape` are on the box. A size of your own is the box's two lengths and
its type:

```scss
.hero { inline-size: 5rem; block-size: 5rem; font-size: var(--volt-font-size-4); }
```

The box is filled with `--volt-color-accent-muted`, and the fill is the box's
rather than the initials', so the space an avatar takes is held in the same
colour before anything is in it. A forced palette replaces that fill with the
page's own, which would leave the initials floating in no shape at all, so the
box is given an edge in `CanvasText` there. Whether the picture has loaded is
drawn in `opacity`, which no palette touches.

The tag shows the initials the moment a load starts. For anything it does not
offer — holding the initials back so a cached picture does not flash them
(`fallbackDelay`), initials derived your own way, a status a list already knows
— write the markup around `createAvatar` yourself, with the same classes. For
the status of the one the tag made, take the primitive:

```html
<v-avatar :ref="face" :src="photo.get()" name="Ada Lovelace"></v-avatar>
```

```ts
/** A signal, so what reads it is drawn again once the avatar is there to ask. */
face = new Signal.State<VAvatar | null>(null);
failed(): boolean { return this.face.get()?.avatar.status() === 'error'; }
```

## `<v-badge>`

`createBadge`, with the markup written: a count or a status dot on the corner
of what it is about, named for a screen reader in words rather than digits.

<Demo name="badge" height="320" />

```html
<v-badge :count="unread" describes="unread messages">
  <v-button>Inbox</v-button>
</v-badge>
```

```ts
unread = new Signal.State<number | null>(3);
```

`describes` is the prop not to leave out. The digits are drawn and hidden: the
badge is `role="img"`, and its name is the count followed by those words, so a
reader hears "3 unread messages" rather than a bare 3 — and "More than 99 unread
messages" rather than "ninety-nine plus", or nothing, which is what `99+` reads
as depending on the screen reader. A badge with no `describes` says so in the
console while you develop.

| Prop | Type | Means |
|---|---|---|
| `count` | `number \| string \| Signal.State<number \| null> \| Signal.Computed<number \| null>` | What is counted: a number, your own signal of one, or the string `count="3"` delivers. `null` is no count, and draws nothing unless `dot` is set |
| `describes` | `string` | What the number counts. The name is the count and then these words |
| `dot` | `boolean` | A dot instead of the digits. With a count it follows the count and keeps the number in the name; with none it is a status, named by `describes` |
| `tone` | `'danger' \| 'accent' \| 'neutral'` | Default `danger` for a count and `accent` for a status dot |
| `max` | `number \| string` | Past this the badge reads `99+`. Default 99; `:max="Infinity"` takes the cap away, and so does a string that is not a number |
| `showZero` | `boolean` | Stay on screen at zero, reading `0`. Default false |
| `labels` | `{ count?(n, describes), overflow?(max, describes) }` | Your wording for the name — which is how a plural is said properly |
| `id` | `string` | The badge's id, which the control it counts for is described by. Default one of its own |
| `aria-label` | `string` | Names the badge outright, in place of the count and `describes` |

Slots: the default one is what the badge is about, and the badge sits on its top
inline-end corner. Leave it empty and the badge stands in line where it was
written, the way a count after a word does. The badge itself has no slot: the
digits are its text, and anything more inside a `role="img"` would be hidden
from a screen reader anyway.

**The count is heard with the control it counts for.** The badge is drawn
beside the content, not inside it, so it is not part of the button's name — and
it takes no focus, so a keyboard user moving from control to control would reach
Inbox and never learn anything was waiting in it. So the first control inside
the content is described by the badge: the badge's id is added to that control's
`aria-describedby`, after whatever you put there yourself, for as long as the
badge is showing. Tab to the button and a reader says "Inbox, button, 3 unread
messages". The badge also keeps its place in the reading order, the way help
text under a field does, so reading the page line by line finds it too.

"The first control" is the first tab stop, not the first element: wrap a card
and it is the card's link that is described, not the `<div>`. Content with
nothing focusable in it — an avatar, an icon — has nothing to describe, and the
badge beside it is how it is heard. The control is looked for when the badge
mounts, whenever the count moves, and whenever anything inside the content
takes focus — so a control that arrives after the badge, under an `:if` inside
the content, or one in a panel that was shut when the badge mounted, is
described by the time it is reached: focus is when the description is heard,
and it is looked for again then.

**`null`, zero and a dot are three different things.** `null` is no count — one
that has not loaded, or does not apply — and draws nothing, whatever `showZero`
says: a `0` shown before the count arrives would be a claim nobody made. Zero is
a count, and goes away unless `showZero` says zero is worth showing. A dot with
a count is that count drawn smaller: it goes at zero, and it is still named "3
unread messages". A dot with no count is a status — online, changed, new — shown
for as long as `dot` is set, which is also how to take it away:

```html
<v-badge :dot="online.get()" describes="Online">
  <img class="avatar" src="/ada.png" alt="Ada Lovelace">
</v-badge>
```

**The default name does not pluralise.** "1 unread messages" is what it says,
because the plural depends on the language and the noun, and neither is
knowable from a string. `labels.count` says both forms:

```ts
labels = {
  count: (n: number, what: string) => (n === 1 ? '1 unread message' : `${n} ${what}`),
};
```

The overflow sentence comes from the locale's `badgeOverflow` when the catalogue
has one, so "More than 99" is translated with the rest of the page.

`count` arrives whichever way you write it: `:count="unread"` hands over the
signal itself, `:count="unread.get()"` a number read out of it, and `count="3"`
the string an attribute delivers, which is read as the number it is. All three
follow what they were given. Handed your signal, the badge writes into it too:
`setCount` through `:ref` moves the page's own count. `describes`, `max`,
`showZero` and `labels` are read once, when the primitive is built, so they are
not signals and changing them later does nothing. `count`, `dot`, `tone`, `id`
and `aria-label` follow whatever you bind them to. `showZero="false"` is read as
the false it says.

What you write on the tag — a class, a `data-*`, a `title` — lands on the
badge, the element carrying the role and the name. It does not land on the box
around your content, which is layout and hugs what it wraps: put spacing and
width on the content, which is your own markup already. `id` and `aria-label`
are declared rather than passed through, because the badge writes both itself
— the id is what the control is described by, and the primitive names the badge
on every change of count — and one written on the tag would lose to the badge's
own a moment later. An `aria-label` is a fixed name, so it says no number:
`describes` is almost always what was meant.

The badge is drawn over the content's corner, and presses there reach the
control underneath rather than stopping on the badge. The corner is the top
inline-end one, so a right-to-left page puts the badge on the left without being
told: the sheet reaches the corner with logical insets, and a rule of your own
that moves it should too — a translation runs along the physical axis and leaves
the badge on the right.

Only an element counts as content to sit on. The sheet can tell a badge has
company in its anchor only by its not being the anchor's only element, so bare
text inside the tag gets the badge after it, in line, rather than over it.

Tone is emphasis: the words the badge is named with say what it counts, so a
forced palette draws every tone alike — filled with `CanvasText`, digits in
`Canvas`. What it keeps is the badge itself, and that matters most for a dot,
which has no digits and would otherwise be a fill the palette replaced with the
colour of the page.

A badge takes no focus and answers no keys. It is not a control: the one thing
here a keyboard reaches is the control it counts for.

By hand, the badge is the primitive's bag on a `.volt-badge`, with the tone and
the dot written by you; wrap it with its content in a `.volt-badge-anchor` to put
it on the corner:

```html
<span class="volt-badge-anchor">
  <button>Inbox</button>
  <span class="volt-badge" data-tone="danger" :spread="inbox.badgeProps()">{ inbox.text() }</span>
</span>
```

Written that way, the description on the button is yours to add.

For anything this does not offer, take the primitive:

```html
<v-badge :ref="inbox" :count="unread" describes="unread messages">
  <v-button>Inbox</v-button>
</v-badge>
```

```ts
inbox: VBadge | null = null;
overflowing(): boolean { return this.inbox?.badge.isOverflowed() ?? false; }
```

## `<v-chip>`

A tag in a set: its words, and when it can be removed, a small button after
them that asks to be. `createChip` owns the part that is easy to get wrong —
where focus goes once the tag has gone.

<Demo name="chip" height="300" />

```html
<div class="tags">
  <v-chip
    :for="tag in tags.get()"
    :key="tag"
    removable
    :onRemove="() => drop(tag)"
  >{ tag }</v-chip>
</div>
```

```ts
tags = new Signal.State<readonly string[]>(['TypeScript', 'Rust', 'Go']);

drop(tag: string): void {
  this.tags.set(this.tags.get().filter((each) => each !== tag));
}
```

A removable chip is a tab stop. Delete and Backspace on it, and a press on its
button, all end in `onRemove`, with focus already moved to the chip after it —
or the one before, when it was the last, or the element holding them, when no
chip is left. The button is never a tab stop, so ten tags cost ten Tab presses
rather than twenty. It is named after the chip it removes, `Remove Rust`, in
the page's language, where the locale's catalogue gives one.

| `<v-chip>` | Type | Means |
|---|---|---|
| `removable` | `boolean` | Draw the button and answer Delete and Backspace. Default false. Written bare, or bound; `removable="false"` is the false it says. Read once |
| `onRemove` | `() => void` | Called when the chip asks to be removed, after focus has left it. Drop the tag from your list |
| `label` | `string` | What the button is named after, when the words inside do not name the chip. Unset, the words |
| `tone` | `'neutral' \| 'accent' \| 'success' \| 'warning' \| 'danger'` | The hue of the words and the edge. Default `neutral` |
| `size` | `'sm' \| 'md'` | Default `md` |

Slots: the content of the tag is the chip's words, and may be markup — an
avatar, a count, a word in bold. The button's name is read from its text, so
give `label` when that text is not a name:

```html
<v-chip removable label="Ada Lovelace" :onRemove="unassign">
  <img src="/avatars/ada.png" alt=""> AL
</v-chip>
```

**The chip only asks.** Removing the tag is yours: take it out of the list the
chips are drawn from, and its chip goes. An `onRemove` that does nothing — or
none at all — leaves the chip where it was. Focus has moved on by then either
way, because the primitive moves it before asking, while the chip is still
there to measure from. A page that asks for confirmation first, and is told
no, puts focus back on the chip itself.

**The chips of one set belong in one element.** The chip that takes focus is
found among the chip's siblings in the element around it, in the order they
are in the page. Wrap each chip in an element of its own — an `<li>` apiece —
and each is the only chip in its element: the removed chip's `<li>` is given
focus and then taken away with it, and focus lands on `<body>`. For a set read
out as a list, put the role on the chips instead, which is where what you
write on the tag lands:

```html
<div role="list" class="tags">
  <v-chip :for="tag in tags.get()" :key="tag" role="listitem" removable
          :onRemove="() => drop(tag)">{ tag }</v-chip>
</div>
```

**Key the chips by the tag, not by `$index`.** Focus moves to the next chip's
element before the list changes. Keyed by position, the row that element
belongs to is handed the tag after it once the list closes up, so the keyboard
is left on a different tag from the one it was moved to.

**A chip that cannot be removed is no tab stop.** A row of statuses is not five
Tab presses with nothing to do at each. It can still be focused — it carries
`tabindex="-1"` — because it is where focus goes when the removable chip beside
it is taken away; a chip with no tabindex at all would refuse the focus, and
the keyboard would go down with the chip it was on.

**`removable` is read once**, while the component's fields initialize, because
the primitive is built with it. Writing `:removable="editing.get()"` and
changing `editing` later changes neither the button nor the keys. A set that
can become read-only is two sets under `:if` and `:else`, one of them
removable.

**Tone is emphasis.** It is never spoken, so a chip whose tone is the only thing
saying what it means says nothing to a screen reader, and a forced palette
draws every tone alike. Put the meaning in the words — `Overdue`, not a red
`Invoice 42` — and let the tone repeat it. Each tone is a hue in the words and
the edge on the plain surface; the one state drawn in a channel a forced
palette keeps is the focus ring, since Delete takes away whichever chip has
it.

**The name follows the words.** A tag renamed in place — `{ tag.name }` under a
`:key` that stays the same — renames its button too, since a button still
named after the old words would be removing a tag nobody can see. The words
are read from the page once it is running, so a chip rendered on a server has
a button named `Remove` until the page takes over; give `label` where that
first moment matters.

What you write on the tag lands on the chip: a `class`, an `id`, a `role`, any
`aria-*` or `data-*`. For anything the tag does not offer — which chip would
take focus, removing one from code — take the primitive:

```html
<v-chip :ref="ada" removable :onRemove="unassign">Ada</v-chip>
```

```ts
ada: VChip | null = null;
later(): void { this.ada?.chip.remove(); }
```

## `<v-kbd>`

`createKbd`, with the markup written: a keyboard shortcut drawn as keycaps and
said as words.

<Demo name="kbd" height="460" />

```html
<p>Press <v-kbd keys="mod+k"></v-kbd> to search.</p>
```

That is `⌘ K` on an Apple platform and `Ctrl + K` everywhere else, and a screen
reader hears "Command k" or "Control k". The words are the point: `⌘` read
aloud is "place of interest sign", or more often silence, so the chord is an
image named by what the keys are called, and nothing drawn inside it is read.

`mod` is the one word in `keys` that is not a `KeyboardEvent.key` name. It is
whichever modifier the platform uses for its own shortcuts — Command on an
Apple platform, Control everywhere else — which is the key a page almost always
means, and the one it cannot name without knowing where it runs. Everything
else is the primitive's syntax: key names joined by `+`, each drawn with the
platform's symbol and said with the platform's name, as the
[table in the primitive's reference](./primitives-display#keyboard-shortcut)
lists them.

| Prop | Type | Means |
|---|---|---|
| `keys` | `string \| readonly string[]` | The chord, in `KeyboardEvent.key` names joined by `+` — `Shift+Enter`, `mod+k` — or as a list, which is the only way to write the plus key: `['mod', '+']` |
| `platform` | `'apple' \| 'other'` | Whose keys to draw. Default read from the user agent. Read once, when the tag is built |
| `size` | `'sm' \| 'md'` | `md`, the default, for a shortcut in running text; `sm` beside a menu item or in small print |
| `aria-label` | `string` | What the shortcut is called, in place of the primitive's words |

Slots: none. The keycaps are drawn from `keys`, and **anything written inside
the tag is not drawn at all** — `<v-kbd>⌘K</v-kbd>`, which is how the platform's
own `<kbd>` is written, is an empty shortcut. Write the chord in `keys`, and
the symbols follow the platform the page is read on.

What it draws is how HTML spells a key combination — a `<kbd>` per key inside
a `<kbd>` for the chord — with the separator between keys hidden from assistive
technology:

```html
<kbd class="volt-kbd" data-size="md" role="img" aria-label="Control k" data-platform="other">
  <kbd class="volt-kbd-key" data-key="Control">Ctrl</kbd>
  <span class="volt-kbd-separator" aria-hidden="true">+</span>
  <kbd class="volt-kbd-key" data-key="k" data-character="">k</kbd>
</kbd>
```

On an Apple platform there is no separator: the keys stand side by side, the
way a Mac's menus print them. The text of the chord is exactly what the
primitive's `text()` gives — `⌘k`, `Ctrl+k` — so a reader who copies it copies
the shortcut.

**Key names are case-sensitive, and `mod` is lower case.** They are the names
`KeyboardEvent.key` reports — `Shift`, `Enter`, `ArrowUp`, `Escape` — and a name
the primitive does not know is drawn and said as written. `shift+k` draws
`shift` and says "shift k"; nothing refuses it, because `F13` and every other
key the table leaves out arrive the same way.

**`Meta` is not `mod`.** `Meta` is the key itself: ⌘ on a Mac, and the Windows
key everywhere else. A shortcut written `Meta+k` for "Command K" is drawn as
`Win + k` on Windows, which is a real key and almost never the one meant.
`Control` is the Control key on both, which on a Mac is `⌃` — right for a
terminal's shortcut, wrong for an application's.

**A letter is drawn as a capital and said as written.** The primitive leaves a
character in the case it was given, because upper-casing needs the language to
be right; the sheet capitalises it with `text-transform`, which takes the
language from `lang`. So `mod+k` and `mod+K` are the same keycap, and a
Turkish page that writes `lang="tr"` on the tag gets the `İ` its keyboard
prints. The name keeps the case written, which a screen reader reads the same
either way. Named keys are left alone — `Ctrl`, not `CTRL`.

**The platform is read from the user agent, and a server has none.** A server
render draws `other`, and a Mac replaces it when the page attaches. Pass
`platform`, from the request's user agent if you have it, to make both sides
agree — and in a test or on a page of documentation that has to show one
platform whatever it is read on. It is read once, when the tag is built, and
anything other than `apple` or `other` is refused: the primitive reads every
other value as "not Apple", so `platform="mac"` would have been a Mac page
showing `Ctrl + K`.

**What you write on the tag lands on the chord.** It is the element with the
role — `role="img"` — so it is what a screen reader meets: `aria-label` renames
the shortcut, `aria-describedby` describes it, and `lang` decides how its
letters are capitalised. None of it reaches the keys, which are drawn and not
read. `aria-label` replaces the primitive's words rather than sitting beside
them, and is dropped while there are no keys: an empty shortcut has no role,
and ARIA prohibits naming an element that has none. An empty `aria-label`, or
one of blanks, is no name, and the primitive's words stand.

**Inside a control, the shortcut becomes part of its name.** A control is named
by its contents, and an image among them is named by its label, so a menu item
holding `Search` and `<v-kbd keys="mod+k">` is announced "Search Command k".
That is usually what a reader wants to hear. Where it is not, write
`aria-hidden="true"` on the tag and say the shortcut on the control with
`aria-keyshortcuts`, which is where a screen reader looks for one. That
attribute takes the same `KeyboardEvent.key` names `keys` does, but not `mod`,
which is this component's word and nobody else's: it wants the key itself —
`Meta+K` on a Mac, `Control+K` elsewhere — which is what `shortcut.keys()`
holds once the platform is known.

**Nothing here answers the keyboard.** A shortcut written down is text about
the keyboard, not a control on it: the chord takes no focus and listens for no
key. Binding the keys to what they do is the page's.

The chord is inline and sits on the baseline of the text around it, and a line
never breaks inside it — `Ctrl +` at the end of one line and `K` at the start of
the next would be two shortcuts, neither of them real. What makes a key a key
is its edge: `['Control', '+']` draws `Ctrl + +`, the first plus the separator
and the second a keycap, and only the keycap's edge tells them apart. That edge
is geometry, so a forced palette keeps it.

For anything the tag does not offer — the chord as one string, the words it is
said as, the keys it resolved `mod` to — take the primitive:

```html
<v-kbd :ref="search" keys="mod+k"></v-kbd>
```

```ts
search: VKbd | null = null;
later(): void {
  this.search?.shortcut.label(); // 'Command k'
  this.search?.shortcut.keys();  // ['Meta', 'k']
}
```
