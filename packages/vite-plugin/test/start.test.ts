/**
 * `start`: the wiring, and the promise that it stays a choice.
 *
 * Two claims, and the second is a roadmap entry of its own. The mode has to
 * wire the router, the renderer and the server functions together so an
 * application does not — and it has to be *off* until somebody asks, because
 * CSR is first-class here and a turnkey mode that quietly made every project a
 * server project would take that back.
 *
 * The generated modules are asserted by compiling them, not by matching
 * strings: a module that mentions `renderToString` and does not parse is not
 * wiring anything.
 */
import { describe, expect, it } from 'vitest';
import { build as esbuildBuild, transformSync } from 'esbuild';
import { resolve } from 'node:path';
import { volt } from '../src/index.js';
import { CLIENT_ID, SERVER_ID, clientModule, resolveStart, serverModule } from '../src/start.js';

type Loader = { resolveId?: unknown; load?: unknown; name: string };

/** The plugin in the array that serves virtual modules. */
function loaders(plugins: readonly unknown[]): Loader[] {
  return (plugins as Loader[]).filter((p) => typeof p.load === 'function');
}

async function loadVirtual(plugins: readonly unknown[], id: string): Promise<string | null> {
  for (const plugin of loaders(plugins)) {
    const resolve = plugin.resolveId as (this: unknown, id: string) => string | null;
    const resolved = resolve.call({}, id);
    if (!resolved) continue;
    const load = plugin.load as (this: unknown, id: string) => Promise<string | null>;
    const code = await load.call({}, resolved);
    if (code) return code;
  }
  return null;
}

describe('staying a choice', () => {
  it('serves nothing at all unless a project asked for it', async () => {
    // The entry this proves is "It must stay opt-in", and the way it fails is
    // by someone giving `start` a default. Then this goes red.
    const plugins = volt();
    expect(await loadVirtual(plugins, SERVER_ID)).toBeNull();
    expect(await loadVirtual(plugins, CLIENT_ID)).toBeNull();
  });

  // The other half of the same promise — that a project which never asked for
  // a server does not get a client emit compiled to claim markup that will not
  // be there — is asserted in `plugin.test.ts`, against the compiled output,
  // beside the rest of the emit-selection tests. It belongs with them: the
  // claim is about which of the three emits a build gets, and that file is
  // where the three are told apart.

});

describe('what start generates', () => {
  const start = resolveStart(true);

  it('produces a server module that parses and wires the four pieces', () => {
    const code = serverModule(start);
    expect(() => transformSync(code, { loader: 'js' })).not.toThrow();

    // The four the entry names, each by the import that brings it in.
    expect(code).toContain("from '@voltdev/router'");
    expect(code).toContain("from '@voltdev/core/server'");
    expect(code).toContain("from '@voltdev/server'");
    expect(code).toContain(start.routes);
  });

  it('is a Request in and a Response out, which is what edge means', () => {
    // Not decoration: the roadmap's edge mode falls out of this shape, and a
    // handler that took a Node request or reached for a builtin would not be
    // deployable to the runtime the check in `render-path.ts` exists for.
    const code = serverModule(start);
    expect(code).toContain('export async function handler(request)');
    expect(code).toContain('new URL(request.url)');
    expect(code).not.toContain('node:');
    expect(code).not.toContain('require(');
  });

  it('answers a URL the table does not match with the shell and a 404', () => {
    const code = serverModule(start);
    // The application's own not-found route is a route, so it still needs the
    // page — but a 200 for a URL that does not exist would be worse than a 404
    // with a page that says so.
    expect(code).toContain("return page('', '', '', 404)");
  });

  it('sends a server-function call to the function handler, not the renderer', () => {
    // A POST to the function base is not a navigation and the router knows
    // nothing about its path, so it has to be answered before the table is
    // consulted — otherwise every server call renders a 404 page at the
    // caller and the application appears to have no server functions at all.
    const code = serverModule(start);
    const base = code.indexOf(`url.pathname.startsWith(${JSON.stringify(start.base)})`);
    const match = code.indexOf('matchRoutes(');
    expect(base, 'the base check is not there').toBeGreaterThan(-1);
    expect(base, 'the table is consulted first').toBeLessThan(match);
    expect(code).toContain('return functions(request)');
  });

  it('sends a csr route its shell without rendering it', () => {
    const code = serverModule(start);
    expect(code).toContain("if (mode === 'csr') return page('', '', '', 200)");
  });

  it('produces a client module that parses and mounts', () => {
    const code = clientModule(start);
    expect(() => transformSync(code, { loader: 'js' })).not.toThrow();
    expect(code).toContain("from '@voltdev/core'");
    expect(code).toContain(start.root);
  });
});

