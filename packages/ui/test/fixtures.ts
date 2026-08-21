/**
 * The markup each component is measured in, and the state changes that have
 * to stay visible when the palette is taken away.
 *
 * A pair belongs here when the difference between its two sides is something
 * a user has to be able to see — checked from unchecked, selected from
 * unselected, this severity from that one. A difference that is only emphasis
 * does not: a ghost button is allowed to look like a plain one once the
 * palette is the user's, and pretending otherwise would only add a rule that
 * says nothing.
 *
 * `test/forced-colors.test.ts` requires an entry here for every component in
 * the registry, so a seventh component cannot arrive without one.
 */

import type { Fixture } from './harness.ts';

export interface StatePair {
  readonly state: string;
  readonly off: Fixture;
  readonly on: Fixture;
}

export interface ComponentFixtures {
  readonly states: readonly StatePair[];
  /** Shapes with no pair of their own, for the sweeps that walk every part. */
  readonly extra?: readonly Fixture[];
}

const button = (attributes: Record<string, string> = {}, focus = false): Fixture => ({
  tag: 'button',
  classes: ['volt-button'],
  attributes,
  focus,
});

const checkbox = (state: string, attributes: Record<string, string> = {}): Fixture => ({
  classes: ['volt-checkbox'],
  attributes: { 'data-state': state, tabindex: '0', ...attributes },
  children: [{ classes: ['volt-checkbox-indicator'] }],
});

const dialog = (state: string): Fixture => ({
  children: [
    { classes: ['volt-dialog-overlay'], attributes: { 'data-state': state } },
    {
      classes: ['volt-dialog-content'],
      attributes: { 'data-state': state, tabindex: '-1' },
      children: [
        { tag: 'h2', classes: ['volt-dialog-title'] },
        { tag: 'p', classes: ['volt-dialog-description'] },
        { classes: ['volt-dialog-footer'] },
      ],
    },
  ],
});

const popover = (state: string, anchored = 'true', focus = false): Fixture => ({
  classes: ['volt-popover-content'],
  attributes: { 'data-state': state, 'data-anchored': anchored, tabindex: '-1' },
  focus,
  children: [
    { tag: 'h2', classes: ['volt-popover-title'] },
    { tag: 'p', classes: ['volt-popover-description'] },
    { classes: ['volt-popover-arrow'], attributes: { 'data-placement': 'bottom' } },
  ],
});

const tab = (attributes: Record<string, string>, focus = false): Fixture => ({
  tag: 'button',
  classes: ['volt-tabs-tab'],
  attributes,
  focus,
});

const toast = (attributes: Record<string, string>): Fixture => ({
  classes: ['volt-toast'],
  attributes,
  children: [
    { tag: 'p', classes: ['volt-toast-title'] },
    { tag: 'p', classes: ['volt-toast-description'] },
    { classes: ['volt-toast-actions'] },
  ],
});

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

const menuItem = (attributes: Record<string, string> = {}, focus = false): Fixture => ({
  classes: ['volt-menu-item'],
  attributes: { tabindex: '-1', ...attributes },
  focus,
});

const menu = (state: string, anchored = 'true'): Fixture => ({
  classes: ['volt-menu-content'],
  attributes: { role: 'menu', 'data-state': state, 'data-anchored': anchored },
  children: [menuItem(), { classes: ['volt-menu-separator'] }, menuItem()],
});

const tooltip = (state: string, anchored = 'true'): Fixture => ({
  classes: ['volt-tooltip-content'],
  attributes: { 'data-state': state, 'data-anchored': anchored },
});

const region = (focus = false): Fixture => ({
  classes: ['volt-toast-region'],
  attributes: { tabindex: '-1' },
  focus,
});

