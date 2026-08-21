/**
 * `@Server()` — the two halves of a server function, written at build time.
 *
 * A `@Server()` method runs on the server and is called from the client as
 * though it were local. This pass writes both halves from the one source: the
 * client keeps a stub that posts to a generated endpoint id, the server keeps
 * the real method and a registration under that id. Neither is written by
 * hand, and neither side sees the other's.
 *
 * **The decorator hides the thing that matters most.** Every server function
 * is a public HTTP endpoint, reachable by anyone with `curl`, and
 * `todos.create(text)` reads exactly like a local call. `'use server'` at
 * least reads as unusual; `@Server()` reads as an annotation. So this pass is
 * mostly refusals, and they are the feature rather than a lint:
 *
 *   - a body that does not reach a guard fails the build, the way the template
 *     compiler refuses `:for` without `:key`. `@Server({ public: true })` is
 *     how a method is declared open, in the diff, next to the method.
 *   - the guard must be the *first* statement and it must be awaited. Not
 *     style: `guard` reads the request synchronously, because there is no
 *     `AsyncLocalStorage` on an edge runtime, so anywhere later is a guard
 *     reading whichever call happens to be in flight. It is also the only
 *     position where no work has already been done for an unauthorized caller.
 *   - a guard whose arguments mention one of the method's parameters is
 *     refused. A parameter is whatever the caller posted, so a guard that
 *     trusts one authorizes the attacker.
 *
 * And one refusal that is about this pass rather than about the code: where
 * the decorator lowering declines a file it does not understand and lets
 * esbuild take it, **this one throws**. A declined `@Server()` is a server
 * body shipped to a browser with everything it imported, which is the failure
 * the feature exists to prevent — so an unparseable shape is a build error,
 * never a fallback.
 */

import {
  findDecorators,
  findKeyword,
  isIdentChar,
  isRegexStart,
  matchAngle,
  matchDelimiter,
  readIdent,
  skipQuoted,
  skipRegex,
  skipTemplateLiteral,
  skipTrivia,
} from './scan.js';

/** A shape or a rule this pass will not guess at. Always fails the build. */
export class ServerFunctionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerFunctionError';
  }
}

export interface ServerFunctionOptions {
  /** Which half to emit. Decided per environment, never per file. */
  side: 'client' | 'server';
  /** The module's id, which is half of what an endpoint id is derived from. */
  id: string;
  /** Project root, so an endpoint id does not depend on where a checkout is. */
  root: string;
  /** What the emitted halves import from. */
  module: string;
}

export interface Endpoint {
  /** `Todos.create`. */
  name: string;
  /** `app/todos.ts#Todos.create` — exactly what `id` was hashed from. */
  source: string;
  id: string;
}

export type ServerFunctionPlan =
  | { kind: 'none' }
  | {
      kind: 'lowered';
      /** The import of whichever half this build needs, prepended verbatim. */
      prelude: string;
      removals: { start: number; end: number }[];
      overwrites: { start: number; end: number; text: string }[];
      insertions: { at: number; text: string }[];
      endpoints: Endpoint[];
    };

/** Names the emitted code binds. Distinctive enough not to shadow anything. */
const CALL = '__volt_call';
const REGISTER = '__volt_register';
const ARGS = '__volt_args';

// ---------------------------------------------------------------------------
// Endpoint identity
// ---------------------------------------------------------------------------

/** FNV-1a, 32 bits — the same hash `__VOLT_BUILD__` uses, for the same reason:
 *  it has to be stable and dependency-free, and `node:crypto` is not reachable
 *  from every place this plugin's output has to agree with itself. */
