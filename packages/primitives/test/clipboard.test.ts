/**
 * Copying, and the three things around it that fail quietly.
 *
 * The write itself is one call and not worth a test. What is worth one is the
 * behaviour a consumer would otherwise have to rediscover: that the copied
 * state ends, that the change is said out loud rather than left to a button
 * label nobody hears, that a page over plain HTTP still copies, and that a
 * refusal is reported instead of shown as success.
 */
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build as viteBuild } from 'vite';
import { compileTemplate } from '@voltdev/core/jit';
import { defineComponent, flushSync, mount } from '@voltdev/core';
import { createRoot } from '@voltdev/reactivity';
import { createClipboard, type Clipboard } from '../src/clipboard.js';
import { resetAnnouncer } from '../src/announcer.js';
import { createLocaleProvider } from '../src/i18n.js';

function spoken(priority = 'polite'): string {
  const region = document.querySelector(`[data-volt-announcer='${priority}']`);
  return (region?.textContent ?? '').trim();
}

/** Built in a root, because the reset timer is released on cleanup. */
function build(options: Parameters<typeof createClipboard>[0]): {
  clip: Clipboard;
  dispose: () => void;
} {
  let clip!: Clipboard;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    clip = createClipboard(options);
  });
  return { clip, dispose };
}

let written: string[];

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  written = [];
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    },
  });
});

afterEach(() => {
  resetAnnouncer();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a copy that worked', () => {
  it('puts the text on the clipboard, read at the moment of the copy', async () => {
    let value = 'first';
    const { clip, dispose } = build({ text: () => value });

    await clip.copy();
    value = 'second';
    await clip.copy();

    expect(written).toEqual(['first', 'second']);
    dispose();
  });

  it('says so through the region rather than by relabelling the button', async () => {
    const { clip, dispose } = build({ text: () => 'x' });
    await clip.copy();
    await vi.advanceTimersByTimeAsync(50);

    expect(spoken()).toBe('Copied');
    dispose();
  });

  it('holds the copied state, then lets it go', async () => {
    const { clip, dispose } = build({ text: () => 'x' });
    expect(clip.status()).toBe('idle');

    await clip.copy();
    expect(clip.isCopied()).toBe(true);
    expect(clip.triggerProps()['data-state']).toBe('copied');

    await vi.advanceTimersByTimeAsync(2000);
    expect(clip.status()).toBe('idle');
    expect(clip.isCopied()).toBe(false);
    dispose();
  });

  it('starts the window again rather than ending it early on a second copy', async () => {
    const { clip, dispose } = build({ text: () => 'x' });
    await clip.copy();
    await vi.advanceTimersByTimeAsync(1500);
    await clip.copy();

    await vi.advanceTimersByTimeAsync(1000);
    expect(clip.isCopied()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(clip.status()).toBe('idle');
    dispose();
  });

  it('does not leave a timer running after the button is gone', async () => {
    const { clip, dispose } = build({ text: () => 'x' });
    await clip.copy();
    dispose();
    // Nothing to assert but the absence of a crash: the timer would otherwise
    // write to a signal in a scope that has been torn down.
    await vi.advanceTimersByTimeAsync(5000);
    expect(clip.status()).toBe('copied');
  });
});

describe('a page the clipboard API is not on', () => {
  it('still copies, through the older path', async () => {
    vi.stubGlobal('navigator', {});
    const carriers: string[] = [];
    const execCommand = vi.fn(() => {
      const carrier = document.querySelector('textarea');
      if (carrier) carriers.push((carrier as HTMLTextAreaElement).value);
      return true;
    });
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    const { clip, dispose } = build({ text: () => 'over http' });
    expect(await clip.copy()).toBe(true);

    expect(carriers).toEqual(['over http']);
    expect(clip.isCopied()).toBe(true);
    dispose();
  });

  it('takes the carrier back out and gives focus back to where it was', async () => {
    vi.stubGlobal('navigator', {});
    Object.defineProperty(document, 'execCommand', { value: () => true, configurable: true });

    const button = document.createElement('button');
    document.body.append(button);
    button.focus();

    const { clip, dispose } = build({ text: () => 'x' });
    await clip.copy();

    expect(document.querySelector('textarea')).toBe(null);
    expect(document.activeElement).toBe(button);
    dispose();
  });
});

describe('a copy that did not work', () => {
  it('reports the refusal instead of showing it as success', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('not allowed')) },
    });
    const errors: unknown[] = [];
    const { clip, dispose } = build({ text: () => 'x', onError: (e) => errors.push(e) });

    expect(await clip.copy()).toBe(false);
    expect(clip.status()).toBe('failed');
    expect(clip.isCopied()).toBe(false);
    expect(errors).toHaveLength(1);
    dispose();
  });

  it('interrupts to say so, because carrying on would waste the attempt', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('no')) },
    });
    const { clip, dispose } = build({ text: () => 'x' });
    await clip.copy();
    await vi.advanceTimersByTimeAsync(50);

    expect(spoken('assertive')).toBe('Could not copy');
    expect(spoken('polite')).toBe('');
    dispose();
  });
});

