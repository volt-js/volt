/**
 * `<v-menu>`, `<v-menu-item>` and `<v-menu-separator>`, driven the way a page
 * drives them.
 *
 * The behaviour is `createMenu`'s and is tested where it lives. What is left
 * here is the seam: that the button this renders is the element the primitive
 * anchors, opens and names the sheet from; that `:host` lands on the sheet
 * rather than on the trigger left behind; that an item tag draws every
 * attribute the sheet's rules select on; that a choice made with the keyboard
 * reaches the tag that was chosen, which is the whole reason items register;
 * and that each option handed to the primitive does something, since one that
 * does nothing can be deleted with the suite still green.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { compileComponents } from './render.js';
import { VMenu } from '../src/components/menu.js';
import { VMenuItem } from '../src/components/menu-item.js';
import { VMenuSeparator } from '../src/components/menu-separator.js';

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

const trigger = (host: HTMLElement): HTMLButtonElement => host.querySelector('button')!;
const sheet = (): HTMLElement | null => document.querySelector('.volt-menu-content');
const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.volt-menu-item')];
const item = (value: string): HTMLElement =>
  document.querySelector<HTMLElement>(`.volt-menu-item[data-value="${value}"]`)!;

/** The menu's whole navigation model is real focus, so this is what it asserts. */
const focused = (): Element | null => document.activeElement;

/** A keydown as a real one arrives: from the focused element, bubbling. */
function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

/** A pointer moving across an item, which is the only way it is highlighted. */
function hover(el: Element): void {
  el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
  flushSync();
}

function clickOn(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  flushSync();
}

/** A press that begins and ends somewhere the menu has nothing to do with. */
function pressOutside(): void {
  const elsewhere = document.createElement('p');
  document.body.append(elsewhere);
  elsewhere.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  elsewhere.dispatchEvent(new Event('pointerup', { bubbles: true }));
  flushSync();
}

function escape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  flushSync();
}

/**
 * A menu with the awkward cases in it: an item that carries its own callback,
 * a disabled item the caller can unlock, and a separator between the groups.
 */
@Component({
  selector: 'v-page',
  imports: [VMenu, VMenuItem, VMenuSeparator],
  render: compileTemplate(`
    <v-menu :onSelect="chose" class="mine" variant="ghost" size="sm" data-row="7">
      <template :slot-trigger>Actions</template>
      <v-menu-item value="rename" class="first">Rename</v-menu-item>
      <v-menu-item value="duplicate">Duplicate</v-menu-item>
      <v-menu-separator></v-menu-separator>
      <v-menu-item value="delete" :disabled="locked.get()" :onSelect="remove">Delete</v-menu-item>
    </v-menu>
  `),
})
class Page {
  locked = new Signal.State(true);
  chosen: (string | undefined)[] = [];
  removed = 0;
  chose = (value: string | undefined): void => {
    this.chosen.push(value);
  };
  remove = (): void => {
    this.removed += 1;
  };
}

describe('the trigger', () => {
  it('is a button the sheet draws, holding what the slot was given', () => {
    const { host } = show(Page);
    const button = trigger(host);

    expect(button.className).toBe('volt-button');
    expect(button.dataset['variant']).toBe('ghost');
    expect(button.dataset['size']).toBe('sm');
    expect(button.textContent?.trim()).toBe('Actions');
    // Defaulted rather than left to the platform, whose default submits the
    // form the menu was opened from.
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.hasAttribute('aria-controls')).toBe(false);
    expect(sheet()).toBe(null);
  });

  it('is drawn by props that follow the signals they were bound to', () => {
    @Component({
      selector: 'v-page-look',
      imports: [VMenu, VMenuItem],
      render: compileTemplate(`
        <v-menu :variant="look.get()" :size="scale.get()">
          <template :slot-trigger>Go</template>
          <v-menu-item value="one">One</v-menu-item>
        </v-menu>
      `),
    })
    class Look {
      look = new Signal.State<'primary' | 'danger' | 'ghost' | undefined>('primary');
      scale = new Signal.State<'sm' | 'lg' | undefined>('lg');
    }

    const { instance, host } = show(Look);
    expect(trigger(host).dataset['variant']).toBe('primary');
    expect(trigger(host).dataset['size']).toBe('lg');

    instance.look.set('danger');
    instance.scale.set(undefined);
    flushSync();
    expect(trigger(host).dataset['variant']).toBe('danger');
    // Back to the middle size, which is the one with no attribute at all.
    expect(trigger(host).hasAttribute('data-size')).toBe(false);
  });

  it('opens and closes on a press, with no handler wired by the caller', () => {
    const { host } = show(Page);
    clickOn(trigger(host));

    expect(sheet()).not.toBe(null);
    expect(trigger(host).getAttribute('aria-expanded')).toBe('true');
    // Only while there is something to point at.
    expect(trigger(host).getAttribute('aria-controls')).toBe(sheet()!.id);
    expect(trigger(host).getAttribute('data-state')).toBe('open');

    clickOn(trigger(host));
    expect(sheet()).toBe(null);
    expect(trigger(host).getAttribute('data-state')).toBe('closed');
  });
});

