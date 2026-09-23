import { defineConfig } from 'vite';
import { renderPath, volt } from '@voltdev/vite-plugin';

export default defineConfig({
  // `serverRender: true` is the whole of the wiring. It gives this project a request
  // handler, per-route rendering modes, server functions on the same origin
  // and a client that attaches to what the server sent — none of which appears
  // in this repository, because none of it is this project's to write.
  //
  // It also turns the plugin's `hydrate` on, because a server that writes the
  // markup and a client that builds its own on top of it are the two halves of
  // one decision. Turning it off takes a little more than deleting it: the
  // README says what.
  //
  // `renderPath()` is what keeps `server.ts` deployable to an edge runtime as
  // the application grows: it fails the build when anything a page renders
  // reaches a `node:` builtin, which such a runtime does not have. A
  // `@Server()` method is the other side of the network and may import one.
  plugins: [renderPath(), volt({ serverRender: true })],
  build: {
    target: 'esnext',
  },
});