describe('the trigger, spread onto a button', () => {
  // `triggerProps()` builds its `onclick` each time it is read, and the spread
  // reads it again every time the status changes — twice a copy. Each of those
  // stayed attached, so the third press copied five times. This goes through a
  // real template so that it is `:spread` doing the attaching, which is where
  // the fault was.
  it('copies once a press, however many times the status has changed', async () => {
    class CopyButton {
      clip = createClipboard({ text: () => 'req_8f2c' });
    }
    defineComponent(CopyButton, {
      selector: 'v-copy-button',
      render: compileTemplate(`<button :spread="clip.triggerProps()">Copy</button>`),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const handle = mount(CopyButton, host);
    const button = host.querySelector('button')!;

    for (let press = 1; press <= 3; press++) {
      button.click();
      await vi.advanceTimersByTimeAsync(0);
      flushSync();
      expect(written, `after press ${press}`).toHaveLength(press);
      // Back to idle, so the next press starts from a rebuilt bag.
      await vi.advanceTimersByTimeAsync(2000);
      flushSync();
    }
    handle.unmount();
  });
});

describe('what it says, in the application’s language', () => {
  /**
   * The announcement is the whole of what a screen-reader user is told about a
   * copy, so an English sentence in a German page is the one part of the
   * interaction that does not arrive.
   */
  function german(options: Parameters<typeof createClipboard>[0]): {
    clip: Clipboard;
    dispose: () => void;
  } {
    let clip!: Clipboard;
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      createLocaleProvider({
        defaultLocale: 'de-DE',
        messages: { copied: 'Kopiert', copyFailed: 'Kopieren fehlgeschlagen' },
      });
      clip = createClipboard(options);
    });
    return { clip, dispose };
  }

  it('announces a copy in the locale’s words', async () => {
    const { clip, dispose } = german({ text: () => 'x' });
    await clip.copy();
    await vi.advanceTimersByTimeAsync(50);

    expect(spoken()).toBe('Kopiert');
    dispose();
  });

  it('announces a refusal in the locale’s words', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('no')) },
    });
    const { clip, dispose } = german({ text: () => 'x' });
    await clip.copy();
    await vi.advanceTimersByTimeAsync(50);

    expect(spoken('assertive')).toBe('Kopieren fehlgeschlagen');
    dispose();
  });

  it('still prefers a label given outright, which is about this button', async () => {
    const { clip, dispose } = german({ text: () => 'x', labels: { copied: 'Link kopiert' } });
    await clip.copy();
    await vi.advanceTimersByTimeAsync(50);

    expect(spoken()).toBe('Link kopiert');
    dispose();
  });
});

describe('what a copy button costs an application that does not translate', () => {
  beforeEach(() => vi.useRealTimers());

  it('leaves the locale out of the bundle, with no provider for it to ask', async () => {
    // Neither sentence is a default, so a locale built without a provider
    // could only say the English the module already holds. Building one
    // anyway put the whole locale into every bundle with a copy button in it.
    const result = await viteBuild({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        target: 'esnext',
        minify: false,
        rollupOptions: { external: [/^@voltdev\//] },
        lib: { entry: resolve(import.meta.dirname, '../src/clipboard.ts'), formats: ['es'] },
      },
    });
    const [bundle] = Array.isArray(result) ? result : [result];
    const code = bundle && 'output' in bundle ? bundle.output[0].code : '';

    expect(code).toMatch(/function createClipboard\b/);
    expect(code).not.toMatch(/function createLocale\b/);
  });
});