function fnv1a(text: string, seed: number): string {
  let h = seed;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

/**
 * What a method's endpoint id is derived from: `app/todos.ts#Todos.create`.
 *
 * The module's path relative to the project root plus the two names — so the
 * client build and the server build agree without either knowing about the
 * other, and a checkout in a different directory produces the same ids.
 *
 * It is emitted alongside the id rather than only hashed into it, because it is
 * the only thing that tells a hash collision apart from a dev-server reload at
 * the point where that matters; see `registry.ts`.
 */
export function endpointKey(options: {
  id: string;
  root: string;
  className: string;
  method: string;
}): string {
  const file = (options.id.split('?')[0] ?? options.id).replace(/\\/g, '/');
  const rootPrefix = options.root.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  const relative = file.startsWith(rootPrefix) ? file.slice(rootPrefix.length) : file;
  return `${relative}#${options.className}.${options.method}`;
}

/**
 * The URL a method answers on.
 *
 * Two hashes rather than one because a collision is not a broken page but one
 * method answering another's URL, with the wrong guards; the duplicate check
 * below covers one module, and `registerServerFunction` covers the rest.
 */
export function endpointId(key: string): string {
  return fnv1a(key, 0x811c9dc5) + fnv1a(key, 0x9e3779b1);
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export function planServerFunctions(
  code: string,
  options: ServerFunctionOptions,
): ServerFunctionPlan {
  const imports = parseImports(code);
  // Before the early return, because a file whose only `@Server()` is spelled
  // under another name has none of the marks this pass looks for — and would
  // otherwise leave here untouched, with its bodies intact, for the decorator
  // lowering to hand to esbuild and the browser.
  refuseRenamedDecorator(imports, options.module);

  const sites = findDecorators(code);
  const serverSites = sites.filter((site) => site.name === 'Server');
  if (serverSites.length === 0) return { kind: 'none' };

  const guardName = guardBinding(imports, options.module);

  const removals: { start: number; end: number }[] = [];
  const overwrites: { start: number; end: number; text: string }[] = [];
  const insertions: { at: number; text: string }[] = [];
  const endpoints: Endpoint[] = [];
  /** Ranges the client no longer contains, which is what decides which imports
   *  it still needs. */
  const stripped: { start: number; end: number }[] = [];
  const consumed = new Set<number>();

  for (const at of findKeyword(code, 'class')) {
    const parsed = parseClass(code, at);
    if (!parsed) continue;

    const methods = parsed.members.map((member) => {
      consumed.add(member);
      return parseServerMethod(code, member, parsed.name);
    });
    if (methods.length === 0) continue;

    const registrations: string[] = [];
    for (const method of methods) {
      check(code, method, parsed.name, guardName, options.module);
      const source = endpointKey({
        id: options.id,
        root: options.root,
        className: parsed.name,
        method: method.name,
      });
      const id = endpointId(source);
      // Two classes of the same name in one module hash to one id, and the
      // registry cannot see that: it is handed the same key twice, which is
      // what a reload looks like. Only the build knows there are two.
      const twin = endpoints.find((endpoint) => endpoint.id === id);
      if (twin) {
        throw new ServerFunctionError(
          `[volt] this module declares ${twin.name} twice, and both would answer the same\n` +
            `  endpoint ${id} — the second under the first's guards.\n` +
            '  An endpoint id is derived from the module path and the two names, so two\n' +
            '  classes of the same name in one file have nothing left to tell them apart.\n' +
            '  Rename one of the classes.',
        );
      }
      endpoints.push({ name: `${parsed.name}.${method.name}`, source, id });

      if (options.side === 'client') {
        // The whole member goes, signature included: parameter defaults and
        // destructuring patterns are the server's business and can reach
        // anything the module imported.
        overwrites.push({
          start: method.decoratorStart,
          end: method.bodyEnd,
          text: `${method.name}(...${ARGS}) { return ${CALL}(${JSON.stringify(id)}, ${ARGS}); }`,
        });
        stripped.push({ start: method.decoratorStart, end: method.bodyEnd });
      } else {
        removals.push({ start: method.decoratorStart, end: method.memberStart });
        registrations.push(
          `${REGISTER}(this, ${JSON.stringify(method.name)}, ${JSON.stringify(id)}, ` +
            `${JSON.stringify(source)});`,
        );
      }
    }

    if (registrations.length > 0) {
      // A static block rather than a call after the class body: it needs no
      // binding, so a class expression and a class declaration register the
      // same way, and a class nothing imports registers nothing.
      insertions.push({
        at: parsed.bodyStart + 1,
        text: `\n  static { ${registrations.join(' ')} }`,
      });
    }
  }

  const orphan = serverSites.find((site) => !consumed.has(site.at));
  if (orphan) {
    throw new ServerFunctionError(
      '[volt] @Server() applies to a method of a class, and this one is not on ' +
        'one.\n  Every server function is a method the build can name, because the ' +
        'name is\n  half of what its endpoint id is derived from.',
    );
  }

  if (options.side === 'client') {
    prune(code, imports, stripped, removals, overwrites);
  }

  const prelude =
    options.side === 'client'
      ? `import { callServer as ${CALL} } from ${JSON.stringify(`${options.module}/client`)};\n`
      : `import { registerServerFunction as ${REGISTER} } from ${JSON.stringify(options.module)};\n`;

  return { kind: 'lowered', prelude, removals, overwrites, insertions, endpoints };
}

// ---------------------------------------------------------------------------
// Classes and methods
// ---------------------------------------------------------------------------

interface ClassSite {
  name: string;
  bodyStart: number;
  bodyEnd: number;
  /** Offsets of member-level `@Server` decorators. */
  members: number[];
}

/** Read `class Name ... { ... }` starting at the `class` keyword. */
function parseClass(code: string, at: number): ClassSite | null {
  let i = skipTrivia(code, at + 'class'.length);
  // `class = 1` and `class() {}` are a property and a method with an awkward
  // name, not a class at all.
  if (!isIdentChar(code[i]) && code[i] !== '{' && code[i] !== '<') return null;

  let name = readIdent(code, i);
  if (name === 'extends' || name === 'implements') name = '';
  i += name.length;

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
    if (ch === ';') return null;
    i++;
  }
  if (code[i] !== '{') return null;

  const bodyStart = i;
  const bodyEnd = matchDelimiter(code, bodyStart);
  const members = memberDecorators(code, bodyStart, bodyEnd);
  if (members.length === 0) return null;

  if (!name) {
    throw new ServerFunctionError(
      '[volt] @Server() needs a named class.\n' +
        '  The class name is half of what the endpoint id is derived from, so an\n' +
        '  anonymous class has no id that survives to the other build.',
    );
  }
  return { name, bodyStart, bodyEnd, members };
}

/**
 * `@Server` decorators declared directly in this class body.
 *
 * Nested brackets are stepped over wholesale, so a `@Server` inside a method
 * body — or inside a class declared inside one — belongs to that scan, not
 * this one.
 */
function memberDecorators(code: string, bodyStart: number, bodyEnd: number): number[] {
  const found: number[] = [];
  let i = bodyStart + 1;
  const end = bodyEnd - 1;

  while (i < end) {
    const ch = code[i]!;
    if (ch === '"' || ch === "'") {
      i = skipQuoted(code, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplateLiteral(code, i);
      continue;
    }
    if (ch === '/') {
      const next = skipTrivia(code, i);
      if (next !== i) {
        i = next;
        continue;
      }
      if (isRegexStart(code, i)) {
        i = skipRegex(code, i);
        continue;
      }
    }
    if (ch === '(' || ch === '{' || ch === '[') {
      i = matchDelimiter(code, i);
      continue;
    }
    if (ch === '@' && code.startsWith('@Server', i) && !isIdentChar(code[i + 7])) {
      found.push(i);
      i += '@Server'.length;
      continue;
    }
    i++;
  }
  return found;
}

interface MethodSite {
  decoratorStart: number;
  /** First character of the member itself, past the decorator. */
  memberStart: number;
  name: string;
  params: string;
  bodyStart: number;
  bodyEnd: number;
  isPublic: boolean;
}

const MODIFIERS = new Set(['public', 'protected', 'private', 'override', 'readonly', 'declare']);

/** Whether the word just read is a modifier, or the member's own name. */
function isModifier(code: string, afterWord: number): boolean {
  const ch = code[skipTrivia(code, afterWord)];
  if (ch === undefined) return false;
  return !'=;:!?},('.includes(ch) && ch !== '<';
}

function parseServerMethod(code: string, at: number, className: string): MethodSite {
  let i = skipTrivia(code, at + '@Server'.length);

  let optionsText: string | null = null;
  if (code[i] === '(') {
    const close = matchDelimiter(code, i);
    optionsText = code.slice(i + 1, close - 1).trim();
    i = close;
  } else {
    throw new ServerFunctionError(
      `[volt] @Server on ${className} is missing its call: write @Server(), with the ` +
        'parentheses.',
    );
  }
  const isPublic = readOptions(optionsText, className);

  const memberStart = skipTrivia(code, i);
  i = memberStart;

  let isAsync = false;
  for (;;) {
    const word = readIdent(code, i);
    if (!word) break;

    if (word === 'async' && isModifier(code, i + word.length)) {
      isAsync = true;
      i = skipTrivia(code, i + word.length);
      continue;
    }
    if (word === 'static' && isModifier(code, i + word.length)) {
      throw new ServerFunctionError(
        `[volt] @Server() cannot be used on a static member on ${className}.\n` +
          '  The handler constructs the class once per call, so that nothing a method\n' +
          '  assigns to `this` outlives the request that assigned it. Make it an\n' +
          '  instance method.',
      );
    }
    if ((word === 'get' || word === 'set') && isModifier(code, i + word.length)) {
      const name = readIdent(code, skipTrivia(code, i + word.length)) || 'value';
      throw new ServerFunctionError(
        `[volt] @Server() applies to a method, not a ${word}ter (${name}) on ${className}.\n` +
          '  A server function is a request: it takes arguments, it can fail, and it\n' +
          '  takes as long as the network does. A property access that did all three\n' +
          '  would hide every one of them.',
      );
    }
    if (word === 'accessor' && isModifier(code, i + word.length)) {
      throw new ServerFunctionError(
        `[volt] @Server() applies to a method, not an accessor on ${className}.`,
      );
    }
    if (MODIFIERS.has(word) && isModifier(code, i + word.length)) {
      i = skipTrivia(code, i + word.length);
      continue;
    }
    break;
  }

  if (code[i] === '#') {
    throw new ServerFunctionError(
      `[volt] @Server() cannot be used on a private method on ${className}.\n` +
        '  A server function is a public HTTP endpoint whatever the call site looks\n' +
        '  like, and `#` would say the opposite to every reader of this class.',
    );
  }
  if (code[i] === '[' || code[i] === '"' || code[i] === "'") {
    throw new ServerFunctionError(
      `[volt] @Server() needs a plain method name on ${className}.\n` +
        '  The name is half of what the endpoint id is derived from, so it has to be\n' +
        '  readable at build time.',
    );
  }

  const name = readIdent(code, i);
  if (!name) {
    throw new ServerFunctionError(`[volt] @Server() on ${className} is not attached to a method.`);
  }
  i = skipTrivia(code, i + name.length);
  if (code[i] === '?') i = skipTrivia(code, i + 1);
  if (code[i] === '<') i = skipTrivia(code, matchAngle(code, i));

  if (code[i] !== '(') {
    throw new ServerFunctionError(
      `[volt] @Server() applies to a method, not a field (${name}) on ${className}.\n` +
        '  A field holding a function has no signature the build can read, and the\n' +
        '  signature is what constrains what may cross the boundary.',
    );
  }
  const paramsStart = i;
  const paramsEnd = matchDelimiter(code, paramsStart);
  const params = code.slice(paramsStart + 1, paramsEnd - 1);

  if (!isAsync) {
    throw new ServerFunctionError(
      `[volt] @Server() ${name} on ${className} must be declared async.\n` +
        '  Calling it is an HTTP request, so it returns a promise on the client\n' +
        '  whatever the server writes. Declaring it async is what makes the two\n' +
        '  signatures the same one.',
    );
  }

  // Past the return type annotation to the body. An async method's annotation
  // is a `Promise<...>`, so any `{` it contains is inside the angle brackets
  // this steps over rather than the body's own.
  i = bodyBrace(code, paramsEnd, name, className);
  return {
    decoratorStart: at,
    memberStart,
    name,
    params,
    bodyStart: i,
    bodyEnd: matchDelimiter(code, i),
    isPublic,
  };
}

function bodyBrace(code: string, from: number, name: string, className: string): number {
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
    if (ch === ';') break;
    i++;
  }
  if (code[i] !== '{') {
    throw new ServerFunctionError(
      `[volt] @Server() ${name} on ${className} has no body.\n` +
        '  An overload signature or a declaration cannot be an endpoint: there is\n' +
        '  nothing for the server build to register.',
    );
  }
  return i;
}

/** `{ public: true }` and nothing else. */
function readOptions(text: string, className: string): boolean {
  if (text === '') return false;
  const refuse = (): never => {
    throw new ServerFunctionError(
      `[volt] @Server() on ${className} takes an object literal, and only ` +
        '`{ public: true }`.\n' +
        '  It is read at build time, because it decides whether the build refuses a\n' +
        '  body with no guard. A value it has to run — a constant, an import — would\n' +
        '  mean the check could not be made at all.',
    );
  };
  if (!text.startsWith('{') || !text.endsWith('}')) refuse();

  let isPublic = false;
  for (const entry of splitTop(text.slice(1, -1))) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const match = /^public\s*:\s*(true|false)$/.exec(trimmed);
    if (!match) refuse();
    isPublic = match![1] === 'true';
  }
  return isPublic;
}

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

