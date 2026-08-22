/**
 * A template, restated as a TypeScript module an editor can ask questions of.
 *
 * The restatement itself is not written here. `generateTypeCheckBlock` in
 * `@voltdev/compiler` already turns a template AST into synthetic TypeScript
 * with `_ctx` typed as the component, and already returns the table saying
 * which characters of its output came from which characters of the template.
 * That table is, near enough exactly, what a Volar virtual code needs for its
 * `mappings` — one analysis, two consumers, as the roadmap asks: `volt check`
 * turns the same spans into line-and-column diagnostics, and this turns them
 * into positions.
 *
 * Two things are added on top of it.
 *
 * The first is how `_ctx` reaches the class. `volt check` appends the block
 * to the component's own module, where the class is already in scope. An
 * editor cannot: the file being edited is the template, and a virtual file
 * derived from it is a different module. Going through the module's exports
 * is also what makes go-to-definition and rename work — the declaration the
 * type checker resolves to is the real one, in the real file, rather than a
 * copy nobody can edit.
 *
 * The second is that an editor sees a template mid-keystroke. `{ user. }` is
 * not an expression, and a checker that gives up on it gives up on the moment
 * completion matters most. So an expression that fails to parse only because
 * it stops at a dot is completed with a placeholder name, and the position
 * that name occupies maps back to the empty space after the dot.
 */

import { CompilerError, generateTypeCheckBlock, parse, type TemplateSpan } from '@voltdev/compiler';
import type { CodeInformation, CodeMapping } from '@volar/language-core';
import { dirname, relative, sep } from 'node:path';
import type { ComponentBinding } from './templates.js';

export interface GeneratedTemplate {
  /** The synthetic TypeScript, as a whole module. */
  code: string;
  /** Where each part of it came from in the template. */
  mappings: CodeMapping[];
  /**
   * Set when the template itself did not parse, so nothing was restated.
   *
   * The generated module is still valid TypeScript — an empty one — because
   * a half-typed tag must not take the editor's TypeScript service down with
   * it. Everything the template used to answer stops answering until the tag
   * is closed.
   */
  broken: boolean;
}

/**
 * What an unparsed expression is completed with, so a dot has something after
 * it. Deliberately unwriteable by hand, and never reported: the mapping that
 * covers it has verification off.
 */
const PLACEHOLDER = '__volt_completion';

/** An expression a person is in the middle of writing, and where it stops. */
interface Patch {
  /** Offset in the template the placeholder is inserted at. */
  at: number;
  length: number;
}

/**
 * Everything a name in the template supports, which is everything.
 *
 * These are the positions where the generated text is the template's text,
 * character for character: the printer wrote them out of the source and said
 * where from. Anywhere else in the block is scaffolding, and scaffolding an
 * editor navigates to is a bug.
 */
const NAME: CodeInformation = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
};

/** A name inside an expression nothing should be reported about. */
const NAME_UNCHECKED: CodeInformation = { ...NAME, verification: false };

/**
 * The placeholder standing in for what has not been typed yet.
 *
 * Completion only. It occupies no characters of the template, so there is
 * nothing to navigate to and nothing to rename, and the one diagnostic it
 * would raise — that the property does not exist — is about the placeholder
 * rather than about anything a person wrote.
 */
const PENDING: CodeInformation = {
  verification: false,
  completion: true,
  semantic: false,
  navigation: false,
};

/**
 * A stretch of generated text that stands for a name without being it.
 *
 * The generated text is not the template's text at these positions — it has
 * `_ctx.` and the printer's markers in it — so the two lengths differ and
 * Volar clamps rather than counting characters. That makes them the wrong
 * mappings for a cursor, which is why only verification is on: the exact
 * mappings come first in the array and win for every position they cover, and
 * these catch what is left, which is a diagnostic that underlines a node
 * rather than an identifier.
 */
const AROUND: CodeInformation = {
  verification: true,
  completion: false,
  semantic: false,
  navigation: false,
};

/** The same, for an expression a `volt-ignore` or a half-typed name spares. */
const AROUND_UNCHECKED: CodeInformation = { ...AROUND, verification: false };

