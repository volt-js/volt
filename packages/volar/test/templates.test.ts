/**
 * The reverse index, which is the part of this that Vue never had to build.
 *
 * Two things have to be true of it or nothing above it works. It has to find
 * the class from the template, and it has to stop claiming a template the
 * moment a component stops pointing at one — a stale entry is worse than no
 * entry, because it types a file against a class that has nothing to do with
 * it.
 */

import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTemplateIndex, exportedName, type TemplateIndex } from '../src/index.js';

const APP = resolve(import.meta.dirname, 'fixtures/app');
const src = (file: string): string => resolve(APP, 'src', file);

describe('an index built by reading a project', () => {
  let index: TemplateIndex;

  beforeAll(async () => {
    index = createTemplateIndex();
    await index.scan(APP);
  });

  it('finds the class whose templateUrl points at a template', () => {
    const binding = index.lookup(src('counter.html'));

    expect(binding?.className).toBe('Counter');
    expect(binding?.module).toBe(src('counter.ts'));
    expect(binding?.templateUrl).toBe('./counter.html');
  });

  it('resolves the url against the module that wrote it, not the cwd', () => {
    expect(index.lookup('./counter.html')).toBeUndefined();
    expect(index.lookup(src('list.html'))?.className).toBe('List');
  });

  it('declines an .html file no component points at', () => {
    // The activation decision. Most .html in a project is not a template, and
    // an extension that claimed this one would put TypeScript errors on it.
    expect(index.owns(src('page.html'))).toBe(false);
    expect(index.lookup(src('page.html'))).toBeUndefined();
  });

  it('reads how the class leaves its module, which is how a template reaches it', () => {
    expect(index.lookup(src('counter.html'))?.exportedAs).toBe('Counter');
    expect(index.lookup(src('shortcut.html'))?.exportedAs).toBe('default');
    expect(index.lookup(src('hidden.html'))?.exportedAs).toBeNull();
  });

  it('claims every template in the project and nothing else', () => {
    expect(new Set(index.templates())).toEqual(
      new Set(
        ['counter', 'list', 'broken', 'pending', 'shortcut', 'hidden'].map((n) =>
          src(`${n}.html`),
        ),
      ),
    );
  });

  it('skips directories that cannot hold first-party source', async () => {
    const empty = createTemplateIndex({ ignore: ['src'] });
    await empty.scan(APP);

    expect(empty.templates()).toEqual([]);
  });
});

describe('an index scanned again after the project changed', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'volt-volar-scan-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** A copy of the fixture project, scanned once. */
  async function scanned(): Promise<{ index: TemplateIndex; at: (file: string) => string }> {
    await cp(APP, root, { recursive: true });
    const index = createTemplateIndex();
    await index.scan(root);
    return { index, at: (file) => join(root, 'src', file) };
  }

  it('forgets what a module deleted since the last scan claimed', async () => {
    const { index, at } = await scanned();
    expect(index.owns(at('counter.html'))).toBe(true);

    await rm(at('counter.ts'));

    expect(await index.scan(root)).toEqual([at('counter.ts')]);
    expect(index.owns(at('counter.html'))).toBe(false);
  });

  it('forgets what a module that no longer says templateUrl claimed', async () => {
    const { index, at } = await scanned();
    expect(index.owns(at('list.html'))).toBe(true);

    await writeFile(at('list.ts'), 'export class List {}\n');

    expect(await index.scan(root)).toEqual([at('list.ts')]);
    expect(index.owns(at('list.html'))).toBe(false);
  });

  it('leaves alone a module it can no longer read, which is not one that is gone', async () => {
    const { index, at } = await scanned();
    await chmod(at('counter.ts'), 0o000);

    expect(await index.scan(root)).toEqual([]);
    expect(index.lookup(at('counter.html'))?.className).toBe('Counter');
  });

  it('leaves alone a module it was told about that the walk does not enter', async () => {
    const { index, at } = await scanned();
    // Reported by a host, from a directory a scan never descends into. The
    // scan has not read it, so it has nothing to say about it.
    const built = join(root, 'dist', 'page.ts');
    const code = `@Component({ templateUrl: '../src/page.html' }) export class Page {}`;
    await mkdir(join(root, 'dist'));
    await writeFile(built, code);
    index.update(built, code);

    expect(await index.scan(root)).toEqual([]);
    expect(index.lookup(at('page.html'))?.className).toBe('Page');
  });
});

