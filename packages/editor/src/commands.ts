/**
 * The edits an input event turns into.
 *
 * A command takes a transaction, tries to write the change into it, and says
 * whether it did. It is a separate layer from input.ts on purpose: the
 * translation from a `beforeinput` event to an intention is browser knowledge,
 * and "what typing return does to a paragraph" is document knowledge. Keeping
 * them apart is also what makes this layer testable without an event at all.
 *
 * **Everything here is written around one constraint from step.ts: a
 * replacement's two ends must resolve into the same parent.** That rules out
 * the obvious spelling of the two structural edits an editor cannot do
 * without. Splitting a paragraph is not "insert a boundary at the cursor", and
 * joining two is not "delete the boundary between them" — both of those are
 * replacements across a parent boundary, and both are refused.
 *
 * They are expressed here one level up instead. A split replaces the *whole
 * block* with two blocks, and a join replaces the *two blocks* with one. Both
 * of those have their ends in the block's parent, so both are single steps
 * that invert themselves and produce a usable map. The cost is that the map is
 * coarse: every position inside the rewritten blocks collapses to an edge, so
 * these two commands are also the only ones that set the selection explicitly
 * rather than letting it map. Where they do, the position is computed from the
 * geometry of what was just built, not guessed.
 */

import { Fragment, Slice } from './node.js';
import type { Node } from './node.js';
import { resolve } from './position.js';
import type { ResolvedPos } from './position.js';
import { TextSelection } from './state.js';
import type { EditorTransaction } from './state.js';

/**
 * Grapheme clusters, not code units.
 *
 * Backspace deletes what looks like one character to the person pressing it. A
 * family emoji is eleven code units and one grapheme; deleting one code unit
 * of it leaves an invalid string on screen, and deleting a fixed number leaves
 * the wrong one. The segmenter is the only thing that knows where the boundary
 * is, and it has been in every engine this framework targets for years.
 */
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function lastGraphemeLength(text: string): number {
  let length = 0;
  for (const { segment } of graphemes.segment(text)) length = segment.length;
  return length;
}

function firstGraphemeLength(text: string): number {
  for (const { segment } of graphemes.segment(text)) return segment.length;
  return 0;
}

/** Replace whatever is selected with nothing, if anything is. */
export function deleteSelection(tr: EditorTransaction): boolean {
  const { from, to, empty } = tr.selection;
  if (empty) return false;
  return tr.delete(from, to).ok;
}

/**
 * Type text at the selection.
 *
 * The marks come from the position, not from a toolbar: `ResolvedPos.marks`
 * already implements "typing at the end of a bold run stays bold, typing at
 * the end of a link does not extend it".
 *
 * They are then filtered by what the block allows. With the model as it stands
 * that filter can never actually drop anything — the marks come from nodes
 * already in this block, and no document can hold a node carrying a mark its
 * parent forbids, since every constructor and every step checks. It is kept
 * because `Schema.text` is the one place that does *not* check: it will build
 * a text node with any marks it is handed, and the replacement would then be
 * refused several frames later by `validContent` with a message about content
 * rather than about marks. The filter states the requirement where the node is
 * made instead of relying on an invariant enforced three files away.
 */
export function insertText(tr: EditorTransaction, text: string): boolean {
  const { from, to, empty } = tr.selection;
  if (text === '' && empty) return false;

  const $from = resolve(tr.doc, from);
  if (!$from.parent.inlineContent) return false;

  const marks = $from.parent.type.allowedMarks($from.marks());
  const node = tr.doc.type.schema.text(text, marks);
  if (!tr.replace(from, to, new Slice(Fragment.from(node), 0, 0)).ok) return false;

  // With an empty selection the map has already put the cursor after the typed
  // text, which is the whole point of mapping it. With a range, the two ends
  // map to opposite edges of the replacement — anchor to the start, head to
  // the end — which is a selection *of* what was just typed rather than a
  // cursor after it, so it collapses onto the mapped end.
  if (!empty) tr.setSelection(TextSelection.create(tr.doc, tr.selection.to));
  return true;
}

