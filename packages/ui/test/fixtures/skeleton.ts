/**
 * Skeleton: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const shape = (attributes: Record<string, string> = {}): Fixture => ({
  classes: ['volt-skeleton-shape'],
  attributes: { 'data-shape': 'text', ...attributes },
});

const placeholder = (state: string, shapes: readonly Fixture[] = [shape()]): Fixture => ({
  classes: ['volt-skeleton-placeholder'],
  attributes: { 'data-state': state, 'aria-hidden': 'true' },
  children: shapes,
});

export const fixtures: ComponentFixtures = {
  states: [
    // Whether the boxes are up at all. The delay is drawn rather than left out
    // of the markup, so this is a pair rather than a presence — and it is told
    // in `display` and in the pulse, neither of which a forced palette has an
    // opinion about. The fill could not have carried it: a forced palette
    // replaces every background the sheet chose.
    { state: 'showing', off: placeholder('delayed'), on: placeholder('visible') },
  ],
  extra: [
    placeholder('visible', [shape({ 'data-shape': 'block' })]),
    placeholder('visible', [shape({ 'data-shape': 'circle' })]),
    placeholder('visible', [shape(), shape({ 'data-trailing': '' })]),
    { classes: ['volt-skeleton'], attributes: { 'data-state': 'visible', 'aria-busy': 'true' } },
    { classes: ['volt-skeleton'], attributes: { 'data-state': 'idle' } },
    { tag: 'p', classes: ['volt-skeleton-status'], attributes: { role: 'status' } },
  ],
};
