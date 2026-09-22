/**
 * Accordion: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const accordion = (state: string, attributes: Record<string, string> = {}, focus = false): Fixture => ({
  classes: ['volt-accordion'],
  attributes: { 'data-orientation': 'vertical' },
  children: [
    {
      classes: ['volt-accordion-item'],
      attributes: { 'data-state': state, 'data-orientation': 'vertical', ...attributes },
      children: [
        {
          tag: 'h3',
          classes: ['volt-accordion-header'],
          children: [
            {
              tag: 'button',
              classes: ['volt-accordion-trigger'],
              attributes: { 'data-state': state, ...attributes },
              focus,
            },
          ],
        },
        {
          classes: ['volt-accordion-panel'],
          // The height a collapse animates to is measured by the primitive and
          // written on the element, so the fixture has to carry one for the
          // keyframes to resolve to anything.
          attributes: { 'data-state': state, style: '--volt-collapsible-height: 80px' },
        },
      ],
    },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
      { state: 'presence', off: accordion('closed'), on: accordion('open') },
      {
        state: 'disabled',
        off: accordion('closed'),
        on: accordion('closed', { 'data-disabled': '' }),
      },
      { state: 'focus', off: accordion('closed'), on: accordion('closed', {}, true) },
    ],
};
