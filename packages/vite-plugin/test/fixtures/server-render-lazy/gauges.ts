import { Component } from '@voltdev/core';
import { lazy } from '@voltdev/core/runtime';

/**
 * A page with a component whose chunk loads in a browser and not on a server.
 * The server writes the fallback in its place; the browser replaces it.
 */
const Gauge = lazy('v-gauge', () => import('./gauge.js'), {
  fallback: () => 'Loading the gauge…',
});

@Component({ selector: 'v-gauges', imports: [Gauge], templateUrl: './gauges.html' })
export class Gauges {}
