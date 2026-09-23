/**
 * Spinner: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** The region, the ring and the words, in one of the primitive's three states. */
const spinner = (state: string, mark: Record<string, string> = {}): Fixture => ({
  classes: ['volt-spinner'],
  attributes: { role: 'status', 'aria-live': 'polite', 'data-state': state },
  children: [
    {
      tag: 'span',
      classes: ['volt-spinner-indicator'],
      attributes: { 'aria-hidden': 'true', 'data-state': state, ...mark },
    },
    { tag: 'span', classes: ['volt-spinner-label'] },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    // Whether a wait has lasted long enough to be worth showing is the only
    // thing this component says, and it says it by the ring being there or
    // not. Nothing about that is a colour, so the forced palette cannot take
    // it: a user who has replaced every colour on the page still sees the
    // difference between a page that is working and one that is not.
    { state: 'waiting', off: spinner('delayed'), on: spinner('visible') },
  ],
  extra: [
    spinner('idle'),
    spinner('visible', { 'data-size': 'sm' }),
    spinner('visible', { 'data-size': 'lg' }),
  ],
};
