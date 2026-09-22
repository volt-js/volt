/**
 * Toast: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const region = (focus = false): Fixture => ({
  classes: ['volt-toast-region'],
  attributes: { tabindex: '-1' },
  focus,
});

const toast = (attributes: Record<string, string>): Fixture => ({
  classes: ['volt-toast'],
  attributes,
  children: [
    { tag: 'p', classes: ['volt-toast-title'] },
    { tag: 'p', classes: ['volt-toast-description'] },
    { classes: ['volt-toast-actions'] },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
      {
        state: 'severity',
        off: toast({ 'data-type': 'info', 'data-state': 'open' }),
        on: toast({ 'data-type': 'error', 'data-state': 'open' }),
      },
      {
        state: 'presence',
        off: toast({ 'data-type': 'info', 'data-state': 'closed' }),
        on: toast({ 'data-type': 'info', 'data-state': 'open' }),
      },
      { state: 'focus', off: region(), on: region(true) },
    ],
    extra: [
      toast({ 'data-type': 'success', 'data-state': 'open' }),
      toast({ 'data-type': 'warning', 'data-state': 'open' }),
    ],
};