describe('an index that ignores the case of a path', () => {
  const code = `@Component({ templateUrl: './counter.html' }) export class Counter {}`;
  const module = src('counter.ts');
  const respelled = module.toUpperCase();

  it('withdraws a deleted module reported under another spelling', () => {
    const index = createTemplateIndex({ caseSensitive: false });
    index.update(module, code);

    expect(index.update(respelled, null)).toEqual([src('counter.html')]);
    expect(index.owns(src('counter.html'))).toBe(false);
  });

  it('withdraws the old template of a module reported under another spelling', () => {
    const index = createTemplateIndex({ caseSensitive: false });
    index.update(module, code);

    index.update(respelled, code.replace('./counter.html', './renamed.html'));

    expect(index.owns(src('counter.html'))).toBe(false);
    expect(index.lookup(src('renamed.html'))?.className).toBe('Counter');
  });

  it('is what it defaults to where the default volume ignores case', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
    try {
      const index = createTemplateIndex();
      index.update(module, code);

      expect(index.owns(src('counter.html').toUpperCase())).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });
});

describe('an index kept current as files change', () => {
  const module = src('counter.ts');
  let index: TemplateIndex;
  let code: string;

  beforeAll(async () => {
    code = await readFile(module, 'utf8');
  });

  const fresh = async (): Promise<TemplateIndex> => {
    const made = createTemplateIndex();
    await made.scan(APP);
    return made;
  };

  beforeAll(async () => {
    index = await fresh();
  });

  it('releases the old template and claims the new when a url moves', async () => {
    const moving = await fresh();

    const affected = moving.update(module, code.replace('./counter.html', './renamed.html'));

    expect(new Set(affected)).toEqual(new Set([src('counter.html'), src('renamed.html')]));
    expect(moving.owns(src('counter.html'))).toBe(false);
    expect(moving.lookup(src('renamed.html'))?.className).toBe('Counter');
  });

  it('forgets what a deleted module claimed', async () => {
    const deleting = await fresh();

    expect(deleting.update(module, null)).toEqual([src('counter.html')]);
    expect(deleting.owns(src('counter.html'))).toBe(false);
  });

  it('notices a template that until now belonged to nobody', async () => {
    const adding = await fresh();
    const page = `import { Component } from '../../volt.js';
@Component({ templateUrl: './page.html' })
export class Page {}
`;

    expect(adding.update(src('page.ts'), page)).toEqual([src('page.html')]);
    expect(adding.lookup(src('page.html'))?.className).toBe('Page');
  });

  it('says nothing changed when nothing did, so a keystroke costs nothing', () => {
    const before = index.lookup(src('counter.html'));

    expect(index.update(module, code)).toEqual([]);
    // The same binding, not an equal one: a module that says what it said
    // before is not re-read, so nothing downstream is invalidated either.
    expect(index.lookup(src('counter.html'))).toBe(before);
  });

  it('notices a renamed class in a module that still claims the same template', async () => {
    const renaming = await fresh();

    expect(renaming.update(module, code.replace('class Counter', 'class Tally'))).toEqual([
      src('counter.html'),
    ]);
    expect(renaming.lookup(src('counter.html'))?.className).toBe('Tally');
  });

  it('answers the same way whichever order two claims on one template arrived in', () => {
    const claim = (name: string): string =>
      `import { Component } from '../../volt.js';
@Component({ templateUrl: './shared.html' })
export class ${name} {}
`;

    const forwards = createTemplateIndex();
    forwards.update(src('a.ts'), claim('A'));
    forwards.update(src('b.ts'), claim('B'));

    const backwards = createTemplateIndex();
    backwards.update(src('b.ts'), claim('B'));
    backwards.update(src('a.ts'), claim('A'));

    expect(forwards.lookup(src('shared.html'))?.className).toBe('A');
    expect(backwards.lookup(src('shared.html'))?.className).toBe('A');
  });

  it('keeps a template claimed while one of two claimants withdraws', () => {
    const shared = createTemplateIndex();
    const claim = (name: string): string =>
      `@Component({ templateUrl: './shared.html' }) export class ${name} {}`;
    shared.update(src('a.ts'), claim('A'));
    shared.update(src('b.ts'), claim('B'));

    shared.update(src('a.ts'), null);

    expect(shared.lookup(src('shared.html'))?.className).toBe('B');
  });
});

