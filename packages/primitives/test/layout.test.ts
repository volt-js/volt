/**
 * Layout, driven through real mounted components.
 *
 * Three things are worth asserting here and nothing else really is. First, the
 * arithmetic: a scrollbar thumb and a panel's share of a group are numbers
 * derived from geometry, and every interesting bug in either is an off-by-one
 * at a limit rather than a failure in the middle of the range. Second, what
 * assistive technology is told — a splitter that reports the wrong
 * `aria-orientation` is broken even though it looks perfect. Third, the
 * promises the scroll area makes about *not* interfering: a passive listener,
 * no `overflow` of its own, and `touch-action` nowhere near the viewport.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, flushSync, mount } from '@voltdev/core';
import {
  center,
  container,
  createAspectRatio,
  createResizable,
  createScrollArea,
  flex,
  grid,
  sizeVar,
  spaceVar,
  stack,
  type AspectRatioValue,
  type Resizable,
  type ResizablePanel,
  type ResizableStorage,
  type ScrollArea,
} from '../src/layout.js';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let disposers: (() => void)[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  for (const dispose of disposers) dispose();
  mounted = [];
  disposers = [];
  flushSync();
});

/** Run something in a scope, so `onCleanup` has somewhere to attach. */
function inScope<T>(fn: () => T): T {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return fn();
  });
}

/** happy-dom computes no layout, so the geometry is stated outright. */
function setGeometry(el: Element, values: Record<string, number>): void {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(el, key, { value, configurable: true });
  }
}

function setRect(el: Element, rect: Partial<DOMRect>): void {
  const full = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    ...rect,
  } as DOMRect;
  Object.defineProperty(el, 'getBoundingClientRect', { value: () => full, configurable: true });
}

function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    ...init,
  });
}

function key(el: Element | Document, name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  el.dispatchEvent(event);
  return event;
}

// ---------------------------------------------------------------------------
// Spacing helpers
// ---------------------------------------------------------------------------

describe('spacing tokens', () => {
  it('resolves a token to a custom property rather than a length', () => {
    // The whole point: a theme can redefine `--volt-space-3`, and cannot
    // redefine `12px`.
    expect(spaceVar(3)).toBe('var(--volt-space-3)');
    expect(spaceVar('md')).toBe('var(--volt-space-md)');
    expect(sizeVar('lg')).toBe('var(--volt-size-lg)');
  });

  it("takes an application's own scale prefix", () => {
    expect(spaceVar(2, '--app-gap-')).toBe('var(--app-gap-2)');
    expect(flex({ gap: 2, spacePrefix: '--app-gap-' }).gap).toBe('var(--app-gap-2)');
  });

  it('emits nothing for an option that was not given', () => {
    // The failure this guards against is `gap: var(--volt-space-undefined)`,
    // which is a valid declaration that silently resolves to nothing.
    const style = flex();
    expect(Object.keys(style)).toEqual(['display']);
    expect(style.gap).toBeUndefined();
    expect(style.padding).toBeUndefined();
  });

  it('uses logical properties, so padding mirrors under RTL', () => {
    const style = flex({ paddingInline: 4, paddingBlock: 2 });
    expect(style['padding-inline']).toBe('var(--volt-space-4)');
    expect(style['padding-block']).toBe('var(--volt-space-2)');
    expect(style['padding-left']).toBeUndefined();
  });

  it('maps the short justify names onto the CSS keywords', () => {
    expect(flex({ justify: 'between' })['justify-content']).toBe('space-between');
    expect(flex({ justify: 'evenly' })['justify-content']).toBe('space-evenly');
    // `start` is passed through: it is flow-relative where `flex-start` is not.
    expect(flex({ justify: 'start' })['justify-content']).toBe('start');
  });

  it('stacks into a column and flexes into a row', () => {
    expect(stack({ gap: 1 })['flex-direction']).toBe('column');
    expect(stack().display).toBe('flex');
    // Row is the CSS default, so nothing is written for it.
    expect(flex()['flex-direction']).toBeUndefined();
    expect(flex({ inline: true }).display).toBe('inline-flex');
  });

  it('freezes what it returns, since these are handed to several elements', () => {
    expect(Object.isFrozen(stack())).toBe(true);
    expect(Object.isFrozen(grid())).toBe(true);
  });
});

describe('grid', () => {
  it('turns a count into equal tracks and passes a list through', () => {
    expect(grid({ columns: 3 })['grid-template-columns']).toBe('repeat(3, 1fr)');
    expect(grid({ columns: '1fr 2fr' })['grid-template-columns']).toBe('1fr 2fr');
  });

  it('caps an auto-fitting track floor at the grid width', () => {
    // Without the `min(…, 100%)` the row overflows sideways as soon as the
    // viewport is narrower than the floor — the single most common bug in a
    // hand-written auto-fit grid.
    expect(grid({ minColumn: 'sm' })['grid-template-columns']).toBe(
      'repeat(auto-fit, minmax(min(var(--volt-size-sm), 100%), 1fr))',
    );
  });

  it('prefers an auto-fitting floor over a fixed count', () => {
    expect(grid({ columns: 4, minColumn: 'sm' })['grid-template-columns']).toContain('auto-fit');
  });

  it('refuses a nonsense column count rather than emitting repeat(0)', () => {
    expect(grid({ columns: 0 })['grid-template-columns']).toBe('repeat(1, 1fr)');
    expect(grid({ columns: -3 })['grid-template-columns']).toBe('repeat(1, 1fr)');
  });
});

describe('container and center', () => {
  it('takes its padding out of the maximum rather than adding to it', () => {
    const style = container({ size: 'lg', padding: 4 });
    expect(style['max-inline-size']).toBe('var(--volt-size-lg)');
    expect(style['padding-inline']).toBe('var(--volt-space-4)');
    // Without this a "1024px" container is 1024px plus two gutters wide.
    expect(style['box-sizing']).toBe('border-box');
    expect(style['margin-inline']).toBe('auto');
  });

  it('centres on both axes at once', () => {
    const style = center({ minBlockSize: 'screen' });
    expect(style['align-items']).toBe('center');
    expect(style['justify-content']).toBe('center');
    expect(style['min-block-size']).toBe('var(--volt-size-screen)');
    expect(style['flex-direction']).toBeUndefined();
    expect(center({ column: true })['flex-direction']).toBe('column');
  });

  it('reaches the element through :style', () => {
    @Component({
      selector: 'v-boxes',
      render: compileTemplate(`<div class="box" :style="style"></div>`),
    })
    class Boxes {
      style = stack({ gap: 3, padding: 2, align: 'center' });
    }

    track(mount(Boxes, host));
    flushSync();

    const el = host.querySelector<HTMLElement>('.box')!;
    expect(el.style.display).toBe('flex');
    expect(el.style.getPropertyValue('flex-direction')).toBe('column');
    expect(el.style.getPropertyValue('gap')).toBe('var(--volt-space-3)');
    expect(el.style.getPropertyValue('align-items')).toBe('center');
  });
});

// ---------------------------------------------------------------------------
// Aspect ratio
// ---------------------------------------------------------------------------

