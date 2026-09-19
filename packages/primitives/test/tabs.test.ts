/**
 * Tabs, driven through a real mounted component.
 *
 * What is worth asserting is the pattern rather than the markup: which tab
 * Tab lands on, what the arrow keys do at each end and in each writing
 * direction, and whether a screen reader is told which panel belongs to which
 * tab. All of that is invisible to anyone testing with a mouse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { createTabs, TAB_VALUE_ATTRIBUTE, type TabsOptions } from '../src/tabs.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><button id="after">after</button>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
});

type HostOptions = Omit<TabsOptions, 'list'>;

/**
 * Four tabs and four panels, the third tab disabled.
 *
 * A disabled tab in the middle is deliberate: every off-by-one in the arrow
 * keys shows up as landing on it, and every "skip" that only works at the ends
 * shows up as stopping there.
 */
function defineHost(options: HostOptions = {}, listAttrs = '') {
  @Component({
    selector: 'v-tabs',
    render: compileTemplate(`
      <div>
        <div :ref="list" ${listAttrs} :spread="tabs.listProps()">
          <button :spread="tabs.tabProps('one')">One</button>
          <button :spread="tabs.tabProps('two')">Two</button>
          <button :spread="tabs.tabProps('three', { disabled: true })">Three</button>
          <button :spread="tabs.tabProps('four')">Four</button>
        </div>
        <div :spread="tabs.panelProps('one')">panel one</div>
        <div :spread="tabs.panelProps('two')">panel two</div>
        <div :spread="tabs.panelProps('three')">panel three</div>
        <div :spread="tabs.panelProps('four')">panel four</div>
      </div>
    `),
  })
  class TabsHost {
    list = new Signal.State<Element | null>(null);
    tabs = createTabs({ list: () => this.list.get(), ...options });
  }

  return TabsHost;
}

/** A second mount point, for the tests that put two tab lists on one page. */
function newHost(): HTMLElement {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
}

function setup(options: HostOptions = {}, listAttrs = '', container: HTMLElement = host) {
  const handle = track(mount(defineHost(options, listAttrs), container));
  flushSync();

  const tab = (value: string): HTMLElement =>
    container.querySelector(`[${TAB_VALUE_ATTRIBUTE}="${value}"]`)!;

  const panel = (value: string): HTMLElement =>
    container.querySelector(`[aria-labelledby="${tab(value).id}"]`)!;

  return {
    tabs: (handle.instance as InstanceType<ReturnType<typeof defineHost>>).tabs,
    list: (): HTMLElement => container.querySelector('[role="tablist"]')!,
    tab,
    panel,
    selection: () =>
      [...container.querySelectorAll('[role="tab"]')]
        .filter((el) => el.getAttribute('aria-selected') === 'true')
        .map((el) => el.getAttribute(TAB_VALUE_ATTRIBUTE)),
    tabStops: () =>
      [...container.querySelectorAll('[role="tab"]')].map((el) => el.getAttribute('tabindex')),
  };
}

/** A keydown on a tab, as a real one arrives: from the focused tab, bubbling. */
function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

const focusedValue = () => document.activeElement?.getAttribute(TAB_VALUE_ATTRIBUTE) ?? null;

