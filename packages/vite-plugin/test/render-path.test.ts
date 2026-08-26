/**
 * The edge check, from both sides of the boundary it draws.
 *
 * Half of this is a real build, because the claim is about a graph: the import
 * that breaks a deploy is normally three modules below anything the reviewer
 * of the entry was reading, and a source-level assertion cannot see it. The
 * fixture is built through `volt()` as well, in the order the plugin array
 * uses, because the pass this one reads the boundary from is the pass that
 * erases it — the ordering is part of the feature rather than a detail of the
 * test.
 *
 * The other half is the boundary itself, asserted directly. "Which imports the
 * render can reach" is the only interesting judgement in the file, and driving
 * it through a bundler for every shape of import would be slow and would say
 * less.
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { build } from 'vite';
import { volt } from '../src/index.js';
import {
  isNodeBuiltin,
  renderEdges,
  renderPath,
  serverFunctionRanges,
  type RenderPathOptions,
} from '../src/render-path.js';

const ROOT = resolve(import.meta.dirname, '..');
const APP = resolve(import.meta.dirname, 'fixtures/edge-app');

const alias = {
  '@voltdev/core/server': resolve(APP, 'runtime/server.ts'),
  '@voltdev/server/client': resolve(APP, 'runtime/rpc.ts'),
  '@voltdev/server': resolve(APP, 'runtime/rpc.ts'),
};

async function buildEdge(
  entry: string,
  options?: RenderPathOptions,
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  await build({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    plugins: [renderPath(options), volt()],
    resolve: { alias },
    ssr: { noExternal: true },
    build: {
      write: false,
      target: 'esnext',
      minify: false,
      ssr: resolve(APP, entry),
      rollupOptions: {
        output: { format: 'es' as const },
        onwarn(warning) {
          warnings.push(warning.message);
        },
      },
    },
  });
  return { warnings };
}

describe('what the render path is allowed to import', { timeout: 120_000 }, () => {
  it('lets a builtin through that only a @Server() body reaches', async () => {
    await expect(buildEdge('ok.ts')).resolves.toBeDefined();
  });

  it('fails the build on a builtin the render itself reaches', async () => {
    await expect(buildEdge('bad-static.ts')).rejects.toThrow(/node:path/);
  });

  it('follows the graph down to a builtin nobody reading the entry would see', async () => {
    const failure = await buildEdge('bad-deep.ts').catch((error: unknown) => error);
    const message = String(failure);

    expect(message).toContain('node:fs');
    // The chain, so the fix is obvious from the message alone.
    expect(message).toContain('bad-deep.ts');
    expect(message).toContain('layout.ts');
    expect(message).toContain('metadata.ts');
  });

  it('fails on an import() the render performs, not only on a declaration', async () => {
    await expect(buildEdge('bad-dynamic.ts')).rejects.toThrow(/node:path/);
  });

  it('says nothing about a build with no renderer in it', async () => {
    await expect(buildEdge('no-render.ts')).resolves.toBeDefined();
  });

  it('checks the entry a project names, whatever it imports', async () => {
    await expect(
      buildEdge('server-only-entry.ts', { entries: ['server-only-entry.ts'] }),
    ).rejects.toThrow(/node:fs/);
  });

  it('lets a project allow a builtin its runtime really has', async () => {
    await expect(buildEdge('bad-static.ts', { allow: ['node:path'] })).resolves.toBeDefined();
  });

  it('fails on the bare spelling of a builtin as readily as the prefixed one', async () => {
    // `fs` resolves to the same module as `node:fs` and fails the same deploy.
    // A check that knew only the prefix would pass most code written before
    // the prefix existed, which is most code.
    await expect(buildEdge('bad-bare.ts')).rejects.toThrow(/\bfs\b/);
  });

  it('reports without failing when asked to warn, and does neither when off', async () => {
    const warned = await buildEdge('bad-static.ts', { level: 'warn' });
    expect(warned.warnings.join('\n')).toContain('node:path');

    const off = await buildEdge('bad-static.ts', { level: 'off' });
    expect(off.warnings.join('\n')).not.toContain('node:path');
  });
});

describe('where the server half of a module begins and ends', () => {
  it('covers the decorator, the signature and the body', () => {
    const code = [
      'class Doc {',
      '  @Server({ public: true })',
      '  async load(id: string): Promise<string> {',
      '    return read(id);',
      '  }',
      '}',
    ].join('\n');

    const [range] = serverFunctionRanges(code);
    const covered = code.slice(range!.start, range!.end);

    expect(covered.startsWith('@Server(')).toBe(true);
    expect(covered).toContain('return read(id);');
    expect(covered.endsWith('}')).toBe(true);
    expect(code.slice(range!.end)).toBe('\n}');
  });

  it('does not mistake a brace in the return type for the body', () => {
    const code = [
      'class Doc {',
      '  @Server({ public: true })',
      '  async load(): Promise<{ id: string }> {',
      '    return { id: secret() };',
      '  }',
      '}',
    ].join('\n');

    const [range] = serverFunctionRanges(code);
    expect(code.slice(range!.start, range!.end)).toContain('return { id: secret() };');
  });

  it('finds every server function, and only those', () => {
    const code = [
      'class Doc {',
      '  @Component({ selector: "x" })',
      '  render() { return plain(); }',
      '  @Server({ public: true })',
      '  async a() { return one(); }',
      '  @Server({ public: true })',
      '  async b() { return two(); }',
      '}',
    ].join('\n');

    const covered = serverFunctionRanges(code).map((range) => code.slice(range.start, range.end));
    expect(covered).toHaveLength(2);
    expect(covered[0]).toContain('one()');
    expect(covered[1]).toContain('two()');
    expect(covered.join('')).not.toContain('plain()');
  });
});

describe('what counts as a builtin', () => {
  it('knows both spellings', () => {
    expect(isNodeBuiltin('node:fs')).toBe(true);
    expect(isNodeBuiltin('fs')).toBe(true);
    expect(isNodeBuiltin('node:fs/promises')).toBe(true);
  });

  it('does not claim a package whose name merely starts like one', () => {
    // `fs-extra` and `pathe` are real packages, and refusing them would make
    // the check something a project has to switch off rather than fix.
    expect(isNodeBuiltin('fs-extra')).toBe(false);
    expect(isNodeBuiltin('pathe')).toBe(false);
    expect(isNodeBuiltin('./path.js')).toBe(false);
  });
});

describe('which imports the render can reach', () => {
  const edges = (code: string): string[] =>
    renderEdges(code).map((edge) => edge.specifier);

  it('excuses an import only a server body mentions', () => {
    const code = [
      'import { readFile } from "node:fs/promises";',
      'class Doc {',
      '  @Server({ public: true })',
      '  async load(id: string) { return readFile(id, "utf8"); }',
      '}',
    ].join('\n');

    expect(edges(code)).toEqual([]);
  });

  it('holds the same import to the rule the moment the render uses it too', () => {
    const code = [
      'import { readFile } from "node:fs/promises";',
      'class Doc {',
      '  cached = readFile;',
      '  @Server({ public: true })',
      '  async load(id: string) { return readFile(id, "utf8"); }',
      '}',
    ].join('\n');

    expect(edges(code)).toEqual(['node:fs/promises']);
  });

  it('reads a dynamic import by where it is written', () => {
    const inside = [
      'class Doc {',
      '  @Server({ public: true })',
      '  async load() { const fs = await import("node:fs"); return fs; }',
      '}',
    ].join('\n');
    expect(edges(inside)).toEqual([]);

    const outside = 'export async function page() { return import("node:fs"); }';
    expect(edges(outside)).toEqual(['node:fs']);
  });

  it('drops a type-only import, which reaches nothing at run time', () => {
    expect(edges('import type { Stats } from "node:fs";\nexport type S = Stats;')).toEqual([]);
    expect(edges('import { type Stats } from "node:fs";\nexport type S = Stats;')).toEqual([]);
  });

  it('keeps a side-effect import, which nothing can be said to leave unused', () => {
    expect(edges('import "node:fs";')).toEqual(['node:fs']);
  });

  it('keeps a re-export, whose bindings this module never mentions', () => {
    expect(edges('export { readFile } from "node:fs/promises";')).toEqual(['node:fs/promises']);
    expect(edges('export * from "node:fs";')).toEqual(['node:fs']);
  });

  it('sees a namespace import used by the render', () => {
    const code = [
      'import * as fs from "node:fs";',
      'export function page() { return fs.readFileSync("/x", "utf8"); }',
    ].join('\n');
    expect(edges(code)).toEqual(['node:fs']);
  });

  it('does not read a specifier out of a string or a comment', () => {
    const code = [
      '// import { readFile } from "node:fs";',
      'const help = `import { x } from "node:crypto"`;',
      'export const shown = help;',
    ].join('\n');
    expect(edges(code)).toEqual([]);
  });

  it('does not read a local named the same as an import it never made', () => {
    const code = [
      'import { readFile } from "node:fs/promises";',
      'class Doc {',
      '  @Server({ public: true })',
      '  async load(id: string) { return readFile(id, "utf8"); }',
      '}',
      'export const readFileLater = 1;',
    ].join('\n');
    expect(edges(code)).toEqual([]);
  });
});
