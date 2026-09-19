# Editor

`@voltdev/editor` is a rich-text editor, engine included. It was built in
dependency order — the document model and schema, then the change layer, then
selection and input, and the view last — and the order is the design. What
decides whether an editor works at all is input-method composition,
cross-browser selection and whether collaborative editing is ever wanted, and
the last of those cannot be added to a document model afterwards.

What exists is a core that works end to end: an immutable document checked
against a schema, steps that invert and map positions, a state that carries its
selection across every change, the commands typing is made of, `beforeinput`
translated into those commands, an undo history, and a view that renders a
document, maps positions across the DOM boundary in both directions and keeps
the two selections in step. Typing, backspace, delete, return and paste as
plain text work, and so does undo once a host binds it to a key.

What does not exist yet is most of what makes it a product: no formatting
commands, no keymap, no rich clipboard, no DOM parser, no serialisation, no node
selection, and no edit that crosses a block boundary. [What an editor still
needs](#what-an-editor-still-needs) is the full list. The package is
`0.1.0-alpha.1`, which is what its exported `VERSION` says, and its view is
tested against happy-dom with events built by hand: nothing in its suite runs
in a real browser.

::: warning Not on npm yet
`@voltdev/editor` has not been released — see
[what is on npm](../guide/getting-started#what-is-on-npm). Everything on this
page works from a checkout of the Volt repository.
:::

```ts
import { EditorState, EditorView, basicSchema } from '@voltdev/editor';

const s = basicSchema;
const doc = s.node('doc', null, [
  s.node('heading', { level: 1 }, [s.text('Notes')]),
  s.node('paragraph', null, [s.text('Start typing here.')]),
]);

const view = new EditorView(document.querySelector<HTMLElement>('#editor')!, {
  state: EditorState.create(doc),
});
```

## Putting an editor on a page

```ts
new EditorView(place: HTMLElement, options: EditorViewOptions)
```

| Option | Description |
|---|---|
| `state` | The `EditorState` to show. Required |
| `renderers` | `{ nodes?, marks? }`, merged over the starter renderers. See [rendering](#rendering) |
| `dispatchTransaction` | `(tr, view) => void`. The default applies the transaction and redraws |
| `editable` | Default `true`. `false` sets `contenteditable="false"` and `aria-readonly="true"`: the view still renders and maps positions, and still reads a selection made in it |

| Member | Description |
|---|---|
| `dom` | The editable element — the document node's own rendering, not a wrapper |
| `input` | The [`EditorInput`](#what-typing-does) listening on `dom` |
| `state` | The state on screen |
| `dispatch(tr)` | Hand a transaction to whoever owns state |
| `update(state, tr?)` | Show a new state |
| `focus()` | Focus `dom` and put the caret where the model says |
| `posAtDOM(node, offset)` | The document position a DOM point names, or `null` |
| `domAtPos(pos)` | The DOM point a position names, as a `DOMBoundaryPoint` — `{ node, offset }` — or `null` |
| `destroy()` | Remove the listeners and take `dom` out of the page |

The view appends its element to `place` rather than taking `place` over, and
marks it `contenteditable`, `role="textbox"`, `aria-multiline="true"` and the
class `volt-editor`. With the starter renderers that element is a `div`.

`editable` is read once. There is no way to switch a view between editable and
read-only after it is built, and `update` takes a state, not new options — a
host that needs either builds a second view. A read-only view is
`contenteditable="false"` and keeps `role="textbox"`, with
`aria-readonly="true"` beside it so a screen reader announces a text box that
cannot be typed into rather than one that silently refuses. Its input listener
stays attached — a browser sends a non-editable element no `beforeinput`, but a
selection made in it still arrives as a transaction.

## Owning the state

By default a view owns its state: an edit becomes a transaction, the view
applies it, and the screen follows. A host that wants to see every change — to
record undo history, to save, later to send it somewhere — takes over
`dispatchTransaction` and calls `update` itself. That is the only way a view can
display a state it does not own.

```ts
import { EditorState, EditorView } from '@voltdev/editor';

const view = new EditorView(host, {
  state: EditorState.create(doc),
  dispatchTransaction(tr, view) {
    view.update(view.state.apply(tr), tr);
    if (tr.changed) scheduleSave(view.state.doc);
  },
});
```

**Pass the transaction to `update`.** The view has no virtual DOM and never
compares one document with another; the transaction is what tells it which part
moved, and without one the whole document is drawn again. A transaction that did
not produce the state being shown — one from a different starting document —
gets the full redraw too, rather than a range that means nothing here. The same
full redraw is how a host loads a different document into an existing view:
`view.update(EditorState.create(next))`. [What an update
redraws](#what-an-update-redraws) says how the range is used.

Three consequences of the view not owning its state:

- Input is cancelled before the browser performs it, so a `dispatchTransaction`
  that does not call `update` leaves the screen exactly as it was. Nothing is
  typed until the state arrives.
- A caret moved by a click or an arrow key arrives here as well, as a
  transaction that changes only the selection. `tr.changed` is `false` for it.
- A host that drops those selection-only transactions keeps the model's caret
  where it was. The next keystroke is read against the model, so it types at
  the old caret rather than where the person clicked, and the update after it
  writes that old caret back into the page.

## Undo and redo

```ts
new EditorHistory(options?: HistoryOptions)

interface HistoryOptions {
  now?: () => number;       // default: Date.now
  newGroupDelay?: number;   // default: 500 (ms)
  depth?: number;           // default: 100 units
}
```

| Member | Description |
|---|---|
| `record(tr)` | Take note of a transaction that has been applied — every one, undo's own included |
| `undo(state)` | A transaction taking back the latest unit, or `null`. Throws if `state` does not hold the document this history last recorded |
| `redo(state)` | A transaction putting back the latest undone unit, or `null`. Throws likewise |
| `undoDepth`, `redoDepth` | How many of each are available |
| `clear()` | Forget everything, in both directions |

A `depth` below `1` is raised to `1`. Once `depth` units are kept, recording a
new one forgets the oldest for good.

Nothing here keeps a copy of the document. An undoable unit is the list of
steps that take the document back, so remembering an edit costs the size of the
edit rather than the size of the file.

**An undo is not a rewind.** Restoring the document alone leaves the caret
wherever the inverse steps happened to put it, which after undoing a paragraph
three blocks up is nowhere the person was looking. Each unit remembers the
selection its edit started from and puts it back; a redo returns the caret to
where the edit left it.

Typing groups into one unit by time and place. A transaction joins the open
unit when it arrives within `newGroupDelay` of the unit's last edit and the
range it first replaced touches the range the unit last wrote. Moving the caret
ends the unit, so two runs of typing in different places are two undos. Return,
a paste and a finished composition each close the unit before them and refuse
to be joined by what follows. A transaction that replaced nothing — a mark
added across a range — takes a unit of its own rather than being merged on a
guess, and nothing typed after it joins it either.

A mark step is no place to carry on typing from, and the two directions rule it
out differently. A transaction joins the unit before it only when its own first
step was a replacement, since only a first step is in coordinates the history
can compare. A unit takes joiners only when every step it holds was one, since
the range it carries forward covers the text its mark steps rewrote as well,
and that is a range to redraw rather than a place typing left off. So a
transaction that types at one end of a paragraph and marks text at the other
still joins typing beside where it typed, and nothing joins it afterwards — a
keystroke between its two ends is a unit of its own.

Undoing a mark change gives back the marks that were there. Bold laid over
partly bold text is recorded as steps over the text that was not bold, so
undoing it leaves the rest as it was — see [adding and removing
marks](#adding-and-removing-marks).

The stacks move only in `record`. A transaction `undo` handed out that the
caller then did not apply changes nothing, and an undo cannot be recorded as a
fresh edit and empty the redo stack it was meant to fill.

**Every applied transaction has to be recorded.** The recorded steps are
applied at the positions they were written at, not mapped through anything that
happened since, so they are right for the document the last recorded
transaction produced and for no other. The history keeps that document and
holds the caller to it. `undo` and `redo` throw, saying that what was recorded
no longer applies, when the state they are handed holds a different document —
compared with `eq`, so a rebuilt copy of the same document passes — rather than
take back whatever now sits at the recorded positions. And `record`, handed a
transaction that starts from some other document, forgets both stacks and
starts again from that transaction, which is also what happens when a host
loads a different document into the view and carries on recording.

**Nothing binds it to a key.** The `historyUndo` and `historyRedo` input types
are cancelled like any other the input layer has no command for, because which
surface owns that shortcut is the host's decision. Wiring it is a
`dispatchTransaction` and a listener:

```ts
import { EditorHistory, EditorState, EditorView } from '@voltdev/editor';

const history = new EditorHistory();

const view = new EditorView(host, {
  state: EditorState.create(doc),
  dispatchTransaction(tr, view) {
    view.update(view.state.apply(tr), tr);
    history.record(tr);
  },
});

view.dom.addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
  event.preventDefault();
  const tr = event.shiftKey ? history.redo(view.state) : history.undo(view.state);
  if (tr) view.dispatch(tr);
});
```

Rebasing an undo over someone else's change is not here. It is the
collaborative case, and a separate piece of work.

## What typing does

`EditorInput` listens for `beforeinput` and turns each event into a command run
against a fresh transaction. The view makes one for you; construct your own only
to put input on an element without a view.

| `inputType` | Command | Usually |
|---|---|---|
| `insertText` | `insertText(tr, event.data)` | A character |
| `insertParagraph` | `insertParagraph(tr)` | Return |
| `deleteContentBackward` | `deleteBackward(tr)` | Backspace |
| `deleteContentForward` | `deleteForward(tr)` | Delete |
| `deleteWordBackward` | `deleteWordBackward(tr)` | Option- or Ctrl-Backspace |
| `insertFromPaste` | `insertPlainText(tr, text)` | Paste, as plain text |

**Every other input type is cancelled and dropped.** The model is the truth and
the DOM is a rendering of it. An edit the browser performs that the model never
saw puts every position, selection and history entry out of step with what is on
screen, silently and for good; refusing an edit it cannot express yet is visible
instead, and the person tries something else. In practice that means, today:

- Shift-Return (`insertLineBreak`) does nothing, although the starter schema
  has a `hard_break`.
- Cut (`deleteByCut`) leaves the selection in the document.
- Dropping text or dragging a selection does nothing.
- Accepting a spelling suggestion (`insertReplacementText`) does nothing.
- Deleting a word forwards, or to either end of a line, does nothing.
- The browser's own bold and italic shortcuts (`formatBold`, `formatItalic`)
  and its undo (`historyUndo`) do nothing — see [undo](#undo-and-redo).

A paste reads the `text/plain` on the event's `dataTransfer`, falling back to
`data`: a real paste puts the text on the transfer, and a synthetic event does
the opposite.

The layer never calls `getTargetRanges()`. Every command acts on the model's
selection, so an event whose target is somewhere other than the selection —
an engine that delivers an autocorrection as an `insertText` aimed at the word
before the caret, say — is applied at the selection instead.

**Why `beforeinput` and not `keydown`.** A keystroke is not an edit. The same
key means different things under different layouts, input methods, autocorrect
and dictation, and on a phone there is often no key event at all. `beforeinput`
is defined in terms of the edit about to happen, which is the level this layer
translates at. Shortcuts that really are about keys — a binding for bold — belong
in a separate `keydown` listener, which is the host's today.

### Composition

Between `compositionstart` and `compositionend` an input method is writing
into the DOM, and the intermediate states are a candidate being chosen, not
edits. Cancelling them cancels the composition. So composition input
(`insertCompositionText`, `deleteCompositionText`, `insertFromComposition`) is
let through — recognised by name as well as by the flag, because several
engines send the first one before `compositionstart` — and so is every other
`beforeinput` while a composition runs. When the composition ends its text goes
through `insertText` in one step, as one undo unit, replacing the selection the
composition started from; a composition that ends with no text changes nothing.
The model is behind the DOM for the length of a composition, on purpose. While
it runs, the view neither writes the selection nor reads it back, since moving
it abandons the composition.

**When a composition ends, the view takes back what the input method wrote.**
Once the model has caught up, the node around the selection has its content
emptied and drawn again from the model, so a text node the input method made
for itself — in an empty paragraph there is none to write into, and it has to —
does not stay beside the view's rendering of the same text. That happens for a
composition that ends with no text as well, where nothing is dispatched and
nothing else would redraw what was left on the page. The blocks around that node
keep their elements. The redraw shows the view's state, so a host that owns
dispatch and has not yet called `update` sees the composed text go and come
back with the update. Composition has only been exercised with hand-built
events, never with a real input method.

```ts
applyInputType(tr: EditorTransaction, inputType: string, event?: InputEvent): boolean
```

The translation without the listener, exported so it can be tested without an
event loop and so a keymap can reach the same commands by the same names. It
returns `false` for every type not in the table. Two in the table read their
event, `insertText` and `insertFromPaste`, and both decline without one.
`insertText` declines for an event carrying no text as well, since typing
nothing over a range would delete the range.

```ts
new EditorInput(dom: HTMLElement, host: EditorInputHost)

interface EditorInputHost {
  state(): EditorState;                   // read fresh for every event
  dispatch(tr: EditorTransaction): void;  // never called for a no-op
}
```

| Member | Description |
|---|---|
| `composing` | Whether an input method is mid-composition, and so owns the DOM |
| `destroy()` | Remove the listeners |

It holds no document of its own and asks for the state as each event arrives,
which is what keeps it right when an undo or another change moved the document
between two keystrokes. It never asks the DOM where the selection is; that
comes from the state.

### Commands

A command takes an `EditorTransaction`, tries to write an edit into it, and
returns whether it did. It is a separate layer from input on purpose: which
`inputType` is backspace is browser knowledge, and what backspace does at the
start of a paragraph is document knowledge — and keeping the second apart is
what makes it testable without an event.

| Command | Description |
|---|---|
| `insertText(tr, text)` | Replace the selection with text carrying the marks of the position |
| `insertPlainText(tr, text)` | The same, with line breaks as paragraph breaks — what a paste is reduced to |
| `insertParagraph(tr)` | Split the textblock at the cursor. A selection goes in the same step: the first half is what came before it, the second what came after |
| `deleteSelection(tr)` | Delete the selection, if there is one |
| `deleteBackward(tr)` | The selection, else the grapheme or inline leaf before the cursor, else a join with the textblock before or the removal of a block leaf there |
| `deleteForward(tr)` | The same, forwards |
| `deleteWordBackward(tr)` | The selection, else any whitespace before the cursor and then the word or run of punctuation before that, else what backspace would do |

Every command declines rather than taking a step that changes nothing, and a
command that declines has taken no step at all, so the return value is the
answer to "did anything happen". `insertParagraph` over a selection is one
replacement for that reason: deleting first and then finding the split illegal —
in a schema whose parent cannot hold two of that block — would leave the
deletion behind in a transaction reported as unchanged.

```ts
import { EditorState, TextSelection, basicSchema, insertParagraph, insertText } from '@voltdev/editor';

const s = basicSchema;
const doc = s.node('doc', null, [s.node('paragraph', null, [s.text('Hello')])]);
let state = EditorState.create(doc, TextSelection.create(doc, 6));

const tr = state.tr();
if (insertParagraph(tr) && insertText(tr, 'world')) state = state.apply(tr);

String(state.doc); // 'doc(paragraph("Hello"), paragraph("world"))'
```

Backspace deletes a grapheme cluster rather than a code unit, so a family emoji
goes in one press rather than leaving half a surrogate pair on screen. A word
delete walks the same clusters, classing each by the character it starts with
as a letter, digit or `_`, or not — so the accent of a decomposed `café` and a
letter outside the basic plane are part of their word. Typed text takes its
marks from `ResolvedPos.marks()`, filtered by what the block allows: typing at
the end of a bold run stays bold, typing at the end of a link does not extend
it.

What the commands do at the edges is as much the documentation as what they do
in the middle:

- **A selection whose ends are in different blocks cannot be deleted, typed
  over or split.** Every command declines, for [the replace
  limit](#the-replace-limit). Selecting all of a document of two paragraphs and
  pressing a key does nothing.
- Return keeps the block's type and attributes on both halves, so return at the
  end of a heading makes a second heading. Which type follows which is a policy
  that differs per schema, and belongs to a keymap or a schema rule rather than
  to the operation.
- Return inside a list item splits the item's paragraph and leaves both halves
  in the same item. There is no command that starts a new item or leaves a list.
- Return inside a code block splits it into two code blocks; there is no
  newline in one. A pasted line break does the same.
- Backspace at the start of a block joins it to the textblock before, which
  keeps the first block's type, and removes a block-level leaf such as a rule.
  At the start of the first block in a list item or a blockquote, or after a
  list or a blockquote, it does nothing — and so it does when the joined
  content would be illegal in the first block: a paragraph with bold text in it
  does not join a code block. Delete at the end of a block mirrors all of this.

A split replaces the whole block with two, and a join replaces both blocks with
one, because a boundary cannot be inserted or deleted on its own. That makes
every position inside them collapse to an edge in the map, so these two set the
selection explicitly, computed from what they built. The only other command
that sets it is `insertText` over a range, whose mapped ends would otherwise
select the text it typed; it collapses them to a cursor after that text.

## Rendering

```ts
type NodeRenderer = (node: Node, document: Document) => NodeRendering;
type MarkRenderer = (mark: Mark, document: Document) => HTMLElement;

interface NodeRendering {
  dom: HTMLElement;
  contentDOM?: HTMLElement | null;   // where children go; default: dom, or none for a leaf
}
```

A renderer builds the element and nothing else. The view puts the children in,
because the view is what has to know where each of them landed. `contentDOM`
exists for `<pre><code>`, where the node's element and the element its content
goes into differ. The owning `Document` is passed rather than reached for, so a
view rendering into an iframe works.

`basicNodeRenderers` and `basicMarkRenderers` cover [the starter
schema](#the-starter-schema): `p`, `h1`–`h6` (the level clamped to that range),
`blockquote`, `ul`, `ol` (with `start` only when it is not `1`), `li`,
`pre` around `code`, `hr`, `br` and `img`; and `em`, `strong`, `code` and `a`.
An image with a `null` alt gets no `alt` attribute rather than an empty one,
because the two mean different things to a screen reader. A link's `href` and
an image's `src` are written as the document holds them, with no filtering: a
document from somewhere untrusted needs its `javascript:` links removed before
it is shown, or a renderer of your own that does it.

A type named neither in your renderers nor in those renders as a `div` or `span`
with `data-node-type` (or `data-mark-type`) set to its name — editable,
position-mapped and plainly unstyled, rather than a throw. `EditorRenderers` is
the exported type of the merged set the view keeps; no public signature takes or
returns one.

```ts
import { EditorState, EditorView, type NodeRenderer } from '@voltdev/editor';

const callout: NodeRenderer = (node, document) => {
  const dom = document.createElement('aside');
  dom.className = `callout callout-${String(node.attrs['tone'] ?? 'note')}`;
  return { dom };
};

new EditorView(host, {
  state: EditorState.create(doc),
  renderers: { nodes: { callout } },
});
```

An empty textblock gets a `<br>` so it has a line box to click and type into.
It owns no position, and goes again when the block gets content.

### What an update redraws

The view renders the document once. Afterwards it takes the range the
transaction says it rewrote, in both the new document and the one on screen,
and walks the two down the rendered tree for as long as the change stays
strictly inside one child of the same kind on both sides. Only that node's
affected children are rebuilt. Typing replaces the text node typed into — the
paragraph's element, the list around it and every sibling stay the elements they
were — and a split rebuilds the two blocks it wrote and nothing after them.

That is possible because a rendered node's children line up one-to-one with the
model's, which is also what makes a position walk down the DOM the same walk as
down the document, so neither direction of the mapping searches. Marks are
wrapped inside the one rendered text node rather than being nodes of their own,
first mark outermost; two adjacent runs sharing a mark therefore get an element
each rather than sharing one. That is a slightly redundant tree and an exactly
predictable one.

The range covers what every replacement wrote and the text every mark step
rewrote. A transaction of nothing but mark steps — the
[`makeBold`](#adding-and-removing-marks) below — redraws the text it marked and
leaves the other blocks the elements they were, and a transaction that mixes a
replacement with a mark somewhere else redraws from the first of them to the
last, the blocks in between included.

There are no decorations and no node views. A renderer is called when a node is
first drawn and again whenever the node is rebuilt, and there is no hook for
patching an element in place: a change to a node's attributes rebuilds it and
everything inside it.

## Positions and the DOM selection

`domAtPos(pos)` and `posAtDOM(node, offset)` translate between a document
position and a `{ node, offset }` in the shape `Range` and `Selection` take.
A caret at the end of a text run is put inside the text node rather than on the
element boundary after it, since nothing downstream could tell that from a caret
before whatever follows. A DOM point on something the view does not describe —
the propping `<br>`, an element a renderer built around the content — is read by
climbing to the nearest thing it does. A point outside the editor, or a position
outside the document, gives `null`.

The model's selection is written into the browser's after every update and on
`focus()`, when the editor holds the DOM selection. It is not written when the
selection is somewhere else on the page — an editor nobody is typing in has no
business taking the caret away from whatever has it — and not while an input
method is composing.

The browser's selection is read back on `selectionchange`, which is how a caret
placed by a click, a drag or an arrow key reaches the model: it becomes a
transaction that changes only the selection, dispatched like any other. A read
that agrees with the model dispatches nothing, and that — rather than a flag
set while writing — is what stops the view answering its own writes, because
browsers fire `selectionchange` on a later task, long after any flag has been
cleared.

A selection is always a text selection. An image or a rule cannot be selected as
one object, and a click that lands in one is snapped to the nearest place a
cursor can be.

## Defining a document

```ts
new Schema(spec: SchemaSpec)

interface SchemaSpec {
  nodes: Record<string, NodeSpec>;
  marks?: Record<string, MarkSpec>;
  topNode?: string;   // default: 'doc'
}
```

A schema has to declare a node type called `text`, and its top node — `doc`
unless `topNode` names another — or the constructor throws. It throws too for a
content expression that does not parse or names a type or group that does not
exist, and for a mark name in `marks` or `excludes` that does not exist, since
all of those are mistakes in the schema rather than in a document. Mark types
are ranked in the order they are declared, and that order is how marks nest
when rendered.

| `NodeSpec` field | Description |
|---|---|
| `content` | A content expression — `'block+'`, `'paragraph block*'`, `'inline*'`. Absent means a leaf |
| `marks` | Marks the node's children may carry: `'_'` all, `''` none, or names and groups. Absent: all for inline content, none otherwise |
| `group` | Space-separated groups other content expressions can name |
| `inline` | The node sits in inline content, like an image or a hard break |
| `attrs` | `Record<string, AttributeSpec>`, where `AttributeSpec` is `{ default?: unknown }`. An attribute with no `default` is required |
| `atom` | Treat a node with content as one unit. Read by `NodeType.isAtom` and by nothing else yet |
| `defining` | A node a paste should keep whole. Recorded for the structured paste that does not exist yet; nothing reads it |

| `MarkSpec` field | Description |
|---|---|
| `attrs` | As for nodes |
| `inclusive` | Whether typing at the mark's end continues it. Default `true`; a link wants `false` |
| `excludes` | Marks this one cannot share text with, by name or group. Absent: only another of itself. `''`: none. `'_'`: all |
| `group` | Groups, usable in `excludes` and in a node's `marks` |

Attribute values are `Attrs`, a `Readonly<Record<string, unknown>>`, and are
compared by `sameAttrs(a, b)`, which is shallow. An attribute holding an object
compares by identity, so two runs of text carrying equal-looking object-valued
marks are two runs rather than one.

**A document that violates its schema is refused at construction.** There is no
validate-afterwards path. An editor that can hold an invalid document has to make
every later stage defensive — selection coping with a paragraph inside a
paragraph, the renderer deciding what an unexpected node looks like, a merge
deciding whose invalid document wins — and refusing up front means every node
that exists is legal where it sits. `Schema.node` and `NodeType.create` throw,
naming the type and what they were given, which is a better failure than the same
document being refused three edits later by a step nobody connects to the
mistake. Unknown attributes throw too, so a typo does not persist into every
saved document.

| `Schema` member | Description |
|---|---|
| `nodes`, `marks` | The types, by name |
| `topNodeType` | The type a document is |
| `node(name, attrs?, content?, marks?)` | Create a node, checked |
| `text(text, marks?)` | Create a text node. Empty text is allowed and vanishes in any fragment |
| `mark(name, attrs?)` | Create a mark |
| `nodeType(name)` | The type, or a throw naming it |
| `spec` | The `SchemaSpec` it was built from |

| `NodeType` member | Description |
|---|---|
| `name`, `schema`, `spec`, `groups` | What was declared |
| `isText`, `isInline`, `isBlock`, `isTextblock`, `isLeaf`, `inlineContent` | What kind of node it makes |
| `isAtom` | A leaf, or declared `atom` |
| `hasRequiredAttrs`, `defaultAttrs` | Whether some attribute has no default, and the defaults — which throws when one has none |
| `create(attrs?, content?, marks?)` | Create a node, checked — what `Schema.node` calls |
| `createAndFill(attrs?, content?, marks?)` | Create a node, filling in what the content requires; `null` when nothing can |
| `validContent(fragment)` | Whether a fragment is legal content, marks included |
| `allowsMarkType(type)`, `allowsMarks(marks)`, `allowedMarks(marks)` | What its children may carry, and the subset of a set they may |
| `contentMatch`, `markSet` | The compiled content expression, and the allowed mark types (`null` for all) |

| `MarkType` member | Description |
|---|---|
| `name`, `schema`, `spec`, `groups`, `rank` | What was declared, and its place in the order |
| `inclusive`, `excluded` | Whether typing continues it, and the types it throws off |
| `hasRequiredAttrs` | Whether some attribute has no default |
| `create(attrs?)` | Create a mark, attributes checked |
| `excludes(other)` | Whether it cannot share text with `other` |
| `isInSet(set)` | The mark of this type in a set, or `null` |

`contentMatch`, `markSet` and `excluded` are fields the `Schema` constructor
fills in, because what they refer to can only be resolved once every type
exists. They are `readonly` to everything else, and every type is frozen before
the constructor returns, so an assignment afterwards throws a `TypeError`
rather than changing the rules under the documents already built.

`createAndFill` is the other half of the same idea. Rather than refusing a list
item that holds nothing, it asks the content expression what would make the
content legal and puts that there, before and after what it was given, and
returns `null` only when nothing can. It will not conjure a type with a required
attribute, since there is nothing to fill it with. Attributes are still checked
rather than filled: `createAndFill` on a type whose required attribute is not
given throws, as `create` does, rather than returning `null`.

```ts
import { basicSchema } from '@voltdev/editor';

const item = basicSchema.nodes['list_item']!.createAndFill();
String(item); // 'list_item(paragraph)'
```

Content expressions are sequence, `|`, parentheses and the `*`, `+` and `?`
modifiers; counted repetition (`{2,4}`) is not supported. Each is compiled to a
deterministic automaton when the schema is built, so matching a child afterwards
is a lookup with no backtracking. `ContentMatch` and `contentMatchAt(node, index)`
expose that automaton for code that needs to ask what may come next; nothing in
the package outside the schema calls them yet.

| `ContentMatch` member | Description |
|---|---|
| `validEnd` | Whether the content may stop here |
| `next` | The types that may come next, each with the state it leads to |
| `matchType(type)`, `matchFragment(fragment, start?, end?)` | The state after one type or a run of children, or `null` if they are illegal here |
| `defaultType` | A type that could be created here with no arguments, or `null` |
| `fillBefore(after, toEnd?, startIndex?)` | The shortest run of default nodes that lets `after` follow legally — ending the content if `toEnd` — or `null` |
| `matchFragmentOrFill(fragment)` | The state after a run of children, with filling allowed before them |
| `ContentMatch.empty` | The state of a type that holds nothing — a leaf |

`contentMatchAt(node, index)` is the state after a node's first `index`
children. It is recomputed on every call rather than cached, and throws if the
node's own content is illegal, which a checked node never is.

The filler is the shortest run that works: the search goes breadth-first over
the automaton, so for `'(a b c) | d'` `createAndFill` builds `d`. Among runs of
the same length it takes the one whose types come first — in the expression or,
for a group, in declaration order — which is why an empty `block+` is filled
with a `paragraph`.

### Where the check does not reach

The refusal is enforced by `Schema.node`, `NodeType.create`, `createAndFill`
and `withAttrs`, and by every step, which checks the node it rebuilds before it
returns a document. Marks are held to `excludes` wherever a set is made:
`Schema.text` and the node constructors above build theirs with
`Mark.setFrom`, which throws a `RangeError` for text marked both `code` and
`em`, or carrying two links, and a mark step adds with `Mark.addToSet`.
`Schema.text` cannot know the parent its text is going into, so whether that
parent allows the marks is checked when the text is put in a node.

One route around the check is public. `new Node(...)`, `node.copy(content)`,
`node.mark(marks)` and `node.withText(text)` build a node without looking at
the schema, and `new Mark(type, attrs)` builds a mark without checking its
attributes. They are the unchecked paths a step uses internally; build
documents with `Schema.node` and marks with `Schema.mark`.

`withAttrs(attrs)` is checked, and replaces the attribute set rather than merging
into it: an attribute left out goes back to its default.

### The starter schema

`basicSchema` is a real schema rather than a test fixture:

| Node | Content and attributes |
|---|---|
| `doc` | `block+` |
| `paragraph` | `inline*` |
| `heading` | `inline*`, `level` (default `1`) |
| `blockquote` | `block+` |
| `code_block` | `text*`, no marks |
| `bullet_list`, `ordered_list` | `list_item+`; `ordered_list` has `start` (default `1`) |
| `list_item` | `paragraph block*` |
| `horizontal_rule` | A block leaf |
| `image` | An inline leaf: `src` required, `alt` and `title` default `null` |
| `hard_break` | An inline leaf |

| Mark | Behaviour |
|---|---|
| `em`, `strong` | Inclusive |
| `code` | Excludes every other mark |
| `link` | `href` required, `title`; not inclusive |

The choices in it are the ones a schema author makes anyway. A list item is
`'paragraph block*'` rather than `'block+'`, so normalisation has something
unambiguous to put in an empty one. A code block declares `marks: ''`, which says
"no formatting inside code" structurally instead of filtering it at the input
layer. `image` has a required `src`, which makes it impossible to conjure by
normalisation, deliberately — an image with no source is not a useful thing to
fill a gap with. `heading`, `blockquote`, `code_block` and `list_item` are
declared `defining`, which today changes nothing.

## Reading a document

A document is a tree of immutable `Node`s, and every operation that looks like
a mutation returns a new node sharing everything it did not change. That is the
property the rest of the package spends: an undo entry, a position map and a
collaborative rebase all need a description of *what changed*, and a model that
mutates in place can only answer "look again".

| `Node` member | Description |
|---|---|
| `type`, `attrs`, `content`, `marks` | What it is. `content` is a `Fragment` |
| `text` | On text nodes only. Never empty in a document: `Schema.text('')` makes one, and any fragment drops it |
| `nodeSize` | Positions it takes in its parent: text length, `1` for a leaf, else `2 + contentSize` |
| `contentSize` | Positions its content spans |
| `childCount`, `child(i)`, `maybeChild(i)`, `firstChild`, `lastChild` | Children |
| `isText`, `isInline`, `isBlock`, `isTextblock`, `isLeaf`, `inlineContent` | What kind of node it is |
| `textContent` | All the text, blocks run together |
| `textBetween(from, to, separator?)` | The text of a range; `separator` (default `'\n\n'`) goes between blocks |
| `nodesBetween(from, to, f, startPos?)` | Visit every node overlapping a range; return `false` to skip a node's children |
| `cut(from, to?)` | The node with its content cut to a range |
| `withAttrs(attrs)` | A checked copy with new attributes |
| `copy(content?)`, `mark(marks)`, `withText(text)` | Unchecked copies — see [where the check does not reach](#where-the-check-does-not-reach) |
| `eq(other)`, `sameMarkup(other)` | Structural comparison, and the same without content |

`String(node)` prints the structure — `doc(paragraph(strong("Hello"), " world"))`
— without attributes.

A `Fragment` is the ordered run of children a node's content is stored in.
Fragments share structure: `cut` and `append` return new fragments over the same
child nodes. **Normalisation happens at construction.** `Fragment.from` joins
adjacent text nodes carrying the same marks and drops empty ones, so two runs of
text that differ only in having been stored separately never compare unequal,
and a position walk and a tree walk always agree about how many children there
are.

| `Fragment` member | Description |
|---|---|
| `Fragment.from(nodes)`, `Fragment.empty` | Where fragments come from. The constructor is private, so every fragment — these and each one the methods below return — has been normalised |
| `content`, `size` | The children, and the positions they span |
| `childCount`, `child(i)`, `maybeChild(i)`, `firstChild`, `lastChild`, `forEach(f)` | Children; `forEach` passes each child's offset |
| `findIndex(offset)` | Which child an offset falls in or before, and where that child starts |
| `cut(from, to?)`, `append(other)` | A sub-run, splitting text at the edges; two runs joined |
| `replaceChild(i, node)`, `addToStart(node)`, `addToEnd(node)` | A copy with one child changed or added — normalised, not schema-checked |
| `nodesBetween(from, to, f, parentStart, parent)`, `textBetween(from, to, separator)` | As on `Node`, with every argument required |
| `eq(other)` | Structural comparison |

A `Mark` is formatting that rides on text rather than containing it. A sentence
can be bold from word two and a link from word four, and a tree cannot hold two
ranges that cross, so a mark is a property of the text node and the node splits
where the formatting changes. Mark sets are kept sorted by schema rank, so two
sets with the same marks are the same array in the same order.

| `Mark` member | Description |
|---|---|
| `type`, `attrs` | Its `MarkType`, and its attributes |
| `eq(other)` | Same type and shallowly equal attributes |
| `addToSet(set)` | A new sorted set with this mark in, dropping what it excludes — by default another mark of its own type — or the set unchanged if something in it excludes this one |
| `removeFromSet(set)`, `isInSet(set)` | By value, not by identity |
| `Mark.sameSet(a, b)`, `Mark.setFrom(marks)`, `Mark.none` | Comparing sets; making one from a mark or an array — sorted, the same mark kept once, and a `RangeError` for two that exclude each other; and the empty set |

`MarkType.isInSet(set)` finds a mark by type rather than value, which is how a
link's `href` is read back.

```ts
new Slice(content: Fragment, openStart: number, openEnd: number)
```

A `Slice` is a fragment cut from a document together with `openStart` and
`openEnd`, how many node boundaries were cut through at each edge; `size` is
the positions it inserts, and `Slice.empty` inserts nothing. Steps carry slices.
The model can describe an open slice; it cannot yet apply one, so the only slice
a step accepts today is a closed one, `new Slice(fragment, 0, 0)`.

## Positions

**A position is one integer, not a path.** It counts a walk through the
document's tokens: entering or leaving a node costs one, each character costs
one, and a leaf costs one for the whole node.

```text
0 <p> 1 a 2 b 3 c 4 </p> 5 <p> 6 d 7 e 8 f 9 </p> 10
```

Two paragraphs of three letters make a document of size ten, and `5` is the only
position between them.

A path — child 0, then child 2, then offset 5 — is the obvious way to address a
tree and the wrong one for an editor. Comparing two positions is `a < b` rather
than a walk over two arrays; carrying a position across an insertion three blocks
earlier is one addition rather than a rewrite of the head of every path at every
depth; and a selection is two numbers that stay comparable across every edit,
including edits that arrive from somewhere else.

The price is that `7` says nothing about where it is. `resolve` recovers that by
walking down from the root, which is O(depth) — three or four steps in a real
document — and is paid when a position is used, not every time one is mapped.

```ts
resolve(doc: Node, pos: number): ResolvedPos   // the same as ResolvedPos.resolve(doc, pos)
```

| `ResolvedPos` member | Description |
|---|---|
| `pos`, `depth`, `parentOffset` | The position, how deep it sits, and its offset inside its parent |
| `parent`, `doc`, `node(depth?)` | The nodes it sits inside |
| `index(depth?)`, `indexAfter(depth?)` | The child it is in or before, and the first child entirely after it |
| `start(depth?)`, `end(depth?)` | The first and last positions inside the node at `depth` |
| `before(depth?)`, `after(depth?)` | The positions directly outside it. Throw at depth `0`, which is the document |
| `textOffset` | How far into a text node it is; `0` on a boundary |
| `nodeBefore`, `nodeAfter` | The node on each side, cut if the position is inside it, or `null` |
| `marks()` | The marks a character typed here would carry |
| `sameParent(other)`, `sharedDepth(pos)` | Whether another resolved position has the same parent, and the deepest depth containing a plain position too |

Negative depths count outwards from the position, as array slicing does. A
position outside the document throws a `RangeError`. `marks()` is where the rule
about bold and links lives: on a boundary it takes the marks before and drops any
non-inclusive mark that does not continue after.

## Changing a document

A document is immutable, so a change is not done to one. It is a `Step`, a value
describing a replacement, which turns one document into another. That
indirection buys three things a mutating model cannot have afterwards: undo
without snapshots, since a step inverts itself; positions that survive a change,
since every step produces a map; and a step that can be moved onto a document it
was not written against, which is what a collaborative rebase consists of. A
replacement inverts itself exactly, and so does a mark step, because one whose
opposite would not give the text back is refused — see [adding and removing
marks](#adding-and-removing-marks).

Steps are taken through a `Transaction` — `new Transaction(doc)` works over a
bare document, with no selection — and in an editor that is an
`EditorTransaction` from `state.tr()`:

```ts
import { EditorState, basicSchema } from '@voltdev/editor';

const s = basicSchema;
const state = EditorState.create(
  s.node('doc', null, [s.node('paragraph', null, [s.text('Hello world')])]),
);

const tr = state.tr();
const result = tr.addMark(1, 6, s.mark('strong'));
if (!result.ok) throw new Error(result.reason);

String(state.apply(tr).doc); // 'doc(paragraph(strong("Hello"), " world"))'
```

| `Transaction` member | Description |
|---|---|
| `doc`, `steps`, `changed`, `mapping` | Where it has got to |
| `step(step)` | Take a step, or say why not |
| `replace(from, to, slice?)`, `delete(from, to)` | Replace a range |
| `insertText(pos, text, marks?)` | Insert text. Empty text succeeds and takes no step |
| `addMark(from, to, mark)`, `removeMark(from, to, mark)` | Mark a range, as one step for each run of text that changes — all of them or none |
| `map(pos, assoc?)` | Where a position in the starting document is now |
| `invert(startDoc)` | The steps that undo it, newest first. Replays every step from `startDoc` to find what each one removed |

Every method that takes a step returns a `StepResult`: `{ ok: true, doc }`, or
`{ ok: false, reason }` for a step the document refuses. A refused step leaves the
transaction exactly as it was, so a caller can try something else, and every
caller has to look. A position outside the document is not a refusal — it
throws a `RangeError` from `resolve`, like any other out-of-range position, and
so does any step, or `addMark` or `removeMark`, whose `from` is after its `to`.

| Step | Description |
|---|---|
| `new ReplaceStep(from, to, slice)` | Replace a range with a slice. `from`, `to` and `slice` are readable |
| `new AddMarkStep(from, to, mark)` | Add a mark across a range, moving nothing. `from`, `to` and `mark` are readable |
| `new RemoveMarkStep(from, to, mark)` | Remove one |

| `Step` member | Description |
|---|---|
| `apply(doc)` | A `StepResult` |
| `getMap()` | The `StepMap` saying how it moved positions |
| `invert(doc)` | The step that undoes it, against the document it applied to |
| `map(mapping)` | This step rewritten to apply after `mapping`, or `null` if its range is gone |

### The replace limit

**Both ends of a replacement must resolve into the same parent.** A replacement
that starts in one paragraph and ends in the next is refused, and so is any slice
with open ends. Joining across depths needs open slices the model cannot apply
yet, and a step that quietly produced a document violating its schema would be
worse than one that says it cannot.

This is the limit everything above works around. Splitting and joining
paragraphs are done one level up, replacing whole blocks; a selection spanning
two blocks cannot be deleted; a paste cannot keep its structure.

### Adding and removing marks

A mark step is refused across parents too: bolding a selection that spans two
paragraphs is one step per paragraph, each a range inside one textblock. Past
that, a mark step is held to what a replacement is, and to one thing more:

- **It checks what the parent allows.** `strong` inside a `code_block` is
  refused, naming the block, rather than producing a code block its own schema
  would refuse at construction.
- **A range the wrong way round throws.** `new AddMarkStep(4, 2, …)` and
  `addMark(4, 2, …)` throw a `RangeError`, as a replacement does.
- **A step that would change nothing is refused.** A mark over a range with no
  text in it, or over text that already has it, takes no step, so `tr.changed`
  stays `false` and a history records nothing that undoes nothing.
- **A step whose opposite would not give the text back is refused.**
  `AddMarkStep` inverts to a `RemoveMarkStep` over the same range and the other
  way about, so a step is only taken where that is an undo: an addition over
  text none of which has the mark or one the mark throws off, a removal over
  text all of which has it.

`addMark` and `removeMark` are what make that last rule livable. They split the
range into steps that each pass it: `addMark` first takes off the marks the new
one excludes, one step for each run of text carrying one, then adds the mark to
each run that lacks it, and leaves alone text that has it already or carries a
mark that refuses it; `removeMark` takes one step for each run that carries the
mark. The steps are tried first and taken only if every one applies, so a
refusal leaves the transaction as it was. Undoing bold laid over partly bold
text leaves what was bold; undoing a link laid over another gives the first
back; undoing `code` gives back the emphasis it threw off. Build the steps by
hand only for a range already known to be one run.

```ts
import { EditorView, basicSchema } from '@voltdev/editor';

function makeBold(view: EditorView): boolean {
  const { from, to } = view.state.selection;
  const tr = view.state.tr();
  // Refused for a selection that crosses blocks, a block that does not allow
  // bold, and a range with nothing left to make bold — an empty one included.
  if (!tr.addMark(from, to, basicSchema.mark('strong')).ok) return false;
  view.dispatch(tr);
  return true;
}
```

It is not a toggle — it only adds.

### Position maps

```ts
StepMap.replace(start: number, oldSize: number, newSize: number): StepMap
```

| `StepMap` member | Description |
|---|---|
| `map(pos, assoc?)` | Where `pos` ends up |
| `deletedAt(pos)` | Whether `pos` was strictly inside something replaced |
| `invert()` | The map that undoes this one |
| `StepMap.empty` | The map of a step that moves nothing — every mark step's |

Every step here replaces one range, so `StepMap.replace` is all the package
calls. `new StepMap(ranges)` takes several, each `{ start, oldSize, newSize }`
in order, with every `start` counted in the document the map applies to.

`Assoc` is `-1 | 1`, and it decides two cases, the two where a position has no
single answer. A position exactly where something was inserted into nothing
stays before the insertion with `-1` and moves after it with `1`, the default —
a cursor before an insertion wants the first, the end of a range being typed
into the second. A position strictly inside a replaced range has nowhere of its
own to go and collapses to the edge `assoc` names. A position on either edge of
a replacement stays on that edge whatever `assoc` says.

`Mapping` is a sequence of maps that also records which of them undo each
other. Carrying a position through "a change, then its own undo" must give it
back unchanged, and it does not if the two are treated as unrelated — it
collapses to an edge on the way through the first and never recovers. Recording
the pair lets a position the first took out be found again in what the second
put back, the same distance in. An edge of what the first map removed counts as
taken out when `assoc` leans across it: the deletion leaves such a position
where it was, and the second map then inserts at exactly that point and would
otherwise carry it past everything it put back. The second map was written after
everything between the two, so where it puts the content back already accounts
for them, and a position neither map removed goes through every map as usual.

| `Mapping` member | Description |
|---|---|
| `length`, `mapAt(i)` | The maps |
| `appendMap(map, mirrors?)` | Add one, optionally naming the earlier map it undoes |
| `mirrorOf(i)` | The map that undoes map `i`, if recorded |
| `map(pos, assoc?, from?)` | Carry a position through every map from `from` on |
| `invert()` | The mapping that undoes this one, mirrors included |

The mirror bookkeeping and `Step.map` are there for a rebase, and nothing in the
package uses either yet: a transaction appends its maps with no mirrors, and the
history applies its steps where they were recorded. `ReplaceStep.map` returns
`null` only for a deletion whose range is already gone. An insertion at the
exact point someone else inserted is kept and goes after their text, so of two
people typing at the same place neither loses anything, and a replacement whose
range closed up becomes an insertion of its slice.

## State and selection

```ts
EditorState.create(doc: Node, selection?: TextSelection): EditorState
```

| `EditorState` member | Description |
|---|---|
| `doc`, `selection` | The document, and a selection into it — by default the first place a cursor can go |
| `tr()` | A new `EditorTransaction` from this state. Each call makes a new one |
| `apply(tr)` | The state the transaction leads to |

A state is immutable. Applying a transaction returns a new one, so anyone
holding the old state still holds a consistent pair — which is what a history
entry holds. A transaction that changed nothing gives back the same state.
`apply` throws for a transaction started from a different document, because its
positions mean nothing here. `create` holds the selection it is handed to the
same rule as far as two numbers allow: one that `TextSelection.create` would
not have made for this document — past its end, or on a block boundary where no
cursor belongs — was made for another, and throws a `RangeError`.

**A selection is mapped, never recomputed.** Asking the DOM where the caret is,
or re-deriving it from the new document, is how an editor loses the cursor when
a change arrives from somewhere the caret was not — an undo three blocks up, a
mark added across a range, later a remote edit. The change already says where
every position went, so `EditorTransaction` maps its selection through each step
as the step is taken, and that is the only place a selection changes on its own.

| `TextSelection` member | Description |
|---|---|
| `TextSelection.create(doc, anchor, head?)` | A selection, both ends snapped to where a cursor can be |
| `TextSelection.atStart(doc)` | The first cursor position |
| `anchor`, `head` | Ordered by intent: `anchor` stays put while `head` moves |
| `from`, `to`, `empty` | The same two numbers ordered by position |
| `map(doc, mapping, from?)` | Carried across a change; both ends map with `assoc` `1` |
| `eq(other)` | Both ends equal, so a reversed selection is a different one |
| `toString()` | `cursor(3)` or `selection(2..5)` |

The constructor is private, so every `TextSelection` has been through
`create`. Snapping searches outwards for the nearest position in inline
content, and a stray head is snapped towards the anchor, so a selection shrinks
onto what it covers rather than growing past it. A document with no text
position at all is legal — `doc(horizontal_rule)` satisfies the starter schema —
and gets a clamped position rather than an exception.

| `EditorTransaction` member | Description |
|---|---|
| `startDoc`, `selectionBefore` | Where it began |
| `selection`, `selectionChanged` | Where the selection is now, and whether it moved |
| `setSelection(sel)` | Replace the mapped selection. Later steps map the new one on |
| `closeHistory()`, `historyClosed` | Refuse to be grouped with the change before, or joined by the one after |
| `firstReplacedRange` | The range the first step replaced, in the starting document's coordinates — `null` unless that first step was a replacement |
| `changedRange` | Everything the steps wrote, in the produced document's coordinates: what each replacement put in and the text each mark step rewrote. `null` for a transaction with no steps |

Both ranges are a `ChangedRange`, `{ from, to }`. `new EditorTransaction(state)`
is what `state.tr()` returns.

`setSelection` is for what mapping cannot answer: moving the caret with no edit
at all, which is how the view reports a click; putting a remembered selection
back, which is how the history restores one; and a step that replaced a range
the cursor was strictly inside, so the map's only answer is an edge — splitting
a paragraph is the common case. The two ranges look redundant and are not — the
history compares an incoming `firstReplacedRange` with the previous
`changedRange`, which are coordinates in the same document, and the view redraws
from `changedRange`.

## Hosting it in a component

The package imports nothing from the rest of Volt and ships no component. A
component hands it an element once that element is in the document, which is
what [`onMount`](./component#lifecycle) is for, and destroys it on teardown.
The teardown is registered from a field initializer, because `onMount` runs
after construction, outside the component's scope, where `onCleanup` warns and
registers nothing.

```html
<!-- notes.html -->
<div class="notes" :ref="host"></div>
```

```ts
import { Component, onCleanup, type OnMount } from '@voltdev/core';
import { EditorState, EditorView, basicSchema } from '@voltdev/editor';

@Component({ selector: 'v-notes', templateUrl: './notes.html' })
export class Notes implements OnMount {
  host: HTMLElement | null = null;
  view: EditorView | null = null;

  #teardown = onCleanup(() => this.view?.destroy());

  onMount() {
    if (!this.host) return;
    const doc = basicSchema.node('doc', null, [basicSchema.node('paragraph')]);
    this.view = new EditorView(this.host, { state: EditorState.create(doc) });
  }
}
```

`onMount` is [never queued on a server](./server#what-a-server-does-not-run),
so the same component server-renders
the empty host and builds the editor once it is in a browser. The document
itself is not server-rendered: the view is the only thing that can draw one, and
it needs a DOM.

The state is the view's, not a signal. A component that wants to render
something from it — a word count, an enabled undo button — sets a signal from
`dispatchTransaction`.

## What an editor still needs

The package is a core, and the distance between it and something to put in
front of a writer is large. In roughly the order a product meets them:

- **Edits across blocks.** A replacement whose ends are in different parents is
  refused, so a selection spanning two paragraphs cannot be deleted, typed over
  or pasted into, and a mark cannot be added across it in one step.
- **Formatting and a keymap.** Mark steps exist; no command toggles a mark, no
  key is bound to anything, and undo is wired by the host.
- **Block commands.** Turning a paragraph into a heading, wrapping in a list or a
  blockquote, starting a new list item, lifting out of one, a line break inside
  a block — none exist.
- **The rest of `beforeinput`.** Line breaks, cut, drag and drop, spelling
  replacements, forward and line-wise deletion are all cancelled today, and no
  event's target ranges are read.
- **Input-method composition, proven.** It has only met hand-built events, and
  needs testing in real browsers with real input methods.
- **A read-only mode that can be switched.** `editable` is fixed when the view
  is built.
- **A rich clipboard and a DOM parser.** A paste is flattened to text, and the
  view renders a document but cannot read one back out of HTML, so there is no
  loading from markup either. Both need slices with open ends.
- **Serialisation.** There is no JSON form of a document.
- **Node selection.** An image or a rule cannot be selected as one object.
- **Decorations, node views, drag handles and collaborative cursors.** None of
  them can be added convincingly before there is something to decorate.
- **Collaboration.** The model can accept it: documents are immutable, steps
  invert and map, and `Mapping` records mirrors. What is missing is a rebase
  function, a transport and an authority to order changes, rather than a
  different document model.
- **A component**, with the state as a signal, so a toolbar can be a template.
