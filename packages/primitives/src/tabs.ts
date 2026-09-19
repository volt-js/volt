/**
 * Tabs — one tab list over one set of panels, to the WAI-ARIA tabs pattern.
 *
 * Headless: it owns the selection, the keyboard map and the ARIA wiring, and
 * returns prop objects to spread onto whatever markup the consumer writes.
 * Nothing here renders, and nothing here has an opinion about styling.
 *
 *   class Settings {
 *     list = new Signal.State<Element | null>(null);
 *     tabs = createTabs({ list: () => this.list.get(), label: 'Settings' });
 *   }
 *
 *   <div :ref="list" :spread="tabs.listProps()">
 *     <button :spread="tabs.tabProps('account')">Account</button>
 *     <button :spread="tabs.tabProps('billing')">Billing</button>
 *   </div>
 *   <div :spread="tabs.panelProps('account')">…</div>
 *   <div :spread="tabs.panelProps('billing')">…</div>
 *
 * The element it is given is the tab list, not a root wrapping list and panels
 * both. A panel very often holds a second tabs widget, and a query from a root
 * would gather that widget's tabs as members of the outer list.
 *
 * Selection follows the arrow keys by default, which is what APG recommends
 * while showing a panel is cheap. Where a panel costs a request, or its
 * contents move focus themselves, `activation: 'manual'` moves focus with the
 * arrows and selects on Enter or Space instead.
 *
 * A `<button>` used as a tab inside a form still needs `type="button"` from
 * the consumer. This cannot set it: a tab is as often a `<div>` or an `<a>`,
 * where the attribute means nothing at all.
 */

import { Signal, effect } from '@voltdev/core';
import { createCollection, ITEM_ATTRIBUTE } from './collection.js';
import { createRovingFocus } from './roving-focus.js';
import { createId } from './id.js';

const { untrack } = Signal.subtle;

/**
 * Where a tab records the value it stands for.
 *
 * Navigation happens over elements and selection over values, so one of them
 * has to be recoverable from the other, and the DOM is where both are true at
 * once.
 */
export const TAB_VALUE_ATTRIBUTE = 'data-volt-tab-value';

export type TabsOrientation = 'horizontal' | 'vertical';

/** Whether selection follows focus, or waits for Enter or Space. */
export type TabsActivation = 'automatic' | 'manual';

/**
 * A value in a spread object. Handlers are included because the keyboard map
 * is part of what this owns, and a consumer who has to remember to wire it up
 * is a consumer who will ship a tab list the arrow keys do nothing in.
 */
export type TabsPropValue = string | boolean | undefined | ((event: Event) => void);

export interface TabsProps {
  readonly [key: string]: TabsPropValue;
}

export interface TabsOptions {
  /** The tab list element, once rendered. The tabs are inside it. */
  list: () => Element | null | undefined;

  /**
   * Supply a signal to control the selection from outside. Without one it owns
   * its own state, which is what most callers want.
   */
  value?: Signal.State<string>;
  /**
   * Selected on first render. Leave it off and the first tab selects itself as
   * it renders, because a tab list with nothing selected shows no panel.
   */
  defaultValue?: string;

  /** Which arrows move between tabs. Default horizontal. */
  orientation?: TabsOrientation;
  /** Default automatic — the arrows select as they move. */
  activation?: TabsActivation;
  /** Wrap past the first and last tab. Default true. */
  loop?: boolean;

  /** Accessible name for the tab list. */
  label?: string;
  /** Id of an element naming the tab list, when that name is already on screen. */
  labelledBy?: string;

  onValueChange?: (value: string) => void;
}

export interface TabOptions {
  /**
   * Marks the tab `aria-disabled` rather than natively `disabled`, which means
   * nothing on the `<div>` or `<a>` a tab is as often rendered as. It stays in
   * the accessibility tree and is announced among the others, but the keyboard
   * cannot reach it on its own: the arrow keys skip it, and it cannot be
   * selected by keyboard or by click. A pointer press does put focus on it,
   * and the list's one tab stop follows focus, so while focus is there the
   * disabled tab holds it — as does a disabled tab the list was handed as its
   * value, which is what keeps a list whose selected tab is disabled reachable
   * by Tab at all.
   */
  disabled?: boolean;
}

