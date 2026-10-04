/**
 * Path patterns, tested away from the DOM.
 *
 * The interesting cases are the ones where a pattern could plausibly match
 * two ways: an optional segment that must decide whether to take a segment
 * something after it needs, a splat that has to stop at the end of the path
 * rather than eat it, and two patterns that both match where the answer to
 * "which one" is the whole feature.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPath,
  compareSpecificity,
  normalizePathname,
  parsePattern,
  splitPathname,
  trimSlashes,
  walkSegments,
} from '../src/path.js';

const match = (pattern: string, pathname: string) =>
  walkSegments(parsePattern(pattern), splitPathname(normalizePathname(pathname)));

describe('parsing', () => {
  it('reads the four kinds of segment', () => {
    expect(parsePattern('/users/:id/:tab?/*rest')).toEqual([
      { kind: 'static', value: 'users' },
      { kind: 'param', name: 'id', optional: false },
      { kind: 'param', name: 'tab', optional: true },
      { kind: 'splat', name: 'rest' },
    ]);
  });

  it('names a bare splat "*"', () => {
    expect(parsePattern('/files/*')).toEqual([
      { kind: 'static', value: 'files' },
      { kind: 'splat', name: '*' },
    ]);
  });

  it('ignores empty segments from doubled or trailing slashes', () => {
    expect(parsePattern('//users//:id/')).toEqual(parsePattern('/users/:id'));
  });

  it('refuses a splat that is not last', () => {
    expect(() => parsePattern('/files/*/edit')).toThrow(/rest of the path/);
  });

  it('refuses a parameter with no name', () => {
    expect(() => parsePattern('/users/:')).toThrow(/no parameter name/);
  });
});

describe('matching', () => {
  it('captures a parameter', () => {
    expect(match('/users/:id', '/users/7')?.params).toEqual({ id: '7' });
  });

  it('rejects a path with more segments than the pattern', () => {
    expect(match('/users/:id', '/users/7/edit')).toBeNull();
  });

  it('rejects a path with fewer', () => {
    expect(match('/users/:id', '/users')).toBeNull();
  });

  it('decodes what it captures', () => {
    expect(match('/tags/:name', '/tags/a%20b')?.params).toEqual({ name: 'a b' });
  });

  it('keeps a malformed escape rather than throwing', () => {
    expect(match('/tags/:name', '/tags/%E0%A4%A')?.params).toEqual({ name: '%E0%A4%A' });
  });

  it('lets an optional segment be absent', () => {
    expect(match('/users/:id/:tab?', '/users/7')?.params).toEqual({ id: '7' });
    expect(match('/users/:id/:tab?', '/users/7/posts')?.params).toEqual({
      id: '7',
      tab: 'posts',
    });
  });

  it('does not let an optional segment eat one a later segment needs', () => {
    // The optional is greedy, so without the count check it would take
    // "settings" and leave nothing for `:id`.
    expect(match('/:group?/users/:id', '/users/7')?.params).toEqual({ id: '7' });
    expect(match('/:group?/users/:id', '/staff/users/7')?.params).toEqual({
      group: 'staff',
      id: '7',
    });
  });

  it('captures the rest of the path in a splat, slashes and all', () => {
    expect(match('/files/*path', '/files/a/b/c.txt')?.params).toEqual({ path: 'a/b/c.txt' });
  });

  it('matches a splat against nothing at all', () => {
    expect(match('/files/*', '/files')?.params).toEqual({ '*': '' });
  });

  it('reports what each segment consumed, so a branch can be split up', () => {
    const walked = match('/org/:org/users/:id', '/org/acme/users/7');
    expect(walked?.consumed).toEqual([1, 1, 1, 1]);
    expect(walked?.captures).toEqual([
      null,
      { name: 'org', value: 'acme' },
      null,
      { name: 'id', value: '7' },
    ]);
  });
});

