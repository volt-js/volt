/**
 * Type-check blocks: Volt template AST -> synthetic TypeScript.
 *
 * A template expression is invisible to `tsc`. The plugin parses
 * `{ document.title }` and emits `_ctx.document.title` into a module the type
 * checker never reads, because what `tsc` reads is the source, where the
 * template is a `templateUrl` string. So `{ document.foobar }` compiles and
 * fails at runtime.
 *
 * The fix is the one Angular and Vue both use: restate every expression in the
 * template as TypeScript, with the component instance typed, and hand that to
 * the compiler. This module is that restatement. It is a second emit from the
 * same analysis the render emit uses — the same expression parser, the same
 * printer, the same scope rules — so a name resolves here exactly as it will
 * resolve at runtime, and a `:for` item is typed by the collection it came
 * from because the block iterates that collection for real.
 *
 * Nothing here touches a filesystem or a type checker. It produces a string
 * and a table that says which characters of that string came from which
 * characters of the template; `@voltdev/cli` supplies the rest.
 *
 * The one thing it decides on its own is what a `<!-- volt-ignore -->` covers.
 * Some expressions are legitimately beyond a type, and without a way to say so
 * the checker is something a project turns off whole.
 */

import type {
  DirectiveNode,
  ElementNode,
  RootNode,
  SlotOutletNode,
  SourceLocation,
  TemplateChildNode,
} from './ast.js';
import { parseExpression, parseForExpression } from './expression/parser.js';
import { patternNames } from './expression/ast.js';
import {
  createPrintContext,
  printExpression,
  printPattern,
  withScope,
  type PrintContext,
} from './expression/printer.js';

/**
 * A rule the checker enforces itself, beyond "does this type-check".
 *
 * Both are the same mistake in two positions: a signal is an object, so
 * writing one where its value belongs is quietly wrong rather than loudly.
 */
export type TypeCheckRule = 'display' | 'condition';

/** Where a printed name in the block came from in the template expression. */
export interface NameMark {
  /** Offset in the block's code where the printed name begins. */
  at: number;
  length: number;
  /** Offset of the same name in the expression source. */
  source: number;
}

/** One template expression, and where its restatement landed in the block. */
export interface TemplateSpan {
  /** Offsets in the block's code covering the printed expression. */
  start: number;
  end: number;
  /** Where the expression is written in the template. */
  loc: SourceLocation;
  /** The expression exactly as authored, for offset-to-column arithmetic. */
  exp: string;
  marks: NameMark[];
  /**
   * The rule marker for this position, if it carries one.
   *
   * The marker is an argument the block passes to a helper whose parameter
   * type is `never` when the rule is broken. Nothing else can be written at
   * that offset, so a diagnostic landing on it is that rule and no other —
   * which is what lets the checker replace the compiler's wording with its
   * own.
   */
  check: { at: number; rule: TypeCheckRule } | null;
  /**
   * Whether a `<!-- volt-ignore -->` in the template asked for this one to be
   * left alone.
   *
   * The expression is still restated, because the names it binds — a `:for`
   * item above all — are what the rest of the row is typed against. Only the
   * diagnostics are dropped.
   */
  ignored: boolean;
}

export interface TypeCheckBlock {
  /** The synthetic TypeScript. A single block statement, brace to brace. */
  code: string;
  /** One entry per expression, in emission order. */
  spans: TemplateSpan[];
  /** Expressions that did not parse, which nothing downstream can check. */
  errors: { message: string; loc: SourceLocation }[];
}

/**
 * A component the template writes a tag for, as far as its slots go.
 *
 * What a scoped slot hands its content is written on the component's own
 * outlet — `<slot name="row" :row="person">` — and nowhere else, so its type
 * is the type of those expressions, read against that component's class.
 */
export interface ComponentSource {
  /** The class, spelled so the block's own module can name it. */
  className: string;
  /** The component's template, whose outlets say what each slot passes. */
  root: RootNode;
  /**
   * How many type parameters the class takes, when it is generic.
   *
   * Each is read as `any`. What they are is decided by the props the tag is
   * written with, which nothing here follows, and left to TypeScript they
   * would be their bound, `unknown` — which refuses every use of a name the
   * caller knows the type of.
   */
  typeParameters?: number;
}

export interface TypeCheckOptions {
  /** The component class the template belongs to, as named in its module. */
  className: string;
  /** What the instance is called inside the block. Defaults to `_ctx`. */
  ctx?: string;
  /**
   * The components the template can write tags for, by selector.
   *
   * Content filling a scoped slot of a tag found here has its names typed by
   * that tag's outlet. Any other tag's are `any`: a template on its own does
   * not say which class a tag is, and an `any` reports nothing it cannot
   * stand behind.
   */
  components?: ReadonlyMap<string, ComponentSource>;
}

