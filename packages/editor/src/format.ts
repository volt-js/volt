/**
 * The commands a formatting toolbar is made of, and the questions it asks.
 *
 * Each command takes a transaction and says whether it wrote anything, as the
 * commands in commands.ts do, and each question takes a state and answers
 * whether its button should be drawn down. They live apart from commands.ts
 * because nothing typed reaches them: they are what a button or a shortcut
 * asks for by name.
 *
 * **A block command replaces whole nodes, so it carries the selection across
 * itself.** Turning a paragraph into a heading, wrapping blocks in a quote
 * and taking a list apart all rewrite nodes the selection is inside, and a
 * replacement's map sends every position inside what it replaced to an edge
 * — which is commands.ts's split and join over again. The same answer is
 * given here as there: the command knows where each block it rebuilt went,
 * so it moves the selection by that, rather than letting it fall to an edge
 * of the rewrite. There is no step that wraps or lifts a range while keeping
 * the positions inside it, so the map a collaborator would rebase through is
 * the coarse one; that is the cost, and it is the same cost return already
 * pays.
 *
 * **A mark asked for at a caret is refused.** A state is a document and a
 * selection, with no set of marks held for the next character typed, so bold
 * pressed with nothing selected has nowhere to be kept. `markActive` still
 * answers at a caret — with the marks typing there would carry — so a toolbar
 * can show what the caret is in.
 *
 * **Lifting takes out the whole wrapper.** A quote or a list the selection is
 * in comes apart entirely, not only around the blocks selected: splitting a
 * wrapper in two at the selection is what a step that moves content without
 * replacing it is for, and there is none.
 *
 * Every command here closes the history: a press of a button is one thing to
 * undo, whatever was typed before it.
 */

import { sameAttrs } from './mark.js';
import type { Attrs, Mark } from './mark.js';
import { Fragment, Slice } from './node.js';
import type { Node } from './node.js';
import { resolve } from './position.js';
import type { ResolvedPos } from './position.js';
import type { MarkType, NodeType } from './schema.js';
import { EditorSelection } from './selection.js';
import type { SelectionJSON } from './selection.js';
import type { EditorState, EditorTransaction } from './state.js';

/** A textblock a range touches: the block, where it begins, and how much of its content the range covers. */
interface TouchedBlock {
  readonly node: Node;
  readonly pos: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Every textblock between two positions, in document order.
 *
 * A caret touches the block it is in. A node selection of an inline node
 * touches the block holding it; one of a block leaf, a rule, touches none.
 */
function touchedBlocks(doc: Node, from: number, to: number): TouchedBlock[] {
  const found: TouchedBlock[] = [];
  const walk = (node: Node, start: number): void => {
    let pos = start;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      const end = pos + child.nodeSize;
      // Anywhere from the start of its content to the end, edges included:
      // a selection made by a triple click ends at the start of the next
      // block, and an empty block has no inside but its one position.
      if (from <= end - 1 && to >= pos + 1) {
        if (child.isTextblock) {
          const contentStart = pos + 1;
          const contentEnd = end - 1;
          found.push({
            node: child,
            pos,
            from: Math.max(from, contentStart),
            to: Math.min(to, contentEnd),
          });
        } else if (!child.isLeaf) {
          walk(child, pos + 1);
        }
      }
      pos = end;
    }
  };
  walk(doc, 0);
  return found;
}

/** Every piece of text in the touched part of a block, with where it begins. */
function textIn(block: TouchedBlock, f: (text: Node) => void): void {
  let pos = block.pos + 1;
  block.node.content.forEach((child) => {
    const end = pos + child.nodeSize;
    if (child.isText && Math.max(pos, block.from) < Math.min(end, block.to)) f(child);
    pos = end;
  });
}

/**
 * Whether a piece of text has a say in a mark's toggle: it carries the mark,
 * or would take it. Text in a block that refuses the mark, and text carrying
 * a mark that refuses it — code, for bold — can never be changed by the
 * toggle, and drawing the button up on their account would promise a press
 * that does nothing to them.
 */
function counts(block: TouchedBlock, text: Node, type: MarkType): boolean {
  if (!block.node.type.allowsMarkType(type)) return false;
  if (type.isInSet(text.marks) !== null) return true;
  // The rule `Mark.addToSet` applies: a mark the new one throws off makes
  // room for it, and one that throws the new one off refuses it.
  return !text.marks.some((other) => !type.excludes(other.type) && other.type.excludes(type));
}

