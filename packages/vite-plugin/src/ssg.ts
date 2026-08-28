/**
 * Static generation: enumerate what the route table can produce, render each
 * URL, write the files — and put a staleness policy in front of the renderer
 * rather than beside it.
 *
 * Three deliberate absences, and each one is the point of the module.
 *
 * **No second renderer.** `render` is handed in, and everything here is a
 * caller of it. A prerendered page and a per-request page therefore differ in
 * when they were produced and in nothing else, which is what makes the
 * hydration story on the client identical for both. Revalidation is the same
 * claim one level up: `createRenderCache` is a `Map`, a clock and a staleness
 * rule wrapped around that same function, so an incrementally revalidated page
 * is a cache miss rather than a different code path. If this file ever grows
 * something that produces markup, the guarantee is gone.
 *
 * **No filesystem scan.** The routes come from the router's own
 * `flattenRoutes`, whose branches already carry the parsed segments of every
 * pattern the table can match. Walking a `routes/` directory here would be a
 * second, disagreeing answer to a question the router has already answered —
 * and it would be wrong for every table written by hand.
 *
 * **No import of the router or of core.** The two inputs are described
 * structurally: `RouteBranch` as `flattenRoutes` returns it, and a render
 * function as `renderToString` and `renderToStaticMarkup` both are. A build
 * tool that pulled the runtime packages in as dependencies would make every
 * project that installs the plugin install them too, for a feature most
 * projects do not use.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath, sep } from 'node:path';

// ---------------------------------------------------------------------------
// What the router hands over
// ---------------------------------------------------------------------------

/**
 * A parsed pattern segment, exactly as `@voltdev/router`'s `parsePattern`
 * produces it.
 *
 * Structural rather than imported, and it has to stay in step with that type
 * by hand — which is cheap, because it is the URL grammar and the URL grammar
 * is the last thing about a router to change.
 */
export type PatternSegment =
  | { readonly kind: 'static'; readonly value: string }
  | { readonly kind: 'param'; readonly name: string; readonly optional: boolean }
  | { readonly kind: 'splat'; readonly name: string };

/** One root-to-leaf branch, as `flattenRoutes` returns it. */
export interface RouteBranchLike {
  /** Every route's segments in the branch, end to end. */
  readonly segments: readonly PatternSegment[];
  /** The full pattern of each route, root to leaf. */
  readonly patterns: readonly string[];
  readonly ids: readonly string[];
  /**
   * The routes themselves, root to leaf, for their declared mode.
   *
   * Optional because the whole enumerator works without it: a caller handing
   * over a table with no modes in it is asking for every route, which is what
   * a wholly static site is.
   */
  readonly routes?: readonly { readonly mode?: 'csr' | 'ssr' | 'ssg' }[];
}

/** Matched parameters. Always strings — a URL has no other type. */
export type Params = Readonly<Record<string, string>>;

/** A route the table can match, and what a build is being asked to do with it. */
export interface PrerenderRoute {
  readonly pathname: string;
  /** The leaf's full pattern, which is what `params` is asked about. */
  readonly pattern: string;
  /** The leaf's route id, so a caller can key its answers to routes rather than to URLs. */
  readonly id: string;
  readonly params: Params;
}

/** A pattern nothing could be prerendered for, and why. */
export interface SkippedRoute {
  readonly pattern: string;
  readonly id: string;
  /**
   * `no-params`: no parameter values were offered for a pattern that needs
   * some. `not-static`: the route renders per request or in the browser, so
   * there is nothing to write at build time — which is a decision the
   * application made rather than a gap in what it told this.
   */
  readonly reason: 'no-params' | 'not-static';
}

export interface Enumeration {
  readonly routes: readonly PrerenderRoute[];
  readonly skipped: readonly SkippedRoute[];
}

/**
 * What to prerender a dynamic pattern for.
 *
 * Asked once per pattern rather than once per route, because `/users/:id` is
 * one question however deep the layout above it is. Returning nothing leaves
 * the pattern out of the build and reports it as skipped, which is the honest
 * answer for a route whose URLs are not known until a request arrives.
 */
export type ParamsForPattern = (route: {
  readonly pattern: string;
  readonly id: string;
}) => readonly Params[] | undefined | Promise<readonly Params[] | undefined>;

/** A build that cannot proceed, rather than one that writes something wrong. */
export class PrerenderError extends Error {
  /** Pages whose render threw, when that is what went wrong. */
  readonly failures: readonly { pathname: string; cause: unknown }[];