describe('what a project supplies', () => {
  it('defaults to a route table and a root it can override', () => {
    expect(resolveStart(true)).toMatchObject({
      routes: '/src/routes.js',
      root: '/src/app.js',
      defaultMode: 'ssr',
    });
    expect(resolveStart({ routes: '/app/table.js', defaultMode: 'csr' })).toMatchObject({
      routes: '/app/table.js',
      defaultMode: 'csr',
    });
  });

  it('serves both halves once it is asked', async () => {
    const plugins = volt({ start: true });
    const server = await loadVirtual(plugins, SERVER_ID);
    const client = await loadVirtual(plugins, CLIENT_ID);
    expect(server).toContain('export async function handler');
    expect(client).toContain('mount(App, host');
  });
});

/**
 * The generated server module, actually running — against the real router.
 *
 * An earlier version of this stubbed `@voltdev/router` as well, with a
 * `matchRoutes` that returned `{ branch }`. The real one returns an array of
 * matches, so the stub agreed with the code and neither agreed with the
 * router: the handler read `.branch` off an array, and every page request
 * threw. Every test here passed. The router is therefore the real
 * `routes.ts`, over a real route table, and only the renderer, the function
 * handler and the hydration answer are stubbed — the handler's own decisions
 * are what is under test, and those three are its inputs.
 */
const ROUTER = resolve(import.meta.dirname, '../../router/src/routes.ts');

/** A route table that exercises every branch of the handler. */
const TABLE = `
  const component = (index) => { const C = class {}; C.index = index; return C; };
  export const routes = [
    {
      path: '/',
      component: component(0),
      children: [
        { index: true, component: component(1) },
        { path: 'about', component: component(1) },
        { path: 'pricing', component: component(1), mode: 'ssr' },
        { path: 'dashboard', component: component(1), mode: 'csr' },
      ],
    },
    { path: '/bare' },
  ];
`;

