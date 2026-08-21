import type { DependencyName } from './versions.js';

export interface TemplateDefinition {
  /** What `--template` takes, and the directory the files come from. */
  readonly id: string;
  /** One line, shown when the CLI asks which one to use. */
  readonly summary: string;
  readonly dependencies: readonly DependencyName[];
  readonly devDependencies: readonly DependencyName[];
}

/**
 * Every template ships the same toolchain, because a project that cannot run
 * its own test is not a starting point. `sass` is the project's own rather
 * than the plugin's: the plugin compiles `styleUrl`, but a stylesheet the
 * application imports itself goes through Vite's CSS pipeline, which resolves
 * Sass from the project.
 */
const TOOLCHAIN: readonly DependencyName[] = [
  '@voltdev/vite-plugin',
  'happy-dom',
  'sass',
  'typescript',
  'vite',
  'vitest',
];

export const TEMPLATES: readonly TemplateDefinition[] = [
  {
    id: 'minimal',
    summary: 'One component, its template, a stylesheet and a test.',
    dependencies: ['@voltdev/core'],
    devDependencies: TOOLCHAIN,
  },
  {
    id: 'router-query',
    summary: 'Nested routes and a shared server-state cache.',
    dependencies: ['@voltdev/core', '@voltdev/query', '@voltdev/router'],
    devDependencies: TOOLCHAIN,
  },
];

export const DEFAULT_TEMPLATE = 'minimal';

export function findTemplate(id: string): TemplateDefinition | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

/** Everything a template installs, runtime and development alike. */
export function templateDependencies(template: TemplateDefinition): readonly DependencyName[] {
  return [...template.dependencies, ...template.devDependencies];
}
