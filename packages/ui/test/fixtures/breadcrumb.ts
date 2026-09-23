/**
 * Breadcrumb: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** One crumb of a trail, with the separator after it unless it is the last. */
const crumb = (
  attributes: Record<string, string> = { href: '/docs' },
  focus = false,
  last = false,
): Fixture => ({
  tag: 'nav',
  classes: ['volt-breadcrumb'],
  attributes: { role: 'navigation', 'aria-label': 'Breadcrumb' },
  children: [
    {
      tag: 'ol',
      classes: ['volt-breadcrumb-list'],
      attributes: { role: 'list' },
      children: [
        {
          tag: 'li',
          classes: ['volt-breadcrumb-item'],
          attributes: { 'data-volt-crumb': '0' },
          children: [
            { tag: 'a', classes: ['volt-breadcrumb-link'], attributes, focus },
            ...(last
              ? []
              : [
                  {
                    tag: 'span',
                    classes: ['volt-breadcrumb-separator'],
                    attributes: { 'aria-hidden': 'true' },
                  },
                ]),
          ],
        },
      ],
    },
  ],
});

/**
 * A folded crumb's copy in the overflow menu. Measured on its own, because the
 * menu's sheet is the menu's, with its shadow and its forced edge checked
 * there.
 */
const menuLink = (attributes: Record<string, string>): Fixture => ({
  tag: 'a',
  classes: ['volt-menu-item', 'volt-breadcrumb-menu-link'],
  attributes: { role: 'menuitem', tabindex: '-1', 'data-value': '1', ...attributes },
});

/** The slot holding the overflow menu's trigger, where the collapse is. */
const overflow = (
  triggerAttributes: Record<string, string> = {},
  focus = false,
): Fixture => ({
  tag: 'ol',
  classes: ['volt-breadcrumb-list'],
  attributes: { role: 'list', 'data-collapsed': '' },
  children: [
    {
      tag: 'li',
      classes: ['volt-breadcrumb-item'],
      attributes: { 'data-volt-crumb-overflow': '' },
      children: [
        {
          tag: 'button',
          classes: ['volt-breadcrumb-trigger'],
          attributes: {
            type: 'button',
            'aria-haspopup': 'menu',
            'aria-expanded': 'false',
            'aria-label': 'Show the rest of the path',
            ...triggerAttributes,
          },
          focus,
        },
        {
          tag: 'span',
          classes: ['volt-breadcrumb-separator'],
          attributes: { 'aria-hidden': 'true' },
        },
      ],
    },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    // Where the reader is. The one thing a trail says that is not a way out
    // of the page, and the thing a forced palette must not flatten into one
    // more link.
    {
      state: 'current page',
      off: crumb({ href: '/docs' }, false, true),
      on: crumb({ 'aria-current': 'page' }, false, true),
    },
    // Each crumb is its own tab stop: no roving focus in a trail.
    { state: 'focus', off: crumb(), on: crumb({ href: '/docs' }, true) },
    // The menu covers the page below it, and may cover the button's
    // neighbours; the button still says which one opened it.
    {
      state: 'open',
      off: overflow(),
      on: overflow({ 'aria-expanded': 'true', 'aria-controls': 'menu-content-1' }),
    },
    { state: 'trigger focus', off: overflow(), on: overflow({}, true) },
    // A trail that keeps nothing at its end folds the page itself away, and
    // in the menu it is still where the reader is, not one more place to go.
    {
      state: 'current page in the menu',
      off: menuLink({ href: '/docs' }),
      on: menuLink({ 'aria-current': 'page' }),
    },
  ],
  extra: [
    // A section with no page of its own: text, not a link.
    crumb({}),
    crumb({ href: '/docs', 'data-hover': '' }),
    overflow({ 'data-hover': '' }),
    menuLink({ href: '/docs', 'data-hover': '' }),
  ],
};
