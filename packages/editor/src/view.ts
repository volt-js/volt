/**
 * The view: the document on screen, and the two directions between it and the
 * model.
 *
 * Everything below this file is arithmetic — a document, positions into it,
 * steps that rewrite it. This is the only file that knows a browser exists,
 * and it has exactly three jobs: put the document in the DOM, translate
 * positions across the boundary in both directions, and keep the two
 * selections saying the same thing.
 *
 * **There is no virtual DOM here, and no diff of one document against
 * another.** Volt does not have one and this package does not want one: a
 * shadow tree is a second representation of the document that has to be kept
 * true, and the model is already that representation. So the view renders the
 * document once, and every update afterwards is driven by the range the
 * transaction says it rewrote. `EditorTransaction.changedRange` is in the
 * coordinates of the document the transaction produced; inverting the
 * transaction's own mapping gives the same range in the coordinates of the
 * document currently on screen. Those two ranges are walked down the rendered
 * tree together for as long as the change stays strictly inside one child of
 * both, which lands on the deepest node still containing the whole edit. Only
 * that node's affected children are rebuilt.
 * Typing into a list item touches the item's paragraph and nothing else — not
 * the list, not the sibling items, not the other blocks.
 *
 * **A rendered node is a `ViewDesc`, and its children line up one-to-one with
 * the model's.** That correspondence is the load-bearing invariant of the
 * whole file: `desc.children[i]` renders `desc.node.child(i)`, always. It is
 * what makes a position walk down the DOM tree the same walk as down the
 * document, so neither direction of the mapping has to search. Marks are the
 * one place it could break — a text node carrying two marks is three DOM nodes
 * — and it does not, because the mark elements are wrapped *inside* the one
 * desc for that text node rather than being descs of their own. Two adjacent
 * runs sharing a mark therefore get an element each rather than sharing one.
 * That is a slightly redundant tree and an exactly predictable one.
 *
 * **Sizes come from the model, so ancestors are refreshed on every update.**
 * A desc reports its span as `desc.node.nodeSize`, which is O(1) and is a lie
 * the moment a descendant changes and the ancestor still points at the old
 * node. So an update reassigns `node` all the way up the path it descended,
 * and the rule is that no desc may hold a node that is not in the document
 * currently displayed.
 *
 * **The DOM selection is written, not watched, and read only when it moves on
 * its own.** `selectionchange` is where a caret arriving from a click, a drag
 * or an arrow key enters the model. Writing the selection would fire it again,
 * so writes are flagged — but the flag is not what makes this safe, because
 * browsers fire `selectionchange` asynchronously and the flag is long cleared
 * by then. What makes it safe is that a read which agrees with the model
 * dispatches nothing. The flag only saves the work.
 *
 * Not here, deliberately: decorations, node views, collaborative cursors, drag
 * and drop. Also no rich clipboard and no keymap — a paste still arrives as
 * text through input.ts, and no keystroke is bound to undo.
 */

import { EditorInput } from './input.js';
import type { Mark } from './mark.js';
// The model's node class and the DOM's are both called `Node`. The model's is
// aliased, since this file mentions the DOM's far more often.
import type { Node as DocNode } from './node.js';
import { TextSelection } from './state.js';
import type { ChangedRange, EditorState, EditorTransaction } from './state.js';

/**
 * What a node renderer produces: the element the node becomes, and the element
 * its children go into when that is not the same one — `<pre><code>` being the
 * example that forces the distinction to exist.
 *
 * Omitting `contentDOM` means "the same element", except for a leaf, which has
 * no content to put anywhere.
 */
export interface NodeRendering {
  readonly dom: HTMLElement;
  readonly contentDOM?: HTMLElement | null;
}

/**
 * How a node type becomes an element.
 *
 * A renderer builds the element and nothing else: the view fills in the
 * children, because it is the view that has to know where each of them landed.
 * The owning document is passed rather than reached for globally, so a view
 * rendering into an iframe or a detached document works.
 */
export type NodeRenderer = (node: DocNode, document: Document) => NodeRendering;

/** How a mark becomes the element that wraps the inline content carrying it. */
export type MarkRenderer = (mark: Mark, document: Document) => HTMLElement;

export interface EditorRenderers {
  readonly nodes: Readonly<Record<string, NodeRenderer>>;
  readonly marks: Readonly<Record<string, MarkRenderer>>;
}

