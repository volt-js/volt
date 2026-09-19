/**
 * The state layer: a document, a selection, and the transaction between them.
 *
 * The thing worth testing hardest here is the one claim the file is built
 * around — that a selection is *mapped* across a change and never recomputed.
 * A selection that is re-derived from the finished document looks right in the
 * easy case, where the change happened exactly where the cursor was, and is
 * wrong in every other one: an edit in an earlier block, an edit that deleted
 * what the cursor was inside, two edits in the same transaction. Those are the
 * cases below, with the arithmetic spelled out, because the failure they guard
 * against is a cursor in the wrong place rather than an exception.
 */

import { describe, expect, it } from 'vitest';
import { Fragment, Mark, Slice, basicSchema } from '../src/index.ts';
import { EditorState, EditorTransaction, TextSelection } from '../src/state.ts';
import { AddMarkStep } from '../src/step.ts';
import type { Node } from '../src/node.ts';

const s = basicSchema;
const doc = (...content: Node[]) => s.node('doc', null, content);
const p = (...content: Node[]) => s.node('paragraph', null, content);
const t = (text: string, ...marks: Mark[]) => s.text(text, marks);
const em = s.mark('em');
const rule = () => s.node('horizontal_rule');

const textOf = (node: Node) => node.textBetween(0, node.content.size, '|');
const sliceOf = (...nodes: Node[]) => new Slice(Fragment.from(nodes), 0, 0);

describe('a text selection', () => {
  it('orders its ends by position while remembering which one moves', () => {
    const d = doc(p(t('abcd')));
    // Dragging leftwards: the anchor is where the drag began, so it is the
    // larger of the two, and `from`/`to` still come back in document order.
    const backwards = TextSelection.create(d, 4, 2);
    expect(backwards.anchor).toBe(4);
    expect(backwards.head).toBe(2);
    expect(backwards.from).toBe(2);
    expect(backwards.to).toBe(4);
    expect(backwards.empty).toBe(false);
  });

  it('is empty, and prints as a cursor, when both ends coincide', () => {
    const d = doc(p(t('abcd')));
    const cursor = TextSelection.create(d, 3);
    expect(cursor.empty).toBe(true);
    expect(cursor.from).toBe(3);
    expect(String(cursor)).toBe('cursor(3)');
    expect(String(TextSelection.create(d, 2, 4))).toBe('selection(2..4)');
  });

  it('compares by both ends, so a reversed selection is a different one', () => {
    const d = doc(p(t('abcd')));
    expect(TextSelection.create(d, 2, 4).eq(TextSelection.create(d, 2, 4))).toBe(true);
    expect(TextSelection.create(d, 2, 4).eq(TextSelection.create(d, 4, 2))).toBe(false);
  });

  it('snaps to somewhere a cursor can actually be', () => {
    // Position 0 is between the document's start and a horizontal rule, which
    // is not inline content: no cursor belongs there. The nearest place one
    // does belong is inside the paragraph after it.
    const d = doc(rule(), p(t('ab')));
    expect(TextSelection.atStart(d).anchor).toBe(2);
  });

  it('snaps a stray head towards the anchor rather than past it', () => {
    // The head lands on the boundary between the two paragraphs, which is not
    // a text position. Snapping it away from the anchor would grow the
    // selection over content that was never selected.
    const d = doc(p(t('ab')), p(t('cd')));
    const forwards = TextSelection.create(d, 2, 4);
    expect(forwards.to).toBe(3);

    const backwards = TextSelection.create(d, 6, 4);
    expect(backwards.from).toBe(5);
  });

  it('clamps rather than throwing in a document with nowhere to put a cursor', () => {
    // `doc(horizontal_rule)` is a legal document with no inline content at
    // all. Every command checks the parent it landed in anyway, so the honest
    // answer is a clamped position rather than an exception mid-change.
    const d = doc(rule());
    expect(TextSelection.atStart(d).anchor).toBe(0);
  });
});

