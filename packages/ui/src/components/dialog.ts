/**
 * Dialog — the styled half of `createDialog`.
 *
 * The primitive writes `data-state` on the content as `open` or `closed` and
 * keeps the node mounted until whatever animation `closed` starts has
 * finished, so the exit is expressed here and nowhere else. The overlay is
 * markup the consumer writes, and carries the same `data-state`.
 *
 * Every keyframe name is this component's own rather than a shared fade,
 * because the generator copies one component into a repository at a time and
 * a name defined in a file the consumer did not take is a name that resolves
 * to nothing.
 */

import type { ComponentStyles } from '../css.js';
import { animation, focusRing, forcedFocusRing, forcedPanel } from './shared.js';

const overlay = 'volt-dialog-overlay';
const content = 'volt-dialog-content';
const title = 'volt-dialog-title';
const description = 'volt-dialog-description';
const footer = 'volt-dialog-footer';

export const dialogStyles: ComponentStyles = {
  name: 'dialog',
  classes: { overlay, content, title, description, footer },

  keyframes: [
    {
      name: 'volt-dialog-overlay-in',
      steps: [
        { offset: 'from', declarations: { opacity: '0' } },
        { offset: 'to', declarations: { opacity: '1' } },
      ],
    },
    {
      name: 'volt-dialog-overlay-out',
      steps: [
        { offset: 'from', declarations: { opacity: '1' } },
        { offset: 'to', declarations: { opacity: '0' } },
      ],
    },
    {
      name: 'volt-dialog-content-in',
      steps: [
        { offset: 'from', declarations: { opacity: '0', translate: '0 var(--volt-space-2)' } },
        { offset: 'to', declarations: { opacity: '1', translate: '0 0' } },
      ],
    },
    {
      name: 'volt-dialog-content-out',
      steps: [
        { offset: 'from', declarations: { opacity: '1', translate: '0 0' } },
        { offset: 'to', declarations: { opacity: '0', translate: '0 var(--volt-space-2)' } },
      ],
    },
  ],

  rules: [
    {
      selector: `.${overlay}`,
      declarations: {
        position: 'fixed',
        'inset-block-start': '0',
        'inset-block-end': '0',
        'inset-inline-start': '0',
        'inset-inline-end': '0',
        'background-color': 'var(--volt-color-surface-scrim)',
        'z-index': 'var(--volt-z-index-overlay)',
      },
    },
    {
      selector: `.${overlay}[data-state='open']`,
      declarations: { ...animation('volt-dialog-overlay-in') },
    },
    {
      selector: `.${overlay}[data-state='closed']`,
      declarations: { ...animation('volt-dialog-overlay-out') },
    },

    {
      selector: `.${content}`,
      declarations: {
        'box-sizing': 'border-box',
        position: 'fixed',
        'inset-block-start': '50%',
        'inset-inline-start': '50%',
        translate: '-50% -50%',
        // The viewport, less a margin, is the ceiling — a dialog taller than
        // the screen with no way to scroll is a dialog with an unreachable
        // confirm button.
        'max-inline-size': 'min(var(--volt-space-120), calc(100vw - var(--volt-space-8)))',
        'max-block-size': 'calc(100vh - var(--volt-space-8))',
        'overflow-y': 'auto',
        'padding-block-start': 'var(--volt-space-6)',
        'padding-block-end': 'var(--volt-space-6)',
        'padding-inline-start': 'var(--volt-space-6)',
        'padding-inline-end': 'var(--volt-space-6)',
        'border-radius': 'var(--volt-radius-2)',
        'background-color': 'var(--volt-color-surface)',
        color: 'var(--volt-color-on-surface)',
        'font-family': 'var(--volt-font-family-sans)',
        'font-size': 'var(--volt-font-size-2)',
        'line-height': 'var(--volt-line-height-normal)',
        'box-shadow': 'var(--volt-elevation-overlay)',
        'z-index': 'var(--volt-z-index-overlay)',
      },
    },
    {
      selector: `.${content}[data-state='open']`,
      declarations: { ...animation('volt-dialog-content-in') },
    },
    {
      selector: `.${content}[data-state='closed']`,
      declarations: { ...animation('volt-dialog-content-out') },
    },
    // The content itself takes focus when nothing inside it wants to, so it
    // has to be able to show that it has it.
    { selector: `.${content}:focus-visible`, declarations: { ...focusRing } },

    {
      selector: `.${title}`,
      declarations: {
        'margin-block-start': '0',
        'margin-block-end': 'var(--volt-space-2)',
        'font-size': 'var(--volt-font-size-4)',
        'font-weight': 'var(--volt-font-weight-semibold)',
        'line-height': 'var(--volt-line-height-tight)',
        color: 'var(--volt-color-on-surface)',
      },
    },
    {
      selector: `.${description}`,
      declarations: {
        'margin-block-start': '0',
        'margin-block-end': 'var(--volt-space-5)',
        color: 'var(--volt-color-on-surface-muted)',
      },
    },
    {
      selector: `.${footer}`,
      declarations: {
        display: 'flex',
        'flex-wrap': 'wrap',
        'justify-content': 'flex-end',
        'column-gap': 'var(--volt-space-2)',
        'row-gap': 'var(--volt-space-2)',
        'margin-block-start': 'var(--volt-space-6)',
      },
    },
  ],

  forcedColors: [
    // A scrim is a colour with an alpha, and forced colours has no alpha: the
    // user agent would turn this into an opaque `Canvas` covering the page
    // the dialog is supposed to be sitting over. Nothing is a better dim than
    // the wrong one, and the content's border below is what separates the two
    // surfaces instead.
    {
      selector: `.${overlay}`,
      declarations: { 'background-color': 'transparent' },
    },
    {
      selector: `.${content}`,
      declarations: {
        ...forcedPanel,
        'background-color': 'Canvas',
        color: 'CanvasText',
      },
    },
    { selector: `.${content}:focus-visible`, declarations: { ...forcedFocusRing } },
  ],
};
