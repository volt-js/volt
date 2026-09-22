/**
 * Navigation, driven through real mounted components.
 *
 * What is worth asserting here is not that the components work but that they
 * behave under the cases that break navigation widgets in the wild: a trail
 * measured against a container it does not fit in, a page row whose numbers
 * move under the arrow keys, a stepper asked to skip ahead, and — the one that
 * catches almost everybody — a menubar of links where Space must do nothing
 * and Enter must be left to the browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, flushSync, mount } from '@voltdev/core';
import { createLocaleProvider } from '../src/i18n.ts';
import {
  CRUMB_ATTRIBUTE,
  CRUMB_OVERFLOW_ATTRIBUTE,
  NAV_ITEM_ATTRIBUTE,
  NAV_SUBITEM_ATTRIBUTE,
  PAGINATION_ITEM_ATTRIBUTE,
  STEP_ATTRIBUTE,
  createBreadcrumb,
  createNavigationMenu,
  createPagination,
  createStepper,
  type StepStatus,
} from '../src/navigation.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><button id="outside">outside</button>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
});

function press(key: string, target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

function clickOn(el: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

function pressOutside(el: Element): void {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  el.dispatchEvent(new Event('pointerup', { bubbles: true }));
  flushSync();
}

/** Focus moving out of a group, which is what hands the tab stop back. */
function focusOut(from: Element, to: Element | null): void {
  from.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: to }));
  flushSync();
}

