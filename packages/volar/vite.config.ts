import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const r = (p: string) => resolve(import.meta.dirname, p);
const pkg = createRequire(import.meta.url)('./package.json');

/**
 * Everything this package declares as a dependency stays external.
 *
 * `@volar/language-core` above all: the editor integration that loads this
 * plugin has its own copy, and two copies of Volar's types in one process is
 * the bug that gives a plugin no effect at all.
 */
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
].map((name) => new RegExp(`^${name}(/.*)?$`));

export default defineConfig({
  build: {
    // Loaded by an editor's language server, which is Node.
    target: 'node22',
    ssr: true,
    lib: {
      entry: { index: r('src/index.ts') },
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
