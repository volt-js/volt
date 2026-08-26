/**
 * Static generation, against the router's real `flattenRoutes`.
 *
 * The route input is described structurally in `ssg.ts` so that a build tool
 * does not drag the runtime router into every project that installs it, and a
 * structural type is exactly the kind that drifts silently. So the branches
 * here are the ones the router actually produces, from a table written the way
 * an application writes one: if the two ever disagree about what a pattern
 * segment is, this suite stops compiling rather than passing against a shape
 * nothing produces.
 *
 * The cache is tested on a counted renderer and an injected clock. Both matter:
 * "served from cache" is a claim about a call that did *not* happen, which only
 * a count can see, and every staleness assertion is about a moment rather than
 * a duration.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { defineRoutes, flattenRoutes } from '@voltdev/router';
import {
  createRenderCache,
  enumerateRoutes,
  fileForPathname,
  prerender,
  PrerenderError,
  type RouteBranchLike,
} from '../src/ssg.js';

const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(temporary.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function outDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'volt-ssg-'));
  temporary.push(dir);
  return dir;
}

/** What the router hands over for a table, typed as `ssg.ts` asks for it. */
function branchesOf(routes: Parameters<typeof flattenRoutes>[0]): readonly RouteBranchLike[] {
  return flattenRoutes(routes);
}

const site = defineRoutes([
  {
    path: '/',
    children: [
      { index: true, id: 'home' },
      { path: 'about' },
      {
        path: 'blog',
        children: [
          { index: true, id: 'blog.index' },
          { path: ':slug', id: 'blog.post' },
        ],
      },
      { path: 'docs/:page?', id: 'docs' },
      { path: 'files/*', id: 'files' },
    ],
  },
]);

describe('enumerating what a table can produce', () => {
  it('names every static URL, an index route at its parent’s own address', async () => {
    const { routes } = await enumerateRoutes(branchesOf(site));
    const pathnames = routes.map((route) => route.pathname);

    expect(pathnames).toContain('/');
    expect(pathnames).toContain('/about');
    expect(pathnames).toContain('/blog');
    // Nothing was offered for `:slug`, so no post URL can be invented.
    expect(pathnames.some((pathname) => pathname.startsWith('/blog/'))).toBe(false);
  });

  it('reports a pattern it could not answer rather than dropping it', async () => {
    const { skipped } = await enumerateRoutes(branchesOf(site));
    expect(skipped).toEqual([{ pattern: '/blog/:slug', id: 'blog.post', reason: 'no-params' }]);
  });

  it('asks once per pattern and expands every answer', async () => {
    const asked: string[] = [];
    const { routes, skipped } = await enumerateRoutes(branchesOf(site), ({ pattern, id }) => {
      asked.push(`${id} ${pattern}`);
      return pattern === '/blog/:slug' ? [{ slug: 'first' }, { slug: 'second' }] : undefined;
    });

    expect(asked).toContain('blog.post /blog/:slug');
    expect(routes.map((route) => route.pathname)).toEqual(
      expect.arrayContaining(['/blog/first', '/blog/second']),
    );
    expect(skipped).toEqual([]);
    expect(routes.find((route) => route.pathname === '/blog/first')?.params).toEqual({
      slug: 'first',
    });
  });

  it('prerenders the omitted form of a pattern nothing is required for', async () => {
    const { routes, skipped } = await enumerateRoutes(branchesOf(site));
    const pathnames = routes.map((route) => route.pathname);

    // `:page?` may be left out and `*` may match nothing, so both have a real
    // static URL even with no parameters offered at all.
    expect(pathnames).toContain('/docs');
    expect(pathnames).toContain('/files');
    expect(skipped.map((entry) => entry.pattern)).not.toContain('/docs/:page?');
  });

  it('spreads a splat over the segments it stands for', async () => {
    const { routes } = await enumerateRoutes(branchesOf(site), ({ pattern }) =>
      pattern === '/files/*' ? [{ '*': 'a/b/c.txt' }] : undefined,
    );
    expect(routes.map((route) => route.pathname)).toContain('/files/a/b/c.txt');
  });

  it('refuses a parameter value that would move the page off its own route', async () => {
    await expect(
      enumerateRoutes(branchesOf(site), ({ pattern }) =>
        pattern === '/blog/:slug' ? [{ slug: 'a/b' }] : undefined,
      ),
    ).rejects.toThrow(/matches\s+one segment/);

    await expect(
      enumerateRoutes(branchesOf(site), ({ pattern }) =>
        pattern === '/blog/:slug' ? [{ slug: '..' }] : undefined,
      ),
    ).rejects.toThrow(PrerenderError);
  });

  it('writes one page where two branches describe the same URL', async () => {
    const overlapping = defineRoutes([
      { path: 'help', id: 'literal' },
      { path: ':page', id: 'dynamic' },
    ]);
    const { routes } = await enumerateRoutes(branchesOf(overlapping), () => [{ page: 'help' }]);

    const help = routes.filter((route) => route.pathname === '/help');
    expect(help).toHaveLength(1);
    // Branches arrive most specific first, so the literal route is the one kept.
    expect(help[0]!.id).toBe('literal');
  });
});

