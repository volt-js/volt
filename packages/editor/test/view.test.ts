/**
 * The view, driven the way a browser drives it.
 *
 * Three things are being pinned here, and they are the three the rest of the
 * package cannot check for itself. That a document becomes DOM. That a
 * position means the same thing on both sides of the boundary — checked by
 * round-tripping every position in a document rather than by naming a few,
 * since a mapping that is right about three positions and wrong about the
 * fourth is not a mapping. And that the two selections agree, in both
 * directions, including after an edit has replaced the very text node the
 * caret was in.
 *
 * Events are constructed and dispatched by hand, and the DOM selection is set
 * through the real `Selection` API, for the reason input.test.ts gives: an
 * editor's view is defined in terms of the events and the selection it
 * receives, so driving those is the thing under test.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Mark, Schema, basicSchema } from '../src/index.ts';
import { insertParagraph, insertText } from '../src/commands.ts';
import type { Node } from '../src/node.ts';
import { EditorState, TextSelection } from '../src/state.ts';
import { EditorView } from '../src/view.ts';

const s = basicSchema;
const doc = (...content: Node[]) => s.node('doc', null, content);
const p = (...content: Node[]) => s.node('paragraph', null, content);
const t = (text: string, ...marks: Mark[]) => s.text(text, marks);

const open: EditorView[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()!.destroy();
  const active = window.document.activeElement;
  if (active instanceof HTMLElement) active.blur();
  window.document.getSelection()?.removeAllRanges();
  window.document.body.replaceChildren();
});

function view(document_: Node, anchor?: number, head?: number, options: Record<string, unknown> = {}): EditorView {
  const mount = window.document.createElement('div');
  window.document.body.appendChild(mount);
  const state = EditorState.create(
    document_,
    anchor === undefined ? undefined : TextSelection.create(document_, anchor, head ?? anchor),
  );
  const created = new EditorView(mount, { state, ...options });
  open.push(created);
  return created;
}

const selection = () => window.document.getSelection()!;

function beforeInput(view_: EditorView, inputType: string, init: Record<string, unknown> = {}): InputEvent {
  const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true, ...init });
  view_.dom.dispatchEvent(event);
  return event;
}

describe('rendering a document', () => {
  it('gives each node type its element', () => {
    const editing = view(
      doc(
        s.node('heading', { level: 2 }, [t('Title')]),
        p(t('hello')),
        s.node('blockquote', null, [p(t('quoted'))]),
        s.node('horizontal_rule'),
      ),
    );

    expect(editing.dom.innerHTML).toBe(
      '<h2>Title</h2><p>hello</p><blockquote><p>quoted</p></blockquote><hr>',
    );
  });

  it('wraps inline content in the elements of its marks, outermost first', () => {
    const editing = view(doc(p(t('plain '), t('both', s.mark('em'), s.mark('strong')))));
    expect(editing.dom.innerHTML).toBe('<p>plain <em><strong>both</strong></em></p>');
  });

  it('renders a mark attribute onto its element', () => {
    const editing = view(doc(p(t('here', s.mark('link', { href: 'https://voltjs.dev' })))));
    expect(editing.dom.innerHTML).toBe('<p><a href="https://voltjs.dev">here</a></p>');
  });

  it('puts content into the inner element when a renderer names one', () => {
    const editing = view(doc(s.node('code_block', null, [t('let x = 1')])));
    expect(editing.dom.innerHTML).toBe('<pre><code>let x = 1</code></pre>');
  });

  it('renders a list, and its start attribute only when it is not the default', () => {
    const item = (text: string) => s.node('list_item', null, [p(t(text))]);
    const plain = view(doc(s.node('ordered_list', null, [item('a')])));
    expect(plain.dom.innerHTML).toBe('<ol><li><p>a</p></li></ol>');

    const numbered = view(doc(s.node('ordered_list', { start: 3 }, [item('a')])));
    expect(numbered.dom.innerHTML).toBe('<ol start="3"><li><p>a</p></li></ol>');
  });

  it('renders a leaf with its attributes and nothing inside it', () => {
    const editing = view(doc(p(t('a'), s.node('image', { src: '/cat.png', alt: 'a cat' }), t('b'))));
    expect(editing.dom.innerHTML).toBe('<p>a<img src="/cat.png" alt="a cat">b</p>');
  });

  it('props an empty textblock open with a break', () => {
    const editing = view(doc(p()));
    expect(editing.dom.innerHTML).toBe('<p><br></p>');
  });

  it('makes the element editable and announces it', () => {
    const editing = view(doc(p(t('a'))));
    expect(editing.dom.contentEditable).toBe('true');
    expect(editing.dom.getAttribute('role')).toBe('textbox');
  });

  it('renders a type no renderer knows as a tagged element rather than failing', () => {
    const custom = new Schema({
      nodes: {
        doc: { content: 'block+' },
        callout: { content: 'inline*', group: 'block' },
        text: { group: 'inline' },
      },
    });
    const editing = view(custom.node('doc', null, [custom.node('callout', null, [custom.text('note')])]));
    expect(editing.dom.innerHTML).toBe('<div data-node-type="callout">note</div>');
  });

  it('prefers a renderer the caller supplies over the built-in one', () => {
    const editing = view(doc(p(t('a'))), undefined, undefined, {
      renderers: {
        nodes: {
          paragraph: (_node: Node, document_: Document) => {
            const dom = document_.createElement('div');
            dom.className = 'para';
            return { dom };
          },
        },
      },
    });
    expect(editing.dom.innerHTML).toBe('<div class="para">a</div>');
  });
});

describe('mapping positions across the boundary', () => {
  it('round-trips every position in a nested document', () => {
    const document_ = doc(
      p(t('ab'), s.node('image', { src: '/x.png' }), t('cd', s.mark('em'))),
      s.node('blockquote', null, [p(t('deep')), p()]),
      s.node('horizontal_rule'),
    );
    const editing = view(document_);

    for (let pos = 0; pos <= document_.content.size; pos++) {
      const at = editing.domAtPos(pos);
      expect(at, `no DOM point for ${pos}`).not.toBeNull();
      expect(editing.posAtDOM(at!.node, at!.offset), `round trip of ${pos}`).toBe(pos);
    }
  });

  it('puts a position inside text on the text node itself', () => {
    const editing = view(doc(p(t('hello'))));
    const text = editing.dom.firstChild!.firstChild!;
    expect(editing.domAtPos(3)).toEqual({ node: text, offset: 2 });
    // Both edges of the block too: a caret at the end of a paragraph belongs
    // in the text, not on the element boundary, or nothing downstream can tell
    // it from a caret before whatever comes next.
    expect(editing.domAtPos(1)).toEqual({ node: text, offset: 0 });
    expect(editing.domAtPos(6)).toEqual({ node: text, offset: 5 });
  });

  it('puts a position before a leaf at the end of the text before it', () => {
    const editing = view(doc(p(t('a'), s.node('image', { src: '/x.png' }))));
    const text = editing.dom.firstChild!.firstChild!;
    expect(editing.domAtPos(2)).toEqual({ node: text, offset: 1 });
  });

  it('reads a point on a mark wrapper as one end of the run it wraps', () => {
    const editing = view(doc(p(t('ab'), t('cd', s.mark('em')))));
    const em = editing.dom.querySelector('em')!;
    expect(editing.posAtDOM(em, 0)).toBe(3);
    expect(editing.posAtDOM(em, 1)).toBe(5);
  });

  it('climbs out of DOM it does not describe, such as the propping break', () => {
    const editing = view(doc(p(t('ab')), p()));
    const br = editing.dom.querySelector('br')!;
    expect(editing.posAtDOM(br, 0)).toBe(5);
  });

  it('finds a position inside the inner element of a two-element rendering', () => {
    const editing = view(doc(s.node('code_block', null, [t('xy')])));
    const code = editing.dom.querySelector('code')!;
    expect(editing.posAtDOM(code, 0)).toBe(1);
    expect(editing.domAtPos(2)).toEqual({ node: code.firstChild, offset: 1 });
  });

  it('refuses a DOM node that is not in this view, and a position that is not in the document', () => {
    const editing = view(doc(p(t('ab'))));
    const stranger = window.document.createElement('span');
    window.document.body.appendChild(stranger);
    expect(editing.posAtDOM(stranger, 0)).toBeNull();
    expect(editing.domAtPos(99)).toBeNull();
  });
});

describe('reflecting the selection', () => {
  it('writes the model selection into the DOM when the view has focus', () => {
    const editing = view(doc(p(t('hello'))), 3);
    editing.focus();

    const text = editing.dom.firstChild!.firstChild!;
    expect(selection().anchorNode).toBe(text);
    expect(selection().anchorOffset).toBe(2);
    expect(selection().isCollapsed).toBe(true);
  });

  it('writes both ends of a range, anchor and head in that order', () => {
    const document_ = doc(p(t('hello')), p(t('world')));
    const editing = view(document_, 4);
    editing.focus();
    editing.dispatch(editing.state.tr().setSelection(TextSelection.create(document_, 11, 3)));

    expect(selection().anchorNode).toBe(editing.dom.children[1]!.firstChild);
    expect(selection().anchorOffset).toBe(3);
    expect(selection().focusNode).toBe(editing.dom.children[0]!.firstChild);
    expect(selection().focusOffset).toBe(2);
  });

  it('leaves a selection that is somewhere else alone', () => {
    const elsewhere = window.document.createElement('div');
    elsewhere.textContent = 'not the editor';
    window.document.body.appendChild(elsewhere);
    const outside = elsewhere.firstChild!;
    selection().setBaseAndExtent(outside, 1, outside, 3);

    const editing = view(doc(p(t('hello'))), 3);

    expect(selection().anchorNode).toBe(outside);
    expect(selection().anchorOffset).toBe(1);
    expect(editing.dom.contains(selection().anchorNode!)).toBe(false);
  });

  it('reads a selection the browser moved back into the model', () => {
    const editing = view(doc(p(t('hello')), p(t('world'))));
    editing.focus();

    const second = editing.dom.children[1]!.firstChild!;
    selection().setBaseAndExtent(second, 2, second, 4);

    expect(editing.state.selection.anchor).toBe(10);
    expect(editing.state.selection.head).toBe(12);
  });

  it('reads a caret dropped on an element boundary, not only one inside text', () => {
    const editing = view(doc(p(t('ab')), p(t('cd'))));
    editing.focus();

    selection().setBaseAndExtent(editing.dom, 1, editing.dom, 1);

    expect(editing.state.selection.anchor).toBe(5);
    expect(editing.state.selection.empty).toBe(true);
  });

  it('leaves the DOM selection where the composition put it while one is running', () => {
    const document_ = doc(p(t('hello')));
    const editing = view(document_, 2);
    editing.focus();
    editing.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

    // The model moves underneath the composition — an undo, or a change from
    // somewhere else. The DOM belongs to the input method until it says it is
    // finished, and taking the selection off it abandons what it was writing.
    editing.dispatch(editing.state.tr().setSelection(TextSelection.create(document_, 5)));

    expect(editing.state.selection.anchor).toBe(5);
    expect(selection().anchorOffset).toBe(1);
  });

  it('does not dispatch for a DOM selection that already agrees with the model', () => {
    const document_ = doc(p(t('hello')));
    const seen: unknown[] = [];
    const editing = view(document_, 3, 3, { dispatchTransaction: (tr: unknown) => seen.push(tr) });
    editing.focus();

    const text = editing.dom.firstChild!.firstChild!;
    selection().setBaseAndExtent(text, 2, text, 2);

    expect(seen).toEqual([]);
  });
});

describe('typing, end to end', () => {
  it('turns a beforeinput into a change to the document and to the DOM', () => {
    const editing = view(doc(p(t('abcd'))));
    editing.focus();
    const text = editing.dom.firstChild!.firstChild!;
    selection().setBaseAndExtent(text, 2, text, 2);

    const event = beforeInput(editing, 'insertText', { data: 'X' });

    expect(event.defaultPrevented).toBe(true);
    expect(editing.state.doc.textContent).toBe('abXcd');
    expect(editing.dom.innerHTML).toBe('<p>abXcd</p>');
  });

  it('moves the DOM caret onto the text node the edit produced', () => {
    const editing = view(doc(p(t('abcd'))));
    editing.focus();
    const before = editing.dom.firstChild!.firstChild!;
    selection().setBaseAndExtent(before, 2, before, 2);

    beforeInput(editing, 'insertText', { data: 'X' });

    const after = editing.dom.firstChild!.firstChild!;
    expect(after).not.toBe(before);
    expect(editing.state.selection.anchor).toBe(4);
    expect(selection().anchorNode).toBe(after);
    expect(selection().anchorOffset).toBe(3);
  });

  it('splits the block on a paragraph insertion and renders both halves', () => {
    const editing = view(doc(p(t('abcd'))));
    editing.focus();
    const text = editing.dom.firstChild!.firstChild!;
    selection().setBaseAndExtent(text, 2, text, 2);

    beforeInput(editing, 'insertParagraph');

    expect(editing.dom.innerHTML).toBe('<p>ab</p><p>cd</p>');
    expect(selection().anchorNode).toBe(editing.dom.children[1]!.firstChild);
    expect(selection().anchorOffset).toBe(0);
  });

  it('backspaces, and props the emptied block open again', () => {
    const editing = view(doc(p(t('a'))));
    editing.focus();
    const text = editing.dom.firstChild!.firstChild!;
    selection().setBaseAndExtent(text, 1, text, 1);

    beforeInput(editing, 'deleteContentBackward');

    expect(editing.state.doc.textContent).toBe('');
    expect(editing.dom.innerHTML).toBe('<p><br></p>');
  });

  it('takes the propping break away again when the block gets content', () => {
    const editing = view(doc(p()));
    editing.focus();

    beforeInput(editing, 'insertText', { data: 'x' });

    expect(editing.dom.innerHTML).toBe('<p>x</p>');
  });
});

describe('updating from the range a transaction changed', () => {
  it('keeps the element of the block that was typed into, and its siblings', () => {
    const editing = view(doc(p(t('one')), p(t('two'))), 2);
    const first = editing.dom.children[0]!;
    const second = editing.dom.children[1]!;

    const tr = editing.state.tr();
    expect(insertText(tr, 'X')).toBe(true);
    editing.dispatch(tr);

    expect(editing.dom.innerHTML).toBe('<p>oXne</p><p>two</p>');
    expect(editing.dom.children[0]).toBe(first);
    expect(editing.dom.children[1]).toBe(second);
  });

  it('descends through the blocks a change is nested inside', () => {
    const editing = view(
      doc(s.node('bullet_list', null, [
        s.node('list_item', null, [p(t('one'))]),
        s.node('list_item', null, [p(t('two'))]),
      ])),
      4,
    );
    const list = editing.dom.children[0]!;
    const firstItem = list.children[0]!;
    const secondItem = list.children[1]!;

    const tr = editing.state.tr();
    expect(insertText(tr, 'X')).toBe(true);
    editing.dispatch(tr);

    expect(editing.dom.textContent).toBe('oXnetwo');
    expect(editing.dom.children[0]).toBe(list);
    expect(list.children[0]).toBe(firstItem);
    expect(list.children[1]).toBe(secondItem);
  });

  it('rebuilds only the blocks a split rewrote', () => {
    const editing = view(doc(p(t('ab')), p(t('cd'))), 2);
    const untouched = editing.dom.children[1]!;

    const tr = editing.state.tr();
    expect(insertParagraph(tr)).toBe(true);
    editing.dispatch(tr);

    expect(editing.dom.innerHTML).toBe('<p>a</p><p>b</p><p>cd</p>');
    expect(editing.dom.children[2]).toBe(untouched);
  });

  it('redraws the whole document when no transaction says what moved', () => {
    const editing = view(doc(p(t('one')), p(t('two'))), 2);
    const first = editing.dom.children[0]!;

    editing.update(EditorState.create(doc(p(t('other')), p(t('two')))));

    expect(editing.dom.innerHTML).toBe('<p>other</p><p>two</p>');
    expect(editing.dom.children[0]).not.toBe(first);
  });

  it('keeps positions right after an update, so the next edit lands where it should', () => {
    const editing = view(doc(p(t('one')), p(t('two'))), 2);

    const first = editing.state.tr();
    insertText(first, 'X');
    editing.dispatch(first);

    // The second paragraph moved by one. Nothing recomputed it; the DOM
    // positions have to have moved with the model, or this reads the wrong
    // text node.
    const second = editing.dom.children[1]!.firstChild!;
    expect(editing.posAtDOM(second, 1)).toBe(8);
    expect(editing.domAtPos(8)).toEqual({ node: second, offset: 1 });
  });
});

describe('shutting down', () => {
  it('stops listening once destroyed', () => {
    const editing = view(doc(p(t('abcd'))));
    editing.focus();
    const text = editing.dom.firstChild!.firstChild!;
    selection().setBaseAndExtent(text, 2, text, 2);
    const before = editing.state;

    editing.destroy();
    beforeInput(editing, 'insertText', { data: 'X' });

    expect(editing.state).toBe(before);
    expect(editing.dom.parentNode).toBeNull();
  });
});
