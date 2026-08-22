/**
 * The schema: which node types exist, what may contain what, and where each
 * mark is allowed.
 *
 * **A document that violates its schema is refused at construction.** There is
 * no validate-afterwards path here, and that is a deliberate constraint rather
 * than a convenience. An editor that can hold an invalid document has to make
 * every later stage defensive — selection has to cope with a paragraph inside
 * a paragraph, the renderer has to decide what an unexpected node looks like,
 * and a collaborative merge has to decide whose invalid document wins. Refusing
 * at construction means every node that exists is legal in the place it sits,
 * and everything downstream may assume it.
 *
 * The two entry points that enforce it are `NodeType.create`, for documents a
 * caller builds by hand, and `NodeType.validContent`, which `replace` calls on
 * every node it rebuilds while applying a step. Between them there is no way
 * to obtain an invalid node: `Node.copy` bypasses the check, but it is only
 * reachable from inside a replace, whose result is checked before it is
 * returned.
 *
 * Normalisation is the other half of the same idea. Rather than rejecting a
 * list item because it holds bare text where the schema wants a paragraph,
 * `createAndFill` asks the content matcher what would make it legal and puts
 * that there. Adjacent identical marks and empty text nodes are handled a
 * layer down, in `Fragment.from`, because they are properties of any fragment
 * rather than of a particular schema.
 */

import { parseContentExpression, ContentMatch } from './content.js';
import { Fragment, Node } from './node.js';
import { Mark, type Attrs } from './mark.js';

/**
 * An attribute declaration. An attribute with no `default` is required, and a
 * node type that has one cannot be conjured by normalisation — there would be
 * nothing to put in it.
 */
export interface AttributeSpec {
  default?: unknown;
}

export interface NodeSpec {
  /** A content expression. Absent or empty means a leaf. */
  content?: string;
  /**
   * Which marks the *children* of this node may carry. `"_"` or absent (for a
   * node with inline content) allows everything, `""` allows nothing, and a
   * space-separated list of mark or group names allows those.
   */
  marks?: string;
  /** Space-separated group names, usable in other types' content expressions. */
  group?: string;
  inline?: boolean;
  /** A node with content that should nonetheless be treated as one unit. */
  atom?: boolean;
  attrs?: Record<string, AttributeSpec>;
  /**
   * A node whose identity a paste should preserve — a list item or a
   * blockquote, as opposed to a paragraph, which a paste happily merges into
   * its surroundings. Read by the replace algorithm's slice fitting.
   */
  defining?: boolean;
}

export interface MarkSpec {
  attrs?: Record<string, AttributeSpec>;
  /**
   * Whether typing at the mark's boundary continues it. True for emphasis,
   * false for a link — nobody wants the link to swallow the next word.
   * Defaults to true.
   */
  inclusive?: boolean;
  /**
   * Space-separated marks this one cannot coexist with. Absent means it
   * excludes only itself, which is what stops a link having two hrefs; `""`
   * means it coexists with everything including another copy of itself, and
   * `"_"` means it excludes every mark in the schema, which is what a code
   * span wants.
   */
  excludes?: string;
  group?: string;
}

export interface SchemaSpec {
  nodes: Record<string, NodeSpec>;
  marks?: Record<string, MarkSpec>;
  /** Defaults to `"doc"`, or to the first declared node type if there is none. */
  topNode?: string;
}

interface Attribute {
  readonly name: string;
  readonly hasDefault: boolean;
  readonly default: unknown;
}

function compileAttrs(specs: Record<string, AttributeSpec> | undefined): Attribute[] {
  if (!specs) return [];
  return Object.entries(specs).map(([name, spec]) => ({
    name,
    hasDefault: Object.hasOwn(spec, 'default'),
    default: spec.default,
  }));
}

/**
 * Fill in defaults and refuse anything the type does not declare.
 *
 * Unknown attributes are an error rather than being passed through, because
 * the alternative is a typo silently persisting into every saved document and
 * surfacing as "the heading level is undefined" a week later.
 */
function computeAttrs(attrs: Attribute[], given: Attrs | null, owner: string): Attrs {
  const out: Record<string, unknown> = {};

  for (const attr of attrs) {
    const supplied = given && Object.hasOwn(given, attr.name) ? given[attr.name] : undefined;
    if (supplied === undefined) {
      if (!attr.hasDefault) throw new RangeError(`No value supplied for the required attribute '${attr.name}' of ${owner}`);
      out[attr.name] = attr.default;
    } else {
      out[attr.name] = supplied;
    }
  }

  if (given) {
    for (const name in given) {
      if (!attrs.some((attr) => attr.name === name)) {
        throw new RangeError(`Unknown attribute '${name}' for ${owner}`);
      }
    }
  }

  return Object.freeze(out);
}

export class NodeType {
  readonly name: string;
  readonly schema: Schema;
  readonly spec: NodeSpec;
  readonly groups: readonly string[];
  readonly isInline: boolean;
  readonly isText: boolean;

  /** Assigned once every type exists, since expressions refer to each other. */
  contentMatch: ContentMatch = ContentMatch.empty;
  /** `null` means every mark is allowed on this node's children. */
  markSet: readonly MarkType[] | null = null;

