/**
 * The router, driven through real mounted components.
 *
 * Four things here are the reason the package exists, and each is written so
 * that the obvious wrong implementation fails it:
 *
 *   - a layout that survives a sibling navigation, which fails the moment
 *     anything re-mounts the branch from the root;
 *   - loader data present in the route's constructor, which fails for any
 *     implementation that mounts first and fetches after;
 *   - a parameter read that does not wake for a different parameter, which
 *     fails if `param()` reaches into a single params object;
 *   - Back and Forward restoring both the route and the scroll position,
 *     which fails if scroll is saved per URL rather than per history entry.
 *
 * The application mounts its own root and the router fills the outlets in it.
 * That is the shape of every test here, and it is the shape because the branch
 * is part of the render now: nothing is mounted into anything afterwards, so
 * the router is given no element and hands back no DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Component,
  createRoot,
  effect,
  flushSync,
  mount,
  onCleanup,
  provideOutlet,
  type ComponentType,
  type MountHandle,
} from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { provideRouter } from '../src/context.js';
import { createRouter, routeData, type Router, type Transition } from '../src/router.js';
import { defineRoutes } from '../src/routes.js';

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Every construction, in order. A re-mount is what this makes visible. */
let built: string[] = [];
/** Every teardown, in order, which is the other half of the same question. */
let destroyed: string[] = [];

@Component({
  selector: 'v-root',
  render: compileTemplate(`<div class="root"><span>root</span><div :outlet></div></div>`),
})
class Root {
  constructor() {
    built.push('root');
    onCleanup(() => destroyed.push('root'));
  }
}

@Component({
  selector: 'v-users',
  render: compileTemplate(`<div class="users"><h1>users</h1><div :outlet></div></div>`),
})
class UsersLayout {
  constructor() {
    built.push('users');
    onCleanup(() => destroyed.push('users'));
  }
}

@Component({ selector: 'v-user-list', render: compileTemplate(`<ul class="list">list</ul>`) })
class UserList {
  constructor() {
    built.push('list');
    onCleanup(() => destroyed.push('list'));
  }
}

@Component({ selector: 'v-user', render: compileTemplate(`<p class="user">{ label() }</p>`) })
class UserPage {
  data = routeData<{ name: string }>();
  /** What the loader had already produced by the time this class was built. */
  atConstruction = this.data();

  constructor() {
    built.push('user');
    onCleanup(() => destroyed.push('user'));
  }

  label(): string {
    return this.data()?.name ?? 'nothing';
  }
}

@Component({ selector: 'v-about', render: compileTemplate(`<p class="about">about</p>`) })
class About {
  constructor() {
    built.push('about');
  }
}

@Component({
  selector: 'v-doc',
  render: compileTemplate(`<article class="doc"><h2 id="section">section</h2></article>`),
})
class Doc {
  constructor() {
    built.push('doc');
  }
}

/**
 * The application's own root, which is not a route.
 *
 * Every test mounts this and the router fills the outlet in it. Nothing the
 * router does replaces it — a navigation changes the branch, not the
 * application — and it is not in `built`, because it is not something the
 * router builds.
 */
@Component({ selector: 'v-app', render: compileTemplate(`<div class="app" :outlet></div>`) })
class App {}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let host: HTMLElement;
let routers: Router<string>[] = [];
let mounted: MountHandle[] = [];

/** Track a router so the test tears it down, and its listeners with it. */
function track<T extends Router<never>>(router: T): T {
  routers.push(router as unknown as Router<string>);
  return router;
}

/**
 * What an application does: mount its own root, with the router in scope and
 * depth 0 of the branch provided to the outlet in it.
 *
 * The provider has to be installed in `setup`, because the scope the root
 * renders in is created inside `mount` — provided out here it would be
 * provided to nothing.
 */
