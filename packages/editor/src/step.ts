/**
 * Changes, as values that can be undone and moved.
 *
 * A document here is immutable, so a change is not something done to one — it
 * is a `Step`, a value describing a replacement, which turns one document into
 * another. That indirection is the whole reason this layer exists, and it buys
 * three things a mutating model cannot have afterwards:
 *
 *   - **Undo is not a snapshot.** A step knows how to invert itself against the
 *     document it applied to, so history is a list of steps rather than a list
 *     of copies of the document.
 *   - **Positions survive a change.** Every step produces a `StepMap` saying
 *     how the positions it moved were moved, so a selection, a cursor, a
 *     comment anchor or a collaborator's caret can be carried across it
 *     instead of being recomputed from nothing.
 *   - **A step can be moved onto a document it was not written against.**
 *     `Step.map` rewrites a step through someone else's changes. That is what
 *     rebasing is, and it is the operation collaborative editing consists of.
 *
 * **The collaboration verdict this file is cited for.** This model can accept
 * collaborative editing later without being replaced. Documents are immutable,
 * every change is an invertible step that yields a position map, and `Mapping`
 * records which of its maps are each other's inverses — the mirror
 * bookkeeping a rebase needs to tell "undo something I did" apart from "apply
 * something you did". What is missing is a rebase function, a transport and a
 * central authority to order changes. None of those is a change to the
 * document model, which is the thing the roadmap says cannot be retrofitted.
 *
 * **What is deliberately not here.** A replacement whose ends sit in different
 * parents — dragging a selection across a paragraph boundary and dropping
 * structure into it — is refused rather than half-done. Slices with open ends
 * need `Fragment` to join across depths, which the model does not do yet, and a
 * step that silently produced a document violating its schema would be worse
 * than one that says it cannot. `ReplaceStep.apply` returns a failure with a
 * reason, and every caller has to look at it.
 */

import { Fragment, Node, Slice } from './node.js';
import { Mark } from './mark.js';
import { resolve } from './position.js';

/**
 * Which side of an insertion a mapped position belongs to.
 *
 * A position exactly where content was inserted has two defensible answers,
 * and which one is right depends on what the position means. A cursor before
 * the insertion should stay before it (`-1`); the end of a range being typed
 * into should move with the text (`1`).
 */
export type Assoc = -1 | 1;

/** One replaced range, and what replaced it. */
interface Range {
  readonly start: number;
  readonly oldSize: number;
  readonly newSize: number;
}

/**
 * How one step moved the positions in a document.
 *
 * Deliberately not a function: a map has to be invertible and composable, and
 * a closure is neither.
 */
export class StepMap {
  private readonly ranges: readonly Range[];

  constructor(ranges: readonly Range[]) {
    this.ranges = ranges;
    Object.freeze(this);
  }

  static readonly empty: StepMap = new StepMap([]);

  static replace(start: number, oldSize: number, newSize: number): StepMap {
    return new StepMap([{ start, oldSize, newSize }]);
  }

  /**
   * Where `pos` ends up.
   *
   * A position inside a range that was replaced has nowhere of its own to go —
   * the content it pointed into is gone — so it collapses to one end of the
   * replacement, chosen by `assoc`.
   */
  map(pos: number, assoc: Assoc = 1): number {
    let shift = 0;
    for (const range of this.ranges) {
      const start = range.start + shift;
      if (pos < start) break;
      const end = start + range.oldSize;
      if (pos <= end) {
        // On an edge the answer is the edge, whatever was asked for: a
        // position at the start of what was replaced was never inside it, and
        // one at the end was not either. Association only decides when there
        // is a genuine choice — which is a pure insertion, where the range has
        // no interior and both answers are defensible.
        const side = range.oldSize === 0 ? assoc : pos === start ? -1 : pos === end ? 1 : assoc;
        return start + (side < 0 ? 0 : range.newSize);
      }
      shift += range.newSize - range.oldSize;
    }
    return pos + shift;
  }

