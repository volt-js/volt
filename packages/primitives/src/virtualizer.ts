/**
 * Virtualizer — windowed rendering of a long collection.
 *
 * Ten thousand rows cost ten thousand elements and ten thousand bindings.
 * Rendering only what is on screen costs a fixed handful of each, and
 * everything else becomes arithmetic. That trade is the whole primitive.
 *
 * It knows nothing about lists, options, rows or cells. A listbox, a combobox,
 * a tree and a data grid all want the same three answers — which items to
 * render, where to put them, and how big the whole collection is — so those
 * are what this returns, and each component decides what an item means. The
 * grid runs two of them, one per axis, which is why the axis is an option
 * rather than an assumption.
 *
 * The shape it expects:
 *
 *   <div :ref="scroller" :spread="rows.scrollerProps()">
 *     <div :spread="rows.sizerProps()">
 *       <div :ref="container" :spread="rows.containerProps()">
 *         <div :for="item in rows.items()" :key="item.key"
 *              :spread="rows.itemProps(item.index)">{ item.index }</div>
 *       </div>
 *     </div>
 *   </div>
 *
 * Three elements, each with one job. The scroller scrolls. The sizer is empty
 * and exists only to be the full height of the collection, so the scrollbar
 * tells the truth. The container holds the rendered window and is moved into
 * place with a single transform — one composited property on one element per
 * scroll, rather than a position written to every row.
 *
 * The keyboard map, for a scrolling region that is not something else as well:
 *
 *   Home, End                  first item, last item
 *   PageUp, PageDown           one viewport back, one forward
 *   ArrowUp, ArrowDown         one item, on a vertical list
 *   ArrowLeft, ArrowRight      one item, on a horizontal one — mirrored in RTL
 *
 * `onKeyDown` returns whether it consumed the key, so the caller can prevent
 * the default. A listbox, grid or tree should **not** wire it: their arrows
 * move the selection, and they should call `scrollToIndex` from their own
 * handler instead.
 */

import { Signal, effect, measureEffect, onCleanup } from '@voltdev/core';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

/**
 * Marks a rendered item, carrying its index.
 *
 * Items are found by attribute rather than registered through a ref or a
 * context, for the same reason a menu item is: a row rendered from `:for`
 * cannot each hold a `:ref`, and a cell should not have to know which
 * virtualizer it belongs to.
 */
export const VIRTUAL_ITEM_ATTRIBUTE = 'data-volt-virtual-index';

/** Which way the collection runs. Physical, because scrolling is physical. */
export type VirtualAxis = 'vertical' | 'horizontal';

/** Where a scrolled-to item should come to rest in the viewport. */
export type VirtualAlignment = 'start' | 'center' | 'end' | 'nearest';

/**
 * Which counted-position attributes each item carries.
 *
 * A list, listbox, tree or combobox counts with `aria-setsize` and
 * `aria-posinset`. A grid counts rows and columns instead, and the count lives
 * on the grid rather than on each row. `none` is for a scrolling region whose
 * items are not a set at all.
 */
export type VirtualCounting = 'set' | 'row' | 'column' | 'none';

/** Extra items rendered outside the viewport, in each direction. */
export interface VirtualOverscan {
  before: number;
  after: number;
}

export interface VirtualizerLabels {
  /**
   * The optional live-region text. Default `Items 20 to 40 of 1000`, with
   * items numbered from one as a reader would count them, whatever
   * `indexBase` is.
   */
  range?: (first: number, last: number, count: number) => string;
  /** Default `No items`. */
  empty?: string;
}

export interface VirtualizerOptions {
  /** The element that scrolls. Its client box is the viewport. */
  scroller: () => Element | null | undefined;
  /**
   * Where to look for rendered items to measure — normally the element
   * `containerProps()` goes on. Defaults to the scroller, which is right
   * whenever the items are simply somewhere inside it.
   */
  container?: () => Element | null | undefined;

  /** How many items the collection has. */
  count: () => number;

  /**
   * A number is a promise: every item is exactly this tall, or this wide, and
   * the whole geometry is then arithmetic — nothing measured, nothing
   * observed, and nothing allocated per item however many there are.
   *
   * A function is an estimate for items whose real size is only known once
   * they have been rendered, and turns measurement on.
   */
  itemSize: number | ((index: number) => number);
  /**
   * Measure rendered items and correct the estimate. Defaults to true when
   * `itemSize` is a function. Set it false when sizes vary but are known from
   * the data, and true to measure against a fixed first guess.
   */
  measure?: boolean;

  /** The space between items, in px. Part of the arithmetic, not of layout. */
  gap?: number;
  /** Default vertical. */
  axis?: VirtualAxis;
  /** Default 2 each way, or `{ before, after }`. */
  overscan?: number | Partial<VirtualOverscan>;

