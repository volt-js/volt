/** The builtin is three modules down, where nobody reading the entry sees it. */

import { renderToStaticMarkup } from '@voltdev/core/server';
import { heading } from './layout.js';

export function page(title: string): string {
  return renderToStaticMarkup(`<h1>${heading(title)}</h1>`);
}
