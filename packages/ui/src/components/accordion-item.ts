import { Component, Prop, Signal, measureEffect, useContext } from '@voltdev/core';
import { AccordionContext, type VAccordion } from './accordion.js';

/** Replaced by the build; `true` where there is none, which is a test run. */
declare const __VOLT_DEV__: boolean;

/**
 * One section of an accordion: a heading, and the panel it opens.
 *
 * Two things at once, which is what makes the markup read the way it does.
 * The heading is what this draws — a real heading element around the button,
 * because the level is how a screen reader user skims the list and the button
 * is what gives Enter and Space for free — and what was written inside the tag
 * is the panel it opens.
 *
 * ```html
 * <v-accordion-item value="returns" label="Returns">
 *   <p>Thirty days, no questions asked.</p>
 * </v-accordion-item>
 * ```
 *
 * The heading's own words are `label`. For a heading that is more than a line
 * of text — a count beside it, a marker that turns as it opens — write the
 * `header` slot, which keeps the content of the tag meaning the panel, the
 * larger of the two things by far:
 *
 * ```html
 * <v-accordion-item value="returns">
 *   <template :slot-header>Returns <v-badge>2</v-badge></template>
 *   <p>Thirty days, no questions asked.</p>
 * </v-accordion-item>
 * ```
 *
 * What a caller writes on the tag lands on the section itself — the element
 * the sheet rules a border onto, and the one carrying `data-state`, so a page
 * styling an open section has it to select on. A name is the exception: the
 * section carries no role either, so `aria-label` written there names nothing
 * and is said out loud in development. `label` is what names a section.
 */
@Component({ selector: 'v-accordion-item', templateUrl: './accordion-item.html' })
export class VAccordionItem {
  /** Identifies the section. Which sections are open is a list of these. */
  @Prop() value = new Signal.State('');
  /** The heading's words, when they are a line of text; otherwise fill `header`. */
  @Prop() label = new Signal.State('');
  /**
   * Refuse the heading, and say so.
   *
   * `aria-disabled` rather than the `disabled` attribute, so the heading can
   * still be reached and read — the accordion's arrow keys reach it too,
   * because every heading is in the tab order and two orders that disagree
   * about which headings exist is the bug that buys.
   */
  @Prop() disabled = new Signal.State(false);

  /** The section this draws, which is how the accordion learns where it is. */
  element: Element | null = null;

  /**
   * The accordion this was written inside, read while the field initializes —
   * which is when an item is inside the accordion's own render.
   */
  readonly accordion: VAccordion = (() => {
    const accordion = useContext(AccordionContext);
    if (!accordion) {
      throw new Error(
        '[volt] <v-accordion-item> has to be written inside <v-accordion>: which sections ' +
          'are open, and the keyboard between their headings, belong to the accordion around ' +
          'them.',
      );
    }
    return accordion;
  })();

  constructor() {
    this.accordion.items.add(this);
    if (__VOLT_DEV__) {
      const value = this.value.get();
      const twin = this.accordion.items.all
        .get()
        .find((item) => item !== this && item.value.get() === value);
      if (twin) {
        throw new Error(
          `[volt] Two <v-accordion-item> tags in one <v-accordion> carry the value "${value}".\n` +
            '  A value identifies a section — it is what the open ones are a list of, and what ' +
            'the ids pairing a heading with its panel are minted from — so both would open at ' +
            'once, under one id.',
        );
      }
      // The measure lane, because this reads the DOM — and because it is the
      // first moment the element this drew exists to be read.
      measureEffect(() => this.reportNameOnSection());
    }
  }

  /**
   * A name written on the tag names nothing, so say so.
   *
   * `:host` is on the section, which carries no role — the roles are on the
   * heading inside it and on the panel it opens — where `aria-label` is
   * thrown away by every screen reader. The heading goes on being named by
   * its own words and the panel by the heading, so nothing looks wrong: only
   * a screen reader user hears that the name was dropped.
   *
   * Left where the caller put it rather than moved onto the heading. The
   * heading's name is the words a user can see, and a name that disagreed
   * with them would be the louder bug of the two.
   */
  private reportNameOnSection(): void {
    const section = this.element;
    if (!section || typeof console === 'undefined') return;
    // Unless the caller gave the section a role of its own, which is the one
    // way a name written there means something.
    if (section.hasAttribute('role')) return;

    const wrote = ['aria-label', 'aria-labelledby'].filter((name) => section.hasAttribute(name));
    if (wrote.length === 0) return;

    console.warn(
      `[volt] <v-accordion-item> was given ${wrote.join(' and ')}, which lands on the section ` +
        'itself — an element with no role, where a name means nothing.\n' +
        '  Write label="…", or fill the `header` slot: the heading is what names a section, ' +
        'and the panel takes its name from the heading.',
    );
  }
}
