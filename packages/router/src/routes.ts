/**
 * The route table: what a route is, and which branch of it a URL selects.
 *
 * Routes are a nested array of plain objects. Nesting is not decoration — it
 * is how a layout is expressed, and the branch a URL selects is the list of
 * components from the root down to the leaf, each rendering the next inside
 * itself. `/settings/profile` matching `[Settings, Profile]` is what lets
 * `Settings` stay mounted while its child changes.
 *
 * Three shapes of route, all falling out of the same object:
 *
 *   { path: 'users', component: Users, children: [...] }   a route with a path
 *   { index: true, component: Overview }                   the child shown at the parent's own URL
 *   { component: Chrome, children: [...] }                 a layout with no path of its own
 *
 * The last one is the reason `path` is optional. A pathless route contributes
 * a component and nothing to the URL, so two groups of pages can share a
 * layout without that layout appearing in every address.
 *
 * **Designed for a generator, not only for hand-writing.** Everything here is
 * data: no decorators on route objects, no registration side effects, no
 * imports resolved by name. A file-based router is then a build step that
 * walks a directory and emits exactly this array — `routes/users/[id].ts`
 * becomes `{ path: ':id', component: () => import('./routes/users/[id].js') }`
 * — and nothing in this file needs to know that happened. The two pieces that
 * exist for its benefit are `id`, so a generator can key a route to its source
 * file, and the lazy `component` form, so the generated array can name every
 * route without importing every route.
 */

import { isComponent, type ComponentType } from '@voltdev/core';
import {
  compareSpecificity,
  normalizePathname,
  parsePattern,
  splitPathname,
  trimSlashes,
  walkSegments,
  type Params,
  type PathParams,
  type PatternSegment,
} from './path.js';

/** A route component, either imported directly or fetched when the route is entered. */
export type RouteComponentLoader = () => Promise<
  ComponentType<unknown> | { default: ComponentType<unknown> }
>;
export type RouteComponent = ComponentType<unknown> | RouteComponentLoader;

/**
 * What a loader is told about the navigation it is loading for.
 *
 * Annotate it with the route's full pattern — `LoaderArgs<'/users/:id'>` — and
 * `params.id` is a `string` rather than a lookup that might be anything. That
 * annotation is the line a file-based generator writes for you, because the
 * generator is the thing that knows a file's full path; a hand-written nested
 * config only knows the segment it declared.
 */
export interface LoaderArgs<P extends string = string> {
  readonly params: PathParams<P> & Params;
  readonly url: URL;
  /**
   * Aborted when a newer navigation supersedes this one, or when the router
   * stops. Pass it to `fetch`: a loader whose answer nobody wants any more is
   * the commonest wasted request in a router.
   */
  readonly signal: AbortSignal;
}

/** Whether a still-mounted route should ask its loader again. */
export interface RevalidateArgs {
  readonly from: URL;
  readonly to: URL;
  readonly params: Params;
}

export interface RouteDefinition {
  /**
   * This route's own path, relative to its parent. Omit for a layout that
   * groups children without appearing in the URL.
   */
  readonly path?: string;
  /** Shown at the parent's own URL. Mutually exclusive with `path`. */
  readonly index?: boolean;
  /**
   * A stable identity for this route. Defaults to its full pattern, which is
   * unique unless two routes really do describe the same URL.
   */
  readonly id?: string;
  readonly component?: RouteComponent;
  /**
   * Run before this route renders, and its result is in place for the route's
   * first paint. Returning a promise is the point: the navigation waits.
   */
  readonly loader?: (args: LoaderArgs) => unknown;
  /**
   * Whether a route that stays mounted across a navigation should load again.
   * Default false — the route is at the same URL with the same params, so
   * refetching is work with no new answer. Override it for a route whose data
   * depends on the query string, which its path does not see.
   */
  readonly shouldRevalidate?: (args: RevalidateArgs) => boolean;
  /**
   * Anything the application wants to carry per route: a page title, a
   * required permission.
   */
  readonly meta?: Readonly<Record<string, unknown>>;
  /**
   * How this route is rendered, when the application renders on a server at
   * all. Inherited by children that do not say; see `routeMode`.
   */
  readonly mode?: RenderMode;
  readonly children?: readonly RouteDefinition[];
}

/**
 * Where a route's markup is produced.
 *
 * Three, not six: the six in the roadmap's table are variations on two pieces
 * of machinery and this is the axis an individual route can actually differ
 * on. Streaming is how an `ssr` route is delivered rather than a fourth
 * choice, and edge is a constraint on the whole build.
 */
export type RenderMode = 'csr' | 'ssr' | 'ssg';