describe('the cache in front of the renderer', () => {
  it('renders once and answers the rest from what it held', async () => {
    let renders = 0;
    const cache = createRenderCache({
      render: (pathname) => `<p>${pathname} ${++renders}</p>`,
    });

    const first = await cache.get('/a');
    const second = await cache.get('/a');

    expect(renders).toBe(1);
    expect(first.hit).toBe(false);
    expect(second.hit).toBe(true);
    expect(second.html).toBe(first.html);
  });

  it('collapses concurrent misses for one URL onto one render', async () => {
    let renders = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cache = createRenderCache({
      render: async () => {
        renders++;
        await gate;
        return '<p>slow</p>';
      },
    });

    const all = Promise.all([cache.get('/a'), cache.get('/a'), cache.get('/a')]);
    release();
    const pages = await all;

    expect(renders).toBe(1);
    expect(pages.map((page) => page.html)).toEqual(['<p>slow</p>', '<p>slow</p>', '<p>slow</p>']);
  });

  it('serves the stale page immediately and renders the next one behind it', async () => {
    let renders = 0;
    let clock = 1_000;
    const cache = createRenderCache({
      render: () => `<p>${++renders}</p>`,
      revalidate: 60,
      now: () => clock,
    });

    expect((await cache.get('/a')).html).toBe('<p>1</p>');

    clock += 59_000;
    const fresh = await cache.get('/a');
    expect(fresh.stale).toBe(false);
    expect(renders).toBe(1);

    clock += 2_000;
    const stale = await cache.get('/a');
    // The reader waited for nothing: it got the old markup, marked as old.
    expect(stale.stale).toBe(true);
    expect(stale.html).toBe('<p>1</p>');

    await cache.idle();
    expect(renders).toBe(2);
    const next = await cache.get('/a');
    expect(next.stale).toBe(false);
    expect(next.html).toBe('<p>2</p>');
  });

  it('keeps the page it has when a refresh throws', async () => {
    let renders = 0;
    let clock = 0;
    const errors: unknown[] = [];
    const cache = createRenderCache({
      render: () => {
        if (++renders > 1) throw new Error('database is down');
        return '<p>good</p>';
      },
      revalidate: 1,
      now: () => clock,
      onError: (error) => errors.push(error),
    });

    await cache.get('/a');
    clock += 5_000;
    await cache.get('/a');
    await cache.idle();

    expect(errors).toHaveLength(1);
    expect((await cache.get('/a')).html).toBe('<p>good</p>');
  });

  it('waits for the new markup when nothing may serve a stale page', async () => {
    let renders = 0;
    let clock = 0;
    const cache = createRenderCache({
      render: () => `<p>${++renders}</p>`,
      revalidate: 1,
      serveStale: false,
      now: () => clock,
    });

    await cache.get('/a');
    clock += 5_000;
    const page = await cache.get('/a');

    expect(page.html).toBe('<p>2</p>');
    expect(page.stale).toBe(false);
    expect(cache.refreshing).toBe(0);
  });

  it('renders again for a URL that was dropped', async () => {
    let renders = 0;
    const cache = createRenderCache({ render: () => `<p>${++renders}</p>` });

    await cache.get('/a');
    expect(cache.peek('/a')?.html).toBe('<p>1</p>');
    cache.invalidate('/a');
    expect(cache.peek('/a')).toBeUndefined();

    expect((await cache.get('/a')).html).toBe('<p>2</p>');
  });
});

