import { Component, Prop, Signal, createContext, effect, provideContext } from '@voltdev/core';
import {
  createTabs,
  type Tabs,
  type TabsActivation,
  type TabsOptions,
  type TabsOrientation,
} from '@voltdev/primitives';
import { TagChildren } from './children.js';
import type { VTab } from './tab.js';

/** Replaced by the build; `true` where there is none, which is a test run. */
declare const __VOLT_DEV__: boolean;

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
 * That element carries no role, so a name written on the tag as `aria-label`
 * would name nothing at all: `label` is what names the list, and a name that
 * lands on the wrapper is said out loud in development.
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
   * The four below are read once, while this field list initializes: three of
   * them are what the primitive is *built* with, and `defaultValue` is what
   * starts the selection. Plain, because a signal would promise a caller they
   * can change them later while the widget went on drawing and keying the
   * value it was built with.
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
   * The name of the tab list, and the id of an element already carrying that
   * name. Without either it has none, because a default would be in this
   * package's language rather than the page's.
   *
   * Signals, unlike the four above: the primitive reads these on every
   * `listProps()` rather than keeping a copy, and the name of a widget is as
   * often translated, or drawn from data, as it is a literal.
   */
  @Prop() label = new Signal.State<string | undefined>(undefined);
  @Prop() labelledBy = new Signal.State<string | undefined>(undefined);
  /** Called with the value a user selected, never with a default. */
  @Prop() onValueChange?: (value: string) => void;

  /** The element wrapping the list and the panels, which a page lays out. */
  root = new Signal.State<Element | null>(null);
  /** The tab list, which is the element the primitive is given. */
  list = new Signal.State<Element | null>(null);

  /**
   * The selection, which is the caller's own signal when they passed one.
   *
   * Held here rather than left inside the primitive because this is the side
   * that knows which values have a section — and bringing a selection back to
   * one of them is a write, which `select` would report as a choice a user
   * made.
   */
  readonly selection: Signal.State<string> =
    this.value ?? new Signal.State(this.defaultValue ?? '');

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
  readonly tabs: Tabs = createTabs(this.options());

  /** Where the selection was, so a tab that leaves hands it to its neighbour. */
  private at = 0;

  constructor() {
    provideContext(TabsContext, this);

    effect(() => this.recover());
    if (__VOLT_DEV__) effect(() => this.reportNameOnWrapper());
  }

  /** What the primitive is built with. */
  private options(): TabsOptions {
    const options: TabsOptions = {
      list: () => this.list.get(),
      // Always a signal of this component's, even where the caller passed
      // none: it is what `recover` writes, and what `defaultValue` starts.
      value: this.selection,
      orientation: this.orientation,
      activation: this.activation,
      loop: this.loop,
      ...(this.onValueChange ? { onValueChange: this.onValueChange } : {}),
    };

    // Defined rather than written above, because the primitive reads these two
    // on every `listProps()` and a getter is what makes that a live read — and
    // a getter written in the object literal would have the literal as its
    // `this` rather than the component.
    Object.defineProperties(options, {
      label: { get: () => this.label.get(), enumerable: true },
      labelledBy: { get: () => this.labelledBy.get(), enumerable: true },
    });
    return options;
  }

  /**
   * Bring a selection that names no tab back to one that is there.
   *
   * A widget with nothing selected shows no panel and puts every tab at
   * `tabindex="-1"` — so Tab steps over the whole thing and no key reaches it
   * again. Three ordinary edits land there: closing the tab that was open,
   * restoring a saved selection whose tab has since been renamed, and renaming
   * the open tab. The primitive heals only the empty value, which is the one
   * it can recognise without being told what the values are; this is the side
   * that knows which values have a section.
   */
  private recover(): void {
    const sections = this.sections.all.get();
    // Before the first tab registers there is nothing to select, and a list
    // that lost every tab keeps the value it had — so a tab arriving with that
    // value takes the selection back rather than finding it given away.
    if (sections.length === 0) return;

    const selected = this.selection.get();
    const at = sections.findIndex((section) => section.value.get() === selected);
    if (at >= 0) {
      this.at = at;
      return;
    }

    // The tab that took its place, which is where the eye already is — not the
    // first tab, which would throw a list back to its start every time a tab
    // near the end was closed.
    const from = Math.min(this.at, sections.length - 1);
    const next =
      sections.slice(from).find((section) => !section.disabled.get()) ??
      sections.slice(0, from).findLast((section) => !section.disabled.get()) ??
      // Every tab disabled: showing one is still better than showing none, and
      // for the primitive's own reason — the list's one tab stop is on the
      // selected tab, so a list with no selection cannot be reached at all.
      sections[from]!;

    // Written to the signal rather than selected through the primitive. This
    // is a default, not a choice: `onValueChange` reports what a user did, and
    // the tab list moving under an edit the page itself made is not that. A
    // page that passed its own signal reads the move there.
    this.selection.set(next.value.get());
  }

  /**
   * A name written on the tag names nothing, so say so.
   *
   * `:host` is on the element wrapping the list and the panels — it has to be,
   * because that is the element a page lays out — and that element carries no
   * role, where `aria-label` means nothing at all. The widget goes on working
   * and the `role="tablist"` inside it stays unnamed, which only a screen
   * reader hears. The attribute is left where the caller put it rather than
   * moved onto the list: a name that moved would be a name that stopped
   * following the expression it came from, which is a quieter bug than this
   * one. `label` is what names the list, so that is what this points at.
   */
  private reportNameOnWrapper(): void {
    const root = this.root.get();
    if (!root || typeof console === 'undefined') return;
    // Unless the caller gave the wrapper a role of its own, which is the one
    // way a name written there means something.
    if (root.hasAttribute('role')) return;

    const wrote = ['aria-label', 'aria-labelledby'].filter((name) => root.hasAttribute(name));
    if (wrote.length === 0) return;

    console.warn(
      `[volt] <v-tabs> was given ${wrote.join(' and ')}, which lands on the element wrapping ` +
        'the list and the panels — an element with no role, where a name means nothing. The ' +
        'tab list itself is still unnamed.\n' +
        '  Write label="…" or labelledBy="…" instead: those name the list.',
    );
  }
}
