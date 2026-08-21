/**
 * Lowering `@Component` and `@Prop` away at build time.
 *
 * Standard decorators are evaluated at runtime, and the helper code an engine
 * or a transpiler needs to do that is around 4.6 kB — a fixed cost paid by
 * every app, to compute something this plugin already knows. `@Component` only
 * ever ends in a registration call, and `@Prop` only ever records a name, so
 * both can be resolved here:
 *
 *   @Component({ selector: 'v-counter', render: __volt_render_0 })
 *   export class Counter {
 *     @Prop() start = new Signal.State(0);
 *   }
 *
 * becomes
 *
 *   export class Counter {
 *     start = new Signal.State(0);
 *   }
 *   __volt_define(Counter, { selector: 'v-counter', render: __volt_render_0 },
 *     [{ property: "start" }]);
 *
 * Nothing about how you write a component changes. The decorators stay in the
 * source, keep their types, and still work at runtime for anyone without a
 * build step — this pass simply means the shipped bundle never needs them.
 *
 * It is deliberately conservative: anything it does not recognise with
 * certainty makes it decline the whole file, which falls back to esbuild and
 * is always correct, only larger.
 */

import {
  findDecorators,
  isIdentChar,
  matchAngle,
  matchDelimiter,
  readIdent,
  skipQuoted,
  skipRegex,
  skipTemplateLiteral,
  skipTrivia,
  isRegexStart,
} from './scan.js';

/** A problem in the source that no fallback would make valid. */
export class DecoratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecoratorError';
  }
}

interface PropSite {
  /** The `@` of `@Prop`. */
  start: number;
  /** Just past the decorator, including its argument list. */
  end: number;
  property: string;
  /** Verbatim text of the options argument, if one was given. */
  options: string | null;
}

export interface ComponentSite {
  /** The `@` of `@Component`. */
  start: number;
  /** Just past `@Component(...)`. */
  end: number;
  /** Verbatim text of the config argument, without the surrounding parens. */
  config: string;
  /** Just past the class body's closing brace. */
  bodyEnd: number;
  className: string;
  props: PropSite[];
}

export type LoweringPlan =
  /** No decorators at all — the file can be left exactly as it is. */
  | { kind: 'none' }
  /** Decorators this pass does not own, or a shape it declines to guess at. */
  | { kind: 'foreign' }
  | {
      kind: 'lowered';
      /** Ranges to delete, in source order. */
      removals: { start: number; end: number }[];
      /** Text to insert, at the offset it goes at. */
      insertions: { at: number; text: string }[];
      components: number;
    };

/**
 * Plan the edits that remove every Volt decorator from `code`.
 *
 * A `foreign` result means the caller should fall back to esbuild, which is
 * always correct and only larger.
 */
export function planLowering(code: string, defineName: string): LoweringPlan {
  const sites = findDecorators(code);
  if (sites.length === 0) return { kind: 'none' };

  // A decorator belonging to someone else means esbuild has to run regardless,
  // and once it does it emits its runtime for the whole file — so there is
  // nothing to gain from lowering Volt's decorators too.
  if (sites.some((site) => site.name !== 'Component' && site.name !== 'Prop')) {
    return { kind: 'foreign' };
  }
  if (!sites.some((site) => site.name === 'Component')) return { kind: 'foreign' };

  const removals: { start: number; end: number }[] = [];
  const insertions: { at: number; text: string }[] = [];
  const consumed = new Set<number>();
  let components = 0;

  for (const site of sites) {
    if (site.name !== 'Component') continue;

    const parsed = parseComponent(code, site.at);
    if (!parsed) return { kind: 'foreign' };

    consumed.add(parsed.start);
    removals.push({ start: parsed.start, end: parsed.end });

    for (const prop of parsed.props) {
      consumed.add(prop.start);
      removals.push({ start: prop.start, end: prop.end });
    }

    insertions.push({
      at: parsed.bodyEnd,
      text: `\n${defineName}(${parsed.className}, ${parsed.config}${renderProps(parsed.props)});`,
    });
    components++;
  }

  // Every decorator has to have been accounted for. A `@Prop` on a class that
  // is not a component would otherwise be left behind as bare syntax.
  if (sites.some((site) => !consumed.has(site.at))) return { kind: 'foreign' };

  removals.sort((a, b) => a.start - b.start);
  return { kind: 'lowered', removals, insertions, components };
}

