import { Component, Signal } from '@voltdev/core';
import { VCheckbox } from '@voltdev/ui/components';
import type { CheckedState } from '@voltdev/primitives';

interface Topping {
  name: string;
  on: Signal.State<CheckedState>;
}

@Component({
  selector: 'v-toppings',
  templateUrl: './checkbox.html',
  styleUrl: './checkbox.scss',
  imports: [VCheckbox],
})
export class Toppings {
  toppings: Topping[] = [
    { name: 'Olives', on: new Signal.State<CheckedState>(true) },
    { name: 'Anchovies', on: new Signal.State<CheckedState>(false) },
    { name: 'Capers', on: new Signal.State<CheckedState>(false) },
  ];

  /** The parent box, which is where the third state earns its keep. */
  all = new Signal.State<CheckedState>('indeterminate');

  /** Follow the children: on when every one is, mixed while only some are. */
  sync = (): void => {
    const on = this.toppings.filter((topping) => topping.on.get() === true).length;
    this.all.set(on === 0 ? false : on === this.toppings.length ? true : 'indeterminate');
  };

  /**
   * Lead the children. Written straight to their signals, so each box follows
   * without the callback that would put this back into a loop.
   */
  setAll = (state: CheckedState): void => {
    if (state === 'indeterminate') return;
    for (const topping of this.toppings) topping.on.set(state);
  };

  chosen(): string {
    const names = this.toppings
      .filter((topping) => topping.on.get() === true)
      .map((topping) => topping.name.toLowerCase());
    return names.length ? names.join(', ') : 'nothing';
  }
}
