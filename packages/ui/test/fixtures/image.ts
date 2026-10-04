/**
 * Image: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** The picture as the primitive writes it, with the size it was given. */
const picture = (status: string, attributes: Record<string, string> = {}): Fixture => ({
  tag: 'img',
  classes: ['volt-image-picture'],
  attributes: {
    alt: 'The first edition',
    width: '1200',
    height: '800',
    'data-status': status,
    'data-fit': 'cover',
    ...attributes,
  },
});

/** A picture of no known size, for a box that has only a ratio. */
const unsized = (status: string): Fixture => ({
  tag: 'img',
  classes: ['volt-image-picture'],
  attributes: { alt: 'A view of the harbour', 'data-status': status, 'data-fit': 'cover' },
});

const placeholder: Fixture = {
  tag: 'span',
  classes: ['volt-image-placeholder'],
  attributes: { 'aria-hidden': 'true' },
};

const message: Fixture = { tag: 'span', classes: ['volt-image-error'] };

/**
 * The box, with the picture in it and whatever else stands there in that
 * status. `null` for the ratio is a box the primitive knows no shape for.
 */
const image = (
  status: string,
  children: readonly Fixture[] = [picture(status)],
  ratio: string | null = '1200 / 800',
): Fixture => ({
  tag: 'span',
  classes: ['volt-image'],
  attributes: { 'data-status': status, ...(ratio ? { style: `aspect-ratio: ${ratio}` } : {}) },
  children,
});

export const fixtures: ComponentFixtures = {
  states: [
    // Whether the space is still being held. Both sides are the box and the
    // picture alone: the placeholder comes and goes under `:if`, which is the
    // markup's doing, and what the sheet answers for is the box — a shape
    // where a picture will be, until it is there. The fill that says so is
    // replaced by the forced palette, so the outline has to.
    { state: 'loaded', off: image('loading'), on: image('loaded') },
    // A picture that failed is hidden, so its broken icon and its `alt` drawn
    // as text are not what stands in the box — the message is. In `opacity`,
    // which no palette touches.
    {
      state: 'failed',
      off: image('loaded'),
      on: image('error', [picture('error'), message]),
    },
  ],
  extra: [
    image('loading', [picture('loading'), placeholder]),
    image('idle', [picture('idle')]),
    image('loaded', [picture('loaded', { 'data-fit': 'contain' })]),
    image('loading', [unsized('loading'), placeholder], '16 / 9'),
    // No shape at all, failed: the message is what gives the box a height.
    image('error', [unsized('error'), message], null),
  ],
};
