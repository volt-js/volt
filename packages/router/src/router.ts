/**
 * The router: one navigation at a time, and it finishes before anything moves.
 *
 * A navigation here is a transaction. Between `navigate()` and the first pixel
 * changing, the router asks the blockers whether it may leave, works out which
 * of the currently mounted routes survive, fetches the chunks and the loader
 * data for the ones that do not, and only then touches the history, the
 * signals and the DOM. Nothing renders in a half-loaded state, because nothing
 * renders until the state it needs is already there.
 *
 * That ordering is what the two visible features are made of:
 *
 *   - **A layout does not re-mount.** The old and new branches are compared
 *     position by position; every route that matches with the same URL slice
 *     keeps its component instance, its scroll position, its open menus and
 *     its in-flight work. Only from the first difference down is anything torn
 *     out. Re-mounting the shell on every navigation is the single thing that
 *     makes an SPA feel worse than the multi-page application it replaced.
 *   - **Data is there on the first paint.** A loader runs during the
 *     navigation, not from an effect after mounting, so the route never has a
 *     frame where it exists without its data. The alternative — mount, then
 *     discover you need something — is what spinner-shaped layouts are for,
 *     and they exist because the navigation gave up too early.
 *
 * The History API is used directly. There is no history abstraction to pick
 * between, because there is nothing to abstract over: `pushState` is the
 * platform's answer and a second implementation would only be a place for the
 * two to disagree. Each entry carries `{ key, index }` alongside the
 * application's own state — the key finds a saved scroll position, and the
 * index is how a Back that a blocker refuses can be pushed back where it came
 * from, since by the time `popstate` fires the URL has already moved.
 */

import {
  Signal,
  batch,
  flushSync,
  mount,
  type ComponentType,
  type MountHandle,
} from '@voltdev/core';

import {
  buildPath,
  normalizePathname,
  type ParamInput,
  type ParamNames,
  type Params,
} from './path.js';
import {
  flattenRoutes,
  loadRouteComponent,
  matchRoutes,
  type RouteBranch,
  type RouteDefinition,
  type RouteMatch,
  type RoutePaths,
} from './routes.js';
import { findAnchor, isRoutableAnchor, shouldInterceptClick } from './link.js';

/** Marks the element a child route renders into: `<div data-volt-outlet></div>`. */
export const OUTLET_ATTRIBUTE = 'data-volt-outlet';

/** Where the application is, as the parts a route cares about. */
export interface RouteLocation {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly href: string;
}

export type NavigationMode = 'push' | 'replace' | 'pop' | 'initial' | 'unload';

export interface Transition {
  readonly from: RouteLocation;
  readonly to: RouteLocation;
  readonly mode: NavigationMode;
}

/** Return true to stop the navigation. */
export type Blocker = (transition: Transition) => boolean | Promise<boolean>;

export type NavigationOutcome = 'completed' | 'blocked' | 'aborted' | 'failed';

export interface NavigationResult {
  readonly status: NavigationOutcome;
  readonly error?: unknown;
}

export interface NavigateOptions {
  /** Replace the current history entry rather than adding one. */
  readonly replace?: boolean;
  /** Application state stored on the history entry, readable as `state()`. */
  readonly state?: unknown;
  /** Leave the scroll position alone. Default false. */
  readonly preserveScroll?: boolean;
}

export interface HrefOptions {
  readonly search?: string | Readonly<Record<string, string | number | undefined>>;
  readonly hash?: string;
}