function headingLevel(node: DocNode): number {
  const level = Number(node.attrs['level']);
  if (!Number.isFinite(level)) return 1;
  return Math.min(6, Math.max(1, Math.trunc(level)));
}

/**
 * Renderers for the starter schema.
 *
 * They are here for the same reason `basicSchema` is in basic.ts: a package
 * whose only rendering is written inside a test learns nothing from its own
 * suite. An application declaring its own schema supplies its own, and the
 * ones it leaves out fall back to a `div` or a `span` tagged with the type
 * name — which renders, maps positions and is editable, and is honest about
 * being unstyled rather than throwing.
 */
export const basicNodeRenderers: Readonly<Record<string, NodeRenderer>> = {
  doc: (_node, document) => ({ dom: document.createElement('div') }),
  paragraph: (_node, document) => ({ dom: document.createElement('p') }),
  heading: (node, document) => ({ dom: document.createElement(`h${headingLevel(node)}`) }),
  blockquote: (_node, document) => ({ dom: document.createElement('blockquote') }),
  bullet_list: (_node, document) => ({ dom: document.createElement('ul') }),

  ordered_list: (node, document) => {
    const dom = document.createElement('ol');
    const start = Number(node.attrs['start']);
    // Only when it differs from the default: `start="1"` on every list is
    // noise in the output and in every test that reads it.
    if (Number.isFinite(start) && start !== 1) dom.setAttribute('start', String(start));
    return { dom };
  },

  list_item: (_node, document) => ({ dom: document.createElement('li') }),

  code_block: (_node, document) => {
    const dom = document.createElement('pre');
    const contentDOM = document.createElement('code');
    dom.appendChild(contentDOM);
    return { dom, contentDOM };
  },

  horizontal_rule: (_node, document) => ({ dom: document.createElement('hr') }),
  hard_break: (_node, document) => ({ dom: document.createElement('br') }),

  image: (node, document) => {
    const dom = document.createElement('img');
    dom.setAttribute('src', String(node.attrs['src'] ?? ''));
    const alt = node.attrs['alt'];
    // An image with no alt text and one with `alt=""` mean different things to
    // a screen reader, so a null attribute is left off rather than emptied.
    if (typeof alt === 'string') dom.setAttribute('alt', alt);
    const title = node.attrs['title'];
    if (typeof title === 'string') dom.setAttribute('title', title);
    return { dom };
  },
};

export const basicMarkRenderers: Readonly<Record<string, MarkRenderer>> = {
  em: (_mark, document) => document.createElement('em'),
  strong: (_mark, document) => document.createElement('strong'),
  code: (_mark, document) => document.createElement('code'),
  link: (mark, document) => {
    const dom = document.createElement('a');
    dom.setAttribute('href', String(mark.attrs['href'] ?? ''));
    const title = mark.attrs['title'];
    if (typeof title === 'string') dom.setAttribute('title', title);
    return dom;
  },
};

function fallbackNodeRenderer(node: DocNode, document: Document): NodeRendering {
  const dom = document.createElement(node.isInline ? 'span' : 'div');
  dom.setAttribute('data-node-type', node.type.name);
  return { dom };
}

function fallbackMarkRenderer(mark: Mark, document: Document): HTMLElement {
  const dom = document.createElement('span');
  dom.setAttribute('data-mark-type', mark.type.name);
  return dom;
}

/**
 * One rendered node.
 *
 * `dom` is the node's own element — or its text node — and `outer` is what
 * sits in the parent's content, which differs only when marks wrap it.
 * Removing a desc from the DOM means removing `outer`; finding a desc from a
 * DOM point means looking `dom`, `outer`, `contentDOM` and any mark wrapper up
 * in the same table.
 */
interface ViewDesc {
  node: DocNode;
  readonly dom: ChildNode;
  readonly outer: ChildNode;
  readonly contentDOM: HTMLElement | null;
  readonly parent: ViewDesc | null;
  children: ViewDesc[];
  /** The `<br>` propping open an empty textblock, which owns no position. */
  trailingBreak: ChildNode | null;
}

/**
 * A DOM point, in the shape `Range` and `Selection` take.
 *
 * Named as the DOM standard names that pair, a boundary point. `DOMPoint` is
 * the DOM's own geometry type, and an import of that name would hide it.
 */
