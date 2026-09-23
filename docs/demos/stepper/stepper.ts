import { Component, Signal } from '@voltdev/core';
import { VButton, VInput, VStep, VStepper } from '@voltdev/ui/components';

@Component({
  selector: 'v-checkout',
  templateUrl: './stepper.html',
  styleUrl: './stepper.scss',
  imports: [VButton, VInput, VStep, VStepper],
})
export class Checkout {
  /** The page holds the position, so the note and the stepper read the one signal. */
  step = new Signal.State(0);
  postcode = new Signal.State('');

  /** Whether Continue found the postcode empty, which is what puts Delivery in error. */
  missing = new Signal.State(false);
  placed = new Signal.State(false);

  /** The stepper, for its primitive: `next` and `previous` are what Continue and Back call. */
  checkout: VStepper | null = null;

  next = (): void => this.checkout?.stepper.next();
  back = (): void => this.checkout?.stepper.previous();

  /**
   * Continue is where the step is checked, which is why the primitive never
   * refuses `next`: by the time it is called, the flow has said yes.
   */
  deliver = (): void => {
    this.missing.set(this.postcode.get().trim() === '');
    if (!this.missing.get()) this.next();
  };

  place = (): void => this.placed.set(true);

  said(): string {
    if (this.placed.get()) return 'Ordered. The steps behind you can still be revisited.';
    return (
      `Step ${this.step.get() + 1} of 4. A step past the furthest one reached is refused — ` +
      'try one, then Continue with the postcode empty.'
    );
  }
}
