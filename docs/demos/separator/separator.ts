import { Component, Signal } from '@voltdev/core';
import { VButton, VSeparator } from '@voltdev/ui/components';

@Component({
  selector: 'v-dividers',
  templateUrl: './separator.html',
  styleUrl: './separator.scss',
  imports: [VButton, VSeparator],
})
export class Dividers {
  /**
   * How wide the sidebar is, as a percentage of the panes: the splitter's
   * value, and the width the markup gives the sidebar.
   */
  sidebar = new Signal.State(30);

  /** The sidebar's width as the markup writes it. */
  width(): Record<string, string> {
    return { 'inline-size': `${this.sidebar.get()}%` };
  }
}
