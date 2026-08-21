// @vitest-environment node

/**
 * The client half, and the decorator that fires when no build wrote one.
 *
 * `callServer` is the entire server-function cost of a browser bundle:
 * generated code calls it and nothing else. What is asserted here is mostly
 * what it does with an answer it did not expect, because the far end of this
 * call is a public endpoint and the thing in front of it may be a proxy having
 * a bad day rather than the handler at all.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { callServer, configureServerCalls, ServerCallError } from '../src/client.js';
import { Server } from '../src/decorator.js';

interface Sent {
  url: string;
  init: RequestInit;
}

const sent: Sent[] = [];

function answering(make: () => Response | Promise<Response>): void {
  configureServerCalls({
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return make();
    }) as unknown as typeof fetch,
  });
}

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  sent.length = 0;
  configureServerCalls({ base: '/_volt/', headers: {} });
});

describe('the request a stub makes', () => {
  it('posts the arguments to the endpoint id, under the default base', async () => {
    answering(() => json({ value: { id: 'todo_1' } }));

    await callServer('abc123', ['write tests', 7]);

    expect(sent[0]!.url).toBe('/_volt/abc123');
    expect(sent[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ args: ['write tests', 7] });
  });

  it('sends the header a cross-site form cannot', async () => {
    answering(() => json({ value: null }));
    await callServer('abc123', []);

    expect(sent[0]!.init.headers).toMatchObject({
      'x-volt-call': '1',
      'content-type': 'application/json',
    });
  });

  it('encodes the arguments through the wire format, not through JSON', async () => {
    answering(() => json({ value: null }));
    await callServer('abc123', [undefined, new Date('2026-08-19T06:00:00.000Z')]);

    // Plain JSON would have sent `[null, "2026-08-19T06:00:00.000Z"]`, and the
    // method would have been handed a string where its type says Date.
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({
      args: [{ $v: ['u'] }, { $v: ['d', '2026-08-19T06:00:00.000Z'] }],
    });
  });

  it('answers with what the endpoint returned, decoded', async () => {
    answering(() => json({ value: { $v: ['d', '2026-08-19T06:00:00.000Z'] } }));

    const value = await callServer('abc123', []);
    expect(value).toBeInstanceOf(Date);
  });

  it('goes where a project mounted the handler, origin and all', async () => {
    answering(() => json({ value: null }));
    // No trailing slash: supplying one is not something a caller should have to
    // get right, since the failure is a 404 at runtime.
    configureServerCalls({ base: 'https://api.test/_rpc' });

    await callServer('abc123', []);
    expect(sent[0]!.url).toBe('https://api.test/_rpc/abc123');
  });

  it('carries the headers a project added, for tracing or a tenant', async () => {
    answering(() => json({ value: null }));
    configureServerCalls({ headers: { 'x-tenant': 'acme' } });

    await callServer('abc123', []);
    expect(sent[0]!.init.headers).toMatchObject({ 'x-tenant': 'acme' });
  });
});

describe('an answer that is not a value', () => {
  it('raises the message the server chose to send, with its status', async () => {
    answering(() => json({ error: { message: 'not yours' } }, 403));

    await expect(callServer('abc123', [])).rejects.toMatchObject({
      name: 'ServerCallError',
      message: 'not yours',
      status: 403,
      endpoint: 'abc123',
    });
  });

  it('falls back to the status line when something in front returned HTML', async () => {
    // A proxy's 502 page parses as nothing. An empty message would leave the
    // caller with an error that says nothing at all.
    answering(() => new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway' }));

    await expect(callServer('abc123', [])).rejects.toMatchObject({
      message: 'Bad Gateway',
      status: 502,
    });
  });

  it('reports a request that never got an answer as status 0', async () => {
    answering(() => {
      throw new TypeError('Failed to fetch');
    });

    await expect(callServer('abc123', [])).rejects.toMatchObject({
      message: 'Failed to fetch',
      status: 0,
      endpoint: 'abc123',
    });
  });

  it('names the endpoint on every failure, which is what a server log correlates against', async () => {
    answering(() => json({ error: { message: 'no' } }, 500));

    const error = await callServer('abc123', []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerCallError);
    expect((error as ServerCallError).endpoint).toBe('abc123');
  });

  it('refuses a 200 that is not JSON at all', async () => {
    answering(() => new Response('ok', { status: 200 }));
    await expect(callServer('abc123', [])).rejects.toThrow('The response was not JSON');
  });
});

describe('@Server() with no build behind it', () => {
  it('throws at the first call rather than running a server body in a browser', () => {
    class Todos {
      @Server()
      async create(text: string): Promise<string> {
        return text;
      }
    }

    // The alternative — leaving the method as written — is the failure the
    // whole feature exists to prevent, so the unlowered decorator replaces it.
    expect(() => new Todos().create('x')).toThrow(/no build\s+lowered it/);
  });

  it('says which build step is missing, and what to check', () => {
    class Todos {
      @Server()
      async create(): Promise<void> {}
    }

    let message = '';
    try {
      void new Todos().create();
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('@Server() on create');
    expect(message).toContain('@voltdev/vite-plugin');
    expect(message).toContain('`include` covers this');
  });
});
