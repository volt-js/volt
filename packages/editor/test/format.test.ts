/**
 * The formatting commands a toolbar is made of.
 *
 * Each has the two halves every command here has — what the document became
 * and where the selection ended up — and the second is the one these can get
 * wrong without the first showing it. A block command replaces whole nodes,
 * so the map it leaves behind collapses every position inside them to an
 * edge; the selection is carried across by the command's own arithmetic, and
 * the cases are chosen so that an edge is never the right answer.
 *
 * The questions a toolbar asks — is this mark on, is this block a heading,
 * is the caret in a list — are tested beside the commands that change the
 * answer, because a toggle that is drawn down when pressing it would put the
 * mark on is the bug a reader sees.
 */

import { describe, expect, it } from 'vitest';
import { Schema, basicSchema } from '../src/index.ts';
import type { Mark } from '../src/mark.ts';
import type { Node } from '../src/node.ts';
import { EditorHistory } from '../src/history.ts';
import { EditorSelection, NodeSelection } from '../src/selection.ts';
import { EditorState, TextSelection } from '../src/state.ts';
import type { EditorTransaction } from '../src/state.ts';
import {
  blockActive,
  listActive,
  markActive,
  setBlockType,
  toggleList,
  toggleMark,
  toggleWrap,
  wrapActive,
} from '../src/format.ts';

const s = basicSchema;
const doc = (...content: Node[]) => s.node('doc', null, content);
const p = (...content: Node[]) => s.node('paragraph', null, content);
const h = (level: number, ...content: Node[]) => s.node('heading', { level }, content);
const quote = (...content: Node[]) => s.node('blockquote', null, content);
const li = (...content: Node[]) => s.node('list_item', null, content);
const ul = (...content: Node[]) => s.node('bullet_list', null, content);
const ol = (...content: Node[]) => s.node('ordered_list', null, content);
const code = (...content: Node[]) => s.node('code_block', null, content);
const rule = () => s.node('horizontal_rule');
const image = () => s.node('image', { src: 'a.png' });
const t = (text: string, ...marks: Mark[]) => s.text(text, marks);

const strong = s.marks['strong']!;
const em = s.marks['em']!;
const codeMark = s.marks['code']!;
const link = s.marks['link']!;
const B = s.mark('strong');
const C = s.mark('code');

const paragraph = s.nodes['paragraph']!;
const heading = s.nodes['heading']!;
const blockquote = s.nodes['blockquote']!;
const bulletList = s.nodes['bullet_list']!;
const orderedList = s.nodes['ordered_list']!;
const listItem = s.nodes['list_item']!;
const codeBlock = s.nodes['code_block']!;

function state(document: Node, anchor: number, head = anchor): EditorState {
  return EditorState.create(document, TextSelection.create(document, anchor, head));
}

function tr(document: Node, anchor: number, head = anchor): EditorTransaction {
  return state(document, anchor, head).tr();
}

function nodeAt(document: Node, pos: number): EditorTransaction {
  return EditorState.create(document, NodeSelection.create(document, pos)).tr();
}

/** Where the selection is, as plain data, so a node selection and a range compare as what they are. */
const where = (selection: EditorSelection) => selection.toJSON();

describe('whether a mark is on', () => {
  it('reads the marks typing would carry at a caret', () => {
    const document = doc(p(t('ab', B), t('cd')));
    expect(markActive(state(document, 2), strong)).toBe(true);
    // At the end of a bold run, typing stays bold, so the toggle says so.
    expect(markActive(state(document, 3), strong)).toBe(true);
    expect(markActive(state(document, 4), strong)).toBe(false);
  });

  it('is on over a range only when all of its text carries the mark', () => {
    const document = doc(p(t('a'), t('bc', B), t('d')));
    expect(markActive(state(document, 2, 4), strong)).toBe(true);
    expect(markActive(state(document, 1, 5), strong)).toBe(false);
    expect(markActive(state(document, 1, 5), em)).toBe(false);
  });

  it('reads a range across blocks block by block', () => {
    const both = doc(p(t('ab', B)), p(t('cd', B)));
    expect(markActive(state(both, 2, 6), strong)).toBe(true);
    const one = doc(p(t('ab', B)), p(t('cd')));
    expect(markActive(state(one, 2, 6), strong)).toBe(false);
  });

  it('leaves out text that could never carry the mark', () => {
    // Code text refuses bold, and a code block refuses every mark: neither
    // can take it, so neither is a reason to draw the toggle up.
    const mixed = doc(p(t('ab', C), t('cd', B)));
    expect(markActive(state(mixed, 1, 5), strong)).toBe(true);
    const inBlock = doc(code(t('ab')), p(t('cd', B)));
    expect(markActive(state(inBlock, 2, 8), strong)).toBe(true);
    // Text none of which could take it is not text that has it.
    expect(markActive(state(doc(p(t('ab', C))), 1, 3), strong)).toBe(false);
  });
});

