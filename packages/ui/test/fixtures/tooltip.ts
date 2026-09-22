/**
 * Tooltip: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const tooltip = (state: string): Fixture => ({
  classes: ['volt-tooltip-content'],
  attributes: { 'data-state': state },
});

export const fixtures: ComponentFixtures = {
  states: [{ state: 'presence', off: tooltip('closed'), on: tooltip('open') }],
};
