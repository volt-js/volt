// @vitest-environment node
//
// A browser's `Request` forbids exactly the headers this feature is built on:
// happy-dom drops `cookie` on the way in, so a guard reading one would find
// nothing and every test here would pass for the wrong reason. The handler
// never runs in a browser anyway — it is a Fetch handler on Node, Bun, Deno or
// a worker, and that is the implementation it has to be right against.

/**
 * The handler, read from the outside in.
 *
 * Every server function is a public HTTP endpoint. So the tests that matter
 * are not "does a call work" — they are what an unauthenticated stranger can
 * send, and what each answer tells them. A call site cannot express any of
 * this, which is exactly the view `todos.create(text)` hides.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandler, DEFAULT_BASE, isServerCall } from '../src/handler.js';
import { registerServerFunction } from '../src/registry.js';
import { Forbidden, ServerError } from '../src/errors.js';
import { guard } from '../src/guard.js';

class Todos {
  async create(text: string): Promise<{ id: string }> {
    return { id: `todo_${text}` };
  }

  async whoami(): Promise<string> {
    const user = await guard((request) => request.headers.get('cookie'));
    return user;
  }

  async boom(): Promise<never> {
    throw new Error('relation "users" does not exist');
  }

  async refuse(): Promise<never> {
    throw new Forbidden('not yours');
  }

  async leak(): Promise<unknown> {
    return new Todos();
  }

  counter = 0;
  async bump(): Promise<number> {
    this.counter += 1;
    return this.counter;
  }

  async rename(id: string, title: string): Promise<string> {
    return `${id}:${title}`;
  }

  async search(term: string, limit = 20): Promise<string> {
    return `${term}/${limit}`;
  }

  async tag(...names: string[]): Promise<number> {
    return names.length;
  }
}

const CREATE = 'endpoint_create';
const WHOAMI = 'endpoint_whoami';
const BOOM = 'endpoint_boom';
const REFUSE = 'endpoint_refuse';
const LEAK = 'endpoint_leak';
const BUMP = 'endpoint_bump';
const RENAME = 'endpoint_rename';
const SEARCH = 'endpoint_search';
const TAG = 'endpoint_tag';

registerServerFunction(Todos, 'create', CREATE, 'test/handler.ts#Todos.create');
registerServerFunction(Todos, 'whoami', WHOAMI, 'test/handler.ts#Todos.whoami');
registerServerFunction(Todos, 'boom', BOOM, 'test/handler.ts#Todos.boom');
registerServerFunction(Todos, 'refuse', REFUSE, 'test/handler.ts#Todos.refuse');
registerServerFunction(Todos, 'leak', LEAK, 'test/handler.ts#Todos.leak');
registerServerFunction(Todos, 'bump', BUMP, 'test/handler.ts#Todos.bump');
registerServerFunction(Todos, 'rename', RENAME, 'test/handler.ts#Todos.rename');
registerServerFunction(Todos, 'search', SEARCH, 'test/handler.ts#Todos.search');
registerServerFunction(Todos, 'tag', TAG, 'test/handler.ts#Todos.tag');

let errors: { error: unknown; endpoint: string; name: string }[] = [];
const handle = createHandler({
  onError(error, context) {
    errors.push({ error, endpoint: context.endpoint, name: context.name });
  },
});

beforeEach(() => {
  errors = [];
});

/** A call as the generated client makes it. */
function call(endpoint: string, args: unknown[], init: RequestInit = {}): Request {
  return new Request(`https://app.test${DEFAULT_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-volt-call': '1',
      ...((init.headers as Record<string, string>) ?? {}),
    },
    body: JSON.stringify({ args }),
    ...(init.method ? { method: init.method } : {}),
  });
}

type Payload = { value?: unknown; error?: { message: string } };

async function body(response: Response): Promise<Payload> {
  return (await response.json()) as Payload;
}

describe('a call that is one', () => {
  it('runs the method and serializes what it returned', async () => {
    const response = await handle(call(CREATE, ['x']));

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ value: { id: 'todo_x' } });
  });

  it('never lets a response be cached, since every one of them is a caller-specific answer', async () => {
    const response = await handle(call(CREATE, ['x']));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('builds the class once per call, so nothing survives into the next one', async () => {
    expect(await body(await handle(call(BUMP, [])))).toEqual({ value: 1 });
    // A class is a namespace here. If it were shared, this would be 2, and a
    // session assigned to `this` would outlive the request that assigned it.
    expect(await body(await handle(call(BUMP, [])))).toEqual({ value: 1 });
  });
});

describe('what a stranger with curl gets', () => {
  it('refuses anything but POST, and says what is allowed', async () => {
    const response = await handle(
      new Request(`https://app.test${DEFAULT_BASE}${CREATE}`, { method: 'GET' }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('refuses a request with no `x-volt-call` header', async () => {
    // The header is the cross-site defence: a form cannot set one, and a fetch
    // that does forces a preflight this handler never answers.
    const request = call(CREATE, ['x']);
    request.headers.delete('x-volt-call');

    const response = await handle(request);
    expect(response.status).toBe(403);
  });

  it('refuses the three content types a form can produce', async () => {
    for (const type of [
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'text/plain;charset=UTF-8',
    ]) {
      const response = await handle(call(CREATE, ['x'], { headers: { 'content-type': type } }));
      expect(response.status, type).toBe(415);
    }
  });

  it('accepts the content type with a charset on it, which a real client sends', async () => {
    const response = await handle(
      call(CREATE, ['x'], { headers: { 'content-type': 'application/json; charset=utf-8' } }),
    );
    expect(response.status).toBe(200);
  });

  it('answers an unregistered id exactly as it answers a path it does not own', async () => {
    // An endpoint table is not a secret, but there is no reason to help
    // enumerate one either.
    const unknown = await handle(call('no_such_endpoint', []));
    const elsewhere = await handle(
      new Request('https://app.test/api/todos', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-volt-call': '1' },
        body: '{"args":[]}',
      }),
    );

    expect(unknown.status).toBe(404);
    expect(elsewhere.status).toBe(404);
    expect(await body(unknown)).toEqual(await body(elsewhere));
  });

  it('refuses a body that is not the shape the client sends', async () => {
    for (const raw of ['{"args":{}}', '{}', 'not json', '[]']) {
      const response = await handle(
        new Request(`https://app.test${DEFAULT_BASE}${CREATE}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-volt-call': '1' },
          body: raw,
        }),
      );
      expect(response.status, raw).toBe(400);
    }
  });
});

describe('a body with no ceiling is a memory exhaustion primitive', () => {
  const small = createHandler({ maxBodyBytes: 64 });

  it('refuses one over the limit', async () => {
    const response = await small(call(CREATE, ['x'.repeat(200)]));
    expect(response.status).toBe(413);
  });

  it('stops reading rather than buffering first and measuring after', async () => {
    // The check has to run while the bytes arrive to be a ceiling at all. This
    // stream would never end; a handler that awaited the whole body before
    // measuring would hang here rather than answer.
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1024;
        controller.enqueue(new Uint8Array(1024));
      },
    });

    const response = await small(
      new Request(`https://app.test${DEFAULT_BASE}${CREATE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-volt-call': '1' },
        body: endless,
        duplex: 'half',
      } as RequestInit),
    );

    expect(response.status).toBe(413);
    // One chunk past the limit and it gave up, rather than reading forever.
    expect(sent).toBeLessThan(64 * 1024);
  });

  it('refuses on the declared length before reading anything at all', async () => {
    const response = await small(
      new Request(`https://app.test${DEFAULT_BASE}${CREATE}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-volt-call': '1',
          'content-length': String(1024 * 1024),
        },
        body: '{"args":[]}',
      }),
    );
    expect(response.status).toBe(413);
  });
});

describe('what a failure tells the caller', () => {
  it('says nothing at all about an error the author did not write for them', async () => {
    const response = await handle(call(BOOM, []));
    const payload = await body(response);

    expect(response.status).toBe(500);
    // The driver's message names a table. That is reconnaissance, and it does
    // not leave the process.
    expect(JSON.stringify(payload)).not.toContain('relation');
    expect(payload).toEqual({ error: { message: 'Internal Server Error' } });
  });

  it('hands that error to `onError`, which is the only place it is visible', async () => {
    await handle(call(BOOM, []));

    expect(errors).toHaveLength(1);
    expect((errors[0]!.error as Error).message).toContain('relation "users" does not exist');
    // Correlating a 500 against a log needs the id the access log recorded.
    expect(errors[0]!.endpoint).toBe(BOOM);
    expect(errors[0]!.name).toBe('Todos.boom');
  });

  it('passes a `ServerError` through, since that sentence was written to be read', async () => {
    const response = await handle(call(REFUSE, []));

    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({ error: { message: 'not yours' } });
  });

  it('reports a refusal too, so a burst of them is visible', async () => {
    await handle(call(REFUSE, []));
    expect(errors[0]!.error).toBeInstanceOf(ServerError);
  });

  it('turns an unserializable return value into a 500 rather than a leak', async () => {
    // The wire format refuses a class instance, and the refusal happens on the
    // way out — after the method returned, before anything was written.
    const response = await handle(call(LEAK, []));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await body(response))).not.toContain('"counter"');
    expect((errors[0]!.error as Error).message).toContain('cannot cross a @Server() boundary');
  });

  it('survives a handler with no `onError`, and still says nothing', async () => {
    const quiet = createHandler();
    const response = await quiet(call(BOOM, []));
    expect(response.status).toBe(500);
  });
});

describe('the guard runs against the request, not the arguments', () => {
  it('reaches the cookies a caller\'s browser attached', async () => {
    const response = await handle(call(WHOAMI, [], { headers: { cookie: 'session=abc' } }));
    expect(await body(response)).toEqual({ value: 'session=abc' });
  });

  it('answers 401 when the check comes back empty', async () => {
    const response = await handle(call(WHOAMI, []));
    expect(response.status).toBe(401);
    expect(await body(response)).toEqual({ error: { message: 'Unauthorized' } });
  });

  it('keeps two concurrent calls apart', async () => {
    const [a, b] = await Promise.all([
      handle(call(WHOAMI, [], { headers: { cookie: 'session=a' } })),
      handle(call(WHOAMI, [], { headers: { cookie: 'session=b' } })),
    ]);

    expect(await body(a)).toEqual({ value: 'session=a' });
    expect(await body(b)).toEqual({ value: 'session=b' });
  });
});

describe('mounting it somewhere that is not the whole process', () => {
  it('answers under a base a project chose, however it was spelled', async () => {
    for (const base of ['_api', '/_api', '/_api/']) {
      const mounted = createHandler({ base });
      const response = await mounted(
        new Request(`https://app.test/_api/${CREATE}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-volt-call': '1' },
          body: '{"args":["x"]}',
        }),
      );
      expect(response.status, base).toBe(200);
    }
  });

  it('tells a host framework which requests are its own', () => {
    const post = new Request(`https://app.test${DEFAULT_BASE}${CREATE}`, { method: 'POST' });
    const page = new Request('https://app.test/todos', { method: 'POST' });
    const read = new Request(`https://app.test${DEFAULT_BASE}${CREATE}`);

    expect(isServerCall(post)).toBe(true);
    expect(isServerCall(page)).toBe(false);
    // A GET to an endpoint path is not a call; the host framework keeps it.
    expect(isServerCall(read)).toBe(false);
    expect(isServerCall(new Request('https://app.test/_api/x', { method: 'POST' }), '_api')).toBe(
      true,
    );
  });
});

