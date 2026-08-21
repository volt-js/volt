/**
 * Accordion — the styled half of `createAccordion`.
 *
 * The primitive writes `data-state` as `open` or `closed` on the item, the
 * trigger and the panel, `data-disabled` on an item that is off, and
 * `data-orientation` on the root and every item. It keeps a closing panel
 * mounted until the animation it started has finished, which is what makes a
 * collapse animatable at all.
 *
 * The height comes from the primitive rather than from here.
 * `--volt-collapsible-height` is the panel's measured content height, taken in
 * the measure lane and published on the element; `auto` does not interpolate,
 * so without a real number there is nothing to animate between. It is declared
 * in `contract.ts` for that reason: a rule reading a property nothing writes
 * fails silently, and this one is written by a specific primitive rather than
 * chosen by this package.
 */

import type { ComponentStyles } from '../css.js';
import { animation, focusRing, forcedFocusRing } from './shared.js';

const root = 'volt-accordion';
const item = 'volt-accordion-item';
const header = 'volt-accordion-header';
const trigger = 'volt-accordion-trigger';
const panel = 'volt-accordion-panel';

export const accordionStyles: ComponentStyles = {
  name: 'accordion',
  classes: { root, item, header, trigger, panel },

  keyframes: [
    {
      name: 'volt-accordion-expand',
      steps: [
        { offset: 'from', declarations: { 'block-size': '0' } },
        { offset: 'to', declarations: { 'block-size': 'var(--volt-collapsible-height)' } },
      ],
    },
    {
      name: 'volt-accordion-collapse',
      steps: [
        { offset: 'from', declarations: { 'block-size': 'var(--volt-collapsible-height)' } },
        { offset: 'to', declarations: { 'block-size': '0' } },
      ],
    },
  ],

  rules: [
    {
      selector: `.${root}`,
      declarations: {
        display: 'block',
        'border-block-start-width': 'var(--volt-border-width-1)',
        'border-block-start-style': 'solid',
        'border-block-start-color': 'var(--volt-color-border)',
      },
    },
    {
      selector: `.${item}`,
      declarations: {
        display: 'block',
        'border-block-end-width': 'var(--volt-border-width-1)',
        'border-block-end-style': 'solid',
        'border-block-end-color': 'var(--volt-color-border)',
      },
    },
    // A heading element wrapping the button, per the pattern. It carries no
    // type scale of its own: the trigger inside it is the visible thing, and
    // a heading that also sized the text would fight it.
    {
      selector: `.${header}`,
      declarations: {
        display: 'block',
        'margin-block-start': '0',
        'margin-block-end': '0',
        'font-size': 'inherit',
        'font-weight': 'inherit',
      },
    },
    {
      selector: `.${trigger}`,
      declarations: {
        'box-sizing': 'border-box',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'space-between',
        'column-gap': 'var(--volt-space-2)',
        'inline-size': '100%',
        'padding-block-start': 'var(--volt-space-3)',
        'padding-block-end': 'var(--volt-space-3)',
        'padding-inline-start': 'var(--volt-space-2)',
        'padding-inline-end': 'var(--volt-space-2)',
        'font-family': 'var(--volt-font-family-sans)',
        'font-size': 'var(--volt-font-size-2)',
        'font-weight': 'var(--volt-font-weight-medium)',
        'line-height': 'var(--volt-line-height-normal)',
        color: 'var(--volt-color-on-surface)',
        'background-color': 'transparent',
        'border-block-start-width': '0',
        'border-block-end-width': '0',
        'border-inline-start-width': '0',
        'border-inline-end-width': '0',
        'text-align': 'start',
        cursor: 'pointer',
      },
    },
    { selector: `.${trigger}:focus-visible`, declarations: { ...focusRing } },
    {
      selector: `.${trigger}[data-disabled]`,
      declarations: {
        color: 'var(--volt-color-on-surface-muted)',
        cursor: 'default',
      },
    },
    {
      selector: `.${panel}`,
      declarations: {
        display: 'block',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'font-family': 'var(--volt-font-family-sans)',
        'font-size': 'var(--volt-font-size-2)',
        'line-height': 'var(--volt-line-height-normal)',
        color: 'var(--volt-color-on-surface)',
      },
    },
    {
      selector: `.${panel}[data-state='open']`,
      declarations: { ...animation('volt-accordion-expand', 'fast') },
    },
    {
      selector: `.${panel}[data-state='closed']`,
      declarations: { ...animation('volt-accordion-collapse', 'fast') },
    },
  ],

  forcedColors: [
    { selector: `.${root}`, declarations: { 'border-block-start-color': 'CanvasText' } },
    { selector: `.${item}`, declarations: { 'border-block-end-color': 'CanvasText' } },
    { selector: `.${trigger}`, declarations: { color: 'ButtonText' } },
    { selector: `.${trigger}:focus-visible`, declarations: { ...forcedFocusRing } },
    // Grey is what a forced palette has to say about unavailability, and the
    // muted colour above is one of the first things it takes away.
    { selector: `.${trigger}[data-disabled]`, declarations: { color: 'GrayText' } },
  ],
};
