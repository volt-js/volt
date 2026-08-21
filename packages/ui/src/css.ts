/**
 * The shape the styled layer is written in, and how it becomes CSS text.
 *
 * Styles are data rather than template strings because the promises this
 * package makes are properties of the whole sheet rather than of any one rule:
 * every themeable value is a token reference, no rule escapes its cascade
 * layer, and every state a component shows in colour is restated for
 * `forced-colors: active`. Those are checkable by walking declarations and
 * only greppable in a string. The CLI that will generate components into a
 * consumer's repository needs the same list, one component at a time.
 *
 * Longhand properties throughout, and no pseudo-elements. A consumer
 * overriding `background-color` should not have to discover that a
 * `background` shorthand elsewhere resets it, and a part drawn with `::before`
 * is a part their generated markup cannot restructure.
 */

/** Property to value, in the order they should be emitted. */
export type Declarations = Readonly<Record<string, string>>;

export interface Rule {
  /**
   * A selector list. Classes, attributes and pseudo-classes only — no ids, and
   * nothing built from an application's own strings, which would need
   * `CSS.escape` and a browser to run it in.
   */
  readonly selector: string;
  readonly declarations: Declarations;
}

export interface KeyframeStep {
  /** `from`, `to`, or a percentage. */
  readonly offset: string;
  readonly declarations: Declarations;
}

export interface Keyframes {
  readonly name: string;
  readonly steps: readonly KeyframeStep[];
}

export interface ComponentStyles {
  /** The component's name, as the generator will know it. */
  readonly name: string;

  /**
   * Every class the component's markup carries, keyed by part. Selectors are
   * built from these rather than written out, so renaming a part cannot leave
   * a rule pointing at a class the markup no longer has.
   */
  readonly classes: Readonly<Record<string, string>>;

  readonly keyframes: readonly Keyframes[];
  readonly rules: readonly Rule[];

  /**
   * Rules for `@media (forced-colors: active)`. Held apart from `rules`
   * because they are a required part of the contract rather than an optional
   * block: a state shown in colour has to be restated here in a channel the
   * forced palette does not flatten, and something has to be able to check
   * that it was.
   */
  readonly forcedColors: readonly Rule[];
}

const INDENT = '  ';

function declarationsToCss(declarations: Declarations, indent: string): string {
  return Object.entries(declarations)
    .map(([property, value]) => `${indent}${property}: ${value};`)
    .join('\n');
}

/** One block per rule, blank line between, ready to nest under `indent`. */
export function rulesToCss(rules: readonly Rule[], indent = ''): string {
  return rules
    .map(
      (rule) =>
        `${indent}${rule.selector} {\n` +
        `${declarationsToCss(rule.declarations, indent + INDENT)}\n` +
        `${indent}}`,
    )
    .join('\n\n');
}

export function keyframesToCss(frames: readonly Keyframes[], indent = ''): string {
  return frames
    .map((frame) => {
      const steps = frame.steps
        .map(
          (step) =>
            `${indent}${INDENT}${step.offset} {\n` +
            `${declarationsToCss(step.declarations, indent + INDENT + INDENT)}\n` +
            `${indent}${INDENT}}`,
        )
        .join('\n');
      return `${indent}@keyframes ${frame.name} {\n${steps}\n${indent}}`;
    })
    .join('\n\n');
}

/** Wrap already-serialized CSS in an at-rule block. */
export function wrap(prelude: string, body: string, indent = ''): string {
  return `${indent}${prelude} {\n${body}\n${indent}}`;
}
