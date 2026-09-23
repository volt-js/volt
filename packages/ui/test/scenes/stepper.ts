import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, effect } from '@voltdev/core';
import { createStepper } from '@voltdev/primitives';
import { show, step, type Scene } from '../scene.ts';

/**
 * What a `<v-step>` tag says about itself. Complete, errored and disabled are
 * the page's knowledge rather than the primitive's, so they are held here and
 * handed over as accessors, the way the component hands over its tags' props.
 */
interface Stage {
  label: string;
  description: string;
  /** Unset, the step is judged by how far the user has been. */
  complete: Signal.State<boolean | undefined>;
  errored: Signal.State<boolean>;
  disabled: Signal.State<boolean>;
}

function stage(label: string, description = ''): Stage {
  return {
    label,
    description,
    complete: new Signal.State<boolean | undefined>(undefined),
    errored: new Signal.State(false),
    disabled: new Signal.State(false),
  };
}

/** `stepper.html` with each `<v-step>`'s `step.html` drawn in place. */
@Component({
  selector: 'v-styled-stepper',
  render: compileTemplate(`
    <div>
      <nav class="volt-stepper" :spread="stepper.navProps()">
        <ol class="volt-stepper-list" :ref="list" :spread="stepper.listProps()">
          <li :for="(each, index) in stages" :key="each.label" class="volt-stepper-item">
            <button type="button" class="volt-stepper-step" :spread="stepper.stepProps(index)">
              <span class="volt-stepper-marker" aria-hidden="true">
                <span class="volt-stepper-number">{ mark(index) }</span>
                <span class="volt-stepper-check"></span>
              </span>
              <span class="volt-stepper-text">
                <span class="volt-stepper-label">{ each.label }</span>
                <span :if="each.description" class="volt-stepper-description">{ each.description }</span>
              </span>
              <span class="volt-stepper-status">{ stepper.statusLabel(index) }</span>
            </button>
            <span :if="index < stages.length - 1" class="volt-stepper-separator"
                  :spread="stepper.separatorProps()"></span>
          </li>
        </ol>
      </nav>
      <div :for="(each, index) in stages" :key="each.label" class="volt-stepper-panel"
           :spread="stepper.panelProps(index)">{ each.label }</div>
    </div>
  `),
})
class StyledStepper {
  stages = [
    stage('Account'),
    stage('Delivery', 'Where to'),
    stage('Payment', 'Card or invoice'),
    stage('Review'),
  ];
  list = new Signal.State<Element | null>(null);

  /**
   * The furthest step the user has been on. The primitive keeps the same
   * number, but falls back to it only when it is handed no `complete` at all —
   * and a step here may speak for itself or not, one at a time.
   */
  reached = new Signal.State(0);

  stepper = createStepper({
    list: () => this.list.get(),
    count: () => this.stages.length,
    complete: (index) => this.stages[index]!.complete.get() ?? index < this.reached.get(),
    error: (index) => this.stages[index]!.errored.get(),
    disabled: (index) => this.stages[index]!.disabled.get(),
    // A linear flow, because it refuses a step a free one would let the user
    // select, and one that is complete among them is a rule of its own; a
    // free flow refuses only a step that is off, which a linear one also does.
    linear: true,
    // On its side, because the horizontal layout is the base rules, which a
    // vertical list matches as well as the ones that turn it.
    orientation: 'vertical',
  });

  constructor() {
    effect(() => {
      const here = this.stepper.value();
      Signal.subtle.untrack(() => {
        if (here > this.reached.get()) this.reached.set(here);
      });
    });
  }

  /** A glyph in the marker rather than only a colour, which a forced palette takes. */
  mark(index: number): string {
    return this.stepper.status(index) === 'error' ? '!' : String(index + 1);
  }
}

export const scene: Scene = (look) => {
  const { stepper, stages } = show(StyledStepper);
  const [, delivery, payment, review] = stages as [Stage, Stage, Stage, Stage];

  // Each change below puts one of the four steps in a state none of the
  // others is in, and none undoes another, so one look sees them all.

  // Continue, which the flow never refuses, since it is what just did the
  // validating: the first step is behind the user, complete and still
  // selectable, and the line after it walked.
  step(() => stepper.next());
  // Broken while the user is on it, which still has to read as the step they
  // are on.
  step(() => delivery.errored.set(true));
  // Done somewhere else, ahead of a step that is not: complete, and refused.
  step(() => review.complete.set(true));
  // Out of use.
  step(() => payment.disabled.set(true));
  look();
};
