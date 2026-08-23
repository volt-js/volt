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
 * commands an edit is made of, and the `beforeinput` translation that turns a
 * browser event into one of them. A selection is carried across a change by the
 * same arithmetic as every other position rather than re-read from the DOM,
 * which is the property `state.ts` exists to hold.
 *
 * What is still missing is a view, and with it everything that needs one: a
 * document is edited here through transactions and events aimed at an element,
 * but nothing renders it, and nothing keeps a DOM selection in step with the
 * model's. There is no undo *history* either — the inversion undo is built on
 * is here, the stack that would use it is not — and no rich clipboard: a paste
 * is flattened to text, since a paste that kept its structure needs a DOM
 * parser and slices with open ends. A replacement whose ends sit in different
 * parents is refused rather than half-done, for the reason `step.ts` gives.
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
export {
  deleteBackward,
  deleteForward,
  deleteSelection,
  deleteWordBackward,
  insertParagraph,
  insertPlainText,
  insertText,
} from './commands.js';
export { EditorInput, applyInputType, type EditorInputHost } from './input.js';

export const VERSION = '0.1.0';
