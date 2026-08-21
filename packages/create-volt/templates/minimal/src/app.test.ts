import { afterEach, expect, it } from 'vitest';
import { flushSync, mount, type MountHandle } from '@voltdev/core';
import { App } from './app.js';

let app: MountHandle | null = null;

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = '';
});

/** Mounted into the document, because Volt delegates events to it. */
function render(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  app = mount(App, host);
  return host;
}

it('counts up', () => {
  const host = render();

  host.querySelector<HTMLButtonElement>('[aria-label="Add one"]')?.click();
  // Effects are batched onto a microtask, so this is where a test says "and
  // then the DOM caught up".
  flushSync();

  expect(host.querySelector('output')?.textContent).toBe('1');
  expect(host.querySelector('.derived')?.textContent).toContain('Twice that is 2');
});

it('has nothing to reset until something has been counted', () => {
  const host = render();
  expect(host.querySelector('.reset')).toBeNull();

  host.querySelector<HTMLButtonElement>('[aria-label="Add one"]')?.click();
  flushSync();

  host.querySelector<HTMLButtonElement>('.reset')?.click();
  flushSync();

  expect(host.querySelector('output')?.textContent).toBe('0');
});
