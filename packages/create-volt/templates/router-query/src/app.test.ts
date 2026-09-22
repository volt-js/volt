import { afterEach, expect, it } from 'vitest';
import { flushSync, mount, provideOutlet, type MountHandle } from '@voltdev/core';
import { provideRouter } from '@voltdev/router';
import { router } from './router.js';
import { Shell } from './shell.js';

let host: HTMLElement | null = null;
let app: MountHandle | null = null;

afterEach(() => {
  app?.unmount();
  app = null;
  router.stop();
  host?.remove();
  host = null;
  document.body.innerHTML = '';
});

/** Mounted into the document, because Volt delegates events to it. */
async function start(path: string): Promise<HTMLElement> {
  window.history.replaceState(null, '', path);
  host = document.createElement('div');
  document.body.append(host);
  app = mount(Shell, host, {
    setup: () => {
      provideRouter(router);
      provideOutlet(router.outletAt(0));
    },
  });
  await router.start();
  return host;
}

/**
 * Wait for the DOM to say something, rather than for a fixed delay.
 *
 * The fetchers are asynchronous, so a test that asserted straight after a
 * navigation would be asserting on the loading state — and one that slept for
 * a round number would pass or fail by machine speed.
 */
async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    flushSync();
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the DOM');
}

it('renders the route the URL names', async () => {
  const app = await start('/');

  expect(app.querySelector('.home')).not.toBeNull();
  expect(app.querySelector('nav a[aria-current="page"]')?.textContent).toBe('Home');
});

it('loads the list, then a user, keeping the layout mounted', async () => {
  const app = await start('/users');
  const header = app.querySelector('header');

  await until(() => app.querySelectorAll('.users li').length > 0);
  expect(app.querySelectorAll('.users li')).toHaveLength(3);

  await router.navigate('/users/2');
  await until(() => app.querySelector('.user h2') !== null);
  expect(app.querySelector('.user h2')?.textContent).toBe('Grace Hopper');

  // The layout is the same element it was: a sibling navigation re-rendered
  // the outlet and nothing above it.
  expect(app.querySelector('header')).toBe(header);
});

it('answers a second visit from the cache', async () => {
  const app = await start('/users');
  await until(() => app.querySelectorAll('.users li').length > 0);

  await router.navigate('/users/1');
  await until(() => app.querySelector('.user h2') !== null);

  await router.navigate('/users');
  flushSync();

  // No loading state on the way back: the entry is still in the cache, so the
  // rows are there in the same tick the route mounted.
  expect(app.querySelector('.users [role="status"]')).toBeNull();
  expect(app.querySelectorAll('.users li')).toHaveLength(3);
});
