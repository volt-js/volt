/**
 * The deployable entry: a `(Request) => Promise<Response>` and nothing else.
 *
 * Everything it does comes from `virtual:volt/server`, which the plugin
 * generates into this project's own module graph — route matching, the
 * per-route mode, the page the render is written into, the state payload, the
 * server-function handler. This file exists to be the shape a host expects,
 * and it is the same file in both places it runs: `pnpm dev` answers requests
 * with it, and `pnpm build` builds it into `dist/server/server.js`.
 *
 * There is no `node:` import here on purpose. That is what makes this
 * deployable to an edge runtime, and `renderPath` is the build check that
 * keeps it true as the application grows.
 */
import { handler } from 'virtual:volt/server';

export default { fetch: handler };
export { handler };
