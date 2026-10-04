/**
 * Slices with open ends: cutting them out, joining them in, and fitting them
 * where they do not line up.
 *
 * Three layers are pinned here, each on the one below. A slice cut out of a
 * document remembers how deeply it was cut open, which is what lets a
 * replacement whose ends sit in different parents be described at all. A
 * replacement applies such a slice only when its open depths make up the
 * difference between the two ends — the join rule — and is refused, with a
 * reason, when they do not. And fitting is what turns a slice that does not
 * line up into one that does, closing open ends and wrapping content against
 * the schema, so a paste never has to arrive pre-shaped.
 *
 * The cases that used to be refusals are here as working cases, because that
 * is the claim this file exists to hold: a deletion across two paragraphs, a
 * slice with open ends, typing over a selection that spans blocks.
 */

import { describe, expect, it } from 'vitest';
import { Fragment, Schema, Slice, basicSchema } from '../src/index.ts';
import type { Mark } from '../src/index.ts';
import { Node } from '../src/node.ts';
import { fitSlice, placeSlice } from '../src/slice.ts';
import { Mapping, ReplaceStep, Transaction } from '../src/step.ts';

const s = basicSchema;
const doc = (...content: Node[]) => s.node('doc', null, content);
const p = (...content: Node[]) => s.node('paragraph', null, content);
const h = (level: number, ...content: Node[]) => s.node('heading', { level }, content);
const t = (text: string, ...marks: Mark[]) => s.text(text, marks);
const ul = (...items: Node[]) => s.node('bullet_list', null, items);
const li = (...content: Node[]) => s.node('list_item', null, content);
const code = (...content: Node[]) => s.node('code_block', null, content);
const quote = (...content: Node[]) => s.node('blockquote', null, content);
const rule = () => s.node('horizontal_rule');
const image = () => s.node('image', { src: 'a.png' });
const em = s.mark('em');

/**
 * A node whose content its schema would refuse on its own — a list with an
 * empty item — which is what the inside of an open slice is. Built with the
 * unchecked constructor, as a step builds one.
 */
const open = (type: string, ...content: Node[]) =>
  new Node(s.nodeType(type), s.nodeType(type).defaultAttrs, Fragment.from(content), []);

const slice = (openStart: number, openEnd: number, ...nodes: Node[]) => new Slice(Fragment.from(nodes), openStart, openEnd);

const applied = (result: { ok: boolean }): Node => {
  if (!result.ok) throw new Error(`refused: ${(result as { reason: string }).reason}`);
  return (result as unknown as { doc: Node }).doc;
};

/** Fit a slice and apply what came back, as a paste does. */
function fitted(document: Node, from: number, to: number, piece: Slice, place = false): Node {
  const fit = (place ? placeSlice : fitSlice)(document, from, to, piece);
  if (!fit.ok) throw new Error(`no fit: ${fit.reason}`);
  return applied(new ReplaceStep(fit.from, fit.to, fit.slice).apply(document));
}

describe('cutting a slice out of a document', () => {
  // 0 <p> 1 a 2 b 3 </p> 4 <p> 5 c 6 d 7 </p> 8
  const twoParagraphs = doc(p(t('ab')), p(t('cd')));

  it('remembers that both of its paragraphs were cut open', () => {
    const cut = twoParagraphs.slice(2, 6);
    expect(String(cut)).toBe('paragraph("b"), paragraph("c")(1,1)');
    // What it inserts is what was between the two positions, not the tokens of
    // the paragraphs it was cut through.
    expect(cut.size).toBe(4);
  });

  it('is closed when both ends are in the same parent', () => {
    expect(String(twoParagraphs.slice(1, 3))).toBe('"ab"(0,0)');
    expect(String(twoParagraphs.slice(0, 4))).toBe('paragraph("ab")(0,0)');
  });

  it('is open to a different depth at each end when the ends are at different depths', () => {
    // 0 <p> 1 a 2 b 3 </p> 4 <ul> 5 <li> 6 <p> 7 c 8 d 9 </p> 10 </li> 11 </ul> 12
    const nested = doc(p(t('ab')), ul(li(p(t('cd')))));
    expect(String(nested.slice(2, 8))).toBe('paragraph("b"), bullet_list(list_item(paragraph("c")))(1,3)');
  });

  it('is empty for an empty range', () => {
    expect(twoParagraphs.slice(3, 3)).toBe(Slice.empty);
  });

  it('opens a fragment as deep as its first and last nodes go', () => {
    const list = Slice.maxOpen(Fragment.from(ul(li(p(t('a'))), li(p(t('b'))))));
    expect([list.openStart, list.openEnd]).toEqual([3, 3]);

    // Text is a leaf: there is nothing inside it to open into.
    const mixed = Slice.maxOpen(Fragment.from([t('a'), p(t('b'))]));
    expect([mixed.openStart, mixed.openEnd]).toEqual([0, 1]);

    const ruled = Slice.maxOpen(Fragment.from([rule(), p(t('b')), rule()]));
    expect([ruled.openStart, ruled.openEnd]).toEqual([0, 0]);
  });
});

