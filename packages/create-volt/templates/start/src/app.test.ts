import { describe, expect, it } from 'vitest';
import { flattenRoutes, routeMode } from '@voltdev/router';
import { routes } from './routes.js';

/**
 * The table is the configuration, so it is the thing worth a test.
 *
 * Getting a mode wrong does not break a build or throw at runtime — it
 * quietly renders a page in the wrong place, which is the kind of mistake that
 * reaches production. Asserting the resolved mode per route is cheap and it is
 * the one thing about this project that is easy to get wrong by editing.
 */
describe('where each route is rendered', () => {
  const branches = flattenRoutes(routes);
  const modeOf = (pattern: string): string =>
    routeMode(branches.find((branch) => branch.patterns.at(-1) === pattern)!, 'csr');

  it('builds the pages that do not depend on the request', () => {
    expect(modeOf('/')).toBe('ssg');
  });

  it('renders per request the one whose answer does', () => {
    expect(modeOf('/pricing')).toBe('ssr');
  });

  it('leaves the one behind the login to the browser', () => {
    // The promise this template exists to demonstrate: turning the server on
    // for the application did not take the choice away for this route.
    expect(modeOf('/dashboard')).toBe('csr');
  });
});
