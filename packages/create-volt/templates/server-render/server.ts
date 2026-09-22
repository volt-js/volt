/**
 * The deployable entry: a `(Request) => Promise<Response>` and nothing else.
 *
 * Everything it does comes from `virtual:volt/server`, which the plugin
 * generates into this project's own module graph — route matching, the
 * per-route mode, the state payload, the server-function handler. This file
 * exists to give it the shell and to be the shape a host expects.
 *
 * There is no `node:` import here on purpose. That is what makes this
 * deployable to an edge runtime, and `renderPath` is the build check that
 * keeps it true as the application grows.
 */
import { handler, setShell } from 'virtual:volt/server';
import shell from './index.html?raw';

setShell(shell);

export default { fetch: handler };
export { handler };
