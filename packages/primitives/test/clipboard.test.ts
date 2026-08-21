/**
 * Copying, and the three things around it that fail quietly.
 *
 * The write itself is one call and not worth a test. What is worth one is the
 * behaviour a consumer would otherwise have to rediscover: that the copied
 * state ends, that the change is said out loud rather than left to a button
 * label nobody hears, that a page over plain HTTP still copies, and that a
 * refusal is reported instead of shown as success.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '@voltdev/reactivity';
import { createClipboard, type Clipboard } from '../src/clipboard.js';
import { resetAnnouncer } from '../src/announcer.js';

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
