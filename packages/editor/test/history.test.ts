/**
 * The undo stack.
 *
 * Two things are hard to test here and both are tested by construction rather
 * than by waiting. Grouping is a question about a clock, so the clock is handed
 * in and moved by hand; a suite that slept for the group delay would be a suite
 * that fails whenever the machine is busy.
 *
 * The other is the selection. Every assertion about an undo checks where the
 * caret ended up as well as what the document says, and the cases are chosen so
 * that the two answers disagree — an edit that swallowed the selection, so that
 * mapping the caret back through the inverse steps gives a *different* position
 * from the one the edit began at. A test whose edit happens where the cursor
 * already is passes whether the selection was restored or merely carried along,
 * which is no test at all.
 */

import { describe, expect, it } from 'vitest';
import { basicSchema } from '../src/index.ts';
import { EditorHistory } from '../src/history.ts';
import type { HistoryOptions } from '../src/history.ts';
import { EditorState, TextSelection } from '../src/state.ts';
import type { EditorTransaction } from '../src/state.ts';
import { Fragment, Slice } from '../src/node.ts';
import type { Node } from '../src/node.ts';

const s = basicSchema;
const doc = (...content: Node[]) => s.node('doc', null, content);
const p = (...content: Node[]) => s.node('paragraph', null, content);
const code = (...content: Node[]) => s.node('code_block', null, content);
const t = (text: string) => s.text(text);
const image = () => s.node('image', { src: 'a.png' });

const textOf = (node: Node) => node.textBetween(0, node.content.size, '|');

/**
 * An editor with a history and a clock the test winds by hand.
 *
 * `apply` is the loop a host would run: hand the transaction to the state,
 * then tell the history about it. Doing both in one place is also how the
 * tests stay honest about the rule that the stacks only move on `record`.
 */
function session(document: Node, anchor?: number, options: HistoryOptions = {}) {
  let state = anchor === undefined
    ? EditorState.create(document)
    : EditorState.create(document, TextSelection.create(document, anchor));
  let clock = 0;
  const history = new EditorHistory({ now: () => clock, ...options });

  return {
    history,
    get state(): EditorState {
      return state;
    },
    get text(): string {
      return textOf(state.doc);
    },
    get selection(): TextSelection {
      return state.selection;
    },
    /** Move the clock to `time` before the next thing that reads it. */
    at(time: number): void {
      clock = time;
    },
    apply(tr: EditorTransaction): void {
      state = state.apply(tr);
      history.record(tr);
    },
    edit(write: (tr: EditorTransaction) => void): void {
      const tr = state.tr();
      write(tr);
      this.apply(tr);
    },
    /** An edit the history is never told about — the host breaking the rule. */
    editUnseen(write: (tr: EditorTransaction) => void): void {
      const tr = state.tr();
      write(tr);
      state = state.apply(tr);
    },
    undo(): boolean {
      const tr = history.undo(state);
      if (tr) this.apply(tr);
      return tr !== null;
    },
    redo(): boolean {
      const tr = history.redo(state);
      if (tr) this.apply(tr);
      return tr !== null;
    },
  };
}

