/**
 * Alert: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 *
 * The whole tree, root included, because severity is written on the region and
 * drawn on the message inside it: a `.volt-alert-message` mounted on its own
 * is every severity at once.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

const alert = (severity: string, state = 'open'): Fixture => ({
  classes: ['volt-alert'],
  attributes: { 'data-severity': severity, 'data-state': state },
  children: [
    {
      classes: ['volt-alert-message'],
      attributes: { 'data-state': state },
      children: [
        { tag: 'span', classes: ['volt-alert-icon'] },
        {
          classes: ['volt-alert-content'],
          children: [
            { tag: 'p', classes: ['volt-alert-title'] },
            { classes: ['volt-alert-description'] },
            { classes: ['volt-alert-actions'] },
          ],
        },
      ],
    },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    // What kind of thing happened is the one thing here a reader has to be
    // able to tell without being told: the hue on the edge is emphasis, the
    // style of that edge is the information.
    {
      state: 'severity',
      off: alert('info'),
      on: alert('danger'),
    },
    // Whether there is anything to say at all. The region is on the page
    // either way, so this is the message inside it arriving.
    {
      state: 'presence',
      off: alert('info', 'closed'),
      on: alert('info', 'open'),
    },
  ],
  extra: [alert('success'), alert('warning')],
};