function focused(): Element | null {
  return document.activeElement;
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

describe('breadcrumb', () => {
  /** Six crumbs, so there is a middle worth collapsing. */
  function defineTrail(options: { itemsBefore?: number; itemsAfter?: number; collapse?: boolean }) {
    const onCollapseChange = vi.fn();

    @Component({
      selector: 'v-trail',
      render: compileTemplate(`
        <nav :spread="crumbs.navProps()">
          <ol :ref="list" :spread="crumbs.listProps()">
            <li :for="(name, i) in trail.get()" :key="name" :spread="crumbs.itemProps(i)">
              <a href="/{ name }" :spread="crumbs.linkProps(i)">{ name }</a>
              <span :spread="crumbs.separatorProps()">/</span>
            </li>
            <li :spread="crumbs.overflowProps()">
              <button :ref="trigger" :spread="crumbs.overflowTriggerProps()">…</button>
              <div :if="crumbs.menu.isPresent()" :ref="content"
                   :spread="crumbs.overflowContentProps()">
                <a :for="i in crumbs.collapsed()" :key="i" href="#"
                   :spread="crumbs.overflowLinkProps(i)">{ trail.get()[i] }</a>
              </div>
            </li>
          </ol>
        </nav>
      `),
    })
    class Trail {
      trail = new Signal.State(['Home', 'Docs', 'Guides', 'Routing', 'Nested', 'Params']);
      list = new Signal.State<Element | null>(null);
      trigger = new Signal.State<Element | null>(null);
      content = new Signal.State<Element | null>(null);
      crumbs = createBreadcrumb({
        list: () => this.list.get(),
        count: () => this.trail.get().length,
        overflowTrigger: () => this.trigger.get(),
        overflowContent: () => this.content.get(),
        onCollapseChange,
        ...options,
      });
    }

    return { Trail, onCollapseChange };
  }

  interface Layout {
    /** What the list has to give. */
    available: number;
    /** Each crumb's width. */
    crumb?: number;
    /** The gaps between the crumbs, all of them together. */
    chrome?: number;
    /** The list's own padding, which is chrome that no gap ever holds. */
    padding?: number;
    /** What the overflow trigger's slot costs once it appears. */
    slot?: number;
  }

  /**
   * Lay the trail out. happy-dom has no layout, so every box a measurement
   * reads is stubbed here — positions included, because what the slot costs is
   * worked out from where its neighbours sit. Elements are placed in a row, in
   * the order they appear on screen: the slot sits where the collapse happens,
   * which is after the crumbs that are always kept.
   */
  function layout(list: HTMLElement, spec: Layout, slotAfter: number): void {
    const crumb = spec.crumb ?? 100;
    const chrome = spec.chrome ?? 0;
    const padding = spec.padding ?? 0;
    const slot = spec.slot ?? 60;

    const items = [...list.querySelectorAll<HTMLElement>(`[${CRUMB_ATTRIBUTE}]`)];
    const overflow = list.querySelector<HTMLElement>(`[${CRUMB_OVERFLOW_ATTRIBUTE}]`);
    const gap = chrome / Math.max(items.length - 1, 1);

    let x = padding / 2;
    const place = (el: HTMLElement, width: number) => {
      const rect = new DOMRect(x, 0, width, 20);
      el.getBoundingClientRect = () => rect;
      x += width + gap;
    };
    for (const [i, el] of items.entries()) {
      if (i === slotAfter && overflow) place(overflow, slot);
      place(el, crumb);
    }
    if (overflow && slotAfter >= items.length) place(overflow, slot);

    Object.defineProperty(list, 'clientWidth', { value: spec.available, configurable: true });
    // What the trail wants with every crumb and the trigger's slot shown,
    // which is the state the measurement reads it in.
    Object.defineProperty(list, 'scrollWidth', {
      value: x - gap + padding / 2,
      configurable: true,
    });
  }

  function setup(options: Parameters<typeof defineTrail>[0] = {}) {
    const { Trail, onCollapseChange } = defineTrail(options);
    const handle = track(mount(Trail, host));
    flushSync();
    const instance = handle.instance as InstanceType<typeof Trail>;

    return {
      instance,
      crumbs: instance.crumbs,
      onCollapseChange,
      list: (): HTMLElement => host.querySelector('ol')!,
      items: (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(`[${CRUMB_ATTRIBUTE}]`)],
      links: (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('ol a')],
      overflow: (): HTMLElement => host.querySelector(`[${CRUMB_OVERFLOW_ATTRIBUTE}]`)!,
      trigger: (): HTMLElement => host.querySelector('button')!,
      menu: (): HTMLElement | null => host.querySelector('[role="menu"]'),
      /** Lay the trail out and measure it, as a resize would. */
      resize(spec: Layout) {
        layout(host.querySelector('ol')!, spec, options.itemsBefore ?? 1);
        instance.crumbs.measure();
        flushSync();
      },
    };
  }

  it('names the landmark and keeps the list semantic', () => {
    const { list } = setup();
    const nav = host.querySelector('nav')!;

    expect(nav.getAttribute('role')).toBe('navigation');
    expect(nav.getAttribute('aria-label')).toBe('Breadcrumb');
    // `list-style: none` takes list semantics away in some browsers, and how
    // deep the trail is is worth hearing.
    expect(list().getAttribute('role')).toBe('list');
  });

  it('marks only the last crumb as the current page, and moves it as the trail grows', () => {
    const { instance, links } = setup();

    const current = links().filter((el) => el.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toBe('Params');

    instance.trail.set([...instance.trail.get(), 'Query']);
    flushSync();

    expect(links().at(-1)!.getAttribute('aria-current')).toBe('page');
    expect(links().at(-2)!.hasAttribute('aria-current')).toBe(false);
  });

  it('hides the separators from assistive technology', () => {
    setup();
    for (const separator of host.querySelectorAll('ol span')) {
      expect(separator.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('collapses nothing when there is no layout to measure', () => {
    const { crumbs, items, overflow } = setup();

    // A zero-width container is a container that has not been laid out yet.
    // Collapsing the whole trail on the strength of that is worse than waiting.
    expect(crumbs.collapsed()).toEqual([]);
    expect(items().some((el) => el.hidden)).toBe(false);
    expect(overflow().hidden).toBe(true);
  });

  it('collapses the fewest middle crumbs that make the rest fit', () => {
    const { crumbs, items, resize } = setup();

    // Six crumbs of 100, a 60-wide trigger slot, 500 to fit it all in:
    // one collapsed is 500 + 60, two is 400 + 60.
    resize({ available: 500 });

    expect(crumbs.collapsed()).toEqual([1, 2]);
    expect(items().map((el) => el.hidden)).toEqual([false, true, true, false, false, false]);
  });

  it('keeps the root and the current page whatever happens', () => {
    const { crumbs, items, resize } = setup();

    resize({ available: 10 });

    expect(crumbs.collapsed()).toEqual([1, 2, 3, 4]);
    expect(items()[0]!.hidden).toBe(false);
    expect(items()[5]!.hidden).toBe(false);
  });

  it('honours itemsBefore and itemsAfter', () => {
    const { crumbs, items, resize } = setup({ itemsBefore: 2, itemsAfter: 2 });

    resize({ available: 10 });

    expect(crumbs.collapsed()).toEqual([2, 3]);
    expect(items().map((el) => el.hidden)).toEqual([false, false, true, true, false, false]);
  });

  it('puts crumbs back when there is room again', () => {
    const { crumbs, resize } = setup();

    resize({ available: 200 });
    expect(crumbs.collapsed().length).toBeGreaterThan(0);

    // The measurement is taken from scratch each time rather than only ever
    // collapsing further, so a window that grows undoes what one that shrank
    // did.
    resize({ available: 600 });
    expect(crumbs.collapsed()).toEqual([]);
  });

  it('counts the separators it cannot see', () => {
    const { crumbs, resize } = setup();

    // 600 of crumbs and 200 of separators. Everything fits in 800 and nothing
    // fits in 799 — the chrome is what makes the difference.
    resize({ available: 800, chrome: 200 });
    expect(crumbs.collapsed()).toEqual([]);

    resize({ available: 799, chrome: 200 });
    expect(crumbs.collapsed().length).toBeGreaterThan(0);
  });

  it('counts the padding no gap holds', () => {
    const { crumbs, resize } = setup();

    // 600 of crumbs inside 50 of list padding and no gaps at all, which is the
    // trail of a consumer whose separators sit inside each crumb. It wants 650
    // and has 645, and the 5 it is over is less than one crumb's share of the
    // padding — so a measurement that took an average gap out of the reading
    // instead of what the slot actually costs would call this a fit.
    resize({ available: 645, padding: 50 });

    expect(crumbs.collapsed()).toEqual([1]);
  });

  it('never measures when collapsing is turned off', () => {
    const { crumbs, items, resize } = setup({ collapse: false });

    resize({ available: 10 });

    expect(crumbs.collapsed()).toEqual([]);
    expect(items().some((el) => el.hidden)).toBe(false);
  });

  it('reports what went into the menu', () => {
    const { onCollapseChange, resize } = setup();

    resize({ available: 500 });
    expect(onCollapseChange).toHaveBeenLastCalledWith([1, 2]);

    // No second call for a measurement that changed nothing.
    onCollapseChange.mockClear();
    resize({ available: 500 });
    expect(onCollapseChange).not.toHaveBeenCalled();
  });

  it('shows the overflow trigger only while something is in it', () => {
    const { overflow, trigger, resize } = setup();

    expect(overflow().hidden).toBe(true);

    resize({ available: 500 });
    expect(overflow().hidden).toBe(false);
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    // The visible text is an ellipsis, which is not a name.
    expect(trigger().getAttribute('aria-label')).toBe('Show the rest of the path');
  });

  it('opens the hidden crumbs as a menu', () => {
    const { crumbs, trigger, menu, resize } = setup();
    resize({ available: 500 });

    clickOn(trigger());
    expect(menu()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(menu()!.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    expect(menu()!.textContent).toContain('Docs');
    expect(menu()!.textContent).toContain('Guides');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(crumbs.menu.isOpen()).toBe(false);
  });

  it('leaves Enter and Space to the browser inside the menu', () => {
    const { trigger, menu, resize } = setup();
    resize({ available: 500 });

    // Opened from the keyboard, which puts focus on the first item.
    press('Enter', trigger());
    const first = menu()!.querySelector('[role="menuitem"]')!;
    expect(focused()).toBe(first);

    // These are links. Taking Enter here would page without ever navigating,
    // and taking Space would stop the page scrolling.
    expect(press('Enter', first).defaultPrevented).toBe(false);
    expect(press(' ', first).defaultPrevented).toBe(false);
    // The arrow keys are still the menu's, or they would scroll the page.
    expect(press('ArrowDown', first).defaultPrevented).toBe(true);
  });

  it('closes the menu when the crumbs go back into the trail', () => {
    const { crumbs, trigger, overflow, resize } = setup();
    resize({ available: 500 });

    clickOn(trigger());
    expect(crumbs.menu.isOpen()).toBe(true);

    // The trigger is about to disappear from under the pointer, and the menu
    // behind it has nothing left in it.
    resize({ available: 600 });
    expect(crumbs.menu.isOpen()).toBe(false);
    expect(overflow().hidden).toBe(true);
  });

  it('reads every crumb shown, and hides them again when nothing changed', () => {
    const { crumbs, items, overflow, resize } = setup();
    resize({ available: 500 });
    expect(crumbs.collapsed()).toEqual([1, 2]);

    // A crumb read while it is hidden has no width, so each is read shown —
    // the slot too, whose width decides what collapsing one crumb saves.
    const shown: boolean[] = [];
    for (const el of [...items(), overflow()]) {
      const rect = el.getBoundingClientRect;
      el.getBoundingClientRect = () => {
        shown.push(!el.hidden);
        return rect.call(el);
      };
    }
    crumbs.measure();

    expect(shown).toEqual([true, true, true, true, true, true, true]);
    // The same answer as last time changes nothing the props read, and the
    // crumbs still have to go back.
    expect(crumbs.collapsed()).toEqual([1, 2]);
    expect(items().map((el) => el.hidden)).toEqual([false, true, true, false, false, false]);
    expect(overflow().hidden).toBe(false);
  });

  it('re-renders only the crumbs a measurement can change', () => {
    const { crumbs, resize } = setup();
    resize({ available: 500 });
    expect(crumbs.collapsed()).toEqual([1, 2]);

    // Showing a crumb for the measurement and hiding it again is two renders
    // of it, and only the collapsed crumbs are ever hidden. A crumb that is on
    // screen either way must not read what the measurement unfolds, or a
    // resize drag re-renders the whole trail twice a frame.
    const rendered: number[] = [];
    const itemProps = crumbs.itemProps;
    crumbs.itemProps = (index) => {
      rendered.push(index);
      return itemProps(index);
    };
    let slotRenders = 0;
    const overflowProps = crumbs.overflowProps;
    crumbs.overflowProps = () => {
      slotRenders += 1;
      return overflowProps();
    };
    resize({ available: 500 });

    expect([...rendered].sort()).toEqual([1, 1, 2, 2]);
    // The slot is showing and goes on showing, so it has nothing to unfold.
    expect(slotRenders).toBe(0);
  });

  it('keeps collapsed crumbs in the document so they can be measured again', () => {
    const { items, resize } = setup();
    resize({ available: 500 });

    // Hidden, not unmounted: a crumb that is not in the document has no width,
    // and its width is what decides whether it comes back.
    expect(items()).toHaveLength(6);
    expect(items()[1]!.isConnected).toBe(true);
    expect(items()[1]!.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('pagination', () => {
  function definePager(pageTag: 'button' | 'a') {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    const href = pageTag === 'a' ? ' href="#"' : '';

    @Component({
      selector: `v-pager-${pageTag}`,
      render: compileTemplate(`
        <nav :spread="pager.navProps()">
          <ul :ref="list" :spread="pager.listProps()">
            <li><button :spread="pager.controlProps('first')">«</button></li>
            <li><button :spread="pager.controlProps('previous')">‹</button></li>
            <li :for="entry in pager.pages()" :key="entry.key">
              <span :if="entry.type === 'ellipsis'" :spread="pager.ellipsisProps()">…</span>
              <${pageTag}${href} :if="entry.type === 'page'"
                 :spread="pager.pageProps(entry.page)">{ entry.page }</${pageTag}>
            </li>
            <li><button :spread="pager.controlProps('next')">›</button></li>
            <li><button :spread="pager.controlProps('last')">»</button></li>
          </ul>
          <p :spread="pager.statusProps()">{ pager.announcement() }</p>
        </nav>
      `),
    })
    class Pager {
      total = new Signal.State(95);
      page = new Signal.State(1);
      list = new Signal.State<Element | null>(null);
      pager = createPagination({
        list: () => this.list.get(),
        total: () => this.total.get(),
        page: this.page,
        onPageChange,
        onPageSizeChange,
      });
    }

    return { Pager, onPageChange, onPageSizeChange };
  }

  function setup(pageTag: 'button' | 'a' = 'button') {
    const { Pager, onPageChange, onPageSizeChange } = definePager(pageTag);
    const handle = track(mount(Pager, host));
    flushSync();
    const instance = handle.instance as InstanceType<typeof Pager>;

    const item = (key: string): HTMLElement =>
      host.querySelector<HTMLElement>(`[${PAGINATION_ITEM_ATTRIBUTE}="${key}"]`)!;

    return {
      instance,
      pager: instance.pager,
      onPageChange,
      onPageSizeChange,
      list: (): HTMLElement => host.querySelector('ul')!,
      item,
      items: (): HTMLElement[] => [
        ...host.querySelectorAll<HTMLElement>(`[${PAGINATION_ITEM_ATTRIBUTE}]`),
      ],
      goTo(page: number) {
        instance.pager.goTo(page);
        flushSync();
      },
    };
  }

  describe('the page row', () => {
    it('pins the ends and the siblings, and puts a gap between them', () => {
      const { pager, goTo } = setup();
      goTo(5);

      expect(pager.pages()).toEqual([
        { type: 'page', key: 'page-1', page: 1 },
        { type: 'ellipsis', key: 'gap-2', from: 2, to: 3, count: 2 },
        { type: 'page', key: 'page-4', page: 4 },
        { type: 'page', key: 'page-5', page: 5 },
        { type: 'page', key: 'page-6', page: 6 },
        { type: 'ellipsis', key: 'gap-7', from: 7, to: 9, count: 3 },
        { type: 'page', key: 'page-10', page: 10 },
      ]);
    });

    it('shows the page instead of a gap that would hide exactly one', () => {
      const { instance, pager } = setup();
      // Four pages, on page 1: 1, 2 and 4 are pinned, leaving 3 alone in the
      // middle. An ellipsis there takes the room the number would have taken.
      instance.total.set(40);
      flushSync();

      expect(pager.pages().map((entry) => entry.type)).toEqual([
        'page',
        'page',
        'page',
        'page',
      ]);
    });

    it('gives every slot a key that survives the current page moving', () => {
      const { pager, goTo } = setup();
      goTo(5);
      const keys = pager.pages().map((entry) => entry.key);
      expect(new Set(keys).size).toBe(keys.length);

      goTo(6);
      expect(pager.pages().map((entry) => entry.key)).toContain('page-5');
    });
  });

  describe('counting', () => {
    it('derives the page count and the range from the total', () => {
      const { pager, goTo } = setup();

      expect(pager.pageCount()).toBe(10);
      expect(pager.range()).toEqual({ start: 1, end: 10 });

      goTo(10);
      // The last page is a short one, and the range has to say so.
      expect(pager.range()).toEqual({ start: 91, end: 95 });
    });

    it('is page 1 of 1 with nothing to show', () => {
      const { instance, pager } = setup();
      instance.total.set(0);
      flushSync();

      // Not "page 1 of 0", which is a sentence a screen reader reads out
      // exactly as written.
      expect(pager.pageCount()).toBe(1);
      expect(pager.announcement()).toBe('Page 1 of 1');
      expect(pager.range()).toEqual({ start: 0, end: 0 });
    });

    it('clamps out-of-range pages instead of believing them', () => {
      const { pager, onPageChange, goTo } = setup();

      goTo(99);
      expect(pager.page()).toBe(10);
      expect(onPageChange).toHaveBeenLastCalledWith(10);

      goTo(-1);
      expect(pager.page()).toBe(1);
    });

    it('says nothing when the page did not change', () => {
      const { onPageChange, goTo } = setup();
      goTo(1);
      expect(onPageChange).not.toHaveBeenCalled();
    });

    it('follows the current page when the size changes', () => {
      const { pager, onPageSizeChange, goTo } = setup();
      goTo(3);
      expect(pager.range()).toEqual({ start: 21, end: 30 });

      pager.setPageSize(20);
      flushSync();

      // Item 21 was at the top of the page and still is; jumping back to page
      // one would have lost the reader's place.
      expect(pager.page()).toBe(2);
      expect(pager.range()).toEqual({ start: 21, end: 40 });
      expect(onPageSizeChange).toHaveBeenCalledWith(20);
    });
  });

  describe('what assistive technology is told', () => {
    it('names the landmark, the list and every page', () => {
      const { item } = setup();

      const nav = host.querySelector('nav')!;
      expect(nav.getAttribute('role')).toBe('navigation');
      expect(nav.getAttribute('aria-label')).toBe('Pagination');
      expect(host.querySelector('ul')!.getAttribute('role')).toBe('list');
      // "3" on its own tells a screen reader user nothing about what pressing
      // it does.
      expect(item('2').getAttribute('aria-label')).toBe('Page 2');
      expect(item('previous').getAttribute('aria-label')).toBe('Previous page');
    });

    it('marks exactly one page as current', () => {
      const { items, goTo } = setup();
      goTo(5);

      const current = items().filter((el) => el.getAttribute('aria-current') === 'page');
      expect(current).toHaveLength(1);
      expect(current[0]!.getAttribute(PAGINATION_ITEM_ATTRIBUTE)).toBe('5');
    });

    it('disables the controls at the ends without taking them out of the widget', () => {
      const { item, goTo } = setup();

      expect(item('first').getAttribute('aria-disabled')).toBe('true');
      expect(item('first').hasAttribute('disabled')).toBe(false);
      expect(item('next').hasAttribute('aria-disabled')).toBe(false);

      goTo(10);
      expect(item('next').getAttribute('aria-disabled')).toBe('true');
      expect(item('previous').hasAttribute('aria-disabled')).toBe(false);
    });

    it('announces the page politely and whole', () => {
      const { pager, goTo } = setup();
      const status = host.querySelector('p')!;

      expect(status.getAttribute('role')).toBe('status');
      expect(status.getAttribute('aria-live')).toBe('polite');
      // "Page 3 of 9" only makes sense read out as one thing.
      expect(status.getAttribute('aria-atomic')).toBe('true');

      goTo(4);
      expect(pager.announcement()).toBe('Page 4 of 10');
      expect(status.textContent?.trim()).toBe('Page 4 of 10');
    });

    it('hides the ellipsis, which says nothing the numbers do not', () => {
      const { goTo } = setup();
      goTo(5);
      const gap = host.querySelector('span')!;
      expect(gap.getAttribute('aria-hidden')).toBe('true');
      expect(gap.hasAttribute(PAGINATION_ITEM_ATTRIBUTE)).toBe(false);
    });

    /** A pager under a provider, as an application that translates builds it. */
    function underProvider(messages: Record<string, string>, status?: (p: number, n: number) => string) {
      let pager!: ReturnType<typeof createPagination>;
      let dispose!: () => void;
      createRoot((d) => {
        dispose = d;
        createLocaleProvider({ defaultLocale: 'de-DE', messages });
        pager = createPagination({
          list: () => null,
          total: () => 95,
          defaultPage: 3,
          labels: status ? { status } : undefined,
        });
      });
      return { pager, dispose };
    }

    it('says where the reader is in the catalogue’s words', () => {
      // `pageOf` is the catalogue's own sentence for exactly this, so a
      // provider that translates it is heard here.
      const { pager, dispose } = underProvider({ pageOf: 'Seite {n} von {m}' });
      expect(pager.announcement()).toBe('Seite 3 von 10');
      dispose();
    });

    it('says the default sentence under a provider that leaves it alone', () => {
      const { pager, dispose } = underProvider({});
      expect(pager.announcement()).toBe('Page 3 of 10');
      dispose();
    });

    it('still prefers a status given outright', () => {
      const { pager, dispose } = underProvider(
        { pageOf: 'Seite {n} von {m}' },
        (p, n) => `S. ${p}/${n}`,
      );
      expect(pager.announcement()).toBe('S. 3/10');
      dispose();
    });
  });

  describe('the keyboard', () => {
    it('is one tab stop, on the current page', () => {
      const { items, item, goTo } = setup();
      goTo(5);

      const stops = items().filter((el) => el.getAttribute('tabindex') === '0');
      expect(stops).toHaveLength(1);
      expect(stops[0]).toBe(item('5'));
    });

    it('moves focus without paging, and pages on Enter', () => {
      const { pager, item, onPageChange } = setup();
      item('1').focus();

      const event = press('ArrowRight', item('1'));
      expect(event.defaultPrevented).toBe(true);
      expect(focused()).toBe(item('2'));
      // Focus is not selection: arrowing over a page must not load it.
      expect(pager.page()).toBe(1);
      expect(onPageChange).not.toHaveBeenCalled();

      press('Enter', item('2'));
      expect(pager.page()).toBe(2);
    });

    it('skips the controls that are disabled', () => {
      const { pager, item } = setup();
      item('1').focus();

      // On page 1 both First and Previous are disabled, so Home lands on the
      // first control that can actually be used.
      press('Home', item('1'));
      expect(focused()).toBe(item('1'));
      expect(pager.page()).toBe(1);
    });

    it('sends Home and End to the ends of the row, not to the ends of the range', () => {
      const { pager, item, goTo } = setup();
      goTo(5);
      item('5').focus();

      press('Home', item('5'));
      expect(focused()).toBe(item('first'));
      // Moving to the First button is not pressing it.
      expect(pager.page()).toBe(5);

      press('End', item('first'));
      expect(focused()).toBe(item('last'));
    });

    it('steps over the ellipsis', () => {
      const { item, goTo } = setup();
      goTo(5);
      item('6').focus();

      press('ArrowRight', item('6'));
      expect(focused()).toBe(item('10'));
    });

    it('gives the tab stop back to the current page when focus leaves', () => {
      const { item } = setup();
      item('1').focus();
      press('ArrowRight', item('1'));
      expect(item('2').getAttribute('tabindex')).toBe('0');

      focusOut(item('2'), document.querySelector('#outside'));

      // Tab comes back to where the user is, not to whichever number they last
      // arrowed past.
      expect(item('1').getAttribute('tabindex')).toBe('0');
      expect(item('2').getAttribute('tabindex')).toBe('-1');
    });

    it('keeps a tab stop when the number holding it disappears', () => {
      const { instance, items, item, goTo } = setup();
      goTo(9);
      item('10').focus();
      flushSync();
      expect(item('10').getAttribute('tabindex')).toBe('0');

      // A filter cuts the results down while focus is on the last page. The
      // element goes, and removing a focused element fires no focusout.
      instance.total.set(20);
      flushSync();

      expect(items().filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1);
      expect(item('2').getAttribute('tabindex')).toBe('0');
    });

    it('activates a button page with Space', () => {
      const { pager, item } = setup();
      item('2').focus();

      expect(press(' ', item('2')).defaultPrevented).toBe(true);
      expect(pager.page()).toBe(2);
    });

    it('leaves Enter alone when the page is a link', () => {
      const { item } = setup('a');
      item('1').focus();

      // The browser follows the link and fires the click that pages this. Take
      // the key and the URL in the address bar goes stale.
      expect(press('Enter', item('2')).defaultPrevented).toBe(false);
      expect(press(' ', item('2')).defaultPrevented).toBe(false);
      // Navigation is still the widget's.
      expect(press('ArrowRight', item('1')).defaultPrevented).toBe(true);
    });
  });

  describe('the pointer', () => {
    it('pages from a click anywhere in the control', () => {
      const { pager, item } = setup();
      clickOn(item('last'));
      expect(pager.page()).toBe(10);
      clickOn(item('previous'));
      expect(pager.page()).toBe(9);
    });

    it('swallows a click on a control at the end of the range', () => {
      const { pager, item } = setup();
      const event = clickOn(item('previous'));
      expect(pager.page()).toBe(1);
      // Visibly there, so the press has to be stopped rather than ignored — an
      // `<a>` used as a control would otherwise follow its href.
      expect(event.defaultPrevented).toBe(true);
    });

    it('follows a page signal driven from outside', () => {
      const { instance, item } = setup();
      instance.page.set(7);
      flushSync();
      expect(item('7').getAttribute('aria-current')).toBe('page');
    });
  });
});

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

describe('stepper', () => {
  function defineFlow(options: {
    linear?: boolean;
    orientation?: 'horizontal' | 'vertical';
    complete?: (index: number) => boolean;
  }) {
    const onValueChange = vi.fn();

    @Component({
      selector: 'v-flow',
      render: compileTemplate(`
        <div>
          <nav :spread="stepper.navProps()">
            <ol :ref="list" :spread="stepper.listProps()">
              <li :for="(name, i) in steps" :key="name">
                <button :spread="stepper.stepProps(i)">{ name }</button>
                <span :spread="stepper.separatorProps()"></span>
              </li>
            </ol>
          </nav>
          <section :for="(name, i) in steps" :key="name"
                   :spread="stepper.panelProps(i)">panel { name }</section>
        </div>
      `),
    })
    class Flow {
      steps = ['Basket', 'Delivery', 'Payment', 'Review', 'Done'];
      value = new Signal.State(0);
      errored = new Signal.State<number | null>(null);
      unusable = new Signal.State<number | null>(null);
      list = new Signal.State<Element | null>(null);
      stepper = createStepper({
        list: () => this.list.get(),
        count: () => this.steps.length,
        value: this.value,
        error: (index) => this.errored.get() === index,
        disabled: (index) => this.unusable.get() === index,
        onValueChange,
        ...options,
      });
    }

    return { Flow, onValueChange };
  }

  function setup(options: Parameters<typeof defineFlow>[0] = {}) {
    const { Flow, onValueChange } = defineFlow(options);
    const handle = track(mount(Flow, host));
    flushSync();
    const instance = handle.instance as InstanceType<typeof Flow>;

    const step = (index: number): HTMLElement =>
      host.querySelector<HTMLElement>(`[${STEP_ATTRIBUTE}="${index}"]`)!;

    return {
      instance,
      stepper: instance.stepper,
      onValueChange,
      step,
      steps: (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(`[${STEP_ATTRIBUTE}]`)],
      panels: (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('section')],
      statuses: (): StepStatus[] =>
        instance.steps.map((_, index) => instance.stepper.status(index)),
      act(run: () => void) {
        run();
        flushSync();
      },
    };
  }

  describe('status', () => {
    it('starts on the first step with the rest ahead', () => {
      const { statuses } = setup();
      expect(statuses()).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    });

    it('counts a step the user has been past as complete', () => {
      const { stepper, statuses, act } = setup();
      act(() => stepper.next());

      expect(statuses()).toEqual(['complete', 'current', 'upcoming', 'upcoming', 'upcoming']);
    });

    it('lets the application overrule that', () => {
      // A step they filled in and then invalidated is not complete, whatever
      // the user has walked past.
      const { stepper, statuses, act } = setup({ complete: () => false });
      act(() => stepper.next());

      expect(statuses()[0]).toBe('upcoming');
    });

    it('reports an error over being current', () => {
      const { instance, statuses, step, act } = setup();
      act(() => instance.errored.set(0));

      // The status is what is worth saying about the step; `aria-current` still
      // says where the user is.
      expect(statuses()[0]).toBe('error');
      expect(step(0).getAttribute('data-status')).toBe('error');
      expect(step(0).getAttribute('aria-current')).toBe('step');
    });

    it('offers a localisable name for the status and the position', () => {
      const { stepper } = setup();
      expect(stepper.statusLabel(0)).toBe('Current step');
      expect(stepper.statusLabel(1)).toBe('Not started');
      expect(stepper.stepLabel(1)).toBe('Step 2 of 5');
    });
  });

  describe('linear navigation', () => {
    it('refuses a step the user has not earned', () => {
      const { stepper, act } = setup();

      act(() => stepper.goTo(3));
      expect(stepper.value()).toBe(0);
      // Not even the next one: it is reached by finishing this one, which is
      // what `next` is for.
      act(() => stepper.goTo(1));
      expect(stepper.value()).toBe(0);
    });

    it('lets the flow itself advance', () => {
      const { stepper, onValueChange, act } = setup();

      // `next` is the Continue button, which has just done the validating.
      act(() => stepper.next());
      expect(stepper.value()).toBe(1);
      expect(onValueChange).toHaveBeenCalledWith(1);
    });

    it('allows a step the user has already reached', () => {
      const { stepper, act } = setup();
      act(() => stepper.next());
      act(() => stepper.next());

      act(() => stepper.goTo(0));
      expect(stepper.value()).toBe(0);
      // Going back does not lose the way forward again.
      act(() => stepper.goTo(2));
      expect(stepper.value()).toBe(2);
      act(() => stepper.goTo(3));
      expect(stepper.value()).toBe(2);
    });

    it('allows any step once everything before it is complete', () => {
      const { stepper, act } = setup({ complete: () => true });
      act(() => stepper.goTo(4));
      expect(stepper.value()).toBe(4);
    });

    it('goes anywhere when it is not linear', () => {
      const { stepper, act } = setup({ linear: false });
      act(() => stepper.goTo(4));
      expect(stepper.value()).toBe(4);
    });

    it('steps over a step that cannot be used', () => {
      const { instance, stepper, act } = setup();
      act(() => instance.unusable.set(1));

      act(() => stepper.next());
      expect(stepper.value()).toBe(2);
      act(() => stepper.previous());
      expect(stepper.value()).toBe(0);
    });
  });

  describe('what assistive technology is told', () => {
    it('marks the current step and wires it to its panel', () => {
      const { step, panels, act, stepper } = setup();

      expect(step(0).getAttribute('aria-current')).toBe('step');
      expect(step(1).hasAttribute('aria-current')).toBe(false);
      expect(step(0).getAttribute('aria-controls')).toBe(panels()[0]!.id);
      expect(panels()[0]!.getAttribute('role')).toBe('group');
      expect(panels()[0]!.getAttribute('aria-labelledby')).toBe(step(0).id);
      expect(panels().map((el) => el.hidden)).toEqual([false, true, true, true, true]);

      act(() => stepper.next());
      expect(panels().map((el) => el.hidden)).toEqual([true, false, true, true, true]);
    });

    it('tells the difference between out of reach and out of order', () => {
      const { instance, step, act } = setup();
      act(() => instance.unusable.set(3));

      // Step 1 cannot be selected yet, but it is not unavailable — a keyboard
      // user should be able to read ahead and see what is coming.
      expect(step(1).getAttribute('aria-disabled')).toBe('true');
      expect(step(1).hasAttribute('data-disabled')).toBe(false);

      // Step 3 is unavailable full stop, and the arrow keys skip it.
      expect(step(3).getAttribute('data-disabled')).toBe('');
    });

    it('hides the connector between steps', () => {
      setup();
      expect(host.querySelector('ol span')!.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('the keyboard', () => {
    it('is one tab stop, on the current step', () => {
      const { steps, step, stepper, act } = setup();

      expect(steps().filter((el) => el.getAttribute('tabindex') === '0')).toEqual([step(0)]);

      act(() => stepper.next());
      expect(step(1).getAttribute('tabindex')).toBe('0');
      expect(step(0).getAttribute('tabindex')).toBe('-1');
    });

    it('moves focus over steps it will not select', () => {
      const { stepper, step } = setup();
      step(0).focus();

      press('ArrowRight', step(0));
      // Focus reaches step 1 even though selecting it would be refused.
      expect(focused()).toBe(step(1));
      expect(stepper.value()).toBe(0);

      // And pressing it there still changes nothing.
      press('Enter', step(1));
      expect(stepper.value()).toBe(0);
    });

    it('skips a step that cannot be used at all', () => {
      const { instance, step, act } = setup();
      act(() => instance.unusable.set(1));
      step(0).focus();

      press('ArrowRight', step(0));
      expect(focused()).toBe(step(2));
    });

    it('selects with Enter once the step can be reached', () => {
      const { stepper, step, act } = setup({ linear: false });
      act(() => step(3).focus());

      expect(press('Enter', step(3)).defaultPrevented).toBe(true);
      expect(stepper.value()).toBe(3);
    });

    it('leaves the keys a horizontal stepper did not claim', () => {
      const { step } = setup();
      step(0).focus();
      // An ArrowDown a horizontal list did not use must still scroll the page.
      expect(press('ArrowDown', step(0)).defaultPrevented).toBe(false);
    });

    it('takes the vertical keys when it runs down the page', () => {
      const { step } = setup({ orientation: 'vertical' });
      step(0).focus();

      expect(press('ArrowDown', step(0)).defaultPrevented).toBe(true);
      expect(focused()).toBe(step(1));
    });

    it('gives the tab stop back to the current step when focus leaves', () => {
      const { step } = setup();
      step(0).focus();
      press('ArrowRight', step(0));
      expect(step(1).getAttribute('tabindex')).toBe('0');

      focusOut(step(1), document.querySelector('#outside'));
      expect(step(0).getAttribute('tabindex')).toBe('0');
    });
  });

  describe('the pointer', () => {
    it('refuses a click on a step out of reach, and swallows it', () => {
      const { stepper, step } = setup();
      const event = clickOn(step(3));

      expect(stepper.value()).toBe(0);
      // An `<a>` step would otherwise navigate to a step the flow has not
      // reached.
      expect(event.defaultPrevented).toBe(true);
    });

    it('selects a step within reach', () => {
      const { stepper, step, act } = setup();
      act(() => stepper.next());

      clickOn(step(0));
      expect(stepper.value()).toBe(0);
    });

    it('follows a value signal driven from outside', () => {
      const { instance, step, stepper } = setup();
      instance.value.set(2);
      flushSync();

      expect(step(2).getAttribute('aria-current')).toBe('step');
      // Anywhere the flow has been counts as reached, however it got there.
      expect(stepper.isSelectable(1)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Navigation menu
// ---------------------------------------------------------------------------

describe('navigation menu', () => {
  function defineSite() {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();

    @Component({
      selector: 'v-site',
      render: compileTemplate(`
        <nav>
          <ul :ref="bar" :spread="nav.menubarProps()">
            <li><a href="/pricing" :spread="nav.itemProps('pricing', { current: true })">Pricing</a></li>
            <li>
              <button :spread="nav.triggerProps('docs')">Docs</button>
              <ul :if="nav.isOpen('docs')" :ref="docs" :spread="nav.submenuProps('docs')">
                <li><a href="/a" :spread="nav.submenuItemProps({ value: 'alpha' })">Alpha</a></li>
                <li><a href="/b" :spread="nav.submenuItemProps({ value: 'beta' })">Beta</a></li>
                <li><a href="/c" :spread="nav.submenuItemProps({ value: 'gamma', disabled: true })">Gamma</a></li>
              </ul>
            </li>
            <li><a href="/legacy" :spread="nav.itemProps('legacy', { disabled: true })">Legacy</a></li>
            <li>
              <button :spread="nav.triggerProps('company')">Company</button>
              <ul :if="nav.isOpen('company')" :ref="company" :spread="nav.submenuProps('company')">
                <li><a href="/about" :spread="nav.submenuItemProps({ value: 'about' })">About</a></li>
              </ul>
            </li>
            <li><a href="/blog" :spread="nav.itemProps('blog')">Blog</a></li>
          </ul>
        </nav>
      `),
    })
    class Site {
      bar = new Signal.State<Element | null>(null);
      docs = new Signal.State<Element | null>(null);
      company = new Signal.State<Element | null>(null);
      nav = createNavigationMenu({
        menubar: () => this.bar.get(),
        // Every key reads a signal, closed ones included, or the effect that
        // wires dismissal would never hear that the submenu had rendered.
        submenu: (key) => {
          const docs = this.docs.get();
          const company = this.company.get();
          if (key === 'docs') return docs;
          if (key === 'company') return company;
          return null;
        },
        onSelect,
        onOpenChange,
      });
    }

    return { Site, onSelect, onOpenChange };
  }

  function setup() {
    const { Site, onSelect, onOpenChange } = defineSite();
    const handle = track(mount(Site, host));
    flushSync();
    const instance = handle.instance as InstanceType<typeof Site>;

    const item = (key: string): HTMLElement =>
      host.querySelector<HTMLElement>(`[${NAV_ITEM_ATTRIBUTE}="${key}"]`)!;

    return {
      instance,
      nav: instance.nav,
      onSelect,
      onOpenChange,
      bar: (): HTMLElement => host.querySelector('[role="menubar"]')!,
      item,
      items: (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(`[${NAV_ITEM_ATTRIBUTE}]`)],
      submenu: (key: string): HTMLElement | null =>
        host.querySelector<HTMLElement>(`#${item(key).getAttribute('aria-controls') ?? 'none'}`),
      subItems: (): HTMLElement[] => [
        ...host.querySelectorAll<HTMLElement>(`[${NAV_SUBITEM_ATTRIBUTE}]`),
      ],
    };
  }

  describe('what assistive technology is told', () => {
    it('is a named menubar of menu items', () => {
      const { bar, item } = setup();

      expect(bar().getAttribute('role')).toBe('menubar');
      expect(bar().getAttribute('aria-label')).toBe('Main navigation');
      // Horizontal is ARIA's own default, so saying it again is noise.
      expect(bar().hasAttribute('aria-orientation')).toBe(false);
      expect(item('pricing').getAttribute('role')).toBe('menuitem');
      expect(item('pricing').getAttribute('aria-current')).toBe('page');
    });

    it('says a trigger has a submenu, and points at it only while it exists', () => {
      const { nav, item, submenu } = setup();

      expect(item('docs').getAttribute('aria-haspopup')).toBe('menu');
      expect(item('docs').getAttribute('aria-expanded')).toBe('false');
      // A dangling `aria-controls` points at nothing at all.
      expect(item('docs').hasAttribute('aria-controls')).toBe(false);

      nav.open('docs');
      flushSync();

      expect(item('docs').getAttribute('aria-expanded')).toBe('true');
      const panel = submenu('docs')!;
      expect(panel.getAttribute('role')).toBe('menu');
      expect(panel.getAttribute('aria-labelledby')).toBe(item('docs').id);
    });

    it('marks a disabled item without hiding it', () => {
      const { item } = setup();
      expect(item('legacy').getAttribute('aria-disabled')).toBe('true');
      expect(item('legacy').getAttribute('data-disabled')).toBe('');
      expect(item('legacy').hasAttribute('disabled')).toBe(false);
    });

    it('keeps submenu items out of the tab order', () => {
      const { nav, subItems } = setup();
      nav.open('docs');
      flushSync();

      for (const el of subItems()) {
        expect(el.getAttribute('role')).toBe('menuitem');
        expect(el.getAttribute('tabindex')).toBe('-1');
      }
    });
  });

  describe('the link contract', () => {
    it('does nothing at all on Space over a link', () => {
      const { nav, item } = setup();
      item('pricing').focus();

      const event = press(' ', item('pricing'));
      // On a link Space scrolls the page. A link that activates on Space is a
      // link that cannot be scrolled past.
      expect(event.defaultPrevented).toBe(false);
      expect(nav.openKey()).toBeNull();
    });

    it('leaves Enter over a link to the browser', () => {
      const { nav, item } = setup();
      item('pricing').focus();

      const event = press('Enter', item('pricing'));
      expect(event.defaultPrevented).toBe(false);
      expect(nav.openKey()).toBeNull();
    });

    it('opens a submenu on Space over a trigger, because that is a button', () => {
      const { nav, item } = setup();
      item('docs').focus();

      const event = press(' ', item('docs'));
      // Prevented, or the click Space fires would toggle it straight back shut.
      expect(event.defaultPrevented).toBe(true);
      expect(nav.openKey()).toBe('docs');
    });

    it('leaves a modified Enter alone, so ⌘-click still opens a tab', () => {
      const { item } = setup();
      const event = press('Enter', item('docs'), { metaKey: true });
      expect(event.defaultPrevented).toBe(false);
    });

    it('leaves Enter and Space inside a submenu to the browser', () => {
      const { nav, subItems } = setup();
      nav.open('docs', 'first');
      flushSync();

      const alpha = subItems()[0]!;
      expect(press('Enter', alpha).defaultPrevented).toBe(false);
      expect(press(' ', alpha).defaultPrevented).toBe(false);
    });
  });

  describe('moving along the bar', () => {
    it('is one tab stop, on the first item until focus says otherwise', () => {
      const { items, item } = setup();

      expect(items().filter((el) => el.getAttribute('tabindex') === '0')).toEqual([
        item('pricing'),
      ]);

      press('ArrowRight', item('pricing'));
      expect(focused()).toBe(item('docs'));
      expect(item('docs').getAttribute('tabindex')).toBe('0');
      expect(item('pricing').getAttribute('tabindex')).toBe('-1');
    });

    it('does not open menus as focus passes over them', () => {
      const { nav, item } = setup();
      item('pricing').focus();

      press('ArrowRight', item('pricing'));
      // A menubar that opens every menu you arrow past is unusable.
      expect(nav.openKey()).toBeNull();
    });

    it('skips a disabled item', () => {
      const { item } = setup();
      item('docs').focus();

      press('ArrowRight', item('docs'));
      expect(focused()).toBe(item('company'));
    });

    it('wraps at the ends', () => {
      const { item } = setup();
      item('pricing').focus();

      press('ArrowLeft', item('pricing'));
      expect(focused()).toBe(item('blog'));
    });

    it('jumps to the ends and to a letter', () => {
      const { item } = setup();
      item('pricing').focus();

      press('End', item('pricing'));
      expect(focused()).toBe(item('blog'));

      press('Home', item('blog'));
      expect(focused()).toBe(item('pricing'));

      press('c', item('pricing'));
      expect(focused()).toBe(item('company'));
    });

    it('follows the pointer for the tab stop', () => {
      const { item } = setup();
      item('blog').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      flushSync();

      // Not cleared when focus leaves: Tab comes back to the item that had it.
      expect(item('blog').getAttribute('tabindex')).toBe('0');
      focusOut(item('blog'), document.querySelector('#outside'));
      expect(item('blog').getAttribute('tabindex')).toBe('0');
    });
  });

  describe('opening a submenu', () => {
    it('lands on the first item from Down, and the last usable one from Up', () => {
      const { nav, item, subItems } = setup();
      item('docs').focus();

      expect(press('ArrowDown', item('docs')).defaultPrevented).toBe(true);
      expect(nav.openKey()).toBe('docs');
      expect(focused()).toBe(subItems()[0]);

      nav.close();
      flushSync();

      press('ArrowUp', item('docs'));
      // Gamma is disabled, so the last item the arrows will land on is Beta.
      expect(focused()).toBe(subItems()[1]);
    });

    it('does nothing on Down over an item with no submenu', () => {
      const { nav, item } = setup();
      item('pricing').focus();

      const event = press('ArrowDown', item('pricing'));
      expect(nav.openKey()).toBeNull();
      // Not prevented, so the page still scrolls.
      expect(event.defaultPrevented).toBe(false);
    });

    it('moves within the submenu and skips what is disabled', () => {
      const { nav, subItems } = setup();
      nav.open('docs', 'first');
      flushSync();

      expect(press('ArrowDown', subItems()[0]!).defaultPrevented).toBe(true);
      expect(focused()).toBe(subItems()[1]);

      press('ArrowDown', subItems()[1]!);
      // Past the disabled Gamma and round to Alpha.
      expect(focused()).toBe(subItems()[0]);

      press('End', subItems()[0]!);
      expect(focused()).toBe(subItems()[1]);
    });

    it('carries an open submenu along the bar, once, from inside it', () => {
      const { nav, item, subItems } = setup();
      nav.open('docs', 'first');
      flushSync();

      press('ArrowRight', subItems()[0]!);

      // Past the disabled Legacy, and exactly one item along — the submenu is
      // inside the menubar, so both handlers see the key.
      expect(nav.openKey()).toBe('company');
      expect(item('company').getAttribute('aria-expanded')).toBe('true');
      expect(focused()).toBe(subItems()[0]);
      expect(subItems()[0]!.textContent).toBe('About');
    });

    it('closes when the next item along has nothing to open', () => {
      const { nav, item } = setup();
      nav.open('company', 'first');
      flushSync();

      press('ArrowRight', host.querySelector(`[${NAV_SUBITEM_ATTRIBUTE}]`)!);

      expect(nav.openKey()).toBeNull();
      expect(focused()).toBe(item('blog'));
    });
  });

  describe('closing a submenu', () => {
    it('closes on Escape and puts focus back on the trigger', () => {
      const { nav, item, subItems } = setup();
      nav.open('docs', 'first');
      flushSync();

      // Dismissal listens on the document in the capture phase, so one press
      // inside the submenu is one press on the topmost layer.
      subItems()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      flushSync();

      expect(nav.openKey()).toBeNull();
      // Escape came from the keyboard, so focus has to land somewhere the
      // keyboard can carry on from.
      expect(focused()).toBe(item('docs'));
    });

    it('closes on Tab and lets the browser carry on from the trigger', () => {
      const { nav, item, subItems } = setup();
      nav.open('docs', 'first');
      flushSync();

      const event = press('Tab', subItems()[0]!);

      expect(nav.openKey()).toBeNull();
      expect(focused()).toBe(item('docs'));
      // Not prevented: the browser's own Tab moves on from where focus now is.
      expect(event.defaultPrevented).toBe(false);
    });

    it('closes on a press outside without stealing focus back', () => {
      const { nav, item } = setup();
      nav.open('docs', 'first');
      flushSync();

      const outside = document.querySelector('#outside') as HTMLElement;
      outside.focus();
      pressOutside(outside);

      expect(nav.openKey()).toBeNull();
      // The browser has already given focus to whatever was pressed; pulling
      // it back to the trigger would undo the user's own click.
      expect(focused()).not.toBe(item('docs'));
    });

    it('does not treat the trigger as outside', () => {
      const { nav, item } = setup();
      nav.open('docs', 'first');
      flushSync();

      pressOutside(item('docs'));
      // Otherwise dismissal closes it and the trigger's own click reopens it.
      expect(nav.openKey()).toBe('docs');
    });

    it('reports every change once', () => {
      const { nav, onOpenChange } = setup();
      nav.open('docs');
      flushSync();
      nav.open('docs');
      flushSync();
      expect(onOpenChange).toHaveBeenCalledTimes(1);

      nav.close();
      flushSync();
      expect(onOpenChange).toHaveBeenLastCalledWith(null);
    });
  });

  describe('the pointer', () => {
    it('toggles a submenu from its trigger', () => {
      const { nav, item } = setup();

      const event = clickOn(item('docs'));
      expect(nav.openKey()).toBe('docs');
      // A trigger is a button, whatever element it is written as.
      expect(event.defaultPrevented).toBe(true);

      clickOn(item('docs'));
      expect(nav.openKey()).toBeNull();
    });

    it('closes and reports a click on a submenu link, without blocking it', () => {
      const { nav, onSelect, subItems } = setup();
      nav.open('docs');
      flushSync();

      const alpha = subItems()[0]!;
      const event = clickOn(alpha);

      expect(nav.openKey()).toBeNull();
      expect(onSelect).toHaveBeenCalledWith(alpha, 'alpha');
      // The link is navigating; blocking it would be the one thing this must
      // never do.
      expect(event.defaultPrevented).toBe(false);
    });

    it('swallows a click on a disabled item', () => {
      const { nav, onSelect, subItems } = setup();
      nav.open('docs');
      flushSync();

      const event = clickOn(subItems()[2]!);
      expect(event.defaultPrevented).toBe(true);
      expect(onSelect).not.toHaveBeenCalled();
      expect(nav.openKey()).toBe('docs');
    });

    it('closes an open submenu when another top-level link is used', () => {
      const { nav, item, onSelect } = setup();
      nav.open('docs');
      flushSync();

      const event = clickOn(item('blog'));
      expect(nav.openKey()).toBeNull();
      expect(onSelect).toHaveBeenCalledWith(item('blog'), undefined);
      expect(event.defaultPrevented).toBe(false);
    });
  });
});
