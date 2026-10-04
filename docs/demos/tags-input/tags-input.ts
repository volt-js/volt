import { Component, Signal } from '@voltdev/core';
import { VButton, VTagsInput } from '@voltdev/ui/components';

@Component({
  selector: 'v-tags-demo',
  templateUrl: './tags-input.html',
  styleUrl: './tags-input.scss',
  imports: [VButton, VTagsInput],
})
export class Topics {
  topics = new Signal.State<readonly string[]>(['design', 'rust']);

  /** What the last submit came to, so the demo says whether it went and what went. */
  result = new Signal.State('');

  /** A rule the platform has no word for, so there is something to be refused over. */
  oneWord = (tag: string): string | null =>
    /\s/.test(tag) ? 'One word per topic. A hyphen joins two.' : null;

  address = (tag: string): string | null =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tag) ? null : `${tag} is not an email address.`;

  /**
   * The field refuses the submit before this hears it, so the press is
   * answered rather than being silently swallowed. What would have been sent
   * is shown as the server would read it: one entry per tag, under one name.
   */
  send = (event: Event): void => {
    if (event.defaultPrevented) {
      this.result.set('Not sent — the messages above say why.');
      return;
    }
    event.preventDefault();
    const data = new FormData(event.target as HTMLFormElement);
    const sent = [...data.entries()].map(([name, value]) => `${name}=${String(value)}`);
    this.result.set(`Sent ${sent.join(' ')}`);
  };
}
