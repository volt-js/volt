/**
 * Chip — the styled half of `createChip`.
 *
 * A tag in a set: the words, and when it can be removed a small round button
 * after them. The primitive writes `tabindex` and `data-volt-item` on the chip
 * and the name on the button; the markup adds `data-tone` and `data-size` to
 * the chip, which are the page's choice and nothing the primitive knows about,
 * and `tabindex="-1"` to a chip that cannot be removed.
 *
 * A removable chip is the tab stop and the button never is, so the chip is
 * where the ring goes. Delete and Backspace there do the button's job, and a
 * keyboard user who cannot see which chip they are on cannot tell which one
 * those keys will take away — so the ring is the one state here drawn in a
 * channel a forced palette keeps.
 *
 * Tone is emphasis, and a forced palette is welcome to it. It is never
 * spoken, so a chip whose tone is the only thing saying what it means says
 * nothing to a screen reader in any palette, and the words are where that
 * meaning has to be; a forced palette that draws every tone alike loses
 * nothing the words did not already say. Each tone is a hue in the words and
 * the edge, on the plain surface rather than a tinted one: accent on the
 * accent's own muted fill is under 4.5:1, and two of the four hues have no
 * muted fill to sit on at all.
 */

import type { ComponentStyles, Declarations } from '../css.js';
import { focusRing, forcedFocusRing, transition } from './shared.js';

const root = 'volt-chip';
const label = 'volt-chip-label';
const remove = 'volt-chip-remove';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const chipClasses = { root, label, remove } as const;

export const chipStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const SMALL = `.${root}[data-size='sm']`;
  const tone = (name: string) => `.${root}[data-tone='${name}']`;

  const edges = (colour: string): Declarations => ({
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  const radius = (token: string): Declarations => ({
    'border-start-start-radius': token,
    'border-start-end-radius': token,
    'border-end-start-radius': token,
    'border-end-end-radius': token,
  });

  /** The words and the edge in one hue, on the plain surface. */
  const hue = (colour: string): Declarations => ({
    color: colour,
    'background-color': 'var(--volt-color-surface)',
    ...edges(colour),
  });

  /** What every tone comes to once the palette is the user's. */
  const forcedTone: Declarations = {
    color: 'CanvasText',
    'background-color': 'Canvas',
    ...edges('CanvasText'),
  };

  return {
    name: 'chip',
    classes: chipClasses,
    keyframes: [],

    rules: [
      {
        selector: `.${root}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-flex',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-1)',
          // A chip longer than the line it is on shortens its words rather
          // than pushing the row wider than the field holding it.
          'max-inline-size': '100%',
          'vertical-align': 'middle',
          'padding-block-start': 'var(--volt-space-1)',
          'padding-block-end': 'var(--volt-space-1)',
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
          ...edges('var(--volt-color-border)'),
          ...radius('var(--volt-radius-full)'),
          'background-color': 'var(--volt-color-surface-sunken)',
          color: 'var(--volt-color-on-surface)',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'font-weight': 'var(--volt-font-weight-regular)',
          'line-height': 'var(--volt-line-height-tight)',
          'white-space': 'nowrap',
          cursor: 'default',
        },
      },
      { selector: `.${root}:focus-visible`, declarations: { ...focusRing } },

      {
        selector: SMALL,
        declarations: {
          'padding-block-start': 'calc(var(--volt-space-1) / 2)',
          'padding-block-end': 'calc(var(--volt-space-1) / 2)',
          'padding-inline-start': 'var(--volt-space-2)',
          'padding-inline-end': 'var(--volt-space-2)',
          'font-size': 'var(--volt-font-size-1)',
        },
      },

      { selector: tone('accent'), declarations: hue('var(--volt-color-accent)') },
      { selector: tone('success'), declarations: hue('var(--volt-color-success)') },
      { selector: tone('warning'), declarations: hue('var(--volt-color-warning)') },
      { selector: tone('danger'), declarations: hue('var(--volt-color-danger)') },

      {
        selector: `.${label}`,
        declarations: {
          // A flex item will not shrink past its contents without this, and
          // then there is nothing for the ellipsis to cut.
          'min-inline-size': '0',
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          'text-overflow': 'ellipsis',
        },
      },

      {
        // The browser's own button, taken back to nothing: no edge, no fill,
        // no face of its own — the glyph inside is drawn in the chip's words'
        // colour and size. The margin at the end tucks it into the padding,
        // so a removable chip is not wider at that end than a fixed one.
        selector: `.${remove}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-flex',
          'flex-shrink': '0',
          'align-items': 'center',
          'justify-content': 'center',
          'inline-size': 'var(--volt-space-4)',
          'block-size': 'var(--volt-space-4)',
          'margin-block-start': '0',
          'margin-block-end': '0',
          'margin-inline-start': '0',
          'margin-inline-end': 'calc(var(--volt-space-2) * -1)',
          'padding-block-start': '0',
          'padding-block-end': '0',
          'padding-inline-start': '0',
          'padding-inline-end': '0',
          'border-block-start-width': '0',
          'border-block-end-width': '0',
          'border-inline-start-width': '0',
          'border-inline-end-width': '0',
          ...radius('var(--volt-radius-full)'),
          'background-color': 'transparent',
          color: 'inherit',
          'font-family': 'inherit',
          'font-size': 'inherit',
          'line-height': '1',
          cursor: 'pointer',
          ...transition('background-color'),
        },
      },
      {
        selector: `.${remove}:hover`,
        declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
      },
      // Never a tab stop, but a click or a screen reader's cursor can still
      // leave focus on it, and focus nobody can see is focus lost.
      { selector: `.${remove}:focus-visible`, declarations: { ...focusRing } },
      {
        selector: `${SMALL} .${remove}`,
        declarations: {
          'inline-size': 'var(--volt-space-3)',
          'block-size': 'var(--volt-space-3)',
          'margin-inline-end': 'calc(var(--volt-space-1) * -1)',
        },
      },
    ],

    forcedColors: [
      // The edge is what says where a chip starts and ends once the fills are
      // all one colour, so it is named rather than left to the palette.
      { selector: `.${root}`, declarations: forcedTone },
      // Restated at the depth the hues were written at: a media query adds no
      // specificity, so a rule naming only the part would lose to the tone's.
      { selector: tone('accent'), declarations: forcedTone },
      { selector: tone('success'), declarations: forcedTone },
      { selector: tone('warning'), declarations: forcedTone },
      { selector: tone('danger'), declarations: forcedTone },
      { selector: `.${root}:focus-visible`, declarations: { ...forcedFocusRing } },

      { selector: `.${remove}`, declarations: { color: 'CanvasText' } },
      // Handed back: a pointer user can see their own pointer, and the fill
      // under it would come out of the palette as the chip's own.
      { selector: `.${remove}:hover`, declarations: { 'background-color': 'Canvas' } },
      { selector: `.${remove}:focus-visible`, declarations: { ...forcedFocusRing } },
    ],
  };
})();
