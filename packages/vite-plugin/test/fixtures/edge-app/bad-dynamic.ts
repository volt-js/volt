/** A builtin behind an `import()` the render itself performs. */

import { renderToStaticMarkup } from '@voltdev/core/server';

export async function page(name: string): Promise<string> {
  const { join } = await import('node:path');
  return renderToStaticMarkup(`<a href="${join('/docs', name)}">${name}</a>`);
}
