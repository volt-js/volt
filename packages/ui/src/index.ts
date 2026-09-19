/**
 * @voltdev/ui
 *
 * Styled components built on @voltdev/primitives.
 *
 * This layer is meant to be replaceable: it must never be the only way to
 * reach a behaviour, or theming becomes something to fight rather than use.
 * Distribution is by CLI into the consuming repository, so these are source
 * files someone owns and edits, not a dependency to override.
 *
 * Until that CLI exists, the way in is the sheet and the class names: call
 * `stylesheet()` from a build script and write what it returns to a `.css`
 * file — the package ships none — then put `classes.dialog.content` and the
 * rest on the markup you spread the primitives' props onto. The reference
 * page, `docs/reference/ui.md`, has the markup each component expects.
 *
 * What holds the two halves together is the token contract. Every colour a
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
  menuStyles,
  popoverStyles,
  tabsStyles,
  toastStyles,
  tooltipStyles,
  componentStyles,
  classes,
} from './components/index.js';

export { contractProperties } from './contract.js';
export { FORCED_COLORS_QUERY, componentCss, stylesheet } from './stylesheet.js';
