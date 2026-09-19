/**
 * Checkbox — the styled half of `createCheckbox`.
 *
 * The control holds the box and, as the primitive's own example writes it, the
 * words that name it. So the box is drawn on the indicator, a child, and the
 * control is only the row the two sit on; whatever mark the consumer likes
 * goes inside the indicator. The primitive writes `data-state` as `checked`,
 * `unchecked` or `indeterminate` and `data-disabled` when it is off, all on
 * the control, and those are the only hooks these rules select on — nothing
 * here reads ARIA, which is there to be spoken rather than styled against.
 *
 * The mark is hidden by drawing it in no colour rather than with `display`, so
 * that the box does not resize between states and a mark drawn as an SVG keeps
 * its layout. `visibility` would take the box with it: the mark has no element
 * of its own that a selector here could name. It follows that the mark has to
 * be drawn in `currentColor`, which a glyph is and an SVG can be.
 */

import type { ComponentStyles } from '../css.js';
import { focusRing, forcedFocusRing, transition } from './shared.js';

const root = 'volt-checkbox';
const indicator = 'volt-checkbox-indicator';
const field = 'volt-checkbox-field';

/** The box of a control that is checked, or part-checked. */
function checkedBox(): string {
  return ['checked', 'indeterminate']
    .map((state) => `.${root}[data-state='${state}'] .${indicator}`)
    .join(', ');
}

/** Part to class, on its own so that a bundle can take it without the rules. */
export const checkboxClasses = { root, indicator, field } as const;

export const checkboxStyles = /* @__PURE__ */ ((): ComponentStyles => ({
  name: 'checkbox',
  classes: checkboxClasses,
  keyframes: [],

  rules: [
    // The `<label>` around the control. Optional: it sets the type the words
    // are read in, and lines them up with the control when they sit beside it
    // rather than inside it.
    {
      selector: `.${field}`,
      declarations: {
        display: 'inline-flex',
        'align-items': 'center',
        'column-gap': 'var(--volt-space-2)',
        'font-family': 'var(--volt-font-family-sans)',
        'font-size': 'var(--volt-font-size-2)',
        'line-height': 'var(--volt-line-height-normal)',
        color: 'var(--volt-color-on-surface)',
      },
    },

    {
      selector: `.${root}`,
      declarations: {
        display: 'inline-flex',
        'align-items': 'center',
        'column-gap': 'var(--volt-space-2)',
        // The focus ring follows these corners: it hugs the box when the
        // control holds nothing else, and rounds the row when the words are in
        // it too.
        'border-radius': 'var(--volt-radius-1)',
        cursor: 'pointer',
      },
    },

    { selector: `.${root}:focus-visible`, declarations: { ...focusRing } },

    {
      selector: `.${root}[data-disabled]`,
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
        'border-radius': 'var(--volt-radius-1)',
        'background-color': 'var(--volt-color-surface)',
        color: 'transparent',
        ...transition('background-color, border-color'),
      },
    },
    {
      selector: checkedBox(),
      declarations: {
        'background-color': 'var(--volt-color-accent)',
        'border-color': 'var(--volt-color-accent)',
        color: 'var(--volt-color-on-accent)',
      },
    },
  ],

  forcedColors: [
    // `Field` and `FieldText` rather than `Canvas`: this is an input, and the
    // forced palette keeps a separate pair for the things a user fills in.
    // The mark takes the colour of the fill it sits on, because `transparent`
    // is a colour like any other to this mode, and would be replaced with one
    // that shows.
    {
      selector: `.${indicator}`,
      declarations: {
        'background-color': 'Field',
        'border-color': 'FieldText',
        color: 'Field',
      },
    },

    // A checked box differs from an empty one by its fill, and fill is
    // exactly what this mode flattens. The thicker border is the part that
    // survives whatever the user's palette turns the fill into; the mark
    // inside is the other half, and it is `HighlightText` so it stays legible
    // against the fill it sits on.
    {
      selector: checkedBox(),
      declarations: {
        'background-color': 'Highlight',
        'border-color': 'Highlight',
        color: 'HighlightText',
        'border-width': 'var(--volt-border-width-2)',
      },
    },

    { selector: `.${root}[data-disabled]`, declarations: { color: 'GrayText', opacity: '1' } },
    {
      selector: `.${root}[data-disabled] .${indicator}`,
      declarations: { 'border-color': 'GrayText' },
    },

    { selector: `.${root}:focus-visible`, declarations: { ...forcedFocusRing } },
  ],
}))();
