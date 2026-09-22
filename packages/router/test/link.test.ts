/**
 * Anchors, and the clicks the router must not take.
 *
 * Every case in the first half is a click where the user asked the browser for
 * something a same-document navigation cannot do — a new tab, a new window, a
 * download, another origin. Intercepting any of them replaces what they asked
 * for with a page swap in the tab they were already using, and a Cmd-click
 * that behaves that way loses whatever was on screen.
 *
 * The second half drives the same decisions through a started router, because
 * the delegated listener is where they are actually consulted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, flushSync, mount, provideOutlet, type MountHandle } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { provideRouter } from '../src/context.js';
import { findAnchor, isRoutableAnchor, shouldInterceptClick } from '../src/link.js';
import { createRouter, type Router } from '../src/router.js';
import { defineRoutes } from '../src/routes.js';

let host: HTMLElement;
let routers: Router<string>[] = [];
let mounted: MountHandle[] = [];

function track<T extends Router<never>>(router: T): T {
  routers.push(router as unknown as Router<string>);
  return router;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  mounted = [];
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  for (const router of routers) router.stop();
  routers = [];
  flushSync();
});

/** An anchor in the document, described by its attributes. */
function anchor(attributes: Record<string, string>): HTMLAnchorElement {
  const element = document.createElement('a');
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  host.append(element);
  return element;
}

function click(element: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  element.dispatchEvent(event);
  return event;
}

// ---------------------------------------------------------------------------

