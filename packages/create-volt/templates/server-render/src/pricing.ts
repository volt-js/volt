import { Component } from '@voltdev/core';
import { routeData } from '@voltdev/router';

/**
 * An `ssr` page: the answer depends on the request, so it is rendered per
 * request.
 *
 * The plan is the route's loader's answer (see `routes.ts`), not something
 * this component fetches. A loader runs before the page is rendered, so its
 * answer is in the first byte; a fetch started while rendering answers after
 * the bytes it would have filled have been written.
 */
@Component({ selector: 'v-pricing', templateUrl: './pricing.html' })
export class Pricing {
  plan = routeData<string>();
}
