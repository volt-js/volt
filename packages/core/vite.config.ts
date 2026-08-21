import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const r = (p: string) => resolve(import.meta.dirname, p);
const pkg = createRequire(import.meta.url)('./package.json');

/**
 * Everything this package declares as a dependency stays external.
 *
 * Bundling a dependency into a library is wrong in general, and actively
 * breaks for packages that use CommonJS internally — dart-sass calls
 * `require` at runtime, which fails once inlined into an ES module.
 */
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
].map((name) => new RegExp(`^${name}(/.*)?$`));

export default defineConfig({
  build: {
    // Volt targets current engines; nothing here is downlevelled.
    target: 'esnext',
    lib: {
      entry: {
        index: r('src/index.ts'),
        runtime: r('src/runtime.ts'),
        // The other half of `runtime`: what a server build's templates are
        // generated against. Its own entry so a browser never resolves it.
        server: r('src/server.ts'),
        jit: r('src/jit.ts'),
        signals: r('src/signals.ts'),
        // An entry so the bundle keeps it as its own chunk: the component
        // layer reaches it only from inside `if (__VOLT_DEV__)`, and an
        // application's production build drops the chunk with the branch.
        devtools: r('src/devtools.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [...external, /^node:/],
    },
    sourcemap: true,
    minify: false,
    emptyOutDir: true,
  },
});
