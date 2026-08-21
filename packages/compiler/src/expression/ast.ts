/** AST for the JavaScript expression subset allowed inside templates. */

export type ExprNode =
  | IdentifierNode
  | LiteralNode
  | TemplateLiteralNode
  | MemberNode
  | CallNode
  | NewNode
  | UnaryNode
  | UpdateNode
  | BinaryNode
  | LogicalNode
  | ConditionalNode
  | AssignmentNode
  | ArrayNode
  | ObjectNode
  | ArrowNode
  | SpreadNode
  | SequenceNode;

export interface IdentifierNode {
  type: 'Identifier';
  name: string;
  /**
   * Where the name is written, as an offset into the expression source.
   *
   * Only identifiers carry one, and deliberately: an identifier is what a
   * type error is reported on — an unknown property, a name that does not
   * resolve — so this is the granularity a diagnostic needs to point back to
   * a column in the template. Wider nodes are located by the expression they
   * belong to.
   */
  start: number;
  end: number;
}

export interface LiteralNode {
  type: 'Literal';
  raw: string;
  value: string | number | boolean | null | undefined | RegExp;
}

export interface TemplateLiteralNode {
  type: 'TemplateLiteral';
  quasis: string[];
  expressions: ExprNode[];
}

export interface MemberNode {
  type: 'Member';
  object: ExprNode;
  property: ExprNode;
  computed: boolean;
  optional: boolean;
}

export interface CallNode {
  type: 'Call';
  callee: ExprNode;
  args: ExprNode[];
  optional: boolean;
}

export interface NewNode {
  type: 'New';
  callee: ExprNode;
  args: ExprNode[];
}

export interface UnaryNode {
  type: 'Unary';
  operator: string;
  argument: ExprNode;
}

export interface UpdateNode {
  type: 'Update';
  operator: string;
  argument: ExprNode;
  prefix: boolean;
}

export interface BinaryNode {
  type: 'Binary';
  operator: string;
  left: ExprNode;
  right: ExprNode;
}

export interface LogicalNode {
  type: 'Logical';
  operator: string;
  left: ExprNode;
  right: ExprNode;
}

export interface ConditionalNode {
  type: 'Conditional';
  test: ExprNode;
  consequent: ExprNode;
  alternate: ExprNode;
}

export interface AssignmentNode {
  type: 'Assignment';
  operator: string;
  left: ExprNode;
  right: ExprNode;
}

export interface ArrayNode {
  type: 'Array';
  elements: (ExprNode | null)[];
}

export interface ObjectProperty {
  /** Discriminant, so a property is distinguishable from a spread element. */
  type: 'Property';
  key: ExprNode;
  value: ExprNode;
  computed: boolean;
  shorthand: boolean;
}

export interface ObjectNode {
  type: 'Object';
  properties: (ObjectProperty | SpreadNode)[];
}

export interface ArrowNode {
  type: 'Arrow';
  params: PatternNode[];
  body: ExprNode;
}

export interface SpreadNode {
  type: 'Spread';
  argument: ExprNode;
}

export interface SequenceNode {
  type: 'Sequence';
  expressions: ExprNode[];
}

// --- Binding patterns (arrow params, `:for` bindings) ----------------------

export type PatternNode =
  | IdentifierPattern
  | ArrayPattern
  | ObjectPattern
  | RestPattern
  | AssignmentPattern;

export interface IdentifierPattern {
  type: 'IdentifierPattern';
  name: string;
}

export interface ArrayPattern {
  type: 'ArrayPattern';
  elements: (PatternNode | null)[];
}

export interface ObjectPatternProperty {
  key: string;
  value: PatternNode;
  computed: boolean;
}

export interface ObjectPattern {
  type: 'ObjectPattern';
  properties: ObjectPatternProperty[];
  rest: string | null;
}

export interface RestPattern {
  type: 'RestPattern';
  argument: PatternNode;
}

export interface AssignmentPattern {
  type: 'AssignmentPattern';
  left: PatternNode;
  right: ExprNode;
}

/** Collect every name a pattern binds, so scope tracking can shadow them. */
export function patternNames(pattern: PatternNode, out: string[] = []): string[] {
  switch (pattern.type) {
    case 'IdentifierPattern':
      out.push(pattern.name);
      break;
    case 'ArrayPattern':
      for (const el of pattern.elements) if (el) patternNames(el, out);
      break;
    case 'ObjectPattern':
      for (const p of pattern.properties) patternNames(p.value, out);
      if (pattern.rest) out.push(pattern.rest);
      break;
    case 'RestPattern':
      patternNames(pattern.argument, out);
      break;
    case 'AssignmentPattern':
      patternNames(pattern.left, out);
      break;
  }
  return out;
}
