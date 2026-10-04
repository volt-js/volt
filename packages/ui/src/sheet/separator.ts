/**
 * Separator — the styled half of `createSeparator`.
 *
 * A rule between two things, and — when it has a size to move — a window
 * splitter. The primitive writes `data-orientation` on every one, and on a
 * splitter the `aria-valuenow` that only a separator with a value carries, so
 * that is what the rules for a splitter select on.
 *
 * The line is a border, on the logical edge across which it divides: the
 * block-start edge of a line that runs along the text, the inline-start edge
 * of one that stands across it. A border rather than a filled box, because a
 * forced palette repaints every background as the page beneath it, and a rule
 * drawn as a one-pixel background goes with it; a border is kept, in the
 * palette's own colour for text.
 *
 * Words on the line sit in a gap between two segments of it rather than on a
 * patch of background painted over one long line. A patch is a hole only on
 * the surface its colour happens to match; on a card, a sunken panel or a
 * picture it is a box with the line running into it. Two segments are a gap
 * on every surface.
 *
 * A splitter is something to aim at and something to land on with the
 * keyboard, so it is never as thin as its line: the area around the line is
 * the control, at least eight pixels across, with the line drawn down its
 * middle and a ring round it when it has focus. Under a forced palette its
 * line is twice the weight of a rule's, since the colour that told the two
 * apart is gone and the grab area round it is empty. Its cursor is left
 * alone. A resize cursor promises a drag, and the component has none — moving
 * a pane by pointer needs to know where the panes are, which a separator does
 * not.
 */

import type { ComponentStyles } from '../css.js';
import { focusRing, forcedFocusRing } from './shared.js';

const root = 'volt-separator';
const line = 'volt-separator-line';
const label = 'volt-separator-label';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const separatorClasses = { root, line, label } as const;

export const separatorStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const HORIZONTAL = `.${root}[data-orientation='horizontal']`;
  const VERTICAL = `.${root}[data-orientation='vertical']`;
  /** The one kind of separator with a value, which only the primitive writes. */
  const SPLITTER = `.${root}[aria-valuenow]`;

  /**
   * The line's colour, on both of the edges it might be drawn on.
   *
   * Said for both at once, and only ever by a rule whose selector the
   * forced-colours block restates: a rule that set the colour and had no
   * counterpart there would outrank the block's plainer `.line` and keep a
   * colour the palette was meant to replace.
   */
  const colour = (value: string) => ({
    'border-block-start-color': value,
    'border-inline-start-color': value,
  });

  return {
    name: 'separator',
    classes: separatorClasses,
    keyframes: [],

    rules: [
      {
        // A row, or a column, of the line and the words on it, centred
        // across: the line sits in the middle of a splitter's grab area, and
        // in the middle of the words' line box.
        selector: `.${root}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'flex',
          'flex-direction': 'row',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-3)',
          'row-gap': 'var(--volt-space-2)',
        },
      },
      {
        // Standing across a row of things, it takes the row's height, and it
        // is inline so that it can stand between two words as well; without a
        // row to fill it is a line's height, rather than nothing.
        selector: VERTICAL,
        declarations: {
          display: 'inline-flex',
          'flex-direction': 'column',
          'align-self': 'stretch',
          'vertical-align': 'middle',
          'min-block-size': 'var(--volt-space-4)',
        },
      },

      {
        // The segments share whatever the words leave, so the words sit in
        // the middle; alone, one segment is the whole line.
        selector: `.${line}`,
        declarations: {
          'flex-grow': '1',
          'flex-shrink': '1',
          'flex-basis': '0',
          ...colour('var(--volt-color-border)'),
        },
      },
      {
        selector: `${HORIZONTAL} .${line}`,
        declarations: {
          'min-inline-size': 'var(--volt-space-4)',
          'border-block-start-width': 'var(--volt-border-width-1)',
          'border-block-start-style': 'solid',
        },
      },
      {
        selector: `${VERTICAL} .${line}`,
        declarations: {
          'min-block-size': 'var(--volt-space-2)',
          'border-inline-start-width': 'var(--volt-border-width-1)',
          'border-inline-start-style': 'solid',
        },
      },

      {
        // Small, and quieter than the text either side of it: a label on a
        // rule says where something changes, and is not itself the content.
        selector: `.${label}`,
        declarations: {
          'flex-grow': '0',
          'flex-shrink': '1',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-1)',
          'font-weight': 'var(--volt-font-weight-medium)',
          'line-height': 'var(--volt-line-height-tight)',
          color: 'var(--volt-color-on-surface-muted)',
          'text-align': 'center',
        },
      },

      {
        // The grab area, across the line: something a pointer can land on to
        // give it focus, which a single pixel is not.
        selector: `${HORIZONTAL}[aria-valuenow]`,
        declarations: { 'min-block-size': 'var(--volt-space-2)' },
      },
      {
        selector: `${VERTICAL}[aria-valuenow]`,
        declarations: { 'min-inline-size': 'var(--volt-space-2)' },
      },
      {
        // A control's edge, in the colour every other control's is drawn in:
        // the line is the only thing on screen that says this one moves, and
        // the faint colour of a rule that only divides is too faint for that.
        selector: `${SPLITTER} .${line}`,
        declarations: { ...colour('var(--volt-color-border-strong)') },
      },
      {
        // Inside the grab area rather than round it. A splitter stands flush
        // between two panes, usually in a container that clips — a ring drawn
        // outside it would be cut away on the two sides that meet the edges.
        selector: `${SPLITTER}:focus-visible`,
        declarations: {
          ...focusRing,
          'outline-offset': 'calc(-1 * var(--volt-focus-ring-width))',
        },
      },
      {
        // The line the keys are about to move, marked as well as ringed: the
        // ring is round the grab area, and the line is the thing that moves.
        selector: `${SPLITTER}:focus-visible .${line}`,
        declarations: { ...colour('var(--volt-color-accent)') },
      },
    ],

    forcedColors: [
      { selector: `.${line}`, declarations: { ...colour('CanvasText') } },
      { selector: `${SPLITTER} .${line}`, declarations: { ...colour('CanvasText') } },
      {
        // The stronger colour that told a splitter from a rule is gone, and
        // with it the only sign on screen that this line moves: its grab
        // area is empty. Weight is geometry, which the palette keeps.
        selector: `${HORIZONTAL}[aria-valuenow] .${line}`,
        declarations: { 'border-block-start-width': 'var(--volt-border-width-2)' },
      },
      {
        selector: `${VERTICAL}[aria-valuenow] .${line}`,
        declarations: { 'border-inline-start-width': 'var(--volt-border-width-2)' },
      },
      { selector: `.${label}`, declarations: { color: 'CanvasText' } },
      { selector: `${SPLITTER}:focus-visible`, declarations: { ...forcedFocusRing } },
      {
        // Which splitter the keys will move is information, and the accent
        // that said so is gone: `Highlight` is the palette's word for it.
        selector: `${SPLITTER}:focus-visible .${line}`,
        declarations: { ...colour('Highlight') },
      },
    ],
  };
})();
