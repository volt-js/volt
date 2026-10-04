/**
 * Selections: a range of text, or one node picked up whole.
 *
 * There are two kinds, and they differ in what they hold rather than in how
 * they move. A `TextSelection` is two positions in inline content — a caret
 * when they coincide. A `NodeSelection` is one node, an image or a rule,
 * selected as an object: there is no caret inside a rule to put a text
 * selection in, and a text range drawn over an image says "these characters",
 * which is not what clicking an image or arrowing onto it means.
 *
 * **Both are mapped, never recomputed** — the rule state.ts states. A node
 * selection's two ends are mapped through a change's maps like any other pair
 * of positions, its start leaning right and its end leaning left so that text
 * typed against either edge stays outside it. If what lies between the two
 * mapped ends is still one selectable node, that node is still selected;
 * otherwise the node was deleted or replaced, and what is left is a text
 * selection over whatever took its place — a caret where it was, when nothing
 * did. Asking the new document "which node is near here" instead would be the
 * second, weaker guess this package does not make.
 *
 * **The arrow keys step onto a node and off it** — `selectHorizontally`, and
 * `selectVertically` for stepping off a block one. They act only where the
 * browser's own caret movement cannot: onto an atom beside the caret, or onto
 * a block atom past the end of the textblock. Everywhere else they say no, and
 * the browser moves the caret natively, which is the only movement that knows
 * about line wrapping, bidirectional text and grapheme clusters. Up and down
 * onto a rule from a paragraph are not done, since whether the caret is on
 * the paragraph's first or last line is a question about layout, and the view
 * does not measure any.
 *
 * An inline node selected whole needs nothing of its own from the commands:
 * it is a range like any other, typing replaces it, and deleting it maps the
 * selection to a caret where it was. A block does, because text cannot stand
 * where a block was, and commands.ts puts a textblock in its place or takes it
 * away, sending the caret to the nearest text with `findCaret` below.
 */

import type { Node } from './node.js';
import { resolve } from './position.js';
import type { EditorTransaction } from './state.js';
import type { Assoc, Mapping } from './step.js';

/** A selection as plain data — what `toJSON` produces and `fromJSON` takes. */
export type SelectionJSON =
  | { readonly type: 'text'; readonly anchor: number; readonly head: number }
  | { readonly type: 'node'; readonly anchor: number };

/**
 * What every selection is: two positions, `anchor` where it began and `head`
 * where it ends, and the same two ordered by position.
 *
 * Named for the editor, as its state and its view are, so a file that imports
 * it can still name the DOM's own `Selection`.
 */
export abstract class EditorSelection {
  abstract readonly anchor: number;
  abstract readonly head: number;

  get from(): number {
    return Math.min(this.anchor, this.head);
  }

  get to(): number {
    return Math.max(this.anchor, this.head);
  }

  get empty(): boolean {
    return this.anchor === this.head;
  }

  /** Same kind, same positions. A node selection never equals a text range over the same node. */
  abstract eq(other: EditorSelection): boolean;

  /**
   * This selection carried across a change, into the document it produced.
   * `from` is the index of the first map in `mapping` that applies, as
   * `Mapping.map` takes it.
   */
  abstract map(doc: Node, mapping: Mapping, from?: number): EditorSelection;

  abstract toJSON(): SelectionJSON;

  abstract toString(): string;

  /**
   * The selection a `toJSON` result describes, in `doc`.
   *
   * Refused with a `RangeError` rather than snapped when it does not describe
   * a selection in this document — a node selection where there is no
   * selectable node, a text end where no caret belongs. Stored JSON that no
   * longer fits was stored against a different document, and quietly moving it
   * would put the caret somewhere nobody chose.
   */
  static fromJSON(doc: Node, json: SelectionJSON): EditorSelection {
    if (json?.type === 'node' && Number.isInteger(json.anchor)) return NodeSelection.create(doc, json.anchor);
    if (json?.type === 'text' && Number.isInteger(json.anchor) && Number.isInteger(json.head)) {
      const selection = TextSelection.create(doc, json.anchor, json.head);
      if (selection.anchor !== json.anchor || selection.head !== json.head) {
        throw new RangeError(`[volt] ${JSON.stringify(json)} is not a text selection in this document`);
      }
      return selection;
    }
    throw new RangeError(`[volt] ${JSON.stringify(json)} does not describe a selection`);
  }