export interface DOMBoundaryPoint {
  readonly node: Node;
  readonly offset: number;
}

/** Which children of `node` a content range touches, and where the first begins. */
function childSpan(node: DocNode, from: number, to: number): { start: number; end: number; offset: number } {
  let start = 0;
  let offset = 0;
  // A range beginning exactly on a boundary begins at the next child: the one
  // before it was not touched.
  while (start < node.childCount && offset + node.child(start).nodeSize <= from) {
    offset += node.child(start).nodeSize;
    start++;
  }

  let end = start;
  let endOffset = offset;
  while (end < node.childCount && endOffset < to) {
    endOffset += node.child(end).nodeSize;
    end++;
  }

  return { start, end, offset };
}

function domIndexOf(parent: Node, child: Node): number {
  const children = parent.childNodes;
  for (let i = 0; i < children.length; i++) if (children[i] === child) return i;
  return -1;
}

export interface EditorViewOptions {
  readonly state: EditorState;
  /**
   * Renderers to use, merged over the starter ones. A type named here wins;
   * a type named in neither renders as a tagged `div` or `span`.
   */
  readonly renderers?: {
    readonly nodes?: Readonly<Record<string, NodeRenderer>>;
    readonly marks?: Readonly<Record<string, MarkRenderer>>;
  };
  /**
   * Where a transaction goes. The default applies it and redraws; a host that
   * wants to see every change — to record history, or to send it somewhere —
   * takes it over and calls `update` itself, which is the only way the view
   * can be a slave to a state it does not own.
   */
  readonly dispatchTransaction?: (tr: EditorTransaction, view: EditorView) => void;
  /**
   * Defaults to true. A false view renders and maps positions but is read-only,
   * and is marked `aria-readonly` so it is announced as one.
   */
  readonly editable?: boolean;
}

/**
 * A document, rendered into an element, with input wired to it.
 */
export class EditorView {
  /** The editable element. It is the document node's rendering, not a wrapper. */
  readonly dom: HTMLElement;
  readonly input: EditorInput;

  private readonly document: Document;
  private readonly renderers: EditorRenderers;
  private readonly dispatchTransaction: ((tr: EditorTransaction, view: EditorView) => void) | null;
  private readonly descs = new Map<Node, ViewDesc>();
  private readonly docDesc: ViewDesc;

  private stateNow: EditorState;
  private writingSelection = false;

  constructor(place: HTMLElement, options: EditorViewOptions) {
    this.document = place.ownerDocument;
    this.stateNow = options.state;
    this.renderers = {
      nodes: { ...basicNodeRenderers, ...options.renderers?.nodes },
      marks: { ...basicMarkRenderers, ...options.renderers?.marks },
    };
    this.dispatchTransaction = options.dispatchTransaction ?? null;

    const doc = this.stateNow.doc;
    const rendering = (this.renderers.nodes[doc.type.name] ?? fallbackNodeRenderer)(doc, this.document);
    this.dom = rendering.dom;
    this.docDesc = {
      node: doc,
      dom: rendering.dom,
      outer: rendering.dom,
      contentDOM: rendering.contentDOM ?? rendering.dom,
      parent: null,
      children: [],
      trailingBreak: null,
    };
    this.remember(this.docDesc);

    this.dom.contentEditable = options.editable === false ? 'false' : 'true';
    this.dom.setAttribute('role', 'textbox');
    this.dom.setAttribute('aria-multiline', 'true');
    // A text box that refuses input has to say so, or it is announced as one
    // to type into.
    if (options.editable === false) this.dom.setAttribute('aria-readonly', 'true');
    this.dom.classList.add('volt-editor');
    place.appendChild(this.dom);

    this.replaceChildren(this.docDesc, 0, 0, doc, 0, doc.childCount);

    this.input = new EditorInput(this.dom, {
      state: () => this.stateNow,
      dispatch: (tr) => this.dispatch(tr),
    });
    // Added after the input layer's own listener, so it runs after the model
    // has caught up with the composition.
    this.dom.addEventListener('compositionend', this.onCompositionEnd);
    this.document.addEventListener('selectionchange', this.onSelectionChange);
    this.syncSelection();
  }

  get state(): EditorState {
    return this.stateNow;
  }

