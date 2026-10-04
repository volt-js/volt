# Display components

What a page shows beside its content: who someone is, how many of something
there are, a tag in a set, and which keys to press.

::: warning Not on npm yet
Part of `@voltdev/ui`, which is not published yet — see
[the package](./ui). Everything here works from a checkout of the Volt
repository.
:::

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

## `<v-image>`

`createImage`, with the markup written: a picture that holds its space before a
byte of it arrives, shows a placeholder while it comes, and says in words when
it does not come at all.

<Demo name="image" height="440" />

```html
<v-image src="/covers/first-edition.jpg" alt="The first edition, in green cloth"
         width="1200" height="800"></v-image>
```

A box, and the `<img>` inside it. The box is the picture's shape from the first
render — from `width` and `height`, or from `ratio` when the pixel size is not
known — so nothing below it moves when the picture lands. The `<img>` is on the
page the whole time and is what the primitive watches, so the load is heard on
the element the browser is fetching: `srcset` and `sizes` work because the
browser is the one choosing, and there is no second request.

| Prop | Type | Means |
|---|---|---|
| `src` | `string \| null` | What to load. Empty, `null` or left off is nothing to fetch, and the box holds its shape empty |
| `alt` | `string` | Required. What the picture says. `''` — or `alt` written bare, as on an `<img>` — is decoration, announced as nothing |
| `srcset` | `string` | Candidate sources, and the widths or densities that choose between them. Loads on its own, without `src` |
| `sizes` | `string` | How wide the picture will be drawn, for the browser choosing from `srcset` |
| `width`, `height` | `number` | The picture's own size in CSS pixels. The two together are what hold the space. Read once |
| `ratio` | `string` | The box's shape as CSS writes it — `16 / 9`, or `1.5` — for a picture whose size is not known. Wins over the shape `width` and `height` imply. Read once |
| `fit` | `'cover' \| 'contain'` | Default `cover`: cropped to fill the box. `contain` letterboxes it inside |
| `loading` | `'lazy' \| 'eager'` | Default `lazy`. Read once |
| `decoding` | `'async' \| 'sync' \| 'auto'` | Default `async`, so decoding never holds up the page. Read once |
| `aria-label` | `string` | What a reader hears in place of `alt`, where the two should differ |
| `aria-labelledby` | `string` | Id of the element that names the picture, where the page already says what it is |
| `aria-describedby` | `string` | Id of an element that says more — a caption, a credit |
| `onLoad`, `onError` | callbacks | Called once a load is over. `onLoad` is called for a picture already in the cache too |

Slots: `placeholder` is what stands in the box while the picture loads — a
skeleton shape, a blurred thumbnail. `error` is what stands there when the load
fails, in place of the default, which says _The picture did not load._ in words —
or the provided locale's `imageFailed`, when its catalogue has one: a
broken-picture icon says nothing to anyone, and is drawn in no language.

```html
<v-image :src="book.cover" :alt="book.title" ratio="2 / 3">
  <v-skeleton-shape :slot-placeholder shape="block" height="100%"></v-skeleton-shape>
  <span :slot-error>No cover for this edition.</span>
</v-image>

<v-image :src="photo.full" alt="The harbour at dawn" width="1600" height="900">
  <img :slot-placeholder class="blurred" :src="photo.tiny" alt="">
</v-image>
```

The placeholder is laid over the box, beneath the picture, and stretched to it
both ways — so a shape needs `height="100%"`, since a block's height is its
own otherwise. It is hidden from a reader as a whole, so what goes in it needs
no `aria-hidden` of its own. A blurred thumbnail is your `<img>` and your
class: `inline-size: 100%`, `block-size: 100%`, `object-fit: cover` and a
`filter`. The placeholder comes down the moment the picture has loaded; the
message goes up only when it has failed, and is gone again when a new `src`
starts a new load.

`src`, `srcset`, `sizes`, `alt`, `fit` and the three names follow whatever they
are bound to: a new `src` is a new load on the same `<img>`, with the
placeholder back while it comes.