  /**
   * The selection nearest `pos`, looking first in the direction `bias` names:
   * a caret if there is inline content that way, a node selection if a
   * selectable block comes first. Where a paste leaves the caret.
   */
  static near(doc: Node, pos: number, bias: Assoc = 1): EditorSelection {
    const at = Math.max(0, Math.min(doc.content.size, pos));
    return findSelection(doc, at, bias) ?? findSelection(doc, at, bias < 0 ? 1 : -1) ?? TextSelection.create(doc, at);
  }
}

/** Whether a cursor can sit at `pos` — that is, whether it is in inline content. */
function isTextPos(doc: Node, pos: number): boolean {
  if (pos < 0 || pos > doc.content.size) return false;
  return resolve(doc, pos).parent.inlineContent;
}

/**
 * The closest position to `pos` a text cursor can occupy, searching outwards
 * and preferring the direction `bias` names.
 *
 * A mapped position can land somewhere no cursor belongs — between two list
 * items, say, after the paragraph that was there is deleted — and the honest
 * answer is the nearest place it can be rather than an exception in the middle
 * of applying a change.
 *
 * A document with no text position at all is legal (`doc(horizontal_rule)`
 * satisfies the basic schema), so this returns the clamped position rather
 * than refusing. Every command checks the parent it landed in before touching
 * it, which it would have to do anyway.
 */
function nearestTextPos(doc: Node, pos: number, bias: Assoc): number {
  const size = doc.content.size;
  const start = Math.max(0, Math.min(size, pos));
  for (let distance = 0; distance <= size; distance++) {
    const ahead = start + distance * bias;
    const behind = start - distance * bias;
    if (isTextPos(doc, ahead)) return ahead;
    if (isTextPos(doc, behind)) return behind;
  }
  return start;
}

/**
 * A selection between two positions in inline content.
 *
 * `anchor` is the end that stays put while a selection is extended and `head`
 * is the end that moves, so the pair is ordered by intent rather than by
 * position; `from` and `to` are the same two numbers ordered by position,
 * which is what every command wants.
 */
export class TextSelection extends EditorSelection {
  readonly anchor: number;
  readonly head: number;

  private constructor(anchor: number, head: number) {
    super();
    this.anchor = anchor;
    this.head = head;
    Object.freeze(this);
  }

  /** A selection in `doc`, with both ends snapped to where a cursor can be. */
  static create(doc: Node, anchor: number, head: number = anchor): TextSelection {
    const at = nearestTextPos(doc, anchor, 1);
    // The head is snapped towards the anchor, so a selection whose head landed
    // in a gap shrinks onto the content it covers rather than growing past it.
    return new TextSelection(at, head === anchor ? at : nearestTextPos(doc, head, head < at ? 1 : -1));
  }

  static atStart(doc: Node): TextSelection {
    return TextSelection.create(doc, 0);
  }

  eq(other: EditorSelection): boolean {
    return other instanceof TextSelection && this.anchor === other.anchor && this.head === other.head;
  }

  /**
   * This selection, carried across a change.
   *
   * Both ends map with `assoc` 1 — they belong after content inserted at them,
   * which is what makes the cursor follow typed text without anyone computing
   * where the text ended up.
   */
  map(doc: Node, mapping: Mapping, from = 0): TextSelection {
    return TextSelection.create(doc, mapping.map(this.anchor, 1, from), mapping.map(this.head, 1, from));
  }

  // Declared as the union rather than its text half, so that a `TextSelection`
  // has no member an `EditorSelection` lacks: code typed against the text
  // selection alone keeps taking either.
  toJSON(): SelectionJSON {
    return { type: 'text', anchor: this.anchor, head: this.head };
  }

