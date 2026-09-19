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
  type MenuItemRole,
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

  it('toggles either way', () => {
    const root = mountWith(TEMPLATE, build);
    const panel = disclosureHarness({ within: root, name: 'Details' });

    panel.toggle();
    expect(panel.isExpanded()).toBe(true);
    panel.toggle();
    expect(panel.isExpanded()).toBe(false);
    expect(panel.panel()).toBeNull();
  });

  it('takes only a button that says whether it is expanded as the trigger', () => {
    // A plain button with the same words beside the real trigger. It is not a
    // disclosure — nothing about it says it opens anything — so it is not a
    // candidate, and the harness finds the one that is rather than refusing
    // to choose between them.
    const root = mountWith(
      `<div>${TEMPLATE}<button>Details</button></div>`,
      build,
    );
    const panel = disclosureHarness({ within: root, name: 'Details' });
    expect(panel.trigger.hasAttribute('aria-expanded')).toBe(true);

    panel.expand();
    expect(panel.panel()?.textContent).toBe('the body');
  });

  it('refuses a plain button, which would report itself collapsed however often it was pressed', () => {
    const root = place();
    root.innerHTML = '<button>Details</button>';
    // The button is there and reachable, so the error says what it lacks
    // rather than sending the reader to look for why it is hidden.
    expect(() => disclosureHarness({ within: root, name: 'Details' })).toThrow(
      /found a button named Details, but it carries no aria-expanded/,
    );

    root.innerHTML = '<button>Details</button><button>Details</button>';
    expect(() => disclosureHarness({ within: root, name: 'Details' })).toThrow(
      /found 2 buttons named Details, but none carries aria-expanded/,
    );

    // With no button at all, it is the part that is missing.
    root.innerHTML = '';
    expect(() => disclosureHarness({ within: root, name: 'Details' })).toThrow(
      /no disclosure trigger named Details is present/,
    );
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
        items: () => ['Red', 'Green'],
        defaultValue: ['Red'],
      }),
    );
    const list = listboxHarness({ within: root });

    expect(list.options()).toEqual(['Red', 'Green']);
    expect(list.selected()).toEqual(['Red']);

    list.select('Green');
    flushSync();
    expect(list.selected()).toEqual(['Green']);
    expect(list.isMultiple()).toBe(false);
  });

  it('says it is multi-select when the primitive is', () => {
    const root = mountWith(TEMPLATE, (el) =>
      createListbox<string>({
        listbox: () => el.get(),
        items: () => ['Red', 'Green'],
        selectionMode: 'multiple',
        defaultValue: ['Red'],
      }),
    );
    const list = listboxHarness({ within: root });

    expect(list.isMultiple()).toBe(true);
    list.select('Green');
    expect(list.selected()).toEqual(['Red', 'Green']);
  });

  it('reads a native select by its own state, the way the queries do', () => {
    // A `<select multiple>` is a listbox to a screen reader, and says nothing
    // about which options are chosen in its markup: the selection is a
    // property. Reading only the ARIA attributes would report it empty and
    // single-select whatever the user had picked.
    const root = place();
    root.innerHTML =
      '<select multiple aria-label="Colours">' +
      '<option>Red</option><option selected>Green</option><option>Blue</option>' +
      '</select><select size="3" aria-label="Size"><option>S</option><option>M</option></select>';
    const colours = listboxHarness({ within: root, name: 'Colours' });

    expect(colours.options()).toEqual(['Red', 'Green', 'Blue']);
    expect(colours.selected()).toEqual(['Green']);
    expect(colours.isMultiple()).toBe(true);

    root.querySelector('option')!.selected = true;
    expect(colours.selected()).toEqual(['Red', 'Green']);

    // And chosen from the way a user chooses from one: pressing an option.
    colours.select('Blue');
    expect(colours.selected()).toEqual(['Blue']);

    expect(listboxHarness({ within: root, name: 'Size' }).isMultiple()).toBe(false);
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

  it('dismisses with Escape, which the primitive answers', () => {
    const root = mountWith(TEMPLATE, build);
    root.querySelector('button')!.click();
    flushSync();

    dialogHarness({ within: root }).dismiss();
    expect(dialogIsOpen({ within: root })).toBe(false);
  });

  it('will not pick between a dialog and an alert dialog that are both open', () => {
    const root = mountWith(
      `<div>
        ${TEMPLATE}
        <div role="alertdialog" aria-label="Discard changes?"><button>Discard</button></div>
      </div>`,
      (el) => createDialog({ content: () => el.get(), modal: false }),
    );
    root.querySelector('button')!.click();
    flushSync();

    // Two dialogs are in the tree. Handing back whichever role was asked
    // about first would let a test press "Done" in the form behind the alert
    // it meant to answer, so this refuses the way a query with two matches
    // does — and a name settles it.
    expect(() => dialogHarness({ within: root })).toThrow(/found 2 dialogs/);
    expect(dialogHarness({ within: root, name: 'Discard changes?' }).title()).toBe(
      'Discard changes?',
    );

    // Whether any dialog is open is a question with an answer here, not an
    // ambiguity.
    expect(dialogIsOpen({ within: root })).toBe(true);
  });

  it('answers that a dialog is open when two are, rather than refusing to answer', () => {
    const root = place();
    @Component({
      selector: `v-h-${++selectors}`,
      render: compileTemplate(`
        <div>
          <div :if="form.isPresent()" :ref="formEl" :spread="form.contentProps()">
            <h2 :spread="form.titleProps()">Edit profile</h2>
          </div>
          <div :if="confirm.isPresent()" :ref="confirmEl" :spread="confirm.contentProps()">
            <h2 :spread="confirm.titleProps()">Leave without saving?</h2>
          </div>
        </div>`),
    })
    class Fixture {
      formEl = new Signal.State<Element | null>(null);
      confirmEl = new Signal.State<Element | null>(null);
      form = createDialog({ content: () => this.formEl.get(), modal: false, defaultOpen: true });
      confirm = createDialog({
        content: () => this.confirmEl.get(),
        modal: false,
        defaultOpen: true,
      });
    }
    mounted.push(mount(Fixture, root));
    flushSync();

    expect(dialogIsOpen({ within: root })).toBe(true);
    expect(() => dialogHarness({ within: root })).toThrow(/found 2 dialogs/);
    expect(dialogHarness({ within: root, name: 'Leave without saving?' }).title()).toBe(
      'Leave without saving?',
    );
  });
});

