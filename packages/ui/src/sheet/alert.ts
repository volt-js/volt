/**
 * Alert — the styled half of `createAlert`.
 *
 * Two elements, and the split is the whole shape of this file. The outer one
 * is the live region, and it is on the page whether there is anything to say
 * or not — that is what makes an announcement arrive as a change inside a
 * region rather than as a region and a sentence at once. So nothing is drawn
 * on it: a box, a border or a padding there would be a box on screen between
 * messages, and `display: none` would take the region out of the tree the
 * announcement has to reach. Every line and colour here is on the message
 * inside it, which comes and goes with the alert.
 *
 * Severity is information, and colour is the channel a forced palette spends
 * first: four hues down one edge come out of a user's palette as one hue. So
 * the same edge carries a border style per severity — geometry, which
 * survives — and the component draws a glyph per severity beside the words,
 * which is content and survives any palette at all. The toast answers the
 * same question the same way, and the two answers are written out twice on
 * purpose: the CLI copies one component into a consumer's repository at a
 * time, and a rule living in another component's file is a dependency their
 * copy would carry without being able to see it.
 *
 * Nothing here floats. An alert sits in the layout it was written in, so it
 * casts no shadow and needs none of what a panel over the page needs — and an
 * alert that cast one would be claiming to be a toast.
 */

import type { ComponentStyles } from '../css.js';
import { animation } from './shared.js';

const root = 'volt-alert';
const message = 'volt-alert-message';
const icon = 'volt-alert-icon';
const content = 'volt-alert-content';
const title = 'volt-alert-title';
const description = 'volt-alert-description';
const actions = 'volt-alert-actions';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const alertClasses = {
  root,
  message,
  icon,
  content,
  title,
  description,
  actions,
} as const;

