/**
 * Button.
 *
 * The one component here with no primitive behind it: a `<button>` already
 * has the behaviour and the accessibility, and wrapping it would only add a
 * way to get them wrong. What it has instead is two attributes the consumer
 * sets — `data-variant` and `data-size` — chosen over a class per variant so
 * that a variant is a value the markup carries rather than a string somebody
 * has to concatenate correctly.
 */

import type { ComponentStyles } from '../css.js';
import {
  disabledLook,
  disabledSelector,
  ENABLED,
  focusRing,
  forcedDisabled,
  forcedFocusRing,
  transition,
} from './shared.js';

const root = 'volt-button';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const buttonClasses = { root } as const;

export const buttonStyles = /* @__PURE__ */ ((): ComponentStyles => ({
  name: 'button',
  classes: buttonClasses,
  keyframes: [],

  rules: [
    {
      selector: `.${root}`,
      declarations: {
        'box-sizing': 'border-box',
        display: 'inline-flex',
        'align-items': 'center',
        'justify-content': 'center',
        'column-gap': 'var(--volt-space-2)',
        'padding-block-start': 'var(--volt-space-2)',
        'padding-block-end': 'var(--volt-space-2)',
        'padding-inline-start': 'var(--volt-space-4)',
        'padding-inline-end': 'var(--volt-space-4)',
        'border-width': 'var(--volt-border-width-1)',
        'border-style': 'solid',
        'border-color': 'var(--volt-color-border)',
        'border-radius': 'var(--volt-radius-1)',
        'background-color': 'var(--volt-color-surface)',
        color: 'var(--volt-color-on-surface)',
        'font-family': 'var(--volt-font-family-sans)',
        'font-size': 'var(--volt-font-size-2)',
        'font-weight': 'var(--volt-font-weight-medium)',
        'line-height': 'var(--volt-line-height-tight)',
        cursor: 'pointer',
        'user-select': 'none',
        ...transition('background-color, border-color, color'),
      },
    },

    // Guarded, because a disabled control that still lights up under the
    // pointer is a control that looks like it will do something.
    {
      selector: `.${root}${ENABLED}:hover`,
      declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
    },

    { selector: `.${root}:focus-visible`, declarations: { ...focusRing } },

    {
      selector: `.${root}[data-variant='primary']`,
      declarations: {
        'background-color': 'var(--volt-color-accent)',
        'border-color': 'var(--volt-color-accent)',
        color: 'var(--volt-color-on-accent)',
      },
    },
    {
      selector: `.${root}[data-variant='primary']${ENABLED}:hover`,
      declarations: {
        'background-color': 'var(--volt-color-accent-hover)',
        'border-color': 'var(--volt-color-accent-hover)',
      },
    },

    {
      selector: `.${root}[data-variant='danger']`,
      declarations: {
        'background-color': 'var(--volt-color-danger)',
        'border-color': 'var(--volt-color-danger)',
        color: 'var(--volt-color-on-danger)',
      },
    },
    {
      selector: `.${root}[data-variant='danger']${ENABLED}:hover`,
      declarations: {
        'background-color': 'var(--volt-color-danger-hover)',
        'border-color': 'var(--volt-color-danger-hover)',
      },
    },

    {
      selector: `.${root}[data-variant='ghost']`,
      declarations: {
        'background-color': 'transparent',
        'border-color': 'transparent',
      },
    },
    {
      selector: `.${root}[data-variant='ghost']${ENABLED}:hover`,
      declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
    },

    {
      selector: `.${root}[data-size='sm']`,
      declarations: {
        'padding-block-start': 'var(--volt-space-1)',
        'padding-block-end': 'var(--volt-space-1)',
        'padding-inline-start': 'var(--volt-space-3)',
        'padding-inline-end': 'var(--volt-space-3)',
        'font-size': 'var(--volt-font-size-1)',
      },
    },
    {
      selector: `.${root}[data-size='lg']`,
      declarations: {
        'padding-block-start': 'var(--volt-space-3)',
        'padding-block-end': 'var(--volt-space-3)',
        'padding-inline-start': 'var(--volt-space-5)',
        'padding-inline-end': 'var(--volt-space-5)',
        'font-size': 'var(--volt-font-size-3)',
      },
    },

    // Last, so that it beats the variant rules whose selectors are exactly as
    // specific as this one.
    { selector: disabledSelector(`.${root}`), declarations: { ...disabledLook } },
  ],

  forcedColors: [
    {
      selector: `.${root}`,
      declarations: {
        'background-color': 'ButtonFace',
        'border-color': 'ButtonBorder',
        color: 'ButtonText',
      },
    },

    // A ghost button's edge is `transparent`, which this mode paints like any
    // other colour, so the edge comes back whatever is said here. Saying
    // `ButtonBorder` makes it the edge every other button has rather than one
    // the palette guesses at — and it has to be said at the same specificity
    // as the rule that made it transparent, since a media query adds none.
    {
      selector: `.${root}[data-variant='ghost']`,
      declarations: {
        'background-color': 'ButtonFace',
        'border-color': 'ButtonBorder',
      },
    },

    // Emphasis is a fill in both palettes; in this one the fill has to be a
    // system colour, or it is flattened back to `ButtonFace` and primary and
    // secondary become the same button.
    {
      selector: `.${root}[data-variant='primary']`,
      declarations: {
        'background-color': 'Highlight',
        'border-color': 'Highlight',
        color: 'HighlightText',
      },
    },

    // Danger and primary would otherwise be one colour: the forced palette
    // has a single emphasis pair and no red. The double border is the second
    // channel, and it is geometry, which nothing flattens.
    {
      selector: `.${root}[data-variant='danger']`,
      declarations: {
        'background-color': 'Highlight',
        'border-color': 'Highlight',
        color: 'HighlightText',
        'border-style': 'double',
        'border-width': 'var(--volt-border-width-4)',
      },
    },

    // Hover has to be restated for the two filled variants and nowhere else.
    // Forced colours replaces whatever colour wins the cascade, so the hover
    // rules above — which are more specific than the emphasis rules — would
    // otherwise drop a primary button back to `ButtonFace` under the pointer.
    // The underline is the only part of the feedback the palette has room
    // for; it has no spare colour, and it never flattens geometry.
    {
      selector: `.${root}${ENABLED}:hover`,
      declarations: { 'text-decoration-line': 'underline' },
    },
    {
      selector:
        `.${root}[data-variant='primary']${ENABLED}:hover, ` +
        `.${root}[data-variant='danger']${ENABLED}:hover`,
      declarations: {
        'background-color': 'Highlight',
        'border-color': 'Highlight',
        color: 'HighlightText',
      },
    },

    { selector: `.${root}:focus-visible`, declarations: { ...forcedFocusRing } },
    { selector: disabledSelector(`.${root}`), declarations: { ...forcedDisabled } },
  ],
}))();