/**
 * The mode this branch renders in: the nearest one declared, leaf to root.
 *
 * Leaf-first rather than root-first, because a layout says what its section
 * does by default and a page inside it is the one that knows better — a
 * marketing site prerendered whole with one live `/pricing` is the ordinary
 * shape, and the opposite reading would make the layout unable to say
 * anything.
 *
 * `fallback` is the application's own default and not this module's. Nothing
 * here decides that server rendering happens at all.
 *
 * Takes either a branch from `flattenRoutes` or the matches `matchRoutes`
 * returns for one URL, because those are the two things a caller holds: a
 * build enumerating every route has branches, and a server answering one
 * request has matches. Accepting only the first made every server write
 * `{ routes: matches.map((m) => m.route) }` to get from one to the other — or,
 * more likely, write `matches.branch` and find at runtime that an array has no
 * such thing.
 */
export function routeMode(
  chain: Pick<RouteBranch, 'routes'> | readonly RouteMatch[],
  fallback: RenderMode,
): RenderMode {
  const routes = routesOf(chain);
  for (let i = routes.length - 1; i >= 0; i--) {
    const mode = routes[i]!.mode;
    if (mode !== undefined) return mode;
  }
  return fallback;
}

/** The route definitions along a branch or a match, root to leaf. */
function routesOf(
  chain: Pick<RouteBranch, 'routes'> | readonly RouteMatch[],
): readonly RouteDefinition[] {
  return Array.isArray(chain)
    ? (chain as readonly RouteMatch[]).map((match) => match.route)
    : (chain as Pick<RouteBranch, 'routes'>).routes;
}

// ---------------------------------------------------------------------------
// The union of full patterns, at the type level
// ---------------------------------------------------------------------------

type TrimSlashes<S extends string> = S extends `/${infer Rest}`
  ? TrimSlashes<Rest>
  : S extends `${infer Rest}/`
    ? TrimSlashes<Rest>
    : S;

type JoinPath<Parent extends string, Child extends string> =
  TrimSlashes<Child> extends ''
    ? Parent extends ''
      ? '/'
      : Parent
    : Parent extends '' | '/'
      ? `/${TrimSlashes<Child>}`
      : `${Parent}/${TrimSlashes<Child>}`;

type PathsOfRoute<E, Parent extends string> = E extends { readonly path: infer P extends string }
  ? PathsUnder<E, JoinPath<Parent, P>>
  : PathsUnder<E, Parent extends '' ? '/' : Parent>;

type PathsUnder<E, Full extends string> =
  | Full
  | (E extends { readonly children: infer C } ? RoutePaths<C, Full> : never);

/**
 * Every URL pattern a route table can produce, as a union of literals.
 *
 * This is what makes `href()` and `param()` typed without a code generator:
 * given a `defineRoutes([...])` the compiler walks the same tree the matcher
 * does, and a typo in a path or a parameter name is a compile error rather
 * than a blank page.
 */
export type RoutePaths<R, Parent extends string = ''> = R extends readonly (infer E)[]
  ? PathsOfRoute<E, Parent>
  : never;

/**
 * Identity, but it captures the route array as literal types.
 *
 * Without `const` the paths widen to `string` the moment the array is written,
 * and every derived type collapses with them.
 */
export function defineRoutes<const R extends readonly RouteDefinition[]>(routes: R): R {
  return routes;
}

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

/** One root-to-leaf path through the route tree, ready to match against. */
export interface RouteBranch {
  readonly routes: readonly RouteDefinition[];
  /** Every route's segments, end to end. */
  readonly segments: readonly PatternSegment[];
  /** Where each route's own segments stop, as an index into `segments`. */
  readonly ends: readonly number[];
  /** The full pattern of each route, root to leaf. */
  readonly patterns: readonly string[];
  readonly ids: readonly string[];
}

function joinPattern(parent: string, own: string): string {
  const trimmed = trimSlashes(own);
  if (trimmed === '') return parent;
  return parent === '/' ? `/${trimmed}` : `${parent}/${trimmed}`;
}

/**
 * Expand the tree into every branch that can be matched, most specific first.
 *
 * A route with children is itself a branch only when it has an `index` child
 * or no children that could match — otherwise `/users` with children would
 * render `Users` with an empty hole where a child should be. Requiring an
 * explicit index route makes "what is shown at the parent's own URL" a thing
 * someone decided rather than a thing that happened.
 */
