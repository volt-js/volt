/**
 * Harnesses, driven against the real primitives they are for.
 *
 * The point of a harness is that it survives a change to the markup, so
 * testing one against a hand-written fixture would prove the opposite of what
 * is claimed: a fixture is markup written to match the harness. These mount
 * `@voltdev/primitives` and drive those, so a harness that reaches for
 * anything but role, name and state fails here rather than in somebody's
 * repository a version later.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import {
  createCollapsible,
  createDialog,
  createListbox,
  createMenu,
  createTabs,
} from '@voltdev/primitives';
import {
  dialogHarness,
  dialogIsOpen,
  disclosureHarness,
  listboxHarness,
  menuHarness,
  tabsHarness,
} from '../src/harness.js';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let selectors = 0;

function place(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  return host;
}

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  document.body.innerHTML = '';
});

/**
 * Mount a fixture whose primitive is handed the elements it needs.
 *
 * `el` is a ref the template fills in; the primitive reads it lazily, which is
 * why it can be passed before anything is rendered.
 */
function mountWith(
  template: string,
  build: (el: Signal.State<Element | null>) => object,
): HTMLElement {
  const root = place();
  @Component({ selector: `v-h-${++selectors}`, render: compileTemplate(template) })
  class Fixture {
    el = new Signal.State<Element | null>(null);
    parts = build(this.el);
  }
  mounted.push(mount(Fixture, root));
  flushSync();
  return root;
}

describe('a disclosure', () => {
  const TEMPLATE = `
    <div>
      <button :spread="parts.triggerProps()" :click="parts.toggle()">Details</button>
      <div :if="parts.isPresent()" :ref="el" :spread="parts.contentProps()">the body</div>
    </div>`;

  const build = (el: Signal.State<Element | null>) => createCollapsible({ content: () => el.get() });

  it('finds the trigger and the region it controls, through aria alone', () => {
    const root = mountWith(TEMPLATE, build);
    const panel = disclosureHarness({ within: root, name: 'Details' });

    expect(panel.isExpanded()).toBe(false);
    expect(panel.panel()).toBe(null);

    panel.expand();
    flushSync();
    expect(panel.isExpanded()).toBe(true);
    expect(panel.panel()?.textContent).toBe('the body');
  });

  it('does nothing when asked for the state it is already in', () => {
    const root = mountWith(TEMPLATE, build);
    const panel = disclosureHarness({ within: root, name: 'Details' });

    panel.expand();
    flushSync();
    panel.expand();
    flushSync();
    expect(panel.isExpanded()).toBe(true);

    panel.collapse();
    flushSync();
    expect(panel.isExpanded()).toBe(false);
  });
});

describe('tabs', () => {
  const TEMPLATE = `
    <div>
      <div :ref="el" :spread="parts.listProps()">
        <button :for="tab in ['One', 'Two']" :key="tab"
                :spread="parts.tabProps(tab)" :click="parts.select(tab)">{ tab }</button>
      </div>
      <div :for="tab in ['One', 'Two']" :key="tab" :spread="parts.panelProps(tab)">
        panel { tab }
      </div>
    </div>`;

  const build = (el: Signal.State<Element | null>) =>
    createTabs({ list: () => el.get(), defaultValue: 'One' });

  it('reads the tabs by their words and follows the selection', () => {
    const root = mountWith(TEMPLATE, build);
    const tabs = tabsHarness({ within: root });

    expect(tabs.tabs()).toEqual(['One', 'Two']);
    expect(tabs.selected()).toBe('One');

    tabs.select('Two');
    flushSync();
    expect(tabs.selected()).toBe('Two');
  });

  it('reaches the panel through `aria-controls`, which is the only route a reader has', () => {
    const root = mountWith(TEMPLATE, build);
    const tabs = tabsHarness({ within: root });
    expect(tabs.panel().textContent?.trim()).toBe('panel One');

    tabs.select('Two');
    flushSync();
    expect(tabs.panel().textContent?.trim()).toBe('panel Two');
  });
});

