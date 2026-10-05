/**
 * Editor: the markup it is measured in, and the state changes that have to
 * stay visible when the palette is taken away.
 *
 * See `../fixtures.ts` for what belongs in a pair and what does not. The
 * label, the help, the message and the box are the field's, and the toolbar's
 * buttons are the toggle group's, and both have pairs of their own there; the
 * one state only an editor has is a node selected whole. The browser draws no
 * selection round an image or a rule, so the outline is the only thing that
 * says which one the delete key will take.
 */

import type { ComponentFixtures } from '../fixtures.ts';
import type { Fixture } from '../harness.ts';

/** The editable box with an image in its paragraph, selected whole or not. */
const box = (selected: boolean): Fixture => ({
  classes: ['volt-field-control', 'volt-editor'],
  attributes: { role: 'textbox', 'aria-multiline': 'true', contenteditable: 'true', 'data-state': 'valid' },
  children: [
    {
      tag: 'p',
      children: [
        { tag: 'span', text: 'A diagram: ' },
        {
          tag: 'img',
          classes: selected ? ['volt-selected-node'] : [],
          attributes: { src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', alt: 'Diagram' },
        },
      ],
    },
  ],
});

/**
 * A toolbar button, as `<v-editor>` draws its default ones: a toggle says
 * whether it is down, and an act like undo has no state to say.
 */
const action = (name: string, glyph: string, attributes: Record<string, string> = {}, toggle = true): Fixture => ({
  tag: 'button',
  classes: ['volt-toggle'],
  attributes: {
    type: 'button',
    'aria-label': name,
    ...(toggle ? { 'aria-pressed': 'false' } : {}),
    'data-state': 'off',
    'data-volt-item': '',
    tabindex: '-1',
    ...attributes,
  },
  text: glyph,
});

const down = { 'aria-pressed': 'true', 'data-state': 'on' };
const unavailable = { 'aria-disabled': 'true', 'data-disabled': '' };

/** The whole field, the words over an empty box or a document in it. */
const editor = (empty: boolean): Fixture => ({
  classes: ['volt-field'],
  children: [
    { tag: 'label', classes: ['volt-field-label'], text: 'Notes' },
    {
      classes: ['volt-editor-toolbar'],
      attributes: { role: 'toolbar', 'aria-label': 'Formatting' },
      children: [
        {
          classes: ['volt-toggle-group'],
          attributes: { 'data-orientation': 'horizontal' },
          children: [
            action('Bold', 'B', { ...down, tabindex: '0' }),
            action('Italic', 'I'),
            action('Code', '</>', unavailable),
          ],
        },
        {
          classes: ['volt-toggle-group'],
          attributes: { 'data-orientation': 'horizontal' },
          children: [action('Undo', '↶', {}, false), action('Redo', '↷', unavailable, false)],
        },
      ],
    },
    {
      classes: ['volt-editor-body'],
      children: [
        ...(empty
          ? [
              {
                classes: ['volt-editor-placeholder'],
                attributes: { 'aria-hidden': 'true' },
                children: [{ tag: 'p', text: 'Write something' }],
              },
            ]
          : []),
        {
          classes: ['volt-field-control', 'volt-editor'],
          attributes: { role: 'textbox', 'aria-multiline': 'true', contenteditable: 'true', 'data-state': 'valid' },
          children: [{ tag: 'p', ...(empty ? { children: [{ tag: 'br' }] } : { text: 'Ship it on Friday.' }) }],
        },
      ],
    },
    { tag: 'p', classes: ['volt-field-description'], text: 'Kept as you write it.' },
    { tag: 'p', classes: ['volt-field-error'], attributes: { role: 'alert' }, text: '' },
  ],
});

export const fixtures: ComponentFixtures = {
  states: [{ state: 'node selected whole', off: box(false), on: box(true) }],
  extra: [
    editor(true),
    editor(false),
    // Out of use: the box neither editable nor reachable, and every button off.
    {
      classes: ['volt-field'],
      children: [
        {
          classes: ['volt-editor-toolbar'],
          attributes: { role: 'toolbar', 'aria-label': 'Formatting' },
          children: [
            {
              classes: ['volt-toggle-group'],
              attributes: { 'data-orientation': 'horizontal' },
              children: [action('Bold', 'B', unavailable), action('Italic', 'I', unavailable)],
            },
          ],
        },
        {
          classes: ['volt-editor-body'],
          children: [
            {
              classes: ['volt-field-control', 'volt-editor'],
              attributes: { role: 'textbox', 'aria-multiline': 'true', contenteditable: 'false', 'aria-disabled': 'true' },
              children: [{ tag: 'p', text: 'Ship it on Friday.' }],
            },
          ],
        },
      ],
    },
  ],
};
