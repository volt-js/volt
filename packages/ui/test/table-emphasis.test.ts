/**
 * Which of a row's colours wins, when a row is in more than one state.
 *
 * A table draws three things on a row, and only one of them is information.
 * Striping and the pointer say where you are; selection says which rows the
 * next action is about to be taken on. So selection has to win — and "has to
 * win" is not settled by writing its rule last, because the cascade asks
 * specificity first, and the stripe's rule names two classes and an attribute
 * to the selected row's one class and one attribute.
 *
 * That is the whole of this file: a stripe that beat a selection on a table
 * where both were true, which is a selection a user cannot see.
 */
import { describe, expect, it } from 'vitest';
import { primitiveTokens } from '../src/index.ts';
import { styledDocument, type Fixture } from './harness.ts';

/** A striped table with two rows, the second of which is `selected`. */
function striped(rowAttributes: Record<string, string>): Fixture {
  return {
    tag: 'table',
    classes: ['volt-table'],
    attributes: { 'data-striped': 'true' },
    children: [
      {
        tag: 'tbody',
        classes: ['volt-table-body'],
        children: [
          { tag: 'tr', classes: ['volt-table-row'] },
          { tag: 'tr', classes: ['volt-table-row'], attributes: rowAttributes },
        ],
      },
    ],
  };
}

function background(fixture: Fixture): string {
  const dom = styledDocument();
  const table = dom.mount(fixture);
  const row = table.querySelectorAll('tr')[1]!;
  const colour = dom.window.getComputedStyle(row).getPropertyValue('background-color');
  dom.close();
  return colour;
}

describe('a row that is striped and selected', () => {
  it('is drawn as selected', () => {
    expect(background(striped({ 'data-selected': 'true' }))).toBe(
      primitiveTokens['--volt-palette-accent-100'],
    );
  });

  it('is drawn as a stripe when it is only that', () => {
    expect(background(striped({}))).toBe(primitiveTokens['--volt-palette-neutral-50']);
  });

  it('is drawn as selected under the pointer as well', () => {
    expect(background(striped({ 'data-selected': 'true', 'data-hover': '' }))).toBe(
      primitiveTokens['--volt-palette-accent-100'],
    );
  });
});
