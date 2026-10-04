import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createSeparator, type Separator, type SeparatorOrientation } from '@voltdev/primitives';
import { clear, show, step, type Scene } from '../scene.ts';

/** Along the text for one pass and across it for the next. */
let orientation: SeparatorOrientation = 'horizontal';

/** One line of the page: the words on it, if any, and the primitive behind it. */
interface Line {
  readonly name: string;
  readonly label: string;
  readonly separator: Separator;
}

/**
 * `separator.html`, once per kind of line, with the primitive's props spread
 * onto each: a bare rule, a rule with words on it, one that means something,
 * and a splitter. The kinds are what the sheet tells apart — a gap, a role it
 * draws nothing different for, and the grab area and stronger line only a
 * value brings.
 */
@Component({
  selector: 'v-styled-separator',
  render: compileTemplate(`
    <div>
      <span :for="line in lines" :key="line.name" class="volt-separator"
            :spread="line.separator.separatorProps()"
            :keydown="line.separator.onKeyDown($event) && $event.preventDefault()">
        <span class="volt-separator-line"></span>
        <template :if="line.label">
          <span class="volt-separator-label">{ line.label }</span>
          <span class="volt-separator-line"></span>
        </template>
      </span>
    </div>
  `),
})
class StyledSeparator {
  /** The pane the splitter sizes, as `<v-separator :prop-resize>` holds it. */
  size = new Signal.State(30);

  lines: readonly Line[] = [
    { name: 'rule', label: '', separator: createSeparator({ orientation }) },
    { name: 'words', label: 'or', separator: createSeparator({ orientation }) },
    {
      name: 'meaning',
      label: 'Comments',
      separator: createSeparator({ orientation, decorative: false, label: 'Comments' }),
    },
    {
      name: 'splitter',
      label: '',
      separator: createSeparator({
        orientation,
        label: 'Resize',
        resize: { value: this.size, collapsible: true },
      }),
    },
  ];
}

export const scene: Scene = (look) => {
  for (const each of ['horizontal', 'vertical'] as const) {
    orientation = each;
    show(StyledSeparator);
    // At rest: every kind of line, none of them moved.
    look();

    // Moved by its keys, which is the only way this one moves.
    const splitter = document.querySelector<HTMLElement>('.volt-separator[aria-valuenow]')!;
    const larger = each === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    step(() =>
      splitter.dispatchEvent(
        new KeyboardEvent('keydown', { key: larger, bubbles: true, cancelable: true }),
      ),
    );
    look();

    // Collapsed to nothing, which is still a splitter with a value — `0`,
    // written out — so the grab area does not go with the pane.
    step(() =>
      splitter.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      ),
    );
    look();

    clear();
  }
};
