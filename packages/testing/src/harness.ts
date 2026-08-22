/**
 * Semantic handles on a component, so a test says what a user did.
 *
 * A consumer's test that reaches for `.volt-dialog-content` is a test bound to
 * this library's markup, and that binding is expensive in a direction nobody
 * expects: it means an accessibility fix that changes an element breaks
 * downstream suites, so the promise that such fixes ship centrally as a patch
 * becomes false. Angular's CDK is the only major library that shipped an
 * answer to this, and it is the same answer as here.
 *
 * A harness finds its parts the way a screen reader would — by role, by
 * accessible name, by state — and never by class, tag or nesting. That is the
 * whole discipline, and it is what makes a harness survive a change to the
 * markup it drives. It also means a harness cannot be written for a component
 * whose accessibility is wrong, which is a useful thing for a harness to be
 * unable to do.
 *
 *   const menu = menuHarness({ name: 'Actions' });
 *   menu.open();
 *   menu.choose('Duplicate');
 *
 * Every harness takes an optional `within` to scope it, because a page may
 * hold two of anything, and an optional `name` to tell those two apart. What
 * is deliberately absent is any way to reach a part by position — `items()[2]`
 * is available and `getItemAt(2)` is not, because the first reads as the test
 * choosing to be brittle and the second reads as the library offering it.
 */

import { getByRole, queryAllByRole, queryByRole } from './queries.js';
import { getAccessibleName } from './aria.js';
import { click, press } from './interact.js';

export interface HarnessOptions {
  /** Where to look. Defaults to the whole document. */
  within?: ParentNode;
  /** The accessible name, when a page holds more than one. */
  name?: string | RegExp;
}

function scope(options: HarnessOptions): ParentNode {
  return options.within ?? document.body;
}

/** Named for the error message: "no dialog named X" beats "not found". */
function must<T>(value: T | null, what: string, name?: string | RegExp): T {
  if (value !== null) return value;
  throw new Error(
    `[volt:testing] no ${what}${name === undefined ? '' : ` named ${String(name)}`} ` +
      'is present and reachable. A part hidden from the accessibility tree is not ' +
      'found on purpose: a closed overlay still has its buttons in the DOM.',
  );
}

// ---------------------------------------------------------------------------
// Disclosure, and the accordion that is several of them
// ---------------------------------------------------------------------------

export interface DisclosureHarness {
  /** The control that opens it. */
  readonly trigger: Element;
  isExpanded(): boolean;
  expand(): void;
  collapse(): void;
  toggle(): void;
  /** The region the trigger controls, or null while it is closed. */
  panel(): Element | null;
}

/**
 * A trigger and the region it controls, found through `aria-expanded` and
 * `aria-controls` — which is also the only way a screen reader knows they are
 * related, so a harness that can find them is evidence the relationship exists.
 */
