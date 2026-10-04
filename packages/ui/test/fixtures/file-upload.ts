/**
 * File upload: the markup it is measured in, and the state changes that have
 * to stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 *
 * The zone is mounted inside the field, because a drag over it is drawn by a
 * rule that names both: a `.volt-file-upload-zone` mounted on its own is never
 * dragged over.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** The zone, as the primitive marks it, with the words inside. */
const zone = (attributes: Record<string, string> = {}, focus = false): Fixture => ({
  classes: ['volt-file-upload-zone'],
  attributes: { role: 'button', tabindex: '0', ...attributes },
  focus,
  children: [{ tag: 'span', classes: ['volt-file-upload-label'], text: 'Drop files here' }],
});

/** The field around a zone, which is what a drag is written on as well. */
const field = (
  attributes: Record<string, string> = {},
  children: readonly Fixture[] = [zone(attributes)],
): Fixture => ({
  classes: ['volt-file-upload'],
  attributes: { 'data-state': 'valid', ...attributes },
  children,
});

/** One of a row's two buttons. */
const action = (attributes: Record<string, string> = {}, focus = false): Fixture => ({
  tag: 'button',
  classes: ['volt-file-upload-action'],
  attributes: { type: 'button', ...attributes },
  focus,
  text: '×',
});

/**
 * One row, the way the component draws it by default: the name and where the
 * file is beside its buttons, the bar under them, and the reason it was not
 * sent when there is one. `error` is the reason's code, which is what the
 * primitive writes as `data-error`. A refused file was never taken, so its
 * row has no bar and no retry — only the remove — as the component draws it.
 *
 * The reason comes last, so a pair whose `on` side gains one differs from its
 * `off` side by nothing the harness measures but the row itself: the harness
 * compares what the `off` side has, and a child only `on` has is not among it.
 */
const row = (status: string, error?: string): Fixture => ({
  tag: 'li',
  classes: ['volt-file-upload-item'],
  attributes: {
    'data-id': 'upload-item-1',
    'data-status': status,
    'data-progress': '40',
    ...(error ? { 'data-error': error } : {}),
  },
  children: [
    {
      classes: ['volt-file-upload-head'],
      children: [
        { tag: 'span', classes: ['volt-file-upload-name'], text: 'report.pdf' },
        { tag: 'span', classes: ['volt-file-upload-meta'], text: '40%' },
        {
          tag: 'span',
          classes: ['volt-file-upload-actions'],
          children: [
            ...(status === 'rejected'
              ? []
              : [
                  action(
                    status === 'error' || status === 'cancelled' ? {} : { 'aria-disabled': 'true' },
                  ),
                ]),
            action(),
          ],
        },
      ],
    },
    ...(status === 'rejected'
      ? []
      : [
          {
            classes: ['volt-progress'],
            attributes: { role: 'progressbar', 'data-state': 'loading' },
            children: [
              {
                classes: ['volt-progress-track'],
                children: [
                  {
                    classes: ['volt-progress-indicator'],
                    attributes: { 'data-state': 'loading' },
                  },
                ],
              },
            ],
          },
        ]),
    ...(error ? [{ tag: 'p', classes: ['volt-file-upload-reason'], text: 'Too large' }] : []),
  ],
});

/** The field's message: empty and at rest, or saying why. */
const message = (state: string): Fixture => ({
  tag: 'p',
  classes: ['volt-file-upload-error'],
  attributes: { role: 'alert', 'data-state': state },
  text: state === 'invalid' ? 'One file failed.' : undefined,
});

export const fixtures: ComponentFixtures = {
  states: [
    // Where a drop will land is the one thing a drag has to show, and the
    // zone says it twice: in the accent, and with an edge twice as thick —
    // the second of which no palette takes away.
    {
      state: 'dragging',
      off: field(),
      on: field({ 'data-dragging': '' }, [zone({ 'data-dragging': '' })]),
    },
    // A zone that will refuse a drop has to look like one before anything is
    // dragged at it.
    {
      state: 'disabled',
      off: field(),
      on: field({ 'data-disabled': '' }, [zone({ 'aria-disabled': 'true', 'data-disabled': '' })]),
    },
    // The zone is a tab stop, and nothing else on it moves when it is reached.
    { state: 'focus', off: zone(), on: zone({}, true) },
    // A file that failed, among forty that did not: the danger edge is what
    // finds it at a glance, and once the palette is the user's that edge is
    // dots. Each pair is the same row with and without `data-error`, so it is
    // that edge being measured and nothing else: a failed row beside a
    // cancelled one, whose retry is just as live and whose bar is just as
    // there, and a refused row beside the same row with no reason recorded.
    // Paired with rows of another shape — a bar where the other has none, a
    // retry live on one side only — the pair differed whether or not the
    // edge was drawn.
    { state: 'failed', off: row('cancelled'), on: row('error', 'transport') },
    { state: 'refused', off: row('rejected'), on: row('rejected', 'size') },
    // The field's message arriving: a box drawn round words that were not
    // there, in the alert's danger tone.
    { state: 'message', off: message('valid'), on: message('invalid') },
    // A button on a row with nothing to do — a retry while the file is still
    // going up, or both while the upload is disabled.
    { state: 'action unavailable', off: action(), on: action({ 'aria-disabled': 'true' }) },
    { state: 'action focus', off: action(), on: action({}, true) },
  ],
  extra: [
    field({ 'data-uploading': '' }, [
      zone(),
      { tag: 'p', classes: ['volt-file-upload-description'], text: 'PDF, up to 5 MB' },
      message('invalid'),
      {
        tag: 'ul',
        classes: ['volt-file-upload-list'],
        attributes: { role: 'list' },
        children: [
          row('success'),
          row('uploading'),
          row('cancelled'),
          row('error', 'transport'),
          row('rejected', 'type'),
        ],
      },
      {
        classes: ['volt-file-upload-status'],
        attributes: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
        text: 'Uploading 1 of 5',
      },
    ]),
    zone({ 'data-hover': '' }),
    action({ 'data-hover': '' }),
  ],
};
