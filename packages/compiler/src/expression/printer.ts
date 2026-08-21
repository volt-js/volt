/**
 * Expression printing and static analysis.
 *
 * Two jobs, both scope-aware:
 *
 *  1. Rewrite free identifiers to component-instance access, so `count()` in a
 *     template becomes `_ctx.count()` while a `:for` binding or arrow
 *     parameter of the same name stays local.
 *
 *  2. Decide whether an expression can touch component state at all. Anything
 *     that provably cannot is folded at build time and never gets an effect —
 *     this is where most of the Svelte-style savings come from.
 */

import type { ExprNode, PatternNode } from './ast.js';
import { patternNames } from './ast.js';

/**
 * Names resolved from the global scope rather than the component instance.
 * Deliberately conservative — anything not listed becomes `_ctx.x`, which
 * fails loudly rather than silently reading a global.
 */
export const TEMPLATE_GLOBALS = new Set([
  'Math', 'JSON', 'Date', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Symbol',
  'BigInt', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Error', 'Intl',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'structuredClone',
  'Infinity', 'NaN', 'undefined', 'null', 'true', 'false',
  'console', 'globalThis', 'window', 'document', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'requestAnimationFrame', 'setTimeout', 'clearTimeout',
]);

/** Identifiers the compiler itself injects into generated scopes. */
export const RUNTIME_LOCALS = new Set(['$event', '$el', '$index', '$refs', '$slots', '$item']);

export interface Scope {
  names: string[];
  /**
   * Names bound to accessor functions rather than plain values. `:for` binds
   * its item and index this way so a keyed row that moves or is re-supplied
   * updates in place instead of being rebuilt — the compiler appends the call
   * so templates still read `{ item.name }`, not `{ item().name }`.
   */
  accessors: boolean;
}

export interface PrintContext {
  /** Expression for the component instance, e.g. `_ctx`. */
  ctx: string;
  /** Innermost-last stack of locally bound names. */
  scopes: Scope[];
  /**
   * Collect a back-reference for every identifier printed, or leave unset.
   *
   * The type-check emit needs to know which characters of its output came
   * from which characters of the template, and the printer is the only place
   * that knows: it is what turns `count` into `_ctx.count`, so by the time
   * anyone sees the output the correspondence is gone. Each printed name is
   * preceded by a `/*@volt:N*​/` comment naming its offset in the expression
   * source, and `N` is pushed here in the same order — the array is what
   * proves a comment found in the output is one the printer wrote, rather
   * than text that happened to look like one inside a string literal.
   *
   * Unset for every other caller, and then not one character changes.
   */
  marks?: number[];
}

export function createPrintContext(ctx = '_ctx'): PrintContext {
  return { ctx, scopes: [] };
}

/** The comment that ties a printed name back to the template, if asked for. */
function mark(ctx: PrintContext, node: { start: number }): string {
  if (!ctx.marks) return '';
  ctx.marks.push(node.start);
  return `/*@volt:${node.start}*/`;
}

export function withScope<T>(
  ctx: PrintContext,
  names: string[],
  fn: () => T,
  accessors = false,
): T {
  ctx.scopes.push({ names, accessors });
  try {
    return fn();
  } finally {
    ctx.scopes.pop();
  }
}

type Binding = 'accessor' | 'value' | null;

function lookupBinding(ctx: PrintContext, name: string): Binding {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i]!;
    if (scope.names.includes(name)) return scope.accessors ? 'accessor' : 'value';
  }
  return null;
}

