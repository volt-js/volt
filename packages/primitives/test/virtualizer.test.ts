/**
 * Virtualizer, driven through real mounted components.
 *
 * The interesting behaviour is all in the seams: what happens at the ends of
 * the collection, when the count changes under a scrolled window, when an
 * estimate turns out to be wrong above the fold, and what assistive technology
 * is told about items that are not in the DOM at all. Those are what this
 * covers; that a list renders some rows is the easy part.
 *
 * `ResizeObserver` is replaced with one that delivers exactly the entries a
 * test asks it to. Measurement is otherwise the environment's to schedule, and
 * a test that cannot say *when* a measurement lands cannot test the thing that
 * goes wrong when it lands late.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, flushSync, mount } from '@voltdev/core';
import {
  VIRTUAL_ITEM_ATTRIBUTE,
  createVirtualizer,
  type Virtualizer,
  type VirtualRange,
  type VirtualizerOptions,
} from '../src/virtualizer.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Measurement {
  target: Element;
  /** Height, in a horizontal writing mode. */
  block: number;
  /** Width. */
  inline: number;
}

/**
 * A ResizeObserver that only reports what a test hands it.
 *
 * Sizes are given per axis rather than as one number, so a virtualizer reading
 * the wrong one gets an obviously wrong answer instead of a plausible one.
 */
class FakeResizeObserver {
  static live: FakeResizeObserver[] = [];

  readonly targets = new Set<Element>();
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.live.push(this);
  }

  observe(el: Element): void {
    this.targets.add(el);
  }

  unobserve(el: Element): void {
    this.targets.delete(el);
  }

  disconnect(): void {
    this.targets.clear();
    this.disconnected = true;
  }

  deliver(measurements: Measurement[]): void {
    const entries = measurements.map(({ target, block, inline }) => {
      const box: ResizeObserverSize = { blockSize: block, inlineSize: inline };
      return {
        target,
        borderBoxSize: [box],
        contentBoxSize: [box],
        devicePixelContentBoxSize: [box],
      } as unknown as ResizeObserverEntry;
    });
    this.callback(entries, this as unknown as ResizeObserver);
    flushSync();
  }
}

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;

/** Options for the component that the next `mountList` will build. */
let listOptions: Omit<VirtualizerOptions, 'scroller' | 'container'>;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;

  FakeResizeObserver.live = [];
  const view = window as unknown as { ResizeObserver: unknown };
  const original = view.ResizeObserver;
  view.ResizeObserver = FakeResizeObserver;
  restores.push(() => {
    view.ResizeObserver = original;
  });

  listOptions = { count: () => 1000, itemSize: 20 };
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
});

const TEMPLATE = `
  <div class="collection" :spread="v.countProps()">
    <div class="scroller" :ref="scroller" :spread="v.scrollerProps()" :keydown="onKey($event)">
      <div class="sizer" :spread="v.sizerProps()">
        <div class="box" :ref="box" :spread="v.containerProps()">
          <div class="row" :for="item in v.items()" :key="item.key"
               :spread="v.itemProps(item.index)">row { item.index }</div>
        </div>
      </div>
    </div>
    <div class="status" :spread="v.statusProps()">{ v.status() }</div>
  </div>
`;

interface ListInstance {
  v: Virtualizer;
  /** What `onKeyDown` returned for the last key the scroller saw. */
  handled: boolean;
  onKey(event: KeyboardEvent): void;
}

interface List {
  v: Virtualizer;
  instance: ListInstance;
  handle: { unmount(): void };
  observer: FakeResizeObserver;
  scroller: HTMLElement;
  box: HTMLElement;
  sizer: HTMLElement;
  status: HTMLElement;
  collection: HTMLElement;
  rows(): HTMLElement[];
  indexes(): number[];
  row(index: number): HTMLElement | null;
}

/**
 * Mount a list whose scroller has a known client box.
 *
 * The box is stubbed between mounting and the first flush, because that is
 * when the virtualizer first reads it — happy-dom lays nothing out, so an
 * unstubbed scroller is a zero-height one.
 */
