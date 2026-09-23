/**
 * Stepper — the styled half of `createStepper`.
 *
 * The primitive writes `data-status` on every step as `complete`, `current`,
 * `upcoming` or `error`; `aria-current="step"` on the one the user is on;
 * `aria-disabled` on a step that cannot be selected; `data-disabled` on the
 * ones that cannot be used at all; and `data-orientation` on the list and on
 * each separator. Panels are hidden with the `hidden` attribute rather than
 * unmounted, which is why nothing here gives a panel a `display`: any value
 * at all would beat `hidden` and show every panel at once.
 *
 * Where the user is in the flow is the whole of what a stepper says, so each
 * status is drawn in a shape as well as a colour, and the shape is what a
 * forced palette leaves standing:
 *
 * - **complete** — a filled marker, its number replaced by a check;
 * - **current** — a marker with a ring twice as thick, and the label in bold;
 * - **not reached yet** — a marker whose ring is dashed, on a step the flow
 *   will not let the user select;
 * - **error** — the label underlined with a wave, and the marker's number
 *   given over to the `!` the component writes there.
 *
 * Current is read from `aria-current` rather than from `data-status`, because
 * the primitive reports an errored step as `error` even while the user is on
 * it — and a step that is both still has to look like the one they are on.
 *
 * The step is a `<button>` as often as not, which arrives with a border and a
 * background of the browser's own, so both are taken away here: the marker is
 * the only edge a step draws.
 */

import type { ComponentStyles } from '../css.js';
import { ENABLED, disabledLook, focusRing, forcedFocusRing, transition } from './shared.js';

const root = 'volt-stepper';
const list = 'volt-stepper-list';
const item = 'volt-stepper-item';
const step = 'volt-stepper-step';
const marker = 'volt-stepper-marker';
const number = 'volt-stepper-number';
const check = 'volt-stepper-check';
const text = 'volt-stepper-text';
const label = 'volt-stepper-label';
const description = 'volt-stepper-description';
const status = 'volt-stepper-status';
const separator = 'volt-stepper-separator';
const panel = 'volt-stepper-panel';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const stepperClasses = {
  root,
  list,
  item,
  step,
  marker,
  number,
  check,
  text,
  label,
  description,
  status,
  separator,
  panel,
} as const;

