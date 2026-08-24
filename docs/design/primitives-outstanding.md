---
title: Components held back, and why
---

<!--
  Not part of the published site; `srcExclude` keeps it out.

  Three components are written, tested and NOT exported. Each went through
  repeated rounds of fixing and independent adversarial review, and each still
  has a defect a reviewer reproduced with a probe. This records what those are
  so the next pass starts from evidence rather than rediscovering them, and so
  nobody exports one on a green suite alone — the suites are green.

  The shared shape of the problem: every round fixed the finding it was given
  and broke a neighbour, because these three each have one model whose
  invariants are spread across many call sites. They need that model redesigned
  once, not another finding-by-finding pass.
-->

# Components held back, and why

## combobox

Redesigned once rather than fixed again. Every defect below came out of a
single model — what the textbox displays for a value — being spread across a
label cache, four opt-in cures, and a seeding effect that inferred from
`filtering` who had last written the box.

The model is two sentences. A value's name lives in one registry that every
source files into as it appears — a rendered option, a select's native
`<select>`, the text the page was rendered with, `labelFor` — and a value
nothing has named has no name, rather than being named after its own
identifier. The textbox says exactly one of two things and one signal says
which: the question the user is asking, or the name of the value held; a
question is retired only by being answered, and answering is choosing.

What the old mechanisms became:

- `labelCache`, `rememberLabels`, `rememberLabel` and the five-branch `labelOf`
  chain → `names` plus `nameValue`/`nameOf`. `labelOf` is one line over
  `nameOf`, for the surfaces that must say something; the textbox reads `nameOf`
  and shows nothing when it answers nothing.
- The self-heal on first render, and the list-revision dependency it rode on →
  a counter beside the registry. Learning a name is the only event, so it is
  the only thing subscribed to.
- `filtering`, `searchable`, `showInputValue`/`setInputValue`, `settledText` and
  `openFiltered` → one `asked` signal. The list is narrowed by it, `search` is
  asked for it, and the element is written from it, so those three cannot come
  apart. Opening no longer says anything about the box, which is what the click
  that repositioned a caret was tripping.
- The seeding effect's `setup`/`changed`/`stale` guesswork → one effect that
  writes only its own last write, and reports an input change for everything
  except a name being learned.
- The `!core.multiple` guard → `shownValue`, one definition of which value the
  box is showing. A multiple shows none, so the naming code has no branch for
  it, and its chips get names from the same registry as everything else.

Decided along the way, and defended in `defaultValue`: a bare
`{ name, defaultValue: 'ba' }` leaves the box empty rather than showing `ba`. A
textbox holds text somebody could have typed — it is filtered on, searched for,
completed from, and committed with `allowCustomValue` — so an identifier there
is not a label that reads oddly, it is the component answering for the user.
That is what aborted the `minLength: 0` preload: the seed wrote a query nobody
asked. The value is held, submitted and reported by `value()` throughout, and
the box fills in by itself the moment anything can name it.

The four defects introduced by the earlier rounds are gone with it, each with a
test that fails without the change: the aborted preload, `toggleValue` refusing
to remove on a single-value widget, the seeding effect rewriting typed text, and
`readOnly` no longer returning early from `select`. A press on an option now
takes rather than toggles when only one value is held, which is the neighbour
that fix would otherwise have broken.

That review has now run, and it reproduced no defect in behaviour. What it
found was ten pieces of correct code that nothing held: three of the four
`readOnly` guards, `deselect` — which the chip buttons reach and every other
route refuses before — the writer effect's own-last-write guard and both
branches a value arriving from outside turns on, `commitCustomValue` naming
what it takes, the adopt effect's `multiple` guard and its once-only flag, and
Enter on the option already held. Each has a test now, and each test reddens
when the line it is about is deleted. The one test that read as covering the
read-only story drove none of it: it never typed, so the question those guards
exist to protect was never in the box. It types now.

