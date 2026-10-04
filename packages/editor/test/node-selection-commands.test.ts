/**
 * Every command over a block selected whole.
 *
 * A rule, or an image a schema declares as a block, selected as a node is
 * replaced the way a reader expects of a selected block: typing puts a
 * paragraph holding the text where it was, return an empty one, a line break
 * and a plain-text paste a paragraph holding what they bring, and the delete
 * keys take it away, the caret going to the nearest text the way the key
 * points. Each is one step and one undo unit, and the undo selects the block
 * again. Where its parent cannot be left without a block, an empty paragraph
 * stands in for it; where no textblock can stand in its place at all, every
 * command that would need one there declines, and that is pinned here as
 * well. On screen, a composition over a selected block is typing over it, and
 * what the input method wrote where the block was, or in the text either side
 * of it — inside the block's parent or not — is drawn over again.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Schema, basicSchema } from '../src/index.ts';
import type { Mark } from '../src/index.ts';
import {
  deleteBackward,
  deleteForward,
  deleteSelection,
  deleteWordBackward,
  deleteWordForward,
  insertHardBreak,
  insertParagraph,
  insertPlainText,
  insertText,
} from '../src/commands.ts';
import { EditorHistory } from '../src/history.ts';
import { applyInputType } from '../src/input.ts';
import type { Node } from '../src/node.ts';
import { resolve } from '../src/position.ts';
import { NodeSelection } from '../src/selection.ts';
import type { EditorSelection } from '../src/selection.ts';
import { EditorState, TextSelection } from '../src/state.ts';
import type { EditorTransaction } from '../src/state.ts';
import { EditorView } from '../src/view.ts';

const s = basicSchema;
const doc = (...content: Node[]) => s.node('doc', null, content);
const p = (...content: Node[]) => s.node('paragraph', null, content);
const t = (text: string, ...marks: Mark[]) => s.text(text, marks);
const quote = (...content: Node[]) => s.node('blockquote', null, content);
const ul = (...items: Node[]) => s.node('bullet_list', null, items);
const li = (...content: Node[]) => s.node('list_item', null, content);
const rule = () => s.node('horizontal_rule');
const image = () => s.node('image', { src: 'a.png' });
const strong = s.mark('strong');

type Command = (tr: EditorTransaction) => boolean;

/** A transaction over the node that starts at `pos`, selected whole. */
function over(document_: Node, pos: number): EditorTransaction {
  return EditorState.create(document_, NodeSelection.create(document_, pos)).tr();
}

/** What a command leaves, printed: the document and the selection, or null when it declined. */
function run(command: Command, document_: Node, pos: number): [string, string] | null {
  const tr = over(document_, pos);
  if (!command(tr)) {
    expect(tr.steps, 'a command that declines takes no step').toHaveLength(0);
    return null;
  }
  expect(tr.steps, 'one step').toHaveLength(1);
  return [String(tr.doc), String(tr.selection)];
}

const type = (text: string): Command => (tr) => insertText(tr, text);
const paste = (text: string): Command => (tr) => insertPlainText(tr, text);

// 0 <p> 1 a 2 b 3 </p> 4 [hr] 5 <p> 6 c 7 d 8 </p> 9
const between = doc(p(t('ab')), rule(), p(t('cd')));

// A schema whose first block is a title or a rule, and whose others are
// paragraphs or rules: the textblock that stands in depends on where.
const titled = new Schema({
  nodes: {
    doc: { content: '(title | rule) block*' },
    title: { content: 'text*' },
    paragraph: { content: 'text*', group: 'block' },
    rule: { group: 'block' },
    text: {},
  },
});
// 0 [rule] 1 [rule] 2
const twoRules = titled.node('doc', null, [titled.node('rule'), titled.node('rule')]);

// An image that is a block of its own, with no hard break in the schema.
const figures = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    image: { group: 'block', attrs: { src: {} } },
    text: { group: 'inline' },
  },
});
// 0 <p> 1 a 2 </p> 3 [img] 4 <p> 5 b 6 </p> 7
const figure = figures.node('doc', null, [
  figures.node('paragraph', null, [figures.text('a')]),
  figures.node('image', { src: 'a.png' }),
  figures.node('paragraph', null, [figures.text('b')]),
]);

