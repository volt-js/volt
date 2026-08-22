# Design decisions

Notes on why Volt is shaped the way it is, including the trade-offs.

## Everything dynamic starts with `:`

Vue uses three sigils: `v-` for directives, `:` for bindings, `@` for events.
Volt uses one and resolves the meaning from the name.

The cost is that resolution has to be defined precisely, because `:click` and
`:value` look identical but do different things. The order is fixed:
structural directives, then explicit escapes (`:on-*`, `:prop-*`, `:attr-*`),
then `:class`/`:style`, then known DOM event names, then property bindings.

The escapes exist so the ambiguous cases are always expressible. A component
output is `:on-changed`, never a bare `:changed` — because `changed` is not a
DOM event and would otherwise be read as a property.

## Reactivity is the TC39 proposal, not an interpretation of it

Volt could have shipped a smaller, more ergonomic signal API — callable
signals, `count()` instead of `count.get()`. It ships the standard instead.

The benefit is that what you learn transfers, the semantics are specified
rather than invented, and code is portable to any other implementation. The
cost is verbosity: `count.get()` in every template expression.

That verbosity is deliberate. Templates read signals exactly the way your
methods do, so an expression behaves identically whether it sits in a
template or a method body — no hidden auto-unwrapping to reason about.

## No dependency injection

Angular's DI is the piece Volt deliberately leaves out. Sharing state through
a module import is simpler, statically analysable, and needs no container,
tokens, or lifetime rules:

```ts
export const user = new Signal.State<User | null>(null);
```

Because signals track precisely, only components that actually read `user`
update when it changes. There is no provider to re-render, which removes most
of the reason frameworks need DI for state.

Scoped context exists for the cases where a value genuinely belongs to a
subtree, but it is scope lookup, not injection.

## Standard decorators only

Legacy decorators need `experimentalDecorators`, and parameter decorators
need `reflect-metadata`. Both are on the way out. Volt supports only the
stage-3 standard.

The practical cost is real: **no engine implements standard decorators yet**,
and Vite 8's oxc transformer parses but does not lower them. TypeScript 7 is
the native Go port and exposes no JavaScript transform API. So the Vite
plugin does the lowering with esbuild, and is not optional.

`Symbol.metadata` is likewise absent from every current engine; Volt installs
it before any decorated class is evaluated.

## Updates are asynchronous

Writes coalesce onto a microtask, so a burst of `.set()` calls repaints once.

This follows from the proposal's design: a `Watcher`'s notify callback fires
synchronously during `.set()`, but reading or writing signals inside it is
forbidden — the graph is mid-colouring. Flushing therefore has to be
scheduled.

`flushSync()` and `await tick()` exist for tests and measurement.

## No virtual DOM, and no component re-render

The component class runs once. This is the constraint everything else is
built around, and it is why the compiler matters so much: with no diff to
fall back on, the compiler has to know exactly which nodes each expression
can affect.

The trade-off is that Volt cannot support patterns that assume re-execution.
There is no equivalent of calling a component function again to get a fresh
tree. State lives in signals, and the DOM follows from them.

## `:for` requires `:key`

Every framework has to decide what a row's identity is when no key is given,
and both obvious answers are traps. Keying by **position** is cheap but wrong
on reorder: the text updates correctly while focus, input values and
animations stay behind on the wrong row. Keying by **object identity** is
correct on reorder but rebuilds the whole list when data is refetched as
equal-but-new objects.

Vue, Svelte and React all default to position, and all three have a lint rule
or a console warning trying to undo that default. Angular 17 concluded there
was no safe default and made `track` mandatory. Solid removed the choice by
keying `<For>` on identity always, with `<Index>` as the separate positional
primitive.

Volt follows Angular: no default, and a compile error naming both remedies.
Volt's compiler already reads every template at build time, so the check
costs nothing and fires before the code runs — which is the whole reason to
have a compiler.

## Keyed rows are updated, not rebuilt

A `:for` row whose key survives is never re-created — its item and index
signals are updated in place. That is what makes reordering move existing
elements.

It also means a destructuring binding has to become per-field accessors
rather than a snapshot, so `{ id, text }` stays reactive. The compiler
generates those accessors; you write ordinary destructuring.

## Bubbling events are delegated

A handler per element is the obvious implementation and the wrong one at
scale: ten thousand rows with two handlers each means twenty thousand
listeners to register on create and unregister on remove.

Volt installs one listener per event type on the document and walks up from
the target, storing each handler on its node. Creating and destroying rows
becomes a property assignment rather than a registry mutation.