describe('a transaction carrying its selection', () => {
  it('leaves a selection alone when the change is nowhere near it', () => {
    const d = doc(p(t('abcd')), p(t('efgh')));
    const state = EditorState.create(d, TextSelection.create(d, 8, 9));
    const tr = state.tr();

    // Two positions removed from the first paragraph. The selection is in the
    // second, so it shifts by exactly that and keeps its width.
    tr.delete(1, 3);
    expect(textOf(tr.doc)).toBe('cd|efgh');
    expect(tr.selection.from).toBe(6);
    expect(tr.selection.to).toBe(7);
  });

  it('carries a cursor along with text typed in front of it', () => {
    const d = doc(p(t('abcd')));
    const state = EditorState.create(d, TextSelection.create(d, 5));
    const tr = state.tr();

    tr.insertText(1, 'XX');
    expect(tr.selection.anchor).toBe(7);
  });

  it('maps each step as it is taken, not the whole change from the start', () => {
    // The distinction this pins: after the second step the selection is
    // already in the first step's coordinates, so only the second step's map
    // may be applied to it. Re-running the whole mapping over the mapped
    // selection would count the first insertion twice.
    // The cursor is deliberately not at the end of the document: a
    // double-mapped position past the end would be clamped back into range,
    // and the mistake would hide behind the clamp.
    const d = doc(p(t('abcdefgh')));
    const state = EditorState.create(d, TextSelection.create(d, 5));
    const tr = state.tr();

    tr.insertText(1, 'XX');
    tr.insertText(1, 'YY');

    expect(textOf(tr.doc)).toBe('YYXXabcdefgh');
    // Four characters went in before the cursor, so it moved by four.
    expect(tr.selection.anchor).toBe(9);
  });

  it('collapses a selection onto an edge of what replaced it', () => {
    const d = doc(p(t('abcdef')));
    const state = EditorState.create(d, TextSelection.create(d, 3, 5));
    const tr = state.tr();

    // The whole selection is strictly inside the replaced range, so there is
    // no "where it was" left to map to.
    tr.replace(2, 6, sliceOf(t('Z')));
    expect(textOf(tr.doc)).toBe('aZf');
    expect(tr.selection.empty).toBe(true);
    expect(tr.selection.anchor).toBe(3);
  });

  it('does not move a selection for a step that moves nothing', () => {
    const d = doc(p(t('abcd')));
    const state = EditorState.create(d, TextSelection.create(d, 2, 4));
    const tr = state.tr();

    expect(tr.step(new AddMarkStep(1, 3, em)).ok).toBe(true);
    expect(tr.selection.from).toBe(2);
    expect(tr.selection.to).toBe(4);
    expect(tr.selectionChanged).toBe(false);
  });

  it('re-snaps a mapped selection that landed somewhere no cursor belongs', () => {
    // The paragraph the cursor was in is replaced by a rule. The map's answer
    // is the position the rule now occupies, which is not inline content, so
    // the selection moves to the nearest place it can be.
    const d = doc(p(t('ab')), p(t('cd')));
    const state = EditorState.create(d, TextSelection.create(d, 2));
    const tr = state.tr();

    expect(tr.replace(0, 4, sliceOf(rule())).ok).toBe(true);
    expect(String(tr.doc)).toBe('doc(horizontal_rule, paragraph("cd"))');
    expect(tr.selection.anchor).toBe(2);
  });

  it('remembers the selection it began with, and whether it moved', () => {
    const d = doc(p(t('abcd')));
    const state = EditorState.create(d, TextSelection.create(d, 2));
    const tr = state.tr();

    expect(tr.selectionBefore.anchor).toBe(2);
    expect(tr.selectionChanged).toBe(false);
    tr.setSelection(TextSelection.create(tr.doc, 4));
    expect(tr.selectionChanged).toBe(true);
    expect(tr.selectionBefore.anchor).toBe(2);
  });

  it('reports the range it first replaced in the coordinates it started from', () => {
    const d = doc(p(t('abcdef')));
    const state = EditorState.create(d, TextSelection.create(d, 2));
    const tr = state.tr();

    tr.delete(2, 4);
    tr.insertText(2, 'XYZ');

    // Only the first step is in the starting document's coordinates, which is
    // the only space a previous transaction could be compared against. 2..4 is
    // "bc" in the document this began from.
    expect(tr.firstReplacedRange).toEqual({ from: 2, to: 4 });
    expect(textOf(tr.doc)).toBe('aXYZdef');
  });

  it('reports what it wrote in the coordinates of the document it produced', () => {
    const d = doc(p(t('abcdef')));
    const state = EditorState.create(d, TextSelection.create(d, 2));
    const tr = state.tr();

    tr.delete(2, 4);
    tr.insertText(2, 'XYZ');

    // 2..5 is "XYZ" in the finished document — the space the *next*
    // transaction will be compared in.
    expect(tr.changedRange).toEqual({ from: 2, to: 5 });
    expect(tr.doc.textBetween(2, 5, '')).toBe('XYZ');
  });

  it('widens the changed range to cover every step, not just the last', () => {
    // Two edits in different places. Reporting only what the last step wrote
    // would hand a history a range that does not contain the first edit, and
    // the two changes would look non-adjacent when they are one transaction.
    const d = doc(p(t('abcdef')));
    const tr = EditorState.create(d).tr();

    tr.insertText(2, 'X');
    tr.insertText(6, 'Y');

    expect(textOf(tr.doc)).toBe('aXbcdYef');
    // The earlier edit's range has been carried through the later step's map,
    // so both ends are in the finished document's coordinates.
    expect(tr.changedRange).toEqual({ from: 2, to: 7 });
  });

  it('has no ranges to report before anything is replaced', () => {
    const d = doc(p(t('abcd')));
    const tr = EditorState.create(d).tr();
    expect(tr.firstReplacedRange).toBe(null);
    expect(tr.changedRange).toBe(null);
  });

  it('counts the text a mark rewrote as changed, though not as replaced', () => {
    // A mark moves nothing, so there is no replacement for a history to
    // compare. It does rewrite the text it covers, and a view drawing from
    // this range that left it out would show the text without the mark.
    const d = doc(p(t('abcdef')));
    const tr = EditorState.create(d).tr();

    tr.insertText(2, 'X');
    tr.addMark(5, 7, em);

    expect(String(tr.doc)).toBe('doc(paragraph("aXbc", em("de"), "f"))');
    expect(tr.firstReplacedRange).toEqual({ from: 2, to: 2 });
    expect(tr.changedRange).toEqual({ from: 2, to: 7 });

    const marked = EditorState.create(d).tr();
    marked.addMark(1, 3, em);
    expect(marked.firstReplacedRange).toBe(null);
    expect(marked.changedRange).toEqual({ from: 1, to: 3 });
  });

  it('refuses to be grouped with what came before it only when asked', () => {
    const tr = EditorState.create(doc(p(t('ab')))).tr();
    expect(tr.historyClosed).toBe(false);
    tr.closeHistory();
    expect(tr.historyClosed).toBe(true);
  });

  it('is unchanged by a step it refused', () => {
    const d = doc(p(t('ab')), p(t('cd')));
    const state = EditorState.create(d, TextSelection.create(d, 2));
    const tr = state.tr();

    expect(tr.replace(2, 6, Slice.empty).ok).toBe(false);
    expect(tr.doc).toBe(d);
    expect(tr.selection.anchor).toBe(2);
    expect(tr.changed).toBe(false);
  });
});

