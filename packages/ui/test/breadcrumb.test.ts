/**
 * `<v-breadcrumb>` and `<v-breadcrumb-item>`, driven the way a page drives
 * them.
 *
 * The behaviour is `createBreadcrumb`'s and is tested where it lives. What is
 * left here is what this pair adds: a crumb drawn per tag inside the list, in
 * the order the tags are in; the current page drawn without a link; the
 * overflow button drawn where the collapse is, so the reading order is the
 * order on screen; the collapsed crumbs drawn again as links in the menu; a
 * click on any of them left for a router to take; and each prop handed on
 * doing something, since one that does nothing can be deleted with the suite
 * still green.
 *
 * happy-dom has no layout, so the trail is laid out here, from the words in
 * each crumb, whenever the primitive asks — including in a flush this suite
 * did not start, which is how a trail that changed under the list is seen to
 * be measured again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { findAnchor, shouldInterceptClick } from '@voltdev/router';
import { compileComponents } from './render.js';
import { VBreadcrumb } from '../src/components/breadcrumb.js';
import { VBreadcrumbItem } from '../src/components/breadcrumb-item.js';
import { breadcrumbStyles } from '../src/sheet/breadcrumb.js';
import { primitiveTokens } from '../src/tokens.js';
import { standIn, styledDocument } from './harness.js';

compileComponents();

let unmount: (() => void) | null = null;
const cleanups: (() => void)[] = [];

afterEach(() => {
  unmount?.();
  unmount = null;
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
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

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const PER_CHARACTER = 10;
const CRUMB_PADDING = 20;
const BUTTON = 30;
const SEPARATOR = 10;
/** The button and the separator after it, which is how it usually stands. */
const SLOT = BUTTON + SEPARATOR;
const GAP = 8;

/**
 * A list item's width: its words for a crumb, a fixed box for the button, and
 * the separator after the button when it has one.
 */
function widthOf(item: Element): number {
  if (item.hasAttribute('data-volt-crumb-overflow')) {
    return item.querySelector('.volt-breadcrumb-separator') ? SLOT : BUTTON;
  }
  const words = item.querySelector('.volt-breadcrumb-link')?.textContent ?? '';
  return CRUMB_PADDING + PER_CHARACTER * words.length;
}

const isList = (el: Element): boolean => el.classList.contains('volt-breadcrumb-list');

/**
 * Lay every trail out in one row, with `available` to give.
 *
 * Every item of the list is placed, hidden or not, because the primitive only
 * ever reads the trail with everything in it shown. Returned is the width to
 * resize to, which is read on every measurement.
 */
function layout(start: number): { available: number } {
  const room = { available: start };

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const list = this.parentElement;
    if (!list || !isList(list)) return new DOMRect(0, 0, 0, 0);
    let x = 0;
    for (const item of list.children) {
      const width = widthOf(item);
      if (item === this) return new DOMRect(x, 0, width, 20);
      x += width + GAP;
    }
    return new DOMRect(0, 0, 0, 0);
  });

  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return isList(this) ? room.available : 0;
  });

  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
    if (!isList(this)) return 0;
    const widths = [...this.children].map(widthOf);
    return widths.reduce((total, width) => total + width, 0) + GAP * (widths.length - 1);
  });

  return room;
}

// ---------------------------------------------------------------------------
// Reading the trail
// ---------------------------------------------------------------------------

const nav = (host: HTMLElement): HTMLElement => host.querySelector('nav')!;
const list = (host: HTMLElement): HTMLElement => host.querySelector('ol')!;
const crumbs = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('[data-volt-crumb]'),
];
const links = (host: HTMLElement): HTMLAnchorElement[] => [
  ...host.querySelectorAll<HTMLAnchorElement>('.volt-breadcrumb-link'),
];
const link = (host: HTMLElement, words: string): HTMLAnchorElement =>
  links(host).find((each) => each.textContent === words)!;
const slot = (host: HTMLElement): HTMLElement | null =>
  host.querySelector('[data-volt-crumb-overflow]');
const trigger = (host: HTMLElement): HTMLButtonElement =>
  host.querySelector('.volt-breadcrumb-trigger')!;
const menu = (): HTMLElement | null => document.querySelector('.volt-menu-content');
const menuLinks = (): HTMLAnchorElement[] => [
  ...document.querySelectorAll<HTMLAnchorElement>('.volt-menu-content a'),
];

/** What a reader sees, in the order they see it: the words, `…` for the button. */
function seen(host: HTMLElement): string[] {
  return [...list(host).children]
    .filter((item) => !(item as HTMLElement).hidden)
    .map((item) =>
      item.hasAttribute('data-volt-crumb-overflow')
        ? '…'
        : (item.querySelector('.volt-breadcrumb-link')?.textContent ?? ''),
    );
}

const focused = (): Element | null => document.activeElement;