  /**
   * Hand a transaction to whoever owns state, which is this view unless the
   * host said otherwise.
   */
  dispatch(tr: EditorTransaction): void {
    if (this.dispatchTransaction) {
      this.dispatchTransaction(tr, this);
      return;
    }
    this.update(this.stateNow.apply(tr), tr);
  }

  /**
   * Show a new state.
   *
   * The transaction is optional but is what makes the update cheap: without it
   * there is nothing to say which part of the document moved, and the whole
   * document is drawn again. A host that owns dispatch should pass the
   * transaction it applied.
   */
  update(state: EditorState, tr?: EditorTransaction): void {
    const previous = this.stateNow;
    this.stateNow = state;

    if (state.doc !== previous.doc) {
      const range = tr?.changedRange;
      // The transaction has to be the one that produced this document from the
      // one on screen; a state arriving from anywhere else gets a full redraw
      // rather than a range that means nothing here.
      if (range && tr.startDoc === previous.doc && tr.doc === state.doc) {
        const inverse = tr.mapping.invert();
        this.redraw(state.doc, range, { from: inverse.map(range.from, -1), to: inverse.map(range.to, 1) });
      } else {
        this.replaceChildren(this.docDesc, 0, this.docDesc.children.length, state.doc, 0, state.doc.childCount);
        this.docDesc.node = state.doc;
      }
    }

    this.syncSelection();
  }

  /** Focus the editable element and put the caret where the model says. */
  focus(): void {
    this.dom.focus();
    this.syncSelection();
  }

  destroy(): void {
    this.input.destroy();
    this.dom.removeEventListener('compositionend', this.onCompositionEnd);
    this.document.removeEventListener('selectionchange', this.onSelectionChange);
    this.descs.clear();
    this.dom.remove();
  }

  /**
   * The document position a DOM point names, or null if it is not in here.
   *
   * A point can land on DOM this view does not own a description of — the
   * `<br>` propping an empty paragraph open, or an element a renderer built
   * around the content — so the search climbs until it reaches something it
   * knows, converting the offset into "before or after the thing I came out
   * of" as it goes. Climbing out of the view entirely is how a point that is
   * not in this document is refused; there is no separate containment check,
   * because a second answer to the same question is a second thing to keep
   * true.
   */
  posAtDOM(domNode: Node, offset: number): number | null {
    let node: Node | null = domNode;
    let at = offset;
    while (node) {
      const desc = this.descs.get(node);
      if (desc) return this.posInDesc(desc, node, at);
      const parent: Node | null = node.parentNode;
      if (!parent) return null;
      const index = domIndexOf(parent, node);
      if (index < 0) return null;
      at = at > 0 ? index + 1 : index;
      node = parent;
    }
    return null;
  }

  /** The DOM point a document position names, or null if it is out of range. */
  domAtPos(pos: number): DOMBoundaryPoint | null {
    if (pos < 0 || pos > this.stateNow.doc.content.size) return null;

    let desc = this.docDesc;
    for (;;) {
      const contentDOM = desc.contentDOM;
      if (!contentDOM) return { node: desc.outer, offset: 0 };

      const offset = pos - this.contentStart(desc);
      let index = 0;
      let seen = 0;
      while (index < desc.children.length) {
        const size = desc.children[index]!.node.nodeSize;
        if (seen + size > offset) break;
        seen += size;
        index++;
      }

      const previous = index > 0 ? desc.children[index - 1] : undefined;
      const child = desc.children[index];
      if (!child) {
        // The end of this node's content. A trailing text node is the better
        // answer than the element boundary: a caret placed on the element
        // renders between the children, which is the same place, but nothing
        // downstream can tell it apart from a caret before a following node.
        if (previous && previous.node.isText) return { node: previous.dom, offset: previous.node.text!.length };
        return { node: contentDOM, offset: contentDOM.childNodes.length - (desc.trailingBreak ? 1 : 0) };
      }

      const local = offset - seen;
      if (child.node.isText) return { node: child.dom, offset: local };
      if (local === 0) {
        if (previous && previous.node.isText) return { node: previous.dom, offset: previous.node.text!.length };
        return { node: contentDOM, offset: domIndexOf(contentDOM, child.outer) };
      }
      if (!child.contentDOM) {
        // Inside a leaf, where there is nowhere to be. Its far side is the
        // only honest answer, and it is where `TextSelection` would snap to.
        return { node: contentDOM, offset: domIndexOf(contentDOM, child.outer) + 1 };
      }
      desc = child;
    }
  }

