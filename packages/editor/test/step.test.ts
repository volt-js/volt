/**
 * Changes as values, and the arithmetic that carries positions across them.
 *
 * The reason to test this layer hard is that nothing above it can be right if
 * it is wrong, and nothing above it exists yet to notice. A selection, an undo
 * history and — the case the roadmap says cannot be retrofitted — a rebase are
 * all position arithmetic over these maps. A step that applied but mapped its
 * own positions wrongly produces a document that looks correct and a cursor in
 * the wrong place, which is the failure nobody attributes to this file.
 *
 * So the shape of most of these is: take a step, then assert both halves —
 * what the document became, and where a position that was somewhere specific
 * has gone.
 */

import { describe, expect, it } from 'vitest';
import { Fragment, Mark, Slice, basicSchema, resolve } from '../src/index.ts';
import {
  AddMarkStep,
  Mapping,
  RemoveMarkStep,
  ReplaceStep,
  StepMap,
  Transaction,
} from '../src/step.ts';

const s = basicSchema;
const doc = (...content: any[]) => s.node('doc', null, content);
const p = (...content: any[]) => s.node('paragraph', null, content);
const t = (text: string, ...marks: Mark[]) => s.text(text, marks);
const em = s.mark('em');
const strong = s.mark('strong');

const sliceOf = (...nodes: any[]) => new Slice(Fragment.from(nodes), 0, 0);
const textOf = (node: any) => node.textBetween(0, node.content.size, '');

describe('a step map', () => {
  it('shifts what is after a change and leaves what is before it', () => {
    // Two positions removed at 3, one inserted.
    const map = StepMap.replace(3, 2, 1);
    expect(map.map(1)).toBe(1);
    expect(map.map(3)).toBe(3);
    expect(map.map(7)).toBe(6);
  });

  it('collapses a position that was inside what went, to the side asked for', () => {
    const map = StepMap.replace(3, 4, 0);
    // There is no "where it was" left, so the answer is an edge, and which
    // edge is the caller's to choose.
    expect(map.map(5, -1)).toBe(3);
    expect(map.map(5, 1)).toBe(3);
    expect(map.deletedAt(5)).toBe(true);
    expect(map.deletedAt(3)).toBe(false);
  });

  it('puts a position at the boundary on the side its association names', () => {
    const map = StepMap.replace(3, 0, 4);
    // Nothing was removed, so a cursor at 3 is either before what was typed or
    // after it, and both are defensible — which is what `assoc` is for.
    expect(map.map(3, -1)).toBe(3);
    expect(map.map(3, 1)).toBe(7);
  });

  it('inverts against the document it produced', () => {
    const map = StepMap.replace(3, 2, 5);
    const back = map.invert();
    expect(map.map(10)).toBe(13);
    expect(back.map(13)).toBe(10);
  });

  it('reads every range of a map in the coordinates of the document it applies to', () => {
    // Three inserted at 2 and one at 10, both counted in the document before
    // the change. Comparing a position with a later range's start shifted by
    // the earlier ranges compares two coordinate systems with each other, and
    // 11 comes out as though it were still before the second insertion.
    const map = new StepMap([
      { start: 2, oldSize: 0, newSize: 3 },
      { start: 10, oldSize: 4, newSize: 1 },
    ]);
    expect(map.map(9)).toBe(12);
    expect(map.map(12, -1)).toBe(13);
    expect(map.map(12, 1)).toBe(14);
    expect(map.map(15)).toBe(15);
    expect(map.deletedAt(12)).toBe(true);
    expect(map.deletedAt(16)).toBe(false);

    const back = map.invert();
    expect(back.map(15)).toBe(15);
    expect(back.map(3, -1)).toBe(2);

    // And a position the second range took out is found again in what the
    // inverse puts back, the same distance in.
    const mapping = new Mapping();
    mapping.appendMap(map);
    mapping.appendMap(back, 0);
    expect(mapping.map(12)).toBe(12);
  });
});

