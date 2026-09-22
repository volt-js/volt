import { Component, Prop, Signal, useContext } from '@voltdev/core';
import { TabsContext, type VTabs } from './tabs.js';

/**
 * One section of a tabs widget: a tab, and the panel it shows.
 *
 * Two things at once, which is what makes the markup read the way it does. It
 * draws the tab itself, inside the list, so whatever a caller writes on the
 * tag lands on the tab they can see; and what is written inside the tag is the
 * panel, which the tabs draw below the list when this section is the selected
 * one. Nothing is rendered twice: a section is one component whether its panel
 * is showing or not.
 *
 * ```html
 * <v-tab value="billing" label="Billing">
 *   <p>What you owe.</p>
 * </v-tab>
 * ```
 *
 * The tab's own words are `label`. For a tab that is more than a line of text,
 * write the `tab` slot — which keeps the content of the tag meaning the panel,
 * the larger of the two things by far:
 *
 * ```html
 * <v-tab value="billing">
 *   <template :slot-tab><v-icon name="card"></v-icon> Billing</template>
 *   <p>What you owe.</p>
 * </v-tab>
 * ```
 */
@Component({ selector: 'v-tab', templateUrl: './tab.html' })
export class VTab {
  /** Identifies the section. The selection, and the pair of ids, key off it. */
  @Prop() value = new Signal.State('');
  /** The tab's words, when they are a line of text; otherwise fill the `tab` slot. */
  @Prop() label = new Signal.State('');
  /**
   * Refuse the selection, and say so.
   *
   * `aria-disabled` rather than the `disabled` attribute, which means nothing
   * on the `<div>` or `<a>` a tab is as often drawn as. The arrows step over
   * it and neither a click nor a key can select it, while it stays announced
   * among the others.
   */
  @Prop() disabled = new Signal.State(false);

  /** The tab this draws, which is how the tabs learn where the section is. */
  element: HTMLElement | null = null;

  /**
   * The tabs this was written inside, read while the field initializes —
   * which is when a tab is inside the tabs' own render.
   */
  readonly tabs: VTabs = (() => {
    const tabs = useContext(TabsContext);
    if (!tabs) {
      throw new Error(
        '[volt] <v-tab> has to be written inside <v-tabs>: its tab belongs in that list, ' +
          'and the panel written inside it is drawn by the tabs it belongs to.',
      );
    }
    return tabs;
  })();

  constructor() {
    this.tabs.sections.add(this);
  }
}