function check(
  code: string,
  method: MethodSite,
  className: string,
  guardName: string | null,
  module: string,
): void {
  if (method.isPublic) return;

  const body = code.slice(method.bodyStart + 1, method.bodyEnd - 1);
  const where = `${className}.${method.name}`;

  if (guardName === null) {
    throw new ServerFunctionError(unguarded(where, module));
  }

  const first = firstStatementGuard(body, guardName);
  if (first === null) {
    // Told apart because the two are different mistakes: one author has not
    // authorized at all, the other authorized somewhere that cannot work.
    throw new ServerFunctionError(
      identifiers(body).includes(guardName)
        ? misplaced(where, guardName)
        : unguarded(where, module),
    );
  }

  const parameters = parameterNames(method.params);
  const mentioned = identifiers(first).find((name) => parameters.includes(name));
  if (mentioned !== undefined) {
    throw new ServerFunctionError(
      `[volt] the guard on ${where} reads \`${mentioned}\` from a parameter.\n` +
        '  A parameter is whatever the caller posted, so a guard that trusts one\n' +
        '  authorizes the attacker: anyone with curl sends the id of the account they\n' +
        '  want to be. Authentication comes from the request, and nowhere else:\n' +
        `    const user = await ${guardName}((request) => sessionFrom(request.headers));\n` +
        `  Then check \`${mentioned}\` against what the guard returned, inside the body.`,
    );
  }
}