/**
 * Restate `source` as a module typed against `binding`'s class.
 *
 * The result is served under the template's own path with an extension
 * appended — `counter.html.ts` — which is where Volar's TypeScript layer puts
 * a virtual file. That is what lets a specifier relative to the template's
 * directory resolve the same way it would from the component beside it.
 */
export function generateTemplateModule(
  source: string,
  binding: ComponentBinding,
): GeneratedTemplate {
  const prologue = preamble(binding);
  const block = restate(source, binding);
  if (block === null) {
    return { code: `${prologue}export {};\n`, mappings: [], broken: true };
  }

  return {
    // `export {}` makes it a module, which keeps the block's declarations out
    // of the global scope every other virtual file shares.
    code: `${prologue}${block.code}export {};\n`,
    mappings: mapSpans(block, prologue.length),
    broken: false,
  };
}

/**
 * The head of the generated module: what `_ctx` is.
 *
 * A type-level import rather than an import statement. It says the same thing
 * about the type, needs no name in the module's scope to collide with the
 * block's own, and cannot be reported as unused.
 */
function preamble(binding: ComponentBinding): string {
  const lines = [
    `// ${binding.templateUrl}, restated against ${binding.className}.`,
    '// Generated by @voltdev/volar. Every name in it maps back to the template.',
  ];
  if (binding.exportedAs === null) {
    // Nothing exports the class, so nothing can reach its type from here.
    // `any` is the honest answer: no completion, but no invented errors
    // either, which is what a `never` would produce on every line.
    lines.push(`declare const ${UNREACHABLE}: abstract new (...args: never[]) => any;`);
  }
  return `${lines.join('\n')}\n`;
}

/** The stand-in for a class the generated module has no way to name. */
const UNREACHABLE = '__VoltUnreachableComponent';

/** How the block should spell the class it types `_ctx` against. */
function classReference(binding: ComponentBinding): string {
  if (binding.exportedAs === null) return UNREACHABLE;
  return `import(${JSON.stringify(specifier(binding))}).${binding.exportedAs}`;
}

/**
 * The template's directory to the component's module, as a specifier.
 *
 * `.js` rather than no extension at all: TypeScript substitutes `.ts` for it
 * under every resolution mode it has, while an extensionless specifier
 * resolves under some and not others.
 */
function specifier(binding: ComponentBinding): string {
  const path = relative(dirname(binding.template), binding.module).split(sep).join('/');
  const rooted = path.startsWith('.') ? path : `./${path}`;
  return rooted.replace(/\.mts$/, '.mjs').replace(/\.cts$/, '.cjs').replace(/\.ts$/, '.js');
}

interface Restated {
  code: string;
  spans: TemplateSpan[];
  /** Placeholders inserted to make a half-written expression parse. */
  patches: Patch[];
}

/**
 * Generate the block, once as written and again with half-typed expressions
 * completed if that is what stopped them.
 */
function restate(source: string, binding: ComponentBinding): Restated | null {
  const block = generate(source, binding);
  if (block === null) return null;
  if (block.errors.length === 0) return { ...block, patches: [] };

  const patches = recover(source, block.errors);
  if (patches.length === 0) return { ...block, patches: [] };

  const completed = generate(patch(source, patches), binding);
  // A template that only parsed before the placeholders went in keeps the
  // reading that did parse; a fragment nobody can complete is not worth
  // losing the rest of the file over.
  return completed === null ? { ...block, patches: [] } : { ...completed, patches };
}

function generate(source: string, binding: ComponentBinding) {
  try {
    // Comments are kept, because `<!-- volt-ignore -->` is one.
    const root = parse(source, { filename: binding.template, comments: true });
    return generateTypeCheckBlock(root, { className: classReference(binding) });
  } catch (err) {
    if (err instanceof CompilerError) return null;
    throw err;
  }
}

/**
 * Where a placeholder would let an expression parse.
 *
 * Only a trailing member access qualifies. Every other way an expression can
 * be unfinished is a guess about what was meant, and a guess that completes
 * to the wrong thing offers the wrong list.
 */
function recover(
  source: string,
  errors: readonly { loc: { start: number; end: number } }[],
): Patch[] {
  const patches: Patch[] = [];
  for (const error of errors) {
    const text = source.slice(error.loc.start, error.loc.end).trimEnd();
    if (!text.endsWith('.')) continue;
    patches.push({ at: error.loc.start + text.length, length: PLACEHOLDER.length });
  }
  return patches.sort((a, b) => a.at - b.at);
}

