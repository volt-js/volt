import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createSlider, type SliderOrientation } from '@voltdev/primitives';
import { clear, show, step, type Scene } from '../scene.ts';

/** Along the track for one pass and up it for the next. */
let orientation: SliderOrientation = 'horizontal';

/**
 * `slider.html`, with the primitive's props spread onto it.
 *
 * `data-scale` is worked out by the markup, as it is in the component: the
 * primitive knows nothing about room beneath the track, and the sheet reads
 * nothing from a mark's own label. The positions the component writes inline
 * are left out, since no rule selects on them.
 */
@Component({
  selector: 'v-styled-slider',
  render: compileTemplate(`
    <div :ref="root" class="volt-slider" :spread="slider.rootProps()"
         :attr-data-scale="scaled() ? '' : undefined">
      <span :ref="label" class="volt-slider-label" :spread="slider.labelProps()">Price</span>
      <span :ref="track" class="volt-slider-track" :spread="slider.trackProps()"
            :pointerdown="slider.onPointerDown($event)" :keydown="slider.onKeyDown($event)">
        <span class="volt-slider-range" :spread="slider.rangeProps()"></span>
        <span :for="mark in slider.marks()" :key="mark.value" class="volt-slider-mark" aria-hidden="true"
              :spread="slider.markProps(mark)"
        ><span :if="mark.label !== undefined" class="volt-slider-mark-label">{ mark.label }</span></span>
        <span :for="(each, index) in slider.values()" :key="index" class="volt-slider-thumb"
              :spread="slider.thumbProps(index)"></span>
      </span>
      <input :for="(each, index) in slider.values()" :key="index" :spread="slider.inputProps(index)">
    </div>
  `),
})
class StyledSlider {
  root = new Signal.State<Element | null>(null);
  track = new Signal.State<Element | null>(null);
  label = new Signal.State<Element | null>(null);
  /** A signal, as `<v-slider>` holds its `disabled` prop. */
  off = new Signal.State(false);

  slider = createSlider({
    root: () => this.root.get(),
    track: () => this.track.get(),
    label: () => this.label.get(),
    // Two thumbs, so the fill runs between them and a tick can be on either
    // side of it: one below the span, one inside, one above.
    defaultValue: [20, 60],
    marks: [0, { value: 50, label: 'Half' }, 100],
    orientation,
    disabled: () => this.off.get(),
  });

  /** As `<v-slider>` decides it: a tick with words under it asks for room. */
  scaled(): boolean {
    return this.slider.marks().some((mark) => mark.label !== undefined);
  }
}

/** Give the track a box, since nothing here is laid out. */
function layout(el: Element): void {
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 200,
    bottom: 200,
    width: 200,
    height: 200,
    toJSON: () => rect,
  } as DOMRect;
  el.getBoundingClientRect = () => rect;
}

export const scene: Scene = (look) => {
  for (const each of ['horizontal', 'vertical'] as const) {
    orientation = each;
    const { off } = show(StyledSlider);
    // At rest: nothing touched, nothing held.
    look();

    // A key on the first thumb makes it the one the keys move.
    const thumb = document.querySelector<HTMLElement>('.volt-slider-thumb')!;
    step(() =>
      thumb.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      ),
    );
    look();

    // Held: a press on the track picks up the nearest thumb, and the group
    // says so until the pointer lets go.
    const track = document.querySelector<HTMLElement>('.volt-slider-track')!;
    layout(track);
    step(() =>
      track.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          isPrimary: true,
          pointerId: 1,
          clientX: 100,
          clientY: 100,
        }),
      ),
    );
    look();
    step(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })));

    // Out of use, which every part says for itself.
    step(() => off.set(true));
    look();

    clear();
  }
};
