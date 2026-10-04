import { Component, Signal } from '../../volt.js';

export interface Person {
  id: number;
  name: string;
  tags: string[];
}

/** A child in the same project, whose outlet says what each row is handed. */
@Component({ selector: 'v-rows', templateUrl: './rows.html' })
export class Rows {
  people: Person[] = [];
  /** Handed to the content as it is, so content that renders it bare is wrong. */
  total = new Signal.State(0);
}
