/**
 * Navigation — breadcrumb, pagination, stepper and navigation menu.
 *
 * Four components that all answer the same question for the user: where am I,
 * and where else can I go. They share a file because they share that job and
 * the shape of the answer — a landmark, a list, and one tab stop with the
 * arrow keys moving inside it.
 *
 * All four are headless: they own state, keyboard and ARIA, and return prop
 * objects to spread onto whatever markup the consumer writes. Nothing here
 * renders, and nothing here has an opinion about styling.
 *
 * The one rule worth stating up front, because three of these four break with
 * the menu pattern over it: **a link's keyboard contract is Enter.** Where an
 * item is an `<a href>`, Enter is left to the browser — it follows the link,
 * and the click that follows carries the component's own handling with it —
 * and Space is left alone too, because on a link Space scrolls the page. A
 * menu item *acts*, so Space activates it; a navigation item *goes somewhere*,
 * so it does not. Getting this wrong is the most common way a headless
 * navigation menu quietly breaks middle-click, ⌘-click and Enter all at once.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createCollection } from './collection.js';
import { createRovingFocus } from './roving-focus.js';
import { createDismiss, type DismissReason } from './dismiss.js';
import { createMenu, type Menu } from './menu.js';
import { createId } from './id.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

/**
 * A value in a spread object. Handlers are included because the keyboard map
 * is part of what these own, and a consumer who has to remember to wire it up
 * is a consumer who will ship a menubar the arrow keys do nothing in. So is a
 * style object, which is how the breadcrumb's overflow menu carries the anchor
 * positioning it gets from `createMenu`.
 */
export type NavigationPropValue =
  | string
  | boolean
  | undefined
  | Readonly<Record<string, string>>
  | ((event: Event) => void);

/**
 * One props type for all four components. They are one file's worth of
 * navigation and the shape is identical; four aliases would say nothing that
 * the method names do not.
 */
export interface NavigationProps {
  readonly [key: string]: NavigationPropValue;
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

/** Marks a crumb, and records its position in the trail. */
export const CRUMB_ATTRIBUTE = 'data-volt-crumb';

/** Marks the slot the overflow menu's trigger sits in, so it can be measured. */
export const CRUMB_OVERFLOW_ATTRIBUTE = 'data-volt-crumb-overflow';

export interface BreadcrumbLabels {
  /** Names the navigation landmark. Default "Breadcrumb". */
  nav?: string;
  /**
   * Names the overflow trigger, whose visible text is usually an ellipsis —
   * which is read out as "dot dot dot", or not at all. Default "Show the rest
   * of the path".
   */
  overflow?: string;
}

export interface BreadcrumbOptions {
  /** The list element holding the crumbs — the `<ol>`. */
  list: () => Element | null | undefined;
  /** How many crumbs there are, the root first and the current page last. */
  count: () => number;

  /** The overflow menu's content element, once rendered. */
  overflowContent?: () => Element | null | undefined;
  /**
   * The overflow menu's trigger. Given, a press on it is not treated as
   * outside the menu, and it names the menu it opens.
   */
  overflowTrigger?: () => Element | null | undefined;

  /** Crumbs always kept at the start. Default 1 — the root. */
  itemsBefore?: number;
  /** Crumbs always kept at the end. Default 1 — the current page. */
  itemsAfter?: number;
  /**
   * Collapse the middle of the trail when it does not fit. Default true. Turn
   * it off for a trail that is short by construction, and nothing is measured.
   */
  collapse?: boolean;

  labels?: BreadcrumbLabels;
  /** The crumbs now in the overflow menu, in trail order. */
  onCollapseChange?: (collapsed: readonly number[]) => void;
}

export interface Breadcrumb {
  count(): number;
  /** Indices of the crumbs currently in the overflow menu, in trail order. */
  collapsed(): readonly number[];
  isCollapsed(index: number): boolean;
  /** Whether this crumb is the page the user is on — the last one. */
  isCurrent(index: number): boolean;

  /**
   * The overflow menu. Its own props are folded into `overflowTriggerProps`
   * and `overflowContentProps`; this is here for `isOpen`, `close`, and the
   * cases those two do not cover.
   */
  readonly menu: Menu;

  /**
   * Measure the trail again and decide what fits.
   *
   * Called on mount and on every resize of the list. Worth calling by hand
   * after something changes width without resizing the list: a web font
   * arriving, or the trail's text being translated.
   */
  measure(): void;