describe('a mapping', () => {
  it('carries a position through every map in order', () => {
    const mapping = new Mapping();
    mapping.appendMap(StepMap.replace(0, 0, 2));
    mapping.appendMap(StepMap.replace(0, 0, 3));
    expect(mapping.map(1)).toBe(6);
  });

  it('gives a position back unchanged across a change and its own undo', () => {
    // The point of the mirror bookkeeping. Without it the position collapses
    // to an edge inside the first map and never recovers, so an undo would
    // silently move every cursor that was inside what it restored.
    const mapping = new Mapping();
    mapping.appendMap(StepMap.replace(2, 4, 0));
    mapping.appendMap(StepMap.replace(2, 0, 4), 0);
    expect(mapping.map(4)).toBe(4);
  });

  it('gives back a position on the edge of what was deleted and put back, as well', () => {
    // An edge survives the deletion, and then the undo inserts at exactly that
    // point — and would push a position that leans towards the insertion to
    // the far side of text it was never on the far side of.
    const mapping = new Mapping();
    mapping.appendMap(StepMap.replace(2, 4, 0));
    mapping.appendMap(StepMap.replace(2, 0, 4), 0);

    expect(mapping.map(2, 1)).toBe(2);
    expect(mapping.map(6, -1)).toBe(6);
    // Leaning away from the insertion, either edge stays where it is anyway.
    expect(mapping.map(2, -1)).toBe(2);
    expect(mapping.map(6, 1)).toBe(6);
  });

  it('does not move a position off an insertion for the sake of its undo', () => {
    // An insertion deletes nothing, so there is nothing of it to find again
    // in the deletion that undoes it — here after someone else typed three
    // characters at the same point, which a position leaning back from both
    // insertions stays in front of.
    const mapping = new Mapping();
    mapping.appendMap(StepMap.replace(2, 0, 4));
    mapping.appendMap(StepMap.replace(2, 0, 3));
    mapping.appendMap(StepMap.replace(5, 4, 0), 0);

    expect(mapping.map(2, -1)).toBe(2);
    expect(mapping.map(2, 1)).toBe(5);
  });

  it('keeps what was mapped between a change and its undo', () => {
    // A deletion, someone else's insertion before it, then the deletion undone
    // after that insertion. Skipping from the deletion straight to its undo
    // would skip the insertion too, and the position would come out as if the
    // three characters in front of it had never been typed.
    const mapping = new Mapping();
    mapping.appendMap(StepMap.replace(2, 4, 0));
    mapping.appendMap(StepMap.replace(0, 0, 3));
    mapping.appendMap(StepMap.replace(5, 0, 4), 0);

    // Position 4 was two into what the deletion took, and the undo puts that
    // back at 5 — so it is two into that.
    expect(mapping.map(4)).toBe(7);
    // A position the deletion never touched maps through all three as usual.
    expect(mapping.map(8)).toBe(11);
  });

  it('inverts in the opposite order, mirrors included', () => {
    const mapping = new Mapping();
    mapping.appendMap(StepMap.replace(0, 0, 2));
    mapping.appendMap(StepMap.replace(5, 1, 0));
    const there = mapping.map(8);
    expect(mapping.invert().map(there)).toBe(8);
  });
});

