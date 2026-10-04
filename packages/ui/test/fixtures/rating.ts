/**
 * Rating: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 *
 * Solid against hollow is drawn in `fill-opacity`, which no forced palette
 * touches and which the sweep does not measure. What it measures is the
 * colour the sheet restates for the filled star in a system colour of its
 * own — so each pair below is held by a channel the sweep can see as well as
 * the one a reader does.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** One radio, as the primitive marks it, with the shape inside it. */
const item = (
  attributes: Record<string, string> = {},
  focus = false,
): Fixture => ({
  tag: 'span',
  classes: ['volt-rating-item'],
  attributes: {
    role: 'radio',
    'aria-checked': 'false',
    'aria-label': '1 of 5',
    'data-state': 'unchecked',
    'data-value': '1',
    'data-volt-item': '',
    tabindex: '0',
    ...attributes,
  },
  focus,
  children: [{ tag: 'span', classes: ['volt-rating-icon'], attributes: { 'aria-hidden': 'true' } }],
});

/** A score nobody can change: an image, its one star hidden from everything. */
const image = (attributes: Record<string, string> = {}): Fixture => ({
  classes: ['volt-rating'],
  attributes: {
    role: 'img',
    'aria-label': 'Rated 1 of 5',
    'data-readonly': '',
    'data-value': '1',
    ...attributes,
  },
  children: [
    {
      tag: 'span',
      classes: ['volt-rating-star'],
      children: [
        {
          tag: 'span',
          classes: ['volt-rating-item'],
          attributes: { 'aria-hidden': 'true', 'data-filled': '', 'data-value': '1' },
          children: [{ tag: 'span', classes: ['volt-rating-icon'] }],
        },
      ],
    },
  ],
});

/** A rating of one star, holding the radios given; two of them make a star of halves. */
const rating = (
  attributes: Record<string, string> = {},
  items: readonly Fixture[] = [item()],
): Fixture => ({
  classes: ['volt-rating'],
  attributes: { role: 'radiogroup', 'aria-orientation': 'horizontal', 'data-value': '0', ...attributes },
  children: [{ tag: 'span', classes: ['volt-rating-star'], children: items }],
});

export const fixtures: ComponentFixtures = {
  states: [
    // The score is the whole of what a rating says, so which stars hold it has
    // to survive any palette: `Highlight` against `CanvasText`, and a solid
    // shape against an outline.
    {
      state: 'filled',
      off: rating(),
      on: rating({ 'data-value': '1' }, [
        item({ 'data-filled': '', 'aria-checked': 'true', 'data-state': 'checked' }),
      ]),
    },
    // A star the pointer lights beyond the score is not chosen yet, and a
    // reader who cannot tell it from one that is would think the press had
    // already happened.
    {
      state: 'preview',
      off: rating({}, [item({ 'data-filled': '' })]),
      on: rating({}, [item({ 'data-filled': '', 'data-preview': '' })]),
    },
    {
      state: 'disabled',
      off: rating(),
      on: rating({ 'data-disabled': '', 'aria-disabled': 'true' }, [
        item({ 'data-disabled': '', 'aria-disabled': 'true', tabindex: '-1' }),
      ]),
    },
    // One star holds the tab stop, and nothing else on screen says which.
    { state: 'focus', off: rating(), on: rating({}, [item({}, true)]) },
    // A read-only score is still the form's answer; disabled as well, it is
    // not sent, and the two cannot look the same.
    {
      state: 'disabled while read-only',
      off: image(),
      on: image({ 'data-disabled': '', 'aria-disabled': 'true' }),
    },
  ],
  extra: [
    // Halves: the half filled and the whole beside it not, which is the one
    // shape that has the second radio's shape pulled back.
    rating({ 'data-value': '0.5' }, [
      item({ 'data-value': '0.5', 'data-filled': '', 'aria-checked': 'true', 'data-state': 'checked' }),
      item(),
    ]),
    // Disabled with a score, which is the one pairing with a rule of its own.
    rating({ 'data-disabled': '', 'data-value': '1' }, [
      item({ 'data-disabled': '', 'data-filled': '', 'data-state': 'checked', tabindex: '-1' }),
    ]),
  ],
};
