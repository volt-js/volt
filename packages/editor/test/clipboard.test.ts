/**
 * Reading pasted HTML through the schema.
 *
 * What a clipboard holds is whatever the page it was copied from rendered, so
 * the parser's job is less "understand HTML" than "keep what the schema can
 * hold and let nothing else in". The cases below are of both kinds: structure
 * that has to survive — paragraphs, headings, lists, a code block's
 * whitespace, the marks on a run of text — and things that must not: a
 * script, a style sheet, an attribute the schema never declared, a link whose
 * address would run code, a page's wrapper elements, and the bold that one
 * well-known editor wraps around everything it copies.
 *
 * The slice a parse produces is open as deep as its first and last blocks go,
 * which is what lets a paste join the paragraph the caret is in; the tests at
 * the end put those slices into documents through the same command a paste
 * runs.
 */

import { describe, expect, it } from 'vitest';
import { Schema, basicSchema } from '../src/index.ts';
import type { Mark } from '../src/index.ts';
import { basicParseRules, insertSlice, parseSlice, pasteHTML } from '../src/clipboard.ts';
import { EditorHistory } from '../src/history.ts';
import type { Node } from '../src/node.ts';
import { NodeSelection } from '../src/selection.ts';
import { EditorState, TextSelection } from '../src/state.ts';

const s = basicSchema;
const doc = (...content: Node[]) => s.node('doc', null, content);
const p = (...content: Node[]) => s.node('paragraph', null, content);
const t = (text: string, ...marks: Mark[]) => s.text(text, marks);

const parsed = (html: string) => String(parseSlice(s, html));