describe('typing over a selected block', () => {
  it('puts a paragraph holding the text where a rule was, with the caret after the text', () => {
    expect(run(type('x'), between, 4)).toEqual([
      'doc(paragraph("ab"), paragraph("x"), paragraph("cd"))',
      'cursor(6)',
    ]);
  });

  it('does the same at either end of the document, and where the rule is all it holds', () => {
    expect(run(type('x'), doc(rule(), p(t('a'))), 0)).toEqual(['doc(paragraph("x"), paragraph("a"))', 'cursor(2)']);
    expect(run(type('x'), doc(p(t('a')), rule()), 3)).toEqual(['doc(paragraph("a"), paragraph("x"))', 'cursor(5)']);
    expect(run(type('x'), doc(rule()), 0)).toEqual(['doc(paragraph("x"))', 'cursor(2)']);
  });

  it('does the same inside a blockquote and a list item', () => {
    // 0 <bq> 1 [hr] 2 </bq> 3
    expect(run(type('x'), doc(quote(rule())), 1)).toEqual(['doc(blockquote(paragraph("x")))', 'cursor(3)']);
    // 0 <ul> 1 <li> 2 <p> 3 a 4 </p> 5 [hr] 6 </li> 7 </ul> 8
    expect(run(type('x'), doc(ul(li(p(t('a')), rule()))), 5)).toEqual([
      'doc(bullet_list(list_item(paragraph("a"), paragraph("x"))))',
      'cursor(7)',
    ]);
  });

  it('carries no marks over from the text either side, since a block boundary has none', () => {
    const bold = doc(p(t('ab', strong)), rule(), p(t('cd', strong)));
    const tr = over(bold, 4);
    expect(insertText(tr, 'x')).toBe(true);
    expect(tr.doc.child(1).firstChild!.marks).toEqual([]);
  });

  it('replaces an image a schema declares as a block', () => {
    expect(run(type('x'), figure, 3)).toEqual(['doc(paragraph("a"), paragraph("x"), paragraph("b"))', 'cursor(5)']);
  });

  it('replaces any block selected whole the same way, a blockquote included', () => {
    // 0 <p> 1 a 2 </p> 3 <bq> 4 <p> 5 b 6 </p> 7 </bq> 8 <p> 9 c 10 </p> 11
    const quoted = doc(p(t('a')), quote(p(t('b'))), p(t('c')));
    expect(run(type('x'), quoted, 3)).toEqual(['doc(paragraph("a"), paragraph("x"), paragraph("c"))', 'cursor(5)']);
    expect(run(deleteBackward, quoted, 3)).toEqual(['doc(paragraph("a"), paragraph("c"))', 'cursor(2)']);
  });

  it('uses the textblock the schema puts first at that place, which need not be a paragraph', () => {
    expect(run(type('x'), twoRules, 0)).toEqual(['doc(title("x"), rule)', 'cursor(2)']);
    expect(run(type('x'), twoRules, 1)).toEqual(['doc(rule, paragraph("x"))', 'cursor(3)']);
  });

  it('passes over a textblock that needs an attribute nobody gave', () => {
    const noted = new Schema({
      nodes: {
        doc: { content: 'block+' },
        note: { content: 'text*', group: 'block', attrs: { tone: {} } },
        paragraph: { content: 'text*', group: 'block' },
        rule: { group: 'block' },
        text: {},
      },
    });
    const document_ = noted.node('doc', null, [noted.node('rule')]);
    expect(run(type('x'), document_, 0)).toEqual(['doc(paragraph("x"))', 'cursor(2)']);
  });

  it('passes over a textblock the rest of the parent could not follow', () => {
    // `one` comes first, but only `two` can be followed by the rule after it.
    const picky = new Schema({
      nodes: {
        doc: { content: '(one rule rule) | (two rule) | (rule rule)' },
        one: { content: 'text*' },
        two: { content: 'text*' },
        rule: {},
        text: {},
      },
    });
    // 0 [rule] 1 [rule] 2
    const document_ = picky.node('doc', null, [picky.node('rule'), picky.node('rule')]);
    expect(run(type('x'), document_, 0)).toEqual(['doc(two("x"), rule)', 'cursor(2)']);
  });

  it('takes typing nothing over a selected block as deleting it, as typing nothing over a range does', () => {
    expect(run(type(''), between, 4)).toEqual(['doc(paragraph("ab"), paragraph("cd"))', 'cursor(5)']);
  });

  it('goes through the input layer as typing does', () => {
    const tr = over(between, 4);
    expect(applyInputType(tr, 'insertText', new InputEvent('beforeinput', { inputType: 'insertText', data: 'x' }))).toBe(
      true,
    );
    expect(String(tr.doc)).toBe('doc(paragraph("ab"), paragraph("x"), paragraph("cd"))');
  });
});

