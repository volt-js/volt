// @vitest-environment node
//
// Node's own `Request` and `Response`, which are what a host hands the built
// handler — a DOM environment's would be the thing being tested instead.

/**
 * Two requests at once, through the handler `vite build` writes.
 *
 * A server answers many readers in one process, interleaved at every `await`,
 * and anything one of them can see of another is one user handed another
 * user's page. Each test here holds one request mid-flight — inside a loader,
 * or between two rounds of its render — while another runs through the same
 * process, and then lets them finish in the order that would expose whatever
 * they shared: the last one to write a shared thing wins it, so the one that
 * wrote first and reads last is the one that shows a leak.
 *
 * The real builder over a real project, so what is shared is what a deploy
 * shares: one copy of every module, one route table, one shell, one build.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBuilder } from 'vite';
import { volt } from '../src/index.js';
import { FIXTURE, alias, markOf } from './server-render-fixture.js';

type Handler = (request: Request) => Promise<Response>;

/**
 * Where the built project waits, by name, until the test lets it go.
 *
 * On `globalThis` because the bundle is a module of its own and this is the
 * one object both see.
 */
interface Gates {
  __hold?: (name: string) => Promise<void>;
}

const made: string[] = [];
let handler: Handler;

/** The page this project's routes answer, reduced to what a reader sees of it. */
async function get(path: string, user: string): Promise<string> {
  const response = await handler(new Request(`http://x${path}`, { headers: { 'x-user': user } }));
  expect(response.status).toBe(200);
  return response.text();
}

/**
 * Hold every name in `names` until it is released.
 *
 * `reached` settles once the project has arrived at the name, which is how a
 * test knows the request is parked there and the other can be started.
 */
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

/** The text of the `<strong>` a pricing page shows its plan in. */
const plan = (html: string): string | undefined => /<strong>([^<]*)<\/strong>/.exec(html)?.[1];

/** The state payload a page carries, as the client will read it. */
function payload(html: string): Record<string, unknown> {
  const json = /<script type="application\/json" data-volt-state[^>]*>(.*?)<\/script>/s.exec(html)?.[1];
  return json === undefined ? {} : (JSON.parse(json) as Record<string, unknown>);
}