describe('toggling a mark', () => {
  it('puts the mark on a range that lacks it, and leaves the selection where it was', () => {
    const change = tr(doc(p(t('abcd'))), 2, 4);
    expect(toggleMark(change, strong)).toBe(true);
    expect(change.doc.eq(doc(p(t('a'), t('bc', B), t('d'))))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'text', anchor: 2, head: 4 });
    // A press of a toolbar button is one thing to undo, whatever was typed
    // just before it.
    expect(change.historyClosed).toBe(true);
  });

  it('takes it off a range that has it all', () => {
    const change = tr(doc(p(t('a'), t('bc', B), t('d'))), 2, 4);
    expect(toggleMark(change, strong)).toBe(true);
    expect(change.doc.eq(doc(p(t('abcd'))))).toBe(true);
  });

  it('finishes the job on a range that has it in part', () => {
    const change = tr(doc(p(t('a'), t('bc', B), t('d'))), 1, 5);
    expect(toggleMark(change, strong)).toBe(true);
    expect(change.doc.eq(doc(p(t('abcd', B))))).toBe(true);
  });

  it('crosses blocks, one block at a time', () => {
    const change = tr(doc(p(t('ab')), p(t('cd'))), 2, 6);
    expect(toggleMark(change, strong)).toBe(true);
    expect(change.doc.eq(doc(p(t('a'), t('b', B)), p(t('c', B), t('d'))))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'text', anchor: 2, head: 6 });
  });

  it('passes over a block that refuses the mark, and marks the rest', () => {
    const change = tr(doc(code(t('ab')), p(t('cd'))), 2, 6);
    expect(toggleMark(change, strong)).toBe(true);
    expect(change.doc.eq(doc(code(t('ab')), p(t('c', B), t('d'))))).toBe(true);
  });

  it('declines at a caret, where there is no text for it to go on', () => {
    // Refused, not deferred: a state is a document and a selection, with no
    // set of marks waiting for the next character typed, so a mark asked for
    // at a caret has nowhere to be kept.
    const change = tr(doc(p(t('abcd'))), 2);
    expect(toggleMark(change, strong)).toBe(false);
    expect(change.changed).toBe(false);
  });

  it('declines over text none of which could take the mark', () => {
    const change = tr(doc(p(t('ab', C))), 1, 3);
    expect(toggleMark(change, strong)).toBe(false);
    expect(change.changed).toBe(false);
  });

  it('throws off what the mark excludes, and an undo gives it back', () => {
    const before = doc(p(t('ab', B)));
    const history = new EditorHistory();
    let now = state(before, 1, 3);
    const change = now.tr();
    expect(toggleMark(change, codeMark)).toBe(true);
    expect(change.doc.eq(doc(p(t('ab', C))))).toBe(true);
    history.record(change);
    now = now.apply(change);

    const undo = history.undo(now)!;
    expect(undo.doc.eq(before)).toBe(true);
    expect(where(undo.selection)).toEqual({ type: 'text', anchor: 1, head: 3 });
  });

  it('takes off every mark of its type, whatever each one’s attributes', () => {
    const one = s.mark('link', { href: 'https://one.example' });
    const two = s.mark('link', { href: 'https://two.example' });
    const document = doc(p(t('ab', one), t('cd', two)));
    expect(markActive(state(document, 1, 5), link)).toBe(true);
    const change = tr(document, 1, 5);
    expect(toggleMark(change, link)).toBe(true);
    expect(change.doc.eq(doc(p(t('abcd'))))).toBe(true);
  });

  it('puts a mark with attributes on as given', () => {
    const change = tr(doc(p(t('abcd'))), 1, 3);
    expect(toggleMark(change, link, { href: 'https://example.com' })).toBe(true);
    expect(change.doc.eq(doc(p(t('ab', s.mark('link', { href: 'https://example.com' })), t('cd'))))).toBe(true);
  });
});

