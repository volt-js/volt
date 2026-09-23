// @vitest-environment node
//
// Node's own `Request`, `Response` and `fetch`, because the middleware under
// test turns a Node request into a web one and back — and a DOM environment's
// versions of those would be the thing being tested instead.

/**
 * `vite` goes through the handler.
 *
 * Before this, the dev server knew nothing about `serverRender`: a navigation
 * was answered by Vite's own HTML fallback with the shell and an empty mount
 * point, and a server-function call was answered 404 by the static middleware.
 * So the project a person develops in was a client-rendered one whatever the
 * configuration said, and the server half was first run in production.
 *
 * A real dev server, over a real project, asked over HTTP — because what is
 * being claimed is the order of middlewares in a stack Vite assembles, and
 * nothing short of a request through that stack can show it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { Agent, createServer as createHttpServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type HotPayload, type ViteDevServer } from 'vite';
import { volt } from '../src/index.js';
import { FIXTURE, alias, claimOf, markOf, planEndpoint } from './server-render-fixture.js';

interface Running {
  vite: ViteDevServer;
  http: Server;
  origin: string;
}

/**
 * The dev server in middleware mode, behind a Node server of the test's own —
 * which is how a project with its own server embeds it, and the mode in which
 * nothing of Vite's answers a request the stack did not.
 */
async function start(root: string = FIXTURE): Promise<Running> {
  const vite = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [volt({ serverRender: true })],
    resolve: { alias },
    // No socket: nothing here listens for updates, and two servers in one
    // process would otherwise fight over the one port.
    server: { middlewareMode: true, ws: false },
  });
  const http = createHttpServer(vite.middlewares);
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  const { port } = http.address() as AddressInfo;
  return { vite, http, origin: `http://127.0.0.1:${port}` };
}

async function stop(running: Running): Promise<void> {
  await new Promise((done) => running.http.close(done));
  await running.vite.close();
}

let running: Running;

beforeAll(async () => {
  running = await start();
}, 60_000);

afterAll(async () => {
  await stop(running);
});

