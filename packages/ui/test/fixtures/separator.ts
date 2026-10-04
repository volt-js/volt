/**
 * Separator: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

type Orientation = 'horizontal' | 'vertical';

const line: Fixture = { tag: 'span', classes: ['volt-separator-line'] };

/** Words on the line, in the gap between two segments of it. */
const worded: readonly Fixture[] = [
  line,
  { tag: 'span', classes: ['volt-separator-label'], text: 'Comments' },
  line,
];

/** A rule that only divides, as the primitive marks one by default. */
const rule = (orientation: Orientation, children: readonly Fixture[] = [line]): Fixture => ({
  tag: 'span',
  classes: ['volt-separator'],
  attributes: { role: 'presentation', 'data-orientation': orientation },
  children,
});

/** A rule that means something, named by its words. */
const meaningful = (orientation: Orientation): Fixture => ({
  tag: 'span',
  classes: ['volt-separator'],
  attributes: {
    role: 'separator',
    'aria-orientation': orientation,
    'aria-label': 'Comments',
    'data-orientation': orientation,
  },
  children: worded,
});

/** A splitter, as the primitive marks one with a size to move. */
const splitter = (orientation: Orientation, focus = false): Fixture => ({
  tag: 'span',
  classes: ['volt-separator'],
  attributes: {
    role: 'separator',
    'aria-orientation': orientation,
    'aria-label': 'Resize sidebar',
    'aria-valuenow': '30',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'data-orientation': orientation,
    tabindex: '0',
  },
  focus,
  children: [line],
});

export const fixtures: ComponentFixtures = {
  states: [
    // Which way a rule runs is the whole of what it says: across a column of
    // text, or between two things standing side by side. The line moves to
    // the other edge, and an edge is geometry, which a forced palette keeps.
    { state: 'orientation', off: rule('horizontal'), on: rule('vertical') },
    // A splitter is a tab stop, and which one the keys are about to move has
    // to be drawn — a ring inside its grab area, and the line in the
    // palette's own colour for a selection.
    { state: 'focus', off: splitter('vertical'), on: splitter('vertical', true) },
    // A line that moves, beside one that does not. The grab area round it is
    // empty, so the line is all there is to see of the control, and a pointer
    // has nothing else to find it by: its colour says so in the ordinary
    // palette, and its weight once the palette is the user's.
    { state: 'moves', off: rule('vertical'), on: splitter('vertical') },
    { state: 'moves across', off: rule('horizontal'), on: splitter('horizontal') },
  ],
  extra: [
    rule('horizontal', worded),
    rule('vertical', worded),
    meaningful('horizontal'),
    meaningful('vertical'),
    splitter('horizontal', true),
  ],
};
