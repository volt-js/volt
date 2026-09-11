/**
 * Every server function a template ships survives the transform that builds it.
 *
 * The templates are type-checked as generated, and that is not enough here:
 * TypeScript accepts `@Server()` on a static method, and the plugin's
 * server-function pass refuses one — so a template can type-check cleanly and
 * still fail `vite build` on the first run. The `start` template did exactly
 * that. The refusals are the point of the pass (no guard, not async, static),
 * so each file carrying `@Server()` is run through it, on both sides, the way a
 * build would.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { planServerFunctions } from '../../vite-plugin/src/server-functions.js';
import { TEMPLATES } from '../src/templates.js';

const TEMPLATE_ROOT = resolve(import.meta.dirname, '../templates');

function sourcesIn(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...sourcesIn(path));
    else if (path.endsWith('.ts') && !path.endsWith('.d.ts')) found.push(path);
  }
  return found;
}

describe.each(TEMPLATES.map((template) => template.id))('the %s template', (id) => {
  const root = join(TEMPLATE_ROOT, id);
  const withServer = sourcesIn(root).filter((file) => readFileSync(file, 'utf8').includes('@Server('));

  it.each(['client', 'server'] as const)('builds its server functions for the %s', (side) => {
    for (const file of withServer) {
      const code = readFileSync(file, 'utf8');
      expect(
        () => planServerFunctions(code, { side, id: file, root, module: '@voltdev/server' }),
        relative(root, file),
      ).not.toThrow();
    }
  });
});

it('checks at least one template that has server functions', () => {
  // Otherwise every case above passes by having nothing to look at.
  const any = TEMPLATES.some((template) =>
    sourcesIn(join(TEMPLATE_ROOT, template.id)).some((file) =>
      readFileSync(file, 'utf8').includes('@Server('),
    ),
  );
  expect(any).toBe(true);
});
