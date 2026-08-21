/**
 * Every component the styled layer ships, and the classes their markup uses.
 *
 * The list is the registry the sheet is built from and the one the checks in
 * `test/` walk, so a component that is added without forced-colors rules, or
 * with a class no rule selects on, fails the build rather than shipping.
 */

import type { ComponentStyles } from '../css.js';
import { accordionStyles } from './accordion.js';
import { buttonStyles } from './button.js';
import { checkboxStyles } from './checkbox.js';
import { dialogStyles } from './dialog.js';
import { menuStyles } from './menu.js';
import { popoverStyles } from './popover.js';
import { tabsStyles } from './tabs.js';
import { tooltipStyles } from './tooltip.js';
import { toastStyles } from './toast.js';

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
 * goes in the `class` attribute. Written out of the same objects the rules
 * are built from, so a class cannot be renamed in one place only.
 */
export const classes: Readonly<Record<string, Readonly<Record<string, string>>>> =
  Object.fromEntries(componentStyles.map((component) => [component.name, component.classes]));
