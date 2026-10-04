/**
 * Node selections: a whole node selected as one object, rather than a range of
 * text that happens to cover it.
 *
 * The claims pinned here are the ones a text selection already has, held to the
 * same standard. It is two positions, ordered and compared like any selection,
 * printed and serialised so a host can store one and get it back. It is carried
 * across a change by the position maps the change produced — never re-derived —
 * so text typed at either edge stays outside it, and the node it held going
 * away leaves a selection over whatever replaced it rather than a dangling one.
 * The arrow keys step onto a node and off it again, and the delete keys take it
 * away in one step, which is one undo.
 */

import { describe, expect, it } from 'vitest';
import { EditorSelection, Fragment, NodeSelection, Slice, basicSchema } from '../src/index.ts';
import type { Mark } from '../src/index.ts';
import { deleteBackward, deleteForward, insertText } from '../src/commands.ts';
import { EditorHistory } from '../src/history.ts';
import type { Node } from '../src/node.ts';
import { findSelection, selectHorizontally, selectVertically } from '../src/selection.ts';
import { EditorState, TextSelection } from '../src/state.ts';
import { Mapping, ReplaceStep } from '../src/step.ts';

const s = basicSchema;
const doc = (...content: Node[]) => s.node('doc', null, content);
const p = (...content: Node[]) => s.node('paragraph', null, content);
const t = (text: string, ...marks: Mark[]) => s.text(text, marks);
const quote = (...content: Node[]) => s.node('blockquote', null, content);
const rule = () => s.node('horizontal_rule');
const image = (src = 'a.png') => s.node('image', { src });
const br = () => s.node('hard_break');

// 0 <p> 1 a 2 b 3 [img] 4 c 5 d 6 </p> 7
const withImage = doc(p(t('ab'), image(), t('cd')));
// 0 <p> 1 a 2 b 3 </p> 4 [hr] 5 <p> 6 c 7 d 8 </p> 9
const withRule = doc(p(t('ab')), rule(), p(t('cd')));

/** A transaction from a state whose selection is `selection`. */
const from = (selection: EditorSelection) => EditorState.create(selectionDoc.get(selection)!, selection).tr();
const selectionDoc = new Map<EditorSelection, Node>();
function select<T extends EditorSelection>(document: Node, selection: T): T {
  selectionDoc.set(selection, document);
  return selection;
}
const cursor = (document: Node, pos: number) => select(document, TextSelection.create(document, pos));
const nodeAt = (document: Node, pos: number) => select(document, NodeSelection.create(document, pos));

describe('a node selection', () => {
  it('covers exactly the node after its position', () => {
    const selected = NodeSelection.create(withImage, 3);
    expect(selected.node.type.name).toBe('image');
    expect([selected.anchor, selected.head, selected.from, selected.to]).toEqual([3, 4, 3, 4]);
    expect(selected.empty).toBe(false);
    expect(selected).toBeInstanceOf(EditorSelection);
  });

  it('selects a block node the same way', () => {
    const selected = NodeSelection.create(withRule, 4);
    expect(selected.node.type.name).toBe('horizontal_rule');
    expect([selected.from, selected.to]).toEqual([4, 5]);
  });

  it('selects a block with content when asked, though nothing in the view selects one', () => {
    const selected = NodeSelection.create(withRule, 0);
    expect(selected.node.type.name).toBe('paragraph');
    expect([selected.from, selected.to]).toEqual([0, 4]);
  });

  it('refuses a position with no node it could select after it', () => {
    // Inside text, at the end of a parent, and before a hard break — which is
    // a character to step over rather than an object to select.
    expect(() => NodeSelection.create(withImage, 2)).toThrow(RangeError);
    expect(() => NodeSelection.create(withImage, 6)).toThrow(RangeError);
    const broken = doc(p(t('a'), br(), t('b')));
    expect(() => NodeSelection.create(broken, 2)).toThrow(/hard_break/);
  });

  it('prints as the node it holds and where', () => {
    expect(String(NodeSelection.create(withImage, 3))).toBe('node(image@3)');
    expect(String(NodeSelection.create(withRule, 4))).toBe('node(horizontal_rule@4)');
  });

  it('compares by position, and is never equal to a text selection over the same range', () => {
    expect(NodeSelection.create(withImage, 3).eq(NodeSelection.create(withImage, 3))).toBe(true);
    expect(NodeSelection.create(withImage, 3).eq(TextSelection.create(withImage, 3, 4))).toBe(false);
    expect(TextSelection.create(withImage, 3, 4).eq(NodeSelection.create(withImage, 3))).toBe(false);
  });
});