  private readonly attrDefs: Attribute[];

  constructor(name: string, schema: Schema, spec: NodeSpec) {
    this.name = name;
    this.schema = schema;
    this.spec = spec;
    this.groups = spec.group ? spec.group.split(' ').filter(Boolean) : [];
    this.attrDefs = compileAttrs(spec.attrs);
    this.isText = name === 'text';
    this.isInline = this.isText || spec.inline === true;
  }

  /** Whether this type's content is inline, which is what makes a textblock. */
  get inlineContent(): boolean {
    const first = this.contentMatch.next[0];
    return first !== undefined && first.type.isInline;
  }

  get isBlock(): boolean {
    return !this.isInline;
  }

  get isTextblock(): boolean {
    return this.isBlock && this.inlineContent;
  }

  /** Nothing may be put inside it, so it occupies exactly one position. */
  get isLeaf(): boolean {
    return this.contentMatch === ContentMatch.empty;
  }

  /** A leaf, or a node the editor should treat as indivisible anyway. */
  get isAtom(): boolean {
    return this.isLeaf || this.spec.atom === true;
  }

  get hasRequiredAttrs(): boolean {
    return this.attrDefs.some((attr) => !attr.hasDefault);
  }

  get defaultAttrs(): Attrs {
    return computeAttrs(this.attrDefs, null, this.name);
  }

  allowsMarkType(markType: MarkType): boolean {
    return this.markSet === null || this.markSet.includes(markType);
  }

  allowsMarks(marks: readonly Mark[]): boolean {
    if (this.markSet === null) return true;
    return marks.every((mark) => this.allowsMarkType(mark.type));
  }

  /** The subset of `marks` this type permits, for a paste that carries extras. */
  allowedMarks(marks: readonly Mark[]): readonly Mark[] {
    if (this.markSet === null) return marks;
    return marks.filter((mark) => this.allowsMarkType(mark.type));
  }

  /**
   * Whether a fragment is legal as this type's content: the right sequence of
   * child types, ending somewhere the expression allows stopping, with no
   * child carrying a mark this type forbids.
   */
  validContent(content: Fragment): boolean {
    const match = this.contentMatch.matchFragment(content);
    if (!match || !match.validEnd) return false;
    for (let i = 0; i < content.childCount; i++) {
      if (!this.allowsMarks(content.child(i).marks)) return false;
    }
    return true;
  }

  /**
   * Create a node, refusing anything the schema does not permit.
   *
   * This is the checked path and the only one exported. Content that does not
   * satisfy the expression throws here, naming the type and what it got, which
   * is a far better failure than the same document being rejected three edits
   * later by a step nobody connects to the mistake.
   */
  create(attrs: Attrs | null = null, content?: Fragment | Node | readonly Node[] | null, marks?: readonly Mark[] | Mark | null): Node {
    if (this.isText) throw new TypeError('Use Schema.text to create text nodes');

    const fragment = Fragment.from(content);
    if (!this.validContent(fragment)) {
      throw new RangeError(`Invalid content for node ${this.name}: ${fragment.toString() || '(empty)'}`);
    }

    return new Node(this, computeAttrs(this.attrDefs, attrs, this.name), fragment, Mark.setFrom(marks));
  }

  /**
   * Create a node, adding whatever the schema requires to make the content
   * legal — the "a block required to hold a paragraph gets one" rule.
   *
   * Filling happens before and after the given content, so a list item created
   * empty gets its paragraph, and a blockquote given a bare heading where the
   * schema wants a heading followed by a paragraph gets the paragraph too.
   * Returns `null` when no filling can rescue it.
   */
  createAndFill(attrs: Attrs | null = null, content?: Fragment | Node | readonly Node[] | null, marks?: readonly Mark[] | Mark | null): Node | null {
    let fragment = Fragment.from(content);

    if (fragment.size > 0 || fragment.childCount > 0) {
      const before = this.contentMatch.fillBefore(fragment);
      if (!before) return null;
      fragment = before.append(fragment);
    }

    const match = this.contentMatch.matchFragment(fragment);
    if (!match) return null;
    const after = match.fillBefore(Fragment.empty, true);
    if (!after) return null;

    const filled = fragment.append(after);
    if (!this.allowsMarksOfChildren(filled)) return null;

    return new Node(this, computeAttrs(this.attrDefs, attrs, this.name), filled, Mark.setFrom(marks));
  }

  private allowsMarksOfChildren(content: Fragment): boolean {
    for (let i = 0; i < content.childCount; i++) {
      if (!this.allowsMarks(content.child(i).marks)) return false;
    }
    return true;
  }
}

export class MarkType {
  readonly name: string;
  readonly schema: Schema;
  readonly spec: MarkSpec;
  /**
   * Position in the schema's mark list, and the sort key for mark sets. Two
   * sets holding the same marks must be the same array in the same order or
   * `Mark.sameSet` — which decides whether two text runs merge — would depend
   * on the order they were applied in.
   */
  readonly rank: number;
  readonly groups: readonly string[];
  readonly inclusive: boolean;

