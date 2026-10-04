/**
 * Which component a tag in a template is, as far as its scoped slots go.
 *
 * `:slot-row="{ row }"` names what `<v-rows>` hands its content, and what that
 * is is written nowhere but `<v-rows>`'s own template, on its outlet. So typing
 * `row` means finding that template: from the tag, to the class the component
 * lists in `imports`, to the module that class is declared in — through a
 * package's declaration map when the class comes from one — to the
 * `templateUrl` beside it, and the `selector` that says which tag it is.
 *
 * Anything that cannot be followed all the way is left out, and its names stay
 * `any`. That is never wrong, only less precise: an `any` reports nothing.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  parse,
  type ComponentSource,
  type RootNode,
  type TemplateChildNode,
} from '@voltdev/compiler';
import {
  findComponentTemplates,
  findKeyword,
  matchDelimiter,
  readIdent,
  skipTrivia,
  type ComponentTemplate,
} from '@voltdev/vite-plugin/components';
import { isClassDeclaration } from 'typescript/unstable/ast/is';
import { SymbolFlags, type Checker, type NodeHandle, type Symbol } from 'typescript/unstable/sync';

/** A class named in `imports`, and where, for the checker to resolve. */
export interface ImportedClass {
  /** The identifier as written, which is how the module itself can name it. */
  name: string;
  /** Offset of the identifier in the module. */
  at: number;
}

/** A component as its tag finds it: which tag, and what its template is. */
interface Declared {
  selector: string;
  root: RootNode;
  /** How many type parameters its class takes. */
  typeParameters: number;
}

/**
 * Declared components already read, by the declaration of their class.
 *
 * One per check rather than one per template: a button is imported by nearly
 * every template in a project, and its template is the same each time.
 */
export type DeclaredCache = Map<string, Promise<Declared | null>>;

/** Whether anything in `nodes` binds what a slot passes. */
export function bindsSlotProps(nodes: readonly TemplateChildNode[]): boolean {
  for (const node of nodes) {
    if (node.type === 'slot-outlet') {
      if (bindsSlotProps(node.children)) return true;
      continue;
    }
    if (node.type !== 'element') continue;
    if (node.directives.some((d) => d.kind === 'slot' && d.exp)) return true;
    if (bindsSlotProps(node.children)) return true;
  }
  return false;
}

/** The classes the component whose `templateUrl` is at `component` lists in `imports`. */
export function readImports(code: string, component: ComponentTemplate): ImportedClass[] {
  const config = configAround(code, offsetOf(code, component));
  const at = config === null ? null : property(code, config, 'imports');
  const open = at === null ? null : arrayStart(code, at);
  if (open === null) return [];

  const end = matchDelimiter(code, open) - 1;
  const found: ImportedClass[] = [];
  for (let i = open + 1; i < end; ) {
    i = skipTrivia(code, i);
    const name = /^[A-Za-z_$]/.test(code[i] ?? '') ? readIdent(code, i) : '';
    const next = skipTrivia(code, i + name.length);
    // Only a bare name can be resolved to a class here. A spread or a member
    // access is passed over, and whatever it holds is typed `any`.
    if (name && (next >= end || code[next] === ',')) found.push({ name, at: i });
    i = elementEnd(code, next, end) + 1;
  }
  return found;
}

/** The `[` of the list a property's value is, or null when it is not one. */
function arrayStart(code: string, value: number): number | null {
  let i = skipTrivia(code, value);
  // `() => [Child]`, the form that defers an import two components make of
  // each other until both modules have run.
  if (code[i] === '(') {
    i = skipTrivia(code, matchDelimiter(code, i));
    if (!code.startsWith('=>', i)) return null;
    i = skipTrivia(code, i + 2);
  }
  return code[i] === '[' ? i : null;
}

/** The `,` closing the list element `from` is inside, or `end` for the last one. */
function elementEnd(code: string, from: number, end: number): number {
  let i = from;
  while (i < end && code[i] !== ',') {
    i = '([{'.includes(code[i]!) ? matchDelimiter(code, i) : i + 1;
  }
  return i;
}

/**
 * The components `imports` lists, by selector, spelled the way `file` names
 * them — which is what the restatement appended to `file` has to write.
 */
export async function childComponents(
  checker: Checker,
  file: string,
  imports: readonly ImportedClass[],
  cache: DeclaredCache,
): Promise<Map<string, ComponentSource>> {
  const found = new Map<string, ComponentSource>();
  if (imports.length === 0) return found;

  const symbols = checker.getSymbolAtPosition(
    file,
    imports.map((imported) => imported.at),
  );
  const declared = await Promise.all(
    symbols.map((symbol) => {
      if (symbol === undefined) return null;
      // An import is an alias, and a package's barrel is a chain of them; the
      // checker follows the chain to the class at its end.
      const target = symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const declaration = target.valueDeclaration;
      if (!(target.flags & SymbolFlags.Class) || declaration === undefined) return null;
      const key = `${declaration.path}#${declaration.index}`;
      let read = cache.get(key);
      if (read === undefined) {
        read = readClass(target, declaration);
        cache.set(key, read);
      }
      return read;
    }),
  );

  for (let i = 0; i < imports.length; i++) {
    const component = declared[i];
    if (!component) continue;
    found.set(component.selector, {
      className: imports[i]!.name,
      root: component.root,
      typeParameters: component.typeParameters,
    });
  }
  return found;
}