describe('the sheet', () => {
  it('is where what the caller wrote on the tag lands', () => {
    const { host } = show(Page);
    clickOn(trigger(host));

    // It portals, so the caller's class is on the sheet of actions they meant
    // and not on the button that stayed behind.
    expect([...sheet()!.classList].sort()).toEqual(['mine', 'volt-menu-content']);
    expect(sheet()!.getAttribute('data-row')).toBe('7');
    expect(trigger(host).classList.contains('mine')).toBe(false);
    expect(sheet()!.parentElement).toBe(document.body);
  });

  it('carries the state and the role the sheet’s rules select on', () => {
    const { host } = show(Page);
    clickOn(trigger(host));

    expect(sheet()!.getAttribute('data-state')).toBe('open');
    expect(sheet()!.getAttribute('data-placement')).toBe('bottom-start');
    expect(sheet()!.getAttribute('role')).toBe('menu');
    // Focusable, so a menu opened by pointer has somewhere to put focus that
    // is not an item nobody chose.
    expect(sheet()!.getAttribute('tabindex')).toBe('-1');
    expect(focused()).toBe(sheet());
  });

  it('is named by the trigger, and keeps no name of its own', () => {
    const { host } = show(Page);
    clickOn(trigger(host));

    expect(sheet()!.getAttribute('aria-labelledby')).toBe(trigger(host).id);
    expect(sheet()!.hasAttribute('aria-label')).toBe(false);
    // Vertical is ARIA's own default for a menu; saying it again is noise, and
    // an entry carried as `undefined` would have taken the caller's own off.
    expect(sheet()!.hasAttribute('aria-orientation')).toBe(false);
  });
});

