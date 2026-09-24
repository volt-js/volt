import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createChip } from '@voltdev/primitives';
import { show, step, type Scene } from '../scene.ts';

const TONES = ['neutral', 'accent', 'success', 'warning', 'danger'] as const;
const SIZES = ['md', 'sm'] as const;

/**
 * `chip.html` twice over, in one set: a chip that can be removed and one that
 * cannot, since the sheet draws the button of one and the other has none. Both
 * take their tone and size from the page, as the tag's props do, and the fixed
 * one is out of the tab order but focusable, as `<v-chip>` leaves it.
 */
@Component({
  selector: 'v-styled-chip',
  render: compileTemplate(`
    <div>
      <span :ref="adaElement" class="volt-chip" :attr-data-tone="tone.get()"
            :attr-data-size="size.get()" :spread="ada.chipProps()" :keydown="ada.onKeyDown($event)">
        <span class="volt-chip-label">Ada</span>
        <button :if="ada.isRemovable()" class="volt-chip-remove" :spread="ada.removeProps()"
                :click="ada.remove()">×</button>
      </span>
      <span :ref="draftElement" class="volt-chip" tabindex="-1" :attr-data-tone="tone.get()"
            :attr-data-size="size.get()" :spread="draft.chipProps()" :keydown="draft.onKeyDown($event)">
        <span class="volt-chip-label">Draft</span>
        <button :if="draft.isRemovable()" class="volt-chip-remove" :spread="draft.removeProps()"
                :click="draft.remove()">×</button>
      </span>
    </div>
  `),
})
class StyledChip {
  tone = new Signal.State<(typeof TONES)[number]>('neutral');
  size = new Signal.State<(typeof SIZES)[number]>('md');
  adaElement = new Signal.State<Element | null>(null);
  draftElement = new Signal.State<Element | null>(null);
  ada = createChip({
    chip: () => this.adaElement.get(),
    label: () => 'Ada',
    removable: true,
  });
  draft = createChip({
    chip: () => this.draftElement.get(),
    label: () => 'Draft',
    removable: false,
    focusable: false,
  });
}

export const scene: Scene = (look) => {
  const { tone, size } = show(StyledChip);
  // Every tone at every size, since the small chip's button is a rule of its
  // own and a tone is drawn over whichever size it is on.
  for (const each of SIZES) {
    for (const hue of TONES) {
      step(() => {
        size.set(each);
        tone.set(hue);
      });
      look();
    }
  }
};