  constructor(message: string, failures: readonly { pathname: string; cause: unknown }[] = []) {
    super(message);
    this.name = 'PrerenderError';
    this.failures = failures;
  }
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

function isDynamic(segment: PatternSegment): boolean {
  return segment.kind !== 'static';
}

/**
 * Whether the pattern can produce a URL with nothing supplied.
 *
 * A splat matches the empty rest of a path and a `:name?` may be left out, so
 * `/docs/*` and `/docs/:page?` both have `/docs` as a real, static URL. Only a
 * required parameter makes a pattern unanswerable without values.
 */
function needsParams(segments: readonly PatternSegment[]): boolean {
  return segments.some((segment) => segment.kind === 'param' && !segment.optional);
}

/** One path segment, checked for the things that would put a file elsewhere. */
function checkSegment(value: string, pattern: string, name: string): void {
  if (value === '.' || value === '..') {
    throw new PrerenderError(
      `[volt] "${name}" was given "${value}" for ${pattern}, which is a path segment that ` +
        `moves rather than one that names a page.`,
    );
  }
  if (value.includes('\\') || value.includes('\0')) {
    throw new PrerenderError(
      `[volt] "${name}" was given "${value}" for ${pattern}, which cannot appear in a URL segment.`,
    );
  }
}

function buildPathname(
  segments: readonly PatternSegment[],
  params: Params,
  pattern: string,
): string {
  const out: string[] = [];

  for (const segment of segments) {
    if (segment.kind === 'static') {
      out.push(segment.value);
      continue;
    }

    const value = params[segment.name];

    if (value === undefined || value === '') {
      // A splat stands for "the rest", and the rest is allowed to be nothing.
      if (segment.kind === 'splat' || segment.optional) continue;
      throw new PrerenderError(
        `[volt] ${pattern} needs a value for ":${segment.name}" and was given none. ` +
          `Every parameter of a pattern being prerendered has to be answered, or the ` +
          `page would be written to a URL with a placeholder still in it.`,
      );
    }

    if (segment.kind === 'splat') {
      // A splat really is several segments; anything else is exactly one, and
      // a separator inside it would silently move the page.
      for (const part of value.split('/')) {
        if (part === '') continue;
        checkSegment(part, pattern, segment.name);
        out.push(part);
      }
      continue;
    }

    if (value.includes('/')) {
      throw new PrerenderError(
        `[volt] ":${segment.name}" was given "${value}" for ${pattern}. A parameter matches ` +
          `one segment, so a "/" in its value would write the page under a URL the route ` +
          `does not match.`,
      );
    }
    checkSegment(value, pattern, `:${segment.name}`);
    out.push(value);
  }

  return `/${out.join('/')}`;
}

/**
 * Every URL a build can write, and every pattern it had to leave alone.
 *
 * The branches arrive most specific first, so where two of them can produce
 * the same URL the more specific one is the page that gets written — the same
 * precedence `matchRoutes` would apply to a request for it.
 */
/** The nearest declared mode, leaf to root, or `ssg` if none says. */
function effectiveMode(
  routes: readonly { readonly mode?: 'csr' | 'ssr' | 'ssg' }[],
): 'csr' | 'ssr' | 'ssg' {
  for (let i = routes.length - 1; i >= 0; i--) {
    const mode = routes[i]!.mode;
    if (mode !== undefined) return mode;
  }
  return 'ssg';
}

export async function enumerateRoutes(
  branches: readonly RouteBranchLike[],
  params?: ParamsForPattern,
): Promise<Enumeration> {
  const routes: PrerenderRoute[] = [];
  const skipped: SkippedRoute[] = [];
  const seen = new Set<string>();

  const add = (route: PrerenderRoute): void => {
    if (seen.has(route.pathname)) return;
    seen.add(route.pathname);
    routes.push(route);
  };

  for (const branch of branches) {
    const pattern = branch.patterns.at(-1) ?? '/';
    const id = branch.ids.at(-1) ?? pattern;

    // Leaf to root: a layout says what its section does by default and the
    // page inside it is the one that knows better. A branch that declares
    // nothing anywhere is static, because a caller handing over a table with
    // no modes in it is asking for all of it.
    if (branch.routes && effectiveMode(branch.routes) !== 'ssg') {
      skipped.push({ pattern, id, reason: 'not-static' });
      continue;
    }

    if (!branch.segments.some(isDynamic)) {
      add({ pathname: buildPathname(branch.segments, {}, pattern), pattern, id, params: {} });
      continue;
    }

    const supplied = params ? await params({ pattern, id }) : undefined;

    if (!supplied || supplied.length === 0) {
      if (needsParams(branch.segments)) {
        skipped.push({ pattern, id, reason: 'no-params' });
        continue;
      }
      add({ pathname: buildPathname(branch.segments, {}, pattern), pattern, id, params: {} });
      continue;
    }

    for (const values of supplied) {
      add({ pathname: buildPathname(branch.segments, values, pattern), pattern, id, params: values });
    }
  }

  return { routes, skipped };
}

// ---------------------------------------------------------------------------
// The cache policy
// ---------------------------------------------------------------------------

export interface RenderCacheOptions {
  /** The renderer. One per cache, and the cache never has another. */
  render: (pathname: string) => string | Promise<string>;
  /**
   * Seconds a page stays fresh, per URL. Left out, a page never goes stale —
   * which is a plain build artefact, and is why the same cache serves a build
   * and an incrementally revalidating server.
   */
  revalidate?: number | ((pathname: string) => number | undefined);
  /**
   * Answer a stale request from the cache and render behind it, rather than
   * making the request wait for the new markup. Default true, which is the
   * whole reason to hold a stale copy at all.
   */
  serveStale?: boolean;
  /** The clock, so a test can move time without waiting for it. */
  now?: () => number;
  /**
   * A refresh that threw. The stale page stays and is served again; without
   * this the failure would be a rejection nobody is waiting on.
   */
  onError?: (error: unknown, pathname: string) => void;
}

export interface CachedPage {
  readonly pathname: string;
  readonly html: string;
  /** `now()` when this markup was produced, not when it was served. */
  readonly renderedAt: number;
  /** Served out of the cache rather than by calling the renderer. */
  readonly hit: boolean;
  /** What was served is past its revalidation window. */
  readonly stale: boolean;
}

export interface RenderCache {
  /** The page for this URL, rendering it if the policy says the copy is no good. */
  get(pathname: string): Promise<CachedPage>;
  /** What is held, without rendering anything or starting a refresh. */
  peek(pathname: string): CachedPage | undefined;
  /** Drop one URL, or everything. The next `get` renders. */
  invalidate(pathname?: string): void;
  /** How many refreshes are running behind a stale answer. */
  readonly refreshing: number;
  /** Settles once no refresh is outstanding, so a process can exit knowing. */
  idle(): Promise<void>;
}

interface Entry {
  html: string;
  renderedAt: number;
}

/**
 * A staleness policy over one renderer.
 *
 * The three things it does that a `Map` would not: it collapses concurrent
 * requests for the same URL onto one render, because the alternative is a
 * cache miss on a popular page becoming as many renders as there are readers;
 * it keeps the previous markup when a refresh throws, because a page that was
 * right a minute ago beats an error page; and it can answer from the stale
 * copy while the new one is produced, which is the difference between
 * revalidation costing one reader the full render and costing none of them.
 */
export function createRenderCache(options: RenderCacheOptions): RenderCache {
  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<Entry>>();
  const background = new Set<Promise<unknown>>();

  const now = options.now ?? Date.now;
  const serveStale = options.serveStale ?? true;

  const windowFor = (pathname: string): number => {
    const seconds =
      typeof options.revalidate === 'function' ? options.revalidate(pathname) : options.revalidate;
    return seconds === undefined ? Number.POSITIVE_INFINITY : seconds * 1000;
  };

  /** One render per URL at a time, whoever asked and however many of them. */
  const produce = (pathname: string): Promise<Entry> => {
    const already = inFlight.get(pathname);
    if (already) return already;

    const running = (async () => options.render(pathname))()
      .then((html) => {
        const entry: Entry = { html, renderedAt: now() };
        entries.set(pathname, entry);
        return entry;
      })
      .finally(() => {
        inFlight.delete(pathname);
      });

    inFlight.set(pathname, running);
    return running;
  };

  const refresh = (pathname: string): void => {
    if (inFlight.has(pathname)) return;
    const running = produce(pathname).then(
      () => undefined,
      (error: unknown) => {
        // The entry is only replaced on success, so the stale page is still
        // there and will be served — and asked for again next time.
        options.onError?.(error, pathname);
      },
    );
    background.add(running);
    void running.finally(() => background.delete(running));
  };

  const served = (pathname: string, entry: Entry, hit: boolean, stale: boolean): CachedPage => ({
    pathname,
    html: entry.html,
    renderedAt: entry.renderedAt,
    hit,
    stale,
  });

  return {
    async get(pathname) {
      const entry = entries.get(pathname);
      if (!entry) return served(pathname, await produce(pathname), false, false);

      if (now() - entry.renderedAt < windowFor(pathname)) {
        return served(pathname, entry, true, false);
      }

      if (!serveStale) return served(pathname, await produce(pathname), false, false);

      refresh(pathname);
      return served(pathname, entry, true, true);
    },

    peek(pathname) {
      const entry = entries.get(pathname);
      if (!entry) return undefined;
      return served(pathname, entry, true, now() - entry.renderedAt >= windowFor(pathname));
    },

    invalidate(pathname) {
      if (pathname === undefined) entries.clear();
      else entries.delete(pathname);
    },

    get refreshing() {
      return background.size;
    },

    async idle() {
      // A refresh can start another; drain rather than take one snapshot.
      while (background.size > 0) await Promise.all([...background]);
    },
  };
}

// ---------------------------------------------------------------------------
// Writing the files
// ---------------------------------------------------------------------------

export interface PrerenderOptions {
  /** `flattenRoutes(routes)` — what the router already knows about the table. */
  branches: readonly RouteBranchLike[];
  /** Where the files go. Nothing is written outside it. */
  outDir: string;
  /**
   * The renderer, if the caller has no cache of its own. Given one, the build
   * populates it, so a server started from the same process serves the pages
   * the build produced instead of rendering them again.
   */
  render?: (pathname: string) => string | Promise<string>;
  cache?: RenderCache;
  /** Seconds a page stays fresh, if the build is seeding a cache that revalidates. */
  revalidate?: number | ((pathname: string) => number | undefined);
  params?: ParamsForPattern;
  /**
   * `directory` writes `/about` as `about/index.html`, which is what a static
   * host serves at `/about` without a redirect. `flat` writes `about.html`,
   * for a host that appends the extension itself.
   */
  layout?: 'directory' | 'flat';
  /** How many pages are rendered at once. */
  concurrency?: number;
}

export interface PrerenderedPage {
  readonly pathname: string;
  /** Absolute path of the file written. */
  readonly file: string;
  readonly bytes: number;
  /** The markup came from the cache rather than from a render this build did. */
  readonly cached: boolean;
}

export interface PrerenderResult {
  readonly pages: readonly PrerenderedPage[];
  readonly skipped: readonly SkippedRoute[];
  /** The cache the build rendered through, seeded with every page it wrote. */
  readonly cache: RenderCache;
}

/** Where a URL's markup belongs under `outDir`. */
export function fileForPathname(
  outDir: string,
  pathname: string,
  layout: 'directory' | 'flat' = 'directory',
): string {
  const trimmed = pathname.replace(/^\/+|\/+$/g, '');
  const relative =
    trimmed === '' ? 'index.html' : layout === 'flat' ? `${trimmed}.html` : `${trimmed}/index.html`;

  const root = resolvePath(outDir);
  const file = resolvePath(root, relative);
  // Belt and braces: `buildPathname` refuses the values that could do this,
  // and a caller may hand a pathname straight in.
  if (file !== root && !file.startsWith(root + sep)) {
    throw new PrerenderError(
      `[volt] "${pathname}" would be written to ${file}, which is outside ${root}.`,
    );
  }
  return file;
}

async function pool<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await run(items[index]!);
    }
  });
  await Promise.all(workers);
}