export interface RouterOptions<R extends readonly RouteDefinition[]> {
  readonly routes: R;
  /**
   * Save and restore scroll position across history entries. Default true.
   *
   * Turning it off also leaves `history.scrollRestoration` alone, which hands
   * the job back to the browser — whose guess is based on a document that in
   * an SPA has already been replaced.
   */
  readonly scroll?: boolean;
  /**
   * Fetch a route's chunk when the pointer reaches a link to it. Default true.
   *
   * Only the chunk. Loaders stay put: a loader can be a mutation-shaped POST
   * or an expensive query, and running one because a pointer crossed a link
   * would be a side effect the user never asked for.
   */
  readonly preloadOnHover?: boolean;
  /**
   * Animate a navigation with the platform's View Transitions. Default false.
   *
   * Off by default, and not out of caution about support — the fallback is
   * simply the navigation, so an engine without it loses nothing. It is off
   * because a view transition is *document-scoped and serialized*: the
   * platform allows one at a time, and a route change arriving while a list
   * reorder is mid-transition is a real conflict rather than a hypothetical.
   * Turning it on is a statement that this application's navigations are the
   * transition worth having, which is a thing only the application knows.
   *
   * Three cases are handled here rather than left to the caller: an engine
   * without the API, a reader who has asked for reduced motion, and a
   * navigation arriving while a transition is already running. All three take
   * the ordinary path, which is the navigation happening immediately.
   */
  readonly viewTransition?: boolean;
}

/**
 * A parameter name from anywhere in the route table.
 *
 * The fallback matters: a route table that was not written with `as const`
 * widens to `string`, and without this the parameter name would narrow to
 * `never` and every call would be an error.
 */
type ParamNameOf<Paths extends string> = string extends Paths ? string : ParamNames<Paths>;

export interface Router<Paths extends string = string> {
  pathname(): string;
  search(): string;
  hash(): string;
  /** The application state stored on the current history entry. */
  state(): unknown;
  /** The routes rendering right now, outermost first. */
  matches(): readonly RouteMatch[];
  params(): Params;
  /**
   * One parameter, read through its own signal.
   *
   * A component showing `:tab` is not woken when `:id` changes, which is the
   * difference between a narrow read and reading `params()` and reaching in.
   */
  param(name: ParamNameOf<Paths>): string | undefined;
  /** One query-string parameter, likewise on its own signal. */
  query(name: string): string | undefined;
  /** `loading` from the moment a navigation starts until it has rendered. */
  status(): 'idle' | 'loading';
  /** What the last navigation failed with, or undefined. */
  error(): unknown;

  /** Build a URL from a pattern. The one place a link should be assembled. */
  href<P extends Paths>(pattern: P, params?: ParamInput<P>, options?: HrefOptions): string;

  /**
   * Go to a URL.
   *
   * Fails without touching the page when no route describes it, and replaces
   * rather than pushes when it is the URL already on screen.
   */
  navigate(to: string, options?: NavigateOptions): Promise<NavigationResult>;
  /** Fetch what a URL would need to render, without going there. */
  preload(to: string): Promise<void>;
  /** Run the current routes' loaders again, in place, without re-mounting. */
  revalidate(): Promise<NavigationResult>;
  /** Register a blocker. Returns the function that removes it. */
  block(blocker: Blocker): () => void;

  /** Match the current URL, mount it, and start listening. */
  start(root: Element): Promise<void>;
  stop(): void;
}

// ---------------------------------------------------------------------------
// History entries
// ---------------------------------------------------------------------------

/**
 * What the router stores in `history.state`.
 *
 * The application's own state is nested under `state` rather than merged, so
 * that neither can overwrite the other's keys — a router that spreads its
 * bookkeeping into the caller's object breaks the first time an application
 * stores something called `key`.
 */
interface HistoryEntry {
  readonly volt: 1;
  readonly key: string;
  readonly index: number;
  readonly state: unknown;
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return typeof value === 'object' && value !== null && (value as HistoryEntry).volt === 1;
}

let keyCounter = 0;

function createKey(): string {
  keyCounter += 1;
  return `${Date.now().toString(36)}-${keyCounter}`;
}

// ---------------------------------------------------------------------------
// Ambient loader data
// ---------------------------------------------------------------------------

interface Segment {
  readonly route: RouteDefinition;
  readonly pattern: string;
  readonly pathname: string;
  readonly data: Signal.State<unknown>;
  readonly host: Element;
  handle: MountHandle | null;
  /** This segment's outlet, resolved the first time a child needs it. */
  outlet: Element | null;
}

/** Set only while a route component is being constructed. */
let mounting: Segment | null = null;