**Give it a size or a ratio.** It is the whole of what the tag is for. With
neither, there is no shape to hold: the box is as tall as the picture once the
picture is there, and nothing until then — so a placeholder has no room to
stand in, and the page moves when the picture lands, exactly as it would for a
bare `<img>`. A failure still has room: the message gives a box with no height
one.

**Read once: the shape, the hints, and whether it is decoration.** `width`,
`height`, `ratio`, `loading` and `decoding` are what the primitive is built
with, and it reads each of them once, so binding one to a signal does not move
it later. A list of pictures of different shapes is a `:for` over tags, each
built with its own.

`alt=""` is decided once as well, because the primitive decides it once: the
picture gets `alt=""` and `role="presentation"`, and is skipped. The trap is an
`alt` bound to data that is `''` while it loads —
`:alt="book.get()?.title ?? ''"` — which builds a picture that is decoration for
good and never says the title that arrives. Leave it `undefined` meanwhile,
which is not decoration; in development, words arriving for a picture built as
decoration are reported.

**`loading` is `lazy` unless you say otherwise.** The primitive's own default
is the browser's eager loading, for the picture at the top of the page that
must not wait. A tag is written far more often down a page than at the top of
it, so the default is turned round here, and the one that must not wait — the
first large picture on the page — says `loading="eager"`. Lazy-loading that one
measurably delays it.

**What you write on the tag lands on the box.** A class, a `style`, an id, a
`data-*`: the box is the element your layout places and the one holding the
space, so a size of your own is a class on the tag —

```scss
.thumb { inline-size: 6rem; }
```

— and the height still comes from the ratio. The box has no role, so
`aria-label`, `aria-labelledby` and `aria-describedby` are props rather than
attributes that land there, and are put on the `<img>`, beside its `alt`. On a
decorative picture they are dropped, because any of them would announce again
a picture the primitive made silent, and in development that is reported too.

**The box is as wide as the picture's `width`, and no wider than its
container.** That is what an `<img>` is. With no `width` — a `ratio` alone — it
takes its container's width, since a shape with no width of its own has no
other width to hold before the bytes arrive. In a grid cell or a flex column it
is stretched like any other child.

**The `<img>` never leaves the page, and is drawn while it loads.** It paints
nothing until its bytes arrive, so the placeholder shows through it until they
do, and then the picture covers it as it decodes. It is not held back until a
script hears the `load` event: that would hold the largest thing on a page back
until hydration, and leave a page whose script never ran showing placeholders
for good. It is hidden only when there is nothing to show — no source, or a
failed load — with `opacity` and no height, because `display: none` and
`visibility: hidden` would take its `alt` out of the accessibility tree, and
its `alt` is what a reader has of a picture that did not arrive. A rule of your
own against `.volt-image-picture` that hides it any other way hides that too.

A server render writes the box at `loading` with the placeholder up when there
is something to load — the same markup the client draws on its first flush —
and `idle` with nothing in it when there is not. A picture that loads before
the page hydrates is seen as loaded as soon as the primitive looks. One that
fails before then is not seen as failed, because its `error` event has already
been sent and the primitive does not guess at failure from the element alone;
the browser's own broken picture and `alt` text are what show, over the
placeholder, as they would for a bare `<img>`.

A picture is something to look at, so there is no keyboard here and nothing in
the tab order. A picture that goes somewhere is a picture inside a link, which
takes its name from the `alt`.

The sheet draws on three attributes and one property. `data-status` (`idle`,
`loading`, `loaded`, `error`) is written by the primitive on the box and the
`<img>`; `aspect-ratio` is written inline on the box when the shape is known,
and `width` and `height` on the `<img>` when the size is. `data-fit` is on the
`<img>`. The box is filled with `--volt-color-surface-hover` until the picture
is in it, so the space is held in a colour before anything is there and a
picture with transparency sits on the page rather than on a grey card once it
is — the skeleton's colour, and neither of the two a page is painted in, so the
space shows on a `surface-sunken` page as well as on a `surface` one. A forced
palette replaces that fill with the page's own, so the box is outlined in
`CanvasText` there instead, on the same terms; whether the picture is shown is
drawn in `opacity`, which no palette touches.

