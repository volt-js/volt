/**
 * Select: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** The control and one option of a select, which is where its states live. */
const select = (
  triggerAttributes: Record<string, string> = {},
  focus = false,
): Fixture => ({
  classes: ['volt-select'],
  children: [
    {
      tag: 'button',
      classes: ['volt-select-trigger'],
      attributes: { role: 'combobox', 'aria-expanded': 'false', ...triggerAttributes },
      focus,
      children: [
        { tag: 'span', classes: ['volt-select-value'] },
        { tag: 'span', classes: ['volt-select-arrow'] },
      ],
    },
  ],
});

const selectOption = (attributes: Record<string, string> = {}): Fixture => ({
  classes: ['volt-select-listbox'],
  attributes: { role: 'listbox', 'data-state': 'open' },
  children: [
    {
      classes: ['volt-select-option'],
      attributes: { role: 'option', 'data-state': 'unchecked', ...attributes },
    },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
      // Where the keyboard is. Focus stays on the trigger — the list is
      // navigated with `aria-activedescendant` — so this attribute is the only
      // thing saying which option is under it.
      {
        state: 'highlighted',
        off: selectOption(),
        on: selectOption({ 'data-highlighted': '' }),
      },
      {
        state: 'chosen',
        off: selectOption(),
        on: selectOption({ 'data-state': 'checked', 'aria-selected': 'true' }),
      },
      {
        state: 'disabled option',
        off: selectOption(),
        on: selectOption({ 'data-disabled': '', 'aria-disabled': 'true' }),
      },
      { state: 'open', off: select(), on: select({ 'aria-expanded': 'true' }) },
      { state: 'disabled', off: select(), on: select({ 'aria-disabled': 'true' }) },
      { state: 'focus', off: select(), on: select({}, true) },
    ],
    extra: [
      select({ 'data-hover': '' }),
      select({ 'data-placeholder': '' }),
      { tag: 'p', classes: ['volt-select-status'], attributes: { role: 'status' } },
      {
        classes: ['volt-select-listbox'],
        attributes: { role: 'listbox', 'data-state': 'closed' },
        children: [{ classes: ['volt-select-empty'] }],
      },
      {
        classes: ['volt-select-listbox'],
        attributes: { role: 'listbox', 'data-state': 'open' },
        children: [
          {
            classes: ['volt-select-option'],
            attributes: { role: 'option', 'data-state': 'checked', 'data-highlighted': '' },
          },
        ],
      },
    ],
};
