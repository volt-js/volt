/**
 * Resolving a position.
 *
 * A position is one integer (node.ts explains why), which means it carries no
 * context: `7` does not say whether it is inside a paragraph, between two list
 * items, or immediately before an image. Resolution recovers that by walking
 * from the document root down to the position, recording what it passed
 * through. Everything that needs to know *where* it is — selection validity,
 * mark inheritance, the DOM bridge, the replace algorithm — works from a
 * `ResolvedPos` rather than from the integer.
 *
 * The walk is O(depth), which for real documents is three or four steps. That
 * cost is the whole price of flat positions, and it is paid at the moment a
 * position is used rather than at the moment it is stored or mapped. Mapping,
 * which happens far more often — once per step per position, and once per step
 * per position again for every step rebased in a collaborative session — stays
 * integer arithmetic.
 */

import { Mark } from './mark.js';
import type { Node } from './node.js';

/**
 * One level of the walk. `childStart` is the absolute position at which the
 * child named by `index` begins, which is the number every derived coordinate
 * on `ResolvedPos` is computed from.
 */
interface PathEntry {
  readonly node: Node;
  readonly index: number;
  readonly childStart: number;
}

export class ResolvedPos {
  readonly pos: number;
  readonly parentOffset: number;
  private readonly path: readonly PathEntry[];

  private constructor(pos: number, path: readonly PathEntry[], parentOffset: number) {
    this.pos = pos;
    this.path = path;
    this.parentOffset = parentOffset;
  }

  /**
   * Walk from `doc` to `pos`.
   *
   * The loop descends while there is a remainder left over after landing on a
   * child boundary. It stops on a text node without descending into it,
   * because a text node has no children to walk — the remainder becomes
   * `textOffset` instead.
   */
  static resolve(doc: Node, pos: number): ResolvedPos {
    if (!(pos >= 0 && pos <= doc.content.size)) {
      throw new RangeError(`Position ${pos} is outside a document of size ${doc.content.size}`);
    }

    const path: PathEntry[] = [];
    let node = doc;
    let contentStart = 0;
    let parentOffset = pos;

    for (;;) {
      const { index, offset } = node.content.findIndex(parentOffset);
      const remainder = parentOffset - offset;
      path.push({ node, index, childStart: contentStart + offset });

      if (remainder === 0) break;

      const child = node.child(index);
      if (child.isText) break;

      node = child;
      parentOffset = remainder - 1;
      contentStart += offset + 1;
    }

    return new ResolvedPos(pos, path, parentOffset);
  }

  /** How many nodes deep the position sits. Zero is directly in the document. */
  get depth(): number {
    return this.path.length - 1;
  }

  /** Negative depths count from the position outwards, as array slicing does. */
  private resolveDepth(depth?: number): number {
    if (depth === undefined) return this.depth;
    return depth < 0 ? this.depth + depth : depth;
  }

  private entry(depth: number): PathEntry {
    const found = this.path[depth];
    if (!found) throw new RangeError(`Depth ${depth} is outside this position's path`);
    return found;
  }

  node(depth?: number): Node {
    return this.entry(this.resolveDepth(depth)).node;
  }

  /** The index, in the node at `depth`, of the child the position is in or before. */
  index(depth?: number): number {
    return this.entry(this.resolveDepth(depth)).index;
  }

  /**
   * The index of the first child entirely after the position.
   *
   * The same as `index` when the position sits exactly on a child boundary,
   * and one more when it is inside a child — which is the difference between
   * "insert here" and "the node I am inside of".
   */
  indexAfter(depth?: number): number {
    const at = this.resolveDepth(depth);
    return this.index(at) + (at === this.depth && this.textOffset === 0 ? 0 : 1);
  }

  /** The first position inside the node at `depth`. */
  start(depth?: number): number {
    const at = this.resolveDepth(depth);
    return at === 0 ? 0 : this.entry(at - 1).childStart + 1;
  }

  /** The last position inside the node at `depth`. */
  end(depth?: number): number {
    const at = this.resolveDepth(depth);
    return this.start(at) + this.node(at).content.size;
  }

  /** The position directly before the node at `depth`. */
  before(depth?: number): number {
    const at = this.resolveDepth(depth);
    if (at === 0) throw new RangeError('There is no position before the document');
    if (at === this.depth + 1) return this.pos;
    return this.entry(at - 1).childStart;
  }

  /** The position directly after the node at `depth`. */
  after(depth?: number): number {
    const at = this.resolveDepth(depth);
    if (at === 0) throw new RangeError('There is no position after the document');
    if (at === this.depth + 1) return this.pos;
    return this.entry(at - 1).childStart + this.node(at).nodeSize;
  }

  get parent(): Node {
    return this.node(this.depth);
  }

  get doc(): Node {
    return this.node(0);
  }

  /** How far into the text node the position sits; zero if it is on a boundary. */
  get textOffset(): number {
    return this.pos - this.entry(this.depth).childStart;
  }

  /**
   * The node beginning at this position, cut if the position is inside it.
   *
   * Cutting matters: a position halfway through "hello" has "llo" after it,
   * not the whole word, and code deciding what a right-arrow key steps over
   * needs the piece rather than the node.
   */
  get nodeAfter(): Node | null {
    const parent = this.parent;
    const index = this.index(this.depth);
    if (index === parent.childCount) return null;
    const offset = this.textOffset;
    const child = parent.child(index);
    return offset > 0 ? child.cut(offset) : child;
  }

  get nodeBefore(): Node | null {
    const index = this.index(this.depth);
    const offset = this.textOffset;
    if (offset > 0) return this.parent.child(index).cut(0, offset);
    return index === 0 ? null : this.parent.child(index - 1);
  }

  /**
   * The marks a character typed here would carry.
   *
   * Inside a text node this is simply that node's marks. On a boundary it is
   * the marks of the node before, minus any non-inclusive mark that does not
   * continue into the node after — which is exactly the rule that stops typing
   * at the end of a link from extending the link, while typing at the end of
   * a bold run stays bold.
   */
  marks(): readonly Mark[] {
    const parent = this.parent;
    const index = this.index();

    if (parent.content.size === 0) return Mark.none;
    if (this.textOffset > 0) return parent.child(index).marks;

    const before = parent.maybeChild(index - 1);
    const after = parent.maybeChild(index);
    const source = before ?? after;
    if (!source) return Mark.none;

    const neighbour = before ? after : null;
    let marks = source.marks;
    for (const mark of source.marks) {
      if (!mark.type.inclusive && (!neighbour || !mark.isInSet(neighbour.marks))) {
        marks = mark.removeFromSet(marks);
      }
    }
    return marks;
  }

  /** Whether two positions sit directly in the same node. */
  sameParent(other: ResolvedPos): boolean {
    return this.pos - this.parentOffset === other.pos - other.parentOffset;
  }

  /** The deepest node containing both this position and `pos`. */
  sharedDepth(pos: number): number {
    for (let depth = this.depth; depth > 0; depth--) {
      if (this.start(depth) <= pos && this.end(depth) >= pos) return depth;
    }
    return 0;
  }

  toString(): string {
    let path = '';
    for (let depth = 1; depth <= this.depth; depth++) {
      path += `${path ? '/' : ''}${this.node(depth).type.name}_${this.index(depth - 1)}`;
    }
    return `${path}:${this.parentOffset}`;
  }
}

/** Convenience for the common `ResolvedPos.resolve(doc, pos)`. */
export function resolve(doc: Node, pos: number): ResolvedPos {
  return ResolvedPos.resolve(doc, pos);
}
