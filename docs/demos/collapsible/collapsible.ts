import { Component, Signal } from '@voltdev/core';
import { VButton, VCollapsible } from '@voltdev/ui/components';

@Component({
  selector: 'v-order-details',
  templateUrl: './collapsible.html',
  styleUrl: './collapsible.scss',
  imports: [VButton, VCollapsible],
})
export class OrderDetails {
  /** The page holds it, so the trigger, the button below and the note read one signal. */
  details = new Signal.State(false);

  items = ['Linen shirt', 'Cotton scarf', 'Canvas tote'];

  toggle = (): void => this.details.set(!this.details.get());
}