describe('grouping adjacent typing', () => {
  it('takes back a run of typing in one undo, not a character at a time', () => {
    const editor = session(doc(p(t('ab'))), 3);

    editor.at(0);
    editor.edit((tr) => void tr.insertText(3, 'X'));
    editor.at(10);
    editor.edit((tr) => void tr.insertText(4, 'Y'));
    editor.at(20);
    editor.edit((tr) => void tr.insertText(5, 'Z'));

    expect(editor.text).toBe('abXYZ');
    expect(editor.history.undoDepth).toBe(1);

    expect(editor.undo()).toBe(true);
    expect(editor.text).toBe('ab');
    expect(editor.history.undoDepth).toBe(0);
  });

  it('starts a new unit once the typing has paused for long enough', () => {
    const editor = session(doc(p(t('ab'))), 3, { newGroupDelay: 500 });

    editor.at(0);
    editor.edit((tr) => void tr.insertText(3, 'X'));
    // Past the delay, so this keystroke is the start of something else even
    // though it lands exactly where the last one did.
    editor.at(501);
    editor.edit((tr) => void tr.insertText(4, 'Y'));

    expect(editor.text).toBe('abXY');
    expect(editor.history.undoDepth).toBe(2);

    editor.undo();
    expect(editor.text).toBe('abX');
  });

  it('keeps a unit open as long as the typing keeps coming', () => {
    // The delay is measured from the last keystroke, not from the first: a
    // person typing steadily for a minute has typed one thing. Every gap here
    // is inside the delay and the whole run is well outside it.
    const editor = session(doc(p(t('ab'))), 3, { newGroupDelay: 500 });

    for (let i = 0; i < 4; i++) {
      editor.at(i * 400);
      editor.edit((tr) => void tr.insertText(3 + i, 'WXYZ'[i]!));
    }

    expect(editor.text).toBe('abWXYZ');
    expect(editor.history.undoDepth).toBe(1);
  });

  it('starts a new unit when the typing moves somewhere else', () => {
    const editor = session(doc(p(t('abcdef'))), 7);

    // Both keystrokes are within the delay: only the distance between them
    // decides this.
    editor.at(0);
    editor.edit((tr) => void tr.insertText(7, 'X'));
    editor.at(1);
    editor.edit((tr) => void tr.insertText(1, 'Y'));

    expect(editor.text).toBe('YabcdefX');
    expect(editor.history.undoDepth).toBe(2);

    editor.undo();
    expect(editor.text).toBe('abcdefX');
  });

  it('groups a backspace with the typing it is taking back', () => {
    const editor = session(doc(p(t('ab'))), 3);

    editor.at(0);
    editor.edit((tr) => void tr.insertText(3, 'XY'));
    editor.at(5);
    editor.edit((tr) => void tr.delete(4, 5));

    expect(editor.text).toBe('abX');
    expect(editor.history.undoDepth).toBe(1);
    editor.undo();
    expect(editor.text).toBe('ab');
  });

  it('ends the unit when the caret is moved between two runs of typing', () => {
    // The two edits are adjacent and within the delay, so only the click
    // between them separates them. A person who moves the cursor and types
    // again has done two things.
    const editor = session(doc(p(t('abcdef'))), 1);

    editor.at(0);
    editor.edit((tr) => void tr.insertText(1, 'X'));
    editor.apply(editor.state.tr().setSelection(TextSelection.create(editor.state.doc, 5)));
    editor.at(1);
    editor.edit((tr) => void tr.insertText(2, 'Y'));

    expect(editor.text).toBe('XYabcdef');
    expect(editor.history.undoDepth).toBe(2);
  });

  it('gives a marking-up its own unit rather than merging it on a guess', () => {
    // A mark replaces nothing, so there is no range to compare against the
    // typing before it, and it is not merged into it.
    const editor = session(doc(p(t('abcdef'))), 1);

    editor.at(0);
    editor.edit((tr) => void tr.insertText(1, 'X'));
    editor.at(1);
    editor.edit((tr) => void tr.addMark(1, 4, s.mark('em')));

    expect(editor.history.undoDepth).toBe(2);
    expect(editor.state.doc.child(0).child(0).marks).toHaveLength(1);

    editor.undo();
    expect(editor.state.doc.child(0).child(0).marks).toHaveLength(0);
    // Only the mark came off: the keystroke under it is a unit of its own.
    expect(editor.text).toBe('Xabcdef');
  });

  it('does not let the typing after a marking-up join it', () => {
    // The forwards half of the rule above: the mark is its own unit, and a
    // keystroke right at its end, inside the delay, is another.
    const editor = session(doc(p(t('abcdef'))), 4);

    editor.at(0);
    editor.edit((tr) => void tr.addMark(1, 4, s.mark('em')));
    editor.at(1);
    editor.edit((tr) => void tr.insertText(4, 'X'));

    expect(editor.history.undoDepth).toBe(2);
    editor.undo();
    expect(editor.text).toBe('abcdef');
    expect(editor.state.doc.child(0).child(0).marks).toHaveLength(1);
  });

  it('does not take the text a transaction marked for somewhere it typed', () => {
    // The transaction types at one end of the paragraph and marks text at the
    // other, so the range it has for a redraw runs from the one to the other.
    // A keystroke between the two is beside neither, and is its own unit.
    const editor = session(doc(p(t('abcdefghijklmnop'))), 1);

    editor.at(0);
    editor.edit((tr) => {
      tr.insertText(1, 'X');
      tr.addMark(10, 14, s.mark('strong'));
    });
    editor.at(10);
    editor.edit((tr) => void tr.insertText(7, 'Y'));

    expect(editor.history.undoDepth).toBe(2);
    editor.undo();
    expect(String(editor.state.doc)).toBe('doc(paragraph("Xabcdefgh", strong("ijkl"), "mnop"))');
  });

  it('lets a transaction that also marked text join the typing it carried on', () => {
    // The other direction of the rule above. What closes a unit to joiners is
    // a mark step anywhere in it; what stops a transaction joining one is a
    // first step that was not a replacement, and this one's first step was.
    const editor = session(doc(p(t('abcdefghijklmnop'))), 1);

    editor.at(0);
    editor.edit((tr) => void tr.insertText(1, 'X'));
    editor.at(10);
    editor.edit((tr) => {
      tr.insertText(2, 'Y');
      tr.addMark(10, 14, s.mark('strong'));
    });

    expect(editor.history.undoDepth).toBe(1);
  });

  it('undoes bold laid over partly bold text back to what was bold before', () => {
    const strong = s.mark('strong');
    const editor = session(doc(p(t('ab'), s.text('cd', [strong]), t('ef'))), 1);

    editor.at(0);
    editor.edit((tr) => void tr.addMark(1, 7, strong));
    expect(String(editor.state.doc)).toBe('doc(paragraph(strong("abcdef")))');

    editor.undo();
    expect(String(editor.state.doc)).toBe('doc(paragraph("ab", strong("cd"), "ef"))');
  });

  it('forgets the oldest unit once the stack is full', () => {
    const editor = session(doc(p(t('ab'))), 3, { depth: 2 });

    for (let i = 0; i < 3; i++) {
      editor.at(i * 1000);
      editor.edit((tr) => void tr.insertText(3 + i, 'ABC'[i]!));
    }

    expect(editor.text).toBe('abABC');
    expect(editor.history.undoDepth).toBe(2);

    editor.undo();
    editor.undo();
    expect(editor.text).toBe('abA');
    // The first keystroke is gone for good, not waiting under the other two.
    expect(editor.undo()).toBe(false);
    expect(editor.text).toBe('abA');
  });
});

