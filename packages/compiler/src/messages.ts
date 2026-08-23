/**
 * Messages, compiled rather than loaded.
 *
 * The four ways a library can ship translations all cost something. One
 * catalogue per locale sends every string in the application to every page.
 * Hand-cut namespaces still ship whole. One build per locale gives up runtime
 * switching and multiplies deployments. Compiling each message to its own
 * function is the shape that costs nothing, because the bundler drops what
 * nobody imported and size stops tracking the number of messages.
 *
 * Volt can go further than a bundler can, and this file is why: the template
 * compiler *reads the call sites*. `t('close')` inside a template is a literal
 * the parser already sees, so three things follow that tree-shaking alone
 * cannot give —
 *
 *   - a key that is not in the catalogue is a build error naming the template
 *     file and line, rather than a fallback string discovered in production;
 *   - a call missing a parameter the message needs is the same error, because
 *     `'page {n} of {m}'` says what it needs and `t('pageOf', { n })` does not
 *     supply it;
 *   - a message nothing asks for is reportable, because the full set of call
 *     sites is known.
 *
 * None of it replaces the runtime catalogue. `createLocaleProvider` still
 * takes one, and still has to: it is the fallback when a key is computed, and
 * the only path there is when no build step ran at all. This is the build-time
 * form standing beside it.
 *
 * Nothing here reads a file or touches a DOM, so the same code runs in the
 * Vite plugin and in a test with no fixture on disk.
 */

import type { Diagnostic } from './a11y.js';
import { isOneEditFrom } from './dom-info.js';
import type { ExprNode, PatternNode } from './expression/ast.js';
import { CompilerError } from './parser.js';

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

/**
 * A string that inflects with a count, in the shape `@voltdev/primitives`
 * reads at runtime. Only `other` is required — it is the category every locale
 * has, and the fallback for the ones a translation leaves out.
 */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type CatalogMessage = string | PluralForms;

/** A parsed `messages/<locale>.json`. */
export type MessageCatalog = Record<string, CatalogMessage>;

/**
 * The keys `@voltdev/primitives` speaks for itself, mirroring `LibraryMessages`
 * there.
 *
 * Copied rather than imported because the compiler deliberately depends on
 * nothing — it runs inside a Vite plugin, a test, and a `new Function` at
 * runtime, and a dependency on the component library would follow it into all
 * three. `messages.test.ts` pins the copy against the original, so the two
 * cannot drift without a test going red.
 *
 * The list exists for one job: an application that translates `close` is
 * translating a string its own templates never mention, because a Dialog says
 * it. Reporting that as unused would be a warning about correct code, which is
 * the first thing that teaches a team to switch the warnings off.
 */
export const LIBRARY_MESSAGE_KEYS: readonly string[] = [
  'clear',
  'close',
  'loading',
  'next',
  'noResults',
  'pageOf',
  'previous',
  'remove',
  'required',
  'selected',
  'sortedAscending',
  'sortedDescending',
];

/** The placeholder whose value picks the plural category, as at runtime. */
const COUNT = 'n';

/** `{name}`, matching the runtime's own interpolation exactly. */
const PLACEHOLDER = /\{\s*(\w+)\s*\}/g;

/** The same shape without the `g` flag, because a global regex remembers. */
const HAS_PLACEHOLDER = /\{\s*\w+\s*\}/;

/** One `{name}` a message asks its caller for. */
export interface MessageParam {
  name: string;
  /**
   * A count selects the plural form, so it can only be a number. Everything
   * else is substituted as written, and a number there is merely localised —
   * so a string is equally valid and the type says so.
   */
  kind: 'count' | 'value';
  /** The placeholder exactly as authored, which is what an absent value leaves standing. */
  raw: string;
}

export interface MessageShape {
  key: string;
  /** In first-appearance order, with the count first when there is one. */
  params: MessageParam[];
  /** Present when the message inflects, in catalogue order. */
  forms: PluralForms | null;
  /** The catalogue entry itself, for the generator and for error messages. */
  message: CatalogMessage;
}

