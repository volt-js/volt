/**
 * Code — the styled half of `createCode`.
 *
 * Two shapes. Inline, one `<code>` in a sentence, carrying the primitive's
 * `role="code"` and, when one is known, `data-language`. A block, a `<pre>`
 * holding a `<code>`: the primitive writes `data-block` and `data-language` on
 * the `<pre>`, and while the code is wider than the box, `tabindex="0"`,
 * `role="region"` and a name. The markup adds `data-wrap` and
 * `data-line-numbers` to the `<pre>` when it is asked for either, and puts the
 * gutter and the copy button inside it, beside the `<code>`.
 *
 * Inline code is told apart from the sentence around it by its face and a
 * tint. A block is a box with a rounded edge. A forced palette takes the
 * tint away, and the face alone is a weak signal for where `rm -rf` ends and
 * the words about it begin — so there, every part is drawn with an edge
 * instead, which is geometry and survives.
 *
 * The code and the gutter share one grid cell, the gutter laid over the code,
 * so its rows are as wide as the code's lines and wrap where they wrap. The
 * button has a column of its own beside them: in their cell it sat over the
 * end of the first line, and in a block that fits — where nothing scrolls it
 * out from under — that code could never be read. All three are inside the
 * `<pre>`, so the scroll container is the box the button sticks to and a size
 * given to the tag sizes all three.
 *
 * The line numbers are list markers. A marker is a part no selection reaches
 * and no copy includes, and it is counted by the platform's own `list-item`
 * counter — which the gutter resets, or a block inside a numbered list would
 * carry on from the list's count. Each row holds its line's text, laid out
 * and unseen, so that a line soft-wrapped onto three rows pushes the next
 * number down three rows, beside the line it belongs to.
 */

import type { ComponentStyles, Declarations } from '../css.js';
import { focusRing, forcedFocusRing, transition } from './shared.js';

const root = 'volt-code';
const block = 'volt-code-block';
const content = 'volt-code-content';
const lines = 'volt-code-lines';
const line = 'volt-code-line';
const lineText = 'volt-code-line-text';
const copy = 'volt-code-copy';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const codeClasses = { root, block, content, lines, line, lineText, copy } as const;

