// @vitest-environment node
//
// Node's own `Request` and `Response`, which are what a host hands the built
// handler — a DOM environment's would be the thing being tested instead.

/**
 * `vite build` builds both halves, in the order that makes the second right.
 *
 * Before this the build made the client alone. The server entry was built by
 * hand, and the shell it served was the project's *source* `index.html`, whose
 * only script is `/src/main.ts` — a file that does not exist in `dist`. A
 * deployment built exactly as documented served a page that could not load its
 * own JavaScript.
 *
 * The real builder, over a real project, the way the CLI calls it. What is
 * asserted is the bytes it writes and what they answer when imported, because
 * the claims are about a bundle a host will run: that it has nothing an edge
 * runtime lacks, that its page asks for the asset the client build emitted,
 * and that it and that client agree on who they are.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBuilder, preview, type Plugin } from 'vite';
import { volt, type VoltPluginOptions } from '../src/index.js';
import { FIXTURE, alias, claimOf, markOf, planEndpoint } from './server-render-fixture.js';

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((path) => rm(path, { recursive: true, force: true })));
});

async function scratch(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `volt-${name}-`));
  made.push(directory);
  return directory;
}

/** A copy of the fixture, for a build that has to differ from it. */
async function copyOfFixture(edit?: (root: string) => Promise<void>): Promise<string> {
  const root = await scratch('project');
  await cp(FIXTURE, root, { recursive: true });
  await edit?.(root);
  return root;
}

/**
 * `vite build`, as the CLI runs it: a builder whose kind the resolved config
 * decides, and then `buildApp`.
 */
async function build(
  root: string,
  options: { plugins?: Plugin[]; volt?: VoltPluginOptions } = {},
): Promise<string> {
  const out = await scratch('dist');
  const builder = await createBuilder(
    {
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: options.plugins ?? volt(options.volt ?? { serverRender: true }),
      resolve: { alias },
      build: { outDir: out, emptyOutDir: true },
    },
    null,
  );
  await builder.buildApp();
  return out;
}

/** Every file under a directory, by its path inside it. */
async function files(directory: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    found.set(path.slice(directory.length + 1), await readFile(path, 'utf8'));
  }
  return found;
}

/**
 * Every file of the server build imports nothing but its own chunks.
 *
 * On the bytes, because that is what the host loads. An edge runtime has no
 * `node_modules` to resolve a package against, and no builtin under either
 * spelling — `node:fs` or `fs`, imported for a binding, for its side effect or
 * through `import()`. Every file, not only the entry: a route behind an
 * `import()` is a chunk of its own, loaded the first time that route is asked
 * for, which is where a builtin in it would fail.
 */
function expectSelfContained(written: Map<string, string>): void {
  for (const [path, code] of written) {
    if (!path.startsWith('server/')) continue;
    const imported = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)];
    expect(
      imported.map((match) => match[1]).filter((specifier) => !/^\.\.?\//.test(specifier!)),
      path,
    ).toEqual([]);
    expect(code, path).not.toMatch(/\brequire\(/);
  }
}

type Handler = (request: Request) => Promise<Response>;

async function handlerOf(out: string): Promise<Handler> {
  const entry = pathToFileURL(join(out, 'server/server.js')).href;
  const loaded = (await import(/* @vite-ignore */ entry)) as { default: { fetch: Handler } };
  return loaded.default.fetch;
}

/** The page a built handler answers for `/pricing`, and the client code it asks for. */
async function pricing(out: string): Promise<{ html: string; response: Response; client: string }> {
  const response = await (await handlerOf(out))(
    new Request('http://x/pricing', { headers: { 'x-user': 'ada' } }),
  );
  const html = await response.text();
  const script = /<script type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
  const client = script ? await readFile(join(out, 'client', script), 'utf8') : '';
  return { html, response, client };
}

