import { Component } from '../../volt.js';

@Component({ selector: 'v-events', templateUrl: './events.html' })
export class Events {
  press(event: KeyboardEvent): void {
    void event.key;
  }
}
