import { Component, Signal } from '@voltdev/core';
import { VKbd } from '@voltdev/ui/components';

@Component({
  selector: 'v-shortcuts',
  templateUrl: './kbd.html',
  styleUrl: './kbd.scss',
  imports: [VKbd],
})
export class Shortcuts {
  /**
   * Each drawn twice below, once per platform. The list form is the one way to
   * write the plus key, which the string form would split on.
   */
  chords: readonly (string | readonly string[])[] = [
    'mod+k',
    'mod+Shift+p',
    'Alt+ArrowUp',
    ['mod', '+'],
    'Shift+Enter',
  ];

  /** The first line's shortcut, reached through `:ref` for what it is called. */
  search = new Signal.State<VKbd | null>(null);

  /** What a screen reader hears for it, which nothing on screen says. */
  heard(): string {
    return this.search.get()?.shortcut.label() ?? '';
  }
}