describe('the items', () => {
  it('draws one button per tag, in the order they were written', () => {
    const { host } = show(Page);
    clickOn(trigger(host));

    expect(items().map((el) => el.textContent)).toEqual(['Rename', 'Duplicate', 'Delete']);
    expect(items().every((el) => (el as HTMLButtonElement).type === 'button')).toBe(true);
    expect(items().map((el) => el.getAttribute('data-value'))).toEqual([
      'rename',
      'duplicate',
      'delete',
    ]);
    // What the caller wrote on an item's tag is on the thing they can press.
    expect([...items()[0]!.classList].sort()).toEqual(['first', 'volt-menu-item']);
  });

  it('writes every state the sheet draws an item by', () => {
    const { instance, host } = show(Page);
    clickOn(trigger(host));

    for (const el of items()) {
      expect(el.getAttribute('role')).toBe('menuitem');
      // No item is a tab stop: Tab closes the menu rather than walking it.
      expect(el.getAttribute('tabindex')).toBe('-1');
      expect(el.hasAttribute('data-volt-item')).toBe(true);
    }

    const gone = item('delete');
    expect(gone.getAttribute('data-disabled')).toBe('');
    expect(gone.getAttribute('aria-disabled')).toBe('true');
    // The package's rule for a disabled control: it keeps its place in the
    // accessibility tree rather than being taken out of the platform's.
    expect(gone.hasAttribute('disabled')).toBe(false);

    // `disabled` is read by the template, so it is a signal, and binding it
    // keeps it live.
    instance.locked.set(false);
    flushSync();
    expect(item('delete').hasAttribute('data-disabled')).toBe(false);
    expect(item('delete').hasAttribute('aria-disabled')).toBe(false);
  });

  it('marks the item under the keyboard with focus and nothing else', () => {
    const { host } = show(Page);
    press(trigger(host), 'ArrowDown');

    // Roving focus moves real focus, so `:focus-visible` is what the sheet
    // draws the keyboard's item with — there is no attribute to style, and a
    // rule written against one would never match.
    expect(focused()).toBe(item('rename'));
    expect(document.querySelector('[data-highlighted]')).toBe(null);
    expect(sheet()!.querySelector('[aria-activedescendant]')).toBe(null);
  });

  it('carries the state a checkbox item has to announce', () => {
    @Component({
      selector: 'v-page-checked',
      imports: [VMenu, VMenuItem],
      render: compileTemplate(`
        <v-menu :open="open">
          <template :slot-trigger>View</template>
          <v-menu-item value="wrap" role="menuitemcheckbox" :checked="wrap.get()"
                       :closeOnSelect="false">Wrap lines</v-menu-item>
          <v-menu-item value="gutter" role="menuitemcheckbox">Gutter</v-menu-item>
        </v-menu>
      `),
    })
    class Checked {
      open = new Signal.State(true);
      wrap = new Signal.State(true);
    }

    const { instance } = show(Checked);
    expect(item('wrap').getAttribute('role')).toBe('menuitemcheckbox');
    expect(item('wrap').getAttribute('aria-checked')).toBe('true');
    // An omitted state is unchecked, not absent: a checkbox item with no
    // `aria-checked` is announced as an ordinary one.
    expect(item('gutter').getAttribute('aria-checked')).toBe('false');
    // Read back off the element, which is what lets items be drawn by `:for`.
    expect(item('wrap').getAttribute('data-close-on-select')).toBe('false');
    expect(item('gutter').hasAttribute('data-close-on-select')).toBe(false);

    instance.wrap.set(false);
    flushSync();
    expect(item('wrap').getAttribute('aria-checked')).toBe('false');
  });

  it('moves the keyboard’s place to the item a pointer moves over', () => {
    const { instance, host } = show(Page);
    clickOn(trigger(host));
    // Opened by pointer, so nothing is highlighted and the sheet holds focus.
    expect(focused()).toBe(sheet());

    hover(item('duplicate'));
    // The item under the pointer is the item the arrows move on from, which
    // is the whole of what highlighting means here.
    expect(focused()).toBe(item('duplicate'));
    press(sheet()!, 'ArrowUp');
    expect(focused()).toBe(item('rename'));

    // A disabled item is not somewhere the keyboard can be left.
    instance.locked.set(true);
    flushSync();
    hover(item('delete'));
    expect(focused()).toBe(item('rename'));
  });

  it('follows every one of an item’s props, because each one is a signal', () => {
    @Component({
      selector: 'v-page-bound-item',
      imports: [VMenu, VMenuItem],
      render: compileTemplate(`
        <v-menu :open="open" :onSelect="chose">
          <template :slot-trigger>Go</template>
          <v-menu-item :value="value.get()" :role="role.get()" :textValue="text.get()"
                       :closeOnSelect="sticky.get()">One</v-menu-item>
        </v-menu>
      `),
    })
    class BoundItem {
      open = new Signal.State(true);
      value = new Signal.State<string | undefined>('one');
      role = new Signal.State<'menuitem' | 'menuitemcheckbox'>('menuitem');
      text = new Signal.State<string | undefined>('zebra');
      sticky = new Signal.State<boolean | undefined>(true);
      chosen: (string | undefined)[] = [];
      chose = (value: string | undefined): void => {
        this.chosen.push(value);
      };
    }

    const { instance } = show(BoundItem);
    expect(item('one').getAttribute('data-label')).toBe('zebra');
    expect(item('one').getAttribute('data-close-on-select')).toBe('true');

    instance.value.set('first');
    instance.role.set('menuitemcheckbox');
    instance.text.set('aardvark');
    instance.sticky.set(false);
    flushSync();

    expect(item('first').getAttribute('role')).toBe('menuitemcheckbox');
    expect(item('first').getAttribute('data-label')).toBe('aardvark');
    expect(item('first').getAttribute('data-close-on-select')).toBe('false');

    // And the new value is what the choice is reported by.
    clickOn(item('first'));
    expect(instance.chosen).toEqual(['first']);
    expect(sheet()).not.toBe(null);
  });

  it('refuses to be an item of nothing', () => {
    @Component({
      selector: 'v-page-loose',
      imports: [VMenuItem],
      render: compileTemplate(`<div><v-menu-item value="x">X</v-menu-item></div>`),
    })
    class Loose {}

    expect(() => show(Loose)).toThrow(/<v-menu-item> has to be written inside <v-menu>/);
  });
});

