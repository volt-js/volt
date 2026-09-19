/**
 * The document itself: fragments, nodes and slices.
 *
 * **Positions are flat integers, not paths.** This is the decision the rest of
 * the package is built on, so it is worth the paragraph.
 *
 * A path — `[0, 2, 5]`, meaning child 0, then child 2, then offset 5 — is the
 * obvious addressing scheme for a tree, and it is the wrong one here. Three
 * things a text editor does constantly are hard with paths and easy with
 * integers. Comparing two positions to find which comes first is a
 * lexicographic walk over two arrays rather than `a < b`. Mapping a position
 * through a change is the whole problem: an insertion three blocks earlier
 * shifts an integer by a known amount and leaves a path's tail alone but
 * rewrites its head, so every step would have to describe its effect on paths
 * of every depth. And a selection is two positions that must stay ordered and
 * comparable across every edit, including edits arriving from somewhere else.
 *
 * So a position is a single integer, counted as a walk through the document's
 * token stream:
 *
 *   0   1 2 3 4    5   6 7 8 9    10
 *    <p> a b c </p> <p> d e f </p>
 *
 * Entering or leaving a non-leaf node costs one, each character of text costs
 * one, and a leaf node — an image, a horizontal rule — costs one for the whole
 * node. That gives `nodeSize` below: `text.length` for text, `1` for a leaf,
 * and `2 + content.size` for anything that can be entered.
 *
 * The price is that a position on its own says nothing about where it is; you
 * must walk from the root to find out. That is `resolve` in position.ts, which
 * is O(depth) and is the single most-called function in the package. The trade
 * is deliberate: resolution is cheap and local, whereas mapping paths through
 * a stream of steps is neither.
 *
 * **Normalisation happens at construction.** `Fragment.from` merges adjacent
 * text nodes carrying the same mark set and drops empty ones. It is here, in
 * the constructor path that every other operation goes through, rather than in
 * a `normalize()` a caller might forget: two text nodes that only differ by
 * having been stored separately would otherwise compare unequal, and every
 * position-mapping test in the package would depend on which code path built
 * the fragment.
 */

import { Mark, type Attrs } from './mark.js';
import type { NodeType } from './schema.js';

/**
 * An ordered run of nodes, and the unit that node content is stored in.
 *
 * Fragments are immutable and share structure freely — `cut` and `append`
 * return new fragments over the same child nodes, never copies of the nodes
 * themselves. That is what makes an undo stack of whole documents affordable:
 * two documents differing by one keystroke share every block but one.
 */
export class Fragment {
  readonly content: readonly Node[];
  /** Total position span of the children, which is the parent's `contentSize`. */
  readonly size: number;

  private constructor(content: readonly Node[], size: number) {
    this.content = content;
    this.size = size;
    Object.freeze(this);
  }

  static readonly empty: Fragment = new Fragment(Object.freeze([]), 0);

  /**
   * Build a fragment, normalising as we go.
   *
   * Empty text nodes are dropped outright: they occupy no positions, so they
   * are invisible to every position calculation while still being visible to
   * `childCount`, which is exactly the sort of discrepancy that makes a tree
   * walk and a position walk disagree. Adjacent text nodes with equal mark
   * sets are joined, which is the "adjacent identical marks merge" rule — the
   * marks are on the text, so merging the text is how marks merge.
   */
  static from(nodes: Node | readonly Node[] | Fragment | null | undefined): Fragment {
    if (!nodes) return Fragment.empty;
    if (nodes instanceof Fragment) return nodes;
    if (nodes instanceof Node) return Fragment.fromArray([nodes]);
    return Fragment.fromArray(nodes);
  }

  private static fromArray(nodes: readonly Node[]): Fragment {
    if (nodes.length === 0) return Fragment.empty;

    const out: Node[] = [];
    let size = 0;

    for (const node of nodes) {
      if (node.isText) {
        if (node.text!.length === 0) continue;

        const last = out.length > 0 ? out[out.length - 1]! : null;
        if (last && last.isText && Mark.sameSet(last.marks, node.marks)) {
          out[out.length - 1] = last.withText(last.text! + node.text!);
          size += node.text!.length;
          continue;
        }
      }
      out.push(node);
      size += node.nodeSize;
    }

    if (out.length === 0) return Fragment.empty;
    return new Fragment(Object.freeze(out), size);
  }

