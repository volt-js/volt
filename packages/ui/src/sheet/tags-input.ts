/**
 * Tags input — the styled half of `createTagsInput`, less the field and the
 * chips.
 *
 * The label, the line of help and the message are the field's, and so is the
 * box the tags and the text input share: it is a `.volt-field-control` like
 * an input's, and every state the field writes on it — invalid, pending,
 * disabled, read-only — is drawn by `field.ts`. Each tag is a `.volt-chip`,
 * drawn by `chip.ts`, so a bundle that takes this entry takes those two with
 * it. What is this entry's own is the row inside the box: the list the tags
 * wrap in, the text input after them stripped back to its caret, and two
 * states neither of the other sheets can see.
 *
 * The first is focus. The text input has no edge of its own, so a ring drawn
 * on it would be a rectangle floating inside the box; the ring goes on the
 * box instead, and only while the text input is what holds focus. A tag
 * holding focus draws its own ring, as `chip.ts` says it must, and the box
 * stays quiet around it — one ring at a time, on the thing the next key press
 * will act on.
 *
 * The second is the duplicate: the tag a refused entry collided with, which
 * the primitive marks so the row can point at it while the live region says
 * why nothing was added. For a sighted user it is the only sign that Enter
 * was refused rather than lost, so it is information, not emphasis: the tag
 * takes the chip's accent hue and a doubled edge, with the padding handed
 * back to pay for the edge so the row does not shift for a moment. Once the
 * palette is the user's, the edge keeps its width and takes `Highlight`.
 *
 * One state of the field's is drawn here as well, because the field's own
 * rule cannot reach it: read-only. `field.ts` draws it from `aria-readonly`,
 * which a `group` is not allowed to carry, so the component marks the box
 * `data-readonly` instead and this entry gives it the field's sunken surface.
 *
 * `data-full` on the box and the text input is not drawn. The primitive
 * refuses a tag past the limit without a word, and an edge that changed at
 * the limit would say the field is in a state to get out of, when the row is
 * exactly as long as it was allowed to be. A page that has a limit says so in
 * the line of help, where it is read before anyone reaches it.
 */

import type { ComponentStyles, Declarations } from '../css.js';
import { focusRing, forcedFocusRing } from './shared.js';

const root = 'volt-tags-input';
const list = 'volt-tags-input-list';
const tag = 'volt-tags-input-tag';
const input = 'volt-tags-input-input';
const status = 'volt-tags-input-status';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const tagsInputClasses = { root, list, tag, input, status } as const;