/**
 * The component a class symbol declares, from the class's own node.
 *
 * The node says two things the symbol does not. The name the class was
 * declared with, which is what its module's `@Component` is paired with: the
 * symbol's own, except for `export default class Rows`, whose symbol is the
 * export, named `default`. And how many type parameters it takes, which a
 * generic component's slots are typed with.
 */
function readClass(symbol: Symbol, declaration: NodeHandle): Promise<Declared | null> {
  const node = declaration.resolve();
  const declared = node !== undefined && isClassDeclaration(node) ? node : undefined;
  const name = symbol.name !== 'default' ? symbol.name : (declared?.name?.text ?? null);
  if (name === null) return Promise.resolve(null);
  return readDeclared(declaration.path, name, declared?.typeParameters?.length ?? 0);
}

/** The selector and template of class `className`, declared in `path`. */
async function readDeclared(
  path: string,
  className: string,
  typeParameters: number,
): Promise<Declared | null> {
  const source = /\.d\.m?ts$/.test(path) ? await mappedSource(path) : path;
  if (source === null) return null;

  const code = await read(source);
  if (code === null) return null;
  const component = findComponentTemplates(code).find((c) => c.className === className);
  if (component === undefined) return null;

  const config = configAround(code, offsetOf(code, component));
  const selector = config === null ? null : stringProperty(code, config, 'selector');
  if (selector === null) return null;

  const templateFile = resolve(dirname(source), component.templateUrl);
  const template = await read(templateFile);
  if (template === null) return null;
  try {
    return { selector, root: parse(template, { filename: templateFile }), typeParameters };
  } catch {
    // A template that does not parse is reported when it is checked as one of
    // the project's own, and it says nothing about its slots either way.
    return null;
  }
}

/**
 * The source a declaration file was emitted from, by its declaration map.
 *
 * A package ships `.d.ts` without decorators — its `selector` and
 * `templateUrl` are gone — and the template is not beside the declarations but
 * beside the source. A map is what links the two, and a package that ships
 * both its maps and its source is one whose slots can be typed.
 */
async function mappedSource(declaration: string): Promise<string | null> {
  const code = await read(declaration);
  const url = code === null ? undefined : /\/\/# sourceMappingURL=(\S+)\s*$/.exec(code)?.[1];
  if (url === undefined || url.startsWith('data:')) return null;

  const mapFile = resolve(dirname(declaration), url);
  const text = await read(mapFile);
  if (text === null) return null;
  let map: { sources?: unknown; sourceRoot?: unknown };
  try {
    map = JSON.parse(text) as typeof map;
  } catch {
    return null;
  }
  const first = Array.isArray(map.sources) ? map.sources[0] : undefined;
  if (typeof first !== 'string') return null;
  const root = typeof map.sourceRoot === 'string' ? map.sourceRoot : '';
  const source = resolve(dirname(mapFile), root, first);
  return /\.m?ts$/.test(source) && !/\.d\.m?ts$/.test(source) ? source : null;
}

async function read(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** The `@Component(...)` call holding offset `at`, from its `(` to just past its `)`. */
function configAround(code: string, at: number): [number, number] | null {
  for (const site of findKeyword(code, 'Component')) {
    if (code[site - 1] !== '@') continue;
    const paren = skipTrivia(code, site + 'Component'.length);
    if (code[paren] !== '(') continue;
    const end = matchDelimiter(code, paren);
    if (paren < at && at < end) return [paren, end];
  }
  return null;
}

/** Offset just past the `:` of property `name` in `config`, or null. */
function property(code: string, [start, end]: [number, number], name: string): number | null {
  for (const at of findKeyword(code, name)) {
    if (at <= start || at >= end) continue;
    const colon = skipTrivia(code, at + name.length);
    if (code[colon] === ':') return colon + 1;
  }
  return null;
}

/** Property `name` in `config`, when it is a string literal. */
function stringProperty(code: string, config: [number, number], name: string): string | null {
  const at = property(code, config, name);
  if (at === null) return null;
  const open = skipTrivia(code, at);
  const quote = code[open];
  if (quote !== '"' && quote !== "'") return null;
  const close = code.indexOf(quote, open + 1);
  return close === -1 ? null : code.slice(open + 1, close);
}

/** The offset `findComponentTemplates` reported as a line and column. */
function offsetOf(code: string, { line, column }: ComponentTemplate): number {
  let at = 0;
  for (let l = 1; l < line; l++) at = code.indexOf('\n', at) + 1;
  return at + column - 1;
}
