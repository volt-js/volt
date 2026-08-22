/**
 * The part of Volt's public surface these fixture projects are checked
 * against.
 *
 * Declared here rather than imported from `@voltdev/core`, because what is
 * under test is the editor support and not the framework's own types: a
 * fixture that resolved the real package would only answer once that package
 * had been built, and would fail for reasons that have nothing to do with a
 * template.
 */

export declare namespace Signal {
  class State<T> {
    constructor(value: T);
    get(): T;
    set(value: T): void;
  }
  class Computed<T> {
    constructor(compute: () => T);
    get(): T;
  }
}

export declare function Component(config: {
  selector?: string;
  templateUrl: string;
}): <T extends abstract new (...args: never[]) => unknown>(target: T, context: ClassDecoratorContext) => T;
