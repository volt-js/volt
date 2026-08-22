/**
 * A starter schema.
 *
 * Not "the" schema — the whole point of schema.ts is that an application
 * declares its own — but a real one, covering what a document editor is
 * expected to have, and the thing the tests exercise the model against. A
 * package whose only schema is a two-node fixture in a test file will discover
 * its content-expression bugs from its first consumer rather than from its own
 * suite.
 *
 * The choices worth noting are the ones a schema author will have to make
 * anyway. A list item's content is `"paragraph block*"` rather than `"block+"`,
 * so an item always begins with a paragraph and normalisation has something
 * unambiguous to insert into an empty one. A code block declares `marks: ""`,
 * which is how "no formatting inside code" is expressed structurally rather
 * than by filtering at the input layer. `image` has a required `src`, which
 * makes it un-conjurable by normalisation — deliberately, since an image with
 * no source is not a useful thing to fill a gap with.
 */

import { Schema } from './schema.js';

export const basicSchema: Schema = new Schema({
  nodes: {
    doc: { content: 'block+' },

    paragraph: { content: 'inline*', group: 'block' },

    heading: {
      content: 'inline*',
      group: 'block',
      defining: true,
      attrs: { level: { default: 1 } },
    },

    blockquote: { content: 'block+', group: 'block', defining: true },

    code_block: {
      content: 'text*',
      group: 'block',
      marks: '',
      defining: true,
    },

    bullet_list: { content: 'list_item+', group: 'block' },

    ordered_list: {
      content: 'list_item+',
      group: 'block',
      attrs: { start: { default: 1 } },
    },

    list_item: { content: 'paragraph block*', defining: true },

    horizontal_rule: { group: 'block' },

    text: { group: 'inline' },

    image: {
      group: 'inline',
      inline: true,
      attrs: { src: {}, alt: { default: null }, title: { default: null } },
    },

    hard_break: { group: 'inline', inline: true },
  },

  marks: {
    em: {},
    strong: {},
    code: { excludes: '_' },
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
    },
  },
});
