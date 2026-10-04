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
 * a range the selection was inside or covered, so the map has no better answer
 * than "an edge of the replacement". Splitting a paragraph is the common case,
 * and a block selected whole and typed over or deleted is another; commands.ts
 * explains each where it happens.
 *
 * A selection is either kind selection.ts defines — a text range, or one node
 * selected whole — and both are mapped by the same rule. `TextSelection` is
 * re-exported from here because this is where it was first defined, and every
 * caller that imports it from here keeps working.
 */

import type { Node } from './node.js';
import { EditorSelection, NodeSelection, TextSelection } from './selection.js';
import { AddMarkStep, RemoveMarkStep, ReplaceStep, Transaction } from './step.js';
import type { Step, StepResult } from './step.js';

export { TextSelection };

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
 * range forward, and view.ts redraws from the second — which is why it covers
 * the text a mark step rewrote as well as what was replaced, and why history.ts
 * takes it only from a transaction whose every step was a replacement.
 */
export class EditorTransaction extends Transaction {
  /** The document this began from — what `EditorState.apply` checks itself against. */
  readonly startDoc: Node;
  readonly selectionBefore: EditorSelection;

  private selectionNow: EditorSelection;
  private closed = false;
  private first: ChangedRange | null = null;
  private range: ChangedRange | null = null;

  constructor(state: EditorState) {
    super(state.doc);
    this.startDoc = state.doc;
    this.selectionBefore = state.selection;
    this.selectionNow = state.selection;
  }

  get selection(): EditorSelection {
    return this.selectionNow;
  }

  get selectionChanged(): boolean {
    return !this.selectionNow.eq(this.selectionBefore);
  }

  setSelection(selection: EditorSelection): this {
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

    // Only a step taken first is in the starting document's coordinates. A
    // transaction whose replacement is not its first step simply declines to
    // be grouped, which costs one extra undo unit and never merges two changes
    // that were not adjacent.
    if (at === 0 && step instanceof ReplaceStep) this.first = { from: step.from, to: step.to };

    // A mark step replaces nothing, but it rewrites the text it covers, and a
    // view that redraws from this range has to redraw that text too.
    const written =
      step instanceof ReplaceStep
        ? { from: step.from, to: step.from + step.slice.size }
        : step instanceof AddMarkStep || step instanceof RemoveMarkStep
          ? { from: step.from, to: step.to }
          : null;
    if (written) {
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
  readonly selection: EditorSelection;

  private constructor(doc: Node, selection: EditorSelection) {
    this.doc = doc;
    this.selection = selection;
    Object.freeze(this);
  }

  /**
   * A state for `doc`, with a cursor at its start unless a selection is given.
   *
   * A selection is two numbers with nothing to say which document they were
   * counted in, so one that `TextSelection.create` would not have made for
   * this document was made for another, and is refused for the reason `apply`
   * refuses a transaction. Kept as given, it could point past the end of this
   * document, or sit on a block boundary where no cursor belongs, and the
   * first command to use it would go wrong far from the mistake. A node
   * selection is held to the same rule, and to holding the node this document
   * has at its position.
   */
  static create(doc: Node, selection?: EditorSelection): EditorState {
    if (!selection) return new EditorState(doc, TextSelection.atStart(doc));
    if (!madeFor(doc, selection)) {
      throw new RangeError(`[volt] ${selection} was made for a different document`);
    }
    return new EditorState(doc, selection);
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

/** Whether `doc` would give back this very selection from its own description. */
function madeFor(doc: Node, selection: EditorSelection): boolean {
  let again: EditorSelection;
  try {
    again = EditorSelection.fromJSON(doc, selection.toJSON());
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
  if (!again.eq(selection)) return false;
  return !(selection instanceof NodeSelection) || (again as NodeSelection).node.eq(selection.node);
}
