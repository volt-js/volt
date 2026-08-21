/**
 * Popover — the styled half of `createPopover`.
 *
 * The primitive positions with CSS anchor positioning where the browser has
 * it, and says so on the content: `data-anchored="true"` when it wrote
 * `position-anchor` and `position-area` inline, `"false"` when it left the
 * placement to CSS. Both cases are drawn here, because a popover that lands
 * in the top-left corner of the page is what "the fallback is the consumer's
 * problem" looks like from the outside.
 *
 * `data-placement` is on the content and on the arrow, so the arrow can point
 * back at the trigger without JavaScript measuring anything.
 */

import type { ComponentStyles } from '../css.js';
import { animation, focusRing, forcedFocusRing, forcedPanel } from './shared.js';

const content = 'volt-popover-content';
const title = 'volt-popover-title';
const description = 'volt-popover-description';
const arrow = 'volt-popover-arrow';

export const popoverStyles: ComponentStyles = {
  name: 'popover',
  classes: { content, title, description, arrow },

  keyframes: [
    {
      name: 'volt-popover-in',
      steps: [
        { offset: 'from', declarations: { opacity: '0', scale: '0.98' } },
        { offset: 'to', declarations: { opacity: '1', scale: '1' } },
      ],
    },
    {
      name: 'volt-popover-out',
      steps: [
        { offset: 'from', declarations: { opacity: '1', scale: '1' } },
        { offset: 'to', declarations: { opacity: '0', scale: '0.98' } },
      ],
    },
  ],

  rules: [
    {
      selector: `.${content}`,
      declarations: {
        'box-sizing': 'border-box',
        position: 'absolute',
        'max-inline-size': 'min(var(--volt-space-80), calc(100vw - var(--volt-space-8)))',
        'padding-block-start': 'var(--volt-space-4)',
        'padding-block-end': 'var(--volt-space-4)',
        'padding-inline-start': 'var(--volt-space-4)',
        'padding-inline-end': 'var(--volt-space-4)',
        'border-width': 'var(--volt-border-width-1)',
        'border-style': 'solid',
        'border-color': 'var(--volt-color-border)',
        'border-radius': 'var(--volt-radius-2)',
        'background-color': 'var(--volt-color-surface)',
        color: 'var(--volt-color-on-surface)',
        'font-family': 'var(--volt-font-family-sans)',
        'font-size': 'var(--volt-font-size-2)',
        'line-height': 'var(--volt-line-height-normal)',
        'box-shadow': 'var(--volt-elevation-overlay)',
        'z-index': 'var(--volt-z-index-overlay)',
        // The gap between the trigger and the popover, read by the anchored
        // path through `position-area` and by the fallback below.
        'margin-block-start': 'var(--volt-space-2)',
        'margin-block-end': 'var(--volt-space-2)',
      },
    },

    // No anchor positioning: the popover has no idea where its trigger is, so
    // it is placed against the nearest positioned ancestor and the consumer
    // is told, in one place, what to make relative.
    {
      selector: `.${content}[data-anchored='false']`,
      declarations: {
        'inset-block-start': '100%',
        'inset-inline-start': '0',
      },
    },

    { selector: `.${content}[data-state='open']`, declarations: { ...animation('volt-popover-in', 'fast') } },
    { selector: `.${content}[data-state='closed']`, declarations: { ...animation('volt-popover-out', 'fast') } },
    { selector: `.${content}:focus-visible`, declarations: { ...focusRing } },

    {
      selector: `.${title}`,
      declarations: {
        'margin-block-start': '0',
        'margin-block-end': 'var(--volt-space-1)',
        'font-size': 'var(--volt-font-size-3)',
        'font-weight': 'var(--volt-font-weight-semibold)',
        'line-height': 'var(--volt-line-height-tight)',
        color: 'var(--volt-color-on-surface)',
      },
    },
    {
      selector: `.${description}`,
      declarations: {
        'margin-block-start': '0',
        'margin-block-end': '0',
        color: 'var(--volt-color-on-surface-muted)',
      },
    },

    // A square turned forty-five degrees, showing two of its own borders.
    // Drawn on a real element rather than a pseudo-element: the generator
    // hands the consumer markup they can restructure, and a corner they
    // cannot delete is not theirs.
    {
      selector: `.${arrow}`,
      declarations: {
        position: 'absolute',
        'inline-size': 'var(--volt-space-2)',
        'block-size': 'var(--volt-space-2)',
        rotate: '45deg',
        'background-color': 'var(--volt-color-surface)',
        'border-width': 'var(--volt-border-width-1)',
        'border-style': 'solid',
        'border-color': 'var(--volt-color-border)',
      },
    },
    {
      selector: `.${arrow}[data-placement^='bottom']`,
      declarations: {
        'inset-block-start': 'calc(var(--volt-space-1) * -1)',
        'border-block-end-style': 'none',
        'border-inline-end-style': 'none',
      },
    },
    {
      selector: `.${arrow}[data-placement^='top']`,
      declarations: {
        'inset-block-end': 'calc(var(--volt-space-1) * -1)',
        'border-block-start-style': 'none',
        'border-inline-start-style': 'none',
      },
    },
  ],

  forcedColors: [
    {
      selector: `.${content}`,
      declarations: {
        ...forcedPanel,
        'background-color': 'Canvas',
        color: 'CanvasText',
      },
    },
    // The arrow is a drawing of a relationship, and in this palette it is a
    // filled square with a border on two sides — which reads as a corner of
    // the popover, exactly as it does anywhere else.
    {
      selector: `.${arrow}`,
      declarations: {
        'background-color': 'Canvas',
        'border-color': 'CanvasText',
      },
    },
    { selector: `.${content}:focus-visible`, declarations: { ...forcedFocusRing } },
  ],
};