describe('closing a unit', () => {
  it('refuses to join the unit before it, whatever the clock says', () => {
    const editor = session(doc(p(t('ab'))), 3);

    editor.at(0);
    editor.edit((tr) => void tr.insertText(3, 'X'));
    // One millisecond later and immediately adjacent: time and place both say
    // group, and the transaction says otherwise.
    editor.at(1);
    editor.edit((tr) => {
      tr.insertText(4, 'Y');
      tr.closeHistory();
    });

    expect(editor.history.undoDepth).toBe(2);
    editor.undo();
    expect(editor.text).toBe('abX');
  });

  it('refuses to be joined by the typing after it', () => {
    // The forwards half. A paste is one undoable thing and the typing after it
    // is another, which closing only backwards would not give.
    const editor = session(doc(p(t('ab'))), 3);

    editor.at(0);
    editor.edit((tr) => {
      tr.insertText(3, 'PASTED');
      tr.closeHistory();
    });
    editor.at(1);
    editor.edit((tr) => void tr.insertText(9, 'Z'));

    expect(editor.text).toBe('abPASTEDZ');
    expect(editor.history.undoDepth).toBe(2);
    editor.undo();
    expect(editor.text).toBe('abPASTED');
  });
});

describe('the selection an undo restores', () => {
  it('puts the caret back where the edit began, not where the steps leave it', () => {
    // The selection is strictly inside what the edit replaced, so it has
    // nowhere of its own to map to and collapses. Undoing the deletion maps
    // that collapsed caret to the far end of the restored text — position 7 —
    // which is why an undo has to remember rather than recompute.
    const editor = session(doc(p(t('abcdef'))));
    editor.apply(editor.state.tr().setSelection(TextSelection.create(editor.state.doc, 2, 5)));

    editor.at(0);
    editor.edit((tr) => void tr.delete(1, 7));
    expect(editor.text).toBe('');
    expect(editor.selection.anchor).toBe(1);

    editor.undo();
    expect(editor.text).toBe('abcdef');
    expect(editor.selection.anchor).toBe(2);
    expect(editor.selection.head).toBe(5);
  });

  it('restores the selection the whole group began with, not the last keystroke', () => {
    const editor = session(doc(p(t('abcdef'))));
    editor.apply(editor.state.tr().setSelection(TextSelection.create(editor.state.doc, 2, 5)));

    // Two transactions in one unit. The second began from the caret the first
    // left behind; undoing the group has to go back past both of them.
    editor.at(0);
    editor.edit((tr) => void tr.delete(1, 7));
    editor.at(1);
    editor.edit((tr) => void tr.insertText(1, 'ZZ'));

    expect(editor.text).toBe('ZZ');
    expect(editor.history.undoDepth).toBe(1);

    editor.undo();
    expect(editor.text).toBe('abcdef');
    expect(editor.selection.anchor).toBe(2);
    expect(editor.selection.head).toBe(5);
  });
});

