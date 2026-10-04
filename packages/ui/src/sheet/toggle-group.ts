/**
 * Toggle group — the styled half of `createToggleGroup`, and of `createToggle`.
 *
 * A toggle is a button that stays down, and a group of them is a segmented
 * row: the buttons share their edges, and only the two ends are rounded. One
 * class draws both, because a toggle on its own is the same button with all
 * four corners back. Every side and corner here is a logical one — the shared
 * edge is an inline-start margin, the rounded ends are the inline-start and
 * inline-end corners — so a page written right to left gets the row mirrored
 * without a rule saying so.
 *
 * Which toggles are down is information, not emphasis, and the primitive
 * writes it as `data-state`, `on` or `off`, whichever role the group took. It
 * is said in a fill, in the colour of the edge round it, and in the weight of
 * the words. A forced palette flattens the first two, so there the fill
 * becomes `Highlight` with `HighlightText` on it — the pair the palette keeps
 * for exactly this — and the weight stays, which is a channel no palette has.
 * That toggle is taken out from under the palette as well, or the browser's
 * backplate behind its words would be the colour of the words.
 * The fill is the full accent rather than its muted tint: the tint stands
 * barely apart from the surface of a toggle that is up, and the accent's
 * words would sit on it below the contrast body text needs.
 *
 * Neighbouring segments overlap by one border, so whichever is drawn later
 * owns the line between them. A toggle that is down, or has focus, is raised
 * over its neighbours so that its whole edge shows; the row is a stacking
 * context of its own, so that raising one never lifts it over the page.
 *
 * `data-orientation` is on the group and `data-disabled` on the group and on
 * every toggle in it, which is what the rules select on. Nothing here reads
 * ARIA, which is there to be spoken rather than styled against.
 */

import type { ComponentStyles, Declarations } from '../css.js';
import { disabledLook, focusRing, forcedFocusRing, transition } from './shared.js';

const root = 'volt-toggle-group';
const toggle = 'volt-toggle';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const toggleGroupClasses = { root, toggle } as const;

