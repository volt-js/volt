/**
 * Every shape a branch can take, claimed where the server wrote it.
 *
 * `hydrate.test.ts` walks one site's pages. The outlet is a content hole, and
 * what a route puts into one is not always a single element: a leaf with two
 * roots, a leaf that is only text, a leaf whose root is another component, a
 * list, an outlet that sits in a child component of the layout or inside a
 * `:if`, a layout with no path, a run of layouts with no component. Each of
 * those claims through a different path in the runtime, and a path that built
 * a copy instead would print the same bytes — so what is compared is node
 * identity, and the bytes as well, and then a navigation straight after.
 *
 * And what the router says about where it is, straight after: the page is the
 * server's, but the history entry it sits in is the browser's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { compile } from '@voltdev/compiler';
import {
  Component,
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
import { provideRouter } from '../src/context.js';
import { createRouter, routeData, type Router } from '../src/router.js';
import { defineRoutes } from '../src/routes.js';

/** The build flag, which the test config compiles to a live read of this global. */
function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

/** One source, compiled for both sides, picking at call time; see `hydrate.test.ts`. */
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

@Component({
  selector: 'v-s-root',
  render: template(`<div class="root"><main :outlet></main></div>`),
})
class Root {}

@Component({
  selector: 'v-s-frame',
  render: template(`<div class="frame"><aside :outlet></aside></div>`),
})
class Frame {}

/** A layout whose outlet is in a child component's template, not its own. */
@Component({
  selector: 'v-s-via',
  render: template(`<div class="via"><v-s-frame></v-s-frame></div>`),
  imports: [Frame],
})
class Via {}

/** A layout whose outlet is inside a branch. */
@Component({
  selector: 'v-s-cond',
  render: template(`<div class="cond"><template :if="open()"><nav :outlet></nav></template></div>`),
})
class Cond {
  open = (): boolean => true;
}

@Component({ selector: 'v-s-pair', render: template(`<h2 class="a">{ t() }</h2><p class="b">b</p>`) })
class Pair {
  private data = routeData<string>();
  t = (): string => this.data() ?? '?';
}

@Component({ selector: 'v-s-text', render: template(`{ t() }`) })
class TextOnly {
  private data = routeData<string>();
  t = (): string => this.data() ?? '?';
}

@Component({ selector: 'v-s-card', render: template(`<div class="card">card</div>`) })
class Card {}

@Component({
  selector: 'v-s-wraps',
  render: template(`<v-s-card></v-s-card>`),
  imports: [Card],
})
class Wraps {}

@Component({
  selector: 'v-s-list',
  render: template(`<ul class="list"><li :for="item of items()" :key="item">{ item }</li></ul>`),
})
class List {
  private data = routeData<string[]>();
  items = (): string[] => this.data() ?? [];
}

@Component({ selector: 'v-s-leaf', render: template(`<p class="leaf">leaf</p>`) })
class Leaf {}

const table = defineRoutes([
  {
    path: '/',
    children: [
      { path: 'pair', component: Pair, loader: () => 'pair' },
      { path: 'text', component: TextOnly, loader: () => 'text' },
      { path: 'wraps', component: Wraps },
      { path: 'list', component: List, loader: () => ['a', 'b', 'c'] },
      { path: 'via', component: Via, children: [{ path: 'x', component: Leaf }] },
      { path: 'cond', component: Cond, children: [{ path: 'x', component: Leaf }] },
      { component: Frame, children: [{ path: 'pathless', component: Pair, loader: () => 'pathless' }] },
      { path: 'deep', children: [{ children: [{ path: 'er', component: Pair, loader: () => 'deeper' }] }] },
    ],
  },
]);

const PATHS = ['/pair', '/text', '/wraps', '/list', '/via/x', '/cond/x', '/pathless', '/deep/er'];

/** The bytes a server sends for `path`, written by a router of its own. */
async function page(path: string): Promise<string> {
  serverBuild(true);
  try {
    resetIds();
    const router = createRouter({ routes: table });
    await router.resolve(`https://example.test${path}`);
    const { html } = await renderToStaticMarkup(Root, {
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

let started: Router | null = null;
let dispose: (() => void) | null = null;

afterEach(() => {
  started?.stop();
  started = null;
  dispose?.();
  dispose = null;
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

/**
 * What `serverRender`'s client does with the page the server sent for `path`:
 * resolve, claim, listen. The history entry is whatever is there already —
 * set it first to boot a reload.
 */
async function boot(path: string) {
  const html = await page(path);
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  const printed = nodesOf(host);

  const router = createRouter({ routes: table });
  started = router;
  await router.resolve(window.location.href);
  const mismatches: unknown[] = [];
  const stop = runtime.onHydrationMismatch((mismatch) => mismatches.push(mismatch));
  try {
    // A browser mints from a fresh page; the test runner's page is not.
    resetIds();
    createRoot((stopRoot) => {
      dispose = stopRoot;
      hydrate(Root, host, {
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
  return { html, host, printed, router, mismatches };
}

describe('a branch of any shape', () => {
  it.each(PATHS)('is claimed on %s, every node of it', async (path) => {
    window.history.replaceState(null, '', path);
    const { html, host, printed, mismatches } = await boot(path);

    expect(mismatches).toEqual([]);
    expect(host.innerHTML).toBe(html);
    const now = nodesOf(host);
    expect(now).toHaveLength(printed.length);
    now.forEach((node, index) => expect(node).toBe(printed[index]));
  });

  it.each([
    ['/pair', '/text'],
    ['/text', '/list'],
    ['/list', '/pair'],
    ['/pathless', '/pair'],
    ['/via/x', '/cond/x'],
    ['/deep/er', '/pathless'],
  ])('navigates from %s to %s the moment it is claimed, and back', async (from, to) => {
    window.history.replaceState(null, '', from);
    const { host, router } = await boot(from);

    // What a server would have written for each is what the client builds:
    // the claimed nodes are replaced whole, and nothing of them is left over.
    expect((await router.navigate(to)).status).toBe('completed');
    expect(host.innerHTML).toBe(await page(to));
    expect((await router.navigate(from)).status).toBe('completed');
    expect(host.innerHTML).toBe(await page(from));
  });
});

describe('a page the reader reloaded', () => {
  it('says what its history entry carried, as a page the browser built would', async () => {
    // A navigation stored something on its entry, and the reader reloads. The
    // server rendered the URL, which is all it can see; the entry is the
    // browser's, and it survived the reload. `start()` publishes it when it
    // resolves the page itself, so a page that was claimed instead has to
    // publish it too — or `state()` answers differently for the same reload
    // depending on which mode the route happened to be in.
    window.history.replaceState({ volt: 1, key: 'before', index: 2, state: { from: 'list' } }, '', '/pair');

    const { router } = await boot('/pair');

    expect(router.state()).toEqual({ from: 'list' });
    // And the entry is the same one: its key still files its scroll position.
    expect((window.history.state as { key: string; index: number }).key).toBe('before');
    expect((window.history.state as { key: string; index: number }).index).toBe(2);
  });
});
