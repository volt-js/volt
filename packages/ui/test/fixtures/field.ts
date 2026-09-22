/**
 * Field: the markup it is measured in, and the state changes that have to stay
 * visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const field = (controlAttributes: Record<string, string> = {}, focus = false): Fixture => ({
  classes: ['volt-field'],
  children: [
    { tag: 'label', classes: ['volt-field-label'] },
    {
      tag: 'input',
      classes: ['volt-field-control'],
      attributes: { 'data-state': 'valid', ...controlAttributes },
      focus,
    },
    { tag: 'p', classes: ['volt-field-description'] },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    // A control the page has rejected has to look rejected, whatever palette
    // the reader brought.
    {
      state: 'invalid',
      off: field(),
      on: field({ 'data-state': 'invalid', 'aria-invalid': 'true' }),
    },
    // And one that is merely waiting must not be dressed as though it were
    // wrong.
    { state: 'pending', off: field(), on: field({ 'data-state': 'pending', 'aria-busy': 'true' }) },
    { state: 'disabled', off: field(), on: field({ 'aria-disabled': 'true', disabled: '' }) },
    { state: 'focus', off: field(), on: field({}, true) },
  ],
  extra: [
    // Read-only is not in the pairs above, and that is a decision rather than
    // an omission. It is drawn on the surface, and a forced palette has two
    // surface colours that are spent on what a user must be able to see —
    // which is what is selected and where the keyboard is. The platform draws
    // a `readonly` input no differently there either; what says so is
    // `aria-readonly`, which is announced and survives any palette.
    field({ 'aria-readonly': 'true', readonly: '' }),
    {
      classes: ['volt-field'],
      children: [
        { tag: 'label', classes: ['volt-field-label'] },
        { tag: 'textarea', classes: ['volt-field-control'], attributes: { 'data-state': 'invalid' } },
        { tag: 'p', classes: ['volt-field-error'], attributes: { role: 'alert' } },
      ],
    },
  ],
};
