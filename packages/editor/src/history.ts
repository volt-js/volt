/**
 * Undo and redo, as a stack of inverse steps.
 *
 * Nothing here keeps a copy of the document. A step knows how to invert itself
 * against the document it applied to, so an undoable unit is the list of steps
 * that take the document back, and the cost of remembering an edit is the size
 * of the edit rather than the size of the file being edited. That is the
 * property step.ts was built for, and this is the file that spends it.
 *
 * **An undo is not a rewind.** Restoring the document alone leaves the caret
 * wherever the inverse steps happened to put it, which after undoing a
 * paragraph three blocks up is nowhere the person was looking. Every unit
 * therefore also remembers the selection the edit *started* from, and undoing
 * puts it back. The forward direction is symmetric: recording an undo captures
 * the selection that was current before it, so redoing returns the caret to
 * where the original edit left it.
 *
 * **Grouping is the whole difficulty.** One character per undo is not an
 * editor, so adjacent typing has to collapse into one unit, and the two tests
 * for "adjacent" are time and place. The clock is injectable because a suite
 * that waits half a second to prove a rule is a suite that eventually fails on
 * a loaded machine. Place is `EditorTransaction`'s two ranges: the group holds
 * the range it last wrote in the coordinates of the document it produced, and
 * the incoming transaction reports the range it first replaced in the
 * coordinates of the document it started from — which is the same document, so
 * the two numbers can be compared at all.
 *
 * **`closeHistory` beats the clock in both directions.** A transaction that
 * asks to be closed starts a unit of its own and nothing later joins it. The
 * backwards half is what state.ts asks for — return ends the paragraph before
 * it — and the forwards half is what commands.ts asks for, where a paste is one
 * undoable thing and the typing after it is another. Closing only backwards
 * would let the typing after a paste merge into the paste.
 *
 * **Every transaction goes through `record`, this history's own included.** The
 * stacks move there and nowhere else, which means a transaction that `undo`
 * built and the caller decided not to apply changes nothing — and it means an
 * undo cannot be recorded as a new edit and so cannot discard the redo stack it
 * is supposed to fill.
 *
 * Not here: rebasing an undo over someone else's change. That is the
 * collaborative case, it needs `Step.map` and the mirror bookkeeping `Mapping`
 * already carries, and it is a different piece of work from this one.
 */

import { TextSelection } from './state.js';
import type { ChangedRange, EditorState, EditorTransaction } from './state.js';
import type { Step } from './step.js';

/** How this history decides what belongs together, and how much it keeps. */
export interface HistoryOptions {
  /** The clock, in milliseconds. Injectable so grouping can be tested at all. */
  readonly now?: () => number;
  /** How long a unit stays open to further typing. */
  readonly newGroupDelay?: number;
  /** How many units to keep before the oldest is forgotten. */
  readonly depth?: number;
}

/**
 * One undoable unit.
 *
 * `steps` are inverses, in the order they must be applied to take the document
 * back — newest edit first, since it has to be undone before the one under it
 * makes sense. `range` is where this unit last wrote, in the coordinates of the
 * document it produced, which is the space the next transaction is compared in.
 */
interface HistoryEvent {
  steps: Step[];
  readonly selection: TextSelection;
  range: ChangedRange | null;
  time: number;
}

type Direction = 'undo' | 'redo';

/**
 * The stack of undoable units for one editor.
 *
 * Held beside the state rather than inside it: an `EditorState` is a document
 * and a selection, and both of those are values, while this is the one thing in
 * the editor that is deliberately a moving accumulation.
 */
export class EditorHistory {
  private readonly now: () => number;
  private readonly newGroupDelay: number;
  private readonly depth: number;

  private readonly done: HistoryEvent[] = [];
  private readonly undone: HistoryEvent[] = [];

  /**
   * The unit still accepting further typing, if any.
   *
   * Not simply the top of `done`: a unit stops being open when a transaction
   * closes it, when the caret moves, and after an undo, while remaining the
   * thing the next undo will take back.
   */
  private open: HistoryEvent | null = null;

  /**
   * The transactions this history built, and which way they go.
   *
   * A weak map rather than a flag on the transaction, because a transaction is
   * the state layer's value and which history produced it is this layer's
   * business.
   */
  private readonly mine = new WeakMap<EditorTransaction, Direction>();