describe('how a class leaves its module', () => {
  it('reads a plain export', () => {
    expect(exportedName('export class Counter {}', 'Counter')).toBe('Counter');
  });

  it('reads the modifiers a class can carry between export and class', () => {
    expect(exportedName('export abstract class Counter {}', 'Counter')).toBe('Counter');
    expect(exportedName('export declare abstract class Counter {}', 'Counter')).toBe('Counter');
  });

  it('reads a default export, whose name from outside is `default`', () => {
    expect(exportedName('export default class Counter {}', 'Counter')).toBe('default');
    expect(exportedName('class Counter {}\nexport default Counter;\n', 'Counter')).toBe('default');
  });

  it('keeps `default` when another modifier follows it', () => {
    expect(exportedName('export default abstract class Counter {}', 'Counter')).toBe('default');
  });

  it('reads a default export by name on the last line of a file', () => {
    expect(exportedName('class Counter {}\nexport default Counter', 'Counter')).toBe('default');
  });

  it('reads an export written before the decorator', () => {
    const decorated = (exported: string): string =>
      `${exported} @Component({ selector: 'v-counter', templateUrl: './counter.html' })\nclass Counter {}`;

    expect(exportedName(decorated('export'), 'Counter')).toBe('Counter');
    expect(exportedName(decorated('export default'), 'Counter')).toBe('default');

    // The index reads it the same way, so the template is typed.
    const index = createTemplateIndex();
    index.update(src('counter.ts'), decorated('export'));
    expect(index.lookup(src('counter.html'))?.exportedAs).toBe('Counter');
  });

  it('skips a decorator whose arguments hold brackets and quotes of their own', () => {
    const code = `export @Tag(fn(')', "(")) @Component({ templateUrl: './counter.html' }) class Counter {}`;

    expect(exportedName(code, 'Counter')).toBe('Counter');
  });

  it('does not take a comment or a string for the declaration', () => {
    expect(
      exportedName(
        '/** The class Counter renders a number. */\n@Component({})\nexport class Counter {}',
        'Counter',
      ),
    ).toBe('Counter');
    expect(
      exportedName("const note = 'class Counter';\nexport class Counter {}", 'Counter'),
    ).toBe('Counter');
    // Nor for an export: the one in the comment exports nothing.
    expect(exportedName('// export class Counter\nclass Counter {}', 'Counter')).toBeNull();
    expect(exportedName('/* export { Counter } */\nclass Counter {}', 'Counter')).toBeNull();
  });

  it('reads past a template literal or a regular expression holding a quote', () => {
    expect(exportedName('const doc = `class ${"Counter"}`;\nexport class Counter {}', 'Counter')).toBe(
      'Counter',
    );
    // Read as a string or a template literal, either quote would run on over
    // the declaration below it.
    expect(exportedName("const tick = /`/;\nexport class Counter {}", 'Counter')).toBe('Counter');
    expect(exportedName("const a = b / 2, c = d / 3;\nexport class Counter {}", 'Counter')).toBe(
      'Counter',
    );
  });

  it('reads past a division written after a non-null assertion or a postfix operator', () => {
    // Taken for a regular expression, either division would run to the slash
    // inside the template literal, whose backtick then opens one that never
    // closes — and the class would read as not exported.
    expect(
      exportedName(
        'const half = box.width! / 2, glob = `src/${x}`;\nexport class Counter {}',
        'Counter',
      ),
    ).toBe('Counter');
    expect(
      exportedName('const n = i++ / 2; const p = `a/b`;\nexport class Counter {}', 'Counter'),
    ).toBe('Counter');
  });

  it('does not take a re-export for the class of the same name declared here', () => {
    expect(exportedName("class Counter {}\nexport { Counter } from './other.js';", 'Counter')).toBeNull();
  });

  it('reads a class exported by a clause after the fact', () => {
    expect(exportedName('class Counter {}\nexport { Counter };', 'Counter')).toBe('Counter');
    expect(exportedName('class Counter {}\nexport { Counter as Tally };', 'Counter')).toBe('Tally');
    expect(exportedName('class C {}\nexport { C as default };', 'C')).toBe('default');
  });

  it('says so when nothing exports the class', () => {
    expect(exportedName('class Counter {}', 'Counter')).toBeNull();
    expect(exportedName('export class Other {}\nclass Counter {}', 'Counter')).toBeNull();
  });
});
