/**
 * `beforeinput`, and the one place the browser is allowed to win.
 *
 * Two rules are being pinned. The first is that any input the browser is about
 * to perform on the DOM is cancelled, whether or not this layer knows what to
 * do with it — because the model is the truth, and a browser edit the model
 * never saw makes every position in the document a lie about what is on
 * screen. The second is the exception: between `compositionstart` and
 * `compositionend` an input method is writing into the DOM itself, and
 * cancelling or rewriting underneath it breaks the composition rather than the
 * edit. So composition traffic passes through untouched and the model catches
 * up in one step at the end.
 *
 * The events are constructed and dispatched by hand. That is not a compromise
 * for want of a browser: an editor's input layer is defined in terms of the
 * events it receives, so driving those events *is* the thing under test, and a
 * real keystroke would only add an unreliable layer of indirection over the
 * same `InputEvent`.
 */

import { describe, expect, it } from 'vitest';
import { Mark, basicSchema } from '../src/index.ts';
import { EditorHistory } from '../src/history.ts';
import { EditorInput, applyInputType } from '../src/input.ts';
import { EditorState, TextSelection } from '../src/state.ts';
import type { EditorTransaction } from '../src/state.ts';
import type { Node } from '../src/node.ts';

const s = basicSchema;
const doc = (...content: Node[]) => s.node('doc', null, content);
const p = (...content: Node[]) => s.node('paragraph', null, content);
const t = (text: string, ...marks: Mark[]) => s.text(text, marks);

const textOf = (node: Node) => node.textBetween(0, node.content.size, '|');

/** An element with an input layer over a state that the layer's dispatch advances. */
function editor(document_: Node, anchor?: number, head?: number) {
  const dom = window.document.createElement('div');
  let state = EditorState.create(
    document_,
    anchor === undefined ? undefined : TextSelection.create(document_, anchor, head ?? anchor),
  );
  const dispatched: EditorTransaction[] = [];

  const input = new EditorInput(dom, {
    state: () => state,
    dispatch: (tr) => {
      dispatched.push(tr);
      state = state.apply(tr);
    },
  });

  return {
    dom,
    input,
    dispatched,
    get state() {
      return state;
    },
    get text() {
      return textOf(state.doc);
    },
  };
}

function beforeInput(dom: HTMLElement, inputType: string, init: Record<string, unknown> = {}): InputEvent {
  const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true, ...init });
  dom.dispatchEvent(event);
  return event;
}

/**
 * happy-dom, like every browser, will not take `data` through the constructor
 * for a `CompositionEvent`, so it is assigned afterwards.
 */
function composition(dom: HTMLElement, type: string, data?: string): CompositionEvent {
  const event = new CompositionEvent(type, { bubbles: true });
  if (data !== undefined) (event as { data: string }).data = data;
  dom.dispatchEvent(event);
  return event;
}

function plainTextTransfer(text: string): DataTransfer {
  const transfer = new DataTransfer();
  transfer.setData('text/plain', text);
  return transfer;
}

