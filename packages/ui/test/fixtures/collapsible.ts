/**
 * Collapsible: the markup it is measured in, and the state changes that have
 * to stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const collapsible = (
  state: 'open' | 'closed',
  attributes: Record<string, string> = {},
  focus = false,
): Fixture => ({
  classes: ['volt-collapsible'],
  children: [
    {
      tag: 'button',
      classes: ['volt-collapsible-trigger'],
      attributes: {
        type: 'button',
        'aria-expanded': String(state === 'open'),
        'data-state': state,
        ...attributes,
      },
      focus,
      children: [
        { tag: 'span', classes: ['volt-collapsible-indicator'], attributes: { 'aria-hidden': 'true' } },
      ],
    },
    {
      classes: ['volt-collapsible-panel'],
      // In both halves of the pair, because a closing panel is still in the
      // page while its collapse runs — and the height it runs from is measured
      // by the primitive and written on the element, so the fixture has to
      // carry one for the keyframes to resolve to anything.
      attributes: { 'data-state': state, style: '--volt-collapsible-height: 80px' },
    },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    { state: 'open', off: collapsible('closed'), on: collapsible('open') },
    {
      state: 'disabled',
      off: collapsible('closed'),
      on: collapsible('closed', { 'data-disabled': '', 'aria-disabled': 'true' }),
    },
    { state: 'focus', off: collapsible('closed'), on: collapsible('closed', {}, true) },
  ],
};
