/**
 * @voltdev/router
 *
 * Routing for Volt: nested routes and layouts, parameters typed from the route
 * table, and a navigation that finishes loading before anything on screen
 * moves.
 *
 *   const routes = defineRoutes([
 *     {
 *       path: '/',
 *       component: Shell,
 *       children: [
 *         { index: true, component: Home },
 *         {
 *           path: 'users',
 *           component: UsersLayout,
 *           children: [
 *             { index: true, component: UserList },
 *             {
 *               path: ':id',
 *               component: () => import('./user.js'),
 *               loader: ({ params, signal }: LoaderArgs<'/users/:id'>) =>
 *                 fetch(`/api/users/${params.id}`, { signal }).then((r) => r.json()),
 *             },
 *           ],
 *         },
 *       ],
 *     },
 *   ]);
 *
 *   export const router = createRouter({ routes });
 *   await router.start(document.querySelector('#app')!);
 *
 * A layout renders its child wherever it puts an outlet:
 *
 *   <nav>…</nav>
 *   <div data-volt-outlet></div>
 *
 * and a route reads its own loader's result and its own parameters:
 *
 *   class UserPage {
 *     user = routeData<User>();
 *     id = () => router.param('id');
 *   }
 *
 * Links are ordinary anchors. `<a href="/users/7">` is a real link with a real
 * href — it previews in the status bar, opens in a new tab on middle-click,
 * and is followed by a crawler — and the router intercepts the plain
 * left-click that would otherwise reload the page.
 *
 * There is no `lazy()` here and none is imported from core. Core's `lazy()`
 * binds a chunk to a template selector and renders a fallback while it
 * arrives, which is right for a component that is already on screen when it
 * discovers it needs loading. A route is not on screen yet: its chunk and its
 * loader are two requests that should go out together and land before the
 * route paints at all, which is what `loadRouteComponent` does. Exporting
 * core's pair for the router's benefit would have widened core's public API
 * for a caller that then does not use it.
 */

export {
  createRouter,
  routeData,
  OUTLET_ATTRIBUTE,
  type Blocker,
  type HrefOptions,
  type NavigateOptions,
  type NavigationMode,
  type NavigationOutcome,
  type NavigationResult,
  type RouteLocation,
  type Router,
  type RouterOptions,
  type Transition,
} from './router.js';

export {
  defineRoutes,
  flattenRoutes,
  matchRoutes,
  routeMode,
  type RenderMode,
  type LoaderArgs,
  type RevalidateArgs,
  type RouteBranch,
  type RouteComponent,
  type RouteComponentLoader,
  type RouteDefinition,
  type RouteMatch,
  type RoutePaths,
} from './routes.js';

export {
  findAnchor,
  isRoutableAnchor,
  shouldInterceptClick,
  NO_ROUTER_ATTRIBUTE,
} from './link.js';

// `flattenRoutes` and `matchRoutes` are exported for the caller that has a URL
// and no DOM — a server deciding what a request resolves to, a test asserting
// on a table. Everything below them is this package's plumbing.
export {
  buildPath,
  normalizePathname,
  type ParamInput,
  type ParamNames,
  type Params,
  type PathParams,
} from './path.js';
