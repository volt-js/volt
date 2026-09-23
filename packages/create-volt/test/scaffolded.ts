/**
 * A template rendered to a directory of its own, for the tests that have to
 * treat it as a project rather than as data.
 *
 * Not a test file, so the runner does not collect it. It is shared because
 * the two tests that use it answer different questions about the same thing —
 * does the generated project type-check, and does it run — and a project the
 * two of them rendered differently would be two different projects.
 */
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { renderProject, writeProject } from '../src/scaffold.js';
import { TEMPLATES, templateDependencies } from '../src/templates.js';

export const REPO = resolve(import.meta.dirname, '../../..');

const created: string[] = [];

/** The template, rendered into a fresh temporary directory; its path. */
export async function scaffold(id: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `create-volt-${id}-`));
  created.push(directory);

  const template = TEMPLATES.find((each) => each.id === id);
  if (!template) throw new Error(`no template ${id}`);
  await writeProject(directory, await renderProject({ name: `${id}-app`, template }));
  return directory;
}

/** Every directory `scaffold` made, removed. For an `afterAll`. */
export async function removeScaffolds(): Promise<void> {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
}

interface Manifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  files?: string[];
}

const SCOPE = '@voltdev/';

/**
 * The template's dependencies, in `node_modules` the way an install puts them.
 *
 * Volt's own packages are *copied*, and only what each one publishes — its
 * `package.json` and its `files` — so the project gets the built `dist` a
 * registry would hand it and nothing from `src`. A link would not do: a
 * package whose real path is outside `node_modules` is one Vite treats as
 * the project's own source, and compiles with the project's settings, where
 * an installed one is a dependency it pre-bundles or leaves to Node. Those
 * are different builds, and the one to test is the one a person gets.
 *
 * Everything else is linked from where the workspace already installed it,
 * which is the same package a network install would fetch, without fetching
 * it again.
 */
export async function install(directory: string, id: string): Promise<void> {
  const template = TEMPLATES.find((each) => each.id === id);
  if (!template) throw new Error(`no template ${id}`);

  const volt = new Set<string>();
  const others = new Set<string>();
  const pending: string[] = [...templateDependencies(template)];
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (!name.startsWith(SCOPE)) {
      others.add(name);
      continue;
    }
    if (volt.has(name)) continue;
    volt.add(name);
    const manifest = await manifestOf(name);
    pending.push(
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    );
  }

  for (const name of volt) {
    const source = packageDirectory(name);
    const target = join(directory, 'node_modules', name);
    await mkdir(target, { recursive: true });
    await cp(join(source, 'package.json'), join(target, 'package.json'));
    for (const file of (await manifestOf(name)).files ?? []) {
      if (await exists(join(source, file))) {
        await cp(join(source, file), join(target, file), { recursive: true });
      }
    }
  }

  for (const name of others) {
    const target = join(directory, 'node_modules', name);
    await mkdir(dirname(target), { recursive: true });
    await symlink(await installedCopy(name), target, 'dir');
  }
}

function packageDirectory(name: string): string {
  return join(REPO, 'packages', name.slice(SCOPE.length));
}

async function manifestOf(name: string): Promise<Manifest> {
  return JSON.parse(await readFile(join(packageDirectory(name), 'package.json'), 'utf8')) as Manifest;
}

/** Where the workspace installed a third-party package: the root first, then a package. */
async function installedCopy(name: string): Promise<string> {
  const candidates = [
    join(REPO, 'node_modules', name),
    ...['vite-plugin', 'core', 'compiler', 'create-volt'].map((each) =>
      join(REPO, 'packages', each, 'node_modules', name),
    ),
  ];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error(`${name} is not installed anywhere in the workspace`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
