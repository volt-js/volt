/** Stands in for `@voltdev/server`: what the lowered server half imports. */

export function registerServerFunction(
  _target: unknown,
  _method: string,
  _id: string,
  _source: string,
): void {}

export function callServer(_id: string, _args: unknown[]): Promise<unknown> {
  return Promise.resolve(null);
}
