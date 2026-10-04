import { Component, Signal } from '@voltdev/core';
import { VButton, VPinInput } from '@voltdev/ui/components';

@Component({
  selector: 'v-verify',
  templateUrl: './pin-input.html',
  styleUrl: './pin-input.scss',
  imports: [VButton, VPinInput],
})
export class Verify {
  code = new Signal.State('');

  /** The code the message "sent", so there is something to be wrong against. */
  expected = '246810';

  /**
   * The server's verdict, which is the field's message for as long as it
   * stands. Cleared on the next edit rather than left: the field lets a
   * verdict go once the user starts fixing the code, and a signal set to the
   * string it already holds has not changed — so the next wrong attempt
   * would say nothing.
   */
  problem = new Signal.State('');

  /** What the last submit came to, so the demo says whether it went. */
  result = new Signal.State('');

  /** Every box filled is the moment to check, without waiting for a press. */
  check = (code: string): void => {
    if (code !== this.expected) this.problem.set('That code is wrong. Check the message and try again.');
  };

  edited = (): void => {
    this.problem.set('');
    this.unsent();
  };

  /**
   * An edit to either field makes the last submit's outcome old news. Left
   * standing, "Sent." sat beside a passcode the browser had just refused: a
   * submit the platform refuses never reaches `send`, so nothing else would
   * take it down.
   */
  unsent = (): void => this.result.set('');

  /**
   * A submit the field refuses for a code that is not whole arrives here
   * already cancelled, so the press is answered rather than silently
   * swallowed. One the browser refuses — an empty `required` row, or a
   * verdict that still stands — never arrives at all, and the messages under
   * the boxes are the answer.
   */
  send = (event: Event): void => {
    if (event.defaultPrevented) {
      this.result.set('Not sent — the messages above say why.');
      return;
    }
    event.preventDefault();
    this.result.set('Sent. Welcome back.');
  };
}
