/**
 * Relative time — the styled half of `createRelativeTime`.
 *
 * A `<time>` in a line of text, and almost nothing to draw: the words are set
 * in the face and the colour of the line they sit in. The primitive writes
 * `datetime`, `data-unit` and — while there is a date — a `title` holding the
 * exact moment, which `<v-relative-time>` keeps unless it would repeat the
 * text on screen, or the caller wrote a `title` of their own or asked for none
 * — which it writes as `title=""`.
 *
 * The one thing drawn is that `title`. A tooltip is invisible until it is
 * hovered, and a reader who does not know it is there never hovers, so a
 * stamp with one is underlined with dots — the platform's own mark for
 * `<abbr title>`, the other element whose meaning is a hover away, and drawn
 * the way the platform draws it, in the colour of the words. That makes it
 * right in a muted line of metadata and in a link alike, where a colour of its
 * own would be a stray grey mark under accent text. The underline is
 * information rather than emphasis, and it is a line, which a forced palette
 * keeps.
 *
 * Nothing here says how far away the moment is, and nothing points the
 * cursor at the tooltip: a stamp is very often the link to what it dates, and
 * a `help` cursor there would say it is not one.
 */

import type { ComponentStyles } from '../css.js';

const root = 'volt-relative-time';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const relativeTimeClasses = { root } as const;

export const relativeTimeStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /**
   * A stamp with something behind it to hover for, which a reader has to be
   * told. Not an empty `title`, which is how the component writes a caller's
   * request for none — written rather than left off, so that a titled link
   * around the stamp does not lend it a tooltip — and which shows nothing.
   */
  const TITLED = `.${root}[title]:not([title=''])`;

  return {
    name: 'relative-time',
    classes: relativeTimeClasses,
    keyframes: [],

    rules: [
      {
        // Dotted rather than solid, which is a link. Set a little below the
        // baseline, in `em` so that it keeps its distance at whatever size the
        // line around the stamp is: at the baseline itself the dots run into
        // the letters and read as part of them.
        selector: TITLED,
        declarations: {
          'text-decoration-line': 'underline',
          'text-decoration-style': 'dotted',
          'text-decoration-color': 'currentColor',
          'text-underline-offset': '0.2em',
        },
      },
    ],

    forcedColors: [
      {
        // The line is what says there is a tooltip, and the palette keeps a
        // line. Its colour stays the words', which here are the palette's own
        // — `LinkText` in a link, `CanvasText` anywhere else — rather than a
        // system colour named here, which would be right in only one of the
        // two.
        selector: TITLED,
        declarations: { 'text-decoration-color': 'currentColor' },
      },
    ],
  };
})();
