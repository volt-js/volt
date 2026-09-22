/**
 * Dialog: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const dialog = (state: string): Fixture => ({
  children: [
    { classes: ['volt-dialog-overlay'], attributes: { 'data-state': state } },
    {
      classes: ['volt-dialog-content'],
      attributes: { 'data-state': state, tabindex: '-1' },
      children: [
        { tag: 'h2', classes: ['volt-dialog-title'] },
        { tag: 'p', classes: ['volt-dialog-description'] },
        { classes: ['volt-dialog-footer'] },
      ],
    },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [{ state: 'presence', off: dialog('closed'), on: dialog('open') }],
};