describe('translating beforeinput', () => {
  it('types text and stops the browser typing it too', () => {
    const editing = editor(doc(p(t('abcd'))), 3);
    const event = beforeInput(editing.dom, 'insertText', { data: 'XY' });

    expect(event.defaultPrevented).toBe(true);
    expect(editing.text).toBe('abXYcd');
    expect(editing.state.selection.anchor).toBe(5);
  });

  it('splits the block on a paragraph insertion', () => {
    const editing = editor(doc(p(t('abcd'))), 3);
    beforeInput(editing.dom, 'insertParagraph');

    expect(editing.text).toBe('ab|cd');
    expect(editing.state.selection.anchor).toBe(5);
  });

  it('backspaces on deleteContentBackward', () => {
    const editing = editor(doc(p(t('abcd'))), 3);
    beforeInput(editing.dom, 'deleteContentBackward');
    expect(editing.text).toBe('acd');
  });

  it('deletes forwards on deleteContentForward', () => {
    const editing = editor(doc(p(t('abcd'))), 3);
    beforeInput(editing.dom, 'deleteContentForward');
    expect(editing.text).toBe('abd');
  });

  it('deletes a word on deleteWordBackward', () => {
    const editing = editor(doc(p(t('hello world'))), 12);
    beforeInput(editing.dom, 'deleteWordBackward');
    expect(editing.text).toBe('hello ');
  });

  it('reads a paste off the data transfer and flattens it to blocks', () => {
    const editing = editor(doc(p(t('ab'))), 3);
    beforeInput(editing.dom, 'insertFromPaste', { dataTransfer: plainTextTransfer('X\nY') });

    expect(String(editing.state.doc)).toBe('doc(paragraph("abX"), paragraph("Y"))');
  });

  it('falls back to the event data for a paste that carries no transfer', () => {
    const editing = editor(doc(p(t('ab'))), 3);
    beforeInput(editing.dom, 'insertFromPaste', { data: 'XY' });
    expect(editing.text).toBe('abXY');
  });

  it('reads each event against the state at the time, so typing accumulates', () => {
    const editing = editor(doc(p()), 1);
    beforeInput(editing.dom, 'insertText', { data: 'a' });
    beforeInput(editing.dom, 'insertText', { data: 'b' });
    beforeInput(editing.dom, 'insertText', { data: 'c' });

    expect(editing.text).toBe('abc');
    expect(editing.state.selection.anchor).toBe(4);
    expect(editing.dispatched).toHaveLength(3);
  });

  it('cancels an input type it has no command for, rather than letting it through', () => {
    // Delegating to the browser here would let it edit a DOM the model does
    // not know about, and every position in the document would then be a claim
    // about a document that is not on screen.
    const editing = editor(doc(p(t('ab'))), 3);
    const event = beforeInput(editing.dom, 'formatBold');

    expect(event.defaultPrevented).toBe(true);
    expect(editing.dispatched).toHaveLength(0);
    expect(editing.text).toBe('ab');
  });

  it('cancels, but dispatches nothing, when the command declines', () => {
    // Backspace at the very start of the document. The browser must still not
    // act, and a transaction that changed nothing must not reach the host.
    const editing = editor(doc(p(t('ab'))), 1);
    const before = editing.state;
    const event = beforeInput(editing.dom, 'deleteContentBackward');

    expect(event.defaultPrevented).toBe(true);
    expect(editing.dispatched).toHaveLength(0);
    expect(editing.state).toBe(before);
  });

  it('stops listening once destroyed', () => {
    const editing = editor(doc(p(t('ab'))), 3);
    editing.input.destroy();
    const event = beforeInput(editing.dom, 'insertText', { data: 'X' });

    expect(event.defaultPrevented).toBe(false);
    expect(editing.dispatched).toHaveLength(0);
    expect(editing.text).toBe('ab');
  });
});

