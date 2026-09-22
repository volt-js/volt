/**
 * `:outlet` — where a child route renders.
 *
 * A route's branch is nested: a layout renders, and inside it renders the
 * route below it, and inside that the one below that. Until now the router
 * arranged that afterwards, by finding `[data-volt-outlet]` in what a layout
 * had mounted and mounting the child into it. That works in a browser and
 * cannot work anywhere else — a server writes bytes in one pass and never goes
 * back, so a page rendered that way arrived as a shell with an empty hole in
 * it.
 *
 * So the outlet is a place in a template, and what fills it is whatever the
 * enclosing render provided. The router provides one render per depth; the
 * renderer walks it like any other hole. That single change is what lets a
 * server write the whole branch in order, and a client claim it the way it
 * claims everything else.
 *
 * Nothing here knows about routes. A context and a call: the router is one
 * caller, and a component that renders another component's content the same
 * way is another.
 */

import { createContext, provideContext, useContext } from '@voltdev/reactivity';

/**
 * What an outlet renders.
 *
 * On a client it returns what to insert — a node, an accessor over one, or
 * null for nothing. On a server it writes into the writer it is handed and
 * returns nothing, because the bytes are the return value there.
 */
export type OutletRender = (out?: unknown) => unknown;

/**
 * Annotated pure so an application that routes nothing drops the module
 * whole: a call at module scope is a side effect as far as a bundler knows,
 * and this one is a symbol and an object.
 */
const OutletContext = /* @__PURE__ */ createContext<OutletRender | null>(null, 'volt.outlet');

/**
 * Say what the next `:outlet` below here renders.
 *
 * Scoped, so it reaches every outlet in the subtree being rendered and no
 * further: a router providing depth `n + 1` while depth `n` renders is
 * providing it to that render alone, and two requests rendering at once share
 * nothing.
 */
export function provideOutlet(render: OutletRender | null): void {
  provideContext(OutletContext, render);
}

/** Called by compiled templates for `:outlet`. */
export function outlet(out?: unknown): unknown {
  const render = useContext(OutletContext);
  if (!render) return null;
  return render(out);
}
