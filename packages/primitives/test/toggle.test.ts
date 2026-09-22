/**
 * Toggle and toggle group, driven through real mounted components.
 *
 * The behaviour worth asserting is the part a consumer cannot see: what a
 * screen reader is told, which single item Tab lands on, and that one press
 * changes the state exactly once. The last of those is where headless toggles
 * usually break — a keyboard activation that also becomes a click, or a prop
 * object handing out a new handler on every update.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import {
  createToggle,
  createToggleGroup,
  type ToggleGroupItemOptions,
  type ToggleGroupMultipleOptions,
  type ToggleGroupSingleOptions,
  type ToggleOptions,
} from '../src/toggle.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Item extends ToggleGroupItemOptions {
  value: string;
  text: string;
}

const ITEMS: Item[] = [
  { value: 'bold', text: 'Bold' },
  { value: 'italic', text: 'Italic' },
  { value: 'underline', text: 'Underline' },
];

const WITH_DISABLED: Item[] = [
  { value: 'bold', text: 'Bold' },
  { value: 'italic', text: 'Italic', disabled: true },
  { value: 'underline', text: 'Underline' },
];

const toggleTemplate = (tag: string) =>
  compileTemplate(`<${tag} :spread="toggle.props()">B</${tag}>`);

const groupTemplate = (tag: string) =>
  compileTemplate(
    `<div :ref="group" :spread="toggles.groupProps()">` +
      `<${tag} :for="item in items.get()" :key="item.value"` +
      ` :spread="toggles.itemProps(item.value, item)">{ item.text }</${tag}>` +
      `</div>`,
  );

function setupToggle(options: ToggleOptions = {}, tag = 'button') {
  @Component({ selector: 'v-toggle', render: toggleTemplate(tag) })
  class Host {
    toggle = createToggle(options);
  }

  const handle = track(mount(Host, host));
  flushSync();
  return handle.instance as Host;
}

function setupSingle(
  options: Omit<ToggleGroupSingleOptions, 'group'> = {},
  list: Item[] = ITEMS,
  tag = 'button',
) {
  @Component({ selector: 'v-single-group', render: groupTemplate(tag) })
  class Host {
    group = new Signal.State<Element | null>(null);
    items = new Signal.State<Item[]>(list);
    toggles = createToggleGroup({ ...options, group: () => this.group.get() });
  }

  const handle = track(mount(Host, host));
  flushSync();
  return handle.instance as Host;
}

/**
 * Single and multiple selection get a mount each because their options are
 * different types — one carries `string | null`, the other `string[]` — and a
 * union of the two matches neither overload.
 */
function setupMultiple(
  options: Omit<ToggleGroupMultipleOptions, 'group'>,
  list: Item[] = ITEMS,
  tag = 'button',
) {
  @Component({ selector: 'v-multiple-group', render: groupTemplate(tag) })
  class Host {
    group = new Signal.State<Element | null>(null);
    items = new Signal.State<Item[]>(list);
    toggles = createToggleGroup({ ...options, group: () => this.group.get() });
  }

  const handle = track(mount(Host, host));
  flushSync();
  return handle.instance as Host;
}

/** The standalone toggle: its template has nothing else in it. */
const el = () => host.firstElementChild!;
const group = () => host.querySelector('[role="group"], [role="radiogroup"]')!;
const items = () => [...group().querySelectorAll<HTMLElement>('[data-volt-item]')];
const item = (value: string) => {
  const found = items().find((node) => node.getAttribute('data-value') === value);
  if (!found) throw new Error(`no item for "${value}"`);
  return found;
};

const tabStops = () => items().map((node) => node.getAttribute('tabindex'));
const states = () => items().map((node) => node.getAttribute('data-state'));
const focused = () => document.activeElement?.getAttribute('data-value') ?? null;

function click(target: Element) {
  (target as HTMLElement).click();
  flushSync();
}

/**
 * Let the group hear about items coming or going: nothing in the framework
 * announces that, so the group watches the DOM and is told on a microtask.
 */
async function settle() {
  flushSync();
  await Promise.resolve();
  flushSync();
}

