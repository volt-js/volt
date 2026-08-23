/**
 * The editor's state: a document and a selection, and the transaction that
 * carries one to the next.
 *
 * The rule this file exists to enforce is that **a selection is mapped, never
 * recomputed**. Recomputing it — asking the DOM where the caret is, or
 * re-deriving it from the new document — is how an editor loses the cursor
 * when a change arrives from somewhere the caret was not: an undo of a
 * paragraph three blocks up, a remote edit, a mark toggled across a range. The
 * change itself already says where every position went, in the `StepMap` each
 * step produces, so the selection is carried across the change by the same
 * arithmetic as every other position rather than by a second, weaker guess.
 *
 * `EditorTransaction` is therefore the only place a selection changes
 * implicitly: it maps its own selection through each step as the step is
 * taken. A command that needs a different answer says so with `setSelection`,
 * and there is exactly one reason for a command to do that — the step replaced
 * a range the cursor was strictly inside, so the map has no better answer than
 * "an edge of the replacement". Splitting a paragraph is the common case, and
 * commands.ts explains it where it happens.
 *
 * Only text selections exist here. A node selection — the whole image
 * highlighted as one object — is a view-level affordance, and there is no view
 * yet; adding the class now would mean a second selection type that nothing
 * constructs and no command handles.
 */

import type { Node } from './node.js';
import { resolve } from './position.js';
import { ReplaceStep, Transaction } from './step.js';
import type { Assoc, Mapping, Step, StepResult } from './step.js';

/** Whether a cursor can sit at `pos` — that is, whether it is in inline content. */
function isTextPos(doc: Node, pos: number): boolean {
  if (pos < 0 || pos > doc.content.size) return false;
  return resolve(doc, pos).parent.inlineContent;
}

/**
 * The closest position to `pos` a text cursor can occupy, searching outwards
 * and preferring the direction `bias` names.
 *
 * A mapped position can land somewhere no cursor belongs — between two list
 * items, say, after the paragraph that was there is deleted — and the honest
 * answer is the nearest place it can be rather than an exception in the middle
 * of applying a change.
 *
 * A document with no text position at all is legal (`doc(horizontal_rule)`
 * satisfies the basic schema), so this returns the clamped position rather
 * than refusing. Every command checks the parent it landed in before touching
 * it, which it would have to do anyway.
 */
function nearestTextPos(doc: Node, pos: number, bias: Assoc): number {
  const size = doc.content.size;
  const start = Math.max(0, Math.min(size, pos));
  for (let distance = 0; distance <= size; distance++) {
    const ahead = start + distance * bias;
    const behind = start - distance * bias;
    if (isTextPos(doc, ahead)) return ahead;
    if (isTextPos(doc, behind)) return behind;
  }
  return start;
}

/**
 * A selection between two positions in inline content.
 *
 * `anchor` is the end that stays put while a selection is extended and `head`
 * is the end that moves, so the pair is ordered by intent rather than by
 * position; `from` and `to` are the same two numbers ordered by position,
 * which is what every command wants.
 */
export class TextSelection {
  readonly anchor: number;
  readonly head: number;

  private constructor(anchor: number, head: number) {
    this.anchor = anchor;
    this.head = head;
    Object.freeze(this);
  }

  /** A selection in `doc`, with both ends snapped to where a cursor can be. */
  static create(doc: Node, anchor: number, head: number = anchor): TextSelection {
    const at = nearestTextPos(doc, anchor, 1);
    // The head is snapped towards the anchor, so a selection whose head landed
    // in a gap shrinks onto the content it covers rather than growing past it.
    return new TextSelection(at, head === anchor ? at : nearestTextPos(doc, head, head < at ? 1 : -1));
  }

  static atStart(doc: Node): TextSelection {
    return TextSelection.create(doc, 0);
  }

  get from(): number {
    return Math.min(this.anchor, this.head);
  }

  get to(): number {
    return Math.max(this.anchor, this.head);
  }

  get empty(): boolean {
    return this.anchor === this.head;
  }

  eq(other: TextSelection): boolean {
    return this.anchor === other.anchor && this.head === other.head;
  }

  /**
   * This selection, carried across a change.
   *
   * Both ends map with `assoc` 1 — they belong after content inserted at them,
   * which is what makes the cursor follow typed text without anyone computing
   * where the text ended up.
   */
  map(doc: Node, mapping: Mapping, from = 0): TextSelection {
    return TextSelection.create(doc, mapping.map(this.anchor, 1, from), mapping.map(this.head, 1, from));
  }

