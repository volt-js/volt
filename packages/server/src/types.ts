/**
 * What a `@Server()` signature is allowed to say, expressed to the type
 * checker.
 *
 * This is the third of the roadmap's three mitigations, and the only one that
 * costs nothing at runtime: *return values are serialized, so a database row
 * cannot cross the boundary unless its type says it may*. A method is the
 * shape of a public HTTP response, so the response's shape has to be
 * something an author wrote down rather than whatever an ORM handed back.
 */

/**
 * `T` with everything the wire format cannot carry mapped to `never`.
 *
 * Written as a mapped type rather than a union constraint so that an
 * `interface` passes: TypeScript gives an implicit index signature to type
 * aliases and object literal types but not to interfaces, and a rule that
 * accepted `type Todo = {...}` while refusing `interface Todo {...}` would be
 * read as a bug in the rule, correctly.
 *
 * A method on the type is the tell that matters. A row class carries `save`,
 * `toJSON`, `$fetchAll`; a plain result object carries none, and the
 * difference is exactly the difference between an entity and a response.
 */
export type Serializable<T> = T extends
  | string
  | number
  | boolean
  | null
  | undefined
  | void
  | bigint
  | Date
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends readonly (infer E)[]
      ? readonly Serializable<E>[]
      : T extends object
        ? { [K in keyof T]: Serializable<T[K]> }
        : never;

/**
 * The type a refused signature is reported through.
 *
 * It exists to be unsatisfiable *and* legible: TypeScript prints the offending
 * parameter type in the TS1270 it raises, so the sentence in the type argument
 * is the error message an author reads.
 */
export interface ServerFunctionRefused<Because extends string> {
  readonly __voltRefused: Because;
}

export interface ServerOptions {
  /**
   * This method really is open to anyone with `curl`.
   *
   * Without it the build refuses a `@Server()` body that does not reach a
   * guard. Saying it here is the whole point of the option: an open endpoint
   * should be a sentence somebody wrote, in the diff, next to the method.
   */
  public?: boolean;
}

/**
 * The decorator's type.
 *
 * The two checks sit in opposite positions on purpose, because assignability
 * runs in opposite directions through them:
 *
 *   - the **return type** carries the argument check. A decorator's return
 *     type has to be assignable to the method it replaces, and parameters are
 *     contravariant there — so declaring an argument list the method's own
 *     cannot supply is what makes an unserializable parameter an error.
 *   - the same position carries the return check, for the same reason: put it
 *     in `Promise<...>` instead and `never` would be assignable to whatever
 *     the method returns, so every refusal would pass.
 */
export interface ServerDecorator {
  <This, Args extends readonly unknown[], R>(
    method: (this: This, ...args: Args) => Promise<R>,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Promise<R>>,
  ): (
    this: This,
    ...args: [R] extends [Serializable<R>]
      ? [Args] extends [Serializable<Args>]
        ? Args
        : [ServerFunctionRefused<'an argument of a @Server() method must be serializable'>]
      : [ServerFunctionRefused<'the return type of a @Server() method must be serializable'>]
  ) => Promise<R>;
}
