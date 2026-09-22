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
 * 4. **The sheet draws it.** Class names come from `classes`, never literals,
 *    and nothing here writes a colour or a duration — those are tokens, so
 *    that repointing one moves every component at once.
 */

export { TagChildren } from './children.js';
export { VButton } from './button.js';
export { VDialog } from './dialog.js';
export { VSelect, SelectContext } from './select.js';
export { VOption } from './option.js';
export { VTable, TableContext, type TableRow } from './table.js';
export { VTableColumn } from './table-column.js';
