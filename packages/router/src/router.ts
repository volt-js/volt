/**
 * The router: one navigation at a time, and it finishes before anything moves.
 *
 * A navigation here is a transaction. Between `navigate()` and the first pixel
 * changing, the router asks the blockers whether it may leave, works out which
 * of the routes on screen survive, fetches the chunks and the loader
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
 * **The router renders nothing.** It publishes, per depth of the branch, the
 * segment that renders there, and hands out one `OutletRender` per depth for
 * the `:outlet` in the template above it to call. So the branch is part of the
 * render rather than something mounted into it afterwards — which is what lets
 * a server write a whole page in one pass, and a hydrating client claim the
 * nodes it would have built. `resolve()` is the half of a navigation that does
 * that and nothing else; `start()` is the browser around it.
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
  createRoot,
  flushSync,
  provideOutlet,
  renderComponent,
  renderEffect,
  takeClaimed,
  type ComponentType,
  type OutletRender,
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

const { untrack } = Signal.subtle;

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

export interface StartOptions {
  /**
   * Resolve the current URL as part of starting. Default true.
   *
   * A page a server rendered has been resolved already — `resolve()` ran, and
   * then `hydrate()` claimed the markup that render produced, which is the
   * only order in which a client claims the nodes it would have built.
   * Resolving a second time would run every loader again for the page the
   * reader is already looking at.
   */
  readonly resolve?: boolean;
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

  /**
   * What renders at this depth of the branch, as a template's `:outlet` calls
   * it.
   *
   * The application provides depth 0 where it mounts its own root; every depth
   * below that is provided by the depth above it as that one renders, so an
   * application names this once:
   *
   *   mount(App, host, {
   *     setup: () => {
   *       provideRouter(router);
   *       provideOutlet(router.outletAt(0));
   *     },
   *   });
   *
   * A depth with no segment renders nothing — except on a page a server wrote
   * and a client has not resolved yet, where it holds what the server put
   * there rather than blanking it.
   */
  outletAt(depth: number): OutletRender;

  /**
   * Match a URL, load what it needs, and publish it.
   *
   * Everything a route can read — its location, its parameters, its matches,
   * its loader data, and which component renders at which depth — is in place
   * when this resolves, and nothing else has happened: no history entry, no
   * scroll, no listeners, no DOM. It is what a server render calls before it
   * writes a byte, and what a browser calls before it hydrates.
   *
   * A relative URL is resolved against the browser's location, or against a
   * stand-in origin where there is no browser — only the path, the query and
   * the fragment are ever read.
   */
  resolve(url: string | URL): Promise<NavigationResult>;

  /**
   * Take over the browser: listen for clicks, pops and unloads, take scroll
   * restoration off the browser, and resolve the current URL.
   *
   * It renders nothing and is given nothing to render into. The application
   * mounts its own root; this fills the outlets in it.
   */
  start(options?: StartOptions): Promise<void>;
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
  /** Null for a layout that groups routes without rendering anything. */
  readonly component: ComponentType<unknown> | null;
}

/**
 * Set only while a route component is being constructed.
 *
 * Module state, unlike everything else a request owns, and safe for the same
 * reason the DOM runtime's claim cursor is: the span it covers is one
 * synchronous construction. Nothing awaits between the assignment and the
 * restore, so a second request cannot arrive inside it — while a *value* held
 * here across an await, or a depth signal held out here, would be exactly the
 * leak this is careful not to be.
 */
let constructing: Segment | null = null;

/**
 * This route's loader data, as an accessor.
 *
 * Call it in a field initializer — that is the moment the router is rendering
 * this route and therefore the moment it knows which route "this" is:
 *
 *   class UserPage {
 *     user = routeData<User>();
 *   }
 *
 *   <h1>{ user()?.name }</h1>
 *
 * An accessor rather than a value because `revalidate()` writes new data into
 * a route that is still on screen, and a snapshot taken in the constructor
 * would never see it.
 */
