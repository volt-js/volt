/**
 * Keyboard shortcut — the styled half of `createKbd`.
 *
 * A chord drawn as keycaps: an outer `<kbd>` carrying the primitive's
 * `role="img"` and the spoken name, with one `<kbd>` per key inside it and,
 * where the platform writes one, a separator between them. The primitive
 * writes `data-platform` on the chord and `data-key` on each key; the markup
 * adds `data-size` to the chord and `data-character` to a key that is a
 * character rather than a named key.
 *
 * The chord sits in a line of text and has to behave like a word in it. It is
 * `inline-flex`, whose baseline is its first key's, so it sits on the line the
 * text around it sits on; and nothing inside it wraps, because `Ctrl +` at the
 * end of one line and `K` at the start of the next is two shortcuts, neither
 * of them real.
 *
 * What makes a key a key is its edge, and that is the one thing here a user
 * has to be able to see. `['Control', '+']` draws `Ctrl + +`: the second plus
 * is a keycap and the first is the separator, and only the keycap's edge
 * tells them apart. An edge is geometry, which a forced palette keeps.
 */

import type { ComponentStyles, Declarations } from '../css.js';

const root = 'volt-kbd';
const key = 'volt-kbd-key';
const separator = 'volt-kbd-separator';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const kbdClasses = { root, key, separator } as const;

export const kbdStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const SMALL = `.${root}[data-size='sm']`;

  const sides = (colour: string): Declarations => ({
    'border-block-start-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  return {
    name: 'kbd',
    classes: kbdClasses,
    keyframes: [],

    rules: [
      {
        selector: `.${root}`,
        declarations: {
          display: 'inline-flex',
          'flex-wrap': 'nowrap',
          'align-items': 'baseline',
          'column-gap': 'var(--volt-space-1)',
          'vertical-align': 'baseline',
          'white-space': 'nowrap',
          // A browser draws `<kbd>` in monospace, and at a smaller size when
          // the family is that keyword alone. A keycap is printed in the face
          // of the keyboard, not of a terminal.
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'font-weight': 'var(--volt-font-weight-medium)',
          'line-height': 'var(--volt-line-height-tight)',
          color: 'var(--volt-color-on-surface)',
        },
      },

      {
        // At least as wide as it is tall, so a key of one character is a
        // square cap rather than a sliver around the letter. The lower edge is
        // the thicker one, which is what a key looks like from above.
        selector: `.${key}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-block',
          'min-inline-size': 'var(--volt-space-5)',
          'padding-block-start': '0',
          'padding-block-end': '0',
          'padding-inline-start': 'var(--volt-space-1)',
          'padding-inline-end': 'var(--volt-space-1)',
          'border-block-start-width': 'var(--volt-border-width-1)',
          'border-inline-start-width': 'var(--volt-border-width-1)',
          'border-inline-end-width': 'var(--volt-border-width-1)',
          'border-block-end-width': 'var(--volt-border-width-2)',
          'border-block-start-style': 'solid',
          'border-block-end-style': 'solid',
          'border-inline-start-style': 'solid',
          'border-inline-end-style': 'solid',
          ...sides('var(--volt-color-border)'),
          'border-block-end-color': 'var(--volt-color-border-strong)',
          'border-start-start-radius': 'var(--volt-radius-1)',
          'border-start-end-radius': 'var(--volt-radius-1)',
          'border-end-start-radius': 'var(--volt-radius-1)',
          'border-end-end-radius': 'var(--volt-radius-1)',
          'background-color': 'var(--volt-color-surface-sunken)',
          color: 'inherit',
          // The chord's, restated, because the browser's own `kbd` rule sets
          // the family on this element too and inheritance never reaches it.
          'font-family': 'inherit',
          'font-size': 'inherit',
          'font-weight': 'inherit',
          'line-height': 'inherit',
          'text-align': 'center',
        },
      },

      {
        // A keycap prints its letter as a capital, and the primitive leaves a
        // character in the case it was written, on purpose: upper-casing needs
        // the language, which `text-transform` takes from `lang` and
        // `toUpperCase` does not have. Named keys are left alone — `Ctrl`
        // shouted as `CTRL` is not how a keyboard spells it.
        selector: `.${key}[data-character]`,
        declarations: { 'text-transform': 'uppercase' },
      },

      {
        selector: `.${separator}`,
        declarations: { color: 'var(--volt-color-on-surface-muted)' },
      },

      // For a shortcut beside a menu item or in small print, where the text
      // around it is the smaller size already.
      { selector: SMALL, declarations: { 'font-size': 'var(--volt-font-size-1)' } },
      { selector: `${SMALL} .${key}`, declarations: { 'min-inline-size': 'var(--volt-space-4)' } },
    ],

    forcedColors: [
      { selector: `.${root}`, declarations: { color: 'CanvasText' } },
      {
        // Every edge the one colour, and the lower one no longer darker: the
        // depth was a shade, and the palette has none to spare. The width
        // stays, which is the part of it that was geometry.
        selector: `.${key}`,
        declarations: {
          ...sides('CanvasText'),
          'border-block-end-color': 'CanvasText',
          'background-color': 'Canvas',
          color: 'CanvasText',
        },
      },
      { selector: `.${separator}`, declarations: { color: 'CanvasText' } },
    ],
  };
})();
