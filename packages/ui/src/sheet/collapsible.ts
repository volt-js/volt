/**
 * Collapsible — the styled half of `createCollapsible`.
 *
 * One section of an accordion, standing on its own: the trigger and the panel
 * take an accordion's type and spacing, so a page holding both does not draw
 * one idea in two sizes. It adds what an accordion does without — a marker at
 * the end of the trigger that turns as it opens — because a lone section has
 * no rules around it to say it is one. The primitive writes `data-state`
 * as `open` or `closed` on the trigger and the panel, and `data-disabled` on
 * both while the section is off. It keeps a closing panel mounted until the
 * animation it started has finished, which is what makes a collapse
 * animatable at all.
 *
 * Whether the section is open is information, not decoration, and the sheet
 * says it twice. The marker turns — a rotation, which a forced palette leaves
 * alone — and the panel is there or it is not. Neither is carried by a colour.
 *
 * The height comes from the primitive rather than from here.
 * `--volt-collapsible-height` is the panel's measured content height, taken in
 * the measure lane and published on the element; `auto` does not interpolate,
 * so without a real number there is nothing to animate between. `contract.ts`
 * names it for that reason.
 */

import type { ComponentStyles } from '../css.js';
import { animation, focusRing, forcedFocusRing, transition } from './shared.js';

const root = 'volt-collapsible';
const trigger = 'volt-collapsible-trigger';
const indicator = 'volt-collapsible-indicator';
const panel = 'volt-collapsible-panel';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const collapsibleClasses = { root, trigger, indicator, panel } as const;

export const collapsibleStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const OPEN = `.${trigger}[data-state='open']`;
  const DISABLED = `.${trigger}[data-disabled]`;
  const CLIP = { 'overflow-x': 'hidden', 'overflow-y': 'hidden' };

  return {
    name: 'collapsible',
    classes: collapsibleClasses,

    // The clip rides on the animations rather than on the panel. It is only
    // needed while the height runs between zero and the measured number, and
    // left on the panel at rest it cuts the focus ring off anything inside
    // that sits against an edge. `hidden` rather than `clip`: the primitive
    // measures `scrollHeight` again as the panel resizes, which is every frame
    // of the animation, and a box that clips reports the height it is clipped
    // to — the animation would be fed its own output and stop short.
    keyframes: [
      {
        name: 'volt-collapsible-expand',
        steps: [
          { offset: 'from', declarations: { 'block-size': '0', ...CLIP } },
          {
            offset: 'to',
            declarations: { 'block-size': 'var(--volt-collapsible-height)', ...CLIP },
          },
        ],
      },
      {
        name: 'volt-collapsible-collapse',
        steps: [
          {
            offset: 'from',
            declarations: { 'block-size': 'var(--volt-collapsible-height)', ...CLIP },
          },
          { offset: 'to', declarations: { 'block-size': '0', ...CLIP } },
        ],
      },
    ],

    rules: [
      { selector: `.${root}`, declarations: { display: 'block' } },

      {
        // A row the width of the section, so the whole line is the target and
        // the marker sits at the far end of it, where an accordion has its own.
        selector: `.${trigger}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'flex',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-2)',
          'inline-size': '100%',
          'padding-block-start': 'var(--volt-space-3)',
          'padding-block-end': 'var(--volt-space-3)',
          'padding-inline-start': 'var(--volt-space-2)',
          'padding-inline-end': 'var(--volt-space-2)',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'font-weight': 'var(--volt-font-weight-medium)',
          'line-height': 'var(--volt-line-height-normal)',
          color: 'var(--volt-color-on-surface)',
          'background-color': 'transparent',
          'border-block-start-width': '0',
          'border-block-end-width': '0',
          'border-inline-start-width': '0',
          'border-inline-end-width': '0',
          'text-align': 'start',
          cursor: 'pointer',
        },
      },
      { selector: `.${trigger}:focus-visible`, declarations: { ...focusRing } },
      {
        // Muted rather than dimmed, as an accordion's heading is: the trigger
        // stays reachable and read out, and it is the words that say it is off.
        selector: DISABLED,
        declarations: {
          color: 'var(--volt-color-on-surface-muted)',
          cursor: 'default',
        },
      },

      {
        // A chevron, drawn from two borders of a rotated square, because the
        // sheet has no pseudo-elements to hang one on. It points down and up
        // rather than along the line: a turn towards the end of the line would
        // have to turn the other way in a right-to-left page, and a rotation
        // does not mirror with the text around it.
        //
        // The two edges are physical where the rest of the sheet is logical,
        // for the same reason. `rotate` turns the square the same way whichever
        // way the text runs, so the edges it turns have to stay put as well:
        // `border-inline-end` is the left edge in a right-to-left page, and
        // turned the same 45 degrees it points the chevron left and right —
        // back and next, rather than shut and open.
        //
        // `margin-inline-start: auto` rather than spacing the row out: whatever
        // a caller writes into the trigger stays together at the start, however
        // many pieces it is in, and the marker alone goes to the end.
        selector: `.${indicator}`,
        declarations: {
          'box-sizing': 'border-box',
          'flex-shrink': '0',
          'margin-inline-start': 'auto',
          'inline-size': 'var(--volt-space-2)',
          'block-size': 'var(--volt-space-2)',
          'border-bottom-width': 'var(--volt-border-width-2)',
          'border-right-width': 'var(--volt-border-width-2)',
          'border-bottom-style': 'solid',
          'border-right-style': 'solid',
          'border-bottom-color': 'var(--volt-color-on-surface-muted)',
          'border-right-color': 'var(--volt-color-on-surface-muted)',
          rotate: '45deg',
          translate: '0 -25%',
          ...transition('rotate, translate'),
        },
      },
      { selector: `${OPEN} .${indicator}`, declarations: { rotate: '225deg', translate: '0 25%' } },

      {
        // A formatting context of its own, which the clip used to give it: a
        // margin inside stays inside, so the height measured at rest is the
        // height a collapse starts from, and an expand does not jump by a
        // margin as it ends. Nothing here pads it: padding would be left
        // standing at zero height, a strip under a shut section.
        selector: `.${panel}`,
        declarations: {
          display: 'flow-root',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-normal)',
          color: 'var(--volt-color-on-surface)',
        },
      },
      // Backwards only. Filling forwards would hold the panel at the height
      // measured as it opened, and clip whatever grew inside it afterwards;
      // once the animation has run the panel goes back to the height of its
      // content.
      {
        selector: `.${panel}[data-state='open']`,
        declarations: {
          ...animation('volt-collapsible-expand', 'fast'),
          'animation-fill-mode': 'backwards',
        },
      },
      {
        selector: `.${panel}[data-state='closed']`,
        declarations: { ...animation('volt-collapsible-collapse', 'fast') },
      },
    ],

    forcedColors: [
      { selector: `.${trigger}`, declarations: { color: 'ButtonText' } },
      { selector: `.${trigger}:focus-visible`, declarations: { ...forcedFocusRing } },
      {
        selector: `.${indicator}`,
        declarations: {
          'border-bottom-color': 'ButtonText',
          'border-right-color': 'ButtonText',
        },
      },
      // Grey is what a forced palette has to say about unavailability, and the
      // muted colour above is one of the first things it takes away — from
      // the words and from the marker beside them alike.
      { selector: DISABLED, declarations: { color: 'GrayText' } },
      {
        selector: `${DISABLED} .${indicator}`,
        declarations: {
          'border-bottom-color': 'GrayText',
          'border-right-color': 'GrayText',
        },
      },
    ],
  };
})();