export const tagsInputStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /**
   * The box, by the role the primitive always writes on it.
   *
   * The attribute is there for specificity: the box's block padding is taken
   * back from the field's, which selects on one class, and a rule that is
   * only as specific would win or lose by where each entry lands in the
   * sheet — which a bundle taking a subset is free to change.
   */
  const BOX = `.${root}[role='group']`;
  /**
   * The box, while a press on it puts the caret in the text input. Apart from
   * `BOX`, so that the field's own cursor for a disabled control is not
   * outranked by a rule meant only for an enabled one.
   */
  const EDITABLE = `.${root}:not([aria-disabled='true'])`;
  /** The box, while the text input inside it is what holds focus. */
  const TYPING = `.${root}:has(.${input}:focus-visible)`;
  /**
   * The box, while the row is the user's to read but not to change. Said in
   * `data-readonly` rather than the `aria-readonly` the field's own rule
   * draws from: the box is a `group`, which ARIA does not let be read-only,
   * so the component keeps that for the text input and marks the box here.
   */
  const READ_ONLY = `.${root}[data-readonly]`;
  const DUPLICATE = `.${tag}[data-duplicate]`;

  const edges = (colour: string): Declarations => ({
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  /** The chip's padding on one axis, less what the doubled edge adds to it. */
  const inside = (space: string): string =>
    `calc(${space} - (var(--volt-border-width-2) - var(--volt-border-width-1)))`;

  return {
    name: 'tags-input',
    classes: tagsInputClasses,
    keyframes: [],

    rules: [
      {
        // The box's edge, fill and inline padding are the field's. This is
        // the row inside it: the list first, the text input after, both
        // wrapping. The block padding is half the field's, and the text input
        // takes the other half as its own, so an empty box is as tall as an
        // input's and a box with a line of tags in it is no taller.
        selector: BOX,
        declarations: {
          display: 'flex',
          'flex-wrap': 'wrap',
          'align-items': 'center',
          'row-gap': 'var(--volt-space-1)',
          'padding-block-start': 'var(--volt-space-1)',
          'padding-block-end': 'var(--volt-space-1)',
        },
      },
      {
        // A press in the space around the tags lands in the text input, so
        // the whole box says so, as the text input itself does. The tags and
        // their buttons keep the chip's own cursors.
        selector: EDITABLE,
        declarations: { cursor: 'text' },
      },
      { selector: TYPING, declarations: { ...focusRing } },
      {
        // The field's read-only surface, as `field.ts` draws it on a control
        // that may say `aria-readonly`: not disabled — the tags can still be
        // reached, read and copied — but not yours to change.
        selector: READ_ONLY,
        declarations: { 'background-color': 'var(--volt-color-surface-sunken)' },
      },

      {
        // A flex line of its own, so a long row wraps its tags here and the
        // text input drops below them rather than being squeezed between.
        selector: `.${list}`,
        declarations: {
          display: 'flex',
          'flex-wrap': 'wrap',
          'align-items': 'center',
          'row-gap': 'var(--volt-space-1)',
          'min-inline-size': '0',
          'max-inline-size': '100%',
        },
      },

      {
        // The space after a tag is the tag's, not a gap on the list: an empty
        // list has no tags and leaves no space, so the text input starts where
        // an input's text does.
        selector: `.${tag}`,
        declarations: { 'margin-inline-end': 'var(--volt-space-1)' },
      },
      {
        // The chip's accent tone — the hue in the words and the edge, on the
        // plain surface, where it keeps its contrast — with the edge doubled.
        selector: DUPLICATE,
        declarations: {
          'border-block-start-width': 'var(--volt-border-width-2)',
          'border-block-end-width': 'var(--volt-border-width-2)',
          'border-inline-start-width': 'var(--volt-border-width-2)',
          'border-inline-end-width': 'var(--volt-border-width-2)',
          'padding-block-start': inside('var(--volt-space-1)'),
          'padding-block-end': inside('var(--volt-space-1)'),
          'padding-inline-start': inside('var(--volt-space-3)'),
          'padding-inline-end': inside('var(--volt-space-3)'),
          ...edges('var(--volt-color-accent)'),
          color: 'var(--volt-color-accent)',
          'background-color': 'var(--volt-color-surface)',
        },
      },

      {
        // The browser's own input, taken back to a caret: no edge, no fill,
        // no ring, the box's type and colour. It takes what the tags leave on
        // their line, and a whole line when they leave too little. Its block
        // padding is the other half of the box's, which makes its line a
        // little taller than a tag, so the tags never stretch the box.
        selector: `.${input}`,
        declarations: {
          'box-sizing': 'border-box',
          'flex-grow': '1',
          'flex-shrink': '1',
          'flex-basis': 'var(--volt-space-20)',
          'min-inline-size': 'var(--volt-space-20)',
          'margin-block-start': '0',
          'margin-block-end': '0',
          'margin-inline-start': '0',
          'margin-inline-end': '0',
          'padding-block-start': 'var(--volt-space-1)',
          'padding-block-end': 'var(--volt-space-1)',
          'padding-inline-start': '0',
          'padding-inline-end': '0',
          'border-block-start-width': '0',
          'border-block-end-width': '0',
          'border-inline-start-width': '0',
          'border-inline-end-width': '0',
          'background-color': 'transparent',
          color: 'inherit',
          'font-family': 'inherit',
          'font-size': 'inherit',
          'line-height': 'inherit',
          // The ring is the box's, above.
          'outline-style': 'none',
        },
      },

      {
        // The polite live region that says what was added or removed. It is
        // rendered whether or not it has anything to say — a region that
        // appears together with its message announces nothing — so it has to
        // be there and not be seen, which is what this is.
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
      { selector: TYPING, declarations: { ...forcedFocusRing } },
      // As the field hands its read-only surface back to the palette.
      { selector: READ_ONLY, declarations: { 'background-color': 'Field' } },
      // The doubled edge stays from the rule above; the hue is the palette's
      // word for "this one", and the words and the fill are the page's.
      {
        selector: DUPLICATE,
        declarations: { ...edges('Highlight'), color: 'CanvasText', 'background-color': 'Canvas' },
      },
    ],
  };
})();