/**
 * Render every URL the table can produce and write it to `outDir`.
 *
 * Every page goes through the cache, even on a build that will never
 * revalidate: a build is the first miss on every URL, which is the same thing
 * a cold server is. Two routes resolving to one URL therefore render once,
 * and a caller that keeps the returned cache has a warm server rather than a
 * directory of files it has to read back.
 *
 * A render that throws does not stop the others — a build that reports one
 * broken page out of four hundred is worth more than one that reports the
 * first — but it does fail the build once they have all been attempted.
 */
export async function prerender(options: PrerenderOptions): Promise<PrerenderResult> {
  const cache =
    options.cache ??
    (options.render
      ? createRenderCache({ render: options.render, revalidate: options.revalidate })
      : null);

  if (!cache) {
    throw new PrerenderError('[volt] prerender needs a `render` function or a `cache` to use one.');
  }

  const { routes, skipped } = await enumerateRoutes(options.branches, options.params);
  const layout = options.layout ?? 'directory';

  const pages: PrerenderedPage[] = [];
  const failures: { pathname: string; cause: unknown }[] = [];

  await pool(routes, options.concurrency ?? 8, async (route) => {
    const file = fileForPathname(options.outDir, route.pathname, layout);
    try {
      const page = await cache.get(route.pathname);
      const html = page.html;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, html, 'utf8');
      pages.push({
        pathname: route.pathname,
        file,
        bytes: Buffer.byteLength(html),
        cached: page.hit,
      });
    } catch (error) {
      failures.push({ pathname: route.pathname, cause: error });
    }
  });

  if (failures.length > 0) {
    const named = failures.map((failure) => `  ${failure.pathname}`).join('\n');
    throw new PrerenderError(
      `[volt] ${failures.length} page${failures.length === 1 ? '' : 's'} could not be ` +
        `prerendered:\n${named}`,
      failures,
    );
  }

  pages.sort((a, b) => (a.pathname < b.pathname ? -1 : a.pathname > b.pathname ? 1 : 0));
  return { pages, skipped, cache };
}
