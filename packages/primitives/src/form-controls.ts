/**
 * Form controls — checkbox, switch and radio group.
 *
 * All three are built the same way: the consumer renders whatever the control
 * looks like, and a native input sits behind it, visually hidden, carrying the
 * value. That input is not a formality. A control assembled out of `<div>`s
 * submits nothing, validates nothing, and is invisible to `FormData`, to
 * `form.reset()`, to `:invalid`, and to the browser's own required-field
 * handling — so a headless control that leaves it out hands the job of
 * reimplementing forms to every consumer, and most of them will get it wrong.
 *
 * The visible element owns the ARIA and the keyboard; the hidden input owns
 * submission and constraint validation. Nothing here renders or styles
 * anything, with one exception: the input carries a visually-hidden style,
 * because "present but not seen" is part of how the mechanism works rather
 * than a matter of taste.
 *
 *   class Terms {
 *     input = new Signal.State<Element | null>(null);
 *     agree = createCheckbox({ input: () => this.input.get(), name: 'terms' });
 *   }
 *
 *   <label :click="agree.toggle()" :keydown="agree.onKeyDown($event)">
 *     <input :ref="input" :spread="agree.inputProps()">
 *     <span :spread="agree.controlProps()">I accept the terms</span>
 *   </label>
 *
 * Put the press handler on the outermost element a user can press — the
 * `<label>`, where there is one. A label forwards presses to the control it
 * labels, which here is the hidden input, and those forwarded presses are
 * cancelled (see `mirrorInput`) so they cannot change the input behind the
 * state's back. The label is therefore the only place a press is seen exactly
 * once, whether it landed on the box or on the words next to it.
 *
 * The control names itself from its own contents, which every one of these
 * roles supports. `label` and `labelledBy` are there for the cases that
 * cannot: an icon-only checkbox, and a radio group, whose role takes no name
 * from its contents at all.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createCollection, ITEM_ATTRIBUTE } from './collection.js';
import { createRovingFocus } from './roving-focus.js';

const { untrack } = Signal.subtle;

/**
 * A prop object to spread.
 *
 * Attributes and properties only, never handlers: a prop object is re-applied
 * whenever the state it reads changes, and a listener in one would be added
 * again on every re-application. Events are wired in the template, where the
 * consumer can see them.
 */
export interface ControlProps {
  readonly [key: string]: string | boolean | undefined;
}

/** Where a radio's value is written, so the group can read it back. */
export const RADIO_VALUE_ATTRIBUTE = 'data-value';

/**
 * The style that hides the native input without taking it off the page.
 *
 * `display: none` is the obvious answer and the wrong one. An unrendered
 * control cannot be focused, so when it is `required` and empty the browser
 * blocks the submit and then has nowhere to put the message explaining why —
 * a form that silently refuses to submit. This keeps a real box that is one
 * pixel and clipped away: enough for constraint validation to have somewhere
 * to point, too little to see. Pointer events are off so a press always lands
 * on the control the consumer rendered.
 */
export const VISUALLY_HIDDEN_INPUT_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;border:0;' +
  'clip-path:inset(50%);overflow:hidden;white-space:nowrap;pointer-events:none';

export type CheckedState = boolean | 'indeterminate';

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

export interface CheckboxOptions {
  /**
   * The hidden native input, once rendered. Without it the control still works
   * and is still announced correctly, but nothing submits, `indeterminate`
   * cannot be shown to the platform, and a wrapping `<label>` is left able to
   * toggle the input behind the state's back.
   */
  input?: () => Element | null | undefined;

  /**
   * Supply a signal to control the checkbox from outside. Without one it owns
   * its own state, which is what most callers want.
   */
  checked?: Signal.State<CheckedState>;
  defaultChecked?: CheckedState;

  /** Submitted as `name=value` while checked. Without a name it submits nothing. */
  name?: string;
  /** Defaults to `on`, the value a native checkbox submits when given none. */
  value?: string;

  disabled?: () => boolean;
  required?: () => boolean;

  /** Accessible name, for a control with no text of its own. */
  label?: string;
  /** Id of the element that names it, when something visible does. */
  labelledBy?: string;

  onCheckedChange?: (checked: CheckedState) => void;
}

