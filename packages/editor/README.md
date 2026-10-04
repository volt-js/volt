# @voltdev/editor

A rich-text editor, engine included: an immutable document checked against a
schema, steps that invert and map positions, a state that carries its selection
across every change, the commands typing is made of, `beforeinput` translated
into those commands, an undo history, and a view that renders a document and
keeps the DOM selection and the model's in step. It has no dependencies — not
even on the rest of Volt — so it mounts into any element on any page.

```bash
pnpm add @voltdev/editor@alpha
```

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

Typing, backspace, delete, word deletion, return, Shift-Return and paste work —
a paste of HTML keeps its structure, read through the schema — and so do the
platform's undo and redo keys. Edits cross block boundaries, and an image or a
rule can be selected whole with the arrow keys or a click. Most of what makes
an editor a product does not exist yet — no formatting commands, no keymap
beyond undo and the arrows onto a node, no copying out as HTML, no
serialisation — and the reference lists all of it.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev/reference/editor](https://voltjs.dev/reference/editor)
