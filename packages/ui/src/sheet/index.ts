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
import { avatarClasses, avatarStyles } from './avatar.js';
import { badgeClasses, badgeStyles } from './badge.js';
import { breadcrumbClasses, breadcrumbStyles } from './breadcrumb.js';
import { buttonClasses, buttonStyles } from './button.js';
import { checkboxClasses, checkboxStyles } from './checkbox.js';
import { chipClasses, chipStyles } from './chip.js';
import { codeClasses, codeStyles } from './code.js';
import { collapsibleClasses, collapsibleStyles } from './collapsible.js';
import { dialogClasses, dialogStyles } from './dialog.js';
import { editorClasses, editorStyles } from './editor.js';
import { fieldClasses, fieldStyles } from './field.js';
import { fileUploadClasses, fileUploadStyles } from './file-upload.js';
import { imageClasses, imageStyles } from './image.js';
import { kbdClasses, kbdStyles } from './kbd.js';
import { menuClasses, menuStyles } from './menu.js';
import { numberInputClasses, numberInputStyles } from './number-input.js';
import { paginationClasses, paginationStyles } from './pagination.js';
import { passwordInputClasses, passwordInputStyles } from './password-input.js';
import { pinInputClasses, pinInputStyles } from './pin-input.js';
import { popoverClasses, popoverStyles } from './popover.js';
import { progressClasses, progressStyles } from './progress.js';
import { radioGroupClasses, radioGroupStyles } from './radio-group.js';
import { ratingClasses, ratingStyles } from './rating.js';
import { relativeTimeClasses, relativeTimeStyles } from './relative-time.js';
import { selectClasses, selectStyles } from './select.js';
import { separatorClasses, separatorStyles } from './separator.js';
import { skeletonClasses, skeletonStyles } from './skeleton.js';
import { sliderClasses, sliderStyles } from './slider.js';
import { spinnerClasses, spinnerStyles } from './spinner.js';
import { stepperClasses, stepperStyles } from './stepper.js';
import { switchClasses, switchStyles } from './switch.js';
import { tableClasses, tableStyles } from './table.js';
import { tabsClasses, tabsStyles } from './tabs.js';
import { tagsInputClasses, tagsInputStyles } from './tags-input.js';
import { toastClasses, toastStyles } from './toast.js';
import { toggleGroupClasses, toggleGroupStyles } from './toggle-group.js';
import { tooltipClasses, tooltipStyles } from './tooltip.js';

export {
  accordionStyles,
  alertStyles,
  avatarStyles,
  badgeStyles,
  breadcrumbStyles,
  buttonStyles,
  checkboxStyles,
  chipStyles,
  codeStyles,
  collapsibleStyles,
  dialogStyles,
  editorStyles,
  fieldStyles,
  fileUploadStyles,
  imageStyles,
  kbdStyles,
  menuStyles,
  numberInputStyles,
  paginationStyles,
  passwordInputStyles,
  pinInputStyles,
  popoverStyles,
  progressStyles,
  radioGroupStyles,
  ratingStyles,
  relativeTimeStyles,
  selectStyles,
  separatorStyles,
  skeletonStyles,
  sliderStyles,
  spinnerStyles,
  stepperStyles,
  switchStyles,
  tableStyles,
  tabsStyles,
  tagsInputStyles,
  toastStyles,
  toggleGroupStyles,
  tooltipStyles,
};

/** In the order they are emitted, which is alphabetical and means nothing. */
export const componentStyles: readonly ComponentStyles[] = [
  accordionStyles,
  alertStyles,
  avatarStyles,
  badgeStyles,
  breadcrumbStyles,
  buttonStyles,
  checkboxStyles,
  chipStyles,
  codeStyles,
  collapsibleStyles,
  dialogStyles,
  editorStyles,
  fieldStyles,
  fileUploadStyles,
  imageStyles,
  kbdStyles,
  menuStyles,
  numberInputStyles,
  paginationStyles,
  passwordInputStyles,
  pinInputStyles,
  popoverStyles,
  progressStyles,
  radioGroupStyles,
  ratingStyles,
  relativeTimeStyles,
  selectStyles,
  separatorStyles,
  skeletonStyles,
  sliderStyles,
  spinnerStyles,
  stepperStyles,
  switchStyles,
  tableStyles,
  tabsStyles,
  tagsInputStyles,
  toastStyles,
  toggleGroupStyles,
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
  avatar: avatarClasses,
  badge: badgeClasses,
  breadcrumb: breadcrumbClasses,
  button: buttonClasses,
  checkbox: checkboxClasses,
  chip: chipClasses,
  code: codeClasses,
  collapsible: collapsibleClasses,
  dialog: dialogClasses,
  editor: editorClasses,
  field: fieldClasses,
  'file-upload': fileUploadClasses,
  image: imageClasses,
  kbd: kbdClasses,
  menu: menuClasses,
  'number-input': numberInputClasses,
  pagination: paginationClasses,
  'password-input': passwordInputClasses,
  'pin-input': pinInputClasses,
  popover: popoverClasses,
  progress: progressClasses,
  'radio-group': radioGroupClasses,
  rating: ratingClasses,
  'relative-time': relativeTimeClasses,
  select: selectClasses,
  separator: separatorClasses,
  skeleton: skeletonClasses,
  slider: sliderClasses,
  spinner: spinnerClasses,
  stepper: stepperClasses,
  switch: switchClasses,
  table: tableClasses,
  tabs: tabsClasses,
  'tags-input': tagsInputClasses,
  toast: toastClasses,
  'toggle-group': toggleGroupClasses,
  tooltip: tooltipClasses,
} as const;