describe('composition', () => {
  it('lets the input method write into the DOM and does not touch the model', () => {
    const editing = editor(doc(p(t('ab'))), 3);
    composition(editing.dom, 'compositionstart');

    const event = beforeInput(editing.dom, 'insertCompositionText', { data: 'に' });

    expect(editing.input.composing).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(editing.dispatched).toHaveLength(0);
    expect(editing.text).toBe('ab');
  });

  it('catches the model up in one step when the composition finishes', () => {
    const editing = editor(doc(p(t('ab'))), 3);
    composition(editing.dom, 'compositionstart');
    beforeInput(editing.dom, 'insertCompositionText', { data: 'に' });
    beforeInput(editing.dom, 'insertCompositionText', { data: '日本' });
    composition(editing.dom, 'compositionend', '日本語');

    expect(editing.input.composing).toBe(false);
    expect(editing.text).toBe('ab日本語');
    // One transaction for the whole composition, not one per candidate.
    expect(editing.dispatched).toHaveLength(1);
    expect(editing.state.selection.anchor).toBe(6);
  });

  it('replaces the selection the composition was started over', () => {
    // Nothing had to be remembered at `compositionstart`: the model's
    // selection never moved, because every event that would have moved it went
    // to the browser instead.
    const editing = editor(doc(p(t('abcd'))), 2, 4);
    composition(editing.dom, 'compositionstart');
    beforeInput(editing.dom, 'insertCompositionText', { data: 'x' });
    composition(editing.dom, 'compositionend', 'XY');

    expect(editing.text).toBe('aXYd');
    expect(editing.state.selection.empty).toBe(true);
    expect(editing.state.selection.anchor).toBe(4);
  });

  it('makes a finished composition its own undo unit', () => {
    const editing = editor(doc(p(t('ab'))), 3);
    composition(editing.dom, 'compositionstart');
    composition(editing.dom, 'compositionend', 'X');

    expect(editing.dispatched[0]!.historyClosed).toBe(true);
  });

  it('does nothing for a composition that was abandoned', () => {
    const editing = editor(doc(p(t('ab'))), 3);
    composition(editing.dom, 'compositionstart');
    composition(editing.dom, 'compositionend', '');

    expect(editing.input.composing).toBe(false);
    expect(editing.dispatched).toHaveLength(0);
    expect(editing.text).toBe('ab');
  });

  it('recognises composition input that arrives before compositionstart does', () => {
    // Several engines fire the first `beforeinput` of a composition ahead of
    // `compositionstart`. Treating that one as an ordinary insertion is how an
    // editor eats the first character of every composed word.
    const editing = editor(doc(p(t('ab'))), 3);
    const event = beforeInput(editing.dom, 'insertCompositionText', { data: 'に' });

    expect(event.defaultPrevented).toBe(false);
    expect(editing.dispatched).toHaveLength(0);
    expect(editing.text).toBe('ab');
  });

  it('goes back to translating input once the composition is over', () => {
    const editing = editor(doc(p(t('ab'))), 3);
    composition(editing.dom, 'compositionstart');
    composition(editing.dom, 'compositionend', 'X');

    const event = beforeInput(editing.dom, 'insertText', { data: 'Y' });
    expect(event.defaultPrevented).toBe(true);
    expect(editing.text).toBe('abXY');
  });
});

describe('translating an input type on its own', () => {
  it('runs the command without an event for the types that need no data', () => {
    const d = doc(p(t('abcd')));
    const state = EditorState.create(d, TextSelection.create(d, 3));
    const tr = state.tr();
    expect(applyInputType(tr, 'deleteContentBackward')).toBe(true);
    expect(textOf(tr.doc)).toBe('acd');
  });

  it('says no to an input type it does not know', () => {
    const state = EditorState.create(doc(p(t('abcd'))));
    const tr = state.tr();
    expect(applyInputType(tr, 'formatBold')).toBe(false);
    expect(tr.changed).toBe(false);
  });

  it('says no to typing with no event to read the text from', () => {
    // With no text to type, typing over a range would be a deletion under
    // another name.
    const d = doc(p(t('abcd')));
    const tr = EditorState.create(d, TextSelection.create(d, 2, 4)).tr();
    expect(applyInputType(tr, 'insertText')).toBe(false);
    expect(tr.changed).toBe(false);
  });

  it('says no to typing when the event carries no text', () => {
    // The same deletion by the other road: an event is there, and its `data`
    // is null.
    const d = doc(p(t('abcd')));
    const tr = EditorState.create(d, TextSelection.create(d, 2, 4)).tr();
    const event = new InputEvent('beforeinput', { inputType: 'insertText', data: null });
    expect(applyInputType(tr, 'insertText', event)).toBe(false);
    expect(tr.changed).toBe(false);
  });

  it('says no to a paste with no event to read the text from', () => {
    const state = EditorState.create(doc(p(t('abcd'))));
    const tr = state.tr();
    expect(applyInputType(tr, 'insertFromPaste')).toBe(false);
    expect(tr.changed).toBe(false);
  });
});

/**
 * An editor whose host records every transaction in a history, which is the
 * loop the view runs when it is given one. The clock stands still, so nothing
 * but a command's own `closeHistory` can separate two units.
 */
