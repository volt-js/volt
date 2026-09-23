import { Component, Signal } from '@voltdev/core';
import { VAlert, VButton } from '@voltdev/ui/components';

@Component({
  selector: 'v-notices',
  templateUrl: './alert.html',
  styleUrl: './alert.scss',
  imports: [VAlert, VButton],
})
export class Notices {
  /** The save that failed, which is the one alert this page drives itself. */
  failed = new Signal.State(false);
  attempts = new Signal.State(0);
  /** The alert itself, for the one thing a signal cannot do — see `retry`. */
  failure: VAlert | null = null;

  save = (): void => {
    this.failed.set(true);
  };

  /**
   * The action does not take the alert down — an alert is a statement about
   * the page, and `Retry` does not make it untrue. This is the page deciding
   * the statement no longer holds.
   *
   * Through the primitive rather than through `failed`, though the two end in
   * the same place, because the button being pressed is inside the box about
   * to be removed: `close()` puts focus back where it came from first, and a
   * write straight to the signal cannot, which drops a keyboard user on
   * `<body>` at the top of the document.
   */
  retry = (): void => {
    this.attempts.set(this.attempts.get() + 1);
    this.failure?.alert.close();
  };
}
