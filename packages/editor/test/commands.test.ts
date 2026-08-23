/**
 * The commands an edit is made of.
 *
 * Each of these has two halves to assert and both matter: what the document
 * became, and where the cursor ended up. A command that produces the right
 * document and leaves the caret somewhere else is the bug this whole layer is
 * shaped to prevent, and it is invisible to a test that only reads the text.
 *
 * The structural commands — splitting a block, joining two — get the most
 * attention, because they are the ones that cannot let the selection map:
 * their step rewrites whole blocks, so every position inside them collapses to
 * an edge and the command has to compute the answer from the geometry of what
 * it just built. If that arithmetic is wrong, the document is still perfect.
 */

import { describe, expect, it } from 'vitest';
import { Mark, basicSchema } from '../src/index.ts';
import { EditorState, TextSelection } from '../src/state.ts';
import type { EditorTransaction } from '../src/state.ts';
import {
  deleteBackward,
  deleteForward,
  deleteSelection,
  deleteWordBackward,
  insertParagraph,
  insertPlainText,
  insertText,
} from '../src/commands.ts';
import type { Node } from '../src/node.ts';

const s = basicSchema;
const doc = (...content: Node[]) => s.node('doc', null, content);
const p = (...content: Node[]) => s.node('paragraph', null, content);
const li = (...content: Node[]) => s.node('list_item', null, content);
const bullets = (...content: Node[]) => s.node('bullet_list', null, content);
const code = (...content: Node[]) => s.node('code_block', null, content);
const t = (text: string, ...marks: Mark[]) => s.text(text, marks);
const em = s.mark('em');
const rule = () => s.node('horizontal_rule');
const image = () => s.node('image', { src: 'a.png' });

const textOf = (node: Node) => node.textBetween(0, node.content.size, '|');

/** A transaction over `document`, with the cursor or selection put where asked. */
function at(document: Node, anchor: number, head = anchor): EditorTransaction {
  return EditorState.create(document, TextSelection.create(document, anchor, head)).tr();
}

describe('deleting a selection', () => {
  it('takes out what is selected and leaves the cursor where it was', () => {
    const tr = at(doc(p(t('abcd'))), 2, 4);
    expect(deleteSelection(tr)).toBe(true);
    expect(textOf(tr.doc)).toBe('ad');
    expect(tr.selection.empty).toBe(true);
    expect(tr.selection.anchor).toBe(2);
  });

  it('declines, without touching anything, when nothing is selected', () => {
    const tr = at(doc(p(t('abcd'))), 3);
    const was = tr.doc;
    expect(deleteSelection(tr)).toBe(false);
    expect(tr.doc).toBe(was);
  });

  it('declines a selection whose ends are in different blocks', () => {
    // The step layer refuses a replacement across parents, and a command that
    // half-did it would be worse than one that says it cannot.
    const tr = at(doc(p(t('ab')), p(t('cd'))), 2, 6);
    expect(deleteSelection(tr)).toBe(false);
    expect(textOf(tr.doc)).toBe('ab|cd');
  });
});

