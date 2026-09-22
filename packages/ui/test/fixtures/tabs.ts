/**
 * Tabs: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const tab = (attributes: Record<string, string>, focus = false): Fixture => ({
  tag: 'button',
  classes: ['volt-tabs-tab'],
  attributes,
  focus,
});

export const fixtures: ComponentFixtures = {
  states: [
      {
        state: 'selected',
        off: tab({ 'data-state': 'inactive' }),
        on: tab({ 'data-state': 'active' }),
      },
      {
        state: 'disabled',
        off: tab({ 'data-state': 'inactive' }),
        on: tab({ 'data-state': 'inactive', 'data-disabled': '' }),
      },
      {
        state: 'focus',
        off: tab({ 'data-state': 'inactive' }),
        on: tab({ 'data-state': 'inactive' }, true),
      },
      {
        state: 'hover',
        off: tab({ 'data-state': 'inactive' }),
        on: tab({ 'data-state': 'inactive', 'data-hover': '' }),
      },
    ],
    extra: [
      tab({ 'data-state': 'active', 'data-orientation': 'vertical' }),
      tab({ 'data-state': 'inactive', 'data-orientation': 'vertical' }),
      { classes: ['volt-tabs-list'], attributes: { 'data-orientation': 'horizontal' } },
      { classes: ['volt-tabs-list'], attributes: { 'data-orientation': 'vertical' } },
      { classes: ['volt-tabs-panel'], attributes: { tabindex: '0' } },
      { classes: ['volt-tabs-panel'], attributes: { tabindex: '0' }, focus: true },
    ],
};
