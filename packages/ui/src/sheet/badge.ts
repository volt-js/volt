/**
 * Badge — the styled half of `createBadge`.
 *
 * Two elements. The badge is the count or the dot, and carries the name the
 * primitive gives it. The anchor is a box around the content the badge is
 * about, and exists only so the badge has a corner to sit on: it hugs what it
 * wraps, and draws nothing of its own.
 *
 * Whether the badge sits on that corner or in line depends on whether there
 * is anything to sit on, and the sheet can tell only one way: the badge is the
 * anchor's only element when nothing was written around it. That leaves bare
 * text as content the badge follows in line rather than sits over — the one
 * shape where a count after a word reads better anyway.
 *
 * The corner is reached with logical insets, because the corner is the top
 * inline-end one: the right in a left-to-right page and the left in a
 * right-to-left one. A translation would have been the obvious way to hang
 * the badge half outside its content, and it runs along the physical axis —
 * the repair for that is a rule selecting `[dir='rtl']`, which this sheet
 * cannot write. So the offset is an inset that already counts in half the
 * badge: its start edge sits half its own height inside the content's end
 * edge, which centres a one-digit badge on the corner and lets a wider one
 * grow outward, away from what it annotates.
 *
 * Tone is emphasis — the words the badge is named with say what it counts —
 * so a forced palette gets one look for all three. What it must not lose is
 * the badge itself, and a dot is the part at risk: it has no digits, so its
 * fill is all there is of it, and a fill is the first thing the palette takes.
 * The forced rules fill every badge with `CanvasText` and write the digits in
 * `Canvas`, so a dot stays a dot and a count stays the same family as one.
 */

import type { ComponentStyles } from '../css.js';

const root = 'volt-badge';
const anchor = 'volt-badge-anchor';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const badgeClasses = { root, anchor } as const;

export const badgeStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /**
   * A badge with content beside it in the anchor, which is the one that sits
   * on the corner. Scoped to the anchor so that a badge written by hand in the
   * middle of a paragraph is never taken for one with a corner to find.
   */
  const ANCHORED = `.${anchor} > .${root}:not(:only-child)`;
  const DOT = `.${root}[data-dot]`;
  const ANCHORED_DOT = `.${anchor} > .${root}[data-dot]:not(:only-child)`;
  const EMPTY = `.${root}[data-empty]`;
  const tone = (name: string) => `.${root}[data-tone='${name}']`;

  /** The badge's height, and the dot's, which is what the corner offsets are halves of. */
  const PILL = 'var(--volt-space-5)';
  const SPOT = 'var(--volt-space-2)';

  const edge = (colour: string) => ({
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  const radius = (token: string) => ({
    'border-start-start-radius': token,
    'border-start-end-radius': token,
    'border-end-start-radius': token,
    'border-end-end-radius': token,
  });

  /** Hung on the corner: the start edge half its own size inside the content's end edge. */
  const corner = (size: string) => ({
    position: 'absolute',
    'inset-block-start': `calc(${size} / -2)`,
    'inset-inline-start': `calc(100% - ${size} / 2)`,
  });

  return {
    name: 'badge',
    classes: badgeClasses,
    keyframes: [],

    rules: [
      {
        // Inline, and flex only so that it takes its content's baseline and
        // none of the line box an inline-block would leave under an image.
        selector: `.${anchor}`,
        declarations: { position: 'relative', display: 'inline-flex' },
      },

      {
        selector: `.${root}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'center',
          'flex-shrink': '0',
          'min-inline-size': PILL,
          'block-size': PILL,
          'padding-block-start': '0',
          'padding-block-end': '0',
          'padding-inline-start': 'var(--volt-space-1)',
          'padding-inline-end': 'var(--volt-space-1)',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-1)',
          'font-weight': 'var(--volt-font-weight-semibold)',
          'line-height': 'var(--volt-line-height-tight)',
          // A count going from 9 to 10 widens by one digit, not by however
          // much wider a 1 is than a 0 in the face the page happens to use.
          'font-variant-numeric': 'tabular-nums',
          'white-space': 'nowrap',
          // Danger is the default tone for a count, and the one a tone this
          // sheet does not know falls back to.
          color: 'var(--volt-color-on-danger)',
          'background-color': 'var(--volt-color-danger)',
          // A ring in the page's own colour, which is what parts the badge
          // from the content it overlaps on the corner.
          'border-block-start-width': 'var(--volt-border-width-1)',
          'border-block-end-width': 'var(--volt-border-width-1)',
          'border-inline-start-width': 'var(--volt-border-width-1)',
          'border-inline-end-width': 'var(--volt-border-width-1)',
          'border-block-start-style': 'solid',
          'border-block-end-style': 'solid',
          'border-inline-start-style': 'solid',
          'border-inline-end-style': 'solid',
          ...edge('var(--volt-color-surface)'),
          ...radius('var(--volt-radius-full)'),
        },
      },
      {
        // Kept on the page at zero rather than removed, so the id a control is
        // described by and whatever a caller wrote on the tag still have an
        // element to be on. The primitive marks it and hides it from a screen
        // reader; this takes it off the screen.
        selector: EMPTY,
        declarations: { display: 'none' },
      },

      {
        selector: tone('accent'),
        declarations: {
          color: 'var(--volt-color-on-accent)',
          'background-color': 'var(--volt-color-accent)',
        },
      },
      {
        // Quiet: a pale fill that would vanish into a white page without an
        // edge of its own, so the ring is drawn in the border colour instead
        // of the surface's.
        selector: tone('neutral'),
        declarations: {
          color: 'var(--volt-color-on-surface)',
          'background-color': 'var(--volt-color-surface-hover)',
          ...edge('var(--volt-color-border-strong)'),
        },
      },

      {
        // No digits, so nothing to pad and nothing to set: a disc.
        selector: DOT,
        declarations: {
          'min-inline-size': SPOT,
          'inline-size': SPOT,
          'block-size': SPOT,
          'padding-inline-start': '0',
          'padding-inline-end': '0',
        },
      },

      {
        // Presses on the corner belong to the control under it. The badge is
        // drawn over its edge, and would otherwise be a dead patch of the very
        // button it is counting for.
        selector: ANCHORED,
        declarations: { ...corner(PILL), 'pointer-events': 'none' },
      },
      { selector: ANCHORED_DOT, declarations: corner(SPOT) },
    ],

    forcedColors: [
      {
        // Filled in the palette's text colour, with a ring in its page colour:
        // the same picture as the ordinary palette's, in the two colours a
        // forced palette guarantees apart. A dot is this fill and nothing else.
        selector: `.${root}`,
        declarations: {
          color: 'Canvas',
          'background-color': 'CanvasText',
          ...edge('Canvas'),
        },
      },
      // Restated at the depth each tone was written at, since a rule naming the
      // tone outranks the one above and would otherwise leave its fill for the
      // palette to replace with whatever it guesses — `Canvas`, most often,
      // which is a dot the colour of the page it sits on.
      {
        selector: tone('accent'),
        declarations: { color: 'Canvas', 'background-color': 'CanvasText' },
      },
      {
        selector: tone('neutral'),
        declarations: { color: 'Canvas', 'background-color': 'CanvasText', ...edge('Canvas') },
      },
    ],
  };
})();