describe('a replacement whose ends are in different parents', () => {
  it('deletes across two paragraphs, joining what is left of them', () => {
    // The case step.ts used to refuse outright.
    const before = doc(p(t('ab')), p(t('cd')));
    const step = new ReplaceStep(2, 6, Slice.empty);
    expect(String(applied(step.apply(before)))).toBe('doc(paragraph("ad"))');
  });

  it('maps what is after the range back by what it removed, and what was inside to its edge', () => {
    const step = new ReplaceStep(2, 6, Slice.empty);
    const map = step.getMap();
    // 9 is inside the third paragraph of doc(p(ab), p(cd), p(ef)).
    expect(map.map(9)).toBe(5);
    expect(map.map(4, -1)).toBe(2);
    expect(map.map(4, 1)).toBe(2);
    expect(map.map(1)).toBe(1);
  });

  it('inverts into a replacement that puts both paragraphs back, open slice and all', () => {
    const before = doc(p(t('ab')), p(t('cd')));
    const step = new ReplaceStep(2, 6, Slice.empty);
    const after = applied(step.apply(before));

    const inverse = step.invert(before) as ReplaceStep;
    expect(String(inverse.slice)).toBe('paragraph("b"), paragraph("c")(1,1)');
    expect(applied(inverse.apply(after)).eq(before)).toBe(true);
  });

  it('gives a position back unchanged across the deletion and its own undo', () => {
    // 5 is before "c" — inside what the deletion took. The mirror is what finds
    // it again in what the inverse put back.
    const before = doc(p(t('ab')), p(t('cd')));
    const step = new ReplaceStep(2, 6, Slice.empty);
    const after = applied(step.apply(before));
    const inverse = step.invert(before);
    applied(inverse.apply(after));

    const mapping = new Mapping();
    mapping.appendMap(step.getMap());
    mapping.appendMap(inverse.getMap(), 0);
    for (const pos of [1, 2, 3, 5, 6, 7, 8]) expect(mapping.map(pos), `position ${pos}`).toBe(pos);
  });

  it('splits a paragraph around a slice whose two paragraphs are open', () => {
    const before = doc(p(t('abcd')));
    const step = new ReplaceStep(3, 3, slice(1, 1, p(t('x')), p(t('y'))));
    expect(String(applied(step.apply(before)))).toBe('doc(paragraph("abx"), paragraph("ycd"))');
    // A position after the insertion moves by exactly what the slice inserts.
    expect(step.getMap().map(4)).toBe(8);
  });

  it('types over a selection that spans two paragraphs', () => {
    const before = doc(p(t('ab')), p(t('cd')));
    const step = new ReplaceStep(2, 6, slice(0, 0, t('X')));
    expect(String(applied(step.apply(before)))).toBe('doc(paragraph("aXd"))');
  });

  it('keeps the type of the block the replacement starts in', () => {
    const before = doc(h(2, t('ab')), p(t('cd')));
    expect(String(applied(new ReplaceStep(2, 6, Slice.empty).apply(before)))).toBe('doc(heading("ad"))');
  });

  it('joins across depths when the slice is open by the difference', () => {
    // 0 <p> 1 a 2 b 3 </p> 4 <ul> 5 <li> 6 <p> 7 c 8 d 9 </p> 10 </li> 11 </ul> 12
    const before = doc(p(t('ab')), ul(li(p(t('cd')))));
    const listOpen = slice(1, 3, p(), open('bullet_list', open('list_item', p())));
    const after = applied(new ReplaceStep(2, 8, listOpen).apply(before));
    expect(String(after)).toBe('doc(paragraph("a"), bullet_list(list_item(paragraph("d"))))');
  });

  it('undoes a change across parents through a transaction, as a history does', () => {
    const before = doc(p(t('ab')), quote(p(t('cd')), p(t('ef'))));
    const tr = new Transaction(before);
    // From inside the quote's first paragraph to inside its second.
    expect(tr.delete(7, 11).ok).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("ab"), blockquote(paragraph("cf")))');

    let back = tr.doc;
    for (const step of tr.invert(before)) back = applied(step.apply(back));
    expect(back.eq(before)).toBe(true);
  });

  describe('what is still refused', () => {
    it('refuses ends whose depths the slice does not make up, rather than guess', () => {
      const before = doc(p(t('ab')), ul(li(p(t('cd')))));
      const result = new ReplaceStep(2, 8, Slice.empty).apply(before);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toMatch(/depth/);
    });

    it('refuses a slice open deeper than the position it goes into', () => {
      const before = doc(p(t('ab')));
      const result = new ReplaceStep(0, 0, slice(1, 1, p(t('x')))).apply(before);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toMatch(/deeper/);
    });

    it('refuses to join two nodes that cannot hold each other\'s content', () => {
      // From inside the paragraph to the list's own content: depth one at both
      // ends, so the depths line up, and a paragraph and a list are joined.
      const before = doc(p(t('ab')), ul(li(p(t('cd')))));
      const result = new ReplaceStep(2, 5, Slice.empty).apply(before);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toMatch(/cannot be joined/);
    });

    it('refuses a join whose result the schema forbids', () => {
      // A code block and a paragraph both hold text, so they may be joined —
      // but not when what the paragraph brings is an image.
      const before = doc(code(t('ab')), p(image(), t('cd')));
      // 5 is the start of the paragraph's content, so the image is kept.
      const result = new ReplaceStep(2, 5, Slice.empty).apply(before);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toMatch(/code_block cannot hold/);
    });

    it('refuses a slice that claims to be open deeper than its content goes', () => {
      const before = doc(p(t('ab')));
      const result = new ReplaceStep(2, 2, slice(1, 1, t('x'))).apply(before);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toMatch(/open deeper than its content/);
    });

    it('leaves a transaction untouched when the join is refused', () => {
      const tr = new Transaction(doc(p(t('ab')), ul(li(p(t('cd'))))));
      const was = tr.doc;
      expect(tr.delete(2, 8).ok).toBe(false);
      expect(tr.doc).toBe(was);
      expect(tr.changed).toBe(false);
    });
  });
});

