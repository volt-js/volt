/**
 * The generated project, type-checked by the real compiler.
 *
 * A scaffold is the one kind of code nothing else covers: it is not imported
 * by the repository that ships it, so every other test in this package could
 * pass with templates that do not compile. This renders each template to a
 * temporary directory and runs `tsc` over it, which is what the person who
 * typed `pnpm create` will do ninety seconds later.
 *
 * The Volt packages are mapped to their built `.d.ts` rather than to their
 * source, because that is the surface an installed copy actually exposes — a
 * type that is public in `src` and not exported from `dist` is a break this
 * would otherwise miss.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { TEMPLATES } from '../src/templates.js';
import { REPO, removeScaffolds, scaffold } from './scaffolded.js';

const run = promisify(execFile);

afterAll(removeScaffolds);

/**
 * Where a package's types live once installed.
 *
 * Only the packages a template can name. `@voltdev/reactivity` is here
 * because core's declarations re-export from it, so leaving it out fails on
 * core rather than on anything the template wrote.
 */
const TYPES: Readonly<Record<string, string>> = {
  '@voltdev/core': 'packages/core/dist/index.d.ts',
  '@voltdev/reactivity': 'packages/reactivity/dist/index.d.ts',
  '@voltdev/router': 'packages/router/dist/index.d.ts',
  '@voltdev/query': 'packages/query/dist/index.d.ts',
  '@voltdev/server': 'packages/server/dist/index.d.ts',
};

async function generate(id: string): Promise<string> {
  const directory = await scaffold(id);

  // The workspace's own installed tree, so `vite/client`, `vitest` and the
  // rest resolve without a network install of versions this repository has
  // already resolved once.
  await symlink(join(REPO, 'node_modules'), join(directory, 'node_modules'), 'dir');

  await writeFile(
    join(directory, 'tsconfig.check.json'),
    JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions: {
        paths: Object.fromEntries(
          Object.entries(TYPES).map(([name, path]) => [name, [join(REPO, path)]]),
        ),
      },
    }),
  );

  return directory;
}

describe.each(TEMPLATES.map((template) => template.id))('the %s template', (id) => {
  it(
    'type-checks as generated',
    async () => {
      const directory = await generate(id);

      // Resolves rather than rejects only on exit 0; the compiler's complaint
      // is on stdout, so it has to be read out of the failure.
      const checked = run(join(REPO, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.check.json'], {
        cwd: directory,
      }).catch((error: { stdout?: string; stderr?: string }) => {
        throw new Error(`tsc rejected the ${id} template:\n${error.stdout ?? error.stderr ?? ''}`);
      });

      await expect(checked).resolves.toBeDefined();
    },
    120_000,
  );
});