describe('a listbox', () => {
  const TEMPLATE = `
    <ul :ref="el" :spread="parts.listboxProps()" :click="parts.onOptionClick($event)">
      <li :for="(o, i) in ['Red', 'Green']" :key="o"
          :spread="parts.optionProps({ index: i, value: o })">{ o }</li>
    </ul>`;

  it('reports what is selected by name rather than by index', () => {
    const root = mountWith(TEMPLATE, (el) =>
      createListbox<string>({
        listbox: () => el.get(),
        values: () => ['Red', 'Green'],
        defaultValue: ['Red'],
      }),
    );
    const list = listboxHarness({ within: root });

    expect(list.options()).toEqual(['Red', 'Green']);
    expect(list.selected()).toEqual(['Red']);

    list.select('Green');
    flushSync();
    expect(list.selected()).toEqual(['Green']);
  });
});

describe('a dialog', () => {
  const TEMPLATE = `
    <div>
      <button :spread="parts.triggerProps()" :click="parts.open()">Settings</button>
      <div :if="parts.isPresent()" :ref="el" :spread="parts.contentProps()">
        <h2 :spread="parts.titleProps()">Settings</h2>
        <button :click="parts.close()">Done</button>
      </div>
    </div>`;

  const build = (el: Signal.State<Element | null>) => createDialog({ content: () => el.get() });

  it('is not there until it is opened, which is what a test after a close asserts', () => {
    const root = mountWith(TEMPLATE, build);
    expect(dialogIsOpen({ within: root })).toBe(false);

    root.querySelector('button')!.click();
    flushSync();
    expect(dialogIsOpen({ within: root })).toBe(true);
  });

  it('reads its title from the accessibility tree, which is what a reader hears', () => {
    const root = mountWith(TEMPLATE, build);
    root.querySelector('button')!.click();
    flushSync();

    expect(dialogHarness({ within: root }).title()).toBe('Settings');
  });

  it('presses a button by the words on it', () => {
    const root = mountWith(TEMPLATE, build);
    root.querySelector('button')!.click();
    flushSync();

    dialogHarness({ within: root }).press('Done');
    flushSync();
    expect(dialogIsOpen({ within: root })).toBe(false);
  });
});

describe('a menu', () => {
  const TEMPLATE = `
    <div>
      <button :ref="trigger" :spread="parts.triggerProps()" :click="parts.toggle()">Actions</button>
      <div :if="parts.isPresent()" :ref="el" :spread="parts.contentProps()"
           :keydown="parts.onKeyDown($event)" :click="parts.onItemClick($event)">
        <div :for="item in ['Duplicate', 'Delete']" :key="item"
             :spread="parts.itemProps({ value: item })">{ item }</div>
      </div>
    </div>`;

  it('opens, reads its items by their words, and chooses one', () => {
    const root = place();
    const chosen: string[] = [];
    @Component({ selector: `v-h-${++selectors}`, render: compileTemplate(TEMPLATE) })
    class Fixture {
      el = new Signal.State<Element | null>(null);
      trigger = new Signal.State<Element | null>(null);
      parts = createMenu({
        content: () => this.el.get(),
        trigger: () => this.trigger.get(),
        onSelect: (_item: HTMLElement, value: string | undefined) =>
          chosen.push(value ?? ''),
      });
    }
    mounted.push(mount(Fixture, root));
    flushSync();

    const menu = menuHarness({ within: root, name: 'Actions' });
    expect(menu.isOpen()).toBe(false);

    menu.open();
    flushSync();
    expect(menu.isOpen()).toBe(true);
    expect(menu.items()).toEqual(['Duplicate', 'Delete']);

    menu.choose('Duplicate');
    flushSync();
    expect(chosen).toEqual(['Duplicate']);
  });
});

describe('what a harness refuses to do', () => {
  it('says which part is missing rather than throwing on null', () => {
    place();
    expect(() => disclosureHarness({ name: 'Nothing' })).toThrow(/no disclosure trigger named/);
  });

  it('will not find a part that is hidden from the accessibility tree', () => {
    // A closed overlay keeps its buttons in the DOM. A harness that found them
    // would let a test assert on something no user could reach, which is the
    // failure the query layer refuses by default and the harness inherits.
    const root = place();
    root.innerHTML = `<div role="dialog" aria-label="Gone" aria-hidden="true"></div>`;
    expect(() => tabsHarness({ within: root })).toThrow(/no tablist/);
  });
});
