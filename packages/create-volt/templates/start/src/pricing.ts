import { Component, Signal, hydratable } from '@voltdev/core';
import { currentPlan } from './api.js';

/**
 * An `ssr` page: the answer depends on the request, so it is rendered per
 * request — and the value the server settled on is sent with the page rather
 * than fetched again the moment it arrives.
 *
 * `hydratable` is what carries it across: the server writes the signal's value
 * into the page, and the browser reads it back instead of starting from the
 * loading state a field initializer would have.
 */
@Component({ selector: 'v-pricing', templateUrl: './pricing.html' })
export class Pricing {
  plan: Signal.State<string> = hydratable('plan', () => '…');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.plan.set(await currentPlan());
  }
}
