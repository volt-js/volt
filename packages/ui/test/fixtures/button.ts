/**
 * Button: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const button = (attributes: Record<string, string> = {}, focus = false): Fixture => ({
  tag: 'button',
  classes: ['volt-button'],
  attributes,
  focus,
  text: 'Save',
});

export const fixtures: ComponentFixtures = {
  states: [
      { state: 'emphasis', off: button(), on: button({ 'data-variant': 'primary' }) },
      // Both are filled with the one emphasis colour the forced palette has,
      // so what tells them apart there has to be something else.
      {
        state: 'destructive',
        off: button({ 'data-variant': 'primary' }),
        on: button({ 'data-variant': 'danger' }),
      },
      { state: 'disabled', off: button(), on: button({ 'aria-disabled': 'true' }) },
      { state: 'focus', off: button(), on: button({}, true) },
      { state: 'hover', off: button(), on: button({ 'data-hover': '' }) },
    ],
    extra: [
      button({ 'data-variant': 'ghost' }),
      button({ 'data-size': 'sm' }),
      button({ 'data-size': 'lg' }),
      // A filled button is out from under the forced palette, where a colour
      // the forced rules do not name is drawn as the sheet wrote it, so each
      // state it can be in is measured filled as well.
      ...['primary', 'danger'].flatMap((variant) => [
        button({ 'data-variant': variant, 'data-hover': '' }),
        button({ 'data-variant': variant }, true),
        button({ 'data-variant': variant, 'aria-disabled': 'true' }),
        button({ 'data-variant': variant, disabled: '' }),
      ]),
    ],
};