export function flattenRoutes(routes: readonly RouteDefinition[]): RouteBranch[] {
  const branches: RouteBranch[] = [];

  const walk = (
    definitions: readonly RouteDefinition[],
    parentRoutes: readonly RouteDefinition[],
    parentSegments: readonly PatternSegment[],
    parentEnds: readonly number[],
    parentPatterns: readonly string[],
    parentIds: readonly string[],
    parentPattern: string,
  ): void => {
    for (const route of definitions) {
      if (__VOLT_DEV__ && route.index && route.path) {
        throw new Error(
          `[volt] Route "${route.path}" is both an index route and a path. ` +
            `An index route is what renders at its parent's URL, so it has no path of its own.`,
        );
      }

      const own = route.index ? '' : (route.path ?? '');
      const segments = [...parentSegments, ...parsePattern(own)];
      const pattern = joinPattern(parentPattern, own);
      const routes = [...parentRoutes, route];
      const ends = [...parentEnds, segments.length];
      const patterns = [...parentPatterns, pattern];
      const ids = [...parentIds, route.id ?? pattern];

      if (route.children?.length) {
        walk(route.children, routes, segments, ends, patterns, ids, pattern);
        continue;
      }

      branches.push({ routes, segments, ends, patterns, ids });
    }
  };

  walk(routes, [], [], [], [], [], '/');

  // A stable sort keeps declaration order as the tiebreaker, so two patterns
  // that are equally specific resolve the way they were written.
  return branches.sort((a, b) => compareSpecificity(a.segments, b.segments));
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** One route in the branch a URL selected. */
export interface RouteMatch {
  readonly route: RouteDefinition;
  readonly id: string;
  /** The full pattern up to and including this route. */
  readonly pattern: string;
  /** The portion of the URL this route accounts for. */
  readonly pathname: string;
  /** This route's own parameters and every ancestor's. */
  readonly params: Params;
}

/**
 * Which routes render for this pathname, outermost first.
 *
 * Empty when nothing matches. That is deliberately not an error: a route table
 * with a `'*'` route handles it as a page, and one without renders nothing —
 * which is the honest outcome for a URL the application does not have.
 */
export function matchRoutes(
  branches: readonly RouteBranch[],
  pathname: string,
): readonly RouteMatch[] {
  const path = splitPathname(normalizePathname(pathname));

  for (const branch of branches) {
    const walked = walkSegments(branch.segments, path);
    if (!walked) continue;

    const matches: RouteMatch[] = [];
    let accumulated: Record<string, string> = {};
    let consumedSegments = 0;
    let consumedPath = 0;

    for (let i = 0; i < branch.routes.length; i++) {
      const end = branch.ends[i]!;

      // Every route sees its ancestors' parameters as well as its own, so a
      // leaf can read `:orgId` without the layout that captured it passing it
      // down through a prop nobody would maintain.
      const own: Record<string, string> = {};
      for (let s = consumedSegments; s < end; s++) {
        consumedPath += walked.consumed[s]!;
        const captured = walked.captures[s];
        if (captured) own[captured.name] = captured.value;
      }
      consumedSegments = end;
      accumulated = { ...accumulated, ...own };

      matches.push({
        route: branch.routes[i]!,
        id: branch.ids[i]!,
        pattern: branch.patterns[i]!,
        pathname: `/${path.slice(0, consumedPath).join('/')}`,
        params: accumulated,
      });
    }

    return matches;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Resolved lazy components, and the loads still in flight. */
const RESOLVED = new WeakMap<RouteDefinition, ComponentType<unknown>>();
const LOADING = new WeakMap<RouteDefinition, Promise<ComponentType<unknown>>>();

/**
 * The component a route renders, fetching it first if it is behind an import.
 *
 * A route's chunk is loaded as part of the navigation rather than after it, so
 * it arrives alongside the loader's data and the route paints once. That is
 * the difference from a lazy component in a template, which must render a
 * placeholder because it is already on screen when it discovers what it needs.
 */
export function loadRouteComponent(
  route: RouteDefinition,
): ComponentType<unknown> | Promise<ComponentType<unknown>> | null {
  const component = route.component;
  if (!component) return null;
  if (isComponent(component)) return component;

  const already = RESOLVED.get(route);
  if (already) return already;

  const inFlight = LOADING.get(route);
  if (inFlight) return inFlight;

  const load = (component as RouteComponentLoader)()
    .then((module) => {
      // A module namespace or the class itself, so both `import('./x.js')` and
      // a loader that already has the component work.
      const resolved =
        module && typeof module === 'object' && 'default' in module
          ? module.default
          : (module as ComponentType<unknown>);
      RESOLVED.set(route, resolved);
      return resolved;
    })
    .finally(() => {
      // Only the success is cached. A chunk that failed to load is usually a
      // deploy that removed it from under an open tab, and the next attempt
      // has to be allowed to succeed against the new one.
      LOADING.delete(route);
    });

  LOADING.set(route, load);
  return load;
}
