/**
 * @voltdev/primitives
 *
 * Component behaviour and accessibility, with no styling of any kind.
 *
 * Around fifty components are assembled from a handful of shared behaviours —
 * presence, dismissal, focus scope, roving focus, collection, anchoring, form
 * field, virtualization. Those live here, and the components are largely
 * composition on top of them. Everything is built to the WAI-ARIA Authoring
 * Practices, including the full keyboard interaction map rather than roles
 * alone, because that is the part which cannot be retrofitted.
 */

export { createPresence, type Presence, type PresenceState } from './presence.js';
export {
  createDismiss,
  dismissStackSize,
  type DismissOptions,
  type DismissReason,
} from './dismiss.js';
export {
  createFocusScope,
  focusableWithin,
  type FocusScopeOptions,
} from './focus-scope.js';
export { createId, resetIds } from './id.js';
export {
  createCollection,
  ITEM_ATTRIBUTE,
  type Collection,
  type CollectionOptions,
} from './collection.js';
export {
  createRovingFocus,
  type Orientation,
  type RovingFocus,
  type RovingFocusOptions,
} from './roving-focus.js';
export {
  createDialog,
  type Dialog,
  type DialogOptions,
  type DialogProps,
} from './dialog.js';

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export * from './popover.js';
export * from './tooltip.js';
export * from './menu.js';
export * from './tabs.js';
export * from './disclosure.js';
export * from './toggle.js';
export * from './form-controls.js';
export * from './toast.js';
export * from './display.js';
export * from './async.js';

// ---------------------------------------------------------------------------
// Foundations
// ---------------------------------------------------------------------------

export * from './virtualizer.js';
export * from './anchoring.js';
export * from './announcer.js';
export * from './clipboard.js';
export * from './island.js';
export * from './calendar.js';
export * from './date-picker.js';
export * from './chat.js';
export * from './form-field.js';
export * from './drag-drop.js';
export * from './i18n.js';
export * from './layout.js';
export * from './navigation.js';
export * from './feedback.js';
export * from './display-extras.js';

export * from './listbox.js';
export * from './tree.js';

// combobox, inputs and slider-upload are written and tested but are not
// exported yet. Each was put through repeated rounds of fixing and adversarial
// review, and each still has a defect an independent reviewer could reproduce:
// they share invariants that a fix for one part keeps breaking in another.
// Exported when a review passes clean, not when the tests do.

