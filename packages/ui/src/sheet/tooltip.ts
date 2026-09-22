/**
 * Tooltip — the styled half of `createTooltip`.
 *
 * Small, quiet, and never the only place something is said: a tooltip is a
 * hint about a control that already has a name, so nothing here draws
 * attention to itself the way the popover does.
 *
 * The pointer can reach it. The primitive keeps the tooltip open while the
 * pointer is on the content, so that a long description can be read without
 * it closing underneath — WCAG's Content on Hover or Focus — and a rule here
 * switching pointer events off would switch that off with them.
 */

import type { ComponentStyles } from '../css.js';
import { animation, forcedPanel } from './shared.js';

const content = 'volt-tooltip-content';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const tooltipClasses = { content } as const;

export const tooltipStyles = /* @__PURE__ */ ((): ComponentStyles => ({
  name: 'tooltip',
  classes: tooltipClasses,

  keyframes: [
    {
      name: 'volt-tooltip-in',
      steps: [
        { offset: 'from', declarations: { opacity: '0' } },
        { offset: 'to', declarations: { opacity: '1' } },
      ],
    },
    {
      name: 'volt-tooltip-out',
      steps: [
        { offset: 'from', declarations: { opacity: '1' } },
        { offset: 'to', declarations: { opacity: '0' } },
      ],
    },
  ],

  rules: [
    {
      selector: `.${content}`,
      declarations: {
        'box-sizing': 'border-box',
        position: 'absolute',
        'max-inline-size': 'var(--volt-space-80)',
        'padding-block-start': 'var(--volt-space-1)',
        'padding-block-end': 'var(--volt-space-1)',
        'padding-inline-start': 'var(--volt-space-2)',
        'padding-inline-end': 'var(--volt-space-2)',
        'font-family': 'var(--volt-font-family-sans)',
        'font-size': 'var(--volt-font-size-1)',
        'line-height': 'var(--volt-line-height-tight)',
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
        'border-block-start-color': 'var(--volt-color-border-strong)',
        'border-block-end-color': 'var(--volt-color-border-strong)',
        'border-inline-start-color': 'var(--volt-color-border-strong)',
        'border-inline-end-color': 'var(--volt-color-border-strong)',
        'border-start-start-radius': 'var(--volt-radius-1)',
        'border-start-end-radius': 'var(--volt-radius-1)',
        'border-end-start-radius': 'var(--volt-radius-1)',
        'border-end-end-radius': 'var(--volt-radius-1)',
        'box-shadow': 'var(--volt-elevation-raised)',
        'z-index': 'var(--volt-z-index-overlay)',
      },
    },
    {
      selector: `.${content}[data-state='open']`,
      declarations: { ...animation('volt-tooltip-in', 'fast') },
    },
    {
      selector: `.${content}[data-state='closed']`,
      declarations: { ...animation('volt-tooltip-out', 'fast') },
    },
  ],

  forcedColors: [
    {
      selector: `.${content}`,
      declarations: { ...forcedPanel, 'background-color': 'Canvas', color: 'CanvasText' },
    },
  ],
}))();
