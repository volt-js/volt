/**
 * PIN input: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** One box, out of the tab order unless the attributes say otherwise. */
const box = (attributes: Record<string, string> = {}, focus = false): Fixture => ({
  tag: 'input',
  classes: ['volt-pin-input-box'],
  attributes: { type: 'text', tabindex: '-1', 'data-volt-pin-box': '0', ...attributes },
  focus,
  text: 'data-filled' in attributes ? '4' : undefined,
});

const group = (attributes: Record<string, string>, boxes: readonly Fixture[]): Fixture => ({
  classes: ['volt-pin-input'],
  attributes: { role: 'group', ...attributes },
  children: boxes,
});

export const fixtures: ComponentFixtures = {
  states: [
    // Where the next character goes. The group holds one tab stop, and the
    // box it is on is the only thing saying where typing will resume.
    { state: 'caret', off: box(), on: box({ tabindex: '0' }) },
    // A code the page has refused has to look refused on every box, whatever
    // palette the reader brought.
    { state: 'invalid', off: box(), on: box({ 'aria-invalid': 'true' }) },
    { state: 'disabled', off: box(), on: box({ disabled: '' }) },
    { state: 'focus', off: box(), on: box({}, true) },
  ],
  extra: [
    // Half a code: the boxes typed into, the caret on the next, and the rest.
    group({}, [
      box({ 'data-filled': '' }),
      box({ 'data-filled': '', 'data-volt-pin-box': '1' }),
      box({ tabindex: '0', 'data-volt-pin-box': '2' }),
      box({ 'data-volt-pin-box': '3' }),
    ]),
    // A whole one, which the primitive marks on the group and the sheet
    // leaves alone: a full row of glyphs already says so.
    group({ 'data-complete': '' }, [
      box({ 'data-filled': '' }),
      box({ 'data-filled': '', tabindex: '0', 'data-volt-pin-box': '1' }),
    ]),
    // Refused while the user is on a box: the caret's edge keeps its width
    // under the colour the refusal paints over it.
    group({ 'aria-invalid': 'true' }, [
      box({ 'aria-invalid': 'true', 'data-filled': '' }),
      box({ 'aria-invalid': 'true', tabindex: '0', 'data-volt-pin-box': '1' }),
    ]),
    group({ 'aria-disabled': 'true' }, [
      box({ disabled: '', tabindex: '0' }),
      box({ disabled: '', 'data-volt-pin-box': '1' }),
    ]),
  ],
};
