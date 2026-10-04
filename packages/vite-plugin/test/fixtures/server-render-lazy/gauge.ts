import { Component, Signal } from '@voltdev/core';

/**
 * The component `gauges.ts` fetches in a chunk of its own, and one a server
 * cannot load: it reads the window when it is evaluated, as a charting
 * library does, so importing it on a server throws before there is a
 * component to write.
 */
const pixelRatio = window.devicePixelRatio;

@Component({ selector: 'v-gauge', templateUrl: './gauge.html' })
export default class Gauge {
  count = new Signal.State(0);
  scale = pixelRatio;
  bump(): void {
    this.count.set(this.count.get() + 1);
  }
}