export const codeStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /**
   * The monospace stack, written here because the token table has no mono
   * family yet. Never `monospace` alone: a family list that is only that
   * keyword is drawn smaller than the text around it, a quirk browsers keep
   * for old pages, and naming a face in front of it switches that off.
   */
  const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

  /** The four corners one at a time, since `border-radius` is a shorthand. */
  const corners = (radius: string): Declarations => ({
    'border-start-start-radius': radius,
    'border-start-end-radius': radius,
    'border-end-start-radius': radius,
    'border-end-end-radius': radius,
  });

  /** The four edges' colour, which is all a forced palette has to restate. */
  const edgeColour = (colour: string): Declarations => ({
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  /** The four edges, at one width, in one style and one colour. */
  const edges = (width: string, style: string, colour: string): Declarations => ({
    'border-block-start-width': width,
    'border-block-end-width': width,
    'border-inline-start-width': width,
    'border-inline-end-width': width,
    'border-block-start-style': style,
    'border-block-end-style': style,
    'border-inline-start-style': style,
    'border-inline-end-style': style,
    ...edgeColour(colour),
  });

  /** The code, or the gutter laid over it, in the one cell the two share. */
  const inCell: Declarations = { 'grid-row-start': '1', 'grid-column-start': '1' };

  /**
   * Room for a number before each line: three digits, the marker's full stop
   * and the space after it, then the block's own padding.
   */
  const GUTTER = 'calc(var(--volt-space-4) + 5ch)';

  return {
    name: 'code',
    classes: codeClasses,
    keyframes: [],

    rules: [
      {
        // A run inside a sentence: the sentence's size scaled for a face that
        // sets larger than the text around it, a tint behind it, and padding
        // that a run broken across two lines repeats on both. The sentence's
        // colour too, so code inside a link is still drawn as the link.
        selector: `.${root}`,
        declarations: {
          'font-family': MONO,
          'font-size': '0.875em',
          'padding-block-start': '0.125em',
          'padding-block-end': '0.125em',
          'padding-inline-start': 'var(--volt-space-1)',
          'padding-inline-end': 'var(--volt-space-1)',
          ...corners('var(--volt-radius-1)'),
          'background-color': 'var(--volt-color-surface-sunken)',
          color: 'inherit',
          'box-decoration-break': 'clone',
          // An identifier longer than the column breaks rather than pushing
          // the page sideways; a short one never does.
          'overflow-wrap': 'anywhere',
        },
      },

      {
        selector: `.${block}`,
        declarations: {
          display: 'grid',
          'box-sizing': 'border-box',
          'margin-block-start': '0',
          'margin-block-end': '0',
          'margin-inline-start': '0',
          'margin-inline-end': '0',
          'padding-block-start': 'var(--volt-space-3)',
          'padding-block-end': 'var(--volt-space-3)',
          'padding-inline-start': 'var(--volt-space-4)',
          'padding-inline-end': 'var(--volt-space-4)',
          ...edges('var(--volt-border-width-1)', 'solid', 'var(--volt-color-border)'),
          ...corners('var(--volt-radius-2)'),
          'background-color': 'var(--volt-color-surface-sunken)',
          color: 'var(--volt-color-on-surface)',
          'font-family': MONO,
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-normal)',
          'text-align': 'start',
          'white-space': 'pre',
          // Both, because one alone makes the other `auto` anyway, and a block
          // given a height from the tag scrolls down as well as across.
          'overflow-x': 'auto',
          'overflow-y': 'auto',
          // Between the code and the copy button's column, which exists only
          // while there is a button: with none there is one column, and no
          // gap beside it.
          'column-gap': 'var(--volt-space-3)',
        },
      },
      // Only ever focusable while it scrolls, which is when the primitive
      // gives it a tab stop: the ring is where the arrow keys are going to act.
      { selector: `.${block}:focus-visible`, declarations: { ...focusRing } },

      {
        // `anywhere` rather than `break-word`, because it is the one that
        // counts toward the narrowest the line can be: a URL as long as the
        // box is wide would otherwise hold the box open and scroll after all.
        selector: `.${block}[data-wrap]`,
        declarations: { 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' },
      },
      {
        selector: `.${block}[data-line-numbers]`,
        declarations: { 'padding-inline-start': GUTTER },
      },

      {
        // The browser draws `<code>` in `monospace` alone, which is the
        // quirk the block's own family is there to avoid.
        selector: `.${content}`,
        declarations: { ...inCell, 'font-family': 'inherit', 'font-size': 'inherit' },
      },

      {
        // Under the code rather than beside it, and out of the pointer's way:
        // a drag that starts over a number selects code, not the gutter.
        selector: `.${lines}`,
        declarations: {
          ...inCell,
          'counter-reset': 'list-item',
          'pointer-events': 'none',
          'user-select': 'none',
        },
      },
      {
        // Numbers are right-aligned against the code by being outside markers,
        // which hang from the start of the row. At least a line tall, so an
        // empty line still takes its row and every number after it stays
        // beside its own line.
        selector: `.${line}`,
        declarations: {
          display: 'list-item',
          'list-style-type': 'decimal',
          'list-style-position': 'outside',
          'min-block-size': '1lh',
          color: 'var(--volt-color-on-surface-muted)',
        },
      },
      {
        // Laid out, so it wraps where the line does, and not drawn: the code
        // under it is what is read.
        selector: `.${lineText}`,
        declarations: { visibility: 'hidden' },
      },

      {
        // In the top corner of the box, in a column after the code's, and
        // kept in that corner while the code scrolls: sticky inside the scroll
        // container. A block that fits never has code under it; one that
        // scrolls only while the code passing under it is on its way to
        // somewhere it can be read, since at the end of the scroll the button
        // is back in its own column.
        //
        // The insets are nothing because a sticky inset counts from inside the
        // container's padding: anything more moved the button down and in
        // from the corner the moment a block began to scroll.
        selector: `.${copy}`,
        declarations: {
          'grid-row-start': '1',
          'grid-column-start': '2',
          'justify-self': 'end',
          'align-self': 'start',
          position: 'sticky',
          'inset-block-start': '0',
          'inset-inline-end': '0',
          'margin-block-start': '0',
          'margin-block-end': '0',
          'margin-inline-start': '0',
          'margin-inline-end': '0',
          'padding-block-start': 'var(--volt-space-1)',
          'padding-block-end': 'var(--volt-space-1)',
          'padding-inline-start': 'var(--volt-space-2)',
          'padding-inline-end': 'var(--volt-space-2)',
          ...edges('var(--volt-border-width-1)', 'solid', 'var(--volt-color-border)'),
          ...corners('var(--volt-radius-1)'),
          'background-color': 'var(--volt-color-surface)',
          color: 'var(--volt-color-on-surface)',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-1)',
          'font-weight': 'var(--volt-font-weight-medium)',
          'line-height': 'var(--volt-line-height-tight)',
          'white-space': 'nowrap',
          'user-select': 'none',
          cursor: 'pointer',
          ...transition('background-color'),
        },
      },
      {
        selector: `.${copy}:hover`,
        declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
      },
      { selector: `.${copy}:focus-visible`, declarations: { ...focusRing } },
    ],

    forcedColors: [
      {
        // The tint is gone, so the run is boxed: an edge is what still says
        // where the code starts and the sentence resumes. Its text is left to
        // the palette, which draws it as whatever the sentence is — `LinkText`
        // inside a link.
        selector: `.${root}`,
        declarations: {
          ...edges('var(--volt-border-width-1)', 'solid', 'CanvasText'),
          'background-color': 'Canvas',
        },
      },
      {
        selector: `.${block}`,
        declarations: {
          ...edgeColour('CanvasText'),
          'background-color': 'Canvas',
          color: 'CanvasText',
        },
      },
      { selector: `.${block}:focus-visible`, declarations: { ...forcedFocusRing } },
      { selector: `.${line}`, declarations: { color: 'CanvasText' } },
      {
        selector: `.${copy}`,
        declarations: {
          ...edgeColour('ButtonText'),
          'background-color': 'ButtonFace',
          color: 'ButtonText',
        },
      },
      {
        // The hover was a tint as well; here it is the edge that changes.
        selector: `.${copy}:hover`,
        declarations: { ...edgeColour('Highlight') },
      },
      { selector: `.${copy}:focus-visible`, declarations: { ...forcedFocusRing } },
    ],
  };
})();