  /** Resolved after all mark types exist, since `excludes` names them. */
  excluded: readonly MarkType[] = [];

  private readonly attrDefs: Attribute[];

  constructor(name: string, rank: number, schema: Schema, spec: MarkSpec) {
    this.name = name;
    this.rank = rank;
    this.schema = schema;
    this.spec = spec;
    this.groups = spec.group ? spec.group.split(' ').filter(Boolean) : [];
    this.inclusive = spec.inclusive !== false;
    this.attrDefs = compileAttrs(spec.attrs);
  }

  get hasRequiredAttrs(): boolean {
    return this.attrDefs.some((attr) => !attr.hasDefault);
  }

  create(attrs: Attrs | null = null): Mark {
    return new Mark(this, computeAttrs(this.attrDefs, attrs, this.name));
  }

  excludes(other: MarkType): boolean {
    return this.excluded.includes(other);
  }

  /** The instance of this type in a set, if any — how a link's href is read. */
  isInSet(set: readonly Mark[]): Mark | null {
    return set.find((mark) => mark.type === this) ?? null;
  }
}

export class Schema {
  readonly spec: SchemaSpec;
  readonly nodes: Readonly<Record<string, NodeType>>;
  readonly marks: Readonly<Record<string, MarkType>>;
  readonly topNodeType: NodeType;

  constructor(spec: SchemaSpec) {
    this.spec = spec;

    const nodes: Record<string, NodeType> = Object.create(null);
    for (const [name, nodeSpec] of Object.entries(spec.nodes)) {
      nodes[name] = new NodeType(name, this, nodeSpec);
    }

    const marks: Record<string, MarkType> = Object.create(null);
    let rank = 0;
    for (const [name, markSpec] of Object.entries(spec.marks ?? {})) {
      marks[name] = new MarkType(name, rank++, this, markSpec);
    }

    this.nodes = nodes;
    this.marks = marks;

    if (!nodes['text']) throw new RangeError('A schema must declare a "text" node type');

    const topName = spec.topNode ?? 'doc';
    const top = nodes[topName];
    if (!top) throw new RangeError(`The schema's top node type '${topName}' is not declared`);
    this.topNodeType = top;

    // Content expressions and mark exclusions both refer to types by name, so
    // they can only be resolved once every type object exists.
    for (const type of Object.values(nodes)) {
      type.contentMatch = parseContentExpression(type.spec.content ?? '', type.name, (name) =>
        this.typesMatching(name),
      );
    }
    for (const type of Object.values(nodes)) {
      type.markSet = this.resolveMarkSet(type);
    }
    for (const mark of Object.values(marks)) {
      const excludes = mark.spec.excludes;
      mark.excluded =
        excludes === undefined
          ? [mark]
          : excludes === ''
            ? []
            : excludes === '_'
              ? Object.values(marks)
              : this.marksMatching(excludes, mark.name);
    }
  }

  /** Node types named directly, or every member of a group of that name. */
  private typesMatching(name: string): NodeType[] {
    const direct = this.nodes[name];
    if (direct) return [direct];
    return Object.values(this.nodes).filter((type) => type.groups.includes(name));
  }

  private marksMatching(expression: string, owner: string): MarkType[] {
    const found: MarkType[] = [];
    for (const name of expression.split(' ').filter(Boolean)) {
      const direct = this.marks[name];
      if (direct) {
        found.push(direct);
        continue;
      }
      const group = Object.values(this.marks).filter((mark) => mark.groups.includes(name));
      if (group.length === 0) throw new RangeError(`No mark type or group named '${name}', referenced by ${owner}`);
      found.push(...group);
    }
    return found;
  }

  private resolveMarkSet(type: NodeType): readonly MarkType[] | null {
    const expression = type.spec.marks;
    if (expression === '_') return null;
    if (expression) return this.marksMatching(expression, type.name);
    if (expression === '') return [];
    // No declaration: a node holding inline content allows every mark, and one
    // holding blocks allows none, since a mark on a paragraph means nothing.
    return type.inlineContent ? null : [];
  }

  /** Create a node of the named type, checked against the schema. */
  node(
    name: string,
    attrs: Attrs | null = null,
    content?: Fragment | Node | readonly Node[] | null,
    marks?: readonly Mark[] | Mark | null,
  ): Node {
    return this.nodeType(name).create(attrs, content, marks);
  }

  /**
   * Create a text node.
   *
   * Empty text is not an error here — it is simply nothing, and any fragment
   * it lands in drops it. Callers slicing text at a boundary produce empty
   * strings constantly, and making each of them check first would be noise.
   */
  text(text: string, marks?: readonly Mark[] | Mark | null): Node {
    const type = this.nodeType('text');
    return new Node(type, type.defaultAttrs, null, Mark.setFrom(marks), text);
  }

  mark(name: string, attrs: Attrs | null = null): Mark {
    const type = this.marks[name];
    if (!type) throw new RangeError(`There is no mark type '${name}' in this schema`);
    return type.create(attrs);
  }

  nodeType(name: string): NodeType {
    const type = this.nodes[name];
    if (!type) throw new RangeError(`There is no node type '${name}' in this schema`);
    return type;
  }
}
