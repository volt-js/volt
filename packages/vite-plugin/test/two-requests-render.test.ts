// @vitest-environment node
//
// Node's own `Request` and `Response`, which are what a host hands the built
// handler — a DOM environment's would be the thing being tested instead.

/**
 * Two requests at once, through the handler `vite build` writes: the rest of
 * what one render collects for itself.
 *
 * `two-requests.test.ts` holds each reader to their own location, loader
 * answer and payload. A render also collects styles, mints ids, reads route
 * parameters and can fail — each through state the process holds on the
 * render's behalf — and each is one more thing the reader who finishes last
 * could find the other reader's in. So each test parks one request mid-render
 * while another runs through the same process, and lets them finish in the
 * order that would show a leak.
 *
 * Two more places one reader's page can reach another are here as well: a
 * cache in front of the host, which keeps pages by URL, and the query cache,
 * which the application provides and the handler does not.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBuilder } from 'vite';
import { volt } from '../src/index.js';
import { FIXTURE, alias as fixtureAlias } from './server-render-fixture.js';

/** The fixture's own, and the query cache, which only this project uses. */
const alias = [
  { find: /^@voltdev\/query$/, replacement: join(import.meta.dirname, '../../query/src/index.ts') },
  ...fixtureAlias,
];

type Handler = (request: Request) => Promise<Response>;

/** On `globalThis` because the bundle is a module of its own. */
interface Gates {
  __hold?: (name: string) => Promise<void>;
}

const made: string[] = [];
let handler: Handler;

/** Hold every name in `names` until it is released; see `two-requests.test.ts`. */
function gates(...names: string[]): {
  reached: (name: string) => Promise<void>;
  release: (name: string) => void;
} {
  const arrive = new Map<string, () => void>();
  const arrived = new Map<string, Promise<void>>();
  const open = new Map<string, () => void>();
  const opened = new Map<string, Promise<void>>();
  for (const name of names) {
    arrived.set(name, new Promise((done) => arrive.set(name, done)));
    opened.set(name, new Promise((done) => open.set(name, done)));
  }
  (globalThis as Gates).__hold = (name) => {
    arrive.get(name)?.();
    return opened.get(name) ?? Promise.resolve();
  };
  return {
    reached: (name) => arrived.get(name)!,
    release: (name) => open.get(name)!(),
  };
}

const request = (path: string, user: string): Promise<Response> =>
  handler(new Request(`http://x${path}`, { headers: { 'x-user': user } }));

async function page(path: string, user: string): Promise<string> {
  const response = await request(path, user);
  expect(response.status).toBe(200);
  return response.text();
}

/** Every `<style>` the page carries, in order. */
const styles = (html: string): string[] =>
  [...html.matchAll(/<style>([^<]*)<\/style>/g)].map((match) => match[1]!);

