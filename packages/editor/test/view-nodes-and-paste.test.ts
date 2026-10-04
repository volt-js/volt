/**
 * The view's half of node selections and of a paste that keeps its structure.
 *
 * Both are claims about the boundary between the model and the page. A node
 * selection has to reach the DOM as a range around the node and a class on it,
 * and has to survive the `selectionchange` its own write provokes — a read
 * that turned it back into a text range would undo every arrow press a frame
 * later. The arrow keys have to be read in the direction the text runs, so a
 * right-to-left paragraph steps the other way. And a paste carrying HTML has to
 * be taken off the `paste` event before the browser turns it into a
 * `beforeinput` of plain text, while a paste carrying only text, or HTML the
 * schema can make nothing of, is left to go through as text, as it did before.
 *
 * Events are built by hand, as the other view tests build them.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { basicSchema } from '../src/index.ts';
import type { Node } from '../src/node.ts';
import { NodeSelection } from '../src/selection.ts';
import { EditorState, TextSelection } from '../src/state.ts';
import type { EditorTransaction } from '../src/state.ts';
import { EditorView } from '../src/view.ts';

const s = basicSchema;
const doc = (...content: Node[]) => s.node('doc', null, content);
const p = (...content: Node[]) => s.node('paragraph', null, content);
const t = (text: string) => s.text(text);
const image = () => s.node('image', { src: '/a.png' });
const rule = () => s.node('horizontal_rule');

const open: EditorView[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()!.destroy();
  const active = window.document.activeElement;
  if (active instanceof HTMLElement) active.blur();
  window.document.getSelection()?.removeAllRanges();
  window.document.body.replaceChildren();
});

function view(document_: Node, anchor: number, options: Record<string, unknown> = {}): EditorView {
  const mount = window.document.createElement('div');
  window.document.body.appendChild(mount);
  const state = EditorState.create(document_, TextSelection.create(document_, anchor));
  const created = new EditorView(mount, { state, ...options });
  open.push(created);
  created.focus();
  return created;
}

const selection = () => window.document.getSelection()!;

function key(view_: EditorView, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  view_.dom.dispatchEvent(event);
  return event;
}

function paste(view_: EditorView, data: Record<string, string>): ClipboardEvent {
  const transfer = new DataTransfer();
  for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
  const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
  view_.dom.dispatchEvent(event);
  return event;
}

const selected = (view_: EditorView) => Array.from(view_.dom.querySelectorAll('.volt-selected-node'));

describe('a node selection on screen', () => {
  it('steps onto an image on the right arrow, and draws it selected', () => {
    // 0 <p> 1 a 2 [img] 3 b 4 </p>
    const editing = view(doc(p(t('a'), image(), t('b'))), 2);
    const event = key(editing, { key: 'ArrowRight' });

    expect(event.defaultPrevented).toBe(true);
    expect(String(editing.state.selection)).toBe('node(image@2)');
    const img = editing.dom.querySelector('img')!;
    expect(selected(editing)).toEqual([img]);
    // The DOM range is around the image, so a screen reader and a copy both
    // see the thing that is selected.
    const range = selection().getRangeAt(0);
    expect(editing.posAtDOM(range.startContainer, range.startOffset)).toBe(2);
    expect(editing.posAtDOM(range.endContainer, range.endOffset)).toBe(3);
  });

  it('is not turned back into a text range by the selectionchange its own write causes', () => {
    const editing = view(doc(p(t('a'), image(), t('b'))), 2);
    key(editing, { key: 'ArrowRight' });
    window.document.dispatchEvent(new Event('selectionchange'));
    expect(editing.state.selection).toBeInstanceOf(NodeSelection);
  });

  it('steps off it on the next arrow, and stops drawing it selected', () => {
    const editing = view(doc(p(t('a'), image(), t('b'))), 2);
    key(editing, { key: 'ArrowRight' });
    const event = key(editing, { key: 'ArrowRight' });

    expect(event.defaultPrevented).toBe(true);
    expect(String(editing.state.selection)).toBe('cursor(3)');
    expect(selected(editing)).toEqual([]);
  });

  it('steps onto a rule from the end of the paragraph before it', () => {
    // 0 <p> 1 a 2 </p> 3 [hr] 4 <p> 5 b 6 </p> 7
    const editing = view(doc(p(t('a')), rule(), p(t('b'))), 2);
    key(editing, { key: 'ArrowRight' });
    expect(String(editing.state.selection)).toBe('node(horizontal_rule@3)');
    expect(selected(editing)).toEqual([editing.dom.querySelector('hr')]);

    key(editing, { key: 'ArrowDown' });
    expect(String(editing.state.selection)).toBe('cursor(5)');
  });

  it('reads the arrow keys in the direction the text runs', () => {
    const editing = view(doc(p(t('a'), image(), t('b'))), 2);
    editing.dom.style.direction = 'rtl';
    // In right-to-left text the left arrow moves forwards, onto the image.
    expect(key(editing, { key: 'ArrowLeft' }).defaultPrevented).toBe(true);
    expect(String(editing.state.selection)).toBe('node(image@2)');
    key(editing, { key: 'ArrowLeft' });
    expect(String(editing.state.selection)).toBe('cursor(3)');
  });

  it('leaves an arrow with a modifier, and one it has nothing to do with, to the browser', () => {
    const editing = view(doc(p(t('a'), image(), t('b'))), 2);
    expect(key(editing, { key: 'ArrowRight', shiftKey: true }).defaultPrevented).toBe(false);
    expect(key(editing, { key: 'ArrowRight', altKey: true }).defaultPrevented).toBe(false);
    const mid = view(doc(p(t('abc'))), 2);
    expect(key(mid, { key: 'ArrowRight' }).defaultPrevented).toBe(false);
    expect(String(mid.state.selection)).toBe('cursor(2)');
  });

  it('deletes the selected node on backspace, as one edit and one undo', () => {
    const editing = view(doc(p(t('a'), image(), t('b'))), 2);
    key(editing, { key: 'ArrowRight' });
    const event = new InputEvent('beforeinput', {
      inputType: 'deleteContentBackward',
      bubbles: true,
      cancelable: true,
    });
    editing.dom.dispatchEvent(event);

    expect(editing.dom.innerHTML).toBe('<p>ab</p>');
    expect(String(editing.state.selection)).toBe('cursor(2)');
  });

  it('selects an image that is clicked', () => {
    const editing = view(doc(p(t('a'), image(), t('b'))), 1);
    editing.dom.querySelector('img')!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(String(editing.state.selection)).toBe('node(image@2)');
  });

  it('leaves a click alone while an input method is composing', () => {
    // The composition commits to the selection it began at; moving the
    // selection under it would commit the text over the image instead.
    const editing = view(doc(p(t('a'), image(), t('b'))), 1);
    editing.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    editing.dom.querySelector('img')!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(String(editing.state.selection)).toBe('cursor(1)');
  });

  it('starts out drawing a node selection it was created with', () => {
    const document_ = doc(p(t('a')), rule());
    const mount = window.document.createElement('div');
    window.document.body.appendChild(mount);
    const editing = new EditorView(mount, { state: EditorState.create(document_, NodeSelection.create(document_, 3)) });
    open.push(editing);
    expect(selected(editing)).toEqual([editing.dom.querySelector('hr')]);
  });
});

describe('a paste that keeps its structure', () => {
  it('takes HTML off the paste event and puts it in through the schema', () => {
    const editing = view(doc(p(t('abcd'))), 3);
    const event = paste(editing, {
      'text/html': '<p>one</p><ul><li>two</li></ul>',
      'text/plain': 'one\ntwo',
    });

    expect(event.defaultPrevented).toBe(true);
    expect(editing.dom.innerHTML).toBe('<p>abone</p><ul><li><p>two</p></li></ul><p>cd</p>');
  });

  it('arrives as one transaction, one step and one undo unit of its own', () => {
    const dispatched: EditorTransaction[] = [];
    const editing = view(doc(p(t('ab'))), 2, {
      dispatchTransaction(tr: EditorTransaction, view_: EditorView) {
        dispatched.push(tr);
        view_.update(view_.state.apply(tr), tr);
      },
    });
    paste(editing, { 'text/html': '<p>x</p><p>y</p>' });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.steps).toHaveLength(1);
    expect(dispatched[0]!.historyClosed).toBe(true);
    expect(editing.dom.innerHTML).toBe('<p>ax</p><p>yb</p>');
  });

  it('leaves a paste of plain text to arrive as text, as it did before', () => {
    const editing = view(doc(p(t('ab'))), 2);
    const event = paste(editing, { 'text/plain': 'x' });
    expect(event.defaultPrevented).toBe(false);
    expect(editing.dom.innerHTML).toBe('<p>ab</p>');
  });

  it('leaves HTML it can make nothing of to arrive as text', () => {
    const editing = view(doc(p(t('ab'))), 2);
    const event = paste(editing, { 'text/html': '<script>x()</script>', 'text/plain': 'x' });
    expect(event.defaultPrevented).toBe(false);
    expect(editing.dom.innerHTML).toBe('<p>ab</p>');
  });

  it('pastes nothing into a read-only view', () => {
    const editing = view(doc(p(t('ab'))), 2, { editable: false });
    const event = paste(editing, { 'text/html': '<p>x</p>' });
    expect(event.defaultPrevented).toBe(false);
    expect(editing.dom.innerHTML).toBe('<p>ab</p>');
  });
});
