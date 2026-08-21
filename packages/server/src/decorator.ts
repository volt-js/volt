/**
 * `@Server()` — the declaration, and what it does when nothing lowered it.
 *
 * In a build, this function is never called: `@voltdev/vite-plugin` resolves
 * the decorator away, leaving a stub that posts on the client and the real
 * method plus its registration on the server. The decorator survives in the
 * source for its types, which is where the signature constraints live.
 *
 * Without that build there is no endpoint id, so there is nothing the client
 * half could post to and nothing the server half could register under. The
 * only safe thing left is to fail loudly at the first call, because the
 * alternative — leaving the method as written — is a server body running in a
 * browser with whatever it imported, which is the failure this whole feature
 * exists to prevent.
 */

import type { ServerDecorator, ServerOptions } from './types.js';

export function Server(options?: ServerOptions): ServerDecorator {
  void options;
  return ((_method: unknown, context: ClassMethodDecoratorContext) => {
    const name = String(context.name);
    return () => {
      throw new Error(
        `[volt] @Server() on ${name} was evaluated at runtime, which means no build ` +
          'lowered it.\n' +
          '  A server function is two halves the compiler writes: a stub that posts to a\n' +
          '  generated endpoint id, and the real method registered under that id. Neither\n' +
          '  exists here.\n' +
          '  Add @voltdev/vite-plugin to the build, and check its `include` covers this\n' +
          '  file.',
      );
    };
  }) as ServerDecorator;
}
