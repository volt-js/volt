// @vitest-environment node
//
// Node's own `Request`, `Response` and `fetch` for the host, and a happy-dom
// window of the test's own for the browser. The DOM environment would put its
// versions of the first three under the server bundle.

/**
 * The client of a real build, claiming the page the server of that build sent.
 *
 * `serverRender`'s client decides between claiming and building by what the
 * page says, and the only proof it claimed is that the nodes afterwards are
 * the *same objects* the server printed: a client that threw the page away
 * and built its own produces identical markup. So each case here builds the
 * fixture with Vite, serves it the way a host does, lets the page's own module
 * script run in a window, and compares node identity.
 *
 * The cases are the pages that are not the happy path — a route that opted in
 * to the server under a `csr` default, a loader that fails in the browser, a
 * page another build printed — because the happy path is also the one
 * `server-render-e2e.test.ts` walks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { createBuilder, createServer, type HotPayload } from 'vite';
import { volt, type ServerRenderOptions } from '../src/index.js';
import { sendResponse, toRequest } from '../src/dev-server.js';
import { FIXTURE, alias, markOf } from './server-render-fixture.js';

type Handler = (request: Request) => Promise<Response>;

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((path) => rm(path, { recursive: true, force: true })));
});

async function scratch(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `volt-${name}-`));
  made.push(directory);
  return directory;
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

interface Hosted {
  origin: string;
  /** Whether the host refuses server-function calls, as an outage would. */
  refuseCalls: boolean;
  close(): Promise<void>;
}

/**
 * `vite build` over `root`, then a host for it: the client's files as they
 * are, and everything else through the server bundle.
 */
async function host(
  root: string,
  serverRender: ServerRenderOptions | true,
  mode: 'production' | 'development' = 'production',
): Promise<Hosted> {
  const out = await scratch('dist');
  const builder = await createBuilder(
    {
      root,
      mode,
      configFile: false,
      logLevel: 'silent',
      plugins: volt({ serverRender }),
      resolve: { alias },
      build: { outDir: out, emptyOutDir: true },
    },
    null,
  );
  await builder.buildApp();
  const entry = pathToFileURL(join(out, 'server/server.js')).href;
  const handler = ((await import(/* @vite-ignore */ entry)) as { default: { fetch: Handler } })
    .default.fetch;

  const files = join(out, 'client');
  const hosted: Hosted = { origin: '', refuseCalls: false, close: async () => {} };
  const server: Server = createHttpServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://host').pathname;
      if (hosted.refuseCalls && req.method === 'POST') {
        res.statusCode = 503;
        res.end();
        return;
      }
      const file = normalize(join(files, path));
      if (req.method === 'GET' && file.startsWith(files) && (await exists(file))) {
        const script = file.endsWith('.js');
        res.setHeader('content-type', script ? 'text/javascript' : 'text/plain');
        res.end(script ? compilable(await readFile(file, 'utf8')) : await readFile(file));
        return;
      }
      await sendResponse(res, await handler(toRequest(req)));
    })().catch((error: unknown) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  hosted.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  hosted.close = () => new Promise((done) => server.close(() => done()));
  return hosted;
}

/**
 * A module as happy-dom can compile it.
 *
 * Vite's preload helper, in every build with an `import()`, resolves a chunk's
 * URL with `import.meta.resolve` where the engine has it, and happy-dom cannot
 * compile `import.meta` after a `return` or a `?` at all — the page's module
 * would never run. The helper's other branch is the same URL spelled with
 * `new URL`, which it can compile, and nothing in the helper decides which
 * nodes a client claims.
 */
function compilable(code: string): string {
  return code.replace(
    /import\.meta\.resolve\?import\.meta\.resolve\((\w+)\):(new URL\(\1,import\.meta\.url\)\.href)/g,
    '$2',
  );
}

/** Every node under the mount point, in document order. */
function nodesOf(document: Document): Node[] {
  const found: Node[] = [];
  const app = document.querySelector('#app');
  if (!app) return found;
  const walker = document.createTreeWalker(app, 0xffffffff);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) found.push(node);
  return found;
}

