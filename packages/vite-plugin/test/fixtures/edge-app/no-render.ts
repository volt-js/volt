/**
 * A build with no renderer in it at all: a background job, a migration script.
 *
 * It has a render path of length zero, so the check has nothing to say about
 * its use of a builtin — and saying something anyway would make the check
 * something a project has to switch off.
 */

import { readFileSync } from 'node:fs';

export function hostname(): string {
  return readFileSync('/etc/hostname', 'utf8');
}