/** A keydown as a real one arrives: from the focused element, bubbling. */
function press(el: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

function clickOn(el: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

function escape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  flushSync();
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const TRAIL = ['Home', 'Docs', 'Guides', 'Routing', 'Nested', 'Params'];

/** A trail drawn from the page's data, which is how a trail usually is. */
@Component({
  selector: 'v-page',
  imports: [VBreadcrumb, VBreadcrumbItem],
  render: compileTemplate(`
    <v-breadcrumb :ref="trail" class="mine" id="trail" data-area="docs" :onCollapseChange="heard">
      <v-breadcrumb-item
        :for="name in names.get()"
        :key="name"
        :href="'/' + name.toLowerCase()"
      >{ name }</v-breadcrumb-item>
    </v-breadcrumb>
  `),
})
class Page {
  trail: VBreadcrumb | null = null;
  names = new Signal.State(TRAIL);
  seen: (readonly number[])[] = [];
  heard = (collapsed: readonly number[]): void => {
    this.seen.push(collapsed);
  };
}

/** Every prop a caller can bind, bound to a signal of the page's. */
@Component({
  selector: 'v-page-bound',
  imports: [VBreadcrumb, VBreadcrumbItem],
  render: compileTemplate(`
    <v-breadcrumb :ref="trail" :label="name.get()" :overflowLabel="more.get()">
      <v-breadcrumb-item href="/" class="root" id="top" data-volt-no-router>Home</v-breadcrumb-item>
      <v-breadcrumb-item :href="docs.get()" :rel="relation.get()">Docs</v-breadcrumb-item>
      <v-breadcrumb-item title="No page of its own">Guides</v-breadcrumb-item>
      <v-breadcrumb-item href="/routing" :aria-label="guide.get()">Routing</v-breadcrumb-item>
      <v-breadcrumb-item href="/routing/params">Params</v-breadcrumb-item>
    </v-breadcrumb>
  `),
})
class BoundPage {
  trail: VBreadcrumb | null = null;
  name = new Signal.State<string | undefined>('Trail');
  more = new Signal.State<string | undefined>(undefined);
  docs = new Signal.State('/docs');
  relation = new Signal.State<string | undefined>(undefined);
  guide = new Signal.State<string | undefined>('Routing guide');
}

describe('v-breadcrumb', () => {
  it('is a named landmark around a list, one crumb per tag, the page last', () => {
    const { host } = show(Page);

    expect(nav(host).getAttribute('role')).toBe('navigation');
    expect(nav(host).getAttribute('aria-label')).toBe('Breadcrumb');
    // `list-style-type: none` takes list semantics away in some browsers, and
    // how deep the trail goes is worth hearing.
    expect(list(host).getAttribute('role')).toBe('list');
    expect(list(host).tagName).toBe('OL');

    expect(links(host).map((each) => each.textContent)).toEqual(TRAIL);
    expect(crumbs(host).map((each) => each.getAttribute('data-volt-crumb'))).toEqual(
      ['0', '1', '2', '3', '4', '5'],
    );
    expect(links(host).map((each) => each.getAttribute('href'))).toEqual([
      '/home',
      '/docs',
      '/guides',
      '/routing',
      '/nested',
      // Where the reader already is: somewhere to be, not somewhere to go.
      null,
    ]);
    expect(links(host).map((each) => each.getAttribute('aria-current'))).toEqual([
      null,
      null,
      null,
      null,
      null,
      'page',
    ]);
  });

  it('puts a separator between each pair of crumbs, and hides every one of them', () => {
    const { host } = show(Page);

    const separators = [...list(host).querySelectorAll('.volt-breadcrumb-separator')];
    // Five between six crumbs, and one after the button that stands for the
    // collapsed ones, which is there even while the button is not.
    expect(separators).toHaveLength(6);
    for (const separator of separators) {
      expect(separator.getAttribute('aria-hidden')).toBe('true');
      expect(separator.textContent).toBe('/');
    }
    // Nothing follows the page the reader is on.
    const last = crumbs(host).at(-1)!;
    expect(last.querySelector('.volt-breadcrumb-separator')).toBeNull();
  });

  it('lands what the caller wrote on the tag on the landmark', () => {
    const { host } = show(Page);

    // The landmark is the element carrying the role, and the element a page
    // lays out.
    expect([...nav(host).classList].sort()).toEqual(['mine', 'volt-breadcrumb']);
    expect(nav(host).id).toBe('trail');
    expect(nav(host).getAttribute('data-area')).toBe('docs');
    // Not on the list, and not on the crumbs.
    expect(host.querySelectorAll('#trail')).toHaveLength(1);
    expect(list(host).classList.contains('mine')).toBe(false);
  });

  it('lands what the caller wrote on a crumb on its link', () => {
    const { host } = show(BoundPage);

    // A crumb's are on its link — the thing a reader follows, and the thing a
    // router looks at — beside the sheet's own class.
    const home = link(host, 'Home');
    expect([...home.classList].sort()).toEqual(['root', 'volt-breadcrumb-link']);
    expect(home.id).toBe('top');
    expect(home.hasAttribute('data-volt-no-router')).toBe(true);
    expect(home.closest('li')!.classList.contains('root')).toBe(false);
    expect(link(host, 'Guides').title).toBe('No page of its own');
    expect(link(host, 'Routing').getAttribute('aria-label')).toBe('Routing guide');
  });

  it('reads a crumb with nowhere to go as text', () => {
    const { host } = show(BoundPage);

    const guides = link(host, 'Guides');
    expect(guides.hasAttribute('href')).toBe(false);
    expect(guides.tagName).toBe('A');
  });

  it('names the landmark from label, following it', () => {
    const { instance, host } = show(BoundPage);
    expect(nav(host).getAttribute('aria-label')).toBe('Trail');

    instance.name.set('Fil d’Ariane');
    flushSync();
    expect(nav(host).getAttribute('aria-label')).toBe('Fil d’Ariane');

    // Given back, the primitive's own name returns.
    instance.name.set(undefined);
    flushSync();
    expect(nav(host).getAttribute('aria-label')).toBe('Breadcrumb');
  });

  it('puts aria-label written on the tag on the landmark, over label, following it', () => {
    @Component({
      selector: 'v-page-named',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <h2 id="where">You are here</h2>
        <v-breadcrumb label="Trail" :aria-label="spoken.get()" aria-labelledby="where">
          <v-breadcrumb-item href="/">Home</v-breadcrumb-item>
          <v-breadcrumb-item>Here</v-breadcrumb-item>
        </v-breadcrumb>
      `),
    })
    class NamedPage {
      spoken = new Signal.State('Path');
    }

    const { instance, host } = show(NamedPage);
    // The platform's spelling wins over the prop saying the same thing, and is
    // not overwritten by the name in the primitive's bag beside it.
    expect(nav(host).getAttribute('aria-label')).toBe('Path');
    instance.spoken.set('Chemin');
    flushSync();
    expect(nav(host).getAttribute('aria-label')).toBe('Chemin');
    // A name already on the page is the caller's, and stays.
    expect(nav(host).getAttribute('aria-labelledby')).toBe('where');
  });

  it('moves the page as the trail grows, and gives back the link it took', () => {
    const { instance, host } = show(Page);

    instance.names.set([...TRAIL, 'Query']);
    flushSync();

    expect(links(host).map((each) => each.textContent)).toEqual([...TRAIL, 'Query']);
    expect(link(host, 'Params').getAttribute('href')).toBe('/params');
    expect(link(host, 'Params').hasAttribute('aria-current')).toBe(false);
    expect(link(host, 'Params').nextElementSibling?.textContent).toBe('/');
    expect(link(host, 'Query').getAttribute('aria-current')).toBe('page');
    expect(link(host, 'Query').hasAttribute('href')).toBe(false);
  });

  it('keeps its crumbs in the order they are drawn, whatever order they arrived in', async () => {
    @Component({
      selector: 'v-page-late',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb>
          <v-breadcrumb-item href="/">Home</v-breadcrumb-item>
          <v-breadcrumb-item :for="name in middle.get()" :key="name" href="#"
            >{ name }</v-breadcrumb-item>
          <v-breadcrumb-item>Here</v-breadcrumb-item>
        </v-breadcrumb>
      `),
    })
    class LatePage {
      middle = new Signal.State<string[]>([]);
    }

    const { instance, host } = show(LatePage);
    // Built after the crumb written below the loop, so registered after it:
    // the page is still the last crumb drawn, because the DOM decides.
    instance.middle.set(['Docs', 'Guides']);
    flushSync();
    await Promise.resolve();
    flushSync();

    expect(links(host).map((each) => each.textContent)).toEqual(['Home', 'Docs', 'Guides', 'Here']);
    expect(link(host, 'Here').getAttribute('aria-current')).toBe('page');
    expect(link(host, 'Guides').getAttribute('href')).toBe('#');
    expect(link(host, 'Guides').hasAttribute('aria-current')).toBe(false);
  });

  it('follows a crumb’s href and rel, which are signals', () => {
    const { instance, host } = show(BoundPage);
    const docs = link(host, 'Docs');
    expect(docs.getAttribute('href')).toBe('/docs');
    expect(docs.hasAttribute('rel')).toBe(false);

    instance.docs.set('/documentation');
    instance.relation.set('external');
    flushSync();

    expect(docs.getAttribute('href')).toBe('/documentation');
    expect(docs.getAttribute('rel')).toBe('external');
  });

  it('draws the separator and the button it was handed', () => {
    @Component({
      selector: 'v-page-drawn',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb>
          <template :slot-separator>›</template>
          <template :slot-overflow><b>more</b></template>
          <v-breadcrumb-item href="/">Home</v-breadcrumb-item>
          <v-breadcrumb-item href="/docs"><i>Docs</i></v-breadcrumb-item>
          <v-breadcrumb-item>Here</v-breadcrumb-item>
        </v-breadcrumb>
      `),
    })
    class DrawnPage {}

    const { host } = show(DrawnPage);
    const separators = [...host.querySelectorAll('.volt-breadcrumb-separator')];
    expect(separators.map((each) => each.textContent)).toEqual(['›', '›', '›']);
    expect(trigger(host).innerHTML).toBe('<b>more</b>');
    // A crumb's words are whatever was written inside its tag.
    expect(link(host, 'Docs').innerHTML).toBe('<i>Docs</i>');
  });

  it('hands the primitive itself to whoever needs more than this offers', () => {
    const { instance } = show(Page);

    expect(instance.trail).toBeInstanceOf(VBreadcrumb);
    const primitive = instance.trail!.crumbs;
    expect(primitive.count()).toBe(6);
    expect(primitive.isCurrent(5)).toBe(true);
    expect(primitive.isCurrent(4)).toBe(false);
    expect(primitive.collapsed()).toEqual([]);
  });

  it('refuses to be a crumb of nothing', () => {
    @Component({
      selector: 'v-page-stray',
      imports: [VBreadcrumbItem],
      render: compileTemplate(`<v-breadcrumb-item href="/">Home</v-breadcrumb-item>`),
    })
    class StrayPage {}

    expect(() => show(StrayPage)).toThrow(/has to be written inside <v-breadcrumb>/);
  });

  it('refuses a count of crumbs that is not one, and reads one written as an attribute', () => {
    @Component({
      selector: 'v-page-typo',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb itemsBefore="two"><v-breadcrumb-item>Here</v-breadcrumb-item></v-breadcrumb>
      `),
    })
    class TypoPage {}

    expect(() => show(TypoPage)).toThrow(/`itemsBefore` on <v-breadcrumb> takes a whole number/);

    @Component({
      selector: 'v-page-half',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb :itemsAfter="1.5"><v-breadcrumb-item>Here</v-breadcrumb-item></v-breadcrumb>
      `),
    })
    class HalfPage {}

    expect(() => show(HalfPage)).toThrow(/`itemsAfter` on <v-breadcrumb> takes a whole number/);

    // The primitive would read -1 as 0 and fold from the root, while the
    // button was drawn in front of a crumb that is not there: crumbs put away
    // with nothing on screen to bring them back.
    @Component({
      selector: 'v-page-negative',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb itemsBefore="-1"><v-breadcrumb-item>Here</v-breadcrumb-item></v-breadcrumb>
      `),
    })
    class NegativePage {}

    expect(() => show(NegativePage)).toThrow(/`itemsBefore` on <v-breadcrumb> takes a whole number/);

    // Written bare, the attribute arrives as `true` rather than as a string,
    // and is refused in the same words rather than with a TypeError from
    // inside the parse that says nothing about the tag.
    @Component({
      selector: 'v-page-bare',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb itemsAfter><v-breadcrumb-item>Here</v-breadcrumb-item></v-breadcrumb>
      `),
    })
    class BarePage {}

    expect(() => show(BarePage)).toThrow(/`itemsAfter` on <v-breadcrumb> takes a whole number/);

    // `Number` reads blank as zero; a count left blank is not a count of none.
    @Component({
      selector: 'v-page-blank',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb itemsBefore=" "><v-breadcrumb-item>Here</v-breadcrumb-item></v-breadcrumb>
      `),
    })
    class BlankPage {}

    expect(() => show(BlankPage)).toThrow(/`itemsBefore` on <v-breadcrumb> takes a whole number/);
  });
});