  constructor(options: HistoryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.newGroupDelay = options.newGroupDelay ?? 500;
    this.depth = Math.max(1, options.depth ?? 100);
  }

  /** How many undos are available. */
  get undoDepth(): number {
    return this.done.length;
  }

  /** How many redos are available. */
  get redoDepth(): number {
    return this.undone.length;
  }

  /** Forget everything, in both directions. */
  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
    this.open = null;
  }

  /**
   * Take note of a transaction that has been applied.
   *
   * Called for every transaction, including the ones `undo` and `redo` handed
   * out — those move a unit from one stack to the other instead of being
   * recorded as new edits.
   */
  record(tr: EditorTransaction): void {
    const at = this.now();

    const direction = this.mine.get(tr);
    if (direction !== undefined) {
      this.mine.delete(tr);
      const from = direction === 'undo' ? this.done : this.undone;
      const to = direction === 'undo' ? this.undone : this.done;
      from.pop();
      // The inverse of an undo is a redo, and its `selectionBefore` is where
      // the caret was before the undo — which is where the original edit left
      // it, and so where redoing it should put it back.
      to.push(this.eventFor(tr, at));
      // Nothing merges onto an undo. Typing after one is a new edit, and
      // letting it join the unit underneath would make that unit undo two
      // different things at once.
      this.open = null;
      return;
    }

    if (!tr.changed) {
      // Clicking somewhere else ends the unit: the next character is typed in
      // a different place, and one undo should not take back both runs.
      if (tr.selectionChanged) this.open = null;
      return;
    }

    const event = this.eventFor(tr, at);
    // A fresh edit discards what was ahead. Those steps were written against a
    // document that no longer exists, and there is no rebase here to move them.
    this.undone.length = 0;

    const open = this.open;
    if (open && !tr.historyClosed && this.groupsWith(open, tr, at)) {
      // Newest first, so undoing the group unwinds it in the order it was made.
      open.steps.unshift(...event.steps);
      open.time = at;
      open.range = event.range;
      return;
    }

    this.done.push(event);
    if (this.done.length > this.depth) this.done.shift();
    this.open = tr.historyClosed ? null : event;
  }

  /**
   * A transaction that takes back the most recent unit, or null when there is
   * nothing to take back.
   *
   * The stacks do not move until the transaction is recorded, so a caller that
   * decides not to apply it has changed nothing.
   */
  undo(state: EditorState): EditorTransaction | null {
    return this.travel(state, 'undo');
  }

  /** A transaction that puts back the most recently undone unit. */
  redo(state: EditorState): EditorTransaction | null {
    return this.travel(state, 'redo');
  }

  private travel(state: EditorState, direction: Direction): EditorTransaction | null {
    const stack = direction === 'undo' ? this.done : this.undone;
    const event = stack[stack.length - 1];
    if (!event) return null;

    const tr = state.tr();
    for (const step of event.steps) {
      const result = tr.step(step);
      // The steps were recorded against a document this state is no longer.
      // Saying so is the only honest answer: applying the rest would leave a
      // document half taken back, and no later undo could describe it.
      if (!result.ok) {
        throw new Error(`[volt] a step this history recorded no longer applies: ${result.reason}`);
      }
    }

    // The recorded selection is in the coordinates of the document these steps
    // just restored, so it goes back as it was rather than being mapped.
    tr.setSelection(TextSelection.create(tr.doc, event.selection.anchor, event.selection.head));
    this.mine.set(tr, direction);
    return tr;
  }

  private eventFor(tr: EditorTransaction, at: number): HistoryEvent {
    return {
      steps: tr.invert(tr.startDoc),
      selection: tr.selectionBefore,
      range: tr.changedRange,
      time: at,
    };
  }

  /**
   * Whether an incoming transaction belongs to the unit still open.
   *
   * A transaction that replaced nothing in the starting document's coordinates
   * — a mark toggled across a range, or a transaction whose first step was not
   * a replacement — has no range to compare, and takes a unit of its own rather
   * than being merged on a guess.
   */
  private groupsWith(open: HistoryEvent, tr: EditorTransaction, at: number): boolean {
    if (at > open.time + this.newGroupDelay) return false;
    const before = open.range;
    const incoming = tr.firstReplacedRange;
    if (!before || !incoming) return false;
    // Touching counts: typing appends at exactly the end of what was typed
    // before, and a backspace ends exactly where it began.
    return incoming.from <= before.to && incoming.to >= before.from;
  }
}
