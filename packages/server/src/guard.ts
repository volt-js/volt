/**
 * Where a server function gets its identity from.
 *
 * The rule is the roadmap's second mitigation, and it is absolute:
 * **authentication is read from the request, never from a parameter**, because
 * a parameter is whatever the caller posted. `guard` is the only way a body
 * reaches the `Request`, so a guard cannot accidentally be handed a user id
 * from the argument list — and the build refuses a guard call whose arguments
 * mention one anyway.
 *
 * The request is reachable *synchronously only*. There is no
 * `AsyncLocalStorage` underneath this, deliberately: it is a `node:` builtin
 * and Volt runs on edge runtimes that have none — the same constraint that
 * shapes the request scope in `@voltdev/reactivity`. What replaces it is the
 * same rule stated for a different lifetime: the handler makes the request
 * visible for the length of the invoked method's synchronous prologue and
 * takes it away again, so the only place a guard can read it is before the
 * body has awaited anything. Which is where a guard belongs regardless: work
 * that runs before authorization is work an unauthorized caller has already
 * caused.
 */

import { Unauthorized } from './errors.js';

let activeRequest: Request | null = null;

/**
 * @internal Make `request` visible to `guard` for the duration of `run`.
 *
 * Restores rather than clears, because a server function is free to call
 * another one directly and the inner call must not leave the outer without a
 * request.
 */
export function withRequest<T>(request: Request, run: () => T): T {
  const previous = activeRequest;
  activeRequest = request;
  try {
    return run();
  } finally {
    activeRequest = previous;
  }
}

/**
 * Authorize this call, from the request that made it.
 *
 * `check` is handed the `Request` and returns whoever is calling. Returning
 * `null`, `undefined` or `false` denies the call — the closed direction, so a
 * session lookup that misses is a refusal rather than an `undefined` user
 * flowing into the body. Throwing works too, and a thrown `ServerError` keeps
 * its status.
 */
export function guard<T>(
  check: (request: Request) => T | Promise<T>,
): Promise<Exclude<Awaited<T>, null | undefined | false>> {
  const request = activeRequest;
  if (request === null) {
    throw new Error(
      '[volt] guard() was called outside the first statement of a @Server() method.\n' +
        '  The request is reachable synchronously only: once a body has awaited\n' +
        '  anything, another call may be the one in flight, and a guard reading\n' +
        '  the request then would authorize against another caller\'s cookies.\n' +
        '  Put the guard first, and await it:\n' +
        '    @Server()\n' +
        '    async create(text: string): Promise<{ id: string }> {\n' +
        '      const user = await guard(session);\n' +
        '      ...',
    );
  }
  return Promise.resolve(check(request)).then((subject) => {
    if (subject === null || subject === undefined || subject === false) {
      throw new Unauthorized();
    }
    return subject as Exclude<Awaited<T>, null | undefined | false>;
  });
}