interface Booted {
  document: Document;
  /** The nodes under the mount point before the page's script ran. */
  printed: Node[];
  errors: unknown[];
  close(): Promise<void>;
}

/**
 * A browser loading `path` from the host: the page written into a window,
 * its nodes taken before the module script has been fetched, then the script
 * run to completion.
 */
async function boot(
  hosted: Hosted,
  path: string,
  edit: (html: string) => string = (html) => html,
  /** The path the host renders for, when it rewrites the one the browser asked for. */
  rendered: string = path,
): Promise<Booted> {
  const html = edit(await (await fetch(hosted.origin + rendered)).text());
  const errors: unknown[] = [];
  const keep = (...args: unknown[]): void => {
    errors.push(args.map(String).join(' '));
  };
  const window = new Window({
    url: hosted.origin + path,
    console: { ...console, error: keep, warn: keep } as Console,
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });
  window.addEventListener('error', (event) => errors.push((event as unknown as ErrorEvent).error));
  const document = window.document as unknown as Document;
  document.write(html);
  const printed = nodesOf(document);
  await window.happyDOM.waitUntilComplete();
  return { document, printed, errors, close: () => window.happyDOM.close() };
}

/** Wait for something the page does in its own time; fail after three seconds. */
async function until(condition: () => boolean): Promise<void> {
  for (let tries = 0; tries < 300 && !condition(); tries++) {
    await new Promise((done) => setTimeout(done, 10));
  }
  expect(condition(), 'the page never got there').toBe(true);
}

function expectClaimed(page: Booted): void {
  const now = nodesOf(page.document);
  expect(page.printed.length).toBeGreaterThan(0);
  expect(now).toHaveLength(page.printed.length);
  // The same objects, not equal ones: only identity tells claiming from
  // building a copy.
  now.forEach((node, index) => expect(node).toBe(page.printed[index]));
}

describe('a page this build printed', { timeout: 120_000 }, () => {
  let hosted: Hosted;

  beforeAll(async () => {
    hosted = await host(FIXTURE, true);
  }, 120_000);

  afterAll(() => hosted.close());

  it.each(['/', '/pricing'])('is claimed on %s, every node of it', async (path) => {
    const page = await boot(hosted, path);
    try {
      expect(page.errors).toEqual([]);
      expectClaimed(page);
      expect(page.document.querySelector(`nav a[href="${path}"]`)?.getAttribute('aria-current')).toBe(
        'page',
      );
    } finally {
      await page.close();
    }
  });

  it('keeps the page, and where it is, when its loader fails in the browser', async () => {
    // The server rendered the page with its loader's answer; the browser's
    // run of the same loader is a call to a host that is not answering. What
    // is on the screen is still the right page for this URL, so it stays —
    // node for node, and with the root still saying which page it is.
    hosted.refuseCalls = true;
    const page = await boot(hosted, '/pricing');
    try {
      expectClaimed(page);
      const pricing = page.document.querySelector('nav a[href="/pricing"]')!;
      expect(pricing.getAttribute('aria-current')).toBe('page');
      expect(page.document.querySelector('article strong')?.textContent).toBe('Free');

      // The router is listening all the same, and the next page it is asked
      // for is built whole.
      hosted.refuseCalls = false;
      (page.document.querySelector('nav a[href="/"]') as HTMLElement).click();
      await until(() => page.document.querySelector('.shell > article.home') !== null);
      expect(page.document.querySelectorAll('.shell')).toHaveLength(1);
      expect(page.document.querySelector('nav a[href="/"]')?.getAttribute('aria-current')).toBe('page');
      expect(pricing.hasAttribute('aria-current')).toBe(false);
    } finally {
      hosted.refuseCalls = false;
      await page.close();
    }
  });
});

