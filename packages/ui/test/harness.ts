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
 */

import { Window } from 'happy-dom';
import {
  componentStyles,
  keyframesToCss,
  rulesToCss,
  tokensCss,
  wrap,
  FORCED_COLORS_QUERY,
} from '../src/index.ts';

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
  const blocks = [tokensCss()];

  for (const component of componentStyles) {
    if (component.keyframes.length > 0) blocks.push(keyframesToCss(component.keyframes));
    blocks.push(rulesToCss(component.rules));
    if (component.forcedColors.length > 0) {
      blocks.push(wrap(FORCED_COLORS_QUERY, rulesToCss(component.forcedColors, '  ')));
    }
  }

  return blocks.join('\n\n');
}

export function styledDocument(options: { forcedColors?: boolean } = {}): StyledDocument {
  const window = new Window({
    url: 'http://localhost/',
    settings: { device: { forcedColors: options.forcedColors ? 'active' : 'none' } },
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
          values.set(`${path}:${property}`, style.getPropertyValue(property));
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

/** Every `path:property` the two trees disagree on, with both values. */
export function differences(
  before: Map<string, string>,
  after: Map<string, string>,
): Map<string, { before: string; after: string }> {
  const changed = new Map<string, { before: string; after: string }>();
  for (const [key, value] of before) {
    const other = after.get(key) ?? '';
    if (other !== value) changed.set(key, { before: value, after: other });
  }
  return changed;
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
