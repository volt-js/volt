/**
 * Tags that are one character away from a real element.
 *
 * `<dvi>` is valid markup. A browser creates it, gives it no semantics, styles
 * it as an inline box, puts the children inside it and says nothing — so the
 * only evidence is a layout that came out wrong somewhere further down. The
 * compiler already holds both the tag as written and the table of the ones
 * that exist, which is enough to say so at build time instead.
 *
 * Only a near miss is reported, following the mistyped-directive check in the
 * parser. An invented tag is deliberate often enough — a placeholder, a
 * convention borrowed from somewhere else, an element from a vocabulary this
 * compiler does not carry — and it is visible the first time the page is
 * opened, whereas a one-character typo is exactly what survives review. So the
 * rule answers "did you mean" and stays quiet whenever it has no answer.
 *
 * A component tag never reaches the check: `isComponentTag` claims PascalCase
 * and anything hyphenated, so components and custom elements are already
 * excluded by the time the tree is walked. MathML is skipped whole, because
 * Volt does not render it — codegen switches namespace for SVG and nothing
 * else — so every tag inside `<math>` is unknown here and a near miss found
 * against the HTML and SVG tables would be about a different element than the
 * one the author wrote.
 *
 * A warning rather than a refusal, unlike the mistyped directive. A directive
 * the compiler does not know is silently dropped from the output; a tag it
 * does not know is emitted exactly as written and renders, so what the rule
 * has is a strong suspicion about correct-enough markup rather than a
 * certainty about broken markup.
 */

import type { RootNode, TemplateChildNode } from './ast.js';
// Type only, so this module and the accessibility pass stay independent.
import type { Diagnostic } from './a11y.js';
import { HTML_TAGS, SVG_TAGS, isKnownElement, isOneEditFrom } from './dom-info.js';

export interface ElementCheckOptions {
  filename?: string;
}

/**
 * What a near miss is measured against, lowercased once.
 *
 * SVG's camelCase names are in here as they are written, so `<clippath>` finds
 * no suggestion and goes unreported — the miss is real, but naming `clipPath`
 * as the fix would need a case-sensitive answer this comparison cannot give.
 */
const KNOWN_TAGS = [...HTML_TAGS, ...SVG_TAGS];

export function checkUnknownElements(
  root: RootNode,
  options: ElementCheckOptions = {},
): Diagnostic[] {
  const found: Diagnostic[] = [];
  walk(root.children, found, options.filename);
  return found;
}

function walk(
  nodes: TemplateChildNode[],
  found: Diagnostic[],
  filename: string | undefined,
): void {
  for (const node of nodes) {
    if (node.type === 'slot-outlet') {
      walk(node.children, found, filename);
      continue;
    }
    if (node.type !== 'element') continue;

    const tag = node.tag.toLowerCase();
    if (tag === 'math') continue;

    // A tag of one or two characters is one edit from half the short ones —
    // `<d>` from `<a>`, `<mi>` from `<i>` — so a near miss among them is a
    // coincidence rather than evidence, and the element named would be one the
    // author never had in mind. Nothing is lost: a mistyped `<td>` is another
    // real tag far more often than not.
    if (tag.length >= 3 && !node.isComponent && !isKnownElement(node.tag)) {
      const meant = KNOWN_TAGS.find((known) => isOneEditFrom(tag, known.toLowerCase()));
      if (meant) {
        found.push({
          message:
            `\`<${node.tag}>\` is not an element — did you mean \`<${meant}>\`?\n` +
            '  A tag no DOM knows is still created, as an unknown element with no role,\n' +
            '  no behaviour and no styling of its own, so nothing about the page that\n' +
            '  comes out names the tag as the reason.\n' +
            `  Write \`<${meant}>\`, or give it a hyphen if the tag really is a custom\n` +
            '  element of your own.',
          loc: { line: node.loc.line, column: node.loc.column },
          filename,
        });
      }
    }

    walk(node.children, found, filename);
  }
}
