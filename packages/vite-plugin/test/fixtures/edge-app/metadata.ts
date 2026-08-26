import { readFileSync } from 'node:fs';

export function titleOf(title: string): string {
  return `${title} — ${readFileSync('/etc/hostname', 'utf8')}`;
}
