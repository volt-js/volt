/**
 * Field — the styled half of `createFormField`, and the look every text-shaped
 * control in this package wears.
 *
 * A field is a label, a control, a line of help and a validation message, and
 * the primitive writes what it knows on each: `data-state` as `valid`,
 * `invalid` or `pending`, and `data-dirty`, `data-touched`, `data-required`,
 * `data-disabled`, `data-readonly` where each applies. Nothing here invents a
 * state of its own.
 *
 * Only two of those are drawn, and the choice is the point. Invalid is drawn,
 * because a control the page has rejected has to look rejected — in colour and
 * in the message beside it, which is text and survives any palette. Pending is
 * drawn, faintly, because a field waiting on a server is not yet wrong and
 * must not be dressed as though it were. Dirty and touched are not drawn at
 * all: they say where the user has been, which is the field's business and not
 * the reader's.
 *
 * The control's look lives here rather than in each control's own entry
 * because an input, a textarea, a number field and a password field are one
 * look with different contents — and a look repeated four times is a look that
 * drifts three times.
 */

import type { ComponentStyles } from '../css.js';
import { disabledLook, focusRing, forcedDisabled, forcedFocusRing, transition } from './shared.js';

const root = 'volt-field';
const label = 'volt-field-label';
const control = 'volt-field-control';
const description = 'volt-field-description';
const error = 'volt-field-error';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const fieldClasses = { root, label, control, description, error } as const;

export const fieldStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const INVALID = `.${control}[data-state='invalid']`;
  const PENDING = `.${control}[data-state='pending']`;

  const border = (colour: string) => ({
    'border-block-start-width': 'var(--volt-border-width-1)',
    'border-block-end-width': 'var(--volt-border-width-1)',
    'border-inline-start-width': 'var(--volt-border-width-1)',
    'border-inline-end-width': 'var(--volt-border-width-1)',
    'border-block-start-style': 'solid',
    'border-block-end-style': 'solid',
    'border-inline-start-style': 'solid',
    'border-inline-end-style': 'solid',
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  return {
    name: 'field',
    classes: fieldClasses,
    keyframes: [],

    rules: [
      {
        selector: `.${root}`,
        declarations: {
          display: 'flex',
          'flex-direction': 'column',
          'row-gap': 'var(--volt-space-1)',
          'font-family': 'var(--volt-font-family-sans)',
        },
      },

      {
        selector: `.${label}`,
        declarations: {
          'font-size': 'var(--volt-font-size-2)',
          'font-weight': 'var(--volt-font-weight-medium)',
          'line-height': 'var(--volt-line-height-tight)',
          color: 'var(--volt-color-on-surface)',
        },
      },

      {
        selector: `.${control}`,
        declarations: {
          'box-sizing': 'border-box',
          'inline-size': '100%',
          'min-inline-size': '0',
          'padding-block-start': 'var(--volt-space-2)',
          'padding-block-end': 'var(--volt-space-2)',
          'padding-inline-start': 'var(--volt-space-3)',
          'padding-inline-end': 'var(--volt-space-3)',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-normal)',
          color: 'var(--volt-color-on-surface)',
          'background-color': 'var(--volt-color-surface)',
          ...border('var(--volt-color-border-strong)'),
          'border-start-start-radius': 'var(--volt-radius-1)',
          'border-start-end-radius': 'var(--volt-radius-1)',
          'border-end-start-radius': 'var(--volt-radius-1)',
          'border-end-end-radius': 'var(--volt-radius-1)',
          ...transition('border-color, background-color'),
        },
      },
      { selector: `.${control}:focus-visible`, declarations: { ...focusRing } },
      {
        // `aria-disabled` as well as the property: a control that is not a
        // native one has no property to be disabled with, and the primitive
        // says it both ways on one that has.
        selector: `.${control}:disabled, .${control}[aria-disabled='true']`,
        declarations: { ...disabledLook, 'background-color': 'var(--volt-color-surface-sunken)' },
      },
      {
        // Read-only is not disabled: the value can be selected and copied, and
        // the control keeps its place in the tab order. The surface says it is
        // not yours to change.
        selector: `.${control}[aria-readonly='true']`,
        declarations: { 'background-color': 'var(--volt-color-surface-sunken)' },
      },
      {
        selector: INVALID,
        declarations: {
          'border-block-start-color': 'var(--volt-color-danger)',
          'border-block-end-color': 'var(--volt-color-danger)',
          'border-inline-start-color': 'var(--volt-color-danger)',
          'border-inline-end-color': 'var(--volt-color-danger)',
        },
      },
      {
        // Waiting on a server, and not yet wrong. Drawn as attention rather
        // than as a fault, because dressing it as one would be a lie the page
        // has to take back a moment later.
        selector: PENDING,
        declarations: {
          'border-block-start-color': 'var(--volt-color-accent)',
          'border-block-end-color': 'var(--volt-color-accent)',
          'border-inline-start-color': 'var(--volt-color-accent)',
          'border-inline-end-color': 'var(--volt-color-accent)',
        },
      },

      {
        selector: `.${description}`,
        declarations: {
          'font-size': 'var(--volt-font-size-1)',
          'line-height': 'var(--volt-line-height-normal)',
          color: 'var(--volt-color-on-surface-muted)',
        },
      },
      {
        selector: `.${error}`,
        declarations: {
          'font-size': 'var(--volt-font-size-1)',
          'line-height': 'var(--volt-line-height-normal)',
          color: 'var(--volt-color-danger)',
        },
      },
    ],

    forcedColors: [
      { selector: `.${label}`, declarations: { color: 'CanvasText' } },
      {
        selector: `.${control}`,
        declarations: {
          color: 'CanvasText',
          'background-color': 'Field',
          'border-block-start-color': 'CanvasText',
          'border-block-end-color': 'CanvasText',
          'border-inline-start-color': 'CanvasText',
          'border-inline-end-color': 'CanvasText',
        },
      },
      { selector: `.${control}:focus-visible`, declarations: { ...forcedFocusRing } },
      {
        selector: `.${control}:disabled, .${control}[aria-disabled='true']`,
        declarations: { ...forcedDisabled, 'background-color': 'Field' },
      },
      {
        selector: `.${control}[aria-readonly='true']`,
        declarations: { 'background-color': 'Field' },
      },
      {
        // The palette has no danger colour, and a rejected control still has to
        // look rejected: the edge doubles instead, which is a difference in
        // shape rather than in hue.
        selector: INVALID,
        declarations: {
          'border-block-start-width': 'var(--volt-border-width-2)',
          'border-block-end-width': 'var(--volt-border-width-2)',
          'border-inline-start-width': 'var(--volt-border-width-2)',
          'border-inline-end-width': 'var(--volt-border-width-2)',
        },
      },
      {
        selector: PENDING,
        declarations: {
          'border-block-start-color': 'Highlight',
          'border-block-end-color': 'Highlight',
          'border-inline-start-color': 'Highlight',
          'border-inline-end-color': 'Highlight',
        },
      },
      { selector: `.${description}`, declarations: { color: 'GrayText' } },
      { selector: `.${error}`, declarations: { color: 'CanvasText' } },
    ],
  };
})();
