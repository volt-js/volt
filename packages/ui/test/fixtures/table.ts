/**
 * Table: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

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

export const fixtures: ComponentFixtures = {
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
};