describe('aspect ratio', () => {
  it('keeps a pair exact instead of dividing it', () => {
    const box = createAspectRatio({ defaultRatio: [16, 9] });
    // `16 / 9` in JavaScript is 1.7777777777777777; rounding it puts a
    // fraction of a pixel of letterboxing into every video on the page.
    expect(box.style()['aspect-ratio']).toBe('16 / 9');
    expect(box.value()).toBeCloseTo(16 / 9, 10);
  });

  it('accepts a plain number', () => {
    expect(createAspectRatio({ defaultRatio: 1.5 }).style()['aspect-ratio']).toBe('1.5');
  });

  it('refuses a ratio that would collapse the box', () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const box = createAspectRatio({ defaultRatio: bad });
      expect(box.value()).toBeNull();
      // `aspect-ratio: 0` is a box with no height at all, and nothing on the
      // page says why. Sizing from the content at least leaves it visible.
      expect(box.style()['aspect-ratio']).toBe('auto');
    }
  });

  it('refuses a pair with a zero denominator', () => {
    const box = createAspectRatio({ defaultRatio: [16, 0] });
    expect(box.value()).toBeNull();
    expect(box.style()['aspect-ratio']).toBe('auto');
  });

  it('is controllable from outside and reports changes', () => {
    const ratio = new Signal.State<AspectRatioValue>([4, 3]);
    const changes: unknown[] = [];
    const box = createAspectRatio({ ratio, onRatioChange: (next) => changes.push(next) });

    expect(box.style()['aspect-ratio']).toBe('4 / 3');
    ratio.set([21, 9]);
    expect(box.style()['aspect-ratio']).toBe('21 / 9');

    box.setRatio([1, 1]);
    expect(ratio.get()).toEqual([1, 1]);
    expect(changes).toEqual([[1, 1]]);
  });

  it('makes replaced content fill the box without distorting', () => {
    const style = createAspectRatio({ fit: 'contain' }).contentProps().style as Record<
      string,
      string
    >;
    expect(style['object-fit']).toBe('contain');
    expect(style['inline-size']).toBe('100%');
    expect(style['block-size']).toBe('100%');
    // Otherwise the inline baseline leaves a few pixels of background below.
    expect(style.display).toBe('block');
  });

  it('applies the ratio to a mounted element', () => {
    @Component({
      selector: 'v-ratio',
      render: compileTemplate(
        `<div class="frame" :spread="box.rootProps()">` +
          `<img class="art" :spread="box.contentProps()"></div>`,
      ),
    })
    class Framed {
      box = createAspectRatio({ defaultRatio: [16, 9] });
    }

    track(mount(Framed, host));
    flushSync();

    const frame = host.querySelector<HTMLElement>('.frame')!;
    expect(frame.style.getPropertyValue('aspect-ratio')).toBe('16 / 9');
    expect(frame.getAttribute('data-ratio')).toBe('16 / 9');
    expect(host.querySelector<HTMLElement>('.art')!.style.getPropertyValue('object-fit')).toBe(
      'cover',
    );
  });
});

// ---------------------------------------------------------------------------
// Scroll area
// ---------------------------------------------------------------------------

interface Scroller {
  area: ScrollArea;
  viewport: HTMLElement;
  content: HTMLElement;
  vbar: HTMLElement;
  vthumb: HTMLElement;
  hbar: HTMLElement;
  hthumb: HTMLElement;
}

function scrollerComponent(options: { dir?: string; jump?: boolean }) {
  const dir = options.dir ? ` dir="${options.dir}"` : '';

  @Component({
    selector: 'v-scroller',
    render: compileTemplate(
      `<div${dir}>` +
        `<div class="viewport" :ref="viewport" :spread="area.viewportProps()">` +
        `<div class="content" :ref="content"></div>` +
        `</div>` +
        `<div class="vbar" :ref="vbar" :spread="area.vertical.scrollbarProps()" ` +
        `:pointerdown="area.vertical.onTrackPointerDown($event)" ` +
        `:keydown="area.vertical.onKeyDown($event)">` +
        `<div class="vthumb" :spread="area.vertical.thumbProps()" ` +
        `:pointerdown="area.vertical.onThumbPointerDown($event)"></div>` +
        `</div>` +
        `<div class="hbar" :ref="hbar" :spread="area.horizontal.scrollbarProps()" ` +
        `:pointerdown="area.horizontal.onTrackPointerDown($event)" ` +
        `:keydown="area.horizontal.onKeyDown($event)">` +
        `<div class="hthumb" :spread="area.horizontal.thumbProps()" ` +
        `:pointerdown="area.horizontal.onThumbPointerDown($event)"></div>` +
        `</div>` +
        `</div>`,
    ),
  })
  class Scrolled {
    viewport = new Signal.State<Element | null>(null);
    content = new Signal.State<Element | null>(null);
    vbar = new Signal.State<Element | null>(null);
    hbar = new Signal.State<Element | null>(null);
    area = createScrollArea({
      viewport: () => this.viewport.get(),
      content: () => this.content.get(),
      focusableScrollbars: true,
      trackPointer: options.jump ? 'jump' : 'page',
      labels: { viewport: 'Log output' },
    });
  }

  return Scrolled;
}

/** A viewport 200 tall in 1000 of content, and 200 wide in 600. */
function mountScroller(options: { dir?: string; jump?: boolean } = {}): Scroller {
  const handle = track(mount(scrollerComponent(options), host));
  flushSync();

  const pick = <T extends HTMLElement>(selector: string): T =>
    host.querySelector<T>(selector)!;

  const viewport = pick('.viewport');
  setGeometry(viewport, {
    clientHeight: 200,
    scrollHeight: 1000,
    clientWidth: 200,
    scrollWidth: 600,
  });

  const vbar = pick('.vbar');
  const vthumb = pick('.vthumb');
  setRect(vbar, { top: 0, bottom: 200, height: 200, left: 0, right: 8, width: 8 });
  setRect(vthumb, { top: 0, bottom: 40, height: 40, left: 0, right: 8, width: 8 });

  const hbar = pick('.hbar');
  const hthumb = pick('.hthumb');
  setRect(hbar, { top: 0, bottom: 8, height: 8, left: 0, right: 200, width: 200 });
  setRect(hthumb, { top: 0, bottom: 8, height: 8, left: 0, right: 66, width: 66 });

  const area = (handle.instance as { area: ScrollArea }).area;
  area.measure();
  flushSync();

  return { area, viewport, content: pick('.content'), vbar, vthumb, hbar, hthumb };
}

describe('scroll area: leaving the platform alone', () => {
  it('registers its scroll listener as passive', () => {
    const seen: (boolean | AddEventListenerOptions | undefined)[] = [];
    const original = Element.prototype.addEventListener;
    const spy = vi
      .spyOn(Element.prototype, 'addEventListener')
      .mockImplementation(function (this: Element, type, listener, options) {
        if (type === 'scroll') seen.push(options as AddEventListenerOptions);
        return original.call(this, type, listener, options);
      });

    mountScroller();
    spy.mockRestore();

    // Not decoration: a non-passive scroll listener forces the browser to wait
    // for JavaScript before every frame of a touch scroll, and momentum dies.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toEqual({ passive: true });
  });

  it('never sets overflow or touch-action on the viewport', () => {
    const { viewport, vthumb } = mountScroller();

    // Setting `overflow: hidden` and faking the scroll is the usual approach
    // and it takes the wheel, the keyboard and find-in-page with it.
    expect(viewport.style.getPropertyValue('overflow')).toBe('');
    expect(viewport.style.getPropertyValue('overflow-y')).toBe('');
    // `touch-action: none` on the viewport would kill touch scrolling outright.
    expect(viewport.style.getPropertyValue('touch-action')).toBe('');
    // On the thumb it is required, or a touch drag is claimed as a scroll.
    expect(vthumb.style.getPropertyValue('touch-action')).toBe('none');
  });

  it('hides the platform bars with scrollbar-width, and can be told not to', () => {
    const { viewport } = mountScroller();
    expect(viewport.style.getPropertyValue('scrollbar-width')).toBe('none');

    const area = inScope(() =>
      createScrollArea({ viewport: () => viewport, hideNativeScrollbar: false }),
    );
    expect(area.viewportProps().style).toBeUndefined();
  });
});

