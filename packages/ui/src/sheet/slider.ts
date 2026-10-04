/**
 * Slider — the styled half of `createSlider`.
 *
 * A track, the span filled between the minimum and the thumb — or between two
 * thumbs — a thumb per value, and ticks along the track with words under the
 * ones that have any. The primitive writes `data-orientation` on every part,
 * `data-disabled` on the group, the track, the range and each thumb,
 * `data-active` on the thumb the keys move, `data-dragging` on the group
 * while a pointer holds one, and `data-state` on a mark as `active` inside
 * the filled span and `inactive` outside it. Those are the only hooks these
 * rules select on, with one of the component's own: `data-scale` on the
 * group, when a tick has words that need room. Nothing here reads ARIA, which
 * is there to be spoken.
 *
 * Nothing here positions anything along the track. Where a thumb, a mark or
 * the fill sits is a percentage the primitive reports, and the component
 * writes it inline on one edge — `inset-inline-start` along a horizontal
 * track, `inset-block-end` up a vertical one. What the sheet does is centre
 * each part on that edge, and it does it with a negative margin of half the
 * part's own size rather than with `translate`. A translation runs along the
 * physical axis and would push a thumb the wrong way in a right-to-left page,
 * and the usual repair — a rule selecting `[dir='rtl']` — is one this sheet
 * cannot write, since every compound here names a class the markup carries.
 * A logical margin follows the writing direction on its own.
 *
 * A thumb is wider than the track it rides, and one at either end of the
 * range is centred on the end of the track, so half of it hangs past. The
 * track's margins pay for that overhang on every side, which keeps the thumb
 * inside the slider's own box — over nothing that follows it, and clipped by
 * no ancestor that hides its overflow.
 *
 * A mark's tick is the mark itself, two pixels wide, and its words are a
 * flex item inside it: a flex container centres an item wider than itself by
 * letting it overflow both ways equally, which is what puts the words under
 * the tick in either direction. The words hang below the track, clear of a
 * thumb resting on the tick, so a slider with a scale is given room beneath
 * it on `data-scale` — a mark is inside the track and cannot make room
 * outside it.
 *
 * Which thumb the keys will move sits on top of the others, so that two
 * thumbs pushed together can be pulled apart by the one that was last
 * touched. That is a `z-index`, and the track is its own stacking context so
 * the number never competes with anything else on the page.
 *
 * Every state is said in a channel a forced palette keeps: the fill in
 * `Highlight`, a thumb with an edge in `CanvasText`, a tick inside the fill in
 * `HighlightText` and one outside it in `CanvasText`, and a slider that is off
 * in `GrayText` on every edge, every tick and every word of its scale, since
 * the opacity is handed back.
 */

import type { ComponentStyles } from '../css.js';
import { disabledLook, focusRing, forcedFocusRing, transition } from './shared.js';

const root = 'volt-slider';
const label = 'volt-slider-label';
const track = 'volt-slider-track';
const range = 'volt-slider-range';
const thumb = 'volt-slider-thumb';
const mark = 'volt-slider-mark';
const markLabel = 'volt-slider-mark-label';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const sliderClasses = { root, label, track, range, thumb, mark, markLabel } as const;

