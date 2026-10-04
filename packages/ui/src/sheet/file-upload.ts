/**
 * File upload — the styled half of `createFileUpload`.
 *
 * A drop zone, the line of help and the message under it, and a row per file.
 * The primitive writes what it knows on each part, and the rules select on
 * four of those and nothing else: `data-dragging` on the zone, `aria-disabled`
 * on the zone and a row's buttons, `data-state` on the field's message, and
 * `data-error` on a row once its file has a reason it was not sent, holding
 * that reason's code. A row's
 * `data-status` and `data-progress` are there for a page's own rules; where a
 * file is, this sheet leaves to the words in the row and to its bar.
 *
 * A row's bar is not drawn here. It is `createProgress` underneath, so it
 * wears `<v-progress>`'s classes and that entry's rules, which already say
 * finished in a colour a forced palette keeps; a sheet built from a subset
 * needs `progressStyles` beside this one, or every bar is an empty box.
 *
 * The zone's edge is dashed, which is the convention that says "put something
 * here", and it thickens while a drag is over it. The thickening is the part
 * that carries the state: a colour change alone is what a forced palette takes
 * away, a width is not. The padding gives back what the edge takes, so the
 * zone does not grow under the pointer at the moment it is being aimed at.
 *
 * A file that failed — refused before it was sent, or sent and refused by the
 * server — is drawn the way the alert draws danger, and the field's message is
 * drawn the same way: a thick edge down the start of the box, in the danger
 * colour, which a forced palette turns into dots. The words beside it are what
 * say what went wrong; the edge is what makes a failure findable in a list of
 * forty files at a glance. The message's box is drawn only while there is a
 * message: the element is a live region and is on the page throughout, and a
 * bordered box with nothing in it would be a box on screen between failures.
 *
 * Nothing styles the native input. The component hides it inline, the way
 * every primitive that keeps a native control hides one, so it stays in the
 * page — an input the platform cannot render has nowhere to point when it
 * refuses a submit.
 */

import type { ComponentStyles, Declarations } from '../css.js';
import {
  disabledLook,
  focusRing,
  forcedDisabled,
  forcedFocusRing,
  transition,
} from './shared.js';

const root = 'volt-file-upload';
const zone = 'volt-file-upload-zone';
const label = 'volt-file-upload-label';
const description = 'volt-file-upload-description';
const error = 'volt-file-upload-error';
const list = 'volt-file-upload-list';
const item = 'volt-file-upload-item';
const head = 'volt-file-upload-head';
const name = 'volt-file-upload-name';
const meta = 'volt-file-upload-meta';
const actions = 'volt-file-upload-actions';
const action = 'volt-file-upload-action';
const reason = 'volt-file-upload-reason';
const status = 'volt-file-upload-status';

/** Part to class, on its own so that a bundle can take it without the rules. */
export const fileUploadClasses = {
  root,
  zone,
  label,
  description,
  error,
  list,
  item,
  head,
  name,
  meta,
  actions,
  action,
  reason,
  status,
} as const;

