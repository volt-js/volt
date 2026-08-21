/**
 * Codegen: template AST -> JavaScript that builds real DOM.
 *
 * There is no virtual DOM anywhere in the output. Each template becomes a
 * static HTML string cloned once per instantiation, plus a small set of
 * targeted effects that patch exactly the nodes that can change.
 *
 * Compile-time work that removes runtime work:
 *   - static subtrees are baked into the cloned markup and never visited again
 *   - identical markup shares one hoisted `<template>`
 *   - bindings whose expressions are provably constant are folded into markup
 *     and emit no effect at all
 *   - node references are resolved by `firstChild`/`nextSibling` chains
 *     computed at build time, reusing earlier references where possible
 *   - event handlers that close over nothing local are hoisted out of loops
 */

import {
  type AttributeNode,
  type DirectiveKind,
  type DirectiveNode,
  type ElementNode,
  type RootNode,
  type SlotOutletNode,
  type TemplateChildNode,
  VOID_TAGS,
} from './ast.js';
import {
  ATTR_TO_PROP,
  BOOLEAN_ATTRIBUTES,
  DELEGATED_EVENTS,
  NEVER_DELEGATED,
  EVENT_GUARD_MODIFIERS,
  EVENT_OPTION_MODIFIERS,
  KEY_MODIFIERS,
  MUST_USE_ATTRIBUTE,
  SVG_TAGS,
  SYSTEM_MODIFIERS,
} from './dom-info.js';
import { validateContentModel } from './content-model.js';
import { checkAccessibility, type A11ySeverity, type Diagnostic } from './a11y.js';
import {
  clientMarkup,
  MarkupBuilder,
  rootArity,
  type TemplateBlock,
  type TemplateHole,
} from './markup.js';
import { CompilerError } from './parser.js';
import { parseExpression, parseForExpression } from './expression/parser.js';
import {
  collectDependencies,
  createPrintContext,
  evaluateStatic,
  isStaticExpression,
  printExpression,
  printPattern,
  withScope,
  type PrintContext,
} from './expression/printer.js';
import { patternNames, type ExprNode, type PatternNode } from './expression/ast.js';
import {
  checkMessageSites,
  collectTranslateCalls,
  type MessageCatalog,
  type MessageSite,
} from './messages.js';

export interface CodegenOptions {
  runtime?: string;
  ctx?: string;
  filename?: string;
  /** Module specifier for the runtime import in `module` mode. */
  runtimeModule?: string;
  /**
   * Drive a `:for` row's bindings from one effect rather than one each.
   *
   * An effect costs roughly 1.6 kB against 31 bytes for a signal, and a row
   * typically has three, so this is most of what a row allocates. The trade is
   * coarser invalidation: any dependency of any binding in the row re-runs all
   * of them, each still comparing its own value before touching the DOM.
   *
   * Off by default while the two shapes are being measured against each other.
   */
  groupRowBindings?: boolean;
  /**
   * What the accessibility rules are allowed to do: `error` (the default)
   * refuses the template, `warn` reports everything and compiles it anyway,
   * `off` skips the pass. See `checkAccessibility`.
   */
  a11y?: A11ySeverity;
  /**
   * The catalogue every literal `t('key')` in this template is checked
   * against, so a missing key or a missing parameter is a build error naming
   * this file and the line rather than a raw key found on a production page.
   *
   * Absent means no check. The compiler cannot tell a mistyped key from a
   * project that has not adopted the build-time catalogue at all, and refusing
   * the second would make the feature mandatory the day it landed.
   */
  catalog?: MessageCatalog;
  /** Where that catalogue came from, so the error says what to edit. */
  catalogFile?: string;
  /**
   * Which side of the render this build is for.
   *
   * `client` clones the static markup and patches the clone; `server` writes
   * the same static bytes into a markup writer with the values printed
   * between them. Both walk one `Block`, so the static bytes are the same
   * string either way — see `markup.ts`.
   *
   * Per build rather than per instantiation: a browser that never
   * server-renders must not carry a second emit of every template, and a
   * server has no use for the first.
   */
  target?: 'client' | 'server';
}

export interface CodegenResult {
  /** Body usable as `new Function('_rt', body)` -> returns the render fn. */
  body: string;
  /** Standalone ES module source exporting `render`. */
  code: string;
  /**
   * Module-level declarations (hoisted `<template>` cloners) that must appear
   * once, before the render function. Build-time embedding needs these
   * separately so they can be lifted to the top of the host module.
   */
  hoisted: string[];
  /** Which emit this is; see `CodegenOptions.target`. */
  target: 'client' | 'server';
  /**
   * The render function's parameter list — `_ctx` for a client build, and
   * `_ctx, _o` for a server one, whose second parameter is the writer the
   * markup goes into.
   */
  renderParams: string;
  /**
   * The render function's body, given `_rt` in scope: one `return` of the
   * expression that builds the DOM on a client, and the statements that write
   * the markup on a server.
   */
  renderBody: string;
  /** Hoisted static markup strings, in emission order. */
  templates: string[];
  /**
   * Every block generated, as chunks and holes.
   *
   * `templates` is what the client clones — one string per *distinct* markup.
   * This is the same markup unjoined, one entry per block, so two blocks that
   * dedupe to one cloner appear twice under one `id` with the holes each of
   * them actually has. A server writes bytes and values alternately and needs
   * the seams; the client string is `clientMarkup` of these chunks, so the two
   * agree by construction rather than by test.
   *
   * Ordered by when each block finished, so a nested block precedes the one
   * containing it.
   */
  blocks: TemplateBlock[];
  /**
   * Distinct event names this template compiles to delegated listeners.
   *
   * `delegate` installs the document-level listener for a type the first time
   * a handler of that type is attached, which on a server-rendered page is
   * after hydration — so a click landing on markup that is on screen but not
   * yet claimed has nothing listening. Knowing the set up front is what lets a
   * boot record install them before that gap opens.
   */
  delegatedEventNames: string[];
  /**
   * Per `:for` in source order, the top-level nodes one row occupies — or null
   * where only the runtime can know, because the row is a component or has
   * something dynamic at its root.
   *
   * Server markup needs delimiters around a row whose width can change, and
   * needs none around one that cannot. On a ten-thousand-row table that is the
   * difference between two comments and twenty thousand.
   */
  rowRootCounts: (number | null)[];
  /** What the compiler removed or folded before runtime ever sees it. */
  stats: CompileStats;
  /**
   * Component tags this template can never render on first paint.
   *
   * A tag qualifies when every one of its occurrences sits inside a `:if`
   * chain or a `:portal` — so reaching it always depends on a condition, and
   * the initial render cannot include it unless that condition starts true.
   * The build uses this to decide what to split into its own chunk without
   * anyone having to declare it.
   *
   * `:for` deliberately does not qualify. A list is very often non-empty on
   * first render, and being wrong there costs a round trip on the critical
   * path — whereas being wrong about a dialog costs nothing.
   */
  deferrable: string[];
  /**
   * Literal message keys this template asks for, via `t('key')`.
   *
   * The build checks these against the catalogue, so a missing key is an error
   * with a file and a line rather than a fallback string found in production,
   * and puts each message in the chunk that uses it.
   */
  messageKeys: string[];
  /**
   * The same keys with the line each was asked for on, and the parameter names
   * the call passed.
   *
   * Keys alone are enough to tree-shake and to chunk; a location is what turns
   * a missing message into an error someone can act on, which is the whole
   * advantage a compiler has over a bundler here.
   */
  messageSites: MessageSite[];
  /**
   * Accessibility findings that are usually rather than certainly wrong.
   *
   * The certain ones throw, like every other thing the compiler refuses, so
   * anything reaching here is a judgement a caller is allowed to disagree
   * with — and each one names what to write instead.
   */
  warnings: Diagnostic[];
}

export interface CompileStats {
  templates: number;
  dedupedTemplates: number;
  effects: number;
  foldedBindings: number;
  delegatedEvents: number;
  hoistedHandlers: number;
  staticNodes: number;
  /** `:class` object keys compiled to independent per-class toggles. */
  classToggles: number;
}

interface Resolver {
  (path: number[]): string;
}

interface PendingEffect {
  (resolve: Resolver): string[];
}

/**
 * Where a server statement goes, when it is not filling a hole.
 *
 * `:portal` writes bytes somewhere else entirely, so it reserves no slot and
 * punches no hole — but it still has to run where it was written, or two
 * portals into the same container come out in the wrong order. Recording it
 * against the number of holes seen so far puts it back in walk order without
 * giving it a position in the markup it does not occupy.
 */
interface DetachedServerCode {
  /** Holes recorded when this was pushed; it runs just before that hole. */
  before: number;
  lines: string[];
}

/** One contiguous static DOM subtree with holes punched for dynamic parts. */
class Block {
  readonly markup = new MarkupBuilder();
  effects: PendingEffect[] = [];
  /** Server statements filling each hole, aligned with `markup.holes`. */
  readonly serverHoles: string[][] = [];
  /**
   * Byte ranges of the chunk *before* each hole that the server prints itself
   * rather than copying.
   *
   * Only ever the folded `class` or `style` attribute of an element that also
   * has a dynamic one. The client sets those on the clone, where `classList`
   * merges; a server has one attribute to write and has to write both halves
   * of it at once, and a second `class="..."` in the same tag is discarded by
   * every parser. The bytes are still the ones the shared builder produced —
   * this records which of them the merge takes over, so nothing is printed
   * twice and nothing is printed by a second serializer.
   */
  readonly serverOmit: ([number, number][] | null)[] = [];
  readonly serverDetached: DetachedServerCode[] = [];
  /** Per-depth child bookkeeping so paths account for merged text nodes. */
  private stack: { index: number; lastWasText: boolean }[] = [
    { index: 0, lastWasText: false },
  ];
  private path: number[] = [];
  rootCount = 0;
  isSvg = false;