describe('what assistive technology is told', () => {
  it('marks up the list, the tabs and the panels', () => {
    const { list, tab, panel } = setup({ defaultValue: 'one' });

    expect(list().getAttribute('role')).toBe('tablist');
    expect(list().getAttribute('aria-orientation')).toBe('horizontal');

    expect(tab('one').getAttribute('role')).toBe('tab');
    expect(panel('one').getAttribute('role')).toBe('tabpanel');

    // The panel itself is reachable, so a panel of plain prose is not skipped
    // over by a keyboard user.
    expect(panel('one').getAttribute('tabindex')).toBe('0');
  });

  it('writes the state and the axis out for CSS to hang on', () => {
    const { list, tab, panel } = setup({ defaultValue: 'one', orientation: 'vertical' });

    expect(list().getAttribute('data-orientation')).toBe('vertical');
    expect(tab('one').getAttribute('data-state')).toBe('active');
    expect(tab('two').getAttribute('data-state')).toBe('inactive');
    expect(panel('one').getAttribute('data-state')).toBe('active');
    expect(tab('three').getAttribute('data-disabled')).toBe('');
  });

  it('points each tab at its panel and each panel back at its tab', () => {
    const { tab, panel } = setup({ defaultValue: 'one' });

    for (const value of ['one', 'two', 'three', 'four']) {
      const controlled = tab(value).getAttribute('aria-controls')!;
      expect(document.getElementById(controlled)).toBe(panel(value));
      expect(panel(value).getAttribute('aria-labelledby')).toBe(tab(value).id);
    }
  });

  it('keeps aria-controls resolvable for the tabs whose panel is not showing', () => {
    const { tab } = setup({ defaultValue: 'one' });

    // The unselected panels are hidden rather than removed, so the reference
    // still names something. A dangling one would be silent breakage.
    const controlled = tab('four').getAttribute('aria-controls')!;
    expect(document.getElementById(controlled)).not.toBeNull();
  });

  it('says which tab is selected, and only one', () => {
    const { selection, tab } = setup({ defaultValue: 'two' });
    expect(selection()).toEqual(['two']);
    expect(tab('one').getAttribute('aria-selected')).toBe('false');
  });

  it('marks a disabled tab without taking it out of the accessibility tree', () => {
    const { tab } = setup({ defaultValue: 'one' });

    // aria-disabled, not the native attribute, which a tab rendered as a
    // `<div>` or an `<a>` would ignore. The tab is still announced among the
    // others; it is the keyboard that cannot reach it, since the arrows step
    // over it and at rest the tab stop is on the tab that is showing.
    expect(tab('three').getAttribute('aria-disabled')).toBe('true');
    expect(tab('three').hasAttribute('disabled')).toBe(false);
    expect(tab('three').getAttribute('tabindex')).toBe('-1');
  });

  it('gives a disabled tab the tab stop while focus is on it', () => {
    const { tab, tabStops, selection } = setup({ defaultValue: 'one' });

    // The tab stop follows focus, and a pointer press does focus a disabled
    // tab even though no key can reach it. Leaving the stop on another tab
    // would send the next Tab press off from somewhere the user is not.
    tab('three').focus();
    tab('three').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    flushSync();

    expect(tabStops()).toEqual(['-1', '-1', '0', '-1']);
    // Focused is not selected: the press was refused.
    expect(selection()).toEqual(['one']);
  });

  it('keeps the tab stop on a disabled tab the list was told is selected', () => {
    const { tabStops } = setup({ defaultValue: 'three' });

    // A list whose selected tab is disabled would otherwise have no tab stop
    // at all, and Tab would step straight over the whole list.
    expect(tabStops()).toEqual(['-1', '-1', '0', '-1']);
  });

  it('names the list only when it is given a name', () => {
    const bare = setup();
    // A default name would be in the library's language, not the page's.
    expect(bare.list().hasAttribute('aria-label')).toBe(false);
    expect(bare.list().hasAttribute('aria-labelledby')).toBe(false);

    const named = setup({ label: 'Réglages' }, '', newHost());
    expect(named.list().getAttribute('aria-label')).toBe('Réglages');
  });

  it('takes an external element as the list name', () => {
    const { list } = setup({ labelledBy: 'heading' });
    expect(list().getAttribute('aria-labelledby')).toBe('heading');
  });

  it('gives two tab lists on one page distinct ids', () => {
    const first = setup({ defaultValue: 'one' });
    const second = setup({ defaultValue: 'one' }, '', newHost());

    expect(first.tab('one').id).not.toBe(second.tab('one').id);
    // And each still points at its own panel, not the other list's.
    expect(document.getElementById(second.tab('one').getAttribute('aria-controls')!)).toBe(
      second.panel('one'),
    );
  });

  it('survives a value that is not a legal id on its own', () => {
    @Component({
      selector: 'v-awkward',
      render: compileTemplate(`
        <div>
          <div :ref="list" :spread="tabs.listProps()">
            <button :spread="tabs.tabProps('my tab')">One</button>
            <button :spread="tabs.tabProps('other')">Two</button>
          </div>
          <div :spread="tabs.panelProps('my tab')">first</div>
          <div :spread="tabs.panelProps('other')">second</div>
        </div>
      `),
    })
    class Awkward {
      list = new Signal.State<Element | null>(null);
      tabs = createTabs({ list: () => this.list.get(), defaultValue: 'my tab' });
    }

    track(mount(Awkward, host));
    flushSync();

    // aria-controls is a space-separated list of ids, so a value with a space
    // in it must not reach the attribute.
    const tab = host.querySelector(`[${TAB_VALUE_ATTRIBUTE}="my tab"]`)!;
    const controlled = tab.getAttribute('aria-controls')!;
    expect(controlled).not.toContain(' ');
    expect(document.getElementById(controlled)).not.toBeNull();
  });
});

