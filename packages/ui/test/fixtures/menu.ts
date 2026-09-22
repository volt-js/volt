/**
 * Menu: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const menu = (state: string): Fixture => ({
  classes: ['volt-menu-content'],
  attributes: { role: 'menu', 'data-state': state },
  children: [menuItem(), { classes: ['volt-menu-separator'] }, menuItem()],
});

const menuItem = (attributes: Record<string, string> = {}, focus = false): Fixture => ({
  classes: ['volt-menu-item'],
  attributes: { tabindex: '-1', ...attributes },
  focus,
});

export const fixtures: ComponentFixtures = {
  states: [
      { state: 'presence', off: menu('closed'), on: menu('open') },
      // Disabled has to survive the palette: the muted colour it is drawn in
      // is one of the first things a forced palette takes away.
      {
        state: 'disabled',
        off: menuItem(),
        on: menuItem({ 'aria-disabled': 'true', 'data-disabled': '' }),
      },
      // The primitive treats a `<button>` item that is natively `disabled` as
      // unavailable too, and writes nothing on it to say so.
      {
        state: 'natively disabled',
        off: { ...menuItem(), tag: 'button' },
        on: { ...menuItem({ disabled: '' }), tag: 'button' },
      },
      { state: 'focus', off: menuItem(), on: menuItem({}, true) },
      // Focus follows the pointer through a menu without drawing a ring, so the
      // hover background is the only thing marking the item a pointer is on.
      { state: 'hover', off: menuItem(), on: menuItem({ 'data-hover': '' }) },
    ],
};
