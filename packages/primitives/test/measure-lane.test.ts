/**
 * Which phase the library's own measurements run in.
 *
 * The lane is worth nothing until the components use it: a scheduler that can
 * collapse every read in a flush into one forced layout, next to twenty
 * components that each read from a user effect, is the same number of layouts
 * as no lane at all. `strayReads` counts exactly that mistake, so a primitive
 * that goes back to measuring from `effect()` turns this file red.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import {
  Component,
  Signal,
  createRoot,
  effect,
  flushSync,
  getFlushMetrics,
  mount,
  resetFlushMetrics,
  type Dispose,
} from '@voltdev/core';
import { createCollapsible } from '../src/disclosure.ts';
import { createScrollArea } from '../src/layout.ts';
import { createCode } from '../src/display-extras.ts';
import { VIRTUAL_ITEM_ATTRIBUTE, createVirtualizer } from '../src/virtualizer.ts';
import { createTextarea } from '../src/inputs.ts';
import { createBreadcrumb } from '../src/navigation.ts';

let disposers: Dispose[] = [];
let elements: Element[] = [];

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  for (const el of elements) el.remove();
  elements = [];
  flushSync();
  vi.unstubAllGlobals();
});

function attach<T extends Element>(el: T): T {
  document.body.appendChild(el);
  elements.push(el);
  return el;
}

/** Build inside a root, then flush with the counters freshly zeroed. */
function measuring(build: () => void): void {
  disposers.push(
    createRoot((dispose) => {
      build();
      return dispose;
    }),
  );
  resetFlushMetrics();
  flushSync();
}