function unguarded(where: string, module: string): string {
  return (
    `[volt] @Server() ${where} does not reach a guard.\n` +
    '  This is a public HTTP endpoint. `todos.create(text)` reads like a local\n' +
    '  call, but anyone with curl can post to it, and nothing at the call site\n' +
    '  says so. Authorize on the first line, from the request:\n' +
    `    import { guard } from '${module}';\n` +
    '    @Server()\n' +
    '    async create(text: string): Promise<{ id: string }> {\n' +
    '      const user = await guard(session);\n' +
    '      ...\n' +
    '  Or say that it really is open to everyone:\n' +
    '    @Server({ public: true })'
  );
}

function misplaced(where: string, guardName: string): string {
  return (
    `[volt] the guard on @Server() ${where} is not the first statement, or is not\n` +
    '  awaited.\n' +
    `  \`${guardName}\` reads the request synchronously — there is no\n` +
    '  AsyncLocalStorage underneath it, because Volt runs on edge runtimes that\n' +
    '  have none. So once the body has awaited anything, another call may be the\n' +
    '  one in flight, and the guard would authorize against its request instead.\n' +
    '  It is also the only position where no work has already been done on behalf\n' +
    '  of a caller nobody has authorized. Write it first:\n' +
    `    const user = await ${guardName}(session);`
  );
}

