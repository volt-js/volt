import { Component, useContext } from '@voltdev/core';
import { MenuContext, said, type VMenu } from './menu.js';

/**
 * A line between groups of items.
 *
 * ```html
 * <v-menu-separator></v-menu-separator>
 * ```
 *
 * A tag of its own, rather than a prop on an item or markup the caller
 * writes, for one reason: the rule is the sheet's but the attributes are the
 * primitive's, and a separator lies *across* the menu — so which way it runs
 * is the menu's orientation turned ninety degrees, which only the menu knows.
 * Markup written in the slot has no handle on the primitive to ask, and a
 * `separator` prop on `<v-menu-item>` would be two different things wearing
 * one tag: an item is pressable, focusable and collected, and a separator is
 * none of the three.
 *
 * Being none of the three is also why it is not skipped by name anywhere. It
 * carries no item marker, so the collection never sees it, and the arrows
 * step from the item above to the item below without being told to. It stays
 * in the accessibility tree, where a reader announces the grouping it draws.
 */
@Component({ selector: 'v-menu-separator', templateUrl: './menu-separator.html' })
export class VMenuSeparator {
  /**
   * The menu this was written inside, read while the field initializes —
   * which is when a separator is inside the menu's own render.
   */
  readonly menu: VMenu = (() => {
    const menu = useContext(MenuContext);
    if (!menu) {
      throw new Error(
        '[volt] <v-menu-separator> has to be written inside <v-menu>: the direction it lies ' +
          'in is the menu’s own, turned across it.',
      );
    }
    return menu;
  })();

  /**
   * The line's attributes: the primitive's bag, less what it carries as
   * `undefined`.
   *
   * Across a vertical menu a separator lies the way ARIA already assumes, so
   * the bag says nothing about its orientation — and this is spread over the
   * element `:host` writes to, where saying nothing as `undefined` would take
   * the caller's own `aria-orientation` off instead of leaving it alone.
   */
  separatorProps(): Record<string, unknown> {
    return said(this.menu.menu.separatorProps());
  }
}
