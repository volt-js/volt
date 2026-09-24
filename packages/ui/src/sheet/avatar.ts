/**
 * Avatar — the styled half of `createAvatar`.
 *
 * A box with two things stacked in it: the picture, and the initials behind
 * it. The primitive writes `data-status` (`idle`, `loading`, `loaded`,
 * `error`) on the box, the `<img>` and the fallback, and the component writes
 * `data-size` and `data-shape` on the box.
 *
 * The `<img>` never leaves the page, because an image that is not in the
 * document is never fetched — so which of the two is seen is this sheet's
 * decision, drawn on the image's own status. It stays invisible until it has
 * loaded, with `opacity` rather than `display` or `visibility`: both of those
 * would take it out of the accessibility tree as well, and there is a moment
 * — a fallback held back by `fallbackDelay` — when the image is the one
 * element carrying the name. Invisible, it also keeps a broken picture's icon
 * and its alt text off the screen while the initials stand in for it.
 *
 * The fallback needs no state of its own. It is rendered only while it is the
 * thing to see, and is gone once the picture has loaded.
 *
 * The fill is the box's rather than the fallback's, so the space an avatar
 * takes is held in the same colour whether the initials are up yet or not. A
 * forced palette replaces that fill with the page's own, which would leave the
 * initials floating in no shape at all, so the box is given an edge there
 * instead.
 */

import type { ComponentStyles } from '../css.js';
import { transition } from './shared.js';

const root = 'volt-avatar';
const image = 'volt-avatar-image';
const fallback = 'volt-avatar-fallback';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const avatarClasses = { root, image, fallback } as const;

export const avatarStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const LOADED = `.${image}[data-status='loaded']`;

  const radius = (token: string) => ({
    'border-start-start-radius': token,
    'border-start-end-radius': token,
    'border-end-start-radius': token,
    'border-end-end-radius': token,
  });

  /** One length for both sides, so a size cannot come out as an oval. */
  const side = (token: string) => ({ 'inline-size': token, 'block-size': token });

  return {
    name: 'avatar',
    classes: avatarClasses,
    keyframes: [],

    rules: [
      {
        // The middle size and the circle are the box itself, so a hand-written
        // `<span class="volt-avatar">` with neither attribute is the default
        // avatar rather than an unsized one.
        selector: `.${root}`,
        declarations: {
          'box-sizing': 'border-box',
          position: 'relative',
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'center',
          'flex-shrink': '0',
          'vertical-align': 'middle',
          ...side('var(--volt-space-8)'),
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          ...radius('var(--volt-radius-full)'),
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'font-weight': 'var(--volt-font-weight-semibold)',
          // Two letters centred in a box, where any leading at all pushes them
          // off the middle.
          'line-height': '1',
          color: 'var(--volt-color-on-surface)',
          'background-color': 'var(--volt-color-accent-muted)',
          'user-select': 'none',
        },
      },
      {
        selector: `.${root}[data-size='sm']`,
        declarations: { ...side('var(--volt-space-6)'), 'font-size': 'var(--volt-font-size-1)' },
      },
      {
        selector: `.${root}[data-size='lg']`,
        declarations: { ...side('var(--volt-space-12)'), 'font-size': 'var(--volt-font-size-4)' },
      },
      {
        // A square is rounded, not sharp: a hard corner beside the circles and
        // pills everywhere else in the sheet reads as a broken image.
        selector: `.${root}[data-shape='square']`,
        declarations: { ...radius('var(--volt-radius-2)') },
      },

      {
        // Laid over the fallback rather than beside it, so the swap from one
        // to the other moves nothing on the page. The box's own overflow and
        // radius cut it to the shape.
        selector: `.${image}`,
        declarations: {
          'box-sizing': 'border-box',
          position: 'absolute',
          'inset-block-start': '0',
          'inset-inline-start': '0',
          ...side('100%'),
          'object-fit': 'cover',
          opacity: '0',
          ...transition('opacity'),
        },
      },
      { selector: LOADED, declarations: { opacity: '1' } },

      {
        selector: `.${fallback}`,
        declarations: {
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'center',
          ...side('100%'),
          'white-space': 'nowrap',
          // The primitive leaves the case as it was written, because upper-
          // casing needs a language to be right — a Turkish "i" is "İ" — and
          // `text-transform` has one: the element's own `lang`.
          'text-transform': 'uppercase',
        },
      },
    ],

    forcedColors: [
      {
        // The fill goes, and a box with no fill and no edge is no shape: the
        // initials would stand alone, and a row of avatars would be a row of
        // letters. The edge is what says where one picture ends.
        selector: `.${root}`,
        declarations: {
          color: 'CanvasText',
          'background-color': 'Canvas',
          'border-block-start-width': 'var(--volt-border-width-1)',
          'border-block-end-width': 'var(--volt-border-width-1)',
          'border-inline-start-width': 'var(--volt-border-width-1)',
          'border-inline-end-width': 'var(--volt-border-width-1)',
          'border-block-start-style': 'solid',
          'border-block-end-style': 'solid',
          'border-inline-start-style': 'solid',
          'border-inline-end-style': 'solid',
          'border-block-start-color': 'CanvasText',
          'border-block-end-color': 'CanvasText',
          'border-inline-start-color': 'CanvasText',
          'border-inline-end-color': 'CanvasText',
        },
      },
      { selector: `.${fallback}`, declarations: { color: 'CanvasText' } },
    ],
  };
})();
