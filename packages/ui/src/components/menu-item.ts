import { Component, Prop, Signal, useContext } from '@voltdev/core';
import type { MenuItemRole } from '@voltdev/primitives';
import { MenuContext, said, type VMenu } from './menu.js';

/**
 * One action in a menu.
 *
 * ```html
 * <v-menu-item value="rename" :onSelect="rename">Rename</v-menu-item>
 * ```
 *
 * It draws its own `<button>` where it is written, inside the portalled
 * sheet, so whatever a caller writes on the tag lands on the thing they can
 * press. Its words are the content of the tag; there is no `label` prop,
 * because nothing else ever draws this item.
 *
 * A checkbox or radio item carries a state as well as an action, and has to
 * say so — `role="menuitemcheckbox"` with no `checked` is announced as an
 * ordinary item, so an omitted state is read as unchecked rather than absent.
 * The tick itself is markup of yours: the sheet draws the row, not a mark in
 * it.
 *
 * ```html
 * <v-menu-item role="menuitemcheckbox" :checked="wrap.get()" :onSelect="toggleWrap">
 *   { wrap.get() ? '✓' : '' } Wrap lines
 * </v-menu-item>
 * ```
 *
 * A disabled item keeps its place in the accessibility tree —
 * `aria-disabled`, never the `disabled` attribute, which is this package's
 * rule for every disabled control. Navigation steps over it, a press on it is
 * swallowed, and it is still announced as being there and unavailable.
 */
@Component({ selector: 'v-menu-item', templateUrl: './menu-item.html' })
export class VMenuItem {
  /**
   * What the menu's `onSelect` is handed when this item is chosen.
   *
   * Carried on the element as `data-value`, which is what lets items be drawn
   * from a loop: the primitive reads the choice back off the item rather than
   * holding the options object it was built from.
   */
  @Prop() value = new Signal.State<string | undefined>(undefined);
  /** `menuitem` acts; the other two carry a state and must show `checked`. */
  @Prop() role = new Signal.State<MenuItemRole>('menuitem');
  /** For the checkbox and radio roles. `mixed` is a part-checked checkbox. */
  @Prop() checked = new Signal.State<boolean | 'mixed' | undefined>(undefined);
  /** Skipped by the arrows and by typeahead, refuses a press, still announced. */
  @Prop() disabled = new Signal.State(false);
  /**
   * What typeahead matches on, when the visible words are not what anyone
   * would type — a row leading with an icon's alt text, or a shortcut.
   */
  @Prop() textValue = new Signal.State<string | undefined>(undefined);
  /**
   * Overrides the menu's `closeOnSelect` for this item alone, for the one
   * that toggles something the user is likely to toggle twice.
   */
  @Prop() closeOnSelect = new Signal.State<boolean | undefined>(undefined);
  /** Called when this item is chosen, by press or by key. */
  @Prop() onSelect?: () => void;

  /** The button this draws, which is how the menu knows a choice was this tag. */
  element: HTMLElement | null = null;

  /**
   * The menu this was written inside, read while the field initializes —
   * which is when an item is inside the menu's own render.
   */
  readonly menu: VMenu = (() => {
    const menu = useContext(MenuContext);
    if (!menu) {
      throw new Error(
        '[volt] <v-menu-item> has to be written inside <v-menu>: it belongs to that menu’s ' +
          'roving focus and typeahead, and the menu is what hears it chosen.',
      );
    }
    return menu;
  })();

  constructor() {
    this.menu.items.add(this);
  }

  /**
   * The item's attributes, every one of them read on each render.
   *
   * A method rather than the call written into the template only because six
   * options do not fit on a line. It is still the primitive's bag: the roles,
   * the two spellings of disabled the collection and a reader each need, and
   * the marker that makes this element an item of the menu at all.
   *
   * Less what the bag carries as `undefined`, which for a plain enabled item
   * is most of it — and this bag is spread over the element `:host` writes
   * to, so passing those through would take the caller's own `aria-checked`,
   * `aria-disabled` or `data-label` off the button they wrote them on.
   */
  itemProps(): Record<string, unknown> {
    return said(this.menu.menu.itemProps({
      value: this.value.get(),
      role: this.role.get(),
      checked: this.checked.get(),
      disabled: this.disabled.get(),
      textValue: this.textValue.get(),
      closeOnSelect: this.closeOnSelect.get(),
    }));
  }
}
