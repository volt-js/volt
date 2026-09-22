# Data primitives

Two things in `@voltdev/primitives` are not widgets but the state widgets are
built from: the state of one remote call, and the locale a page is spoken and
formatted in. The combobox's async search and the tree's lazy children are
built on the first, and so is each entry in the [query cache](./query). The
calendar, date picker, combobox, listbox, tree, form inputs, overlays, display
primitives and grid read the second for their strings, their numbers and their
sort order.

::: warning Not on npm yet
Part of `@voltdev/primitives`, which is not published yet — see
[the overview](./primitives). Everything here works from a checkout of the Volt
repository.
:::

Both are headless like the rest of the package — they own signals and hand
back prop objects, and nothing here renders. Both are imported from
`@voltdev/primitives`.

| Export | What it is |
|---|---|
| [`createResource`](#createresource) | One remote call: status, data, error, retries, and the guarantee that a slow answer cannot overwrite a fast one |
| [`exponentialBackoff`](#retrying) | The default retry schedule, exported for a `retryDelay` that wraps it |
| [`createLocaleProvider`](#createlocaleprovider) | A locale provided to everything below it in the reactive scope |
| [`createLocale`](#createlocale-and-uselocale) | The same locale with nothing provided — for code outside the component tree |
| [`useLocale`](#createlocale-and-uselocale) | The nearest provided locale, or an ambient one |
| [`useProvidedLocale`](#createlocale-and-uselocale) | The nearest provided locale, or `null` — for a component with English of its own |
| [`createFormatters`](#formatting) | Number, currency, percent, date, relative time, list and byte formatting bound to a tag |
| [`relativeTimeParts`](#relativetime) | The amount and the unit `relativeTime` would say, for code that is not a formatter |
| [`getNumberFormat` and the other `get*`](#cached-intl-instances) | Cached `Intl` constructors |
| [`resolveDirection`](#direction) | The writing direction at an element |
| [`DEFAULT_MESSAGES`](#messages), [`DEFAULT_COLLATOR_OPTIONS`](#sorting) | The defaults a catalogue and a collator start from |
| [`resetLocaleCaches`](#cached-intl-instances) | A test seam: forgets the cached `Intl` instances and the ambient locale |

## `createResource`

```ts
function createResource<T, S = undefined>(
  fetcher: ResourceFetcher<T, S>,
  options?: ResourceOptions<T, S>,
): Resource<T>

type ResourceFetcher<T, S> = (request: ResourceRequest<T, S>) => T | Promise<T>;
```

The state of one call, owned by the component that makes it. It is not a cache:
two components asking the same question make two requests, a second `refetch()`
supersedes the first rather than joining it, and the data goes when the
component does. Sharing one request between everything that wants it —
deduplication, staleness, invalidation by key — is
[`@voltdev/query`](./query), which builds each of its cache entries on a
resource rather than writing this lifecycle a second time.

```ts
import { Component, Signal } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { createResource } from '@voltdev/primitives';

interface Item { id: string; name: string }

@Component({
  selector: 'v-search',
  render: compileTemplate(`
    <input :value="query.get()" :input="query.set($event.target.value)">
    <p :spread="results.statusProps()">{ results.announcement() }</p>
    <p :if="results.isError()" :spread="results.errorProps()">{ results.errorMessage() }</p>
    <ul :spread="results.contentProps()">
      <li :for="item of results.data() ?? []" :key="item.id">{ item.name }</li>
    </ul>
  `),
})
export class Search {
  query = new Signal.State('');
  results = createResource<Item[], string>(
    async ({ source, signal }) => {
      const response = await fetch(`/search?q=${encodeURIComponent(source)}`, { signal });
      return (await response.json()) as Item[];
    },
    {
      source: () => this.query.get(),
      enabled: () => this.query.get().length > 1,
      debounce: 200,
      retry: 2,
    },
  );
}
```

**Create it in a field initialiser**, like every primitive. It registers an
effect and a cleanup on the scope it is called in, so it lives as long as the
component and disposing the component aborts whatever is in flight. Outside any
scope it still fetches, but nothing will ever dispose it, and a development
build warns that its cleanup will never run.

Nothing goes out during construction. The first request is started by an
effect whose first run is deferred to the next flush, so a resource declared as
a class field sees the props assigned after construction — see
[on a server](#on-a-server) for why that is a data effect.

**Give the type arguments when the fetcher reads its request.** `T` appears on
both sides of the fetcher — in the request it is handed (`previous`, `push`)
and in what it returns — and TypeScript settles it from the parameter before it
ever reads the return, so `async ({ signal }) => … as Item[]` infers
`Resource<unknown>`. Write `createResource<Item[], string>(…)`, or annotate the
fetcher's return type; a cast on the returned expression is not enough. A
fetcher that takes no parameter infers as you would expect.

Give both arguments when there is a `source`. TypeScript does not infer the
rest once one is written, so `createResource<Item[]>(…)` leaves `S` at its
default of `undefined`, and a `source: () => string` beside it is a type error.
An annotated return type avoids the question: `T` comes from the annotation and
`S` from `source`.

### The request

The fetcher is handed one object describing the call it is making.

| Member | Description |
|---|---|
| `source` | The dependency's value when this request started |
| `signal` | Aborted when the request is superseded, cancelled, mutated over, or its scope disposed. Pass it to `fetch` |
| `attempt` | `0` on the first try, then `1`, `2`, … for each retry |
| `previous` | The last data that landed — earlier responses, mutations, and this request's own pushes |
| `push(next)` | Publish a partial result without ending the request. The status stays `loading` |

`previous` is what makes an infinite list one line — return
`[...(previous ?? []), ...page]`. On a retry it still holds whatever the failed
attempt managed to push, which a resumable stream wants and a restarting one
does not; `attempt` is how the fetcher tells the two apart.

### Resource options

| Option | Default | Description |
|---|---|---|
| `source` | none | `() => S` — the inputs. A change refetches, subject to `equals`, `debounce` and `throttle`. Without one the fetcher is handed `undefined`, and the resource fetches once at the start (unless `immediate` is off) and after that only on `refetch()` |
| `equals` | `Object.is` | `(a, b) => boolean` — whether two source values mean the same request |
| `enabled` | always | `() => boolean` — whether the source is worth a request. Gates the automatic fetches only |
| `immediate` | `true` | Fetch as soon as the resource starts |
| `initialData` | none | Data to start from. The resource starts in `success` with it |
| `data` | owned | A `Signal.State<T \| undefined>` to hold the data from outside |
| `status` | owned | A `Signal.State<ResourceStatus>`, likewise |
| `debounce` | `0` | Milliseconds of quiet before fetching a changed source |
| `throttle` | `0` | Fetch at most once per this many milliseconds |
| `retry` | `0` | How many times to try again after a failure |
| `retryDelay` | `exponentialBackoff` | `(attempt, error) => ms` before retry `attempt`, counted from 1 |
| `shouldRetry` | every failure | `(error, attempt) => boolean`, asked before retry `attempt` |
| `labels` | English | The strings it announces — see [announcing it](#announcing-it) |
| `onSuccess` | none | `(data) => void`, after a response lands |
| `onError` | none | `(error) => void`, for a failure that is final |

`equals` is right as `Object.is` for a string or a number and wrong for the
object literal a derived source usually builds: `{ page, filter }` is a new
object on every read, so without an `equals` every unrelated re-run refetches.

Only `source` and `enabled` are reactive. `debounce`, `throttle` and `retry`
are read once, when the resource is created, so changing the value you passed
changes nothing afterwards; the functions — `equals`, `retryDelay`,
`shouldRetry`, the callbacks — are called each time they are needed, and can
read whatever they like. The labels are read off the object you passed each
time one is spoken, which is what lets a translated one follow the locale — see
[announcing it](#announcing-it).

`initialData` is ignored when `data` is supplied, since that signal already
holds the truth. Supplying `data` is how a resource writes into a store shared
with something else — a grid's rows, a cache that outlives this component.

Supplying `status` hands the resource a signal to write its status into, and
nothing more. Shared between several resources it is whichever wrote last, not
a summary of them: when the first of two answers, it says `success` while the
other is still loading. A shell that wants one spinner for several resources
derives it — a `Signal.Computed` over each one's `isLoading()` — rather than
sharing the signal. A resource disposed mid-request puts a supplied status back
as [`abort()`](#writing-the-data-yourself) does — `success` if there is data,
`idle` if not — because the signal outlives the component, and a `loading` left
in it would be a spinner nothing is ever going to take down. Both take back only
a `loading` of the resource's own: one with nothing in flight writes nothing, so
a resource that never fetched leaves another's `loading` standing when it goes.

### What a resource returns

| Member | Description |
|---|---|
| `status()` | `'idle'`, `'loading'`, `'success'` or `'error'` |
| `data()` | The last data that landed. Survives a later failure |
| `error()` | The last failure, as thrown — `unknown`, because a `throw` can be anything |
| `attempt()` | The retry number of the attempt in flight, or of the last one to finish |
| `isLoading()` / `isError()` | The two statuses a template branches on |
| `announcement()` | What the polite live region should say now, or `''` |
| `errorMessage()` | The error in a sentence a user can read, or `''` |
| `refetch()` | Fetch now, whatever the timers and `enabled` say. `Promise<T \| undefined>` |
| `mutate(next)` | Write the data locally, abandoning anything in flight |
| `abort()` | Cancel what is in flight and anything queued, leaving the data alone |
| `statusProps()` | For the polite live region carrying `announcement()` |
| `contentProps()` | For the element whose contents are being replaced |
| `errorProps()` | For the element carrying `errorMessage()` |

Every reader is a signal read, so a template that calls one is subscribed to it.
The types — `Resource`, `ResourceOptions`, `ResourceRequest`,
`ResourceFetcher`, `ResourceStatus`, `ResourceUpdater`, `ResourceLabels` and
`ResourceProps` — are exported beside it.

### The lifecycle

A resource with nothing in it is `idle`. With `initialData`, or a `data` signal
that already holds something, it starts in `success`, because a template
branching on status would otherwise put a spinner over data it already has. A
`status` signal you supply is the exception: it is left holding whatever you
gave it until the resource first writes to it. Each attempt sets `loading` and
records its `attempt` number, and the request ends in `success` or `error`.

`success` and `error` describe the **last completed request, not the data**. A
refetch that fails leaves the last good data in place and sets the error beside
it, because a list that empties itself on a dropped connection loses work the
user could still see. `error` with data present is an ordinary state, not a
contradiction. `mutate(undefined)` clears the data deliberately.

`refetch()` resolves with the data, or `undefined` when the call failed or was
superseded. It never rejects: it is called from templates and event handlers
where nothing awaits it, and a rejection there is an unhandled one. The failure
is in `error()`, which is where a UI reads it from anyway.

A resource asks again when its source changes, when `enabled` comes back on, or
when it is told to. There is no polling, and no refetch when the tab regains
focus or the network comes back; a component that wants either calls
`refetch()` from its own listener.

### When a later request overtakes an earlier one

Type "ca" then "cat" and two requests are in the air. If "ca" answers second,
its results land under the word "cat", and the list is wrong in a way that looks
like a backend bug.

Aborting the first request is not the fix, because an abort is a request to
stop, not a promise that nothing arrives: a fetcher reading from a cache or a
service worker, or one that ignores its signal, resolves anyway. So every
request takes a number from a generation counter, and every write — the
response, an error, a `push` — first checks that its number is still the newest.
A stale one is dropped before it touches a signal, resolved or not, aborted or
not. The `AbortController` is still there, because stopping work nobody wants
is worth doing; it is not what makes this correct.

A superseded request is also **no longer waited for**. The fetcher's promise is
raced against its own abort, so a fetcher that ignores the signal — or returns
a promise that never settles — does not hold the call open, and a `refetch()`
someone awaited resolves `undefined` the moment the request is overtaken rather
than whenever the old response eventually arrives. That stops the waiting, not
the work: a fetcher that ignores its signal still runs to the end, and its
answer is thrown away.

The abort reason is a `DOMException` named `AbortError`, the same thing `fetch`
rejects with when it aborts itself, so code that checks
`error.name === 'AbortError'` behaves the same whichever side aborted. Its
message says why: superseded by a newer request, superseded by a local
mutation, aborted by the consumer — which is also what `enabled` turning false
reads as — or the owning scope disposed.

### Debounce and throttle

Both apply to **the dependency, not to calls**. They exist for
search-as-you-type, where the input changes far faster than a server can
answer. `refetch()` is an explicit act — a Retry button, a pull to refresh —
and runs at once, because a Retry that appears to do nothing for 300 ms reads
as broken.

`debounce` waits for that many milliseconds of quiet. What it costs is exactly
the delay: every search is that much later, including the one where the user
typed three characters and stopped — and including the first fetch, which goes
through the same wait. What it buys back is every request in between.

`throttle` sends the first change at once and never drops the last one, only
holds it to the end of the window, so a user who types steadily sees results
throughout rather than only when they pause. The two combine, and the wait is
whichever is longer. Only the newest source survives either wait: a queued run
for a query the user has already replaced is discarded.

The wait holds back the new request, not the old one. A request already in
flight for the previous source is not cancelled until the next one actually
starts, so it is still the newest request there is, and an answer it gets
during the wait lands: with a 200 ms debounce, results for "ca" can appear
under "cat" for the rest of the wait, until the request for "cat" replaces
them. The generation counter promises that an older request cannot overwrite a
newer one. It says nothing about a request nobody has started yet. A resource
does not say which source its data answered, so a page that must never show an
answer to a different query records `request.source` in the fetcher and
compares it with the current one — which is what the combobox does before it
calls a list empty.

A source that compares equal to the one already requested — in flight,
answered or failed — is not asked for again, since that would throw away a good
response to ask the same question. After a final failure, then, nothing asks
for the same source again on its own; `refetch()` does, and so does turning
`enabled` off and on.

### Retrying

```ts
function exponentialBackoff(attempt: number, base?: number, cap?: number): number
```

`retry` is `0` by default, because retrying is neither free nor always wanted:
a search whose user has typed something else does not want two more attempts at
the old query, and a POST that may have half-succeeded must not be repeated by
a library that cannot know it was a POST.

The default `retryDelay` is `exponentialBackoff`: 300 ms, 600 ms, 1.2 s and on,
doubling to a cap of 30 s, each multiplied by a random factor between a half
and one. `base` and `cap` are those two numbers. The jitter is not decoration.
Failures are correlated — a server that falls over drops every client at once —
and a fixed schedule brings all of them back together at the moment it can
least cope. The cost is that the delay is not reproducible; a test that needs
an exact one passes its own `retryDelay`.

`shouldRetry` usually says "not the ones that will fail identically": a 404 or
a 422 is a fact about the request, and three more of them only make the user
wait longer for the same answer.

```ts
import { createResource, exponentialBackoff } from '@voltdev/primitives';

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

interface Report { rows: number }

export class ReportPanel {
  report = createResource<Report>(
    async ({ signal }) => {
      const response = await fetch('/api/report', { signal });
      if (!response.ok) throw new HttpError(response.status);
      return (await response.json()) as Report;
    },
    {
      retry: 3,
      shouldRetry: (error) => !(error instanceof HttpError && error.status < 500),
      retryDelay: (attempt) => exponentialBackoff(attempt, 1_000, 10_000),
    },
  );
}
```

A failure that is going to be retried is never shown. The status stays
`loading` through the backoff and `error()` stays empty, so a retry does not
run underneath the message from the try before it; `announcement()` changes to
the `retrying` label once the retry starts. `onError` hears only a failure that
is final, and a retry that succeeds never reaches it. The backoff is
cancellable: the new request, when it starts, ends the wait instead of queueing
behind it, and the abandoned query does not go on retrying in the background.
With no debounce that is the moment the source changes. With one, it is the end
of the debounce — until then the old query is still the newest request, and its
retries carry on through the wait, as its answer would.

### Writing the data yourself

`mutate(next)` is an optimistic update — an edit the server has yet to confirm.
It aborts anything in flight and discards its response, because a mutation says
the answer is known now, and a response already on its way carries the value
the user has since changed. So the order in the usual flow matters: mutate,
save, then `refetch()` to reconcile.

```ts
import { createResource } from '@voltdev/primitives';

interface Todo { id: string; title: string; done: boolean }

export class TodoList {
  todos = createResource<Todo[]>(async ({ signal }) => {
    const response = await fetch('/api/todos', { signal });
    return (await response.json()) as Todo[];
  });

  async toggle(id: string): Promise<void> {
    this.todos.mutate((list) => list?.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    try {
      await fetch(`/api/todos/${id}/toggle`, { method: 'POST' });
    } finally {
      await this.todos.refetch();
    }
  }
}
```

Nothing rolls an optimistic value back for you. If the save fails, the edit
stays on screen until something asks the server again, which is why the
`refetch()` above is in a `finally`: after a failed save it is what puts the
server's answer back.

Mutating to `undefined` returns the resource to `idle` rather than claiming
success at holding nothing; any other value sets `success` and clears the
error.

`request.push(next)` is the other way data arrives, and a different thing: a
partial result written *during* a request — a streamed chunk, an upload's byte
count, the first page of a paged read — without ending it. `mutate` cannot do
that job, because it abandons the request. A push from a request that has been
overtaken is dropped silently, so a stream the user has moved on from cannot
keep writing over its replacement.

Both take a function as an updater, handed the current data. There is no way to
tell an updater from a `T` that happens to be a function, so a resource whose
data *is* a function has to wrap it: `mutate(() => fn)`.

`abort()` cancels what is in flight and anything queued, and leaves the data
alone. A `loading` status falls back to `success` if there is data and `idle` if
there is not, because a spinner that stays up after a cancel is the bug this
exists to prevent. It also forgets which source was asked for, so the next
automatic run asks again even for a source that compares equal — a cancelled
upload retried against the same file — rather than treating the cancelled
request as answered.

### `enabled` and `immediate`

`enabled` turning false aborts anything in flight and forgets the request, so
turning it back on asks again rather than waiting for an answer that was
cancelled. It gates the automatic fetches only: `refetch()` runs either way, and
a refetch made while disabled is not cancelled by an unrelated re-run — only the
change *into* disabled cancels.

`immediate: false` sends nothing until the source changes or `refetch()` is
called — what a submit-driven form wants, and what a resource hydrating from
`initialData` wants until something invalidates it. The two meet at the start.
A resource created disabled starts the first time `enabled` turns true, and
with `immediate: false` that start sends nothing either; after it, a source
change or a disable-and-enable asks as usual.

### Announcing it

The three prop bags are for three different elements, and the split is what a
screen reader needs rather than a styling convenience.

| Bag | Carries |
|---|---|
| `statusProps()` | `role="status"`, `aria-live="polite"`, `aria-atomic="true"`, `data-status` |
| `contentProps()` | `aria-busy="true"` while loading and absent otherwise, `data-status` |
| `errorProps()` | `role="alert"`, `aria-live="assertive"`, `aria-atomic="true"` |

**Render the status element unconditionally.** A live region announces changes
to text inside a region that was already there, so one that appears together
with its message says nothing. `aria-busy` goes on the content rather than the
live region, because on a live region it means "do not announce me yet" and
would silence the very message the region carries. The error gets a region of
its own rather than a status region that changes politeness, since a change to
`aria-live` on an existing region is not reliably picked up; `role="alert"` is
the one live region that may be rendered together with its message, so it can
sit behind an `:if`.

| Label | Default | When |
|---|---|---|
| `loading` | `Loading…` | The first attempt is in flight |
| `retrying` | `Retrying…` | A retry is in flight |
| `success` | `''` | The status is `success` — after a response, a `mutate`, or with `initialData` |
| `error` | `Something went wrong.` | Shown by `errorMessage()`; may be `(error) => string` |

`success` is silent by default: search-as-you-type would otherwise say "Loaded"
after every keystroke, over the result count a combobox announces itself. A
resource whose success is an event in its own right — an upload finishing —
should set it. An error is never put in the polite region, only in the alert,
so it is announced once. The default error sentence deliberately does not read
the error's own message, which is written for whoever wrote the server and
routinely names tables, hosts and stack frames; the function form is for
mapping status codes to sentences.

These labels are plain strings, not keys into the
[locale's catalogue](#messages). A resource does not read the locale; a
localised application passes them in from `locale.t(…)` itself. The resource
reads each label off the object you passed at the moment it speaks it, so the
way to follow a language change is a getter: `get loading()` returning
`locale.t('loading')` is asked each time, and the region saying it is
subscribed to the locale through it. `labels: { loading: locale.t('loading') }`
hands over a string computed once, which goes on saying it in the language the
page started in after a `setLocale`. The function form of `error` is called
each time `errorMessage()` is read, so it follows the locale the same way.

```ts
import { createResource, useLocale, type Locale, type ResourceLabels } from '@voltdev/primitives';

function translated(locale: Locale): ResourceLabels {
  return {
    get loading() {
      return locale.t('loading');
    },
    error: () => locale.t('failed'),
  };
}

export class Orders {
  locale = useLocale();
  orders = createResource(async () => (await fetch('/api/orders')).json() as Promise<string[]>, {
    labels: translated(this.locale),
  });
}
```

### On a server

The resource starts its fetches from a `dataEffect`, not an `effect`. The first
run is still deferred, which is what lets a class field see its props; but a
server flush drains the data lane and never the user lane, so a resource
triggered from an `effect` would never fetch there at all. See
[effects](./reactivity#effects).

Every fetch is handed to `trackRequestData` — the ones a resource starts from
its own effect, and one started by calling `refetch()` during the render — so
[`settleRequest`](./server#settlerequest) waits for it before the page is
written. That includes a resource whose source is another resource's data,
which is why that waiting is a loop, and every entry in the
[query cache](./query), which only ever fetches through `refetch()`. Two options
behave differently while a request is current, because both exist for a
browser:

- **`debounce` and `throttle` are zero.** They coalesce keystrokes, and a server
  has none. A wait there is worse than useless: a fetch that has not started is
  one the render finishes without, so the page would ship with the data missing.
- **The backoff between retries is zero.** The retries still happen; the
  seconds tuned to let a flaky phone connection recover would be seconds a
  response spent holding its socket open.

A value a server fetched reaches the client through
[`hydratable`](./server#the-state-payload), handed over as `data`, with
`immediate` turned off when `wasHydrated` says it arrived:

```ts
import { hydratable, wasHydrated } from '@voltdev/core';
import { createResource } from '@voltdev/primitives';

interface User { name: string }

export class Profile {
  user = hydratable<User | undefined>('profile.user', () => undefined);
  profile = createResource<User>(
    async ({ signal }) => (await (await fetch('/api/me', { signal })).json()) as User,
    { data: this.user, immediate: !wasHydrated(this.user) },
  );
}
```

## `createLocaleProvider`

```ts
function createLocaleProvider(options?: LocaleOptions): LocaleProvider
```

A component that reaches for `Intl` itself gets three things wrong. It uses the
runtime's locale rather than the application's, so a page set to German still
groups numbers the American way. It constructs a formatter per render, which is
the expensive part of `Intl` and the reason a table of a thousand dates janks.
And it hard-codes English, because there is nowhere else for "No results" to
live.

So a locale is one object provided down the reactive scope: the tag, the
resolved writing direction, the catalogue of everything the library says out
loud, and formatters bound to all three.

```ts
import { Component, Signal } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { createLocaleProvider } from '@voltdev/primitives';

@Component({
  selector: 'v-app',
  render: compileTemplate(`
    <div :ref="root" :spread="locale.providerProps()">
      <button :aria-label="locale.t('close')">×</button>
      <p>{ locale.t('pageOf', { n: 3, m: 12 }) }</p>
      <p>{ locale.format.bytes(1536) }</p>
    </div>
  `),
})
export class App {
  root = new Signal.State<Element | null>(null);
  locale = createLocaleProvider({
    defaultLocale: 'de-DE',
    element: () => this.root.get(),
    messages: { close: 'Schließen' },
  });
}
```

Everything read from a locale is a signal read, so changing it re-renders the
strings, the numbers and the direction together — which is the point of them
being one object rather than three. A component that registers arrow keys
through [roving focus](./primitives#roving-focus-createrovingfocus) reads direction off the same
`dir` attribute the provider writes, so a locale change to Arabic mirrors the
keyboard as well as the layout.

The provider is found through the reactive scope, not the DOM, so content
rendered through a `:portal` still sees the provider that declared it — the
case an ancestor lookup gets wrong. It is provided on the scope of the
component that creates it, which reaches that component's children and nothing
beside or above it; called outside any scope, `createLocaleProvider` throws.

### Locale options

| Option | Default | Description |
|---|---|---|
| `locale` | owned | A `Signal.State<string>` to control the tag from outside |
| `defaultLocale` | `<html lang>`, then the runtime's, then `'en'` | The initial tag when uncontrolled |
| `direction` | owned | A `Signal.State<Direction \| 'auto'>` to control the direction from outside |
| `defaultDirection` | `'auto'` | `'ltr'`, `'rtl'`, or `'auto'` to resolve it |
| `element` | none | `() => Element \| null \| undefined` — the element this locale governs |
| `messages` | `{}` | Translations over the English defaults, as an object or a `Signal.State` of one |
| `collator` | `{ numeric: true }` | Defaults for `compare` and `collator`, merged over the numeric default |
| `onLocaleChange` | none | `(tag) => void`, when `setLocale` changes the tag |

`<html lang>` is validated before it is used: `lang="en_US"` — a POSIX locale
name copied into markup — is common in the wild, every `Intl` constructor
throws `RangeError` on it, and a typo in someone's markup should not become a
page that does not render. A malformed one falls through to
`navigator.language`, then to `'en'`. The check is for shape, not meaning: a
well-formed tag that names no language, such as `lang="english"`, passes it,
and `Intl` then formats in the runtime's own language without complaint.
`defaultLocale` is taken as given, so a malformed one there throws `RangeError`
from the first call that formats, compares or pluralises anything.

`onLocaleChange` fires for `setLocale` with a different tag, not for a write
made directly to a `locale` signal you supplied — you made that one, so you
already know.

A nested provider does not inherit its parent's tag; give it one. Inheriting
only the initial value would be a lie the first time the parent changed, and
inheriting it live would mean a provider that cannot say what locale it is
without walking the scope on every read. Nor does it inherit the direction its
parent resolved: given an `element` inside the outer provider's, its own
language decides, unless an author's `dir` or a direction forced on the parent
says otherwise — see [direction](#direction).

### What a locale returns

| Member | Description |
|---|---|
| `code()` | The BCP 47 tag. Extensions ride along: `de-DE-u-co-phonebk` collates that way |
| `direction()` | The resolved writing direction, `'ltr'` or `'rtl'` |
| `t(key, values?)` | A string from the catalogue, pluralised and interpolated |
| `has(key)` | Whether a key resolves, in the catalogue or the defaults |
| `plural(count, options?)` | The plural category for a count, for a component branching by hand |
| `compare(a, b)` | The comparator for sorting anything a person reads |
| `collator(options?)` | The `Intl.Collator` behind `compare`, with one-off options |
| `format` | The [formatters](#formatting), bound to this locale |
| `setLocale(tag)` | Change the tag |
| `setDirection(direction)` | Force `'ltr'` or `'rtl'`, or go back to `'auto'` |
| `setMessages(catalog)` | Replace the catalogue |
| `providerProps()` | `lang` and `dir`, for the element this locale governs, and `data-volt-dir="auto"` beside a `dir` it resolved rather than was forced to |

The first eight are `Locale`, which is what `useLocale` returns; the setters
and `providerProps` are `LocaleProvider`, and belong to whoever created it.
A key is a `MessageKey` — the library's own keys, which an editor completes,
or any other string for an application's own.

The types are exported beside them: `LocaleOptions`, `Locale`,
`LocaleProvider`, `LocaleProps` (what `providerProps()` returns), `Direction`,
`Message`, `PluralMessage`, `PluralCategory` (what `plural()` returns),
`MessageKey`, `MessageValues` (what `t` takes as values), `MessageCatalog` (what
`messages` and `setMessages` take), `LibraryMessages` (the shape of
`DEFAULT_MESSAGES`), and for the formatters `Formatters`, `DateInput`,
`RelativeTimeFormatOptions` and `BytesOptions`.

### Messages

```ts
type Message = string | PluralMessage;

interface PluralMessage {
  zero?: string; one?: string; two?: string; few?: string; many?: string;
  other: string;
}
```

`t(key, values)` looks the key up in the catalogue, then in
`DEFAULT_MESSAGES`, and returns the key itself when neither has it — not a
string anyone wants on screen, which is exactly why it beats an empty space.
`t` is one letter on purpose: it appears in every template that says anything.
Only a catalogue's own keys count, so a key that happens to name something
every object inherits — `constructor`, `toString` — is a key like any other.

`{name}` placeholders take their values from `values`, and spaces inside the
braces are allowed. A number is formatted for the locale, since "1,234" and
"1.234" are the same page in different countries; pass a string when the number
is an identifier rather than a quantity, because an invoice number should not
acquire a thousands separator. A placeholder with no value is left standing: a
visible `{m}` is a bug report, where "Page 3 of" is a mystery.

A plural record is selected by the value named **`n`**, through
`Intl.PluralRules` for the current tag — matching the `{n}` the catalogue's own
strings are written with. Only `other` is required: it is the one category every
locale has, and the fallback for any the catalogue leaves out, so a translator
who filled in one form gets a clumsy sentence rather than a missing one.
English needs two forms, Polish four, Arabic six, which is why a count string is
a record rather than a singular-and-plural pair. With no `n`, `other` is used
and its `{n}` is left standing. `n` has to be a number to choose a form: a
string `n` is substituted into the text but chooses nothing, so `{ n: '3' }`
gets `other` — in Polish, the form for fractions.

```ts
import { createLocale } from '@voltdev/primitives';

const pl = createLocale({
  defaultLocale: 'pl',
  messages: {
    files: { one: '{n} plik', few: '{n} pliki', many: '{n} plików', other: '{n} pliku' },
  },
});

pl.t('files', { n: 1 });        // '1 plik'
pl.t('files', { n: 3 });        // '3 pliki'
pl.t('files', { n: 5 });        // '5 plików'
pl.t('pageOf', { n: 2, m: 9 }); // 'Page 2 of 9' — untranslated, so the English default
```

The strings the library speaks with an English default are `DEFAULT_MESSAGES`:

| Key | English |
|---|---|
| `close` | `Close` |
| `previous` / `next` | `Previous` / `Next` |
| `noResults` | `No results` |
| `pageOf` | `Page {n} of {m}` |
| `sortedAscending` / `sortedDescending` | `Sorted ascending` / `Sorted descending` |
| `selected` | `{ one: '{n} selected', other: '{n} selected' }` |
| `remove` | `Remove` |
| `loading` | `Loading…` |
| `required` | `Required` |
| `clear` | `Clear` |

`selected` is a plural record even though English does not inflect it, so that
a Polish catalogue has the slots it needs; the shape of the default is what a
translator copies.

Not every key is read by a component yet. The calendar, combobox, listbox,
tree, form inputs and display primitives read `previous`, `next`, `noResults`,
`selected`, `remove`, `loading`, `required` and `clear`; the popover names its
close button from `close`; and the pager announces where the reader is with
`pageOf`, unless `labels.status` says otherwise. Nothing in Volt reads
`sortedAscending` or `sortedDescending` today: a translation of them shows only
where your own templates call `t`. That includes the grid, the component the
sort keys were written for: it builds its sort announcement ("Sorted by Name
ascending") from keys of its own — `gridSortedBy`, `gridAscending`,
`gridDescending`, `gridThen` and `gridNotSorted` — and its own English, so a
catalogue's `sortedAscending` does not reach it; see
[the grid's announcements](./grid#gridoptions).

Going the other way, several components ask for keys that are not in the
defaults — `resultsAvailable` and `suggestions` in a combobox, `increase` and
`decrease` on a number input, `tagsCleared` when a tags input is emptied,
`menu`, `notifications` and `closeNotification` for the overlays,
`gridRowsLeft`, `gridAllRows`, `gridColumnWidth` and the sort keys above for
the data grid and its grouping — and use their own English when `has(key)`
says the catalogue lacks one. A catalogue that defines them translates those
too. They stay out of `DEFAULT_MESSAGES` because a key there is always found,
and its English would take the place of what the component says without it, so
copying the defaults does not show a translator these keys: each component's
page lists the ones it asks for. Every remove button asks
for `removeItem` before `remove`: a whole phrase with the thing removed as
`{label}`, so a language that puts the verb last says
`removeItem: '{label} entfernen'` where `remove` alone could only ever come
first.
The cost is that there is one flat namespace, shared with your own keys: the
number input asks for `increase` to name its stepper button, so a catalogue
that defines `increase` for something else relabels that button as well.

A plain object passed as `messages` is wrapped in a signal the locale owns, and
`setMessages` replaces it. Pass a `Signal.State` of your own when something
outside the locale decides which catalogue is current — a lazily loaded bundle
arriving — and `setMessages` then writes into yours. Either way the new
catalogue **replaces** the old one rather than merging into it: a key it leaves
out falls back to the English default, not to the catalogue before it.

For a large catalogue, the plugin can compile it to one function per message
and check every `t('key')` in a template at build time; see
[messages](./vite-plugin#messages). That sits beside this runtime catalogue
rather than replacing it.

### Direction

`direction()` is, in order: what `direction`, `defaultDirection` or
`setDirection` forced; what the governed element inherits from the DOM, not
counting a `dir` another provider resolved for itself; the direction the
language is written in; `'ltr'`.

The language step is what makes setting the tag to Arabic enough — nothing in
the DOM has to change for the page to become right-to-left. It reads the
locale's text info under either spelling engines ship, `getTextInfo()` or the
older `textInfo`, because engines in service are split between the two and
asking for only one would quietly render Arabic left to right on the other. An
engine with neither gives no answer at this step, and there the page is
right-to-left only if `direction` or an ancestor's `dir` says so. An
application that must be right-to-left on every engine says it with one of
those rather than relying on the language.

The DOM step needs `element`. Spread `providerProps()` on that same element:
it writes `lang` and `dir` there, which is why the provider never reads `dir`
back off it — it would resolve to whatever it last wrote and stop following the
locale. It reads what the element *inherits* instead. The cost is that a `dir`
written by hand on the provider's own element is ignored; use the `direction`
option, which is the one way to say it.

**A provider nested inside another takes its direction from its own
language, unless somebody stated one.** The outer provider always writes an
explicit `dir` — `ltr` or `rtl`, never nothing — and beside one it resolved
under `'auto'`, from the DOM or from its language, `providerProps()` writes
`data-volt-dir="auto"`. The inner provider's DOM step passes over a `dir` so
marked, going on to whatever was stated above: an Arabic section given an
`element` inside an English page resolves `rtl`, and an English one inside an
Arabic page `ltr`. The outer provider needs no `element` of its own for this,
only `providerProps()` spread on its element. Once the step has passed another
provider's element it does not ask computed style either, since below that
element the computed direction is the outer provider's `dir` again.

What was stated still answers before the language. That is a `dir` an author
wrote between the two providers or above both, and it is a direction forced on
the outer provider — `direction`, `defaultDirection` or `setDirection` — which
is written without the mark and so reads below as a hand-written `dir` does.
Forcing `rtl` on an English page to try a layout turns every nested provider
with it; taking the force off turns them back.

A locale given an `element` watches the document for changes to `dir` and to
that mark with a `MutationObserver`, so an ancestor's `dir` added later is
noticed; that is also why it belongs to a scope that will eventually stop it. The DOM is read from a
user `effect`, once the element is in the document — so on a server, where user
effects do not run, the DOM step never answers and the language decides.

```ts
function resolveDirection(el: Element | null | undefined): Direction
```

`resolveDirection` is the DOM step on its own, for code that has an element and
no locale. The nearest `dir` attribute wins over computed style, because markup
that says `dir` is stating intent and the attribute is readable before styles
resolve. A computed `ltr` is not taken as an answer — it is every element's
initial value, and says only that nobody said anything — and `dir="auto"` falls
through, since it hands the decision to each paragraph's text. With nothing
declared, it is `'ltr'`.

### Sorting

`compare(a, b)` is the comparator for anything a person reads.
`String#localeCompare` with no argument uses the runtime's locale, so a page set
to Swedish sorts ö beside o instead of after z, and Turkish runs ı and i
together when they are separate letters. Passing the tag is the whole fix, and a
cached collator makes it cheaper than the method it replaces.

Numeric collation is on by default, which `Intl` itself does not do — a list
with "Item 10" above "Item 9" is a bug report every time. Pass
`collator: { numeric: false }` for plain alphabetical order.
`DEFAULT_COLLATOR_OPTIONS` is that default, exported.

```ts
import { createLocale } from '@voltdev/primitives';

const sv = createLocale({ defaultLocale: 'sv' });

['Örebro', 'Oslo', 'Zürich'].sort(sv.compare); // ['Oslo', 'Zürich', 'Örebro']
['Item 10', 'Item 9'].sort(sv.compare);        // ['Item 9', 'Item 10']
```

## Formatting

```ts
function createFormatters(locale: () => string): Formatters
```

`locale.format` is this, bound to the locale's tag. `createFormatters` is
exported for code that has a tag and no locale object. The accessor is read on
every call rather than captured, so the formatters stay correct — and reactive,
when the accessor reads a signal — as the tag changes.

| Formatter | Description |
|---|---|
| `number(value, options?)` | `Intl.NumberFormat` |
| `currency(value, currency, options?)` | `currency` is an ISO 4217 code — `'GBP'`, `'EUR'`, `'JPY'` |
| `percent(fraction, options?)` | Takes a fraction: `0.42` is `42%` in English, `42 %` in German |
| `date(value, options?)` | `Intl.DateTimeFormat`, or `''` for a date that does not parse |
| `relativeTime(value, options?)` | "yesterday", "in 3 hours", "last month" |
| `list(items, options?)` | `Intl.ListFormat` — `a, b and c` in British English, `a, b, and c` in American |
| `bytes(value, options?)` | `1536` is `1.5 kB` |

A date value is a `Date`, a timestamp or a string. An unparseable one comes
back as `''` from `date` and `relativeTime` rather than throwing: it is bad data
from an API, `Intl` throws `RangeError` on it, and an empty cell is recoverable
where an exception mid-render takes the page with it. The cost is that the bad
value is now invisible.

`percent` takes a fraction because `Intl` multiplies by 100 itself; taking 42
and appending a sign would be wrong in every locale that puts the sign first or
spaces it differently.

### `relativeTime`

The options are `RelativeTimeFormatOptions` — `Intl.RelativeTimeFormatOptions`
and two more. It is not called `RelativeTimeOptions` because that name belongs
to `createRelativeTime`, and both are exported from the same package root.

| Option | Description |
|---|---|
| `now` | What the value is measured against. Default: the current time |
| `unit` | Force a unit instead of choosing one |
| `numeric` | `'auto'` by default, which says "yesterday" rather than "1 day ago" |
| `style` | As `Intl.RelativeTimeFormat` |

Below a day the unit is chosen by elapsed time, which is what "in 3 hours"
means, and by the amount once it is rounded: 59 minutes 40 seconds is "in 1
hour", not "in 60 minutes". From a day up it is counted by the calendar: 23:30
on Wednesday to 00:30 on Friday is 25 hours, and "yesterday" would be a lie that
dividing by 86,400,000 tells every night — it is "2 days ago". Counting by
calendar also absorbs the 23- and 25-hour days daylight saving makes. A gap that
rounds to a day by the clock but lies within one date — just after midnight to
just before the next — keeps its hours, "in 24 hours", since "tomorrow" would be
false and "today" would not say when. Pass `numeric: 'always'` for a live
countdown, where a word that does not change every second reads as a frozen
clock.

From seven days the answer is in weeks until a whole month has gone by — the
day of the month has to have come round — so eight days back from the 8th is
"last week" wherever the month boundary falls, and 28 days back from the 30th
is "4 weeks ago". Past that the answer is in whole months, the same count that
ended the weeks: the 31st of January seen on the 1st of March — 29 days, a day
more than "4 weeks ago" — is "last month", not the two month boundaries it
crossed. From twelve whole months it is in years, and those are the calendar's,
as days are: December 2024 seen from January 2026 is "2 years ago" rather than
"last year", which names 2025. A forced `unit` counts by the calendar
throughout — `unit: 'year'` on New Year's Day calls the day before "last year",
and `unit: 'month'` on the 1st calls it "last month". Pass `unit` when a surface
needs one scale throughout.

```ts
import { createFormatters } from '@voltdev/primitives';

const format = createFormatters(() => 'en-GB');
const now = new Date(2026, 8, 11, 12, 0);

format.relativeTime(new Date(2026, 8, 11, 15, 0), { now }); // 'in 3 hours'
format.relativeTime(new Date(2026, 8, 10, 23, 0), { now }); // '13 hours ago'
format.relativeTime(new Date(2026, 8, 10, 23, 0), { now, unit: 'day' }); // 'yesterday'
format.relativeTime(new Date(2026, 7, 20), { now });        // '3 weeks ago'
format.relativeTime(new Date(2026, 7, 11), { now });        // 'last month'
format.relativeTime(new Date(2024, 11, 15), { now });       // '2 years ago'
```

```ts
function relativeTimeParts(
  target: Date,
  base: Date,
): [number, 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year']
```

`relativeTimeParts` is that choice on its own — the amount and the unit, before
any language is involved — for code that needs the two apart: a timestamp that
paces its own clock by the unit, or a sentence built around the number.

A relative time that keeps itself current as the clock moves is
`createRelativeTime`, on [display primitives](./primitives-display#relative-time).
It is this choice on a shared ticker rather than a second implementation of it:
it calls `relativeTimeParts` for the amount and the unit, reads the locale
through `useLocale` unless it is given one, and formats through the same cached
`Intl.RelativeTimeFormat`. The two say the same thing about the same moment.

### `bytes`

| Option | Default | Description |
|---|---|---|
| `binary` | `false` | 1024-based units (KiB) rather than 1000-based SI ones (kB) |
| `maximumFractionDigits` | `1` | Digits after the point once scaled |
| `unitDisplay` | `long` for bytes, `short` once scaled | As `Intl.NumberFormat` |

Plain bytes are `long` because the short form of "byte" is "byte", which reads
as a typo at any count but one. A value that would round up to the next unit's
threshold is carried into it: 999,999 bytes is `1 MB`, not `1,000 kB`.

`Intl` has no binary units, so with `binary` only the number is localised and
the IEC symbol is appended — which also means `unitDisplay` does nothing to a
scaled binary value. That is a real gap rather than a choice, and survivable
because "KiB" is not translated in practice.

### Cached `Intl` instances

| Function | Returns |
|---|---|
| `getNumberFormat(tag, options?)` | `Intl.NumberFormat` |
| `getDateTimeFormat(tag, options?)` | `Intl.DateTimeFormat` |
| `getCollator(tag, options?)` | `Intl.Collator` |
| `getPluralRules(tag, options?)` | `Intl.PluralRules` |
| `getListFormat(tag, options?)` | `Intl.ListFormat` |
| `getRelativeTimeFormat(tag, options?)` | `Intl.RelativeTimeFormat` |

Constructing an `Intl` object resolves locale data, builds a pattern and
allocates; formatting with one is cheap. These cache by kind, tag and options,
so identical requests from anywhere in the application share one instance, and
two option objects written in a different key order share it too. Everything
above goes through them.

The cache holds 256 instances. Options can come from data — a currency per
row — so it is bounded rather than left to grow for the life of the page, and
past the bound the oldest entry goes. Oldest means first created, not least
recently used: a formatter in constant use can still be evicted by a burst of
one-off options, and is rebuilt on its next call. The writing direction of each
tag is cached beside them, in a map with no bound; it is keyed by the tag alone,
so it grows only with the number of distinct tags a page uses.

`resetLocaleCaches()` forgets every cached instance, the cached directions and
the ambient locale. It is a test seam.

## `createLocale` and `useLocale`

```ts
function createLocale(options?: LocaleOptions): LocaleProvider
function useLocale(): Locale
function useProvidedLocale(): Locale | null
```

`createLocale` is the same object as `createLocaleProvider` with nothing
provided to the scope — for code outside the component tree, on a server or
off it, a worker, or a one-off formatter in a utility, where there is no scope
to provide into. Without an `element` it registers nothing on any scope, so it
is safe to create anywhere.

`useLocale()` is the nearest provided locale. With no provider anywhere it
returns an ambient one built from `<html lang>`, then the runtime's language,
then `'en'`, so a component is never without a locale and an application that
only speaks one language needs no provider at all.

```ts
import { Component, Prop } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { useLocale } from '@voltdev/primitives';

@Component({
  selector: 'v-file-size',
  render: compileTemplate(`<span>{ locale.format.bytes(size) }</span>`),
})
export class FileSize {
  @Prop() size = 0;
  locale = useLocale();
}
```

`useProvidedLocale()` is the nearest provided locale and nothing else: with no
provider it returns `null` rather than building an ambient one. It is for a
component that only wants a provider's words and has English of its own
otherwise — the popover, the menu and the toaster read their names through it.
The ambient locale is a whole locale, formatters and direction included, and
`useLocale` brings all of it into a bundle; this brings in only the context it
reads.

```ts
import { useProvidedLocale } from '@voltdev/primitives';

class CloseButton {
  locale = useProvidedLocale();
  label = () =>
    this.locale?.has('dismiss') ? this.locale.t('dismiss') : 'Dismiss';
}
```

The ambient locale reads `<html lang>` once, when it is first asked for; a later
change to the attribute is not followed. Provide a locale and call `setLocale`
when the language can change.

It is per request, not per process. It is the path taken whenever nothing
provides a locale, which makes it the likeliest thing on a server to be wrong:
shared, the first request to ask would decide the language every request after
it is formatted in. It is kept in a [`requestState`](./server#requeststate)
slot, which is a process-wide slot in a browser.

**What it does not do on a server** is know the reader's language. There is no
`<html>` to read and nothing looks at `Accept-Language`, so the ambient tag is
whatever the runtime's `navigator.language` says, or `'en'` — the server's
language, not the reader's — and a client whose document says otherwise formats
differently from the markup it hydrates. A server-rendered application that
speaks more than one language provides a locale with the tag it chose for the
request.
