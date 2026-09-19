# Testing

`@voltdev/testing` tests a component the way it is used: mount it, find its
parts by role and accessible name, drive them with the event sequences a
browser produces, and take it away again with nothing left behind.

```ts
import { cleanup, click, render } from '@voltdev/testing';

afterEach(cleanup);

// inside it('counts', () => { … })
const view = render(Counter);

click(view.getByRole('button', { name: 'Add one' }));
expect(view.getByRole('status').textContent).toBe('1');

view.unmount();
expect(view.leakedEffects()).toBe(0);
```

Three rules shape the package, and each is there because the alternative lets a
broken component pass.

- **Queries go through the accessibility tree.** There is no `getByTestId`, no
  query by class and none by tag. A component library's regressions are
  semantic — an option that stopped exposing `role="option"`, a button whose
  label went missing, a dialog left in the DOM after it closed — and every one
  of them survives a query written against markup. Asking for the button named
  "Save" fails exactly when a user could no longer find the button named
  "Save".
- **Interactions are real event sequences.** `click()` dispatches what a
  browser dispatches, in the order it dispatches it, including the focus move
  on `mousedown`; `press()` raises the click a browser raises from Enter or
  Space, at the moment it raises it. Calling a handler directly proves only
  that the handler works.
- **The scheduler is cooperated with, never replaced.** `settle()` gives
  pending promises a fixed number of microtask turns to resolve and flushes
  after each; `installClock()` fakes the wall clock and the task timers and
  leaves the microtask queue — where Volt's flush lives — alone.