For anything the tag does not offer — `fetchpriority`, `crossorigin`, a status
a gallery already knows — write the markup around `createImage` yourself, with
the same classes. For the status of the one the tag made, take the primitive:

```html
<p :if="failed()">The cover could not be loaded.</p>
<v-image :ref="cover" :src="book.cover" :alt="book.title" ratio="2 / 3"></v-image>
```

```ts
/** A signal, so what reads it is drawn again once the picture is there to ask. */
cover = new Signal.State<VImage | null>(null);
failed(): boolean { return this.cover.get()?.image.hasError() === true; }
```

## `<v-code>`

Code, inline in a sentence or as a block of its own. `createCode` owns the
part that is easy to get wrong — a block wide enough to scroll is a scroll
container a keyboard has to be able to reach — and the tag adds a copy button
and line numbers to a block.

<Demo name="code" height="420" />

```html
<p>Call <v-code>Array.prototype.at</v-code> with a negative index.</p>

<v-code block language="TypeScript" copyable lineNumbers>{ source }</v-code>
```

Inline, it is one `<code>`. A block is a `<pre>` around one, which becomes a
focusable region named after its language while — and only while — it has to
be scrolled: wider than the box, or taller than a height given to the tag. That
is measured rather than assumed, so a snippet that fits is not a tab stop that
does nothing, and one that scrolls is not code a keyboard user cannot read the
end of.

| Prop | Type | Means |
|---|---|---|
| `block` | `boolean` | A block of its own rather than a run in a sentence. Read once, when the tag is built |
| `language` | `string` | Written to `data-language`, and said in a block's name: `Code, TypeScript` |
| `label` | `string` | What a block that scrolls is called, in place of the primitive's `Code, TypeScript` |
| `aria-label` | `string` | The same, in the platform's spelling. Written as well as `label`, it is the one used |
| `role` | `string` | A role of your own for the element, in place of the primitive's. A block that scrolls is still a named tab stop under it |
| `copyable` | `boolean` | A block only. A button in the corner that copies the code, named "Copy code", and says "Copied" in the page's live region |
| `wrap` | `boolean` | A block only. Long lines wrap at the edge of the box rather than scroll |
| `lineNumbers` | `boolean` | A block only. A number beside each line, drawn by the stylesheet, so none is ever selected or copied |
| `labels` | `{ copy?, copied?, failed? }` | The copy button's name, and what is said and shown once it has copied, or could not. `copy` defaults to "Copy code"; the other two to the locale's `copied` and `copyFailed`, then "Copied" and "Could not copy" |

Each of `block`, `copyable`, `wrap` and `lineNumbers` is on when written bare,
and `"false"` is the false it says.

Slots: the default slot is the code, drawn as it was written. There are no
named slots.

What it draws:

```html
<code class="volt-code" role="code" data-language="JavaScript">Array.prototype.at</code>

<pre class="volt-code-block" data-block="" data-language="TypeScript" data-line-numbers=""
     tabindex="0" role="region" aria-label="Code, TypeScript"
><code class="volt-code-content" role="code" data-language="TypeScript">…</code
><span class="volt-code-lines" aria-hidden="true"
  ><span class="volt-code-line"><span class="volt-code-line-text">…</span></span
></span
><button class="volt-code-copy" type="button" aria-label="Copy code" data-state="idle">Copy code</button></pre>
```

`tabindex`, `role` and `aria-label` are there only while the block scrolls;
`data-line-numbers` and `data-wrap` only when asked for. Nothing sits between
the parts inside the `<pre>`, not even a line break, because a `<pre>` draws
every space it holds.

The copy button has a column of its own, after the code's, so it never sits
over a line of a block that fits. In a block that scrolls across it stays in the
corner while the code passes under it, and is back beside the code at the end
of the scroll.

**Write a block's code through `{ }`, not between the tags.** A template folds
the whitespace between the tags of a component into single spaces — the
newlines and the indentation are the first thing to go — and reads every `{`
as the start of an interpolation. So the code is a string, handed over as one:

