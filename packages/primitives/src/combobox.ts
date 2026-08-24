/**
 * Select and Combobox — choosing from a list, without and with a textbox.
 *
 * One file, because the two differ by less than they share. Both own a popup
 * listbox, a set of chosen values, virtual focus over the options, typeahead,
 * a real form control behind the scenes, and the same announcements. What
 * separates them is the element the user operates: a button that shows the
 * current value, or a textbox that filters the list as it is typed.
 *
 * This is headless: it owns state, keyboard and ARIA, and returns prop objects
 * to spread onto whatever markup the consumer writes. Nothing here renders.
 *
 *   class Country {
 *     trigger = new Signal.State<Element | null>(null);
 *     list = new Signal.State<Element | null>(null);
 *     native = new Signal.State<Element | null>(null);
 *     select = createSelect({
 *       trigger: () => this.trigger.get(),
 *       listbox: () => this.list.get(),
 *       native: () => this.native.get(),
 *       name: 'country',
 *     });
 *   }
 *
 *   <select :ref="native" :spread="select.nativeProps()">
 *     <option value=""></option>
 *     <option :for="c of countries" :key="c.code"
 *             :spread="select.nativeOptionProps({ value: c.code })">{ c.name }</option>
 *   </select>
 *
 *   <button :ref="trigger" :spread="select.triggerProps()"
 *           :click="select.onTriggerClick()"
 *           :keydown="select.onTriggerKeyDown($event)"
 *           :blur="select.onTriggerBlur()">{ select.displayValue() }</button>
 *
 *   <div :if="select.isPresent()" :portal :ref="list"
 *        :spread="select.listboxProps()"
 *        :click="select.onOptionClick($event)"
 *        :pointerdown="select.onListboxPointerDown($event)"
 *        :pointermove="select.onOptionPointerMove($event)">
 *     <div :for="c of countries" :key="c.code"
 *          :spread="select.optionProps({ value: c.code })">{ c.name }</div>
 *   </div>
 *
 *   <p :spread="select.statusProps()">{ select.status() }</p>
 *
 * Six decisions are worth stating outright, because each has a cost.
 *
 * **Navigation is virtual, never real DOM focus.** The active option is named
 * by `aria-activedescendant` and focus stays on the trigger or in the input for
 * the whole interaction. A combobox has no choice — APG requires the textbox to
 * keep focus so that typing keeps working — and making the select behave the
 * same way is what lets one implementation serve both. The cost is that
 * `createRovingFocus` cannot be used here: it moves focus to the item, which is
 * exactly what must not happen. Its *matching* rule is still shared, because
 * typeahead runs through `collection.match`.
 *
 * **Nothing traps focus.** Focus never enters the popup, so there is nothing to
 * trap and nothing to restore; a focus scope would only fight the input. Every
 * way out — Escape, Tab, choosing an option, a press outside — closes the popup
 * with focus already where it should be.
 *
 * **A real form control sits behind it.** A widget assembled out of `<div>`s
 * submits nothing, validates nothing, and is invisible to `FormData`, to
 * `form.reset()` and to the browser's own required-field handling. So the
 * consumer renders a visually hidden `<select>` or `<input>`, and this keeps it
 * in step. One value goes behind either; several can only go behind a
 * `<select multiple>`, because an `<input>` holds one string — a `multiple`
 * widget backed by one submits the first value chosen and drops the rest,
 * which is the kind of wrong nobody can see in the form data. So a `multiple`
 * widget renders one option per chosen value:
 *
 *   <select :ref="native" :spread="combo.nativeProps()">
 *     <option :for="v of combo.values()" :key="v"
 *             :spread="combo.nativeOptionProps({ value: v })">{ combo.labelOf(v) }</option>
 *   </select>
 *
 * For a select the native options pay for themselves twice over: they are the
 * source typeahead reads while the popup is closed, and they are where the
 * option labels come from when nothing is rendered. A required `<select>` needs
 * an empty first option, or the browser selects the first real one and the
 * field can never be missing.
 *
 * **Escape goes in two stages, popup first.** APG is explicit: Escape dismisses
 * the popup if it is visible, and clears the textbox if it is not. The visible
 * layer is what a user is addressing, and reversing the order would clear text
 * they can still see under a list they wanted rid of.
 *
 * **The empty and loading states are announced.** A list that quietly becomes
 * empty is a list a screen reader user is still being told has options in it.
 * `status()` carries the count, the empty message and the loading message into
 * one polite region, which must be rendered whether or not it has anything to
 * say — a live region that appears together with its message announces nothing.
 *
 * **Every user-visible string is overridable**, through `labels` and through
 * the locale's own catalogue, which is where the defaults come from.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createAnchor, type Anchor, type AnchorPlacement } from './anchoring.js';
import { createResource, type Resource, type ResourceFetcher } from './async.js';
import { createCollection, ITEM_ATTRIBUTE } from './collection.js';
import { createDismiss, dismissStackSize, type DismissReason } from './dismiss.js';
import { VISUALLY_HIDDEN_INPUT_STYLE } from './form-controls.js';
import { createFormField, type FormField, type FormFieldOptions } from './form-field.js';
import { useLocale, type MessageValues } from './i18n.js';
import { createId } from './id.js';
import { createPresence, type PresenceState } from './presence.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A prop object to spread.
 *
 * Attributes and properties, never handlers: a prop object is re-applied
 * whenever the state it reads changes, and a listener in one would be added
 * again on every re-application. Events are wired in the template, where the
 * consumer can see them. `style` is an object because anchoring writes one.
 */
export interface ComboboxProps {
  readonly [key: string]: string | boolean | undefined | Readonly<Record<string, string>>;
}

/** Where virtual focus lands when the popup opens. */
export type ListboxOpenFocus = 'selected' | 'first' | 'last' | 'none';

/**
 * How much the textbox promises about the list.
 *
 * `list` filters the popup, `both` also completes the text inline, and `none`
 * shows every option however much has been typed — which is what a combobox
 * used purely as an opener wants.
 */
export type ComboboxAutocomplete = 'none' | 'list' | 'both';

export interface ComboboxOptionOptions {
  /** Identifies the option. Everything else here is keyed off it. */
  value: string;
  /** Skipped by navigation and by typeahead, still announced. */
  disabled?: boolean;
  /**
   * What typeahead, filtering and inline completion match on, when the visible
   * text is not what anyone would type — a label leading with an icon's alt
   * text, or trailing a badge.
   */
  textValue?: string;
}

/**
 * Every string these components can put in front of a user.
 *
 * Each falls back to the locale's catalogue before it falls back to English,
 * so an application that has translated the catalogue has translated these
 * too and need pass nothing here.
 */
export interface ComboboxLabels {
  /** Names the popup when no field label does. Default `Suggestions`. */
  listbox?: string;
  /** Shown and announced when nothing matches. Default `No results`. */
  empty?: string;
  /** Announced while an async search is in flight. Default `Loading…`. */
  loading?: string;
  /** Names the button that empties the selection. Default `Clear`. */
  clear?: string;
  /** Names the button that opens the popup. Default `Show suggestions`. */
  toggle?: string;
  /** Names the button that removes one chip. Default `Remove {label}`. */
  remove?: (label: string) => string;
  /** Announced when the popup has options. Default `n results available`. */
  results?: (count: number) => string;
  /** Names the chip list. Default `n selected`. */
  selected?: (count: number) => string;
}

/** Everything a select and a combobox are configured with in common. */
export interface ListboxSharedOptions {
  /** The popup listbox element, once rendered. */
  listbox: () => Element | null | undefined;
  /**
   * The visually hidden `<select>` or `<input>` that submits and validates.
   * Everything works without one except the form.
   */
  native?: () => Element | null | undefined;
  /**
   * The element the popup lines up with, when it is not the trigger or the
   * input — the field wrapper of a combobox with chips, most often. Supplying
   * it moves `anchorProps()` off the control, so spread it on that element
   * yourself.
   */
  anchor?: () => Element | null | undefined;

  /**
   * Supply a signal to control the popup from outside. Without one it owns its
   * own state, which is what most callers want.
   */
  open?: Signal.State<boolean>;
  defaultOpen?: boolean;

  /**
   * Supply a signal to control the value from outside.
   *
   * Always a list, even for a single select: one shape means one code path,
   * and `value()` returns the first entry for the common case.
   */
  value?: Signal.State<readonly string[]>;
  /**
   * The value to start with, which is a value and not a name for one.
   *
   * A select reads the name off its native `<select>`, which carries an
   * `<option>` per value whether or not the popup has ever been opened. A
   * combobox has no such list: its native control is an `<input>`, and the
   * options only exist while the popup does. So a combobox handed a value this
   * way — or through `value` — is holding something it cannot yet name, and its
   * textbox stays empty until it can: from the text the page was rendered with,
   * from `labelFor`, or from the first option that renders, whichever comes
   * first, and it fills in by itself at that moment.
   *
   * Empty rather than the identifier, which is the one thing that must not go
   * there. A textbox holds text somebody could have typed — it is filtered on,
   * searched for, completed from and, with `allowCustomValue`, committed — so
   * an internal token in it is not a label that reads oddly, it is this
   * component claiming the user typed something they have never seen. The value
   * is held, submitted and reported by `value()` the whole time; supply
   * `labelFor` and there is nothing to leave empty.
   */
  defaultValue?: string | readonly string[];

  /** More than one value at a time. Default false. */
  multiple?: boolean;

  /** Submitted as `name=value`. Without a name the native control submits nothing. */
  name?: string;

