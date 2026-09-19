/**
 * Menu — the styled half of `createMenu`.
 *
 * The primitive anchors a dropdown through `createAnchor`, which writes the
 * positioning scheme, `position-anchor` and `position-area` inline, so where
 * the menu goes is not this file's business. Nothing is said for
 * `data-anchored="false"`, as nothing is for the popover.
 *
 * There is no highlighted-item attribute to style. Roving focus moves real
 * focus between items, so the item under the cursor is the focused one and
 * `:focus-visible` is what marks it — which also means a pointer user does not
 * get a focus ring dragged around behind their mouse.
 */

import type { ComponentStyles } from '../css.js';
import { animation, focusRing, forcedFocusRing, forcedPanel } from './shared.js';

const content = 'volt-menu-content';
const item = 'volt-menu-item';
const separator = 'volt-menu-separator';

/**
 * An item that can be chosen. The primitive marks a disabled item with
 * `data-disabled`, and treats a natively `disabled` one the same way.
 */
const ENABLED_ITEM = ':not(:disabled):not([data-disabled])';

/** Both of them, for the rules that draw an item as unavailable. */
function disabledItem(): string {
  return `.${item}:disabled, .${item}[data-disabled]`;
}

/** Part to class, on its own so that a bundle can take it without the rules. */
export const menuClasses = { content, item, separator } as const;

export const menuStyles = /* @__PURE__ */ ((): ComponentStyles => ({
  name: 'menu',
  classes: menuClasses,

  keyframes: [
    {
      name: 'volt-menu-in',
      steps: [
        { offset: 'from', declarations: { opacity: '0', scale: '0.98' } },
        { offset: 'to', declarations: { opacity: '1', scale: '1' } },
      ],
    },
    {
      name: 'volt-menu-out',
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
        // For the context menu, which the consumer places from `position()` —
        // and that is measured against the viewport, not the page. A dropdown
        // never reads this: the primitive writes its own scheme inline.
        position: 'fixed',
        'min-inline-size': 'var(--volt-space-20)',
        'max-inline-size': 'min(var(--volt-space-80), calc(100vw - var(--volt-space-8)))',
        'max-block-size': 'calc(100vh - var(--volt-space-8))',
        'overflow-y': 'auto',
        'padding-block-start': 'var(--volt-space-1)',
        'padding-block-end': 'var(--volt-space-1)',
        'padding-inline-start': 'var(--volt-space-1)',
        'padding-inline-end': 'var(--volt-space-1)',
        'background-color': 'var(--volt-color-surface)',
        color: 'var(--volt-color-on-surface)',
        'border-block-start-width': 'var(--volt-border-width-1)',
        'border-block-end-width': 'var(--volt-border-width-1)',
        'border-inline-start-width': 'var(--volt-border-width-1)',
        'border-inline-end-width': 'var(--volt-border-width-1)',
        'border-block-start-style': 'solid',
        'border-block-end-style': 'solid',
        'border-inline-start-style': 'solid',
        'border-inline-end-style': 'solid',
        'border-block-start-color': 'var(--volt-color-border)',
        'border-block-end-color': 'var(--volt-color-border)',
        'border-inline-start-color': 'var(--volt-color-border)',
        'border-inline-end-color': 'var(--volt-color-border)',
        'border-start-start-radius': 'var(--volt-radius-2)',
        'border-start-end-radius': 'var(--volt-radius-2)',
        'border-end-start-radius': 'var(--volt-radius-2)',
        'border-end-end-radius': 'var(--volt-radius-2)',
        'box-shadow': 'var(--volt-elevation-overlay)',
        'z-index': 'var(--volt-z-index-overlay)',
      },
    },
    {
      selector: `.${content}[data-state='open']`,
      declarations: { ...animation('volt-menu-in', 'fast') },
    },
    {
      selector: `.${content}[data-state='closed']`,
      declarations: { ...animation('volt-menu-out', 'fast') },
    },

    {
      selector: `.${item}`,
      declarations: {
        'box-sizing': 'border-box',
        display: 'flex',
        'align-items': 'center',
        'column-gap': 'var(--volt-space-2)',
        'inline-size': '100%',
        'padding-block-start': 'var(--volt-space-2)',
        'padding-block-end': 'var(--volt-space-2)',
        'padding-inline-start': 'var(--volt-space-3)',
        'padding-inline-end': 'var(--volt-space-3)',
        'font-family': 'var(--volt-font-family-sans)',
        'font-size': 'var(--volt-font-size-2)',
        'line-height': 'var(--volt-line-height-normal)',
        color: 'var(--volt-color-on-surface)',
        'background-color': 'transparent',
        // An item is a `<button>` as often as not, and a button arrives with
        // a border of the browser's own.
        'border-block-start-width': '0',
        'border-block-end-width': '0',
        'border-inline-start-width': '0',
        'border-inline-end-width': '0',
        'border-start-start-radius': 'var(--volt-radius-1)',
        'border-start-end-radius': 'var(--volt-radius-1)',
        'border-end-start-radius': 'var(--volt-radius-1)',
        'border-end-end-radius': 'var(--volt-radius-1)',
        'text-align': 'start',
        cursor: 'default',
        'user-select': 'none',
      },
    },
    {
      selector: `.${item}${ENABLED_ITEM}:hover`,
      declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
    },
    { selector: `.${item}:focus-visible`, declarations: { ...focusRing } },
    {
      selector: disabledItem(),
      declarations: {
        color: 'var(--volt-color-on-surface-muted)',
        'pointer-events': 'none',
      },
    },

    {
      selector: `.${separator}`,
      declarations: {
        'block-size': 'var(--volt-border-width-1)',
        'margin-block-start': 'var(--volt-space-1)',
        'margin-block-end': 'var(--volt-space-1)',
        'background-color': 'var(--volt-color-border)',
      },
    },
  ],

  forcedColors: [
    {
      selector: `.${content}`,
      declarations: { ...forcedPanel, 'background-color': 'Canvas', color: 'CanvasText' },
    },
    // Said outright rather than left to the palette, which would give a
    // `<button>` item `ButtonText` and its neighbours `CanvasText`, and leave
    // the grey of a disabled item standing against a colour nobody chose.
    { selector: `.${item}`, declarations: { color: 'CanvasText' } },
    // Hover is the only thing telling a pointer user which item they are on,
    // and the forced palette flattens the background it was drawn with.
    // `Highlight` is the pair the palette guarantees for exactly this.
    {
      selector: `.${item}${ENABLED_ITEM}:hover`,
      declarations: { 'background-color': 'Highlight', color: 'HighlightText' },
    },
    { selector: `.${item}:focus-visible`, declarations: { ...forcedFocusRing } },
    // Grey is the one thing a forced palette says about unavailability, and
    // it has to be said here because the muted colour above is gone.
    { selector: disabledItem(), declarations: { color: 'GrayText' } },
    { selector: `.${separator}`, declarations: { 'background-color': 'CanvasText' } },
  ],
}))();
