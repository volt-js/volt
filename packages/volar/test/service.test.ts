/**
 * What an editor can now answer, asked of the real type checker.
 *
 * Everything above this file is a claim about positions. This is the claim
 * being cashed: a fixture project on disk, the restatements written into it
 * the way an editor's TypeScript layer serves them, and the questions an
 * editor asks — what can I write here, what is this, where is it declared,
 * what else refers to it, what is wrong — put to TypeScript at a position
 * mapped from the template and mapped back the same way.
 *
 * Nothing here is a stub. If the mapping is a character out, these fail.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SourceMap, type CodeInformation } from '@volar/language-core';
import { API, DiagnosticCategory, type Project } from 'typescript/unstable/sync';
import { createTemplateIndex, generateTemplateModule } from '../src/index.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

/** One template, restated, with the map between the two. */
interface Restated {
  /** The template as a person sees it. */
  source: string;
  /** The file the restatement was written to, which is what TypeScript reads. */
  file: string;
  map: SourceMap<CodeInformation>;
}

let root: string;
let api: API;
let dispose: () => void;
let project: Project;
const restated = new Map<string, Restated>();

beforeAll(async () => {
  // A copy, because the restatements are written beside the components: they
  // have to be in the project for TypeScript to read them, and the fixture
  // directory is not the place to leave generated files.
  root = await mkdtemp(join(tmpdir(), 'volt-volar-'));
  await cp(FIXTURES, root, { recursive: true });

  const app = join(root, 'app');
  const index = createTemplateIndex();
  await index.scan(app);

  for (const template of index.templates()) {
    const source = await readFile(template, 'utf8');
    const generated = generateTemplateModule(source, index.lookup(template)!);
    // `.ts` appended to the template's own path, which is where Volar's
    // TypeScript layer serves a virtual file from — so a relative specifier
    // resolves from the template's directory, as the restatement assumes.
    const file = `${template}.ts`;
    await writeFile(file, generated.code);
    restated.set(template, { source, file, map: new SourceMap(generated.mappings) });
  }

  const config = join(app, 'tsconfig.json');
  api = new API({ cwd: app });
  api.parseConfigFile(config);
  const snapshot = api.updateSnapshot({ openProjects: [config] });
  dispose = () => snapshot.dispose();
  project = snapshot.getProject(config)!;
  expect(project).toBeDefined();
});

afterAll(async () => {
  dispose?.();
  api?.close();
  await rm(root, { recursive: true, force: true });
});

/** A template, by fixture name. */
const template = (name: string): Restated => restated.get(join(root, 'app', 'src', `${name}.html`))!;

/**
 * A position in a template, as a position in the file TypeScript reads.
 *
 * `after` asks for the offset just past the text, which is where a cursor is
 * when someone has finished typing it.
 */
function position(name: string, text: string, after = false): { file: string; at: number } {
  const t = template(name);
  const found = t.source.indexOf(text);
  expect(found, `${text} in ${name}.html`).toBeGreaterThanOrEqual(0);
  const [mapped] = [...t.map.toGeneratedLocation(found + (after ? text.length : 0))];
  expect(mapped, `a mapping for ${text} in ${name}.html`).toBeDefined();
  return { file: t.file, at: mapped![0] };
}

/** What the checker offers at a position in a template. */
function completions(name: string, text: string, after = false): string[] {
  const { file, at } = position(name, text, after);
  return (project.checker.getCompletionsAtPosition(file, at)?.entries ?? []).map((e) => e.name);
}

/** What the checker says the thing at a position in a template is. */
function typeAt(name: string, text: string): string {
  const { file, at } = position(name, text);
  const type = project.checker.getTypeAtPosition(file, at);
  expect(type, `a type at ${text}`).toBeDefined();
  return project.checker.typeToString(type!);
}

describe('completion', () => {
  it('offers the component’s own fields and methods inside an interpolation', () => {
    const offered = completions('counter', 'label');

    expect(offered).toEqual(expect.arrayContaining(['label', 'count', 'step', 'increment', 'press']));
  });

  it('offers them typed, so a method comes back as one', () => {
    const { file, at } = position('counter', 'increment');
    const entry = project.checker
      .getCompletionsAtPosition(file, at, { includeSymbol: true })
      ?.entries.find((e) => e.name === 'increment');

    expect(entry?.symbol?.name).toBe('increment');
  });

  it('offers a member list after a dot the author has only just typed', () => {
    // `{ user. }` is not an expression, and the moment it is written is the
    // moment completion matters most.
    const offered = completions('pending', 'user.', true);

    expect(offered).toEqual(expect.arrayContaining(['name', 'email']));
  });

  it('offers the item’s own members inside a :for row', () => {
    const offered = completions('list', 'label');

    expect(offered).toEqual(expect.arrayContaining(['id', 'label']));
    // The row is a Row, not the component, so the component's own fields are
    // not what is on offer here.
    expect(offered).not.toContain('rows');
  });
});