/**
 * Split the textblock at the cursor in two — what pressing return does.
 *
 * Both halves keep the block's type and attributes. "Return at the end of a
 * heading starts a paragraph" is a real expectation and deliberately not here:
 * it is a policy about which type follows which, it differs per schema, and it
 * belongs to a keymap or a schema-level rule rather than to the operation.
 */
export function insertParagraph(tr: EditorTransaction): boolean {
  if (!tr.selection.empty && !deleteSelection(tr)) return false;

  const $pos = resolve(tr.doc, tr.selection.from);
  const depth = $pos.depth;
  if (depth === 0 || !$pos.parent.isTextblock) return false;

  const block = $pos.parent;
  const before = $pos.before(depth);
  const after = $pos.after(depth);

  // `createAndFill` rather than `create`: a block whose content expression
  // requires something an empty half would not have gets it filled in.
  const first = block.type.createAndFill(block.attrs, block.content.cut(0, $pos.parentOffset), block.marks);
  const second = block.type.createAndFill(block.attrs, block.content.cut($pos.parentOffset), block.marks);
  if (!first || !second) return false;

  if (!tr.replace(before, after, new Slice(Fragment.from([first, second]), 0, 0)).ok) return false;

  // Inside the second block: past the first block entirely, then past the
  // second block's own opening token.
  tr.setSelection(TextSelection.create(tr.doc, before + first.nodeSize + 1));
  tr.closeHistory();
  return true;
}

/** The two blocks either side of a boundary, and where they sit. */
interface Neighbours {
  readonly parent: Node;
  readonly index: number;
  readonly start: number;
  readonly block: Node;
}

function neighbours($pos: ResolvedPos): Neighbours | null {
  const depth = $pos.depth;
  if (depth === 0) return null;
  return {
    parent: $pos.node(depth - 1),
    index: $pos.index(depth - 1),
    start: $pos.before(depth),
    block: $pos.node(depth),
  };
}

/**
 * Merge two adjacent blocks into the first of them.
 *
 * One step at the level of their shared parent, which is what keeps it inside
 * what `ReplaceStep` will accept. The join point is where the first block's
 * content ended, and the cursor goes there — mapping cannot say so, because
 * both blocks were replaced wholesale and every position inside them collapses
 * to an edge of the replacement.
 */
function joinBlocks(tr: EditorTransaction, at: Neighbours, second: Node, secondEnd: number): boolean {
  const first = at.block;
  if (!first.isTextblock || !second.isTextblock) return false;

  const merged = first.content.append(second.content);
  if (!first.type.validContent(merged)) return false;

  const joined = first.type.create(first.attrs, merged, first.marks);
  if (!tr.replace(at.start, secondEnd, new Slice(Fragment.from(joined), 0, 0)).ok) return false;

  tr.setSelection(TextSelection.create(tr.doc, at.start + 1 + first.content.size));
  return true;
}

/** Delete backwards: the selection, or one grapheme, or the boundary before. */
export function deleteBackward(tr: EditorTransaction): boolean {
  if (!tr.selection.empty) return deleteSelection(tr);

  const pos = tr.selection.from;
  const $pos = resolve(tr.doc, pos);
  const before = $pos.nodeBefore;
  if (before) {
    const unit = before.isText ? lastGraphemeLength(before.text!) : before.nodeSize;
    return unit > 0 && tr.delete(pos - unit, pos).ok;
  }

  // At the start of a block. What is before it is another block to merge with,
  // or a leaf — a rule, an image on its own — which backspace removes.
  const at = neighbours($pos);
  if (!at || at.index === 0) return false;

  const previous = at.parent.child(at.index - 1);
  const previousStart = at.start - previous.nodeSize;
  // No `setSelection`: everything the deletion removed is before the cursor,
  // so the map shifts it by exactly the leaf's size and lands it back at the
  // start of this block's content. Setting it here would be a second, weaker
  // answer to a question the map already answered.
  if (previous.isLeaf) return tr.delete(previousStart, at.start).ok;

  return joinBlocks(
    tr,
    { parent: at.parent, index: at.index - 1, start: previousStart, block: previous },
    at.block,
    at.start + at.block.nodeSize,
  );
}

