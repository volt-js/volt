/**
 * `volt check` — type-check the expressions in every template.
 *
 * The compiler restates a template as TypeScript (see `typecheck.ts` in
 * `@voltdev/compiler`); this runs that restatement through the real type
 * checker and turns what comes back into locations in the `.html` file.
 *
 * The block is appended to the component's own module rather than written to
 * a file of its own. That is what makes `_ctx` typed without inventing an
 * import: the class is already in scope, whatever it is named, whatever it
 * extends, however the project resolves modules. The module is only rewritten
 * in memory — the checker reads through a filesystem overlay, and nothing on
 * disk is touched.
 *
 * This cannot run inside Vite's transform, and not for want of trying: oxc
 * strips types without checking them, so by the time a module reaches the
 * transform there is no type information left to check against. It is a
 * separate pass, alongside `tsc`.
 */

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  CompilerError,
  generateTypeCheckBlock,
  parse,
  type TemplateSpan,
} from '@voltdev/compiler';
import { findComponentTemplates } from '@voltdev/vite-plugin/components';
import { API, DiagnosticCategory, type Diagnostic } from 'typescript/unstable/sync';

export interface CheckOptions {
  /** The tsconfig whose files are checked. */
  project: string;
  /** What report paths are printed relative to. Defaults to the tsconfig's directory. */
  cwd?: string;
}

export interface TemplateDiagnostic {
  /** Absolute path to the `.html` file the mistake is written in. */
  file: string;
  /** One-based, and pointing at the expression rather than at the directive. */
  line: number;
  column: number;
  /** The TypeScript error code, or a Volt rule name for a rule of our own. */
  code: string;
  message: string;
  /**
   * The template line itself, as it was when it was checked.
   *
   * Carried rather than re-read, so that what the report underlines is the
   * text the column was measured against — a second read is a different file
   * the moment anything is edited while a check runs.
   */
  source: string | null;
}

export interface CheckResult {
  diagnostics: TemplateDiagnostic[];
  /** Templates restated and handed to the type checker. */
  templates: number;
  /** Components whose template could not be read. */
  unreadable: number;
  /** Findings a `<!-- volt-ignore -->` in a template asked to be spared. */
  ignored: number;
}

/** One template's restatement, and where it landed in the overlaid module. */
interface Restated {
  templateFile: string;
  /** The template's lines, for the one a diagnostic ends up on. */
  lines: string[];
  spans: TemplateSpan[];
}

/** A module rewritten in memory, with everything appended to it. */
interface Overlay {
  /** Length of the real source, past which everything is generated. */
  original: number;
  templates: Restated[];
}