export interface Tabs {
  /** The selected value. */
  value(): string;
  isSelected(value: string): boolean;
  /** Select a tab, unless that tab is disabled. */
  select(value: string): void;

  listProps(): TabsProps;
  tabProps(value: string, tab?: TabOptions): TabsProps;
  panelProps(value: string): TabsProps;
}

/** The per-tab things that have to stay the same object across renders. */
interface TabParts {
  readonly tabId: string;
  readonly panelId: string;
  /**
   * One listener per value, reused. `spread` re-applies its props on every
   * render, and `addEventListener` only ignores a repeat when it is handed the
   * same function — a fresh closure each render would stack listeners up and
   * a single click would select several times over.
   */
  readonly onClick: (event: Event) => void;
}

export function createTabs(options: TabsOptions): Tabs {
  const selected = options.value ?? new Signal.State(options.defaultValue ?? '');
  const orientation = options.orientation ?? 'horizontal';
  const activation = options.activation ?? 'automatic';

  /**
   * The tab that focus is on, which is the selected one only under automatic
   * activation. Held as a value rather than an element so that a tab list
   * re-rendering its items does not leave it pointing at a detached node.
   */
  const focused = new Signal.State<string | null>(null);

  const collection = createCollection(() => options.list());
  const parts = new Map<string, TabParts>();

  const setValue = (next: string) => {
    if (selected.get() === next) return;
    selected.set(next);
    options.onValueChange?.(next);
  };

  const valueOf = (el: Element | null | undefined): string | null =>
    el?.getAttribute(TAB_VALUE_ATTRIBUTE) ?? null;

  // Found by walking the collection rather than by a selector, because the
  // value is the application's own string: putting it in one would need
  // `CSS.escape`, a browser global that does not exist when rendering on a
  // server.
  const elementFor = (value: string): HTMLElement | null =>
    collection.all().find((el) => el.getAttribute(TAB_VALUE_ATTRIBUTE) === value) ?? null;

  const select = (value: string) => {
    const el = elementFor(value);
    // A tab disabled with `aria-disabled` stays focusable and still fires a
    // click, so refusing here is what actually makes it unselectable. The
    // collection decides what disabled means; this does not keep a second copy
    // of that rule.
    if (el && !collection.enabled().includes(el)) return;
    setValue(value);
  };

  const roving = createRovingFocus(
    collection,
    () => elementFor(focused.get() ?? selected.get()),
    (el) => {
      const value = valueOf(el);
      if (value === null) return;
      focused.set(value);
      if (activation === 'automatic') select(value);
    },
    {
      orientation,
      loop: options.loop !== false,
      // No typeahead: APG gives letters no meaning in a tab list, and the
      // labels are few and all on screen. Claiming the letter keys here would
      // only take them from whatever else on the page wants them.
      typeahead: false,
      onSelect: (item) => {
        const value = valueOf(item);
        if (value !== null) select(value);
      },
    },
  );

  const onKeyDown = (event: Event) => {
    if (!isKeyboardEvent(event)) return;
    // Only the keys the list actually consumed: an ArrowDown a horizontal list
    // did not claim must still scroll the page.
    if (roving.onKeyDown(event)) event.preventDefault();
  };

  const onFocusIn = (event: Event) => {
    const value = valueOf(tabFrom(event.target));
    if (value !== null) focused.set(value);
  };

  const onFocusOut = (event: Event) => {
    const next = isFocusEvent(event) ? event.relatedTarget : null;
    if (next instanceof Node && options.list()?.contains(next)) return;
    // Leaving the list hands the tab stop back to the selected tab: APG puts
    // focus on the tab that is showing when Tab comes back, not on wherever
    // the arrows were left under manual activation.
    focused.set(null);
  };

  const partsFor = (value: string): TabParts => {
    const existing = parts.get(value);
    if (existing) return existing;

    // Ids are minted per value rather than derived from it. A value is the
    // application's own string and may hold a space, and `aria-controls` takes
    // a space-separated list of ids — so "my tab" would point at two ids,
    // neither of which exists.
    const created: TabParts = {
      tabId: createId('tab'),
      panelId: createId('tabpanel'),
      onClick: () => select(value),
    };
    parts.set(value, created);
    return created;
  };

  // APG's tab list always has a tab selected; without this a consumer who
  // leaves `defaultValue` off gets tabs and no panel. The first tab is read
  // from the DOM because this is never handed the list of values — they arrive
  // one at a time, as each tab renders.
  effect(() => {
    const first = collection.first();
    if (!first) return;
    untrack(() => {
      if (selected.get() !== '') return;
      const value = valueOf(first);
      // A default is not a user action, so `onValueChange` stays quiet: an
      // application that saves the value on change should not record a write
      // nobody made.
      if (value !== null) selected.set(value);
    });
  });

  return {
    value: () => selected.get(),
    isSelected: (value) => selected.get() === value,
    select,

    listProps: () => ({
      role: 'tablist',
      'aria-orientation': orientation,
      // Emitted only when given: a name in the library's own language would be
      // wrong on most of the pages this ends up on.
      'aria-label': options.label,
      'aria-labelledby': options.labelledBy,
      'data-orientation': orientation,
      onkeydown: onKeyDown,
      // `focusin` and `focusout` rather than a listener per tab: they bubble,
      // so one pair on the list follows focus however it moved — arrow key,
      // click, or script.
      onfocusin: onFocusIn,
      onfocusout: onFocusOut,
    }),

    tabProps: (value, tab = {}) => {
      const { tabId, panelId, onClick } = partsFor(value);
      const isSelected = selected.get() === value;

      return {
        id: tabId,
        role: 'tab',
        'aria-selected': String(isSelected),
        // Emitted for every tab, including those whose panel is not rendered.
        // Unlike a dangling `aria-labelledby`, which quietly leaves an element
        // unnamed, this names only a relationship — and dropping it for the
        // unselected tabs would cost the one thing it buys, a screen reader's
        // jump from a tab to the panel it controls.
        'aria-controls': panelId,
        'aria-disabled': tab.disabled ? 'true' : undefined,
        'data-state': isSelected ? 'active' : 'inactive',
        'data-orientation': orientation,
        'data-disabled': tab.disabled ? '' : undefined,
        [TAB_VALUE_ATTRIBUTE]: value,
        [ITEM_ATTRIBUTE]: '',
        // One tab stop for the whole list, on the tab Tab should land on: the
        // focused one while the list has focus, the selected one once it has
        // gone. Decided from the value rather than by comparing elements,
        // because these props are built before the element they go on exists.
        tabindex: (focused.get() ?? selected.get()) === value ? '0' : '-1',
        onclick: onClick,
      };
    },

    panelProps: (value) => {
      const { tabId, panelId } = partsFor(value);
      const isSelected = selected.get() === value;

      return {
        id: panelId,
        role: 'tabpanel',
        'aria-labelledby': tabId,
        'data-state': isSelected ? 'active' : 'inactive',
        'data-orientation': orientation,
        // In the tab order always, not only when the panel holds nothing
        // focusable. Deciding would mean measuring the panel's contents on
        // every render, and the two sides are not equal: being wrong one way
        // costs a Tab press, being wrong the other leaves content a keyboard
        // user cannot reach.
        tabindex: '0',
        // Hidden rather than unmounted, so `aria-controls` on every tab
        // resolves. A consumer who prefers `:if` loses nothing else by it.
        hidden: !isSelected,
      };
    },
  };
}

/**
 * The tab an event happened in.
 *
 * `closest`, because a tab that wraps an icon or a badge can hand the event a
 * descendant as its target.
 */
function tabFrom(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${TAB_VALUE_ATTRIBUTE}]`);
}

/**
 * Narrowing by shape rather than `instanceof`.
 *
 * The props are typed as plain listeners because that is what a spread hands
 * them, and `instanceof` is not reliable across documents anyway — a tab list
 * portalled into another window has events from that window's realm.
 */
function isKeyboardEvent(event: Event): event is KeyboardEvent {
  return 'key' in event;
}

function isFocusEvent(event: Event): event is FocusEvent {
  return 'relatedTarget' in event;
}
