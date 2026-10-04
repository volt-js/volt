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
  type RenderMode,
} from '../src/routes.js';
import { enumerateRoutes, type ParamsForPattern } from '../../vite-plugin/src/ssg.js';

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

describe('the mode of the url a server is answering', () => {
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

  it('takes the matches matchRoutes returns, which is what a server holds', () => {
    // A server answering one request has matches, not a branch. Taking only a
    // branch made the natural call — `routeMode(matches, …)` — impossible, and
    // the one that looked right, `matches.branch`, is undefined on an array.
    expect(routeMode(matchRoutes(branches, '/pricing'), 'csr')).toBe('ssr');
    expect(routeMode(matchRoutes(branches, '/about'), 'csr')).toBe('ssg');
  });

  it('agrees with the branch it came from', () => {
    for (const branch of branches) {
      const pathname = branch.patterns.at(-1)!;
      expect(routeMode(matchRoutes(branches, pathname), 'csr')).toBe(routeMode(branch, 'csr'));
    }
  });

  it('falls back when nothing matched, since there is nothing to ask', () => {
    expect(matchRoutes(branches, '/nowhere')).toEqual([]);
    expect(routeMode(matchRoutes(branches, '/nowhere'), 'csr')).toBe('csr');
  });
});

describe('a splat beside a route it would match with nothing', () => {
  const leaf = (routes: readonly RouteDefinition[], pathname: string) =>
    matchRoutes(table(routes), pathname).at(-1)?.id;

  it('leaves `/` to the index route, and catches the rest', () => {
    // The reported shape: a not-found page as a root catch-all. A splat
    // matches the empty rest, so ranked first it answered `/` itself and the
    // home page rendered nowhere.
    const routes = [
      {
        path: '/',
        children: [
          { index: true, id: 'home' },
          { path: 'about', id: 'about' },
          { path: '*', id: 'missing' },
        ],
      },
    ];
    expect(leaf(routes, '/')).toBe('home');
    expect(leaf(routes, '/about')).toBe('about');
    expect(leaf(routes, '/nowhere')).toBe('missing');
    expect(leaf(routes, '/nowhere/at/all')).toBe('missing');
  });

  it('leaves `/` to a root route declared after the splat', () => {
    const routes = [
      { path: '*', id: 'missing' },
      { path: '/', id: 'home' },
    ];
    expect(leaf(routes, '/')).toBe('home');
    expect(leaf(routes, '/x')).toBe('missing');
  });

  it('leaves a literal to itself rather than to the splat beneath it', () => {
    const routes = [
      { path: 'docs/*', id: 'docs.rest' },
      { path: 'docs', id: 'docs' },
    ];
    expect(leaf(routes, '/docs')).toBe('docs');
    expect(leaf(routes, '/docs/a/b')).toBe('docs.rest');
  });

  it('leaves a layout’s own URL to its index child, at every depth', () => {
    const routes = [
      {
        path: '/',
        children: [
          { index: true, id: 'home' },
          {
            path: 'docs',
            children: [
              { index: true, id: 'docs.home' },
              { path: 'api', id: 'docs.api' },
              { path: '*', id: 'docs.missing' },
            ],
          },
          { path: '*', id: 'missing' },
        ],
      },
    ];
    expect(leaf(routes, '/')).toBe('home');
    expect(leaf(routes, '/docs')).toBe('docs.home');
    expect(leaf(routes, '/docs/api')).toBe('docs.api');
    // The nearer catch-all, because its literal `docs` outranks the root
    // splat at the first segment.
    expect(leaf(routes, '/docs/a/b')).toBe('docs.missing');
    expect(leaf(routes, '/other')).toBe('missing');
  });

  it('does the same under a layout with no path of its own', () => {
    const routes = [
      {
        id: 'shell',
        children: [
          { index: true, id: 'home' },
          { path: '*', id: 'missing' },
        ],
      },
    ];
    expect(matchRoutes(table(routes), '/').map((match) => match.id)).toEqual(['shell', 'home']);
    expect(leaf(routes, '/x/y')).toBe('missing');
  });

  it('ranks an optional parameter after the pattern without it and before a splat', () => {
    const routes = [
      {
        path: '/',
        children: [
          { path: '*', id: 'missing' },
          { path: ':lang?', id: 'lang' },
          { index: true, id: 'home' },
        ],
      },
    ];
    expect(leaf(routes, '/')).toBe('home');
    expect(leaf(routes, '/en')).toBe('lang');
    expect(leaf(routes, '/en/x')).toBe('missing');
  });

  it('lets an optional parameter answer `/` when nothing more specific does', () => {
    const routes = [
      { path: '*', id: 'missing' },
      { path: ':lang?', id: 'lang' },
    ];
    expect(leaf(routes, '/')).toBe('lang');
    expect(leaf(routes, '/en')).toBe('lang');
    expect(leaf(routes, '/en/x')).toBe('missing');
  });

  it('keeps a literal after an optional parameter ahead of the parameter alone', () => {
    // `/about` is the about page in the default language, not a language
    // called "about".
    const routes = [
      { path: ':lang?', id: 'lang' },
      { path: ':lang?/:region?/about', id: 'about' },
    ];
    expect(leaf(routes, '/about')).toBe('about');
    expect(leaf(routes, '/en')).toBe('lang');
  });

  it('compares positions in the patterns, where a left-out optional still has one', () => {
    // Both match `/about`, and the literal there is the URL's first segment
    // but the pattern's second. Ranked by the URL's segments instead, the
    // order would depend on the URL, and no one sort could serve every URL.
    const routes = [
      { path: ':lang?/about', id: 'about' },
      { path: ':page', id: 'page' },
    ];
    expect(leaf(routes, '/about')).toBe('page');
    expect(leaf(routes, '/en/about')).toBe('about');
  });
});

