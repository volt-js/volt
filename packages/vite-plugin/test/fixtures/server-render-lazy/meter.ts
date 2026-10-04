import { Component, Signal } from '@voltdev/core';

/**
 * The component `charts.ts` fetches in a chunk of its own.
 *
 * `side` is which side built this instance. The server prints one word and
 * the browser writes the other over it, into the same text node, which is
 * what lets a test see the chunk land on a page whose nodes never change.
 */
@Component({ selector: 'v-meter', templateUrl: './meter.html' })
export default class Meter {
  count = new Signal.State(0);
  side = __VOLT_SERVER__ ? 'server' : 'browser';
  bump(): void {
    this.count.set(this.count.get() + 1);
  }
}
