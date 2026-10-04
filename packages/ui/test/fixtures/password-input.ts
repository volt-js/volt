/**
 * Password input: the markup it is measured in, and the state changes that
 * have to stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not. The
 * field around the row is `field`'s and is measured there; what is measured
 * here is the row, the toggle and the live region — the parts this entry
 * draws.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** The toggle's attributes once the password is on the screen, as the primitive writes them. */
const SHOWN = { 'aria-label': 'Hide password', 'data-state': 'revealed' };

/** The row: the box, and the toggle as the primitive and the markup leave it. */
const row = (toggleAttributes: Record<string, string> = {}, focus = false): Fixture => ({
  classes: ['volt-password-input'],
  children: [
    {
      tag: 'input',
      classes: ['volt-field-control'],
      attributes: { type: 'password', 'data-state': 'valid' },
      text: 'hunter2',
    },
    {
      tag: 'button',
      classes: ['volt-password-input-toggle'],
      attributes: {
        type: 'button',
        'aria-label': 'Show password',
        'data-state': 'hidden',
        ...toggleAttributes,
      },
      focus,
      text: toggleAttributes['data-state'] === 'revealed' ? 'Hide' : 'Show',
    },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    // The password is on the screen, which a user has to be able to see at a
    // glance and before reading the words in the button.
    { state: 'revealed', off: row(), on: row(SHOWN) },
    // The same under the pointer, where the hover's own fill is in play and
    // a pair that came apart would leave the words the colour of the button.
    {
      state: 'revealed under the pointer',
      off: row({ 'data-hover': '' }),
      on: row({ ...SHOWN, 'data-hover': '' }),
    },
    { state: 'disabled', off: row(), on: row({ disabled: '' }) },
    // Out of use with the password left on show: still out of use.
    { state: 'disabled while revealed', off: row(SHOWN), on: row({ ...SHOWN, disabled: '' }) },
    { state: 'focus', off: row(), on: row({}, true) },
  ],
  extra: [
    {
      tag: 'p',
      classes: ['volt-password-input-status'],
      attributes: { role: 'status', 'aria-live': 'polite' },
      text: 'Your password is hidden.',
    },
  ],
};