function attach(router: Router<never>, root: ComponentType<unknown> = App): MountHandle {
  const handle = mount(root, host, {
    setup: () => {
      provideRouter(router);
      provideOutlet(router.outletAt(0));
    },
  });
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  built = [];
  destroyed = [];
  mounted = [];
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  window.history.replaceState(null, '', '/');
  window.scrollTo(0, 0);
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  for (const router of routers) router.stop();
  routers = [];
  flushSync();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------

describe('nested layouts', () => {
  const routes = defineRoutes([
    {
      path: '/',
      component: Root,
      children: [
        {
          path: 'users',
          component: UsersLayout,
          children: [
            { index: true, component: UserList },
            { path: ':id', component: UserPage },
          ],
        },
        { path: 'about', component: About },
      ],
    },
  ]);

  it('keeps a layout mounted while its children change', async () => {
    const router = track(createRouter({ routes }));
    attach(router);
    await router.start();
    await router.navigate('/users');
    await router.navigate('/users/1');
    await router.navigate('/users/2');

    expect(built).toEqual(['root', 'users', 'list', 'user', 'user']);
    // The layout was built once, at the front. Everything after it is the
    // children coming and going underneath.
    expect(built.filter((name) => name === 'users')).toHaveLength(1);
    expect(built.filter((name) => name === 'root')).toHaveLength(1);
  });

  it('keeps the layout’s DOM node, not merely its instance', async () => {
    const router = track(createRouter({ routes }));
    attach(router);
    await router.start();
    await router.navigate('/users/1');

    const layout = host.querySelector('.users');
    expect(layout).not.toBeNull();
    expect(host.textContent).toContain('nothing');

    await router.navigate('/users/2');
    expect(host.querySelector('.users')).toBe(layout);
    expect(layout!.isConnected).toBe(true);
  });

  it('rebuilds everything below the first difference', async () => {
    const router = track(createRouter({ routes }));
    attach(router);
    await router.start();
    await router.navigate('/users/1');
    built = [];

    await router.navigate('/about');
    expect(built).toEqual(['about']);
    expect(host.querySelector('.users')).toBeNull();
    expect(host.querySelector('.about')).not.toBeNull();
  });

  it('tears the branch down from the leaf up', async () => {
    const router = track(createRouter({ routes }));
    attach(router);
    await router.start();
    await router.navigate('/users/1');
    destroyed = [];

    await router.navigate('/about');
    // The other order pulls the DOM out from under a child that is still
    // observing it, and its cleanup then runs against a document it has
    // already been removed from.
    expect(destroyed).toEqual(['user', 'users']);
  });

  it('rebuilds a layout when its own parameters change', async () => {
    const scoped = defineRoutes([
      {
        path: '/org/:org',
        component: UsersLayout,
        children: [{ path: 'users/:id', component: UserPage }],
      },
    ]);
    const router = track(createRouter({ routes: scoped }));
    window.history.replaceState(null, '', '/org/a/users/1');
    attach(router);
    await router.start();
    built = [];

    await router.navigate('/org/a/users/2');
    expect(built).toEqual(['user']);

    // A different organisation is a different layout, whatever the pattern
    // says — its own slice of the URL changed.
    await router.navigate('/org/b/users/2');
    expect(built).toEqual(['user', 'users', 'user']);
  });

  it('lets a pathless layout group routes without appearing in the URL', async () => {
    const grouped = defineRoutes([
      {
        component: Root,
        children: [
          { path: 'about', component: About },
          { path: 'users', component: UserList },
        ],
      },
    ]);
    const router = track(createRouter({ routes: grouped }));
    window.history.replaceState(null, '', '/about');
    attach(router);
    await router.start();
    await router.navigate('/users');

    expect(built).toEqual(['root', 'about', 'list']);
    expect(router.pathname()).toBe('/users');
  });

  it('renders through a layout that has no component of its own', async () => {
    // A route can contribute a loader and a slice of the URL and nothing to
    // the page. That is not a hole in the branch: the depth below it renders
    // where it would have, and `/x` is one element deep.
    const grouped = defineRoutes([
      {
        path: '/',
        component: Root,
        children: [{ path: 'x', children: [{ index: true, component: About }] }],
      },
    ]);
    const router = track(createRouter({ routes: grouped }));
    window.history.replaceState(null, '', '/x');
    attach(router);
    await router.start();

    expect(built).toEqual(['root', 'about']);
    expect(host.querySelector('.root .about')).not.toBeNull();
  });

  it('says which route has no outlet rather than rendering into the wrong one', async () => {
    const broken = defineRoutes([
      { path: '/', component: About, children: [{ path: 'x', component: UserList }] },
    ]);
    const router = track(createRouter({ routes: broken }));
    window.history.replaceState(null, '', '/x');
    attach(router);

    // There is nothing to search for any more — an outlet is a place in a
    // template — so what is caught is the render that was never asked for: a
    // child with a segment under a parent that rendered without one.
    await expect(router.start()).rejects.toThrow(/:outlet/);
  });
});

describe('loaders', () => {
  it('has its data before the route is built', async () => {
    let instance: UserPage | null = null;

    @Component({ selector: 'v-recorded', render: compileTemplate(`<p class="user">{ label() }</p>`) })
    class Recorded extends UserPage {
      constructor() {
        super();
        instance = this;
      }
    }

    const routes = defineRoutes([
      {
        path: '/users/:id',
        component: Recorded,
        loader: async ({ params }) => {
          await Promise.resolve();
          return { name: `user ${params['id']}` };
        },
      },
    ]);

    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/users/7');
    attach(router);
    await router.start();

    // The assertion that matters: the data was in place when the class ran,
    // not delivered to it afterwards.
    expect(instance!.atConstruction).toEqual({ name: 'user 7' });
    expect(host.textContent).toBe('user 7');
  });

  it('does not move the page until every loader has answered', async () => {
    const gate = deferred<{ name: string }>();
    const routes = defineRoutes([
      { path: '/', component: About },
      { path: '/users/:id', component: UserPage, loader: () => gate.promise },
    ]);

    const router = track(createRouter({ routes }));
    attach(router);
    await router.start();
    expect(host.textContent).toBe('about');

    const navigation = router.navigate('/users/1');
    await Promise.resolve();
    expect(host.textContent).toBe('about');
    expect(window.location.pathname).toBe('/');
    expect(router.status()).toBe('loading');

    gate.resolve({ name: 'Ada' });
    await navigation;
    expect(host.textContent).toBe('Ada');
    expect(router.status()).toBe('idle');
  });

  it('fetches the chunk and the data at the same time', async () => {
    const order: string[] = [];
    const chunk = deferred<{ default: typeof UserPage }>();
    const routes = defineRoutes([
      { path: '/', component: About },
      {
        path: '/users/:id',
        component: () => {
          order.push('chunk');
          return chunk.promise;
        },
        loader: () => {
          order.push('loader');
          return { name: 'Ada' };
        },
      },
    ]);

    const router = track(createRouter({ routes }));
    attach(router);
    await router.start();

    const navigation = router.navigate('/users/1');
    await Promise.resolve();
    await Promise.resolve();

    // The loader ran while the chunk was still in flight. Awaiting the module
    // before starting the fetch would leave `order` at ['chunk'] here, and
    // would cost a whole round trip on every lazy route.
    expect(order).toEqual(['chunk', 'loader']);

    chunk.resolve({ default: UserPage });
    await navigation;
    expect(host.textContent).toBe('Ada');
    expect(built.filter((name) => name === 'user')).toHaveLength(1);
  });

  it('drops a superseded navigation and aborts its loader', async () => {
    const first = deferred<{ name: string }>();
    let firstSignal: AbortSignal | null = null;

    const routes = defineRoutes([
      { path: '/', component: About },
      {
        path: '/slow',
        component: UserPage,
        loader: ({ signal }) => {
          firstSignal = signal;
          return first.promise;
        },
      },
      { path: '/fast', component: UserList },
    ]);

    const router = track(createRouter({ routes }));
    attach(router);
    await router.start();

    const slow = router.navigate('/slow');
    await Promise.resolve();
    const fast = router.navigate('/fast');

    expect((await fast).status).toBe('completed');
    expect(firstSignal!.aborted).toBe(true);
    expect((firstSignal!.reason as DOMException).name).toBe('AbortError');

    // The slow answer arrives after the user has moved on, and is dropped
    // rather than painted over the page they are looking at.
    first.resolve({ name: 'too late' });
    expect((await slow).status).toBe('aborted');
    expect(host.textContent).toBe('list');
  });

  it('leaves the page where it was when a loader fails', async () => {
    const routes = defineRoutes([
      { path: '/', component: About },
      {
        path: '/users/:id',
        component: UserPage,
        loader: () => {
          throw new Error('no such user');
        },
      },
    ]);

    const router = track(createRouter({ routes }));
    attach(router);
    await router.start();
    const result = await router.navigate('/users/1');

    expect(result.status).toBe('failed');
    expect((result.error as Error).message).toBe('no such user');
    expect(router.error()).toBe(result.error);
    expect(host.textContent).toBe('about');
    expect(window.location.pathname).toBe('/');
    expect(router.status()).toBe('idle');
  });

  it('forgets the failure once a navigation succeeds', async () => {
    const routes = defineRoutes([
      { path: '/', component: About },
      { path: '/broken', component: UserPage, loader: () => Promise.reject(new Error('nope')) },
      { path: '/users', component: UserList },
    ]);

    const router = track(createRouter({ routes }));
    attach(router);
    await router.start();
    expect((await router.navigate('/broken')).status).toBe('failed');
    expect(router.error()).toBeInstanceOf(Error);

    // An error left behind after the application has moved on is one an error
    // banner keeps showing over a page that loaded perfectly well.
    await router.navigate('/users');
    expect(router.error()).toBeUndefined();
  });

  it('says routeData() was called from somewhere it cannot answer', () => {
    // Outside a construction there is no "this route" to read, and returning
    // undefined would look like a loader that returned nothing.
    expect(() => routeData()).toThrow(/route component/);
  });

  it('does not ask a surviving route again, and does when told to', async () => {
    let layoutLoads = 0;
    const routes = defineRoutes([
      {
        path: '/users',
        component: UsersLayout,
        loader: () => ++layoutLoads,
        children: [{ path: ':id', component: UserPage, loader: () => ({ name: 'Ada' }) }],
      },
    ]);

    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/users/1');
    attach(router);
    await router.start();
    expect(layoutLoads).toBe(1);

    await router.navigate('/users/2');
    expect(layoutLoads).toBe(1);

    await router.revalidate();
    expect(layoutLoads).toBe(2);
    expect(built.filter((name) => name === 'users')).toHaveLength(1);
  });

  it('asks again on a query change when shouldRevalidate says so', async () => {
    let loads = 0;
    const routes = defineRoutes([
      {
        path: '/users',
        component: UserPage,
        loader: () => ({ name: `page ${++loads}` }),
        shouldRevalidate: ({ from, to }) => from.search !== to.search,
      },
    ]);

    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/users');
    attach(router);
    await router.start();
    expect(host.textContent).toBe('page 1');

    await router.navigate('/users?sort=name');
    expect(loads).toBe(2);
    // Still the same instance — new data, no re-mount.
    expect(built.filter((name) => name === 'user')).toHaveLength(1);
    expect(host.textContent).toBe('page 2');

    await router.navigate('/users?sort=name');
    expect(loads).toBe(2);
  });
});

describe('parameters as signals', () => {
  const routes = defineRoutes([{ path: '/users/:id/:tab', component: UserPage }]);

  it('wakes only the reader of the parameter that changed', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/users/1/posts');
    attach(router);
    await router.start();

    let idRuns = 0;
    let tabRuns = 0;
    let dispose = () => {};
    createRoot((stop) => {
      dispose = stop;
      effect(() => {
        router.param('id');
        idRuns++;
      });
      effect(() => {
        router.param('tab');
        tabRuns++;
      });
    });
    flushSync();
    expect([idRuns, tabRuns]).toEqual([1, 1]);

    await router.navigate('/users/2/posts');
    flushSync();
    // `tab` did not change, so nothing reading it should have run again.
    expect([idRuns, tabRuns]).toEqual([2, 1]);

    await router.navigate('/users/2/settings');
    flushSync();
    expect([idRuns, tabRuns]).toEqual([2, 2]);

    dispose();
  });

  it('does the same for a query parameter', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/users/1/posts?page=1&sort=name');
    attach(router);
    await router.start();

    let sortRuns = 0;
    let dispose = () => {};
    createRoot((stop) => {
      dispose = stop;
      effect(() => {
        router.query('sort');
        sortRuns++;
      });
    });
    flushSync();
    expect(sortRuns).toBe(1);

    await router.navigate('/users/1/posts?page=2&sort=name');
    flushSync();
    expect(sortRuns).toBe(1);
    expect(router.query('page')).toBe('2');

    await router.navigate('/users/1/posts?page=2&sort=date');
    flushSync();
    expect(sortRuns).toBe(2);

    dispose();
  });

  it('reports the branch it matched', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/users/1/posts');
    attach(router);
    await router.start();

    expect(router.matches().map((match) => match.pattern)).toEqual(['/users/:id/:tab']);
    expect(router.params()).toEqual({ id: '1', tab: 'posts' });
    expect(router.pathname()).toBe('/users/1/posts');
  });
});

