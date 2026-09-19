/**
 * The virtual TypeScript a template becomes, and the positions in it.
 *
 * The generated code is only half of what an editor needs; the other half is
 * the claim that a character of it stands for a particular character of the
 * template. That claim is what every feature rides on — a hover on the wrong
 * column, a rename that edits the wrong four letters — so the test that
 * matters here is not that some code came out, it is that every position the
 * mapping offers is the position it says it is.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SourceMap, type CodeInformation, type CodeMapping } from '@volar/language-core';
import {
  createTemplateIndex,
  generateTemplateModule,
  type ComponentBinding,
  type GeneratedTemplate,
  type TemplateIndex,
} from '../src/index.js';

const APP = resolve(import.meta.dirname, 'fixtures/app');
const src = (file: string): string => resolve(APP, 'src', file);

let index: TemplateIndex;

beforeAll(async () => {
  index = createTemplateIndex();
  await index.scan(APP);
});

/** Restate one of the fixture templates, as the plugin would. */
async function restate(name: string): Promise<{ source: string; out: GeneratedTemplate }> {
  const file = src(`${name}.html`);
  const source = await readFile(file, 'utf8');
  const binding = index.lookup(file);
  expect(binding).toBeDefined();
  return { source, out: generateTemplateModule(source, binding!) };
}

/** Every position the mapping offers for navigating or completing. */
function precise(out: GeneratedTemplate) {
  return out.mappings.filter((m) => m.data.navigation === true);
}

/**
 * The mapping a diagnostic about the node at `at` would come back through.
 *
 * Those are the ones a cursor never uses: the generated text is longer than
 * the template's, so they can say what a range means without being able to
 * say what a position does.
 */
function node(out: GeneratedTemplate, at: number, length: number) {
  const found = out.mappings.find(
    (m) => m.sourceOffsets[0] === at && m.lengths[0] === length && m.data.navigation === false,
  );
  expect(found).toBeDefined();
  return found!;
}

/** What the template says at the range a generated range maps back to. */
function readBack(map: SourceMap<CodeInformation>, source: string, mapping: CodeMapping): string {
  const from = mapping.generatedOffsets[0]!;
  const [range] = [...map.toSourceRange(from, from + mapping.generatedLengths![0]!, false)];
  expect(range).toBeDefined();
  return source.slice(range![0], range![1]);
}

describe('what the restatement is typed against', () => {
  it('reaches the class through its module, so the declaration is the real one', async () => {
    const { out } = await restate('counter');

    // A type-level import rather than an import statement: it names no value,
    // so nothing in the block can collide with it and nothing reports it as
    // unused.
    expect(out.code).toContain('typeof import("./counter.js").Counter');
    expect(out.code).toContain('const _ctx =');
  });

  it('spells the specifier the way every resolution mode accepts', async () => {
    const { out } = await restate('list');

    // `./list.js`, never `./list` and never `./list.ts` — the first fails
    // under node16, the second under everything but bundler.
    expect(out.code).toContain('import("./list.js")');
  });

  it('names a default-exported class `default`', async () => {
    const { out } = await restate('shortcut');

    expect(out.code).toContain('typeof import("./shortcut.js").default');
  });

  it('falls back to any for a class nothing exports, rather than to never', async () => {
    const { out } = await restate('hidden');

    // No import, because there is nothing to import. Every expression in the
    // template is then untyped, which offers no completion — and, far more
    // importantly, reports nothing that is not true.
    expect(out.code).not.toContain('import(');
    expect(out.code).toContain('abstract new (...args: never[]) => any');
  });

  it('is a module, so its declarations are nobody else’s', async () => {
    const { out } = await restate('counter');

    expect(out.code.trimEnd().endsWith('export {};')).toBe(true);
  });
});

