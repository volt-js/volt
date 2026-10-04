import { Component, Signal } from '@voltdev/core';
import { VButton, VRelativeTime } from '@voltdev/ui/components';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface Comment {
  readonly id: number;
  readonly author: string;
  readonly body: string;
  readonly at: Date;
}

@Component({
  selector: 'v-activity',
  templateUrl: './relative-time.html',
  styleUrl: './relative-time.scss',
  imports: [VButton, VRelativeTime],
})
export class Activity {
  /** When the frame opened, which every moment below is placed from. */
  private readonly opened = Date.now();

  /**
   * A thread whose stamps span the units: seconds that count as the page is
   * watched, minutes, hours, a day, and one past the default week, which is a
   * date with its hour behind it.
   */
  comments: readonly Comment[] = [
    { id: 1, author: 'Ada', body: 'Merged — thank you.', at: this.ago(20 * SECOND) },
    { id: 2, author: 'Grace', body: 'Rebased on main; the suite is green.', at: this.ago(4 * MINUTE) },
    { id: 3, author: 'Alan', body: 'One nit on the naming, otherwise good.', at: this.ago(5 * HOUR) },
    { id: 4, author: 'Katherine', body: 'Picking this up.', at: this.ago(DAY) },
    { id: 5, author: 'Edsger', body: 'Opened the issue.', at: this.ago(12 * DAY) },
  ];

  /** When the draft was last saved, or null before the first save. */
  saved = new Signal.State<Date | null>(null);
  save = (): void => this.saved.set(new Date());

  /** One moment, at each length the words come in, in three languages. */
  moment = this.ago(3 * HOUR);
  lengths: readonly Intl.RelativeTimeFormatStyle[] = ['long', 'short', 'narrow'];
  languages = [
    { tag: 'en', name: 'English' },
    { tag: 'fr', name: 'Français' },
    { tag: 'ja', name: '日本語' },
  ];

  private ago(distance: number): Date {
    return new Date(this.opened - distance);
  }
}
