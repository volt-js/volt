import { Component, Signal } from '../../volt.js';

@Component({ selector: 'v-counter', templateUrl: './counter.html' })
export class Counter {
  count = new Signal.State(0);
  label = 'Total';
  step = 1;

  increment(): void {
    this.count.set(this.count.get() + this.step);
  }

  press(event: KeyboardEvent): void {
    void event.key;
  }
}
