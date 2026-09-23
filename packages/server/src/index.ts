/**
 * @voltdev/server — server functions.
 *
 * A `@Server()` method runs on the server and is called from the client as
 * though it were local. The build writes both halves: the client keeps a stub
 * that posts to a generated endpoint id, the server keeps the real method and
 * registers it under that id.
 *
 *   export class Todos {
 *     @Server()
 *     async create(text: string): Promise<{ id: string }> {
 *       const user = await guard(session);
 *       return db.todos.insert({ text, userId: user.id });
 *     }
 *   }
 *
 * `todos.create(text)` reads exactly like a local call, and that is the
 * problem the rest of this package is about: it is a public HTTP endpoint,
 * reachable by anyone with curl. Three things make that impossible to ignore
 * rather than merely documented:
 *
 *   - the build refuses a `@Server()` body that does not reach a guard, the
 *     way the template compiler refuses `:for` without `:key`. Saying
 *     `@Server({ public: true })` is how a method is declared open.
 *   - authentication is read from the request through `guard`, never from a
 *     parameter, because a parameter is whatever the caller posted.
 *   - return values are serialized, so a database row does not cross the
 *     boundary unless its type says it may.
 *
 * This entry is the server's. A browser reaches `@voltdev/server/client`, and
 * only through generated code.
 */

export { Server } from './decorator.js';
export { guard, withRequest } from './guard.js';
export { createHandler, isServerCall, DEFAULT_BASE } from './handler.js';
export type { HandlerOptions, ErrorContext } from './handler.js';
export { ServerError, Unauthorized, Forbidden, BadRequest } from './errors.js';
export type { ServerErrorOptions } from './errors.js';
export { registerServerFunction, lookupServerFunction, serverFunctions } from './registry.js';
export type { ServerFunction } from './registry.js';
export { toWire, fromWire, WireError } from './serialize.js';
export type { Serializable, ServerOptions, ServerDecorator, ServerFunctionRefused } from './types.js';
