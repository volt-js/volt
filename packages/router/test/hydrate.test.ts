/**
 * The round trip: a server writes the branch, a client claims it.
 *
 * Every other test here asserts on what is on the page, which a client that
 * threw the server's work away and built its own would pass just as well. The
 * question this file asks is whether the nodes afterwards are the *same
 * objects*, because that is the only difference between claiming a tree and
 * replacing one, and replacing it is what server rendering was doing before
 * the branch became part of the render.
 *
 * The second half is the order nobody means to write and everybody eventually
 * does: hydrate first, resolve after. An outlet with nothing to render yet
 * must not take the server's markup off the screen while it waits — that is a
 * page that renders, blanks, and comes back, which is worse than not having
 * rendered on the server at all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { compile } from '@voltdev/compiler';
import {
  Component,
  createId,
  createRoot,
  flushSync,
  hydrate,
  provideOutlet,
  resetIds,
  type RenderFn,
} from '@voltdev/core';
import * as runtime from '@voltdev/core/runtime';
import * as server from '@voltdev/core/server';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { provideRouter, useRouter } from '../src/context.js';
import { createRouter, routeData, type Router } from '../src/router.js';
import { defineRoutes, type RouteDefinition } from '../src/routes.js';

/** The build flag, which the test config compiles to a live read of this global. */
function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

/**
 * One source, compiled for both sides, picking at call time.
 *
 * A real build picks one and ships it. A round trip has to run both against
 * the same components, and the only thing that changes between them is which
 * emit the render function came from — which is the claim being tested.
 */
function template(source: string): RenderFn {
  const forServer = compile(source, { runtime: '_rt', target: 'server' }).body;
  const forHydrate = compile(source, { runtime: '_rt', target: 'hydrate' }).body;
  const write = (new Function('_rt', forServer) as (rt: unknown) => RenderFn)(server);
  const claim = (new Function('_rt', forHydrate) as (rt: unknown) => RenderFn)(runtime);
  return (ctx, out) =>
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ === true
      ? write(ctx, out)
      : claim(ctx, out);
}

const built: string[] = [];

@Component({
  selector: 'v-h-app',
  render: template(`<div class="app"><header>app</header><main :outlet></main></div>`),
})
class App {}

@Component({
  selector: 'v-h-shell',
  render: template(`<div class="shell"><nav>nav</nav><div :outlet></div></div>`),
})
class Shell {
  constructor() {
    built.push('shell');
  }
}

@Component({ selector: 'v-h-topic', render: template(`<p class="topic">{ title() }</p>`) })
class Topic {
  private data = routeData<{ title: string }>();
  title = (): string => this.data()?.title ?? '?';

  constructor() {
    built.push('topic');
  }
}

const routes = defineRoutes([
  {
    path: '/',
    component: Shell,
    children: [
      {
        path: 'docs/:id',
        component: Topic,
        loader: ({ params }) => ({ title: `topic ${params['id']}` }),
      },
    ],
  },
]);

/** The bytes a server would send, for this URL. */
async function printed(url: string): Promise<string> {
  serverBuild(true);
  try {
    const router = createRouter({ routes });
    await router.resolve(url);
    const { html } = await renderToStaticMarkup(App, {
      setup: () => {
        provideRouter(router);
        provideOutlet(router.outletAt(0));
      },
    });
    return html;
  } finally {
    serverBuild(false);
  }
}

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  built.length = 0;
  document.body.innerHTML = '';
});

