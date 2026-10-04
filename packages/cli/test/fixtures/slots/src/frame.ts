import { Component } from '../../volt.js';

/** A default slot that passes something, filled from the tag itself. */
@Component({ selector: 'v-frame', templateUrl: './frame.html' })
export class Frame {
  title = 'Frame';
}
