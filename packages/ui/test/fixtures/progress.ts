/**
 * Progress: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/**
 * A whole bar, because the state is on the indicator and most of what draws it
 * is the track it sits in.
 */
const bar = (state: string): Fixture => ({
  classes: ['volt-progress'],
  attributes: { role: 'progressbar', 'data-state': state },
  children: [
    {
      classes: ['volt-progress-track'],
      children: [
        { classes: ['volt-progress-indicator'], attributes: { 'data-state': state } },
      ],
    },
    { tag: 'span', classes: ['volt-progress-label'] },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    // Finished, which a bar cannot say by its width alone: full and nearly
    // full are the same picture at a glance, and identical once a palette
    // flattens the fill they differ in.
    { state: 'complete', off: bar('loading'), on: bar('complete') },
    // Whether there is a value at all. Said in motion, which no palette
    // touches — and which is why the pair still differs when one is forced.
    { state: 'indeterminate', off: bar('loading'), on: bar('indeterminate') },
  ],
};
