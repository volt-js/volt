/**
 * Template parser: Volt template source -> AST.
 *
 * Volt has exactly one piece of dynamic syntax in markup: a `:` prefix.
 * `:if`, `:for`, `:click`, `:class`, `:disabled` — structure, events and
 * bindings all share it, and the name alone decides which one you get.
 */

import {
  PRESERVE_WHITESPACE_TAGS,
  RAW_TEXT_TAGS,
  STRUCTURAL_DIRECTIVES,
  VOID_TAGS,
  type AttributeNode,
  type CommentNode,
  type DirectiveKind,
  type DirectiveNode,
  type ElementNode,
  type InterpolationNode,
  type RootNode,
  type SlotOutletNode,
  type SourceLocation,
  type TemplateChildNode,
  type TextNode,
} from './ast.js';
import {
  COMMON_ATTRIBUTES,
  DIRECTIVE_NAMES,
  KNOWN_EVENTS,
  isComponentTag,
  isOneEditFrom,
} from './dom-info.js';
// Type only, so the accessibility pass importing this file back is erased.
import type { Diagnostic } from './a11y.js';

export class CompilerError extends Error {
  /**
   * Accessibility findings collected before this error ended that pass.
   *
   * They are about other elements, and dropping them would let one refusal
   * hide every softer finding in the same template until it was fixed.
   */
  warnings: Diagnostic[] = [];

  constructor(
    message: string,
    public loc: { line: number; column: number },
    public source?: string,
    /** The file the template came from, which may not be the importing module. */
    public filename?: string,
  ) {
    const where = filename ? `${filename}:${loc.line}:${loc.column}` : `${loc.line}:${loc.column}`;
    super(`[volt:compiler] ${message} (${where})`);
    this.name = 'CompilerError';
  }
}

export interface ParserOptions {
  /** `condense` (default) trims insignificant whitespace the way Vue does. */
  whitespace?: 'condense' | 'preserve';
  /** Keep comment nodes in the output. Off by default, so they are dropped. */
  comments?: boolean;
  filename?: string;
}

const OPEN_DELIM = '{';
const CLOSE_DELIM = '}';

export function parse(source: string, options: ParserOptions = {}): RootNode {
  return new Parser(source, options).parseRoot();
}

class Parser {
  private pos = 0;
  private line = 1;
  private column = 1;
  private readonly whitespace: 'condense' | 'preserve';
  private readonly keepComments: boolean;
  private readonly filename: string | undefined;

  constructor(
    private readonly source: string,
    options: ParserOptions,
  ) {
    this.whitespace = options.whitespace ?? 'condense';
    this.keepComments = options.comments ?? false;
    this.filename = options.filename;
  }

  parseRoot(): RootNode {
    const start = this.loc();
    const children = this.parseChildren([]);
    if (this.pos < this.source.length) {
      // Only reachable via a stray close tag with no matching open tag.
      const rest = this.source.slice(this.pos, this.pos + 20);
      this.error(`Unexpected closing tag near \`${rest}\``);
    }
    return {
      type: 'root',
      children: this.condenseWhitespace(children, null),
      loc: this.finishLoc(start),
    };
  }

  // -------------------------------------------------------------------------
  // Scanning primitives
  // -------------------------------------------------------------------------

  private loc(): SourceLocation {
    return { start: this.pos, end: this.pos, line: this.line, column: this.column };
  }

  private finishLoc(start: SourceLocation): SourceLocation {
    return { ...start, end: this.pos };
  }

  private error(message: string): never {
    throw new CompilerError(
      message,
      { line: this.line, column: this.column },
      this.source,
      this.filename,
    );
  }

