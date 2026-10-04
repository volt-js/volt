/**
 * The clipboard, inbound: HTML read through the schema into a slice, and the
 * slice put in at the selection.
 *
 * **Parsing is a whitelist, and the schema is the whitelist.** A pasted page
 * brings scripts, style sheets, tracking attributes, wrapper elements and
 * formatting the document has no notion of. None of it is filtered out here:
 * it is simply never let in. An element becomes a node or a mark only through
 * a rule naming a type the schema declares, and only the attributes that rule
 * reads — and the schema declares — are carried; everything else contributes
 * at most its text. That is what paste sanitisation means in a model that
 * refuses invalid documents at construction: there is nowhere for anything
 * else to go. Two things a rule still has to check, because the schema cannot:
 * a link or an image whose address would run script is refused, and the bold
 * wrapper one well-known document editor puts around everything it copies,
 * marked `font-weight: normal`, is read as the plain text it is.
 *
 * The HTML is parsed into an inert `template`, so nothing in it runs or loads
 * while it is read — an `onerror` on an image is an attribute, not a handler.
 *
 * **What the schema cannot hold where it was put is moved, not dropped.** Text
 * directly in a list is wrapped in an item and a paragraph; a block-level
 * element with no rule — a `div`, a table cell — starts a paragraph of its
 * own, so text that was laid out as separate blocks is not run together. A
 * node the schema has nowhere for at all gives up its content to whatever can
 * hold it.
 *
 * The slice comes out open as far as its first and last blocks go, which is
 * what lets the first pasted paragraph join the one the caret is in.
 * `insertSlice` then places it as slice.ts describes, as one step and one undo
 * unit, with the caret after what went in. Plain text is not this file's: a
 * paste with no HTML still arrives as text through input.ts and
 * `insertPlainText`, as it did.
 */

import type { ContentMatch } from './content.js';
import { Mark, type Attrs } from './mark.js';
import { Fragment, Node, Slice } from './node.js';
import type { NodeType, Schema } from './schema.js';
import { EditorSelection } from './selection.js';
import { placeSlice } from './slice.js';
import type { EditorTransaction } from './state.js';

/**
 * How one HTML element is read. A rule names a node type or a mark type by
 * name, and does nothing in a schema without that type.
 */
export interface ParseRule {
  /** The node type the element becomes. */
  readonly node?: string;
  /** The mark the element puts on the inline content inside it. */
  readonly mark?: string;
  /** Drop the element and everything in it. */
  readonly ignore?: boolean;
  /**
   * The node's or mark's attributes, read off the element — or `false` when
   * this element should not become one after all, and is read as though it had
   * no rule. Attributes the type does not declare are left out.
   */
  readonly attrs?: (element: Element) => Attrs | false | null;
  /** Keep whitespace and line breaks as they are, as `<pre>` does. */
  readonly preserveWhitespace?: boolean;
}

/** Rules by lower-case tag name. */
export type ParseRules = Readonly<Record<string, ParseRule>>;

/**
 * Whether an address is one a pasted link or image may carry.
 *
 * A relative address has no scheme and is kept. Otherwise the scheme has to be
 * on the list; `javascript:` and its relatives are what the list is for.
 * Browsers ignore ASCII whitespace and control characters inside a scheme —
 * `java\tscript:` runs — so those are taken out before the scheme is read.
 */