// ---------------------------------------------------------------------------
// Collapsing
// ---------------------------------------------------------------------------

describe('a trail that does not fit', () => {
  it('collapses nothing where there is no layout to measure', () => {
    const { instance, host } = show(Page);

    expect(instance.trail!.crumbs.collapsed()).toEqual([]);
    expect(seen(host)).toEqual(TRAIL);
    expect(slot(host)!.hidden).toBe(true);
  });

  it('hides the fewest middle crumbs, and draws the button where they were', () => {
    // Six crumbs, 450 wide with the gaps between them, want 490. With the
    // button in the place of two of them, 382.
    const room = layout(400);
    const { instance, host } = show(Page);

    expect(instance.trail!.crumbs.collapsed()).toEqual([1, 2]);
    expect(seen(host)).toEqual(['Home', '…', 'Routing', 'Nested', 'Params']);

    // In the list, between the crumbs it stands for and the one before them —
    // so the order a reader tabs through is the order they see.
    const items = [...list(host).children];
    expect(items.indexOf(slot(host)!)).toBe(1);
    expect(slot(host)!.nextElementSibling).toBe(crumbs(host)[1]);

    // Hidden, not unmounted: a crumb out of the document has no width, and its
    // width is what decides whether it comes back.
    expect(crumbs(host)).toHaveLength(6);
    expect(crumbs(host)[1]!.hidden).toBe(true);
    expect(crumbs(host)[1]!.isConnected).toBe(true);

    expect(trigger(host).getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger(host).getAttribute('aria-label')).toBe('Show the rest of the path');
    expect(trigger(host).type).toBe('button');

    room.available = 1000;
    instance.trail!.crumbs.measure();
    flushSync();
    expect(seen(host)).toEqual(TRAIL);
    expect(slot(host)!.hidden).toBe(true);
  });

  it('measures again when the trail is replaced by one as long, with longer words', () => {
    layout(320);
    const { instance, host } = show(Page);
    instance.names.set(['Home', 'A', 'B', 'C', 'D', 'Here']);
    flushSync();
    expect(seen(host)).toEqual(['Home', 'A', 'B', 'C', 'D', 'Here']);

    // Nobody calls `measure()`: the next page's trail is the same length as
    // this one, and still does not fit.
    instance.names.set(['Home', 'Account', 'Projects', 'Volt', 'Settings', 'Members']);
    flushSync();
    expect(seen(host)).toEqual(['Home', '…', 'Settings', 'Members']);
  });

  it('reports what went into the menu, and nothing when that did not change', () => {
    const room = layout(400);
    const { instance } = show(Page);
    expect(instance.seen).toEqual([[1, 2]]);

    instance.trail!.crumbs.measure();
    flushSync();
    expect(instance.seen).toEqual([[1, 2]]);

    room.available = 300;
    instance.trail!.crumbs.measure();
    flushSync();
    expect(instance.seen).toEqual([
      [1, 2],
      [1, 2, 3],
    ]);
  });

  it('keeps as many crumbs at each end as it was told to', () => {
    @Component({
      selector: 'v-page-kept',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb itemsBefore="2" :itemsAfter="2">
          <v-breadcrumb-item :for="name in names" :key="name" href="#">{ name }</v-breadcrumb-item>
        </v-breadcrumb>
      `),
    })
    class KeptPage {
      names = TRAIL;
    }

    layout(10);
    const { host } = show(KeptPage);

    expect(seen(host)).toEqual(['Home', 'Docs', '…', 'Nested', 'Params']);
    // Drawn in front of the first crumb that can go, which is the third.
    expect(slot(host)!.nextElementSibling).toBe(crumbs(host)[2]);
  });

  it('measures nothing, and draws no button, when told not to collapse', () => {
    @Component({
      selector: 'v-page-whole',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb :collapse="false">
          <v-breadcrumb-item :for="name in names" :key="name" href="#">{ name }</v-breadcrumb-item>
        </v-breadcrumb>
      `),
    })
    class WholePage {
      names = TRAIL;
    }

    layout(10);
    const { host } = show(WholePage);

    expect(seen(host)).toEqual(TRAIL);
    expect(slot(host)).toBeNull();
    expect(host.querySelector('.volt-breadcrumb-trigger')).toBeNull();
  });

  it('keeps the collapse it was built with when a binding changes it later', () => {
    // `collapse` is what the primitive is built with, and the primitive does
    // not hear it change. A button that did would come and go on its own
    // while the primitive went on folding crumbs away — and with the button
    // gone, nothing on screen reaches them.
    @Component({
      selector: 'v-page-rebound',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb :ref="trail" :collapse="folds.get()">
          <v-breadcrumb-item :for="name in names.get()" :key="name" href="#">{ name }</v-breadcrumb-item>
        </v-breadcrumb>
      `),
    })
    class ReboundPage {
      trail: VBreadcrumb | null = null;
      folds = new Signal.State(true);
      names = new Signal.State(TRAIL);
    }

    layout(300);
    const { instance, host } = show(ReboundPage);
    expect(seen(host)).toEqual(['Home', '…', 'Nested', 'Params']);

    instance.folds.set(false);
    flushSync();
    // Anything that has the crumbs drawn again: the next page's trail.
    instance.names.set([...TRAIL, 'Query']);
    flushSync();

    const hidden = crumbs(host).filter((each) => each.hidden);
    expect(hidden.length).toBeGreaterThan(0);
    expect(slot(host)?.hidden).toBe(false);
    expect(seen(host)[1]).toBe('…');
    clickOn(trigger(host));
    expect(menuLinks()).toHaveLength(hidden.length);
  });

  it('folds the page itself into the menu when it keeps nothing at the end', () => {
    @Component({
      selector: 'v-page-endless',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb :ref="trail" :itemsAfter="0">
          <v-breadcrumb-item :for="name in names" :key="name" href="#">{ name }</v-breadcrumb-item>
        </v-breadcrumb>
      `),
    })
    class EndlessPage {
      trail: VBreadcrumb | null = null;
      names = TRAIL;
    }

    const room = layout(10);
    const { instance, host } = show(EndlessPage);
    expect(instance.trail!.crumbs.collapsed()).toEqual([1, 2, 3, 4, 5]);
    expect(seen(host)).toEqual(['Home', '…']);
    // Nothing follows the button, so nothing separates it from anything.
    const separator = slot(host)!.querySelector('.volt-breadcrumb-separator');
    expect(separator).toBeNull();

    // In the menu the page is still the page: marked, and going nowhere.
    clickOn(trigger(host));
    const page = menuLinks().at(-1)!;
    expect(page.textContent).toBe('Params');
    expect(page.getAttribute('aria-current')).toBe('page');
    expect(page.hasAttribute('href')).toBe(false);
    for (const each of menuLinks().slice(0, -1)) {
      expect(each.hasAttribute('aria-current')).toBe(false);
    }
    escape();

    // Given the room to show the page again, the separator comes back
    // between the button and it.
    room.available = 400;
    instance.trail!.crumbs.measure();
    flushSync();
    expect(seen(host).at(-1)).toBe('Params');
    expect(seen(host)).toContain('…');
    expect(slot(host)!.querySelector('.volt-breadcrumb-separator')?.textContent).toBe('/');
  });

  it('measures the button with the separator it will have when the page comes back', () => {
    @Component({
      selector: 'v-page-returning',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb :ref="trail" :itemsAfter="0">
          <v-breadcrumb-item :for="name in names" :key="name" href="#">{ name }</v-breadcrumb-item>
        </v-breadcrumb>
      `),
    })
    class ReturningPage {
      trail: VBreadcrumb | null = null;
      names = TRAIL;
    }

    const room = layout(10);
    const { instance, host } = show(ReturningPage);
    expect(seen(host)).toEqual(['Home', '…']);

    // Home, the button and Params want 60 + 40 + 80 and two gaps of 8: 196,
    // with the separator the button has the moment the page is back beside
    // it. Measured bare, as it stands while the page is folded, the button
    // would say 186 — and a list 190 wide would take the page back and
    // overflow.
    room.available = 190;
    instance.trail!.crumbs.measure();
    flushSync();
    expect(seen(host)).toEqual(['Home', '…']);

    room.available = 196;
    instance.trail!.crumbs.measure();
    flushSync();
    expect(seen(host)).toEqual(['Home', '…', 'Params']);
  });

  it('names the button from overflowLabel, and the menu through it, following it', () => {
    layout(10);
    const { instance, host } = show(BoundPage);
    expect(trigger(host).getAttribute('aria-label')).toBe('Show the rest of the path');

    instance.more.set('Show the folders above');
    flushSync();
    expect(trigger(host).getAttribute('aria-label')).toBe('Show the folders above');

    clickOn(trigger(host));
    expect(menu()!.getAttribute('aria-labelledby')).toBe(trigger(host).id);
  });
});

// ---------------------------------------------------------------------------
// The overflow menu
// ---------------------------------------------------------------------------

describe('the overflow menu', () => {
  it('draws the collapsed crumbs again, as links, in a menu portalled out of the trail', () => {
    layout(300);
    const { host } = show(Page);
    expect(menu()).toBeNull();

    clickOn(trigger(host));

    const sheet = menu()!;
    expect(sheet.getAttribute('role')).toBe('menu');
    expect(host.contains(sheet)).toBe(false);
    expect(trigger(host).getAttribute('aria-expanded')).toBe('true');
    expect(trigger(host).getAttribute('aria-controls')).toBe(sheet.id);

    expect(menuLinks().map((each) => each.textContent)).toEqual(['Docs', 'Guides', 'Routing']);
    expect(menuLinks().map((each) => each.getAttribute('href'))).toEqual([
      '/docs',
      '/guides',
      '/routing',
    ]);
    for (const each of menuLinks()) {
      expect(each.getAttribute('role')).toBe('menuitem');
      expect([...each.classList].sort()).toEqual(['volt-breadcrumb-menu-link', 'volt-menu-item']);
    }
    // The copies in the trail are out of the accessibility tree, so each
    // crumb is announced once.
    expect(crumbs(host).filter((each) => each.hidden)).toHaveLength(3);
  });

  it('carries each crumb’s relationship to the page into the menu, and follows it', () => {
    layout(10);
    const { instance, host } = show(BoundPage);
    clickOn(trigger(host));

    const docs = menuLinks().find((each) => each.textContent === 'Docs')!;
    expect(docs.getAttribute('href')).toBe('/docs');
    expect(docs.hasAttribute('rel')).toBe(false);

    instance.relation.set('external');
    instance.docs.set('/documentation');
    flushSync();
    expect(docs.getAttribute('rel')).toBe('external');
    expect(docs.getAttribute('href')).toBe('/documentation');
  });

  it('names a crumb’s copy in the menu the way the caller named the crumb', () => {
    layout(10);
    const { instance, host } = show(BoundPage);
    expect(link(host, 'Routing').getAttribute('aria-label')).toBe('Routing guide');

    clickOn(trigger(host));
    const copies = menuLinks();
    // One place to go, one name for it, wherever it is drawn.
    const routing = copies.find((each) => each.textContent === 'Routing')!;
    expect(routing.getAttribute('aria-label')).toBe('Routing guide');
    // A crumb named by its words is named by them in the menu too.
    const docs = copies.find((each) => each.textContent === 'Docs')!;
    expect(docs.hasAttribute('aria-label')).toBe(false);

    // Bound, the name follows in both places, and comes off both.
    instance.guide.set('The routing guide');
    flushSync();
    expect(link(host, 'Routing').getAttribute('aria-label')).toBe('The routing guide');
    expect(routing.getAttribute('aria-label')).toBe('The routing guide');
    instance.guide.set(undefined);
    flushSync();
    expect(link(host, 'Routing').hasAttribute('aria-label')).toBe(false);
    expect(routing.hasAttribute('aria-label')).toBe(false);
  });

  it('opens on the keyboard at either end, moves by arrow, and closes back to the button', () => {
    layout(300);
    const { host } = show(Page);
    const button = trigger(host);
    button.focus();

    press(button, 'Enter');
    expect(focused()?.textContent).toBe('Docs');
    press(focused()!, 'ArrowDown');
    expect(focused()?.textContent).toBe('Guides');
    press(focused()!, 'End');
    expect(focused()?.textContent).toBe('Routing');
    // Round the end, back to the start.
    press(focused()!, 'ArrowDown');
    expect(focused()?.textContent).toBe('Docs');
    // Typeahead, on the words a crumb was written with.
    press(focused()!, 'r');
    expect(focused()?.textContent).toBe('Routing');

    escape();
    expect(menu()?.getAttribute('data-state') ?? 'closed').toBe('closed');
    expect(focused()).toBe(button);

    press(button, 'ArrowUp');
    expect(focused()?.textContent).toBe('Routing');
    // Tab closes it and is not taken: the browser carries on out of the trail.
    expect(press(focused()!, 'Tab').defaultPrevented).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves Enter and Space to the browser, because the items are links', () => {
    layout(300);
    const { host } = show(Page);
    press(trigger(host), 'ArrowDown');
    const first = focused()!;

    // Enter follows the link, and the click it fires closes the menu; Space
    // scrolls the page. Taking either would be a menu that never navigates.
    expect(press(first, 'Enter').defaultPrevented).toBe(false);
    expect(press(first, ' ').defaultPrevented).toBe(false);
    expect(press(first, 'ArrowDown').defaultPrevented).toBe(true);
  });

  it('closes on Enter over a crumb that goes nowhere, as a press on it does', () => {
    // A section with no page of its own, and the page itself, folded in by a
    // trail that keeps nothing at its end: items with no `href`, so an Enter
    // left to the browser follows nothing and fires no click. Taken here, it
    // does what a press on the same item does — closes the menu, and gives
    // focus back to the button.
    @Component({
      selector: 'v-page-nowhere',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb :itemsAfter="0">
          <v-breadcrumb-item href="/">Home</v-breadcrumb-item>
          <v-breadcrumb-item href="/docs">Docs</v-breadcrumb-item>
          <v-breadcrumb-item>Guides</v-breadcrumb-item>
          <v-breadcrumb-item>Here</v-breadcrumb-item>
        </v-breadcrumb>
      `),
    })
    class NowherePage {}

    layout(10);
    const { host } = show(NowherePage);
    const button = trigger(host);
    button.focus();

    press(button, 'Enter');
    press(focused()!, 'ArrowDown');
    expect(focused()?.textContent).toBe('Guides');
    expect(press(focused()!, 'Enter').defaultPrevented).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(focused()).toBe(button);

    press(button, 'ArrowUp');
    expect(focused()?.textContent).toBe('Here');
    // A modified Enter is a shortcut, and chooses nothing.
    const shortcut = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    focused()!.dispatchEvent(shortcut);
    flushSync();
    expect(shortcut.defaultPrevented).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    press(focused()!, 'Enter');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(focused()).toBe(button);

    // A crumb that is a link is still the browser's to follow.
    press(button, 'Enter');
    expect(focused()?.textContent).toBe('Docs');
    expect(press(focused()!, 'Enter').defaultPrevented).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A router
// ---------------------------------------------------------------------------

describe('with a router listening', () => {
  /**
   * What `createRouter` does with a click, less the navigating: one listener
   * on the document, asking the router's own question of each click.
   */
  function listen(): { taken: string[]; left: string[] } {
    const record = { taken: [] as string[], left: [] as string[] };
    const onClick = (event: MouseEvent): void => {
      const anchor = findAnchor(event);
      const words = anchor?.textContent ?? '';
      if (anchor && shouldInterceptClick(event, anchor)) record.taken.push(words);
      else record.left.push(words);
      // happy-dom would follow the link, and take the document with it.
      event.preventDefault();
    };
    document.addEventListener('click', onClick);
    cleanups.push(() => document.removeEventListener('click', onClick));
    return record;
  }

  it('hands it a plain click on a crumb, in the trail or in the menu', () => {
    const room = layout(1000);
    const { instance, host } = show(BoundPage);
    const router = listen();

    clickOn(link(host, 'Docs'));
    // The page the reader is on is not a link, so there is nothing to take.
    clickOn(link(host, 'Params'));
    // A modified click asks for a second place to look, which is the browser's.
    clickOn(link(host, 'Docs'), { metaKey: true });
    expect(router.taken).toEqual(['Docs']);
    expect(router.left).toEqual(['Params', 'Docs']);

    // Collapsed, the same crumb is a link in the menu, and goes the same way.
    // Choosing it closes the menu and leaves the click alone for whoever
    // listens after.
    room.available = 300;
    instance.trail!.crumbs.measure();
    flushSync();
    clickOn(trigger(host));
    clickOn(menuLinks().find((each) => each.textContent === 'Docs')!);
    expect(router.taken).toEqual(['Docs', 'Docs']);
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves it a crumb the caller said the server owns, wherever it is drawn', () => {
    const room = layout(1000);
    const { instance, host } = show(BoundPage);
    const router = listen();
    instance.relation.set('external');
    flushSync();

    clickOn(link(host, 'Docs'));
    room.available = 300;
    instance.trail!.crumbs.measure();
    flushSync();
    clickOn(trigger(host));
    clickOn(menuLinks().find((each) => each.textContent === 'Docs')!);

    expect(router.taken).toEqual([]);
    // The one in the middle is the button, which is no link at all.
    expect(router.left).toEqual(['Docs', '', 'Docs']);
  });
});

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

describe('the sheet', () => {
  it('has something rendered for every rule it holds, in one state or another', () => {
    // A rule nothing matches is a state a user never sees. The pointer and
    // keyboard focus are not driven here; what is asked is whether the
    // elements and attributes around them are ones this pair renders.
    @Component({
      selector: 'v-page-every',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb :ref="trail" :itemsAfter="0">
          <v-breadcrumb-item href="/">Home</v-breadcrumb-item>
          <v-breadcrumb-item>Guides</v-breadcrumb-item>
          <v-breadcrumb-item href="/routing">Routing</v-breadcrumb-item>
          <v-breadcrumb-item>Here</v-breadcrumb-item>
        </v-breadcrumb>
      `),
    })
    class EveryPage {
      trail: VBreadcrumb | null = null;
    }

    const selectors = [...breadcrumbStyles.rules, ...breadcrumbStyles.forcedColors]
      .flatMap((rule) => rule.selector.split(','))
      .map((selector) =>
        selector.trim().replaceAll(':hover', '').replaceAll(':focus-visible', ''),
      );
    const unmatched = new Set(selectors);
    const look = (): void => {
      for (const selector of unmatched) {
        if (document.querySelector(selector)) unmatched.delete(selector);
      }
    };

    // The whole trail, the page at the end of it.
    const room = layout(1000);
    const { instance, host } = show(EveryPage);
    look();
    // Folded all the way, the page with it, and the menu open on them.
    room.available = 10;
    instance.trail!.crumbs.measure();
    flushSync();
    clickOn(trigger(host));
    look();

    expect([...unmatched]).toEqual([]);
  });

  it('marks the page in a weight the default faces draw', () => {
    // Once the palette is forced, weight is all that tells the page from a
    // crumb with no page of its own, and in the menu from every other item.
    // `--volt-font-family-sans` starts at `system-ui` — Segoe UI on Windows,
    // where forced colours live, Noto Sans on a common Linux — and neither
    // carries a 500: a face without the weight asked for draws the 400 beside
    // it, so a medium page is a regular one there. Both carry a 600.
    const weight = (selector: string): number => {
      const rule = breadcrumbStyles.rules.find((each) => each.selector === selector);
      const value = rule?.declarations['font-weight'] ?? '400';
      const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
      return Number(token === undefined ? value : primitiveTokens[token]);
    };

    expect(weight(".volt-breadcrumb-link[aria-current='page']")).toBeGreaterThanOrEqual(600);
    expect(weight(".volt-breadcrumb-menu-link[aria-current='page']")).toBeGreaterThanOrEqual(600);
  });

  it('draws a section folded into the menu apart from the links there, in either palette', async () => {
    // In the trail a section with no page of its own is muted text that takes
    // no focus. Folded, it is an item of the menu like every link beside it,
    // and drawn like them it promises a page that is not there.
    @Component({
      selector: 'v-page-sectioned',
      imports: [VBreadcrumb, VBreadcrumbItem],
      render: compileTemplate(`
        <v-breadcrumb>
          <v-breadcrumb-item href="/">Home</v-breadcrumb-item>
          <v-breadcrumb-item href="/docs">Docs</v-breadcrumb-item>
          <v-breadcrumb-item>Guides</v-breadcrumb-item>
          <v-breadcrumb-item href="/routing">Routing</v-breadcrumb-item>
          <v-breadcrumb-item>Here</v-breadcrumb-item>
        </v-breadcrumb>
      `),
    })
    class SectionedPage {}

    layout(10);
    const { host } = show(SectionedPage);
    clickOn(trigger(host));
    expect(menuLinks().map((each) => each.textContent)).toEqual(['Docs', 'Guides', 'Routing']);

    // This document never had the sheet in it, and cannot have the palette
    // forced; the trail and its open menu are copied, as rendered, into two
    // that can.
    const markup = host.innerHTML + menu()!.outerHTML;
    const colours = async (forcedColors: boolean) => {
      const dom = styledDocument({ forcedColors });
      try {
        const { document: page } = dom.window;
        page.body.innerHTML = markup;
        const find = (selector: string, words: string) => {
          const found = [...page.querySelectorAll(selector)].find((each) => each.textContent === words);
          expect(found, `${selector} ${words}`).toBeDefined();
          return found!;
        };
        const colour = (selector: string, words: string): string =>
          dom.window.getComputedStyle(find(selector, words)).getPropertyValue('color');
        // Colour and line together, under the pointer: the harness reads
        // `:hover` as `[data-hover]`.
        const pointedAt = (words: string): string => {
          const item = find('.volt-breadcrumb-menu-link', words);
          item.setAttribute('data-hover', '');
          const style = dom.window.getComputedStyle(item);
          const drawn = `${style.getPropertyValue('color')} ${style.getPropertyValue('text-decoration-line')}`;
          item.removeAttribute('data-hover');
          return drawn;
        };
        return {
          section: colour('.volt-breadcrumb-menu-link', 'Guides'),
          link: colour('.volt-breadcrumb-menu-link', 'Docs'),
          trail: colour('.volt-breadcrumb-link', 'Guides'),
          pointedAt: { section: pointedAt('Guides'), link: pointedAt('Docs') },
        };
      } finally {
        await dom.close();
      }
    };

    const plain = await colours(false);
    expect(plain.section).not.toBe(plain.link);
    expect(plain.section).toBe(plain.trail);

    // Forced, every item of the menu is the palette's text: grey is what is
    // left to say that this one leads nowhere.
    const forced = await colours(true);
    expect(forced.section).not.toBe(forced.link);
    expect(forced.section).toBe(standIn('GrayText'));
    // Under the pointer the menu gives every item one pair, grey included, so
    // the line under a link is what is left to tell the two apart.
    expect(forced.pointedAt.section).not.toBe(forced.pointedAt.link);
    expect(forced.pointedAt.link).toBe(`${standIn('HighlightText')} underline`);
  });
});
