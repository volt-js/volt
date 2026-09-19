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
import type { ResolvedPos } from './position.js';

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
    // A range's start is counted in the document the map applies to, as `pos`
    // is, so the two compare as they are; `shift` is what the ranges already
    // passed did to everything after them, and only the answer needs it.
    let shift = 0;
    for (const range of this.ranges) {
      if (pos < range.start) break;
      const end = range.start + range.oldSize;
      if (pos <= end) {
        // On an edge the answer is the edge, whatever was asked for: a
        // position at the start of what was replaced was never inside it, and
        // one at the end was not either. Association only decides when there
        // is a genuine choice — which is a pure insertion, where the range has
        // no interior and both answers are defensible.
        const side = range.oldSize === 0 ? assoc : pos === range.start ? -1 : pos === end ? 1 : assoc;
        return range.start + shift + (side < 0 ? 0 : range.newSize);
      }
      shift += range.newSize - range.oldSize;
    }
    return pos + shift;
  }

  /** Whether `pos` fell inside something this map replaced. */
  deletedAt(pos: number): boolean {
    for (const range of this.ranges) {
      if (pos < range.start) return false;
      // Strictly inside. A position on either edge survived the replacement —
      // it is where the change happened, not something the change removed.
      if (pos > range.start && pos < range.start + range.oldSize) return true;
    }
    return false;
  }

  /**
   * @internal Where a position `deleting` took out comes back, in this map
   * that undoes it — or null when going through both maps is already right.
   *
   * It comes back the same distance into what this map puts back as it was
   * into what `deleting` removed. This map was written after everything that
   * happened between the two, so where it puts the content back already
   * accounts for whatever those moved — which is why `Mapping` can jump from
   * one to the other without losing them.
   *
   * An edge of what was removed counts as taken out when `assoc` leans across
   * it. The deletion leaves such a position where it was, but this map then
   * inserts at exactly that point, and would carry the position to the far
   * side of everything it puts back. The other edge leans away from the
   * insertion and needs no help — and an insertion, whose edges are one
   * point, removed nothing to come back into.
   */
  recover(deleting: StepMap, pos: number, assoc: Assoc): number | null {
    let shift = 0;
    for (let i = 0; i < deleting.ranges.length; i++) {
      const range = deleting.ranges[i]!;
      if (pos < range.start) return null;
      const restoring = this.ranges[i];
      if (!restoring) return null;
      const end = range.start + range.oldSize;
      if (pos <= end) {
        return pos === (assoc < 0 ? range.start : end) ? null : restoring.start + shift + (pos - range.start);
      }
      shift += restoring.newSize - restoring.oldSize;
    }
    return null;
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
 * *j* is what lets a position the first deleted be found again in what the
 * second put back.
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
      // really deleted: it is found again inside what the mirror put back,
      // which is what keeps a caret where it was when a collaborator's change
      // is undone underneath it. Keeping the position it had before this map
      // instead would be right only with nothing in between, and would lose
      // every map recorded between the two.
      const mirror = this.mirror.get(i);
      if (mirror !== undefined && mirror > i) {
        const recovered = this.maps[mirror]!.recover(map, result, assoc);
        if (recovered !== null) {
          result = recovered;
          i = mirror;
          continue;
        }
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

/**
 * What applying a step produced, or why it could not be applied.
 *
 * A failure is a step this document refuses: content its schema forbids, ends
 * in different parents, a mark with nothing to change. A position outside the
 * document is not one. `resolve` throws a `RangeError` for it, as it does
 * everywhere else, since the step was not written for this document at all —
 * which a caller trying something else instead would only hide.
 */
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

    return { ok: true, doc: replaceAt(doc, containerOf($from), parent.copy(replaced)) };
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
    // The end maps with the other association, so where someone else inserted
    // at exactly this point the two cross: the start goes after their text and
    // the end stays before it. Their text is outside the range either way, so
    // the range is the point after it.
    const to = Math.max(from, mapping.map(this.to, -1));
    // The range closed up entirely under someone else's change, and an
    // insertion into nothing is still an insertion — but a deletion of a range
    // that is already gone has nothing to do.
    if (from === to && this.slice.size === 0) return null;
    return new ReplaceStep(from, to, this.slice);
  }
}