function isLocal(ctx: PrintContext, name: string): boolean {
  return lookupBinding(ctx, name) !== null;
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const PRECEDENCE: Record<string, number> = {
  '??': 3,
  '||': 4,
  '&&': 5,
  '|': 6,
  '^': 7,
  '&': 8,
  '==': 9,
  '!=': 9,
  '===': 9,
  '!==': 9,
  '<': 10,
  '>': 10,
  '<=': 10,
  '>=': 10,
  in: 10,
  instanceof: 10,
  '<<': 11,
  '>>': 11,
  '>>>': 11,
  '+': 12,
  '-': 12,
  '*': 13,
  '/': 13,
  '%': 13,
  '**': 14,
};

const P_SEQUENCE = 0;
const P_ASSIGN = 1;
const P_CONDITIONAL = 2;
const P_UNARY = 15;
const P_POSTFIX = 16;
const P_CALL = 17;
const P_PRIMARY = 18;

function precedenceOf(node: ExprNode): number {
  switch (node.type) {
    case 'Sequence':
      return P_SEQUENCE;
    case 'Arrow':
    case 'Assignment':
      return P_ASSIGN;
    case 'Conditional':
      return P_CONDITIONAL;
    case 'Logical':
    case 'Binary':
      return PRECEDENCE[node.operator] ?? P_CONDITIONAL;
    case 'Unary':
      return P_UNARY;
    case 'Update':
      return node.prefix ? P_UNARY : P_POSTFIX;
    case 'Call':
    case 'Member':
    case 'New':
      return P_CALL;
    default:
      return P_PRIMARY;
  }
}

export function printExpression(node: ExprNode, ctx: PrintContext, minPrecedence = 0): string {
  const code = printRaw(node, ctx);
  return precedenceOf(node) < minPrecedence ? `(${code})` : code;
}

function printRaw(node: ExprNode, ctx: PrintContext): string {
  switch (node.type) {
    case 'Identifier': {
      const at = mark(ctx, node);
      const binding = lookupBinding(ctx, node.name);
      if (binding === 'accessor') return `${at}${node.name}()`;
      if (binding === 'value') return `${at}${node.name}`;
      if (RUNTIME_LOCALS.has(node.name)) return `${at}${node.name}`;
      if (TEMPLATE_GLOBALS.has(node.name)) return `${at}${node.name}`;
      return `${ctx.ctx}.${at}${node.name}`;
    }

    case 'Literal':
      return node.raw;

    case 'TemplateLiteral': {
      // A template literal's holes were re-parsed from extracted substrings,
      // so their identifiers are located against those substrings and not
      // against this expression. Marking them would point a diagnostic at a
      // column chosen by arithmetic on the wrong string, which is worse than
      // falling back to the expression itself.
      const marks = ctx.marks;
      ctx.marks = undefined;
      try {
        let out = '`';
        for (let i = 0; i < node.quasis.length; i++) {
          out += escapeTemplateText(node.quasis[i] ?? '');
          const expr = node.expressions[i];
          if (expr) out += '${' + printExpression(expr, ctx) + '}';
        }
        return out + '`';
      } finally {
        ctx.marks = marks;
      }
    }

    case 'Member': {
      const object = printExpression(node.object, ctx, P_CALL);
      if (node.computed) {
        return `${object}${node.optional ? '?.' : ''}[${printExpression(node.property, ctx)}]`;
      }
      const property = node.property as { name: string; start: number };
      return `${object}${node.optional ? '?.' : '.'}${mark(ctx, property)}${property.name}`;
    }

    case 'Call': {
      const callee = printExpression(node.callee, ctx, P_CALL);
      const args = node.args.map((a) => printExpression(a, ctx, P_ASSIGN)).join(', ');
      return `${callee}${node.optional ? '?.' : ''}(${args})`;
    }

    case 'New': {
      const callee = printExpression(node.callee, ctx, P_CALL);
      const args = node.args.map((a) => printExpression(a, ctx, P_ASSIGN)).join(', ');
      return `new ${callee}(${args})`;
    }

    case 'Unary': {
      const arg = printExpression(node.argument, ctx, P_UNARY);
      const space = /[a-z]/.test(node.operator) ? ' ' : '';
      return `${node.operator}${space}${arg}`;
    }

    case 'Update': {
      const arg = printExpression(node.argument, ctx, P_UNARY);
      return node.prefix ? `${node.operator}${arg}` : `${arg}${node.operator}`;
    }

    case 'Binary':
    case 'Logical': {
      const precedence = PRECEDENCE[node.operator] ?? P_CONDITIONAL;
      // `**` is right-associative; every other binary operator is left.
      const rightAssoc = node.operator === '**';
      const left = printExpression(node.left, ctx, rightAssoc ? precedence + 1 : precedence);
      const right = printExpression(node.right, ctx, rightAssoc ? precedence : precedence + 1);
      return `${left} ${node.operator} ${right}`;
    }

    case 'Conditional': {
      const test = printExpression(node.test, ctx, P_CONDITIONAL + 1);
      const consequent = printExpression(node.consequent, ctx, P_ASSIGN);
      const alternate = printExpression(node.alternate, ctx, P_ASSIGN);
      return `${test} ? ${consequent} : ${alternate}`;
    }

    case 'Assignment': {
      const left = printExpression(node.left, ctx, P_ASSIGN + 1);
      const right = printExpression(node.right, ctx, P_ASSIGN);
      return `${left} ${node.operator} ${right}`;
    }

    case 'Array': {
      const items = node.elements
        .map((el) => (el === null ? '' : printExpression(el, ctx, P_ASSIGN)))
        .join(', ');
      return `[${items}]`;
    }

    case 'Object': {
      const props = node.properties.map((p) => {
        if (p.type === 'Spread') return `...${printExpression(p.argument, ctx, P_ASSIGN)}`;
        const value = printExpression(p.value, ctx, P_ASSIGN);
        if (p.computed) return `[${printExpression(p.key, ctx)}]: ${value}`;
        // A non-computed key is an identifier or a string/number literal;
        // anything else cannot appear in that position.
        let key: string;
        if (p.key.type === 'Identifier') key = p.key.name;
        else if (p.key.type === 'Literal') key = p.key.raw;
        else key = printExpression(p.key, ctx);
        // Shorthand must still expand — `{ count }` means `{ count: _ctx.count }`.
        return `${key}: ${value}`;
      });
      return `{ ${props.join(', ')} }`;
    }

    case 'Arrow': {
      const names = node.params.flatMap((p) => patternNames(p));
      return withScope(ctx, names, () => {
        const params = node.params.map((p) => printPattern(p, ctx)).join(', ');
        const body = printExpression(node.body, ctx, P_ASSIGN);
        // Wrap object-literal bodies so they are not read as a block.
        const wrapped = node.body.type === 'Object' ? `(${body})` : body;
        return `(${params}) => ${wrapped}`;
      });
    }

    case 'Spread':
      return `...${printExpression(node.argument, ctx, P_ASSIGN)}`;

    case 'Sequence':
      return node.expressions.map((e) => printExpression(e, ctx, P_ASSIGN)).join(', ');
  }
}

export function printPattern(pattern: PatternNode, ctx: PrintContext): string {
  switch (pattern.type) {
    case 'IdentifierPattern':
      return pattern.name;
    case 'ArrayPattern':
      return `[${pattern.elements.map((e) => (e ? printPattern(e, ctx) : '')).join(', ')}]`;
    case 'ObjectPattern': {
      const props = pattern.properties.map((p) => {
        const value = printPattern(p.value, ctx);
        return p.value.type === 'IdentifierPattern' && p.value.name === p.key
          ? p.key
          : `${p.key}: ${value}`;
      });
      if (pattern.rest) props.push(`...${pattern.rest}`);
      return `{ ${props.join(', ')} }`;
    }
    case 'RestPattern':
      return `...${printPattern(pattern.argument, ctx)}`;
    case 'AssignmentPattern':
      return `${printPattern(pattern.left, ctx)} = ${printExpression(pattern.right, ctx, P_ASSIGN)}`;
  }
}

function escapeTemplateText(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
}

// ---------------------------------------------------------------------------
// Static analysis
// ---------------------------------------------------------------------------

/**
 * True when an expression's value cannot depend on component state or on the
 * DOM — it is computable during the build. Deliberately strict: any
 * identifier, call, or member access disqualifies it.
 */
export function isStaticExpression(node: ExprNode): boolean {
  switch (node.type) {
    case 'Literal':
      // Regex literals produce a fresh object each evaluation; not foldable.
      return !(node.value instanceof RegExp) && !node.raw.startsWith('/');
    case 'TemplateLiteral':
      return node.expressions.every(isStaticExpression);
    case 'Unary':
      return node.operator !== 'delete' && isStaticExpression(node.argument);
    case 'Binary':
    case 'Logical':
      return isStaticExpression(node.left) && isStaticExpression(node.right);
    case 'Conditional':
      return (
        isStaticExpression(node.test) &&
        isStaticExpression(node.consequent) &&
        isStaticExpression(node.alternate)
      );
    case 'Array':
      return node.elements.every((el) => el === null || isStaticExpression(el));
    case 'Object':
      return node.properties.every(
        (p) => p.type !== 'Spread' && !p.computed && isStaticExpression(p.value),
      );
    default:
      return false;
  }
}

/**
 * Evaluate a statically-known expression at compile time.
 * Only call when `isStaticExpression` returned true.
 */
export function evaluateStatic(node: ExprNode): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value;

    case 'TemplateLiteral': {
      let out = '';
      for (let i = 0; i < node.quasis.length; i++) {
        out += node.quasis[i] ?? '';
        const expr = node.expressions[i];
        if (expr) out += String(evaluateStatic(expr));
      }
      return out;
    }

    case 'Unary': {
      const v = evaluateStatic(node.argument) as never;
      switch (node.operator) {
        case '!':
          return !v;
        case '-':
          return -v;
        case '+':
          return +v;
        case '~':
          return ~v;
        case 'typeof':
          return typeof v;
        case 'void':
          return undefined;
      }
      return undefined;
    }

    case 'Binary': {
      const l = evaluateStatic(node.left) as never;
      const r = evaluateStatic(node.right) as never;
      switch (node.operator) {
        case '+': return (l as number) + (r as number);
        case '-': return l - r;
        case '*': return l * r;
        case '/': return l / r;
        case '%': return l % r;
        case '**': return (l as number) ** (r as number);
        case '==': return l == r;
        case '!=': return l != r;
        case '===': return l === r;
        case '!==': return l !== r;
        case '<': return l < r;
        case '>': return l > r;
        case '<=': return l <= r;
        case '>=': return l >= r;
        case '&': return l & r;
        case '|': return l | r;
        case '^': return l ^ r;
        case '<<': return l << r;
        case '>>': return l >> r;
        case '>>>': return (l as number) >>> (r as number);
      }
      return undefined;
    }

    case 'Logical': {
      const l = evaluateStatic(node.left);
      switch (node.operator) {
        case '&&':
          return l ? evaluateStatic(node.right) : l;
        case '||':
          return l ? l : evaluateStatic(node.right);
        case '??':
          return l === null || l === undefined ? evaluateStatic(node.right) : l;
      }
      return undefined;
    }

    case 'Conditional':
      return evaluateStatic(node.test)
        ? evaluateStatic(node.consequent)
        : evaluateStatic(node.alternate);

    case 'Array':
      return node.elements.map((el) => (el === null ? undefined : evaluateStatic(el)));

    case 'Object': {
      const out: Record<string, unknown> = {};
      for (const p of node.properties) {
        if (p.type === 'Spread') continue;
        const key = p.key.type === 'Identifier' ? p.key.name : String(evaluateStatic(p.key));
        out[key] = evaluateStatic(p.value);
      }
      return out;
    }

    default:
      return undefined;
  }
}

