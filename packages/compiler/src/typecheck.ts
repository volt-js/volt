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

export interface TypeCheckOptions {
  /** The component class the template belongs to, as named in its module. */
  className: string;
  /** What the instance is called inside the block. Defaults to `_ctx`. */
  ctx?: string;
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

class BlockEmitter {
  private readonly ctxName: string;
  private readonly className: string;

  private parts: string[] = [];
  private length = 0;
  private depth = 1;

  private spans: TemplateSpan[] = [];
  private errors: { message: string; loc: SourceLocation }[] = [];

  /** Which helpers the body reached for, so unused ones are never declared. */
  private used = { expr: false, read: false, handler: false };

  /** Depth of `<!-- volt-ignore -->` regions the walk is currently inside. */
  private ignoring = 0;
  /** An ignore comment has been read and the node it spares has not arrived. */
  private pendingIgnore = false;

  constructor(options: TypeCheckOptions) {
    this.ctxName = options.ctx ?? '_ctx';
    this.className = options.className;
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
        // alone, because the value that is not one has to render somehow.
        '  type __VoltRead<T> = [T] extends [__VoltSignal] ? never : 0;',
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

  private children(nodes: TemplateChildNode[], ctx: PrintContext): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;

      if (node.type === 'comment') {
        if (isIgnoreComment(node.content)) this.pendingIgnore = true;
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
        let j = i + 1;
        this.spared(() => this.element(node, ctx));
        while (j < nodes.length) {
          const next = nodes[j]!;
          if (next.type === 'comment') {
            if (isIgnoreComment(next.content)) this.pendingIgnore = true;
            j++;
            continue;
          }
          if (
            next.type === 'element' &&
            (findDirective(next, 'else-if') || findDirective(next, 'else'))
          ) {
            this.spared(() => this.element(next, ctx));
            j++;
            if (findDirective(next, 'else')) break;
            continue;
          }
          break;
        }
        i = j - 1;
        continue;
      }

      this.spared(() => this.element(node, ctx));
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

  private element(node: ElementNode, ctx: PrintContext): void {
    const forDir = findDirective(node, 'for');
    if (forDir?.exp) {
      this.forElement(node, forDir, ctx);
      return;
    }
    const slotDir = findDirective(node, 'slot');
    if (slotDir?.exp) {
      this.slotContent(node, slotDir, ctx);
      return;
    }
    this.directives(node.directives, ctx);
    this.children(node.children, ctx);
  }

  /**
   * `:slot-<name>="pattern"` binds what the slot passes, for its content.
   *
   * The names are declared, so the content is checked against the component
   * it is written in rather than reported as missing members of it. Their type
   * is not known here: it belongs to the component being filled, and a
   * template does not yet type a child component's own slots. Declaring them
   * as `any` is what keeps the check honest either way — it reports nothing it
   * cannot stand behind, and reports everything else in the content as usual.
   */
  private slotContent(node: ElementNode, dir: DirectiveNode, ctx: PrintContext): void {
    let pattern;
    try {
      pattern = parseForExpression(`${dir.exp} in _`).item;
    } catch (err) {
      this.errors.push({ message: (err as Error).message, loc: dir.expLoc ?? dir.loc });
      return;
    }

    this.line('{');
    this.depth++;
    this.line(`const ${printPattern(pattern, ctx)}: any = {} as any;`);

    withScope(ctx, patternNames(pattern), () => {
      this.directives(
        node.directives.filter((d) => d !== dir),
        ctx,
        node.isComponent,
      );
      this.children(node.children, ctx);
    });

    this.depth--;
    this.line('}');
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
      this.directives(node.directives, ctx, node.isComponent);
      this.children(node.children, ctx);
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