describe('an editor state', () => {
  it('starts with a cursor at the first place one can go', () => {
    const state = EditorState.create(doc(p(t('ab'))));
    expect(state.selection.anchor).toBe(1);
    expect(state.selection.empty).toBe(true);
  });

  it('takes the selection from the transaction rather than deriving it again', () => {
    const d = doc(p(t('abcd')));
    const state = EditorState.create(d, TextSelection.create(d, 5));
    const tr = state.tr();
    tr.insertText(1, 'XX');

    const next = state.apply(tr);
    expect(textOf(next.doc)).toBe('XXabcd');
    expect(next.selection.anchor).toBe(7);
    // The state it came from is untouched, which is what a history entry holds.
    expect(textOf(state.doc)).toBe('abcd');
    expect(state.selection.anchor).toBe(5);
  });

  it('gives itself back when a transaction did nothing at all', () => {
    const state = EditorState.create(doc(p(t('ab'))));
    expect(state.apply(state.tr())).toBe(state);
  });

  it('produces a new state for a transaction that only moved the selection', () => {
    const d = doc(p(t('abcd')));
    const state = EditorState.create(d, TextSelection.create(d, 2));
    const tr = state.tr().setSelection(TextSelection.create(d, 4));

    const next = state.apply(tr);
    expect(next).not.toBe(state);
    expect(next.doc).toBe(state.doc);
    expect(next.selection.anchor).toBe(4);
  });

  it('refuses a selection made for a different document', () => {
    // A selection is two numbers with nothing to say which document they were
    // counted in. Kept as given, one from a longer document points past the
    // end of this one, and one from a differently shaped document can sit on a
    // block boundary — where backspace takes the whole block before it.
    const long = doc(p(t('abcdefgh')));
    const short = doc(p(t('ab')));
    expect(() => EditorState.create(short, TextSelection.create(long, 7))).toThrow(RangeError);

    const flat = doc(p(t('abcdef')));
    const blocks = doc(p(t('ab')), p(t('cd')));
    expect(() => EditorState.create(blocks, TextSelection.create(flat, 4))).toThrow(RangeError);
  });

  it('keeps a selection made for the same document as it was given', () => {
    const d = doc(p(t('abcd')), p(t('ef')));
    const selection = TextSelection.create(d, 8, 2);
    expect(EditorState.create(d, selection).selection).toBe(selection);
  });

  it('refuses a transaction started from a different document', () => {
    const state = EditorState.create(doc(p(t('ab'))));
    const other = EditorState.create(doc(p(t('zz'))));
    expect(() => other.apply(state.tr())).toThrow(/different document/);
  });

  it('hands out a fresh transaction every time', () => {
    const state = EditorState.create(doc(p(t('ab'))));
    const first = state.tr();
    const second = state.tr();
    expect(first).not.toBe(second);
    expect(first).toBeInstanceOf(EditorTransaction);
    expect(second.startDoc).toBe(state.doc);
  });
});