describe('a menu', () => {
  const TEMPLATE = `
    <div>
      <button :ref="trigger" :spread="parts.triggerProps()" :click="parts.toggle()">Actions</button>
      <div :if="parts.isPresent()" :ref="el" :spread="parts.contentProps()"
           :keydown="parts.onContentKeyDown($event)" :click="parts.onItemClick($event)">
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

  /**
   * Menus built from the primitive, each an `Actions`-style trigger and the
   * items given, all mounted on one page. What each chose is recorded as
   * `trigger:value`, so a press that landed in the wrong menu shows.
   */
  function menus(
    spec: Record<string, readonly { label: string; value?: string; role?: MenuItemRole }[]>,
  ): { root: HTMLElement; chosen: string[] } {
    const root = place();
    const chosen: string[] = [];
    const names = Object.keys(spec);
    // `:ref` takes a plain property name, so each menu gets properties of its
    // own — `trigger0`, `content0`, `menu0` — rather than a slot in an array.
    const template = `<div>${names
      .map(
        (name, i) => `
          <button :ref="trigger${i}" :spread="menu${i}.triggerProps()"
                  :click="menu${i}.toggle()"
                  :keydown="menu${i}.onTriggerKeyDown($event)">${name}</button>
          <div :if="menu${i}.isPresent()" :ref="content${i}"
               :spread="menu${i}.contentProps()"
               :keydown="menu${i}.onContentKeyDown($event)" :click="menu${i}.onItemClick($event)">
            <div :for="item in items${i}" :key="item.value ?? item.label"
                 :spread="menu${i}.itemProps({ value: item.value ?? item.label, role: item.role })"
            >{ item.label }</div>
          </div>`,
      )
      .join('')}</div>`;

    @Component({ selector: `v-h-${++selectors}`, render: compileTemplate(template) })
    class Fixture {
      constructor() {
        const self = this as unknown as Record<string, unknown>;
        names.forEach((name, i) => {
          const trigger = new Signal.State<Element | null>(null);
          const content = new Signal.State<Element | null>(null);
          self[`trigger${i}`] = trigger;
          self[`content${i}`] = content;
          self[`items${i}`] = spec[name];
          self[`menu${i}`] = createMenu({
            content: () => content.get(),
            trigger: () => trigger.get(),
            onSelect: (_item: HTMLElement, value: string | undefined) =>
              chosen.push(`${name}:${value ?? ''}`),
          });
        });
      }
    }
    mounted.push(mount(Fixture, root));
    flushSync();
    return { root, chosen };
  }

  it('reads nothing from another menu while its own is closed', () => {
    const { chosen } = menus({
      Alpha: [{ label: 'A one' }],
      Beta: [{ label: 'B one' }],
    });

    menuHarness({ name: 'Beta' }).open();
    const alpha = menuHarness({ name: 'Alpha' });

    // Alpha's trigger controls nothing while it is closed — the primitive
    // sets `aria-controls` only while open — and a harness that fell back to
    // "the menu on the page" would read Beta's items as Alpha's, and press
    // one of them.
    expect(alpha.isOpen()).toBe(false);
    expect(alpha.items()).toEqual([]);
    expect(() => alpha.choose('B one')).toThrow(/no open menu/);
    expect(chosen).toEqual([]);
  });

  it('reads the items in the order a user meets them, whatever their roles', () => {
    menus({
      Format: [
        { label: 'Cut' },
        { label: 'Bold', role: 'menuitemcheckbox' },
        { label: 'Paste' },
        { label: 'Left', role: 'menuitemradio' },
      ],
    });
    const menu = menuHarness({ name: 'Format' });
    menu.open();

    expect(menu.items()).toEqual(['Cut', 'Bold', 'Paste', 'Left']);
  });

  it('chooses by the same rule a query names by', () => {
    const { chosen } = menus({ Actions: [{ label: 'Duplicate' }, { label: 'Delete' }] });
    const menu = menuHarness({ name: 'Actions' });
    menu.open();

    // Whitespace collapsed and trimmed, as `name` is everywhere else, so the
    // same words find the same item whichever way they are asked.
    menu.choose('  Duplicate ');
    expect(chosen).toEqual(['Actions:Duplicate']);
  });

  it('will not choose between two items with the same words', () => {
    const { chosen } = menus({
      Actions: [
        { label: 'Delete', value: 'file' },
        { label: 'Delete', value: 'folder' },
      ],
    });
    const menu = menuHarness({ name: 'Actions' });
    menu.open();

    // Pressing whichever came first would pass a test that meant the other,
    // and every other harness action throws on several for that reason.
    expect(() => menu.choose('Delete')).toThrow(/found 2 menu items/);
    expect(chosen).toEqual([]);
  });

  it('closes with Escape on the menu', () => {
    menus({ Actions: [{ label: 'Duplicate' }] });
    const menu = menuHarness({ name: 'Actions' });
    menu.open();
    expect(menu.isOpen()).toBe(true);

    menu.close();
    expect(menu.isOpen()).toBe(false);
    expect(menu.items()).toEqual([]);
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
