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
 * these two set the selection explicitly rather than letting it map, computed
 * from the geometry of what was just built rather than guessed.
 *
 * **A block selected whole is replaced by a textblock, or taken away.** An
 * image selected in a paragraph is a range like any other: typing replaces
 * it, and deleting it leaves the caret where it was. A block — a rule, or an
 * image a schema makes a block — is not, because replacing exactly its range
 * with what was typed puts text where only blocks may stand, and deleting a
 * rule that is all a blockquote holds leaves a `block+` empty; the step
 * refuses both. So typing, return, a line break and a plain-text paste put a
 * textblock where the block was, holding what they bring, of the type the
 * parent's content expression takes first at that place — a paragraph, in the
 * starter schema. The delete keys take the block away and put the caret in
 * the nearest text the way the key points, and the other way at the edge of
 * the document. A block its parent cannot do without gives way to an empty
 * textblock instead, as the last of a quote's text leaves one when it is
 * deleted. Where no textblock can stand at all — among a list's items — they
 * decline. Each sets the selection itself: mapped, a replaced block's
 * selection would select what replaced it, and a deleted one's lands after
 * where it was whichever key was pressed.
 */

import { contentMatchAt } from './content.js';
import { Fragment, Slice } from './node.js';
import type { Node } from './node.js';
import { resolve } from './position.js';
import type { ResolvedPos } from './position.js';
import { EditorSelection, NodeSelection, findCaret } from './selection.js';
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

/**
 * The selection, when it is a block selected whole. An inline node selected
 * whole is a range inside a textblock, and every command treats it as one.
 */
function selectedBlock(tr: EditorTransaction): NodeSelection | null {
  const selection = tr.selection;
  return selection instanceof NodeSelection && !selection.node.isInline ? selection : null;
}

/**
 * Textblocks to stand where `parent`'s child at `index` is, one holding each
 * of `contents` in turn, or null where the place takes none that can.
 *
 * Each is of the first textblock type the parent's content expression takes
 * at its point that can hold its content and needs no attribute nobody gave:
 * the place's own default, which is how a schema says what a new block there
 * is. The last is also one the rest of the parent can follow. The earlier
 * ones are each chosen without looking ahead, so in a schema where one choice
 * of type would leave the next line nowhere to go and another would not, a
 * paste declines rather than search every pairing.
 */
function textblocksAt(parent: Node, index: number, contents: readonly Fragment[]): Node[] | null {
  let match = contentMatchAt(parent, index);
  const blocks: Node[] = [];
  for (let i = 0; i < contents.length; i++) {
    const content = contents[i]!;
    const last = i === contents.length - 1;
    const edge = match.next.find(
      ({ type, next }) =>
        type.isTextblock &&
        !type.hasRequiredAttrs &&
        type.validContent(content) &&
        (!last || next.matchFragment(parent.content, index + 1)?.validEnd === true),
    );
    if (!edge) return null;
    blocks.push(edge.type.create(null, content));
    match = edge.next;
  }
  return blocks;
}

/**
 * Put textblocks holding `contents` where a block selected whole is, in one
 * step, with the caret at the end of the last.
 */
function replaceBlock(tr: EditorTransaction, selection: NodeSelection, contents: readonly Fragment[]): boolean {
  const $pos = resolve(tr.doc, selection.from);
  const blocks = textblocksAt($pos.parent, $pos.index(), contents);
  if (!blocks) return false;
  const fragment = Fragment.from(blocks);
  if (!tr.replace(selection.from, selection.to, new Slice(fragment, 0, 0)).ok) return false;
  // The selection's two ends map to the two edges of what went in, which
  // would select it rather than leave a caret to go on typing from.
  tr.setSelection(TextSelection.create(tr.doc, selection.from + fragment.size - 1));
  return true;
}

/**
 * Take a block selected whole away, and put the caret in the nearest text the
 * way `dir` points — or the other way, where the document ends first.
 *
 * Where its parent cannot be left without it, an empty textblock stands in
 * with the caret inside, rather than the parent going too: a quote whose rule
 * is deleted stays a quote, as one whose last paragraph is emptied does.
 */
function deleteBlock(tr: EditorTransaction, selection: NodeSelection, dir: -1 | 1): boolean {
  const { from, to } = selection;
  if (!tr.delete(from, to).ok) return replaceBlock(tr, selection, [Fragment.empty]);
  // With no text left in the document there is nowhere for a caret, so the
  // nearest block left is selected instead.
  tr.setSelection(
    findCaret(tr.doc, from, dir) ?? findCaret(tr.doc, from, dir < 0 ? 1 : -1) ?? EditorSelection.near(tr.doc, from, dir),
  );
  return true;
}