function mountList({ height = 100, width = 0 } = {}): List {
  @Component({ selector: `v-list-${++selectors}`, render: compileTemplate(TEMPLATE) })
  class ListComponent {
    scroller = new Signal.State<Element | null>(null);
    box = new Signal.State<Element | null>(null);
    handled = false;
    v = createVirtualizer({
      ...listOptions,
      scroller: () => this.scroller.get(),
      container: () => this.box.get(),
    });

    onKey(event: KeyboardEvent): void {
      this.handled = this.v.onKeyDown(event);
      if (this.handled) event.preventDefault();
    }
  }

  const handle = mount(ListComponent, host);
  mounted.push(handle);

  const scroller = host.querySelector<HTMLElement>('.scroller')!;
  stubBox(scroller, height, width);

  // The scroller's size then arrives the way it does in a browser: through the
  // observer, after layout. Mounting already flushed, so this is the only way
  // in — and it is the real one.
  const observer = FakeResizeObserver.live.at(-1)!;
  observer.deliver([{ target: scroller, block: height, inline: width }]);

  const instance = handle.instance as ListInstance;
  return {
    handle,
    instance,
    v: instance.v,
    observer,
    scroller,
    box: host.querySelector<HTMLElement>('.box')!,
    sizer: host.querySelector<HTMLElement>('.sizer')!,
    status: host.querySelector<HTMLElement>('.status')!,
    collection: host.querySelector<HTMLElement>('.collection')!,
    rows: () => [...host.querySelectorAll<HTMLElement>('.row')],
    indexes: () =>
      [...host.querySelectorAll<HTMLElement>('.row')].map((row) =>
        Number(row.getAttribute(VIRTUAL_ITEM_ATTRIBUTE)),
      ),
    row: (index) => host.querySelector<HTMLElement>(`[${VIRTUAL_ITEM_ATTRIBUTE}="${index}"]`),
  };
}

function stubBox(el: Element, height: number, width: number): void {
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
}

/** A scroll the reader performed. happy-dom fires no event of its own. */
function userScroll(el: HTMLElement, offset: number, axis: 'y' | 'x' = 'y'): void {
  if (axis === 'y') el.scrollTop = offset;
  else el.scrollLeft = offset;
  el.dispatchEvent(new Event('scroll'));
  flushSync();
}

