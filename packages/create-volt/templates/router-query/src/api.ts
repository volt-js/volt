/**
 * The backend, such as it is.
 *
 * A scaffold has to run before it has a server, so this stands in for one —
 * same shape as `fetch`, same asynchrony, no network. Delete it, point the
 * fetchers at real URLs, and nothing above this file changes.
 */

export interface User {
  readonly id: number;
  readonly name: string;
  readonly role: string;
}

const USERS: readonly User[] = [
  { id: 1, name: 'Ada Lovelace', role: 'Analyst' },
  { id: 2, name: 'Grace Hopper', role: 'Rear Admiral' },
  { id: 3, name: 'Karen Spärck Jones', role: 'Researcher' },
];

/** Enough delay to see a loading state, little enough not to sit through one. */
const LATENCY = 120;

function later<T>(value: T, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timer = setTimeout(() => resolve(value), LATENCY);
    // A query whose key changed, or a route the user left: the caller has
    // already stopped caring, and the timer would otherwise outlive it.
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

export function listUsers(signal?: AbortSignal): Promise<readonly User[]> {
  return later(USERS, signal);
}

export function getUser(id: number, signal?: AbortSignal): Promise<User> {
  const user = USERS.find((each) => each.id === id);
  if (!user) return Promise.reject(new Error(`No user ${id}`));
  return later(user, signal);
}
