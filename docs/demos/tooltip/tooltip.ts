import { Component, Signal } from '@voltdev/core';
import { VButton, VTooltip } from '@voltdev/ui/components';

@Component({
  selector: 'v-toolbar-tips',
  templateUrl: './tooltip.html',
  styleUrl: './tooltip.scss',
  imports: [VButton, VTooltip],
})
export class ToolbarTips {
  saved = new Signal.State(0);

  /** The one tooltip here whose words change, to show a bound prop following. */
  hint(): string {
    const saved = this.saved.get();
    return saved === 0 ? 'Nothing saved yet' : `Saved ${saved} times`;
  }

  save = (): void => this.saved.set(this.saved.get() + 1);
}
