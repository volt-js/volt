/**
 * Stands in for `@voltdev/core/server`.
 *
 * The check keys off the *name* a module imports — importing a renderer is
 * what makes a module a render entry — so a stub with the right exports asks
 * the question the real package would, and the fixture builds in a fraction of
 * the time without pulling the reactivity graph in behind it.
 */

export function renderToStaticMarkup(markup: string): string {
  return markup;
}

export function renderToString(markup: string): string {
  return `${markup}<!--state-->`;
}
