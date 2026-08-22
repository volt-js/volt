/**
 * Marks — the formatting that rides on inline content rather than containing
 * it.
 *
 * Bold, italic, a link. They are not nodes because they overlap: a sentence
 * can be bold from word two and a link from word four, and a tree cannot hold
 * two ranges that cross without splitting one of them arbitrarily. Making them
 * a property of the text node instead means the split happens where the
 * formatting actually changes, and "bold" and "link" have no opinion about
 * which of them is nested inside the other.
 *
 * A mark is immutable and compared by value, which is what lets normalisation
 * merge adjacent text nodes: `sameSet` decides whether two runs of text are
 * really one run that happens to be stored twice.
 */

import type { MarkType } from './schema.js';

/**
 * Attribute values are whatever a schema declares. Kept as `unknown` rather
 * than a union of primitives because a link's attrs might reasonably hold a
 * parsed structure, and the schema is the thing that knows.
 */
export type Attrs = Readonly<Record<string, unknown>>;

/**
 * Shallow structural comparison, which is all attribute comparison can be
 * without knowing what the values mean. A schema that puts a mutable object in
 * an attribute is already outside what this model can compare, and the
 * documentation on `NodeType.create` says so.
 */
export function sameAttrs(a: Attrs, b: Attrs): boolean {
  if (a === b) return true;
  for (const key in a) if (a[key] !== b[key]) return false;
  for (const key in b) if (!(key in a)) return false;
  return true;
}

export class Mark {
  readonly type: MarkType;
  readonly attrs: Attrs;

  constructor(type: MarkType, attrs: Attrs) {
    this.type = type;
    this.attrs = attrs;
    Object.freeze(this);
  }

  eq(other: Mark): boolean {
    return this === other || (this.type === other.type && sameAttrs(this.attrs, other.attrs));
  }

  /**
   * Add this mark to a set, returning a new set.
   *
   * Sets are kept sorted by the type's rank — its position in the schema's
   * mark list — so that two sets holding the same marks are always the same
   * array in the same order. Without that, `sameSet` would have to sort on
   * every call, and it is called once per adjacent text node pair in every
   * normalisation.
   *
   * A mark whose type is already present replaces it rather than joining it: a
   * link cannot have two hrefs. `excludes` extends the same rule across types,
   * which is how `code` throws off `em` when the schema says a code span holds
   * no other formatting.
   */
  addToSet(set: readonly Mark[]): readonly Mark[] {
    let copy: Mark[] | null = null;
    let placed = false;

    for (let i = 0; i < set.length; i++) {
      const other = set[i]!;

      if (this.eq(other)) return set;

      if (this.type.excludes(other.type)) {
        // Dropping something. The result differs from `set`, so materialise a
        // copy of everything kept so far and carry on filtering.
        if (!copy) copy = set.slice(0, i);
      } else if (other.type.excludes(this.type)) {
        // The set refuses this mark outright, rather than making room for it.
        return set;
      } else {
        if (!placed && other.type.rank > this.type.rank) {
          if (!copy) copy = set.slice(0, i);
          copy.push(this);
          placed = true;
        }
        if (copy) copy.push(other);
      }
    }

    if (!copy) copy = set.slice();
    if (!placed) copy.push(this);
    return copy;
  }

  removeFromSet(set: readonly Mark[]): readonly Mark[] {
    for (let i = 0; i < set.length; i++) {
      if (this.eq(set[i]!)) return [...set.slice(0, i), ...set.slice(i + 1)];
    }
    return set;
  }

  isInSet(set: readonly Mark[]): boolean {
    return set.some((mark) => this.eq(mark));
  }

  static none: readonly Mark[] = Object.freeze([]);

  static sameSet(a: readonly Mark[], b: readonly Mark[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    return a.every((mark, i) => mark.eq(b[i]!));
  }

  /** Normalise the several things a caller may hand us as "the marks here". */
  static setFrom(marks: Mark | readonly Mark[] | null | undefined): readonly Mark[] {
    if (!marks) return Mark.none;
    if (marks instanceof Mark) return [marks];
    if (marks.length === 0) return Mark.none;
    const sorted = marks.slice();
    sorted.sort((a, b) => a.type.rank - b.type.rank);
    return sorted;
  }
}