The commit that landed the redesign called all three files growing "the
opposite of the signal a real redesign gives", and held the work back for it.
That reading was wrong here, and measurably: 2161 → 2215 lines in total, of
which 1102 → 1085 are code. The file grew by 54 lines of prose and shed 17 of
code, and `labelCache`, `rememberLabels`, `rememberLabel`, `showInputValue`,
`settledText`, `openFiltered` and `searchable` appear nowhere in it — the one
hit left for `filtering` is the word inside a comment.

Not exported yet. What it is waiting on is the next round finding nothing,
rather than a named defect.

### The export itself has a prerequisite nobody had looked for

Readiness was the only question anybody was asking about these three, and it is
not the only one that has to be answered. `packages/primitives/src/index.ts`
re-exports with `export * from`, and combobox declared its own `ListboxLabels`
and `ListboxOptionOptions` — different types from the ones `listbox.ts` exports
under those names, one of which takes a type parameter and one of which does
not. Adding the star export is `error TS2308` twice over: a hard build failure,
not a silent shadow. Verified by adding the line and running `tsc`, rather than
reasoned about.

They are renamed to `ComboboxLabels` and `ComboboxOptionOptions`. Nothing
outside the file could have referred to them, since the file was never
exported, so the rename costs nothing — but it had to happen before the export,
and it would have been found by whoever tried it rather than by whoever decided
it.

Checked at the same time, and not a blocker: neither `inputs` nor
`slider-upload` collides with anything, the three do not collide with each
other, and none of them has a stylesheet in `@voltdev/ui` — which is the norm
rather than a gap, since nine already-exported primitives have none either.
`@voltdev/primitives` is headless and `@voltdev/ui` covers a subset on purpose.

## inputs

Went from one unfixed finding to two across three rounds — the only one of the
four that got further from shipping each time. Focus after a removal was the
coupled part: `removeAt` was fixed and `clear()` was not, and the fix for one
kept moving the problem into the other. It is now one rule in one place rather
than a guard at each call site.

The rule: when the tag holding focus is destroyed, focus goes to the tag that
took its place — the row closes up leftwards, so that is the one the eye is
already on — to the last tag when the row is now shorter than that, to the text
box when no tag is left, to the row itself when even the box refuses it, as a
disabled field's does, and to the field's own root when the row has gone as
well. `<body>` is the one answer never given, because it is the top of the
document and the next Tab would start again from there.

The end of that chain is what the round before this one got wrong. A row
rendered only while there are tags leaves with the last one, and a disabled
field's box refuses focus; each had a test of its own, neither had one with the
other, and together they ran off the end of the chain and landed on `<body>` —
the one answer the rule says it never gives. The root is the terminal because
it is the part of the field certain to still be there, and it is why `root` is
required now, as `list` already was: focus is placed from the row and, when
there is no row left, on the field itself.

It is applied where every removal meets. The row is rendered from the value, so
`removeAt`, `clear()` and a write to a value signal the consumer owns all
arrive as a change to it; a guard on the two methods answers for the two of
them alone, and the third has no call site to put one on. Which tag to hand off
to is measured against the row and not against the value, because what is being
chosen is an element to focus: a row can show fewer tags than the value holds,
and an index clamped to the value would point past the end of the row and give
up on a row that still has tags in it.

Where focus is is recorded in one place, the row's own `focusin`. A click is
focus arriving too, and it is the only arrival no key handler sees: the arrows
used to keep a record of their own, so a clicked tag held focus while Tab still
came back to the tag the keys had last been on. Everything that moves focus now
only moves it, and the row hears where it went.

The row's single tab stop is the same question asked about the *next* Tab, so
it follows the same rule. Two mechanisms carry it rather than one: it is read
back clamped to the row, so a row that shrinks under the stop cannot leave every
tag at `tabindex="-1"` and the whole row unreachable by Tab; and an emptied row
hands it back to the first tag, because the tags that come back are new ones and
a stop left where the row was last entered would drop Tab into the middle of
them. Both are load-bearing, and each has a test that fails without it.

That first sentence described something the code did not do until recently. The
stop was read back clamped to the *value* while every other focus decision was
clamped to the *row*, so a consumer whose row shows fewer tags than the value
holds — the case `handOffFrom` exists for — could be left with no tab stop at
all. The clamp is now on the write side, in the settle effect, and the two
records of where focus is have been collapsed into the one `roving` already
reads, which closed a second symptom nobody had reported separately: a stale
`activeTag` also steered the arrows, so they refused to move while reporting the
press as handled.