describe('the separator', () => {
  it('is part of the sheet, announced, and stepped over by the arrows', () => {
    const { host } = show(Page);
    press(trigger(host), 'ArrowDown');

    const line = document.querySelector('.volt-menu-separator')!;
    expect(line.getAttribute('role')).toBe('separator');
    // Not an item, so nothing has to skip it by name: the collection never
    // collects it, and the arrows step from the item above to the one below.
    expect(line.hasAttribute('data-volt-item')).toBe(false);
    // Horizontal is ARIA's default for a separator, which is right across a
    // vertical menu.
    expect(line.hasAttribute('aria-orientation')).toBe(false);

    press(sheet()!, 'ArrowDown');
    expect(focused()).toBe(item('duplicate'));
    press(sheet()!, 'ArrowDown');
    // Delete is disabled, so the wrap goes past both it and the separator.
    expect(focused()).toBe(item('rename'));
  });

  it('is where what the caller wrote on its own tag lands', () => {
    @Component({
      selector: 'v-page-line',
      imports: [VMenu, VMenuItem, VMenuSeparator],
      render: compileTemplate(`
        <v-menu :open="open">
          <template :slot-trigger>Go</template>
          <v-menu-item value="one">One</v-menu-item>
          <v-menu-separator class="loud" data-group="danger"></v-menu-separator>
          <v-menu-item value="two">Two</v-menu-item>
        </v-menu>
      `),
    })
    class Line {
      open = new Signal.State(true);
    }

    show(Line);
    const line = document.querySelector('.volt-menu-separator')!;
    expect([...line.classList].sort()).toEqual(['loud', 'volt-menu-separator']);
    expect(line.getAttribute('data-group')).toBe('danger');
  });

  it('refuses to be a separator of nothing', () => {
    @Component({
      selector: 'v-page-loose-line',
      imports: [VMenuSeparator],
      render: compileTemplate(`<div><v-menu-separator></v-menu-separator></div>`),
    })
    class LooseLine {}

    expect(() => show(LooseLine)).toThrow(
      /<v-menu-separator> has to be written inside <v-menu>/,
    );
  });
});

describe('the keyboard the primitive provides', () => {
  it('opens at the first item, and at the last on ArrowUp', () => {
    const first = show(Page);
    press(trigger(first.host), 'ArrowDown');
    expect(focused()).toBe(item('rename'));

    first.instance.locked.set(false);
    flushSync();
    press(sheet()!, 'End');
    expect(focused()).toBe(item('delete'));
    press(sheet()!, 'Home');
    expect(focused()).toBe(item('rename'));

    escape();
    press(trigger(first.host), 'ArrowUp');
    // The last item that can be reached — Delete is locked again on a fresh
    // open only if the caller says so, and here it is not.
    expect(focused()).toBe(item('delete'));
  });

  it('chooses the focused item on Enter and gives focus back to the trigger', () => {
    const { instance, host } = show(Page);
    // Where a keyboard user is when they open it, and what focus is restored
    // to afterwards.
    trigger(host).focus();
    press(trigger(host), 'ArrowDown');
    press(sheet()!, 'ArrowDown');
    press(item('duplicate'), 'Enter');

    expect(instance.chosen).toEqual(['duplicate']);
    expect(sheet()).toBe(null);
    // A menu that closes without handing focus back leaves a keyboard user at
    // the top of the page.
    expect(focused()).toBe(trigger(host));
  });

  it('jumps by typeahead, past the item that cannot be reached', () => {
    const { instance, host } = show(Page);
    clickOn(trigger(host));

    // Delete starts with the same letter and is disabled.
    press(sheet()!, 'd');
    expect(focused()).toBe(item('duplicate'));

    instance.locked.set(false);
    flushSync();
    press(sheet()!, 'd');
    expect(focused()).toBe(item('delete'));
  });

  it('closes on Escape, and on Tab so the browser carries on out of the trigger', () => {
    const { host } = show(Page);
    clickOn(trigger(host));
    escape();
    expect(sheet()).toBe(null);

    clickOn(trigger(host));
    const tab = press(sheet()!, 'Tab');
    expect(sheet()).toBe(null);
    // Not prevented: focus is back on the trigger and the browser's own Tab
    // moves on from there, which is where a user who tabbed out expects to be.
    expect(tab.defaultPrevented).toBe(false);
  });

  it('closes on a press outside, and not on one on the trigger', () => {
    const { host } = show(Page);
    clickOn(trigger(host));
    pressOutside();
    expect(sheet()).toBe(null);
  });
});

