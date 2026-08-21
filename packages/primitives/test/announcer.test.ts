/**
 * The sentences that have nowhere to appear.
 *
 * What is worth asserting here is mostly *timing and identity*, because that
 * is where live regions fail silently: a region written to in the mutation
 * that created it announces nothing, two identical sentences in a row are
 * heard once, and a page that grows a region per component gets components
 * that talk over each other. None of those is visible on screen, and none of
 * them throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announce, resetAnnouncer } from '../src/announcer.js';

function regions(priority?: string): Element[] {
  const selector = priority
    ? `[data-volt-announcer='${priority}']`
    : '[data-volt-announcer]';
  return Array.from(document.querySelectorAll(selector));
}

/** What a screen reader would read out of the region, ignoring which slot. */
function spoken(priority = 'polite'): string {
  return regions(priority)
    .map((region) => region.textContent ?? '')
    .join('')
    .trim();
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  resetAnnouncer();
  vi.useRealTimers();
});

describe('the region', () => {
  it('exists before the words do, which is the whole point', () => {
    announce('nine results');
    // The region is on the page immediately; the sentence is not in it yet.
    expect(regions('polite')).toHaveLength(1);
    expect(spoken()).toBe('');

    vi.advanceTimersByTime(50);
    expect(spoken()).toBe('nine results');
  });

  it('is mounted once and reused, so two components cannot clip each other', () => {
    announce('first');
    vi.advanceTimersByTime(50);
    announce('second');

    expect(regions('polite')).toHaveLength(1);
    expect(spoken()).toBe('second');
  });

  it('keeps polite and assertive apart, since politeness cannot be changed later', () => {
    announce('gently');
    announce('urgently', { priority: 'assertive' });
    vi.advanceTimersByTime(50);

    expect(regions()).toHaveLength(2);
    expect(regions('polite')[0]!.getAttribute('aria-live')).toBe('polite');
    expect(regions('assertive')[0]!.getAttribute('aria-live')).toBe('assertive');
    expect(spoken('polite')).toBe('gently');
    expect(spoken('assertive')).toBe('urgently');
  });

  it('carries no accessible name, which would be read instead of the message', () => {
    announce('anything');
    const region = regions('polite')[0]!;
    expect(region.hasAttribute('aria-label')).toBe(false);
    expect(region.hasAttribute('aria-labelledby')).toBe(false);
    expect(region.getAttribute('aria-atomic')).toBe('true');
  });

  it('stays in the accessibility tree rather than being display:none', () => {
    announce('anything');
    const style = regions('polite')[0]!.getAttribute('style') ?? '';
    expect(style).not.toContain('display:none');
    expect(style).not.toContain('visibility:hidden');
    expect(style).toContain('clip-path');
  });
});

describe('what gets said', () => {
  it('announces the same sentence twice, which one text node could not', () => {
    announce('3 results');
    vi.advanceTimersByTime(50);
    const first = regions('polite')[0]!.children[0]!.textContent;

    announce('3 results');
    const region = regions('polite')[0]!;
    // The words moved to the other slot: that move is the mutation a screen
    // reader announces, and writing the same string back would not have been.
    expect(first).toBe('3 results');
    expect(region.children[0]!.textContent).toBe('');
    expect(region.children[1]!.textContent).toBe('3 results');
  });

  it('keeps only the last of a burst that arrived before the region was ready', () => {
    announce('loading');
    announce('still loading');
    announce('9 results');
    vi.advanceTimersByTime(50);

    expect(spoken()).toBe('9 results');
  });

  it('clears itself, so entering the region later does not re-read it', () => {
    announce('copied');
    vi.advanceTimersByTime(50);
    expect(spoken()).toBe('copied');

    vi.advanceTimersByTime(7000);
    expect(spoken()).toBe('');
  });

  it('lets a caller shorten the window it stays for', () => {
    announce('copied', { clearAfter: 1000 });
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(1000);
    expect(spoken()).toBe('');
  });

  it('ignores an empty message rather than clearing what is there', () => {
    announce('9 results');
    vi.advanceTimersByTime(50);
    announce('');
    expect(spoken()).toBe('9 results');
  });
});
