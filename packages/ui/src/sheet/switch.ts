/**
 * Switch — the styled half of `createSwitch`.
 *
 * A track with a thumb in it, and the words that name it beside them. The
 * primitive writes `data-state` as `checked` or `unchecked` and `data-disabled`
 * when it is off, both on the control, and those are the only hooks these rules
 * select on — nothing here reads ARIA, which is there to be spoken rather than
 * styled against.
 *
 * Which way the switch is set is information, so it is said in three channels
 * rather than one: the track's fill, the thumb's fill, and where along the
 * track the thumb sits. The last is the one no palette can take away, which is
 * why the travel is drawn rather than implied by colour — a filled track and an
 * empty one that differ only in hue are the same track to a reader whose
 * palette flattens both.
 *
 * The thumb travels on `margin-inline-start`, not on a translation. A
 * translation is written along the physical inline axis and would run the wrong
 * way in a right-to-left page, and the one repair for that — a rule selecting
 * `[dir='rtl']` — is a selector this sheet does not allow itself, since every
 * compound here has to name a class the markup carries. The logical margin
 * follows the writing direction on its own.
 *
 * The track's inner box is exactly the thumb plus its travel: `--volt-space-8`
 * across, less a border and a pad on each side, leaves `--volt-space-4` of
 * thumb and `--volt-space-3` to move it. That is also why the forced-colours
 * rules that thicken the border give back the pad — the ring gets heavier, the
 * thumb still lands flush.
 */

import type { ComponentStyles } from '../css.js';
import { disabledLook, focusRing, forcedFocusRing, transition } from './shared.js';

const root = 'volt-switch';
const track = 'volt-switch-track';
const thumb = 'volt-switch-thumb';
const field = 'volt-switch-field';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const switchClasses = { root, track, thumb, field } as const;

export const switchStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const ON = `.${root}[data-state='checked']`;
  const OFF_CONTROL = `.${root}[data-disabled]`;

  const border = (colour: string) => ({
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  const borderWidth = (width: string) => ({
    'border-block-start-width': width,
    'border-block-end-width': width,
    'border-inline-start-width': width,
    'border-inline-end-width': width,
  });

  const pad = (value: string) => ({
    'padding-block-start': value,
    'padding-block-end': value,
    'padding-inline-start': value,
    'padding-inline-end': value,
  });

  const pill = {
    'border-start-start-radius': 'var(--volt-radius-full)',
    'border-start-end-radius': 'var(--volt-radius-full)',
    'border-end-start-radius': 'var(--volt-radius-full)',
    'border-end-end-radius': 'var(--volt-radius-full)',
  };

  return {
    name: 'switch',
    classes: switchClasses,
    keyframes: [],

    rules: [
      // The `<label>` around the control. Optional: it sets the type the words
      // are read in, and it is what makes a press on them count once.
      {
        selector: `.${field}`,
        declarations: {
          display: 'inline-flex',
          'align-items': 'center',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-normal)',
          color: 'var(--volt-color-on-surface)',
        },
      },

      {
        selector: `.${root}`,
        declarations: {
          display: 'inline-flex',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-2)',
          // The ring hugs the track when the control holds nothing else, and
          // rounds the whole row when the words are in it too.
          'border-start-start-radius': 'var(--volt-radius-1)',
          'border-start-end-radius': 'var(--volt-radius-1)',
          'border-end-start-radius': 'var(--volt-radius-1)',
          'border-end-end-radius': 'var(--volt-radius-1)',
          cursor: 'pointer',
        },
      },

      { selector: `.${root}:focus-visible`, declarations: { ...focusRing } },

      { selector: OFF_CONTROL, declarations: { ...disabledLook } },

      {
        selector: `.${track}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-flex',
          'align-items': 'center',
          'flex-shrink': '0',
          'inline-size': 'var(--volt-space-8)',
          'block-size': 'var(--volt-space-5)',
          ...borderWidth('var(--volt-border-width-1)'),
          'border-block-start-style': 'solid',
          'border-block-end-style': 'solid',
          'border-inline-start-style': 'solid',
          'border-inline-end-style': 'solid',
          ...border('var(--volt-color-border-strong)'),
          ...pad('var(--volt-border-width-1)'),
          ...pill,
          'background-color': 'var(--volt-color-surface-sunken)',
          ...transition('background-color, border-color'),
        },
      },
      {
        selector: `${ON} .${track}`,
        declarations: {
          'background-color': 'var(--volt-color-accent)',
          ...border('var(--volt-color-accent)'),
        },
      },

      {
        selector: `.${thumb}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'center',
          'flex-shrink': '0',
          'inline-size': 'var(--volt-space-4)',
          'block-size': 'var(--volt-space-4)',
          ...pill,
          'background-color': 'var(--volt-color-border-strong)',
          color: 'var(--volt-color-surface)',
          'font-size': 'var(--volt-font-size-1)',
          'line-height': 'var(--volt-line-height-tight)',
          'margin-inline-start': '0',
          ...transition('margin-inline-start, background-color'),
        },
      },
      {
        selector: `${ON} .${thumb}`,
        declarations: {
          'margin-inline-start': 'var(--volt-space-3)',
          'background-color': 'var(--volt-color-on-accent)',
          color: 'var(--volt-color-accent)',
        },
      },
    ],

    forcedColors: [
      { selector: `.${field}`, declarations: { color: 'CanvasText' } },

      // `Field` and `FieldText` rather than `Canvas`: this is an input, and the
      // forced palette keeps a separate pair for the things a user sets.
      {
        selector: `.${track}`,
        declarations: { 'background-color': 'Field', ...border('FieldText') },
      },
      { selector: `.${thumb}`, declarations: { 'background-color': 'FieldText', color: 'Field' } },

      // A switch that is on differs from one that is off by its fill, and fill
      // is what this mode flattens. The ring round the track doubles — a
      // difference in shape, which no palette can repaint — and the pad is
      // handed back in the same breath so the track's inner box is the width it
      // was and the thumb still comes to rest flush with the end.
      {
        selector: `${ON} .${track}`,
        declarations: {
          'background-color': 'Highlight',
          ...border('Highlight'),
          ...borderWidth('var(--volt-border-width-2)'),
          ...pad('0'),
        },
      },
      {
        selector: `${ON} .${thumb}`,
        declarations: { 'background-color': 'HighlightText', color: 'Highlight' },
      },

      // After the two above, so that a switch which is both on and unavailable
      // is drawn as unavailable: these carry the same weight, and the last one
      // written is the one that wins.
      { selector: OFF_CONTROL, declarations: { color: 'GrayText', opacity: '1' } },
      { selector: `${OFF_CONTROL} .${track}`, declarations: { ...border('GrayText') } },
      { selector: `${OFF_CONTROL} .${thumb}`, declarations: { 'background-color': 'GrayText' } },

      { selector: `.${root}:focus-visible`, declarations: { ...forcedFocusRing } },
    ],
  };
})();
