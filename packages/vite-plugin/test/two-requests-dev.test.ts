// @vitest-environment node
//
// Node's own `Request`, `Response` and `fetch`, because the middleware under
// test turns a Node request into a web one and back — and a DOM environment's
// versions of those would be the thing being tested instead.

/**
 * Two requests at once, through `vite`.
 *
 * `two-requests.test.ts` holds the built handler to giving each reader a page
 * of their own. Under `vite` the same handler answers, and then the page goes
 * through one more thing a deploy does not have: the dev server's own HTML
 * pipeline, which is shared by every request the dev server is answering and
 * was written for a file that is the same for all of them.
 *
 * A real dev server, over a real project, asked over HTTP.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Plugin, type RunnableDevEnvironment, type ViteDevServer } from 'vite';
import { volt } from '../src/index.js';
import { FIXTURE, alias } from './server-render-fixture.js';

/**
 * A plugin whose `transform` does asynchronous work, as most do.
 *
 * This one holds the first stylesheet it is handed until a second arrives, or
 * for half a second when none does. That is the interleaving a dev server
 * serving two readers produces by chance whenever any plugin in the project
 * awaits anything; holding it here makes the chance a certainty.
 */
function awaitsInTransform(): Plugin {
  let waiting: (() => void) | null = null;
  return {
    name: 'test:awaits-in-transform',
    enforce: 'post',
    async transform(_code, id) {
      if (!/\.css\b/.test(id)) return null;
      if (waiting) {
        waiting();
        waiting = null;
        return null;
      }
      await new Promise<void>((done) => {
        waiting = done;
        setTimeout(done, 500);
      });
      return null;
    },
  };
}

let root: string;
let vite: ViteDevServer;
let http: Server;
let origin: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'volt-two-requests-dev-'));
  await cp(FIXTURE, root, { recursive: true });

  // The plan is the reader's own name, so a page that shows anybody else's is
  // one reader handed another's.
  await writeFile(
    join(root, 'src/api.ts'),
    [
      "import { Server, guard } from '@voltdev/server';",
      '',
      'export class Api {',
      '  @Server()',
      '  async currentPlan(): Promise<string> {',
      "    const who = await guard((request) => ({ user: request.headers.get('x-user') ?? 'anonymous' }));",
      '    return who.user;',
      '  }',
      '}',
      '',
      'const api = new Api();',
      '',
      'export const currentPlan = (): Promise<string> => api.currentPlan();',
      '',
    ].join('\n'),
  );
  // An avatar is the ordinary shape of a per-reader `url()`: a background
  // image named after whoever is looking.
  await writeFile(
    join(root, 'src/pricing.html'),
    '<article class="pricing">' +
      `<div class="avatar" :style="'background-image: url(/avatars/' + plan() + '.png)'"></div>` +
      '<p>Your plan: <strong>{ plan() }</strong></p>' +
      '</article>',
  );

  vite = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [volt({ serverRender: true }), awaitsInTransform()],
    resolve: { alias },
    server: { middlewareMode: true, ws: false },
  });
  http = createHttpServer(vite.middlewares);
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  await new Promise((done) => http.close(done));
  await vite.close();
  await rm(root, { recursive: true, force: true });
});

/** The page a reader is sent, as the parts that name them. */
async function pricingFor(user: string): Promise<{ plan?: string; avatar?: string }> {
  const html = await (await fetch(`${origin}/pricing`, { headers: { 'x-user': user } })).text();
  return {
    plan: /<strong>([^<]*)<\/strong>/.exec(html)?.[1],
    avatar: /class="avatar" style="([^"]*)"/.exec(html)?.[1],
  };
}

describe('two readers of one page at once, under vite', { timeout: 60_000 }, () => {
  it('each get their own page, down to what the render wrote in an attribute', async () => {
    const [ada, grace] = await Promise.all([pricingFor('ada'), pricingFor('grace')]);

    expect(ada.plan).toBe('ada');
    expect(grace.plan).toBe('grace');
    expect(ada.avatar).toContain('/avatars/ada.png');
    expect(grace.avatar).toContain('/avatars/grace.png');
  });

  it('get the page the handler wrote, with nothing of it rewritten on the way out', async () => {
    // The same bytes the handler answers with, as a deploy would send them. A
    // dev server that rewrites a render is one where the page developed
    // against is not the page shipped — and the rewriting is where the reader
    // above was handed someone else's avatar.
    const { handler } = (await (vite.environments['ssr'] as RunnableDevEnvironment).runner.import(
      '/server.ts',
    )) as { handler: (request: Request) => Promise<Response> };
    const written = await (
      await handler(new Request(`${origin}/pricing`, { headers: { 'x-user': 'ada' } }))
    ).text();
    const sent = await (await fetch(`${origin}/pricing`, { headers: { 'x-user': 'ada' } })).text();

    expect(sent).toBe(written);
    // And that page is still one the dev server can update and report to.
    expect(sent).toContain('/@vite/client');
  });
});