```html
<v-code block language="bash">{ install }</v-code>
```

```ts
install = 'pnpm install\npnpm build\n';
```

A few words of inline code between the tags are fine: a sentence has no
newlines to lose. A brace in them is still written `\{`.

**Nothing highlights it.** What the tag holds is drawn as it is. A
highlighter's output goes inside the tag, as markup, where it is drawn with its
own spans and its own stylesheet; `data-language` is there for that stylesheet
to select on:

```html
<v-code block language="ts" copyable><span :html="highlighted.get()"></span></v-code>
```

`:html` does not sanitise, so highlight code you trust or sanitise what the
highlighter returns. A highlighter that rewrites the block after it is drawn —
one that works on the elements, filling `.volt-code-content` — works as well:
the primitive measures the block again and the gutter counts the lines again.
Either way, what is copied is the text the spans hold.

**`copyable`, not `copy`.** `copy` is the platform's clipboard event, and
`:copy="…"` on a tag is a listener for it, which a component refuses — so a
prop of that name could be written bare and never bound. `removable` on
`<v-chip>` is named the same way.

**The copy button copies the code on the page, and nothing else in the box.**
The text is read when the button is pressed, so it is what is on screen then:
after a highlighter, after a bound source changed. Not the numbers, which are
not text, and not the button's own words. The button's words turn to "Copied"
for two seconds while its name stays "Copy code" — a name that changes under a
screen reader's focus is read out unreliably — and the page's live region says
"Copied". When the clipboard refuses, the words are "Could not copy" and the
region says so at once. Over plain HTTP the clipboard API does not exist, and
the primitive falls back to the old selection-and-`execCommand` copy, which
still works there.

**A block is a tab stop only while it scrolls.** The `<pre>` is measured
against the code in it, across by the primitive and down by the tag, and both
are watched, so a box that narrows or is held to a height, or code that grows,
turns the tab stop on and off. A block that wraps never scrolls sideways, and
is one only if it is given a height its lines run past. Its name, while it is
one, is `Code, TypeScript` — the locale's `codeBlockLanguage`, the words a chat
names a code part by, so one block of code is not called two things on one page
— or `Code` without a language. `label` replaces it, and is only written while
the `<pre>` has a role to carry it: a `<pre>` that fits has none, and ARIA
prohibits naming an element that has none.

**A `role` written on the tag is kept.** The primitive writes `region` while a
block scrolls and takes it away when the block fits, and `code` on inline code;
a role of yours stands in for either, rather than being written over and then
removed with the primitive's. A block that scrolls under it is still a tab stop
with a name, and one with a role of its own carries `label` while it fits as
well.

**Line numbers count the lines of the code, not the rows on screen.** A line
that wraps onto three rows is numbered once, and the next number moves down
three rows to stay beside its own line: each row of the gutter holds its line,
laid out and hidden, under the code. The numbers are list markers counted by the
platform's `list-item` counter, which the gutter resets, so a block inside a
numbered list still starts at 1. There is room for three digits; a block of a
thousand lines or more wants a wider gutter, from `style` on the tag. The lines
are read off the page, so a server render draws the box but not the numbers,
and they arrive when the page attaches.

**`copyable`, `wrap`, `lineNumbers` and a name do nothing on inline code.**
The first three are drawn inside a block's box, and a run of code in a sentence
has none; `label` and `aria-label` name a region, and ARIA prohibits naming
`role="code"`. In development, writing one says so.

**What you write on the tag lands on the element with the role.** For inline
code that is the `<code>`. For a block it is the `<pre>`: the region a name
belongs on, and the box a class or a size is meant for. The copy button and the
gutter are inside it, so `style="max-block-size: 20rem"` gives a block that
scrolls down as well as across and keeps its button in the corner.

**In a right-to-left page, write `dir="ltr"` on the tag.** Code reads left to
right whatever the language of the page around it, and the tag does not assume
so: a `dir` written on it is the caller's, and nothing here writes over it.