  /**
   * The text for a value nothing has rendered yet.
   *
   * Names come from the options on screen, from a select's native `<select>`,
   * and from the text the page was rendered with — and a combobox served by an
   * empty client-rendered `<input>` has none of the three until its popup has
   * been opened once. Supply this and every value has a name from the first
   * paint, whoever handed it in; without it, see `defaultValue`.
   *
   * Read whenever a name is wanted, so a catalogue that arrives late names
   * everything the moment it does. It is the lowest-ranked source: a value an
   * option was really seen to carry keeps that text, because this is a promise
   * about data and that was the page.
   */
  labelFor?: (value: string) => string | undefined;

  /** Blocks opening and choosing, and is written through to the native control. */
  disabled?: () => boolean;
  /** Blocks choosing but not opening: the values can still be read. */
  readOnly?: () => boolean;
  /** Written through to the native control, so the platform enforces it. */
  required?: () => boolean;

  /** Which side of the anchor the popup sits on. Default `bottom-start`. */
  placement?: AnchorPlacement;
  /** The gap between anchor and popup. A number is pixels. */
  offset?: number | string;
  /** Let the browser flip to the opposite side when it would overflow. Default true. */
  flip?: boolean;

  /**
   * Arrow keys wrap past the ends. Default false, which is what a listbox
   * does: wrapping in a long list of options loses the sense of where the end
   * is, and the End key is the fast way there.
   */
  loop?: boolean;
  /** Choosing an option closes the popup. Defaults to true, or false when `multiple`. */
  closeOnSelect?: boolean;
  /** Escape closes it. Default true. */
  closeOnEscape?: boolean;
  /** A press outside closes it. Default true. */
  closeOnOutsidePointer?: boolean;
  /** How long typed characters accumulate, in ms. Default 500. */
  typeaheadTimeout?: number;

  /**
   * The label, description, error message and validation, handed to
   * `createFormField`. The control and its id are this component's to supply,
   * and `required`, `disabled` and `readOnly` are named above.
   */
  field?: Omit<FormFieldOptions, 'control' | 'id' | 'required' | 'disabled' | 'readOnly'>;

  labels?: ComboboxLabels;

  onOpenChange?: (open: boolean) => void;
  onValueChange?: (values: readonly string[]) => void;
}

/** How many options a Page key moves by, per the APG listbox pattern. */
const PAGE = 10;

// ---------------------------------------------------------------------------
// The half a select and a combobox share
// ---------------------------------------------------------------------------

/**
 * The popup, the values, virtual focus, the native control and the
 * announcements — everything neither component needs to know is different.
 *
 * `control` is the element the user operates: the trigger of a select, the
 * textbox of a combobox. It is what the popup is anchored to, what dismissal
 * treats as not-outside, and what carries the field's ARIA.
 */