describe('a route that opted in to the server under a `csr` default', { timeout: 120_000 }, () => {
  let hosted: Hosted;

  beforeAll(async () => {
    const root = await scratch('project');
    await cp(FIXTURE, root, { recursive: true });
    const routes = join(root, 'src/routes.ts');
    await writeFile(
      routes,
      (await readFile(routes, 'utf8')).replace(
        "{ path: 'pricing', component: Pricing,",
        "{ path: 'pricing', component: Pricing, mode: 'ssr',",
      ),
    );
    hosted = await host(root, { defaultMode: 'csr' });
  }, 120_000);

  afterAll(() => hosted.close());

  it('is claimed, because the server printed it', async () => {
    // The default is the application's and a route may still say otherwise —
    // the mode is resolved leaf to root. A client generated for the default
    // alone never attaches, and throws away every page a route asked the
    // server for.
    const page = await boot(hosted, '/pricing');
    try {
      expect(markOf(page.document.documentElement.outerHTML)).not.toBeNull();
      expect(page.errors).toEqual([]);
      expectClaimed(page);
    } finally {
      await page.close();
    }
  });

  it('is built in the browser where the default holds', async () => {
    const page = await boot(hosted, '/');
    try {
      expect(page.printed).toEqual([]);
      expect(page.errors).toEqual([]);
      expect(page.document.querySelector('#app .shell > article.home')).not.toBeNull();
    } finally {
      await page.close();
    }
  });
});

describe('a branch whose components arrive in chunks of their own', { timeout: 120_000 }, () => {
  let hosted: Hosted;

  beforeAll(async () => {
    // The layout and both pages behind an `import()` each. The server loads
    // them while it resolves; the client has to have loaded the same ones
    // before it attaches, or it claims a branch with nothing in it yet.
    const root = await scratch('project');
    await cp(FIXTURE, root, { recursive: true });
    await writeFile(
      join(root, 'src/routes.ts'),
      [
        "import { defineRoutes } from '@voltdev/router';",
        "import { currentPlan } from './api.js';",
        '',
        'export const routes = defineRoutes([',
        '  {',
        "    path: '/',",
        "    component: () => import('./shell.js').then((module) => module.Shell),",
        '    children: [',
        "      { index: true, component: () => import('./home.js').then((module) => module.Home) },",
        '      {',
        "        path: 'pricing',",
        "        component: () => import('./pricing.js').then((module) => module.Pricing),",
        '        loader: () => currentPlan(),',
        '      },',
        '    ],',
        '  },',
        ']);',
        '',
      ].join('\n'),
    );
    hosted = await host(root, true);
  }, 120_000);

  afterAll(() => hosted.close());

  it.each(['/', '/pricing'])('is claimed on %s, every node of it', async (path) => {
    const page = await boot(hosted, path);
    try {
      expect(page.errors).toEqual([]);
      expectClaimed(page);
      expect(page.document.querySelector(`nav a[href="${path}"]`)?.getAttribute('aria-current')).toBe(
        'page',
      );
    } finally {
      await page.close();
    }
  });

  it('navigates from it the moment it is claimed, keeping the layout', async () => {
    const page = await boot(hosted, '/pricing');
    try {
      const shell = page.document.querySelector('.shell');
      (page.document.querySelector('nav a[href="/"]') as HTMLElement).click();
      await until(() => page.document.querySelector('.shell > article.home') !== null);
      expect(page.errors).toEqual([]);
      expect(page.document.querySelector('.shell')).toBe(shell);
      expect(page.document.querySelector('nav a[href="/"]')?.getAttribute('aria-current')).toBe('page');
    } finally {
      await page.close();
    }
  });
});