Inline code is drawn in a monospace face on a tint, and a block in a box with a
rounded edge. A forced palette takes every tint away, so there inline code is
boxed with an edge, the block keeps its edge, and the copy button under the
pointer changes its edge rather than its fill.

For anything the tag does not offer, take the primitive and the clipboard:

```html
<v-code :ref="sample" block language="TypeScript">{ source }</v-code>
```

```ts
sample: VCode | null = null;
later(): void {
  this.sample?.scrolls();           // whether the block is a region right now
  this.sample?.code.isScrollable(); // whether it is wider than its box
  this.sample?.clipboard.copy();    // copy from a shortcut of the page's own
}
```

## `<v-relative-time>`

`createRelativeTime`, with the markup written: a timestamp that reads the way a
person would say it, and keeps saying something true.

<Demo name="relative-time" height="640" />

```html
<p>Posted <v-relative-time :date="comment.postedAt"></v-relative-time>.</p>
```

That is a `<time>` reading "3 minutes ago", with the exact moment in `datetime`
for a machine and in `title` for a reader who hovers — and a minute later it
reads "4 minutes ago". Every stamp on the page shares one timer, paced by the
shortest unit any of them is showing and stopped while the tab is hidden, so a
thread with two hundred stamps holds one timer rather than two hundred.

```html
<time class="volt-relative-time" datetime="2026-10-04T09:57:00.000Z" data-unit="minute"
      title="October 4, 2026 at 9:57 AM">3 minutes ago</time>
```

Past `threshold` — a week, unless told otherwise — the words stop meaning much
("last month" covers thirty days), so the stamp becomes the date itself:
"September 22, 2026". That is the one thing the tag adds to the primitive.

| Prop | Type | Means |
|---|---|---|
| `date` | `Date \| number \| string \| null` | The moment. Required. A string is read by `Date`, so write ISO 8601 with its zone. `null` draws an empty `<time>` with no `datetime`, for a moment not known yet |
| `threshold` | `number` | How far from now, in milliseconds, the words give way to the date. Default a week. `Infinity` keeps the words for ever; `0` is always the date |
| `format` | `Intl.DateTimeFormatOptions` | How the date past the threshold is written. Default `{ dateStyle: 'long' }`. Bound, never written as an attribute |
| `title` | `string` | The tooltip, in place of the exact date and time. `title=""` for none, which is written as an empty `title` so that a titled link around the stamp does not lend it one |
| `locale` | `string` | BCP 47 tag for the words and the date — `fr`, `en-GB`. Default the locale provider's. Written in `lang` too |
| `numeric` | `'auto' \| 'always'` | `auto`, the default, says "yesterday"; `always` says "1 day ago" |
| `style` | `'long' \| 'short' \| 'narrow'` | How long the words are: "3 hours ago", "3 hr. ago", "3h ago". Default `long` |
| `lang` | `string` | The language the stamp is read in, in place of `locale`'s. Rarely needed |

Slots: none. The words are the whole content of the `<time>`, and anything
written inside the tag is not drawn. That is what lets a server's words be
replaced without a mismatch, as the last of the notes below says.

**`style` is the length of the words, not the element's inline style.** It is
`Intl`'s name for it, and the tag keeps the name, so `style="color: gray"` does
not grey the stamp: it is refused, with the three values it could have been.
Give the tag a class for anything drawn — it lands on the `<time>`.

**Past the threshold the hour is still a hover away.** The tooltip is the exact
date and time whichever the stamp shows, so a stamp reading "September 22,
2026" says "September 22, 2026 at 3:30 PM" to a reader who hovers. `format`
shapes the date on screen and nothing else. Give it the hour —
`:format="{ dateStyle: 'long', timeStyle: 'short' }"` — and the date on screen
says what the tooltip would, so there is no tooltip there, and no underline
promising one.

**The dotted underline is the tooltip.** The sheet draws one under any stamp
with a `title` and nothing else about it: the words take the face and the colour
of the line they sit in, and the dots are in that colour, so a stamp in a muted
line of metadata and one inside a link are both right. A `title` is reached by
a pointer and by little else — not by a keyboard, not by touch, and not by
every screen reader — so nothing a reader needs belongs only there. The words
and `datetime` are what carry the moment; the tooltip is the detail.

