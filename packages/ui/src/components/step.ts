import { Component, Prop, Signal, useContext } from '@voltdev/core';
import type { NavigationProps } from '@voltdev/primitives';
import { StepperContext, type VStepper } from './stepper.js';

/**
 * One step of a stepper: the step in the list, and the panel it shows.
 *
 * It draws the step itself, inside the list, so whatever a caller writes on
 * the tag lands on the button they can see; what is written inside the tag is
 * the panel, which the stepper draws after the list while this is the current
 * step.
 *
 * ```html
 * <v-step label="Delivery" description="Address and date" :errored="postcodeInvalid.get()">
 *   <address-form></address-form>
 * </v-step>
 * ```
 *
 * The step's words are `label`. For a step that is more than a line of text,
 * write the `label` slot — which keeps the content of the tag meaning the
 * panel, the larger of the two things by far:
 *
 * ```html
 * <v-step>
 *   <template :slot-label><v-icon name="card"></v-icon> Payment</template>
 *   <payment-form></payment-form>
 * </v-step>
 * ```
 */
@Component({ selector: 'v-step', templateUrl: './step.html' })
export class VStep {
  /** The step's words, when they are a line of text; otherwise fill the `label` slot. */
  @Prop() label = new Signal.State('');
  /** A second, quieter line under the label — "Optional", "Address and date". */
  @Prop() description = new Signal.State('');
  /**
   * Whether this step's work is done. Unset, it is done once the user has been
   * past it, which is right for a flow that validates as it goes.
   *
   * Say so either way when that is not true: a step the user filled in and
   * then invalidated is not complete, whatever they have walked past, and a
   * step whose work was done somewhere else is complete before they reach it
   * — which, in a linear stepper, is also what lets them select the steps
   * after it.
   */
  @Prop() complete = new Signal.State<boolean | undefined>(undefined);
  /**
   * Something on this step needs fixing. Said over every other status, even
   * while the user is on it, because that is the thing worth saying about it;
   * the step still says it is the current one.
   *
   * Not `error`, which is what the primitive calls the status: `error` is a
   * DOM event, so `:error` on any tag is a listener, and on a component tag a
   * refusal.
   *
   * This and the two either side of it are on when written bare, when bound to
   * something true, and when written with any value at all — `errored="true"`
   * means what it says. Bind `false` to say no.
   */
  @Prop() errored = new Signal.State(false);
  /**
   * The step cannot be used at all. The arrow keys and `next` step over it,
   * and neither a click nor a key selects it, while it stays announced among
   * the others — unlike a step the flow has not reached yet, which the arrows
   * still land on, so a keyboard user can read ahead.
   */
  @Prop() disabled = new Signal.State(false);
  /**
   * The step's own id, for a link or a test to find it by.
   *
   * Declared rather than left to fall through to `:host`, because the
   * primitive writes an id on the step too — it is how the panel is named — and
   * two spreads writing one attribute would leave whichever ran last. Declared,
   * the caller's is the one the step carries, and the panel is named by it.
   */
  @Prop() id = new Signal.State<string | undefined>(undefined);

  /** The `<li>` this draws, which is how the stepper learns where the step is. */
  element: HTMLElement | null = null;
  /** The step itself, which is where focus goes when its panel is shown under it. */
  button: HTMLElement | null = null;

  /**
   * The stepper this was written inside, read while the field initializes —
   * which is when a step is inside the stepper's own render.
   */
  readonly stepper: VStepper = (() => {
    const stepper = useContext(StepperContext);
    if (!stepper) {
      throw new Error(
        '[volt] <v-step> has to be written inside <v-stepper>: its step belongs in that ' +
          'list, and the panel written inside it is drawn by the stepper it belongs to.',
      );
    }
    return stepper;
  })();

  constructor() {
    this.stepper.steps.add(this);
  }

  /** What the step carries: the primitive's, under the caller's id when there is one. */
  stepProps(): NavigationProps {
    const own = this.stepper.stepper.stepProps(this.index());
    return { ...own, id: this.id.get() ?? own['id'] };
  }

  /** Where this step is, counted from 0 — which is what the primitive knows it by. */
  index(): number {
    return this.stepper.steps.all.get().indexOf(this);
  }

  /** Whether a step follows this one, which is what the line after it leads to. */
  last(): boolean {
    return this.stepper.steps.all.get().at(-1) === this;
  }

  /**
   * What the marker shows: the step's number, or `!` while it is in error.
   *
   * A glyph rather than a colour, because the colour is what a forced palette
   * takes. A complete step's number is taken away by the sheet, which draws a
   * check in its place.
   */
  mark(): string {
    const index = this.index();
    return this.stepper.stepper.status(index) === 'error' ? '!' : String(index + 1);
  }
}