function serve(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

describe('a page the server wrote', () => {
  it('is claimed, not rebuilt, when the router resolved before it hydrated', async () => {
    const host = serve(await printed('https://example.test/docs/7'));
    const shell = host.querySelector('.shell')!;
    const topic = host.querySelector('.topic')!;

    const router = createRouter({ routes });
    await router.resolve('https://example.test/docs/7');
    built.length = 0;

    createRoot((stop) => {
      dispose = stop;
      hydrate(App, host, {
        setup: () => {
          provideRouter(router);
          provideOutlet(router.outletAt(0));
        },
      });
    });
    flushSync();

    // The very nodes the server printed, still on the page and now owned by
    // the components that would have built them. A branch mounted into the
    // DOM afterwards replaces both of these.
    expect(host.querySelector('.shell')).toBe(shell);
    expect(host.querySelector('.topic')).toBe(topic);
    expect(host.querySelector('.topic')!.textContent).toBe('topic 7');
    expect(built).toEqual(['shell', 'topic']);
  });

  it('keeps what the server wrote until the router has resolved', async () => {
    const host = serve(await printed('https://example.test/docs/7'));
    const shell = host.querySelector('.shell')!;
    // The server's own construction of these is not what is being counted.
    built.length = 0;

    // The order nobody means to write: the page attaches first and the branch
    // arrives after. An outlet with nothing in it yet renders nothing, and
    // "nothing" to an insert means *clear what is there* — which would take
    // the page off the screen and put a different copy of it back.
    const router = createRouter({ routes });
    createRoot((stop) => {
      dispose = stop;
      hydrate(App, host, {
        setup: () => {
          provideRouter(router);
          provideOutlet(router.outletAt(0));
        },
      });
    });
    flushSync();

    expect(host.querySelector('.shell')).toBe(shell);
    expect(host.querySelector('.topic')!.textContent).toBe('topic 7');
    expect(built).toEqual([]);

    // And once it resolves, the branch it renders replaces what it was
    // holding — which is a swap the reader sees at the moment the data is
    // there, rather than a blank page in the meantime.
    await router.resolve('https://example.test/docs/7');
    flushSync();

    expect(built).toEqual(['shell', 'topic']);
    expect(host.querySelector('.topic')!.textContent).toBe('topic 7');
    expect(host.querySelector('main')!.children).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Every page of a site, and the ones that are not the happy path
// ---------------------------------------------------------------------------

/** The root of a site: a navigation that reads where it is, and the outlet. */
@Component({
  selector: 'v-h-site',
  render: template(
    `<div class="site"><nav>` +
      `<a class="to-home" href="/" :aria-current="here('/')">home</a>` +
      `<a class="to-doc" href="/docs/7" :aria-current="here('/docs/7')">doc</a>` +
      `</nav><main :outlet></main></div>`,
  ),
})
class Site {
  private router = useRouter();
  here(path: string): 'page' | undefined {
    return this.router.pathname() === path ? 'page' : undefined;
  }
}

@Component({ selector: 'v-h-home', render: template(`<p class="home">home</p>`) })
class Home {}

/** A page that labels itself, with an id minted where the outlet renders it. */
@Component({
  selector: 'v-h-doc',
  render: template(`<section class="doc" :aria-labelledby="id"><h2 :id="id">{ title() }</h2></section>`),
})
class Doc {
  id = createId('doc');
  private data = routeData<{ title: string }>();
  title = (): string => this.data()?.title ?? '?';
}

@Component({ selector: 'v-h-guide', render: template(`<p class="guide">{ slug() }</p>`) })
class Guide {
  private data = routeData<string>();
  slug = (): string => this.data() ?? '?';
}

/** Whether the browser's run of the doc's loader fails; the server's never does. */
let offline = false;

const site = defineRoutes([
  {
    path: '/',
    component: Shell,
    children: [
      { index: true, component: Home },
      {
        path: 'docs/:id',
        component: Doc,
        loader: ({ params }) => {
          const onServer = (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ === true;
          if (offline && !onServer) throw new Error('offline');
          return { title: `doc ${params['id']}` };
        },
      },
      // A layout with no component of its own: a slice of the URL and a loader
      // to hang its children on, and nothing on the page.
      {
        path: 'guides',
        loader: () => 'guides',
        children: [{ path: ':slug', component: Guide, loader: ({ params }) => params['slug'] }],
      },
    ],
  },
]);

/** What a server sends for `path`, written by a router of its own. */
async function page(path: string, table: readonly RouteDefinition[] = site): Promise<string> {
  serverBuild(true);
  try {
    const router = createRouter({ routes: table });
    await router.resolve(`https://example.test${path}`);
    const { html } = await renderToStaticMarkup(Site, {
      setup: () => {
        provideRouter(router);
        provideOutlet(router.outletAt(0));
      },
    });
    return html;
  } finally {
    serverBuild(false);
  }
}

/** Every node under `host`, in document order. */
function nodesOf(host: Node): Node[] {
  const found: Node[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_ALL);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) found.push(node);
  return found;
}

/** What `serverRender`'s client does, in its order: resolve, claim, listen. */
async function boot(
  host: HTMLElement,
  path: string,
  table: readonly RouteDefinition[] = site,
): Promise<{ router: Router; mismatches: unknown[] }> {
  window.history.replaceState(null, '', path);
  const router = createRouter({ routes: table });
  started = router;
  await router.resolve(window.location.href);

  const mismatches: unknown[] = [];
  const stop = runtime.onHydrationMismatch((mismatch) => mismatches.push(mismatch));
  try {
    // A browser mints from a fresh page; the test runner's page is not.
    resetIds();
    createRoot((dispose) => {
      disposeSite = dispose;
      hydrate(Site, host, {
        setup: () => {
          provideRouter(router);
          provideOutlet(router.outletAt(0));
        },
      });
    });
    flushSync();
  } finally {
    stop();
  }
  await router.start({ resolve: false });
  return { router, mismatches };
}

let started: Router | null = null;
let disposeSite: (() => void) | null = null;

afterEach(() => {
  started?.stop();
  started = null;
  disposeSite?.();
  disposeSite = null;
  offline = false;
  window.history.replaceState(null, '', '/');
});

/** The server's page, served, with every node it printed held for comparison. */
async function served(path: string, table?: readonly RouteDefinition[]) {
  resetIds();
  const html = await page(path, table);
  const host = serve(html);
  return { html, host, printed: nodesOf(host) };
}

describe('every page of a site the server wrote', () => {
  it.each(['/', '/docs/7', '/guides/intro'])('claims %s, every node of it', async (path) => {
    const { html, host, printed } = await served(path);

    const { mismatches } = await boot(host, path);

    expect(mismatches).toEqual([]);
    const now = nodesOf(host);
    expect(now).toHaveLength(printed.length);
    now.forEach((node, index) => expect(node).toBe(printed[index]));
    // And agrees with every byte, the ids minted under an outlet included:
    // the client reaches the leaf at the position the server did.
    expect(host.innerHTML).toBe(html);
  });

  it('claims through a root route that has no component at all', async () => {
    const bare = defineRoutes([
      { path: '/', children: [{ path: 'guides/:slug', component: Guide, loader: ({ params }) => params['slug'] }] },
    ]);
    const { host, printed } = await served('/guides/a', bare);

    const { mismatches } = await boot(host, '/guides/a', bare);

    expect(mismatches).toEqual([]);
    nodesOf(host).forEach((node, index) => expect(node).toBe(printed[index]));
    expect(host.querySelector('main > .guide')?.textContent).toBe('a');
  });

  it('navigates the moment it is claimed, keeping the layout', async () => {
    const { host } = await served('/docs/7');
    const shell = host.querySelector('.shell');
    const { router } = await boot(host, '/docs/7');

    // Into the group with no component, then within it, then out of it.
    expect((await router.navigate('/guides/intro')).status).toBe('completed');
    expect(host.querySelector('.shell')).toBe(shell);
    expect(host.querySelector('.guide')?.textContent).toBe('intro');
    expect(host.querySelector('.doc')).toBeNull();
    expect(host.querySelector('.to-doc')?.hasAttribute('aria-current')).toBe(false);

    const intro = host.querySelector('.guide');
    await router.navigate('/guides/setup');
    expect(host.querySelector('.guide')).not.toBe(intro);
    expect(host.querySelector('.guide')?.textContent).toBe('setup');

    (host.querySelector('.to-home') as HTMLElement).click();
    await new Promise((settle) => setTimeout(settle, 0));
    flushSync();
    expect(host.querySelector('.shell')).toBe(shell);
    expect(host.querySelector('.shell .home')).not.toBeNull();
    expect(host.querySelectorAll('.shell')).toHaveLength(1);
    expect(host.querySelector('.to-home')?.getAttribute('aria-current')).toBe('page');
  });
});

describe('a page whose loader fails in the browser', () => {
  it('keeps the page the server wrote, and where it is', async () => {
    // The server's run of the loader answered; the browser's did not. The page
    // on the screen is still the right page for this URL, so it stays — and
    // the root, which is attached either way, must not say it is nowhere.
    const { html, host, printed } = await served('/docs/7');
    offline = true;

    const { router, mismatches } = await boot(host, '/docs/7');

    expect(router.error()).toBeInstanceOf(Error);
    expect(mismatches).toEqual([]);
    nodesOf(host).forEach((node, index) => expect(node).toBe(printed[index]));
    expect(host.innerHTML).toBe(html);
    expect(router.pathname()).toBe('/docs/7');
    expect(router.params()).toEqual({ id: '7' });
  });

  it('builds the next page whole, and the same one again when asked', async () => {
    const { host } = await served('/docs/7');
    offline = true;
    const { router } = await boot(host, '/docs/7');

    // Asking again is how an application retries, and it is a navigation to
    // where it already is — a replace, not an entry Back would land on.
    offline = false;
    const length = window.history.length;
    expect((await router.revalidate()).status).toBe('completed');
    expect(window.history.length).toBe(length);
    expect(host.querySelectorAll('.doc')).toHaveLength(1);
    expect(host.querySelector('.doc h2')?.textContent).toBe('doc 7');
    expect(router.error()).toBeUndefined();

    await router.navigate('/');
    expect(host.querySelectorAll('.shell')).toHaveLength(1);
    expect(host.querySelector('.shell .home')).not.toBeNull();
    expect(host.querySelector('.to-home')?.getAttribute('aria-current')).toBe('page');
  });
});
