/**
 * Tags input: the markup it is measured in, and the state changes that have
 * to stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not.
 *
 * The box is a `.volt-field-control` and each tag a `.volt-chip`, so the
 * field's states and the chip's ring are their entries' pairs and are not
 * repeated here. What is here is what only this entry draws.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

interface TagShape {
  /** The row's one tab stop. */
  readonly stop?: boolean;
  /** The tag a refused entry collided with. */
  readonly duplicate?: boolean;
  /** Whether the field is the user's to change, which is when the button is drawn. */
  readonly removable?: boolean;
}

/** One tag as the primitive and the component leave it: its words and its button. */
const tag = ({ stop = false, duplicate = false, removable = true }: TagShape = {}): Fixture => ({
  tag: 'span',
  classes: ['volt-chip', 'volt-tags-input-tag'],
  attributes: {
    role: 'listitem',
    'data-volt-item': '',
    'data-label': 'rust',
    tabindex: stop ? '0' : '-1',
    ...(duplicate ? { 'data-duplicate': '' } : {}),
  },
  children: [
    { tag: 'span', classes: ['volt-chip-label'], text: 'rust' },
    ...(removable
      ? [
          {
            tag: 'button',
            classes: ['volt-chip-remove'],
            attributes: { type: 'button', tabindex: '-1', 'aria-label': 'Remove rust' },
            text: '×',
          },
        ]
      : []),
  ],
});

interface BoxShape {
  readonly tags?: readonly Fixture[];
  /** Focus in the text input, which is where the ring is drawn from. */
  readonly typing?: boolean;
  readonly box?: Readonly<Record<string, string>>;
  readonly input?: Readonly<Record<string, string>>;
}

/** The box: the row of tags, then the text input, with the field's marks on both. */
const box = ({ tags = [], typing = false, box = {}, input = {} }: BoxShape = {}): Fixture => ({
  classes: ['volt-field-control', 'volt-tags-input'],
  attributes: { role: 'group', tabindex: '-1', 'data-state': 'valid', ...box },
  children: [
    {
      classes: ['volt-tags-input-list'],
      attributes: { role: 'list', 'aria-label': 'Tags', tabindex: '-1' },
      children: tags,
    },
    {
      tag: 'input',
      classes: ['volt-tags-input-input'],
      attributes: { type: 'text', autocomplete: 'off', 'data-state': 'valid', ...input },
      focus: typing,
      text: 'go',
    },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [
    // Where the keyboard is. The text input has no edge to draw a ring on, so
    // the box draws it, and a user who cannot see it cannot tell that what
    // they type next lands here.
    {
      state: 'typing',
      off: box({ tags: [tag({ stop: true })] }),
      on: box({ tags: [tag({ stop: true })], typing: true }),
    },
    // The tag a refused entry collided with: for a sighted user, the only
    // sign that Enter was refused rather than lost.
    {
      state: 'duplicate',
      off: box({ tags: [tag({ stop: true }), tag()] }),
      on: box({ tags: [tag({ stop: true }), tag({ duplicate: true })] }),
    },
  ],
  extra: [
    // Empty, which is a box and a caret.
    box(),
    // Full: marked on both and drawn on neither — the sheet says why.
    box({
      tags: [tag({ stop: true }), tag(), tag()],
      box: { 'data-full': '' },
      input: { 'data-full': '' },
    }),
    // Refused while the user is typing: the field's edge and this entry's
    // ring, on one box.
    box({
      tags: [tag({ stop: true })],
      typing: true,
      box: { 'data-state': 'invalid', 'aria-invalid': 'true' },
      input: { 'data-state': 'invalid', 'aria-invalid': 'true' },
    }),
    // Out of use, and read-only: no button on any tag.
    box({
      tags: [tag({ stop: true, removable: false })],
      box: { 'aria-disabled': 'true' },
      input: { 'aria-disabled': 'true', disabled: '' },
    }),
    // The box says read-only as `data-readonly`: it is a `group`, and ARIA
    // keeps `aria-readonly` for the text input.
    box({
      tags: [tag({ stop: true, removable: false }), tag({ removable: false })],
      box: { 'data-readonly': '' },
      input: { 'aria-readonly': 'true', readonly: '' },
    }),
    // The live region, which is on the page whether or not it has anything to say.
    {
      tag: 'p',
      classes: ['volt-tags-input-status'],
      attributes: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
      text: 'rust added',
    },
  ],
};
