/**
 * Listbox — a selectable collection of options, with the list on the page.
 *
 * This is the whole of the hard part of choosing from a list: selection modes,
 * the keyboard map, typeahead, group headings, virtual focus, and counting
 * options that are not in the DOM. Select and Combobox are a listbox with a
 * button or a textbox in front of it, but they are not built on this one: their
 * options are keyed by a string value rather than by index and exist only
 * while the popup does, so `combobox.ts` carries its own popup listbox. The
 * two differ where that shows — a page there is ten options rather than a
 * viewport, typeahead there goes through `collection.match` rather than a
 * collator, and every option there states `aria-selected`.
 *
 * This is headless: it owns state, keyboard and ARIA, and returns prop objects
 * to spread onto whatever markup the consumer writes. Nothing here renders.
 *
 *   class Fruits {
 *     listbox = new Signal.State<Element | null>(null);
 *     items = new Signal.State(['Apple', 'Banana', 'Cherry']);
 *     list = createListbox<string>({
 *       listbox: () => this.listbox.get(),
 *       items: () => this.items.get(),
 *       label: 'Fruit',
 *     });
 *   }
 *
 *   <div :ref="listbox" :spread="list.listboxProps()"
 *        :keydown="list.onKeyDown($event)"
 *        :click="list.onOptionClick($event)">
 *     <div :for="(item, i) in items.get()" :key="item"
 *          :spread="list.optionProps({ index: i, value: item })">{ item }</div>
 *   </div>
 *
 * **Every option declares its index.** That is the one demand this primitive
 * makes of its consumer, and it is what makes the rest possible: a virtualized
 * listbox cannot read position out of the DOM, because ten of ten thousand
 * options are in it. Range selection, `aria-posinset`, paging and typeahead all
 * need positions for options that were never rendered, so position is part of
 * the contract rather than something inferred. The cost is `index: i` in the
 * loop; the alternative is a second, weaker listbox for the virtualized case.
 *
 * **Values are compared with `compareBy`, not with `===`.** A list re-fetched
 * from a server hands back equal objects with new identities, and a selection
 * held by identity silently empties itself. `compareBy` returns whatever
 * identifies an option — usually `item.id` — and it doubles as the key of the
 * set membership is tested against, so `isSelected` is a lookup rather than a
 * scan.
 *
 * The keyboard map is the WAI-ARIA listbox pattern, single and multi-select:
 *
 *   ArrowDown, ArrowUp         next, previous option — Left/Right if horizontal
 *   Home, End                  first, last option
 *   PageDown, PageUp           one viewport of options forward, back
 *   printable characters       typeahead, accumulating for 500ms
 *   Enter                      choose the active option
 *   Space                      choose it, or toggle it where several may be
 *   Shift + move               extend the selection from the anchor
 *   Ctrl + move                move without changing the selection
 *   Ctrl + Space               toggle the active option, leaving the rest
 *   Shift + Space              select from the anchor to the active option
 *   Ctrl + A                   select every option, or clear if all are already
 *
 * Disabled options are skipped by every one of those, and stay in the
 * accessibility tree so they can be found and heard to be unavailable.
 *
 * A listbox is entered on the option that is already selected rather than on
 * the first one, which is what the APG asks for and what a Select showing
 * "Cherry" has to do: the tab stop, the virtual cursor and the first arrow
 * press all count from there. With nothing selected they fall back to the
 * first option. Focus arriving from outside is heard, so the primitive's idea
 * of the active option and the browser's idea of the focused element cannot
 * drift apart.
 *
 * **Virtual focus** keeps DOM focus where it is and moves an
 * `aria-activedescendant` instead. It is what a combobox needs — focus has to
 * stay in the text input or typing stops working — and it is what a listbox
 * inside a dialog wants whenever moving real focus would disturb something
 * else. Spread `activeDescendantProps()` onto whatever actually holds focus.
 *
 * **Virtualized mode** composes `createVirtualizer`, and puts back by hand the
 * two things virtualization takes away from assistive technology: `aria-setsize`
 * and `aria-posinset`, so an option announces as "7 of 10,000" rather than as
 * "7 of 12", the size of the window that happens to be rendered.
 *
 * One deliberate divergence from the primitives around it: the key map is this
 * primitive's own rather than `createRovingFocus`'s. Roving focus moves between
 * *elements* it can find in the DOM, which is exactly what a listbox cannot
 * rely on — the option Shift+End extends to may not exist yet. So movement here
 * is arithmetic over indices, and roving focus is used for the part that is
 * still about elements: moving DOM focus onto the option that arithmetic chose.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createCollection } from './collection.js';
import { createRovingFocus } from './roving-focus.js';
import {
  createVirtualizer,
  type VirtualItem,
  type VirtualOverscan,
  type VirtualScrollToIndexOptions,
  type Virtualizer,
} from './virtualizer.js';
import { createId } from './id.js';
import { resolveDirection, useLocale } from './i18n.js';

const { untrack } = Signal.subtle;

/**
 * Marks an option and carries its index.
 *
 * One attribute rather than two because the index is not optional: an option
 * without a position is not something this can navigate to. Options are found
 * by attribute rather than registered, so an option rendered from `:for`, or
 * nested inside a group a consumer wrote themselves, needs no wiring of its own.
 */
export const OPTION_ATTRIBUTE = 'data-volt-option';

/** How long typed characters accumulate before the search restarts, in ms. */
const TYPEAHEAD_TIMEOUT = 500;

/**
 * Options a page key moves by when nothing better is known.
 *
 * Only reached when neither the virtualizer nor layout can say how many options
 * a viewport holds — before first layout, or in a test environment that lays
 * nothing out. Ten is what a listbox with no scroll container is worth paging by.
 */
const DEFAULT_PAGE_SIZE = 10;

/**
 * How selection responds to a press.
 *
 * `none` navigates without selecting — a list that is read rather than chosen
 * from. `single` holds at most one. `multiple` toggles each option on its own
 * press, which is what a filter list wants. `extended` is the desktop
 * file-manager model: a plain press replaces the selection, Ctrl toggles one,
 * Shift takes a range.
 */
