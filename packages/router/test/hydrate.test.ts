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
  createRoot,
  flushSync,
  hydrate,
  provideOutlet,
  type RenderFn,
} from '@voltdev/core';
import * as runtime from '@voltdev/core/runtime';
import * as server from '@voltdev/core/server';
import { renderToStaticMarkup } from '@voltdev/core/server';
import { provideRouter } from '../src/context.js';
import { createRouter, routeData } from '../src/router.js';
import { defineRoutes } from '../src/routes.js';

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
