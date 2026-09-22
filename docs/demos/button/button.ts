import { Component, Signal } from '@voltdev/core';
import { VButton } from '@voltdev/ui/components';

@Component({
  selector: 'v-buttons',
  templateUrl: './button.html',
  styleUrl: './button.scss',
  imports: [VButton],
})
export class Buttons {
  busy = new Signal.State(false);
  presses = new Signal.State(0);

  start = (): void => {
    this.presses.set(this.presses.get() + 1);
    this.busy.set(true);
    setTimeout(() => this.busy.set(false), 1200);
  };
}