/**
 * Whether a mark is on at the selection.
 *
 * At a caret, whether typing there would carry it. Over a range, whether
 * every piece of text that could carry it does — and at least one piece can.
 */
export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, to, empty } = state.selection;
  if (empty) return type.isInSet(resolve(state.doc, from).marks()) !== null;
  return markedThroughout(touchedBlocks(state.doc, from, to), type);
}

/** Whether every piece of text in these blocks that could carry a mark does, and one can. */
function markedThroughout(blocks: readonly TouchedBlock[], type: MarkType): boolean {
  let any = false;
  let all = true;
  for (const block of blocks) {
    textIn(block, (text) => {
      if (!counts(block, text, type)) return;
      any = true;
      if (type.isInSet(text.marks) === null) all = false;
    });
  }
  return any && all;
}

/**
 * Put a mark on the selection's text, or take it off if it is all there
 * already. A range across blocks is marked block by block, passing over a
 * block that refuses the mark; text that cannot carry it is left as it is.
 *
 * Taking it off takes every mark of the type, whatever its attributes: a run
 * linked to two addresses is unlinked by one press. Putting it on uses
 * `attrs`.
 *
 * Declined at a caret, for the reason the header gives.
 */
export function toggleMark(tr: EditorTransaction, type: MarkType, attrs: Attrs | null = null): boolean {
  const { from, to, empty } = tr.selection;
  if (empty) return false;

  const blocks = touchedBlocks(tr.doc, from, to);
  let taken = false;

  if (markedThroughout(blocks, type)) {
    for (const block of blocks) {
      const present: Mark[] = [];
      textIn(block, (text) => {
        const own = type.isInSet(text.marks);
        if (own && !present.some((seen) => seen.eq(own))) present.push(own);
      });
      for (const each of present) if (tr.removeMark(block.from, block.to, each).ok) taken = true;
    }
  } else {
    // Made only now: a link needs an address to go on, and none to come off.
    const mark = type.create(attrs);
    for (const block of blocks) {
      let lacking = false;
      textIn(block, (text) => {
        if (counts(block, text, type) && mark.addToSet(text.marks) !== text.marks) lacking = true;
      });
      if (lacking && tr.addMark(block.from, block.to, mark).ok) taken = true;
    }
  }

  if (taken) tr.closeHistory();
  return taken;
}

/** Whether the attributes a caller named are the node's, ignoring the ones they did not. */
function hasAttrs(node: Node, attrs: Attrs | null): boolean {
  if (!attrs) return true;
  return Object.entries(attrs).every(([key, value]) => sameAttrs({ v: node.attrs[key] }, { v: value }));
}

/**
 * Whether every textblock the selection touches is of `type`, with every
 * attribute named in `attrs` — `{ level: 2 }` for the second heading level,
 * nothing for a heading of any level.
 */
export function blockActive(state: EditorState, type: NodeType, attrs: Attrs | null = null): boolean {
  const blocks = touchedBlocks(state.doc, state.selection.from, state.selection.to);
  return blocks.length > 0 && blocks.every((block) => block.node.type === type && hasAttrs(block.node, attrs));
}

/**
 * Give every textblock the selection touches a new type, keeping its content.
 *
 * A block that is that type already is left, and so is one whose place
 * refuses the type or whose content the type cannot hold: a list item's
 * opening paragraph cannot be a heading, and bold text cannot go into a code
 * block. The rest change. Declined when none can.
 *
 * Each block is replaced whole, and its content is the same size after, so
 * the selection is put back exactly where it was.
 */
export function setBlockType(tr: EditorTransaction, type: NodeType, attrs: Attrs | null = null): boolean {
  const { from, to } = tr.selection;
  const before = tr.selection.toJSON();
  let taken = false;

  for (const block of touchedBlocks(tr.doc, from, to)) {
    if (block.node.type === type && hasAttrs(block.node, attrs)) continue;
    if (!type.validContent(block.node.content)) continue;
    const merged = block.node.type === type ? { ...block.node.attrs, ...attrs } : attrs;
    const replacement = type.create(merged, block.node.content, block.node.marks);
    const slice = new Slice(Fragment.from(replacement), 0, 0);
    if (tr.replace(block.pos, block.pos + block.node.nodeSize, slice).ok) taken = true;
  }

  if (!taken) return false;
  tr.setSelection(EditorSelection.fromJSON(tr.doc, before));
  tr.closeHistory();
  return true;
}

