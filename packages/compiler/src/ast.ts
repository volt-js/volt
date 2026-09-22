/** Template AST produced by the parser and consumed by transform + codegen. */

export interface SourceLocation {
  start: number;
  end: number;
  line: number;
  column: number;
}

export type DirectiveKind =
  | 'if'
  | 'else-if'
  | 'else'
  | 'for'
  | 'key'
  | 'text'
  | 'html'
  | 'model'
  | 'ref'
  | 'slot'
  | 'host'
  | 'outlet'
  | 'portal'
  | 'event'
  | 'prop'
  | 'attr'
  | 'class'
  | 'style'
  | 'spread';

export interface AttributeNode {
  type: 'attribute';
  name: string;
  value: string | null;
  loc: SourceLocation;
}

export interface DirectiveNode {
  type: 'directive';
  kind: DirectiveKind;
  /** Resolved target: event name, prop name, attribute name, or '' for structural. */
  name: string;
  /** The directive exactly as authored, e.g. `:click.stop.prevent`. */
  rawName: string;
  modifiers: string[];
  /** Raw expression source, or null for valueless directives like `:else`. */
  exp: string | null;
  loc: SourceLocation;
  /**
   * Where `exp` itself is written, which is not where the directive starts.
   *
   * A diagnostic about the expression has to point at the expression: `loc`
   * lands on the `:` of `:click`, which is the wrong column to underline and
   * the wrong line entirely once a value is wrapped onto the next one.
   */
  expLoc: SourceLocation | null;
}

export interface TextNode {
  type: 'text';
  content: string;
  loc: SourceLocation;
}

export interface InterpolationNode {
  type: 'interpolation';
  exp: string;
  loc: SourceLocation;
  /** Where `exp` begins, past the `{` and any whitespace after it. */
  expLoc: SourceLocation;
}

export interface CommentNode {
  type: 'comment';
  content: string;
  loc: SourceLocation;
}

export interface ElementNode {
  type: 'element';
  tag: string;
  /** True for PascalCase tags and hyphenated non-standard tags. */
  isComponent: boolean;
  /** `<template>` used purely as a grouping wrapper carries no DOM output. */
  isTemplate: boolean;
  attrs: AttributeNode[];
  directives: DirectiveNode[];
  children: TemplateChildNode[];
  selfClosing: boolean;
  loc: SourceLocation;
}

export interface SlotOutletNode {
  type: 'slot-outlet';
  name: string;
  /**
   * Whose content this outlet draws, when it is not this component's own.
   *
   * `<slot :from="col" name="cell">` renders what a caller wrote inside that
   * component's tag, here. A parent tag drawing what was written inside a
   * child tag is the whole of what it is for — a table and its columns, a
   * select and its options — and without it such a pair can only be built by
   * rendering the child once per row.
   */
  from?: DirectiveNode;
  attrs: AttributeNode[];
  directives: DirectiveNode[];
  children: TemplateChildNode[];
  loc: SourceLocation;
}

export type TemplateChildNode =
  | ElementNode
  | TextNode
  | InterpolationNode
  | CommentNode
  | SlotOutletNode;

export interface RootNode {
  type: 'root';
  children: TemplateChildNode[];
  loc: SourceLocation;
}

export const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Elements whose text content is not parsed for tags or interpolation. */
export const RAW_TEXT_TAGS = new Set(['script', 'style']);

/** Elements where whitespace is significant and must not be collapsed. */
export const PRESERVE_WHITESPACE_TAGS = new Set(['pre', 'textarea', 'script', 'style']);

/**
 * Directive names that describe structure or behaviour rather than a
 * prop/event target. Checked before any event or property resolution.
 */
export const STRUCTURAL_DIRECTIVES = new Set<string>([
  'if',
  'else-if',
  'else',
  'for',
  'key',
  'text',
  'html',
  'model',
  'ref',
  'portal',
  'host',
  'outlet',
]);