export const toggleGroupStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const PRESSED = `.${toggle}[data-state='on']`;
  /** Under the pointer, and pressing it would put it down. */
  const HOVERED_UP = `.${toggle}[data-state='off']:not([data-disabled]):hover`;
  /** Under the pointer, and pressing it would let it up. */
  const HOVERED_DOWN = `${PRESSED}:not([data-disabled]):hover`;
  const ROW = `.${root}[data-orientation='horizontal']`;
  const COLUMN = `.${root}[data-orientation='vertical']`;

  /** One border's width back, so two neighbours draw one line between them. */
  const shared = 'calc(var(--volt-border-width-1) * -1)';
  const round = 'var(--volt-radius-1)';

  const edges = (colour: string): Declarations => ({
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  return {
    name: 'toggle-group',
    classes: toggleGroupClasses,
    keyframes: [],

    rules: [
      {
        selector: `.${root}`,
        declarations: {
          display: 'inline-flex',
          'flex-direction': 'row',
          // Every segment as tall as the tallest, so the shared edges meet.
          'align-items': 'stretch',
          'vertical-align': 'middle',
          isolation: 'isolate',
        },
      },
      { selector: COLUMN, declarations: { 'flex-direction': 'column' } },

      {
        selector: `.${toggle}`,
        declarations: {
          'box-sizing': 'border-box',
          // So `z-index` applies, which is how a segment's edge is lifted over
          // the neighbour that overlaps it.
          position: 'relative',
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'center',
          'column-gap': 'var(--volt-space-2)',
          // Wide enough for one glyph to sit in the middle of, which is what
          // most of these hold.
          'min-inline-size': 'var(--volt-space-8)',
          // A browser's own margin on a `<button>` would open a gap the
          // shared edge is meant to close.
          'margin-block-start': '0',
          'margin-block-end': '0',
          'margin-inline-start': '0',
          'margin-inline-end': '0',
          'padding-block-start': 'var(--volt-space-2)',
          'padding-block-end': 'var(--volt-space-2)',
          'padding-inline-start': 'var(--volt-space-3)',
          'padding-inline-end': 'var(--volt-space-3)',
          'border-block-start-width': 'var(--volt-border-width-1)',
          'border-block-end-width': 'var(--volt-border-width-1)',
          'border-inline-start-width': 'var(--volt-border-width-1)',
          'border-inline-end-width': 'var(--volt-border-width-1)',
          'border-block-start-style': 'solid',
          'border-block-end-style': 'solid',
          'border-inline-start-style': 'solid',
          'border-inline-end-style': 'solid',
          ...edges('var(--volt-color-border-strong)'),
          'border-start-start-radius': round,
          'border-start-end-radius': round,
          'border-end-start-radius': round,
          'border-end-end-radius': round,
          'background-color': 'var(--volt-color-surface)',
          color: 'var(--volt-color-on-surface)',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'font-weight': 'var(--volt-font-weight-regular)',
          'line-height': 'var(--volt-line-height-tight)',
          cursor: 'pointer',
          'user-select': 'none',
          ...transition('background-color, border-color, color'),
        },
      },
      {
        selector: HOVERED_UP,
        declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
      },
      {
        selector: PRESSED,
        declarations: {
          'background-color': 'var(--volt-color-accent)',
          ...edges('var(--volt-color-accent)'),
          color: 'var(--volt-color-on-accent)',
          'font-weight': 'var(--volt-font-weight-semibold)',
          'z-index': '1',
        },
      },
      {
        selector: HOVERED_DOWN,
        declarations: {
          'background-color': 'var(--volt-color-accent-hover)',
          ...edges('var(--volt-color-accent-hover)'),
        },
      },
      {
        // After the pressed rule, and above it: two toggles down side by side
        // are both raised, and the ring of the first would otherwise be drawn
        // beneath the second.
        selector: `.${toggle}:focus-visible`,
        declarations: { ...focusRing, 'z-index': '2' },
      },
      // Dimmed whether it is up or down: a toggle that is down and unavailable
      // still says which it is, in the fill and the weight beneath the dimming.
      { selector: `.${toggle}[data-disabled]`, declarations: { ...disabledLook } },

      // A segment: no corners of its own, and no room between it and the
      // next. The ends take their corners back below, two at a time, so a
      // group holding a single toggle — first and last at once — keeps all
      // four. A child of the row rather than anything inside it, because the
      // ends are counted among the row's children: a toggle wrapped in
      // something else is drawn whole, as it is on its own, rather than as a
      // segment with no neighbours.
      {
        selector: `.${root} > .${toggle}`,
        declarations: {
          'border-start-start-radius': '0',
          'border-start-end-radius': '0',
          'border-end-start-radius': '0',
          'border-end-end-radius': '0',
          'flex-shrink': '0',
        },
      },
      {
        selector: `${ROW} > .${toggle}:not(:first-child)`,
        declarations: { 'margin-inline-start': shared },
      },
      {
        selector: `${ROW} > .${toggle}:first-child`,
        declarations: { 'border-start-start-radius': round, 'border-end-start-radius': round },
      },
      {
        selector: `${ROW} > .${toggle}:last-child`,
        declarations: { 'border-start-end-radius': round, 'border-end-end-radius': round },
      },
      {
        selector: `${COLUMN} > .${toggle}:not(:first-child)`,
        declarations: { 'margin-block-start': shared },
      },
      {
        selector: `${COLUMN} > .${toggle}:first-child`,
        declarations: { 'border-start-start-radius': round, 'border-start-end-radius': round },
      },
      {
        selector: `${COLUMN} > .${toggle}:last-child`,
        declarations: { 'border-end-start-radius': round, 'border-end-end-radius': round },
      },
    ],

    forcedColors: [
      {
        selector: `.${toggle}`,
        declarations: {
          'background-color': 'ButtonFace',
          ...edges('ButtonBorder'),
          color: 'ButtonText',
        },
      },
      // The hover rules above outrank everything at the base of this block,
      // so each is restated: left alone, the palette would pick the hover
      // fill itself, and a toggle that is down would lose `Highlight` the
      // moment the pointer reached it. The underline is the part of the
      // feedback the palette has room for, as it is on a button.
      {
        selector: HOVERED_UP,
        declarations: { 'background-color': 'ButtonFace', 'text-decoration-line': 'underline' },
      },
      {
        selector: PRESSED,
        declarations: {
          'background-color': 'Highlight',
          ...edges('Highlight'),
          color: 'HighlightText',
          // Left under the palette, Chrome paints a backplate of `Canvas`
          // behind every run of text so that words stay legible over a
          // picture — and `HighlightText` is that same colour, in the dark
          // scheme and the light: the toggle would say that it is down and no
          // longer what it is. Out from under the palette, the fill, the edge
          // and the words are the three named here, every one of them the
          // palette's own, and whatever is inside — an icon drawn in
          // `currentColor` — inherits the words' colour rather than the
          // page's.
          'forced-color-adjust': 'none',
        },
      },
      {
        selector: HOVERED_DOWN,
        declarations: {
          'background-color': 'Highlight',
          ...edges('Highlight'),
          color: 'HighlightText',
          'text-decoration-line': 'underline',
        },
      },
      { selector: `.${toggle}:focus-visible`, declarations: { ...forcedFocusRing } },
      // Unavailable is `GrayText`, and the dimming is handed back. The edge is
      // left as it was: half of it belongs to a neighbour drawn over it, and
      // an edge grey on one side and not the other reads as a mistake.
      {
        selector: `.${toggle}[data-disabled]`,
        declarations: { color: 'GrayText', opacity: '1' },
      },
      // Down and unavailable at once: `GrayText` on `Highlight` is a pairing
      // the palette makes no promise about, so the fill is handed back and the
      // edge turns grey instead. A toggle that is down is raised, so all four
      // sides of that edge show, and the weight is still the toggle's own.
      {
        selector: `${PRESSED}[data-disabled]`,
        declarations: {
          'background-color': 'ButtonFace',
          ...edges('GrayText'),
        },
      },
    ],
  };
})();
