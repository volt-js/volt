/**
 * Toggle group: the markup it is measured in, and the state changes that have
 * to stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not. The
 * pointer is not here as a pair: a pointer user can see their own pointer,
 * and the sweeps reach the hovered shapes through `extra`.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** One toggle, up and enabled unless the attributes say otherwise. */
const toggle = (attributes: Record<string, string> = {}, focus = false): Fixture => ({
  tag: 'button',
  classes: ['volt-toggle'],
  attributes: {
    type: 'button',
    role: 'button',
    'aria-pressed': 'false',
    'data-state': 'off',
    'data-volt-item': '',
    tabindex: '-1',
    ...attributes,
  },
  focus,
  text: 'Bold',
});

/** A toggle in a group that must keep a value: checked rather than pressed. */
const radio = (attributes: Record<string, string>): Fixture => ({
  tag: 'button',
  classes: ['volt-toggle'],
  attributes: { type: 'button', role: 'radio', 'data-volt-item': '', tabindex: '-1', ...attributes },
  text: 'Left',
});

const down = { 'data-state': 'on', 'aria-pressed': 'true' };
const unavailable = { 'data-disabled': '', 'aria-disabled': 'true' };

const group = (
  orientation: string,
  toggles: readonly Fixture[],
  attributes: Record<string, string> = {},
): Fixture => ({
  classes: ['volt-toggle-group'],
  attributes: { role: 'group', 'data-orientation': orientation, ...attributes },
  children: toggles,
});

export const fixtures: ComponentFixtures = {
  states: [
    // Which toggles are down is the whole of what a group says, so it has to
    // survive any palette: the fill goes, and `Highlight` with `HighlightText`
    // is put back over it, beside a weight no palette touches.
    { state: 'pressed', off: toggle(), on: toggle(down) },
    { state: 'disabled', off: toggle(), on: toggle(unavailable) },
    // A group taken out of use keeps saying which of its toggles is down,
    // in the edge and the weight once `Highlight` is handed back.
    {
      state: 'pressed while disabled',
      off: toggle(unavailable),
      on: toggle({ ...down, ...unavailable }),
    },
    // A group holds one tab stop, so where the keyboard is inside it is not
    // something a reader can work out from the selection alone.
    { state: 'focus', off: toggle(), on: toggle({}, true) },
  ],
  extra: [
    // A row: the tab stop on the first, the middle one down, the last off.
    group('horizontal', [
      toggle({ tabindex: '0' }),
      toggle(down),
      toggle(unavailable),
    ]),
    // The same as a column, where the shared edge is the block one.
    group('vertical', [toggle({ ...down, tabindex: '0' }), toggle(), toggle(unavailable)]),
    // One that must keep a value, which the primitive announces as radios.
    group(
      'horizontal',
      [
        radio({ 'aria-checked': 'true', 'data-state': 'on', tabindex: '0' }),
        radio({ 'aria-checked': 'false', 'data-state': 'off' }),
      ],
      { role: 'radiogroup', 'aria-orientation': 'horizontal' },
    ),
    // The whole group off: every toggle dimmed, the one down included.
    group(
      'horizontal',
      [toggle({ ...down, ...unavailable, tabindex: '0' }), toggle(unavailable)],
      unavailable,
    ),
    // A group of one, which is first and last at once.
    group('horizontal', [toggle({ tabindex: '0' })]),
    // Under the pointer, up and down.
    toggle({ 'data-hover': '' }),
    toggle({ ...down, 'data-hover': '' }),
    // A toggle on its own, with all four corners.
    toggle({ tabindex: '0' }),
    toggle({ ...down, tabindex: '0' }, true),
  ],
};