/**
 * The blocks a selection covers, as a run of siblings: the node they are in,
 * where it begins, and which of its children.
 *
 * The deepest node holding both ends, unless that is a textblock, in which
 * case the run is that one block in its parent.
 */
interface BlockRange {
  readonly parent: Node;
  /** The position of the parent's first child. */
  readonly contentStart: number;
  readonly depth: number;
  readonly startIndex: number;
  readonly endIndex: number;
}

function blockRange(doc: Node, from: number, to: number): BlockRange {
  const $from = resolve(doc, from);
  const $to = resolve(doc, to);
  let depth = $from.sharedDepth(to);
  if ($from.node(depth).inlineContent) depth--;
  return rangeAt($from, $to, depth);
}

function rangeAt($from: ResolvedPos, $to: ResolvedPos, depth: number): BlockRange {
  const startIndex = $from.index(depth);
  const endIndex = Math.max(startIndex + 1, $to.depth > depth ? $to.indexAfter(depth) : $to.index(depth));
  return { parent: $from.node(depth), contentStart: $from.start(depth), depth, startIndex, endIndex };
}

/** Where a parent's child begins. */
function childPos(range: { parent: Node; contentStart: number }, index: number): number {
  let pos = range.contentStart;
  for (let i = 0; i < index; i++) pos += range.parent.child(i).nodeSize;
  return pos;
}

/** The children a range covers. */
function childrenOf(range: BlockRange): Node[] {
  const nodes: Node[] = [];
  for (let i = range.startIndex; i < range.endIndex; i++) nodes.push(range.parent.child(i));
  return nodes;
}

/** Whether a parent can hold `replacement` where the range's children are. */
function fits(range: BlockRange, replacement: readonly Node[]): boolean {
  const content = range.parent.content;
  const nodes: Node[] = [];
  for (let i = 0; i < range.startIndex; i++) nodes.push(content.child(i));
  nodes.push(...replacement);
  for (let i = range.endIndex; i < content.childCount; i++) nodes.push(content.child(i));
  return range.parent.type.validContent(Fragment.from(nodes));
}

/**
 * Replace a run of siblings with what was built from them, and move the
 * selection the way `shift` says each position inside them moved.
 */
function rebuild(
  tr: EditorTransaction,
  from: number,
  to: number,
  replacement: readonly Node[],
  shift: (pos: number) => number,
): boolean {
  const before = tr.selection.toJSON();
  if (!tr.replace(from, to, new Slice(Fragment.from(replacement), 0, 0)).ok) return false;
  // Both ends are inside what was rebuilt — every caller rebuilds the range
  // holding the selection — so `shift` is the whole story.
  tr.setSelection(EditorSelection.fromJSON(tr.doc, moved(before, shift)));
  tr.closeHistory();
  return true;
}

function moved(json: SelectionJSON, move: (pos: number) => number): SelectionJSON {
  return json.type === 'text'
    ? { type: 'text', anchor: move(json.anchor), head: move(json.head) }
    : { type: 'node', anchor: move(json.anchor) };
}

/** The depth of the nearest node of `type` holding the whole selection, or -1. */
function enclosing(doc: Node, from: number, to: number, type: NodeType): number {
  const $from = resolve(doc, from);
  for (let depth = $from.sharedDepth(to); depth > 0; depth--) {
    if ($from.node(depth).type === type) return depth;
  }
  return -1;
}

/** Whether the selection is inside a node of `type` — a quote, say. */
export function wrapActive(state: EditorState, type: NodeType): boolean {
  return enclosing(state.doc, state.selection.from, state.selection.to, type) > 0;
}

/**
 * Wrap the blocks the selection covers in a node of `type`, or, if the
 * selection is inside one already, lift the whole of the nearest one out.
 *
 * A wrapper goes round the blocks themselves if their parent can hold it
 * there, and further out if not: a quote asked for in a list item goes round
 * the list, since an item opens with a paragraph and a list holds only items.
 * Declined where nothing up to the document can hold it, and a lift is
 * declined where the wrapper's parent cannot hold what it held.
 */