export const alertStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /** The edge a severity is drawn down, and the mark drawn beside the words. */
  const edge = (severity: string) => `.${root}[data-severity='${severity}'] .${message}`;
  const mark = (severity: string) => `.${root}[data-severity='${severity}'] .${icon}`;

  return {
    name: 'alert',
    classes: alertClasses,

    keyframes: [
      // Entry only. An exit would have to outlive the message, and the message
      // is what the primitive hides the moment the alert closes — see the
      // component on why that flag is worth more than an animation.
      {
        name: 'volt-alert-in',
        steps: [
          {
            offset: 'from',
            declarations: { opacity: '0', translate: '0 calc(var(--volt-space-1) * -1)' },
          },
          { offset: 'to', declarations: { opacity: '1', translate: '0 0' } },
        ],
      },
    ],

    rules: [
      // The region, and the one thing said about it: it is a block, and it is
      // empty between messages, so it takes no height of its own.
      { selector: `.${root}`, declarations: { display: 'block' } },

      {
        selector: `.${message}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'flex',
          // The mark and the dismiss sit on the first line of the words rather
          // than in the middle of a paragraph that may be four lines long.
          'align-items': 'flex-start',
          'column-gap': 'var(--volt-space-3)',
          'padding-block-start': 'var(--volt-space-3)',
          'padding-block-end': 'var(--volt-space-3)',
          'padding-inline-start': 'var(--volt-space-4)',
          'padding-inline-end': 'var(--volt-space-4)',
          'border-width': 'var(--volt-border-width-1)',
          'border-style': 'solid',
          'border-color': 'var(--volt-color-border)',
          'border-inline-start-width': 'var(--volt-border-width-4)',
          'border-inline-start-style': 'solid',
          'border-inline-start-color': 'var(--volt-color-info)',
          'border-radius': 'var(--volt-radius-2)',
          'background-color': 'var(--volt-color-surface)',
          color: 'var(--volt-color-on-surface)',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-normal)',
        },
      },
      // The primitive marks the message `hidden` until writing into the region
      // would actually be heard. `hidden` is nothing but a `display: none` in
      // the user agent's stylesheet, and an author rule outranks that whatever
      // its specificity — so the `display: flex` above would put the box back
      // on screen, and back in the accessibility tree, for the whole settling
      // wait. The region and its first sentence would then arrive in one
      // mutation, which is the one thing the two elements exist to prevent.
      { selector: `.${message}[hidden]`, declarations: { display: 'none' } },
      {
        selector: `.${message}[data-state='open']`,
        declarations: { ...animation('volt-alert-in') },
      },

      // Severity, in colour, for everyone whose palette is the sheet's.
      {
        selector: edge('success'),
        declarations: { 'border-inline-start-color': 'var(--volt-color-success)' },
      },
      {
        selector: edge('warning'),
        declarations: { 'border-inline-start-color': 'var(--volt-color-warning)' },
      },
      {
        selector: edge('danger'),
        declarations: { 'border-inline-start-color': 'var(--volt-color-danger)' },
      },

      {
        // A fixed box so that the mark sits on the first line whatever glyph
        // or icon is in it, and one that does not shrink when the words are
        // long.
        selector: `.${icon}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'flex',
          'flex-shrink': '0',
          'align-items': 'center',
          'justify-content': 'center',
          'inline-size': 'var(--volt-space-5)',
          'block-size': 'var(--volt-space-5)',
          'font-size': 'var(--volt-font-size-2)',
          'font-weight': 'var(--volt-font-weight-semibold)',
          'line-height': 'var(--volt-line-height-tight)',
          color: 'var(--volt-color-info)',
        },
      },
      { selector: mark('success'), declarations: { color: 'var(--volt-color-success)' } },
      { selector: mark('warning'), declarations: { color: 'var(--volt-color-warning)' } },
      { selector: mark('danger'), declarations: { color: 'var(--volt-color-danger)' } },

      {
        selector: `.${content}`,
        declarations: {
          'flex-grow': '1',
          // A flex item will not shrink past its contents without this, so one
          // long unbroken word would push the dismiss off the end of the box.
          'min-inline-size': '0',
        },
      },
      {
        selector: `.${title}`,
        declarations: {
          'margin-block-start': '0',
          'margin-block-end': '0',
          'font-size': 'var(--volt-font-size-2)',
          'font-weight': 'var(--volt-font-weight-semibold)',
          'line-height': 'var(--volt-line-height-tight)',
          color: 'var(--volt-color-on-surface)',
        },
      },
      {
        selector: `.${description}`,
        declarations: { color: 'var(--volt-color-on-surface-muted)' },
      },
      // Only under a title. The body is the whole message when there is no
      // heading over it, and a gap above the only line reads as a missing one.
      {
        selector: `.${title} + .${description}`,
        declarations: { 'margin-block-start': 'var(--volt-space-1)' },
      },
      {
        selector: `.${actions}`,
        declarations: {
          display: 'flex',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-2)',
          'margin-block-start': 'var(--volt-space-3)',
        },
      },
    ],

    forcedColors: [
      {
        selector: `.${message}`,
        declarations: {
          'background-color': 'Canvas',
          color: 'CanvasText',
          'border-color': 'CanvasText',
          'border-inline-start-color': 'CanvasText',
        },
      },
      // One border style per severity, on the edge that carried the colour.
      // Four marks told apart at a glance and at four pixels wide: a solid
      // bar, a split bar, a broken bar, and dots.
      {
        selector: edge('success'),
        declarations: { 'border-inline-start-style': 'double' },
      },
      {
        selector: edge('warning'),
        declarations: { 'border-inline-start-style': 'dashed' },
      },
      {
        selector: edge('danger'),
        declarations: { 'border-inline-start-style': 'dotted' },
      },

      // The mark keeps its shape and gives up its colour. Restated at the
      // depth the hues were written at as well as at the part's own: a rule
      // naming the severity is the more specific of the two, so the one that
      // says what the forced palette gets has to name it too or the sheet's
      // own blue would be what the rule left standing.
      { selector: `.${icon}`, declarations: { color: 'CanvasText' } },
      { selector: mark('success'), declarations: { color: 'CanvasText' } },
      { selector: mark('warning'), declarations: { color: 'CanvasText' } },
      { selector: mark('danger'), declarations: { color: 'CanvasText' } },

      { selector: `.${title}`, declarations: { color: 'CanvasText' } },
      { selector: `.${description}`, declarations: { color: 'CanvasText' } },
    ],
  };
})();
