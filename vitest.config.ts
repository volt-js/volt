import { defineConfig, type Plugin } from 'vitest/config';
import { resolve } from 'node:path';
import { transform } from 'esbuild';

const root = import.meta.dirname;

/**
 * Lower TC39 standard decorators.
 *
 * Vite 8 transforms with oxc, which parses decorators but emits them
 * untouched — and no engine implements them, so they fail at runtime. esbuild
 * is the transform that actually lowers them.
 *
 * This is deliberately inlined rather than imported from
 * `@voltdev/vite-plugin`: config files load before the plugin's own source can
 * be resolved. The published plugin does exactly this, and is covered by
 * `packages/vite-plugin/test`.
 */
function decorators(): Plugin {
  return {
    name: 'volt:decorators',
    enforce: 'pre',
    async transform(code, id) {
      if (!/\.m?ts$/.test(id.split('?')[0] ?? id)) return null;
      if (!/^\s*@[A-Za-z_$]/m.test(code)) return null;

      const result = await transform(code, {
        loader: 'ts',
        target: 'es2022',
        sourcefile: id,
        sourcemap: true,
        tsconfigRaw: {
          compilerOptions: {
            experimentalDecorators: false,
            useDefineForClassFields: true,
          },
        },
      });

      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig({
  plugins: [decorators()],
  // Tests assert on the developer diagnostics, so they run with them on. In a
  // production build @voltdev/vite-plugin defines this as false and the
  // minifier removes every guarded block.
  //
  // Server mode is a live read of a global rather than a constant, because a
  // real build picks one side and a test has to render both: the same source
  // has to be a server build in one case and a client build in the next.
  define: {
    __VOLT_DEV__: 'true',
    __VOLT_SERVER__: 'globalThis.__VOLT_SERVER__ === true',
  },
  resolve: {
    alias: {
      '@voltdev/reactivity/signals': resolve(root, 'packages/reactivity/src/signals.ts'),
      '@voltdev/reactivity': resolve(root, 'packages/reactivity/src/index.ts'),
      '@voltdev/compiler': resolve(root, 'packages/compiler/src/index.ts'),
      '@voltdev/primitives': resolve(root, 'packages/primitives/src/index.ts'),
      '@voltdev/query': resolve(root, 'packages/query/src/index.ts'),
      '@voltdev/testing': resolve(root, 'packages/testing/src/index.ts'),
      // The CLI reads this one. Aliased to the source like the rest, so a test
      // never quietly checks a `dist` built before the change under test.
      '@voltdev/vite-plugin/components': resolve(root, 'packages/vite-plugin/src/components.ts'),
      '@voltdev/router': resolve(root, 'packages/router/src/index.ts'),
      // Longest first — '@voltdev/core' would otherwise shadow its subpaths.
      '@voltdev/core/runtime': resolve(root, 'packages/core/src/runtime.ts'),
      '@voltdev/core/server': resolve(root, 'packages/core/src/server.ts'),
      '@voltdev/core/jit': resolve(root, 'packages/core/src/jit.ts'),
      '@voltdev/core/signals': resolve(root, 'packages/core/src/signals.ts'),
      '@voltdev/core/devtools': resolve(root, 'packages/core/src/devtools.ts'),
      '@voltdev/core': resolve(root, 'packages/core/src/index.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['packages/*/test/**/*.test.ts'],
    // Benchmarks are opt-in: `pnpm bench`.
    exclude: ['**/node_modules/**', 'benchmarks/**'],
    globals: false,
  },
});