/**
 * What a message asks for, read out of the message itself.
 *
 * Declaring parameters separately would mean writing `'page {n} of {m}'` and
 * then saying it takes `n` and `m` — the same fact twice, and the second copy
 * is the one that goes stale.
 */
export function messageShape(key: string, message: CatalogMessage): MessageShape {
  const params: MessageParam[] = [];
  const seen = new Set<string>();

  const add = (name: string, raw: string, kind: 'count' | 'value'): void => {
    if (seen.has(name)) return;
    seen.add(name);
    params.push({ name, kind, raw });
  };

  const forms = typeof message === 'string' ? null : message;

  // A count is required whether or not any form spells it out: without it
  // there is no category to select, and the caller silently gets `other`.
  if (forms) add(COUNT, `{${COUNT}}`, 'count');

  for (const text of forms ? Object.values(forms) : [message as string]) {
    if (typeof text !== 'string') continue;
    for (const match of text.matchAll(PLACEHOLDER)) {
      add(match[1]!, match[0], match[1] === COUNT && forms ? 'count' : 'value');
    }
  }

  return { key, params, forms, message };
}

// ---------------------------------------------------------------------------
// Call sites
// ---------------------------------------------------------------------------

/** One `t('key', { ... })` found in a template expression. */
export interface TranslateCall {
  key: string;
  /**
   * The parameter names the call passes, or null when the template cannot
   * tell — `t(key, values)` with an identifier, a spread, or a computed
   * property. Null means no check, because guessing produces the warning on
   * correct code that gets every rule turned off.
   */
  params: string[] | null;
}

export interface MessageSite extends TranslateCall {
  loc: { line: number; column: number };
}

/**
 * How a template spells the locale's translate function.
 *
 * With no list, every `t(...)` and every `<anything>.t(...)` is one, which is
 * the widest check and reserves the name: a component method called `t` turns
 * its argument into a message key, and a key the catalogue has not got into a
 * build error on correct code. The compiler cannot tell the two apart, and
 * guessing which receiver is a locale would cost the check the certainty that
 * makes it worth having — so a project that needs the name back says which
 * spellings are the locale's instead, and every other `t` goes unread.
 *
 * A spelling is written the way the template writes it: `t`, or `locale.t` for
 * a call through a field. `this.locale.t` is the same call and the same
 * spelling. A receiver with no name — `useLocale().t` — is `.t`, which can be
 * listed but says nothing about which receiver it was.
 */
export type TranslateNames = readonly string[];

/** The shapes a spelling may have, which is what makes a typo in one findable. */
const SPELLING = /^(?:[A-Za-z_$][A-Za-z0-9_$]*)?\.?t$/;

/**
 * Refuse a spelling no call site can ever match.
 *
 * A list is how a project turns the check back on for its own `t` and off for
 * everyone else's, so an entry that matches nothing does not narrow the check:
 * it silently switches it off for the calls it was written to cover.
 */
export function checkTranslateNames(names: TranslateNames | undefined): void {
  for (const name of names ?? []) {
    if (SPELLING.test(name)) continue;
    throw new Error(
      `[volt:messages] \`${name}\` is not a way to spell the locale's \`t\`. Name it as a ` +
        'template writes it: `t`, or `locale.t` for a call through a field.',
    );
  }
}

/**
 * Every `t('key')` in one parsed expression.
 *
 * Only a literal key is collected. `t(whichever)` is legitimate and unknowable
 * here, so it is left alone rather than guessed at — the cost being that such
 * a message cannot be tree-shaken or checked, which is the right trade for the
 * rare case.
 */
