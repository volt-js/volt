/**
 * What an application gets from the package entry, as it is published.
 *
 * The other suites import the source a module at a time, which is not what an
 * installed copy looks like: the build bundles the package into one module,
 * and an application's bundler has to decide statement by statement what it
 * can leave behind. `classes` is the one export meant for the browser, so what
 * it costs there, and what its type knows, are checked here against the
 * package built the way it ships — in memory, with nothing written to `dist`.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { build as bundle } from 'esbuild';
import { build as publish } from 'vite';
import * as entry from '../src/index.ts';

const run = promisify(execFile);
const PACKAGE = resolve(import.meta.dirname, '..');
const REPO = resolve(PACKAGE, '../..');
const TEMPLATES = readdirSync(join(REPO, 'packages/create-volt/templates'));
const created: string[] = [];

afterAll(async () => {
  await Promise.all(created.map((path) => rm(path, { recursive: true, force: true })));
});

const published = (async () => {
  const result = await publish({
    root: PACKAGE,
    configFile: join(PACKAGE, 'vite.config.ts'),
    logLevel: 'silent',
    build: { write: false, sourcemap: false },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunks = outputs.flatMap((each) => ('output' in each ? each.output : []));
  const chunk = chunks.find((each) => each.type === 'chunk' && each.isEntry);
  if (chunk?.type !== 'chunk') throw new Error('the package built no entry chunk');
  return chunk.code;
})();

/** What an application's bundler keeps of the package for one import. */
async function shipped(name: string): Promise<string> {
  const code = await published;
  const result = await bundle({
    stdin: {
      contents: `import { ${name} } from '@voltdev/ui';\nconsole.log(${name});`,
      resolveDir: PACKAGE,
    },
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'esnext',
    write: false,
    plugins: [
      {
        name: 'published',
        setup(build) {
          build.onResolve({ filter: /^@voltdev\/ui$/ }, () => ({
            path: 'index.js',
            namespace: 'published',
          }));
          build.onLoad({ filter: /.*/, namespace: 'published' }, () => ({ contents: code }));
        },
      },
    ],
  });
  return result.outputFiles[0]!.text;
}

describe('the entry', () => {
  it('exports every component’s styles under its own name', () => {
    for (const component of entry.componentStyles) {
      expect((entry as Record<string, unknown>)[`${component.name}Styles`], component.name).toBe(
        component,
      );
    }
  });

  it('says the version the package is published as', async () => {
    const manifest = JSON.parse(await readFile(join(PACKAGE, 'package.json'), 'utf8'));
    expect(entry.VERSION).toBe(manifest.version);
  });

  it('maps every part of every component to its class', () => {
    expect(Object.keys(entry.classes)).toEqual(entry.componentStyles.map((each) => each.name));
    for (const component of entry.componentStyles) {
      expect((entry.classes as Record<string, unknown>)[component.name]).toBe(component.classes);
    }
  });
});

describe('`classes`, in an application', () => {
  it.each(TEMPLATES)(
    'knows which components and parts exist, under the compiler options of the %s template',
    async (template) => {
      // Under the repository's own `node_modules`, where the `vite/client`
      // types a template names resolve the way they do in an application.
      const cache = join(REPO, 'node_modules/.cache');
      await mkdir(cache, { recursive: true });
      const directory = await mkdtemp(join(cache, 'volt-ui-classes-'));
      created.push(directory);

      await writeFile(
        join(directory, 'app.ts'),
        [
          `import { classes } from '@voltdev/ui';`,
          `export const content: string = classes.dialog.content;`,
          `// @ts-expect-error -- there is no such component`,
          `export const component = classes.dialgo;`,
          `// @ts-expect-error -- and no such part`,
          `export const part = classes.dialog.contnet;`,
          ``,
        ].join('\n'),
      );
      await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify({
          // The options an application `create-volt` writes is compiled with,
          // `noUncheckedIndexedAccess` among them. Only what says where the
          // files are is replaced.
          extends: join(REPO, 'packages/create-volt/templates', template, 'tsconfig.json'),
          compilerOptions: {
            paths: { '@voltdev/ui': [join(PACKAGE, 'src/index.ts')] },
          },
          include: [],
          files: ['app.ts'],
        }),
      );

      const checked = run(join(REPO, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], {
        cwd: directory,
      }).catch((error: { stdout?: string; stderr?: string }) => {
        throw new Error(`tsc rejected the application:\n${error.stdout ?? error.stderr ?? ''}`);
      });

      await expect(checked).resolves.toBeDefined();
    },
    120_000,
  );

  it('brings the class names into the bundle, and none of the rules', async () => {
    const code = await shipped('classes');
    expect(code).toContain('volt-dialog-content');
    // Every rule reads a token and every animation has a name, so either one
    // in the output is style data the application never asked for.
    expect(code).not.toContain('var(--volt-');
    expect(code).not.toContain('volt-dialog-content-in');
  }, 120_000);

  it('costs an import of anything else nothing it does not name', async () => {
    const code = await shipped('LAYER_BASE');
    expect(code).not.toContain('volt-');
    expect(code).not.toContain('--volt');
  }, 120_000);
});
