import { Component, Signal } from '@voltdev/core';

/**
 * A component is a class. `@Component` names its selector and points at the
 * markup and styles beside it, both of which are compiled at build time.
 *
 * Nothing here re-renders: `count` is a signal, so pressing a button updates
 * the one text node that reads it and leaves the rest of the DOM untouched.
 */
@Component({
  selector: 'v-app',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  count = new Signal.State(0);

  /** Derived state. Recomputed only when `count` actually changes. */
  doubled = new Signal.Computed(() => this.count.get() * 2);

  add(step: number): void {
    this.count.set(this.count.get() + step);
  }

  reset(): void {
    this.count.set(0);
  }
}