describe('choosing an item', () => {
  it('reports the value to the menu, and closes', () => {
    const { instance, host } = show(Page);
    clickOn(trigger(host));
    clickOn(item('rename'));

    expect(instance.chosen).toEqual(['rename']);
    expect(sheet()).toBe(null);
  });

  it('reaches the tag that carries its own callback, and only that one', () => {
    const { instance, host } = show(Page);
    instance.locked.set(false);
    flushSync();

    clickOn(trigger(host));
    clickOn(item('delete'));

    expect(instance.removed).toBe(1);
    // One press, one action: an item with a callback of its own is not also
    // reported to the menu's, which would run two things for one choice.
    expect(instance.chosen).toEqual([]);
  });

  it('refuses a press on an item that is disabled', () => {
    const { instance, host } = show(Page);
    clickOn(trigger(host));
    clickOn(item('delete'));

    expect(instance.removed).toBe(0);
    expect(instance.chosen).toEqual([]);
    expect(sheet()).not.toBe(null);
  });

  it('reports items drawn from a loop by the value each was given', () => {
    @Component({
      selector: 'v-page-loop',
      imports: [VMenu, VMenuItem],
      render: compileTemplate(`
        <v-menu :open="open" :onSelect="chose">
          <template :slot-trigger>Sort</template>
          <v-menu-item :for="field in fields" :key="field" :value="field"
                       :textValue="field">↑ { field }</v-menu-item>
        </v-menu>
      `),
    })
    class Loop {
      open = new Signal.State(true);
      fields = ['name', 'date', 'size'];
      chosen: (string | undefined)[] = [];
      chose = (value: string | undefined): void => {
        this.chosen.push(value);
      };
    }

    const { instance } = show(Loop);
    // Typeahead matches what `textValue` says, because nobody types the arrow
    // the visible words start with.
    expect(item('date').getAttribute('data-label')).toBe('date');
    press(sheet()!, 'd');
    expect(focused()).toBe(item('date'));

    clickOn(item('size'));
    expect(instance.chosen).toEqual(['size']);
  });
});

/**
 * The options the primitive is handed once, while the component's fields
 * initialize. Nothing else in this file reaches them, and wiring nothing
 * reaches is wiring that can be deleted with the suite still green — so each
 * one is asserted through what it does rather than through the call.
 */