export const fileUploadStyles = /* @__PURE__ */ ((): ComponentStyles => {
  /**
   * A drag over the zone. Written under the field so that it is as deep as
   * anything else a zone can be, and so wins by coming later rather than by
   * luck.
   */
  const DRAGGING = `.${root} .${zone}[data-dragging]`;
  const DISABLED = `.${zone}[aria-disabled='true']`;
  /** A file with a reason it was not sent: refused, or failed on the way. */
  const FAILED = `.${item}[data-error]`;
  /** The field's message, while there is one. */
  const SAYING = `.${error}[data-state='invalid']`;
  const ACTION_OFF = `.${action}[aria-disabled='true']`;

  const edges = (width: string, style: string, colour: string): Declarations => ({
    'border-block-start-width': width,
    'border-block-end-width': width,
    'border-inline-start-width': width,
    'border-inline-end-width': width,
    'border-block-start-style': style,
    'border-block-end-style': style,
    'border-inline-start-style': style,
    'border-inline-end-style': style,
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  const colours = (colour: string): Declarations => ({
    'border-block-start-color': colour,
    'border-block-end-color': colour,
    'border-inline-start-color': colour,
    'border-inline-end-color': colour,
  });

  const widths = (width: string): Declarations => ({
    'border-block-start-width': width,
    'border-block-end-width': width,
    'border-inline-start-width': width,
    'border-inline-end-width': width,
  });

  const padding = (block: string, inline: string): Declarations => ({
    'padding-block-start': block,
    'padding-block-end': block,
    'padding-inline-start': inline,
    'padding-inline-end': inline,
  });

  const radius = (token: string): Declarations => ({
    'border-start-start-radius': token,
    'border-start-end-radius': token,
    'border-end-start-radius': token,
    'border-end-end-radius': token,
  });

  /**
   * Padding less what a thicker edge takes, so a box keeps its contents where
   * they were when its edge grows.
   */
  const less = (space: string, thick: string, thin = 'var(--volt-border-width-1)'): string =>
    `calc(${space} - ${thick} + ${thin})`;

  /** The danger edge, as the alert draws it: thick, down the start of the box. */
  const dangerEdge: Declarations = {
    'border-inline-start-width': 'var(--volt-border-width-4)',
    'border-inline-start-color': 'var(--volt-color-danger)',
  };

  return {
    name: 'file-upload',
    classes: fileUploadClasses,
    keyframes: [],

    rules: [
      {
        selector: `.${root}`,
        declarations: {
          display: 'flex',
          'flex-direction': 'column',
          'row-gap': 'var(--volt-space-2)',
          'inline-size': '100%',
          'font-family': 'var(--volt-font-family-sans)',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': 'var(--volt-line-height-normal)',
          color: 'var(--volt-color-on-surface)',
        },
      },

      {
        selector: `.${zone}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          'inline-size': '100%',
          'min-block-size': 'var(--volt-space-20)',
          ...padding('var(--volt-space-6)', 'var(--volt-space-4)'),
          'text-align': 'center',
          color: 'var(--volt-color-on-surface-muted)',
          'background-color': 'var(--volt-color-surface)',
          ...edges('var(--volt-border-width-1)', 'dashed', 'var(--volt-color-border-strong)'),
          ...radius('var(--volt-radius-2)'),
          cursor: 'pointer',
          'user-select': 'none',
          ...transition('background-color, border-color'),
        },
      },
      {
        selector: `.${zone}:not([aria-disabled='true']):hover`,
        declarations: { 'background-color': 'var(--volt-color-surface-hover)' },
      },
      { selector: `.${zone}:focus-visible`, declarations: { ...focusRing } },
      {
        selector: DRAGGING,
        declarations: {
          ...widths('var(--volt-border-width-2)'),
          ...colours('var(--volt-color-accent)'),
          ...padding(
            less('var(--volt-space-6)', 'var(--volt-border-width-2)'),
            less('var(--volt-space-4)', 'var(--volt-border-width-2)'),
          ),
          color: 'var(--volt-color-on-surface)',
          'background-color': 'var(--volt-color-accent-muted)',
        },
      },
      { selector: DISABLED, declarations: { ...disabledLook } },

      {
        // An icon and the words, stacked: whatever the default slot holds.
        selector: `.${label}`,
        declarations: {
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'center',
          'row-gap': 'var(--volt-space-2)',
          'font-weight': 'var(--volt-font-weight-medium)',
        },
      },

      {
        selector: `.${description}`,
        declarations: {
          'margin-block-start': '0',
          'margin-block-end': '0',
          'font-size': 'var(--volt-font-size-1)',
          color: 'var(--volt-color-on-surface-muted)',
        },
      },

      {
        // At rest it is an empty live region, so it takes no room and draws
        // nothing; the box below arrives with the words.
        selector: `.${error}`,
        declarations: {
          'box-sizing': 'border-box',
          'margin-block-start': '0',
          'margin-block-end': '0',
          'font-size': 'var(--volt-font-size-1)',
          color: 'var(--volt-color-on-surface)',
        },
      },
      {
        selector: SAYING,
        declarations: {
          ...padding('var(--volt-space-2)', 'var(--volt-space-3)'),
          'padding-inline-start': less('var(--volt-space-3)', 'var(--volt-border-width-4)'),
          ...edges('var(--volt-border-width-1)', 'solid', 'var(--volt-color-border)'),
          ...dangerEdge,
          ...radius('var(--volt-radius-2)'),
          'background-color': 'var(--volt-color-surface)',
        },
      },

      {
        // `role="list"` is on the element as well, because a list with its
        // markers taken away stops being announced as one in Safari.
        selector: `.${list}`,
        declarations: {
          display: 'flex',
          'flex-direction': 'column',
          'row-gap': 'var(--volt-space-2)',
          'list-style-type': 'none',
          'margin-block-start': '0',
          'margin-block-end': '0',
          'padding-block-start': '0',
          'padding-block-end': '0',
          'padding-inline-start': '0',
          'padding-inline-end': '0',
        },
      },

      {
        // A column, not a grid: a row drawn from the `file` slot is the page's
        // own markup, and stacks the way markup stacks. The default row lays
        // itself out inside `head`.
        selector: `.${item}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'flex',
          'flex-direction': 'column',
          'row-gap': 'var(--volt-space-2)',
          ...padding('var(--volt-space-2)', 'var(--volt-space-3)'),
          ...edges('var(--volt-border-width-1)', 'solid', 'var(--volt-color-border)'),
          ...radius('var(--volt-radius-2)'),
          'background-color': 'var(--volt-color-surface)',
        },
      },
      {
        selector: FAILED,
        declarations: {
          ...dangerEdge,
          'padding-inline-start': less('var(--volt-space-3)', 'var(--volt-border-width-4)'),
        },
      },

      {
        // The name and the size on two lines, and the buttons beside both.
        selector: `.${head}`,
        declarations: {
          display: 'grid',
          'grid-template-columns': 'minmax(0, 1fr) auto',
          'column-gap': 'var(--volt-space-3)',
          'align-items': 'center',
        },
      },
      {
        selector: `.${name}`,
        declarations: {
          'grid-column-start': '1',
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          'white-space': 'nowrap',
          'text-overflow': 'ellipsis',
          'font-weight': 'var(--volt-font-weight-medium)',
          'line-height': 'var(--volt-line-height-tight)',
        },
      },
      {
        selector: `.${meta}`,
        declarations: {
          'grid-column-start': '1',
          'font-size': 'var(--volt-font-size-1)',
          // A percentage counting up keeps its columns, so the line beside it
          // does not shuffle sideways on every change.
          'font-variant-numeric': 'tabular-nums',
          color: 'var(--volt-color-on-surface-muted)',
        },
      },
      {
        selector: `.${actions}`,
        declarations: {
          display: 'flex',
          'align-items': 'center',
          'column-gap': 'var(--volt-space-1)',
          'grid-column-start': '2',
          'grid-row-start': '1',
          'grid-row-end': 'span 2',
        },
      },

      {
        // A glyph in a square, named by the primitive: the name says which
        // file, and the glyph says what to it.
        selector: `.${action}`,
        declarations: {
          'box-sizing': 'border-box',
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'center',
          'inline-size': 'var(--volt-space-6)',
          'block-size': 'var(--volt-space-6)',
          'margin-block-start': '0',
          'margin-block-end': '0',
          'margin-inline-start': '0',
          'margin-inline-end': '0',
          ...padding('0', '0'),
          ...widths('0'),
          ...radius('var(--volt-radius-1)'),
          'background-color': 'transparent',
          color: 'var(--volt-color-on-surface-muted)',
          'font-family': 'inherit',
          'font-size': 'var(--volt-font-size-2)',
          'line-height': '1',
          cursor: 'pointer',
          ...transition('background-color, color'),
        },
      },
      {
        selector: `.${action}:not([aria-disabled='true']):hover`,
        declarations: {
          'background-color': 'var(--volt-color-surface-hover)',
          color: 'var(--volt-color-on-surface)',
        },
      },
      { selector: `.${action}:focus-visible`, declarations: { ...focusRing } },
      { selector: ACTION_OFF, declarations: { ...disabledLook } },

      {
        selector: `.${reason}`,
        declarations: {
          'margin-block-start': '0',
          'margin-block-end': '0',
          'font-size': 'var(--volt-font-size-1)',
          color: 'var(--volt-color-danger)',
        },
      },

      {
        // The polite live region that says when files finish. It is on the
        // page from the start — a region that appears together with its
        // message announces nothing — so it has to be there and not be seen.
        selector: `.${status}`,
        declarations: {
          position: 'absolute',
          'inline-size': '1px',
          'block-size': '1px',
          'margin-block-start': '-1px',
          'margin-block-end': '-1px',
          'margin-inline-start': '-1px',
          'margin-inline-end': '-1px',
          ...padding('0', '0'),
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          'clip-path': 'inset(50%)',
          'white-space': 'nowrap',
          ...widths('0'),
        },
      },
    ],

    forcedColors: [
      { selector: `.${root}`, declarations: { color: 'CanvasText' } },
      {
        selector: `.${zone}`,
        declarations: {
          color: 'CanvasText',
          'background-color': 'Canvas',
          ...colours('CanvasText'),
        },
      },
      {
        selector: `.${zone}:not([aria-disabled='true']):hover`,
        declarations: { 'background-color': 'Canvas' },
      },
      { selector: `.${zone}:focus-visible`, declarations: { ...forcedFocusRing } },
      {
        // The edge is already twice as thick, which no palette touches; it is
        // drawn in the palette's own colour for "this is the one" as well.
        selector: DRAGGING,
        declarations: {
          ...colours('Highlight'),
          color: 'CanvasText',
          'background-color': 'Canvas',
        },
      },
      { selector: DISABLED, declarations: { ...forcedDisabled, ...colours('GrayText') } },
      // The words take the zone's colour rather than naming one of their own:
      // `CanvasText` written here outranked what they inherit, and kept them at
      // full contrast inside a zone the palette was drawing as unavailable.

      { selector: `.${description}`, declarations: { color: 'GrayText' } },
      { selector: `.${error}`, declarations: { color: 'CanvasText' } },
      {
        // Danger, the way the alert says it once the hue is gone: dots.
        selector: SAYING,
        declarations: {
          ...colours('CanvasText'),
          'border-inline-start-style': 'dotted',
          'background-color': 'Canvas',
        },
      },

      {
        selector: `.${item}`,
        declarations: { ...colours('CanvasText'), 'background-color': 'Canvas' },
      },
      { selector: FAILED, declarations: { 'border-inline-start-style': 'dotted' } },
      { selector: `.${name}`, declarations: { color: 'CanvasText' } },
      // The size and where the file is are information, not a hint: muted in
      // the ordinary palette, the page's own text colour here.
      { selector: `.${meta}`, declarations: { color: 'CanvasText' } },
      { selector: `.${action}`, declarations: { color: 'ButtonText' } },
      {
        // Handed back: a pointer user can see their own pointer.
        selector: `.${action}:not([aria-disabled='true']):hover`,
        declarations: { 'background-color': 'Canvas', color: 'ButtonText' },
      },
      { selector: `.${action}:focus-visible`, declarations: { ...forcedFocusRing } },
      { selector: ACTION_OFF, declarations: { ...forcedDisabled } },
      { selector: `.${reason}`, declarations: { color: 'CanvasText' } },
    ],
  };
})();