function safeAddress(value: string, image: boolean): boolean {
  const compact = value.replace(/[\u0000-\u0020\u007f]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
  if (scheme === undefined) return true;
  if (scheme === 'http' || scheme === 'https') return true;
  if (image) return scheme === 'data' && /^data:image\//i.test(compact);
  return scheme === 'mailto' || scheme === 'tel';
}

/** Bold, unless the element says outright that it is not. */
function boldUnlessNormal(element: Element): null | false {
  const weight = (element as HTMLElement).style?.fontWeight ?? '';
  return /^(normal|[1-4]00)$/.test(weight) ? false : null;
}

const ignore: ParseRule = { ignore: true };
const heading = (level: number): ParseRule => ({ node: 'heading', attrs: () => ({ level }) });

/**
 * Rules for the starter schema's names. They apply to any schema using those
 * names, and a rule whose type a schema lacks is skipped.
 */
export const basicParseRules: ParseRules = {
  p: { node: 'paragraph' },
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
  blockquote: { node: 'blockquote' },
  pre: { node: 'code_block', preserveWhitespace: true },
  ul: { node: 'bullet_list' },
  ol: {
    node: 'ordered_list',
    attrs: (element) => {
      const start = Number(element.getAttribute('start'));
      return { start: element.hasAttribute('start') && Number.isInteger(start) ? start : 1 };
    },
  },
  li: { node: 'list_item' },
  hr: { node: 'horizontal_rule' },
  // The break a browser adds after a copied block that ended at a line end is
  // where the copy stopped, not a line break in what was copied.
  br: { node: 'hard_break', attrs: (element) => (element.classList.contains('Apple-interchange-newline') ? false : null) },
  img: {
    node: 'image',
    attrs: (element) => {
      const src = element.getAttribute('src');
      if (!src || !safeAddress(src, true)) return false;
      return { src, alt: element.getAttribute('alt'), title: element.getAttribute('title') };
    },
  },
  em: { mark: 'em' },
  i: { mark: 'em' },
  strong: { mark: 'strong', attrs: boldUnlessNormal },
  b: { mark: 'strong', attrs: boldUnlessNormal },
  code: { mark: 'code' },
  a: {
    mark: 'link',
    attrs: (element) => {
      const href = element.getAttribute('href');
      if (href === null || !safeAddress(href, false)) return false;
      return { href, title: element.getAttribute('title') };
    },
  },
  script: ignore,
  style: ignore,
  template: ignore,
  title: ignore,
  meta: ignore,
  link: ignore,
  noscript: ignore,
  iframe: ignore,
  object: ignore,
  embed: ignore,
  svg: ignore,
  math: ignore,
  canvas: ignore,
  video: ignore,
  audio: ignore,
  select: ignore,
  button: ignore,
  input: ignore,
  textarea: ignore,
};

/**
 * Elements a browser lays out as blocks. One with no rule still separates what
 * is before it from what is after, so its content starts a block of its own.
 */
const blockElements = new Set([
  'address', 'article', 'aside', 'blockquote', 'caption', 'center', 'dd', 'details', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hgroup', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'ul',
]);

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * A node being built while its element's children are read.
 *
 * The bottom of the stack is the slice's own top, which has no type: it takes
 * whatever comes, since a slice's outermost content is whatever was copied.
 * `solid` marks a context an element opened, as against a wrapper opened to
 * make room for content, which is cheaper to close again.
 */
interface Context {
  readonly type: NodeType | null;
  readonly attrs: Attrs | null;
  readonly content: Node[];
  match: ContentMatch | null;
  readonly preserveWhitespace: boolean;
  readonly solid: boolean;
}

/** A way to put a node of some type into a context: nodes to add first, and wrappers to open. */
interface Route {
  readonly depth: number;
  readonly fill: Fragment;
  readonly wrap: readonly NodeType[];
}

class SliceParser {
  private readonly stack: Context[] = [
    { type: null, attrs: null, content: [], match: null, preserveWhitespace: false, solid: true },
  ];
  private marks: readonly Mark[] = Mark.none;
  /** Inline content at the slice's top must be put in a block: an element with no rule laid it out as one. */
  private needsBlock = false;

  constructor(
    private readonly schema: Schema,
    private readonly rules: ParseRules,
  ) {}

  private get top(): Context {
    return this.stack[this.stack.length - 1]!;
  }

  addChildren(parent: ParentNode): void {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === TEXT_NODE) this.addText(child as Text);
      else if (child.nodeType === ELEMENT_NODE) this.addElement(child as Element);
    }
  }

  /** Close everything still open and hand back the slice's top-level content. */
  finish(): Fragment {
    while (this.stack.length > 1) this.closeTop();
    const top = this.stack[0]!;
    trimTrailingSpace(top);
    return Fragment.from(top.content);
  }

  private addElement(element: Element): void {
    const name = element.nodeName.toLowerCase();
    if (name === 'br' && this.top.preserveWhitespace) {
      this.insertText('\n', element);
      return;
    }

    const rule = Object.hasOwn(this.rules, name) ? this.rules[name]! : null;
    if (rule?.ignore) return;

    if (rule?.node) {
      const type = this.schema.nodes[rule.node];
      const attrs = type ? readAttrs(rule, element) : false;
      if (type && attrs !== false && this.addNodeElement(element, type, declared(type.spec.attrs, attrs), rule)) return;
    } else if (rule?.mark) {
      const type = this.schema.marks[rule.mark];
      const attrs = type ? readAttrs(rule, element) : false;
      const mark = type && attrs !== false ? tryCreate(() => type.create(declared(type.spec.attrs, attrs))) : null;
      if (mark) {
        const outer = this.marks;
        this.marks = mark.addToSet(outer);
        this.addChildren(element);
        this.marks = outer;
        return;
      }
    }

    if (blockElements.has(name)) this.addBlock(element);
    else this.addChildren(element);
  }

  /**
   * An element that lays out as a block but has no rule: what it holds starts
   * a block of its own, and what follows it another.
   */
  private addBlock(element: Element): void {
    const top = this.top;
    if (top.type?.inlineContent && top.content.length > 0 && this.stack.length > 1) this.closeTop();
    const depth = this.stack.length - 1;
    const outer = this.needsBlock;
    if (!this.top.type) this.needsBlock = true;
    this.addChildren(element);
    while (this.stack.length - 1 > depth) this.closeTop();
    this.needsBlock = outer;
  }

  /** Read an element as a node of `type`; false when there is nowhere for one. */
  private addNodeElement(element: Element, type: NodeType, attrs: Attrs | null, rule: ParseRule): boolean {
    if (type.isLeaf) {
      const node = tryCreate(() => type.create(attrs));
      if (node) this.insert(node);
      return node !== null;
    }

    const route = this.findRoute(type);
    if (!route) return false;
    this.follow(route);
    const parent = this.top;
    parent.match = parent.match?.matchType(type) ?? null;
    this.stack.push({
      type,
      attrs,
      content: [],
      match: type.contentMatch,
      preserveWhitespace: rule.preserveWhitespace ?? parent.preserveWhitespace,
      solid: true,
    });
    const depth = this.stack.length - 1;
    this.addChildren(element);
    while (this.stack.length - 1 >= depth) this.closeTop();
    return true;
  }

  private addText(dom: Text): void {
    this.insertText(dom.data, dom);
  }

  private insertText(raw: string, dom: ChildNode): void {
    let value = raw;
    if (this.top.preserveWhitespace) {
      value = value.replace(/\r\n?/g, '\n');
    } else {
      value = value.replace(/[ \t\r\n\f]+/g, ' ');
      if (value === ' ' && !this.inlineContext(dom)) return;
    }
    if (value === '') return;

    const text = this.schema.text(value);
    const route = this.findRoute(text.type);
    if (!route) return;
    this.follow(route);

    // A space at the start of a block, after another space or after a line
    // break is not rendered, so it is not content either.
    if (!this.top.preserveWhitespace && value.startsWith(' ')) {
      const before = this.top.content[this.top.content.length - 1];
      const afterSpace = before?.isText === true && before.text!.endsWith(' ');
      if (!before || !before.isInline || afterSpace || dom.previousSibling?.nodeName === 'BR') value = value.slice(1);
    }
    if (value !== '') this.insert(this.schema.text(value));
  }

  /** Whether whitespace here is content between inline things rather than space between blocks. */
  private inlineContext(dom: ChildNode): boolean {
    const top = this.top;
    if (top.type) return top.type.inlineContent;
    if (top.content.length > 0) return top.content[0]!.isInline;
    if (this.needsBlock) return false;
    const parent = dom.parentNode;
    return parent !== null && !blockElements.has(parent.nodeName.toLowerCase());
  }

  /**
   * Put a node in, wrapped as where it lands requires, carrying `marks` as far
   * as its new parent allows — the marks open at this point in the HTML, or a
   * node's own when it is being moved.
   */
  private insert(node: Node, marks: readonly Mark[] = this.marks): void {
    const route = this.findRoute(node.type);
    if (!route) return;
    this.follow(route);
    const top = this.top;
    const marked = node.isInline ? node.mark(top.type ? top.type.allowedMarks(marks) : marks) : node;
    top.content.push(marked);
    top.match = top.match?.matchType(node.type) ?? null;
  }

  /**
   * The cheapest open context a node of `type` can go into: the fewest
   * wrappers, with closing an element's own context counted as dearer than
   * closing a wrapper that was only opened to make room.
   */
  private findRoute(type: NodeType): Route | null {
    let best: Route | null = null;
    let bestCost = Infinity;
    let penalty = 0;
    for (let depth = this.stack.length - 1; depth >= 0; depth--) {
      const context = this.stack[depth]!;
      const found = this.routeInto(context, type);
      if (found) {
        const cost = found.wrap.length + penalty;
        if (cost < bestCost) {
          best = { depth, ...found };
          bestCost = cost;
          if (cost === 0) break;
        }
      }
      if (context.solid) penalty += 2;
    }
    return best;
  }

  private routeInto(context: Context, type: NodeType): { fill: Fragment; wrap: readonly NodeType[] } | null {
    if (!context.match) {
      if (context.type) return null;
      // The slice's own top takes anything, unless an element with no rule
      // laid its content out as a block, in which case inline content goes in
      // the block the top node type would make for it.
      if (!this.needsBlock || !type.isInline) return { fill: Fragment.empty, wrap: [] };
      const wrap = this.schema.topNodeType.contentMatch.findWrapping(type);
      return wrap ? { fill: Fragment.empty, wrap } : { fill: Fragment.empty, wrap: [] };
    }
    if (context.match.matchType(type)) return { fill: Fragment.empty, wrap: [] };
    const fill = context.match.fillBefore(Fragment.from(placeholder(type)));
    if (fill) return { fill, wrap: [] };
    const wrap = context.match.findWrapping(type);
    return wrap ? { fill: Fragment.empty, wrap } : null;
  }

  /** Close what is above the route's context, add its filler, and open its wrappers. */
  private follow(route: Route): void {
    while (this.stack.length - 1 > route.depth) this.closeTop();
    const context = this.top;
    route.fill.forEach((node) => {
      context.content.push(node);
      context.match = context.match?.matchType(node.type) ?? null;
    });
    for (const type of route.wrap) {
      const parent = this.top;
      parent.match = parent.match?.matchType(type) ?? null;
      this.stack.push({
        type,
        attrs: null,
        content: [],
        match: type.contentMatch,
        preserveWhitespace: parent.preserveWhitespace,
        solid: false,
      });
    }
  }

  /**
   * Finish the innermost open node and add it to its parent. A node whose
   * content cannot be made valid gives that content up to the parent instead,
   * where it is placed afresh.
   */
  private closeTop(): void {
    const context = this.stack.pop()!;
    trimTrailingSpace(context);
    const content = Fragment.from(context.content);
    const node = context.type ? tryCreate(() => context.type!.createAndFill(context.attrs, content)) : null;
    if (node) {
      this.top.content.push(node);
      return;
    }
    for (const child of context.content) this.insert(child, child.marks);
  }
}