describe('scroll area: overflow and geometry', () => {
  it('reports overflow per axis', () => {
    const { area } = mountScroller();
    expect(area.vertical.overflows()).toBe(true);
    expect(area.horizontal.overflows()).toBe(true);
    expect(area.hasCorner()).toBe(true);
    expect(area.vertical.range()).toBe(800);
  });

  it('does not call a sub-pixel rounding difference an overflow', () => {
    const { area, viewport } = mountScroller();
    setGeometry(viewport, {
      clientHeight: 300,
      scrollHeight: 301,
      clientWidth: 300,
      scrollWidth: 300,
    });
    area.measure();

    // Layout rounds; a box exactly as tall as its content routinely reports a
    // scrollHeight a fraction larger, and a bar that appears and disappears on
    // that is worse than no bar.
    expect(area.vertical.overflows()).toBe(false);
    expect(area.hasCorner()).toBe(false);
  });

  it('gives the viewport a tab stop only when there is something to scroll', () => {
    const { area, viewport } = mountScroller();
    expect(viewport.getAttribute('tabindex')).toBe('0');

    setGeometry(viewport, {
      clientHeight: 1000,
      scrollHeight: 1000,
      clientWidth: 600,
      scrollWidth: 600,
    });
    area.measure();
    flushSync();

    // A scroll container that cannot scroll is a tab stop that does nothing.
    expect(viewport.hasAttribute('tabindex')).toBe(false);
  });

  it('names the focusable viewport', () => {
    const { viewport } = mountScroller();
    expect(viewport.getAttribute('role')).toBe('group');
    expect(viewport.getAttribute('aria-label')).toBe('Log output');
  });

  it('has no corner when only one axis overflows', () => {
    const { area, viewport } = mountScroller();
    setGeometry(viewport, { scrollWidth: 200 });
    area.measure();

    expect(area.horizontal.overflows()).toBe(false);
    expect(area.overflows()).toBe(true);
    expect(area.hasCorner()).toBe(false);
    expect(area.cornerProps()['aria-hidden']).toBe('true');
  });

  it('does nothing at all without a viewport', () => {
    const area = inScope(() => createScrollArea({ viewport: () => null }));
    flushSync();

    expect(() => area.measure()).not.toThrow();
    expect(() => area.vertical.scrollTo(100)).not.toThrow();
    expect(area.overflows()).toBe(false);
    // A thumb with no geometry fills its track rather than vanishing.
    expect(area.vertical.thumbSize()).toBe(1);
  });

  it('scrolls by a delta and clamps at both ends', () => {
    const { area } = mountScroller();
    area.vertical.scrollBy(100);
    expect(area.vertical.offset()).toBe(100);
    area.vertical.scrollBy(-500);
    expect(area.vertical.offset()).toBe(0);
    area.vertical.scrollBy(5000);
    expect(area.vertical.offset()).toBe(800);
  });

  it('picks up content that grew without the viewport resizing', () => {
    const { area, viewport } = mountScroller();
    setGeometry(viewport, { scrollHeight: 4000 });
    // No ResizeObserver fires in this environment, which is exactly the case
    // `measure` exists for.
    area.measure();
    expect(area.vertical.range()).toBe(3800);
  });
});

describe('scroll area: what assistive technology is told', () => {
  it('wires the scrollbar to the viewport it controls', () => {
    const { viewport, vbar, hbar } = mountScroller();

    expect(vbar.getAttribute('role')).toBe('scrollbar');
    // Required on a scrollbar, and the reason the viewport is given an id.
    expect(vbar.getAttribute('aria-controls')).toBe(viewport.id);
    expect(viewport.id).not.toBe('');
    expect(vbar.getAttribute('aria-orientation')).toBe('vertical');
    expect(hbar.getAttribute('aria-orientation')).toBe('horizontal');
    expect(vbar.getAttribute('aria-label')).toBe('Vertical scrollbar');
    expect(hbar.getAttribute('aria-label')).toBe('Horizontal scrollbar');
  });

  it('reports the position as a percentage of the range', () => {
    const { area, vbar } = mountScroller();
    expect(vbar.getAttribute('aria-valuemin')).toBe('0');
    expect(vbar.getAttribute('aria-valuemax')).toBe('100');
    expect(vbar.getAttribute('aria-valuenow')).toBe('0');

    area.vertical.scrollTo(400);
    flushSync();
    expect(vbar.getAttribute('aria-valuenow')).toBe('50');

    area.vertical.scrollTo(99_999);
    flushSync();
    expect(vbar.getAttribute('aria-valuenow')).toBe('100');
  });

  it('marks a bar with nothing to scroll as disabled and drops its tab stop', () => {
    const { area, viewport, vbar } = mountScroller();
    expect(vbar.hasAttribute('aria-disabled')).toBe(false);
    expect(vbar.getAttribute('tabindex')).toBe('0');

    setGeometry(viewport, { scrollHeight: 200 });
    area.measure();
    flushSync();

    expect(vbar.getAttribute('aria-disabled')).toBe('true');
    expect(vbar.hasAttribute('tabindex')).toBe(false);
  });

  it('keeps the scrollbars out of the tab order by default', () => {
    const viewport = document.createElement('div');
    document.body.append(viewport);
    setGeometry(viewport, { clientHeight: 100, scrollHeight: 500 });

    const area = inScope(() => createScrollArea({ viewport: () => viewport }));
    area.measure();

    // The viewport is focusable and the platform already scrolls it with the
    // arrows; a second tab stop per scroll area buys nothing.
    expect(area.vertical.scrollbarProps().tabindex).toBeUndefined();
    expect(area.viewportProps().tabindex).toBe('0');
  });

  it('takes an overriding label and a spoken position', () => {
    const viewport = document.createElement('div');
    setGeometry(viewport, { clientHeight: 100, scrollHeight: 500 });

    const area = inScope(() =>
      createScrollArea({
        viewport: () => viewport,
        labels: {
          verticalScrollbar: 'Barre de défilement',
          scrollPosition: (percent) => `${percent} pour cent`,
        },
      }),
    );
    area.measure();
    area.vertical.scrollTo(200);

    expect(area.vertical.scrollbarProps()['aria-label']).toBe('Barre de défilement');
    expect(area.vertical.scrollbarProps()['aria-valuetext']).toBe('50 pour cent');
  });
});

describe('scroll area: the thumb', () => {
  it('states its length and offset as CSS the track resolves', () => {
    const { area, vthumb } = mountScroller();

    // 200 visible of 1000 is a fifth of the track. The minimum is applied with
    // `max()` rather than in JavaScript because only the browser knows how
    // long the track is — and the offset subtracts the same expression, so a
    // thumb held at its minimum still stops at the end instead of overrunning.
    expect(vthumb.style.getPropertyValue('--volt-scroll-thumb-size')).toBe('max(20px, 20%)');
    expect(vthumb.style.getPropertyValue('--volt-scroll-thumb-offset')).toBe(
      'calc((100% - max(20px, 20%)) * 0)',
    );

    area.vertical.scrollTo(200);
    flushSync();
    expect(vthumb.style.getPropertyValue('--volt-scroll-thumb-offset')).toBe(
      'calc((100% - max(20px, 20%)) * 0.25)',
    );
    expect(area.vertical.thumbSize()).toBeCloseTo(0.2, 6);
  });

  it('never reports a thumb longer than its track', () => {
    const { area, viewport } = mountScroller();
    setGeometry(viewport, { clientHeight: 200, scrollHeight: 100 });
    area.measure();
    expect(area.vertical.thumbSize()).toBe(1);
  });
});