/**
 * The arguments of the guard call, when the body's first statement is one.
 *
 * Returns null for anything else, including a guard that is called but not
 * awaited: an un-awaited guard leaves the body running while it is still
 * deciding, which is a check that stops nothing.
 */
function firstStatementGuard(body: string, guardName: string): string | null {
  let i = skipTrivia(body, 0);

  const declaration = readIdent(body, i);
  if (declaration === 'const' || declaration === 'let' || declaration === 'var') {
    i = skipTrivia(body, i + declaration.length);
    if (body[i] === '{' || body[i] === '[') i = matchDelimiter(body, i);
    else i += readIdent(body, i).length;
    i = skipTrivia(body, i);
    // A type annotation on the binding sits between it and the `=`.
    if (body[i] === ':') {
      while (i < body.length && body[i] !== '=') {
        if (body[i] === '<') i = matchAngle(body, i);
        else if (body[i] === '{' || body[i] === '(' || body[i] === '[') i = matchDelimiter(body, i);
        else i++;
      }
    }
    if (body[i] !== '=') return null;
    i = skipTrivia(body, i + 1);
  }

  if (readIdent(body, i) !== 'await') return null;
  i = skipTrivia(body, i + 'await'.length);

  if (readIdent(body, i) !== guardName) return null;
  i = skipTrivia(body, i + guardName.length);
  if (body[i] !== '(') return null;

  return body.slice(i + 1, matchDelimiter(body, i) - 1);
}

