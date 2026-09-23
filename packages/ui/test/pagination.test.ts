/**
 * `<v-pagination>`, driven the way a page drives it.
 *
 * The behaviour is `createPagination`'s and is tested where it lives: which
 * pages the row shows, the one tab stop, what the arrow keys do. What is
 * tested here is the shell — that what a caller writes on the tag reaches the
 * landmark, that every state the sheet draws is on the element its rules
 * select on, that every prop handed to the primitive does something, that the
 * controls are buttons until an `href` makes them links, and that the
 * primitive is still within reach.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { createLocaleProvider } from '@voltdev/primitives';
import { compileComponents } from './render.js';
import { VPagination } from '../src/components/pagination.js';
import { paginationStyles } from '../src/sheet/pagination.js';

compileComponents();

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = '';
});

function show<T>(component: new () => T): { instance: T; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mount(component, host);
  unmount = handle.unmount;
  flushSync();
  return { instance: handle.instance as T, host };
}

/** A keydown as the user sends it: from the focused control, bubbling to the row. */
function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

function click(target: Element): void {
  (target as HTMLElement).click();
  flushSync();
}

const nav = (host: HTMLElement): HTMLElement => host.querySelector('.volt-pagination')!;
const pages = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-pagination-page'),
];
const controls = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('.volt-pagination-control'),
];
const control = (host: HTMLElement, which: string): HTMLElement =>
  host.querySelector<HTMLElement>(`.volt-pagination-control[data-volt-page="${which}"]`)!;
const page = (host: HTMLElement, number: number): HTMLElement =>
  host.querySelector<HTMLElement>(`.volt-pagination-page[data-volt-page="${number}"]`)!;
const status = (host: HTMLElement): string =>
  host.querySelector('.volt-pagination-status')!.textContent!.trim();

/** The row as a reader sees it: numbers, and an ellipsis where some are left out. */
const row = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('.volt-pagination-item')]
    .map((item) => item.firstElementChild!)
    .filter((child) => !child.classList.contains('volt-pagination-control'))
    .map((child) => child.textContent!.trim());

const current = (host: HTMLElement): string | undefined =>
  pages(host)
    .find((each) => each.getAttribute('aria-current') === 'page')
    ?.textContent?.trim();

const tabStops = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLElement>('[data-volt-page]')]
    .filter((each) => each.getAttribute('tabindex') === '0')
    .map((each) => each.getAttribute('data-volt-page')!);

/** A hundred results, ten to a page, on the page the page holds. */
@Component({
  selector: 'v-results',
  imports: [VPagination],
  render: compileTemplate(`
    <v-pagination :ref="pager" :page="at" :total="count.get()" :onPageChange="record">
    </v-pagination>
  `),
})
class Results {
  pager: VPagination | null = null;
  at = new Signal.State(1);
  count = new Signal.State(100);
  moved: number[] = [];
  record = (next: number): void => void this.moved.push(next);
}