/**
 * This route's loader data, as an accessor.
 *
 * Call it in a field initializer — that is the moment the router is mounting
 * this route and therefore the moment it knows which route "this" is:
 *
 *   class UserPage {
 *     user = routeData<User>();
 *   }
 *
 *   <h1>{ user()?.name }</h1>
 *
 * An accessor rather than a value because `revalidate()` writes new data into
 * a route that is still mounted, and a snapshot taken in the constructor would
 * never see it.
 */
export function routeData<T = unknown>(): () => T | undefined {
  if (!mounting) {
    throw new Error(
      __VOLT_DEV__
        ? '[volt] routeData() is only available while a route component is being ' +
          'constructed. Call it in a field initializer rather than in onMount, ' +
          'and only from a component the router rendered.'
        : '[volt] routeData() outside a route',
    );
  }

  const data = mounting.data;
  return () => data.get() as T | undefined;
}

/** `?` is added if it is missing, so both `{ page: 2 }` and `'?page=2'` work. */
function formatSearch(search: HrefOptions['search']): string {
  if (!search) return '';

  if (typeof search === 'string') {
    return search.startsWith('?') || search === '' ? search : `?${search}`;
  }

  const pairs = Object.entries(search)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]): [string, string] => [key, String(value)]);

  const query = new URLSearchParams(pairs).toString();
  return query ? `?${query}` : '';
}

