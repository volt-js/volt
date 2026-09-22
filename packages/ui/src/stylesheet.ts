/**
 * The sheet itself: tokens, then components, all of it inside a layer.
 *
 * One string rather than one file per component, because the cascade order
 * between components has to be decided here and not by whichever import a
 * bundler happened to see first. `componentCss` exists for the generator,
 * which will emit a consumer's copy one component at a time and needs the
 * same bytes for one of them.
 */

import { keyframesToCss, rulesToCss, wrap, type ComponentStyles } from './css.js';
import { LAYER_BASE, LAYER_COMPONENTS, layerOrderStatement } from './layers.js';
import { componentStyles } from './sheet/index.js';
import { reducedMotionTokens, tokensCss } from './tokens.js';

/** `@media (forced-colors: active)`, spelled once. */
export const FORCED_COLORS_QUERY = '@media (forced-colors: active)';

/**
 * The token table and what a reduced-motion preference changes about it.
 *
 * Both go in `volt.base`, the weakest layer, so a consumer redefining a token
 * in their own stylesheet wins without having to out-specify `:root` — which
 * is the whole of the theming story.
 */
function baseCss(): string {
  const reduced = wrap(
    '@media (prefers-reduced-motion: reduce)',
    rulesToCss([{ selector: ':root', declarations: reducedMotionTokens }], '    '),
    '  ',
  );

  return wrap(`@layer ${LAYER_BASE}`, `${tokensCss('  ')}\n\n${reduced}`);
}

/**
 * One component's CSS, without the layer around it.
 *
 * Keyframes first: a rule naming an animation reads better once the animation
 * exists, and the browser does not care either way.
 */
export function componentCss(component: ComponentStyles, indent = ''): string {
  const blocks: string[] = [];

  if (component.keyframes.length > 0) blocks.push(keyframesToCss(component.keyframes, indent));
  blocks.push(rulesToCss(component.rules, indent));

  if (component.forcedColors.length > 0) {
    blocks.push(wrap(FORCED_COLORS_QUERY, rulesToCss(component.forcedColors, `${indent}  `), indent));
  }

  return blocks.join('\n\n');
}

/**
 * Everything, in cascade order, ready to write to a `.css` file or drop in a
 * `<style>` element.
 */
export function stylesheet(components: readonly ComponentStyles[] = componentStyles): string {
  const body = components
    .map((component) => `  /* ${component.name} */\n${componentCss(component, '  ')}`)
    .join('\n\n');

  return [
    layerOrderStatement(),
    '',
    baseCss(),
    '',
    wrap(`@layer ${LAYER_COMPONENTS}`, body),
    '',
  ].join('\n');
}
