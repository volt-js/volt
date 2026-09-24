/**
 * Badge: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 *
 * The anchor and a button in it, because where the badge sits is decided by
 * its having company there: a `.volt-badge` mounted on its own is a badge
 * standing in line, which is the other shape and has a fixture of its own.
 *
 * Tone is not a pair. The words a badge is named with say what it counts, and
 * red for a count of errors against grey for a count of drafts is emphasis on
 * those words — the kind a forced palette is allowed to flatten, and does.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** A button with a badge on its corner, carrying what the component writes. */
const anchored = (attributes: Record<string, string>): Fixture => ({
  tag: 'span',
  classes: ['volt-badge-anchor'],
  children: [
    { tag: 'button' },
    { tag: 'span', classes: ['volt-badge'], attributes: { 'data-tone': 'danger', ...attributes } },
  ],
});

const counting = { role: 'img', 'aria-label': '3 unread messages', 'data-count': '3' };
const nothing = { 'aria-hidden': 'true', 'data-empty': '', 'data-count': '0' };

export const fixtures: ComponentFixtures = {
  states: [
    // Whether there is anything waiting at all. The badge stays on the page at
    // zero — the id a control is described by is on it — so this is the one
    // element either way, drawn or not.
    { state: 'presence', off: anchored(nothing), on: anchored(counting) },
    // The same for a dot, which is a different risk: it has no digits, so
    // once it is drawn its fill is the whole of it.
    {
      state: 'dot presence',
      off: anchored({ ...nothing, 'data-dot': '' }),
      on: anchored({ ...counting, 'data-dot': '' }),
    },
  ],
  extra: [
    anchored({ ...counting, 'data-tone': 'accent' }),
    anchored({ ...counting, 'data-tone': 'neutral' }),
    anchored({ role: 'img', 'aria-label': 'Online', 'data-tone': 'accent', 'data-dot': '' }),
    anchored({
      role: 'img',
      'aria-label': 'More than 99 unread messages',
      'data-count': '150',
      'data-overflow': '',
    }),
    // Nothing written around it, so it stands in line.
    {
      tag: 'span',
      classes: ['volt-badge-anchor'],
      children: [
        {
          tag: 'span',
          classes: ['volt-badge'],
          attributes: { ...counting, 'data-tone': 'neutral' },
        },
      ],
    },
  ],
};