describe('the library measures from the measure lane', () => {
  it('reads a disclosure panel height without a stray layout', () => {
    const content = attach(document.createElement('div'));
    measuring(() => {
      createCollapsible({ content: () => content, defaultOpen: true });
    });

    expect(getFlushMetrics().strayReads).toBe(0);
  });

  it('reads the scroll area geometry without a stray layout', () => {
    const viewport = attach(document.createElement('div'));
    const inner = viewport.appendChild(document.createElement('div'));
    measuring(() => {
      createScrollArea({ viewport: () => viewport, content: () => inner });
    });

    // Six properties off one element, all inside the drain that paid for them.
    expect(getFlushMetrics().strayReads).toBe(0);
  });

  it('reads a code block overflow without a stray layout', () => {
    const pre = attach(document.createElement('pre'));
    measuring(() => {
      createCode({ block: true, pre: () => pre });
    });

    expect(getFlushMetrics().strayReads).toBe(0);
  });

  it('reads the virtualizer viewport and offset without a stray layout', () => {
    const scroller = attach(document.createElement('div'));
    measuring(() => {
      createVirtualizer({ scroller: () => scroller, count: () => 100, itemSize: 24 });
    });

    expect(getFlushMetrics().strayReads).toBe(0);
  });

  it('measures a collapsing breadcrumb without a stray layout', () => {
    @Component({
      selector: 'v-lane-trail',
      render: compileTemplate(`
        <ol :ref="list" :spread="crumbs.listProps()">
          <li :for="(name, i) in trail.get()" :key="name" :spread="crumbs.itemProps(i)">
            <a href="#" :spread="crumbs.linkProps(i)">{ name }</a>
          </li>
          <li :spread="crumbs.overflowProps()">
            <button :spread="crumbs.overflowTriggerProps()">…</button>
          </li>
        </ol>
      `),
    })
    class Trail {
      list = new Signal.State<Element | null>(null);
      trail = new Signal.State(['Home', 'Docs', 'Guides', 'Routing']);
      crumbs = createBreadcrumb({
        list: () => this.list.get(),
        count: () => this.trail.get().length,
      });
    }

    const handle = mount(Trail, attach(document.createElement('div')));
    disposers.push(() => handle.unmount());
    resetFlushMetrics();
    flushSync();

    // Every crumb, the overflow slot and the list itself, read on mount. The
    // crumbs have to be shown to be read, and showing them is a write, which
    // is exactly what the measure phase cannot do itself.
    expect(getFlushMetrics().strayReads).toBe(0);

    // The trail changing length is the other time it measures inside a flush.
    const trail = handle.instance as Trail;
    resetFlushMetrics();
    trail.trail.set([...trail.trail.get(), 'Params']);
    flushSync();
    expect(getFlushMetrics().strayReads).toBe(0);
  });

  it('corrects a jump into unmeasured rows without a stray layout', () => {
    // An observer that reports only what this test hands it: the correction
    // is driven by measurements arriving, and nothing else here lays out.
    let report: ResizeObserverCallback | null = null;
    class Observer {
      constructor(callback: ResizeObserverCallback) {
        report = callback;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    const view = window as unknown as { ResizeObserver: unknown };
    const original = view.ResizeObserver;
    view.ResizeObserver = Observer;

    try {
      const scroller = attach(document.createElement('div'));
      Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
      let rows!: ReturnType<typeof createVirtualizer>;
      measuring(() => {
        rows = createVirtualizer({
          scroller: () => scroller,
          count: () => 1000,
          itemSize: () => 20,
        });
      });

      // Aimed with estimates, from outside any flush, as a key press would.
      rows.scrollToIndex(500, { align: 'end' });
      flushSync();
      expect(scroller.scrollTop).toBe(9620);

      // Row 500 turns out to be forty tall, so the landing is twenty short.
      const row = scroller.appendChild(document.createElement('div'));
      row.setAttribute(VIRTUAL_ITEM_ATTRIBUTE, '500');
      const box = { blockSize: 40, inlineSize: 0 };
      report!(
        [{ target: row, borderBoxSize: [box] } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );

      resetFlushMetrics();
      flushSync();
      expect(scroller.scrollTop).toBe(9640);
      expect(getFlushMetrics().strayReads).toBe(0);
    } finally {
      view.ResizeObserver = original;
    }
  });

  it('charges a commanded scroll to the effect that asks for it', () => {
    const scroller = attach(document.createElement('div'));
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
    const target = new Signal.State(0);
    let rows!: ReturnType<typeof createVirtualizer>;

    measuring(() => {
      rows = createVirtualizer({
        scroller: () => scroller,
        count: () => 1000,
        itemSize: () => 20,
      });
      effect(() => {
        const index = target.get();
        if (index > 0) rows.scrollToIndex(index, { align: 'start' });
      });
    });

    resetFlushMetrics();
    target.set(500);
    flushSync();

    // Nothing the virtualizer runs on its own reads outside the lane, but
    // `scrollToIndex` reads the landing back — the browser clamps, and a smooth
    // scroll has not moved yet — so the effect that commands a scroll is the
    // one that pays for the read.
    expect(scroller.scrollTop).toBe(10000);
    expect(getFlushMetrics().strayReads).toBe(1);
  });

  it('autosizes a textarea without a stray layout', () => {
    // happy-dom answers yes to `field-sizing`, and the declaration measures
    // nothing. The fallback is the path with a read in it.
    vi.stubGlobal('CSS', { supports: () => false });
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = attach(document.createElement('textarea'));
    const value = new Signal.State('');

    measuring(() => {
      createTextarea({ input: () => el, value });
    });
    expect(getFlushMetrics().strayReads).toBe(0);

    resetFlushMetrics();
    value.set('typed something considerably longer');
    flushSync();

    // The reset, the read and the write are three phases of one measurement,
    // and the read is the only one that costs a layout.
    expect(getFlushMetrics().strayReads).toBe(0);
    expect(getFlushMetrics().forcedLayouts).toBe(1);
    // Both writes are render effects. Putting either of them beside the read
    // — which is where they were — is what the drain's guard reports.
    expect(reported).not.toHaveBeenCalled();
    reported.mockRestore();
  });
});
