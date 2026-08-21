/** One guarded server function, and one that says it is open. */

import { guard } from '@voltdev/server';
import { session } from './auth.js';
import { db } from './db.js';

export class Todos {
  @Server()
  async create(text: string): Promise<{ id: string }> {
    const user = await guard(session);
    return db.insert(`${user.id}:${text}`);
  }

  @Server({ public: true })
  async version(): Promise<string> {
    return 'v1';
  }
}
