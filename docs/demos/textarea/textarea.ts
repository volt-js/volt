import { Component, Signal } from '@voltdev/core';
import { VTextarea } from '@voltdev/ui/components';

/** Room enough for what went wrong, and not for an essay. */
const LIMIT = 200;

@Component({
  selector: 'v-report',
  templateUrl: './textarea.html',
  styleUrl: './textarea.scss',
  imports: [VTextarea],
})
export class Report {
  limit = LIMIT;

  message = new Signal.State('The lid arrived loose.');

  /**
   * The line under the box, which is where the count belongs.
   *
   * A method rather than a second element beside the field: the box is already
   * described by this line, so a counter written anywhere else is a number no
   * screen reader ever reaches.
   */
  hint(): string {
    const left = LIMIT - this.message.get().length;
    return `${left} characters left. The box grows to six lines, then scrolls.`;
  }

  /** Checked when the user leaves the box, so nobody is corrected mid-sentence. */
  check = (value: string | null): string | undefined =>
    (value ?? '').trim().length >= 15 ? undefined : 'A sentence or two, so we know where to look.';
}
