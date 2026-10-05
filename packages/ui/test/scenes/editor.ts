import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, effect, onCleanup } from '@voltdev/core';
import { EditorState, EditorView, NodeSelection, basicSchema, type Node as Doc } from '@voltdev/editor';
import { createFormField } from '@voltdev/primitives';
import { show, step, type Scene } from '../scene.ts';

const s = basicSchema;

/**
 * `editor.html`, with the engine's own view built over the editable element
 * the way `<v-editor>` builds it: handed the element as the document's own
 * rendering, inside the body that also holds the empty-box words. The class
 * on a node selected whole is the engine's, so the only way to reach the rule
 * for it is to select one through the engine.
 */
@Component({
  selector: 'v-styled-editor',
  render: compileTemplate(`
    <div class="volt-field" :spread="field.fieldProps()">
      <label class="volt-field-label" :ref="label" :spread="field.labelProps()">Notes</label>
      <div class="volt-editor-toolbar" role="toolbar" aria-label="Formatting">
        <div class="volt-toggle-group" data-orientation="horizontal">
          <button type="button" class="volt-toggle" aria-label="Bold" aria-pressed="false" data-state="off">B</button>
        </div>
      </div>
      <div class="volt-editor-body" :ref="body">
        <div :if="empty()" class="volt-editor-placeholder" aria-hidden="true"><p>Write something</p></div>
        <div class="volt-field-control volt-editor" role="textbox" aria-multiline="true"
             :ref="surface" :spread="field.controlProps()"></div>
      </div>
      <p class="volt-field-description" :ref="hint" :spread="field.descriptionProps()">Kept as you write it.</p>
      <p class="volt-field-error" :ref="error" :spread="field.errorMessageProps()"></p>
    </div>
  `),
})
class StyledEditor {
  label = new Signal.State<Element | null>(null);
  body = new Signal.State<HTMLElement | null>(null);
  surface = new Signal.State<HTMLElement | null>(null);
  hint = new Signal.State<Element | null>(null);
  error = new Signal.State<Element | null>(null);

  /** What the engine shows, followed here as `<v-editor>` follows it. */
  state = new Signal.State(EditorState.create(s.node('doc', null, [s.node('paragraph')])));
  view: EditorView | null = null;

  field = createFormField({
    control: () => this.surface.get(),
    label: () => this.label.get(),
    description: () => this.hint.get(),
    errorMessage: () => this.error.get(),
  });

  constructor() {
    effect(() => {
      const surface = this.surface.get();
      const body = this.body.get();
      if (!surface || !body) return;
      const state = Signal.subtle.untrack(() => this.state.get());
      const view = new EditorView(body, {
        state,
        renderers: { nodes: { [state.doc.type.name]: () => ({ dom: surface }) } },
        dispatchTransaction: (tr, on) => {
          const next = on.state.apply(tr);
          on.update(next, tr);
          this.state.set(next);
        },
      });
      this.view = view;
      onCleanup(() => view.destroy());
    });
  }

  empty(): boolean {
    const { doc } = this.state.get();
    const only = doc.childCount === 1 ? doc.firstChild : null;
    return only !== null && only.isTextblock && only.content.size === 0;
  }

  /** Put a document in, as a page writing the editor's value does. */
  load(doc: Doc): void {
    this.view!.update(EditorState.create(doc));
    this.state.set(this.view!.state);
  }
}

export const scene: Scene = (look) => {
  const editor = show(StyledEditor);
  // Empty: the words laid over the box.
  look();
  // A document with an image in it, the image selected whole through the
  // engine, which is what puts its class on it.
  step(() => editor.load(s.node('doc', null, [s.node('paragraph', null, [s.text('a'), s.node('image', { src: 'a.png' })])])));
  step(() => {
    const view = editor.view!;
    view.dispatch(view.state.tr().setSelection(NodeSelection.create(view.state.doc, 2)));
  });
  look();
};
