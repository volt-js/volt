/**
 * `templateUrl`, read backwards.
 *
 * A Vue single-file component carries its template and its class in one file,
 * so a language server always knows which class a template belongs to. Volt
 * separated them, and this is where that decision is paid for: given
 * `counter.html`, something has to find the class whose `templateUrl` points
 * at it. Nothing in the template says so — the arrow only exists in the other
 * direction, in a module the template has never heard of.
 *
 * The same index decides activation. A template really is `.html`, and most
 * `.html` files in a project are not templates: a plugin that claimed all of
 * them would put TypeScript diagnostics on an email layout. So a file is a
 * template exactly when this index has been told something points at it, and
 * a lookup that misses is the plugin declining the file.
 *
 * What it holds is derived, so it is only as current as what it has been
 * told. `scan` reads a directory once; after that the host has to say what
 * changed, either through `update` or through the associated-script hook the
 * language plugin uses. Nothing here watches a filesystem.
 */

import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { FileMap } from '@volar/language-core';
import {
  findComponentTemplates,
  findKeyword,
  matchDelimiter,
  readIdent,
  skipTrivia,
} from '@voltdev/vite-plugin/components';

/** A template, and the class it renders against. */
export interface ComponentBinding {
  /** Absolute path of the template. */
  template: string;
  /** Absolute path of the module the class is declared in. */
  module: string;
  /** The class as named inside its own module. */
  className: string;
  /**
   * The name the class is reachable by from outside its module — `default`
   * for a default export — or null when nothing exports it.
   *
   * A template is restated in a file of its own, so it can only reach the
   * class through the module's exports. A class nothing exports is not a
   * mistake worth reporting, but it is one the restatement has to degrade
   * for; see `generateTemplateModule`.
   */
  exportedAs: string | null;
  /** The `templateUrl` exactly as written, for a message about it. */
  templateUrl: string;
}

export interface TemplateIndex {
  /** The class that owns `template`, or undefined for a file nothing claims. */
  lookup(template: string): ComponentBinding | undefined;
  /** Whether anything claims `template`. The plugin's activation test. */
  owns(template: string): boolean;
  /**
   * Read every module under `dir` and index what they claim now, which
   * withdraws what a module claimed before and no longer does — or claimed
   * before it was deleted.
   *
   * Returns the modules whose claims changed — on a first scan, every module
   * that claims a template. Descends the tree once; directories that cannot
   * hold first-party source are skipped.
   */
  scan(dir: string): Promise<string[]>;
  /**
   * Replace what `module` claims with what `code` says it claims, or drop it
   * entirely when `code` is null.
   *
   * Returns the templates whose owner changed, which is what a host has to
   * invalidate — and the only signal that anything moved, so there is one
   * thing to watch rather than two. A module that says what it said before
   * returns nothing and touches nothing, which is what makes this safe to
   * call on every keystroke.
   */
  update(module: string, code: string | null): string[];
  /**
   * Every template currently claimed, absolute, in no particular order.
   *
   * Whatever its extension, because the build and `volt check` accept a
   * `templateUrl` naming any file. Which of these a language plugin serves is
   * the plugin's decision, not the index's.
   */
  templates(): string[];
}

export interface TemplateIndexOptions {
  /**
   * Whether two paths differing only in case are two files.
   *
   * Defaults to what the platform's default volume does: not on Windows or
   * macOS, yes everywhere else. It is an option because the host, not this
   * index, is the one that knows — a case-insensitive volume mounted on Linux
   * is still case-insensitive, and a macOS volume can be formatted to care.
   */
  caseSensitive?: boolean;
  /** Directory names never descended into. */
  ignore?: Iterable<string>;
}

/**
 * Extensions a component class can be declared in: the ones the build
 * transforms by default, and `volt check` reads. A `.cts` module is neither,
 * so a scan passes it over, though a host can still report one to `update`.
 */
const MODULE = /\.m?ts$/;

/**
 * Directories a crawl never enters.
 *
 * `node_modules` above all: a dependency's components are compiled already,
 * and crawling one costs more than the whole of the rest of a project.
 */
const IGNORED = ['node_modules', 'dist', 'build', 'coverage', '.git', '.tsc', '.cache'];

