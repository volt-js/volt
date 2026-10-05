/**
 * Editor — what `<v-editor>` draws round `@voltdev/editor`'s view.
 *
 * Most of it is drawn elsewhere, on purpose. The label, the help, the message
 * and the box the document is typed in are the field's — the editable surface
 * carries `volt-field-control` beside its own class — because a rich text
 * field is a text field with more in the box, and a look written twice drifts.
 * The toolbar's buttons are the toggle group's segmented rows, pressed or not
 * by the same `data-state` the toggle group draws. What is left here is what
 * only an editor has: a row to hold those groups, a box that keeps the spaces
 * typed into it, the words shown in it while it is empty, and the mark on a
 * node selected whole.
 *
 * `volt-editor` is the engine's own class, written on the element it edits
 * whether this package is there or not, and the template writes it too so the
 * server's copy is drawn the same before the engine loads. `volt-selected-node`
 * is the engine's as well — the class it puts on an image or a rule selected
 * whole — and is drawn here because nothing else in the box says so: the
 * browser draws no selection round a node it cannot put a caret in.
 *
 * The document's own blocks — paragraphs, headings, lists — are left to the
 * browser's stylesheet and the page's. A rule here could reach them only
 * through the elements' names, and the markup inside the box is the engine's
 * to choose, not this package's.
 *
 * The words shown in an empty box are a paragraph of their own laid over the
 * document's empty one, in a box the size of the editable one and padded to
 * its edge and padding together, so the two paragraphs start on the same
 * line whatever margins the page gives a paragraph. They are words, not a pseudo-element's
 * content, so a forced palette keeps them and a page restructuring the markup
 * can.
 */

import type { ComponentStyles } from '../css.js';

const toolbar = 'volt-editor-toolbar';
const body = 'volt-editor-body';
const placeholder = 'volt-editor-placeholder';
const surface = 'volt-editor';
const selectedNode = 'volt-selected-node';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const editorClasses = { toolbar, body, placeholder, surface, selectedNode } as const;

export const editorStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const edge = 'var(--volt-border-width-1)';

  return {
    name: 'editor',
    classes: editorClasses,
    keyframes: [],

    rules: [
      {
        selector: `.${toolbar}`,
        declarations: {
          display: 'flex',
          'flex-wrap': 'wrap',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-2)',
          'row-gap': 'var(--volt-space-2)',
        },
      },

      {
        // The ground the empty-box words are laid on; it holds nothing else in
        // the flow, so it is exactly the size of the box.
        selector: `.${body}`,
        declarations: { position: 'relative' },
      },

      {
        selector: `.${surface}`,
        declarations: {
          display: 'block',
          'min-block-size': 'var(--volt-space-20)',
          // Typed spaces are characters here, as they are in a text area: a
          // second space, and one at the end of a line, are kept and shown
          // rather than folded away by the paragraph's own white-space rule.
          'white-space': 'pre-wrap',
          'overflow-wrap': 'break-word',
          cursor: 'text',
        },
      },

      {
        selector: `.${placeholder}`,
        declarations: {
          position: 'absolute',
          'inset-block-start': '0',
          'inset-block-end': '0',
          'inset-inline-start': '0',
          'inset-inline-end': '0',
          'box-sizing': 'border-box',
          // The editable box's padding and its edge, taken together as
          // padding, so what is inside lands where the document's first line
          // does. Not an unpainted border: a forced palette paints a
          // transparent one, and the box would be drawn twice.
          'padding-block-start': `calc(var(--volt-space-2) + ${edge})`,
          'padding-block-end': `calc(var(--volt-space-2) + ${edge})`,
          'padding-inline-start': `calc(var(--volt-space-3) + ${edge})`,
          'padding-inline-end': `calc(var(--volt-space-3) + ${edge})`,
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-normal)',
          color: 'var(--volt-color-on-surface-muted)',
          'white-space': 'pre-wrap',
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          // Laid over the box, and never in the way of a press on it.
          'pointer-events': 'none',
          'user-select': 'none',
        },
      },

      {
        selector: `.${surface} .${selectedNode}`,
        declarations: {
          'outline-width': 'var(--volt-focus-ring-width)',
          'outline-style': 'solid',
          'outline-color': 'var(--volt-color-accent)',
          'outline-offset': 'var(--volt-focus-ring-offset)',
        },
      },
    ],

    forcedColors: [
      // Words a reader is shown and cannot type over: the palette's own word
      // for text that is not the content.
      { selector: `.${placeholder}`, declarations: { color: 'GrayText' } },
      // The palette keeps an outline and repaints it, so the node selected
      // whole is outlined in the palette's colour for a selection.
      { selector: `.${surface} .${selectedNode}`, declarations: { 'outline-color': 'Highlight' } },
    ],
  };
})();
