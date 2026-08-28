/**
 * The route table: flattening a tree into branches, and picking one.
 *
 * Nesting is the part worth testing hard, because it is where the router
 * stops being a pattern matcher: which routes end up in a branch decides
 * which components stay mounted, and how a branch is split back up decides
 * which parameters each of them sees.
 */
import { describe, expect, it } from 'vitest';
import { Component } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { defineRoutes, flattenRoutes, matchRoutes, type RouteDefinition,
  routeMode,
} from '../src/routes.js';

@Component({ selector: 'v-blank', render: compileTemplate(`<div></div>`) })
class Blank {}

const table = (routes: readonly RouteDefinition[]) => flattenRoutes(routes);
const patternsFor = (routes: readonly RouteDefinition[], pathname: string) =>
  matchRoutes(table(routes), pathname).map((match) => match.pattern);

describe('flattening', () => {
  it('joins a child path onto its parent', () => {
    const branches = table([
      { path: '/', children: [{ path: 'users', children: [{ path: ':id' }] }] },
    ]);
    expect(branches.map((branch) => branch.patterns.at(-1))).toEqual(['/users/:id']);
  });

  it('gives a route with children no branch of its own', () => {
    // `/users` with a `:id` child renders nothing on its own — an index route
    // is how you say what belongs at the parent's URL.
    expect(patternsFor([{ path: 'users', children: [{ path: ':id' }] }], '/users')).toEqual([]);
  });

  it('matches the parent URL once an index route says what goes there', () => {
    const routes = [{ path: 'users', children: [{ index: true }, { path: ':id' }] }];
    expect(patternsFor(routes, '/users')).toEqual(['/users', '/users']);
  });

  it('lets a layout have no path of its own', () => {
    const routes = [
      { component: Blank, children: [{ path: 'a' }, { path: 'b' }] },
      { path: 'c' },
    ];
    expect(patternsFor(routes, '/a')).toEqual(['/', '/a']);
    expect(patternsFor(routes, '/c')).toEqual(['/c']);
  });

  it('refuses a route that is both an index and a path', () => {
    expect(() => table([{ path: 'users', index: true }])).toThrow(/index route/);
  });

  it('defaults an id to the full pattern and keeps an explicit one', () => {
    const branches = table([{ path: 'users', children: [{ path: ':id', id: 'user-detail' }] }]);
    expect(branches[0]?.ids).toEqual(['/users', 'user-detail']);
  });
});

describe('choosing a branch', () => {
  const routes = defineRoutes([
    {
      path: '/',
      children: [
        { index: true },
        { path: 'users/new' },
        { path: 'users/:id' },
        { path: 'files/*path' },
      ],
    },
  ]);

  it('takes the literal over the parameter', () => {
    expect(patternsFor(routes, '/users/new')).toEqual(['/', '/users/new']);
    expect(patternsFor(routes, '/users/7')).toEqual(['/', '/users/:id']);
  });

  it('falls through to the splat', () => {
    expect(patternsFor(routes, '/files/a/b')).toEqual(['/', '/files/*path']);
  });

  it('matches the index route at the root', () => {
    expect(patternsFor(routes, '/')).toEqual(['/', '/']);
  });

  it('returns nothing for a URL the table does not describe', () => {
    expect(patternsFor(routes, '/nowhere')).toEqual([]);
  });

  it('ignores a trailing slash', () => {
    expect(patternsFor(routes, '/users/7/')).toEqual(['/', '/users/:id']);
  });
});

describe('splitting a branch back up', () => {
  const routes = defineRoutes([
    {
      path: '/org/:org',
      children: [{ path: 'users/:id', children: [{ path: ':tab' }] }],
    },
  ]);

  const matches = matchRoutes(table(routes), '/org/acme/users/7/posts');

  it('gives each route the portion of the URL it accounts for', () => {
    expect(matches.map((match) => match.pathname)).toEqual([
      '/org/acme',
      '/org/acme/users/7',
      '/org/acme/users/7/posts',
    ]);
  });

  it('hands every route its ancestors’ parameters as well as its own', () => {
    expect(matches.map((match) => match.params)).toEqual([
      { org: 'acme' },
      { org: 'acme', id: '7' },
      { org: 'acme', id: '7', tab: 'posts' },
    ]);
  });

  it('does not leak a descendant’s value into an ancestor of the same name', () => {
    // Both routes capture `:id`. The parent matched "1" and must say so, even
    // though the merged view of the branch ends up with the child's "2".
    const shadowed = matchRoutes(
      table([{ path: 'a/:id', children: [{ path: 'b/:id' }] }]),
      '/a/1/b/2',
    );
    expect(shadowed.map((match) => match.params)).toEqual([{ id: '1' }, { id: '2' }]);
  });
});

describe('the mode a route renders in', () => {
  it('takes the nearest one declared, leaf first', () => {
    // A layout says what its section does by default; the page inside it is
    // the one that knows better. A marketing site prerendered whole with one
    // live `/pricing` is the ordinary shape, and root-first would make the
    // layout unable to say anything at all.
    const routes = defineRoutes([
      {
        path: '/',
        mode: 'ssg',
        children: [
          { index: true },
          { path: 'pricing', mode: 'ssr' },
          { path: 'about' },
        ],
      },
    ]);
    const branches = flattenRoutes(routes);
    const modeOf = (pattern: string) =>
      routeMode(branches.find((b) => b.patterns.at(-1) === pattern)!, 'csr');

    expect(modeOf('/pricing')).toBe('ssr');
    // Inherited, not defaulted: the fallback would have said `csr`.
    expect(modeOf('/about')).toBe('ssg');
    expect(modeOf('/')).toBe('ssg');
  });

  it('falls back to the application’s default when nothing says', () => {
    // Nothing in this module decides that server rendering happens at all.
    const branches = flattenRoutes(defineRoutes([{ path: '/', children: [{ index: true }] }]));
    expect(routeMode(branches[0]!, 'csr')).toBe('csr');
    expect(routeMode(branches[0]!, 'ssr')).toBe('ssr');
  });
});