describe('the options the primitive is built with', () => {
  function open(markup: string): { instance: { open: Signal.State<boolean> }; host: HTMLElement } {
    @Component({
      selector: 'v-page-option',
      imports: [VMenu, VMenuItem],
      render: compileTemplate(markup),
    })
    class Option {
      open = new Signal.State(true);
    }

    return show(Option);
  }

  const three = `
    <template :slot-trigger>Go</template>
    <v-menu-item value="one">One</v-menu-item>
    <v-menu-item value="two">Two</v-menu-item>
    <v-menu-item value="three">Three</v-menu-item>
  `;

  it('starts open where the caller said so, without a signal of theirs', () => {
    @Component({
      selector: 'v-page-default-open',
      imports: [VMenu, VMenuItem],
      render: compileTemplate(`
        <v-menu :defaultOpen="true" :onOpenChange="heard">${three}</v-menu>
      `),
    })
    class Started {
      seen: boolean[] = [];
      heard = (open: boolean): void => {
        this.seen.push(open);
      };
    }

    const { instance, host } = show(Started);
    expect(sheet()).not.toBe(null);
    // Where it starts is nobody's choice, so nothing is reported for it.
    expect(instance.seen).toEqual([]);

    clickOn(trigger(host));
    expect(instance.seen).toEqual([false]);
  });

  it('sits where the placement asked, with the gap written however it came', () => {
    const { host } = open(`
      <v-menu :open="open" placement="top-end" offset="8">${three}</v-menu>
    `);

    expect(sheet()!.getAttribute('data-placement')).toBe('top-end');
    // An attribute is only ever a string: a gap of `8` with no unit is dropped
    // by the CSSOM and never happens.
    expect(sheet()!.style.marginBottom).toBe('8px');
    expect(sheet()!.style.marginTop).toBe('0px');
    expect(host.querySelector('button')!.getAttribute('style')).toContain('anchor-name');
  });

  it('leaves the browser fewer places to move it when flip is off', () => {
    const fallbacks = (): string => sheet()!.getAttribute('style') ?? '';

    open(`<v-menu :open="open" placement="bottom-start">${three}</v-menu>`);
    expect(fallbacks()).toContain('flip-block');
    unmount?.();
    unmount = null;
    document.body.innerHTML = '';

    open(`<v-menu :open="open" placement="bottom-start" :flip="false">${three}</v-menu>`);
    // The other alignment is still tried; the opposite side is not, which is
    // the only way to tell from here — no engine reports the side it took.
    expect(fallbacks()).toContain('flip-inline');
    expect(fallbacks()).not.toContain('flip-block');
  });

  it('turns the axis over to the menu and to the separator across it', () => {
    @Component({
      selector: 'v-page-across',
      imports: [VMenu, VMenuItem, VMenuSeparator],
      render: compileTemplate(`
        <v-menu :open="open" orientation="horizontal">
          <template :slot-trigger>Go</template>
          <v-menu-item value="one">One</v-menu-item>
          <v-menu-separator></v-menu-separator>
          <v-menu-item value="two">Two</v-menu-item>
        </v-menu>
      `),
    })
    class Across {
      open = new Signal.State(true);
    }

    show(Across);
    expect(sheet()!.getAttribute('aria-orientation')).toBe('horizontal');
    // A separator lies across the menu, so it is the one that turns.
    expect(document.querySelector('.volt-menu-separator')!.getAttribute('aria-orientation')).toBe(
      'vertical',
    );

    press(sheet()!, 'ArrowRight');
    expect(focused()).toBe(item('one'));
    press(sheet()!, 'ArrowRight');
    expect(focused()).toBe(item('two'));
    // The arrows the axis did not claim are left to the page.
    expect(press(sheet()!, 'ArrowDown').defaultPrevented).toBe(false);
  });

  it('stops at the ends when the caller turned looping off', () => {
    open(`<v-menu :open="open" :loop="false">${three}</v-menu>`);

    press(sheet()!, 'Home');
    press(sheet()!, 'ArrowUp');
    expect(focused()).toBe(item('one'));

    press(sheet()!, 'End');
    press(sheet()!, 'ArrowDown');
    expect(focused()).toBe(item('three'));
  });

  it('leaves a typed letter alone when typeahead is off', () => {
    open(`<v-menu :open="open" :typeahead="false">${three}</v-menu>`);

    const typed = press(sheet()!, 't');
    expect(focused()).toBe(sheet());
    // Nothing was consumed, so the page keeps whatever else the key means.
    expect(typed.defaultPrevented).toBe(false);
  });

  it('forgets what was typed after the time the caller allowed', async () => {
    open(`<v-menu :open="open" :typeaheadTimeout="5">${three}</v-menu>`);

    press(sheet()!, 't');
    expect(focused()).toBe(item('two'));

    await new Promise((resolve) => setTimeout(resolve, 40));
    // The second letter of "three" on its own, long after the caller's window
    // shut: nothing begins with an `h`, so the search finds nothing and the
    // keyboard stays where it was. Held for the default 500ms instead, the
    // same press would have spelled "th" and walked to Three — which is the
    // only thing that tells the two timeouts apart from out here.
    const typed = press(sheet()!, 'h');
    expect(focused()).toBe(item('two'));
    expect(typed.defaultPrevented).toBe(false);
  });

  it('holds Escape and an outside press when told not to close on them', () => {
    open(`
      <v-menu :open="open" :closeOnEscape="false" :closeOnOutsidePointer="false">${three}</v-menu>
    `);

    escape();
    expect(sheet()).not.toBe(null);
    pressOutside();
    expect(sheet()).not.toBe(null);
  });

  it('stays open on a choice when the caller said it should', () => {
    @Component({
      selector: 'v-page-sticky',
      imports: [VMenu, VMenuItem],
      render: compileTemplate(`
        <v-menu :closeOnSelect="false" :onSelect="chose">
          <template :slot-trigger>Go</template>
          <v-menu-item value="one">One</v-menu-item>
          <v-menu-item value="two" :closeOnSelect="true">Two</v-menu-item>
        </v-menu>
      `),
    })
    class Sticky {
      chosen: (string | undefined)[] = [];
      chose = (value: string | undefined): void => {
        this.chosen.push(value);
      };
    }

    const { instance, host } = show(Sticky);
    clickOn(trigger(host));

    clickOn(item('one'));
    expect(instance.chosen).toEqual(['one']);
    expect(sheet()).not.toBe(null);

    // An item overrides the menu for itself.
    clickOn(item('two'));
    expect(instance.chosen).toEqual(['one', 'two']);
    expect(sheet()).toBe(null);
  });

  it('is the caller’s signal on both sides', () => {
    @Component({
      selector: 'v-page-bound',
      imports: [VMenu, VMenuItem],
      render: compileTemplate(`
        <v-menu :open="shown" :onOpenChange="heard">${three}</v-menu>
      `),
    })
    class Bound {
      shown = new Signal.State(false);
      seen: boolean[] = [];
      heard = (open: boolean): void => {
        this.seen.push(open);
      };
    }

    const { instance, host } = show(Bound);
    expect(sheet()).toBe(null);

    instance.shown.set(true);
    flushSync();
    expect(sheet()).not.toBe(null);

    clickOn(item('one'));
    expect(instance.shown.get()).toBe(false);
    expect(instance.seen).toEqual([false]);

    clickOn(trigger(host));
    expect(instance.seen).toEqual([false, true]);
  });
});