  navProps(): NavigationProps;
  listProps(): NavigationProps;
  itemProps(index: number): NavigationProps;
  linkProps(index: number): NavigationProps;
  separatorProps(): NavigationProps;
  /** The list item the overflow trigger sits in. */
  overflowProps(): NavigationProps;
  overflowTriggerProps(): NavigationProps;
  overflowContentProps(): NavigationProps;
  /** A collapsed crumb's link, inside the overflow menu. */
  overflowLinkProps(index: number): NavigationProps;
}

/**
 * A breadcrumb trail that collapses its middle into a menu when it runs out of
 * room.
 *
 *   class Page {
 *     list = new Signal.State<Element | null>(null);
 *     content = new Signal.State<Element | null>(null);
 *     trigger = new Signal.State<Element | null>(null);
 *     trail = new Signal.State(['Home', 'Docs', 'Guides', 'Routing']);
 *     crumbs = createBreadcrumb({
 *       list: () => this.list.get(),
 *       count: () => this.trail.get().length,
 *       overflowContent: () => this.content.get(),
 *       overflowTrigger: () => this.trigger.get(),
 *     });
 *   }
 *
 *   <nav :spread="crumbs.navProps()">
 *     <ol :ref="list" :spread="crumbs.listProps()">
 *       <li :for="(name, i) in trail.get()" :key="name" :spread="crumbs.itemProps(i)">
 *         <a href="…" :spread="crumbs.linkProps(i)">{ name }</a>
 *       </li>
 *       <li :spread="crumbs.overflowProps()">
 *         <button :ref="trigger" :spread="crumbs.overflowTriggerProps()">…</button>
 *         <div :if="crumbs.menu.isPresent()" :ref="content"
 *              :spread="crumbs.overflowContentProps()">
 *           <a :for="i in crumbs.collapsed()" :key="i"
 *              :spread="crumbs.overflowLinkProps(i)">{ trail.get()[i] }</a>
 *         </div>
 *       </li>
 *     </ol>
 *   </nav>
 *
 * **Why measure rather than take a number.** A fixed "collapse past four" is
 * wrong at both ends: four short crumbs fit on a phone, and four long ones do
 * not fit on a desktop. So the trail is measured — every crumb's width, the
 * width the list has to give, and the width the trigger will cost once it
 * appears — and the fewest middle crumbs are collapsed that make the rest fit.
 *
 * Collapsed crumbs are hidden, not unmounted, because a crumb that is not in
 * the document has no width, and its width is exactly what decides whether it
 * should come back. The cost is that the consumer renders every crumb twice,
 * once in the trail and once in the menu; `hidden` keeps the trail's copy out
 * of the accessibility tree so nothing is announced twice.
 *
 * The overflow slot belongs where the collapse happens — after the first
 * `itemsBefore` crumbs — and one `:for` cannot put it there. Either split the
 * trail into two loops, or leave it after them and give it a CSS `order`,
 * which is the cheaper of the two and is styling either way.
 *
 * Measurement reads layout, which forces the browser to compute it: one
 * synchronous reflow per resize, which is the price of not guessing. It is
 * measured against the list's own client width, so give the list a width that
 * does not depend on its contents — a list that shrink-wraps its crumbs
 * changes size as they collapse, and the measurement will chase itself.
 */
export function createBreadcrumb(options: BreadcrumbOptions): Breadcrumb {
  const labels = options.labels ?? {};
  const overflowLabel = labels.overflow ?? 'Show the rest of the path';

  const collapsedCount = new Signal.State(0);
  const collection = createCollection(() => options.list(), { attribute: CRUMB_ATTRIBUTE });

  const menu = createMenu({
    content: () => options.overflowContent?.() ?? null,
    trigger: () => options.overflowTrigger?.() ?? null,
    labels: { menu: overflowLabel },
  });

  const itemsBefore = Math.max(0, options.itemsBefore ?? 1);
  const itemsAfter = Math.max(0, options.itemsAfter ?? 1);

  const collapsedIndices = (): number[] => {
    const total = collapsedCount.get();
    return Array.from({ length: total }, (_, i) => itemsBefore + i);
  };

  const isCollapsed = (index: number): boolean =>
    index >= itemsBefore && index < itemsBefore + collapsedCount.get();

  const setCollapsed = (next: number) => {
    if (untrack(() => collapsedCount.get()) === next) return;
    collapsedCount.set(next);

    // Untracked: this runs inside the measuring effect, which must not come to
    // depend on the menu's own state or on whatever the consumer's callback
    // happens to read — either would re-measure the trail every time the menu
    // opened.
    untrack(() => {
      // A menu whose items have just gone back into the trail is a menu with
      // nothing in it, and its trigger is about to disappear from under the
      // pointer.
      if (next === 0) menu.close();
      options.onCollapseChange?.(collapsedIndices());
    });
  };

  const measure = () => {
    if (options.collapse === false) {
      setCollapsed(0);
      return;
    }

    const list = options.list();
    if (!list) return;

    const items = collection.all();
    const total = items.length;
    const collapsible = total - itemsBefore - itemsAfter;
    if (collapsible <= 0) {
      setCollapsed(0);
      return;
    }

    const slot = list.querySelector<HTMLElement>(`[${CRUMB_OVERFLOW_ATTRIBUTE}]`);

    // Measure the trail as it would be with nothing collapsed and no trigger:
    // that is the width it actually wants, and it is the only state in which
    // every crumb has a width to read.
    const wasHidden = items.map((el) => el.hidden);
    const slotWasHidden = slot?.hidden ?? false;
    for (const el of items) el.hidden = false;
    if (slot) slot.hidden = false;

    const slotWidth = slot ? widthOf(slot) : 0;
    if (slot) slot.hidden = true;

    const available = list.clientWidth;
    const required = list.scrollWidth;
    const widths = items.map(widthOf);

    for (const [i, el] of items.entries()) el.hidden = wasHidden[i] ?? false;
    if (slot) slot.hidden = slotWasHidden;

    // No layout — a server, a test environment, or a list that has not been
    // painted yet. The last measurement stands, which is better than reading
    // zero and collapsing a trail that may well fit.
    if (available <= 0) return;

    // Whatever sits between the crumbs — separators, gaps, padding — shared
    // out evenly across the gaps. Assuming the separators are alike is what
    // lets this work without knowing how the consumer renders them; a trail
    // with one enormous separator in it will collapse one crumb too few.
    const chrome = Math.max(0, required - sum(widths));
    const perGap = chrome / Math.max(total - 1, 1);

    const widthWith = (collapsed: number): number => {
      let shown = 0;
      for (const [i, width] of widths.entries()) {
        if (i >= itemsBefore && i < itemsBefore + collapsed) continue;
        shown += width;
      }
      // The trigger takes a slot of its own the moment anything is in it, so
      // collapsing a single crumb only saves the difference between the two.
      const parts = total - collapsed + (collapsed > 0 ? 1 : 0);
      return shown + (collapsed > 0 ? slotWidth : 0) + perGap * Math.max(parts - 1, 0);
    };

    // Collapse from just after the kept start, forwards. That keeps the
    // collapsed run contiguous — the menu sits in one place in the trail — and
    // it drops the shallowest ancestors first, which are the ones furthest
    // from where the user is.
    let collapsed = 0;
    while (collapsed < collapsible && widthWith(collapsed) > available) collapsed += 1;
    setCollapsed(collapsed);
  };

  effect(() => {
    const list = options.list();
    // Read so that adding or removing a crumb re-measures; the widths cannot
    // tell us the trail changed.
    options.count();
    if (!list) return;

    measure();
    observeSize(list, measure);
  });

  const onOverflowClick = () => menu.toggle();
  const onOverflowKeyDown = (event: Event) => {
    if (isKeyboardEvent(event)) menu.onTriggerKeyDown(event);
  };

  const onOverflowContentKeyDown = (event: Event) => {
    if (!isKeyboardEvent(event)) return;
    // The items in here are links. Enter is the browser's — it follows the
    // link, and the click it fires reaches the handler below, which closes the
    // menu. Space is the browser's too, and on a link that means scrolling.
    if (event.key === 'Enter' || event.key === ' ') return;
    menu.onContentKeyDown(event);
  };

  const onOverflowContentClick = (event: Event) => {
    if (isMouseEvent(event)) menu.onItemClick(event);
  };

  const onOverflowContentPointerMove = (event: Event) => {
    if (isPointerEvent(event)) menu.onItemPointerMove(event);
  };

  return {
    menu,

    count: () => options.count(),
    collapsed: collapsedIndices,
    isCollapsed,
    isCurrent: (index) => index === options.count() - 1,

    measure,

    navProps: () => ({
      // Emitted rather than left to the `<nav>`, so a consumer who reaches for
      // a `<div>` still gets a landmark — and on a `<nav>` it costs nothing.
      role: 'navigation',
      'aria-label': labels.nav ?? 'Breadcrumb',
    }),

    listProps: () => ({
      // `list-style: none` takes list semantics away from an `<ol>` in some
      // browsers, and the trail is a list — it is how a screen reader says how
      // many crumbs there are and which one this is.
      role: 'list',
      'data-collapsed': collapsedCount.get() > 0 ? '' : undefined,
    }),

    itemProps: (index) => ({
      [CRUMB_ATTRIBUTE]: String(index),
      // Hidden rather than unmounted: see the note above about measuring.
      hidden: isCollapsed(index),
    }),

    linkProps: (index) => ({
      // On the link, not the list item: `aria-current` marks the element that
      // represents the current page, and that is the one that points at it.
      'aria-current': index === options.count() - 1 ? 'page' : undefined,
    }),

    separatorProps: () => ({
      // A separator between crumbs is decoration. Read aloud it is "slash"
      // between every pair of names, which is noise, and hiding it also keeps
      // it out of the list's item count.
      'aria-hidden': 'true',
    }),

    overflowProps: () => ({
      [CRUMB_OVERFLOW_ATTRIBUTE]: '',
      hidden: collapsedCount.get() === 0,
    }),

    overflowTriggerProps: () => ({
      ...menu.triggerProps(),
      'aria-label': overflowLabel,
      onclick: onOverflowClick,
      onkeydown: onOverflowKeyDown,
    }),

    overflowContentProps: () => ({
      ...menu.contentProps(),
      onkeydown: onOverflowContentKeyDown,
      onclick: onOverflowContentClick,
      onpointermove: onOverflowContentPointerMove,
    }),

    overflowLinkProps: (index) => menu.itemProps({ value: String(index) }),
  };
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Marks a page button or a first/previous/next/last control. */
export const PAGINATION_ITEM_ATTRIBUTE = 'data-volt-page';

export type PaginationControl = 'first' | 'previous' | 'next' | 'last';

/**
 * One slot in the rendered page row: a page, or a gap standing for the pages
 * left out. `key` is there to be handed to `:key`, since the numbers move
 * about as the current page does.
 */
export type PaginationEntry =
  | { readonly type: 'page'; readonly key: string; readonly page: number }
  | {
      readonly type: 'ellipsis';
      readonly key: string;
      /** First page this gap stands for. */
      readonly from: number;
      /** Last page this gap stands for. */
      readonly to: number;
      readonly count: number;
    };

export interface PaginationLabels {
  /** Names the navigation landmark. Default "Pagination". */
  nav?: string;
  /**
   * Names a page button, whose visible text is a bare number. Default
   * "Page 3". No separate label for the current page: `aria-current` already
   * makes a screen reader say so, and saying it twice is worse than not
   * saying it at all.
   */
  page?: (page: number) => string;
  first?: string;
  previous?: string;
  next?: string;
  last?: string;
  /** The live announcement. Default "Page 3 of 9". */
  status?: (page: number, pageCount: number) => string;
}

export interface PaginationOptions {
  /** The element holding the controls. They share one tab stop inside it. */
  list: () => Element | null | undefined;
  /** How many items there are to page through. */
  total: () => number;

  /**
   * Supply a signal to control the page from outside — from the URL, most
   * often. Without one it owns its own state. Pages are numbered from 1.
   */
  page?: Signal.State<number>;
  defaultPage?: number;

  /** Supply a signal to control the page size from outside. Default 10. */
  pageSize?: Signal.State<number>;
  defaultPageSize?: number;

  /** Pages shown either side of the current one. Default 1. */
  siblings?: number;
  /** Pages pinned at each end of the row. Default 1. */
  boundaries?: number;
  /** Arrow keys wrap past the ends of the control row. Default false. */
  loop?: boolean;

  labels?: PaginationLabels;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

export interface Pagination {
  page(): number;
  pageCount(): number;
  pageSize(): number;
  /** The items on this page, numbered from 1. Both 0 when there are none. */
  range(): { start: number; end: number };
  /** The page row, ellipses included. */
  pages(): PaginationEntry[];
  /** What the live region should say — "Page 3 of 9". */
  announcement(): string;

  goTo(page: number): void;
  first(): void;
  previous(): void;
  next(): void;
  last(): void;
  /** Changing the size keeps the first item of the current page in view. */
  setPageSize(size: number): void;
  isDisabled(control: PaginationControl): boolean;

  navProps(): NavigationProps;
  listProps(): NavigationProps;
  pageProps(page: number): NavigationProps;
  ellipsisProps(): NavigationProps;
  controlProps(control: PaginationControl): NavigationProps;
  statusProps(): NavigationProps;
}

/**
 * A pager over a known number of items.
 *
 *   class Results {
 *     list = new Signal.State<Element | null>(null);
 *     pager = createPagination({
 *       list: () => this.list.get(),
 *       total: () => this.rows.get().length,
 *     });
 *   }
 *
 *   <nav :spread="pager.navProps()">
 *     <ul :ref="list" :spread="pager.listProps()">
 *       <li><button :spread="pager.controlProps('previous')">‹</button></li>
 *       <li :for="entry in pager.pages()" :key="entry.key">
 *         <span :if="entry.type === 'ellipsis'" :spread="pager.ellipsisProps()">…</span>
 *         <button :if="entry.type === 'page'" :spread="pager.pageProps(entry.page)">
 *           { entry.page }
 *         </button>
 *       </li>
 *       <li><button :spread="pager.controlProps('next')">›</button></li>
 *     </ul>
 *     <p :spread="pager.statusProps()">{ pager.announcement() }</p>
 *   </nav>
 *
 * The whole row is one tab stop and the arrow keys move within it, because a
 * pager with fifteen page buttons is fifteen Tab presses to step over. Home
 * and End go to the ends of the row — the first and last controls — rather
 * than to the first and last page, because that is what they mean everywhere
 * else a group of controls roves.
 *
 * The controls are buttons: this owns the page number and reports it through
 * `onPageChange`. A consumer who needs real URLs for a crawler can render an
 * `<a href>` instead, and Enter on it is left to the browser — the click that
 * follows still sets the page here.
 *
 * The row's width changes as the current page moves, because the ellipses come
 * and go. Pinning it would mean showing more siblings near the ends, which
 * moves the numbers under the pointer instead; neither is free, and this way
 * the numbers stay where they are.
 *
 * There is always at least one page. Nothing to show is "page 1 of 1" with an
 * empty range, because "page 1 of 0" is a sentence a screen reader will read
 * out exactly as written.
 */
export function createPagination(options: PaginationOptions): Pagination {
  const labels = options.labels ?? {};
  const current = options.page ?? new Signal.State(options.defaultPage ?? 1);
  const size = options.pageSize ?? new Signal.State(options.defaultPageSize ?? 10);

  /**
   * The control focus is on, held as its key rather than its element: the page
   * row is rebuilt as the current page moves, and an element held across that
   * is a detached node the tab stop can never come back to.
   */
  const focused = new Signal.State<string | null>(null);

  const collection = createCollection(() => options.list(), {
    attribute: PAGINATION_ITEM_ATTRIBUTE,
  });

  const total = (): number => Math.max(0, Math.floor(options.total()));
  const pageSize = (): number => Math.max(1, Math.floor(size.get()));
  const pageCount = (): number => Math.max(1, Math.ceil(total() / pageSize()));
  const page = (): number => clamp(Math.floor(current.get()), 1, pageCount());

  const setPage = (next: number) => {
    const target = clamp(Math.floor(next), 1, pageCount());
    if (untrack(page) === target) return;
    current.set(target);
    options.onPageChange?.(target);
  };

  const isDisabled = (control: PaginationControl): boolean =>
    control === 'first' || control === 'previous' ? page() <= 1 : page() >= pageCount();

  const keyFor = (item: Element): string | null =>
    item.getAttribute(PAGINATION_ITEM_ATTRIBUTE);

  // Walked rather than selected, because a key is built from application data
  // and putting one in a selector would need `CSS.escape` — a browser global
  // that does not exist when rendering on a server.
  const elementFor = (key: string): HTMLElement | null =>
    collection.all().find((el) => keyFor(el) === key) ?? null;

  const tabStop = (key: string): string =>
    (focused.get() ?? String(page())) === key ? '0' : '-1';

  const activate = (item: HTMLElement) => {
    const key = keyFor(item);
    switch (key) {
      case null:
        return;
      case 'first':
        setPage(1);
        return;
      case 'previous':
        setPage(page() - 1);
        return;
      case 'next':
        setPage(page() + 1);
        return;
      case 'last':
        setPage(pageCount());
        return;
      default: {
        const target = Number(key);
        if (Number.isFinite(target)) setPage(target);
      }
    }
  };

  const roving = createRovingFocus(
    collection,
    () => elementFor(focused.get() ?? String(page())),
    (el) => {
      const key = el ? keyFor(el) : null;
      if (key !== null) focused.set(key);
    },
    {
      orientation: 'horizontal',
      // Not by default: the ends of a pager mean something. Wrapping from the
      // last page back to the first is a jump the user did not ask for.
      loop: options.loop === true,
      // No typeahead. The labels are numbers, and typing "2" should not move
      // focus to page 2 without paging to it — which is a selection, not a
      // navigation, so the key would be doing two things at once.
      typeahead: false,
      onSelect: activate,
    },
  );

  const onKeyDown = (event: Event) => {
    if (!isKeyboardEvent(event)) return;

    if (event.key === 'Enter' || event.key === ' ') {
      const item = itemFrom(event.target, PAGINATION_ITEM_ATTRIBUTE);
      // A link's contract is the browser's: Enter follows it and fires the
      // click that pages this. Taking the key here would page without ever
      // navigating, and the URL in the address bar would go stale.
      if (item && isLink(item)) return;
    }

    if (roving.onKeyDown(event)) event.preventDefault();
  };

  const onClick = (event: Event) => {
    const item = itemFrom(event.target, PAGINATION_ITEM_ATTRIBUTE);
    if (!item) return;
    if (isDisabledElement(item)) {
      // A control at the end of the range is still visibly there, and an `<a>`
      // used as one would otherwise follow its href.
      event.preventDefault();
      return;
    }
    activate(item);
  };

  const onFocusIn = (event: Event) => {
    const item = itemFrom(event.target, PAGINATION_ITEM_ATTRIBUTE);
    const key = item ? keyFor(item) : null;
    if (key !== null) focused.set(key);
  };

  const onFocusOut = (event: Event) => {
    const next = isFocusEvent(event) ? event.relatedTarget : null;
    if (next instanceof Node && options.list()?.contains(next)) return;
    // Leaving the row hands the tab stop back to the current page, so Tab
    // returns to where the user is rather than to whichever control they last
    // arrowed past.
    focused.set(null);
  };

  // The row is rebuilt whenever the page or the total moves, which none of the
  // other lists here do. A tab stop remembered on a number that is no longer
  // in the row would leave the widget with no tab stop at all, and Tab would
  // step straight over it — and removing a focused element fires no
  // `focusout`, so nothing else would notice.
  effect(() => {
    page();
    pageCount();
    const key = focused.get();
    if (key === null) return;
    untrack(() => {
      if (!elementFor(key)) focused.set(null);
    });
  });

  return {
    page,
    pageCount,
    pageSize,

    range() {
      const items = total();
      if (items === 0) return { start: 0, end: 0 };
      const start = (page() - 1) * pageSize() + 1;
      return { start: Math.min(start, items), end: Math.min(page() * pageSize(), items) };
    },

    pages() {
      const count = pageCount();
      const here = page();
      const boundaries = Math.max(0, Math.floor(options.boundaries ?? 1));
      const siblings = Math.max(0, Math.floor(options.siblings ?? 1));

      const shown = new Set<number>([here]);
      for (let i = 1; i <= Math.min(boundaries, count); i++) shown.add(i);
      for (let i = Math.max(1, count - boundaries + 1); i <= count; i++) shown.add(i);
      for (let i = Math.max(1, here - siblings); i <= Math.min(count, here + siblings); i++) {
        shown.add(i);
      }

      const entries: PaginationEntry[] = [];
      let last = 0;
      for (const number of [...shown].sort((a, b) => a - b)) {
        const gap = number - last - 1;
        if (gap === 1) {
          // An ellipsis standing for exactly one page takes the room the
          // number would have taken and costs a click to find out what it hid.
          entries.push({ type: 'page', key: `page-${last + 1}`, page: last + 1 });
        } else if (gap > 1) {
          entries.push({
            type: 'ellipsis',
            key: `gap-${last + 1}`,
            from: last + 1,
            to: number - 1,
            count: gap,
          });
        }
        entries.push({ type: 'page', key: `page-${number}`, page: number });
        last = number;
      }
      return entries;
    },

    announcement() {
      const format = labels.status ?? ((p: number, count: number) => `Page ${p} of ${count}`);
      return format(page(), pageCount());
    },

    goTo: (next) => setPage(next),
    first: () => setPage(1),
    previous: () => setPage(untrack(page) - 1),
    next: () => setPage(untrack(page) + 1),
    last: () => setPage(untrack(pageCount)),

    setPageSize(next) {
      const target = Math.max(1, Math.floor(next));
      const before = untrack(pageSize);
      if (before === target) return;

      // Keep the item at the top of the current page in view. The alternative,
      // jumping back to page 1, loses the reader's place for the sake of a
      // simpler rule.
      const firstItem = (untrack(page) - 1) * before;
      size.set(target);
      options.onPageSizeChange?.(target);
      setPage(Math.floor(firstItem / target) + 1);
    },

    isDisabled,

    navProps: () => ({
      role: 'navigation',
      'aria-label': labels.nav ?? 'Pagination',
    }),

    listProps: () => ({
      // `list-style: none` takes list semantics away in some browsers, and how
      // many pages there are is worth hearing.
      role: 'list',
      onkeydown: onKeyDown,
      onclick: onClick,
      // `focusin` and `focusout` rather than a listener per control: they
      // bubble, so one pair follows focus however it moved.
      onfocusin: onFocusIn,
      onfocusout: onFocusOut,
    }),

    pageProps(number) {
      const key = String(number);
      const isCurrent = page() === number;
      return {
        [PAGINATION_ITEM_ATTRIBUTE]: key,
        // The visible text is a bare number, which is not a name. "3" on its
        // own tells a screen reader user nothing about what pressing it does.
        'aria-label': (labels.page ?? ((p: number) => `Page ${p}`))(number),
        'aria-current': isCurrent ? 'page' : undefined,
        'data-state': isCurrent ? 'active' : 'inactive',
        tabindex: tabStop(key),
      };
    },

    ellipsisProps: () => ({
      // Decoration: the numbers either side already say pages are missing, and
      // the live region says how many there are in total. It is deliberately
      // not an item, so the arrow keys pass straight over it.
      'aria-hidden': 'true',
    }),

    controlProps(control) {
      const disabled = isDisabled(control);
      return {
        [PAGINATION_ITEM_ATTRIBUTE]: control,
        'aria-label': labels[control] ?? DEFAULT_CONTROL_LABELS[control],
        // `aria-disabled`, never the `disabled` attribute: a control that is
        // disabled natively cannot be focused, so a keyboard user never learns
        // it is there. The `data-` twin is what the arrow keys skip by.
        'aria-disabled': disabled ? 'true' : undefined,
        'data-disabled': disabled ? '' : undefined,
        tabindex: tabStop(control),
      };
    },

    statusProps: () => ({
      // The role and the `aria-live` say the same thing on purpose: the role's
      // implicit politeness is not honoured everywhere, and the pair does no
      // harm. Atomic, because "Page 3 of 9" only makes sense whole.
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    }),
  };
}

const DEFAULT_CONTROL_LABELS: Record<PaginationControl, string> = {
  first: 'First page',
  previous: 'Previous page',
  next: 'Next page',
  last: 'Last page',
};

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

/** Marks a step, and records its index. */
export const STEP_ATTRIBUTE = 'data-volt-step';

export type StepStatus = 'complete' | 'current' | 'upcoming' | 'error';

export interface StepperLabels {
  /** Names the navigation landmark. Default "Progress". */
  nav?: string;
  /** Default "Step 2 of 5". Steps are numbered from 1 for the reader. */
  step?: (position: number, count: number) => string;
  /** Default "Completed", "Current step", "Not started", "Error". */
  status?: (status: StepStatus) => string;
}

export interface StepperOptions {
  /** The list element holding the steps. */
  list: () => Element | null | undefined;
  /** How many steps there are. */
  count: () => number;

  /**
   * Supply a signal to control the current step from outside. Without one it
   * owns its own state. Steps are indexed from 0, as an index into whatever
   * array the consumer is rendering from.
   */
  value?: Signal.State<number>;
  defaultValue?: number;

  /**
   * Whether a step's work is done. Defaults to "the user has been past it",
   * which is right for a flow that validates as it goes; supply this to say
   * otherwise — a step they filled in and then invalidated is not complete.
   */
  complete?: (index: number) => boolean;
  /** Whether a step is in error. Default false. */
  error?: (index: number) => boolean;
  /** Whether a step cannot be used at all. Default false. */
  disabled?: (index: number) => boolean;

  /**
   * Steps must be reached in order. Default true: a step can be selected once
   * the user has already been that far, or once everything before it is
   * complete. False lets any step be selected at any time.
   */
  linear?: boolean;

  /** Which arrows move between steps. Default horizontal. */
  orientation?: 'horizontal' | 'vertical';
  /** Arrow keys wrap past the ends. Default false. */
  loop?: boolean;

  labels?: StepperLabels;
  onValueChange?: (index: number) => void;
}

export interface Stepper {
  /** The current step, indexed from 0. */
  value(): number;
  count(): number;
  status(index: number): StepStatus;
  /** "Completed", "Error" — for a visually hidden span inside the step. */
  statusLabel(index: number): string;
  /** "Step 2 of 5" — likewise. */
  stepLabel(index: number): string;
  /** Whether `goTo` would move to this step. */
  isSelectable(index: number): boolean;
  isFirst(): boolean;
  isLast(): boolean;

  /** Move to a step, if it can be reached from here. */
  goTo(index: number): void;
  /** Advance, skipping disabled steps. Not subject to `linear`. */
  next(): void;
  previous(): void;

  navProps(): NavigationProps;
  listProps(): NavigationProps;
  stepProps(index: number): NavigationProps;
  panelProps(index: number): NavigationProps;
  separatorProps(): NavigationProps;
}

/** The per-step things that have to stay the same across renders. */
interface StepParts {
  readonly stepId: string;
  readonly panelId: string;
}

/**
 * A sequence of steps with a status each, linear or not.
 *
 *   class Checkout {
 *     list = new Signal.State<Element | null>(null);
 *     steps = ['Basket', 'Delivery', 'Payment'];
 *     stepper = createStepper({
 *       list: () => this.list.get(),
 *       count: () => this.steps.length,
 *       error: (i) => i === 1 && this.postcodeInvalid.get(),
 *     });
 *   }
 *
 *   <nav :spread="stepper.navProps()">
 *     <ol :ref="list" :spread="stepper.listProps()">
 *       <li :for="(name, i) in steps" :key="name">
 *         <button :spread="stepper.stepProps(i)">
 *           { name } <span class="sr-only">{ stepper.statusLabel(i) }</span>
 *         </button>
 *       </li>
 *     </ol>
 *   </nav>
 *   <section :for="(name, i) in steps" :key="name" :spread="stepper.panelProps(i)">…</section>
 *
 * **What is a status and what is a state.** The stepper owns one thing: which
 * step is current. Complete, error and disabled are the application's, because
 * only it knows whether the payment step validated — so they arrive as
 * accessors and are never mirrored here. `status()` puts the two together, and
 * an errored step reports `error` even while it is the current one, because
 * that is the thing worth saying about it.
 *
 * **Linear navigation gates selection, not progress.** `goTo` refuses a step
 * the user has not earned; `next` and `previous` do not, because they are what
 * the flow's own Continue button calls, and that button has just done the
 * validating. Steps that cannot be selected stay focusable and are marked
 * `aria-disabled`, so a keyboard user can still read ahead to see what is
 * coming — unlike a step marked `disabled`, which the arrow keys skip.
 */
export function createStepper(options: StepperOptions): Stepper {
  const labels = options.labels ?? {};
  const state = options.value ?? new Signal.State(options.defaultValue ?? 0);
  const orientation = options.orientation ?? 'horizontal';
  const linear = options.linear !== false;

  /**
   * The step focus is on, when that is not the current one. Held as an index
   * rather than an element so a re-rendered list does not leave the tab stop
   * pointing at a detached node.
   */
  const focused = new Signal.State<number | null>(null);

  /** How far the user has actually got, which is what "already been there" means. */
  const furthest = new Signal.State(untrack(() => state.get()));

  const collection = createCollection(() => options.list(), { attribute: STEP_ATTRIBUTE });
  const parts = new Map<number, StepParts>();

  const count = (): number => Math.max(0, Math.floor(options.count()));
  const value = (): number => clamp(Math.floor(state.get()), 0, Math.max(count() - 1, 0));

  const isDisabled = (index: number): boolean => options.disabled?.(index) ?? false;
  const isComplete = (index: number): boolean =>
    options.complete?.(index) ?? index < furthest.get();

  const status = (index: number): StepStatus => {
    if (options.error?.(index)) return 'error';
    if (index === value()) return 'current';
    if (isComplete(index)) return 'complete';
    return 'upcoming';
  };

  const isSelectable = (index: number): boolean => {
    if (!Number.isInteger(index) || index < 0 || index >= count()) return false;
    if (isDisabled(index)) return false;
    if (!linear) return true;
    if (index <= furthest.get()) return true;
    for (let i = 0; i < index; i++) if (!isComplete(i)) return false;
    return true;
  };

  const setValue = (next: number) => {
    const target = clamp(Math.floor(next), 0, Math.max(untrack(count) - 1, 0));
    if (untrack(value) === target) return;
    state.set(target);
    options.onValueChange?.(target);
  };

  const step = (delta: number) => {
    const size = untrack(count);
    let index = untrack(value) + delta;
    while (index >= 0 && index < size && isDisabled(index)) index += delta;
    if (index < 0 || index >= size) return;
    setValue(index);
  };

  const goTo = (index: number) => {
    if (!isSelectable(index)) return;
    setValue(index);
  };

  const indexOf = (el: Element | null | undefined): number | null => {
    const raw = el?.getAttribute(STEP_ATTRIBUTE);
    if (raw === null || raw === undefined) return null;
    const index = Number(raw);
    return Number.isFinite(index) ? index : null;
  };

  const elementFor = (index: number): HTMLElement | null =>
    collection.all().find((el) => indexOf(el) === index) ?? null;

  const partsFor = (index: number): StepParts => {
    const existing = parts.get(index);
    if (existing) return existing;
    const created: StepParts = { stepId: createId('step'), panelId: createId('step-panel') };
    parts.set(index, created);
    return created;
  };

  // Track how far the user has been, including when the step is set from
  // outside — a flow driven by the URL moves the current step without ever
  // calling anything here.
  effect(() => {
    const here = value();
    untrack(() => {
      if (here > furthest.get()) furthest.set(here);
    });
  });

  const roving = createRovingFocus(
    collection,
    () => elementFor(focused.get() ?? value()),
    (el) => {
      const index = indexOf(el);
      if (index !== null) focused.set(index);
    },
    {
      orientation,
      loop: options.loop === true,
      // No typeahead: step labels are few, all on screen, and a stepper is not
      // a list anyone searches by letter.
      typeahead: false,
      onSelect: (item) => {
        const index = indexOf(item);
        if (index !== null) goTo(index);
      },
    },
  );

  const onKeyDown = (event: Event) => {
    if (!isKeyboardEvent(event)) return;
    if (event.key === 'Enter' || event.key === ' ') {
      const item = itemFrom(event.target, STEP_ATTRIBUTE);
      // A step rendered as a link belongs to the browser: Enter follows it,
      // and the click it fires selects the step here.
      if (item && isLink(item)) return;
    }
    // Only the keys the list actually consumed: an ArrowDown a horizontal
    // stepper did not claim must still scroll the page.
    if (roving.onKeyDown(event)) event.preventDefault();
  };

  const onClick = (event: Event) => {
    const item = itemFrom(event.target, STEP_ATTRIBUTE);
    const index = indexOf(item);
    if (index === null) return;
    if (!isSelectable(index)) {
      // Visibly there, and refusing quietly is not enough: an `<a>` step would
      // otherwise navigate to a step the flow has not reached.
      event.preventDefault();
      return;
    }
    goTo(index);
  };

  const onFocusIn = (event: Event) => {
    const index = indexOf(itemFrom(event.target, STEP_ATTRIBUTE));
    if (index !== null) focused.set(index);
  };

  const onFocusOut = (event: Event) => {
    const next = isFocusEvent(event) ? event.relatedTarget : null;
    if (next instanceof Node && options.list()?.contains(next)) return;
    focused.set(null);
  };

  return {
    value,
    count,
    status,

    statusLabel: (index) =>
      (labels.status ?? ((s: StepStatus) => DEFAULT_STATUS_LABELS[s]))(status(index)),

    stepLabel: (index) =>
      (labels.step ?? ((position: number, size: number) => `Step ${position} of ${size}`))(
        index + 1,
        count(),
      ),

    isSelectable,
    isFirst: () => value() === 0,
    isLast: () => value() >= count() - 1,

    goTo,
    next: () => step(1),
    previous: () => step(-1),

    navProps: () => ({
      role: 'navigation',
      'aria-label': labels.nav ?? 'Progress',
    }),

    listProps: () => ({
      role: 'list',
      'data-orientation': orientation,
      onkeydown: onKeyDown,
      onclick: onClick,
      onfocusin: onFocusIn,
      onfocusout: onFocusOut,
    }),

    stepProps(index) {
      const { stepId, panelId } = partsFor(index);
      return {
        id: stepId,
        [STEP_ATTRIBUTE]: String(index),
        // `step`, not `page`: this marks a position in a sequence the user is
        // working through, which is the one thing `aria-current` has a value
        // for that says so.
        'aria-current': index === value() ? 'step' : undefined,
        // Announced as unavailable while it stays reachable, so a keyboard
        // user can read ahead. Only an explicitly disabled step also gets the
        // `data-` twin, which is what the arrow keys skip by.
        'aria-disabled': isSelectable(index) ? undefined : 'true',
        'data-disabled': isDisabled(index) ? '' : undefined,
        'aria-controls': panelId,
        'data-status': status(index),
        // One tab stop for the whole list, on the step Tab should land on: the
        // focused one while the list has focus, the current one once it has
        // gone.
        tabindex: (focused.get() ?? value()) === index ? '0' : '-1',
      };
    },

    panelProps(index) {
      const { stepId, panelId } = partsFor(index);
      return {
        id: panelId,
        // A group, not a region: a landmark for every step would bury the
        // page's real landmarks in a list of five.
        role: 'group',
        'aria-labelledby': stepId,
        'data-status': status(index),
        // Hidden rather than unmounted, so `aria-controls` on every step
        // resolves. A consumer who prefers `:if` loses nothing else by it.
        hidden: index !== value(),
      };
    },

    separatorProps: () => ({
      // The line between two steps is decoration; the statuses either side
      // already say what it is drawing.
      'aria-hidden': 'true',
      'data-orientation': orientation,
    }),
  };
}

const DEFAULT_STATUS_LABELS: Record<StepStatus, string> = {
  complete: 'Completed',
  current: 'Current step',
  upcoming: 'Not started',
  error: 'Error',
};

// ---------------------------------------------------------------------------
// Navigation menu
// ---------------------------------------------------------------------------

/** Marks a top-level item, and records its key. */
export const NAV_ITEM_ATTRIBUTE = 'data-volt-nav-item';

/** Marks an item inside a submenu. Separate, so the bar does not collect them. */
export const NAV_SUBITEM_ATTRIBUTE = 'data-volt-nav-subitem';

/** Where focus lands when a submenu opens. */
export type NavigationOpenFocus = 'first' | 'last' | 'none';

export interface NavigationMenuLabels {
  /** Names the menubar. Default "Main navigation". */
  menubar?: string;
}

export interface NavigationItemOptions {
  /** Passed to `onSelect`, so a loop of items needs no per-item wiring. */
  value?: string;
  /** Marks the item as the page the user is on. */
  current?: boolean;
  /** Skipped by the arrow keys, still announced. */
  disabled?: boolean;
}

export interface NavigationMenuOptions {
  /** The menubar element, once rendered. The top-level items are inside it. */
  menubar: () => Element | null | undefined;
  /**
   * A submenu's content element, by the key of the item that owns it.
   *
   * Read a signal here for every key, including the closed ones: the effect
   * that wires dismissal and focus subscribes to whatever this reads, and an
   * accessor that returns `undefined` without reading anything never tells it
   * the submenu has rendered.
   */
  submenu?: (key: string) => Element | null | undefined;

  /** Arrow keys wrap past the ends of the bar. Default true. */
  loop?: boolean;
  /** Typing letters jumps to a matching item. Default true. */
  typeahead?: boolean;

  labels?: NavigationMenuLabels;
  onOpenChange?: (key: string | null) => void;
  /** `value` is whatever the item's props were given. */
  onSelect?: (item: HTMLElement, value: string | undefined) => void;
}

export interface NavigationMenu {
  /** The key of the item whose submenu is open, or null. */
  openKey(): string | null;
  isOpen(key: string): boolean;
  /** The item holding the bar's tab stop. */
  activeKey(): string | null;

  open(key: string, focus?: NavigationOpenFocus): void;
  /** Close the open submenu. `restoreFocus` puts focus back on its trigger. */
  close(restoreFocus?: boolean): void;

  menubarProps(): NavigationProps;
  /** A top-level item with no submenu — a plain link. */
  itemProps(key: string, item?: NavigationItemOptions): NavigationProps;
  /** A top-level item that opens a submenu. */
  triggerProps(key: string, item?: NavigationItemOptions): NavigationProps;
  submenuProps(key: string): NavigationProps;
  submenuItemProps(item?: NavigationItemOptions): NavigationProps;
}

/** The per-key things that have to stay the same across renders. */
interface NavigationParts {
  readonly triggerId: string;
  readonly submenuId: string;
}

/**
 * A menubar of links, each of which may open a submenu of more links.
 *
 *   class SiteNav {
 *     bar = new Signal.State<Element | null>(null);
 *     docsPanel = new Signal.State<Element | null>(null);
 *     nav = createNavigationMenu({
 *       menubar: () => this.bar.get(),
 *       submenu: (key) => (key === 'docs' ? this.docsPanel.get() : null),
 *     });
 *   }
 *
 *   <nav>
 *     <ul :ref="bar" :spread="nav.menubarProps()">
 *       <li><a href="/pricing" :spread="nav.itemProps('pricing')">Pricing</a></li>
 *       <li>
 *         <button :spread="nav.triggerProps('docs')">Docs</button>
 *         <ul :if="nav.isOpen('docs')" :ref="docsPanel" :spread="nav.submenuProps('docs')">
 *           <li><a href="/docs/start" :spread="nav.submenuItemProps()">Get started</a></li>
 *         </ul>
 *       </li>
 *     </ul>
 *   </nav>
 *
 * **How this differs from a Menu.** A menu item runs a command, so Enter and
 * Space both activate it and the component decides what that means. A
 * navigation item goes somewhere, so the browser decides: Enter follows the
 * link, and Space does nothing at all — on a link Space scrolls the page, and
 * a link that activates on Space is a link that cannot be scrolled past. Only
 * the submenu triggers are buttons, and those do take Space, because that is
 * what a button's contract says.
 *
 * That distinction is why this does not compose `createMenu`, which would
 * bring the wrong contract with it — and why an open submenu has no focus
 * trap. Left and Right have to carry focus out of a submenu and along the bar,
 * which is exactly the move a trap exists to prevent.
 *
 * The keyboard map is the WAI-ARIA menubar pattern, with the link contract
 * taking precedence where they disagree:
 *
 *   bar       Left, Right                 previous, next item — wrapping
 *             Down, Up                    open a submenu, on its first or last item
 *             Enter                       follow a link, or open a submenu
 *             Space                       open a submenu; nothing on a link
 *             Home, End                   first, last item
 *             printable characters        typeahead
 *   submenu   Down, Up                    next, previous item
 *             Home, End                   first, last item
 *             Right, Left                 the next or previous bar item, opening its submenu
 *             Enter                       follow the link
 *             Escape                      close, focus back on the trigger
 *             Tab                         close, focus back on the trigger, carry on out
 *
 * **The cost of `role="menubar"`.** These items are announced as menu items
 * rather than links, which is the price of the bar being one tab stop instead
 * of twenty. A site whose navigation is a handful of links is better served by
 * a plain list of them, where Tab reaches each and every one is announced as
 * what it is.
 *
 * The bar is horizontal, and there is no option for anything else. A menubar
 * is horizontal by definition in ARIA, and a column of navigation links down
 * the side of a page is a different pattern with a different keyboard map —
 * one this would only half implement.
 */
export function createNavigationMenu(options: NavigationMenuOptions): NavigationMenu {
  const labels = options.labels ?? {};

  const open = new Signal.State<string | null>(null);
  /** The bar's tab stop, held as a key so a re-rendered bar keeps one. */
  const active = new Signal.State<string | null>(null);
  const parts = new Map<string, NavigationParts>();

  const bar = createCollection(() => options.menubar(), { attribute: NAV_ITEM_ATTRIBUTE });
  const sub = createCollection(
    () => {
      const key = open.get();
      return key === null ? null : options.submenu?.(key);
    },
    { attribute: NAV_SUBITEM_ATTRIBUTE },
  );

  const subActive = new Signal.State<HTMLElement | null>(null);

  const keyOf = (el: Element | null | undefined): string | null =>
    el?.getAttribute(NAV_ITEM_ATTRIBUTE) ?? null;

  // Walked rather than selected: a key is application data, and putting one in
  // a selector would need `CSS.escape`, which does not exist on a server.
  const elementFor = (key: string): HTMLElement | null =>
    bar.all().find((el) => keyOf(el) === key) ?? null;

  const partsFor = (key: string): NavigationParts => {
    const existing = parts.get(key);
    if (existing) return existing;
    const created: NavigationParts = {
      triggerId: createId('nav-trigger'),
      submenuId: createId('nav-submenu'),
    };
    parts.set(key, created);
    return created;
  };

  const setOpen = (next: string | null) => {
    if (untrack(() => open.get()) === next) return;
    open.set(next);
    options.onOpenChange?.(next);
  };

  /**
   * Where focus should land once the submenu exists.
   *
   * Held across the render because the effect below runs after the key that
   * opened it has been and gone, and the DOM cannot be asked which one it was.
   */
  let openFocus: NavigationOpenFocus = 'none';

  const openSubmenu = (key: string, focus: NavigationOpenFocus = 'none') => {
    openFocus = focus;
    active.set(key);
    setOpen(key);
  };

  const close = (restoreFocus = false) => {
    const key = untrack(() => open.get());
    setOpen(null);
    if (!restoreFocus || key === null) return;
    elementFor(key)?.focus();
  };

  const barRoving = createRovingFocus(
    bar,
    () => {
      const key = active.get();
      return key === null ? null : elementFor(key);
    },
    (el) => active.set(keyOf(el)),
    {
      orientation: 'horizontal',
      loop: options.loop !== false,
      typeahead: options.typeahead,
      // No `onSelect`: Enter and Space are intercepted before this ever sees
      // them, so that the link contract holds.
    },
  );

  const subRoving = createRovingFocus(
    sub,
    () => subActive.get(),
    (el) => subActive.set(el),
    {
      orientation: 'vertical',
      loop: options.loop !== false,
      typeahead: options.typeahead,
    },
  );

  const isTrigger = (el: Element | null): boolean => el?.getAttribute('aria-haspopup') === 'menu';

  /** Move along the bar, carrying an open submenu with us. */
  const moveAlongBar = (event: KeyboardEvent): boolean => {
    const before = untrack(() => active.get());
    const wasOpen = untrack(() => open.get()) !== null;
    if (!barRoving.onKeyDown(event)) return false;

    const key = untrack(() => active.get());
    if (key === null || key === before) return true;

    // Only when a submenu was already open. Moving along a closed bar is
    // moving focus and nothing else — opening menus as focus passes over them
    // is what makes a menubar unusable with a keyboard.
    if (wasOpen && isTrigger(elementFor(key))) openSubmenu(key, 'first');
    else setOpen(null);
    return true;
  };

  const onBarKeyDown = (event: Event) => {
    if (!isKeyboardEvent(event)) return;
    // A modified key is a shortcut. ⌘-Enter on a link opens a new tab, and
    // that has to reach the browser untouched.
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const item = itemFrom(event.target, NAV_ITEM_ATTRIBUTE) ?? null;
    const key = keyOf(item);
    const trigger = isTrigger(item);

    switch (event.key) {
      case 'Enter':
      case ' ':
        if (trigger && key !== null) {
          // Enter and Space on a button also fire a click, which would toggle
          // the submenu straight back shut.
          event.preventDefault();
          openSubmenu(key, 'first');
        }
        // Otherwise the item is a link: Enter is the browser's to follow, and
        // Space is the browser's to scroll with.
        return;

      case 'ArrowDown':
      case 'ArrowUp':
        // Down and Up across a horizontal bar mean "into the submenu". On an
        // item without one they are left alone, so the page still scrolls.
        if (!trigger || key === null) return;
        event.preventDefault();
        openSubmenu(key, event.key === 'ArrowDown' ? 'first' : 'last');
        return;

      case 'ArrowLeft':
      case 'ArrowRight':
        if (moveAlongBar(event)) event.preventDefault();
        return;

      case 'Escape':
        // Dismissal owns Escape while a submenu is open, on the document and
        // in the capture phase, so that one press closes one layer.
        return;

      case 'Tab':
        // Not prevented: focus leaves the bar and the browser carries on from
        // the item it was on.
        setOpen(null);
        return;

      default:
        break;
    }

    // Home, End and typeahead.
    if (barRoving.onKeyDown(event)) event.preventDefault();
  };

  const onSubmenuKeyDown = (event: Event) => {
    if (!isKeyboardEvent(event)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // The submenu and the bar are two halves of one widget, and this is the
    // inner half. A submenu rendered inside the bar rather than portalled out
    // of it shares the bar's bubble path, and one Right press would move two
    // items along. Dismissal is unaffected: it listens on the document in the
    // capture phase, so Escape has already been dealt with by the time this
    // runs.
    event.stopPropagation();

    switch (event.key) {
      case 'Enter':
      case ' ':
        // Links again: Enter follows and fires a click, which the handler
        // below turns into a close; Space scrolls.
        return;

      case 'Tab':
        // Focus goes back to the trigger first, so the browser's own Tab
        // continues from the bar rather than from wherever the submenu was
        // portalled to.
        close(true);
        return;

      case 'Escape':
        // Dismissal owns it; see above.
        return;

      case 'ArrowLeft':
      case 'ArrowRight':
        // Handed to the bar's own handler so that Left and Right still mirror
        // under `dir="rtl"` — the one place that rule is written down.
        if (moveAlongBar(event)) event.preventDefault();
        return;

      default:
        break;
    }

    if (subRoving.onKeyDown(event)) event.preventDefault();
  };

  const onBarClick = (event: Event) => {
    const item = itemFrom(event.target, NAV_ITEM_ATTRIBUTE);
    if (!item) return;

    if (isDisabledElement(item)) {
      event.preventDefault();
      return;
    }

    const key = keyOf(item);
    if (key === null) return;
    active.set(key);

    if (isTrigger(item)) {
      // A trigger is a button, whatever element it is written as: pressing it
      // opens the submenu rather than going anywhere.
      event.preventDefault();
      if (untrack(() => open.get()) === key) setOpen(null);
      else openSubmenu(key, 'none');
      return;
    }

    setOpen(null);
    options.onSelect?.(item, item.getAttribute('data-value') ?? undefined);
  };

  const onBarFocusIn = (event: Event) => {
    const key = keyOf(itemFrom(event.target, NAV_ITEM_ATTRIBUTE));
    // Not cleared on the way out: APG puts focus back on the item that had it
    // when Tab comes round again.
    if (key !== null) active.set(key);
  };

  const onSubmenuClick = (event: Event) => {
    const item = itemFrom(event.target, NAV_SUBITEM_ATTRIBUTE);
    if (!item) return;
    if (isDisabledElement(item)) {
      event.preventDefault();
      return;
    }
    // Not prevented, and focus is not restored: the link is navigating, and
    // pulling focus back to the trigger on the way out would land it on an
    // element the new page is about to replace.
    setOpen(null);
    options.onSelect?.(item, item.getAttribute('data-value') ?? undefined);
  };

  // Give the bar a tab stop as soon as it has items. `bar.first()` reads the
  // menubar accessor, so this re-runs when the element arrives — which is the
  // first moment the items exist to be counted.
  effect(() => {
    const first = bar.first();
    if (!first) return;
    untrack(() => {
      if (active.get() !== null) return;
      const key = keyOf(first);
      if (key !== null) active.set(key);
    });
  });

  // Everything that only applies while a submenu is open lives in one effect,
  // so it is set up and torn down as a unit.
  effect(() => {
    const key = open.get();
    if (key === null) return;
    const content = options.submenu?.(key);
    if (!content) return;

    createDismiss(
      () => content,
      (reason: DismissReason) => {
        // Escape came from the keyboard, so focus has to go somewhere the
        // keyboard can carry on from. A press outside has already given focus
        // to whatever was pressed.
        close(reason === 'escape');
      },
      { exclude: () => [elementFor(key)] },
    );

    const target =
      openFocus === 'first' ? sub.first() : openFocus === 'last' ? sub.last() : null;
    if (target) subRoving.focus(target);
    // Cleared so that a submenu opened by pointer later does not inherit a
    // focus intent from the last time it was opened by keyboard.
    openFocus = 'none';

    onCleanup(() => subActive.set(null));
  });

  return {
    openKey: () => open.get(),
    isOpen: (key) => open.get() === key,
    activeKey: () => active.get(),

    open: (key, focus) => openSubmenu(key, focus),
    close,

    menubarProps: () => ({
      role: 'menubar',
      // No `aria-orientation`: horizontal is ARIA's own default for a menubar,
      // and this bar is never anything else.
      'aria-label': labels.menubar ?? 'Main navigation',
      onkeydown: onBarKeyDown,
      onclick: onBarClick,
      onfocusin: onBarFocusIn,
    }),

    itemProps: (key, item = {}) => ({
      [NAV_ITEM_ATTRIBUTE]: key,
      role: 'menuitem',
      'aria-current': item.current ? 'page' : undefined,
      // `aria-disabled`, never the `disabled` attribute: the item stays in the
      // accessibility tree and can be heard to be unavailable. The `data-`
      // twin is what the arrow keys skip by.
      'aria-disabled': item.disabled ? 'true' : undefined,
      'data-disabled': item.disabled ? '' : undefined,
      'data-value': item.value,
      tabindex: active.get() === key ? '0' : '-1',
    }),

    triggerProps: (key, item = {}) => {
      const { triggerId, submenuId } = partsFor(key);
      const isOpen = open.get() === key;
      return {
        id: triggerId,
        [NAV_ITEM_ATTRIBUTE]: key,
        role: 'menuitem',
        // Also the flag every handler here reads to tell a trigger from a
        // link, which is what decides whether Space does anything.
        'aria-haspopup': 'menu',
        'aria-expanded': String(isOpen),
        // Only while the submenu exists: pointing at an id that is not in the
        // document is a dangling reference.
        'aria-controls': isOpen ? submenuId : undefined,
        'aria-current': item.current ? 'page' : undefined,
        'aria-disabled': item.disabled ? 'true' : undefined,
        'data-disabled': item.disabled ? '' : undefined,
        'data-value': item.value,
        'data-state': isOpen ? 'open' : 'closed',
        tabindex: active.get() === key ? '0' : '-1',
      };
    },

    submenuProps: (key) => {
      const { triggerId, submenuId } = partsFor(key);
      return {
        id: submenuId,
        role: 'menu',
        'aria-labelledby': triggerId,
        'data-state': open.get() === key ? 'open' : 'closed',
        onkeydown: onSubmenuKeyDown,
        onclick: onSubmenuClick,
        // Focusable so a submenu with nothing in it still has somewhere to put
        // focus that is not the page behind.
        tabindex: '-1',
      };
    },

    submenuItemProps: (item = {}) => ({
      [NAV_SUBITEM_ATTRIBUTE]: '',
      role: 'menuitem',
      'aria-current': item.current ? 'page' : undefined,
      'aria-disabled': item.disabled ? 'true' : undefined,
      'data-disabled': item.disabled ? '' : undefined,
      'data-value': item.value,
      // No submenu item is in the tab order. Tab closes the submenu rather
      // than walking it, so focus is moved to items directly.
      tabindex: '-1',
    }),
  };
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * Whether an element is a link the browser will follow.
 *
 * The whole link contract turns on this: an `<a>` without an `href` is not a
 * link, it is a `<span>` someone styled blue, and it activates on whatever key
 * the component says it does.
 */
function isLink(el: Element): boolean {
  return el.matches('a[href], area[href]');
}

/** The item an event happened in, allowing for markup inside the item. */
function itemFrom(target: EventTarget | null, attribute: string): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(`[${attribute}]`);
}

/**
 * The same two attributes the collection skips by, so that navigation and
 * activation can never disagree about what is disabled.
 */
function isDisabledElement(el: Element): boolean {
  return el.hasAttribute('data-disabled') || el.hasAttribute('disabled');
}

function widthOf(el: Element): number {
  return el.getBoundingClientRect().width;
}

function sum(values: readonly number[]): number {
  let out = 0;
  for (const value of values) out += value;
  return out;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Re-measure when the element changes size.
 *
 * Where there is no `ResizeObserver` — on a server, or in a test environment
 * with no layout — the last measurement simply stands.
 */
function observeSize(el: Element, onResize: () => void): void {
  const view = el.ownerDocument?.defaultView;
  if (typeof view?.ResizeObserver !== 'function') return;

  const observer = new view.ResizeObserver(onResize);
  observer.observe(el);
  onCleanup(() => observer.disconnect());
}

/**
 * Narrowing by shape rather than `instanceof`.
 *
 * The props are typed as plain listeners because that is what a spread hands
 * them, and `instanceof` is not reliable across documents anyway — a menu
 * portalled into another window has events from that window's realm.
 */
function isKeyboardEvent(event: Event): event is KeyboardEvent {
  return 'key' in event;
}

function isFocusEvent(event: Event): event is FocusEvent {
  return 'relatedTarget' in event;
}

function isMouseEvent(event: Event): event is MouseEvent {
  return 'clientX' in event;
}

function isPointerEvent(event: Event): event is PointerEvent {
  return 'pointerId' in event;
}
