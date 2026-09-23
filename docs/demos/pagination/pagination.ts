import { Component, Signal } from '@voltdev/core';
import { VPagination } from '@voltdev/ui/components';

@Component({
  selector: 'v-elements',
  templateUrl: './pagination.html',
  styleUrl: './pagination.scss',
  imports: [VPagination],
})
export class Elements {
  elements = [
    'Hydrogen', 'Helium', 'Lithium', 'Beryllium', 'Boron', 'Carbon', 'Nitrogen', 'Oxygen',
    'Fluorine', 'Neon', 'Sodium', 'Magnesium', 'Aluminium', 'Silicon', 'Phosphorus',
    'Sulfur', 'Chlorine', 'Argon', 'Potassium', 'Calcium', 'Scandium', 'Titanium',
    'Vanadium', 'Chromium', 'Manganese', 'Iron', 'Cobalt', 'Nickel', 'Copper', 'Zinc',
  ];

  /** The page holds the page, so the list and the pager read the one signal. */
  at = new Signal.State(4);

  /** A signal, so the list is drawn again once the pager is there to ask. */
  pager = new Signal.State<VPagination | null>(null);

  /**
   * Which items this page shows, from the pager rather than from `at`: the
   * pager's range is clamped to the pages there are, and the signal is not.
   */
  range(): { start: number; end: number } {
    return this.pager.get()?.pagination.range() ?? { start: 0, end: 0 };
  }

  shown(): string[] {
    const { start, end } = this.range();
    return start === 0 ? [] : this.elements.slice(start - 1, end);
  }
}