describe('what names the button a reader announces', () => {
  @Component({
    selector: 'v-page-named',
    imports: [VMenu, VMenuItem],
    render: compileTemplate(`
      <h2 id="row-heading">Invoice 7</h2>
      <v-menu :label="name.get()">
        <template :slot-trigger>⋯</template>
        <v-menu-item value="one">One</v-menu-item>
      </v-menu>
    `),
  })
  class Named {
    name = new Signal.State<string | undefined>('Row actions');
  }

  it('puts the name on the trigger, where the role is, and follows it', () => {
    const { instance, host } = show(Named);
    expect(trigger(host).getAttribute('aria-label')).toBe('Row actions');

    // A name is as often translated, or drawn from data, as it is a literal.
    instance.name.set('Actions for invoice 7');
    flushSync();
    expect(trigger(host).getAttribute('aria-label')).toBe('Actions for invoice 7');

    // And through the trigger it names the sheet, which points at it.
    clickOn(trigger(host));
    expect(sheet()!.getAttribute('aria-labelledby')).toBe(trigger(host).id);
    expect(sheet()!.hasAttribute('aria-label')).toBe(false);
  });

  it('keeps the platform’s own spelling off the sheet, which cannot hold it', () => {
    @Component({
      selector: 'v-page-aria',
      imports: [VMenu, VMenuItem],
      render: compileTemplate(`
        <h2 id="row-heading">Invoice 7</h2>
        <v-menu aria-label="More" label="Row actions" class="mine">
          <template :slot-trigger>⋯</template>
          <v-menu-item value="one">One</v-menu-item>
        </v-menu>
        <v-menu aria-labelledby="row-heading">
          <template :slot-trigger>⋯</template>
          <v-menu-item value="two">Two</v-menu-item>
        </v-menu>
      `),
    })
    class Aria {}

    const { host } = show(Aria);
    const [more, byHeading] = [...host.querySelectorAll<HTMLButtonElement>('button')];

    // What the caller wrote in ARIA wins over the prop saying the same thing,
    // and lands on the button rather than on the sheet — where it would have
    // been outranked by `aria-labelledby` and said nothing at all.
    expect(more!.getAttribute('aria-label')).toBe('More');
    expect(byHeading!.getAttribute('aria-labelledby')).toBe('row-heading');

    clickOn(more!);
    expect(sheet()!.hasAttribute('aria-label')).toBe(false);
    // A class still lands on the sheet, which is everything else about `:host`.
    expect(sheet()!.classList.contains('mine')).toBe(true);
  });
});

/**
 * The two halves of the same promise: the sheet is the caller's element, and
 * the component writes onto it without taking anything away.
 */
