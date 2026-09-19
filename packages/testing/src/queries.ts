/**
 * Finding an element the way a user finds it: by what it is, and what it is
 * called.
 *
 * There is no `getByTestId` here, and no query by class or by tag. Those hooks
 * survive the bugs worth catching — a listbox that stopped exposing
 * `role="option"`, a button whose label went missing, a popover left in the
 * DOM but hidden from the tree — and a suite built on them goes green through
 * all of it. `container` is exposed for the cases that genuinely are about
 * markup; everything else goes through here.
 *
 * When a query fails it prints what the document does contain, because "found
 * no button named Save" is only half of what you need to know.
 */

import { getAccessibleName, getRole, isAccessibilityHidden, normalizeText } from './aria.js';

export interface RoleQueryOptions {
  /**
   * The accessible name. A string must match in full, after whitespace is
   * collapsed — a substring match would make `name: 'Save'` find "Save as…"
   * and pass a test whose button is the wrong one. Use a `RegExp` deliberately
   * for anything looser.
   */
  name?: string | RegExp;
  /**
   * Include elements hidden from the accessibility tree. Off by default: a
   * closed dialog's buttons are in the DOM, and finding them is how a test
   * comes to assert on something no user could reach.
   */
  hidden?: boolean;

  /** `aria-selected`, or a native `<option>`'s own selectedness. */
  selected?: boolean;
  /** `aria-checked`, or a native checkbox or radio's own checkedness. */
  checked?: boolean;
  /** `aria-pressed`. */
  pressed?: boolean;
  /** `aria-expanded`. */
  expanded?: boolean;
}

const STATE_ATTRIBUTES = {
  selected: 'aria-selected',
  checked: 'aria-checked',
  pressed: 'aria-pressed',
  expanded: 'aria-expanded',
} as const;

/** Every element with this role, in document order. Never throws. */
export function queryAllByRole(
  container: ParentNode,
  role: string,
  options: RoleQueryOptions = {},
): HTMLElement[] {
  const found: HTMLElement[] = [];

  for (const element of container.querySelectorAll<HTMLElement>('*')) {
    if (getRole(element) !== role) continue;
    if (!options.hidden && isAccessibilityHidden(element)) continue;
    if (options.name !== undefined && !matchesName(getAccessibleName(element), options.name)) {
      continue;
    }
    if (!matchesState(element, options)) continue;
    found.push(element);
  }

  return found;
}

/** The one element with this role, or null. Throws if several match. */
export function queryByRole(
  container: ParentNode,
  role: string,
  options: RoleQueryOptions = {},
): HTMLElement | null {
  const found = queryAllByRole(container, role, options);
  if (found.length > 1) throw ambiguous(role, options, found);
  return found[0] ?? null;
}

/** The one element with this role. Throws if none or several match. */
export function getByRole(
  container: ParentNode,
  role: string,
  options: RoleQueryOptions = {},
): HTMLElement {
  const found = queryAllByRole(container, role, options);
  if (found.length === 0) throw missing(container, role, options);
  if (found.length > 1) throw ambiguous(role, options, found);
  return found[0]!;
}

/** Every element with this role. Throws if none match. */
export function getAllByRole(
  container: ParentNode,
  role: string,
  options: RoleQueryOptions = {},
): HTMLElement[] {
  const found = queryAllByRole(container, role, options);
  if (found.length === 0) throw missing(container, role, options);
  return found;
}

/**
 * Whether a name is the one asked for.
 *
 * Exported for the harnesses, so that every action that takes a name reads it
 * by the same rule as the queries. A pattern is applied with `search()` rather
 * than `test()`: a global or sticky `test()` resumes from where its last match
 * ended, so a query that asked it once per element would find every other
 * button called "Save", and leave the caller's pattern part way through.
 */
export function matchesName(name: string, expected: string | RegExp): boolean {
  return typeof expected === 'string'
    ? name === normalizeText(expected)
    : name.search(expected) !== -1;
}

function matchesState(element: Element, options: RoleQueryOptions): boolean {
  for (const [option, attribute] of Object.entries(STATE_ATTRIBUTES)) {
    const expected = options[option as keyof typeof STATE_ATTRIBUTES];
    if (expected === undefined) continue;
    if (stateOf(element, attribute) !== String(expected)) return false;
  }
  return true;
}

/**
 * The state as the accessibility tree reports it, not as the markup spells it.
 *
 * A native control publishes its state as a property: `<input type="checkbox">`
 * carries no `aria-checked` and is announced as checked all the same, and
 * ticking one changes nothing in the markup at all. Reading only the attribute
 * would make `{ checked: true }` match nothing on a native form — which is
 * worse than an error, because the query returns null and a test asserting
 * that something is absent passes for entirely the wrong reason.
 */
function stateOf(element: Element, attribute: string): string | null {
  const explicit = element.getAttribute(attribute);
  if (explicit !== null) return explicit;

  const tag = element.tagName.toLowerCase();

  if (attribute === 'aria-checked' && tag === 'input') {
    const input = element as HTMLInputElement;
    const type = input.getAttribute('type')?.toLowerCase();
    if (type !== 'checkbox' && type !== 'radio') return null;
    return input.indeterminate ? 'mixed' : String(input.checked);
  }

  if (attribute === 'aria-selected' && tag === 'option') {
    return String((element as HTMLOptionElement).selected);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

/** Enough of the tree to see what went wrong, without printing a whole page. */
const REPORT_LIMIT = 20;

function describe(role: string, options: RoleQueryOptions): string {
  const parts = [role];
  if (options.name !== undefined) {
    parts.push(typeof options.name === 'string' ? `named "${options.name}"` : `named ${options.name}`);
  }
  for (const option of Object.keys(STATE_ATTRIBUTES) as (keyof typeof STATE_ATTRIBUTES)[]) {
    const expected = options[option];
    if (expected !== undefined) parts.push(`${option}: ${expected}`);
  }
  return parts.join(', ');
}

function missing(container: ParentNode, role: string, options: RoleQueryOptions): Error {
  return new Error(
    `[volt] Found no ${describe(role, options)}.\n\n${inventory(container, options.hidden ?? false)}`,
  );
}

function ambiguous(role: string, options: RoleQueryOptions, found: HTMLElement[]): Error {
  const names = found.map((element) => `  ${role} "${getAccessibleName(element)}"`).join('\n');
  return new Error(
    `[volt] Found ${found.length} elements matching ${describe(role, options)}, expected one:\n${names}\n\n` +
      'Narrow it with a name, or query the subtree it belongs to.',
  );
}

/** What is actually there, which is nearly always where the answer is. */
function inventory(container: ParentNode, includeHidden: boolean): string {
  const lines: string[] = [];
  let elided = 0;

  for (const element of container.querySelectorAll<HTMLElement>('*')) {
    const role = getRole(element);
    // A generic element has no semantics to have got wrong, and listing every
    // `<div>` would bury the ones that do.
    if (!role || role === 'generic' || role === 'presentation') continue;
    if (!includeHidden && isAccessibilityHidden(element)) continue;

    if (lines.length >= REPORT_LIMIT) {
      elided++;
      continue;
    }
    lines.push(`  ${role.padEnd(14)}"${getAccessibleName(element)}"`);
  }

  if (lines.length === 0) return 'Nothing in the document exposes a role.';
  if (elided > 0) lines.push(`  … and ${elided} more`);
  return `What is there:\n${lines.join('\n')}`;
}