  private advance(count: number): string {
    const text = this.source.slice(this.pos, this.pos + count);
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
    }
    this.pos += count;
    return text;
  }

  private startsWith(text: string): boolean {
    return this.source.startsWith(text, this.pos);
  }

  private skipWhitespace(): void {
    let count = 0;
    while (this.pos + count < this.source.length && /\s/.test(this.source[this.pos + count]!)) {
      count++;
    }
    if (count) this.advance(count);
  }

  private atEnd(): boolean {
    return this.pos >= this.source.length;
  }

  // -------------------------------------------------------------------------
  // Children
  // -------------------------------------------------------------------------

  private parseChildren(stack: string[]): TemplateChildNode[] {
    const nodes: TemplateChildNode[] = [];
    const parent = stack.length ? stack[stack.length - 1]! : null;

    while (!this.atEnd()) {
      if (this.startsWith('</')) {
        // Let the caller decide whether this close tag is theirs.
        if (this.isClosingTagFor(stack)) break;
        // A close tag for an ancestor: also stop, the caller unwinds.
        break;
      }

      if (this.startsWith('<!--')) {
        const comment = this.parseComment();
        if (this.keepComments) nodes.push(comment);
        continue;
      }

      if (this.startsWith('<!')) {
        // Doctype or CDATA — not meaningful inside a component template.
        this.skipUntil('>');
        continue;
      }

      if (this.startsWith('<') && /[a-zA-Z]/.test(this.source[this.pos + 1] ?? '')) {
        const el = this.parseElement(stack);
        if (el) nodes.push(el);
        continue;
      }

      const text = this.parseTextAndInterpolation(parent);
      for (const node of text) nodes.push(node);
    }

    return nodes;
  }

  private isClosingTagFor(stack: string[]): boolean {
    if (!stack.length) return false;
    const tag = stack[stack.length - 1]!;
    const candidate = this.source.slice(this.pos + 2, this.pos + 2 + tag.length);
    if (candidate.toLowerCase() !== tag.toLowerCase()) return false;
    const after = this.source[this.pos + 2 + tag.length];
    return after === '>' || after === undefined || /\s/.test(after);
  }

  private skipUntil(char: string): void {
    const idx = this.source.indexOf(char, this.pos);
    this.advance((idx === -1 ? this.source.length : idx + 1) - this.pos);
  }

  private parseComment(): CommentNode {
    const start = this.loc();
    this.advance(4); // <!--
    const end = this.source.indexOf('-->', this.pos);
    const content = end === -1 ? this.source.slice(this.pos) : this.source.slice(this.pos, end);
    this.advance(content.length + (end === -1 ? 0 : 3));
    return { type: 'comment', content, loc: this.finishLoc(start) };
  }

  // -------------------------------------------------------------------------
  // Text + interpolation
  // -------------------------------------------------------------------------

  private parseTextAndInterpolation(parentTag: string | null): TemplateChildNode[] {
    const nodes: TemplateChildNode[] = [];
    const preserve = parentTag !== null && PRESERVE_WHITESPACE_TAGS.has(parentTag);
    let buffer = '';
    let bufferStart = this.loc();

    const flush = () => {
      if (!buffer) return;
      nodes.push({ type: 'text', content: buffer, loc: this.finishLoc(bufferStart) });
      buffer = '';
    };

    while (!this.atEnd()) {
      if (this.startsWith('<') && /[a-zA-Z!/]/.test(this.source[this.pos + 1] ?? '')) break;

      // `\{` is how a literal brace is written. Only the brace needs it: a
      // lone `}` in text is unambiguous, since nothing opens on it.
      if (this.startsWith('\\{') || this.startsWith('\\}')) {
        if (!buffer) bufferStart = this.loc();
        this.advance(1);
        buffer += this.advance(1);
        continue;
      }

      if (this.startsWith(OPEN_DELIM) && !preserve) {
        flush();
        nodes.push(this.parseInterpolation());
        bufferStart = this.loc();
        continue;
      }

      if (!buffer) bufferStart = this.loc();
      buffer += this.advance(1);
    }

    flush();
    return nodes;
  }

  private parseInterpolation(): InterpolationNode {
    const start = this.loc();
    this.advance(OPEN_DELIM.length);

    const end = this.findInterpolationEnd();
    if (end === -1) this.error('Unclosed interpolation — missing `}`');

    const rawLoc = this.loc();
    const raw = this.advance(end - this.pos);
    const exp = raw.trim();
    this.advance(CLOSE_DELIM.length);
    if (!exp) this.error('Empty interpolation `{}`');
    return { type: 'interpolation', exp, loc: this.finishLoc(start), expLoc: trimmedLoc(rawLoc, raw) };
  }

  /**
   * Index of the `}` that closes the interpolation opened at `pos`.
   *
   * Scanning for the first `}` would be wrong: an expression can contain them,
   * in an object literal, a function body, or a template literal's `${}`. With
   * a two-character delimiter that was merely unlikely; with one character it
   * is ordinary, so braces are counted and strings are skipped.
   */
  private findInterpolationEnd(): number {
    let depth = 1;
    let i = this.pos;

    while (i < this.source.length) {
      const ch = this.source[i]!;

      if (ch === '\'' || ch === '"' || ch === '`') {
        i = this.skipStringLiteral(i, ch);
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
      i++;
    }
    return -1;
  }

  /** Index just past the string literal opening at `start`. */
  private skipStringLiteral(start: number, quote: string): number {
    let i = start + 1;
    while (i < this.source.length) {
      const ch = this.source[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      // A template literal's `${...}` may itself contain braces and strings.
      if (quote === '`' && ch === '$' && this.source[i + 1] === '{') {
        let depth = 1;
        i += 2;
        while (i < this.source.length && depth > 0) {
          const inner = this.source[i];
          if (inner === '\'' || inner === '"' || inner === '`') {
            i = this.skipStringLiteral(i, inner);
            continue;
          }
          if (inner === '{') depth++;
          else if (inner === '}') depth--;
          i++;
        }
        continue;
      }
      if (ch === quote) return i + 1;
      i++;
    }
    return i;
  }

  // -------------------------------------------------------------------------
  // Elements
  // -------------------------------------------------------------------------

  private parseElement(stack: string[]): TemplateChildNode | null {
    const start = this.loc();
    this.advance(1); // <

    const tag = this.parseTagName();
    if (!tag) this.error('Expected a tag name after `<`');

    const attrs: AttributeNode[] = [];
    const directives: DirectiveNode[] = [];

    this.skipWhitespace();
    while (!this.atEnd() && !this.startsWith('>') && !this.startsWith('/>')) {
      const parsed = this.parseAttribute(tag);
      if (parsed.type === 'attribute') attrs.push(parsed);
      else directives.push(parsed);
      this.skipWhitespace();
    }

    let selfClosing = false;
    if (this.startsWith('/>')) {
      selfClosing = true;
      this.advance(2);
    } else if (this.startsWith('>')) {
      this.advance(1);
    } else {
      this.error(`Unclosed tag \`<${tag}\``);
    }

    const isVoid = VOID_TAGS.has(tag.toLowerCase());
    let children: TemplateChildNode[] = [];

    if (!selfClosing && !isVoid) {
      if (RAW_TEXT_TAGS.has(tag.toLowerCase())) {
        children = this.parseRawText(tag);
      } else {
        stack.push(tag);
        children = this.parseChildren(stack);
        stack.pop();
        this.consumeClosingTag(tag, start);
      }
    }

    const loc = this.finishLoc(start);
    children = this.condenseWhitespace(children, tag);

    if (tag === 'slot') {
      // An outlet is a position, not an element: there is nothing for `:if` to
      // keep and nothing for `:for` to repeat. Both were dropped without a
      // word, so the outlet drew whatever a caller sent, always.
      for (const kind of ['if', 'else-if', 'else', 'for'] as const) {
        if (!directives.some((d) => d.kind === kind)) continue;
        this.error(
          `\`:${kind}\` on a \`<slot>\` decides nothing: an outlet is where content goes, and ` +
            'what it draws is what a caller sent.\n' +
            `  Put it on a \`<template>\` around the outlet: ` +
            `\`<template :${kind}="…"><slot></slot></template>\`.`,
        );
      }
      const nameAttr = attrs.find((a) => a.name === 'name');
      // `:from` says whose slots to look in; everything else a `:` writes on an
      // outlet is a prop it hands the content, so this is taken out of the list
      // before the rest are read as props.
      const from = directives.find((d) => d.kind === 'prop' && d.name === 'from');
      if (from && !from.exp) {
        this.error('`:from` needs the component whose content to draw, as in `:from="col"`.');
      }
      if (directives.filter((d) => d.kind === 'prop' && d.name === 'from').length > 1) {
        this.error('`:from` names one component, and this outlet names two.');
      }
      if (attrs.some((a) => a.name === 'from')) {
        this.error(
          '`from` on a slot outlet names the component whose content to draw, which is an ' +
            'expression: write `:from="col"`.\n' +
            '  To hand the content a value of your own under that name, call it something else — ' +
            'a slot passes what its component chooses, and `from` is taken here.',
        );
      }
      return {
        type: 'slot-outlet',
        name: nameAttr?.value ?? 'default',
        ...(from ? { from } : {}),
        attrs: attrs.filter((a) => a.name !== 'name'),
        directives: from ? directives.filter((d) => d !== from) : directives,
        children,
        loc,
      } satisfies SlotOutletNode;
    }

    // `:host` marks the element that stands for the component, and a
    // `<template>` produces no element: written there it did nothing, and the
    // component was then told it had nowhere to put what its caller wrote.
    if (tag === 'template' && directives.some((d) => d.kind === 'host')) {
      this.error(
        '`:host` marks the element that stands for the component, and a `<template>` is not ' +
          'an element — it groups nodes without producing one.\n' +
          '  Put `:host` on the element a caller would have written their class on.',
      );
    }

    return {
      type: 'element',
      tag,
      isComponent: isComponentTag(tag),
      isTemplate: tag === 'template',
      attrs,
      directives,
      children,
      selfClosing: selfClosing || isVoid,
      loc,
    } satisfies ElementNode;
  }

  private consumeClosingTag(tag: string, openLoc: SourceLocation): void {
    if (!this.startsWith('</')) {
      throw new CompilerError(
        `Missing closing tag for \`<${tag}>\``,
        { line: openLoc.line, column: openLoc.column },
        this.source,
        this.filename,
      );
    }
    if (!this.isClosingTagFor([tag])) {
      const found = this.source.slice(this.pos, this.source.indexOf('>', this.pos) + 1);
      throw new CompilerError(
        `Mismatched closing tag: expected \`</${tag}>\` but found \`${found}\``,
        { line: this.line, column: this.column },
        this.source,
        this.filename,
      );
    }
    this.advance(2);
    this.advance(tag.length);
    this.skipWhitespace();
    if (!this.startsWith('>')) this.error(`Malformed closing tag for \`<${tag}>\``);
    this.advance(1);
  }

  private parseRawText(tag: string): TemplateChildNode[] {
    const start = this.loc();
    const closeIdx = this.source.toLowerCase().indexOf(`</${tag.toLowerCase()}`, this.pos);
    const content =
      closeIdx === -1 ? this.source.slice(this.pos) : this.source.slice(this.pos, closeIdx);
    this.advance(content.length);
    if (closeIdx !== -1) this.consumeClosingTag(tag, start);
    if (!content) return [];
    return [{ type: 'text', content, loc: this.finishLoc(start) } satisfies TextNode];
  }

  private parseTagName(): string {
    let count = 0;
    while (
      this.pos + count < this.source.length &&
      /[a-zA-Z0-9\-_.:]/.test(this.source[this.pos + count]!)
    ) {
      count++;
    }
    return this.advance(count);
  }

  // -------------------------------------------------------------------------
  // Attributes and directives
  // -------------------------------------------------------------------------

  private parseAttribute(tag: string): AttributeNode | DirectiveNode {
    const start = this.loc();

    let count = 0;
    while (this.pos + count < this.source.length) {
      const ch = this.source[this.pos + count]!;
      if (/[\s=/>]/.test(ch)) break;
      count++;
    }
    if (count === 0) this.error(`Unexpected character in \`<${tag}>\` attribute list`);
    const rawName = this.advance(count);

    let value: string | null = null;
    let valueLoc: SourceLocation | null = null;
    this.skipWhitespace();
    if (this.startsWith('=')) {
      this.advance(1);
      this.skipWhitespace();
      const parsed = this.parseAttributeValue(rawName);
      value = parsed.value;
      valueLoc = parsed.loc;
    }

    if (!rawName.startsWith(':')) {
      return { type: 'attribute', name: rawName, value, loc: this.finishLoc(start) };
    }

    return this.resolveDirective(rawName, value, valueLoc, this.finishLoc(start), tag);
  }

  /** The value's text, and where it starts — inside the quotes, not on them. */
  private parseAttributeValue(attrName: string): { value: string; loc: SourceLocation } {
    const quote = this.source[this.pos];
    if (quote === '"' || quote === "'") {
      this.advance(1);
      const loc = this.loc();
      const end = this.source.indexOf(quote, this.pos);
      if (end === -1) this.error(`Unclosed quote in value of \`${attrName}\``);
      const value = this.advance(end - this.pos);
      this.advance(1);
      return { value, loc: this.finishLoc(loc) };
    }
    // Unquoted value: read to the next whitespace or tag terminator.
    const loc = this.loc();
    let count = 0;
    while (this.pos + count < this.source.length && !/[\s>]/.test(this.source[this.pos + count]!)) {
      count++;
    }
    if (count === 0) this.error(`Missing value for \`${attrName}\``);
    return { value: this.advance(count), loc: this.finishLoc(loc) };
  }

  /**
   * Resolve `:name.mod1.mod2` into a typed directive.
   *
   * Precedence, deliberately fixed so a name always means one thing:
   *   1. structural directives (`:if`, `:for`, `:model`, …)
   *   2. explicit escapes (`:on-*`, `:prop-*`, `:attr-*`)
   *   3. `:class` / `:style`
   *   4. a known DOM event name -> event listener
   *   5. anything else -> property / attribute binding
   */
  private resolveDirective(
    rawName: string,
    value: string | null,
    valueLoc: SourceLocation | null,
    loc: SourceLocation,
    tag: string,
  ): DirectiveNode {
    const withoutColon = rawName.slice(1);
    const parts = withoutColon.split('.');
    const base = parts[0] ?? '';
    const modifiers = parts.slice(1);

    if (!base) this.error('Empty directive name — expected something after `:`');

    const exp = value && value.trim() ? value.trim() : null;
    const expLoc = exp !== null && valueLoc ? trimmedLoc(valueLoc, value!) : null;

    const make = (kind: DirectiveKind, name: string): DirectiveNode => ({
      type: 'directive',
      kind,
      name,
      rawName,
      modifiers,
      exp,
      loc,
      expLoc,
    });

    if (STRUCTURAL_DIRECTIVES.has(base)) {
      const node = make(base as DirectiveKind, '');
      if (base === 'host' && node.exp) {
        this.error('`:host` does not take a value — it marks the element the tag\'s own attributes reach.');
      }
      if (base === 'outlet' && node.exp) {
        this.error(
          '`:outlet` does not take a value — it marks where a child route renders, and which ' +
            'route that is belongs to the router.',
        );
      }
      if (base !== 'else' && base !== 'portal' && base !== 'host' && base !== 'outlet' && !node.exp) {
        this.error(`\`${rawName}\` requires a value, e.g. \`${rawName}="expression"\``);
      }
      if (base === 'else' && node.exp) {
        this.error('`:else` does not take a value');
      }
      return node;
    }

    if (base === 'spread') return make('spread', '');

    // `:slot-<name>` fills the slot of that name, and its value — when it has
    // one — is the pattern its content binds the slot's props with, the same
    // pattern `:for` takes on its left. The name is in the directive rather
    // than in the value so that it reads as the other escapes below do, and so
    // that there is nothing to quote: `:slot="'cell'"` and `:slot="cell"` used
    // to mean the same slot while `:slot="cell(row)"` silently named one
    // `cell(row)`.
    if (base.startsWith('slot-')) {
      const name = base.slice(5);
      if (!name) this.error('`:slot-` needs a slot name, as in `:slot-cell`.');
      return make('slot', name);
    }
    if (base === 'slot') {
      const name = exp ? stripQuotes(exp) : 'name';
      this.error(
        '`:slot` names its slot in the directive now.\n' +
          `  Write \`:slot-${name}\`, and to bind what the slot passes:\n` +
          `  \`:slot-${name}="{ row }"\`.`,
      );
    }

    if (base.startsWith('on-')) return make('event', base.slice(3));
    if (base.startsWith('prop-')) return make('prop', base.slice(5));
    if (base.startsWith('attr-')) return make('attr', base.slice(5));

    if (base === 'class') return make('class', 'class');
    if (base === 'style') return make('style', 'style');

    if (KNOWN_EVENTS.has(base)) return make('event', base);

    // Anything left is a property binding, which is where a mistyped directive
    // goes to hide: `:iff="open"` sets a property called `iff` and the element
    // renders unconditionally, with nothing to see in the output. A name one
    // edit from a directive, and not an attribute anyone actually writes, is a
    // typo rather than a property.
    // On a component the guess is the wrong side of the bet: `modal`, `mode`
    // and `styles` are real options of real primitives, and a component
    // refuses a prop it does not declare anyway — with the same "did you
    // mean" and the list of props it really has, which is a better answer
    // than a guess made without knowing any of them.
    if (!COMMON_ATTRIBUTES.has(base) && !base.includes('-') && !isComponentTag(tag)) {
      const meant = DIRECTIVE_NAMES.find((name) => isOneEditFrom(base, name));
      if (meant) {
        // A slot carries its name, so the suggestion has to show the shape
        // rather than a directive that means nothing on its own.
        const suggestion = meant === 'slot' ? 'slot-<name>' : meant;
        this.error(
          `Unknown directive \`:${base}\` — did you mean \`:${suggestion}\`?\n` +
            `  If \`${base}\` really is a property, write \`:prop-${base}\` to say so.`,
        );
      }
    }

    return make('prop', base);
  }

  // -------------------------------------------------------------------------
  // Whitespace
  // -------------------------------------------------------------------------

  /**
   * Condense mode drops whitespace-only text between elements when it spans a
   * line break (pure indentation) and collapses other whitespace runs to one
   * space. This is what lets formatted templates compile to tight markup.
   */
  private condenseWhitespace(
    nodes: TemplateChildNode[],
    parentTag: string | null,
  ): TemplateChildNode[] {
    if (this.whitespace === 'preserve') return nodes;
    if (parentTag !== null && PRESERVE_WHITESPACE_TAGS.has(parentTag.toLowerCase())) return nodes;

    const result: TemplateChildNode[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (node.type !== 'text') {
        result.push(node);
        continue;
      }

      if (!/[^\t\r\n\f ]/.test(node.content)) {
        const prev = nodes[i - 1];
        const next = nodes[i + 1];
        const isEdge = !prev || !next;
        const hasNewline = /[\r\n]/.test(node.content);
        // Indentation between two elements carries no meaning; a single space
        // deliberately placed between inline content does.
        if (isEdge || hasNewline) continue;
        node.content = ' ';
      } else {
        node.content = node.content.replace(/[\t\r\n\f ]+/g, ' ');
      }
      result.push(node);
    }
    return result;
  }
}

/**
 * Narrow a raw value's location to the trimmed expression inside it.
 *
 * `:if=" open "` and `{ open }` both carry padding the expression does not,
 * and pointing a diagnostic at the padding puts the caret on whitespace. Line
 * counting mirrors `advance` so a value wrapped onto the next line reports the
 * line the expression is actually on.
 */
function trimmedLoc(loc: SourceLocation, raw: string): SourceLocation {
  let { line, column } = loc;
  let lead = 0;
  while (lead < raw.length && /\s/.test(raw[lead]!)) {
    if (raw[lead] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
    lead++;
  }
  const start = loc.start + lead;
  return { start, end: start + raw.trim().length, line, column };
}

/** `'cell'` and `cell` alike, for naming the slot in the replacement message. */
function stripQuotes(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return (quote === "'" || quote === '"') && trimmed.endsWith(quote)
    ? trimmed.slice(1, -1)
    : trimmed;
}