  toString(): string {
    return this.empty ? `cursor(${this.anchor})` : `selection(${this.anchor}..${this.head})`;
  }
}

/** The whole node starting at `pos`, or null where a text node is cut there or nothing starts. */
function nodeStartingAt(doc: Node, pos: number): Node | null {
  const $pos = resolve(doc, pos);
  return $pos.textOffset > 0 ? null : $pos.nodeAfter;
}

/**
 * One node, selected whole.
 *
 * `anchor` is the position before it and `head` the position after, so `from`
 * and `to` are its two edges and every command that replaces a range replaces
 * the node: typing over it, deleting it, pasting over it — a block with a
 * textblock where what was typed has to go, as the top of this file says.
 */
export class NodeSelection extends EditorSelection {
  readonly anchor: number;
  readonly head: number;
  readonly node: Node;

  private constructor(pos: number, node: Node) {
    super();
    this.anchor = pos;
    this.head = pos + node.nodeSize;
    this.node = node;
    Object.freeze(this);
  }

  /**
   * Select the node that starts at `pos`.
   *
   * Refused where there is none, where text is cut there — text is selected
   * as a range, never as a node — and where the node's type says it is not
   * selectable.
   */
  static create(doc: Node, pos: number): NodeSelection {
    const node = nodeStartingAt(doc, pos);
    if (!node) throw new RangeError(`[volt] no node starts at ${pos} to be selected`);
    if (!node.type.selectable) throw new RangeError(`[volt] a ${node.type.name} cannot be selected as a node`);
    return new NodeSelection(pos, node);
  }

  eq(other: EditorSelection): boolean {
    return other instanceof NodeSelection && this.anchor === other.anchor && this.head === other.head;
  }

  /**
   * This selection, carried across a change.
   *
   * The start leans right and the end leans left, so text inserted against
   * either edge of the node lands outside the selection. A node still filling
   * exactly the mapped range — the same one moved, or one that replaced it
   * whole — stays selected; anything else is a text selection over the mapped
   * range, which is a caret where the node was when it was deleted.
   */
  map(doc: Node, mapping: Mapping, from = 0): EditorSelection {
    const start = mapping.map(this.anchor, 1, from);
    const end = Math.max(start, mapping.map(this.head, -1, from));
    const node = nodeStartingAt(doc, start);
    if (node && node.type.selectable && start + node.nodeSize === end) return new NodeSelection(start, node);
    return TextSelection.create(doc, start, end);
  }

  toJSON(): SelectionJSON {
    return { type: 'node', anchor: this.anchor };
  }

  toString(): string {
    return `node(${this.node.type.name}@${this.anchor})`;
  }
}

/**
 * The first place a selection can go from `pos` in direction `dir`: a caret
 * in the first inline content met, or the first selectable atom met before
 * any. Containers on the way — a blockquote, a list — are entered rather than
 * selected; null when the document ends first.
 */
export function findSelection(doc: Node, pos: number, dir: -1 | 1): EditorSelection | null {
  const $pos = resolve(doc, pos);
  if ($pos.parent.inlineContent) return TextSelection.create(doc, pos);
  const inside = findIn(doc, $pos.parent, pos, $pos.index(), dir);
  if (inside) return inside;
  for (let depth = $pos.depth - 1; depth >= 0; depth--) {
    const found =
      dir < 0
        ? findIn(doc, $pos.node(depth), $pos.before(depth + 1), $pos.index(depth), dir)
        : findIn(doc, $pos.node(depth), $pos.after(depth + 1), $pos.index(depth) + 1, dir);
    if (found) return found;
  }
  return null;
}

/**
 * The first caret from `pos` in direction `dir`, passing over every atom on
 * the way rather than selecting it; null when the document ends first.
 *
 * Where the caret goes once a selected block is deleted. An arrow stops on
 * the next rule because stepping onto it is the arrow's whole job; a delete
 * that left the next rule selected instead would have the next character
 * typed replace that rule too, when it was meant for the text. The view asks
 * it too, for the text either side of a block an input method composed over,
 * since a browser may write into either.
 */
