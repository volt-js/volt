/**
 * `vite` answering through the application's own handler, and `vite preview`
 * through the one it built.
 *
 * Without this the dev server knows nothing about `serverRender`: a navigation
 * is answered by Vite's HTML fallback with the shell and an empty mount point,
 * and a server-function call by the static middleware with a 404. The project
 * a person develops in would be a client-rendered one whatever its
 * configuration said, and the server half would first run in production.
 *
 * `node:` imports are fine here. The rule `renderPath` enforces is about what
 * the application's render can reach, and this is the build tool, which only
 * ever runs in Node.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { TLSSocket } from 'node:tls';
import { pathToFileURL } from 'node:url';
import type { Connect, ViteDevServer } from 'vite';
import { builtEntry } from './server-build.js';

type Handler = (request: Request) => Promise<Response> | Response;

/**
 * The middleware that hands a request to the server entry.
 *
 * Installed after Vite's own, so its client, the modules it compiles and
 * anything in `public/` are answered before a request can reach here. What
 * falls through is exactly a navigation or a server-function call.
 *
 * The entry is imported through the `ssr` environment's module runner on every
 * request rather than once. The runner keeps what it evaluated and drops what
 * an edit invalidated, so this is a lookup, and it is what makes an edited
 * route or loader the one the next request runs.
 */
export function serverRenderMiddleware(
  server: ViteDevServer,
  entry: string,
): Connect.NextHandleFunction {
  return (req, res, next) => {
    void answer(server, entry, req, res).catch((error: unknown) => {
      // Vite's error middleware, next in line, is what shows the overlay. The
      // stack is already the source's: the runner maps it as the module is
      // evaluated, and mapping it a second time would move every line.
      next(error instanceof Error ? error : new Error(String(error)));
    });
  };
}

async function answer(
  server: ViteDevServer,
  entry: string,
  req: Connect.IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Here rather than at the top of the module: this only ever runs inside a
  // dev server, where Vite is loaded already, while the plugin is also
  // imported by builds, scripts and tests that would otherwise load all of it
  // for one type guard.
  const { isRunnableDevEnvironment } = await import('vite');
  const environment = server.environments['ssr'];
  if (!environment || !isRunnableDevEnvironment(environment)) {
    // Falling through would answer every page 404 and say nothing about why.
    throw new Error(
      `[volt] serverRender runs ${entry} in the dev server's \`ssr\` environment, and that ` +
        'environment cannot run modules in this process. Another plugin has replaced it; ' +
        'serverRender needs the one Vite creates.',
    );
  }

  const loaded = (await environment.runner.import(entry)) as { default?: { fetch?: Handler } };
  const handler = loaded.default?.fetch;
  if (typeof handler !== 'function') {
    throw new Error(
      `[volt] ${entry} does not export the handler the way a host expects one. ` +
        "It needs `import { handler } from 'virtual:volt/server'` and " +
        '`export default { fetch: handler }`.',
    );
  }

  // Sent as the handler wrote it. Vite's HTML transform has been over the
  // shell already, when the shell was loaded, and is never run over a render:
  // it is written for a file that is the same for every reader, and keeps
  // what it makes of a page's attributes under that page's URL — so given two
  // readers' renders of one URL at once, it hands each whichever it finished
  // last. It would also rewrite what the render wrote, which no deploy does.
  await sendResponse(res, await handler(toRequest(req)));
}

/**
 * The middleware that hands a request to the built server, for `vite preview`.
 *
 * Installed after the preview server's own, which serve the client build's
 * files — so a preview is the deployment the docs describe, the files first
 * and everything else through the server bundle's `fetch`. Without it the
 * preview answered every page 404: the page is no longer a file in the
 * client's directory, and nothing else there could render it.
 *
 * Loaded once, from `directory` — a preview is of one build, and a new build
 * is a new preview.
 */
export function previewMiddleware(directory: string, entry: string): Connect.NextHandleFunction {
  let loaded: Promise<Handler> | null = null;
  return (req, res, next) => {
    loaded ??= loadBuilt(directory, entry);
    void loaded
      .then(async (handler) => sendResponse(res, await handler(toRequest(req))))
      .catch((error: unknown) => {
        next(error instanceof Error ? error : new Error(String(error)));
      });
  };
}

async function loadBuilt(directory: string, entry: string): Promise<Handler> {
  const file = builtEntry(directory, entry);
  if (file === null) {
    throw new Error(
      `[volt] \`vite preview\` answers pages with the server build of ${entry}, and there is ` +
        `none in ${directory}. Run \`vite build\` first.`,
    );
  }
  const loaded = (await import(pathToFileURL(file).href)) as { default?: { fetch?: Handler } };
  const handler = loaded.default?.fetch;
  if (typeof handler !== 'function') {
    throw new Error(`[volt] ${file} does not export \`default.fetch\`, which is what a host calls.`);
  }
  return handler;
}

/**
 * A Node request as the web `Request` the handler takes.
 *
 * The body is passed through as a stream rather than read first, so a
 * server-function call arrives with its bytes and the handler's own limit on
 * them still applies as they arrive. See `bodyOf` for why it is not
 * `Readable.toWeb`.
 */
export function toRequest(req: IncomingMessage): Request {
  const protocol = (req.socket as TLSSocket).encrypted ? 'https' : 'http';
  const host = req.headers.host ?? req.headers[':authority'] ?? 'localhost';
  const url = new URL(req.url ?? '/', `${protocol}://${String(host)}`);

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    // HTTP/2's pseudo-headers are part of the request line, not headers, and
    // `Headers` refuses the colon.
    if (value === undefined || name.startsWith(':')) continue;
    for (const each of Array.isArray(value) ? value : [value]) headers.append(name, each);
  }

  const bodyless = req.method === 'GET' || req.method === 'HEAD';
  return new Request(url, {
    method: req.method,
    headers,
    body: bodyless ? null : bodyOf(req),
    // Required for a streamed body: the request is still arriving while the
    // handler runs.
    duplex: 'half',
  } as RequestInit);
}

/**
 * A request's body as a web stream that reads the socket only when it is read.
 *
 * Not `Readable.toWeb`, which starts reading the moment it is called. Node
 * discards what is left of a body once the response has ended, but only when
 * nothing has started reading it — and a handler answers plenty of requests
 * without reading them: a call to a function nobody registered, a declared
 * length over the limit, a form posted to a page. The rest of such a body
 * stayed in the socket, in front of the next request on that connection,
 * which then waited for good.
 *
 * Read on demand, a body nobody reads is Node's to discard as it is for any
 * other middleware. One the handler stops reading part-way is cancelled, and
 * the rest is discarded here, the way Node would have.
 */
function bodyOf(req: IncomingMessage): ReadableStream<Uint8Array> {
  let chunks: AsyncIterator<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        // Kept rather than destroyed when the handler lets go of it, because
        // destroying a request destroys its connection, and the response to
        // it has not been written yet.
        chunks ??= req.iterator({ destroyOnReturn: false });
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      async cancel() {
        await chunks?.return?.();
        req.resume();
      },
    },
    // Nothing is read ahead of the handler asking for it.
    { highWaterMark: 0 },
  );
}

/**
 * The handler's `Response`, written to Node's as it stands: the status, every
 * header, and the body streamed rather than read into memory first.
 */
export async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  if (response.statusText) res.statusMessage = response.statusText;
  for (const [name, value] of response.headers) {
    // Joined into one line by `Headers`, which a browser would read as one
    // cookie; they are set apart below.
    if (name === 'set-cookie') continue;
    res.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);

  if (!response.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as NodeReadableStream), res);
}