  /** Whether `pos` fell inside something this map replaced. */
  deletedAt(pos: number): boolean {
    let shift = 0;
    for (const range of this.ranges) {
      const start = range.start + shift;
      if (pos < start) return false;
      // Strictly inside. A position on either edge survived the replacement —
      // it is where the change happened, not something the change removed.
      if (pos > start && pos < start + range.oldSize) return true;
      shift += range.newSize - range.oldSize;
    }
    return false;
  }

  /** The map that undoes this one, for the document this one produced. */
  invert(): StepMap {
    let shift = 0;
    const inverted: Range[] = [];
    for (const range of this.ranges) {
      inverted.push({
        start: range.start + shift,
        oldSize: range.newSize,
        newSize: range.oldSize,
      });
      shift += range.newSize - range.oldSize;
    }
    return new StepMap(inverted);
  }
}

/**
 * A sequence of maps, and which of them undo each other.
 *
 * The mirror relationship is the part that is only obvious once rebasing is
 * attempted. Mapping a position through "a change, then its own undo" must
 * give the position back unchanged, and it will not if the two maps are
 * treated as unrelated — the position collapses to an edge on the way through
 * the first and never recovers. Recording that map *i* is the inverse of map
 * *j* is what lets a position skip the pair.
 */
export class Mapping {
  private readonly maps: StepMap[] = [];
  /** `mirror[i]` is the index of the map that undoes map `i`, if any. */
  private readonly mirror = new Map<number, number>();

  get length(): number {
    return this.maps.length;
  }

  mapAt(index: number): StepMap {
    const map = this.maps[index];
    if (!map) throw new RangeError(`[volt] no map at ${index}`);
    return map;
  }

  /** Add a map, optionally naming the earlier map it undoes. */
  appendMap(map: StepMap, mirrors?: number): void {
    this.maps.push(map);
    if (mirrors !== undefined) {
      this.mirror.set(this.maps.length - 1, mirrors);
      this.mirror.set(mirrors, this.maps.length - 1);
    }
  }

  mirrorOf(index: number): number | undefined {
    return this.mirror.get(index);
  }

  /** Carry a position through every map, from `from` onward. */
  map(pos: number, assoc: Assoc = 1, from = 0): number {
    let result = pos;
    for (let i = from; i < this.maps.length; i++) {
      const map = this.maps[i]!;
      // A position deleted by this map and restored by its mirror is not
      // really deleted: skipping the pair is what keeps a caret where it was
      // when a collaborator's change is undone underneath it.
      const mirror = this.mirror.get(i);
      if (mirror !== undefined && mirror > i && map.deletedAt(result)) {
        i = mirror;
        continue;
      }
      result = map.map(result, assoc);
    }
    return result;
  }

  /** The mapping that undoes this one, applied in the opposite order. */
  invert(): Mapping {
    const inverted = new Mapping();
    for (let i = this.maps.length - 1; i >= 0; i--) {
      const mirror = this.mirror.get(i);
      inverted.appendMap(
        this.maps[i]!.invert(),
        mirror === undefined ? undefined : this.maps.length - 1 - mirror,
      );
    }
    return inverted;
  }
}

/** What applying a step produced, or why it could not be applied. */
export type StepResult =
  | { readonly ok: true; readonly doc: Node }
  | { readonly ok: false; readonly reason: string };

/**
 * One change to a document.
 *
 * Every step is a value: it holds no reference to the document it was made
 * against, which is what lets the same step be applied to a different one.
 */
export abstract class Step {
  abstract apply(doc: Node): StepResult;
  /** How this step moved positions. Asked only after a successful apply. */
  abstract getMap(): StepMap;
  /** The step that undoes this one, against the document it applied to. */
  abstract invert(doc: Node): Step;
  /**
   * This step, rewritten to apply after `mapping` — or null when the range it
   * changed is gone entirely, which is a step with nothing left to do rather
   * than an error.
   */
  abstract map(mapping: Mapping): Step | null;
}