/** Restate every expression in `root` as TypeScript against `className`. */
export function generateTypeCheckBlock(
  root: RootNode,
  options: TypeCheckOptions,
): TypeCheckBlock {
  return new BlockEmitter(options).run(root);
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

/** Matches a mark the printer wrote. See `PrintContext.marks`. */
const MARK = /\/\*@volt:(\d+)\*\//g;
const NAME = /^[A-Za-z_$][A-Za-z0-9_$]*/;

type Position = 'expression' | TypeCheckRule;

/** One arm of an `:if` chain, and whether a comment before it asked it be spared. */
interface Link {
  node: ElementNode;
  spared: boolean;
}

/** The component whose tag a list of children is written directly inside. */
interface Filling {
  /** Its selector, which says whose slots a `:slot-*` among them fills. */
  tag: string;
  /** The pattern each filled slot binds, by slot name. See `slotPatterns`. */
  patterns: ReadonlyMap<string, DirectiveNode>;
}

/**
 * What a child component's instance is called while its outlet is restated.
 *
 * Not the block's own `_ctx`: inside the restatement both are in reach, and a
 * name that resolved to the wrong one would type a slot by the wrong class.
 */
const HOST = '__volt_host';

class BlockEmitter {
  private readonly ctxName: string;
  private readonly className: string;
  private readonly components: ReadonlyMap<string, ComponentSource> | undefined;

  private parts: string[] = [];
  private length = 0;
  private depth = 1;

  private spans: TemplateSpan[] = [];
  private errors: { message: string; loc: SourceLocation }[] = [];

  /** Which helpers the body reached for, so unused ones are never declared. */
  private used = { expr: false, read: false, handler: false, pass: false };

  /** Depth of `<!-- volt-ignore -->` regions the walk is currently inside. */
  private ignoring = 0;
  /** An ignore comment has been read and the node it spares has not arrived. */
  private pendingIgnore = false;

  constructor(options: TypeCheckOptions) {
    this.ctxName = options.ctx ?? '_ctx';
    this.className = options.className;
    this.components = options.components;
  }

  run(root: RootNode): TypeCheckBlock {
    const ctx = createPrintContext(this.ctxName);
    ctx.marks = [];
    this.children(root.children, ctx);

    const body = this.parts.join('');
    const header = this.header();
    // Spans were measured against the body alone, because which helpers the
    // header declares is not known until the body has asked for them.
    for (const span of this.spans) shiftSpan(span, header.length);

    return { code: `${header}${body}}\n`, spans: this.spans, errors: this.errors };
  }

  private header(): string {
    const lines = [
      '{',
      // `typeof` rather than the class as a type: it is the spelling that
      // survives a generic component, whose type needs arguments, and an
      // abstract one, which `InstanceType` refuses.
      '  type __VoltInstance<C> = C extends abstract new (...a: never[]) => infer I ? I : never;',
      `  const ${this.ctxName} = null! as __VoltInstance<typeof ${this.className}>;`,
    ];
    if (this.used.read) {
      lines.push(
        '  type __VoltSignal = { get(): unknown };',
        // Not distributive: a union that is only sometimes a signal is left
        // alone, because the value that is not one has to render somehow. And
        // `any` and `never` first, because both extend everything: an `any`
        // is what nobody could type and a `never` is what holds nothing,
        // and neither is evidence of a signal.
        '  type __VoltRead<T> = 0 extends 1 & T ? 0 : [T] extends [never] ? 0 :' +
          ' [T] extends [__VoltSignal] ? never : 0;',
        '  const __volt_read = null! as <T>(value: T, read: __VoltRead<T>) => void;',
      );
    }
    if (this.used.handler) {
      lines.push(
        "  type __VoltEvent<K extends string> = K extends keyof HTMLElementEventMap" +
          ' ? HTMLElementEventMap[K] : Event;',
        '  const __volt_handler = null! as <E>(handler: (event: E) => unknown) => void;',
      );
    }
    if (this.used.expr) {
      lines.push('  const __volt_expr = null! as (value: unknown) => void;');
    }
    if (this.used.pass) {
      lines.push(
        // What a slot passes reaches its content as the value itself, so
        // `'done'` is `'done'` there, as a `const` would hold it — where a
        // function's inferred return widens it to `string`. A parameter whose
        // bound has primitives in it keeps the literal, and `unknown`, `void`
        // and everything else still pass through unchanged.
        '  const __volt_pass = null! as <T extends {} | null | undefined | void>(value: T) => T;',
      );
    }
    return `${lines.join('\n')}\n`;
  }

  // -- writing --------------------------------------------------------------

  private write(text: string): number {
    const at = this.length;
    this.parts.push(text);
    this.length += text.length;
    return at;
  }

  private line(text: string): void {
    this.write(`${'  '.repeat(this.depth)}${text}\n`);
  }

  // -- expressions ----------------------------------------------------------

  /**
   * Restate one expression, and record where it landed.
   *
   * `loc` is the expression's own location rather than the directive's: a
   * diagnostic that points at the `:` of `:click` names a column nobody wrote
   * the mistake in.
   */
  private expression(
    exp: string,
    loc: SourceLocation | null,
    ctx: PrintContext,
    position: Position,
  ): void {
    if (loc === null) return;
    const printed = this.print(exp, loc, ctx);
    if (printed === null) return;

    const indent = '  '.repeat(this.depth);
    const call = position === 'expression' ? '__volt_expr(' : '__volt_read(';
    if (position === 'expression') this.used.expr = true;
    else this.used.read = true;

    const exprAt = indent.length + call.length;
    const tail = position === 'expression' ? ');\n' : ', 0);\n';
    const base = this.write(`${indent}${call}${printed.code}${tail}`);

    this.spans.push({
      start: base + exprAt,
      end: base + exprAt + printed.code.length,
      loc,
      exp,
      marks: printed.marks.map((m) => ({ ...m, at: base + exprAt + m.at })),
      check:
        position === 'expression'
          ? null
          : { at: base + exprAt + printed.code.length + ', '.length, rule: position },
      ignored: this.ignoring > 0,
    });
  }

  /**
   * `:click="handle($event)"` — the event's type comes from its name.
   *
   * A bare reference or an arrow is already a function and is checked as one,
   * which is also what makes a mistyped parameter an error. Anything else is
   * a statement the runtime wraps, so the block wraps it the same way and
   * `$event` is a parameter of the wrapper.
   */
  private handler(dir: DirectiveNode, ctx: PrintContext): void {
    const loc = dir.expLoc;
    if (loc === null || dir.exp === null) return;
    const parsed = this.parse(dir.exp, loc);
    if (parsed === null) return;

    const isFunctionValue =
      parsed.type === 'Identifier' || parsed.type === 'Member' || parsed.type === 'Arrow';
    const printed = this.printNode(parsed, ctx);
    this.used.handler = true;

    const indent = '  '.repeat(this.depth);
    const open = `__volt_handler<__VoltEvent<${JSON.stringify(dir.name)}>>(`;
    const prefix = isFunctionValue ? '' : '($event) => (';
    const suffix = isFunctionValue ? ');\n' : '));\n';

    const exprAt = indent.length + open.length + prefix.length;
    const base = this.write(`${indent}${open}${prefix}${printed.code}${suffix}`);

    this.spans.push({
      start: base + exprAt,
      end: base + exprAt + printed.code.length,
      loc,
      exp: dir.exp,
      marks: printed.marks.map((m) => ({ ...m, at: base + exprAt + m.at })),
      check: null,
      ignored: this.ignoring > 0,
    });
  }

  private parse(exp: string, loc: SourceLocation) {
    try {
      return parseExpression(exp);
    } catch (err) {
      this.errors.push({ message: (err as Error).message, loc });
      return null;
    }
  }

  private print(exp: string, loc: SourceLocation, ctx: PrintContext) {
    const parsed = this.parse(exp, loc);
    return parsed === null ? null : this.printNode(parsed, ctx);
  }

  private printNode(node: Parameters<typeof printExpression>[0], ctx: PrintContext) {
    const marks = ctx.marks!;
    marks.length = 0;
    // Minimum precedence 1, so a sequence expression is parenthesised rather
    // than read as two arguments.
    const code = printExpression(node, ctx, 1);
    return { code, marks: resolveMarks(code, marks) };
  }

  // -- traversal ------------------------------------------------------------

  /**
   * `host` is the selector of the component whose tag `nodes` are written
   * directly inside, which is whose slot a `:slot-*` among them fills. `only`
   * is for a list read in two scopes, and picks this reading's half of it.
   */
  private children(
    nodes: TemplateChildNode[],
    ctx: PrintContext,
    host: string | null = null,
    only?: (node: TemplateChildNode) => boolean,
  ): void {
    const filling = host === null ? null : { tag: host, patterns: slotPatterns(nodes) };
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;

      if (node.type === 'comment') {
        if (isIgnoreComment(node.content)) this.pendingIgnore = true;
        continue;
      }
      if (only !== undefined && !only(node)) {
        // The other reading visits it, and the comment before it with it.
        // Text is the exception: no comment spares text, so it passes one on
        // to whatever follows it, in this reading as in the other.
        if (node.type !== 'text') this.pendingIgnore = false;
        continue;
      }
      if (node.type === 'interpolation') {
        this.spared(() => this.expression(node.exp, node.expLoc, ctx, 'display'));
        continue;
      }
      if (node.type === 'slot-outlet') {
        this.spared(() => this.slotOutlet(node, ctx));
        continue;
      }
      if (node.type !== 'element') continue;

      // A `:if` chain is consumed as a unit, exactly as codegen consumes it,
      // so an `:else` branch's own bindings are visited once and in order.
      if (findDirective(node, 'if')) {
        const links: Link[] = [{ node, spared: this.pendingIgnore }];
        let pending = false;
        let j = i + 1;
        while (j < nodes.length) {
          const next = nodes[j]!;
          if (next.type === 'comment') {
            if (isIgnoreComment(next.content)) pending = true;
            j++;
            continue;
          }
          if (
            next.type === 'element' &&
            (findDirective(next, 'else-if') || findDirective(next, 'else'))
          ) {
            links.push({ node: next, spared: pending });
            pending = false;
            j++;
            if (findDirective(next, 'else')) break;
            continue;
          }
          break;
        }
        this.chain(links, ctx, filling);
        // A comment after the last arm is the next node's to claim.
        this.pendingIgnore = pending;
        i = j - 1;
        continue;
      }

      this.spared(() => this.element(node, ctx, filling));
    }

    // An ignore comment written last in a list spares nothing, and must not
    // reach the node after the list it was written in.
    this.pendingIgnore = false;
  }

  /**
   * Run `body` inside the ignore region a preceding comment opened, if any.
   *
   * The comment spares the whole node that follows it, children included,
   * rather than a line: an expression can be several lines below the comment
   * once an element's attributes wrap, and a line rule would miss it.
   */
  private spared<T>(body: () => T): T {
    const claimed = this.pendingIgnore;
    this.pendingIgnore = false;
    if (!claimed) return body();
    this.ignoring++;
    try {
      return body();
    } finally {
      this.ignoring--;
    }
  }

  /**
   * A chain's arms, each tested where the arms after it can see what it ruled
   * out: `if (a) { … } else { if (b) { … } else { … } }`.
   *
   * A condition is restated twice. Once as the expression the rule reads,
   * mapped and reported like any other; once more as the test itself, which
   * is what narrows what its arm reads — `{ entry.number }` under
   * `:if="entry.kind === 'page'"` is a page's, and a name a scoped slot
   * passed is no less a union for having come through a slot. The test is
   * never mapped, so nothing is reported twice.
   */
  private chain(links: readonly Link[], ctx: PrintContext, filling: Filling | null): void {
    // An arm with a `:for`, or filling a slot whose names a pattern binds,
    // reads its condition inside that scope, and no test around the arm can
    // see into it.
    const scoped = links.some(
      ({ node }) =>
        findDirective(node, 'for')?.exp || patternFor(node, filling?.patterns) !== undefined,
    );
    if (scoped) {
      for (const link of links) {
        this.pendingIgnore = link.spared;
        this.spared(() => this.element(link.node, ctx, filling));
      }
      return;
    }

    let open = 0;
    links.forEach((link, k) => {
      if (k > 0) {
        this.line('else {');
        this.depth++;
        open++;
      }
      this.pendingIgnore = link.spared;
      this.spared(() => {
        const test = findDirective(link.node, 'if') ?? findDirective(link.node, 'else-if');
        if (test?.exp) {
          this.expression(test.exp, test.expLoc, ctx, 'condition');
          this.line(`if (${condition(test.exp, ctx)}) {`);
        } else {
          this.line('{');
        }
        this.depth++;
        this.element(withoutConditions(link.node), ctx, filling);
        this.depth--;
        this.line('}');
      });
    });
    for (; open > 0; open--) {
      this.depth--;
      this.line('}');
    }
  }

  private element(node: ElementNode, ctx: PrintContext, filling: Filling | null): void {
    const pattern = patternFor(node, filling?.patterns);
    if (filling !== null && pattern !== undefined) {
      // Inside a component's tag, a `:slot-*` fills that component's slot,
      // whatever it is written on, and the rest of the element — its `:for`,
      // its `:if`, its props — is that slot's content. So the pattern is the
      // scope around all of it, as it is when the content renders, and a
      // condition on it is an arm of its own inside that scope.
      const content = withoutSlot(node);
      this.slotScope(pattern, filling.tag, ctx, () =>
        content.directives.some((d) => CONDITIONS.has(d.kind))
          ? this.chain([{ node: content, spared: false }], ctx, null)
          : this.element(content, ctx, null),
      );
      return;
    }
    const forDir = findDirective(node, 'for');
    if (forDir?.exp) {
      this.forElement(node, forDir, ctx);
      return;
    }
    this.contents(node, ctx);
  }

  /**
   * An element's own bindings, then what is written inside it.
   *
   * A tag inside no component's tag can name what its own default slot
   * passes, and those names are the scope of its default content and of
   * nothing else: its props and its `:for` are read where the tag is written,
   * and a child filling a slot by name is that slot's content, rendered
   * without them.
   */
  private contents(node: ElementNode, ctx: PrintContext): void {
    this.directives(node.directives, ctx, node.isComponent);
    const host = ownHost(node);
    const own = findDirective(node, 'slot');
    if (!own?.exp) {
      this.children(node.children, ctx, host);
      return;
    }
    this.slotScope(own, host, ctx, () =>
      this.children(node.children, ctx, host, (child) => !fillsSlot(child)),
    );
    this.children(node.children, ctx, host, fillsSlot);
  }

  /**
   * `:slot-<name>="pattern"` binds what the slot passes, for `body`.
   *
   * The names are declared, so the content is checked against the component
   * it is written in rather than reported as missing members of it. Their
   * type is what the filled component's outlet hands over, when the block was
   * told which component that is. Otherwise it is `any`, which keeps the
   * check honest: it reports nothing it cannot stand behind, and reports
   * everything else in the content as usual.
   */
  private slotScope(
    dir: DirectiveNode,
    host: string | null,
    ctx: PrintContext,
    body: () => void,
  ): void {
    let pattern;
    try {
      pattern = parseForExpression(`${dir.exp} in _`).item;
    } catch (err) {
      this.errors.push({ message: (err as Error).message, loc: dir.expLoc ?? dir.loc });
      return;
    }

    this.line('{');
    this.depth++;
    const declared = printPattern(pattern, ctx);
    const passed = host === null ? null : this.slotPasses(host, dir.name);
    if (passed === null) {
      this.line(`const ${declared}: any = {} as any;`);
    } else {
      this.line(`const ${declared} = (() => {`);
      for (const line of passed) this.line(`  ${line}`);
      this.line('})();');
    }
    withScope(ctx, patternNames(pattern), body);
    this.depth--;
    this.line('}');
  }

  /**
   * The body of a function returning what `tag`'s slot `name` passes, or null
   * when nothing says.
   *
   * Every outlet of that name is restated where it sits, inside the `:for`
   * rows around it, as a `return` of the object it builds; the function's
   * inferred return type is then the union of them all, which is exactly what
   * the content can be handed. None of it is a span, so nothing in it is ever
   * reported here: a mistake in an outlet belongs to the component that wrote
   * it, and is reported when its own template is checked.
   */
  private slotPasses(tag: string, name: string): string[] | null {
    const source = this.components?.get(tag);
    if (source === undefined) return null;
    const returns = outletReturns(source.root.children, name, createPrintContext(HOST));
    if (returns === null) return null;
    this.used.pass = true;
    const count = source.typeParameters ?? 0;
    const args = count > 0 ? `<${Array<string>(count).fill('any').join(', ')}>` : '';
    return [
      `const ${HOST} = null! as __VoltInstance<typeof ${source.className}${args}>;`,
      ...returns,
      // Reached only past every outlet, and `never` adds nothing to a union.
      'return null!;',
    ];
  }

  private slotOutlet(node: SlotOutletNode, ctx: PrintContext): void {
    if (node.from?.exp) this.expression(node.from.exp, node.from.expLoc, ctx, 'expression');
    this.directives(node.directives, ctx);
    this.children(node.children, ctx);
  }

  /**
   * `onComponent` because two directives change meaning there: `:text` and
   * `:html` write an element's content, and a component has none of its own,
   * so on its tag they are props like any other — and a prop handed a signal
   * is the ordinary controlled shape rather than the mistake this warns about.
   */
  private directives(
    directives: DirectiveNode[],
    ctx: PrintContext,
    onComponent = false,
  ): void {
    for (const dir of directives) {
      switch (dir.kind) {
        // Structure, handled by the walk itself, and `:slot` names a slot
        // rather than reading anything.
        case 'for':
        case 'key':
        case 'else':
        case 'slot':
          continue;

        case 'if':
        case 'else-if':
          this.expression(dir.exp!, dir.expLoc, ctx, 'condition');
          continue;

        case 'event':
          if (dir.exp) this.handler(dir, ctx);
          continue;

        // Everything a value is rendered into: a signal here is the mistake
        // the rule is about.
        case 'text':
        case 'html':
          if (dir.exp) {
            this.expression(dir.exp, dir.expLoc, ctx, onComponent ? 'expression' : 'display');
          }
          continue;

        default:
          if (dir.exp) this.expression(dir.exp, dir.expLoc, ctx, 'expression');
          continue;
      }
    }
  }

  /**
   * `:for` becomes a real loop, which is what types the item.
   *
   * The row's bindings are printed with the item in scope as a plain value.
   * Codegen binds it as an accessor and appends the call, but that is a
   * runtime shape for keeping a moved row alive — the type is the item's.
   */
  private forElement(node: ElementNode, dir: DirectiveNode, ctx: PrintContext): void {
    let parsed;
    try {
      parsed = parseForExpression(dir.exp!);
    } catch (err) {
      this.errors.push({ message: (err as Error).message, loc: dir.expLoc ?? dir.loc });
      return;
    }

    const source = this.printNode(parsed.source, ctx);
    const pattern = printPattern(parsed.item, ctx);
    const indent = '  '.repeat(this.depth);
    const open = `for (const ${pattern} of (`;
    const exprAt = indent.length + open.length;
    const base = this.write(`${indent}${open}${source.code}) ?? []) {\n`);

    if (dir.expLoc) {
      this.spans.push({
        start: base + exprAt,
        end: base + exprAt + source.code.length,
        loc: dir.expLoc,
        exp: dir.exp!,
        marks: source.marks.map((m) => ({ ...m, at: base + exprAt + m.at })),
        check: null,
        ignored: this.ignoring > 0,
      });
    }

    const names = patternNames(parsed.item);
    if (parsed.index) names.push(parsed.index);

    this.depth++;
    if (parsed.index) this.line(`const ${parsed.index}: number = 0;`);

    withScope(ctx, names, () => {
      // `:key` is the one expression in a row that also sees `$index`, because
      // the runtime passes it the position — the row body is given the loop's
      // own index name instead, or nothing.
      const keyDir = findDirective(node, 'key');
      if (keyDir?.exp) {
        this.line('{');
        this.depth++;
        this.line('const $index: number = 0;');
        this.expression(keyDir.exp, keyDir.expLoc, ctx, 'expression');
        this.depth--;
        this.line('}');
      }
      this.contents(node, ctx);
    });

    this.depth--;
    this.line('}');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findDirective(
  node: ElementNode | SlotOutletNode,
  kind: string,
): DirectiveNode | undefined {
  return node.directives.find((d) => d.kind === kind);
}

/** The selector whose slots a tag's own content fills, if the tag is a component. */
function ownHost(node: ElementNode): string | null {
  return node.isComponent ? node.tag : null;
}

/** An element as the slot it fills renders it: every `:slot-*` taken off, as codegen takes them. */
function withoutSlot(node: ElementNode): ElementNode {
  return { ...node, directives: node.directives.filter((d) => d.kind !== 'slot') };
}

/** An arm as its chain renders it, once its condition has been tested. */
function withoutConditions(node: ElementNode): ElementNode {
  return { ...node, directives: node.directives.filter((d) => !CONDITIONS.has(d.kind)) };
}

/** Whether a component tag's child is content for a slot it names, rather than the default. */
function fillsSlot(node: TemplateChildNode): boolean {
  return node.type === 'element' && findDirective(node, 'slot') !== undefined;
}

/**
 * The pattern each slot filled among `nodes` binds, by slot name.
 *
 * Codegen gathers a slot's elements before it renders any of them, and binds
 * the one pattern one of them names for all of them: `<i :slot-row>` beside
 * `<b :slot-row="{ row }">` reads the same `row`, before it as after. A
 * pattern that does not parse is left to the element that wrote it to report.
 */
function slotPatterns(nodes: readonly TemplateChildNode[]): Map<string, DirectiveNode> {
  const found = new Map<string, DirectiveNode>();
  for (const node of nodes) {
    const dir = node.type === 'element' ? findDirective(node, 'slot') : undefined;
    if (!dir?.exp || found.has(dir.name)) continue;
    try {
      parseForExpression(`${dir.exp} in _`);
    } catch {
      continue;
    }
    found.set(dir.name, dir);
  }
  return found;
}

/**
 * The pattern binding the content of the slot `node` fills, its own or a
 * sibling's, given the patterns of the component tag it is a child of.
 */
function patternFor(
  node: ElementNode,
  patterns: ReadonlyMap<string, DirectiveNode> | undefined,
): DirectiveNode | undefined {
  if (patterns === undefined) return undefined;
  const dir = findDirective(node, 'slot');
  if (dir === undefined) return undefined;
  return dir.exp ? dir : patterns.get(dir.name);
}

/**
 * Statements reaching every outlet of slot `name` in `nodes`, each returning
 * what that outlet passes, or null when `nodes` hold none.
 *
 * An outlet with `:from` is skipped: it draws content written inside another
 * tag, so what it passes says nothing about a slot of the component it is
 * written in.
 */
function outletReturns(
  nodes: readonly TemplateChildNode[],
  name: string,
  ctx: PrintContext,
  inComponent = false,
): string[] | null {
  // Inside a component's tag, the patterns its slots are filled with, shared
  // as codegen shares them among the elements filling one slot.
  const patterns = inComponent ? slotPatterns(nodes) : undefined;
  let found: string[] | null = null;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    let lines: string[] | null = null;
    if (node.type === 'slot-outlet') {
      // A fallback can hold an outlet of its own.
      lines = outletReturns(node.children, name, ctx);
      if (node.from === undefined && node.name === name) {
        lines = [...(lines ?? []), `return ${outletProps(node, ctx)};`];
      }
    } else if (node.type === 'element') {
      const links = chainAt(nodes, i, inComponent);
      if (links === null) {
        lines = elementReturns(node, name, ctx, patterns);
      } else {
        lines = chainReturns(links.chain, name, ctx);
        i = links.end - 1;
      }
    }
    if (lines !== null) (found ??= []).push(...lines);
  }
  return found;
}

/**
 * The same, for one element, in the scopes it renders in — which are the
 * block's own: a slot it fills is the scope around its condition and its
 * `:for`, its condition the scope around its `:for`, as codegen tests it, and
 * its `:for` the scope around a pattern of its own.
 */
function elementReturns(
  node: ElementNode,
  name: string,
  ctx: PrintContext,
  patterns: ReadonlyMap<string, DirectiveNode> | undefined,
): string[] | null {
  const pattern = patternFor(node, patterns);
  if (pattern !== undefined) {
    const content = withoutSlot(node);
    return patternReturns(pattern, ctx, () => elementReturns(content, name, ctx, undefined));
  }
  // A link read on its own: the start of the content of a slot it fills,
  // which codegen chains with the rest of that slot rather than its siblings.
  if (node.directives.some((d) => CONDITIONS.has(d.kind))) {
    return chainReturns([node], name, ctx);
  }
  const forDir = findDirective(node, 'for');
  if (forDir?.exp) {
    let loop;
    try {
      loop = parseForExpression(forDir.exp);
    } catch {
      return null;
    }
    const head =
      `for (const ${printPattern(loop.item, ctx)} of ` +
      `(${printExpression(loop.source, ctx, 1)}) ?? []) {`;
    const names = patternNames(loop.item);
    if (loop.index) names.push(loop.index);
    const body = withScope(ctx, names, () => contentReturns(node, name, ctx));
    if (body === null) return null;
    const index = loop.index ? [`const ${loop.index}: number = 0;`] : [];
    return [head, ...indented([...index, ...body]), '}'];
  }
  return contentReturns(node, name, ctx);
}

function contentReturns(node: ElementNode, name: string, ctx: PrintContext): string[] | null {
  const returns = (nodes: TemplateChildNode[]) =>
    outletReturns(nodes, name, ctx, node.isComponent);
  const own = findDirective(node, 'slot');
  if (!own?.exp) return returns(node.children);
  const inside = patternReturns(own, ctx, () =>
    returns(node.children.filter((child) => !fillsSlot(child))),
  );
  const outside = returns(node.children.filter(fillsSlot));
  return inside === null && outside === null ? null : [...(inside ?? []), ...(outside ?? [])];
}

const CONDITIONS = new Set(['if', 'else-if', 'else']);

/**
 * The chain an `:if` at `start` begins, or null when there is none: it and
 * the `:else-if`s and `:else` after it, read as codegen reads them, with
 * comments between links passed over. Inside a component's tag an `:if` that
 * fills a slot is the start of that slot's content instead, and is read with
 * the slot.
 */
function chainAt(
  nodes: readonly TemplateChildNode[],
  start: number,
  inComponent: boolean,
): { chain: ElementNode[]; end: number } | null {
  const first = nodes[start]!;
  if (first.type !== 'element' || !findDirective(first, 'if')) return null;
  if (inComponent && findDirective(first, 'slot')) return null;
  const chain = [first];
  let end = start + 1;
  while (end < nodes.length) {
    const next = nodes[end]!;
    if (next.type === 'comment') {
      end++;
      continue;
    }
    if (next.type !== 'element') break;
    const last = findDirective(next, 'else');
    if (!last && !findDirective(next, 'else-if')) break;
    chain.push(next);
    end++;
    if (last) break;
  }
  return { chain, end };
}

/**
 * Statements for the outlets in a chain's arms, each under its arm's own
 * condition, or null when no arm holds one.
 *
 * The condition is what narrows a value a component hands over — a page
 * passed only from the arm where the entry is one, an error only where there
 * is one — so an outlet read without it hands the content the whole union,
 * and content that renders cleanly is reported. An arm with no outlet is kept
 * for what it rules out of the arms after it.
 */
function chainReturns(
  chain: readonly ElementNode[],
  name: string,
  ctx: PrintContext,
): string[] | null {
  const arms = chain.map((link) => elementReturns(withoutConditions(link), name, ctx, undefined));
  if (arms.every((arm) => arm === null)) return null;

  const lines: string[] = [];
  chain.forEach((link, k) => {
    const test = findDirective(link, 'if') ?? findDirective(link, 'else-if');
    let head = test === undefined ? '{' : `if (${condition(test.exp, ctx)}) {`;
    if (k > 0) head = `else ${head}`;
    lines.push(head, ...indented(arms[k] ?? []), '}');
  });
  return lines;
}

/**
 * A condition as the test around its arm, which is never mapped: whatever is
 * wrong with it is reported where it is read as an expression.
 */
function condition(exp: string | null, ctx: PrintContext): string {
  try {
    return printExpression(parseExpression(exp ?? ''), ctx, 1);
  } catch {
    // One that does not parse narrows nothing, and leaves its arm reachable.
    return 'null! as boolean';
  }
}

/**
 * `body`'s statements, with what a slot's pattern binds declared around them.
 *
 * The component filling a slot of its own child: what that child passes is
 * another component's business, and `any` here only types the outlet's props
 * less precisely, never wrongly.
 */
function patternReturns(
  dir: DirectiveNode,
  ctx: PrintContext,
  body: () => string[] | null,
): string[] | null {
  let pattern;
  try {
    pattern = parseForExpression(`${dir.exp} in _`).item;
  } catch {
    return null;
  }
  const declared = printPattern(pattern, ctx);
  const inner = withScope(ctx, patternNames(pattern), body);
  if (inner === null) return null;
  return ['{', `  const ${declared}: any = {} as any;`, ...indented(inner), '}'];
}

/**
 * The object an outlet hands its content, as codegen builds it: a written
 * attribute as its string, and every `:` prop as its expression — each kept
 * as the literal it may be, by `__volt_pass`.
 */
function outletProps(node: SlotOutletNode, ctx: PrintContext): string {
  const entry = (name: string, value: string) => `${JSON.stringify(name)}: __volt_pass(${value})`;
  const entries = node.attrs.map((attr) => entry(attr.name, JSON.stringify(attr.value ?? true)));
  for (const dir of node.directives) {
    if (dir.kind !== 'prop' || !dir.exp) continue;
    let value;
    try {
      value = printExpression(parseExpression(dir.exp), ctx, 1);
    } catch {
      value = 'null! as any';
    }
    entries.push(entry(dir.name, value));
  }
  return `{ ${entries.join(', ')} }`;
}

function indented(lines: readonly string[]): string[] {
  return lines.map((line) => `  ${line}`);
}

/** `<!-- volt-ignore -->`, and nothing that merely mentions it. */
function isIgnoreComment(content: string): boolean {
  return content.trim() === 'volt-ignore';
}

function shiftSpan(span: TemplateSpan, by: number): void {
  span.start += by;
  span.end += by;
  for (const m of span.marks) m.at += by;
  if (span.check) span.check.at += by;
}

/**
 * Pair the marks found in the printed text with the ones the printer says it
 * wrote, and refuse the lot if they disagree.
 *
 * A string literal in a template can contain anything, including text shaped
 * like a mark. Checking the sequence is what keeps a column derived from that
 * text out of a diagnostic: a mismatch falls back to the expression's own
 * location, which is coarser and always right.
 */
function resolveMarks(printed: string, expected: readonly number[]): NameMark[] {
  const found: NameMark[] = [];
  MARK.lastIndex = 0;
  for (let m = MARK.exec(printed); m !== null; m = MARK.exec(printed)) {
    const at = m.index + m[0].length;
    const name = NAME.exec(printed.slice(at));
    found.push({ at, length: name ? name[0].length : 0, source: Number(m[1]) });
  }
  if (found.length !== expected.length) return [];
  for (let i = 0; i < found.length; i++) {
    if (found[i]!.source !== expected[i]) return [];
  }
  return found;
}