export const sliderStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const VERTICAL_ROOT = `.${root}[data-orientation='vertical']`;
  const VERTICAL_TRACK = `.${track}[data-orientation='vertical']`;
  const VERTICAL_RANGE = `.${range}[data-orientation='vertical']`;
  const VERTICAL_THUMB = `.${thumb}[data-orientation='vertical']`;
  const VERTICAL_MARK = `.${mark}[data-orientation='vertical']`;
  /** The thumb the keys move, and the one a pointer is holding. */
  const ACTIVE = `.${thumb}[data-active]`;
  const HELD = `.${root}[data-dragging] ${ACTIVE}`;
  /** A tick inside the filled span. */
  const IN_RANGE = `.${mark}[data-state='active']`;
  /** The whole slider, out of use; a mark carries no state of its own for it. */
  const OFF = `.${root}[data-disabled]`;

  /**
   * The thumb, which is also its hit target: `--volt-space-6` is twenty-four
   * pixels at the default type size, the least a finger can be asked to land
   * on.
   */
  const THUMB = 'var(--volt-space-6)';
  /** The track's thickness, across the way it runs. */
  const TRACK = 'var(--volt-space-2)';

  /** Back half a thumb, which centres it on the edge its value is written on. */
  const CENTRE_THUMB = `calc(${THUMB} / -2)`;
  /** Back half a tick, likewise. */
  const CENTRE_TICK = 'calc(var(--volt-border-width-2) / -2)';
  /** How far a thumb hangs past the end of the track, at either end of the range. */
  const PAST_END = `calc(${THUMB} / 2)`;
  /** How far it hangs past either side of the track, across it. */
  const PAST_SIDE = `calc((${THUMB} - ${TRACK}) / 2)`;
  /**
   * From the tick's own edge, which is the track's, to past a thumb resting on
   * it: half the track to its middle, half a thumb beyond that, and a gap.
   */
  const CLEAR_OF_THUMB = `calc((${THUMB} + ${TRACK}) / 2 + var(--volt-space-1))`;

  const border = (colour: string) => ({
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  const edges = (width: string) => ({
    'border-block-start-width': width,
    'border-block-end-width': width,
    'border-inline-start-width': width,
    'border-inline-end-width': width,
    'border-block-start-style': 'solid',
    'border-block-end-style': 'solid',
    'border-inline-start-style': 'solid',
    'border-inline-end-style': 'solid',
  });

  const round = {
    'border-start-start-radius': 'var(--volt-radius-full)',
    'border-start-end-radius': 'var(--volt-radius-full)',
    'border-end-start-radius': 'var(--volt-radius-full)',
    'border-end-end-radius': 'var(--volt-radius-full)',
  };

  return {
    name: 'slider',
    classes: sliderClasses,
    keyframes: [],

    rules: [
      {
        selector: `.${root}`,
        declarations: {
          display: 'flex',
          'flex-direction': 'column',
          'row-gap': 'var(--volt-space-2)',
          // The track has no width of its own to offer, so a slider sized by
          // its content — in a flex row, say — would otherwise be nothing wide.
          'inline-size': '100%',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-normal)',
          color: 'var(--volt-color-on-surface)',
        },
      },
      {
        // Stood on end: the track has no height of its own to take from the
        // page either, so the group takes one, and the track grows to fill
        // whatever the label leaves of it. Inline, so a row of them stands
        // side by side the way a mixing desk's faders do.
        selector: VERTICAL_ROOT,
        declarations: {
          display: 'inline-flex',
          'align-items': 'center',
          'inline-size': 'auto',
          'block-size': 'calc(var(--volt-space-20) * 2)',
        },
      },
      {
        // Room for the words under the ticks, which are drawn outside the
        // track's box and would otherwise sit on whatever follows the slider.
        selector: `.${root}[data-scale]`,
        declarations: { 'padding-block-end': 'var(--volt-space-5)' },
      },
      {
        selector: `${VERTICAL_ROOT}[data-scale]`,
        declarations: {
          'padding-block-end': '0',
          'padding-inline-end': 'var(--volt-space-8)',
        },
      },
      { selector: `.${root}[data-disabled]`, declarations: { ...disabledLook } },

      {
        selector: `.${label}`,
        declarations: {
          'font-weight': 'var(--volt-font-weight-medium)',
          'user-select': 'none',
        },
      },

      {
        selector: `.${track}`,
        declarations: {
          position: 'relative',
          'box-sizing': 'border-box',
          'block-size': TRACK,
          'flex-shrink': '0',
          'margin-block-start': PAST_SIDE,
          'margin-block-end': PAST_SIDE,
          'margin-inline-start': PAST_END,
          'margin-inline-end': PAST_END,
          ...edges('var(--volt-border-width-1)'),
          ...border('var(--volt-color-border)'),
          ...round,
          'background-color': 'var(--volt-color-surface-sunken)',
          // The active thumb's `z-index` is settled in here, and never
          // against anything else on the page.
          isolation: 'isolate',
          // A drag along the track is a gesture the page would otherwise take
          // for a scroll, and win.
          'touch-action': 'none',
          cursor: 'pointer',
        },
      },
      {
        selector: VERTICAL_TRACK,
        declarations: {
          'inline-size': TRACK,
          'block-size': 'auto',
          'flex-grow': '1',
          'min-block-size': '0',
          'margin-block-start': PAST_END,
          'margin-block-end': PAST_END,
          'margin-inline-start': PAST_SIDE,
          'margin-inline-end': PAST_SIDE,
        },
      },
      { selector: `.${track}[data-disabled]`, declarations: { cursor: 'not-allowed' } },

      {
        // Its two ends along the track are inline; the sheet fills it across.
        selector: `.${range}`,
        declarations: {
          position: 'absolute',
          'inset-block-start': '0',
          'inset-block-end': '0',
          'background-color': 'var(--volt-color-accent)',
          ...round,
        },
      },
      {
        selector: VERTICAL_RANGE,
        declarations: {
          'inset-block-start': 'auto',
          'inset-block-end': 'auto',
          'inset-inline-start': '0',
          'inset-inline-end': '0',
        },
      },
      {
        selector: `.${range}[data-disabled]`,
        declarations: { 'background-color': 'var(--volt-color-border-strong)' },
      },

      {
        // The whole box is the hit target; the border is what is seen.
        selector: `.${thumb}`,
        declarations: {
          position: 'absolute',
          'box-sizing': 'border-box',
          'inset-block-start': '50%',
          'inline-size': THUMB,
          'block-size': THUMB,
          'margin-block-start': CENTRE_THUMB,
          'margin-inline-start': CENTRE_THUMB,
          ...edges('var(--volt-border-width-2)'),
          ...border('var(--volt-color-accent)'),
          ...round,
          'background-color': 'var(--volt-color-surface)',
          cursor: 'grab',
          'touch-action': 'none',
          ...transition('border-color, background-color'),
        },
      },
      {
        selector: VERTICAL_THUMB,
        declarations: {
          'inset-block-start': 'auto',
          'inset-inline-start': '50%',
          'margin-block-start': '0',
          'margin-block-end': CENTRE_THUMB,
        },
      },
      {
        selector: `.${thumb}:not([data-disabled]):hover`,
        declarations: { ...border('var(--volt-color-accent-hover)') },
      },
      { selector: `.${thumb}:focus-visible`, declarations: { ...focusRing } },
      {
        // On top of the others, so that a stack of thumbs can be pulled apart
        // by whichever one was last moved.
        selector: ACTIVE,
        declarations: { 'z-index': '1' },
      },
      { selector: HELD, declarations: { cursor: 'grabbing' } },
      {
        selector: `.${thumb}[data-disabled]`,
        declarations: {
          cursor: 'not-allowed',
          ...border('var(--volt-color-border-strong)'),
        },
      },

      {
        // The tick is the mark's own box, two pixels across, and the words are
        // centred on it by the flex layout — a container centres an item wider
        // than itself by letting it overflow both ways equally.
        selector: `.${mark}`,
        declarations: {
          position: 'absolute',
          'inset-block-start': '0',
          'block-size': '100%',
          'inline-size': 'var(--volt-border-width-2)',
          'margin-inline-start': CENTRE_TICK,
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'center',
          'background-color': 'var(--volt-color-border-strong)',
        },
      },
      {
        selector: VERTICAL_MARK,
        declarations: {
          'inset-block-start': 'auto',
          'inset-inline-start': '0',
          'inline-size': '100%',
          'block-size': 'var(--volt-border-width-2)',
          'margin-inline-start': '0',
          'margin-block-end': CENTRE_TICK,
          'flex-direction': 'row',
        },
      },
      {
        // Inside the fill, where a tick in the track's own grey would vanish.
        selector: IN_RANGE,
        declarations: { 'background-color': 'var(--volt-color-on-accent)' },
      },

      {
        // Below the track, and below a thumb resting on the tick, which would
        // otherwise sit on the top of the words it is pointing at.
        selector: `.${markLabel}`,
        declarations: {
          'margin-block-start': CLEAR_OF_THUMB,
          'font-size': 'var(--volt-font-size-1)',
          'line-height': 'var(--volt-line-height-tight)',
          'white-space': 'nowrap',
          color: 'var(--volt-color-on-surface-muted)',
          'user-select': 'none',
        },
      },
      {
        selector: `${VERTICAL_MARK} .${markLabel}`,
        declarations: {
          'margin-block-start': '0',
          'margin-inline-start': CLEAR_OF_THUMB,
        },
      },
    ],

    forcedColors: [
      { selector: `.${root}`, declarations: { color: 'CanvasText' } },
      // Forced colours has its own word for unavailable, and dimming on top of
      // it only muddies a palette the user chose for contrast.
      { selector: `.${root}[data-disabled]`, declarations: { color: 'GrayText', opacity: '1' } },

      {
        // The fill goes; the edge is what is left to say where the track is.
        selector: `.${track}`,
        declarations: { 'background-color': 'Canvas', ...border('CanvasText') },
      },
      { selector: `.${track}[data-disabled]`, declarations: { ...border('GrayText') } },

      { selector: `.${range}`, declarations: { 'background-color': 'Highlight' } },
      { selector: `.${range}[data-disabled]`, declarations: { 'background-color': 'GrayText' } },

      {
        // An edge in the page's own text colour, over a fill in `Canvas`: what
        // is left to tell a thumb from the `Highlight` it sits on.
        selector: `.${thumb}`,
        declarations: { 'background-color': 'Canvas', ...border('CanvasText') },
      },
      {
        selector: `.${thumb}:not([data-disabled]):hover`,
        declarations: { ...border('Highlight') },
      },
      { selector: `.${thumb}:focus-visible`, declarations: { ...forcedFocusRing } },
      { selector: `.${thumb}[data-disabled]`, declarations: { ...border('GrayText') } },

      { selector: `.${mark}`, declarations: { 'background-color': 'CanvasText' } },
      { selector: IN_RANGE, declarations: { 'background-color': 'HighlightText' } },
      // The words say where a tick is, which is not a hint: `CanvasText`
      // rather than `GrayText`, whatever they were muted to in the ordinary
      // palette.
      { selector: `.${markLabel}`, declarations: { color: 'CanvasText' } },

      // Off, the scale says so with the rest. The opacity that dims it in the
      // ordinary palette is handed back above, so a part left in its live
      // colours is drawn live: the words under the ticks stayed `CanvasText`
      // beside a label in `GrayText`. A tick inside the span sits on a fill
      // that is `GrayText` now rather than `Highlight`, so it is cut out of it
      // in `Canvas` — `HighlightText` is for text on `Highlight`.
      { selector: `${OFF} .${mark}`, declarations: { 'background-color': 'GrayText' } },
      { selector: `${OFF} ${IN_RANGE}`, declarations: { 'background-color': 'Canvas' } },
      { selector: `${OFF} .${markLabel}`, declarations: { color: 'GrayText' } },
    ],
  };
})();
