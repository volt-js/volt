import { defineRoutes } from '@voltdev/router';
import { Shell } from './shell.js';
import { Home } from './home.js';
import { Pricing } from './pricing.js';
import { Dashboard } from './dashboard.js';

/**
 * The route table, and where each route's markup is made.
 *
 * `mode` is resolved leaf to root, so the layout below says what the section
 * does and a page inside it says when it knows better. That is the ordinary
 * shape of a site: mostly prerendered, one route that has to run per request,
 * and one that has no business on a server at all.
 *
 *   ssg  built once, written to a file, served as bytes
 *   ssr  rendered per request, because the answer depends on the request
 *   csr  rendered in the browser, because it is behind a login and gains
 *        nothing from a server
 */
export const routes = defineRoutes([
  {
    path: '/',
    component: Shell,
    mode: 'ssg',
    children: [
      { index: true, component: Home },
      { path: 'pricing', component: Pricing, mode: 'ssr' },
      { path: 'dashboard', component: Dashboard, mode: 'csr' },
    ],
  },
]);