function press(el: HTMLElement, key: string, modifiers: Partial<KeyboardEventInit> = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  el.dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

// ---------------------------------------------------------------------------

describe('the window', () => {
  it('renders a handful of a thousand rows, with overscan around them', () => {
    const list = mountList();

    // Five rows fill a hundred pixels; two more each way are the overscan.
    expect(list.indexes()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(list.v.range()).toEqual({
      startIndex: 0,
      endIndex: 6,
      visibleStartIndex: 0,
      visibleEndIndex: 4,
    } satisfies VirtualRange);
  });

  it('sizes the spacer to the whole collection, not to what is rendered', () => {
    const list = mountList();
    expect(list.sizer.style.height).toBe('20000px');
  });

  it('moves the window with one transform rather than positioning each row', () => {
    const list = mountList();
    expect(list.box.style.transform).toBe('translateY(0px)');
    // No row carries a position of its own.
    expect(list.rows().every((row) => row.style.top === '')).toBe(true);

    userScroll(list.scroller, 500);
    expect(list.indexes()[0]).toBe(23);
    expect(list.box.style.transform).toBe('translateY(460px)');
  });

  it('does not pull in the row that starts exactly at the bottom edge', () => {
    const list = mountList();
    // The viewport ends at 100, where row 5 begins; it is not on screen.
    expect(list.v.range().visibleEndIndex).toBe(4);
  });

  it('clips the overscan at both ends instead of running off them', () => {
    listOptions = { count: () => 1000, itemSize: 20, overscan: 5 };
    const list = mountList();
    expect(list.indexes()[0]).toBe(0);

    userScroll(list.scroller, 19_900);
    const indexes = list.indexes();
    expect(indexes[0]).toBe(990);
    expect(indexes.at(-1)).toBe(999);
  });

  it('takes overscan separately for each direction', () => {
    listOptions = { count: () => 1000, itemSize: 20, overscan: { before: 4, after: 0 } };
    const list = mountList();

    userScroll(list.scroller, 500);
    expect(list.indexes()[0]).toBe(21);
    expect(list.indexes().at(-1)).toBe(29);
  });

  it('keeps the scroller out of the browser scroll anchoring it fights with', () => {
    const list = mountList();
    // Both would compensate for content resizing above the viewport, by
    // different amounts, and the list would drift as it was scrolled up.
    expect(list.scroller.style.getPropertyValue('overflow-anchor')).toBe('none');
  });

  it('renders the first row before the scroller has been measured', () => {
    // A zero-height scroller is what a list in a hidden tab looks like. It has
    // to render something, or there is nothing to measure and it stays empty.
    const list = mountList({ height: 0 });
    expect(list.indexes()).toEqual([0, 1, 2]);
  });

  it('renders nothing at all for an empty collection', () => {
    listOptions = { count: () => 0, itemSize: 20 };
    const list = mountList();

    expect(list.rows()).toEqual([]);
    expect(list.sizer.style.height).toBe('0px');
    expect(list.box.style.transform).toBe('translateY(0px)');
    expect(list.v.totalSize()).toBe(0);
    expect(list.v.range().startIndex).toBe(-1);
    expect(list.v.indexAt(0)).toBe(-1);
  });

  it('survives being asked to scroll an empty collection', () => {
    listOptions = { count: () => 0, itemSize: 20 };
    const list = mountList();

    list.v.scrollToIndex(5, { align: 'start' });
    flushSync();
    expect(list.scroller.scrollTop).toBe(0);
    expect(press(list.scroller, 'End')).toBe(false);
  });

  it('works with no scroller element at all', () => {
    // Construction must not touch the DOM: the ref is null until the template
    // has rendered, and on a server it never arrives.
    createRoot((dispose) => {
      const v = createVirtualizer({ scroller: () => null, count: () => 50, itemSize: 20 });
      expect(v.totalSize()).toBe(1000);
      expect(v.items().map((item) => item.index)).toEqual([0, 1, 2]);
      v.scrollToIndex(10, { align: 'start' });
      expect(v.scrollOffset()).toBe(0);
      dispose();
    });
  });
});

describe('gaps between items', () => {
  it('counts the gap between items but not after the last one', () => {
    listOptions = { count: () => 10, itemSize: 20, gap: 10 };
    const list = mountList();

    expect(list.v.totalSize()).toBe(290);
    expect(list.v.offsetOf(3)).toBe(90);
    expect(list.v.indexAt(95)).toBe(3);
  });
});

describe('what assistive technology is told', () => {
  it('gives each row its position in the collection, not in the window', () => {
    const list = mountList();
    userScroll(list.scroller, 500);

    const row = list.row(25)!;
    // The bug this exists to prevent: announcing "3 of 9" — the row's place in
    // the rendered window — when it is the twenty-sixth of a thousand.
    expect(row.getAttribute('aria-posinset')).toBe('26');
    expect(row.getAttribute('aria-setsize')).toBe('1000');
  });

  it('keeps the set size honest when the collection changes length', () => {
    const count = new Signal.State(1000);
    listOptions = { count: () => count.get(), itemSize: 20 };
    const list = mountList();

    count.set(12);
    flushSync();
    expect(list.row(0)!.getAttribute('aria-setsize')).toBe('12');
  });

  it('counts rows for a grid, allowing for the header row above them', () => {
    listOptions = { count: () => 1000, itemSize: 20, counting: 'row', indexBase: 2 };
    const list = mountList();

    // aria-rowindex counts every row on screen, and row 1 is the header the
    // grid renders itself.
    expect(list.row(0)!.getAttribute('aria-rowindex')).toBe('2');
    expect(list.row(0)!.hasAttribute('aria-posinset')).toBe(false);
    expect(list.collection.getAttribute('aria-rowcount')).toBe('1001');
  });

  it('counts columns for the other axis of a grid', () => {
    listOptions = { count: () => 40, itemSize: 20, axis: 'horizontal', counting: 'column' };
    const list = mountList({ height: 0, width: 100 });

    expect(list.row(0)!.getAttribute('aria-colindex')).toBe('1');
    expect(list.collection.getAttribute('aria-colcount')).toBe('40');
  });

  it('says nothing at all when the items are not a set', () => {
    listOptions = { count: () => 1000, itemSize: 20, counting: 'none' };
    const list = mountList();

    const row = list.row(0)!;
    for (const name of ['aria-setsize', 'aria-posinset', 'aria-rowindex', 'aria-colindex']) {
      expect(row.hasAttribute(name)).toBe(false);
    }
    expect(list.collection.hasAttribute('aria-rowcount')).toBe(false);
  });

  it('leaves the set count off the collection, where it would be a second answer', () => {
    const list = mountList();
    expect(list.collection.hasAttribute('aria-rowcount')).toBe(false);
    expect(list.collection.hasAttribute('aria-colcount')).toBe(false);
  });

  it('offers a live region describing the window, overridable and off by default', () => {
    const list = mountList();
    expect(list.status.getAttribute('role')).toBe('status');
    expect(list.status.textContent).toBe('Items 1 to 5 of 1000');

    userScroll(list.scroller, 500);
    expect(list.status.textContent).toBe('Items 26 to 30 of 1000');
  });

  it('takes every string from labels', () => {
    listOptions = {
      count: () => 0,
      itemSize: 20,
      labels: {
        range: (first, last, count) => `${first}–${last} / ${count}`,
        empty: 'Rien',
      },
    };
    const list = mountList();
    expect(list.status.textContent).toBe('Rien');
  });

  it('keeps the scroller out of the tab order unless it is asked for', () => {
    const plain = mountList();
    expect(plain.scroller.hasAttribute('tabindex')).toBe(false);

    listOptions = { count: () => 1000, itemSize: 20, focusable: true };
    const focusable = mountList();
    // A region that scrolls and cannot be focused cannot be scrolled from the
    // keyboard — but a listbox is focusable already, and a second tab stop on
    // it would be worse than none.
    expect(focusable.scroller.getAttribute('tabindex')).toBe('0');
  });
});

describe('the keyboard map', () => {
  it('goes to the first and last items with Home and End', () => {
    const list = mountList();
    userScroll(list.scroller, 4000);

    expect(press(list.scroller, 'End')).toBe(true);
    expect(list.scroller.scrollTop).toBe(19_900);
    expect(list.indexes().at(-1)).toBe(999);

    expect(press(list.scroller, 'Home')).toBe(true);
    expect(list.scroller.scrollTop).toBe(0);
    expect(list.indexes()[0]).toBe(0);
  });

  it('pages by a viewport, and stops at the ends', () => {
    const list = mountList();

    press(list.scroller, 'PageDown');
    expect(list.scroller.scrollTop).toBe(100);
    press(list.scroller, 'PageDown');
    expect(list.scroller.scrollTop).toBe(200);

    press(list.scroller, 'PageUp');
    expect(list.scroller.scrollTop).toBe(100);
    press(list.scroller, 'PageUp');
    press(list.scroller, 'PageUp');
    expect(list.scroller.scrollTop).toBe(0);
  });

  it('steps by whole items with the arrows', () => {
    const list = mountList();

    expect(press(list.scroller, 'ArrowDown')).toBe(true);
    expect(list.scroller.scrollTop).toBe(20);
    press(list.scroller, 'ArrowDown');
    expect(list.scroller.scrollTop).toBe(40);

    press(list.scroller, 'ArrowUp');
    expect(list.scroller.scrollTop).toBe(20);
    press(list.scroller, 'ArrowUp');
    press(list.scroller, 'ArrowUp');
    expect(list.scroller.scrollTop).toBe(0);
  });

  it('ignores the arrows of the axis it does not own', () => {
    const list = mountList();
    expect(press(list.scroller, 'ArrowRight')).toBe(false);
    expect(list.scroller.scrollTop).toBe(0);
  });

  it('leaves modified keys alone, because they are shortcuts', () => {
    const list = mountList();
    userScroll(list.scroller, 500);

    expect(press(list.scroller, 'End', { ctrlKey: true })).toBe(false);
    expect(press(list.scroller, 'Home', { metaKey: true })).toBe(false);
    expect(press(list.scroller, 'ArrowDown', { altKey: true })).toBe(false);
    expect(list.scroller.scrollTop).toBe(500);
  });

  it('leaves a key alone that something inside it has already handled', () => {
    const list = mountList();
    userScroll(list.scroller, 500);

    // A toolbar in a row takes Home and End for its own buttons, and says so.
    // Scrolling the whole list to the top as well would be two answers to one
    // key.
    const toolbar = list.row(26)!.appendChild(document.createElement('div'));
    toolbar.addEventListener('keydown', (event) => event.preventDefault());
    press(toolbar, 'Home');

    expect(list.instance.handled).toBe(false);
    expect(list.scroller.scrollTop).toBe(500);
  });

  it('answers only keys pressed on the scroller itself', () => {
    const list = mountList();
    userScroll(list.scroller, 500);

    // Home in a text field inside a row moves the caret, and nobody has to
    // prevent anything for that to be what it means.
    const field = list.row(26)!.appendChild(document.createElement('input'));
    expect(press(field, 'Home')).toBe(false);
    expect(press(field, 'ArrowDown')).toBe(false);

    expect(list.instance.handled).toBe(false);
    expect(list.scroller.scrollTop).toBe(500);
  });

  it('does not claim keys it has no use for', () => {
    const list = mountList();
    expect(press(list.scroller, 'a')).toBe(false);
    expect(press(list.scroller, 'Enter')).toBe(false);
    expect(press(list.scroller, 'Tab')).toBe(false);
  });

  it('steps sideways on a horizontal collection', () => {
    listOptions = { count: () => 1000, itemSize: 20, axis: 'horizontal' };
    const list = mountList({ height: 0, width: 100 });

    expect(press(list.scroller, 'ArrowRight')).toBe(true);
    expect(list.scroller.scrollLeft).toBe(20);
    expect(press(list.scroller, 'ArrowLeft')).toBe(true);
    expect(list.scroller.scrollLeft).toBe(0);

    // Down and up belong to the other axis, whichever way this one runs.
    expect(press(list.scroller, 'ArrowDown')).toBe(false);
    expect(list.scroller.scrollLeft).toBe(0);
  });

  it('mirrors the horizontal arrows under dir="rtl"', () => {
    host.setAttribute('dir', 'rtl');
    listOptions = { count: () => 1000, itemSize: 20, axis: 'horizontal' };
    const list = mountList({ height: 0, width: 100 });

    // Forwards is leftwards, and the DOM reports the distance as negative.
    expect(press(list.scroller, 'ArrowLeft')).toBe(true);
    expect(list.scroller.scrollLeft).toBe(-20);
    expect(list.v.scrollOffset()).toBe(20);

    expect(press(list.scroller, 'ArrowRight')).toBe(true);
    expect(list.v.scrollOffset()).toBe(0);
  });
});

describe('a horizontal collection', () => {
  it('measures, sizes and transforms along its own axis', () => {
    listOptions = { count: () => 100, itemSize: 25, axis: 'horizontal' };
    const list = mountList({ height: 0, width: 100 });

    expect(list.sizer.style.width).toBe('2500px');
    expect(list.sizer.style.height).toBe('');
    expect(list.row(0)!.style.width).toBe('25px');

    userScroll(list.scroller, 500, 'x');
    expect(list.indexes()[0]).toBe(18);
    expect(list.box.style.transform).toBe('translateX(450px)');
  });

  it('reads a negative RTL scroll offset as a distance, and puts the sign back', () => {
    host.setAttribute('dir', 'rtl');
    listOptions = { count: () => 100, itemSize: 25, axis: 'horizontal' };
    const list = mountList({ height: 0, width: 100 });

    userScroll(list.scroller, -500, 'x');
    expect(list.v.scrollOffset()).toBe(500);
    expect(list.indexes()[0]).toBe(18);
    // The window moves the other way, because a transform does not mirror.
    expect(list.box.style.transform).toBe('translateX(-450px)');
  });
});

describe('the fixed-size fast path', () => {
  it('never observes a single row', () => {
    const list = mountList();

    // One observer, and the only thing it watches is the scroller: a promised
    // size is not measured, however many rows there are.
    expect(FakeResizeObserver.live).toHaveLength(1);
    expect([...list.observer.targets]).toEqual([list.scroller]);
  });

  it('states the promised size back on every row', () => {
    const list = mountList();
    // The window's arithmetic is only true while the rows really are this
    // size, so the size the caller promised is the size they get.
    expect(list.row(0)!.style.height).toBe('20px');
    expect(list.v.items()[0]!.measured).toBe(false);
  });

  it('refuses to remeasure, because there is nothing to measure', () => {
    const list = mountList();
    list.v.remeasure();
    flushSync();
    expect(list.v.totalSize()).toBe(20_000);
  });
});

describe('measuring what was only estimated', () => {
  beforeEach(() => {
    listOptions = { count: () => 100, itemSize: () => 20 };
  });

  it('observes every rendered row with one shared observer', () => {
    const list = mountList();

    expect(FakeResizeObserver.live).toHaveLength(1);
    // Seven rows and the scroller.
    expect(list.observer.targets.size).toBe(8);
    for (const row of list.rows()) expect(list.observer.targets.has(row)).toBe(true);
  });

  it('lets go of rows that scroll out of the window', () => {
    const list = mountList();
    const first = list.row(0)!;

    userScroll(list.scroller, 500);
    expect(list.observer.targets.has(first)).toBe(false);
    expect(list.observer.targets.size).toBe(10);
  });

  it('corrects the estimate, and the whole collection with it', () => {
    const list = mountList();
    const rows = list.rows();

    list.observer.deliver(rows.map((target) => ({ target, block: 40, inline: 999 })));

    // Seven rows at forty, ninety-three still estimated at twenty.
    expect(list.v.totalSize()).toBe(2140);
    expect(list.v.sizeOf(0)).toBe(40);
    expect(list.v.offsetOf(2)).toBe(80);
    expect(list.v.items()[0]!.measured).toBe(true);
    // Rows are twice as tall, so half as many fit.
    expect(list.v.range().visibleEndIndex).toBe(2);
  });

  it('reads the axis it scrolls, not the one it does not', () => {
    const list = mountList();
    // A row that is 40 wide and 20 tall does not change a vertical list.
    list.observer.deliver([{ target: list.row(0)!, block: 20, inline: 40 }]);
    expect(list.v.sizeOf(0)).toBe(20);
    expect(list.v.totalSize()).toBe(2000);
  });

  it('ignores a row that has no box, rather than collapsing the list under it', () => {
    const list = mountList();
    const hidden = list.row(3)!;
    hidden.checkVisibility = () => false;

    list.observer.deliver([
      { target: list.row(0)!, block: 40, inline: 999 },
      // A hidden row measures zero, and a zero here would drag everything
      // below it up and then back down when it reappears.
      { target: hidden, block: 0, inline: 0 },
    ]);

    expect(list.v.sizeOf(0)).toBe(40);
    expect(list.v.sizeOf(3)).toBe(20);
  });

  it('keeps the view still when a row above it turns out to be taller', () => {
    const list = mountList();
    userScroll(list.scroller, 400);
    // Rows 18 and 19 sit above the fold, at 360 and 380.
    expect(list.v.offsetOf(20)).toBe(400);

    list.observer.deliver([
      { target: list.row(18)!, block: 40, inline: 999 },
      { target: list.row(19)!, block: 40, inline: 999 },
    ]);

    // Both grew by twenty, so what the reader is looking at would have been
    // pushed forty pixels down the page. The scroller follows it instead.
    expect(list.scroller.scrollTop).toBe(440);
    expect(list.v.offsetOf(20)).toBe(440);
    expect(list.v.range().visibleStartIndex).toBe(20);
  });

  it('does not chase a row that grows below the fold', () => {
    const list = mountList();
    userScroll(list.scroller, 400);

    list.observer.deliver([{ target: list.row(22)!, block: 40, inline: 999 }]);
    expect(list.scroller.scrollTop).toBe(400);
  });

  it('measures against a fixed first guess when asked to', () => {
    listOptions = { count: () => 100, itemSize: 20, measure: true };
    const list = mountList();

    expect(list.observer.targets.size).toBe(8);
    // Nothing states a height back: these rows are measured, not promised.
    expect(list.row(0)!.style.height).toBe('');

    list.observer.deliver([{ target: list.row(0)!, block: 50, inline: 999 }]);
    expect(list.v.totalSize()).toBe(2030);
  });

  it('does not observe a variable list that says its sizes are known', () => {
    listOptions = {
      count: () => 100,
      itemSize: (index) => (index % 2 === 0 ? 20 : 40),
      measure: false,
    };
    const list = mountList();

    expect([...list.observer.targets]).toEqual([list.scroller]);
    expect(list.v.totalSize()).toBe(3000);
    expect(list.v.offsetOf(3)).toBe(80);
  });

  it('takes measurements again when told to forget them', () => {
    const list = mountList();
    list.observer.deliver([{ target: list.row(0)!, block: 40, inline: 999 }]);
    expect(list.v.sizeOf(0)).toBe(40);

    list.v.remeasure(0);
    flushSync();
    expect(list.v.sizeOf(0)).toBe(20);
    // Re-observed, so the observer will report the row again rather than stay
    // silent about a size that never changed.
    expect(list.observer.targets.has(list.row(0)!)).toBe(true);
  });

  it('counts a gap that no measurement can see', () => {
    listOptions = { count: () => 5, itemSize: () => 20, gap: 10 };
    const list = mountList();

    list.observer.deliver([{ target: list.row(0)!, block: 50, inline: 999 }]);
    // A border box does not include the gap after it, so the gap has to be
    // added back: 50 + 10, then four more at 20 + 10, less the last gap.
    expect(list.v.totalSize()).toBe(170);
    expect(list.v.offsetOf(1)).toBe(60);
  });
});

describe('measurements and item identity', () => {
  it('follows the key when the collection grows at the front', () => {
    const ids = new Signal.State(['a', 'b', 'c']);
    listOptions = {
      count: () => ids.get().length,
      itemSize: () => 20,
      getItemKey: (index) => ids.get()[index] ?? index,
    };
    const list = mountList();
    list.observer.deliver(
      list.rows().map((target) => ({ target, block: 40, inline: 999 })),
    );
    expect(list.v.sizeOf(0)).toBe(40);

    ids.set(['z', 'a', 'b', 'c']);
    flushSync();

    // The new item is the only unmeasured one; a and b did not change height
    // by being pushed down the list.
    expect(list.v.sizeOf(0)).toBe(20);
    expect(list.v.sizeOf(1)).toBe(40);
    expect(list.v.totalSize()).toBe(140);
  });

  it('moves measurements with their keys when the collection is reordered', () => {
    const ids = new Signal.State(['a', 'b', 'c']);
    listOptions = {
      count: () => ids.get().length,
      itemSize: () => 20,
      getItemKey: (index) => ids.get()[index] ?? index,
    };
    const list = mountList();
    list.observer.deliver([{ target: list.row(0)!, block: 50, inline: 999 }]);
    expect(list.v.sizeOf(0)).toBe(50);

    // The same three items in another order. Nothing about the count says
    // anything moved, and a is second now.
    ids.set(['b', 'a', 'c']);
    flushSync();

    expect(list.v.sizeOf(0)).toBe(20);
    expect(list.v.sizeOf(1)).toBe(50);
    expect(list.v.offsetOf(2)).toBe(70);
    expect(list.v.items()[1]!.measured).toBe(true);
  });

  it('follows an estimate that changes, as it follows the keys', () => {
    const rowHeight = new Signal.State(20);
    listOptions = { count: () => 3, itemSize: () => rowHeight.get() };
    const list = mountList();
    expect(list.v.totalSize()).toBe(60);

    // Rebuilding asks every item for its size, so the collection is subscribed
    // to whatever a function `itemSize` reads. An estimate narrowed as the page
    // learns — a chat working out what an average message costs — moves the
    // scrollbar without anybody having to call `remeasure()`.
    rowHeight.set(30);
    flushSync();

    expect(list.v.totalSize()).toBe(90);
  });

  it('keeps the size of an item that leaves and comes back', () => {
    const ids = new Signal.State(['a', 'b', 'c']);
    listOptions = {
      count: () => ids.get().length,
      itemSize: () => 20,
      getItemKey: (index) => ids.get()[index] ?? index,
    };
    const list = mountList();
    list.observer.deliver([{ target: list.row(0)!, block: 50, inline: 999 }]);

    // A filter narrowing the list, then cleared.
    ids.set(['c']);
    flushSync();
    ids.set(['a', 'b', 'c']);
    flushSync();
    expect(list.v.sizeOf(0)).toBe(50);
  });

  it('lets go of the sizes of items that are gone once they far outnumber the rest', () => {
    const ids = new Signal.State(['a0', 'a1', 'a2']);
    listOptions = {
      count: () => ids.get().length,
      itemSize: () => 20,
      getItemKey: (index) => ids.get()[index] ?? index,
    };
    const list = mountList();
    const measureAll = () =>
      list.observer.deliver(list.rows().map((target) => ({ target, block: 50, inline: 999 })));

    // One conversation after another, each one measured as it is read. Every
    // switch leaves three sizes behind for ids that are not coming back.
    measureAll();
    for (const prefix of ['b', 'c', 'd']) {
      ids.set([0, 1, 2].map((i) => `${prefix}${i}`));
      flushSync();
      measureAll();
    }
    ids.set(['a0', 'a1', 'a2']);
    flushSync();

    // Four conversations' worth of sizes, for a collection that has never held
    // more than three items: the cache let go of the ids that had gone rather
    // than only ever growing, so the first conversation is estimates again.
    expect(list.v.sizeOf(0)).toBe(20);
    expect(list.v.items()[0]!.measured).toBe(false);
  });

  it('keys by index without one, which is right for appending', () => {
    const count = new Signal.State(3);
    listOptions = { count: () => count.get(), itemSize: () => 20 };
    const list = mountList();
    list.observer.deliver(
      list.rows().map((target) => ({ target, block: 40, inline: 999 })),
    );

    count.set(5);
    flushSync();
    expect(list.v.sizeOf(0)).toBe(40);
    expect(list.v.sizeOf(4)).toBe(20);
  });
});

describe('scrolling to an index', () => {
  it('aligns to the start, the centre and the end', () => {
    const list = mountList();

    list.v.scrollToIndex(50, { align: 'start' });
    flushSync();
    expect(list.scroller.scrollTop).toBe(1000);

    list.v.scrollToIndex(50, { align: 'center' });
    flushSync();
    expect(list.scroller.scrollTop).toBe(960);

    list.v.scrollToIndex(50, { align: 'end' });
    flushSync();
    expect(list.scroller.scrollTop).toBe(920);
  });

  it('moves as little as possible for nearest, and not at all when it need not', () => {
    const list = mountList();

    // Below the fold: bring its bottom edge up to the viewport's.
    list.v.scrollToIndex(10, { align: 'nearest' });
    flushSync();
    expect(list.scroller.scrollTop).toBe(120);

    // Already whole and on screen: leave it exactly where it is.
    list.v.scrollToIndex(8, { align: 'nearest' });
    flushSync();
    expect(list.scroller.scrollTop).toBe(120);

    // Above the fold: bring its top edge down to the viewport's.
    list.v.scrollToIndex(2, { align: 'nearest' });
    flushSync();
    expect(list.scroller.scrollTop).toBe(40);
  });

  it('clamps at both ends of the collection', () => {
    const list = mountList();

    // Centring the first item would ask for a negative offset.
    list.v.scrollToIndex(0, { align: 'center' });
    flushSync();
    expect(list.scroller.scrollTop).toBe(0);

    // Starting the last item would ask to scroll past the end.
    list.v.scrollToIndex(999, { align: 'start' });
    flushSync();
    expect(list.scroller.scrollTop).toBe(19_900);
  });

  it('clamps an index that is not in the collection', () => {
    const list = mountList();

    list.v.scrollToIndex(5000, { align: 'start' });
    flushSync();
    expect(list.scroller.scrollTop).toBe(19_900);

    list.v.scrollToIndex(-5, { align: 'start' });
    flushSync();
    expect(list.scroller.scrollTop).toBe(0);
  });

  it('scrolls to a raw offset, clamped the same way', () => {
    const list = mountList();

    list.v.scrollToOffset(640);
    flushSync();
    expect(list.scroller.scrollTop).toBe(640);

    list.v.scrollToOffset(1e9);
    flushSync();
    expect(list.scroller.scrollTop).toBe(19_900);
  });

  it('corrects a jump once the rows it landed on have been measured', () => {
    listOptions = { count: () => 1000, itemSize: () => 20 };
    const list = mountList({ height: 400 });

    list.v.scrollToIndex(500, { align: 'end' });
    flushSync();
    // Aimed with estimates: twenty tall, so its foot is at 10020.
    expect(list.scroller.scrollTop).toBe(9620);

    // It is forty tall, so the alignment it was asked for is twenty out.
    list.observer.deliver([{ target: list.row(500)!, block: 40, inline: 999 }]);

    expect(list.scroller.scrollTop).toBe(9640);
    expect(list.v.offsetOf(500) + list.v.sizeOf(500)).toBe(9640 + 400);
  });

  it('gives up on the correction the moment the reader scrolls', () => {
    listOptions = { count: () => 1000, itemSize: () => 20 };
    const list = mountList({ height: 400 });

    list.v.scrollToIndex(500, { align: 'end' });
    flushSync();
    expect(list.scroller.scrollTop).toBe(9620);

    userScroll(list.scroller, 9600);
    list.observer.deliver([{ target: list.row(500)!, block: 40, inline: 999 }]);

    // Dragging someone back to where they were sent is worse than landing a
    // few pixels out.
    expect(list.scroller.scrollTop).toBe(9600);
  });
});

describe('the collection changing under a scrolled window', () => {
  it('shows the end of a list that has shrunk past the scroll position', () => {
    const count = new Signal.State(1000);
    listOptions = { count: () => count.get(), itemSize: 20 };
    const list = mountList();
    userScroll(list.scroller, 500);

    count.set(3);
    flushSync();

    // Not an empty window: the scroll offset is now past the end, and the last
    // rows are what should be there.
    expect(list.indexes()).toEqual([0, 1, 2]);
    expect(list.sizer.style.height).toBe('60px');
  });

  it('empties out and comes back', () => {
    const count = new Signal.State(1000);
    listOptions = { count: () => count.get(), itemSize: 20 };
    const list = mountList();

    count.set(0);
    flushSync();
    expect(list.rows()).toEqual([]);
    expect(list.status.textContent).toBe('No items');

    count.set(50);
    flushSync();
    expect(list.indexes()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(list.v.totalSize()).toBe(1000);
  });

  it('reports every change of window once', () => {
    const onRangeChange = vi.fn<(range: VirtualRange) => void>();
    listOptions = { count: () => 1000, itemSize: 20, onRangeChange };
    const list = mountList();

    // Twice already: the first window, and then the wider one that the
    // scroller's measured height allowed.
    expect(onRangeChange).toHaveBeenCalledTimes(2);
    expect(onRangeChange.mock.lastCall?.[0].endIndex).toBe(6);

    userScroll(list.scroller, 481);
    expect(onRangeChange).toHaveBeenCalledTimes(3);
    expect(onRangeChange.mock.lastCall?.[0].startIndex).toBe(22);

    // Nine pixels later the same rows are still the right ones, and nothing is
    // reported: an infinite list that loaded a page per scroll event would
    // load every page.
    userScroll(list.scroller, 490);
    expect(onRangeChange).toHaveBeenCalledTimes(3);

    userScroll(list.scroller, 500);
    expect(onRangeChange).toHaveBeenCalledTimes(4);
    expect(onRangeChange.mock.lastCall?.[0].startIndex).toBe(23);
  });
});

describe('the scroller changing size', () => {
  it('renders more rows when it grows', () => {
    const list = mountList();
    expect(list.indexes()).toHaveLength(7);

    stubBox(list.scroller, 300, 0);
    list.observer.deliver([{ target: list.scroller, block: 300, inline: 0 }]);

    expect(list.indexes()).toHaveLength(17);
    expect(list.v.viewportSize()).toBe(300);
  });

  it('keeps an End that was aimed at the old size honest', () => {
    const list = mountList();
    press(list.scroller, 'End');
    expect(list.scroller.scrollTop).toBe(19_900);

    stubBox(list.scroller, 300, 0);
    list.observer.deliver([{ target: list.scroller, block: 300, inline: 0 }]);

    // The browser clamps the scroll itself; what matters is that the window
    // still ends on the last row rather than off the end of the collection.
    expect(list.indexes().at(-1)).toBe(999);
  });
});

describe('teardown', () => {
  it('disconnects the observer and stops listening', () => {
    const list = mountList();
    const scroller = list.scroller;

    list.handle.unmount();
    mounted = mounted.filter((handle) => handle !== list.handle);
    flushSync();

    expect(list.observer.disconnected).toBe(true);
    // A scroll on a detached scroller must not reach a torn-down window.
    expect(() => {
      scroller.scrollTop = 500;
      scroller.dispatchEvent(new Event('scroll'));
      flushSync();
    }).not.toThrow();
  });
});
