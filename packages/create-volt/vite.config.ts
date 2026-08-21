import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const r = (p: string) => resolve(import.meta.dirname, p);

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
      external: [/^node:/],
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
