import { Component, Signal } from '@voltdev/core';

@Component({ selector: 'v-greeting', templateUrl: './greeting.html' })
export class Greeting {
  name = new Signal.State('world');
}
