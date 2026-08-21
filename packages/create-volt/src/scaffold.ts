/**
 * Turning a template into a project, as data before it is anything else.
 *
 * `renderProject` returns the whole tree in memory — every path and every
 * byte — and `writeProject` is the only thing here that touches a disk. A
 * test can then assert on what would be written without a temporary
 * directory, and the two halves fail separately: a wrong file is a rendering
 * bug, a missing one is a writing bug.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { TemplateDefinition } from './templates.js';
import { VERSIONS } from './versions.js';

/** Replaced by the project's name wherever it appears in a template file. */
export const PROJECT_NAME_TOKEN = '__PROJECT_NAME__';

/**
 * Files whose name a package manager or a git client would act on cannot be
 * stored under that name: an ignore file inside the templates would apply to
 * this repository, and npm strips a `.gitignore` out of a published tarball
 * altogether. Stored plainly, renamed on the way out.
 */
const RENAMED: Readonly<Record<string, string>> = { gitignore: '.gitignore' };

export interface ProjectSpec {
  /** The `name` field of the generated manifest. */
  readonly name: string;
  readonly template: TemplateDefinition;
}

/** Where the template files live, in the source tree and in the package alike. */
export function templatesDirectory(): string {
  return resolve(import.meta.dirname, '../templates');
}

/**
 * npm's rule for a package name, minus the parts a scaffold cannot hit: no
 * uppercase, no leading dot or underscore, nothing that needs escaping in a
 * URL. Enforced because `pnpm install` is what rejects it otherwise, several
 * steps after the mistake was made.
 */
const VALID_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export function isValidProjectName(name: string): boolean {
  return name.length > 0 && name.length <= 214 && VALID_NAME.test(name);
}

/**
 * A name npm would accept, derived from whatever the directory is called.
 *
 * `My App/` is a perfectly ordinary directory and an invalid package name, so
 * the alternative to this is refusing to scaffold into it.
 */
export function toProjectName(directoryName: string): string {
  const cleaned = directoryName
    .trim()
    .toLowerCase()
    .replace(/^[._]+/, '')
    .replace(/[^a-z0-9-._~]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'volt-app';
}

/**
 * The generated `package.json`.
 *
 * Built here rather than kept as a template file so that a version can only
 * ever come from `VERSIONS` — a checked-in manifest is exactly the place a
 * stale pin hides.
 */
export function projectManifest(spec: ProjectSpec): string {
  const ranges = (names: readonly string[]): Record<string, string> =>
    Object.fromEntries(
      [...names].sort().map((name) => [name, VERSIONS[name as keyof typeof VERSIONS]]),
    );

  const manifest = {
    name: spec.name,
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
    },
    dependencies: ranges(spec.template.dependencies),
    devDependencies: ranges(spec.template.devDependencies),
  };

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Every path a template contributes, relative to the template's own root. */
async function templateFiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await templateFiles(join(directory, entry.name), path)));
    } else {
      files.push(path);
    }
  }

  return files;
}

/**
 * The project as it would be on disk: path to contents, paths in sorted
 * order so that two renders of the same spec are byte-identical.
 */
export async function renderProject(spec: ProjectSpec): Promise<Map<string, string>> {
  const root = join(templatesDirectory(), spec.template.id);
  const paths = await templateFiles(root);
  const rendered = new Map<string, string>();

  for (const path of paths.sort()) {
    const source = await readFile(join(root, path), 'utf8');
    const segments = path.split('/');
    const name = segments.at(-1) as string;
    const renamed = [...segments.slice(0, -1), RENAMED[name] ?? name].join('/');
    rendered.set(renamed, source.replaceAll(PROJECT_NAME_TOKEN, spec.name));
  }

  rendered.set('package.json', projectManifest(spec));

  return new Map([...rendered].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export async function writeProject(
  directory: string,
  files: ReadonlyMap<string, string>,
): Promise<void> {
  for (const [path, contents] of files) {
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }
}

/**
 * Whether it is safe to write here.
 *
 * A repository someone has just `git init`-ed is empty as far as this is
 * concerned — refusing it would mean the two commands cannot be run in the
 * order people actually run them.
 */
export async function isWritableDirectory(directory: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    // Nothing there at all, which is the common case.
    return true;
  }
  return entries.every((entry) => entry === '.git');
}
