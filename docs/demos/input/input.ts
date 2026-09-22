import { Component, Signal } from '@voltdev/core';
import { VButton, VInput } from '@voltdev/ui/components';

@Component({
  selector: 'v-signup',
  templateUrl: './input.html',
  styleUrl: './input.scss',
  imports: [VButton, VInput],
})
export class Signup {
  email = new Signal.State('');
  handle = new Signal.State('');

  /** What the last submit came to, so the demo says whether it went. */
  result = new Signal.State('');

  /** Handles already spoken for, so there is something to be refused over. */
  taken = ['ada', 'grace'];

  /** The room left, shown as the line of help rather than as a badge. */
  left(): string {
    const room = 12 - this.handle.get().length;
    return room === 12 ? 'Letters and numbers, up to 12.' : `${room} characters left.`;
  }

  check = (value: string | null): string | undefined =>
    this.taken.includes((value ?? '').toLowerCase()) ? 'That handle is taken.' : undefined;

  /**
   * The field refuses the submit before this hears it, so the press is
   * answered rather than being silently swallowed.
   */
  save = (event: Event): void => {
    if (event.defaultPrevented) {
      this.result.set('Not sent — the messages above say why.');
      return;
    }
    event.preventDefault();
    this.result.set(`Sent. Welcome, ${this.handle.get()}.`);
  };
}