describe('scroll area: dragging the thumb', () => {
  it('maps pointer travel onto the scroll range', () => {
    const { area, viewport, vthumb } = mountScroller();

    vthumb.dispatchEvent(pointer('pointerdown', { clientY: 0 }));
    expect(area.isDragging()).toBe(true);

    // Track 200, thumb 40, so 160px of pointer travel covers 800px of range.
    vthumb.dispatchEvent(pointer('pointermove', { clientY: 30 }));
    expect(viewport.scrollTop).toBe(150);

    vthumb.dispatchEvent(pointer('pointerup', { clientY: 30 }));
    expect(area.isDragging()).toBe(false);
  });

  it('measures from where the drag began, so a limit does not lose ground', () => {
    const { viewport, vthumb } = mountScroller();

    vthumb.dispatchEvent(pointer('pointerdown', { clientY: 0 }));
    // Far past the end, where an incremental model would throw away the
    // clamped-off remainder…
    vthumb.dispatchEvent(pointer('pointermove', { clientY: 900 }));
    expect(viewport.scrollTop).toBe(800);
    // …and coming back would then be short by however far it was pushed over.
    vthumb.dispatchEvent(pointer('pointermove', { clientY: 20 }));
    expect(viewport.scrollTop).toBe(100);
  });

  it('ignores the secondary button and a second finger', () => {
    const { area, vthumb } = mountScroller();

    vthumb.dispatchEvent(pointer('pointerdown', { clientY: 0, button: 2 }));
    expect(area.isDragging()).toBe(false);

    vthumb.dispatchEvent(pointer('pointerdown', { clientY: 0, isPrimary: false, pointerId: 7 }));
    expect(area.isDragging()).toBe(false);

    vthumb.dispatchEvent(pointer('pointerdown', { clientY: 0 }));
    expect(area.isDragging()).toBe(true);
    // A second pointer arriving mid-drag must not take it over.
    vthumb.dispatchEvent(pointer('pointerdown', { clientY: 0, pointerId: 2 }));
    vthumb.dispatchEvent(pointer('pointermove', { clientY: 30, pointerId: 2 }));
    expect(area.vertical.offset()).toBe(0);
  });

  it('prevents the default so the drag does not select the page', () => {
    const { vthumb } = mountScroller();
    const event = pointer('pointerdown', { clientY: 0, cancelable: true });
    vthumb.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('puts everything back on Escape', () => {
    const { area, viewport, vthumb } = mountScroller();
    area.vertical.scrollTo(400);

    vthumb.dispatchEvent(pointer('pointerdown', { clientY: 0 }));
    vthumb.dispatchEvent(pointer('pointermove', { clientY: 30 }));
    expect(viewport.scrollTop).toBe(550);

    key(document, 'Escape');
    expect(viewport.scrollTop).toBe(400);
    expect(area.isDragging()).toBe(false);
  });

  it('stops listening once the drag is over', () => {
    const { area, viewport, vthumb } = mountScroller();
    vthumb.dispatchEvent(pointer('pointerdown', { clientY: 0 }));
    vthumb.dispatchEvent(pointer('pointerup', { clientY: 0 }));

    vthumb.dispatchEvent(pointer('pointermove', { clientY: 100 }));
    expect(viewport.scrollTop).toBe(0);
    expect(area.isDragging()).toBe(false);
  });
});

describe('scroll area: pressing the track', () => {
  it('pages towards the pointer', () => {
    const { area, viewport, vbar } = mountScroller();

    // Thumb occupies 0–40 of a 200 track; a press at 100 is past it.
    vbar.dispatchEvent(pointer('pointerdown', { clientY: 100 }));
    expect(viewport.scrollTop).toBe(160);

    // Now the thumb starts at 32; a press at 10 is before it.
    vbar.dispatchEvent(pointer('pointerdown', { clientY: 10 }));
    expect(viewport.scrollTop).toBe(0);
    expect(area.vertical.progress()).toBe(0);
  });

  it('jumps with the thumb centred when asked to', () => {
    const { viewport, vbar } = mountScroller({ jump: true });
    vbar.dispatchEvent(pointer('pointerdown', { clientY: 100 }));
    // (100 - 20) / 160 * 800: the thumb's centre lands under the pointer,
    // rather than its leading edge half a thumb further on.
    expect(viewport.scrollTop).toBe(400);
  });

  it('leaves a press that landed on the thumb to the thumb', () => {
    const { area, viewport, vthumb } = mountScroller();
    // Bubbles up to the track's handler, which would otherwise page away from
    // under the drag that has just started.
    vthumb.dispatchEvent(pointer('pointerdown', { clientY: 10 }));
    expect(viewport.scrollTop).toBe(0);
    expect(area.isDragging()).toBe(true);
  });
});

describe('scroll area: keyboard', () => {
  it('walks the full map on the vertical axis', () => {
    const { area, vbar } = mountScroller();

    key(vbar, 'ArrowDown');
    expect(area.vertical.offset()).toBe(40);
    key(vbar, 'ArrowUp');
    expect(area.vertical.offset()).toBe(0);

    // A page is the viewport less an overlap, never the whole viewport: a jump
    // of exactly one screen leaves no line in common between the two.
    key(vbar, 'PageDown');
    expect(area.vertical.offset()).toBe(160);
    key(vbar, 'PageUp');
    expect(area.vertical.offset()).toBe(0);

    key(vbar, 'End');
    expect(area.vertical.offset()).toBe(800);
    key(vbar, 'Home');
    expect(area.vertical.offset()).toBe(0);

    key(vbar, ' ');
    expect(area.vertical.offset()).toBe(160);
    key(vbar, ' ', { shiftKey: true });
    expect(area.vertical.offset()).toBe(0);
  });

  it('prevents the default only for the keys it took', () => {
    const { vbar } = mountScroller();
    expect(key(vbar, 'ArrowDown').defaultPrevented).toBe(true);
    // Otherwise the arrows scroll the page as well and the area moves twice.
    expect(key(vbar, 'Tab').defaultPrevented).toBe(false);
    expect(key(vbar, 'a').defaultPrevented).toBe(false);
  });

  it('leaves modified keys to the browser', () => {
    const { area, vbar } = mountScroller();
    key(vbar, 'ArrowDown', { ctrlKey: true });
    key(vbar, 'Home', { metaKey: true });
    expect(area.vertical.offset()).toBe(0);
  });

  it('ignores Space on the horizontal axis, where it means nothing', () => {
    const { area, hbar } = mountScroller();
    expect(key(hbar, ' ').defaultPrevented).toBe(false);
    expect(area.horizontal.offset()).toBe(0);

    key(hbar, 'ArrowRight');
    expect(area.horizontal.offset()).toBe(40);
    // The vertical arrows are not this axis's business.
    expect(key(hbar, 'ArrowDown').defaultPrevented).toBe(false);
  });

  it('does nothing when there is nothing to scroll', () => {
    const { area, viewport, vbar } = mountScroller();
    setGeometry(viewport, { scrollHeight: 200 });
    area.measure();

    expect(key(vbar, 'ArrowDown').defaultPrevented).toBe(false);
    expect(area.vertical.offset()).toBe(0);
  });
});

describe('scroll area: right to left', () => {
  it('counts the horizontal offset up from the inline start', () => {
    const { area, viewport } = mountScroller({ dir: 'rtl' });

    // The browser puts `scrollLeft` at zero on the right edge and runs it
    // negative going left. A consumer written against the raw property gets
    // the sign wrong exactly once, in the language they do not test in.
    viewport.scrollLeft = -100;
    area.measure();
    expect(area.horizontal.offset()).toBe(100);
    expect(area.horizontal.progress()).toBeCloseTo(0.25, 6);
  });

  it('mirrors the arrows and writes back a negative scrollLeft', () => {
    const { area, viewport, hbar } = mountScroller({ dir: 'rtl' });

    key(hbar, 'ArrowLeft');
    expect(area.horizontal.offset()).toBe(40);
    expect(viewport.scrollLeft).toBe(-40);

    key(hbar, 'ArrowRight');
    expect(area.horizontal.offset()).toBe(0);
  });

  it('mirrors a thumb drag', () => {
    const { area, hthumb } = mountScroller({ dir: 'rtl' });
    hthumb.dispatchEvent(pointer('pointerdown', { clientX: 100 }));
    // Leftwards is forwards here.
    hthumb.dispatchEvent(pointer('pointermove', { clientX: 60 }));
    expect(area.horizontal.offset()).toBeGreaterThan(0);
  });
});

describe('scroll area: reporting', () => {
  it('reports a programmatic scroll once, not again on the event that follows', () => {
    const viewport = document.createElement('div');
    document.body.append(viewport);
    setGeometry(viewport, { clientHeight: 100, scrollHeight: 500 });

    const seen: { top: number }[] = [];
    const area = inScope(() =>
      createScrollArea({ viewport: () => viewport, onScroll: (p) => seen.push({ top: p.top }) }),
    );
    flushSync();
    area.measure();

    area.vertical.scrollTo(120);
    expect(seen).toEqual([{ top: 120 }]);

    // The browser's own scroll event lands afterwards and finds nothing new.
    viewport.dispatchEvent(new Event('scroll'));
    expect(seen).toHaveLength(1);
  });

  it('goes idle after the hide delay', () => {
    vi.useFakeTimers();
    try {
      const viewport = document.createElement('div');
      document.body.append(viewport);
      setGeometry(viewport, { clientHeight: 100, scrollHeight: 500 });

      const area = inScope(() =>
        createScrollArea({ viewport: () => viewport, hideDelay: 300 }),
      );
      flushSync();
      area.measure();

      area.vertical.scrollTo(50);
      expect(area.isScrolling()).toBe(true);
      expect(area.vertical.scrollbarProps()['data-state']).toBe('scrolling');

      vi.advanceTimersByTime(299);
      expect(area.isScrolling()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(area.isScrolling()).toBe(false);
      expect(area.vertical.scrollbarProps()['data-state']).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Resizable
// ---------------------------------------------------------------------------

interface Split {
  split: Resizable;
  group: HTMLElement;
  handle: (index: number) => HTMLElement;
  panel: (index: number) => HTMLElement;
}

interface SplitOptions {
  vertical?: boolean;
  dir?: string;
  panels?: readonly ResizablePanel[];
  storage?: ResizableStorage;
  storageKey?: string;
}

function splitComponent(options: SplitOptions) {
  const dir = options.dir ? ` dir="${options.dir}"` : '';
  const panels = options.panels ?? [{ min: 10 }, { min: 10 }];

  @Component({
    selector: 'v-split',
    render: compileTemplate(
      `<div${dir}><div class="group" :ref="group" :spread="split.groupProps()">` +
        `<div class="p0" :spread="split.panelProps(0)"></div>` +
        `<div class="h0" :spread="split.handleProps(0)" ` +
        `:keydown="split.onHandleKeyDown(0, $event)" ` +
        `:pointerdown="split.onHandlePointerDown(0, $event)" ` +
        `:dblclick="split.onHandleDoubleClick(0, $event)"></div>` +
        `<div class="p1" :spread="split.panelProps(1)"></div>` +
        `</div></div>`,
    ),
  })
  class Split2 {
    group = new Signal.State<Element | null>(null);
    split = createResizable({
      panels,
      group: () => this.group.get(),
      orientation: options.vertical ? 'vertical' : 'horizontal',
      storage: options.storage,
      storageKey: options.storageKey,
    });
  }

  return Split2;
}

function mountSplit(options: SplitOptions = {}): Split {
  const handle = track(mount(splitComponent(options), host));
  flushSync();

  const group = host.querySelector<HTMLElement>('.group')!;
  setRect(group, { width: 1000, height: 500, right: 1000, bottom: 500 });

  return {
    split: (handle.instance as { split: Resizable }).split,
    group,
    handle: (index) => host.querySelector<HTMLElement>(`.h${index}`)!,
    panel: (index) => host.querySelector<HTMLElement>(`.p${index}`)!,
  };
}

describe('resizable: starting sizes', () => {
  it('splits the group evenly when nothing is declared', () => {
    const split = inScope(() =>
      createResizable({ panels: [{}, {}, {}], group: () => null }),
    );
    const sizes = split.sizes();
    expect(sizes.map((n) => Math.round(n))).toEqual([33, 33, 33]);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it('gives declared panels their size and shares the rest', () => {
    const split = inScope(() =>
      createResizable({ panels: [{ defaultSize: 20 }, {}, {}], group: () => null }),
    );
    expect(split.sizes()).toEqual([20, 40, 40]);
  });

  it('honours limits, and still adds up to a hundred', () => {
    // The declared sizes are impossible: 80 is above the first panel's maximum.
    const split = inScope(() =>
      createResizable({
        panels: [{ defaultSize: 80, max: 30 }, { min: 10 }],
        group: () => null,
      }),
    );
    expect(split.size(0)).toBe(30);
    expect(split.sizes().reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });
});

describe('resizable: what assistive technology is told', () => {
  it('reports the line, not the movement', () => {
    const { handle } = mountSplit();
    // A row of panels is divided by *vertical* lines, and it is Left and Right
    // that move them. Reporting `horizontal` here — which several libraries do
    // — tells a screen reader user to press the wrong keys.
    expect(handle(0).getAttribute('role')).toBe('separator');
    expect(handle(0).getAttribute('aria-orientation')).toBe('vertical');

    const down = mountSplit({ vertical: true });
    expect(down.handle(0).getAttribute('aria-orientation')).toBe('horizontal');
    expect(down.split.separatorOrientation()).toBe('horizontal');
  });

  it('names the pane it sizes and reports its range', () => {
    const { split, handle, panel } = mountSplit({ panels: [{ min: 20, max: 80 }, {}] });

    expect(handle(0).getAttribute('aria-controls')).toBe(panel(0).id);
    expect(panel(0).id).not.toBe('');
    expect(handle(0).getAttribute('aria-valuenow')).toBe('50');
    expect(handle(0).getAttribute('aria-valuemin')).toBe('20');
    expect(handle(0).getAttribute('aria-valuemax')).toBe('80');
    expect(handle(0).getAttribute('tabindex')).toBe('0');

    split.resize(0, 10);
    flushSync();
    expect(handle(0).getAttribute('aria-valuenow')).toBe('60');
    expect(handle(0).getAttribute('aria-valuetext')).toBe('60 percent');
  });

  it("reports a collapsible pane's minimum as its collapsed size", () => {
    const split = inScope(() =>
      createResizable({
        panels: [{ min: 20, collapsible: true, collapsedSize: 4 }, {}],
        group: () => null,
      }),
    );
    // Otherwise the announced range excludes a size the pane can actually be.
    expect(split.handleProps(0)['aria-valuemin']).toBe('4');
  });

  it('takes a name, and prefers one already on the page', () => {
    const split = inScope(() =>
      createResizable({
        panels: [{}, {}],
        group: () => null,
        labels: { handle: (index) => `Poignée ${index + 1}` },
      }),
    );

    expect(split.handleProps(0)['aria-label']).toBe('Poignée 1');
    expect(split.handleProps(0, { label: 'Resize sidebar' })['aria-label']).toBe('Resize sidebar');

    const wired = split.handleProps(0, { labelledBy: 'sidebar-heading' });
    expect(wired['aria-labelledby']).toBe('sidebar-heading');
    // Two names is one too many, and `aria-label` would be the one that wins.
    expect(wired['aria-label']).toBeUndefined();
  });

  it('marks a disabled handle without removing it from the page', () => {
    const split = inScope(() => createResizable({ panels: [{}, {}], group: () => null }));
    const props = split.handleProps(0, { disabled: true });
    // Still reachable and still announced, just refused.
    expect(props['aria-disabled']).toBe('true');
    expect(props.tabindex).toBe('0');
  });
});

describe('resizable: keyboard', () => {
  it('moves with the arrows perpendicular to the line', () => {
    const { split, handle } = mountSplit();

    key(handle(0), 'ArrowRight');
    expect(split.size(0)).toBe(51);
    key(handle(0), 'ArrowLeft');
    expect(split.size(0)).toBe(50);

    // Shift is a larger step, not a browser shortcut.
    key(handle(0), 'ArrowRight', { shiftKey: true });
    expect(split.size(0)).toBe(60);
  });

  it("takes Home and End to this pane's limits, not the document's", () => {
    const { split, handle } = mountSplit({ panels: [{ min: 15, max: 70 }, { min: 10 }] });

    key(handle(0), 'End');
    expect(split.size(0)).toBe(70);
    key(handle(0), 'Home');
    expect(split.size(0)).toBe(15);
    expect(split.sizes().reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it('uses the vertical arrows for a stacked group and ignores the others', () => {
    const { split, handle } = mountSplit({ vertical: true });

    expect(key(handle(0), 'ArrowRight').defaultPrevented).toBe(false);
    expect(split.size(0)).toBe(50);

    key(handle(0), 'ArrowDown');
    expect(split.size(0)).toBe(51);
    key(handle(0), 'ArrowUp');
    expect(split.size(0)).toBe(50);
  });

  it('mirrors the arrows under dir="rtl"', () => {
    const { split, handle } = mountSplit({ dir: 'rtl' });
    // The first panel is the right-hand one, so Left is what grows it.
    key(handle(0), 'ArrowLeft');
    expect(split.size(0)).toBe(51);
    key(handle(0), 'ArrowRight');
    expect(split.size(0)).toBe(50);
  });

  it('leaves modified keys and unknown keys alone', () => {
    const { split, handle } = mountSplit();
    expect(key(handle(0), 'ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key(handle(0), 'a').defaultPrevented).toBe(false);
    expect(split.size(0)).toBe(50);
  });

  it('refuses a disabled handle', () => {
    const split = inScope(() => createResizable({ panels: [{}, {}], group: () => null }));
    const handle = document.createElement('div');
    handle.setAttribute('aria-disabled', 'true');
    document.body.append(handle);
    handle.addEventListener('keydown', (event) => split.onHandleKeyDown(0, event));

    key(handle, 'ArrowRight');
    expect(split.size(0)).toBe(50);
  });

  it('stops at a limit rather than drifting past it', () => {
    const { split, handle } = mountSplit({ panels: [{ min: 45 }, { min: 10 }] });

    for (let i = 0; i < 20; i++) key(handle(0), 'ArrowLeft');
    expect(split.size(0)).toBe(45);
    expect(split.sizes().reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);

    // And it comes straight back off the limit, one step at a time.
    key(handle(0), 'ArrowRight');
    expect(split.size(0)).toBe(46);
  });
});

describe('resizable: several panels', () => {
  it('cascades into the far panel when the near one is spent', () => {
    const split = inScope(() =>
      createResizable({
        panels: [{ defaultSize: 20 }, { defaultSize: 20, min: 20 }, { defaultSize: 60, min: 10 }],
        group: () => null,
      }),
    );

    // The middle panel starts at its minimum, so a naive implementation stops
    // dead here. The space has to come from the third.
    split.resize(0, 10);
    expect(split.sizes()).toEqual([30, 20, 50]);
    expect(split.sizes().reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it('moves only as far as both sides allow', () => {
    const split = inScope(() =>
      createResizable({
        panels: [{ defaultSize: 50, max: 55 }, { defaultSize: 50, min: 10 }],
        group: () => null,
      }),
    );
    split.resize(0, 30);
    expect(split.sizes()).toEqual([55, 45]);
  });

  it('sizes the last panel through the boundary on its other side', () => {
    const split = inScope(() =>
      createResizable({ panels: [{}, {}, {}], group: () => null }),
    );
    split.resizeTo(2, 50);
    expect(split.size(2)).toBeCloseTo(50, 6);
    expect(split.sizes().reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it('ignores a boundary that does not exist', () => {
    const split = inScope(() => createResizable({ panels: [{}, {}], group: () => null }));
    // The last panel has no boundary after it, and neither does -1.
    split.resize(1, 10);
    split.resize(-1, 10);
    split.resize(0, Number.NaN);
    expect(split.sizes()).toEqual([50, 50]);
  });

  it('normalises sizes handed in from outside, and resets to the defaults', () => {
    const split = inScope(() =>
      createResizable({ panels: [{ min: 20 }, {}], group: () => null }),
    );

    // Two equal halves on the wrong scale are still two equal halves. Handing
    // the shortfall to the first panel instead would make this `[95, 5]`.
    split.setSizes([5, 5]);
    expect(split.sizes()).toEqual([50, 50]);

    // Proportions that would put a panel under its minimum give way to it.
    split.setSizes([1, 9]);
    expect(split.size(0)).toBe(20);
    expect(split.sizes().reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);

    split.reset();
    expect(split.sizes()).toEqual([50, 50]);
  });
});

describe('resizable: collapsing', () => {
  const collapsible: readonly ResizablePanel[] = [
    { min: 20, collapsible: true, collapsedSize: 0 },
    { min: 10 },
  ];

  it('collapses and restores the size it had', () => {
    const { split, handle } = mountSplit({ panels: collapsible });

    split.resize(0, 10);
    expect(split.size(0)).toBe(60);

    key(handle(0), 'Enter');
    expect(split.isCollapsed(0)).toBe(true);
    expect(split.size(0)).toBe(0);
    expect(split.size(1)).toBe(100);

    key(handle(0), 'Enter');
    expect(split.isCollapsed(0)).toBe(false);
    expect(split.size(0)).toBe(60);
  });

  it('marks the collapsed panel for CSS', () => {
    const { split, panel } = mountSplit({ panels: collapsible });
    split.collapse(0);
    flushSync();
    expect(panel(0).hasAttribute('data-collapsed')).toBe(true);
    expect(panel(1).hasAttribute('data-collapsed')).toBe(false);
  });

  it('collapses on a double click too, and agrees with Enter about which panel', () => {
    const { split, handle } = mountSplit({ panels: collapsible });
    handle(0).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(split.isCollapsed(0)).toBe(true);
  });

  it('does not collapse a panel that was never allowed to', () => {
    const { split, handle } = mountSplit({ panels: [{ min: 20 }, { min: 10 }] });
    expect(key(handle(0), 'Enter').defaultPrevented).toBe(false);
    expect(split.isCollapsed(0)).toBe(false);
    split.collapse(0);
    expect(split.size(0)).toBe(50);
  });

  it('snaps shut only once the drag is pushed well past the minimum', () => {
    const split = inScope(() =>
      createResizable({
        panels: [{ min: 20, collapsible: true, collapsedSize: 0 }, { min: 10 }],
        group: () => null,
      }),
    );

    // Down to the minimum, and a little past it: still open, still 20.
    split.resize(0, -35);
    expect(split.size(0)).toBe(20);
    expect(split.isCollapsed(0)).toBe(false);

    // Past the halfway point between the minimum and nothing.
    split.resize(0, -12);
    expect(split.isCollapsed(0)).toBe(true);
    expect(split.size(0)).toBe(0);
  });

  it('opens again when the drag pulls far enough the other way', () => {
    const split = inScope(() =>
      createResizable({
        panels: [{ min: 20, collapsible: true, collapsedSize: 0 }, { min: 10 }],
        group: () => null,
      }),
    );
    split.collapse(0);
    expect(split.size(0)).toBe(0);

    // Not enough: an ordinary drag cannot inch a collapsed panel open to a
    // width it is not allowed to have.
    split.resize(0, 5);
    expect(split.size(0)).toBe(0);

    split.resize(0, 15);
    expect(split.size(0)).toBe(20);
  });

  it('collapses under a pointer drag pushed past the minimum, and reopens', () => {
    const { split, handle } = mountSplit({ panels: collapsible });

    handle(0).dispatchEvent(pointer('pointerdown', { clientX: 500 }));
    // Down to the minimum: 300px of a 1000px group is thirty points.
    handle(0).dispatchEvent(pointer('pointermove', { clientX: 200 }));
    expect(split.size(0)).toBe(20);
    expect(split.isCollapsed(0)).toBe(false);

    // Because the whole gesture is measured from where it started, carrying on
    // in the same direction is what accumulates the overshoot that collapses
    // it — where a step-by-step model would forget every push past the limit.
    handle(0).dispatchEvent(pointer('pointermove', { clientX: 50 }));
    expect(split.isCollapsed(0)).toBe(true);

    // And coming back out of the corner reopens it, without ending the drag.
    handle(0).dispatchEvent(pointer('pointermove', { clientX: 400 }));
    expect(split.isCollapsed(0)).toBe(false);
    expect(split.size(0)).toBe(40);
  });

  it('never leaves a panel between its collapsed size and its minimum', () => {
    const split = inScope(() =>
      createResizable({
        panels: [{ min: 30, collapsible: true, collapsedSize: 5 }, { min: 10 }],
        group: () => null,
      }),
    );

    for (let delta = -1; delta > -60; delta--) {
      split.resize(0, -1);
      const size = split.size(0);
      const inTheGap = size > 5 + 0.01 && size < 30 - 0.01;
      expect(inTheGap).toBe(false);
    }
  });
});

describe('resizable: dragging', () => {
  it('turns pointer travel into a share of the group', () => {
    const { split, handle } = mountSplit();

    handle(0).dispatchEvent(pointer('pointerdown', { clientX: 0 }));
    expect(split.isDragging()).toBe(true);
    expect(split.activeHandle()).toBe(0);

    // A tenth of a 1000px group is ten percentage points.
    handle(0).dispatchEvent(pointer('pointermove', { clientX: 100 }));
    expect(split.size(0)).toBeCloseTo(60, 6);

    handle(0).dispatchEvent(pointer('pointerup', { clientX: 100 }));
    expect(split.isDragging()).toBe(false);
    expect(split.activeHandle()).toBeNull();
  });

  it('measures from where the drag began', () => {
    const { split, handle } = mountSplit({ panels: [{ min: 40 }, { min: 10 }] });

    handle(0).dispatchEvent(pointer('pointerdown', { clientX: 500 }));
    // Well past the first panel's minimum…
    handle(0).dispatchEvent(pointer('pointermove', { clientX: 100 }));
    expect(split.size(0)).toBe(40);
    // …and back: an accumulating implementation would be short by 10 here.
    handle(0).dispatchEvent(pointer('pointermove', { clientX: 450 }));
    expect(split.size(0)).toBeCloseTo(45, 6);
  });

  it('puts the whole gesture back on Escape', () => {
    const { split, handle } = mountSplit();

    handle(0).dispatchEvent(pointer('pointerdown', { clientX: 0 }));
    handle(0).dispatchEvent(pointer('pointermove', { clientX: 200 }));
    expect(split.size(0)).toBeCloseTo(70, 6);

    key(document, 'Escape');
    // The whole drag, not the last increment of it.
    expect(split.size(0)).toBe(50);
    expect(split.isDragging()).toBe(false);
  });

  it('mirrors the drag under dir="rtl"', () => {
    const { split, handle } = mountSplit({ dir: 'rtl' });
    handle(0).dispatchEvent(pointer('pointerdown', { clientX: 500 }));
    handle(0).dispatchEvent(pointer('pointermove', { clientX: 400 }));
    // Leftwards grows the right-hand panel, which is the first one.
    expect(split.size(0)).toBeCloseTo(60, 6);
  });

  it('refuses the secondary button, a disabled handle, and an unmeasurable group', () => {
    const { split, handle } = mountSplit();

    handle(0).dispatchEvent(pointer('pointerdown', { clientX: 0, button: 2 }));
    expect(split.isDragging()).toBe(false);

    handle(0).setAttribute('aria-disabled', 'true');
    handle(0).dispatchEvent(pointer('pointerdown', { clientX: 0 }));
    expect(split.isDragging()).toBe(false);
    handle(0).removeAttribute('aria-disabled');

    // A group with no box gives no way to turn pixels into shares; refusing
    // leaves the keyboard path working rather than moving by a made-up amount.
    setRect(handle(0).parentElement!, { width: 0, height: 0 });
    handle(0).dispatchEvent(pointer('pointerdown', { clientX: 0 }));
    expect(split.isDragging()).toBe(false);
  });

  it('marks the group and the handle while the drag runs', () => {
    const { group, handle } = mountSplit();

    handle(0).dispatchEvent(pointer('pointerdown', { clientX: 0 }));
    flushSync();
    expect(group.hasAttribute('data-dragging')).toBe(true);
    expect(handle(0).hasAttribute('data-dragging')).toBe(true);

    handle(0).dispatchEvent(pointer('pointerup', { clientX: 0 }));
    flushSync();
    expect(group.hasAttribute('data-dragging')).toBe(false);
  });
});

describe('resizable: styling hooks', () => {
  it('gives each panel its share and the group a grid template', () => {
    const { split, group, panel } = mountSplit();

    expect(panel(0).style.getPropertyValue('--volt-resizable-size')).toBe('50%');
    // Interleaved with `auto` for the handles, so a grid group needs nothing
    // but `grid-template-columns: var(--volt-resizable-template)`. The shares
    // are `fr`, not percentages: `50% auto 50%` already fills the group before
    // the handle takes its width, so the grid overflows by exactly that much.
    expect(group.style.getPropertyValue('--volt-resizable-template')).toBe(
      'minmax(0, 50fr) auto minmax(0, 50fr)',
    );
    expect(group.getAttribute('data-orientation')).toBe('horizontal');

    split.resize(0, 10);
    flushSync();
    expect(panel(0).style.getPropertyValue('--volt-resizable-size')).toBe('60%');
    expect(group.style.getPropertyValue('--volt-resizable-template')).toBe(
      'minmax(0, 60fr) auto minmax(0, 40fr)',
    );
  });

  it('puts touch-action on the handle, or a touch drag never starts', () => {
    const { handle } = mountSplit();
    expect(handle(0).style.getPropertyValue('touch-action')).toBe('none');
  });
});

describe('resizable: persistence', () => {
  type Fake = ResizableStorage & { map: Map<string, string> };

  function fakeStorage(seed: Record<string, string> = {}): Fake {
    const map = new Map(Object.entries(seed));
    return {
      map,
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
    };
  }

  it('writes the sizes as they change and reads them back', () => {
    const storage = fakeStorage();
    const first = inScope(() =>
      createResizable({ panels: [{}, {}], group: () => null, storage, storageKey: 'panes' }),
    );
    flushSync();
    first.resize(0, 20);
    flushSync();
    expect(storage.map.get('panes')).toBe('[70,30]');

    const second = inScope(() =>
      createResizable({ panels: [{}, {}], group: () => null, storage, storageKey: 'panes' }),
    );
    expect(second.sizes()).toEqual([70, 30]);
  });

  it('ignores a layout stored for a different set of panels', () => {
    const storage = fakeStorage({ panes: '[70,30]' });
    // The application gained a panel since the layout was stored. Mapping two
    // sizes onto three panels brings the layout back subtly wrong with nothing
    // to say why, so the stored value is dropped instead.
    const split = inScope(() =>
      createResizable({ panels: [{}, {}, {}], group: () => null, storage, storageKey: 'panes' }),
    );
    expect(split.sizes().map(Math.round)).toEqual([33, 33, 33]);
  });

  it('ignores anything that is not a list of sizes', () => {
    for (const stored of ['not json', '{"a":1}', '[70,"30"]', '[70,null]', '[-10,110]', '']) {
      const storage = fakeStorage({ panes: stored });
      const split = inScope(() =>
        createResizable({ panels: [{}, {}], group: () => null, storage, storageKey: 'panes' }),
      );
      expect(split.sizes()).toEqual([50, 50]);
    }
  });

  it('clamps stored sizes back into the current limits', () => {
    // The panel gained a minimum since the layout was stored.
    const storage = fakeStorage({ panes: '[5,95]' });
    const split = inScope(() =>
      createResizable({
        panels: [{ min: 25 }, {}],
        group: () => null,
        storage,
        storageKey: 'panes',
      }),
    );
    expect(split.size(0)).toBe(25);
    expect(split.sizes().reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it('survives storage refusing to answer', () => {
    const broken: ResizableStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const split = inScope(() =>
      createResizable({ panels: [{}, {}], group: () => null, storage: broken, storageKey: 'x' }),
    );
    flushSync();
    // Private browsing and quota errors are not worth taking an application
    // down for; the layout is simply not remembered.
    expect(() => split.resize(0, 10)).not.toThrow();
    flushSync();
    expect(split.size(0)).toBe(60);
  });

  it('reads a stored layout back into a signal handed in from outside', () => {
    const storage = fakeStorage({ panes: '[70,30]' });
    const sizes = new Signal.State([50, 50]);
    const onSizesChange = vi.fn();
    const split = inScope(() =>
      createResizable({
        panels: [{}, {}],
        group: () => null,
        sizes,
        storage,
        storageKey: 'panes',
        onSizesChange,
      }),
    );

    // A controlled group is written under its key like any other, so a reload
    // that did not restore it would save a layout nobody ever gets back.
    expect(sizes.get()).toEqual([70, 30]);
    expect(split.sizes()).toEqual([70, 30]);
    // Restoring is not somebody moving a boundary.
    expect(onSizesChange).not.toHaveBeenCalled();

    split.resize(0, -20);
    flushSync();
    expect(storage.map.get('panes')).toBe('[50,50]');
  });

  it('leaves a controlled signal alone when nothing usable is stored', () => {
    const storage = fakeStorage({ panes: 'not json' });
    const sizes = new Signal.State([20, 80]);
    inScope(() =>
      createResizable({ panels: [{}, {}], group: () => null, sizes, storage, storageKey: 'panes' }),
    );
    expect(sizes.get()).toEqual([20, 80]);
  });

  it('stores nothing without a key', () => {
    const storage = fakeStorage();
    const split = inScope(() => createResizable({ panels: [{}, {}], group: () => null, storage }));
    flushSync();
    split.resize(0, 10);
    flushSync();
    expect(storage.map.size).toBe(0);
  });
});

describe('resizable: control and nesting', () => {
  it('follows a signal handed in from outside', () => {
    const sizes = new Signal.State([30, 70]);
    const split = inScope(() =>
      createResizable({ panels: [{}, {}], group: () => null, sizes }),
    );
    expect(split.size(0)).toBe(30);

    sizes.set([80, 20]);
    expect(split.size(0)).toBe(80);

    split.resize(0, -10);
    expect(sizes.get()[0]).toBe(70);
  });

  it('reports every change once', () => {
    const seen: number[][] = [];
    const split = inScope(() =>
      createResizable({
        panels: [{}, {}],
        group: () => null,
        onSizesChange: (next) => seen.push([...next]),
      }),
    );

    split.resize(0, 10);
    // A move that changes nothing is not a change.
    split.resize(0, 0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([60, 40]);
  });

  it("keeps a nested group's identifiers and state to itself", () => {
    @Component({
      selector: 'v-nested',
      render: compileTemplate(
        `<div class="outer" :ref="outerGroup" :spread="outer.groupProps()">` +
          `<div class="op0" :spread="outer.panelProps(0)"></div>` +
          `<div class="oh0" :spread="outer.handleProps(0)" ` +
          `:keydown="outer.onHandleKeyDown(0, $event)"></div>` +
          `<div class="op1" :spread="outer.panelProps(1)">` +
          `<div class="inner" :ref="innerGroup" :spread="inner.groupProps()">` +
          `<div class="ip0" :spread="inner.panelProps(0)"></div>` +
          `<div class="ih0" :spread="inner.handleProps(0)" ` +
          `:keydown="inner.onHandleKeyDown(0, $event)"></div>` +
          `<div class="ip1" :spread="inner.panelProps(1)"></div>` +
          `</div></div></div>`,
      ),
    })
    class Nested {
      outerGroup = new Signal.State<Element | null>(null);
      innerGroup = new Signal.State<Element | null>(null);
      outer = createResizable({ panels: [{}, {}], group: () => this.outerGroup.get() });
      inner = createResizable({
        panels: [{}, {}],
        orientation: 'vertical',
        group: () => this.innerGroup.get(),
      });
    }

    const handle = track(mount(Nested, host));
    flushSync();
    const { outer, inner } = handle.instance as Nested;

    // Distinct ids, or the inner handle's `aria-controls` would point at the
    // outer group's panel.
    expect(host.querySelector('.ip0')!.id).not.toBe(host.querySelector('.op0')!.id);
    expect(host.querySelector('.ih0')!.getAttribute('aria-controls')).toBe(
      host.querySelector('.ip0')!.id,
    );
    // The inner group is stacked, so it reports a horizontal line.
    expect(host.querySelector('.ih0')!.getAttribute('aria-orientation')).toBe('horizontal');
    expect(host.querySelector('.oh0')!.getAttribute('aria-orientation')).toBe('vertical');

    // A key inside the inner group bubbles through the outer one and must not
    // move it as well.
    key(host.querySelector('.ih0')!, 'ArrowDown');
    expect(inner.size(0)).toBe(51);
    expect(outer.size(0)).toBe(50);
  });
});