describe('deciding', () => {
  it('takes a plain left click on a same-origin link', () => {
    const link = anchor({ href: '/users/1' });
    expect(shouldInterceptClick(click(link), link)).toBe(true);
  });

  it('leaves a modified click alone', () => {
    const link = anchor({ href: '/users/1' });
    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
      expect(shouldInterceptClick(click(link, { [modifier]: true }), link)).toBe(false);
    }
  });

  it('leaves anything but the primary button alone', () => {
    const link = anchor({ href: '/users/1' });
    expect(shouldInterceptClick(click(link, { button: 1 }), link)).toBe(false);
    expect(shouldInterceptClick(click(link, { button: 2 }), link)).toBe(false);
  });

  it('leaves a click something else already handled alone', () => {
    const link = anchor({ href: '/users/1' });
    const event = click(link);
    event.preventDefault();
    expect(shouldInterceptClick(event, link)).toBe(false);
  });

  it('leaves a link that opens elsewhere alone', () => {
    const blank = anchor({ href: '/users/1', target: '_blank' });
    expect(isRoutableAnchor(blank)).toBe(false);
    const named = anchor({ href: '/users/1', target: 'preview' });
    expect(isRoutableAnchor(named)).toBe(false);
    const self = anchor({ href: '/users/1', target: '_self' });
    expect(isRoutableAnchor(self)).toBe(true);
  });

  it('leaves a download alone', () => {
    expect(isRoutableAnchor(anchor({ href: '/report.csv', download: '' }))).toBe(false);
  });

  it('leaves another origin and another scheme alone', () => {
    expect(isRoutableAnchor(anchor({ href: 'https://example.test/x' }))).toBe(false);
    expect(isRoutableAnchor(anchor({ href: 'mailto:someone@example.test' }))).toBe(false);
    expect(isRoutableAnchor(anchor({ href: 'tel:+441234567890' }))).toBe(false);
  });

  it('honours rel="external" and the opt-out attribute', () => {
    expect(isRoutableAnchor(anchor({ href: '/docs', rel: 'noopener external' }))).toBe(false);
    expect(isRoutableAnchor(anchor({ href: '/docs', 'data-volt-no-router': '' }))).toBe(false);
  });

  it('is not a link at all without an href', () => {
    expect(isRoutableAnchor(anchor({}))).toBe(false);
  });

  it('finds the anchor a click landed inside', () => {
    const link = anchor({ href: '/users/1' });
    const span = document.createElement('span');
    link.append(span);
    let found: HTMLAnchorElement | null = null;
    document.addEventListener('click', (event) => (found = findAnchor(event)), { once: true });
    click(span);
    expect(found).toBe(link);
  });

  it('finds nothing for a click outside one', () => {
    const button = document.createElement('button');
    host.append(button);
    let found: HTMLAnchorElement | null = null;
    document.addEventListener('click', (event) => (found = findAnchor(event)), { once: true });
    click(button);
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------

@Component({
  selector: 'v-page',
  render: compileTemplate(
    `<div class="page"><span>{ title }</span><h2 id="section">section</h2></div>`,
  ),
})
class Page {
  title = 'page';
}

@Component({ selector: 'v-other', render: compileTemplate(`<div class="other">other</div>`) })
class Other {}

/** The application's own root; the router fills the outlet in it. */
@Component({ selector: 'v-link-app', render: compileTemplate(`<div :outlet></div>`) })
class App {}

describe('through a started router', () => {
  const routes = defineRoutes([
    { path: '/', component: Page },
    { path: '/other', component: Other },
  ]);

  const start = async () => {
    const router = track(createRouter({ routes, preloadOnHover: false }));
    mounted.push(
      mount(App, host, {
        setup: () => {
          provideRouter(router);
          provideOutlet(router.outletAt(0));
        },
      }),
    );
    await router.start();
    return router;
  };

  it('navigates on a plain click, without reloading', async () => {
    const router = await start();
    const link = anchor({ href: '/other' });

    const event = click(link);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(router.pathname()).toBe('/other'));
    expect(host.querySelector('.other')).not.toBeNull();
  });

  it('does not stack an entry for a link to the page you are on', async () => {
    const router = await start();
    await router.navigate('/other');
    const link = anchor({ href: '/other' });

    const depth = window.history.length;
    expect(click(link).defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(window.history.length).toBe(depth);
    expect(router.pathname()).toBe('/other');

    // Back leaves the page, rather than landing on a second copy of it and
    // looking like a Back that did nothing.
    window.history.back();
    await vi.waitFor(() => expect(router.pathname()).toBe('/'));
  });

  it('does not touch a middle-click or a Cmd-click', async () => {
    const router = await start();
    const link = anchor({ href: '/other' });

    // The browser is left to open its new tab. Nothing is prevented, and the
    // router neither navigates nor re-renders.
    expect(click(link, { button: 1 }).defaultPrevented).toBe(false);
    expect(click(link, { metaKey: true }).defaultPrevented).toBe(false);
    expect(click(link, { ctrlKey: true }).defaultPrevented).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(router.pathname()).toBe('/');
    expect(host.querySelector('.other')).toBeNull();
    expect(host.querySelector('.page')).not.toBeNull();
  });

  it('leaves a same-origin URL the route table does not describe to the server', async () => {
    const router = await start();
    const link = anchor({ href: '/api/export.csv' });

    expect(click(link).defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(router.pathname()).toBe('/');
  });

  it('handles a fragment link itself, so the location signals stay true', async () => {
    // A known entry behind this page, so that Back can tell an entry of the
    // fragment's own from one that replaced the page it was on.
    window.history.replaceState(null, '', '/other');
    window.history.pushState(null, '', '/');
    const router = await start();
    const link = anchor({ href: '#section' });

    expect(click(link).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(router.hash()).toBe('#section'));
    expect(router.pathname()).toBe('/');
    // The route did not change, so nothing was re-mounted underneath it.
    expect(host.querySelector('.page')).not.toBeNull();

    // A fragment is a place of its own, so it gets its own entry and Back
    // returns to the top of the page rather than leaving it.
    window.history.back();
    await vi.waitFor(() => expect(router.hash()).toBe(''));
    expect(router.pathname()).toBe('/');
  });

  it('preloads a route’s chunk when the pointer reaches its link', async () => {
    let loads = 0;
    const lazy = defineRoutes([
      { path: '/', component: Page },
      {
        path: '/other',
        component: async () => {
          loads++;
          return { default: Other };
        },
      },
    ]);

    const router = track(createRouter({ routes: lazy }));
    mounted.push(
      mount(App, host, {
        setup: () => {
          provideRouter(router);
          provideOutlet(router.outletAt(0));
        },
      }),
    );
    await router.start();
    const link = anchor({ href: '/other' });

    link.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    await vi.waitFor(() => expect(loads).toBe(1));
    expect(router.pathname()).toBe('/');

    // Hovering again does not fetch again, and neither does going there.
    link.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    await router.navigate('/other');
    expect(loads).toBe(1);
  });
});