/** Every id the render minted, in document order. */
const ids = (html: string): string[] => [...html.matchAll(/ id="(v-[^"]+)"/g)].map((match) => match[1]!);

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'volt-two-requests-render-'));
  const out = await mkdtemp(join(tmpdir(), 'volt-two-requests-render-dist-'));
  made.push(root, out);
  await cp(FIXTURE, root, { recursive: true });

  await writeFile(
    join(root, 'src/api.ts'),
    [
      "import { Server, guard } from '@voltdev/server';",
      '',
      'const hold = (name: string): Promise<void> =>',
      '  (globalThis as { __hold?: (name: string) => Promise<void> }).__hold?.(name) ?? Promise.resolve();',
      '',
      'export class Api {',
      '  @Server()',
      '  async greeting(): Promise<string> {',
      "    const who = await guard((request) => ({ user: request.headers.get('x-user') ?? 'anonymous' }));",
      '    await hold(`greeting for ${who.user}`);',
      '    return `hello ${who.user}`;',
      '  }',
      '}',
      '',
      'const api = new Api();',
      '',
      'export const greeting = (): Promise<string> => api.greeting();',
      '',
    ].join('\n'),
  );

  // A page that styles itself, mints an id, shows a route parameter and waits
  // for a second round: everything a render collects, on a page that is parked
  // between its rounds for as long as the test likes.
  await writeFile(
    join(root, 'src/profile.ts'),
    [
      "import { Component, createId, dataEffect, hydratable, trackRequestData } from '@voltdev/core';",
      "import { useRouter } from '@voltdev/router';",
      "import { greeting } from './api.js';",
      '',
      '@Component({',
      "  selector: 'v-profile',",
      "  templateUrl: './profile.html',",
      "  styles: '.profile { color: rebeccapurple }',",
      '})',
      'export class Profile {',
      '  router = useRouter();',
      "  label = createId('v-profile');",
      "  greeting = hydratable('greeting', () => '');",
      '  constructor() {',
      '    dataEffect(() => {',
      '      trackRequestData(greeting().then((text) => this.greeting.set(text)));',
      '    });',
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(root, 'src/profile.html'),
    '<article class="profile"><h1 :id="label">User <b>{ router.param(\'id\') }</b></h1></article>',
  );

  await writeFile(
    join(root, 'src/about.ts'),
    [
      "import { Component, createId } from '@voltdev/core';",
      '',
      '@Component({',
      "  selector: 'v-about',",
      "  templateUrl: './about.html',",
      "  styles: '.about { color: teal }',",
      '})',
      'export class About {',
      "  label = createId('v-about');",
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(join(root, 'src/about.html'), '<article class="about"><h1 :id="label">About</h1></article>');

  // A page whose second round fails: its data effect asks, and throws once the
  // answer is in — after another request has had the whole process to itself.
  await writeFile(
    join(root, 'src/fails.ts'),
    [
      "import { Component, dataEffect, hydratable, trackRequestData } from '@voltdev/core';",
      "import { greeting } from './api.js';",
      '',
      "@Component({ selector: 'v-fails', templateUrl: './fails.html' })",
      'export class Fails {',
      "  answer = hydratable('answer', () => '');",
      '  constructor() {',
      '    dataEffect(() => {',
      "      if (this.answer.get() !== '') throw new Error(`failed for ${this.answer.get()}`);",
      '      trackRequestData(greeting().then((text) => this.answer.set(text)));',
      '    });',
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(join(root, 'src/fails.html'), '<article class="fails">never sent</article>');

  // The query cache where a `serverRender` application can put one: in its
  // root, whose field initializers run once per render — once per request on
  // the server, once per page in a browser.
  await writeFile(
    join(root, 'src/app.ts'),
    [
      "import { Component } from '@voltdev/core';",
      "import { createQueryClient, provideQueryClient } from '@voltdev/query';",
      "import { useRouter } from '@voltdev/router';",
      '',
      "@Component({ selector: 'v-app', templateUrl: './app.html' })",
      'export default class App {',
      '  router = useRouter();',
      '  cache = provideQueryClient(createQueryClient());',
      '  here(path: string): \'page\' | undefined {',
      "    return this.router.pathname() === path ? 'page' : undefined;",
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(root, 'src/plan.ts'),
    [
      "import { Component } from '@voltdev/core';",
      "import { createQuery } from '@voltdev/query';",
      "import { greeting } from './api.js';",
      '',
      "@Component({ selector: 'v-plan', templateUrl: './plan.html' })",
      'export class Plan {',
      "  plan = createQuery({ key: ['greeting'], fetcher: () => greeting() });",
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(join(root, 'src/plan.html'), '<p class="plan">[{ plan.data() }]</p>');

  await writeFile(
    join(root, 'src/routes.ts'),
    [
      "import { defineRoutes } from '@voltdev/router';",
      "import { About } from './about.js';",
      "import { Fails } from './fails.js';",
      "import { Home } from './home.js';",
      "import { Plan } from './plan.js';",
      "import { Profile } from './profile.js';",
      "import { Shell } from './shell.js';",
      '',
      'export const routes = defineRoutes([',
      '  {',
      "    path: '/',",
      '    component: Shell,',
      '    children: [',
      '      { index: true, component: Home },',
      "      { path: 'users/:id', component: Profile },",
      "      { path: 'about', component: About, mode: 'ssg' },",
      "      { path: 'fails', component: Fails },",
      "      { path: 'plan', component: Plan },",
      '    ],',
      '  },',
      ']);',
      '',
    ].join('\n'),
  );

  const builder = await createBuilder(
    {
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: volt({ serverRender: true }),
      resolve: { alias },
      build: { outDir: out, emptyOutDir: true },
    },
    null,
  );
  await builder.buildApp();
  const entry = pathToFileURL(join(out, 'server/server.js')).href;
  handler = ((await import(/* @vite-ignore */ entry)) as { default: { fetch: Handler } }).default
    .fetch;
}, 120_000);

afterAll(async () => {
  delete (globalThis as Gates).__hold;
  await Promise.all(made.map((path) => rm(path, { recursive: true, force: true })));
});

describe('two requests at once', { timeout: 60_000 }, () => {
  it('each carry the styles of their own page and none of the other’s', async () => {
    const gate = gates('greeting for ada');
    const ada = page('/users/ada', 'ada');
    await gate.reached('greeting for ada');

    // Another page, whole, while the first is parked between its rounds with
    // its styles collected and not yet written.
    const about = await page('/about', 'grace');
    gate.release('greeting for ada');
    const profile = await ada;

    expect(styles(profile)).toEqual(['.profile { color: rebeccapurple }']);
    expect(styles(about)).toEqual(['.about { color: teal }']);
  });

  it('each mint ids from their own tree, as though the other were not there', async () => {
    const gate = gates('greeting for ada', 'greeting for grace');
    const ada = page('/users/ada', 'ada');
    await gate.reached('greeting for ada');
    const grace = page('/users/grace', 'grace');
    await gate.reached('greeting for grace');
    gate.release('greeting for grace');
    const graced = await grace;
    gate.release('greeting for ada');
    const adas = await ada;

    // Position, not order of arrival: the same tree gets the same ids, which
    // is also what the client arrives at without being told.
    expect(ids(adas)).toHaveLength(1);
    expect(ids(adas)).toEqual(ids(graced));
    expect(ids(await page('/users/linus', 'linus'))).toEqual(ids(adas));
  });

  it('each read their own route parameter and payload', async () => {
    const gate = gates('greeting for ada', 'greeting for grace');
    const ada = page('/users/ada', 'ada');
    await gate.reached('greeting for ada');
    const grace = page('/users/grace', 'grace');
    await gate.reached('greeting for grace');
    gate.release('greeting for grace');
    const graced = await grace;
    gate.release('greeting for ada');
    const adas = await ada;

    expect(adas).toContain('User <b>ada</b>');
    expect(adas).toContain('"greeting":"hello ada"');
    expect(adas).not.toContain('grace');
    expect(graced).toContain('User <b>grace</b>');
    expect(graced).toContain('"greeting":"hello grace"');
    expect(graced).not.toContain('ada');
  });

  it('keep a failure to the request that failed', async () => {
    const gate = gates('greeting for ada', 'greeting for grace');
    const failing = request('/fails', 'ada');
    await gate.reached('greeting for ada');
    const grace = page('/users/grace', 'grace');
    await gate.reached('greeting for grace');

    // The failure lands while the other request is parked between its rounds,
    // with its scope, its lanes and its frame all set aside rather than gone.
    gate.release('greeting for ada');
    const failed = await failing;
    gate.release('greeting for grace');
    const graced = await grace;

    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('grace');
    expect(graced).toContain('User <b>grace</b>');
    expect(graced).toContain('"greeting":"hello grace"');
    expect(styles(graced)).toEqual(['.profile { color: rebeccapurple }']);

    // And nothing the failure interrupted is left for whoever comes next.
    gates();
    const after = await page('/users/linus', 'linus');
    expect(after).toContain('User <b>linus</b>');
    expect(ids(after)).toEqual(ids(graced));
  });
});

describe('a page one reader was rendered', { timeout: 60_000 }, () => {
  // A cache between the host and its readers — a CDN, a proxy — keys what it
  // keeps by URL. An `ssr` page is rendered per request because it depends on
  // who asked: the guards its loaders and functions ran read this request.
  // Kept by URL, it is the next reader's page too. A server function's answer
  // says `no-store` for the same reason; the page carrying that answer in its
  // markup has to say it as well.
  it('tells a shared cache it is that reader’s alone', async () => {
    gates();
    const response = await request('/users/ada', 'ada');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toMatch(/\bprivate\b/);
  });

  it('says nothing to a cache when it is the same for everyone', async () => {
    // An `ssg` page says so of itself, and a shell with nothing rendered into
    // it has nothing of anybody's in it: a cache keeping those is the point.
    gates();
    expect((await request('/about', 'ada')).headers.get('cache-control')).toBeNull();
    expect((await request('/nowhere', 'ada')).headers.get('cache-control')).toBeNull();
  });
});

describe('a query cache provided in the root', { timeout: 60_000 }, () => {
  /** What the walk found in the cache for this reader, as it wrote it. */
  const cached = (html: string): string | undefined => /<p class="plan">\[([^\]]*)\]<\/p>/.exec(html)?.[1];

  it('is one reader’s, so the next reader’s walk finds nothing of it', async () => {
    gates();
    // One after the other, so the first reader's answer is in whatever cache
    // it went into before the second reader's walk reads the same key.
    const ada = await page('/plan', 'ada');
    const grace = await page('/plan', 'grace');

    expect(cached(ada)).toBe('');
    expect(cached(grace)).toBe('');
    expect(grace).not.toContain('ada');
  });

  it('is one reader’s while another reader’s is still filling', async () => {
    const gate = gates('greeting for ada', 'greeting for grace');
    const ada = page('/plan', 'ada');
    await gate.reached('greeting for ada');
    const grace = page('/plan', 'grace');
    await gate.reached('greeting for grace');
    gate.release('greeting for ada');
    const adas = await ada;
    gate.release('greeting for grace');
    const graced = await grace;

    expect(adas).not.toContain('grace');
    expect(graced).not.toContain('ada');
  });
});
