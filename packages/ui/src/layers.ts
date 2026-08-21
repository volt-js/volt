/**
 * The cascade layers every rule in this package is emitted into.
 *
 * Layers are the whole of the override story. Author CSS that is not in any
 * layer beats author CSS that is, whatever the specificity on either side —
 * so a consumer's `.checkout-button { border-radius: 0 }` wins over
 * `.volt-button[data-variant='primary']` without `!important`, and without
 * having to guess how specific this package's selectors are. That only holds
 * while *nothing* here escapes a layer, which is why the sheet is assembled
 * from data and checked rather than written by hand.
 *
 * `volt.overrides` is declared and never written to. It is the seam for CSS
 * that has to beat the components but still lose to a consumer's own rules —
 * a design-system package built on top of this one, or a theme file that
 * wants to stay overridable by the application importing it.
 */

/** Resets and the token table. */
export const LAYER_BASE = 'volt.base';
/** Everything a component draws. */
export const LAYER_COMPONENTS = 'volt.components';
/** Left empty for whoever ships on top of this package. */
export const LAYER_OVERRIDES = 'volt.overrides';

/** Weakest first, which is the order the statement has to declare them in. */
export const layerOrder: readonly string[] = [LAYER_BASE, LAYER_COMPONENTS, LAYER_OVERRIDES];

/**
 * The `@layer` statement, which has to come before any of the blocks it names.
 *
 * Without it the order would be decided by which layer happens to be written
 * to first — so a sheet that only ever emitted `volt.components` would put a
 * later `volt.base` above it, and the tokens would start beating the rules
 * that use them.
 */
export function layerOrderStatement(): string {
  return `@layer ${layerOrder.join(', ')};`;
}