  toString(): string {
    return this.empty ? `cursor(${this.anchor})` : `selection(${this.anchor}..${this.head})`;
  }
}

/** A range of positions a transaction rewrote. */
export interface ChangedRange {
  readonly from: number;
  readonly to: number;
}

/**
 * A transaction that also carries a selection, and remembers enough about
 * where it wrote for a history to group it.
 *
 * The two ranges it tracks look redundant and are not. `firstReplacedRange` is
 * in the coordinates of the document the transaction *started* from, which is
 * the only space in which it can be compared against what the previous
 * transaction did; `changedRange` is in the coordinates of the document it
 * *produced*, which is the space the next transaction will be compared in.
 * history.ts uses one for the adjacency test and the other to move the group's
 * range forward.
 */
export class EditorTransaction extends Transaction {
  /** The document this began from — what `EditorState.apply` checks itself against. */
  readonly startDoc: Node;
  readonly selectionBefore: TextSelection;

  private selectionNow: TextSelection;
  private closed = false;
  private first: ChangedRange | null = null;
  private range: ChangedRange | null = null;

  constructor(state: EditorState) {
    super(state.doc);
    this.startDoc = state.doc;
    this.selectionBefore = state.selection;
    this.selectionNow = state.selection;
  }

  get selection(): TextSelection {
    return this.selectionNow;
  }

  get selectionChanged(): boolean {
    return !this.selectionNow.eq(this.selectionBefore);
  }

  setSelection(selection: TextSelection): this {
    this.selectionNow = selection;
    return this;
  }

  /**
   * Refuse to be grouped with the change before this one.
   *
   * Pressing return, and finishing a composition, end an undo unit: a user who
   * types a paragraph, hits return and types another expects two undos, not
   * one that swallows both.
   */
  closeHistory(): this {
    this.closed = true;
    return this;
  }

  get historyClosed(): boolean {
    return this.closed;
  }

  get firstReplacedRange(): ChangedRange | null {
    return this.first;
  }

  get changedRange(): ChangedRange | null {
    return this.range;
  }

  override step(step: Step): StepResult {
    const at = this.mapping.length;
    const result = super.step(step);
    if (!result.ok) return result;

    this.selectionNow = this.selectionNow.map(this.doc, this.mapping, at);

    if (step instanceof ReplaceStep) {
      // Only a step taken first is in the starting document's coordinates. A
      // transaction whose replacement is not its first step simply declines to
      // be grouped, which costs one extra undo unit and never merges two
      // changes that were not adjacent.
      if (at === 0) this.first = { from: step.from, to: step.to };

      const written = { from: step.from, to: step.from + step.slice.size };
      const map = step.getMap();
      this.range = this.range
        ? {
            from: Math.min(map.map(this.range.from, -1), written.from),
            to: Math.max(map.map(this.range.to, 1), written.to),
          }
        : written;
    }

    return result;
  }
}

/**
 * A document and a selection into it.
 *
 * Immutable, like everything below it: applying a transaction produces a new
 * state rather than mutating this one, so a caller holding the old state still
 * holds a consistent document-and-selection pair — which is what a history
 * entry, and later a rebase, is holding.
 */
export class EditorState {
  readonly doc: Node;
  readonly selection: TextSelection;

  private constructor(doc: Node, selection: TextSelection) {
    this.doc = doc;
    this.selection = selection;
    Object.freeze(this);
  }

  static create(doc: Node, selection?: TextSelection): EditorState {
    return new EditorState(doc, selection ?? TextSelection.atStart(doc));
  }

  /** A transaction starting from this state. Each call makes a new one. */
  tr(): EditorTransaction {
    return new EditorTransaction(this);
  }

  /**
   * The state this transaction leads to.
   *
   * The selection comes from the transaction, which mapped it through its own
   * steps as they were taken. Deriving it here instead would mean deriving it
   * from the finished document, which no longer knows where anything was.
   *
   * A transaction built against a different document is refused: its positions
   * mean nothing here, and applying it would produce a state whose selection
   * points into a document that never existed.
   */
  apply(tr: EditorTransaction): EditorState {
    if (tr.startDoc !== this.doc) {
      throw new Error('[volt] this transaction was started from a different document');
    }
    if (tr.doc === this.doc && !tr.selectionChanged) return this;
    return new EditorState(tr.doc, tr.selection);
  }
}
