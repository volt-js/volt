/**
 * Select — the styled half of `createSelect`.
 *
 * A button that shows the value, over a popup list. The primitive anchors the
 * popup through `createAnchor`, which writes the positioning inline, so where
 * it goes is not this file's business.
 *
 * Two of the things drawn here are information rather than emphasis, and both
 * are drawn in colours a forced palette keeps. Which option is chosen is the
 * obvious one. The other is the highlight: focus never leaves the trigger — it
 * is the element carrying `aria-activedescendant` — so an option under the
 * keyboard has no `:focus` for CSS to find and no ring for the palette to
 * draw. `data-highlighted` is the only mark saying where the keyboard is, and
 * a user who cannot see it is a user who cannot use the list at all.
 *
 * Nothing styles the native `<select>` beneath: the primitive hides it itself,
 * inline, because a form control that submits has to stay in the page.
 */

import type { ComponentStyles } from '../css.js';
import { animation, disabledLook, focusRing, forcedDisabled, forcedFocusRing, forcedPanel, transition } from './shared.js';

const root = 'volt-select';
const trigger = 'volt-select-trigger';
const value = 'volt-select-value';
const arrow = 'volt-select-arrow';
const listbox = 'volt-select-listbox';
const option = 'volt-select-option';
const empty = 'volt-select-empty';
const status = 'volt-select-status';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const selectClasses = {
  root,
  trigger,
  value,
  arrow,
  listbox,
  option,
  empty,
  status,
} as const;