describe('the type of a block', () => {
  it('is on when every textblock the selection touches is that type, with those attributes', () => {
    const document = doc(h(2, t('ab')), p(t('cd')));
    expect(blockActive(state(document, 2), heading, { level: 2 })).toBe(true);
    expect(blockActive(state(document, 2), heading, { level: 1 })).toBe(false);
    expect(blockActive(state(document, 2), heading)).toBe(true);
    expect(blockActive(state(document, 2), paragraph)).toBe(false);
    expect(blockActive(state(document, 2, 6), heading)).toBe(false);
  });

  it('turns the block at the caret into another, keeping its content and the caret', () => {
    const change = tr(doc(p(t('a'), t('b', B))), 2);
    expect(setBlockType(change, heading, { level: 2 })).toBe(true);
    expect(change.doc.eq(doc(h(2, t('a'), t('b', B))))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'text', anchor: 2, head: 2 });
    expect(change.steps).toHaveLength(1);
    expect(change.historyClosed).toBe(true);
  });

  it('turns every textblock in a range, and keeps the range', () => {
    const change = tr(doc(p(t('ab')), p(t('cd'))), 2, 6);
    expect(setBlockType(change, heading, { level: 1 })).toBe(true);
    expect(change.doc.eq(doc(h(1, t('ab')), h(1, t('cd'))))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'text', anchor: 2, head: 6 });
  });

  it('keeps an image selected whole when the block around it changes', () => {
    const change = nodeAt(doc(p(t('a'), image(), t('b'))), 2);
    expect(setBlockType(change, heading, { level: 3 })).toBe(true);
    expect(change.selection).toBeInstanceOf(NodeSelection);
    expect(where(change.selection)).toEqual({ type: 'node', anchor: 2 });
  });

  it('leaves a block whose place refuses the type, and changes the rest', () => {
    // A list item opens with a paragraph, so its paragraph cannot become a
    // heading; the paragraph before the list can.
    const document = doc(p(t('ab')), ul(li(p(t('cd')))));
    const change = tr(document, 2, 8);
    expect(setBlockType(change, heading, { level: 1 })).toBe(true);
    expect(change.doc.eq(doc(h(1, t('ab')), ul(li(p(t('cd'))))))).toBe(true);

    const inItem = tr(document, 8);
    expect(setBlockType(inItem, heading, { level: 1 })).toBe(false);
    expect(inItem.changed).toBe(false);
  });

  it('declines a block whose content the type cannot hold', () => {
    // A code block holds no marks, so bold text keeps its paragraph.
    const marked = tr(doc(p(t('ab', B))), 2);
    expect(setBlockType(marked, codeBlock)).toBe(false);
    expect(marked.changed).toBe(false);
    const plain = tr(doc(p(t('ab'))), 2);
    expect(setBlockType(plain, codeBlock)).toBe(true);
    expect(plain.doc.eq(doc(code(t('ab'))))).toBe(true);
  });

  it('declines when every block is that type already', () => {
    const change = tr(doc(h(1, t('ab'))), 2);
    expect(setBlockType(change, heading, { level: 1 })).toBe(false);
    expect(change.changed).toBe(false);
  });

  it('is one unit of undo, which brings the block and the caret back', () => {
    const before = doc(p(t('ab')), p(t('cd')));
    const history = new EditorHistory();
    let now = state(before, 6);
    const change = now.tr();
    expect(setBlockType(change, heading, { level: 2 })).toBe(true);
    history.record(change);
    now = now.apply(change);
    const undo = history.undo(now)!;
    expect(undo.doc.eq(before)).toBe(true);
    expect(where(undo.selection)).toEqual({ type: 'text', anchor: 6, head: 6 });
  });
});

describe('wrapping and lifting', () => {
  it('wraps the block at the caret, and carries the caret in with it', () => {
    const change = tr(doc(p(t('abc'))), 2);
    expect(wrapActive(state(doc(p(t('abc'))), 2), blockquote)).toBe(false);
    expect(toggleWrap(change, blockquote)).toBe(true);
    expect(change.doc.eq(doc(quote(p(t('abc')))))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'text', anchor: 3, head: 3 });
    expect(change.historyClosed).toBe(true);
  });

  it('wraps every block a range touches in one', () => {
    const change = tr(doc(p(t('ab')), p(t('cd')), p(t('ef'))), 2, 6);
    expect(toggleWrap(change, blockquote)).toBe(true);
    expect(change.doc.eq(doc(quote(p(t('ab')), p(t('cd'))), p(t('ef'))))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'text', anchor: 3, head: 7 });
  });

  it('wraps further out where the block’s own place cannot hold the wrapper', () => {
    // A list item opens with a paragraph, and a list holds only items, so a
    // quote asked for inside a list goes round the list.
    const change = tr(doc(ul(li(p(t('ab'))))), 4);
    expect(toggleWrap(change, blockquote)).toBe(true);
    expect(change.doc.eq(doc(quote(ul(li(p(t('ab')))))))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'text', anchor: 5, head: 5 });
  });

  it('wraps a rule selected whole, and keeps it selected', () => {
    const change = nodeAt(doc(p(t('ab')), rule()), 4);
    expect(toggleWrap(change, blockquote)).toBe(true);
    expect(change.doc.eq(doc(p(t('ab')), quote(rule())))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'node', anchor: 5 });
  });

  it('is on inside the wrapper and lifts the whole of it out again', () => {
    const inside = doc(quote(p(t('ab')), p(t('cd'))));
    expect(wrapActive(state(inside, 3), blockquote)).toBe(true);
    expect(wrapActive(state(doc(p(t('ab'))), 2), blockquote)).toBe(false);

    const change = tr(inside, 7);
    expect(toggleWrap(change, blockquote)).toBe(true);
    expect(change.doc.eq(doc(p(t('ab')), p(t('cd'))))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'text', anchor: 6, head: 6 });
  });

  it('declines a wrapper nothing in reach can hold, and a lift the parent cannot hold', () => {
    const strict = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { content: 'text*', group: 'block' },
        note: { content: 'excerpt', group: 'block' },
        excerpt: { content: 'paragraph+' },
        text: {},
      },
    });
    const sp = (text: string) => strict.node('paragraph', null, [strict.text(text)]);
    const excerpt = strict.nodes['excerpt']!;

    // The document holds blocks, and an excerpt is not one.
    const wrap = EditorState.create(strict.node('doc', null, [sp('ab')])).tr();
    expect(toggleWrap(wrap, excerpt)).toBe(false);
    expect(wrap.changed).toBe(false);

    // A note holds exactly one excerpt, so its paragraphs cannot stand in it.
    const noted = strict.node('doc', null, [strict.node('note', null, [strict.node('excerpt', null, [sp('ab')])])]);
    const lift = EditorState.create(noted, TextSelection.create(noted, 4)).tr();
    expect(toggleWrap(lift, excerpt)).toBe(false);
    expect(lift.changed).toBe(false);
  });
});

