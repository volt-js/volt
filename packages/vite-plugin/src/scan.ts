/**
 * Source scanning shared by the plugin's build-time passes.
 *
 * Both passes walk TypeScript without parsing it, and both have to be sure
 * that a `@`, a quote or a brace they land on is really code — not something
 * inside a comment, a string, a template literal or a regular expression. A
 * single missed regex would let the scan swallow live source, so the token
 * skipping lives here rather than being written twice.
 */

const IDENT_CHAR = /[A-Za-z0-9_$]/;

export function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && IDENT_CHAR.test(ch);
}

/** Index just past the quoted string opening at `start`. */
export function skipQuoted(code: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === '\\') {
      i += 2;
      continue;
    }
    if (code[i] === quote) return i + 1;
    i++;
  }
  return i;
}

/** Index just past the template literal opening at `start`, spans included. */
export function skipTemplateLiteral(code: string, start: number): number {
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === '\\') {
      i += 2;
      continue;
    }
    if (code[i] === '`') return i + 1;
    if (code[i] === '$' && code[i + 1] === '{') {
      let braces = 1;
      i += 2;
      while (i < code.length && braces > 0) {
        if (code[i] === '{') braces++;
        else if (code[i] === '}') braces--;
        else if (code[i] === '`') {
          i = skipTemplateLiteral(code, i);
          continue;
        } else if (code[i] === '"' || code[i] === "'") {
          i = skipQuoted(code, i, code[i]!);
          continue;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

/** Index just past the regex literal opening at `start`. */
export function skipRegex(code: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < code.length) {
    const ch = code[i]!;
    if (ch === '\\') {
      i += 2;
      continue;
    }
    // A newline means this was a division after all; give the caller back the
    // slash so the walk resumes one character on instead of losing a line.
    if (ch === '\n') return start + 1;
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      i++;
      while (i < code.length && isIdentChar(code[i])) i++;
      return i;
    }
    i++;
  }
  return i;
}

// Characters after which a `/` opens a regex rather than dividing. `)` and `]`
// are deliberately absent: `(a + b) / 2` and `xs[0] / 2` are far commoner than
// a regex in either position.
const REGEX_PRECEDERS = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^',
]);

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do',
  'else', 'yield', 'await',
]);

/** Whether the `/` at `slash` opens a regex literal rather than a division. */
export function isRegexStart(code: string, slash: number): boolean {
  let i = slash - 1;
  while (i >= 0 && /\s/.test(code[i]!)) i--;
  if (i < 0) return true;

  const ch = code[i]!;
  if (REGEX_PRECEDERS.has(ch)) return true;
  if (isIdentChar(ch)) {
    let j = i;
    while (j >= 0 && isIdentChar(code[j]!)) j--;
    return REGEX_KEYWORDS.has(code.slice(j + 1, i + 1));
  }
  return false;
}

/** Index of the next real code character, skipping whitespace and comments. */
export function skipTrivia(code: string, start: number): number {
  let i = start;
  for (;;) {
    while (i < code.length && /\s/.test(code[i]!)) i++;
    if (code[i] === '/' && code[i + 1] === '/') {
      const nl = code.indexOf('\n', i);
      i = nl === -1 ? code.length : nl;
      continue;
    }
    if (code[i] === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    return i;
  }
}

const CLOSERS: Record<string, string> = { '(': ')', '{': '}', '[': ']' };

/**
 * Index just past the bracket matching the one at `start`.
 *
 * Depth is counted across all three bracket kinds together, which is safe on
 * source that parses and keeps this to a single counter.
 */
export function matchDelimiter(code: string, start: number): number {
  if (!CLOSERS[code[start] ?? '']) return start + 1;

  let depth = 0;
  let i = start;
  while (i < code.length) {
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

    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

/**
 * Index just past the `>` matching the `<` at `start`.
 *
 * Only ever called between a class name and its body, where `<` is always a
 * type parameter list — never a comparison.
 */
export function matchAngle(code: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < code.length) {
    const ch = code[i]!;

    if (ch === '"' || ch === "'") {
      i = skipQuoted(code, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplateLiteral(code, i);
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') {
      i = matchDelimiter(code, i);
      continue;
    }
    // The `>` of an arrow inside a function type is not a closing bracket.
    if (ch === '=' && code[i + 1] === '>') {
      i += 2;
      continue;
    }
    if (ch === '<') depth++;
    else if (ch === '>') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

/** The identifier starting at `start`, or `''` if there is none. */
export function readIdent(code: string, start: number): string {
  let i = start;
  while (i < code.length && isIdentChar(code[i])) i++;
  return code.slice(start, i);
}

export interface DecoratorSite {
  at: number;
  name: string;
}

/**
 * Every decorator in the file.
 *
 * Outside a string or a comment, `@` is only ever the start of one, so this
 * needs no notion of context beyond skipping tokens correctly. Shared, because
 * two passes now have to agree about which `@` is code: the decorator
 * lowering, and the server-function pass that runs before it.
 */
export function findDecorators(code: string): DecoratorSite[] {
  const sites: DecoratorSite[] = [];
  walk(code, (index) => {
    if (code[index] !== '@') return 0;
    const name = readIdent(code, index + 1);
    if (!name) return 0;
    sites.push({ at: index, name });
    return 1 + name.length;
  });
  return sites;
}

/**
 * Every place `word` appears as a standalone identifier in code.
 *
 * A member access is excluded — `foo.class` is a property, not the keyword —
 * which is the only ambiguity that matters for the words this is asked about.
 */
export function findKeyword(code: string, word: string): number[] {
  const found: number[] = [];
  walk(code, (index) => {
    if (!isIdentStart(code[index])) return 0;
    const ident = readIdent(code, index);
    if (ident === word && !isMemberAccess(code, index)) found.push(index);
    // Always step the whole identifier, so `classy` cannot be re-read from `l`.
    return ident.length;
  });
  return found;
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_$]/.test(ch);
}

function isMemberAccess(code: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && /\s/.test(code[i]!)) i--;
  return code[i] === '.';
}

/**
 * Walk `code` a token at a time, skipping strings, comments and regexes.
 *
 * `visit` returns how far to advance from `index`; zero means "not mine, carry
 * on one character".
 */
function walk(code: string, visit: (index: number) => number): void {
  let i = 0;
  while (i < code.length) {
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

    const step = visit(i);
    i += step > 0 ? step : 1;
  }
}
