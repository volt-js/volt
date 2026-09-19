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
    expect(applyInputType(tr, 'historyUndo')).toBe(false);
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
