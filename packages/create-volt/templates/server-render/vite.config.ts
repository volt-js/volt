import { defineConfig } from 'vite';
import { volt } from '@voltdev/vite-plugin';

export default defineConfig({
  // `serverRender: true` is the whole of the wiring. It gives this project a request
  // handler, per-route rendering modes, server functions on the same origin
  // and a client that attaches to what the server sent — none of which appears
  // in this repository, because none of it is this project's to write.
  //
  // It also turns the plugin's `hydrate` on, because a server that writes the
  // markup and a client that builds its own on top of it are the two halves of
  // one decision. Deleting `serverRender` puts both back: the project becomes
  // an ordinary client-rendered application and nothing else has to change.
  plugins: [volt({ serverRender: true })],
  build: {
    target: 'esnext',
  },
});