/**
 * The names a call to this method binds.
 *
 * Deliberately over-collects: for a destructured parameter every identifier in
 * the pattern counts, so `{ userId: id }` protects both spellings. A name too
 * many refuses a guard that would have been fine; a name too few lets one
 * through that authorizes whoever asked.
 */
function parameterNames(params: string): string[] {
  const names: string[] = [];
  for (const raw of splitTop(params)) {
    const param = raw.trim().replace(/^\.\.\./, '');
    if (!param || param === 'this') continue;
    if (param.startsWith('{') || param.startsWith('[')) {
      names.push(...identifiers(param));
      continue;
    }
    const name = readIdent(param, 0);
    if (name) names.push(name);
  }
  return names;
}

/** Every identifier in `text`, in source order, property accesses excluded. */
function identifiers(text: string): string[] {
  const names: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      i = skipQuoted(text, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplateLiteral(text, i);
      continue;
    }
    if (ch === '/') {
      const next = skipTrivia(text, i);
      if (next !== i) {
        i = next;
        continue;
      }
      if (isRegexStart(text, i)) {
        i = skipRegex(text, i);
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const name = readIdent(text, i);
      let back = i - 1;
      while (back >= 0 && /\s/.test(text[back]!)) back--;
      if (text[back] !== '.') names.push(name);
      i += name.length;
      continue;
    }
    i++;
  }
  return names;
}

/** Split on commas that are not inside brackets, quotes or a template. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      i = skipQuoted(text, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplateLiteral(text, i);
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') {
      i = matchDelimiter(text, i);
      continue;
    }
    if (ch === '<') {
      i = matchAngle(text, i);
      continue;
    }
    if (ch === ',') {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(text.slice(start));
  return parts;
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

interface ImportBinding {
  kind: 'named' | 'default' | 'namespace';
  /** The exported name, for a named binding. */
  imported: string;
  local: string;
  typeOnly: boolean;
}

interface ImportDecl {
  start: number;
  end: number;
  specifier: string;
  typeOnly: boolean;
  /** Null when the shape was not understood — such a declaration is left alone. */
  bindings: ImportBinding[] | null;
}

function parseImports(code: string): ImportDecl[] {
  const declarations: ImportDecl[] = [];
  for (const at of findKeyword(code, 'import')) {
    const after = skipTrivia(code, at + 'import'.length);
    // `import(...)` and `import.meta` are expressions, not declarations.
    if (code[after] === '(' || code[after] === '.') continue;
    const parsed = parseImport(code, at, after);
    if (parsed) declarations.push(parsed);
  }
  return declarations;
}

