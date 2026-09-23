/**
 * Pagination — the styled half of `createPagination`.
 *
 * A row of controls: previous and next, the page numbers the primitive chose
 * to show, and an ellipsis where it left some out. Each control is a
 * `<button>` or an `<a href>`, and the two are drawn alike: the link loses its
 * underline and the button the border a browser gives it, because which one a
 * control is says where its page lives, not how it looks.
 *
 * Two things drawn here are information rather than emphasis, and both are
 * drawn in channels a forced palette keeps. The current page is the one the
 * list beneath is showing, and says so in `Highlight` as well as in a heavier
 * weight. A control at the end of the range is still there — the primitive
 * marks it `aria-disabled` rather than taking it out of the row, so the row
 * does not shift under the pointer — and says it goes nowhere in `GrayText`,
 * the palette's own word for unavailable.
 *
 * The status line is the live region that announces "Page 3 of 9" when the
 * page changes. It is kept in the page and out of sight: a region that
 * appears together with its message announces nothing.
 */

import type { ComponentStyles } from '../css.js';
import { disabledLook, focusRing, forcedFocusRing, transition } from './shared.js';

const root = 'volt-pagination';
const list = 'volt-pagination-list';
const item = 'volt-pagination-item';
const page = 'volt-pagination-page';
const control = 'volt-pagination-control';
const ellipsis = 'volt-pagination-ellipsis';
const status = 'volt-pagination-status';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const paginationClasses = {
  root,
  list,
  item,
  page,
  control,
  ellipsis,
  status,
} as const;

