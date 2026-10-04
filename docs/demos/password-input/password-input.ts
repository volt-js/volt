import { Component, Signal } from '@voltdev/core';
import { VButton, VInput, VPasswordInput } from '@voltdev/ui/components';

/** The one password the pretend server accepts. */
const KNOWN = 'correct horse';

@Component({
  selector: 'v-sign-in',
  templateUrl: './password-input.html',
  styleUrl: './password-input.scss',
  imports: [VButton, VInput, VPasswordInput],
})
export class SignIn {
  email = new Signal.State('');
  password = new Signal.State('');
  /** A new one, for the second field: revealed by an icon pair rather than words. */
  chosen = new Signal.State('');

  /**
   * What the server said about the last attempt. Cleared before each one:
   * the field lets go of a message on the next edit, and the same words a
   * second time are a change only once this has been.
   */
  refused = new Signal.State('');
  /** What the last submit came to, so the demo says whether it went. */
  result = new Signal.State('');

  /**
   * The field refuses the submit before this hears it, so the press is
   * answered rather than being silently swallowed.
   */
  signIn = async (event: Event): Promise<void> => {
    if (event.defaultPrevented) {
      this.result.set('Not sent — the messages above say why.');
      return;
    }
    event.preventDefault();
    this.refused.set('');
    this.result.set('Checking…');

    await new Promise((resolve) => setTimeout(resolve, 400));

    if (this.password.get() !== KNOWN) {
      this.refused.set('That is not the password for this account.');
      this.result.set('');
      return;
    }
    this.result.set(`Signed in as ${this.email.get() || 'nobody in particular'}.`);
  };
}
