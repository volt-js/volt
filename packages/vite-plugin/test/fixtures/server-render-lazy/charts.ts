import { Component } from '@voltdev/core';
import { lazy } from '@voltdev/core/runtime';

/**
 * A page with a component that arrives in a chunk of its own.
 *
 * This directory is laid over a copy of the serverRender fixture by
 * `claim.test.ts`, which adds `/charts` and `/gauges` to that fixture's table;
 * the pages every other test builds carry no chunk only one test asks for.
 *
 * Asked for through the runtime's `lazy` rather than left to the build, so
 * the fixture decides what is split and the test knows which chunk to wait
 * for. The chunk loads on both sides: the server waits for it and writes the
 * component, and the browser claims what the server wrote.
 */
const Meter = lazy('v-meter', () => import('./meter.js'), {
  fallback: () => 'Loading the meter…',
});

@Component({ selector: 'v-charts', imports: [Meter], templateUrl: './charts.html' })
export class Charts {}
