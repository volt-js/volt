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
 *
 * The pointer is `data-hover`, which the harness's copy of the sheet reads in
 * place of `:hover` — happy-dom never matches the real thing.
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

const popover = (state: string, focus = false): Fixture => ({
  classes: ['volt-popover-content'],
  attributes: { 'data-state': state, 'data-placement': 'bottom', tabindex: '-1' },
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

const menu = (state: string): Fixture => ({
  classes: ['volt-menu-content'],
  attributes: { role: 'menu', 'data-state': state },
  children: [menuItem(), { classes: ['volt-menu-separator'] }, menuItem()],
});

const tooltip = (state: string): Fixture => ({
  classes: ['volt-tooltip-content'],
  attributes: { 'data-state': state },
});

/**
 * A one-row table, because most of the sheet's selectors are descendants: a
 * `<tr>` on its own is not striped, hovered or selected by anything.
 */
const table = (
  rowAttributes: Record<string, string> = {},
  tableAttributes: Record<string, string> = {},
): Fixture => ({
  tag: 'table',
  classes: ['volt-table'],
  attributes: tableAttributes,
  children: [
    {
      tag: 'thead',
      classes: ['volt-table-header'],
      children: [
        {
          tag: 'tr',
          classes: ['volt-table-row'],
          children: [{ tag: 'th', classes: ['volt-table-header-cell'] }],
        },
      ],
    },
    {
      tag: 'tbody',
      classes: ['volt-table-body'],
      children: [
        {
          tag: 'tr',
          classes: ['volt-table-row'],
          attributes: rowAttributes,
          children: [{ tag: 'td', classes: ['volt-table-cell'] }],
        },
      ],
    },
  ],
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
      { state: 'hover', off: button(), on: button({ 'data-hover': '' }) },
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
      { state: 'focus', off: popover('open'), on: popover('open', true) },
    ],
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
      {
        state: 'hover',
        off: tab({ 'data-state': 'inactive' }),
        on: tab({ 'data-state': 'inactive', 'data-hover': '' }),
      },
    ],
    extra: [
      tab({ 'data-state': 'active', 'data-orientation': 'vertical' }),
      tab({ 'data-state': 'inactive', 'data-orientation': 'vertical' }),
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
      {
        state: 'disabled',
        off: menuItem(),
        on: menuItem({ 'aria-disabled': 'true', 'data-disabled': '' }),
      },
      // The primitive treats a `<button>` item that is natively `disabled` as
      // unavailable too, and writes nothing on it to say so.
      {
        state: 'natively disabled',
        off: { ...menuItem(), tag: 'button' },
        on: { ...menuItem({ disabled: '' }), tag: 'button' },
      },
      { state: 'focus', off: menuItem(), on: menuItem({}, true) },
      // Focus follows the pointer through a menu without drawing a ring, so the
      // hover background is the only thing marking the item a pointer is on.
      { state: 'hover', off: menuItem(), on: menuItem({ 'data-hover': '' }) },
    ],
  },

  table: {
    states: [
      // The one state a table draws that is information rather than emphasis:
      // which rows an action is about to be taken on.
      {
        state: 'selected',
        off: table(),
        on: table({ 'data-selected': 'true', 'aria-selected': 'true' }),
      },
    ],
    extra: [
      table({ 'data-hover': '' }),
      table({}, { 'data-striped': 'true' }),
      {
        tag: 'table',
        classes: ['volt-table'],
        children: [
          {
            tag: 'tbody',
            classes: ['volt-table-body'],
            children: [
              {
                tag: 'tr',
                classes: ['volt-table-row'],
                children: [
                  { tag: 'td', classes: ['volt-table-cell'], attributes: { 'data-align': 'end' } },
                  { tag: 'td', classes: ['volt-table-empty'], attributes: { colspan: '2' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  tooltip: {
    states: [{ state: 'presence', off: tooltip('closed'), on: tooltip('open') }],
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
