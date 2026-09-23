// @vitest-environment node
//
// Node's own `Request`, `Response` and `fetch` for everything a host does, and
// a happy-dom window of the test's own for the one thing a browser does. The
// DOM environment would put its versions of the first three under the server
// bundle, and then the server would be answering a browser's requests from
// inside the browser.

/**
 * The `server-render` template, run end to end.
 *
 * Every piece `serverRender` is made of has its own tests, against source,
 * with the pieces around it stood in for. This has none of that: the template
 * is rendered the way `pnpm create` renders it, Volt's packages are installed
 * into it as their built `dist`, and then it is built with Vite through its
 * own config, served, hydrated in a DOM and developed against — each for real.
 * It is what the roadmap's "it runs end to end" is judged by, so an assertion
 * here that fails is a product that does not run, and the product is what
 * changes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import {
  createBuilder,
  createServer,
  isRunnableDevEnvironment,
  preview,
  type PreviewServer,
  type ViteDevServer,
} from 'vite';
import { sendResponse, toRequest } from '../../vite-plugin/src/dev-server.js';
import { endpointId, endpointKey } from '../../vite-plugin/src/server-functions.js';
import { install, removeScaffolds, scaffold } from './scaffolded.js';

type Handler = (request: Request) => Promise<Response>;

/**
 * Every route the template's table has, and what each is for.
 *
 * Written out rather than read from the table, so that a route the template
 * gains is a route this has to be told about — the dev server's half checks
 * the table against this list, and fails on a page nobody asked for.
 */
const PAGES = [
  { path: '/', mode: 'ssg', heading: 'Home' },
  { path: '/pricing', mode: 'ssr', heading: 'Pricing' },
  { path: '/dashboard', mode: 'csr', heading: 'Dashboard' },
] as const;

/** A page rendered on the server, as opposed to the one the browser builds. */
const SERVER_RENDERED = PAGES.filter((page) => page.mode !== 'csr');

let project: string;
let out: string;

/**
 * What reads a page's markup: a window that runs nothing, because happy-dom
 * runs a script only when it is told to and this one never is.
 */
const reader = new Window();

/**
 * The test runner's definitions of Volt's build flags, which it sets as
 * globals. A `vite` process has none, and a module that reached one here would
 * be a module that throws there — so they are set aside for the whole run.
 */
const flags = globalThis as { __VOLT_SERVER__?: unknown; __VOLT_DEV__?: unknown };
const runnerFlags = { server: flags.__VOLT_SERVER__, dev: flags.__VOLT_DEV__ };

beforeAll(async () => {
  delete flags.__VOLT_SERVER__;
  delete flags.__VOLT_DEV__;
  project = await scaffold('server-render');
  await install(project, 'server-render');
  out = join(project, 'dist');
}, 60_000);

afterAll(async () => {
  flags.__VOLT_SERVER__ = runnerFlags.server;
  flags.__VOLT_DEV__ = runnerFlags.dev;
  await reader.happyDOM.close();
  await removeScaffolds();
});

/** A document parsed from markup, with nothing in it run. */
function parse(html: string): Document {
  return new reader.DOMParser().parseFromString(html, 'text/html') as unknown as Document;
}

