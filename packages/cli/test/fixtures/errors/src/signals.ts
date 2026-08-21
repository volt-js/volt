import { Component, Signal } from '../../volt.js';

@Component({ selector: 'v-signals', templateUrl: './signals.html' })
export class Signals {
  count = new Signal.State(0);
  open = new Signal.State(false);
  label = 'total';
}
