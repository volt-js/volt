/**
 * Compile every component's real template, the way a build would.
 *
 * These components hold their markup in `.html` files, which is the only way
 * Volt allows. A build compiles those; this suite has no build, so it reads
 * the same files and registers the render functions the plugin would have
 * written, leaving everything else about each component as it is — its
 * selector, its props, and the class itself.
 *
 * Found rather than listed, so that adding a component is adding two files and
 * nothing else. A template is paired with the class in the module of the same
 * name, which is the rule the directory already follows.
 */
import { defineComponent, getComponentConfig, isComponent, type ComponentType } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';

const TEMPLATES = import.meta.glob<string>('../src/components/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const MODULES = import.meta.glob<Record<string, unknown>>('../src/components/*.ts', {
  eager: true,
});

let compiled = false;

/** Give every component its compiled template, once per run. */
export function compileComponents(): void {
  if (compiled) return;
  compiled = true;

  for (const [path, html] of Object.entries(TEMPLATES)) {
    const module = MODULES[path.replace(/\.html$/, '.ts')];
    if (!module) throw new Error(`No module beside ${path}`);

    const component = Object.values(module).find(
      (value): value is ComponentType<unknown> =>
        isComponent(value) && getComponentConfig(value)?.templateUrl?.endsWith(basename(path)) === true,
    );
    if (!component) throw new Error(`No component in ${path.replace(/\.html$/, '.ts')} names ${basename(path)}`);

    const config = getComponentConfig(component)!;
    defineComponent(
      component,
      { ...config, render: compileTemplate(html, config.selector) },
      propsOf(component),
    );
  }
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The props the class declared, kept across the re-registration. */
function propsOf(component: ComponentType<unknown>): { property: string; alias: string }[] {
  const metadata = (component as { [Symbol.metadata]?: Record<symbol, unknown> })[Symbol.metadata];
  const props = metadata
    ? (Object.getOwnPropertySymbols(metadata)
        .map((key) => metadata[key])
        .find(Array.isArray) as { property: string; alias: string }[] | undefined)
    : undefined;
  return props ?? [];
}

export * from '../src/components/index.js';
