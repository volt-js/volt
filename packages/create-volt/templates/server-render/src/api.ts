import { Server, guard } from '@voltdev/server';

/**
 * A server function, called from the browser as if it were local.
 *
 * The plugin rewrites the call site into a POST to the same origin and leaves
 * the body on the server, so nothing in this file reaches a bundle. `serverRender`
 * mounts the handler for it at the same base the transform posts to — which is
 * the wiring this template exists to demonstrate.
 */
export class Api {
  // An instance method, not a static one. The handler constructs the class
  // once per call, so nothing a method assigns to `this` outlives the request
  // that assigned it — and the build refuses a static member for that reason.
  @Server()
  async currentPlan(): Promise<string> {
    // First statement, and awaited. The request is reachable synchronously
    // only: once a body has awaited anything, another call may be the one in
    // flight, and a guard reading the request then would authorize against
    // somebody else's cookies. The build enforces the position; this comment
    // is why.
    await guard(session);
    return 'Team';
  }
}

/**
 * Who is asking, or nothing.
 *
 * A real one reads a cookie and looks up a session. Returning `null` is how a
 * guard refuses — `guard` turns that into a 401 before the body runs, so the
 * body below can be written as though the caller is always allowed.
 */
function session(request: Request): { id: string } | null {
  return request.headers.has('cookie') ? { id: 'demo' } : { id: 'anonymous' };
}

const api = new Api();

export const currentPlan = (): Promise<string> => api.currentPlan();
