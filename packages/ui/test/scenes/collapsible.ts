import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createCollapsible } from '@voltdev/primitives';
import { show, step, type Scene } from '../scene.ts';

@Component({
  selector: 'v-styled-collapsible',
  render: compileTemplate(`
    <div class="volt-collapsible">
      <button class="volt-collapsible-trigger" :spread="collapsible.triggerProps()"
              :click="collapsible.toggle()">Delivery<span class="volt-collapsible-indicator"
              aria-hidden="true"></span></button>
      <div :ref="content" class="volt-collapsible-panel" :spread="collapsible.contentProps()">
        <p>Everything leaves within a day.</p>
      </div>
    </div>
  `),
})
class StyledCollapsible {
  content = new Signal.State<Element | null>(null);
  /** A signal, as `<v-collapsible>` holds its `disabled` prop, so one section is taken out of use. */
  off = new Signal.State(false);
  collapsible = createCollapsible({
    content: () => this.content.get(),
    disabled: () => this.off.get(),
  });
}

export const scene: Scene = (look) => {
  const { collapsible, off } = show(StyledCollapsible);
  // Not looked at before it opens: the documented panel is not in the page
  // until then, and the `closed` it would carry here is the scene's doing,
  // not a state a reader sees.
  step(() => collapsible.open());
  look();
  // Closed, which is the state the collapse animates out of, and then taken
  // out of use. Off second, because the trigger refuses `close()` once it is
  // off; left closed while off, because nothing the sheet draws for a
  // section that is off depends on whether it is open.
  step(() => collapsible.close());
  step(() => off.set(true));
  look();
};