describe('selection', () => {
  it('shows the default tab and hides the rest', () => {
    const { panel } = setup({ defaultValue: 'two' });
    expect(panel('two').hidden).toBe(false);
    expect(panel('one').hidden).toBe(true);
    expect(panel('four').hidden).toBe(true);
  });

  it('selects the first tab when no default was given', () => {
    const { selection, panel } = setup();
    // A tab list with nothing selected shows no panel at all, which is never
    // what the consumer meant.
    expect(selection()).toEqual(['one']);
    expect(panel('one').hidden).toBe(false);
  });

  it('selects on click and swaps the panels over', () => {
    const { tab, panel, selection } = setup({ defaultValue: 'one' });

    tab('two').click();
    flushSync();

    expect(selection()).toEqual(['two']);
    expect(panel('two').hidden).toBe(false);
    expect(panel('one').hidden).toBe(true);
  });

  it('refuses a click on a disabled tab', () => {
    const { tab, selection } = setup({ defaultValue: 'one' });

    // aria-disabled leaves the element clickable; refusing is what makes it
    // disabled in practice.
    tab('three').click();
    flushSync();
    expect(selection()).toEqual(['one']);
  });

  it('reports changes through onValueChange, once each', () => {
    const onValueChange = vi.fn();
    const { tab } = setup({ defaultValue: 'one', onValueChange });

    tab('two').click();
    flushSync();
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('two');

    tab('two').click();
    flushSync();
    // Re-selecting what is already selected is not a change.
    expect(onValueChange).toHaveBeenCalledOnce();
  });

  it('stays quiet about the default it picked itself', () => {
    const onValueChange = vi.fn();
    setup({ onValueChange });
    // An application that persists on change must not record a write nobody
    // made.
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('follows an outside signal when it is given one', () => {
    const value = new Signal.State('one');
    const { selection, panel } = setup({ value });

    value.set('four');
    flushSync();
    expect(selection()).toEqual(['four']);
    expect(panel('four').hidden).toBe(false);
  });

  it('writes back into that signal when the user chooses', () => {
    const value = new Signal.State('one');
    const { tab } = setup({ value });

    tab('two').click();
    flushSync();
    expect(value.get()).toBe('two');
  });

  it('reads and sets the selection from the component itself', () => {
    const { tabs, selection } = setup({ defaultValue: 'one' });

    expect(tabs.value()).toBe('one');
    expect(tabs.isSelected('one')).toBe(true);

    tabs.select('four');
    flushSync();
    expect(selection()).toEqual(['four']);

    // Disabled is disabled however the selection was asked for.
    tabs.select('three');
    flushSync();
    expect(selection()).toEqual(['four']);
  });
});

describe('keyboard, automatic activation', () => {
  it('moves focus and the selection together', () => {
    const { tab, selection } = setup({ defaultValue: 'one' });
    tab('one').focus();

    press(tab('one'), 'ArrowRight');
    expect(focusedValue()).toBe('two');
    expect(selection()).toEqual(['two']);
  });

  it('skips the disabled tab', () => {
    const { tab, selection } = setup({ defaultValue: 'two' });
    tab('two').focus();

    press(tab('two'), 'ArrowRight');
    expect(focusedValue()).toBe('four');
    expect(selection()).toEqual(['four']);
  });

  it('wraps at both ends', () => {
    const { tab, selection } = setup({ defaultValue: 'one' });
    tab('one').focus();

    press(tab('one'), 'ArrowLeft');
    expect(selection()).toEqual(['four']);

    press(tab('four'), 'ArrowRight');
    expect(selection()).toEqual(['one']);
  });

  it('clamps instead when told not to loop', () => {
    const { tab, selection } = setup({ defaultValue: 'one', loop: false });
    tab('one').focus();

    press(tab('one'), 'ArrowLeft');
    expect(selection()).toEqual(['one']);
  });

  it('goes to the ends with Home and End', () => {
    const { tab, selection } = setup({ defaultValue: 'two' });
    tab('two').focus();

    press(tab('two'), 'End');
    expect(selection()).toEqual(['four']);

    press(tab('four'), 'Home');
    expect(selection()).toEqual(['one']);
  });

  it('leaves the other axis to the page', () => {
    const { tab, selection } = setup({ defaultValue: 'one' });
    tab('one').focus();

    const event = press(tab('one'), 'ArrowDown');
    // A horizontal tab list has no use for Down, so the page must still scroll.
    expect(event.defaultPrevented).toBe(false);
    expect(selection()).toEqual(['one']);
  });

  it('stops the browser acting on the keys it consumed', () => {
    const { tab } = setup({ defaultValue: 'one' });
    tab('one').focus();

    // Otherwise the arrow scrolls the page as it moves the tab.
    expect(press(tab('one'), 'ArrowRight').defaultPrevented).toBe(true);
    expect(press(tab('two'), ' ').defaultPrevented).toBe(true);
  });

  it('moves exactly one tab per press, however often the props re-render', () => {
    const { tab, selection } = setup({ defaultValue: 'one' });
    tab('one').focus();

    // Each selection re-runs the spread, which re-applies the same listeners.
    // If they stacked, this would land on 'four' by the second press.
    press(tab('one'), 'ArrowRight');
    expect(selection()).toEqual(['two']);
    press(tab('two'), 'ArrowRight');
    expect(selection()).toEqual(['four']);
  });

  it('ignores a modified arrow', () => {
    const { tab, selection } = setup({ defaultValue: 'one' });
    tab('one').focus();

    // Ctrl+Right is a shortcut somewhere else, not tab navigation.
    const event = press(tab('one'), 'ArrowRight', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(selection()).toEqual(['one']);
  });
});

describe('keyboard, manual activation', () => {
  it('moves focus without selecting', () => {
    const { tab, selection } = setup({ defaultValue: 'one', activation: 'manual' });
    tab('one').focus();

    press(tab('one'), 'ArrowRight');
    expect(focusedValue()).toBe('two');
    expect(selection()).toEqual(['one']);
  });

  it('selects the focused tab on Enter and on Space', () => {
    const { tab, selection } = setup({ defaultValue: 'one', activation: 'manual' });
    tab('one').focus();

    press(tab('one'), 'ArrowRight');
    press(tab('two'), 'Enter');
    expect(selection()).toEqual(['two']);

    press(tab('two'), 'ArrowRight');
    press(tab('four'), ' ');
    expect(selection()).toEqual(['four']);
  });

  it('will not select a disabled tab it cannot even reach', () => {
    const { tab, selection } = setup({ defaultValue: 'two', activation: 'manual' });
    tab('two').focus();

    press(tab('two'), 'ArrowRight');
    expect(focusedValue()).toBe('four');
    expect(selection()).toEqual(['two']);
  });

  it('moves from wherever focus actually is, not from the selection', () => {
    const { tab, selection, tabStops } = setup({ defaultValue: 'one', activation: 'manual' });

    // Focus arriving any other way than an arrow key — a click, or script —
    // still anchors the next arrow press.
    tab('four').focus();
    flushSync();
    expect(tabStops()).toEqual(['-1', '-1', '-1', '0']);

    press(tab('four'), 'ArrowRight');
    expect(focusedValue()).toBe('one');
    expect(selection()).toEqual(['one']);
  });

  it('keeps the tab stop under focus, then hands it back on the way out', () => {
    const { tab, tabStops } = setup({ defaultValue: 'one', activation: 'manual' });
    tab('one').focus();

    press(tab('one'), 'ArrowRight');
    // While the list has focus, Tab must leave from where the user actually is.
    expect(tabStops()).toEqual(['-1', '0', '-1', '-1']);

    const after = document.querySelector('#after') as HTMLElement;
    tab('two').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: after }));
    flushSync();

    // Once focus has gone, Tab must come back to the tab that is showing.
    expect(tabStops()).toEqual(['0', '-1', '-1', '-1']);
  });
});

