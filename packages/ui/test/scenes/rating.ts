import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal } from '@voltdev/core';
import { createRating, type InputProps } from '@voltdev/primitives';
import { clear, show, step, type Scene } from '../scene.ts';

/** Wholes for one pass and halves for the next, which is where a star holds two radios. */
let halves = false;

/**
 * `rating.html`, with the primitive's props spread onto it.
 *
 * `data-preview` is written by the markup, as it is in the component: the
 * primitive marks a star the pointer is over as filled, and only a comparison
 * with the score says it is not chosen yet.
 *
 * The star stays inside a `<slot>`, as it does there, and not only for
 * fidelity: a block holding an `<svg>` is parsed as SVG from its root, so the
 * shape written straight into the radio would turn the radio itself into an
 * SVG element.
 */
@Component({
  selector: 'v-styled-rating',
  render: compileTemplate(`
    <div :ref="group" class="volt-rating" :spread="rating.groupProps()"
         :keydown="rating.onKeyDown($event)" :pointerleave="rating.preview(null)">
      <span :for="star in stars" :key="star.at" class="volt-rating-star">
        <span :for="value in star.values" :key="value" class="volt-rating-item"
              :spread="itemProps(value)" :click="rating.setValue(value)"
              :pointerenter="rating.preview(value)"
        ><span class="volt-rating-icon" aria-hidden="true"><slot name="icon" :value="value"
              :filled="rating.isFilled(value)"><svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M12 2.5l2.94 6.28 6.86.84-5.06 4.74 1.32 6.8L12 17.77l-6.06 3.39 1.32-6.8L2.2 9.62l6.86-.84z"></path></svg></slot></span></span>
      </span>
      <input :for="value in values" :key="value" :spread="rating.inputProps(value)">
    </div>
  `),
})
class StyledRating {
  group = new Signal.State<Element | null>(null);
  /** Signals, as `<v-rating>` holds its `disabled` and `readOnly` props. */
  off = new Signal.State(false);
  locked = new Signal.State(false);

  rating = createRating({
    group: () => this.group.get(),
    name: 'stars',
    allowHalf: halves,
    disabled: () => this.off.get(),
    readOnly: () => this.locked.get(),
    labels: { group: 'Your rating' },
  });

  values = this.rating.values();

  /** Grouped by star as the component groups them: one value, or the half and the whole. */
  stars = [1, 2, 3, 4, 5].map((at) => ({
    at,
    values: this.values.filter((value) => Math.ceil(value) === at),
  }));

  itemProps(value: number): InputProps {
    const props = this.rating.itemProps(value);
    const previewed = this.rating.value() < value && this.rating.displayValue() >= value;
    return previewed ? { ...props, 'data-preview': true } : props;
  }
}

const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.volt-rating-item')];

export const scene: Scene = (look) => {
  for (const each of [false, true]) {
    halves = each;
    const { rating, off, locked } = show(StyledRating);
    // Unrated: every star hollow, the tab stop on the first.
    look();

    // A score, chosen by a press: three stars, or two and a half.
    step(() => items()[each ? 4 : 2]!.click());
    look();

    // The pointer over a star beyond the score, which lights the ones between
    // the two without choosing any of them.
    step(() => items().at(-1)!.dispatchEvent(new PointerEvent('pointerenter')));
    look();
    step(() => document.querySelector('.volt-rating')!.dispatchEvent(new PointerEvent('pointerleave')));

    // Out of use, with the score still showing.
    step(() => off.set(true));
    look();
    step(() => off.set(false));

    // A score nobody can change, which is an image rather than a group.
    step(() => locked.set(true));
    look();

    // And unrated again under it, by the primitive's own hand.
    step(() => locked.set(false));
    step(() => rating.clear());
    look();

    clear();
  }
};