export function disclosureHarness(options: HarnessOptions = {}): DisclosureHarness {
  const trigger = must(
    queryByRole(scope(options), 'button', { name: options.name, expanded: undefined }),
    'disclosure trigger',
    options.name,
  );

  const isExpanded = (): boolean => trigger.getAttribute('aria-expanded') === 'true';
  const panel = (): Element | null => {
    const id = trigger.getAttribute('aria-controls');
    if (id === null) return null;
    const region = trigger.ownerDocument.getElementById(id);
    // A panel kept mounted while it animates closed is not one a user can
    // reach, and a test that asserts on its content would pass on a closed
    // accordion.
    return region !== null && isExpanded() ? region : null;
  };

  return {
    trigger,
    isExpanded,
    panel,
    expand: () => {
      if (!isExpanded()) click(trigger);
    },
    collapse: () => {
      if (isExpanded()) click(trigger);
    },
    toggle: () => click(trigger),
  };
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export interface DialogHarness {
  readonly host: Element;
  /** Its accessible name, which is what a screen reader announces on open. */
  title(): string;
  /** Press a button inside it, by the words on it. */
  press(name: string | RegExp): void;
  /** Dismiss with Escape, which every dialog must answer. */
  dismiss(): void;
}

export function dialogHarness(options: HarnessOptions = {}): DialogHarness {
  const host = must(
    queryByRole(scope(options), 'dialog', { name: options.name }) ??
      queryByRole(scope(options), 'alertdialog', { name: options.name }),
    'dialog',
    options.name,
  );

  return {
    host,
    title: () => getAccessibleName(host),
    press: (name) => click(getByRole(host, 'button', { name })),
    dismiss: () => press(host, 'Escape'),
  };
}

/** Whether a dialog is on screen at all, for the assertion after a close. */
export function dialogIsOpen(options: HarnessOptions = {}): boolean {
  const within = scope(options);
  return (
    queryByRole(within, 'dialog', { name: options.name }) !== null ||
    queryByRole(within, 'alertdialog', { name: options.name }) !== null
  );
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export interface MenuHarness {
  readonly trigger: Element;
  isOpen(): boolean;
  open(): void;
  close(): void;
  /** The words on every item, in the order a reader meets them. */
  items(): string[];
  /** Activate an item by its words. */
  choose(name: string | RegExp): void;
}

export function menuHarness(options: HarnessOptions = {}): MenuHarness {
  const trigger = must(
    queryByRole(scope(options), 'button', { name: options.name }),
    'menu trigger',
    options.name,
  );

  const menu = (): Element | null => {
    const id = trigger.getAttribute('aria-controls');
    const byControls = id === null ? null : trigger.ownerDocument.getElementById(id);
    // A menu is usually portalled, so it is looked for in the document rather
    // than under the trigger — `aria-controls` is what ties them together
    // once the DOM no longer does.
    return byControls ?? queryByRole(trigger.ownerDocument.body, 'menu');
  };

  const isOpen = (): boolean =>
    trigger.getAttribute('aria-expanded') === 'true' && menu() !== null;

  const itemsIn = (): Element[] => {
    const host = menu();
    if (host === null) return [];
    // `queryAll`, not `getAll`: a menu holds any mix of the three roles and
    // almost never all of them, and `getAll` treats an absent role as the
    // test's mistake — which it is at a call site, and is not here.
    return [
      ...queryAllByRole(host, 'menuitem'),
      ...queryAllByRole(host, 'menuitemcheckbox'),
      ...queryAllByRole(host, 'menuitemradio'),
    ];
  };

  return {
    trigger,
    isOpen,
    items: () => itemsIn().map(getAccessibleName),
    open: () => {
      if (!isOpen()) click(trigger);
    },
    close: () => {
      if (isOpen()) press(must(menu(), 'menu', options.name), 'Escape');
    },
    choose: (name) => {
      const host = must(menu(), 'open menu', options.name);
      const matches = (value: string): boolean =>
        typeof name === 'string' ? value === name : name.test(value);
      const item = itemsIn().find((el) => matches(getAccessibleName(el)));
      click(must(item ?? null, `menu item named ${String(name)}`));
      void host;
    },
  };
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export interface TabsHarness {
  readonly list: Element;
  /** The words on every tab, in order. */
  tabs(): string[];
  selected(): string;
  select(name: string | RegExp): void;
  /** The panel the selected tab controls. */
  panel(): Element;
}

export function tabsHarness(options: HarnessOptions = {}): TabsHarness {
  const list = must(
    queryByRole(scope(options), 'tablist', { name: options.name }),
    'tablist',
    options.name,
  );
  const doc = list.ownerDocument;
  const all = (): Element[] => queryAllByRole(list, 'tab');
  const current = (): Element =>
    must(all().find((el) => el.getAttribute('aria-selected') === 'true') ?? null, 'selected tab');

  return {
    list,
    tabs: () => all().map(getAccessibleName),
    selected: () => getAccessibleName(current()),
    select: (name) => click(getByRole(list, 'tab', { name })),
    panel: () => {
      const id = current().getAttribute('aria-controls');
      const found = id === null ? null : doc.getElementById(id);
      // A tab that controls nothing is a tab whose panel a screen-reader user
      // cannot reach from it, so this is an assertion as much as a lookup.
      return must(found, 'panel for the selected tab');
    },
  };
}

// ---------------------------------------------------------------------------
// Listbox
// ---------------------------------------------------------------------------

export interface ListboxHarness {
  readonly host: Element;
  options(): string[];
  /** The words on every selected option; several when it is multi-select. */
  selected(): string[];
  select(name: string | RegExp): void;
  isMultiple(): boolean;
}

export function listboxHarness(options: HarnessOptions = {}): ListboxHarness {
  const host = must(
    queryByRole(scope(options), 'listbox', { name: options.name }),
    'listbox',
    options.name,
  );

  return {
    host,
    options: () => queryAllByRole(host, 'option').map(getAccessibleName),
    selected: () =>
      queryAllByRole(host, 'option')
        .filter((el) => el.getAttribute('aria-selected') === 'true')
        .map(getAccessibleName),
    select: (name) => click(getByRole(host, 'option', { name })),
    isMultiple: () => host.getAttribute('aria-multiselectable') === 'true',
  };
}
