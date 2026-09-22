/**
 * Radio group — the styled half of `createRadioGroup`.
 *
 * The group is a stack, or a row where the markup says so; each radio is a
 * circle and the words that name it, written the way the primitive's own
 * example writes them — words inside the control, so the control is named by
 * its contents. The primitive writes `data-state` as `checked` or `unchecked`
 * and `data-disabled` when a radio is off, both on the control, and those are
 * the only hooks these rules select on: nothing here reads ARIA, which is
 * there to be spoken rather than styled against.
 *
 * Checked is information, not emphasis, so it is said twice. The fill of the
 * circle is the part a forced palette flattens; the dot inside it is an
 * element of its own, and an element that is there in one state and not in the
 * other survives any palette the reader brings. It is hidden by drawing it in
 * no colour rather than with `display`, so that nothing moves when the choice
 * moves — a background is the one colour a forced palette leaves transparent,
 * which is what lets the same trick work in both.
 *
 * A radio is round because a round control is the one a reader already knows
 * takes one answer; the box next to it, which takes many, is square.
 */

import type { ComponentStyles } from '../css.js';
import { focusRing, forcedFocusRing, transition } from './shared.js';

const root = 'volt-radio-group';
const field = 'volt-radio-field';
const radio = 'volt-radio';
const indicator = 'volt-radio-indicator';
const dot = 'volt-radio-dot';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const radioGroupClasses = { root, field, radio, indicator, dot } as const;

export const radioGroupStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const CHOSEN = `.${radio}[data-state='checked']`;

  return {
    name: 'radio-group',
    classes: radioGroupClasses,
    keyframes: [],

    rules: [
      {
        selector: `.${root}`,
        declarations: {
          display: 'flex',
          'flex-direction': 'column',
          // Each row is as wide as its own words: a row stretched across the
          // group would be a row a press lands on from anywhere on the line.
          'align-items': 'flex-start',
          'row-gap': 'var(--volt-space-3)',
          'column-gap': 'var(--volt-space-5)',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-normal)',
          color: 'var(--volt-color-on-surface)',
        },
      },
      {
        selector: `.${root}[data-orientation='horizontal']`,
        declarations: {
          'flex-direction': 'row',
          // Two or three short answers sit on one line; more than fits still
          // has somewhere to go.
          'flex-wrap': 'wrap',
          'align-items': 'center',
        },
      },

      // The `<label>` around one radio, which is what makes a press on the
      // words count as a press on the circle.
      {
        selector: `.${field}`,
        declarations: { display: 'inline-flex', 'align-items': 'center' },
      },

      {
        selector: `.${radio}`,
        declarations: {
          display: 'inline-flex',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-2)',
          // The focus ring follows these corners, and the ring is around the
          // whole row rather than the circle: the words are part of what is
          // focused, because they are what names it.
          'border-radius': 'var(--volt-radius-1)',
          cursor: 'pointer',
        },
      },
      { selector: `.${radio}:focus-visible`, declarations: { ...focusRing } },
      {
        selector: `.${radio}[data-disabled]`,
        declarations: {
          opacity: 'var(--volt-disabled-opacity)',
          cursor: 'not-allowed',
        },
      },

      {
        selector: `.${indicator}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'center',
          'flex-shrink': '0',
          'inline-size': 'var(--volt-space-5)',
          'block-size': 'var(--volt-space-5)',
          'border-width': 'var(--volt-border-width-1)',
          'border-style': 'solid',
          'border-color': 'var(--volt-color-border-strong)',
          'border-radius': 'var(--volt-radius-full)',
          'background-color': 'var(--volt-color-surface)',
          ...transition('background-color, border-color'),
        },
      },
      {
        selector: `${CHOSEN} .${indicator}`,
        declarations: {
          'background-color': 'var(--volt-color-accent)',
          'border-color': 'var(--volt-color-accent)',
        },
      },

      {
        selector: `.${dot}`,
        declarations: {
          'inline-size': 'var(--volt-space-2)',
          'block-size': 'var(--volt-space-2)',
          'border-radius': 'var(--volt-radius-full)',
          'background-color': 'transparent',
          ...transition('background-color'),
        },
      },
      {
        selector: `${CHOSEN} .${dot}`,
        declarations: { 'background-color': 'var(--volt-color-on-accent)' },
      },
    ],

    forcedColors: [
      { selector: `.${root}`, declarations: { color: 'CanvasText' } },

      // `Field` and `FieldText` rather than `Canvas`: this is an input, and the
      // forced palette keeps a separate pair for the things a user fills in.
      {
        selector: `.${indicator}`,
        declarations: { 'background-color': 'Field', 'border-color': 'FieldText' },
      },
      // A chosen radio differs from an empty one by its fill, and fill is
      // exactly what this mode flattens. The thicker edge is what survives
      // whatever the palette turns the fill into.
      {
        selector: `${CHOSEN} .${indicator}`,
        declarations: {
          'background-color': 'Highlight',
          'border-color': 'Highlight',
          'border-width': 'var(--volt-border-width-2)',
        },
      },
      // The other half, and the one that says which radio is chosen without
      // relying on a fill at all: `HighlightText` so the dot stays legible on
      // the fill it sits in. The empty radio's dot is left transparent, which
      // is the one colour this mode does not replace.
      { selector: `${CHOSEN} .${dot}`, declarations: { 'background-color': 'HighlightText' } },

      // Forced colours has its own word for unavailable, and dimming on top of
      // it only muddies a palette the reader chose for contrast.
      { selector: `.${radio}[data-disabled]`, declarations: { color: 'GrayText', opacity: '1' } },
      {
        selector: `.${radio}[data-disabled] .${indicator}`,
        declarations: { 'border-color': 'GrayText' },
      },

      { selector: `.${radio}:focus-visible`, declarations: { ...forcedFocusRing } },
    ],
  };
})();
