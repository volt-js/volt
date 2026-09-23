import { Component, Signal } from '@voltdev/core';
import { VButton, VSpinner } from '@voltdev/ui/components';

@Component({
  selector: 'v-saving',
  templateUrl: './spinner.html',
  styleUrl: './spinner.scss',
  imports: [VButton, VSpinner],
})
export class Saving {
  /** A response that beats the delay, so nothing is ever drawn for it. */
  quick = new Signal.State(false);
  /** One that does not, which is the wait a spinner was invented for. */
  slow = new Signal.State(false);

  /** How the last press ended, so the delay is something to read rather than believe. */
  said = new Signal.State('Press one of them.');

  private save(which: Signal.State<boolean>, ms: number, then: string): void {
    if (which.get()) return;
    which.set(true);
    this.said.set(`Saving, and it will take ${ms}ms…`);
    setTimeout(() => {
      which.set(false);
      this.said.set(then);
    }, ms);
  }

  quickly = (): void =>
    this.save(this.quick, 200, 'Saved in 200ms. Nothing was drawn, and nothing was announced.');

  slowly = (): void =>
    this.save(this.slow, 2000, 'Saved in 2s. The ring appeared after the first half second.');
}
