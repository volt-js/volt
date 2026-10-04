/**
 * Rating — the styled half of `createRating`.
 *
 * A row of stars, each of which is one or two of the primitive's radios: one
 * when the rating counts in wholes, two side by side when it offers halves,
 * the half first and the whole after it. Both share the star's box, and each
 * clips one full-sized shape to its own width — the second's shape pulled
 * back by that width, so the part it keeps is the inline-end half. That is
 * what makes a half a half: nothing is drawn at half size, and a rating that
 * counts in wholes is the same rules with one radio per star.
 *
 * The shape is drawn in `currentColor`, stroked always and filled only while
 * the primitive marks its radio `data-filled`. So a chosen star and an empty
 * one differ in shape — solid against hollow — and not only in colour, which
 * is the difference a forced palette keeps: it repaints `currentColor` with
 * whatever it chose, and leaves `fill-opacity` alone. It also means a shape
 * of the consumer's own is drawn by these rules only if it leaves `fill` and
 * `stroke` to them; a path that sets its own is solid in both states.
 *
 * A star lit by the pointer and not by the score is the component's
 * `data-preview`, drawn lighter so that the score stays visible under it. The
 * primitive already marks the value the pointer is over as filled; which of
 * the filled stars are the score and which the preview is a comparison of
 * numbers, and a stylesheet cannot make one.
 *
 * Nothing styles the hidden radios that submit: the primitive hides them
 * inline, and the group is positioned only so that what it hides stays
 * inside the rating rather than wherever the nearest positioned box is.
 */

import type { ComponentStyles } from '../css.js';
import { disabledLook, focusRing, forcedFocusRing, transition } from './shared.js';

const root = 'volt-rating';
const star = 'volt-rating-star';
const item = 'volt-rating-item';
const icon = 'volt-rating-icon';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const ratingClasses = { root, star, item, icon } as const;

export const ratingStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const FILLED = `.${item}[data-filled]`;
  const PREVIEWED = `.${item}[data-preview]`;
  const DISABLED = `.${root}[data-disabled]`;
  /**
   * The whole beside its half. The radios are the only children a star has,
   * so the one after another is always the second of a pair, and a star that
   * counts in wholes has none.
   */
  const SECOND = `.${item} + .${item}`;

  return {
    name: 'rating',
    classes: ratingClasses,
    keyframes: [],

    rules: [
      {
        selector: `.${root}`,
        declarations: {
          position: 'relative',
          display: 'inline-flex',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-1)',
          'vertical-align': 'middle',
          // The empty star's colour, inherited by every radio until it is
          // filled. The control's edge colour rather than the text's, because
          // an empty star is a choice not yet made — the same thing an
          // unchecked box's border says.
          color: 'var(--volt-color-border-strong)',
        },
      },
      { selector: DISABLED, declarations: { ...disabledLook } },

      {
        selector: `.${star}`,
        declarations: {
          display: 'flex',
          'flex-shrink': '0',
          'inline-size': 'var(--volt-space-6)',
          'block-size': 'var(--volt-space-6)',
        },
      },

      {
        // The radio. One or two share the star's box equally — `flex-basis: 0`,
        // so that two split it rather than sizing themselves by a shape each
        // one clips anyway — and each is the clipping box for its shape, which
        // is what makes a half radio show half a star. Focus lands here, so
        // the ring is drawn here too: on the element's own edge, which its
        // overflow does not clip. Square, because a rounded corner where two
        // halves meet would clip the point of the star that sits there.
        selector: `.${item}`,
        declarations: {
          position: 'relative',
          display: 'block',
          'flex-grow': '1',
          'flex-shrink': '1',
          'flex-basis': '0',
          'min-inline-size': '0',
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          cursor: 'pointer',
        },
      },
      { selector: `.${item}:focus-visible`, declarations: { ...focusRing } },
      { selector: FILLED, declarations: { color: 'var(--volt-color-accent)' } },
      { selector: `.${item}[data-disabled]`, declarations: { cursor: 'not-allowed' } },
      {
        // Nothing to press: the score is a fact, and a pointer that turns
        // into a hand over one promises a change nobody can make.
        selector: `.${root}[data-readonly] .${item}`,
        declarations: { cursor: 'default' },
      },

      {
        // The shape, at the star's full size whatever the radio's width.
        // A flex box so that the shape inside it is laid out as a block, with
        // no line box around it to push it off the baseline.
        selector: `.${icon}`,
        declarations: {
          position: 'absolute',
          'inset-block-start': '0',
          'inset-inline-start': '0',
          display: 'flex',
          'inline-size': 'var(--volt-space-6)',
          'block-size': 'var(--volt-space-6)',
          'pointer-events': 'none',
          fill: 'currentColor',
          'fill-opacity': '0',
          stroke: 'currentColor',
          // In the shape's own units, so the edge of a path drawn on a 24-unit
          // grid scales with it rather than staying a hairline.
          'stroke-width': '1.5',
          'stroke-linejoin': 'round',
          ...transition('fill-opacity, color, opacity'),
        },
      },
      { selector: `${FILLED} .${icon}`, declarations: { 'fill-opacity': '1' } },
      {
        // Lit by the pointer, beyond the score: the whole shape lighter rather
        // than its fill alone, so that it reads as not yet chosen in any
        // palette — `opacity` is a channel the forced one leaves alone.
        selector: `${PREVIEWED} .${icon}`,
        declarations: { opacity: '0.5' },
      },
      {
        // Pulled back by the radio's own width, which is half the star, so the
        // half the radio does not clip away is the far one. Logical, so that
        // the fill runs with the writing direction rather than always to the
        // right.
        selector: `${SECOND} .${icon}`,
        declarations: { 'inset-inline-start': '-100%' },
      },
    ],

    forcedColors: [
      { selector: `.${root}`, declarations: { color: 'CanvasText' } },
      // The score is what has been chosen, and `Highlight` is the palette's
      // one word for that. Solid against hollow says it again, in shape.
      { selector: FILLED, declarations: { color: 'Highlight' } },
      // The palette has its own word for unavailable, and dimming on top of it
      // only muddies colours the reader chose for contrast. A filled star says
      // it too, or `Highlight` would make a disabled score look live.
      { selector: DISABLED, declarations: { color: 'GrayText', opacity: '1' } },
      { selector: `${DISABLED} ${FILLED}`, declarations: { color: 'GrayText' } },
      { selector: `.${item}:focus-visible`, declarations: { ...forcedFocusRing } },
    ],
  };
})();