describe('return, a line break and a plain-text paste over a selected block', () => {
  it('puts an empty paragraph where the rule was on return, with the caret in it, and closes the undo unit', () => {
    expect(run(insertParagraph, between, 4)).toEqual([
      'doc(paragraph("ab"), paragraph, paragraph("cd"))',
      'cursor(5)',
    ]);
    const tr = over(between, 4);
    insertParagraph(tr);
    expect(tr.historyClosed).toBe(true);
  });

  it('puts a paragraph holding the break there on a line break, with the caret after it', () => {
    // 4 <p> 5 [br] 6 </p> 7
    expect(run(insertHardBreak, between, 4)).toEqual([
      'doc(paragraph("ab"), paragraph(hard_break), paragraph("cd"))',
      'cursor(6)',
    ]);
    const tr = over(between, 4);
    insertHardBreak(tr);
    expect(tr.historyClosed).toBe(true);
  });

  it('uses the first textblock the place takes that can hold a break', () => {
    const coded = new Schema({
      nodes: {
        doc: { content: 'block+' },
        code: { content: 'text*', group: 'block', marks: '' },
        paragraph: { content: 'inline*', group: 'block' },
        rule: { group: 'block' },
        text: { group: 'inline' },
        hard_break: { group: 'inline', inline: true },
      },
    });
    const document_ = coded.node('doc', null, [coded.node('rule')]);
    expect(run(type('x'), document_, 0)).toEqual(['doc(code("x"))', 'cursor(2)']);
    expect(run(insertHardBreak, document_, 0)).toEqual(['doc(paragraph(hard_break))', 'cursor(2)']);
  });

  it('puts a paragraph for each pasted line there, in one step, with the caret after the last', () => {
    // 4 <p> 5 one 8 </p> 9 <p> 10 two 13 </p> 14
    expect(run(paste('one\ntwo'), between, 4)).toEqual([
      'doc(paragraph("ab"), paragraph("one"), paragraph("two"), paragraph("cd"))',
      'cursor(13)',
    ]);
    expect(run(paste('x\r\n\r\ny'), between, 4)).toEqual([
      'doc(paragraph("ab"), paragraph("x"), paragraph, paragraph("y"), paragraph("cd"))',
      'cursor(11)',
    ]);
    const tr = over(between, 4);
    insertPlainText(tr, 'one');
    expect(tr.historyClosed).toBe(true);
  });

  it('takes a paste of nothing over a selected block as deleting it, as a paste of nothing over a range does', () => {
    expect(run(paste(''), between, 4)).toEqual(['doc(paragraph("ab"), paragraph("cd"))', 'cursor(5)']);
  });

  it('puts each pasted line in the textblock the place takes at that point', () => {
    // 0 <title> 1 one 4 </title> 5 <p> 6 two 9 </p> 10 [rule] 11
    expect(run(paste('one\ntwo'), twoRules, 0)).toEqual(['doc(title("one"), paragraph("two"), rule)', 'cursor(9)']);
  });

  it('takes a paste of plain text from the input layer the same way', () => {
    const tr = over(between, 4);
    const event = new InputEvent('beforeinput', { inputType: 'insertFromPaste', data: 'one\ntwo' });
    expect(applyInputType(tr, 'insertFromPaste', event)).toBe(true);
    expect(tr.steps).toHaveLength(1);
    expect(String(tr.doc)).toBe('doc(paragraph("ab"), paragraph("one"), paragraph("two"), paragraph("cd"))');
  });
});

describe('the delete keys on a selected block', () => {
  it('backspace takes the rule away and puts the caret at the end of the text before it', () => {
    expect(run(deleteBackward, between, 4)).toEqual(['doc(paragraph("ab"), paragraph("cd"))', 'cursor(3)']);
    expect(run(deleteWordBackward, between, 4)).toEqual(['doc(paragraph("ab"), paragraph("cd"))', 'cursor(3)']);
  });

  it('delete takes it away and puts the caret at the start of the text after it', () => {
    expect(run(deleteForward, between, 4)).toEqual(['doc(paragraph("ab"), paragraph("cd"))', 'cursor(5)']);
    expect(run(deleteWordForward, between, 4)).toEqual(['doc(paragraph("ab"), paragraph("cd"))', 'cursor(5)']);
    expect(run(deleteSelection, between, 4)).toEqual(['doc(paragraph("ab"), paragraph("cd"))', 'cursor(5)']);
  });

  it('passes over other blocks on the way to the nearest text, and out of a container', () => {
    // 0 <p> 1 a 2 </p> 3 [hr] 4 [hr] 5 <p> 6 b 7 </p> 8
    const rules = doc(p(t('a')), rule(), rule(), p(t('b')));
    expect(run(deleteBackward, rules, 4)).toEqual(['doc(paragraph("a"), horizontal_rule, paragraph("b"))', 'cursor(2)']);
    expect(run(deleteForward, rules, 3)).toEqual(['doc(paragraph("a"), horizontal_rule, paragraph("b"))', 'cursor(5)']);
    // 0 <p> 1 a 2 </p> 3 <bq> 4 [hr] 5 <p> 6 b 7 </p> 8 </bq> 9
    const quoted = doc(p(t('a')), quote(rule(), p(t('b'))));
    expect(run(deleteBackward, quoted, 4)).toEqual(['doc(paragraph("a"), blockquote(paragraph("b")))', 'cursor(2)']);
    // 0 <ul> 1 <li> 2 <p> 3 a 4 </p> 5 [hr] 6 </li> 7 </ul> 8
    expect(run(deleteForward, doc(ul(li(p(t('a')), rule()))), 5)).toEqual([
      'doc(bullet_list(list_item(paragraph("a"))))',
      'cursor(4)',
    ]);
  });

  it('goes the other way at the edge of the document', () => {
    expect(run(deleteBackward, doc(rule(), p(t('a'))), 0)).toEqual(['doc(paragraph("a"))', 'cursor(1)']);
    expect(run(deleteForward, doc(p(t('a')), rule()), 3)).toEqual(['doc(paragraph("a"))', 'cursor(2)']);
  });

  it('passes over other blocks the other way too, rather than selecting the next one', () => {
    // 0 [hr] 1 [hr] 2 <p> 3 a 4 </p> 5
    expect(run(deleteBackward, doc(rule(), rule(), p(t('a'))), 0)).toEqual([
      'doc(horizontal_rule, paragraph("a"))',
      'cursor(2)',
    ]);
    // 0 <p> 1 a 2 </p> 3 [hr] 4 [hr] 5
    expect(run(deleteForward, doc(p(t('a')), rule(), rule()), 4)).toEqual([
      'doc(paragraph("a"), horizontal_rule)',
      'cursor(2)',
    ]);
  });

  it('selects the nearest block left when the document has no text either way', () => {
    expect(run(deleteBackward, doc(rule(), rule()), 1)).toEqual(['doc(horizontal_rule)', 'node(horizontal_rule@0)']);
    expect(run(deleteForward, doc(rule(), rule()), 0)).toEqual(['doc(horizontal_rule)', 'node(horizontal_rule@0)']);
  });

  it('puts an empty paragraph where a rule was that is all its blockquote or the document holds', () => {
    // `block+` needs a block there, so one stands in, and the caret goes into it.
    for (const command of [deleteBackward, deleteForward, deleteSelection]) {
      expect(run(command, doc(rule()), 0)).toEqual(['doc(paragraph)', 'cursor(1)']);
      // 0 <p> 1 a 2 </p> 3 <bq> 4 [hr] 5 </bq> 6
      expect(run(command, doc(p(t('a')), quote(rule())), 4)).toEqual([
        'doc(paragraph("a"), blockquote(paragraph))',
        'cursor(5)',
      ]);
    }
  });
});

