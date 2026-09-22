/**
 * Every component reaches the entry an application imports from.
 *
 * `@voltdev/ui/components` is the only way in. A component missing from it is
 * a component that exists in its own tests and nowhere else — which is exactly
 * what happened to the first four written here, all four at once, and which no
 * other test could see: each component's suite imports the file directly,
 * because that is what a suite for that file does.
 */
import { describe, expect, it } from 'vitest';
import { getComponentConfig, isComponent } from '@voltdev/core';
import * as barrel from '../src/components/index.ts';

const MODULES = import.meta.glob<Record<string, unknown>>('../src/components/*.ts', {
  eager: true,
});

/** Every component class declared under `src/components`, by its selector. */
const declared = new Map<string, string>();
for (const [path, module] of Object.entries(MODULES)) {
  if (path.endsWith('/index.ts')) continue;
  for (const value of Object.values(module)) {
    if (!isComponent(value)) continue;
    const selector = getComponentConfig(value)?.selector;
    if (selector) declared.set(selector, path);
  }
}

const exported = new Set(
  Object.values(barrel)
    .filter(isComponent)
    .map((component) => getComponentConfig(component)?.selector),
);

describe('the components entry', () => {
  it('has components to check, so an empty pass cannot be a passing one', () => {
    expect(declared.size).toBeGreaterThan(5);
  });

  for (const [selector, path] of declared) {
    it(`exports ${selector}`, () => {
      expect(exported, `${selector} is declared in ${path} and exported from nowhere`).toContain(
        selector,
      );
    });
  }
});
