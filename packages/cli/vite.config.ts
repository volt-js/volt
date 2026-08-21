import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const r = (p: string) => resolve(import.meta.dirname, p);
const pkg = createRequire(import.meta.url)('./package.json');

/**
 * Everything this package declares as a dependency stays external.
 *
 * `typescript` above all: the checker is a Go binary the package resolves at
 * runtime, and there is nothing about it to bundle.
 */
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
].map((name) => new RegExp(`^${name}(/.*)?$`));

export default defineConfig({
  build: {
    // A command-line tool, so the target is Node rather than a browser.
    target: 'node22',
    ssr: true,
    lib: {
      entry: { index: r('src/index.ts'), cli: r('src/cli.ts') },
      formats: ['es'],
    },
    rollupOptions: {
      external: [...external, /^node:/],
      output: {
        // Only the executable gets one: a shebang in the library entry would
        // be dead text in every importing bundle.
        banner: (chunk) => (chunk.fileName === 'cli.js' ? '#!/usr/bin/env node' : ''),
      },
    },
    sourcemap: true,
    minify: false,
    emptyOutDir: true,
  },
});