export interface Checkbox {
  /** `true`, `false`, or `indeterminate`. */
  checked(): CheckedState;
  isChecked(): boolean;
  isIndeterminate(): boolean;
  isDisabled(): boolean;

  setChecked(state: CheckedState): void;
  /** Indeterminate counts as unchecked, so toggling it checks the box. */
  toggle(): void;

  /** Handle a keydown. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;

  /** The element the user operates. */
  controlProps(): ControlProps;
  /** The visually hidden native input that submits. */
  inputProps(): ControlProps;
}

export function createCheckbox(options: CheckboxOptions = {}): Checkbox {
  const state = options.checked ?? new Signal.State<CheckedState>(options.defaultChecked ?? false);
  const disabled = () => options.disabled?.() ?? false;
  const required = () => options.required?.() ?? false;
  /** What a reset of the owning form goes back to. See `followReset`. */
  const initial = untrack(() => state.get());

  // A disabled control does not change through its own API. The alternative —
  // letting the API through and only blocking the keyboard and the press —
  // means every consumer has to remember the check as well. An application
  // that must set it anyway writes the signal it passed in.
  const setChecked = (next: CheckedState) => {
    if (disabled() || state.get() === next) return;
    state.set(next);
    options.onCheckedChange?.(next);
  };

  if (options.input) {
    const input = options.input;
    mirrorInput(
      input,
      () => state.get() === true,
      () => state.get() === 'indeterminate',
    );
    followReset(
      () => formOf(input()),
      () => {
        if (untrack(() => state.get()) === initial) return;
        state.set(initial);
        options.onCheckedChange?.(initial);
      },
    );
  }

  const toggle = () => setChecked(state.get() !== true);

  return {
    checked: () => state.get(),
    isChecked: () => state.get() === true,
    isIndeterminate: () => state.get() === 'indeterminate',
    isDisabled: () => disabled(),

    setChecked,
    toggle,

    onKeyDown(event: KeyboardEvent): boolean {
      if (!isActivation(event)) return false;
      // Cancelling Space does two jobs: it stops the page scrolling, and on a
      // `<button>` it stops the browser raising its own click on the way up,
      // which would toggle a second time.
      event.preventDefault();
      toggle();
      return true;
    },

    controlProps: () => {
      const value = state.get();
      const off = disabled();
      return {
        role: 'checkbox',
        'aria-checked': value === 'indeterminate' ? 'mixed' : String(value),
        'aria-required': required() ? 'true' : undefined,
        'aria-disabled': off ? 'true' : undefined,
        'aria-label': options.label,
        'aria-labelledby': options.labelledBy,
        'data-state': stateName(value),
        'data-disabled': off || undefined,
        // Disabled controls stay in the tab order, with `aria-disabled` rather
        // than the `disabled` attribute, because a control a keyboard user
        // cannot reach is a control they cannot discover is there. The cost is
        // a tab stop that does nothing when pressed.
        tabindex: '0',
      };
    },

    // An indeterminate checkbox submits nothing: on the platform
    // `indeterminate` is presentation only, and `checked` alone decides what
    // is sent.
    inputProps: () =>
      mirrorProps({
        type: 'checkbox',
        name: options.name,
        value: options.value ?? 'on',
        checked: state.get() === true,
        defaultChecked: initial === true,
        required: required(),
        disabled: disabled(),
      }),
  };
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export interface SwitchOptions {
  /** The hidden native input, once rendered. */
  input?: () => Element | null | undefined;

  /** Supply a signal to control the switch from outside. */
  checked?: Signal.State<boolean>;
  defaultChecked?: boolean;

  /** Submitted as `name=value` while on. */
  name?: string;
  /** Defaults to `on`. */
  value?: string;

  disabled?: () => boolean;
  required?: () => boolean;

  /** Accessible name, for a switch with no text of its own. */
  label?: string;
  /** Id of the element that names it. */
  labelledBy?: string;

  onCheckedChange?: (checked: boolean) => void;
}

export interface Switch {
  checked(): boolean;
  isDisabled(): boolean;

  setChecked(checked: boolean): void;
  toggle(): void;

  /** Handle a keydown. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;

  controlProps(): ControlProps;
  inputProps(): ControlProps;
}

/**
 * A switch is a checkbox that reports itself as one of two settings rather
 * than as a box that is ticked, and takes effect immediately instead of on
 * submit. It has no mixed state — "partly on" is not a setting — and the same
 * keyboard: Space toggles, Enter does not.
 *
 * The mirror stays an ordinary `<input type="checkbox">`. There is a native
 * `switch` attribute now, but it changes how a control is painted, and this
 * one is never seen.
 */
export function createSwitch(options: SwitchOptions = {}): Switch {
  const state = options.checked ?? new Signal.State(options.defaultChecked ?? false);
  const disabled = () => options.disabled?.() ?? false;
  const required = () => options.required?.() ?? false;
  /** What a reset of the owning form goes back to. See `followReset`. */
  const initial = untrack(() => state.get());

  const setChecked = (next: boolean) => {
    if (disabled() || state.get() === next) return;
    state.set(next);
    options.onCheckedChange?.(next);
  };

  if (options.input) {
    const input = options.input;
    mirrorInput(input, () => state.get());
    followReset(
      () => formOf(input()),
      () => {
        if (untrack(() => state.get()) === initial) return;
        state.set(initial);
        options.onCheckedChange?.(initial);
      },
    );
  }

  const toggle = () => setChecked(!state.get());

  return {
    checked: () => state.get(),
    isDisabled: () => disabled(),

    setChecked,
    toggle,

    onKeyDown(event: KeyboardEvent): boolean {
      if (!isActivation(event)) return false;
      event.preventDefault();
      toggle();
      return true;
    },

    controlProps: () => {
      const checked = state.get();
      const off = disabled();
      return {
        role: 'switch',
        'aria-checked': String(checked),
        'aria-required': required() ? 'true' : undefined,
        'aria-disabled': off ? 'true' : undefined,
        'aria-label': options.label,
        'aria-labelledby': options.labelledBy,
        'data-state': checked ? 'checked' : 'unchecked',
        'data-disabled': off || undefined,
        tabindex: '0',
      };
    },

    inputProps: () =>
      mirrorProps({
        type: 'checkbox',
        name: options.name,
        value: options.value ?? 'on',
        checked: state.get(),
        defaultChecked: initial,
        required: required(),
        disabled: disabled(),
      }),
  };
}

// ---------------------------------------------------------------------------
// Radio group
// ---------------------------------------------------------------------------

export interface RadioGroupOptions {
  /** The group element, so the radios can be found in the order they appear. */
  group: () => Element | null | undefined;

  /** Supply a signal to control the selection from outside. */
  value?: Signal.State<string | null>;
  defaultValue?: string | null;

  /** The shared submission name. It is what makes the mirrors one radio group. */
  name?: string;

  disabled?: () => boolean;
  required?: () => boolean;

  /** Arrows wrap past the ends. Default true. */
  loop?: boolean;

  /**
   * Declared orientation, written to `aria-orientation`. It does not change
   * the keyboard: native radios answer to all four arrows however they are
   * laid out, and so do these.
   */
  orientation?: 'horizontal' | 'vertical';

  /** Accessible name for the group. A radiogroup takes no name from its contents. */
  label?: string;
  /** Id of the element that names the group — a legend or a heading. */
  labelledBy?: string;

  /** Null when a form reset puts back a group that started with nothing chosen. */
  onValueChange?: (value: string | null) => void;
}

export interface RadioGroup {
  /** The selected value, or null while nothing is selected. */
  value(): string | null;
  isSelected(value: string): boolean;
  isDisabled(): boolean;

  select(value: string): void;

  /** Handle a keydown on the group. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;

  groupProps(): ControlProps;
  /** The element the user operates, per radio. */
  itemProps(value: string, disabled?: boolean): ControlProps;
  /** The visually hidden native radio that submits, per radio. */
  inputProps(value: string, disabled?: boolean): ControlProps;
}

/**
 * A radio group is one control, not a row of them: it holds a single tab stop,
 * and the arrow keys move within it. Moving is also choosing — arrowing onto a
 * radio selects it — which is what native radios do and what makes the group
 * usable with one key per option rather than two.
 *
 * That is also why there is no typeahead here, though the roving focus this
 * composes offers one: in a group where moving selects, a stray keystroke
 * would quietly change the answer.
 *
 *   class Plan {
 *     group = new Signal.State<Element | null>(null);
 *     plans = createRadioGroup({
 *       group: () => this.group.get(),
 *       name: 'plan',
 *       label: 'Billing plan',
 *     });
 *   }
 *
 *   <div :ref="group" :spread="plans.groupProps()" :keydown="plans.onKeyDown($event)">
 *     <label :for="option in options" :key="option.value" :click="plans.select(option.value)">
 *       <input :spread="plans.inputProps(option.value, option.disabled)">
 *       <span :spread="plans.itemProps(option.value, option.disabled)">{ option.label }</span>
 *     </label>
 *   </div>
 */
export function createRadioGroup(options: RadioGroupOptions): RadioGroup {
  const state = options.value ?? new Signal.State<string | null>(options.defaultValue ?? null);
  const disabled = () => options.disabled?.() ?? false;
  const required = () => options.required?.() ?? false;
  /** What a reset of the owning form goes back to. See `followReset`. */
  const initial = untrack(() => state.get());

  followReset(
    () => options.group()?.closest('form'),
    () => {
      if (untrack(() => state.get()) === initial) return;
      state.set(initial);
      options.onValueChange?.(initial);
    },
  );

  const collection = createCollection(options.group);

  const valueOf = (el: Element | null | undefined): string | null =>
    el?.getAttribute(RADIO_VALUE_ATTRIBUTE) ?? null;

  const itemFor = (value: string): HTMLElement | null =>
    collection.all().find((el) => valueOf(el) === value) ?? null;

  const select = (value: string) => {
    // The disabled flag reached the DOM through `itemProps`, so that is where
    // it is read back from: `select` is called from a press handler that knows
    // a value and nothing else.
    if (disabled() || itemFor(value)?.hasAttribute('data-disabled')) return;
    if (state.get() === value) return;
    state.set(value);
    options.onValueChange?.(value);
  };

  /**
   * The radio an arrow press moves on from.
   *
   * The focused one, which is not always the selected one: before anything is
   * selected, Tab has put focus on the first radio, and Down has to move on
   * from there rather than jump back to the top — which is what a native group
   * does. It is read from the key event's target, because that is where focus
   * was when the key was pressed, by definition of how a key event is
   * delivered. Held here only for the duration of one press, since roving
   * focus asks for the current item rather than being told.
   */
  let origin: HTMLElement | null = null;

  const roving = createRovingFocus(
    collection,
    () => {
      if (origin) return origin;
      const current = state.get();
      return current === null ? null : itemFor(current);
    },
    (el) => {
      const value = valueOf(el);
      if (value !== null) select(value);
    },
    {
      // Both axes, whatever the visual orientation, because that is what a
      // native radio group does.
      orientation: 'both',
      loop: options.loop !== false,
      typeahead: false,
    },
  );

  /**
   * The value that holds the tab stop while nothing is selected.
   *
   * Which radio is first can only be read from the DOM, and the DOM does not
   * exist yet while the first item's props are being computed — so it is
   * filled in by an effect, once the tree has settled. It refreshes when the
   * group element appears and whenever the selection is cleared, but not when
   * items are added or removed: catching that would put a mutation observer on
   * every group for a case that only arises before anything is chosen.
   */
  const firstValue = new Signal.State<string | null>(null);

  effect(() => {
    const root = options.group();
    // The selected radio owns the tab stop; this is only the fallback.
    if (!root || state.get() !== null) return;
    firstValue.set(valueOf(collection.first()));
  });

  // A `<label>` around a radio forwards presses to the mirror it labels. Left
  // alone that would check the mirror directly — and the group's own state,
  // which the label's press handler has already updated, would no longer be
  // the only thing deciding what is submitted.
  effect(() => {
    const root = options.group();
    if (!root) return;

    const swallow = (event: Event) => {
      if (!isInput(event.target) || event.target.type !== 'radio') return;
      event.preventDefault();
      event.stopPropagation();
      syncMirrors(root, untrack(() => state.get()));
    };

    // Capture, so the press is stopped before it reaches the handlers the
    // consumer put on the item or the label — they have already run for the
    // press that caused this one.
    root.addEventListener('click', swallow, true);
    onCleanup(() => root.removeEventListener('click', swallow, true));
  });

  return {
    value: () => state.get(),
    isSelected: (value: string) => state.get() === value,
    isDisabled: () => disabled(),
    select,

    onKeyDown(event: KeyboardEvent): boolean {
      if (disabled()) return false;

      // Enter belongs to the form. On the platform it submits, and a group
      // that swallowed it would take that away from keyboard users.
      if (event.key === 'Enter') return false;

      const from = closestItem(event.target);

      if (isActivation(event)) {
        // Space chooses whatever has focus, which is how a group entered by
        // Tab with nothing selected gets its first answer.
        const value = valueOf(from);
        if (value === null) return false;
        event.preventDefault();
        select(value);
        return true;
      }

      origin = from;
      try {
        const consumed = roving.onKeyDown(event);
        // The arrows scroll the page otherwise, and Home and End jump the
        // document to its ends.
        if (consumed) event.preventDefault();
        return consumed;
      } finally {
        origin = null;
      }
    },

    groupProps: () => {
      const off = disabled();
      return {
        role: 'radiogroup',
        'aria-label': options.label,
        'aria-labelledby': options.labelledBy,
        'aria-required': required() ? 'true' : undefined,
        'aria-disabled': off ? 'true' : undefined,
        'aria-orientation': options.orientation,
        'data-disabled': off || undefined,
      };
    },

    itemProps: (value: string, itemDisabled = false) => {
      const off = itemDisabled || disabled();
      const current = state.get();
      const selected = current === value;
      // Exactly one radio is in the tab order, so Tab steps over the group in
      // one press instead of once per option. It is the selected one — and
      // with nothing selected the first, or the group could not be reached by
      // Tab at all. Roving focus states the same rule keyed by element; here
      // it has to be keyed by value, because a radio's props are computed
      // before its element exists.
      const isTabStop = !off && (current === null ? value === firstValue.get() : selected);

      return {
        role: 'radio',
        'aria-checked': String(selected),
        'aria-disabled': off ? 'true' : undefined,
        'data-state': selected ? 'checked' : 'unchecked',
        'data-disabled': off || undefined,
        [RADIO_VALUE_ATTRIBUTE]: value,
        [ITEM_ATTRIBUTE]: true,
        tabindex: isTabStop ? '0' : '-1',
      };
    },

    // `required` goes on every mirror because the constraint belongs to the
    // group rather than to any one radio: the browser treats all of them as
    // satisfied the moment one is checked, and reports on whichever it finds
    // first if none is.
    inputProps: (value: string, itemDisabled = false) =>
      mirrorProps({
        type: 'radio',
        name: options.name,
        value,
        checked: state.get() === value,
        defaultChecked: initial === value,
        required: required(),
        disabled: itemDisabled || disabled(),
      }),
  };
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * Whether a key press activates a checkbox, a switch, or a radio.
 *
 * Space activates and Enter does not, which is exactly what the native
 * controls do: inside a form Enter submits, so a control that consumed it
 * would take the form's default action away from the keyboard. Ctrl, Meta and
 * Alt make it a shortcut rather than an activation. Shift does not — Shift+
 * Space still ticks a checkbox.
 */
function isActivation(event: KeyboardEvent): boolean {
  return event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey;
}

/** `data-state`, for CSS to select on without reading ARIA. */
function stateName(value: CheckedState): string {
  if (value === 'indeterminate') return 'indeterminate';
  return value ? 'checked' : 'unchecked';
}

interface MirrorOptions {
  type: 'checkbox' | 'radio';
  name: string | undefined;
  value: string;
  checked: boolean;
  /** Whether the control started checked, which is what a form reset restores. */
  defaultChecked: boolean;
  required: boolean;
  disabled: boolean;
}

/** Props for the hidden native input the control is built on. */
function mirrorProps(options: MirrorOptions): ControlProps {
  const props: Record<string, string | boolean | undefined> = {
    type: options.type,
    value: options.value,
    checked: options.checked,
    // The `checked` content attribute, which is the only thing a form reset
    // restores: the line above writes a property, and a property is not a
    // default. Without it a reset unchecks every mirror while the state — and
    // the control on screen — stays checked, and the form submits nothing.
    defaultChecked: options.defaultChecked,
    required: options.required,
    disabled: options.disabled,
    // Reachable to the platform, invisible to assistive technology and to Tab:
    // the visible control carries the role and the tab stop, and announcing
    // both would announce the control twice.
    tabindex: '-1',
    'aria-hidden': 'true',
    style: VISUALLY_HIDDEN_INPUT_STYLE,
  };

  // Omitted rather than set to undefined: `name` is a property on an input, and
  // assigning undefined to it submits the string "undefined".
  if (options.name !== undefined) props.name = options.name;

  return props;
}

/**
 * Keep a hidden input in step with the state it stands for, and stop it being
 * operated directly.
 *
 * Two things cannot be said in a props object. `indeterminate` exists only as
 * a property — there is no attribute for it — so it has to be written here.
 * And a `<label>` around the control forwards presses to the input it labels,
 * which is this one: left alone, a press on the label's text would flip the
 * input's own checkedness, and the form would submit something nothing on
 * screen agrees with. The press is cancelled and stopped, so the only press
 * that counts is the one the consumer handles.
 */
function mirrorInput(
  input: () => Element | null | undefined,
  checked: () => boolean,
  indeterminate: () => boolean = () => false,
): void {
  effect(() => {
    const el = input();
    if (!isInput(el)) return;
    el.checked = checked();
    // `indeterminate` is a property with no attribute behind it, so it cannot
    // be written through the props object like everything else here.
    el.indeterminate = indeterminate();
  });

  // Separate from the sync above so the listener is attached once per input
  // rather than removed and re-added on every change of state.
  effect(() => {
    const el = input();
    if (!isInput(el)) return;

    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      // Cancelling restores the checkedness the browser flipped before it
      // dispatched, where that is implemented; re-asserting it costs one
      // assignment and does not rely on that.
      el.checked = untrack(checked);
    };

    el.addEventListener('click', swallow);
    onCleanup(() => el.removeEventListener('click', swallow));
  });
}

/**
 * Put the state back to where it started when the owning form is reset.
 *
 * The mirrors go back by themselves, to the `defaultChecked` they carry; the
 * state is the half the platform knows nothing about. It is written directly
 * rather than through the setter, which refuses while disabled — and a reset
 * puts a disabled control's mirror back as well, so a state left behind would
 * disagree with it. Nothing is read back from the mirrors, which the platform
 * has not touched yet when `reset` is dispatched; where they are going is
 * already known. A reset a listener ahead of this one called off is left alone.
 */
function followReset(form: () => HTMLFormElement | null | undefined, restore: () => void): void {
  effect(() => {
    const owner = form();
    if (!owner) return;
    const onReset = (event: Event) => {
      if (!event.defaultPrevented) restore();
    };
    owner.addEventListener('reset', onReset);
    onCleanup(() => owner.removeEventListener('reset', onReset));
  });
}

/** The form a mirror belongs to, which its `form` property says, `form` attribute and all. */
function formOf(input: Element | null | undefined): HTMLFormElement | null {
  return isInput(input) ? input.form : null;
}

/** Point every mirror in a radio group at the value the group actually holds. */
function syncMirrors(root: Element, value: string | null): void {
  for (const mirror of root.querySelectorAll('input[type="radio"]')) {
    if (isInput(mirror)) mirror.checked = mirror.value === value;
  }
}

/** The item an event happened inside, if it happened inside one. */
function closestItem(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(`[${ITEM_ATTRIBUTE}]`);
}

/**
 * Narrow to a native input by tag name rather than by `instanceof`.
 *
 * An element adopted from another document — an iframe, or markup parsed
 * elsewhere — is not an instance of *this* window's `HTMLInputElement`, and
 * the constructor is a browser global that does not exist at all when this
 * runs on a server, where the check would throw rather than answer. The tag
 * name is true in every one of those cases.
 */
function isInput(node: EventTarget | Element | null | undefined): node is HTMLInputElement {
  return typeof node === 'object' && node !== null && 'tagName' in node && node.tagName === 'INPUT';
}
