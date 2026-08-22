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

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { FileMap } from '@volar/language-core';
import { findComponentTemplates } from '@voltdev/vite-plugin/components';

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
   * Read every module under `dir` and index what they claim.
   *
   * Returns the modules that claimed at least one template. Descends the tree
   * once; directories that cannot hold first-party source are skipped.
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
  /** Every template currently claimed, absolute, in no particular order. */
  templates(): string[];
}

export interface TemplateIndexOptions {
  /**
   * Whether two paths differing only in case are two files.
   *
   * Defaults to the platform's answer. It is an option because the host, not
   * this index, is the one that knows — a case-insensitive volume mounted on
   * Linux is still case-insensitive.
   */
  caseSensitive?: boolean;
  /** Directory names never descended into. */
  ignore?: Iterable<string>;
}

/** Extensions a component class can be declared in. */
const MODULE = /\.m?ts$/;

/**
 * Directories a crawl never enters.
 *
 * `node_modules` above all: a dependency's components are compiled already,
 * and crawling one costs more than the whole of the rest of a project.
 */
const IGNORED = ['node_modules', 'dist', 'build', 'coverage', '.git', '.tsc', '.cache'];

export function createTemplateIndex(options: TemplateIndexOptions = {}): TemplateIndex {
  const caseSensitive = options.caseSensitive ?? process.platform !== 'win32';
  const ignore = new Set(options.ignore ?? IGNORED);

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
      const claims = byTemplate.get(binding.template)?.filter((b) => b.module !== module) ?? [];
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
      const claimed: string[] = [];
      for (const file of await walk(resolve(dir), ignore)) {
        const code = await readFile(file, 'utf8').catch(() => null);
        // A module that never says the word cannot claim anything, and a
        // scan is dominated by files like that.
        if (code === null || !code.includes('templateUrl')) continue;
        if (update(file, code).length > 0) claimed.push(file);
      }
      return claimed;
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
 * A `class` declaration and the modifiers in front of it.
 *
 * `declare` and `abstract` may appear between `export` and `class` in either
 * order, and `export default class` is the third arrangement.
 */
const DECLARATION = /(?:\bexport\s+((?:default|abstract|declare)\s+)*)?\bclass\s+([A-Za-z_$][\w$]*)/g;

/** `export { a, b as c }`, whose braces cannot contain another brace. */
const CLAUSE = /\bexport\s*\{([^}]*)\}/g;

/** `export default Counter;` — the class declared, then exported by name. */
const DEFAULT = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*[;\n]/g;

/**
 * The name `className` is reachable by from outside `code`, or null.
 *
 * Read from the text rather than from a parse, which is the bargain
 * `findComponentTemplates` makes and for the same reason: a language plugin
 * runs this on every keystroke in a template. Both ways it can be wrong are
 * harmless. A name that looks exported but is not leaves `_ctx` as the error
 * type, whose diagnostics land on generated code no mapping covers and are
 * dropped; a name that is exported but does not look it types `_ctx` as
 * `any`, which offers no completion and reports nothing false.
 */
export function exportedName(code: string, className: string): string | null {
  DECLARATION.lastIndex = 0;
  for (let m = DECLARATION.exec(code); m !== null; m = DECLARATION.exec(code)) {
    if (m[2] !== className) continue;
    // No `export` in front of the declaration: the class may still leave
    // through a clause below, so keep looking rather than answering here.
    if (!m[0].startsWith('export')) break;
    return m[1]?.includes('default') ? 'default' : className;
  }

  CLAUSE.lastIndex = 0;
  for (let m = CLAUSE.exec(code); m !== null; m = CLAUSE.exec(code)) {
    for (const specifier of m[1]!.split(',')) {
      const [local, exported] = specifier.split(/\bas\b/).map((part) => part.trim());
      if (local === className) return exported || className;
    }
  }

  DEFAULT.lastIndex = 0;
  for (let m = DEFAULT.exec(code); m !== null; m = DEFAULT.exec(code)) {
    if (m[1] === className) return 'default';
  }

  return null;
}
