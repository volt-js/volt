/**
 * Keyboard shortcut: the markup it is measured in, and the state changes that
 * have to stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** One key, as the component draws it. */
const key = (name: string, attributes: Record<string, string> = {}): Fixture => ({
  tag: 'kbd',
  classes: ['volt-kbd-key'],
  attributes: { 'data-key': name, ...attributes },
});

/** What is drawn between two keys where the platform draws anything. */
const separator: Fixture = {
  tag: 'span',
  classes: ['volt-kbd-separator'],
  attributes: { 'aria-hidden': 'true' },
};

/** The chord around its parts, named the way the primitive names it. */
const chord = (children: readonly Fixture[], attributes: Record<string, string> = {}): Fixture => ({
  tag: 'kbd',
  classes: ['volt-kbd'],
  attributes: {
    role: 'img',
    'aria-label': 'Control +',
    'data-platform': 'other',
    'data-size': 'md',
    ...attributes,
  },
  children,
});

export const fixtures: ComponentFixtures = {
  states: [
    // `['Control', '+']` is `Ctrl + +`: the same glyph once as the separator
    // and once as a key, in the same place in the chord. The keycap's edge is
    // the only thing that says which is which, so it has to survive a palette
    // that takes every colour away.
    {
      state: 'keycap',
      off: chord([key('Control'), separator]),
      on: chord([key('Control'), key('+', { 'data-character': '' })]),
    },
  ],
  extra: [
    chord([key('Meta'), key('k', { 'data-character': '' })], {
      'aria-label': 'Command k',
      'data-platform': 'apple',
    }),
    chord([key('Control'), separator, key('k', { 'data-character': '' })], { 'data-size': 'sm' }),
  ],
};
