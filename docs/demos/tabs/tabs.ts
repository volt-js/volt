import { Component, Signal } from '@voltdev/core';
import { VButton, VTab, VTabs } from '@voltdev/ui/components';

@Component({
  selector: 'v-settings',
  templateUrl: './tabs.html',
  styleUrl: './tabs.scss',
  imports: [VButton, VTab, VTabs],
})
export class Settings {
  /** The page holds the selection, so the widget and the page read the one signal. */
  section = new Signal.State('account');

  toBilling = (): void => this.section.set('billing');
}
