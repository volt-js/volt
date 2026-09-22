import { Component, Signal } from '@voltdev/core';
import { VSwitch } from '@voltdev/ui/components';

interface Channel {
  name: string;
  on: Signal.State<boolean>;
}

@Component({
  selector: 'v-notifications',
  templateUrl: './switch.html',
  styleUrl: './switch.scss',
  imports: [VSwitch],
})
export class Notifications {
  channels: Channel[] = [
    { name: 'Email', on: new Signal.State(true) },
    { name: 'Push', on: new Signal.State(false) },
    { name: 'Weekly digest', on: new Signal.State(true) },
  ];

  /** Turning this one on refuses the three below without forgetting them. */
  quiet = new Signal.State(false);

  /** What the page would be doing this second, which is what a switch promises. */
  sending(): string {
    if (this.quiet.get()) return 'nothing until you say otherwise';
    const on = this.channels.filter((channel) => channel.on.get());
    return on.length ? on.map((channel) => channel.name.toLowerCase()).join(', ') : 'nothing';
  }
}
