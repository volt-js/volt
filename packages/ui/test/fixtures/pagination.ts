/**
 * Pagination: the markup it is measured in, and the state changes that have
 * to stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** A page number, as the primitive marks one that is not the current page. */
const page = (
  attributes: Record<string, string> = {},
  focus = false,
  tag = 'button',
): Fixture => ({
  tag,
  classes: ['volt-pagination-page'],
  attributes: {
    'data-volt-page': '2',
    'aria-label': 'Page 2',
    'data-state': 'inactive',
    tabindex: '-1',
    ...attributes,
  },
  focus,
});

/** Previous, next, first or last. */
const control = (attributes: Record<string, string> = {}, tag = 'button'): Fixture => ({
  tag,
  classes: ['volt-pagination-control'],
  attributes: {
    'data-volt-page': 'next',
    'aria-label': 'Next page',
    tabindex: '-1',
    ...attributes,
  },
});

const current = { 'data-state': 'active', 'aria-current': 'page', tabindex: '0' };
const disabled = { 'aria-disabled': 'true', 'data-disabled': '' };

/** One of each, in a row, the way the component draws it. */
const row = (children: readonly Fixture[]): Fixture => ({
  tag: 'nav',
  classes: ['volt-pagination'],
  attributes: { role: 'navigation', 'aria-label': 'Pagination' },
  children: [
    {
      tag: 'ul',
      classes: ['volt-pagination-list'],
      attributes: { role: 'list' },
      children: children.map((child) => ({
        tag: 'li',
        classes: ['volt-pagination-item'],
        children: [child],
      })),
    },
    {
      tag: 'p',
      classes: ['volt-pagination-status'],
      attributes: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
    },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    // Which page the list beneath is showing is the whole of what a pager
    // says, so it has to survive any palette.
    { state: 'current', off: page(), on: page(current) },
    // A control at the end of the range is left in the row, so the row does
    // not move under the pointer — which means it has to look like one that
    // goes nowhere, or a press on it is a press that did nothing.
    { state: 'disabled', off: control(), on: control(disabled) },
    // One tab stop for the row, so where the keyboard is inside it cannot be
    // worked out from anything else on screen.
    { state: 'focus', off: page(), on: page({}, true) },
    // The same two, drawn in links once `href` is given. A link is not a
    // button to a forced palette, which has its own colour for one, so each
    // has to hold there too.
    {
      state: 'current link',
      off: page({ href: '#page-2' }, false, 'a'),
      on: page({ ...current, href: '#page-2' }, false, 'a'),
    },
    {
      state: 'disabled link',
      off: control({ href: '#page-2' }, 'a'),
      on: control({ role: 'link', ...disabled }, 'a'),
    },
  ],
  extra: [
    page({ 'data-hover': '' }),
    control({ 'data-hover': '' }),
    page(current, true),
    row([
      control({ 'data-volt-page': 'previous', 'aria-label': 'Previous page', ...disabled }),
      page({ ...current, 'data-volt-page': '1', 'aria-label': 'Page 1' }),
      page(),
      { tag: 'span', classes: ['volt-pagination-ellipsis'], attributes: { 'aria-hidden': 'true' } },
      page({ 'data-volt-page': '9', 'aria-label': 'Page 9' }),
      control(),
    ]),
    // The same row drawn in links, where a control that goes nowhere has no
    // `href` and says it is a link with `role` instead.
    row([
      control(
        { 'data-volt-page': 'previous', 'aria-label': 'Previous page', role: 'link', ...disabled },
        'a',
      ),
      page(
        { ...current, 'data-volt-page': '1', 'aria-label': 'Page 1', href: '#page-1' },
        false,
        'a',
      ),
      page({ href: '#page-2' }, false, 'a'),
      control({ href: '#page-2' }, 'a'),
    ]),
  ],
};