  /**
   * Put the model's selection into the DOM.
   *
   * Skipped while an input method is composing, because the browser owns the
   * DOM until it is finished and moving the selection out from under a
   * composition abandons it. Skipped, too, when the selection is not in here:
   * an editor nobody is typing in has no business taking the caret away from
   * whatever does have it.
   */
  private syncSelection(): void {
    if (this.input.composing) return;

    const selection = this.document.getSelection();
    if (!selection || !this.holdsSelection(selection)) return;

    const { anchor, head } = this.stateNow.selection;
    const anchorAt = this.domAtPos(anchor);
    const headAt = this.domAtPos(head);
    if (!anchorAt || !headAt) return;

    if (
      selection.anchorNode === anchorAt.node &&
      selection.anchorOffset === anchorAt.offset &&
      selection.focusNode === headAt.node &&
      selection.focusOffset === headAt.offset
    ) {
      return;
    }

    this.writingSelection = true;
    try {
      selection.setBaseAndExtent(anchorAt.node, anchorAt.offset, headAt.node, headAt.offset);
    } finally {
      this.writingSelection = false;
    }
  }

  private holdsSelection(selection: Selection): boolean {
    const active = this.document.activeElement;
    if (active && (active === this.dom || this.dom.contains(active))) return true;
    return selection.anchorNode !== null && this.dom.contains(selection.anchorNode);
  }

  /**
   * Read a selection the browser moved back into the model.
   *
   * The guard that matters is the last one: a read that agrees with the model
   * dispatches nothing. `writingSelection` catches the synchronous echo of our
   * own write, but browsers fire this event on a later task where the flag is
   * long cleared, so it can only ever be an optimisation.
   */
  private readonly onSelectionChange = (): void => {
    if (this.writingSelection || this.input.composing) return;

    const selection = this.document.getSelection();
    if (!selection || !selection.anchorNode || !selection.focusNode) return;
    if (!this.dom.contains(selection.anchorNode) || !this.dom.contains(selection.focusNode)) return;

    const anchor = this.posAtDOM(selection.anchorNode, selection.anchorOffset);
    const head = this.posAtDOM(selection.focusNode, selection.focusOffset);
    if (anchor === null || head === null) return;

    const next = TextSelection.create(this.stateNow.doc, anchor, head);
    if (next.eq(this.stateNow.selection)) return;
    this.dispatch(this.stateNow.tr().setSelection(next));
  };

  /**
   * Take back the DOM an input method wrote.
   *
   * For the length of a composition the browser edits the page itself, and
   * what it wrote reaches the model only as the text `compositionend` carries.
   * By the time the model has caught up, the input method's own nodes are
   * still on the page beside the view's rendering of the same text — in an
   * empty paragraph, where there is no text node to write into and the input
   * method has to make one, the composed text shows twice. A composition that
   * ends with no text changes nothing in the model, so nothing redraws what it
   * left behind at all.
   *
   * It wrote where the selection is, which the model has kept since the
   * composition began, so the node around the selection has its content drawn
   * again from the model, and whatever else is in it goes.
   */
  private readonly onCompositionEnd = (): void => {
    const desc = this.descAround(this.stateNow.selection.from, this.stateNow.selection.to);
    desc.contentDOM?.replaceChildren();
    this.replaceChildren(desc, 0, desc.children.length, desc.node, 0, desc.node.childCount);
    this.syncSelection();
  };

  /** The deepest rendered node whose content holds the whole of a range. */
  private descAround(from: number, to: number): ViewDesc {
    let desc = this.docDesc;
    let start = 0;
    for (;;) {
      let offset = start;
      let inner: ViewDesc | null = null;
      for (const child of desc.children) {
        const end = offset + child.node.nodeSize;
        if (end > from) {
          // Strictly inside at both ends: a range touching the child's own
          // opening or closing token is not in its content.
          if (child.contentDOM && from > offset && to < end) inner = child;
          break;
        }
        offset = end;
      }
      if (!inner) return desc;
      desc = inner;
      start = offset + 1;
    }
  }