function formatHash(hash: string | undefined): string {
  if (!hash) return '';
  return hash.startsWith('#') ? hash : `#${hash}`;
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

export function createRouter<const R extends readonly RouteDefinition[]>(
  options: RouterOptions<R>,
): Router<RoutePaths<R>> {
  type Paths = RoutePaths<R>;

  const branches: RouteBranch[] = flattenRoutes(options.routes);
  const scrollEnabled = options.scroll !== false;
  const preloadOnHover = options.preloadOnHover !== false;
  // Off unless asked for; see `RouterOptions.viewTransition` for why.
  const viewTransition = options.viewTransition === true;

  const pathnameSignal = new Signal.State(normalizePathname(window.location.pathname));
  const searchSignal = new Signal.State(window.location.search);
  const hashSignal = new Signal.State(window.location.hash);
  const stateSignal = new Signal.State<unknown>(undefined);
  const paramsSignal = new Signal.State<Params>({});
  const matchesSignal = new Signal.State<readonly RouteMatch[]>([]);
  const statusSignal = new Signal.State<'idle' | 'loading'>('idle');
  const errorSignal = new Signal.State<unknown>(undefined);

  /**
   * One memoized computed per name, so a reader depends on that name alone.
   *
   * A computed only notifies when its own value changes, so a navigation from
   * `/users/1/posts` to `/users/1/settings` re-runs both computeds and wakes
   * only whoever reads `tab`.
   */
  const paramReads = new Map<string, Signal.Computed<string | undefined>>();
  const queryReads = new Map<string, Signal.Computed<string | undefined>>();

  const blockers = new Set<Blocker>();
  /**
   * Where each history entry was scrolled to, by entry key rather than by URL.
   *
   * Two entries can share a URL — a link back to a list from two different
   * detail pages — and they were left at different places. Keyed by URL, the
   * second Back lands where the first one did.
   *
   * In memory only, so a reload starts fresh. Persisting would mean writing to
   * `sessionStorage` on every navigation to restore positions in a document
   * that no longer exists.
   */
  const scrollPositions = new Map<string, readonly [number, number]>();

  let root: Element | null = null;
  let segments: Segment[] = [];
  let started = false;

  /** Which navigation is allowed to finish. Everything older is dropped. */
  let generation = 0;
  let loadController: AbortController | null = null;

  let currentKey = createKey();
  let currentIndex = 0;
  /** Set while undoing a `popstate` a blocker refused, to ignore its echo. */
  let ignoreNextPop = false;
  let previousScrollRestoration: ScrollRestoration | null = null;

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  const locationOf = (url: URL): RouteLocation => ({
    pathname: normalizePathname(url.pathname),
    search: url.search,
    hash: url.hash,
    href: `${url.pathname}${url.search}${url.hash}`,
  });

  const currentLocation = (): RouteLocation => locationOf(new URL(window.location.href));

  const readParam = (name: string): Signal.Computed<string | undefined> => {
    let read = paramReads.get(name);
    if (!read) {
      read = new Signal.Computed(() => paramsSignal.get()[name]);
      paramReads.set(name, read);
    }
    return read;
  };

  const readQuery = (name: string): Signal.Computed<string | undefined> => {
    let read = queryReads.get(name);
    if (!read) {
      read = new Signal.Computed(
        () => new URLSearchParams(searchSignal.get()).get(name) ?? undefined,
      );
      queryReads.set(name, read);
    }
    return read;
  };

  // -------------------------------------------------------------------------
  // Scroll
  // -------------------------------------------------------------------------

  const saveScroll = (): void => {
    if (!scrollEnabled) return;
    scrollPositions.set(currentKey, [window.scrollX, window.scrollY]);
  };

  const restoreScroll = (mode: NavigationMode, key: string, hash: string): void => {
    if (!scrollEnabled) return;

    if (mode === 'pop') {
      const saved = scrollPositions.get(key);
      window.scrollTo(saved?.[0] ?? 0, saved?.[1] ?? 0);
      return;
    }

    if (hash) {
      // The element is already in the document — the loaders finished before
      // any of this ran — so there is nothing to wait for and no fallback path
      // for "the anchor has not rendered yet".
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView();
        return;
      }
    }

    // The initial render keeps whatever position the browser restored; only a
    // navigation the application performed goes back to the top.
    if (mode !== 'initial') window.scrollTo(0, 0);
  };

  // -------------------------------------------------------------------------
  // Mounting
  // -------------------------------------------------------------------------

  /**
   * Where this segment's child renders.
   *
   * Resolved on demand rather than at mount time, because whether a route has
   * a child at all depends on the URL: `/settings` may render `Settings`
   * alone today and `Settings` around `Profile` after the next navigation,
   * and the outlet is only required in the second case.
   *
   * A segment that rendered nothing — a pathless layout with no component of
   * its own — passes its host straight through, so grouping routes under a
   * layout that does not exist yet costs nothing.
   */
  const childHostOf = (segment: Segment): Element => {
    if (!segment.handle) return segment.host;
    segment.outlet ??= segment.host.querySelector(`[${OUTLET_ATTRIBUTE}]`);
    if (segment.outlet) return segment.outlet;

    throw new Error(
      __VOLT_DEV__
        ? `[volt] Route "${segment.pattern}" has a child route to render but its component ` +
          `has no outlet. Add <div ${OUTLET_ATTRIBUTE}></div> where the child should appear.`
        : `[volt] no outlet for ${segment.pattern}`,
    );
  };

  const hostFor = (index: number): Element =>
    index === 0 ? (root as Element) : childHostOf(segments[index - 1]!);

  const unmountFrom = (index: number): void => {
    // Deepest first, so a parent is never torn down while a child is still
    // observing something inside it.
    for (let i = segments.length - 1; i >= index; i--) {
      segments[i]!.handle?.unmount();
    }
    segments.length = index;
  };

  const mountSegment = (
    match: RouteMatch,
    component: ComponentType<unknown> | null,
    data: unknown,
  ): Segment => {
    const segment: Segment = {
      route: match.route,
      pattern: match.pattern,
      pathname: match.pathname,
      data: new Signal.State(data),
      host: hostFor(segments.length),
      handle: null,
      outlet: null,
    };

    if (component) {
      // The ambient handle is what lets `routeData()` work without a route
      // knowing its own id: the only route component being constructed right
      // now is this one.
      const previous = mounting;
      mounting = segment;
      try {
        segment.handle = mount(component, segment.host);
      } finally {
        mounting = previous;
      }
    }

    return segment;
  };

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * How many of the mounted segments the next branch keeps.
   *
   * Same route object and same slice of the URL means same component with the
   * same parameters, so there is nothing a re-mount would change — and
   * everything it would destroy. The first difference ends the run: a route's
   * position in the tree is part of its identity, so a surviving child under a
   * replaced parent is not the same route.
   */
  const countReusable = (next: readonly RouteMatch[]): number => {
    let count = 0;
    while (count < segments.length && count < next.length) {
      const mounted = segments[count]!;
      const candidate = next[count]!;
      if (mounted.route !== candidate.route || mounted.pathname !== candidate.pathname) break;
      count += 1;
    }
    return count;
  };

  interface Loaded {
    readonly component: ComponentType<unknown> | null;
    readonly data: unknown;
  }

  const runLoader = async (
    match: RouteMatch,
    url: URL,
    signal: AbortSignal,
  ): Promise<unknown> => {
    if (!match.route.loader) return undefined;
    return await match.route.loader({ params: match.params, url, signal });
  };

  const loadSegment = async (
    match: RouteMatch,
    url: URL,
    signal: AbortSignal,
  ): Promise<Loaded> => {
    // The chunk and the data go out together. Waiting for the module before
    // starting the fetch would serialise two independent round trips, which is
    // most of what makes a lazy route feel slower than an eager one.
    const pending = loadRouteComponent(match.route);
    const [component, data] = await Promise.all([pending, runLoader(match, url, signal)]);
    return { component: component ?? null, data };
  };

  // -------------------------------------------------------------------------
  // The transaction
  // -------------------------------------------------------------------------

  interface CommitOptions extends NavigateOptions {
    readonly mode: NavigationMode;
    /** Set for a pop, where the entry already exists and its bookkeeping is known. */
    readonly entry?: HistoryEntry;
    /** How far the pop moved, so a refusal can move back by the same amount. */
    readonly delta?: number;
    /** Ask every surviving route's loader again, whatever `shouldRevalidate` says. */
    readonly forceRevalidate?: boolean;
  }

  /**
   * Abort whatever is still loading, if anything.
   *
   * A DOMException named AbortError, rather than a bare string, because that
   * is what `fetch` rejects with when it aborts itself — so a loader that
   * checks `err.name === 'AbortError'` keeps working when the abort comes
   * from here instead.
   */
  const abortInFlight = (reason: string): void => {
    loadController?.abort(new DOMException(reason, 'AbortError'));
    loadController = null;
  };

  const askBlockers = async (transition: Transition): Promise<boolean> => {
    // Copied deliberately: the usual shape of a blocker is one that removes
    // itself once the user has answered its dialog, which mutates this set
    // while it is being walked.
    for (const blocker of [...blockers]) {
      if (await blocker(transition)) return true;
    }
    return false;
  };

  const commit = async (url: URL, options: CommitOptions): Promise<NavigationResult> => {
    const id = (generation += 1);
    const from = { pathname: pathnameSignal.get(), search: searchSignal.get() } as const;
    const to = locationOf(url);
    const hash = hashSignal.get();
    const here: RouteLocation = { ...from, hash, href: `${from.pathname}${from.search}${hash}` };

    // Going where you already are replaces rather than pushes. The entry a
    // push would add is one that Back lands on to find the very same page,
    // which reads as a Back that did nothing — and clicking the link for the
    // page you are on is the ordinary way a stack fills up with them.
    const samePlace =
      to.pathname === here.pathname && to.search === here.search && to.hash === here.hash;
    const mode: NavigationMode = options.mode === 'push' && samePlace ? 'replace' : options.mode;

    if (blockers.size > 0 && mode !== 'initial') {
      const blocked = await askBlockers({ from: here, to, mode });
      if (id !== generation) return { status: 'aborted' };
      if (blocked) {
        // The URL has already moved for a pop, so refusing means putting it
        // back. `go` is asynchronous and fires a `popstate` of its own, which
        // is exactly the one that must not be treated as a new navigation.
        if (mode === 'pop' && options.delta) {
          ignoreNextPop = true;
          window.history.go(-options.delta);
        } else if (mode === 'pop') {
          // An entry this router never wrote carries no index, so there is no
          // distance to travel back by, and guessing one would move the user
          // somewhere they never asked to go. Stamping this location onto the
          // entry costs nothing in history depth and is what keeps the address
          // bar naming the page that is actually on screen — which is the
          // thing a refusal is for.
          window.history.replaceState(
            { volt: 1, key: currentKey, index: currentIndex, state: stateSignal.get() },
            '',
            here.href,
          );
        }
        // A refusal ends the transaction, including one that interrupted a
        // navigation still loading — otherwise the spinner it left behind
        // stays up over a page that is not going anywhere, and the loader it
        // superseded keeps fetching against a signal that never fires.
        abortInFlight('Superseded by a newer navigation');
        statusSignal.set('idle');
        return { status: 'blocked' };
      }
    }

    const next = matchRoutes(branches, url.pathname);
    const reusable = countReusable(next);

    abortInFlight('Superseded by a newer navigation');
    const controller = new AbortController();
    loadController = controller;
    statusSignal.set('loading');

    const loaded = new Map<number, Loaded>();
    const revalidated = new Map<number, unknown>();

    try {
      await Promise.all([
        ...next.slice(reusable).map(async (match, offset) => {
          loaded.set(reusable + offset, await loadSegment(match, url, controller.signal));
        }),
        ...next.slice(0, reusable).map(async (match, index) => {
          const should =
            options.forceRevalidate ||
            match.route.shouldRevalidate?.({
              from: new URL(`${from.pathname}${from.search}`, window.location.origin),
              to: url,
              params: match.params,
            });
          if (should) revalidated.set(index, await runLoader(match, url, controller.signal));
        }),
      ]);
    } catch (error) {
      if (id !== generation) return { status: 'aborted' };
      statusSignal.set('idle');
      errorSignal.set(error);
      // Nothing has been mutated yet, so the application stays exactly where
      // it was — except for a pop, where the address bar has already moved and
      // only the user can put it back. Undoing it here would mean a second
      // history hop for every failed Back, which is worse than a stale URL.
      return { status: 'failed', error };
    } finally {
      // Every loader of this navigation has answered, so there is nothing of
      // it left for a later refusal to abort. A newer navigation that came
      // along meanwhile owns the field now, and its controller stays.
      if (loadController === controller) loadController = null;
    }

    if (id !== generation) return { status: 'aborted' };

    saveScroll();

    const entry = options.entry ?? {
      volt: 1,
      key: createKey(),
      index: mode === 'push' ? currentIndex + 1 : currentIndex,
      state: options.state,
    };

    if (mode === 'push') window.history.pushState(entry, '', to.href);
    else if (mode === 'replace' || mode === 'initial') {
      window.history.replaceState(entry, '', to.href);
    }

    currentKey = entry.key;
    currentIndex = entry.index;

    /**
     * Everything the navigation does to the document, as one function.
     *
     * It has to be one function because a view transition is defined by a
     * callback: the platform takes a snapshot, runs this, takes another, and
     * animates between them. The `flushSync` at the end is what makes that
     * work at all here — Volt patches the DOM when effects drain, so without
     * it the callback would return having only written signals and the second
     * snapshot would be of a page that had not changed yet.
     */
    const swap = (): void => {
      // Torn down before the signals move, so a component on its way out never
      // runs an effect against the location of the page that replaced it.
      unmountFrom(reusable);

      batch(() => {
        pathnameSignal.set(to.pathname);
        searchSignal.set(to.search);
        hashSignal.set(to.hash);
        stateSignal.set(entry.state);
        paramsSignal.set(next.at(-1)?.params ?? {});
        matchesSignal.set(next);
        errorSignal.set(undefined);
        for (const [index, data] of revalidated) segments[index]!.data.set(data);
      });

      for (let i = reusable; i < next.length; i++) {
        const result = loaded.get(i)!;
        segments.push(mountSegment(next[i]!, result.component, result.data));
      }

      // The DOM the scroll is about to be measured against has to be final, and
      // a route whose template reads a signal set in the batch above is still
      // pending until this runs.
      flushSync();
    };

    // Never on the first commit. A view transition animates between two
    // snapshots, and the initial render has nothing to animate away from —
    // running one there fades the whole page in on load, which is not a
    // navigation and is not what the option asked for.
    await withViewTransition(swap, viewTransition && mode !== 'initial');

    if (!options.preserveScroll) restoreScroll(mode, entry.key, to.hash);
    statusSignal.set('idle');

    return { status: 'completed' };
  };

  // -------------------------------------------------------------------------
  // Listeners
  // -------------------------------------------------------------------------

  const resolve = (to: string): URL => new URL(to, window.location.href);

  /**
   * Thrown rather than rejected: `navigate()` is called from click handlers
   * that do not await it, and a rejection there is an unhandled one that says
   * nothing about the mistake that caused it.
   */
  const requireStarted = (method: string): void => {
    if (root) return;
    throw new Error(
      __VOLT_DEV__
        ? `[volt] ${method} before start(). The router has no element to render into until ` +
          `start() has been given one.`
        : '[volt] router not started',
    );
  };

  const navigate = (
    to: string,
    navigateOptions: NavigateOptions = {},
  ): Promise<NavigationResult> => {
    requireStarted('navigate()');

    const url = resolve(to);
    if (matchRoutes(branches, url.pathname).length === 0) {
      // A click on such a link is left to the browser, because a same-origin
      // URL the table does not describe belongs to the server. There is no
      // equivalent here: this call is already inside the running application,
      // so handing the URL to the browser would reload it out from under the
      // caller, and going ahead would empty the page while changing the
      // address bar to name it. Refusing leaves both alone, and a table that
      // wants to render its own not-found page says so with a `'*'` route.
      const error = new Error(
        __VOLT_DEV__
          ? `[volt] No route matches "${url.pathname}". Add a '*' route to render a not-found ` +
            `page, or link to it with a plain <a href> so the server answers it.`
          : `[volt] no route for ${url.pathname}`,
      );
      errorSignal.set(error);
      return Promise.resolve({ status: 'failed', error });
    }

    return commit(url, {
      ...navigateOptions,
      mode: navigateOptions.replace ? 'replace' : 'push',
    });
  };

  const onPopState = (event: PopStateEvent): void => {
    if (ignoreNextPop) {
      ignoreNextPop = false;
      return;
    }

    const state: unknown = event.state;
    const entry = isHistoryEntry(state)
      ? state
      : // An entry this router never wrote — a fragment link the browser
        // handled itself, or a page that pushed state before the router
        // started. It still has to render, and it keeps the current index so
        // the next push does not collide with an existing one.
        { volt: 1 as const, key: createKey(), index: currentIndex, state: undefined };

    void commit(new URL(window.location.href), {
      mode: 'pop',
      entry,
      delta: entry.index - currentIndex,
    });
  };

  const onClick = (event: MouseEvent): void => {
    const anchor = findAnchor(event);
    if (!anchor || !shouldInterceptClick(event, anchor)) return;

    // A same-origin URL with no route belongs to the server: an API endpoint,
    // a generated PDF, a page this application does not own. Intercepting it
    // would replace a working link with a blank screen, so the click is left
    // alone and the browser loads it. An application that wants its own 404
    // page says so with a `'*'` route, which matches this too.
    const url = resolve(anchor.href);
    if (matchRoutes(branches, url.pathname).length === 0) return;

    event.preventDefault();
    void navigate(anchor.href);
  };

  const onPointerOver = (event: PointerEvent): void => {
    const anchor = findAnchor(event);
    // A speculative fetch that fails is not the user's problem — nothing has
    // been asked for yet. The failure surfaces if they actually go there.
    if (anchor && isRoutableAnchor(anchor)) void preload(anchor.href).catch(() => {});
  };

  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (blockers.size === 0) return;

    const here = currentLocation();
    for (const blocker of blockers) {
      // Only a synchronous refusal counts. The browser decides whether to
      // prompt the moment this handler returns, so a promise resolving later
      // has nothing left to stop.
      if (blocker({ from: here, to: here, mode: 'unload' }) === true) {
        event.preventDefault();
        return;
      }
    }
  };

  const preload = async (to: string): Promise<void> => {
    const url = resolve(to);
    await Promise.all(
      matchRoutes(branches, url.pathname).map(async (match) => loadRouteComponent(match.route)),
    );
  };

  // -------------------------------------------------------------------------
  // The public object
  // -------------------------------------------------------------------------

  return {
    pathname: () => pathnameSignal.get(),
    search: () => searchSignal.get(),
    hash: () => hashSignal.get(),
    state: () => stateSignal.get(),
    matches: () => matchesSignal.get(),
    params: () => paramsSignal.get(),
    param: (name) => readParam(name).get(),
    query: (name) => readQuery(name).get(),
    status: () => statusSignal.get(),
    error: () => errorSignal.get(),

    href: <P extends Paths>(pattern: P, params?: ParamInput<P>, hrefOptions?: HrefOptions) => {
      const path = buildPath(pattern, (params ?? {}) as Record<string, string | number>);
      return path + formatSearch(hrefOptions?.search) + formatHash(hrefOptions?.hash);
    },

    navigate,
    preload,

    revalidate: () => {
      requireStarted('revalidate()');
      return commit(new URL(window.location.href), {
        mode: 'replace',
        // Every mounted route is asked again, which is what an application
        // does after a mutation it cannot describe as a single key. The entry
        // is the one already there, so a revalidation is not a place Back can
        // land on and the scroll position stays where the user left it.
        entry: { volt: 1, key: currentKey, index: currentIndex, state: stateSignal.get() },
        forceRevalidate: true,
        preserveScroll: true,
      });
    },

    block: (blocker) => {
      blockers.add(blocker);
      return () => blockers.delete(blocker);
    },

    start: async (element) => {
      if (started) throw new Error('[volt] This router is already started.');
      started = true;
      root = element;

      // A reload keeps `history.state`, so an entry written before it still
      // has its key and index — and its saved scroll position is the one the
      // browser would otherwise have guessed at.
      const existing: unknown = window.history.state;
      const entry: HistoryEntry = isHistoryEntry(existing)
        ? existing
        : { volt: 1, key: createKey(), index: 0, state: undefined };

      if (scrollEnabled && 'scrollRestoration' in window.history) {
        previousScrollRestoration = window.history.scrollRestoration;
        window.history.scrollRestoration = 'manual';
      }

      window.addEventListener('popstate', onPopState);
      window.addEventListener('beforeunload', onBeforeUnload);
      document.addEventListener('click', onClick);
      if (preloadOnHover) document.addEventListener('pointerover', onPointerOver);

      await commit(new URL(window.location.href), { mode: 'initial', entry });
    },

    stop: () => {
      if (!started) return;
      started = false;

      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick);
      document.removeEventListener('pointerover', onPointerOver);

      if (previousScrollRestoration !== null) {
        window.history.scrollRestoration = previousScrollRestoration;
        previousScrollRestoration = null;
      }

      // Anything still in flight is answering a question nobody will read.
      generation += 1;
      abortInFlight('The router stopped');

      unmountFrom(0);
      segments = [];
      root = null;
    },
  };
}