The cost is that the synthetic walk has to reproduce what the real capture
and bubble phases would have done. `currentTarget` is null during a
document-level dispatch, so Volt sets it to the node whose handler is
running; `stopPropagation` is intercepted so it ends the walk rather than
only the native phase. Events that do not bubble, and any handler needing
`.capture`, `.once` or `.passive`, get a real listener instead — delegation
cannot express those.

Two more classes are excluded, and neither is a preference. Browsers force a
`wheel` or touch listener registered on the document to be passive, so a
delegated `preventDefault()` is discarded and `:wheel.prevent` would compile
to a handler that prevents nothing. And the events that fire continuously —
`pointermove`, `dragover`, and the hover pair — invert the trade delegation
is made for: a drag has one handler and fires hundreds of times a second, so
every walk to the document is paid and none of it is saved.

## Markers only where they are needed

Dynamic content needs an anchor so the runtime knows where to insert. A naive
implementation puts a comment marker at every hole, which shows up in the
DOM and costs a node each.

Volt avoids them in the common cases: an element whose children are all text
compiles to one text binding with no marker, and a block whose only root is
dynamic returns the accessor directly rather than wrapping it. Markers remain
only where structure genuinely requires one.

## Compared with other frameworks

What Volt took from each, and what it declined.

| | taken | declined |
|---|---|---|
| Vue | HTML templates, the ergonomics | the virtual DOM |
| Svelte | compiler-first: do it at build time or not at all | its own reactivity syntax |
| Solid | fine-grained reactivity, no component re-render | a bespoke signal implementation |
| Angular | classes, decorators, opinionated structure | dependency injection |
| Astro | islands | a separate authoring model for them |
| Qwik | lazy execution | resumability |
| TanStack | resource primitives | — (a shared query cache is planned) |
| Tailwind | design tokens | utility classes as the styling model |
| React | the component model as an idea | hooks, and the re-render that requires them |

## No proxies

A property is reactive because it holds a signal, never because something
wrapped it. That is why `@Prop() accessor` was removed, and why there is no
reactive object.

A proxy makes `obj.count++` work, at the cost of never being able to tell by
reading the code whether a property access is tracked. It also cannot see
`Map`, `Set`, class instances or anything crossing a serialization boundary
without a second implementation for each. The trade is one line of ceremony —
`.get()` — against knowing what your code does.

## No resumability

Qwik serializes the reactive graph into the HTML so the client never replays
setup. It is a real answer to a real cost in frameworks that hydrate by
re-rendering.

Volt does not hydrate by re-rendering. Codegen resolves every dynamic node by
a `firstChild`/`nextSibling` path computed at build time, so hydration is an
attach, not a reconstruction — the thing resumability avoids is already
cheap here. Buying it anyway would cost a serialization format for every
closure in the application.

## The compiler is TypeScript, not Rust

Compiling a real template takes **0.124ms**, so a thousand-component
application spends about **124ms** compiling templates — inside a build
measured in seconds. A Rust rewrite would optimise that away in exchange for
per-platform native binaries, a much higher barrier to contributing, and a
second toolchain in a project that deliberately has one.

It would also miss the part that will actually be slow. Once templates are
type-checked, the cost is TypeScript's type system, and no amount of Rust in
the parser touches that.

## No `:show`

Hiding an element is a style binding. `:class` and `:style` already express
it, and CSS is where "hidden but still in the DOM" belongs — including for a
component library, where content must stay mounted to animate out or to keep
its state.

## Animation is CSS

SwiftUI and Compose treat a transition as a value described beside the state
that drives it. It reads well. But CSS already owns transitions and
animations, runs them off the main thread, and honours
`prefers-reduced-motion` without being asked.

Volt's `createPresence` exists precisely so CSS can stay in charge: it holds a
node in the DOM until the exit animation the stylesheet declared has finished,
and asks the element whether anything is animating rather than being told a
duration. A JavaScript animation layer would duplicate all of that and lose
the off-main-thread part.

## Performance is not a setting

There is no `virtualize: false`, no `memo`, no `trackBy`, no
`shouldComponentUpdate`, no "optimization" section in any component's options.
A knob that makes an application slower is a bug with a name, and a knob that
makes it faster is a default someone forgot to set.

You choose the data and the markup. The framework chooses how to render it.

### Why that is not the same as "always virtualize"

Below roughly fifty rows, virtualization costs more than it saves: a scroll
container, a spacer, a transformed window and a `ResizeObserver`, to avoid
creating forty elements the browser would have made in under a millisecond. A
grid that virtualizes unconditionally is slower on every small grid, and small
grids are most grids.

