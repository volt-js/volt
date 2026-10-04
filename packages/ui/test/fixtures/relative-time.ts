/**
 * Relative time: the markup it is measured in, and the state change that has
 * to stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 *
 * The one pair is the tooltip. Whether there is an exact moment a hover away
 * is said by the dotted underline and nothing else, and a reader who cannot
 * see the underline is one who never learns the tooltip is there. Both sides
 * are the same stamp, so the `title` is the only thing between them: the
 * component writes none when the tooltip would repeat the date already on
 * screen, and an empty one when the caller asked for none with `title=""`.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** A stamp as the component writes it, the primitive's attributes on it, and its words. */
const stamp = (attributes: Record<string, string>): Fixture => ({
  tag: 'time',
  classes: ['volt-relative-time'],
  attributes,
  text: { minute: '3 minutes ago', month: 'Sep 1' }[attributes['data-unit'] ?? ''],
});

const minutes = { datetime: '2026-10-04T09:57:00.000Z', 'data-unit': 'minute' };
const month = { datetime: '2026-09-01T09:57:00.000Z', 'data-unit': 'month' };

export const fixtures: ComponentFixtures = {
  states: [
    {
      state: 'tooltip',
      off: stamp(minutes),
      on: stamp({ ...minutes, title: 'October 4, 2026 at 9:57 AM' }),
    },
    {
      // A caller's `title=""`, which the component writes rather than drops so
      // that a titled ancestor does not lend the stamp its tooltip. Empty, it
      // promises nothing, and has to look like the stamp that has none.
      state: 'tooltip asked away',
      off: stamp({ ...minutes, title: '' }),
      on: stamp({ ...minutes, title: 'October 4, 2026 at 9:57 AM' }),
    },
  ],
  extra: [
    // No date yet: an empty `<time>`, with no `datetime` claiming a moment.
    stamp({}),
    // Past its threshold: the date as text, and the hour behind it.
    stamp({ ...month, title: 'September 1, 2026 at 9:57 AM' }),
    // A caller's own tooltip.
    stamp({ ...month, title: 'Edited twice since' }),
  ],
};