describe('writing the files', () => {
  it('writes a directory index per URL, and the root at the top', async () => {
    const dir = await outDir();
    const result = await prerender({
      branches: branchesOf(site),
      outDir: dir,
      render: (pathname) => `<h1>${pathname}</h1>`,
    });

    expect(await readFile(join(dir, 'index.html'), 'utf8')).toBe('<h1>/</h1>');
    expect(await readFile(join(dir, 'about/index.html'), 'utf8')).toBe('<h1>/about</h1>');
    expect(await readFile(join(dir, 'blog/index.html'), 'utf8')).toBe('<h1>/blog</h1>');
    expect(result.pages.map((page) => page.pathname)).toContain('/about');
    expect(result.pages.find((page) => page.pathname === '/about')?.bytes).toBe(
      '<h1>/about</h1>'.length,
    );
  });

  it('writes a flat file per URL when the host appends the extension', async () => {
    const dir = await outDir();
    await prerender({
      branches: branchesOf(site),
      outDir: dir,
      layout: 'flat',
      render: (pathname) => `<h1>${pathname}</h1>`,
    });

    expect(await readFile(join(dir, 'about.html'), 'utf8')).toBe('<h1>/about</h1>');
    expect(await readdir(dir)).not.toContain('about');
  });

  it('leaves the cache warm, so a server started after it renders nothing', async () => {
    const dir = await outDir();
    let renders = 0;
    const { cache } = await prerender({
      branches: branchesOf(site),
      outDir: dir,
      render: (pathname) => {
        renders++;
        return `<h1>${pathname}</h1>`;
      },
    });

    const built = renders;
    const page = await cache.get('/about');
    expect(page.hit).toBe(true);
    expect(page.html).toBe('<h1>/about</h1>');
    expect(renders).toBe(built);
  });

  it('attempts every page and then fails the build with all of them', async () => {
    const dir = await outDir();
    const attempted: string[] = [];

    const failed = await prerender({
      branches: branchesOf(site),
      outDir: dir,
      concurrency: 1,
      render: (pathname) => {
        attempted.push(pathname);
        if (pathname === '/about') throw new Error('no such author');
        return `<h1>${pathname}</h1>`;
      },
    }).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(PrerenderError);
    expect((failed as PrerenderError).failures.map((failure) => failure.pathname)).toEqual([
      '/about',
    ]);
    // The pages after the broken one were still written.
    expect(attempted.length).toBeGreaterThan(1);
    expect(await readFile(join(dir, 'blog/index.html'), 'utf8')).toBe('<h1>/blog</h1>');
  });

  it('refuses a URL that would put a file outside the output directory', async () => {
    const dir = await outDir();
    expect(() => fileForPathname(dir, '/../escaped')).toThrow(/outside/);
    expect(fileForPathname(dir, '/a/b')).toBe(join(dir, 'a/b/index.html'));
  });
});

describe('reachability', () => {
  it('is something a project can actually import', async () => {
    // The failure this guards against is the one this module already had: a
    // feature written, documented and tested, and reachable from nothing. A
    // subpath missing from `exports` is unreachable to a consumer however
    // complete the code behind it is, and no test of the code itself notices.
    const manifest = JSON.parse(
      await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8'),
    ) as { exports: Record<string, { import: string; types: string }> };

    const entry = manifest.exports['./ssg'];
    expect(entry, '@voltdev/vite-plugin/ssg is not in the exports map').toBeDefined();
    // Named in the map is not the same as built: the library config has to
    // list it as an entry too, or the map points at a file that is not there.
    expect(existsSync(resolve(import.meta.dirname, '..', entry!.import))).toBe(true);
  });

  it('offers the edge check from the package root, beside the plugin it pairs with', async () => {
    const module = (await import('../src/index.js')) as { renderPath?: unknown };
    expect(typeof module.renderPath).toBe('function');
  });
});