  /**
   * What identifies an item. Measurements are cached against this, so a list
   * that grows at the front, or is reordered, keeps the sizes it already
   * knows. Without it an item is identified by its index, which is right for
   * appending and wrong for prepending.
   *
   * Keys are re-read whenever the collection changes — whenever anything
   * `count`, this, or a function `itemSize` reads changes, whatever happens to
   * the length — and never on a scroll: re-keying every item on every frame
   * would be the one O(n) step this otherwise avoids.
   */
  getItemKey?: (index: number) => string | number;

  /** Default `set`. */
  counting?: VirtualCounting;
  /**
   * The ARIA index of item 0. Default 1. A grid with one header row starts
   * its data rows at 2, because `aria-rowindex` counts every row on screen
   * and not just the ones this virtualizer owns.
   */
  indexBase?: number;

  /**
   * Put the scroller in the tab order. A region that scrolls but cannot be
   * focused cannot be scrolled from the keyboard at all, which fails WCAG
   * 2.1.1 — but a listbox or grid is already focusable, and a second tab stop
   * on the same element is worse than none. Hence off by default: only a
   * plain scrolling region needs it.
   */
  focusable?: boolean;

  labels?: VirtualizerLabels;

  /** Called when the rendered window changes — where an infinite list loads. */
  onRangeChange?: (range: VirtualRange) => void;
}

export interface VirtualScrollOptions {
  /** Default `auto`. */
  behavior?: ScrollBehavior;
}

export interface VirtualScrollToIndexOptions extends VirtualScrollOptions {
  /** Default `nearest`, which leaves an already-visible item alone. */
  align?: VirtualAlignment;
}

/** One rendered item. Offsets are from the start of the collection, in px. */
export interface VirtualItem {
  readonly index: number;
  readonly key: string | number;
  readonly start: number;
  readonly size: number;
  readonly end: number;
  /** Inside the viewport, rather than in the overscan around it. */
  readonly visible: boolean;
  /** Measured, rather than still the estimate. */
  readonly measured: boolean;
}

/** All four are -1 when the collection is empty. */
export interface VirtualRange {
  /** First item rendered, overscan included. */
  readonly startIndex: number;
  /** Last item rendered, inclusive. */
  readonly endIndex: number;
  readonly visibleStartIndex: number;
  readonly visibleEndIndex: number;
}

export type VirtualizerPropValue =
  | string
  | number
  | boolean
  | undefined
  | Readonly<Record<string, string>>;

export interface VirtualizerProps {
  readonly [key: string]: VirtualizerPropValue;
}

export interface Virtualizer {
  /** The items to render, in order. */
  items(): readonly VirtualItem[];
  range(): VirtualRange;
  /** The whole collection's extent in px — what the sizer is sized to. */
  totalSize(): number;
  /** Where the rendered window starts — what the container is moved by. */
  offset(): number;
  scrollOffset(): number;
  viewportSize(): number;

  sizeOf(index: number): number;
  offsetOf(index: number): number;
  /** The item at a pixel offset, or -1 when the collection is empty. */
  indexAt(offset: number): number;

  scrollToIndex(index: number, options?: VirtualScrollToIndexOptions): void;
  scrollToOffset(offset: number, options?: VirtualScrollOptions): void;
  /** Forget measurements — one item's, or all of them — and take them again. */
  remeasure(index?: number): void;

  /**
   * Handle a keydown. Returns true when it was consumed, which it only is for
   * a key pressed on the scroller itself that nothing has already prevented.
   */
  onKeyDown(event: KeyboardEvent): boolean;

  scrollerProps(): VirtualizerProps;
  sizerProps(): VirtualizerProps;
  containerProps(): VirtualizerProps;
  itemProps(index: number): VirtualizerProps;
  /** For the element carrying the collection's role — the grid, or the list. */
  countProps(): VirtualizerProps;

  /** Text for an optional live region. See `statusProps`. */
  status(): string;
  statusProps(): VirtualizerProps;
}

const DEFAULT_OVERSCAN = 2;

/**
 * How long a jump keeps the right to correct itself, in frames.
 *
 * A jump into unmeasured territory is aimed with estimates, so it lands short
 * or long, and measuring what it landed on is what says by how much. Those
 * measurements arrive within a frame or two; after that, anything moving
 * underneath is somebody else's change and following it would be a scroll the
 * reader did not ask for.
 */
const SETTLING_FRAMES = 4;