describe('history', () => {
  const routes = defineRoutes([
    { path: '/a', component: About },
    { path: '/b', component: UserList },
    { path: '/c', component: Doc },
  ]);

  it('restores the route and the scroll position on back and forward', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    window.scrollTo(0, 250);
    await router.navigate('/b');
    expect(host.textContent).toBe('list');
    // A new page starts at the top rather than wherever the last one was.
    expect(window.scrollY).toBe(0);

    window.scrollTo(0, 90);
    window.history.back();
    await vi.waitFor(() => expect(router.pathname()).toBe('/a'));
    expect(host.textContent).toBe('about');
    expect(window.scrollY).toBe(250);

    window.history.forward();
    await vi.waitFor(() => expect(router.pathname()).toBe('/b'));
    expect(host.textContent).toBe('list');
    expect(window.scrollY).toBe(90);
  });

  it('replaces an entry when asked, so Back skips it', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();
    await router.navigate('/b');

    const depth = window.history.length;
    await router.navigate('/c', { replace: true });
    expect(window.location.pathname).toBe('/c');
    // Nothing was added to the stack, and the entry took the position of the
    // one it replaced rather than a new one after it.
    expect(window.history.length).toBe(depth);
    expect(window.history.state).toMatchObject({ volt: 1, index: 1 });

    // '/b' is gone, so the one Back lands on the entry before it.
    window.history.back();
    await vi.waitFor(() => expect(router.pathname()).toBe('/a'));
    expect(host.textContent).toBe('about');
  });

  it('does not stack an entry for the URL it is already on', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();
    await router.navigate('/b');

    const depth = window.history.length;
    expect((await router.navigate('/b')).status).toBe('completed');
    expect(window.history.length).toBe(depth);

    // The entry behind is still '/a'. A second '/b' would have made the user's
    // next Back a visible no-op.
    window.history.back();
    await vi.waitFor(() => expect(router.pathname()).toBe('/a'));
  });

  it('gives a different query string an entry of its own', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();
    await router.navigate('/b');

    const depth = window.history.length;
    await router.navigate('/b?sort=name');
    // Same path, different page: sorting a list is somewhere the reader can
    // come back from.
    expect(window.history.length).toBe(depth + 1);

    window.history.back();
    await vi.waitFor(() => expect(router.search()).toBe(''));
    expect(router.pathname()).toBe('/b');
  });

  it('carries application state on the entry', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    await router.navigate('/b', { state: { from: 'a' } });
    expect(router.state()).toEqual({ from: 'a' });

    window.history.back();
    await vi.waitFor(() => expect(router.pathname()).toBe('/a'));
    expect(router.state()).toBeUndefined();
  });
});

