/**
 * The plugin inside a real Volar language, driven the way a host drives one.
 *
 * Nothing here stubs Volar: the language is `createLanguage` from
 * `@volar/language-core`, the script registry is the one it keeps, and the
 * synchronisation callback is the same hook an editor's would be. What is
 * being tested is the two decisions the plugin makes for itself — which files
 * it claims, and when what it produced for one stopped being true.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createLanguage,
  forEachEmbeddedCode,
  type IScriptSnapshot,
  type Language,
  type SourceScript,
  type VirtualCode,
} from '@volar/language-core';
import {
  createTemplateIndex,
  createVoltLanguagePlugin,
  textSnapshot,
  type VoltVirtualCode,
} from '../src/index.js';

const APP = resolve(import.meta.dirname, 'fixtures/app');
const src = (file: string): string => resolve(APP, 'src', file);
const read = (file: string): string => readFileSync(src(file), 'utf8');

/**
 * A host with the project in memory.
 *
 * Snapshots are kept until the text behind them changes, because Volar tells
 * a file has changed by the snapshot's identity — a host that handed out a
 * fresh one each time would regenerate everything on every question and hide
 * exactly the staleness these tests are about.
 */
function editor(files: Record<string, string>) {
  const texts = new Map<string, string>(Object.entries(files));
  const snapshots = new Map<string, IScriptSnapshot>();
  const registry = new Map<string, SourceScript<string>>();

  const index = createTemplateIndex();
  for (const [file, text] of texts) {
    if (file.endsWith('.ts')) index.update(file, text);
  }

  const plugin = createVoltLanguagePlugin<string>({
    index,
    toFileName: (id) => id,
    fromFileName: (file) => file,
  });

  function snapshotOf(file: string): IScriptSnapshot | undefined {
    const text = texts.get(file);
    if (text === undefined) return undefined;
    const held = snapshots.get(file);
    if (held && held.getText(0, held.getLength()) === text) return held;
    const made = textSnapshot(text);
    snapshots.set(file, made);
    return made;
  }

  const language: Language<string> = createLanguage<string>([plugin], registry, (id) => {
    const snapshot = snapshotOf(id);
    if (!snapshot) {
      language.scripts.delete(id);
      return;
    }
    language.scripts.set(id, snapshot, id.endsWith('.ts') ? 'typescript' : 'html');
  });

  return {
    index,
    plugin,
    language,

    /**
     * A keystroke, and nothing else.
     *
     * The host pushes the new buffer through rather than waiting to be asked,
     * which is what lets Volar mark everything downstream of it. Nothing here
     * tells the index anything.
     */
    type(file: string, text: string): void {
      texts.set(file, text);
      if (registry.has(file)) {
        language.scripts.set(file, snapshotOf(file)!, file.endsWith('.ts') ? 'typescript' : 'html');
      }
    },

    /** A keystroke a watcher also reported, which is what a host would do. */
    write(file: string, text: string): void {
      this.type(file, text);
      if (file.endsWith('.ts')) plugin.moduleChanged(language, file, text);
    },

    delete(file: string): void {
      texts.delete(file);
      if (file.endsWith('.ts')) plugin.moduleChanged(language, file, null);
      language.scripts.delete(file);
    },

    /** What the plugin made of a template, or null when it made nothing. */
    root(file: string): VoltVirtualCode | null {
      return (language.scripts.get(file)?.generated?.root as VoltVirtualCode) ?? null;
    },

    /** The TypeScript a template currently restates as, or null for none. */
    restatement(file: string): string | null {
      const script = language.scripts.get(file);
      if (!script?.generated) return null;
      for (const code of forEachEmbeddedCode(script.generated.root)) {
        if (code.languageId === 'typescript') {
          return code.snapshot.getText(0, code.snapshot.getLength());
        }
      }
      return null;
    },
  };
}

function project(): ReturnType<typeof editor> {
  return editor({
    [src('counter.ts')]: read('counter.ts'),
    [src('counter.html')]: read('counter.html'),
    [src('page.html')]: read('page.html'),
  });
}

