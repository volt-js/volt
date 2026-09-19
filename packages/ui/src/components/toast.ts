/**
 * Toast — the styled half of `createToaster`.
 *
 * The primitive writes `data-state` (`open` or `closed`) and `data-type`
 * (`info`, `success`, `warning`, `error`) on each toast. It also writes
 * `data-paused` on the region while the countdown is stopped, which nothing
 * here selects on: a paused toast looks like any other.
 *
 * Type is the hard part. In the default palette it is a colour down the
 * leading edge, and colour is the one channel a forced palette does not have
 * spare — every severity would come out the same. So the same edge also
 * carries a border style per type, which is geometry and survives. That is a
 * second cue, not a replacement for the first: severity belongs in the words
 * of the toast, and this styling assumes an application that put it there.
 */

import type { ComponentStyles } from '../css.js';
import { animation, focusRing, forcedFocusRing, forcedPanel } from './shared.js';

const region = 'volt-toast-region';
const root = 'volt-toast';
const title = 'volt-toast-title';
const description = 'volt-toast-description';
const actions = 'volt-toast-actions';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const toastClasses = { region, root, title, description, actions } as const;

export const toastStyles = /* @__PURE__ */ ((): ComponentStyles => ({
  name: 'toast',
  classes: toastClasses,

  keyframes: [
    {
      name: 'volt-toast-in',
      steps: [
        { offset: 'from', declarations: { opacity: '0', translate: '0 var(--volt-space-4)' } },
        { offset: 'to', declarations: { opacity: '1', translate: '0 0' } },
      ],
    },
    {
      name: 'volt-toast-out',
      steps: [
        { offset: 'from', declarations: { opacity: '1', translate: '0 0' } },
        { offset: 'to', declarations: { opacity: '0', translate: '0 var(--volt-space-4)' } },
      ],
    },
  ],

  rules: [
    {
      selector: `.${region}`,
      declarations: {
        'box-sizing': 'border-box',
        position: 'fixed',
        'inset-block-end': 'var(--volt-space-4)',
        'inset-inline-end': 'var(--volt-space-4)',
        display: 'flex',
        'flex-direction': 'column',
        'row-gap': 'var(--volt-space-2)',
        'inline-size': 'min(var(--volt-space-80), calc(100vw - var(--volt-space-8)))',
        'z-index': 'var(--volt-z-index-toast)',
      },
    },
    // The region is focusable by hotkey and nothing else, so this ring is the
    // only sign that F6 landed anywhere.
    { selector: `.${region}:focus-visible`, declarations: { ...focusRing } },

    {
      selector: `.${root}`,
      declarations: {
        'box-sizing': 'border-box',
        'padding-block-start': 'var(--volt-space-3)',
        'padding-block-end': 'var(--volt-space-3)',
        'padding-inline-start': 'var(--volt-space-4)',
        'padding-inline-end': 'var(--volt-space-4)',
        'border-width': 'var(--volt-border-width-1)',
        'border-style': 'solid',
        'border-color': 'var(--volt-color-border)',
        'border-inline-start-width': 'var(--volt-border-width-4)',
        'border-inline-start-style': 'solid',
        'border-inline-start-color': 'var(--volt-color-info)',
        'border-radius': 'var(--volt-radius-2)',
        'background-color': 'var(--volt-color-surface)',
        color: 'var(--volt-color-on-surface)',
        'font-family': 'var(--volt-font-family-sans)',
        'font-size': 'var(--volt-font-size-2)',
        'line-height': 'var(--volt-line-height-normal)',
        'box-shadow': 'var(--volt-elevation-overlay)',
      },
    },
    {
      selector: `.${root}[data-type='success']`,
      declarations: { 'border-inline-start-color': 'var(--volt-color-success)' },
    },
    {
      selector: `.${root}[data-type='warning']`,
      declarations: { 'border-inline-start-color': 'var(--volt-color-warning)' },
    },
    {
      selector: `.${root}[data-type='error']`,
      declarations: { 'border-inline-start-color': 'var(--volt-color-danger)' },
    },

    { selector: `.${root}[data-state='open']`, declarations: { ...animation('volt-toast-in') } },
    { selector: `.${root}[data-state='closed']`, declarations: { ...animation('volt-toast-out') } },

    {
      selector: `.${title}`,
      declarations: {
        'margin-block-start': '0',
        'margin-block-end': '0',
        'font-size': 'var(--volt-font-size-2)',
        'font-weight': 'var(--volt-font-weight-semibold)',
        'line-height': 'var(--volt-line-height-tight)',
        color: 'var(--volt-color-on-surface)',
      },
    },
    {
      selector: `.${description}`,
      declarations: {
        'margin-block-start': 'var(--volt-space-1)',
        'margin-block-end': '0',
        color: 'var(--volt-color-on-surface-muted)',
      },
    },
    {
      selector: `.${actions}`,
      declarations: {
        display: 'flex',
        'align-items': 'center',
        'column-gap': 'var(--volt-space-2)',
        'margin-block-start': 'var(--volt-space-3)',
      },
    },
  ],

  forcedColors: [
    {
      selector: `.${root}`,
      declarations: {
        ...forcedPanel,
        'background-color': 'Canvas',
        color: 'CanvasText',
        'border-inline-start-width': 'var(--volt-border-width-4)',
        'border-inline-start-style': 'solid',
        'border-inline-start-color': 'CanvasText',
      },
    },
    // One border style per severity, on the edge that already carries the
    // colour. Four styles that are told apart at a glance and at four pixels
    // wide: a solid bar, a split bar, a broken bar, and dots.
    {
      selector: `.${root}[data-type='success']`,
      declarations: { 'border-inline-start-style': 'double' },
    },
    {
      selector: `.${root}[data-type='warning']`,
      declarations: { 'border-inline-start-style': 'dashed' },
    },
    {
      selector: `.${root}[data-type='error']`,
      declarations: { 'border-inline-start-style': 'dotted' },
    },
    { selector: `.${region}:focus-visible`, declarations: { ...forcedFocusRing } },
  ],
}))();
