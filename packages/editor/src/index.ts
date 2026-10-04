/**
 * @voltdev/editor
 *
 * A rich text editor, engine included.
 *
 * Built in dependency order: document model and schema, then selection, then
 * input, then the interface — the interface being much the smallest part. The
 * hazards are recorded in ROADMAP.md; the ones that decide the design are
 * input-method composition, cross-browser selection, and whether collaborative
 * editing is ever wanted, since that cannot be added to a document model
 * afterwards.
 *
 * **The collaboration verdict, since the roadmap asks for it explicitly: this
 * model can accept collaborative editing later, and the reasoning is in
 * step.ts.** In one sentence: documents are immutable, every change is a step
 * that can be inverted and produces a position map, and `Mapping` already
 * tracks the mirror relationship between a step and its inverse — which is the
 * bookkeeping that a rebase consists of. What is missing is a rebase function
 * and a transport, not a different document model.
 *
 * What exists so far is the model, the schema, resolved positions, the change
 * layer those were built for — steps, position maps and transactions — and the
 * input layer above it: a state that is a document and a selection, the
 * commands an edit is made of, the `beforeinput` translation that turns a
 * browser event into one of them, and the undo history those edits accumulate
 * in. A selection is carried across a change by the same arithmetic as every
 * other position rather than re-read from the DOM, which is the property
 * `state.ts` exists to hold — and the reason an undo here restores the
 * selection the edit began from rather than only the document.
 *
 * On top of that sits the view: `EditorView` renders a document into an
 * element, maps positions across the DOM boundary in both directions, writes
 * the model's selection into the browser's and reads the browser's back, and
 * wires `beforeinput` to the input layer so typing works end to end. It keeps
 * no shadow copy of the document — an update redraws the range the transaction
 * says it rewrote, and nothing else.
 *
 * What the view deliberately does not do is decorations, node views,
 * collaborative cursors and drag and drop; none of them can be added
 * convincingly before there is something to decorate. It does keep the undo
 * history: every state shown passes through the view, so the view records
 * each one, and the platform's undo keys and the `historyUndo` and
 * `historyRedo` input types reach that history with nothing wired by the host
 * — a browser never reports an undo of edits it was not allowed to make, so
 * input.ts reads the keys itself.
 *
 * Slices have open ends, so a replacement whose ends sit in different parents
 * is joined rather than refused — slice.ts has the join rule, the fitting that
 * makes a slice line up, and what is still refused. On that sits a paste that
 * keeps its structure: clipboard.ts reads pasted HTML through the schema into a
 * slice, and the view takes it off the `paste` event and fits it in at the
 * selection, while a paste of plain text arrives as text as it did. Copying
 * out as HTML, and loading a whole document from markup, are not built.
 *
 * A selection is a text range or one node selected whole — selection.ts. Both
 * are mapped, never recomputed; the arrow keys step onto an image or a rule and
 * off it, a click selects one, and typing, return, a paste and the delete keys
 * replace one in one step — a rule with a paragraph holding what was typed, or
 * with nothing — wherever the schema has room for the result, and an undo
 * selects it again.
 *
 * What a toolbar asks for is format.ts: a mark toggled over the selection's
 * text, a block's type changed, blocks wrapped in a quote or a list and
 * lifted out again — and, for each, whether its button is down. Those are
 * commands like the rest, named by a button rather than reached by typing,
 * and the block ones carry the selection across the nodes they rebuild.
 */

export { Mark, sameAttrs, type Attrs } from './mark.js';
export { Fragment, Node, Slice } from './node.js';
export { ContentMatch, contentMatchAt } from './content.js';
export {
  MarkType,
  NodeType,
  Schema,
  type AttributeSpec,
  type MarkSpec,
  type NodeSpec,
  type SchemaSpec,
} from './schema.js';
export { ResolvedPos, resolve } from './position.js';
export {
  AddMarkStep,
  Mapping,
  RemoveMarkStep,
  ReplaceStep,
  Step,
  StepMap,
  Transaction,
  type Assoc,
  type StepResult,
} from './step.js';
export { basicSchema } from './basic.js';
export { EditorState, EditorTransaction, TextSelection, type ChangedRange } from './state.js';
export { EditorSelection, NodeSelection, type SelectionJSON } from './selection.js';
export { findSelection, selectHorizontally, selectVertically } from './selection.js';
export { fitSlice, joinSlice, placeSlice, type FitResult } from './slice.js';
export { basicParseRules, insertSlice, parseSlice, pasteHTML } from './clipboard.js';
export { type ParseOptions, type ParseRule, type ParseRules } from './clipboard.js';
export { EditorHistory, type HistoryOptions } from './history.js';
export {
  deleteBackward,
  deleteForward,
  deleteSelection,
  deleteWordBackward,
  deleteWordForward,
  insertHardBreak,
  insertParagraph,
  insertPlainText,
  insertText,
} from './commands.js';
export { EditorInput, applyInputType, type EditorInputHost } from './input.js';
export { blockActive, listActive, markActive, setBlockType, toggleList, toggleMark, toggleWrap, wrapActive } from './format.js';
export {
  EditorView,
  basicMarkRenderers,
  basicNodeRenderers,
  type DOMBoundaryPoint,
  type EditorRenderers,
  type EditorViewOptions,
  type MarkRenderer,
  type NodeRenderer,
  type NodeRendering,
} from './view.js';

/** Must match the `version` field of this package's `package.json`; a test asserts it. */
export const VERSION = '0.1.0-alpha.1';
