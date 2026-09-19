/**
 * Every component the styled layer ships, and the classes their markup uses.
 *
 * The list is the registry the sheet is built from and the one the checks in
 * `test/` walk, so a component that is added without forced-colors rules, or
 * with a class no rule selects on, fails the build rather than shipping.
 */

import type { ComponentStyles } from '../css.js';
import { accordionClasses, accordionStyles } from './accordion.js';
import { buttonClasses, buttonStyles } from './button.js';
import { checkboxClasses, checkboxStyles } from './checkbox.js';
import { dialogClasses, dialogStyles } from './dialog.js';
import { menuClasses, menuStyles } from './menu.js';
import { popoverClasses, popoverStyles } from './popover.js';
import { tabsClasses, tabsStyles } from './tabs.js';
import { tooltipClasses, tooltipStyles } from './tooltip.js';
import { toastClasses, toastStyles } from './toast.js';

export {
  accordionStyles,
  buttonStyles,
  checkboxStyles,
  dialogStyles,
  menuStyles,
  popoverStyles,
  tabsStyles,
  toastStyles,
  tooltipStyles,
};

/** In the order they are emitted, which is alphabetical and means nothing. */
export const componentStyles: readonly ComponentStyles[] = [
  accordionStyles,
  buttonStyles,
  checkboxStyles,
  dialogStyles,
  menuStyles,
  popoverStyles,
  tabsStyles,
  toastStyles,
  tooltipStyles,
];

/**
 * Part name to class name, per component.
 *
 * The one thing a consumer needs at runtime: `classes.dialog.content` is what
 * goes in the `class` attribute. These are the same objects the rules are
 * built from, so a class cannot be renamed in one place only — and they are
 * written out by name rather than gathered from `componentStyles`, so that the
 * type knows which components and parts there are, and so that a bundle which
 * wants the names does not have to take every rule along with them.
 */
export const classes = {
  accordion: accordionClasses,
  button: buttonClasses,
  checkbox: checkboxClasses,
  dialog: dialogClasses,
  menu: menuClasses,
  popover: popoverClasses,
  tabs: tabsClasses,
  toast: toastClasses,
  tooltip: tooltipClasses,
} as const;