That path is closed too, and how it resisted two obvious fixes is worth
recording. The settle effect tracked one signal — the value's length — so a row
narrowed for any other reason, a search term or a filter, never re-ran it and
the stop could be left outside the row.

Clamping on the read side does not work: `tagProps` reads no signal that changes
when the row narrows, so the surviving tags never re-run their `:spread` and the
stale answer stands. Clamping against the collection on the write side does not
work either, for the mirror-image reason the original code was written against
the value: `tagCollection` is a live DOM query and the first render pass runs
while the `<li>` is still detached, so it is empty exactly when it is first
asked.

So the row is observed. One `MutationObserver` per field, on the element the
field already holds a reference to, watching children and the attribute that
marks a tag disabled, bumping a revision the settle effect tracks. The cost is
one observer per tags input, which is the price of a guarantee about a
collection the component does not own. It reports on a microtask, so the turn
the row changed in is not the turn the record is corrected in — which the test
has to allow for, and says so.

The case was not expressible before: the suite's row filter was a module-level
value fixed before mount, so a row could not be narrowed while the component
was alive. It is a signal now.

Covered by tests that fail without the part they name: the hand-off landing on
the row when a disabled field's box refuses focus, and on the field itself when
the row has gone too; the stop after `removeAt`, after a click, and after a
consumer write shortens the row; the hand-off measured against a row showing
fewer tags than the value holds; the record kept when a tag off the page
announces the focus it lost, which is what the engines that announce it send;
and the record let go of when the tag holding focus has left the row. The three
the rule exists for — `removeAt` on the focused tag, `clear()` while one holds
focus, and the last tag going — were already covered and still are.

Two things found while redesigning it, neither about where focus goes. Both are
as they were, and both are pinned now, so that closing either is a decision
somebody makes rather than a change nobody notices:

- `clear()` removes while `disabled` or `readOnly`, where `removeAt` refuses.
  `removeAt` backs a control this field describes and Backspace on a tag, which
  a disabled field answers for; `clear()` is the consumer's own call, the same
  write they could make through the value signal beside it, which no guard here
  could refuse anyway.
- `clear()` writes nothing to the live region, where `removeAt` announces
  "ada removed". Emptying the row is the largest change the field makes and the
  only one it makes silently. Saying it needs a label the field has not got, so
  the test pins what it does rather than what it should.

### What the post-fix round found

Mutation over all three, at the commit where their defects were fixed, leaves
31% of combobox's 190 sites alive, 31% of inputs' 251 and 28% of slider-upload's
221 — one band, so none of them is anomalous beside the others. Most survivors
are null checks nothing can reach with a null.

What was not: **eight `disabled() || readOnly()` guards in inputs that nothing
distinguished**, the same class of gap combobox had. Four are now held by tests
that die with them — `canIncrement`, `canDecrement`, a step asked for directly
through `increment`/`decrement`, and `add` on the tags input. Each is public
surface, so the guard inside is the only refusal a consumer meets.

One is redundant and no test can hold it: `check()` at inputs.ts:742 refuses to
validate a disabled or read-only field, and `form-field.ts:355` has already
refused to call it. Defence in depth, unobservable, recorded so it is not
chased.

**Still outstanding for slider-upload:** four `disabled()` guards of the same
shape, at 2059, 2120, 2148 and 2154, have not been triaged or covered. That is
the remaining work before it can be judged, and it is why it stays held.

## slider-upload

Closest of the three: every named defect fixed, one neighbour broken each
round, until the dirty model was redesigned rather than patched again.

It used to infer dirtiness from who wrote the value — a boolean set from the
`input` and `change` events the mirrors fired — so a write nothing announced
did not count, and a restored session submitted a value while `isDirty()` read
false and `data-dirty` was absent.

