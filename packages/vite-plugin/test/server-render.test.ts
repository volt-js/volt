/**
 * `serverRender`: the wiring, and the promise that it stays a choice.
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
import {
  CLIENT_ID,
  SERVER_ID,
  SHELL_ID,
  clientModule,
  resolveServerRender,
  serverModule,
} from '../src/server-render.js';
import { guard, withRequest } from '../../server/src/guard.js';

/** What a build calls itself; the plugin hands the real hash over. */
const BUILD = 'test-build-hash';

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
    // by someone giving `serverRender` a default. Then this goes red.
    const plugins = volt();
    expect(await loadVirtual(plugins, SERVER_ID)).toBeNull();
    expect(await loadVirtual(plugins, CLIENT_ID)).toBeNull();
    expect(await loadVirtual(plugins, SHELL_ID)).toBeNull();
    expect(plugins.map((plugin) => plugin.name)).not.toContain('volt:server-render');
  });

  // The other half of the same promise — that a project which never asked for
  // a server does not get a client emit compiled to claim markup that will not
  // be there — is asserted in `plugin.test.ts`, against the compiled output,
  // beside the rest of the emit-selection tests. It belongs with them: the
  // claim is about which of the three emits a build gets, and that file is
  // where the three are told apart.

});

describe('what `serverRender` generates', () => {
  const wiring = resolveServerRender(true);

  it('produces a server module that parses and wires the four pieces', () => {
    const code = serverModule(wiring, BUILD);
    expect(() => transformSync(code, { loader: 'js' })).not.toThrow();

    // The four the entry names, each by the import that brings it in.
    expect(code).toContain("from '@voltdev/router'");
    expect(code).toContain("from '@voltdev/core/server'");
    expect(code).toContain("from '@voltdev/server'");
    expect(code).toContain(wiring.routes);
  });

  it('is a Request in and a Response out, which is what edge means', () => {
    // Not decoration: the roadmap's edge mode falls out of this shape, and a
    // handler that took a Node request or reached for a builtin would not be
    // deployable to the runtime the check in `render-path.ts` exists for.
    const code = serverModule(wiring, BUILD);
    expect(code).toContain('export async function handler(request)');
    expect(code).toContain('new URL(request.url)');
    // The import, not the word: a comment may say `node` and mean nothing.
    expect(code).not.toMatch(/from ['"]node:|require\(['"]node:/);
    expect(code).not.toContain('require(');
  });

  it('answers a URL the table does not match with the shell and a 404', () => {
    const code = serverModule(wiring, BUILD);
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
    const code = serverModule(wiring, BUILD);
    const base = code.indexOf('isServerCall(request');
    const match = code.indexOf('matchRoutes(branches');
    expect(base, 'the server-call check is not there').toBeGreaterThan(-1);
    expect(base, 'the table is consulted first').toBeLessThan(match);
    expect(code).toContain('return functions(request)');
  });

  it('takes its shell from the client build rather than from its caller', () => {
    // A shell handed over at runtime was the source `index.html`, whose only
    // script is `/src/main.ts` — a file a build does not produce. The page the
    // handler writes into is a module now, which the plugin serves from what
    // the client build emitted.
    const code = serverModule(wiring, BUILD);
    expect(code).toContain(`import shell from ${JSON.stringify(SHELL_ID)}`);
    expect(code).not.toContain('setShell');
  });

  it('sends a csr route its shell without rendering it', () => {
    const code = serverModule(wiring, BUILD);
    expect(code).toContain("if (mode === 'csr') return page('', '', '', 200)");
  });

  it('produces a client module that parses and mounts', () => {
    const code = clientModule(wiring, BUILD);
    expect(() => transformSync(code, { loader: 'js' })).not.toThrow();
    expect(code).toContain("from '@voltdev/core'");
    expect(code).toContain(wiring.root);
  });
});

describe('what a project supplies', () => {
  it('defaults to a route table and a root it can override', () => {
    expect(resolveServerRender(true)).toMatchObject({
      routes: '/src/routes.js',
      root: '/src/app.js',
      defaultMode: 'ssr',
      base: '/_volt/',
      entry: '/server.ts',
    });
    expect(resolveServerRender({ routes: '/app/table.js', defaultMode: 'csr' })).toMatchObject({
      routes: '/app/table.js',
      defaultMode: 'csr',
    });
  });

  it('serves both halves once it is asked', async () => {
    const plugins = volt({ serverRender: true });
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
 * router package, over a real route table, and only the renderer, the function
 * handler and the hydration answer are stubbed — the handler's own decisions
 * are what is under test, and those three are its inputs.
 *
 * The whole package rather than `routes.ts` alone, because the handler now
 * makes a router per request and resolves the URL on it before rendering.
 * That is only testable at all because `createRouter` reads no browser: the
 * refactor that made a server-rendered route possible is what lets this run
 * in node.
 */
const ROUTER = resolve(import.meta.dirname, '../../router/src/index.ts');
const CORE = resolve(import.meta.dirname, '../../core/src/index.ts');
const SERVER_HANDLER = resolve(import.meta.dirname, '../../server/src/handler.ts');

/**
 * A route table that exercises every branch of the handler.
 *
 * The components are registered rather than bare classes, because the router
 * asks `isComponent` whether a route's `component` is one — and treats
 * anything else as a function that loads one, which is what a lazy route is.
 * A bare class was called, and being a class, refused.
 */
const TABLE = `
  import { defineComponent } from ${JSON.stringify(CORE)};
  const component = (index) => {
    const C = class {};
    C.index = index;
    defineComponent(C, { selector: 'v-route-' + index + '-' + (n++), render: () => null }, []);
    return C;
  };
  let n = 0;
  export const routes = [
    {
      path: '/',
      component: component(0),
      children: [
        { index: true, component: component(1) },
        { path: 'about', component: component(1) },
        { path: 'pricing', component: component(1), mode: 'ssr' },
        { path: 'dashboard', component: component(1), mode: 'csr' },
        { path: 'account', component: component(1), loader: () => globalThis.__loader?.() },
      ],
    },
    { path: '/bare' },
    { path: '/_voltage', component: component(1) },
    { path: '/q&a', component: component(1) },
  ];
`;

/** The page the plugin would serve as `virtual:volt/shell` in a build. */
const SHELL =
  '<!doctype html><html><head></head><body><div id="app"></div>' +
  '<script type="module" src="/src/main.ts"></script></body></html>';

async function handlerFor(
  overrides: {
    /** Whether each component is interactive, by position: 0 is the layout, 1 the page. */
    interactive?: readonly boolean[];
    /** Whether the root component is. Default true, as an unasked component was. */
    root?: boolean;
    render?: (options: RenderOptions) => unknown;
    /** The dev server's variant, which throws a failure for the overlay. */
    dev?: boolean;
  } = {},
): Promise<{
  handler: (request: Request) => Promise<Response>;
  calls: string[];
}> {
  const calls: string[] = [];
  const wiring = resolveServerRender(true);

  const stubs: Record<string, string> = {
    '@voltdev/core/server':
      'export const renderToString = async (component, options) => (globalThis.__render(options));',
    // `needsHydration` is the one answer this suite drives, so it is the one
    // thing wrapped; everything else a router asks of the component runtime is
    // the real thing, because a stub that disagreed with it is exactly the
    // failure this file's own history records.
    '@voltdev/core': `
      export * from ${JSON.stringify(CORE)};
      export const needsHydration = (component) => globalThis.__needsHydration(component);
    `,
    // The real predicate, and only the handler stubbed: whether a request is a
    // server call is exactly the kind of decision the router stub got wrong.
    '@voltdev/server': `
      export { isServerCall } from ${JSON.stringify(SERVER_HANDLER)};
      export const createHandler = () => (request) => globalThis.__functions(request);
      // Handed through rather than bundled, so the guard this suite imports and
      // the one the handler makes the request visible to are one module.
      export const withRequest = (request, run) => globalThis.__withRequest(request, run);
    `,
    // What the plugin serves from the client build's emitted page.
    [SHELL_ID]: `export default ${JSON.stringify(SHELL)};`,
    [wiring.routes]: TABLE,
    // Marked, because the root is asked alongside the route's components and
    // the answers are positional: without this it would share the layout's.
    [wiring.root]: 'export default class App { static root = true; }',
  };

  const built = await esbuildBuild({
    stdin: {
      contents: serverModule(wiring, BUILD, { dev: overrides.dev }),
      resolveDir: '/',
      loader: 'js',
    },
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
            if (stubs[args.path]) return { path: args.path, namespace: 'stub' };
            // A real file named from inside a stub. Resolution does not follow
            // a module out of a non-file namespace on its own.
            if (args.path.startsWith('/')) return { path: args.path };
            return undefined;
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
  globals['__withRequest'] = withRequest;
  globals['__render'] = (options: RenderOptions) => {
    calls.push('render');
    return (
      overrides.render?.(options) ?? {
        status: 200,
        html: '<p>rendered</p>',
        state: '<script>state</script>',
        styles: new Map(),
      }
    );
  };
  const answers = overrides.interactive;
  globals['__needsHydration'] = (component: { index?: number; root?: boolean }) =>
    component.root ? (overrides.root ?? true) : answers ? (answers[component.index ?? 0] ?? true) : true;
  globals['__functions'] = (request: Request) => {
    calls.push(`functions ${new URL(request.url).pathname}`);
    return new Response('fn', { status: 200 });
  };

  const url = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0]!.text).toString('base64')}`;
  const module = (await import(url)) as { handler: (request: Request) => Promise<Response> };
  return { handler: module.handler, calls };
}

/** What the generated handler hands the renderer, as far as this suite reads it. */
interface RenderOptions {
  around: <T>(run: () => T) => T;
  setup: () => void;
}

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

  it('routes a page whose path merely starts like the function base as a page', async () => {
    // A prefix test on '/_volt' would hand this to the function handler, which
    // answers 405 to a GET — so a route the application declared would not load.
    const { handler, calls } = await handlerFor();
    const response = await handler(new Request('http://x/_voltage'));

    expect(response.status).toBe(200);
    expect(calls).toContain('render');
    expect(calls.some((call) => call.startsWith('functions'))).toBe(false);
  });

  it('does not treat a GET to the function base as a function call', async () => {
    // A reader who types a function URL into the address bar is navigating, not
    // calling — there is no such page, so the answer is the not-found one.
    const { handler, calls } = await handlerFor();
    const response = await handler(new Request('http://x/_volt/save'));

    expect(response.status).toBe(404);
    expect(calls.some((call) => call.startsWith('functions'))).toBe(false);
  });

  it('renders a route into the shell', async () => {
    const { handler } = await handlerFor();
    const response = await handler(new Request('http://x/about'));
    const html = await response.text();

    expect(response.status).toBe(200);
    // The mount point says which build filled it, which is the only evidence
    // a client has that there is anything here to attach to.
    expect(html).toContain(
      `<div id="app" data-volt-build="${BUILD}" data-volt-path="/about"><p>rendered</p>`,
    );
    expect(html).toContain('<script>state</script>');
  });

  it('renders the index route', async () => {
    // The route at the parent's own URL — matched through the real router's
    // index handling, which is exactly what the stub used to pretend.
    const { handler, calls } = await handlerFor();
    const response = await handler(new Request('http://x/'));
    expect(response.status).toBe(200);
    expect(calls).toContain('render');
  });

  it('sends a csr route its shell and never calls the renderer', async () => {
    const { handler, calls } = await handlerFor();
    const response = await handler(new Request('http://x/dashboard'));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="app"></div>');
    expect(calls).not.toContain('render');
  });

  it('answers a url the table does not match with the shell and a 404', async () => {
    // What the real `matchRoutes` answers for nothing is an empty array, and an
    // empty array is truthy. A handler testing `!matches` renders this URL.
    const { handler, calls } = await handlerFor();
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

  it('turns a loader that threw into a 500 that says nothing about it', async () => {
    // What a loader's error says — a driver's message, a stack — is not for
    // whoever asked for the page.
    const globals = globalThis as Record<string, unknown>;
    globals['__loader'] = () => {
      throw new Error('connection refused at 10.0.0.7');
    };
    try {
      const { handler, calls } = await handlerFor();
      const response = await handler(new Request('http://x/account'));
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('10.0.0.7');
      expect(calls).not.toContain('render');
    } finally {
      delete globals['__loader'];
    }
  });

  it('throws either failure under a dev server, where the overlay shows it', async () => {
    // The person who asked wrote the code, and a bare 500 sends them to the
    // terminal to find out which line it was.
    const broken = new Error('render failed');
    const rendering = await handlerFor({
      dev: true,
      render: () => ({ status: 500, error: broken, html: null, state: null, styles: new Map() }),
    });
    await expect(rendering.handler(new Request('http://x/about'))).rejects.toBe(broken);

    const globals = globalThis as Record<string, unknown>;
    const refused = new Error('loader failed');
    globals['__loader'] = () => {
      throw refused;
    };
    try {
      const loading = await handlerFor({ dev: true });
      await expect(loading.handler(new Request('http://x/account'))).rejects.toBe(refused);
    } finally {
      delete globals['__loader'];
    }
  });
});

describe('the request a page is rendered for', () => {
  it('is the one a loader and the render show a guard, and only while they run', async () => {
    // A server function called during a render is a direct call on the server,
    // so nothing but the handler can say which request it belongs to. A
    // loader runs before the render and inside `resolve()`, so that has to be
    // wrapped as well as the render itself.
    const seen: string[] = [];
    const ask = (step: string) =>
      guard((request) => {
        seen.push(`${step} ${request.headers.get('x-user')}`);
        return true;
      });
    const globals = globalThis as Record<string, unknown>;
    globals['__loader'] = () => ask('loader');

    try {
      const { handler } = await handlerFor({
        render: (options) => {
          void options.around(() => ask('render'));
          return undefined;
        },
      });
      const response = await handler(
        new Request('http://x/account', { headers: { 'x-user': 'ada' } }),
      );

      expect(response.status).toBe(200);
      expect(seen).toEqual(['loader ada', 'render ada']);
      // Nothing of the request outlives the spans it was lent to.
      expect(() => guard(() => true)).toThrow(/outside the first statement/);
    } finally {
      delete globals['__loader'];
    }
  });
});

describe('declining to ship the JavaScript', () => {
  it('leaves the script out for a route with nothing to attach', async () => {
    // Partial hydration, once the boundary is known. A page of prose and links
    // has no binding, no listener, no block and no child component, so it does
    // not ask for the bundle that would attach them.
    const { handler } = await handlerFor({ interactive: [false, false], root: false });
    const html = await (await handler(new Request('http://x/about'))).text();

    expect(html).not.toContain('<script type="module"');
    // Nor the payload hydration would have read: nothing is going to read it,
    // and on a page of prose it is easily the larger half.
    expect(html).not.toContain('<script>state</script>');
    // And it is still the page: the markup is there, it simply does not wake.
    expect(html).toContain('<p>rendered</p>');
  });

  it('keeps it for a route that has', async () => {
    const { handler } = await handlerFor({ interactive: [true, true] });
    const html = await (await handler(new Request('http://x/pricing'))).text();
    expect(html).toContain('<script type="module" src="/src/main.ts"></script>');
  });

  it('keeps it for a csr route, which is nothing but JavaScript', async () => {
    // The shell is all a `csr` route gets, and removing the script from it would
    // leave a blank page for ever.
    const { handler } = await handlerFor({ interactive: [false, false], root: false });
    const html = await (await handler(new Request('http://x/dashboard'))).text();
    expect(html).toContain('<script type="module"');
  });

  it('keeps it for a url the table did not match', async () => {
    // Nothing was matched, so nothing said the page is static — and the
    // application's own not-found route still has to render.
    const { handler } = await handlerFor({ interactive: [false, false], root: false });
    const html = await (await handler(new Request('http://x/nowhere'))).text();
    expect(html).toContain('<script type="module"');
  });
});

describe('what counts as having nothing to attach', () => {
  it('is every component the url matched, not most of them', async () => {
    // A static layout around a dynamic page. The outlet renders the leaf's
    // markup inside the layout's, so one binding anywhere on the way down is a
    // page that has to wake up.
    const { handler } = await handlerFor({ interactive: [false, true] });
    const html = await (await handler(new Request('http://x/pricing'))).text();
    expect(html).toContain('<script type="module"');
  });

  it('is still something when the dynamic one is the layout', async () => {
    const { handler } = await handlerFor({ interactive: [true, false] });
    const html = await (await handler(new Request('http://x/pricing'))).text();
    expect(html).toContain('<script type="module"');
  });

  it('asks the root as well, since it renders on every page', async () => {
    // An application whose only binding is in its own navigation was being
    // sent a page that could never attach it: the root was never asked.
    const dynamic = await handlerFor({ interactive: [false, false], root: true });
    expect(await (await dynamic.handler(new Request('http://x/bare'))).text()).toContain(
      '<script type="module"',
    );
  });

  it('leaves it out when the root has nothing either', async () => {
    // "No component to ask" used to mean unknown, and unknown meant ship the
    // JavaScript. There is always something to ask now.
    const still = await handlerFor({ interactive: [false, false], root: false });
    expect(await (await still.handler(new Request('http://x/bare'))).text()).not.toContain(
      '<script type="module"',
    );
  });
});

/**
 * Which of the two entries a page runs, and what decides it.
 *
 * Not the mount point's children: a `csr` route's mount point is empty on a
 * server-rendered site, and a shell with a spinner in it is not. What decides
 * is what the server said it did — and it says it with the identity of the
 * build that did it, so a page printed by a deploy that is no longer this one
 * is built again rather than claimed. Paths resolve either way; they simply
 * land on the wrong nodes, which nothing on the page could detect afterwards.
 */
describe('claiming a page, or building it', () => {
  const wiring = resolveServerRender(true);

  it('claims only what this build printed', () => {
    const code = clientModule(wiring, 'build-one');

    expect(code).toContain('getAttribute(BUILD_ATTRIBUTE) === "build-one"');
    expect(code).toContain('hydrate(App, host, { setup })');
    expect(code).toContain('mount(App, host, { setup })');
    // The guess it replaces.
    expect(code).not.toContain('host.firstChild');
  });

  it('resolves before it attaches, and listens after', () => {
    const code = clientModule(wiring, 'build-one');

    // The order is the whole of it. Claiming with an unresolved router claims
    // a branch that is not there; building with one builds the shell and
    // nothing under it; and listening first lets a click arrive before the
    // page it would navigate from exists.
    const resolved = code.indexOf('await router.resolve(location.href)');
    const attached = code.indexOf('hydrate(App, host, { setup })');
    const listening = code.indexOf('router.start({ resolve: false })');
    expect(resolved).toBeGreaterThan(-1);
    expect(attached).toBeGreaterThan(resolved);
    expect(listening).toBeGreaterThan(attached);
  });

  it('hands the router and its first outlet to whatever renders', () => {
    const code = clientModule(wiring, 'build-one');

    expect(code).toContain('provideRouter(router)');
    expect(code).toContain('provideOutlet(router.outletAt(0))');
  });

  it('can still claim under a `csr` default, where a route may ask the server', () => {
    // The default is the fallback, and a route declaring `ssr` is rendered by
    // the server all the same. `claim.test.ts` runs the page this shortcut
    // used to throw away.
    const code = clientModule(resolveServerRender({ defaultMode: 'csr' }), 'build-one');

    expect(code).toContain('getAttribute(BUILD_ATTRIBUTE) === "build-one"');
    expect(code).toContain('hydrate(App, host, { setup })');
  });

  it('marks the mount point with the same identity the client compares', () => {
    const server = serverModule(wiring, 'build-one');
    const client = clientModule(wiring, 'build-one');

    expect(server).toContain('const BUILD = "build-one"');
    expect(client).toContain('"build-one"');
  });
});

describe('the page a client claims', () => {
  it('is the render byte for byte, whatever the render wrote', async () => {
    // `$$`, `$&`, `` $` `` and `$'` mean something to `String.replace` even
    // when the pattern is a string. A page about prices, a formula in `$$`,
    // a stylesheet with a `content: "$'"` — spliced in as a replacement, each
    // is rewritten on the way out: `$$` loses a dollar, `$'` pastes in the
    // rest of the shell. The client claims the static text as the server
    // wrote it and never writes it again, and adopts the payload's values as
    // they arrived.
    const text = "$$ E = mc^2 $$, $& and $' and $`";
    const state = `<script type="application/json" data-volt-state>{"note":"${text}"}</script>`;
    const css = `p::after { content: "${text}"; }`;
    const { handler } = await handlerFor({
      render: () => ({ status: 200, html: `<p>${text}</p>`, state, styles: new Map([['p', css]]) }),
    });
    const html = await (await handler(new Request('http://x/about'))).text();

    expect(html).toContain(
      `<div id="app" data-volt-build="${BUILD}" data-volt-path="/about"><p>${text}</p></div>${state}`,
    );
    expect(html).toContain(`<style>${css}</style></head>`);
    // Once: `$'` would have written the shell's own script into the page again.
    expect(html.match(/<script type="module"/g)).toHaveLength(1);
  });

  it('names the path it was rendered for, as the parser will hand it back', async () => {
    // The client compares this with `location.pathname` before it claims a
    // node. A path keeps its `&`, and an attribute would read `&a…` as the
    // start of a character reference.
    const { handler } = await handlerFor();
    const html = await (await handler(new Request('http://x/q&a'))).text();

    expect(html).toContain(`<div id="app" data-volt-build="${BUILD}" data-volt-path="/q&amp;a">`);
  });
});

