/**
 * Breadcrumb — the styled half of `createBreadcrumb`.
 *
 * A row of links with the page the reader is on at the end of it. The sheet
 * draws three kinds of crumb, told apart by what the markup already says
 * rather than by a class per kind: one with an `href` is a link, the one with
 * `aria-current='page'` is where the reader is, and one with neither is a
 * section with no page of its own, which reads as text.
 *
 * The one of those that is information is the current page. It is drawn in
 * weight as well as in colour, and in `CanvasText` against the links'
 * `LinkText` when the palette is forced, so "you are here" does not rest on a
 * colour the user's palette replaces.
 *
 * The weight is semibold, not medium. Forced, weight is all that tells the
 * page from a crumb with no page of its own, and in the menu from every other
 * item — and the font stack starts at `system-ui`, which is Segoe UI on
 * Windows, where forced colours live, and Noto Sans on a common Linux. Neither
 * carries a 500, and a face without the weight asked for draws the 400 beside
 * it: a medium page is drawn as a regular one there. Both carry a 600.
 *
 * Nothing here gives a crumb a `display`. The primitive puts crumbs that do
 * not fit away with `hidden`, and any `display` a rule wrote would beat it and
 * show them all again — so a crumb is a flex item that keeps the `display` it
 * was born with, and its link and separator sit inside it as ordinary text.
 *
 * The overflow menu is drawn with the menu's own classes, because it is the
 * menu: `createBreadcrumb` builds it with `createMenu`, and the same primitive
 * gets the same look. What is added here is for a menu item that is a link,
 * which a browser underlines; for the one that is the current page, which a
 * trail keeping nothing at its end folds into the menu with the rest; and for
 * a section, which the menu would otherwise draw as one more link. Forced,
 * the menu draws the item under the pointer in one pair whatever it is, so
 * there a link takes back its underline and a section does not.
 */

import type { ComponentStyles } from '../css.js';
import { focusRing, forcedFocusRing, transition } from './shared.js';

const root = 'volt-breadcrumb';
const list = 'volt-breadcrumb-list';
const item = 'volt-breadcrumb-item';
const link = 'volt-breadcrumb-link';
const separator = 'volt-breadcrumb-separator';
const trigger = 'volt-breadcrumb-trigger';
const menuLink = 'volt-breadcrumb-menu-link';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const breadcrumbClasses = {
  root,
  list,
  item,
  link,
  separator,
  trigger,
  menuLink,
} as const;

