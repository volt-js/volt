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
 * Until that CLI exists, the way in is the sheet and the class names: import
 * `stylesheet()` and write it to a `.css` file (the package's build does
 * exactly that, to `dist/styles.css`), then put `classes.dialog.content` and
 * the rest on the markup you spread the primitives' props onto. README.md has
 * a worked example per component.
 *
 * What holds the two halves together is the token contract. Every colour a
 * component draws is a `var(--volt-color-*)`, every duration a
 * `var(--volt-duration-*)`; nothing is a literal. Repoint a token and every
 * component that uses it follows, which is what makes "styling must not trap
 * the behaviour" a property that can be checked rather than a promise.
 */

export const VERSION = '0.1.0';

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
  buttonStyles,
  checkboxStyles,
  dialogStyles,
  popoverStyles,
  tabsStyles,
  toastStyles,
  componentStyles,
  classes,
} from './components/index.js';

export { FORCED_COLORS_QUERY, componentCss, stylesheet } from './stylesheet.js';