export function createTemplateIndex(options: TemplateIndexOptions = {}): TemplateIndex {
  const caseSensitive =
    options.caseSensitive ?? (process.platform !== 'win32' && process.platform !== 'darwin');
  const ignore = new Set(options.ignore ?? IGNORED);
  /** A path as the maps below compare it. */
  const key = (path: string): string => (caseSensitive ? path : path.toLowerCase());

  /** What each module claims, so a re-read knows what to withdraw. */
  const byModule = new FileMap<ComponentBinding[]>(caseSensitive);
  /**
   * Who claims each template.
   *
   * A list rather than one binding: two components pointing at one template
   * is legal and does happen — a base class and a variant of it — and the
   * index has to survive it. Kept sorted by module path so the one a lookup
   * answers with does not depend on the order the files were read in.
   */
  const byTemplate = new FileMap<ComponentBinding[]>(caseSensitive);

  function release(module: string): string[] {
    const previous = byModule.get(module);
    if (!previous) return [];
    byModule.delete(module);
    for (const binding of previous) {
      // The bindings themselves rather than their module's path: an index
      // that ignores case can be told about a module under a spelling other
      // than the one it stored, and comparing strings would keep every claim
      // that spelling made.
      const claims = byTemplate.get(binding.template)?.filter((b) => !previous.includes(b)) ?? [];
      if (claims.length === 0) byTemplate.delete(binding.template);
      else byTemplate.set(binding.template, claims);
    }
    return previous.map((b) => b.template);
  }

  function claim(bindings: ComponentBinding[]): void {
    if (bindings.length === 0) return;
    byModule.set(bindings[0]!.module, bindings);
    for (const binding of bindings) {
      const claims = byTemplate.get(binding.template) ?? [];
      claims.push(binding);
      claims.sort((a, b) => a.module.localeCompare(b.module));
      byTemplate.set(binding.template, claims);
    }
  }

  function read(module: string, code: string): ComponentBinding[] {
    return findComponentTemplates(code).map((component) => ({
      template: resolve(dirname(module), component.templateUrl),
      module,
      className: component.className,
      exportedAs: exportedName(code, component.className),
      templateUrl: component.templateUrl,
    }));
  }

  function update(module: string, code: string | null): string[] {
    const file = resolve(module);
    const found = code === null ? [] : read(file, code);
    if (same(byModule.get(file) ?? [], found)) return [];

    const affected = new Set(release(file));
    claim(found);
    for (const binding of found) affected.add(binding.template);
    return [...affected];
  }

  return {
    lookup(template) {
      return byTemplate.get(resolve(template))?.[0];
    },

    owns(template) {
      return byTemplate.has(resolve(template));
    },

    update,

    async scan(dir) {
      const root = resolve(dir);
      const seen = new Set<string>();
      const changed: string[] = [];

      for (const file of await walk(root, ignore)) {
        const code = await readFile(file, 'utf8').catch(() => null);
        if (code === null) continue;
        seen.add(key(file));
        // A module that never says the word cannot claim anything, and a scan
        // is dominated by files like that, so it is not read for claims. It is
        // still reported as claiming nothing, which withdraws whatever it
        // claimed the last time it did say it.
        if (update(file, code.includes('templateUrl') ? code : null).length > 0) {
          changed.push(file);
        }
      }

      // A module indexed under `dir` that this scan did not read, and that is
      // no longer on disk, has been deleted since it was. One it only passed
      // over — under an ignored directory, or refused to it — is left as it
      // was told.
      for (const module of [...byModule.keys()]) {
        if (seen.has(key(module)) || !within(key(root), key(module))) continue;
        if (!(await gone(module))) continue;
        if (update(module, null).length > 0) changed.push(module);
      }

      return changed;
    },

    templates() {
      return [...byTemplate.keys()];
    },
  };
}

/** Every module file under `dir`, skipping directories that cannot hold one. */
async function walk(dir: string, ignore: ReadonlySet<string>): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  const nested: Promise<string[]>[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || ignore.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) nested.push(walk(path, ignore));
    else if (MODULE.test(entry.name)) found.push(path);
  }

  for (const batch of await Promise.all(nested)) found.push(...batch);
  return found;
}

