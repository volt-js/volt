/**
 * State the server rendered with, and the client picks up rather than asks for
 * again.
 *
 * Markup alone hydrates a page that looks right and is empty behind it: the
 * client's signals start wherever their declarations say, so a value the
 * server already fetched, rendered and shipped is back at its default the
 * moment the bundle runs — and is fetched a second time, over the connection
 * the user is already waiting on, to arrive at what is on the screen in front
 * of them. The delimiters carry the shape of a render across; this carries its
 * values.
 *
 * One call serves both sides, because a component is written once. On a server
 * build `hydratable` registers the signal with the request, so `renderToString`
 * can read it once the walk and its data are both finished; on a client build
 * it looks the key up in the payload the server wrote into the page and starts
 * there instead. Whether that happened is the other half of the answer — the
 * fetch worth making on the server is exactly the one that must not be made
 * again on the client — and `wasHydrated` is asked about the signal rather
 * than about the key, so that nothing can ask about a key it did not adopt.
 *
 * What the server registers is the **signal**, not its value. A resource is
 * created empty and filled when its fetch lands, which happens inside
 * `settleRequest` and long after the field initializer that declared it
 * returned: snapshotting on the way in would ship the loading state of every
 * value on the page.
 */

import { Signal, requestState } from '@voltdev/reactivity';

/**
 * The attribute marking the element the payload travels in.
 *
 * Exported because both ends need it and neither owns it: the server writes
 * it, the client selects on it, and a shell assembling its own document — or
 * stripping the element once it has been read — has to name the same thing
 * both of them do.
 */
export const STATE_ATTRIBUTE = 'data-volt-state';

// ---------------------------------------------------------------------------
// The server half
// ---------------------------------------------------------------------------

/** The slot a request keeps its registered signals in; see `requestState`. */
const STATE = Symbol('volt.state');

/**
 * What this request has registered, keyed as the payload will be.
 *
 * Per request rather than per process, because one process renders many pages
 * at once and a module-level map would put request A's cart total in request
 * B's page. `requestState` is the same mechanism the styles and the ids use,
 * for the same reason.
 *
 * Read by `renderToString` after the request has settled, which is the only
 * moment the answer is the one the markup was built from: earlier and a
 * resource is still loading, later and the scope that owns it is being
 * disposed.
 */
export function registeredState(): Map<string, Signal.State<unknown>> {
  return requestState(STATE, () => new Map());
}

// ---------------------------------------------------------------------------
// The client half
// ---------------------------------------------------------------------------

/**
 * The signals that started at a value the server sent.
 *
 * Weak because it records something about a signal that is true for exactly as
 * long as the signal exists, and a page's worth of them must not be held alive
 * by a set nothing else reads.
 */
const adopted = new WeakSet<object>();

/**
 * The payload as parsed, and the element it was parsed from.
 *
 * Cached against the node rather than behind a boolean, so a document that
 * replaces its payload — a test rendering a second page, most obviously — is
 * read again rather than answered from the first one. Parsing once is the
 * point: a page's state is one object, and re-parsing it per signal would make
 * adoption quadratic in the size of the thing it exists to stop re-fetching.
 */
let source: Element | null = null;
let carried: Record<string, unknown> = {};

function payload(): Record<string, unknown> {
  const script =
    typeof document === 'undefined'
      ? null
      : document.querySelector(`script[type="application/json"][${STATE_ATTRIBUTE}]`);
  if (script === source) return carried;

  source = script;
  carried = {};
  if (script === null) return carried;

  try {
    const parsed: unknown = JSON.parse(script.textContent ?? '');
    // An array, or a bare number, is not a payload this wrote — reading keys
    // off one would hand a component a value from a page it knows nothing
    // about.
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      carried = parsed as Record<string, unknown>;
    }
  } catch (error) {
    // A payload that does not parse means the response was cut short or
    // rewritten in transit. Every signal then starts at its default, which is
    // a page that fetches its own data: slower, and correct. Saying so in
    // development is the only way it is ever visible, since the symptom is
    // otherwise indistinguishable from a page that carried no state at all.
    if (__VOLT_DEV__ && typeof console !== 'undefined') {
      console.warn('[volt] the server state payload did not parse; starting from defaults.', error);
    }
  }
  return carried;
}

// ---------------------------------------------------------------------------
// Both
// ---------------------------------------------------------------------------

/**
 * A signal whose value crosses from the render that produced it to the page
 * that hydrates it.
 *
 *     class Cart {
 *       total = hydratable('cart.total', () => 0);
 *     }
 *
 * `key` names the value in the payload and has to be the same on both sides,
 * which is why it is a string an author writes rather than a position the two
 * renders happen to agree on: components are reached in different orders on
 * the two sides once a shell streams or a route resolves, while the names they
 * know their own data by do not move. It has to be unique across a page, and a
 * server render meeting the same key twice refuses rather than letting the
 * last one silently win and every other reader adopt its value.
 *
 * `initial` is a function so that the default of a value the server is about
 * to replace is never computed on the client at all.
 */
export function hydratable<T>(key: string, initial: () => T): Signal.State<T> {
  if (__VOLT_SERVER__) {
    const state = new Signal.State(initial());
    const registered = registeredState();
    if (registered.has(key)) {
      throw new Error(
        `[volt] two signals on this page are hydratable under the key ${JSON.stringify(key)}. ` +
          'A key names one value in one payload, so the client would start both of them from ' +
          'whichever was serialized last. Put whatever tells them apart — a row id, a route ' +
          'parameter — in the key.',
      );
    }
    registered.set(key, state as Signal.State<unknown>);
    return state;
  }

  const values = payload();
  // `hasOwn` rather than a null check: a key the server deliberately sent as
  // `null` is a value, and starting from the default instead would fetch it
  // again only to arrive back at null.
  if (!Object.hasOwn(values, key)) return new Signal.State(initial());

  const state = new Signal.State(values[key] as T);
  adopted.add(state);
  return state;
}

/**
 * Whether `state` started at a value the server sent.
 *
 * What a fetch is gated on, so that a page which arrived with its data does
 * not ask for it again the moment it can:
 *
 *     data = hydratable<Item[] | undefined>('items', () => undefined);
 *     items = createResource(load, { data: this.data, immediate: !wasHydrated(this.data) });
 *
 * False on the server, where nothing has been hydrated and the value still has
 * to be fetched by somebody — which is this render.
 */
export function wasHydrated<T>(state: Signal.State<T>): boolean {
  return adopted.has(state);
}
