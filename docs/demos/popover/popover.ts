import { Component, Signal } from '@voltdev/core';
import { VButton, VPopover } from '@voltdev/ui/components';

@Component({
  selector: 'v-run-filters',
  templateUrl: './popover.html',
  styleUrl: './popover.scss',
  imports: [VButton, VPopover],
})
export class RunFilters {
  filters = ['Failed', 'Slow', 'Flaky'];
  chosen = new Signal.State<readonly string[]>(['Failed']);

  isOn(filter: string): boolean {
    return this.chosen.get().includes(filter);
  }

  toggle = (filter: string): void => {
    const chosen = this.chosen.get();
    this.chosen.set(
      chosen.includes(filter) ? chosen.filter((each) => each !== filter) : [...chosen, filter],
    );
  };

  /** The heading says how many, so the panel is worth reading before it opens. */
  heading(): string {
    const count = this.chosen.get().length;
    return count === 0 ? 'Filters' : `Filters (${count})`;
  }

  summary(): string {
    const chosen = this.chosen.get();
    return chosen.length === 0 ? 'Showing every run.' : `Showing ${chosen.join(' and ')} runs.`;
  }
}
