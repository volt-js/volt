/**
 * A Pratt parser for the expression subset templates are allowed to use.
 *
 * Parsing to a real AST (rather than regex-rewriting the source, as early
 * template engines did) is what makes the rest of the compiler trustworthy:
 * identifier prefixing knows about scope, and static analysis can prove an
 * expression never touches component state.
 */

import { ExpressionSyntaxError, tokenize, type TemplatePart, type Token } from './tokenizer.js';
import type { ExprNode, ObjectProperty, PatternNode, SpreadNode } from './ast.js';

const BINARY_PRECEDENCE: Record<string, number> = {
  '??': 1,
  '||': 2,
  '&&': 3,
  '|': 4,
  '^': 5,
  '&': 6,
  '==': 7,
  '!=': 7,
  '===': 7,
  '!==': 7,
  '<': 8,
  '>': 8,
  '<=': 8,
  '>=': 8,
  in: 8,
  instanceof: 8,
  '<<': 9,
  '>>': 9,
  '>>>': 9,
  '+': 10,
  '-': 10,
  '*': 11,
  '/': 11,
  '%': 11,
  '**': 12,
};

const LOGICAL_OPERATORS = new Set(['&&', '||', '??']);
const ASSIGN_OPERATORS = new Set([
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '**=',
  '<<=',
  '>>=',
  '>>>=',
  '&=',
  '|=',
  '^=',
  '&&=',
  '||=',
  '??=',
]);
const UNARY_OPERATORS = new Set(['!', '-', '+', '~', 'typeof', 'void', 'delete']);

export interface ForExpression {
  /** The per-item binding, e.g. `item` or `{ id, name }`. */
  item: PatternNode;
  /** Optional index binding from `(item, i) in list`. */
  index: string | null;
  /** The iterable expression. */
  source: ExprNode;
}

export function parseExpression(source: string): ExprNode {
  const parser = new ExprParser(source);
  const node = parser.parseSequence();
  parser.expectEnd();
  return node;
}

/** Parse the right-hand side of `:for`, e.g. `(item, i) in items()`. */
export function parseForExpression(source: string): ForExpression {
  const parser = new ExprParser(source);
  return parser.parseFor();
}

class ExprParser {
  private tokens: Token[];
  private index = 0;

  constructor(private readonly source: string) {
    this.tokens = tokenize(source);
  }

