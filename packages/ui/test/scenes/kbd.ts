import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createKbd, type KbdPart, type KbdPlatform } from '@voltdev/primitives';
import { clear, show, step, type Scene } from '../scene.ts';

/** Which platform the next chord is built for, which the primitive takes once. */
let platform: KbdPlatform = 'other';

@Component({
  selector: 'v-styled-kbd',
  render: compileTemplate(`
    <kbd class="volt-kbd" :attr-data-size="size.get()" :spread="shortcut.kbdProps()">
      <template :for="(part, index) in shortcut.parts()" :key="$index">
        <span :if="index > 0 && separator() !== ''" class="volt-kbd-separator"
              aria-hidden="true">{ separator() }</span>
        <kbd class="volt-kbd-key" :attr-data-character="character(part)"
             :spread="shortcut.keyProps(part.key)">{ part.text }</kbd>
      </template>
    </kbd>
  `),
})
class StyledKbd {
  /** A named key and a character, which the sheet draws differently. */
  keys = new Signal.State<readonly string[]>(['Control', 'k']);
  size = new Signal.State<'sm' | 'md'>('md');
  shortcut = createKbd({ keys: () => this.keys.get(), platform });

  // The two below are what `<v-kbd>` adds to the primitive, so each key
  // carries what a real one does: the separator read back out of the chord as
  // the primitive draws it, and the mark on a key that is a character.

  separator(): string {
    const parts = this.shortcut.parts();
    if (parts.length < 2) return '';
    const text = this.shortcut.text();
    const keys = parts.reduce((length, part) => length + part.text.length, 0);
    const start = parts[0]!.text.length;
    return text.slice(start, start + (text.length - keys) / (parts.length - 1));
  }

  character(part: KbdPart): '' | undefined {
    return part.text === part.key && [...part.key].length === 1 ? '' : undefined;
  }
}

export const scene: Scene = (look) => {
  // Everywhere else first, where a separator is drawn between the keys, and
  // then an Apple platform, where nothing is. Both sizes on each, since the
  // small one is a rule of its own on the chord and on every key in it.
  for (const each of ['other', 'apple'] as const) {
    platform = each;
    const kbd = show(StyledKbd);
    look();
    step(() => kbd.size.set('sm'));
    look();
    clear();
  }
};