export function collectTranslateCalls(
  node: ExprNode,
  out: TranslateCall[] = [],
  names?: TranslateNames,
): TranslateCall[] {
  const accepted = names ? new Set(names) : null;

  const isTranslateCallee = (callee: ExprNode): boolean => {
    const spelling = translateSpelling(callee);
    if (spelling === null) return false;
    return accepted === null || accepted.has(spelling);
  };

  const visit = (n: ExprNode | PatternNode | null | undefined): void => {
    if (!n || typeof n !== 'object') return;

    if (n.type === 'Call') {
      if (isTranslateCallee(n.callee)) {
        const first = n.args[0];
        if (first?.type === 'Literal' && typeof first.value === 'string') {
          out.push({ key: first.value, params: argumentNames(n.args[1]) });
        }
      }
      visit(n.callee);
      for (const arg of n.args) visit(arg);
      return;
    }

    // Everything else is walked generically: the shapes vary, and a key can
    // appear anywhere an expression can.
    for (const value of Object.values(n as unknown as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        for (const item of value) visit(item as ExprNode);
      } else if (value && typeof value === 'object' && 'type' in value) {
        visit(value as ExprNode);
      }
    }
  };

  visit(node);
  return out;
}

/** How this callee is written, or null when it is not a `t` at all. */
function translateSpelling(callee: ExprNode): string | null {
  if (callee.type === 'Identifier') return callee.name === 't' ? 't' : null;
  if (callee.type !== 'Member' || callee.computed) return null;
  if (callee.property.type !== 'Identifier' || callee.property.name !== 't') return null;

  const object = callee.object;
  // A receiver is named by whatever it is reached through last, so `locale.t`
  // and `this.locale.t` are one spelling — they are one call written twice.
  if (object.type === 'Identifier') return `${object.name}.t`;
  if (object.type === 'Member' && !object.computed && object.property.type === 'Identifier') {
    return `${object.property.name}.t`;
  }
  return '.t';
}

/** The names a `t(key, ...)` second argument supplies, or null if unreadable. */
function argumentNames(arg: ExprNode | undefined): string[] | null {
  if (arg === undefined) return [];
  if (arg.type !== 'Object') return null;

  const names: string[] = [];
  for (const prop of arg.properties) {
    // A spread could carry anything, and a computed key is a runtime fact.
    if (prop.type !== 'Property' || prop.computed) return null;
    const key = prop.key;
    if (key.type === 'Identifier') names.push(key.name);
    else if (key.type === 'Literal' && typeof key.value === 'string') names.push(key.value);
    else return null;
  }
  return names;
}

/**
 * Message keys mentioned by ordinary source, found lexically.
 *
 * A template is parsed, so its call sites are known exactly. TypeScript is
 * not — the compiler has no parser for it and should not grow one — so this
 * scans for the literal shape instead. It deliberately over-collects: `t('x')`
 * in a comment or a string counts. That bias is the safe one, because the only
 * thing this feeds is the unused-message warning, and over-collecting there
 * costs a message nobody was told about while under-collecting reports a
 * message that is used.
 */
