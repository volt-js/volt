/**
 * Checkbox — the styled half of `createCheckbox`.
 *
 * The box is drawn on the element the user operates, and the tick lives in a
 * child so the consumer can put whatever mark they like in it. The primitive
 * writes `data-state` as `checked`, `unchecked` or `indeterminate` and
 * `data-disabled` when it is off, and those are the only hooks these rules
 * select on — nothing here reads ARIA, which is there to be spoken rather
 * than styled against.
 *
 * The mark is hidden with `visibility` rather than `display`, so that the box
 * does not resize between states and a mark drawn as an SVG keeps its layout.
 */

import type { ComponentStyles } from '../css.js';
import { focusRing, forcedFocusRing, transition } from './shared.js';

const root = 'volt-checkbox';
const indicator = 'volt-checkbox-indicator';
const field = 'volt-checkbox-field';

const CHECKED = `.${root}[data-state='checked'], .${root}[data-state='indeterminate']`;

export const checkboxStyles: ComponentStyles = {
  name: 'checkbox',
  classes: { root, indicator, field },
  keyframes: [],

  rules: [
    // The row a checkbox and its label sit on. Optional, and separate from
    // the control, because a label is the consumer's text in the consumer's
    // element — this only says how the two line up.
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
        color: 'var(--volt-color-on-accent)',
        cursor: 'pointer',
        ...transition('background-color, border-color'),
      },
    },

    { selector: `.${root}:focus-visible`, declarations: { ...focusRing } },

    {
      selector: CHECKED,
      declarations: {
        'background-color': 'var(--volt-color-accent)',
        'border-color': 'var(--volt-color-accent)',
      },
    },

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
        display: 'inline-flex',
        'align-items': 'center',
        'justify-content': 'center',
        'inline-size': '100%',
        'block-size': '100%',
        color: 'currentColor',
        visibility: 'hidden',
      },
    },
    {
      selector: `.${root}[data-state='checked'] .${indicator}, .${root}[data-state='indeterminate'] .${indicator}`,
      declarations: { visibility: 'visible' },
    },
  ],

  forcedColors: [
    // `Field` and `FieldText` rather than `Canvas`: this is an input, and the
    // forced palette keeps a separate pair for the things a user fills in.
    {
      selector: `.${root}`,
      declarations: {
        'background-color': 'Field',
        'border-color': 'FieldText',
        color: 'FieldText',
      },
    },

    // A checked box differs from an empty one by its fill, and fill is
    // exactly what this mode flattens. The thicker border is the part that
    // survives whatever the user's palette turns the fill into; the mark
    // inside is the other half, and it is `HighlightText` so it stays legible
    // against the fill it sits on.
    {
      selector: CHECKED,
      declarations: {
        'background-color': 'Highlight',
        'border-color': 'Highlight',
        color: 'HighlightText',
        'border-width': 'var(--volt-border-width-2)',
      },
    },

    {
      selector: `.${root}[data-disabled]`,
      declarations: {
        'border-color': 'GrayText',
        color: 'GrayText',
        opacity: '1',
      },
    },

    { selector: `.${root}:focus-visible`, declarations: { ...forcedFocusRing } },
  ],
};