const acrossParents = 'a mark across parents is not applied in one step yet';

/** Add or remove one mark across a range, without moving anything. */
abstract class MarkStep extends Step {
  readonly from: number;
  readonly to: number;
  readonly mark: Mark;

  constructor(from: number, to: number, mark: Mark) {
    super();
    if (from > to) throw new RangeError(`[volt] a mark's range cannot end before it starts`);
    this.from = from;
    this.to = to;
    this.mark = mark;
    Object.freeze(this);
  }

  /** A mark step moves nothing, so every position maps to itself. */
  getMap(): StepMap {
    return StepMap.empty;
  }

  /** The marks text carrying `marks` has once this step has applied. */
  protected abstract after(marks: readonly Mark[]): readonly Mark[];
  /** What the opposite step makes of `marks` — the way back `apply` checks. */
  protected abstract before(marks: readonly Mark[]): readonly Mark[];

  /**
   * Rewrite the text in the range, refusing what the step cannot stand behind.
   *
   * The parent's content is checked as a replacement checks it, so bold in a
   * code block is refused here rather than becoming a code block its own
   * schema would refuse at construction. A step that would change nothing is
   * refused too, because a step is what a transaction counts as a change and
   * what a history keeps as something to undo. And so is a step whose
   * opposite would not give the text back — bold laid over text that is
   * partly bold already, or code throwing off emphasis — because `invert` is
   * that opposite step, and an undo that takes bold off text that had it is
   * not an undo. `Transaction.addMark` and `removeMark` split a range into
   * steps that are none of these.
   */
  apply(doc: Node): StepResult {
    const $from = resolve(doc, this.from);
    const $to = resolve(doc, this.to);
    if (!$from.sameParent($to)) return { ok: false, reason: acrossParents };

    const parent = $from.parent;
    const run: Node[] = [];
    let changed = false;
    let exact = true;
    parent.content.cut($from.parentOffset, $to.parentOffset).forEach((child) => {
      if (!child.isText) {
        run.push(child);
        return;
      }
      const marks = this.after(child.marks);
      if (marks !== child.marks) changed = true;
      if (!Mark.sameSet(this.before(marks), child.marks)) exact = false;
      run.push(child.mark(marks));
    });

    if (!changed) {
      return { ok: false, reason: `there is no text in that range the ${this.mark.type.name} mark would change` };
    }
    if (!exact) {
      return { ok: false, reason: `the opposite step would not give back the marks this one changes` };
    }

    const rewritten = parent.content
      .cut(0, $from.parentOffset)
      .append(Fragment.from(run))
      .append(parent.content.cut($to.parentOffset));

    if (!parent.type.validContent(rewritten)) {
      return { ok: false, reason: `${parent.type.name} cannot hold that content` };
    }

    return { ok: true, doc: replaceAt(doc, containerOf($from), parent.copy(rewritten)) };
  }
}

export class AddMarkStep extends MarkStep {
  protected after(marks: readonly Mark[]): readonly Mark[] {
    return this.mark.addToSet(marks);
  }
  protected before(marks: readonly Mark[]): readonly Mark[] {
    return this.mark.removeFromSet(marks);
  }
  invert(): MarkStep {
    return new RemoveMarkStep(this.from, this.to, this.mark);
  }
  map(mapping: Mapping): Step | null {
    const from = mapping.map(this.from, 1);
    const to = mapping.map(this.to, -1);
    return to <= from ? null : new AddMarkStep(from, to, this.mark);
  }
}

export class RemoveMarkStep extends MarkStep {
  protected after(marks: readonly Mark[]): readonly Mark[] {
    return this.mark.removeFromSet(marks);
  }
  protected before(marks: readonly Mark[]): readonly Mark[] {
    return this.mark.addToSet(marks);
  }
  invert(): MarkStep {
    return new AddMarkStep(this.from, this.to, this.mark);
  }
  map(mapping: Mapping): Step | null {
    const from = mapping.map(this.from, 1);
    const to = mapping.map(this.to, -1);
    return to <= from ? null : new RemoveMarkStep(from, to, this.mark);
  }
}

/** A stretch of text one mark step covers. */
interface MarkRun {
  readonly mark: Mark;
  readonly from: number;
  to: number;
}