export const fixtures: Readonly<Record<string, ComponentFixtures>> = {
  accordion: {
    states: [
      { state: 'presence', off: accordion('closed'), on: accordion('open') },
      {
        state: 'disabled',
        off: accordion('closed'),
        on: accordion('closed', { 'data-disabled': '' }),
      },
      { state: 'focus', off: accordion('closed'), on: accordion('closed', {}, true) },
    ],
  },

  button: {
    states: [
      { state: 'emphasis', off: button(), on: button({ 'data-variant': 'primary' }) },
      // Both are filled with the one emphasis colour the forced palette has,
      // so what tells them apart there has to be something else.
      {
        state: 'destructive',
        off: button({ 'data-variant': 'primary' }),
        on: button({ 'data-variant': 'danger' }),
      },
      { state: 'disabled', off: button(), on: button({ 'aria-disabled': 'true' }) },
      { state: 'focus', off: button(), on: button({}, true) },
    ],
    extra: [
      button({ 'data-variant': 'ghost' }),
      button({ 'data-size': 'sm' }),
      button({ 'data-size': 'lg' }),
    ],
  },

  checkbox: {
    states: [
      { state: 'checked', off: checkbox('unchecked'), on: checkbox('checked') },
      { state: 'indeterminate', off: checkbox('unchecked'), on: checkbox('indeterminate') },
      {
        state: 'disabled',
        off: checkbox('unchecked'),
        on: checkbox('unchecked', { 'data-disabled': '' }),
      },
    ],
    extra: [{ classes: ['volt-checkbox-field'], children: [checkbox('checked')] }],
  },

  dialog: {
    states: [{ state: 'presence', off: dialog('closed'), on: dialog('open') }],
  },

  popover: {
    states: [
      { state: 'presence', off: popover('closed'), on: popover('open') },
      { state: 'focus', off: popover('open'), on: popover('open', 'true', true) },
    ],
    extra: [popover('open', 'false')],
  },

  tabs: {
    states: [
      {
        state: 'selected',
        off: tab({ 'data-state': 'inactive' }),
        on: tab({ 'data-state': 'active' }),
      },
      {
        state: 'disabled',
        off: tab({ 'data-state': 'inactive' }),
        on: tab({ 'data-state': 'inactive', 'data-disabled': '' }),
      },
      {
        state: 'focus',
        off: tab({ 'data-state': 'inactive' }),
        on: tab({ 'data-state': 'inactive' }, true),
      },
    ],
    extra: [
      { classes: ['volt-tabs-list'], attributes: { 'data-orientation': 'horizontal' } },
      { classes: ['volt-tabs-list'], attributes: { 'data-orientation': 'vertical' } },
      { classes: ['volt-tabs-panel'], attributes: { tabindex: '0' } },
      { classes: ['volt-tabs-panel'], attributes: { tabindex: '0' }, focus: true },
    ],
  },

  menu: {
    states: [
      { state: 'presence', off: menu('closed'), on: menu('open') },
      // Disabled has to survive the palette: the muted colour it is drawn in
      // is one of the first things a forced palette takes away.
      { state: 'disabled', off: menuItem(), on: menuItem({ 'data-disabled': '' }) },
      { state: 'focus', off: menuItem(), on: menuItem({}, true) },
    ],
    extra: [menu('open', 'false')],
  },

  tooltip: {
    states: [{ state: 'presence', off: tooltip('closed'), on: tooltip('open') }],
    extra: [tooltip('open', 'false')],
  },

  toast: {
    states: [
      {
        state: 'severity',
        off: toast({ 'data-type': 'info', 'data-state': 'open' }),
        on: toast({ 'data-type': 'error', 'data-state': 'open' }),
      },
      {
        state: 'presence',
        off: toast({ 'data-type': 'info', 'data-state': 'closed' }),
        on: toast({ 'data-type': 'info', 'data-state': 'open' }),
      },
      { state: 'focus', off: region(), on: region(true) },
    ],
    extra: [
      toast({ 'data-type': 'success', 'data-state': 'open' }),
      toast({ 'data-type': 'warning', 'data-state': 'open' }),
    ],
  },
};

/** Every fixture a component declares, in one list. */
export function allFixtures(name: string): readonly Fixture[] {
  const entry = fixtures[name];
  if (!entry) return [];
  return [...entry.states.flatMap((pair) => [pair.off, pair.on]), ...(entry.extra ?? [])];
}