describe('replacing content', () => {
  it('puts the new content in and reports where everything moved', () => {
    const before = doc(p(t('abcd')));
    const tr = new Transaction(before);
    const result = tr.replace(2, 4, sliceOf(t('XYZ')));

    expect(result.ok).toBe(true);
    expect(textOf(tr.doc)).toBe('aXYZd');
    // The document it began with is untouched: a step produces a document
    // rather than changing one.
    expect(textOf(before)).toBe('abcd');
    expect(tr.map(5)).toBe(6);
  });

  it('undoes itself against the document it applied to', () => {
    const before = doc(p(t('abcd')));
    const step = new ReplaceStep(2, 4, sliceOf(t('XYZ')));
    const applied = step.apply(before);
    expect(applied.ok).toBe(true);

    const back = step.invert(before).apply(applied.ok ? applied.doc : before);
    expect(back.ok).toBe(true);
    expect(textOf(back.ok ? back.doc : before)).toBe('abcd');
  });

  it('refuses a replacement across two parents rather than half-doing it', () => {
    const before = doc(p(t('ab')), p(t('cd')));
    const result = new ReplaceStep(2, 6, Slice.empty).apply(before);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/different parents/);
  });

  it('refuses content the parent cannot hold', () => {
    const before = doc(p(t('ab')));
    const result = new ReplaceStep(1, 1, sliceOf(p(t('x')))).apply(before);
    expect(result.ok).toBe(false);
  });

  it('leaves the transaction untouched when a step is refused', () => {
    const tr = new Transaction(doc(p(t('ab')), p(t('cd'))));
    const was = tr.doc;
    expect(tr.replace(2, 6, Slice.empty).ok).toBe(false);
    expect(tr.doc).toBe(was);
    expect(tr.changed).toBe(false);
  });

  it('rewrites itself to apply after someone else’s change', () => {
    // The operation a rebase is made of: the same edit, moved onto a document
    // it was not written against.
    const step = new ReplaceStep(5, 7, sliceOf(t('Z')));
    const mapping = new Mapping();
    mapping.appendMap(StepMap.replace(0, 0, 3));

    const moved = step.map(mapping) as ReplaceStep;
    expect(moved.from).toBe(8);
    expect(moved.to).toBe(10);
  });

  it('has nothing left to do when its range was deleted under it', () => {
    const step = new ReplaceStep(4, 8, Slice.empty);
    const mapping = new Mapping();
    mapping.appendMap(StepMap.replace(2, 10, 0));
    expect(step.map(mapping)).toBe(null);
  });

  it('keeps an insertion that lands where someone else inserted first', () => {
    // Two people typing at the same place. The start of an insertion goes
    // after the other text and its end, asked for with the other association,
    // stays before it — so the two ends cross, and taking that for a range
    // that closed up drops one person's text.
    const step = new ReplaceStep(5, 5, sliceOf(t('Z')));
    const mapping = new Mapping();
    mapping.appendMap(StepMap.replace(5, 0, 3));

    const moved = step.map(mapping) as ReplaceStep | null;
    expect(moved).not.toBe(null);
    expect(moved!.from).toBe(8);
    expect(moved!.to).toBe(8);
    expect(moved!.slice.eq(step.slice)).toBe(true);
  });
});

describe('marks', () => {
  it('adds a mark across a range without moving anything', () => {
    const tr = new Transaction(doc(p(t('abcd'))));
    expect(tr.addMark(2, 4, em).ok).toBe(true);

    expect(textOf(tr.doc)).toBe('abcd');
    expect(resolve(tr.doc, 3).marks().some((m) => m.eq(em))).toBe(true);
    expect(resolve(tr.doc, 5).marks().some((m) => m.eq(em))).toBe(false);
    // Positions are untouched, which is the whole difference from a replace.
    expect(tr.map(4)).toBe(4);
  });

  it('takes one back off again', () => {
    const tr = new Transaction(doc(p(t('abcd', em))));
    expect(tr.removeMark(2, 4, em).ok).toBe(true);
    expect(resolve(tr.doc, 3).marks().some((m) => m.eq(em))).toBe(false);
  });

  it('inverts to the opposite step', () => {
    expect(new AddMarkStep(1, 3, em).invert()).toBeInstanceOf(RemoveMarkStep);
    expect(new RemoveMarkStep(1, 3, em).invert()).toBeInstanceOf(AddMarkStep);
  });

  it('refuses a mark the parent does not allow, as a replacement would', () => {
    // A code block declares `marks: ""`. Rewriting its text with bold in it
    // builds a code block its own schema refuses at construction.
    const before = doc(s.node('code_block', null, [t('let x')]));
    const tr = new Transaction(before);

    const result = tr.addMark(1, 4, strong);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/code_block/);
    expect(tr.changed).toBe(false);
    expect(tr.doc).toBe(before);

    expect(new AddMarkStep(1, 4, strong).apply(before).ok).toBe(false);
  });

  it('throws for a range that ends before it starts, as a replacement does', () => {
    // Taken as given, 4..2 is two cuts that overlap, and the text between them
    // comes out twice.
    expect(() => new AddMarkStep(4, 2, em)).toThrow(RangeError);
    expect(() => new RemoveMarkStep(4, 2, em)).toThrow(RangeError);
    expect(() => new Transaction(doc(p(t('abcd')))).addMark(4, 2, em)).toThrow(RangeError);
    expect(() => new Transaction(doc(p(t('abcd', em)))).removeMark(4, 2, em)).toThrow(RangeError);
  });

  it('takes no step for a mark that would change nothing', () => {
    // A step is what `changed` counts and what a history records, so a step
    // that did nothing is an undo unit that undoes nothing.
    const already = new Transaction(doc(p(t('ab', em))));
    expect(already.addMark(1, 3, em).ok).toBe(false);
    expect(already.changed).toBe(false);

    const empty = new Transaction(doc(p(t('ab'))));
    expect(empty.addMark(2, 2, em).ok).toBe(false);
    expect(empty.changed).toBe(false);

    const absent = new Transaction(doc(p(t('ab'))));
    expect(absent.removeMark(1, 3, em).ok).toBe(false);
    expect(absent.changed).toBe(false);

    expect(new AddMarkStep(1, 3, em).apply(doc(p(t('ab', em)))).ok).toBe(false);
    expect(new RemoveMarkStep(1, 3, em).apply(doc(p(t('ab')))).ok).toBe(false);
  });
});

