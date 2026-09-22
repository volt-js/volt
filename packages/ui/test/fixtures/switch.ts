/**
 * Switch: the markup it is measured in, and the state changes that have to stay
 * visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const control = (state: string, attributes: Record<string, string> = {}): Fixture => ({
  classes: ['volt-switch'],
  attributes: { 'data-state': state, tabindex: '0', ...attributes },
  children: [
    { classes: ['volt-switch-track'], children: [{ classes: ['volt-switch-thumb'] }] },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    // Which way a setting is set is the whole of what a switch says, and it is
    // said in the fill of the track, the fill of the thumb and where along the
    // track the thumb has come to rest.
    { state: 'checked', off: control('unchecked'), on: control('checked') },
    {
      state: 'disabled',
      off: control('unchecked'),
      on: control('unchecked', { 'data-disabled': '' }),
    },
  ],
  extra: [
    control('checked', { 'data-disabled': '' }),
    { ...control('unchecked'), focus: true },
    { classes: ['volt-switch-field'], children: [control('checked')] },
  ],
};
