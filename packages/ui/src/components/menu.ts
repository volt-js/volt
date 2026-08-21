/**
 * Menu — the styled half of `createMenu`.
 *
 * The primitive anchors through `createAnchor`, which writes `position-anchor`
 * and `position-area` inline where the browser has CSS anchor positioning and
 * marks the content `data-anchored="false"` where it does not. Both are drawn,
 * for the same reason the popover draws both: a menu that lands in the corner
 * of the page is what leaving the fallback to the consumer looks like from
 * the outside.
 *
 * There is no highlighted-item attribute to style. Roving focus moves real
 * focus between items, so the item under the cursor is the focused one and
 * `:focus-visible` is what marks it — which also means a pointer user does not
 * get a focus ring dragged around behind their mouse.
 */

import type { ComponentStyles } from '../css.js';
import { animation, disabledSelector, focusRing, forcedFocusRing, forcedPanel } from './shared.js';

const content = 'volt-menu-content';
const item = 'volt-menu-item';
const separator = 'volt-menu-separator';

export const menuStyles: ComponentStyles = {
  name: 'menu',
  classes: { content, item, separator },

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
        position: 'absolute',
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
        'box-shadow': 'var(--volt-shadow-2)',
        'z-index': 'var(--volt-z-index-overlay)',
      },
    },
    // Without anchor positioning the primitive writes no placement at all, so
    // the menu would sit wherever `position: absolute` put it. Pinning it to
    // the top of its containing block is not correct placement, but it is a
    // menu on the page rather than one in the corner of the document.
    {
      selector: `.${content}[data-anchored='false']`,
      declarations: { 'inset-block-start': '100%', 'inset-inline-start': '0' },
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
      selector: `${disabledSelector(`.${item}`)}:hover`,
      declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
    },
    { selector: `.${item}:focus-visible`, declarations: { ...focusRing } },
    {
      selector: `.${item}[data-disabled]`,
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
    // Hover is the only thing telling a pointer user which item they are on,
    // and the forced palette flattens the background it was drawn with.
    // `Highlight` is the pair the palette guarantees for exactly this.
    {
      selector: `${disabledSelector(`.${item}`)}:hover`,
      declarations: { 'background-color': 'Highlight', color: 'HighlightText' },
    },
    { selector: `.${item}:focus-visible`, declarations: { ...forcedFocusRing } },
    // Grey is the one thing a forced palette says about unavailability, and
    // it has to be said here because the muted colour above is gone.
    { selector: `.${item}[data-disabled]`, declarations: { color: 'GrayText' } },
    { selector: `.${separator}`, declarations: { 'background-color': 'CanvasText' } },
  ],
};