describe('a build with `serverRender` on', { timeout: 120_000 }, () => {
  let out: string;

  beforeAll(async () => {
    out = await build(FIXTURE);
  }, 120_000);

  it('writes the server entry beside the client, with nothing an edge runtime lacks', async () => {
    const written = await files(out);

    expect(written.has('server/server.js'), 'no server bundle was written').toBe(true);
    expectSelfContained(written);
  });

  it('writes nothing into the server’s directory but the server’s code', async () => {
    // `public/` is the client's, and the client build has copied it already.
    // A second copy beside the server bundle is deployed with the server, where
    // nothing serves it.
    const written = [...(await files(out)).keys()].filter((path) => path.startsWith('server/'));
    expect(written.filter((path) => !/\.js(\.map)?$/.test(path))).toEqual([]);
  });

  it('answers a page whose render throws with a bare 500, and nothing of the page', async () => {
    const response = await (await handlerOf(out))(new Request('http://x/broken'));
    expect(response.status).toBe(500);
    // Not what the error says, which is for whoever wrote the code, and none
    // of what the walk wrote before the throw.
    expect(await response.text()).toBe('Internal Server Error');
  });

  it('keeps the server out of the directory a host serves as files', async () => {
    const written = [...(await files(out)).keys()];
    // The server bundle holds every `@Server()` body the browser was built not
    // to have. Next to the client's assets, a host publishing them would
    // publish it too.
    expect(written.filter((path) => path.startsWith('client/server'))).toEqual([]);
    expect(written.some((path) => /^client\/assets\/index-[\w-]+\.js$/.test(path))).toBe(true);
  });

  it('keeps the shell out of it too, so no host answers a page with it unrendered', async () => {
    // The shell is what the handler writes every page into, and it is in the
    // server bundle already. As a file beside the assets it is one a host
    // that serves files first — most of them — sends for `/`, with an empty
    // mount point, and the handler never hears the request.
    const written = [...(await files(out)).keys()];
    expect(written.filter((path) => path.endsWith('.html'))).toEqual([]);
  });

  it('is previewed from the client directory, so the server bundle is never a file anyone can fetch', async () => {
    const server = await preview({
      root: FIXTURE,
      configFile: false,
      logLevel: 'silent',
      plugins: volt({ serverRender: true }),
      build: { outDir: out },
      preview: { port: 0 },
    });
    try {
      const origin = server.resolvedUrls!.local[0]!.replace(/\/$/, '');
      const { html } = await pricing(out);
      const script = /<script type="module"[^>]*src="([^"]+)"/.exec(html)![1]!;

      expect((await fetch(origin + script)).status).toBe(200);
      expect((await fetch(`${origin}/server/server.js`)).status).toBe(404);
      expect((await fetch(`${origin}/client/index.html`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('is previewed through the server it built, the way a host serves it', async () => {
    // `vite preview` is how a build is looked at before it is deployed, and
    // what a generated project's `pnpm preview` runs. The page is no longer a
    // file in the client's directory, so a preview that only serves files
    // answers every page 404.
    const server = await preview({
      root: FIXTURE,
      configFile: false,
      logLevel: 'silent',
      plugins: volt({ serverRender: true }),
      build: { outDir: out },
      preview: { port: 0 },
    });
    try {
      const origin = server.resolvedUrls!.local[0]!.replace(/\/$/, '');
      const page = await fetch(`${origin}/pricing`, { headers: { 'x-user': 'ada' } });
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(html).toMatch(
        /<main><section class="shell"><article class="pricing">.*<strong>Team<\/strong>/s,
      );
      expect(markOf(html)).toBe(markOf((await pricing(out)).html));

      const call = await fetch(`${origin}/_volt/${planEndpoint()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-volt-call': '1', 'x-user': 'ada' },
        body: JSON.stringify({ args: [] }),
      });
      expect(await call.json()).toEqual({ value: 'Team' });

      expect((await fetch(`${origin}/nowhere`)).status).toBe(404);
      // A file the client build wrote is still the file, not a page.
      const robots = await fetch(`${origin}/robots.txt`);
      expect(robots.headers.get('content-type')).toMatch(/^text\/plain/);
    } finally {
      await server.close();
    }
  });

  it('answers a page with the route rendered into it', async () => {
    const { html, response } = await pricing(out);

    expect(response.status).toBe(200);
    expect(html).toMatch(
      /<main><section class="shell"><article class="pricing">.*<strong>Team<\/strong>/s,
    );
  });

  it('serves the shell the client build emitted, not the source one', async () => {
    const { html, client } = await pricing(out);

    // The assertion that the shell came from the client build: the source
    // shell's only script is `/src/main.ts`, which is not in `dist`.
    expect(html).not.toContain('/src/main.ts');
    expect(html).toMatch(/<script type="module"[^>]*src="\/assets\/index-[\w-]+\.js"/);
    expect(client, 'the page asks for an asset the build did not write').not.toBe('');
  });

  it('answers a server-function call', async () => {
    const response = await (await handlerOf(out))(
      new Request(`http://x/_volt/${planEndpoint()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-volt-call': '1', 'x-user': 'ada' },
        body: JSON.stringify({ args: [] }),
      }),
    );
    expect(await response.json()).toEqual({ value: 'Team' });
  });

  it('gives the server and the client of one build one identity', async () => {
    const { html, client } = await pricing(out);
    const mark = markOf(html);

    expect(mark).not.toBeNull();
    expect(claimOf(client)).toBe(mark);
  });
});

describe('a build with a route behind an `import()`', { timeout: 120_000 }, () => {
  let out: string;

  beforeAll(async () => {
    // A copy, because a page in happy-dom cannot run a client with a dynamic
    // import in it, and the other tests of this fixture run its client there.
    const root = await copyOfFixture(async (root) => {
      const routes = join(root, 'src/routes.ts');
      await writeFile(
        routes,
        (await readFile(routes, 'utf8')).replace(
          "{ path: 'broken', component: Broken },",
          "{ path: 'broken', component: Broken },\n      { path: 'later', component: () => import('./later.js') },",
        ),
      );
      await writeFile(
        join(root, 'src/later.ts'),
        [
          "import { Component } from '@voltdev/core';",
          "@Component({ selector: 'v-later', templateUrl: './later.html' })",
          'export default class Later {}',
          '',
        ].join('\n'),
      );
      await writeFile(join(root, 'src/later.html'), '<article class="later"><h1>Later</h1></article>');
    });
    out = await build(root);
  }, 120_000);

  it('writes that route as a chunk of its own, as self-contained as the entry', async () => {
    const written = await files(out);
    const server = [...written.keys()].filter((path) => path.startsWith('server/'));
    expect(server.length, 'the route made no chunk of its own').toBeGreaterThan(1);
    expectSelfContained(written);
  });

  it('renders that route into the page like any other', async () => {
    const html = await (await (await handlerOf(out))(new Request('http://x/later'))).text();
    expect(html).toMatch(/<main><section class="shell"><article class="later"><h1>Later<\/h1>/);
  });
});

describe('the identity of a build', { timeout: 120_000 }, () => {
  let original: string;

  beforeAll(async () => {
    original = markOf((await pricing(await build(FIXTURE))).html)!;
  }, 120_000);

  it('changes when one template does', async () => {
    // The failure the mark exists for: yesterday's client, cached, meeting
    // today's markup. A hash of the compiler and its options alone is the same
    // for both — same compiler, same options, different templates — and the
    // client would claim nodes laid out for a template it has never seen.
    const edited = await copyOfFixture(async (root) => {
      const file = join(root, 'src/pricing.html');
      await writeFile(file, (await readFile(file, 'utf8')).replace('<h1>Pricing</h1>', '<h1>Plans</h1>'));
    });
    const { html, client } = await pricing(await build(edited));
    const changed = markOf(html)!;

    expect(changed).not.toBe(original);
    expect(claimOf(client)).toBe(changed);
    // The compiler's own hash is still in it, and still the same: the
    // difference is in the part that covers what was built.
    expect(changed.split('.')[0]).toBe(original.split('.')[0]);
  });

  it('is the same for the same project built somewhere else', async () => {
    // Two machines building one commit must agree, or every server of a
    // deployment would print pages the others' clients refuse.
    const copy = await copyOfFixture();
    expect(markOf((await pricing(await build(copy))).html)).toBe(original);
  });
});

describe('a project configured by a file', { timeout: 120_000 }, () => {
  it('hands the client build to the server build, though each build loads its own plugins', async () => {
    // `vite build` evaluates the project's config once per environment, so the
    // client and the server are built by two different calls to `volt()`.
    // What the client build settled has to cross from one to the other anyway.
    const root = await copyOfFixture(async (root) => {
      await writeFile(
        join(root, 'vite.config.ts'),
        [
          `import { volt } from ${JSON.stringify(join(import.meta.dirname, '../src/index.ts'))};`,
          'const counted = globalThis as { __voltConfigLoads?: number };',
          'counted.__voltConfigLoads = (counted.__voltConfigLoads ?? 0) + 1;',
          'export default { plugins: [volt({ serverRender: true })] };',
          '',
        ].join('\n'),
      );
    });
    const counted = globalThis as { __voltConfigLoads?: number };
    counted.__voltConfigLoads = 0;
    const out = await scratch('dist');
    const builder = await createBuilder(
      {
        root,
        configLoader: 'runner',
        logLevel: 'silent',
        resolve: { alias },
        build: { outDir: out, emptyOutDir: true },
      },
      null,
    );
    await builder.buildApp();

    expect(counted.__voltConfigLoads).toBeGreaterThan(1);
    const { html, client } = await pricing(out);
    expect(html).not.toContain('/src/main.ts');
    expect(markOf(html)).not.toBeNull();
    expect(claimOf(client)).toBe(markOf(html));
  });
});

describe('the order of the two builds', { timeout: 120_000 }, () => {
  it('refuses a server built before its client, rather than serving the wrong shell', async () => {
    const out = await scratch('dist');
    const builder = await createBuilder(
      {
        root: FIXTURE,
        configFile: false,
        logLevel: 'silent',
        plugins: volt({ serverRender: true }),
        resolve: { alias },
        build: { outDir: out, emptyOutDir: true },
      },
      null,
    );
    await expect(builder.build(builder.environments['ssr']!)).rejects.toThrow(
      /built after the client/,
    );
  });
});

describe('a build with `serverRender` off', { timeout: 120_000 }, () => {
  /** The same project, started in the browser the way a client-rendered one is. */
  const clientRendered = (): Promise<string> =>
    copyOfFixture(async (root) => {
      await writeFile(
        join(root, 'src/main.ts'),
        [
          "import { mount, provideOutlet } from '@voltdev/core';",
          "import { createRouter, provideRouter } from '@voltdev/router';",
          "import App from './app.js';",
          "import { routes } from './routes.js';",
          '',
          'const router = createRouter({ routes });',
          'await router.resolve(location.href);',
          "mount(App, '#app', { setup: () => { provideRouter(router); provideOutlet(router.outletAt(0)); } });",
          'await router.start({ resolve: false });',
          '',
        ].join('\n'),
      );
    });

  it('builds the client alone, where a client-rendered project puts it', async () => {
    const written = [...(await files(await build(await clientRendered(), { volt: {} }))).keys()];

    expect(written).toContain('index.html');
    expect(written.some((path) => path.startsWith('server/'))).toBe(false);
    expect(written.some((path) => path.startsWith('client/'))).toBe(false);
  });

  it('is not changed by the server-render plugin existing', async () => {
    // The opt-in promise, measured: the plugin that drives the two builds is
    // created only when asked for, so a project that did not ask builds
    // exactly what it would with the plugin missing from the array.
    const root = await clientRendered();
    const plugins = volt();
    expect(plugins.map((plugin) => plugin.name)).not.toContain('volt:server-render');

    const without = volt().filter((plugin) => plugin.name !== 'volt:server-render');
    const [a, b] = await Promise.all([
      build(root, { plugins }).then(files),
      build(root, { plugins: without }).then(files),
    ]);
    expect(a).toEqual(b);
  });
});