/** Collapsed whitespace at the end of a block is not rendered, so it is not content. */
function trimTrailingSpace(context: Context): void {
  if (context.preserveWhitespace) return;
  const last = context.content[context.content.length - 1];
  if (!last?.isText || !last.text!.endsWith(' ')) return;
  const text = last.text!.replace(/ +$/, '');
  if (text === '') context.content.pop();
  else context.content[context.content.length - 1] = last.withText(text);
}

function readAttrs(rule: ParseRule, element: Element): Attrs | null | false {
  return rule.attrs ? rule.attrs(element) : null;
}

/** Only the attributes a type declares, so a rule written for one schema does not break another. */
function declared(specs: Readonly<Record<string, unknown>> | undefined, attrs: Attrs | null): Attrs | null {
  if (!attrs) return null;
  const kept: Record<string, unknown> = {};
  for (const name in attrs) if (specs && Object.hasOwn(specs, name)) kept[name] = attrs[name];
  return kept;
}

function tryCreate<T>(make: () => T | null): T | null {
  try {
    return make();
  } catch (error) {
    // An attribute the type requires and the element did not have, or one it
    // refuses: the element is read as though it had no rule.
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** A node of `type` for matching against, never put in a document. */
function placeholder(type: NodeType): Node {
  return new Node(type, Object.freeze({}), null, Mark.none);
}

/** Where `parseSlice` reads HTML from, and with which rules. */
export interface ParseOptions {
  /** Defaults to `basicParseRules`. */
  readonly rules?: ParseRules;
  /** The document to parse with; defaults to the global one. A view passes its own. */
  readonly document?: Document;
}

/**
 * Read HTML through the schema into a slice open as far as its first and last
 * blocks go. A string is parsed into an inert template first; a DOM node has
 * its children read as they are.
 */
export function parseSlice(schema: Schema, html: string | ParentNode, options: ParseOptions = {}): Slice {
  let root: ParentNode;
  if (typeof html === 'string') {
    const document = options.document ?? globalThis.document;
    if (!document) throw new Error('[volt] parsing HTML needs a document; pass one where there is no global one');
    const template = document.createElement('template');
    template.innerHTML = html;
    root = template.content;
  } else {
    root = html;
  }

  const parser = new SliceParser(schema, options.rules ?? basicParseRules);
  parser.addChildren(root);
  return Slice.maxOpen(parser.finish());
}

/**
 * Which way to look for the caret after a slice goes in: back into the last
 * thing pasted when that is text or a textblock open at its end, forward past
 * it when it was a block put in whole.
 */
function insertionBias(slice: Slice): -1 | 1 {
  let last = slice.content.lastChild;
  let parent: Node | null = null;
  for (let i = 0; i < slice.openEnd && last; i++) {
    parent = last;
    last = last.lastChild;
  }
  const inward = last ? last.isInline : parent !== null && parent.isTextblock;
  return inward ? -1 : 1;
}

/**
 * Replace the selection with a slice, placed as `placeSlice` places one, and
 * put the caret after what went in.
 *
 * One step, and an undo unit of its own on both sides — a paste is one thing
 * to take back, and the typing after it another. Declines, changing nothing,
 * for an empty slice or one with nothing that fits here.
 */
export function insertSlice(tr: EditorTransaction, slice: Slice): boolean {
  if (slice.size === 0) return false;
  const { from, to } = tr.selection;
  const fit = placeSlice(tr.doc, from, to, slice);
  if (!fit.ok) return false;
  if (!tr.replace(fit.from, fit.to, fit.slice).ok) return false;
  tr.setSelection(EditorSelection.near(tr.doc, fit.from + fit.slice.size, insertionBias(slice)));
  tr.closeHistory();
  return true;
}

/** Parse HTML with the transaction's schema and paste it at the selection. */
export function pasteHTML(tr: EditorTransaction, html: string, options: ParseOptions = {}): boolean {
  return insertSlice(tr, parseSlice(tr.doc.type.schema, html, options));
}
