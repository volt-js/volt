/**
 * The client half: what a stripped `@Server()` method becomes.
 *
 * Generated code calls `callServer` and nothing else, so this module is the
 * entire server-function cost of a browser bundle. It is kept apart from
 * `index.ts` for that reason — importing the handler, the registry or the
 * guards from a page would put the server's half of the feature in the
 * browser, and a stripped body is worth very little next to that.
 *
 * There are no `__VOLT_DEV__` guards here. This package has to run in a Node
 * or edge process that no bundler touched, where an undefined global is a
 * crash rather than a message, and the two entries share their serializer.
 */

import { fromWire, toWire } from './serialize.js';

export class ServerCallError extends Error {
  /** HTTP status, or 0 when the request never got an answer. */
  readonly status: number;
  /** The endpoint id, which is what a server log has to correlate against. */
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = 'ServerCallError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

export interface ServerCallOptions {
  /**
   * Where the endpoints are mounted. Must match the handler's `base`, and may
   * carry an origin for a server that is not the page's own.
   */
  base?: string;
  /** Replaces `globalThis.fetch` — a test double, or an instrumented one. */
  fetch?: typeof globalThis.fetch;
  /** Sent with every call, for a tracing or tenant header. */
  headers?: Record<string, string>;
}

let base = '/_volt/';
let extra: Record<string, string> | undefined;
let doFetch: typeof globalThis.fetch | undefined;

export function configureServerCalls(options: ServerCallOptions): void {
  if (options.base !== undefined) {
    base = options.base.endsWith('/') ? options.base : `${options.base}/`;
  }
  if (options.headers !== undefined) extra = options.headers;
  if (options.fetch !== undefined) doFetch = options.fetch;
}

/**
 * @internal The body of every stripped `@Server()` method.
 *
 * The custom header is not decoration: it is what makes these endpoints
 * unreachable from a cross-site form, since a browser will not send one
 * without a preflight the handler never answers.
 */
export async function callServer(endpoint: string, args: unknown[]): Promise<unknown> {
  const send = doFetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await send(base + endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-volt-call': '1', ...extra },
      body: JSON.stringify({ args: args.map((arg) => toWire(arg, 'an argument')) }),
    });
  } catch (error) {
    throw new ServerCallError(
      error instanceof Error ? error.message : 'The request failed',
      0,
      endpoint,
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | { value?: unknown; error?: { message?: string } }
    | null;

  if (!response.ok) {
    // A proxy's HTML 502 parses as nothing, so the status line is the fallback
    // rather than an empty message.
    throw new ServerCallError(
      payload?.error?.message || response.statusText || `HTTP ${response.status}`,
      response.status,
      endpoint,
    );
  }
  if (payload === null) {
    throw new ServerCallError('The response was not JSON', response.status, endpoint);
  }
  return fromWire(payload.value, 'the return value');
}