export function findCaret(doc: Node, pos: number, dir: -1 | 1): TextSelection | null {
  let found = findSelection(doc, pos, dir);
  while (found instanceof NodeSelection) found = findSelection(doc, dir > 0 ? found.to : found.from, dir);
  return found instanceof TextSelection ? found : null;
}

/**
 * Search the children of `node` from `index` in direction `dir`. `pos` is the
 * position on the near side of the first child looked at — before it going
 * forwards, after it going backwards.
 */
function findIn(doc: Node, node: Node, pos: number, index: number, dir: -1 | 1): EditorSelection | null {
  if (node.inlineContent) return TextSelection.create(doc, pos);
  let at = pos;
  for (let i = index - (dir > 0 ? 0 : 1); dir > 0 ? i < node.childCount : i >= 0; i += dir) {
    const child = node.child(i);
    if (!child.type.isAtom) {
      const inner = findIn(doc, child, at + dir, dir < 0 ? child.childCount : 0, dir);
      if (inner) return inner;
    } else if (child.type.selectable) {
      return NodeSelection.create(doc, dir < 0 ? at - child.nodeSize : at);
    }
    at += child.nodeSize * dir;
  }
  return null;
}

/**
 * The left or right arrow, where it involves a node: onto an atom beside the
 * caret or past the end of its textblock, and off a selected node to the
 * other side of it. `dir` is the direction in the document — the view turns
 * the key into one by the direction the text runs.
 *
 * Says no, changing nothing, wherever the browser's own caret movement is the
 * right answer: inside text, at a block edge with more text beyond it, over a
 * range, past a hard break.
 */
export function selectHorizontally(tr: EditorTransaction, dir: -1 | 1): boolean {
  const selection = tr.selection;
  if (selection instanceof NodeSelection) {
    if (selection.node.isInline) {
      tr.setSelection(TextSelection.create(tr.doc, dir > 0 ? selection.to : selection.from));
      return true;
    }
    return moveTo(tr, findSelection(tr.doc, dir > 0 ? selection.to : selection.from, dir));
  }
  if (!selection.empty) return false;

  const $head = resolve(tr.doc, selection.head);
  // A caret clamped where there is no text — the state of a document that is
  // only a rule — has nothing to move through natively, so the arrow goes to
  // the nearest selection that way.
  if (!$head.parent.inlineContent) return moveTo(tr, findSelection(tr.doc, selection.head, dir));

  if ($head.textOffset === 0) {
    const beside = dir > 0 ? $head.nodeAfter : $head.nodeBefore;
    if (beside && !beside.isText) {
      if (!beside.type.isAtom || !beside.type.selectable) return false;
      tr.setSelection(NodeSelection.create(tr.doc, dir > 0 ? selection.head : selection.head - beside.nodeSize));
      return true;
    }
  }

  const atEdge = dir > 0 ? $head.parentOffset === $head.parent.content.size : $head.parentOffset === 0;
  if (!atEdge || $head.depth === 0) return false;
  const beyond = findSelection(tr.doc, dir > 0 ? $head.after() : $head.before(), dir);
  // A caret in the next textblock is where the browser puts it anyway.
  return beyond instanceof NodeSelection ? moveTo(tr, beyond) : false;
}

/**
 * The up or down arrow, off a selected block node to the selection before or
 * after it. Onto one is not done: it depends on which line of its textblock
 * the caret is on, which is layout this package does not measure.
 */
export function selectVertically(tr: EditorTransaction, dir: -1 | 1): boolean {
  const selection = tr.selection;
  if (!(selection instanceof NodeSelection) || selection.node.isInline) return false;
  return moveTo(tr, findSelection(tr.doc, dir > 0 ? selection.to : selection.from, dir));
}

function moveTo(tr: EditorTransaction, selection: EditorSelection | null): boolean {
  if (!selection) return false;
  tr.setSelection(selection);
  return true;
}
