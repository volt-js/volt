/**
 * Popover — the styled half of `createPopover`.
 *
 * The primitive positions with CSS anchor positioning: it writes the scheme,
 * `position-anchor` and `position-area` inline, so where the popover goes is
 * not this file's business. Nothing is said for `data-anchored="false"`. Every
 * current engine anchors, and a popover portalled to `<body>`, as the
 * primitive's own example portals it, has no positioned ancestor that a rule
 * here could place it against.
 *
 * `data-placement` is on the content and on the arrow, so the gap can be left
 * on the side that faces the trigger and the arrow can point back at it
 * without JavaScript measuring anything. It is the placement that was asked
 * for: when the engine takes a fallback instead, nothing on the element
 * changes, and only some engines let a stylesheet ask which it took.
 */

import type { ComponentStyles } from '../css.js';
import { animation, focusRing, forcedFocusRing, forcedPanel } from './shared.js';

const content = 'volt-popover-content';
const title = 'volt-popover-title';
const description = 'volt-popover-description';
const arrow = 'volt-popover-arrow';

/** How far out of the popover's edge the arrow's box is set: half of it. */
const ARROW_OUT = 'calc(var(--volt-space-1) * -1)';
/** The middle of an edge, less half the arrow's box with its borders on. */
const ARROW_CENTRE = 'calc(50% - var(--volt-space-1) - var(--volt-border-width-1))';
/** Clear of the corner's radius, and under all but the narrowest trigger. */
const ARROW_INSET = 'var(--volt-space-3)';

function arrowAt(...placements: string[]): string {
  return placements.map((placement) => `.${arrow}[data-placement='${placement}']`).join(', ');
}

/** Part to class, on its own so that a bundle can take it without the rules. */
export const popoverClasses = { content, title, description, arrow } as const;

export const popoverStyles = /* @__PURE__ */ ((): ComponentStyles => ({
  name: 'popover',
  classes: popoverClasses,

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
        // The gap between the trigger and a popover above or below it. An
        // `offset` given to the primitive is written inline and replaces it.
        'margin-block-start': 'var(--volt-space-2)',
        'margin-block-end': 'var(--volt-space-2)',
      },
    },
    // Beside the trigger the gap is on the other axis, and none is left on
    // this one, where it would push a popover aligned to one of the trigger's
    // edges off that edge.
    {
      selector: `.${content}[data-placement^='left'], .${content}[data-placement^='right']`,
      declarations: {
        'margin-block-start': '0',
        'margin-block-end': '0',
        'margin-inline-start': 'var(--volt-space-2)',
        'margin-inline-end': 'var(--volt-space-2)',
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
    // The edge that faces the trigger, and the two borders that would show
    // inside the popover left undrawn. Physical where the rest of the sheet is
    // logical: `rotate` turns the square the same way whichever way the text
    // runs, and the primitive's `left` and `right` are physical too.
    {
      selector: `.${arrow}[data-placement^='bottom']`,
      declarations: {
        top: ARROW_OUT,
        'border-bottom-style': 'none',
        'border-right-style': 'none',
      },
    },
    {
      selector: `.${arrow}[data-placement^='top']`,
      declarations: {
        bottom: ARROW_OUT,
        'border-top-style': 'none',
        'border-left-style': 'none',
      },
    },
    {
      selector: `.${arrow}[data-placement^='right']`,
      declarations: {
        left: ARROW_OUT,
        'border-top-style': 'none',
        'border-right-style': 'none',
      },
    },
    {
      selector: `.${arrow}[data-placement^='left']`,
      declarations: {
        right: ARROW_OUT,
        'border-bottom-style': 'none',
        'border-left-style': 'none',
      },
    },
    // Along that edge, where the trigger is: the middle for a centred
    // placement, and near the end the popover is aligned to for the others.
    // That end is read in the popover's own direction, which a portalled
    // popover takes from the page; the primitive aligns it in the trigger's,
    // and says nothing here about which physical end that turned out to be.
    { selector: arrowAt('top', 'bottom'), declarations: { 'inset-inline-start': ARROW_CENTRE } },
    {
      selector: arrowAt('top-start', 'bottom-start'),
      declarations: { 'inset-inline-start': ARROW_INSET },
    },
    {
      selector: arrowAt('top-end', 'bottom-end'),
      declarations: { 'inset-inline-end': ARROW_INSET },
    },
    { selector: arrowAt('left', 'right'), declarations: { 'inset-block-start': ARROW_CENTRE } },
    {
      selector: arrowAt('left-start', 'right-start'),
      declarations: { 'inset-block-start': ARROW_INSET },
    },
    {
      selector: arrowAt('left-end', 'right-end'),
      declarations: { 'inset-block-end': ARROW_INSET },
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
}))();