function renderProps(props: PropSite[]): string {
  if (props.length === 0) return '';
  const entries = props.map((prop) => {
    const property = JSON.stringify(prop.property);
    // The options object is copied through rather than read, so an alias built
    // from a constant or an imported value keeps working.
    return prop.options
      ? `{property:${property},...(${prop.options})}`
      : `{property:${property}}`;
  });
  return `, [${entries.join(',')}]`;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** Read `@Component(...) [export] class Name ... { ... }` starting at `at`. */
function parseComponent(code: string, at: number): ComponentSite | null {
  let i = skipTrivia(code, at + '@Component'.length);
  if (code[i] !== '(') return null;

  const configEnd = matchDelimiter(code, i);
  const config = code.slice(i + 1, configEnd - 1).trim();
  if (!config) return null;

  i = skipTrivia(code, configEnd);

  // Modifiers may sit between the decorator and the class keyword.
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
    // Anything else means a shape this pass does not understand.
    return null;
  }

  const className = readIdent(code, i);
  // An anonymous class has no binding to register against.
  if (!className) return null;
  i += className.length;

  // Step over type parameters and heritage clauses to reach the body. Both can
  // contain braces, so the first `{` is not necessarily the class body.
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
    // A `;` before any body means this was a declaration, not a definition.
    if (ch === ';') return null;
    i++;
  }
  if (code[i] !== '{') return null;

  const bodyStart = i;
  const bodyEnd = matchDelimiter(code, bodyStart);

  return {
    start: at,
    end: configEnd,
    config,
    bodyEnd,
    className,
    props: parseProps(code, bodyStart, bodyEnd, className),
  };
}

/**
 * Read every `@Prop` declared directly in a class body.
 *
 * Nested brackets are stepped over wholesale, so only member-level decorators
 * are seen — never anything inside a method body or an initializer.
 */
function parseProps(code: string, bodyStart: number, bodyEnd: number, className: string): PropSite[] {
  const props: PropSite[] = [];
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
    if (ch === '@' && code.startsWith('@Prop', i) && !isIdentChar(code[i + 5])) {
      const prop = parseProp(code, i, className);
      props.push(prop);
      i = prop.end;
      continue;
    }
    i++;
  }

  return props;
}

const MODIFIERS = new Set(['readonly', 'public', 'protected', 'private', 'override', 'declare']);

/**
 * Whether the word just read is a modifier, or the member's own name.
 *
 * `accessor` and `static` are ordinary identifiers too — `@Prop() get = 1`
 * declares a field called `get` — so the following token decides.
 */
function isModifier(code: string, afterWord: number): boolean {
  const ch = code[skipTrivia(code, afterWord)];
  if (ch === undefined) return false;
  return !'=;:!?},('.includes(ch) && ch !== '<';
}

function parseProp(code: string, at: number, className: string): PropSite {
  let i = skipTrivia(code, at + '@Prop'.length);

  let options: string | null = null;
  if (code[i] === '(') {
    const close = matchDelimiter(code, i);
    const inner = code.slice(i + 1, close - 1).trim();
    options = inner || null;
    i = close;
  }
  const end = i;

  i = skipTrivia(code, i);

  for (;;) {
    const word = readIdent(code, i);
    if (!word) break;

    if (MODIFIERS.has(word) && isModifier(code, i + word.length)) {
      i = skipTrivia(code, i + word.length);
      continue;
    }
    if (word === 'accessor' && isModifier(code, i + word.length)) {
      const name = readIdent(code, skipTrivia(code, i + word.length)) || 'value';
      throw new DecoratorError(
        `[volt] @Prop applies to a field, not accessor (${name}) on ${className}.\n` +
          '  Volt has no hidden reactivity — a property is reactive because it\n' +
          '  holds a signal, never because a decorator rewrote it:\n' +
          `    @Prop() ${name} = new Signal.State(...);   // reactive — read ${name}.get()\n` +
          `    @Prop() ${name} = ...;                     // constant`,
      );
    }
    if (word === 'static' && isModifier(code, i + word.length)) {
      const name = readIdent(code, skipTrivia(code, i + word.length)) || 'value';
      throw new DecoratorError(
        `[volt] @Prop cannot be used on a static member (${name}) on ${className}.`,
      );
    }
    if ((word === 'get' || word === 'set') && isModifier(code, i + word.length)) {
      const name = readIdent(code, skipTrivia(code, i + word.length)) || 'value';
      throw new DecoratorError(
        `[volt] @Prop applies to a field, not ${word}ter (${name}) on ${className}.\n` +
          '  A prop is a field the parent assigns to. Compute from it with a\n' +
          '  Signal.Computed instead.',
      );
    }
    break;
  }

  if (code[i] === '#') {
    throw new DecoratorError(
      `[volt] @Prop cannot be used on a private field (#${readIdent(code, i + 1)}) on ${className}.`,
    );
  }
  if (code[i] === '[') {
    throw new DecoratorError(
      `[volt] @Prop needs a plain property name on ${className}, not a computed one.`,
    );
  }
  if (code[i] === '"' || code[i] === "'") {
    throw new DecoratorError(
      `[volt] @Prop needs a plain property name on ${className}, not a string literal.`,
    );
  }

  const property = readIdent(code, i);
  if (!property) {
    throw new DecoratorError(`[volt] @Prop on ${className} is not attached to a property.`);
  }

  const after = skipTrivia(code, i + property.length);
  if (code[after] === '(' || code[after] === '<') {
    throw new DecoratorError(
      `[volt] @Prop applies to a field, not a method (${property}) on ${className}.\n` +
        '  To take a callback from the parent, declare it as a field:\n' +
        `    @Prop() ${property}?: (...args: never[]) => void;`,
    );
  }

  return { start: at, end, property, options };
}
