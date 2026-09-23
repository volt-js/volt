/**
 * Progress — the styled half of `createProgress`.
 *
 * A track, a bar inside it, and the value written underneath. Two of the three
 * things drawn here are information rather than emphasis, and both are drawn
 * in a channel a forced palette keeps: whether the bar has finished, which is
 * a colour the palette has its own word for, and whether there is a value at
 * all, which is motion.
 *
 * That second one is the indeterminate case, and motion is the honest way to
 * say it: a short bar travelling the track means "this is happening and nobody
 * knows how far along", where a bar standing still at any width is a claim
 * about progress that was never made. The duration is a token like every
 * other, so `prefers-reduced-motion` turns it off without this file mentioning
 * the preference.
 *
 * Because it does turn off, the resting look belongs in the rule rather than
 * in the keyframes, and the animation fills neither way. A `both` fill would
 * leave a stopped bar wherever the last frame put it — at the far end of the
 * track, which reads as nearly done — and `none` leaves it where the rule put
 * it, at the start.
 *
 * How far a determinate bar has come is a width, and a width is a number the
 * component writes inline. Nothing here sizes it, which is also why the base
 * rule starts it at zero: a bar with no width of its own would fill the track
 * until the first value arrived.
 */

import type { ComponentStyles } from '../css.js';
import { transition } from './shared.js';

const root = 'volt-progress';
const track = 'volt-progress-track';
const indicator = 'volt-progress-indicator';
const label = 'volt-progress-label';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const progressClasses = { root, track, indicator, label } as const;

export const progressStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /** Finished, which the primitive marks once the value reaches the maximum. */
  const COMPLETE = `.${indicator}[data-state='complete']`;
  /** No value to show, which is the one state drawn as movement. */
  const INDETERMINATE = `.${indicator}[data-state='indeterminate']`;

  const radius = (token: string) => ({
    'border-start-start-radius': token,
    'border-start-end-radius': token,
    'border-end-start-radius': token,
    'border-end-end-radius': token,
  });

  return {
    name: 'progress',
    classes: progressClasses,

    keyframes: [
      {
        // The travel is `margin-inline-start`, not a translation: a
        // translation runs along the physical inline axis and would send the
        // bar the wrong way in a right-to-left page, and the usual repair is a
        // rule selecting `[dir='rtl']`, which this sheet cannot write.
        //
        // 60 and the bar's own 40 make 100: it comes to each edge of the track
        // exactly, rather than stopping short or running under the clip.
        name: 'volt-progress-indeterminate',
        steps: [
          { offset: 'from', declarations: { 'margin-inline-start': '0%' } },
          { offset: 'to', declarations: { 'margin-inline-start': '60%' } },
        ],
      },
    ],

    rules: [
      {
        selector: `.${root}`,
        declarations: {
          display: 'flex',
          'flex-direction': 'column',
          'row-gap': 'var(--volt-space-1)',
          'inline-size': '100%',
          'font-family': 'var(--volt-font-family-sans)',
          color: 'var(--volt-color-on-surface)',
        },
      },

      {
        selector: `.${track}`,
        declarations: {
          'box-sizing': 'border-box',
          'inline-size': '100%',
          'block-size': 'var(--volt-space-2)',
          // The bar is wider than the track for part of its travel while
          // indeterminate, and this is what keeps it inside.
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          'background-color': 'var(--volt-color-surface-sunken)',
          'border-block-start-width': 'var(--volt-border-width-1)',
          'border-block-end-width': 'var(--volt-border-width-1)',
          'border-inline-start-width': 'var(--volt-border-width-1)',
          'border-inline-end-width': 'var(--volt-border-width-1)',
          'border-block-start-style': 'solid',
          'border-block-end-style': 'solid',
          'border-inline-start-style': 'solid',
          'border-inline-end-style': 'solid',
          'border-block-start-color': 'var(--volt-color-border)',
          'border-block-end-color': 'var(--volt-color-border)',
          'border-inline-start-color': 'var(--volt-color-border)',
          'border-inline-end-color': 'var(--volt-color-border)',
          ...radius('var(--volt-radius-full)'),
        },
      },

      {
        selector: `.${indicator}`,
        declarations: {
          'box-sizing': 'border-box',
          'block-size': '100%',
          'inline-size': '0',
          'margin-inline-start': '0',
          'background-color': 'var(--volt-color-accent)',
          ...radius('var(--volt-radius-full)'),
          ...transition('inline-size'),
        },
      },
      {
        // Done is worth saying in a second colour: a bar at the end of its
        // track and a bar one pixel short of it are the same picture.
        selector: COMPLETE,
        declarations: { 'background-color': 'var(--volt-color-success)' },
      },
      {
        selector: INDETERMINATE,
        declarations: {
          'inline-size': '40%',
          'animation-name': 'volt-progress-indeterminate',
          'animation-duration': 'var(--volt-duration-slow)',
          'animation-timing-function': 'var(--volt-easing-standard)',
          'animation-iteration-count': 'infinite',
          // Back along the track rather than jumping to the start, which reads
          // as a second bar rather than as the same one returning.
          'animation-direction': 'alternate',
          // See the file header: the rule above holds the resting look, and a
          // fill would overwrite it the moment the duration is zero.
          'animation-fill-mode': 'none',
        },
      },

      {
        selector: `.${label}`,
        declarations: {
          'font-size': 'var(--volt-font-size-1)',
          'line-height': 'var(--volt-line-height-normal)',
          'text-align': 'end',
          // The digits keep their columns, so a value counting up does not
          // shuffle the whole label sideways on every change.
          'font-variant-numeric': 'tabular-nums',
          color: 'var(--volt-color-on-surface-muted)',
        },
      },
    ],

    forcedColors: [
      { selector: `.${root}`, declarations: { color: 'CanvasText' } },
      {
        // The fill goes; the edge is what is left to say where the track ends,
        // and a bar at 100% has to stop somewhere visible.
        selector: `.${track}`,
        declarations: {
          'background-color': 'Canvas',
          'border-block-start-color': 'CanvasText',
          'border-block-end-color': 'CanvasText',
          'border-inline-start-color': 'CanvasText',
          'border-inline-end-color': 'CanvasText',
        },
      },
      { selector: `.${indicator}`, declarations: { 'background-color': 'Highlight' } },
      {
        // The forced palette has no word for success. `LinkText` is the colour
        // left in it that is neither the page's text nor its selection, which
        // is why the select spends it on the option that is chosen and this
        // spends it on the bar that is done.
        selector: COMPLETE,
        declarations: { 'background-color': 'LinkText' },
      },
      // The label says the value, which is not a hint: `CanvasText` rather
      // than `GrayText`, whatever it was muted to in the ordinary palette.
      { selector: `.${label}`, declarations: { color: 'CanvasText' } },
    ],
  };
})();