describe('every command over a rule selected anywhere', () => {
  // Wherever the rule is, each command is one replacement that leaves a
  // caret in text, an undo puts the rule back selected, and a redo puts the
  // caret back where the command left it.
  const places: [string, Node, number][] = [
    ['first in the document', doc(rule(), p(t('a'))), 0],
    ['between paragraphs', between, 4],
    ['last in the document', doc(p(t('a')), rule()), 3],
    // 0 <ul> 1 <li> 2 <p> 3 a 4 </p> 5 [hr] 6 </li> 7 <li> ...
    ['in a list item', doc(ul(li(p(t('a')), rule()), li(p(t('b'))))), 5],
    // 0 <p> 1 a 2 </p> 3 <bq> 4 [hr] 5 <p> ...
    ['first in a blockquote', doc(p(t('a')), quote(rule(), p(t('b')))), 4],
    ['all a blockquote holds', doc(p(t('a')), quote(rule()), p(t('b'))), 4],
    ['all the document holds', doc(rule()), 0],
  ];
  const commands: [string, Command][] = [
    ['typing', type('x')],
    ['return', insertParagraph],
    ['a line break', insertHardBreak],
    ['a plain-text paste', paste('one\ntwo')],
    ['backspace', deleteBackward],
    ['delete', deleteForward],
    ['a word backspace', deleteWordBackward],
    ['a word delete', deleteWordForward],
    ['deleteSelection', deleteSelection],
  ];

  for (const [where, document_, pos] of places) {
    it(`replaces a rule ${where} in one step, and undoes and redoes it`, () => {
      for (const [name, command] of commands) {
        const history = new EditorHistory({ now: () => 0 });
        let state = EditorState.create(document_, NodeSelection.create(document_, pos));
        const tr = state.tr();
        expect(command(tr), name).toBe(true);
        expect(tr.steps, name).toHaveLength(1);
        const caret = tr.selection;
        expect(caret instanceof TextSelection && caret.empty, `${name} left ${caret}`).toBe(true);
        expect(resolve(tr.doc, caret.head).parent.inlineContent, `${name} left ${caret} outside text`).toBe(true);
        state = state.apply(tr);
        history.record(tr);
        const after = state;

        const undo = history.undo(state)!;
        state = state.apply(undo);
        history.record(undo);
        expect(state.doc.eq(document_), name).toBe(true);
        expect(String(state.selection), name).toBe(`node(horizontal_rule@${pos})`);

        const redo = history.redo(state)!;
        state = state.apply(redo);
        history.record(redo);
        expect(state.doc.eq(after.doc), name).toBe(true);
        expect(String(state.selection), name).toBe(String(after.selection));
      }
    });
  }
});