  get childCount(): number {
    return this.content.length;
  }

  get firstChild(): Node | null {
    return this.content.length > 0 ? this.content[0]! : null;
  }

  get lastChild(): Node | null {
    return this.content.length > 0 ? this.content[this.content.length - 1]! : null;
  }

  child(index: number): Node {
    const found = this.content[index];
    if (!found) throw new RangeError(`No child at index ${index} in a fragment of ${this.childCount}`);
    return found;
  }

  maybeChild(index: number): Node | null {
    return this.content[index] ?? null;
  }

  forEach(f: (node: Node, offset: number, index: number) => void): void {
    let offset = 0;
    for (let i = 0; i < this.content.length; i++) {
      const child = this.content[i]!;
      f(child, offset, i);
      offset += child.nodeSize;
    }
  }

  /**
   * Which child covers a content offset, and where that child starts.
   *
   * The boundary between two children belongs to neither: an offset landing
   * exactly on a child's start reports that child at index `i` with
   * `offset === pos`, which is what a caller inserting *before* it wants.
   */
  findIndex(pos: number): { index: number; offset: number } {
    if (pos === 0) return { index: 0, offset: 0 };
    if (pos === this.size) return { index: this.childCount, offset: this.size };
    if (pos < 0 || pos > this.size) throw new RangeError(`Offset ${pos} outside of a fragment of size ${this.size}`);

    let offset = 0;
    for (let i = 0; i < this.content.length; i++) {
      const end = offset + this.content[i]!.nodeSize;
      if (end >= pos) return { index: end === pos ? i + 1 : i, offset: end === pos ? end : offset };
      offset = end;
    }
    throw new RangeError(`Offset ${pos} not found in fragment`);
  }

  /**
   * The sub-run between two content offsets, splitting text nodes as needed.
   *
   * Cutting through a non-text node keeps that node and cuts its content
   * recursively, which is what makes a slice of "the second half of one
   * paragraph and the first half of the next" expressible at all.
   */
  cut(from: number, to: number = this.size): Fragment {
    if (from === 0 && to === this.size) return this;
    if (from === to) return Fragment.empty;

    const result: Node[] = [];
    let pos = 0;

    for (const child of this.content) {
      const end = pos + child.nodeSize;
      if (end > from) {
        if (pos >= from && end <= to) {
          result.push(child);
        } else if (child.isText) {
          const start = Math.max(0, from - pos);
          result.push(child.withText(child.text!.slice(start, Math.min(child.text!.length, to - pos))));
        } else {
          // Cutting into a node: keep the node, recurse into its content with
          // the boundaries moved past its opening token.
          const inner = child.content.cut(
            Math.max(0, from - pos - 1),
            Math.min(child.content.size, to - pos - 1),
          );
          result.push(child.copy(inner));
        }
      }
      pos = end;
      if (pos >= to) break;
    }

    return Fragment.fromArray(result);
  }

  append(other: Fragment): Fragment {
    if (other.size === 0) return this;
    if (this.size === 0) return other;
    return Fragment.fromArray([...this.content, ...other.content]);
  }

  replaceChild(index: number, node: Node): Fragment {
    const current = this.child(index);
    if (current === node) return this;
    const next = this.content.slice();
    next[index] = node;
    return Fragment.fromArray(next);
  }

  addToStart(node: Node): Fragment {
    return Fragment.fromArray([node, ...this.content]);
  }

  addToEnd(node: Node): Fragment {
    return Fragment.fromArray([...this.content, node]);
  }

  eq(other: Fragment): boolean {
    if (this === other) return true;
    if (this.childCount !== other.childCount) return false;
    return this.content.every((child, i) => child.eq(other.content[i]!));
  }