So the rule is not one strategy always on. It is that the strategy is never
yours to pick:

| collection | what happens |
| --- | --- |
| small | render all of it; anything else is overhead |
| medium | `content-visibility: auto` with `contain-intrinsic-size` — the browser skips layout and paint for offscreen rows, at zero JavaScript cost |
| large | pool-keyed virtualization, recycling rows through a fixed window |

The threshold is the framework's business and may move as it is measured. What
does not move is that there is no option to get it wrong.

### The escapes are the framework's problem, not yours

Virtualization silently breaks things people expect to work, and every library
that ships it leaves them broken. They are correctness, not preference, so
they are handled rather than documented:

- **Printing.** A virtualized grid prints one screenful. Volt renders the full
  collection on `beforeprint` and restores the window afterwards.
- **Find in page.** `Ctrl+F` cannot match a row that is not in the DOM, which
  makes the browser's own find quietly wrong on any virtualized list anywhere.
  The grid ships a find that searches the data and scrolls the match into
  view.
- **Select all and copy.** Operates on the collection, not on the rows that
  happen to be mounted.
- **Assistive technology.** `aria-setsize` and `aria-posinset` are computed
  from the collection, so "row 4,312 of 100,000" is true even though 4,311 of
  them were never rendered.

A performance technique that breaks the page is not a performance technique.

## Components are classes, not functions

The functional model asks a function to be re-entered to produce a view, which
is why it then needs rules about where state may be declared, and memoization
to stop the work it just created. Volt's components are constructed once and
never re-run, so a field is simply a field and there is nothing to memoize.

The usual argument for functions is that they avoid lifecycle ceremony. That
is worth having, and Volt gets it a different way: there is no `render`, no
`updated`, no `beforeUnmount`. A class body runs once, effects clean up with
their scope, and `onMount` exists for the one thing that genuinely cannot be
known before the DOM exists.

## Custom elements are an interoperability target, not the output

Compiling components to custom elements is appealing because the result runs
anywhere. The costs are paid by every component: styles land on the wrong side
of a shadow boundary or leak, `<form>` participation needs explicit opt-in,
and server rendering means declarative shadow DOM with a different set of
hydration problems.

Volt renders to the DOM directly and treats custom elements as something to
consume. A hyphenated tag that is not a Volt component and *has* been defined
with `customElements.define` renders as the element it is, which is what
interoperability actually requires.

## The web, and nothing else

A single component model targeting web, iOS, Android and desktop is a
different product with a different renderer, not a later phase of this one.
Frameworks that have tried it either abandon platform conventions or spend
most of their effort reconciling four sets of them.

Volt's leverage comes from compiling against one platform closely: build-time
DOM paths, delegated events, CSS-owned animation, `Intl` for every locale
question. None of that survives an abstraction layer over four renderers.

## Effects are scheduled, not abolished

Wishlists for a "next-generation" framework usually ask for no `useEffect` and,
a few lines later, for a resource primitive that cancels stale requests. Those
are the same thing. A resource *is* an effect, and a framework that claims to
have removed effects has only moved where they run.

Volt says the honest version: effects exist, they are scheduled in lanes, and
which lane something is in is a decision with consequences. The server
rendering design turned on exactly this — `createResource` starts its first
fetch from a deferred effect, so "no effects on the server" and "the server
awaits data" cannot both be true, and a third lane is the fix. Pretending the
category is gone would have hidden that until it was expensive.

## Failure is routed, not swallowed — but not typed into every signature

Effect models a computation as `Effect<Success, Error, Requirements>`, so a
failure is a value the compiler tracks rather than something thrown past
everyone. It is the best argument in TypeScript for the position Volt already
takes elsewhere: the compiler should refuse the wrong thing rather than
document it. `:for` without `:key` is a build error; a misspelled directive is
a build error; an interactive listener on an element that cannot take one is a
build error.

Volt takes the principle and stops short of the mechanism.

**Taken.** An error inside an effect used to be caught and handed to
`console.error`, which meant a throwing binding left the interface half
updated with a message nobody reads in production. That is swallowing, and it
is the thing Effect is right about. Errors have a channel now: they travel up
the scope chain to the nearest boundary, that boundary decides whether to
swallow, replace the subtree or send the error further up, and an application
can observe every one — with the component, its props and the scope that
produced it attached — through `setErrorReporter`.

**Declined: the third type parameter.** Requirements-as-a-type is dependency
injection with a compiler behind it, and Volt has already declined dependency
injection — a module-scope signal is simpler, statically analysable, and needs
no container. Adding an `R` channel would reintroduce it wearing a type.

