/**
 * Number input: the markup it is measured in, and the state changes that have
 * to stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not. The box
 * and the parts around it are the field's, and are measured in `field.ts`;
 * what is here is the row and the two spin buttons.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** A spin button as the primitive leaves it: named, out of the tab order, and hidden. */
const button = (attributes: Record<string, string> = {}, focus = false): Fixture => ({
  tag: 'button',
  classes: ['volt-number-input-button'],
  attributes: {
    type: 'button',
    tabindex: '-1',
    'aria-hidden': 'true',
    'aria-label': 'Increase',
    ...attributes,
  },
  focus,
});

/** The row the component draws: the box, the hidden number, and a button each way. */
const row = (increase: Fixture = button()): Fixture => ({
  classes: ['volt-number-input'],
  children: [
    {
      tag: 'input',
      classes: ['volt-field-control'],
      attributes: { type: 'text', role: 'spinbutton', 'data-state': 'valid' },
    },
    { tag: 'input', attributes: { type: 'hidden', value: '' } },
    button({ 'aria-label': 'Decrease' }),
    increase,
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    // A button with nowhere left to go is left in the row, so the row does
    // not move under the pointer — which means it has to look like one that
    // goes nowhere, or a press on it is a press that did nothing.
    { state: 'disabled', off: button(), on: button({ disabled: '' }) },
    // Never a tab stop, but a pointer or a script can still leave focus on
    // one, and focus nobody can see is focus lost.
    { state: 'focus', off: button(), on: button({}, true) },
  ],
  extra: [
    button({ 'data-hover': '' }),
    button({ 'data-hover': '', disabled: '' }),
    row(),
    row(button({ disabled: '' })),
  ],
};
