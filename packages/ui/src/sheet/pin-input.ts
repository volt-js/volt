/**
 * PIN input — the styled half of `createPinInput`.
 *
 * A row of boxes, one per character, drawn as one field: the label, the line
 * of help and the message are the field sheet's, and what is here is the row
 * and a box in it. A box is square and its glyph is centred, because a code is
 * read one character at a time and a box that is wider than it is tall reads
 * as a word with letters missing.
 *
 * The primitive writes `tabindex="0"` on exactly one box — the one that holds
 * the group's single tab stop, which is where the next character goes — and
 * that is the mark drawn as the caret: a thicker lower edge, in the accent. It
 * is a mark on the box rather than a ring, because the ring is focus and the
 * caret outlives it: Tab away and back, and typing resumes where it left off.
 * Not on a disabled box, which keeps the stop but takes no characters.
 * `data-filled` is the character itself and is not drawn; `data-complete` on
 * the group says nothing a full row of glyphs does not.
 *
 * Invalid is on every box rather than on the group, because the group has no
 * edge to draw it on; the primitive writes `aria-invalid` there for the same
 * reason it keeps the message on the group — one message, six edges. The
 * caret's edge stays thick under it, so the box the user is on is still the
 * box the user is on once the code has been refused.
 *
 * Nothing styles the hidden input beneath: the primitive hides it itself,
 * inline, because a form control that submits has to stay in the page.
 */

import type { ComponentStyles } from '../css.js';
import { disabledLook, focusRing, forcedDisabled, forcedFocusRing, transition } from './shared.js';

const root = 'volt-pin-input';
const box = 'volt-pin-input-box';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const pinInputClasses = { root, box } as const;

export const pinInputStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /**
   * The box the group's tab stop is on, which is where the next character
   * goes — in a field that takes characters. A disabled field keeps the stop
   * where it was, for when it comes back, and an accent edge saying "type
   * here" over a box nobody can type into is a promise the field breaks.
   *
   * That condition is inside `:where()`, which weighs nothing. Written bare,
   * `:not(:disabled)` is a class's worth of weight, and the caret would
   * outrank the refusal below it whatever order the two are written in: a
   * refused code would keep its caret's edge in the accent.
   */
  const CARET = `.${box}[tabindex='0']:where(:not(:disabled))`;
  const INVALID = `.${box}[aria-invalid='true']`;
  const DISABLED = `.${box}:disabled`;

  const border = (colour: string) => ({
    'border-block-start-width': 'var(--volt-border-width-1)',
    'border-block-end-width': 'var(--volt-border-width-1)',
    'border-inline-start-width': 'var(--volt-border-width-1)',
    'border-inline-end-width': 'var(--volt-border-width-1)',
    'border-block-start-style': 'solid',
    'border-block-end-style': 'solid',
    'border-inline-start-style': 'solid',
    'border-inline-end-style': 'solid',
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  const edges = (colour: string) => ({
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  return {
    name: 'pin-input',
    classes: pinInputClasses,
    keyframes: [],

    rules: [
      {
        // Wraps rather than shrinks: a long code on a narrow screen goes onto
        // a second line, and every box stays the size a finger can land on.
        selector: `.${root}`,
        declarations: {
          display: 'flex',
          'flex-wrap': 'wrap',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-2)',
          'row-gap': 'var(--volt-space-2)',
        },
      },

      {
        selector: `.${box}`,
        declarations: {
          'box-sizing': 'border-box',
          'inline-size': 'var(--volt-space-12)',
          'block-size': 'var(--volt-space-12)',
          // A browser pads an `<input>` on its own, and one character in a
          // square box has to sit in the middle of it.
          'padding-block-start': '0',
          'padding-block-end': '0',
          'padding-inline-start': '0',
          'padding-inline-end': '0',
          'text-align': 'center',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-4)',
          'font-weight': 'var(--volt-font-weight-medium)',
          'line-height': 'var(--volt-line-height-tight)',
          color: 'var(--volt-color-on-surface)',
          'background-color': 'var(--volt-color-surface)',
          ...border('var(--volt-color-border-strong)'),
          'border-start-start-radius': 'var(--volt-radius-1)',
          'border-start-end-radius': 'var(--volt-radius-1)',
          'border-end-start-radius': 'var(--volt-radius-1)',
          'border-end-end-radius': 'var(--volt-radius-1)',
          ...transition('border-color, background-color'),
        },
      },
      { selector: `.${box}:focus-visible`, declarations: { ...focusRing } },
      {
        selector: CARET,
        declarations: {
          'border-block-end-width': 'var(--volt-border-width-2)',
          'border-block-end-color': 'var(--volt-color-accent)',
        },
      },
      {
        // After the caret and as heavy as it, so a refused code colours the
        // caret's edge too and leaves it thick: the box the user is on is
        // still told apart.
        selector: INVALID,
        declarations: { ...edges('var(--volt-color-danger)') },
      },
      {
        // The platform's own `disabled`, as the field's control has it: the
        // boxes are native inputs, and the primitive writes the property.
        selector: DISABLED,
        declarations: { ...disabledLook, 'background-color': 'var(--volt-color-surface-sunken)' },
      },
    ],

    forcedColors: [
      {
        // `Field` rather than `Canvas`: this is an input, and the forced
        // palette keeps a separate pair for the things a user fills in.
        selector: `.${box}`,
        declarations: {
          color: 'CanvasText',
          'background-color': 'Field',
          ...edges('CanvasText'),
        },
      },
      { selector: `.${box}:focus-visible`, declarations: { ...forcedFocusRing } },
      // Where the next character goes is information rather than emphasis,
      // and the palette has a colour for exactly that. The thicker edge stays
      // from the rules above, so the mark survives in shape as well.
      { selector: CARET, declarations: { 'border-block-end-color': 'Highlight' } },
      {
        // The palette has no danger colour, and a refused box still has to
        // look refused: the edge doubles instead, which is a difference in
        // shape rather than in hue.
        selector: INVALID,
        declarations: {
          'border-block-start-width': 'var(--volt-border-width-2)',
          'border-block-end-width': 'var(--volt-border-width-2)',
          'border-inline-start-width': 'var(--volt-border-width-2)',
          'border-inline-end-width': 'var(--volt-border-width-2)',
        },
      },
      { selector: DISABLED, declarations: { ...forcedDisabled, 'background-color': 'Field' } },
    ],
  };
})();
