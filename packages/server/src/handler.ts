/**
 * The server half: one `(Request) => Response` over the Fetch standard.
 *
 * Volt does not ship an HTTP server, and the reason is in the roadmap: a
 * handler of this shape already runs on Node, Bun, Deno and Cloudflare
 * Workers, and inside Fastify or Hono for anyone who wants their middleware.
 * Owning a server would constrain deployment to buy a benchmark number.
 *
 * Everything here is about one sentence: **every server function is a public
 * HTTP endpoint, reachable by anyone with curl.** So this file is written from
 * the outside in — what an unauthenticated stranger can send, and what they
 * learn from each answer — rather than from the call site, which is exactly
 * the view `todos.create(text)` hides.
 */

import { ServerError } from './errors.js';
import { withRequest } from './guard.js';
import { lookupServerFunction, type ServerFunction } from './registry.js';
import { fromWire, toWire, WireError } from './serialize.js';

/**
 * The header a Volt client always sends, and the reason the endpoints are not
 * a CSRF hazard.
 *
 * Authentication is read from the request, which means cookies, which means
 * any page on the internet can make a browser POST here with them attached.
 * A custom header cannot be set by a cross-origin form or `<img>`; sending one
 * forces a preflight that this handler never answers. That, plus refusing any
 * content type a form can produce, is what stops the drive-by.
 */
const CALL_HEADER = 'x-volt-call';

export interface HandlerOptions {
  /**
   * URL prefix the endpoints answer under. Must match the client's; see
   * `configureServerCalls`.
   */
  base?: string;
  /**
   * Everything that escaped a server function, including what the caller was
   * not told. This is the only place an unexpected failure is visible, so a
   * handler without it throws away its own incident reports.
   */
  onError?(error: unknown, context: ErrorContext): void;
  /**
   * Largest request body accepted, in bytes. Defaults to 1 MiB.
   *
   * A public endpoint with no ceiling is a memory exhaustion primitive that
   * needs no account, so there is one by default rather than on request.
   */
  maxBodyBytes?: number;
}

export interface ErrorContext {
  /** The endpoint id, which is what appears in an access log. */
  endpoint: string;
  /** `Todos.create` — the name the id was derived from. */
  name: string;
  request: Request;
}

const DEFAULT_MAX_BODY = 1024 * 1024;

/** `/_volt/`, normalised so `_volt`, `/_volt` and `/_volt/` all mean it. */
function normalizeBase(base: string): string {
  const withLead = base.startsWith('/') ? base : `/${base}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

export const DEFAULT_BASE = '/_volt/';

/**
 * Whether `request` is a Volt server-function call.
 *
 * For mounting inside another framework: `createHandler` answers 404 for
 * anything that is not its own, which is right for a handler that owns the
 * process and wrong for one route among many.
 */
export function isServerCall(request: Request, base: string = DEFAULT_BASE): boolean {
  return (
    request.method === 'POST' && new URL(request.url).pathname.startsWith(normalizeBase(base))
  );
}

function fail(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function createHandler(options: HandlerOptions = {}): (request: Request) => Promise<Response> {
  const base = normalizeBase(options.base ?? DEFAULT_BASE);
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: { message: 'Method Not Allowed' } }), {
        status: 405,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          allow: 'POST',
        },
      });
    }

    const path = new URL(request.url).pathname;
    if (!path.startsWith(base)) return fail(404, 'Not Found');
    const endpoint = path.slice(base.length);

    if (!request.headers.has(CALL_HEADER)) {
      return fail(403, `Missing ${CALL_HEADER} header`);
    }
    // A form can only send three content types, none of them this one, so
    // insisting on it is the second half of the cross-site check.
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.split(';')[0]!.trim().toLowerCase().startsWith('application/json')) {
      return fail(415, 'Expected application/json');
    }

    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBody) return fail(413, 'Payload Too Large');

    // An id nobody registered and a path nobody serves answer the same way. An
    // endpoint table is not a secret, but there is no reason to help enumerate
    // one either.
    const fn = lookupServerFunction(endpoint);
    if (!fn) return fail(404, 'Not Found');

    let args: unknown[];
    try {
      // Bounded as the bytes arrive rather than measured once they are all
      // here; `readBounded` says why that distinction is the whole point.
      const body = await readBounded(request, maxBody);
      if (body === null) return fail(413, 'Payload Too Large');
      const parsed = JSON.parse(body) as { args?: unknown };
      if (!Array.isArray(parsed.args)) return fail(400, 'Expected { args: [...] }');
      args = parsed.args.map((arg) => fromWire(arg, 'an argument'));
    } catch (error) {
      return fail(400, error instanceof WireError ? error.message : 'Malformed request body');
    }

    return invoke(fn, args, request, options);
  };
}

/**
 * The body, or `null` once it has sent more than `limit` bytes.
 *
 * Read a chunk at a time rather than through `request.text()`, because the
 * ceiling has to be enforced *while* the bytes arrive to be a ceiling at all.
 * Buffering first and measuring after is a check that has already lost: the
 * memory it was meant to bound is allocated by the time it runs, which is the
 * entire attack. `content-length` is not a substitute either — a chunked
 * request declares none, and the header is the caller's claim about themselves.
 *
 * The count is of bytes off the wire, not of what they decode to. A string
 * length would be counting UTF-16 units, and a body of astral-plane characters
 * would be twice the size the limit thinks it allowed.
 */
async function readBounded(request: Request, limit: number): Promise<string | null> {
  const stream = request.body;
  if (!stream) return '';

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) return null;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    // Releases the connection whether the body ended or the limit did.
    await reader.cancel().catch(() => {});
  }
  return text + decoder.decode();
}

async function invoke(
  fn: ServerFunction,
  args: unknown[],
  request: Request,
  options: HandlerOptions,
): Promise<Response> {
  try {
    // Constructed per call rather than once, so nothing a method assigns to
    // `this` outlives the request that assigned it. A server function's class
    // is a namespace; it is not a place to keep a session.
    const instance = new (fn.target as new () => Record<string, unknown>)();
    const method = instance[fn.method] as (...rest: unknown[]) => Promise<unknown>;
    // `withRequest` covers the synchronous prologue only, which is the entire
    // window in which `guard` may read the request. See `guard.ts`.
    const result = await withRequest(request, () => method.apply(instance, args));

    return new Response(JSON.stringify({ value: toWire(result, 'the return value') }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    options.onError?.(error, { endpoint: fn.id, name: fn.name, request });
    // Only a `ServerError` was written to be read by a stranger. Everything
    // else — a driver's message, a stack, a missing environment variable — is
    // reconnaissance, and the caller gets the status alone.
    if (error instanceof ServerError) return fail(error.status, error.message);
    return fail(500, 'Internal Server Error');
  }
}