describe('scroll', () => {
  const routes = defineRoutes([
    { path: '/a', component: About },
    { path: '/b', component: UserList },
    { path: '/c', component: Doc },
  ]);

  it('takes restoration off the browser while it is running', async () => {
    expect(window.history.scrollRestoration).toBe('auto');

    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();
    // The browser's guess is made against a document this application has
    // already replaced, so the router does the job instead.
    expect(window.history.scrollRestoration).toBe('manual');

    router.stop();
    expect(window.history.scrollRestoration).toBe('auto');
  });

  it('keeps the position the browser restored on the first render', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    window.scrollTo(0, 120);

    attach(router);

    await router.start();
    // A reload lands where the reader was. Only a navigation the application
    // performed goes back to the top.
    expect(window.scrollY).toBe(120);
  });

  it('scrolls to the element a hash names instead of to the top', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    const scrolled: string[] = [];
    const spy = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(function (this: Element) {
        scrolled.push(this.id);
      });
    window.scrollTo(0, 250);
    await router.navigate('/c#section');
    spy.mockRestore();

    expect(scrolled).toEqual(['section']);
    // The anchor decided where the page lands, so nothing jumped it to the top
    // first and then moved it again.
    expect(window.scrollY).toBe(250);
  });

  it('leaves the position alone when the navigation asks it to', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    window.scrollTo(0, 250);
    await router.navigate('/b', { preserveScroll: true });
    expect(host.textContent).toBe('list');
    expect(window.scrollY).toBe(250);
  });

  it('revalidates without moving the page', async () => {
    let loads = 0;
    const live = defineRoutes([{ path: '/a', component: UserPage, loader: () => ({ name: `v${++loads}` }) }]);
    const router = track(createRouter({ routes: live }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    window.scrollTo(0, 250);
    await router.revalidate();
    expect(host.textContent).toBe('v2');
    // Refetching in place is not a navigation: the reader is still looking at
    // the row they scrolled to.
    expect(window.scrollY).toBe(250);
  });

  it('hands scrolling back to the browser when it is turned off', async () => {
    const router = track(createRouter({ routes, scroll: false }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    // Nothing is taken over, so the browser's own restoration stays on.
    expect(window.history.scrollRestoration).toBe('auto');

    window.scrollTo(0, 250);
    await router.navigate('/b');
    expect(host.textContent).toBe('list');
    expect(window.scrollY).toBe(250);

    window.scrollTo(0, 90);
    window.history.back();
    await vi.waitFor(() => expect(router.pathname()).toBe('/a'));
    expect(window.scrollY).toBe(90);
  });
});

describe('blocking', () => {
  const routes = defineRoutes([
    { path: '/a', component: About },
    { path: '/b', component: UserList },
    { path: '/c', component: Doc },
  ]);

  it('stops a navigation and leaves the URL alone', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    const unblock = router.block(() => true);
    const result = await router.navigate('/b');

    expect(result.status).toBe('blocked');
    expect(window.location.pathname).toBe('/a');
    expect(host.textContent).toBe('about');

    unblock();
    expect((await router.navigate('/b')).status).toBe('completed');
    expect(host.textContent).toBe('list');
  });

  it('sees where the navigation was going', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    const seen: string[] = [];
    router.block(({ from, to, mode }) => {
      seen.push(`${mode} ${from.pathname} -> ${to.pathname}`);
      return false;
    });

    await router.navigate('/b?x=1#y');
    expect(seen).toEqual(['push /a -> /b']);
  });

  it('waits for an asynchronous answer', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    const gate = deferred<boolean>();
    router.block(() => gate.promise);

    const navigation = router.navigate('/b');
    await Promise.resolve();
    expect(window.location.pathname).toBe('/a');

    gate.resolve(false);
    expect((await navigation).status).toBe('completed');
    expect(window.location.pathname).toBe('/b');
  });

  it('clears the loading state it interrupted, and aborts its loader', async () => {
    const gate = deferred<unknown>();
    let interrupted: AbortSignal | null = null;
    const slowRoutes = defineRoutes([
      { path: '/a', component: About },
      {
        path: '/slow',
        component: UserList,
        loader: ({ signal }) => {
          interrupted = signal;
          return gate.promise;
        },
      },
      { path: '/c', component: UserList },
    ]);

    const router = track(createRouter({ routes: slowRoutes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    const slow = router.navigate('/slow');
    await Promise.resolve();
    expect(router.status()).toBe('loading');

    router.block(() => true);
    expect((await router.navigate('/c')).status).toBe('blocked');

    // The interrupted navigation will never finish, so nothing is left to
    // clear the spinner it put up.
    expect(router.status()).toBe('idle');

    // And nothing is left to abort its request either. A loader whose answer
    // is already unwanted is the commonest wasted fetch in a router, and the
    // signal is the only way it can be told.
    expect(interrupted!.aborted).toBe(true);
    expect((interrupted!.reason as DOMException).name).toBe('AbortError');

    gate.resolve(null);
    expect((await slow).status).toBe('aborted');
  });

  it('does not abort the loaders of the page already on screen', async () => {
    let arrived: AbortSignal | null = null;
    const loaded = defineRoutes([
      { path: '/a', component: About },
      {
        path: '/b',
        component: UserPage,
        loader: ({ signal }) => {
          arrived = signal;
          return { name: 'Ada' };
        },
      },
    ]);

    const router = track(createRouter({ routes: loaded }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();
    await router.navigate('/b');

    router.block(() => true);
    expect((await router.navigate('/a')).status).toBe('blocked');

    // Nothing was superseded: this page finished loading before the refused
    // navigation was even asked for, and a route that kept its signal to tear
    // something down would have torn it down under a reader still reading.
    expect(arrived!.aborted).toBe(false);
  });

  it('asks the blockers that were there when the navigation started', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    const asked: string[] = [];
    const unblockFirst = router.block(() => {
      asked.push('first');
      // The ordinary shape of a blocker: it answers once, takes itself out,
      // and leaves the blocker for the next question behind it.
      unblockFirst();
      router.block(() => {
        asked.push('second');
        return true;
      });
      return false;
    });

    expect((await router.navigate('/b')).status).toBe('completed');
    // The replacement was registered mid-answer, so this transition — which
    // was already being decided — is not the one it gets a vote on.
    expect(asked).toEqual(['first']);

    expect((await router.navigate('/a')).status).toBe('blocked');
    expect(asked).toEqual(['first', 'second']);
  });

  it('asks before the tab closes, and stops asking once it is stopped', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    const seen: Transition[] = [];
    router.block((transition) => {
      seen.push(transition);
      return true;
    });

    const closing = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(closing);

    // Preventing the default is the entire vocabulary the platform offers for
    // "ask before you leave" — the browser writes the dialog itself.
    expect(closing.defaultPrevented).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.mode).toBe('unload');
    expect(seen[0]!.to.pathname).toBe('/a');

    router.stop();
    const later = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
    expect(seen).toHaveLength(1);
  });

  it('lets the tab close when no blocker refuses on the spot', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    router.block(() => false);
    // The browser decides whether to prompt the moment the handler returns, so
    // a promise that resolves to true afterwards has nothing left to stop —
    // and treating the promise itself as a refusal would prompt on every
    // close, which is how a warning stops meaning anything.
    router.block(() => Promise.resolve(true));

    const closing = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(closing);
    expect(closing.defaultPrevented).toBe(false);
  });

  it('corrects the URL when it refuses a Back onto an entry it did not write', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    // A third-party script pushing its own state is the ordinary way an entry
    // with no bookkeeping of ours ends up in the middle of the stack. The
    // router then moves on again, so that the entry the Back lands on and the
    // page on screen name different URLs — going back to '/a' instead would
    // put the address bar where it already was and prove nothing.
    window.history.pushState({ theirs: true }, '', '/b');
    await router.navigate('/c');

    let asked = 0;
    router.block(() => {
      asked++;
      return true;
    });
    window.history.back();
    await vi.waitFor(() => expect(asked).toBe(1));

    // Their entry carries no index, so there is no distance to travel back by
    // — and a refusal that leaves the address bar naming a page which is not
    // on screen is the failure blocking exists to prevent.
    await vi.waitFor(() => expect(window.location.pathname).toBe('/c'));
    expect(router.pathname()).toBe('/c');
    expect(host.querySelector('.doc')).not.toBeNull();
  });

  it('does not ask a second time about the Back it just refused', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();
    await router.navigate('/b');

    let asked = 0;
    router.block(() => {
      asked++;
      return true;
    });

    window.history.back();
    await vi.waitFor(() => expect(window.location.pathname).toBe('/b'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Undoing the Back travels the history itself, which fires a `popstate` of
    // its own. Treating that one as a navigation would put the dialog up a
    // second time for a question the user has already answered.
    expect(asked).toBe(1);
    expect(router.pathname()).toBe('/b');
  });

  it('puts the URL back when it refuses a Back, without rewriting the stack', async () => {
    const router = track(createRouter({ routes }));
    // A known entry behind the two this drives, because that is the only way
    // to tell "travelled back by the distance the pop covered" from "stamped
    // this URL onto the entry it landed on": both leave the address bar
    // reading '/b', and only the second spends '/a' to do it.
    window.history.replaceState(null, '', '/before');
    window.history.pushState(null, '', '/a');
    attach(router);
    await router.start();
    await router.navigate('/b');

    const unblock = router.block(() => true);
    window.history.back();

    // The URL moves before `popstate` fires, so refusing means moving it back.
    await vi.waitFor(() => expect(window.location.pathname).toBe('/b'));
    expect(router.pathname()).toBe('/b');
    expect(host.textContent).toBe('list');

    // Travelling back by the distance the pop covered leaves every entry where
    // it was. Stamping this URL onto the entry the user landed on would have
    // spent '/a' to do it, and their next Back would then go nowhere.
    unblock();
    window.history.back();
    await vi.waitFor(() => expect(router.pathname()).toBe('/a'));
    expect(host.textContent).toBe('about');
  });
});

