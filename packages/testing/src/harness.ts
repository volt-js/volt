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

import { getByRole, matchesName, queryAllByRole, queryByRole } from './queries.js';
import { getAccessibleName, getRole } from './aria.js';
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

/**
 * The one candidate, or null — and an error on several, as a query gives.
 *
 * For the parts a single query cannot ask for: a dialog of either role, a
 * button that carries `aria-expanded` whatever its value, an item of any of
 * the three menu roles. Taking the first of several instead would hand back
 * whichever the harness happened to look for first, and let a test act on the
 * wrong one without a word.
 */
function one<T extends Element>(found: T[], what: string, name?: string | RegExp): T | null {
  if (found.length > 1) {
    const candidates = found.map((el) => `  ${getRole(el)} "${getAccessibleName(el)}"`).join('\n');
    throw new Error(
      `[volt:testing] found ${found.length} ${what}s` +
        `${name === undefined ? '' : ` named ${String(name)}`}, expected one:\n${candidates}\n\n` +
        'Narrow it with a name, or with `within`.',
    );
  }
  return found[0] ?? null;
}

/** Several queries' results as one list, in the order a reader meets them. */
function inDocumentOrder<T extends Element>(...lists: T[][]): T[] {
  return lists
    .flat()
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
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
 *
 * The trigger is a button that says whether it is expanded, and nothing else
 * is: a plain button with the same words opens nothing, and one accepted as a
 * trigger would report itself collapsed however often it was pressed. Where
 * only such buttons are found, that is the error — the button is there, and
 * what it lacks is the attribute.
 */
export function disclosureHarness(options: HarnessOptions = {}): DisclosureHarness {
  const buttons = queryAllByRole(scope(options), 'button', { name: options.name });
  const triggers = buttons.filter((el) => el.hasAttribute('aria-expanded'));
  if (triggers.length === 0 && buttons.length > 0) {
    const named = options.name === undefined ? '' : ` named ${String(options.name)}`;
    const found =
      buttons.length === 1
        ? `a button${named}, but it carries no aria-expanded, so nothing tells a ` +
          'screen reader that it opens anything'
        : `${buttons.length} buttons${named}, but none carries aria-expanded, so nothing ` +
          'tells a screen reader that any of them opens anything';
    throw new Error(
      `[volt:testing] found ${found}. A disclosure trigger has to say whether it is expanded.`,
    );
  }
  const trigger = must(
    one(triggers, 'disclosure trigger', options.name),
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

/** Every dialog of either role in the scope, in document order. */
function dialogs(options: HarnessOptions): HTMLElement[] {
  const within = scope(options);
  return inDocumentOrder(
    queryAllByRole(within, 'dialog', { name: options.name }),
    queryAllByRole(within, 'alertdialog', { name: options.name }),
  );
}

export function dialogHarness(options: HarnessOptions = {}): DialogHarness {
  // Both roles in one list, so an alert over a form's dialog is two dialogs
  // and not a form dialog that happened to be asked about first.
  const host = must(one(dialogs(options), 'dialog', options.name), 'dialog', options.name);

  return {
    host,
    title: () => getAccessibleName(host),
    press: (name) => click(getByRole(host, 'button', { name })),
    dismiss: () => press(host, 'Escape'),
  };
}

/**
 * Whether a dialog is on screen at all, for the assertion after a close.
 *
 * Two open at once is an answer — yes — rather than an ambiguity: nothing is
 * being acted on, so there is no wrong one to pick.
 */
export function dialogIsOpen(options: HarnessOptions = {}): boolean {
  return dialogs(options).length > 0;
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
  /** Activate the one item with these words. Throws on none or several. */
  choose(name: string | RegExp): void;
}

export function menuHarness(options: HarnessOptions = {}): MenuHarness {
  const trigger = must(
    queryByRole(scope(options), 'button', { name: options.name }),
    'menu trigger',
    options.name,
  );

  const expanded = (): boolean => trigger.getAttribute('aria-expanded') === 'true';

  const menu = (): Element | null => {
    const id = trigger.getAttribute('aria-controls');
    const byControls = id === null ? null : trigger.ownerDocument.getElementById(id);
    // A menu is usually portalled, so it is looked for in the document rather
    // than under the trigger — `aria-controls` is what ties them together
    // once the DOM no longer does.
    if (byControls !== null) return byControls;
    // Without it — it is optional on a menu button, and `createMenu` sets it
    // only while open — the one menu in the document is taken, but only while
    // this trigger says it is expanded. A closed trigger has no menu, and
    // taking whichever other menu was open would read its items as this one's
    // and let `choose()` press one of them.
    return expanded() ? queryByRole(trigger.ownerDocument.body, 'menu') : null;
  };

  const isOpen = (): boolean => expanded() && menu() !== null;

  const itemsIn = (): Element[] => {
    const host = menu();
    if (host === null) return [];
    // `queryAll`, not `getAll`: a menu holds any mix of the three roles and
    // almost never all of them, and `getAll` treats an absent role as the
    // test's mistake — which it is at a call site, and is not here. Merged
    // back into document order, so a mixed menu reads the way a user meets it.
    return inDocumentOrder(
      queryAllByRole(host, 'menuitem'),
      queryAllByRole(host, 'menuitemcheckbox'),
      queryAllByRole(host, 'menuitemradio'),
    );
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
      must(menu(), 'open menu', options.name);
      // By the rule a query's `name` follows, and one item or none, as every
      // other harness action takes its words.
      const matching = itemsIn().filter((el) => matchesName(getAccessibleName(el), name));
      click(must(one(matching, 'menu item', name), 'menu item', name));
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
    // Through the query's own reading of the state, which takes a native
    // `<option>`'s selectedness where there is no `aria-selected`: a
    // `<select multiple>` is a listbox too, and its markup says nothing about
    // what is chosen.
    selected: () => queryAllByRole(host, 'option', { selected: true }).map(getAccessibleName),
    select: (name) => click(getByRole(host, 'option', { name })),
    isMultiple: () => {
      // The ARIA attribute where there is one, as the queries read state, and
      // a native select's own `multiple` where there is not.
      const multiselectable = host.getAttribute('aria-multiselectable');
      if (multiselectable !== null) return multiselectable === 'true';
      return host.tagName.toLowerCase() === 'select' && host.hasAttribute('multiple');
    },
  };
}
