/**
 * The project `dev-server.test.ts` and `server-build.test.ts` drive: a route
 * table, a root with `:outlet`, a layout with another, and a `@Server()` method
 * a route's loader calls.
 *
 * Not a test file, so the runner does not collect it. It holds what both tests
 * have to agree on with the plugin, derived the way the plugin derives it.
 */
import { resolve } from 'node:path';
import type { Alias } from 'vite';
import { endpointId, endpointKey } from '../src/server-functions.js';

export const FIXTURE = resolve(import.meta.dirname, 'fixtures/server-render');

const PACKAGES = resolve(import.meta.dirname, '../..');
const source = (path: string): string => resolve(PACKAGES, path);

/**
 * The workspace's own packages, by source.
 *
 * Exact matches, because `@voltdev/core` written as a prefix would also catch
 * `@voltdev/core/server` and send it to the index. Sources rather than `dist`,
 * so a test never checks a build made before the change under test.
 */
export const alias: Alias[] = [
  ['@voltdev/core/server', 'core/src/server.ts'],
  ['@voltdev/core/runtime', 'core/src/runtime.ts'],
  ['@voltdev/core/jit', 'core/src/jit.ts'],
  ['@voltdev/core', 'core/src/index.ts'],
  ['@voltdev/reactivity/signals', 'reactivity/src/signals.ts'],
  ['@voltdev/reactivity', 'reactivity/src/index.ts'],
  ['@voltdev/router', 'router/src/index.ts'],
  ['@voltdev/server/client', 'server/src/client.ts'],
  ['@voltdev/server', 'server/src/index.ts'],
  ['@voltdev/compiler', 'compiler/src/index.ts'],
].map(([name, path]) => ({
  find: new RegExp(`^${name!}$`),
  replacement: source(path!),
}));

/** Where `currentPlan` answers, relative to a project at `root`. */
export function planEndpoint(root: string = FIXTURE): string {
  return endpointId(
    endpointKey({ id: resolve(root, 'src/api.ts'), root, className: 'Api', method: 'currentPlan' }),
  );
}

/** The identity a page's mount point carries, or null for a page with no mark. */
export function markOf(html: string): string | null {
  return /<div id="app" data-volt-build="([^"]+)"/.exec(html)?.[1] ?? null;
}

/** The identity a client compares the mark against, read out of its code. */
export function claimOf(code: string): string | null {
  return /getAttribute\([^)]*\)\s*===\s*["'`]([^"'`]+)["'`]/.exec(code)?.[1] ?? null;
}
