/**
 * Browser entry for the benchmark.
 *
 * The happy-dom suite in `test/` measures the update path, where Volt's own
 * work dominates. Create and clear are dominated there by happy-dom's
 * JavaScript DOM, so real numbers for those need a real browser — this page.
 *
 *   pnpm --filter @voltdev/benchmarks run dev
 */

import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { BenchApp } from './bench-app.js';

interface Timing {
  name: string;
  ms: number;
}

@Component({
  selector: 'v-harness',
  imports: [BenchApp],
  templateUrl: './harness.html',
})
export class Harness {
  bench: BenchApp | null = null;
  report = new Signal.State('Ready.');

  private readonly timings: Timing[] = [];

  /** Time an operation including the DOM work its signal writes trigger. */
  private measure(name: string, operation: () => void): number {
    const started = performance.now();
    operation();
    flushSync();
    // The layout the writes above made necessary, forced here so it is inside
    // the measurement rather than after it. Without this the number is the
    // cost of scheduling the work, and a change that moved work into layout
    // would read as an improvement.
    void document.body.offsetHeight;
    const ms = performance.now() - started;

    this.timings.unshift({ name, ms });
    this.timings.length = Math.min(this.timings.length, 12);
    this.report.set(
      this.timings.map((t) => `${t.name.padEnd(20)}${t.ms.toFixed(2).padStart(9)} ms`).join('\n'),
    );
    return ms;
  }

  run(count: number): number {
    return this.measure(`create ${count}`, () => this.bench?.run(count));
  }

  /**
   * Click a row's label, which is what `select row` is.
   *
   * Driven through a real click rather than by calling `select` directly, so
   * the delegated listener and the handler lookup are inside the number. That
   * is the operation js-framework-benchmark times, and calling the method
   * would measure a different, smaller thing.
   */
  selectRow(index: number): number {
    const links = document.querySelectorAll<HTMLElement>('.col-label a');
    const link = links[index];
    if (!link) return Number.NaN;
    return this.measure('select row', () => link.click());
  }

  append(): void {
    this.measure('append 1,000', () => this.bench?.add(1000));
  }

  update(): void {
    this.measure('update every 10th', () => this.bench?.update());
  }

  swap(): void {
    this.measure('swap rows', () => this.bench?.swap());
  }

  clear(): void {
    this.measure('clear', () => this.bench?.clear());
  }
}

const harness = mount(Harness, '#app').instance as Harness;

/**
 * The same operations, reachable from outside the page.
 *
 * `browser/run.mjs` drives these over the DevTools protocol so the comparison
 * between two builds is taken by one script under one browser, rather than by
 * a person clicking twice and reading two screens.
 */
(globalThis as Record<string, unknown>)['__bench'] = {
  create: (count: number) => harness.run(count),
  select: (index: number) => harness.selectRow(index),
  update: () => harness.update(),
  swap: () => harness.swap(),
  clear: () => harness.clear(),
  rows: () => document.querySelectorAll('.col-label').length,
};