function editorWithHistory(document_: Node, anchor?: number) {
  const dom = window.document.createElement('div');
  let state = EditorState.create(
    document_,
    anchor === undefined ? undefined : TextSelection.create(document_, anchor),
  );
  const history = new EditorHistory({ now: () => 0 });
  const dispatched: EditorTransaction[] = [];

  const input = new EditorInput(dom, {
    state: () => state,
    dispatch: (tr) => {
      dispatched.push(tr);
      state = state.apply(tr);
      history.record(tr);
    },
    history,
  });

  return {
    dom,
    input,
    history,
    dispatched,
    /** Move the selection as a click or a drag would: a transaction that changes nothing else. */
    select(anchor: number, head = anchor) {
      const tr = state.tr().setSelection(TextSelection.create(state.doc, anchor, head));
      state = state.apply(tr);
      history.record(tr);
    },
    get state() {
      return state;
    },
    get text() {
      return textOf(state.doc);
    },
  };
}

function keydown(dom: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  dom.dispatchEvent(event);
  return event;
}

/** One `insertText` per character, as a keyboard delivers it. */
function type(dom: HTMLElement, text: string): void {
  for (const char of text) beforeInput(dom, 'insertText', { data: char });
}

describe('line breaks and forward word deletion', () => {
  it('inserts a hard break on insertLineBreak and keeps the block whole', () => {
    const editing = editor(doc(p(t('abcd'))), 3);
    const event = beforeInput(editing.dom, 'insertLineBreak');

    expect(event.defaultPrevented).toBe(true);
    expect(String(editing.state.doc)).toBe('doc(paragraph("ab", hard_break, "cd"))');
    expect(editing.state.selection.anchor).toBe(4);
  });

  it('deletes a word forwards on deleteWordForward', () => {
    const editing = editor(doc(p(t('hello world'))), 1);
    beforeInput(editing.dom, 'deleteWordForward');
    expect(editing.text).toBe(' world');
  });
});