export async function checkTemplates(options: CheckOptions): Promise<CheckResult> {
  const project = resolve(options.project);
  const root = options.cwd ? resolve(options.cwd) : dirname(project);

  const overlays = new Map<string, Overlay>();
  const sources = new Map<string, string>();
  const diagnostics: TemplateDiagnostic[] = [];
  let templates = 0;
  let unreadable = 0;
  let ignored = 0;

  const api = new API({
    cwd: root,
    fs: {
      // `undefined` means "not mine" and falls through to the real disk, so
      // every file the project reaches is the one on it bar the ones rewritten
      // here.
      readFile: (file) => sources.get(file),
    },
  });

  try {
    const config = api.parseConfigFile(project);

    for (const file of config.fileNames) {
      if (!/\.m?ts$/.test(file)) continue;

      let code: string;
      try {
        code = await readFile(file, 'utf8');
      } catch {
        continue;
      }

      const components = findComponentTemplates(code);
      if (components.length === 0) continue;
      const moduleLines = code.split('\n');

      const restated: Restated[] = [];
      // A newline first, so a module whose last line is a `//` comment does
      // not swallow the block.
      let appended = '\n';

      for (const component of components) {
        const templateFile = resolve(dirname(file), component.templateUrl);

        let source: string;
        try {
          source = await readFile(templateFile, 'utf8');
        } catch {
          unreadable++;
          diagnostics.push({
            file,
            line: component.line,
            column: component.column,
            code: 'volt/missing-template',
            message:
              `templateUrl "${component.templateUrl}" could not be read ` +
              `(resolved to ${templateFile}).`,
            source: lineOf(moduleLines, component.line),
          });
          continue;
        }

        const lines = source.split('\n');

        let block;
        try {
          // Comments are kept, which is what an ignore comment is written as.
          block = generateTypeCheckBlock(parse(source, { filename: templateFile, comments: true }), {
            className: component.className,
          });
        } catch (err) {
          // A template that does not parse has no expressions to check. The
          // error is the same one the build would give, said here so a check
          // run is not silently shorter than it looks.
          if (!(err instanceof CompilerError)) throw err;
          diagnostics.push({
            file: templateFile,
            line: err.loc.line,
            column: err.loc.column,
            code: 'volt/template-syntax',
            message: err.message.replace(/^\[volt:compiler\] /, '').replace(/ \([^()]*\)$/, ''),
            source: lineOf(lines, err.loc.line),
          });
          continue;
        }

        for (const error of block.errors) {
          diagnostics.push({
            file: templateFile,
            line: error.loc.line,
            column: error.loc.column,
            code: 'volt/expression-syntax',
            message: error.message,
            source: lineOf(lines, error.loc.line),
          });
        }

        const base = code.length + appended.length;
        for (const span of block.spans) shiftSpan(span, base);
        restated.push({ templateFile, lines, spans: block.spans });
        appended += block.code;
        templates++;
      }

      if (restated.length === 0) continue;
      sources.set(file, code + appended);
      overlays.set(file, { original: code.length, templates: restated });
    }

    if (overlays.size > 0) {
      const snapshot = api.updateSnapshot({ openProjects: [project] });
      // Released on the way out however that happens: closing the API while a
      // snapshot is still open cancels it from underneath, and the checker
      // says so on its own error channel.
      try {
        const checked = snapshot.getProject(project);
        if (!checked) {
          throw new Error(`[volt:check] ${project} did not load as a TypeScript project.`);
        }

        for (const [file, overlay] of overlays) {
          const raw = [
            ...checked.program.getSemanticDiagnostics(file),
            ...checked.program.getSyntacticDiagnostics(file),
          ];
          const mapped = mapDiagnostics(raw, overlay);
          diagnostics.push(...mapped.reported);
          ignored += mapped.ignored;
        }
      } finally {
        snapshot.dispose();
      }
    }
  } finally {
    api.close();
  }

  return { diagnostics: sortDiagnostics(diagnostics, root), templates, unreadable, ignored };
}

/** One line of a file, one-based, or null when the file has no such line. */
function lineOf(lines: readonly string[], line: number): string | null {
  return lines[line - 1] ?? null;
}

// ---------------------------------------------------------------------------
// Mapping back
// ---------------------------------------------------------------------------

/**
 * The compiler's own rules, keyed by the marker argument that carries them.
 *
 * The message is written here rather than left as TypeScript's, because what
 * the checker says about the marker — that `0` is not assignable to `never` —
 * describes the trick and not the mistake.
 */
const RULES: Record<string, { code: string; message: (exp: string) => string }> = {
  display: {
    code: 'volt/signal-read',
    message: (exp) =>
      'This renders the signal itself, not the value it holds.\n' +
      `  Read it: \`${exp}.get()\`. Without the call the binding prints the\n` +
      '  signal object, and never updates — nothing was tracked.',
  },
  condition: {
    code: 'volt/signal-read',
    message: (exp) =>
      'This tests the signal itself, not the value it holds.\n' +
      `  Read it: \`${exp}.get()\`. A signal is an object, so the condition is\n` +
      '  always true and the branch is always the one taken.',
  },
};

/** What one module's diagnostics came to: what is reported, and what was spared. */
interface Mapped {
  reported: TemplateDiagnostic[];
  ignored: number;
}