describe('a selection as JSON', () => {
  it('round-trips a text selection, cursor or range, either way round', () => {
    for (const selection of [
      TextSelection.create(withRule, 2),
      TextSelection.create(withRule, 2, 7),
      TextSelection.create(withRule, 7, 2),
    ]) {
      const json = selection.toJSON();
      expect(JSON.parse(JSON.stringify(json))).toEqual(json);
      expect(EditorSelection.fromJSON(withRule, json).eq(selection)).toBe(true);
    }
    expect(TextSelection.create(withRule, 7, 2).toJSON()).toEqual({ type: 'text', anchor: 7, head: 2 });
  });

  it('round-trips a node selection, node and all', () => {
    const json = NodeSelection.create(withImage, 3).toJSON();
    expect(json).toEqual({ type: 'node', anchor: 3 });
    const back = EditorSelection.fromJSON(withImage, json);
    expect(back).toBeInstanceOf(NodeSelection);
    expect((back as NodeSelection).node).toBe(withImage.child(0).child(1));
  });

  it('refuses JSON that does not describe a selection in this document', () => {
    expect(() => EditorSelection.fromJSON(withImage, { type: 'node', anchor: 1 })).toThrow(RangeError);
    // A text end between two blocks is somewhere `TextSelection.create` would
    // have moved, so a selection there was made for some other document.
    expect(() => EditorSelection.fromJSON(withRule, { type: 'text', anchor: 4, head: 4 })).toThrow(RangeError);
    expect(() => EditorSelection.fromJSON(withRule, { type: 'text', anchor: 2, head: 99 })).toThrow(RangeError);
    expect(() => EditorSelection.fromJSON(withRule, { type: 'all' } as never)).toThrow(RangeError);
  });
});

describe('a node selection carried across a change', () => {
  const after = (document: Node, step: ReplaceStep) => {
    const result = step.apply(document);
    if (!result.ok) throw new Error(result.reason);
    return result.doc;
  };
  const mapped = (selection: EditorSelection, document: Node, step: ReplaceStep) => {
    const mapping = new Mapping();
    mapping.appendMap(step.getMap());
    return selection.map(after(document, step), mapping);
  };
  const text = (value: string) => new Slice(Fragment.from(t(value)), 0, 0);

  it('moves with text inserted before it', () => {
    const moved = mapped(NodeSelection.create(withImage, 3), withImage, new ReplaceStep(1, 1, text('XY')));
    expect(String(moved)).toBe('node(image@5)');
  });

  it('keeps text typed at either edge outside it', () => {
    const atStart = mapped(NodeSelection.create(withImage, 3), withImage, new ReplaceStep(3, 3, text('X')));
    expect(String(atStart)).toBe('node(image@4)');
    const atEnd = mapped(NodeSelection.create(withImage, 3), withImage, new ReplaceStep(4, 4, text('X')));
    expect(String(atEnd)).toBe('node(image@3)');
  });

  it('becomes a cursor where the node was when the node is deleted', () => {
    const gone = mapped(NodeSelection.create(withImage, 3), withImage, new ReplaceStep(3, 4, Slice.empty));
    expect(gone).toBeInstanceOf(TextSelection);
    expect(String(gone)).toBe('cursor(3)');
  });

  it('becomes a selection of whatever replaced the node', () => {
    // Typing over a selected image is this: the image goes, the text arrives,
    // and the mapped ends are either side of the text.
    const replaced = mapped(NodeSelection.create(withImage, 3), withImage, new ReplaceStep(3, 4, text('XY')));
    expect(replaced).toBeInstanceOf(TextSelection);
    expect([replaced.from, replaced.to]).toEqual([3, 5]);
  });

  it('lands in the next textblock when a selected block node is deleted', () => {
    const gone = mapped(NodeSelection.create(withRule, 4), withRule, new ReplaceStep(4, 5, Slice.empty));
    expect(String(gone)).toBe('cursor(5)');
  });

  it('comes back a node selection across a deletion and its own undo', () => {
    const step = new ReplaceStep(3, 4, Slice.empty);
    const deleted = after(withImage, step);
    const inverse = step.invert(withImage) as ReplaceStep;
    const restored = after(deleted, inverse);

    const mapping = new Mapping();
    mapping.appendMap(step.getMap());
    mapping.appendMap(inverse.getMap(), 0);
    const back = NodeSelection.create(withImage, 3).map(restored, mapping);
    expect(back).toBeInstanceOf(NodeSelection);
    expect(String(back)).toBe('node(image@3)');
  });

  it('is mapped by a transaction step by step, as a text selection is', () => {
    const tr = from(nodeAt(withRule, 4));
    tr.insertText(1, 'X');
    tr.insertText(1, 'Y');
    expect(String(tr.selection)).toBe('node(horizontal_rule@6)');
  });
});