describe('preloading', () => {
  it('fetches a route’s chunk without navigating', async () => {
    let loads = 0;
    const routes = defineRoutes([
      { path: '/a', component: About },
      {
        path: '/b',
        component: async () => {
          loads++;
          return { default: UserList };
        },
      },
    ]);

    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    await router.preload('/b');
    expect(loads).toBe(1);
    expect(window.location.pathname).toBe('/a');
    expect(host.textContent).toBe('about');

    await router.navigate('/b');
    // The chunk was already there, so navigating did not fetch it again.
    expect(loads).toBe(1);
    expect(host.textContent).toBe('list');
  });

  it('does not run the route’s loader', async () => {
    let loads = 0;
    const routes = defineRoutes([
      { path: '/a', component: About },
      { path: '/b', component: UserList, loader: () => ++loads },
    ]);

    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    await router.preload('/b');
    // A pointer crossing a link asked for nothing. The loader behind it can be
    // a mutation-shaped POST or an expensive query, and running it here would
    // be a side effect the user never requested.
    expect(loads).toBe(0);

    await router.navigate('/b');
    expect(loads).toBe(1);
  });
});

describe('href', () => {
  const routes = defineRoutes([
    { path: '/users/:id', component: UserPage },
    { path: '/files/*path', component: About },
  ]);

  it('builds a URL from a pattern and its parameters', () => {
    const router = track(createRouter({ routes }));
    expect(router.href('/users/:id', { id: 7 })).toBe('/users/7');
    expect(router.href('/users/:id', { id: 7 }, { search: { tab: 'posts' } })).toBe(
      '/users/7?tab=posts',
    );
    expect(router.href('/users/:id', { id: 7 }, { search: 'tab=posts', hash: 'top' })).toBe(
      '/users/7?tab=posts#top',
    );
    expect(router.href('/files/*path', { path: 'a/b.txt' })).toBe('/files/a/b.txt');
  });
});