describe('undo and redo from the keyboard', () => {
  it('takes back the last unit on historyUndo, and stops the browser undoing too', () => {
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    type(editing.dom, 'XY');
    expect(editing.text).toBe('abXY');

    const event = beforeInput(editing.dom, 'historyUndo');

    expect(event.defaultPrevented).toBe(true);
    expect(editing.text).toBe('ab');
    expect(editing.state.selection.anchor).toBe(3);
    expect(editing.history.undoDepth).toBe(0);
    expect(editing.history.redoDepth).toBe(1);
  });

  it('puts it back on historyRedo', () => {
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    type(editing.dom, 'XY');
    beforeInput(editing.dom, 'historyUndo');

    const event = beforeInput(editing.dom, 'historyRedo');

    expect(event.defaultPrevented).toBe(true);
    expect(editing.text).toBe('abXY');
    expect(editing.state.selection.anchor).toBe(5);
    expect(editing.history.redoDepth).toBe(0);
  });

  it('binds the key itself, since a browser reports no undo for edits it never made', () => {
    // Every edit is cancelled before the browser performs it, so the browser
    // holds no undo stack of its own — and an engine with nothing to undo
    // sends no `historyUndo`. The key has to be read.
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    type(editing.dom, 'X');

    const undo = keydown(editing.dom, { key: 'z', ctrlKey: true });
    expect(undo.defaultPrevented).toBe(true);
    expect(editing.text).toBe('ab');

    const redo = keydown(editing.dom, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(redo.defaultPrevented).toBe(true);
    expect(editing.text).toBe('abX');
  });

  it('takes the command key as well, and Ctrl+Y for a redo', () => {
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    type(editing.dom, 'X');

    keydown(editing.dom, { key: 'z', metaKey: true });
    expect(editing.text).toBe('ab');
    keydown(editing.dom, { key: 'y', ctrlKey: true });
    expect(editing.text).toBe('abX');
    keydown(editing.dom, { key: 'z', metaKey: true });
    keydown(editing.dom, { key: 'z', metaKey: true, shiftKey: true });
    expect(editing.text).toBe('abX');
  });

  it('leaves every other key alone', () => {
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    type(editing.dom, 'X');

    expect(keydown(editing.dom, { key: 'z' }).defaultPrevented).toBe(false);
    expect(keydown(editing.dom, { key: 'z', ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(keydown(editing.dom, { key: 'y', metaKey: true }).defaultPrevented).toBe(false);
    expect(keydown(editing.dom, { key: 'x', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(editing.text).toBe('abX');
    expect(editing.dispatched).toHaveLength(1);
  });

  it('cancels the browser\'s own undo when there is no history, and leaves the keys to the host', () => {
    // A native undo would take back DOM the model never saw changed — the
    // text a composition wrote, say — and the two would part company. The
    // keys are another matter: with no history here, whatever undo the host
    // has is the one they belong to.
    const editing = editor(doc(p(t('ab'))), 3);
    type(editing.dom, 'X');

    expect(beforeInput(editing.dom, 'historyUndo').defaultPrevented).toBe(true);
    expect(beforeInput(editing.dom, 'historyRedo').defaultPrevented).toBe(true);
    expect(keydown(editing.dom, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(editing.text).toBe('abX');
    expect(editing.dispatched).toHaveLength(1);
  });

  it('leaves a key that another listener has already taken', () => {
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    type(editing.dom, 'X');
    const parent = window.document.createElement('div');
    parent.appendChild(editing.dom);
    // Capturing on an ancestor runs before the editor's own listener, which
    // is how a host overrides the binding.
    parent.addEventListener('keydown', (event) => event.preventDefault(), { capture: true });

    keydown(editing.dom, { key: 'z', ctrlKey: true });

    expect(editing.text).toBe('abX');
    expect(editing.history.undoDepth).toBe(1);
  });

  it('finds the key by its place when the layout is not Latin', () => {
    // On a Cyrillic layout the key in Z's place reports я. The platform
    // still undoes on it, so the binding reads where the key is.
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    type(editing.dom, 'X');

    const undo = keydown(editing.dom, { key: 'я', code: 'KeyZ', ctrlKey: true });
    expect(undo.defaultPrevented).toBe(true);
    expect(editing.text).toBe('ab');

    keydown(editing.dom, { key: 'н', code: 'KeyY', ctrlKey: true });
    expect(editing.text).toBe('abX');
  });

  it('reads a Latin layout by its letters, so Z is where the Z is printed', () => {
    // On AZERTY the key in QWERTY's Z place is W, and Ctrl+W is not undo.
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    type(editing.dom, 'X');

    expect(keydown(editing.dom, { key: 'w', code: 'KeyZ', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(editing.text).toBe('abX');
    expect(keydown(editing.dom, { key: 'z', code: 'KeyW', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(editing.text).toBe('ab');
  });

  it('does nothing while a composition is running', () => {
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    type(editing.dom, 'X');
    composition(editing.dom, 'compositionstart');

    const event = keydown(editing.dom, { key: 'z', ctrlKey: true, isComposing: true });

    expect(event.defaultPrevented).toBe(false);
    expect(editing.text).toBe('abX');
  });

  it('dispatches nothing when there is nothing to take back', () => {
    const editing = editorWithHistory(doc(p(t('ab'))), 3);

    expect(beforeInput(editing.dom, 'historyUndo').defaultPrevented).toBe(true);
    expect(keydown(editing.dom, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(editing.dispatched).toHaveLength(0);
  });

  it('is not a command on a transaction, so applyInputType still says no to it', () => {
    // An undo is a transaction the history builds, not an edit written into
    // one that is already open.
    const tr = EditorState.create(doc(p(t('ab')))).tr();
    expect(applyInputType(tr, 'historyUndo')).toBe(false);
    expect(applyInputType(tr, 'historyRedo')).toBe(false);
    expect(tr.changed).toBe(false);
  });
});

describe('what a return and a finished composition close', () => {
  it('undoes the typing after a return without the typing before it', () => {
    const editing = editorWithHistory(doc(p()), 1);
    type(editing.dom, 'ab');
    beforeInput(editing.dom, 'insertParagraph');
    type(editing.dom, 'cd');
    expect(String(editing.state.doc)).toBe('doc(paragraph("ab"), paragraph("cd"))');

    beforeInput(editing.dom, 'historyUndo');
    expect(String(editing.state.doc)).toBe('doc(paragraph("ab"), paragraph)');
    expect(editing.state.selection.anchor).toBe(5);

    beforeInput(editing.dom, 'historyUndo');
    expect(String(editing.state.doc)).toBe('doc(paragraph("ab"))');
    expect(editing.state.selection.anchor).toBe(3);

    beforeInput(editing.dom, 'historyUndo');
    expect(String(editing.state.doc)).toBe('doc(paragraph)');
  });

  it('undoes the typing after a line break without the typing before it', () => {
    const editing = editorWithHistory(doc(p()), 1);
    type(editing.dom, 'ab');
    beforeInput(editing.dom, 'insertLineBreak');
    type(editing.dom, 'cd');

    beforeInput(editing.dom, 'historyUndo');
    expect(String(editing.state.doc)).toBe('doc(paragraph("ab", hard_break))');
    expect(editing.state.selection.anchor).toBe(4);
  });

  it('undoes the typing after a composition without the composition', () => {
    const editing = editorWithHistory(doc(p()), 1);
    type(editing.dom, 'ab');
    composition(editing.dom, 'compositionstart');
    beforeInput(editing.dom, 'insertCompositionText', { data: 'に' });
    composition(editing.dom, 'compositionupdate', 'にほ');
    composition(editing.dom, 'compositionend', '日本');
    type(editing.dom, 'cd');
    expect(editing.text).toBe('ab日本cd');
    expect(editing.history.undoDepth).toBe(3);

    beforeInput(editing.dom, 'historyUndo');
    expect(editing.text).toBe('ab日本');
    expect(editing.state.selection.anchor).toBe(5);

    beforeInput(editing.dom, 'historyUndo');
    expect(editing.text).toBe('ab');
    expect(editing.state.selection.anchor).toBe(3);
  });
});

describe('a composition, reconciled', () => {
  it('reaches the model as one step and one undo unit, with the caret after it', () => {
    const editing = editorWithHistory(doc(p(t('ab'))), 3);

    composition(editing.dom, 'compositionstart');
    expect(beforeInput(editing.dom, 'insertCompositionText', { data: 'に' }).defaultPrevented).toBe(false);
    composition(editing.dom, 'compositionupdate', 'に');
    expect(beforeInput(editing.dom, 'insertCompositionText', { data: '日本' }).defaultPrevented).toBe(false);
    composition(editing.dom, 'compositionupdate', '日本');
    // The input method owns the DOM for the duration: the model has not moved.
    expect(editing.input.composing).toBe(true);
    expect(editing.dispatched).toHaveLength(0);
    expect(editing.text).toBe('ab');

    composition(editing.dom, 'compositionend', '日本語');

    expect(editing.input.composing).toBe(false);
    expect(editing.dispatched).toHaveLength(1);
    expect(editing.dispatched[0]!.steps).toHaveLength(1);
    expect(editing.text).toBe('ab日本語');
    expect(editing.state.selection.anchor).toBe(6);
    expect(editing.state.selection.empty).toBe(true);
    expect(editing.history.undoDepth).toBe(1);

    beforeInput(editing.dom, 'historyUndo');
    expect(editing.text).toBe('ab');
    expect(editing.state.selection.anchor).toBe(3);
    expect(editing.history.undoDepth).toBe(0);
  });

  it('replaces the selection it began over, as one step, and an undo gives the selection back', () => {
    const editing = editorWithHistory(doc(p(t('abcd'))), 2);
    // A range made before the composition, the way a drag makes one.
    editing.select(2, 4);

    composition(editing.dom, 'compositionstart');
    beforeInput(editing.dom, 'insertCompositionText', { data: 'x' });
    composition(editing.dom, 'compositionupdate', 'x');
    composition(editing.dom, 'compositionend', 'X');

    expect(editing.text).toBe('aXd');
    expect(editing.dispatched.at(-1)!.steps).toHaveLength(1);
    expect(editing.state.selection.empty).toBe(true);
    expect(editing.state.selection.anchor).toBe(3);
    expect(editing.history.undoDepth).toBe(1);

    beforeInput(editing.dom, 'historyUndo');
    expect(editing.text).toBe('abcd');
    expect(editing.state.selection.anchor).toBe(2);
    expect(editing.state.selection.head).toBe(4);
  });

  it('is not joined by typing that runs straight on from it, with no pause', () => {
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    composition(editing.dom, 'compositionstart');
    composition(editing.dom, 'compositionend', '日本');
    type(editing.dom, 'cd');
    composition(editing.dom, 'compositionstart');
    composition(editing.dom, 'compositionend', '語');

    expect(editing.text).toBe('ab日本cd語');
    expect(editing.history.undoDepth).toBe(3);
    beforeInput(editing.dom, 'historyUndo');
    expect(editing.text).toBe('ab日本cd');
    beforeInput(editing.dom, 'historyUndo');
    expect(editing.text).toBe('ab日本');
  });

  it('puts the composed text at the selection, not over a word the input method reopened beside it', () => {
    // A stated limit, pinned so that lifting it is a decision: an Android
    // keyboard correcting "helo" composes over the word before the caret, and
    // nothing here reads that range, so the correction lands beside the word.
    const editing = editorWithHistory(doc(p(t('helo'))), 5);
    composition(editing.dom, 'compositionstart');
    composition(editing.dom, 'compositionupdate', 'hello');
    composition(editing.dom, 'compositionend', 'hello');

    expect(editing.text).toBe('helohello');
    expect(editing.history.undoDepth).toBe(1);
  });

  it('takes no undo key while it runs, and the key works once it is over', () => {
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    type(editing.dom, 'X');
    composition(editing.dom, 'compositionstart');
    // Mid-composition the keys are the input method's, flagged or not.
    expect(keydown(editing.dom, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(beforeInput(editing.dom, 'historyUndo').defaultPrevented).toBe(false);
    composition(editing.dom, 'compositionend', 'に');

    expect(editing.text).toBe('abXに');
    keydown(editing.dom, { key: 'z', ctrlKey: true });
    expect(editing.text).toBe('abX');
  });
});

describe('a paste with no text in it', () => {
  function htmlOnlyTransfer(html: string): DataTransfer {
    const transfer = new DataTransfer();
    transfer.setData('text/html', html);
    return transfer;
  }

  it('leaves a selection alone rather than replacing it with nothing', () => {
    // A transfer with markup on it and no text — this layer reads text only.
    // Pasted over a selection, flattening that to text gives nothing to put
    // in the selection's place, and the selection would go.
    const editing = editor(doc(p(t('hello world'))), 1, 6);
    const event = beforeInput(editing.dom, 'insertFromPaste', {
      dataTransfer: htmlOnlyTransfer('<img src="https://example.com/a.png">'),
    });

    expect(event.defaultPrevented).toBe(true);
    expect(editing.text).toBe('hello world');
    expect(editing.dispatched).toHaveLength(0);
  });

  it('says no on its own as well, so a keymap reaching the same name declines too', () => {
    const state = EditorState.create(doc(p(t('hello'))), TextSelection.create(doc(p(t('hello'))), 1, 6));
    const tr = state.tr();
    const event = new InputEvent('beforeinput', { inputType: 'insertFromPaste', data: '' });
    expect(applyInputType(tr, 'insertFromPaste', event)).toBe(false);
    expect(tr.changed).toBe(false);
  });
});

describe('keys the undo binding leaves alone', () => {
  it('leaves a key an input method has taken, though the key under it is Z', () => {
    // `Process` is what a key reports while an input method is handling it.
    // Its `code` still names the key, and reading that would take the input
    // method's key for an undo.
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    type(editing.dom, 'X');

    expect(keydown(editing.dom, { key: 'Process', code: 'KeyZ', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(keydown(editing.dom, { key: 'Unidentified', code: 'KeyZ', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(editing.text).toBe('abX');
  });

  it('leaves a key the event says belongs to a composition, though no compositionstart was seen', () => {
    // The flag is the platform's own word for it, so it is taken without
    // waiting for this layer's own record of a composition to agree.
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    type(editing.dom, 'X');

    expect(keydown(editing.dom, { key: 'z', ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false);
    expect(editing.text).toBe('abX');
  });

  it('leaves Ctrl and Cmd held together, which is a chord of some other binding', () => {
    const editing = editorWithHistory(doc(p(t('ab'))), 3);
    type(editing.dom, 'X');

    expect(keydown(editing.dom, { key: 'z', ctrlKey: true, metaKey: true }).defaultPrevented).toBe(false);
    expect(editing.text).toBe('abX');
  });
});
