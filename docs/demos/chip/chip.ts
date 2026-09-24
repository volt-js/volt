import { Component, Signal } from '@voltdev/core';
import { VButton, VChip } from '@voltdev/ui/components';

const LANGUAGES = ['TypeScript', 'Rust', 'Go', 'Elixir', 'Haskell'];

@Component({
  selector: 'v-chip-demo',
  templateUrl: './chip.html',
  styleUrl: './chip.scss',
  imports: [VButton, VChip],
})
export class Languages {
  /** The page's list. The chips ask; this is what actually drops a tag. */
  languages = new Signal.State<readonly string[]>(LANGUAGES);

  /** The one reviewer, whose chip is named by `label` since its words are initials. */
  reviewing = new Signal.State(true);

  drop(language: string): void {
    this.languages.set(this.languages.get().filter((each) => each !== language));
  }

  restore = (): void => {
    this.languages.set(LANGUAGES);
    this.reviewing.set(true);
  };
}