describe('parsing pasted HTML into a slice', () => {
  it('keeps paragraphs, and opens the slice into the first and last of them', () => {
    expect(parsed('<p>one</p><p>two</p>')).toBe('paragraph("one"), paragraph("two")(1,1)');
  });

  it('keeps headings at their level, and marks on the text', () => {
    const slice = parseSlice(s, '<h2>Title</h2><p>a <strong>bold</strong> <em>word</em></p>');
    expect(String(slice)).toBe('heading("Title"), paragraph("a ", strong("bold"), " ", em("word"))(1,1)');
    expect(slice.content.child(0).attrs['level']).toBe(2);
  });

  it('reads b, i and code as the marks they render as', () => {
    expect(parsed('<p><b>x</b><i>y</i><code>z</code></p>')).toBe('paragraph(strong("x"), em("y"), code("z"))(1,1)');
  });

  it('nests marks on text inside more than one', () => {
    const slice = parseSlice(s, '<p><em><strong>x</strong></em></p>');
    expect(slice.content.child(0).child(0).marks.map((mark) => mark.type.name)).toEqual(['em', 'strong']);
  });

  it('keeps a list a list, putting bare item text in the paragraph an item must start with', () => {
    expect(parsed('<ul><li>a</li><li><p>b</p></li></ul>')).toBe(
      'bullet_list(list_item(paragraph("a")), list_item(paragraph("b")))(3,3)',
    );
    // The whitespace a page puts between its items is layout, not an item.
    expect(parsed('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>')).toBe(
      'bullet_list(list_item(paragraph("a")), list_item(paragraph("b")))(3,3)',
    );
    const ordered = parseSlice(s, '<ol start="4"><li>x</li></ol>');
    expect(ordered.content.child(0).attrs['start']).toBe(4);
  });

  it('keeps a list nested in an item', () => {
    expect(parsed('<ul><li>a<ul><li>b</li></ul></li></ul>')).toBe(
      'bullet_list(list_item(paragraph("a"), bullet_list(list_item(paragraph("b")))))(3,5)',
    );
  });

  it('keeps a code block\'s whitespace as it was, and drops the marks it forbids', () => {
    expect(parsed('<pre><code>let x = 1;\n  <b>y</b>  </code></pre>')).toBe(
      'code_block("let x = 1;\\n  y  ")(1,1)',
    );
    // A line break in preformatted text is a newline, not a hard break the
    // code block would have to be split around.
    expect(parsed('<pre>a<br>b</pre>')).toBe('code_block("a\\nb")(1,1)');
  });

  it('collapses whitespace elsewhere, as the page it came from rendered it', () => {
    expect(parsed('<p>  a \n\t b  </p>')).toBe('paragraph("a b")(1,1)');
    expect(parsed('<p>a</p>\n  <p>b</p>')).toBe('paragraph("a"), paragraph("b")(1,1)');
  });

  it('turns a line break into a hard break, and a rule and an image into theirs', () => {
    expect(parsed('<p>a<br>b</p><hr><p><img src="/c.png" alt="c"></p>')).toBe(
      'paragraph("a", hard_break, "b"), horizontal_rule, paragraph(image)(1,1)',
    );
    const image = parseSlice(s, '<img src="/c.png" alt="a cat" title="t" width="40">').content.child(0);
    expect(image.attrs).toEqual({ src: '/c.png', alt: 'a cat', title: 't' });
  });

  it('drops the break a browser adds where a copy ended at a line end', () => {
    expect(parsed('<p>a</p><p>b</p><br class="Apple-interchange-newline">')).toBe(
      'paragraph("a"), paragraph("b")(1,1)',
    );
  });

  it('keeps a link and its address', () => {
    const slice = parseSlice(s, '<p><a href="https://voltjs.dev" title="Volt">here</a></p>');
    const link = slice.content.child(0).child(0).marks[0]!;
    expect(link.type.name).toBe('link');
    expect(link.attrs).toEqual({ href: 'https://voltjs.dev', title: 'Volt' });
  });

  it('drops a link or an image whose address would run code, and keeps the text', () => {
    expect(parsed('<p><a href="javascript:alert(1)">x</a></p>')).toBe('paragraph("x")(1,1)');
    expect(parsed('<p><a href=" JavaScript:alert(1)">x</a></p>')).toBe('paragraph("x")(1,1)');
    // A browser ignores a tab or a newline inside the scheme, so this runs too.
    expect(parsed('<p><a href="java&#9;script:alert(1)">x</a></p>')).toBe('paragraph("x")(1,1)');
    expect(parsed('<p><a href="java&#10;script:alert(1)">x</a></p>')).toBe('paragraph("x")(1,1)');
    expect(parsed('<p><a href="/relative">x</a><a href="mailto:a@b.c">y</a></p>')).toBe(
      'paragraph(link("x"), link("y"))(1,1)',
    );
    expect(parsed('<p>a<img src="javascript:alert(1)">b</p>')).toBe('paragraph("ab")(1,1)');
    expect(parsed('<p>a<img src="data:image/png;base64,AAAA">b</p>')).toBe('paragraph("a", image, "b")(1,1)');
  });

  it('lets nothing run or load while it reads', () => {
    const before = (globalThis as { __pasted?: number }).__pasted;
    parseSlice(s, '<img src="x" onerror="globalThis.__pasted = 1"><script>globalThis.__pasted = 2</script>');
    expect((globalThis as { __pasted?: number }).__pasted).toBe(before);
  });

  it('drops scripts, styles and the page around a copied fragment', () => {
    expect(
      parsed(
        '<html><head><meta charset="utf-8"><style>p { color: red }</style><title>x</title></head>' +
          '<body><!--StartFragment--><p>kept</p><script>bad()</script><!--EndFragment--></body></html>',
      ),
    ).toBe('paragraph("kept")(1,1)');
  });

  it('reads through elements it has no rule for', () => {
    expect(parsed('<p><span class="x">a<u>b</u></span></p>')).toBe('paragraph("ab")(1,1)');
  });

  it('starts a new paragraph at each block-level element it has no rule for', () => {
    expect(parsed('<div>a</div><div>b<section>c</section></div>')).toBe(
      'paragraph("a"), paragraph("b"), paragraph("c")(1,1)',
    );
  });

  it('ignores the bold a document editor wraps around everything it copies', () => {
    // It marks the wrapper `font-weight: normal`, which is how it says the
    // wrapper is not bold.
    expect(parsed('<b style="font-weight:normal;" id="docs-internal-guid-1"><p>plain</p></b>')).toBe(
      'paragraph("plain")(1,1)',
    );
  });

  it('keeps text outside any block as inline content, closed at both ends', () => {
    expect(parsed('just <em>text</em>')).toBe('"just ", em("text")(0,0)');
  });

  it('wraps what a container cannot hold directly in what it can', () => {
    expect(parsed('<blockquote>quoted</blockquote>')).toBe('blockquote(paragraph("quoted"))(2,2)');
    expect(parsed('<ul>loose</ul>')).toBe('bullet_list(list_item(paragraph("loose")))(3,3)');
  });

  it('reads only the node types and marks a schema has', () => {
    const plain = new Schema({
      nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} },
      marks: { em: {} },
    });
    expect(String(parseSlice(plain, '<h1>a</h1><ul><li>b</li></ul><p><b>c</b><i>d</i></p>'))).toBe(
      'paragraph("a"), paragraph("b"), paragraph("c", em("d"))(1,1)',
    );
  });

  it('takes rules of its own for a schema of its own', () => {
    const notes = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { content: 'inline*', group: 'block' },
        callout: { content: 'paragraph+', group: 'block', attrs: { tone: { default: 'info' } } },
        text: { group: 'inline' },
      },
    });
    const slice = parseSlice(notes, '<aside data-tone="warn"><p>careful</p></aside>', {
      rules: {
        ...basicParseRules,
        aside: { node: 'callout', attrs: (element) => ({ tone: element.getAttribute('data-tone') ?? 'info' }) },
      },
    });
    expect(String(slice)).toBe('callout(paragraph("careful"))(2,2)');
    expect(slice.content.child(0).attrs['tone']).toBe('warn');
  });

  it('keeps the content of an element whose node cannot be made', () => {
    // A callout must say which tone it has, and this rule does not read one,
    // so no callout can be made — but the paragraph inside it can.
    const notes = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { content: 'inline*', group: 'block' },
        callout: { content: 'paragraph+', group: 'block', attrs: { tone: {} } },
        note: { content: 'text*', group: 'block', attrs: { tone: {} } },
        text: { group: 'inline' },
      },
      marks: { em: {} },
    });
    const rules = { ...basicParseRules, aside: { node: 'callout' }, figure: { node: 'note' } };
    expect(String(parseSlice(notes, '<aside><p><i>kept</i></p></aside>', { rules }))).toBe(
      'paragraph(em("kept"))(1,1)',
    );
    // Text given up this way keeps the marks it had.
    expect(String(parseSlice(notes, '<figure>a <i>b</i></figure>', { rules }))).toBe('"a ", em("b")(0,0)');
  });

  it('is empty for HTML with nothing the schema can hold', () => {
    expect(parseSlice(s, '<script>x()</script><style>p{}</style>').size).toBe(0);
    expect(parseSlice(s, '   ').size).toBe(0);
  });
});