  /**
   * Redraw what changed.
   *
   * Both ranges describe the same edit, one in the coordinates of the document
   * arriving and one in the coordinates of the document displayed. Walking
   * them down together is what localises the change: while the edit stays
   * strictly inside one child on both sides, and that child is still the same
   * kind of node, its element is kept and the search moves into it.
   */
  private redraw(newDoc: DocNode, newRange: ChangedRange, oldRange: ChangedRange): void {
    let desc = this.docDesc;
    let newNode = newDoc;
    let oldStart = 0;
    let newStart = 0;
    const path: ViewDesc[] = [];
    const nodes: DocNode[] = [];

    let oldSpan = childSpan(desc.node, oldRange.from - oldStart, oldRange.to - oldStart);
    let newSpan = childSpan(newNode, newRange.from - newStart, newRange.to - newStart);

    for (;;) {
      if (oldSpan.end - oldSpan.start !== 1 || newSpan.end - newSpan.start !== 1) break;
      if (oldSpan.start !== newSpan.start) break;

      const oldChild = desc.node.child(oldSpan.start);
      const newChild = newNode.child(newSpan.start);
      const childDesc = desc.children[oldSpan.start];
      if (!childDesc || !childDesc.contentDOM || oldChild.isText || oldChild.isLeaf) break;
      if (!oldChild.sameMarkup(newChild)) break;

      // Strictly inside, on both sides: a range touching the child's own
      // opening or closing token is a change *to* the child, not in it.
      const oldInner = { from: oldStart + oldSpan.offset, to: oldStart + oldSpan.offset + oldChild.nodeSize };
      const newInner = { from: newStart + newSpan.offset, to: newStart + newSpan.offset + newChild.nodeSize };
      if (oldRange.from <= oldInner.from || oldRange.to >= oldInner.to) break;
      if (newRange.from <= newInner.from || newRange.to >= newInner.to) break;

      path.push(desc);
      nodes.push(newNode);
      oldStart = oldInner.from + 1;
      newStart = newInner.from + 1;
      desc = childDesc;
      newNode = newChild;
      oldSpan = childSpan(desc.node, oldRange.from - oldStart, oldRange.to - oldStart);
      newSpan = childSpan(newNode, newRange.from - newStart, newRange.to - newStart);
    }

    // The children before the change are the same on both sides, and so are
    // the ones after it, so the two spans are widened until they agree about
    // how many they leave alone. Without that a deletion — whose new range is
    // empty and touches no child at all — would remove DOM and put nothing
    // back.
    const start = Math.min(oldSpan.start, newSpan.start);
    const tail = Math.max(0, Math.min(desc.node.childCount - oldSpan.end, newNode.childCount - newSpan.end));
    const oldEnd = desc.node.childCount - tail;
    const newEnd = newNode.childCount - tail;

    if (oldEnd < start || newEnd < start) {
      // The two documents disagree about their own shape, which means the
      // range was not describing this pair. Drawing everything is wrong-ish
      // and correct, where drawing a nonsense span is neither.
      this.replaceChildren(this.docDesc, 0, this.docDesc.children.length, newDoc, 0, newDoc.childCount);
      this.docDesc.node = newDoc;
      return;
    }

    this.replaceChildren(desc, start, oldEnd, newNode, start, newEnd);

    // Every desc on the way down still points at the node it held before the
    // edit, and `nodeSize` is read off that node. They are refreshed from the
    // deepest outwards, so nothing is left describing a document that is no
    // longer on screen.
    desc.node = newNode;
    for (let i = path.length - 1; i >= 0; i--) path[i]!.node = nodes[i]!;
  }

  /**
   * Swap a run of a desc's children for freshly rendered ones.
   *
   * The trailing break is taken out first and put back after: it is the last
   * DOM child of an empty textblock, and inserting content before it would
   * otherwise mean inserting content after it.
   */
  private replaceChildren(
    desc: ViewDesc,
    oldFrom: number,
    oldTo: number,
    newNode: DocNode,
    newFrom: number,
    newTo: number,
  ): void {
    const contentDOM = desc.contentDOM;
    if (!contentDOM) return;

    if (desc.trailingBreak) {
      desc.trailingBreak.remove();
      desc.trailingBreak = null;
    }

    for (const child of desc.children.splice(oldFrom, oldTo - oldFrom)) {
      this.forget(child);
      child.outer.remove();
    }

    const created: ViewDesc[] = [];
    for (let i = newFrom; i < newTo; i++) created.push(this.renderNode(newNode.child(i), desc));

    const reference = desc.children[oldFrom]?.outer ?? null;
    for (const child of created) contentDOM.insertBefore(child.outer, reference);
    desc.children.splice(oldFrom, 0, ...created);

    if (newNode.isTextblock && desc.children.length === 0) {
      // An empty block with no line box in it cannot be clicked into and, in
      // several engines, cannot be typed into either.
      const br = this.document.createElement('br');
      contentDOM.appendChild(br);
      desc.trailingBreak = br;
    }
  }

