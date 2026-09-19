/**
 * The document model and the schema.
 *
 * Two things are being pinned here. The first is position arithmetic: every
 * later stage — steps, mapping, selection, the DOM bridge — is arithmetic over
 * the integers this file asserts, so a wrong `nodeSize` would show up
 * everywhere at once and be attributed to none of it. The second is that the
 * schema refuses invalid documents at the point of construction rather than
 * reporting them later, which is a promise the package makes and therefore a
 * promise worth a test per way of breaking it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Fragment, Mark, Schema, VERSION, basicSchema, resolve } from '../src/index.ts';

const s = basicSchema;

const doc = (...content: Parameters<typeof s.node>[2] extends infer _ ? any[] : never) =>
  s.node('doc', null, content);
const p = (...content: any[]) => s.node('paragraph', null, content);
const t = (text: string, ...marks: Mark[]) => s.text(text, marks);
const em = s.mark('em');
const strong = s.mark('strong');

describe('position arithmetic', () => {
  it('counts text by character and nodes by their two tokens', () => {
    const node = p(t('abc'));
    expect(node.contentSize).toBe(3);
    expect(node.nodeSize).toBe(5);

    const document = doc(p(t('abc')), p(t('de')));
    expect(document.content.size).toBe(5 + 4);
  });

  it('gives a leaf one position and no interior', () => {
    const rule = s.node('horizontal_rule');
    expect(rule.isLeaf).toBe(true);
    expect(rule.nodeSize).toBe(1);
    expect(doc(rule, p(t('a'))).content.size).toBe(1 + 3);
  });

  it('gives an inline leaf one position inside its textblock', () => {
    const image = s.node('image', { src: 'a.png' });
    const node = p(t('ab'), image, t('cd'));
    expect(node.contentSize).toBe(5);
  });
});

describe('fragment normalisation', () => {
  it('merges adjacent text nodes carrying the same marks', () => {
    const frag = Fragment.from([t('foo'), t('bar')]);
    expect(frag.childCount).toBe(1);
    expect(frag.child(0).text).toBe('foobar');
  });

  it('leaves adjacent text alone when the marks differ', () => {
    const frag = Fragment.from([t('foo'), t('bar', em)]);
    expect(frag.childCount).toBe(2);
  });

  it('merges across a differently-ordered but equal mark set', () => {
    const frag = Fragment.from([t('foo', em, strong), t('bar', strong, em)]);
    expect(frag.childCount).toBe(1);
    expect(frag.child(0).text).toBe('foobar');
  });

  it('drops empty text nodes rather than keeping a zero-width child', () => {
    const frag = Fragment.from([t('foo'), t(''), t('bar', em)]);
    expect(frag.childCount).toBe(2);
    expect(frag.child(0).text).toBe('foo');
  });

  it('merges text that only becomes adjacent after a cut', () => {
    const node = p(t('one'), t('two', em), t('three'));
    const cut = node.cut(3, 6);
    expect(cut.childCount).toBe(1);
    expect(cut.child(0).text).toBe('two');

    const withoutMiddle = Fragment.from([node.child(0), node.child(2)]);
    expect(withoutMiddle.childCount).toBe(1);
    expect(withoutMiddle.child(0).text).toBe('onethree');
  });
});

describe('marks', () => {
  it('keeps a set sorted by the schema rank so equal sets compare equal', () => {
    const one = Mark.setFrom([strong, em]);
    const two = Mark.setFrom([em, strong]);
    expect(Mark.sameSet(one, two)).toBe(true);
    expect(one.map((mark) => mark.type.name)).toEqual(['em', 'strong']);
  });

  it('replaces a mark of the same type rather than holding two', () => {
    const link = s.mark('link', { href: 'a' });
    const other = s.mark('link', { href: 'b' });
    const set = other.addToSet(link.addToSet(Mark.none));
    expect(set.length).toBe(1);
    expect(set[0]!.attrs['href']).toBe('b');
  });

  it('is a no-op when the identical mark is already there', () => {
    const set = em.addToSet(Mark.none);
    expect(em.addToSet(set)).toBe(set);
  });

  it('honours excludes in both directions', () => {
    const code = s.mark('code');
    expect(code.addToSet([em, strong])).toEqual([code]);
    expect(em.addToSet([code])).toEqual([code]);
  });

  it('removes by value, not by identity', () => {
    const set = Mark.setFrom([em, strong]);
    expect(s.mark('em').removeFromSet(set).length).toBe(1);
  });

  it('refuses a set whose marks exclude each other, as adding them one at a time would', () => {
    // `code` excludes every other mark, and a link excludes a second link.
    // Handed over whole rather than added one by one, the same set would be
    // text that is code and emphasised, or one link going to two places.
    const code = s.mark('code');
    const linkA = s.mark('link', { href: 'a' });
    const linkB = s.mark('link', { href: 'b' });

    expect(() => Mark.setFrom([code, em])).toThrow(RangeError);
    expect(() => s.text('x', [code, em])).toThrow(RangeError);
    expect(() => s.text('x', [linkA, linkB])).toThrow(RangeError);
    expect(() => s.node('paragraph', null, [s.text('x', [em, code])])).toThrow(RangeError);
  });

  it('takes the same mark twice as the mark once', () => {
    expect(Mark.setFrom([em, s.mark('em')])).toEqual([em]);
  });
});

describe('schema refusal at construction', () => {
  it('refuses content the expression does not allow', () => {
    expect(() => s.node('doc', null, [t('bare text')])).toThrow(/Invalid content for node doc/);
  });

  it('refuses a document that stops in an incomplete state', () => {
    expect(() => s.node('doc')).toThrow(/Invalid content/);
    expect(() => s.node('bullet_list')).toThrow(/Invalid content/);
  });

  it('refuses a mark the parent forbids', () => {
    expect(() => s.node('code_block', null, [t('x', em)])).toThrow(/Invalid content/);
    expect(() => s.node('paragraph', null, [t('x', em)])).not.toThrow();
  });

  it('refuses an unknown attribute and a missing required one', () => {
    expect(() => s.node('heading', { levl: 2 }, [t('x')])).toThrow(/Unknown attribute/);
    expect(() => s.node('image', {})).toThrow(/required attribute 'src'/);
  });

  it('refuses an unknown type or group in a content expression', () => {
    expect(
      () => new Schema({ nodes: { doc: { content: 'nonsense+' }, text: {} } }),
    ).toThrow(/No node type or group named 'nonsense'/);
  });

  it('refuses a schema with no text node', () => {
    expect(() => new Schema({ nodes: { doc: { content: 'doc*' } } })).toThrow(/must declare a "text" node/);
  });

  it('refuses a schema whose top node type is not declared, rather than picking another', () => {
    expect(() => new Schema({ nodes: { page: { content: 'text*' }, text: {} } })).toThrow(/top node type 'doc'/);
    expect(new Schema({ nodes: { page: { content: 'text*' }, text: {} }, topNode: 'page' }).topNodeType.name).toBe('page');
  });

  it('does not let the rules of a type be changed once the schema is built', () => {
    // Every document made from a schema was checked against these. A type that
    // could be given other rules afterwards would make all of them documents
    // nothing had checked.
    const schema = new Schema({
      nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*', marks: '' }, text: {} },
      marks: { em: {}, code: { excludes: '_' } },
    });
    const paragraph = schema.nodes['paragraph']! as { markSet: unknown; contentMatch: unknown };
    const code = schema.marks['code']! as { excluded: unknown };

    expect(() => void (paragraph.markSet = null)).toThrow(TypeError);
    expect(() => void (paragraph.contentMatch = schema.nodes['doc']!.contentMatch)).toThrow(TypeError);
    expect(() => void (code.excluded = [])).toThrow(TypeError);

    const marked = schema.text('x', [schema.mark('em')]);
    expect(() => schema.node('paragraph', null, [marked])).toThrow(/Invalid content/);
  });
});

describe('content expressions', () => {
  const expr = (content: string) =>
    new Schema({
      nodes: {
        doc: { content },
        paragraph: { content: 'inline*', group: 'block' },
        heading: { content: 'inline*', group: 'block' },
        text: { group: 'inline' },
      },
    });

  it('matches a sequence with a required head', () => {
    const schema = expr('heading paragraph*');
    const heading = schema.node('heading', null, [schema.text('h')]);
    const para = schema.node('paragraph', null, [schema.text('p')]);

    expect(() => schema.node('doc', null, [heading])).not.toThrow();
    expect(() => schema.node('doc', null, [heading, para, para])).not.toThrow();
    expect(() => schema.node('doc', null, [para])).toThrow(/Invalid content/);
  });

  it('matches alternation and grouping', () => {
    const schema = expr('(heading | paragraph)+');
    const heading = schema.node('heading', null, []);
    expect(() => schema.node('doc', null, [heading, heading])).not.toThrow();
    expect(() => schema.node('doc', null, [])).toThrow(/Invalid content/);
  });

  it('treats ? as optional exactly once', () => {
    const schema = expr('heading? paragraph');
    const heading = schema.node('heading', null, []);
    const para = schema.node('paragraph', null, []);
    expect(() => schema.node('doc', null, [para])).not.toThrow();
    expect(() => schema.node('doc', null, [heading, para])).not.toThrow();
    expect(() => schema.node('doc', null, [heading, heading, para])).toThrow(/Invalid content/);
  });

  it('rejects a malformed expression when the schema is built', () => {
    expect(() => expr('paragraph (heading')).toThrow(/Missing '\)'/);
    expect(() => expr('paragraph |')).toThrow(/Empty alternative/);
    expect(() => expr('paragraph #')).toThrow(/Unexpected character/);
  });
});

describe('normalisation by filling', () => {
  it('gives a list item the paragraph its schema requires', () => {
    const item = s.nodeType('list_item').createAndFill();
    expect(item).not.toBeNull();
    expect(item!.childCount).toBe(1);
    expect(item!.child(0).type.name).toBe('paragraph');
  });

  it('fills before given content as well as after it', () => {
    const quote = s.node('blockquote', null, [p(t('x'))]);
    const item = s.nodeType('list_item').createAndFill(null, [quote]);
    expect(item!.child(0).type.name).toBe('paragraph');
    expect(item!.child(1).type.name).toBe('blockquote');
  });

  it('makes an empty document legal', () => {
    const empty = s.topNodeType.createAndFill();
    expect(empty!.childCount).toBe(1);
    expect(empty!.child(0).type.name).toBe('paragraph');
  });

  it('fills with the shortest run that works, not the first one found', () => {
    // Searching deep along the first alternative before trying the next finds
    // `a b c` and stops, when `d` alone would do.
    const schema = new Schema({
      nodes: {
        doc: { content: '(a b c) | d' },
        a: {},
        b: {},
        c: {},
        d: {},
        text: {},
      },
    });
    expect(String(schema.topNodeType.createAndFill())).toBe('doc(d)');
  });

  it('fills with the run that comes first, among runs of the same length', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: '(a b) | (c d)' },
        a: {},
        b: {},
        c: {},
        d: {},
        text: {},
      },
    });
    expect(String(schema.topNodeType.createAndFill())).toBe('doc(a, b)');
  });

  it('refuses to conjure a type with a required attribute', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'image' },
        image: { attrs: { src: {} } },
        text: {},
      },
    });
    expect(schema.topNodeType.createAndFill()).toBeNull();
  });
});

describe('resolving a position', () => {
  const document = doc(p(t('abc')), s.node('blockquote', null, [p(t('de'))]));

  it('reports depth, parent and index', () => {
    const $pos = resolve(document, 2);
    expect($pos.depth).toBe(1);
    expect($pos.parent.type.name).toBe('paragraph');
    expect($pos.parentOffset).toBe(1);
    expect($pos.textOffset).toBe(1);
    expect($pos.index(0)).toBe(0);
  });

  it('reports the boundaries of every enclosing node', () => {
    const $pos = resolve(document, 8);
    expect($pos.depth).toBe(2);
    expect($pos.node(1).type.name).toBe('blockquote');
    expect($pos.start(2)).toBe(7);
    expect($pos.end(2)).toBe(9);
    expect($pos.before(2)).toBe(6);
    expect($pos.after(2)).toBe(10);
    expect($pos.before(1)).toBe(5);
    expect($pos.after(1)).toBe(11);
  });

  it('distinguishes index from indexAfter inside a child', () => {
    const withTwo = p(t('ab'), t('cd', em));
    expect(resolve(doc(withTwo), 2).index()).toBe(0);
    expect(resolve(doc(withTwo), 2).indexAfter()).toBe(1);
    // Position 3 sits exactly between the two text nodes rather than inside
    // either, and there `indexAfter` is `index`: the answer to "where would an
    // insertion go" is the boundary itself. One more than `index` is what the
    // first pair above asserts, and that is the case where the position is
    // inside a child.
    expect(resolve(doc(withTwo), 3).index()).toBe(1);
    expect(resolve(doc(withTwo), 3).indexAfter()).toBe(1);
  });

  it('cuts the node before and after when the position is inside one', () => {
    const $pos = resolve(document, 3);
    expect($pos.nodeBefore!.text).toBe('ab');
    expect($pos.nodeAfter!.text).toBe('c');
  });

  it('finds the deepest shared node of two positions', () => {
    expect(resolve(document, 8).sharedDepth(9)).toBe(2);
    expect(resolve(document, 8).sharedDepth(2)).toBe(0);
  });

  it('refuses a position outside the document', () => {
    expect(() => resolve(document, -1)).toThrow(/outside a document/);
    expect(() => resolve(document, 100)).toThrow(/outside a document/);
  });
});

describe('the marks a position inherits', () => {
  it('takes the marks of the text it is inside', () => {
    const document = doc(p(t('ab'), t('cd', em)));
    expect(resolve(document, 4).marks()).toEqual([em]);
  });

  it('continues an inclusive mark at its trailing boundary', () => {
    const document = doc(p(t('ab', em)));
    expect(resolve(document, 3).marks()).toEqual([em]);
  });

  it('drops a non-inclusive mark at its trailing boundary', () => {
    const link = s.mark('link', { href: 'https://example.com' });
    const document = doc(p(t('ab', link)));
    expect(resolve(document, 3).marks()).toEqual([]);
    expect(resolve(document, 2).marks()).toEqual([link]);
  });

  it('keeps a non-inclusive mark that continues into the next node', () => {
    const link = s.mark('link', { href: 'https://example.com' });
    const document = doc(p(t('ab', link), t('cd', link, em)));
    expect(resolve(document, 3).marks().map((m) => m.type.name)).toEqual(['link']);
  });
});

describe('reading text back out', () => {
  it('joins blocks with a separator and inline content without one', () => {
    const document = doc(p(t('one')), p(t('two')));
    expect(document.textBetween(0, document.content.size, ' | ')).toBe('one | two');
    expect(document.textContent).toBe('onetwo');
  });

  it('cuts partial text at both ends of a range', () => {
    const document = doc(p(t('hello')));
    expect(document.textBetween(2, 5)).toBe('ell');
  });
});

describe('the package', () => {
  it('reports the version it is published as', () => {
    // A constant nothing compares against the manifest drifts from it at the
    // first release, and then says the wrong thing to everything that asks.
    const pkg = JSON.parse(readFileSync(`${import.meta.dirname}/../package.json`, 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it('declares no dependency its source never imports', () => {
    // A dependency nothing imports is still installed by everyone who installs
    // this, and here it would be the whole of the framework for an editor that
    // runs without it.
    const pkg = JSON.parse(readFileSync(`${import.meta.dirname}/../package.json`, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const src = `${import.meta.dirname}/../src`;
    const source = readdirSync(src)
      .map((file) => readFileSync(`${src}/${file}`, 'utf8'))
      .join('\n');

    const unused = Object.keys(pkg.dependencies ?? {}).filter((name) => !source.includes(`from '${name}`));
    expect(unused).toEqual([]);
  });

  it('exports no type under a name the DOM has for something else', () => {
    // A file that imports such a type can no longer name the DOM's own, and a
    // view's host is the file most likely to want both. `Node` is shared on
    // purpose — the document's node is what this package is about — and it is
    // a class, so it is not among these.
    const index = readFileSync(`${import.meta.dirname}/../src/index.ts`, 'utf8');
    const types = [...index.matchAll(/\btype (\w+)(?=,| \})/g)].map((match) => match[1]!);

    expect(types).toContain('EditorViewOptions');
    expect(types.filter((name) => name in globalThis)).toEqual([]);
  });
});
