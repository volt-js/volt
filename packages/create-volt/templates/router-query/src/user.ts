import { Component } from '@voltdev/core';
import { createQuery } from '@voltdev/query';
import { cache } from './cache.js';
import { getUser, type User as UserRecord } from './api.js';
import { router } from './router.js';

/**
 * One user, keyed by the URL.
 *
 * The key is a function, so changing `:id` moves this query to another cache
 * entry rather than refetching into the same one. Going back to a user
 * already seen therefore paints from cache with no request at all.
 */
@Component({
  selector: 'v-user',
  templateUrl: './user.html',
  styleUrl: './user.scss',
})
export class User {
  private id = (): number => Number(router.param('id'));

  private query = createQuery<UserRecord>({
    key: () => ['users', this.id()],
    client: cache,
    fetcher: ({ signal }) => getUser(this.id(), signal),
  });

  user = (): UserRecord | undefined => this.query.data();
  isLoading = (): boolean => this.query.isLoading();
  error = (): unknown => this.query.error();
}
