import { Component, Signal } from '@voltdev/core';

/**
 * A `csr` page: it is behind a login and gains nothing from a server, so the
 * server sends the shell and this renders in the browser.
 *
 * That is the promise the roadmap makes about server rendering being a choice.
 * Turning `start` on for the application did not take it away for this route.
 */
@Component({ selector: 'v-dashboard', templateUrl: './dashboard.html' })
export class Dashboard {
  count = new Signal.State(0);
  bump(): void {
    this.count.set(this.count.get() + 1);
  }
}