describe('redo', () => {
  it('puts back what was undone, with the selection the edit had left', () => {
    // The edit puts the caret somewhere the mapping would not have — which is
    // what the structural commands do, and the only case in which "where the
    // edit left the caret" is a fact that has to be remembered rather than
    // recomputed. Mapping the pre-edit selection through these steps gives
    // position 1; the edit ended at 4.
    const editor = session(doc(p(t('abcdef')), p(t('gh'))));
    editor.apply(editor.state.tr().setSelection(TextSelection.create(editor.state.doc, 2, 5)));

    editor.at(0);
    editor.edit((tr) => {
      tr.delete(1, 7);
      tr.setSelection(TextSelection.create(tr.doc, 4));
    });
    expect(editor.text).toBe('gh');
    expect(editor.selection.anchor).toBe(4);

    editor.undo();
    expect(editor.text).toBe('abcdef|gh');
    expect(editor.selection.anchor).toBe(2);
    expect(editor.history.redoDepth).toBe(1);

    expect(editor.redo()).toBe(true);
    expect(editor.text).toBe('gh');
    expect(editor.selection.anchor).toBe(4);
    expect(editor.selection.empty).toBe(true);
    expect(editor.history.redoDepth).toBe(0);
    expect(editor.history.undoDepth).toBe(1);
  });

  it('walks a stack of units back and forwards in order', () => {
    const editor = session(doc(p(t('ab'))), 3);

    editor.at(0);
    editor.edit((tr) => void tr.insertText(3, 'X'));
    editor.at(1000);
    editor.edit((tr) => void tr.insertText(4, 'Y'));

    editor.undo();
    editor.undo();
    expect(editor.text).toBe('ab');
    expect(editor.history.redoDepth).toBe(2);

    editor.redo();
    expect(editor.text).toBe('abX');
    editor.redo();
    expect(editor.text).toBe('abXY');
    expect(editor.redo()).toBe(false);
  });

  it('discards what was ahead as soon as something else is typed', () => {
    const editor = session(doc(p(t('ab'))), 3);

    editor.at(0);
    editor.edit((tr) => void tr.insertText(3, 'X'));
    editor.undo();
    expect(editor.history.redoDepth).toBe(1);

    editor.at(1000);
    editor.edit((tr) => void tr.insertText(3, 'Y'));
    expect(editor.text).toBe('abY');
    expect(editor.history.redoDepth).toBe(0);
    expect(editor.redo()).toBe(false);

    // The new keystroke is still undoable; only the branch ahead is gone.
    editor.undo();
    expect(editor.text).toBe('ab');
  });

  it('does not let the typing after an undo join the unit it just took back', () => {
    const editor = session(doc(p(t('ab'))), 3);

    editor.at(0);
    editor.edit((tr) => void tr.insertText(3, 'X'));
    editor.at(1000);
    editor.edit((tr) => void tr.insertText(4, 'Y'));
    expect(editor.history.undoDepth).toBe(2);

    editor.at(1001);
    editor.undo();
    expect(editor.text).toBe('abX');

    // Adjacent to where the undone unit wrote, and inside the delay. The unit
    // it would merge into is on the redo stack, and about to be discarded — so
    // this keystroke would end up on no stack at all and be unundoable.
    editor.at(1002);
    editor.edit((tr) => void tr.insertText(4, 'Z'));
    expect(editor.text).toBe('abXZ');
    expect(editor.history.undoDepth).toBe(2);

    editor.undo();
    expect(editor.text).toBe('abX');
  });
});

