/**
 * What each half of a server function is really shipped, measured on built
 * output rather than on the pass's return value.
 *
 * Source-level assertions cannot answer the question this feature is judged
 * on. A transform can strip a body perfectly and still leave the module that
 * body reached for in the client graph — imported, evaluated, and in the
 * bundle with its connection string in it. So the fixture app is built the way
 * a project is built, through the plugin, once for each environment, and the
 * assertions are on the bytes that come out.
 *
 * The client bundle is then executed against a fetch that records rather than
 * sends, because "the stub posts to the right id" is a claim about a request
 * that was actually made, and reading the URL out of the source is reading the
 * assertion back to itself.
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { RollupOutput } from 'rollup';
import { volt } from '../src/index.js';
import { endpointId, endpointKey } from '../src/server-functions.js';

const ROOT = resolve(import.meta.dirname, '..');
const APP = resolve(import.meta.dirname, 'fixtures/server-app');
const ENTRY = resolve(APP, 'main.ts');
const SERVER_ENTRY = resolve(APP, 'server.ts');
const SERVER_SRC = resolve(import.meta.dirname, '../../server/src');

const alias = {
  '@voltdev/server/client': resolve(SERVER_SRC, 'client.ts'),
  '@voltdev/server': resolve(SERVER_SRC, 'index.ts'),
};

/** What the two halves have to agree on, derived the way the pass derives it. */
const CREATE_KEY = endpointKey({
  id: resolve(APP, 'todos.ts'),
  root: ROOT,
  className: 'Todos',
  method: 'create',
});
const CREATE = endpointId(CREATE_KEY);

async function bundle(side: 'client' | 'server'): Promise<string> {
  const result = (await build({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    plugins: [volt()],
    resolve: { alias },
    // Aliased to sources inside this repository, so nothing here is a real
    // dependency to leave external.
    ssr: { noExternal: true },
    build: {
      write: false,
      target: 'esnext',
      // Names have to survive for an assertion to be able to say what is gone.
      minify: false,
      ...(side === 'server'
        ? { ssr: SERVER_ENTRY, rollupOptions: { output: { format: 'es' as const } } }
        : { lib: { entry: ENTRY, formats: ['es' as const], fileName: 'app' } }),
    },
  })) as RollupOutput | RollupOutput[];

  // One environment and one format, so there is one bundle either way; Vite
  // wraps it in an array for a library build and does not for an SSR one.
  const output = Array.isArray(result) ? result[0]!.output : result.output;
  return output[0].code;
}

const built = Promise.all([bundle('client'), bundle('server')]);

/** Run a built bundle, without writing it anywhere. */
async function load(code: string): Promise<Record<string, unknown>> {
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

describe('what the browser is shipped', { timeout: 120_000 }, () => {
  it('has no trace of the body, nor of what the body reached for', async () => {
    const [client] = await built;

    // The body's own statements.
    expect(client).not.toContain('db.insert');
    expect(client).not.toContain('guard(session)');
    // And the two server-only modules it held open, whole. This is the half a
    // source-level assertion cannot see: an import left behind keeps the
    // module in the graph however thoroughly the body was stripped.
    expect(client).not.toContain('sk_live_never_ships_to_a_browser');
    expect(client).not.toContain('postgres://');
    expect(client).not.toContain('SIGNING_KEY');
  });

  it('is missing that key because the module went, not because a bundler folded it', async () => {
    // The same assertion run against the other half. Without this one, a
    // marker the minifier happened to inline somewhere else would read as a
    // module successfully pruned, and the test above would pass for a reason
    // that has nothing to do with the feature.
    const [, server] = await built;
    expect(server).toContain('sk_live_never_ships_to_a_browser');
  });

  it('has none of the server half of the package either', async () => {
    const [client] = await built;

    // The client entry is separate from `index.ts` precisely so that a page
    // does not pull in the handler, the registry and the guards next to a body
    // that was stripped so it would not be there.
    expect(client).not.toContain('createHandler');
    expect(client).not.toContain('registerServerFunction');
    expect(client).not.toContain('lookupServerFunction');
    // Two sentences only `handler.ts` contains, so their absence is the whole
    // module's absence rather than one export's.
    expect(client).not.toContain('Payload Too Large');
    expect(client).not.toContain('Expected { args: [...] }');
  });

  it('carries the stub and the endpoint id it posts to', async () => {
    const [client] = await built;
    expect(client).toContain(CREATE);
    expect(client).toContain('callServer');
  });
});

describe('what the built stub does when it runs', { timeout: 120_000 }, () => {
  /** The call the bundle made, with nothing sent anywhere. */
  async function callThrough(
    answer: unknown,
  ): Promise<{ request: Request; body: string; result: unknown }> {
    const [client] = await built;
    const app = await load(client);

    let captured: Request | undefined;
    let body = '';
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string, init: RequestInit) => {
      captured = new Request(new URL(input, 'https://app.test').toString(), init);
      body = String(init.body);
      return new Response(JSON.stringify({ value: answer }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await (app.create as (text: string) => Promise<unknown>)('write tests');
      return { request: captured!, body, result };
    } finally {
      globalThis.fetch = original;
    }
  }

  it('posts to the generated endpoint id, and to nothing else', async () => {
    const { request } = await callThrough({ id: 'todo_1' });

    expect(new URL(request.url).pathname).toBe(`/_volt/${CREATE}`);
    expect(request.method).toBe('POST');
  });

  it('sends the arguments the local-looking call was given', async () => {
    const { body } = await callThrough({ id: 'todo_1' });
    expect(JSON.parse(body)).toEqual({ args: ['write tests'] });
  });

  it('sends the header that a cross-site form cannot', async () => {
    const { request } = await callThrough({ id: 'todo_1' });

    // Neither of these is decoration. A form can set neither, and a fetch that
    // sets either forces a preflight the handler never answers — which is what
    // keeps a cookie-authenticated endpoint off any page on the internet.
    expect(request.headers.get('x-volt-call')).toBe('1');
    expect(request.headers.get('content-type')).toBe('application/json');
  });

  it('returns what the endpoint answered, as though the call had been local', async () => {
    const { result } = await callThrough({ id: 'todo_7' });
    expect(result).toEqual({ id: 'todo_7' });
  });
});

describe('what the server is shipped', { timeout: 120_000 }, () => {
  it('keeps the body, and registers it under the id the client posts to', async () => {
    const [, server] = await built;

    expect(server).toContain('await guard(session)');
    expect(server).toContain('db.insert');
    expect(server).toContain(CREATE);
    expect(server).toContain(CREATE_KEY);
  });

  it('answers that id with the real method, once the module is loaded', async () => {
    const [, server] = await built;
    const module = await load(server);
    const lookup = module.lookupServerFunction as
      | ((id: string) => { name: string } | undefined)
      | undefined;

    // Only reachable if the static block ran, which is the point of emitting
    // the registration into one: importing the class is what registers it.
    expect(lookup?.(CREATE)?.name).toBe('Todos.create');
  });
});
