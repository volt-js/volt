/**
 * Slider: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** One thumb, as the primitive marks it. */
const thumb = (attributes: Record<string, string> = {}, focus = false): Fixture => ({
  tag: 'span',
  classes: ['volt-slider-thumb'],
  attributes: {
    role: 'slider',
    'data-volt-slider-thumb': '0',
    'data-index': '0',
    'data-orientation': 'horizontal',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '40',
    tabindex: '0',
    ...attributes,
  },
  focus,
});

/** The filled span, as the primitive marks it. */
const range = (attributes: Record<string, string> = {}): Fixture => ({
  tag: 'span',
  classes: ['volt-slider-range'],
  attributes: { 'data-orientation': 'horizontal', ...attributes },
});

/** One tick, inside the filled span or outside it. */
const mark = (state: string, attributes: Record<string, string> = {}): Fixture => ({
  tag: 'span',
  classes: ['volt-slider-mark'],
  attributes: {
    'aria-hidden': 'true',
    'data-state': state,
    'data-value': '50',
    'data-percent': '50',
    'data-orientation': 'horizontal',
    ...attributes,
  },
  children: [{ tag: 'span', classes: ['volt-slider-mark-label'], text: '50' }],
});

/**
 * A whole slider, the way the component draws one: `group` is what the
 * primitive writes on the group alone, and `parts` what it writes on the
 * track and the range as well, which is `data-disabled`.
 */
const slider = (
  orientation: 'horizontal' | 'vertical',
  group: Record<string, string> = {},
  parts: Record<string, string> = {},
  thumbs: readonly Fixture[] = [thumb({ 'data-orientation': orientation, ...parts })],
): Fixture => ({
  classes: ['volt-slider'],
  attributes: {
    role: 'group',
    'data-orientation': orientation,
    'data-state': 'valid',
    ...group,
    ...parts,
  },
  children: [
    { tag: 'span', classes: ['volt-slider-label'], text: 'Volume' },
    {
      tag: 'span',
      classes: ['volt-slider-track'],
      attributes: { 'data-orientation': orientation, ...parts },
      children: [
        range({ 'data-orientation': orientation, ...parts }),
        mark('inactive', { 'data-orientation': orientation }),
        mark('active', { 'data-orientation': orientation }),
        ...thumbs,
      ],
    },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    // A thumb nobody can move has to look like one, or a press on it is a
    // press that did nothing: its edge changes colour, and once the palette
    // is the user's it changes to the palette's own word for unavailable.
    { state: 'disabled', off: thumb(), on: thumb({ 'data-disabled': '' }) },
    // The fill says which values are chosen, so it is `Highlight` once the
    // palette is the user's — and a slider that is off cannot go on saying
    // it in the colour of a live selection.
    { state: 'disabled fill', off: range(), on: range({ 'data-disabled': '' }) },
    // Which ticks are inside the span is information a scale carries — the
    // fill says it in the ordinary palette, and the tick says it again in a
    // colour the palette keeps once the fill is `Highlight`.
    { state: 'mark in range', off: mark('inactive'), on: mark('active') },
    // A range is two tab stops that look alike, so which one the keys will
    // move cannot be worked out from anything else on screen.
    { state: 'focus', off: thumb(), on: thumb({}, true) },
  ],
  extra: [
    thumb({ 'data-hover': '' }),
    thumb({ 'data-active': '' }),
    slider('horizontal', { 'data-scale': '' }),
    slider('horizontal', {}, { 'data-disabled': '' }),
    slider('horizontal', { 'data-dragging': '' }, {}, [thumb({ 'data-active': '' })]),
    slider('vertical', { 'data-scale': '' }, {}, [
      thumb({ 'data-orientation': 'vertical' }),
      thumb({ 'data-orientation': 'vertical', 'data-index': '1', 'data-volt-slider-thumb': '1' }),
    ]),
  ],
};
