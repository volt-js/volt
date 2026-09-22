/**
 * Popover: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const popover = (state: string, focus = false): Fixture => ({
  classes: ['volt-popover-content'],
  attributes: { 'data-state': state, 'data-placement': 'bottom', tabindex: '-1' },
  focus,
  children: [
    { tag: 'h2', classes: ['volt-popover-title'] },
    { tag: 'p', classes: ['volt-popover-description'] },
    { classes: ['volt-popover-arrow'], attributes: { 'data-placement': 'bottom' } },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
      { state: 'presence', off: popover('closed'), on: popover('open') },
      { state: 'focus', off: popover('open'), on: popover('open', true) },
    ],
};