async function handlerFor(
  overrides: {
    /** Whether each component is interactive, by position: 0 is the layout, 1 the page. */
    interactive?: readonly boolean[];
    render?: () => unknown;
  } = {},
): Promise<{
  handler: (request: Request) => Promise<Response>;
  setShell: (html: string) => void;
  calls: string[];
}> {
  const calls: string[] = [];
  const start = resolveStart(true);

  const stubs: Record<string, string> = {
    '@voltdev/core/server': 'export const renderToString = async () => (globalThis.__render());',
    '@voltdev/core': `
      export const isComponent = (value) => typeof value === 'function';
      export const needsHydration = (component) => globalThis.__needsHydration(component);
    `,
    '@voltdev/server':
      'export const createHandler = () => (request) => globalThis.__functions(request);',
    [start.routes]: TABLE,
    [start.root]: 'export default class App {}',
  };

  const built = await esbuildBuild({
    stdin: { contents: serverModule(start), resolveDir: '/', loader: 'js' },
    bundle: true,
    write: false,
    format: 'esm',
    target: 'esnext',
    plugins: [
      {
        name: 'stubs',
        setup(build: {
          onResolve: (o: object, f: (a: { path: string }) => unknown) => void;
          onLoad: (o: object, f: (a: { path: string }) => unknown) => void;
        }) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === '@voltdev/router') return { path: ROUTER };
            return stubs[args.path] ? { path: args.path, namespace: 'stub' } : undefined;
          });
          build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
            contents: stubs[args.path]!,
            loader: 'js',
          }));
        },
      },
    ],
  });

  const globals = globalThis as Record<string, unknown>;
  globals['__render'] = () => {
    calls.push('render');
    return (
      overrides.render?.() ?? {
        status: 200,
        html: '<p>rendered</p>',
        state: '<script>state</script>',
        styles: new Map(),
      }
    );
  };
  const answers = overrides.interactive;
  globals['__needsHydration'] = (component: { index?: number }) =>
    answers ? (answers[component.index ?? 0] ?? true) : true;
  globals['__functions'] = (request: Request) => {
    calls.push(`functions ${new URL(request.url).pathname}`);
    return new Response('fn', { status: 200 });
  };

  const url = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0]!.text).toString('base64')}`;
  const module = (await import(url)) as {
    handler: (request: Request) => Promise<Response>;
    setShell: (html: string) => void;
  };
  return { handler: module.handler, setShell: module.setShell, calls };
}

const SHELL =
  '<!doctype html><html><head></head><body><div id="app"></div>' +
  '<script type="module" src="/src/main.ts"></script></body></html>';

describe('the handler, running', () => {
  it('answers a server-function call before the route table can 404 it', async () => {
    // `/_volt/save` is not in the table. Consulting the table first would
    // answer it with the not-found page, and the application would appear to
    // have no server functions at all — so a 200 from the function handler is
    // what proves the order.
    const { handler, calls } = await handlerFor();
    const response = await handler(new Request('http://x/_volt/save', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('fn');
    expect(calls).toEqual(['functions /_volt/save']);
  });

  it('renders a route into the shell', async () => {
    const { handler, setShell } = await handlerFor();
    setShell(SHELL);
    const response = await handler(new Request('http://x/about'));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<div id="app"><p>rendered</p>');
    expect(html).toContain('<script>state</script>');
  });

  it('renders the index route', async () => {
    // The route at the parent's own URL — matched through the real router's
    // index handling, which is exactly what the stub used to pretend.
    const { handler, setShell, calls } = await handlerFor();
    setShell(SHELL);
    const response = await handler(new Request('http://x/'));
    expect(response.status).toBe(200);
    expect(calls).toContain('render');
  });

  it('sends a csr route its shell and never calls the renderer', async () => {
    const { handler, setShell, calls } = await handlerFor();
    setShell(SHELL);
    const response = await handler(new Request('http://x/dashboard'));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="app"></div>');
    expect(calls).not.toContain('render');
  });

  it('answers a url the table does not match with the shell and a 404', async () => {
    // What the real `matchRoutes` answers for nothing is an empty array, and an
    // empty array is truthy. A handler testing `!matches` renders this URL.
    const { handler, setShell, calls } = await handlerFor();
    setShell(SHELL);
    const response = await handler(new Request('http://x/nowhere'));

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('<div id="app">');
    expect(calls).not.toContain('render');
  });

  it('turns a failed render into a 500 rather than a half-built page', async () => {
    const { handler } = await handlerFor({
      render: () => ({ status: 500, html: null, state: null, styles: new Map() }),
    });
    const response = await handler(new Request('http://x/about'));
    expect(response.status).toBe(500);
  });
});

describe('declining to ship the JavaScript', () => {
  it('leaves the script out for a route with nothing to attach', async () => {
    // Partial hydration, once the boundary is known. A page of prose and links
    // has no binding, no listener, no block and no child component, so it does
    // not ask for the bundle that would attach them.
    const { handler, setShell } = await handlerFor({ interactive: [false, false] });
    setShell(SHELL);
    const html = await (await handler(new Request('http://x/about'))).text();

    expect(html).not.toContain('<script type="module"');
    // Nor the payload hydration would have read: nothing is going to read it,
    // and on a page of prose it is easily the larger half.
    expect(html).not.toContain('<script>state</script>');
    // And it is still the page: the markup is there, it simply does not wake.
    expect(html).toContain('<p>rendered</p>');
  });

  it('keeps it for a route that has', async () => {
    const { handler, setShell } = await handlerFor({ interactive: [true, true] });
    setShell(SHELL);
    const html = await (await handler(new Request('http://x/pricing'))).text();
    expect(html).toContain('<script type="module" src="/src/main.ts"></script>');
  });

  it('keeps it for a csr route, which is nothing but JavaScript', async () => {
    // The shell is all a `csr` route gets, and removing the script from it would
    // leave a blank page for ever.
    const { handler, setShell } = await handlerFor({ interactive: [false, false] });
    setShell(SHELL);
    const html = await (await handler(new Request('http://x/dashboard'))).text();
    expect(html).toContain('<script type="module"');
  });

  it('keeps it for a url the table did not match', async () => {
    // Nothing was matched, so nothing said the page is static — and the
    // application's own not-found route still has to render.
    const { handler, setShell } = await handlerFor({ interactive: [false, false] });
    setShell(SHELL);
    const html = await (await handler(new Request('http://x/nowhere'))).text();
    expect(html).toContain('<script type="module"');
  });
});

describe('what counts as having nothing to attach', () => {
  it('is every component the url matched, not most of them', async () => {
    // A static layout around a dynamic page. The outlet renders the leaf's
    // markup inside the layout's, so one binding anywhere on the way down is a
    // page that has to wake up.
    const { handler, setShell } = await handlerFor({ interactive: [false, true] });
    setShell(SHELL);
    const html = await (await handler(new Request('http://x/pricing'))).text();
    expect(html).toContain('<script type="module"');
  });

  it('is still something when the dynamic one is the layout', async () => {
    const { handler, setShell } = await handlerFor({ interactive: [true, false] });
    setShell(SHELL);
    const html = await (await handler(new Request('http://x/pricing'))).text();
    expect(html).toContain('<script type="module"');
  });

  it('keeps it for a matched route with no component to ask', async () => {
    // Nothing said the page is static, and a route rendered by something other
    // than a route component is not evidence that it is.
    const { handler, setShell } = await handlerFor({ interactive: [false, false] });
    setShell(SHELL);
    const html = await (await handler(new Request('http://x/bare'))).text();
    expect(html).toContain('<script type="module"');
  });
});
