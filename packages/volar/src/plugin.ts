/**
 * The Volar language plugin: what an editor loads to get a template answered.
 *
 * A language plugin is a small thing by design. It says which files it has an
 * opinion about, and for each of those it produces virtual code and a table
 * of positions. Everything a person then sees — completion, hover,
 * go-to-definition, rename, live errors — is Volar and the TypeScript service
 * answering against that virtual code and mapping the answers back. Writing a
 * language server instead would mean reimplementing all of it against a type
 * system that already answers those questions.
 *
 * Two decisions are this plugin's own.
 *
 * Which files it claims. Not every `.html`, which is the trap a template that
 * really is `.html` sets: the index has to have been told that something
 * points at a file before the plugin has anything to say about it, so a
 * lookup that misses is the plugin declining. Nothing else in a project
 * changes because this is installed.
 *
 * When a template stops being current. A template's meaning lives in another
 * file, so editing `counter.ts` changes what `counter.html` means without
 * touching a byte of it. Volar has the mechanism for that: a virtual code
 * that asks for an associated script is regenerated when that script changes.
 * The module is read from the editor's own buffer while it is being asked
 * for, so an unsaved rename in the class reaches the template immediately.
 * What that mechanism cannot see is a module the index has never read — a new
 * component, or one whose `templateUrl` moved to a template that until now
 * belonged to nobody — and that is what `moduleChanged` is for.
 */

import type {
  IScriptSnapshot,
  Language,
  LanguagePlugin,
  VirtualCode,
} from '@volar/language-core';
import { generateTemplateModule } from './virtual.js';
import type { ComponentBinding, TemplateIndex } from './templates.js';

export interface VoltVirtualCode extends VirtualCode {
  /**
   * The class the template was restated against.
   *
   * Carried because everything downstream of the virtual code is anonymous —
   * an embedded TypeScript file and a table of offsets — and something asked
   * what a template is typed against has nowhere else to read it from.
   */
  binding: ComponentBinding;
  /** The template, and under it the TypeScript it restates as. */
  embeddedCodes: VirtualCode[];
}

export interface VoltLanguagePlugin<T> extends LanguagePlugin<T, VoltVirtualCode> {
  /**
   * Take a module's new text — null when it was deleted — and drop the
   * virtual code of every template the change moved.
   *
   * This is the half Volar's own invalidation cannot do. A host wires it to
   * whatever tells it a `.ts` file changed on disk or in a buffer; without it
   * a component that starts pointing at a template is not noticed until
   * something else makes the editor rebuild that file.
   *
   * Returns the templates whose owner changed.
   */
  moduleChanged(language: Language<T>, module: string, code: string | null): string[];
}

export interface VoltLanguagePluginOptions<T> {
  /** The reverse index. Both activation and typing come out of it. */
  index: TemplateIndex;
  /** A script id as a path on disk. A URI in an editor, a path in tsserver. */
  toFileName(scriptId: T): string;
  /** The same in reverse, for naming the module a template depends on. */
  fromFileName(fileName: string): T;
}

/**
 * The TypeScript half of a language plugin, restated here rather than
 * imported.
 *
 * `@volar/typescript` declares these members by augmenting `LanguagePlugin`,
 * and its declaration is written against the classic `typescript` type
 * definitions. TypeScript 7 ships a native compiler and no such definitions —
 * the package exports no types at all — so that augmentation cannot be typed
 * in this repository. The shape below is what `@volar/typescript` reads at
 * runtime, and depending on the package for it would buy a type error rather
 * than a type.
 */
interface TypeScriptIntegration<K> {
  /** Extensions tsserver has to be told to keep, rather than skip as assets. */
  extraFileExtensions: { extension: string; isMixedContent: boolean; scriptKind: number }[];
  /** Which of a root's embedded codes is the one to type-check. */
  getServiceScript(root: K): { code: VirtualCode; extension: string; scriptKind: number } | undefined;
}

/** `ts.ScriptKind.TS`, spelled out because there is no enum to import. */
const SCRIPT_KIND_TS = 3;
/** `ts.ScriptKind.Deferred` — a file whose content is somebody else's job. */
const SCRIPT_KIND_DEFERRED = 7;

