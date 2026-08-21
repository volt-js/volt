import { Component, Signal } from '../../volt.js';

export interface Row {
  id: number;
  label: string;
}

@Component({ selector: 'v-loop', templateUrl: './loop.html' })
export class Loop {
  rows = new Signal.State<Row[]>([]);
}
