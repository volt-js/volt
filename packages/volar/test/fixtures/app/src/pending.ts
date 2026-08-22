import { Component } from '../../volt.js';

@Component({ selector: 'v-pending', templateUrl: './pending.html' })
export class Pending {
  user = { name: 'Ada', email: 'ada@example.com' };
}
