import { createRouter, defineRoutes } from '@voltdev/router';
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
    // No component: the shell is the application's own root, mounted in
    // `main.ts`, and this route groups the pages that render inside it. A
    // route with no component contributes its slice of the URL and nothing to
    // the page, so the page below it renders where it would have.
    children: [
      { index: true, component: Home },
      { path: 'users', component: Users },
      { path: 'users/:id', component: User },
    ],
  },
]);

export const router = createRouter({ routes });
