/**
 * Switch: the markup it is measured in, and the state changes that have to stay
 * visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const control = (
  state: string,
  attributes: Record<string, string> = {},
  thumb?: string,
): Fixture => ({
  classes: ['volt-switch'],
  attributes: { 'data-state': state, tabindex: '0', ...attributes },
  children: [
    {
      classes: ['volt-switch-track'],
      children: [{ classes: ['volt-switch-thumb'], text: thumb }],
    },
  ],
  text: 'Wi-Fi',
});

/**
 * A mark a caller wrote in the `thumb` slot, which is handed the setting so
 * that it can differ between the two. Words there are drawn in the thumb's
 * colour, on the thumb's fill.
 */
const marked = (state: string, attributes: Record<string, string> = {}): Fixture =>
  control(state, attributes, state === 'checked' ? '✓' : '✕');

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
    marked('unchecked'),
    marked('checked'),
    marked('unchecked', { 'data-disabled': '' }),
    marked('checked', { 'data-disabled': '' }),
  ],
};
