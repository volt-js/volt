/** Named as a render entry by hand, to check the option overrides detection. */

import { readFileSync } from 'node:fs';

export function config(): string {
  return readFileSync('/etc/volt.json', 'utf8');
}
