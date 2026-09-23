/**
 * Skeleton — the styled half of `createSkeleton`.
 *
 * The primitive writes `data-state` (`idle`, `delayed`, `visible`) on the
 * placeholder and on the container the content lands in, and `aria-hidden`
 * with `inert` on the placeholder. Nothing here selects on those last two: a
 * placeholder is drawn for the eye and hidden from the reader, and the two
 * facts do not have to agree in CSS.
 *
 * `delayed` is drawn, and that is the whole of what the delay buys. A wait too
 * short to show is one the placeholder sits out with `display: none`, so the
 * boxes take no room and there is no flash of them; the state is the sheet's
 * to draw rather than the markup's to leave out, because a placeholder that
 * only exists while it is visible makes two of the three states unreachable
 * and leaves `data-state` saying the same word forever.
 *
 * The shapes are a fill and nothing else in the ordinary palette, so a forced
 * one — which replaces every background with the user's own — would leave the
 * page blank where the layout was. `GrayText` is the palette's own word for
 * "not content yet", and is what they are given back.
 */

import type { ComponentStyles } from '../css.js';

const root = 'volt-skeleton';
const placeholder = 'volt-skeleton-placeholder';
const shape = 'volt-skeleton-shape';
const status = 'volt-skeleton-status';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const skeletonClasses = { root, placeholder, shape, status } as const;

export const skeletonStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /** Waiting out the delay: on the page, taking no room, showing nothing. */
  const DELAYED = `.${placeholder}[data-state='delayed']`;
  const SHOWN = `.${placeholder}[data-state='visible']`;

  return {
    name: 'skeleton',
    classes: skeletonClasses,

    keyframes: [
      {
        name: 'volt-skeleton-pulse',
        steps: [
          { offset: 'from', declarations: { opacity: '1' } },
          // Shallow on purpose. The pulse says "still working", and a deep one
          // reads as content appearing and being taken away again.
          { offset: 'to', declarations: { opacity: '0.6' } },
        ],
      },
    ],

    rules: [
      {
        // A `<div>` is already this. Stated because these class names are the
        // public part: a consumer writing the markup by hand puts the root on
        // whatever element their layout wanted, and the box has to be the same
        // one either way.
        selector: `.${root}`,
        declarations: { display: 'block' },
      },

      {
        selector: `.${placeholder}`,
        declarations: {
          display: 'flex',
          'flex-direction': 'column',
          'row-gap': 'var(--volt-space-2)',
          // A shape is as wide as it says it is. Stretched to the column, a
          // circle would come out an ellipse the moment it was given a
          // diameter and nothing else.
          'align-items': 'flex-start',
        },
      },
      { selector: DELAYED, declarations: { display: 'none' } },
      {
        // Alternating rather than restarting, which halves how often the
        // brightness turns around: the sheet has two durations and both are
        // short, and a pulse that began again every `medium` would flash near
        // the rate that WCAG 2.3.1 refuses. The duration is a token like every
        // other, so `prefers-reduced-motion` already stops it.
        selector: SHOWN,
        declarations: {
          'animation-name': 'volt-skeleton-pulse',
          'animation-duration': 'var(--volt-duration-slow)',
          'animation-timing-function': 'var(--volt-easing-standard)',
          'animation-iteration-count': 'infinite',
          'animation-direction': 'alternate',
        },
      },

      {
        // The default is a line of text, because that is what most of a
        // placeholder is and what the other two shapes are measured against.
        selector: `.${shape}`,
        declarations: {
          'box-sizing': 'border-box',
          'flex-shrink': '0',
          'inline-size': '100%',
          'block-size': 'var(--volt-space-3)',
          'border-radius': 'var(--volt-radius-1)',
          'background-color': 'var(--volt-color-surface-hover)',
        },
      },
      {
        selector: `.${shape}[data-shape='block']`,
        declarations: {
          'block-size': 'var(--volt-space-20)',
          'border-radius': 'var(--volt-radius-2)',
        },
      },
      {
        // Sized by its diameter alone: the ratio carries the other axis, so an
        // avatar is one number rather than two that have to be kept equal.
        selector: `.${shape}[data-shape='circle']`,
        declarations: {
          'inline-size': 'var(--volt-space-8)',
          'block-size': 'auto',
          'aspect-ratio': '1',
          'border-radius': 'var(--volt-radius-full)',
        },
      },
      {
        // The last line of a paragraph stops short, and a column of lines all
        // ending together reads as a table rather than as prose.
        selector: `.${shape}[data-shape='text'][data-trailing]`,
        declarations: { 'inline-size': '60%' },
      },

      {
        // The polite live region carrying "Loading…" and "Loaded". It is on
        // the page before there is anything to say — a region that arrives
        // holding its message announces nothing — so it has to be there and
        // not be seen, which is what this is.
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
      // The fill is the whole of what a shape is, and a forced palette takes
      // every fill the sheet chose. `GrayText` is what that palette calls
      // something there is nothing behind yet, and it is the one colour here
      // that must not be spent on anything else.
      { selector: `.${shape}`, declarations: { 'background-color': 'GrayText' } },
    ],
  };
})();