  enter(childIndex: number): void {
    this.path.push(childIndex);
    this.stack.push({ index: 0, lastWasText: false });
  }

  exit(): void {
    this.path.pop();
    this.stack.pop();
  }

  currentPath(): number[] {
    return [...this.path];
  }

  /**
   * Reserve the next child slot. Adjacent text merges into a single DOM node,
   * so two consecutive text pieces share one index.
   */
  addChild(isText: boolean): number {
    const frame = this.stack[this.stack.length - 1]!;
    if (isText && frame.lastWasText) return frame.index - 1;
    frame.lastWasText = isText;
    const index = frame.index++;
    if (this.stack.length === 1) this.rootCount = frame.index;
    return index;
  }

  pathTo(childIndex: number): number[] {
    return [...this.path, childIndex];
  }

  /** Record a hole, with the server code that fills it. */
  hole(
    record: TemplateHole,
    serverCode: string[] = [],
    omit: [number, number][] | null = null,
  ): void {
    this.markup.hole(record);
    this.serverHoles.push(serverCode);
    this.serverOmit.push(omit);
  }

  /** Record server code that writes nothing here; see `DetachedServerCode`. */
  detach(lines: string[]): void {
    this.serverDetached.push({ before: this.markup.holes.length, lines });
  }
}

export function generate(root: RootNode, options: CodegenOptions = {}): CodegenResult {
  // Before any path is computed, because every path below a node the HTML
  // parser relocates is resolved against a tree that will not exist.
  validateContentModel(root, options.filename);
  const warnings = checkAccessibility(root, options);
  const result = new Generator(options).run(root);

  // Both read up front so the option-coverage gate in `build-hash.test.ts`
  // sees them: an option consulted only down a branch nothing in the corpus
  // takes is one that can drift out of that gate's reach.
  const { catalog, catalogFile } = options;
  if (catalog) {
    try {
      checkMessageSites(result.messageSites, catalog, {
        filename: options.filename,
        catalogFile,
      });
    } catch (e) {
      // As with the accessibility pass: a refusal must not swallow the softer
      // findings from the same template, which are about other elements.
      if (e instanceof CompilerError) e.warnings = warnings;
      throw e;
    }
  }

  return { ...result, warnings };
}

class Generator {
  private readonly rt: string;
  /** See `CodegenOptions.groupRowBindings`. */
  private readonly groupRowBindings: boolean;
  /**
   * Set while generating a `:for` row, and cleared by the first block that
   * takes it. Only that outermost block groups; anything nested is reached
   * through an effect of its own and gains nothing.
   */
  private groupNextBlock = false;
  private readonly ctxName: string;
  private readonly filename: string;
  private readonly runtimeModule: string;
  /** See `CodegenOptions.target`. */
  private readonly server: boolean;
  /** The markup writer a server emit writes into, named in generated code. */
  private readonly out = '_o';

  private templates: string[] = [];
  private templateIds = new Map<string, string>();
  private blocks: TemplateBlock[] = [];
  private delegatedEventNames = new Set<string>();
  private rowRootCounts: (number | null)[] = [];
  private hoisted: string[] = [];
  private uid = 0;

  /** Depth of `:if` / `:portal` nesting, for the deferrable-tag analysis. */
  private conditionalDepth = 0;
  /** Every component tag seen, mapped to whether it was ever unconditional. */
  private componentTags = new Map<string, boolean>();
  /** Every literal `t('key')` this template makes, with where it was made. */
  private messageSites: MessageSite[] = [];
  /** Expression texts already collected, keyed by where they were written. */
  private notedExpressions = new Set<string>();

  private stats: CompileStats = {
    templates: 0,
    dedupedTemplates: 0,
    effects: 0,
    foldedBindings: 0,
    delegatedEvents: 0,
    hoistedHandlers: 0,
    staticNodes: 0,
    classToggles: 0,
  };

  constructor(options: CodegenOptions) {
    this.rt = options.runtime ?? '_rt';
    this.ctxName = options.ctx ?? '_ctx';
    this.filename = options.filename ?? 'template';
    this.server = (options.target ?? 'client') === 'server';
    // Defaulted per target rather than fixed, so that neither side has to be
    // told which module it wants and `__VOLT_BUILD__` stays comparable: the
    // hash covers the option, and an option nobody set is the same on both
    // sides however differently it resolves.
    this.runtimeModule =
      options.runtimeModule ?? (this.server ? '@voltdev/core/server' : '@voltdev/core/runtime');
    this.groupRowBindings = options.groupRowBindings ?? false;
  }

  /** Everything but the accessibility warnings, which `generate` adds. */
  run(root: RootNode): Omit<CodegenResult, 'warnings'> {
    const ctx = createPrintContext(this.ctxName);
    const generated = this.genChildrenExpression(root.children, ctx);

    const params = this.server ? `${this.ctxName}, ${this.out}` : this.ctxName;
    const renderBody = this.server ? generated : `return ${generated};`;

    const lines: string[] = [];
    for (const h of this.hoisted) lines.push(h);
    lines.push('');
    lines.push(`return function render(${params}) {`);
    lines.push(indent(renderBody, 2));
    lines.push('};');

    const body = lines.join('\n');

    const moduleLines: string[] = [
      `import * as ${this.rt} from ${JSON.stringify(this.runtimeModule)};`,
      '',
      ...this.hoisted,
      '',
      `export function render(${params}) {`,
      indent(renderBody, 2),
      '}',
      '',
      'export default render;',
    ];

    return {
      body,
      code: moduleLines.join('\n'),
      hoisted: this.hoisted,
      target: this.server ? 'server' : 'client',
      renderParams: params,
      renderBody,
      templates: this.templates,
      blocks: this.blocks,
      delegatedEventNames: [...this.delegatedEventNames].sort(),
      rowRootCounts: this.rowRootCounts,
      stats: this.stats,
      messageKeys: [...new Set(this.messageSites.map((site) => site.key))].sort(),
      messageSites: this.messageSites,
      deferrable: [...this.componentTags]
        .filter(([, unconditional]) => !unconditional)
        .map(([tag]) => tag),
    };
  }

  // -------------------------------------------------------------------------
  // Naming and hoisting
  // -------------------------------------------------------------------------

  /**
   * Parse a template expression, noting any message keys it asks for.
   *
   * Wrapping the parser is what makes the collection exhaustive: there are ten
   * places an expression is parsed, and a key missed by one of them would be a
   * message the build believes nothing uses.
   *
   * The location is required rather than optional because it is the only part
   * a caller can silently omit and still compile — and a message error without
   * a line is one nobody can act on.
   */
  private parse(exp: string, loc: { line: number; column: number }): ExprNode {
    const parsed = parseExpression(exp);
    this.noteMessages(parsed, loc, exp);
    return parsed;
  }

  /**
   * Record the `t('key')` calls in an already-parsed expression.
   *
   * Several expressions are parsed twice — an interpolation is folded and then
   * printed, a `:class` is tried as toggles and then as a whole — so the same
   * text at the same place is collected once. What is skipped is the repeated
   * *parse*, never a repeated call: `t('pageOf', { n, m }) + t('pageOf', { n })`
   * is two sites, and deduping by key and position would drop the second —
   * which is the one with the missing parameter.
   */
  private noteMessages(
    parsed: ExprNode,
    loc: { line: number; column: number },
    source: string,
  ): void {
    // Line and column only: the node's own location carries offsets too, and
    // a site is a thing to report, not a thing to slice source with.
    const at = `${loc.line}:${loc.column}:${source}`;
    if (this.notedExpressions.has(at)) return;
    this.notedExpressions.add(at);

    for (const call of collectTranslateCalls(parsed)) {
      this.messageSites.push({ ...call, loc: { line: loc.line, column: loc.column } });
    }
  }

  private nextId(prefix: string): string {
    return `_${prefix}${this.uid++}`;
  }

  /**
   * Wrap an expression as an arrow body.
   *
   * The parentheses are load-bearing: `() => { a: 1 }` is a function whose
   * body is a block containing a labelled statement, not one returning an
   * object. That mistake is silent for `:class="{ active: x }"` — it just
   * yields undefined — so every generated arrow gets them.
   */
  private thunk(expression: string, params = ''): string {
    return `(${params}) => (${expression})`;
  }

  /** A server body as a nullary arrow, since statements are not an expression. */
  private arrowBlock(statements: string): string {
    return `() => {\n${indent(statements, 2)}\n}`;
  }

  /** Hoist static markup, reusing an existing template when identical. */
  private hoistTemplate(html: string, isSvg: boolean, rootCount: number): string {
    const key = `${isSvg ? 'svg' : 'html'}:${rootCount}:${html}`;
    const existing = this.templateIds.get(key);
    if (existing) {
      this.stats.dedupedTemplates++;
      return existing;
    }
    const id = this.nextId('tmpl');
    this.templateIds.set(key, id);
    this.templates.push(html);
    this.stats.templates++;
    // The bookkeeping runs on both sides so that two builds of one template
    // record the same blocks; only the cloner is client-only, because a server
    // writes the bytes rather than parsing them into something to copy.
    if (!this.server) {
      const args = [JSON.stringify(html)];
      if (isSvg || rootCount > 1) args.push(String(rootCount), String(isSvg));
      this.hoisted.push(`const ${id} = ${this.rt}.template(${args.join(', ')});`);
    }
    return id;
  }

  private error(message: string, node: { loc: { line: number; column: number } }): never {
    // Pass the filename through rather than appending it, so the message
    // names the file the template actually lives in.
    throw new CompilerError(message, node.loc, undefined, this.filename);
  }

  // -------------------------------------------------------------------------
  // Block generation
  // -------------------------------------------------------------------------

  /** Generate an expression producing the DOM for a list of sibling nodes. */
  private genChildrenExpression(nodes: TemplateChildNode[], ctx: PrintContext): string {
    return this.genChildren(nodes, ctx).expression;
  }