/** Whether `path` is `dir` or somewhere under it. */
function within(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Whether nothing is at `path` any more — which is not the same as unreadable. */
function gone(path: string): Promise<boolean> {
  return access(path).then(
    () => false,
    (err: NodeJS.ErrnoException) => err.code === 'ENOENT' || err.code === 'ENOTDIR',
  );
}

/** Whether two readings of a module claim the same templates in the same way. */
function same(a: readonly ComponentBinding[], b: readonly ComponentBinding[]): boolean {
  return (
    a.length === b.length &&
    a.every((binding, i) => {
      const other = b[i]!;
      return (
        binding.template === other.template &&
        binding.className === other.className &&
        binding.exportedAs === other.exportedAs
      );
    })
  );
}

// ---------------------------------------------------------------------------
// How a class leaves its module
// ---------------------------------------------------------------------------

/**
 * The name `className` is reachable by from outside `code`, or null.
 *
 * Read with the build's scan rather than from a parse, which is the bargain
 * `findComponentTemplates` makes and for the same reason: a language plugin
 * runs this on every keystroke in a template. The scan passes over comments,
 * strings, template text and regular expressions, so an `export` it lands on
 * is code, and three shapes are read from there — the declaration itself,
 * with any decorators and modifiers on either side of the `export`; an
 * `export { … }` clause naming the class; and `export default` followed by
 * its name alone.
 *
 * Both ways it can still be wrong are harmless. A name that looks exported but
 * is not leaves `_ctx` as the error type, whose diagnostics land on generated
 * code no mapping covers and are dropped; a name that is exported but does not
 * look it types `_ctx` as `any`, which offers no completion and reports
 * nothing false.
 */
export function exportedName(code: string, className: string): string | null {
  for (const at of findKeyword(code, 'export')) {
    let i = skipTrivia(code, at + 'export'.length);
    if (code[i] === '{') {
      const name = clauseName(code, i, className);
      if (name !== null) return name;
      continue;
    }

    // A decorator can stand after `export` as well as before it, and
    // `abstract` or `declare` between it and `class`. Anything else is an
    // export of something other than a class.
    let name = className;
    for (;;) {
      if (code[i] === '@') {
        i = skipTrivia(code, decoratorEnd(code, i));
        continue;
      }
      const word = readIdent(code, i);
      const next = skipTrivia(code, i + word.length);
      if (word === 'class') {
        if (readIdent(code, next) === className) return name;
        break;
      }
      if (word === 'default') {
        // `export default Counter;` — the class declared first, then exported
        // by name.
        if (readIdent(code, next) === className && endsStatement(code, next + className.length)) {
          return 'default';
        }
        name = 'default';
      } else if (word !== 'abstract' && word !== 'declare') {
        break;
      }
      i = next;
    }
  }
  return null;
}

/**
 * The name `className` leaves under through the `export { … }` whose brace is
 * at `open`, or null when the clause does not name it.
 *
 * A specifier is `local` or `local as exported`. A clause followed by `from`
 * re-exports another module's names, which are not this one's classes.
 */
function clauseName(code: string, open: number, className: string): string | null {
  const close = matchDelimiter(code, open) - 1;
  if (readIdent(code, skipTrivia(code, close + 1)) === 'from') return null;

  let i = skipTrivia(code, open + 1);
  while (i < close) {
    const local = readIdent(code, i);
    i = skipTrivia(code, i + local.length);
    let exported = local;
    if (readIdent(code, i) === 'as') {
      i = skipTrivia(code, i + 'as'.length);
      exported = readIdent(code, i);
    }
    // A name written as a string reads as no identifier at all, and is not one
    // the restatement could write after a dot.
    if (local === className && exported !== '') return exported;

    while (i < close && code[i] !== ',') i = skipTrivia(code, i + 1);
    i = skipTrivia(code, i + 1);
  }
  return null;
}

/**
 * Index just past the decorator whose `@` is at `at`: a name, dotted or not,
 * and the arguments it is called with, if it is called. `@(expression)` has
 * no name, only the parenthesised expression.
 */
function decoratorEnd(code: string, at: number): number {
  let i = skipTrivia(code, at + 1);
  let end = i;
  for (let name = readIdent(code, i); name !== ''; name = readIdent(code, i)) {
    end = i + name.length;
    i = skipTrivia(code, end);
    if (code[i] !== '.') break;
    i = skipTrivia(code, i + 1);
  }
  return code[i] === '(' ? matchDelimiter(code, i) : end;
}

/** Whether a semicolon, a line break or the end of the module follows `after`. */
function endsStatement(code: string, after: number): boolean {
  const next = skipTrivia(code, after);
  return next === code.length || code[next] === ';' || code.slice(after, next).includes('\n');
}
