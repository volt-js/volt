/**
 * Both halves in one module, which is the shape the boundary has to cope with.
 *
 * `readFile` is imported at the top of the file and used only inside the
 * `@Server()` body; `secrets.js` is reached only from that same body. Neither
 * is on the render path, and `heading` — which is — reaches nothing but string
 * concatenation.
 */

import { readFile } from 'node:fs/promises';

export class Doc {
  heading(title: string): string {
    return title.toUpperCase();
  }

  @Server({ public: true })
  async load(id: string): Promise<string> {
    const { salt } = await import('./secrets.js');
    return readFile(`/docs/${salt}${id}`, 'utf8');
  }
}
