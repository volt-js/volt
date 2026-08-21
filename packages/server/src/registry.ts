/**
 * Endpoint id -> the method that answers it.
 *
 * Nothing here is written by hand. `@voltdev/vite-plugin` emits one
 * `registerServerFunction` call per `@Server()` method into a static block on
 * the class, so a class that is never imported registers nothing and a server
 * bundle's endpoint table is exactly its reachable server functions.
 *
 * The ids are hashes, and a hash can collide. A collision would mean one
 * method silently answering another's URL — the guards of the wrong function
 * running over the arguments of the right one — so it is a crash at startup
 * rather than a surprise in production.
 *
 * Telling that apart from an ordinary reload is the whole difficulty. A dev
 * server re-evaluates a module on every edit, which re-runs the static block
 * with a fresh class object for the same source, and the two are
 * indistinguishable by anything the runtime can see: same id, different class
 * object, and `target.name` says `Todos` in both directions — as it also does
 * for the collision most worth catching, two files that each declare a `Todos`
 * with a `create`. So the discriminator is not inferred, it is passed: the
 * build hands over the key it hashed, and a second registration under a key
 * that is not the same string is the one that cannot be a reload. It is also
 * the one name here a minifier cannot rewrite.
 */

export interface ServerFunction {
  readonly id: string;
  readonly target: abstract new () => object;
  readonly method: string;
  /** `app/todos.ts#Todos.create` — exactly what `id` was hashed from. */
  readonly source: string;
  /** `Todos.create`. Server-side diagnostics only; it is never sent anywhere. */
  readonly name: string;
}

const registry = new Map<string, ServerFunction>();

export function registerServerFunction(
  target: abstract new () => object,
  method: string,
  id: string,
  source: string,
): void {
  const existing = registry.get(id);
  if (existing && existing.source !== source) {
    throw new Error(
      `[volt] two server functions were given the same endpoint id ${id}: ` +
        `${existing.source} and ${source}. One would answer the other's URL, ` +
        'under the wrong guards. Rename one of the two methods.',
    );
  }
  registry.set(id, { id, target, method, source, name: source.slice(source.indexOf('#') + 1) });
}

export function lookupServerFunction(id: string): ServerFunction | undefined {
  return registry.get(id);
}

/** Every endpoint this process serves — for a startup log, or a route dump. */
export function serverFunctions(): readonly ServerFunction[] {
  return [...registry.values()];
}
