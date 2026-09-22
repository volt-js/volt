import { Component, Prop, Signal, createContext, provideContext } from '@voltdev/core';
import {
  createTabs,
  type Tabs,
  type TabsActivation,
  type TabsOrientation,
} from '@voltdev/primitives';
import { TagChildren } from './children.js';
import type { VTab } from './tab.js';

/**
 * How a tab finds the tabs it was written inside.
 *
 * The content of a tag is built while the tag it sits in renders, so a tab's
 * scope descends from this one. A tab written anywhere else finds nothing and
 * says so.
 */
export const TabsContext = createContext<VTabs | null>(null);

/**
 * A list of tabs over the panel belonging to the one that is selected.
 *
 * ```html
 * <v-tabs :value="section" label="Settings">
 *   <v-tab value="account" label="Account">
 *     <p>Who you are.</p>
 *   </v-tab>
 *   <v-tab value="billing" label="Billing">
 *     <p>What you owe.</p>
 *   </v-tab>
 * </v-tabs>
 * ```
 *
 * One tag holds both halves of a section. The tab is what `<v-tab>` draws,
 * inside the list; the panel is what was written inside that tag, which this
 * draws below the list with `<slot :from>`. The alternative — a tab tag and a
 * panel tag paired by a value — has a failure nothing catches: a mistyped
 * value leaves a tab whose panel never shows and a panel no tab points at,
 * and each half is perfectly consistent with itself. Here there is one value,
 * written once, and the primitive mints the pair of ids from it.
 *
 * The one element this adds that the sheet does not draw is the element the
 * caller's own `class` lands on, wrapping the list and the panels. A vertical
 * tab list stands beside its panels rather than above them, and that is the
 * page's layout rather than the widget's, so it needs somewhere to be written.
 *
 * Everything the primitive is given it is given once, while this field list
 * initializes, so every prop below is plain except the value — which is the
 * one thing that changes, and is a signal both sides hold.
 *
 * The element the primitive is handed is the list, never a root wrapping the
 * list and the panels both: a panel very often holds a second tabs widget,
 * and a query from a root would collect that widget's tabs as members of this
 * list.
 */
@Component({ selector: 'v-tabs', templateUrl: './tabs.html' })
export class VTabs {
  /** Your own signal, when the selection belongs to your component. */
  @Prop() value?: Signal.State<string>;
  /**
   * The six below are what the primitive is built with, read once while this
   * field list initializes — plain, because a signal would promise a caller
   * they can change them later and the primitive would not hear it.
   */
  /** Selected first. Without one the first tab selects itself as it renders. */
  @Prop() defaultValue?: string;
  /** Which arrows move between tabs, and which edge the sheet draws. */
  @Prop() orientation: TabsOrientation = 'horizontal';
  /**
   * `manual` moves focus with the arrows and selects on Enter or Space, for a
   * panel that costs a request to show.
   */
  @Prop() activation: TabsActivation = 'automatic';
  /** Wrap past the first and last tab. */
  @Prop() loop = true;
  /**
   * The name of the tab list. Without one it has none, because a default
   * would be in this package's language rather than the page's.
   */
  @Prop() label?: string;
  /** Id of the element naming the list, when that name is already on screen. */
  @Prop() labelledBy?: string;
  /** Called with the value a user selected, never with a default. */
  @Prop() onValueChange?: (value: string) => void;

  /** The tab list, which is the element the primitive is given. */
  list = new Signal.State<Element | null>(null);

  /**
   * The `<v-tab>` children, in the order their tabs are in the list.
   *
   * Not called `tabs`, because that is the primitive: one tag here is a
   * section — a tab and the panel it shows — and what this list is for is
   * drawing the second half of each one.
   */
  readonly sections = new TagChildren<VTab>(
    () => this.list.get(),
    (section) => section.element,
  );

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly tabs: Tabs = createTabs({
    list: () => this.list.get(),
    orientation: this.orientation,
    activation: this.activation,
    loop: this.loop,
    ...(this.value ? { value: this.value } : {}),
    ...(this.defaultValue !== undefined ? { defaultValue: this.defaultValue } : {}),
    ...(this.label !== undefined ? { label: this.label } : {}),
    ...(this.labelledBy !== undefined ? { labelledBy: this.labelledBy } : {}),
    ...(this.onValueChange ? { onValueChange: this.onValueChange } : {}),
  });

  constructor() {
    provideContext(TabsContext, this);
  }
}