/** A keydown on whatever holds focus, as a real key press would arrive. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

describe('toggle state', () => {
  it('starts released and says so', () => {
    setupToggle();
    expect(el().getAttribute('aria-pressed')).toBe('false');
    expect(el().getAttribute('data-state')).toBe('off');
    expect(el().getAttribute('role')).toBe('button');
  });

  it('starts pressed when told to', () => {
    setupToggle({ defaultPressed: true });
    expect(el().getAttribute('aria-pressed')).toBe('true');
  });

  it('does not submit the form it sits in', () => {
    setupToggle();
    // A `<button>` with no type is a submit button.
    expect((el() as HTMLButtonElement).type).toBe('button');
  });

  it('flips on each click, and only once per click', () => {
    const instance = setupToggle();

    click(el());
    expect(el().getAttribute('aria-pressed')).toBe('true');
    click(el());
    expect(el().getAttribute('aria-pressed')).toBe('false');
    // A third press proves the handler is one listener rather than one per
    // update: a fresh handler identity per render would stack up and flip the
    // state twice, leaving it looking stuck.
    click(el());
    expect(el().getAttribute('aria-pressed')).toBe('true');
    expect(instance.toggle.isPressed()).toBe(true);
  });

  it('reads and writes a signal supplied from outside', () => {
    const pressed = new Signal.State(false);
    setupToggle({ pressed });

    pressed.set(true);
    flushSync();
    expect(el().getAttribute('data-state')).toBe('on');

    click(el());
    expect(pressed.get()).toBe(false);
  });

  it('reports changes through onPressedChange, and only real ones', () => {
    const onPressedChange = vi.fn();
    const instance = setupToggle({ onPressedChange });

    click(el());
    expect(onPressedChange).toHaveBeenCalledWith(true);

    instance.toggle.press();
    flushSync();
    // Already pressed: nothing changed, so nothing is reported.
    expect(onPressedChange).toHaveBeenCalledTimes(1);

    instance.toggle.release();
    flushSync();
    expect(onPressedChange).toHaveBeenLastCalledWith(false);
  });
});

describe('toggle keyboard', () => {
  it('leaves Enter and Space to a real button, which turns them into a click', () => {
    setupToggle();
    el().focus();

    const enter = press('Enter');
    // The browser's own activation follows the keydown, and cancelling the key
    // would cancel that too. Answering the key here as well would flip the
    // state twice and land it back where it started.
    expect(enter.defaultPrevented).toBe(false);
    click(el());
    expect(el().getAttribute('aria-pressed')).toBe('true');
  });

  it('activates a non-button element on Space and Enter', () => {
    setupToggle({}, 'div');
    el().focus();

    const space = press(' ');
    expect(el().getAttribute('aria-pressed')).toBe('true');
    // Space scrolls the page otherwise.
    expect(space.defaultPrevented).toBe(true);

    press('Enter');
    expect(el().getAttribute('aria-pressed')).toBe('false');
  });

  it('makes a non-button element reachable by Tab', () => {
    setupToggle({}, 'div');
    expect(el().getAttribute('tabindex')).toBe('0');
  });

  it('ignores a modified key, which is a shortcut and not an activation', () => {
    setupToggle({}, 'div');
    el().focus();

    press(' ', { ctrlKey: true });
    expect(el().getAttribute('aria-pressed')).toBe('false');
  });
});

describe('toggle disabled', () => {
  it('says it is disabled and stays in the tab order, as a disabled checkbox does', () => {
    const disabled = new Signal.State(true);
    setupToggle({ disabled: () => disabled.get() });

    // The `disabled` attribute would take the button out of the tab order, and
    // a control a keyboard user cannot reach is one they cannot find out about.
    expect((el() as HTMLButtonElement).disabled).toBe(false);
    expect(el().getAttribute('aria-disabled')).toBe('true');
    expect(el().hasAttribute('data-disabled')).toBe(true);
    expect(el().getAttribute('tabindex')).toBe('0');

    el().focus();
    expect(document.activeElement).toBe(el());

    disabled.set(false);
    flushSync();
    expect(el().hasAttribute('aria-disabled')).toBe(false);
    expect(el().hasAttribute('data-disabled')).toBe(false);
    expect(el().getAttribute('tabindex')).toBe('0');
  });

  it('keeps a non-button element reachable while disabled', () => {
    setupToggle({ disabled: () => true }, 'div');
    expect(el().getAttribute('tabindex')).toBe('0');
  });

  it('ignores clicks and keys while disabled', () => {
    setupToggle({ disabled: () => true }, 'div');

    click(el());
    el().focus();
    const space = press(' ');
    press('Enter');
    expect(el().getAttribute('aria-pressed')).toBe('false');
    // Focus is on it, so Space would scroll the page from under it otherwise.
    expect(space.defaultPrevented).toBe(true);
  });

  it('refuses a press on a real button, which nothing but the handler stops now', () => {
    const changes = vi.fn();
    setupToggle({ disabled: () => true, onPressedChange: changes });

    click(el());
    expect(el().getAttribute('aria-pressed')).toBe('false');

    el().focus();
    // The browser turns Enter on a button into a click, and that click is the
    // one the handler has to refuse.
    const enter = press('Enter');
    expect(enter.defaultPrevented).toBe(false);
    click(el());
    expect(el().getAttribute('aria-pressed')).toBe('false');
    expect(changes).not.toHaveBeenCalled();
  });

  it('still answers the application that disabled it', () => {
    const instance = setupToggle({ disabled: () => true });

    // Disabled stops the user, not the code holding the toggle — a form that
    // resets while saving still has to put the control back.
    instance.toggle.press();
    flushSync();
    expect(el().getAttribute('aria-pressed')).toBe('true');
  });
});

describe('toggle naming', () => {
  it('takes a name for an icon-only toggle', () => {
    setupToggle({ label: 'Bold' });
    expect(el().getAttribute('aria-label')).toBe('Bold');
  });

  it('lets the name change with the state', () => {
    setupToggle({ label: (pressed) => (pressed ? 'Unmute' : 'Mute') });
    expect(el().getAttribute('aria-label')).toBe('Mute');

    click(el());
    expect(el().getAttribute('aria-label')).toBe('Unmute');
  });

  it('emits no name at all when none was given', () => {
    setupToggle();
    // An empty aria-label is worse than none: it overrides the content that
    // would otherwise have named the button.
    expect(el().hasAttribute('aria-label')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Toggle group
// ---------------------------------------------------------------------------

describe('group roles', () => {
  it('is a group of toggle buttons by default', () => {
    setupSingle({ label: 'Formatting' });

    expect(group().getAttribute('role')).toBe('group');
    expect(group().getAttribute('aria-label')).toBe('Formatting');
    expect(group().getAttribute('data-orientation')).toBe('horizontal');
    // `group` has no `aria-orientation`; only the radiogroup below does.
    expect(group().hasAttribute('aria-orientation')).toBe(false);

    expect(item('bold').getAttribute('role')).toBe('button');
    expect(item('bold').getAttribute('aria-pressed')).toBe('false');
    expect(item('bold').hasAttribute('aria-checked')).toBe(false);
  });

  it('becomes a radio group when exactly one item must stay chosen', () => {
    setupSingle({ deselectable: false, orientation: 'vertical' });

    expect(group().getAttribute('role')).toBe('radiogroup');
    expect(group().getAttribute('aria-orientation')).toBe('vertical');

    // A radio is checked, never pressed: the two states are announced
    // differently and no role takes both.
    expect(item('bold').getAttribute('role')).toBe('radio');
    expect(item('bold').getAttribute('aria-checked')).toBe('false');
    expect(item('bold').hasAttribute('aria-pressed')).toBe(false);
  });

  it('points at an existing label when given one', () => {
    setupSingle({ labelledBy: 'heading' });
    expect(group().getAttribute('aria-labelledby')).toBe('heading');
    expect(group().hasAttribute('aria-label')).toBe(false);
  });

  it('names an icon-only item', () => {
    setupSingle({}, [{ value: 'bold', text: 'B', label: 'Bold' }]);
    expect(item('bold').getAttribute('aria-label')).toBe('Bold');
  });
});

describe('single selection', () => {
  it('moves the selection from one item to another', () => {
    const instance = setupSingle();

    click(item('bold'));
    expect(states()).toEqual(['on', 'off', 'off']);
    expect(instance.toggles.value()).toBe('bold');

    click(item('underline'));
    expect(states()).toEqual(['off', 'off', 'on']);
    expect(instance.toggles.value()).toBe('underline');
  });

  it('clears the selection when the chosen item is pressed again', () => {
    const instance = setupSingle();

    click(item('bold'));
    click(item('bold'));
    expect(instance.toggles.value()).toBeNull();
    expect(states()).toEqual(['off', 'off', 'off']);
  });

  it('refuses to clear the last one when one must stay chosen', () => {
    const instance = setupSingle({ deselectable: false, defaultValue: 'bold' });

    click(item('bold'));
    expect(instance.toggles.value()).toBe('bold');
    expect(item('bold').getAttribute('aria-checked')).toBe('true');
  });

  it('reports the value, and reports null when it is cleared', () => {
    const onValueChange = vi.fn();
    setupSingle({ onValueChange });

    click(item('italic'));
    expect(onValueChange).toHaveBeenCalledWith('italic');

    click(item('italic'));
    expect(onValueChange).toHaveBeenLastCalledWith(null);
  });

  it('follows a signal supplied from outside', () => {
    const value = new Signal.State<string | null>('bold');
    const instance = setupSingle({ value });

    expect(item('bold').getAttribute('aria-pressed')).toBe('true');

    value.set('italic');
    flushSync();
    expect(states()).toEqual(['off', 'on', 'off']);

    click(item('underline'));
    expect(value.get()).toBe('underline');
    expect(instance.toggles.value()).toBe('underline');
  });
});

describe('multiple selection', () => {
  it('holds several values at once, in the order they were chosen', () => {
    const instance = setupMultiple({ type: 'multiple' });

    click(item('underline'));
    click(item('bold'));
    expect(instance.toggles.value()).toEqual(['underline', 'bold']);
    expect(states()).toEqual(['on', 'off', 'on']);

    click(item('underline'));
    expect(instance.toggles.value()).toEqual(['bold']);
  });

  it('refuses to empty itself when one must stay chosen', () => {
    const instance = setupMultiple({
      type: 'multiple',
      deselectable: false,
      defaultValue: ['bold'],
    });

    click(item('italic'));
    click(item('bold'));
    expect(instance.toggles.value()).toEqual(['italic']);

    // The last one has nowhere to hand over to.
    click(item('italic'));
    expect(instance.toggles.value()).toEqual(['italic']);
  });

  it('stays a group of toggle buttons, never a radio group', () => {
    setupMultiple({ type: 'multiple', deselectable: false });
    // Several answers at once is not what a radio group means, whatever the
    // deselection rule says.
    expect(group().getAttribute('role')).toBe('group');
    expect(item('bold').getAttribute('aria-pressed')).toBe('false');
  });

  it('reports the whole value each time it changes', () => {
    const onValueChange = vi.fn();
    setupMultiple({ type: 'multiple', onValueChange });

    click(item('bold'));
    expect(onValueChange).toHaveBeenLastCalledWith(['bold']);

    click(item('italic'));
    expect(onValueChange).toHaveBeenLastCalledWith(['bold', 'italic']);
  });
});

describe('one tab stop', () => {
  it('starts on the first item, so Tab can enter the group at all', () => {
    setupSingle();
    expect(tabStops()).toEqual(['0', '-1', '-1']);
  });

  it('sits on the chosen item rather than the first', () => {
    setupSingle({ defaultValue: 'underline' });
    // Tab should arrive at what is in effect, not at the start of the row.
    expect(tabStops()).toEqual(['-1', '-1', '0']);
  });

  it('follows the arrow keys', () => {
    setupSingle();
    item('bold').focus();

    press('ArrowRight');
    expect(focused()).toBe('italic');
    expect(tabStops()).toEqual(['-1', '0', '-1']);
  });

  it('follows a click, so Tab returns to the item last used', () => {
    setupSingle();
    click(item('underline'));
    expect(tabStops()).toEqual(['-1', '-1', '0']);
  });

  it('survives the active item being removed', async () => {
    const instance = setupSingle();
    item('underline').focus();
    flushSync();
    expect(tabStops()).toEqual(['-1', '-1', '0']);

    instance.items.set(ITEMS.slice(0, 2));
    await settle();

    // The tab stop was on the item that has gone. Left there, every remaining
    // item stays at -1 and the group cannot be reached from the keyboard at
    // all.
    expect(tabStops()).toEqual(['0', '-1']);
  });

  it('takes items that only arrive later', async () => {
    const instance = setupSingle({}, []);
    expect(items()).toHaveLength(0);

    instance.items.set(ITEMS);
    await settle();

    // A list that loads after the group is rendered is the ordinary case, not
    // an edge one.
    expect(tabStops()).toEqual(['0', '-1', '-1']);
  });
});

describe('group keyboard', () => {
  it('moves with the horizontal arrows and wraps at both ends', () => {
    setupSingle();
    item('bold').focus();

    press('ArrowRight');
    expect(focused()).toBe('italic');
    press('ArrowLeft');
    expect(focused()).toBe('bold');
    press('ArrowLeft');
    expect(focused()).toBe('underline');
  });

  it('moves from wherever focus actually is, not from the start', () => {
    setupSingle();
    // Tab enters the group without any key having moved anything, so the first
    // arrow press has to pick the focused item up from the DOM — otherwise it
    // "moves" to the item already focused and looks broken.
    item('italic').focus();
    flushSync();

    press('ArrowRight');
    expect(focused()).toBe('underline');
  });

  it('clamps instead of wrapping when told to', () => {
    setupSingle({ loop: false });
    item('underline').focus();

    press('ArrowRight');
    expect(focused()).toBe('underline');
  });

  it('goes to the ends with Home and End', () => {
    setupSingle();
    item('italic').focus();

    press('End');
    expect(focused()).toBe('underline');
    press('Home');
    expect(focused()).toBe('bold');
  });

  it('leaves the axis it does not own alone', () => {
    setupSingle();
    item('bold').focus();

    const down = press('ArrowDown');
    expect(focused()).toBe('bold');
    // Unhandled, so the page still scrolls.
    expect(down.defaultPrevented).toBe(false);
  });

  it('answers the vertical arrows when laid out vertically', () => {
    setupSingle({ orientation: 'vertical' });
    item('bold').focus();

    press('ArrowDown');
    expect(focused()).toBe('italic');
    press('ArrowUp');
    expect(focused()).toBe('bold');
    expect(press('ArrowRight').defaultPrevented).toBe(false);
  });

  it('swaps the horizontal arrows under dir="rtl"', () => {
    setupSingle();
    group().setAttribute('dir', 'rtl');
    item('bold').focus();

    // In a right-to-left group, "next" is to the left.
    press('ArrowLeft');
    expect(focused()).toBe('italic');
    press('ArrowRight');
    expect(focused()).toBe('bold');
  });

  it('answers both arrow pairs in a radio group, whatever its layout', () => {
    setupSingle({ deselectable: false });
    item('bold').focus();

    // A radio group is one control with one value, so it is not laid out
    // across an axis it refuses to answer.
    press('ArrowDown');
    expect(focused()).toBe('italic');
    press('ArrowUp');
    expect(focused()).toBe('bold');
  });

  it('skips disabled items', () => {
    setupSingle({}, WITH_DISABLED);
    item('bold').focus();

    press('ArrowRight');
    expect(focused()).toBe('underline');
  });

  it('jumps to an item by name when typeahead is asked for', () => {
    setupSingle({ typeahead: true });
    item('bold').focus();

    press('u');
    expect(focused()).toBe('underline');
  });

  it('ignores letters otherwise', () => {
    setupSingle();
    item('bold').focus();

    // A group of icons has nothing to match, and swallowing the key is worse
    // than looking for something that was never there.
    expect(press('u').defaultPrevented).toBe(false);
    expect(focused()).toBe('bold');
  });
});

describe('group activation', () => {
  it('leaves Enter and Space to real buttons, which turn them into clicks', () => {
    const instance = setupSingle();
    item('bold').focus();
    flushSync();

    const space = press(' ');
    // The browser's own activation follows, and a cancelled key would cancel
    // it. Answering the key here as well would select and then deselect in one
    // press, leaving nothing to show for it.
    expect(space.defaultPrevented).toBe(false);
    click(item('bold'));
    expect(instance.toggles.value()).toBe('bold');
  });

  it('activates non-button items from the keyboard', () => {
    const instance = setupSingle({}, ITEMS, 'div');
    item('bold').focus();
    flushSync();

    const space = press(' ');
    expect(instance.toggles.value()).toBe('bold');
    expect(space.defaultPrevented).toBe(true);

    press('Enter');
    expect(instance.toggles.value()).toBeNull();
  });

  it('checks whatever the arrows land on in a radio group', () => {
    const instance = setupSingle({ deselectable: false, defaultValue: 'bold' });
    item('bold').focus();
    flushSync();

    press('ArrowRight');
    // The radio pattern moves the answer with focus; leaving them apart makes
    // the arrows do nothing a user can see.
    expect(instance.toggles.value()).toBe('italic');
    expect(item('italic').getAttribute('aria-checked')).toBe('true');
    expect(item('bold').getAttribute('aria-checked')).toBe('false');
  });

  it('does not select as focus moves in a group of toggle buttons', () => {
    const instance = setupSingle();
    item('bold').focus();
    flushSync();

    press('ArrowRight');
    // A toolbar whose buttons applied themselves as you arrowed past would be
    // unusable.
    expect(instance.toggles.value()).toBeNull();
  });

  it('moves focus on request without answering for the user', () => {
    const instance = setupSingle({ deselectable: false, defaultValue: 'bold' });

    instance.toggles.focus('underline');
    flushSync();

    // Selection follows the arrow keys, not an application moving focus about:
    // arriving somewhere is not the same as choosing it.
    expect(focused()).toBe('underline');
    expect(tabStops()).toEqual(['-1', '-1', '0']);
    expect(instance.toggles.value()).toBe('bold');
  });

  it('never deselects as focus moves', () => {
    const instance = setupSingle({ selectionFollowsFocus: true, defaultValue: 'bold' });
    item('bold').focus();
    flushSync();

    press('ArrowRight');
    press('ArrowLeft');
    expect(instance.toggles.value()).toBe('bold');
  });
});

describe('group disabled', () => {
  it('ignores a disabled item, and says why', () => {
    const instance = setupSingle({}, WITH_DISABLED);

    expect(item('italic').getAttribute('aria-disabled')).toBe('true');
    expect(item('italic').hasAttribute('data-disabled')).toBe(true);
    expect(item('italic').getAttribute('tabindex')).toBe('-1');

    click(item('italic'));
    expect(instance.toggles.value()).toBeNull();
  });

  it('ignores everything while the whole group is disabled', () => {
    const disabled = new Signal.State(true);
    const instance = setupSingle({ disabled: () => disabled.get() });

    expect(group().getAttribute('aria-disabled')).toBe('true');
    expect(item('bold').getAttribute('aria-disabled')).toBe('true');
    // Still one way in, as a disabled checkbox keeps its tab stop: a group
    // nobody can reach is a group nobody can find out is there.
    expect(tabStops()).toEqual(['0', '-1', '-1']);

    click(item('bold'));
    item('bold').focus();
    press('ArrowRight');
    expect(instance.toggles.value()).toBeNull();
    expect(focused()).toBe('bold');

    disabled.set(false);
    flushSync();
    click(item('bold'));
    expect(instance.toggles.value()).toBe('bold');
  });

  it('keeps its tab stop on the chosen item while the whole group is disabled', () => {
    setupSingle({ disabled: () => true, defaultValue: 'underline' });
    expect(tabStops()).toEqual(['-1', '-1', '0']);
    expect(items().every((node) => !(node as HTMLButtonElement).disabled)).toBe(true);
  });

  it('never gives the tab stop to a disabled item while the group is enabled', () => {
    setupSingle({ defaultValue: 'italic' }, WITH_DISABLED);
    // Chosen, but disabled: the arrows pass over it, so Tab does too.
    expect(tabStops()).toEqual(['0', '-1', '-1']);
  });
});