export type ListboxSelectionMode = 'none' | 'single' | 'multiple' | 'extended';

export type ListboxOrientation = 'vertical' | 'horizontal';

export interface ListboxLabels {
  /**
   * The live-region text for a multi-select listbox. Defaults to the locale's
   * `selected` message — "3 selected" in English.
   */
  selected?: (count: number) => string;
}

/**
 * Geometry for a virtualized listbox. The listbox element is the scroller, so
 * only the inner container has to be handed over.
 */
export interface ListboxVirtualOptions {
  /**
   * The element the rendered window lives in — what `containerProps()` goes on.
   */
  container: () => Element | null | undefined;

  /**
   * A number promises every option is exactly this tall and makes the whole
   * geometry arithmetic; a function is an estimate and turns measurement on.
   */
  itemSize: number | ((index: number) => number);
  /** Measure rendered options and correct the estimate. */
  measure?: boolean;
  /** Space between options, in px. Part of the arithmetic, not of layout. */
  gap?: number;
  /** Default 2 each way. */
  overscan?: number | Partial<VirtualOverscan>;
  /**
   * What identifies an option, so measurements survive the list growing at the
   * front. Defaults to the index.
   */
  getItemKey?: (index: number) => string | number;

  /** Called when the rendered window changes — where an infinite list loads. */
  onRangeChange?: (range: { startIndex: number; endIndex: number }) => void;
}

export interface ListboxOptionOptions<T> {
  /**
   * Position in the whole collection, counting disabled options and any that
   * are not currently rendered.
   */
  index: number;
  /**
   * What selecting this option selects. Optional only when `items` was given,
   * in which case it comes from there.
   */
  value?: T;
  /** Skipped by navigation, still announced. */
  disabled?: boolean;
  /**
   * What typeahead matches on, when the visible text is not what anyone would
   * type — an option leading with an icon's alt text, or trailing a badge.
   */
  textValue?: string;
}

export interface ListboxOptions<T> {
  /** The element carrying `role="listbox"`, and the scroller when virtualized. */
  listbox: () => Element | null | undefined;

  // --- The collection ------------------------------------------------------

  /**
   * The options' values, in order. With this, everything that needs a value for
   * a position — range selection, select-all — works for options that have
   * never been rendered. Without it, only rendered options can supply one.
   */
  items?: () => readonly T[];
  /**
   * How many options there are. Defaults to `items().length`, then to the
   * number in the DOM. A virtualized listbox needs one of the first two.
   */
  count?: () => number;
  /**
   * What typeahead matches at a position. Defaults to the rendered option's
   * `textValue`, then its text — which is all a virtualized listbox has for
   * options outside the window, so give this if typeahead must reach them.
   */
  textValue?: (index: number) => string;
  /**
   * Whether the option at a position is disabled. Defaults to what the rendered
   * option said. Same caveat as `textValue` under virtualization.
   */
  isDisabled?: (index: number) => boolean;

  // --- Selection -----------------------------------------------------------

  /** Default `single`. */
  selectionMode?: ListboxSelectionMode;
  /**
   * Supply a signal to control the selection from outside. Without one the
   * listbox owns it, which is what most callers want.
   *
   * One array-shaped signal for every mode, rather than a bare value for
   * `single` and an array for the rest: two shapes would fork every method
   * here, and leave `null` and `[]` both meaning nothing is selected. The cost
   * is that a single-select consumer unwraps a one-element array, which
   * `selectedValue()` does for them.
   */
  value?: Signal.State<readonly T[]>;
  defaultValue?: readonly T[];
  /**
   * What identifies a value. Defaults to the value itself, which compares
   * objects by identity — right for strings and numbers, wrong the moment the
   * list is re-fetched.
   */
  compareBy?: (value: T) => unknown;
  /**
   * Moving the active option also selects it. Defaults to true in `extended`
   * mode, where replacing the selection as you arrow is the whole point, and
   * false otherwise.
   *
   * Only safe when selection has no side effect beyond the selection itself: a
   * single-select listbox that loads a page per option makes this unusable with
   * a keyboard.
   */
  selectionFollowsFocus?: boolean;
  /** Refuse to leave nothing selected — a Select with a mandatory answer. */
  disallowEmptySelection?: boolean;

  // --- Navigation ----------------------------------------------------------

  /** Default vertical. Horizontal moves on Left and Right, mirrored under RTL. */
  orientation?: ListboxOrientation;
  /**
   * Arrow keys wrap past the ends. Default false — unlike a menu, because a
   * listbox is a range being scanned, and wrapping from the last option to the
   * first hides the fact that the end was reached.
   */
  loop?: boolean;
  /** Typing letters jumps to a matching option. Default true. */
  typeahead?: boolean;
  /** How long typed characters accumulate, in ms. Default 500. */
  typeaheadTimeout?: number;
  /** Options a page key moves by. Defaults to what a viewport holds. */
  pageSize?: number;

  /**
   * Move an `aria-activedescendant` instead of DOM focus. What a combobox
   * needs, and what anything else that must not steal focus needs.
   */
  virtualFocus?: boolean;
  /**
   * Put the listbox itself in the tab order. Defaults to true under virtual
   * focus, where the listbox is the thing focused, and false otherwise, where
   * the options hold the single tab stop between them. A combobox sets it
   * false: the input holds focus, and a second tab stop on the popup is worse
   * than none.
   */
  focusable?: boolean;
  /** Moving the pointer over an option makes it active. Default false. */
  focusOnHover?: boolean;

  /** The whole listbox is unavailable: no navigation, no selection. */
  disabled?: () => boolean;

  // --- Naming --------------------------------------------------------------

  /** Accessible name. A listbox takes no name from its own options. */
  label?: string;
  /** Id of the element that names it — a heading, or the field's label. */
  labelledBy?: string;
  labels?: ListboxLabels;

  // --- Virtualization ------------------------------------------------------

  virtual?: ListboxVirtualOptions;

  // --- Reporting -----------------------------------------------------------

  onSelectionChange?: (values: readonly T[]) => void;
  /** The active option moved. -1 when nothing is active. */
  onActiveChange?: (index: number) => void;
}

