/**
 * Node selections and open slices at their edges.
 *
 * The other files pin how these work in the middle of a document. This one
 * pins the places they were most likely to be wrong: every replacement fitting
 * produces, applied, undone and mapped through and back; a selected node at
 * either end of the document, where an arrow key has nowhere to go; a click
 * on a node that lands while an input method is composing; and a selected
 * block node where replacing exactly its range is a replacement the schema
 * refuses — typed into, or all its blockquote holds.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Fragment, Schema, Slice, basicSchema } from '../src/index.ts';
import type { Mark } from '../src/index.ts';
import { deleteBackward, deleteForward, insertParagraph, insertText } from '../src/commands.ts';
import { insertSlice, parseSlice } from '../src/clipboard.ts';
import type { Node } from '../src/node.ts';
import { EditorSelection, NodeSelection, findSelection, selectHorizontally } from '../src/selection.ts';
import { fitSlice, placeSlice } from '../src/slice.ts';
import { EditorState, TextSelection } from '../src/state.ts';
import { Mapping, ReplaceStep } from '../src/step.ts';
import { EditorView } from '../src/view.ts';

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
const image = (src = 'a.png') => s.node('image', { src });
const em = s.mark('em');

/** The first node, at any depth, whose content its type would refuse. */
function firstInvalid(node: Node): Node | null {
  if (node.isText) return null;
  if (!node.type.validContent(node.content)) return node;
  for (let i = 0; i < node.childCount; i++) {
    const inner = firstInvalid(node.child(i));
    if (inner) return inner;
  }
  return null;
}

/** Every selection a document has: a caret and a short range at each text position, and each selectable node. */
function everySelection(document_: Node): EditorSelection[] {
  const found: EditorSelection[] = [];
  for (let pos = 0; pos <= document_.content.size; pos++) {
    for (const head of [pos, Math.min(document_.content.size, pos + 3)]) {
      const selection = TextSelection.create(document_, pos, head);
      if (!found.some((other) => other.eq(selection))) found.push(selection);
    }
    try {
      found.push(NodeSelection.create(document_, pos));
    } catch {
      // Nothing selectable starts here.
    }
  }
  return found;
}

// A document with something of everything at an edge: a heading with a mark,
// an image mid-paragraph, an image alone in a list item's paragraph with a
// rule after it, a rule between blocks, a rule alone in a blockquote, a code
// block and an empty paragraph last.
const everything = doc(
  h(1, t('Ti'), t('tle', em)),
  p(t('ab'), image(), t('cd')),
  ul(li(p(t('one'))), li(p(image('b.png')), rule())),
  rule(),
  quote(rule()),
  code(t('let x')),
  p(),
);

const pastes = [
  '<p>x</p>',
  '<p>x</p><p>y</p>',
  '<ul><li>a</li><li>b</li></ul>',
  '<h2>h</h2><p>x<img src="c.png"></p>',
  '<hr>',
  '<p>a</p><hr>',
  '<pre>c\nd</pre>',
  '<blockquote><p>q</p></blockquote>',
  'plain',
  '<table><tr><td>a</td><td>b</td></tr></table>',
];

