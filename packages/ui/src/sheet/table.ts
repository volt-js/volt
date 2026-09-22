/**
 * Table — rows of data, and the lines that keep them apart.
 *
 * A table is the one component here with no primitive behind it, because what
 * it needs is markup the platform already defines: `<table>` and its parts
 * carry the row and column relationships a screen reader reads out, and
 * nothing a `<div>` grid does can replace them. So the sheet's work is lines,
 * spacing and the two states a row can be in.
 *
 * Only one of those states is information. Striping and hover are emphasis —
 * a way to follow a row across a wide table — and are allowed to disappear
 * when the user brings their own palette. Selection is not: which rows are
 * about to be acted on is the whole point of a selection, so it is drawn in
 * `Highlight` and `HighlightText` when the palette is forced, and marked with
 * `aria-selected` besides.
 *
 * The lines are on the cells rather than the rows, because a row's border is
 * not painted when the table collapses its borders — the cell's is.
 */

import type { ComponentStyles } from '../css.js';
import { transition } from './shared.js';

const root = 'volt-table';
const header = 'volt-table-header';
const headerCell = 'volt-table-header-cell';
const body = 'volt-table-body';
const row = 'volt-table-row';
const cell = 'volt-table-cell';
const empty = 'volt-table-empty';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const tableClasses = { root, header, headerCell, body, row, cell, empty } as const;

export const tableStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /** The pointer is on the row; the harness writes it, happy-dom having none. */
  const HOVERED = `.${row}[data-hover], .${row}:hover`;
  const SELECTED = `.${row}[data-selected='true']`;

  return {
  name: 'table',
  classes: tableClasses,
  keyframes: [],

  rules: [
    {
      selector: `.${root}`,
      declarations: {
        width: '100%',
        'border-collapse': 'collapse',
        'font-family': 'var(--volt-font-family-sans)',
        'font-size': 'var(--volt-font-size-2)',
        'line-height': 'var(--volt-line-height-normal)',
        color: 'var(--volt-color-on-surface)',
        'background-color': 'var(--volt-color-surface)',
        'text-align': 'start',
      },
    },

    {
      selector: `.${header}`,
      declarations: {
        'background-color': 'var(--volt-color-surface-sunken)',
      },
    },
    {
      selector: `.${headerCell}`,
      declarations: {
        'padding-block-start': 'var(--volt-space-3)',
        'padding-block-end': 'var(--volt-space-3)',
        'padding-inline-start': 'var(--volt-space-4)',
        'padding-inline-end': 'var(--volt-space-4)',
        'font-weight': 'var(--volt-font-weight-semibold)',
        'text-align': 'start',
        'white-space': 'nowrap',
        color: 'var(--volt-color-on-surface)',
        'border-block-end-width': 'var(--volt-border-width-1)',
        'border-block-end-style': 'solid',
        'border-block-end-color': 'var(--volt-color-border-strong)',
      },
    },
    // A column of numbers is read down its last digit, so its heading has to
    // move with it.
    {
      selector: `.${headerCell}[data-align='end'], .${cell}[data-align='end']`,
      declarations: { 'text-align': 'end' },
    },
    {
      selector: `.${headerCell}[data-align='center'], .${cell}[data-align='center']`,
      declarations: { 'text-align': 'center' },
    },

    { selector: `.${body}`, declarations: { 'background-color': 'var(--volt-color-surface)' } },

    {
      selector: `.${row}`,
      declarations: {
        ...transition('background-color'),
      },
    },
    {
      selector: `.${cell}`,
      declarations: {
        'padding-block-start': 'var(--volt-space-3)',
        'padding-block-end': 'var(--volt-space-3)',
        'padding-inline-start': 'var(--volt-space-4)',
        'padding-inline-end': 'var(--volt-space-4)',
        'vertical-align': 'middle',
        'border-block-end-width': 'var(--volt-border-width-1)',
        'border-block-end-style': 'solid',
        'border-block-end-color': 'var(--volt-color-border)',
      },
    },

    // Emphasis, in the order the darker one has to win: striping first, then
    // the pointer, then the row that is actually selected.
    {
      selector: `.${root}[data-striped='true'] .${row}:nth-child(even)`,
      declarations: { 'background-color': 'var(--volt-color-surface-sunken)' },
    },
    { selector: HOVERED, declarations: { 'background-color': 'var(--volt-color-surface-hover)' } },
    {
      selector: SELECTED,
      declarations: {
        'background-color': 'var(--volt-color-accent-muted)',
        color: 'var(--volt-color-on-surface)',
      },
    },

    {
      selector: `.${empty}`,
      declarations: {
        'padding-block-start': 'var(--volt-space-8)',
        'padding-block-end': 'var(--volt-space-8)',
        'padding-inline-start': 'var(--volt-space-4)',
        'padding-inline-end': 'var(--volt-space-4)',
        'text-align': 'center',
        color: 'var(--volt-color-on-surface-muted)',
      },
    },
  ],

  forcedColors: [
    {
      selector: `.${root}`,
      declarations: { 'background-color': 'Canvas', color: 'CanvasText' },
    },
    {
      selector: `.${header}, .${body}`,
      declarations: { 'background-color': 'Canvas' },
    },
    {
      selector: `.${headerCell}`,
      declarations: { color: 'CanvasText', 'border-block-end-color': 'CanvasText' },
    },
    {
      selector: `.${cell}`,
      declarations: { 'border-block-end-color': 'CanvasText' },
    },
    // Striping and the pointer are emphasis, and are handed back: a forced
    // palette has two colours for a surface, and spending them on "this is the
    // second row" would leave none for the row that is selected.
    {
      selector: `.${root}[data-striped='true'] .${row}:nth-child(even)`,
      declarations: { 'background-color': 'Canvas' },
    },
    { selector: HOVERED, declarations: { 'background-color': 'Canvas' } },
    {
      selector: SELECTED,
      declarations: { 'background-color': 'Highlight', color: 'HighlightText' },
    },
    { selector: `.${empty}`, declarations: { color: 'GrayText' } },
  ],
  };
})();