/** Which link the page marks as the one the reader is on. */
const current = (html: string): string | undefined =>
  /<a href="([^"]+)" aria-current="page"/.exec(html)?.[1];

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'volt-two-requests-'));
  const out = await mkdtemp(join(tmpdir(), 'volt-two-requests-dist-'));
  made.push(root, out);
  await cp(FIXTURE, root, { recursive: true });

  // The fixture's own shape — one instance of the class at module scope, as
  // the server-function reference writes it — with each answer held where the
  // test can reach it, and a method that keeps what its guard said on `this`
  // across an `await`. Nothing about that is exotic: it is a method, and the
  // documented promise is that nothing it assigns to `this` outlives the
  // request that assigned it.
  await writeFile(
    join(root, 'src/api.ts'),
    [
      "import { Server, guard } from '@voltdev/server';",
      '',
      'const hold = (name: string): Promise<void> =>',
      '  (globalThis as { __hold?: (name: string) => Promise<void> }).__hold?.(name) ?? Promise.resolve();',
      '',
      'export class Api {',
      "  private user = 'nobody';",
      '',
      '  @Server()',
      '  async currentPlan(): Promise<string> {',
      "    const who = await guard((request) => ({ user: request.headers.get('x-user') ?? 'anonymous' }));",
      '    this.user = who.user;',
      '    await hold(`plan for ${this.user}`);',
      '    return `Team for ${this.user}`;',
      '  }',
      '',
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
      'export const currentPlan = (): Promise<string> => api.currentPlan();',
      'export const greeting = (): Promise<string> => api.greeting();',
      '',
    ].join('\n'),
  );
  // A second round of the render, and a value that crosses in the payload
  // rather than the markup: a data effect asks during the first flush, the
  // answer lands between rounds, and the request waits for it.
  await writeFile(
    join(root, 'src/pricing.ts'),
    [
      "import { Component, dataEffect, hydratable, trackRequestData } from '@voltdev/core';",
      "import { routeData } from '@voltdev/router';",
      "import { greeting } from './api.js';",
      '',
      "@Component({ selector: 'v-pricing', templateUrl: './pricing.html' })",
      'export class Pricing {',
      '  plan = routeData<string>();',
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

  // A route whose loader reaches for request state, as one would to carry its
  // answer to the browser: a loader runs before the render's request scope
  // exists, so whatever it files there is filed with no request around it.
  await writeFile(
    join(root, 'src/routes.ts'),
    [
      "import { hydratable } from '@voltdev/core';",
      "import { defineRoutes } from '@voltdev/router';",
      "import { currentPlan } from './api.js';",
      "import { Home } from './home.js';",
      "import { Pricing } from './pricing.js';",
      "import { Shell } from './shell.js';",
      '',
      'const carriedPlan = (): Promise<string> => {',
      "  const plan = hydratable<string | undefined>('plan', () => undefined);",
      '  return currentPlan().then((value) => {',
      '    plan.set(value);',
      '    return value;',
      '  });',
      '};',
      '',
      'export const routes = defineRoutes([',
      '  {',
      "    path: '/',",
      '    component: Shell,',
      '    children: [',
      '      { index: true, component: Home },',
      "      { path: 'pricing', component: Pricing, loader: () => currentPlan() },",
      "      { path: 'plans', component: Pricing, loader: carriedPlan },",
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
  it('each get their own page, when one is held in its loader while the other runs', async () => {
    const gate = gates('plan for ada', 'greeting for ada');
    const pricing = get('/pricing', 'ada');
    await gate.reached('plan for ada');

    // The whole of another page, start to finish, while the first is parked
    // in the middle of resolving: a router, an outlet and a location of its
    // own, or one of the two shows the other's.
    const home = await get('/', 'grace');

    gate.release('plan for ada');
    await gate.reached('greeting for ada');
    gate.release('greeting for ada');
    const priced = await pricing;

    expect(home).toContain('<article class="home">');
    expect(home).not.toContain('<article class="pricing">');
    expect(current(home)).toBe('/');

    expect(priced).toContain('<article class="pricing">');
    expect(priced).not.toContain('<article class="home">');
    expect(current(priced)).toBe('/pricing');
    expect(plan(priced)).toBe('Team for ada');

    // One build answered both, so both carry its one mark.
    expect(markOf(home)).not.toBeNull();
    expect(markOf(priced)).toBe(markOf(home));
  });

  it('each get their own loader answer, when the loaders finish in the other order', async () => {
    const gate = gates('plan for ada', 'plan for grace', 'greeting for ada', 'greeting for grace');
    const ada = get('/pricing', 'ada');
    await gate.reached('plan for ada');
    const grace = get('/pricing', 'grace');
    await gate.reached('plan for grace');

    // Ada asked first and is answered last: whatever her call wrote where
    // Grace's could write it too, Grace's write is the one Ada now reads.
    gate.release('plan for grace');
    await gate.reached('greeting for grace');
    gate.release('greeting for grace');
    const graced = await grace;
    gate.release('plan for ada');
    await gate.reached('greeting for ada');
    gate.release('greeting for ada');
    const adas = await ada;

    expect(plan(graced)).toBe('Team for grace');
    expect(plan(adas)).toBe('Team for ada');
  });

  it('each keep their later rounds and their payload, when the rounds interleave', async () => {
    const gate = gates('plan for ada', 'plan for grace', 'greeting for ada', 'greeting for grace');
    gate.release('plan for ada');
    gate.release('plan for grace');

    // Both renders parked between their first and second rounds at once, and
    // let go in the other order to the one they arrived in.
    const ada = get('/pricing', 'ada');
    await gate.reached('greeting for ada');
    const grace = get('/pricing', 'grace');
    await gate.reached('greeting for grace');
    gate.release('greeting for grace');
    const graced = await grace;
    gate.release('greeting for ada');
    const adas = await ada;

    expect(payload(adas)).toEqual({ greeting: 'hello ada' });
    expect(payload(graced)).toEqual({ greeting: 'hello grace' });
    expect(plan(adas)).toBe('Team for ada');
    expect(plan(graced)).toBe('Team for grace');
  });
});

describe('state a loader files', { timeout: 60_000 }, () => {
  it('is not kept for the next request, which would see the first one\'s', async () => {
    gates();
    // Sequential, and still two requests: nothing is in flight between them,
    // so whatever the second finds was left in the process by the first.
    const ada = await get('/plans', 'ada');
    const grace = await get('/plans', 'grace');

    expect(plan(ada)).toBe('Team for ada');
    expect(plan(grace)).toBe('Team for grace');
    expect(JSON.stringify(payload(grace))).not.toContain('ada');
  });
});
