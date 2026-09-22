/**
 * Toggle and toggle group — a button that stays down, and a set of them.
 *
 * A toggle keeps `role="button"` and says which state it is in with
 * `aria-pressed`. It is deliberately not a switch and not a checkbox: a switch
 * is announced as on or off, a checkbox belongs to a form and submits a value,
 * and a toggle button is an action that stays applied — bold, mute, pin.
 *
 *   class Editor {
 *     bold = createToggle({ label: 'Bold' });
 *   }
 *
 *   <button :spread="bold.props()">B</button>
 *
 * A toggle group is a set of them over one value, holding one tab stop: the
 * arrows move within the group and Tab steps over it. Selection is single or
 * multiple, and single selection where one item must stay chosen is a radio
 * group — so that is the role it takes, with radios inside it, because
 * "exactly one of these" has no other correct announcement.
 *
 *   class Toolbar {
 *     group = new Signal.State<Element | null>(null);
 *     align = createToggleGroup({
 *       group: () => this.group.get(),
 *       deselectable: false,
 *       label: 'Alignment',
 *     });
 *     options = [{ value: 'left', text: 'Left' }, { value: 'right', text: 'Right' }];
 *   }
 *
 *   <div :ref="group" :spread="align.groupProps()">
 *     <button :for="opt in options" :key="opt.value"
 *             :spread="align.itemProps(opt.value, opt)">{ opt.text }</button>
 *   </div>
 *
 * Items are addressed by value, not by element. A list rendered with `:for`
 * has nowhere stable to hang a per-item ref, and the value is what the group
 * is about in any case; the element behind a value is found through the
 * collection when one is needed. That is also what keeps the group's tab stop
 * across a re-render that replaces every item element with a new one.
 *
 * Both components own their keyboard, so the handlers travel in the prop
 * objects rather than being left to the consumer to wire up. Nothing here
 * renders, and nothing here has an opinion about styling.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createCollection, ITEM_ATTRIBUTE } from './collection.js';
import { createRovingFocus } from './roving-focus.js';

/** Written to `data-state`, so CSS has something to select on. */
export type ToggleState = 'on' | 'off';

/**
 * A handler in a prop object. `:spread` attaches every prop whose name starts
 * with `on` as a listener, and the DOM types it no more precisely than this.
 */
export type ToggleHandler = (event: Event) => void;

export interface ToggleProps {
  readonly [key: string]: string | boolean | undefined | ToggleHandler;
}

export interface ToggleOptions {
  /**
   * Supply a signal to control the toggle from outside. Without one it owns
   * its own state, which is what most callers want.
   */
  pressed?: Signal.State<boolean>;
  defaultPressed?: boolean;

  /**
   * An accessor rather than a boolean, because the options are read once at
   * construction and a disabled state usually comes from something that
   * changes — a pending save, a permission.
   */
  disabled?: () => boolean;

  /**
   * Accessible name, for a toggle whose content is an icon. A function of the
   * state as well, because that name often changes with it — "Mute" against
   * "Unmute" — and every string a user can be told has to be replaceable.
   */
  label?: string | ((pressed: boolean) => string);

  onPressedChange?: (pressed: boolean) => void;
}

export interface Toggle {
  isPressed(): boolean;
  isDisabled(): boolean;
  /** `on` or `off`, matching the `data-state` attribute. */
  state(): ToggleState;

  press(): void;
  release(): void;
  toggle(): void;

  props(): ToggleProps;
}

