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
          children: [{ tag: 'th', classes: ['volt-table-header-cell'], text: 'Name' }],
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
          children: [{ tag: 'td', classes: ['volt-table-cell'], text: 'Ada Lovelace' }],
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
      table({ 'data-selected': 'true', 'aria-selected': 'true', 'data-hover': '' }),
      // A cell holds whatever a caller writes in it, which is other
      // components as often as words: a selected row has to leave theirs as
      // legible as an unselected one does. Here, a button under the pointer,
      // as the docs' own table has in every row, and a shortcut whose `+`
      // is words in the palette's text colour with no fill of its own.
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
                attributes: { 'data-selected': 'true', 'aria-selected': 'true' },
                children: [
                  {
                    tag: 'td',
                    classes: ['volt-table-cell'],
                    children: [
                      {
                        tag: 'kbd',
                        classes: ['volt-kbd'],
                        attributes: { 'data-platform': 'other', 'data-size': 'md' },
                        children: [
                          { tag: 'kbd', classes: ['volt-kbd-key'], text: 'Ctrl' },
                          { tag: 'span', classes: ['volt-kbd-separator'], text: '+' },
                          { tag: 'kbd', classes: ['volt-kbd-key'], text: 'K' },
                        ],
                      },
                    ],
                  },
                  {
                    tag: 'td',
                    classes: ['volt-table-cell'],
                    attributes: { 'data-align': 'end' },
                    children: [
                      {
                        tag: 'button',
                        classes: ['volt-button'],
                        attributes: { 'data-size': 'sm', 'data-hover': '' },
                        text: 'Deselect',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
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
                  {
                    tag: 'td',
                    classes: ['volt-table-cell'],
                    attributes: { 'data-align': 'end' },
                    text: '42',
                  },
                  {
                    tag: 'td',
                    classes: ['volt-table-empty'],
                    attributes: { colspan: '2' },
                    text: 'Nothing here yet',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
};
