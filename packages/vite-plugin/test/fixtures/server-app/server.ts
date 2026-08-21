/**
 * The server entry: it imports the class, which is what registers it.
 *
 * Nothing calls `registerServerFunction` here. Importing `Todos` runs the
 * static block the build put in its body, and that is the whole wiring — a
 * class no server entry reaches registers nothing, and the endpoint table is
 * exactly the reachable server functions.
 */

import { createHandler, lookupServerFunction } from '@voltdev/server';
import './todos.js';

export { lookupServerFunction };
export const handler = createHandler();