describe('typing text', () => {
  it('puts the text in and leaves the cursor after it', () => {
    const tr = at(doc(p(t('abcd'))), 3);
    expect(insertText(tr, 'XY')).toBe(true);
    expect(textOf(tr.doc)).toBe('abXYcd');
    expect(tr.selection.anchor).toBe(5);
    expect(tr.selection.empty).toBe(true);
  });

  it('replaces a selection and collapses after the typing, not over it', () => {
    // Both ends of the selection map to opposite edges of the replacement, so
    // the mapped answer is a selection *of* what was typed. A person typing
    // over a word expects a cursor, so the command says so explicitly.
    const tr = at(doc(p(t('abcd'))), 2, 4);
    expect(insertText(tr, 'XY')).toBe(true);
    expect(textOf(tr.doc)).toBe('aXYd');
    expect(tr.selection.empty).toBe(true);
    expect(tr.selection.anchor).toBe(4);
  });

  it('carries the marks of the position rather than of a toolbar', () => {
    const tr = at(doc(p(t('ab', em))), 3);
    expect(insertText(tr, 'c')).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph(em("abc")))');
  });

  it('does not extend a mark that declares itself non-inclusive', () => {
    const link = s.mark('link', { href: 'https://example.com' });
    const tr = at(doc(p(t('ab', link), t('cd'))), 3);
    expect(insertText(tr, 'X')).toBe(true);
    // Typing at the end of a link is outside the link, which is what
    // `inclusive: false` means and why the marks come from the position.
    expect(String(tr.doc)).toBe('doc(paragraph(link("ab"), "Xcd"))');
  });

  it('drops marks the block forbids instead of producing content it refuses', () => {
    // A code block declares `marks: ""`. Carrying the emphasis in would build
    // a fragment the schema rejects, and the replacement would fail.
    const tr = at(doc(code(t('ab'))), 3);
    expect(insertText(tr, 'c')).toBe(true);
    expect(String(tr.doc)).toBe('doc(code_block("abc"))');
  });

  it('declines to type where there is no inline content', () => {
    const tr = at(doc(rule()), 0);
    expect(insertText(tr, 'x')).toBe(false);
    expect(String(tr.doc)).toBe('doc(horizontal_rule)');
  });

  it('does nothing for empty text at a cursor, and deletes for empty text over a range', () => {
    const nothing = at(doc(p(t('abcd'))), 3);
    expect(insertText(nothing, '')).toBe(false);
    expect(nothing.changed).toBe(false);

    const over = at(doc(p(t('abcd'))), 2, 4);
    expect(insertText(over, '')).toBe(true);
    expect(textOf(over.doc)).toBe('ad');
  });
});

describe('splitting a block', () => {
  it('makes two blocks of one and puts the cursor into the second', () => {
    const tr = at(doc(p(t('abcd'))), 3);
    expect(insertParagraph(tr)).toBe(true);
    expect(textOf(tr.doc)).toBe('ab|cd');
    // Past the whole first paragraph, then past the second one's own opening
    // token — which is the first position inside it.
    expect(tr.selection.anchor).toBe(5);
    expect(tr.selection.empty).toBe(true);
  });

  it('splits at the end into an empty second block', () => {
    const tr = at(doc(p(t('ab'))), 3);
    expect(insertParagraph(tr)).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("ab"), paragraph)');
    expect(tr.selection.anchor).toBe(5);
  });

  it('keeps the block type and attributes on both halves', () => {
    const heading = s.node('heading', { level: 3 }, [t('abcd')]);
    const tr = at(doc(heading), 3);
    expect(insertParagraph(tr)).toBe(true);
    expect(tr.doc.childCount).toBe(2);
    expect(tr.doc.child(0).type.name).toBe('heading');
    expect(tr.doc.child(1).type.name).toBe('heading');
    expect(tr.doc.child(1).attrs.level).toBe(3);
  });

  it('splits a block nested inside a list item, in that item', () => {
    const tr = at(doc(bullets(li(p(t('abcd'))))), 5);
    expect(insertParagraph(tr)).toBe(true);
    expect(String(tr.doc)).toBe('doc(bullet_list(list_item(paragraph("ab"), paragraph("cd"))))');
    expect(tr.selection.anchor).toBe(7);
  });

  it('removes the selection first, then splits at what is left', () => {
    // 2..5 covers "bcd"; what is left is "aef", split at the cursor the
    // deletion left behind.
    const tr = at(doc(p(t('abcdef'))), 2, 5);
    expect(insertParagraph(tr)).toBe(true);
    expect(textOf(tr.doc)).toBe('a|ef');
    expect(tr.selection.anchor).toBe(4);
  });

  it('ends the undo unit, so return does not group with the typing before it', () => {
    const tr = at(doc(p(t('abcd'))), 3);
    expect(insertParagraph(tr)).toBe(true);
    expect(tr.historyClosed).toBe(true);
  });

  it('declines where there is no block to split', () => {
    const tr = at(doc(rule()), 0);
    expect(insertParagraph(tr)).toBe(false);
    expect(String(tr.doc)).toBe('doc(horizontal_rule)');
  });
});