describe('what the caller writes on the tag, and what the component owns', () => {
  @Component({
    selector: 'v-page-owned',
    imports: [VMenu, VMenuItem, VMenuSeparator],
    render: compileTemplate(`
      <v-menu :open="open" id="mine" role="group" class="wide" aria-orientation="vertical"
              data-row="7">
        <template :slot-trigger>Go</template>
        <v-menu-item value="one" data-label="zebra" data-close-on-select="false">One</v-menu-item>
        <v-menu-separator aria-orientation="horizontal"></v-menu-separator>
        <v-menu-item value="two">Two</v-menu-item>
      </v-menu>
    `),
  })
  class Owned {
    open = new Signal.State(true);
  }

  it('keeps the id and the role that make the trigger’s promises true', () => {
    const { host } = show(Owned);

    // Two attributes on the sheet are the component's rather than the
    // caller's, and both are load bearing: the id `aria-controls` points at,
    // and the role `aria-haspopup` promises.
    expect(sheet()!.id).toMatch(/^menu-content/);
    expect(trigger(host).getAttribute('aria-controls')).toBe(sheet()!.id);
    expect(sheet()!.getAttribute('role')).toBe('menu');
    // Everything else they wrote is theirs, and it is on the sheet rather
    // than on the button left behind.
    expect([...sheet()!.classList].sort()).toEqual(['volt-menu-content', 'wide']);
    expect(sheet()!.getAttribute('data-row')).toBe('7');
    expect(trigger(host).hasAttribute('data-row')).toBe(false);
  });

  it('never takes an attribute off an element for having nothing to say', () => {
    show(Owned);

    // Each of these is an entry a primitive's bag carries as `undefined`, and
    // every one of those bags is spread over an element `:host` writes to —
    // so passing them through would not skip an attribute but remove the
    // caller's own.
    expect(sheet()!.getAttribute('aria-orientation')).toBe('vertical');
    expect(
      document.querySelector('.volt-menu-separator')!.getAttribute('aria-orientation'),
    ).toBe('horizontal');

    // And on an item, where what survives is also what the primitive reads
    // back: the typeahead label, and the item's own answer to closing.
    expect(item('one').getAttribute('data-label')).toBe('zebra');
    press(sheet()!, 'z');
    expect(focused()).toBe(item('one'));

    clickOn(item('one'));
    expect(sheet()).not.toBe(null);
  });

  it('hands the sheet a bag with no name in it, and nothing to take away', () => {
    @Component({
      selector: 'v-page-bag',
      imports: [VMenu, VMenuItem],
      render: compileTemplate(`
        <v-menu :ref="box">
          <template :slot-trigger>Go</template>
          <v-menu-item value="one">One</v-menu-item>
        </v-menu>
      `),
    })
    class Bag {
      box: VMenu | null = null;
    }

    const { instance } = show(Bag);
    // Asked while shut, which is when the primitive's own bag still carries
    // the fallback name it keeps for a menu with no trigger to be named by —
    // the one frame in which passing it through would replace what the caller
    // wrote on the tag, and then take it back again.
    const props = instance.box!.contentProps();
    expect('aria-label' in props).toBe(false);
    expect(Object.entries(props).filter(([, value]) => value === undefined)).toEqual([]);
  });
});

describe('what the component does not offer', () => {
  it('hands the primitive itself to whoever needs more than this does', () => {
    @Component({
      selector: 'v-page-ref',
      imports: [VMenu, VMenuItem],
      render: compileTemplate(`
        <v-menu :ref="box">
          <template :slot-trigger>Go</template>
          <v-menu-item value="one">One</v-menu-item>
          <v-menu-item value="two">Two</v-menu-item>
        </v-menu>
      `),
    })
    class Ref {
      box: VMenu | null = null;
    }

    const { instance } = show(Ref);
    expect(instance.box?.menu.isOpen()).toBe(false);

    instance.box!.menu.open('last');
    flushSync();
    expect(sheet()).not.toBe(null);
    expect(focused()).toBe(item('two'));
    expect(instance.box!.menu.activeItem()).toBe(item('two'));
    expect(instance.box!.menu.state()).toBe('open');

    instance.box!.menu.close();
    flushSync();
    expect(sheet()).toBe(null);
    expect(instance.box!.menu.state()).toBe('closed');
  });
});