function createListboxCore(
  options: ListboxSharedOptions,
  control: () => Element | null | undefined,
  /**
   * What this component's own native control calls a value, when it is a
   * control that knows — see `nameOf`.
   */
  nativeName?: (value: string) => string | undefined,
) {
  const locale = useLocale();

  const controlId = createId('combobox');
  const listboxId = createId('listbox');

  const multiple = options.multiple === true;
  const loop = options.loop === true;
  const closesOnSelect = options.closeOnSelect ?? !multiple;

  const initial = toValues(options.defaultValue);
  const openState = options.open ?? new Signal.State(options.defaultOpen ?? false);
  const valueState = options.value ?? new Signal.State<readonly string[]>(initial);
  const activeValue = new Signal.State<string | null>(null);
  /** How many options the popup is showing, kept for the live region. */
  const optionCount = new Signal.State(0);

  const disabled = () => options.disabled?.() ?? false;
  const readOnly = () => options.readOnly?.() ?? false;
  const required = () => options.required?.() ?? false;

  const presence = createPresence(
    () => openState.get(),
    () => options.listbox(),
  );

  // Options carry `data-volt-item`, so navigation, typeahead and the count all
  // read the same set and can never disagree about what is in the list.
  const items = createCollection(() => options.listbox());

  const anchor = createAnchor({
    anchor: () => options.anchor?.() ?? control(),
    defaultPlacement: options.placement ?? 'bottom-start',
    offset: options.offset,
    flip: options.flip,
  });

  const field = createFormField({
    ...options.field,
    control: () => options.native?.(),
    // The id names the *visible* control, so a `<label for>` moves focus to
    // the thing the user operates rather than to the hidden one behind it.
    id: controlId,
    required,
    disabled,
    readOnly,
  });

  const typeahead = createTypeahead(() => options.typeaheadTimeout ?? 500);

  /**
   * An id per distinct value, minted on demand.
   *
   * `aria-activedescendant` has to name an element, so every option needs an
   * id, and it has to survive the option being re-rendered by a filter. Ids
   * are held for the life of the component: an async search that streams
   * thousands of distinct values keeps one short string each, which is the
   * price of never pointing at an id that has changed under the attribute.
   */
  const optionIds = new Map<string, string>();
  const optionId = (value: string): string => {
    const existing = optionIds.get(value);
    if (existing !== undefined) return existing;
    const minted = createId('option');
    optionIds.set(value, minted);
    return minted;
  };

  /**
   * Every name anything on this page has given a value.
   *
   * One registry, because a name has to outlive whatever supplied it: a chip
   * keeps the text its option had after the popup has gone, and a value handed
   * in before any popup existed is named by whichever source turns up first.
   * The counter beside it is what carries a name that has just been learned to
   * the textbox, the trigger and the chips — nothing else about the page
   * changes at the moment a value stops being anonymous, so nothing else can.
   */
  const names = new Map<string, string>();
  const namesLearned = new Signal.State(0);

  /**
   * Record what a value is called.
   *
   * Nothing is not a name. An option rendered before its text is a value whose
   * label would otherwise be filed as the empty string and stay that way for
   * as long as the component lives.
   */
  const nameValue = (value: string, text: string): void => {
    if (text === '' || names.get(value) === text) return;
    names.set(value, text);
    namesLearned.set(untrack(() => namesLearned.get()) + 1);
  };

  /** Record what everything the popup is showing is called. */
  const learnNames = (): void => {
    for (const option of items.all()) {
      const value = option.getAttribute('data-value');
      if (value !== null) nameValue(value, textOf(option));
    }
  };

  /**
   * What a value is called, or undefined while nothing has said.
   *
   * Undefined rather than the value, because the value is an identifier and
   * every caller has to decide for itself whether an identifier will do in the
   * place it is about to put one. A chip has to say something; a textbox does
   * not — see `defaultValue`.
   *
   * The native control answers first for the component that has a real one,
   * because it is the consumer's own catalogue and it is always there, so it
   * keeps up when the catalogue changes underneath. Then what was really on the
   * page, which outranks what was merely promised: a `labelFor` written against
   * data that has moved on cannot rewrite the text an option was seen to have.
   */
  const nameOf = (value: string): string | undefined => {
    namesLearned.get();
    return nativeName?.(value) ?? names.get(value) ?? options.labelFor?.(value);
  };

  const message = (key: string, fallback: string, values?: MessageValues): string =>
    locale.has(key) ? locale.t(key, values) : fallback;

  // --- values ------------------------------------------------------------

  const valuesNow = (): readonly string[] => untrack(() => valueState.get());

  const setValues = (next: readonly string[]): void => {
    if (sameValues(valuesNow(), next)) return;
    valueState.set(next);
    options.onValueChange?.(next);
  };

  const select = (value: string): void => {
    if (disabled() || readOnly()) return;
    const current = valuesNow();
    if (multiple) {
      if (!current.includes(value)) setValues([...current, value]);
    } else {
      setValues([value]);
    }
    if (closesOnSelect) setOpen(false);
  };

  const deselect = (value: string): void => {
    if (disabled() || readOnly()) return;
    setValues(valuesNow().filter((v) => v !== value));
  };

  /**
   * Add or remove, whichever the value is not — on one value or on several.
   *
   * `closeOnSelect` is about the press rather than about which way it went: a
   * list that closes when a press adds a value and stays up when the same press
   * removes one answers one gesture two ways.
   */
  const toggleValue = (value: string): void => {
    if (disabled() || readOnly()) return;
    if (!valuesNow().includes(value)) {
      select(value);
      return;
    }
    deselect(value);
    if (closesOnSelect) setOpen(false);
  };

  /**
   * What a press or an Enter on an option does.
   *
   * A multiple toggles, because the same gesture is how a chip comes off
   * again. A single takes: pressing the option a list of one already holds is
   * not a request to hold none, and a native select does not answer it that
   * way either. One decision for both routes — the pointer arrives through
   * `onOptionClick` and the keyboard through each component's own Enter — so
   * `toggleValue` is left saying exactly what its name says.
   */
  const choose = (value: string): void => {
    if (multiple) toggleValue(value);
    else select(value);
  };

  const clear = (): void => {
    if (disabled() || readOnly()) return;
    setValues([]);
  };

  // --- opening -----------------------------------------------------------

  /**
   * Where virtual focus should land once the popup exists.
   *
   * Held across the render because the effect below runs after the key that
   * opened the popup has been and gone, and the DOM cannot be asked which one
   * it was.
   */
  let pendingFocus: ListboxOpenFocus = 'none';

  /**
   * Set while an Escape that dismissal has already acted on is still bubbling.
   *
   * Dismissal owns Escape, on the document and in the capture phase, so that
   * one press closes one layer — a combobox inside a dialog must not take the
   * dialog down with it. That handler therefore runs *before* the control's
   * own, which would otherwise see a closed popup and go on to clear the
   * textbox as well. One flag is enough: both handlers run inside the same
   * dispatch, and opening resets it in case a press ever lands with focus
   * somewhere the control's handler never sees.
   */
  let escapeDismissed = false;

  const setOpen = (next: boolean): void => {
    if (untrack(() => openState.get()) === next) return;
    openState.set(next);
    options.onOpenChange?.(next);
  };

  const openListbox = (focus: ListboxOpenFocus = 'selected'): void => {
    if (disabled()) return;
    escapeDismissed = false;
    pendingFocus = focus;
    setOpen(true);
  };

  const close = (): void => setOpen(false);

  // --- virtual focus -----------------------------------------------------

  const optionFor = (value: string | null): HTMLElement | null => {
    if (value === null) return null;
    return items.enabled().find((el) => el.getAttribute('data-value') === value) ?? null;
  };

  const activeOption = (): HTMLElement | null => optionFor(activeValue.get());

  /**
   * Everything on the page that says it controls this popup.
   *
   * A combobox's toggle button sits beside the textbox, inside neither it nor
   * the popup, so dismissal reads a press on it as a press outside: the popup
   * closes and the button's own click opens it again, and it can never close.
   * Read from the document rather than taken as an option, because
   * `aria-controls` is already the statement that the button belongs to this
   * popup — a button that has not made it is one this component cannot vouch
   * for, and an option is one more thing every consumer has to remember.
   *
   * The element under the press is remembered as well, because the attribute
   * is only there while the popup is open and only if the consumer spread
   * `toggleProps()`: one who wired the two handlers the toggle documents onto
   * markup of their own would otherwise have a button that opens and can never
   * close. A press is what makes a controller of it, so the press is what
   * records it.
   */
  let pressedController: Element | null = null;

  const rememberController = (target: EventTarget | null): void => {
    pressedController = target instanceof Element ? target : null;
  };

  const popupControllers = (): (Element | null)[] => [
    pressedController,
    ...document.querySelectorAll(`[aria-controls="${listboxId}"]`),
  ];

  const setActive = (option: HTMLElement | null): void => {
    if (!option) return;
    activeValue.set(option.getAttribute('data-value'));
    // The option is virtually focused, so nothing scrolls it into view for us.
    // `nearest` is the one that does not move the list when it is already
    // visible, which is what makes pointer and keyboard use agree.
    option.scrollIntoView({ block: 'nearest' });
  };

  const move = (delta: number): void => {
    setActive(items.next(activeOption(), delta, loop));
  };

  const moveTo = (option: HTMLElement | null): void => setActive(option);

  /** Move virtual focus by a typed prefix, matching exactly as a menu does. */
  const typeaheadMove = (key: string): boolean => {
    const match = items.match(typeahead.push(key), activeOption());
    if (match) setActive(match);
    return match !== null;
  };

  const applyPendingFocus = (): void => {
    const focus = pendingFocus;
    pendingFocus = 'none';

    if (focus === 'none') {
      activeValue.set(null);
      return;
    }
    if (focus === 'first') return void setActive(items.first());
    if (focus === 'last') return void setActive(items.last());
    // `selected` falls back to the first option, so opening always has
    // somewhere for the next arrow key to move on from.
    setActive(optionFor(valuesNow()[0] ?? null) ?? items.first());
  };

  // Everything that only applies while open lives in one effect, so it is set
  // up and torn down as a unit — and, because these register cleanups, in
  // exactly the reverse order on the way out.
  effect(() => {
    if (!openState.get()) return;
    const popup = options.listbox();
    if (!popup) return;

    createDismiss(
      () => options.listbox(),
      (reason: DismissReason) => {
        if (reason === 'escape') {
          // Recorded whether or not this layer closes, because either way the
          // press has been spoken for and must not also clear a textbox.
          escapeDismissed = true;
          if (options.closeOnEscape === false) return;
        }
        if (reason === 'outside-pointer' && options.closeOnOutsidePointer === false) return;
        setOpen(false);
      },
      {
        // Escape is always claimed here and filtered in the callback above, so
        // that a layer configured not to close still stops the press reaching
        // the layer underneath it.
        escape: true,
        outsidePointer: options.closeOnOutsidePointer !== false,
        // The control is not "outside": dismissing on it would close the popup
        // and the control's own handler would open it again. Nor is anything
        // else that claims to control the popup — see `popupControllers`.
        exclude: () => [control(), options.anchor?.(), ...popupControllers()],
      },
    );

    untrack(applyPendingFocus);

    onCleanup(() => {
      activeValue.set(null);
      typeahead.clear();
    });
  });

  // --- how many options there are ----------------------------------------

  /**
   * Bumped whenever the rendered list is seen to have changed.
   *
   * The count alone cannot stand in for this: an async answer that replaces
   * one option with a different one changes nothing about the number, and
   * anything waiting on the list — inline completion, most of all — would
   * never hear about it.
   */
  const listRevision = new Signal.State(0);

  // Counted from the DOM, because the list is the consumer's to render and
  // this component is never told what went into it. An observer catches every
  // route — a filter, an async answer, a group appearing — including the ones
  // driven by signals this component cannot see.
  effect(() => {
    if (!openState.get()) {
      optionCount.set(0);
      return;
    }
    const popup = options.listbox();
    if (!popup) return;

    const measure = () => {
      // Every rendered option is a name for its value, and the popup is the
      // only place most of them are ever written down. Read where the list is
      // watched rather than where it is opened, so an async answer and a
      // consumer's own filter are read the same way the first render is.
      learnNames();
      optionCount.set(items.enabled().length);
      listRevision.set(untrack(() => listRevision.get()) + 1);
      // `aria-activedescendant` names an element by id, so an option that
      // leaves the list under an open popup leaves the attribute pointing at
      // nothing. Typing is not the only way that happens — a late search
      // answer, a consumer's own filter and a plain data change never pass
      // through this component at all — so it is caught where the list is
      // watched rather than where the keystrokes are.
      untrack(() => {
        const active = activeValue.get();
        if (active !== null && optionFor(active) === null) activeValue.set(null);
      });
    };
    measure();

    const observer = new MutationObserver(measure);
    observer.observe(popup, {
      childList: true,
      subtree: true,
      attributes: true,
      // Disabled options are not counted, so a disabling is a change of count.
      attributeFilter: ['data-disabled', 'disabled', ITEM_ATTRIBUTE],
    });
    onCleanup(() => observer.disconnect());
  });

  /** Recount now rather than at the end of the microtask the observer waits for. */
  const recount = (): void => {
    if (untrack(() => openState.get())) optionCount.set(items.enabled().length);
  };

  // --- the native control -------------------------------------------------

  /**
   * Follow the values into the native control, and tell the field an edit
   * happened.
   *
   * A `<select>` takes its selectedness from `nativeOptionProps`, which the
   * spread has already applied by the time a user effect runs; an `<input>`
   * has one value and takes it here. Either way the field is told afterwards,
   * so that `isDirty` and any revalidation see the new value rather than the
   * one it replaced.
   *
   * A `multiple` widget behind an `<input>` is the one case with no honest
   * answer: the element holds one string. It is left empty rather than given
   * the first value, because a form that receives one of the three things
   * chosen is wrong in a way nobody can see, while a form that receives
   * nothing fails the required check and says so. The markup that works is a
   * `<select multiple>` — see the note on the form control at the top.
   */
  /**
   * Put the held value into the native control.
   *
   * Shared with the reset handler below rather than left inside the effect,
   * because the effect only runs when the value changes — and a reset to the
   * value already held changes nothing. A `<select>` survives that on its own,
   * since `selected` is an attribute the platform restores; an `<input>` is
   * written by property, so the element the platform has just blanked stays
   * blank unless something writes it again.
   */
  const writeNative = (values: readonly string[]): void => {
    const native = options.native?.();
    if (!native || isSelectElement(native) || !('value' in native)) return;
    (native as { value: string }).value = multiple ? '' : (values[0] ?? '');
  };

  let firstSync = true;
  effect(() => {
    const values = valueState.get();
    const native = options.native?.();
    if (!native) return;

    untrack(() => {
      writeNative(values);
      if (firstSync) {
        firstSync = false;
        return;
      }
      field.markEdited();
    });
  });

  // A form reset restores the control's default, and a widget that ignored it
  // would leave the page showing a value the form no longer holds.
  effect(() => {
    const native = options.native?.();
    const form = native ? formOf(native) : null;
    if (!form) return;

    // Deferred by a microtask because `reset` is dispatched as part of
    // resetting, before the controls it resets have settled.
    const onReset = () =>
      queueMicrotask(() => {
        setValues(initial);
        // Unconditionally, and not only when the value moved: the platform has
        // already blanked the element, so a reset to the value the widget was
        // holding leaves the form submitting nothing while `value()` still
        // reports it — which is the one failure the form-control section at
        // the top of this file exists to prevent.
        writeNative(valuesNow());
      });
    form.addEventListener('reset', onReset);
    onCleanup(() => form.removeEventListener('reset', onReset));
  });

  // --- labels and announcements -------------------------------------------

  /**
   * A name to show for a value, falling back to the identifier.
   *
   * Every place that has to say something about a value it cannot name reads
   * it here: a chip with no text is a chip nobody can find the remove button
   * for, and the identifier is at least the thing the form holds. The textbox
   * is the one surface that reads `nameOf` instead, because what is in a
   * textbox is text somebody could have typed.
   */
  const labelOf = (value: string): string => nameOf(value) ?? value;

  const emptyMessage = (): string => options.labels?.empty ?? message('noResults', 'No results');

  const loadingMessage = (): string => options.labels?.loading ?? message('loading', 'Loading…');

  const resultsMessage = (count: number): string =>
    options.labels?.results?.(count) ??
    message('resultsAvailable', count === 1 ? '1 result available' : `${count} results available`, {
      n: count,
    });

  // --- props shared by both -----------------------------------------------

  /**
   * What names the popup.
   *
   * The field's label is preferred and only used when an element really
   * carries the id: a dangling `aria-labelledby` announces an unnamed listbox
   * while hiding the fact that the name is missing.
   */
  const listboxName = (): { by: string | undefined; text: string | undefined } => {
    const labelled = options.field?.label?.()?.id;
    if (labelled) return { by: labelled, text: undefined };
    return { by: undefined, text: options.labels?.listbox ?? message('suggestions', 'Suggestions') };
  };

  const listboxProps = (): ComboboxProps => {
    const named = listboxName();
    return {
      ...anchor.floatingProps(),
      id: listboxId,
      role: 'listbox',
      'aria-multiselectable': multiple ? 'true' : undefined,
      'aria-labelledby': named.by,
      'aria-label': named.text,
      // Announce the list once it has settled rather than partway through
      // being rebuilt, which is what a screen reader would otherwise read.
      'aria-busy': undefined,
      'data-state': presence.state(),
      // No tabindex. Focus never enters the popup — the control keeps it for
      // the whole interaction — and a tab stop here would be a place a user
      // could land with nothing to operate.
    };
  };

  const optionProps = (option: ComboboxOptionOptions): ComboboxProps => {
    const chosen = valueState.get().includes(option.value);
    return {
      [ITEM_ATTRIBUTE]: '',
      id: optionId(option.value),
      role: 'option',
      // Said on every option, not only the chosen ones: with
      // `aria-multiselectable` the absence of the attribute is a statement
      // about selectability rather than about state.
      'aria-selected': String(chosen),
      // `aria-disabled`, never the `disabled` attribute: a disabled option
      // stays in the accessibility tree, so it can be found and heard to be
      // unavailable rather than appear to have vanished. The `data-` twin is
      // what the collection skips by.
      'aria-disabled': option.disabled ? 'true' : undefined,
      'data-disabled': option.disabled ? '' : undefined,
      'data-value': option.value,
      'data-label': option.textValue,
      'data-state': chosen ? 'checked' : 'unchecked',
      // The highlight is virtual, so CSS has no `:focus` to select on.
      'data-highlighted': activeValue.get() === option.value ? '' : undefined,
    };
  };

  const statusProps = (): ComboboxProps => ({
    // The role and the `aria-live` say the same thing on purpose: the role's
    // implicit value satisfies the specification, and some assistive
    // technology still honours only the explicit attribute.
    //
    // Render this element unconditionally. A live region only announces
    // changes to text inside a region that was already there, so one that
    // appears together with its message is a region that says nothing.
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });

  const nativeProps = (): ComboboxProps => {
    const props: Record<string, ComboboxProps[string]> = {
      multiple: multiple || undefined,
      // Reachable to the platform, invisible to assistive technology and to
      // Tab: the visible control carries the role and the tab stop, and
      // announcing both would announce the widget twice.
      tabindex: '-1',
      'aria-hidden': 'true',
      style: VISUALLY_HIDDEN_INPUT_STYLE,
    };
    // Omitted rather than set to undefined: `name` is a property on a form
    // control, and assigning undefined to it submits the string "undefined".
    if (options.name !== undefined) props.name = options.name;
    return props;
  };

  const nativeOptionProps = (option: ComboboxOptionOptions): ComboboxProps => ({
    value: option.value,
    selected: valueState.get().includes(option.value),
    disabled: option.disabled === true,
  });

  const anchorProps = (): ComboboxProps => anchor.anchorProps();

  /** Anchoring rides on the control unless the consumer named another element. */
  const controlAnchorProps = (): ComboboxProps =>
    options.anchor ? {} : (anchor.anchorProps() as ComboboxProps);

  /** Returns the value the press chose, or null when it chose nothing. */
  const onOptionClick = (event: MouseEvent): string | null => {
    const option = optionFrom(event.target);
    if (!option) return null;
    if (isDisabled(option)) {
      // A disabled option still swallows the press: it is visibly there, and
      // an `<a>` used as an option would otherwise follow its href.
      event.preventDefault();
      return null;
    }
    const value = option.getAttribute('data-value');
    if (value === null) return null;
    choose(value);
    return value;
  };

  const onOptionPointerMove = (event: PointerEvent): void => {
    const option = optionFrom(event.target);
    // Pointer *move* rather than enter, because a popup that opens under a
    // stationary cursor, or scrolls beneath it, never fires enter — and moving
    // within an option fires this many times, hence the check.
    if (!option || isDisabled(option) || option.getAttribute('data-value') === activeValue.get()) {
      return;
    }
    setActive(option);
  };

  const onListboxPointerDown = (event: PointerEvent): void => {
    // Keeps focus where it is. An option is not focusable, so in practice the
    // browser leaves focus alone — but a consumer who makes one focusable, or
    // a scrollbar drag inside the popup, would otherwise take it off the
    // control and close the popup out from under the press.
    event.preventDefault();
  };

  return {
    locale,
    controlId,
    listboxId,
    multiple,
    closesOnSelect,
    anchor,
    field,
    items,
    presence,
    openState,
    valueState,
    activeValue,
    optionCount,
    listRevision,
    typeahead,
    escape: {
      /** Whether dismissal has already answered the Escape now bubbling. */
      consume(): boolean {
        if (!escapeDismissed) return false;
        escapeDismissed = false;
        return true;
      },
    },
    disabled,
    readOnly,
    required,
    valuesNow,
    setValues,
    select,
    deselect,
    toggleValue,
    choose,
    clear,
    setOpen,
    openListbox,
    close,
    optionFor,
    activeOption,
    rememberController,
    setActive,
    move,
    moveTo,
    typeaheadMove,
    recount,
    nameValue,
    nameOf,
    labelOf,
    emptyMessage,
    loadingMessage,
    resultsMessage,
    message,
    listboxProps,
    optionProps,
    statusProps,
    nativeProps,
    nativeOptionProps,
    anchorProps,
    controlAnchorProps,
    onOptionClick,
    onOptionPointerMove,
    onListboxPointerDown,
  };
}