describe('undoing a mark', () => {
  /** Write a transaction over `before`, then apply its inverse, and return what comes back. */
  function roundTrip(before: any, write: (tr: Transaction) => { ok: boolean }): any {
    const tr = new Transaction(before);
    expect(write(tr).ok).toBe(true);
    let current = tr.doc;
    for (const step of tr.invert(before)) {
      const result = step.apply(current);
      if (!result.ok) throw new Error(result.reason);
      current = result.doc;
    }
    return current;
  }

  it('leaves the bold that was there before bold was laid across it', () => {
    const before = doc(p(t('ab'), t('cd', strong), t('ef')));
    const after = roundTrip(before, (tr) => tr.addMark(1, 7, strong));
    expect(String(after)).toBe('doc(paragraph("ab", strong("cd"), "ef"))');
  });

  it('gives back the link a new link replaced', () => {
    const before = doc(p(t('abcd', s.mark('link', { href: 'a' }))));
    const after = roundTrip(before, (tr) => tr.addMark(2, 4, s.mark('link', { href: 'b' })));
    expect(after.eq(before)).toBe(true);
  });

  it('gives back the emphasis code threw off', () => {
    const before = doc(p(t('ab'), t('cd', em)));
    const after = roundTrip(before, (tr) => tr.addMark(1, 5, s.mark('code')));
    expect(String(after)).toBe('doc(paragraph("ab", em("cd")))');
  });

  it('marks only what was marked when a removal is undone', () => {
    const before = doc(p(t('ab'), t('cd', em), t('ef')));
    const after = roundTrip(before, (tr) => tr.removeMark(1, 7, em));
    expect(String(after)).toBe('doc(paragraph("ab", em("cd"), "ef"))');
  });

  it('refuses a hand-built step whose opposite would not give the text back', () => {
    // Bold laid over text that is partly bold already: the opposite step takes
    // bold off all of it, so the step is refused rather than taken with an
    // undo that is wrong. `Transaction.addMark` splits the range instead.
    const before = doc(p(t('ab'), t('cd', strong)));
    expect(new AddMarkStep(1, 5, strong).apply(before).ok).toBe(false);
    expect(new RemoveMarkStep(1, 5, strong).apply(before).ok).toBe(false);
  });
});

describe('a transaction', () => {
  it('collects its steps and composes their maps', () => {
    const tr = new Transaction(doc(p(t('abcd'))));
    tr.insertText(1, 'XX');
    tr.delete(6, 7);

    expect(tr.steps).toHaveLength(2);
    expect(textOf(tr.doc)).toBe('XXabc');
    expect(tr.map(1, -1)).toBe(1);
  });

  it('inverts to the steps that undo it, newest first', () => {
    const before = doc(p(t('abcd')));
    const tr = new Transaction(before);
    tr.insertText(1, 'XY');
    tr.addMark(1, 3, em);

    let doc2 = tr.doc;
    for (const step of tr.invert(before)) {
      const result = step.apply(doc2);
      expect(result.ok).toBe(true);
      if (result.ok) doc2 = result.doc;
    }
    expect(textOf(doc2)).toBe('abcd');
    expect(resolve(doc2, 2).marks()).toHaveLength(0);
  });

  it('does nothing, and says so, for text that is not there', () => {
    const tr = new Transaction(doc(p(t('ab'))));
    expect(tr.insertText(1, '').ok).toBe(true);
    expect(tr.changed).toBe(false);
  });
});
