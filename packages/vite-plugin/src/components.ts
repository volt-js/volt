/**
 * Which template belongs to which class.
 *
 * The transform never has to ask: it replaces `templateUrl` in place and the
 * class around it is none of its business. A type check does have to ask —
 * a template's expressions are only checkable against the instance they will
 * run on — so the pairing is read here.
 *
 * This reads less than the lowering pass in `decorators.ts`, which needs the
 * class body to find its `@Prop`s and declines any shape it cannot rewrite
 * with certainty. A check only needs a name, so a class it would refuse to
 * rewrite is still one whose template can be checked.
 */

import {
  findDecorators,
  findKeyword,
  matchDelimiter,
  readIdent,
  skipQuoted,
  skipTrivia,
} from './scan.js';

export interface ComponentTemplate {
  /** The class the template renders against, as named in its own module. */
  className: string;
  /** The `templateUrl` value, exactly as written. */
  templateUrl: string;
  /** Where the `templateUrl` property is, one-based, for a fallback location. */
  line: number;
  column: number;
}

/** Every `@Component({ templateUrl })` in `code`, paired with its class. */
export function findComponentTemplates(code: string): ComponentTemplate[] {
  const urls = findKeyword(code, 'templateUrl');
  if (urls.length === 0) return [];

  const found: ComponentTemplate[] = [];

  for (const site of findDecorators(code)) {
    if (site.name !== 'Component') continue;

    const paren = skipTrivia(code, site.at + '@Component'.length);
    if (code[paren] !== '(') continue;
    const configEnd = matchDelimiter(code, paren);

    const at = urls.find((offset) => offset > paren && offset < configEnd);
    if (at === undefined) continue;

    const url = readStringValue(code, at + 'templateUrl'.length);
    if (url === null) continue;

    const className = readClassName(code, configEnd);
    if (className === null) continue;

    found.push({ className, templateUrl: url, ...lineColumn(code, at) });
  }

  return found;
}

/** The string literal after `:`, or null for any other shape. */
function readStringValue(code: string, after: number): string | null {
  let i = skipTrivia(code, after);
  if (code[i] !== ':') return null;
  i = skipTrivia(code, i + 1);
  const quote = code[i];
  if (quote !== '"' && quote !== "'") return null;
  const end = skipQuoted(code, i, quote);
  return code.slice(i + 1, end - 1);
}

/** The class name after `@Component(...)`, past any modifiers. */
function readClassName(code: string, configEnd: number): string | null {
  let i = skipTrivia(code, configEnd);
  for (;;) {
    const word = readIdent(code, i);
    if (word === 'class') {
      i = skipTrivia(code, i + word.length);
      break;
    }
    if (word === 'export' || word === 'default' || word === 'abstract' || word === 'declare') {
      i = skipTrivia(code, i + word.length);
      continue;
    }
    return null;
  }
  return readIdent(code, i) || null;
}

function lineColumn(code: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset; i++) {
    if (code[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}
