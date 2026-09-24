import { Component, Signal } from '@voltdev/core';
import { VBadge, VButton } from '@voltdev/ui/components';

@Component({
  selector: 'v-inbox',
  templateUrl: './badge.html',
  styleUrl: './badge.scss',
  imports: [VBadge, VButton],
})
export class Inbox {
  /**
   * The page's own count, handed to two badges as the signal itself: both
   * follow it, and neither holds a copy that could fall behind.
   */
  unread = new Signal.State<number | null>(3);

  /** Whether Ada is here, which is a status with no number in it. */
  online = new Signal.State(true);

  drafts = new Signal.State<number | null>(2);

  arrive = (): void => this.unread.set((this.unread.get() ?? 0) + 1);
  flood = (): void => this.unread.set((this.unread.get() ?? 0) + 100);
  read = (): void => this.unread.set(0);
  toggle = (): void => this.online.set(!this.online.get());
}
