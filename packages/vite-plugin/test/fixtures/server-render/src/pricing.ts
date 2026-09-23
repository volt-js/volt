import { Component } from '@voltdev/core';
import { routeData } from '@voltdev/router';

@Component({ selector: 'v-pricing', templateUrl: './pricing.html' })
export class Pricing {
  plan = routeData<string>();
}