describe('a state holding a node selection', () => {
  it('takes one made for its document', () => {
    const state = EditorState.create(withImage, NodeSelection.create(withImage, 3));
    expect(state.selection).toBeInstanceOf(NodeSelection);
  });

  it('refuses one made for a different document', () => {
    const other = doc(p(t('ab'), image('b.png'), t('cd')));
    expect(() => EditorState.create(withImage, NodeSelection.create(other, 3))).toThrow(/different document/);
    expect(() => EditorState.create(doc(p(t('abcdef'))), NodeSelection.create(withImage, 3))).toThrow(
      /different document/,
    );
  });

  it('deletes a selected image with backspace, in one step', () => {
    const tr = from(nodeAt(withImage, 3));
    expect(deleteBackward(tr)).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("abcd"))');
    expect(tr.steps).toHaveLength(1);
    expect(String(tr.selection)).toBe('cursor(3)');
  });

  it('deletes a selected rule with forward delete, and leaves the caret in the next block', () => {
    const tr = from(nodeAt(withRule, 4));
    expect(deleteForward(tr)).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("ab"), paragraph("cd"))');
    expect(String(tr.selection)).toBe('cursor(5)');
  });

  it('types over a selected image, leaving the caret after the text', () => {
    const tr = from(nodeAt(withImage, 3));
    expect(insertText(tr, 'XY')).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("abXYcd"))');
    expect(String(tr.selection)).toBe('cursor(5)');
  });

  it('is one undo unit, which brings the node back', () => {
    const history = new EditorHistory({ now: () => 0 });
    let state = EditorState.create(withRule, NodeSelection.create(withRule, 4));
    const tr = state.tr();
    deleteBackward(tr);
    state = state.apply(tr);
    history.record(tr);
    expect(history.undoDepth).toBe(1);

    const undo = history.undo(state)!;
    state = state.apply(undo);
    history.record(undo);
    expect(state.doc.eq(withRule)).toBe(true);
    // The history puts back a text range over the node rather than the node
    // selected: it rebuilds what it recorded with `TextSelection.create`.
    expect(state.selection).toBeInstanceOf(TextSelection);
    expect(state.selection.from).toBeLessThanOrEqual(4);
    expect(state.selection.to).toBeGreaterThanOrEqual(5);
  });

  it('is not deleted when it is all a document holds, since the schema needs a block there', () => {
    const ruleOnly = doc(rule());
    const tr = from(nodeAt(ruleOnly, 0));
    expect(deleteBackward(tr)).toBe(false);
    expect(tr.doc).toBe(ruleOnly);
    expect(tr.changed).toBe(false);
  });
});

describe('finding the nearest selection in a direction', () => {
  it('finds a cursor in the next textblock, or a block node on the way to one', () => {
    expect(String(findSelection(withRule, 4, 1))).toBe('node(horizontal_rule@4)');
    expect(String(findSelection(withRule, 5, 1))).toBe('cursor(6)');
    expect(String(findSelection(withRule, 5, -1))).toBe('node(horizontal_rule@4)');
    expect(String(findSelection(withRule, 4, -1))).toBe('cursor(3)');
  });

  it('goes into and out of containers to get there', () => {
    // 0 <bq> 1 <p> 2 a 3 </p> 4 [hr] 5 </bq> 6 <p> 7 b 8 </p> 9
    const nested = doc(quote(p(t('a')), rule()), p(t('b')));
    expect(String(findSelection(nested, 0, 1))).toBe('cursor(2)');
    expect(String(findSelection(nested, 6, -1))).toBe('node(horizontal_rule@4)');
    expect(String(findSelection(nested, 5, 1))).toBe('cursor(7)');
  });

  it('finds nothing past the edge of the document', () => {
    expect(findSelection(doc(p(t('a')), rule()), 4, 1)).toBeNull();
    expect(findSelection(doc(rule(), p(t('a'))), 0, -1)).toBeNull();
  });
});