function patch(source: string, patches: readonly Patch[]): string {
  let out = '';
  let read = 0;
  for (const p of patches) {
    out += source.slice(read, p.at) + PLACEHOLDER;
    read = p.at;
  }
  return out + source.slice(read);
}

/** An offset in the patched template, back in the template a person edits. */
function unpatch(offset: number, patches: readonly Patch[]): { at: number; synthetic: boolean } {
  let shift = 0;
  for (const p of patches) {
    const start = p.at + shift;
    if (offset < start) break;
    if (offset < start + p.length) return { at: p.at, synthetic: true };
    shift += p.length;
  }
  return { at: offset - shift, synthetic: false };
}

/**
 * Turn the block's spans into Volar mappings.
 *
 * Three come out of each expression, in the order Volar will prefer them —
 * it yields overlapping mappings in array order, and the exact one has to
 * win.
 *
 * The names are exact: the printed text is the template's text, so the
 * lengths agree and a position inside one is the same position in both. That
 * is the mapping a cursor uses, and the only one allowed to answer completion
 * or rename.
 *
 * Each name is then mapped a second time with the access the printer built
 * around it — the `_ctx.` and the marker comment — folded into the generated
 * side. This is what puts a diagnostic where a person can see it: the type
 * checker reports "argument of type X is not assignable" on the whole of
 * `_ctx.count`, whose first character is not any name's, and without this
 * that error would clamp to the far end of the expression and underline
 * nothing.
 *
 * The expression as a whole comes last, for a diagnostic about a call or an
 * operator rather than about either operand.
 */
function mapSpans(block: Restated, shift: number): CodeMapping[] {
  const { code, spans, patches } = block;
  const names: CodeMapping[] = [];
  const accesses: CodeMapping[] = [];
  const expressions: CodeMapping[] = [];

  for (const span of spans) {
    const start = unpatch(span.loc.start, patches);
    const end = unpatch(span.loc.start + span.exp.length, patches);
    const length = end.at - start.at;
    // An expression that only parsed because a placeholder went into it is
    // one the person is still writing. Nothing about it is reported.
    const settled = !span.ignored && length === span.exp.length;

    for (const mark of span.marks) {
      const source = unpatch(span.loc.start + mark.source, patches);
      names.push({
        sourceOffsets: [source.at],
        generatedOffsets: [shift + mark.at],
        lengths: [source.synthetic ? 0 : mark.length],
        generatedLengths: [mark.length],
        data: source.synthetic ? PENDING : settled ? NAME : NAME_UNCHECKED,
      });

      const access = accessStart(code, mark.at);
      // Nothing was built around it — a `:for` item, say, which is printed as
      // the bare local name it is.
      if (source.synthetic || access === mark.at) continue;
      accesses.push({
        sourceOffsets: [source.at],
        generatedOffsets: [shift + access],
        lengths: [mark.length],
        generatedLengths: [mark.at + mark.length - access],
        data: settled ? AROUND : AROUND_UNCHECKED,
      });
    }

    expressions.push({
      sourceOffsets: [start.at],
      generatedOffsets: [shift + span.start],
      lengths: [length],
      generatedLengths: [span.end - span.start],
      data: settled ? AROUND : AROUND_UNCHECKED,
    });
  }

  return [...names, ...accesses, ...expressions];
}

/** A marker comment the printer wrote, immediately before a name. */
const MARKER = /\/\*@volt:\d+\*\/$/;

/**
 * The compiler's own default name for the component instance.
 *
 * Taken rather than chosen: `generateTypeCheckBlock` is left to its default,
 * so this is what it writes in front of every name that resolves to the
 * class.
 */
const CTX = '_ctx';

/**
 * Where the access the printer built around the name at `at` begins.
 *
 * `at` itself when the name was printed bare, which is what a `:for` item and
 * an arrow parameter are.
 */
function accessStart(code: string, at: number): number {
  const marker = MARKER.exec(code.slice(Math.max(0, at - 32), at));
  if (marker === null) return at;
  const start = at - marker[0].length;
  return code.startsWith(`${CTX}.`, start - CTX.length - 1) ? start - CTX.length - 1 : start;
}
