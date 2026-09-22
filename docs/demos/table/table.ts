import { Component, Signal } from '@voltdev/core';
import { VButton, VTable, VTableColumn } from '@voltdev/ui/components';

interface Person {
  id: number;
  name: string;
  role: string;
  owed: number;
}

@Component({
  selector: 'v-people',
  templateUrl: './table.html',
  imports: [VButton, VTable, VTableColumn],
})
export class People {
  people = new Signal.State<Person[]>([
    { id: 1, name: 'Ada Lovelace', role: 'Analyst', owed: 1240 },
    { id: 2, name: 'Grace Hopper', role: 'Engineer', owed: 0 },
    { id: 3, name: 'Karen Spärck Jones', role: 'Researcher', owed: 87.5 },
  ]);

  chosen = new Signal.State<ReadonlySet<number>>(new Set([2]));

  money(amount: unknown): string {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(
      Number(amount),
    );
  }

  isChosen(row: Record<string, unknown>): boolean {
    return this.chosen.get().has(row['id'] as number);
  }

  toggle = (row: Record<string, unknown>): void => {
    const next = new Set(this.chosen.get());
    const id = row['id'] as number;
    if (!next.delete(id)) next.add(id);
    this.chosen.set(next);
  };
}
