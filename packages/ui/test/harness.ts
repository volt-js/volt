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
 *
 * A fourth is made up for in the reading rather than in the copy: happy-dom
 * computes `inherit` as the keyword itself, and hands the keyword down. What
 * `snapshot` and the checks below read is the value an ancestor computes, as
 * a browser would have it.
 *
 * Two more things Chrome does under the palette are modelled for the documents
 * that have it on. The first is why a primary button shipped with its label
 * painted over while every test here passed; the second is the fix for it.
 *
 * - Chrome paints a backplate of `Canvas` behind every line of text laid out
 *   by a box left under the palette, whatever fill is behind it, so that words
 *   stay legible over a picture. Words in a colour Chrome's palette makes the
 *   same as `Canvas` — `HighlightText` is, in both schemes — are a box in the
 *   page's colour, and a line of words hidden with `visibility` is a box over
 *   whatever is beneath it. `unreadableWords` finds both.
 * - `forced-color-adjust: none` takes an element, and everything inside it
 *   that does not put the property back, out from under the palette: every
 *   colour drawn as the sheet wrote it, and no backplate behind the lines it
 *   lays out, so its words sit on its fill. `snapshot` stops replacing colours
 *   there, `unreadableWords` reads the words against the fill, and
 *   `unforcedColours` finds any colour painted there that is not the
 *   palette's own.
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
  type ComponentStyles,
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
/** Back from a stand-in to the system colour it stands in for. */
const SYSTEM_NAMES = new Map([...STAND_INS].map(([name, value]) => [value, name]));

type Rgba = readonly [red: number, green: number, blue: number, alpha: number];
type Scheme = 'light' | 'dark';

/**
 * What Chrome draws each system colour as under its two forced palettes: the
 * computed colour of words written in each, and of a fill in each, read in
 * Chrome 154 with `forced-colors: active` emulated and the light scheme
 * preferred, then the dark. `AccentColor` and `AccentColorText` are not kept
 * there — Chrome draws words in either as `CanvasText` — so that is what is
 * listed for them. `Highlight` is translucent in both.
 */
const CHROME_PALETTES: Readonly<Record<Scheme, Readonly<Record<string, Rgba>>>> = {
  light: {
    AccentColor: [0, 0, 0, 1],
    AccentColorText: [0, 0, 0, 1],
    ActiveText: [0, 0, 159, 1],
    ButtonBorder: [0, 0, 0, 1],
    ButtonFace: [255, 255, 255, 1],
    ButtonText: [0, 0, 0, 1],
    Canvas: [255, 255, 255, 1],
    CanvasText: [0, 0, 0, 1],
    Field: [255, 255, 255, 1],
    FieldText: [0, 0, 0, 1],
    GrayText: [96, 0, 0, 1],
    Highlight: [5, 0, 73, 0.8],
    HighlightText: [255, 255, 255, 1],
    LinkText: [0, 0, 159, 1],
    Mark: [255, 255, 0, 1],
    MarkText: [0, 0, 0, 1],
    SelectedItem: [25, 103, 210, 1],
    SelectedItemText: [255, 255, 255, 1],
    VisitedText: [0, 0, 159, 1],
  },
  dark: {
    AccentColor: [255, 255, 255, 1],
    AccentColorText: [255, 255, 255, 1],
    ActiveText: [255, 255, 0, 1],
    ButtonBorder: [255, 255, 255, 1],
    ButtonFace: [0, 0, 0, 1],
    ButtonText: [255, 255, 255, 1],
    Canvas: [0, 0, 0, 1],
    CanvasText: [255, 255, 255, 1],
    Field: [0, 0, 0, 1],
    FieldText: [255, 255, 255, 1],
    GrayText: [63, 242, 63, 1],
    Highlight: [0, 230, 255, 0.8],
    HighlightText: [0, 0, 0, 1],
    LinkText: [255, 255, 0, 1],
    Mark: [255, 255, 0, 1],
    MarkText: [0, 0, 0, 1],
    SelectedItem: [25, 103, 210, 1],
    SelectedItemText: [255, 255, 255, 1],
    VisitedText: [255, 255, 0, 1],
  },
};

