/**
 * Tabs — the styled half of `createTabs`.
 *
 * The primitive writes `data-state` as `active` or `inactive`,
 * `data-orientation` on the list, every tab and every panel, and
 * `data-disabled` on a tab that is off. Panels are hidden with the `hidden`
 * attribute rather than unmounted, which is why nothing here sets `display`
 * on a panel: a `display` of any kind would override `hidden` and show every
 * panel at once.
 *
 * The selected tab is marked three ways — weight, colour and an underline —
 * because the first two are the ones a forced palette can take away.
 */

import type { ComponentStyles } from '../css.js';
import { focusRing, forcedFocusRing, transition } from './shared.js';

const list = 'volt-tabs-list';
const tab = 'volt-tabs-tab';
const panel = 'volt-tabs-panel';

export const tabsStyles: ComponentStyles = {
  name: 'tabs',
  classes: { list, tab, panel },
  keyframes: [],

  rules: [
    {
      selector: `.${list}`,
      declarations: {
        display: 'flex',
        'flex-direction': 'row',
        'column-gap': 'var(--volt-space-1)',
        'border-block-end-width': 'var(--volt-border-width-1)',
        'border-block-end-style': 'solid',
        'border-block-end-color': 'var(--volt-color-border)',
      },
    },
    {
      selector: `.${list}[data-orientation='vertical']`,
      declarations: {
        'flex-direction': 'column',
        'row-gap': 'var(--volt-space-1)',
        'border-block-end-width': '0',
        'border-inline-end-width': 'var(--volt-border-width-1)',
        'border-inline-end-style': 'solid',
        'border-inline-end-color': 'var(--volt-color-border)',
      },
    },

    {
      selector: `.${tab}`,
      declarations: {
        'box-sizing': 'border-box',
        display: 'inline-flex',
        'align-items': 'center',
        'column-gap': 'var(--volt-space-2)',
        'padding-block-start': 'var(--volt-space-2)',
        'padding-block-end': 'var(--volt-space-2)',
        'padding-inline-start': 'var(--volt-space-3)',
        'padding-inline-end': 'var(--volt-space-3)',
        // Over the list's own edge, so the selected tab's underline replaces
        // that segment of it rather than sitting above it.
        'margin-block-end': 'calc(var(--volt-border-width-1) * -1)',
        'border-block-end-width': 'var(--volt-border-width-2)',
        'border-block-end-style': 'solid',
        'border-block-end-color': 'transparent',
        'background-color': 'transparent',
        color: 'var(--volt-color-on-surface-muted)',
        'font-family': 'var(--volt-font-family-sans)',
        'font-size': 'var(--volt-font-size-2)',
        'font-weight': 'var(--volt-font-weight-medium)',
        'line-height': 'var(--volt-line-height-tight)',
        cursor: 'pointer',
        ...transition('color, border-block-end-color'),
      },
    },
    {
      selector: `.${tab}[data-state='active']`,
      declarations: {
        color: 'var(--volt-color-accent)',
        'border-block-end-color': 'var(--volt-color-accent)',
        'font-weight': 'var(--volt-font-weight-semibold)',
      },
    },
    {
      selector: `.${tab}:not([data-state='active']):not([data-disabled]):hover`,
      declarations: { color: 'var(--volt-color-on-surface)' },
    },
    {
      selector: `.${tab}[data-disabled]`,
      declarations: {
        opacity: 'var(--volt-disabled-opacity)',
        cursor: 'not-allowed',
      },
    },
    { selector: `.${tab}:focus-visible`, declarations: { ...focusRing } },

    {
      selector: `.${panel}`,
      declarations: {
        'padding-block-start': 'var(--volt-space-4)',
        'font-family': 'var(--volt-font-family-sans)',
        'font-size': 'var(--volt-font-size-2)',
        'line-height': 'var(--volt-line-height-normal)',
        color: 'var(--volt-color-on-surface)',
      },
    },
    // Panels are in the tab order whether or not they hold anything
    // focusable, so one of them will be focused sooner or later.
    { selector: `.${panel}:focus-visible`, declarations: { ...focusRing } },
  ],

  forcedColors: [
    {
      selector: `.${list}`,
      declarations: {
        'border-block-end-color': 'CanvasText',
        'border-inline-end-color': 'CanvasText',
      },
    },
    {
      selector: `.${tab}`,
      declarations: {
        color: 'CanvasText',
        'border-block-end-color': 'transparent',
      },
    },
    // The colour difference between a selected tab and its neighbours is the
    // first thing this mode takes: `Highlight` on the text and on the
    // underline puts it back out of the user's own palette, and the underline
    // is there whatever the palette turns the colours into.
    {
      selector: `.${tab}[data-state='active']`,
      declarations: {
        color: 'Highlight',
        'border-block-end-color': 'Highlight',
      },
    },
    {
      selector: `.${tab}[data-disabled]`,
      declarations: { color: 'GrayText', opacity: '1' },
    },
    { selector: `.${tab}:focus-visible`, declarations: { ...forcedFocusRing } },
    { selector: `.${panel}:focus-visible`, declarations: { ...forcedFocusRing } },
  ],
};