describe('pasting a slice at the selection', () => {
  const at = (document: Node, anchor: number, head = anchor) =>
    EditorState.create(document, TextSelection.create(document, anchor, head)).tr();

  it('joins pasted paragraphs onto the text either side of the caret, and puts the caret after them', () => {
    const tr = at(doc(p(t('abcd'))), 3);
    expect(pasteHTML(tr, '<p>one</p><p>two</p>')).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("abone"), paragraph("twocd"))');
    // After "two", before "cd".
    expect(String(tr.selection)).toBe('cursor(11)');
    expect(tr.steps).toHaveLength(1);
  });

  it('replaces the selection it is pasted over', () => {
    const tr = at(doc(p(t('abcd'))), 2, 4);
    expect(pasteHTML(tr, '<em>X</em>')).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("a", em("X"), "d"))');
    expect(String(tr.selection)).toBe('cursor(3)');
  });

  it('pastes over a selection that spans two paragraphs', () => {
    const tr = at(doc(p(t('ab')), p(t('cd'))), 2, 6);
    expect(pasteHTML(tr, '<p>X</p>')).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("aXd"))');
  });

  it('keeps a pasted list a list in an empty paragraph', () => {
    const tr = at(doc(p()), 1);
    expect(pasteHTML(tr, '<ul><li>a</li><li>b</li></ul>')).toBe(true);
    expect(String(tr.doc)).toBe('doc(bullet_list(list_item(paragraph("a")), list_item(paragraph("b"))))');
    expect(String(tr.selection)).toBe('cursor(9)');
  });

  it('leaves the caret at the end of a pasted list, not in the block after it', () => {
    const tr = at(doc(p(), p(t('z'))), 1);
    expect(pasteHTML(tr, '<ul><li>a</li><li>b</li></ul>')).toBe(true);
    expect(String(tr.doc)).toBe(
      'doc(bullet_list(list_item(paragraph("a")), list_item(paragraph("b"))), paragraph("z"))',
    );
    // After "b", rather than before "z".
    expect(String(tr.selection)).toBe('cursor(9)');
  });

  it('replaces a selected node with what is pasted', () => {
    const document = doc(p(t('a'), s.node('image', { src: 'x.png' }), t('b')));
    const tr = EditorState.create(document, NodeSelection.create(document, 2)).tr();
    expect(pasteHTML(tr, 'X')).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("aXb"))');
    expect(String(tr.selection)).toBe('cursor(3)');
  });

  it('puts the caret after a pasted rule in the block that follows it', () => {
    const tr = at(doc(p(t('ab')), p(t('cd'))), 3);
    expect(pasteHTML(tr, '<hr>')).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("ab"), horizontal_rule, paragraph("cd"))');
    expect(String(tr.selection)).toBe('cursor(6)');
  });

  it('selects a pasted rule that nothing follows, since there is no text after it to put a caret in', () => {
    const tr = at(doc(p(t('ab'))), 3);
    expect(pasteHTML(tr, '<hr>')).toBe(true);
    expect(String(tr.doc)).toBe('doc(paragraph("ab"), horizontal_rule)');
    expect(String(tr.selection)).toBe('node(horizontal_rule@4)');
  });

  it('ends the undo unit before it and after it', () => {
    const tr = at(doc(p(t('ab'))), 2);
    pasteHTML(tr, '<p>x</p>');
    expect(tr.historyClosed).toBe(true);
  });

  it('is taken back by one undo, caret and all', () => {
    const history = new EditorHistory({ now: () => 0 });
    const before = doc(p(t('abcd')));
    let state = EditorState.create(before, TextSelection.create(before, 3));
    const paste = state.tr();
    pasteHTML(paste, '<p>one</p><ul><li>two</li></ul>');
    state = state.apply(paste);
    history.record(paste);

    const undo = history.undo(state)!;
    state = state.apply(undo);
    history.record(undo);
    expect(state.doc.eq(before)).toBe(true);
    expect(String(state.selection)).toBe('cursor(3)');
  });

  it('declines a paste with nothing in it, and leaves the transaction alone', () => {
    const tr = at(doc(p(t('ab'))), 2);
    expect(pasteHTML(tr, '<script>x()</script>')).toBe(false);
    expect(insertSlice(tr, parseSlice(s, ''))).toBe(false);
    expect(tr.changed).toBe(false);
  });
});
