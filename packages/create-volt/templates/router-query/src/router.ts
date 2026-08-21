import { createRouter, defineRoutes } from '@voltdev/router';
import { Shell } from './shell.js';
import { Home } from './home.js';
import { Users } from './users.js';
import { User } from './user.js';

/**
 * The route table.
 *
 * `defineRoutes` keeps the literal types, which is what lets
 * `router.href('/users/:id', { id })` know that `id` is the parameter it
 * needs — a renamed route becomes a type error at every link to it.
 */
export const routes = defineRoutes([
  {
    path: '/',
    component: Shell,
    children: [
      { index: true, component: Home },
      { path: 'users', component: Users },
      { path: 'users/:id', component: User },
    ],
  },
]);

export const router = createRouter({ routes });