describe('which files the plugin claims', () => {
  let app: ReturnType<typeof editor>;

  beforeEach(() => {
    app = project();
  });

  it('calls a file a template when something points at it', () => {
    expect(app.plugin.getLanguageId(src('counter.html'))).toBe('html');

    const script = app.language.scripts.get(src('counter.html'));
    expect(script?.generated).toBeDefined();
  });

  it('has no opinion about an .html file nothing points at', () => {
    // The activation decision, and the reason this can be installed in a
    // project full of ordinary HTML without changing any of it.
    expect(app.plugin.getLanguageId(src('page.html'))).toBeUndefined();

    const script = app.language.scripts.get(src('page.html'));
    expect(script).toBeDefined();
    expect(script?.generated).toBeUndefined();
  });

  it('has no opinion about the component module either', () => {
    expect(app.plugin.getLanguageId(src('counter.ts'))).toBeUndefined();
  });

  it('offers the restatement to the TypeScript service as a .ts file', () => {
    const service = app.plugin.typescript.getServiceScript(app.root(src('counter.html'))!);

    expect(service?.extension).toBe('.ts');
    expect(service?.code.languageId).toBe('typescript');
    expect(app.plugin.typescript.extraFileExtensions).toEqual([
      { extension: 'html', isMixedContent: true, scriptKind: 7 },
    ]);
  });

  it('says which class a template is typed against, which nothing else can', () => {
    const root = app.root(src('counter.html'))!;

    expect(root.binding.className).toBe('Counter');
    expect(root.binding.module).toBe(src('counter.ts'));
  });

  it('keeps the template itself, mapped onto itself, for an HTML service', () => {
    const root = app.root(src('counter.html'))!;
    const codes = [...forEachEmbeddedCode(root)].map((c: VirtualCode) => c.languageId);

    expect(codes).toEqual(['html', 'typescript']);
    expect(root.mappings[0]!.lengths[0]).toBe(read('counter.html').length);
  });
});

describe('when a restatement stops being true', () => {
  let app: ReturnType<typeof editor>;

  beforeEach(() => {
    app = project();
  });

  it('follows an edit to the template', () => {
    expect(app.restatement(src('counter.html'))).toContain('label');

    app.write(src('counter.html'), '<p>{ step }</p>');

    expect(app.restatement(src('counter.html'))).not.toContain('label');
    expect(app.restatement(src('counter.html'))).toContain('step');
  });

  it('follows an edit to the class, which the template does not mention', () => {
    // The whole difficulty of separating the two files. Nothing in
    // `counter.html` changed; what it means did. Nothing tells the index
    // either — the association Volar keeps is what notices, and the text it
    // reads is the buffer being typed in rather than what was last saved.
    expect(app.restatement(src('counter.html'))).toContain('.Counter');

    app.type(src('counter.ts'), read('counter.ts').replace('class Counter', 'class Tally'));

    expect(app.restatement(src('counter.html'))).toContain('.Tally');
  });

  it('lets go of a template a component has stopped pointing at', () => {
    app.write(src('counter.ts'), read('counter.ts').replace('./counter.html', './page.html'));

    expect(app.index.owns(src('counter.html'))).toBe(false);
    expect(app.restatement(src('counter.html'))).toBeNull();
  });

  it('picks up a template that until now belonged to nobody', () => {
    expect(app.restatement(src('page.html'))).toBeNull();

    app.write(src('counter.ts'), read('counter.ts').replace('./counter.html', './page.html'));

    expect(app.plugin.getLanguageId(src('page.html'))).toBe('html');
    expect(app.restatement(src('page.html'))).toContain('.Counter');
  });

  it('forgets everything a deleted module claimed', () => {
    app.delete(src('counter.ts'));

    expect(app.index.owns(src('counter.html'))).toBe(false);
    expect(app.restatement(src('counter.html'))).toBeNull();
  });
});
