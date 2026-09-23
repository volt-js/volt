// @vitest-environment node
//
// Node's own module loader is part of what is being tested: a dependency Vite
// leaves external is imported by Node itself, with nothing substituted in it.

/**
 * An installed Volt package is compiled for the side that imports it.
 *
 * Volt's packages publish a `dist` that still reads `__VOLT_SERVER__` and
 * `__VOLT_DEV__`, because which side a module is on is the consuming build's
 * answer, not the package's. A bundler substitutes them — but only in a module
 * it compiles, and on a server Vite compiles only the project's own code: a
 * package in `node_modules` is left to Node, which reads the names as globals
 * that nothing defined. So a server render under `vite` threw on the first
 * gate it reached, and a server bundle built for Node shipped the same throw.
 *
 * Invisible from inside this repository, where every Volt package is linked
 * from the workspace and a linked package is one Vite compiles as source. So
 * the package here is installed the way a registry installs one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createServer, isRunnableDevEnvironment, type Rolldown } from 'vite';
import { volt } from '../src/index.js';

let root: string;

/** The test runner's own definition, set aside so a miss is the throw it would be under `vite`. */
const globals = globalThis as { __VOLT_SERVER__?: unknown; __VOLT_DEV__?: unknown };
const saved = { server: globals.__VOLT_SERVER__, dev: globals.__VOLT_DEV__ };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'volt-installed-'));
  const probe = join(root, 'node_modules/@voltdev/probe');
  await mkdir(probe, { recursive: true });
  await writeFile(
    join(probe, 'package.json'),
    JSON.stringify({ name: '@voltdev/probe', type: 'module', exports: './index.js' }),
  );
  await writeFile(
    join(probe, 'index.js'),
    "export const side = __VOLT_SERVER__ ? 'server' : 'client';\n" +
      "export const words = __VOLT_DEV__ ? 'dev' : 'production';\n",
  );
  await writeFile(
    join(root, 'server.js'),
    "export { side, words } from '@voltdev/probe';\n",
  );
  delete globals.__VOLT_SERVER__;
  delete globals.__VOLT_DEV__;
});

afterAll(async () => {
  globals.__VOLT_SERVER__ = saved.server;
  globals.__VOLT_DEV__ = saved.dev;
  await rm(root, { recursive: true, force: true });
});

describe('an installed Volt package on a server', { timeout: 60_000 }, () => {
  it('is compiled as a server module under `vite`', async () => {
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [volt()],
      server: { middlewareMode: true, ws: false },
    });
    try {
      const ssr = server.environments['ssr']!;
      if (!isRunnableDevEnvironment(ssr)) throw new Error('the ssr environment cannot run modules');
      const probe = (await ssr.runner.import('/server.js')) as { side: string; words: string };
      expect(probe).toMatchObject({ side: 'server', words: 'dev' });
    } finally {
      await server.close();
    }
  });

  it('is compiled into a server bundle, rather than left for Node to load', async () => {
    const result = (await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [volt()],
      build: { ssr: join(root, 'server.js'), write: false, minify: false },
    })) as Rolldown.RolldownOutput | Rolldown.RolldownOutput[];
    const code = (Array.isArray(result) ? result[0]! : result).output[0].code;

    // Not imported: a bundle that imports it is one Node has to load it for.
    expect(code).not.toMatch(/(?:from|import)\s*["']@voltdev\/probe["']/);
    const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
    const probe = (await import(/* @vite-ignore */ url)) as { side: string; words: string };
    expect(probe).toMatchObject({ side: 'server', words: 'production' });
  });
});