  /**
   * The same, plus how many top-level nodes the expression yields — which is
   * knowable only when the nodes compile to a block with nothing dynamic at
   * its root. `:for` is the caller that needs it; everything else takes the
   * expression and ignores the count.
   */
  private genChildren(
    nodes: TemplateChildNode[],
    ctx: PrintContext,
  ): { expression: string; rootCount: number | null } {
    // Taken here so the early single-child paths below, which recurse, cannot
    // pass it down to a nested block.
    const groupBindings = this.groupNextBlock;
    this.groupNextBlock = false;
    /** Whatever this yields, its width is the runtime's business. */
    const opaque = (expression: string) => ({ expression, rootCount: null });
    const meaningful = nodes.filter((n) => n.type !== 'comment');
    if (meaningful.length === 0) return opaque('null');

    // A lone dynamic node needs no template at all — emit its accessor
    // directly. This is not just an optimisation: a block whose only root is a
    // `<!>` marker would clone detached, leaving nothing to insert into.
    if (meaningful.length === 1) {
      const only = meaningful[0]!;
      if (only.type === 'interpolation') {
        if (this.server) {
          return opaque(`${this.out}.child(${this.genInterpolationValue(only.exp, ctx, only)});`);
        }
        return opaque(this.genInterpolationAccessor(only.exp, ctx, only));
      }
      if (only.type === 'slot-outlet') {
        return opaque(this.genSlotOutlet(only, ctx));
      }
      if (only.type === 'element') {
        // Checked before the rest: a portalled element renders elsewhere, so
        // whatever it is — component, template or plain element — this
        // position yields nothing.
        if (findDirective(only, 'portal') && !findDirective(only, 'if')) {
          const portal = this.genPortal(only, ctx);
          return opaque(this.server ? portal : `(${portal.replace(/;$/, '')}, null)`);
        }
        if (findDirective(only, 'if')) return opaque(this.genConditionalChain([only], ctx));
        if (findDirective(only, 'for')) return opaque(this.genFor(only, ctx));
        if (only.isComponent) return opaque(this.genComponent(only, ctx));
        if (only.isTemplate) return this.genChildren(only.children, ctx);
      }
    }

    const block = new Block();
    this.buildChildren(meaningful, block, ctx);

    const html = clientMarkup(block.markup);
    // Every dynamic child punches a `<!>` marker, so a block with children
    // always produces markup; empty input was handled above.
    if (!html) return opaque(this.server ? '' : 'null');

    const isSvg = block.isSvg;
    const rootCount = block.rootCount;
    const tmplId = this.hoistTemplate(html, isSvg, rootCount);
    const template: TemplateBlock = {
      id: tmplId,
      chunks: block.markup.chunks,
      holes: block.markup.holes,
      rootCount,
      isSvg,
    };
    this.blocks.push(template);

    if (this.server) {
      return { expression: this.emitServerBlock(block), rootCount: rootArity(template) };
    }

    const rootVar = this.nextId('el');
    const resolved = new Map<string, string>();
    // Seeding depends on what `template()` hands back. With a single root the
    // clone *is* that root element, which is path [0]. With several roots the
    // clone is the fragment containing them, which is path [].
    resolved.set(rootCount > 1 ? '' : '0', rootVar);

    const navigation: string[] = [];
    const resolve: Resolver = (path) => this.resolvePath(path, resolved, navigation);

    const effectLines: string[] = [];
    for (const effect of block.effects) {
      for (const line of effect(resolve)) effectLines.push(line);
    }

    const statements: string[] = [];
    statements.push(`const ${rootVar} = ${tmplId}();`);
    statements.push(...navigation);
    // One line cannot be shared with anything, and `group` would only add a
    // call for it to unwrap again.
    if (groupBindings && effectLines.length > 1) {
      statements.push(`${this.rt}.group(() => {\n${indent(effectLines.join('\n'), 2)}\n});`);
    } else {
      statements.push(...effectLines);
    }

    if (rootCount > 1) {
      // Capture top-level nodes before insertion moves them out of the fragment.
      const nodesVar = this.nextId('nodes');
      statements.push(`const ${nodesVar} = ${this.rt}.childNodes(${rootVar});`);
      statements.push(`return ${nodesVar};`);
    } else {
      statements.push(`return ${rootVar};`);
    }

    return {
      expression: `(() => {\n${indent(statements.join('\n'), 2)}\n})()`,
      rootCount: rootArity(template),
    };
  }

  /**
   * Walk one block's chunks and holes, writing bytes and values alternately.
   *
   * This is the whole of the server's markup path. There is no clone, so no
   * path to resolve, no marker to elide and no effect to create: a chunk is
   * printed, the hole after it writes its value, and the next chunk follows.
   * The chunks are the same strings `clientMarkup` joins, which is what makes
   * the static bytes identical without either emitter knowing about the other.
   */
  private emitServerBlock(block: Block): string {
    const { chunks, holes } = block.markup;
    const lines: string[] = [];
    let detached = 0;

    const runDetached = (before: number): void => {
      while (detached < block.serverDetached.length && block.serverDetached[detached]!.before <= before) {
        lines.push(...block.serverDetached[detached]!.lines);
        detached++;
      }
    };

    for (let i = 0; i <= holes.length; i++) {
      const text = i < holes.length ? omitRanges(chunks[i] ?? "", block.serverOmit[i] ?? null) : (chunks[i] ?? "");
      if (text) lines.push(`${this.out}.raw(${JSON.stringify(text)});`);
      runDetached(i);
      if (i < holes.length) lines.push(...block.serverHoles[i]!);
    }
    runDetached(holes.length + 1);

    return lines.join('\n');
  }

  /**
   * Emit the minimal `firstChild` / `nextSibling` chain reaching `path`,
   * reusing any already-resolved ancestor or preceding sibling.
   */
  private resolvePath(
    path: number[],
    resolved: Map<string, string>,
    out: string[],
  ): string {
    const key = path.join(',');
    const cached = resolved.get(key);
    if (cached) return cached;

    const last = path[path.length - 1]!;
    const parentPath = path.slice(0, -1);

    let base: string;
    let steps: string;

    // Prefer stepping from the previous sibling when it already has a name.
    const siblingKey = [...parentPath, last - 1].join(',');
    const sibling = last > 0 ? resolved.get(siblingKey) : undefined;
    if (sibling) {
      base = sibling;
      steps = '.nextSibling';
    } else {
      const parent = this.resolvePath(parentPath, resolved, out);
      base = parent;
      steps = '.firstChild' + '.nextSibling'.repeat(last);
    }

    const name = this.nextId('el');
    out.push(`const ${name} = ${base}${steps};`);
    resolved.set(key, name);
    return name;
  }

  // -------------------------------------------------------------------------
  // Building markup + effects
  // -------------------------------------------------------------------------

  private buildChildren(nodes: TemplateChildNode[], block: Block, ctx: PrintContext): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;

      // `:if` / `:else-if` / `:else` chains are consumed as a single unit.
      if (node.type === 'element' && findDirective(node, 'if')) {
        const chain: ElementNode[] = [node];
        let j = i + 1;
        while (j < nodes.length) {
          const next = nodes[j];
          if (next?.type === 'comment') {
            j++;
            continue;
          }
          if (
            next?.type === 'element' &&
            (findDirective(next, 'else-if') || findDirective(next, 'else'))
          ) {
            chain.push(next);
            j++;
            if (findDirective(next, 'else')) break;
            continue;
          }
          break;
        }
        i = j - 1;
        this.emitDynamicChild(block, this.genConditionalChain(chain, ctx));
        continue;
      }

      if (node.type === 'element' && findDirective(node, 'else-if')) {
        this.error('`:else-if` must directly follow an element with `:if`', node);
      }
      if (node.type === 'element' && findDirective(node, 'else')) {
        this.error('`:else` must directly follow an element with `:if` or `:else-if`', node);
      }

      if (node.type === 'element' && findDirective(node, 'for')) {
        this.emitDynamicChild(block, this.genFor(node, ctx));
        continue;
      }

      // A portalled element renders somewhere else entirely, so it leaves no
      // marker behind — nothing is ever inserted at this position.
      if (node.type === 'element' && findDirective(node, 'portal')) {
        this.emitDetachedChild(block, this.genPortal(node, ctx));
        continue;
      }