export const breadcrumbStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /** A crumb that goes somewhere; the current page has no `href` to follow. */
  const LINK = `.${link}[href]`;
  const CURRENT = `.${link}[aria-current='page']`;
  const OPEN = `.${trigger}[aria-expanded='true']`;
  const MENU_CURRENT = `.${menuLink}[aria-current='page']`;
  /** A section with no page of its own, folded into the menu. */
  const MENU_SECTION = `.${menuLink}:not([href]):not([aria-current])`;

  const radius = (token: string) => ({
    'border-start-start-radius': token,
    'border-start-end-radius': token,
    'border-end-start-radius': token,
    'border-end-end-radius': token,
  });

  return {
    name: 'breadcrumb',
    classes: breadcrumbClasses,
    keyframes: [],

    rules: [
      {
        selector: `.${root}`,
        declarations: {
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-normal)',
          color: 'var(--volt-color-on-surface)',
        },
      },

      {
        // One row that never wraps. The primitive measures what the trail
        // wants against what this list has to give, and a list that wrapped
        // would always have enough; a crumb that shrank would lie about its
        // width the same way, which is why neither is allowed below.
        selector: `.${list}`,
        declarations: {
          display: 'flex',
          'flex-wrap': 'nowrap',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-2)',
          'min-inline-size': '0',
          'margin-block-start': '0',
          'margin-block-end': '0',
          'margin-inline-start': '0',
          'margin-inline-end': '0',
          'padding-block-start': '0',
          'padding-block-end': '0',
          'padding-inline-start': '0',
          'padding-inline-end': '0',
          // The list keeps its role — the primitive writes `role="list"`,
          // which is what a screen reader counts the crumbs from — and loses
          // only the numbers.
          'list-style-type': 'none',
        },
      },

      {
        selector: `.${item}`,
        declarations: {
          'flex-shrink': '0',
          'white-space': 'nowrap',
        },
      },

      {
        selector: `.${link}`,
        declarations: {
          color: 'var(--volt-color-on-surface-muted)',
          'text-decoration-line': 'none',
          'text-underline-offset': '0.2em',
          // For the focus ring, which follows the corners of what it rings.
          ...radius('var(--volt-radius-1)'),
          ...transition('color'),
        },
      },
      { selector: LINK, declarations: { color: 'var(--volt-color-accent)' } },
      {
        // An underline rather than a colour alone, so the pointer's place
        // survives a palette that flattens the two blues into one.
        selector: `${LINK}:hover`,
        declarations: {
          color: 'var(--volt-color-accent-hover)',
          'text-decoration-line': 'underline',
        },
      },
      { selector: `.${link}:focus-visible`, declarations: { ...focusRing } },
      {
        selector: CURRENT,
        declarations: {
          color: 'var(--volt-color-on-surface)',
          'font-weight': 'var(--volt-font-weight-semibold)',
        },
      },

      {
        selector: `.${separator}`,
        declarations: {
          'margin-inline-start': 'var(--volt-space-2)',
          color: 'var(--volt-color-on-surface-muted)',
          'user-select': 'none',
        },
      },

      {
        // The button standing for the crumbs that did not fit. It sits in the
        // line of text as a crumb would, so it takes the trail's type rather
        // than a control's, and has no edge of its own until it is pointed at.
        selector: `.${trigger}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'center',
          'min-inline-size': 'var(--volt-space-6)',
          'margin-block-start': '0',
          'margin-block-end': '0',
          'margin-inline-start': '0',
          'margin-inline-end': '0',
          'padding-block-start': '0',
          'padding-block-end': '0',
          'padding-inline-start': 'var(--volt-space-1)',
          'padding-inline-end': 'var(--volt-space-1)',
          'font-family': 'inherit',
          'font-size': 'inherit',
          'line-height': 'inherit',
          color: 'var(--volt-color-on-surface-muted)',
          'background-color': 'transparent',
          // A `<button>` arrives with a border of the browser's own.
          'border-block-start-width': '0',
          'border-block-end-width': '0',
          'border-inline-start-width': '0',
          'border-inline-end-width': '0',
          ...radius('var(--volt-radius-1)'),
          cursor: 'default',
          ...transition('background-color, color'),
        },
      },
      {
        selector: `.${trigger}:hover`,
        declarations: {
          color: 'var(--volt-color-on-surface)',
          'background-color': 'var(--volt-color-surface-hover)',
        },
      },
      {
        // Open is a state of the button as well as of the menu, which covers
        // the page beneath it and may well cover the button's neighbours.
        selector: OPEN,
        declarations: {
          color: 'var(--volt-color-on-surface)',
          'background-color': 'var(--volt-color-surface-hover)',
        },
      },
      { selector: `.${trigger}:focus-visible`, declarations: { ...focusRing } },

      { selector: `.${menuLink}`, declarations: { 'text-decoration-line': 'none' } },
      {
        // The page itself, in a trail that keeps nothing at its end and has
        // folded it away: still where the reader is, in the weight it has in
        // the trail, which a forced palette leaves alone.
        selector: MENU_CURRENT,
        declarations: { 'font-weight': 'var(--volt-font-weight-semibold)' },
      },
      {
        // Muted as it is in the trail. Every item beside it in the menu is a
        // link in the menu's own colour, and a section drawn in that colour
        // promises a page that is not there.
        selector: MENU_SECTION,
        declarations: { color: 'var(--volt-color-on-surface-muted)' },
      },
    ],

    forcedColors: [
      { selector: `.${root}`, declarations: { color: 'CanvasText' } },
      { selector: `.${link}`, declarations: { color: 'CanvasText' } },
      // Said outright, and again under the pointer, whose rule is more specific
      // than this one and would otherwise keep a brand colour the palette
      // replaces with whatever it guesses.
      { selector: LINK, declarations: { color: 'LinkText' } },
      { selector: `${LINK}:hover`, declarations: { color: 'LinkText' } },
      { selector: `.${link}:focus-visible`, declarations: { ...forcedFocusRing } },
      // The page the reader is on: the palette's text colour against the
      // links' own, and the weight from the rule above, which it keeps.
      { selector: CURRENT, declarations: { color: 'CanvasText' } },
      { selector: `.${separator}`, declarations: { color: 'CanvasText' } },
      {
        selector: `.${trigger}`,
        declarations: { color: 'ButtonText', 'background-color': 'ButtonFace' },
      },
      // The button under the pointer and the button whose menu is open, in the
      // pair the palette keeps for exactly this.
      {
        selector: `.${trigger}:hover`,
        declarations: { color: 'HighlightText', 'background-color': 'Highlight' },
      },
      { selector: OPEN, declarations: { color: 'HighlightText', 'background-color': 'Highlight' } },
      { selector: `.${trigger}:focus-visible`, declarations: { ...forcedFocusRing } },
      // The menu draws every item in the palette's text, and the muted colour
      // above is gone, so grey is what is left to say this one leads nowhere.
      // The menu's own pointer rule is more specific, and still answers it.
      { selector: MENU_SECTION, declarations: { color: 'GrayText' } },
      // That rule gives every item under the pointer the same pair, which
      // takes the grey away just as a section is about to be pressed. A link
      // is underlined there instead, as the trail underlines one, so the
      // section is still the item that is not.
      { selector: `.${menuLink}[href]:hover`, declarations: { 'text-decoration-line': 'underline' } },
    ],
  };
})();
