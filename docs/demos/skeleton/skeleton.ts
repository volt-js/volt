import { Component, Signal, onCleanup } from '@voltdev/core';
import { VButton, VSkeleton, VSkeletonShape } from '@voltdev/ui/components';

@Component({
  selector: 'v-feed',
  templateUrl: './skeleton.html',
  styleUrl: './skeleton.scss',
  imports: [VButton, VSkeleton, VSkeletonShape],
})
export class Feed {
  /** What a page would hold a request's status in. */
  loading = new Signal.State(true);

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.answer();
    onCleanup(() => clearTimeout(this.timer));
  }

  /** Put the boxes back and take a moment to reply, the way a network does. */
  reload(): void {
    this.loading.set(true);
    this.answer();
  }

  private answer(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.loading.set(false), 1600);
  }
}
