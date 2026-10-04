import { Component, Signal } from '@voltdev/core';
import { VSlider } from '@voltdev/ui/components';

@Component({
  selector: 'v-price-filter',
  templateUrl: './slider.html',
  styleUrl: './slider.scss',
  imports: [VSlider],
})
export class PriceFilter {
  /** One number: a slider. */
  volume = new Signal.State<readonly number[]>([40]);

  /** Two numbers: a range, with the span between them filled. */
  price = new Signal.State<readonly number[]>([20, 80]);

  /** What a screen reader hears in place of the number, and what the note says. */
  pounds = (value: number): string => `£${value}`;

  /** Ticks with words under them make a scale; bare ticks are decoration. */
  marks = [
    { value: 0, label: '£0' },
    { value: 50, label: '£50' },
    { value: 100, label: '£100' },
  ];

  /** The value once a drag has been let go of, which is the one to search with. */
  searched = new Signal.State<readonly number[]>([20, 80]);

  commit = (values: readonly number[]): void => this.searched.set(values);

  span(values: readonly number[]): string {
    const [low, high] = values;
    return `${this.pounds(low ?? 0)} to ${this.pounds(high ?? 0)}`;
  }
}
