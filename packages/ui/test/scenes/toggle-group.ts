import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createToggle, createToggleGroup } from '@voltdev/primitives';
import { show, step, type Scene } from '../scene.ts';

/**
 * `toggle-group.html` with each `<v-toggle>`'s `toggle.html` drawn in place,
 * three times over: a row that must keep a value, which the primitive makes a
 * radio group; a column that may hold several; and a toggle on its own, over
 * the other primitive, which the same class draws with its corners back.
 */
@Component({
  selector: 'v-styled-toggle-group',
  render: compileTemplate(`
    <div>
      <div class="volt-toggle-group" :ref="row" :spread="align.groupProps()">
        <button :for="item in alignments" :key="item.value" type="button" class="volt-toggle"
                :spread="align.itemProps(item.value, item)">{ item.text }</button>
      </div>
      <div class="volt-toggle-group" :ref="column" :spread="format.groupProps()">
        <button :for="item in formats" :key="item.value" type="button" class="volt-toggle"
                :spread="format.itemProps(item.value, item)">{ item.text }</button>
      </div>
      <button type="button" class="volt-toggle" :spread="wrap.props()">Wrap lines</button>
    </div>
  `),
})
class StyledToggleGroup {
  row = new Signal.State<Element | null>(null);
  column = new Signal.State<Element | null>(null);
  /** A signal, as `<v-toggle-group>` holds its `disabled` prop, so the row can be taken out of use. */
  off = new Signal.State(false);

  alignments = [
    { value: 'left', text: 'Left' },
    { value: 'center', text: 'Centre' },
    { value: 'right', text: 'Right', disabled: true },
  ];
  formats = [
    { value: 'bold', text: 'B', label: 'Bold' },
    { value: 'italic', text: 'I', label: 'Italic' },
    { value: 'underline', text: 'U', label: 'Underline' },
  ];

  align = createToggleGroup({
    group: () => this.row.get(),
    deselectable: false,
    label: 'Alignment',
    disabled: () => this.off.get(),
  });
  format = createToggleGroup({
    group: () => this.column.get(),
    type: 'multiple',
    orientation: 'vertical',
    label: 'Formatting',
  });
  wrap = createToggle({ label: 'Wrap lines' });
}

export const scene: Scene = (look) => {
  const { align, format, wrap, off } = show(StyledToggleGroup);
  // Nothing down yet: every toggle up, the tab stop on the first of each row.
  look();
  // One down in each, and the lone one too.
  step(() => {
    align.select('left');
    format.select('bold');
    wrap.press();
  });
  look();
  // The row taken out of use while one of its toggles is down, which is the
  // one pairing the sheet has a rule of its own for.
  step(() => off.set(true));
  look();
};
