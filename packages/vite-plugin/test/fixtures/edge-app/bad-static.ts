/** A render entry that reaches a builtin directly, from the render itself. */

import { join } from 'node:path';
import { renderToStaticMarkup } from '@voltdev/core/server';

export function page(name: string): string {
  return renderToStaticMarkup(`<a href="${join('/docs', name)}">${name}</a>`);
}
