/**
 * The versions a generated project installs, against the versions this
 * repository actually uses.
 *
 * A scaffold pins its output, and a pin is the one kind of staleness nothing
 * reports: the generated project installs, its tests pass, and it is simply a
 * year behind. So none of `VERSIONS` is allowed to be a decision — every entry
 * has to restate something declared elsewhere in the workspace, and this is
 * where the two are compared.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TEMPLATES, templateDependencies } from '../src/templates.js';
import { PUBLISHED_PACKAGES, VERSIONS, unpublishedDependencies } from '../src/versions.js';

const REPO = resolve(import.meta.dirname, '../../..');

async function manifest(path: string): Promise<{
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}> {
  return JSON.parse(await readFile(resolve(REPO, path), 'utf8'));
}

describe('the Volt packages', () => {
  it.each(Object.keys(VERSIONS).filter((name) => name.startsWith('@voltdev/')))(
    '%s is offered at the version the workspace is on',
    async (name) => {
      const { version } = await manifest(`packages/${name.slice('@voltdev/'.length)}/package.json`);
      expect(VERSIONS[name as keyof typeof VERSIONS]).toBe(`^${version}`);
    },
  );
});

describe('the toolchain', () => {
  it.each(['happy-dom', 'typescript', 'vite', 'vitest'] as const)(
    '%s matches the workspace root',
    async (name) => {
      const { devDependencies } = await manifest('package.json');
      expect(VERSIONS[name]).toBe(devDependencies?.[name]);
    },
  );

  /**
   * Sass is the plugin's, not the root's. The plugin compiles `styleUrl`, so a
   * project on a different Sass than the plugin would be compiling its two
   * kinds of stylesheet with two different compilers.
   */
  it('sass matches the version the Vite plugin compiles with', async () => {
    const { dependencies } = await manifest('packages/vite-plugin/package.json');
    expect(VERSIONS.sass).toBe(dependencies?.sass);
  });
});

describe('what a template may depend on', () => {
  it.each(TEMPLATES)('$id names a version for everything it installs', (template) => {
    for (const dependency of templateDependencies(template)) {
      expect(VERSIONS[dependency], `${template.id} installs ${dependency}`).toBeDefined();
    }
  });

  /**
   * The CLI offers a template only when everything it needs is on npm, and the
   * release workflow is what decides that. Read from the workflow rather than
   * restated here, so that publishing a package is one edit and not two.
   */
  it('claims nothing is published that the release workflow does not publish', async () => {
    const workflow = await readFile(resolve(REPO, '.github/workflows/release.yml'), 'utf8');
    const line = /PACKAGES="([^"]+)"/.exec(workflow);
    expect(line, 'release.yml no longer declares PACKAGES').not.toBeNull();

    const shipped = line![1]!.split(/\s+/).map((name) => `@voltdev/${name}`);
    expect(shipped).toEqual(expect.arrayContaining([...PUBLISHED_PACKAGES]));
  });

  it('offers at least one template that could actually be installed', () => {
    const offered = TEMPLATES.filter(
      (template) => unpublishedDependencies(templateDependencies(template)).length === 0,
    );
    expect(offered.map((template) => template.id)).toContain('minimal');
  });
});