describe('the arrow keys and a node', () => {
  const step = (selection: EditorSelection, dir: -1 | 1) => {
    const tr = from(selection);
    return selectHorizontally(tr, dir) ? String(tr.selection) : null;
  };

  it('steps onto an image beside the caret, and off it on the far side', () => {
    expect(step(cursor(withImage, 3), 1)).toBe('node(image@3)');
    expect(step(nodeAt(withImage, 3), 1)).toBe('cursor(4)');
    expect(step(cursor(withImage, 4), -1)).toBe('node(image@3)');
    expect(step(nodeAt(withImage, 3), -1)).toBe('cursor(3)');
  });

  it('steps from the end of a paragraph onto the rule after it, and off into the next one', () => {
    expect(step(cursor(withRule, 3), 1)).toBe('node(horizontal_rule@4)');
    expect(step(nodeAt(withRule, 4), 1)).toBe('cursor(6)');
    expect(step(cursor(withRule, 6), -1)).toBe('node(horizontal_rule@4)');
    expect(step(nodeAt(withRule, 4), -1)).toBe('cursor(3)');
  });

  it('steps from one rule straight onto the next', () => {
    const rules = doc(p(t('a')), rule(), rule(), p(t('b')));
    expect(step(nodeAt(rules, 3), 1)).toBe('node(horizontal_rule@4)');
    expect(step(nodeAt(rules, 4), -1)).toBe('node(horizontal_rule@3)');
  });

  it('leaves everything else to the browser', () => {
    // Mid-text, the end of a paragraph before another paragraph, a range, and
    // a hard break, which is a character to the caret.
    expect(step(cursor(withImage, 2), 1)).toBeNull();
    expect(step(cursor(doc(p(t('a')), p(t('b'))), 2), 1)).toBeNull();
    expect(step(select(withImage, TextSelection.create(withImage, 2, 5)), 1)).toBeNull();
    const broken = doc(p(t('a'), br(), t('b')));
    expect(step(cursor(broken, 2), 1)).toBeNull();
  });

  it('steps onto a rule from a caret that has no text to be in', () => {
    // A document of only a rule gives its state a caret clamped to 0, which is
    // not in any text; the arrow that way selects the rule.
    const ruleOnly = doc(rule());
    const clamped = select(ruleOnly, TextSelection.atStart(ruleOnly));
    expect(step(clamped, 1)).toBe('node(horizontal_rule@0)');
    expect(step(clamped, -1)).toBeNull();
  });

  it('has nowhere to go before a rule at the start of the document', () => {
    const first = doc(rule(), p(t('a')));
    expect(step(nodeAt(first, 0), -1)).toBeNull();
    expect(step(nodeAt(first, 0), 1)).toBe('cursor(2)');
  });

  it('has nowhere to go past a rule at the end of the document', () => {
    const last = doc(p(t('a')), rule());
    expect(step(nodeAt(last, 3), 1)).toBeNull();
    expect(step(cursor(last, 2), 1)).toBe('node(horizontal_rule@3)');
  });

  it('steps off a selected block node up and down, and leaves a text caret to the browser', () => {
    const vertical = (selection: EditorSelection, dir: -1 | 1) => {
      const tr = from(selection);
      return selectVertically(tr, dir) ? String(tr.selection) : null;
    };
    expect(vertical(nodeAt(withRule, 4), 1)).toBe('cursor(6)');
    expect(vertical(nodeAt(withRule, 4), -1)).toBe('cursor(3)');
    expect(vertical(cursor(withRule, 3), 1)).toBeNull();
    expect(vertical(nodeAt(withImage, 3), 1)).toBeNull();
  });
});