  /**
   * Visit every node overlapping a content range.
   *
   * `nodeStart` is the position of the visited node's own opening token,
   * measured in the coordinate space of whatever `parentStart` was given, so a
   * caller walking a whole document gets absolute document positions back.
   * Returning `false` from `f` skips that node's children.
   */
  nodesBetween(
    from: number,
    to: number,
    f: (node: Node, pos: number, parent: Node | null, index: number) => boolean | void,
    parentStart: number,
    parent: Node | null,
  ): void {
    let pos = 0;
    for (let i = 0; i < this.content.length; i++) {
      const child = this.content[i]!;
      const end = pos + child.nodeSize;
      if (end > from && pos < to) {
        const descend = f(child, parentStart + pos, parent, i);
        if (descend !== false && child.content.size > 0) {
          child.content.nodesBetween(
            Math.max(0, from - pos - 1),
            Math.min(child.content.size, to - pos - 1),
            f,
            parentStart + pos + 1,
            child,
          );
        }
      }
      pos = end;
      if (pos >= to) break;
    }
  }

  /** The plain text of a range, with `blockSeparator` between block boundaries. */
  textBetween(from: number, to: number, blockSeparator: string): string {
    let text = '';
    let separated = true;

    this.nodesBetween(
      from,
      to,
      (node, pos) => {
        if (node.isText) {
          const start = Math.max(from, pos) - pos;
          text += node.text!.slice(start, Math.min(node.text!.length, to - pos));
          separated = false;
        } else if (node.isBlock && !separated) {
          text += blockSeparator;
          separated = true;
        }
      },
      0,
      null,
    );

    return text;
  }

  toString(): string {
    return this.content.map((child) => child.toString()).join(', ');
  }
}

/**
 * A node in the document.
 *
 * Immutable in the strong sense: every field is frozen, and every operation
 * that looks like a mutation returns a new node sharing everything it did not
 * change. This is the property the roadmap says cannot be added afterwards. A
 * model that mutates in place has no way to describe *what changed* other than
 * "look again", and a collaborative rebase, an undo stack, and a position map
 * all need exactly that description.
 */
export class Node {
  readonly type: NodeType;
  readonly attrs: Attrs;
  readonly content: Fragment;
  readonly marks: readonly Mark[];
  /** Present only on text nodes, and never empty — `Fragment.from` drops those. */
  readonly text: string | undefined;

  constructor(
    type: NodeType,
    attrs: Attrs,
    content: Fragment | null,
    marks: readonly Mark[],
    text?: string,
  ) {
    this.type = type;
    this.attrs = attrs;
    this.content = content ?? Fragment.empty;
    this.marks = marks;
    this.text = text;
    Object.freeze(this);
  }

  get isText(): boolean {
    return this.text !== undefined;
  }

  get isInline(): boolean {
    return this.type.isInline;
  }

  get isBlock(): boolean {
    return !this.type.isInline;
  }

  /** A node that holds inline content — a paragraph or a heading. */
  get isTextblock(): boolean {
    return this.type.isTextblock;
  }

  get inlineContent(): boolean {
    return this.type.inlineContent;
  }

  /** A node with no addressable inside: an image, a hard break, a rule. */
  get isLeaf(): boolean {
    return this.type.isLeaf;
  }

  get childCount(): number {
    return this.content.childCount;
  }

  get firstChild(): Node | null {
    return this.content.firstChild;
  }

  get lastChild(): Node | null {
    return this.content.lastChild;
  }

  child(index: number): Node {
    return this.content.child(index);
  }

  maybeChild(index: number): Node | null {
    return this.content.maybeChild(index);
  }

  /** How many positions the node's content spans, excluding its own tokens. */
  get contentSize(): number {
    return this.content.size;
  }

  /**
   * How many positions the node occupies in its parent.
   *
   * Text is its length. A leaf is one — there is nowhere inside it to put a
   * cursor, so it gets no interior positions. Everything else is its content
   * plus the two tokens for entering and leaving it.
   */
  get nodeSize(): number {
    if (this.isText) return this.text!.length;
    if (this.isLeaf) return 1;
    return 2 + this.content.size;
  }

