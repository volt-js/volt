/**
 * `@Server()` at build time: the two halves, and the refusals that are the
 * point of the feature.
 *
 * Every server function is a public HTTP endpoint reachable by anyone with
 * curl, and `todos.create(text)` reads exactly like a local call — so the
 * syntax hides the one fact about it that matters. Most of what follows is
 * therefore about builds that *fail*, and about the sentence each failure
 * hands the author, because a refusal nobody can act on is a build that just
 * broke.
 *
 * These run the pass over source. What a browser is actually shipped is a
 * separate question that source cannot answer, and it is asked on built
 * output in `server-bundle.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import MagicString from 'magic-string';
import { endpointId, endpointKey, planServerFunctions } from '../src/server-functions.js';
import { volt } from '../src/index.js';
import type { Plugin } from 'vite';

const ROOT = resolve(import.meta.dirname, '..');
const MODULE = '@voltdev/server';
const ID = `${ROOT}/app/todos.ts`;

/** Run the pass and apply its plan, which is what the plugin does with it. */
function emit(code: string, side: 'client' | 'server', id = ID): string {
  const plan = planServerFunctions(code, { side, id, root: ROOT, module: MODULE });
  if (plan.kind === 'none') return code;

  const s = new MagicString(code);
  for (const range of plan.removals) s.remove(range.start, range.end);
  for (const write of plan.overwrites) s.overwrite(write.start, write.end, write.text);
  for (const insert of plan.insertions) s.appendRight(insert.at, insert.text);
  s.prepend(plan.prelude);
  return s.toString();
}