const get = (path: string, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(running.origin + path, { headers });

describe('a navigation', { timeout: 60_000 }, () => {
  it('is answered by the handler, with the route rendered and Vite’s client in the page', async () => {
    const response = await get('/pricing', { 'x-user': 'ada' });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    // The leaf, inside the layout, inside the root — and with the answer its
    // loader got from a guarded server function, which is only there if the
    // loader ran with this request lent to it.
    expect(html).toMatch(
      /<main><section class="shell"><article class="pricing">.*<strong>Team<\/strong>/s,
    );
    // Vite's transform ran over the shell the page was written into: without
    // it the page has no module graph to update and no overlay to report to.
    expect(html).toContain('/@vite/client');
    // A dev page asks for the source entry, which the dev server compiles on
    // request. The built one is a different story, told in server-build.test.ts.
    expect(html).toContain('src="/src/main.ts"');
  });

  it('gets the shell from the project’s own index.html', async () => {
    const html = await (await get('/pricing')).text();
    expect(html).toContain('<title>server-render fixture</title>');
  });

  it('takes an edit to index.html on a later request, without a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'volt-dev-'));
    await cp(FIXTURE, root, { recursive: true });
    const edited = await start(root);
    try {
      const title = async (): Promise<string | undefined> =>
        /<title>([^<]*)<\/title>/.exec(await (await fetch(`${edited.origin}/pricing`)).text())?.[1];
      expect(await title()).toBe('server-render fixture');

      const file = join(root, 'index.html');
      await writeFile(file, (await readFile(file, 'utf8')).replace('server-render fixture', 'edited'));
      // The watcher's notice is asynchronous; a request made before it lands
      // still gets the page as it was.
      let seen = await title();
      for (let tries = 0; seen !== 'edited' && tries < 100; tries++) {
        await new Promise((done) => setTimeout(done, 100));
        seen = await title();
      }
      expect(seen).toBe('edited');
    } finally {
      await stop(edited);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('answers a URL the table does not match with the handler’s 404', async () => {
    const response = await get('/nowhere');
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('/@vite/client');
  });
});

describe('a server-function call', { timeout: 60_000 }, () => {
  it('reaches the function and answers with its result', async () => {
    const response = await fetch(`${running.origin}/_volt/${planEndpoint()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-volt-call': '1', 'x-user': 'ada' },
      body: JSON.stringify({ args: [] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: 'Team' });
  });

  it('carries the request it arrived with, so the guard reads this caller', async () => {
    const response = await fetch(`${running.origin}/_volt/${planEndpoint()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-volt-call': '1' },
      body: JSON.stringify({ args: [] }),
    });
    expect(await response.json()).toEqual({ value: 'Free' });
  });
});

describe('a body the handler does not read to the end', { timeout: 60_000 }, () => {
  /**
   * Requests made one after another on a single kept-alive connection, which
   * is how a browser sends a page's next request after a POST: what one
   * request leaves unread in the socket is in front of the next.
   */
  function oneConnection(): {
    send: (path: string, init?: { headers?: Record<string, string>; body?: string[] }) => Promise<{
      status: number;
      reused: boolean;
    }>;
    close: () => void;
  } {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const send = (
      path: string,
      { headers = {}, body }: { headers?: Record<string, string>; body?: string[] } = {},
    ): Promise<{ status: number; reused: boolean }> =>
      new Promise((done, fail) => {
        const req = httpRequest(
          running.origin + path,
          { method: body ? 'POST' : 'GET', agent, headers },
          (res) => {
            res.resume();
            res.on('end', () => done({ status: res.statusCode!, reused: req.reusedSocket }));
          },
        );
        // Far longer than a page takes to render here; a request still
        // unanswered after it is one that will never be.
        req.setTimeout(5_000, () => req.destroy(new Error(`${path} was never answered`)));
        req.on('error', fail);
        for (const chunk of body ?? []) req.write(chunk);
        req.end();
      });
    return { send, close: () => agent.destroy() };
  }

  /** A call's headers, and a body far larger than what a socket buffers. */
  const call = { 'content-type': 'application/json', 'x-volt-call': '1' };
  const large = (): string[] => Array.from({ length: 8 }, () => 'x'.repeat(64 * 1024));

  it('leaves the connection usable when the handler answers without reading it', async () => {
    // A call to a function nobody registered is refused before its body is
    // read — as is a call with the wrong headers, or a form's POST to a page.
    // Node discards what is left of a body nobody started reading; a body
    // that was started on is left where it is, in front of the next request.
    const connection = oneConnection();
    try {
      const body = large();
      const refused = await connection.send('/_volt/nobody-registered-this', {
        headers: { ...call, 'content-length': String(body.join('').length) },
        body,
      });
      expect(refused.status).toBe(404);

      const next = await connection.send('/pricing');
      expect(next.reused, 'the second request did not share the first one’s connection').toBe(true);
      expect(next.status).toBe(200);
    } finally {
      connection.close();
    }
  });

  it('leaves the connection usable when the handler stops reading at its limit', async () => {
    // Sent in chunks with no declared length, so the only way to find it too
    // large is to read it — up to the limit, and not a byte further.
    const connection = oneConnection();
    try {
      const refused = await connection.send(`/_volt/${planEndpoint()}`, {
        headers: call,
        body: [...large(), ...large(), ...large()],
      });
      expect(refused.status).toBe(413);

      const next = await connection.send('/pricing');
      expect(next.reused, 'the second request did not share the first one’s connection').toBe(true);
      expect(next.status).toBe(200);
    } finally {
      connection.close();
    }
  });
});

describe('what Vite serves itself', { timeout: 60_000 }, () => {
  it('never reaches the handler', async () => {
    // Registered after Vite's own middlewares, so its client, the modules it
    // compiles and anything in `public/` are answered before a request could
    // fall through to a page render.
    const client = await get('/@vite/client');
    expect(client.status).toBe(200);
    expect(client.headers.get('content-type')).toMatch(/javascript/);

    const entry = await get('/src/main.ts');
    expect(entry.status).toBe(200);
    expect(entry.headers.get('content-type')).toMatch(/javascript/);
    expect(await entry.text()).toContain('virtual:volt/client');
  });

  it('answers a file in `public/` as the file, not as a page', async () => {
    // A 404 page from the handler would also be an answer, and a wrong one: a
    // crawler asking for this would be sent the application's shell.
    const response = await get('/robots.txt');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await response.text()).toBe('User-agent: *\nAllow: /\n');
  });
});

describe('the identity a dev page carries', { timeout: 60_000 }, () => {
  it('is the one the client compares before it claims the page', async () => {
    const mark = markOf(await (await get('/pricing')).text());
    const client = await (await get('/@id/__x00__virtual:volt/client')).text();

    expect(mark).not.toBeNull();
    expect(claimOf(client)).toBe(mark);
  });

  it('is this session’s, and keeps the compiler’s hash as its first part', async () => {
    // A page printed by the server before a restart is markup from a build
    // that no longer exists, whatever the compiler says; the templates may
    // have been edited in between. Two sessions of the same project on the
    // same compiler therefore differ — and agree on the part that says which
    // compiler it was.
    const first = markOf(await (await get('/pricing')).text())!;
    const other = await start();
    try {
      const second = markOf(await (await fetch(`${other.origin}/pricing`)).text())!;
      expect(second).not.toBe(first);
      expect(second.split('.')[0]).toBe(first.split('.')[0]);
    } finally {
      await stop(other);
    }
  });
});

describe('a page that throws', { timeout: 60_000 }, () => {
  it('reaches Vite’s overlay, with the stack pointing at the line that threw', async () => {
    // In middleware mode the overlay is fed over the client's hot channel;
    // listening on it is listening to exactly what a browser would be shown.
    const sent: HotPayload[] = [];
    const hot = running.vite.environments.client.hot;
    const send = hot.send;
    hot.send = ((payload: HotPayload) => {
      sent.push(payload);
    }) as typeof hot.send;
    // The runner maps a stack through Node's own source-map support, which
    // Node only applies when nobody has replaced `Error.prepareStackTrace`.
    // The test runner has, for its own modules; a `vite` process has not. Set
    // aside for this one request, so what is read is what a developer sees.
    const prepare = Error.prepareStackTrace;
    Error.prepareStackTrace = undefined;
    try {
      await get('/broken');
    } finally {
      Error.prepareStackTrace = prepare;
      hot.send = send;
    }

    const error = sent.find((payload) => payload.type === 'error');
    expect(error, 'nothing reached the overlay').toBeDefined();
    const { message, stack } = (error as Extract<HotPayload, { type: 'error' }>).err;
    expect(message).toContain('broken on purpose');
    // The source file and the line of the `throw`, not a line of the
    // transformed module the runner evaluated.
    expect(stack).toContain('server-render/src/broken.ts:10:');
  });
});