export function createVirtualizer(options: VirtualizerOptions): Virtualizer {
  const axis = options.axis ?? 'vertical';
  const vertical = axis === 'vertical';
  const gap = options.gap ?? 0;
  const counting = options.counting ?? 'set';
  const indexBase = options.indexBase ?? 1;

  const overscan = options.overscan ?? DEFAULT_OVERSCAN;
  const overscanBefore = Math.max(
    0,
    typeof overscan === 'number' ? overscan : (overscan.before ?? DEFAULT_OVERSCAN),
  );
  const overscanAfter = Math.max(
    0,
    typeof overscan === 'number' ? overscan : (overscan.after ?? DEFAULT_OVERSCAN),
  );

  const labels = {
    range:
      options.labels?.range ??
      ((first: number, last: number, count: number) => `Items ${first} to ${last} of ${count}`),
    empty: options.labels?.empty ?? 'No items',
  };

  const fixedSize = typeof options.itemSize === 'number' ? options.itemSize : null;
  const measuring = options.measure ?? fixedSize === null;

  const keyOf = (index: number): string | number => options.getItemKey?.(index) ?? index;
  const estimate = (index: number): number =>
    typeof options.itemSize === 'function' ? options.itemSize(index) : options.itemSize;

  /**
   * Measured sizes, by key rather than by index, so that inserting an item
   * does not shift every measurement onto the wrong row.
   *
   * Nothing still in the collection is evicted. A million rows scrolled past
   * leave a million numbers here, which is the price of scrolling back through
   * them without the list rearranging itself on the way. An item that leaves
   * keeps its size as well, so one that comes back — a filter cleared, a
   * folder opened again — is not an estimate; `collection` is where the sizes
   * of items that are gone are finally let go.
   */
  let measurements = new Map<string | number, number>();
  const sizeFor = (index: number): number => measurements.get(keyOf(index)) ?? estimate(index);

  /** The most items the collection has held, which bounds what is kept for the rest. */
  let largest = 0;

  const geometry =
    fixedSize !== null && !measuring
      ? createFixedGeometry(fixedSize, gap)
      : createMeasuredGeometry(sizeFor, gap);

  const scrollOffset = new Signal.State(0);
  const viewport = new Signal.State(0);
  /**
   * Measurements live in a mutable tree rather than in signals — one signal
   * per row would be a signal per row — so this is what tells the window that
   * one has landed.
   */
  const measurementVersion = new Signal.State(0);
  const rtl = new Signal.State(false);

  const containerElement = (): Element | null | undefined =>
    options.container ? options.container() : options.scroller();

  // --- Reading and writing the scroller ------------------------------------

  const readViewport = (el: Element): number => (vertical ? el.clientHeight : el.clientWidth);

  /**
   * The scroll offset as a distance travelled, which is not what the DOM
   * reports on a horizontal RTL scroller: there `scrollLeft` runs from 0 down
   * to negative. Every current engine agrees on that sign, so the absolute
   * value is the distance in both directions and no direction check is needed
   * to read it. Writing one back does need the sign, below.
   */
  const readScroll = (el: Element): number =>
    vertical ? el.scrollTop : Math.abs(el.scrollLeft);

  /** The last offset asked for, so a scroll we did not cause can be spotted. */
  let commanded = 0;

  /**
   * Move the scroller along this axis. Only this axis is named: the other is
   * specified to stay where it is, and naming it would mean reading it first,
   * which is a layout wherever the DOM has just been written.
   */
  const writeScroll = (el: Element, offset: number, behavior: ScrollBehavior): void => {
    commanded = offset;
    // Back into the DOM's signed form on the way out.
    el.scrollTo(
      vertical ? { top: offset, behavior } : { left: rtl.get() ? -offset : offset, behavior },
    );
  };

  const commandScroll = (el: Element, offset: number, behavior: ScrollBehavior): void => {
    writeScroll(el, offset, behavior);
    // Read back rather than assume: the browser clamps, and a smooth scroll
    // has not moved yet — its own scroll events fill in the rest.
    scrollOffset.set(readScroll(el));
  };

  // --- The window ----------------------------------------------------------

  /**
   * The collection as the geometry knows it, rebuilt whenever anything
   * `count`, `getItemKey` or a function `itemSize` reads changes — whether or
   * not the length did, because a reorder leaves the count where it was and
   * moves every measurement, and only reading the keys again can find that
   * out. Estimates come along because rebuilding asks for every item's size,
   * so a function that narrows as the page learns is followed too. Never by a
   * scroll, which is why this is a computed of its own rather than a step in
   * the window. The rebuild is O(n), and the one linear cost left.
   *
   * Sized here rather than in an effect. An effect runs after render, so the
   * first window following a change would be computed against the old
   * geometry and then corrected a frame later — a visible flash of the wrong
   * rows. Filling a cache inside a computed is still pure: the same collection
   * always gives the same geometry.
   */
  const collection = new Signal.Computed<number>(
    () => {
      const count = itemCount();
      largest = Math.max(largest, count);

      // The sizes of items that have gone are kept until they would outnumber
      // twice the largest collection this has held. That keeps an item that
      // comes back measured, and still stops a transcript swapped for another,
      // and another, from growing the cache for as long as the page is open.
      if (measurements.size > 2 * largest) {
        const kept = new Map<string | number, number>();
        for (let index = 0; index < count; index++) {
          const key = keyOf(index);
          const size = measurements.get(key);
          if (size !== undefined) kept.set(key, size);
        }
        measurements = kept;
      }

      geometry.rebuild(count);
      return count;
    },
    // The same count is not the same collection: the window has to be worked
    // out again against whatever the rebuild moved.
    { equals: () => false },
  );

  const frame = new Signal.Computed<Frame>(() => {
    const count = collection.get();
    measurementVersion.get();

    const totalSize = geometry.total();
    if (count === 0) {
      return { items: [], range: EMPTY_RANGE, totalSize: 0, offset: 0 };
    }

    const viewportSize = viewport.get();
    const scroll = Math.max(0, scrollOffset.get());

    const firstVisible = geometry.indexAt(scroll);
    // Less one, so a viewport whose edge lands exactly on a boundary does not
    // pull in the item starting there, which is not on screen at all. With an
    // unmeasured scroller — before layout, or in a hidden tab — this collapses
    // to the first item alone, which is deliberate: something has to render
    // before anything can be measured.
    const lastVisible = geometry.indexAt(scroll + Math.max(0, viewportSize - 1));

    const startIndex = Math.max(0, firstVisible - overscanBefore);
    const endIndex = Math.min(count - 1, lastVisible + overscanAfter);

    const items: VirtualItem[] = [];
    let start = geometry.offsetAt(startIndex);
    for (let index = startIndex; index <= endIndex; index++) {
      const size = geometry.sizeAt(index);
      const key = keyOf(index);
      items.push({
        index,
        key,
        start,
        size,
        end: start + size,
        visible: index >= firstVisible && index <= lastVisible,
        measured: measurements.has(key),
      });
      start += size + gap;
    }

    return {
      items,
      range: {
        startIndex,
        endIndex,
        visibleStartIndex: firstVisible,
        visibleEndIndex: lastVisible,
      },
      totalSize,
      offset: items[0]?.start ?? 0,
    };
  });

  function itemCount(): number {
    return Math.max(0, Math.trunc(options.count()));
  }

  // --- Measurement ---------------------------------------------------------

  /**
   * One observer for the scroller and every rendered item.
   *
   * One observer per virtualizer rather than one per row: a row is created and
   * destroyed on every scroll, and an observer each would make scrolling a
   * churn of observers. It is created lazily, from the document the elements
   * are actually in, so nothing touches a browser global at construction time.
   */
  let observer: ResizeObserver | null = null;
  const observed = new Set<Element>();
  /** What the observed set was last built for, so it is not rebuilt per scroll. */
  let observedRange: VirtualRange | null = null;
  let observedIn: Element | null = null;

  const ensureObserver = (node: Element): ResizeObserver | null => {
    if (observer) return observer;
    const view = node.ownerDocument?.defaultView;
    // No ResizeObserver means no layout worth measuring — a server, or a test
    // environment with no engine behind it. The estimates then stand.
    if (typeof view?.ResizeObserver !== 'function') return null;
    observer = new view.ResizeObserver(onEntries);
    return observer;
  };

  onCleanup(() => {
    observer?.disconnect();
    observer = null;
    observed.clear();
  });

  /**
   * The measured extent, taken from the entry the observer already produced.
   *
   * Asking each element again with `getBoundingClientRect` would force a
   * second layout for every row in the window, on every scroll that changes
   * it. `borderBoxSize` is logical, so this reads the block size for a
   * vertical list and the inline size for a horizontal one: correct in every
   * horizontal writing mode, swapped in a vertical one. Resolving that would
   * mean reading `writing-mode` off the scroller, which is a style read this
   * deliberately does not do — the axis here is physical, because scrolling is.
   */
  const entrySize = (entry: ResizeObserverEntry): number | null => {
    const box = entry.borderBoxSize?.[0];
    if (!box) return null;
    return vertical ? box.blockSize : box.inlineSize;
  };

  const indexOfItem = (el: Element): number | null => {
    const raw = el.getAttribute(VIRTUAL_ITEM_ATTRIBUTE);
    if (raw === null) return null;
    const index = Number(raw);
    return Number.isInteger(index) ? index : null;
  };

  function onEntries(entries: ResizeObserverEntry[]): void {
    const scroller = untrack(() => options.scroller());
    const scroll = scroller ? readScroll(scroller) : 0;
    const count = untrack(itemCount);
    let changed = false;
    let shift = 0;

    for (const entry of entries) {
      const target = entry.target;

      if (target === scroller) {
        // Read the viewport off the element, not the entry: the client box is
        // what a window is measured against, and it is the one box that
        // already has the scrollbar taken out of it.
        viewport.set(readViewport(target));
        continue;
      }

      const index = indexOfItem(target);
      // An entry can outlive the item it belongs to: the observer delivers
      // what it saw before the collection shrank, and asking the consumer for
      // the key of an item that no longer exists is asking for trouble.
      if (index === null || index >= count) continue;

      // An element with no box measures zero, and a zero here would collapse
      // everything below it — the list jumps, then jumps back when the element
      // is shown again. `checkVisibility` is the platform's own answer to "is
      // this actually rendered", `content-visibility` and hidden ancestors
      // included.
      if (!target.checkVisibility()) continue;

      const size = entrySize(entry);
      if (size === null) continue;

      const key = keyOf(index);
      const first = !measurements.has(key);
      measurements.set(key, size);

      const previous = geometry.sizeAt(index);
      const startBefore = geometry.offsetAt(index);

      if (geometry.set(index, size)) {
        changed = true;
        // An item above the viewport changing size drags everything below it,
        // including what the reader is looking at. Compensating by the same
        // amount is what keeps the view still while scrolling up through
        // unmeasured items — and is exactly the correction the browser's own
        // scroll anchoring would make at the same time, badly, which is why
        // `scrollerProps` turns it off.
        //
        // Against `scroll + shift` rather than `scroll`, because each entry
        // applied in this batch has already moved the ones after it: the
        // viewport top has notionally moved by that much too, so comparing
        // with the original offset would miss every item but the first.
        if (startBefore < scroll + shift) shift += size - previous;
      } else if (first) {
        // Same size as the estimate, so nothing moves — but the item is
        // measured now, and `item.measured` says so.
        changed = true;
      }
    }

    if (!changed) return;
    measurementVersion.set(measurementVersion.get() + 1);
    if (shift !== 0 && scroller) commandScroll(scroller, scroll + shift, 'auto');
  }

  // --- Scrolling to somewhere in particular --------------------------------

  /**
   * A scroll aimed at an index whose neighbourhood is still estimated.
   *
   * Held so that the measurements arriving from that landing can correct it.
   * Not a signal: nothing renders from it.
   */
  let pending: { index: number; align: VirtualAlignment; frames: number } | null = null;

  /** Where the scroller must be for `index` to sit as `align` asks. */
  const offsetForIndex = (index: number, align: VirtualAlignment): number | null => {
    const { totalSize } = frame.get();
    const count = itemCount();
    if (count === 0) return null;

    const item = clamp(Math.trunc(index), 0, count - 1);
    const start = geometry.offsetAt(item);
    const size = geometry.sizeAt(item);
    const view = viewport.get();
    const max = Math.max(0, totalSize - view);
    const current = scrollOffset.get();

    switch (align) {
      case 'start':
        return clamp(start, 0, max);
      case 'end':
        return clamp(start + size - view, 0, max);
      case 'center':
        return clamp(start + size / 2 - view / 2, 0, max);
      default:
        // Nearest: the smallest move that brings the whole item into view, and
        // no move at all when it is already there. Null rather than the
        // current offset, so a caller can tell "nothing to do" from "scroll
        // to where you already are".
        if (start < current) return clamp(start, 0, max);
        if (start + size > current + view) return clamp(start + size - view, 0, max);
        return null;
    }
  };

  const scrollToIndex = (index: number, opts: VirtualScrollToIndexOptions = {}): void => {
    const align = opts.align ?? 'nearest';
    const behavior = opts.behavior ?? 'auto';
    pending = null;

    const target = untrack(() => offsetForIndex(index, align));
    if (target === null) return;

    const scroller = untrack(() => options.scroller());
    if (!scroller) return;
    commandScroll(scroller, target, behavior);

    // A smooth scroll is deliberately never corrected: the animation's own
    // scroll events are indistinguishable from the user's, so a correction
    // would either fight the animation or refuse to let go of the user.
    if (measuring && behavior !== 'smooth') pending = { index, align, frames: 0 };
  };

  const scrollToOffset = (offset: number, opts: VirtualScrollOptions = {}): void => {
    pending = null;
    const scroller = untrack(() => options.scroller());
    if (!scroller) return;
    const max = untrack(() => Math.max(0, frame.get().totalSize - viewport.get()));
    commandScroll(scroller, clamp(offset, 0, max), opts.behavior ?? 'auto');
  };

  // --- Wiring --------------------------------------------------------------

  measureEffect(() => {
    const scroller = options.scroller();
    if (!scroller) return;

    rtl.set(isRtl(scroller));
    viewport.set(readViewport(scroller));
    scrollOffset.set(readScroll(scroller));

    const onScroll = () => {
      const next = readScroll(scroller);
      // A scroll that is not the one asked for is the reader taking over.
      // Dragging them back to a pending target would be far worse than letting
      // a jump land a few pixels out.
      if (pending && Math.abs(next - commanded) > 1) pending = null;
      scrollOffset.set(next);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onCleanup(() => scroller.removeEventListener('scroll', onScroll));

    const active = ensureObserver(scroller);
    if (!active) return;
    // The scroller is watched by the same observer the items use. A scroller
    // that grows shows more rows, and nothing else would notice.
    active.observe(scroller);
    onCleanup(() => active.unobserve(scroller));
  });

  if (measuring) {
    effect(() => {
      const { range } = frame.get();
      const container = containerElement();
      if (!container) return;

      // Every landed measurement re-runs this effect, through the window it
      // invalidates, so the guard earns its place: the set of rendered
      // elements only changes when the range does.
      if (container === observedIn && observedRange && sameRange(observedRange, range)) return;
      observedIn = container;
      observedRange = range;

      const active = ensureObserver(container);
      if (!active) return;

      // Volt has already flushed the render effects that inserted these, so
      // the DOM read here is of the settled tree.
      const current = new Set<Element>(
        container.querySelectorAll(`[${VIRTUAL_ITEM_ATTRIBUTE}]`),
      );
      for (const el of observed) {
        if (current.has(el)) continue;
        active.unobserve(el);
        observed.delete(el);
      }
      for (const el of current) {
        if (observed.has(el)) continue;
        active.observe(el);
        observed.add(el);
      }
    });

    effect(() => {
      // Read first: this effect exists to run again as measurements land.
      frame.get();
      const request = pending;
      if (!request) return;

      // Every frame counts against the budget, not only the ones that needed
      // correcting: landing on target with today's estimates is not the same
      // as having landed correctly, and the measurement that proves it wrong
      // is a frame away.
      request.frames += 1;
      if (request.frames > SETTLING_FRAMES) {
        pending = null;
        return;
      }

      const target = offsetForIndex(request.index, request.align);
      if (target === null) {
        pending = null;
        return;
      }
      if (Math.abs(target - scrollOffset.get()) < 1) return;

      const scroller = untrack(() => options.scroller());
      if (!scroller) {
        pending = null;
        return;
      }
      // Written and not read back. This runs inside a flush, where a read
      // would force a layout of its own outside the measure phase; the target
      // is already clamped to the collection the sizer was just sized to, so
      // it is where the scroller comes to rest, and the scroll event that
      // follows says so anyway.
      writeScroll(scroller, target, 'auto');
      scrollOffset.set(target);
    });
  }

  if (options.onRangeChange) {
    let reported: VirtualRange | null = null;
    effect(() => {
      const { range } = frame.get();
      if (reported && sameRange(reported, range)) return;
      reported = range;
      options.onRangeChange?.(range);
    });
  }

  // --- The component's view of it ------------------------------------------

  return {
    items: () => frame.get().items,
    range: () => frame.get().range,
    totalSize: () => frame.get().totalSize,
    offset: () => frame.get().offset,
    scrollOffset: () => scrollOffset.get(),
    viewportSize: () => viewport.get(),

    sizeOf: (index) => {
      frame.get();
      return geometry.sizeAt(index);
    },
    offsetOf: (index) => {
      frame.get();
      return geometry.offsetAt(index);
    },
    indexAt: (offset) => {
      frame.get();
      return geometry.indexAt(offset);
    },

    scrollToIndex,
    scrollToOffset,

    remeasure: (index) => {
      if (!measuring) return;
      if (index === undefined) measurements.clear();
      else measurements.delete(keyOf(index));

      // Rebuild rather than adjust: an item whose measurement was dropped goes
      // back to its estimate, and with all of them dropped that is every item.
      geometry.rebuild(untrack(itemCount));

      // Unobserve what is on screen so that re-observing it delivers a fresh
      // entry. A ResizeObserver only reports a change, and nothing here has
      // changed size — only what is known about it. Forgetting the observed
      // range is what makes the effect below re-observe rather than recognise
      // the same window and do nothing.
      for (const el of observed) observer?.unobserve(el);
      observed.clear();
      observedRange = null;

      measurementVersion.set(measurementVersion.get() + 1);
    },

    onKeyDown(event) {
      // A modified key is a shortcut, not navigation.
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      // Only a key pressed on the scroller itself, and one nothing else has
      // answered. A row can hold a toolbar, a field or a link, each with its
      // own meaning for Home, End and the arrows, and scrolling the whole
      // collection as well would be two answers to one key. Focus inside a row
      // still scrolls, by the browser's own keys.
      if (event.defaultPrevented) return false;
      if (event.target !== untrack(() => options.scroller())) return false;

      const count = untrack(itemCount);
      if (count === 0) return false;

      const forwardKey = vertical ? 'ArrowDown' : rtl.get() ? 'ArrowLeft' : 'ArrowRight';
      const backKey = vertical ? 'ArrowUp' : rtl.get() ? 'ArrowRight' : 'ArrowLeft';
      const first = untrack(() => frame.get().range.visibleStartIndex);

      switch (event.key) {
        case 'Home':
          scrollToIndex(0, { align: 'start' });
          return true;
        case 'End':
          scrollToIndex(count - 1, { align: 'end' });
          return true;
        case 'PageDown':
          scrollToOffset(untrack(() => scrollOffset.get() + viewport.get()));
          return true;
        case 'PageUp':
          scrollToOffset(untrack(() => scrollOffset.get() - viewport.get()));
          return true;
        case forwardKey:
          // By item rather than by a fixed number of pixels: in a list whose
          // rows differ in height, a fixed step leaves a different sliver of a
          // row showing every time.
          scrollToIndex(first + 1, { align: 'start' });
          return true;
        case backKey:
          scrollToIndex(first - 1, { align: 'start' });
          return true;
        default:
          return false;
      }
    },

    scrollerProps: () => ({
      style: {
        // Scroll anchoring and virtualization both try to hold the view still
        // as content above changes size, and they disagree about by how much:
        // the browser measures a box that is about to be replaced, this
        // measures the item that replaced it. Two corrections for one shift is
        // a list that drifts as you scroll up it.
        'overflow-anchor': 'none',
      },
      tabindex: options.focusable ? '0' : undefined,
    }),

    sizerProps: () => ({
      // The scrollbar is the only thing this element is for: it has no
      // content, and its whole job is to be as long as the collection claims.
      style: { [vertical ? 'height' : 'width']: `${frame.get().totalSize}px` },
    }),

    containerProps: () => {
      const offset = frame.get().offset;
      // Transforms are physical and the collection runs the other way in RTL.
      const signed = rtl.get() ? -offset : offset;
      return {
        style: {
          // A transform rather than a top or a left: it is a composited
          // property, it does not invalidate layout, and one on the container
          // replaces one on every row.
          transform: vertical ? `translateY(${offset}px)` : `translateX(${signed}px)`,
        },
      };
    },

    itemProps: (index) => {
      const props: Record<string, VirtualizerPropValue> = {
        [VIRTUAL_ITEM_ATTRIBUTE]: String(index),
      };

      switch (counting) {
        case 'set':
          // Without these, an item announces as "3 of 12" — the size of the
          // rendered window, not of the collection. Virtualization is
          // invisible to a sighted reader and a lie to everyone else unless
          // the real numbers are put back by hand.
          props['aria-setsize'] = String(itemCount());
          props['aria-posinset'] = String(index + indexBase);
          break;
        case 'row':
          props['aria-rowindex'] = String(index + indexBase);
          break;
        case 'column':
          props['aria-colindex'] = String(index + indexBase);
          break;
        default:
          break;
      }

      // The fixed path promised that every item is this size, and its
      // arithmetic is only true while that holds. Stating it back is not a
      // styling opinion — it is the input, returned. Anything whose size
      // should come from CSS belongs on the measured path.
      if (fixedSize !== null && !measuring) {
        props.style = { [vertical ? 'height' : 'width']: `${fixedSize}px` };
      }

      return props;
    },

    countProps: () => {
      const count = itemCount();
      switch (counting) {
        case 'row':
          // Header rows are part of the count a grid reports, which is what
          // `indexBase` has already accounted for.
          return { 'aria-rowcount': String(count + indexBase - 1) };
        case 'column':
          return { 'aria-colcount': String(count + indexBase - 1) };
        default:
          // For a set, the count travels on each item as `aria-setsize`.
          return {};
      }
    },

    status: () => {
      const { range } = frame.get();
      const count = itemCount();
      if (count === 0 || range.visibleStartIndex < 0) return labels.empty;
      return labels.range(range.visibleStartIndex + 1, range.visibleEndIndex + 1, count);
    },

    /**
     * A live region is offered rather than assumed, and nothing renders it for
     * you. Announcing the window is worth it where scrolling is a discrete act
     * — paging, or jumping to a letter — and unbearable during a continuous
     * drag, where it chatters over everything else being said.
     */
    statusProps: () => ({ role: 'status' }),
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface Frame {
  readonly items: readonly VirtualItem[];
  readonly range: VirtualRange;
  readonly totalSize: number;
  readonly offset: number;
}

const EMPTY_RANGE: VirtualRange = {
  startIndex: -1,
  endIndex: -1,
  visibleStartIndex: -1,
  visibleEndIndex: -1,
};

/**
 * Where each item is, and which one is at a given offset.
 *
 * Two implementations, because the answers are either arithmetic or a data
 * structure and there is no point paying for the second when the first will
 * do. `gap` is folded into every item's stride and taken off the total once,
 * so neither implementation has to special-case the last item.
 */
interface Geometry {
  /** Resize to `count` and read every size again: measured by key, else estimated. */
  rebuild(count: number): void;
  sizeAt(index: number): number;
  /** Where item `index` starts. */
  offsetAt(index: number): number;
  indexAt(offset: number): number;
  total(): number;
  /** Record a size. Returns whether it moved anything. */
  set(index: number, size: number): boolean;
}

/**
 * Every item the same size: no array, no tree, nothing per item at all. A
 * million rows cost the same as ten, which is the point of promising a size.
 */
function createFixedGeometry(size: number, gap: number): Geometry {
  const stride = size + gap;
  let count = 0;

  return {
    rebuild: (next) => {
      count = next;
    },
    sizeAt: () => size,
    offsetAt: (index) => clamp(index, 0, count) * stride,
    indexAt: (offset) => {
      if (count === 0) return -1;
      if (stride <= 0) return 0;
      return clamp(Math.floor(offset / stride), 0, count - 1);
    },
    total: () => (count === 0 ? 0 : count * stride - gap),
    set: () => false,
  };
}

/**
 * Sizes that differ per item, in a Fenwick tree.
 *
 * The two questions asked of it — the offset of an item, and the item at an
 * offset — are a prefix sum and a search over prefix sums, and a measurement
 * changes one item and every prefix after it. A plain array of offsets answers
 * the first two in O(1) and O(log n) but costs O(n) per measurement, which for
 * a grid of a million rows is a million additions each time a row settles. A
 * Fenwick tree makes all three O(log n) for one array of numbers and about
 * thirty lines. A change to the collection rebuilds it in O(n), which is the
 * one cost left, and collections change far less often than sizes do. The
 * rebuild asks for every item's size, so a collection counts as changed when a
 * function `itemSize` would now answer differently, and not only when the
 * count or the keys move.
 */
function createMeasuredGeometry(sizeFor: (index: number) => number, gap: number): Geometry {
  let count = 0;
  let strides = new Float64Array(0);
  let tree = new Float64Array(1);
  /** Highest power of two within the tree, for the descent in `indexAt`. */
  let step = 1;

  const rebuild = (next: number): void => {
    count = next;
    strides = new Float64Array(count);
    tree = new Float64Array(count + 1);

    for (let i = 0; i < count; i++) {
      const stride = sizeFor(i) + gap;
      strides[i] = stride;
      tree[i + 1] = stride;
    }
    // Linear build: every node hands its total up to the node that covers it.
    for (let i = 1; i <= count; i++) {
      const parent = i + (i & -i);
      if (parent <= count) tree[parent] = tree[parent]! + tree[i]!;
    }

    step = 1;
    while (step * 2 <= count) step *= 2;
  };

  /** Sum of the first `n` strides. */
  const prefix = (n: number): number => {
    let sum = 0;
    for (let i = n; i > 0; i -= i & -i) sum += tree[i]!;
    return sum;
  };

  return {
    rebuild,

    sizeAt: (index) => {
      const stride = strides[index];
      return stride === undefined ? 0 : stride - gap;
    },

    offsetAt: (index) => prefix(clamp(index, 0, count)),
    total: () => (count === 0 ? 0 : prefix(count) - gap),

    set: (index, size) => {
      if (index < 0 || index >= count) return false;
      const stride = size + gap;
      const delta = stride - strides[index]!;
      if (delta === 0) return false;
      strides[index] = stride;
      for (let i = index + 1; i <= count; i += i & -i) tree[i] = tree[i]! + delta;
      return true;
    },

    indexAt: (offset) => {
      if (count === 0) return -1;
      // Descend the tree by powers of two, taking a branch whenever the whole
      // of it still fits before the offset. What is left at the bottom is the
      // number of items that end at or before it — which is the index of the
      // item the offset is inside.
      let index = 0;
      let remaining = offset;
      for (let size = step; size > 0; size >>= 1) {
        const next = index + size;
        if (next > count) continue;
        const value = tree[next]!;
        if (value > remaining) continue;
        index = next;
        remaining -= value;
      }
      return Math.min(index, count - 1);
    },
  };
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function sameRange(a: VirtualRange, b: VirtualRange): boolean {
  return a.startIndex === b.startIndex && a.endIndex === b.endIndex;
}

/**
 * Writing direction at the scroller.
 *
 * The nearest `dir` attribute wins over computed style, as it does for roving
 * focus: an application that marks up direction with `dir` is stating intent,
 * and the attribute can be read before styles resolve.
 */
function isRtl(el: Element): boolean {
  const declared = el.closest('[dir]');
  if (declared) return declared.getAttribute('dir')?.toLowerCase() === 'rtl';

  const view = el.ownerDocument?.defaultView;
  return view?.getComputedStyle?.(el).direction === 'rtl';
}