  // -- token helpers --------------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    return this.tokens[this.index++]!;
  }

  private isPunct(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.type === 'punct' && t.value === value;
  }

  private isKeyword(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.type === 'keyword' && t.value === value;
  }

  private eatPunct(value: string): boolean {
    if (this.isPunct(value)) {
      this.index++;
      return true;
    }
    return false;
  }

  private expectPunct(value: string): void {
    if (!this.eatPunct(value)) {
      this.fail(`Expected \`${value}\` but found \`${this.peek().value || 'end of expression'}\``);
    }
  }

  private fail(message: string): never {
    throw new ExpressionSyntaxError(message, this.source, this.peek().start);
  }

  expectEnd(): void {
    if (this.peek().type !== 'eof') {
      this.fail(`Unexpected \`${this.peek().value}\``);
    }
  }

  /** Index of the token after the `)` matching the `(` at `from`. */
  private matchingParen(from: number): number {
    let depth = 0;
    for (let i = from; i < this.tokens.length; i++) {
      const t = this.tokens[i]!;
      if (t.type !== 'punct') continue;
      if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
      else if (t.value === ')' || t.value === ']' || t.value === '}') {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }

  // -- entry points ---------------------------------------------------------

  parseSequence(): ExprNode {
    const first = this.parseAssignment();
    if (!this.isPunct(',')) return first;
    const expressions = [first];
    while (this.eatPunct(',')) expressions.push(this.parseAssignment());
    return { type: 'Sequence', expressions };
  }

  parseFor(): ForExpression {
    let item: PatternNode;
    let index: string | null = null;

    // `(item, i) in list` — a paren group whose close is followed by in/of.
    if (this.isPunct('(')) {
      const after = this.matchingParen(this.index);
      const following = after === -1 ? undefined : this.tokens[after];
      const isForHead =
        following !== undefined &&
        following.type === 'keyword' &&
        (following.value === 'in' || following.value === 'of');

      if (isForHead) {
        this.expectPunct('(');
        item = this.parsePattern();
        if (this.eatPunct(',')) {
          const t = this.next();
          if (t.type !== 'ident') this.fail('Expected an index name');
          index = t.value;
        }
        this.expectPunct(')');
      } else {
        item = this.parsePattern();
      }
    } else {
      item = this.parsePattern();
    }

    if (!this.isKeyword('in') && !this.isKeyword('of')) {
      this.fail('Expected `in` — `:for` reads as `:for="item in items()"`');
    }
    this.index++;

    const source = this.parseAssignment();
    this.expectEnd();
    return { item, index, source };
  }

  // -- expressions ----------------------------------------------------------

  private parseAssignment(): ExprNode {
    if (this.isArrowAhead()) return this.parseArrow();

    const left = this.parseConditional();
    const t = this.peek();
    if (t.type === 'punct' && ASSIGN_OPERATORS.has(t.value)) {
      this.index++;
      const right = this.parseAssignment();
      return { type: 'Assignment', operator: t.value, left, right };
    }
    return left;
  }

  private isArrowAhead(): boolean {
    const t = this.peek();
    if (t.type === 'ident' && this.isPunct('=>', 1)) return true;
    if (t.type === 'punct' && t.value === '(') {
      const after = this.matchingParen(this.index);
      if (after === -1) return false;
      const following = this.tokens[after];
      return following?.type === 'punct' && following.value === '=>';
    }
    return false;
  }

  private parseArrow(): ExprNode {
    const params: PatternNode[] = [];
    if (this.peek().type === 'ident') {
      params.push({ type: 'IdentifierPattern', name: this.next().value });
    } else {
      this.expectPunct('(');
      while (!this.isPunct(')')) {
        params.push(this.parsePattern());
        if (!this.eatPunct(',')) break;
      }
      this.expectPunct(')');
    }
    this.expectPunct('=>');

    // A block body would make this a statement language; templates stay
    // expression-only, so `{` here is an object literal.
    const body = this.parseAssignment();
    return { type: 'Arrow', params, body };
  }

  private parseConditional(): ExprNode {
    const test = this.parseBinary(0);
    if (!this.isPunct('?')) return test;
    this.index++;
    const consequent = this.parseAssignment();
    this.expectPunct(':');
    const alternate = this.parseAssignment();
    return { type: 'Conditional', test, consequent, alternate };
  }

  private parseBinary(minPrecedence: number): ExprNode {
    let left = this.parseUnary();

    for (;;) {
      const t = this.peek();
      const op = t.value;
      const isOperator =
        (t.type === 'punct' || t.type === 'keyword') &&
        Object.prototype.hasOwnProperty.call(BINARY_PRECEDENCE, op);
      if (!isOperator) break;

      const precedence = BINARY_PRECEDENCE[op]!;
      if (precedence < minPrecedence) break;

      this.index++;
      // `**` is the one right-associative binary operator.
      const right = this.parseBinary(op === '**' ? precedence : precedence + 1);
      left = LOGICAL_OPERATORS.has(op)
        ? { type: 'Logical', operator: op, left, right }
        : { type: 'Binary', operator: op, left, right };
    }

    return left;
  }

  private parseUnary(): ExprNode {
    const t = this.peek();
    if ((t.type === 'punct' || t.type === 'keyword') && UNARY_OPERATORS.has(t.value)) {
      this.index++;
      return { type: 'Unary', operator: t.value, argument: this.parseUnary() };
    }
    if (t.type === 'punct' && (t.value === '++' || t.value === '--')) {
      this.index++;
      return { type: 'Update', operator: t.value, argument: this.parseUnary(), prefix: true };
    }

    const argument = this.parseCallMember(this.parsePrimary());
    const post = this.peek();
    if (post.type === 'punct' && (post.value === '++' || post.value === '--')) {
      this.index++;
      return { type: 'Update', operator: post.value, argument, prefix: false };
    }
    return argument;
  }

  private parseCallMember(base: ExprNode): ExprNode {
    let node = base;
    for (;;) {
      if (this.eatPunct('.')) {
        const t = this.next();
        if (t.type !== 'ident' && t.type !== 'keyword') this.fail('Expected a property name');
        node = {
          type: 'Member',
          object: node,
          property: { type: 'Identifier', name: t.value, start: t.start, end: t.end },
          computed: false,
          optional: false,
        };
        continue;
      }

      if (this.isPunct('?.')) {
        this.index++;
        if (this.isPunct('(')) {
          node = { type: 'Call', callee: node, args: this.parseArguments(), optional: true };
        } else if (this.eatPunct('[')) {
          const property = this.parseSequence();
          this.expectPunct(']');
          node = { type: 'Member', object: node, property, computed: true, optional: true };
        } else {
          const t = this.next();
          if (t.type !== 'ident' && t.type !== 'keyword') this.fail('Expected a property name');
          node = {
            type: 'Member',
            object: node,
            property: { type: 'Identifier', name: t.value, start: t.start, end: t.end },
            computed: false,
            optional: true,
          };
        }
        continue;
      }

      if (this.eatPunct('[')) {
        const property = this.parseSequence();
        this.expectPunct(']');
        node = { type: 'Member', object: node, property, computed: true, optional: false };
        continue;
      }

      if (this.isPunct('(')) {
        node = { type: 'Call', callee: node, args: this.parseArguments(), optional: false };
        continue;
      }

      return node;
    }
  }

  private parseArguments(): ExprNode[] {
    this.expectPunct('(');
    const args: ExprNode[] = [];
    while (!this.isPunct(')')) {
      if (this.eatPunct('...')) {
        args.push({ type: 'Spread', argument: this.parseAssignment() });
      } else {
        args.push(this.parseAssignment());
      }
      if (!this.eatPunct(',')) break;
    }
    this.expectPunct(')');
    return args;
  }

  private parsePrimary(): ExprNode {
    const t = this.peek();

    switch (t.type) {
      case 'num': {
        this.index++;
        return { type: 'Literal', raw: t.value, value: Number(t.value.replace(/_/g, '')) };
      }
      case 'str': {
        this.index++;
        return { type: 'Literal', raw: t.value, value: t.parsed as string };
      }
      case 'regex': {
        this.index++;
        return { type: 'Literal', raw: t.value, value: undefined };
      }
      case 'template': {
        this.index++;
        const part = t.parsed as TemplatePart;
        return {
          type: 'TemplateLiteral',
          quasis: part.quasis,
          expressions: part.expressions.map((e) => parseExpression(e)),
        };
      }
      case 'ident': {
        this.index++;
        return { type: 'Identifier', name: t.value, start: t.start, end: t.end };
      }
      case 'keyword': {
        if (t.value === 'true' || t.value === 'false') {
          this.index++;
          return { type: 'Literal', raw: t.value, value: t.value === 'true' };
        }
        if (t.value === 'null') {
          this.index++;
          return { type: 'Literal', raw: 'null', value: null };
        }
        if (t.value === 'undefined') {
          this.index++;
          return { type: 'Literal', raw: 'undefined', value: undefined };
        }
        if (t.value === 'new') {
          this.index++;
          const callee = this.parseMemberOnly(this.parsePrimary());
          const args = this.isPunct('(') ? this.parseArguments() : [];
          return { type: 'New', callee, args };
        }
        this.fail(`\`${t.value}\` cannot start an expression`);
        break;
      }
      case 'punct': {
        if (t.value === '(') {
          this.index++;
          const node = this.parseSequence();
          this.expectPunct(')');
          return node;
        }
        if (t.value === '[') return this.parseArrayLiteral();
        if (t.value === '{') return this.parseObjectLiteral();
        this.fail(`Unexpected \`${t.value}\``);
        break;
      }
      case 'eof':
        this.fail('Unexpected end of expression');
    }

    this.fail(`Unexpected token \`${t.value}\``);
  }

  /** Member access only — `new a.b.C()` must not swallow the argument list. */
  private parseMemberOnly(base: ExprNode): ExprNode {
    let node = base;
    while (this.eatPunct('.')) {
      const t = this.next();
      if (t.type !== 'ident' && t.type !== 'keyword') this.fail('Expected a property name');
      node = {
        type: 'Member',
        object: node,
        property: { type: 'Identifier', name: t.value, start: t.start, end: t.end },
        computed: false,
        optional: false,
      };
    }
    return node;
  }

  private parseArrayLiteral(): ExprNode {
    this.expectPunct('[');
    const elements: (ExprNode | null)[] = [];
    while (!this.isPunct(']')) {
      if (this.isPunct(',')) {
        this.index++;
        elements.push(null); // hole
        continue;
      }
      if (this.eatPunct('...')) {
        elements.push({ type: 'Spread', argument: this.parseAssignment() });
      } else {
        elements.push(this.parseAssignment());
      }
      if (!this.eatPunct(',')) break;
    }
    this.expectPunct(']');
    return { type: 'Array', elements };
  }

  private parseObjectLiteral(): ExprNode {
    this.expectPunct('{');
    const properties: (ObjectProperty | SpreadNode)[] = [];

    while (!this.isPunct('}')) {
      if (this.eatPunct('...')) {
        properties.push({ type: 'Spread', argument: this.parseAssignment() });
        if (!this.eatPunct(',')) break;
        continue;
      }

      let key: ExprNode;
      let computed = false;

      if (this.eatPunct('[')) {
        key = this.parseAssignment();
        computed = true;
        this.expectPunct(']');
      } else {
        const t = this.next();
        if (t.type === 'str') key = { type: 'Literal', raw: t.value, value: t.parsed as string };
        else if (t.type === 'num') key = { type: 'Literal', raw: t.value, value: Number(t.value) };
        else if (t.type === 'ident' || t.type === 'keyword')
          key = { type: 'Identifier', name: t.value, start: t.start, end: t.end };
        else this.fail('Expected a property name');
      }

      if (this.eatPunct(':')) {
        properties.push({
          type: 'Property',
          key,
          value: this.parseAssignment(),
          computed,
          shorthand: false,
        });
      } else {
        if (computed || key.type !== 'Identifier') this.fail('Expected `:` after property name');
        properties.push({
          type: 'Property',
          key,
          value: key,
          computed: false,
          shorthand: true,
        });
      }

      if (!this.eatPunct(',')) break;
    }

    this.expectPunct('}');
    return { type: 'Object', properties };
  }

  // -- patterns -------------------------------------------------------------

  private parsePattern(): PatternNode {
    let pattern: PatternNode;

    if (this.eatPunct('...')) {
      return { type: 'RestPattern', argument: this.parsePattern() };
    }

    if (this.isPunct('[')) {
      this.index++;
      const elements: (PatternNode | null)[] = [];
      while (!this.isPunct(']')) {
        if (this.isPunct(',')) {
          this.index++;
          elements.push(null);
          continue;
        }
        elements.push(this.parsePattern());
        if (!this.eatPunct(',')) break;
      }
      this.expectPunct(']');
      pattern = { type: 'ArrayPattern', elements };
    } else if (this.isPunct('{')) {
      this.index++;
      const properties: { key: string; value: PatternNode; computed: boolean }[] = [];
      let rest: string | null = null;
      while (!this.isPunct('}')) {
        if (this.eatPunct('...')) {
          const t = this.next();
          if (t.type !== 'ident') this.fail('Expected a name after `...`');
          rest = t.value;
          if (!this.eatPunct(',')) break;
          continue;
        }
        const t = this.next();
        if (t.type !== 'ident' && t.type !== 'str' && t.type !== 'keyword') {
          this.fail('Expected a property name');
        }
        const key = t.type === 'str' ? (t.parsed as string) : t.value;
        if (this.eatPunct(':')) {
          properties.push({ key, value: this.parsePattern(), computed: false });
        } else {
          properties.push({
            key,
            value: { type: 'IdentifierPattern', name: key },
            computed: false,
          });
        }
        if (!this.eatPunct(',')) break;
      }
      this.expectPunct('}');
      pattern = { type: 'ObjectPattern', properties, rest };
    } else {
      const t = this.next();
      if (t.type !== 'ident') this.fail(`Expected a binding name but found \`${t.value}\``);
      pattern = { type: 'IdentifierPattern', name: t.value };
    }

    if (this.eatPunct('=')) {
      return { type: 'AssignmentPattern', left: pattern, right: this.parseAssignment() };
    }
    return pattern;
  }
}

export { ExpressionSyntaxError };