function parseImport(code: string, start: number, from: number): ImportDecl | null {
  let i = from;
  let typeOnly = false;

  if (readIdent(code, i) === 'type') {
    const next = skipTrivia(code, i + 'type'.length);
    // `import type from './x'` is a default import of something called `type`.
    if (readIdent(code, next) !== 'from' && code[next] !== ',' && code[next] !== '=') {
      typeOnly = true;
      i = next;
    }
  }

  // A bare `import './x.js'` is a side effect somebody asked for; it has no
  // bindings and is never touched.
  if (code[i] === '"' || code[i] === "'") {
    const close = skipQuoted(code, i, code[i]!);
    return {
      start,
      end: withSemicolon(code, close),
      specifier: code.slice(i + 1, close - 1),
      typeOnly,
      bindings: [],
    };
  }

  const bindings: ImportBinding[] = [];
  let understood = true;

  for (;;) {
    if (code[i] === '{') {
      const close = matchDelimiter(code, i);
      for (const entry of splitTop(code.slice(i + 1, close - 1))) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        const parsed = parseSpecifier(trimmed);
        if (!parsed) understood = false;
        else bindings.push(parsed);
      }
      i = skipTrivia(code, close);
    } else if (code[i] === '*') {
      i = skipTrivia(code, i + 1);
      if (readIdent(code, i) !== 'as') return null;
      i = skipTrivia(code, i + 2);
      const local = readIdent(code, i);
      if (!local) return null;
      bindings.push({ kind: 'namespace', imported: '*', local, typeOnly: false });
      i = skipTrivia(code, i + local.length);
    } else {
      const local = readIdent(code, i);
      if (!local) return null;
      bindings.push({ kind: 'default', imported: 'default', local, typeOnly: false });
      i = skipTrivia(code, i + local.length);
    }

    if (code[i] === ',') {
      i = skipTrivia(code, i + 1);
      continue;
    }
    break;
  }

  if (readIdent(code, i) !== 'from') return null;
  i = skipTrivia(code, i + 'from'.length);
  if (code[i] !== '"' && code[i] !== "'") return null;
  const close = skipQuoted(code, i, code[i]!);

  return {
    start,
    end: withSemicolon(code, close),
    specifier: code.slice(i + 1, close - 1),
    typeOnly,
    bindings: understood ? bindings : null,
  };
}

function parseSpecifier(entry: string): ImportBinding | null {
  let text = entry;
  let typeOnly = false;
  if (/^type\s+/.test(text)) {
    typeOnly = true;
    text = text.slice(4).trim();
  }
  const parts = text.split(/\s+as\s+/);
  if (parts.length === 1) {
    const name = parts[0]!.trim();
    return /^[A-Za-z_$][\w$]*$/.test(name)
      ? { kind: 'named', imported: name, local: name, typeOnly }
      : null;
  }
  if (parts.length !== 2) return null;
  const imported = parts[0]!.trim();
  const local = parts[1]!.trim();
  // A string-literal export name is legal and rare; leaving the declaration
  // alone is always correct and only larger.
  if (!/^[A-Za-z_$][\w$]*$/.test(imported) || !/^[A-Za-z_$][\w$]*$/.test(local)) return null;
  return { kind: 'named', imported, local, typeOnly };
}

function withSemicolon(code: string, end: number): number {
  const next = skipTrivia(code, end);
  return code[next] === ';' ? next + 1 : end;
}

/**
 * Refuse `import { Server as Endpoint }`.
 *
 * This pass finds its work by looking for the four characters `@Server`, and
 * every refusal it makes is downstream of finding it. Under another name it
 * finds nothing, declines the file, and the decorator lowering hands it to
 * esbuild — which lowers `@Endpoint()` the ordinary way and ships the body to
 * the browser, unguarded, with everything it imported. The runtime `Server()`
 * throws when such a method is finally called, so it is not silent; it is just
 * far too late, and by then the database module is in the bundle.
 *
 * So the rename is refused rather than followed. Following it would mean
 * resolving bindings across modules to know which decorator is really this one,
 * which is a type checker's job, and the whole pass is a lexical scan.
 */
