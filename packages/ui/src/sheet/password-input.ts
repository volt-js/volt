/**
 * Password input — the styled half of `createPasswordInput`, less the field.
 *
 * The label, the box, the line of help and the message are the field's, drawn
 * by `field.ts` under the classes every text-shaped control wears, and nothing
 * here restates them. What a password field adds is a toggle at the inline
 * end of the box, so this draws the toggle, the row that puts it there, and
 * the live region that says what a press did. The region is on the page
 * whether or not anything has been pressed — one that arrives together with
 * its message announces nothing — so it has to be there and not be seen.
 *
 * Two states are drawn on the toggle, and both survive a forced palette.
 * Revealed is information rather than emphasis: a password on the screen is
 * something a user has to be able to see at a glance, before reading the
 * words in the button, so it is the accent here and the palette's own
 * emphasis pair there — under the pointer as well, where the hover's own
 * fill would otherwise take the pair apart. That toggle is taken out from
 * under the palette as well, or the browser's backplate behind its words
 * would be the colour of the words. Disabled follows the box. The
 * primitive has no opinion about the toggle's `disabled` — the markup writes
 * it from the field's flag — and the palette has its own word for it. The
 * name of the toggle moves between "Show password" and "Hide password", which
 * is the primitive's doing, and no rule here reads it.
 */

import type { ComponentStyles, Declarations } from '../css.js';
import { disabledLook, focusRing, forcedDisabled, forcedFocusRing, transition } from './shared.js';

const root = 'volt-password-input';
const toggle = 'volt-password-input-toggle';
const status = 'volt-password-input-status';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const passwordInputClasses = { root, toggle, status } as const;

export const passwordInputStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const REVEALED = `.${toggle}[data-state='revealed']`;
  const DISABLED = `.${toggle}:disabled`;
  /** A toggle that answers a press; the field's flag takes the others out. */
  const HOVERED = `.${toggle}:not(:disabled):hover`;
  /** The same, with the password on the screen: more specific than either alone. */
  const REVEALED_HOVERED = `${REVEALED}:not(:disabled):hover`;

  const edges = (colour: string): Declarations => ({
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  return {
    name: 'password-input',
    classes: passwordInputClasses,
    keyframes: [],

    rules: [
      {
        // The box and the toggle, side by side. The box asks for the whole
        // row and gives up what the toggle needs, which the field's own
        // `min-inline-size: 0` lets it do; the toggle never shrinks.
        selector: `.${root}`,
        declarations: {
          display: 'flex',
          'align-items': 'stretch',
          'column-gap': 'var(--volt-space-2)',
        },
      },

      {
        // The box's own edge, radius and type, so the two read as one control
        // in two parts rather than a field with a stray button beside it.
        // The margins are cleared because an engine's own sheet gives a
        // `<button>` some, and the row's gap is the only space meant here.
        selector: `.${toggle}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-flex',
          'flex-shrink': '0',
          'align-items': 'center',
          'justify-content': 'center',
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
          'border-start-start-radius': 'var(--volt-radius-1)',
          'border-start-end-radius': 'var(--volt-radius-1)',
          'border-end-start-radius': 'var(--volt-radius-1)',
          'border-end-end-radius': 'var(--volt-radius-1)',
          'background-color': 'var(--volt-color-surface)',
          color: 'var(--volt-color-on-surface)',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'font-weight': 'var(--volt-font-weight-medium)',
          'line-height': 'var(--volt-line-height-tight)',
          'white-space': 'nowrap',
          cursor: 'pointer',
          'user-select': 'none',
          ...transition('background-color, border-color, color'),
        },
      },
      {
        selector: HOVERED,
        declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
      },
      { selector: `.${toggle}:focus-visible`, declarations: { ...focusRing } },
      {
        // The password is on the screen. Said in the words and the edge, on
        // the plain surface: the accent on its own muted fill is under 4.5:1.
        selector: REVEALED,
        declarations: {
          color: 'var(--volt-color-accent)',
          ...edges('var(--volt-color-accent)'),
        },
      },
      {
        // The hover's fill is darker than the surface, and the accent on it
        // falls under 4.5:1; the accent's own hover shade is back over it.
        selector: REVEALED_HOVERED,
        declarations: {
          color: 'var(--volt-color-accent-hover)',
          ...edges('var(--volt-color-accent-hover)'),
        },
      },
      {
        // The surface the box takes when it is out of use, so the two still
        // read as one control. A revealed toggle keeps its accent under the
        // dimming, because the password beside it is still on the screen.
        selector: DISABLED,
        declarations: { ...disabledLook, 'background-color': 'var(--volt-color-surface-sunken)' },
      },

      {
        // The polite live region. Present whether or not the toggle has been
        // pressed, and never seen: the same recipe every status region in
        // the sheet uses, since `display: none` would silence it.
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
      {
        selector: `.${toggle}`,
        declarations: {
          color: 'ButtonText',
          'background-color': 'ButtonFace',
          ...edges('ButtonBorder'),
        },
      },
      {
        // The fill under the pointer would come out of the palette as the
        // button's own, so the underline is the feedback: it is geometry,
        // which nothing flattens.
        selector: HOVERED,
        declarations: {
          'background-color': 'ButtonFace',
          'text-decoration-line': 'underline',
        },
      },
      { selector: `.${toggle}:focus-visible`, declarations: { ...forcedFocusRing } },
      {
        // The palette has one emphasis pair, and a password on show is what
        // it is spent on here.
        selector: REVEALED,
        declarations: {
          'background-color': 'Highlight',
          color: 'HighlightText',
          ...edges('Highlight'),
          // Left under the palette, Chrome paints a backplate of `Canvas`
          // behind every run of text, and `HighlightText` is that same colour
          // in the dark scheme and the light: the one control that hides the
          // password again would be a `Highlight` box with a blank where its
          // name was. Out from under the palette, every colour it paints is
          // named in this block and is the palette's own, and an icon in the
          // slot drawn in `currentColor` inherits the words' colour.
          'forced-color-adjust': 'none',
        },
      },
      {
        // The pointer's rule outranks the one above and sets the fill, which
        // would leave `HighlightText` on `ButtonFace` — words in the colour of
        // the button behind them. The pair is put back together here, and so
        // is the edge: the accent's hover shade outranks the revealed rule's
        // too, and with the palette no longer replacing it, it would be drawn.
        selector: REVEALED_HOVERED,
        declarations: {
          'background-color': 'Highlight',
          color: 'HighlightText',
          ...edges('Highlight'),
        },
      },
      {
        // Last, so that it beats the revealed rule, which is exactly as
        // specific and sets the same three things: in this palette a toggle
        // taken out of use is `GrayText` whichever state it was left in. A
        // revealed one stays out from under the palette, which costs nothing:
        // all three are still the palette's own. The edges are spelled as the
        // revealed rule spells them, so the two are one property whatever
        // engine resolves them.
        selector: DISABLED,
        declarations: {
          ...forcedDisabled,
          ...edges('GrayText'),
          'background-color': 'ButtonFace',
        },
      },
    ],
  };
})();