describe('lifecycle', () => {
  const routes = defineRoutes([{ path: '/a', component: About }]);

  it('empties every outlet and stops listening', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();
    expect(host.textContent).toBe('about');

    router.stop();
    // The branch is gone and the application is not: what the router filled
    // was an outlet, and the page around it belongs to whoever mounted it.
    expect(host.textContent).toBe('');
    expect(host.querySelector('.app')).not.toBeNull();

    // The listeners are gone, so a history move is nobody's business now.
    window.history.pushState(null, '', '/a?x=1');
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(host.textContent).toBe('');
  });

  it('refuses a URL the route table does not describe', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();

    const result = await router.navigate('/nowhere');

    // Going ahead would empty the page and change the address bar to name it,
    // which helps nobody. A table that wants a not-found page declares one
    // with a `'*'` route, and that matches this like any other URL.
    expect(result.status).toBe('failed');
    expect((result.error as Error).message).toMatch(/No route matches/);
    expect(router.error()).toBe(result.error);
    expect(window.location.pathname).toBe('/a');
    expect(host.textContent).toBe('about');
  });

  it('says so when asked to navigate before it has started', () => {
    const router = track(createRouter({ routes }));
    expect(() => router.navigate('/a')).toThrow(/before start/);
  });

  it('resolves without a browser, and starts without resolving again', async () => {
    let loads = 0;
    const counted = defineRoutes([
      { path: '/a', component: UserPage, loader: () => ({ name: `load ${++loads}` }) },
      { path: '/b', component: About },
    ]);
    const router = track(createRouter({ routes: counted }));
    window.history.replaceState(null, '', '/a');

    // The order a server-rendered page boots in: resolve, then attach to what
    // was rendered from it, then take over the browser. Starting would
    // otherwise run every loader a second time for the page already on screen.
    await router.resolve('/a');
    attach(router);
    expect(host.textContent).toBe('load 1');

    await router.start({ resolve: false });
    expect(loads).toBe(1);
    expect(host.textContent).toBe('load 1');

    // Started all the same: the entry is stamped and the router navigates.
    expect(window.history.state).toMatchObject({ volt: 1 });
    await router.navigate('/b');
    expect(host.textContent).toBe('about');
    expect(loads).toBe(1);
  });

  it('refuses to start twice', async () => {
    const router = track(createRouter({ routes }));
    window.history.replaceState(null, '', '/a');
    attach(router);
    await router.start();
    await expect(router.start()).rejects.toThrow(/already started/);
  });
});

