import { Component, Signal } from '../../volt.js';

export interface Row {
  id: number;
  label: string;
}

@Component({ selector: 'v-list', templateUrl: './list.html' })
export class List {
  rows = new Signal.State<Row[]>([]);
}
