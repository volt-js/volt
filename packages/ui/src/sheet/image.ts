/**
 * Image — the styled half of `createImage`.
 *
 * A box with the picture in it, and two things that stand in the box while
 * the picture is not there: a placeholder while it loads, and a message when
 * it does not. The primitive writes `data-status` (`idle`, `loading`,
 * `loaded`, `error`) on the box and the `<img>`, `aspect-ratio` on the box,
 * inline, when it knows the shape, and `width` and `height` on the `<img>`
 * when it knows the size; the component writes `data-fit` on the `<img>`.
 *
 * The box takes its width from the picture's `width` attribute when there is
 * one — the picture's own width, no wider than its container, which is what
 * an `<img>` is — and from its container when there is not, since a shape
 * with no width of its own has no other width to hold before the bytes
 * arrive. Its height is the primitive's `aspect-ratio` either way, and the
 * picture fills it, cropped or letterboxed by `data-fit`. The box's overflow
 * is what makes the ratio binding: a box that let its content show would
 * grow to the picture's own height instead.
 *
 * The picture is seen while it loads rather than kept out of sight until the
 * `load` event, and the placeholder is laid beneath it. A loading picture
 * paints nothing until its bytes arrive, so the placeholder shows through
 * until they do, and then the picture covers it as it decodes. Hiding it
 * until a script has heard the event would hold the largest thing on a page
 * back until hydration — a browser does not count a picture it cannot see as
 * painted — and a page whose script never runs would show placeholders for
 * good. A picture swapped for another keeps the old one on screen until the
 * new one is there, which is what a browser does with an `<img>` and what a
 * gallery wants.
 *
 * It is hidden when there is nothing to show: no source, or a load that
 * failed, where a browser would draw a broken-picture icon and the `alt`
 * text in its place. With `opacity`, rather than `display` or `visibility`:
 * both of those would take it out of the accessibility tree as well, and its
 * `alt` is what a reader has of a picture that did not arrive. It is folded to
 * no height as well, keeping its width, so that what is left of the box's
 * height is the ratio's or the message's and never a broken icon's.
 *
 * The message is in the flow beneath that folded picture rather than laid
 * over the box like the placeholder. A failure is the last state a box is
 * left in, and a box with no ratio — no size given, or only one side of it —
 * has no height to lay anything over: the words would be cut off by the
 * overflow that holds the ratio, for good. In the flow they fill a box that
 * has a height and give one to a box that does not.
 *
 * The fill is the box's, and only until the picture is in it, so the space a
 * picture will take is held in a colour before anything is there and a
 * picture with transparency sits on the page rather than on a grey card once
 * it is. It is the skeleton's colour, which is neither of the two a page is
 * painted in: a box filled `surface-sunken` on a page of the same — the
 * documentation's own frame is one — held its space in a colour nobody could
 * see, and its message floated. A forced palette replaces that fill with the
 * page's own, which would
 * leave the message floating in no shape at all and a page waiting on its
 * pictures showing nothing where they will be, so the box is outlined there
 * instead, on the same terms. An outline rather than a border, because a
 * border would change the box's size as it came and went.
 */

import type { ComponentStyles } from '../css.js';

const root = 'volt-image';
const picture = 'volt-image-picture';
const placeholder = 'volt-image-placeholder';
const error = 'volt-image-error';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const imageClasses = { root, picture, placeholder, error } as const;

export const imageStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /** The box before its picture is in it: loading, failed, or given nothing to load. */
  const HOLDING = `.${root}:not([data-status='loaded'])`;
  /** A box whose picture has no width of its own to give it. */
  const UNSIZED = `.${root}:not(:has(> .${picture}[width]))`;

  return {
    name: 'image',
    classes: imageClasses,
    keyframes: [],

    rules: [
      {
        selector: `.${root}`,
        declarations: {
          'box-sizing': 'border-box',
          position: 'relative',
          // A stacking context of its own, so the placeholder can go beneath
          // the picture without going beneath the page.
          isolation: 'isolate',
          // Shrink-to-fit, capped: the picture's own width, as an `<img>` has
          // it, and its cell's in a grid or a flex column, where every child
          // is stretched whatever its display.
          display: 'inline-block',
          'max-inline-size': '100%',
          'vertical-align': 'middle',
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-normal)',
          color: 'var(--volt-color-on-surface-muted)',
        },
      },
      {
        // Before its bytes, a picture with no `width` is no width at all, and
        // a box shrunk to fit it would be nothing until they arrived.
        selector: UNSIZED,
        declarations: { 'inline-size': '100%' },
      },
      {
        selector: HOLDING,
        declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
      },

      {
        // No `inline-size` of its own, so the `width` attribute is what sizes
        // the box around it; the two limits then hold it to the box, whichever
        // of the two is wider. Its height is the box's, which is the ratio's —
        // or, with no ratio known, its own natural height at that width.
        selector: `.${picture}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'block',
          'min-inline-size': '100%',
          'max-inline-size': '100%',
          'block-size': '100%',
          'object-fit': 'cover',
        },
      },
      { selector: `.${picture}[data-fit='contain']`, declarations: { 'object-fit': 'contain' } },
      {
        selector: `.${picture}[data-status='idle'], .${picture}[data-status='error']`,
        declarations: { opacity: '0', 'block-size': '0' },
      },

      {
        // Beneath the picture, so the picture covers it as its bytes arrive. A
        // grid of one cell, so a shape written for the slot is stretched to
        // the box both ways when it has no size of its own.
        selector: `.${placeholder}`,
        declarations: {
          'box-sizing': 'border-box',
          position: 'absolute',
          'inset-block-start': '0',
          'inset-inline-start': '0',
          'z-index': '-1',
          'inline-size': '100%',
          'block-size': '100%',
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          display: 'grid',
          'align-items': 'stretch',
          'justify-items': 'stretch',
        },
      },

      {
        // The whole of a box that has a height, centred in it; its own height
        // in a box that has none. Contained, so the words are no width of
        // their own: a box sized by its picture's `width` stays that wide when
        // the picture fails, rather than growing to fit a sentence on the one
        // occasion nothing is there to see.
        selector: `.${error}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          'inline-size': '100%',
          'block-size': '100%',
          contain: 'inline-size',
          'padding-block-start': 'var(--volt-space-2)',
          'padding-block-end': 'var(--volt-space-2)',
          'padding-inline-start': 'var(--volt-space-3)',
          'padding-inline-end': 'var(--volt-space-3)',
          'text-align': 'center',
          color: 'var(--volt-color-on-surface-muted)',
        },
      },
    ],

    forcedColors: [
      { selector: `.${root}`, declarations: { color: 'CanvasText' } },
      {
        // The fill goes, and a box with no fill and no edge is no shape. The
        // outline says where a picture goes, and comes off once the picture is
        // there to say so itself: a line round every photograph is not what
        // the palette asked for. Drawn inside the box, so a container that
        // clips its overflow, or a neighbour flush against it, cannot hide it.
        selector: HOLDING,
        declarations: {
          'background-color': 'Canvas',
          'outline-width': 'var(--volt-border-width-1)',
          'outline-style': 'solid',
          'outline-color': 'CanvasText',
          'outline-offset': 'calc(-1 * var(--volt-border-width-1))',
        },
      },
      { selector: `.${error}`, declarations: { color: 'CanvasText' } },
    ],
  };
})();