/**
 * Run a document change inside a view transition, where that is the right
 * thing and possible at all.
 *
 * Three refusals, and each is the ordinary path rather than a failure: an
 * engine without the API; a reader who has asked for less motion, for whom an
 * animated page change is the thing they asked to be spared; and a transition
 * already running, because the platform serializes them and a route change
 * arriving mid-animation would be queued behind something the reader has
 * already navigated away from.
 *
 * Awaited on `updateCallbackDone` rather than on `finished`. The first settles
 * once the DOM has been changed, which is what the rest of a navigation is
 * waiting for; the second settles when the animation ends, and holding scroll
 * restoration until then would leave the reader looking at the old scroll
 * position for the length of the transition.
 */
let transitionRunning = false;

async function withViewTransition(swap: () => void, enabled: boolean): Promise<void> {
  const start = (document as StartsViewTransitions).startViewTransition;
  if (
    !enabled ||
    transitionRunning ||
    typeof start !== 'function' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  ) {
    swap();
    return;
  }

  transitionRunning = true;
  try {
    const transition = start.call(document, swap);
    await transition.updateCallbackDone;
  } finally {
    transitionRunning = false;
  }
}

interface ViewTransitionLike {
  readonly updateCallbackDone: Promise<void>;
}

interface StartsViewTransitions {
  startViewTransition?: (callback: () => void) => ViewTransitionLike;
}