describe('every command over every node in a document of everything', () => {
  const h = (...content: Node[]) => s.node('heading', { level: 1 }, content);
  const code = (...content: Node[]) => s.node('code_block', null, content);
  // Something of everything at an edge, as in node-selection-edges.test.ts.
  const everything = doc(
    h(t('Ti'), t('tle', strong)),
    p(t('ab'), image(), t('cd')),
    ul(li(p(t('one'))), li(p(image()), rule())),
    rule(),
    quote(rule()),
    code(t('let x')),
    p(),
  );
  const commands: [string, Command][] = [
    ['typing', type('x')],
    ['return', insertParagraph],
    ['a line break', insertHardBreak],
    ['a plain-text paste', paste('a\nb')],
    ['backspace', deleteBackward],
    ['delete', deleteForward],
    ['a word backspace', deleteWordBackward],
    ['a word delete', deleteWordForward],
    ['deleteSelection', deleteSelection],
  ];

  it('declines with no step, or leaves a valid document with a selection in it that its inverse takes back', () => {
    const failures: string[] = [];
    let replaced = 0;
    for (let pos = 0; pos < everything.content.size; pos++) {
      let selection: NodeSelection;
      try {
        selection = NodeSelection.create(everything, pos);
      } catch {
        continue;
      }
      for (const [name, command] of commands) {
        const where = `${name} over ${selection}`;
        const tr = EditorState.create(everything, selection).tr();
        if (!command(tr)) {
          if (tr.steps.length > 0) failures.push(`${where}: declined after ${tr.steps.length} steps`);
          continue;
        }
        // A block goes in one step; an image is a range in its paragraph,
        // where a paste of two lines is typing and a split.
        if (!selection.node.isInline) {
          replaced++;
          if (tr.steps.length !== 1) failures.push(`${where}: ${tr.steps.length} steps`);
          if (!(tr.selection instanceof TextSelection && tr.selection.empty)) failures.push(`${where}: left ${tr.selection}`);
        }
        try {
          EditorState.create(tr.doc, tr.selection);
        } catch {
          failures.push(`${where}: left ${tr.selection}, which is not a selection in ${tr.doc}`);
        }
        let back = tr.doc;
        for (const step of tr.invert(everything)) {
          const result = step.apply(back);
          if (!result.ok) break;
          back = result.doc;
        }
        if (!back.eq(everything)) failures.push(`${where}: its inverse did not put it back`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(replaced).toBeGreaterThan(100);
  });
});

describe('one step and one undo unit, which selects the block again', () => {
  const commands: [string, Command][] = [
    ['typing', type('x')],
    ['return', insertParagraph],
    ['a line break', insertHardBreak],
    ['a plain-text paste', paste('one\ntwo')],
    ['backspace', deleteBackward],
    ['delete', deleteForward],
    ['a word backspace', deleteWordBackward],
    ['a word delete', deleteWordForward],
  ];

  for (const [name, command] of commands) {
    it(`undoes ${name} with the rule back and selected, and redoes it with the caret where it left it`, () => {
      const history = new EditorHistory({ now: () => 0 });
      let state = EditorState.create(between, NodeSelection.create(between, 4));
      const tr = state.tr();
      expect(command(tr)).toBe(true);
      expect(tr.steps).toHaveLength(1);
      state = state.apply(tr);
      history.record(tr);
      const after = state;
      expect(history.undoDepth).toBe(1);

      const undo = history.undo(state)!;
      state = state.apply(undo);
      history.record(undo);
      expect(state.doc.eq(between)).toBe(true);
      expect(String(state.selection)).toBe('node(horizontal_rule@4)');

      const redo = history.redo(state)!;
      state = state.apply(redo);
      history.record(redo);
      expect(state.doc.eq(after.doc)).toBe(true);
      expect(state.selection.eq(after.selection)).toBe(true);
    });
  }

  it('takes back the replacement alone when typing came before the rule was selected', () => {
    const history = new EditorHistory({ now: () => 0 });
    const apply = (state: EditorState, edit: (tr: EditorTransaction) => unknown): EditorState => {
      const tr = state.tr();
      edit(tr);
      history.record(tr);
      return state.apply(tr);
    };
    let state = EditorState.create(between, TextSelection.create(between, 3));
    state = apply(state, (tr) => insertText(tr, 'z'));
    state = apply(state, (tr) => tr.setSelection(NodeSelection.create(tr.doc, 5)));
    state = apply(state, (tr) => insertText(tr, 'x'));
    state = apply(state, (tr) => insertText(tr, 'y'));
    expect(String(state.doc)).toBe('doc(paragraph("abz"), paragraph("xy"), paragraph("cd"))');

    const undo = history.undo(state)!;
    state = state.apply(undo);
    history.record(undo);
    expect(String(state.doc)).toBe('doc(paragraph("abz"), horizontal_rule, paragraph("cd"))');
    expect(String(state.selection)).toBe('node(horizontal_rule@5)');
  });

  it('selects an image again after an undo of typing over it, as it does a block', () => {
    // 0 <p> 1 a 2 [img] 3 b 4 </p> 5
    const withImage = doc(p(t('a'), image(), t('b')));
    const history = new EditorHistory({ now: () => 0 });
    let state = EditorState.create(withImage, NodeSelection.create(withImage, 2));
    const tr = state.tr();
    insertText(tr, 'x');
    state = state.apply(tr);
    history.record(tr);
    const undo = history.undo(state)!;
    expect(String(state.apply(undo).selection)).toBe('node(image@2)');
  });
});

describe('where no textblock can stand in the place of the block selected', () => {
  // A gallery holds rules and nothing else, so a rule selected in one has no
  // place a paragraph could take, and the last one cannot go without one.
  const galleries = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { content: 'inline*', group: 'block' },
      gallery: { content: 'rule+', group: 'block' },
      rule: {},
      text: { group: 'inline' },
      hard_break: { group: 'inline', inline: true },
    },
  });
  const g = galleries;
  // 0 <p> 1 a 2 </p> 3 <gallery> 4 [rule] 5 </gallery> 6
  const one = g.node('doc', null, [g.node('paragraph', null, [g.text('a')]), g.node('gallery', null, [g.node('rule')])]);
  // ... 4 [rule] 5 [rule] 6 </gallery> 7
  const two = g.node('doc', null, [
    g.node('paragraph', null, [g.text('a')]),
    g.node('gallery', null, [g.node('rule'), g.node('rule')]),
  ]);

  const every: [string, Command][] = [
    ['typing', type('x')],
    ['return', insertParagraph],
    ['a line break', insertHardBreak],
    ['a plain-text paste', paste('x')],
    ['backspace', deleteBackward],
    ['delete', deleteForward],
    ['deleteSelection', deleteSelection],
  ];

  it('declines every command over the last rule in a gallery, changing nothing', () => {
    for (const [name, command] of every) {
      expect(run(command, one, 4), name).toBeNull();
    }
  });

  it('declines typing, return, a break and a paste over any rule there, but deletes one the gallery can spare', () => {
    for (const [name, command] of every.slice(0, 4)) {
      expect(run(command, two, 5), name).toBeNull();
    }
    expect(run(deleteBackward, two, 5)).toEqual(['doc(paragraph("a"), gallery(rule))', 'cursor(2)']);
  });

  it('declines typing over a list item selected whole, since a list holds only items', () => {
    // 0 <ul> 1 <li> 2 <p> 3 a 4 </p> 5 </li> 6 </ul> 7
    const list = doc(ul(li(p(t('a')))));
    expect(run(type('x'), list, 1)).toBeNull();
    expect(run(insertParagraph, list, 1)).toBeNull();
    expect(run(deleteBackward, list, 1)).toBeNull();
    // ... 6 <li> 7 <p> 8 b 9 </p> 10 </li> 11 </ul> 12
    const items = doc(ul(li(p(t('a'))), li(p(t('b')))));
    expect(run(deleteBackward, items, 6)).toEqual(['doc(bullet_list(list_item(paragraph("a"))))', 'cursor(4)']);
  });

  it('declines a line break over a block in a schema with no hard break', () => {
    expect(run(insertHardBreak, figure, 3)).toBeNull();
  });

  it('declines a paste whose first line would have to take a later choice of textblock for the next to fit', () => {
    // Stated in commands.ts: each line's textblock but the last is the first
    // that holds it, chosen without looking ahead. `one` takes the first line
    // and leaves the second nowhere, where `two two` would have held both.
    const ahead = new Schema({
      nodes: {
        doc: { content: 'one | (two two) | rule' },
        one: { content: 'text*' },
        two: { content: 'text*' },
        rule: {},
        text: {},
      },
    });
    const document_ = ahead.node('doc', null, [ahead.node('rule')]);
    expect(run(paste('a'), document_, 0)).toEqual(['doc(one("a"))', 'cursor(2)']);
    expect(run(paste('a\nb'), document_, 0)).toBeNull();
  });
});