  copy(content: Fragment | null = null): Node {
    if (content === this.content) return this;
    return new Node(this.type, this.attrs, content, this.marks, this.text);
  }

  mark(marks: readonly Mark[]): Node {
    if (marks === this.marks) return this;
    return new Node(this.type, this.attrs, this.content, marks, this.text);
  }

  withText(text: string): Node {
    if (!this.isText) throw new TypeError(`Cannot set text on a ${this.type.name} node`);
    if (text === this.text) return this;
    return new Node(this.type, this.attrs, this.content, this.marks, text);
  }

  /** A copy of this node with different attributes, validated by the schema. */
  withAttrs(attrs: Attrs): Node {
    return this.type.create(attrs, this.content, this.marks);
  }

  /** The node's own content, cut to a content-offset range. */
  cut(from: number, to?: number): Node {
    // A text node's extent is its string, and its `content` is empty — so a
    // `to` defaulting to `content.size` would be zero, and every open-ended
    // cut of text would come back as the empty string rather than the tail
    // that was asked for.
    if (this.isText) return this.withText(this.text!.slice(from, to ?? this.text!.length));
    const end = to ?? this.content.size;
    if (from === 0 && end === this.content.size) return this;
    return this.copy(this.content.cut(from, end));
  }

  nodesBetween(
    from: number,
    to: number,
    f: (node: Node, pos: number, parent: Node | null, index: number) => boolean | void,
    startPos = 0,
  ): void {
    this.content.nodesBetween(from, to, f, startPos, this);
  }

  textBetween(from: number, to: number, blockSeparator = '\n\n'): string {
    return this.content.textBetween(from, to, blockSeparator);
  }

  get textContent(): string {
    return this.isText ? this.text! : this.textBetween(0, this.content.size, '');
  }

  eq(other: Node): boolean {
    return this === other || (this.sameMarkup(other) && this.content.eq(other.content));
  }

  /** Same type, same attributes, same marks — differing only in content. */
  sameMarkup(other: Node): boolean {
    return (
      this.type === other.type &&
      this.text === other.text &&
      sameAttrsShallow(this.attrs, other.attrs) &&
      Mark.sameSet(this.marks, other.marks)
    );
  }

  toString(): string {
    if (this.isText) {
      const quoted = JSON.stringify(this.text);
      return this.marks.reduce((inner, mark) => `${mark.type.name}(${inner})`, quoted);
    }
    const inner = this.content.size > 0 ? `(${this.content.toString()})` : '';
    return this.type.name + inner;
  }
}

function sameAttrsShallow(a: Attrs, b: Attrs): boolean {
  if (a === b) return true;
  for (const key in a) if (a[key] !== b[key]) return false;
  for (const key in b) if (!(key in a)) return false;
  return true;
}

/**
 * A piece cut out of a document, remembering how deeply it was cut open.
 *
 * A flat fragment cannot express "the end of one paragraph and the start of
 * the next": as a fragment that is two paragraphs, and pasting it would
 * produce two paragraphs rather than joining onto the ones already there.
 * `openStart` and `openEnd` record how many node boundaries at each edge were
 * cut through rather than crossed, so a replace knows which of the slice's
 * outermost nodes should be joined with what is already at the insertion point
 * and which should stand on their own.
 */
export class Slice {
  readonly content: Fragment;
  readonly openStart: number;
  readonly openEnd: number;

  constructor(content: Fragment, openStart: number, openEnd: number) {
    this.content = content;
    this.openStart = openStart;
    this.openEnd = openEnd;
    Object.freeze(this);
  }

  static readonly empty: Slice = new Slice(Fragment.empty, 0, 0);

  /** Positions this slice inserts, which is what a step map's new size is. */
  get size(): number {
    return this.content.size - this.openStart - this.openEnd;
  }

  eq(other: Slice): boolean {
    return (
      this.openStart === other.openStart &&
      this.openEnd === other.openEnd &&
      this.content.eq(other.content)
    );
  }

  toString(): string {
    return `${this.content.toString()}(${this.openStart},${this.openEnd})`;
  }
}
