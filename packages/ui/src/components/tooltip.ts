/**
 * Tooltip — the styled half of `createTooltip`.
 *
 * Small, quiet, and never the only place something is said: a tooltip is a
 * hint about a control that already has a name, so nothing here draws
 * attention to itself the way the popover does.
 *
 * It is `pointer-events: none` deliberately. A tooltip that can be hovered is
 * a tooltip that can be hovered *off* the control it describes, and a pointer
 * that lands on it while travelling somewhere else takes the hint with it.
 */

import type { ComponentStyles } from '../css.js';
import { animation, forcedPanel } from './shared.js';

const content = 'volt-tooltip-content';

export const tooltipStyles: ComponentStyles = {
  name: 'tooltip',
  classes: { content },

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
        'box-shadow': 'var(--volt-shadow-1)',
        'z-index': 'var(--volt-z-index-overlay)',
        'pointer-events': 'none',
      },
    },
    {
      selector: `.${content}[data-anchored='false']`,
      declarations: { 'inset-block-end': '100%', 'inset-inline-start': '0' },
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
};
