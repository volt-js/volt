/** Only ever reached from inside a `@Server()` body, and so allowed its own builtins. */

import { randomUUID } from 'node:crypto';

export const salt = randomUUID();