/** The embedded code the TypeScript service answers against. */
const TS_CODE_ID = 'template_ts';

export function createVoltLanguagePlugin<T>(
  options: VoltLanguagePluginOptions<T>,
): VoltLanguagePlugin<T> & { typescript: TypeScriptIntegration<VoltVirtualCode> } {
  const { index, toFileName, fromFileName } = options;

  function build(
    scriptId: T,
    snapshot: IScriptSnapshot,
    getAssociatedScript: (id: T) => { snapshot: IScriptSnapshot } | undefined,
  ): VoltVirtualCode | undefined {
    const file = toFileName(scriptId);
    if (!file.endsWith('.html')) return undefined;

    let binding = index.lookup(file);
    if (!binding) return undefined;

    // Asking for the module registers it as this template's dependency, which
    // is what has Volar regenerate this code when that file changes. Its
    // snapshot is the editor's live text, so the index is brought up to the
    // buffer rather than to what was last saved.
    const associated = getAssociatedScript(fromFileName(binding.module));
    if (associated) {
      const code = associated.snapshot.getText(0, associated.snapshot.getLength());
      if (index.update(binding.module, code).length > 0) {
        binding = index.lookup(file);
        if (!binding) return undefined;
      }
    }

    const source = snapshot.getText(0, snapshot.getLength());
    const generated = generateTemplateModule(source, binding);

    return {
      id: 'root',
      languageId: 'html',
      snapshot,
      // The template maps onto itself, so an HTML service sees the file it
      // would have seen with none of this installed.
      mappings: [
        {
          sourceOffsets: [0],
          generatedOffsets: [0],
          lengths: [snapshot.getLength()],
          data: {
            verification: true,
            completion: true,
            semantic: true,
            navigation: true,
            structure: true,
            format: true,
          },
        },
      ],
      embeddedCodes: [
        {
          id: TS_CODE_ID,
          languageId: 'typescript',
          snapshot: textSnapshot(generated.code),
          mappings: generated.mappings,
        },
      ],
      binding,
    };
  }

  return {
    /**
     * Only a file something points at is called a template.
     *
     * Returning nothing for the rest is the activation decision: a project
     * full of `.html` that no component names is a project this plugin has no
     * opinion about.
     */
    getLanguageId(scriptId) {
      const file = toFileName(scriptId);
      return file.endsWith('.html') && index.owns(file) ? 'html' : undefined;
    },

    createVirtualCode(scriptId, languageId, snapshot, ctx) {
      if (languageId !== 'html') return undefined;
      return build(scriptId, snapshot, (id) => ctx.getAssociatedScript(id));
    },

    /**
     * Regenerated whole rather than patched.
     *
     * The block is emitted from a parse of the template, and there is no
     * incremental version of that parse to reach for. Returning nothing tells
     * Volar to forget the file, which is the right answer when a template has
     * stopped being one.
     */
    updateVirtualCode(scriptId, _virtualCode, newSnapshot, ctx) {
      return build(scriptId, newSnapshot, (id) => ctx.getAssociatedScript(id));
    },

    moduleChanged(language, module, code) {
      const affected = index.update(module, code);
      for (const template of affected) language.scripts.delete(fromFileName(template));
      return affected;
    },

    typescript: {
      // `isMixedContent` keeps tsserver from treating the file as an asset,
      // and `Deferred` says the text is not TypeScript and should not be
      // parsed as any.
      extraFileExtensions: [
        { extension: 'html', isMixedContent: true, scriptKind: SCRIPT_KIND_DEFERRED },
      ],
      getServiceScript(root) {
        for (const code of root.embeddedCodes) {
          if (code.id === TS_CODE_ID) {
            return { code, extension: '.ts', scriptKind: SCRIPT_KIND_TS };
          }
        }
        return undefined;
      },
    },
  };
}

/** A snapshot over a string that never changes, which generated code is. */
export function textSnapshot(text: string): IScriptSnapshot {
  return {
    getText: (start, end) => text.slice(start, end),
    getLength: () => text.length,
    getChangeRange: () => undefined,
  };
}
