import type { Mark, Node as DocNode } from '@voltdev/editor';

/**
 * A document as markup, for a server to write before the engine loads.
 *
 * The engine draws a document through renderers that build elements, and a
 * server has no document to build them in, so this writes the same elements
 * as text: the tags the starter renderers make, the starter marks nested the
 * way the view nests them — the first mark outermost — and any type neither
 * names as the view's fallback writes it, a `div` or a `span` tagged with the
 * type's name. A reader sees the document the editor will draw over it, and
 * the editor, once it loads, draws it again from the model and keeps none of
 * this.
 *
 * Every piece of text and every attribute is escaped: the document is data,
 * and the server is the one place it is turned into markup by hand. A link
 * whose address would run script is written without one, and `<v-editor>`
 * hands its view a link renderer that leaves it off the same way, so this is
 * what the engine draws there too.
 */
export function documentMarkup(doc: DocNode): string {
  let out = '';
  doc.content.forEach((child) => {
    out += nodeMarkup(child);
  });
  return out;
}

function nodeMarkup(node: DocNode): string {
  if (node.isText) return marked(escapeText(node.text ?? ''), node.marks);

  const { tag, attrs, inner } = element(node);
  const open = `<${tag}${attributes(attrs)}>`;
  // A leaf of the page's own schema is the view's fallback, an empty `span`
  // or `div`, and those are not void: left open, a browser puts everything
  // after it inside it — the words after a mention, the blocks after a rule.
  if (node.isLeaf) return voidTags.has(tag) ? open : `${open}</${tag}>`;

  let content = '';
  node.content.forEach((child) => {
    content += nodeMarkup(child);
  });
  // An empty block has no line box to put a caret on or read, and a block
  // ending in a break has no line after it: the view props both open with a
  // `<br>`, so this does as well and the two draw the same height.
  if (node.isTextblock && (node.childCount === 0 || node.lastChild?.type.name === 'hard_break')) {
    content += '<br>';
  }
  const body = inner ? `<${inner}>${content}</${inner}>` : content;
  return `${open}${body}</${tag}>`;
}

/** The starter leaves' elements, which take no closing tag. */
const voidTags: ReadonlySet<string> = new Set(['img', 'hr', 'br']);

interface Element {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  /** The element its content goes in, when that is not the element itself. */
  readonly inner?: string;
}

function element(node: DocNode): Element {
  switch (node.type.name) {
    case 'paragraph':
      return { tag: 'p', attrs: {} };
    case 'heading':
      return { tag: `h${headingLevel(node)}`, attrs: {} };
    case 'blockquote':
      return { tag: 'blockquote', attrs: {} };
    case 'bullet_list':
      return { tag: 'ul', attrs: {} };
    case 'ordered_list': {
      const start = Number(node.attrs['start']);
      return { tag: 'ol', attrs: Number.isFinite(start) && start !== 1 ? { start: String(start) } : {} };
    }
    case 'list_item':
      return { tag: 'li', attrs: {} };
    case 'code_block':
      return { tag: 'pre', attrs: {}, inner: 'code' };
    case 'horizontal_rule':
      return { tag: 'hr', attrs: {} };
    case 'hard_break':
      return { tag: 'br', attrs: {} };
    case 'image': {
      const attrs: Record<string, string> = { src: String(node.attrs['src'] ?? '') };
      // Left off rather than emptied, as the view does: no alt and `alt=""`
      // say different things to a screen reader.
      if (typeof node.attrs['alt'] === 'string') attrs['alt'] = node.attrs['alt'];
      if (typeof node.attrs['title'] === 'string') attrs['title'] = node.attrs['title'];
      return { tag: 'img', attrs };
    }
    default:
      return { tag: node.isInline ? 'span' : 'div', attrs: { 'data-node-type': node.type.name } };
  }
}

function headingLevel(node: DocNode): number {
  const level = Number(node.attrs['level']);
  if (!Number.isFinite(level)) return 1;
  return Math.min(6, Math.max(1, Math.trunc(level)));
}

function marked(text: string, marks: readonly Mark[]): string {
  let out = text;
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i]!;
    const { tag, attrs } = markElement(mark);
    out = `<${tag}${attributes(attrs)}>${out}</${tag}>`;
  }
  return out;
}

function markElement(mark: Mark): Element {
  switch (mark.type.name) {
    case 'em':
      return { tag: 'em', attrs: {} };
    case 'strong':
      return { tag: 'strong', attrs: {} };
    case 'code':
      return { tag: 'code', attrs: {} };
    case 'link': {
      const href = String(mark.attrs['href'] ?? '');
      const attrs: Record<string, string> = runsScript(href) ? {} : { href };
      if (typeof mark.attrs['title'] === 'string') attrs['title'] = mark.attrs['title'];
      return { tag: 'a', attrs };
    }
    default:
      return { tag: 'span', attrs: { 'data-mark-type': mark.type.name } };
  }
}

/**
 * Whether following an address would run something rather than go somewhere.
 *
 * Escaping keeps a document's text out of the markup's structure, but a link
 * is an instruction to the browser: until the engine loads, nothing here is
 * editable, so a press on it is followed, and a document is often something
 * one reader wrote and another opens. So a link keeps its address only when
 * it goes somewhere — a relative address, `http`, `https`, `mailto` or `tel`,
 * the same list `@voltdev/editor`'s paste lets in — and is otherwise left as
 * an `<a>` with none, which reads the same and goes nowhere. Browsers ignore
 * whitespace and control characters inside a scheme, so `java\tscript:`
 * runs, and those are taken out before the scheme is read.
 */
export function runsScript(address: string): boolean {
  const compact = address.replace(/[\u0000- \u007f]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
  if (scheme === undefined) return false;
  return !['http', 'https', 'mailto', 'tel'].includes(scheme);
}

function attributes(attrs: Readonly<Record<string, string>>): string {
  return Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');
}

function escapeText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}
