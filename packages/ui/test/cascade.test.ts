/**
 * That a consumer's own stylesheet wins, and does not need `!important`.
 *
 * The mechanism is the cascade layer: within one origin, CSS that is in no
 * layer beats CSS that is in any layer, whatever the specificity on either
 * side. So the claim reduces to a property of this sheet — that nothing in it
 * escapes a layer — and that is what the structural checks below walk it for.
 *
 * The other half is executed rather than reasoned about, in the other
 * direction: happy-dom does not implement cascade layers (it drops `@layer`
 * blocks whole), so what a document here can show is the world without them.
 * `.volt-button[data-variant='primary']` beats a consumer's single-class rule
 * on specificity, and beats it whichever order the sheets are in. That is the
 * fight the layer exists to end, and the reason `!important` is otherwise the
 * only way out of it.
 */

import { transform } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  componentStyles,
  layerOrder,
  layerOrderStatement,
  primitiveTokens,
  stylesheet,
} from '../src/index.ts';
import { styledDocument } from './harness.ts';

/**
 * The sheet split into its top-level pieces, by counting braces.
 *
 * A parser would be better, and there is no CSS parser in this workspace that
 * understands cascade layers — esbuild's does, but only as far as printing
 * them back out. Counting braces is enough for the one question being asked:
 * is there anything out here at all.
 */
function topLevel(css: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];

    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        pieces.push(css.slice(start, index + 1).trim());
        start = index + 1;
      }
    } else if (character === ';' && depth === 0) {
      pieces.push(css.slice(start, index + 1).trim());
      start = index + 1;
    }
  }

  expect(depth, 'unbalanced braces in the emitted sheet').toBe(0);
  expect(css.slice(start).trim(), 'trailing text outside every block').toBe('');
  return pieces.filter(Boolean);
}

describe('the emitted sheet', () => {
  it('declares the layer order before anything else', () => {
    const css = stylesheet();
    expect(css.startsWith(layerOrderStatement())).toBe(true);
    expect(layerOrderStatement()).toBe('@layer volt.base, volt.components, volt.overrides;');
    // Weakest first: a consumer's own layer statement is free to name these
    // alongside their own, but the relative order of the three is ours.
    expect(layerOrder).toEqual(['volt.base', 'volt.components', 'volt.overrides']);
  });

  it('puts every rule inside a declared layer', () => {
    const pieces = topLevel(stylesheet());

    expect(pieces[0]).toBe(layerOrderStatement());

    for (const piece of pieces.slice(1)) {
      const layer = /^@layer ([\w.]+) \{/.exec(piece);
      expect(layer, `outside every layer: ${piece.slice(0, 60)}`).not.toBeNull();
      expect(layerOrder).toContain((layer as RegExpExecArray)[1]);
    }

    // Both of the layers that hold anything are used, so the check above is
    // not passing because there is nothing to check.
    const used = pieces.slice(1).map((piece) => /^@layer ([\w.]+)/.exec(piece)?.[1]);
    expect(used).toEqual(['volt.base', 'volt.components']);
  });

  it('holds every rule of every registered component', () => {
    const css = stylesheet();
    for (const component of componentStyles) {
      for (const rule of [...component.rules, ...component.forcedColors]) {
        expect(css, `${component.name}: ${rule.selector}`).toContain(rule.selector);
      }
    }
  });

  it('never needs !important to win against itself', () => {
    expect(stylesheet()).not.toContain('!important');
  });

  it('parses', async () => {
    const result = await transform(stylesheet(), { loader: 'css' });
    expect(result.warnings).toEqual([]);
    expect(result.code.length).toBeGreaterThan(0);
  });
});

describe('without the layer', () => {
  it('a consumer rule loses to a component rule on specificity', async () => {
    const dom = styledDocument();
    const element = dom.mount({
      tag: 'button',
      classes: ['volt-button', 'checkout-button'],
      attributes: { 'data-variant': 'primary' },
    });

    // Last in the document, so source order is on the consumer's side and
    // specificity is the only thing deciding.
    dom.addConsumerCss('.checkout-button { background-color: rgb(1, 2, 3); }');
    expect(dom.window.getComputedStyle(element).getPropertyValue('background-color')).toBe(
      primitiveTokens['--volt-palette-accent-500'],
    );

    dom.addConsumerCss('.checkout-button { background-color: rgb(4, 5, 6) !important; }');
    expect(dom.window.getComputedStyle(element).getPropertyValue('background-color')).toBe(
      'rgb(4, 5, 6)',
    );

    await dom.close();
  });
});
