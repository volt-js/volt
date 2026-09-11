/**
 * A component built for the server through the plugin, and rendered.
 *
 * In a server build the plugin lowers each `@Component` to a
 * `defineComponent` call imported from `@voltdev/core/server`, and that entry
 * did not export it — so every server build of a decorated component failed
 * with a missing export, and no test noticed, because every server-rendering
 * test compiled its templates at runtime or built no component at all. This
 * one builds the way a project builds: a `templateUrl` component, the plugin,
 * the server environment, and the bytes run.
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { RollupOutput } from 'rollup';
import { volt } from '../src/index.js';

const ROOT = resolve(import.meta.dirname, '..');
const ENTRY = resolve(import.meta.dirname, 'fixtures/ssr-component/server.ts');
const PACKAGES = resolve(import.meta.dirname, '../..');

// Exact matches, to the sources: an entry that matched by prefix would send
// `@voltdev/core/signals`, which the plugin also writes, to `index.ts/signals`.
const alias = [
  ['@voltdev/core/server', 'core/src/server.ts'],
  ['@voltdev/core/runtime', 'core/src/runtime.ts'],
  ['@voltdev/core/signals', 'core/src/signals.ts'],
  ['@voltdev/core', 'core/src/index.ts'],
  ['@voltdev/reactivity/signals', 'reactivity/src/signals.ts'],
  ['@voltdev/reactivity', 'reactivity/src/index.ts'],
].map(([name, file]) => ({ find: new RegExp(`^${name}$`), replacement: resolve(PACKAGES, file!) }));

async function serverBundle(): Promise<string> {
  const result = (await build({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    plugins: [volt()],
    resolve: { alias },
    ssr: { noExternal: true },
    build: {
      write: false,
      target: 'esnext',
      minify: false,
      ssr: ENTRY,
      rollupOptions: { output: { format: 'es' as const } },
    },
  })) as RollupOutput | RollupOutput[];
  const output = Array.isArray(result) ? result[0]!.output : result.output;
  return output[0].code;
}

describe('a component built for the server', { timeout: 120_000 }, () => {
  it('builds, and renders what its template says', async () => {
    const code = await serverBundle();
    const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
    const app = (await import(/* @vite-ignore */ url)) as {
      renderToString: (component: unknown) => Promise<{ html: string; status: number }>;
      Greeting: unknown;
    };

    const page = await app.renderToString(app.Greeting);
    expect(page.status).toBe(200);
    expect(page.html).toContain('Hello, world.');
  });
});
