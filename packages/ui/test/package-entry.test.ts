/**
 * What an application gets when it installs the package and writes a tag.
 *
 * The package has two halves that run in different places, and the manifest is
 * where that is decided. `.` is built JavaScript, because `stylesheet()` is
 * called from a build script in Node, where nothing is compiling templates.
 * `./components` is TypeScript source, because a compiled template is compiled
 * for one target and one build — so the build that renders the page has to be
 * the build that compiles it.
 *
 * A manifest can claim that and be wrong in every way that matters: a subpath
 * that points at a file `files` does not publish, a template the compiling
 * build cannot find beside its class, a component whose markup never reaches
 * the page. So the claim is checked the way an application would meet it —
 * `@voltdev/ui/components` resolved through the manifest itself, compiled by
 * the plugin, and read back out of the bundle.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { build } from 'vite';
import type { RollupOutput } from 'rollup';
import { volt } from '../../vite-plugin/src/index.js';

const PACKAGE = resolve(import.meta.dirname, '..');
const PACKAGES = resolve(PACKAGE, '..');
const created: string[] = [];

afterAll(() => {
  for (const path of created) rmSync(path, { recursive: true, force: true });
});

const manifest = JSON.parse(
  await readFile(join(PACKAGE, 'package.json'), 'utf8'),
) as {
  files: string[];
  exports: Record<string, { types: string; import: string }>;
};

describe('what the manifest publishes', () => {
  it('points every entry at a file that exists', () => {
    for (const [subpath, condition] of Object.entries(manifest.exports)) {
      for (const target of [condition.import, condition.types]) {
        // `.` is built, so it exists only after a build; source entries must
        // be there in the repository as they are in the published package.
        if (target.startsWith('./dist/')) continue;
        expect(existsSync(join(PACKAGE, target)), `${subpath} → ${target}`).toBe(true);
      }
    }
  });

  it('ships the directory each entry is in', () => {
    for (const condition of Object.values(manifest.exports)) {
      for (const target of [condition.import, condition.types]) {
        expect(manifest.files).toContain(target.split('/')[1]);
      }
    }
  });

  it('answers with declarations and runs from source', () => {
    // The two halves of a source-shipping entry. A consumer type-checks
    // against built declarations, as they would any package — their own
    // `strict` settings are not applied to somebody else's source — while what
    // their bundler loads is the TypeScript their build has to compile.
    const components = manifest.exports['./components']!;
    expect(components.types).toMatch(/^\.\/dist\/.*\.d\.ts$/);
    expect(components.import).toMatch(/^\.\/src\/.*\.ts$/);
  });

  it('compiles no template of its own into what it publishes', async () => {
    // The sheet half is built for Node, and a component compiled there would
    // be compiled for the wrong build. Nothing in `src/sheet` may reach one.
    const sheet = await readFile(join(PACKAGE, 'src/sheet/index.ts'), 'utf8');
    expect(sheet).not.toContain('@voltdev/core');
  });
});

/** An application that installs the package and writes one of its tags. */
function application(): string {
  // Beside the package, so `@voltdev/core` resolves the way it does for
  // anything else in the workspace.
  const cache = join(PACKAGE, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const root = mkdtempSync(join(cache, 'volt-ui-app-'));
  created.push(root);

  const write = (path: string, content: string): void => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };

  write(
    'main.ts',
    `import { Component } from '@voltdev/core';\n` +
      `import { VButton } from '@voltdev/ui/components';\n\n` +
      `@Component({ selector: 'a-page', templateUrl: './page.html', imports: [VButton] })\n` +
      `export class Page {\n  save = (): void => {};\n}\n`,
  );
  write(
    'page.html',
    `<div><v-button variant="primary" class="wide" :onPress="save">Save</v-button></div>\n`,
  );
  return root;
}

async function bundle(root: string): Promise<string> {
  const result = (await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [volt()],
    resolve: {
      alias: [
        // The manifest's own mapping, which is what is being checked; nothing
        // links this package into an application's `node_modules` here.
        { find: /^@voltdev\/ui\/components$/, replacement: join(PACKAGE, 'src/components/index.ts') },
        ...[
          ['@voltdev/core/runtime', 'core/src/runtime.ts'],
          ['@voltdev/core/signals', 'core/src/signals.ts'],
          ['@voltdev/core', 'core/src/index.ts'],
          ['@voltdev/reactivity/signals', 'reactivity/src/signals.ts'],
          ['@voltdev/reactivity', 'reactivity/src/index.ts'],
          ['@voltdev/primitives', 'primitives/src/index.ts'],
        ].map(([name, file]) => ({
          find: new RegExp(`^${name}$`),
          replacement: resolve(PACKAGES, file!),
        })),
      ],
    },
    build: {
      write: false,
      target: 'esnext',
      minify: false,
      lib: { entry: join(root, 'main.ts'), formats: ['es'], fileName: 'app' },
    },
  })) as RollupOutput | RollupOutput[];
  const output = Array.isArray(result) ? result[0]!.output : result.output;
  return output
    .filter((chunk): chunk is Extract<typeof chunk, { type: 'chunk' }> => chunk.type === 'chunk')
    .map((chunk) => chunk.code)
    .join('\n');
}

describe('an application that writes `<v-button>`', () => {
  it("compiles the package's template with its own build", async () => {
    const code = await bundle(application());

    // The markup came from `button.html`, found beside the class that named
    // it, in a package the application only ever imported by name.
    expect(code).toContain('volt-button');
    // Compiled, not deferred: the class's own `templateUrl` is gone, replaced
    // by the render the build made. (The word itself survives in the runtime,
    // which is what reads the option.)
    expect(code).not.toContain('button.html');
    // And the tag's own words reached the element, through `:host`.
    expect(code).toContain('wide');
  }, 120_000);
});