describe('the stack itself', () => {
  it('has nothing to offer when nothing has happened', () => {
    const editor = session(doc(p(t('ab'))), 3);
    expect(editor.history.undoDepth).toBe(0);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(false);
    expect(editor.text).toBe('ab');
  });

  it('does not move until the transaction it handed out is recorded', () => {
    const editor = session(doc(p(t('ab'))), 3);
    editor.at(0);
    editor.edit((tr) => void tr.insertText(3, 'X'));

    const first = editor.history.undo(editor.state);
    expect(first).not.toBeNull();
    // Built and thrown away: the caller decided not to apply it, and a history
    // that had already popped would have lost the edit.
    expect(editor.history.undoDepth).toBe(1);
    expect(editor.history.redoDepth).toBe(0);

    editor.undo();
    expect(editor.text).toBe('ab');
    expect(editor.history.undoDepth).toBe(0);
  });

  it('forgets both directions when cleared', () => {
    // Both stacks have to be occupied when `clear` is called, or the test
    // proves only one of them: edit-then-undo leaves the done stack already
    // empty, so emptying it again is a line nothing could miss.
    const editor = session(doc(p(t('ab'))), 3);
    editor.at(0);
    editor.edit((tr) => void tr.insertText(3, 'X'));
    // Past the grouping delay, so the second edit is a unit of its own and one
    // undo leaves work on both stacks.
    editor.at(5000);
    editor.edit((tr) => void tr.insertText(4, 'Y'));
    editor.undo();

    expect(editor.history.undoDepth).toBeGreaterThan(0);
    expect(editor.history.redoDepth).toBeGreaterThan(0);

    editor.history.clear();
    expect(editor.history.undoDepth).toBe(0);
    expect(editor.history.redoDepth).toBe(0);
    expect(editor.undo()).toBe(false);
  });

  it('says so when a recorded step no longer applies to the document it is given', () => {
    // The undo of "delete the image" is "put the image back at position 1",
    // and position 1 in this other document is inside a code block, whose
    // content is text only. Half-applying it would leave a document no later
    // undo could describe, so it refuses instead.
    const editor = session(doc(p(image(), t('ab'))), 2);
    editor.at(0);
    editor.edit((tr) => void tr.delete(1, 2));
    expect(String(editor.state.doc)).toBe('doc(paragraph("ab"))');

    const elsewhere = EditorState.create(doc(code(t('ab'))));
    expect(() => editor.history.undo(elsewhere)).toThrow(/no longer applies/);
  });

  it('refuses to take anything back once the document has changed without it', () => {
    // The recorded undo is "delete what was typed at 3". Two characters typed
    // in front of it that the history never saw move that text to 5, and
    // taking back position 3 would delete the "a" instead, without complaint.
    const editor = session(doc(p(t('abcd'))), 3);
    editor.at(0);
    editor.edit((tr) => void tr.insertText(3, 'Z'));
    editor.editUnseen((tr) => void tr.insertText(1, 'XY'));
    expect(editor.text).toBe('XYabZcd');

    expect(() => editor.history.undo(editor.state)).toThrow(/no longer applies/);
    expect(editor.text).toBe('XYabZcd');
  });

  it('says so in its own words when the change it never saw moved the text out of reach', () => {
    // Here the recorded positions are past the end of the document the unseen
    // deletion left — which is the same mistake, not an out-of-range position
    // somewhere in the step layer.
    const editor = session(doc(p(t('ab'))), 3);
    editor.at(0);
    editor.edit((tr) => void tr.insertText(3, 'XY'));
    editor.editUnseen((tr) => void tr.delete(1, 5));

    expect(() => editor.history.undo(editor.state)).toThrow(/no longer applies/);
  });

  it('starts afresh from the first change it records after one it never saw', () => {
    // What it held was written against a document before the unseen change,
    // and with no rebase to move it across that change it could only take back
    // the wrong text. The edit recorded afterwards is still undoable.
    const editor = session(doc(p(t('abcd'))), 3);
    editor.at(0);
    editor.edit((tr) => void tr.insertText(3, 'Z'));
    editor.editUnseen((tr) => void tr.insertText(1, 'XY'));
    editor.at(1000);
    editor.edit((tr) => void tr.insertText(8, '!'));

    expect(editor.history.undoDepth).toBe(1);
    expect(editor.undo()).toBe(true);
    expect(editor.text).toBe('XYabZcd');
    expect(editor.undo()).toBe(false);
    expect(editor.text).toBe('XYabZcd');
  });

  it('ignores a transaction that did nothing at all', () => {
    const editor = session(doc(p(t('ab'))), 3);
    editor.at(0);
    editor.apply(editor.state.tr());
    expect(editor.history.undoDepth).toBe(0);
  });

  it('undoes a replacement of a whole block as one thing', () => {
    // Not typing: a structural rewrite, whose inverse has to rebuild the block
    // it replaced rather than shifting positions about.
    const editor = session(doc(p(t('one')), p(t('two'))), 1);
    editor.at(0);
    editor.edit((tr) => {
      tr.replace(0, 5, new Slice(Fragment.from(s.node('heading', { level: 2 }, [t('ONE')])), 0, 0));
    });

    expect(String(editor.state.doc)).toBe('doc(heading("ONE"), paragraph("two"))');
    editor.undo();
    expect(String(editor.state.doc)).toBe('doc(paragraph("one"), paragraph("two"))');
  });
});
