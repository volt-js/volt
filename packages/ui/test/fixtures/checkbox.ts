/**
 * Checkbox: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const checkbox = (state: string, attributes: Record<string, string> = {}): Fixture => ({
  classes: ['volt-checkbox'],
  attributes: { 'data-state': state, tabindex: '0', ...attributes },
  children: [{ classes: ['volt-checkbox-indicator'] }],
});

export const fixtures: ComponentFixtures = {
  states: [
      { state: 'checked', off: checkbox('unchecked'), on: checkbox('checked') },
      { state: 'indeterminate', off: checkbox('unchecked'), on: checkbox('indeterminate') },
      {
        state: 'disabled',
        off: checkbox('unchecked'),
        on: checkbox('unchecked', { 'data-disabled': '' }),
      },
    ],
    extra: [{ classes: ['volt-checkbox-field'], children: [checkbox('checked')] }],
};