export function scanMessageKeys(source: string, out: Set<string> = new Set()): Set<string> {
  for (const match of source.matchAll(/(?<![\w$])t\s*\(\s*(['"`])((?:[^'"`\\]|\\.)*)\1/g)) {
    out.add(match[2]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

export interface MessageCheckOptions {
  /** The template these sites came from, so an error says which file to open. */
  filename?: string;
  /** The catalogue, so an error says which file to add the key to. */
  catalogFile?: string;
}

/**
 * Hold every call site in a template against the catalogue.
 *
 * Throws on the first problem, the way every other thing the compiler refuses
 * throws: a missing message is not a judgement call, and a build that carries
 * on emits a page with a raw key on it.
 */
export function checkMessageSites(
  sites: readonly MessageSite[],
  catalog: MessageCatalog,
  options: MessageCheckOptions = {},
): void {
  const where = options.catalogFile ?? 'the catalogue';

  for (const site of sites) {
    const message = catalog[site.key];

    if (message === undefined) {
      const near = Object.keys(catalog).find((k) => isOneEditFrom(k, site.key));
      throw new CompilerError(
        `\`t('${site.key}')\` — no such message in ${where}.` +
          (near
            ? `\n  Did you mean \`t('${near}')\`?`
            : // Nothing in the catalogue is close, so the other explanation is
              // worth putting on screen: this may not be the locale's `t` at
              // all. The compiler cannot tell, and this is how it is told.
              `\n  Add it there, or fix the key.` +
              `\n  If this \`t\` is not the locale's, name the spellings that are with \`translate\`.`),
        site.loc,
        undefined,
        options.filename,
      );
    }

    const passed = site.params;
    if (passed === null) continue;

    const shape = messageShape(site.key, message);
    const missing = shape.params.filter((p) => !passed.includes(p.name));
    if (missing.length === 0) continue;

    const needed = shape.params.map((p) => p.name).join(', ');
    const given = passed.length ? passed.join(', ') : 'nothing';
    throw new CompilerError(
      `\`t('${site.key}')\` is missing ${missing.map((p) => `\`${p.name}\``).join(', ')}.` +
        `\n  ${where} writes it as ${JSON.stringify(sample(message))}, so it needs { ${needed} }; this passes ${given}.`,
      site.loc,
      undefined,
      options.filename,
    );
  }
}

/** One form of a message, for an error that shows what the catalogue says. */
function sample(message: CatalogMessage): string {
  return typeof message === 'string' ? message : message.other;
}

export interface UnusedOptions {
  /** The catalogue file, so the warning points at the line to delete. */
  filename?: string;
  /** Its text, so the warning can name that line rather than guess. */
  source?: string;
  /**
   * Keys never reported, whatever the call sites say. Defaults to the strings
   * the component library speaks for itself: an application translates those
   * without any of its own templates mentioning them.
   */
  ignore?: Iterable<string>;
}

/**
 * Messages in the catalogue that nothing asks for.
 *
 * A warning rather than an error, and the only finding here that is: a key
 * added today for a screen landing next week is not a mistake, and refusing
 * the build over it would be the rule's own undoing.
 */
export function unusedMessages(
  catalog: MessageCatalog,
  used: Iterable<string>,
  options: UnusedOptions = {},
): Diagnostic[] {
  const asked = used instanceof Set ? used : new Set(used);
  const ignore = new Set(options.ignore ?? LIBRARY_MESSAGE_KEYS);

  const findings: Diagnostic[] = [];
  for (const key of Object.keys(catalog)) {
    if (asked.has(key) || ignore.has(key)) continue;
    findings.push({
      message:
        `Message \`${key}\` is in ${options.filename ?? 'the catalogue'} but no template or module asks for it.` +
        `\n  Delete it, or call \`t('${key}')\` where it belongs.`,
      loc: keyLocation(key, options.source),
      filename: options.filename,
    });
  }
  return findings;
}

/** The categories `Intl.PluralRules` can select, and the only keys a form may have. */
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

export interface CatalogCheckOptions {
  /** The catalogue file, so a refusal says which file to edit. */
  catalogFile?: string;
}

/**
 * Hold the catalogue itself to a shape a message can have.
 *
 * `MessageCatalog` is a TypeScript type and the catalogue is a JSON file, so
 * nothing about the type survives the read: a catalogue is whatever somebody
 * wrote. Every shape refused here would otherwise generate — a nested group
 * becomes a plural switch over categories no locale selects, a form set
 * without `other` loses its default arm, a number has no arm at all — and each
 * emits a function returning `undefined` under a declaration that promises a
 * string. A blank where a sentence goes, found in production, is precisely the
 * failure this whole pass exists to prevent, so it is refused at the read
 * rather than checked at the call sites, which would pass it too.
 */
export function checkCatalog(catalog: MessageCatalog, options: CatalogCheckOptions = {}): void {
  const where = options.catalogFile ?? 'the catalogue';

  for (const [key, message] of Object.entries(catalog)) {
    if (!IDENTIFIER.test(key) || RESERVED.has(key)) {
      throw new Error(
        `[volt:messages] \`${key}\` cannot be a message key: a compiled message is an exported ` +
          `function, and that is not a name one can have. Rename it in ${where} — ` +
          `\`${suggestIdentifier(key)}\` would work.`,
      );
    }

    if (MODULE_BINDINGS.has(key)) {
      throw new Error(
        `[volt:messages] \`${key}\` cannot be a message key: the generated module binds that ` +
          `name itself, and a module that declares it twice does not parse at all. Rename it in ` +
          `${where} — \`${suggestIdentifier(key)}\` would work.`,
      );
    }

    if (typeof message === 'string') continue;

    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      throw new Error(
        `[volt:messages] \`${key}\` in ${where} is ${describeValue(message)}. A message is a ` +
          'string, or an object of plural forms.',
      );
    }

    const written = Object.keys(message);
    const strays = written.filter((form) => !PLURAL_CATEGORIES.includes(form));
    if (strays.length > 0) {
      const stray = strays[0]!;
      throw new Error(
        strays.length === written.length
          ? `[volt:messages] \`${key}\` in ${where} is a group of messages, not a message. A ` +
              'catalogue is one level deep, because a compiled message is an exported function ' +
              `and there is no second way to spell a function name — write \`${key}.${stray}\` ` +
              `as \`${suggestIdentifier(`${key}.${stray}`)}\`.`
          : `[volt:messages] \`${key}.${stray}\` in ${where} is not a plural category. The ` +
              `categories are ${PLURAL_CATEGORIES.join(', ')}.`,
      );
    }

    for (const [form, text] of Object.entries(message)) {
      if (typeof text !== 'string') {
        throw new Error(
          `[volt:messages] \`${key}.${form}\` in ${where} is ${describeValue(text)}. A plural ` +
            'form is a string.',
        );
      }
    }

    if (typeof message.other !== 'string') {
      throw new Error(
        `[volt:messages] \`${key}\` in ${where} has no \`other\` form. It is the one category ` +
          'every locale has, so it is what a count no other form covers falls back to — and ' +
          'without it such a count has no string at all.',
      );
    }
  }
}

/** What a value is, so a refusal says what was found and not only what was wanted. */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'a list';
  return `a ${typeof value}`;
}

/** The line a key is declared on, so the warning is clickable. */
function keyLocation(key: string, source: string | undefined): { line: number; column: number } {
  if (!source) return { line: 1, column: 1 };
  const lines = source.split('\n');
  const pattern = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    const column = lines[i]!.search(pattern);
    if (column !== -1) return { line: i + 1, column: column + 1 };
  }
  return { line: 1, column: 1 };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  /**
   * The BCP 47 tag the catalogue is written in. It is baked into the generated
   * `Intl` instances, which is the whole reason a compiled message can format
   * a number without carrying a locale argument: the catalogue already is one
   * locale.
   */
  locale: string;
  /** Named in the header, so nobody edits the output looking for the source. */
  catalogFile?: string;
  /**
   * Wrap the declarations in `declare module '<id>' { ... }`.
   *
   * A build serves the generated code from a virtual module, which has no file
   * for TypeScript to find. Naming the module is what lets a `.d.ts` sitting
   * anywhere in the project type an import of it.
   */
  moduleId?: string;
}

export interface GeneratedMessages {
  /** An ES module: one exported function per message, and nothing else to load. */
  code: string;
  /** Its declarations, including the `Messages` interface and a typed `t`. */
  types: string;
}

/**
 * Words a `const` cannot be named, reserved outright or in strict mode — which
 * a module always is. A message called `default` would emit a file that does
 * not parse.
 */
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if',
  'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'await', 'let', 'static',
  'implements', 'interface', 'package', 'private', 'protected', 'public',
]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Names the generated module declares for itself.
 *
 * `locale` and `catalogFile` are exports and the helpers are module-level
 * consts, so a message of any of these names emits a second declaration of one
 * and the whole module stops parsing — every message in the catalogue lost to
 * one key, and the failure arrives as a syntax error in generated code rather
 * than as anything naming the catalogue. `messages.test.ts` reads the names
 * back out of a generated module, so a helper added later cannot quietly leave
 * this list behind.
 */
