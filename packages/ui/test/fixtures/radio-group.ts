/**
 * Radio group: the markup it is measured in, and the state changes that have
 * to stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const radio = (
  state: string,
  attributes: Record<string, string> = {},
  focus = false,
): Fixture => ({
  classes: ['volt-radio'],
  attributes: { 'data-state': state, tabindex: state === 'checked' ? '0' : '-1', ...attributes },
  focus,
  children: [
    { classes: ['volt-radio-indicator'], children: [{ classes: ['volt-radio-dot'] }] },
  ],
});

/** One radio in the row the group lays out, which is a `<label>`. */
const row = (state: string, attributes: Record<string, string> = {}): Fixture => ({
  tag: 'label',
  classes: ['volt-radio-field'],
  children: [radio(state, attributes)],
});

export const fixtures: ComponentFixtures = {
  states: [
    // Which radio is chosen is the whole of what a group says, so it has to
    // survive any palette: the fill goes, and the dot is what is left.
    { state: 'checked', off: radio('unchecked'), on: radio('checked') },
    {
      state: 'disabled',
      off: radio('unchecked'),
      on: radio('unchecked', { 'data-disabled': '' }),
    },
    // A group holds one tab stop, so where the keyboard is inside it is not
    // something a reader can work out from the selection alone.
    { state: 'focus', off: radio('unchecked'), on: radio('unchecked', {}, true) },
  ],
  extra: [
    {
      classes: ['volt-radio-group'],
      attributes: { role: 'radiogroup', 'data-orientation': 'vertical' },
      children: [row('checked'), row('unchecked')],
    },
    {
      classes: ['volt-radio-group'],
      attributes: { role: 'radiogroup', 'data-orientation': 'horizontal' },
      children: [row('unchecked'), row('unchecked', { 'data-disabled': '' })],
    },
  ],
};
