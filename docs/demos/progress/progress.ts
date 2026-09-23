import { Component, Signal, onCleanup } from '@voltdev/core';
import { VButton, VProgress } from '@voltdev/ui/components';

@Component({
  selector: 'v-upload',
  templateUrl: './progress.html',
  styleUrl: './progress.scss',
  imports: [VButton, VProgress],
})
export class Upload {
  /**
   * How much of the upload has landed, or `null` for the bar that says work is
   * happening without claiming how much is left.
   */
  sent = new Signal.State<number | null>(0);

  /** A second bar over a range that counts things rather than percentages. */
  copied = new Signal.State<number | null>(3);

  /** What that range reads as, since "38%" of eight files is not what happened. */
  files = (value: number): string => `${value} of 8 files`;

  /** The upload in flight, so that starting a second one does not race the first. */
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // A demo frame is mounted and thrown away as the reader moves down the
    // page, and an interval nobody stopped outlives it.
    onCleanup(() => this.stop());
  }

  start = (): void => {
    this.stop();
    this.sent.set(0);
    this.timer = setInterval(() => {
      const sent = this.sent.get() ?? 0;
      if (sent >= 100) {
        this.stop();
        return;
      }
      this.sent.set(sent + 5);
    }, 200);
  };

  /** The server stopped saying how much it had, so the bar stops saying it too. */
  forget = (): void => {
    this.stop();
    this.sent.set(null);
  };

  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
