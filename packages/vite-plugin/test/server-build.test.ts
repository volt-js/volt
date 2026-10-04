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
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';
import { createBuilder, createLogger, preview, type Logger, type Plugin } from 'vite';
import { buildPath } from '@voltdev/router';
import { volt, type VoltPluginOptions } from '../src/index.js';
import type { ParamsForPattern } from '../src/ssg.js';
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
  options: { plugins?: Plugin[]; volt?: VoltPluginOptions; logger?: Logger } = {},
): Promise<string> {
  const out = await scratch('dist');
  const builder = await createBuilder(
    {
      root,
      configFile: false,
      logLevel: 'silent',
      customLogger: options.logger,
      plugins: options.plugins ?? volt(options.volt ?? { serverRender: true }),
      resolve: { alias },
      build: { outDir: out, emptyOutDir: true },
    },
    null,
  );
  await builder.buildApp();
  return out;
}

/** A logger that keeps what the build says of its own, for a test to read. */
function listening(): { logger: Logger; said: string[] } {
  const said: string[] = [];
  const logger = createLogger('silent', { allowClearScreen: false });
  logger.info = (message) => {
    if (message.startsWith('[volt]')) said.push(message);
  };
  return { logger, said };
}

/** The pages a build wrote, by their path in its output. */
async function pagesOf(out: string): Promise<string[]> {
  return [...(await files(out)).keys()].filter((path) => path.endsWith('.html')).sort();
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

/**
 * The fixture with `ssg` routes in it: the home page, and a documentation
 * page whose pattern has a parameter. What `params` answers for that pattern
 * is what the build writes it for. Each documentation page shows the plan its
 * loader answered, which is `Team` for a reader who says who they are and
 * `Free` for one who does not.
 */
async function staticFixture(edit?: (root: string) => Promise<void>): Promise<string> {
  return copyOfFixture(async (root) => {
    const routes = join(root, 'src/routes.ts');
    await writeFile(
      routes,
      (await readFile(routes, 'utf8'))
        .replace(
          "import { Broken } from './broken.js';",
          "import { Broken } from './broken.js';\nimport { Doc } from './doc.js';",
        )
        .replace('{ index: true, component: Home },', "{ index: true, component: Home, mode: 'ssg' },")
        .replace(
          "{ path: 'broken', component: Broken },",
          "{ path: 'broken', component: Broken },\n" +
            "      { path: 'docs/:page', component: Doc, mode: 'ssg', loader: () => currentPlan() },",
        ),
    );
    await writeFile(
      join(root, 'src/doc.ts'),
      [
        "import { Component } from '@voltdev/core';",
        "import { routeData, useRouter } from '@voltdev/router';",
        "@Component({ selector: 'v-doc', templateUrl: './doc.html' })",
        'export class Doc {',
        '  router = useRouter();',
        '  plan = routeData<string>();',
        "  page(): string { return this.router.param('page') ?? ''; }",
        '}',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(root, 'src/doc.html'),
      '<article class="doc"><h1>{ page() }</h1><p>Plan: <strong>{ plan() }</strong></p></article>',
    );
    await edit?.(root);
  });
}

/** Put routes into a copy of the fixture's table, after the last of its own. */
async function addRoutes(root: string, ...routes: string[]): Promise<void> {
  const table = join(root, 'src/routes.ts');
  await writeFile(
    table,
    (await readFile(table, 'utf8')).replace(
      "{ path: 'broken', component: Broken },",
      ["{ path: 'broken', component: Broken },", ...routes].join('\n      '),
    ),
  );
}

/** What the documentation pattern is written for; nothing else has a parameter. */
const docs: ParamsForPattern = ({ pattern }) =>
  pattern === '/docs/:page' ? [{ page: 'intro' }, { page: 'install' }] : undefined;

describe('the pages a build writes for its `ssg` routes', { timeout: 120_000 }, () => {
  let root: string;
  let out: string;

  beforeAll(async () => {
    root = await staticFixture();
    out = await build(root, { volt: { serverRender: { params: docs } } });
  }, 120_000);

  it('writes each one where a static host serves its path from, and nothing for the rest', async () => {
    // `/docs/intro` as `docs/intro.html`, which Cloudflare, Netlify and GitHub
    // Pages serve at `/docs/intro` as they find it. `docs/intro/index.html`
    // they serve at `/docs/intro/`, and send `/docs/intro` there with a
    // redirect — and the address bar then names a path the page was not
    // rendered for, so the client builds it again rather than claiming it.
    const written = [...(await files(out)).keys()].filter((path) => path.endsWith('.html'));
    expect(written.sort()).toEqual([
      'client/docs/install.html',
      'client/docs/intro.html',
      'client/index.html',
    ]);
  });

  it('writes the bytes the handler answers a request for that path with', async () => {
    // The same page, so the client claims a page a host served as a file
    // exactly as it claims one the handler rendered: the build's mark, the
    // path's, the state payload and the loader answers are all in it.
    const handler = await handlerOf(out);
    for (const [path, file] of [
      ['/', 'client/index.html'],
      ['/docs/intro', 'client/docs/intro.html'],
    ] as const) {
      const answered = await (await handler(new Request(`http://localhost${path}`))).text();
      expect(await readFile(join(out, file), 'utf8')).toBe(answered);
      expect(markOf(answered)).not.toBeNull();
      expect(answered).toContain(`data-volt-path="${path}"`);
    }
    const intro = await readFile(join(out, 'client/docs/intro.html'), 'utf8');
    expect(intro).toContain('<article class="doc"><h1>intro</h1><p>Plan: <strong>Free</strong>');
    expect(intro).toMatch(/<script type="application\/json" data-volt-loaders>\{"\/docs\/intro":/);
  });

  it('is what the handler answers for that path whoever asks, so a host that sends it there gets the file', async () => {
    // A host that serves no files, or a path `params` did not name, reaches
    // the handler. An `ssg` page is everyone's by its own declaration, so the
    // handler renders it from the request the build did — not from this
    // reader's cookies, query or address, which would make it this reader's
    // page under an address that promises everyone the same one.
    const handler = await handlerOf(out);
    const asked = await handler(
      new Request('https://example.com/docs/intro?from=search', {
        headers: { 'x-user': 'ada', cookie: 'session=ada' },
      }),
    );
    expect(await asked.text()).toBe(await readFile(join(out, 'client/docs/intro.html'), 'utf8'));
    expect(asked.headers.get('cache-control')).toBeNull();
    // Not named, and the same page the build would have written for it.
    const unnamed = await (
      await handler(new Request('http://localhost/docs/upgrade', { headers: { 'x-user': 'ada' } }))
    ).text();
    expect(unnamed).toContain('<h1>upgrade</h1><p>Plan: <strong>Free</strong>');
  });

  it('is previewed from those files, as a host serves them, and the rest through the server', async () => {
    // Proved by editing a written page: what comes back is the file as it is
    // on disk, which a render could not have produced.
    const file = join(out, 'client/docs/intro.html');
    const page = await readFile(file, 'utf8');
    await writeFile(file, page.replace('</body>', '<!-- from the file --></body>'));
    const server = await preview({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: volt({ serverRender: { params: docs } }),
      build: { outDir: out },
      preview: { port: 0 },
    });
    try {
      const origin = server.resolvedUrls!.local[0]!.replace(/\/$/, '');
      const intro = await fetch(`${origin}/docs/intro`);
      expect(intro.status).toBe(200);
      expect(intro.headers.get('content-type')).toMatch(/^text\/html/);
      expect(await intro.text()).toContain('<!-- from the file -->');
      expect(await (await fetch(`${origin}/`)).text()).toBe(
        await readFile(join(out, 'client/index.html'), 'utf8'),
      );
      // Rendered per request as before: nothing was written for it.
      const pricing = await (await fetch(`${origin}/pricing`, { headers: { 'x-user': 'ada' } })).text();
      expect(pricing).toContain('<strong>Team</strong>');
      // The file is the page for `/docs/intro` asked for as a host serves a
      // file: with a GET. At `/docs/intro/` it would be a page at a path it
      // was not rendered for, which the client builds again rather than
      // claims, and a POST is no request a host answers with a file.
      const slashed = await (await fetch(`${origin}/docs/intro/`)).text();
      expect(slashed).not.toContain('<!-- from the file -->');
      expect(slashed).toContain('data-volt-path="/docs/intro/"');
      const posted = await (await fetch(`${origin}/docs/intro`, { method: 'POST' })).text();
      expect(posted).not.toContain('<!-- from the file -->');
      expect(posted).toContain('<h1>intro</h1>');
    } finally {
      await writeFile(file, page);
      await server.close();
    }
  });

  it('refuses an `ssg` pattern with a parameter nothing answered for, naming both', async () => {
    // A pattern with a parameter names no path on its own, and a page left
    // unwritten with no word said is indistinguishable from one the build
    // failed to see.
    await expect(build(root)).rejects.toThrow(/\/docs\/:page[\s\S]*serverRender[\s\S]*params/);
    // A configuration in JavaScript says nothing with `null` as readily as
    // with `undefined`, and only a list is an answer.
    const nothing = (() => null) as unknown as ParamsForPattern;
    await expect(build(root, { volt: { serverRender: { params: nothing } } })).rejects.toThrow(
      /\/docs\/:page[\s\S]*serverRender[\s\S]*params/,
    );
  });

  it('writes no page for a pattern `params` answers with none, and leaves its paths to the handler', async () => {
    // An empty list is an answer — a section with no pages in it yet — where
    // nothing at all is a pattern nobody said anything about. Each path of it
    // is then the handler's to render when it is asked for, as a path `params`
    // did not name is.
    const none: ParamsForPattern = ({ pattern }) => (pattern === '/docs/:page' ? [] : undefined);
    const out = await build(root, { volt: { serverRender: { params: none } } });
    const written = [...(await files(out)).keys()].filter((path) => path.endsWith('.html'));
    expect(written).toEqual(['client/index.html']);
    const asked = await (await handlerOf(out))(new Request('http://localhost/docs/intro'));
    expect(await asked.text()).toContain('<h1>intro</h1>');
  });

  it('leaves a path `params` names to the route rendered per request that answers it, and says so', async () => {
    // `/docs/changelog` is its own route, more specific than `/docs/:page`,
    // and rendered per request. A file written there from the pattern's page
    // would be what a host serves in its place, to every reader.
    const shadowed = await staticFixture(async (root) => {
      await addRoutes(root, "{ path: 'docs/changelog', component: Home },");
    });
    const named: ParamsForPattern = () => [{ page: 'intro' }, { page: 'changelog' }];
    const { logger, said } = listening();
    const out = await build(shadowed, { volt: { serverRender: { params: named } }, logger });
    expect(await pagesOf(out)).toEqual(['client/docs/intro.html', 'client/index.html']);
    expect(said.filter((line) => !line.includes(' kB'))).toEqual([
      '[volt] /docs/changelog is left to the handler rather than written from /docs/:page: ' +
        '/docs/changelog matches it ahead of /docs/:page, and does not render as `ssg`.',
    ]);
    const asked = await (await handlerOf(out))(new Request('http://localhost/docs/changelog'));
    expect(await asked.text()).toContain('<h1>Home</h1>');
    expect(asked.headers.get('cache-control')).toBe('private');
  });

  it('leaves `/` to the home page rendered per request, beside an `ssg` catch-all', async () => {
    // `/*` matches `/` by leaving `*` empty, and the index route names `/`
    // exactly, so a request for `/` renders the index, per request. A file
    // written there from the catch-all would be what a host serves instead.
    const root = await copyOfFixture((root) =>
      addRoutes(root, "{ path: '*', component: Home, mode: 'ssg' },"),
    );
    const { logger, said } = listening();
    const out = await build(root, { logger });
    expect(await pagesOf(out)).toEqual([]);
    expect(said).toEqual([
      '[volt] / is left to the handler rather than written from /*: / matches it ahead of /*, ' +
        'and does not render as `ssg`.',
    ]);
    const home = await (await handlerOf(out))(new Request('http://localhost/'));
    expect(home.headers.get('cache-control')).toBe('private');
  });

  it('still writes every path of a catch-all that nothing more specific answers', async () => {
    // Left to the handler per path, not per pattern: `/` and `/pricing` are
    // routes of their own, and `/guides/setup` is one only the built router
    // can see — `/guides/:slug` names no path until a request does — so the
    // build asks it, rather than writing a page over a route rendered per
    // request or failing.
    const root = await copyOfFixture((root) =>
      addRoutes(
        root,
        "{ path: 'guides/:slug', component: Home },",
        "{ path: '*', component: Home, mode: 'ssg' },",
      ),
    );
    const rests: ParamsForPattern = ({ pattern }) =>
      pattern === '/*'
        ? ['', 'gone', 'a/b', 'pricing', 'guides/setup'].map((rest) => ({ '*': rest }))
        : undefined;
    const { logger, said } = listening();
    const out = await build(root, { volt: { serverRender: { params: rests } }, logger });
    expect(await pagesOf(out)).toEqual(['client/a/b.html', 'client/gone.html']);
    expect(said.filter((line) => !line.includes(' kB'))).toEqual([
      '[volt] / is left to the handler rather than written from /*: / matches it ahead of /*, ' +
        'and does not render as `ssg`.',
      '[volt] /guides/setup is left to the handler rather than written from /*: a request for ' +
        'it renders another route, which does not render as `ssg`.',
      '[volt] /pricing is left to the handler rather than written from /*: /pricing matches it ' +
        'ahead of /*, and does not render as `ssg`.',
    ]);
    const handler = await handlerOf(out);
    const gone = await (await handler(new Request('http://localhost/gone'))).text();
    expect(await readFile(join(out, 'client/gone.html'), 'utf8')).toBe(gone);
    const setup = await handler(new Request('http://localhost/guides/setup'));
    expect(setup.headers.get('cache-control')).toBe('private');
  });

  it('leaves a literal path to its own route, whatever an optional parameter is given', async () => {
    const root = await copyOfFixture((root) =>
      addRoutes(
        root,
        "{ path: 'about', component: Home },",
        "{ path: ':lang?', component: Home, mode: 'ssg' },",
      ),
    );
    const langs: ParamsForPattern = ({ pattern }) =>
      pattern === '/:lang?' ? [{ lang: 'about' }, { lang: 'en' }] : undefined;
    const { logger, said } = listening();
    const out = await build(root, { volt: { serverRender: { params: langs } }, logger });
    expect(await pagesOf(out)).toEqual(['client/en.html']);
    expect(said.filter((line) => !line.includes(' kB'))).toEqual([
      '[volt] /about is left to the handler rather than written from /:lang?: /about matches it ' +
        'ahead of /:lang?, and does not render as `ssg`.',
    ]);
  });

  it('leaves an `ssg` route’s own path to it when `params` leaves that path out of its pages', async () => {
    // `/guides` is `/guides/:slug?` with the parameter left out, so a request
    // for it renders that route, whose list names `/guides/setup` alone. A
    // file there from the catch-all is a page that route's own list left out.
    const root = await copyOfFixture((root) =>
      addRoutes(
        root,
        "{ path: 'guides/:slug?', component: Home, mode: 'ssg' },",
        "{ path: '*', component: Home, mode: 'ssg' },",
      ),
    );
    const named: ParamsForPattern = ({ pattern }) =>
      pattern === '/guides/:slug?'
        ? [{ slug: 'setup' }]
        : pattern === '/*'
          ? ['guides', 'gone'].map((rest) => ({ '*': rest }))
          : undefined;
    const { logger, said } = listening();
    const out = await build(root, { volt: { serverRender: { params: named } }, logger });
    expect(await pagesOf(out)).toEqual(['client/gone.html', 'client/guides/setup.html']);
    expect(said.filter((line) => !line.includes(' kB'))).toEqual([
      '[volt] /guides is left to the handler rather than written from /*: /guides/:slug? ' +
        "matches it ahead of /*, and `params` leaves it out of that route's pages.",
    ]);
  });

  it('fails when a loader’s guard refuses the build’s request, rather than writing the failure', async () => {
    // The page is written once, by the build, so its loaders run there — with
    // a request that has nothing of a reader's in it. A guard that needs one
    // refuses, and that is the build's to report, not a page's to carry.
    const guarded = await staticFixture(async (root) => {
      const routes = join(root, 'src/routes.ts');
      await writeFile(
        routes,
        (await readFile(routes, 'utf8'))
          .replace("import { currentPlan } from './api.js';", "import { currentPlan, whoAmI } from './api.js';")
          .replace(
            "{ path: 'broken', component: Broken },",
            "{ path: 'broken', component: Broken },\n      { path: 'account', component: Home, mode: 'ssg', loader: () => whoAmI() },",
          ),
      );
      const api = join(root, 'src/api.ts');
      await writeFile(
        api,
        (await readFile(api, 'utf8')).replace(
          'const api = new Api();',
          [
            'export class Account {',
            '  @Server()',
            '  async whoAmI(): Promise<string> {',
            "    const who = await guard((request) => request.headers.get('x-user'));",
            '    return who;',
            '  }',
            '}',
            'const account = new Account();',
            'export const whoAmI = (): Promise<string> => account.whoAmI();',
            'const api = new Api();',
          ].join('\n'),
        ),
      );
    });
    const out = await scratch('dist');
    const builder = await createBuilder(
      {
        root: guarded,
        configFile: false,
        logLevel: 'silent',
        plugins: volt({ serverRender: { params: docs } }),
        resolve: { alias },
        build: { outDir: out, emptyOutDir: true },
      },
      null,
    );
    await expect(builder.buildApp()).rejects.toThrow(/\/account[\s\S]*no cookies[\s\S]*Unauthorized/);
    await expect(readFile(join(out, 'client/account.html'), 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('says where a page’s render failed, with the stack the server threw it with', async () => {
    // The page is rendered in the server's own thread, and what crosses back
    // is a message. Without the stack the build says what failed and not
    // where — a `TypeError` from somewhere in the application, with no line.
    const failing = await staticFixture(async (root) => {
      const routes = join(root, 'src/routes.ts');
      await writeFile(
        routes,
        (await readFile(routes, 'utf8')).replace(
          "{ path: 'broken', component: Broken },",
          "{ path: 'broken', component: Broken },\n" +
            "      { path: 'changelog', component: Home, mode: 'ssg', loader: () => readTheChangelog() },",
        ) +
          '\nfunction readTheChangelog(): string {\n' +
          "  throw new TypeError('the changelog is missing');\n" +
          '}\n',
      );
    });
    const failed = await build(failing, { volt: { serverRender: { params: docs } } }).catch(
      (error: unknown) => error,
    );
    expect(failed).toBeInstanceOf(Error);
    expect(inspect(failed)).toMatch(
      /\/changelog[\s\S]*the changelog is missing[\s\S]*at readTheChangelog \(file:/,
    );
  });

  it('refuses a page the handler answers with something other than a page', async () => {
    // `café` is spelled `caf%C3%A9` in a URL, and the router compares a
    // static segment as it is written, so no request reaches that route and
    // the handler answers its address 404. Written, the not-found page would
    // be a file a host serves at that address with a 200 — whether the route
    // says `ssg` itself or the application's default does.
    const unreachable = await staticFixture(async (root) => {
      const routes = join(root, 'src/routes.ts');
      await writeFile(
        routes,
        (await readFile(routes, 'utf8')).replace(
          "{ path: 'broken', component: Broken },",
          "{ path: 'broken', component: Broken, mode: 'ssr' },\n      { path: 'café', component: Home, mode: 'ssg' },",
        ),
      );
    });
    for (const defaultMode of ['ssg', 'ssr'] as const) {
      await expect(
        build(unreachable, { volt: { serverRender: { params: docs, defaultMode } } }),
      ).rejects.toThrow(/\/café[\s\S]*answered 404[\s\S]*no route matches/);
    }
  });

  it('fails, rather than waiting for ever, when the server ends while a page is being rendered', { timeout: 60_000 }, async () => {
    // A server that ends its own process on a fatal error is ending the
    // build's thread, with pages still owed. Each of them is a failure the
    // build reports; none of them is an answer to wait for.
    const exiting = await staticFixture(async (root) => {
      const routes = join(root, 'src/routes.ts');
      await writeFile(
        routes,
        (await readFile(routes, 'utf8')).replace(
          "{ path: 'broken', component: Broken },",
          "{ path: 'broken', component: Broken },\n" +
            "      { path: 'fatal', component: Home, mode: 'ssg', loader: () => new Promise(() => setTimeout(() => process.exit(3), 50)) },",
        ),
      );
    });
    await expect(
      build(exiting, { volt: { serverRender: { params: docs } } }),
    ).rejects.toThrow(/\/fatal[\s\S]*exited with code 3/);
  });

  it('says why it started the server, when the server cannot start in Node', async () => {
    // Started whatever the table says, because only the table in it can say
    // which routes are `ssg` — so a server that throws as it loads fails a
    // build with none, and the build has to say what it was doing — and,
    // since the server ran in a thread of its own, where in it the throw was.
    const unstartable = await copyOfFixture(async (root) => {
      const entry = join(root, 'server.ts');
      await writeFile(entry, `${await readFile(entry, 'utf8')}\nthrow new Error('not on this host');\n`);
    });
    await expect(build(unstartable)).rejects.toThrow(
      /imports the server it built, in Node[\s\S]*not on this host\n\s+at .*server\.js:\d+/,
    );
  });

  it('marks a page for the address a link to it has, whatever its parameter holds', async () => {
    // A link is built by the router, which encodes a parameter whole: `q&a`
    // is `/docs/q%26a` in the address bar. A host decodes that to find
    // `docs/q&a.html`, and the client claims what it serves only when the
    // page's path is the address it was opened at. `%41` is a value that
    // reads as an escape itself, and is decoded once, not twice.
    const values = ['q&a', 'c++', '%41'];
    const named: ParamsForPattern = ({ pattern }) =>
      pattern === '/docs/:page' ? values.map((page) => ({ page })) : undefined;
    const out = await build(root, { volt: { serverRender: { params: named } } });
    const handler = await handlerOf(out);
    for (const page of values) {
      const address = buildPath('/docs/:page', { page });
      const file = await readFile(join(out, `client/docs/${page}.html`), 'utf8');
      expect(file).toContain(`data-volt-path="${address.replaceAll('&', '&amp;')}"`);
      expect(file).toBe(await (await handler(new Request(`http://localhost${address}`))).text());
      await writeFile(join(out, `client/docs/${page}.html`), `${file}<!-- ${page} -->`);
    }
    const server = await preview({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: volt({ serverRender: { params: named } }),
      build: { outDir: out },
      preview: { port: 0 },
    });
    try {
      const origin = server.resolvedUrls!.local[0]!.replace(/\/$/, '');
      for (const page of values) {
        const served = await fetch(origin + buildPath('/docs/:page', { page }));
        expect(await served.text()).toContain(`<!-- ${page} -->`);
      }
    } finally {
      await server.close();
    }
  });

  it('finds the pages of a server whose entry imports the handler only when asked', async () => {
    // An entry that keeps its first request cheap imports the handler behind
    // an `import()`, which puts the generated module in a chunk of its own —
    // one that importing the entry never evaluates.
    const lazy = await staticFixture(async (root) => {
      await writeFile(
        join(root, 'server.ts'),
        [
          'export default {',
          "  fetch: async (request: Request) => (await import('virtual:volt/server')).handler(request),",
          '};',
          '',
        ].join('\n'),
      );
    });
    const out = await build(lazy, { volt: { serverRender: { params: docs } } });
    const written = [...(await files(out)).keys()].filter((path) => path.endsWith('.html'));
    expect(written.sort()).toEqual([
      'client/docs/install.html',
      'client/docs/intro.html',
      'client/index.html',
    ]);
    const handler = await handlerOf(out);
    expect(await readFile(join(out, 'client/docs/intro.html'), 'utf8')).toBe(
      await (await handler(new Request('http://localhost/docs/intro'))).text(),
    );
  });

  it('ends once the pages are written, whatever the server started as it loaded', async () => {
    // A server that sweeps a cache on a timer from the moment it loads is an
    // ordinary one, and the build starts it to write the pages. Vite's CLI
    // ends a build by having nothing left to run, so a timer the server left
    // in the build's process is a `vite build` that never ends.
    const sweeping = await staticFixture(async (root) => {
      const entry = join(root, 'server.ts');
      await writeFile(entry, `${await readFile(entry, 'utf8')}\nsetInterval(() => {}, 60_000);\n`);
      await writeFile(
        join(root, 'vite.config.ts'),
        [
          `import { volt } from ${JSON.stringify(join(import.meta.dirname, '../src/index.ts'))};`,
          `import { alias } from ${JSON.stringify(join(import.meta.dirname, 'server-render-fixture.ts'))};`,
          "const params = ({ pattern }) => (pattern === '/docs/:page' ? [{ page: 'intro' }] : undefined);",
          "export default { plugins: [volt({ serverRender: { params } })], resolve: { alias }, logLevel: 'silent' };",
          '',
        ].join('\n'),
      );
    });
    const vite = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin/vite.js');
    const ended = await new Promise<Error | null>((resolve) => {
      execFile(
        process.execPath,
        [vite, 'build', '--configLoader', 'runner'],
        { cwd: sweeping, timeout: 60_000 },
        (error) => resolve(error),
      );
    });
    expect(ended).toBeNull();
    expect(await readFile(join(sweeping, 'dist/client/docs/intro.html'), 'utf8')).toContain(
      '<h1>intro</h1>',
    );
  });

  it('writes a page with a component in a chunk of its own as a warm server answers it', async () => {
    // The build renders each page in a server that has loaded nothing yet,
    // and a server that has been answering for an hour has every chunk. The
    // file is the page either way, or a host sends one and the handler the
    // other for the same path.
    const charted = await staticFixture(async (root) => {
      await cp(join(import.meta.dirname, 'fixtures/server-render-lazy'), join(root, 'src'), {
        recursive: true,
      });
      const routes = join(root, 'src/routes.ts');
      await writeFile(
        routes,
        (await readFile(routes, 'utf8'))
          .replace(
            "import { Broken } from './broken.js';",
            "import { Broken } from './broken.js';\nimport { Charts } from './charts.js';",
          )
          .replace(
            "{ path: 'broken', component: Broken },",
            "{ path: 'broken', component: Broken },\n      { path: 'charts', component: Charts, mode: 'ssg' },",
          ),
      );
    });
    const out = await build(charted, { volt: { serverRender: { params: docs } } });
    const file = await readFile(join(out, 'client/charts.html'), 'utf8');
    expect(file).toContain('<p class="meter">');
    expect(file).not.toContain('Loading the meter');
    const handler = await handlerOf(out);
    const cold = await (await handler(new Request('http://localhost/charts'))).text();
    const warm = await (await handler(new Request('http://localhost/charts'))).text();
    expect(cold).toBe(file);
    expect(warm).toBe(file);
  });

  it('refuses a page named `index`, whose file a host serves at another path', async () => {
    // `/index` is written as `index.html`, which is `/`'s file, and
    // `/docs/index` as `docs/index.html`, which a host serves at `/docs/`. A
    // content directory with an `index.md` in it names such a page as readily
    // as any other, and the file would be another path's page to every reader
    // a host serves it to.
    const pages = await staticFixture(async (root) => {
      const routes = join(root, 'src/routes.ts');
      await writeFile(
        routes,
        (await readFile(routes, 'utf8')).replace(
          "{ path: 'broken', component: Broken },",
          "{ path: 'broken', component: Broken },\n      { path: ':page', component: Doc, mode: 'ssg' },",
        ),
      );
    });
    for (const [pattern, path, file] of [
      ['/:page', '/index', 'index.html'],
      ['/docs/:page', '/docs/index', 'docs/index.html'],
    ] as const) {
      const named: ParamsForPattern = (route) =>
        route.pattern === pattern
          ? [{ page: 'intro' }, { page: 'index' }]
          : route.pattern === '/:page' || route.pattern === '/docs/:page'
            ? []
            : undefined;
      const out = await scratch('dist');
      const builder = await createBuilder(
        {
          root: pages,
          configFile: false,
          logLevel: 'silent',
          plugins: volt({ serverRender: { params: named } }),
          resolve: { alias },
          build: { outDir: out, emptyOutDir: true },
        },
        null,
      );
      await expect(builder.buildApp()).rejects.toThrow(
        new RegExp(`${path}[\\s\\S]*${file.replace('.', '\\.')}`),
      );
      // Refused before a page is rendered, so none of them is left behind.
      const written = [...(await files(out)).keys()].filter((name) => name.endsWith('.html'));
      expect(written).toEqual([]);
    }
  });

  it('writes each page with the ids it has rendered alone, though the build renders several at once', async () => {
    // The build renders its pages side by side in one server, and the handler
    // renders whichever path it is asked for after whatever it answered
    // before. An id is the element's position, so each page has its own
    // whichever renders beside it or before it — and the file, the handler's
    // answer and the client that claims either agree on it.
    const minted = await staticFixture(async (root) => {
      const doc = join(root, 'src/doc.ts');
      await writeFile(
        doc,
        (await readFile(doc, 'utf8'))
          .replace("import { Component } from '@voltdev/core';", "import { Component, createId } from '@voltdev/core';")
          .replace('  router = useRouter();', "  router = useRouter();\n  title = createId('doc');"),
      );
      await writeFile(
        join(root, 'src/doc.html'),
        '<article class="doc" :aria-labelledby="title"><h1 :id="title">{ page() }</h1><p>Plan: <strong>{ plan() }</strong></p></article>',
      );
    });
    const pages = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const many: ParamsForPattern = ({ pattern }) =>
      pattern === '/docs/:page' ? pages.map((page) => ({ page })) : undefined;
    const out = await build(minted, { volt: { serverRender: { params: many } } });
    const handler = await handlerOf(out);
    const ids = new Set<string>();
    for (const page of pages.toReversed()) {
      const file = await readFile(join(out, `client/docs/${page}.html`), 'utf8');
      ids.add(/<h1 id="([^"]+)"/.exec(file)?.[1] ?? '');
      expect(file).toBe(await (await handler(new Request(`http://localhost/docs/${page}`))).text());
    }
    expect([...ids]).toHaveLength(1);
    expect([...ids][0]).toMatch(/^doc-/);
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
