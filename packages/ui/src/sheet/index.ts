/**
 * Every component the styled layer ships, and the classes their markup uses.
 *
 * The list is the registry the sheet is built from and the one the checks in
 * `test/` walk, so a component that is added without forced-colors rules, or
 * with a class no rule selects on, fails the build rather than shipping.
 */

import type { ComponentStyles } from '../css.js';
import { accordionClasses, accordionStyles } from './accordion.js';
import { alertClasses, alertStyles } from './alert.js';
import { breadcrumbClasses, breadcrumbStyles } from './breadcrumb.js';
import { buttonClasses, buttonStyles } from './button.js';
import { checkboxClasses, checkboxStyles } from './checkbox.js';
import { collapsibleClasses, collapsibleStyles } from './collapsible.js';
import { dialogClasses, dialogStyles } from './dialog.js';
import { fieldClasses, fieldStyles } from './field.js';
import { menuClasses, menuStyles } from './menu.js';
import { paginationClasses, paginationStyles } from './pagination.js';
import { popoverClasses, popoverStyles } from './popover.js';
import { progressClasses, progressStyles } from './progress.js';
import { radioGroupClasses, radioGroupStyles } from './radio-group.js';
import { selectClasses, selectStyles } from './select.js';
import { skeletonClasses, skeletonStyles } from './skeleton.js';
import { spinnerClasses, spinnerStyles } from './spinner.js';
import { stepperClasses, stepperStyles } from './stepper.js';
import { switchClasses, switchStyles } from './switch.js';
import { tableClasses, tableStyles } from './table.js';
import { tabsClasses, tabsStyles } from './tabs.js';
import { toastClasses, toastStyles } from './toast.js';
import { tooltipClasses, tooltipStyles } from './tooltip.js';

export {
  accordionStyles,
  alertStyles,
  breadcrumbStyles,
  buttonStyles,
  checkboxStyles,
  collapsibleStyles,
  dialogStyles,
  fieldStyles,
  menuStyles,
  paginationStyles,
  popoverStyles,
  progressStyles,
  radioGroupStyles,
  selectStyles,
  skeletonStyles,
  spinnerStyles,
  stepperStyles,
  switchStyles,
  tableStyles,
  tabsStyles,
  toastStyles,
  tooltipStyles,
};

/** In the order they are emitted, which is alphabetical and means nothing. */
export const componentStyles: readonly ComponentStyles[] = [
  accordionStyles,
  alertStyles,
  breadcrumbStyles,
  buttonStyles,
  checkboxStyles,
  collapsibleStyles,
  dialogStyles,
  fieldStyles,
  menuStyles,
  paginationStyles,
  popoverStyles,
  progressStyles,
  radioGroupStyles,
  selectStyles,
  skeletonStyles,
  spinnerStyles,
  stepperStyles,
  switchStyles,
  tableStyles,
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
  alert: alertClasses,
  breadcrumb: breadcrumbClasses,
  button: buttonClasses,
  checkbox: checkboxClasses,
  collapsible: collapsibleClasses,
  dialog: dialogClasses,
  field: fieldClasses,
  menu: menuClasses,
  pagination: paginationClasses,
  popover: popoverClasses,
  progress: progressClasses,
  'radio-group': radioGroupClasses,
  select: selectClasses,
  skeleton: skeletonClasses,
  spinner: spinnerClasses,
  stepper: stepperClasses,
  switch: switchClasses,
  table: tableClasses,
  tabs: tabsClasses,
  toast: toastClasses,
  tooltip: tooltipClasses,
} as const;
