/**
 * What a generated project depends on.
 *
 * A scaffold that pins whatever was current the day it was written hands
 * every new project a version older than the framework scaffolding it, and
 * nothing says so until somebody reads a lockfile. So none of these is a
 * decision made here: each one restates a range the workspace already
 * declares, and `test/versions.test.ts` fails the moment the two disagree.
 *
 * Where each range is declared:
 *
 *   @voltdev/*   the package's own `version`, as a caret range
 *   vite         the workspace root's devDependencies
 *   vitest       likewise
 *   typescript   likewise
 *   happy-dom    likewise
 *   sass         @voltdev/vite-plugin's dependencies — the plugin compiles
 *                the stylesheets, so the app should be on the same Sass
 */
export const VERSIONS = {
  '@voltdev/core': '^0.1.0-alpha.1',
  '@voltdev/query': '^0.1.0-alpha.1',
  '@voltdev/router': '^0.1.0-alpha.1',
  '@voltdev/vite-plugin': '^0.1.0-alpha.1',
  'happy-dom': '^20.11.2',
  sass: '^1.102.0',
  typescript: '^7.0.2',
  vite: '^8.2.1',
  vitest: '^4.1.10',
} as const;

export type DependencyName = keyof typeof VERSIONS;

/**
 * The Volt packages an install can actually reach.
 *
 * `.github/workflows/release.yml` decides this, and deliberately holds some
 * back — a package published at 0.1.0 is permanent, so nothing ships until
 * its shape is meant to be. A template that needs one of the others is still
 * built and still tested; the CLI just will not offer it, because the project
 * it produced could not `pnpm install`. Adding a package to the workflow is
 * the whole change: `test/versions.test.ts` reads the same list.
 */
export const PUBLISHED_PACKAGES: readonly DependencyName[] = [
  '@voltdev/core',
  '@voltdev/vite-plugin',
];

/** Whether this is one of Volt's own packages rather than a tool. */
export function isVoltPackage(name: string): boolean {
  return name.startsWith('@voltdev/');
}

/**
 * Which of these dependencies an install could not resolve today, in the
 * order given. Empty means the project is installable.
 */
export function unpublishedDependencies(
  names: readonly string[],
  published: readonly string[] = PUBLISHED_PACKAGES,
): readonly string[] {
  return names.filter((name) => isVoltPackage(name) && !published.includes(name));
}