export const paginationStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /** Every control in the row, which share a shape whatever they do. */
  const BOX = `.${page}, .${control}`;
  const CURRENT = `.${page}[aria-current='page']`;
  const DISABLED = `.${control}[aria-disabled='true']`;
  /** The pointer is on it, and pressing it would go somewhere. */
  const HOVERED =
    `.${page}:not([aria-current='page']):hover, ` +
    `.${control}:not([aria-disabled='true']):hover`;
  const FOCUSED = `.${page}:focus-visible, .${control}:focus-visible`;

  const edges = (value: string) => ({
    'border-block-start-color': value,
    'border-block-end-color': value,
    'border-inline-start-color': value,
    'border-inline-end-color': value,
  });

  /** The square every control and the ellipsis sit in, so the row lines up. */
  const cell = {
    'box-sizing': 'border-box',
    display: 'inline-flex',
    'align-items': 'center',
    'justify-content': 'center',
    'min-inline-size': 'var(--volt-space-8)',
    'min-block-size': 'var(--volt-space-8)',
  };

  return {
    name: 'pagination',
    classes: paginationClasses,
    keyframes: [],

    rules: [
      {
        selector: `.${root}`,
        declarations: {
          display: 'block',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-tight)',
          color: 'var(--volt-color-on-surface)',
        },
      },

      {
        // A list for what it says to a screen reader — "list, 7 items" is how
        // many pages are in reach — and not for its bullets or its indent.
        selector: `.${list}`,
        declarations: {
          display: 'flex',
          'flex-wrap': 'wrap',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-1)',
          'row-gap': 'var(--volt-space-1)',
          'list-style-type': 'none',
          'margin-block-start': '0',
          'margin-block-end': '0',
          'margin-inline-start': '0',
          'margin-inline-end': '0',
          'padding-block-start': '0',
          'padding-block-end': '0',
          'padding-inline-start': '0',
          'padding-inline-end': '0',
        },
      },
      { selector: `.${item}`, declarations: { display: 'flex' } },

      {
        selector: BOX,
        declarations: {
          ...cell,
          'padding-block-start': '0',
          'padding-block-end': '0',
          'padding-inline-start': 'var(--volt-space-2)',
          'padding-inline-end': 'var(--volt-space-2)',
          'margin-block-start': '0',
          'margin-block-end': '0',
          'margin-inline-start': '0',
          'margin-inline-end': '0',
          // Every control keeps an edge, clear until it is the current page,
          // so that becoming current does not make the number a pixel wider
          // and shove the rest of the row along.
          'border-block-start-width': 'var(--volt-border-width-1)',
          'border-block-end-width': 'var(--volt-border-width-1)',
          'border-inline-start-width': 'var(--volt-border-width-1)',
          'border-inline-end-width': 'var(--volt-border-width-1)',
          'border-block-start-style': 'solid',
          'border-block-end-style': 'solid',
          'border-inline-start-style': 'solid',
          'border-inline-end-style': 'solid',
          ...edges('transparent'),
          'border-start-start-radius': 'var(--volt-radius-1)',
          'border-start-end-radius': 'var(--volt-radius-1)',
          'border-end-start-radius': 'var(--volt-radius-1)',
          'border-end-end-radius': 'var(--volt-radius-1)',
          'background-color': 'transparent',
          color: 'var(--volt-color-on-surface)',
          'font-family': 'inherit',
          'font-size': 'inherit',
          'font-weight': 'var(--volt-font-weight-medium)',
          'line-height': 'inherit',
          // Numbers of one width, so "11" and "17" take the same room and the
          // row does not twitch as the page moves through them.
          'font-variant-numeric': 'tabular-nums',
          'text-decoration-line': 'none',
          cursor: 'pointer',
          'user-select': 'none',
          ...transition('background-color, border-color, color'),
        },
      },
      {
        selector: HOVERED,
        declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
      },
      { selector: FOCUSED, declarations: { ...focusRing } },
      {
        selector: CURRENT,
        declarations: {
          'background-color': 'var(--volt-color-accent)',
          color: 'var(--volt-color-on-accent)',
          ...edges('var(--volt-color-accent)'),
          'font-weight': 'var(--volt-font-weight-semibold)',
          // Pressing it goes nowhere, and the pointer should not suggest it will.
          cursor: 'default',
        },
      },
      { selector: DISABLED, declarations: { ...disabledLook } },

      {
        selector: `.${ellipsis}`,
        declarations: {
          ...cell,
          color: 'var(--volt-color-on-surface-muted)',
          'user-select': 'none',
        },
      },

      {
        // Out of sight and still in the page, which is the only way a live
        // region is heard: one added together with its message says nothing.
        selector: `.${status}`,
        declarations: {
          position: 'absolute',
          'inline-size': '1px',
          'block-size': '1px',
          'margin-block-start': '-1px',
          'margin-block-end': '-1px',
          'margin-inline-start': '-1px',
          'margin-inline-end': '-1px',
          'padding-block-start': '0',
          'padding-block-end': '0',
          'padding-inline-start': '0',
          'padding-inline-end': '0',
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          'clip-path': 'inset(50%)',
          'white-space': 'nowrap',
          'border-block-start-width': '0',
          'border-block-end-width': '0',
          'border-inline-start-width': '0',
          'border-inline-end-width': '0',
        },
      },
    ],

    forcedColors: [
      { selector: `.${root}`, declarations: { color: 'CanvasText' } },
      {
        // The clear edge would come back as a line round every number, because
        // the palette paints `transparent` like any other colour. `Canvas` is
        // the colour it sits on, so the edge is there and cannot be seen.
        selector: BOX,
        declarations: { color: 'CanvasText', ...edges('Canvas') },
      },
      // The hover fill is emphasis, and is handed back; the underline is the
      // part of the feedback the palette has no way to take.
      {
        selector: HOVERED,
        declarations: { 'background-color': 'Canvas', 'text-decoration-line': 'underline' },
      },
      { selector: FOCUSED, declarations: { ...forcedFocusRing } },
      {
        // Where the reader is. The pair of colours the palette keeps for
        // exactly this, and an edge in the same colour, so the fill has a
        // boundary even against a `Highlight` that happens to be near `Canvas`.
        selector: CURRENT,
        declarations: {
          'background-color': 'Highlight',
          color: 'HighlightText',
          ...edges('Highlight'),
        },
      },
      {
        // Dimming on top of `GrayText` only muddies a palette chosen for its
        // contrast, so the opacity is handed back.
        selector: DISABLED,
        declarations: { color: 'GrayText', opacity: '1' },
      },
      { selector: `.${ellipsis}`, declarations: { color: 'CanvasText' } },
    ],
  };
})();