describe('lists', () => {
  it('makes an item of each block a range touches, and carries the range in', () => {
    const change = tr(doc(p(t('ab')), p(t('cd'))), 2, 6);
    expect(listActive(state(doc(p(t('ab'))), 2), bulletList, listItem)).toBe(false);
    expect(toggleList(change, bulletList, listItem)).toBe(true);
    expect(change.doc.eq(doc(ul(li(p(t('ab'))), li(p(t('cd'))))))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'text', anchor: 4, head: 10 });
    expect(change.historyClosed).toBe(true);
  });

  it('is on in a list of its type, and takes that list apart again', () => {
    const listed = doc(ul(li(p(t('ab'))), li(p(t('cd')))));
    expect(listActive(state(listed, 10), bulletList, listItem)).toBe(true);
    expect(listActive(state(listed, 10), orderedList, listItem)).toBe(false);

    const change = tr(listed, 10);
    expect(toggleList(change, bulletList, listItem)).toBe(true);
    expect(change.doc.eq(doc(p(t('ab')), p(t('cd'))))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'text', anchor: 6, head: 6 });
  });

  it('keeps everything an item held when the list comes apart', () => {
    const change = tr(doc(ul(li(p(t('ab'))), li(p(t('cd')), p(t('ef'))))), 14);
    expect(toggleList(change, bulletList, listItem)).toBe(true);
    expect(change.doc.eq(doc(p(t('ab')), p(t('cd')), p(t('ef'))))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'text', anchor: 10, head: 10 });
  });

  it('takes apart only the nearest list, into the item around it', () => {
    const change = tr(doc(ul(li(p(t('ab')), ul(li(p(t('cd'))))))), 10);
    expect(toggleList(change, bulletList, listItem)).toBe(true);
    expect(change.doc.eq(doc(ul(li(p(t('ab')), p(t('cd'))))))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'text', anchor: 8, head: 8 });
  });

  it('turns a list of the other type into this one, items and caret unmoved', () => {
    const change = tr(doc(ul(li(p(t('ab'))))), 4);
    expect(toggleList(change, orderedList, listItem)).toBe(true);
    expect(change.doc.eq(doc(ol(li(p(t('ab'))))))).toBe(true);
    expect(where(change.selection)).toEqual({ type: 'text', anchor: 4, head: 4 });
    expect(listActive(EditorState.create(change.doc, change.selection), orderedList, listItem)).toBe(true);
  });

  it('declines a block an item cannot open with, and a range holding one', () => {
    // An item opens with a paragraph, and a heading is not one.
    const lone = tr(doc(h(1, t('ab'))), 2);
    expect(toggleList(lone, bulletList, listItem)).toBe(false);
    expect(lone.changed).toBe(false);
    const mixed = tr(doc(p(t('ab')), h(1, t('cd'))), 2, 6);
    expect(toggleList(mixed, bulletList, listItem)).toBe(false);
    expect(mixed.changed).toBe(false);
  });

  it('is one unit of undo, which brings the paragraphs and the range back', () => {
    const before = doc(p(t('ab')), p(t('cd')));
    const history = new EditorHistory();
    let now = state(before, 2, 6);
    const change = now.tr();
    expect(toggleList(change, bulletList, listItem)).toBe(true);
    history.record(change);
    now = now.apply(change);
    const undo = history.undo(now)!;
    expect(undo.doc.eq(before)).toBe(true);
    expect(where(undo.selection)).toEqual({ type: 'text', anchor: 2, head: 6 });
  });
});