/**
 * The least contrast words can be read at against what is behind them: WCAG's
 * floor for anything that has to be seen at all. It sits well clear of both
 * sides of Chrome's palettes on the backplate — every colour drawn for
 * `Canvas` clears it, the closest being `SelectedItem` at 3.9 in the dark, and
 * every one that is not falls far below it, the closest being yellow `Mark` on
 * white at 1.07.
 */
const LEGIBLE = 3;

/** WCAG's relative luminance. */
function luminance([red, green, blue]: readonly number[]): number {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red!) + 0.7152 * linear(green!) + 0.0722 * linear(blue!);
}

/** A colour of the palette as it is seen laid over another, since `Highlight` lets it through. */
function over(name: string, ground: readonly number[], scheme: Scheme): number[] {
  const colour = CHROME_PALETTES[scheme][name];
  if (colour === undefined) throw new Error(`${name} is not a system colour`);
  const [red, green, blue, alpha] = colour;
  return [red, green, blue].map((channel, index) => channel * alpha + ground[index]! * (1 - alpha));
}

/**
 * How far words in one system colour stand from a fill in another, in one of
 * Chrome's palettes, as a contrast ratio. The fill is laid over the page's
 * `Canvas` first, and the words over the fill.
 */
export function contrastIn(scheme: Scheme, words: string, fill = 'Canvas'): number {
  const ground = over(fill, over('Canvas', [0, 0, 0], scheme), scheme);
  const seen = over(words, ground, scheme);
  const [lighter, darker] = [luminance(seen), luminance(ground)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/**
 * The schemes in which words in one system colour cannot be read on a fill in
 * another — on the backplate, unless a fill is named.
 */
export function unreadableOn(words: string, fill = 'Canvas'): Scheme[] {
  return (['light', 'dark'] as const).filter((scheme) => contrastIn(scheme, words, fill) < LEGIBLE);
}

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

/** The selector as the copy of the sheet spells it. */
function tested(selector: string): string {
  return selector.replaceAll(':hover', '[data-hover]');
}

function testRules(rules: readonly Rule[]): Rule[] {
  return rules.map((rule) => ({
    selector: tested(rule.selector),
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
  /**
   * Words of its own, where the component puts some: a forced palette treats
   * a run of text differently from everything else it paints, so a fixture
   * without its words cannot show what the palette does to them. An
   * `<input>` holds its words as its value.
   */
  readonly text?: string;
}

export interface StyledDocument {
  readonly window: Window;
  /** Mount a fixture tree into the body and return its root element. */
  mount(fixture: Fixture): Element;
  /** Every property the fixture tree computes to, keyed by `path:property`. */
  snapshot(root: Element, properties: readonly string[]): Map<string, string>;
  /** Add a stylesheet of the consumer's own, after ours. */
  addConsumerCss(css: string): void;
  /**
   * Every run of words in the fixture tree that cannot be read under the
   * forced palette — hidden by Chrome's backplate, or, out from under the
   * palette, too faint against the fill behind them — and every run hidden
   * with `visibility` whose line Chrome still paints a backplate for, as a
   * sentence naming the sheet, the rule and the fix. Only in a document with
   * the forced palette on, which is the only kind with a backplate.
   */
  unreadableWords(root: Element): string[];
  /**
   * Every colour that is not a system colour painted by an element in the
   * fixture tree that is out from under the palette, as a sentence naming the
   * rule that took it out. Only in a document with the forced palette on.
   */
  unforcedColours(root: Element): string[];
  close(): Promise<void>;
}

/** The same rules the package ships, minus the layers happy-dom cannot read. */
export function unlayeredCss(sheets: readonly ComponentStyles[] = componentStyles): string {
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

  for (const component of sheets) {
    if (component.keyframes.length > 0) blocks.push(keyframesToCss(component.keyframes));
    blocks.push(rulesToCss(testRules(component.rules)));
    if (component.forcedColors.length > 0) {
      blocks.push(wrap(FORCED_COLORS_QUERY, rulesToCss(testRules(component.forcedColors), '  ')));
    }
  }

  return blocks.join('\n\n');
}

export function styledDocument(
  options: {
    forcedColors?: boolean;
    reducedMotion?: boolean;
    /** Sheets written the way the package's are, installed after its own. */
    extraSheets?: readonly ComponentStyles[];
  } = {},
): StyledDocument {
  const sheets = [...componentStyles, ...(options.extraSheets ?? [])];
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
  style.textContent = unlayeredCss(sheets);
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

  const rules: SheetRule[] = sheets.flatMap((sheet) =>
    [...sheet.rules, ...sheet.forcedColors].map((rule) => ({
      sheet: sheet.name,
      selector: rule.selector,
      tested: tested(rule.selector),
      declarations: rule.declarations,
    })),
  );

  const computedOf: ComputedOf = (element) => inheritedThrough(window, element);

  /** Where a fault came from: the sheet and the rule, or the element if no rule says. */
  const source = (element: Element, property: string, value: string): string => {
    const found = ruleThatSets(rules, element, property, value);
    return found ? `${found.sheet}: \`${found.selector}\`` : describe(element);
  };

  const forcedOnly = (check: string): void => {
    if (!options.forcedColors) {
      throw new Error(`${check} asks what the forced palette does, and this document has it off`);
    }
  };

  /**
   * Hidden words still make the line they are laid out on, and that line's
   * backplate is a box of `Canvas` over whatever shares the room with it —
   * unless the box laying the line out is out from under the palette, or is
   * hidden as well.
   */
  const coveringLine = (element: Element, words: string): string | undefined => {
    const owner = lineOwner(element, computedOf);
    if (!backplated(element, computedOf) || unseen(owner, computedOf)) return undefined;
    const value = computedOf(element).getPropertyValue('visibility');
    return (
      `${source(element, 'visibility', value)} hides “${clip(words)}” in ` +
      `${describe(element)} with \`visibility\`, and Chrome still paints a backplate ` +
      `of Canvas behind the line ${describe(owner)} lays them out on: a box over ` +
      'whatever is drawn beneath it. Add `forced-color-adjust: none` to the rule ' +
      `that draws ${describe(owner)}, or to one round it.`
    );
  };

  /** Words Chrome draws, in a colour that cannot be read against what is behind them. */
  const lostWords = (element: Element, words: string): string | undefined => {
    // Under the palette, a colour of the sheet's own is the palette's to
    // replace, and it replaces it with one drawn for `Canvas`, which is what
    // the backplate is. Out from under it, the colour is drawn as written,
    // and `unforcedColours` is what finds it.
    const name = SYSTEM_NAMES.get(computedOf(element).getPropertyValue('color'));
    if (name === undefined) return undefined;
    const behind = fillBehind(element, computedOf);
    const fill = SYSTEM_NAMES.get(behind.fill);
    // Words in the very colour of the fill they sit on were hidden by the
    // sheet, as an unchecked box's mark is, before any backplate.
    if (name === fill) return undefined;
    // With no backplate behind their line, the words sit on the fill behind
    // them — the page's `Canvas` where there is none, or where the palette
    // repaints the one there is.
    const plated = backplated(element, computedOf);
    let ground = 'Canvas';
    if (!plated && fill !== undefined) ground = fill;
    else if (!plated && behind.owner && outOfPalette(behind.owner, computedOf)) return undefined;
    const lost = unreadableOn(name, ground);
    if (lost.length === 0) return undefined;
    const ratio = Math.max(...lost.map((scheme) => contrastIn(scheme, name, ground)));
    const schemes = lost.join(' and ');
    const measured = `${name} on ${ground} is ${ratio.toFixed(2)}:1 in its ${schemes} palette`;
    const said = `${source(element, 'color', name)} writes “${clip(words)}” in ${describe(element)}`;
    return plated
      ? `${said} in ${name}, and Chrome paints a backplate of Canvas behind every line of ` +
          `text laid out under the forced palette: ${measured}, so the words are gone. Add ` +
          '`forced-color-adjust: none` to the rule and name every colour inside it from the ' +
          'palette, or write the words in a colour drawn for Canvas.'
      : `${said} in ${name}, out from under the forced palette, where Chrome paints no ` +
          `backplate and the words sit on ${ground}: ${measured}, too faint to read. Write ` +
          'them in the colour the palette pairs with that fill, as `HighlightText` is with ' +
          '`Highlight`.';
  };

  return {
    window,

    mount,

    snapshot(root, properties) {
      const values = new Map<string, string>();
      for (const [path, element] of walk(root)) {
        const computed = computedOf(element);
        // Out from under the palette, Chrome draws the sheet's own colours.
        const forced = options.forcedColors && !outOfPalette(element, computedOf);
        for (const property of properties) {
          const value = computed.getPropertyValue(property);
          values.set(`${path}:${property}`, forced ? underForcedPalette(property, value) : value);
        }
      }
      return values;
    },

    addConsumerCss(css) {
      const sheet = document.createElement('style');
      sheet.textContent = css;
      document.head.append(sheet);
    },

    unreadableWords(root) {
      forcedOnly('unreadableWords');
      const faults: string[] = [];
      for (const [, element] of walk(root)) {
        const words = wordsOf(element);
        if (words === '' || !rendered(element, computedOf)) continue;
        const fault = unseen(element, computedOf)
          ? coveringLine(element, words)
          : lostWords(element, words);
        if (fault !== undefined) faults.push(fault);
      }
      return [...new Set(faults)];
    },

    unforcedColours(root) {
      forcedOnly('unforcedColours');
      const faults: string[] = [];
      for (const [, element] of walk(root)) {
        if (!outOfPalette(element, computedOf) || !shown(element, computedOf)) continue;
        for (const [property, value] of paintedColours(element, computedOf)) {
          if (STAND_IN_VALUES.has(value) || paintsNothing(value)) continue;
          const shownAs =
            value === ''
              ? 'the colour it inherits from outside, which the palette never reached'
              : value;
          const took = source(element, 'forced-color-adjust', 'none');
          faults.push(
            `${took} takes ${describe(element)} out from under the forced palette, and there ` +
              `it paints ${property} in ${shownAs}: not a ` +
              'system colour, so Chrome draws it as written, whatever palette the reader chose. ' +
              `Name a system colour for ${property} in the forced-colours rules.`,
          );
        }
      }
      return [...new Set(faults)];
    },

    close: () => window.happyDOM.close(),
  };
}

/** A rule of one of the installed sheets, with the selector the copy matches on. */
interface SheetRule {
  readonly sheet: string;
  readonly selector: string;
  readonly tested: string;
  readonly declarations: Readonly<Record<string, string>>;
}

/**
 * The first rule, walking out from the element, that matches and declares
 * the property with this value — the one a fix belongs in. The earliest in
 * the sheet, because a rule restated for the pointer or for focus repeats
 * the one it restates, and the fix goes where the colour was first said.
 */
function ruleThatSets(
  rules: readonly SheetRule[],
  element: Element,
  property: string,
  value: string,
): SheetRule | undefined {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const at = node;
    const found = rules.find(
      (rule) => rule.declarations[property] === value && at.matches(rule.tested),
    );
    if (found) return found;
  }
  return undefined;
}

/** The one thing every check asks of an element's computed style. */
interface Computed {
  getPropertyValue(property: string): string;
}

type ComputedOf = (element: Element) => Computed;

/**
 * The element's computed style, with `inherit` read as what it inherits.
 * happy-dom computes the keyword as the value and hands the keyword down to
 * every child that inherits it, where a browser computes the parent's value —
 * so a shortcut's `+`, written in `inherit` on a `HighlightText` line, would
 * be in no colour at all and never read.
 */
function inheritedThrough(window: Window, element: Element): Computed {
  const computed = window.getComputedStyle(element);
  return {
    getPropertyValue(property) {
      const value = computed.getPropertyValue(property);
      if (value !== 'inherit') return value;
      const parent = element.parentElement;
      return parent ? inheritedThrough(window, parent).getPropertyValue(property) : '';
    },
  };
}

/**
 * Whether the element is out from under the palette, which decides whether
 * Chrome keeps the colours it paints. The property inherits, which happy-dom
 * does not do for it, so it is read from the nearest element that says.
 * Whether a line of its words has a backplate is another question, and the
 * box that lays the line out answers it: see `backplated`.
 */
function outOfPalette(element: Element, style: ComputedOf): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const value = style(node).getPropertyValue('forced-color-adjust');
    if (value !== '') return value === 'none';
  }
  return false;
}

/** Containers whose children are laid out as boxes, whatever their own display says. */
const BOXING_DISPLAYS = new Set(['flex', 'inline-flex', 'grid', 'inline-grid']);
/** Boxes that sit in a line of their parent's and lay out lines of their own. */
const ATOMIC_DISPLAYS = new Set(['inline-block', 'inline-flex', 'inline-grid', 'inline-table']);
/** The parts of a table, which happy-dom computes no display for. */
const TABLE_PARTS = new Set(['table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);

/** Whether the element is laid out by a box round it, as a flex item or a positioned box is. */
function laidOutAsBox(element: Element, style: ComputedOf): boolean {
  const parent = element.parentElement;
  if (parent && BOXING_DISPLAYS.has(style(parent).getPropertyValue('display'))) return true;
  return ['absolute', 'fixed'].includes(style(element).getPropertyValue('position'));
}

/** Whether the element is a box that lays out lines, rather than words in a line of another's. */
function laysOutLines(element: Element, style: ComputedOf): boolean {
  if (laidOutAsBox(element, style)) return true;
  const display = style(element).getPropertyValue('display');
  if (display === '') return TABLE_PARTS.has(element.localName);
  return !['inline', 'contents'].includes(display);
}

/**
 * The element whose box lays out the line the element's own words are set
 * in: itself, unless it is inline, when it is the nearest box round it.
 */
function lineOwner(element: Element, style: ComputedOf): Element {
  let node = element;
  while (node.parentElement && !laysOutLines(node, style)) node = node.parentElement;
  return node;
}

/** Whether the element paints a fill of its own. */
function filled(element: Element, style: ComputedOf): boolean {
  const fill = style(element).getPropertyValue('background-color');
  return fill !== '' && !paintsNothing(fill);
}

/**
 * Whether the lines `owner` lays out hold words both before and after `box`,
 * which sits in them — counting the words in inline elements, and none of
 * those in a box that lays out lines of its own. Chrome spans a line's
 * backplate from the first words in it to the last, so a box with words on
 * both sides is behind it, and one at either end is not. All of `owner`'s
 * lines stand in for the one `box` sits in, which can only make this
 * stricter: words either side of it on two lines count as round it.
 */
function wordsAround(owner: Element, box: Element, style: ComputedOf): boolean {
  let before = false;
  let after = false;
  let passed = false;
  const read = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child === box) passed = true;
      else if (child.nodeType === 3 && (child.textContent ?? '').trim() !== '') {
        if (passed) after = true;
        else before = true;
      } else if (child.nodeType === 1 && !laysOutLines(child as Element, style)) read(child);
    }
  };
  read(owner);
  return before && after;
}

/**
 * Whether Chrome paints a backplate behind the line the element's words are
 * set in. The box laying the line out decides, not the words: an inline
 * element taken out from under the palette, in a block that is not, is on
 * the block's backplate all the same, and one put back under it, in a block
 * that is out, gets none. A box that sits in a line of its parent's — an
 * inline-block, an inline row — is behind that line's backplate as well when
 * there are words on both sides of it, and covers it only where it paints a
 * fill of its own.
 */
function backplated(element: Element, style: ComputedOf): boolean {
  let owner = lineOwner(element, style);
  for (;;) {
    if (!outOfPalette(owner, style)) return true;
    const parent = owner.parentElement;
    const inLine =
      ATOMIC_DISPLAYS.has(style(owner).getPropertyValue('display')) &&
      !laidOutAsBox(owner, style);
    if (!parent || !inLine || filled(owner, style)) return false;
    const outer = lineOwner(parent, style);
    if (!wordsAround(outer, owner, style)) return false;
    owner = outer;
  }
}

/**
 * Whether the element is drawn at all: nothing with `display: none` round it,
 * nothing faded to nothing, and nothing clipped away the way a status written
 * only for a screen reader is.
 */
function rendered(element: Element, style: ComputedOf): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const computed = style(node);
    if (computed.getPropertyValue('display') === 'none') return false;
    if (computed.getPropertyValue('opacity') === '0') return false;
    if (computed.getPropertyValue('clip-path') === 'inset(50%)') return false;
  }
  return true;
}