describe('the positions it claims', () => {
  it('says a name stands for a name, and the same name', async () => {
    const { source, out } = await restate('counter');
    const found = precise(out);

    expect(found.length).toBeGreaterThan(0);
    for (const mapping of found) {
      const at = mapping.sourceOffsets[0]!;
      const to = mapping.generatedOffsets[0]!;
      expect(out.code.slice(to, to + mapping.generatedLengths![0]!)).toBe(
        source.slice(at, at + mapping.lengths[0]!),
      );
    }
  });

  it('covers every name a person could put a cursor on', async () => {
    const { source, out } = await restate('counter');
    const named = precise(out).map((m) => source.slice(m.sourceOffsets[0]!, m.sourceOffsets[0]! + m.lengths[0]!));

    // The component's own members, the method it calls, and the property read
    // off it — the interpolations and the directive alike.
    expect(new Set(named)).toEqual(
      new Set(['label', 'count', 'get', 'increment', 'step', 'press', '$event']),
    );
  });

  it('maps a template offset onto the generated one, and back', async () => {
    const { source, out } = await restate('counter');
    const map = new SourceMap(out.mappings);
    const at = source.indexOf('increment');

    const [generated] = [...map.toGeneratedLocation(at)];
    expect(generated).toBeDefined();
    expect(out.code.slice(generated![0], generated![0] + 'increment'.length)).toBe('increment');

    const [back] = [...map.toSourceLocation(generated![0])];
    expect(back?.[0]).toBe(at);
  });

  it('underlines a member nested in an expression, not the end of the line', async () => {
    const { source, out } = await restate('counter');
    const map = new SourceMap(out.mappings);
    const at = source.indexOf('count');

    // What the checker says about `_ctx.count` — an argument of the wrong
    // type, say — is reported from a character the template does not have,
    // the `_` of the instance the printer put in front of the name. It still
    // comes back as the five characters a person wrote. A signal where its
    // value was meant is not one of these: that rule is carried by the marker
    // argument after the expression, which no mapping covers, so it never
    // reaches the template at all.
    expect(readBack(map, source, node(out, at, 'count'.length))).toBe('count');
  });

  it('gives a diagnostic about a whole call the whole expression', async () => {
    const { source, out } = await restate('counter');
    const map = new SourceMap(out.mappings);
    const at = source.indexOf('press($event)');

    expect(readBack(map, source, node(out, at, 'press($event)'.length))).toBe('press($event)');
  });

  it('claims nothing for the scaffolding it had to write', async () => {
    const { out } = await restate('counter');
    const map = new SourceMap(out.mappings);

    // The header types `_ctx` and belongs to nobody. An error there — an
    // unresolvable module, say — must not surface on a line of the template.
    expect([...map.toSourceLocation(out.code.indexOf('__VoltInstance'))]).toEqual([]);
  });
});

describe('what is reported and what is spared', () => {
  it('turns verification off for an expression a comment spares', async () => {
    const { source, out } = await restate('broken');
    const spared = source.indexOf('whatever');
    const checked = source.indexOf('subtitle');

    const covering = (at: number) =>
      out.mappings.filter((m) => at >= m.sourceOffsets[0]! && at < m.sourceOffsets[0]! + m.lengths[0]!);

    expect(covering(spared).length).toBeGreaterThan(0);
    expect(covering(spared).every((m) => m.data.verification === false)).toBe(true);
    expect(covering(checked).some((m) => m.data.verification === true)).toBe(true);
  });
});

describe('a template being typed into', () => {
  it('completes an expression that stops at a dot, so there is something to ask about', async () => {
    const { source, out } = await restate('pending');

    expect(out.broken).toBe(false);
    expect(out.code).toContain('_ctx./*@volt:0*/user./*@volt:5*/__volt_completion');

    // The placeholder occupies no characters of the template: it stands at
    // the empty position after the dot, which is where the cursor is.
    const at = source.indexOf('user.') + 'user.'.length;
    const pending = out.mappings.filter((m) => m.sourceOffsets[0] === at && m.lengths[0] === 0);

    expect(pending).toHaveLength(1);
    expect(pending[0]!.data.completion).toBe(true);
    expect(pending[0]!.data.verification).toBe(false);
  });

  it('leaves the names before the dot exactly where they were', async () => {
    const { source, out } = await restate('pending');
    const user = out.mappings.find((m) => m.lengths[0] === 'user'.length);

    expect(user).toBeDefined();
    expect(source.slice(user!.sourceOffsets[0]!, user!.sourceOffsets[0]! + 4)).toBe('user');
  });

  it('reports nothing at all about the expression it completed', async () => {
    const { out } = await restate('pending');

    expect(out.mappings.every((m) => m.data.verification === false)).toBe(true);
  });

  it('survives a tag that is still being closed', async () => {
    const binding: ComponentBinding = index.lookup(src('counter.html'))!;
    const out = generateTemplateModule('<div><p>{ label }</p>', binding);

    // Nothing to answer with until the tag is closed, but a valid module all
    // the same: a half-typed tag must not take the TypeScript service down.
    expect(out.broken).toBe(true);
    expect(out.mappings).toEqual([]);
    expect(out.code).toContain('export {};');
  });
});