  private renderNode(node: DocNode, parent: ViewDesc): ViewDesc {
    if (node.isText) {
      const text = this.document.createTextNode(node.text!);
      // The first mark ends up outermost, which is the order `Mark.addToSet`
      // keeps them in — so the same mark set always nests the same way, and
      // two runs that differ by one mark still look related in the output.
      let outer: ChildNode = text;
      for (let i = node.marks.length - 1; i >= 0; i--) {
        const mark = node.marks[i]!;
        const wrapper = (this.renderers.marks[mark.type.name] ?? fallbackMarkRenderer)(mark, this.document);
        wrapper.appendChild(outer);
        outer = wrapper;
      }

      const desc: ViewDesc = { node, dom: text, outer, contentDOM: null, parent, children: [], trailingBreak: null };
      this.remember(desc);
      for (let wrapper: Node | null = outer; wrapper && wrapper !== text; wrapper = wrapper.firstChild) {
        this.descs.set(wrapper, desc);
      }
      return desc;
    }

    const rendering = (this.renderers.nodes[node.type.name] ?? fallbackNodeRenderer)(node, this.document);
    const contentDOM = rendering.contentDOM !== undefined ? rendering.contentDOM : node.isLeaf ? null : rendering.dom;
    const desc: ViewDesc = {
      node,
      dom: rendering.dom,
      outer: rendering.dom,
      contentDOM,
      parent,
      children: [],
      trailingBreak: null,
    };
    this.remember(desc);
    this.replaceChildren(desc, 0, 0, node, 0, node.childCount);
    return desc;
  }

  private remember(desc: ViewDesc): void {
    this.descs.set(desc.dom, desc);
    this.descs.set(desc.outer, desc);
    if (desc.contentDOM) this.descs.set(desc.contentDOM, desc);
  }

  private forget(desc: ViewDesc): void {
    this.descs.delete(desc.dom);
    this.descs.delete(desc.outer);
    if (desc.contentDOM) this.descs.delete(desc.contentDOM);
    for (let wrapper: Node | null = desc.outer; wrapper && wrapper !== desc.dom; wrapper = wrapper.firstChild) {
      this.descs.delete(wrapper);
    }
    for (const child of desc.children) this.forget(child);
  }

  /** The document position immediately before a desc's own opening token. */
  private posBefore(desc: ViewDesc): number {
    const parent = desc.parent;
    if (!parent) return 0;
    let pos = this.contentStart(parent);
    for (const sibling of parent.children) {
      if (sibling === desc) return pos;
      pos += sibling.node.nodeSize;
    }
    throw new Error('[volt] a rendered node is missing from its parent');
  }

  /** The first position inside a desc, which for text is the text's own start. */
  private contentStart(desc: ViewDesc): number {
    if (!desc.parent) return 0;
    return this.posBefore(desc) + (desc.node.isText ? 0 : 1);
  }

  private posInDesc(desc: ViewDesc, at: Node, offset: number): number {
    if (desc.node.isText) {
      const length = desc.node.text!.length;
      // A point inside a mark wrapper rather than in the text itself: the
      // wrapper holds exactly this run, so either end of it is either end.
      if (at !== desc.dom) return this.posBefore(desc) + (offset > 0 ? length : 0);
      return this.posBefore(desc) + Math.min(Math.max(offset, 0), length);
    }

    const contentDOM = desc.contentDOM;
    if (!contentDOM || at !== contentDOM) {
      return offset > 0 ? this.posBefore(desc) + desc.node.nodeSize : this.posBefore(desc);
    }

    let pos = this.contentStart(desc);
    let index = 0;
    const children = contentDOM.childNodes;
    for (let i = 0; i < Math.min(offset, children.length); i++) {
      const child = desc.children[index];
      // Anything with no desc — the trailing break — occupies no positions.
      if (child && child.outer === children[i]) {
        pos += child.node.nodeSize;
        index++;
      }
    }
    return pos;
  }
}