describe('view transitions', () => {
  const routes = defineRoutes([
    {
      path: '/',
      component: Root,
      children: [{ path: 'users', component: UsersLayout }],
    },
  ]);

  interface Started {
    calls: (() => void)[];
    restore: () => void;
  }

  /**
   * Stand in for the platform API, which happy-dom does not implement.
   *
   * The callback is run immediately, as a real engine does — the snapshot it
   * takes around it is the part that cannot be observed here, and is not what
   * this is about. What is worth asserting is *whether* the navigation went
   * through it, and that the page ends up right either way.
   */
  function stubTransitions(): Started {
    const calls: (() => void)[] = [];
    const doc = document as unknown as Record<string, unknown>;
    const had = 'startViewTransition' in doc;
    const before = doc.startViewTransition;
    doc.startViewTransition = (callback: () => void) => {
      calls.push(callback);
      callback();
      return { updateCallbackDone: Promise.resolve() };
    };
    return {
      calls,
      restore: () => {
        if (had) doc.startViewTransition = before;
        else delete doc.startViewTransition;
      },
    };
  }

  function stubReducedMotion(reduce: boolean): () => void {
    const before = window.matchMedia;
    (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
addEventListener: () => {},
      removeEventListener: () => {},
    });
    return () => {
      (window as unknown as Record<string, unknown>).matchMedia = before;
    };
  }

  it('is off unless the application asks for it', async () => {
    const stub = stubTransitions();
    try {
      const router = track(createRouter({ routes }));
      attach(router);
      await router.start();
      await router.navigate('/users');

      expect(stub.calls).toHaveLength(0);
      expect(router.pathname()).toBe('/users');
    } finally {
      stub.restore();
    }
  });

  it('runs the whole swap inside one transition when it is asked for', async () => {
    const stub = stubTransitions();
    try {
      const router = track(createRouter({ routes, viewTransition: true }));
      attach(router);
      await router.start();
      await router.navigate('/users');

      // One for the navigation. `start` itself is an initial commit and must
      // not animate: there is no previous page to animate away from.
      expect(stub.calls).toHaveLength(1);
      expect(router.pathname()).toBe('/users');
      expect(built).toContain('users');
    } finally {
      stub.restore();
    }
  });

  it('navigates anyway on an engine that has no such API', async () => {
    const doc = document as unknown as Record<string, unknown>;
    delete doc.startViewTransition;
    const router = track(createRouter({ routes, viewTransition: true }));
    attach(router);
    await router.start();
    await router.navigate('/users');

    expect(router.pathname()).toBe('/users');
    expect(built).toContain('users');
  });

  it('respects a reader who asked for less motion', async () => {
    const stub = stubTransitions();
    const restoreMedia = stubReducedMotion(true);
    try {
      const router = track(createRouter({ routes, viewTransition: true }));
      attach(router);
      await router.start();
      await router.navigate('/users');

      expect(stub.calls).toHaveLength(0);
      expect(router.pathname()).toBe('/users');
    } finally {
      restoreMedia();
      stub.restore();
    }
  });

  it('does not start a second while one is running, since the platform serializes them', async () => {
    // The hazard the roadmap names: a transition is document-scoped, so a
    // route change arriving during one would queue behind an animation the
    // reader has already navigated away from.
    const calls: (() => void)[] = [];
    const doc = document as unknown as Record<string, unknown>;
    const before = doc.startViewTransition;
    let inner: Promise<unknown> | null = null;
    let router!: Router<string>;

    doc.startViewTransition = (callback: () => void) => {
      calls.push(callback);
      // Navigate again from *inside* the callback, which is exactly the
      // overlap the platform cannot serve.
      if (inner === null) inner = router.navigate('/');
      callback();
      return { updateCallbackDone: Promise.resolve() };
    };

    try {
      router = track(createRouter({ routes, viewTransition: true }));
      attach(router);
      await router.start();
      await router.navigate('/users');
      await inner;

      expect(calls).toHaveLength(1);
    } finally {
      if (before === undefined) delete doc.startViewTransition;
      else doc.startViewTransition = before;
    }
  });
});