export type ListboxPropValue =
  | string
  | number
  | boolean
  | undefined
  | Readonly<Record<string, string>>;

export interface ListboxProps {
  readonly [key: string]: ListboxPropValue;
}

export interface Listbox<T> {
  /** Every selected value, in the order they were selected. */
  selectedValues(): readonly T[];
  /** The first selected value, which is the only one in `single` mode. */
  selectedValue(): T | null;
  isSelected(value: T): boolean;
  /** How many options there are, rendered or not. */
  count(): number;

  /** The option the keyboard acts on, or -1. */
  activeIndex(): number;
  activeValue(): T | undefined;
  /** The active option's element, or null when it is not rendered. */
  activeOption(): HTMLElement | null;

  select(value: T): void;
  deselect(value: T): void;
  toggle(value: T): void;
  /** Every option that has a value and is not disabled. */
  selectAll(): void;
  clear(): void;

  /** Make an option active, scrolling it into view. */
  focusIndex(index: number): void;
  focusFirst(): void;
  focusLast(): void;

  /** Handle a keydown. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;
  onOptionClick(event: MouseEvent): void;
  onOptionPointerMove(event: PointerEvent): void;

  listboxProps(): ListboxProps;
  optionProps(option: ListboxOptionOptions<T>): ListboxProps;
  /** A section of options. `key` is yours, and only has to be stable. */
  groupProps(key: string | number): ListboxProps;
  /** The heading naming that section. */
  groupLabelProps(key: string | number): ListboxProps;
  /** `aria-activedescendant`, for whatever holds DOM focus under virtual focus. */
  activeDescendantProps(): ListboxProps;

  // --- Virtualized only ----------------------------------------------------

  /** The window to render. Empty when the listbox is not virtualized. */
  virtualItems(): readonly VirtualItem[];
  sizerProps(): ListboxProps;
  containerProps(): ListboxProps;
  scrollToIndex(index: number, options?: VirtualScrollToIndexOptions): void;

  /** Text for an optional live region — see `statusProps`. */
  status(): string;
  statusProps(): ListboxProps;
}

