import { Component, Signal } from '@voltdev/core';
import { basicSchema, type Node as Doc } from '@voltdev/editor';
import { VEditor, VSwitch } from '@voltdev/ui/components';

const s = basicSchema;

/** A draft with something of each kind in it, so every button has a place to be down. */
const draft = s.node('doc', null, [
  s.node('heading', { level: 2 }, [s.text('What changed')]),
  s.node('paragraph', null, [
    s.text('A paste now keeps its '),
    s.text('lists and headings', [s.mark('strong')]),
    s.text(', and undo puts the caret back where the edit '),
    s.text('began', [s.mark('em')]),
    s.text('.'),
  ]),
  s.node('bullet_list', null, [
    s.node('list_item', null, [s.node('paragraph', null, [s.text('Shift-Return breaks a line inside a block.')])]),
    s.node('list_item', null, [s.node('paragraph', null, [s.text('An image or a rule can be selected whole.')])]),
  ]),
  s.node('blockquote', null, [s.node('paragraph', null, [s.text('Typed text arrives as one undo, not one per key.')])]),
]);

@Component({
  selector: 'v-release-notes',
  templateUrl: './editor.html',
  styleUrl: './editor.scss',
  imports: [VEditor, VSwitch],
})
export class ReleaseNotes {
  /** The document, which every edit writes back into. */
  notes = new Signal.State<Doc>(draft);

  /** Whether the notes are shown for reading rather than editing. */
  locked = new Signal.State(false);

  /**
   * Counted from the document rather than from the page, so it is right
   * before anything is drawn and after every edit, undo included.
   */
  hint(): string {
    const doc = this.notes.get();
    const words = doc.textBetween(0, doc.content.size, ' ').split(/\s+/).filter(Boolean).length;
    return `${words} words. Select some text for bold, italic or code.`;
  }
}