type ListboxCore = ReturnType<typeof createListboxCore>;

/** The parts of the public surface both components spell identically. */
interface ListboxCommon {
  /** The field this composes: label, description, validation, dirty and touched. */
  readonly field: FormField;
  /** The anchor this composes, for a consumer who wants to move the popup. */
  readonly anchor: Anchor;

  /** Whether the popup is logically open. */
  isOpen(): boolean;
  /** Whether the popup should be in the DOM — stays true during exit. */
  isPresent(): boolean;
  /** `open` or `closed`, for CSS to animate against. */
  state(): PresenceState;

  /** The first chosen value, or null. */
  value(): string | null;
  /** Every chosen value, in the order they were chosen. */
  values(): readonly string[];
  hasValue(): boolean;
  isSelected(value: string): boolean;
  /** The text last seen for a value, falling back to the value itself. */
  labelOf(value: string): string;
  /** Every chosen label, joined the way the locale joins a list. */
  displayValue(): string;

  /** The value holding virtual focus, or null. */
  activeValue(): string | null;
  /** The option holding virtual focus, for a consumer who needs the element. */
  activeOption(): HTMLElement | null;

  /** How many options the popup is showing. */
  optionCount(): number;
  /** Open, settled, and showing nothing. */
  isEmpty(): boolean;
  /** What the polite live region should be saying right now, or ''. */
  status(): string;
  /** The empty message, for rendering inside the popup as well as announcing it. */
  emptyMessage(): string;

  open(focus?: ListboxOpenFocus): void;
  close(): void;
  toggle(): void;
  select(value: string): void;
  deselect(value: string): void;
  /** Add or remove, whichever the value is not. */
  toggleValue(value: string): void;
  clear(): void;
  /** Move virtual focus, for a consumer driving it from elsewhere. */
  setActiveValue(value: string | null): void;

  onOptionClick(event: MouseEvent): void;
  onOptionPointerMove(event: PointerEvent): void;
  onListboxPointerDown(event: PointerEvent): void;

  listboxProps(): ComboboxProps;
  optionProps(option: ComboboxOptionOptions): ComboboxProps;
  /** `role="group"`, named by its own label rather than by an id pair. */
  groupProps(label: string): ComboboxProps;
  /** For the visible heading of a group, which its `aria-label` already carries. */
  groupLabelProps(): ComboboxProps;
  separatorProps(): ComboboxProps;
  nativeProps(): ComboboxProps;
  nativeOptionProps(option: ComboboxOptionOptions): ComboboxProps;
  statusProps(): ComboboxProps;
  /** For the element the popup lines up with, when it is not the control. */
  anchorProps(): ComboboxProps;
  /** For a button that empties the selection. */
  clearProps(): ComboboxProps;
}