/** The module script a page asks for, as the path the browser would request. */
function moduleScript(document: Document): string | null {
  return document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null;
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Where the template's one server function answers, derived the way the plugin derives it. */
function planEndpoint(): string {
  return endpointId(
    endpointKey({
      id: resolve(project, 'src/api.ts'),
      root: project,
      className: 'Api',
      method: 'currentPlan',
    }),
  );
}

describe('the template, built', { timeout: 180_000 }, () => {
  let handler: Handler;

  beforeAll(async () => {
    // `vite build`, as the CLI runs it: the project's own config, found where
    // Vite finds it, and a builder whose kind that config decides.
    const builder = await createBuilder({ root: project, logLevel: 'silent' }, null);
    await builder.buildApp();

    const entry = pathToFileURL(join(out, 'server/server.js')).href;
    handler = ((await import(/* @vite-ignore */ entry)) as { default: { fetch: Handler } }).default
      .fetch;
  }, 180_000);

  it('writes both bundles', async () => {
    expect(await exists(join(out, 'server/server.js'))).toBe(true);
    const assets = await readdir(join(out, 'client/assets'));
    expect(assets.some((file) => file.endsWith('.js'))).toBe(true);
  });

  describe('served', () => {
    it.each(SERVER_RENDERED)('renders $path ($mode) into the page, inside every outlet above it', async ({ path, heading }) => {
      const response = await handler(new Request(`http://localhost${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^text\/html/);

      const document = parse(await response.text());
      // The leaf inside the layout's outlet, inside the root's: the whole
      // branch in one render, rather than a shell with a hole where the route
      // would go once a browser had mounted it.
      const leaf = document.querySelector('#app > .shell > main > section > article');
      expect(leaf, 'the leaf is not inside the outlets').not.toBeNull();
      expect(leaf!.querySelector('h2')?.textContent).toBe(heading);
    });

    it('puts the loader’s answer in the markup, not a loading state', async () => {
      const document = parse(await (await handler(new Request('http://localhost/pricing'))).text());
      // Only there if the loader ran, its guard read this request, and its
      // answer was in hand before the walk wrote the page.
      expect(document.querySelector('article strong')?.textContent).toBe('Team');
    });

    it.each(SERVER_RENDERED)('marks $path with the build that rendered it, and asks for a file that build wrote', async ({ path }) => {
      const document = parse(await (await handler(new Request(`http://localhost${path}`))).text());

      const mark = document.querySelector('#app')?.getAttribute('data-volt-build');
      expect(mark).toMatch(/\S/);
      const script = moduleScript(document);
      expect(script).toMatch(/^\/assets\//);
      expect(await exists(join(out, 'client', script!))).toBe(true);
    });

    it('sends a `csr` route the shell: an empty mount point with no mark, and the script that fills it', async () => {
      const response = await handler(new Request('http://localhost/dashboard'));
      expect(response.status).toBe(200);

      const document = parse(await response.text());
      const host = document.querySelector('#app')!;
      expect(host.childNodes.length).toBe(0);
      expect(host.hasAttribute('data-volt-build')).toBe(false);
      expect(await exists(join(out, 'client', moduleScript(document)!))).toBe(true);
    });

    it('answers a URL the table does not match with 404', async () => {
      const response = await handler(new Request('http://localhost/nowhere'));
      expect(response.status).toBe(404);
    });

    it('answers a server-function call with its result', async () => {
      const response = await handler(
        new Request(`http://localhost/_volt/${planEndpoint()}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-volt-call': '1' },
          body: JSON.stringify({ args: [] }),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ value: 'Team' });
    });
  });

  describe('hydrated', () => {
    let host: Server;
    let origin: string;
    /** Every request the host answered, as `METHOD /path`. */
    const requests: string[] = [];

    beforeAll(async () => {
      host = await serve(out, handler, requests);
      origin = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise((done) => host.close(done));
    });

    it.each(SERVER_RENDERED)('answers $path rendered, though every file the client build wrote is served as it is', async ({ path, heading }) => {
      const response = await fetch(origin + path);
      expect(response.status).toBe(200);
      const document = parse(await response.text());
      expect(document.querySelector('main > section > article h2')?.textContent).toBe(heading);
    });

    it('claims the nodes the server printed, and navigates from them', async () => {
      const html = await (await fetch(`${origin}/pricing`)).text();

      const errors: unknown[] = [];
      const window = new Window({
        url: `${origin}/pricing`,
        console: capture(errors),
        settings: {
          // The page's own module script, fetched from the host and run: the
          // one way to know the bundle a browser would load is the bundle
          // that attaches.
          enableJavaScriptEvaluation: true,
          suppressInsecureJavaScriptEnvironmentWarning: true,
        },
      });
      window.addEventListener('error', (event) => errors.push((event as unknown as ErrorEvent).error));
      const { document } = window;

      try {
        document.write(html);
        // Taken before the module script has run — it is still being fetched
        // — so these are the server's nodes, whatever the client does next.
        const printed = {
          shell: document.querySelector('#app > .shell'),
          main: document.querySelector('main'),
          section: document.querySelector('main > section'),
          article: document.querySelector('main > section > article'),
          plan: document.querySelector('article strong')?.firstChild,
          home: document.querySelector('nav a[href="/"]'),
          pricing: document.querySelector('nav a[href="/pricing"]'),
        };
        for (const [name, node] of Object.entries(printed)) {
          expect(node, `the server did not print ${name}`).toBeTruthy();
        }

        await window.happyDOM.waitUntilComplete();
        expect(errors).toEqual([]);

        // The same objects, not equal ones. A client that threw the server's
        // tree away and built its own would produce identical markup, and
        // only identity tells claiming from rebuilding.
        expect(document.querySelector('#app > .shell')).toBe(printed.shell);
        expect(document.querySelector('main')).toBe(printed.main);
        expect(document.querySelector('main > section')).toBe(printed.section);
        expect(document.querySelector('main > section > article')).toBe(printed.article);
        expect(document.querySelector('article strong')?.firstChild).toBe(printed.plan);
        expect(printed.plan?.textContent).toBe('Team');
        // Attached, not merely left in place: the root's binding is live on
        // the server's link, which says which page this is.
        expect(printed.pricing?.getAttribute('aria-current')).toBe('page');

        // Through the router: the click is the reader's, the navigation is
        // the router's.
        (printed.home as unknown as { click(): void }).click();
        await until(() => document.querySelector('main > section > article h2')?.textContent === 'Home');
        expect(errors).toEqual([]);

        expect(window.location.pathname).toBe('/');
        expect(document.querySelector('main > section > article')).not.toBe(printed.article);
        // The layout stayed. It only can if the router that hydrated knew the
        // server's `<section>` was the layout's — a router that had failed to
        // resolve would have built a new one on its first navigation.
        expect(document.querySelector('main > section')).toBe(printed.section);
        expect(printed.home?.getAttribute('aria-current')).toBe('page');
        expect(printed.pricing?.hasAttribute('aria-current')).toBe(false);

        // And back, where the loader runs in the browser this time: the same
        // call is a POST to the host, answered by the same bundle that
        // rendered the page.
        const before = requests.length;
        (printed.pricing as unknown as { click(): void }).click();
        await until(() => document.querySelector('article strong')?.textContent === 'Team');
        expect(errors).toEqual([]);
        expect(requests.slice(before)).toContain(`POST /_volt/${planEndpoint()}`);
      } finally {
        await window.happyDOM.close();
      }
    });
  });

  describe('previewed', () => {
    let server: PreviewServer;
    let origin: string;

    beforeAll(async () => {
      // `pnpm preview`, which the template's `package.json` offers as the way
      // to look at a build before deploying it.
      server = await preview({ root: project, logLevel: 'silent', preview: { port: 0 } });
      origin = server.resolvedUrls!.local[0]!.replace(/\/$/, '');
    });

    afterAll(async () => {
      await server?.close();
    });

    it.each(SERVER_RENDERED)('answers $path rendered, by the server that was built', async ({ path, heading }) => {
      const response = await fetch(origin + path);
      expect(response.status).toBe(200);
      const document = parse(await response.text());
      expect(document.querySelector('main > section > article h2')?.textContent).toBe(heading);
      expect(document.querySelector('#app')?.getAttribute('data-volt-build')).toMatch(/\S/);
    });

    it('answers the client’s files as files, and a URL the table does not match with 404', async () => {
      const script = moduleScript(parse(await (await fetch(`${origin}/pricing`)).text()))!;
      expect((await fetch(origin + script)).status).toBe(200);
      expect((await fetch(`${origin}/nowhere`)).status).toBe(404);
    });
  });
});

describe('the template, developed', { timeout: 120_000 }, () => {
  let vite: ViteDevServer;
  let http: Server;
  let origin: string;

  beforeAll(async () => {
    // Middleware mode, behind a Node server of the test's own: nothing of
    // Vite's answers a request its stack did not, and nothing listens for
    // updates that would hold the process open.
    vite = await createServer({
      root: project,
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false },
    });
    http = createHttpServer(vite.middlewares);
    await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    await new Promise((done) => http?.close(done));
    await vite?.close();
  });

  it('answers a page through the handler, with the route rendered and Vite’s client in it', async () => {
    const response = await fetch(`${origin}/pricing`);
    const html = await response.text();

    expect(response.status).toBe(200);
    const document = parse(html);
    expect(document.querySelector('main > section > article h2')?.textContent).toBe('Pricing');
    expect(document.querySelector('article strong')?.textContent).toBe('Team');
    expect(html).toContain('/@vite/client');
  });

  it('has no route the pages above did not ask for', async () => {
    const ssr = vite.environments['ssr']!;
    if (!isRunnableDevEnvironment(ssr)) throw new Error('the ssr environment cannot run modules');
    const { routes } = (await ssr.runner.import('/src/routes.ts')) as { routes: unknown };
    const { flattenRoutes } = (await ssr.runner.import('@voltdev/router')) as {
      flattenRoutes: (routes: unknown) => { patterns: string[] }[];
    };
    const leaves = flattenRoutes(routes).map((branch) => branch.patterns.at(-1));
    expect(leaves.sort()).toEqual(PAGES.map((page) => page.path).sort());
  });
});

describe('the template, turned off the way its README says', { timeout: 180_000 }, () => {
  it('builds and runs as an ordinary client-rendered application', async () => {
    // Server rendering is a choice this template makes, and the promise is
    // that it stays one. The README's "Turning it off" section is the whole of
    // the instructions: the option is deleted, and every file it gives in full
    // — a TypeScript block whose first line names the file — is written as
    // given. Anything it leaves out is a step a reader would not know to take.
    const off = await scaffold('server-render');
    await install(off, 'server-render');
    const config = join(off, 'vite.config.ts');
    await writeFile(
      config,
      (await readFile(config, 'utf8')).replace('volt({ serverRender: true })', 'volt()'),
    );
    const readme = await readFile(join(off, 'README.md'), 'utf8');
    const section = /^## Turning it off$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(readme)?.[1] ?? '';
    for (const [, path, body] of section.matchAll(/```ts\n\/\/ (\S+)\n([\s\S]*?)```/g)) {
      await writeFile(join(off, path!), body!);
    }

    const builder = await createBuilder({ root: off, logLevel: 'silent' }, null);
    await builder.buildApp();
    const built = join(off, 'dist');
    // Where a client-rendered project's build goes, and nothing of a server's.
    expect(await exists(join(built, 'index.html'))).toBe(true);
    expect(await exists(join(built, 'server/server.js'))).toBe(false);

    // The page, as a static host sends it for every URL, run in a browser.
    const html = await readFile(join(built, 'index.html'), 'utf8');
    const host = createHttpServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://host').pathname;
      void readFile(join(built, path))
        .then((bytes) => {
          res.setHeader('content-type', TYPES[extname(path)] ?? 'application/octet-stream');
          res.end(bytes);
        })
        .catch(() => {
          res.setHeader('content-type', TYPES['.html']!);
          res.end(html);
        });
    });
    await new Promise<void>((done) => host.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
    const errors: unknown[] = [];
    const window = new Window({
      url: `${origin}/`,
      console: capture(errors),
      settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true },
    });
    window.addEventListener('error', (event) => errors.push((event as unknown as ErrorEvent).error));
    try {
      window.document.write(html);
      await window.happyDOM.waitUntilComplete();
      await until(() => window.document.querySelector('main > section > article h2')?.textContent === 'Home');
      expect(errors).toEqual([]);
    } finally {
      await window.happyDOM.close();
      await new Promise((done) => host.close(done));
    }
  });
});

describe('the template, grown a builtin on its render path', { timeout: 180_000 }, () => {
  it('refuses to build, and says which import reached it', async () => {
    // The template's server entry has no `node:` import, and says `renderPath`
    // keeps it that way as the application grows. This is the application
    // growing: a page that reaches for one. An edge runtime has none, so a
    // build that let it through is a deploy that fails where no test ran.
    const grown = await scaffold('server-render');
    await install(grown, 'server-render');
    const home = join(grown, 'src/home.ts');
    await writeFile(
      home,
      (await readFile(home, 'utf8'))
        .replace(
          "import { Component } from '@voltdev/core';",
          "import { Component } from '@voltdev/core';\nimport { sep } from 'node:path';",
        )
        .replace('export class Home {}', 'export class Home {\n  separator = sep;\n}'),
    );

    const builder = await createBuilder({ root: grown, logLevel: 'silent' }, null);
    await expect(builder.buildApp()).rejects.toThrow(
      /render path imports 1 Node builtin[\s\S]*node:path[\s\S]*src\/home\.ts/,
    );
  });
});

// ---------------------------------------------------------------------------
// A host
// ---------------------------------------------------------------------------

const TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.html': 'text/html; charset=utf-8',
};

/**
 * The shape of most deployments: every file the client build wrote, served as
 * it is, and whatever is not a file through the server bundle.
 */
async function serve(built: string, handler: Handler, log: string[]): Promise<Server> {
  const files = join(built, 'client');
  const server = createHttpServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://host').pathname;
      log.push(`${req.method} ${path}`);
      // A directory's `index.html` stands for it, as it does on every static
      // host: `/` is `/index.html` when there is one.
      const file = normalize(join(files, path.endsWith('/') ? `${path}index.html` : path));
      if (req.method === 'GET' && file.startsWith(files) && (await exists(file))) {
        res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
        res.end(await readFile(file));
        return;
      }
      await sendResponse(res, await handler(toRequest(req)));
    })().catch((error: unknown) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return server;
}

/** A console that keeps what the page reports as an error or a warning. */
function capture(into: unknown[]): Console {
  const keep = (...args: unknown[]): void => {
    into.push(args.map(String).join(' '));
  };
  return { ...console, error: keep, warn: keep };
}

/** Wait for something the page does in its own time; fail after five seconds. */
async function until(condition: () => boolean): Promise<void> {
  for (let tries = 0; tries < 500 && !condition(); tries++) {
    await new Promise((done) => setTimeout(done, 10));
  }
  expect(condition(), 'the page never got there').toBe(true);
}