function mapDiagnostics(raw: readonly Diagnostic[], overlay: Overlay): Mapped {
  const mapped: TemplateDiagnostic[] = [];
  /** Expressions that already have a real error, keyed by span start. */
  const failed = new Set<number>();
  let ignored = 0;

  const relevant = raw.filter(
    (d) =>
      d.category === DiagnosticCategory.Error &&
      // Unused-code findings are `tsc`'s business and are about the block's own
      // scaffolding, never about a template.
      !d.reportsUnnecessary &&
      d.pos >= overlay.original,
  );

  // Real errors first: a rule marker also fails whenever the expression beside
  // it failed, because an expression the checker could not type is one it
  // cannot say is a signal either. Reporting both would put two errors on one
  // mistake, and the invented one second.
  for (const d of relevant) {
    const hit = find(overlay, d.pos);
    if (!hit || hit.rule) continue;
    failed.add(hit.span.start);
    // Counted before it is dropped: an escape hatch nobody can see the use of
    // is one a project stops noticing it is leaning on.
    if (hit.span.ignored) {
      ignored++;
      continue;
    }
    mapped.push(locate(hit.template, hit.span, d.pos, `TS${d.code}`, text(d)));
  }

  for (const d of relevant) {
    const hit = find(overlay, d.pos);
    if (!hit?.rule || failed.has(hit.span.start)) continue;
    if (hit.span.ignored) {
      ignored++;
      continue;
    }
    const rule = RULES[hit.rule]!;
    mapped.push(
      locate(hit.template, hit.span, hit.span.start, rule.code, rule.message(hit.span.exp)),
    );
  }

  return { reported: mapped, ignored };
}

interface Hit {
  template: Restated;
  span: TemplateSpan;
  rule: string | null;
}

/** The innermost expression covering `pos`, or the rule marker sitting on it. */
function find(overlay: Overlay, pos: number): Hit | null {
  let best: Hit | null = null;
  for (const template of overlay.templates) {
    for (const span of template.spans) {
      if (span.check && span.check.at === pos) return { template, span, rule: span.check.rule };
      if (pos < span.start || pos >= span.end) continue;
      if (best === null || span.end - span.start < best.span.end - best.span.start) {
        best = { template, span, rule: null };
      }
    }
  }
  return best;
}

/** Turn an offset in the block into a line and column in the template. */
function locate(
  template: Restated,
  span: TemplateSpan,
  pos: number,
  code: string,
  message: string,
): TemplateDiagnostic {
  let offset = 0;
  for (const m of span.marks) {
    if (pos >= m.at && pos < m.at + m.length) {
      offset = m.source + (pos - m.at);
      break;
    }
    // Not inside a name: the nearest one before it is still the closest thing
    // in the template to what the checker was looking at.
    if (m.at <= pos) offset = m.source;
  }

  let { line, column } = span.loc;
  for (let i = 0; i < offset && i < span.exp.length; i++) {
    if (span.exp[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return {
    file: template.templateFile,
    line,
    column,
    code,
    message,
    source: lineOf(template.lines, line),
  };
}

/** A diagnostic's text, with any chained explanation kept under it. */
function text(d: Diagnostic): string {
  const chain = (d.messageChain ?? []).map((c) => `  ${text(c)}`);
  return [d.text, ...chain].join('\n');
}

function shiftSpan(span: TemplateSpan, by: number): void {
  span.start += by;
  span.end += by;
  for (const m of span.marks) m.at += by;
  if (span.check) span.check.at += by;
}

function sortDiagnostics(list: TemplateDiagnostic[], root: string): TemplateDiagnostic[] {
  return list.sort(
    (a, b) =>
      display(a.file, root).localeCompare(display(b.file, root)) ||
      a.line - b.line ||
      a.column - b.column ||
      a.code.localeCompare(b.code),
  );
}

/** A path as a person would write it, relative to where they ran the command. */
export function display(file: string, root: string): string {
  const rel = relative(root, file);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : file;
}