/**
 * Replace the content between two positions.
 *
 * Both ends must resolve into the same parent, for the reason given at the top
 * of this file: joining across depths needs open slices the model cannot build
 * yet, and producing a document that violates the schema would be worse than
 * refusing.
 */
export class ReplaceStep extends Step {
  readonly from: number;
  readonly to: number;
  readonly slice: Slice;

  constructor(from: number, to: number, slice: Slice) {
    super();
    if (from > to) throw new RangeError(`[volt] a replacement cannot end before it starts`);
    this.from = from;
    this.to = to;
    this.slice = slice;
    Object.freeze(this);
  }

  apply(doc: Node): StepResult {
    const $from = resolve(doc, this.from);
    const $to = resolve(doc, this.to);
    if (!$from.sameParent($to)) {
      return {
        ok: false,
        reason:
          'a replacement whose ends are in different parents needs a slice with open ends, ' +
          'which this model does not build yet',
      };
    }
    if (this.slice.openStart > 0 || this.slice.openEnd > 0) {
      return { ok: false, reason: 'a slice with open ends cannot be applied yet' };
    }

    const parent = $from.parent;
    const replaced = parent.content
      .cut(0, $from.parentOffset)
      .append(this.slice.content)
      .append(parent.content.cut($to.parentOffset));

    if (!parent.type.validContent(replaced)) {
      return { ok: false, reason: `${parent.type.name} cannot hold that content` };
    }

    return { ok: true, doc: replaceAt(doc, $from.before($from.depth), parent.copy(replaced)) };
  }

  getMap(): StepMap {
    return StepMap.replace(this.from, this.to - this.from, this.slice.size);
  }

  invert(doc: Node): Step {
    const $from = resolve(doc, this.from);
    const removed = $from.parent.content.cut($from.parentOffset, resolve(doc, this.to).parentOffset);
    return new ReplaceStep(this.from, this.from + this.slice.size, new Slice(removed, 0, 0));
  }

  map(mapping: Mapping): Step | null {
    const from = mapping.map(this.from, 1);
    const to = mapping.map(this.to, -1);
    // The range closed up entirely under someone else's change, and an
    // insertion into nothing is still an insertion — but a deletion of a range
    // that is already gone has nothing to do.
    if (to < from) return null;
    if (from === to && this.slice.size === 0) return null;
    return new ReplaceStep(from, to, this.slice);
  }
}

/** Add or remove one mark across a range, without moving anything. */
abstract class MarkStep extends Step {
  readonly from: number;
  readonly to: number;
  readonly mark: Mark;

  constructor(from: number, to: number, mark: Mark) {
    super();
    this.from = from;
    this.to = to;
    this.mark = mark;
    Object.freeze(this);
  }

  /** A mark step moves nothing, so every position maps to itself. */
  getMap(): StepMap {
    return StepMap.empty;
  }

  protected abstract rewrite(node: Node): Node;

  apply(doc: Node): StepResult {
    const $from = resolve(doc, this.from);
    const $to = resolve(doc, this.to);
    if (!$from.sameParent($to)) {
      return { ok: false, reason: 'a mark across parents is not applied in one step yet' };
    }

    const parent = $from.parent;
    const run: Node[] = [];
    parent.content
      .cut($from.parentOffset, $to.parentOffset)
      .forEach((child) => run.push(child.isText ? this.rewrite(child) : child));
    const middle = Fragment.from(run);

    const rewritten = parent.content
      .cut(0, $from.parentOffset)
      .append(middle)
      .append(parent.content.cut($to.parentOffset));

    return { ok: true, doc: replaceAt(doc, $from.before($from.depth), parent.copy(rewritten)) };
  }
}

export class AddMarkStep extends MarkStep {
  protected rewrite(node: Node): Node {
    return node.mark(this.mark.addToSet(node.marks));
  }
  invert(): Step {
    return new RemoveMarkStep(this.from, this.to, this.mark);
  }
  map(mapping: Mapping): Step | null {
    const from = mapping.map(this.from, 1);
    const to = mapping.map(this.to, -1);
    return to <= from ? null : new AddMarkStep(from, to, this.mark);
  }
}

