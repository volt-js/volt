/**
 * Select and Combobox, driven through real mounted components.
 *
 * Both are the same widget seen twice, so what is worth asserting is the part
 * a consumer cannot see and cannot retrofit: the ARIA triangle between the
 * control, the popup and the highlighted option; that the highlight is never
 * DOM focus; the order Escape unwinds things in; and the fact that a widget
 * made of `<div>`s still submits, validates and resets like a form control.
 *
 * The popup is rendered inline rather than portalled. Nothing here depends on
 * where it lands — anchoring is CSS — and keeping it in the tree means the
 * dismissal tests exercise the containment check on real markup.
 *
 * Timers are real except where the typeahead buffer has to be let go of, and
 * there only `setTimeout`, `clearTimeout` and `Date` are faked: Volt's
 * scheduler coalesces onto `queueMicrotask`, and faking that stops every
 * effect. Where a search has to be waited on, `settle` turns the promise chain
 * and the scheduler over together, the way `async.test.ts` does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, flushSync, mount } from '@voltdev/core';
import { directionWatcherCount } from '../src/anchoring.ts';
import {
  createCombobox,
  createSelect,
  type Combobox,
  type ComboboxOptions,
  type Select,
  type SelectOptions,
} from '../src/combobox.ts';
import { createDismiss, dismissStackSize } from '../src/dismiss.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Fruit {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Blueberry is disabled, so every navigation and every count has a hole in it.
 * No two enabled labels share a first letter, which is what makes the select's
 * typeahead assertions unambiguous.
 */
const FRUITS: readonly Fruit[] = [
  { value: 'ap', label: 'Apple' },
  { value: 'ba', label: 'Banana' },
  { value: 'bl', label: 'Blueberry', disabled: true },
  { value: 'ch', label: 'Cherry' },
  { value: 'da', label: 'Damson' },
];

const ENABLED = 4;

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
/** Bare dismissal layers a test puts up around a component. */
let layers: (() => void)[] = [];
let items: Signal.State<readonly Fruit[]>;
let selectOptions: Partial<SelectOptions>;
let comboOptions: Partial<ComboboxOptions<Fruit>>;
/** Whether the field's `<label>` is handed to the component as its label. */
let labelled = false;
/** Render the popup from the search resource rather than from `items`. */
let fromSearch = false;
/** Name the field wrapper as the anchor rather than letting it ride the input. */
let anchored = false;
/** Back a `multiple` combobox with an `<input>`, which cannot hold its values. */
let inputBacked = false;
/** Narrow the list in the consumer's own code rather than through `matches`. */
let ownFilter = false;
/** What a server-rendered page sends down in the textbox. */
let prefill = '';
/** Put the textbox behind an `:if`, so a test can have it rendered again. */
let remountable = false;
let seq = 0;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><div id="outside">page</div>';
  host = document.querySelector('#app')!;
  items = new Signal.State<readonly Fruit[]>(FRUITS);
  selectOptions = {};
  comboOptions = {};
  labelled = false;
  fromSearch = false;
  anchored = false;
  inputBacked = false;
  ownFilter = false;
  prefill = '';
  remountable = false;
});

afterEach(() => {
  // Dismissal is a module-level stack and anchoring a module-level observer
  // registry; a test that leaves one mounted is a test that breaks the next.
  for (const handle of mounted) handle.unmount();
  mounted = [];
  for (const dispose of layers) dispose();
  layers = [];
  flushSync();
  vi.useRealTimers();
});

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

/** Unmount now, without `afterEach` unmounting the same handle again. */
function dispose(handle: { unmount(): void }): void {
  const index = mounted.indexOf(handle);
  if (index !== -1) mounted.splice(index, 1);
  handle.unmount();
  flushSync();
}

/** A promise resolved by hand, so a search can be held open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Let the promise chain and the scheduler catch up.
 *
 * A resolved search is `await fetcher` → signal writes → effect flush, and a
 * MutationObserver adds a turn of its own, so one microtask is never enough.
 */
async function settle(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
    flushSync();
  }
}

/** A whole press: down, up, then the click, as a pointer really produces it. */
function press(el: HTMLElement, init: MouseEventInit = {}): void {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, ...init }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, ...init }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  flushSync();
}

