/**
 * @voltdev/compiler — Volt template source -> DOM-building JavaScript.
 *
 * The compiler is a pure `string -> string` transform with no DOM or Node
 * dependencies, which is what lets the exact same code path run in two places:
 *
 *   - at build time, through `@voltdev/vite-plugin`, emitting an ES module
 *   - at runtime, through `new Function`, when no build step is present
 *
 * Both modes produce identical output, so behaviour never diverges between
 * development and production.
 */

import { parse, CompilerError, type ParserOptions } from './parser.js';
import {
  generate,
  type CodegenOptions,
  type CodegenResult,
  type CodegenTarget,
  type CompileStats,
} from './codegen.js';
import { buildHash, COMPILER_VERSION, type BuildOptions } from './build.js';
import type { RootNode } from './ast.js';

export interface CompileOptions extends ParserOptions, CodegenOptions {}

export interface CompileResult extends CodegenResult {
  ast: RootNode;
  /**
   * `__VOLT_BUILD__` for this compile — the identity a server writes into the
   * boot record and a client compares its own against.
   *
   * Computed here rather than left to the caller because the caller would have
   * to rebuild the same options object to get the same answer, and the one
   * mistake this guard cannot survive is being wrong about which build printed
   * a page: it would then discard every correct tree, or keep a stale one.
   */
  buildHash: string;
}

export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const ast = parse(source, options);
  const result = generate(ast, options);
  return { ...result, ast, buildHash: buildHash(options) };
}

export { parse, generate, CompilerError };

export type {
  ParserOptions,
  CodegenOptions,
  CodegenResult,
  CodegenTarget,
  CompileStats,
  RootNode,
};

export { generateTypeCheckBlock } from './typecheck.js';
export type {
  NameMark,
  TemplateSpan,
  TypeCheckBlock,
  TypeCheckOptions,
  TypeCheckRule,
} from './typecheck.js';

export { formatDiagnostic } from './a11y.js';
export type { A11ySeverity, Diagnostic } from './a11y.js';

export {
  LIBRARY_MESSAGE_KEYS,
  checkCatalog,
  checkMessageSites,
  collectTranslateCalls,
  generateMessages,
  messageShape,
  scanMessageKeys,
  unusedMessages,
} from './messages.js';
export type {
  CatalogCheckOptions,
  CatalogMessage,
  GenerateOptions,
  GeneratedMessages,
  MessageCatalog,
  MessageCheckOptions,
  MessageParam,
  MessageShape,
  MessageSite,
  PluralForms,
  TranslateCall,
  UnusedOptions,
} from './messages.js';

export { CHILD_MARKER, clientMarkup, rootArity } from './markup.js';
export type {
  AttributeHole,
  ChildHole,
  ContentHole,
  TemplateBlock,
  TemplateHole,
} from './markup.js';

export { buildHash, COMPILER_VERSION };
export type { BuildOptions };

export type {
  AttributeNode,
  CommentNode,
  DirectiveKind,
  DirectiveNode,
  ElementNode,
  InterpolationNode,
  SlotOutletNode,
  SourceLocation,
  TemplateChildNode,
  TextNode,
} from './ast.js';

export {
  ARIA_ATTRIBUTES,
  ARIA_ROLES,
  KNOWN_EVENTS,
  HTML_TAGS,
  SVG_TAGS,
  BOOLEAN_ATTRIBUTES,
  MUST_USE_ATTRIBUTE,
  isComponentTag,
} from './dom-info.js';
export type { AriaAttribute, AriaValueKind } from './dom-info.js';

export { parseExpression, parseForExpression } from './expression/parser.js';
export {
  isStaticExpression,
  evaluateStatic,
  printExpression,
  createPrintContext,
  collectDependencies,
  TEMPLATE_GLOBALS,
} from './expression/printer.js';
export type { ExprNode, PatternNode } from './expression/ast.js';