**`locale` changes the words, and the voice they are read in.** A screen
reader picks its language from `lang`, so a stamp given a `locale` writes it
there too, and "il y a 3 heures" is read in French rather than spelled out in
English. A stamp without one is in its provider's language, which is the
page's, and writes nothing. A `lang` written on the tag wins.

**Every prop follows a binding.** `:locale="language.get()"` moves the words,
the date and the tooltip together when the signal changes, and so do
`:numeric` and `:style`. A page that changes language for every stamp at once
changes its locale provider's tag instead, which every stamp without a
`locale` of its own follows.

**A date that does not parse draws nothing.** An empty `<time>`, with no
`datetime`: a machine-readable moment that is wrong is worse than none. During
development the console says which value it was. `'03/04/2026'` is March in one
engine and refused by another; write `'2026-03-04T09:30:00Z'`.

**`threshold` is milliseconds.** `threshold="3600000"` is an hour, and the
attribute is read as the number it spells. Anything that is not a number of
milliseconds, 0 or more — `1w`, `-1`, a blank — is refused rather than read as
`NaN`, which no distance reaches and which would keep the words for ever
without a word of warning.

**What you write on the tag lands on the `<time>`**: a class, an id, `lang`,
`aria-label` and the rest of `aria-*`, `data-*`. Where the stamp writes the
same attribute itself — `title`, `lang`, `data-unit` — yours wins and stays,
whatever the date does. `datetime` is not one of them — it is the primitive's,
from `date` — and the tag refuses it as a prop it does not declare.

Nothing here is a live region, and nothing takes focus. A stamp quietly
becoming "4 minutes ago" is not news, and a page of them announcing themselves
in turn would be unusable.

**On a server, the words are the request's, and the browser writes its own.**
The server writes the words for the moment it rendered, and the date and the
tooltip in its own time zone. The page reaches the reader some time later, and
often somewhere else, so when it attaches the browser writes its own — the
words for its now, the date and the tooltip in the reader's zone — into the
`<time>` the server wrote. The element and its text node are the server's,
patched in place, and **no hydration mismatch is reported**, because there is
none to report: the hydration walk compares only the name of each block's first
node — `TIME` on both sides — and a binding writes its value rather than
comparing it. The words are a text binding with nothing beside them, so there is
no structure for the two sides to disagree about. A tooltip the server wrote
and the browser no longer wants, because the stamp crossed its threshold on the
way and now says what the tooltip did, is taken away in the same pass.

To make the date past the threshold the same on both sides, name the zone in
`format`: `:format="{ dateStyle: 'long', timeZone: 'Europe/Paris' }"`. The
tooltip is the reader's own zone once the page attaches.

For anything the tag does not offer — the unit and the amount the words are
counting in, the exact moment as a string — take the primitive:

```html
<v-relative-time :ref="posted" :date="post.at"></v-relative-time>
```

```ts
posted: VRelativeTime | null = null;
later(): void {
  this.posted?.time.unit();      // 'minute'
  this.posted?.time.value();     // -3
  this.posted?.time.absolute();  // 'October 4, 2026 at 9:57 AM'
  this.posted?.isAbsolute();     // whether it is past its threshold, and shows the date
}
```

## `<v-separator>`

`createSeparator`, with the markup written: a rule between two things, with
words on it where they help — and, given a size to move, the window splitter
between two panes.

<Demo name="separator" height="380" />

```html
<v-separator></v-separator>
<v-separator label="or"></v-separator>
<v-separator orientation="vertical" :prop-resize="sidebar" :min="15" :max="60"
             resizeLabel="Resize sidebar" aria-controls="sidebar" collapsible></v-separator>
```

```ts
sidebar = new Signal.State(30);
```

```html
<nav id="sidebar" :style="{ 'inline-size': sidebar.get() + '%' }">…</nav>
```