const open: EditorView[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()!.destroy();
  const active = window.document.activeElement;
  if (active instanceof HTMLElement) active.blur();
  window.document.getSelection()?.removeAllRanges();
  window.document.body.replaceChildren();
});

function view(document_: Node, selection: EditorSelection): EditorView {
  const mount = window.document.createElement('div');
  window.document.body.appendChild(mount);
  const created = new EditorView(mount, { state: EditorState.create(document_, selection) });
  open.push(created);
  created.focus();
  return created;
}

function beforeInput(view_: EditorView, inputType: string, init: Record<string, unknown> = {}): InputEvent {
  const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true, ...init });
  view_.dom.dispatchEvent(event);
  return event;
}

function undoKey(view_: EditorView): void {
  view_.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
}

function redoKey(view_: EditorView): void {
  view_.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
  );
}

/** happy-dom, like every browser, will not take `data` through the constructor, so it is assigned afterwards. */
function composition(view_: EditorView, type_: string, data?: string): void {
  const event = new CompositionEvent(type_, { bubbles: true });
  if (data !== undefined) (event as { data: string }).data = data;
  view_.dom.dispatchEvent(event);
}

const domSelection = () => window.document.getSelection()!;
const drawnSelected = (view_: EditorView) => Array.from(view_.dom.querySelectorAll('.volt-selected-node'));

/** Where the DOM selection's two ends are, as document positions. */
function domRange(view_: EditorView): [number | null, number | null] {
  const at = domSelection();
  return [view_.posAtDOM(at.anchorNode!, at.anchorOffset), view_.posAtDOM(at.focusNode!, at.focusOffset)];
}

