import { Component, Signal } from '@voltdev/core';
import { VMenu, VMenuItem, VMenuSeparator } from '@voltdev/ui/components';

@Component({
  selector: 'v-report-actions',
  templateUrl: './menu.html',
  styleUrl: './menu.scss',
  imports: [VMenu, VMenuItem, VMenuSeparator],
})
export class ReportActions {
  locked = new Signal.State(true);
  wrap = new Signal.State(false);
  done = new Signal.State<string | null>(null);

  /** One callback for the whole sheet, keyed by the value each item carries. */
  run = (value: string | undefined): void => {
    this.done.set(value ?? null);
  };

  /** An item with a state of its own keeps the menu open to be toggled again. */
  toggleWrap = (): void => {
    this.wrap.set(!this.wrap.get());
    this.done.set(this.wrap.get() ? 'wrap on' : 'wrap off');
  };

  toggleLock = (): void => {
    this.locked.set(!this.locked.get());
    this.done.set(this.locked.get() ? 'locked' : 'unlocked');
  };

  summary(): string {
    const done = this.done.get();
    return done === null ? 'Nothing chosen yet.' : `Last chosen: ${done}.`;
  }
}