describe('what it does not do', () => {
  it('does not answer a preflight, which is what keeps the header meaningful', async () => {
    const response = await handle(
      new Request(`https://app.test${DEFAULT_BASE}${CREATE}`, { method: 'OPTIONS' }),
    );

    // No `access-control-allow-origin`, so a cross-origin fetch never gets to
    // send the real request. A project that wants CORS says so in front of it.
    expect(response.status).toBe(405);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('is a plain function of a Request, with no server anywhere in it', () => {
    // The whole deployment story: it runs wherever `fetch` does.
    expect(handle).toBeTypeOf('function');
    expect(vi.isMockFunction(handle)).toBe(false);
  });
});

describe('arguments the caller did not send', () => {
  // `args` being an array was the whole check until now, so a method declared
  // `create(text: string)` ran with `text` undefined for anyone who posted an
  // empty list. A method that then wrote what it was given, or looked
  // something up by it, did so on a value TypeScript said could not exist.
  it('refuses a call that omits a required argument', async () => {
    const response = await handle(call(CREATE, []));
    expect(response.status).toBe(400);
    expect((await body(response)).error?.message).toMatch(/takes 1 argument/);
  });

  it('refuses a call that is short by one of several', async () => {
    const response = await handle(call(RENAME, ['todo_1']));
    expect(response.status).toBe(400);
    expect((await body(response)).error?.message).toMatch(/takes 2 arguments.*carried 1/);
  });

  it('names the endpoint in the refusal, since a client sent the wrong shape', async () => {
    const message = (await body(await handle(call(RENAME, [])))).error?.message;
    expect(message).toContain('Todos.rename');
  });

  it('does not report it to `onError`, which is for failures of ours', async () => {
    await handle(call(CREATE, []));
    expect(errors).toHaveLength(0);
  });

  it('still runs a method whose remaining parameters have defaults', async () => {
    const response = await handle(call(SEARCH, ['volt']));
    expect(response.status).toBe(200);
    expect((await body(response)).value).toBe('volt/20');
  });

  it('still runs a method that takes only a rest parameter, with nothing at all', async () => {
    const response = await handle(call(TAG, []));
    expect(response.status).toBe(200);
    expect((await body(response)).value).toBe(0);
  });

  it('accepts more arguments than declared, which is a client built against a newer signature', async () => {
    const response = await handle(call(CREATE, ['x', 'unexpected']));
    expect(response.status).toBe(200);
  });

  it('accepts exactly the declared count', async () => {
    const response = await handle(call(RENAME, ['todo_1', 'new title']));
    expect(response.status).toBe(200);
    expect((await body(response)).value).toBe('todo_1:new title');
  });
});
