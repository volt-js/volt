# Reactivity API

Volt's reactive core implements the
[TC39 Signals proposal](https://github.com/tc39/proposal-signals). Everything
under `Signal` matches the proposal; everything else is Volt's layer on top.

`Signal` is a namespace, which compiles to a runtime object that a bundler
cannot take apart. There is a second, flat spelling of every member below —
`@voltdev/core/signals` and `@voltdev/reactivity/signals` — holding the same
bindings, not copies. It exists so that [the Vite plugin](./vite-plugin) can
rewrite `Signal.State` to it and drop everything the app never reaches. Write
`Signal.State`; the build does the other spelling for you.

## `Signal.State`

```ts
new Signal.State<T>(initial: T, options?: SignalOptions<T>)
```

| Member | Description |
|---|---|
| `get(): T` | Read, subscribing the enclosing computed or effect |
| `set(value: T): void` | Write. Ignored when the value compares equal |

```ts
const count = new Signal.State(0);
count.set(1);
count.get(); // 1
```

## `Signal.Computed`

```ts
new Signal.Computed<T>(fn: () => T, options?: SignalOptions<T>)
```

| Member | Description |
|---|---|
| `get(): T` | Evaluate if needed, then return the cached value |

Lazy — it runs when read, not when a dependency changes. Memoised — it
re-runs only when a dependency's value actually changed. Errors are cached
exactly like values and rethrown on each read until inputs change.

A computed may not write to a signal, and may not read itself; both throw.

## `SignalOptions`

```ts
interface SignalOptions<T> {
  equals?: (a: T, b: T) => boolean;             // default: Object.is
  [Signal.subtle.watched]?: () => void;
  [Signal.subtle.unwatched]?: () => void;
}
```

`watched` fires when the signal becomes reachable from a `Watcher`;
`unwatched` when it stops being reachable. Use them to attach and release
external resources.

## `Signal.subtle`

Lower-level operations. `subtle` marks APIs that expose graph internals or
bypass tracking.

| Member | Description |
|---|---|
| `untrack(cb)` | Run `cb` without subscribing to what it reads |
| `currentComputed()` | The computed currently evaluating, or `null` |
| `introspectSources(node)` | What a computed or watcher reads |
| `introspectSinks(node)` | What reads a signal |
| `hasSinks(node)` / `hasSources(node)` | Connectivity checks |
| `Watcher` | Low-level change notification |
| `watched` / `unwatched` | Option symbols |

### `Signal.subtle.Watcher`

```ts
const w = new Signal.subtle.Watcher(() => { /* schedule work */ });
w.watch(someComputed);
w.getPending();  // watched signals that are out of date
w.watch();       // re-arm after draining
w.unwatch(someComputed);
```

The notify callback fires **synchronously during `.set()`**, after the graph
is coloured. Reading or writing signals inside it is forbidden — schedule
instead. It fires at most once until re-armed with `watch()`.

## Effects

| Function | Description |
|---|---|
| `effect(fn)` | Runs immediately, re-runs on change, after the DOM settles |
| `renderEffect(fn)` | Same, but flushes before user effects. For DOM patching |
| `dataEffect(fn)` | Asks for data. Deferred like `effect`, drained before measure |
| `measureEffect(fn)` | Reads geometry after that, on a settled DOM |

All four return a disposer. Returning a function from `fn` registers a
cleanup that runs before the next execution and on disposal.

A flush runs them in phase order: render effects patch the DOM to a fixed
point, data effects ask for what the tree needs, measure effects read, then
user effects run. Reading geometry — `getBoundingClientRect`, `offsetWidth`,
`scrollTop` — forces the engine to lay out everything written since the last
frame, so a read from an `effect` costs one layout per component that positions
a popover, syncs a scroller or measures overflow. Reading from `measureEffect`
puts every read in the flush behind a single layout.

The measure phase is read-only. Publish what you measured by setting a signal;
the render effect that consumes it patches on the next pass, still ahead of
user effects. In development, a DOM write made during the measure phase is
reported to the console.

`dataEffect` is the phase `createResource` starts its fetch from, and the only
one besides render that a server flush drains — see
[server rendering](./server). Its first run is deferred, like `effect`'s, so a
resource declared as a class field sees the props assigned after construction;
but it drains before measure, so the signal a fetch writes as it starts sends
the flush back through the render phase without dirtying a layout that has
already been paid for.

```ts
const stop = effect(() => {
  const id = setInterval(tick, delay.get());
  return () => clearInterval(id);
});
```

A server drains render and data effects and nothing else, so an `effect` or a
`measureEffect` in a server render is declared and never runs. In development,
`serverSkippedEffects()` lists the ones a request skipped and where they were
registered — see [what a server does not run](./server#what-a-server-does-not-run).

## Scheduling

| Function | Description |
|---|---|
| `flushSync()` | Drain pending effects now |
| `tick()` | Promise resolving once the DOM reflects all pending changes |
| `batch(fn)` | Group writes so nothing flushes until `fn` returns |
| `getFlushMetrics()` | Flushes run, and what the last one cost |
| `resetFlushMetrics()` | Zero those counters |

`getFlushMetrics()` returns a copy of five counters, not the live object:

| Field | Counts |
|---|---|
| `flushes` | Flushes that ran at least one effect, since the last reset |
| `forcedLayouts` | Measure drains in the last flush that followed a write |
| `peakForcedLayouts` | The worst any single flush has cost since the reset |
| `strayReads` | Geometry read outside the measure lane, in the last flush |
| `peakStrayReads` | The worst any single flush has read since the reset |

The two are opposite measurements and a test needs both. `forcedLayouts` is
what the lane costs when it is used — one per flush is the healthy number —
and it is counted from the phase transitions, so it is an upper bound and
costs nothing to keep in a production build. It cannot see the failure the
lane exists to prevent: a component that reads geometry from `effect` or
`renderEffect` never enters a measure drain at all, so measuring entirely from
the wrong phase drives `forcedLayouts` to **zero**, not up. A test asserting
`forcedLayouts` alone passes for a codebase that has never used the lane.

`strayReads` is that failure, counted directly by wrapping the accessors that
force layout. It is a development number: a production build installs no
wrappers and it stays at zero there. Assert on both.

```ts
resetFlushMetrics();
label.set('a considerably longer label');
flushSync();

const { forcedLayouts, strayReads } = getFlushMetrics();
expect(forcedLayouts).toBe(1); // the write and every read shared one layout
expect(strayReads).toBe(0);    // and nothing measured from the wrong phase
```

Updates coalesce onto a microtask by default.

## Scopes

| Function | Description |
|---|---|
| `createRoot(fn)` | Run `fn` in a fresh scope; receives a disposer |
| `onCleanup(fn)` | Register a cleanup on the current scope |
| `getScope()` | The current scope, or `null` |
| `runWithScope(scope, fn)` | Run `fn` with `scope` current |
| `createScope(parent?)` | A scope under the current one, disposed with it |
| `disposeScope(scope)` | Dispose a scope and everything it owns |

Disposing a scope disposes its child scopes, stops its effects, and runs
cleanups newest-first.

## Errors

| Function | Description |
|---|---|
| `onError(handler)` | Make the current scope a boundary |
| `raiseError(error, scope)` | Put an error into the channel from outside an effect |
| `setErrorReporter(fn \| null)` | Hear about every error, handled or not |

An error thrown inside an effect travels up the scope chain to the nearest
scope that called `onError`. The handler is given the error and the scope that
produced it, and decides what happens next:

```ts
createRoot(() => {
  onError((error, scope) => {
    if (!(error instanceof NotFound)) throw error; // to the boundary above
    void scope;
    // returning here swallows it
  });
});
```

With no boundary anywhere above, the error reaches `console.error`. Replacing
a failed subtree with something that renders is
[`errorBoundary`](./component.md#error-boundaries), which is built on this.

`setErrorReporter` is the application-wide hook. It is called for every error
the channel carries, including ones a boundary swallowed, and takes over from
the console:

```ts
setErrorReporter(({ error, component, props, scope, handled }) => {
  telemetry.send({ error, component: component?.constructor.name, props, handled });
  void scope;
});
```

## Context

| Function | Description |
|---|---|
| `createContext(defaultValue, name?)` | Create a context key |
| `provideContext(context, value)` | Provide a value on the current scope |
| `useContext(context)` | Resolve from the nearest provider, else the default |

## Type guards

| Function | Description |
|---|---|
| `isSignal(v)` | True for `Signal.State` or `Signal.Computed` |
| `isWritableSignal(v)` | True for `Signal.State` |

## Instrumentation

`setDevListener` and `declareTarget` are exported for
[the developer tools](./devtools), not for applications: the graph and the
scheduler are the only places that know what a panel wants to show, and they
are in this package. `declareTarget(node)` is how a binding names the element
its next effect writes to, which is what `nodesOwnedBy` reads back. Every call
into either is inside `if (__VOLT_DEV__)`, so a production build removes the
calls and then the modules behind them. Import `@voltdev/core/devtools`
instead.
