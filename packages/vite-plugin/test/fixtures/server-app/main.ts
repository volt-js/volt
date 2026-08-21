/** What a page does with a server function: calls it as though it were local. */

import { Todos } from './todos.js';

export async function create(text: string): Promise<{ id: string }> {
  return new Todos().create(text);
}