describe('the values another build printed', { timeout: 120_000 }, () => {
  let hosted: Hosted;

  beforeAll(async () => {
    // A value the server settles on and the browser would start from: which
    // side made it is the value, so where the page's one came from shows.
    const root = await scratch('project');
    await cp(FIXTURE, root, { recursive: true });
    const component = join(root, 'src/pricing.ts');
    await writeFile(
      component,
      (await readFile(component, 'utf8'))
        .replace("import { Component } from '@voltdev/core';", "import { Component, hydratable } from '@voltdev/core';")
        .replace(
          'plan = routeData<string>();',
          "plan = routeData<string>();\n  side = hydratable('printed-by', () => (__VOLT_SERVER__ ? 'server' : 'browser'));",
        ),
    );
    const markup = join(root, 'src/pricing.html');
    await writeFile(
      markup,
      (await readFile(markup, 'utf8')).replace('</article>', '<em>{ side.get() }</em></article>'),
    );
    hosted = await host(root, true);
  }, 120_000);

  afterAll(() => hosted.close());

  it('are this build’s to start from when the page is', async () => {
    const page = await boot(hosted, '/pricing');
    try {
      expect(page.errors).toEqual([]);
      expectClaimed(page);
      expect(page.document.querySelector('article em')?.textContent).toBe('server');
    } finally {
      await page.close();
    }
  });

  it('are not, when the page is another build’s', async () => {
    // The markup is refused because its paths would land on the wrong nodes;
    // its payload's keys land on the wrong values for the same reason. A key
    // is a name an author chose, and the build that wrote the page may have
    // kept the name and changed what it holds — adopting it also tells the
    // component it need not fetch what it now shows.
    const page = await boot(hosted, '/pricing', (html) =>
      html.replace(/data-volt-build="[^"]+"/, 'data-volt-build="another.deadbeef"'),
    );
    try {
      expect(page.errors).toEqual([]);
      expect(page.document.querySelector('article em')?.textContent).toBe('browser');
    } finally {
      await page.close();
    }
  });
});

describe('a shell whose mount point the server cannot find', { timeout: 120_000 }, () => {
  /** The fixture with its mount point spelled another way, as a project might. */
  async function misspelled(): Promise<string> {
    const root = await scratch('project');
    await cp(FIXTURE, root, { recursive: true });
    const page = join(root, 'index.html');
    await writeFile(
      page,
      (await readFile(page, 'utf8')).replace('<div id="app"></div>', '<div id="app" class="page"></div>'),
    );
    return root;
  }

  it('fails the build rather than printing the page where the client never looks', async () => {
    // The client takes `#app` whatever else it says; the server looked for
    // one spelling and, not finding it, wrote the render after the whole
    // shell. The browser parses that into the end of the body, the client
    // finds an empty mount point with no mark and builds the page into it —
    // two copies, and the one the server sent never wakes.
    await expect(host(await misspelled(), true)).rejects.toThrow(/<div id="app"><\/div>/);
  });

  it('fails the request under `vite`, where the overlay says why, until the page is fixed', async () => {
    const root = await misspelled();
    const vite = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: volt({ serverRender: true }),
      resolve: { alias },
      server: { middlewareMode: true, ws: false },
    });
    const server = createHttpServer(vite.middlewares);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    // In middleware mode the overlay is fed over the client's hot channel, and
    // what is sent there is what a browser would be shown.
    const sent: HotPayload[] = [];
    vite.environments.client.hot.send = ((payload: HotPayload) => {
      sent.push(payload);
    }) as typeof vite.environments.client.hot.send;
    try {
      const { port } = server.address() as AddressInfo;
      const html = await (await fetch(`http://127.0.0.1:${port}/pricing`)).text();
      expect(html).not.toContain('<article class="pricing">');
      const error = sent.find((payload) => payload.type === 'error');
      expect(error, 'nothing reached the overlay').toBeDefined();
      expect((error as Extract<HotPayload, { type: 'error' }>).err.message).toContain(
        '<div id="app"></div>',
      );

      // And the edit the message asks for is the page the next request gets,
      // without a restart — the refusal must not be what stops it being seen.
      const page = join(root, 'index.html');
      await writeFile(
        page,
        (await readFile(page, 'utf8')).replace('<div id="app" class="page"></div>', '<div id="app"></div>'),
      );
      let fixed = '';
      for (let tries = 0; tries < 100 && !fixed.includes('<article class="pricing">'); tries++) {
        await new Promise((done) => setTimeout(done, 50));
        fixed = await (await fetch(`http://127.0.0.1:${port}/pricing`)).text();
      }
      expect(fixed).toContain('<article class="pricing">');
    } finally {
      await new Promise((done) => server.close(done));
      await vite.close();
    }
  });
});