describe('specificity', () => {
  const order = (patterns: string[]) =>
    [...patterns]
      .map(parsePattern)
      .sort(compareSpecificity)
      .map((segments) =>
        segments
          .map((s) => {
            if (s.kind === 'static') return s.value;
            if (s.kind === 'splat') return s.name === '*' ? '*' : `*${s.name}`;
            return `:${s.name}${s.optional ? '?' : ''}`;
          })
          .join('/'),
      );

  it('prefers a literal to a parameter at the position they differ', () => {
    expect(order(['users/:id', 'users/new'])[0]).toBe('users/new');
  });

  it('is not fooled by a longer pattern made of parameters', () => {
    // A summed score with static=10 and dynamic=3 puts the four-parameter
    // pattern first, and `/settings` then never matches.
    expect(order([':a/:b/:c/:d', 'settings'])[0]).toBe('settings');
  });

  it('puts a splat last', () => {
    expect(order(['*rest', 'users/:id', 'users/new'])).toEqual([
      'users/new',
      'users/:id',
      '*rest',
    ]);
  });

  it('prefers the longer pattern when one is a prefix of the other', () => {
    expect(order(['users', 'users/:id'])[0]).toBe('users/:id');
  });

  it('puts the root ahead of a root splat, which would match it with nothing', () => {
    // A splat matches the empty rest, so ranked first it answers `/` itself
    // and the home page is never reached. Either declaration order.
    expect(order(['*', ''])).toEqual(['', '*']);
    expect(order(['', '*'])).toEqual(['', '*']);
  });

  it('puts a literal ahead of the splat beneath it, at every depth', () => {
    expect(order(['docs/*', 'docs'])).toEqual(['docs', 'docs/*']);
    expect(order(['docs/*', 'docs/api/*rest', 'docs', 'docs/api'])).toEqual([
      'docs/api',
      'docs/api/*rest',
      'docs',
      'docs/*',
    ]);
  });

  it('puts an optional parameter after the pattern without it and before a splat', () => {
    // `/:lang?` matches `/` by leaving `lang` out, which says less about `/`
    // than the pattern that is `/` and nothing else.
    expect(order(['*', ':lang?', ''])).toEqual(['', ':lang?', '*']);
    expect(order(['docs/*', 'docs/:page?', 'docs'])).toEqual(['docs', 'docs/:page?', 'docs/*']);
  });

  it('still prefers the longer pattern when what it adds needs a segment', () => {
    // `/about` is the about page in the default language rather than a
    // language called "about", because the longer pattern's literal claims it.
    // Optional segments ahead of that literal do not change the answer.
    expect(order([':lang?', ':lang?/about'])).toEqual([':lang?/about', ':lang?']);
    expect(order([':lang?', ':lang?/:region?/about'])).toEqual([
      ':lang?/:region?/about',
      ':lang?',
    ]);
  });

  it('is a consistent order, so declaration order only ever breaks a tie', () => {
    // `Array.prototype.sort` with a comparator that is not transitive returns
    // an order that depends on the input's, and then on the engine's.
    const patterns = [
      '',
      '*',
      ':lang?',
      ':lang?/about',
      ':lang?/:region?/about',
      'docs',
      'docs/*',
      'docs/:page?',
      'docs/:page',
      'docs/:page?/edit',
      'docs/api',
      'docs/api/*rest',
      ':section',
      ':section/*',
    ].map(parsePattern);
    const sign = (a: (typeof patterns)[number], b: (typeof patterns)[number]) =>
      Math.sign(compareSpecificity(a, b)) || 0;

    for (const a of patterns) {
      for (const b of patterns) {
        expect(sign(a, b)).toBe(-sign(b, a) || 0);
        for (const c of patterns) {
          if (sign(a, b) <= 0 && sign(b, c) <= 0) expect(sign(a, c)).toBeLessThanOrEqual(0);
        }
      }
    }
  });
});

describe('normalizing', () => {
  it('drops trailing slashes but keeps the root', () => {
    expect(normalizePathname('/users/')).toBe('/users');
    expect(normalizePathname('/users///')).toBe('/users');
    expect(normalizePathname('/')).toBe('/');
    expect(normalizePathname('')).toBe('/');
  });

  it('adds the leading slash', () => {
    expect(normalizePathname('users')).toBe('/users');
  });

  it('leaves case alone, because a URL path is case-sensitive', () => {
    expect(normalizePathname('/Users')).toBe('/Users');
  });

  it('trims slashes from both ends', () => {
    expect(trimSlashes('//a/b//')).toBe('a/b');
    expect(trimSlashes('///')).toBe('');
  });
});

describe('building', () => {
  it('fills a pattern in', () => {
    expect(buildPath('/users/:id', { id: 7 })).toBe('/users/7');
  });

  it('encodes values, so one cannot invent a path segment', () => {
    expect(buildPath('/tags/:name', { name: 'a/b' })).toBe('/tags/a%2Fb');
    expect(buildPath('/tags/:name', { name: 'a b' })).toBe('/tags/a%20b');
  });

  it('keeps the slashes inside a splat, since matching one captured them', () => {
    expect(buildPath('/files/*path', { path: 'a/b c.txt' })).toBe('/files/a/b%20c.txt');
  });

  it('drops an optional parameter that has no value', () => {
    expect(buildPath('/users/:id/:tab?', { id: '7' })).toBe('/users/7');
  });

  it('refuses to build a URL with a hole in it', () => {
    expect(() => buildPath('/users/:id', {})).toThrow(/no value for ":id"/);
  });

  it('round-trips with matching', () => {
    const path = buildPath('/tags/:name', { name: 'a/b' });
    expect(match('/tags/:name', path)?.params).toEqual({ name: 'a/b' });
  });
});
