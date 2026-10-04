/**
 * Number input — the styled half of `createNumberInput`, less the field.
 *
 * The label, the box, the line of help and the message are the field's, drawn
 * by `field.ts` on the classes every text-shaped control shares: the box is a
 * `.volt-field-control` like an input's, and looks like one. What is this
 * entry's own is the row the box sits in and the two spin buttons at its
 * inline end, which the primitive names and switches off — `disabled` is
 * written on whichever of them has nowhere left to go, and on both while the
 * field is disabled or read-only.
 *
 * The row is a grid rather than a flex line so that the box takes whatever the
 * buttons leave without a rule naming it: its class is the field's, and a rule
 * on it here would be a second file drawing the same part. Logical properties
 * throughout, so the buttons sit at the inline end whichever way the page
 * runs — after the box in a left-to-right page, before it in a right-to-left
 * one — and the order they are written in mirrors with them.
 *
 * A dead button is information rather than emphasis: it says the value is at
 * the end of its range, so it is drawn in `GrayText` once the palette is the
 * user's. The buttons are out of the tab order and hidden from assistive
 * technology, because the spinbutton's own arrow keys do the same job; the
 * ring is still drawn, for the pointer or script that leaves focus on one,
 * since focus nobody can see is focus lost.
 */

import type { ComponentStyles, Declarations } from '../css.js';
import { disabledLook, focusRing, forcedDisabled, forcedFocusRing, transition } from './shared.js';

const root = 'volt-number-input';
const button = 'volt-number-input-button';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const numberInputClasses = { root, button } as const;

export const numberInputStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /** A button with somewhere to go. The primitive disables the other kind. */
  const LIVE = `.${button}:not(:disabled)`;
  const DEAD = `.${button}:disabled`;

  const edges = (colour: string): Declarations => ({
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  return {
    name: 'number-input',
    classes: numberInputClasses,
    keyframes: [],

    rules: [
      {
        // The box, then the two buttons, each as wide as it asks to be. The
        // first track is `minmax(0, 1fr)` rather than `1fr` because the box
        // is `inline-size: 100%` from the field's own rule, and a `1fr` track
        // will not shrink below its content's size.
        selector: `.${root}`,
        declarations: {
          display: 'grid',
          'grid-template-columns': 'minmax(0, 1fr) auto auto',
          'column-gap': 'var(--volt-space-1)',
          'align-items': 'stretch',
        },
      },

      {
        selector: `.${button}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'center',
          'inline-size': 'var(--volt-space-8)',
          'margin-block-start': '0',
          'margin-block-end': '0',
          'margin-inline-start': '0',
          'margin-inline-end': '0',
          'padding-block-start': '0',
          'padding-block-end': '0',
          'padding-inline-start': '0',
          'padding-inline-end': '0',
          'border-block-start-width': 'var(--volt-border-width-1)',
          'border-block-end-width': 'var(--volt-border-width-1)',
          'border-inline-start-width': 'var(--volt-border-width-1)',
          'border-inline-end-width': 'var(--volt-border-width-1)',
          'border-block-start-style': 'solid',
          'border-block-end-style': 'solid',
          'border-inline-start-style': 'solid',
          'border-inline-end-style': 'solid',
          ...edges('var(--volt-color-border-strong)'),
          'border-start-start-radius': 'var(--volt-radius-1)',
          'border-start-end-radius': 'var(--volt-radius-1)',
          'border-end-start-radius': 'var(--volt-radius-1)',
          'border-end-end-radius': 'var(--volt-radius-1)',
          'background-color': 'var(--volt-color-surface)',
          color: 'var(--volt-color-on-surface)',
          'font-family': 'var(--volt-font-family-sans)',
          // A size up from the box: the glyph is a sign, not a word, and at
          // the text's size a minus is a speck.
          'font-size': 'var(--volt-font-size-3)',
          'line-height': '1',
          cursor: 'pointer',
          'user-select': 'none',
          ...transition('background-color, border-color, color'),
        },
      },
      // Guarded, because a dead button that lights up under the pointer looks
      // like it will do something.
      {
        selector: `${LIVE}:hover`,
        declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
      },
      { selector: `.${button}:focus-visible`, declarations: { ...focusRing } },
      { selector: DEAD, declarations: { ...disabledLook } },
    ],

    forcedColors: [
      {
        selector: `.${button}`,
        declarations: {
          color: 'ButtonText',
          'background-color': 'ButtonFace',
          ...edges('ButtonText'),
        },
      },
      // The hover fill is emphasis, and is handed back: a pointer user can
      // see their own pointer.
      { selector: `${LIVE}:hover`, declarations: { 'background-color': 'ButtonFace' } },
      { selector: `.${button}:focus-visible`, declarations: { ...forcedFocusRing } },
      // The palette's own word for unavailable, with the dimming handed back.
      { selector: DEAD, declarations: { ...forcedDisabled } },
    ],
  };
})();