describe('a selected block on screen', () => {
  it('types over a selected rule, drawing the paragraph and the caret after the text', () => {
    const editing = view(between, NodeSelection.create(between, 4));
    expect(beforeInput(editing, 'insertText', { data: 'x' }).defaultPrevented).toBe(true);

    expect(editing.dom.innerHTML).toBe('<p>ab</p><p>x</p><p>cd</p>');
    expect(drawnSelected(editing)).toEqual([]);
    expect(domRange(editing)).toEqual([6, 6]);
  });

  it('takes it away on backspace, and an undo draws it selected again', () => {
    const editing = view(between, NodeSelection.create(between, 4));
    beforeInput(editing, 'deleteContentBackward');
    expect(editing.dom.innerHTML).toBe('<p>ab</p><p>cd</p>');
    expect(domRange(editing)).toEqual([3, 3]);

    undoKey(editing);
    expect(String(editing.state.selection)).toBe('node(horizontal_rule@4)');
    expect(drawnSelected(editing)).toEqual([editing.dom.querySelector('hr')]);
    expect(domRange(editing)).toEqual([4, 5]);
  });

  it('takes it away on delete, with the caret at the start of the text after', () => {
    const editing = view(between, NodeSelection.create(between, 4));
    beforeInput(editing, 'deleteContentForward');
    expect(editing.dom.innerHTML).toBe('<p>ab</p><p>cd</p>');
    expect(domRange(editing)).toEqual([5, 5]);
  });

  it('puts the caret in the paragraph return leaves, round the rule again on undo, and back on redo', () => {
    const editing = view(between, NodeSelection.create(between, 4));
    beforeInput(editing, 'insertParagraph');
    expect(editing.dom.innerHTML).toBe('<p>ab</p><p><br></p><p>cd</p>');
    expect(domRange(editing)).toEqual([5, 5]);

    undoKey(editing);
    expect(editing.dom.innerHTML).toBe('<p>ab</p><hr class="volt-selected-node"><p>cd</p>');
    expect(domRange(editing)).toEqual([4, 5]);

    redoKey(editing);
    expect(editing.dom.innerHTML).toBe('<p>ab</p><p><br></p><p>cd</p>');
    expect(String(editing.state.selection)).toBe('cursor(5)');
    expect(domRange(editing)).toEqual([5, 5]);
  });

  it('takes a composition over a selected rule as typing, drawing the composed text once', () => {
    const editing = view(between, NodeSelection.create(between, 4));
    composition(editing, 'compositionstart');
    // What a browser does with a range round a rule: the rule goes, and the
    // input method writes a text node of its own where it was.
    editing.dom.querySelector('hr')!.replaceWith(window.document.createTextNode('に'));
    composition(editing, 'compositionend', '日本');

    expect(String(editing.state.doc)).toBe('doc(paragraph("ab"), paragraph("日本"), paragraph("cd"))');
    expect(editing.dom.innerHTML).toBe('<p>ab</p><p>日本</p><p>cd</p>');
    expect(domRange(editing)).toEqual([7, 7]);

    undoKey(editing);
    expect(editing.dom.innerHTML).toBe('<p>ab</p><hr class="volt-selected-node"><p>cd</p>');
    expect(String(editing.state.selection)).toBe('node(horizontal_rule@4)');
  });

  it('takes back a composition over a selected rule that the browser wrote into the paragraph before it', () => {
    // An engine may move the collapsed point where the rule was into the text
    // beside it before composing there.
    const editing = view(between, NodeSelection.create(between, 4));
    composition(editing, 'compositionstart');
    editing.dom.querySelector('hr')!.remove();
    editing.dom.firstChild!.appendChild(window.document.createTextNode('に'));
    composition(editing, 'compositionend', '日本');

    expect(String(editing.state.doc)).toBe('doc(paragraph("ab"), paragraph("日本"), paragraph("cd"))');
    expect(editing.dom.innerHTML).toBe('<p>ab</p><p>日本</p><p>cd</p>');
    expect(domRange(editing)).toEqual([7, 7]);
  });

  it('takes back a composition over the first rule in a blockquote that the browser wrote into the paragraph before the quote', () => {
    // The text beside a block need not share its parent: the nearest text
    // before a quote's first block is outside the quote.
    // 0 <p> 1 a 2 </p> 3 <bq> 4 [hr] 5 <p> 6 b 7 </p> 8 </bq> 9
    const document_ = doc(p(t('a')), quote(rule(), p(t('b'))));
    const editing = view(document_, NodeSelection.create(document_, 4));
    composition(editing, 'compositionstart');
    editing.dom.querySelector('hr')!.remove();
    const written = window.document.createTextNode('に');
    editing.dom.firstChild!.appendChild(written);
    // An input method leaves the browser's selection after what it wrote.
    domSelection().setBaseAndExtent(written, 1, written, 1);
    composition(editing, 'compositionend', '日本');

    // 3 <bq> 4 <p> 5 日本 7 </p> 8 <p> 9 b 10 </p> 11 </bq> 12
    expect(String(editing.state.doc)).toBe('doc(paragraph("a"), blockquote(paragraph("日本"), paragraph("b")))');
    expect(editing.dom.innerHTML).toBe('<p>a</p><blockquote><p>日本</p><p>b</p></blockquote>');
    expect(String(editing.state.selection)).toBe('cursor(7)');
    expect(domRange(editing)).toEqual([7, 7]);
  });

  it('takes back a composition over the last rule in a list item that the browser wrote into the paragraph after the list', () => {
    // 0 <ul> 1 <li> 2 <p> 3 a 4 </p> 5 [hr] 6 </li> 7 </ul> 8 <p> 9 z 10 </p> 11
    const document_ = doc(ul(li(p(t('a')), rule())), p(t('z')));
    const editing = view(document_, NodeSelection.create(document_, 5));
    composition(editing, 'compositionstart');
    editing.dom.querySelector('hr')!.remove();
    const written = window.document.createTextNode('に');
    const after = editing.dom.lastElementChild!;
    after.insertBefore(written, after.firstChild);
    domSelection().setBaseAndExtent(written, 1, written, 1);
    composition(editing, 'compositionend', '日本');

    // 5 <p> 6 日本 8 </p> 9 </li> 10 </ul> 11 <p> 12 z 13 </p> 14
    expect(String(editing.state.doc)).toBe(
      'doc(bullet_list(list_item(paragraph("a"), paragraph("日本"))), paragraph("z"))',
    );
    expect(editing.dom.innerHTML).toBe('<ul><li><p>a</p><p>日本</p></li></ul><p>z</p>');
    expect(String(editing.state.selection)).toBe('cursor(8)');
    expect(domRange(editing)).toEqual([8, 8]);
  });

  it('draws the rule back, still selected, when a composition over it ends with nothing', () => {
    const editing = view(between, NodeSelection.create(between, 4));
    composition(editing, 'compositionstart');
    editing.dom.querySelector('hr')!.replaceWith(window.document.createTextNode('に'));
    composition(editing, 'compositionend', '');

    expect(editing.state.doc).toBe(between);
    expect(editing.dom.innerHTML).toBe('<p>ab</p><hr class="volt-selected-node"><p>cd</p>');
    expect(domRange(editing)).toEqual([4, 5]);
  });

  it('draws a composition over a rule in a blockquote again from the text before it to the text after, and no further', () => {
    // The text either side of this rule is inside the quote, so the blocks
    // outside it keep their elements.
    // 0 <p> 1 a 2 </p> 3 <bq> 4 <p> 5 b 6 </p> 7 [hr] 8 <p> 9 c 10 </p> 11 </bq> 12 <p> 13 d 14 </p> 15
    const document_ = doc(p(t('a')), quote(p(t('b')), rule(), p(t('c'))), p(t('d')));
    const editing = view(document_, NodeSelection.create(document_, 7));
    const [first, , last] = Array.from(editing.dom.children);
    composition(editing, 'compositionstart');
    editing.dom.querySelector('hr')!.replaceWith(window.document.createTextNode('に'));
    composition(editing, 'compositionend', '日本');

    // 7 <p> 8 日本 10 </p> 11
    expect(String(editing.state.doc)).toBe(
      'doc(paragraph("a"), blockquote(paragraph("b"), paragraph("日本"), paragraph("c")), paragraph("d"))',
    );
    expect(editing.dom.innerHTML).toBe('<p>a</p><blockquote><p>b</p><p>日本</p><p>c</p></blockquote><p>d</p>');
    expect(editing.dom.children[0]).toBe(first);
    expect(editing.dom.children[2]).toBe(last);
    expect(domRange(editing)).toEqual([10, 10]);
  });

  it('keeps the caret where a click put it beyond the text either side of a block a composition was over', () => {
    // 0 <p> 1 a 2 </p> 3 <bq> 4 <p> 5 b 6 </p> 7 [hr] 8 <p> 9 c 10 </p> 11 </bq> 12 <p> 13 d 14 </p> 15
    const document_ = doc(p(t('a')), quote(p(t('b')), rule(), p(t('c'))), p(t('d')));
    const editing = view(document_, NodeSelection.create(document_, 7));
    composition(editing, 'compositionstart');
    editing.dom.querySelector('hr')!.replaceWith(window.document.createTextNode('に'));
    // The click commits the composition, which ends after the selection moved.
    const last = editing.dom.lastElementChild!.firstChild!;
    domSelection().setBaseAndExtent(last, 1, last, 1);
    composition(editing, 'compositionend', '日本');

    // 15 <p> 16 d 17 </p> 18, once the paragraph holding 日本 is in.
    expect(String(editing.state.doc)).toBe(
      'doc(paragraph("a"), blockquote(paragraph("b"), paragraph("日本"), paragraph("c")), paragraph("d"))',
    );
    expect(String(editing.state.selection)).toBe('cursor(17)');
    expect(domRange(editing)).toEqual([17, 17]);
  });

  it('draws a composition over the only rule in a blockquote again out to the text either side of the quote', () => {
    // The nearest text on both sides of this rule is outside the quote; here
    // the browser composed in the paragraph after it.
    // 0 <p> 1 a 2 </p> 3 <bq> 4 [hr] 5 </bq> 6 <p> 7 b 8 </p> 9
    const document_ = doc(p(t('a')), quote(rule()), p(t('b')));
    const editing = view(document_, NodeSelection.create(document_, 4));
    composition(editing, 'compositionstart');
    editing.dom.querySelector('hr')!.remove();
    const written = window.document.createTextNode('に');
    editing.dom.lastElementChild!.prepend(written);
    domSelection().setBaseAndExtent(written, 1, written, 1);
    composition(editing, 'compositionend', '日本');

    // 3 <bq> 4 <p> 5 日本 7 </p> 8 </bq> 9
    expect(String(editing.state.doc)).toBe('doc(paragraph("a"), blockquote(paragraph("日本")), paragraph("b"))');
    expect(editing.dom.innerHTML).toBe('<p>a</p><blockquote><p>日本</p></blockquote><p>b</p>');
    expect(String(editing.state.selection)).toBe('cursor(7)');
    expect(domRange(editing)).toEqual([7, 7]);
  });

  it('takes a composition over a selected image as typing in its paragraph, and an undo selects the image', () => {
    // 0 <p> 1 a 2 [img] 3 b 4 </p> 5
    const document_ = doc(p(t('a'), image(), t('b')));
    const editing = view(document_, NodeSelection.create(document_, 2));
    composition(editing, 'compositionstart');
    editing.dom.querySelector('img')!.replaceWith(window.document.createTextNode('に'));
    composition(editing, 'compositionend', '日本');

    expect(String(editing.state.doc)).toBe('doc(paragraph("a日本b"))');
    expect(editing.dom.innerHTML).toBe('<p>a日本b</p>');
    expect(domRange(editing)).toEqual([4, 4]);

    undoKey(editing);
    expect(String(editing.state.selection)).toBe('node(image@2)');
    expect(drawnSelected(editing)).toEqual([editing.dom.querySelector('img')]);
  });
});
