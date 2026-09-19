/**
 * Replacing content directly in the document.
 *
 * This is the case `step.test.ts` never reached, and it is not an exotic one:
 * every structural edit an editor makes at the top level is a replacement
 * whose two ends resolve at depth zero. Splitting a paragraph is "replace this
 * block with two blocks"; joining two is "replace these two with one";
 * deleting a rule between paragraphs is "replace it with nothing". All three
 * are replacements in the document's own content, and none of them could be
 * applied — `ReplaceStep.apply` asked for the position before the node it had
 * rewritten, and at depth zero that node is the document, which has no
 * position before it.
 *
 * The failure was an exception rather than a wrong answer, so nothing above it
 * was subtly wrong; the whole commands layer simply could not run. These tests
 * exist so that the depth-zero path is exercised by the step layer itself
 * rather than only through the commands that happen to use it.
 */

import { describe, expect, it } from 'vitest';
import { Fragment, Schema, Slice, basicSchema } from '../src/index.ts';
import { AddMarkStep, ReplaceStep, Transaction } from '../src/step.ts';
import type { Node } from '../src/node.ts';

const s = basicSchema;
const doc = (...content: Node[]) => s.node('doc', null, content);
const p = (...content: Node[]) => s.node('paragraph', null, content);
const t = (text: string) => s.text(text);
const em = s.mark('em');
const rule = () => s.node('horizontal_rule');

const sliceOf = (...nodes: Node[]) => new Slice(Fragment.from(nodes), 0, 0);
const ok = (result: { ok: boolean }) => {
  if (!result.ok) throw new Error(`step failed: ${(result as { reason: string }).reason}`);
  return (result as unknown as { doc: Node }).doc;
};

describe('a replacement in the document itself', () => {
  it('puts a new block in between two others', () => {
    const before = doc(p(t('ab')), p(t('cd')));
    const after = ok(new ReplaceStep(4, 4, sliceOf(p(t('xy')))).apply(before));
    expect(String(after)).toBe('doc(paragraph("ab"), paragraph("xy"), paragraph("cd"))');
  });

  it('takes a whole block out', () => {
    const before = doc(p(t('ab')), rule(), p(t('cd')));
    const after = ok(new ReplaceStep(4, 5, Slice.empty).apply(before));
    expect(String(after)).toBe('doc(paragraph("ab"), paragraph("cd"))');
  });

  it('turns one block into two, which is what splitting a paragraph is', () => {
    const before = doc(p(t('abcd')));
    const after = ok(new ReplaceStep(0, 6, sliceOf(p(t('ab')), p(t('cd')))).apply(before));
    expect(String(after)).toBe('doc(paragraph("ab"), paragraph("cd"))');
  });

  it('turns two blocks into one, which is what joining them is', () => {
    const before = doc(p(t('ab')), p(t('cd')));
    const after = ok(new ReplaceStep(0, 8, sliceOf(p(t('abcd')))).apply(before));
    expect(String(after)).toBe('doc(paragraph("abcd"))');
  });

  it('leaves the document it was applied to alone', () => {
    const before = doc(p(t('ab')), p(t('cd')));
    ok(new ReplaceStep(0, 8, sliceOf(p(t('abcd')))).apply(before));
    expect(String(before)).toBe('doc(paragraph("ab"), paragraph("cd"))');
  });

  it('inverts back to the document it started from', () => {
    const before = doc(p(t('ab')), p(t('cd')));
    const step = new ReplaceStep(0, 8, sliceOf(p(t('abcd'))));
    const after = ok(step.apply(before));
    expect(String(ok(step.invert(before).apply(after)))).toBe('doc(paragraph("ab"), paragraph("cd"))');
  });

  it('still refuses content the document cannot hold', () => {
    // The depth-zero path must not be a way around the schema.
    const before = doc(p(t('ab')));
    const result = new ReplaceStep(0, 4, sliceOf(t('bare'))).apply(before);
    expect(result.ok).toBe(false);
  });

  it('reports where the positions after it went', () => {
    const tr = new Transaction(doc(p(t('ab')), p(t('cd'))));
    expect(tr.replace(0, 4, Slice.empty).ok).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("cd"))');
    expect(tr.map(5)).toBe(1);
  });

  it('applies a mark step whose ends are in the document too', () => {
    // A document whose own content is text, so the mark step rewrites the
    // document itself — the node with no position before it.
    const flat = new Schema({ nodes: { doc: { content: 'text*' }, text: {} }, marks: { em: {} } });
    const before = flat.node('doc', null, [flat.text('abcd')]);
    const after = ok(new AddMarkStep(1, 3, flat.mark('em')).apply(before));
    expect(String(after)).toBe('doc("a", em("bc"), "d")');
  });

  it('refuses, rather than throws, a mark step over blocks directly in the document', () => {
    // Nothing directly in this document is text, so there is nothing for the
    // mark to change — which is an answer, not an exception on the way.
    const result = new AddMarkStep(0, 4, em).apply(doc(p(t('ab'))));
    expect(result.ok).toBe(false);
  });
});