export const MODULE_BINDINGS = new Set([
  'locale', 'catalogFile', 't', '_all', '_v', '_p', '_nf', '_pr',
]);

/**
 * Turn a catalogue into a module a bundler can take apart.
 *
 * Each message is its own exported function, so importing one message links
 * one string. The two `Intl` instances are lazy and shared: constructing a
 * formatter is the expensive half of `Intl`, and a module that built one at
 * import time would charge every page for a locale it may never format a
 * number in.
 */
export function generateMessages(
  catalog: MessageCatalog,
  options: GenerateOptions,
): GeneratedMessages {
  try {
    Intl.getCanonicalLocales(options.locale);
  } catch {
    // The tag is baked into the module's `Intl` instances, so a bad one is not
    // a mislabelled catalogue: it is a page that throws the first time it
    // formats a number.
    throw new Error(
      `[volt:messages] \`${options.locale}\` is not a language tag, and a compiled message ` +
        'bakes one into every `Intl` instance it builds.',
    );
  }

  // Checked here as well as at the read, because a catalogue reaches this
  // function from a test and a runtime compile too, and every shape it refuses
  // would otherwise emit a function that returns `undefined`.
  checkCatalog(catalog, { catalogFile: options.catalogFile });

  const shapes = Object.entries(catalog).map(([key, message]) => messageShape(key, message));

  const from = options.catalogFile ?? 'the catalogue';
  const header = [
    `// Generated by @voltdev/compiler from ${from}.`,
    '// Edit the catalogue, not this file.',
    '',
  ];

  const needsValue = shapes.some(usesPlaceholder);
  const needsPlural = shapes.some((s) => s.forms !== null);

  const code = [...header];
  code.push(`export const locale = ${JSON.stringify(options.locale)};`);
  code.push(`export const catalogFile = ${JSON.stringify(from)};`);
  code.push('');

  if (needsValue) {
    code.push(
      '// Lazy because building a formatter is the expensive half of `Intl`, and a',
      '// page that never interpolates a number should never pay for one.',
      'let _nf;',
      '/** A value in a placeholder: numbers localised, an absent one left standing. */',
      'const _v = (value, raw) =>',
      '  value === undefined',
      '    ? raw',
      "    : typeof value === 'number'",
      '      ? (_nf ??= new Intl.NumberFormat(locale)).format(value)',
      '      : value;',
      '',
    );
  }

  if (needsPlural) {
    code.push(
      'let _pr;',
      '/** No count means no category to select, and `other` is the one every locale has. */',
      'const _p = (count) =>',
      "  typeof count === 'number' ? (_pr ??= new Intl.PluralRules(locale)).select(count) : 'other';",
      '',
    );
  }

  for (const shape of shapes) code.push(messageFunction(shape), '');

  code.push(
    '/**',
    ' * A message by key, for a key only known at runtime.',
    ' *',
    ' * This is the one export that is not tree-shakeable, and deliberately so:',
    ' * it names every message, so importing it links the catalogue whole. Import',
    ' * the message you want instead, and a bundler ships that one string.',
    ' *',
    ' * A key with no message returns the key, exactly as the runtime catalogue',
    ' * does: not a string anyone wants on screen, which is why it beats a gap.',
    ' */',
    `const _all = { ${shapes.map((s) => s.key).join(', ')} };`,
    'export const t = (key, params) => _all[key]?.(params) ?? key;',
    '',
  );

  const types = [...header];
  types.push('export interface Messages {');
  for (const shape of shapes) types.push(`  ${shape.key}: ${signature(shape)};`);
  types.push('}', '');
  types.push('/** Every key the catalogue defines — what `t` is checked against. */');
  types.push('export type MessageKey = keyof Messages;');
  types.push('');
  for (const shape of shapes) {
    types.push(`export const ${shape.key}: Messages[${JSON.stringify(shape.key)}];`);
  }
  types.push('');
  types.push('export const locale: string;');
  types.push('export const catalogFile: string;');
  types.push('');
  types.push(
    '/**',
    ' * A message by key, typed against the catalogue: `t(\'clsoe\')` does not',
    ' * compile, and neither does a call that leaves out a parameter the message',
    ' * needs.',
    ' */',
    'export const t: <K extends MessageKey>(',
    '  key: K,',
    '  ...params: Parameters<Messages[K]>',
    ') => string;',
    '',
  );

  // `declare` is left off every declaration above, which a `.d.ts` does not
  // need and an ambient module block does not allow.
  const declarations = types.join('\n');
  return {
    code: code.join('\n'),
    types: options.moduleId
      ? `declare module ${JSON.stringify(options.moduleId)} {\n` +
        declarations.replace(/^(?=.)/gm, '  ') +
        '\n}\n'
      : declarations,
  };
}

