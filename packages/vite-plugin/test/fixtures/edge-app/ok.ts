/**
 * A render entry that is allowed to build: it reaches a module that opens
 * files, but only through the half of that module the client never gets.
 */

import { renderToStaticMarkup } from '@voltdev/core/server';
import { Doc } from './doc.js';

export function page(title: string): string {
  return renderToStaticMarkup(`<h1>${new Doc().heading(title)}</h1>`);
}