/** The half of the surface that is written once and used by both. */
function commonSurface(core: ListboxCore): ListboxCommon {
  return {
    field: core.field,
    anchor: core.anchor,

    isOpen: () => core.openState.get(),
    isPresent: () => core.presence.isPresent(),
    state: () => core.presence.state(),

    value: () => core.valueState.get()[0] ?? null,
    values: () => core.valueState.get(),
    hasValue: () => core.valueState.get().length > 0,
    isSelected: (value) => core.valueState.get().includes(value),
    labelOf: core.labelOf,
    displayValue: () => {
      const labels = core.valueState.get().map(core.labelOf);
      if (labels.length === 0) return '';
      if (labels.length === 1) return labels[0] ?? '';
      // "A, B and C" in English, and whatever the locale does instead.
      return core.locale.format.list(labels);
    },

    activeValue: () => core.activeValue.get(),
    activeOption: () => core.activeOption(),

    optionCount: () => core.optionCount.get(),
    isEmpty: () => core.openState.get() && core.optionCount.get() === 0,
    status: () => '',
    emptyMessage: core.emptyMessage,

    open: (focus) => core.openListbox(focus),
    close: core.close,
    toggle: () => (core.openState.get() ? core.close() : core.openListbox()),
    select: core.select,
    deselect: core.deselect,
    toggleValue: core.toggleValue,
    clear: core.clear,
    setActiveValue: (value) => {
      if (value === null) core.activeValue.set(null);
      else core.setActive(core.optionFor(value));
    },

    onOptionClick: core.onOptionClick,
    onOptionPointerMove: core.onOptionPointerMove,
    onListboxPointerDown: core.onListboxPointerDown,

    listboxProps: core.listboxProps,
    optionProps: core.optionProps,
    groupProps: (label) => ({ role: 'group', 'aria-label': label }),
    // The group's `aria-label` already says this, so the heading is decoration
    // here. The alternative — an id pair — needs a key per group from the
    // consumer, and a group whose heading is read twice is the usual result.
    groupLabelProps: () => ({ 'aria-hidden': 'true' }),
    // Not `role="separator"`: a listbox may only contain options and groups,
    // and a separator among them is an error rather than a divider.
    separatorProps: () => ({ role: 'presentation', 'aria-hidden': 'true' }),
    nativeProps: core.nativeProps,
    nativeOptionProps: core.nativeOptionProps,
    statusProps: core.statusProps,
    anchorProps: core.anchorProps,
    clearProps: () => ({
      type: 'button',
      // Out of the tab order: it duplicates what Escape and Backspace already
      // do from the control, and a tab stop between the control and the rest
      // of the form is one more thing to step over on every pass.
      tabindex: '-1',
      'aria-label': core.message('clear', 'Clear'),
      'aria-disabled': core.disabled() || core.readOnly() ? 'true' : undefined,
    }),
  };
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export interface SelectOptions extends ListboxSharedOptions {
  /** The button that shows the value and opens the popup. */
  trigger: () => Element | null | undefined;
}

export interface Select extends ListboxCommon {
  onTriggerKeyDown(event: KeyboardEvent): void;
  onTriggerClick(): void;
  onTriggerBlur(): void;

  triggerProps(): ComboboxProps;
}

/**
 * A button showing the current value, and a popup listbox.
 *
 * The trigger carries `role="combobox"` rather than staying a plain button,
 * which is what the APG select-only pattern does: it is the element that owns
 * `aria-expanded`, `aria-controls` and `aria-activedescendant`, and a button
 * role cannot carry the last of those. Render it as a `<button>` all the same —
 * the role is overridden, the behaviour of a button is not.
 *
 * The keyboard map is the APG select-only combobox:
 *
 *   closed  Enter, Space, ArrowDown, ArrowUp   open, virtual focus on the
 *                                              selected option
 *           Alt+ArrowDown                      open with nothing highlighted
 *           Home, End                          open at the first, last option
 *           printable characters               choose the match without opening
 *   open    ArrowDown, ArrowUp                 next, previous option
 *           Home, End                          first, last
 *           PageDown, PageUp                   ten options on
 *           Enter, Space                       choose, close
 *           Alt+ArrowUp                        choose, close
 *           Tab                                choose, close, carry on out
 *           Escape                             close, value unchanged
 *           printable characters               move to the match
 *
 * Typeahead works on the closed trigger because the native `<select>` is a
 * `createCollection` of its own: real options, in DOM order, with the disabled
 * ones already skipped. Without a native control there is nothing to search
 * while the popup is closed, so typing opens it and searches there instead.
 */
export function createSelect(options: SelectOptions): Select {
  /**
   * What the native `<select>` calls a value.
   *
   * It holds the consumer's own catalogue — an `<option>` per value, rendered
   * whether or not the popup ever is — which is why a select can show the name
   * of a value it was handed before anything else on the page existed. A
   * combobox is handed no such thing: its native control is an `<input>`, or a
   * `<select>` whose options are rendered from `labelOf`, and reading that back
   * would only return what this component already said.
   */
  const nativeName = (value: string): string | undefined => {
    const native = options.native?.();
    if (!isSelectElement(native)) return undefined;
    for (const option of native.options) {
      if (option.value === value) return textOf(option) || undefined;
    }
    return undefined;
  };

  const core = createListboxCore(options, options.trigger, nativeName);
  const common = commonSurface(core);

  // The native control's own options, which exist whether or not the popup
  // does. `value` is the attribute every `<option>` carries, and the collection
  // already skips `[disabled]`.
  const nativeItems = createCollection(() => options.native?.(), { attribute: 'value' });

  /** Choose by typed prefix without opening, the way a native select does. */
  const closedTypeahead = (key: string): boolean => {
    const from = nativeItems
      .enabled()
      .find((el) => el.getAttribute('value') === core.valuesNow()[0]);
    const match = nativeItems.match(core.typeahead.push(key), from ?? null);
    if (!match) return false;
    const value = match.getAttribute('value');
    if (value === null) return false;
    core.select(value);
    return true;
  };

  const status = (): string => {
    if (!core.openState.get()) return '';
    const count = core.optionCount.get();
    return count === 0 ? core.emptyMessage() : core.resultsMessage(count);
  };

  const chooseActive = (): void => {
    const value = core.activeValue.get();
    if (value !== null) core.choose(value);
  };

  return {
    ...common,
    status,

    onTriggerClick() {
      if (core.disabled()) return;
      if (core.openState.get()) core.close();
      else core.openListbox('selected');
    },

    onTriggerBlur() {
      core.field.markTouched();
    },

    onTriggerKeyDown(event: KeyboardEvent) {
      // A modified key is a shortcut, not navigation. Alt is the exception:
      // it is part of this pattern's own map.
      if (event.ctrlKey || event.metaKey) return;

      const open = core.openState.get();
      const alt = event.altKey;

      switch (event.key) {
        case 'ArrowDown':
          if (!open) core.openListbox(alt ? 'none' : 'selected');
          else if (!alt) core.move(1);
          break;

        case 'ArrowUp':
          if (!open) core.openListbox(alt ? 'none' : 'selected');
          else if (alt) {
            // Alt+Up is the keyboard's "that one, thanks" — it commits and
            // collapses in a single press.
            chooseActive();
            core.close();
          } else core.move(-1);
          break;

        case 'Home':
          if (!open) core.openListbox('first');
          else core.moveTo(core.items.first());
          break;

        case 'End':
          if (!open) core.openListbox('last');
          else core.moveTo(core.items.last());
          break;

        case 'PageDown':
          if (!open) return;
          core.move(PAGE);
          break;

        case 'PageUp':
          if (!open) return;
          core.move(-PAGE);
          break;

        case 'Enter':
          if (!open) core.openListbox('selected');
          else {
            chooseActive();
            core.close();
          }
          break;

        case ' ':
          // A space inside a typeahead run is part of the search — "New " is
          // how you get past "New York" to "New Zealand".
          if (core.typeahead.pending !== '') {
            if (open) core.typeaheadMove(' ');
            else closedTypeahead(' ');
            break;
          }
          if (!open) core.openListbox('selected');
          else {
            chooseActive();
            core.close();
          }
          break;

        case 'Escape':
          // Dismissal has already closed it, in the capture phase. Nothing is
          // left for a select to clear, so the flag is only consumed.
          core.escape.consume();
          return;

        case 'Tab':
          if (!open) return;
          // Not prevented: the popup closes, the highlighted option is taken,
          // and the browser's own Tab carries on from the trigger — which is
          // where a user who tabbed out of a listbox expects to be.
          chooseActive();
          core.close();
          return;

        default: {
          if (!isPrintable(event)) return;
          if (open) core.typeaheadMove(event.key);
          else if (!closedTypeahead(event.key)) {
            // Nothing to search while closed, so search where the options are.
            core.openListbox('selected');
          }
          break;
        }
      }

      // Everything that reaches here was consumed. Arrows and Page keys would
      // scroll the page, Space would too, and Enter would submit the form the
      // trigger is sitting in.
      event.preventDefault();
    },

    triggerProps: () => {
      const open = core.openState.get();
      return {
        ...core.field.controlProps(),
        ...core.controlAnchorProps(),
        role: 'combobox',
        // A `<button>` in a form submits it unless it says otherwise, so
        // without this every pointer press on the trigger submits the form the
        // trigger exists to fill in. The keyboard path prevents the default
        // itself; a click has no default to prevent, only a type to declare.
        type: 'button',
        'aria-haspopup': 'listbox',
        'aria-expanded': String(open),
        'aria-controls': open ? core.listboxId : undefined,
        'aria-activedescendant':
          open && core.activeValue.get() !== null
            ? core.optionProps({ value: core.activeValue.get() ?? '' }).id
            : undefined,
        // In the tab order even when disabled, with `aria-disabled` rather
        // than the `disabled` attribute, because a control a keyboard user
        // cannot reach is a control they cannot discover is there.
        tabindex: '0',
        'data-state': core.presence.state(),
        'data-placeholder': core.valueState.get().length === 0 ? '' : undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Combobox
// ---------------------------------------------------------------------------

export interface ComboboxOptions<T> extends ListboxSharedOptions {
  /** The textbox the user types in. */
  input: () => Element | null | undefined;

  /** How much the textbox promises about the list. Default `list`. */
  autocomplete?: ComboboxAutocomplete;

  /**
   * Let a value that matches no option be committed on Enter or on blur.
   *
   * Off by default: a combobox that quietly accepts anything is a text field
   * with a list next to it, and the caller has to be able to say which of the
   * two they meant.
   */
  allowCustomValue?: boolean;

  /**
   * Whether an option's text matches what has been typed. Default: a
   * case-insensitive, accent-insensitive substring test in the current locale.
   */
  filter?: (text: string, query: string) => boolean;

  /**
   * Fetch the options for a query. Passed straight to `createResource`, which
   * is what makes a slow answer to an old query unable to land on a new one.
   */
  search?: ResourceFetcher<readonly T[], string>;
  /** Quiet time before a changed query is sent, in ms. Default 250. */
  searchDebounce?: number;
  /** How many times to try again after a failure. Default 0. */
  searchRetry?: number;
  /** Characters before a search goes out at all. Default 1. */
  minLength?: number;

  onInputValueChange?: (value: string) => void;
}

export interface Combobox<T = unknown> extends ListboxCommon {
  /** The resource behind `search`, or null when there is none. */
  readonly search: Resource<readonly T[]> | null;

  /**
   * What is in the textbox: the question being asked, or the name of the value
   * held. The element's own value may be further along — see `autocomplete`.
   */
  inputValue(): string;
  /**
   * Put text in the box from outside — a query restored with the session, a
   * "search for this" button. It stands as a question the same way a keystroke
   * does, so `search` is asked for it.
   */
  setInputValue(value: string): void;
  /**
   * Whether there is a question in the box narrowing the list — false until
   * something is typed, and false again once a choice has answered it.
   */
  isFiltering(): boolean;
  /** Whether an option's text survives the current filter. */
  matches(text: string): boolean;
  /** The last results from `search`, or an empty list. */
  items(): readonly T[];
  isLoading(): boolean;

  /** Take the typed text as the value. Only does anything with `allowCustomValue`. */
  commitCustomValue(): void;

  onInput(event: Event): void;
  onInputKeyDown(event: KeyboardEvent): void;
  onInputClick(): void;
  onInputBlur(): void;
  onToggleClick(): void;
  /** Keeps focus in the textbox when the toggle is pressed. Wire it to `pointerdown`. */
  onTogglePointerDown(event: PointerEvent): void;

  inputProps(): ComboboxProps;
  /**
   * For the button beside the textbox that opens the popup. It needs
   * `onToggleClick` on its click and `onTogglePointerDown` on its pointerdown:
   * without the second the press takes focus out of the textbox.
   */
  toggleProps(): ComboboxProps;
  /** For the list of chips, when `multiple`. */
  chipsProps(): ComboboxProps;
  chipProps(value: string): ComboboxProps;
  removeChipProps(value: string): ComboboxProps;
}

/**
 * A textbox that filters a popup listbox.
 *
 * DOM focus stays in the textbox for the whole interaction — that is the
 * defining constraint of the pattern, and everything else follows from it:
 * virtual focus, `aria-activedescendant`, no focus trap, and a popup that
 * cancels the pointer press that lands on it.
 *
 * The keyboard map is the APG combobox with a listbox popup:
 *
 *   ArrowDown          open with the first option highlighted, then move on
 *   Alt+ArrowDown      open with nothing highlighted
 *   ArrowUp            open with the last option highlighted, then move back
 *   Alt+ArrowUp        close, keeping what is typed
 *   PageDown, PageUp   ten options on, while open
 *   Enter              take the highlighted option; or the typed text, with
 *                      `allowCustomValue`; otherwise let the form have it
 *   Escape             close the popup; and once it is closed, clear the text
 *   Tab                take the highlighted option, close, carry on out
 *   Backspace          on an empty multiple, remove the last chip
 *   Home, End          left alone — in a textbox they belong to the caret
 *   printable          filter, and open if it is not already open
 */
export function createCombobox<T = unknown>(options: ComboboxOptions<T>): Combobox<T> {
  const core = createListboxCore(options, options.input);
  const common = commonSurface(core);

  const autocomplete = options.autocomplete ?? 'list';
  const minLength = options.minLength ?? 1;

  /**
   * What the user is asking, or null while the box is showing what is held.
   *
   * The textbox says one of exactly two things, and this is which: a question
   * somebody entered — typed, or put there by the caller, which stands as a
   * question the same way — or the name of the value the widget holds. Nothing
   * else about the box is state. Whether the list is narrowed, whether there is
   * a search to make, and what belongs in the element all read off this, so
   * they cannot come apart from each other or from what is on the screen.
   *
   * A question is retired by being answered: choosing puts a value where the
   * question was. Nothing else retires one — in particular, opening the popup
   * does not, because a press to reposition the caret in half-typed text is not
   * an answer to it.
   */
  const asked = new Signal.State<string | null>(null);

  /** Bumped by an insertion, so inline completion runs for typing and not for deletion. */
  const completions = new Signal.State(0);

  /** What the list is being narrowed by, and what `search` is being asked. */
  const query = (): string => asked.get() ?? '';

  const searchEnabled = (): boolean => query().length >= minLength;

  /**
   * The query the results in hand are the answer to.
   *
   * `isLoading` is false for the whole debounce window: the resource is not
   * told about a keystroke until the timer fires, and until then it is still
   * holding the answer to the query before this one. So whether the popup may
   * call itself empty is settled by which query was answered rather than by the
   * status — the request that is about to go out has not been made yet, and a
   * list that has not been asked is not a list that came back with nothing.
   */
  const answered = new Signal.State<string | null>(null);

  const fetcher = options.search;
  const search = fetcher
    ? createResource<readonly T[], string>(
        async (request) => {
          try {
            return await fetcher(request);
          } finally {
            // Stamped by the request rather than by whatever is in the box when
            // it lands: an answer to an earlier query arriving inside the quiet
            // time before a later one goes out is not an answer to the later
            // one. A superseded request is aborted before its answer is
            // dropped, and saying it had been answered would let the popup call
            // itself empty for a query nothing has asked.
            if (!request.signal.aborted) answered.set(request.source);
          }
        },
        {
          // The question, never the box: text this component wrote to say what
          // is held is an answer, and searching for it would mean a request at
          // mount for a value nobody typed and another after every choice, for
          // the label of the thing just chosen. An empty box with a caret in it
          // is a question — it asks for everything — which is where a search
          // with no minimum length starts and what it goes back to.
          source: query,
          enabled: searchEnabled,
          debounce: options.searchDebounce ?? 250,
          retry: options.searchRetry ?? 0,
          // The combobox announces the count itself; a resource that also said
          // "Loaded" would talk over it after every keystroke.
          labels: { loading: core.loadingMessage(), success: '' },
        },
      )
    : null;

  /** Whether the list is still catching up with what has been typed. */
  const searching = (): boolean =>
    search !== null && searchEnabled() && (search.isLoading() || answered.get() !== query());

  const inputElement = (): HTMLInputElement | null => {
    const el = options.input();
    return el && 'value' in el && 'setSelectionRange' in el ? (el as HTMLInputElement) : null;
  };

  const fold = (text: string): string =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase(core.locale.code());

  const defaultFilter = (text: string, typed: string): boolean =>
    fold(text).includes(fold(typed));

  const matches = (text: string): boolean => {
    // `none` means the popup is a plain list that typing does not narrow.
    if (autocomplete === 'none') return true;
    const typed = query();
    if (typed === '') return true;
    return (options.filter ?? defaultFilter)(text, typed);
  };

  /**
   * The value the textbox is showing, when it is showing one.
   *
   * A single-value combobox shows the one value it holds. A multiple shows its
   * values as chips and keeps the box for typing, so it shows none — which is
   * the whole of the difference between them here, said once.
   */
  const shownValue = (values: readonly string[]): string | undefined =>
    core.multiple ? undefined : values[0];

  /**
   * What the box says when it is not being asked anything.
   *
   * Empty when nothing on the page can name the value held. That is a value
   * the form still submits and `value()` still reports, shown by a box with
   * nothing in it — and the alternative is worse, because the identifier is
   * not a name: it is text the widget would be claiming somebody typed, and
   * every part of this that reads what is in the box would then read an
   * internal token as a question. It fills in by itself the moment anything
   * can say what the value is called; `labelFor` is how a caller says now.
   */
  const shownName = (values: readonly string[]): string => {
    const value = shownValue(values);
    return value === undefined ? '' : (core.nameOf(value) ?? '');
  };

  /** What belongs in the textbox: the question in it, or the name of what is held. */
  const boxText = (): string => asked.get() ?? shownName(core.valueState.get());

  /**
   * Take what is in the box as a value.
   *
   * Only a question can be committed, so the box showing "Cherry" over a chosen
   * `ch` offers nothing: that is this component's own answer, and every blur
   * after a successful pick would otherwise arrive here holding it out. Text
   * naming a value already held is the same thing typed by hand and is refused
   * for the same reason — either way, taking it replaces an option's id with
   * its human text behind the form's back.
   *
   * What is taken is its own name, and the only one it will ever have: the
   * value came from the user writing it down.
   */
  const commitCustomValue = (): void => {
    if (options.allowCustomValue !== true) return;
    const typed = untrack(() => asked.get())?.trim() ?? '';
    if (typed === '') return;

    untrack(() => {
      if (!core.valuesNow().some((value) => core.labelOf(value) === typed)) {
        core.nameValue(typed, typed);
        core.select(typed);
      }
      asked.set(null);
    });
  };

  /** What a press or an Enter on an option leaves in the textbox. */
  const takeOption = (value: string): void => {
    core.choose(value);
    // Nothing was taken, so the question stands: a read-only combobox that
    // answered a press it refused would clear text the user is still typing.
    if (core.disabled() || core.readOnly()) return;
    // Retired here as well as by the value changing, because choosing the value
    // already held changes nothing and is still an answer.
    asked.set(null);
  };

  /**
   * Adopt the text the page was rendered with as a name for the value it holds.
   *
   * A form the server filled in, or one the browser restored, arrives with the
   * label of the value in the box and the value itself in the control that
   * submits — and on a page whose popup has never been opened that label is the
   * only name for it anywhere. It is filed like any other, so from here on the
   * chips, the announcements and a blur all have it too. Whether there is a
   * value to name is `shownValue`'s answer and nobody else's: a multiple keeps
   * its box for typing, so nothing it was rendered with names anything.
   */
  let adopted = false;
  effect(() => {
    const el = inputElement();
    if (!el || adopted) return;
    adopted = true;
    const value = shownValue(untrack(() => core.valueState.get()));
    if (value !== undefined) core.nameValue(value, el.value);
  });

  /**
   * Keep the textbox on whichever of the two things it is saying.
   *
   * One writer, driven by the state rather than called from the places that
   * change it — which is what makes the routes agree: a press on an option
   * never passes through this component's key handling, a chip's remove button
   * passes through neither, and a controlled `value` set from outside passes
   * through nothing here at all. Each of those is a value changing, and a value
   * changing is the whole of what this has to notice.
   *
   * Only this effect's own writes are replaced. Inline completion puts more in
   * the element than the box is holding, and the difference is a proposal with
   * a caret in it; a name learned a moment later must not reach past it.
   */
  let lastValues: readonly string[] | null = null;
  let lastAsked: string | null = null;
  let written: string | null = null;
  /**
   * Which element `written` describes.
   *
   * The guard below exists to leave an inline completion alone — the element
   * holds more than the box is saying, and the difference is a proposal with a
   * caret in it. But a record of the last write means nothing about an element
   * that was not written: a textbox rendered again is a new node holding
   * whatever markup brought it, and without this the guard would suppress the
   * one write that would put it right.
   */
  let writtenTo: Element | null = null;
  effect(() => {
    const values = core.valueState.get();
    const question = asked.get();
    const held = shownName(values);
    const el = inputElement();
    if (!el) return;

    untrack(() => {
      const chosen = lastValues !== null && !sameValues(values, lastValues);
      lastValues = values;
      // A value arriving answers whatever was being asked, whichever route
      // brought it.
      if (chosen && question !== null) asked.set(null);
      const text = chosen ? held : (question ?? held);

      // A name turning up for a value nobody has touched is not somebody
      // typing: what changed is what the page can call the value, not what has
      // been chosen, and reporting it would be this component telling the
      // caller what they have just told it.
      const learned = !chosen && question === null && lastAsked === null;
      lastAsked = chosen ? null : question;

      const sameText = text === written;
      const sameElement = el === writtenTo;
      if (sameText && sameElement) return;
      const first = written === null;
      written = text;
      writtenTo = el;
      // Written straight to the element rather than bound in the template: this
      // owns the textbox's value — it completes it, reverts it and clears it —
      // and a `:value` binding beside that is two writers for one string.
      if (el.value !== text) el.value = text;
      // A remount is not somebody typing: the element changed and the string
      // did not, so there is nothing to report.
      const remountedOnly = sameText && !sameElement;
      if (!first && !learned && !remountedOnly) options.onInputValueChange?.(text);
    });
  });

  /**
   * Complete the textbox from the first option, and select the part the user
   * did not type.
   *
   * Only insertions ask for a completion: completing after a Backspace puts
   * the deleted characters straight back, which makes the field impossible to
   * empty. But the keystroke is not enough to *run* on, because on the first
   * character the popup is opened by the same handler that asks, and nothing
   * is rendered yet when this first passes; an async answer lands later still.
   * So the request stands until the list it needs turns up: the revision the
   * core bumps for every rendered change is the dependency, and `completed`
   * records which keystroke has been answered so a settled list is not
   * re-completed under a caret the user has since moved.
   *
   * Answered is not the same as completed. A popup that has rendered and holds
   * no completion has answered the keystroke — with "there is none for that" —
   * and a request left standing on it would be waiting for a keystroke that has
   * been dealt with: the next change to the options, from a poll or a websocket
   * the user is not driving, would rewrite the textbox and move virtual focus
   * with nothing behind it. So an empty popup answers, and the one thing that
   * keeps the keystroke waiting is a request for that exact query still being
   * in flight. Whether the emptiness came from this component's own filter or
   * from a consumer who narrowed their candidates themselves cannot be told
   * apart from the outside, and guessing wrong that way rewrites text under a
   * caret nobody moved — where guessing wrong the other way costs a completion
   * the next keystroke offers again.
   */
  let completed = 0;
  effect(() => {
    if (autocomplete !== 'both') return;
    const keystroke = completions.get();
    core.listRevision.get();
    if (keystroke === completed) return;

    untrack(() => {
      const typed = query();
      const el = inputElement();
      if (!el || typed === '') return;

      // The list the keystroke asked about is not here yet: the popup renders
      // after the handler that opened it, and a search answers later still.
      if (!options.listbox() || searching()) return;

      completed = keystroke;
      const first = core.items.first();
      if (!first) return;
      const text = textOf(first);
      if (!fold(text).startsWith(fold(typed))) return;

      el.value = text;
      el.setSelectionRange(typed.length, text.length);
      // The completion is a proposal the user is looking at, so the option it
      // came from is the one Enter should take.
      core.setActive(first);
    });
  });

  // Keep the count honest for the two changes this component makes itself, so
  // the live region does not lag a keystroke behind the list.
  effect(() => {
    asked.get();
    search?.data();
    search?.status();
    untrack(() => core.recount());
  });

  /** Escape's second stage. False when there was nothing to clear. */
  const clearTextbox = (): boolean => {
    // Emptying the box is a change like any other, and a read-only one left
    // showing nothing over a value it still holds is the same disagreement a
    // press on an option would have caused.
    if (core.disabled() || core.readOnly()) return false;
    if (untrack(boxText) === '' && core.valuesNow().length === 0) return false;
    asked.set(null);
    // A single-value combobox showing nothing holds nothing; a multiple keeps
    // its chips, which Backspace and the chip buttons remove.
    if (!core.multiple) core.clear();
    return true;
  };

  /**
   * How many layers were up when the Escape now being handled arrived.
   *
   * Dismissal owns Escape on the document and in the capture phase, so by the
   * time a handler on the textbox runs the topmost layer has already been given
   * the press — and counting the stack then cannot tell a layer that answered
   * and went away from one that was never there. Counted first, it can.
   */
  let layersAtPress = 0;

  /**
   * Escape's second stage, claimed ahead of dismissal when this textbox is
   * where the press landed.
   *
   * One press closes one layer, and the layer a user pressing Escape into a
   * focused textbox is addressing is this one — not the dialog around it, which
   * would otherwise be dismissed by the same press that clears the box. Nothing
   * else on the page can answer that press first: the window is the one place
   * in the path ahead of the document, and stopping it there is what keeps the
   * two from happening at once. The popup, while it is up, is the layer being
   * addressed instead, and dismissal is left to take it.
   */
  effect(() => {
    const el = inputElement();
    const view = el?.ownerDocument.defaultView;
    if (!el || !view) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      layersAtPress = dismissStackSize();
      if (el.ownerDocument.activeElement !== el) return;
      if (untrack(() => core.openState.get())) return;
      if (!untrack(clearTextbox)) return;
      event.stopPropagation();
      event.preventDefault();
    };

    view.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => view.removeEventListener('keydown', onKeyDown, true));
  });

  const status = (): string => {
    if (!core.openState.get()) return '';
    if (searching()) return core.loadingMessage();
    if (search?.isError() === true) return search.errorMessage();
    const count = core.optionCount.get();
    return count === 0 ? core.emptyMessage() : core.resultsMessage(count);
  };

  return {
    ...common,
    search,
    status,

    // "Open, settled, and showing nothing" — a search the list has not caught
    // up with is not settled, and a popup that flashes "No results" between
    // every keystroke and its answer tells the user something untrue. The
    // quiet time before a debounced request even goes out is part of that
    // window; the popup's empty state and `status()` both render from this.
    isEmpty: () => core.openState.get() && !searching() && core.optionCount.get() === 0,

    inputValue: boxText,
    setInputValue: (value) => asked.set(value),
    isFiltering: () => asked.get() !== null,
    matches,
    items: () => search?.data() ?? [],
    isLoading: () => search?.isLoading() ?? false,
    commitCustomValue,

    onInput(event: Event) {
      const target = event.target;
      const typed = target && 'value' in target ? String((target as { value: unknown }).value) : '';
      const grew = typed.length > untrack(boxText).length;

      // Typing invalidates the highlight: the option it named may not survive
      // the filter, and `aria-activedescendant` must never point at an id that
      // has left the document.
      core.activeValue.set(null);
      asked.set(typed);
      // Typing opens the popup — including a deletion back to empty, where the
      // list is simply unfiltered again.
      core.openListbox('none');
      if (grew) completions.set(untrack(() => completions.get()) + 1);
    },

    onInputClick() {
      // Opens, never closes, and says nothing about what is in the box: a press
      // to reposition the caret in text already typed must not take the list
      // away, nor answer the question the text is.
      if (!core.openState.get()) core.openListbox('none');
    },

    onToggleClick() {
      if (core.openState.get()) core.close();
      else core.openListbox('selected');
    },

    onTogglePointerDown(event: PointerEvent) {
      // Whatever this is wired to controls the popup, whether or not it also
      // carries the `aria-controls` that says so — see `popupControllers`.
      core.rememberController(event.currentTarget ?? event.target);
      // A `tabindex="-1"` button is still click-focusable, so the press would
      // otherwise take focus out of the textbox: `onInputBlur` closes the
      // popup, and the click that follows opens it again — the button would
      // never close anything. Focus staying in the textbox is the pattern's
      // defining constraint, not a convenience.
      event.preventDefault();
    },

    onOptionClick(event: MouseEvent) {
      // The pointer route goes through the core, so the same answer has to be
      // read off what it chose — a press that took nothing leaves the question
      // standing, exactly as the keyboard's own Enter does.
      const chosen = core.onOptionClick(event);
      if (chosen !== null && !core.disabled() && !core.readOnly()) asked.set(null);
    },

    onInputBlur() {
      core.field.markTouched();
      if (options.allowCustomValue === true && !core.multiple) commitCustomValue();
      // Whatever is left in the box is not a value, so the box goes back to
      // saying which one is. Leaving it would show text the form does not hold.
      asked.set(null);
      core.close();
    },

    onInputKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey) return;

      const open = core.openState.get();
      const alt = event.altKey;

      switch (event.key) {
        case 'ArrowDown':
          if (!open) core.openListbox(alt ? 'none' : 'first');
          else if (!alt) core.move(1);
          break;

        case 'ArrowUp':
          if (!open) core.openListbox(alt ? 'none' : 'last');
          else if (alt) core.close();
          else core.move(-1);
          break;

        case 'PageDown':
          if (!open) return;
          core.move(PAGE);
          break;

        case 'PageUp':
          if (!open) return;
          core.move(-PAGE);
          break;

        case 'Enter': {
          const value = open ? core.activeValue.get() : null;
          // Closing is the core's decision, and it is the same decision a
          // press on the option makes: `closeOnSelect` defaults to false when
          // `multiple`, and a keyboard that closed anyway would mean reopening
          // the list once per chip — or closing on the one press that takes a
          // chip away, which the pointer leaves open.
          if (value !== null) {
            takeOption(value);
            break;
          }
          if (options.allowCustomValue === true && query().trim() !== '') {
            commitCustomValue();
            if (core.closesOnSelect) core.close();
            break;
          }
          // Nothing to take. Enter belongs to the form, and swallowing it here
          // is how a combobox stops a one-field form ever being submitted.
          return;
        }

        case 'Escape':
          if (core.escape.consume()) {
            // The popup took this press. The text stays: a user who wanted it
            // gone presses Escape again, which is the stage below.
            event.preventDefault();
            return;
          }
          // A layer was up when this press arrived — a dialog over the page,
          // another popup elsewhere — and dismissal has already answered it on
          // that layer's behalf. One press closes one layer, so this one stands
          // down rather than throwing away text the user can still see under a
          // list they were not addressing. A press into the textbox itself
          // never reaches here: it is claimed before dismissal sees it.
          if (layersAtPress > 0) return;
          if (!clearTextbox()) return;
          break;

        case 'Tab':
          if (!open) return;
          if (core.activeValue.get() !== null) takeOption(core.activeValue.get() ?? '');
          core.close();
          return;

        case 'Backspace': {
          // Only on an empty box, so it never eats a character the user meant.
          if (!core.multiple || boxText() !== '') return;
          const last = core.valuesNow().at(-1);
          if (last === undefined) return;
          core.deselect(last);
          return;
        }

        // Home and End are absent on purpose: in a textbox they move the
        // caret, and taking them for the list would break editing the query.

        default:
          return;
      }

      // Everything that reaches here was consumed: the arrows and Page keys
      // would scroll the page or jump the caret, and Enter would submit.
      event.preventDefault();
    },

    inputProps: () => {
      const open = core.openState.get();
      return {
        ...core.field.controlProps(),
        ...core.controlAnchorProps(),
        role: 'combobox',
        type: 'text',
        'aria-haspopup': 'listbox',
        'aria-expanded': String(open),
        'aria-controls': open ? core.listboxId : undefined,
        'aria-activedescendant':
          open && core.activeValue.get() !== null
            ? core.optionProps({ value: core.activeValue.get() ?? '' }).id
            : undefined,
        'aria-autocomplete': autocomplete,
        // The browser's own autofill over a combobox drops a second list on
        // top of this one, and its spellchecker underlines every proper noun
        // in the catalogue.
        autocomplete: 'off',
        spellcheck: false,
        'data-state': core.presence.state(),
      };
    },

    toggleProps: () => ({
      type: 'button',
      // Out of the tab order. The textbox already carries `aria-expanded` and
      // opens from the keyboard, so this button is a pointer affordance; a tab
      // stop for it would be a second way to reach the same state.
      tabindex: '-1',
      'aria-label': options.labels?.toggle ?? core.message('showSuggestions', 'Show suggestions'),
      'aria-expanded': String(core.openState.get()),
      'aria-controls': core.openState.get() ? core.listboxId : undefined,
    }),

    chipsProps: () => {
      const count = core.valueState.get().length;
      return {
        role: 'list',
        'aria-label':
          options.labels?.selected?.(count) ??
          core.message('selected', `${count} selected`, { n: count }),
      };
    },

    chipProps: (value) => ({
      role: 'listitem',
      'data-value': value,
    }),

    removeChipProps: (value) => {
      const label = core.labelOf(value);
      return {
        type: 'button',
        // A tab stop each. The alternative — a roving tabindex over the chips —
        // costs one keyboard pattern the user has to discover, and Backspace
        // from the textbox already covers removing the one just added.
        tabindex: '0',
        'aria-label': options.labels?.remove?.(label) ?? `${core.message('remove', 'Remove')} ${label}`,
        'data-value': value,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The keystroke buffer behind typeahead.
 *
 * `createRovingFocus` owns this for a collection that takes real DOM focus,
 * and cannot be used here: it moves focus to the item it matches, which is
 * precisely what a combobox must never do. What is shared is the part that
 * matters — the matching itself is `collection.match`, so a menu, a select and
 * a combobox all agree on what a typed prefix means.
 */
function createTypeahead(timeout: () => number) {
  let search = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  onCleanup(stop);

  return {
    /** Add a character and return what to search for. */
    push(key: string): string {
      search += key;
      stop();
      timer = setTimeout(() => {
        search = '';
        timer = null;
      }, timeout());

      // Repeating one character walks through the options starting with it,
      // rather than searching for "aaa" — what every native listbox does.
      return search.length > 1 && [...search].every((c) => c === search[0]) ? (search[0] ?? '') : search;
    },
    /** What has accumulated so far, for deciding whether a space is a search. */
    get pending(): string {
      return search;
    },
    clear(): void {
      search = '';
      stop();
    },
  };
}

/** The option an event happened in, allowing for markup inside the option. */
function optionFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(`[${ITEM_ATTRIBUTE}]`);
}

/**
 * The same two attributes the collection skips by, so that navigation and
 * selection can never disagree about what is disabled.
 */
function isDisabled(option: Element): boolean {
  return option.hasAttribute('data-disabled') || option.hasAttribute('disabled');
}

/**
 * The text a user would say this option is.
 *
 * `data-label` wins when present, because an option's visible text may include
 * an icon's alt text, a badge or a count — none of which anyone types when
 * reaching for it. The same rule the collection matches by.
 */
function textOf(el: Element): string {
  return (el.getAttribute('data-label') ?? el.textContent ?? '').trim();
}

function toValues(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : [...value];
}

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Narrow to a native `<select>` by tag name rather than by `instanceof`.
 *
 * An element adopted from another document is not an instance of *this*
 * window's `HTMLSelectElement`, and the constructor is a browser global that
 * does not exist at all on a server, where the check would throw rather than
 * answer. The tag name is true in every one of those cases.
 */
function isSelectElement(el: Element | null | undefined): el is HTMLSelectElement {
  return el?.tagName === 'SELECT';
}

/**
 * The form a control belongs to.
 *
 * The `form` property is the authority, because a control can be associated
 * with a form it is not inside through the `form` attribute; `closest` covers
 * anything that has no such property.
 */
function formOf(control: Element): HTMLFormElement | null {
  const owner = (control as { form?: unknown }).form;
  if (owner && typeof owner === 'object' && 'addEventListener' in owner) {
    return owner as HTMLFormElement;
  }
  return control.closest<HTMLFormElement>('form');
}

/** A single character with no modifier: a search, not a shortcut. */
function isPrintable(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}