/** One message as a function type: what it needs, and that it returns a string. */
function signature(shape: MessageShape): string {
  if (shape.params.length === 0) return '() => string';
  const fields = shape.params
    .map((p) => `${p.name}: ${p.kind === 'count' ? 'number' : 'string | number'}`)
    .join('; ');
  return `(params: { ${fields} }) => string`;
}

/**
 * A message as a function.
 *
 * The parameter object defaults to an empty one so that a call which forgets
 * it behaves the way the runtime does — placeholders left standing, `other`
 * for a plural — rather than throwing. The declarations still require it; this
 * is about the calls types do not cover, which is the whole reason the runtime
 * form is worth keeping honest against.
 */
function messageFunction(shape: MessageShape): string {
  if (!shape.forms) {
    const params = shape.params.length ? 'params = {}' : '';
    return `export const ${shape.key} = (${params}) => ${literal(shape.message as string, shape)};`;
  }

  const lines = [`export const ${shape.key} = (params = {}) => {`];
  lines.push(`  switch (_p(params.${COUNT})) {`);
  for (const [category, text] of Object.entries(shape.forms)) {
    if (category === 'other' || typeof text !== 'string') continue;
    lines.push(`    case ${JSON.stringify(category)}: return ${literal(text, shape)};`);
  }
  lines.push(`    default: return ${literal(shape.forms.other, shape)};`);
  lines.push('  }');
  lines.push('};');
  return lines.join('\n');
}