describe('fitting a slice where it does not line up', () => {
  it('uses a slice that already fits exactly as it is', () => {
    const before = doc(p(t('abcd')));
    const piece = slice(1, 1, p(t('x')), p(t('y')));
    const fit = fitSlice(before, 3, 3, piece);
    expect(fit.ok && [fit.from, fit.to]).toEqual([3, 3]);
    // The same slice, not one rebuilt to look like it: fitting only ever
    // changes a slice the join rule would refuse.
    expect(fit.ok && fit.slice).toBe(piece);
  });

  it('closes the paragraph around closed blocks put in its middle', () => {
    const after = fitted(doc(p(t('abcd'))), 3, 3, slice(0, 0, p(t('x'))));
    expect(String(after)).toBe('doc(paragraph("ab"), paragraph("x"), paragraph("cd"))');
  });

  it('wraps inline content in a paragraph where only blocks may go', () => {
    // 4 is between the paragraph and the rule, directly in the document.
    const after = fitted(doc(p(t('ab')), rule()), 4, 4, slice(0, 0, t('x')));
    expect(String(after)).toBe('doc(paragraph("ab"), paragraph("x"), horizontal_rule)');
  });

  it('wraps a list item in a list where list items cannot stand alone', () => {
    const after = fitted(doc(p(t('ab'))), 4, 4, slice(0, 0, li(p(t('x')))));
    expect(String(after)).toBe('doc(paragraph("ab"), bullet_list(list_item(paragraph("x"))))');
  });

  it('opens a list into the paragraph it lands in, and leaves the rest a list', () => {
    const list = Slice.maxOpen(Fragment.from(ul(li(p(t('a'))), li(p(t('b'))))));
    const after = fitted(doc(p(t('xy'))), 2, 2, list);
    // The text after the cursor stays in a paragraph of its own: pulling it into
    // the last pasted block would move content the step does not own.
    expect(String(after)).toBe(
      'doc(paragraph("xa"), bullet_list(list_item(paragraph("b"))), paragraph("y"))',
    );
  });

  it('deletes across blocks at different depths, keeping each side where it was', () => {
    // 0 <p> 1 a 2 b 3 </p> 4 <ul> 5 <li> 6 <p> 7 c 8 d 9 </p> 10 </li> 11 </ul> 12
    const before = doc(p(t('ab')), ul(li(p(t('cd')))));
    const fit = fitSlice(before, 2, 8, Slice.empty);
    expect(fit.ok && String(fit.slice)).toBe('paragraph, bullet_list(list_item(paragraph))(1,3)');
    expect(String(fitted(before, 2, 8, Slice.empty))).toBe(
      'doc(paragraph("a"), bullet_list(list_item(paragraph("d"))))',
    );
  });

  it('starts a new block for what follows a pasted block that was closed at its end', () => {
    // The pasted paragraph ended there, so the text after it does not run on
    // into the paragraph its own text joined.
    const after = fitted(doc(p(t('xy'))), 2, 2, slice(1, 0, p(t('a')), t('b')));
    expect(String(after)).toBe('doc(paragraph("xa"), paragraph("by"))');
  });

  it('drops the marks the destination does not allow', () => {
    const after = fitted(doc(code(t('ab'))), 2, 2, slice(0, 0, t('x', em)));
    expect(String(after)).toBe('doc(code_block("axb"))');
  });

  it('splits a block around content it cannot hold, rather than dropping the content', () => {
    // An image cannot go in a code block, but it can go in a paragraph beside
    // one. The text after it can go in that paragraph too, and the rule joins
    // what follows onto the deepest open block that will hold it.
    const after = fitted(doc(code(t('ab'))), 2, 2, slice(0, 0, image()));
    expect(String(after)).toBe('doc(code_block("a"), paragraph(image, "b"))');
  });

  it('drops a node that has nowhere to go, and refuses when that leaves nothing', () => {
    const narrow = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'text*' },
        widget: {},
        text: {},
      },
    });
    const before = narrow.node('doc', null, [narrow.node('paragraph', null, [narrow.text('ab')])]);
    const widget = narrow.node('widget');

    const nothing = fitSlice(before, 2, 2, new Slice(Fragment.from(widget), 0, 0));
    expect(nothing.ok).toBe(false);
    expect(nothing.ok === false && nothing.reason).toMatch(/nothing/);
    // At the end of the paragraph too, where closing up would still have made
    // a step out of the paragraph's own closing token.
    const atEnd = fitSlice(before, 3, 3, new Slice(Fragment.from(widget), 0, 0));
    expect(atEnd.ok === false && atEnd.reason).toMatch(/nothing/);
    // And over a range: a paste of nothing that fits does not quietly become
    // a deletion of what it was pasted over.
    const over = fitSlice(before, 1, 3, new Slice(Fragment.from(widget), 0, 0));
    expect(over.ok === false && over.reason).toMatch(/nothing/);

    const kept = fitSlice(before, 2, 2, new Slice(Fragment.from([widget, narrow.text('x')]), 0, 0));
    expect(kept.ok && String(applied(new ReplaceStep(kept.from, kept.to, kept.slice).apply(before)))).toBe(
      'doc(paragraph("axb"))',
    );
  });

  it('opens a node that has nowhere to go, and places what is inside it', () => {
    const boxed = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'text*' },
        box: { content: 'paragraph+' },
        text: {},
      },
    });
    const before = boxed.node('doc', null, [boxed.node('paragraph', null, [boxed.text('ab')])]);
    const box = boxed.node('box', null, [boxed.node('paragraph', null, [boxed.text('x')])]);
    const fit = fitSlice(before, 2, 2, new Slice(Fragment.from(box), 0, 0));
    expect(fit.ok && String(applied(new ReplaceStep(fit.from, fit.to, fit.slice).apply(before)))).toBe(
      'doc(paragraph("a"), paragraph("x"), paragraph("b"))',
    );
  });

  it('wraps only in nodes that one child finishes, so nothing is opened that must then be filled', () => {
    const paired = new Schema({
      nodes: {
        doc: { content: 'pair' },
        pair: { content: 'section section' },
        section: { content: 'paragraph' },
        paragraph: { content: 'text*' },
        text: {},
      },
    });
    // A section is finished by one paragraph, so it may wrap one; a pair is
    // not finished by one section, so it may not wrap one.
    expect(paired.nodes['pair']!.contentMatch.findWrapping(paired.nodes['text']!)?.map((type) => type.name)).toEqual([
      'section',
      'paragraph',
    ]);
    expect(paired.nodes['doc']!.contentMatch.findWrapping(paired.nodes['text']!)).toBeNull();
  });

  it('refuses a slice that claims to be open deeper than its content goes, rather than throw', () => {
    const before = doc(p(t('ab')));
    for (const fit of [fitSlice(before, 2, 2, slice(2, 0, p(t('x')))), placeSlice(before, 2, 2, slice(2, 0, p(t('x'))))]) {
      expect(fit.ok === false && fit.reason).toMatch(/open deeper than its content/);
    }
  });

  it('produces a replacement that applies, for every range and every slice tried', () => {
    // The property the fitting exists for: whatever it returns, the join rule
    // accepts. A fit that the step then refused would be a paste that fails
    // after it said it would not.
    const document = doc(
      h(1, t('Ti'), t('tle', em)),
      p(t('ab'), image(), t('cd')),
      ul(li(p(t('one'))), li(p(t('two')), ul(li(p(t('deep')))))),
      quote(p(t('q'))),
      rule(),
      code(t('let x')),
    );
    const pieces = [
      Slice.empty,
      slice(0, 0, t('x')),
      slice(0, 0, p(t('x'))),
      slice(1, 1, p(t('x')), p(t('y'))),
      Slice.maxOpen(Fragment.from(ul(li(p(t('a'))), li(p(t('b')))))),
      slice(0, 0, rule()),
      Slice.maxOpen(Fragment.from([h(2, t('h')), p(t('x'), image())])),
      slice(0, 0, li(p(t('i')))),
      document.slice(3, 20),
    ];

    let tried = 0;
    for (let from = 0; from <= document.content.size; from += 3) {
      for (let to = from; to <= document.content.size; to += 7) {
        for (const piece of pieces) {
          for (const fit of [fitSlice(document, from, to, piece), placeSlice(document, from, to, piece)]) {
            if (!fit.ok) continue;
            tried++;
            const result = new ReplaceStep(fit.from, fit.to, fit.slice).apply(document);
            expect(result.ok, `${from}..${to} with ${piece}: ${result.ok ? '' : result.reason}`).toBe(true);
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(100);
  });
});

describe('placing a slice at a selection', () => {
  it('replaces an empty paragraph with a pasted list, rather than opening the list into it', () => {
    const list = Slice.maxOpen(Fragment.from(ul(li(p(t('a'))), li(p(t('b'))))));
    const after = fitted(doc(p(t('x')), p()), 4, 4, list, true);
    expect(String(after)).toBe(
      'doc(paragraph("x"), bullet_list(list_item(paragraph("a")), list_item(paragraph("b"))))',
    );
  });

  it('keeps a pasted heading a heading when it replaces a whole empty paragraph', () => {
    const heading = Slice.maxOpen(Fragment.from(h(2, t('Title'))));
    const after = fitted(doc(p()), 1, 1, heading, true);
    expect(String(after)).toBe('doc(heading("Title"))');
  });

  it('merges a pasted heading\'s text into the middle of a paragraph', () => {
    const heading = Slice.maxOpen(Fragment.from(h(2, t('Title'))));
    const after = fitted(doc(p(t('xy'))), 2, 2, heading, true);
    expect(String(after)).toBe('doc(paragraph("xTitley"))');
  });

  it('makes pasted list items siblings of the item the cursor is in', () => {
    // 0 <ul> 1 <li> 2 <p> 3 a 4 b 5 ...
    const list = Slice.maxOpen(Fragment.from(ul(li(p(t('x'))), li(p(t('y'))))));
    const after = fitted(doc(ul(li(p(t('ab'))))), 4, 4, list, true);
    expect(String(after)).toBe(
      'doc(bullet_list(list_item(paragraph("ax")), list_item(paragraph("yb"))))',
    );
  });

  it('uses a closed slice that fits where it is as it is', () => {
    const piece = slice(0, 0, t('X'));
    const fit = placeSlice(doc(p(t('abcd'))), 2, 4, piece);
    expect(fit.ok && fit.slice).toBe(piece);
  });

  it('pastes plain paragraphs into the paragraph the selection is in', () => {
    const paragraphs = Slice.maxOpen(Fragment.from([p(t('one')), p(t('two'))]));
    const after = fitted(doc(p(t('abcd'))), 2, 4, paragraphs, true);
    expect(String(after)).toBe('doc(paragraph("aone"), paragraph("twod"))');
  });
});