describe('hover', () => {
  it('knows a signal field is a signal, and of what', () => {
    expect(typeAt('counter', 'count')).toBe('State<number>');
  });

  it('types the :for item from the collection it came out of', () => {
    // Not `any`, and not the element type of some array in general: the block
    // iterates the real collection, so the row is what the signal holds.
    expect(typeAt('list', 'row.label')).toBe('Row');
  });

  it('types $event by the name of the event being handled', () => {
    // `:keydown`, so a KeyboardEvent — not the Event a generic handler gets.
    expect(typeAt('counter', '$event')).toBe('KeyboardEvent');
  });

  it('types a default-exported class the same as any other', () => {
    expect(typeAt('shortcut', 'keys')).toBe('string[]');
  });
});

describe('go to definition', () => {
  it('goes from a template expression to the class member', () => {
    const { file, at } = position('counter', 'increment');
    const symbol = project.checker.getSymbolAtPosition(file, at);
    const declaration = symbol?.declarations[0];

    expect(declaration?.path).toBe(join(root, 'app', 'src', 'counter.ts'));

    const node = declaration?.resolve(project);
    const module = project.program.getSourceFile(join(root, 'app', 'src', 'counter.ts'));
    expect(module?.text.slice(node!.getStart(), node!.getStart() + 'increment'.length)).toBe(
      'increment',
    );
  });

  it('goes from a row’s property to the interface that declares it', () => {
    const { file, at } = position('list', 'label');
    const symbol = project.checker.getSymbolAtPosition(file, at);

    expect(symbol?.name).toBe('label');
    expect(symbol?.declarations[0]?.path).toBe(join(root, 'app', 'src', 'list.ts'));
  });
});

describe('rename', () => {
  const module = (): string => join(root, 'app', 'src', 'counter.ts');

  it('reaches the class from a rename started in the template', () => {
    const { file, at } = position('counter', 'label');
    const declaration = project.checker.getSymbolAtPosition(file, at)!.declarations[0]!;
    const source = project.program.getSourceFile(module())!;
    const start = declaration.resolve(project)!.getStart();

    expect(declaration.path).toBe(module());
    expect(source.text.slice(start, start + 'label'.length)).toBe('label');
  });

  it('reaches the template from a rename started in the class', () => {
    const counter = template('counter');
    const source = project.program.getSourceFile(module())!;
    const fromClass = project.checker.getSymbolAtPosition(
      module(),
      source.text.indexOf("label = 'Total'"),
    )!;
    const { file, at } = position('counter', 'label');
    const fromTemplate = project.checker.getSymbolAtPosition(file, at)!;

    // One declaration, reached from both sides: a rename keyed on the
    // declaration edits the template's use because it is a use of the same
    // thing, not because anything told it the two files were related.
    expect(fromTemplate.declarations[0]!.path).toBe(fromClass.declarations[0]!.path);
    expect(fromTemplate.declarations[0]!.index).toBe(fromClass.declarations[0]!.index);

    // And the edit it would make in the restatement, put back where a person
    // would see it made.
    const edits = project.checker.getReferencesToSymbolInFile(file, fromTemplate).map((use) => {
      const node = use.resolve(project)!;
      const [range] = [...counter.map.toSourceRange(node.getStart(), node.end, false)];
      return range ? counter.source.slice(range[0], range[1]) : null;
    });

    expect(edits).toEqual(['label']);
  });
});

describe('live errors', () => {
  /** Every error in a template, where a person would see it underlined. */
  function errors(name: string): { text: string; message: string }[] {
    const t = template(name);
    const found: { text: string; message: string }[] = [];

    for (const d of project.program.getSemanticDiagnostics(t.file)) {
      if (d.category !== DiagnosticCategory.Error) continue;
      // The filter Volar applies: a position generated code claims but does
      // not want reported on — scaffolding, or an expression a comment spared
      // — has verification off, and never reaches a person.
      const [range] = [...t.map.toSourceRange(d.pos, d.end, false, (data) => data.verification !== false)];
      if (!range) continue;
      found.push({ text: t.source.slice(range[0], range[1]), message: d.text });
    }
    return found;
  }

  it('underlines the property the component does not have, and nothing else', () => {
    const found = errors('broken');

    expect(found).toHaveLength(1);
    expect(found[0]!.text).toBe('subtitle');
    expect(found[0]!.message).toContain("Property 'subtitle' does not exist on type 'Broken'");
  });

  it('says nothing about a template that is right', () => {
    expect(errors('counter')).toEqual([]);
    expect(errors('list')).toEqual([]);
  });

  it('says nothing about a class it cannot reach, rather than everything', () => {
    // `hidden.ts` exports nothing, so the restatement has no way to type
    // `_ctx`. The template names a member that does not exist and it is still
    // silent, because a wall of errors from a file nobody can fix is worse
    // than no errors at all.
    expect(errors('hidden')).toEqual([]);
  });

  it('says nothing about an expression still being typed', () => {
    expect(errors('pending')).toEqual([]);
  });
});
