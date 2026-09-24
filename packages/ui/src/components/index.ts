/**
 * How a component in this package is written.
 *
 * The rules below are not style. Each one is a bug that was found by writing
 * the first two components and running them.
 *
 * 1. **Every prop the template reads is a `Signal.State`.** A plain field is a
 *    value handed over once, so `:disabled="busy.get()"` would set the button
 *    up and then never speak to it again. A caller writes the value the same
 *    way either way — `disabled` or `:disabled="busy.get()"` — and the
 *    template reads `disabled.get()`. A prop the template never reads may stay
 *    plain: a callback like `onPress`, or an option a primitive takes once
 *    while the component's fields initialize, which is why `modal` and
 *    `defaultOpen` on the dialog are plain and say so.
 *
 * 2. **Exactly one element carries `:host`.** It is where everything the
 *    caller wrote on the tag but the component did not claim lands — their
 *    class, their id, their `aria-label`, their `data-*`. Without it a caller
 *    cannot reach the element they can see, and `<v-button class="wide">` goes
 *    nowhere. For a component that portals, `:host` belongs on the content the
 *    caller means, not on whatever is left behind.
 *
 * 3. **The primitive stays reachable.** It is a readonly field, so `:ref` on
 *    the tag and `instance.dialog` gets a caller everything the component did
 *    not think to offer. A component that hides its primitive is a component
 *    someone has to abandon the first time the design asks for more.
 *
 * 4. **The sheet draws it.** Every class a template writes is one the sheet
 *    declares — `test/component-classes.test.ts` holds the two together — and
 *    nothing here writes a colour or a duration of its own, because those are
 *    tokens and repointing one has to move every component at once.
 *
 * Four more, each of which was a defect in the first four components written
 * after the rules above were set down:
 *
 * 5. **`:host` goes on the element that carries the role**, not on a wrapper
 *    around it. A caller who writes `aria-label` on the tag is naming the
 *    control; landing it on a `<label>` or a layout `<div>` leaves the thing
 *    with `role="checkbox"` unnamed, and says nothing about it.
 * 6. **Add to what a caller wrote; never replace it.** Where a component puts
 *    a primitive's ARIA onto an element the caller supplied, an entry the
 *    primitive has no opinion about must be left alone — writing `undefined`
 *    over it removed the caller's own `aria-label` and `aria-describedby`,
 *    which is the opposite of what the component existed to do.
 * 7. **Test the wiring you add.** A prop forwarded to a primitive and
 *    asserted nowhere can be deleted with the suite green, and several were.
 *    Prove each one through the DOM or the primitive's own state — the test
 *    for a prop is the test that it does something.
 * 8. **Export it.** `@voltdev/ui/components` is the only way in;
 *    `test/barrel.test.ts` fails when a component is not.
 */

export { TagChildren } from './children.js';
export { VAccordion, AccordionContext } from './accordion.js';
export { VAccordionItem } from './accordion-item.js';
export { VAlert, type AlertSeverity } from './alert.js';
export { VAvatar, type AvatarShape, type AvatarSize } from './avatar.js';
export { VBadge, type BadgeCount, type BadgeTone } from './badge.js';
export { VBreadcrumb, BreadcrumbContext } from './breadcrumb.js';
export { VBreadcrumbItem } from './breadcrumb-item.js';
export { VButton } from './button.js';
export { VCheckbox } from './checkbox.js';
export { VChip, type ChipTone } from './chip.js';
export { VCollapsible } from './collapsible.js';
export { VDialog } from './dialog.js';
export { VInput } from './input.js';
export { VKbd } from './kbd.js';
export { VMenu, MenuContext } from './menu.js';
export { VMenuItem } from './menu-item.js';
export { VMenuSeparator } from './menu-separator.js';
export { VPagination } from './pagination.js';
export { VPopover } from './popover.js';
export { VProgress } from './progress.js';
export { VRadioGroup, RadioGroupContext } from './radio-group.js';
export { VRadio } from './radio.js';
export { VSelect, SelectContext } from './select.js';
export { VOption } from './option.js';
export { VSkeleton, type SkeletonShape } from './skeleton.js';
export { VSkeletonShape } from './skeleton-shape.js';
export { VSpinner } from './spinner.js';
export { VSwitch } from './switch.js';
export { VTable, TableContext, type TableRow } from './table.js';
export { VTableColumn } from './table-column.js';
export { VStepper, StepperContext } from './stepper.js';
export { VStep } from './step.js';
export { VTabs, TabsContext } from './tabs.js';
export { VTab } from './tab.js';
export { VTextarea } from './textarea.js';
export { VToaster, toaster, type ToastAction, type ToastMessage } from './toast.js';
export { VTooltip } from './tooltip.js';