describe('deleting backwards', () => {
  it('takes one character off', () => {
    const tr = at(doc(p(t('abcd'))), 3);
    expect(deleteBackward(tr)).toBe(true);
    expect(textOf(tr.doc)).toBe('acd');
    expect(tr.selection.anchor).toBe(2);
  });

  it('takes one grapheme off, not one code unit', () => {
    // A family emoji is eight code units and one character to the person
    // pressing backspace. Deleting part of it leaves nonsense on screen.
    const family = '\u{1F468}‍\u{1F469}‍\u{1F466}';
    const tr = at(doc(p(t(`a${family}`))), 1 + 1 + family.length);
    expect(deleteBackward(tr)).toBe(true);
    expect(textOf(tr.doc)).toBe('a');
    expect(tr.selection.anchor).toBe(2);
  });

  it('deletes a whole inline leaf as one thing', () => {
    const tr = at(doc(p(t('ab'), image())), 4);
    expect(deleteBackward(tr)).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("ab"))');
    expect(tr.selection.anchor).toBe(3);
  });

  it('joins this block onto the one before it at the start of a block', () => {
    const tr = at(doc(p(t('ab')), p(t('cd'))), 5);
    expect(deleteBackward(tr)).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("abcd"))');
    // The join point: where the first block's content used to end. The map
    // cannot say this — both blocks were replaced wholesale.
    expect(tr.selection.anchor).toBe(3);
  });

  it('keeps the marks of both halves across a join', () => {
    const tr = at(doc(p(t('ab', em)), p(t('cd'))), 5);
    expect(deleteBackward(tr)).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph(em("ab"), "cd"))');
  });

  it('removes a block-level leaf sitting before the block', () => {
    const tr = at(doc(rule(), p(t('ab'))), 2);
    expect(deleteBackward(tr)).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("ab"))');
    // Nothing after the cursor moved relative to it, so the mapped position is
    // the right one and the command does not second-guess it.
    expect(tr.selection.anchor).toBe(1);
  });

  it('deletes the whole selection when there is one', () => {
    const tr = at(doc(p(t('abcd'))), 2, 4);
    expect(deleteBackward(tr)).toBe(true);
    expect(textOf(tr.doc)).toBe('ad');
  });

  it('declines at the very start of the document', () => {
    const tr = at(doc(p(t('ab'))), 1);
    expect(deleteBackward(tr)).toBe(false);
    expect(tr.changed).toBe(false);
  });

  it('declines rather than lifting a list item out of its list', () => {
    // Backspace at the start of the first paragraph of an item is a "lift",
    // which is a different command and not one this layer has.
    const tr = at(doc(bullets(li(p(t('ab'))))), 3);
    expect(deleteBackward(tr)).toBe(false);
    expect(tr.changed).toBe(false);
  });
});

describe('deleting forwards', () => {
  it('takes one character off after the cursor', () => {
    const tr = at(doc(p(t('abcd'))), 3);
    expect(deleteForward(tr)).toBe(true);
    expect(textOf(tr.doc)).toBe('abd');
    expect(tr.selection.anchor).toBe(3);
  });

  it('takes one grapheme off, not one code unit', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F466}';
    const tr = at(doc(p(t(`${family}a`))), 1);
    expect(deleteForward(tr)).toBe(true);
    expect(textOf(tr.doc)).toBe('a');
    expect(tr.selection.anchor).toBe(1);
  });

  it('pulls the next block onto this one at the end of a block', () => {
    const tr = at(doc(p(t('ab')), p(t('cd'))), 3);
    expect(deleteForward(tr)).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("abcd"))');
    expect(tr.selection.anchor).toBe(3);
  });

  it('removes a block-level leaf sitting after the block', () => {
    const tr = at(doc(p(t('ab')), rule()), 3);
    expect(deleteForward(tr)).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("ab"))');
    // The deletion is entirely after the cursor, so the map leaves it put.
    expect(tr.selection.anchor).toBe(3);
  });

  it('declines at the very end of the document', () => {
    const tr = at(doc(p(t('ab'))), 3);
    expect(deleteForward(tr)).toBe(false);
    expect(tr.changed).toBe(false);
  });
});