It now compares two states and asks nothing about their authors: what a submit
would send, against what a reset would restore. The value a submit would send
is read from the mirrors on every call, because assigning to `value` announces
nothing and a sampled answer never sees it. The one record kept is the value
the mirrors were last filled from, which is what says which of the two moved:
a mirror still holding it is a render behind and the value is newer, and a
mirror holding anything else was written from outside. That record is what the
same-tick tests are about — an `onValueChange` handler must not be told the
slider is back at its default while the form is not — and comparing against
the live value instead of the record reddens eight tests, five of them
same-tick.

Covered by tests that fail without the model: a keyboard change and the way
back to the default; a value written straight to a mirror with no event at
all, on the first thumb and on the one the field never validates; a write
announced by `input` and a write announced by `change` alone, both on the
mirror the field is not listening to, so each delegated listener is driven by
the test that names it; a second `pageshow`, so the counter the rendered
attribute hangs off cannot answer once and then stop; every thumb of a range,
on both of the prop objects the field publishes dirtiness on; and
`field.reset()`, which now puts the value and the mirrors back together rather
than clearing a flag over a value the form would still send.

What it cost is worth stating, because the round was meant to leave fewer
moving parts and left more. A boolean and the function that filled it became a
per-thumb mirror lookup, the record of what the mirrors were last filled from,
the submitted-value read, a counter with three listeners behind it, and a
`reset` that writes both halves: three mechanisms became five, and the region
is longer than what it replaced. What was bought is a model that can be checked
against the DOM the form is actually read from, instead of one that had to be
told who wrote what — but the count went the wrong way, and that is a cost
rather than a saving.

Two honest limits, neither of them the defect above:

- A silent write makes the slider dirty but does not move the thumb. `values()`
  is still the slider's own state, so a restored form reports itself unsaved
  while showing a value it will not submit. Sharpest when the restore writes
  the *default* over a slider the user has moved: the thumb reads 21, the form
  would send 20, and `isDirty()` is false because a reset would change nothing
  about the submit. That answer is pinned by a test rather than left to fall
  out of the arithmetic. Adopting the mirror is the next question to settle,
  and it is a question about what the value *is*, not about what dirty means.
- A rendered `data-dirty` can only follow something that invalidates. `input`,
  `change` and `pageshow` each have a test of their own — autofill and a
  session restore, which announce themselves with one or the other, and the
  bfcache, which announces itself with neither; a script that assigns `value`
  and fires nothing shows up on the next render for any reason. `isDirty()`
  itself is right the moment it is asked.

## query — the write that did not land, resolved

Kept as a record of how it was found, because the shape recurs: a defect that
only appeared with the other test files in the room.

The symptom was `client.setData(key, 'Grace')` on an entry holding `'Ada'`
leaving `client.getData(key)` reading `'Ada'`, but only when the query test
files ran together. It was attributed to the process-wide `queryClient` the
module exported as `createQuery`'s fallback, shared by every test in a run and
by every request on a server.

That export is gone. The cache is reached through `provideQueryClient` and a
scoped context, which `docs/design/ssr.md` requires of request-derived state,
and four tests in `query.test.ts` hold the boundary — including one asserting
that a scope with no cache throws rather than inventing one. The symptom no
longer reproduces: `lets a subscriber that outlived a clear go on working` is
un-skipped and passes across repeated, shuffled and isolated runs.

Attribution is the one loose end. Restoring the singleton on its own does not
bring the symptom back — it reddens the four scope tests first, and those now
pass a client explicitly — so the singleton is established as a design defect
and only inferred as the cause of the write. Nothing here is waiting on it.

Two things established while finding it, both still true and now each covered
by a test that fails without them:

- Restarting the collection clock when an unobserved entry is written to is a
  real fix, proven under both real and fake timers. Without it an entry's age,
  not its last write, decides when data written a moment ago is collected.
- `evict`'s identity guard is correct: an orphan's collection does not take a
  replacement filed under the same key. The test that appeared to prove
  otherwise could not distinguish that from the replacement's own legitimate
  collection, because it left the replacement unobserved. It now holds it.

Still landed unfinished on purpose: two `it.skip`s in `infinite.test.ts` —
superseding an append with an invalidation, and two infinite queries sharing
one key. Twelve of the fourteen cases pass; these two are the remaining work.