describe('every replacement fitting produces', () => {
  it('applies to a valid document, is undone exactly by its inverse, and gives every position back', () => {
    // slice.test.ts asks only that a fit applies. A fit that applied and left
    // a node its schema forbids, or whose inverse put back something else,
    // would be a paste that undo cannot take back.
    const pieces = [Slice.empty, ...pastes.map((html) => parseSlice(s, html)), everything.slice(3, 20)];
    const failures: string[] = [];
    let tried = 0;
    for (let from = 0; from <= everything.content.size; from += 2) {
      for (let to = from; to <= everything.content.size; to += 3) {
        for (const piece of pieces) {
          for (const fit of [fitSlice(everything, from, to, piece), placeSlice(everything, from, to, piece)]) {
            if (!fit.ok) continue;
            tried++;
            const where = `${from}..${to} with ${piece}`;
            const step = new ReplaceStep(fit.from, fit.to, fit.slice);
            const result = step.apply(everything);
            if (!result.ok) {
              failures.push(`${where}: refused, ${result.reason}`);
              continue;
            }
            const invalid = firstInvalid(result.doc);
            if (invalid) failures.push(`${where}: left ${invalid}`);

            const inverse = step.invert(everything);
            const back = inverse.apply(result.doc);
            if (!back.ok || !back.doc.eq(everything)) {
              failures.push(`${where}: the inverse did not put it back`);
              continue;
            }
            const mapping = new Mapping();
            mapping.appendMap(step.getMap());
            mapping.appendMap(inverse.getMap(), 0);
            for (let pos = 0; pos <= everything.content.size; pos++) {
              if (mapping.map(pos, 1) !== pos || mapping.map(pos, -1) !== pos) {
                failures.push(`${where}: ${pos} came back as ${mapping.map(pos, 1)}`);
                break;
              }
            }
          }
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(tried).toBeGreaterThan(3000);
  });

  it('carries every selection into the new document, and back to itself across its own undo', () => {
    const pieces = [Slice.empty, ...['<p>x</p><p>y</p>', '<hr>', 'z', '<ul><li>l</li></ul>'].map((html) => parseSlice(s, html))];
    const selections = everySelection(everything);
    const failures: string[] = [];
    for (let from = 0; from <= everything.content.size; from += 3) {
      for (let to = from; to <= everything.content.size; to += 4) {
        for (const piece of pieces) {
          const fit = placeSlice(everything, from, to, piece);
          if (!fit.ok) continue;
          const step = new ReplaceStep(fit.from, fit.to, fit.slice);
          const result = step.apply(everything);
          if (!result.ok) continue;
          const inverse = step.invert(everything);
          const back = inverse.apply(result.doc);
          if (!back.ok) continue;
          const forward = new Mapping();
          forward.appendMap(step.getMap());
          const there = new Mapping();
          there.appendMap(step.getMap());
          there.appendMap(inverse.getMap(), 0);

          for (const selection of selections) {
            const where = `${selection} across ${fit.from}..${fit.to} with ${fit.slice}`;
            const mapped = selection.map(result.doc, forward);
            // A state accepts only a selection that describes its document,
            // so this is "the mapped selection is a real one there".
            try {
              EditorState.create(result.doc, mapped);
            } catch {
              failures.push(`${where}: mapped to ${mapped}, which is not a selection there`);
            }
            const round = selection.map(back.doc, there);
            if (!round.eq(selection)) failures.push(`${where}: came back as ${round}`);
          }
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});

describe('pasted HTML the schema cannot hold', () => {
  // A schema with a required first block and no lists, marks or rules: most
  // of what a page holds has nowhere to go in it.
  const strict = new Schema({
    nodes: {
      doc: { content: 'heading block+' },
      heading: { content: 'text*', marks: '' },
      paragraph: { content: 'inline*', group: 'block' },
      blockquote: { content: 'paragraph+', group: 'block', defining: true },
      text: { group: 'inline' },
      image: { group: 'inline', inline: true, attrs: { src: {} } },
    },
    marks: { em: {} },
  });
  const st = (text: string) => strict.text(text);
  const strictDoc = strict.node('doc', null, [
    strict.node('heading', null, [st('T')]),
    strict.node('paragraph', null, [st('ab')]),
    strict.node('blockquote', null, [strict.node('paragraph', null, [st('q')])]),
  ]);

  it('goes in at every selection as one step that leaves a valid document and undoes exactly, or not at all', () => {
    const html = [
      ...pastes,
      '<ul><li><ul><li>deep</li></ul></li></ul>',
      '<li>bare</li>',
      '<h1>x</h1><hr><img src="javascript:1"><img src="d.png">',
      '<div>a<p>b</p>c</div>',
      '<b style="font-weight:normal"><p>docs</p></b>',
    ];
    const failures: string[] = [];
    let pasted = 0;
    for (const [schema, documents] of [
      [s, [doc(p()), doc(rule()), everything]],
      [strict, [strictDoc]],
    ] as const) {
      for (const source of html) {
        const slice = parseSlice(schema, source);
        for (const document_ of documents) {
          for (const selection of everySelection(document_)) {
            const tr = EditorState.create(document_, selection).tr();
            if (!insertSlice(tr, slice)) {
              expect(tr.steps).toHaveLength(0);
              continue;
            }
            pasted++;
            const where = `${JSON.stringify(source)} at ${selection} in ${document_}`;
            if (tr.steps.length !== 1) failures.push(`${where}: ${tr.steps.length} steps`);
            const invalid = firstInvalid(tr.doc);
            if (invalid) failures.push(`${where}: left ${invalid}`);
            expect(() => EditorState.create(tr.doc, tr.selection), where).not.toThrow();
            const back = tr.steps[0]!.invert(document_).apply(tr.doc);
            if (!back.ok || !back.doc.eq(document_)) failures.push(`${where}: the undo did not put it back`);
          }
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(pasted).toBeGreaterThan(1000);
  });
});

describe('a selected block node where replacing exactly its range is refused', () => {
  // Text cannot stand where a block was, and a blockquote cannot be left
  // empty, so the join rule refuses typing into a rule's own range and
  // deleting a rule that is all its blockquote holds. The commands put a
  // textblock there instead; node-selection-commands.test.ts has the rest.
  // 0 <p> 1 a 2 b 3 </p> 4 [hr] 5 <p> 6 c 7 d 8 </p> 9
  const between = doc(p(t('ab')), rule(), p(t('cd')));
  // 0 <bq> 1 [hr] 2 </bq> 3 <p> 4 a 5 </p> 6
  const alone = doc(quote(rule()), p(t('a')));

  it('types, and returns, over a rule between paragraphs into a paragraph in its place', () => {
    const typed = EditorState.create(between, NodeSelection.create(between, 4)).tr();
    expect(insertText(typed, 'x')).toBe(true);
    expect(String(typed.doc)).toBe('doc(paragraph("ab"), paragraph("x"), paragraph("cd"))');
    const returned = EditorState.create(between, NodeSelection.create(between, 4)).tr();
    expect(insertParagraph(returned)).toBe(true);
    expect(String(returned.doc)).toBe('doc(paragraph("ab"), paragraph, paragraph("cd"))');
  });

  it('puts an empty paragraph where a rule was that is all its blockquote holds, since `block+` needs a block there', () => {
    for (const command of [deleteBackward, deleteForward]) {
      const tr = EditorState.create(alone, NodeSelection.create(alone, 1)).tr();
      expect(command(tr)).toBe(true);
      expect(String(tr.doc)).toBe('doc(blockquote(paragraph), paragraph("a"))');
      expect(String(tr.selection)).toBe('cursor(2)');
    }
  });

  it('pastes over either, since a paste is fitted', () => {
    for (const [document_, pos] of [
      [between, 4],
      [alone, 1],
    ] as const) {
      const tr = EditorState.create(document_, NodeSelection.create(document_, pos)).tr();
      expect(insertSlice(tr, new Slice(Fragment.from(t('x')), 0, 0))).toBe(true);
      expect(firstInvalid(tr.doc)).toBeNull();
      expect(tr.doc.textBetween(0, tr.doc.content.size)).toContain('x');
    }
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

function key(view_: EditorView, name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  view_.dom.dispatchEvent(event);
  return event;
}

/** happy-dom, like every browser, will not take `data` through the constructor, so it is assigned afterwards. */
function composition(view_: EditorView, type: string, data?: string): void {
  const event = new CompositionEvent(type, { bubbles: true });
  if (data !== undefined) (event as { data: string }).data = data;
  view_.dom.dispatchEvent(event);
}

function click(target: Element): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
}

const domSelection = () => window.document.getSelection()!;
const drawnSelected = (view_: EditorView) => Array.from(view_.dom.querySelectorAll('.volt-selected-node'));

describe('a selected block node at the edge of the document, on screen', () => {
  // With nowhere to go, the arrow used to be left to the browser, which
  // collapses the range around the rule to the end the key points at. That
  // end is the edge of the document, which reads back as the nearest caret —
  // on the far side of the rule. The left arrow moved the caret right.

  it('keeps a rule at the start selected on the arrows that point out of the document', () => {
    // 0 [hr] 1 <p> 2 a 3 </p> 4
    const first = doc(rule(), p(t('a')));
    for (const name of ['ArrowLeft', 'ArrowUp']) {
      const editing = view(first, NodeSelection.create(first, 0));
      expect(key(editing, name).defaultPrevented, name).toBe(true);
      expect(String(editing.state.selection)).toBe('node(horizontal_rule@0)');
    }
  });

  it('keeps a rule at the end selected on the arrows that point past it', () => {
    // 0 <p> 1 a 2 </p> 3 [hr] 4
    const last = doc(p(t('a')), rule());
    for (const name of ['ArrowRight', 'ArrowDown']) {
      const editing = view(last, NodeSelection.create(last, 3));
      expect(key(editing, name).defaultPrevented, name).toBe(true);
      expect(String(editing.state.selection)).toBe('node(horizontal_rule@3)');
    }
  });

  it('still leaves up and down on a selected image to the browser, which moves by line', () => {
    const inline = doc(p(image()));
    const editing = view(inline, NodeSelection.create(inline, 1));
    expect(key(editing, 'ArrowDown').defaultPrevented).toBe(false);
    expect(key(editing, 'ArrowUp').defaultPrevented).toBe(false);
  });

  it('draws a selected rule as a DOM range around it, so a screen reader is told what is selected', () => {
    const between = doc(p(t('a')), rule(), p(t('b')));
    const editing = view(between, NodeSelection.create(between, 3));
    const range = domSelection().getRangeAt(0);
    expect(editing.posAtDOM(range.startContainer, range.startOffset)).toBe(3);
    expect(editing.posAtDOM(range.endContainer, range.endOffset)).toBe(4);
    expect(drawnSelected(editing)).toEqual([editing.dom.querySelector('hr')]);
  });
});

describe('a click on a node that lands while an input method is composing', () => {
  // A click while composing is not acted on, since the composition commits
  // to the selection it began at. But the browser has already put its own
  // selection round what was clicked, and once the composition ends that is
  // read back as a text range. Round a rule, that range runs from the end of
  // one paragraph to the start of the next, and the next keystroke deletes
  // the rule and joins the two.

  it('selects the rule once the composition has ended, rather than a range across it', () => {
    // 0 <p> 1 a 2 b 3 </p> 4 [hr] 5 <p> 6 d 7 </p> 8, and 2 more after composing.
    const document_ = doc(p(t('ab')), rule(), p(t('d')));
    const editing = view(document_, TextSelection.create(document_, 3));
    const hr = editing.dom.querySelector('hr')!;

    composition(editing, 'compositionstart');
    editing.dom.children[0]!.appendChild(window.document.createTextNode('に'));
    domSelection().setBaseAndExtent(editing.dom, 1, editing.dom, 2);
    click(hr);
    expect(String(editing.state.selection)).toBe('cursor(3)');
    composition(editing, 'compositionend', '日本');

    expect(String(editing.state.doc)).toBe('doc(paragraph("ab日本"), horizontal_rule, paragraph("d"))');
    expect(String(editing.state.selection)).toBe('node(horizontal_rule@6)');
    expect(drawnSelected(editing)).toEqual([editing.dom.querySelector('hr')]);
  });

  it('selects an image in another block the same way', () => {
    // 0 <p> 1 a 2 </p> 3 <p> 4 c 5 [img] 6 d 7 </p> 8
    const document_ = doc(p(t('a')), p(t('c'), image(), t('d')));
    const editing = view(document_, TextSelection.create(document_, 2));
    const second = editing.dom.children[1]!;
    const img = second.querySelector('img')!;

    composition(editing, 'compositionstart');
    editing.dom.children[0]!.appendChild(window.document.createTextNode('に'));
    const index = Array.from(second.childNodes).indexOf(img);
    domSelection().setBaseAndExtent(second, index, second, index + 1);
    click(img);
    composition(editing, 'compositionend', '日本');

    expect(String(editing.state.selection)).toBe('node(image@7)');
  });

  it('lets a later click that is not on a node take the place of an earlier one that was', () => {
    const document_ = doc(p(t('ab')), rule(), p(t('d')));
    const editing = view(document_, TextSelection.create(document_, 3));
    composition(editing, 'compositionstart');
    editing.dom.children[0]!.appendChild(window.document.createTextNode('に'));
    click(editing.dom.querySelector('hr')!);
    const last = editing.dom.children[2]!;
    domSelection().setBaseAndExtent(last.firstChild!, 1, last.firstChild!, 1);
    click(last);
    composition(editing, 'compositionend', '日本');

    // The caret is where the second click put it, after "d".
    expect(String(editing.state.selection)).toBe('cursor(9)');
  });

  it('selects nothing when the node clicked was in the block composed in, which the redraw replaced', () => {
    // A stated limit of the composition's own read-back: a point among the
    // input method's nodes says nothing reliable, so the caret goes after the
    // composed text. The node clicked there is gone with the old drawing.
    const document_ = doc(p(t('a'), image(), t('b')));
    const editing = view(document_, TextSelection.create(document_, 2));
    composition(editing, 'compositionstart');
    click(editing.dom.querySelector('img')!);
    composition(editing, 'compositionend', '日本');

    expect(String(editing.state.doc)).toBe('doc(paragraph("a日本", image, "b"))');
    expect(String(editing.state.selection)).toBe('cursor(4)');
  });
});

describe('lines nothing else held', () => {
  // Each of these is a line that could be deleted with every other test still
  // passing. They are pinned here rather than left to whoever deletes one.
  const step = (selection: EditorSelection, document_: Node, dir: -1 | 1) => {
    const tr = EditorState.create(document_, selection).tr();
    return selectHorizontally(tr, dir) ? String(tr.selection) : null;
  };

  it('leaves the arrow to the browser mid-paragraph, even with a rule after the paragraph', () => {
    // 0 <p> 1 a 2 b 3 </p> 4 [hr] 5
    const document_ = doc(p(t('ab')), rule());
    expect(step(TextSelection.create(document_, 2), document_, 1)).toBeNull();
    expect(step(TextSelection.create(document_, 3), document_, 1)).toBe('node(horizontal_rule@4)');
  });

  it('steps from a caret with no text to be in onto a rule inside a container', () => {
    // A document that is a blockquote holding a rule has no text position, so
    // its caret is clamped to 0, outside the blockquote.
    const document_ = doc(quote(rule()));
    expect(step(TextSelection.atStart(document_), document_, 1)).toBe('node(horizontal_rule@1)');
  });

  it('passes over a block atom whose type is not selectable, to the text beyond it', () => {
    const paged = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { content: 'text*', group: 'block' },
        page_break: { group: 'block', selectable: false },
        text: {},
      },
    });
    // 0 <p> 1 a 2 </p> 3 [break] 4 <p> 5 b 6 </p> 7
    const document_ = paged.node('doc', null, [
      paged.node('paragraph', null, [paged.text('a')]),
      paged.node('page_break'),
      paged.node('paragraph', null, [paged.text('b')]),
    ]);
    expect(String(findSelection(document_, 3, 1))).toBe('cursor(5)');
    expect(String(findSelection(document_, 4, -1))).toBe('cursor(2)');
    // A caret in the next textblock is the browser's to put there.
    expect(step(TextSelection.create(document_, 2), document_, 1)).toBeNull();
  });

  it('refuses to fit nothing in at a point, which would be a step that changes nothing', () => {
    const fit = fitSlice(doc(p(t('ab'))), 2, 2, Slice.empty);
    expect(fit.ok).toBe(false);
  });

  it('puts list items fitted in between two items in as items, not as a list of their own', () => {
    // 0 <ul> 1 <li> 2 <p> 3 o 4 n 5 e 6 </p> 7 </li> 8 </ul> 9
    const document_ = doc(ul(li(p(t('one')))));
    const pasted = Slice.maxOpen(Fragment.from(ul(li(p(t('a'))), li(p(t('b'))))));
    const fit = fitSlice(document_, 1, 1, pasted);
    if (!fit.ok) throw new Error(fit.reason);
    const result = new ReplaceStep(fit.from, fit.to, fit.slice).apply(document_);
    expect(result.ok && String(result.doc)).toBe(
      'doc(bullet_list(list_item(paragraph("a")), list_item(paragraph("b")), list_item(paragraph("one"))))',
    );
  });

  it('wraps only in a type that can be made from nothing, so none is opened without an attribute it requires', () => {
    const labelled = new Schema({
      nodes: {
        doc: { content: 'figure+' },
        figure: { content: 'text*', attrs: { label: {} } },
        text: {},
      },
    });
    expect(labelled.nodes['doc']!.contentMatch.findWrapping(labelled.nodes['text']!)).toBeNull();
  });

  it('keeps a pasted image in a schema whose image declares fewer attributes than the rule reads', () => {
    const lean = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'inline*' },
        text: { group: 'inline' },
        image: { group: 'inline', inline: true, attrs: { src: {} } },
      },
    });
    const slice = parseSlice(lean, '<img src="a.png" alt="A" title="T">');
    expect(String(slice.content)).toBe('image');
    expect(slice.content.firstChild!.attrs).toEqual({ src: 'a.png' });
  });
});
