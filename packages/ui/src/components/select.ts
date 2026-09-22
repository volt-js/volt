import { Component, Prop, Signal, createContext, provideContext } from '@voltdev/core';
import { createSelect, type Select } from '@voltdev/primitives';
import { TagChildren } from './children.js';
import type { VOption } from './option.js';

/** How an option finds the select it was written inside. */
export const SelectContext = createContext<VSelect | null>(null);

/**
 * A select: a button showing the value, over a popup list.
 *
 * ```html
 * <v-select :value="country" name="country" placeholder="Choose a country">
 *   <v-option value="fr" label="France"></v-option>
 *   <v-option value="jp" label="Japan"></v-option>
 * </v-select>
 * ```
 *
 * The options are tags, and each one draws a real `<option>` inside the
 * hidden native `<select>` this renders — which is not a detail. That native
 * control is what submits with the form, what validates, and what the
 * primitive reads a value's name from before the popup has ever been opened.
 * The popup's rows are drawn from the same options when it opens, so an option
 * is rendered once whether the list is open or not.
 *
 * The value is always a list, even here, because that is the one shape the
 * primitive keeps for both this and a multiple select — `values()` is the
 * list, `value()` is the first of it.
 */
@Component({ selector: 'v-select', templateUrl: './select.html' })
export class VSelect {
  /** Your own signal, when the value belongs to your component. */
  @Prop() value?: Signal.State<readonly string[]>;
  /** What to start with, as a value rather than a name for one. */
  @Prop() defaultValue?: string | readonly string[];
  /** More than one at a time. */
  @Prop() multiple = false;
  /** Submitted as `name=value`. Without a name the native control submits nothing. */
  @Prop() name?: string;
  /** Your own signal for the popup, when you need to drive it. */
  @Prop() open?: Signal.State<boolean>;

  /** Shown in the button while nothing is chosen. */
  @Prop() placeholder = new Signal.State('Choose one');
  /** Blocks opening and choosing, and is written through to the native control. */
  @Prop() disabled = new Signal.State(false);
  /** Blocks choosing but not opening: the value can still be read. */
  @Prop() readOnly = new Signal.State(false);
  /** Written through to the native control, so the platform enforces it. */
  @Prop() required = new Signal.State(false);

  @Prop() onValueChange?: (values: readonly string[]) => void;
  @Prop() onOpenChange?: (open: boolean) => void;

  trigger = new Signal.State<Element | null>(null);
  listbox = new Signal.State<Element | null>(null);
  /** The hidden `<select>`, which is also where the options put themselves. */
  native = new Signal.State<Element | null>(null);

  readonly options = new TagChildren<VOption>(
    () => this.native.get(),
    (option) => option.element,
  );

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly select: Select = createSelect({
    trigger: () => this.trigger.get(),
    listbox: () => this.listbox.get(),
    native: () => this.native.get(),
    disabled: () => this.disabled.get(),
    readOnly: () => this.readOnly.get(),
    required: () => this.required.get(),
    multiple: this.multiple,
    ...(this.name !== undefined ? { name: this.name } : {}),
    ...(this.value ? { value: this.value } : {}),
    ...(this.defaultValue !== undefined ? { defaultValue: this.defaultValue } : {}),
    ...(this.open ? { open: this.open } : {}),
    ...(this.onValueChange ? { onValueChange: this.onValueChange } : {}),
    ...(this.onOpenChange ? { onOpenChange: this.onOpenChange } : {}),
  });

  constructor() {
    provideContext(SelectContext, this);
  }

  /**
   * Whether an option of the caller's is the empty value.
   *
   * The native control needs an entry for "nothing chosen", and renders one —
   * unless a caller has written an option for it, in which case theirs is the
   * one with the name, and two entries sharing a value would leave the control
   * showing the wrong one.
   */
  claimsNothing(): boolean {
    return this.options.all.get().some((option) => option.value.get() === '');
  }

  /**
   * What the button shows: the chosen names, or the placeholder.
   *
   * The names come from the options rather than from the control, and that is
   * not a shortcut. A name the primitive gives back was learned when an option
   * rendered, out of the native control's DOM, which no binding can depend on
   * — so the button would keep the name a value had when it was chosen,
   * however the option is renamed afterwards, and would say nothing at all for
   * a value whose option arrived late.
   *
   * More than one name is handed back to the primitive, which joins a list the
   * way the locale does. That join is worth more than a rename being a beat
   * behind in a multiple select.
   */
  shown(): string {
    const values = this.select.values();
    if (values.length === 0) return this.placeholder.get();
    if (values.length > 1) return this.select.displayValue();

    const value = values[0]!;
    const option = this.options.all.get().find((each) => each.value.get() === value);
    return option ? option.label.get() : this.select.labelOf(value);
  }
}
