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