describe('v-pagination', () => {
  it('is a landmark of buttons, with the sheet’s classes and the caller’s own', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <p id="note">Sorted by date.</p>
        <v-pagination
          class="mine"
          id="pager"
          data-list="results"
          aria-describedby="note"
          total="100"
        ></v-pagination>
      `),
    })
    class Page {}

    const { host } = show(Page);

    // Everything written on the tag lands on the element carrying the role,
    // which is the landmark itself.
    expect(nav(host).tagName).toBe('NAV');
    expect([...nav(host).classList].sort()).toEqual(['mine', 'volt-pagination']);
    expect(nav(host).id).toBe('pager');
    expect(nav(host).dataset['list']).toBe('results');
    expect(nav(host).getAttribute('aria-describedby')).toBe('note');
    expect(nav(host).getAttribute('role')).toBe('navigation');
    expect(nav(host).getAttribute('aria-label')).toBe('Pagination');

    const list = host.querySelector('.volt-pagination-list')!;
    expect(list.tagName).toBe('UL');
    expect(list.getAttribute('role')).toBe('list');
    const items = [...list.children];
    expect(items.every((child) => child.classList.contains('volt-pagination-item'))).toBe(true);

    // Buttons, all of them, and not ones that would submit a form around them.
    const every = [...pages(host), ...controls(host)];
    expect(every.map((each) => each.tagName)).toEqual(every.map(() => 'BUTTON'));
    expect(every.every((each) => (each as HTMLButtonElement).type === 'button')).toBe(true);
    expect(every.every((each) => !each.hasAttribute('href'))).toBe(true);

    // A bare number is not a name, so each page carries one.
    expect(page(host, 2).getAttribute('aria-label')).toBe('Page 2');
    expect(control(host, 'previous').getAttribute('aria-label')).toBe('Previous page');
    expect(control(host, 'next').getAttribute('aria-label')).toBe('Next page');

    // The ellipsis is decoration: the numbers either side already say pages
    // are missing.
    const gap = host.querySelector('.volt-pagination-ellipsis')!;
    expect(gap.getAttribute('aria-hidden')).toBe('true');
    expect(gap.textContent).toBe('…');

    const region = host.querySelector('.volt-pagination-status')!;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(status(host)).toBe('Page 1 of 10');

    // And what the caller wrote is still there once the page has moved: the
    // landmark's attributes are rewritten on every change, and the bag has no
    // opinion about a description.
    click(page(host, 2));
    expect(nav(host).getAttribute('aria-describedby')).toBe('note');
    expect(nav(host).getAttribute('aria-label')).toBe('Pagination');
  });

  it('writes every state the sheet’s rules select on', () => {
    const { instance, host } = show(Results);

    // The first page: marked current, and the control that would go before it
    // is left in the row and marked as going nowhere.
    expect(current(host)).toBe('1');
    expect(page(host, 1).getAttribute('data-state')).toBe('active');
    expect(page(host, 2).getAttribute('data-state')).toBe('inactive');
    expect(page(host, 2).hasAttribute('aria-current')).toBe(false);
    expect(control(host, 'previous').getAttribute('aria-disabled')).toBe('true');
    expect(control(host, 'previous').hasAttribute('data-disabled')).toBe(true);
    expect(control(host, 'next').hasAttribute('aria-disabled')).toBe(false);
    expect(row(host)).toEqual(['1', '2', '…', '10']);

    // In the middle: an ellipsis on each side, and both ends open.
    instance.at.set(5);
    flushSync();
    expect(row(host)).toEqual(['1', '…', '4', '5', '6', '…', '10']);
    expect(current(host)).toBe('5');
    expect(control(host, 'previous').hasAttribute('aria-disabled')).toBe(false);

    // The last: the other end is the one that goes nowhere.
    instance.at.set(10);
    flushSync();
    expect(row(host)).toEqual(['1', '…', '9', '10']);
    expect(control(host, 'next').getAttribute('aria-disabled')).toBe('true');
    expect(control(host, 'previous').hasAttribute('aria-disabled')).toBe(false);
  });

  it('draws something for every rule the sheet writes', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination total="100" defaultPage="5"></v-pagination>
        <v-pagination total="100" :href="(n) => '#page-' + n"></v-pagination>
      `),
    })
    class Page {}

    show(Page);

    // The pointer and keyboard focus are states nothing here drives; what is
    // asked is whether the classes and attributes around them are ones the
    // component writes. A rule selecting on something it never draws is a
    // rule that silently does nothing.
    const selectors = [...paginationStyles.rules, ...paginationStyles.forcedColors]
      .flatMap((rule) => rule.selector.split(','))
      .map((selector) => selector.trim().replaceAll(':hover', '').replaceAll(':focus-visible', ''));
    const unmatched = selectors.filter((selector) => document.querySelector(selector) === null);
    expect(unmatched).toEqual([]);
  });

  it('says where the reader is, and what goes nowhere, in colours a forced palette keeps', () => {
    // The pairs in `fixtures/pagination.ts` cannot hold this on their own: a
    // disabled control also differs by its cursor, which no forced palette
    // touches, so its `GrayText` could go and they would stay green. These two
    // are information rather than emphasis, so they are asserted by name.
    const forced = (selector: string): Record<string, string> | undefined =>
      paginationStyles.forcedColors.find((rule) => rule.selector === selector)?.declarations;

    expect(forced(".volt-pagination-page[aria-current='page']")).toMatchObject({
      'background-color': 'Highlight',
      color: 'HighlightText',
    });
    expect(forced(".volt-pagination-control[aria-disabled='true']")).toMatchObject({
      color: 'GrayText',
    });
  });

  it('moves on a press, and says where it went', () => {
    const { instance, host } = show(Results);

    click(page(host, 2));
    expect(instance.at.get()).toBe(2);
    expect(current(host)).toBe('2');
    expect(status(host)).toBe('Page 2 of 10');

    click(control(host, 'next'));
    expect(instance.at.get()).toBe(3);

    click(control(host, 'previous'));
    expect(instance.at.get()).toBe(2);

    click(page(host, 10));
    expect(instance.at.get()).toBe(10);

    // A control at the end of the range refuses the press.
    click(control(host, 'next'));
    expect(instance.at.get()).toBe(10);

    expect(instance.moved).toEqual([2, 3, 2, 10]);
  });

  it('is one tab stop, and the arrow keys move inside it', () => {
    const { instance, host } = show(Results);
    instance.at.set(5);
    flushSync();

    // The current page holds the row's one tab stop, so Tab comes back to
    // where the reader is.
    expect(tabStops(host)).toEqual(['5']);

    page(host, 5).focus();
    const right = press(page(host, 5), 'ArrowRight');
    expect(document.activeElement).toBe(page(host, 6));
    // Uncancelled, an arrow scrolls the page.
    expect(right.defaultPrevented).toBe(true);
    expect(tabStops(host)).toEqual(['6']);
    // Moving is not paging.
    expect(instance.at.get()).toBe(5);

    // Past the ellipsis, which is not a stop.
    press(page(host, 6), 'ArrowRight');
    expect(document.activeElement).toBe(page(host, 10));

    press(page(host, 10), 'ArrowLeft');
    expect(document.activeElement).toBe(page(host, 6));

    // The ends of the row, which are the controls.
    press(page(host, 6), 'Home');
    expect(document.activeElement).toBe(control(host, 'previous'));
    press(control(host, 'previous'), 'End');
    expect(document.activeElement).toBe(control(host, 'next'));

    // Enter on a control does what a press does.
    press(control(host, 'next'), 'Enter');
    expect(instance.at.get()).toBe(6);
    press(control(host, 'next'), ' ');
    expect(instance.at.get()).toBe(7);
    expect(instance.moved).toEqual([6, 7]);
  });

  it('steps over a control that goes nowhere', () => {
    const { host } = show(Results);
    page(host, 1).focus();

    press(page(host, 1), 'Home');
    expect(document.activeElement).toBe(page(host, 1));
    press(page(host, 1), 'ArrowLeft');
    expect(document.activeElement).toBe(page(host, 1));
  });

  it('stops at the ends of the row, or wraps when told to', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination total="30"></v-pagination>
        <v-pagination total="30" :loop="true"></v-pagination>
      `),
    })
    class Page {}

    const { host } = show(Page);
    const [stops, wraps] = [...host.querySelectorAll<HTMLElement>('.volt-pagination')];
    const next = (pager: HTMLElement): HTMLElement =>
      pager.querySelector<HTMLElement>('[data-volt-page="next"]')!;

    for (const pager of [stops!, wraps!]) {
      next(pager).focus();
      press(next(pager), 'ArrowRight');
    }
    expect(document.activeElement).toBe(wraps!.querySelector('[data-volt-page="1"]'));

    next(stops!).focus();
    press(next(stops!), 'ArrowRight');
    expect(document.activeElement).toBe(next(stops!));
  });

  it('wraps for a loop written as an attribute, bare or spelled out', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination total="30" loop></v-pagination>
        <v-pagination total="30" loop="true"></v-pagination>
      `),
    })
    class Page {}

    const { host } = show(Page);

    // An attribute is a string, and `"true"` is as truthy as the bare word —
    // it is the spelling that reads like what it asks for, and it has to do it.
    for (const pager of host.querySelectorAll<HTMLElement>('.volt-pagination')) {
      const next = pager.querySelector<HTMLElement>('[data-volt-page="next"]')!;
      next.focus();
      press(next, 'ArrowRight');
      expect(document.activeElement).toBe(pager.querySelector('[data-volt-page="1"]'));
    }
  });

  it('reaches the primitive through `:ref`', () => {
    const { instance, host } = show(Results);
    const pager = instance.pager!;

    expect(pager).toBeInstanceOf(VPagination);
    expect(pager.pagination.pageCount()).toBe(10);
    expect(pager.pagination.range()).toEqual({ start: 1, end: 10 });

    pager.pagination.goTo(7);
    flushSync();
    expect(current(host)).toBe('7');
    expect(instance.at.get()).toBe(7);
    expect(pager.pagination.range()).toEqual({ start: 61, end: 70 });
  });

  it('follows the signal it was given, both ways', () => {
    const { instance, host } = show(Results);

    instance.at.set(4);
    flushSync();
    expect(current(host)).toBe('4');
    expect(status(host)).toBe('Page 4 of 10');
    // A write by the page is not a move a user made.
    expect(instance.moved).toEqual([]);

    click(page(host, 5));
    expect(instance.at.get()).toBe(5);
    expect(instance.moved).toEqual([5]);
  });

  it('keeps a page the total has not caught up with, and shows it once it has', () => {
    const { instance, host } = show(Results);
    instance.count.set(0);
    instance.at.set(7);
    flushSync();

    // Nothing to page through is "page 1 of 1", never "page 7 of 0" — and the
    // signal keeps the 7 a restored URL asked for.
    expect(current(host)).toBe('1');
    expect(status(host)).toBe('Page 1 of 1');
    expect(instance.at.get()).toBe(7);
    expect(instance.pager!.pagination.range()).toEqual({ start: 0, end: 0 });

    instance.count.set(100);
    flushSync();
    expect(current(host)).toBe('7');
  });

  it('follows the total it is bound to', () => {
    const { instance, host } = show(Results);

    instance.count.set(35);
    flushSync();
    expect(row(host)).toEqual(['1', '2', '3', '4']);
    expect(status(host)).toBe('Page 1 of 4');

    instance.count.set(1000);
    flushSync();
    expect(row(host)).toEqual(['1', '2', '…', '100']);
  });

  it('starts where it was told to, when the page is its own', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(
        `<v-pagination :ref="pager" total="100" defaultPage="3"></v-pagination>`,
      ),
    })
    class Page {
      pager: VPagination | null = null;
    }

    const { instance, host } = show(Page);
    expect(current(host)).toBe('3');
    expect(instance.pager!.pagination.page()).toBe(3);

    click(control(host, 'next'));
    expect(current(host)).toBe('4');
  });

  it('starts on its page at the size it was given, without calling that a move', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination :ref="own" total="30" pageSize="4" defaultPage="3" :onPageChange="record">
        </v-pagination>
        <v-pagination :ref="held" :page="at" total="30" pageSize="4" :onPageChange="record">
        </v-pagination>
      `),
    })
    class Page {
      own: VPagination | null = null;
      held: VPagination | null = null;
      at = new Signal.State(4);
      moved: number[] = [];
      record = (next: number): void => void this.moved.push(next);
    }

    const { instance } = show(Page);

    // Built at ten to a page and resized to four afterwards, page 3 would be
    // read as items 21 to 30 and moved to page 6 to keep them — a jump, and a
    // report of one, before anyone has touched the pager.
    expect(instance.own!.pagination.pageSize()).toBe(4);
    expect(instance.own!.pagination.page()).toBe(3);
    expect(instance.own!.pagination.range()).toEqual({ start: 9, end: 12 });
    expect(instance.at.get()).toBe(4);
    expect(instance.held!.pagination.range()).toEqual({ start: 13, end: 16 });
    expect(instance.moved).toEqual([]);
  });

  it('reads a number that has not arrived as the default, not as NaN', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination
          :ref="pager"
          :total="rows.get()?.length"
          :pageSize="size.get()"
          :siblings="size.get()"
          :boundaries="size.get()"
        ></v-pagination>
      `),
    })
    class Page {
      pager: VPagination | null = null;
      rows = new Signal.State<string[] | undefined>(undefined);
      size = new Signal.State<number | undefined>(undefined);
    }

    const { instance, host } = show(Page);

    // The results are still loading: nothing to page through, said as a
    // sentence rather than as "Page 1 of NaN".
    expect(status(host)).toBe('Page 1 of 1');
    expect(row(host)).toEqual(['1']);
    expect(instance.pager!.pagination.range()).toEqual({ start: 0, end: 0 });

    instance.rows.set(Array.from({ length: 200 }, (_, index) => `row ${index}`));
    flushSync();
    // Ten to a page, one either side and one at each end: the defaults, for
    // every number that was bound to nothing.
    expect(instance.pager!.pagination.pageSize()).toBe(10);
    expect(status(host)).toBe('Page 1 of 20');
    expect(row(host)).toEqual(['1', '2', '…', '20']);
  });

  it('keeps the reader’s place when the page size changes', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination
          :ref="pager"
          :page="at"
          total="100"
          :pageSize="size.get()"
          :onPageChange="record"
        ></v-pagination>
      `),
    })
    class Page {
      pager: VPagination | null = null;
      at = new Signal.State(5);
      size = new Signal.State(10);
      moved: number[] = [];
      record = (next: number): void => void this.moved.push(next);
    }

    const { instance, host } = show(Page);
    expect(instance.pager!.pagination.range()).toEqual({ start: 41, end: 50 });

    // Item 41 was at the top, and it is on page 3 of twenty to a page — not on
    // page 5, which would now be showing items 81 to 100.
    instance.size.set(20);
    flushSync();
    expect(instance.pager!.pagination.pageSize()).toBe(20);
    expect(instance.at.get()).toBe(3);
    expect(current(host)).toBe('3');
    expect(instance.pager!.pagination.range()).toEqual({ start: 41, end: 60 });
    expect(row(host)).toEqual(['1', '2', '3', '4', '5']);
    expect(instance.moved).toEqual([3]);
  });

  it('takes a page and a size set together as they were set, the way a URL restores them', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination
          :ref="pager"
          :page="at"
          total="200"
          :pageSize="size.get()"
          :onPageChange="record"
        ></v-pagination>
      `),
    })
    class Page {
      pager: VPagination | null = null;
      at = new Signal.State(1);
      size = new Signal.State(10);
      moved: number[] = [];
      record = (next: number): void => void this.moved.push(next);
    }

    const { instance, host } = show(Page);

    // The back button, to `?page=3&size=20`. Both are the page's to say: read
    // as a size change alone, page 3 of ten would be moved to page 2 of twenty
    // to keep item 21 in view, and the pager would write a URL nobody asked
    // for over the one being restored.
    instance.at.set(3);
    instance.size.set(20);
    flushSync();
    expect(instance.at.get()).toBe(3);
    expect(current(host)).toBe('3');
    expect(instance.pager!.pagination.range()).toEqual({ start: 41, end: 60 });

    // In either order.
    instance.size.set(10);
    instance.at.set(5);
    flushSync();
    expect(instance.at.get()).toBe(5);
    expect(instance.pager!.pagination.range()).toEqual({ start: 41, end: 50 });
    expect(instance.moved).toEqual([]);

    // And a size on its own still keeps the reader's place.
    instance.size.set(20);
    flushSync();
    expect(instance.at.get()).toBe(3);
    expect(instance.moved).toEqual([3]);

    // A page past the end is the caller's number too, and is kept as written —
    // not taken for the last page it is shown as, and then moved to keep that
    // page's items in view.
    instance.at.set(7);
    instance.size.set(30);
    flushSync();
    instance.at.set(25);
    instance.size.set(10);
    flushSync();
    expect(instance.at.get()).toBe(25);
    expect(current(host)).toBe('20');
    expect(instance.moved).toEqual([3]);
  });

  it('shows as many pages around the current one, and at the ends, as it is told', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination
          total="200"
          defaultPage="10"
          :siblings="around.get()"
          :boundaries="ends.get()"
        ></v-pagination>
      `),
    })
    class Page {
      around = new Signal.State(1);
      ends = new Signal.State(1);
    }

    const { instance, host } = show(Page);
    expect(row(host)).toEqual(['1', '…', '9', '10', '11', '…', '20']);

    instance.around.set(2);
    flushSync();
    expect(row(host)).toEqual(['1', '…', '8', '9', '10', '11', '12', '…', '20']);

    instance.ends.set(2);
    flushSync();
    expect(row(host)).toEqual(['1', '2', '…', '8', '9', '10', '11', '12', '…', '19', '20']);

    // Nothing pinned: the first and last pages leave the row, which is what
    // `showFirstLast` is for.
    instance.around.set(0);
    instance.ends.set(0);
    flushSync();
    expect(row(host)).not.toContain('1');
    expect(row(host)).not.toContain('20');
    expect(row(host)).toContain('10');
  });

  it('draws first and last controls when asked', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination :page="at" total="100" :showFirstLast="ends.get()"></v-pagination>
      `),
    })
    class Page {
      at = new Signal.State(4);
      ends = new Signal.State(false);
    }

    const { instance, host } = show(Page);
    expect(controls(host).map((each) => each.dataset['voltPage'])).toEqual(['previous', 'next']);

    instance.ends.set(true);
    flushSync();
    expect(controls(host).map((each) => each.dataset['voltPage'])).toEqual([
      'first',
      'previous',
      'next',
      'last',
    ]);
    expect(control(host, 'first').getAttribute('aria-label')).toBe('First page');
    expect(control(host, 'first').textContent).toBe('«');
    expect(control(host, 'last').textContent).toBe('»');

    click(control(host, 'last'));
    expect(instance.at.get()).toBe(10);
    expect(control(host, 'last').getAttribute('aria-disabled')).toBe('true');

    click(control(host, 'first'));
    expect(instance.at.get()).toBe(1);
    expect(control(host, 'first').getAttribute('aria-disabled')).toBe('true');
  });

  it('draws links when given where each page lives', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination
          :page="at"
          total="100"
          :showFirstLast="true"
          :href="linked.get() ? where : undefined"
        ></v-pagination>
      `),
    })
    class Page {
      at = new Signal.State(1);
      linked = new Signal.State(true);
      where = (page: number): string => (page === 1 ? '#results' : `#results-${page}`);
    }

    const { instance, host } = show(Page);

    const every = (): HTMLElement[] => [...pages(host), ...controls(host)];
    expect(every().map((each) => each.tagName)).toEqual(every().map(() => 'A'));
    expect(page(host, 1).getAttribute('href')).toBe('#results');
    expect(page(host, 2).getAttribute('href')).toBe('#results-2');
    expect(page(host, 1).getAttribute('aria-current')).toBe('page');
    expect(control(host, 'next').getAttribute('href')).toBe('#results-2');

    // Nowhere to go is no `href` at all: a link to page 0 would still open a
    // tab on a middle-click. What it is and why it is off are still said.
    expect(control(host, 'previous').hasAttribute('href')).toBe(false);
    expect(control(host, 'previous').getAttribute('role')).toBe('link');
    expect(control(host, 'previous').getAttribute('aria-disabled')).toBe('true');
    expect(control(host, 'next').hasAttribute('role')).toBe(false);

    // A press follows the link, and moves the pager with it.
    click(page(host, 2));
    expect(instance.at.get()).toBe(2);
    expect(control(host, 'previous').getAttribute('href')).toBe('#results');
    expect(control(host, 'previous').hasAttribute('role')).toBe(false);
    expect(control(host, 'next').getAttribute('href')).toBe('#results-3');
    expect(control(host, 'first').getAttribute('href')).toBe('#results');
    expect(control(host, 'last').getAttribute('href')).toBe('#results-10');

    // Enter on a link is the browser's, which follows it and fires the click
    // that moves the pager; taking the key here would page without navigating.
    page(host, 2).focus();
    const enter = press(page(host, 2), 'Enter');
    expect(enter.defaultPrevented).toBe(false);

    // And back to buttons, when the page takes the pattern away.
    instance.linked.set(false);
    flushSync();
    expect(every().map((each) => each.tagName)).toEqual(every().map(() => 'BUTTON'));
    expect(every().every((each) => !each.hasAttribute('href'))).toBe(true);
    expect(current(host)).toBe('2');
  });

  it('leaves this page where it is when a link is opened somewhere else', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination :page="at" total="100" :href="where" :onPageChange="record"></v-pagination>
        <v-pagination :page="plain" total="100"></v-pagination>
      `),
    })
    class Page {
      at = new Signal.State(1);
      plain = new Signal.State(1);
      where = (page: number): string => `#results-${page}`;
      moved: number[] = [];
      record = (next: number): void => void this.moved.push(next);
    }

    const { instance, host } = show(Page);
    const [links, buttons] = [...host.querySelectorAll<HTMLElement>('.volt-pagination')];
    const modified = (target: Element, init: MouseEventInit): MouseEvent => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      flushSync();
      return event;
    };

    // ⌘-click is a new tab, Shift-click a new window, Alt-click a download,
    // and a click from any button but the first is the browser's too: the
    // page goes on being read here, and the browser opens the link wherever
    // it was asked to — so it is neither paged nor prevented.
    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      for (const target of [
        links!.querySelector('[data-volt-page="2"]')!,
        links!.querySelector('[data-volt-page="next"]')!,
      ]) {
        const event = modified(target, init);
        expect(event.defaultPrevented, JSON.stringify(init)).toBe(false);
      }
    }
    expect(instance.at.get()).toBe(1);
    expect(instance.moved).toEqual([]);

    // A plain click still moves it, and still leaves the navigating to the
    // browser — or to the router, which sees an ordinary click.
    expect(modified(links!.querySelector('[data-volt-page="2"]')!, {}).defaultPrevented).toBe(false);
    expect(instance.at.get()).toBe(2);
    expect(instance.moved).toEqual([2]);

    // A button opens nothing anywhere else, so a modifier changes nothing.
    modified(buttons!.querySelector('[data-volt-page="2"]')!, { metaKey: true });
    expect(instance.plain.get()).toBe(2);
  });

  it('draws buttons for a pattern that arrives after it was built, rather than calling it', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`<v-pagination total="100" :href="pattern.get()"></v-pagination>`),
    })
    class Page {
      pattern = new Signal.State<unknown>(undefined);
    }

    const { instance, host } = show(Page);

    // The development check reads `href` once, while the pager is built; a
    // string bound later gets past it, as every string does in a build
    // without it. Called as a function, it would leave the row empty.
    instance.pattern.set('/results?page={page}');
    flushSync();
    const every = [...pages(host), ...controls(host)];
    expect(every.map((each) => each.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON', 'BUTTON', 'BUTTON']);
    expect(row(host)).toEqual(['1', '2', '…', '10']);
  });

  it('shows what the caller put in each control’s slot, as buttons and as links', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination total="100" :showFirstLast="true">
          <template :slot-first>First</template>
          <template :slot-previous>Back</template>
          <template :slot-next>On</template>
          <template :slot-last>Last</template>
        </v-pagination>
        <v-pagination total="100" :showFirstLast="true" :href="where">
          <template :slot-first>First</template>
          <template :slot-previous>Back</template>
          <template :slot-next>On</template>
          <template :slot-last>Last</template>
        </v-pagination>
      `),
    })
    class Page {
      where = (page: number): string => `#page-${page}`;
    }

    const { host } = show(Page);
    const [buttons, links] = [...host.querySelectorAll<HTMLElement>('.volt-pagination')];
    for (const [pager, tag] of [
      [buttons!, 'BUTTON'],
      [links!, 'A'],
    ] as const) {
      const shown = [...pager.querySelectorAll<HTMLElement>('.volt-pagination-control')];
      expect(shown.map((each) => each.tagName)).toEqual([tag, tag, tag, tag]);
      expect(shown.map((each) => each.textContent)).toEqual(['First', 'Back', 'On', 'Last']);
    }
  });

  it('names the landmark, and keeps what the caller wrote in ARIA', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <h2 id="heading">Results</h2>
        <v-pagination total="100" :label="name.get()"></v-pagination>
        <v-pagination total="100" aria-label="Result pages" label="stale"></v-pagination>
        <v-pagination total="100" labelledBy="heading"></v-pagination>
        <v-pagination total="100" aria-labelledby="heading" labelledBy="stale" label="unused">
        </v-pagination>
      `),
    })
    class Page {
      name = new Signal.State<string | undefined>('Search results');
    }

    const { instance, host } = show(Page);
    const navs = [...host.querySelectorAll<HTMLElement>('.volt-pagination')];

    expect(navs[0]!.getAttribute('aria-label')).toBe('Search results');
    instance.name.set('Résultats');
    flushSync();
    expect(navs[0]!.getAttribute('aria-label')).toBe('Résultats');

    // Written on the tag, and still there after the page has moved: the
    // landmark's attributes are rewritten on every change, and a name the bag
    // did not carry would be wiped by the first one.
    expect(navs[1]!.getAttribute('aria-label')).toBe('Result pages');
    click(navs[1]!.querySelector('[data-volt-page="2"]')!);
    expect(navs[1]!.getAttribute('aria-label')).toBe('Result pages');

    // One name only: a reference replaces the label rather than sitting beside
    // an `aria-label` that goes on being read nowhere.
    expect(navs[2]!.getAttribute('aria-labelledby')).toBe('heading');
    expect(navs[2]!.hasAttribute('aria-label')).toBe(false);
    expect(navs[3]!.getAttribute('aria-labelledby')).toBe('heading');
    expect(navs[3]!.hasAttribute('aria-label')).toBe(false);
  });

  it('leaves both of a caller’s ARIA names where they wrote them', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <h2 id="heading">Results</h2>
        <v-pagination total="100" aria-label="Result pages" aria-labelledby="heading">
        </v-pagination>
      `),
    })
    class Page {}

    const { host } = show(Page);

    // A `<nav>` of their own would keep both — the reference names it, and the
    // label is what the platform falls back on when the reference finds
    // nothing. What gives way to a reference is the name this component makes
    // up, never one the caller wrote.
    expect(nav(host).getAttribute('aria-labelledby')).toBe('heading');
    expect(nav(host).getAttribute('aria-label')).toBe('Result pages');
    click(page(host, 2));
    expect(nav(host).getAttribute('aria-label')).toBe('Result pages');
  });

  it('follows a name bound in either spelling, and gives the default back when it goes', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <h2 id="first">First</h2>
        <h2 id="second">Second</h2>
        <v-pagination total="100" :aria-label="name.get()"></v-pagination>
        <v-pagination total="100" :aria-labelledby="by.get()"></v-pagination>
        <v-pagination total="100" :labelledBy="by.get()"></v-pagination>
      `),
    })
    class Page {
      name = new Signal.State<string | undefined>('Result pages');
      by = new Signal.State<string | undefined>('first');
    }

    const { instance, host } = show(Page);
    const navs = [...host.querySelectorAll<HTMLElement>('.volt-pagination')];
    const names = (): (string | null)[][] =>
      navs.map((each) => [each.getAttribute('aria-label'), each.getAttribute('aria-labelledby')]);

    expect(names()).toEqual([
      ['Result pages', null],
      [null, 'first'],
      [null, 'first'],
    ]);

    instance.name.set('Seiten');
    instance.by.set('second');
    flushSync();
    expect(names()).toEqual([
      ['Seiten', null],
      [null, 'second'],
      [null, 'second'],
    ]);

    // Nothing left to point at, so the landmark is named again rather than
    // left with no name at all.
    instance.name.set(undefined);
    instance.by.set(undefined);
    flushSync();
    expect(names()).toEqual([
      ['Pagination', null],
      ['Pagination', null],
      ['Pagination', null],
    ]);
  });

  it('says everything in the caller’s words, and follows them', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination total="30" :showFirstLast="true" :labels="words.get()">
          <template :slot-previous>Précédent</template>
          <template :slot-next>Suivant</template>
        </v-pagination>
      `),
    })
    class Page {
      words = new Signal.State({
        first: 'Première page',
        previous: 'Page précédente',
        next: 'Page suivante',
        last: 'Dernière page',
        page: (n: number) => `Page ${n}`,
        status: (n: number, count: number) => `Page ${n} sur ${count}`,
      });
    }

    const { instance, host } = show(Page);
    expect(control(host, 'previous').textContent).toBe('Précédent');
    expect(control(host, 'previous').getAttribute('aria-label')).toBe('Page précédente');
    expect(control(host, 'next').textContent).toBe('Suivant');
    expect(control(host, 'next').getAttribute('aria-label')).toBe('Page suivante');
    expect(control(host, 'first').getAttribute('aria-label')).toBe('Première page');
    expect(control(host, 'last').getAttribute('aria-label')).toBe('Dernière page');
    expect(status(host)).toBe('Page 1 sur 3');

    instance.words.set({
      first: 'Erste Seite',
      previous: 'Vorherige Seite',
      next: 'Nächste Seite',
      last: 'Letzte Seite',
      page: (n: number) => `Seite ${n}`,
      status: (n: number, count: number) => `Seite ${n} von ${count}`,
    });
    flushSync();
    expect(control(host, 'next').getAttribute('aria-label')).toBe('Nächste Seite');
    expect(page(host, 2).getAttribute('aria-label')).toBe('Seite 2');
    expect(status(host)).toBe('Seite 1 von 3');
  });

  it('draws the page numbers in the page’s own digits, as the announcement says them', () => {
    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`
        <v-pagination total="30"></v-pagination>
        <v-pagination total="30" :href="where"></v-pagination>
      `),
    })
    class Page {
      locale = createLocaleProvider({ defaultLocale: 'ar-EG' });
      where = (page: number): string => `#page-${page}`;
    }

    const { host } = show(Page);
    const digits = new Intl.NumberFormat('ar-EG');
    const [buttons, links] = [...host.querySelectorAll<HTMLElement>('.volt-pagination')];
    const numbers = (pager: HTMLElement): string[] =>
      [...pager.querySelectorAll('.volt-pagination-page')].map((each) => each.textContent!.trim());

    expect(numbers(buttons!)).toEqual([1, 2, 3].map((n) => digits.format(n)));
    // Links are numbers too, and say them the same way.
    expect(links!.querySelector('.volt-pagination-page')!.tagName).toBe('A');
    expect(numbers(links!)).toEqual([1, 2, 3].map((n) => digits.format(n)));
    expect(status(host)).toContain(digits.format(3));
  });

  it('refuses a page that is not a signal, and a pattern where the function belongs', () => {
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});

    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(`<v-pagination total="100" page="3"></v-pagination>`),
    })
    class Numbered {}
    expect(() => show(Numbered)).toThrow(/`page` on <v-pagination> takes a signal/);

    @Component({
      selector: 'v-page',
      imports: [VPagination],
      render: compileTemplate(
        `<v-pagination total="100" href="/results?page={page}"></v-pagination>`,
      ),
    })
    class Patterned {}
    expect(() => show(Patterned)).toThrow(/`href` on <v-pagination> takes a function/);

    silence.mockRestore();
  });
});