/** Whether `visibility` hides the element, as it hides everything inside unless put back. */
function unseen(element: Element, style: ComputedOf): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const value = style(node).getPropertyValue('visibility');
    if (value !== '') return value === 'hidden' || value === 'collapse';
  }
  return false;
}

/** Whether anybody is shown the element: drawn, and not hidden. */
function shown(element: Element, style: ComputedOf): boolean {
  return rendered(element, style) && !unseen(element, style);
}

/** Inputs whose value is drawn as words. */
const WORDED_INPUTS = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'number', 'password']);

/** The words the element draws itself, not counting those of the elements inside it. */
function wordsOf(element: Element): string {
  if (element.localName === 'input') {
    const type = (element.getAttribute('type') ?? '').toLowerCase();
    return WORDED_INPUTS.has(type) ? (element.getAttribute('value') ?? '').trim() : '';
  }
  return [...element.childNodes]
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
}

/** The fill nearest behind the element, as computed, and the element that paints it. */
function fillBehind(element: Element, style: ComputedOf): { fill: string; owner?: Element } {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const fill = style(node).getPropertyValue('background-color');
    if (fill !== '' && !paintsNothing(fill)) return { fill, owner: node };
  }
  return { fill: '' };
}

/** A colour that leaves nothing on the page: none at all, or a clear one. */
function paintsNothing(value: string): boolean {
  return value === 'transparent' || /^rgba\(.*,\s*0\)$/.test(value);
}

