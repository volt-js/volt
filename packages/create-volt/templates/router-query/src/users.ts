import { Component } from '@voltdev/core';
import { createQuery } from '@voltdev/query';
import { cache } from './cache.js';
import { listUsers, type User } from './api.js';
import { router } from './router.js';

/**
 * The list. Its data is the cache's, not this component's — leaving and
 * coming back re-reads the same entry rather than asking again.
 */
@Component({
  selector: 'v-users',
  templateUrl: './users.html',
  styleUrl: './users.scss',
})
export class Users {
  private query = createQuery<readonly User[]>({
    key: ['users'],
    client: cache,
    fetcher: ({ signal }) => listUsers(signal),
  });

  users = (): readonly User[] => this.query.data() ?? [];
  isLoading = (): boolean => this.query.isLoading();
  error = (): unknown => this.query.error();

  /** Built by the router, so a route rename is a type error rather than a 404. */
  href(user: User): string {
    return router.href('/users/:id', { id: user.id });
  }
}
