/**
 * Chip: the markup it is measured in, and the state changes that have to stay
 * visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 *
 * Tone has no pair. It is emphasis, never spoken, and a forced palette is
 * allowed to draw every tone alike — the sheet says why.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

interface Shape {
  readonly tone?: string;
  readonly size?: string;
  readonly removable?: boolean;
  readonly focus?: boolean;
  /** The pointer on the remove button. */
  readonly hover?: boolean;
}

/**
 * A chip as the primitive and the component leave it: its words, and a button
 * when it can be removed, which is also when it is a tab stop.
 */
const chip = ({
  tone = 'neutral',
  size = 'md',
  removable = true,
  focus = false,
  hover = false,
}: Shape = {}): Fixture => ({
  tag: 'span',
  classes: ['volt-chip'],
  attributes: {
    tabindex: removable ? '0' : '-1',
    'data-volt-item': '',
    'data-tone': tone,
    'data-size': size,
  },
  focus,
  children: [
    { tag: 'span', classes: ['volt-chip-label'] },
    ...(removable
      ? [
          {
            tag: 'button',
            classes: ['volt-chip-remove'],
            attributes: {
              type: 'button',
              tabindex: '-1',
              'aria-label': 'Remove',
              ...(hover ? { 'data-hover': '' } : {}),
            },
          },
        ]
      : []),
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    // Which chip the keyboard is on. Delete and Backspace take away the chip
    // that has focus, so a user who cannot see where it is cannot know which
    // tag the next key press removes.
    { state: 'focus', off: chip(), on: chip({ focus: true }) },
  ],
  extra: [
    chip({ tone: 'accent' }),
    chip({ tone: 'success' }),
    chip({ tone: 'warning' }),
    chip({ tone: 'danger' }),
    chip({ size: 'sm' }),
    chip({ size: 'sm', tone: 'danger', removable: false }),
    chip({ hover: true }),
    chip({ tone: 'accent', hover: true }),
  ],
};
