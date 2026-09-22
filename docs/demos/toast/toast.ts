import { Component, Signal } from '@voltdev/core';
import { VButton, VToaster, toaster } from '@voltdev/ui/components';

@Component({
  selector: 'v-notices',
  templateUrl: './toast.html',
  styleUrl: './toast.scss',
  imports: [VButton, VToaster],
})
export class Notices {
  messages = new Signal.State(12);

  save = (): void => {
    toaster().add({ title: 'Project saved' }, { type: 'success' });
  };

  /**
   * A toast that carries an action, and so never times out: an undo the
   * countdown can take away mid-reach is worse than no undo.
   */
  remove = (): void => {
    this.messages.set(this.messages.get() - 1);
    toaster().add(
      {
        title: 'Message deleted',
        action: { label: 'Undo', onPress: () => this.messages.set(this.messages.get() + 1) },
      },
      { duration: 0 },
    );
  };

  /**
   * An error, which interrupts where the others wait for a gap in the speech,
   * and which stays up: it carries the only way to act on it.
   */
  fail = (): void => {
    toaster().add(
      {
        title: 'Upload failed',
        description: 'The connection dropped at 40%.',
        action: { label: 'Retry', onPress: this.retry },
      },
      { type: 'error', duration: 0 },
    );
  };

  retry = (): void => {
    toaster().add({ title: 'Upload finished' }, { type: 'success' });
  };
}