describe('roving tab order', () => {
  it('keeps exactly one tab reachable with Tab', () => {
    const { tab, tabStops } = setup({ defaultValue: 'two' });
    expect(tabStops()).toEqual(['-1', '0', '-1', '-1']);

    tab('four').click();
    flushSync();
    expect(tabStops()).toEqual(['-1', '-1', '-1', '0']);
  });
});

describe('one tabs widget inside another', () => {
  /**
   * The inner tabs live in a panel of the outer ones — the arrangement that
   * catches an implementation which collects its items from a root element
   * wrapping list and panels both.
   */
  @Component({
    selector: 'v-nested',
    render: compileTemplate(`
      <div>
        <div :ref="outerList" :spread="outer.listProps()">
          <button :spread="outer.tabProps('a')">A</button>
          <button :spread="outer.tabProps('b')">B</button>
        </div>
        <div :spread="outer.panelProps('a')">
          <div :ref="innerList" :spread="inner.listProps()">
            <button :spread="inner.tabProps('x')">X</button>
            <button :spread="inner.tabProps('y')">Y</button>
          </div>
          <div :spread="inner.panelProps('x')">x</div>
          <div :spread="inner.panelProps('y')">y</div>
        </div>
        <div :spread="outer.panelProps('b')">b</div>
      </div>
    `),
  })
  class Nested {
    outerList = new Signal.State<Element | null>(null);
    innerList = new Signal.State<Element | null>(null);
    outer = createTabs({ list: () => this.outerList.get(), defaultValue: 'a' });
    inner = createTabs({ list: () => this.innerList.get(), defaultValue: 'x' });
  }

  function nested() {
    track(mount(Nested, host));
    flushSync();
    const tab = (value: string): HTMLElement =>
      host.querySelector(`[${TAB_VALUE_ATTRIBUTE}="${value}"]`)!;
    const selectedIn = (list: Element) =>
      [...list.querySelectorAll('[role="tab"]')]
        .filter((el) => el.getAttribute('aria-selected') === 'true')
        .map((el) => el.getAttribute(TAB_VALUE_ATTRIBUTE));
    return { tab, selectedIn, lists: () => [...host.querySelectorAll('[role="tablist"]')] };
  }

  it('keeps each list to its own tabs', () => {
    const { tab, selectedIn, lists } = nested();
    const [outerList, innerList] = lists();

    tab('x').focus();
    press(tab('x'), 'ArrowRight');
    expect(selectedIn(innerList!)).toEqual(['y']);
    expect(selectedIn(outerList!)).toEqual(['a']);

    tab('a').focus();
    press(tab('a'), 'End');
    // End reaches the last tab of this list, not the last tab on the page.
    expect(selectedIn(outerList!)).toEqual(['b']);
    expect(selectedIn(innerList!)).toEqual(['y']);
  });
});

describe('orientation', () => {
  it('moves on the vertical arrows and leaves the horizontal ones alone', () => {
    const { tab, list, selection } = setup({ defaultValue: 'one', orientation: 'vertical' });
    expect(list().getAttribute('aria-orientation')).toBe('vertical');

    tab('one').focus();
    press(tab('one'), 'ArrowDown');
    expect(selection()).toEqual(['two']);

    const event = press(tab('two'), 'ArrowRight');
    expect(event.defaultPrevented).toBe(false);
    expect(selection()).toEqual(['two']);
  });

  it('mirrors the horizontal arrows under dir="rtl"', () => {
    const { tab, selection } = setup({ defaultValue: 'one' }, 'dir="rtl"');
    tab('one').focus();

    // In a right-to-left list the next tab is to the left.
    press(tab('one'), 'ArrowLeft');
    expect(selection()).toEqual(['two']);

    press(tab('two'), 'ArrowRight');
    expect(selection()).toEqual(['one']);
  });
});
