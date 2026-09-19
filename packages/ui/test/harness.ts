/**
 * A document with the styled layer in it, for the checks that have to be
 * measured rather than read.
 *
 * Two things about this environment decide the shape of every DOM test here.
 *
 * happy-dom's CSS parser drops `@layer` blocks and everything inside them.
 * Nothing errors: the rules simply are not there, and a test that expected
 * them to lose to a consumer's rule passes for the wrong reason. So the sheet
 * installed here is built from the same component data as the shipped one but
 * without the layer around it, and `styledDocument` refuses to hand back a
 * document whose stylesheet did not take — the canary below — so a suite can
 * never go green against an empty cascade.
 *
 * The other thing is that it does support `forced-colors: active`, as a
 * device setting, and resolves `var()` through as many hops as the token
 * table has. Those two are what make the accessibility and theming claims
 * checkable at all.
 *
 * Three things it does not do are made up for here, each in the copy of the
 * sheet rather than in any assertion, so that what is measured is still the
 * cascade deciding between the package's own rules:
 *
 * - It never matches `:hover`. The copy spells it `[data-hover]`, which is
 *   exactly as specific, so a fixture can carry the pointer as an attribute.
 * - It does not parse system colours: `color: CanvasText` is dropped as
 *   though it were a typo, and the rule beneath it shows through. The copy
 *   spells each one as a stand-in colour happy-dom keeps.
 * - It does not force anything. A document with the forced palette on still
 *   computes the sheet's own blues and greys, where a browser would have
 *   replaced them. `snapshot` marks every such colour as replaced, and
 *   `differences` does not count a colour the palette would have chosen.
 */

import { Window } from 'happy-dom';
import {
  componentStyles,
  keyframesToCss,
  reducedMotionTokens,
  rulesToCss,
  tokensCss,
  wrap,
  FORCED_COLORS_QUERY,
  type Rule,
} from '../src/index.ts';

/**
 * The forced palette, as CSS spells it. Only these mean anything inside a
 * `forced-colors` block: any other colour is replaced by the user agent with
 * whichever of these it thinks fits, which is exactly the guess the block
 * exists to take away.
 */
export const SYSTEM_COLORS: readonly string[] = [
  'AccentColor',
  'AccentColorText',
  'ActiveText',
  'ButtonBorder',
  'ButtonFace',
  'ButtonText',
  'Canvas',
  'CanvasText',
  'Field',
  'FieldText',
  'GrayText',
  'Highlight',
  'HighlightText',
  'LinkText',
  'Mark',
  'MarkText',
  'SelectedItem',
  'SelectedItemText',
  'VisitedText',
];

/** One colour per system colour, none of them a colour the tokens use. */
const STAND_INS = new Map(SYSTEM_COLORS.map((name, index) => [name, `rgb(1, 2, ${index + 3})`]));
const STAND_IN_VALUES = new Set(STAND_INS.values());

/** What a system colour the sheet names computes to in these documents. */
export function standIn(name: string): string {
  const value = STAND_INS.get(name);
  if (value === undefined) throw new Error(`${name} is not a system colour`);
  return value;
}

/** What `snapshot` reports for a colour the forced palette would replace. */
export const REPLACED = '(replaced by the forced palette)';

/**
 * Properties whose value is a colour, and which a forced palette replaces.
 *
 * `background-color` alone keeps its alpha, so a transparent background stays
 * transparent; a transparent border or outline is forced like any other colour,
 * which is why a transparent outline is the usual way to draw a focus ring
 * that only forced colours can see.
 */
const FORCED_PROPERTIES = new Set([
  'color',
  'background-color',
  'border-block-start-color',
  'border-block-end-color',
  'border-inline-start-color',
  'border-inline-end-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
]);

function testRules(rules: readonly Rule[]): Rule[] {
  return rules.map((rule) => ({
    selector: rule.selector.replaceAll(':hover', '[data-hover]'),
    declarations: Object.fromEntries(
      Object.entries(rule.declarations).map(([property, value]) => [
        property,
        STAND_INS.get(value) ?? value,
      ]),
    ),
  }));
}

export interface Fixture {
  readonly tag?: string;
  /** Class names, normally from a component's own `classes` map. */
  readonly classes?: readonly string[];
  readonly attributes?: Readonly<Record<string, string>>;
  /** Focus it once mounted, which is how `:focus-visible` is reached here. */
  readonly focus?: boolean;
  readonly children?: readonly Fixture[];
}

export interface StyledDocument {
  readonly window: Window;
  /** Mount a fixture tree into the body and return its root element. */
  mount(fixture: Fixture): Element;
  /** Every property the fixture tree computes to, keyed by `path:property`. */
  snapshot(root: Element, properties: readonly string[]): Map<string, string>;
  /** Add a stylesheet of the consumer's own, after ours. */
  addConsumerCss(css: string): void;
  close(): Promise<void>;
}