      this.buildNode(node, block, ctx);
    }
  }

  /**
   * Emit a statement that produces DOM somewhere other than here.
   *
   * Unlike `emitDynamicChild` this punches no marker and reserves no child
   * slot, because nothing is ever inserted at this position — the surrounding
   * markup must come out exactly as if the node had not been written.
   */
  private emitDetachedChild(block: Block, statement: string): void {
    this.stats.effects++;
    if (this.server) {
      block.detach([statement]);
      return;
    }
    block.effects.push(() => [statement]);
  }

  /** Punch a marker into the markup and insert a dynamic value at it. */
  private emitDynamicChild(block: Block, accessor: string): void {
    const index = block.addChild(false);
    const path = block.pathTo(index);
    const parentPath = block.currentPath();
    this.stats.effects++;
    if (this.server) {
      // The marker is a client-side anchor; the server has the position in
      // its hand already, because it is standing on it.
      block.hole({ kind: 'child', path }, accessor ? [accessor] : []);
      return;
    }
    block.hole({ kind: 'child', path });
    block.effects.push((resolve) => {
      const marker = resolve(path);
      const parent = parentPath.length === 0 ? null : resolve(parentPath);
      return [
        `${this.rt}.insert(${parent ?? `${marker}.parentNode`}, ${accessor}, ${marker});`,
      ];
    });
  }

  private buildNode(node: TemplateChildNode, block: Block, ctx: PrintContext): void {
    switch (node.type) {
      case 'text': {
        if (!node.content) return;
        block.addChild(true);
        block.markup.push(escapeHtmlText(node.content));
        this.stats.staticNodes++;
        return;
      }

      case 'comment': {
        block.addChild(false);
        block.markup.push(`<!--${node.content}-->`);
        return;
      }

      case 'interpolation': {
        const parsed = this.parse(node.exp, node.loc);
        // A constant interpolation is just text — bake it into the markup.
        if (isStaticExpression(parsed)) {
          const value = evaluateStatic(parsed);
          block.addChild(true);
          block.markup.push(escapeHtmlText(toDisplayString(value)));
          this.stats.foldedBindings++;
          return;
        }
        const index = block.addChild(false);
        const path = block.pathTo(index);
        const parentPath = block.currentPath();
        this.stats.effects++;
        if (this.server) {
          block.hole({ kind: 'child', path }, [
            `${this.out}.child(${printExpression(parsed, ctx, 1)});`,
          ]);
          return;
        }
        const accessor = this.genInterpolationAccessor(node.exp, ctx, node);
        block.hole({ kind: 'child', path });
        block.effects.push((resolve) => {
          const marker = resolve(path);
          const parent = parentPath.length === 0 ? `${marker}.parentNode` : resolve(parentPath);
          return [`${this.rt}.insert(${parent}, ${accessor}, ${marker});`];
        });
        return;
      }

      case 'slot-outlet': {
        this.emitDynamicChild(block, this.genSlotOutlet(node, ctx));
        return;
      }

      case 'element': {
        if (node.isComponent) {
          this.emitDynamicChild(block, this.genComponent(node, ctx));
          return;
        }
        if (node.isTemplate) {
          // A grouping `<template>` contributes children but no element.
          this.buildChildren(node.children, block, ctx);
          return;
        }
        this.buildElement(node, block, ctx);
        return;
      }
    }
  }

  private buildElement(node: ElementNode, block: Block, ctx: PrintContext): void {
    const tag = node.tag;
    const isSvg = SVG_TAGS.has(tag);
    if (isSvg && tag === 'svg') block.isSvg = true;

    const index = block.addChild(false);
    const selfPath = block.pathTo(index);

    const staticAttrs = new Map<string, string | true>();
    for (const attr of node.attrs) {
      staticAttrs.set(attr.name, attr.value === null ? true : attr.value);
    }

    const dynamic: DirectiveNode[] = [];

    // Pass 1 — fold every provably-constant binding into the markup so it
    // costs nothing at runtime.
    for (const dir of node.directives) {
      if (dir.kind === 'key' || dir.kind === 'slot') continue;

      if ((dir.kind === 'prop' || dir.kind === 'attr' || dir.kind === 'class') && dir.exp) {
        const parsed = this.parse(dir.exp, dir.loc);
        if (isStaticExpression(parsed)) {
          const value = evaluateStatic(parsed);
          const name = dir.kind === 'class' ? 'class' : dir.name;

          if (dir.kind === 'class') {
            const cls = normalizeClassValue(value);
            if (cls) mergeStaticClass(staticAttrs, cls);
            this.stats.foldedBindings++;
            continue;
          }
          if (BOOLEAN_ATTRIBUTES.has(name)) {
            if (value) staticAttrs.set(name, '');
            else staticAttrs.delete(name);
            this.stats.foldedBindings++;
            continue;
          }
          if (value === false || value === null || value === undefined) {
            staticAttrs.delete(name);
            this.stats.foldedBindings++;
            continue;
          }
          staticAttrs.set(name, String(value));
          this.stats.foldedBindings++;
          continue;
        }
      }

      if (dir.kind === 'style' && dir.exp) {
        const parsed = this.parse(dir.exp, dir.loc);
        if (isStaticExpression(parsed)) {
          const style = normalizeStyleValue(evaluateStatic(parsed));
          if (style) {
            const existing = staticAttrs.get('style');
            staticAttrs.set(
              'style',
              typeof existing === 'string' ? `${existing};${style}` : style,
            );
          }
          this.stats.foldedBindings++;
          continue;
        }
      }

      dynamic.push(dir);
    }

    // A folded `class` or `style` beside a dynamic one is written once, by the
    // merge, because a tag carries one of each and a parser keeps the first.
    const merged = this.server
      ? new Set(
          dynamic.flatMap((d) =>
            d.kind === 'class'
              ? ['class']
              : d.kind === 'style'
                ? ['style']
                : d.kind === 'spread'
                  ? ['class', 'style']
                  : [],
          ),
        )
      : null;
    const chunkStart = block.markup.chunks[block.markup.chunks.length - 1]!.length;
    const omit: [number, number][] = [];
    const folded = new Map<string, string>();

    // Emit the open tag with all folded attributes baked in.
    let open = `<${tag}`;
    for (const [name, value] of staticAttrs) {
      const at = open.length;
      open += value === true ? ` ${name}` : ` ${name}="${escapeHtmlAttr(value)}"`;
      if (merged?.has(name) && typeof value === 'string') {
        omit.push([chunkStart + at, chunkStart + open.length]);
        folded.set(name, value);
      }
    }
    block.markup.push(open);
    // A server prints these between the folded attributes and the `>`; the
    // client sets them on the clone, so the hole is zero-width. Listeners and
    // `:ref` attach behaviour and print nothing, so they open no hole.
    if (dynamic.some((d) => ATTRIBUTE_POSITION[d.kind])) {
      block.hole(
        { kind: 'attribute', path: selfPath, tag },
        this.server ? this.genServerAttributes(node, dynamic, folded, ctx) : [],
        omit.length ? omit : null,
      );
    }
    block.markup.push('>');

    if (dynamic.length) {
      if (!this.server) {
        for (const dir of dynamic) {
          this.emitDirective(dir, node, selfPath, block, ctx);
        }
      }
    } else {
      this.stats.staticNodes++;
    }

    const isVoid = VOID_TAGS.has(tag.toLowerCase());
    if (!isVoid) {
      const contentDir = node.directives.find((d) => d.kind === 'text' || d.kind === 'html');
      if (contentDir) {
        // The binding owns everything between the tags, so the children the
        // author wrote are never emitted at all.
        block.hole(
          { kind: 'content', path: selfPath, tag },
          this.server ? [this.genServerContent(contentDir, tag, ctx)] : [],
        );
      } else if (
        !this.tryTextOnlyChildren(node, block, selfPath, ctx) &&
        !this.trySingleDynamicChild(node, block, selfPath, ctx)
      ) {
        block.enter(index);
        this.buildChildren(node.children, block, ctx);
        block.exit();
      }
      block.markup.push(`</${tag}>`);
    }
  }

  /**
   * What a server writes between the last folded attribute and the `>`.
   *
   * The only genuinely server-specific serialization there is: everything
   * static came out of the shared chunk, and everything structural is a hole
   * of its own. `class` and `style` are the two attributes an element can
   * carry once and be given twice, so both halves are composed here into the
   * one value the tag has room for; every other binding writes its own
   * attribute under the name it was authored with, which is already the
   * attribute spelling — the compiler is what maps an attribute to a property
   * on the client, so reversing it is a matter of not doing that.
   */
  private genServerAttributes(
    node: ElementNode,
    dynamic: DirectiveNode[],
    folded: Map<string, string>,
    ctx: PrintContext,
  ): string[] {
    const lines: string[] = [];
    // Empty rather than `""`, so a row that only ever toggles one class emits
    // the conditional alone: no concatenation, and nothing allocated when the
    // condition is false.
    const staticClass = folded.get('class') ?? '';
    const classParts: string[] = staticClass ? [JSON.stringify(staticClass)] : [];
    let styleExpr = JSON.stringify(folded.get('style') ?? '');
    let hasClass = false;
    let hasStyle = false;
    let spread: string | null = null;

    for (const dir of dynamic) {
      switch (dir.kind) {
        case 'class': {
          hasClass = true;
          const toggles = this.genClassToggles(dir.exp!, ctx, dir.loc);
          if (toggles) {
            // The same analysis the client compiles to `classList.toggle`,
            // which here is a conditional yielding a literal: no object is
            // allocated for a row that only ever adds one class.
            for (const [name, expression] of toggles) {
              classParts.push(`(${expression} ? ${JSON.stringify(' ' + name)} : '')`);
            }
          } else {
            classParts.push(`' ' + ${this.rt}.classText(${this.genValue(dir.exp!, ctx, dir.loc)})`);
          }
          break;
        }
        case 'style': {
          hasStyle = true;
          styleExpr = `${this.rt}.styleText(${styleExpr}, ${this.genValue(dir.exp!, ctx, dir.loc)})`;
          break;
        }
        case 'attr': {
          lines.push(
            `${this.out}.attr(${JSON.stringify(dir.name)}, ${this.genValue(dir.exp!, ctx, dir.loc)});`,
          );
          break;
        }
        case 'prop': {
          const value = this.genValue(dir.exp!, ctx, dir.loc);
          const method = BOOLEAN_ATTRIBUTES.has(dir.name) ? 'boolAttr' : 'attr';
          lines.push(`${this.out}.${method}(${JSON.stringify(dir.name)}, ${value});`);
          break;
        }
        case 'model': {
          const staticValue = node.attrs.find((a) => a.name === 'value')?.value ?? null;
          lines.push(
            `${this.out}.model(${JSON.stringify(modelKind(node))}, ` +
              `${JSON.stringify(node.tag.toLowerCase())}, ` +
              `${this.genValue(dir.exp!, ctx, dir.loc)}, ${JSON.stringify(staticValue)});`,
          );
          break;
        }
        case 'spread': {
          hasClass = true;
          hasStyle = true;
          spread = this.genValue(dir.exp!, ctx, dir.loc);
          break;
        }
        default:
          // A listener and a `:ref` attach behaviour to a node a server has
          // not got. The same bytes with or without them.
          break;
      }
    }

    const classExpr = classParts.length ? classParts.join(' + ') : "''";
    if (spread !== null) {
      // One call, because a spread can carry `class` and `style` too and they
      // have to reach the same attribute the directives above composed.
      lines.push(`${this.out}.spread(${spread}, ${classExpr}, ${styleExpr});`);
      return lines;
    }
    if (hasClass) lines.push(`${this.out}.classAttr(${classExpr});`);
    if (hasStyle) lines.push(`${this.out}.styleAttr(${styleExpr});`);
    return lines;
  }

  /** What a server writes between the tags when a binding owns all of it. */
  private genServerContent(dir: DirectiveNode, tag: string, ctx: PrintContext): string {
    const value = this.genValue(dir.exp!, ctx, dir.loc);
    if (dir.kind === 'html') return `${this.out}.html(${value});`;
    // `<script>` and `<style>` hold raw text: an entity there is not decoded,
    // so escaping would be written through to the page as `&amp;`.
    if (RAW_TEXT_TAGS.has(tag.toLowerCase())) {
      return `${this.out}.rawText(${JSON.stringify(tag.toLowerCase())}, ${value});`;
    }
    return `${this.out}.text(${value});`;
  }

  /**
   * An element whose only child is dynamic needs no marker.
   *
   * The binding owns the element's entire content, so it can insert without an
   * anchor — which keeps a stray `<!---->` out of the DOM for the very common
   * `<ul>` wrapping a single `:for`, or a `<div>` wrapping a single `:if`.
   */
  private trySingleDynamicChild(
    node: ElementNode,
    block: Block,
    selfPath: number[],
    ctx: PrintContext,
  ): boolean {
    const children = node.children.filter(
      (c) => c.type !== 'comment' && !(c.type === 'text' && !c.content.trim()),
    );
    if (children.length !== 1) return false;

    const only = children[0]!;
    // A portalled child contributes nothing at this position, so there is
    // nothing to insert here and this path does not apply. Without this it
    // would take the component branch below and the portal would be dropped.
    if (only.type === 'element' && findDirective(only, 'portal')) return false;

    const isDynamic =
      only.type === 'slot-outlet' ||
      (only.type === 'element' &&
        (only.isComponent ||
          only.isTemplate ||
          findDirective(only, 'if') !== undefined ||
          findDirective(only, 'for') !== undefined));
    if (!isDynamic) return false;

    const accessor = this.genChildrenExpression([only], ctx);
    this.stats.effects++;
    if (this.server) {
      block.hole({ kind: 'content', path: selfPath, tag: node.tag }, [accessor]);
      return true;
    }
    block.hole({ kind: 'content', path: selfPath, tag: node.tag });
    block.effects.push((resolve) => [
      `${this.rt}.insert(${resolve(selfPath)}, ${accessor});`,
    ]);
    return true;
  }

  /**
   * When an element's children are only text and interpolations, compile them
   * to a single text binding instead of one marker per hole.
   *
   * `<p>Hi, { a }! You have { b }.</p>` becomes one effect writing one
   * text node — no comment markers in the output, and no per-hole insert.
   * Returns false when the children contain anything structural.
   */
  private tryTextOnlyChildren(
    node: ElementNode,
    block: Block,
    selfPath: number[],
    ctx: PrintContext,
  ): boolean {
    const children = node.children.filter((c) => c.type !== 'comment');
    if (children.length === 0) return false;

    const allText = children.every((c) => c.type === 'text' || c.type === 'interpolation');
    if (!allText) return false;

    const dynamic = children.filter((c) => c.type === 'interpolation');
    // All-static children belong in the markup, which the normal path does.
    if (dynamic.length === 0) return false;

    const parts: string[] = [];
    let sawDynamic = false;

    for (const child of children) {
      if (child.type === 'text') {
        if (child.content) parts.push(JSON.stringify(child.content));
        continue;
      }
      const parsed = this.parse(child.exp, child.loc);
      if (isStaticExpression(parsed)) {
        this.stats.foldedBindings++;
        parts.push(JSON.stringify(toDisplayString(evaluateStatic(parsed))));
        continue;
      }
      sawDynamic = true;
      parts.push(`${this.rt}.toDisplayString(${printExpression(parsed, ctx, 1)})`);
    }

    if (!sawDynamic) {
      // Every hole folded to a constant — emit it as static markup.
      const literal = parts
        .map((p) => JSON.parse(p) as string)
        .join('');
      block.markup.push(escapeHtmlText(literal));
      return true;
    }

    // A lone dynamic part needs no concatenation.
    const expression = parts.length === 1 ? parts[0]! : parts.join(' + ');

    this.stats.effects++;
    if (this.server) {
      block.hole({ kind: 'content', path: selfPath, tag: node.tag }, [
        RAW_TEXT_TAGS.has(node.tag.toLowerCase())
          ? `${this.out}.rawText(${JSON.stringify(node.tag.toLowerCase())}, ${expression});`
          : `${this.out}.text(${expression});`,
      ]);
      return true;
    }
    block.hole({ kind: 'content', path: selfPath, tag: node.tag });
    block.effects.push((resolve) => [
      `${this.rt}.bindText(${resolve(selfPath)}, ${this.thunk(expression)});`,
    ]);
    return true;
  }

  // -------------------------------------------------------------------------
  // Directives
  // -------------------------------------------------------------------------

  private emitDirective(
    dir: DirectiveNode,
    node: ElementNode,
    path: number[],
    block: Block,
    ctx: PrintContext,
  ): void {
    const push = (fn: (el: string) => string[]): void => {
      this.stats.effects++;
      block.effects.push((resolve) => fn(resolve(path)));
    };

    switch (dir.kind) {
      case 'event': {
        const { handler, options } = this.genEventHandler(dir, ctx);
        // Listener options (capture/once/passive) need a real listener on the
        // element; everything else can share one document-level listener.
        // Both sets, not one. Keeping them disjoint by hand worked only while
        // somebody remembered to, and a name in NEVER_DELEGATED that is also
        // delegated is the silent-preventDefault bug returning.
        const canDelegate =
          options === null && DELEGATED_EVENTS.has(dir.name) && !NEVER_DELEGATED.has(dir.name);
        if (canDelegate) {
          this.stats.delegatedEvents++;
          this.delegatedEventNames.add(dir.name);
          push((el) => [
            `${this.rt}.delegate(${el}, ${JSON.stringify(dir.name)}, ${handler});`,
          ]);
        } else {
          push((el) => [
            `${this.rt}.on(${el}, ${JSON.stringify(dir.name)}, ${handler}${options ? `, ${options}` : ''});`,
          ]);
        }
        return;
      }

      case 'class': {
        const toggles = this.genClassToggles(dir.exp!, ctx, dir.loc);
        if (toggles) {
          for (const [name, expression] of toggles) {
            const accessor = this.thunk(expression);
            push((el) => [
              `${this.rt}.bindClassToggle(${el}, ${JSON.stringify(name)}, ${accessor});`,
            ]);
          }
          return;
        }
        const accessor = this.genAccessor(dir.exp!, ctx, dir.loc);
        push((el) => [`${this.rt}.bindClass(${el}, ${accessor});`]);
        return;
      }

      case 'style': {
        const accessor = this.genAccessor(dir.exp!, ctx, dir.loc);
        push((el) => [`${this.rt}.bindStyle(${el}, ${accessor});`]);
        return;
      }

      case 'attr': {
        const accessor = this.genAccessor(dir.exp!, ctx, dir.loc);
        push((el) => [
          `${this.rt}.bindAttr(${el}, ${JSON.stringify(dir.name)}, ${accessor});`,
        ]);
        return;
      }

      case 'prop': {
        const accessor = this.genAccessor(dir.exp!, ctx, dir.loc);
        const name = dir.name;
        // Decide prop-vs-attribute at build time wherever the DOM allows it.
        if (MUST_USE_ATTRIBUTE.has(name)) {
          push((el) => [
            `${this.rt}.bindAttr(${el}, ${JSON.stringify(name)}, ${accessor});`,
          ]);
        } else if (BOOLEAN_ATTRIBUTES.has(name)) {
          const prop = ATTR_TO_PROP[name] ?? name;
          push((el) => [
            `${this.rt}.bindProp(${el}, ${JSON.stringify(prop)}, ${accessor});`,
          ]);
        } else {
          push((el) => [
            `${this.rt}.bindDynamic(${el}, ${JSON.stringify(name)}, ${accessor});`,
          ]);
        }
        return;
      }

      case 'text': {
        const accessor = this.genAccessor(dir.exp!, ctx, dir.loc);
        push((el) => [`${this.rt}.bindText(${el}, ${accessor});`]);
        return;
      }

      case 'html': {
        const accessor = this.genAccessor(dir.exp!, ctx, dir.loc);
        push((el) => [`${this.rt}.bindHtml(${el}, ${accessor});`]);
        return;
      }

      case 'ref': {
        const exp = dir.exp!;
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exp)) {
          this.error('`:ref` takes a plain property name, e.g. `:ref="inputEl"`', dir);
        }
        push((el) => [
          `${this.rt}.setRef(${el}, ${this.ctxName}, ${JSON.stringify(exp)});`,
        ]);
        return;
      }

      case 'model': {
        const kind = modelKind(node);
        const target = this.genAccessor(dir.exp!, ctx, dir.loc);
        const setter = this.genModelSetter(dir.exp!, ctx, dir);
        const modifiers = JSON.stringify({
          number: dir.modifiers.includes('number'),
          trim: dir.modifiers.includes('trim'),
          lazy: dir.modifiers.includes('lazy'),
        });
        push((el) => [
          `${this.rt}.model(${el}, ${JSON.stringify(kind)}, ${target}, ${setter}, ${modifiers});`,
        ]);
        return;
      }

      case 'spread': {
        const accessor = this.genAccessor(dir.exp!, ctx, dir.loc);
        push((el) => [`${this.rt}.spread(${el}, ${accessor});`]);
        return;
      }

      default:
        return;
    }
  }

  private genEventHandler(
    dir: DirectiveNode,
    ctx: PrintContext,
  ): { handler: string; options: string | null } {
    const exp = dir.exp;
    if (!exp) this.error(`\`${dir.rawName}\` requires a handler expression`, dir);

    const parsed = this.parse(exp, dir.loc);
    // A bare reference or arrow is already a function; anything else is an
    // inline statement and gets wrapped so `$event` is available.
    const isFunctionValue =
      parsed.type === 'Identifier' || parsed.type === 'Member' || parsed.type === 'Arrow';

    let handler = isFunctionValue
      ? printExpression(parsed, ctx)
      : this.thunk(printExpression(parsed, ctx, 1), '$event');

    const guards = dir.modifiers.filter((m) => EVENT_GUARD_MODIFIERS.has(m));
    const systems = dir.modifiers.filter((m) => SYSTEM_MODIFIERS.has(m));
    const keys = dir.modifiers
      .filter((m) => KEY_MODIFIERS[m] !== undefined)
      .map((m) => KEY_MODIFIERS[m]!);
    const optionMods = dir.modifiers.filter((m) => EVENT_OPTION_MODIFIERS.has(m));

    const unknown = dir.modifiers.filter(
      (m) =>
        !EVENT_GUARD_MODIFIERS.has(m) &&
        !SYSTEM_MODIFIERS.has(m) &&
        KEY_MODIFIERS[m] === undefined &&
        !EVENT_OPTION_MODIFIERS.has(m),
    );
    if (unknown.length) {
      this.error(`Unknown event modifier \`.${unknown[0]}\` on \`${dir.rawName}\``, dir);
    }

    if (guards.length || systems.length || keys.length) {
      const config = JSON.stringify({
        stop: guards.includes('stop'),
        prevent: guards.includes('prevent'),
        self: guards.includes('self'),
        system: systems,
        keys,
      });
      handler = `${this.rt}.guard(${handler}, ${config})`;
    }

    const options = optionMods.length
      ? JSON.stringify({
          capture: optionMods.includes('capture'),
          once: optionMods.includes('once'),
          passive: optionMods.includes('passive'),
        })
      : null;

    return { handler, options };
  }

  private genModelSetter(exp: string, ctx: PrintContext, dir: DirectiveNode): string {
    const parsed = this.parse(exp, dir.loc);
    if (parsed.type !== 'Identifier' && parsed.type !== 'Member') {
      this.error('`:model` needs a signal or assignable property, e.g. `:model="name"`', dir);
    }
    const target = printExpression(parsed, ctx);
    return `(_v) => ${this.rt}.writeModel(${target}, _v, () => { ${target} = _v; })`;
  }

  // -------------------------------------------------------------------------
  // Structural constructs
  // -------------------------------------------------------------------------

  private genInterpolationAccessor(
    exp: string,
    ctx: PrintContext,
    node: { loc: { line: number; column: number } },
  ): string {
    let parsed: ExprNode;
    try {
      parsed = this.parse(exp, node.loc);
    } catch (err) {
      this.error((err as Error).message, node);
    }
    if (isStaticExpression(parsed)) {
      this.stats.foldedBindings++;
      return JSON.stringify(toDisplayString(evaluateStatic(parsed)));
    }
    return this.thunk(printExpression(parsed, ctx, 1));
  }

  /**
   * Split `:class="{ a: x, b: y }"` into one toggle per class.
   *
   * The general binding has to allocate the object, normalise it to a list,
   * and ask the element what it already has. When the keys are written
   * literally — nearly always — each class is really an independent boolean,
   * and compiling it that way means an update compares a boolean and usually
   * touches nothing.
   *
   * Returns null for any shape where the set of class names is not known
   * here: a string, an array, a spread, or a computed key. Those keep the
   * general binding, which stays correct for everything.
   *
   * The expressions come back unwrapped, because the two emitters want
   * different things around them: a client binding re-runs and so takes an
   * accessor, and a server reads each one once.
   */
  private genClassToggles(
    exp: string,
    ctx: PrintContext,
    loc: { line: number; column: number },
  ): [string, string][] | null {
    let parsed;
    try {
      parsed = this.parse(exp, loc);
    } catch {
      return null;
    }
    if (parsed.type !== 'Object' || parsed.properties.length === 0) return null;

    const toggles: [string, string][] = [];
    for (const prop of parsed.properties) {
      if (prop.type !== 'Property' || prop.computed) return null;

      const key = prop.key;
      let name: string;
      if (key.type === 'Identifier') name = key.name;
      else if (key.type === 'Literal' && typeof key.value === 'string') name = key.value;
      else return null;

      // A name with whitespace would be several classes, which `classList`
      // cannot toggle as one token.
      if (name === '' || /\s/.test(name)) return null;

      toggles.push([name, printExpression(prop.value, ctx, 1)]);
    }

    // Two properties writing the same class would race, and which one wins
    // would depend on effect ordering rather than on the object's semantics.
    const names = new Set(toggles.map(([name]) => name));
    if (names.size !== toggles.length) return null;

    this.stats.classToggles += toggles.length;
    return toggles;
  }

  private genAccessor(
    exp: string,
    ctx: PrintContext,
    loc: { line: number; column: number },
  ): string {
    const parsed = this.parse(exp, loc);
    if (isStaticExpression(parsed)) {
      return JSON.stringify(evaluateStatic(parsed));
    }
    return this.thunk(printExpression(parsed, ctx, 1));
  }

  /**
   * The same value, read once instead of wrapped in a thunk.
   *
   * A client binding is handed an accessor because it re-runs; a server reads
   * every value exactly once, on the single pass that writes the bytes, so a
   * closure per binding would be allocation with nothing to show for it.
   */
  private genValue(
    exp: string,
    ctx: PrintContext,
    loc: { line: number; column: number },
  ): string {
    const parsed = this.parse(exp, loc);
    if (isStaticExpression(parsed)) return JSON.stringify(evaluateStatic(parsed));
    return printExpression(parsed, ctx, 1);
  }

  /** As `genValue`, but a constant folds to what it displays as. */
  private genInterpolationValue(
    exp: string,
    ctx: PrintContext,
    node: { loc: { line: number; column: number } },
  ): string {
    let parsed: ExprNode;
    try {
      parsed = this.parse(exp, node.loc);
    } catch (err) {
      this.error((err as Error).message, node);
    }
    if (isStaticExpression(parsed)) {
      this.stats.foldedBindings++;
      return JSON.stringify(toDisplayString(evaluateStatic(parsed)));
    }
    return printExpression(parsed, ctx, 1);
  }

  /**
   * The whole `:if` / `:else-if` / `:else` chain becomes one `branch` call.
   * Conditions are tested in order and short-circuit, and only the winning
   * branch's body is ever built — a nested-ternary encoding would construct
   * every arm eagerly.
   */
  /**
   * `:portal` — render this element into a different container.
   *
   * With no virtual DOM, a portal is simply a node put somewhere else, so
   * there is nothing to reconcile across trees. Context and disposal both
   * follow the reactive scope rather than the DOM, so a portalled dialog still
   * sees the providers it was declared under and is still torn down with the
   * component that declared it.
   *
   * The target is read once. Re-homing live content on a changing target is
   * not something a dialog or tooltip needs, and pretending to support it
   * would cost a marker and a move path on every portal.
   */
  private genPortal(node: ElementNode, ctx: PrintContext): string {
    const dir = findDirective(node, 'portal')!;
    const stripped = stripDirectives(node, ['portal']);

    // Default to the document body, which is what an overlay almost always
    // wants and saves every call site writing it out.
    const target = this.server
      ? dir.exp
        ? this.genValue(dir.exp, ctx, dir.loc)
        : 'null'
      : dir.exp
        ? this.genAccessor(dir.exp, ctx, dir.loc)
        : 'null';
    const body = this.inConditional(() =>
      stripped.isTemplate
        ? this.genChildrenExpression(stripped.children, ctx)
        : this.genChildrenExpression([stripped], ctx),
    );
    if (this.server) {
      // The writer is one object for the whole render, so the body needs no
      // parameter: `portal` moves where that writer is pointing for the span
      // of the call and puts it back afterwards.
      return `${this.rt}.portal(${this.out}, ${target}, () => {\n${indent(body, 2)}\n});`;
    }
    return `${this.rt}.portal(${target}, ${this.thunk(body)});`;
  }

  private genConditionalChain(chain: ElementNode[], ctx: PrintContext): string {
    if (this.server) {
      // Plain control flow, because only the winning arm is ever written and
      // nothing has to be rebuilt when the condition changes. `branch` exists
      // to dispose the previous arm's effects; a server has no previous arm.
      const parts: string[] = [];
      for (const node of chain) {
        const body = indent(this.genBranchBody(node, ctx), 2);
        if (findDirective(node, 'else')) {
          parts.push(`else {\n${body}\n}`);
          continue;
        }
        const dir = findDirective(node, 'if') ?? findDirective(node, 'else-if')!;
        const condition = printExpression(this.parse(dir.exp!, dir.loc), ctx, 1);
        parts.push(`${parts.length ? 'else ' : ''}if (${condition}) {\n${body}\n}`);
      }
      return parts.join(' ');
    }
    const entries = chain.map((node) => {
      const body = this.thunk(this.genBranchBody(node, ctx));
      if (findDirective(node, 'else')) return `[null, ${body}]`;
      const dir = findDirective(node, 'if') ?? findDirective(node, 'else-if')!;
      const condition = this.thunk(printExpression(this.parse(dir.exp!, dir.loc), ctx, 1));
      return `[${condition}, ${body}]`;
    });
    return `${this.rt}.branch([${entries.join(', ')}])`;
  }

  /** Render one branch of a conditional without re-triggering its own `:if`. */
  private genBranchBody(node: ElementNode, ctx: PrintContext): string {
    return this.inConditional(() => this.genBranchBodyInner(node, ctx));
  }

  private genBranchBodyInner(node: ElementNode, ctx: PrintContext): string {
    const stripped = stripDirectives(node, ['if', 'else-if', 'else']);
    if (findDirective(stripped, 'for')) {
      return this.genFor(stripped, ctx);
    }
    // `<div :if="open" :portal>` — the condition decides whether the portal
    // exists at all, and the portal decides where its content lands. The
    // branch itself contributes nothing to the tree it was declared in.
    if (findDirective(stripped, 'portal')) {
      const portal = this.genPortal(stripped, ctx);
      return this.server ? portal : `(${portal.replace(/;$/, '')}, null)`;
    }
    if (stripped.isTemplate) {
      return this.genChildrenExpression(stripped.children, ctx);
    }
    return this.genChildrenExpression([stripped], ctx);
  }

  /**
   * `:for` rows receive their item and index as accessors, and the printer
   * appends the call. That is what lets a keyed row survive a move or a
   * re-supplied item object without being torn down and rebuilt — the row's
   * own bindings re-run, the DOM does not.
   */
  private genFor(node: ElementNode, ctx: PrintContext): string {
    const dir = findDirective(node, 'for')!;

    let parsed;
    try {
      parsed = parseForExpression(dir.exp!);
    } catch (err) {
      // The expression parser cannot know what it was parsing; say so here.
      this.error(
        `\`:for="${dir.exp}"\` is not a loop.\n` +
          '  It reads as `:for="item in items()"`, optionally with an index:\n' +
          '  `:for="(item, i) in items()"`.\n' +
          `  ${(err as Error).message}`,
        dir,
      );
    }
    // `parseForExpression` bypasses the wrapper, so the iterable's own
    // expression would otherwise be the one place a `t('key')` went unseen.
    this.noteMessages(parsed.source, dir.loc, dir.exp!);

    const keyDir = findDirective(node, 'key');

    // `:key` is mandatory. Neither possible default is safe — keying by
    // position strands DOM state on the wrong row after a reorder, and keying
    // by object identity rebuilds the whole list when data is refetched — so
    // the choice is the author's to make, every time.
    if (!keyDir?.exp) {
      this.error(
        '`:for` requires `:key`.\n' +
          '  Use `:key="item.id"` for a stable identity that survives the item\n' +
          '  object being replaced, or `:key="$index"` if this list is never\n' +
          '  reordered and positional reuse is what you want.',
        dir,
      );
    }

    const listExpression = printExpression(parsed.source, ctx, 1);
    const listAccessor = this.thunk(listExpression);
    const stripped = stripDirectives(node, ['for', 'key']);
    const indexParam = parsed.index ?? this.nextId('idx');

    // Reserved before the body is generated, so a nested `:for` is recorded
    // after the one containing it rather than before.
    const rowSlot = this.rowRootCounts.length;
    this.rowRootCounts.push(null);

    const genBody = (): string => {
      this.groupNextBlock = this.groupRowBindings;
      const row = stripped.isTemplate
        ? this.genChildren(stripped.children, ctx)
        : this.genChildren([stripped], ctx);
      this.groupNextBlock = false;
      this.rowRootCounts[rowSlot] = row.rootCount;
      return row.expression;
    };

    if (this.server) {
      // A loop, not a reconciler. Rows are written once and never revisited,
      // so there is no key to compute, no row to keep and no signal to update:
      // what a row costs on a server is the bytes it prints.
      const listVar = this.nextId('list');
      const i = this.nextId('i');
      const declarations: string[] = [];
      let body: string;

      if (parsed.item.type === 'IdentifierPattern') {
        const itemName = parsed.item.name;
        declarations.push(`const ${itemName} = ${listVar}[${i}];`);
        body = withScope(ctx, [itemName, indexParam], genBody);
      } else {
        const itemVar = this.nextId('item');
        declarations.push(`const ${itemVar} = ${listVar}[${i}];`);
        const names: string[] = [];
        this.genPatternValues(parsed.item, itemVar, declarations, names);
        body = withScope(ctx, [...names, indexParam], genBody);
      }
      // Only when the loop named one: an index nobody can write cannot be read.
      if (parsed.index) declarations.push(`const ${parsed.index} = ${i};`);

      const inner = indent([...declarations, body].join('\n'), 2);
      return (
        `{\n` +
        `  const ${listVar} = ${this.rt}.items(${listExpression});\n` +
        `  for (let ${i} = 0; ${i} < ${listVar}.length; ${i}++) {\n` +
        `${indent(inner, 2)}\n` +
        `  }\n` +
        `}`
      );
    }

    let rowFn: string;

    if (parsed.item.type === 'IdentifierPattern') {
      const itemName = parsed.item.name;
      const body = withScope(ctx, [itemName, indexParam], genBody, true);
      rowFn = this.thunk(body, `${itemName}, ${indexParam}`);
    } else {
      // Destructuring: rebuild each bound name as its own accessor so the
      // fields stay reactive rather than being snapshotted at row creation.
      const itemVar = this.nextId('item');
      const lines: string[] = [];
      const names: string[] = [];
      this.genPatternAccessors(parsed.item, `${itemVar}()`, lines, names);
      const body = withScope(ctx, [...names, indexParam], genBody, true);
      lines.push(`return ${body};`);
      rowFn = `(${itemVar}, ${indexParam}) => {\n${indent(lines.join('\n'), 2)}\n}`;
    }

    // The key function sees raw values, so its scope is plain — no auto-call.
    const keyNames = patternNames(parsed.item);
    if (parsed.index) keyNames.push(parsed.index);

    const keyFn = withScope(ctx, keyNames, () => {
      const itemParam = printPattern(parsed.item, ctx);
      const expression = printExpression(this.parse(keyDir.exp!, keyDir.loc), ctx, 1);

      // `$index` is always the second parameter, so `:key="$index"` works
      // whether or not the loop declared an index name of its own.
      if (parsed.index) {
        return `(${itemParam}, $index) => { const ${parsed.index} = $index; return (${expression}); }`;
      }
      return this.thunk(expression, `${itemParam}, $index`);
    });

    return `${this.rt}.each(${listAccessor}, ${rowFn}, ${keyFn})`;
  }

  /**
   * The same names bound to values rather than to accessors.
   *
   * A client row keeps its bindings reactive across an item being replaced in
   * place, which is what the accessors are for. A server row is written once
   * from one item, so a closure per bound name would be allocation with
   * nothing to observe it.
   */
  private genPatternValues(
    pattern: PatternNode,
    source: string,
    out: string[],
    names: string[],
  ): void {
    switch (pattern.type) {
      case 'IdentifierPattern': {
        out.push(`const ${pattern.name} = ${source};`);
        names.push(pattern.name);
        return;
      }

      case 'ObjectPattern': {
        for (const prop of pattern.properties) {
          const access = isSafeIdentifier(prop.key)
            ? `(${source})?.${prop.key}`
            : `(${source})?.[${JSON.stringify(prop.key)}]`;
          this.genPatternValues(prop.value, access, out, names);
        }
        if (pattern.rest) {
          const keys = JSON.stringify(pattern.properties.map((p) => p.key));
          out.push(`const ${pattern.rest} = ${this.rt}.omit(${source}, ${keys});`);
          names.push(pattern.rest);
        }
        return;
      }

      case 'ArrayPattern': {
        for (let i = 0; i < pattern.elements.length; i++) {
          const element = pattern.elements[i];
          if (!element) continue;
          if (element.type === 'RestPattern') {
            const target = element.argument;
            if (target.type !== 'IdentifierPattern') {
              throw new CompilerError('`...rest` in `:for` must bind a plain name', {
                line: 0,
                column: 0,
              });
            }
            out.push(`const ${target.name} = (${source})?.slice(${i}) ?? [];`);
            names.push(target.name);
            continue;
          }
          this.genPatternValues(element, `(${source})?.[${i}]`, out, names);
        }
        return;
      }

      case 'AssignmentPattern': {
        const ctxForDefault = createPrintContext(this.ctxName);
        const fallback = printExpression(pattern.right, ctxForDefault, 1);
        this.genPatternValues(
          pattern.left,
          `${this.rt}.withDefault(${source}, () => ${fallback})`,
          out,
          names,
        );
        return;
      }

      case 'RestPattern': {
        this.genPatternValues(pattern.argument, source, out, names);
        return;
      }
    }
  }

  /** Emit `const name = () => <path>` accessors for a destructuring pattern. */
  private genPatternAccessors(
    pattern: PatternNode,
    source: string,
    out: string[],
    names: string[],
  ): void {
    switch (pattern.type) {
      case 'IdentifierPattern': {
        out.push(`const ${pattern.name} = ${this.thunk(source)};`);
        names.push(pattern.name);
        return;
      }

      case 'ObjectPattern': {
        for (const prop of pattern.properties) {
          const access = isSafeIdentifier(prop.key)
            ? `(${source})?.${prop.key}`
            : `(${source})?.[${JSON.stringify(prop.key)}]`;
          this.genPatternAccessors(prop.value, access, out, names);
        }
        if (pattern.rest) {
          const keys = JSON.stringify(pattern.properties.map((p) => p.key));
          out.push(`const ${pattern.rest} = () => ${this.rt}.omit(${source}, ${keys});`);
          names.push(pattern.rest);
        }
        return;
      }

      case 'ArrayPattern': {
        for (let i = 0; i < pattern.elements.length; i++) {
          const element = pattern.elements[i];
          if (!element) continue;
          if (element.type === 'RestPattern') {
            const target = element.argument;
            if (target.type !== 'IdentifierPattern') {
              throw new CompilerError('`...rest` in `:for` must bind a plain name', {
                line: 0,
                column: 0,
              });
            }
            out.push(`const ${target.name} = () => (${source})?.slice(${i}) ?? [];`);
            names.push(target.name);
            continue;
          }
          this.genPatternAccessors(element, `(${source})?.[${i}]`, out, names);
        }
        return;
      }

      case 'AssignmentPattern': {
        const ctxForDefault = createPrintContext(this.ctxName);
        const fallback = printExpression(pattern.right, ctxForDefault, 1);
        this.genPatternAccessors(
          pattern.left,
          `${this.rt}.withDefault(${source}, () => ${fallback})`,
          out,
          names,
        );
        return;
      }

      case 'RestPattern': {
        this.genPatternAccessors(pattern.argument, source, out, names);
        return;
      }
    }
  }

  private genSlotOutlet(node: SlotOutletNode, ctx: PrintContext): string {
    const body = node.children.length ? this.genChildrenExpression(node.children, ctx) : null;
    const fallback =
      body === null ? 'null' : this.server ? this.arrowBlock(body) : this.thunk(body);

    const props = this.genSlotProps(node.directives, node.attrs, ctx);
    const call = `${this.rt}.slot(${this.ctxName}, ${JSON.stringify(node.name)}, ${props}, ${fallback})`;
    // The slot's content writes into the one writer this render has, which
    // both sides of the call already close over, so nothing is returned.
    return this.server ? `${call};` : call;
  }

  private genSlotProps(
    directives: DirectiveNode[],
    attrs: AttributeNode[],
    ctx: PrintContext,
  ): string {
    const entries: string[] = [];
    for (const attr of attrs) {
      entries.push(`${JSON.stringify(attr.name)}: ${JSON.stringify(attr.value ?? true)}`);
    }
    for (const dir of directives) {
      if (dir.kind !== 'prop' || !dir.exp) continue;
      const parsed = this.parse(dir.exp, dir.loc);
      // Getters keep slot props lazy and reactive without wrapping functions.
      entries.push(
        `get ${JSON.stringify(dir.name)}() { return ${printExpression(parsed, ctx, 1)}; }`,
      );
    }
    return entries.length ? `{ ${entries.join(', ')} }` : 'null';
  }

  // -------------------------------------------------------------------------
  // Components
  // -------------------------------------------------------------------------

  /** Note a component tag, and whether this occurrence is reachable directly. */
  private noteComponentTag(tag: string): void {
    const unconditional = this.conditionalDepth === 0;
    // Once seen unconditionally it stays that way: one direct occurrence is
    // enough to put the component on the first-paint path.
    this.componentTags.set(tag, (this.componentTags.get(tag) ?? false) || unconditional);
  }

  /** Generate `body` as sitting behind a condition, for the analysis. */
  private inConditional<T>(body: () => T): T {
    this.conditionalDepth++;
    try {
      return body();
    } finally {
      this.conditionalDepth--;
    }
  }

  private genComponent(node: ElementNode, ctx: PrintContext): string {
    this.noteComponentTag(node.tag);
    const props: string[] = [];
    const events: string[] = [];

    for (const attr of node.attrs) {
      props.push(`${JSON.stringify(attr.name)}: ${JSON.stringify(attr.value ?? true)}`);
    }

    for (const dir of node.directives) {
      switch (dir.kind) {
        case 'event': {
          const { handler } = this.genEventHandler(dir, ctx);
          events.push(`${JSON.stringify(dir.name)}: ${handler}`);
          break;
        }
        case 'prop':
        case 'class':
        case 'style':
        case 'attr': {
          if (!dir.exp) break;
          const parsed = this.parse(dir.exp, dir.loc);
          const name = dir.kind === 'class' ? 'class' : dir.kind === 'style' ? 'style' : dir.name;

          // A callback prop given a bare method reference would arrive
          // unbound, and `this` inside it would be the child. Wrap it so the
          // method is invoked on the component that declared it. Restricted
          // to the `onX` naming convention, since wrapping an ordinary value
          // in an arrow would break it.
          const isCallbackProp = /^on[A-Z]/.test(name);
          const isBareReference = parsed.type === 'Identifier' || parsed.type === 'Member';
          if (isCallbackProp && isBareReference) {
            const target = printExpression(parsed, ctx);
            props.push(`${JSON.stringify(name)}: (...a) => ${target}(...a)`);
            break;
          }

          if (isStaticExpression(parsed)) {
            this.stats.foldedBindings++;
            props.push(`${JSON.stringify(name)}: ${JSON.stringify(evaluateStatic(parsed))}`);
          } else {
            // Lazy getter: the child only pays for props it actually reads.
            props.push(
              `get ${JSON.stringify(name)}() { return ${printExpression(parsed, ctx, 1)}; }`,
            );
          }
          break;
        }
        case 'model': {
          const target = this.genAccessor(dir.exp!, ctx, dir.loc);
          const setter = this.genModelSetter(dir.exp!, ctx, dir);
          // A value in and a callback out — both ordinary inputs.
          props.push(`get "modelValue"() { return (${target})(); }`);
          props.push(`"onModelValue": ${setter}`);
          break;
        }
        case 'spread': {
          props.push(`...${printExpression(this.parse(dir.exp!, dir.loc), ctx, 1)}`);
          break;
        }
        case 'ref': {
          props.push(
            `"__ref": (_c) => ${this.rt}.setRef(_c, ${this.ctxName}, ${JSON.stringify(dir.exp)})`,
          );
          break;
        }
        default:
          break;
      }
    }

    const slots = this.genSlots(node, ctx);

    const propsExpr = props.length ? `{ ${props.join(', ')} }` : 'null';
    const eventsExpr = events.length ? `{ ${events.join(', ')} }` : 'null';

    const call =
      `${this.rt}.createComponent(${this.ctxName}, ${JSON.stringify(node.tag)}, ` +
      `${propsExpr}, ${eventsExpr}, ${slots}` +
      (this.server ? `, ${this.out}` : '') +
      ')';
    return this.server ? `${call};` : call;
  }

  private genSlots(node: ElementNode, ctx: PrintContext): string {
    const named = new Map<string, TemplateChildNode[]>();
    const defaultChildren: TemplateChildNode[] = [];

    for (const child of node.children) {
      if (child.type === 'element') {
        const slotDir = findDirective(child, 'slot');
        if (slotDir?.exp) {
          const name = stripQuotes(slotDir.exp);
          const list = named.get(name) ?? [];
          const stripped = stripDirectives(child, ['slot']);
          list.push(stripped.isTemplate ? ({ ...stripped } as ElementNode) : stripped);
          named.set(name, list);
          continue;
        }
      }
      defaultChildren.push(child);
    }

    const entries: string[] = [];
    const meaningfulDefault = defaultChildren.filter(
      (c) => c.type !== 'comment' && !(c.type === 'text' && !c.content.trim()),
    );
    const content = (nodes: TemplateChildNode[]): string => {
      const generated = this.genChildrenExpression(nodes, ctx);
      return this.server ? this.arrowBlock(generated) : `() => ${generated}`;
    };
    if (meaningfulDefault.length) {
      entries.push(`default: ${content(defaultChildren)}`);
    }
    for (const [name, children] of named) {
      const nodes = children.flatMap((c) =>
        c.type === 'element' && c.isTemplate ? c.children : [c],
      );
      entries.push(`${JSON.stringify(name)}: ${content(nodes)}`);
    }

    return entries.length ? `{ ${entries.join(', ')} }` : 'null';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Whether a directive prints into the element's open tag.
 *
 * Total over `DirectiveKind` so a directive added without deciding this is a
 * type error, rather than an element whose server markup quietly loses an
 * attribute the client sets. The structural kinds are resolved long before an
 * open tag exists and could not reach here, but the answer for them is still
 * no, so they are written down rather than left to a lookup miss.
 */
const ATTRIBUTE_POSITION: Record<DirectiveKind, boolean> = {
  prop: true,
  attr: true,
  class: true,
  style: true,
  model: true,
  spread: true,
  // Attach behaviour to the node; the same bytes with or without them.
  event: false,
  ref: false,
  // Own everything between the tags, which is a hole of its own.
  text: false,
  html: false,
  if: false,
  'else-if': false,
  else: false,
  for: false,
  key: false,
  slot: false,
  portal: false,
};

/**
 * The chunk as the server prints it: everything but the ranges the merge
 * writes itself. See `Block.serverOmit`.
 */
function omitRanges(chunk: string, ranges: [number, number][] | null): string {
  if (!ranges || ranges.length === 0) return chunk;
  let out = '';
  let at = 0;
  for (const [start, end] of ranges) {
    out += chunk.slice(at, start);
    at = end;
  }
  return out + chunk.slice(at);
}

/**
 * Elements whose content is raw text rather than markup.
 *
 * `<textarea>` and `<title>` are deliberately absent: they are *escapable*
 * raw text, where an entity is still decoded, so a value written into one is
 * escaped like any other text.
 */
const RAW_TEXT_TAGS = new Set(['script', 'style']);

function findDirective(node: ElementNode, kind: string): DirectiveNode | undefined {
  return node.directives.find((d) => d.kind === kind);
}

function stripDirectives(node: ElementNode, kinds: string[]): ElementNode {
  return { ...node, directives: node.directives.filter((d) => !kinds.includes(d.kind)) };
}

function isSafeIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function modelKind(node: ElementNode): string {
  const tag = node.tag.toLowerCase();
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'text';
  const type = node.attrs.find((a) => a.name === 'type')?.value?.toLowerCase();
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (type === 'number' || type === 'range') return 'number';
  return 'text';
}

function normalizeClassValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(normalizeClassValue).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k)
      .join(' ');
  }
  return '';
}

function normalizeStyleValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== false)
      .map(([k, v]) => `${hyphenate(k)}:${String(v)}`)
      .join(';');
  }
  return '';
}

function mergeStaticClass(attrs: Map<string, string | true>, cls: string): void {
  const existing = attrs.get('class');
  attrs.set('class', typeof existing === 'string' && existing ? `${existing} ${cls}` : cls);
}

function hyphenate(name: string): string {
  return name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Escape text for embedding in the cloned markup.
 *
 * A bare `&` must become `&amp;`, but an `&` that already begins an entity
 * must not — escaping it would double-encode, so `&amp;` in a template would
 * render as the literal text "&amp;" instead of "&".
 */
function escapeHtmlText(text: string): string {
  return text
    .replaceAll(/&(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#[xX][0-9a-fA-F]+;)/g, '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}

export { collectDependencies };
