import { Component, Signal } from '@voltdev/core';
import { VCode, VSwitch } from '@voltdev/ui/components';

@Component({
  selector: 'v-snippets',
  templateUrl: './code.html',
  styleUrl: './code.scss',
  imports: [VCode, VSwitch],
})
export class Snippets {
  /**
   * The block's code, held here and handed over through `{ }`: text written
   * between the tags of a template has its newlines folded into spaces, and
   * its braces read as interpolations.
   */
  source = [
    "import { createCode } from '@voltdev/primitives';",
    '',
    'export function sample(language: string) {',
    "  return createCode({ block: true, language: () => language, pre: () => document.querySelector('pre') });",
    '}',
    '',
  ].join('\n');

  /** The page's own setting for the block, so the switch below reads the same signal. */
  wrapped = new Signal.State(false);
}