Everything here runs under a DOM emulation, not a browser. What that rules out
is listed [at the end](#what-is-not-here).

## Setting up

::: warning Not on npm yet
The release publishes `@voltdev/reactivity`, `@voltdev/compiler`,
`@voltdev/core` and `@voltdev/vite-plugin`, and this package is not among them,
so `pnpm add @voltdev/testing` fails today. Until it is published it is
available from a checkout of the Volt repository, as a workspace dependency.
:::

However it arrives, it has to resolve the same copy of `@voltdev/core` as the
components under test. `render` mounts through that package's `mount`, which
looks a component up in a registry its `@Component` decorator filled in; a
second copy has never seen the decorator run and refuses to mount the
component, saying it is not decorated.

The tests run in Vitest with the same plugin the application is built with:

```ts
// vitest.config.ts
import { volt } from '@voltdev/vite-plugin';

export default {
  plugins: [volt()],
  test: { environment: 'happy-dom' },
};
```

The plugin is not optional. It lowers the decorators `@Component` is written
with — without it a test file fails to parse at the first `@` — and it defines
`__VOLT_DEV__` and `__VOLT_SERVER__`, which Volt reads as bare identifiers and
which crash on first read when nothing defines them. It also means a test runs
the component that ships rather than a differently compiled copy of it.
A project [`create-volt`](./create-volt) generates already has this file —
wrapped in `defineConfig` from `vitest/config` — though none of the templates'
example tests uses this package: the minimal one mounts with `@voltdev/core`
directly and finds its parts by selector.

The examples on this page leave out `import { afterEach, expect, it } from 'vitest'`,
and show the body of a test rather than the `it(…)` around it.

## Mounting a component

```ts
render<T>(component: ComponentType<T>): RenderResult<T>
cleanup(): void
```

`render` mounts into a fresh `<div>` appended to `document.body`. In the
document rather than detached, because Volt delegates bubbling events to the
document: a handler on a detached tree is never called, and a component tested
outside the document would appear not to respond to anything.

| Member | Description |
|---|---|
| `container` | The element the component was mounted into |
| `instance` | The component instance, typed, for driving it from outside its markup |
| `getByRole(role, options?)` | The one match in the document. Throws on none or several |
| `getAllByRole(role, options?)` | Every match. Throws on none |
| `queryByRole(role, options?)` | The one match, or `null`. Throws on several |
| `queryAllByRole(role, options?)` | Every match, possibly none. Never throws |
| `unmount()` | Tear the component down, remove its container and flush. Safe to call twice |
| `leakedEffects()` | How many more effects the scheduler holds now than when `render` was called |

**The bound queries search the whole document, not `container`.** A portalled
dialog, popover or toast renders outside the component that declared it — that
is what `:portal` is for — so a query scoped to the container would fail to find
precisely the parts most worth testing. The user sees one page, and so does the
query. To narrow deliberately, pass an element to the
[free functions](#finding-things).

`container` is for what genuinely is about markup: a snapshot, a class a
stylesheet depends on. The queries do not use it.

### What has run when it returns

`render` returns a settled tree: the mount flushes before handing it back, so
field effects — a user effect's first run included — have already run, and
the markup reflects them.

`onMount` has not. It is queued on a microtask so that it runs once the node is
in the document, and nothing synchronous in a test reaches a microtask
checkpoint — not `render`, and not the [interaction helpers](#driving-it),
which flush with `flushSync()`. Anything a component does in `onMount` needs an
`await settle()` before it is visible:

```ts
import { render, settle } from '@voltdev/testing';

const view = render(SearchPage);
await settle(); // onMount has run: the field it focuses is focused

expect(document.activeElement).toBe(view.getByRole('textbox', { name: 'Search' }));
```

### Props

`render` takes no props, because the `mount` underneath it has none. A
component's signals and methods can be driven through `view.instance`, but a
component with a `@Prop({ required: true })` throws as it mounts — `V0209`,
"requires the prop" — so `render` never returns an instance to drive. The
check is a development one, and a test runs as development. Give it a parent
in the test:

```ts
import { Component } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { click, render } from '@voltdev/testing';
import { Stepper } from './stepper.js';

@Component({
  selector: 'v-stepper-fixture',
  imports: [Stepper],
  render: compileTemplate(`<v-stepper :max="2"></v-stepper>`),
})
class StepperFixture {}

const view = render(StepperFixture);
const add = view.getByRole('button', { name: 'Add one' });
click(add);
click(add);
click(add);

expect(view.getByRole('status').textContent).toBe('2');
```

`view.instance` is then the fixture, not the component inside it — which is
usually a sign the test should be asking the page rather than the instance
anyway.

### `cleanup`

Unmounts everything `render` mounted that is still mounted, newest first, so a
component mounted inside another's lifetime goes before it. Wire it up once per
file with `afterEach(cleanup)`: a test that fails part way never reaches its own
`unmount()`, and the component it left would otherwise go on answering queries
in the next test — which is how one broken test becomes a broken file.

It deliberately does not assert that nothing leaked. A failure raised from
`afterEach` reports against whichever test ran last rather than the component at
fault, and it would fire on effects the test created on purpose. Leaks are
asserted where they can be attributed — see
[nothing left behind](#nothing-left-behind).

It does not uninstall a [fake clock](#fake-timers) either; that needs its own
line in `afterEach`.

## Finding things

```ts
getByRole(container: ParentNode, role: string, options?: RoleQueryOptions): HTMLElement
getAllByRole(container: ParentNode, role: string, options?: RoleQueryOptions): HTMLElement[]
queryByRole(container: ParentNode, role: string, options?: RoleQueryOptions): HTMLElement | null
queryAllByRole(container: ParentNode, role: string, options?: RoleQueryOptions): HTMLElement[]
```

The free functions take the node to search first; the four on a `RenderResult`
are the same functions with `document.body` filled in. Results come back in
document order. Only what is inside the node is searched, never the node
itself, so `getByRole(form, 'form')` finds nothing — pass its parent.

| Function | None match | One matches | Several match |
|---|---|---|---|
| `getByRole` | throws | the element | throws |
| `queryByRole` | `null` | the element | throws |
| `getAllByRole` | throws | `[element]` | every one |
| `queryAllByRole` | `[]` | `[element]` | every one |

`queryByRole` throws on several rather than returning the first. A test asking
for *the* button on a page that has two is asking the wrong question, and handing
back whichever came first in the document would let it act on the wrong one
without a word. Narrow it with a `name`, or query the subtree it belongs to.

```ts
interface RoleQueryOptions {
  name?: string | RegExp;
  hidden?: boolean;     // default: false
  selected?: boolean;
  checked?: boolean;
  pressed?: boolean;
  expanded?: boolean;
}
```

| Option | Matches |
|---|---|
| `name` | The accessible name. A string must match all of it, after whitespace is collapsed; a `RegExp` is tested against it |
| `hidden` | Include elements hidden from the accessibility tree |
| `selected` | `aria-selected`, or a native `<option>`'s own selectedness |
| `checked` | `aria-checked`, or a native checkbox or radio's own checkedness |
| `pressed` | `aria-pressed` |
| `expanded` | `aria-expanded` |

A string `name` is a whole match on purpose. A substring match would make
`name: 'Save'` find "Save as…" and pass a test whose button is the wrong one.
Reach for a `RegExp` when something looser is what you mean. It is applied
with `search()` rather than `test()`, so every name is searched from its start
and the pattern's `lastIndex` is neither read nor moved: a `g` flag changes
nothing, and a `y` flag anchors the pattern to the start of the name.

`hidden` is off by default because a closed dialog's buttons are still in the
DOM, and finding them is how a test comes to assert on something no user could
reach.

The state options read the state as the accessibility tree reports it, not as
the markup spells it. A native `<input type="checkbox">` carries no
`aria-checked` and changes nothing in its markup when ticked; reading the
attribute alone would make `{ checked: true }` match nothing on a native form,
and a test asserting that something is absent would pass for the wrong reason.
An indeterminate checkbox is `mixed`, so it matches neither `true` nor `false`.

`false` matches a state that is present and false, not one that is absent. A
`<button>` with no `aria-expanded` is not something that expands, and
`{ expanded: false }` does not find it; a `role="option"` with no
`aria-selected` is not found by `{ selected: false }` either. Only a native
checkbox, radio or `<option>` always has a state to report.

Where an element carries both, the ARIA attribute is read and the native
property is not. That is this query's rule rather than a model of any browser,
and it only matters for markup that ARIA in HTML asks authors not to write —
`aria-checked` on a native checkbox — where the two can disagree.

```ts
import { getByRole, queryByRole, render } from '@voltdev/testing';

const view = render(Preferences);
const form = view.getByRole('form', { name: 'Notifications' });

getByRole(form, 'checkbox', { name: 'Email me', checked: true });
expect(queryByRole(form, 'button', { name: /^Save/ })).toBeNull();
```

### When a query fails

It prints what the node it searched does contain — the whole document, for a
query on a `RenderResult` — because "found no button named Save" is only half
of what you need to know:

```text
[volt] Found no button, named "Delete".

What is there:
  button        "Save"
  status        "Saved"
```

Elements with no role, or a `generic` or `presentation` one, are left out — a
`<div>` has no semantics to have got wrong, and listing every one would bury
the lines that matter. The list stops at twenty and says how many more there
were. A query that found several names each candidate instead.

## Driving it

```ts
click(element: Element, init?: PointerEventInit): void
hover(element: Element, init?: PointerEventInit): void
unhover(element: Element, init?: PointerEventInit): void
focus(element: Element): void
blur(element: Element): void
press(element: Element, key: string, init?: KeyboardEventInit): void
typeText(element: Element, text: string): void
clear(element: Element): void
```

| Function | What it dispatches |
|---|---|
| `click` | `pointerdown`, `mousedown`, the focus move, `pointerup`, `mouseup`, `click` |
| `hover` | The move from wherever the pointer was — `pointerout` and `pointerleave` to what it left, `pointerover` and `pointerenter` to what it entered, then the same four as mouse events, each naming the other end of the move as its `relatedTarget` — then `pointermove`, `mousemove` |
| `unhover` | `pointerout`, `pointerleave`, `mouseout`, `mouseleave`, with a `relatedTarget` of `null`: the pointer leaves the page, and every element it was inside is left |
| `focus` / `blur` | A real focus change, through `.focus()` and `.blur()` |
| `press` | `keydown`, then `click` for Enter, `keyup`, then `click` for Space — the click only where a browser raises one, and only if `keydown` was not cancelled. Enter in a text field commits it and submits its form instead |
| `typeText` | Focus, then per character: `keydown`, `beforeinput`, the write, `input`, `keyup` |
| `clear` | Focus, then one `beforeinput` and `input` of type `deleteContentBackward`. An empty field is left alone, focus included |

`init` is merged into every pointer or mouse event the helper dispatches, over
its defaults — modifier keys, coordinates. `init.button` changes the sequence
as well, as it does in a browser. `buttons` holds that button's bit while it is
down — 1, 4 and 2 for the primary, auxiliary and secondary buttons, 8 and 16
for back and forward — and a press with any button moves focus, but
only the primary button's release is a `click`. Any other sends `auxclick`,
and the secondary one sends `contextmenu` as it goes down, which is when macOS
and Linux send it. `press` puts its `init` on the two key events and not on the
click it raises.

Every helper flushes the scheduler after each event it dispatches. A browser
reaches a microtask checkpoint after every event, so a component that reads a
signal written by `pointerdown` while handling `mouseup` has to see the new
value here too. They are all synchronous, and the DOM is settled when one
returns. Work that waits on a promise needs [`await settle()`](#waiting), and
work that waits on a timer needs [the clock](#fake-timers) advanced.

What each one gets right is a bug it would otherwise hide.

- **Focus moves on `mousedown`, and only if nothing cancelled it.** That is how
  a menu keeps focus on its trigger while its items are pressed. The focus goes
  to the nearest focusable ancestor-or-self, and `tabindex="-1"` counts — it
  takes an element out of the Tab order, not out of reach of the pointer, which
  is the whole basis of roving focus. A press on nothing focusable takes focus
  off whatever had it, which is how clicking the page background dismisses a
  focus-driven popover. Cancelling `pointerdown` goes further: a browser then
  sends none of that press's mouse events, so there is no `mousedown` to move
  focus and no `mouseup`, and only the `click` still arrives.
- **Enter activates on the way down; Space on the way up.** A component that
  cancels Space on `keydown` to stop the page scrolling is also, on a
  `<button>`, cancelling the click that would otherwise arrive on `keyup` and
  toggle it a second time. Raising the click at the wrong moment makes that
  double-toggle invisible.
- **`focus` calls `.focus()` rather than dispatching a `focus` event.**
  Dispatching notifies the listeners and leaves `document.activeElement`
  pointing somewhere else, so every later assertion about focus is a lie.
- **`typeText` is per character.** A search box that debounces, a tags input
  that splits on a comma and a masked date field each behave differently for
  "0102" arriving as four events than as one assignment to `value`. A character
  built from a surrogate pair is one keystroke, and cancelling `keydown` or
  `beforeinput` suppresses the character exactly as a browser does. So does a
  field at its `maxlength`, which hears `beforeinput` and then refuses the
  character, with no `input` after it. The text is kept as typed, the way a
  browser keeps it: a number field holding "-" reports an empty `value`, and
  the "3" typed next still makes "-3".
- **Leaving a field commits it.** Once `typeText` or `clear` has changed a
  field, focus leaving it sends `change`, before `blur` — however focus
  leaves: another helper, a handler moving it on, or `.blur()` called by the
  test. So does Enter in it. A field that ends where it began sends nothing.
  That is what `:model.lazy` and a `:change` handler listen for, where a plain
  `:model` listens for `input`.
- **There is one pointer.** `hover` moves it from wherever it was, so hovering
  a second element leaves the first: `pointerleave` and `mouseleave` go to
  every element it is no longer inside, innermost first, and `pointerenter`
  and `mouseenter` to every element it has come into, outermost first. A
  wrapper hears the pointer arrive at anything inside it, and an ancestor it
  never left hears nothing. Each event's `relatedTarget` is the other end of
  the move, as in a browser: `out` and `leave` name where the pointer went,
  `over` and `enter` where it came from, and `null` stands for the page. That
  is how a tooltip tells the pointer crossing from its trigger onto it apart
  from the pointer going away, so the crossing is safe at any close delay.
- **`click` does not imply `hover`.** Keyboard and touch activation produce no
  hover at all, and a tooltip that only opens on hover should have to be
  hovered.

```ts
import { press, render, typeText } from '@voltdev/testing';

const view = render(TagInput);
const field = view.getByRole('textbox', { name: 'Tags' });

typeText(field, 'volt,');
press(field, 'Backspace'); // the key only: removing a tag is the component's own keydown handler
press(view.getByRole('grid'), 'ArrowDown', { shiftKey: true });
```

### Keys

`key` is a `KeyboardEvent.key` value, so Space is `' '`. `press(el, 'Space')`
dispatches a key no keyboard produces, and raises no click.

The click is raised only where the browser itself raises one: a `<button>`, a
`<summary>`, an `<input>` of type `button`, `submit` or `reset`, a checkbox or
radio on Space, and a link with an `href` on Enter. A `<div role="button">`
gets its keys and nothing else, because no browser synthesises a click for it —
a widget built out of `<div>`s has to handle the key itself, and a helper that
clicked on its behalf would hide exactly the omission that leaves keyboard users
stuck.

Enter in a single-line text field is the other thing a browser acts on. It
commits the field, with `change` if what was typed changed it, and then
submits the form the field belongs to, as implicit submission does: by
clicking the form's first submit button, so that button's own handler runs;
not at all when that button is disabled; and, in a form with no submit button,
by submitting it directly — unless it holds more than one text field. Enter in
a `<textarea>` submits nothing, since there it means a new line, and a
cancelled `keydown` stops all of it.

The key events go to the element you pass, whether or not it has focus. A
browser sends them to `document.activeElement`, so pass that when the
difference matters.

### Disabled controls

Two rules decide what reaches a disabled control, and both start from what the
platform does rather than from convenience.

**An `aria-disabled` control receives every event.** The attribute says nothing
to the browser; ignoring the press is the widget's own job. A helper that
refused to dispatch would make every "a disabled item does nothing" test pass
against a component that never checks — which is the bug those tests exist to
catch. Volt's primitives disable with `aria-disabled` almost everywhere, so a
disabled control stays reachable by keyboard, which makes this the common case.

**A control with the `disabled` attribute is sent the pointer events and
nothing else.** A browser withholds `mousedown`, `mouseup` and the click from
it, and dispatching them would test a sequence no user can produce. So `click`
sends `pointerdown` and `pointerup` alone — the press still takes focus to
whatever around the control can hold it, or off everything — and `press`
sends nothing, since a disabled control cannot have focus for a key to reach.
`hover` and `unhover` reach it as they reach anything else, which is how a
tooltip on a disabled `<button>` explains why it is disabled.

It is checked up the tree: a press on the `<span>` inside a disabled button is
a press on a disabled control. A `<fieldset disabled>` disables the form
controls inside it and nothing else — a link or a `<div role="button">` inside
one is as live as anywhere — and leaves alone the controls in its own first
`<legend>`, which is where the checkbox that enables the rest of it goes.
`typeText` and `clear` on a disabled or `readonly` field do nothing and say
nothing, which is also what a browser does. `focus` and `blur` check nothing;
they call `.focus()` and `.blur()` and leave the answer to the DOM.

### What they cannot do

- **Type anywhere but the end.** Text is appended; there is no caret model.
  `clear()` covers replacing what is there, and anything finer — typing into the
  middle of a value, a selection being overwritten — belongs in an end-to-end
  test with a real browser behind it.
- **Type into anything but a text field.** `typeText` and `clear` take a
  `<textarea>` or an `<input>` edited by typing, and throw on anything else,
  a `contenteditable` included. For a custom editor, dispatch the input events
  the component listens for directly.
- **Open a drop-down `<select>`.** Its options live in a popup of the
  browser's own, which nothing on the page can press, so a `click` on one
  changes nothing and no helper opens the list. Set the element's `value` and
  dispatch `input` and `change` yourself. A `<select multiple>`, or one with a
  `size` above one — the same test that makes it a `listbox` rather than a
  `combobox` — is drawn as a list, and its options are pressed like
  anything else: `click` chooses one — Ctrl or Cmd adds or removes it, and
  Shift chooses the run from the last one pressed — and the select sends
  `input` and `change`. A native checkbox or radio is fine too: `click` and
  Space both toggle it and send the `change` its `:model` listens for.
- **Type with `press`.** It sends key events and nothing else: a character key
  pressed on a field inserts nothing. That is `typeText`.
- **Move focus with Tab.** `press(el, 'Tab')` dispatches the key and moves
  nothing, because there is no Tab order here. A focus trap that handles Tab
  itself can be tested; the browser's own Tab behaviour cannot.

## Waiting

```ts
settle(): Promise<void>
```

Volt coalesces updates onto a microtask, so nothing a test does is visible until
the queues drain. [`flushSync()`](./reactivity#scheduling) from `@voltdev/core`
is enough when the work is synchronous. `settle()` is for the rest, where a
promise has to resolve before the writes it causes can be flushed at all — a
fetch landing, `onMount` running.

```ts
import { click, render, settle } from '@voltdev/testing';

const view = render(Profile);

click(view.getByRole('button', { name: 'Load' }));
expect(view.getByRole('status').textContent).toBe('Loading'); // the click flushed

await settle();
expect(view.getByRole('heading', { name: 'Ada Lovelace' })).toBeTruthy(); // the fetch landed
```

It is eight turns: each awaits a resolved promise and then flushes. The write
path for asynchronous work is `await`, then a signal write, then a flush, and
each link in a chain — a fetcher resolving, then its `then`, then a retry — costs
another turn; eight covers the chains Volt's own resources build. A chain deeper
than that is not waited for, and a second `settle()` is the fix. Work behind a
timer is never reached by any number of turns: that needs the clock advanced.

It is driven by microtasks rather than timers, so it works with a fake clock
installed.

## Fake timers

```ts
installClock(options?: ClockOptions): FakeClock

interface FakeClock {
  advance(ms: number): Promise<void>;
  runAll(): Promise<void>;
  now(): number;
  pending(): number;
  uninstall(): void;
}
```

`advance` and `runAll` return promises because they settle between timers, and
an un-awaited one leaves the test asserting while the timers are still running.

| Member | Description |
|---|---|
| `advance(ms)` | Run every timer due in the next `ms`, in time order, settling after each, then land on the target time |
| `runAll()` | Run every pending timer whatever its delay, and anything they schedule, until nothing but intervals is left |
| `now()` | The current fake time, as `Date.now()` reports it |
| `pending()` | How many timers are outstanding |
| `uninstall()` | Put the real timers back and discard any still pending. Safe to call twice |

| Option | Default |
|---|---|
| `now` | The real time at install, in epoch milliseconds. Pin it when a formatted date is asserted on |

```ts
import { installClock, render, typeText, type FakeClock } from '@voltdev/testing';

let clock: FakeClock | null = null;

afterEach(() => {
  clock?.uninstall();
  clock = null;
});

// inside it('searches once the typing stops', async () => { … })
clock = installClock({ now: 0 });
const view = render(Search);

typeText(view.getByRole('textbox', { name: 'Search' }), 'cat');
await clock.advance(199);
expect(view.queryAllByRole('listitem')).toHaveLength(0); // the debounce is holding it

await clock.advance(1); // debounce elapsed, fetch settled, DOM caught up
expect(view.getAllByRole('listitem')).toHaveLength(2);
```

### What it fakes, and what it leaves alone

It replaces `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`,
`requestAnimationFrame`, `cancelAnimationFrame`, `Date`, `Date.now` and
`performance.now`, and it never touches `queueMicrotask`, `Promise` or
`process.nextTick`.

`Date` is replaced so that `new Date()` and `Date()` read the fake clock, as
`Date.now()` does. Every other form of the constructor — a time, a string, a
set of parts — goes straight through, and what comes back is a real `Date`, a
subclass's included. The replacement answers to the name `Date` and takes
seven arguments, and a date names it as its `constructor`, so code that asks
what made a value gets `Date`.

What it cannot reach is `new` on the real constructor. A `Date` subclass that a
source module declares, or a reference to `Date` a module keeps, is taken when
the module loads — before the test body installs the clock — and `new` on it
reads real time. `now()` on either reads the fake clock, since `Date.now` is
replaced on the real constructor, so code that constructs its own dates that
way should take the time from `now()`: `new Stamp(Stamp.now())`.

A frame is a 16 ms timer, and the time its callback is
handed is the time `performance.now()` reads, as in a browser, so an animation
that measures its progress by one against the other sees them agree.

It replaces them when it is installed, so a timer set before
`installClock()` is a real one: `advance` never reaches it and `pending()` does
not count it. Install the clock before `render`.

This is the one part of the package that exists because of a bug rather than for
convenience. Volt coalesces every update onto a microtask, so a fake-timer
implementation that replaces the microtask queue — which is what "fake all
timers" means in most libraries — takes the scheduler's flush with it. Nothing
throws: `await tick()` never resolves, an effect nobody flushed by hand never
runs, and the test fails on an assertion about rendering while the cause is
three layers away. Leaving the microtask queue alone is a property of this
implementation rather than an option the caller has to remember.

`setImmediate` and `requestIdleCallback` are not replaced. The first is
Node's rather than a browser's, and runs for real; the DOM emulation does not
provide the second, so a component that calls it fails with or without a
clock.

### How it runs timers

`advance` cooperates with the scheduler rather than merely coexisting with it:
after every timer callback it runs [`settle()`](#waiting), the way a browser
reaches a microtask checkpoint at the end of every task. A component that
schedules a second timer from the first sees a settled tree in between, and a
timer that resolves a promise has the work that promise unblocks done before the
next timer runs — which is how a fetcher's follow-up request, scheduled from a
`.then`, still lands inside the window. Ties go to the timer scheduled first, as
in a browser. Two advances of 100 end at the same time as one of 200, even when
the last timer fired before the target.

**`runAll()` leaves intervals set.** An interval is never done, so "every
pending timer" cannot include running one to its end. While anything else is
pending, an interval runs each time it falls due, in order with the rest — a
poll ticking beneath a debounce — and once nothing but intervals is left,
`runAll()` stops, with them still set and still counted by `pending()`.

A loop that sets a new timer every time it runs is one the clock cannot see
the end of: a timeout that sets itself again, or a component that requests an
animation frame from every frame. After 100,000 timers in one call the clock
throws rather than hanging the test, and says which it was — a loop at no
delay, which holds time still, or one that lets time pass and never stops. An
`advance(ms)` long enough to run an interval more than 100,000 times throws
too, and asks for smaller steps. So does a `runAll()` whose intervals fall due
that many times before a timer set ahead of it comes due — a poll every 16 ms
beside a timeout half an hour off — and it says that the timer is only far
away, not a loop. A clock, a poller or an animation wants
`advance(ms)`, which stops at a time you chose.

**One clock at a time.** A second `installClock()` throws rather than splitting
the pending timers between two. That is why the example uninstalls in
`afterEach` and not at the end of the test: a test that fails before its own
`uninstall()` would otherwise leave every later test in the file on frozen time,
and the next `installClock()` throwing.

## Nothing left behind

```ts
liveEffectCount(): number
```

A component that forgets to release a listener, a timer or an effect looks
correct in a test suite: the assertions pass, the elements are gone from the
DOM, and the effect goes on observing a tree nobody can see. `render` returns a
handle rather than an element so that "unmounts cleanly" is something a test
asserts rather than something a README claims.

| Check | What a leak looks like |
|---|---|
| `view.leakedEffects()` | Non-zero after `view.unmount()`: an effect outlived its component |
| `clock.pending()` | Non-zero after unmount, with the clock installed before `render`: a timer was never cleared |
| `liveEffectCount()` | Different from a baseline taken before mounting |

Nothing here counts event listeners. One added to `window` or `document` and
never removed is invisible to all three, and has to be caught by what it goes
on doing.

`leakedEffects()` is a difference rather than a total, because effects the
suite created before the component are none of its business. It is
`liveEffectCount()` now minus `liveEffectCount()` when `render` was called, so
it is not the component's own effects so much as everything since: an effect
the test itself creates in between counts too, and one it disposes that existed
before takes one off. It counts an effect from the moment it is created, before
its first deferred run — an effect that never ran is still watched, and still a
leak if nothing disposes it. `liveEffectCount()` is the total, every effect the
scheduler is watching in the process, across all four of its
[lanes](./reactivity#effects) — so the effect a `createResource` starts its
fetch from counts, and so does a measurement a collapsible or the virtualizer
takes. Compare it with a baseline and never with zero.

```ts
import { installClock, render } from '@voltdev/testing';

const clock = installClock({ now: 0 });
try {
  const view = render(Ticker);

  view.unmount();
  expect(view.leakedEffects()).toBe(0);
  expect(clock.pending()).toBe(0); // read before uninstall, which discards them
} finally {
  clock.uninstall(); // or in afterEach, as above: a failed assertion must not leave it installed
}
```

## Harnesses

A harness is a semantic handle on a component, so a test says what a user did
rather than what the markup happens to be.

```ts
import { menuHarness } from '@voltdev/testing';

const menu = menuHarness({ name: 'Actions' });
menu.open();
menu.choose('Duplicate');
```

A consumer's test that reaches for `.volt-dialog-content` is bound to this
library's markup, and that binding is expensive in a direction nobody expects:
an accessibility fix that changes an element breaks downstream suites, so the
promise that such fixes ship centrally as a patch becomes false. Angular's CDK
ships component harnesses for the same reason, and this is the same answer.

**A harness finds its parts the way a screen reader would — by role, by
accessible name, by state — and never by class, tag or nesting.** That is the
whole discipline, and it is what lets a harness survive a change to the markup
it drives. It also means a harness cannot be written for a component whose
accessibility is wrong, which is a useful thing for a harness to be unable to
do: a tab that lost `aria-controls` fails at `tabs.panel()`, in the suite,
rather than at a screen reader, in production. Every part a harness finds by
query inherits the query layer's refusal to see what is hidden, so a closed
overlay's buttons are not found either. The parts it reaches through
`aria-controls` — a menu, a disclosure's panel, a tab's panel — are looked up by
id instead, and nobody asks whether the element found is hidden: a disclosure's
`panel()` is `null` unless the trigger says `aria-expanded="true"`, a menu's
items are still found by query, and a tab's `panel()` comes back whether or not
it can be seen.

"Never by nesting" means never by a particular arrangement of markup. A part
is still looked for inside the element that owns it — a tab inside its
tablist, a button inside its dialog — through the DOM; ownership declared with
`aria-owns` is not followed.

The harnesses are tested against the real [primitives](./primitives) rather than
against fixtures. A fixture is markup written to match the harness, and a
harness passing against one would prove the opposite of the claim. Every
method of every harness is exercised against a primitive there.

### Why there is no `getItemAt(n)`

Nothing in a harness reaches a part by position. `items()` returns the words on
every item, so `menu.items()[2]` is available; `menu.getItemAt(2)` is not. The
first reads as the test choosing to be brittle, in its own code where a reviewer
can see it. The second reads as the library offering it — and the day an item is
added above the third, every suite that took the offer is pressing the wrong one
without failing.

Every harness action takes the words a user would read — `choose('Duplicate')`,
`select('Billing')` — for the same reason, and the lists a harness reads back —
`items()`, `tabs()`, `options()`, `selected()` — are words rather than elements.

### Options

```ts
disclosureHarness(options?: HarnessOptions): DisclosureHarness
dialogHarness(options?: HarnessOptions): DialogHarness
dialogIsOpen(options?: HarnessOptions): boolean
menuHarness(options?: HarnessOptions): MenuHarness
tabsHarness(options?: HarnessOptions): TabsHarness
listboxHarness(options?: HarnessOptions): ListboxHarness

interface HarnessOptions {
  within?: ParentNode;     // default: document.body
  name?: string | RegExp;
}
```

The five interfaces are exported, for a helper of your own that takes a
harness. Every method that takes a `name` accepts a `string` or a `RegExp`.

`within` scopes the search for the part the harness is built around — the
trigger, the dialog, the tablist, the listbox — because a page may hold two of
anything; `name` tells those two apart by accessible name. It does not scope
what is reached through `aria-controls`, which is looked up by id in the whole
document, as a portalled part has to be. Without a `name`, the scope must hold
exactly one candidate — `menuHarness()` on a page with two buttons throws,
because the trigger is found as a button. A harness that finds nothing throws
and says which part it was looking for, rather than failing later on a `null`.

The harness is built when you call it, so call it once the part exists. It
holds on to that part — `trigger`, `host`, `list` — from then on, so a dialog
that closes and opens again as a new element needs a new harness. The
readings (`isOpen()`, `items()`, `selected()`) are asked afresh each time.

### `disclosureHarness`

| Member | Description |
|---|---|
| `trigger` | The control that opens it |
| `isExpanded()` | Whether the trigger's `aria-expanded` is `true` |
| `expand()` / `collapse()` | Click the trigger, unless it is already in that state |
| `toggle()` | Click the trigger |
| `panel()` | The region the trigger controls, or `null` while it is closed |

The panel is reached through the trigger's `aria-controls`, and only while
`aria-expanded` is `true` — which is the only way a screen reader knows the two
are related, so a `panel()` that comes back is evidence the relationship
exists. A panel kept mounted while it animates closed is `null` here: a user
cannot reach it, and a test asserting on its content would pass on a closed
accordion. An accordion is several disclosures, one harness per section by
name.

The trigger is a button that carries `aria-expanded`, whatever its value. A
plain button with the same words is passed over — nothing about it says it
opens anything, and accepted as a trigger it would report itself collapsed
however often it was clicked — so the harness finds the real trigger beside
one. When there is only the plain one it throws, and says that it found the
button and what the button lacks, rather than reporting a trigger that is not
there.

### `dialogHarness` and `dialogIsOpen`

| Member | Description |
|---|---|
| `host` | The element with role `dialog` or `alertdialog` |
| `title()` | Its accessible name — what a screen reader announces on open |
| `press(name)` | Click the one button inside it with these words. Throws on none or several |
| `dismiss()` | Press Escape on `host`, which every dialog must answer |

`dialogIsOpen(options?)` answers whether a dialog is in the accessibility tree
at all, for the assertion after a close, where `dialogHarness` would throw.

Both look for the two roles together. `dialogHarness` throws when more than
one dialog of either role matches — a confirmation over a form's dialog, say —
rather than handing back whichever it happened to look for first and letting
a test press a button in the wrong one; pass a `name`. `dialogIsOpen` answers
`true` for two, since nothing is being acted on. A modal from
[`createDialog`](./primitives-overlays) — modal is its default — hides every
other top-level element of the page when it opens, so a dialog portalled
separately behind it is out of the tree; one whose markup contains it is not.

```ts
import { dialogHarness, dialogIsOpen } from '@voltdev/testing';

const dialog = dialogHarness({ name: 'Delete project' });
expect(dialog.title()).toBe('Delete project');

dialog.press('Cancel');
expect(dialogIsOpen({ name: 'Delete project' })).toBe(false);
```

### `menuHarness`

| Member | Description |
|---|---|
| `trigger` | The button that opens the menu |
| `isOpen()` | The trigger says `aria-expanded="true"` and a menu is found |
| `open()` | Click the trigger, unless the menu is open |
| `close()` | Press Escape on the menu, if it is open |
| `items()` | The words on every `menuitem`, `menuitemcheckbox` and `menuitemradio`, in document order; `[]` when no menu is found |
| `choose(name)` | Click the one item with these words. Throws on none or several |

A menu is usually portalled, so it is looked for through the trigger's
`aria-controls` rather than under the trigger. When that does not resolve —
`aria-controls` is optional on a menu button, and
[`createMenu`](./primitives-overlays) sets it only while the menu is open — the
harness takes the one `menu` in the document, but only while its own trigger
says `aria-expanded="true"`. A closed trigger has no menu, so on a page with
two menus the harness for the closed one reads `[]` and `choose()` throws,
rather than reading and pressing the open one's items.

`choose` takes a name by the same rule as a query: a string must match the
whole name after whitespace is collapsed on both sides, and a `RegExp` is
searched for in it.

### `tabsHarness`

| Member | Description |
|---|---|
| `list` | The tablist |
| `tabs()` | The words on every tab, in order |
| `selected()` | The words on the first tab with `aria-selected="true"`. Throws when none is |
| `select(name)` | Click the one tab with these words. Throws on none or several |
| `panel()` | The panel the selected tab controls, through `aria-controls` |

`panel()` throws when the selected tab controls nothing. A tab whose panel a
screen-reader user cannot reach from it is a broken tab, so this is an assertion
as much as a lookup. It is an assertion that the relationship exists, not that
the panel is visible: the element comes back even when it is `hidden`. When
that is the question, query inside it.

### `listboxHarness`

| Member | Description |
|---|---|
| `host` | The listbox |
| `options()` | The words on every option |
| `selected()` | The words on every selected option; several when it is multi-select |
| `select(name)` | Click the one option with these words. Throws on none or several |
| `isMultiple()` | Whether it says `aria-multiselectable="true"`, or is a native `<select multiple>` |

A native `<select multiple>`, or one with a `size` above one, is a listbox too,
and it is read the way the queries read it: `selected()` takes an `<option>`'s
own selectedness where there is no `aria-selected`, and `select(name)` presses
the option as a user does, which chooses it.

### What there is a harness for

Those five. There is none for a combobox, a select, a grid, a tree, a date
picker, a popover or a toast; test them through the queries, by role and name,
until there is.
Running the same harnesses from Playwright against a real browser is planned
and not built.

## Role and name

The functions the queries and harnesses are built on, exported for assertions
and for a harness of your own.

```ts
getRole(element: Element): string | null
getAccessibleName(element: Element): string
isAccessibilityHidden(element: Element): boolean
isTextField(element: Element): boolean
normalizeText(text: string): string
```

| Function | Returns |
|---|---|
| `getRole(element)` | The first token of `role`, or the role the tag carries on its own; `null` for neither |
| `getAccessibleName(element)` | The name assistive technology would announce, whitespace collapsed |
| `isAccessibilityHidden(element)` | Whether the accessibility tree leaves this element out |
| `isTextField(element)` | Whether `typeText` and `clear` accept it: a `<textarea>`, or an `<input>` of a type edited by typing. By tag and type alone — a disabled or `readonly` field still says `true` |
| `normalizeText(text)` | `text` with runs of whitespace collapsed and trimmed |

The usual reason to call them directly is an element you did not find by query —
where focus landed, say, which a test should still describe by role and name
rather than by id:

```ts
import { click, dialogHarness, getAccessibleName, getRole, render } from '@voltdev/testing';

const view = render(SettingsPage);
click(view.getByRole('button', { name: 'Open settings' }));
dialogHarness({ name: 'Settings' }).dismiss();

// Focus went back to the control that opened the dialog.
const focused = document.activeElement!;
expect(getRole(focused)).toBe('button');
expect(getAccessibleName(focused)).toBe('Open settings');
```

### Roles

The implicit roles follow the host language where the answer depends on more
than the tag. An `<a>` without `href` is `generic`, because it is not a link and
a test that found one anyway would hide the reason keyboard users cannot reach
it. An `<img alt="">` is `presentation`. A `<section>` is a `region` only once
it is named, by `aria-label`, `aria-labelledby` or `title`. A `<header>` is a
`banner`, and a `<footer>` a `contentinfo`, only outside `<article>`,
`<aside>`, `<main>`, `<nav>` and `<section>`. A `<select>` is a `listbox` when
it is `multiple` or has a `size` above one, and a `combobox` otherwise. An
`<input>` of type `text`, `email`, `tel`, `url` or `search` becomes a
`combobox` when it has a `list`. A `<th>` is a `rowheader` with `scope="row"`
and a `columnheader` otherwise.

An `<input>` has the role a browser exposes it with. A `password` field is a
`textbox`, and a `file` input the `button` that opens the chooser. A `color`
input and the date and time types — `date`, `time`, `datetime-local`, `month`
and `week` — are widgets ARIA has no role for, so they have none here, and no
role query finds one; reach one through `container`. An
`<input type="hidden">` has no role either, and a type the host language does
not know is a `textbox`, as the field itself falls back to a text field —
`isTextField` agrees, and `typeText` types into one.

### Names

`getAccessibleName` is the accessible name computation as far as an
application's own markup exercises it: `aria-labelledby`, then `aria-label`,
then the host language's own labelling (a `<label>`, an `alt`, a `<legend>`, a
`<caption>`, a `<figcaption>`), then name from content where the role allows
it, then `title`, and `placeholder` last. A target of `aria-labelledby` is read
even when it is hidden, since pointing at a `hidden` span is a documented way to
name a control, and a reference cycle is stopped rather than followed round.

Name from content is limited to the roles that allow it — a button, a link, a
tab, an option, a heading, a cell and the like. `<button>Save</button>` is
"Save"; `<div role="region">Save</div>` has no name, because a landmark that
took its name from whatever it contained would answer to its first paragraph.

Two parts of the specification are left out on purpose. CSS-generated content is
not read, because the DOM emulation does not lay anything out. And a control
inside a `<label>` does not contribute its value — `<label>Age <input
value="41"></label>` is named "Age" here rather than "Age 41" — because a test
asking for the field called "Age" should keep finding it after someone types.

### Hidden

`isAccessibilityHidden` asks every ancestor about `aria-hidden="true"`,
`hidden`, `inert` and `display: none`, because that is where they are usually
set: a closed popover hides its whole subtree from one node, a modal makes the
page behind it inert from the top, and `display` does not inherit.
`visibility` is read from the element alone. It does inherit, so the computed
value already accounts for every ancestor, and a descendant may set
`visibility: visible` and come back, shown and announced — walking up for it
would hide exactly that element.

## What is not here

- **Playwright fixtures and axe assertions.** Both are on the roadmap and
  neither is built. Both want a real browser rather than a DOM emulation, and
  everything in this package runs under one.
- **Layout.** Nothing is laid out under the emulation, so geometry, anything a
  measure effect reads, and CSS-generated content are out of reach.
- **The browser's own keyboard behaviour.** No caret, no Tab order, and no
  drop-down `<select>` to open — see
  [what they cannot do](#what-they-cannot-do).
- **Queries by test id, class or tag.** Not a gap. `container` is there for the
  cases that are genuinely about markup.