/** Collect the free (component-scope) identifiers an expression reads. */
export function collectDependencies(
  node: ExprNode,
  ctx: PrintContext,
  out: Set<string> = new Set(),
): Set<string> {
  const visit = (n: ExprNode | PatternNode | null): void => {
    if (!n) return;
    switch (n.type) {
      case 'Identifier':
        if (!isLocal(ctx, n.name) && !TEMPLATE_GLOBALS.has(n.name) && !RUNTIME_LOCALS.has(n.name)) {
          out.add(n.name);
        }
        return;
      case 'Member':
        visit(n.object);
        if (n.computed) visit(n.property);
        return;
      case 'Call':
        visit(n.callee);
        n.args.forEach(visit);
        return;
      case 'New':
        visit(n.callee);
        n.args.forEach(visit);
        return;
      case 'TemplateLiteral':
        n.expressions.forEach(visit);
        return;
      case 'Unary':
      case 'Update':
        visit(n.argument);
        return;
      case 'Binary':
      case 'Logical':
      case 'Assignment':
        visit(n.left);
        visit(n.right);
        return;
      case 'Conditional':
        visit(n.test);
        visit(n.consequent);
        visit(n.alternate);
        return;
      case 'Array':
        n.elements.forEach(visit);
        return;
      case 'Object':
        for (const p of n.properties) {
          if (p.type === 'Spread') visit(p.argument);
          else {
            if (p.computed) visit(p.key);
            visit(p.value);
          }
        }
        return;
      case 'Arrow':
        withScope(ctx, n.params.flatMap((p) => patternNames(p)), () => visit(n.body));
        return;
      case 'Spread':
        visit(n.argument);
        return;
      case 'Sequence':
        n.expressions.forEach(visit);
        return;
      default:
        return;
    }
  };

  visit(node);
  return out;
}