export const stepperStyles = /* @__PURE__ */ ((): ComponentStyles => {
  const CURRENT = `.${step}[aria-current='step']`;
  const COMPLETE = `.${step}[data-status='complete']`;
  const ERROR = `.${step}[data-status='error']`;
  /** Refused by the flow: not reached yet, or not usable at all. */
  const REFUSED = `.${step}[aria-disabled='true']`;
  /** The pointer is on it, and pressing it would move the user there. */
  const HOVERED = `.${step}${ENABLED}:not([aria-current='step']):hover`;
  /** The line after a finished step, which is the part of the way already walked. */
  const WALKED = `${COMPLETE} + .${separator}`;

  const edges = (value: string, part: 'width' | 'style' | 'color') => ({
    [`border-block-start-${part}`]: value,
    [`border-block-end-${part}`]: value,
    [`border-inline-start-${part}`]: value,
    [`border-inline-end-${part}`]: value,
  });

  const radius = (token: string) => ({
    'border-start-start-radius': token,
    'border-start-end-radius': token,
    'border-end-start-radius': token,
    'border-end-end-radius': token,
  });

  const flat = (property: 'margin' | 'padding') => ({
    [`${property}-block-start`]: '0',
    [`${property}-block-end`]: '0',
    [`${property}-inline-start`]: '0',
    [`${property}-inline-end`]: '0',
  });

  /**
   * Both edges a separator can draw, because only the one its orientation
   * gave a width is seen: the block-start edge runs across a horizontal list,
   * the inline-start edge down a vertical one.
   */
  const line = (property: 'style' | 'color', value: string) => ({
    [`border-block-start-${property}`]: value,
    [`border-inline-start-${property}`]: value,
  });

  return {
    name: 'stepper',
    classes: stepperClasses,
    keyframes: [],

    rules: [
      {
        selector: `.${root}`,
        declarations: {
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-tight)',
          color: 'var(--volt-color-on-surface)',
        },
      },

      {
        selector: `.${list}`,
        declarations: {
          display: 'flex',
          'flex-direction': 'row',
          'align-items': 'center',
          'flex-wrap': 'wrap',
          'column-gap': 'var(--volt-space-2)',
          'row-gap': 'var(--volt-space-2)',
          ...flat('margin'),
          ...flat('padding'),
          'list-style-type': 'none',
        },
      },
      {
        selector: `.${list}[data-orientation='vertical']`,
        declarations: {
          'flex-direction': 'column',
          'align-items': 'stretch',
          'row-gap': 'var(--volt-space-1)',
        },
      },

      // Every step but the last grows, and the separator inside it takes the
      // room, so the steps spread across the list with a line between each.
      //
      // No step shrinks below what it draws. A step that could — at
      // `min-inline-size: 0` — was narrower than its own button at the width
      // of a phone, so the button ran on over its line and into the next step,
      // and the page scrolled sideways. What does not fit on the row wraps to
      // the next one instead, with the line it ends on leading there.
      {
        selector: `.${item}`,
        declarations: {
          display: 'flex',
          'flex-direction': 'row',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-2)',
          'flex-grow': '1',
        },
      },
      { selector: `.${item}:last-child`, declarations: { 'flex-grow': '0' } },
      {
        selector: `.${list}[data-orientation='vertical'] .${item}`,
        declarations: {
          'flex-direction': 'column',
          'align-items': 'flex-start',
          'row-gap': 'var(--volt-space-1)',
          'flex-grow': '0',
        },
      },

      {
        selector: `.${step}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-flex',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-2)',
          'padding-block-start': 'var(--volt-space-1)',
          'padding-block-end': 'var(--volt-space-1)',
          'padding-inline-start': 'var(--volt-space-2)',
          'padding-inline-end': 'var(--volt-space-2)',
          ...flat('margin'),
          ...edges('0', 'width'),
          ...radius('var(--volt-radius-1)'),
          'background-color': 'transparent',
          color: 'var(--volt-color-on-surface-muted)',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'font-weight': 'var(--volt-font-weight-medium)',
          'line-height': 'var(--volt-line-height-tight)',
          'text-align': 'start',
          cursor: 'pointer',
          ...transition('color, background-color'),
        },
      },
      {
        selector: HOVERED,
        declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
      },
      { selector: `.${step}:focus-visible`, declarations: { ...focusRing } },
      {
        selector: COMPLETE,
        declarations: { color: 'var(--volt-color-on-surface)' },
      },
      {
        selector: CURRENT,
        declarations: {
          color: 'var(--volt-color-on-surface)',
          'font-weight': 'var(--volt-font-weight-semibold)',
        },
      },
      // Still focusable — the arrow keys reach a step the flow refuses, so a
      // keyboard user can read ahead — and the pointer is told the same.
      { selector: REFUSED, declarations: { cursor: 'not-allowed' } },
      { selector: `.${step}[data-disabled]`, declarations: { ...disabledLook } },

      {
        selector: `.${marker}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'center',
          'flex-shrink': '0',
          'inline-size': 'var(--volt-space-6)',
          'block-size': 'var(--volt-space-6)',
          ...edges('var(--volt-border-width-1)', 'width'),
          ...edges('solid', 'style'),
          ...edges('var(--volt-color-border-strong)', 'color'),
          ...radius('var(--volt-radius-full)'),
          'background-color': 'var(--volt-color-surface)',
          color: 'var(--volt-color-on-surface-muted)',
          'font-size': 'var(--volt-font-size-1)',
          'font-weight': 'var(--volt-font-weight-medium)',
          'font-variant-numeric': 'tabular-nums',
          'line-height': '1',
          ...transition('background-color, border-color, color'),
        },
      },
      {
        selector: `${CURRENT} .${marker}`,
        declarations: {
          ...edges('var(--volt-border-width-2)', 'width'),
          ...edges('var(--volt-color-accent)', 'color'),
          color: 'var(--volt-color-accent)',
        },
      },
      {
        selector: `${COMPLETE} .${marker}`,
        declarations: {
          ...edges('var(--volt-color-accent)', 'color'),
          'background-color': 'var(--volt-color-accent)',
          color: 'var(--volt-color-on-accent)',
        },
      },
      // After the current step's rule, so an errored step the user is on
      // keeps the thicker ring and takes the error's colour.
      {
        selector: `${ERROR} .${marker}`,
        declarations: {
          ...edges('var(--volt-color-danger)', 'color'),
          'background-color': 'var(--volt-color-danger-muted)',
          color: 'var(--volt-color-danger)',
        },
      },
      {
        selector: `${REFUSED} .${marker}`,
        declarations: { ...edges('dashed', 'style') },
      },

      { selector: `${COMPLETE} .${number}`, declarations: { display: 'none' } },

      {
        // A check, drawn from two borders of a rotated box, because the sheet
        // has no pseudo-elements to hang one on. `currentColor`, so it is
        // whatever the marker's text is — which the forced palette sets too.
        //
        // The two edges are physical where the rest of the sheet is logical.
        // `rotate` turns the box the same way whichever way the text runs, so
        // the edges it turns have to stay put as well: `border-inline-end` is
        // the left edge in a right-to-left page, and turned the same 45
        // degrees it draws a `<` — a finished step marked with a back arrow.
        selector: `.${check}`,
        declarations: {
          display: 'none',
          'box-sizing': 'border-box',
          'inline-size': 'calc(var(--volt-space-1) * 1.5)',
          'block-size': 'var(--volt-space-3)',
          'border-bottom-width': 'var(--volt-border-width-2)',
          'border-right-width': 'var(--volt-border-width-2)',
          'border-bottom-style': 'solid',
          'border-right-style': 'solid',
          'border-bottom-color': 'currentColor',
          'border-right-color': 'currentColor',
          rotate: '45deg',
          translate: '0 -15%',
        },
      },
      { selector: `${COMPLETE} .${check}`, declarations: { display: 'block' } },

      {
        selector: `.${text}`,
        declarations: {
          display: 'flex',
          'flex-direction': 'column',
          'row-gap': 'var(--volt-space-1)',
          'min-inline-size': '0',
        },
      },
      {
        // The wave is the error's shape: it stays when the palette takes the
        // red away, and it reads as "something here is wrong" in any language.
        selector: `${ERROR} .${label}`,
        declarations: {
          color: 'var(--volt-color-danger)',
          'text-decoration-line': 'underline',
          'text-decoration-style': 'wavy',
          'text-decoration-color': 'var(--volt-color-danger)',
        },
      },
      {
        selector: `.${description}`,
        declarations: {
          'font-size': 'var(--volt-font-size-1)',
          'font-weight': 'var(--volt-font-weight-regular)',
          color: 'var(--volt-color-on-surface-muted)',
        },
      },

      {
        // The status in words, inside the step, for the one reader who cannot
        // see the marker it describes. There and not seen.
        selector: `.${status}`,
        declarations: {
          position: 'absolute',
          'inline-size': '1px',
          'block-size': '1px',
          'margin-block-start': '-1px',
          'margin-block-end': '-1px',
          'margin-inline-start': '-1px',
          'margin-inline-end': '-1px',
          ...flat('padding'),
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          'clip-path': 'inset(50%)',
          'white-space': 'nowrap',
          ...edges('0', 'width'),
        },
      },

      {
        selector: `.${separator}`,
        declarations: {
          display: 'block',
          'box-sizing': 'border-box',
          'flex-grow': '1',
          'min-inline-size': 'var(--volt-space-4)',
          'block-size': '0',
          'border-block-start-width': 'var(--volt-border-width-1)',
          'border-block-end-width': '0',
          'border-inline-start-width': '0',
          'border-inline-end-width': '0',
          // Dashed until the step before it is done: the way ahead, drawn the
          // way the markers of the steps not reached are.
          ...line('style', 'dashed'),
          ...line('color', 'var(--volt-color-border-strong)'),
          ...transition('border-color'),
        },
      },
      {
        // Down from the middle of the marker above it: the step's inline
        // padding, then half the marker, less half the line's own width.
        selector: `.${separator}[data-orientation='vertical']`,
        declarations: {
          'flex-grow': '0',
          'min-inline-size': '0',
          'inline-size': '0',
          'block-size': 'var(--volt-space-4)',
          'margin-inline-start':
            'calc(var(--volt-space-2) + var(--volt-space-3) - var(--volt-border-width-1) / 2)',
          'border-block-start-width': '0',
          'border-inline-start-width': 'var(--volt-border-width-1)',
        },
      },
      {
        selector: WALKED,
        declarations: {
          ...line('style', 'solid'),
          ...line('color', 'var(--volt-color-accent)'),
        },
      },

      {
        selector: `.${panel}`,
        declarations: {
          'padding-block-start': 'var(--volt-space-4)',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-normal)',
          color: 'var(--volt-color-on-surface)',
        },
      },
    ],

    forcedColors: [
      { selector: `.${root}`, declarations: { color: 'CanvasText' } },
      { selector: `.${step}`, declarations: { color: 'CanvasText' } },
      // Hover is drawn in a fill, which the palette would pick for itself. The
      // fill is handed back and an underline takes its place — apart from the
      // error's, which is a wave.
      { selector: HOVERED, declarations: { 'background-color': 'Canvas' } },
      { selector: `${HOVERED} .${label}`, declarations: { 'text-decoration-line': 'underline' } },
      { selector: `.${step}:focus-visible`, declarations: { ...forcedFocusRing } },

      {
        selector: `.${marker}`,
        declarations: {
          ...edges('CanvasText', 'color'),
          'background-color': 'Canvas',
          color: 'CanvasText',
        },
      },
      // The thicker ring is what says "you are here" whatever the palette is;
      // `Highlight` puts the colour back out of the user's own.
      {
        selector: `${CURRENT} .${marker}`,
        declarations: { ...edges('Highlight', 'color'), color: 'Highlight' },
      },
      // A fill is the first thing this mode takes, so it is named: the
      // palette's own pair for something chosen, with the check in the text
      // colour that is legible on it.
      {
        selector: `${COMPLETE} .${marker}`,
        declarations: {
          ...edges('Highlight', 'color'),
          'background-color': 'Highlight',
          color: 'HighlightText',
        },
      },
      {
        selector: `${ERROR} .${marker}`,
        declarations: {
          ...edges('CanvasText', 'color'),
          'background-color': 'Canvas',
          color: 'CanvasText',
        },
      },
      {
        selector: `${ERROR} .${label}`,
        declarations: { color: 'CanvasText', 'text-decoration-color': 'CanvasText' },
      },
      // Not usable yet, which is the palette's `GrayText` — while the dashed
      // ring, which is a shape, says it without the colour.
      { selector: REFUSED, declarations: { color: 'GrayText' } },
      {
        selector: `${REFUSED} .${marker}`,
        declarations: { ...edges('GrayText', 'color'), color: 'GrayText' },
      },
      // Unless it is complete — done somewhere else, ahead of a step that is
      // not — whose fill is `Highlight`, and whose check is legible on it only
      // in the colour the palette pairs with it. The dashed ring still says the
      // flow will not go there.
      {
        selector: `${COMPLETE}[aria-disabled='true'] .${marker}`,
        declarations: { color: 'HighlightText' },
      },
      { selector: `.${step}[data-disabled]`, declarations: { color: 'GrayText', opacity: '1' } },
      // The step's colour, whichever of the three above it has.
      { selector: `.${description}`, declarations: { color: 'inherit' } },

      { selector: `.${separator}`, declarations: { ...line('color', 'CanvasText') } },
      { selector: WALKED, declarations: { ...line('color', 'Highlight') } },

      { selector: `.${panel}`, declarations: { color: 'CanvasText' } },
    ],
  };
})();