export function toggleWrap(tr: EditorTransaction, type: NodeType, attrs: Attrs | null = null): boolean {
  const { from, to } = tr.selection;
  const doc = tr.doc;

  const depth = enclosing(doc, from, to, type);
  if (depth > 0) {
    const $from = resolve(doc, from);
    const wrapper = $from.node(depth);
    const range = rangeAt($from, $from, depth - 1);
    if (!fits(range, wrapper.content.content)) return false;
    const start = $from.before(depth);
    return rebuild(tr, start, start + wrapper.nodeSize, wrapper.content.content, (pos) => Math.max(start, pos - 1));
  }

  const $from = resolve(doc, from);
  const $to = resolve(doc, to);
  for (let range: BlockRange | null = blockRange(doc, from, to); range; ) {
    const blocks = childrenOf(range);
    if (type.validContent(Fragment.from(blocks))) {
      const wrapper = type.create(attrs, blocks);
      if (fits(range, [wrapper])) {
        const start = childPos(range, range.startIndex);
        const end = childPos(range, range.endIndex);
        return rebuild(tr, start, end, [wrapper], (pos) => pos + 1);
      }
    }
    range = range.depth > 0 ? rangeAt($from, $to, range.depth - 1) : null;
  }
  return false;
}

/**
 * The nearest list holding the selection: the depth of the node whose
 * children are items of `itemType`, or -1.
 */
function enclosingList(doc: Node, from: number, to: number, itemType: NodeType): number {
  const $from = resolve(doc, from);
  for (let depth = $from.sharedDepth(to); depth >= 0; depth--) {
    const node = $from.node(depth);
    if (node.type === itemType) return depth - 1;
    if (depth > 0 && node.firstChild?.type === itemType) return depth;
  }
  return -1;
}

/** Whether the nearest list holding the selection is a list of `listType`. */
export function listActive(state: EditorState, listType: NodeType, itemType: NodeType): boolean {
  const depth = enclosingList(state.doc, state.selection.from, state.selection.to, itemType);
  return depth > 0 && resolve(state.doc, state.selection.from).node(depth).type === listType;
}

/**
 * Make the blocks the selection covers a list of `listType`, one item of
 * `itemType` each — or, in a list already, take it apart if it is that
 * type, and make it that type if it is the other.
 *
 * Taking a list apart puts what each item held where the list was, so an item
 * holding two paragraphs leaves two, and a nested list goes into the item
 * around it. Making a list is declined, all of it, if one of the blocks cannot
 * open an item — a heading, in the starter schema, whose items open with a
 * paragraph.
 */
export function toggleList(
  tr: EditorTransaction,
  listType: NodeType,
  itemType: NodeType,
  attrs: Attrs | null = null,
): boolean {
  const { from, to } = tr.selection;
  const doc = tr.doc;
  const $from = resolve(doc, from);

  const depth = enclosingList(doc, from, to, itemType);
  if (depth > 0) {
    const list = $from.node(depth);
    const start = $from.before(depth);
    const end = start + list.nodeSize;

    if (list.type !== listType) {
      if (!listType.validContent(list.content)) return false;
      const retyped = listType.create(attrs, list.content, list.marks);
      return rebuild(tr, start, end, [retyped], (pos) => pos);
    }

    const contents: Node[] = [];
    const itemStarts: number[] = [];
    let pos = start + 1;
    list.content.forEach((item) => {
      itemStarts.push(pos);
      contents.push(...item.content.content);
      pos += item.nodeSize;
    });
    if (!fits(rangeAt($from, $from, depth - 1), contents)) return false;
    return rebuild(tr, start, end, contents, (at) => {
      // Inside item k, everything moved back by the list's opening token,
      // the item's own, and the two tokens of each item before it.
      let index = itemStarts.length - 1;
      while (index > 0 && itemStarts[index]! > at) index--;
      return Math.max(start, at - 2 - 2 * index);
    });
  }

  const range = blockRange(doc, from, to);
  const blocks = childrenOf(range);
  if (!blocks.every((block) => itemType.validContent(Fragment.from(block)))) return false;
  const list = listType.create(attrs, blocks.map((block) => itemType.create(null, block)));
  if (!fits(range, [list])) return false;

  const start = childPos(range, range.startIndex);
  const end = childPos(range, range.endIndex);
  const blockStarts = blocks.map((_, index) => childPos(range, range.startIndex + index));
  return rebuild(tr, start, end, [list], (at) => {
    // Block k moved forward by the list's opening token, its own item's, and
    // the two tokens of each item before it.
    let index = blockStarts.length - 1;
    while (index > 0 && blockStarts[index]! > at) index--;
    return at + 2 + 2 * index;
  });
}