export function createListbox<T>(options: ListboxOptions<T>): Listbox<T> {
  const mode = options.selectionMode ?? 'single';
  const multiselect = mode === 'multiple' || mode === 'extended';
  const horizontal = options.orientation === 'horizontal';
  const loop = options.loop === true;
  const virtualFocus = options.virtualFocus === true;
  const focusable = options.focusable ?? virtualFocus;
  const followsFocus = options.selectionFollowsFocus ?? mode === 'extended';

  const locale = useLocale();
  const baseId = createId('listbox');
  const optionId = (index: number): string => `${baseId}-o${index}`;

  const selection =
    options.value ?? new Signal.State<readonly T[]>(options.defaultValue ?? []);
  const active = new Signal.State(-1);

  /**
   * Where a range extends from. Set by any selection that is not itself a
   * range, so Shift+Arrow grows from the last option deliberately chosen rather
   * than from wherever the previous range happened to end.
   */
  let anchor = -1;

  const collection = createCollection(options.listbox, { attribute: OPTION_ATTRIBUTE });

  /**
   * Values seen while rendering, by index.
   *
   * `optionProps` is the only place a value and a position are known together,
   * so this is where a value for an option nobody handed us `items` for comes
   * from. Filling a cache from inside a render is a side effect, but a pure one:
   * the same option always records the same value. Entries for options that
   * have scrolled out of a virtualized window go stale, which is precisely why
   * `items` takes precedence over this and is what a virtualized listbox should
   * be given.
   */
  const rendered = new Map<number, T>();

  /**
   * The positions that have an element right now.
   *
   * Whether an option is rendered is the consumer's `:if` or `:for` to decide,
   * and a `Select` whose popup is closed still knows its collection and its
   * answer — so the count says six while the document holds none. Anything
   * that must not name an option that is not there has to re-run when they
   * change their mind, which is why presence is a signal and not a query.
   *
   * `optionProps` runs inside the effect that renders its option, so recording
   * on the way in and releasing on that effect's cleanup follows mount and
   * unmount exactly, with no observer. That effect also re-runs whenever the
   * active option moves, which releases and re-records without the set
   * actually changing; the extra invalidation costs one recompute of
   * `listboxProps`, and every binding it feeds compares before it writes.
   */
  const present = new Set<number>();
  const presence = new Signal.State(0);
  const bumpPresence = (): void => presence.set(untrack(() => presence.get()) + 1);

  const markPresent = (index: number): void => {
    if (!present.has(index)) {
      present.add(index);
      bumpPresence();
    }
    onCleanup(() => {
      if (present.delete(index)) bumpPresence();
    });
  };

  /** Whether the option at a position currently has an element. */
  const isPresent = (index: number): boolean => {
    presence.get();
    return present.has(index);
  };

  const isListboxDisabled = (): boolean => options.disabled?.() ?? false;

  /**
   * Move the active option, and say so.
   *
   * Every path that changes it goes through here — keys, the pointer, DOM
   * focus arriving from outside, and the clamp below — because a consumer
   * mirroring `onActiveChange` into their own state is otherwise left holding
   * a position that no longer exists. The alternative, reporting only from
   * `focusIndex`, is what let the clamp move the highlight in silence.
   */
  const setActive = (index: number): void => {
    if (untrack(() => active.get()) === index) return;
    active.set(index);
    options.onActiveChange?.(index);
  };

  // --- The collection, as positions ----------------------------------------

  const count = (): number => {
    if (options.count) return Math.max(0, Math.trunc(options.count()));
    const items = options.items?.();
    if (items) return items.length;
    return collection.all().length;
  };

  const elementAt = (index: number): HTMLElement | null => {
    const root = options.listbox();
    if (!root || index < 0) return null;
    // The index is a number this generated, so it needs no escaping — and
    // escaping it would pull in `CSS`, which does not exist on a server.
    return root.querySelector<HTMLElement>(`[${OPTION_ATTRIBUTE}="${index}"]`);
  };

  const indexOf = (el: Element | null | undefined): number => {
    const declared = el?.getAttribute(OPTION_ATTRIBUTE);
    if (declared === null || declared === undefined) return -1;
    const index = Number(declared);
    return Number.isInteger(index) ? index : -1;
  };

  const valueAt = (index: number): T | undefined => {
    if (index < 0) return undefined;
    const items = options.items?.();
    if (items) return items[index];
    return rendered.get(index);
  };

  const disabledAt = (index: number): boolean => {
    const declared = options.isDisabled?.(index);
    if (declared !== undefined) return declared;
    const el = elementAt(index);
    // An option nobody can see and nobody described is taken to be available:
    // refusing to move to it would strand navigation before it started.
    return el !== null && (el.hasAttribute('data-disabled') || el.hasAttribute('disabled'));
  };

  const textAt = (index: number): string => {
    const declared = options.textValue?.(index);
    if (declared !== undefined) return declared;
    const el = elementAt(index);
    if (!el) return '';
    // `data-label` wins, because visible text may include an icon's alt text or
    // a badge — none of which anyone types when reaching for the option.
    return (el.getAttribute('data-label') ?? el.textContent ?? '').trim();
  };

  // --- Virtualization ------------------------------------------------------

  const virtualizer: Virtualizer | null = options.virtual
    ? createVirtualizer({
        scroller: options.listbox,
        container: options.virtual.container,
        count,
        itemSize: options.virtual.itemSize,
        measure: options.virtual.measure,
        gap: options.virtual.gap,
        overscan: options.virtual.overscan,
        getItemKey: options.virtual.getItemKey,
        onRangeChange: options.virtual.onRangeChange,
        // Options are a set, so they count with setsize and posinset. The
        // listbox is already focusable or already roving, so the scroller must
        // not add a tab stop of its own.
        counting: 'set',
        axis: horizontal ? 'horizontal' : 'vertical',
      })
    : null;

  /**
   * An option that arithmetic moved to before it existed.
   *
   * Under virtualization the target of End, or of a page, is usually outside
   * the rendered window: the scroll is asked for, and the element only appears
   * a render later. Held here until it does.
   */
  let pendingFocus: number | null = null;

  /**
   * Whether DOM focus is somewhere inside the listbox.
   *
   * Tracked rather than read off `document.activeElement` because the case
   * that matters is the one where focus has already been lost: an option
   * removed under the reader takes focus to `<body>`, and by then the document
   * can no longer say where it came from.
   */
  let focusWithin = false;

  /** The rendered window, or null when there is no virtualizer or no window. */
  const windowRange = (): { first: number; last: number } | null => {
    if (!virtualizer) return null;
    const range = virtualizer.range();
    if (range.startIndex < 0) return null;
    return { first: range.startIndex, last: range.endIndex };
  };

  /** Whether the virtualizer is currently rendering this position. */
  const isWindowed = (index: number): boolean => {
    if (!virtualizer) return true;
    const range = windowRange();
    return range !== null && index >= range.first && index <= range.last;
  };

  /**
   * The nearest position that is actually rendered.
   *
   * A tab stop on an option outside the window is a tab stop on nothing: the
   * element carrying `tabindex="0"` does not exist, so Tab skips the listbox
   * entirely and a keyboard user has no way back into it. The alternative —
   * pinning the active option into the window so it always renders — was
   * rejected because it puts an option the reader has scrolled away from back
   * under their cursor, and lies to the virtualizer about its own geometry.
   */
  const withinWindow = (index: number): number => {
    const range = windowRange();
    if (!range || index < 0 || (index >= range.first && index <= range.last)) return index;
    const near = index < range.first ? range.first : range.last;
    const direction = index < range.first ? 1 : -1;
    // A disabled option must not be the one holding the tab stop.
    for (let i = near; i >= range.first && i <= range.last; i += direction) {
      if (!disabledAt(i)) return i;
    }
    return near;
  };

  if (virtualizer && !virtualFocus) {
    effect(() => {
      // Re-runs as the window changes, which is the event being waited for.
      virtualizer.items();
      const index = pendingFocus;
      if (index !== null) {
        const el = elementAt(index);
        if (!el) return;
        pendingFocus = null;
        el.focus();
        return;
      }

      // Scrolling the focused option out of the window unmounts the element
      // holding focus, and the platform drops focus to `<body>` rather than
      // finding a neighbour. Nothing else puts it back: no rendered option is
      // the active one, and under roving focus the listbox root is not a tab
      // stop either, so the reader is left at the top of the document.
      if (!focusWithin) return;
      const root = options.listbox();
      if (!root) return;
      const here = root.ownerDocument.activeElement;
      // Focus that went somewhere real is focus the user moved; only focus
      // that went nowhere is focus that was dropped.
      if (here !== null && here !== root.ownerDocument.body) return;
      const current = untrack(() => active.get());
      if (current < 0 || elementAt(current) !== null) return;
      // `preventScroll`, because the reader is mid-wheel: scrolling back to
      // wherever focus landed would undo the scroll they just asked for.
      elementAt(withinWindow(current))?.focus({ preventScroll: true });
    });
  }

  /**
   * Keep the active option inside the collection as it shrinks.
   *
   * A combobox filtering twenty options down to three leaves the active index
   * pointing past the end, and the next arrow press would move from nowhere.
   * `active` is read untracked because this cares about the count changing, not
   * about its own writes.
   */
  effect(() => {
    const n = count();
    const index = untrack(() => active.get());
    if (index < n) return;
    setActive(n === 0 ? -1 : n - 1);
  });

  // --- Selection -----------------------------------------------------------

  const keyOf = (value: T): unknown => (options.compareBy ? options.compareBy(value) : value);

  const selectedKeys = new Signal.Computed(() => {
    const keys = new Set<unknown>();
    for (const value of selection.get()) keys.add(keyOf(value));
    return keys;
  });

  const isSelected = (value: T): boolean => selectedKeys.get().has(keyOf(value));

  const sameSelection = (a: readonly T[], b: readonly T[]): boolean => {
    if (a.length !== b.length) return false;
    return a.every((value, index) => Object.is(keyOf(value), keyOf(b[index] as T)));
  };

  const commit = (next: readonly T[]): void => {
    const current = untrack(() => selection.get());
    if (options.disallowEmptySelection && next.length === 0 && current.length > 0) return;
    if (sameSelection(current, next)) return;
    selection.set(next);
    options.onSelectionChange?.(next);
  };

  const withValue = (index: number, apply: (value: T) => void): void => {
    const value = valueAt(index);
    // An option whose value is unknown — never rendered, and no `items` to ask
    // — is skipped rather than selected as `undefined`, which would put a hole
    // in the consumer's selection array.
    if (value === undefined) return;
    apply(value);
  };

  const selectValue = (value: T): void => {
    if (mode === 'none') return;
    if (!multiselect) {
      commit([value]);
      return;
    }
    if (untrack(() => isSelected(value))) return;
    commit([...untrack(() => selection.get()), value]);
  };

  const deselectValue = (value: T): void => {
    if (mode === 'none') return;
    const key = keyOf(value);
    commit(untrack(() => selection.get()).filter((held) => !Object.is(keyOf(held), key)));
  };

  const toggleValue = (value: T): void => {
    if (mode === 'none') return;
    if (untrack(() => isSelected(value))) deselectValue(value);
    else selectValue(value);
  };

  /** Replace the whole selection with one option — a plain press in any mode. */
  const replaceAt = (index: number): void => {
    if (mode === 'none') return;
    withValue(index, (value) => commit([value]));
  };

  const toggleAt = (index: number): void => {
    withValue(index, toggleValue);
  };

  /**
   * Select every option between two positions.
   *
   * `additive` keeps whatever was selected outside the range, which is what
   * Shift+Arrow means in a `multiple` list — options toggled one at a time
   * earlier are still selected. In `extended` mode the range *is* the
   * selection, matching every file manager.
   */
  const selectRange = (from: number, to: number, additive: boolean): void => {
    if (!multiselect) return;
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    if (low < 0) return;

    const kept = additive ? [...untrack(() => selection.get())] : [];
    const keys = new Set(kept.map(keyOf));

    for (let index = low; index <= high; index++) {
      if (disabledAt(index)) continue;
      const value = valueAt(index);
      if (value === undefined) continue;
      const key = keyOf(value);
      if (keys.has(key)) continue;
      keys.add(key);
      kept.push(value);
    }
    commit(kept);
  };

  const everyValue = (): T[] => {
    const values: T[] = [];
    const n = count();
    for (let index = 0; index < n; index++) {
      if (disabledAt(index)) continue;
      const value = valueAt(index);
      if (value !== undefined) values.push(value);
    }
    return values;
  };

  const selectAll = (): void => {
    if (!multiselect) return;
    commit(everyValue());
  };

  const clear = (): void => commit([]);

  /**
   * The first selected option's position, or -1.
   *
   * The APG enters a listbox on the selected option rather than on the first
   * one: a Select showing Cherry whose tab stop is Apple makes the reader walk
   * back to where they already were, and tells a screen reader nothing about
   * what is currently chosen. Scanning is only done while something is
   * selected, so the common empty case costs one set lookup.
   */
  const selectedIndex = (): number => {
    if (selectedKeys.get().size === 0) return -1;
    const n = count();
    for (let index = 0; index < n; index++) {
      const value = valueAt(index);
      if (value !== undefined && isSelected(value)) return index;
    }
    return -1;
  };

  /**
   * Ctrl+A toggles rather than only selecting, because the same press has to
   * undo itself — there is no other key for "none of them", and pressing it
   * twice is what everyone tries.
   */
  const toggleAll = (): void => {
    const all = everyValue();
    const selected = untrack(() => selectedKeys.get());
    const complete = all.length > 0 && all.every((value) => selected.has(keyOf(value)));
    commit(complete ? [] : all);
  };

  // --- Movement ------------------------------------------------------------

  const roving = createRovingFocus(
    collection,
    () => elementAt(untrack(() => active.get())),
    (el) => {
      const index = indexOf(el);
      if (index >= 0) setActive(index);
    },
    {
      orientation: horizontal ? 'horizontal' : 'vertical',
      loop,
      // Both are this primitive's own: the keys are handled over indices, so
      // that a target outside a virtualized window is still reachable.
      typeahead: false,
    },
  );

  const rtl = (): boolean => resolveDirection(options.listbox()) === 'rtl';

  /**
   * Where a move counts from: the active option, or — before anything has been
   * moved to — the option the listbox was entered on. A listbox opened on
   * Cherry arrows to Elderberry, not back to Apple.
   */
  const startIndex = (): number => {
    const current = untrack(() => active.get());
    return current >= 0 ? current : selectedIndex();
  };

  /** The nearest option at or after `from` that can be moved to, or -1. */
  const scanEnabled = (from: number, direction: number): number => {
    const n = count();
    if (n === 0) return -1;
    let index = from;
    for (let step = 0; step < n; step++) {
      if (index < 0 || index >= n) {
        if (!loop) return -1;
        index = ((index % n) + n) % n;
      }
      if (!disabledAt(index)) return index;
      index += direction;
    }
    return -1;
  };

  /**
   * Where a move of `delta` lands.
   *
   * `clamp` is for the page keys: paging past the top means the top, whereas
   * arrowing past it means staying put — the ends of a list are worth feeling.
   */
  const step = (delta: number, clamp: boolean): number => {
    const n = count();
    if (n === 0) return -1;

    const from = startIndex();
    // With nothing active, forward starts before the first option and backward
    // after the last, so one press lands on an end rather than two.
    const start = from < 0 ? (delta > 0 ? -1 : n) : from;
    let target = start + delta;

    if (target < 0 || target >= n) {
      if (clamp) target = target < 0 ? 0 : n - 1;
      else if (!loop) return -1;
    }

    const direction = delta > 0 ? 1 : -1;
    const found = scanEnabled(target, direction);
    // A clamped page landing in a run of disabled options at the end has
    // nowhere further to go, so it comes back the other way rather than refuse.
    return found >= 0 ? found : scanEnabled(target, -direction);
  };

  /** How many options a page key moves by. */
  const pageStep = (): number => {
    if (options.pageSize !== undefined) return Math.max(1, Math.trunc(options.pageSize));

    if (virtualizer) {
      const range = untrack(() => virtualizer.range());
      const visible = range.visibleEndIndex - range.visibleStartIndex;
      if (visible > 0) return visible;
    }

    const root = options.listbox();
    const el = elementAt(untrack(() => active.get())) ?? elementAt(0);
    if (root && el) {
      const size = horizontal ? el.offsetWidth : el.offsetHeight;
      const viewport = horizontal ? root.clientWidth : root.clientHeight;
      if (size > 0 && viewport > 0) return Math.max(1, Math.floor(viewport / size));
    }
    return DEFAULT_PAGE_SIZE;
  };

  const reveal = (index: number): void => {
    if (virtualizer) {
      virtualizer.scrollToIndex(index, { align: 'nearest' });
      return;
    }
    const el = elementAt(index);
    // `block: nearest` leaves an option that is already on screen exactly where
    // it is, which is the difference between scrolling and jerking.
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  const focusIndex = (index: number): void => {
    if (index < 0 || index >= count()) return;
    setActive(index);
    reveal(index);

    if (virtualFocus) return;
    const el = elementAt(index);
    // Roving focus owns the DOM move, so that the tab stop and the focused
    // element never disagree about which option is current.
    if (el) roving.focus(el);
    else if (virtualizer) pendingFocus = index;
  };

  // --- Keyboard ------------------------------------------------------------

  let search = '';
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  onCleanup(() => {
    if (searchTimer !== null) clearTimeout(searchTimer);
  });

  /**
   * The first option after `from` whose text starts with `query`.
   *
   * Compared with a collator rather than with `startsWith`, so that typing "e"
   * finds "Éclair" and typing "o" finds "Öl". A listbox of names is exactly
   * where an accent-blind search is the difference between typeahead working
   * and typeahead being useless.
   */
  const typeaheadMatch = (query: string, from: number): number => {
    const n = count();
    if (n === 0 || query === '') return -1;

    const collator = locale.collator({ sensitivity: 'base', usage: 'search', numeric: false });
    // Split by code point: slicing a prefix by code unit can cut a surrogate
    // pair in half and produce a string that compares equal to nothing.
    const needle = [...query];

    for (let offset = 1; offset <= n; offset++) {
      const index = (((from + offset) % n) + n) % n;
      if (disabledAt(index)) continue;
      const text = [...textAt(index)];
      if (text.length < needle.length) continue;
      if (collator.compare(text.slice(0, needle.length).join(''), query) === 0) return index;
    }
    return -1;
  };

  const typeahead = (key: string): number => {
    search += key;
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      search = '';
      searchTimer = null;
    }, options.typeaheadTimeout ?? TYPEAHEAD_TIMEOUT);

    // Repeating one character walks through the options starting with it,
    // rather than searching for "aaa" — what every native listbox does.
    const query =
      search.length > 1 && [...search].every((char) => char === search[0]) ? search[0]! : search;

    const from = startIndex();
    // A repeated character must move on from the current option; a growing
    // search must be allowed to match it, or typing the second letter of the
    // option you are already on jumps away from it. With nothing active both
    // start before the first option.
    return typeaheadMatch(query, from < 0 ? -1 : query === search ? from - 1 : from);
  };

  /**
   * Apply a move, and whatever it does to the selection.
   *
   * `extend` is passed rather than read back off the event, because Shift is
   * only a range gesture on the keys that are moves. A capital F is a shifted
   * keypress that means "jump to Fig", and reading `shiftKey` there swept the
   * whole selection from the anchor to the match. Synthesising an unshifted
   * event for the typeahead path was the alternative, and it loses the real
   * modifier state for anything that later wants it.
   *
   * Returns true whether or not anything moved: an arrow key inside a listbox
   * is consumed either way, or the page scrolls underneath a list that has
   * simply reached its end.
   */
  const applyMove = (target: number, extend: boolean, modified: boolean): boolean => {
    if (target < 0) return true;

    const previous = untrack(() => active.get());
    focusIndex(target);
    if (mode === 'none') return true;

    // Shift+Arrow means different things in the two patterns, and conflating
    // them is why a range can come out either too large or one item wide.
    //
    // In a multi-select listbox the APG has Shift+Arrow "move focus to and
    // toggle the selected state of" the next option — one option at a time,
    // building a selection as you go. In an extended-selection listbox it
    // extends a contiguous range from the anchor instead, which is the
    // convention every desktop file list uses.
    if (extend && multiselect) {
      if (mode === 'multiple') {
        toggleAt(target);
        // The anchor follows the last option actually selected, because that
        // is what Shift+Space later ranges from.
        anchor = target;
      } else {
        if (anchor < 0) anchor = previous >= 0 ? previous : target;
        selectRange(anchor, target, false);
      }
      return true;
    }

    // Ctrl moves without selecting: the escape hatch that makes an extended
    // list navigable at all once something is selected.
    if (modified) return true;

    // A plain move re-anchors only when it also selects. Where the arrows
    // merely move focus, Shift+Space still has to range from the last
    // *selected* option — otherwise the range collapses onto one item.
    if (followsFocus || mode !== 'multiple') anchor = target;
    if (followsFocus) replaceAt(target);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (isListboxDisabled()) return false;
    // Alt belongs to whatever wraps this: Alt+ArrowDown opens a combobox, and
    // a listbox that swallowed it would break the control around it.
    if (event.altKey) return false;

    const modified = event.ctrlKey || event.metaKey;

    if (modified && !event.shiftKey && (event.key === 'a' || event.key === 'A')) {
      if (!multiselect) return false;
      toggleAll();
      return true;
    }

    const forward = horizontal ? (rtl() ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown';
    const back = horizontal ? (rtl() ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp';

    const extend = event.shiftKey;

    switch (event.key) {
      case forward:
        return applyMove(step(1, false), extend, modified);
      case back:
        return applyMove(step(-1, false), extend, modified);
      case 'PageDown':
        return applyMove(step(pageStep(), true), extend, modified);
      case 'PageUp':
        return applyMove(step(-pageStep(), true), extend, modified);
      case 'Home':
        return applyMove(scanEnabled(0, 1), extend, modified);
      case 'End':
        return applyMove(scanEnabled(count() - 1, -1), extend, modified);

      case 'Enter':
      case ' ': {
        const index = untrack(() => active.get());
        if (index < 0 || mode === 'none') return false;

        // Shift+Space is the one way to take a range with the keyboard without
        // moving: from the anchor to wherever the user has arrowed to.
        if (event.key === ' ' && event.shiftKey && multiselect) {
          selectRange(anchor < 0 ? index : anchor, index, mode === 'multiple');
          return true;
        }

        anchor = index;
        // Ctrl+Space toggles one option and leaves the rest, which is the only
        // way to build a scattered selection from the keyboard.
        if (mode === 'multiple' || (modified && multiselect)) toggleAt(index);
        else replaceAt(index);
        return true;
      }

      default:
        break;
    }

    if (options.typeahead === false || modified) return false;
    // Single printable characters only: anything longer is a named key. Space
    // is already spoken for above.
    if (event.key.length !== 1 || event.key === ' ') return false;

    const match = typeahead(event.key);
    if (match < 0) return false;
    // Never extending: a capital letter is how a listbox of proper nouns is
    // searched, not a request for a range.
    return applyMove(match, false, false);
  };

  // --- Pointer -------------------------------------------------------------

  const optionFrom = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>(`[${OPTION_ATTRIBUTE}]`);
  };

  const onOptionClick = (event: MouseEvent): void => {
    if (isListboxDisabled()) return;
    const index = indexOf(optionFrom(event.target));
    if (index < 0) return;

    if (disabledAt(index)) {
      // A disabled option still swallows the press: it is visibly there, and an
      // `<a>` option would otherwise follow its href.
      event.preventDefault();
      return;
    }

    focusIndex(index);
    if (mode === 'none') return;

    const modified = event.ctrlKey || event.metaKey;

    if (event.shiftKey && multiselect) {
      if (anchor < 0) anchor = index;
      // Ctrl+Shift adds a second range to what is already selected.
      selectRange(anchor, index, modified);
      return;
    }

    anchor = index;
    if (mode === 'multiple' || (modified && multiselect)) toggleAt(index);
    else replaceAt(index);
  };

  const onOptionPointerMove = (event: PointerEvent): void => {
    if (options.focusOnHover !== true || isListboxDisabled()) return;
    const index = indexOf(optionFrom(event.target));
    // Pointer *move* rather than enter, because a list that opens under a
    // stationary cursor, or scrolls beneath it, never fires enter — and moving
    // within an option fires this many times, hence the check.
    if (index < 0 || disabledAt(index) || index === untrack(() => active.get())) return;
    focusIndex(index);
  };

  // --- Focus entering ------------------------------------------------------

  /**
   * Keep this primitive's idea of the active option and the browser's idea of
   * the focused element in agreement when focus arrives from outside.
   *
   * Tab puts DOM focus on whichever option holds the tab stop and says nothing
   * about it. Without hearing that, `active` is still -1 while the user is
   * plainly standing on an option, and the first ArrowDown "moves" to the
   * option they are already on. Listening here rather than asking the consumer
   * to bind a `:focusin`: an invariant that the widget breaks on its own is
   * not something a consumer should have to remember to repair.
   *
   * Only under roving focus. Virtual focus deliberately leaves DOM focus
   * wherever it is, so focus landing inside the listbox means nothing there.
   */
  if (!virtualFocus) {
    effect(() => {
      const root = options.listbox();
      if (!root) return;

      const onFocusIn = (event: Event): void => {
        // A disabled listbox has no active option to have, whichever way focus
        // arrived, so there is nothing here to hear.
        if (isListboxDisabled()) return;
        focusWithin = true;
        const index = indexOf(optionFrom(event.target));
        // A browser focuses a `tabindex="-1"` element on mousedown, so a
        // disabled option can hold DOM focus even though navigation refuses it
        // everywhere else. Making it active would move the listbox's only tab
        // stop onto an `aria-disabled` element, stranding Tab there.
        if (index >= 0 && !disabledAt(index)) setActive(index);
      };

      const onFocusOut = (event: Event): void => {
        // An option unmounted under the reader blurs with nowhere to go. That
        // is focus being dropped, not focus leaving, and the virtualized
        // recovery above needs to tell the two apart. Engines differ on
        // whether they announce it at all, so both are handled.
        const target = event.target;
        if (target instanceof Element && !target.isConnected) return;
        // `Element` has no typed map entry for focusout, so the event arrives
        // as a bare `Event` and `relatedTarget` has to be asked for.
        const next = 'relatedTarget' in event ? event.relatedTarget : null;
        focusWithin = next instanceof Node && root.contains(next);
      };

      root.addEventListener('focusin', onFocusIn);
      root.addEventListener('focusout', onFocusOut);
      onCleanup(() => {
        root.removeEventListener('focusin', onFocusIn);
        root.removeEventListener('focusout', onFocusOut);
      });
    });
  }

  // --- Naming --------------------------------------------------------------

  const groupIds = new Map<string | number, string>();
  const groupId = (key: string | number): string => {
    let id = groupIds.get(key);
    if (id === undefined) {
      id = createId(`${baseId}-g`);
      groupIds.set(key, id);
    }
    return id;
  };

  /**
   * Whether a heading was actually rendered for a group.
   *
   * `groupLabelProps` being called is the only honest evidence there is one. A
   * group named by its own `aria-label`, or whose heading sits behind an
   * `:if`, would otherwise carry an `aria-labelledby` pointing at nothing —
   * and a dangling reference hides a missing name rather than reporting it,
   * which is the rule dialog.ts states for the same attribute. Probing the DOM
   * the way dialog.ts does cannot work here: a group's props are computed
   * before its own children exist, so the probe would always say no.
   *
   * It has to come back down as well as go up. A heading behind an `:if` that
   * turns false is exactly the case above, arriving late: the answer was true
   * once and the reference would outlive it. So the flag is released on the
   * cleanup of the effect that rendered the heading, the same way an option
   * releases its position.
   */
  const groupLabelled = new Map<string | number, Signal.State<boolean>>();
  const hasGroupLabel = (key: string | number): Signal.State<boolean> => {
    let state = groupLabelled.get(key);
    if (state === undefined) {
      state = new Signal.State(false);
      groupLabelled.set(key, state);
    }
    return state;
  };

  const selectedLabel =
    options.labels?.selected ?? ((n: number) => locale.t('selected', { n }));

  // --- Props ---------------------------------------------------------------

  /** The option the tab stop sits on. */
  const tabStopIndex = (): number => {
    const current = active.get();
    // Before anything has been moved to, the selected option holds it — and
    // only then the first option, which is where a listbox with no answer yet
    // should be entered.
    const entry = current >= 0 ? current : selectedIndex();
    return withinWindow(entry >= 0 ? entry : scanEnabled(0, 1));
  };

  /**
   * The option `aria-activedescendant` may name, or undefined.
   *
   * Never an option that is not rendered: an id that left with a virtualized
   * window leaves the reader with no virtual cursor at all, and no way to tell
   * that is what happened. Reporting nothing at least reports honestly.
   */
  const cursorId = (): string | undefined => {
    const current = active.get();
    const index = current >= 0 ? current : selectedIndex();
    if (index < 0 || !isWindowed(index) || !isPresent(index)) return undefined;
    return optionId(index);
  };

  return {
    selectedValues: () => selection.get(),
    selectedValue: () => selection.get()[0] ?? null,
    isSelected,
    count,

    activeIndex: () => active.get(),
    activeValue: () => valueAt(active.get()),
    activeOption: () => elementAt(active.get()),

    select: selectValue,
    deselect: deselectValue,
    toggle: toggleValue,
    selectAll,
    clear,

    focusIndex,
    focusFirst: () => focusIndex(scanEnabled(0, 1)),
    focusLast: () => focusIndex(scanEnabled(count() - 1, -1)),

    onKeyDown,
    onOptionClick,
    onOptionPointerMove,

    listboxProps: () => ({
      ...(virtualizer ? virtualizer.scrollerProps() : {}),
      id: baseId,
      role: 'listbox',
      // ARIA defaults a listbox to vertical, so only the other case is worth
      // saying.
      'aria-orientation': horizontal ? 'horizontal' : undefined,
      'aria-multiselectable': multiselect ? 'true' : undefined,
      'aria-labelledby': options.labelledBy,
      'aria-label': options.labelledBy ? undefined : options.label,
      'aria-disabled': isListboxDisabled() ? 'true' : undefined,
      'aria-activedescendant': virtualFocus && focusable ? cursorId() : undefined,
      tabindex: focusable ? '0' : undefined,
      'data-orientation': horizontal ? 'horizontal' : 'vertical',
    }),

    optionProps: (option) => {
      const { index } = option;
      markPresent(index);
      const value = option.value ?? valueAt(index);
      if (value !== undefined) rendered.set(index, value);

      const disabled = option.disabled ?? options.isDisabled?.(index) ?? false;
      const selected = value !== undefined && isSelected(value);
      const isActive = active.get() === index;

      return {
        ...(virtualizer ? virtualizer.itemProps(index) : {}),
        [OPTION_ATTRIBUTE]: String(index),
        id: optionId(index),
        role: 'option',
        // In a single-select listbox every option is selectable by definition
        // of the role, so `aria-selected="false"` on all of them is twenty
        // announcements of a fact already known. Where several may be chosen it
        // is the opposite: "not selected" is what tells the user this one can be
        // toggled on, so it is stated on every option.
        'aria-selected': multiselect ? String(selected) : selected ? 'true' : undefined,
        // `aria-disabled`, never the `disabled` attribute: a disabled option
        // stays in the accessibility tree, so it can be found and heard to be
        // unavailable rather than appear to have vanished. The `data-` twin is
        // what navigation skips by.
        'aria-disabled': disabled ? 'true' : undefined,
        'data-disabled': disabled ? '' : undefined,
        'data-selected': selected ? '' : undefined,
        // The only sign of the active option under virtual focus, where nothing
        // is really focused and `:focus` never matches.
        'data-active': isActive ? '' : undefined,
        'data-label': option.textValue,
        // Under virtual focus no option is focusable; otherwise exactly one is,
        // so Tab enters and leaves the whole listbox in a single press.
        tabindex: virtualFocus ? undefined : tabStopIndex() === index ? '0' : '-1',
      };
    },

    groupProps: (key) => ({
      role: 'group',
      'aria-labelledby': hasGroupLabel(key).get() ? groupId(key) : undefined,
    }),

    groupLabelProps: (key) => {
      // Rendering the heading is what makes the reference above true, and
      // un-rendering it is what makes it false again.
      const labelled = hasGroupLabel(key);
      labelled.set(true);
      onCleanup(() => labelled.set(false));
      return {
        id: groupId(key),
        // A heading between a listbox and its options would be an extra child
        // in the accessibility tree that the role does not allow, and would be
        // read twice — once as itself and once as the group's name.
        role: 'presentation',
      };
    },

    activeDescendantProps: () => ({ 'aria-activedescendant': cursorId() }),

    virtualItems: () => virtualizer?.items() ?? [],

    sizerProps: () =>
      virtualizer ? { ...virtualizer.sizerProps(), role: 'presentation' } : {},

    containerProps: () =>
      virtualizer ? { ...virtualizer.containerProps(), role: 'presentation' } : {},

    scrollToIndex: (index, scrollOptions) => virtualizer?.scrollToIndex(index, scrollOptions),

    /**
     * How many options are selected.
     *
     * Only for a multi-select listbox: "1 selected" is noise where one is all
     * there can be, and the option itself has already been announced.
     */
    status: () => (multiselect ? selectedLabel(selection.get().length) : ''),

    /**
     * A live region is offered rather than assumed, and nothing renders it for
     * you. Announcing the count is worth it where a press changes several
     * options at once — a range, or select-all — and needless where it changes
     * the one option that was just announced.
     */
    statusProps: () => ({ role: 'status' }),
  };
}