/** Delete the selection, if there is one; a block selected whole leaves the caret the way `dir` points. */
function deleteSelected(tr: EditorTransaction, dir: -1 | 1): boolean {
  const selected = selectedBlock(tr);
  if (selected) return deleteBlock(tr, selected, dir);
  const { from, to, empty } = tr.selection;
  if (empty) return false;
  return tr.delete(from, to).ok;
}

/**
 * Replace whatever is selected with nothing, if anything is. A block selected
 * whole goes as forward delete takes it, the caret in the text after it.
 */
export function deleteSelection(tr: EditorTransaction): boolean {
  return deleteSelected(tr, 1);
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
 * because `Schema.text` cannot check that: it holds the marks to each other,
 * but it does not know the parent the text is going into, and the replacement
 * would then be refused several frames later by `validContent` with a message
 * about content rather than about marks. The filter states the requirement
 * where the node is made instead of relying on an invariant enforced three
 * files away.
 *
 * Over a block selected whole the text goes in a textblock of its own, as the
 * top of this file says, and carries no marks: a block boundary has none to
 * give. Typing nothing there deletes the block, as it deletes a range.
 */
export function insertText(tr: EditorTransaction, text: string): boolean {
  const selected = selectedBlock(tr);
  if (selected) {
    if (text === '') return deleteBlock(tr, selected, 1);
    return replaceBlock(tr, selected, [Fragment.from(tr.doc.type.schema.text(text))]);
  }

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
 *
 * A selection goes in the same step as the split: the first half is what comes
 * before it and the second what comes after. Deleting it as a step of its own
 * and then finding the split illegal — in a parent that cannot hold two of the
 * block — would leave the deletion in a transaction this reports as unchanged.
 *
 * A block selected whole has nothing to split, so return over it is what
 * return over any selection is, the selection replaced by a paragraph break:
 * an empty textblock where the block was, with the caret in it.
 */
export function insertParagraph(tr: EditorTransaction): boolean {
  const selected = selectedBlock(tr);
  if (selected) {
    if (!replaceBlock(tr, selected, [Fragment.empty])) return false;
    tr.closeHistory();
    return true;
  }

  const { from, to, empty } = tr.selection;
  const $from = resolve(tr.doc, from);
  const $to = empty ? $from : resolve(tr.doc, to);
  const depth = $from.depth;
  if (depth === 0 || !$from.parent.isTextblock || !$from.sameParent($to)) return false;

  const block = $from.parent;
  const before = $from.before(depth);
  const after = $from.after(depth);

  // `createAndFill` rather than `create`: a block whose content expression
  // requires something an empty half would not have gets it filled in.
  const first = block.type.createAndFill(block.attrs, block.content.cut(0, $from.parentOffset), block.marks);
  const second = block.type.createAndFill(block.attrs, block.content.cut($to.parentOffset), block.marks);
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
  if (!tr.selection.empty) return deleteSelected(tr, -1);

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
  if (!tr.selection.empty) return deleteSelected(tr, 1);

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

/**
 * The run of text immediately after a position, within its own block.
 *
 * The mirror of `textBefore`, stopping at the same things for the same reason:
 * a word deletion forwards that ran through an image or a hard break would
 * take it as part of the word.
 */
function textAfter($pos: ResolvedPos): string {
  const parent = $pos.parent;
  let index = $pos.index();
  let text = '';
  if ($pos.textOffset > 0) {
    text = parent.child(index).text!.slice($pos.textOffset);
    index++;
  }

  for (let i = index; i < parent.childCount; i++) {
    const child = parent.child(i);
    if (!child.isText) break;
    text += child.text!;
  }
  return text;
}

/**
 * Word boundaries, from the segmenter rather than from a class of characters.
 *
 * A class of characters answers "is this a letter", which is not the
 * question. It cannot see that the apostrophe in "don't" or the point in
 * "3.14" belong to the word around them, and in a script written without
 * spaces it cannot see a word at all: every kana and ideograph is a letter,
 * so a whole Japanese sentence would go in one press. The segmenter knows
 * where words end in each of those, and it already walks graphemes, so an
 * accent written as a combining mark stays with its letter.
 */
const words = new Intl.Segmenter(undefined, { granularity: 'word' });
const space = /^\s+$/u;

/**
 * How much a word delete takes, given the segments in the order the delete
 * walks them — outwards from the cursor.
 *
 * Whitespace first, then one word — or, where there is no word, a run of
 * whatever is neither word nor space: punctuation, symbols, emoji. Taking the
 * space and then the word is what makes repeated word deletes move a word at
 * a time rather than alternating between the two. One word and not a run of
 * them, because in a script without spaces the words sit directly beside each
 * other, and a run would be the sentence again. A run of punctuation, because
 * "..." is three segments and one thing to delete.
 */
function wordSpan(segments: readonly Intl.SegmentData[]): number {
  let length = 0;
  let i = 0;
  while (i < segments.length && space.test(segments[i]!.segment)) length += segments[i++]!.segment.length;

  const first = segments[i];
  if (!first) return length;
  if (first.isWordLike) return length + first.segment.length;

  while (i < segments.length && !segments[i]!.isWordLike && !space.test(segments[i]!.segment)) {
    length += segments[i++]!.segment.length;
  }
  return length;
}

/** How much of `text` a word delete backwards takes off its end. */
function wordLengthAtEnd(text: string): number {
  return wordSpan([...words.segment(text)].reverse());
}

/** How much of `text` a word delete forwards takes off its start. */
function wordLengthAtStart(text: string): number {
  return wordSpan([...words.segment(text)]);
}

/** Delete the word before the cursor, or fall back to deleting one character. */
export function deleteWordBackward(tr: EditorTransaction): boolean {
  if (!tr.selection.empty) return deleteSelected(tr, -1);

  const pos = tr.selection.from;
  const length = wordLengthAtEnd(textBefore(resolve(tr.doc, pos)));
  // Nothing text-like before the cursor: an image, or the start of the block.
  // Backspace's answer is the right one for both.
  if (length === 0) return deleteBackward(tr);

  return tr.delete(pos - length, pos).ok;
}

/**
 * Delete the word after the cursor, or fall back to deleting one character.
 *
 * The same rules as `deleteWordBackward`, walked the other way: whitespace and
 * then a word, a hard boundary at anything that is not text, and at the end of
 * a text block what delete does there — join the block after.
 */
export function deleteWordForward(tr: EditorTransaction): boolean {
  if (!tr.selection.empty) return deleteSelected(tr, 1);

  const pos = tr.selection.from;
  const length = wordLengthAtStart(textAfter(resolve(tr.doc, pos)));
  if (length === 0) return deleteForward(tr);

  return tr.delete(pos, pos + length).ok;
}

/**
 * Break the line without breaking the block — what Shift+Return does.
 *
 * The break is an inline leaf, so it goes in beside the text like a character
 * and the paragraph stays one paragraph: one position wide, one press of
 * backspace to remove, and a boundary a word delete stops at. It is found by
 * the name `hard_break`; a schema with no type of that name, or a block whose
 * content cannot hold one — a code block, which is `text*` — declines, and the
 * person sees nothing happen rather than a split they did not ask for.
 *
 * It carries the marks of the position, because the next character typed
 * reads its marks off the node before it, which is now the break: a bare break
 * at the end of a bold line would end the bold.
 *
 * It closes the undo unit as return does. A line break is where a person
 * stops and looks at what they wrote, and one undo taking back two lines is
 * the complaint return's `closeHistory` exists to prevent.
 *
 * Over a block selected whole the break goes in a textblock of its own, the
 * first the place takes that can hold one, and carries no marks, as typed
 * text there carries none.
 */
export function insertHardBreak(tr: EditorTransaction): boolean {
  const type = tr.doc.type.schema.nodes['hard_break'];
  if (!type) return false;

  const selected = selectedBlock(tr);
  if (selected) {
    if (!replaceBlock(tr, selected, [Fragment.from(type.create())])) return false;
    tr.closeHistory();
    return true;
  }

  const { from, to, empty } = tr.selection;
  const $from = resolve(tr.doc, from);
  const node = type.create(null, null, $from.parent.type.allowedMarks($from.marks()));
  // The step is what knows whether the parent can hold a break, and refuses
  // the replacement where it cannot — in a code block, or between blocks.
  if (!tr.replace(from, to, new Slice(Fragment.from(node), 0, 0)).ok) return false;

  // As in `insertText`: a range's mapped ends would select the break rather
  // than sit after it.
  if (!empty) tr.setSelection(TextSelection.create(tr.doc, tr.selection.to));
  tr.closeHistory();
  return true;
}

/**
 * Insert plain text, treating its line breaks as paragraph breaks.
 *
 * This is what a paste with no structure to keep is reduced to. One carrying
 * HTML the schema can read keeps its structure through clipboard.ts, which the
 * view runs before a paste becomes input; what reaches this has only its text
 * to give, and flattened to text it never produces a document the schema
 * would refuse.
 *
 * Over a block selected whole each line is a textblock in its place, all of
 * them one step: there is no textblock there to split, and a paste is one
 * thing to take back.
 */
export function insertPlainText(tr: EditorTransaction, text: string): boolean {
  const lines = text.split(/\r\n?|\n/);
  const selected = selectedBlock(tr);
  if (selected && text !== '') {
    const schema = tr.doc.type.schema;
    if (!replaceBlock(tr, selected, lines.map((line) => Fragment.from(schema.text(line))))) return false;
    tr.closeHistory();
    return true;
  }

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