/** The same rules the package ships, minus the layers happy-dom cannot read. */
export function unlayeredCss(): string {
  const blocks = [
    tokensCss(),
    // Emitted by `stylesheet.ts` beside the tokens, and included here for the
    // same reason the forced-colours block is: it is the whole of how the
    // preference is honoured, so a document without it cannot show that it is.
    wrap(
      '@media (prefers-reduced-motion: reduce)',
      rulesToCss([{ selector: ':root', declarations: reducedMotionTokens }], '  '),
    ),
  ];

  for (const component of componentStyles) {
    if (component.keyframes.length > 0) blocks.push(keyframesToCss(component.keyframes));
    blocks.push(rulesToCss(testRules(component.rules)));
    if (component.forcedColors.length > 0) {
      blocks.push(wrap(FORCED_COLORS_QUERY, rulesToCss(testRules(component.forcedColors), '  ')));
    }
  }

  return blocks.join('\n\n');
}

export function styledDocument(
  options: { forcedColors?: boolean; reducedMotion?: boolean } = {},
): StyledDocument {
  const window = new Window({
    url: 'http://localhost/',
    settings: {
      device: {
        forcedColors: options.forcedColors ? 'active' : 'none',
        prefersReducedMotion: options.reducedMotion ? 'reduce' : 'no-preference',
      },
    },
  });
  const document = window.document;

  const style = document.createElement('style');
  style.textContent = unlayeredCss();
  document.head.append(style);

  const mount = (fixture: Fixture): Element => {
    const element = build(document, fixture);
    document.body.append(element);
    focusAll(element, fixture);
    return element;
  };

  const canary = mount({ tag: 'button', classes: ['volt-button'] });
  const computed = window.getComputedStyle(canary);
  if (computed.getPropertyValue('padding-inline-start') !== '1rem') {
    throw new Error(
      'the stylesheet did not apply: happy-dom parsed no .volt-button rule, so every ' +
        'assertion measured against this document would be meaningless',
    );
  }
  canary.remove();

  return {
    window,

    mount,

    snapshot(root, properties) {
      const values = new Map<string, string>();
      for (const [path, element] of walk(root)) {
        const style = window.getComputedStyle(element);
        for (const property of properties) {
          const value = style.getPropertyValue(property);
          values.set(
            `${path}:${property}`,
            options.forcedColors ? underForcedPalette(property, value) : value,
          );
        }
      }
      return values;
    },

    addConsumerCss(css) {
      const sheet = document.createElement('style');
      sheet.textContent = css;
      document.head.append(sheet);
    },

    close: () => window.happyDOM.close(),
  };
}

/**
 * Every `path:property` the two trees disagree on, with both values.
 *
 * A colour the forced palette replaces on either side is not a disagreement:
 * the browser chooses it, not the sheet, and nothing promises that it will
 * choose differently for the two.
 */
export function differences(
  before: Map<string, string>,
  after: Map<string, string>,
): Map<string, { before: string; after: string }> {
  const changed = new Map<string, { before: string; after: string }>();
  for (const [key, value] of before) {
    const other = after.get(key) ?? '';
    if (value === REPLACED || other === REPLACED) continue;
    if (other !== value) changed.set(key, { before: value, after: other });
  }
  return changed;
}

/**
 * The value as a browser with the forced palette on would use it: a system
 * colour the sheet chose is kept, and every other colour — including one left
 * unset, which the browser fills from the palette too — is replaced.
 */
function underForcedPalette(property: string, value: string): string {
  if (!FORCED_PROPERTIES.has(property) || STAND_IN_VALUES.has(value)) return value;
  // Unset, a background is transparent, and a background keeps its alpha.
  if (property === 'background-color' && (value === '' || value === 'transparent')) {
    return 'transparent';
  }
  return REPLACED;
}

function build(document: Document, fixture: Fixture): Element {
  const element = document.createElement(fixture.tag ?? 'div');
  if (fixture.classes?.length) element.className = fixture.classes.join(' ');
  for (const [name, value] of Object.entries(fixture.attributes ?? {})) {
    element.setAttribute(name, value);
  }
  for (const child of fixture.children ?? []) element.append(build(document, child));
  return element;
}

/** After mounting, because focus on a detached element goes nowhere. */
function focusAll(element: Element, fixture: Fixture): void {
  if (fixture.focus) (element as HTMLElement).focus();
  const children = fixture.children ?? [];
  for (const [index, child] of children.entries()) {
    const node = element.children[index];
    if (node) focusAll(node, child);
  }
}

/** Depth-first, with a path that is the same for two fixtures of one shape. */
function* walk(element: Element, path = '0'): Generator<[string, Element]> {
  yield [path, element];
  for (const [index, child] of [...element.children].entries()) {
    yield* walk(child, `${path}.${index}`);
  }
}
