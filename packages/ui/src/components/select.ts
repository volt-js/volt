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

  /** What the button shows: the chosen names, or the placeholder. */
  shown(): string {
    return this.select.hasValue() ? this.select.displayValue() : this.placeholder.get();
  }
}
