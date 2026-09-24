/**
 * Avatar: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const image = (status: string): Fixture => ({
  tag: 'img',
  classes: ['volt-avatar-image'],
  attributes: { alt: '', 'data-status': status },
});

const initials = (status: string): Fixture => ({
  tag: 'span',
  classes: ['volt-avatar-fallback'],
  attributes: { role: 'img', 'aria-label': 'Ada Lovelace', 'data-status': status },
});

/** The box, with the parts the primitive has on the page in that status. */
const avatar = (
  status: string,
  attributes: Record<string, string> = {},
  withFallback = status !== 'loaded',
): Fixture => ({
  tag: 'span',
  classes: ['volt-avatar'],
  attributes: { 'data-status': status, 'data-size': 'md', 'data-shape': 'circle', ...attributes },
  children: withFallback ? [image(status), initials(status)] : [image(status)],
});

export const fixtures: ComponentFixtures = {
  states: [
    // Whether the picture is the thing on screen. Both sides are the box and
    // the image alone: the fallback comes and goes under `:if`, which is the
    // markup's doing, and what the sheet has to answer for is the image. It
    // answers in `opacity`, which no palette touches — and it has to, because
    // an image that stays invisible after it loaded is a person shown as two
    // letters for good.
    { state: 'loaded', off: avatar('loading', {}, false), on: avatar('loaded') },
  ],
  extra: [
    avatar('loading'),
    avatar('error'),
    avatar('idle'),
    avatar('idle', { 'data-size': 'sm' }),
    avatar('idle', { 'data-size': 'lg' }),
    avatar('idle', { 'data-shape': 'square' }),
    avatar('loaded', { 'data-size': 'lg', 'data-shape': 'square' }),
  ],
};