/** Delete forwards: the selection, or one grapheme, or the boundary after. */
export function deleteForward(tr: EditorTransaction): boolean {
  if (!tr.selection.empty) return deleteSelection(tr);

  const pos = tr.selection.from;
  const $pos = resolve(tr.doc, pos);
  const after = $pos.nodeAfter;
  if (after) {
    const unit = after.isText ? firstGraphemeLength(after.text!) : after.nodeSize;
    return unit > 0 && tr.delete(pos, pos + unit).ok;
  }

  const at = neighbours($pos);
  if (!at || at.index + 1 >= at.parent.childCount) return false;

  const next = at.parent.child(at.index + 1);
  const blockEnd = at.start + at.block.nodeSize;
  // Again nothing to set: the deletion is entirely after the cursor, so the
  // map leaves it exactly where it was.
  if (next.isLeaf) return tr.delete(blockEnd, blockEnd + next.nodeSize).ok;

  return joinBlocks(tr, at, next, blockEnd + next.nodeSize);
}

/**
 * The run of text immediately before a position, within its own block.
 *
 * Stops at anything that is not text, so an image is a hard boundary: a word
 * deletion that ran through one would delete the image as part of the word,
 * which is not what anybody means by "delete the last word". Adjacent text
 * nodes are walked because a bold word beside a plain one is two nodes and one
 * word.
 */
function textBefore($pos: ResolvedPos): string {
  const parent = $pos.parent;
  const index = $pos.index();
  let text = $pos.textOffset > 0 ? parent.child(index).text!.slice(0, $pos.textOffset) : '';

  for (let i = index - 1; i >= 0; i--) {
    const child = parent.child(i);
    if (!child.isText) break;
    text = child.text! + text;
  }
  return text;
}

const wordChar = /[\p{L}\p{N}_]/u;
const space = /\s/;

/**
 * How much of `text` a word-delete takes off its end.
 *
 * Trailing whitespace first, then a run of one kind: word characters, or
 * punctuation. Deleting the space and then the word is what makes repeated
 * word-deletes move a word at a time rather than alternating between the two.
 */
function wordLengthAtEnd(text: string): number {
  let at = text.length;
  while (at > 0 && space.test(text[at - 1]!)) at--;

  if (at > 0) {
    const word = wordChar.test(text[at - 1]!);
    while (at > 0 && !space.test(text[at - 1]!) && wordChar.test(text[at - 1]!) === word) at--;
  }

  return text.length - at;
}

/** Delete the word before the cursor, or fall back to deleting one character. */
export function deleteWordBackward(tr: EditorTransaction): boolean {
  if (!tr.selection.empty) return deleteSelection(tr);

  const pos = tr.selection.from;
  const length = wordLengthAtEnd(textBefore(resolve(tr.doc, pos)));
  // Nothing text-like before the cursor: an image, or the start of the block.
  // Backspace's answer is the right one for both.
  if (length === 0) return deleteBackward(tr);

  return tr.delete(pos - length, pos).ok;
}

/**
 * Insert plain text, treating its line breaks as paragraph breaks.
 *
 * This is what a paste is reduced to. A paste that *preserved structure* —
 * pasted HTML parsed against the schema, a list staying a list — is a
 * different piece of work: it needs a DOM parser and slices with open ends,
 * neither of which exists yet. Flattening to text is the honest subset, and it
 * never produces a document the schema would refuse.
 */
export function insertPlainText(tr: EditorTransaction, text: string): boolean {
  const lines = text.split(/\r\n?|\n/);
  const first = lines[0] ?? '';

  let changed = first === '' ? deleteSelection(tr) : insertText(tr, first);

  for (let i = 1; i < lines.length; i++) {
    if (!insertParagraph(tr)) break;
    changed = true;
    const line = lines[i]!;
    if (line !== '') insertText(tr, line);
  }

  // A paste is one undoable thing, and the typing after it is another.
  if (changed) tr.closeHistory();
  return changed;
}
