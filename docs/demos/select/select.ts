import { Component, Signal } from '@voltdev/core';
import { VOption, VSelect } from '@voltdev/ui/components';

@Component({
  selector: 'v-country',
  templateUrl: './select.html',
  styleUrl: './select.scss',
  imports: [VOption, VSelect],
})
export class Country {
  chosen = new Signal.State<readonly string[]>(['jp']);

  countries = [
    { code: 'fr', name: 'France' },
    { code: 'jp', name: 'Japan' },
    { code: 'ke', name: 'Kenya' },
    { code: 'pe', name: 'Peru' },
    { code: 'aq', name: 'Antarctica', closed: true },
  ];

  name(): string {
    const code = this.chosen.get()[0];
    return this.countries.find((each) => each.code === code)?.name ?? 'nowhere';
  }
}