/**
 * A message body as JavaScript.
 *
 * A message with no placeholders is a plain string, which is both smaller and
 * what a reader of the generated module expects to see next to the key.
 */
function literal(text: string, shape: MessageShape): string {
  if (!HAS_PLACEHOLDER.test(text)) return JSON.stringify(text);

  const known = new Set(shape.params.map((p) => p.name));
  let out = '`';
  let cursor = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1]!;
    out += escapeTemplate(text.slice(cursor, match.index));
    // A placeholder no parameter covers cannot happen for a name read out of
    // this same message — but a form the shape never saw would, and the
    // runtime leaves such a placeholder standing rather than blanking it.
    out += known.has(name)
      ? `\${_v(params.${name}, ${JSON.stringify(match[0])})}`
      : escapeTemplate(match[0]);
    cursor = match.index + match[0].length;
  }
  out += escapeTemplate(text.slice(cursor)) + '`';
  return out;
}

/** Whether any form of a message interpolates, so the module needs `_v`. */
function usesPlaceholder(shape: MessageShape): boolean {
  const texts = shape.forms ? Object.values(shape.forms) : [shape.message as string];
  return texts.some((text) => typeof text === 'string' && HAS_PLACEHOLDER.test(text));
}

function escapeTemplate(text: string): string {
  return text.replace(/[\\`]/g, '\\$&').replace(/\$\{/g, '\\${');
}

/** A name the rejected key was probably reaching for. */
function suggestIdentifier(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9_$]+(.)?/g, (_, next: string | undefined) =>
    next ? next.toUpperCase() : '',
  );
  const identifier = /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
  return RESERVED.has(identifier) || MODULE_BINDINGS.has(identifier) || identifier === ''
    ? `${identifier}Message`
    : identifier;
}
