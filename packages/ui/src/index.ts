/**
 * @voltdev/ui
 *
 * Components, built on @voltdev/primitives and drawn with the sheet.
 *
 * `<v-button variant="primary">Save</v-button>` is the whole of what a caller
 * writes. Under it is the same primitive anyone can call directly: the
 * component is an assembly of parts already in the package, not a wall around
 * them. Nothing here is the only way to reach a behaviour — that is the rule
 * the layer is built to keep, because a component that hides its primitive is
 * one you fight the day the design asks for something it did not anticipate.
 *
 * Three ways in, in the order most callers want them:
 *
 * - The components. `import { VButton } from '@voltdev/ui/components'`, name
 *   it in your `imports`, write the tag. Every attribute the component does not claim —
 *   a class, an id, an `aria-label` — lands on the element it draws, so the
 *   tag behaves like the element it stands for.
 * - The primitives. `createDialog` and the rest, for markup a component's
 *   shape does not fit. A component's own primitive is reachable: `:ref` on
 *   the tag, then `instance.dialog`.
 * - The sheet. `stylesheet()` returns the CSS; the package ships no `.css`,
 *   so a build script writes what it returns and a caller can write less of
 *   it, or none.
 *
 * The components are a subpath, and that is the honest reason: the two halves
 * of this package run in different places. This one — the sheet — is built
 * JavaScript, because a build script calls `stylesheet()` in Node, where a
 * plugin that compiles templates is not running. `@voltdev/ui/components`
 * ships as source — `"volt": { "source": true }` in the package.json — because
 * a compiled template is compiled for one target and one build, so only the
 * build that renders the page can compile it. Your Vite build does, with the
 * rest of your app, which is also why a component costs a caller no more than
 * the markup they would have written by hand.
 *
 * What holds the layers together is the token contract. Every colour a
 * component draws is a `var(--volt-color-*)`, every duration a
 * `var(--volt-duration-*)`; nothing is a literal. Repoint a token and every
 * component that uses it follows, which is what makes "styling must not trap
 * the behaviour" a property that can be checked rather than a promise.
 */

export const VERSION = '0.1.0-alpha.1';

export {
  type Declarations,
  type Rule,
  type KeyframeStep,
  type Keyframes,
  type ComponentStyles,
  rulesToCss,
  keyframesToCss,
  wrap,
} from './css.js';

export {
  type TokenTable,
  primitiveTokens,
  semanticTokens,
  reducedMotionTokens,
  tokenNames,
  tokensCss,
} from './tokens.js';

export {
  LAYER_BASE,
  LAYER_COMPONENTS,
  LAYER_OVERRIDES,
  layerOrder,
  layerOrderStatement,
} from './layers.js';

export {
  accordionStyles,
  buttonStyles,
  checkboxStyles,
  dialogStyles,
  fieldStyles,
  menuStyles,
  popoverStyles,
  selectStyles,
  tableStyles,
  tabsStyles,
  toastStyles,
  tooltipStyles,
  componentStyles,
  classes,
} from './sheet/index.js';

export { contractProperties } from './contract.js';
export { FORCED_COLORS_QUERY, componentCss, stylesheet } from './stylesheet.js';