Decorative is the default, as the primitive has it, because nearly every rule
is: a line between two groups of a menu or two paragraphs tells a screen reader
nothing the page has not already said, and `role="separator"` on each one is an
announcement about a line. `:decorative="false"` is for a rule that means
something — the edge between two regions — and gives it the role and a name. A
splitter is never decorative, whatever `decorative` says: it is a control, and a
control cannot be presentation.

| Prop | Type | Means |
|---|---|---|
| `orientation` | `'horizontal' \| 'vertical'` | Which way the line runs, not which way it moves. Default `horizontal`; a line between panes side by side is `vertical`. Read once |
| `decorative` | `boolean` | Default `true`: `role="presentation"`, and words on it read as the text they are. `false` gives it `role="separator"` and a name. Read once, and ignored on a splitter |
| `label` | `string` | Words on the line, drawn in a gap in its middle — "or", a date in a chat. The name of a separator with a role, unless it is given one of its own |
| `resize` | `Signal.State<number>` | Your signal: the size of the pane before the line, in your units. Makes it a splitter. Bound as `:prop-resize` |
| `min`, `max` | `number` | The pane's smallest and largest size, where Home and End take it. Default 0 and 100; `min` past `max` is refused |
| `step` | `number` | How far one press of an arrow moves it. Default 1; nought or less is refused |
| `collapsible` | `boolean` | Enter collapses the pane to `min`, and the next Enter restores it. Default `false` |
| `resizeLabel` | `string` | The splitter's name — "Resize sidebar". Ignored on a line that does not move |
| `onResize` | `(size: number) => void` | Called with each size the splitter moves the pane to; not for a write to your own signal |
| `aria-label` | `string` | The separator's name in the platform's spelling, ahead of `resizeLabel` and `label`. Not written on a decorative rule |
| `aria-labelledby` | `string` | The id of an element that names it, ahead of every other name. Not written on a decorative rule |

Slots: none. The words on the line are `label`, and **anything written inside
the tag is not drawn** — `<v-separator>or</v-separator>` is a bare line. They
are a string because a separator with a role is named by them, and a name is a
string.

What it draws is one element with the role, and the line as one segment, or two
either side of the words:

```html
<span class="volt-separator" role="presentation" data-orientation="horizontal">
  <span class="volt-separator-line"></span>
  <span class="volt-separator-label">or</span>
  <span class="volt-separator-line"></span>
</span>

<span class="volt-separator" role="separator" aria-orientation="vertical" data-orientation="vertical"
      tabindex="0" aria-valuenow="30" aria-valuemin="15" aria-valuemax="60"
      aria-label="Resize sidebar" aria-controls="sidebar">
  <span class="volt-separator-line"></span>
</span>
```

Every part is a `<span>`, so a rule is valid wherever text is — between two
words of a paragraph, inside a heading or a label — and a server's markup
reaches the page as it was written. A `<div>` there would end the paragraph
where it starts, in the browser's parser rather than in any script, and the
rule would be pulled out of the line it was meant to stand in. The sheet
decides how it is laid out: a horizontal rule is a block, and a vertical one
inline.

**`resize` is bound as `:prop-resize`.** It shares its name with the window's
`resize` event, and on a component tag `:resize="…"` is read as that event and
refused — with a message suggesting `:onResize`, which is a different prop: the
callback told of each move, not the size. Nor can it be written out:
`resize="30"` is a string, and the splitter needs the signal your markup sizes
the pane from, so a string is refused with a message that names the tag.

**The component sizes nothing.** `resize` is a number in your units — a
percentage, given the default 0 to 100 — and your markup turns it into a size:
an `inline-size`, a `flex-basis`, a grid track. The splitter moves the number,
reports it, and leaves the layout to you.

**Orientation is the line's, not the movement's.** A vertical line stands
between panes side by side, and Left and Right move it — swapped in a
right-to-left layout, where the pane before the line is on the right. A
horizontal line moves with Up and Down, and Down makes the pane above it larger.
Home and End are the pane's `min` and `max`, not the start and end of the page.
None of them scrolls the page as well, and any key with Ctrl, Meta or Alt held
is left alone.

