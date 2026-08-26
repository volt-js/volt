/**
 * The same builtin, spelled the old way.
 *
 * `fs` and `node:fs` are one module to a Node resolver and one failure to an
 * edge one, so a check that only knew the prefixed spelling would pass most
 * real code — the bare form is what a decade of packages were written against.
 */

import { readFileSync } from 'fs';
import { renderToStaticMarkup } from '@voltdev/core/server';

export function page(name: string): string {
  return renderToStaticMarkup(`<p>${name}${readFileSync('/etc/hostname', 'utf8')}</p>`);
}
