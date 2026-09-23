/**
 * Stepper: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not. Every
 * status a step can have is here, measured against a step the user has not
 * reached, because each one is where the user stands in the flow and none of
 * them is emphasis.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** A step as `<v-step>` draws it; the primitive's attributes go on the button. */
const step = (attributes: Record<string, string> = {}, focus = false): Fixture => ({
  tag: 'button',
  classes: ['volt-stepper-step'],
  attributes: { type: 'button', 'data-status': 'upcoming', ...attributes },
  focus,
  children: [
    {
      tag: 'span',
      classes: ['volt-stepper-marker'],
      attributes: { 'aria-hidden': 'true' },
      children: [
        { tag: 'span', classes: ['volt-stepper-number'] },
        { tag: 'span', classes: ['volt-stepper-check'] },
      ],
    },
    {
      tag: 'span',
      classes: ['volt-stepper-text'],
      children: [
        { tag: 'span', classes: ['volt-stepper-label'] },
        { tag: 'span', classes: ['volt-stepper-description'] },
      ],
    },
    { tag: 'span', classes: ['volt-stepper-status'] },
  ],
});

const CURRENT = { 'data-status': 'current', 'aria-current': 'step' };

/** A step and the line after it, which is how a list item holds them. */
const item = (
  attributes: Record<string, string>,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
): Fixture => ({
  tag: 'li',
  classes: ['volt-stepper-item'],
  children: [
    step(attributes),
    {
      tag: 'span',
      classes: ['volt-stepper-separator'],
      attributes: { 'aria-hidden': 'true', 'data-orientation': orientation },
    },
  ],
});

const stepper = (orientation: 'horizontal' | 'vertical'): Fixture => ({
  tag: 'nav',
  classes: ['volt-stepper'],
  attributes: { role: 'navigation', 'aria-label': 'Progress' },
  children: [
    {
      tag: 'ol',
      classes: ['volt-stepper-list'],
      attributes: { role: 'list', 'data-orientation': orientation },
      children: [
        item({ 'data-status': 'complete' }, orientation),
        item(CURRENT, orientation),
        {
          tag: 'li',
          classes: ['volt-stepper-item'],
          children: [step({ 'aria-disabled': 'true' })],
        },
      ],
    },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    {
      state: 'complete',
      off: step(),
      on: step({ 'data-status': 'complete' }),
    },
    { state: 'current', off: step(), on: step(CURRENT) },
    // Where a linear flow refuses the user: focusable, so they can read
    // ahead, and marked as somewhere they cannot go yet.
    {
      state: 'not reached',
      off: step(),
      on: step({ 'aria-disabled': 'true' }),
    },
    // Done somewhere else, ahead of a step that is not: the flow still
    // refuses it, and it still has to say it is done.
    {
      state: 'complete where the flow refuses it',
      off: step({ 'aria-disabled': 'true' }),
      on: step({ 'data-status': 'complete', 'aria-disabled': 'true' }),
    },
    {
      state: 'error',
      off: step(),
      on: step({ 'data-status': 'error' }),
    },
    // The primitive reports `error` over `current`, and the step the user is
    // on has to go on looking like it while it says so.
    {
      state: 'error on the current step',
      off: step(CURRENT),
      on: step({ ...CURRENT, 'data-status': 'error' }),
    },
    {
      state: 'disabled',
      off: step(),
      on: step({ 'aria-disabled': 'true', 'data-disabled': '' }),
    },
    { state: 'focus', off: step(), on: step({}, true) },
    { state: 'hover', off: step(), on: step({ 'data-hover': '' }) },
  ],
  extra: [
    stepper('horizontal'),
    stepper('vertical'),
    step({ 'data-status': 'complete', 'aria-disabled': 'true' }),
    step({ 'data-status': 'complete', 'data-hover': '' }),
    {
      classes: ['volt-stepper-panel'],
      attributes: { role: 'group', 'data-status': 'current' },
    },
  ],
};