describe('deleting a word backwards', () => {
  it('takes the word before the cursor and the space in front of it', () => {
    const tr = at(doc(p(t('hello world'))), 12);
    expect(deleteWordBackward(tr)).toBe(true);
    expect(textOf(tr.doc)).toBe('hello ');
    expect(tr.selection.anchor).toBe(7);
  });

  it('takes the trailing space with the word before it, so repeats move a word at a time', () => {
    const tr = at(doc(p(t('hello world '))), 13);
    expect(deleteWordBackward(tr)).toBe(true);
    expect(textOf(tr.doc)).toBe('hello ');
  });

  it('treats a run of punctuation as its own word', () => {
    const tr = at(doc(p(t('a...'))), 5);
    expect(deleteWordBackward(tr)).toBe(true);
    expect(textOf(tr.doc)).toBe('a');
  });

  it('walks across a mark boundary, since a styled word is still one word', () => {
    const tr = at(doc(p(t('foo '), t('bar', em))), 8);
    expect(deleteWordBackward(tr)).toBe(true);
    expect(textOf(tr.doc)).toBe('foo ');
  });

  it('stops at an inline leaf rather than swallowing it as part of the word', () => {
    const tr = at(doc(p(t('ab'), image(), t('cd'))), 7);
    expect(deleteWordBackward(tr)).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("ab", image))');
  });

  it('falls back to a plain backspace when there is no text before the cursor', () => {
    const tr = at(doc(p(t('ab')), p(t('cd'))), 5);
    expect(deleteWordBackward(tr)).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("abcd"))');
    expect(tr.selection.anchor).toBe(3);
  });

  it('deletes the whole selection when there is one', () => {
    const tr = at(doc(p(t('hello world'))), 1, 6);
    expect(deleteWordBackward(tr)).toBe(true);
    expect(textOf(tr.doc)).toBe(' world');
  });
});

describe('inserting plain text', () => {
  it('puts a single line in as typing would', () => {
    const tr = at(doc(p(t('ab'))), 3);
    expect(insertPlainText(tr, 'XY')).toBe(true);
    expect(textOf(tr.doc)).toBe('abXY');
    expect(tr.selection.anchor).toBe(5);
  });

  it('turns line breaks into block boundaries', () => {
    const tr = at(doc(p(t('ab'))), 3);
    expect(insertPlainText(tr, 'X\nY')).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("abX"), paragraph("Y"))');
    expect(tr.selection.anchor).toBe(7);
  });

  it('keeps a blank line as an empty block', () => {
    const tr = at(doc(p(t('ab'))), 3);
    expect(insertPlainText(tr, 'X\n\nY')).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("abX"), paragraph, paragraph("Y"))');
  });

  it('reads a carriage return, alone or paired, as one break', () => {
    const crlf = at(doc(p()), 1);
    expect(insertPlainText(crlf, 'a\r\nb')).toBe(true);
    expect(String(crlf.doc)).toBe('doc(paragraph("a"), paragraph("b"))');

    const cr = at(doc(p()), 1);
    expect(insertPlainText(cr, 'a\rb')).toBe(true);
    expect(String(cr.doc)).toBe('doc(paragraph("a"), paragraph("b"))');
  });

  it('replaces the selection it was pasted over', () => {
    const tr = at(doc(p(t('abcd'))), 2, 4);
    expect(insertPlainText(tr, 'XY')).toBe(true);
    expect(textOf(tr.doc)).toBe('aXYd');
  });

  it('is one undoable thing, even when it made no new blocks', () => {
    // A single-line paste takes no `insertParagraph`, so this is the only
    // shape in which the paste itself is what ends the undo unit.
    const tr = at(doc(p(t('ab'))), 3);
    expect(insertPlainText(tr, 'XY')).toBe(true);
    expect(tr.historyClosed).toBe(true);
  });

  it('says it did nothing for an empty paste at a cursor', () => {
    const tr = at(doc(p(t('ab'))), 3);
    expect(insertPlainText(tr, '')).toBe(false);
    expect(tr.changed).toBe(false);
    expect(tr.historyClosed).toBe(false);
  });
});