/** Each edge as happy-dom keeps it, which is apart from its other spelling. */
const EDGES = [
  'block-start',
  'block-end',
  'inline-start',
  'inline-end',
  'top',
  'right',
  'bottom',
  'left',
];

/** A line with no style is not drawn; one with no width set is `medium`. */
function drawn(computed: Computed, line: string): boolean {
  const kind = computed.getPropertyValue(`${line}-style`);
  const width = computed.getPropertyValue(`${line}-width`);
  return !['', 'none', 'hidden'].includes(kind) && (width === '' || Number.parseFloat(width) !== 0);
}

/**
 * Every colour the element itself puts on the page, by the property that
 * puts it there, with `currentcolor` read as the element's own colour — an
 * empty one being the colour it inherits.
 */
function paintedColours(element: Element, style: ComputedOf): [string, string][] {
  const computed = style(element);
  const own = computed.getPropertyValue('color');
  const read = (property: string): string => {
    const value = computed.getPropertyValue(property);
    return ['', 'currentcolor', 'auto'].includes(value.toLowerCase()) ? own : value;
  };
  const words = wordsOf(element) !== '';
  const painted: [string, string][] = [];

  if (words) painted.push(['color', own]);
  const fill = computed.getPropertyValue('background-color');
  if (fill !== '') painted.push(['background-color', fill]);
  for (const line of [...EDGES.map((edge) => `border-${edge}`), 'outline']) {
    if (drawn(computed, line)) painted.push([`${line}-color`, read(`${line}-color`)]);
  }
  const decoration = computed.getPropertyValue('text-decoration-line');
  if (words && !['', 'none'].includes(decoration)) {
    painted.push(['text-decoration-color', read('text-decoration-color')]);
  }
  const type = (element.getAttribute('type') ?? '').toLowerCase();
  const editable =
    element.localName === 'textarea' ||
    (element.localName === 'input' && WORDED_INPUTS.has(type)) ||
    element.getAttribute('contenteditable') === 'true';
  if (editable) painted.push(['caret-color', read('caret-color')]);
  for (const property of ['fill', 'stroke']) {
    if (!['', 'none'].includes(computed.getPropertyValue(property))) {
      painted.push([property, read(property)]);
    }
  }
  const shadow = computed.getPropertyValue('box-shadow');
  if (!['', 'none'].includes(shadow)) {
    for (const colour of shadowColours(shadow)) {
      painted.push(['box-shadow', colour === '' ? own : colour]);
    }
  }
  return painted;
}

/** The colour of each shadow in a `box-shadow` value; empty for one that names none. */
function shadowColours(value: string): string[] {
  return splitOutsideParentheses(value, ',').map(
    (shadow) =>
      splitOutsideParentheses(shadow.trim(), ' ').find(
        (part) => part !== '' && part !== 'inset' && !/^[-+.\d]/.test(part),
      ) ?? '',
  );
}

function splitOutsideParentheses(value: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === separator && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

/** An element as a fault names it: its classes, or its tag where it has none. */
function describe(element: Element): string {
  return element.classList.length > 0
    ? `.${[...element.classList].join('.')}`
    : `<${element.localName}>`;
}

/** Words short enough to quote in a sentence. */
function clip(words: string): string {
  return words.length > 24 ? `${words.slice(0, 23)}…` : words;
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
  if (fixture.text !== undefined) {
    if (element.localName === 'input') element.setAttribute('value', fixture.text);
    else element.append(fixture.text);
  }
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
