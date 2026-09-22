// @vitest-environment node
//
// No `window`, no `document`, no happy-dom underneath either — because the
// claim being made is exactly that there is nothing here to read. A router
// created in a jsdom-shaped environment would pass every test below while
// quietly reading a location, and the failure it is meant to catch only shows
// up in the one place nobody runs the tests: a real server.

/**
 * The router on a server: one process, many requests, no DOM.
 *
 * Three things have to be true before server rendering can work at all, and
 * none of them was before the branch became part of the render:
 *
 *   - **A router can be created.** The route table is a module, loaded once
 *     for every request there will ever be, so `createRouter` reading a
 *     location would be a router built around the first URL it ever saw — on a
 *     server, a `ReferenceError` at import time.
 *   - **Two of them share nothing.** Two requests in flight are two routers
 *     resolving different URLs at the same time, and anything held at module
 *     scope is one request's branch rendering into the other's page.
 *   - **The branch is written in one pass**, nested outlet by outlet, so a
 *     page arrives whole rather than as a shell with a hole in it.
 */
import { describe, expect, it } from 'vitest';

/** The build flag, which the test config compiles to a live read of this global. */
(globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = true;

const { Component } = await import('@voltdev/core');
const { compileTemplate } = await import('@voltdev/core/jit');
const { renderToStaticMarkup } = await import('@voltdev/core/server');
const { provideOutlet } = await import('@voltdev/core');
const { provideRouter, useRouter } = await import('../src/context.js');
const { createRouter, routeData } = await import('../src/router.js');
const { defineRoutes } = await import('../src/routes.js');

// ---------------------------------------------------------------------------
// A three-deep branch
// ---------------------------------------------------------------------------

/**
 * The application's own root, which is not a route.
 *
 * The render starts here and the router fills the outlet in it, exactly as in
 * a browser — the same component, with the same outlet, compiled for the other
 * side.
 */
@Component({
  selector: 'v-app',
  render: compileTemplate(`<div class="app"><header>app</header><main :outlet></main></div>`),
})
class App {}

/** Depth 0 of the branch: the layout every page in the table renders inside. */
@Component({
  selector: 'v-shell',
  render: compileTemplate(`<div class="shell"><nav>nav</nav><div :outlet></div></div>`),
})
class Shell {}

@Component({
  selector: 'v-docs',
  render: compileTemplate(`<section class="docs"><h1>docs</h1><article :outlet></article></section>`),
})
class Docs {}

@Component({ selector: 'v-topic', render: compileTemplate(`<p class="topic">{ label() }</p>`) })
class Topic {
  private data = routeData<{ title: string }>();
  private router = useRouter();
  label = (): string => `${this.data()?.title ?? '?'} (${this.router.param('id') ?? '?'})`;
}

const routes = defineRoutes([
  {
    path: '/',
    component: Shell,
    children: [
      {
        path: 'docs',
        component: Docs,
        children: [
          {
            path: ':id',
            component: Topic,
            loader: ({ params }) => ({ title: `topic ${params['id']}` }),
          },
        ],
      },
    ],
  },
]);

describe('a router with no browser under it', () => {
  it('is created, resolved and read without touching a window', async () => {
    // The assertion is the absence of a throw: every read this used to make at
    // creation — three location signals and the history entry — is a
    // `ReferenceError` here.
    const router = createRouter({ routes });
    expect(router.pathname()).toBe('');

    const result = await router.resolve('https://example.test/docs/7?tab=api#top');

    expect(result.status).toBe('completed');
    expect(router.pathname()).toBe('/docs/7');
    expect(router.search()).toBe('?tab=api');
    expect(router.hash()).toBe('#top');
    expect(router.params()).toEqual({ id: '7' });
    // Everything a route reads about itself is seeded by `resolve`, or a route
    // rendering on a server cannot read its own parameters.
    expect(router.param('id')).toBe('7');
    expect(router.query('tab')).toBe('api');
    expect(router.matches().map((match) => match.pattern)).toEqual(['/', '/docs', '/docs/:id']);
    expect(router.status()).toBe('idle');
  });

  it('takes a relative URL too, since only the path is ever read', async () => {
    const router = createRouter({ routes });
    expect((await router.resolve('/docs/3')).status).toBe('completed');
    expect(router.param('id')).toBe('3');
  });

  it('says which method needed a browser, rather than failing inside one', () => {
    const router = createRouter({ routes });
    // `navigate` writes history and `revalidate` re-runs in place; both are
    // about a page that is on screen. A server resolves instead, and is told
    // so rather than finding out from a `window` that is not there.
    expect(() => router.navigate('/docs/1')).toThrow(/before start/);
    expect(() => router.revalidate()).toThrow(/before start/);
  });
});

describe('two routers in one process', () => {
  it('resolve different URLs at the same time and see nothing of each other', async () => {
    const one = createRouter({ routes });
    const two = createRouter({ routes });

    // Started together and deliberately finished in the other order, which is
    // where shared state shows up as the wrong answer rather than as no
    // answer: whichever settles last would own a module-level branch.
    const [first, second] = await Promise.all([
      one.resolve('https://example.test/docs/1'),
      two.resolve('https://example.test/docs/2'),
    ]);

    expect([first.status, second.status]).toEqual(['completed', 'completed']);
    expect(one.param('id')).toBe('1');
    expect(two.param('id')).toBe('2');

    const [a, b] = await Promise.all([
      renderToStaticMarkup(App, {
        setup: () => {
          provideRouter(one);
          provideOutlet(one.outletAt(0));
        },
      }),
      renderToStaticMarkup(App, {
        setup: () => {
          provideRouter(two);
          provideOutlet(two.outletAt(0));
        },
      }),
    ]);

    expect(a.html).toContain('topic 1 (1)');
    expect(b.html).toContain('topic 2 (2)');
  });
});

describe('a branch written in one pass', () => {
  it('nests three deep, each route inside the element above it', async () => {
    const router = createRouter({ routes });
    await router.resolve('https://example.test/docs/42');

    const { html } = await renderToStaticMarkup(App, {
      setup: () => {
        provideRouter(router);
        provideOutlet(router.outletAt(0));
      },
    });

    // The whole claim, as one string: the leaf is inside the `<article>` the
    // route above it marked, which is inside the shell, which is inside the
    // application's own `<main>`. A branch mounted afterwards cannot produce
    // this — there is nothing to mount into during a walk that writes its
    // bytes once and never goes back.
    expect(html).toBe(
      '<div class="app"><header>app</header><main>' +
        '<div class="shell"><nav>nav</nav><div>' +
        '<section class="docs"><h1>docs</h1><article>' +
        '<p class="topic">topic 42 (42)</p>' +
        '</article></section>' +
        '</div></div>' +
        '</main></div>',
    );
  });

  it('renders the depth below a layout that has no component of its own', async () => {
    const grouped = defineRoutes([
      {
        path: '/',
        component: Shell,
        children: [{ path: 'docs', children: [{ path: ':id', component: Topic }] }],
      },
    ]);
    const router = createRouter({ routes: grouped });
    await router.resolve('https://example.test/docs/9');

    const { html } = await renderToStaticMarkup(App, {
      setup: () => {
        provideRouter(router);
        provideOutlet(router.outletAt(0));
      },
    });

    // A route with no component contributes a loader and a slice of the URL
    // and nothing to the page. The depth below it renders where it would have.
    expect(html).toContain('<p class="topic">? (9)</p>');
  });

  it('says which route has no outlet, while there is still a render to blame', async () => {
    const broken = defineRoutes([
      {
        path: '/',
        component: Shell,
        children: [{ path: 'docs', component: Topic, children: [{ path: ':id', component: Topic }] }],
      },
    ]);
    const router = createRouter({ routes: broken });
    await router.resolve('https://example.test/docs/1');

    // A server has no end to sweep at: the bytes are written as the walk
    // passes, so the complaint has to arrive while the walk is inside the
    // layout that never asked for its child.
    await expect(
      renderToStaticMarkup(App, {
        setup: () => {
          provideRouter(router);
          provideOutlet(router.outletAt(0));
        },
      }),
    ).rejects.toThrow(/:outlet/);
  });
});
