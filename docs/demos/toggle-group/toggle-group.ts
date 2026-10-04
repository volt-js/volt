import { Component, Signal } from '@voltdev/core';
import { VToggle, VToggleGroup } from '@voltdev/ui/components';

@Component({
  selector: 'v-text-tools',
  templateUrl: './toggle-group.html',
  styleUrl: './toggle-group.scss',
  imports: [VToggle, VToggleGroup],
})
export class TextTools {
  /** One value that must stay chosen. */
  align = new Signal.State('start');

  /** Any number at once, in the order they were pressed. */
  marks = new Signal.State<string[]>(['bold']);

  /** A toggle on its own, whose state the page holds. */
  wrap = new Signal.State(true);

  /** One value that may go back to none, which a single value says as `''`. */
  view = new Signal.State('list');
}
