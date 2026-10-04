import { Component, Signal } from '../../volt.js';
import { Badge } from './badge.js';
import { Broken } from './broken.js';
import { Frame } from './frame.js';
import { List } from './list.js';
import { Pages } from './pages.js';
import { Rows, type Person } from './rows.js';
import { Table } from '../lib/types/table.js';
import { Tile } from '../lib/types/tile.js';

@Component({
  selector: 'v-page',
  templateUrl: './page.html',
  imports: [Rows, Table, Frame, List, Pages, Tile, Badge, Broken],
})
export class Page {
  /** A value from an untyped library, say: nothing about it says signal. */
  loose: any = null;
  vague: unknown = null;
  count = new Signal.State(0);
  /** The page's own, of a different type from the slot's name of the same spelling. */
  name = 1.5;
  counts = [1, 2];
  /** Left unannotated, so it is `never[]`, and its rows are `never`. */
  nothing = [];
  people: Person[] = [];
  /** Keyed by exactly the two states `<v-badge>` hands over, and no other string. */
  labels: Record<'done' | 'todo', string> = { done: 'Done', todo: 'To do' };
  heading(level: 1 | 2 | 3): string {
    return `h${level}`;
  }
  toned(tone: 'calm' | 'loud'): string {
    return tone;
  }
}
