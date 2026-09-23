// @vitest-environment node

/**
 * The endpoint table, and the one question it exists to answer wrong-loudly.
 *
 * An endpoint id is a hash, and a hash can collide. A collision is not a broken
 * page: it is one method answering another's URL, under the wrong guards, with
 * the right arguments. So it has to be a crash at startup.
 *
 * The difficulty is telling that apart from a dev-server reload, which
 * re-registers the same id with a different class object and is entirely
 * ordinary. Nothing the runtime can see separates them — `target.name` says
 * `Todos` for a reload and also for the collision most likely to happen, two
 * files that each declare a `Todos` with a `create`. So the build passes down
 * the key it hashed, and that is what is compared.
 */

import { describe, expect, it } from 'vitest';
import { lookupServerFunction, registerServerFunction, serverFunctions } from '../src/registry.js';

const key = (file: string, name: string) => `${file}#${name}`;

describe('a second registration under the same id', () => {
  it('replaces, when it is the same source registering again', () => {
    // What a dev server does on every edit: a fresh class object for the same
    // module. Refusing this would make the first save of the session fatal.
    class Todos {}
    class TodosAgain {}
    const source = key('app/todos.ts', 'Todos.create');

    registerServerFunction(Todos, 'create', 'reload_id', source);
    expect(() =>
      registerServerFunction(TodosAgain, 'create', 'reload_id', source),
    ).not.toThrow();

    expect(lookupServerFunction('reload_id')?.target).toBe(TodosAgain);
  });

  it('crashes, when it is a different source', () => {
    class Api {}
    class OtherApi {}

    registerServerFunction(Api, 'list', 'collision_id', key('app/todos.ts', 'Api.list'));

    expect(() =>
      registerServerFunction(OtherApi, 'list', 'collision_id', key('app/users.ts', 'Api.list')),
    ).toThrow(/two server functions were given the same endpoint id collision_id/);
  });

  it('crashes even though both are called `Api.list`, which is the likely collision', () => {
    // Two modules with the same class and method name is not an exotic case;
    // it is what a project with `todos/Api.ts` and `users/Api.ts` has. A check
    // that compared names would pass this and leave one answering the other.
    class Api {}
    class AlsoApi {}

    registerServerFunction(Api, 'list', 'twin_id', key('todos/Api.ts', 'Api.list'));

    expect(() =>
      registerServerFunction(AlsoApi, 'list', 'twin_id', key('users/Api.ts', 'Api.list')),
    ).toThrow(/todos\/Api\.ts#Api\.list and users\/Api\.ts#Api\.list/);
  });

  it('says what to do about it', () => {
    class One {}
    class Two {}
    registerServerFunction(One, 'x', 'named_id', key('a.ts', 'One.x'));

    expect(() => registerServerFunction(Two, 'x', 'named_id', key('b.ts', 'Two.x'))).toThrow(
      /Rename one of the two methods/,
    );
  });
});

describe('what the table is for', () => {
  it('answers an id with the method that serves it', () => {
    class Todos {}
    registerServerFunction(Todos, 'create', 'lookup_id', key('app/todos.ts', 'Todos.create'));

    expect(lookupServerFunction('lookup_id')).toMatchObject({
      id: 'lookup_id',
      target: Todos,
      method: 'create',
      source: 'app/todos.ts#Todos.create',
      name: 'Todos.create',
    });
  });

  it('answers an id nobody registered with nothing', () => {
    expect(lookupServerFunction('never_registered')).toBeUndefined();
  });

  it('lists what this process serves, for a startup log or a route dump', () => {
    class Todos {}
    registerServerFunction(Todos, 'dump', 'dump_id', key('app/todos.ts', 'Todos.dump'));

    expect(serverFunctions().map((fn) => fn.id)).toContain('dump_id');
  });

  it('runs a direct call on an instance of its own, as the handler runs a posted one', async () => {
    // During a server render a component or a loader calls the method on
    // whatever instance it holds — the module-level one the reference writes,
    // shared by every request in the process. Two calls in flight on it are
    // two requests, and a value one keeps on `this` across an `await` is
    // then whichever request wrote it last.
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    class Account {
      user = 'nobody';
      async plan(user: string): Promise<string> {
        this.user = user;
        if (user === 'ada') await held;
        return `plan for ${this.user}`;
      }
    }
    registerServerFunction(Account, 'plan', 'per_call_id', key('app/account.ts', 'Account.plan'));
    const shared = new Account();

    const ada = shared.plan('ada');
    const grace = await shared.plan('grace');
    release();

    expect(grace).toBe('plan for grace');
    expect(await ada).toBe('plan for ada');
    // Nothing was written to the instance the caller held, either.
    expect(shared.user).toBe('nobody');
  });

  it('keeps the arity of the method as written, which the handler checks arguments against', () => {
    class Todos {
      async rename(id: string, title: string): Promise<string> {
        return `${id}:${title}`;
      }
    }
    registerServerFunction(Todos, 'rename', 'arity_id', key('app/todos.ts', 'Todos.rename'));

    expect(Todos.prototype.rename.length).toBe(2);
  });

  it('takes the readable name from the key, which a minifier cannot rewrite', () => {
    // `target.name` is whatever survived the server bundle's mangling. The key
    // is a build-time string, so a 500 in a log is still attributable.
    class q {}
    registerServerFunction(q, 'a', 'mangled_id', key('app/todos.ts', 'Todos.create'));

    expect(lookupServerFunction('mangled_id')?.name).toBe('Todos.create');
  });
});
