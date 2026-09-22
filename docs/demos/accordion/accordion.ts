import { Component, Signal } from '@voltdev/core';
import { VAccordion, VAccordionItem, VButton } from '@voltdev/ui/components';

@Component({
  selector: 'v-questions',
  templateUrl: './accordion.html',
  styleUrl: './accordion.scss',
  imports: [VAccordion, VAccordionItem, VButton],
})
export class Questions {
  /** The page holds the open sections, so the widget and the note read one signal. */
  open = new Signal.State<string[]>(['delivery']);

  toDelivery = (): void => this.open.set(['delivery']);
}