function refuseRenamedDecorator(imports: ImportDecl[], module: string): void {
  for (const declaration of imports) {
    if (declaration.specifier !== module || declaration.typeOnly) continue;
    for (const binding of declaration.bindings ?? []) {
      if (binding.kind !== 'named' || binding.typeOnly) continue;
      if (binding.imported === 'Server' && binding.local !== 'Server') {
        throw new ServerFunctionError(
          `[volt] @Server() is recognised by name, and this module imports it as ` +
            `\`${binding.local}\`.\n` +
            `  A decorator the build cannot see is one it cannot check: the body would\n` +
            '  reach the browser unstripped and the endpoint would answer unguarded.\n' +
            `  Import it as itself — \`import { Server } from '${module}'\`.`,
        );
      }
    }
  }
}

/** The local name `guard` was imported under, if it was. */
function guardBinding(imports: ImportDecl[], module: string): string | null {
  for (const declaration of imports) {
    if (declaration.specifier !== module || declaration.typeOnly) continue;
    for (const binding of declaration.bindings ?? []) {
      if (binding.kind === 'namespace') {
        throw new ServerFunctionError(
          `[volt] a guard is recognised by name, and this module imports '${module}' as a ` +
            'namespace.\n' +
            "  Import it directly — `import { guard } from '" +
            module +
            "'` — so that the build\n" +
            '  can see which call authorizes the body, rather than trusting that one does.',
        );
      }
      if (binding.kind === 'named' && binding.imported === 'guard' && !binding.typeOnly) {
        return binding.local;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// What the client stops importing
// ---------------------------------------------------------------------------

/**
 * Drop imports nothing references once the bodies are gone.
 *
 * Stripping a body and leaving its imports behind is worth very little: the
 * module that talks to the database is still in the client graph, still
 * evaluated, and still in the bundle. This is what makes "the client bundle
 * contains no server body" mean the module the body reached for as well.
 *
 * The direction of error is towards keeping: a binding whose name still occurs
 * anywhere outside an import or a stripped range is kept, so a name that only
 * survives in a type annotation costs a retained import rather than a broken
 * build.
 */
function prune(
  code: string,
  imports: ImportDecl[],
  stripped: { start: number; end: number }[],
  removals: { start: number; end: number }[],
  overwrites: { start: number; end: number; text: string }[],
): void {
  const excluded = [...stripped, ...imports.map((it) => ({ start: it.start, end: it.end }))];

  for (const declaration of imports) {
    // A side-effect import, or a shape the parse declined: both stay.
    if (declaration.bindings === null || declaration.bindings.length === 0) continue;
    if (declaration.typeOnly) continue;

    const kept = declaration.bindings.filter(
      (binding) => references(code, binding.local, excluded) > 0,
    );
    if (kept.length === declaration.bindings.length) continue;

    if (kept.length === 0) {
      removals.push({ start: declaration.start, end: declaration.end });
      continue;
    }
    overwrites.push({
      start: declaration.start,
      end: declaration.end,
      text: printImport(kept, declaration.specifier),
    });
  }
}

function printImport(bindings: ImportBinding[], specifier: string): string {
  const clauses: string[] = [];
  const named: string[] = [];
  for (const binding of bindings) {
    if (binding.kind === 'default') clauses.push(binding.local);
    else if (binding.kind === 'namespace') clauses.push(`* as ${binding.local}`);
    else {
      const name =
        binding.imported === binding.local ? binding.local : `${binding.imported} as ${binding.local}`;
      named.push(binding.typeOnly ? `type ${name}` : name);
    }
  }
  if (named.length > 0) clauses.push(`{ ${named.join(', ')} }`);
  return `import ${clauses.join(', ')} from ${JSON.stringify(specifier)};`;
}

function references(
  code: string,
  name: string,
  excluded: { start: number; end: number }[],
): number {
  let count = 0;
  for (const at of findKeyword(code, name)) {
    if (excluded.some((range) => at >= range.start && at < range.end)) continue;
    count++;
  }
  return count;
}