export class RemoveMarkStep extends MarkStep {
  protected rewrite(node: Node): Node {
    return node.mark(this.mark.removeFromSet(node.marks));
  }
  invert(): Step {
    return new AddMarkStep(this.from, this.to, this.mark);
  }
  map(mapping: Mapping): Step | null {
    const from = mapping.map(this.from, 1);
    const to = mapping.map(this.to, -1);
    return to <= from ? null : new RemoveMarkStep(from, to, this.mark);
  }
}

/**
 * Put `node` where the node beginning at `at` was.
 *
 * Only the ancestors on the path change; every sibling is the same object it
 * was, which is what makes a change cost the depth of the tree rather than its
 * size — and what lets a renderer tell what moved by identity.
 */
function replaceAt(doc: Node, at: number, node: Node): Node {
  if (at < 0) return node;
  const $at = resolve(doc, at);
  let result = node;
  for (let depth = $at.depth; depth > 0; depth--) {
    const parent = $at.node(depth);
    result = parent.copy(parent.content.replaceChild($at.index(depth), result));
  }
  return doc.copy(doc.content.replaceChild($at.index(0), result));
}

/**
 * A change in progress: a document, the steps taken to reach it, and the map
 * from where positions were to where they are.
 *
 * Steps are collected rather than applied one at a time by the caller so that
 * a selection can be carried across the whole change at the end, and so that
 * a failure part-way leaves the transaction untouched rather than half-applied.
 */
export class Transaction {
  private current: Node;
  private readonly taken: Step[] = [];
  readonly mapping = new Mapping();

  constructor(doc: Node) {
    this.current = doc;
  }

  get doc(): Node {
    return this.current;
  }

  get steps(): readonly Step[] {
    return this.taken;
  }

  get changed(): boolean {
    return this.taken.length > 0;
  }

  /**
   * Take a step, or say why it could not be taken.
   *
   * The document is only advanced on success, so a refused step leaves the
   * transaction exactly as it was and a caller can try something else.
   */
  step(step: Step): StepResult {
    const result = step.apply(this.current);
    if (!result.ok) return result;
    this.taken.push(step);
    this.mapping.appendMap(step.getMap());
    this.current = result.doc;
    return result;
  }

  replace(from: number, to: number, slice: Slice = Slice.empty): StepResult {
    return this.step(new ReplaceStep(from, to, slice));
  }

  delete(from: number, to: number): StepResult {
    return this.replace(from, to, Slice.empty);
  }

  insertText(pos: number, text: string, marks: readonly Mark[] = []): StepResult {
    if (text === '') return { ok: true, doc: this.current };
    const node = this.current.type.schema.text(text, marks);
    return this.replace(pos, pos, new Slice(Fragment.from(node), 0, 0));
  }

  addMark(from: number, to: number, mark: Mark): StepResult {
    return this.step(new AddMarkStep(from, to, mark));
  }

  removeMark(from: number, to: number, mark: Mark): StepResult {
    return this.step(new RemoveMarkStep(from, to, mark));
  }

  /** Where a position from the document this began with is now. */
  map(pos: number, assoc: Assoc = 1): number {
    return this.mapping.map(pos, assoc);
  }

  /** The steps that undo this transaction, newest first. */
  invert(startDoc: Node): Step[] {
    const inverted: Step[] = [];
    let doc = startDoc;
    const forward: Node[] = [];
    for (const step of this.taken) {
      forward.push(doc);
      const result = step.apply(doc);
      if (!result.ok) throw new Error(`[volt] a step that applied no longer does: ${result.reason}`);
      doc = result.doc;
    }
    for (let i = this.taken.length - 1; i >= 0; i--) {
      inverted.push(this.taken[i]!.invert(forward[i]!));
    }
    return inverted;
  }
}