function refusal(code: string, side: 'client' | 'server' = 'client', id = ID): string {
  try {
    emit(code, side, id);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the build was expected to fail, and did not');
}

const GUARDED = `
import { guard } from '@voltdev/server';
import { db } from './db.js';
import { session } from './auth.js';

export class Todos {
  @Server()
  async create(text: string): Promise<{ id: string }> {
    const user = await guard(session);
    return db.todos.insert({ text, userId: user.id });
  }
}
`;

const CREATE_ID = endpointId(
  endpointKey({ id: ID, root: ROOT, className: 'Todos', method: 'create' }),
);

describe('a method that does not reach a guard', () => {
  it('fails the build, and the message names both remedies', () => {
    const message = refusal(`
import { guard } from '@voltdev/server';
export class Todos {
  @Server()
  async create(text: string): Promise<string> {
    return db.todos.insert({ text });
  }
}
`);

    expect(message).toContain('@Server() Todos.create does not reach a guard');
    // The hazard, stated: the reason a rule this blunt is worth having.
    expect(message).toContain('anyone with curl can post to it');
    // And the two ways out, both spelled the way they are written.
    expect(message).toContain('const user = await guard(session);');
    expect(message).toContain('@Server({ public: true })');
  });

  it('fails the same way when the module never imported a guard at all', () => {
    // Told with the import line, since that is the step this author is missing.
    const message = refusal(`
export class Todos {
  @Server()
  async create(text: string): Promise<string> { return text; }
}
`);
    expect(message).toContain('does not reach a guard');
    expect(message).toContain("import { guard } from '@voltdev/server';");
  });

  it('fails on the server build too, not only the client one', () => {
    // The client half is a stub either way; it is the *server* half that would
    // answer strangers, so a refusal that only ran on the client build would
    // be missing from the build that mattered.
    expect(refusal(GUARDED.replace('const user = await guard(session);', ''), 'server')).toContain(
      'does not reach a guard',
    );
  });

  it('builds when the method says it really is open', () => {
    const output = emit(
      `
export class Health {
  @Server({ public: true })
  async ping(): Promise<string> { return 'pong'; }
}
`,
      'server',
    );
    expect(output).toContain('async ping()');
    expect(output).not.toContain('@Server');
  });

  it('reads only a literal `{ public: true }`, never a value it would have to run', () => {
    const message = refusal(`
const OPEN = { public: true };
export class Health {
  @Server(OPEN)
  async ping(): Promise<string> { return 'pong'; }
}
`);
    expect(message).toContain('takes an object literal');
  });

  it('does not treat `{ public: false }` as a declaration of openness', () => {
    expect(
      refusal(`
export class Health {
  @Server({ public: false })
  async ping(): Promise<string> { return 'pong'; }
}
`),
    ).toContain('does not reach a guard');
  });
});

describe('a guard that reads from a parameter', () => {
  it('is refused, and the message names the parameter it trusted', () => {
    const message = refusal(`
import { guard } from '@voltdev/server';
export class Todos {
  @Server()
  async remove(userId: string, id: string): Promise<void> {
    const user = await guard(() => sessionFor(userId));
    await db.todos.remove(id);
  }
}
`);

    expect(message).toContain('the guard on Todos.remove reads `userId` from a parameter');
    expect(message).toContain('a guard that trusts one');
    // The remedy is not "delete the parameter" — it is to check it against
    // whoever the request says is calling.
    expect(message).toContain('request.headers');
    expect(message).toContain('Then check `userId` against what the guard returned');
  });

  it('sees through a destructured parameter, both spellings of a renamed key', () => {
    const shape = '{ userId: owner, text }: { userId: string; text: string }';
    for (const name of ['userId', 'owner']) {
      expect(
        refusal(`
import { guard } from '@voltdev/server';
export class Todos {
  @Server()
  async create(${shape}): Promise<string> {
    const user = await guard(() => sessionFor(${name}));
    return text;
  }
}
`),
      ).toContain(`reads \`${name}\` from a parameter`);
    }
  });

  it('leaves a guard that reads the request alone', () => {
    expect(() =>
      emit(
        `
import { guard } from '@voltdev/server';
export class Todos {
  @Server()
  async remove(id: string): Promise<void> {
    const user = await guard((request) => sessionFrom(request.headers));
    await db.todos.remove(id);
  }
}
`,
        'server',
      ),
    ).not.toThrow();
  });

  it('is not fooled by a parameter name that only appears inside a string', () => {
    // `identifiers` walks tokens rather than matching text, so the quoted
    // `userId` here is not a read of the parameter.
    expect(() =>
      emit(
        `
import { guard } from '@voltdev/server';
export class Todos {
  @Server()
  async remove(userId: string): Promise<void> {
    const user = await guard((request) => sessionFrom(request, 'userId'));
  }
}
`,
        'server',
      ),
    ).not.toThrow();
  });
});

describe('where the guard has to sit', () => {
  it('refuses one that is not the first statement', () => {
    const message = refusal(`
import { guard } from '@voltdev/server';
export class Todos {
  @Server()
  async create(text: string): Promise<string> {
    const rows = await db.todos.all();
    const user = await guard(session);
    return text;
  }
}
`);
    expect(message).toContain('is not the first statement, or is not');
    // Not a style rule, and the message has to say which of the two reasons.
    expect(message).toContain('AsyncLocalStorage');
    expect(message).toContain('no work has already been done');
  });

  it('refuses one that is called but not awaited', () => {
    expect(
      refusal(`
import { guard } from '@voltdev/server';
export class Todos {
  @Server()
  async create(text: string): Promise<string> {
    const user = guard(session);
    return text;
  }
}
`),
    ).toContain('is not the first statement, or is not');
  });

  it('accepts one behind a comment, a type annotation or a destructuring', () => {
    for (const first of [
      '// authorize first\n    const user = await guard(session);',
      'const user: Session = await guard(session);',
      'const { id } = await guard(session);',
      'await guard(session);',
    ]) {
      expect(() =>
        emit(
          `
import { guard } from '@voltdev/server';
export class Todos {
  @Server()
  async create(text: string): Promise<string> {
    ${first}
    return text;
  }
}
`,
          'server',
        ),
      ).not.toThrow();
    }
  });

  it('follows the guard under the name it was imported as', () => {
    expect(() =>
      emit(
        `
import { guard as authorize } from '@voltdev/server';
export class Todos {
  @Server()
  async create(text: string): Promise<string> {
    const user = await authorize(session);
    return text;
  }
}
`,
        'server',
      ),
    ).not.toThrow();
  });

  it('refuses a namespace import, which hides which call is the guard', () => {
    expect(
      refusal(`
import * as volt from '@voltdev/server';
export class Todos {
  @Server()
  async create(text: string): Promise<string> {
    const user = await volt.guard(session);
    return text;
  }
}
`),
    ).toContain('imports \'@voltdev/server\' as a namespace');
  });

  it('does not accept a local binding that merely shares the name', () => {
    expect(
      refusal(`
import { guard } from '@voltdev/server';
export class Todos {
  @Server()
  async create(text: string): Promise<string> {
    const guard = () => true;
    return text;
  }
}
`),
    ).toContain('is not the first statement, or is not');
  });
});

describe('the decorator has to be visible to the build', () => {
  it('refuses being imported under another name', () => {
    // The pass finds its work by looking for `@Server`. Under another name it
    // finds nothing and declines the file — and a declined file is a server
    // body handed to esbuild and shipped to the browser.
    const message = refusal(`
import { Server as Endpoint, guard } from '@voltdev/server';
export class Todos {
  @Endpoint()
  async create(text: string): Promise<string> {
    const user = await guard(session);
    return text;
  }
}
`);
    expect(message).toContain('@Server() is recognised by name');
    expect(message).toContain('imports it as `Endpoint`');
    expect(message).toContain('the endpoint would answer unguarded');
  });

  it('leaves an ordinary import of the guard alone', () => {
    const code = `
import { guard, ServerError } from '@voltdev/server';
export async function helper(): Promise<void> { throw new ServerError('no'); }
`;
    expect(planServerFunctions(code, { side: 'client', id: ID, root: ROOT, module: MODULE })).toEqual(
      { kind: 'none' },
    );
  });

  it('says @Server() needs its parentheses', () => {
    expect(
      refusal(`
export class Todos {
  @Server
  async create(text: string): Promise<string> { return text; }
}
`),
    ).toContain('write @Server(), with the parentheses');
  });
});

describe('what @Server() may be attached to', () => {
  const cases: [string, string, string][] = [
    [
      'a static member',
      'static async create(text: string): Promise<string> { const u = await guard(s); return text; }',
      'cannot be used on a static member',
    ],
    [
      'a getter',
      'get all(): Promise<string> { return x; }',
      'applies to a method, not a getter (all)',
    ],
    [
      'a private method',
      'async #create(text: string): Promise<string> { const u = await guard(s); return text; }',
      'cannot be used on a private method',
    ],
    [
      'a field holding a function',
      'create = async (text: string) => text;',
      'applies to a method, not a field (create)',
    ],
    [
      'a synchronous method',
      'create(text: string): string { return text; }',
      'must be declared async',
    ],
    [
      'a computed name',
      "async [KEY](text: string): Promise<string> { const u = await guard(s); return text; }",
      'needs a plain method name',
    ],
    [
      'an overload with no body',
      'async create(text: string): Promise<string>;',
      'has no body',
    ],
  ];

  for (const [what, member, expected] of cases) {
    it(`refuses ${what}`, () => {
      expect(
        refusal(`
import { guard } from '@voltdev/server';
export class Todos {
  @Server()
  ${member}
}
`),
      ).toContain(expected);
    });
  }

  it('refuses a function, since an endpoint id needs two names', () => {
    expect(
      refusal(`
@Server()
export async function create(text: string): Promise<string> { return text; }
`),
    ).toContain('applies to a method of a class');
  });

  it('refuses an anonymous class, for the same reason', () => {
    expect(
      refusal(`
import { guard } from '@voltdev/server';
export default class {
  @Server()
  async create(text: string): Promise<string> { const u = await guard(s); return text; }
}
`),
    ).toContain('needs a named class');
  });
});

describe('the client half', () => {
  const output = emit(GUARDED, 'client');

  it('keeps a stub that posts to the endpoint id, and nothing of the body', () => {
    expect(output).toContain(`create(...__volt_args) { return __volt_call("${CREATE_ID}", __volt_args); }`);
    expect(output).not.toContain('db.todos.insert');
    expect(output).not.toContain('guard(session)');
  });

  it('reaches the client entry, never the one carrying the handler and registry', () => {
    expect(output).toContain('from "@voltdev/server/client"');
    expect(output).not.toContain('from "@voltdev/server"');
  });

  it('drops the imports only the stripped body was holding', () => {
    // Stripping a body and keeping its imports leaves the database module in
    // the client graph, still evaluated and still in the bundle.
    expect(output).not.toContain("from './db.js'");
    expect(output).not.toContain("from './auth.js'");
  });

  it('keeps an import something outside the body still uses', () => {
    const kept = emit(
      `
import { guard } from '@voltdev/server';
import { db, format } from './db.js';

export class Todos {
  @Server()
  async create(text: string): Promise<string> {
    const user = await guard(session);
    return db.todos.insert({ text });
  }

  label(): string { return format('x'); }
}
`,
      'client',
    );
    expect(kept).toContain('import { format } from "./db.js"');
    expect(kept).not.toContain('db,');
  });

  it('takes the whole signature, since a default can reach anything the module imported', () => {
    const stub = emit(
      `
import { guard } from '@voltdev/server';
import { SECRET } from './config.js';

export class Todos {
  @Server()
  async create(text: string, salt: string = SECRET): Promise<string> {
    const user = await guard(session);
    return text + salt;
  }
}
`,
      'client',
    );
    expect(stub).not.toContain('SECRET');
    expect(stub).not.toContain("from './config.js'");
  });
});

describe('the server half', () => {
  const output = emit(GUARDED, 'server');

  it('keeps the body and drops the decorator', () => {
    expect(output).toContain('async create(text: string): Promise<{ id: string }>');
    expect(output).toContain('db.todos.insert');
    expect(output).not.toContain('@Server');
  });

  it('registers from a static block, so a class nothing imports registers nothing', () => {
    expect(output).toContain(
      `static { __volt_register(this, "create", "${CREATE_ID}", "app/todos.ts#Todos.create"); }`,
    );
    expect(output).toContain('from "@voltdev/server"');
  });

  it('hands the registry the key the id was hashed from, not a name a minifier owns', () => {
    // `Todos` is the class's `.name`, and a server bundle is free to rename it.
    // The key is a build-time string, so it survives to be compared.
    expect(output).toContain('"app/todos.ts#Todos.create"');
  });
});

describe('the endpoint id', () => {
  it('is the same one on both sides of the build', () => {
    const client = planServerFunctions(GUARDED, {
      side: 'client',
      id: ID,
      root: ROOT,
      module: MODULE,
    });
    const server = planServerFunctions(GUARDED, {
      side: 'server',
      id: ID,
      root: ROOT,
      module: MODULE,
    });
    expect(client.kind).toBe('lowered');
    expect(server.kind).toBe('lowered');
    if (client.kind !== 'lowered' || server.kind !== 'lowered') return;
    expect(client.endpoints).toEqual(server.endpoints);
    expect(client.endpoints[0]).toEqual({
      name: 'Todos.create',
      source: 'app/todos.ts#Todos.create',
      id: CREATE_ID,
    });
  });

  it('does not depend on where the checkout is', () => {
    const here = endpointKey({ id: '/home/a/app/todos.ts', root: '/home/a', className: 'T', method: 'm' });
    const there = endpointKey({ id: '/srv/ci/33/app/todos.ts', root: '/srv/ci/33', className: 'T', method: 'm' });
    expect(here).toBe(there);
    expect(endpointId(here)).toBe(endpointId(there));
  });

  it('separates two modules that declare the same class and method', () => {
    const a = endpointKey({ id: `${ROOT}/app/todos.ts`, root: ROOT, className: 'Api', method: 'list' });
    const b = endpointKey({ id: `${ROOT}/app/users.ts`, root: ROOT, className: 'Api', method: 'list' });
    expect(endpointId(a)).not.toBe(endpointId(b));
  });

  it('is stable across a version query the dev server appends', () => {
    const plain = endpointKey({ id: `${ROOT}/app/todos.ts`, root: ROOT, className: 'T', method: 'm' });
    const versioned = endpointKey({
      id: `${ROOT}/app/todos.ts?v=abc123`,
      root: ROOT,
      className: 'T',
      method: 'm',
    });
    expect(versioned).toBe(plain);
  });

  it('refuses two classes of one name in one module, which would share an id', () => {
    // The registry cannot catch this pair: it is handed the same key twice,
    // which is exactly what a dev-server reload looks like. Only the build can
    // see that there are two.
    const message = refusal(`
import { guard } from '@voltdev/server';
function makeA() {
  class Todos {
    @Server()
    async create(text: string): Promise<string> { const u = await guard(s); return text; }
  }
  return Todos;
}
function makeB() {
  class Todos {
    @Server()
    async create(text: string): Promise<string> { const u = await guard(s); return text; }
  }
  return Todos;
}
`);
    expect(message).toContain('declares Todos.create twice');
    expect(message).toContain('under the first\'s guards');
  });
});

describe('the plugin, as a project runs it', () => {
  interface Context {
    error(message: string): never;
  }

  function serverPlugin(): Plugin {
    const all = volt();
    const env = all.find((p) => p.name === 'volt:env')!;
    (env.configResolved as unknown as (config: unknown) => void).call(
      {},
      { root: ROOT, command: 'build' },
    );
    return all.find((p) => p.name === 'volt:server-functions')!;
  }

  async function transform(code: string): Promise<string | null> {
    const plugin = serverPlugin();
    const hook = plugin.transform as unknown as (
      this: Context,
      code: string,
      id: string,
    ) => Promise<{ code: string } | null>;
    const context: Context = {
      error(message) {
        throw new Error(message);
      },
    };
    const result = await hook.call(context, code, ID);
    return result ? result.code : null;
  }

  it('fails the build through the reporting channel Vite gives it', async () => {
    await expect(
      transform(`
export class Todos {
  @Server()
  async create(text: string): Promise<string> { return text; }
}
`),
    ).rejects.toThrow(/does not reach a guard/);
  });

  it('names the file, since one refusal in a project of many is unplaceable without it', async () => {
    await expect(
      transform(`
export class Todos {
  @Server()
  async create(text: string): Promise<string> { return text; }
}
`),
    ).rejects.toThrow(/app\/todos\.ts/);
  });

  it('lowers a guarded method to the client stub', async () => {
    const output = await transform(GUARDED);
    expect(output).toContain(`__volt_call("${CREATE_ID}"`);
  });

  it('looks at a module that imports the server package even with no @Server in it', async () => {
    // The gate is half the specifier because the renamed-decorator refusal has
    // to fire on a file with no `@Server` text anywhere.
    await expect(
      transform(`
import { Server as Endpoint } from '@voltdev/server';
export class Todos {
  @Endpoint()
  async create(text: string): Promise<string> { return text; }
}
`),
    ).rejects.toThrow(/recognised by name/);
  });

  it('ignores a module that has neither', async () => {
    expect(await transform('export const x = 1;\n')).toBeNull();
  });
});
