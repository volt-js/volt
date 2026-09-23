/**
 * Spinner — the styled half of `createSpinner`.
 *
 * A ring with one edge in the colour of the text around it, turning. Four
 * decisions, each of them forced by something other than taste:
 *
 * The mark is drawn by its class and taken away by its state. The other way
 * round — hidden until a state says otherwise — would leave a consumer who
 * writes `class="volt-spinner-indicator"` by hand looking at nothing, with
 * every rule here perfectly correct. So the class is the ring, and the two
 * states before it has earned its place on screen are what remove it.
 *
 * The turn is timed with `--volt-duration-slow`, which is the whole of how
 * `prefers-reduced-motion` reaches it: the preference is honoured once, by
 * repointing that token at zero. A literal here would be a component that
 * ignores the preference silently, and no rule in this file can ask about it —
 * the sheet has ordinary rules and forced-colours rules, and nothing else.
 * That token exists because this one needed it: a turn timed like a
 * transition is five revolutions a second, which is a strobe rather than a
 * sign of work.
 *
 * Which is why the ring has to say what it means standing still. At zero
 * duration nothing moves, and a mark that only reads as work-in-progress while
 * it is spinning — a lone orbiting dot, an arc with no circle behind it —
 * says nothing at all to the user who asked for less motion. A full ring with
 * one edge picked out is the same statement at rest as in motion.
 *
 * The words beside it are not drawn. They are in the live region for a screen
 * reader, and the ring is what everybody else has; `aria-hidden` on the ring
 * and a visually hidden label is the pair `createSpinner` is built around.
 */

import type { ComponentStyles } from '../css.js';

const root = 'volt-spinner';
const indicator = 'volt-spinner-indicator';
const label = 'volt-spinner-label';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const spinnerClasses = { root, indicator, label } as const;

export const spinnerStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /** The ring's diameter. The stroke does not scale with it: one mark, three sizes. */
  const diameter = (size: string) => ({ 'inline-size': size, 'block-size': size });

  const radius = (token: string) => ({
    'border-start-start-radius': token,
    'border-start-end-radius': token,
    'border-end-start-radius': token,
    'border-end-end-radius': token,
  });

  return {
    name: 'spinner',
    classes: spinnerClasses,

    keyframes: [
      {
        name: 'volt-spinner-turn',
        steps: [
          { offset: 'from', declarations: { rotate: '0deg' } },
          { offset: 'to', declarations: { rotate: '360deg' } },
        ],
      },
    ],

    rules: [
      {
        // The live region, which is on the page whether anything is happening
        // or not. Empty it has no in-flow child — the ring is taken away by
        // its state and the label is out of flow — so it costs no space until
        // there is something to show.
        selector: `.${root}`,
        declarations: {
          display: 'inline-flex',
          'align-items': 'center',
          'vertical-align': 'middle',
        },
      },

      {
        selector: `.${indicator}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-block',
          'flex-shrink': '0',
          ...diameter('var(--volt-space-4)'),
          'border-block-start-width': 'var(--volt-border-width-2)',
          'border-block-end-width': 'var(--volt-border-width-2)',
          'border-inline-start-width': 'var(--volt-border-width-2)',
          'border-inline-end-width': 'var(--volt-border-width-2)',
          'border-block-start-style': 'solid',
          'border-block-end-style': 'solid',
          'border-inline-start-style': 'solid',
          'border-inline-end-style': 'solid',
          // The head in the text's own colour, so the mark belongs wherever it
          // is put — in a button, on a card, over an accent fill — without a
          // tone prop telling it where it is. The rest of the ring is the
          // track it turns against.
          'border-block-start-color': 'currentColor',
          'border-block-end-color': 'var(--volt-color-border)',
          'border-inline-start-color': 'var(--volt-color-border)',
          'border-inline-end-color': 'var(--volt-color-border)',
          ...radius('var(--volt-radius-full)'),
          'animation-name': 'volt-spinner-turn',
          'animation-duration': 'var(--volt-duration-slow)',
          // Linear rather than the easing token the rest of the sheet reaches
          // for: an eased turn speeds up and slows down once a revolution,
          // which reads as a mark catching on something.
          'animation-timing-function': 'linear',
          'animation-iteration-count': 'infinite',
        },
      },
      {
        // The delay, drawn. A wait too short to be worth a spinner never gets
        // one, and the region is already mounted when the wait that is worth
        // one arrives.
        selector: `.${indicator}[data-state='idle'], .${indicator}[data-state='delayed']`,
        declarations: { display: 'none' },
      },

      {
        // On the ring rather than on the region around it, so that the mark is
        // a class and an attribute and nothing else: written by hand, inside a
        // button or a cell, it is still the mark at the size it was asked for.
        selector: `.${indicator}[data-size='sm']`,
        declarations: { ...diameter('var(--volt-space-3)') },
      },
      {
        selector: `.${indicator}[data-size='lg']`,
        declarations: { ...diameter('var(--volt-space-6)') },
      },

      {
        // The words, off the screen and in the accessibility tree. `display:
        // none` would keep them out of both, which is the whole announcement
        // lost; this is the one shape that hides them from everybody else.
        selector: `.${label}`,
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
        // The head is `currentColor` already, so the forced palette picks it
        // up with the text it sits in and nothing here should pin it to one
        // system colour — a ring inside a button would come out in the page's
        // colour rather than the button's. Only the track has to be restated,
        // and `GrayText` is the palette's one quiet colour: forced or not, the
        // ring is a bright head against a dimmer circle.
        selector: `.${indicator}`,
        declarations: {
          'border-block-end-color': 'GrayText',
          'border-inline-start-color': 'GrayText',
          'border-inline-end-color': 'GrayText',
        },
      },
    ],
  };
})();