describe('a page another build printed', { timeout: 120_000 }, () => {
  let hosted: Hosted;

  beforeAll(async () => {
    hosted = await host(FIXTURE, true);
  }, 120_000);

  afterAll(() => hosted.close());

  it('is built afresh rather than claimed', async () => {
    // Paths into another build's markup resolve; they land on the wrong
    // nodes. The mark says whose markup it is, and a client that is not that
    // build builds its own in place of it — once, not beside it.
    const page = await boot(hosted, '/pricing', (html) =>
      html.replace(/data-volt-build="[^"]+"/, 'data-volt-build="another.deadbeef"'),
    );
    try {
      expect(page.errors).toEqual([]);
      const now = nodesOf(page.document);
      expect(now.length).toBe(page.printed.length);
      expect(now.some((node) => page.printed.includes(node))).toBe(false);
      expect(page.document.querySelectorAll('.shell')).toHaveLength(1);
      expect(page.document.querySelector('article strong')?.textContent).toBe('Free');
      expect(page.document.querySelector('nav a[href="/pricing"]')?.getAttribute('aria-current')).toBe(
        'page',
      );
    } finally {
      await page.close();
    }
  });
});

describe('a page this build printed for another path', { timeout: 120_000 }, () => {
  let hosted: Hosted;

  beforeAll(async () => {
    hosted = await host(FIXTURE, true);
  }, 120_000);

  afterAll(() => hosted.close());

  it('is built afresh, not claimed by the route the address names', async () => {
    // A host that rewrites — `/` answered with what the handler renders for
    // `/pricing`, as an edge rule or a proxy does — hands the browser one
    // route's markup at another route's address. The client resolves the
    // address, and claiming would give the pricing page's nodes to the home
    // component: the roots are both `<article>`, which is all a claim
    // compares, so its paths would land wherever they land and nothing says
    // so.
    const page = await boot(hosted, '/', undefined, '/pricing');
    try {
      expect(page.errors).toEqual([]);
      expect(page.printed.some((node) => (node as Element).className === 'pricing')).toBe(true);
      expect(nodesOf(page.document).some((node) => page.printed.includes(node))).toBe(false);
      expect(page.document.querySelector('.shell > article.home')).not.toBeNull();
      expect(page.document.querySelector('article.pricing')).toBeNull();
      expect(page.document.querySelector('nav a[href="/"]')?.getAttribute('aria-current')).toBe('page');
    } finally {
      await page.close();
    }
  });
});

describe('a page the client builds again, in development', { timeout: 120_000 }, () => {
  let hosted: Hosted;

  beforeAll(async () => {
    hosted = await host(FIXTURE, true, 'development');
  }, 120_000);

  afterAll(() => hosted.close());

  it('says which build printed it and which is reading it', async () => {
    // Building again is the right answer and a quiet one: the reader sees the
    // page twice, and nothing says a cache or half a deploy is behind.
    const page = await boot(hosted, '/pricing', (html) =>
      html.replace(/data-volt-build="[^"]+"/, 'data-volt-build="another.deadbeef"'),
    );
    try {
      const mark = markOf(await (await fetch(hosted.origin + '/pricing')).text());
      expect(mark).not.toBeNull();
      expect(page.errors).toHaveLength(1);
      expect(String(page.errors[0])).toContain('build another.deadbeef');
      expect(String(page.errors[0])).toContain(`client is build ${mark}`);
      expect(page.document.querySelector('article strong')?.textContent).toBe('Free');
    } finally {
      await page.close();
    }
  });

  it('says which path it was printed for and where it was opened', async () => {
    const page = await boot(hosted, '/', undefined, '/pricing');
    try {
      expect(page.errors).toHaveLength(1);
      expect(String(page.errors[0])).toContain('rendered for /pricing and opened at /,');
      expect(page.document.querySelector('.shell > article.home')).not.toBeNull();
    } finally {
      await page.close();
    }
  });

  it('says nothing when it claims the page', async () => {
    const page = await boot(hosted, '/pricing');
    try {
      expect(page.errors).toEqual([]);
      expectClaimed(page);
    } finally {
      await page.close();
    }
  });
});