/** Carry the last run of `mark` on to `to` when it ends at `from`, or start another. */
function extendRun(runs: MarkRun[], mark: Mark, from: number, to: number): void {
  const last = runs.findLast((run) => run.mark.eq(mark));
  if (last && last.to === from) last.to = to;
  else runs.push({ mark, from, to });
}

/**
 * Where the node a step rewrote begins, for `replaceAt`.
 *
 * A step whose ends resolve directly in the document has no such node — the
 * parent it rewrote *is* the document, and there is no position before it to
 * ask for. That is what `replaceAt`'s negative-position guard is for, and it
 * has to be reached: every structural edit an editor makes at the top level —
 * splitting a paragraph into two, joining two back into one, deleting a rule
 * between them — is a replacement at depth zero, and asking `before(0)` for
 * one throws instead of returning a document.
 */
function containerOf($from: ResolvedPos): number {
  return $from.depth === 0 ? -1 : $from.before($from.depth);
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

  /**
   * Add a mark across a range, as steps that each undo exactly.
   *
   * One step over the whole range is refused wherever some of the text already
   * has the mark, or has one the mark throws off, since its opposite could not
   * give that text back. So the range is taken in runs: the marks the new one
   * excludes come off first, one step per run of text carrying each, and then
   * the mark goes onto each run that lacks it. Text that has it already, or
   * carries a mark that refuses it, is left as it is.
   */
  addMark(from: number, to: number, mark: Mark): StepResult {
    const removals: MarkRun[] = [];
    const additions: MarkRun[] = [];
    const refused = this.eachText(from, to, (text, start, end) => {
      const marked = mark.addToSet(text.marks);
      if (marked === text.marks) return;
      for (const other of text.marks) if (!other.isInSet(marked)) extendRun(removals, other, start, end);
      extendRun(additions, mark, start, end);
    });
    if (refused) return refused;

    return this.takeAll(
      [
        ...removals.map((run) => new RemoveMarkStep(run.from, run.to, run.mark)),
        ...additions.map((run) => new AddMarkStep(run.from, run.to, run.mark)),
      ],
      `there is no text in that range the ${mark.type.name} mark would change`,
    );
  }

  /** Take a mark off a range, one step per run of text that carries it. */
  removeMark(from: number, to: number, mark: Mark): StepResult {
    const runs: MarkRun[] = [];
    const refused = this.eachText(from, to, (text, start, end) => {
      if (mark.isInSet(text.marks)) extendRun(runs, mark, start, end);
    });
    if (refused) return refused;

    return this.takeAll(
      runs.map((run) => new RemoveMarkStep(run.from, run.to, run.mark)),
      `there is no text in that range carrying the ${mark.type.name} mark`,
    );
  }

  /**
   * Visit each piece of text a range covers, with where the range covers it —
   * or say why the range is refused before anything is visited.
   */
  private eachText(from: number, to: number, f: (text: Node, start: number, end: number) => void): StepResult | null {
    if (from > to) throw new RangeError(`[volt] a mark's range cannot end before it starts`);
    const $from = resolve(this.current, from);
    if (!$from.sameParent(resolve(this.current, to))) return { ok: false, reason: acrossParents };

    const parent = $from.parent;
    let start = $from.start();
    for (let i = 0; i < parent.childCount && start < to; i++) {
      const child = parent.child(i);
      const end = start + child.nodeSize;
      const covered = { from: Math.max(start, from), to: Math.min(end, to) };
      if (child.isText && covered.from < covered.to) f(child, covered.from, covered.to);
      start = end;
    }
    return null;
  }

  /**
   * Take every step or none of them.
   *
   * A mark across a range can be several steps, and a transaction that took
   * the first and was refused the next would hold half an edit. So they are
   * tried against a scratch document first, and taken only once every one of
   * them has applied.
   */
  private takeAll(steps: readonly Step[], nothing: string): StepResult {
    if (steps.length === 0) return { ok: false, reason: nothing };
    let doc = this.current;
    for (const step of steps) {
      const result = step.apply(doc);
      if (!result.ok) return result;
      doc = result.doc;
    }
    for (const step of steps) this.step(step);
    return { ok: true, doc: this.current };
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
