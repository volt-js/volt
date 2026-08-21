import { createQueryClient } from '@voltdev/query';

/**
 * The query cache, and why it is passed to each query by hand.
 *
 * The tidier form is `provideQueryClient` in the layout, which puts the cache
 * in scope for everything below it. That does not work here: the router
 * mounts every route as its own detached root, so a provider in the layout is
 * not in scope for the routes rendering inside its outlet. Passing `client`
 * explicitly is what actually reaches them.
 *
 * One module-level cache is right for an application that only ever runs in a
 * browser, where there is one user and one cache. Rendering on a server would
 * need one per request — two requests sharing this would answer the second
 * with the first user's data.
 */
export const cache = createQueryClient();
