/**
 * A component library, compiled by the build that uses it.
 *
 * A library cannot ship compiled templates. What a template compiles to
 * depends on which side of the render it is for — a client clones, a
 * hydrating client claims, a server writes bytes — and that is the consuming
 * build's choice, made per environment; and `__VOLT_BUILD__` identifies the
 * build that printed a page so a client can refuse markup from another one,
 * which a page compiled half by the application and half by a dependency's
 * publisher would quietly break.
 *
 * So a package says `"volt": { "source": true }`, and the build compiles it as
 * its own. Everything else in node_modules is left alone, as before.
 *
 * The application is written out per test rather than kept as a fixture: its
 * dependency has to sit in a real `node_modules`, which is the one directory
 * a repository does not keep.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { build } from 'vite';
import type { RollupOutput } from 'rollup';
import { volt } from '../src/index.js';

const PACKAGES = resolve(import.meta.dirname, '../..');

const alias = [
  ['@voltdev/core/runtime', 'core/src/runtime.ts'],
  ['@voltdev/core/signals', 'core/src/signals.ts'],
  ['@voltdev/core', 'core/src/index.ts'],
  ['@voltdev/reactivity/signals', 'reactivity/src/signals.ts'],
  ['@voltdev/reactivity', 'reactivity/src/index.ts'],
].map(([name, file]) => ({ find: new RegExp(`^${name}$`), replacement: resolve(PACKAGES, file!) }));

/** An application with one dependency, which ships source or does not say. */
function application(shipsSource: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'volt-library-'));
  const write = (path: string, content: string): void => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };

  write(
    'node_modules/@acme/widgets/package.json',
    JSON.stringify({
      name: '@acme/widgets',
      version: '1.0.0',
      type: 'module',
      exports: { '.': './src/index.ts' },
      ...(shipsSource ? { volt: { source: true } } : {}),
    }),
  );
  write('node_modules/@acme/widgets/src/index.ts', `export { Badge } from './badge.js';\n`);
  write(
    'node_modules/@acme/widgets/src/badge.ts',
    `import { Component, Prop } from '@voltdev/core';\n\n` +
      `@Component({ selector: 'a-badge', templateUrl: './badge.html' })\n` +
      `export class Badge {\n  @Prop() label = 'new';\n}\n`,
  );
  write('node_modules/@acme/widgets/src/badge.html', `<span :host class="a-badge">{ label }</span>\n`);

  write(
    'main.ts',
    `import { Component } from '@voltdev/core';\n` +
      `import { Badge } from '@acme/widgets';\n\n` +
      `@Component({ selector: 'a-page', templateUrl: './page.html', imports: [Badge] })\n` +
      `export class Page {}\n`,
  );
  write('page.html', `<div><a-badge label="shipped" class="wide"></a-badge></div>\n`);
  return root;
}

async function bundle(root: string): Promise<string> {
  const result = (await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [volt()],
    resolve: { alias },
    build: {
      write: false,
      target: 'esnext',
      minify: false,
      lib: { entry: join(root, 'main.ts'), formats: ['es'], fileName: 'app' },
    },
  })) as RollupOutput | RollupOutput[];
  const output = Array.isArray(result) ? result[0]!.output : result.output;
  return output[0].code;
}

describe('a dependency that ships Volt source', { timeout: 120_000 }, () => {
  it('has its templates compiled by the build that uses it', async () => {
    const code = await bundle(application(true));

    // The markup is a hoisted template and the path it came from is gone,
    // exactly as for a template in the application's own source.
    expect(code).toMatch(/template\("<span[^"]*"/);
    expect(code).toContain('a-badge');
    expect(code).not.toContain('./badge.html');
  });

  it('is left alone when it does not say so', async () => {
    const code = await bundle(application(false));

    // Still asking for its template at runtime, as every other dependency in
    // node_modules does.
    expect(code).toContain('./badge.html');
    expect(code).not.toMatch(/template\("<span[^"]*"/);
  });

  it('compiles the application itself either way', async () => {
    for (const shipsSource of [true, false]) {
      expect(await bundle(application(shipsSource))).toMatch(/template\("<div/);
    }
  });
});
