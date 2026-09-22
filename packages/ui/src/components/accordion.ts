import { Component, Prop, Signal, createContext, effect, provideContext } from '@voltdev/core';
import {
  createAccordion,
  type Accordion,
  type AccordionOptions,
  type AccordionType,
  type Orientation,
} from '@voltdev/primitives';
import { TagChildren } from './children.js';
import type { VAccordionItem } from './accordion-item.js';

/** Replaced by the build; `true` where there is none, which is a test run. */
declare const __VOLT_DEV__: boolean;

/**
 * How an item finds the accordion it was written inside.
 *
 * The content of a tag is built while the tag it sits in renders, so an item's
 * scope descends from this one. An item written anywhere else finds nothing
 * and says so.
 */
export const AccordionContext = createContext<VAccordion | null>(null);

/**
 * A stack of sections, each behind the heading that opens it.
 *
 * ```html
 * <v-accordion :value="open" type="multiple">
 *   <v-accordion-item value="shipping" label="Shipping">
 *     <p>Everything leaves within a day.</p>
 *   </v-accordion-item>
 *   <v-accordion-item value="returns" label="Returns">
 *     <p>Thirty days, no questions asked.</p>
 *   </v-accordion-item>
 * </v-accordion>
 * ```
 *
 * One tag is one section, holding both halves of it: the heading, which
 * `<v-accordion-item>` draws, and the panel, which is what was written inside
 * the tag. This side owns everything the sections share — which of them are
 * open, whether more than one may be, and the arrow keys between the headings,
 * which are answered here rather than on every heading because a key pressed
 * inside a panel belongs to whatever is in the panel.
 *
 * A closed panel is not in the page at all, which is the difference from
 * `<v-tabs>` and worth knowing: the content of a section is built when it
 * opens and thrown away when it closes, so state that has to outlive a close
 * belongs in a signal of yours rather than in the DOM the panel made. A panel
 * that is closing stays until its animation has finished, which is what makes
 * the collapse animatable at all.
 *
 * The element this draws carries no role — the pattern's roles are on the
 * headings and the panels — so it is there to be laid out and to carry what
 * a caller writes on the tag. A name is the one thing it cannot carry: on an
 * element with no role `aria-label` names nothing at all, so one written
 * there is said out loud in development rather than lost.
 */
@Component({ selector: 'v-accordion', templateUrl: './accordion.html' })
export class VAccordion {
  /** Your own signal, when the open sections belong to your component. */
  @Prop() value?: Signal.State<string[]>;
  /**
   * The six below are what the primitive is *built* with, read once while
   * this field list initializes — plain, because a signal would promise a
   * caller they can change them later while the accordion went on answering
   * with what it was built with.
   */
  /** Open from the start, when the open sections are the accordion's own. */
  @Prop() defaultValue?: string[];
  /** One section open at a time, or several. */
  @Prop() type: AccordionType = 'single';
  /**
   * Let a single accordion close its last open section. Off by default, which
   * is the usual "one section is always open" accordion; turn it on when the
   * panels are long enough that a reader wants the list back.
   */
  @Prop() collapsible = false;
  /** Which arrows move between headings. */
  @Prop() orientation: Orientation = 'vertical';
  /** Wrap past the first and last heading. */
  @Prop() loop = true;
  /**
   * Give each panel `role="region"`, as the pattern recommends. Turn it off
   * past roughly six sections, where the landmarks crowd out every other one
   * on the page — which is APG's own advice.
   */
  @Prop() region = true;
  /** Called with the open sections a user opened or closed, never with a default. */
  @Prop() onValueChange?: (value: string[]) => void;

  /**
   * Refuse every heading at once, for a list that is off while something is
   * saving. A section may also refuse on its own; this is the two of them
   * together, and an item that says nothing follows this.
   */
  @Prop() disabled = new Signal.State(false);
  /**
   * The heading level of every section, which has to fit the page around it:
   * an accordion under an `<h2>` holds `<h3>`s, and one under an `<h3>` holds
   * `<h4>`s. Read live, like any other prop, and written as `aria-level` over
   * the element's own level — so `level="2"`, which an attribute hands over as
   * a string, means what it says.
   */
  @Prop() level = new Signal.State<number | string>(3);

  /**
   * The element the headings live in, which is where their order is read from
   * and which key presses reach this through.
   */
  root = new Signal.State<Element | null>(null);

  /**
   * The `<v-accordion-item>` children, in the order their sections are drawn.
   *
   * Registering is what this is for: the primitive asks about a section by
   * value — whether it refuses — and only the tag carrying that value knows.
   * The order comes with it, and it is the DOM's rather than the order the
   * tags were built in, so a section a `:for` grew later is in the list where
   * it is drawn rather than at the end.
   */
  readonly items = new TagChildren<VAccordionItem>(
    () => this.root.get(),
    (item) => item.element,
  );

  /**
   * The primitive, built from the props above — which is why props have to be
   * there while a field initializes.
   */
  readonly accordion: Accordion = createAccordion(this.options());

  constructor() {
    provideContext(AccordionContext, this);
    if (__VOLT_DEV__) effect(() => this.reportNameOnRoot());
  }

  /** The section carrying a value, which is how a value becomes a tag again. */
  itemFor(value: string): VAccordionItem | undefined {
    return this.items.all.get().find((item) => item.value.get() === value);
  }

  /**
   * A name written on the tag names nothing, so say so.
   *
   * `:host` is on the element wrapping the sections, and that element carries
   * no role — the pattern's roles are on the headings and the panels — where
   * `aria-label` is thrown away by every screen reader. The accordion goes on
   * working and only a screen reader user hears what was lost, which is
   * exactly the kind of failure that has to be said out loud somewhere.
   *
   * The attribute is left where the caller put it rather than moved onto
   * something with a role: an accordion is not one control, so there is no
   * one thing a group name could be moved to, and a name that moved would be
   * a name that stopped following the expression it came from.
   */
  private reportNameOnRoot(): void {
    const root = this.root.get();
    if (!root || typeof console === 'undefined') return;
    // Unless the caller gave the element a role of its own, which is the one
    // way a name written there means something.
    if (root.hasAttribute('role')) return;

    const wrote = ['aria-label', 'aria-labelledby'].filter((name) => root.hasAttribute(name));
    if (wrote.length === 0) return;

    console.warn(
      `[volt] <v-accordion> was given ${wrote.join(' and ')}, which lands on the element ` +
        'wrapping the sections — an element with no role, where a name means nothing.\n' +
        '  An accordion is not one control: each heading names the section it opens. A name ' +
        'for the group belongs on the landmark or the heading the accordion sits under.',
    );
  }

  /** What the primitive is built with. */
  private options(): AccordionOptions {
    return {
      container: () => this.root.get(),
      type: this.type,
      collapsible: this.collapsible,
      orientation: this.orientation,
      loop: this.loop,
      region: this.region,
      // A live read of both signals rather than a value handed over once: a
      // list that refuses while a form saves, and a section that refuses on
      // its own, are the two ways this is written and both change under the
      // widget.
      disabled: (value) => this.disabled.get() || (this.itemFor(value)?.disabled.get() ?? false),
      ...(this.value ? { value: this.value } : {}),
      ...(this.defaultValue !== undefined ? { defaultValue: this.defaultValue } : {}),
      ...(this.onValueChange ? { onValueChange: this.onValueChange } : {}),
    };
  }
}
