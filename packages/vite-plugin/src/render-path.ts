/**
 * The edge check: nothing on the render path may import a `node:` builtin.
 *
 * Edge is not a feature, it is a constraint — a handler that is only ever
 * `(Request) => Response` runs anywhere, and one that reaches for `fs`,
 * `path` or `Buffer` runs in exactly one place. The constraint is trivially
 * satisfiable and impossible to remember, because nothing local ever fails:
 * the tests pass on Node, the dev server passes on Node, and the first
 * runtime that does not have `node:fs` is the deployment. So it is a build
 * check, and it is a graph walk rather than a lint on one file, because the
 * import that breaks the deploy is four modules down from anything a reviewer
 * was reading.
 *
 * **What counts as the render path, which is the whole design.** A component's
 * render runs wherever the request is answered, so it may reach nothing a
 * browser-shaped runtime lacks. A `@Server()` method is the other side of a
 * network hop: it is an HTTP endpoint whose body the client build strips
 * entirely, and it is where an application is *supposed* to open a file or
 * read a secret. Excusing the whole module that declares one would be the easy
 * boundary and the wrong one — a module usually holds a class with a render
 * and a server function side by side. So the boundary is drawn at the method:
 *
 *   import { readFile } from 'node:fs/promises';   // allowed
 *   class Doc {
 *     @Server() async load(id: string) {           // ...because only this
 *       await guard(session);                      //    reaches it
 *       return readFile(`/docs/${id}`, 'utf8');
 *     }
 *   }
 *
 * and the same import referenced from a getter the template calls is refused.
 * An import is on the render path when any of its bindings is used outside
 * every `@Server()` body — and that is transitive, so a local module reached
 * only from a server function takes its own `node:` imports off the path with
 * it, while one reached from a render carries them onto it.
 *
 * The walk runs on the original source, before the server-function pass has
 * rewritten anything, which is why this plugin has to sort before it: after
 * that pass there is no `@Server()` left to read the boundary from.
 */

import { isBuiltin } from 'node:module';
import type { Plugin } from 'vite';
import {
  findDecorators,
  findKeyword,
  matchAngle,
  matchDelimiter,
  readIdent,
  skipQuoted,
  skipTemplateLiteral,
  skipTrivia,
} from './scan.js';

export interface Range {
  readonly start: number;
  readonly end: number;
}

// ---------------------------------------------------------------------------
// Where the server's half of a module begins and ends
// ---------------------------------------------------------------------------

/**
 * Past the parameter list to the `{` that opens the body.
 *
 * A `@Server()` method must be `async` — the pass that lowers it refuses one
 * that is not — so its return annotation is a `Promise<...>` and every `{` in
 * it is inside angle brackets this steps over. The first brace left is the
 * body's.
 */