describe('what a build writes, and what a request for it renders', () => {
  // A build writes each URL for the first branch, in `flattenRoutes` order,
  // that produces it, and a request for that URL is answered by `matchRoutes`.
  // The two have to pick one branch, or the file a host serves for a URL is a
  // different page from the one a server renders for it. The build's own
  // enumerator rather than a copy of it, so a change on either side shows here.
  const site = (notFound: RenderMode) =>
    flattenRoutes(
      defineRoutes([
        {
          path: '/',
          children: [
            { path: '*', id: 'missing', mode: notFound },
            { index: true, id: 'home' },
            { path: 'about', id: 'about' },
            {
              path: 'docs',
              children: [
                { path: '*', id: 'docs.missing', mode: notFound },
                { index: true, id: 'docs.home' },
                { path: ':page?/edit', id: 'docs.edit' },
              ],
            },
            { path: 'blog/:slug', id: 'blog.post' },
            { path: ':lang?', id: 'lang' },
          ],
        },
      ]),
    );

  const values: ParamsForPattern = ({ pattern }) =>
    ({
      '/*': [{}, { '*': 'gone/for/good' }],
      '/docs/*': [{}, { '*': 'old/page' }],
      '/docs/:page?/edit': [{}, { page: 'intro' }],
      '/blog/:slug': [{ slug: 'first' }],
      '/:lang?': [{}, { lang: 'en' }, { lang: 'about' }],
    })[pattern];

  it('writes the home page at `/` and each section’s index at its own URL', async () => {
    const { routes } = await enumerateRoutes(site('ssg'));
    expect(Object.fromEntries(routes.map((route) => [route.pathname, route.id]))).toEqual({
      '/': 'home',
      '/about': 'about',
      '/docs': 'docs.home',
      '/docs/edit': 'docs.edit',
    });
  });

  it('writes, for every URL, the page a request for it renders', async () => {
    // A not-found page rendered per request, so it can answer with a 404, is
    // the case that shows a wrong order: the build skips the splat and writes
    // `/docs` from the index route, while a request for `/docs` meets the
    // splat first and renders the not-found page instead.
    for (const notFound of ['ssg', 'ssr'] as const) {
      const branches = site(notFound);
      const { routes } = await enumerateRoutes(branches, values);
      for (const { pathname, id } of routes) {
        expect(matchRoutes(branches, pathname).at(-1)?.id, `${pathname}, ${notFound}`).toBe(id);
      }
    }
  });
});
