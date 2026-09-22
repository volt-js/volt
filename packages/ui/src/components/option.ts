import { Component, Prop, Signal, useContext } from '@voltdev/core';
import { SelectContext, type VSelect } from './select.js';

/** Replaced by the build; `true` where there is none, which is a test run. */
declare const __VOLT_DEV__: boolean;

/**
 * One option of a select.
 *
 * It draws the `<option>` inside the select's hidden native control, which is
 * what submits with the form and what names a value before the popup has been
 * opened. The row in the popup is drawn by the select, from `label` — or from
 * a template written inside the tag, for a row that is more than a line of
 * text:
 *
 * ```html
 * <v-option value="fr" label="France">
 *   <img src="/flags/fr.svg" alt=""> France
 * </v-option>
 * ```
 *
 * `label` is needed either way: an `<option>` holds text and nothing else, and
 * that text is what a screen reader reads and what typeahead searches.
 */
@Component({ selector: 'v-option', templateUrl: './option.html' })
export class VOption {
  /** Identifies the option. Everything else is keyed off it. */
  @Prop() value = new Signal.State('');
  /** The name of the value, in the button, the native control and the row. */
  @Prop() label = new Signal.State('');
  /** Skipped by navigation and by typeahead, still announced. */
  @Prop() disabled = new Signal.State(false);

  /** The `<option>` this draws, which is how the select learns its place. */
  element: Element | null = null;

  /**
   * The select this was written inside, read while the field initializes —
   * which is when an option is inside the select's render.
   */
  readonly select: VSelect = (() => {
    const select = useContext(SelectContext);
    if (!select) {
      throw new Error(
        '[volt] <v-option> has to be written inside <v-select>: it draws an `<option>` in ' +
          "that select's own control, and its row in the popup is drawn by the select.",
      );
    }
    return select;
  })();

  constructor() {
    this.select.options.add(this);
    if (__VOLT_DEV__) {
      const value = this.value.get();
      const twin = this.select.options
        .all.get()
        .find((option) => option !== this && option.value.get() === value);
      if (twin) {
        throw new Error(
          `[volt] Two <v-option> tags in one <v-select> carry the value "${value}".\n` +
            '  A value identifies an option — the control holds values, the form submits ' +
            'them, and both of these would be drawn as chosen at once.',
        );
      }
    }
  }
}
