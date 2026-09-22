/**
 * The router a component finds, rather than the one it imported.
 *
 * A module-level `export const router = createRouter(...)` is one router per
 * *process*, which is right in a browser and wrong everywhere else: a server
 * answers many requests at once, each at its own URL with its own loader data,
 * and a route component reading an imported router would read whichever
 * request happened to resolve last. The same is true of a test that renders
 * two pages, and of anything that renders a page inside another.
 *
 * So the router is provided on a scope and found by walking up from wherever
 * it is asked for — once at boot in a browser, once per request on a server.
 * That is exactly what `provideQueryClient` / `useQueryClient` do for the
 * cache, and deliberately so: an application already knows the shape.
 */

import { createContext, provideContext, useContext } from '@voltdev/core';
import type { Router } from './router.js';

/**
 * The key, which is all this module holds.
 *
 * A key carries no value — every value lives on the scope it was provided to —
 * so two routers in one process share nothing by sharing it, any more than two
 * objects share a field by both having one. State belongs to a router
 * instance; what is here is a name.
 */
const RouterContext = createContext<Router<string> | null>(null, 'volt.router');

/**
 * Put a router in scope for everything created under it, and hand it back:
 *
 *   mount(App, host, {
 *     setup: () => {
 *       provideOutlet(provideRouter(router).outletAt(0));
 *     },
 *   });
 *
 * Inside `mount`'s `setup`, `hydrate`'s, or a server render's — the scope a
 * render runs in is created in there, so a provider installed outside it is
 * installed on nothing.
 */
export function provideRouter<Paths extends string>(router: Router<Paths>): Router<Paths> {
  // Through `unknown`, because the two are related in the direction that
  // matters and not in the one the compiler checks: a router for a narrower
  // set of paths accepts narrower parameter names than a `Router<string>`
  // promises to. What comes back out is narrowed again by the caller of
  // `useRouter`, which is the only side that knows the table.
  provideContext(RouterContext, router as unknown as Router<string>);
  return router;
}

/**
 * The router in scope.
 *
 *   class Nav {
 *     router = useRouter<typeof paths>();
 *     here = () => this.router.pathname();
 *   }
 *
 * Call it in a field initializer, which is where a component is still being
 * constructed and therefore still inside its own scope.
 *
 * Throws rather than returning null, because every answer a missing router
 * could give is a lie: an empty location is a page that renders as though it
 * were nowhere.
 */
export function useRouter<Paths extends string = string>(): Router<Paths> {
  const router = useContext(RouterContext);
  if (!router) {
    throw new Error(
      __VOLT_DEV__
        ? '[volt] No router in scope. Call provideRouter(router) where the application starts ' +
          '— in the `setup` of mount(), hydrate() or a server render, once at boot in a ' +
          'browser and once per request on a server — and call useRouter() in a field ' +
          'initializer, where the component is still being constructed.'
        : '[volt] no router in scope',
    );
  }
  return router as unknown as Router<Paths>;
}
