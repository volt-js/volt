import { Component, Signal } from '@voltdev/core';
import { VButton, VNumberInput } from '@voltdev/ui/components';

/** What the pretend warehouse holds. */
const IN_STOCK = 12;

@Component({
  selector: 'v-order-line',
  templateUrl: './number-input.html',
  styleUrl: './number-input.scss',
  imports: [VButton, VNumberInput],
})
export class OrderLine {
  quantity = new Signal.State<number | null>(2);
  price = new Signal.State<number | null>(1234.5);
  weight = new Signal.State<number | null>(1.5);

  /** Written as dollars, and read back with the symbol dropped. */
  dollars: Intl.NumberFormatOptions = { style: 'currency', currency: 'USD' };

  /**
   * What the warehouse said about the last order. Cleared before each one:
   * the field lets go of a message on the next change to the box, and the
   * same words a second time are a change only once this has been.
   */
  refused = new Signal.State('');
  /** What the last submit came to, so the demo says whether it went. */
  result = new Signal.State('');

  /** The line's total, from the numbers rather than from anything on screen. */
  total(): string {
    const quantity = this.quantity.get();
    const price = this.price.get();
    if (quantity === null || price === null) return 'Fill in the quantity and the price.';
    return `Comes to ${new Intl.NumberFormat('en-US', this.dollars).format(quantity * price)}.`;
  }

  /**
   * The fields refuse the submit before this hears it, so the press is
   * answered rather than being silently swallowed.
   */
  order = async (event: Event): Promise<void> => {
    if (event.defaultPrevented) {
      this.result.set('Not sent — the messages above say why.');
      return;
    }
    event.preventDefault();
    this.refused.set('');
    this.result.set('Checking stock…');

    await new Promise((resolve) => setTimeout(resolve, 400));

    if ((this.quantity.get() ?? 0) > IN_STOCK) {
      this.refused.set(`Only ${IN_STOCK} left in stock.`);
      this.result.set('');
      return;
    }
    this.result.set(`Added ${this.quantity.get()} to the order.`);
  };
}