export function routeData<T = unknown>(): () => T | undefined {
  if (!constructing) {
    throw new Error(
      __VOLT_DEV__
        ? '[volt] routeData() is only available while a route component is being ' +
          'constructed. Call it in a field initializer rather than in onMount, ' +
          'and only from a component the router rendered.'
        : '[volt] routeData() outside a route',
    );
  }

  const data = constructing.data;
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

  // Empty until something resolves. A router is created where the routes are
  // declared, which on a server is a module loaded once for every request
  // there will ever be — so it reads nothing about where anything is, and
  // `resolve()` is the only thing that says.
  const pathnameSignal = new Signal.State('');
  const searchSignal = new Signal.State('');
  const hashSignal = new Signal.State('');
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

  /** The branch as loaded, which is what `countReusable` compares against. */
  const segments: Segment[] = [];
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

  /**
   * Publish where the application is. A commit does, and so does a first
   * resolve that failed, which has nowhere else to be; neither batches here,
   * because each writes more beside it.
   */
  const publish = (to: RouteLocation, matches: readonly RouteMatch[]): void => {
    pathnameSignal.set(to.pathname);
    searchSignal.set(to.search);
    hashSignal.set(to.hash);
    paramsSignal.set(matches.at(-1)?.params ?? {});
    matchesSignal.set(matches);
  };

  /**
   * Where the application is, from what has been published rather than from
   * the address bar.
   *
   * The two agree except while a navigation is mid-flight, and there the
   * signals are the honest answer: they name the page on screen, which is what
   * a blocker is being asked about.
   */
  const here = (): RouteLocation => {
    const pathname = pathnameSignal.get();
    const search = searchSignal.get();
    const hash = hashSignal.get();
    return { pathname, search, hash, href: `${pathname}${search}${hash}` };
  };

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
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * What renders at each depth of the branch, one signal per depth.
   *
   * Per depth rather than one signal holding the whole branch, because that is
   * what keeps a layout still: a navigation between siblings writes the leaf's
   * depth and leaves the ones above it alone, so nothing above the first
   * difference is woken at all — and a signal that was not written is a
   * stronger guarantee than a diff that decided not to act on itself.
   *
   * They belong to this router. Two of them in one process is two requests on
   * a server, and a depth held at module scope would be one request's branch
   * rendering into the other's page.
   */
  const depths: Signal.State<Segment | null>[] = [];

  /**
   * Whether an `:outlet` has ever asked what renders at this depth.
   *
   * The only evidence a layout rendered no outlet. There is nothing to search
   * any more — an outlet is a place in a template, and a template without one
   * simply never calls the render — so what is observable is the call that was
   * never made. `requireOutlets` is where that is turned into a complaint.
   */
  const reached: boolean[] = [];

  const depthAt = (depth: number): Signal.State<Segment | null> => {
    while (depths.length <= depth) depths.push(new Signal.State<Segment | null>(null));
    return depths[depth]!;
  };

  /**
   * The segment that renders at this depth, and where it was found.
   *
   * A route with no component is not a hole: it contributes a loader, a slice
   * of the URL and a place to hang children, and nothing to the page — so the
   * depth below it renders where it would have. The walk reads each depth's
   * signal, and those reads are the caller's dependencies: a navigation that
   * changes what is under a pathless layout has to rebuild through it.
   */
  const segmentFor = (depth: number): { segment: Segment | null; depth: number } => {
    let at = depth;
    reached[at] = true;
    let segment = depthAt(at).get();
    while (segment !== null && segment.component === null) {
      at += 1;
      reached[at] = true;
      segment = depthAt(at).get();
    }
    return { segment, depth: at };
  };

  /** The complaint a layout with no `:outlet` earns, wherever it is noticed. */
  const noOutlet = (pattern: string): Error =>
    new Error(
      __VOLT_DEV__
        ? `[volt] Route "${pattern}" has a child route to render and its component has no ` +
          `outlet. Mark the element the child renders into with \`:outlet\`, as in ` +
          `<main :outlet></main>.`
        : `[volt] no :outlet for ${pattern}`,
    );

  /**
   * Render one segment where the caller is, with the depth below it in scope.
   *
   * The provision is made on whatever scope this runs in, and that scope owns
   * this child and nothing else — the render effect below, or the root the
   * server opens. Provided on the calling scope instead, every other `:outlet`
   * in the layout would draw the same child, and the child would go on living
   * after the parent that asked for it had gone.
   */
  const renderSegment = (segment: Segment, depth: number, out?: unknown): unknown => {
    provideOutlet(outletAt(depth + 1));

    // The ambient segment is what lets `routeData()` work without a route
    // knowing its own id: the only route component being constructed right now
    // is this one. Restored rather than cleared, because a branch is a stack
    // of these.
    const previous = constructing;
    constructing = segment;
    try {
      return renderComponent(segment.component as ComponentType<unknown>, out);
    } finally {
      constructing = previous;
    }
  };

  const outletAt =
    (depth: number): OutletRender =>
    (out?: unknown): unknown => {
      if (__VOLT_SERVER__) {
        const found = segmentFor(depth);
        if (!found.segment) return null;
        // A root of its own, for the containment the client gets from its
        // effect. Nothing disposes it on its own — the request owns everything
        // this render creates and drops the lot together.
        createRoot(() => {
          renderSegment(found.segment as Segment, found.depth, out);
        });
        // Noticed here rather than at the end, because a server has no end to
        // wait for: the bytes are written as the walk passes, and the walk is
        // over by the time anything could sweep it.
        if (depthAt(found.depth + 1).get() !== null && !reached[found.depth + 1]) {
          throw noOutlet(found.segment.pattern);
        }
        return null;
      }

      const view = new Signal.State<unknown>(null);
      // A render effect, not a computed: rendering a segment creates effects,
      // and re-running this disposes the previous segment's scope along with
      // them. It runs once, immediately, and that is what puts the build
      // inside the claim window `hInsert` has open — a node built any later
      // claims nothing, and the server's markup would be dropped for a copy of
      // itself.
      renderEffect(() => {
        const found = segmentFor(depth);
        view.set(
          // Untracked: what a route reads is the route's business. Tracked,
          // every signal the branch touched would rebuild the branch, which is
          // a re-render with extra steps.
          untrack(() =>
            found.segment ? renderSegment(found.segment, found.depth) : takeClaimed(),
          ),
        );
      });
      return () => view.get();
    };

  /**
   * A child route that never reached the page.
   *
   * The old shape of this was a DOM search: mount the layout, look for its
   * outlet, refuse if there was none. There is nothing to search now, so the
   * evidence is the render that was never called — a depth with a segment,
   * below a depth that rendered, whose `:outlet` never asked for it. Which is
   * the same mistake with the same answer, and it names `:outlet` because that
   * is what is missing from the template.
   */
  const requireOutlets = (matched: readonly RouteMatch[]): void => {
    for (let depth = 0; depth + 1 < matched.length; depth += 1) {
      if (reached[depth] && !reached[depth + 1]) throw noOutlet(matched[depth]!.pattern);
    }
  };

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * How many of the rendered segments the next branch keeps.
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
      const rendered = segments[count]!;
      const candidate = next[count]!;
      if (rendered.route !== candidate.route || rendered.pathname !== candidate.pathname) break;
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
    /**
     * Whether this commit owns the address bar and the scroll position.
     *
     * Only what a browser drives sets it. `resolve()` does not: it publishes
     * the branch and stops, which is all a server can do and all a client
     * wants done before it hydrates — a history entry written for a page the
     * browser itself just loaded is an entry over the top of the one it is
     * already on.
     */
    readonly browser?: boolean;
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
    const browser = options.browser === true;
    const from = here();
    const to = locationOf(url);

    // Going where you already are replaces rather than pushes. The entry a
    // push would add is one that Back lands on to find the very same page,
    // which reads as a Back that did nothing — and clicking the link for the
    // page you are on is the ordinary way a stack fills up with them.
    const samePlace =
      to.pathname === from.pathname && to.search === from.search && to.hash === from.hash;
    const mode: NavigationMode = options.mode === 'push' && samePlace ? 'replace' : options.mode;

    if (blockers.size > 0 && mode !== 'initial') {
      const blocked = await askBlockers({ from, to, mode });
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
            from.href,
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
      // Every loader of the branch is called before this first yields: nothing
      // above awaits on the initial path, `loadSegment` and `runLoader` call
      // the loader before their own first `await`, and `map` starts them all
      // in one pass. A server relies on it — it lends the request to
      // `resolve()` synchronously, so that a loader calling a server function
      // gets past its guard — and an `await` anywhere ahead of a loader would
      // refuse every such call without a word from here. `server.test.ts`
      // holds this to it.
      await Promise.all([
        ...next.slice(reusable).map(async (match, offset) => {
          loaded.set(reusable + offset, await loadSegment(match, url, controller.signal));
        }),
        ...next.slice(0, reusable).map(async (match, index) => {
          const should =
            options.forceRevalidate ||
            match.route.shouldRevalidate?.({
              // Against the URL being navigated to rather than against the
              // browser's origin, which a server does not have and which is
              // the same origin anyway wherever there is one.
              from: new URL(`${from.pathname}${from.search}`, url),
              to: url,
              params: match.params,
            });
          if (should) revalidated.set(index, await runLoader(match, url, controller.signal));
        }),
      ]);
    } catch (error) {
      if (id !== generation) return { status: 'aborted' };
      // Nothing has been mutated yet, so the application stays exactly where
      // it was — except for a pop, where the address bar has already moved and
      // only the user can put it back. Undoing it here would mean a second
      // history hop for every failed Back, which is worse than a stale URL.
      //
      // A first resolve has nowhere it was. What is on the screen is at this
      // URL: the page a server wrote for it, which the outlets hold while
      // their depths stay empty, or nothing at all. So the location is
      // published and the branch is not — a root claiming that page reads the
      // URL the page was written for rather than rewriting its own markup to
      // say it is nowhere, and the next navigation builds the branch whole.
      batch(() => {
        statusSignal.set('idle');
        errorSignal.set(error);
        if (mode === 'initial') publish(to, next);
      });
      return { status: 'failed', error };
    } finally {
      // Every loader of this navigation has answered, so there is nothing of
      // it left for a later refusal to abort. A newer navigation that came
      // along meanwhile owns the field now, and its controller stays.
      if (loadController === controller) loadController = null;
    }

    if (id !== generation) return { status: 'aborted' };

    if (browser) saveScroll();

    const entry = options.entry ?? {
      volt: 1,
      key: createKey(),
      index: mode === 'push' ? currentIndex + 1 : currentIndex,
      state: options.state,
    };

    if (browser) {
      if (mode === 'push') window.history.pushState(entry, '', to.href);
      else if (mode === 'replace' || mode === 'initial') {
        window.history.replaceState(entry, '', to.href);
      }
    }

    currentKey = entry.key;
    currentIndex = entry.index;

    /**
     * Everything the navigation changes, as one function.
     *
     * It has to be one function because a view transition is defined by a
     * callback: the platform takes a snapshot, runs this, takes another, and
     * animates between them. The `flushSync` calls are what make that work at
     * all here — Volt patches the DOM when effects drain, so without them the
     * callback would return having only written signals and the second
     * snapshot would be of a page that had not changed yet.
     */
    const swap = (): void => {
      // Torn down before the signals move, so a component on its way out never
      // runs an effect against the location of the page that replaced it.
      // Emptying the first depth that changed is the whole teardown: every
      // depth under it was built inside that one's render and goes with it.
      if (reusable < depths.length) {
        batch(() => {
          for (let i = reusable; i < depths.length; i++) depths[i]!.set(null);
        });
        flushSync();
        // What the outgoing branch reached says nothing about the incoming
        // one. The depth this navigation keeps is still rendered by the layout
        // above it, so its own mark stands.
        reached.length = reusable + 1;
      }

      segments.length = reusable;
      for (let i = reusable; i < next.length; i++) {
        const match = next[i]!;
        const result = loaded.get(i)!;
        segments.push({
          route: match.route,
          pattern: match.pattern,
          pathname: match.pathname,
          data: new Signal.State(result.data),
          component: result.component,
        });
      }

      batch(() => {
        publish(to, next);
        stateSignal.set(entry.state);
        errorSignal.set(undefined);
        for (const [index, data] of revalidated) segments[index]!.data.set(data);
        // Only the depths that changed. A depth that survived holds the very
        // segment it held before, so its signal is never written and the
        // layout rendering there is never woken — which is "a layout does not
        // re-mount", said as a write that did not happen.
        for (let i = reusable; i < next.length; i++) depthAt(i).set(segments[i]!);
      });

      // The DOM the scroll is about to be measured against has to be final, and
      // a route whose template reads a signal set in the batch above is still
      // pending until this runs.
      flushSync();
    };

    // Never on the first commit. A view transition animates between two
    // snapshots, and the initial render has nothing to animate away from —
    // running one there fades the whole page in on load, which is not a
    // navigation and is not what the option asked for.
    await withViewTransition(swap, browser && viewTransition && mode !== 'initial');

    // The navigation itself is over: the data landed and the branch is
    // published, whatever the templates did with it.
    statusSignal.set('idle');

    // Asked after the render, because that is when the answer exists: a layout
    // with no `:outlet` is a render that never asked for the depth below it,
    // and asking before the flush would be asking before it had the chance not
    // to.
    requireOutlets(next);

    if (browser && !options.preserveScroll) restoreScroll(mode, entry.key, to.hash);

    return { status: 'completed' };
  };

  // -------------------------------------------------------------------------
  // Listeners
  // -------------------------------------------------------------------------

  /**
   * A URL as an absolute one.
   *
   * The base is where the browser is, and a stand-in where there is no
   * browser: nothing here reads an origin — the path, the query and the
   * fragment are the whole of what a route sees — but `URL` insists on one to
   * parse a relative reference at all. A server that has a real request URL
   * passes it whole and gets its own origin back.
   */
  const urlFor = (to: string | URL): URL =>
    typeof to === 'string'
      ? new URL(to, typeof window === 'undefined' ? 'http://volt.invalid/' : window.location.href)
      : to;

  /**
   * Thrown rather than rejected: `navigate()` is called from click handlers
   * that do not await it, and a rejection there is an unhandled one that says
   * nothing about the mistake that caused it.
   */
  const requireStarted = (method: string): void => {
    if (started) return;
    throw new Error(
      __VOLT_DEV__
        ? `[volt] ${method} before start(). The router is not listening to the browser — and ` +
          `not writing its history — until start() has run. On a server, resolve() is the ` +
          `whole of it.`
        : '[volt] router not started',
    );
  };

  const navigate = (
    to: string,
    navigateOptions: NavigateOptions = {},
  ): Promise<NavigationResult> => {
    requireStarted('navigate()');

    const url = urlFor(to);
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
      browser: true,
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
      browser: true,
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
    const url = urlFor(anchor.href);
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

    const from = here();
    for (const blocker of blockers) {
      // Only a synchronous refusal counts. The browser decides whether to
      // prompt the moment this handler returns, so a promise resolving later
      // has nothing left to stop.
      if (blocker({ from, to: from, mode: 'unload' }) === true) {
        event.preventDefault();
        return;
      }
    }
  };

  const preload = async (to: string): Promise<void> => {
    const url = urlFor(to);
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
    outletAt,

    resolve: (to) => commit(urlFor(to), { mode: 'initial' }),

    revalidate: () => {
      requireStarted('revalidate()');
      return commit(new URL(window.location.href), {
        mode: 'replace',
        browser: true,
        // Every route on screen is asked again, which is what an application
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

    start: async (startOptions: StartOptions = {}) => {
      if (started) throw new Error('[volt] This router is already started.');
      started = true;

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

      if (startOptions.resolve === false) {
        // The page was resolved before it was hydrated, so the entry still has
        // to be stamped — it carries the key a scroll position is filed under
        // — but the branch on screen is already the branch for this URL. What
        // the entry carries is the browser's, not the page's: `resolve()` had
        // no entry to read it from, and a reload keeps it.
        currentKey = entry.key;
        currentIndex = entry.index;
        stateSignal.set(entry.state);
        const { pathname, search, hash } = window.location;
        window.history.replaceState(entry, '', `${pathname}${search}${hash}`);
        return;
      }

      await commit(new URL(window.location.href), { mode: 'initial', entry, browser: true });
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

      // Emptying the depths is the teardown now: whatever each one rendered is
      // owned by the render that put it there, and goes when that render is
      // told there is nothing here. The tree the application mounted is the
      // application's, and stays.
      batch(() => {
        for (const depth of depths) depth.set(null);
      });
      flushSync();
      segments.length = 0;
      reached.length = 0;
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
 * `transitionRunning` is module state on purpose and is not a router's: the
 * platform serializes transitions per *document*, so two routers in one page
 * are two callers of one queue, and on a server neither of them ever gets
 * here.
 *
 * Awaited on `updateCallbackDone` rather than on `finished`. The first settles
 * once the DOM has been changed, which is what the rest of a navigation is
 * waiting for; the second settles when the animation ends, and holding scroll
 * restoration until then would leave the reader looking at the old scroll
 * position for the length of the transition.
 */
let transitionRunning = false;

async function withViewTransition(swap: () => void, enabled: boolean): Promise<void> {
  // The two cheap refusals first, because everything below them reads a
  // document: this is reached from a server render, where the answer is always
  // no and where naming `document` at all would throw.
  if (!enabled || transitionRunning) {
    swap();
    return;
  }

  const start = (document as StartsViewTransitions).startViewTransition;
  if (
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
