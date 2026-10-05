/**
 * Checkbox: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** The box, its mark — there whether or not it shows — and its label. */
const checkbox = (state: string, attributes: Record<string, string> = {}): Fixture => ({
  classes: ['volt-checkbox'],
  attributes: { 'data-state': state, tabindex: '0', ...attributes },
  children: [
    { classes: ['volt-checkbox-indicator'], text: state === 'indeterminate' ? '–' : '✓' },
  ],
  text: 'Remember me',
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
    extra: [
      { classes: ['volt-checkbox-field'], children: [checkbox('checked')] },
      // A box that is checked is out from under the forced palette, where a
      // colour the forced rules do not name is drawn as the sheet wrote it.
      checkbox('checked', { 'data-disabled': '' }),
      checkbox('indeterminate', { 'data-disabled': '' }),
      { ...checkbox('checked'), focus: true },
    ],
};
