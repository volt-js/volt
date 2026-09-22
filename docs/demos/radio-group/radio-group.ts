import { Component, Signal } from '@voltdev/core';
import { VRadio, VRadioGroup } from '@voltdev/ui/components';

interface Plan {
  value: string;
  label: string;
  note: string;
  soldOut?: boolean;
}

@Component({
  selector: 'v-plans',
  templateUrl: './radio-group.html',
  styleUrl: './radio-group.scss',
  imports: [VRadio, VRadioGroup],
})
export class Plans {
  /** The page holds both answers, so the groups and the summary read one signal each. */
  plan = new Signal.State<string | null>('yearly');
  delivery = new Signal.State<string | null>('standard');

  plans: Plan[] = [
    { value: 'monthly', label: 'Monthly', note: '£9 a month' },
    { value: 'yearly', label: 'Yearly', note: 'Two months free' },
    { value: 'lifetime', label: 'Lifetime', note: 'Sold out', soldOut: true },
  ];

  chosen(): string {
    const plan = this.plans.find((each) => each.value === this.plan.get());
    return plan ? plan.label.toLowerCase() : 'nothing yet';
  }
}