export const selectStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /** An option that can be chosen; the primitive marks the others. */
  const ENABLED = `.${option}:not([data-disabled])`;
  const CHOSEN = `.${option}[data-state='checked']`;
  const HIGHLIGHTED = `.${option}[data-highlighted]`;

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

  const radius = (token: string) => ({
    'border-start-start-radius': token,
    'border-start-end-radius': token,
    'border-end-start-radius': token,
    'border-end-end-radius': token,
  });

  return {
    name: 'select',
    classes: selectClasses,

    keyframes: [
      {
        name: 'volt-select-in',
        steps: [
          { offset: 'from', declarations: { opacity: '0' } },
          { offset: 'to', declarations: { opacity: '1' } },
        ],
      },
      {
        name: 'volt-select-out',
        steps: [
          { offset: 'from', declarations: { opacity: '1' } },
          { offset: 'to', declarations: { opacity: '0' } },
        ],
      },
    ],

    rules: [
      { selector: `.${root}`, declarations: { display: 'inline-block' } },

      {
        selector: `.${trigger}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'space-between',
          'column-gap': 'var(--volt-space-2)',
          'inline-size': '100%',
          'min-inline-size': 'var(--volt-space-20)',
          'padding-block-start': 'var(--volt-space-2)',
          'padding-block-end': 'var(--volt-space-2)',
          'padding-inline-start': 'var(--volt-space-3)',
          'padding-inline-end': 'var(--volt-space-3)',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-tight)',
          'text-align': 'start',
          color: 'var(--volt-color-on-surface)',
          'background-color': 'var(--volt-color-surface)',
          ...border('var(--volt-color-border-strong)'),
          ...radius('var(--volt-radius-1)'),
          cursor: 'default',
          ...transition('background-color, border-color'),
        },
      },
      {
        selector: `.${trigger}:not([aria-disabled='true']):hover`,
        declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
      },
      { selector: `.${trigger}:focus-visible`, declarations: { ...focusRing } },
      {
        // Open is a state of the control, not only of the popup: the button
        // stays where it is while the list covers the page beneath it.
        selector: `.${trigger}[aria-expanded='true']`,
        declarations: { 'border-block-end-color': 'var(--volt-color-accent)' },
      },
      {
        selector: `.${trigger}[aria-disabled='true']`,
        declarations: { ...disabledLook },
      },
      {
        // Nothing chosen: the words in the button are a prompt, not a value.
        selector: `.${trigger}[data-placeholder] .${value}`,
        declarations: { color: 'var(--volt-color-on-surface-muted)' },
      },

      {
        selector: `.${value}`,
        declarations: {
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          'white-space': 'nowrap',
          'text-overflow': 'ellipsis',
        },
      },

      {
        // A chevron, drawn from two borders of a rotated square, because the
        // sheet has no pseudo-elements to hang one on and an icon font is a
        // dependency a stylesheet has no business adding.
        selector: `.${arrow}`,
        declarations: {
          'box-sizing': 'border-box',
          'flex-shrink': '0',
          'inline-size': 'var(--volt-space-2)',
          'block-size': 'var(--volt-space-2)',
          'border-block-end-width': 'var(--volt-border-width-2)',
          'border-inline-end-width': 'var(--volt-border-width-2)',
          'border-block-end-style': 'solid',
          'border-inline-end-style': 'solid',
          'border-block-end-color': 'var(--volt-color-on-surface-muted)',
          'border-inline-end-color': 'var(--volt-color-on-surface-muted)',
          rotate: '45deg',
          'translate': '0 -25%',
          ...transition('rotate'),
        },
      },
      {
        selector: `.${trigger}[aria-expanded='true'] .${arrow}`,
        declarations: { rotate: '225deg', translate: '0 25%' },
      },

      {
        selector: `.${listbox}`,
        declarations: {
          'box-sizing': 'border-box',
          position: 'fixed',
          'min-inline-size': 'var(--volt-space-20)',
          'max-block-size': 'calc(100vh - var(--volt-space-8))',
          'overflow-y': 'auto',
          'padding-block-start': 'var(--volt-space-1)',
          'padding-block-end': 'var(--volt-space-1)',
          'padding-inline-start': 'var(--volt-space-1)',
          'padding-inline-end': 'var(--volt-space-1)',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'background-color': 'var(--volt-color-surface)',
          color: 'var(--volt-color-on-surface)',
          ...border('var(--volt-color-border)'),
          ...radius('var(--volt-radius-2)'),
          'box-shadow': 'var(--volt-elevation-overlay)',
          'z-index': 'var(--volt-z-index-overlay)',
        },
      },
      {
        selector: `.${listbox}[data-state='open']`,
        declarations: { ...animation('volt-select-in', 'fast') },
      },
      {
        selector: `.${listbox}[data-state='closed']`,
        declarations: { ...animation('volt-select-out', 'fast') },
      },

      {
        selector: `.${option}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'flex',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-2)',
          'padding-block-start': 'var(--volt-space-2)',
          'padding-block-end': 'var(--volt-space-2)',
          'padding-inline-start': 'var(--volt-space-3)',
          'padding-inline-end': 'var(--volt-space-3)',
          ...radius('var(--volt-radius-1)'),
          cursor: 'default',
          'user-select': 'none',
        },
      },
      {
        // The keyboard's place in the list. Virtual focus, so there is no
        // `:focus` here and nothing a ring could be drawn on.
        selector: HIGHLIGHTED,
        declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
      },
      {
        selector: CHOSEN,
        declarations: {
          'font-weight': 'var(--volt-font-weight-medium)',
          color: 'var(--volt-color-accent)',
        },
      },
      {
        selector: `${CHOSEN}[data-highlighted]`,
        declarations: { 'background-color': 'var(--volt-color-accent-muted)' },
      },
      {
        selector: `${ENABLED}:hover`,
        declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
      },
      {
        selector: `.${option}[data-disabled]`,
        declarations: { ...disabledLook },
      },

      {
        // The polite live region, which says how many options there are and
        // what was chosen. It is rendered whether the popup is open or not —
        // a region that appears together with its message announces nothing —
        // so it has to be there and not be seen, which is what this is.
        selector: `.${status}`,
        declarations: {
          position: 'absolute',
          'inline-size': '1px',
          'block-size': '1px',
          'margin-block-start': '-1px',
          'margin-block-end': '-1px',
          'margin-inline-start': '-1px',
          'margin-inline-end': '-1px',
          'padding-block-start': '0',
          'padding-block-end': '0',
          'padding-inline-start': '0',
          'padding-inline-end': '0',
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          'clip-path': 'inset(50%)',
          'white-space': 'nowrap',
          'border-block-start-width': '0',
          'border-block-end-width': '0',
          'border-inline-start-width': '0',
          'border-inline-end-width': '0',
        },
      },

      {
        selector: `.${empty}`,
        declarations: {
          'padding-block-start': 'var(--volt-space-3)',
          'padding-block-end': 'var(--volt-space-3)',
          'padding-inline-start': 'var(--volt-space-3)',
          'padding-inline-end': 'var(--volt-space-3)',
          'font-size': 'var(--volt-font-size-1)',
          color: 'var(--volt-color-on-surface-muted)',
        },
      },
    ],

    forcedColors: [
      {
        selector: `.${trigger}`,
        declarations: {
          color: 'CanvasText',
          'background-color': 'Canvas',
          'border-block-start-color': 'CanvasText',
          'border-block-end-color': 'CanvasText',
          'border-inline-start-color': 'CanvasText',
          'border-inline-end-color': 'CanvasText',
        },
      },
      {
        selector: `.${trigger}:not([aria-disabled='true']):hover`,
        declarations: { 'background-color': 'Canvas' },
      },
      { selector: `.${trigger}:focus-visible`, declarations: { ...forcedFocusRing } },
      {
        selector: `.${trigger}[aria-expanded='true']`,
        declarations: { 'border-block-end-color': 'Highlight' },
      },
      { selector: `.${trigger}[aria-disabled='true']`, declarations: { ...forcedDisabled } },
      {
        selector: `.${trigger}[data-placeholder] .${value}`,
        declarations: { color: 'GrayText' },
      },
      {
        selector: `.${arrow}`,
        declarations: {
          'border-block-end-color': 'CanvasText',
          'border-inline-end-color': 'CanvasText',
        },
      },
      { selector: `.${listbox}`, declarations: { ...forcedPanel, 'background-color': 'Canvas' } },
      { selector: `.${option}`, declarations: { color: 'CanvasText' } },
      {
        // Both of the states that carry meaning, in the two colours the forced
        // palette has for exactly this: where the keyboard is, and what is
        // already chosen. The hover is handed back — a pointer user can see
        // their own pointer.
        selector: HIGHLIGHTED,
        declarations: { 'background-color': 'Highlight', color: 'HighlightText' },
      },
      {
        selector: CHOSEN,
        declarations: { color: 'LinkText', 'font-weight': 'var(--volt-font-weight-medium)' },
      },
      {
        selector: `${CHOSEN}[data-highlighted]`,
        declarations: { 'background-color': 'Highlight', color: 'HighlightText' },
      },
      { selector: `${ENABLED}:hover`, declarations: { 'background-color': 'Canvas' } },
      { selector: `.${option}[data-disabled]`, declarations: { ...forcedDisabled } },
      { selector: `.${empty}`, declarations: { color: 'GrayText' } },
    ],
  };
})();