export function createToggle(options: ToggleOptions = {}): Toggle {
  const state = options.pressed ?? new Signal.State(options.defaultPressed ?? false);
  const isDisabled = (): boolean => options.disabled?.() ?? false;

  const setPressed = (next: boolean): void => {
    if (state.get() === next) return;
    state.set(next);
    options.onPressedChange?.(next);
  };

  // The handlers are built once and handed out unchanged. `:spread` reattaches
  // everything it holds on every update, and the DOM only ignores a repeated
  // listener when it is the very same function — a fresh arrow per update
  // would leave one extra listener behind per press, and the toggle would
  // start flipping twice, then three times.
  const onClick: ToggleHandler = () => {
    // `aria-disabled` stops nothing by itself: the press arrives on a
    // `<button>` exactly as it does on a `<div role="button">`, and is refused
    // here for both.
    if (isDisabled()) return;
    setPressed(!state.get());
  };

  const onKeyDown: ToggleHandler = (event) => {
    if (!isKeyboardEvent(event)) return;
    if (event.key !== ' ' && event.key !== 'Enter') return;
    // A modified key is a shortcut, not an activation.
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // A real button already turns both keys into a click, which `onClick`
    // answers; acting here as well would toggle twice for one press. Anything
    // else gets the activation the browser will not give it.
    if (isNativeButton(elementOf(event.currentTarget))) return;

    // Space scrolls the page otherwise — a disabled toggle still has focus, so
    // it is cancelled before the activation is refused. It activates on
    // keydown here, where a native button waits for keyup; matching that means
    // carrying the press across two events to catch the one that is released
    // somewhere else, which is a lot of state for a case a toggle rarely sees.
    event.preventDefault();
    if (isDisabled()) return;
    setPressed(!state.get());
  };

  return {
    isPressed: () => state.get(),
    isDisabled,
    state: () => (state.get() ? 'on' : 'off'),

    press: () => setPressed(true),
    release: () => setPressed(false),
    // Disabled blocks the handlers above, not this: a control can be disabled
    // and still be changed by the application that disabled it.
    toggle: () => setPressed(!state.get()),

    props: () => {
      const pressed = state.get();
      const disabled = isDisabled();
      return {
        // Headless cannot see which element it was handed, so both cases are
        // covered at once: `role` is redundant on a `<button>` and the only
        // thing that makes a `<div>` announce as one, and `type` is inert on a
        // `<div>` and the only thing stopping a `<button>` submitting the form
        // it sits in.
        role: 'button',
        type: 'button',
        // Disabled stays in the tab order, with `aria-disabled` rather than
        // the `disabled` attribute, because a control a keyboard user cannot
        // reach is a control they cannot discover is there. The handlers above
        // refuse the press instead. A `<div role="button">` is unreachable
        // without this, and a real button is already at 0.
        tabindex: '0',
        'aria-pressed': pressed ? 'true' : 'false',
        'aria-disabled': disabled ? 'true' : undefined,
        'aria-label': labelFor(options.label, pressed),
        'data-state': pressed ? 'on' : 'off',
        'data-disabled': disabled ? '' : undefined,
        onclick: onClick,
        onkeydown: onKeyDown,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Toggle group
// ---------------------------------------------------------------------------

/** Carries an item's value on the element, so the two can be mapped either way. */
const VALUE_ATTRIBUTE = 'data-value';

export interface ToggleGroupProps {
  readonly [key: string]: string | undefined | ToggleHandler;
}

export interface ToggleGroupItemProps {
  readonly [key: string]: string | undefined;
}

export interface ToggleGroupItemOptions {
  /** Disable this item alone. */
  disabled?: boolean;
  /** Accessible name, for an item whose content is an icon. */
  label?: string;
}

export interface ToggleGroupBaseOptions {
  /** The element the items are rendered into. */
  group: () => Element | null | undefined;

  /** Which arrows move, and how the group is laid out. Default horizontal. */
  orientation?: 'horizontal' | 'vertical';
  /** Arrows wrap past the ends. Default true. */
  loop?: boolean;

  /**
   * The last selected item can be deselected. Default true.
   *
   * Turning it off in single mode is what makes the group a radio group:
   * "exactly one is chosen" is the radio contract, and the role follows the
   * behaviour rather than being asked for separately.
   */
  deselectable?: boolean;

  /** Disable the whole group. An accessor, for the reason `Toggle` gives. */
  disabled?: () => boolean;

  /**
   * Moving focus selects. Defaults to true for a radio group, where the APG
   * requires it, and false everywhere else — a toolbar whose buttons applied
   * themselves as you arrowed past would be unusable.
   */
  selectionFollowsFocus?: boolean;

  /**
   * Typing a letter jumps to a matching item. Off by default: a toggle group
   * is often icons with no text to match, and swallowing letters that match
   * nothing is worse than not looking.
   */
  typeahead?: boolean;

  /** Accessible name for the group. */
  label?: string;
  /** Id of an element naming the group, when one is already on the page. */
  labelledBy?: string;
}

export interface ToggleGroupSingleOptions extends ToggleGroupBaseOptions {
  /** One value at a time. The default. */
  type?: 'single';
  value?: Signal.State<string | null>;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
}

export interface ToggleGroupMultipleOptions extends ToggleGroupBaseOptions {
  /** Any number of values, in the order they were chosen. */
  type: 'multiple';
  value?: Signal.State<string[]>;
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
}

export type ToggleGroupOptions = ToggleGroupSingleOptions | ToggleGroupMultipleOptions;

export interface ToggleGroupBase {
  isSelected(value: string): boolean;
  /** Whether the group as a whole is disabled. */
  isDisabled(): boolean;

  select(value: string): void;
  deselect(value: string): void;
  toggle(value: string): void;

  /** Move focus to an item and make it the group's tab stop. */
  focus(value: string): void;

  groupProps(): ToggleGroupProps;
  itemProps(value: string, item?: ToggleGroupItemOptions): ToggleGroupItemProps;
}

export interface ToggleGroupSingle extends ToggleGroupBase {
  value(): string | null;
}

export interface ToggleGroupMultiple extends ToggleGroupBase {
  value(): string[];
}

export type ToggleGroup = ToggleGroupSingle | ToggleGroupMultiple;

export function createToggleGroup(options: ToggleGroupSingleOptions): ToggleGroupSingle;
export function createToggleGroup(options: ToggleGroupMultipleOptions): ToggleGroupMultiple;
export function createToggleGroup(
  options: ToggleGroupOptions,
): ToggleGroupSingle | ToggleGroupMultiple {
  const selection = createSelection(options);
  const multiple = options.type === 'multiple';
  const deselectable = options.deselectable !== false;
  const orientation = options.orientation ?? 'horizontal';
  const radiogroup = !multiple && !deselectable;
  const selectionFollowsFocus = options.selectionFollowsFocus ?? radiogroup;
  const isDisabled = (): boolean => options.disabled?.() ?? false;

  const collection = createCollection(() => options.group());

  // The active item is remembered by value rather than by element, so a
  // re-render that replaces every element keeps the group's tab stop where the
  // user left it.
  const activeValue = new Signal.State<string | null>(null);

  const valueOf = (item: Element | null | undefined): string | null =>
    item?.getAttribute(VALUE_ATTRIBUTE) ?? null;

  const elementFor = (value: string | null): HTMLElement | null => {
    if (value === null) return null;
    // A scan rather than a selector: the value is the consumer's own string,
    // and escaping it for `querySelector` needs `CSS`, a browser global that
    // does not exist when rendering on a server.
    return collection.all().find((item) => valueOf(item) === value) ?? null;
  };

  const isSelected = (value: string): boolean => selection.values().includes(value);

  const select = (value: string): void => {
    if (isSelected(value)) return;
    selection.set(multiple ? [...selection.values(), value] : [value]);
  };

  const deselect = (value: string): void => {
    const values = selection.values();
    if (!values.includes(value)) return;
    const next = values.filter((current) => current !== value);
    // Refusing the last one is what separates "one of these applies" from a
    // row of independent buttons.
    if (next.length === 0 && !deselectable) return;
    selection.set(next);
  };

  const toggle = (value: string): void => {
    if (isSelected(value)) deselect(value);
    else select(value);
  };

  /** Toggle the item an interaction landed on, if the group allows it. */
  const activate = (item: HTMLElement | null): void => {
    if (!item || isDisabled() || !collection.enabled().includes(item)) return;
    const value = valueOf(item);
    if (value === null) return;
    // The tab stop follows use, so Tab comes back to the item last acted on.
    activeValue.set(value);
    toggle(value);
  };

  /** The item an event happened on, if it belongs to this group. */
  const itemFrom = (target: EventTarget | null): HTMLElement | null => {
    const el = elementOf(target);
    const item = el?.closest<HTMLElement>(`[${ITEM_ATTRIBUTE}]`) ?? null;
    // `closest` climbs straight past the group, so a group nested inside
    // somebody else's item would otherwise answer for that item.
    return item && options.group()?.contains(item) ? item : null;
  };

  const roving = createRovingFocus(
    collection,
    () => elementFor(activeValue.get()),
    (item) => activeValue.set(valueOf(item)),
    {
      // A radio group answers to both arrow pairs whatever its layout, because
      // it is one control with one value; a toolbar is a row of separate
      // controls and owns only its own axis. The cost is that Up and Down stop
      // scrolling the page while a horizontal radio group has focus.
      orientation: radiogroup ? 'both' : orientation,
      loop: options.loop !== false,
      typeahead: options.typeahead === true,
      onSelect: (item) => {
        // Enter and Space on a real button are already on their way to a click
        // of their own, which `onClick` answers.
        if (isNativeButton(item)) return;
        activate(item);
      },
    },
  );

  const onClick: ToggleHandler = (event) => activate(itemFrom(event.target));

  const onKeyDown: ToggleHandler = (event) => {
    if (!isKeyboardEvent(event) || isDisabled()) return;

    const previous = activeValue.get();
    if (!roving.onKeyDown(event)) return;

    // Cancelling Enter or Space on a real button cancels the click it was
    // about to become, and the press would then do nothing at all.
    const activating = event.key === 'Enter' || event.key === ' ';
    if (activating && isNativeButton(elementFor(activeValue.get()))) return;

    // Arrows scroll, and so does Space: a key the group has answered must not
    // move the page as well.
    event.preventDefault();

    const current = activeValue.get();
    if (selectionFollowsFocus && current !== null && current !== previous) select(current);
  };

  // Tab lands on the group's one tab stop without any key having moved it, so
  // the focused item has to be picked up from the DOM — otherwise the first
  // arrow press would "move" to the item already focused and appear dead.
  const onFocusIn: ToggleHandler = (event) => {
    const item = itemFrom(event.target);
    if (item) activeValue.set(valueOf(item));
  };

  /**
   * Which item holds the group's single tab stop.
   *
   * The APG puts it on the chosen item, so Tab arrives at what is in effect
   * rather than at the start of the row, and on the last item used after that.
   *
   * It is settled in an effect rather than while the item props are built,
   * because the answer comes from the DOM and Volt runs render effects before
   * user effects: asked from inside a render, the first item would be asking
   * before its siblings exist, every item would answer "not me", and the group
   * would be unreachable by Tab. By here the items are on the page.
   */
  const tabStop = new Signal.State<string | null>(null);
  const itemsRevision = new Signal.State(0);

  effect(() => {
    // A disabled group keeps its one way in, as a disabled checkbox keeps its
    // tab stop. Every item then carries `data-disabled`, so the stop is chosen
    // among all of them; in a group that is enabled, an item disabled on its
    // own is passed over here as the arrows pass over it.
    const items = isDisabled() ? collection.all() : collection.enabled();
    itemsRevision.get();

    const active = activeValue.get();
    // An active item that has since been removed or disabled would otherwise
    // leave every remaining item at -1.
    if (active !== null && items.some((item) => valueOf(item) === active)) {
      tabStop.set(active);
      return;
    }

    const values = selection.values();
    const chosen = items.find((item) => {
      const value = valueOf(item);
      return value !== null && values.includes(value);
    });
    tabStop.set(valueOf(chosen ?? items[0]));
  });

  // Nothing announces that the item list changed: a `:for` over rows that
  // arrive later renders items this group is never told about, and the effect
  // above would keep the tab stop it settled on an empty list. Watching the
  // group element is the only way to hear about them. Attributes are watched
  // too, since an item disabled while it holds the tab stop has to hand it on.
  // Some of those writes come from the item props themselves, so this does see
  // its own work — but the tab stop is a signal, and a run that reaches the
  // same answer ends there.
  effect(() => {
    const root = options.group();
    if (!root || typeof MutationObserver === 'undefined') return;

    const observer = new MutationObserver(() => itemsRevision.set(itemsRevision.get() + 1));
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributeFilter: [VALUE_ATTRIBUTE, 'data-disabled', 'disabled'],
    });
    onCleanup(() => observer.disconnect());
  });

  const base: ToggleGroupBase = {
    isSelected,
    isDisabled,
    select,
    deselect,
    toggle,

    focus: (value) => roving.focus(elementFor(value)),

    groupProps: () => {
      const disabled = isDisabled();
      return {
        role: radiogroup ? 'radiogroup' : 'group',
        // `group` does not support `aria-orientation`, so it is left off
        // rather than emitted for an audit to pick up later. The layout
        // reaches CSS through `data-orientation` in both cases.
        'aria-orientation': radiogroup ? orientation : undefined,
        'aria-label': options.label,
        'aria-labelledby': options.labelledBy,
        'aria-disabled': disabled ? 'true' : undefined,
        'data-orientation': orientation,
        'data-disabled': disabled ? '' : undefined,
        // One listener for the whole group rather than one per item. `:spread`
        // reattaches what it holds on every update and the DOM only ignores a
        // repeated listener when it is the same function, so per-item handlers
        // would need a cache keyed by value to avoid stacking up; the items
        // also come and go, and delegation does not care.
        onclick: onClick,
        onkeydown: onKeyDown,
        onfocusin: onFocusIn,
      };
    },

    itemProps: (value, item = {}) => {
      const disabled = isDisabled() || item.disabled === true;
      const selected = isSelected(value);
      return {
        [ITEM_ATTRIBUTE]: '',
        [VALUE_ATTRIBUTE]: value,
        role: radiogroup ? 'radio' : 'button',
        type: 'button',
        // A radio is checked, a toggle button is pressed, and neither role
        // takes the other's state.
        'aria-checked': radiogroup ? String(selected) : undefined,
        'aria-pressed': radiogroup ? undefined : String(selected),
        'aria-disabled': disabled ? 'true' : undefined,
        'aria-label': item.label,
        'data-state': selected ? 'on' : 'off',
        // The collection reads this to skip the item. The APG would rather
        // disabled items stayed focusable so they can be discovered; one rule
        // across every list beats a per-component exception, and arrowing onto
        // something that cannot be activated has its own cost.
        'data-disabled': disabled ? '' : undefined,
        tabindex: tabStop.get() === value ? '0' : '-1',
      };
    },
  };

  if (options.type === 'multiple') return { ...base, value: () => selection.values() };
  return { ...base, value: () => selection.values()[0] ?? null };
}

/**
 * The selection, as one shape whatever the caller controls it with.
 *
 * Single and multiple selection are the same set operation over a different
 * container, so everything above works in arrays and only this pair of
 * functions knows that a single-selection group stores `string | null`.
 */
interface Selection {
  values(): string[];
  set(next: string[]): void;
}

function createSelection(options: ToggleGroupOptions): Selection {
  if (options.type === 'multiple') {
    const state = options.value ?? new Signal.State<string[]>(options.defaultValue ?? []);
    return {
      values: () => state.get(),
      set: (next) => {
        if (sameValues(state.get(), next)) return;
        state.set(next);
        options.onValueChange?.(next);
      },
    };
  }

  const state = options.value ?? new Signal.State<string | null>(options.defaultValue ?? null);
  return {
    values: () => {
      const value = state.get();
      return value === null ? [] : [value];
    },
    set: (next) => {
      // Nothing above hands single selection more than one value; the last of
      // them is the one that would have won in any case.
      const value = next.at(-1) ?? null;
      if (state.get() === value) return;
      state.set(value);
      options.onValueChange?.(value);
    },
  };
}

function sameValues(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function labelFor(label: ToggleOptions['label'], pressed: boolean): string | undefined {
  return typeof label === 'function' ? label(pressed) : label;
}

function elementOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

/**
 * A keyboard event, recognised by shape rather than by `instanceof`.
 *
 * An event raised in another window — an iframe, or a test environment with
 * its own realm — is a different class object with the same properties, and
 * `instanceof` would quietly say no.
 */
function isKeyboardEvent(event: Event): event is KeyboardEvent {
  return 'key' in event;
}

/**
 * Whether the browser turns Enter and Space on this element into a click of
 * its own. `<input type="button">` and its siblings behave as a button does.
 */
function isNativeButton(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === 'BUTTON') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = el.getAttribute('type')?.toLowerCase() ?? 'text';
  return type === 'button' || type === 'submit' || type === 'reset';
}