function bodyBrace(code: string, from: number): number | null {
  let i = skipTrivia(code, from);
  while (i < code.length && code[i] !== '{') {
    const ch = code[i]!;
    if (ch === '"' || ch === "'") {
      i = skipQuoted(code, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplateLiteral(code, i);
      continue;
    }
    if (ch === '<') {
      i = matchAngle(code, i);
      continue;
    }
    if (ch === '(' || ch === '[') {
      i = matchDelimiter(code, i);
      continue;
    }
    // A `;` or a `}` before any brace means this was not a method after all.
    if (ch === ';' || ch === '}') return null;
    i++;
  }
  return i < code.length ? i : null;
}

/**
 * Every `@Server()` method, from its decorator to its closing brace.
 *
 * A shape this cannot read yields no range, which fails towards the strict
 * side: the code is treated as ordinary module code and its imports are held
 * to the render path's rule. The server-function pass throws on those shapes
 * anyway, so the build stops either way — with a better message than this one
 * would give.
 */
export function serverFunctionRanges(code: string): Range[] {
  const ranges: Range[] = [];

  for (const site of findDecorators(code)) {
    if (site.name !== 'Server') continue;

    let i = skipTrivia(code, site.at + 1 + site.name.length);
    if (code[i] === '(') i = skipTrivia(code, matchDelimiter(code, i));

    // Modifiers and the name, whatever order they were written in.
    for (;;) {
      if (code[i] === '#' || code[i] === '*' || code[i] === '?') {
        i = skipTrivia(code, i + 1);
        continue;
      }
      const word = readIdent(code, i);
      if (!word) break;
      i = skipTrivia(code, i + word.length);
    }
    if (code[i] === '<') i = skipTrivia(code, matchAngle(code, i));
    if (code[i] !== '(') continue;

    const brace = bodyBrace(code, matchDelimiter(code, i));
    if (brace === null) continue;
    ranges.push({ start: site.at, end: matchDelimiter(code, brace) });
  }

  return ranges;
}

// ---------------------------------------------------------------------------
// What a module imports, and which half of it uses each one
// ---------------------------------------------------------------------------

export interface ImportSite {
  readonly specifier: string;
  /** Where the declaration sits, so its own text is not read as a use of itself. */
  readonly range: Range;
  /** Local names bound from it. Empty for a bare `import './x'`. */
  readonly locals: readonly string[];
  /**
   * On the path whatever the module goes on to do with it.
   *
   * A side-effect `import './x'` and a re-export both bind nothing locally, so
   * "no local is used" says nothing about them — the first runs when the module
   * loads and the second is part of this module's own surface. Without this
   * they are indistinguishable from the case that must go the other way: a
   * clause whose members were every one of them type-only, which binds nothing
   * because there is nothing left of it at run time.
   */
  readonly unconditional: boolean;
  /** Erased before anything runs, so it reaches nothing. */
  readonly typeOnly: boolean;
  /** `import('x')` — the call site, rather than the module's top, decides who uses it. */
  readonly dynamic: boolean;
  /**
   * The clause was a shape this scan does not take apart. Treated as used by
   * the render, because guessing the other way hides an import.
   */
  readonly opaque: boolean;
}

/** The specifier of a `from '...'` at `i`, or null if it is computed. */
function specifierAt(code: string, i: number): { text: string; end: number } | null {
  const quote = code[i];
  if (quote !== '"' && quote !== "'") return null;
  const close = skipQuoted(code, i, quote);
  return { text: code.slice(i + 1, close - 1), end: close };
}

function localsOfClause(clause: string): { locals: string[]; opaque: boolean } {
  const locals: string[] = [];
  let opaque = false;

  let rest = clause.trim();
  const braced = rest.indexOf('{');
  if (braced !== -1) {
    const close = rest.lastIndexOf('}');
    if (close === -1) return { locals, opaque: true };
    for (const entry of rest.slice(braced + 1, close).split(',')) {
      let name = entry.trim();
      if (!name) continue;
      // A type-only member of an otherwise value import binds nothing.
      if (/^type\s/.test(name)) continue;
      const as = name.split(/\bas\b/);
      name = (as[1] ?? as[0] ?? '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) locals.push(name);
      else opaque = true;
    }
    rest = rest.slice(0, braced);
  }

  for (const part of rest.split(',')) {
    const name = part.trim();
    if (!name) continue;
    const namespace = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(name);
    if (namespace) {
      locals.push(namespace[1]!);
      continue;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(name)) locals.push(name);
    else opaque = true;
  }

  return { locals, opaque };
}

/**
 * Every import and re-export in the module, with the names each one binds.
 *
 * Smaller than the scan the server-function pass keeps to itself: that one has
 * to be able to rewrite a declaration, this one only has to say what came in
 * and under what name. It answers two extra questions in exchange — a dynamic
 * `import()` and its position, and an `export ... from`, both of which are
 * edges in the graph this walks.
 */
export function findImportSites(code: string): ImportSite[] {
  const sites: ImportSite[] = [];

  for (const at of findKeyword(code, 'import')) {
    const after = skipTrivia(code, at + 'import'.length);

    if (code[after] === '.') continue; // import.meta

    if (code[after] === '(') {
      const inner = skipTrivia(code, after + 1);
      const specifier = specifierAt(code, inner);
      // A computed specifier names no module, so there is nothing to follow.
      if (!specifier) continue;
      sites.push({
        specifier: specifier.text,
        range: { start: at, end: matchDelimiter(code, after) },
        locals: [],
        unconditional: false,
        typeOnly: false,
        dynamic: true,
        opaque: false,
      });
      continue;
    }

    let i = after;
    let typeOnly = false;
    if (readIdent(code, i) === 'type') {
      const next = skipTrivia(code, i + 'type'.length);
      // `import type from './x'` is a default import of something named `type`.
      if (readIdent(code, next) !== 'from' && code[next] !== ',' && code[next] !== '=') {
        typeOnly = true;
        i = next;
      }
    }

    const bare = specifierAt(code, i);
    if (bare) {
      // A side-effect import runs when the module loads, so it is on whatever
      // path the module is on.
      sites.push({
        specifier: bare.text,
        range: { start: at, end: bare.end },
        locals: [],
        unconditional: true,
        typeOnly,
        dynamic: false,
        opaque: false,
      });
      continue;
    }

    const clauseStart = i;
    const from = findFrom(code, i);
    if (from === null) continue;
    const specifier = specifierAt(code, skipTrivia(code, from + 'from'.length));
    if (!specifier) continue;

    const { locals, opaque } = localsOfClause(code.slice(clauseStart, from));
    sites.push({
      specifier: specifier.text,
      range: { start: at, end: specifier.end },
      locals,
      unconditional: false,
      typeOnly,
      dynamic: false,
      opaque,
    });
  }

  // `export { a } from './x'` and `export * from './x'` put a module on the
  // graph without binding anything locally, so nothing can say they are unused.
  for (const at of findKeyword(code, 'export')) {
    const from = findFrom(code, skipTrivia(code, at + 'export'.length));
    if (from === null) continue;
    const specifier = specifierAt(code, skipTrivia(code, from + 'from'.length));
    if (!specifier) continue;
    const typeOnly = readIdent(code, skipTrivia(code, at + 'export'.length)) === 'type';
    sites.push({
      specifier: specifier.text,
      range: { start: at, end: specifier.end },
      locals: [],
      unconditional: true,
      typeOnly,
      dynamic: false,
      opaque: false,
    });
  }

  return sites;
}

/** The `from` keyword closing an import or export clause, if this is one. */
function findFrom(code: string, start: number): number | null {
  let i = start;
  while (i < code.length) {
    const ch = code[i]!;
    if (ch === ';' || ch === '\n') {
      // A clause may wrap, but a statement that has ended without `from` is a
      // local declaration rather than an import.
      if (ch === ';') return null;
      i++;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') {
      i = matchDelimiter(code, i);
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') return null;
    if (readIdent(code, i) === 'from' && i > start) return i;
    const word = readIdent(code, i);
    i += word ? word.length : 1;
  }
  return null;
}

function usedOutside(code: string, name: string, excluded: readonly Range[]): boolean {
  for (const at of findKeyword(code, name)) {
    if (excluded.some((range) => at >= range.start && at < range.end)) continue;
    return true;
  }
  return false;
}

export interface RenderEdge {
  readonly specifier: string;
  /** Character offset of the import, for the message. */
  readonly at: number;
}

/**
 * The imports this module puts on the render path.
 *
 * Everything the module brings in, minus the type-only ones that are erased,
 * minus the ones only a `@Server()` body ever mentions.
 */
export function renderEdges(code: string): RenderEdge[] {
  const server = serverFunctionRanges(code);
  const sites = findImportSites(code);
  const excluded = [...server, ...sites.map((site) => site.range)];

  const edges: RenderEdge[] = [];
  for (const site of sites) {
    if (site.typeOnly) continue;

    if (site.dynamic) {
      const inServer = server.some(
        (range) => site.range.start >= range.start && site.range.start < range.end,
      );
      if (!inServer) edges.push({ specifier: site.specifier, at: site.range.start });
      continue;
    }

    // `locals.length === 0` is deliberately not in here. It used to be, and it
    // read a clause of nothing but `type` members — which binds nothing because
    // it is erased — as a side-effect import, which is the opposite conclusion.
    const reaches =
      site.unconditional ||
      site.opaque ||
      site.locals.some((local) => usedOutside(code, local, excluded));
    if (reaches) edges.push({ specifier: site.specifier, at: site.range.start });
  }

  return edges;
}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

export interface RenderPathOptions {
  /**
   * Where the render path starts. A string matches a module id by suffix, a
   * regular expression by test.
   *
   * Left out, it is every module that imports a renderer from `renderModule` —
   * because the render path is what the renderer can reach, and the module
   * that calls it is the last place both facts are in one file. A project
   * whose entry also boots a Node server should name the render module here
   * instead, which is the same split an edge deployment needs anyway.
   */
  entries?: readonly (string | RegExp)[];
  /** Where the renderers live. */
  renderModule?: string;
  /** Importing one of these marks a module as a render entry. */
  renderers?: readonly string[];
  /**
   * Specifiers allowed through even on the render path, for a runtime that
   * really does provide one — `node:async_hooks` on a platform that has it.
   */
  allow?: readonly (string | RegExp)[];
  /** `error` fails the build, `warn` reports and continues, `off` skips the walk. */
  level?: 'error' | 'warn' | 'off';
}

const DEFAULT_RENDER_MODULE = '@voltdev/core/server';
const DEFAULT_RENDERERS = ['renderToString', 'renderToStaticMarkup', 'renderToStream'];

/** Assets and data go through the same graph and have no imports to read. */
const NOT_SOURCE = /\.(css|s[ac]ss|less|styl|json|html?|svg|png|jpe?g|gif|webp|avif|woff2?|ttf)(\?|$)/;

interface ModuleRecord {
  edges: RenderEdge[];
  /** Specifier to resolved module id, for the edges worth following. */
  resolved: Map<string, string>;
  entry: boolean;
}

function matches(id: string, patterns: readonly (string | RegExp)[]): boolean {
  return patterns.some((pattern) =>
    typeof pattern === 'string' ? id === pattern || id.endsWith(pattern) : pattern.test(id),
  );
}

/** A specifier that only a Node-shaped runtime resolves. */
export function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith('node:')) return true;
  // A bare `fs` is the same builtin, but it is also a name a package can have;
  // `isBuiltin` is the same list the resolver would consult.
  return isBuiltin(specifier);
}

/**
 * Refuse a `node:` import that a render can reach.
 *
 * Reported as one error listing every offender with the chain that reached it,
 * rather than as the first one found: the chains usually share a link, and
 * seeing four of them at once is what shows which module is the real problem.
 */
export function renderPath(options: RenderPathOptions = {}): Plugin {
  const renderModule = options.renderModule ?? DEFAULT_RENDER_MODULE;
  const renderers = options.renderers ?? DEFAULT_RENDERERS;
  const allow = options.allow ?? [];
  const level = options.level ?? 'error';

  const modules = new Map<string, ModuleRecord>();

  return {
    name: 'volt:render-path',
    // Ahead of the server-function pass, which is what removes the `@Server()`
    // this reads the boundary from.
    enforce: 'pre',
    apply: 'build',

    buildStart() {
      modules.clear();
    },

    transform: {
      order: 'pre',
      async handler(code, id) {
        if (level === 'off') return null;
        const file = id.split('?')[0] ?? id;
        if (NOT_SOURCE.test(file)) return null;
        if (!code.includes('import') && !code.includes('export')) return null;

        const sites = findImportSites(code);
        const entry =
          matches(file, options.entries ?? []) ||
          (options.entries === undefined &&
            sites.some(
              (site) =>
                !site.typeOnly &&
                site.specifier === renderModule &&
                site.locals.some((local) => renderers.includes(local)),
            ));

        const edges = renderEdges(code);
        const resolved = new Map<string, string>();
        for (const edge of edges) {
          if (isNodeBuiltin(edge.specifier)) continue;
          const target = await this.resolve(edge.specifier, id, { skipSelf: false });
          if (target && !target.external) resolved.set(edge.specifier, target.id);
        }

        modules.set(id, { edges, resolved, entry });
        return null;
      },
    },

    buildEnd(error) {
      if (level === 'off' || error) return;

      const importer = new Map<string, string | null>();
      const queue: string[] = [];
      for (const [id, record] of modules) {
        if (!record.entry) continue;
        importer.set(id, null);
        queue.push(id);
      }
      if (queue.length === 0) return;

      const found: { specifier: string; chain: string[] }[] = [];

      const chainTo = (id: string): string[] => {
        const chain: string[] = [];
        for (let at: string | null | undefined = id; at; at = importer.get(at)) chain.unshift(at);
        return chain;
      };

      while (queue.length > 0) {
        const id = queue.shift()!;
        const record = modules.get(id);
        if (!record) continue;

        for (const edge of record.edges) {
          if (isNodeBuiltin(edge.specifier)) {
            if (matches(edge.specifier, allow)) continue;
            found.push({ specifier: edge.specifier, chain: chainTo(id) });
            continue;
          }
          const target = record.resolved.get(edge.specifier);
          if (!target || importer.has(target)) continue;
          importer.set(target, id);
          queue.push(target);
        }
      }

      if (found.length === 0) return;

      const lines = found.map(({ specifier, chain }) => {
        const reached = chain.map((id, index) => `${'  '.repeat(index + 2)}${id}`).join('\n');
        return `  ${specifier}, reached from the render entry:\n${reached}`;
      });
      const message =
        `[volt] the render path imports ${found.length} Node builtin` +
        `${found.length === 1 ? '' : 's'}:\n${lines.join('\n')}\n` +
        '  A render runs wherever the request is answered, and an edge runtime has ' +
        'none of these.\n' +
        '  Move the import behind a @Server() method, which is the side of the ' +
        'boundary that may\n  have a filesystem, or drop it.';

      if (level === 'warn') this.warn(message);
      else this.error(message);
    },
  };
}