**Enter collapses and restores, when `collapsible`.** It takes the pane to
`min` and back to the size it collapsed from. A splitter Enter has never
collapsed — one that started at `min`, or was taken there by Home — restores to
`max`. Without `collapsible`, Enter is left to the page.

**A pointer drag is not here.** Dragging is layout: it has to know where the
panes are and what a pixel is worth in your units, and a separator knows
neither. For panes a pointer drags, use
[`createResizable`](./primitives-collections#resizable-panels), which measures
its group and drags its handles. For a drag of your own over this one, take the
primitive with `:ref` and call `setValue` with the size the pointer works out
to — it clamps to the range and reports through `onResize`, as a key does. The
sheet leaves the cursor alone for the same reason: a resize cursor would promise
a drag that is not there.

**A splitter needs a name, and none is invented.** "Separator, 30" says nothing
about which pane moved, and a wrong name is worse than a missing one.
`resizeLabel` names it; `aria-label` comes ahead of it, and `aria-labelledby`
ahead of both, as it does in the accessible name computation — the two are never
both written. Without any of them a splitter is named by its words, and then by
nothing. `aria-controls` on the tag points it at the pane it sizes, and
`aria-valuetext` says the size the way it should be heard — `30 percent` rather
than `30` — and follows whatever it is bound to.

**Words name a line only when it has a role.** On a decorative rule, "or" is
read where it stands, as the word it is. A separator with a role makes
everything inside it presentational, so its words would not be read at all; the
component writes them as its name instead, and follows them when they change.
Blank words are no words: no gap is drawn, and no name is written.

**A decorative rule takes no name.** ARIA forbids naming an element with
`role="presentation"`, and a browser that meets a name there may drop the
presentation and expose a nameless `<span>` in the middle of the content. So
`aria-label` and `aria-labelledby` on a decorative rule are not written. A rule
that needs a name means something: give it `:decorative="false"`.

**Most of it is read once.** `orientation`, `decorative`, `resize`, `min`,
`max`, `step`, `collapsible` and `onResize` are what the primitive is built
with, so they are not signals and changing them later does nothing — a line is a
splitter for its whole life or never, so put an `:if` round one to have it and
not the other. `label`, `resizeLabel`, `aria-label` and `aria-labelledby` follow
whatever they are bound to. Written as attributes, `decorative="false"` and
`collapsible="false"` are the false they say, and `min="15"` is the number 15;
an `orientation` other than the two is refused, since the primitive would write
it into `aria-orientation` as it stands. So is a `min`, `max` or `step` that is
not a number — `max="lots"`, or a `NaN` bound to it, which would reach the page
as `aria-valuenow="NaN"` — a `min` past `max`, and a `step` that does not move
the pane forward.

**What you write on the tag lands on the line's element**, which is the one
carrying the role: `aria-controls`, `aria-describedby`, `aria-valuetext`, `dir`,
an `id`, a class.

The line is a border on a logical edge — the block-start edge of a horizontal
line, the inline-start edge of a vertical one — rather than a filled box, which
a forced palette would paint away. Words sit in a gap between two segments of
the line rather than on a patch painted over it, so the gap is a gap on a card,
a sunken panel or a picture as well as on the page. A vertical rule is inline,
so it can stand between two words, and stretches to the height of the row it
stands in. A splitter is at least eight pixels across its line, which is
something a pointer can land on to give it focus, and its line is drawn in the
colour every other control draws its edge in, since it is the only thing on
screen that says this line moves. Its focus ring is drawn inside that area
rather than round it, because a splitter usually stands flush in a container
that clips. Under a forced palette every line is `CanvasText`, so a splitter's
line is drawn twice as heavy instead — the colour that told it from a rule is
gone, and its grab area is empty — and a splitter with focus is ringed and lined
in `Highlight`.

For anything the tag does not offer, take the primitive:

```html
<v-separator :ref="splitter" orientation="vertical" :prop-resize="sidebar"
             resizeLabel="Resize sidebar"></v-separator>
```

```ts
splitter: VSeparator | null = null;
reset(): void {
  this.splitter?.separator.setValue(30);
}
```