/** Returns whether the component consumed the key. */
function key(el: HTMLElement, name: string, modifiers: Partial<KeyboardEventInit> = {}): boolean {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  el.dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

/**
 * A layer around `el` that claims Escape without closing on it.
 *
 * What a dialog with `closeOnEscape: false` puts on the stack: the press is
 * spoken for, and the layer stays where it is.
 */
function layerAround(el: Element) {
  const onDismiss = vi.fn();
  createRoot((dispose) => {
    layers.push(dispose);
    createDismiss(() => el, onDismiss);
  });
  flushSync();
  return onDismiss;
}

/**
 * A layer around `el` that closes on Escape, the way a real dialog does.
 *
 * The stack shrinks under this one, which is the difference that matters: a
 * press answered here is a press nothing else may answer as well.
 */
function dialogAround(el: Element): { isOpen(): boolean } {
  let open = true;
  createRoot((dispose) => {
    layers.push(dispose);
    createDismiss(
      () => el,
      () => {
        open = false;
        dispose();
      },
    );
  });
  flushSync();
  return { isOpen: () => open };
}

/** Replace the textbox's contents, as an insertion or a deletion would. */
function type(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

const SELECT_TEMPLATE = `
  <form class="form" :submit="onSubmit($event)">
    <label class="label" :ref="label" :spread="select.field.labelProps()">Fruit</label>
    <select :ref="native" :spread="select.nativeProps()">
      <option value=""></option>
      <option :for="item of items.get()" :key="item.value"
              :spread="select.nativeOptionProps({ value: item.value, disabled: item.disabled })"
      >{ item.label }</option>
    </select>
    <button class="trigger" :ref="trigger" :spread="select.triggerProps()"
            :click="select.onTriggerClick()"
            :keydown="select.onTriggerKeyDown($event)"
            :blur="select.onTriggerBlur()">{ select.displayValue() }</button>
    <div class="listbox" :if="select.isPresent()" :ref="list"
         :spread="select.listboxProps()"
         :click="select.onOptionClick($event)"
         :pointerdown="select.onListboxPointerDown($event)"
         :pointermove="select.onOptionPointerMove($event)">
      <div class="option" :for="item of items.get()" :key="item.value"
           :spread="select.optionProps({ value: item.value, disabled: item.disabled })"
      >{ item.label }</div>
    </div>
    <p class="status" :spread="select.statusProps()">{ select.status() }</p>
  </form>
`;

interface SelectHarness {
  handle: { unmount(): void };
  select: Select;
  form(): HTMLFormElement;
  trigger(): HTMLButtonElement;
  native(): HTMLSelectElement;
  label(): HTMLElement;
  listbox(): HTMLElement | null;
  status(): HTMLElement;
  options(): HTMLElement[];
  option(value: string): HTMLElement;
  /** Every option's `aria-selected`, so a whole selection reads as one line. */
  selectedFlags(): (string | null)[];
}

function selectDemo(): SelectHarness {
  @Component({ selector: `v-select-${++seq}`, render: compileTemplate(SELECT_TEMPLATE) })
  class SelectDemo {
    trigger = new Signal.State<Element | null>(null);
    list = new Signal.State<Element | null>(null);
    native = new Signal.State<Element | null>(null);
    label = new Signal.State<Element | null>(null);
    items = items;

    select = createSelect({
      ...selectOptions,
      trigger: () => this.trigger.get(),
      listbox: () => this.list.get(),
      native: () => this.native.get(),
      ...(labelled ? { field: { label: () => this.label.get() } } : {}),
    });

    /** Kept off the network, and out of the way of every pointer test. */
    onSubmit(event: Event): void {
      event.preventDefault();
    }
  }

  const handle = track(mount(SelectDemo, host));
  flushSync();
  const instance = handle.instance as SelectDemo;

  const find = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  return {
    handle,
    select: instance.select,
    form: () => find<HTMLFormElement>('form'),
    trigger: () => find<HTMLButtonElement>('.trigger'),
    native: () => find<HTMLSelectElement>('select'),
    label: () => find('.label'),
    listbox: () => host.querySelector<HTMLElement>('.listbox'),
    status: () => find('.status'),
    options: () => [...host.querySelectorAll<HTMLElement>('.option')],
    option: (value) => find(`.option[data-value="${value}"]`),
    selectedFlags: () =>
      [...host.querySelectorAll<HTMLElement>('.option')].map((el) =>
        el.getAttribute('aria-selected'),
      ),
  };
}

// ---------------------------------------------------------------------------
// Combobox
// ---------------------------------------------------------------------------

/**
 * Built per demo rather than declared once, because `prefill` is markup: a
 * server that has already filled the form in sends the label of the value it
 * holds down in the textbox, and nothing this component does afterwards can
 * put it back.
 */
const comboboxTemplate = (): string => `
  <form class="form" :submit="onSubmit($event)">
    <div class="wrapper" :ref="wrapper" :spread="wrapperProps()">
      <ul class="chips" :if="multiple" :spread="combo.chipsProps()">
        <li class="chip" :for="v of combo.values()" :key="v" :spread="combo.chipProps(v)">
          <span>{ combo.labelOf(v) }</span>
          <button class="remove" :spread="combo.removeChipProps(v)"
                  :click="combo.deselect(v)">x</button>
        </li>
      </ul>
      ${remountable ? '<span :if="boxVisible.get()">' : ''}
      <input class="input" :ref="input" ${prefill === '' ? '' : `value="${prefill}"`}
             :spread="combo.inputProps()"
             :input="combo.onInput($event)"
             :keydown="combo.onInputKeyDown($event)"
             :click="combo.onInputClick()"
             :blur="combo.onInputBlur()">
      ${remountable ? '</span>' : ''}
      <button class="toggle" :spread="combo.toggleProps()" :click="combo.onToggleClick()"
              :pointerdown="combo.onTogglePointerDown($event)">v</button>
      <!-- The same two handlers with none of the props, which is all the doc
           for them asks for. -->
      <button class="plain-toggle" :click="combo.onToggleClick()"
              :pointerdown="combo.onTogglePointerDown($event)">v</button>
      <button class="clear" :spread="combo.clearProps()" :click="combo.clear()">x</button>
    </div>
    <input class="native" :if="nativeInput" :ref="native" :spread="combo.nativeProps()">
    <select class="native" :if="nativeSelect" :ref="native" :spread="combo.nativeProps()">
      <option :for="v of combo.values()" :key="v"
              :spread="combo.nativeOptionProps({ value: v })">{ combo.labelOf(v) }</option>
    </select>
    <div class="listbox" :if="combo.isPresent()" :ref="list"
         :spread="combo.listboxProps()"
         :click="combo.onOptionClick($event)"
         :pointerdown="combo.onListboxPointerDown($event)"
         :pointermove="combo.onOptionPointerMove($event)">
      <div class="option" :for="item of visible()" :key="item.value"
           :spread="combo.optionProps({ value: item.value, disabled: item.disabled })"
      >{ item.label }</div>
      <div class="empty" :if="combo.isEmpty()">{ combo.emptyMessage() }</div>
    </div>
    <p class="status" :spread="combo.statusProps()">{ combo.status() }</p>
  </form>
`;

interface ComboHarness {
  handle: { unmount(): void };
  combo: Combobox<Fruit>;
  form(): HTMLFormElement;
  input(): HTMLInputElement;
  /** An `<input>`, or a `<select multiple>` when several may be chosen. */
  native(): HTMLElement;
  toggle(): HTMLButtonElement;
  /** A toggle wired the way the doc describes and given none of the props. */
  plainToggle(): HTMLButtonElement;
  clear(): HTMLButtonElement;
  listbox(): HTMLElement | null;
  wrapper(): HTMLElement;
  status(): HTMLElement;
  empty(): HTMLElement | null;
  options(): HTMLElement[];
  option(value: string): HTMLElement;
  labels(): string[];
  chips(): HTMLElement | null;
  chipLabels(): string[];
  removeButton(value: string): HTMLButtonElement;
  /** Take the textbox out of the page and put the markup back as it came. */
  remountBox(): void;
}

function comboDemo(): ComboHarness {
  @Component({ selector: `v-combo-${++seq}`, render: compileTemplate(comboboxTemplate()) })
  class ComboDemo {
    input = new Signal.State<Element | null>(null);
    list = new Signal.State<Element | null>(null);
    native = new Signal.State<Element | null>(null);
    wrapper = new Signal.State<Element | null>(null);
    boxVisible = new Signal.State(true);
    items = items;
    multiple = comboOptions.multiple === true;
    /**
     * One value goes behind an `<input>`; several can only go behind a
     * `<select multiple>`, because an input holds one string. `inputBacked` is
     * the mistake, rendered on purpose by the one test that asserts what it
     * costs.
     */
    nativeInput = comboOptions.multiple !== true || inputBacked;
    nativeSelect = comboOptions.multiple === true && !inputBacked;

    combo = createCombobox<Fruit>({
      ...comboOptions,
      input: () => this.input.get(),
      listbox: () => this.list.get(),
      native: () => this.native.get(),
      ...(anchored ? { anchor: () => this.wrapper.get() } : {}),
    });

    /**
     * `anchorProps` belongs on the element the popup lines up with, and only
     * when that is not the control — spreading it as well as leaving it on the
     * input would give two elements one anchor name.
     */
    wrapperProps(): Record<string, unknown> {
      return anchored ? this.combo.anchorProps() : {};
    }

    /** What the consumer's own markup decides to render, filter included. */
    visible(): readonly Fruit[] {
      if (fromSearch) return this.combo.items();
      // Narrowing the list without going near `matches`, which is what
      // `inputValue()` is on the surface for and what nothing forbids.
      if (ownFilter) {
        const typed = this.combo.inputValue().toLowerCase();
        return this.items.get().filter((item) => item.label.toLowerCase().startsWith(typed));
      }
      return this.items.get().filter((item) => this.combo.matches(item.label));
    }

    /** Kept off the network, and out of the way of every pointer test. */
    onSubmit(event: Event): void {
      event.preventDefault();
    }
  }

  const handle = track(mount(ComboDemo, host));
  flushSync();
  const instance = handle.instance as ComboDemo;

  const find = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  return {
    handle,
    combo: instance.combo,
    form: () => find<HTMLFormElement>('form'),
    input: () => find<HTMLInputElement>('.input'),
    native: () => find('.native'),
    toggle: () => find<HTMLButtonElement>('.toggle'),
    plainToggle: () => find<HTMLButtonElement>('.plain-toggle'),
    clear: () => find<HTMLButtonElement>('.clear'),
    listbox: () => host.querySelector<HTMLElement>('.listbox'),
    wrapper: () => find('.wrapper'),
    status: () => find('.status'),
    empty: () => host.querySelector<HTMLElement>('.empty'),
    options: () => [...host.querySelectorAll<HTMLElement>('.option')],
    option: (value) => find(`.option[data-value="${value}"]`),
    labels: () => [...host.querySelectorAll<HTMLElement>('.option')].map((el) => el.textContent!),
    chips: () => host.querySelector<HTMLElement>('.chips'),
    chipLabels: () => [...host.querySelectorAll<HTMLElement>('.chip span')].map((el) =>
      el.textContent!,
    ),
    removeButton: (value) => find<HTMLButtonElement>(`.remove[data-value="${value}"]`),
    remountBox: () => {
      instance.boxVisible.set(false);
      flushSync();
      instance.boxVisible.set(true);
      flushSync();
    },
  };
}

/** Open the combobox and put DOM focus where a real interaction leaves it. */
function openCombo(ui: ComboHarness): HTMLInputElement {
  const input = ui.input();
  input.focus();
  press(input);
  return input;
}

// ---------------------------------------------------------------------------
// Select — what assistive technology is told
// ---------------------------------------------------------------------------

describe('the select trigger', () => {
  it('is a combobox that owns the popup, and only claims it while it is there', () => {
    const ui = selectDemo();
    const trigger = ui.trigger();

    // The APG select-only pattern: role=combobox on the button, because a
    // button role cannot carry `aria-activedescendant`.
    expect(trigger.getAttribute('role')).toBe('combobox');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-controls')).toBe(false);
    expect(trigger.getAttribute('tabindex')).toBe('0');

    press(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // Pointing at an id nothing carries announces a control of nothing while
    // hiding the fact that the wiring is missing.
    expect(trigger.getAttribute('aria-controls')).toBe(ui.listbox()!.id);
  });

  it('does not turn into a submit button inside the form it is meant to serve', () => {
    const ui = selectDemo();
    // `clearProps` and `toggleProps` both say `type: button`. A trigger that
    // does not submits the surrounding form on every attempt to open the list.
    expect(ui.trigger().type).toBe('button');
  });

  it('says the value is missing until one is chosen', () => {
    const ui = selectDemo();
    expect(ui.trigger().hasAttribute('data-placeholder')).toBe(true);

    ui.select.select('ch');
    flushSync();
    expect(ui.trigger().hasAttribute('data-placeholder')).toBe(false);
  });

  it('shows the label of the value it starts with, before any popup has existed', () => {
    selectOptions = { defaultValue: 'ch' };
    const ui = selectDemo();

    // The native `<select>` is where the labels come from while nothing is
    // rendered; without that a select restored from a server shows a code.
    expect(ui.trigger().textContent).toBe('Cherry');
  });

  it('joins several labels the way the locale joins a list', () => {
    selectOptions = { multiple: true, defaultValue: ['ap', 'ch'] };
    const ui = selectDemo();
    expect(ui.select.displayValue()).toBe('Apple and Cherry');
  });

  it('marks itself unavailable without leaving the keyboard unable to find it', () => {
    selectOptions = { disabled: () => true };
    const ui = selectDemo();

    expect(ui.trigger().getAttribute('aria-disabled')).toBe('true');
    // Still in the tab order: a control a keyboard user cannot reach is a
    // control they cannot discover is disabled.
    expect(ui.trigger().getAttribute('tabindex')).toBe('0');
    expect(ui.trigger().hasAttribute('disabled')).toBe(false);

    press(ui.trigger());
    expect(ui.select.isOpen()).toBe(false);
  });

  it('records having been left, for validation that waits for it', () => {
    const ui = selectDemo();
    expect(ui.select.field.isTouched()).toBe(false);

    ui.trigger().focus();
    ui.trigger().blur();
    flushSync();
    expect(ui.select.field.isTouched()).toBe(true);
  });
});

describe('the popup a select opens', () => {
  it('is a listbox named by the field label when there is one', () => {
    labelled = true;
    const ui = selectDemo();
    press(ui.trigger());

    const listbox = ui.listbox()!;
    expect(listbox.getAttribute('role')).toBe('listbox');
    expect(listbox.getAttribute('aria-labelledby')).toBe(ui.label().id);
    expect(listbox.hasAttribute('aria-label')).toBe(false);
    // Focus never enters the popup, so a tab stop here would be a place a user
    // can land with nothing to operate.
    expect(listbox.hasAttribute('tabindex')).toBe(false);
  });

  it('names itself when no field label exists to point at', () => {
    const ui = selectDemo();
    press(ui.trigger());

    // A dangling `aria-labelledby` announces an unnamed listbox and hides the
    // mistake; a name of its own announces something.
    expect(ui.listbox()!.hasAttribute('aria-labelledby')).toBe(false);
    expect(ui.listbox()!.getAttribute('aria-label')).toBe('Suggestions');
  });

  it('states selection on every option, so each is heard to be selectable', () => {
    const ui = selectDemo();
    press(ui.trigger());
    expect(ui.selectedFlags()).toEqual(['false', 'false', 'false', 'false', 'false']);

    press(ui.option('ch'));
    press(ui.trigger());
    expect(ui.selectedFlags()).toEqual(['false', 'false', 'false', 'true', 'false']);
  });

  it('says nothing about multiple selection unless several may be chosen', () => {
    const ui = selectDemo();
    press(ui.trigger());
    expect(ui.listbox()!.hasAttribute('aria-multiselectable')).toBe(false);

    dispose(ui.handle);
    selectOptions = { multiple: true };
    const many = selectDemo();
    press(many.trigger());
    expect(many.listbox()!.getAttribute('aria-multiselectable')).toBe('true');
  });

  it('leaves a disabled option in the accessibility tree', () => {
    const ui = selectDemo();
    press(ui.trigger());

    const blueberry = ui.option('bl');
    expect(blueberry.getAttribute('aria-disabled')).toBe('true');
    // Not the `disabled` attribute: it can still be found and heard to be
    // unavailable rather than appear to have vanished.
    expect(blueberry.hasAttribute('disabled')).toBe(false);
    expect(blueberry.hasAttribute('data-disabled')).toBe(true);
  });

  it('announces how many options there are, from a region that was always there', () => {
    const ui = selectDemo();

    // A live region that appears together with its message announces nothing,
    // so it is rendered empty and stays.
    expect(ui.status().getAttribute('role')).toBe('status');
    expect(ui.status().getAttribute('aria-live')).toBe('polite');
    expect(ui.status().getAttribute('aria-atomic')).toBe('true');
    expect(ui.status().textContent).toBe('');

    press(ui.trigger());
    // Four, not five: the disabled one is not an option anybody can take.
    expect(ui.status().textContent).toBe(`${ENABLED} results available`);

    press(ui.trigger());
    expect(ui.status().textContent).toBe('');
  });
});

describe('virtual focus in a select', () => {
  it('names the active option instead of moving focus to it', () => {
    const ui = selectDemo();
    const trigger = ui.trigger();
    trigger.focus();

    key(trigger, 'ArrowDown');
    key(trigger, 'ArrowDown');

    const named = trigger.getAttribute('aria-activedescendant');
    // The id has to resolve, or the attribute is a promise of an option that
    // a screen reader will never find.
    expect(named).toBe(ui.option('ba').id);
    expect(document.getElementById(named!)).toBe(ui.option('ba'));
    expect(document.activeElement).toBe(trigger);
    expect(ui.option('ba').hasAttribute('data-highlighted')).toBe(true);
    // No second tab stop anywhere in the popup.
    expect(ui.options().every((el) => !el.hasAttribute('tabindex'))).toBe(true);
  });

  it('lets go of the highlight when the option it named leaves the list', async () => {
    const ui = selectDemo();
    const trigger = ui.trigger();

    key(trigger, 'End');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(ui.option('da').id);

    items.set(FRUITS.slice(0, 2));
    await settle();

    // Damson has gone. Typing is not the only way a list changes — a late
    // search answer and a consumer's own filter never reach this component —
    // and an id nothing carries is a promise of an option no screen reader
    // will ever find.
    expect(ui.select.activeValue()).toBeNull();
    expect(trigger.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('drops the reference when the popup goes, rather than pointing into nothing', () => {
    const ui = selectDemo();
    const trigger = ui.trigger();

    key(trigger, 'ArrowDown');
    expect(trigger.hasAttribute('aria-activedescendant')).toBe(true);

    key(trigger, 'Escape');
    expect(ui.listbox()).toBeNull();
    expect(trigger.hasAttribute('aria-activedescendant')).toBe(false);
    expect(ui.select.activeValue()).toBeNull();
  });
});

describe('the select keyboard', () => {
  it('opens on the four keys that open it, at the selected option', () => {
    for (const name of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
      selectOptions = { defaultValue: 'ch' };
      const ui = selectDemo();
      expect(key(ui.trigger(), name)).toBe(true);
      expect(ui.select.isOpen()).toBe(true);
      expect(ui.select.activeValue()).toBe('ch');
      dispose(ui.handle);
    }
  });

  it('opens with nothing highlighted under Alt, which is the "just show me" key', () => {
    selectOptions = { defaultValue: 'ch' };
    const ui = selectDemo();

    key(ui.trigger(), 'ArrowDown', { altKey: true });
    expect(ui.select.isOpen()).toBe(true);
    expect(ui.select.activeValue()).toBeNull();
    expect(ui.trigger().hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('opens at the first and last option from Home and End', () => {
    const ui = selectDemo();
    key(ui.trigger(), 'End');
    expect(ui.select.activeValue()).toBe('da');

    key(ui.trigger(), 'Home');
    expect(ui.select.activeValue()).toBe('ap');
  });

  it('steps over the disabled option and stops at the ends', () => {
    const ui = selectDemo();
    const trigger = ui.trigger();

    key(trigger, 'ArrowDown');
    expect(ui.select.activeValue()).toBe('ap');
    key(trigger, 'ArrowDown');
    key(trigger, 'ArrowDown');
    // Blueberry sits between Banana and Cherry and is not stopped on.
    expect(ui.select.activeValue()).toBe('ch');

    key(trigger, 'End');
    // The key is still consumed at the end, or the page scrolls underneath.
    expect(key(trigger, 'ArrowDown')).toBe(true);
    expect(ui.select.activeValue()).toBe('da');
  });

  it('wraps only when asked to', () => {
    selectOptions = { loop: true };
    const ui = selectDemo();
    key(ui.trigger(), 'End');
    key(ui.trigger(), 'ArrowDown');
    expect(ui.select.activeValue()).toBe('ap');
  });

  it('commits on Enter and closes, leaving focus on the trigger', () => {
    const ui = selectDemo();
    const trigger = ui.trigger();
    trigger.focus();

    key(trigger, 'ArrowDown');
    key(trigger, 'ArrowDown');
    expect(key(trigger, 'Enter')).toBe(true);

    expect(ui.select.value()).toBe('ba');
    expect(ui.select.isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('commits and collapses in one press with Alt and Up', () => {
    const ui = selectDemo();
    key(ui.trigger(), 'ArrowDown');
    key(ui.trigger(), 'ArrowUp', { altKey: true });

    expect(ui.select.value()).toBe('ap');
    expect(ui.select.isOpen()).toBe(false);
  });

  it('leaves a multiple open after a keyboard choice, as a pointer choice does', () => {
    selectOptions = { multiple: true };
    const ui = selectDemo();
    const trigger = ui.trigger();

    key(trigger, 'ArrowDown');
    key(trigger, 'Enter');
    // `closeOnSelect` defaults to false here, and the pointer honours it:
    // choosing three things should not mean opening the list three times.
    expect(ui.select.values()).toEqual(['ap']);
    expect(ui.select.isOpen()).toBe(true);

    key(trigger, 'ArrowDown');
    key(trigger, ' ');
    expect(ui.select.values()).toEqual(['ap', 'ba']);
    expect(ui.select.isOpen()).toBe(true);

    // The same key takes a value off again, and still leaves the list up.
    key(trigger, 'Enter');
    expect(ui.select.values()).toEqual(['ap']);
    expect(ui.select.isOpen()).toBe(true);
  });

  it('keeps the list up on a keyboard choice it refuses, as it does for a press', () => {
    selectOptions = { readOnly: () => true, defaultValue: 'ap' };
    const ui = selectDemo();
    const trigger = ui.trigger();

    key(trigger, 'ArrowDown');
    key(trigger, 'ArrowDown');
    key(trigger, 'Enter');
    expect(ui.select.value()).toBe('ap');
    expect(ui.select.isOpen()).toBe(true);
  });

  it('takes the highlighted option on Tab and leaves the key to the browser', () => {
    const ui = selectDemo();
    key(ui.trigger(), 'ArrowDown');

    // Not prevented: the user asked to leave, and they should end up after the
    // trigger rather than back where they were.
    expect(key(ui.trigger(), 'Tab')).toBe(false);
    expect(ui.select.value()).toBe('ap');
    expect(ui.select.isOpen()).toBe(false);
  });

  it('takes the highlighted option on the way out of a multiple, never drops it', () => {
    selectOptions = { multiple: true, defaultValue: ['ba', 'ch'] };
    const ui = selectDemo();
    const trigger = ui.trigger();

    // A multiple opens on the first value it holds, so this is the Tab of a
    // user leaving having only looked.
    key(trigger, 'ArrowDown');
    expect(ui.select.activeValue()).toBe('ba');
    expect(key(trigger, 'Tab')).toBe(false);
    expect(ui.select.values()).toEqual(['ba', 'ch']);
    expect(ui.select.isOpen()).toBe(false);

    // Alt and Up is the other way out, and answers the same way.
    key(trigger, 'ArrowDown');
    key(trigger, 'ArrowUp', { altKey: true });
    expect(ui.select.values()).toEqual(['ba', 'ch']);
    expect(ui.select.isOpen()).toBe(false);

    // An option it does not hold yet is still taken.
    key(trigger, 'Home');
    key(trigger, 'Tab');
    expect(ui.select.values()).toEqual(['ba', 'ch', 'ap']);
  });

  it('closes on Escape with the value untouched', () => {
    selectOptions = { defaultValue: 'ch' };
    const ui = selectDemo();

    key(ui.trigger(), 'ArrowDown');
    key(ui.trigger(), 'ArrowDown');
    expect(ui.select.activeValue()).toBe('da');

    key(ui.trigger(), 'Escape');
    expect(ui.select.isOpen()).toBe(false);
    expect(ui.select.value()).toBe('ch');
  });

  it('chooses by typed prefix without ever opening, as a native select does', () => {
    // Only the typeahead buffer's timeout is faked. Volt's scheduler runs on
    // queueMicrotask, and faking that stops every effect.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const ui = selectDemo();

    // The hidden `<select>` is a collection of its own, which is what makes
    // this possible while nothing is rendered.
    key(ui.trigger(), 'd');
    expect(ui.select.value()).toBe('da');
    expect(ui.select.isOpen()).toBe(false);

    // Characters accumulate, so "ch" is one search and not two.
    vi.advanceTimersByTime(600);
    key(ui.trigger(), 'c');
    key(ui.trigger(), 'h');
    expect(ui.select.value()).toBe('ch');
    expect(ui.select.isOpen()).toBe(false);

    vi.advanceTimersByTime(600);
    key(ui.trigger(), 'a');
    expect(ui.select.value()).toBe('ap');
  });

  it('moves the highlight by typed prefix while open, without choosing', () => {
    const ui = selectDemo();
    key(ui.trigger(), 'ArrowDown');

    key(ui.trigger(), 'c');
    expect(ui.select.activeValue()).toBe('ch');
    expect(ui.select.value()).toBeNull();
  });

  it('leaves a shortcut to the application', () => {
    const ui = selectDemo();
    expect(key(ui.trigger(), 'ArrowDown', { ctrlKey: true })).toBe(false);
    expect(ui.select.isOpen()).toBe(false);
  });
});

describe('choosing with the pointer', () => {
  it('does not treat a press on the trigger as a press outside', () => {
    const ui = selectDemo();
    press(ui.trigger());
    expect(ui.select.isOpen()).toBe(true);

    // Dismissal running first would close it and the trigger's own handler
    // would open it straight back up, so the button would never close it.
    press(ui.trigger());
    expect(ui.select.isOpen()).toBe(false);
  });

  it('closes on a press outside', () => {
    const ui = selectDemo();
    press(ui.trigger());

    press(document.querySelector<HTMLElement>('#outside')!);
    expect(ui.select.isOpen()).toBe(false);
  });

  it('commits an option and closes', () => {
    const ui = selectDemo();
    press(ui.trigger());
    press(ui.option('ch'));

    expect(ui.select.value()).toBe('ch');
    expect(ui.select.isOpen()).toBe(false);
    expect(ui.trigger().textContent).toBe('Cherry');
  });

  it('swallows a press on a disabled option', () => {
    const ui = selectDemo();
    press(ui.trigger());

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    ui.option('bl').dispatchEvent(event);
    flushSync();

    // Visibly there, and an `<a>` used as an option would follow its href.
    expect(event.defaultPrevented).toBe(true);
    expect(ui.select.value()).toBeNull();
    expect(ui.select.isOpen()).toBe(true);
  });

  it('keeps focus on the control when the press lands in the popup', () => {
    const ui = selectDemo();
    press(ui.trigger());

    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    ui.option('ap').dispatchEvent(event);
    flushSync();

    // Cancelled, or a focusable option — or a scrollbar drag — would take
    // focus off the control and close the popup out from under the press.
    expect(event.defaultPrevented).toBe(true);
  });

  it('accumulates in a multiple and keeps the popup open', () => {
    selectOptions = { multiple: true };
    const ui = selectDemo();
    press(ui.trigger());

    press(ui.option('ap'));
    press(ui.option('ch'));
    expect(ui.select.values()).toEqual(['ap', 'ch']);
    expect(ui.select.isOpen()).toBe(true);

    press(ui.option('ap'));
    expect(ui.select.values()).toEqual(['ch']);
  });

  it('removes as well as adds on a widget that holds one value', () => {
    selectOptions = { defaultValue: 'ap' };
    const ui = selectDemo();

    // Documented as "add or remove", and a caller asking for a removal is
    // asking for one however many values the widget holds.
    ui.select.toggleValue('ap');
    flushSync();
    expect(ui.select.values()).toEqual([]);

    ui.select.toggleValue('ch');
    flushSync();
    expect(ui.select.values()).toEqual(['ch']);

    press(ui.trigger());
    press(ui.option('ch'));
    // A press on the option a single select already holds is not a request to
    // hold none — a native select answers it the same way — so the press route
    // takes rather than toggles.
    expect(ui.select.values()).toEqual(['ch']);
  });

  it('refuses to change anything while read-only, and leaves the list up to browse', () => {
    selectOptions = { readOnly: () => true, defaultValue: 'ap' };
    const ui = selectDemo();
    press(ui.trigger());
    expect(ui.select.isOpen()).toBe(true);

    press(ui.option('ch'));
    expect(ui.select.value()).toBe('ap');
    // A press that changed nothing has not chosen anything, and `closeOnSelect`
    // is about a selection. Collapsing the popup on every press leaves the
    // values readable and the list they came from impossible to read at all.
    expect(ui.select.isOpen()).toBe(true);

    press(ui.option('da'));
    expect(ui.select.value()).toBe('ap');
    expect(ui.select.isOpen()).toBe(true);
  });
});

describe('the form behind a select', () => {
  it('submits through a real select', () => {
    selectOptions = { name: 'fruit' };
    const ui = selectDemo();

    expect(new FormData(ui.form()).get('fruit')).toBe('');
    press(ui.trigger());
    press(ui.option('ch'));
    expect(new FormData(ui.form()).get('fruit')).toBe('ch');
  });

  it('hides the native control from assistive technology and from Tab', () => {
    selectOptions = { name: 'fruit' };
    const ui = selectDemo();
    const native = ui.native();

    // The visible control carries the role and the tab stop; announcing both
    // announces the widget twice.
    expect(native.getAttribute('aria-hidden')).toBe('true');
    expect(native.getAttribute('tabindex')).toBe('-1');
    // Present but not seen: an unrendered control has nowhere for the
    // browser's own validation bubble to point.
    expect(native.style.position).toBe('absolute');
    expect(native.style.getPropertyValue('clip-path')).toBe('inset(50%)');
  });

  it('lets the platform enforce required, and clears it once a value is chosen', () => {
    selectOptions = { name: 'fruit', required: () => true };
    const ui = selectDemo();

    expect(ui.native().required).toBe(true);
    expect(ui.form().checkValidity()).toBe(false);

    press(ui.trigger());
    press(ui.option('ch'));
    expect(ui.form().checkValidity()).toBe(true);
  });

  it('writes disabled through to the native control, so the platform excludes it', () => {
    selectOptions = { name: 'fruit', defaultValue: 'ch', disabled: () => true };
    const ui = selectDemo();

    // The flag has to reach the real control: a widget that only looks
    // disabled still submits, still validates, and still fails a form.
    expect(ui.native().disabled).toBe(true);
    expect(ui.select.field.isDisabled()).toBe(true);
  });

  it('follows a form reset back to the value the form holds', async () => {
    selectOptions = { name: 'fruit', defaultValue: 'ap' };
    const ui = selectDemo();

    press(ui.trigger());
    press(ui.option('ch'));
    expect(ui.select.value()).toBe('ch');

    ui.form().reset();
    await settle();
    // A widget that ignored reset would leave the page showing a value the
    // form no longer holds.
    expect(ui.select.value()).toBe('ap');
    expect(new FormData(ui.form()).get('fruit')).toBe('ap');
  });
});

// ---------------------------------------------------------------------------
// Combobox
// ---------------------------------------------------------------------------

describe('the combobox textbox', () => {
  it('is a combobox that says how much it promises about the list', () => {
    const ui = comboDemo();
    const input = ui.input();

    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-haspopup')).toBe('listbox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    // The browser's own autofill drops a second list on top of this one, and
    // its spellchecker underlines every proper noun in the catalogue.
    expect(input.getAttribute('autocomplete')).toBe('off');
    // A property rather than an attribute on a real input, so it is asserted
    // where it is written.
    expect(ui.combo.inputProps().spellcheck).toBe(false);

    openCombo(ui);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(ui.listbox()!.id);
  });

  it('says so when typing does not narrow the list at all', () => {
    comboOptions = { autocomplete: 'none' };
    const ui = comboDemo();
    const input = openCombo(ui);

    expect(input.getAttribute('aria-autocomplete')).toBe('none');
    type(input, 'zzz');
    // `none` is a combobox used purely as an opener; the list is not a search.
    expect(ui.options()).toHaveLength(FRUITS.length);
  });

  it('holds a value nothing can name yet without putting the identifier in the box', () => {
    comboOptions = { name: 'fruit', defaultValue: 'ba' };
    const ui = comboDemo();

    // Nothing on this page can say what `ba` is called: a combobox's native
    // control is an `<input>` with no options in it, and the popup has never
    // been opened. So the box says nothing, and everything that reports the
    // value says `ba` — the field is holding it, not hiding it.
    expect(ui.input().value).toBe('');
    expect(ui.combo.inputValue()).toBe('');
    expect(ui.combo.value()).toBe('ba');
    expect(ui.combo.hasValue()).toBe(true);
    expect(new FormData(ui.form()).get('fruit')).toBe('ba');

    // And it is not a question either. What is in a textbox is text somebody
    // could have typed — it is filtered on, searched for, completed from, and
    // read straight off `inputValue()` by a consumer narrowing the list in
    // their own code — so an identifier there is this component answering for
    // the user, and the list opening narrowed by a keystroke nobody made.
    expect(ui.combo.isFiltering()).toBe(false);
    press(ui.toggle());
    expect(ui.labels()).toEqual(FRUITS.map((fruit) => fruit.label));
  });

  it('keeps the name the page was rendered with, over the identifier behind it', () => {
    comboOptions = { name: 'fruit', defaultValue: 'ba' };
    // What a server that has already filled the form in sends: the value in the
    // control that submits, and its label in the box the user reads. It is the
    // only name for that value on a page whose popup has never been opened, and
    // seeding the box over the top of it would throw it away.
    prefill = 'Banana';
    const ui = comboDemo();

    expect(ui.input().value).toBe('Banana');
    expect(ui.combo.inputValue()).toBe('Banana');
    // And it is a name like any other from there on, so the chips, the
    // announcements and a blur all have it too.
    expect(ui.combo.labelOf('ba')).toBe('Banana');
    expect(new FormData(ui.form()).get('fruit')).toBe('ba');
  });

  it('takes no name from the box when several values may be chosen', () => {
    comboOptions = { name: 'fruit', multiple: true, defaultValue: ['ba'] };
    // The same page, sending the same thing down: a label in the box over the
    // values in the control that submits.
    prefill = 'Cherry';
    const ui = comboDemo();

    // But a multiple keeps its box for typing and shows what it holds as
    // chips, so nothing it was rendered with there names anything. Reading it
    // as the name of the first value files a label the page never offered for
    // it — under whichever value happens to be first.
    expect(ui.combo.labelOf('ba')).toBe('ba');
    expect(ui.chipLabels()).toEqual(['ba']);
    expect(ui.combo.values()).toEqual(['ba']);
  });

  it('adopts the text it was rendered with once, not again from a later box', () => {
    comboOptions = { name: 'fruit', defaultValue: 'ch' };
    prefill = 'Cherry';
    // The textbox behind an `:if`, as a consumer who reveals the field or
    // re-renders the row around it has it.
    remountable = true;
    const ui = comboDemo();
    expect(ui.combo.labelOf('ch')).toBe('Cherry');

    openCombo(ui);
    press(ui.option('ba'));
    expect(ui.combo.value()).toBe('ba');
    expect(ui.combo.labelOf('ba')).toBe('Banana');

    // A textbox rendered again comes back holding the markup the server sent,
    // which is a name for the value the page was loaded with and not for the
    // one held now. Adopting is what the page is asked once, on the box it
    // arrived with; every name after that comes from something that named it.
    ui.remountBox();
    expect(ui.combo.labelOf('ba')).toBe('Banana');
    expect(ui.combo.value()).toBe('ba');
    // And the box says the name of the value held, rather than the markup it
    // came back holding. The writer keeps a record of its own last write so an
    // inline completion is left alone; that record describes the element it
    // was written to, so a new element is still written.
    expect(ui.input().value).toBe('Banana');
  });

  it('does not report an input change for a box that only came back', () => {
    // The string did not change — the element did. Reporting it would be the
    // component telling the caller something the caller did not do.
    const seen: string[] = [];
    comboOptions = { name: 'fruit', onInputValueChange: (value) => seen.push(value) };
    remountable = true;
    const ui = comboDemo();

    // Named by the option that was pressed — a value nothing has named has no
    // name here, which is the model rather than an accident.
    openCombo(ui);
    press(ui.option('ba'));
    expect(ui.input().value).toBe('Banana');

    seen.length = 0;
    ui.remountBox();
    expect(ui.input().value).toBe('Banana');
    expect(seen).toEqual([]);
  });

  it('shows the label of the value it starts with when `labelFor` supplies one', () => {
    comboOptions = {
      name: 'fruit',
      defaultValue: 'ba',
      labelFor: (value) => FRUITS.find((fruit) => fruit.value === value)?.label,
    };
    const ui = comboDemo();

    // Nothing has rendered, and the control behind a single-value combobox is
    // an `<input>` with no options in it, so this is the only thing on the page
    // that can say what `ba` is called. Without it the box shows the identifier
    // the form submits, which is not what the user chose.
    expect(ui.input().value).toBe('Banana');
    expect(new FormData(ui.form()).get('fruit')).toBe('ba');
  });

  it('fills the box in as soon as the list can name the value', () => {
    comboOptions = { name: 'fruit', defaultValue: 'ba' };
    const ui = comboDemo();
    expect(ui.input().value).toBe('');

    press(ui.toggle());
    // The first render of the list is the first moment anything on the page
    // knows the name of the value the form is holding, and the box is this
    // component's to keep right: the user has typed nothing into it.
    expect(ui.input().value).toBe('Banana');
    expect(ui.combo.value()).toBe('ba');
    expect(ui.options()).toHaveLength(FRUITS.length);
  });

  it('replaces it the moment the caller can name the value, popup or no popup', async () => {
    // A catalogue that is still loading: the names for the values the form
    // already holds arrive a turn after the field does.
    const names = new Signal.State<Record<string, string>>({});
    comboOptions = { name: 'fruit', defaultValue: 'ba', labelFor: (value) => names.get()[value] };
    const ui = comboDemo();
    expect(ui.input().value).toBe('');

    names.set({ ba: 'Banana' });
    await settle();
    // Waiting for the list to be opened would leave the box empty in front of
    // a user who never opens it, over a form that submits something.
    expect(ui.input().value).toBe('Banana');
    expect(ui.combo.value()).toBe('ba');
  });

  it('does not report a name turning up as text somebody typed', async () => {
    const seen: string[] = [];
    const names = new Signal.State<Record<string, string>>({});
    comboOptions = {
      name: 'fruit',
      defaultValue: 'ba',
      labelFor: (value) => names.get()[value],
      onInputValueChange: (value) => seen.push(value),
    };
    const ui = comboDemo();
    expect(seen).toEqual([]);

    names.set({ ba: 'Banana' });
    await settle();
    // The box says Banana and nobody has typed a letter of it: what changed is
    // what the page can call the value, not what has been chosen.
    expect(ui.input().value).toBe('Banana');
    expect(seen).toEqual([]);

    press(ui.toggle());
    // Nor is the list rendering the name it already had a change to report.
    expect(ui.input().value).toBe('Banana');
    expect(seen).toEqual([]);

    press(ui.option('ch'));
    // A press on an option is a change, and it is reported — the pointer route
    // says exactly what the keyboard's own Enter says.
    expect(ui.input().value).toBe('Cherry');
    expect(seen).toEqual(['Cherry']);
  });

  it('reports the question in the box once, however often the box is written', () => {
    const seen: string[] = [];
    comboOptions = {
      name: 'fruit',
      defaultValue: 'ch',
      onInputValueChange: (value) => seen.push(value),
    };
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    type(input, 'ba');
    // Typing opened the list, and the list rendering told this component what
    // Banana is called — which is a name arriving for a value held, so the box
    // is worked out again. It comes out the same: the question the user is in
    // the middle of typing. Saying so a second time would have the consumer's
    // handler run twice for one keystroke, and a search behind it ask twice.
    expect(ui.combo.labelOf('ba')).toBe('Banana');
    expect(input.value).toBe('ba');
    expect(seen).toEqual(['ba']);
  });

  it('keeps the label an option really had over one promised for it', () => {
    comboOptions = { name: 'fruit', defaultValue: 'ba', labelFor: () => 'Stale' };
    const ui = comboDemo();

    press(ui.toggle());
    expect(ui.combo.labelOf('ba')).toBe('Banana');

    key(ui.input(), 'Escape');
    // `labelFor` answers for a value nothing has rendered; once something has,
    // what was on the page is what the chip and the box keep saying.
    expect(ui.listbox()).toBeNull();
    expect(ui.combo.labelOf('ba')).toBe('Banana');
    expect(ui.input().value).toBe('Banana');
  });

  it('leaves text that reads like a value alone while the list is still filtering', async () => {
    comboOptions = { name: 'fruit', defaultValue: 'ba' };
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'b');
    type(input, 'ba');
    // Once the observer has caught up, the box holds what was typed character
    // for character, and the list has rendered Banana beneath it. The value
    // held is now nameable, and correcting the box to say so would rewrite the
    // query under the caret of the person typing it.
    await settle();
    expect(input.value).toBe('ba');
    expect(ui.labels()).toEqual(['Banana']);
  });

  it('leaves text the user typed alone when a press puts the caret back in it', async () => {
    comboOptions = { name: 'fruit', defaultValue: 'ba' };
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    // A question that happens to read like the value being held, so that a box
    // corrected to say what is held would be visibly corrected.
    type(input, 'ba');
    key(input, 'Escape');
    press(input);
    await settle();

    // The press reopens the list and says nothing else: it is not an answer to
    // the question in the box, so the question stands and goes on narrowing.
    expect(input.value).toBe('ba');
    expect(ui.combo.inputValue()).toBe('ba');
    expect(ui.combo.isFiltering()).toBe(true);
    expect(ui.labels()).toEqual(['Banana']);
  });

  it('puts the name back when the option pressed is the one already held', () => {
    comboOptions = { name: 'fruit', defaultValue: 'ch', labelFor: () => 'Cherry' };
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'che');
    press(ui.option('ch'));

    // Choosing the value already held changes nothing about the value and is
    // still an answer to the question in the box. Watching the values cannot
    // see it, and the pointer is the route that never passes through this
    // component's own key handling.
    expect(ui.combo.value()).toBe('ch');
    expect(input.value).toBe('Cherry');
    expect(ui.combo.isFiltering()).toBe(false);
  });

  it('puts the name back when Enter takes the option already held', () => {
    comboOptions = { name: 'fruit', defaultValue: 'ch' };
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ch');
    key(input, 'ArrowDown');
    key(input, 'Enter');

    // The keyboard goes its own way to the same answer, and the value not
    // moving is not the value being left alone: the question was answered, so
    // the box says what is held rather than what was being asked.
    expect(ui.combo.value()).toBe('ch');
    expect(input.value).toBe('Cherry');
    expect(ui.combo.isFiltering()).toBe(false);
  });

  it('answers the question in the box when the value is set from outside', () => {
    const value = new Signal.State<readonly string[]>([]);
    comboOptions = { name: 'fruit', value };
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    type(input, 'che');
    expect(ui.combo.isFiltering()).toBe(true);
    expect(ui.labels()).toEqual(['Cherry']);

    // A value the consumer writes themselves passes through no handler here —
    // no press, no keystroke, nothing this component could hang the answer
    // off. The value arriving is the whole of what says the question was
    // answered, and a box still asking it would go on narrowing the list to
    // the thing already chosen.
    value.set(['ch']);
    flushSync();

    expect(ui.combo.isFiltering()).toBe(false);
    expect(input.value).toBe('Cherry');
    expect(ui.labels()).toEqual(FRUITS.map((fruit) => fruit.label));
  });

  it('keeps DOM focus in the textbox and points at the option instead', () => {
    const ui = comboDemo();
    const input = openCombo(ui);

    key(input, 'ArrowDown');
    key(input, 'ArrowDown');

    // The defining constraint of the pattern: typing has to keep working, so
    // focus never leaves the textbox.
    expect(document.activeElement).toBe(input);
    const named = input.getAttribute('aria-activedescendant');
    expect(named).toBe(ui.option('ba').id);
    expect(document.getElementById(named!)).toBe(ui.option('ba'));
    expect(ui.options().every((el) => !el.hasAttribute('tabindex'))).toBe(true);
  });

  it('never points at an option the filter has just removed', () => {
    const ui = comboDemo();
    const input = openCombo(ui);

    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(ui.option('ap').id);

    type(input, 'ch');
    // Apple has left the document; an attribute still naming it is a promise
    // of an element a screen reader will never find.
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(ui.combo.activeValue()).toBeNull();
  });

  it('keeps every option id stable across a re-render, so nothing dangles', () => {
    const ui = comboDemo();
    const input = openCombo(ui);
    const before = ui.option('ch').id;

    type(input, 'ch');
    expect(ui.option('ch').id).toBe(before);
    type(input, '');
    expect(ui.option('ch').id).toBe(before);
  });
});

describe('opening and closing a combobox', () => {
  it('opens on a press, and a second press does not take the list away', () => {
    const ui = comboDemo();
    const input = openCombo(ui);
    expect(ui.combo.isOpen()).toBe(true);

    // A press to reposition the caret in text already typed is not a request
    // to close, and the textbox is never "outside" its own popup.
    press(input);
    expect(ui.combo.isOpen()).toBe(true);
  });

  it('opens down onto the first option and up onto the last', () => {
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    expect(key(input, 'ArrowDown')).toBe(true);
    expect(ui.combo.activeValue()).toBe('ap');

    key(input, 'Escape');
    key(input, 'ArrowUp');
    expect(ui.combo.activeValue()).toBe('da');
  });

  it('opens with nothing highlighted under Alt, and closes again on Alt and Up', () => {
    const ui = comboDemo();
    const input = ui.input();

    key(input, 'ArrowDown', { altKey: true });
    expect(ui.combo.isOpen()).toBe(true);
    expect(ui.combo.activeValue()).toBeNull();

    key(input, 'ArrowUp', { altKey: true });
    expect(ui.combo.isOpen()).toBe(false);
  });

  it('opens on typing, including a deletion back to an empty box', () => {
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'c');
    expect(ui.combo.isOpen()).toBe(true);
    // Nothing is highlighted: the user is typing a query, not picking.
    expect(ui.combo.activeValue()).toBeNull();

    key(input, 'Escape');
    key(input, 'Escape');
    type(input, '');
    expect(ui.combo.isOpen()).toBe(true);
  });

  it('leaves Home and End to the caret', () => {
    const ui = comboDemo();
    const input = openCombo(ui);

    // In a textbox they belong to editing; taking them for the list would make
    // the query impossible to correct.
    expect(key(input, 'Home')).toBe(false);
    expect(key(input, 'End')).toBe(false);
    expect(ui.combo.activeValue()).toBeNull();
  });

  it('takes Escape in two stages: the popup first, then the text', () => {
    const ui = comboDemo();
    const input = ui.input();
    type(input, 'ch');
    expect(ui.combo.isOpen()).toBe(true);

    key(input, 'Escape');
    // The visible layer is the one being addressed. Clearing the text under a
    // list the user wanted rid of reverses what they asked for.
    expect(ui.combo.isOpen()).toBe(false);
    expect(input.value).toBe('ch');

    key(input, 'Escape');
    expect(input.value).toBe('');
    expect(ui.combo.inputValue()).toBe('');
  });

  it('empties the value as well as the box on that second Escape', () => {
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ch');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(ui.combo.value()).toBe('ch');

    key(input, 'Escape');
    // A single-value combobox showing nothing holds nothing.
    expect(input.value).toBe('');
    expect(ui.combo.value()).toBeNull();
  });

  it('closes from the toggle button beside it', () => {
    const ui = comboDemo();
    press(ui.toggle());
    expect(ui.combo.isOpen()).toBe(true);
    expect(ui.toggle().getAttribute('aria-expanded')).toBe('true');
    expect(ui.toggle().getAttribute('aria-controls')).toBe(ui.listbox()!.id);

    // The button offers to close as well as open; dismissal treating it as an
    // outside press would close and reopen in one gesture, and it would never
    // close at all.
    press(ui.toggle());
    expect(ui.combo.isOpen()).toBe(false);
  });

  it('closes from a toggle that was given the handlers and none of the props', () => {
    const ui = comboDemo();

    press(ui.plainToggle());
    expect(ui.combo.isOpen()).toBe(true);

    // `aria-controls` is how a button on the page says it belongs to this
    // popup, but it is only there while the popup is open and only if the
    // consumer spread `toggleProps()` — which the doc for these two handlers
    // never mentions. The press has to be what says so, or dismissal reads it
    // as a press outside: the popup closes and the click opens it again.
    press(ui.plainToggle());
    expect(ui.combo.isOpen()).toBe(false);
  });

  it('keeps focus in the textbox when the toggle is pressed', () => {
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    ui.toggle().dispatchEvent(event);
    flushSync();

    // A `tabindex="-1"` button is still click-focusable, and focus leaving the
    // textbox blurs it — which closes the popup before the click that was
    // meant to open it, and takes typing away from a pattern built on it.
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it('leaves an Escape that another layer has already answered alone', () => {
    const ui = comboDemo();
    const input = ui.input();
    type(input, 'ch');
    key(input, 'Escape');
    expect(ui.combo.isOpen()).toBe(false);
    expect(input.value).toBe('ch');

    // A second widget elsewhere on the page, with its popup up: a dialog or
    // another combobox is the layer above this collapsed one.
    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    const own = host;
    host = elsewhere;
    const other = comboDemo();
    host = own;
    other.combo.open();
    flushSync();
    expect(dismissStackSize()).toBe(1);

    key(input, 'Escape');
    // One press closes one layer. This one is not that layer, so it keeps
    // text the user can still see — and the value under it.
    expect(other.combo.isOpen()).toBe(false);
    expect(input.value).toBe('ch');
    expect(ui.combo.inputValue()).toBe('ch');
  });

  it('still clears the box inside a layer it is rendered in', () => {
    const ui = comboDemo();
    const input = ui.input();
    input.focus();
    // A dialog around the page that keeps its own Escape, which is the layer a
    // combobox is nested *inside* rather than one stacked over the top of it —
    // and how many layers there are cannot tell the two apart.
    const dialog = layerAround(document.body);

    type(input, 'ch');
    key(input, 'Escape');
    expect(ui.combo.isOpen()).toBe(false);
    expect(input.value).toBe('ch');
    expect(dialog).not.toHaveBeenCalled();

    key(input, 'Escape');
    // The second stage APG asks for. A combobox that can never reach it is one
    // whose textbox cannot be emptied from the keyboard for as long as it is in
    // a dialog.
    expect(input.value).toBe('');
    expect(ui.combo.inputValue()).toBe('');
    // And one press answers one layer: the press the textbox took is not also
    // the press the dialog around it hears.
    expect(dialog).not.toHaveBeenCalled();
  });

  it('empties its box without taking down the dialog it is inside', () => {
    const ui = comboDemo();
    const input = ui.input();
    input.focus();
    // A dialog that really closes on Escape, which is the layer configuration
    // where a press answered twice can be seen: the box empties and the dialog
    // it was in goes with it.
    const dialog = dialogAround(document.body);

    type(input, 'ch');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(ui.combo.value()).toBe('ch');
    expect(input.value).toBe('Cherry');

    key(input, 'Escape');
    expect(input.value).toBe('');
    expect(ui.combo.value()).toBeNull();
    // The layer the user is addressing is the one they have focus in. Losing
    // the dialog on the same press loses the value with it, and there is no
    // press left to undo either.
    expect(dialog.isOpen()).toBe(true);

    key(input, 'Escape');
    // Nothing left to clear, so this one belongs to the dialog.
    expect(dialog.isOpen()).toBe(false);
  });

  it('names its two side buttons and keeps them out of the tab order', () => {
    const ui = comboDemo();
    // Both duplicate something the textbox already does from the keyboard, so
    // a tab stop each is one more thing to step over on every pass.
    expect(ui.toggle().getAttribute('aria-label')).toBe('Show suggestions');
    expect(ui.toggle().getAttribute('tabindex')).toBe('-1');
    expect(ui.clear().getAttribute('aria-label')).toBe('Clear');
    expect(ui.clear().getAttribute('tabindex')).toBe('-1');
  });

  it('names the clear button from `labels`, the way it names the toggle', () => {
    comboOptions = { labels: { clear: 'Remove all', toggle: 'Show fruit' } };
    const ui = comboDemo();
    expect(ui.toggle().getAttribute('aria-label')).toBe('Show fruit');
    expect(ui.clear().getAttribute('aria-label')).toBe('Remove all');
  });

  it('puts the text back to the value it holds when focus leaves', () => {
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ch');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    type(input, 'nonsense');

    input.dispatchEvent(new FocusEvent('blur'));
    flushSync();

    // Leaving it would show text the form does not hold.
    expect(input.value).toBe('Cherry');
    expect(ui.combo.isOpen()).toBe(false);
    expect(ui.combo.field.isTouched()).toBe(true);
  });
});

describe('filtering, and what is announced while it happens', () => {
  it('narrows the list and announces the count', () => {
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ch');
    expect(ui.labels()).toEqual(['Cherry']);
    expect(ui.combo.optionCount()).toBe(1);
    expect(ui.status().textContent).toBe('1 result available');
  });

  it('ignores case and accents, because nobody types them to find a name', () => {
    items.set([...FRUITS, { value: 'ec', label: 'Éclair' }]);
    const ui = comboDemo();
    type(ui.input(), 'ecl');
    expect(ui.labels()).toEqual(['Éclair']);
  });

  it('announces the empty state instead of leaving the list silently empty', () => {
    const ui = comboDemo();
    type(ui.input(), 'zzz');

    expect(ui.options()).toHaveLength(0);
    expect(ui.combo.isEmpty()).toBe(true);
    // Said out loud, not only drawn: a list that quietly becomes empty is a
    // list a screen reader user is still being told has options in it.
    expect(ui.status().textContent).toBe('No results');
    expect(ui.empty()?.textContent).toBe('No results');
  });

  it('takes an override for both messages', () => {
    comboOptions = {
      labels: { empty: 'Rien', results: (n) => `${n} fruits` },
    };
    const ui = comboDemo();
    type(ui.input(), 'zzz');
    expect(ui.status().textContent).toBe('Rien');

    type(ui.input(), 'ch');
    expect(ui.status().textContent).toBe('1 fruits');
  });

  it('shows the whole list again when reopened after a choice', () => {
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ch');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(input.value).toBe('Cherry');

    press(ui.toggle());
    // The single most common way this pattern is got wrong: reopening a
    // combobox holding "Cherry" and being shown only Cherry.
    expect(ui.options()).toHaveLength(FRUITS.length);
    expect(ui.combo.isFiltering()).toBe(false);
  });

  it('keeps the count honest when the list changes underneath it', async () => {
    const ui = comboDemo();
    openCombo(ui);
    expect(ui.combo.optionCount()).toBe(ENABLED);

    items.set(FRUITS.slice(0, 2));
    await settle();
    // Counted from the DOM through an observer, because the list is the
    // consumer's to render and this component is never told what went into it.
    expect(ui.combo.optionCount()).toBe(2);
    expect(ui.status().textContent).toBe('2 results available');
  });
});

describe('a combobox that searches', () => {
  interface Search {
    ui: ComboHarness;
    resolve(query: string, results: readonly Fruit[]): void;
    pending(): string[];
  }

  function searchDemo(): Search {
    const gates = new Map<string, ReturnType<typeof deferred<readonly Fruit[]>>>();
    fromSearch = true;
    comboOptions = {
      ...comboOptions,
      searchDebounce: 0,
      search: (request) => {
        const gate = deferred<readonly Fruit[]>();
        gates.set(request.source, gate);
        return gate.promise;
      },
    };

    const ui = comboDemo();
    return {
      ui,
      resolve: (query, results) => gates.get(query)?.resolve(results),
      pending: () => [...gates.keys()],
    };
  }

  it('announces that it is loading, and then the count', async () => {
    const { ui, resolve } = searchDemo();
    type(ui.input(), 'ch');

    expect(ui.combo.isLoading()).toBe(true);
    expect(ui.status().textContent).toBe('Loading…');

    resolve('ch', [FRUITS[3]!]);
    await settle();
    expect(ui.labels()).toEqual(['Cherry']);
    expect(ui.status().textContent).toBe('1 result available');
  });

  it('does not claim there are no results while it is still asking', () => {
    const { ui } = searchDemo();
    type(ui.input(), 'ch');

    // "Open, settled, and showing nothing" — a search in flight is not
    // settled, and a combobox that flashes "No results" between every
    // keystroke and its answer is telling the user something untrue.
    expect(ui.combo.isEmpty()).toBe(false);
    expect(ui.empty()).toBeNull();
  });

  it('does not claim there are no results in the quiet time before it asks', () => {
    fromSearch = true;
    // The documented default rather than the zero the rest of these pin: the
    // resource is not told about a keystroke until the debounce fires, so for
    // the whole quarter second after every one of them it is not loading and
    // the list is empty.
    comboOptions = { searchDebounce: 250, search: () => new Promise<readonly Fruit[]>(() => {}) };
    const ui = comboDemo();

    type(ui.input(), 'ch');
    expect(ui.combo.isLoading()).toBe(false);
    expect(ui.combo.isEmpty()).toBe(false);
    expect(ui.empty()).toBeNull();
    // And a live region politely reading "No results" out over a search that
    // has not been made is the same untruth said aloud.
    expect(ui.status().textContent).toBe('Loading…');
  });

  it('does not read an answer to the last keystroke as the answer to this one', async () => {
    const pending: { source: string; resolve: (results: readonly Fruit[]) => void }[] = [];
    fromSearch = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    comboOptions = {
      searchDebounce: 250,
      search: (request) =>
        new Promise<readonly Fruit[]>((resolve) => pending.push({ source: request.source, resolve })),
    };
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'c');
    vi.advanceTimersByTime(300);
    await settle();
    expect(pending.map((request) => request.source)).toEqual(['c']);

    // A second character, and the answer to the first arriving inside the quiet
    // time before the second goes out.
    type(input, 'ch');
    pending[0]!.resolve([]);
    await settle();

    // "No results" here is an answer to a question nobody has asked yet: the
    // request for "ch" is still sitting on the debounce timer.
    expect(pending.map((request) => request.source)).toEqual(['c']);
    expect(ui.combo.isEmpty()).toBe(false);
    expect(ui.empty()).toBeNull();
    expect(ui.status().textContent).toBe('Loading…');

    vi.advanceTimersByTime(300);
    await settle();
    expect(pending.map((request) => request.source)).toEqual(['c', 'ch']);
  });

  it('asks for the whole list up front when there is no `defaultValue` to seed', async () => {
    const asked: string[] = [];
    fromSearch = true;
    // The documented "characters before a search goes out at all: 0", which is
    // how a caller loads every option once and lets the popup narrow it.
    comboOptions = {
      minLength: 0,
      searchDebounce: 0,
      search: (request) => {
        asked.push(request.source);
        return Promise.resolve<readonly Fruit[]>(FRUITS);
      },
    };
    const ui = comboDemo();
    await settle();
    expect(asked).toEqual(['']);

    press(ui.toggle());
    await settle();
    expect(ui.labels()).toEqual(FRUITS.map((fruit) => fruit.label));
    expect(ui.combo.isEmpty()).toBe(false);
  });

  it('asks for the whole list up front even when it starts holding a value', async () => {
    const asked: string[] = [];
    const aborted: string[] = [];
    fromSearch = true;
    comboOptions = {
      defaultValue: 'ba',
      labelFor: () => 'Banana',
      minLength: 0,
      searchDebounce: 0,
      search: (request) => {
        asked.push(request.source);
        request.signal.addEventListener('abort', () => aborted.push(request.source));
        return Promise.resolve<readonly Fruit[]>(FRUITS);
      },
    };
    const ui = comboDemo();
    await settle();

    // The box saying "Banana" is this component answering, not the user asking:
    // the question is still the empty one a zero minimum length starts with.
    // Reading the two as one string is what threw the preload away and left the
    // popup announcing "No results" for a search that was cancelled.
    expect(ui.input().value).toBe('Banana');
    expect(asked).toEqual(['']);
    expect(aborted).toEqual([]);

    press(ui.toggle());
    await settle();
    expect(ui.labels()).toEqual(FRUITS.map((fruit) => fruit.label));
    expect(ui.combo.isEmpty()).toBe(false);
    expect(ui.empty()).toBeNull();
  });

  it('keeps a search in flight when the popup is opened by hand', async () => {
    const aborted: string[] = [];
    const gate = deferred<readonly Fruit[]>();
    fromSearch = true;
    comboOptions = {
      searchDebounce: 0,
      search: (request) => {
        request.signal.addEventListener('abort', () => aborted.push(request.source));
        return gate.promise;
      },
    };
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ch');
    key(input, 'Escape');
    press(ui.toggle());
    gate.resolve([FRUITS[3]!]);
    await settle();

    // Opening the popup says nothing about the question already asked, and
    // throwing the request away leaves the list the user opened saying "No
    // results" for an answer that was on its way.
    expect(aborted).toEqual([]);
    expect(ui.labels()).toEqual(['Cherry']);
    expect(ui.combo.isEmpty()).toBe(false);
  });

  it('asks nothing, and announces nothing, for a value it was handed', async () => {
    const asked: string[] = [];
    const seen: string[] = [];
    const names = new Signal.State<Record<string, string>>({});
    fromSearch = true;
    comboOptions = {
      defaultValue: 'ba',
      searchDebounce: 0,
      labelFor: (value) => names.get()[value],
      onInputValueChange: (value) => seen.push(value),
      search: (request) => {
        asked.push(request.source);
        return Promise.resolve<readonly Fruit[]>([]);
      },
    };
    const ui = comboDemo();
    await settle();

    // Filling the box from `defaultValue` is not typing in it: a search for the
    // identifier behind a value nobody has touched is a request the user never
    // asked for, and `onInputValueChange` is for what they type.
    expect(asked).toEqual([]);
    expect(seen).toEqual([]);
    // And nothing can name it yet, so there is nothing in the box to search for
    // even if it were a question.
    expect(ui.input().value).toBe('');

    names.set({ ba: 'Banana' });
    await settle();
    // And the name arriving is the same thing again from the other end: the box
    // fills in, the question nobody asked is still not asked, and text the user
    // has never entered is still not reported as text they entered.
    expect(ui.input().value).toBe('Banana');
    expect(asked).toEqual([]);
    expect(seen).toEqual([]);

    type(ui.input(), 'ch');
    await settle();
    expect(asked).toEqual(['ch']);
    expect(seen).toEqual(['ch']);
  });

  it('asks for text put in the box from outside, the way it asks for typing', async () => {
    const asked: string[] = [];
    fromSearch = true;
    comboOptions = {
      searchDebounce: 0,
      search: (request) => {
        asked.push(request.source);
        return Promise.resolve<readonly Fruit[]>(
          FRUITS.filter((fruit) => fruit.label.toLowerCase().startsWith(request.source)),
        );
      },
    };
    const ui = comboDemo();

    // A query restored with the session, or a "search for this" button beside
    // the field: no key has been pressed, and there is still a question in the
    // box.
    ui.combo.setInputValue('ch');
    ui.combo.open();
    await settle();

    expect(asked).toEqual(['ch']);
    expect(ui.labels()).toEqual(['Cherry']);
    // A popup that answers "No results" for a search nothing ever made says the
    // untruth on screen and again in the live region.
    expect(ui.combo.isEmpty()).toBe(false);
    expect(ui.empty()).toBeNull();
    expect(ui.status().textContent).toBe('1 result available');
  });

  it('lets a fast later answer stand over a slow earlier one', async () => {
    const { ui, resolve, pending } = searchDemo();
    const input = ui.input();

    type(input, 'ca');
    type(input, 'cat');
    expect(pending()).toEqual(['ca', 'cat']);

    resolve('cat', [{ value: 'c2', label: 'Cat results' }]);
    await settle();
    resolve('ca', [{ value: 'c1', label: 'Ca results' }]);
    await settle();

    // Results for "ca" landing under the word "cat" is the single commonest
    // async combobox defect, and it reads to everyone as a backend bug.
    expect(ui.labels()).toEqual(['Cat results']);
    expect(ui.status().textContent).toBe('1 result available');
  });

  it('asks nothing until there is enough typed to ask about', () => {
    comboOptions = { minLength: 2 };
    const { ui, pending } = searchDemo();

    type(ui.input(), 'c');
    expect(pending()).toEqual([]);
    type(ui.input(), 'ch');
    expect(pending()).toEqual(['ch']);
  });

  it('stops the request when the component goes away mid-search', async () => {
    const aborted: string[] = [];
    fromSearch = true;
    comboOptions = {
      searchDebounce: 0,
      search: (request) => {
        request.signal.addEventListener('abort', () => aborted.push(request.source));
        return new Promise<readonly Fruit[]>(() => {});
      },
    };
    const ui = comboDemo();

    type(ui.input(), 'ch');
    dispose(ui.handle);
    await settle();

    expect(aborted).toContain('ch');
  });
});

describe('committing a value', () => {
  it('takes the highlighted option on Enter, closes, and fills the box', () => {
    const ui = comboDemo();
    const input = openCombo(ui);

    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    expect(key(input, 'Enter')).toBe(true);

    expect(ui.combo.value()).toBe('ba');
    expect(input.value).toBe('Banana');
    expect(ui.combo.isOpen()).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it('takes an option pressed with the pointer, and fills the box the same way', () => {
    const ui = comboDemo();
    const input = ui.input();
    type(input, 'ch');
    press(ui.option('ch'));

    // The pointer route goes through the core rather than through the key
    // handler, and is the one that would otherwise leave the query sitting in
    // the box under the chosen value.
    expect(ui.combo.value()).toBe('ch');
    expect(input.value).toBe('Cherry');
    expect(ui.combo.isFiltering()).toBe(false);
  });

  it('leaves Enter to the form when there is nothing to take', () => {
    const ui = comboDemo();
    const input = ui.input();
    type(input, 'zzz');

    // Swallowing it here is how a combobox stops a one-field form ever being
    // submitted.
    expect(key(input, 'Enter')).toBe(false);
    expect(ui.combo.value()).toBeNull();
  });

  it('refuses a value that matches nothing unless custom values are allowed', () => {
    const ui = comboDemo();
    type(ui.input(), 'Kumquat');
    key(ui.input(), 'Enter');
    expect(ui.combo.value()).toBeNull();

    dispose(ui.handle);
    comboOptions = { allowCustomValue: true };
    const free = comboDemo();
    type(free.input(), 'Kumquat');
    expect(key(free.input(), 'Enter')).toBe(true);
    expect(free.combo.value()).toBe('Kumquat');
    expect(free.combo.isOpen()).toBe(false);
  });

  it('does not swap the option chosen for its own label when focus leaves', () => {
    comboOptions = { allowCustomValue: true, name: 'fruit' };
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ch');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(ui.combo.value()).toBe('ch');
    expect(input.value).toBe('Cherry');

    input.dispatchEvent(new FocusEvent('blur'));
    flushSync();

    // The box holds the label of what was chosen, so every blur after a
    // successful pick offers "Cherry" to a combobox that will take anything.
    // Committing it replaces the option's id with its human text, and the
    // form submits a different thing than the one the user pressed.
    expect(ui.combo.value()).toBe('ch');
    expect(new FormData(ui.form()).get('fruit')).toBe('ch');
    expect(input.value).toBe('Cherry');
  });

  it('does not take a label typed back over the option it came from', () => {
    comboOptions = { allowCustomValue: true, name: 'fruit' };
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ch');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(ui.combo.value()).toBe('ch');

    // Selecting the box and typing its contents again is a question, and this
    // combobox takes anything — but "Cherry" is the name of what is already
    // held, so taking it would swap the option's id for its human text and the
    // form would submit a different thing than the one the user pressed.
    type(input, 'Cherry');
    input.dispatchEvent(new FocusEvent('blur'));
    flushSync();

    expect(ui.combo.value()).toBe('ch');
    expect(new FormData(ui.form()).get('fruit')).toBe('ch');
    expect(input.value).toBe('Cherry');
  });

  it('keeps a value it took from the box readable, having named it after itself', () => {
    comboOptions = { allowCustomValue: true, name: 'fruit' };
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'Kumquat');
    expect(key(input, 'Enter')).toBe(true);
    expect(ui.combo.value()).toBe('Kumquat');
    expect(new FormData(ui.form()).get('fruit')).toBe('Kumquat');

    // Nothing else on this page will ever say what it is called: it is not in
    // the catalogue, no option will render for it, and `labelFor` was written
    // against a list it is not on. The text the user wrote is its name and the
    // only one it will have — without it the box goes empty over a value the
    // form still submits, and the chips and announcements have nothing to say.
    expect(input.value).toBe('Kumquat');
    expect(ui.combo.inputValue()).toBe('Kumquat');
    expect(ui.combo.labelOf('Kumquat')).toBe('Kumquat');
  });

  it('takes the option whose name was typed, rather than the name as a value', () => {
    comboOptions = { allowCustomValue: true, name: 'fruit' };
    const ui = comboDemo();
    const input = ui.input();

    // Nothing is highlighted, so Enter commits what was typed — and what was
    // typed is Cherry's name, not a value of its own. Taking the string would
    // put the label where the option's identifier belongs, which is the swap
    // the tests above refuse arriving by another route.
    type(input, 'Cherry');
    expect(ui.combo.activeValue()).toBeNull();
    key(input, 'Enter');
    expect(ui.combo.value()).toBe('ch');
    expect(new FormData(ui.form()).get('fruit')).toBe('ch');
    expect(input.value).toBe('Cherry');

    // Leaving the box commits by the same rule.
    ui.combo.clear();
    flushSync();
    type(input, 'Damson');
    input.dispatchEvent(new FocusEvent('blur'));
    flushSync();
    expect(ui.combo.value()).toBe('da');
    expect(new FormData(ui.form()).get('fruit')).toBe('da');
  });

  it('does not take an option it cannot choose by having its name typed', () => {
    comboOptions = { allowCustomValue: true, name: 'fruit' };
    const ui = comboDemo();
    const input = ui.input();

    // Blueberry is disabled: its identifier is a choice the list refuses, and
    // its name is the swap above. Nothing is taken, so the question stands.
    type(input, 'Blueberry');
    key(input, 'Enter');
    expect(ui.combo.value()).toBeNull();
    expect(new FormData(ui.form()).get('fruit')).toBe('');
    expect(input.value).toBe('Blueberry');
  });

  it('takes the highlighted option when focus leaves, before the text typed', () => {
    comboOptions = { allowCustomValue: true, name: 'fruit' };
    const ui = comboDemo();
    const input = ui.input();

    // Enter and Tab take what is highlighted first, and leaving the box is a
    // commit like either of them.
    type(input, 'Cher');
    key(input, 'ArrowDown');
    expect(ui.combo.activeValue()).toBe('ch');
    input.dispatchEvent(new FocusEvent('blur'));
    flushSync();

    expect(ui.combo.value()).toBe('ch');
    expect(new FormData(ui.form()).get('fruit')).toBe('ch');
    expect(input.value).toBe('Cherry');
  });

  it('takes the option an inline completion proposed when focus leaves', () => {
    comboOptions = { allowCustomValue: true, autocomplete: 'both', name: 'fruit' };
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    // The box reads "Cherry" with "rry" selected. Committing the "Ch" behind it
    // would leave the box saying one thing and the form submitting another.
    type(input, 'Ch');
    expect(input.value).toBe('Cherry');
    input.dispatchEvent(new FocusEvent('blur'));
    flushSync();

    expect(ui.combo.value()).toBe('ch');
    expect(new FormData(ui.form()).get('fruit')).toBe('ch');
    expect(input.value).toBe('Cherry');
  });

  it('leaves the typed text alone when the pointer only crossed the list', () => {
    // Every option is listed while the question matches none of them, so the
    // pointer has something to pass over on its way to another control.
    comboOptions = { allowCustomValue: true, filter: () => true, name: 'fruit' };
    const ui = comboDemo();
    const input = ui.input();
    input.focus();
    type(input, 'Kumquat');

    // Hovering highlights, and nothing takes the highlight away when the
    // pointer leaves: a highlight nobody asked for must not commit anything.
    ui.option('ap').dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    flushSync();
    expect(ui.combo.activeValue()).toBe('ap');

    input.dispatchEvent(new FocusEvent('blur'));
    flushSync();

    expect(ui.combo.value()).toBe('Kumquat');
    expect(new FormData(ui.form()).get('fruit')).toBe('Kumquat');
  });

  it('takes the highlighted option on Tab and carries on out', () => {
    const ui = comboDemo();
    const input = openCombo(ui);
    key(input, 'ArrowDown');

    expect(key(input, 'Tab')).toBe(false);
    expect(ui.combo.value()).toBe('ap');
    expect(ui.combo.isOpen()).toBe(false);
  });

  it('submits through a real hidden input', () => {
    comboOptions = { name: 'fruit' };
    const ui = comboDemo();

    expect(new FormData(ui.form()).get('fruit')).toBe('');
    type(ui.input(), 'ch');
    key(ui.input(), 'ArrowDown');
    key(ui.input(), 'Enter');

    expect(new FormData(ui.form()).get('fruit')).toBe('ch');
    expect(ui.native().getAttribute('aria-hidden')).toBe('true');
    expect(ui.native().getAttribute('tabindex')).toBe('-1');
  });

  it('empties both halves when cleared', () => {
    comboOptions = { name: 'fruit' };
    const ui = comboDemo();
    type(ui.input(), 'ch');
    key(ui.input(), 'ArrowDown');
    key(ui.input(), 'Enter');

    press(ui.clear());
    expect(ui.combo.value()).toBeNull();
    expect(ui.input().value).toBe('');
    expect(new FormData(ui.form()).get('fruit')).toBe('');
  });

  it('refuses to select while read-only, and leaves the list up to browse', () => {
    comboOptions = { name: 'fruit', readOnly: () => true, defaultValue: 'ch' };
    const ui = comboDemo();
    const input = openCombo(ui);
    expect(ui.combo.isOpen()).toBe(true);
    expect(input.value).toBe('Cherry');

    // Read-only is not disabled: the widget says `aria-readonly`, keeps its
    // tab stop and takes keystrokes, so the box can hold a question the whole
    // time it is refusing to answer one. Every refusal below is put to it with
    // that question standing, because a refusal that also emptied the box
    // would take away what the user is still typing.
    type(input, 'ban');
    expect(ui.combo.isFiltering()).toBe(true);
    expect(ui.labels()).toEqual(['Banana']);

    key(input, 'ArrowDown');
    key(input, 'Enter');
    // Nothing was taken, so nothing about the widget may say otherwise: a box
    // reading "Banana" over a form submitting `ch` is one lie, and a list that
    // collapses on the keystroke that took nothing is another — it says a
    // choice was made, and leaves a read-only widget's options unreadable.
    expect(ui.combo.value()).toBe('ch');
    expect(input.value).toBe('ban');
    expect(ui.combo.isOpen()).toBe(true);

    press(ui.option('ba'));
    // And the pointer answers it the same way, as it does everywhere else.
    expect(ui.combo.value()).toBe('ch');
    expect(input.value).toBe('ban');
    expect(ui.combo.isOpen()).toBe(true);

    key(input, 'Escape');
    // The first press is the popup's, and the text under it stands.
    expect(ui.combo.isOpen()).toBe(false);
    expect(input.value).toBe('ban');

    key(input, 'Escape');
    // Emptying the box is a change too, and one that would leave the widget
    // showing nothing over a value it still holds and still submits.
    expect(input.value).toBe('ban');
    expect(ui.combo.value()).toBe('ch');
    expect(new FormData(ui.form()).get('fruit')).toBe('ch');
  });

  it('refuses to remove a chip while read-only', () => {
    comboOptions = {
      name: 'fruit',
      multiple: true,
      readOnly: () => true,
      defaultValue: ['ap', 'ch'],
    };
    const ui = comboDemo();
    const submitted = () =>
      [...(ui.native() as HTMLSelectElement).selectedOptions].map((option) => option.value);

    // The chip buttons remove by calling `deselect`, which is on the surface
    // for exactly that. Every other way in refuses first and never reaches it,
    // so this is the one route by which a read-only widget can be made to drop
    // a value the form is still submitting.
    press(ui.removeButton('ap'));

    expect(ui.combo.values()).toEqual(['ap', 'ch']);
    expect(ui.chips()!.getAttribute('aria-label')).toBe('2 selected');
    expect(submitted()).toEqual(['ap', 'ch']);
  });
});

describe('choosing several, with chips', () => {
  beforeEach(() => {
    comboOptions = { multiple: true, name: 'fruit' };
  });

  it('lists the chips, counted, each with a button that names what it removes', () => {
    const ui = comboDemo();
    const input = ui.input();

    press(input);
    press(ui.option('ap'));
    press(ui.option('ch'));

    expect(ui.combo.values()).toEqual(['ap', 'ch']);
    expect(ui.chipLabels()).toEqual(['Apple', 'Cherry']);
    expect(ui.chips()!.getAttribute('role')).toBe('list');
    expect(ui.chips()!.getAttribute('aria-label')).toBe('2 selected');

    const remove = ui.removeButton('ap');
    // A tab stop each, rather than a roving tabindex the user has to discover.
    expect(remove.getAttribute('aria-label')).toBe('Remove Apple');
    expect(remove.getAttribute('tabindex')).toBe('0');
    expect(remove.type).toBe('button');

    press(remove);
    expect(ui.combo.values()).toEqual(['ch']);
  });

  it('empties the query after each choice, so the list is not narrowed to the new chip', () => {
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ap');
    key(input, 'ArrowDown');
    key(input, 'Enter');

    expect(ui.combo.values()).toEqual(['ap']);
    expect(input.value).toBe('');
    expect(ui.combo.isFiltering()).toBe(false);
  });

  it('leaves the popup open after a keyboard choice, as a pointer choice does', () => {
    const ui = comboDemo();
    const input = ui.input();

    press(input);
    press(ui.option('ap'));
    // The pointer route honours `closeOnSelect`, which defaults to false here:
    // picking three things should not mean opening the list three times.
    expect(ui.combo.isOpen()).toBe(true);

    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(ui.combo.values()).toEqual(['ap', 'ba']);
    expect(ui.combo.isOpen()).toBe(true);
  });

  it('takes the highlighted option on Tab, and never takes a chip away', () => {
    comboOptions = { multiple: true, name: 'fruit', defaultValue: ['ap'] };
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    // Down opens on the first option, which is the one already held: leaving
    // from here is leaving, not a request to drop Apple.
    key(input, 'ArrowDown');
    expect(ui.combo.activeValue()).toBe('ap');
    expect(key(input, 'Tab')).toBe(false);
    expect(ui.combo.values()).toEqual(['ap']);
    expect(ui.combo.isOpen()).toBe(false);

    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    key(input, 'Tab');
    expect(ui.combo.values()).toEqual(['ap', 'ba']);
  });

  it('answers a press that removes a value the way both routes answer one that adds', () => {
    comboOptions = { multiple: true, closeOnSelect: true, name: 'fruit' };
    const pointer = comboDemo();

    press(pointer.input());
    press(pointer.option('ap'));
    expect(pointer.combo.isOpen()).toBe(false);

    press(pointer.input());
    press(pointer.option('ap'));
    // `closeOnSelect` is about the press, not about which way it went. The
    // keyboard closes here, and a pointer that left the list up would be one
    // gesture answered two ways — in the one configuration the option exists to
    // express.
    expect(pointer.combo.values()).toEqual([]);
    expect(pointer.combo.isOpen()).toBe(false);

    dispose(pointer.handle);
    const keyboard = comboDemo();
    const input = keyboard.input();

    press(input);
    press(keyboard.option('ap'));
    press(input);
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(keyboard.combo.values()).toEqual([]);
    expect(keyboard.combo.isOpen()).toBe(false);
  });

  it('carries every value chosen into the control that submits, not only the first', () => {
    const ui = comboDemo();
    const submitted = () =>
      [...(ui.native() as HTMLSelectElement).selectedOptions].map((option) => option.value);

    press(ui.input());
    press(ui.option('ap'));
    press(ui.option('ch'));
    expect(ui.combo.values()).toEqual(['ap', 'ch']);

    // An `<input>` holds one string, so the control behind a multiple is a
    // `<select multiple>` fed one option per chosen value. A form that
    // receives Apple alone is wrong in a way nobody can see in the payload.
    //
    // Asserted through `selectedOptions` — what the browser's own serialiser
    // walks — rather than through `FormData`, because happy-dom reads a single
    // option out of a multiple select whatever the DOM says.
    expect((ui.native() as HTMLSelectElement).multiple).toBe(true);
    expect(submitted()).toEqual(['ap', 'ch']);

    press(ui.removeButton('ap'));
    expect(submitted()).toEqual(['ch']);
  });

  it('leaves an `<input>` behind a multiple empty rather than half right', () => {
    inputBacked = true;
    const ui = comboDemo();

    press(ui.input());
    press(ui.option('ap'));
    press(ui.option('ch'));
    expect(ui.combo.values()).toEqual(['ap', 'ch']);

    // The unsupported markup, rendered on purpose. A form that receives Apple
    // where Apple and Cherry were chosen is wrong in a way nobody can see in
    // the payload; empty fails the required check and says so.
    expect(new FormData(ui.form()).get('fruit')).toBe('');
  });

  it('removes the last chip on Backspace, and only from an empty box', () => {
    const ui = comboDemo();
    const input = ui.input();

    press(input);
    press(ui.option('ap'));
    press(ui.option('ch'));

    type(input, 'da');
    // Never eats a character the user meant to type.
    expect(key(input, 'Backspace')).toBe(false);
    expect(ui.combo.values()).toEqual(['ap', 'ch']);

    type(input, '');
    key(input, 'Backspace');
    expect(ui.combo.values()).toEqual(['ap']);
  });

  it('keeps its chips when Escape clears the box', () => {
    const ui = comboDemo();
    const input = ui.input();

    press(input);
    press(ui.option('ap'));
    type(input, 'ch');

    key(input, 'Escape');
    key(input, 'Escape');
    expect(input.value).toBe('');
    // Chips go through Backspace and the chip buttons, not through Escape.
    expect(ui.combo.values()).toEqual(['ap']);
  });

  it('lets a name that arrives late reach the chips of a multiple', async () => {
    const names = new Signal.State<Record<string, string>>({});
    comboOptions = {
      multiple: true,
      name: 'fruit',
      defaultValue: ['ba', 'ch'],
      labelFor: (value) => names.get()[value],
    };
    const ui = comboDemo();

    // Nothing can name either of them yet, and a multiple shows its values on
    // the chips rather than in the box, so the chips are where the identifier
    // shows through — the one place it is better than nothing, since a chip
    // with no text is a chip nobody can aim the remove button at.
    expect(ui.chipLabels()).toEqual(['ba', 'ch']);
    expect(ui.input().value).toBe('');

    names.set({ ba: 'Banana', ch: 'Cherry' });
    await settle();
    // One registry for every value, whether the widget holds one or several.
    // The catalogue arriving names them all, and the `<select multiple>` behind
    // the widget is rendered from those names rather than consulted for them —
    // reading it back would only return what this component already said, and
    // saying it back would make the identifier permanent.
    expect(ui.chipLabels()).toEqual(['Banana', 'Cherry']);
    expect(ui.removeButton('ba').getAttribute('aria-label')).toBe('Remove Banana');
  });

  it('says the popup allows more than one', () => {
    const ui = comboDemo();
    openCombo(ui);
    expect(ui.listbox()!.getAttribute('aria-multiselectable')).toBe('true');
  });
});

describe('completing the textbox inline', () => {
  beforeEach(() => {
    comboOptions = { autocomplete: 'both' };
  });

  it('completes from the first match and selects the part not typed', () => {
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    type(input, 'ap');
    expect(input.value).toBe('Apple');
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(5);
    // The completion is a proposal the user is looking at, so Enter should
    // take the option it came from.
    expect(ui.combo.activeValue()).toBe('ap');
    expect(input.getAttribute('aria-autocomplete')).toBe('both');
  });

  it('completes from an answer that arrives after the keystroke that asked', async () => {
    const gate = deferred<readonly Fruit[]>();
    fromSearch = true;
    comboOptions = { autocomplete: 'both', searchDebounce: 0, search: () => gate.promise };
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    type(input, 'a');
    // Nothing has been rendered to complete from yet, and the keystroke that
    // opened the popup is long gone by the time the list exists.
    expect(input.value).toBe('a');

    gate.resolve([{ value: 'ap', label: 'Apple' }]);
    await settle();

    expect(input.value).toBe('Apple');
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(5);
    expect(ui.combo.activeValue()).toBe('ap');
  });

  it('completes from a list the consumer narrowed themselves', () => {
    ownFilter = true;
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    // Whoever did the narrowing, what is in the popup is what there is to
    // complete from.
    type(input, 'ap');
    expect(input.value).toBe('Apple');
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(5);
    expect(ui.combo.activeValue()).toBe('ap');
  });

  it('does not complete from a list that turns up with no keystroke behind it', async () => {
    // A consumer who narrows the list in their own code and never goes near
    // `matches` — so nothing this component can see says whether the popup is
    // empty because the filter emptied it or because the data is late.
    ownFilter = true;
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    type(input, 'q');
    expect(input.value).toBe('q');
    expect(ui.labels()).toEqual([]);

    items.set([...FRUITS, { value: 'qu', label: 'Quince' }]);
    await settle();

    // A poll or a websocket changing the options is not a keystroke, and the
    // keystroke it would be answering was dealt with when the popup rendered
    // empty. Completing here rewrites the textbox under a caret nobody moved.
    expect(input.value).toBe('q');
    expect(input.selectionEnd).toBe(1);
    expect(ui.combo.activeValue()).toBeNull();
  });

  it('does not complete a keystroke the list has already answered', async () => {
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    type(input, 'q');
    // The list is here and nothing in it starts with that, which is an answer:
    // there is no completion for this keystroke.
    expect(input.value).toBe('q');

    items.set([...FRUITS, { value: 'qu', label: 'Quince' }]);
    await settle();

    // A poll or a websocket changing the options is not a keystroke. Completing
    // from one rewrites the textbox under a caret nobody moved, and moves
    // virtual focus onto an option the user never asked for.
    expect(input.value).toBe('q');
    expect(input.selectionEnd).toBe(1);
    expect(ui.combo.activeValue()).toBeNull();
  });

  it('does not complete after a deletion, or the box can never be emptied', () => {
    const ui = comboDemo();
    const input = ui.input();

    // Two keystrokes, because the first one is the one that opens the popup.
    type(input, 'a');
    type(input, 'ap');
    expect(input.value).toBe('Apple');

    // What Backspace over the selected completion leaves behind.
    type(input, 'a');
    expect(input.value).toBe('a');
    expect(ui.combo.activeValue()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// What has to be given back
// ---------------------------------------------------------------------------

describe('cleaning up', () => {
  it('leaves nothing on the dismissal stack when unmounted while open', () => {
    expect(dismissStackSize()).toBe(0);
    const ui = comboDemo();
    openCombo(ui);
    expect(dismissStackSize()).toBe(1);

    dispose(ui.handle);
    // A layer left behind swallows the next Escape on the page, from a
    // component that is no longer on it.
    expect(dismissStackSize()).toBe(0);
  });

  it('stops watching the document for a direction change', () => {
    expect(directionWatcherCount()).toBe(0);
    const ui = comboDemo();
    expect(directionWatcherCount()).toBe(1);

    dispose(ui.handle);
    expect(directionWatcherCount()).toBe(0);
  });

  it('gives up the dismissal layer as soon as the popup closes', () => {
    const ui = comboDemo();
    const input = openCombo(ui);
    expect(dismissStackSize()).toBe(1);

    key(input, 'Escape');
    expect(dismissStackSize()).toBe(0);
  });
});

describe('where the popup is anchored', () => {
  it('rides the control by default', () => {
    const ui = comboDemo();
    openCombo(ui);

    const name = ui.input().style.getPropertyValue('anchor-name');
    expect(name).not.toBe('');
    expect(ui.listbox()!.style.getPropertyValue('position-anchor')).toBe(name);
    expect(ui.wrapper().style.getPropertyValue('anchor-name')).toBe('');
  });

  it('moves onto the field wrapper when one is named', () => {
    anchored = true;
    const ui = comboDemo();
    openCombo(ui);

    // A combobox with chips is wider than its textbox, and a popup lined up
    // with the textbox alone sits under the middle of the field.
    const name = ui.wrapper().style.getPropertyValue('anchor-name');
    expect(name).not.toBe('');
    expect(ui.listbox()!.style.getPropertyValue('position-anchor')).toBe(name);
    // Named once, or two elements claim the same anchor.
    expect(ui.input().style.getPropertyValue('anchor-name')).toBe('');
  });
});

describe('right to left', () => {
  it('mirrors the popup along the inline axis and nothing else', () => {
    host.setAttribute('dir', 'rtl');
    const ui = comboDemo();
    openCombo(ui);

    // `bottom-start` means the popup's start edge lines up with the field's,
    // and which edge that is is the whole of what direction changes.
    expect(ui.listbox()!.style.getPropertyValue('position-area')).toBe('bottom span-left');
    expect(ui.combo.anchor.direction()).toBe('rtl');
  });

  it('lines up the other way when nothing says otherwise', () => {
    const ui = comboDemo();
    openCombo(ui);
    expect(ui.listbox()!.style.getPropertyValue('position-area')).toBe('bottom span-right');
  });

  it('does not mirror the arrow keys, which run down a vertical list', () => {
    host.setAttribute('dir', 'rtl');
    const ui = comboDemo();
    const input = openCombo(ui);

    key(input, 'ArrowDown');
    expect(ui.combo.activeValue()).toBe('ap');
    key(input, 'ArrowDown');
    expect(ui.combo.activeValue()).toBe('ba');
  });
});

// ---------------------------------------------------------------------------
// Guards nothing held
//
// Found by mutation rather than by reading: deleting each guard below left the
// suite green, so nothing distinguished a widget that enforced its own options
// and disabled state from one that ignored them. The code was right in every
// case — what was missing was anything that would notice if it stopped being.
//
// These are worth more than their size suggests, because every one of them is
// on the public surface. `toggleValue`, `clear` and `commitCustomValue` are
// methods a consumer calls directly, so the guard inside each is the only
// thing between a disabled widget and a value that changed anyway; and
// `closeOnEscape` and `closeOnOutsidePointer` are options whose whole content
// is the guard that reads them.
// ---------------------------------------------------------------------------

describe('what a disabled or read-only combobox refuses', () => {
  it('does not take a value off', () => {
    // Both halves are guarded twice: adding routes through `select` and
    // removing through `deselect`, and each refuses on its own. So the guard
    // at the top of `toggleValue` is redundant and no test can distinguish it
    // — this asserts the behaviour, not that line.
    comboOptions = { multiple: true, defaultValue: ['ch'], disabled: () => true };
    const ui = comboDemo();
    expect(ui.combo.values()).toEqual(['ch']);

    ui.combo.toggleValue('ch');
    expect(ui.combo.values()).toEqual(['ch']);
  });

  it('does not take a value off while read-only either', () => {
    comboOptions = { multiple: true, defaultValue: ['ch'], readOnly: () => true };
    const ui = comboDemo();

    ui.combo.toggleValue('ch');
    expect(ui.combo.values()).toEqual(['ch']);
  });

  it('does not clear what is held, where `setValues` beneath it has no guard', () => {
    // The guard in `clear` is the only one on this path: `setValues` refuses a
    // write that changes nothing, and nothing else.
    comboOptions = { defaultValue: 'ch', disabled: () => true };
    const ui = comboDemo();
    expect(ui.combo.value()).toBe('ch');

    ui.combo.clear();
    expect(ui.combo.value()).toBe('ch');
  });

  it('does not clear while read-only', () => {
    comboOptions = { defaultValue: 'ch', readOnly: () => true };
    const ui = comboDemo();

    ui.combo.clear();
    expect(ui.combo.value()).toBe('ch');
  });

  // Kept as a behavioural assertion rather than as cover for the guard in
  // `onTriggerClick`: that one is redundant with the guard in `openListbox`
  // below it, so nothing can tell whether it is there. Defence in depth, and
  // honest about being unobservable.
  it('does not open its list from the trigger', () => {
    comboOptions = { disabled: () => true };
    const ui = comboDemo();

    press(ui.toggle());
    expect(ui.combo.isOpen()).toBe(false);
  });

  it('does not open its list when asked directly', () => {
    comboOptions = { disabled: () => true };
    const ui = comboDemo();

    ui.combo.open();
    expect(ui.combo.isOpen()).toBe(false);
  });
});

describe('a reset that restores the value already held', () => {
  it('puts the value back into the element the platform blanked', async () => {
    // The case the select's own reset test cannot reach, because a `<select>`
    // is restored by its `selected` attributes while a combobox's `<input>` is
    // written by property. Resetting to the value the widget is already
    // holding changes no signal, so nothing re-runs — and the form goes on to
    // submit an empty string while `value()` reports the value.
    comboOptions = { name: 'fruit', defaultValue: 'ba' };
    const ui = comboDemo();
    expect(ui.combo.value()).toBe('ba');
    expect(new FormData(ui.form()).get('fruit')).toBe('ba');

    ui.form().reset();
    await settle();

    expect(ui.combo.value()).toBe('ba');
    expect(new FormData(ui.form()).get('fruit')).toBe('ba');
  });

  it('still follows a reset that does move the value', async () => {
    comboOptions = { name: 'fruit', defaultValue: 'ba' };
    const ui = comboDemo();
    const input = openCombo(ui);
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(ui.combo.value()).not.toBe('ba');

    ui.form().reset();
    await settle();

    expect(ui.combo.value()).toBe('ba');
    expect(new FormData(ui.form()).get('fruit')).toBe('ba');
  });
});

describe('an option whose whole content is the guard that reads it', () => {
  it('takes no custom value when the widget was not told to allow one', () => {
    // Reachable directly, and the guard inside is the only refusal: the one
    // call site that checks `allowCustomValue` before calling is not the only
    // way in, because the method is on the public surface.
    comboOptions = {};
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'Kumquat');
    ui.combo.commitCustomValue();
    expect(ui.combo.value()).toBeNull();
  });

  it('stays open on Escape when told not to close on it', () => {
    comboOptions = { closeOnEscape: false };
    const ui = comboDemo();
    const input = openCombo(ui);
    expect(ui.combo.isOpen()).toBe(true);

    key(input, 'Escape');
    expect(ui.combo.isOpen()).toBe(true);
  });

  it('stays open on an outside press when told not to close on one', () => {
    // The option had no test of any kind — its name appeared nowhere in this
    // file. It is enforced where the layer is configured, by not listening for
    // outside presses at all, which makes the matching branch in the dismiss
    // callback unreachable rather than merely uncovered. The escape branch
    // beside it is not: `escape: true` is always claimed so that a layer which
    // will not close still stops the press reaching the one beneath it.
    comboOptions = { closeOnOutsidePointer: false };
    const ui = comboDemo();
    openCombo(ui);
    expect(ui.combo.isOpen()).toBe(true);

    press(document.querySelector<HTMLElement>('#outside')!);
    expect(ui.combo.isOpen()).toBe(true);
  });

  it('still closes on an outside press by default, so the option is doing the work', () => {
    comboOptions = {};
    const ui = comboDemo();
    openCombo(ui);
    expect(ui.combo.isOpen()).toBe(true);

    press(document.querySelector<HTMLElement>('#outside')!);
    expect(ui.combo.isOpen()).toBe(false);
  });
});