**Declined: the error channel in every signature.** Threading `Effect<A, E>`
through a UI framework is all-or-nothing in practice: once a data layer returns
one, every caller does. Volt is a rendering framework that an application uses
alongside whatever it likes, and a framework that dictates the shape of every
function in a codebase is not that.

**Declined: fibers.** Volt's scheduler is a two-phase synchronous flush with a
measure lane. Its whole value is that a flush is a bounded, inspectable thing
that finishes. Interruptible green threads are a different bargain, and a good
one, for a different kind of program.

The useful summary: Effect is a plausible thing to use *with* Volt, not against
it. Being a good citizen beside it — not fighting its cancellation, not
demanding a competing container — is worth more than matching its features.

## A flush has phases, and that was arrived at twice

Volt's scheduler drains render effects, then measure callbacks that may only
read, then user effects. The reason is that geometry read from an ordinary
effect forces a layout over everything just written, so a page with twenty
measuring components pays twenty write-then-layout cycles instead of one.

Solid 2 splits effects into compute and apply phases, which is the same
conclusion reached independently. That is worth recording because it is the
only kind of evidence available for a decision like this one: two projects with
the same architecture — fine-grained reactivity, no virtual DOM, a synchronous
flush — arriving separately at the same shape means the phase split follows
from the architecture rather than from anyone's taste.

It also sets the standard for the split's own honesty. Volt's version shipped
with a metric that counted the opposite of what it documented and with no
component using it; both are fixed, and the lesson stands beside the decision:
a phase that nothing measures in is a phase that does nothing.


## Async lives in a lane, not in the graph

Solid 2 makes its reactive graph promise-aware: a computed may be pending, a
component may return a promise, and `createResource` dissolves into an ordinary
memo. It is the more elegant answer, and Volt is not taking it. The reasoning
matters more than the verdict, because the verdict should be revisited if the
reasoning changes.

**Volt's reactivity is the TC39 proposal, not an interpretation of it.**
`graph.ts` says so in its first line, and it is the constraint that decides
this. The proposal's `Computed` has two outcomes: it returns a value or it
throws the error it stored. There is no third. A promise-aware graph needs one
— a node that is neither yet — and there are only three ways to add it. Return
a sentinel, and every `get()` in every consumer has to test for it. Throw a
promise, as React does, and `get()` starts throwing something that is not an
error while the graph's colours are left half-propagated by the unwind. Or add
a fourth node state and the API to observe it, which is a fork of the standard
Volt has committed to implementing.

Solid does not pay that price, because its reactivity is its own and it may
extend it. That asymmetry is the whole of the difference, and it is not a
judgement about which design is better in the abstract.

**Glitch-freedom is defined over synchronous evaluation, and async removes the
premise rather than complicating it.** A CHECK node consults its sources'
versions before recomputing, which is what makes a diamond evaluate once and
never observe a half-updated graph. That argument works because evaluation is
total: by the time anything is read, every source has a settled version. Two
async computeds settling at different moments can be observed in a combination
that no synchronous ordering would have produced, and no version check can
detect it — the versions are all current, they were just current at different
times. Keeping the guarantee under async means a consistent snapshot across
time, which is a substantially larger idea than the one the proposal specifies.

**The flush would have to become async, and that costs the guarantee it is
built on.** `flushSync` loops over four lanes and starts again from the top
until nothing is dirty, and it refuses to run at all inside an open batch, so
nothing can observe a half-applied group. A continuation resuming inside that
loop would either re-enter a phase that has already drained, or make the loop
itself async — at which point a bare `.set()` becomes observable mid-update by
anything that runs in between. The measure lane makes this concrete rather than
theoretical: it exists precisely to guarantee that every write has landed before
any geometry is read, and an await between them is exactly the interleaving it
was built to prevent.

**And it is paid for by clients that never await anything.** A fourth state is
a test on the hot path of every read and every propagation, in a graph whose
whole case is that it is small and fast.

So the `dataEffect` lane stays: a third lane that a handful of primitives know
about, rather than a concept every signal carries. The contradiction it resolves
is real — a resource's first fetch runs from a deferred user effect, so "no
effects run on the server" and "the server awaits its data" cannot both be true
without it — and the lane resolves it where the problem is, in scheduling,
instead of in the type of every value in the system.

**What would change this.** If TC39 adds an async or pending notion to the
proposal, the constraint above disappears and this should be reopened
immediately — it is the only argument here that is about Volt's commitments
rather than about the shape of the problem. Streaming SSR is the feature that
would encode this decision deepest, and it is being built after it rather than
before, which is the whole reason the decision was made now.
